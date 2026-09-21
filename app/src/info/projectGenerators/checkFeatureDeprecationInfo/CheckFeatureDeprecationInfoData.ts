// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { InfoItemType } from "../../IInfoItemData";
import { ProjectInfoSuite } from "../../IProjectInfoData";
import { defineValidationRule, ValidationRuleDefinition } from "../../tests/ValidationRuleDefinition";

export enum CheckFeatureDeprecationInfoGeneratorTest {
  deprecatedBlockOverride = 101,
  deprecatedTerrainTexture = 102,
  deprecatedTexture = 103,
  jsonParseError = 104,
}

const rule = (spec: { ruleIndex: number; name: string; title: string }) =>
  defineValidationRule({
    generatorId: "CHECKFEATUREDEPRECATION",
    ruleIndex: spec.ruleIndex,
    name: spec.name,
    title: spec.title,
    severities: [InfoItemType.warning],
    suites: [ProjectInfoSuite.defaultInDevelopment],
    source: {
      file: "app/src/info/projectGenerators/checkFeatureDeprecationInfo/CheckFeatureDeprecationInfoData.ts",
      symbol: "CheckFeatureDeprecationValidationRules",
    },
  });

/** The CHECKFEATUREDEPRECATION validation-rule inventory. */
export const CheckFeatureDeprecationValidationRules: readonly ValidationRuleDefinition[] = [
  rule({
    ruleIndex: CheckFeatureDeprecationInfoGeneratorTest.deprecatedBlockOverride,
    name: "deprecatedBlockOverride",
    title: "Deprecated Block Override",
  }),
  rule({
    ruleIndex: CheckFeatureDeprecationInfoGeneratorTest.deprecatedTerrainTexture,
    name: "deprecatedTerrainTexture",
    title: "Deprecated Terrain Texture Entry",
  }),
  rule({
    ruleIndex: CheckFeatureDeprecationInfoGeneratorTest.deprecatedTexture,
    name: "deprecatedTexture",
    title: "Deprecated Texture",
  }),
  rule({
    ruleIndex: CheckFeatureDeprecationInfoGeneratorTest.jsonParseError,
    name: "jsonParseError",
    title: "Feature Deprecation Content Could Not Be Processed",
  }),
];

export const DEPRECATED_BLOCKS = ["fletching_table", "smithing_table"];

export const DEPRECATED_TEXTURES = [
  "smithing_table_top.png",
  "smithing_table_side1.png",
  "smithing_table_side2.png",
  "fletcher_table_top.png",
  "fletcher_table_side1.png",
  "fletcher_table_side2.png",
];

export const DEPRECATED_TEXTURE_ENTRIES = [
  "smithing_table_top",
  "smithing_table_side_a",
  "smithing_table_side_b",
  "fletching_table_top",
  "fletching_table_side1",
  "fletching_table_side2",
];
