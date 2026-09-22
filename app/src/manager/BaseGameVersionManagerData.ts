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
 * Rule metadata for BaseGameVersionManager (BASEGAMEVER), which validates
 * header/base_game_version on world template manifests against the current
 * product version. 500/501 are internal-processing markers, not validation
 * rules.
 */

const rule = (spec: {
  ruleIndex: number;
  name: string;
  title: string;
  severities: readonly ValidationSeverity[];
}): ValidationRuleDefinition =>
  defineValidationRule({
    generatorId: "BASEGAMEVER",
    ruleIndex: spec.ruleIndex,
    name: spec.name,
    title: spec.title,
    severities: spec.severities,
    suites: [ProjectInfoSuite.defaultInDevelopment, ProjectInfoSuite.currentPlatformVersions],
    source: {
      file: "app/src/manager/BaseGameVersionManagerData.ts",
      symbol: "BaseGameVersionValidationRules",
    },
  });

export const BaseGameVersionValidationRules: readonly ValidationRuleDefinition[] = [
  rule({
    ruleIndex: 100,
    name: "baseGameVersionMissing",
    title: "World Template Base Game Version Defined",
    severities: [InfoItemType.error],
  }),
  rule({
    ruleIndex: 110,
    name: "baseGameVersionMajorLowerThanCurrent",
    title: "World Template Base Game Version Major Version Lower than Current",
    severities: [InfoItemType.recommendation, InfoItemType.error],
  }),
  rule({
    ruleIndex: 111,
    name: "baseGameVersionMajorHigherThanCurrent",
    title: "World Template Base Game Version Major Version Higher than Current",
    severities: [InfoItemType.error],
  }),
  rule({
    ruleIndex: 120,
    name: "baseGameVersionMinorLowerThanCurrent",
    title: "World Template Base Game Version Minor Version Below the Supported Window",
    severities: [InfoItemType.recommendation, InfoItemType.error],
  }),
  rule({
    ruleIndex: 121,
    name: "baseGameVersionMinorHigherThanCurrent",
    title: "World Template Base Game Version Minor Version Higher than Current",
    severities: [InfoItemType.error],
  }),
  rule({
    ruleIndex: 130,
    name: "baseGameVersionPatchLowerThanCurrent",
    title: "World Template Base Game Version Patch Version Lower than Current",
    severities: [InfoItemType.recommendation],
  }),
  rule({
    ruleIndex: 131,
    name: "baseGameVersionPatchHigherThanCurrent",
    title: "World Template Base Game Version Patch Version Higher than Current",
    severities: [InfoItemType.error],
  }),
];
