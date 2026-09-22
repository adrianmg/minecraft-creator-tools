// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { TestDefinition } from "../../tests/TestDefinition";
import { InfoItemType } from "../../IInfoItemData";
import { ProjectInfoSuite } from "../../IProjectInfoData";
import { defineValidationRule, ValidationRuleDefinition } from "../../tests/ValidationRuleDefinition";

export enum CheckIntegrityTest {
  OrphanedFile = "OrphanedFile",
  UnexpectedManifest = "UnexpectedManifest",
}

const rule = (spec: { ruleIndex: number; name: string; title: string; defaultMessage?: string }) =>
  defineValidationRule({
    generatorId: "PRJINT",
    ruleIndex: spec.ruleIndex,
    name: spec.name,
    title: spec.title,
    defaultMessage: spec.defaultMessage,
    severities: [InfoItemType.error],
    suites: [ProjectInfoSuite.defaultInDevelopment],
    source: {
      file: "app/src/info/projectGenerators/checkProjectIntegrity/CheckProjectIntegrityData.ts",
      symbol: "CheckIntegrityTests",
    },
  });

export const CheckIntegrityTests: Record<CheckIntegrityTest, TestDefinition> = {
  OrphanedFile: rule({
    ruleIndex: 101,
    name: "orphanedFile",
    title: "Extraneous Files Or Folder",
    defaultMessage: "Project contains extraneous file or folder",
  }),
  UnexpectedManifest: rule({
    ruleIndex: 102,
    name: "unexpectedManifest",
    title: "Unexpected Manifest Structure",
    defaultMessage: "Pack has an unexpected structure, multiple manifests detected. Nested manifests are not allowed.",
  }),
};

/** The PRJINT validation-rule inventory (see CheckProjectIntegrityGenerator). */
export const CheckProjectIntegrityValidationRules: readonly ValidationRuleDefinition[] = [
  CheckIntegrityTests.OrphanedFile as ValidationRuleDefinition,
  CheckIntegrityTests.UnexpectedManifest as ValidationRuleDefinition,
];
