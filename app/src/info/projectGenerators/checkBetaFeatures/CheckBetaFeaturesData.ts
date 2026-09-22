// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { TestDefinition } from "../../tests/TestDefinition";
import { ProjectItemType } from "../../../app/IProjectItemData";
import { InfoItemType } from "../../IInfoItemData";
import { ProjectInfoSuite } from "../../IProjectInfoData";
import { defineValidationRule, ValidationRuleDefinition } from "../../tests/ValidationRuleDefinition";

export enum CheckBetaTest {
  UsingBetaFeatures = "UsingBetaFeatures",
  FailedToParseJson = "FailedToParseJson",
  FailedToReadFile = "FailedToReadFile",
}

const rule = (spec: { ruleIndex: number; name: string; title: string; defaultMessage?: string }) =>
  defineValidationRule({
    generatorId: "CBFG",
    ruleIndex: spec.ruleIndex,
    name: spec.name,
    title: spec.title,
    defaultMessage: spec.defaultMessage,
    severities: [InfoItemType.error],
    suites: [ProjectInfoSuite.defaultInDevelopment],
    source: {
      file: "app/src/info/projectGenerators/checkBetaFeatures/CheckBetaFeaturesData.ts",
      symbol: "CheckBetaTests",
    },
  });

export const CheckBetaTests: Record<CheckBetaTest, TestDefinition> = {
  // FailedToReadFile is a read-failure guard: it only fires when a classified
  // item's backing file cannot be loaded at all, a state an on-disk project
  // cannot be in, so it is not part of the catalogable rule inventory below.
  FailedToReadFile: { id: 101, title: "Failed to read file" },
  FailedToParseJson: rule({
    ruleIndex: 102,
    name: "failedToParseJson",
    title: "Failed to parse Json",
    defaultMessage: "Failed to parse json in file",
  }),
  UsingBetaFeatures: rule({
    ruleIndex: 103,
    name: "usingBetaFeatures",
    title: "Using beta features flag in custom definitions is not allowed",
  }),
};

/** The CBFG validation-rule inventory (see CheckBetaFeaturesGenerator). */
export const CheckBetaFeaturesValidationRules: readonly ValidationRuleDefinition[] = [
  CheckBetaTests.FailedToParseJson as ValidationRuleDefinition,
  CheckBetaTests.UsingBetaFeatures as ValidationRuleDefinition,
];

export const JsonTypesToRead = new Set([
  ProjectItemType.behaviorPackManifestJson,
  ProjectItemType.entityTypeBehavior,
  ProjectItemType.blockTypeBehavior,
  ProjectItemType.itemTypeBehavior,
]);
