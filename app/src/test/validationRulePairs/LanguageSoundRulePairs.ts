// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * LanguageSoundRulePairs — paired E2E coverage for LANGFILES (languages.json
 * catalog vs .lang file consistency; sharing-strict suite only, per
 * TestsToExcludeFromDefaultSuite) and SNDSDEF (sound_definitions.json
 * placement, JSON validity, and schema validity).
 *
 * SNDSDEF emits only failure results and has no canAlwaysProcess, so every
 * accepting fixture keeps the generator demonstrably applicable by tripping a
 * sibling rule (the TEXTURELIST pattern): a manifest-less
 * resource_packs/loose_rp catalog trips only rule 104, and a
 * schema-invalid catalog trips only rule 102.
 */

import { InfoItemType } from "../../info/IInfoItemData";
import { ProjectInfoSuite } from "../../info/IProjectInfoData";
import { ValidationRuleCoveragePair } from "../ValidationRuleHarness";
import { RpRoot, coveragePairFromBase, json, minimalRpFiles } from "./PairFixtureBuilders";
import {
  INVALID_SCHEMA_SOUND_DEFINITIONS_JSON,
  UNPARSEABLE_SOUND_DEFINITIONS_CONTENT,
  VALID_SOUND_DEFINITIONS_JSON,
} from "../../info/projectGenerators/SoundDefinitionsInfo/SoundDefinitionsInfoGeneratorData";

// ---------------------------------------------------------------------------
// LANGFILES — languages.json catalog / .lang file consistency (sharingStrict).
// ---------------------------------------------------------------------------

const LanguagesJsonPath = `${RpRoot}/texts/languages.json`;
const EnUsLangPath = `${RpRoot}/texts/en_US.lang`;
const FrFrLangPath = `${RpRoot}/texts/fr_FR.lang`;

const langLines = "harness.title=Validation Harness\n";

const rpWithEnUsLang = {
  ...minimalRpFiles(),
  [EnUsLangPath]: langLines,
};

const LangFilesPairs: readonly ValidationRuleCoveragePair[] = [
  coveragePairFromBase({
    ruleKey: "LANGFILES:101",
    category: "project",
    suite: ProjectInfoSuite.sharingStrict,
    baseFiles: rpWithEnUsLang,
    accepting: {
      id: "harness-langfiles-catalog-present-accept",
      description: "Resource pack with texts/languages.json alongside its .lang file; LANGFILES:101 must stay quiet.",
      files: { [LanguagesJsonPath]: json(["en_US"]) },
    },
    rejecting: {
      id: "harness-langfiles-catalog-present-reject",
      description: "Resource pack with a .lang file but no texts/languages.json; LANGFILES:101 must flag the pack.",
    },
    rejectingExpectation: {
      severity: InfoItemType.error,
      count: 1,
      message: "languages.json Not Found",
    },
  }),

  coveragePairFromBase({
    ruleKey: "LANGFILES:102",
    category: "project",
    suite: ProjectInfoSuite.sharingStrict,
    baseFiles: {
      ...rpWithEnUsLang,
      [FrFrLangPath]: langLines,
    },
    accepting: {
      id: "harness-langfiles-primary-lang-accept",
      description: "languages.json listing en_US and fr_FR with both .lang files; LANGFILES:102 must stay quiet.",
      files: { [LanguagesJsonPath]: json(["en_US", "fr_FR"]) },
    },
    rejecting: {
      id: "harness-langfiles-primary-lang-reject",
      description: "languages.json without the required en_US lang code; LANGFILES:102 must flag the catalog.",
      files: { [LanguagesJsonPath]: json(["fr_FR"]) },
    },
    rejectingExpectation: {
      severity: InfoItemType.error,
      count: 1,
      projectPath: /languages\.json$/,
      message: "en_US lang code is required",
    },
  }),

  coveragePairFromBase({
    ruleKey: "LANGFILES:103",
    category: "project",
    suite: ProjectInfoSuite.sharingStrict,
    baseFiles: rpWithEnUsLang,
    accepting: {
      id: "harness-langfiles-catalog-parses-accept",
      description: "languages.json holding a well-formed string array; LANGFILES:103 must stay quiet.",
      files: { [LanguagesJsonPath]: json(["en_US"]) },
    },
    rejecting: {
      id: "harness-langfiles-catalog-parses-reject",
      description: "languages.json that is not parsable JSON; LANGFILES:103 must flag the catalog.",
      files: { [LanguagesJsonPath]: "not a languages catalog {{{" },
    },
    rejectingExpectation: {
      severity: InfoItemType.error,
      count: 1,
      projectPath: /languages\.json$/,
      message: "Could not parse json",
    },
  }),

  coveragePairFromBase({
    ruleKey: "LANGFILES:104",
    category: "project",
    suite: ProjectInfoSuite.sharingStrict,
    baseFiles: rpWithEnUsLang,
    accepting: {
      id: "harness-langfiles-lang-file-present-accept",
      description: "languages.json entries each backed by a .lang file; LANGFILES:104 must stay quiet.",
      files: { [LanguagesJsonPath]: json(["en_US"]) },
    },
    rejecting: {
      id: "harness-langfiles-lang-file-present-reject",
      description: "languages.json listing fr_FR with no fr_FR.lang file; LANGFILES:104 must flag the missing lang.",
      files: { [LanguagesJsonPath]: json(["en_US", "fr_FR"]) },
    },
    rejectingExpectation: {
      severity: InfoItemType.error,
      count: 1,
      projectPath: /languages\.json$/,
      message: "All entries in languages.json must have corresponding .lang file",
      data: "fr_FR",
    },
  }),

  coveragePairFromBase({
    ruleKey: "LANGFILES:105",
    category: "project",
    suite: ProjectInfoSuite.sharingStrict,
    baseFiles: {
      ...rpWithEnUsLang,
      [FrFrLangPath]: langLines,
    },
    accepting: {
      id: "harness-langfiles-catalog-entry-accept",
      description: "Every .lang file's code referenced in languages.json; LANGFILES:105 must stay quiet.",
      files: { [LanguagesJsonPath]: json(["en_US", "fr_FR"]) },
    },
    rejecting: {
      id: "harness-langfiles-catalog-entry-reject",
      description: "fr_FR.lang present but not referenced in languages.json; LANGFILES:105 must flag the .lang file.",
      files: { [LanguagesJsonPath]: json(["en_US"]) },
    },
    rejectingExpectation: {
      severity: InfoItemType.error,
      count: 1,
      projectPath: /fr_FR\.lang$/,
      message: ".lang file exists in pack but its lang code is not referenced in languages.json",
    },
  }),
];

// ---------------------------------------------------------------------------
// SNDSDEF — sound_definitions.json placement, JSON validity, schema validity.
// ---------------------------------------------------------------------------

const SoundCatalogPath = `${RpRoot}/sounds/sound_definitions.json`;
const ExtraSoundCatalogPath = `${RpRoot}/sounds/harness_extra/sound_definitions.json`;

// A catalog under resource_packs/ but outside any manifest-backed pack: it
// classifies as a sound definition catalog yet has no owning pack, tripping
// only rule 104 — which doubles as the applicability marker for other pairs.
const LooseSoundCatalogPath = "resource_packs/loose_rp/sounds/sound_definitions.json";

const SoundDefinitionsPairs: readonly ValidationRuleCoveragePair[] = [
  coveragePairFromBase({
    ruleKey: "SNDSDEF:101",
    category: "project",
    suite: ProjectInfoSuite.defaultInDevelopment,
    baseFiles: {
      ...minimalRpFiles(),
      [SoundCatalogPath]: VALID_SOUND_DEFINITIONS_JSON,
      [LooseSoundCatalogPath]: VALID_SOUND_DEFINITIONS_JSON,
    },
    accepting: {
      id: "harness-sndsdef-single-catalog-accept",
      description:
        "One sound_definitions.json in the pack (plus a loose catalog tripping only rule 104 to keep the generator applicable); SNDSDEF:101 must stay quiet.",
    },
    rejecting: {
      id: "harness-sndsdef-single-catalog-reject",
      description: "A second sound_definitions.json in the same pack; SNDSDEF:101 must flag the duplicate catalog.",
      files: { [ExtraSoundCatalogPath]: VALID_SOUND_DEFINITIONS_JSON },
    },
    rejectingExpectation: {
      severity: InfoItemType.error,
      count: 1,
      projectPath: /sound_definitions\.json$/,
      message: "Multiple Sounds Definition Manifests",
    },
  }),

  coveragePairFromBase({
    ruleKey: "SNDSDEF:102",
    category: "project",
    suite: ProjectInfoSuite.defaultInDevelopment,
    baseFiles: {
      ...minimalRpFiles(),
      [LooseSoundCatalogPath]: VALID_SOUND_DEFINITIONS_JSON,
    },
    accepting: {
      id: "harness-sndsdef-catalog-schema-accept",
      description:
        "Pack catalog matching the sound definition schema (loose catalog trips only rule 104 for applicability); SNDSDEF:102 must stay quiet.",
      files: { [SoundCatalogPath]: VALID_SOUND_DEFINITIONS_JSON },
    },
    rejecting: {
      id: "harness-sndsdef-catalog-schema-reject",
      description: "Pack catalog whose entry is a bare string instead of a definition; SNDSDEF:102 must flag it.",
      files: { [SoundCatalogPath]: INVALID_SCHEMA_SOUND_DEFINITIONS_JSON },
    },
    rejectingExpectation: {
      severity: InfoItemType.error,
      count: 1,
      message: "Invalid Sounds Definition Manifest",
    },
  }),

  coveragePairFromBase({
    ruleKey: "SNDSDEF:103",
    category: "project",
    suite: ProjectInfoSuite.defaultInDevelopment,
    baseFiles: {
      ...minimalRpFiles(),
      [LooseSoundCatalogPath]: VALID_SOUND_DEFINITIONS_JSON,
    },
    accepting: {
      id: "harness-sndsdef-catalog-json-accept",
      description:
        "Pack catalog holding parsable JSON (loose catalog trips only rule 104 for applicability); SNDSDEF:103 must stay quiet.",
      files: { [SoundCatalogPath]: VALID_SOUND_DEFINITIONS_JSON },
    },
    rejecting: {
      id: "harness-sndsdef-catalog-json-reject",
      description: "Pack catalog that is not parsable JSON; SNDSDEF:103 must flag it.",
      files: { [SoundCatalogPath]: UNPARSEABLE_SOUND_DEFINITIONS_CONTENT },
    },
    rejectingExpectation: {
      severity: InfoItemType.error,
      count: 1,
      projectPath: /sound_definitions\.json$/,
      message: "Sounds Definition Manifest Invalid Json",
    },
  }),

  coveragePairFromBase({
    ruleKey: "SNDSDEF:104",
    category: "project",
    suite: ProjectInfoSuite.defaultInDevelopment,
    baseFiles: {
      ...minimalRpFiles(),
      [SoundCatalogPath]: INVALID_SCHEMA_SOUND_DEFINITIONS_JSON,
    },
    accepting: {
      id: "harness-sndsdef-catalog-in-pack-accept",
      description:
        "Every catalog inside a manifest-backed pack (schema-invalid catalog trips only rule 102 for applicability); SNDSDEF:104 must stay quiet.",
    },
    rejecting: {
      id: "harness-sndsdef-catalog-in-pack-reject",
      description: "A catalog under resource_packs/ with no owning pack manifest; SNDSDEF:104 must flag it.",
      files: { [LooseSoundCatalogPath]: VALID_SOUND_DEFINITIONS_JSON },
    },
    rejectingExpectation: {
      severity: InfoItemType.error,
      count: 1,
      projectPath: /loose_rp\/sounds\/sound_definitions\.json$/,
      message: "Loose Sound Definition",
    },
  }),
];

/** Paired coverage for the language and sound definition rule families. */
export const LanguageSoundRulePairs: readonly ValidationRuleCoveragePair[] = [
  ...LangFilesPairs,
  ...SoundDefinitionsPairs,
];
