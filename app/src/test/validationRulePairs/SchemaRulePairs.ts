// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * SchemaRulePairs — paired E2E coverage for the schema validation item
 * generators: JSON (official JSON schemas), COMJSON (community JSON
 * schemas), and JSONF (documentation-derived form schemas).
 *
 * JSON/COMJSON pairs use loot tables: both schema systems ship a loot-table
 * schema, and loot tables carry no format_version, so the "current format
 * version" gate in those generators never suppresses validation. Structure
 * error indexes are per item type (base 100 + ProjectItemType), so the pairs
 * derive their rule keys from the same constants the generators use.
 *
 * JSONF pairs exercise DataFormValidator through the production form
 * catalog: spawn-rule documents for parse/scalar-shape issues, an entity
 * document (minecraft:attack.damage and behavior.charge_held_item.items)
 * for type/range/length issues, and a biome document
 * (minecraft:village_type and the description identifier) for
 * choice/pattern/required-field issues. Every
 * rejecting expectation asserts the "At <field path>, ..." context in the
 * message so schema locations stay useful.
 */

import { InfoItemType } from "../../info/IInfoItemData";
import { ProjectInfoSuite } from "../../info/IProjectInfoData";
import { ProjectItemType } from "../../app/IProjectItemData";
import { ValidationRuleCoveragePair } from "../ValidationRuleHarness";
import { ValidationRuleKey } from "../../info/tests/ValidationRuleDefinition";
import { JsonSchemaErrorBase } from "../../info/projectItemGenerators/jsonSchemaItemInfo/JsonSchemaItemInfoData";
import { CommunitySchemaErrorBase } from "../../info/projectItemGenerators/communitySchemaItemInfo/CommunitySchemaItemInfoData";
import { BpRoot, PinnedVersion, coveragePairFromBase, json, minimalBpFiles } from "./PairFixtureBuilders";

const LootTablePath = `${BpRoot}/loot_tables/harness_drop.json`;
const SpawnRulesPath = `${BpRoot}/spawn_rules/harness_entity.json`;
const EntityPath = `${BpRoot}/entities/harness_mob.json`;
const BiomePath = `${BpRoot}/biomes/harness_biome.json`;

const pinnedVersionString = PinnedVersion.join(".");

const jsonLootRuleKey = `JSON:${JsonSchemaErrorBase + ProjectItemType.lootTableBehavior}` as ValidationRuleKey;
const comJsonLootRuleKey =
  `COMJSON:${CommunitySchemaErrorBase + ProjectItemType.lootTableBehavior}` as ValidationRuleKey;

const cleanLootTable = json({
  pools: [{ rolls: 1, entries: [{ type: "item", name: "minecraft:stick", weight: 1 }] }],
});

// The closing brace is dropped so JSON.parse fails in every parser tier.
const malformedLootTable = cleanLootTable.substring(0, cleanLootTable.length - 1);

// pools must be an array; a bare string is a single unambiguous type violation.
const typeViolatingLootTable = json({ pools: "harness_not_an_array" });

// The community loot schema rejects unknown root properties
// (additionalProperties: false), which is its one violation the bundled
// json-schema validator reports without resolving $refs.
const extraPropertyLootTable = json({
  pools: [{ rolls: 1, entries: [{ type: "item", name: "minecraft:stick", weight: 1 }] }],
  harness_extra: true,
});

const spawnRulesDoc = json({
  format_version: pinnedVersionString,
  "minecraft:spawn_rules": {
    description: { identifier: "test:harness_entity", population_control: "animal" },
    conditions: [{ "minecraft:spawns_on_surface": {} }],
  },
});

const malformedSpawnRulesDoc = spawnRulesDoc.substring(0, spawnRulesDoc.length - 1);

const entityDoc = (components: object) =>
  json({
    format_version: pinnedVersionString,
    "minecraft:entity": {
      description: { identifier: "test:harness_mob", is_spawnable: false, is_summonable: false },
      components,
    },
  });

const biomeDoc = (villageType: object, identifier: string = "harness:biome") =>
  json({
    format_version: pinnedVersionString,
    "minecraft:biome": {
      description: { identifier },
      components: { "minecraft:village_type": villageType },
    },
  });

export const SchemaRulePairs: readonly ValidationRuleCoveragePair[] = [
  // -------------------------------------------------------------------------
  // JSON — official JSON schema validation.
  // -------------------------------------------------------------------------
  coveragePairFromBase({
    ruleKey: "JSON:1",
    category: "projectItem",
    suite: ProjectInfoSuite.defaultInDevelopment,
    baseFiles: minimalBpFiles(),
    accepting: {
      id: "harness-json-parse-accept",
      description: "Well-formed loot table JSON; JSON:1 must stay quiet.",
      files: { [LootTablePath]: cleanLootTable },
    },
    rejecting: {
      id: "harness-json-parse-reject",
      description: "Loot table with a truncated closing brace; JSON:1 must flag the parse failure.",
      files: { [LootTablePath]: malformedLootTable },
    },
    rejectingExpectation: {
      severity: InfoItemType.error,
      count: 1,
      projectPath: /harness_drop\.json$/,
      message: "syntax error and can't be read as JSON",
    },
  }),

  coveragePairFromBase({
    ruleKey: jsonLootRuleKey,
    category: "projectItem",
    suite: ProjectInfoSuite.defaultInDevelopment,
    baseFiles: minimalBpFiles(),
    accepting: {
      id: "harness-json-structure-accept",
      description: "Loot table matching the official schema; the JSON structure rule must stay quiet.",
      files: { [LootTablePath]: cleanLootTable },
    },
    rejecting: {
      id: "harness-json-structure-reject",
      description: "Loot table whose pools value is a string; the JSON structure rule must flag the type.",
      files: { [LootTablePath]: typeViolatingLootTable },
    },
    rejectingExpectation: {
      severity: InfoItemType.warning,
      count: 1,
      projectPath: /harness_drop\.json$/,
      message: "Structure issue",
      data: 'In "pools": harness_not_an_array - string value found, but a array is required',
    },
  }),

  // -------------------------------------------------------------------------
  // COMJSON — community JSON schema validation.
  // -------------------------------------------------------------------------
  coveragePairFromBase({
    ruleKey: "COMJSON:1",
    category: "projectItem",
    suite: ProjectInfoSuite.defaultInDevelopment,
    baseFiles: minimalBpFiles(),
    accepting: {
      id: "harness-comjson-parse-accept",
      description: "Well-formed loot table JSON; COMJSON:1 must stay quiet.",
      files: { [LootTablePath]: cleanLootTable },
    },
    rejecting: {
      id: "harness-comjson-parse-reject",
      description: "Loot table with a truncated closing brace; COMJSON:1 must flag the parse failure.",
      files: { [LootTablePath]: malformedLootTable },
    },
    rejectingExpectation: {
      severity: InfoItemType.error,
      count: 1,
      projectPath: /harness_drop\.json$/,
      message: "Could not parse JSON",
    },
  }),

  coveragePairFromBase({
    ruleKey: comJsonLootRuleKey,
    category: "projectItem",
    suite: ProjectInfoSuite.defaultInDevelopment,
    baseFiles: minimalBpFiles(),
    accepting: {
      id: "harness-comjson-structure-accept",
      description: "Loot table matching the community schema; the COMJSON structure rule must stay quiet.",
      files: { [LootTablePath]: cleanLootTable },
    },
    rejecting: {
      id: "harness-comjson-structure-reject",
      description: "Loot table with an unknown root property; the COMJSON structure rule must flag it.",
      files: { [LootTablePath]: extraPropertyLootTable },
    },
    rejectingExpectation: {
      severity: InfoItemType.warning,
      count: 1,
      projectPath: /harness_drop\.json$/,
      message: "JSON structure error",
      data: "() The property harness_extra is not defined in the schema and the schema does not allow additional properties",
    },
  }),

  // -------------------------------------------------------------------------
  // JSONF — form schema validation (DataFormValidator issue types).
  // -------------------------------------------------------------------------
  coveragePairFromBase({
    ruleKey: "JSONF:401",
    category: "projectItem",
    suite: ProjectInfoSuite.defaultInDevelopment,
    baseFiles: minimalBpFiles(),
    accepting: {
      id: "harness-jsonf-parse-accept",
      description: "Well-formed spawn rules document; JSONF:401 must stay quiet.",
      files: { [SpawnRulesPath]: spawnRulesDoc },
    },
    rejecting: {
      id: "harness-jsonf-parse-reject",
      description: "Spawn rules document with a truncated closing brace; JSONF:401 must flag the parse failure.",
      files: { [SpawnRulesPath]: malformedSpawnRulesDoc },
    },
    rejectingExpectation: {
      severity: InfoItemType.error,
      count: 1,
      projectPath: /harness_entity\.json$/,
      message: "Could not parse JSON",
    },
  }),

  coveragePairFromBase({
    ruleKey: "JSONF:101",
    category: "projectItem",
    suite: ProjectInfoSuite.defaultInDevelopment,
    baseFiles: minimalBpFiles(),
    accepting: {
      id: "harness-jsonf-scalar-string-accept",
      description: "Spawn rules document that is a JSON object; JSONF:101 must stay quiet.",
      files: { [SpawnRulesPath]: spawnRulesDoc },
    },
    rejecting: {
      id: "harness-jsonf-scalar-string-reject",
      description: "Spawn rules file containing only a JSON string; JSONF:101 must flag the shape.",
      files: { [SpawnRulesPath]: json("harness_probe") },
    },
    rejectingExpectation: {
      severity: InfoItemType.warning,
      count: 1,
      projectPath: /harness_entity\.json$/,
      message: "Unexpected String Used When Object Expected",
    },
  }),

  coveragePairFromBase({
    ruleKey: "JSONF:102",
    category: "projectItem",
    suite: ProjectInfoSuite.defaultInDevelopment,
    baseFiles: minimalBpFiles(),
    accepting: {
      id: "harness-jsonf-scalar-boolean-accept",
      description: "Spawn rules document that is a JSON object; JSONF:102 must stay quiet.",
      files: { [SpawnRulesPath]: spawnRulesDoc },
    },
    rejecting: {
      id: "harness-jsonf-scalar-boolean-reject",
      description: "Spawn rules file containing only a JSON boolean; JSONF:102 must flag the shape.",
      files: { [SpawnRulesPath]: json(true) },
    },
    rejectingExpectation: {
      severity: InfoItemType.warning,
      count: 1,
      projectPath: /harness_entity\.json$/,
      message: "Unexpected Boolean Used When Object Expected",
    },
  }),

  coveragePairFromBase({
    ruleKey: "JSONF:103",
    category: "projectItem",
    suite: ProjectInfoSuite.defaultInDevelopment,
    baseFiles: minimalBpFiles(),
    accepting: {
      id: "harness-jsonf-scalar-number-accept",
      description: "Spawn rules document that is a JSON object; JSONF:103 must stay quiet.",
      files: { [SpawnRulesPath]: spawnRulesDoc },
    },
    rejecting: {
      id: "harness-jsonf-scalar-number-reject",
      description: "Spawn rules file containing only a JSON number; JSONF:103 must flag the shape.",
      files: { [SpawnRulesPath]: json(3) },
    },
    rejectingExpectation: {
      severity: InfoItemType.warning,
      count: 1,
      projectPath: /harness_entity\.json$/,
      message: "Unexpected Number Used When Object Expected",
    },
  }),

  coveragePairFromBase({
    ruleKey: "JSONF:110",
    category: "projectItem",
    suite: ProjectInfoSuite.defaultInDevelopment,
    baseFiles: minimalBpFiles(),
    accepting: {
      id: "harness-jsonf-type-accept",
      description: "Entity attack damage as a number; JSONF:110 must stay quiet.",
      files: { [EntityPath]: entityDoc({ "minecraft:attack": { damage: 5 } }) },
    },
    rejecting: {
      id: "harness-jsonf-type-reject",
      description: "Entity attack damage as a string; JSONF:110 must flag the type mismatch.",
      files: { [EntityPath]: entityDoc({ "minecraft:attack": { damage: "harness_high" } }) },
    },
    rejectingExpectation: {
      severity: InfoItemType.warning,
      count: 1,
      projectPath: /harness_mob\.json$/,
      message: "minecraft:entity.components.minecraft:attack.damage",
    },
  }),

  coveragePairFromBase({
    ruleKey: "JSONF:111",
    category: "projectItem",
    suite: ProjectInfoSuite.defaultInDevelopment,
    baseFiles: minimalBpFiles(),
    accepting: {
      id: "harness-jsonf-minimum-accept",
      description: "Entity attack damage inside the allowed range; JSONF:111 must stay quiet.",
      files: { [EntityPath]: entityDoc({ "minecraft:attack": { damage: 5 } }) },
    },
    rejecting: {
      id: "harness-jsonf-minimum-reject",
      description: "Entity attack damage below the allowed minimum; JSONF:111 must flag the value.",
      files: { [EntityPath]: entityDoc({ "minecraft:attack": { damage: -60 } }) },
    },
    rejectingExpectation: {
      severity: InfoItemType.warning,
      count: 1,
      projectPath: /harness_mob\.json$/,
      message: "value -60 is below minimum value -50",
    },
  }),

  coveragePairFromBase({
    ruleKey: "JSONF:112",
    category: "projectItem",
    suite: ProjectInfoSuite.defaultInDevelopment,
    baseFiles: minimalBpFiles(),
    accepting: {
      id: "harness-jsonf-maximum-accept",
      description: "Entity attack damage inside the allowed range; JSONF:112 must stay quiet.",
      files: { [EntityPath]: entityDoc({ "minecraft:attack": { damage: 5 } }) },
    },
    rejecting: {
      id: "harness-jsonf-maximum-reject",
      description: "Entity attack damage above the allowed maximum; JSONF:112 must flag the value.",
      files: { [EntityPath]: entityDoc({ "minecraft:attack": { damage: 60 } }) },
    },
    rejectingExpectation: {
      severity: InfoItemType.warning,
      count: 1,
      projectPath: /harness_mob\.json$/,
      message: "value 60 is above maximum value 50",
    },
  }),

  coveragePairFromBase({
    ruleKey: "JSONF:113",
    category: "projectItem",
    suite: ProjectInfoSuite.defaultInDevelopment,
    baseFiles: minimalBpFiles(),
    accepting: {
      id: "harness-jsonf-string-length-accept",
      description:
        "charge_held_item items as a non-empty scalar string, which reaches the same minimum-length " +
        "constraint the rejecting empty string trips; JSONF:113 must stay quiet.",
      files: {
        [EntityPath]: entityDoc({ "minecraft:behavior.charge_held_item": { items: "minecraft:arrow" } }),
      },
    },
    rejecting: {
      id: "harness-jsonf-string-length-reject",
      description: "charge_held_item items as an empty string; JSONF:113 must flag the length.",
      files: { [EntityPath]: entityDoc({ "minecraft:behavior.charge_held_item": { items: "" } }) },
    },
    rejectingExpectation: {
      severity: InfoItemType.warning,
      count: 1,
      projectPath: /harness_mob\.json$/,
      message: "string length 0 is below minimum length 1",
    },
  }),

  coveragePairFromBase({
    ruleKey: "JSONF:115",
    category: "projectItem",
    suite: ProjectInfoSuite.defaultInDevelopment,
    baseFiles: minimalBpFiles(),
    accepting: {
      id: "harness-jsonf-choices-accept",
      description: "Biome village type using an allowed choice; JSONF:115 must stay quiet.",
      files: { [BiomePath]: biomeDoc({ type: "desert" }) },
    },
    rejecting: {
      id: "harness-jsonf-choices-reject",
      description: "Biome village type outside the allowed choices; JSONF:115 must flag the value.",
      files: { [BiomePath]: biomeDoc({ type: "harness_bogus" }) },
    },
    rejectingExpectation: {
      severity: InfoItemType.warning,
      count: 1,
      projectPath: /harness_biome\.json$/,
      message: "value 'harness_bogus' is not one of the allowed choices",
    },
  }),

  coveragePairFromBase({
    ruleKey: "JSONF:116",
    category: "projectItem",
    suite: ProjectInfoSuite.defaultInDevelopment,
    baseFiles: minimalBpFiles(),
    accepting: {
      id: "harness-jsonf-pattern-accept",
      description: "Biome description identifier matching the form's lowercase pattern; JSONF:116 must stay quiet.",
      files: { [BiomePath]: biomeDoc({ type: "desert" }, "harness:valid") },
    },
    rejecting: {
      id: "harness-jsonf-pattern-reject",
      description:
        "Biome description identifier with an uppercase letter, violating the form's pattern; JSONF:116 must flag it.",
      files: { [BiomePath]: biomeDoc({ type: "desert" }, "harness:Bad") },
    },
    rejectingExpectation: {
      severity: InfoItemType.warning,
      count: 1,
      projectPath: /harness_biome\.json$/,
      message: "does not match required pattern",
    },
  }),

  coveragePairFromBase({
    ruleKey: "JSONF:118",
    category: "projectItem",
    suite: ProjectInfoSuite.defaultInDevelopment,
    baseFiles: minimalBpFiles(),
    accepting: {
      id: "harness-jsonf-point-size-accept",
      description: "Entity attack damage as a two-element range; JSONF:118 must stay quiet.",
      files: { [EntityPath]: entityDoc({ "minecraft:attack": { damage: [2, 4] } }) },
    },
    rejecting: {
      id: "harness-jsonf-point-size-reject",
      description: "Entity attack damage as a three-element range; JSONF:118 must flag the arity.",
      files: { [EntityPath]: entityDoc({ "minecraft:attack": { damage: [2, 4, 6] } }) },
    },
    rejectingExpectation: {
      severity: InfoItemType.warning,
      count: 1,
      projectPath: /harness_mob\.json$/,
      message: "has 3 elements but expected exactly 2",
    },
  }),

  coveragePairFromBase({
    ruleKey: "JSONF:121",
    category: "projectItem",
    suite: ProjectInfoSuite.defaultInDevelopment,
    baseFiles: minimalBpFiles(),
    accepting: {
      id: "harness-jsonf-required-accept",
      description: "Biome village type with its required type field; JSONF:121 must stay quiet.",
      files: { [BiomePath]: biomeDoc({ type: "desert" }) },
    },
    rejecting: {
      id: "harness-jsonf-required-reject",
      description: "Biome village type missing its required type field; JSONF:121 must flag the omission.",
      files: { [BiomePath]: biomeDoc({}) },
    },
    rejectingExpectation: {
      severity: InfoItemType.warning,
      count: 1,
      projectPath: /harness_biome\.json$/,
      message: "missing required field 'type'",
    },
  }),
];
