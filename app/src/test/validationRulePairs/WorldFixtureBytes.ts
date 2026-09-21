// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * WorldFixtureBytes — runtime byte builders for LevelDB-backed world
 * fixtures. Everything is generated with the same production classes that
 * read the data back (WorldLevelDat and NbtBinary author the NBT payloads),
 * so no binary world assets are checked in for the paired validation-rule
 * fixtures.
 *
 * LevelDB write-ahead-log framing (https://github.com/google/leveldb/blob/
 * main/doc/log_format.md): records of [crc32c:4][length:2 LE][type:1]
 * followed by a WriteBatch payload of [sequence:8 LE][count:4 LE] and, per
 * entry, [1 (live)][varint keyLen][key][varint valueLen][value]. The MCT
 * reader (LevelDb.parseLogContent) does not verify checksums, and the
 * sample worlds ship log-only databases, so a single FULL record per batch
 * is a fully readable database. The companion CURRENT/MANIFEST files are
 * copied from the checked-in aop_mobwt sample world, whose manifest points
 * at log number 3 — synthesized logs are therefore named 000003.log.
 */

import * as fs from "fs";
import * as path from "path";
import NbtBinary from "../../minecraft/NbtBinary";
import { NbtTagType } from "../../minecraft/NbtBinaryTag";
import WorldLevelDat from "../../minecraft/WorldLevelDat";
import TestPaths from "../TestPaths";

const SampleDbRoot = path.join(TestPaths.sampleContentRoot, "world", "build", "world_templates", "aop_mobwt", "db");

/** db/CURRENT bytes from the checked-in sample world (points at MANIFEST-000002). */
export function sampleDbCurrentBytes(): Uint8Array {
  return new Uint8Array(fs.readFileSync(path.join(SampleDbRoot, "CURRENT")));
}

/** db/MANIFEST-000002 bytes from the checked-in sample world (declares log 3). */
export function sampleDbManifestBytes(): Uint8Array {
  return new Uint8Array(fs.readFileSync(path.join(SampleDbRoot, "MANIFEST-000002")));
}

/** Minimal, well-formed level.dat bytes authored via WorldLevelDat. */
export function levelDatBytes(levelName: string): Uint8Array {
  const levelDat = new WorldLevelDat();

  levelDat.context = levelName;
  levelDat.ensureDefaults();
  levelDat.levelName = levelName;
  levelDat.persist();

  const bytes = levelDat.getBytes();

  if (!bytes) {
    throw new Error("Could not author level.dat fixture bytes.");
  }

  return bytes;
}

function writeVarint(target: number[], value: number) {
  let remaining = value;

  while (remaining >= 0x80) {
    target.push((remaining & 0x7f) | 0x80);
    remaining >>>= 7;
  }

  target.push(remaining);
}

export interface ILevelDbLogEntry {
  readonly key: Uint8Array | string;
  readonly value: Uint8Array;
}

/**
 * Serializes entries into a single-FULL-record LevelDB write-ahead log. The
 * combined payload must fit one 32 KiB log block (minus headers), which is
 * ample for fixture-sized batches; oversized batches throw rather than
 * silently producing an unreadable file.
 */
export function levelDbLogBytes(entries: readonly ILevelDbLogEntry[], startSequence: number = 1): Uint8Array {
  const payload: number[] = [];

  // WriteBatch header: 8-byte little-endian sequence, 4-byte entry count.
  let sequence = BigInt(startSequence);
  for (let i = 0; i < 8; i++) {
    payload.push(Number(sequence & 0xffn));
    sequence >>= 8n;
  }

  let count = entries.length;
  for (let i = 0; i < 4; i++) {
    payload.push(count & 0xff);
    count >>>= 8;
  }

  for (const entry of entries) {
    const keyBytes =
      typeof entry.key === "string" ? new Uint8Array([...entry.key].map((char) => char.charCodeAt(0))) : entry.key;

    payload.push(1); // live (put) record
    writeVarint(payload, keyBytes.length);
    payload.push(...keyBytes);
    writeVarint(payload, entry.value.length);
    payload.push(...entry.value);
  }

  if (payload.length > 32768 - 7) {
    throw new Error(`LevelDB log fixture batch of ${payload.length} bytes exceeds a single 32 KiB log block.`);
  }

  const bytes = new Uint8Array(7 + payload.length);

  // Bytes 0-3: crc32c (unverified by the reader; left zero).
  bytes[4] = payload.length & 0xff;
  bytes[5] = (payload.length >> 8) & 0xff;
  bytes[6] = 1; // FULL record
  bytes.set(payload, 7);

  return bytes;
}

function writeInt32LE(target: Uint8Array, offset: number, value: number) {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >> 8) & 0xff;
  target[offset + 2] = (value >> 16) & 0xff;
  target[offset + 3] = (value >> 24) & 0xff;
}

/**
 * A LevelDB chunk-record key: [x:4 LE][z:4 LE] then, for non-Overworld
 * dimensions, [dimension:4 LE], then the record tag byte (see
 * WorldDataMetricsReducer.LevelChunkTags; 49 = block entity data).
 */
export function chunkRecordKey(x: number, z: number, dimension: number, tag: number): Uint8Array {
  const hasDimension = dimension !== 0;
  const bytes = new Uint8Array(hasDimension ? 13 : 9);

  writeInt32LE(bytes, 0, x);
  writeInt32LE(bytes, 4, z);

  if (hasDimension) {
    writeInt32LE(bytes, 8, dimension);
  }

  bytes[hasDimension ? 12 : 8] = tag;

  return bytes;
}

/** NBT payload for one command block actor (block entity tag 49). */
export function commandBlockActorNbtBytes(spec: {
  x: number;
  y: number;
  z: number;
  command: string;
  version: number;
}): Uint8Array {
  const nbt = new NbtBinary();

  nbt.ensureSingleRoot();

  const root = nbt.singleRoot;

  if (!root) {
    throw new Error("Could not create command block actor NBT root.");
  }

  root.addTag(NbtTagType.string, "id").value = "CommandBlock";
  root.addTag(NbtTagType.string, "Command").value = spec.command;
  root.addTag(NbtTagType.int, "Version").value = spec.version;
  root.addTag(NbtTagType.int, "x").value = spec.x;
  root.addTag(NbtTagType.int, "y").value = spec.y;
  root.addTag(NbtTagType.int, "z").value = spec.z;

  const bytes = nbt.toBinary();

  if (!bytes) {
    throw new Error("Could not serialize command block actor NBT.");
  }

  return bytes;
}

/** NBT payload for the DimensionNameIdTable key: name → dimension id ints. */
export function dimensionNameIdTableBytes(mappings: Record<string, number>): Uint8Array {
  const nbt = new NbtBinary();

  nbt.ensureSingleRoot();

  const root = nbt.singleRoot;

  if (!root) {
    throw new Error("Could not create DimensionNameIdTable NBT root.");
  }

  for (const [name, id] of Object.entries(mappings)) {
    root.addTag(NbtTagType.int, name).value = id;
  }

  const bytes = nbt.toBinary();

  if (!bytes) {
    throw new Error("Could not serialize DimensionNameIdTable NBT.");
  }

  return bytes;
}

/**
 * Files for a world folder backed by a synthesized log-only LevelDB. The
 * returned map is ready to spread into a fixture recipe under `root`.
 */
export function worldFolderFiles(
  root: string,
  levelName: string,
  logEntries: readonly ILevelDbLogEntry[]
): { [relativePath: string]: string | Uint8Array } {
  return {
    [`${root}/level.dat`]: levelDatBytes(levelName),
    [`${root}/levelname.txt`]: levelName,
    [`${root}/db/CURRENT`]: sampleDbCurrentBytes(),
    [`${root}/db/MANIFEST-000002`]: sampleDbManifestBytes(),
    [`${root}/db/000003.log`]: levelDbLogBytes(logEntries),
  };
}
