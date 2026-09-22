// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { InfoItemType } from "../../IInfoItemData";
import { ProjectInfoSuite } from "../../IProjectInfoData";
import { defineValidationRule, ValidationRuleDefinition } from "../../tests/ValidationRuleDefinition";

export enum UnknownFileGeneratorTest {
  unknownTypeFileFound = 102,
}

/** The UNKFILE validation-rule inventory (see UnknownFileGenerator). */
export const UnknownFileValidationRules: readonly ValidationRuleDefinition[] = [
  defineValidationRule({
    generatorId: "UNKFILE",
    ruleIndex: UnknownFileGeneratorTest.unknownTypeFileFound,
    name: "unknownTypeFileFound",
    title: "Unknown File Type Found",
    severities: [InfoItemType.error],
    suites: [ProjectInfoSuite.defaultInDevelopment],
    source: {
      file: "app/src/info/fileGenerators/unknownFile/UnknownFileData.ts",
      symbol: "UnknownFileValidationRules",
    },
  }),
];
