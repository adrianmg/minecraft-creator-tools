// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * PolicyIntegrityRulePairs — paired E2E coverage for the policy and
 * project-integrity rule families: CBFG (beta-features flags), EXPFLAG
 * (experimental world flags), CHECKFEATUREDEPRECATION (deprecated blocks,
 * terrain-texture entries, and textures), FORBFILE (allowed extensions,
 * blocked names, invalid characters), VANDUPES (vanilla copies, sharingStrict
 * suite), VANPRO (protected vanilla assets), and PRJINT (orphaned files and
 * nested manifests).
 *
 * Generators here emit only on failure and (except FORBFILE, VANPRO, PRJINT
 * and CBFG, which can always process) would report "no applicable items" on a
 * clean accepting fixture, so accepting fixtures keep the generator provably
 * running by tripping a sibling rule of the same generator — the same
 * technique the TEXTURELIST pairs use.
 *
 * Vanilla-duplicate fixtures are deterministic and offline: the vanilla hash
 * catalog (public/data/mch/preview.mch.json) records vanilla wolf.json as the
 * md5 of the exact text "{}" and vanilla blocks.json's "air" property as the
 * md5 of '{}' + 'air', both of which are reproduced from constants below
 * without any checked-in vanilla content.
 */

import { InfoItemType } from "../../info/IInfoItemData";
import { ProjectInfoSuite } from "../../info/IProjectInfoData";
import { ValidationRuleCoveragePair, ValidationFixtureFiles } from "../ValidationRuleHarness";
import WorldLevelDat from "../../minecraft/WorldLevelDat";
import {
  BpRoot,
  RpRoot,
  coveragePairFromBase,
  json,
  minimalBpFiles,
  minimalRpFiles,
  pngBytes,
} from "./PairFixtureBuilders";
import { levelDatBytes, worldFolderFiles } from "./WorldFixtureBytes";
import { zipFileBytes } from "./ZipFixtureBytes";

// ---------------------------------------------------------------------------
// CBFG — beta-features flag checks over behavior JSON (canAlwaysProcess).
// ---------------------------------------------------------------------------

const EntityBehaviorPath = `${BpRoot}/entities/harness_entity.json`;

const entityBehaviorJson = (extras?: Record<string, unknown>) =>
  json({
    format_version: "1.21.0",
    ...extras,
    "minecraft:entity": {
      description: { identifier: "harness:policy_entity" },
      components: {},
    },
  });

const cbfgPairs: readonly ValidationRuleCoveragePair[] = [
  coveragePairFromBase({
    ruleKey: "CBFG:102",
    category: "project",
    suite: ProjectInfoSuite.defaultInDevelopment,
    baseFiles: { ...minimalBpFiles(), [EntityBehaviorPath]: entityBehaviorJson() },
    accepting: {
      id: "harness-cbfg-parse-accept",
      description: "Behavior pack manifest with well-formed JSON; CBFG:102 must stay quiet.",
    },
    rejecting: {
      id: "harness-cbfg-parse-reject",
      description: "Behavior pack manifest with truncated JSON; CBFG:102 must flag the parse failure.",
      files: { "behavior_packs/test_bp/manifest.json": '{ "format_version": 2, "header": {' },
    },
    rejectingExpectation: {
      severity: InfoItemType.error,
      count: 1,
      projectPath: /manifest\.json$/,
      message: "Failed to parse json in file",
      data: "manifest.json",
    },
  }),

  coveragePairFromBase({
    ruleKey: "CBFG:103",
    category: "project",
    suite: ProjectInfoSuite.defaultInDevelopment,
    baseFiles: minimalBpFiles(),
    accepting: {
      id: "harness-cbfg-beta-accept",
      description: "Entity behavior without the use_beta_features flag; CBFG:103 must stay quiet.",
      files: { [EntityBehaviorPath]: entityBehaviorJson() },
    },
    rejecting: {
      id: "harness-cbfg-beta-reject",
      description: "Entity behavior declaring use_beta_features true; CBFG:103 must flag it.",
      files: { [EntityBehaviorPath]: entityBehaviorJson({ use_beta_features: true }) },
    },
    rejectingExpectation: {
      severity: InfoItemType.error,
      count: 1,
      projectPath: /harness_entity\.json$/,
      message: "Using beta features flag in custom definitions is not allowed",
    },
  }),
];

// ---------------------------------------------------------------------------
// EXPFLAG — experimental world flags. The generator emits only on findings,
// so each accepting fixture keeps a sibling-rule anchor firing.
// ---------------------------------------------------------------------------

const ExpWorldRoot = "worlds/harness_experiments_world";
const ExpWorldLevelDatPath = `${ExpWorldRoot}/level.dat`;
const AnchorMcWorldPath = "worlds/harness_anchor.mcworld";

/** level.dat bytes whose experiments_ever_used flag is set. */
function experimentsUsedLevelDatBytes(levelName: string): Uint8Array {
  const levelDat = new WorldLevelDat();

  levelDat.context = levelName;
  levelDat.ensureDefaults();
  levelDat.levelName = levelName;
  levelDat.experimentsEverUsed = true;
  levelDat.persist();

  const bytes = levelDat.getBytes();

  if (!bytes) {
    throw new Error("Could not author experimental level.dat fixture bytes.");
  }

  return bytes;
}

const levelNameEntry = { name: "levelname.txt", data: new TextEncoder().encode("Harness Anchor World") };

/** An .mcworld archive with no level.dat inside; EXPFLAG:102 flags it. */
const mcWorldWithoutLevelDat = zipFileBytes([levelNameEntry]);

/** The same .mcworld archive with a well-formed level.dat inside. */
const mcWorldWithLevelDat = zipFileBytes([
  levelNameEntry,
  { name: "level.dat", data: levelDatBytes("Harness Anchor World") },
]);

const expflagPairs: readonly ValidationRuleCoveragePair[] = [
  coveragePairFromBase({
    ruleKey: "EXPFLAG:101",
    category: "project",
    suite: ProjectInfoSuite.defaultInDevelopment,
    baseFiles: {
      ...minimalBpFiles(),
      // Applicability anchor: this world archive has no level.dat, so
      // EXPFLAG:102 fires on both fixtures and the generator provably runs.
      [AnchorMcWorldPath]: mcWorldWithoutLevelDat,
      ...worldFolderFiles(ExpWorldRoot, "Harness Experiments World", []),
    },
    accepting: {
      id: "harness-expflag-flag-accept",
      description: "World whose level.dat never enabled experiments; EXPFLAG:101 must stay quiet.",
    },
    rejecting: {
      id: "harness-expflag-flag-reject",
      description: "World whose level.dat records experiments_ever_used; EXPFLAG:101 must warn.",
      files: { [ExpWorldLevelDatPath]: experimentsUsedLevelDatBytes("Harness Experiments World") },
    },
    rejectingExpectation: {
      severity: InfoItemType.warning,
      count: 1,
      projectPath: "harness_experiments_world",
      message: "Experimental gameplay is or was enabled",
    },
  }),

  coveragePairFromBase({
    ruleKey: "EXPFLAG:102",
    category: "project",
    suite: ProjectInfoSuite.defaultInDevelopment,
    baseFiles: {
      ...minimalBpFiles(),
      // Applicability anchor: this world's level.dat records experiments, so
      // EXPFLAG:101 fires on both fixtures and the generator provably runs.
      ...worldFolderFiles(ExpWorldRoot, "Harness Experiments World", []),
      [ExpWorldLevelDatPath]: experimentsUsedLevelDatBytes("Harness Experiments World"),
    },
    accepting: {
      id: "harness-expflag-leveldat-accept",
      description: "World archive containing a level.dat; EXPFLAG:102 must stay quiet.",
      files: { [AnchorMcWorldPath]: mcWorldWithLevelDat },
    },
    rejecting: {
      id: "harness-expflag-leveldat-reject",
      description: "World archive missing its level.dat; EXPFLAG:102 must warn.",
      files: { [AnchorMcWorldPath]: mcWorldWithoutLevelDat },
    },
    rejectingExpectation: {
      severity: InfoItemType.warning,
      count: 1,
      projectPath: /harness_anchor\.mcworld$/,
      message: "Level.dat not found in a broader world file.",
    },
  }),
];

// ---------------------------------------------------------------------------
// CHECKFEATUREDEPRECATION — deprecated blocks.json overrides, deprecated
// terrain-texture entries, and deprecated block textures at the canonical
// pack-relative textures/blocks location. The block and terrain rules anchor
// each other's accepting fixtures so the generator stays provably applicable.
// ---------------------------------------------------------------------------

const BlocksJsonPath = `${RpRoot}/blocks.json`;
const TerrainTexturePath = `${RpRoot}/textures/terrain_texture.json`;

const blocksJson = (blockKey: string) => json({ format_version: "1.19.30", [blockKey]: { sound: "wood" } });
const terrainTextureJson = (entryKey: string) =>
  json({ texture_data: { [entryKey]: { textures: `textures/blocks/${entryKey}` } } });

// Applicability anchor for the blocks.json pair: a deprecated terrain-texture
// entry keeps rule 102 firing on both fixtures.
const terrainAnchorBase: ValidationFixtureFiles = {
  ...minimalRpFiles(),
  [TerrainTexturePath]: terrainTextureJson("smithing_table_top"),
};

// Applicability anchor for the terrain-texture pairs: a deprecated blocks.json
// override keeps rule 101 firing on both fixtures.
const blocksAnchorBase: ValidationFixtureFiles = {
  ...minimalRpFiles(),
  [BlocksJsonPath]: blocksJson("fletching_table"),
};

const featureDeprecationPairs: readonly ValidationRuleCoveragePair[] = [
  coveragePairFromBase({
    ruleKey: "CHECKFEATUREDEPRECATION:101",
    category: "project",
    suite: ProjectInfoSuite.defaultInDevelopment,
    baseFiles: terrainAnchorBase,
    accepting: {
      id: "harness-featuredep-block-accept",
      description: "blocks.json overriding only a custom block; CHECKFEATUREDEPRECATION:101 must stay quiet.",
      files: { [BlocksJsonPath]: blocksJson("harness:custom_block") },
    },
    rejecting: {
      id: "harness-featuredep-block-reject",
      description: "blocks.json overriding the deprecated fletching_table; CHECKFEATUREDEPRECATION:101 must warn.",
      files: { [BlocksJsonPath]: blocksJson("fletching_table") },
    },
    rejectingExpectation: {
      severity: InfoItemType.warning,
      count: 1,
      projectPath: /blocks\.json$/,
      message: "Entity [fletching_table] will be affected",
      data: "fletching_table",
    },
  }),

  coveragePairFromBase({
    ruleKey: "CHECKFEATUREDEPRECATION:102",
    category: "project",
    suite: ProjectInfoSuite.defaultInDevelopment,
    baseFiles: blocksAnchorBase,
    accepting: {
      id: "harness-featuredep-terrain-accept",
      description: "terrain_texture.json with only custom entries; CHECKFEATUREDEPRECATION:102 must stay quiet.",
      files: { [TerrainTexturePath]: terrainTextureJson("harness_custom") },
    },
    rejecting: {
      id: "harness-featuredep-terrain-reject",
      description:
        "terrain_texture.json declaring the deprecated smithing_table_top entry; CHECKFEATUREDEPRECATION:102 must warn.",
      files: { [TerrainTexturePath]: terrainTextureJson("smithing_table_top") },
    },
    rejectingExpectation: {
      severity: InfoItemType.warning,
      count: 1,
      projectPath: /terrain_texture\.json$/,
      message: "Entity [smithing_table_top] will be affected",
      data: "smithing_table_top",
    },
  }),

  coveragePairFromBase({
    ruleKey: "CHECKFEATUREDEPRECATION:103",
    category: "project",
    suite: ProjectInfoSuite.defaultInDevelopment,
    // Both fixtures carry a deprecated-texture filename OUTSIDE the canonical
    // textures/blocks location (its parent folder just happens to be named
    // "blocks"); it does not override vanilla and must never trip the rule.
    baseFiles: {
      ...blocksAnchorBase,
      [`${RpRoot}/textures/harness/blocks/smithing_table_top.png`]: pngBytes(16, 16),
    },
    accepting: {
      id: "harness-featuredep-texture-accept",
      description:
        "Deprecated texture name only at a noncanonical location (blocks.json anchor keeps the generator applicable via rule 101); CHECKFEATUREDEPRECATION:103 must stay quiet.",
    },
    rejecting: {
      id: "harness-featuredep-texture-reject",
      description:
        "textures/blocks folder containing the deprecated smithing_table_top.png; CHECKFEATUREDEPRECATION:103 must warn.",
      files: { [`${RpRoot}/textures/blocks/smithing_table_top.png`]: pngBytes(16, 16) },
    },
    rejectingExpectation: {
      severity: InfoItemType.warning,
      count: 1,
      projectPath: /smithing_table_top\.png$/,
      message: "Texture [smithing_table_top.png] will be affected",
      data: "smithing_table_top.png",
    },
  }),

  coveragePairFromBase({
    ruleKey: "CHECKFEATUREDEPRECATION:104",
    category: "project",
    suite: ProjectInfoSuite.defaultInDevelopment,
    baseFiles: blocksAnchorBase,
    accepting: {
      id: "harness-featuredep-parse-accept",
      description: "terrain_texture.json with a texture_data table; CHECKFEATUREDEPRECATION:104 must stay quiet.",
      files: { [TerrainTexturePath]: terrainTextureJson("harness_custom") },
    },
    rejecting: {
      id: "harness-featuredep-parse-reject",
      description:
        "terrain_texture.json without a texture_data table, which the deprecation scan cannot process; CHECKFEATUREDEPRECATION:104 must warn.",
      files: { [TerrainTexturePath]: json({ num_mip_levels: 4 }) },
    },
    rejectingExpectation: {
      severity: InfoItemType.warning,
      count: 1,
      projectPath: /terrain_texture\.json$/,
      message: "Failed to parse JSON for entity",
    },
  }),
];

// ---------------------------------------------------------------------------
// FORBFILE — allowed extensions, blocked file names, and invalid characters
// (canAlwaysProcess; the presence of the offending file is the one mutation).
// ---------------------------------------------------------------------------

const forbiddenFilePairs: readonly ValidationRuleCoveragePair[] = [
  coveragePairFromBase({
    ruleKey: "FORBFILE:102",
    category: "project",
    suite: ProjectInfoSuite.defaultInDevelopment,
    baseFiles: minimalRpFiles(),
    accepting: {
      id: "harness-forbfile-ext-accept",
      description: "Resource pack with only allowed extensions; FORBFILE:102 must stay quiet.",
    },
    rejecting: {
      id: "harness-forbfile-ext-reject",
      description: "Resource pack shipping a .js file, which resource packs may not contain; FORBFILE:102 must flag it.",
      files: { [`${RpRoot}/scripts/harness_script.js`]: "// harness script\n" },
    },
    rejectingExpectation: {
      severity: InfoItemType.error,
      count: 1,
      projectPath: /harness_script\.js$/,
      message: "File Does Not Have Allowed Extension",
      data: ".js",
    },
  }),

  coveragePairFromBase({
    ruleKey: "FORBFILE:103",
    category: "project",
    suite: ProjectInfoSuite.defaultInDevelopment,
    baseFiles: minimalRpFiles(),
    accepting: {
      id: "harness-forbfile-name-accept",
      description: "Resource pack without blocked file names; FORBFILE:103 must stay quiet.",
    },
    rejecting: {
      id: "harness-forbfile-name-reject",
      description: "Resource pack shipping the blocked items_client.json; FORBFILE:103 must flag it.",
      files: { [`${RpRoot}/items_client.json`]: json({ harness_placeholder: true }) },
    },
    rejectingExpectation: {
      severity: InfoItemType.error,
      count: 1,
      projectPath: /items_client\.json$/,
      message: "File Name Is Blocked",
    },
  }),

  coveragePairFromBase({
    ruleKey: "FORBFILE:104",
    category: "project",
    suite: ProjectInfoSuite.defaultInDevelopment,
    baseFiles: minimalBpFiles(),
    accepting: {
      id: "harness-forbfile-char-accept",
      description: "Behavior pack with plainly named files; FORBFILE:104 must stay quiet.",
    },
    rejecting: {
      id: "harness-forbfile-char-reject",
      description: "Behavior pack file whose name contains '$'; FORBFILE:104 must flag it.",
      files: { [`${BpRoot}/functions/harness$run.mcfunction`]: "say harness\n" },
    },
    rejectingExpectation: {
      severity: InfoItemType.error,
      count: 1,
      projectPath: "harness$run.mcfunction",
      message: "File Name Contains Invalid Character",
    },
  }),
];

// ---------------------------------------------------------------------------
// VANDUPES — vanilla copy detection (sharingStrict suite only). The vanilla
// hash catalog records wolf.json as md5("{}") and blocks.json's "air"
// property as md5("{}" + "air"), so both conditions reproduce from plain
// text. Each pair's accepting fixture keeps the sibling rule firing so the
// generator stays provably applicable.
// ---------------------------------------------------------------------------

/** Byte-identical to the vanilla wolf loot table; trips VANDUPES:101. */
const VanillaWolfLootTableText = "{}";
const WolfLootTablePath = `${BpRoot}/loot_tables/entities/wolf.json`;

/** blocks.json whose "air" property is a verbatim vanilla copy; trips VANDUPES:102. */
const vanillaAirBlocksJson = json({ format_version: "1.19.30", air: {} });
const customAirBlocksJson = json({ format_version: "1.19.30", air: { do_not_match: true } });

const vanillaDuplicatePairs: readonly ValidationRuleCoveragePair[] = [
  coveragePairFromBase({
    ruleKey: "VANDUPES:101",
    category: "project",
    suite: ProjectInfoSuite.sharingStrict,
    baseFiles: {
      ...minimalBpFiles(),
      ...minimalRpFiles(),
      // Applicability anchor: the vanilla "air" property keeps rule 102
      // firing on both fixtures.
      [BlocksJsonPath]: vanillaAirBlocksJson,
    },
    accepting: {
      id: "harness-vandupes-complete-accept",
      description: "Loot table that differs from the vanilla file; VANDUPES:101 must stay quiet.",
      files: { [WolfLootTablePath]: '{"pools":[]}' },
    },
    rejecting: {
      id: "harness-vandupes-complete-reject",
      description: "Loot table byte-identical to vanilla wolf.json; VANDUPES:101 must warn.",
      files: { [WolfLootTablePath]: VanillaWolfLootTableText },
    },
    rejectingExpectation: {
      severity: InfoItemType.warning,
      count: 1,
      projectPath: /wolf\.json$/,
      message: "Complete copy of a vanilla file [wolf.json]",
      data: "wolf.json",
    },
  }),

  coveragePairFromBase({
    ruleKey: "VANDUPES:102",
    category: "project",
    suite: ProjectInfoSuite.sharingStrict,
    baseFiles: {
      ...minimalBpFiles(),
      ...minimalRpFiles(),
      // Applicability anchor: the vanilla wolf loot table keeps rule 101
      // firing on both fixtures.
      [WolfLootTablePath]: VanillaWolfLootTableText,
    },
    accepting: {
      id: "harness-vandupes-partial-accept",
      description: "blocks.json whose air entry differs from vanilla; VANDUPES:102 must stay quiet.",
      files: { [BlocksJsonPath]: customAirBlocksJson },
    },
    rejecting: {
      id: "harness-vandupes-partial-reject",
      description: "blocks.json whose air entry is a verbatim vanilla copy; VANDUPES:102 must warn.",
      files: { [BlocksJsonPath]: vanillaAirBlocksJson },
    },
    rejectingExpectation: {
      severity: InfoItemType.warning,
      count: 1,
      projectPath: /blocks\.json$/,
      message: "Partial copy of a vanilla file [blocks.json] at property [air]",
      data: "air",
    },
  }),
];

// ---------------------------------------------------------------------------
// VANPRO — protected vanilla asset overrides (canAlwaysProcess).
// ---------------------------------------------------------------------------

const vanillaProtectedPairs: readonly ValidationRuleCoveragePair[] = [
  coveragePairFromBase({
    ruleKey: "VANPRO:101",
    category: "project",
    suite: ProjectInfoSuite.defaultInDevelopment,
    baseFiles: minimalBpFiles(),
    accepting: {
      id: "harness-vanpro-override-accept",
      description: "Behavior pack structures outside protected paths; VANPRO:101 must stay quiet.",
    },
    rejecting: {
      id: "harness-vanpro-override-reject",
      description: "Behavior pack overriding the protected sulfur_spring structure; VANPRO:101 must flag it.",
      files: { [`${BpRoot}/structures/sulfur_spring/harness_structure.mcstructure`]: new Uint8Array([10, 0, 0, 0]) },
    },
    rejectingExpectation: {
      severity: InfoItemType.error,
      count: 1,
      projectPath: "structures/sulfur_spring/harness_structure.mcstructure",
      message: "Protected vanilla asset [behavior/structures/sulfur_spring] should not be overridden",
      data: "behavior/structures/sulfur_spring",
    },
  }),
];

// ---------------------------------------------------------------------------
// PRJINT — orphaned files and nested manifests (canAlwaysProcess).
// ---------------------------------------------------------------------------

const projectIntegrityPairs: readonly ValidationRuleCoveragePair[] = [
  coveragePairFromBase({
    ruleKey: "PRJINT:101",
    category: "project",
    suite: ProjectInfoSuite.defaultInDevelopment,
    baseFiles: minimalBpFiles(),
    accepting: {
      id: "harness-prjint-orphan-accept",
      description: "Project where every file classifies to an item; PRJINT:101 must stay quiet.",
    },
    rejecting: {
      id: "harness-prjint-orphan-reject",
      description: "Project containing a .bin file no item classification claims; PRJINT:101 must flag the orphan.",
      files: { [`${BpRoot}/harness_orphan.bin`]: "orphan payload" },
    },
    rejectingExpectation: {
      severity: InfoItemType.error,
      count: 1,
      message: "Project contains extraneous file or folder",
    },
  }),

  coveragePairFromBase({
    ruleKey: "PRJINT:102",
    category: "project",
    suite: ProjectInfoSuite.defaultInDevelopment,
    baseFiles: minimalBpFiles(),
    accepting: {
      id: "harness-prjint-manifest-accept",
      description: "Pack with exactly one manifest; PRJINT:102 must stay quiet.",
    },
    rejecting: {
      id: "harness-prjint-manifest-reject",
      description: "Pack with a second, nested manifest; PRJINT:102 must flag the structure.",
      files: {
        [`${BpRoot}/subpack/manifest.json`]: json({
          format_version: 2,
          header: {
            name: "Nested Harness Pack",
            description: "Nested manifest for the project-integrity pair",
            uuid: "e58f1a6e-4b2d-4c6a-8f5e-1a2b3c4d5e70",
            version: [1, 0, 0],
          },
          modules: [{ type: "data", uuid: "e58f1a6e-4b2d-4c6a-8f5e-1a2b3c4d5e71", version: [1, 0, 0] }],
        }),
      },
    },
    rejectingExpectation: {
      severity: InfoItemType.error,
      count: 1,
      message: "multiple manifests detected",
    },
  }),
];

export const PolicyIntegrityRulePairs: readonly ValidationRuleCoveragePair[] = [
  ...cbfgPairs,
  ...expflagPairs,
  ...featureDeprecationPairs,
  ...forbiddenFilePairs,
  ...vanillaDuplicatePairs,
  ...vanillaProtectedPairs,
  ...projectIntegrityPairs,
];
