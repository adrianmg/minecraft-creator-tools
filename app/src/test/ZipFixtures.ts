// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * ZipFixtures.ts
 *
 * Compact ZIP fixtures for exercising the decompressed-size guard
 * (ZipStorage.loadFromUint8Array -> SecurityUtilities.checkDecompressedSizeLimits) WITHOUT
 * compressing or allocating multi-gigabyte buffers.
 *
 * Why this works: the guard reads JSZip's parsed `_data.uncompressedSize`, and JSZip 3.10.1
 * takes that value verbatim from the ZIP *central directory* (zipEntry.js `readCentralPart`).
 * `readLocalPart` deliberately ignores the local header's own size fields and never
 * cross-checks the declared size against the actual payload before decompression (which is
 * lazy, and the guard throws first). So a few-hundred-byte ZIP that merely *declares* large
 * entries in its central directory trips the exact same code path — and the same HTTP 413 —
 * as a real multi-hundred-MB archive, in milliseconds.
 *
 * `buildSizeSpoofedZip` generates a normal compact ZIP with tiny placeholder content, then
 * overwrites the central-directory `uncompressed size` field for the entries that request a
 * `declaredSize`. Only the 32-bit field is patched, so every declared size must stay under
 * 4 GiB (no ZIP64) — which the callers' multi-hundred-MB / low-GB fixtures satisfy.
 */

import JSZip from "jszip";

// ZIP record signatures (little-endian uint32).
const END_OF_CENTRAL_DIR_SIGNATURE = 0x06054b50;
const CENTRAL_FILE_HEADER_SIGNATURE = 0x02014b50;

// Offsets within a central-directory file header.
const CENTRAL_UNCOMPRESSED_SIZE_OFFSET = 24;
const CENTRAL_FILE_NAME_LENGTH_OFFSET = 28;
const CENTRAL_EXTRA_FIELD_LENGTH_OFFSET = 30;
const CENTRAL_COMMENT_LENGTH_OFFSET = 32;
const CENTRAL_FILE_NAME_OFFSET = 46;

// Offsets within the End Of Central Directory record.
const EOCD_TOTAL_RECORDS_OFFSET = 10;
const EOCD_CENTRAL_DIR_OFFSET_OFFSET = 16;
const EOCD_MIN_SIZE = 22;

const MAX_32BIT = 0xffffffff;

export interface SpoofedZipEntry {
  path: string;

  /**
   * Uncompressed size to DECLARE in the central directory. When set, only a 1-byte placeholder
   * is actually stored/compressed — the guard reads this declared value, not the real payload.
   * Must be < 4 GiB (32-bit central-directory field; no ZIP64).
   */
  declaredSize?: number;

  /**
   * Real bytes to store for this entry (used when `declaredSize` is omitted, e.g. a small
   * Content/ marker file or README). Defaults to a 1-byte placeholder.
   */
  data?: Uint8Array;
}

/**
 * Builds a compact ZIP whose central-directory uncompressed-size fields are spoofed to the
 * requested (large) values. See the file header for why this exercises the production size
 * guard without any multi-GB runtime compression.
 */
export async function buildSizeSpoofedZip(entries: SpoofedZipEntry[]): Promise<Buffer> {
  const jsz = new JSZip();

  for (const entry of entries) {
    jsz.file(entry.path, entry.data ?? new Uint8Array(1));
  }

  const out = await jsz.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  const buffer = Buffer.from(out);

  const declaredByPath = new Map<string, number>();
  for (const entry of entries) {
    if (entry.declaredSize !== undefined) {
      if (entry.declaredSize < 0 || entry.declaredSize > MAX_32BIT) {
        throw new Error(
          `declaredSize for '${entry.path}' (${entry.declaredSize}) exceeds the 32-bit central-directory field; ZIP64 is not supported here.`
        );
      }
      declaredByPath.set(entry.path, entry.declaredSize);
    }
  }

  if (declaredByPath.size > 0) {
    patchCentralDirectoryUncompressedSizes(buffer, declaredByPath);
  }

  return buffer;
}

/**
 * Overwrites the 4-byte "uncompressed size" field in each central-directory file header whose
 * file name appears in `declaredByPath`. The central directory is walked deterministically from
 * the End Of Central Directory record (rather than scanning for signatures, which could
 * false-match inside compressed data).
 */
function patchCentralDirectoryUncompressedSizes(buffer: Buffer, declaredByPath: Map<string, number>): void {
  let eocdOffset = -1;
  for (let i = buffer.length - EOCD_MIN_SIZE; i >= 0; i--) {
    if (buffer.readUInt32LE(i) === END_OF_CENTRAL_DIR_SIGNATURE) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset === -1) {
    throw new Error("Could not locate the End Of Central Directory record while spoofing zip sizes.");
  }

  const totalRecords = buffer.readUInt16LE(eocdOffset + EOCD_TOTAL_RECORDS_OFFSET);
  let offset = buffer.readUInt32LE(eocdOffset + EOCD_CENTRAL_DIR_OFFSET_OFFSET);

  const remaining = new Set(declaredByPath.keys());

  for (let record = 0; record < totalRecords; record++) {
    if (buffer.readUInt32LE(offset) !== CENTRAL_FILE_HEADER_SIGNATURE) {
      throw new Error(`Malformed central directory: missing header signature at record ${record}.`);
    }

    const fileNameLength = buffer.readUInt16LE(offset + CENTRAL_FILE_NAME_LENGTH_OFFSET);
    const extraFieldLength = buffer.readUInt16LE(offset + CENTRAL_EXTRA_FIELD_LENGTH_OFFSET);
    const commentLength = buffer.readUInt16LE(offset + CENTRAL_COMMENT_LENGTH_OFFSET);
    const fileName = buffer.toString(
      "utf8",
      offset + CENTRAL_FILE_NAME_OFFSET,
      offset + CENTRAL_FILE_NAME_OFFSET + fileNameLength
    );

    const declaredSize = declaredByPath.get(fileName);
    if (declaredSize !== undefined) {
      buffer.writeUInt32LE(declaredSize, offset + CENTRAL_UNCOMPRESSED_SIZE_OFFSET);
      remaining.delete(fileName);
    }

    offset += CENTRAL_FILE_NAME_OFFSET + fileNameLength + extraFieldLength + commentLength;
  }

  if (remaining.size > 0) {
    throw new Error(`Did not find central-directory entries to spoof: ${[...remaining].join(", ")}`);
  }
}
