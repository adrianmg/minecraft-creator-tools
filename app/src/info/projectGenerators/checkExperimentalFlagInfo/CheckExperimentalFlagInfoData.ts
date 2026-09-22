// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { InfoItemType } from "../../IInfoItemData";
import { ProjectInfoSuite } from "../../IProjectInfoData";
import { defineValidationRule, ValidationRuleDefinition } from "../../tests/ValidationRuleDefinition";

export enum CheckExperimentalFlagInfoGeneratorTest {
  flagIsOrWasTrue = 101,
  levelDatNotFound = 102,
  worldNotFound = 103,
}

const rule = (spec: { ruleIndex: number; name: string; title: string }) =>
  defineValidationRule({
    generatorId: "EXPFLAG",
    ruleIndex: spec.ruleIndex,
    name: spec.name,
    title: spec.title,
    severities: [InfoItemType.warning],
    suites: [ProjectInfoSuite.defaultInDevelopment],
    source: {
      file: "app/src/info/projectGenerators/checkExperimentalFlagInfo/CheckExperimentalFlagInfoData.ts",
      symbol: "CheckExperimentalFlagValidationRules",
    },
  });

/**
 * The EXPFLAG validation-rule inventory. Slot 103 (worldNotFound) is a
 * load-failure guard: MCWorld.ensureOnItem only returns undefined for an
 * item with neither a folder nor a file behind it, a state a real project
 * cannot produce, so it is not part of the catalogable inventory.
 */
export const CheckExperimentalFlagValidationRules: readonly ValidationRuleDefinition[] = [
  rule({
    ruleIndex: CheckExperimentalFlagInfoGeneratorTest.flagIsOrWasTrue,
    name: "flagIsOrWasTrue",
    title: "Experimental Gameplay Is or Was Enabled",
  }),
  rule({
    ruleIndex: CheckExperimentalFlagInfoGeneratorTest.levelDatNotFound,
    name: "levelDatNotFound",
    title: "Level.dat Not Found in World",
  }),
];
