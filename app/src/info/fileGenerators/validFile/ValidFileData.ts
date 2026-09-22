// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { InfoItemType } from "../../IInfoItemData";
import { ProjectInfoSuite } from "../../IProjectInfoData";
import { defineValidationRule, ValidationRuleDefinition } from "../../tests/ValidationRuleDefinition";

export enum ValidGeneratorTest {
  nonCompliantJson = 102,
  emptyJson = 103,
  jsonNotString = 104,
}

const rule = (spec: { ruleIndex: number; name: string; title: string }): ValidationRuleDefinition =>
  defineValidationRule({
    generatorId: "VALFILE",
    ruleIndex: spec.ruleIndex,
    name: spec.name,
    title: spec.title,
    severities: [InfoItemType.error],
    suites: [ProjectInfoSuite.defaultInDevelopment],
    source: {
      file: "app/src/info/fileGenerators/validFile/ValidFileData.ts",
      symbol: "ValidFileValidationRules",
    },
  });

/** The VALFILE validation-rule inventory (see ValidFileGenerator). */
export const ValidFileValidationRules: readonly ValidationRuleDefinition[] = [
  rule({
    ruleIndex: ValidGeneratorTest.nonCompliantJson,
    name: "nonCompliantJson",
    title: "JSON File Is Not Compliant",
  }),
  rule({
    ruleIndex: ValidGeneratorTest.emptyJson,
    name: "emptyJson",
    title: "JSON File Is Empty",
  }),
  // jsonNotString (104) is reachable only through browser FileSystemStorage
  // (e.g. a file renamed from .png to .json keeps its binary content), so it
  // cannot earn node-side E2E coverage; the rule is inventoried and declared
  // known-uncovered in ValidationRuleCoverage.ts.
  rule({
    ruleIndex: ValidGeneratorTest.jsonNotString,
    name: "jsonNotString",
    title: "JSON File Content Is Not Text",
  }),
];
