// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { InfoItemType } from "../info/IInfoItemData";
import { ProjectInfoSuite } from "../info/IProjectInfoData";
import { defineValidationRule, ValidationRuleDefinition } from "../info/tests/ValidationRuleDefinition";

/**
 * Rule metadata for ScriptModuleManager (SCRIPTMODULE), which validates
 * @minecraft/* script module dependencies declared in behavior pack manifests
 * against their npm registry descriptors and package.json registrations.
 * 100/101/102 are informational dependency inventory items, not validation
 * rules. The package.json rules (110/111) only apply when the project has a
 * package.json at all; module lookups resolve through
 * Database.getModuleDescriptor (seedable via Database.moduleDescriptors for
 * deterministic tests).
 */

const rule = (spec: { ruleIndex: number; name: string; title: string }): ValidationRuleDefinition =>
  defineValidationRule({
    generatorId: "SCRIPTMODULE",
    ruleIndex: spec.ruleIndex,
    name: spec.name,
    title: spec.title,
    severities: [InfoItemType.error],
    suites: [ProjectInfoSuite.defaultInDevelopment],
    source: {
      file: "app/src/manager/ScriptModuleManagerData.ts",
      symbol: "ScriptModuleValidationRules",
    },
  });

export const ScriptModuleValidationRules: readonly ValidationRuleDefinition[] = [
  rule({
    ruleIndex: 110,
    name: "packageJsonRegistrationMissing",
    title: "Script Module Not Registered in package.json",
  }),
  rule({
    ruleIndex: 111,
    name: "npmModuleRegistrationMissing",
    title: "Script Module Not Registered on NPM",
  }),
  rule({
    ruleIndex: 114,
    name: "outOfDateBetaVersion",
    title: "Script Module Beta Version Out of Date",
  }),
];
