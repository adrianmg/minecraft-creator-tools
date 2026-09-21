// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import Utilities from "../core/Utilities";
import Varint from "./Varint";

export default class LevelKeyValue {
  fileBytes: Uint8Array | undefined;
  startIndex: number | undefined;

  unsharedKeyBytes: Uint8Array | undefined;
  keyDelta: string | undefined;
  value: Uint8Array | undefined;
  sharedKey: string | undefined;
  sharedByteLength: number | undefined;
  length: number | undefined;
  previousKey: LevelKeyValue | undefined;
  keyCached: string | undefined;
  fullBytesCached: Uint8Array | undefined;
  internalKeyBytes: Uint8Array | undefined;
  isDeleted = false;
  sequenceNumber = 0n;

  public get unsharedKey(): string | undefined {
    if (this.unsharedKeyBytes === undefined) {
      return undefined;
    }

    const dv = new DataView(
      this.unsharedKeyBytes.buffer,
      this.unsharedKeyBytes.byteOffset,
      this.unsharedKeyBytes.byteLength
    );

    return Utilities.getAsciiString(dv, 0, dv.byteLength);
  }

  public get key(): string {
    if (this.keyCached) {
      return this.keyCached;
    }

    const bytes = this.keyBytes;
    if (!bytes) {
      return "";
    }

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const key = Utilities.getAsciiString(view, 0, view.byteLength);
    this.keyCached = key;

    return key;
  }

  public get keyBytes(): Uint8Array | undefined {
    if (!this.unsharedKeyBytes) {
      return undefined;
    }

    if (this.fullBytesCached) {
      return this.fullBytesCached;
    }

    if (this.sharedByteLength === undefined || this.sharedByteLength === 0) {
      return this.unsharedKeyBytes;
    }

    if (this.previousKey === undefined) {
      throw new Error("Unexpected shared key without a previous");
    }

    const previousBytes = this.previousKey.keyBytes;

    if (previousBytes === undefined) {
      throw new Error("Unexpected shared key without previous bytes");
    }

    const bytes = new Uint8Array(this.sharedByteLength + this.unsharedKeyBytes.length);
    const i = this.sharedByteLength;

    for (let j = 0; j < i; j++) {
      bytes[j] = previousBytes[j];
    }

    for (let j = 0; j < this.unsharedKeyBytes.length; j++) {
      bytes[j + i] = this.unsharedKeyBytes[j];
    }

    this.fullBytesCached = bytes;

    return bytes;
  }

  public get isRestart() {
    return this.sharedByteLength === 0;
  }

  /**
   * Clears the value data to free up memory. Call this after the value has been
   * processed and is no longer needed. The key information is preserved.
   */
  public clearValueData() {
    this.value = undefined;
    this.fileBytes = undefined;
  }

  /**
   * Clears all data including key bytes to maximize memory savings.
   * Only call this when the LevelKeyValue is no longer needed.
   */
  public clearAllData() {
    this.value = undefined;
    this.fileBytes = undefined;
    this.unsharedKeyBytes = undefined;
    this.fullBytesCached = undefined;
    this.internalKeyBytes = undefined;
    this.previousKey = undefined;
  }

  private static _readBoundedVarint(incomingBytes: Uint8Array, index: number, endIndex: number): Varint {
    for (let cursor = index; cursor < endIndex && cursor - index < 10; cursor++) {
      if ((incomingBytes[cursor] & 0x80) === 0) {
        return new Varint(incomingBytes, index);
      }
    }

    throw new Error("LevelDB entry contains an incomplete or oversized varint");
  }

  public loadFromLdb(
    incomingBytes: Uint8Array,
    startingIndex: number,
    prevKey: LevelKeyValue | undefined,
    entryEndIndex: number = incomingBytes.length
  ) {
    // IMPORTANT MEMORY NOTE
    // ---------------------
    // We intentionally do NOT store `incomingBytes` on `this.fileBytes` (and
    // we do NOT store the value/key fields via `incomingBytes.subarray(...)`).
    //
    // `Uint8Array.subarray()` returns a VIEW that pins the entire underlying
    // ArrayBuffer alive. In the LDB path, `incomingBytes` is a decompressed
    // LevelDB block (~32 KB typical, up to several MB) produced fresh by
    // `pako.inflate(...)`. A single retained subarray view keeps that whole
    // block's ArrayBuffer alive in external memory, even after the file has
    // been `unload()`ed.
    //
    // Profiling a 179 MB world template showed validation pushing peak RSS to
    // ~20 GB, with several GB of "external" memory still held after
    // validation finished — every persisted LevelKeyValue was pinning its
    // parent decompressed block. Using `slice(...)` makes a tightly-sized
    // copy with its own ArrayBuffer, so V8 can reclaim each block as soon as
    // the original `content` buffer goes out of scope at the caller.
    this.startIndex = startingIndex;

    let i = 0;

    const sharedBytes = LevelKeyValue._readBoundedVarint(incomingBytes, startingIndex, entryEndIndex);
    this.sharedByteLength = sharedBytes.value;
    i += sharedBytes.byteLength;

    if (this.sharedByteLength > 0) {
      this.previousKey = prevKey;
    }

    const unsharedBytes = LevelKeyValue._readBoundedVarint(incomingBytes, startingIndex + i, entryEndIndex);
    i += unsharedBytes.byteLength;

    const valueLength = LevelKeyValue._readBoundedVarint(incomingBytes, startingIndex + i, entryEndIndex);
    i += valueLength.byteLength;

    const internalKeyEnd = startingIndex + i + unsharedBytes.value;
    if (internalKeyEnd > entryEndIndex) {
      throw new Error("LevelDB entry key extends beyond the data-entry region");
    }

    const unsharedInternalKeyBytes = incomingBytes.slice(
      startingIndex + i,
      internalKeyEnd
    );

    if (this.sharedByteLength > 0) {
      const previousInternalKeyBytes = prevKey?.internalKeyBytes;
      if (!previousInternalKeyBytes || this.sharedByteLength > previousInternalKeyBytes.length) {
        throw new Error("Unexpected shared internal key without a compatible previous key");
      }

      this.internalKeyBytes = new Uint8Array(this.sharedByteLength + unsharedInternalKeyBytes.length);
      this.internalKeyBytes.set(previousInternalKeyBytes.subarray(0, this.sharedByteLength), 0);
      this.internalKeyBytes.set(unsharedInternalKeyBytes, this.sharedByteLength);
    } else {
      this.internalKeyBytes = unsharedInternalKeyBytes;
    }

    if (prevKey) {
      prevKey.internalKeyBytes = undefined;
    }

    if (this.internalKeyBytes.length < 8) {
      throw new Error("LevelDB internal key is missing its sequence and value-type trailer");
    }

    const trailerOffset = this.internalKeyBytes.length - 8;
    const valueType = this.internalKeyBytes[trailerOffset];
    if (valueType !== 0 && valueType !== 1) {
      throw new Error(`LevelDB internal key has unsupported value type ${valueType}`);
    }
    this.isDeleted = valueType === 0;

    let sequenceNumber = 0n;
    for (let trailerIndex = 7; trailerIndex >= 1; trailerIndex--) {
      sequenceNumber = (sequenceNumber << 8n) | BigInt(this.internalKeyBytes[trailerOffset + trailerIndex]);
    }
    this.sequenceNumber = sequenceNumber;

    this.fullBytesCached = this.internalKeyBytes.slice(0, trailerOffset);
    this.unsharedKeyBytes = this.fullBytesCached;
    this.previousKey = undefined;

    i += unsharedBytes.value;

    const valueEnd = startingIndex + i + valueLength.value;
    if (valueEnd > entryEndIndex) {
      throw new Error("LevelDB entry value extends beyond the data-entry region");
    }

    // slice() (not subarray) — see top-of-method note.
    this.value = incomingBytes.slice(startingIndex + i, valueEnd);
    i += valueLength.value;

    /*    this.restarts = [];

    for (let j = 0; j < restartsToRead; j++) {
      const offset = startingIndex + i + j * 4;
      this.restarts.push(
        DataUtilities.getUnsignedInteger(
          incomingBytes[offset],
          incomingBytes[offset + 1],
          incomingBytes[offset + 2],
          incomingBytes[offset + 3],
          true
        )
      );
    }
    const offset = startingIndex + i + restartsToRead * 4;

    const numRestarts = DataUtilities.getUnsignedInteger(
      incomingBytes[offset],
      incomingBytes[offset + 1],
      incomingBytes[offset + 2],
      incomingBytes[offset + 3],
      false
    );

    if (numRestarts != restartsToRead) {
      throw new Error("Unexpected restart mismatch");
    }*/

    this.length = i;
  }
}
