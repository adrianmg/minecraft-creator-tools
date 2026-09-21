// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { InfoItemType } from "../../IInfoItemData";
import { ProjectInfoSuite } from "../../IProjectInfoData";
import { defineValidationRule, ValidationRuleDefinition } from "../../tests/ValidationRuleDefinition";

export enum PathLengthFileGeneratorTest {
  filePathExceeds8DirectorySegments = 102,
  filePathExceedsCharacterLength = 103,
  filePathContainsNonLowercaseLetters = 104,
}

const rule = (spec: {
  ruleIndex: number;
  name: string;
  title: string;
  severities: readonly (InfoItemType.error | InfoItemType.warning | InfoItemType.recommendation)[];
}): ValidationRuleDefinition =>
  defineValidationRule({
    generatorId: "PATHLENGTH",
    ruleIndex: spec.ruleIndex,
    name: spec.name,
    title: spec.title,
    severities: spec.severities,
    suites: [ProjectInfoSuite.defaultInDevelopment],
    source: {
      file: "app/src/info/fileGenerators/pathLength/PathLengthFileGeneratorData.ts",
      symbol: "PathLengthValidationRules",
    },
  });

/** The PATHLENGTH validation-rule inventory (see PathLengthFileGenerator). */
export const PathLengthValidationRules: readonly ValidationRuleDefinition[] = [
  rule({
    ruleIndex: PathLengthFileGeneratorTest.filePathExceeds8DirectorySegments,
    name: "filePathExceeds8DirectorySegments",
    title: "File Path Exceeds Directory Segment Limit",
    severities: [InfoItemType.error],
  }),
  rule({
    ruleIndex: PathLengthFileGeneratorTest.filePathExceedsCharacterLength,
    name: "filePathExceedsCharacterLength",
    title: "File Path Exceeds Character Length Limit",
    severities: [InfoItemType.error],
  }),
  rule({
    ruleIndex: PathLengthFileGeneratorTest.filePathContainsNonLowercaseLetters,
    name: "filePathContainsNonLowercaseLetters",
    title: "File Path Contains Non-Lowercase Letters",
    severities: [InfoItemType.recommendation],
  }),
];
