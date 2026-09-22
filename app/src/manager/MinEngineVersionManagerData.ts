// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { InfoItemType } from "../info/IInfoItemData";
import { ProjectInfoSuite } from "../info/IProjectInfoData";
import {
  defineValidationRule,
  ValidationRuleDefinition,
  ValidationSeverity,
} from "../info/tests/ValidationRuleDefinition";

/**
 * Rule metadata for MinEngineVersionManager (MINENGINEVER). Only rule slots
 * the generator can actually emit are inventoried: there are no patch-level
 * min_engine_version checks in production, so the patch enum slots
 * (130/131/230/231) and the unused versionProcessingErrorsFound slot (181)
 * are deliberately absent. 500/501 are internal-processing markers, not
 * validation rules. Indices mirror MinEngineVersionManagerTest (numeric
 * literals here to avoid a module cycle with the manager).
 */

const rule = (spec: {
  ruleIndex: number;
  name: string;
  title: string;
  severities: readonly ValidationSeverity[];
}): ValidationRuleDefinition =>
  defineValidationRule({
    generatorId: "MINENGINEVER",
    ruleIndex: spec.ruleIndex,
    name: spec.name,
    title: spec.title,
    severities: spec.severities,
    suites: [
      ProjectInfoSuite.defaultInDevelopment,
      ProjectInfoSuite.currentPlatformVersions,
      ProjectInfoSuite.cooperativeAddOn,
    ],
    source: {
      file: "app/src/manager/MinEngineVersionManagerData.ts",
      symbol: "MinEngineVersionValidationRules",
    },
  });

export const MinEngineVersionValidationRules: readonly ValidationRuleDefinition[] = [
  rule({
    ruleIndex: 100,
    name: "behaviorPackMinEngineVersion",
    title: "Behavior Pack Min Engine Version Defined",
    severities: [InfoItemType.error],
  }),
  rule({
    ruleIndex: 110,
    name: "behaviorPackMinEngineVersionMajorLowerThanCurrent",
    title: "Behavior Pack Min Engine Version Major Version Lower than Current",
    severities: [InfoItemType.recommendation, InfoItemType.error],
  }),
  rule({
    ruleIndex: 111,
    name: "behaviorPackMinEngineVersionMajorHigherThanCurrent",
    title: "Behavior Pack Min Engine Version Major Version Higher than Current",
    severities: [InfoItemType.error],
  }),
  rule({
    ruleIndex: 120,
    name: "behaviorPackMinEngineVersionMinorLowerThanCurrent",
    title: "Behavior Pack Min Engine Version Minor Version Lower than Current",
    severities: [InfoItemType.recommendation, InfoItemType.error],
  }),
  rule({
    ruleIndex: 121,
    name: "behaviorPackMinEngineVersionMinorHigherThanCurrent",
    title: "Behavior Pack Min Engine Version Minor Version Higher than Current",
    severities: [InfoItemType.error],
  }),
  rule({
    ruleIndex: 180,
    name: "noPackManifestFound",
    title: "No Pack Manifest Found",
    severities: [InfoItemType.error],
  }),
  rule({
    ruleIndex: 200,
    name: "resourcePackMinEngineVersion",
    title: "Resource Pack Min Engine Version Defined",
    severities: [InfoItemType.error],
  }),
  rule({
    ruleIndex: 210,
    name: "resourcePackMinEngineVersionMajorLowerThanCurrent",
    title: "Resource Pack Min Engine Version Major Version Lower than Current",
    severities: [InfoItemType.error],
  }),
  rule({
    ruleIndex: 211,
    name: "resourcePackMinEngineVersionMajorHigherThanCurrent",
    title: "Resource Pack Min Engine Version Major Version Higher than Current",
    severities: [InfoItemType.error],
  }),
  rule({
    ruleIndex: 220,
    name: "resourcePackMinEngineVersionMinorLowerThanCurrent",
    title: "Resource Pack Min Engine Version Minor Version Lower than Current",
    severities: [InfoItemType.recommendation, InfoItemType.error],
  }),
  rule({
    ruleIndex: 221,
    name: "resourcePackMinEngineVersionMinorHigherThanCurrent",
    title: "Resource Pack Min Engine Version Minor Version Higher than Current",
    severities: [InfoItemType.error],
  }),
];
