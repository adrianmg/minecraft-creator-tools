// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { PackType } from "../../../minecraft/Pack";
import { InfoItemType } from "../../IInfoItemData";
import { ProjectInfoSuite } from "../../IProjectInfoData";
import { TestDefinition } from "../../tests/TestDefinition";
import { defineValidationRule, ValidationRuleDefinition } from "../../tests/ValidationRuleDefinition";

export enum VanillaProtectedAssetsInfoGeneratorTest {
  protectedVanillaAssetOverride = 101,
}

export type ProtectedVanillaAssetEntry = {
  packType: PackType;
  protectedPath: string;
  displayPath: string;
};

export const ProtectedVanillaAssetEntries: readonly ProtectedVanillaAssetEntry[] = [
  {
    packType: PackType.behavior,
    protectedPath: "structures/sulfur_spring/",
    displayPath: "behavior/structures/sulfur_spring",
  },
];

export const VanillaProtectedAssetsTests: Record<string, TestDefinition> = {
  protectedVanillaAssetOverride: defineValidationRule({
    generatorId: "VANPRO",
    ruleIndex: VanillaProtectedAssetsInfoGeneratorTest.protectedVanillaAssetOverride,
    name: "protectedVanillaAssetOverride",
    title: "Protected Vanilla Asset Override",
    severities: [InfoItemType.error],
    suites: [ProjectInfoSuite.defaultInDevelopment],
    source: {
      file: "app/src/info/projectGenerators/vanillaProtectedAssetsInfo/VanillaProtectedAssetsInfoGeneratorData.ts",
      symbol: "VanillaProtectedAssetsTests",
    },
  }),
} as const;

/** The VANPRO validation-rule inventory (see VanillaProtectedAssetsInfoGenerator). */
export const VanillaProtectedAssetsValidationRules: readonly ValidationRuleDefinition[] = [
  VanillaProtectedAssetsTests.protectedVanillaAssetOverride as ValidationRuleDefinition,
];
