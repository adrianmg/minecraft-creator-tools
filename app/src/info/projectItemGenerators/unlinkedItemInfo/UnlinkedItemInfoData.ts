// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ProjectItemType } from "../../../app/IProjectItemData";
import { InfoItemType } from "../../IInfoItemData";
import { ProjectInfoSuite } from "../../IProjectInfoData";
import { defineValidationRule, ValidationRuleDefinition } from "../../tests/ValidationRuleDefinition";

export enum UnlinkedItemInfoGeneratorTest {
  unlinkedItemIsNotUsed = 191,
  avoidLinksToVanillaItems = 205,
}

/**
 * Base index for the "link target not found in this pack" warning family:
 * the emitted rule index is this base plus the ProjectItemType of the link
 * target, so each target type gets a stable, distinct index.
 */
export const UnlinkedItemNotFoundByType = 300;

/**
 * Every ProjectItemType that can appear as an unfulfilled-relationship
 * target — the reachable rule indexes are UnlinkedItemNotFoundByType + each
 * of these. Mirrors the addUnfulfilledRelationship call sites across
 * src/minecraft (AttachableResourceDefinition, EntityTypeResourceDefinition,
 * FeatureDefinition, FeatureRuleDefinition, texture/sound catalog
 * definitions, LootTableBehaviorDefinition, RecipeBehaviorDefinition,
 * SkinCatalogDefinition, SpawnRulesBehaviorDefinition, and
 * JsonUIResourceDefinition).
 */
export const UnlinkedItemTargetTypes: readonly ProjectItemType[] = [
  ProjectItemType.texture,
  ProjectItemType.audio,
  ProjectItemType.modelGeometryJson,
  ProjectItemType.featureBehavior,
  ProjectItemType.itemTypeBehavior,
  ProjectItemType.lootTableBehavior,
  ProjectItemType.soundDefinitionCatalog,
  ProjectItemType.entityTypeBehavior,
];

const rule = (spec: {
  ruleIndex: number;
  name: string;
  title: string;
  severities: readonly (InfoItemType.error | InfoItemType.warning | InfoItemType.recommendation)[];
}): ValidationRuleDefinition =>
  defineValidationRule({
    generatorId: "UNLINK",
    ruleIndex: spec.ruleIndex,
    name: spec.name,
    title: spec.title,
    severities: spec.severities,
    suites: [ProjectInfoSuite.defaultInDevelopment],
    source: {
      file: "app/src/info/projectItemGenerators/unlinkedItemInfo/UnlinkedItemInfoData.ts",
      symbol: "UnlinkedItemValidationRules",
    },
  });

/** "lootTableBehavior" → "Loot Table Behavior". */
const titleFromEnumName = (enumName: string) =>
  enumName
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (first) => first.toUpperCase())
    .trim();

const notFoundRule = (itemType: ProjectItemType): ValidationRuleDefinition => {
  const typeName = ProjectItemType[itemType];

  return rule({
    ruleIndex: UnlinkedItemNotFoundByType + itemType,
    name: `unlinked${typeName.charAt(0).toUpperCase()}${typeName.slice(1)}NotFound`,
    title: `Linked ${titleFromEnumName(typeName)} Not Found in Pack`,
    severities: [InfoItemType.warning],
  });
};

/**
 * The UNLINK validation-rule inventory (see UnlinkedItemInfoGenerator).
 * Every reachable link-target type is enumerated so unpaired keys stay
 * visibly uncovered in the catalog; loot tables are the paired
 * representative of the not-found family.
 */
export const UnlinkedItemValidationRules: readonly ValidationRuleDefinition[] = [
  rule({
    ruleIndex: UnlinkedItemInfoGeneratorTest.unlinkedItemIsNotUsed,
    name: "unlinkedItemIsNotUsed",
    title: "Unlinked Item Is Not Used",
    severities: [InfoItemType.warning],
  }),
  rule({
    ruleIndex: UnlinkedItemInfoGeneratorTest.avoidLinksToVanillaItems,
    name: "avoidLinksToVanillaItems",
    title: "Avoid Links to Vanilla Items",
    severities: [InfoItemType.recommendation],
  }),
  ...UnlinkedItemTargetTypes.map(notFoundRule),
];
