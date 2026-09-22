// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { InfoItemType } from "../../IInfoItemData";
import { ProjectInfoSuite } from "../../IProjectInfoData";
import { defineValidationRule, ValidationRuleDefinition } from "../../tests/ValidationRuleDefinition";

export enum CheckPackIconsGeneratorTest {
  NoIconFound = 101,
  MultipleIconsFound = 102,
  IconNotValidImage = 103,
  IconNotValidSize = 104,
}

/** The CPACKICON validation-rule inventory (see CheckPackIconsGenerator). */
export const PackIconValidationRules: readonly ValidationRuleDefinition[] = [
  defineValidationRule({
    generatorId: "CPACKICON",
    ruleIndex: CheckPackIconsGeneratorTest.NoIconFound,
    name: "noIconFound",
    title: "Pack Icon Not Found",
    severities: [InfoItemType.error],
    suites: [ProjectInfoSuite.defaultInDevelopment],
    source: {
      file: "app/src/info/projectGenerators/checkPackIcons/CheckPackIconsData.ts",
      symbol: "PackIconValidationRules",
    },
  }),
  defineValidationRule({
    generatorId: "CPACKICON",
    ruleIndex: CheckPackIconsGeneratorTest.MultipleIconsFound,
    name: "multipleIconsFound",
    title: "Multiple Pack Icons Found",
    severities: [InfoItemType.error],
    suites: [ProjectInfoSuite.defaultInDevelopment],
    source: {
      file: "app/src/info/projectGenerators/checkPackIcons/CheckPackIconsData.ts",
      symbol: "PackIconValidationRules",
    },
  }),
  defineValidationRule({
    generatorId: "CPACKICON",
    ruleIndex: CheckPackIconsGeneratorTest.IconNotValidImage,
    name: "iconNotValidImage",
    title: "Pack Icon Is Not a Valid Image",
    severities: [InfoItemType.error],
    suites: [ProjectInfoSuite.defaultInDevelopment],
    source: {
      file: "app/src/info/projectGenerators/checkPackIcons/CheckPackIconsData.ts",
      symbol: "PackIconValidationRules",
    },
  }),
  defineValidationRule({
    generatorId: "CPACKICON",
    ruleIndex: CheckPackIconsGeneratorTest.IconNotValidSize,
    name: "iconNotValidSize",
    title: "Pack Icon Is Not a Valid Size",
    severities: [InfoItemType.error],
    suites: [ProjectInfoSuite.defaultInDevelopment],
    source: {
      file: "app/src/info/projectGenerators/checkPackIcons/CheckPackIconsData.ts",
      symbol: "PackIconValidationRules",
    },
  }),
];
