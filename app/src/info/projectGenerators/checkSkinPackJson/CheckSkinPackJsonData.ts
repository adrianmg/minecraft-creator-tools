// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { InfoItemType } from "../../IInfoItemData";
import { ProjectInfoSuite } from "../../IProjectInfoData";
import { TestDefinition } from "../../tests/TestDefinition";
import {
  defineValidationRule,
  ValidationRuleDefinition,
  ValidationSeverity,
} from "../../tests/ValidationRuleDefinition";

const rule = (spec: {
  ruleIndex: number;
  name: string;
  title: string;
  defaultMessage?: string;
  severities?: readonly ValidationSeverity[];
}): ValidationRuleDefinition =>
  defineValidationRule({
    generatorId: "CSPJ",
    ruleIndex: spec.ruleIndex,
    name: spec.name,
    title: spec.title,
    defaultMessage: spec.defaultMessage,
    severities: spec.severities ?? [InfoItemType.error],
    suites: [ProjectInfoSuite.defaultInDevelopment],
    source: {
      file: "app/src/info/projectGenerators/checkSkinPackJson/CheckSkinPackJsonData.ts",
      symbol: `CheckSkinPackJsonTests.${spec.name[0].toUpperCase()}${spec.name.substring(1)}`,
    },
  });

// The very same definitions used to construct results via resultFromTest /
// resultFromTestWithMessage, so the catalog inventory cannot drift from
// production behavior.
export const CheckSkinPackJsonTests = {
  JsonNotFoundFile: rule({
    ruleIndex: 101,
    name: "jsonNotFoundFile",
    title: "Skin Pack Json File Not Found",
    defaultMessage: "skins.json file not found.",
  }),
  InvalidJsonFile: rule({ ruleIndex: 102, name: "invalidJsonFile", title: "Invalid Json File" }),
  InvalidPackLocName: rule({
    ruleIndex: 103,
    name: "invalidPackLocName",
    title: "Invalid Localization Name",
    defaultMessage: "skins.json localization_name and serialize_name must be the same.",
  }),
  TooManyFreeSkins: rule({ ruleIndex: 104, name: "tooManyFreeSkins", title: "More Free Skins Than Allowed" }),
  DuplicateTextures: rule({
    ruleIndex: 105,
    name: "duplicateTextures",
    title: "Duplicate Textures Found",
    severities: [InfoItemType.warning],
  }),
  CapeTextureNotAllowed: rule({ ruleIndex: 106, name: "capeTextureNotAllowed", title: "Cape Texture Not Allowed" }),
  InvalidTextureSize: rule({ ruleIndex: 107, name: "invalidTextureSize", title: "Texture Invalid Size" }),
  MCCreatorPropertyNotAllowed: rule({
    ruleIndex: 108,
    name: "mcCreatorPropertyNotAllowed",
    title: "Minecraft Creator Property Not Allowed",
  }),
  FailedToReadFile: rule({ ruleIndex: 109, name: "failedToReadFile", title: "File Read Failed" }),
  OrphanedTexture: rule({ ruleIndex: 110, name: "orphanedTexture", title: "Texture Not Found in skins.json" }),
  OrphanedLocKey: rule({ ruleIndex: 111, name: "orphanedLocKey", title: "Loc Key Not Found in Lang File" }),
  LocalizedKeyNotFoundInSkinsJson: rule({
    ruleIndex: 112,
    name: "localizedKeyNotFoundInSkinsJson",
    title: "Localized Key Not Found In skins.json",
  }),
  InvalidSpacingOnLocalizedKey: rule({
    ruleIndex: 113,
    name: "invalidSpacingOnLocalizedKey",
    title: "Localized Key Cannot Have Leading Or Trailing Spaces",
  }),
  InvalidSkinType: rule({ ruleIndex: 114, name: "invalidSkinType", title: "Skin Purchase Type Not Allowed" }),
  InvalidSkinModelTarget: rule({
    ruleIndex: 115,
    name: "invalidSkinModelTarget",
    title: "Invalid Skin Model Target",
  }),
  InvalidNumberOfSkins: rule({
    ruleIndex: 116,
    name: "invalidNumberOfSkins",
    title: "Invalid Number Of Skins",
    defaultMessage: "Maximum Allowable skins is: 80",
  }),
} as const;

/**
 * Test slots the generator cannot currently emit, kept out of the coverage
 * catalog inventory: 117-119 have no production check wired up (the
 * outer-area/visibility analysis helpers exist but are never invoked), and
 * 120 is a defensive guard for a pack-resolution state that inference cannot
 * produce (every skin pack manifest registers its pack).
 */
export const CheckSkinPackJsonUnwiredTests: Record<string, TestDefinition> = {
  OuterAreaIsBlank: { id: 117, title: "Outer Area Blank" },
  ModelInvisible: { id: 118, title: "Model Invisible From Some Angles" },
  ModelPartiallyInvisible: { id: 119, title: "Model Partially Invisible", severity: InfoItemType.warning },
  CouldNotFindRelatedPack: {
    id: 120,
    title: "Could Not Find Related Skin Pack",
    defaultMessage: "Could not read skin pack manifest pack",
  },
} as const;

/** The CSPJ validation-rule inventory (every rule the generator can emit). */
export const SkinPackValidationRules: readonly ValidationRuleDefinition[] = Object.values(CheckSkinPackJsonTests);
