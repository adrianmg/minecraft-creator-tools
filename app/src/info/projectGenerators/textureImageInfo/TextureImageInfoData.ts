// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { InfoItemType } from "../../IInfoItemData";
import { ProjectInfoSuite } from "../../IProjectInfoData";
import {
  defineValidationRule,
  ValidationRuleDefinition,
  ValidationSeverity,
} from "../../tests/ValidationRuleDefinition";

export enum TextureImageInfoGeneratorTest {
  textureImages = 101,
  textureImagesTier0 = 200,
  textureImagesTier1 = 201,
  textureImagesTier2 = 202,
  textureImagesTier3 = 203,
  textureImagesTier4 = 204,
  textureImagesTier5 = 205,
  pngJpgImageProcessingError = 401,
  individualTextureMemoryExceedsBudget = 402,
  totalTextureMemoryExceedsBudget = 403,
  tgaImageProcessingError = 404,
  individualAtlasTextureMemoryExceedsBudget = 405,
  totalAtlasTextureMemoryExceedsBudgetWarn = 406,
  totalAtlasTextureMemoryExceedsBudgetError = 407,
  pngJpgImageProcessingNoResults = 408,
  invalidTieringConfiguration = 409,
  invalidTieringForVibrantVisuals = 410,
  individualTextureHighestResolutionMipExceedsFourMiB = 411,

  totalTextureMemoryExceedsBudgetErrorBase = 420,
  totalTextureMemoryExceedsBudgetWarningBase = 440,
  texturePackDoesntOverrideVanillaGameTexture = 460,
  texturePackDoesntOverrideMostTextures = 461,
  mashupPackDoesntOverrideMostTextures = 462,
  baseContentUnusedInLowerTierSubpacks = 463,
  subpackTierOneLoadsMers = 464,
}

export const TexturePerformanceTierCount = 6;

const rule = (spec: {
  ruleIndex: number;
  name: string;
  title: string;
  severities: readonly ValidationSeverity[];
}): ValidationRuleDefinition =>
  defineValidationRule({
    generatorId: "TEXTUREIMAGE",
    ruleIndex: spec.ruleIndex,
    name: spec.name,
    title: spec.title,
    severities: spec.severities,
    suites: [ProjectInfoSuite.defaultInDevelopment],
    source: {
      file: "app/src/info/projectGenerators/textureImageInfo/TextureImageInfoData.ts",
      symbol: "TextureImageValidationRules",
    },
  });

const tierRuleNames = ["Zero", "One", "Two", "Three", "Four", "Five"] as const;

/**
 * The TEXTUREIMAGE validation-rule inventory: texture memory budgets
 * (individual, atlas, and per-performance-tier totals), tier configuration
 * consistency, image readability, and the texture-pack/mashup vanilla
 * override coverage checks. Aggregate slots (101, 200-205) are info items,
 * 404 is an internal-processing marker, and 401 is an unused enum slot —
 * none of those are validation rules.
 */
export const TextureImageValidationRules: readonly ValidationRuleDefinition[] = [
  rule({
    ruleIndex: TextureImageInfoGeneratorTest.individualTextureMemoryExceedsBudget,
    name: "individualTextureMemoryExceedsBudget",
    title: "Individual Loose Texture Memory Exceeds Budget",
    severities: [InfoItemType.warning],
  }),
  rule({
    ruleIndex: TextureImageInfoGeneratorTest.totalTextureMemoryExceedsBudget,
    name: "totalTextureMemoryExceedsBudget",
    title: "Total Texture Memory Exceeds Budget",
    severities: [InfoItemType.error],
  }),
  rule({
    ruleIndex: TextureImageInfoGeneratorTest.individualAtlasTextureMemoryExceedsBudget,
    name: "individualAtlasTextureMemoryExceedsBudget",
    title: "Individual Atlassed Texture Memory Exceeds Budget",
    severities: [InfoItemType.warning],
  }),
  rule({
    ruleIndex: TextureImageInfoGeneratorTest.totalAtlasTextureMemoryExceedsBudgetWarn,
    name: "totalAtlasTextureMemoryExceedsBudgetWarn",
    title: "Total Atlas Texture Memory Exceeds Recommended Budget",
    severities: [InfoItemType.warning],
  }),
  rule({
    ruleIndex: TextureImageInfoGeneratorTest.totalAtlasTextureMemoryExceedsBudgetError,
    name: "totalAtlasTextureMemoryExceedsBudgetError",
    title: "Total Atlas Texture Memory Exceeds Hard Limit",
    severities: [InfoItemType.error],
  }),
  rule({
    ruleIndex: TextureImageInfoGeneratorTest.pngJpgImageProcessingNoResults,
    name: "pngJpgImageProcessingNoResults",
    title: "Could Not Extract Image Metadata",
    severities: [InfoItemType.warning],
  }),
  rule({
    ruleIndex: TextureImageInfoGeneratorTest.invalidTieringConfiguration,
    name: "invalidTieringConfiguration",
    title: "Invalid Performance Tiering Configuration",
    severities: [InfoItemType.error],
  }),
  rule({
    ruleIndex: TextureImageInfoGeneratorTest.invalidTieringForVibrantVisuals,
    name: "invalidTieringForVibrantVisuals",
    title: "Invalid Tiering For Vibrant Visuals",
    severities: [InfoItemType.error],
  }),
  rule({
    ruleIndex: TextureImageInfoGeneratorTest.individualTextureHighestResolutionMipExceedsFourMiB,
    name: "individualTextureHighestResolutionMipExceedsFourMiB",
    title: "Individual Texture Highest-Resolution Mip Exceeds 4 MiB",
    severities: [InfoItemType.warning],
  }),
  ...tierRuleNames.map((tierName, tier) =>
    rule({
      ruleIndex: TextureImageInfoGeneratorTest.totalTextureMemoryExceedsBudgetErrorBase + tier,
      name: `totalTextureMemoryExceedsBudgetErrorTier${tierName}`,
      title: `Total Texture Memory Exceeds Budget at Targeted Tier ${tier}`,
      severities: [InfoItemType.error],
    })
  ),
  ...tierRuleNames.map((tierName, tier) =>
    rule({
      ruleIndex: TextureImageInfoGeneratorTest.totalTextureMemoryExceedsBudgetWarningBase + tier,
      name: `totalTextureMemoryExceedsBudgetWarningTier${tierName}`,
      title: `Total Texture Memory Exceeds Budget at Tier ${tier}`,
      severities: [InfoItemType.warning],
    })
  ),
  rule({
    ruleIndex: TextureImageInfoGeneratorTest.texturePackDoesntOverrideVanillaGameTexture,
    name: "texturePackDoesntOverrideVanillaGameTexture",
    title: "Texture Pack Does Not Override a Vanilla Game Texture",
    severities: [InfoItemType.warning],
  }),
  rule({
    ruleIndex: TextureImageInfoGeneratorTest.texturePackDoesntOverrideMostTextures,
    name: "texturePackDoesntOverrideMostTextures",
    title: "Texture Pack Does Not Override Most Vanilla Textures",
    severities: [InfoItemType.error],
  }),
  rule({
    ruleIndex: TextureImageInfoGeneratorTest.mashupPackDoesntOverrideMostTextures,
    name: "mashupPackDoesntOverrideMostTextures",
    title: "Mashup Pack Does Not Override Most Vanilla Textures",
    severities: [InfoItemType.error],
  }),
  rule({
    ruleIndex: TextureImageInfoGeneratorTest.baseContentUnusedInLowerTierSubpacks,
    name: "baseContentUnusedInLowerTierSubpacks",
    title: "Base Pack Content Unused Below Lowest Subpack Tier",
    severities: [InfoItemType.warning],
  }),
  rule({
    ruleIndex: TextureImageInfoGeneratorTest.subpackTierOneLoadsMers,
    name: "subpackTierOneLoadsMers",
    title: "Tier One Subpack Loads MER/MERS Material Files",
    severities: [InfoItemType.error],
  }),
];
