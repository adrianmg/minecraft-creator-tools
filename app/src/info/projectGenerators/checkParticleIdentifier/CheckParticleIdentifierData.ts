// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { InfoItemType } from "../../IInfoItemData";
import { ProjectInfoSuite } from "../../IProjectInfoData";
import { defineValidationRule, ValidationRuleDefinition } from "../../tests/ValidationRuleDefinition";

export enum CheckParticleIdentifierTest {
  FailedToReadFile = 101,
  FailedToReadVersion = 102,
  InvalidParticleIdentifier = 103,
}

/** The CPARTI validation-rule inventory (see CheckParticleIdentifierGenerator). */
export const ParticleIdentifierValidationRules: readonly ValidationRuleDefinition[] = [
  defineValidationRule({
    generatorId: "CPARTI",
    ruleIndex: CheckParticleIdentifierTest.FailedToReadFile,
    name: "failedToReadFile",
    title: "Particle File Could Not Be Read",
    severities: [InfoItemType.error],
    suites: [ProjectInfoSuite.defaultInDevelopment],
    source: {
      file: "app/src/info/projectGenerators/checkParticleIdentifier/CheckParticleIdentifierData.ts",
      symbol: "ParticleIdentifierValidationRules",
    },
  }),
  defineValidationRule({
    generatorId: "CPARTI",
    ruleIndex: CheckParticleIdentifierTest.FailedToReadVersion,
    name: "failedToReadVersion",
    title: "Particle File Format Version Missing",
    severities: [InfoItemType.error],
    suites: [ProjectInfoSuite.defaultInDevelopment],
    source: {
      file: "app/src/info/projectGenerators/checkParticleIdentifier/CheckParticleIdentifierData.ts",
      symbol: "ParticleIdentifierValidationRules",
    },
  }),
  defineValidationRule({
    generatorId: "CPARTI",
    ruleIndex: CheckParticleIdentifierTest.InvalidParticleIdentifier,
    name: "invalidParticleIdentifier",
    title: "Invalid Particle Identifier",
    severities: [InfoItemType.error],
    suites: [ProjectInfoSuite.defaultInDevelopment],
    source: {
      file: "app/src/info/projectGenerators/checkParticleIdentifier/CheckParticleIdentifierData.ts",
      symbol: "ParticleIdentifierValidationRules",
    },
  }),
];
