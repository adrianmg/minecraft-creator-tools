// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { InfoItemType } from "../../IInfoItemData";
import { ProjectInfoSuite } from "../../IProjectInfoData";
import { defineValidationRule, ValidationRuleDefinition } from "../../tests/ValidationRuleDefinition";

export enum UnknownItemGeneratorTest {
  unknownItemTypeFound = 101,
}

/** The UNKJSON validation-rule inventory (see UnknownItemGenerator). */
export const UnknownItemValidationRules: readonly ValidationRuleDefinition[] = [
  defineValidationRule({
    generatorId: "UNKJSON",
    ruleIndex: UnknownItemGeneratorTest.unknownItemTypeFound,
    name: "unknownItemTypeFound",
    title: "Unknown JSON File Found",
    severities: [InfoItemType.error],
    suites: [ProjectInfoSuite.defaultInDevelopment],
    source: {
      file: "app/src/info/projectItemGenerators/unknownItem/UnknownItemData.ts",
      symbol: "UnknownItemValidationRules",
    },
  }),
];
