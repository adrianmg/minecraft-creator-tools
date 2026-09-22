// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { InfoItemType } from "../../IInfoItemData";
import { ProjectInfoSuite } from "../../IProjectInfoData";
import { defineValidationRule, ValidationRuleDefinition } from "../../tests/ValidationRuleDefinition";

export enum CheckNoBOMGeneratorTest {
  NoByteOrderMarkAllowedInJsonFile = 101,
}

/** The NOBOM validation-rule inventory (see CheckNoBOMGenerator). */
export const CheckNoBOMValidationRules: readonly ValidationRuleDefinition[] = [
  defineValidationRule({
    generatorId: "NOBOM",
    ruleIndex: CheckNoBOMGeneratorTest.NoByteOrderMarkAllowedInJsonFile,
    name: "noByteOrderMarkAllowedInJsonFile",
    title: "No Byte Order Mark Allowed in JSON File",
    severities: [InfoItemType.error],
    suites: [ProjectInfoSuite.defaultInDevelopment],
    source: {
      file: "app/src/info/fileGenerators/checkNoBOM/CheckNoBOMGeneratorData.ts",
      symbol: "CheckNoBOMValidationRules",
    },
  }),
];
