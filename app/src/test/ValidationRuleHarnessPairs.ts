// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Coverage pairs for the paired E2E validation-rule harness
 * (ValidationRuleHarness.ts). This module keeps the original four
 * representative pairs — one per generator category: project-level
 * (CHKMANIF), manager-backed (MINENGINEVER), project-item-level (UNKJSON),
 * and file-level (NOBOM) — and aggregates the per-family coverage tables
 * from ./validationRulePairs/ into the ValidationRuleCoveragePairs list the
 * harness suite runs.
 *
 * Every pair builds its accepting and rejecting fixtures from one shared
 * base via coveragePairFromBase, so the two projects differ only in the
 * condition under test.
 */

import { InfoItemType } from "../info/IInfoItemData";
import { ProjectInfoSuite } from "../info/IProjectInfoData";
import { ValidationFixtureFiles, ValidationRuleCoveragePair } from "./ValidationRuleHarness";
import {
  ICoveragePairSideSpec,
  ICoveragePairSpec,
  coveragePairFromBase,
} from "./validationRulePairs/PairFixtureBuilders";
import { ManifestRulePairs } from "./validationRulePairs/ManifestRulePairs";
import { VersionRulePairs } from "./validationRulePairs/VersionRulePairs";
import { TextureRulePairs } from "./validationRulePairs/TextureRulePairs";
import { SkinPackRulePairs } from "./validationRulePairs/SkinPackRulePairs";
import { WorldRulePairs } from "./validationRulePairs/WorldRulePairs";
import { PackLimitRulePairs } from "./validationRulePairs/PackLimitRulePairs";
import { MultiPackRulePairs } from "./validationRulePairs/MultiPackRulePairs";
import { ItemFileRulePairs } from "./validationRulePairs/ItemFileRulePairs";
import { LanguageSoundRulePairs } from "./validationRulePairs/LanguageSoundRulePairs";
import { PackReferenceRulePairs } from "./validationRulePairs/PackReferenceRulePairs";
import { ResourceAssetRulePairs } from "./validationRulePairs/ResourceAssetRulePairs";
import { SchemaRulePairs } from "./validationRulePairs/SchemaRulePairs";
import { PolicyIntegrityRulePairs } from "./validationRulePairs/PolicyIntegrityRulePairs";
import { ScriptModuleRulePairs } from "./validationRulePairs/ScriptModuleRulePairs";
import { BlocksCatalogRulePairs } from "./validationRulePairs/BlocksCatalogRulePairs";
import { EntityTypeRulePairs } from "./validationRulePairs/EntityTypeRulePairs";
import { ItemTypeRulePairs } from "./validationRulePairs/ItemTypeRulePairs";

export { coveragePairFromBase };
export type { ICoveragePairSideSpec, ICoveragePairSpec };

const BpManifestPath = "behavior_packs/test_bp/manifest.json";
const BpMiscJsonPath = "behavior_packs/test_bp/misc/notes.json";

const CurrentMinEngineVersion: readonly number[] = [1, 26, 0];

function behaviorPackManifest(options: { formatVersion: number; minEngineVersion: readonly number[] }): string {
  return JSON.stringify(
    {
      format_version: options.formatVersion,
      header: {
        name: "Validation Harness BP",
        description: "Generated behavior pack for the paired validation rule harness",
        uuid: "0f3a9f1e-4b2d-4c6a-8f5e-1a2b3c4d5e6f",
        version: [1, 0, 0],
        min_engine_version: options.minEngineVersion,
      },
      modules: [
        {
          type: "data",
          uuid: "7c8d9e0f-1a2b-4c3d-8e4f-5a6b7c8d9e0f",
          version: [1, 0, 0],
        },
      ],
    },
    undefined,
    2
  );
}

/** Prepends the UTF-8 byte order mark to text and returns the raw bytes. */
export function withUtf8ByteOrderMark(text: string): Uint8Array {
  const textBytes = new TextEncoder().encode(text);
  const bytes = new Uint8Array(3 + textBytes.length);

  bytes.set([0xef, 0xbb, 0xbf], 0);
  bytes.set(textBytes, 3);

  return bytes;
}

const minimalBehaviorPack: ValidationFixtureFiles = {
  [BpManifestPath]: behaviorPackManifest({ formatVersion: 2, minEngineVersion: CurrentMinEngineVersion }),
};

/**
 * Project-level generator: CHKMANIF:101 (invalidFormatVersion). The rejecting
 * manifest declares format_version 99, which is outside the valid set; the
 * result carries the offending version as structured data.
 */
export const checkManifestFormatVersionPair: ValidationRuleCoveragePair = coveragePairFromBase({
  ruleKey: "CHKMANIF:101",
  category: "project",
  suite: ProjectInfoSuite.currentPlatformVersions,
  baseFiles: minimalBehaviorPack,
  accepting: {
    id: "harness-chkmanif-format-valid",
    description: "Behavior pack manifest with valid format_version 2; CHKMANIF:101 must stay quiet.",
  },
  rejecting: {
    id: "harness-chkmanif-format-unknown",
    description: "Behavior pack manifest with unknown format_version 99; CHKMANIF:101 must flag it.",
    files: {
      [BpManifestPath]: behaviorPackManifest({ formatVersion: 99, minEngineVersion: CurrentMinEngineVersion }),
    },
  },
  rejectingExpectation: {
    severity: InfoItemType.error,
    count: 1,
    data: 99,
  },
});

/**
 * Manager-backed generator: MINENGINEVER:120 (BP min_engine_version minor
 * lower than current). Relies on the pinned test Minecraft version
 * (TestVersionPin, 1.26.x) so 1.19.0 is deterministically too old — the
 * effective previous minor of 1.26 is 1.21 because 1.22–1.25 were skipped
 * (see core/versioning/MinecraftVersionRules.ts).
 */
export const minEngineVersionMinorTooLowPair: ValidationRuleCoveragePair = coveragePairFromBase({
  ruleKey: "MINENGINEVER:120",
  category: "manager",
  suite: ProjectInfoSuite.currentPlatformVersions,
  baseFiles: minimalBehaviorPack,
  accepting: {
    id: "harness-minenginever-current",
    description: "Behavior pack min_engine_version on the current minor; MINENGINEVER:120 must stay quiet.",
  },
  rejecting: {
    id: "harness-minenginever-minor-low",
    description: "Behavior pack min_engine_version behind the N-1 minor window; MINENGINEVER:120 must flag it.",
    files: {
      [BpManifestPath]: behaviorPackManifest({ formatVersion: 2, minEngineVersion: [1, 19, 0] }),
    },
  },
  rejectingExpectation: {
    severity: InfoItemType.error,
    count: 1,
    projectPath: /manifest\.json$/,
    message: "has a lower minor version number",
  },
});

/**
 * Project-item-level generator: UNKJSON:101 (unknown JSON structure). The
 * accepting twin keeps the same file path but with content whose root key
 * infers a known item type; the rejecting twin's content is unrecognizable.
 */
export const unknownJsonItemPair: ValidationRuleCoveragePair = coveragePairFromBase({
  ruleKey: "UNKJSON:101",
  category: "projectItem",
  suite: ProjectInfoSuite.defaultInDevelopment,
  baseFiles: minimalBehaviorPack,
  accepting: {
    id: "harness-unkjson-recognized",
    description: "Misc JSON whose minecraft:loot_table root key infers a known type; UNKJSON:101 must stay quiet.",
    files: {
      [BpMiscJsonPath]: JSON.stringify({ "minecraft:loot_table": { pools: [] } }, undefined, 2),
    },
  },
  rejecting: {
    id: "harness-unkjson-unknown",
    description: "Misc JSON with an unrecognizable structure; UNKJSON:101 must flag it.",
    files: {
      [BpMiscJsonPath]: JSON.stringify({ mct_harness_notes: { reviewed: true } }, undefined, 2),
    },
  },
  rejectingExpectation: {
    severity: InfoItemType.error,
    count: 1,
    projectPath: /notes\.json$/,
    message: "Unknown JSON file found",
  },
});

/**
 * File-level generator: NOBOM:101 (no byte order mark in JSON files). The
 * fixtures differ only in the three BOM bytes at the start of one file.
 */
const miscJsonText = JSON.stringify({ mct_harness_notes: { reviewed: true } }, undefined, 2);

export const noByteOrderMarkPair: ValidationRuleCoveragePair = coveragePairFromBase({
  ruleKey: "NOBOM:101",
  category: "file",
  suite: ProjectInfoSuite.defaultInDevelopment,
  baseFiles: minimalBehaviorPack,
  accepting: {
    id: "harness-nobom-clean",
    description: "JSON file without a byte order mark; NOBOM:101 must stay quiet.",
    files: {
      [BpMiscJsonPath]: miscJsonText,
    },
  },
  rejecting: {
    id: "harness-nobom-bom",
    description: "The same JSON file with a UTF-8 byte order mark prepended; NOBOM:101 must flag it.",
    files: {
      [BpMiscJsonPath]: withUtf8ByteOrderMark(miscJsonText),
    },
  },
  rejectingExpectation: {
    severity: InfoItemType.error,
    count: 1,
    message: "Byte Order Marks found in file: notes.json",
  },
});

/** Every coverage pair the harness suite verifies. */
export const ValidationRuleCoveragePairs: readonly ValidationRuleCoveragePair[] = [
  checkManifestFormatVersionPair,
  minEngineVersionMinorTooLowPair,
  unknownJsonItemPair,
  noByteOrderMarkPair,
  ...ManifestRulePairs,
  ...VersionRulePairs,
  ...TextureRulePairs,
  ...SkinPackRulePairs,
  ...WorldRulePairs,
  ...PackLimitRulePairs,
  ...MultiPackRulePairs,
  ...PackReferenceRulePairs,
  ...LanguageSoundRulePairs,
  ...ResourceAssetRulePairs,
  ...ItemFileRulePairs,
  ...SchemaRulePairs,
  ...PolicyIntegrityRulePairs,
  ...ScriptModuleRulePairs,
  ...BlocksCatalogRulePairs,
  ...EntityTypeRulePairs,
  ...ItemTypeRulePairs,
];
