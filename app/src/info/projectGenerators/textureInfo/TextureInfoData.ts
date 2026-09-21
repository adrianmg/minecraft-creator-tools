// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { InfoItemType } from "../../IInfoItemData";
import { ProjectInfoSuite } from "../../IProjectInfoData";
import { defineValidationRule, ValidationRuleDefinition } from "../../tests/ValidationRuleDefinition";

export enum TextureInfoGeneratorTest {
  tooManyTextureHandles = 100,
  textures = 101,
}

/**
 * The TEXTURE validation-rule inventory. The texture-handle ceiling only
 * applies under add-on validations (the cooperativeAddOn suite); slot 101
 * is the feature aggregate, not a rule.
 */
export const TextureValidationRules: readonly ValidationRuleDefinition[] = [
  defineValidationRule({
    generatorId: "TEXTURE",
    ruleIndex: TextureInfoGeneratorTest.tooManyTextureHandles,
    name: "tooManyTextureHandles",
    title: "Too Many Texture Handles",
    severities: [InfoItemType.error],
    suites: [ProjectInfoSuite.defaultInDevelopment, ProjectInfoSuite.cooperativeAddOn],
    source: {
      file: "app/src/info/projectGenerators/textureInfo/TextureInfoData.ts",
      symbol: "TextureValidationRules",
    },
  }),
];
