// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * ZipFixtureBytes — synthesizes zip containers for pack-limit fixtures at
 * test time. Pack size and file-count validators descend into container
 * files and count the *inner* entries, so a few-hundred-KiB zip can carry
 * hundreds of megabytes (or tens of thousands of files) of countable
 * content without checking in any binary asset.
 */

import * as zlib from "zlib";

const crcTable: number[] = (() => {
  const table: number[] = [];

  for (let n = 0; n < 256; n++) {
    let c = n;

    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }

    table[n] = c >>> 0;
  }

  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;

  for (let i = 0; i < bytes.length; i++) {
    crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

export interface IZipEntrySpec {
  readonly name: string;
  readonly data: Uint8Array;
}

interface IZipEntryRecord {
  readonly nameBytes: Uint8Array;
  readonly crc: number;
  readonly compressed: Uint8Array;
  readonly method: number;
  readonly uncompressedSize: number;
  readonly localHeaderOffset: number;
}

function writeUint16(target: number[], value: number) {
  target.push(value & 0xff, (value >> 8) & 0xff);
}

function writeUint32(target: number[], value: number) {
  target.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}

/**
 * Builds a stored/deflated zip from entries. Empty entries are stored
 * verbatim; non-empty entries are raw-deflated (a zero-filled buffer of any
 * size compresses to a sliver).
 */
export function zipFileBytes(entries: readonly IZipEntrySpec[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  const records: IZipEntryRecord[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = new Uint8Array([...entry.name].map((char) => char.charCodeAt(0)));
    const useDeflate = entry.data.length > 0;
    const compressed = useDeflate ? new Uint8Array(zlib.deflateRawSync(entry.data)) : entry.data;
    const record: IZipEntryRecord = {
      nameBytes,
      crc: crc32(entry.data),
      compressed,
      method: useDeflate ? 8 : 0,
      uncompressedSize: entry.data.length,
      localHeaderOffset: offset,
    };

    const header: number[] = [];

    writeUint32(header, 0x04034b50);
    writeUint16(header, 20); // version needed
    writeUint16(header, 0); // flags
    writeUint16(header, record.method);
    writeUint16(header, 0); // mod time
    writeUint16(header, 0x21); // mod date (a valid DOS date)
    writeUint32(header, record.crc);
    writeUint32(header, record.compressed.length);
    writeUint32(header, record.uncompressedSize);
    writeUint16(header, nameBytes.length);
    writeUint16(header, 0); // extra length

    const headerBytes = new Uint8Array(header);

    chunks.push(headerBytes, nameBytes, record.compressed);
    offset += headerBytes.length + nameBytes.length + record.compressed.length;
    records.push(record);
  }

  const centralDirectoryOffset = offset;
  const centralChunks: Uint8Array[] = [];
  let centralSize = 0;

  for (const record of records) {
    const central: number[] = [];

    writeUint32(central, 0x02014b50);
    writeUint16(central, 20); // version made by
    writeUint16(central, 20); // version needed
    writeUint16(central, 0); // flags
    writeUint16(central, record.method);
    writeUint16(central, 0); // mod time
    writeUint16(central, 0x21); // mod date
    writeUint32(central, record.crc);
    writeUint32(central, record.compressed.length);
    writeUint32(central, record.uncompressedSize);
    writeUint16(central, record.nameBytes.length);
    writeUint16(central, 0); // extra length
    writeUint16(central, 0); // comment length
    writeUint16(central, 0); // disk number
    writeUint16(central, 0); // internal attrs
    writeUint32(central, 0); // external attrs
    writeUint32(central, record.localHeaderOffset);

    const centralBytes = new Uint8Array(central);

    centralChunks.push(centralBytes, record.nameBytes);
    centralSize += centralBytes.length + record.nameBytes.length;
  }

  const eocd: number[] = [];

  writeUint32(eocd, 0x06054b50);
  writeUint16(eocd, 0); // disk number
  writeUint16(eocd, 0); // central directory start disk
  writeUint16(eocd, records.length);
  writeUint16(eocd, records.length);
  writeUint32(eocd, centralSize);
  writeUint32(eocd, centralDirectoryOffset);
  writeUint16(eocd, 0); // comment length

  const allChunks = [...chunks, ...centralChunks, new Uint8Array(eocd)];
  const totalLength = allChunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const bytes = new Uint8Array(totalLength);
  let cursor = 0;

  for (const chunk of allChunks) {
    bytes.set(chunk, cursor);
    cursor += chunk.length;
  }

  return bytes;
}

/** A zip carrying a single zero-filled payload of exactly the given size. */
export function zipWithPayloadOfSize(entryName: string, size: number): Uint8Array {
  return zipFileBytes([{ name: entryName, data: new Uint8Array(size) }]);
}

/** A zip carrying `count` empty entries (for file-count fixtures). */
export function zipWithEmptyEntries(count: number): Uint8Array {
  const entries: IZipEntrySpec[] = [];

  for (let i = 0; i < count; i++) {
    entries.push({ name: `entries/harness_${i.toString().padStart(5, "0")}.bin`, data: new Uint8Array(0) });
  }

  return zipFileBytes(entries);
}
