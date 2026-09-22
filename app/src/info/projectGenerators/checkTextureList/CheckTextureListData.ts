// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { InfoItemType } from "../../IInfoItemData";
import { ProjectInfoSuite } from "../../IProjectInfoData";
import { defineValidationRule, ValidationRuleDefinition } from "../../tests/ValidationRuleDefinition";

export enum CheckTextureListGeneratorTest {
  textureNotInTextureList = 101,
  textureSetImageInTextureList = 102,
}

/** The TEXTURELIST validation-rule inventory (see CheckTextureListGenerator). */
export const TextureListValidationRules: readonly ValidationRuleDefinition[] = [
  defineValidationRule({
    generatorId: "TEXTURELIST",
    ruleIndex: CheckTextureListGeneratorTest.textureNotInTextureList,
    name: "textureNotInTextureList",
    title: "Texture Not Referenced in texture_list.json",
    severities: [InfoItemType.error],
    suites: [ProjectInfoSuite.defaultInDevelopment],
    source: {
      file: "app/src/info/projectGenerators/checkTextureList/CheckTextureListData.ts",
      symbol: "TextureListValidationRules",
    },
  }),
  defineValidationRule({
    generatorId: "TEXTURELIST",
    ruleIndex: CheckTextureListGeneratorTest.textureSetImageInTextureList,
    name: "textureSetImageInTextureList",
    title: "Texture Set Image Referenced in texture_list.json",
    severities: [InfoItemType.error],
    suites: [ProjectInfoSuite.defaultInDevelopment],
    source: {
      file: "app/src/info/projectGenerators/checkTextureList/CheckTextureListData.ts",
      symbol: "TextureListValidationRules",
    },
  }),
];
