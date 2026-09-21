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
 * Rule metadata for ItemTypeManager (ITEMTYPE), which validates the
 * format_version of behavior pack item type definitions against the current
 * product version. 53/54/55 are feature counters and 500/501 are
 * internal-processing markers, not validation rules.
 *
 * Unlike EntityTypeManager, the missing-format_version rule (100) checks the
 * raw format_version property, so it fires for any parseable definition that
 * omits it.
 */

const rule = (spec: {
  ruleIndex: number;
  name: string;
  title: string;
  severities: readonly ValidationSeverity[];
}): ValidationRuleDefinition =>
  defineValidationRule({
    generatorId: "ITEMTYPE",
    ruleIndex: spec.ruleIndex,
    name: spec.name,
    title: spec.title,
    severities: spec.severities,
    suites: [ProjectInfoSuite.defaultInDevelopment],
    source: {
      file: "app/src/manager/ItemTypeManagerData.ts",
      symbol: "ItemTypeValidationRules",
    },
  });

export const ItemTypeValidationRules: readonly ValidationRuleDefinition[] = [
  rule({
    ruleIndex: 100,
    name: "itemTypeNoFormatVersion",
    title: "Item Type Format Version Missing",
    severities: [InfoItemType.error],
  }),
  rule({
    ruleIndex: 110,
    name: "itemTypeMajorVersionLowerThanCurrent",
    title: "Item Type Format Version Major Version Lower than Current",
    severities: [InfoItemType.recommendation],
  }),
  rule({
    ruleIndex: 111,
    name: "itemTypeMajorVersionHigherThanCurrent",
    title: "Item Type Format Version Major Version Higher than Current",
    severities: [InfoItemType.error],
  }),
  rule({
    ruleIndex: 120,
    name: "itemTypeMinorVersionLowerThanCurrent",
    title: "Item Type Format Version Minor Version Lower than Current",
    severities: [InfoItemType.recommendation],
  }),
  rule({
    ruleIndex: 121,
    name: "itemTypeMinorVersionHigherThanCurrent",
    title: "Item Type Format Version Minor Version Higher than Current",
    severities: [InfoItemType.error],
  }),
  rule({
    ruleIndex: 130,
    name: "itemTypePatchVersionLowerThanCurrent",
    title: "Item Type Format Version Patch Version Lower than Current",
    severities: [InfoItemType.recommendation],
  }),
  rule({
    ruleIndex: 131,
    name: "itemTypePatchVersionHigherThanCurrent",
    title: "Item Type Format Version Patch Version Higher than Current",
    severities: [InfoItemType.error],
  }),
];
