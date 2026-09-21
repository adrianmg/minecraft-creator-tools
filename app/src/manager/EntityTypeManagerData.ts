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
 * Rule metadata for EntityTypeManager (ENTITYTYPE), which validates the
 * format_version of behavior pack entity type definitions against the current
 * product version. 52/53/54 are feature counters and 500/501/509 are
 * internal-processing markers, not validation rules.
 *
 * The missing-format_version rule (100) only fires when the definition file
 * cannot be read as text at all (e.g. an empty file): a parseable definition
 * without a format_version reads as 0.0.0
 * (MinecraftUtilities.getVersionArrayFrom) and is flagged by the lower-major
 * rule (110) instead.
 */

const rule = (spec: {
  ruleIndex: number;
  name: string;
  title: string;
  severities: readonly ValidationSeverity[];
}): ValidationRuleDefinition =>
  defineValidationRule({
    generatorId: "ENTITYTYPE",
    ruleIndex: spec.ruleIndex,
    name: spec.name,
    title: spec.title,
    severities: spec.severities,
    suites: [ProjectInfoSuite.defaultInDevelopment],
    source: {
      file: "app/src/manager/EntityTypeManagerData.ts",
      symbol: "EntityTypeValidationRules",
    },
  });

export const EntityTypeValidationRules: readonly ValidationRuleDefinition[] = [
  rule({
    ruleIndex: 100,
    name: "entityTypeNoFormatVersion",
    title: "Entity Type Format Version Missing",
    severities: [InfoItemType.error],
  }),
  rule({
    ruleIndex: 110,
    name: "entityTypeMajorVersionLowerThanCurrent",
    title: "Entity Type Format Version Major Version Lower than Current",
    severities: [InfoItemType.recommendation],
  }),
  rule({
    ruleIndex: 111,
    name: "entityTypeMajorVersionHigherThanCurrent",
    title: "Entity Type Format Version Major Version Higher than Current",
    severities: [InfoItemType.error],
  }),
  rule({
    ruleIndex: 120,
    name: "entityTypeMinorVersionLowerThanCurrent",
    title: "Entity Type Format Version Minor Version Lower than Current",
    severities: [InfoItemType.recommendation],
  }),
  rule({
    ruleIndex: 121,
    name: "entityTypeMinorVersionHigherThanCurrent",
    title: "Entity Type Format Version Minor Version Higher than Current",
    severities: [InfoItemType.error],
  }),
  rule({
    ruleIndex: 130,
    name: "entityTypePatchVersionLowerThanCurrent",
    title: "Entity Type Format Version Patch Version Lower than Current",
    severities: [InfoItemType.recommendation],
  }),
  rule({
    ruleIndex: 131,
    name: "entityTypePatchVersionHigherThanCurrent",
    title: "Entity Type Format Version Patch Version Higher than Current",
    severities: [InfoItemType.error],
  }),
];
