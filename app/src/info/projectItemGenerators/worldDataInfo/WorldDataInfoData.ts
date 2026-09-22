// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { InfoItemType } from "../../IInfoItemData";
import { ProjectInfoSuite } from "../../IProjectInfoData";
import {
  defineValidationRule,
  ValidationRuleDefinition,
  ValidationSeverity,
} from "../../tests/ValidationRuleDefinition";

export enum WorldDataInfoGeneratorTest {
  unexpectedCommandInMCFunction = 101,
  unexpectedCommandInCommandBlock = 102,
  minX = 103,
  minZ = 104,
  maxX = 105,
  maxZ = 106,
  containsWorldImpactingCommand = 112,
  blocks = 121,
  blockData = 122,
  command = 123,
  executeSubCommand = 124,
  levelDat = 125,
  levelDatExperiments = 126,
  subchunklessChunks = 127,
  chunks = 128,
  commandIsFromOlderMinecraftVersion = 212,
  couldNotProcessWorld = 216,
  errorProcessingWorld = 400,
  unexpectedError = 401,
}

export const MaxWorldRecordsToProcess = 3000000; // very crudely, this equates to about 100K chunks

const rule = (spec: {
  ruleIndex: number;
  name: string;
  title: string;
  severities: readonly ValidationSeverity[];
}): ValidationRuleDefinition =>
  defineValidationRule({
    generatorId: "WORLDDATA",
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
      file: "app/src/info/projectItemGenerators/worldDataInfo/WorldDataInfoData.ts",
      symbol: "WorldDataValidationRules",
    },
  });

/**
 * The WORLDDATA validation-rule inventory. Command checks are suite-gated:
 * unknown commands (102) only fire outside the add-on/platform suites, and
 * world-impacting commands (112) only under add-on validations. Slots
 * 101/401 are unused enum entries, 216 is informational, and the remaining
 * slots are aggregates — none of those are validation rules.
 */
export const WorldDataValidationRules: readonly ValidationRuleDefinition[] = [
  rule({
    ruleIndex: WorldDataInfoGeneratorTest.unexpectedCommandInCommandBlock,
    name: "unexpectedCommandInCommandBlock",
    title: "Unexpected Command",
    severities: [InfoItemType.error],
  }),
  rule({
    ruleIndex: WorldDataInfoGeneratorTest.containsWorldImpactingCommand,
    name: "containsWorldImpactingCommand",
    title: "Contains World-Impacting Command",
    severities: [InfoItemType.warning],
  }),
  rule({
    ruleIndex: WorldDataInfoGeneratorTest.commandIsFromOlderMinecraftVersion,
    name: "commandIsFromOlderMinecraftVersion",
    title: "Command Is From an Older Minecraft Version",
    severities: [InfoItemType.recommendation],
  }),
  rule({
    ruleIndex: WorldDataInfoGeneratorTest.errorProcessingWorld,
    name: "errorProcessingWorld",
    title: "Error Processing World",
    severities: [InfoItemType.error],
  }),
];
