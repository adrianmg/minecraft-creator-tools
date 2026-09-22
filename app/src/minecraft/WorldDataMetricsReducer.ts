// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import DataUtilities from "../core/DataUtilities";
import type { ILevelDbParsedRecord } from "./LevelDb";

export interface IWorldDataMetrics {
  chunkCount: number;
  customDimensionChunkCount: number;
  subchunkLessChunkCount: number;
  minX?: number;
  maxX?: number;
  minZ?: number;
  maxZ?: number;
  dimensionIds: Set<number>;
  hasDimensionNameIdTable: boolean;
  dimensionNameIdTableBytes?: Uint8Array;
}

export interface IChunkRecordMetadata {
  chunkKey: string;
  dimension: number;
  x: number;
  z: number;
  hasSubchunk: boolean;
  includeInWorldMetrics: boolean;
}

const LevelChunkTags = new Set<number>([
  43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 72, 115, 118, 119,
  120,
]);

const SubchunkPrefixTag = 47;

const NamedWorldRecordPrefixes = [
  "AutonomousEntities",
  "schedulerWT",
  "Overworld",
  "BiomeData",
  "digp",
  "actorprefix",
  "player",
  "portals",
  "LevelChunk",
  "structuretemplate",
  "~local_player",
  "game_",
  "CustomProperties",
  "DynamicProperties",
  "LevelSpawnWasFixed",
  "VILLAGE_",
  "gametestinstance_",
  "tickingarea_",
  "map_",
  "scoreboard",
  "SavedEntity",
  "ServerMapRuntime",
  "VillageRuntime",
  "WorldFeatureRuntime",
  "WorldGenerationRuntime",
  "WorldStreamRuntime",
  "BSharpRuntime",
  "BadgerSynced",
  "CinematicsRuntime",
  "CustomGameOptions",
  "DeckRuntime",
  "EntityFactorySetup",
  "GeologyRuntime",
  "InvasionRuntime",
  "MapRevealRuntime",
  "RealmsStoriesData",
  "mobevents",
  "dimension",
  "structureplacement",
  "chunk_loaded_request",
  "legacy_console_player",
  "PosTrackDB",
  "PositionTrackDB",
  "OwnedEntitiesLimbo",
  "MCeditMap",
  "EDU_CurrentCodingURL",
  "TheEnd",
  "SST_",
  "SUSP",
  "neteaseData",
  "scriptGid",
  "Nether",
  "game_flatworldlayers",
];

export default class WorldDataMetricsReducer {
  private _effectiveRecordsByKey = new Map<string, IChunkRecordMetadata>();
  private _recordVersionsByKey = new Map<string, { sourceKind: "ldb" | "log"; sequenceNumber?: bigint }>();
  private _hasDimensionNameIdTable = false;
  private _dimensionNameIdTableBytes?: Uint8Array;

  visit(record: ILevelDbParsedRecord) {
    if (record.key === "DimensionNameIdTable") {
      if (!this._shouldApplyRecord(record, record.key)) {
        return;
      }

      this._hasDimensionNameIdTable = !record.isDeleted;
      this._dimensionNameIdTableBytes =
        !record.isDeleted && record.value ? new Uint8Array(record.value) : undefined;
      return;
    }

    if (WorldDataMetricsReducer.isNamedWorldRecordKey(record.key)) {
      return;
    }

    const metadata = WorldDataMetricsReducer.getChunkRecordMetadata(record.keyBytes);

    if (!metadata) {
      return;
    }

    const identity = WorldDataMetricsReducer.getRecordIdentity(record.keyBytes);
    if (!this._shouldApplyRecord(record, identity)) {
      return;
    }

    if (record.isDeleted) {
      this._effectiveRecordsByKey.delete(identity);
    } else {
      this._effectiveRecordsByKey.set(identity, metadata);
    }
  }

  private _shouldApplyRecord(record: ILevelDbParsedRecord, identity: string): boolean {
    const currentVersion = this._recordVersionsByKey.get(identity);
    const sequenceNumber = record.sequenceNumber === undefined ? undefined : BigInt(record.sequenceNumber);

    if (
      sequenceNumber !== undefined &&
      currentVersion?.sequenceNumber !== undefined &&
      currentVersion.sequenceNumber >= sequenceNumber
    ) {
      return false;
    }

    this._recordVersionsByKey.set(identity, { sourceKind: record.sourceKind, sequenceNumber });
    return true;
  }

  getMetrics(): IWorldDataMetrics {
    const chunks = new Map<string, { x: number; z: number; hasSubchunk: boolean }>();
    const customDimensionChunks = new Set<string>();
    const dimensionIds = new Set<number>();

    for (const metadata of this._effectiveRecordsByKey.values()) {
      dimensionIds.add(metadata.dimension);

      if (metadata.dimension >= 1000) {
        customDimensionChunks.add(metadata.chunkKey);
      }

      if (!metadata.includeInWorldMetrics) {
        continue;
      }

      let chunk = chunks.get(metadata.chunkKey);

      if (!chunk) {
        chunk = { x: metadata.x, z: metadata.z, hasSubchunk: false };
        chunks.set(metadata.chunkKey, chunk);
      }

      if (metadata.hasSubchunk) {
        chunk.hasSubchunk = true;
      }
    }

    const metrics: IWorldDataMetrics = {
      chunkCount: chunks.size,
      customDimensionChunkCount: customDimensionChunks.size,
      subchunkLessChunkCount: 0,
      dimensionIds,
      hasDimensionNameIdTable: this._hasDimensionNameIdTable,
      dimensionNameIdTableBytes: this._dimensionNameIdTableBytes,
    };

    for (const chunk of chunks.values()) {
      if (!chunk.hasSubchunk) {
        metrics.subchunkLessChunkCount++;
      }

      const minX = chunk.x * 16;
      const maxX = (chunk.x + 1) * 16;
      const minZ = chunk.z * 16;
      const maxZ = (chunk.z + 1) * 16;

      metrics.minX = metrics.minX === undefined ? minX : Math.min(metrics.minX, minX);
      metrics.maxX = metrics.maxX === undefined ? maxX : Math.max(metrics.maxX, maxX);
      metrics.minZ = metrics.minZ === undefined ? minZ : Math.min(metrics.minZ, minZ);
      metrics.maxZ = metrics.maxZ === undefined ? maxZ : Math.max(metrics.maxZ, maxZ);
    }

    return metrics;
  }

  static getMetricsForRecords(records: Iterable<ILevelDbParsedRecord>): IWorldDataMetrics {
    const reducer = new WorldDataMetricsReducer();

    for (const record of records) {
      reducer.visit(record);
    }

    return reducer.getMetrics();
  }

  static isNamedWorldRecordKey(key: string): boolean {
    return (
      NamedWorldRecordPrefixes.some((prefix) => key.startsWith(prefix)) ||
      key.includes("WasPicked") ||
      key.includes("TextIg")
    );
  }

  static getChunkRecordMetadata(keyBytes: Uint8Array): IChunkRecordMetadata | undefined {
    if (keyBytes.length !== 9 && keyBytes.length !== 10 && keyBytes.length !== 13 && keyBytes.length !== 14) {
      return undefined;
    }

    const hasDimension = keyBytes.length >= 13;
    const tagOffset = hasDimension ? 12 : 8;
    const tag = keyBytes[tagOffset];

    if (!LevelChunkTags.has(tag)) {
      return undefined;
    }

    let dimension = 0;
    let includeInWorldMetrics = true;

    if (hasDimension) {
      dimension = DataUtilities.getSignedInteger(keyBytes[8], keyBytes[9], keyBytes[10], keyBytes[11], true);

      if (dimension < 0) {
        return undefined;
      }

      includeInWorldMetrics = dimension >= 1 && dimension <= 2;
    }

    const x = DataUtilities.getSignedInteger(keyBytes[0], keyBytes[1], keyBytes[2], keyBytes[3], true);
    const z = DataUtilities.getSignedInteger(keyBytes[4], keyBytes[5], keyBytes[6], keyBytes[7], true);

    return {
      chunkKey: `${dimension}_${x}_${z}`,
      dimension,
      x: x,
      z: z,
      hasSubchunk: tag === SubchunkPrefixTag,
      includeInWorldMetrics,
    };
  }

  private static getRecordIdentity(keyBytes: Uint8Array): string {
    let identity = "";

    for (let i = 0; i < keyBytes.length; i++) {
      identity += String.fromCharCode(keyBytes[i]);
    }

    return identity;
  }
}
