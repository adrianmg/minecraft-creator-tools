// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { InfoItemType } from "../../IInfoItemData";
import { ProjectInfoSuite } from "../../IProjectInfoData";
import { defineValidationRule, ValidationRuleDefinition } from "../../tests/ValidationRuleDefinition";

export enum SoundsDefinitionInfoGeneratorTest {
  multipleSoundsDefinitionManifests = 101,
  invalidSoundsDefinitionManifest = 102,
  soundsDefinitionManifestInvalidJson = 103,
  foundALooseSoundDefinition = 104,
}

const rule = (spec: { ruleIndex: number; name: string; title: string }) =>
  defineValidationRule({
    generatorId: "SNDSDEF",
    ruleIndex: spec.ruleIndex,
    name: spec.name,
    title: spec.title,
    severities: [InfoItemType.error],
    suites: [ProjectInfoSuite.defaultInDevelopment],
    source: {
      file: "app/src/info/projectGenerators/SoundDefinitionsInfo/SoundDefinitionsInfoGeneratorData.ts",
      symbol: `SoundsDefinitionInfoGeneratorTest.${spec.name}`,
    },
  });

/** The SNDSDEF validation-rule inventory (see SoundsDefinitionInfoGenerator). */
export const SoundDefinitionsValidationRules: readonly ValidationRuleDefinition[] = [
  rule({
    ruleIndex: SoundsDefinitionInfoGeneratorTest.multipleSoundsDefinitionManifests,
    name: "multipleSoundsDefinitionManifests",
    title: "Multiple Sounds Definition Manifests",
  }),
  rule({
    ruleIndex: SoundsDefinitionInfoGeneratorTest.invalidSoundsDefinitionManifest,
    name: "invalidSoundsDefinitionManifest",
    title: "Invalid Sounds Definition Manifest",
  }),
  rule({
    ruleIndex: SoundsDefinitionInfoGeneratorTest.soundsDefinitionManifestInvalidJson,
    name: "soundsDefinitionManifestInvalidJson",
    title: "Sounds Definition Manifest Invalid Json",
  }),
  rule({
    ruleIndex: SoundsDefinitionInfoGeneratorTest.foundALooseSoundDefinition,
    name: "foundALooseSoundDefinition",
    title: "Found A Loose Sound Definition",
  }),
];

/** A valid sound_definitions.json using the versioned format. */
export const VALID_SOUND_DEFINITIONS_JSON = JSON.stringify({
  format_version: "1.17.20",
  sound_definitions: {
    "mob.creeper.say": {
      category: "neutral",
      sounds: ["sounds/mob/creeper/say1", "sounds/mob/creeper/say2"],
    },
  },
});

/**
 * A JSON string that parses successfully but fails both Zod catalog schemas.
 * The value for "bad_sound" is a string instead of a FlatCatalogEntry object.
 */
export const INVALID_SCHEMA_SOUND_DEFINITIONS_JSON = JSON.stringify({ bad_sound: "not_an_object" });

/** A string that is not valid JSON — triggers soundsDefinitionManifestInvalidJson. */
export const UNPARSEABLE_SOUND_DEFINITIONS_CONTENT = "this is not valid json {{{{";
