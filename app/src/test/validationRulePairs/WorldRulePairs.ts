// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * WorldRulePairs — paired E2E coverage for WORLDDATA (command validation
 * across mcfunctions and LevelDB command-block actors, plus world load
 * errors) and CDWORLDDATA (custom-dimension LevelDB policy rules).
 *
 * Every LevelDB-backed fixture uses a representative log-only database
 * synthesized at test time by WorldFixtureBytes (level.dat + db/ with real
 * chunk-record keys), so the rules run against genuine LevelDB parsing
 * rather than mocks. The command-block version boundary is exercised
 * exactly: version 33 (the modern floor) accepts, version 32 rejects.
 */

import { InfoItemType } from "../../info/IInfoItemData";
import { ProjectInfoSuite } from "../../info/IProjectInfoData";
import { ValidationRuleCoveragePair, ValidationFixtureFiles } from "../ValidationRuleHarness";
import {
  BpRoot,
  bpManifest,
  coveragePairFromBase,
  minimalBpFiles,
  minimalRpFiles,
  rpManifest,
} from "./PairFixtureBuilders";
import {
  chunkRecordKey,
  commandBlockActorNbtBytes,
  dimensionNameIdTableBytes,
  levelDbLogBytes,
  worldFolderFiles,
} from "./WorldFixtureBytes";

const McFunctionPath = `${BpRoot}/functions/harness.mcfunction`;
const WorldRoot = "worlds/harness_world";
const WorldLogPath = `${WorldRoot}/db/000003.log`;

/** The modern command version WORLDDATA compares command blocks against. */
const ModernCommandVersion = 33;

const commandBlockLog = (version: number) =>
  levelDbLogBytes([
    {
      key: chunkRecordKey(0, 0, 0, 49),
      value: commandBlockActorNbtBytes({ x: 1, y: 5, z: 1, command: "say harness", version }),
    },
  ]);

const addOnPackOptions = {
  metadata: { product_type: "addon" },
  headerExtras: { pack_scope: "world" },
};

/** BP+RP manifests shaped so the project classifies as an add-on. */
const addOnManifests: ValidationFixtureFiles = {
  ...minimalBpFiles(bpManifest(addOnPackOptions)),
  ...minimalRpFiles(rpManifest(addOnPackOptions)),
};

const overworldChunkEntry = { key: chunkRecordKey(0, 0, 0, 44), value: new Uint8Array([40]) };
const customDimensionChunkEntry = { key: chunkRecordKey(0, 0, 1000, 44), value: new Uint8Array([40]) };
const nameIdTableEntry = (mappings: Record<string, number>) => ({
  key: "DimensionNameIdTable",
  value: dimensionNameIdTableBytes(mappings),
});

export const WorldRulePairs: readonly ValidationRuleCoveragePair[] = [
  coveragePairFromBase({
    ruleKey: "WORLDDATA:102",
    category: "projectItem",
    suite: ProjectInfoSuite.defaultInDevelopment,
    baseFiles: minimalBpFiles(),
    accepting: {
      id: "harness-worlddata-command-accept",
      description: "mcfunction using only built-in commands; WORLDDATA:102 must stay quiet.",
      files: { [McFunctionPath]: "say harness\n" },
    },
    rejecting: {
      id: "harness-worlddata-command-reject",
      description: "mcfunction invoking an unknown command; WORLDDATA:102 must flag it.",
      files: { [McFunctionPath]: "blorf harness\n" },
    },
    rejectingExpectation: {
      severity: InfoItemType.error,
      count: 1,
      projectPath: /harness\.mcfunction$/,
      message: "Unexpected command 'blorf'",
      data: "blorf",
    },
  }),

  coveragePairFromBase({
    ruleKey: "WORLDDATA:112",
    category: "projectItem",
    suite: ProjectInfoSuite.cooperativeAddOn,
    baseFiles: minimalBpFiles(),
    accepting: {
      id: "harness-worlddata-impacting-accept",
      description: "mcfunction without world-impacting commands; WORLDDATA:112 must stay quiet.",
      files: { [McFunctionPath]: "say harness\n" },
    },
    rejecting: {
      id: "harness-worlddata-impacting-reject",
      description: "mcfunction invoking the world-impacting 'alwaysday' command; WORLDDATA:112 must warn.",
      files: { [McFunctionPath]: "alwaysday true\n" },
    },
    rejectingExpectation: {
      severity: InfoItemType.warning,
      count: 1,
      projectPath: /harness\.mcfunction$/,
      message: "impacts the state of the entire world",
      data: "alwaysday",
    },
  }),

  coveragePairFromBase({
    ruleKey: "WORLDDATA:212",
    category: "projectItem",
    suite: ProjectInfoSuite.defaultInDevelopment,
    baseFiles: worldFolderFiles(WorldRoot, "Harness Command World", [
      { key: chunkRecordKey(0, 0, 0, 44), value: new Uint8Array([40]) },
    ]),
    accepting: {
      id: "harness-worlddata-command-version-accept",
      description:
        "LevelDB command block at command version 33 (the modern floor); WORLDDATA:212 must stay quiet.",
      files: { [WorldLogPath]: commandBlockLog(ModernCommandVersion) },
    },
    rejecting: {
      id: "harness-worlddata-command-version-reject",
      description: "LevelDB command block at command version 32; WORLDDATA:212 must recommend updating.",
      files: { [WorldLogPath]: commandBlockLog(ModernCommandVersion - 1) },
    },
    rejectingExpectation: {
      severity: InfoItemType.recommendation,
      count: 1,
      message: "is from an older Minecraft version (32)",
      data: "(Command at location 1, 5, 1)",
    },
  }),

  coveragePairFromBase({
    ruleKey: "WORLDDATA:400",
    category: "projectItem",
    suite: ProjectInfoSuite.defaultInDevelopment,
    baseFiles: worldFolderFiles(WorldRoot, "Harness Error World", [overworldChunkEntry]),
    accepting: {
      id: "harness-worlddata-world-error-accept",
      description: "World whose LevelDB log parses cleanly; WORLDDATA:400 must stay quiet.",
      files: { [WorldLogPath]: levelDbLogBytes([overworldChunkEntry]) },
    },
    rejecting: {
      id: "harness-worlddata-world-error-reject",
      description: "World whose LevelDB log is unreadable; WORLDDATA:400 must flag the load error.",
      files: { [WorldLogPath]: new Uint8Array(64).fill(0xab) },
    },
    rejectingExpectation: {
      severity: InfoItemType.error,
      count: 1,
      message: "Error Processing World",
    },
  }),

  coveragePairFromBase({
    ruleKey: "CDWORLDDATA:101",
    category: "projectItem",
    suite: ProjectInfoSuite.defaultInDevelopment,
    baseFiles: worldFolderFiles(WorldRoot, "Harness Dimension World", [customDimensionChunkEntry]),
    accepting: {
      id: "harness-cdworlddata-name-table-accept",
      description:
        "Custom-dimension chunk data with the DimensionNameIdTable present; CDWORLDDATA:101 must stay quiet.",
      files: {
        [WorldLogPath]: levelDbLogBytes([customDimensionChunkEntry, nameIdTableEntry({ harness_dim: 1000 })]),
      },
    },
    rejecting: {
      id: "harness-cdworlddata-name-table-reject",
      description:
        "Custom-dimension chunk data without a DimensionNameIdTable; CDWORLDDATA:101 must flag the missing table.",
      files: { [WorldLogPath]: levelDbLogBytes([customDimensionChunkEntry]) },
    },
    rejectingExpectation: {
      severity: InfoItemType.error,
      count: 1,
      message: "missing the required DimensionNameIdTable",
    },
  }),

  coveragePairFromBase({
    ruleKey: "CDWORLDDATA:102",
    category: "projectItem",
    suite: ProjectInfoSuite.defaultInDevelopment,
    baseFiles: {
      ...addOnManifests,
      ...worldFolderFiles(WorldRoot, "Harness AddOn World", [customDimensionChunkEntry]),
    },
    accepting: {
      id: "harness-cdworlddata-vanilla-chunks-accept",
      description:
        "Add-on world containing only custom-dimension chunk data; CDWORLDDATA:102 must stay quiet.",
      files: {
        [WorldLogPath]: levelDbLogBytes([customDimensionChunkEntry, nameIdTableEntry({ harness_dim: 1000 })]),
      },
    },
    rejecting: {
      id: "harness-cdworlddata-vanilla-chunks-reject",
      description: "Add-on world containing Overworld chunk data; CDWORLDDATA:102 must flag it.",
      files: {
        [WorldLogPath]: levelDbLogBytes([
          customDimensionChunkEntry,
          overworldChunkEntry,
          nameIdTableEntry({ harness_dim: 1000 }),
        ]),
      },
    },
    rejectingExpectation: {
      severity: InfoItemType.error,
      count: 1,
      message: "vanilla dimension 'Overworld' (ID 0)",
      data: 0,
    },
  }),

  coveragePairFromBase({
    ruleKey: "CDWORLDDATA:103",
    category: "projectItem",
    suite: ProjectInfoSuite.defaultInDevelopment,
    baseFiles: worldFolderFiles(WorldRoot, "Harness Mapping World", [customDimensionChunkEntry]),
    accepting: {
      id: "harness-cdworlddata-unclaimed-accept",
      description:
        "DimensionNameIdTable mappings all backed by chunk data; CDWORLDDATA:103 must stay quiet.",
      files: {
        [WorldLogPath]: levelDbLogBytes([customDimensionChunkEntry, nameIdTableEntry({ harness_dim: 1000 })]),
      },
    },
    rejecting: {
      id: "harness-cdworlddata-unclaimed-reject",
      description:
        "DimensionNameIdTable mapping a dimension with no chunk data; CDWORLDDATA:103 must warn about it.",
      files: {
        [WorldLogPath]: levelDbLogBytes([
          customDimensionChunkEntry,
          nameIdTableEntry({ harness_dim: 1000, harness_ghost: 1001 }),
        ]),
      },
    },
    rejectingExpectation: {
      severity: InfoItemType.warning,
      count: 1,
      message: "no corresponding chunk data",
      data: "harness_ghost",
    },
  }),
];
