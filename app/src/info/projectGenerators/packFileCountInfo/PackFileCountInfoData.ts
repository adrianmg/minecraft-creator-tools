// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { InfoItemType } from "../../IInfoItemData";
import { ProjectInfoSuite } from "../../IProjectInfoData";
import { defineValidationRule, ValidationRuleDefinition } from "../../tests/ValidationRuleDefinition";

export enum PackFileCountInfoGeneratorTest {
  fileCount = 101,
  exceedsRecommendedFileCount = 401,
  maxTraversalDepthExceeded = 402,
}

/** The PACKFILECOUNT validation-rule inventory (101 is the count aggregate). */
export const PackFileCountValidationRules: readonly ValidationRuleDefinition[] = [
  defineValidationRule({
    generatorId: "PACKFILECOUNT",
    ruleIndex: PackFileCountInfoGeneratorTest.exceedsRecommendedFileCount,
    name: "exceedsRecommendedFileCount",
    title: "Exceeds Recommended File Count",
    severities: [InfoItemType.warning],
    suites: [ProjectInfoSuite.defaultInDevelopment],
    source: {
      file: "app/src/info/projectGenerators/packFileCountInfo/PackFileCountInfoData.ts",
      symbol: "PackFileCountValidationRules",
    },
  }),
  defineValidationRule({
    generatorId: "PACKFILECOUNT",
    ruleIndex: PackFileCountInfoGeneratorTest.maxTraversalDepthExceeded,
    name: "maxTraversalDepthExceeded",
    title: "Maximum Folder Traversal Depth Exceeded",
    severities: [InfoItemType.warning],
    suites: [ProjectInfoSuite.defaultInDevelopment],
    source: {
      file: "app/src/info/projectGenerators/packFileCountInfo/PackFileCountInfoData.ts",
      symbol: "PackFileCountValidationRules",
    },
  }),
];

export interface IPackFileCountInfoGeneratorResults {
  fileCount: number;

  // Number of subfolders that were not traversed because MaxFolderTraversalDepth
  // was reached. When > 0, fileCount is a lower bound (undercount).
  skippedFolderCount: number;
}

export const RecommendedMaxFileCount = 10000;

// Maximum folder nesting depth we recursively descend into while counting files.
// Guards against pathological/cyclic structures. Real packs are bounded well below
// this by the OS maximum filepath length, so reaching it is a strong signal of a
// problem rather than legitimate content.
export const MaxFolderTraversalDepth = 15;
