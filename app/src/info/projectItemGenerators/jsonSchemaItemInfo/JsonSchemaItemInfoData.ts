// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ProjectItemType } from "../../../app/IProjectItemData";
import { InfoItemType } from "../../IInfoItemData";
import { ProjectInfoSuite } from "../../IProjectInfoData";
import { defineValidationRule, ValidationRuleDefinition } from "../../tests/ValidationRuleDefinition";

export enum JsonSchemaItemInfoGeneratorTest {
  couldNotParseJson = 1,
}

/**
 * Schema structure results are reported at JsonSchemaErrorBase + the item's
 * ProjectItemType, so each content type owns a distinct rule index.
 */
export const JsonSchemaErrorBase = 100;

const SourceFile = "app/src/info/projectItemGenerators/jsonSchemaItemInfo/JsonSchemaItemInfoData.ts";

/**
 * Every ProjectItemType with an official JSON schema — the reachable
 * structure-error rule indexes are JsonSchemaErrorBase + each of these.
 * Mirrors ProjectItemUtilities.getOfficialSchemaPathForType, which this leaf
 * data module must not import; JsonSchemaItemInfoGenerator.spec.ts gates the
 * two against drifting apart.
 */
export const OfficialSchemaItemTypes: readonly ProjectItemType[] = [
  ProjectItemType.entityTypeBehavior,
  ProjectItemType.blockTypeBehavior,
  ProjectItemType.itemTypeBehavior,
  ProjectItemType.recipeBehavior,
  ProjectItemType.lootTableBehavior,
  ProjectItemType.spawnRuleBehavior,
  ProjectItemType.dialogueBehaviorJson,
  ProjectItemType.featureBehavior,
  ProjectItemType.featureRuleBehavior,
  ProjectItemType.tradingBehaviorJson,
  ProjectItemType.biomeBehavior,
  ProjectItemType.animationBehaviorJson,
  ProjectItemType.animationControllerBehaviorJson,
  ProjectItemType.animationResourceJson,
  ProjectItemType.animationControllerResourceJson,
  ProjectItemType.attachableResourceJson,
  ProjectItemType.fogResourceJson,
  ProjectItemType.particleJson,
  ProjectItemType.renderControllerJson,
  ProjectItemType.blocksCatalogResourceJson,
  ProjectItemType.soundDefinitionCatalog,
  ProjectItemType.terrainTextureCatalogResourceJson,
  ProjectItemType.itemTextureJson,
  ProjectItemType.flipbookTexturesJson,
  ProjectItemType.biomesClientCatalogResource,
  ProjectItemType.entityTypeResource,
  ProjectItemType.modelGeometryJson,
  ProjectItemType.textureSetJson,
  ProjectItemType.uiJson,
  ProjectItemType.globalVariablesJson,
  ProjectItemType.behaviorPackManifestJson,
  ProjectItemType.resourcePackManifestJson,
  ProjectItemType.blockCulling,
  ProjectItemType.languagesCatalogJson,
  ProjectItemType.musicDefinitionJson,
  ProjectItemType.tickJson,
  ProjectItemType.voxelShapeBehavior,
  ProjectItemType.behaviorPackListJson,
  ProjectItemType.resourcePackListJson,
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
    generatorId: "JSON",
    ruleIndex: JsonSchemaErrorBase + itemType,
    name: `schemaStructureError${typeName.charAt(0).toUpperCase()}${typeName.slice(1)}`,
    title: `${titleFromEnumName(typeName)} Does Not Match Official JSON Schema`,
    severities: [InfoItemType.warning, InfoItemType.recommendation],
    suites: [ProjectInfoSuite.defaultInDevelopment],
    source: { file: SourceFile, symbol: "JsonSchemaValidationRules" },
  });
};

/**
 * The JSON validation-rule inventory (see JsonSchemaItemInfoGenerator).
 * Structure-error indexes are per item type, and every item type with an
 * official schema is enumerated so unpaired keys stay visibly uncovered in
 * the catalog. Loot tables are the paired representative because an official
 * schema ships for them and they carry no format_version gate.
 */
export const JsonSchemaValidationRules: readonly ValidationRuleDefinition[] = [
  defineValidationRule({
    generatorId: "JSON",
    ruleIndex: JsonSchemaItemInfoGeneratorTest.couldNotParseJson,
    name: "couldNotParseJson",
    title: "File Could Not Be Parsed As JSON",
    severities: [InfoItemType.error],
    suites: [ProjectInfoSuite.defaultInDevelopment],
    source: { file: SourceFile, symbol: "JsonSchemaItemInfoGeneratorTest.couldNotParseJson" },
  }),
  ...OfficialSchemaItemTypes.map(structureRule),
];
