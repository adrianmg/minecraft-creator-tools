// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { InfoItemType } from "../../IInfoItemData";
import { ProjectInfoSuite } from "../../IProjectInfoData";
import { defineValidationRule, ValidationRuleDefinition } from "../../tests/ValidationRuleDefinition";

export enum PackSizeInfoGeneratorTest {
  overallSize = 101,
  fileCount = 102,
  folderCount = 103,
  contentSize = 104,
  contentFileCount = 105,
  contentFolderCount = 106,
  exceedsRecommendedAddonSize = 401,
  exceedsRecommendedPackageSize = 402,
  zipFileCouldNotBeProcessed = 410,
}

const PackSizeSuites = [ProjectInfoSuite.defaultInDevelopment, ProjectInfoSuite.cooperativeAddOn] as const;

/**
 * The PACKSIZE validation-rule inventory: the 25 MB add-on content ceiling
 * (add-on validations only), the 250 MB general package ceiling, and
 * unreadable container files. Slots 101-106 are size aggregates.
 */
export const PackSizeValidationRules: readonly ValidationRuleDefinition[] = [
  defineValidationRule({
    generatorId: "PACKSIZE",
    ruleIndex: PackSizeInfoGeneratorTest.exceedsRecommendedAddonSize,
    name: "exceedsRecommendedAddonSize",
    title: "Exceeds Recommended Addon Size",
    severities: [InfoItemType.error],
    suites: [...PackSizeSuites],
    source: { file: "app/src/info/projectGenerators/packSizeInfo/PackSizeInfoData.ts", symbol: "PackSizeValidationRules" },
  }),
  defineValidationRule({
    generatorId: "PACKSIZE",
    ruleIndex: PackSizeInfoGeneratorTest.exceedsRecommendedPackageSize,
    name: "exceedsRecommendedPackageSize",
    title: "Exceeds Recommended Package Size",
    severities: [InfoItemType.error],
    suites: [...PackSizeSuites],
    source: { file: "app/src/info/projectGenerators/packSizeInfo/PackSizeInfoData.ts", symbol: "PackSizeValidationRules" },
  }),
  defineValidationRule({
    generatorId: "PACKSIZE",
    ruleIndex: PackSizeInfoGeneratorTest.zipFileCouldNotBeProcessed,
    name: "zipFileCouldNotBeProcessed",
    title: "Zip File Could Not Be Processed",
    severities: [InfoItemType.error],
    suites: [...PackSizeSuites],
    source: { file: "app/src/info/projectGenerators/packSizeInfo/PackSizeInfoData.ts", symbol: "PackSizeValidationRules" },
  }),
];

export interface IPackSizeInfoGeneratorResults {
  size: number;
  fileCounts: number;
  folderCounts: number;
  contentSize: number;
  contentFileCounts: number;
  contentFolderCounts: number;
}
