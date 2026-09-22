// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ProjectItemType } from "../../../app/IProjectItemData";
import { InfoItemType } from "../../IInfoItemData";
import { ProjectInfoSuite } from "../../IProjectInfoData";
import { defineValidationRule, ValidationRuleDefinition } from "../../tests/ValidationRuleDefinition";

export enum CommunitySchemaItemInfoGeneratorTest {
  couldNotParseJson = 1,
}

/**
 * Schema structure results are reported at CommunitySchemaErrorBase + the
 * item's ProjectItemType, so each content type owns a distinct rule index.
 */
export const CommunitySchemaErrorBase = 100;

const SourceFile = "app/src/info/projectItemGenerators/communitySchemaItemInfo/CommunitySchemaItemInfoData.ts";

/**
 * Every ProjectItemType with a community JSON schema — the reachable
 * structure-error rule indexes are CommunitySchemaErrorBase + each of these.
 * Mirrors ProjectItemUtilities.getCommunitySchemaPathForType, which this leaf
 * data module must not import; CommunitySchemaItemInfoGenerator.spec.ts gates
 * the two against drifting apart.
 */
export const CommunitySchemaItemTypes: readonly ProjectItemType[] = [
  ProjectItemType.behaviorPackManifestJson,
  ProjectItemType.behaviorPackListJson,
  ProjectItemType.resourcePackListJson,
  ProjectItemType.animationControllerBehaviorJson,
  ProjectItemType.animationBehaviorJson,
  ProjectItemType.blockTypeBehavior,
  ProjectItemType.itemTypeBehavior,
  ProjectItemType.lootTableBehavior,
  ProjectItemType.dialogueBehaviorJson,
  ProjectItemType.entityTypeBehavior,
  ProjectItemType.atmosphericsJson,
  ProjectItemType.blocksCatalogResourceJson,
  ProjectItemType.soundCatalog,
  ProjectItemType.animationResourceJson,
  ProjectItemType.animationControllerResourceJson,
  ProjectItemType.entityTypeResource,
  ProjectItemType.fogResourceJson,
  ProjectItemType.modelGeometryJson,
  ProjectItemType.biomesClientCatalogResource,
  ProjectItemType.particleJson,
  ProjectItemType.renderControllerJson,
  ProjectItemType.blockCulling,
  ProjectItemType.craftingItemCatalog,
  ProjectItemType.languagesCatalogJson,
  ProjectItemType.featureBehavior,
  ProjectItemType.featureRuleBehavior,
  ProjectItemType.functionEventJson,
  ProjectItemType.recipeBehavior,
  ProjectItemType.spawnRuleBehavior,
  ProjectItemType.tradingBehaviorJson,
  ProjectItemType.attachableResourceJson,
  ProjectItemType.itemTypeLegacyResource,
  ProjectItemType.materialsResourceJson,
  ProjectItemType.musicDefinitionJson,
  ProjectItemType.soundDefinitionCatalog,
  ProjectItemType.blockTypeResourceJsonDoNotUse,
  ProjectItemType.uiJson,
  ProjectItemType.tickJson,
  ProjectItemType.flipbookTexturesJson,
  ProjectItemType.itemTextureJson,
  ProjectItemType.terrainTextureCatalogResourceJson,
  ProjectItemType.globalVariablesJson,
];

/** "lootTableBehavior" → "Loot Table Behavior". */
const titleFromEnumName = (enumName: string) =>
  enumName
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (first) => first.toUpperCase())
    .trim();

const structureRule = (itemType: ProjectItemType): ValidationRuleDefinition => {
  const typeName = ProjectItemType[itemType];

  return defineValidationRule({
    generatorId: "COMJSON",
    ruleIndex: CommunitySchemaErrorBase + itemType,
    name: `communitySchemaStructureError${typeName.charAt(0).toUpperCase()}${typeName.slice(1)}`,
    title: `${titleFromEnumName(typeName)} Does Not Match Community JSON Schema`,
    severities: [InfoItemType.warning],
    suites: [ProjectInfoSuite.defaultInDevelopment],
    source: { file: SourceFile, symbol: "CommunitySchemaValidationRules" },
  });
};

/**
 * The COMJSON validation-rule inventory (see CommunitySchemaItemInfoGenerator).
 * Structure-error indexes are per item type, and every item type with a
 * community schema is enumerated so unpaired keys stay visibly uncovered in
 * the catalog. Loot tables are the paired representative because a community
 * schema ships for them and they carry no format_version gate.
 */
export const CommunitySchemaValidationRules: readonly ValidationRuleDefinition[] = [
  defineValidationRule({
    generatorId: "COMJSON",
    ruleIndex: CommunitySchemaItemInfoGeneratorTest.couldNotParseJson,
    name: "couldNotParseJson",
    title: "File Could Not Be Parsed As JSON",
    severities: [InfoItemType.error],
    suites: [ProjectInfoSuite.defaultInDevelopment],
    source: { file: SourceFile, symbol: "CommunitySchemaItemInfoGeneratorTest.couldNotParseJson" },
  }),
  ...CommunitySchemaItemTypes.map(structureRule),
];
