// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
import { TestDefinition } from "../../tests/TestDefinition";
import { PackType } from "../../../minecraft/Pack";
import { InfoItemType } from "../../IInfoItemData";
import { ProjectInfoSuite } from "../../IProjectInfoData";
import { defineValidationRule, ValidationRuleDefinition } from "../../tests/ValidationRuleDefinition";

export type PackageType = PackType | "WorldTemplate";

export enum ForbiddenTest {
  FailedToReadFile = "FailedToReadFile",
  ExtNotInAllowList = "ExtNotInAllowList",
  InvalidFileName = "InvalidFileName",
  ContainsInvalidCharacter = "ContainsInvalidCharacter",
}

const rule = (spec: { ruleIndex: number; name: string; title: string }) =>
  defineValidationRule({
    generatorId: "FORBFILE",
    ruleIndex: spec.ruleIndex,
    name: spec.name,
    title: spec.title,
    severities: [InfoItemType.error],
    suites: [ProjectInfoSuite.defaultInDevelopment],
    source: {
      file: "app/src/info/projectGenerators/checkForbiddenFiles/CheckForbiddenFilesData.ts",
      symbol: "ForbiddenTests",
    },
  });

export const ForbiddenTests: Record<ForbiddenTest, TestDefinition> = {
  // FailedToReadFile is a reserved slot with no emission site in the
  // generator, so it is not part of the catalogable rule inventory below.
  FailedToReadFile: { id: 101, title: "Failed To Read File" },
  ExtNotInAllowList: rule({ ruleIndex: 102, name: "extNotInAllowList", title: "File Does Not Have Allowed Extension" }),
  InvalidFileName: rule({ ruleIndex: 103, name: "invalidFileName", title: "File Name Is Blocked" }),
  ContainsInvalidCharacter: rule({
    ruleIndex: 104,
    name: "containsInvalidCharacter",
    title: "File Name Contains Invalid Character",
  }),
} as const;

/** The FORBFILE validation-rule inventory (see CheckForbiddenFilesGenerator). */
export const ForbiddenFilesValidationRules: readonly ValidationRuleDefinition[] = [
  ForbiddenTests.ExtNotInAllowList as ValidationRuleDefinition,
  ForbiddenTests.InvalidFileName as ValidationRuleDefinition,
  ForbiddenTests.ContainsInvalidCharacter as ValidationRuleDefinition,
];

const SharedBPRPExtensions = [
  ".json",
  ".txt",
  ".lang",
  ".material",
  ".mcfunction",
  ".nbt",
  ".png",
  ".tga",
  ".jpg",
  ".jpeg",
  ".hdr",
  ".wav",
  ".ogg",
  ".fsb",
  ".mcstructure",
] as const;

export const AllowedExtensionsByType: Record<PackageType, Set<string> | "*"> = {
  [PackType.resource]: new Set([...SharedBPRPExtensions]),
  [PackType.behavior]: new Set([...SharedBPRPExtensions, ".js", ".ts"]),
  [PackType.skin]: new Set([".json", ".lang", ".png", ".tga", ".jpg", ".jpeg", ".mcstructure"]),
  [PackType.persona]: new Set([".json", ".lang", ".png", ".tga", ".mcstructure"]),
  [PackType.design]: "*",
  WorldTemplate: "*",
} as const;

const SharedBPRPBlockedFiles = [
  "font/emoticons.json",
  "credits/end.txt",
  "items_client.json",
  "items_offsets_clients.json",
  "texts/languages_names.json",
  "/shaders",
  "ui/mcoin.png",
] as const;

/* 
  In theory you would want to exclude these when handling "SystemResourcePacks"
  but that seems to be more of a marketplace concept that isn't handled in mctools
*/
const NonSystemResourceBlockedFiles = ["Contents.json"];

export const BlockedFilesByType: Record<PackageType, Set<string>> = {
  [PackType.resource]: new Set([...SharedBPRPBlockedFiles, ...NonSystemResourceBlockedFiles]),
  [PackType.behavior]: new Set([...SharedBPRPBlockedFiles, ...NonSystemResourceBlockedFiles]),
  [PackType.skin]: new Set(["ui/mcoin.png", "/contents.json"]),
  [PackType.persona]: new Set([]),
  [PackType.design]: new Set([]),
  WorldTemplate: new Set(["ui/mcoin.png", "/contents.json"]),
} as const;
