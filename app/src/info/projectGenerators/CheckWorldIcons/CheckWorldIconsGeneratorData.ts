// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import IFile from "../../../storage/IFile";
import IFolder from "../../../storage/IFolder";
import { InfoItemType } from "../../IInfoItemData";
import { ProjectInfoSuite } from "../../IProjectInfoData";
import { defineValidationRule, ValidationRuleDefinition } from "../../tests/ValidationRuleDefinition";

export enum CheckWorldIconsGeneratorTest {
  NoIconFound = 101,
  MultipleIconsFound = 102,
  IconNotValidImage = 103,
  IconNotValidSize = 104,
}

/** The CWI validation-rule inventory (see CheckWorldIconsGenerator). */
export const WorldIconValidationRules: readonly ValidationRuleDefinition[] = [
  defineValidationRule({
    generatorId: "CWI",
    ruleIndex: CheckWorldIconsGeneratorTest.NoIconFound,
    name: "noIconFound",
    title: "World Icon Not Found",
    severities: [InfoItemType.error],
    suites: [ProjectInfoSuite.defaultInDevelopment],
    source: {
      file: "app/src/info/projectGenerators/CheckWorldIcons/CheckWorldIconsGeneratorData.ts",
      symbol: "WorldIconValidationRules",
    },
  }),
  defineValidationRule({
    generatorId: "CWI",
    ruleIndex: CheckWorldIconsGeneratorTest.MultipleIconsFound,
    name: "multipleIconsFound",
    title: "Multiple World Icons Found",
    severities: [InfoItemType.error],
    suites: [ProjectInfoSuite.defaultInDevelopment],
    source: {
      file: "app/src/info/projectGenerators/CheckWorldIcons/CheckWorldIconsGeneratorData.ts",
      symbol: "WorldIconValidationRules",
    },
  }),
  defineValidationRule({
    generatorId: "CWI",
    ruleIndex: CheckWorldIconsGeneratorTest.IconNotValidImage,
    name: "iconNotValidImage",
    title: "World Icon Is Not a Valid Image",
    severities: [InfoItemType.error],
    suites: [ProjectInfoSuite.defaultInDevelopment],
    source: {
      file: "app/src/info/projectGenerators/CheckWorldIcons/CheckWorldIconsGeneratorData.ts",
      symbol: "WorldIconValidationRules",
    },
  }),
  defineValidationRule({
    generatorId: "CWI",
    ruleIndex: CheckWorldIconsGeneratorTest.IconNotValidSize,
    name: "iconNotValidSize",
    title: "World Icon Is Not a Valid Size",
    severities: [InfoItemType.error],
    suites: [ProjectInfoSuite.defaultInDevelopment],
    source: {
      file: "app/src/info/projectGenerators/CheckWorldIcons/CheckWorldIconsGeneratorData.ts",
      symbol: "WorldIconValidationRules",
    },
  }),
];

/**
 * Creates a minimal IFolder stub whose direct files dictionary contains the given files.
 */
export function createStubFolderWithFiles(files: IFile[]): IFolder {
  const fileMap: { [name: string]: IFile | undefined } = {};

  for (const file of files) {
    fileMap[file.name] = file;
  }

  return {
    files: fileMap,
    load: async () => new Date(),
    getFolderRelativePath: () => "test-world/",
  } as unknown as IFolder;
}
