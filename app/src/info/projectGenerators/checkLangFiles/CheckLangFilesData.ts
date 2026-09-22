// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { InfoItemType } from "../../IInfoItemData";
import { ProjectInfoSuite } from "../../IProjectInfoData";
import { defineValidationRule, ValidationRuleDefinition } from "../../tests/ValidationRuleDefinition";

// LANGFILES is excluded from the default suite (TestsToExcludeFromDefaultSuite)
// and participates only in the sharing-strict suite.
const rule = (spec: { ruleIndex: number; name: string; title: string; defaultMessage?: string }) =>
  defineValidationRule({
    generatorId: "LANGFILES",
    ruleIndex: spec.ruleIndex,
    name: spec.name,
    title: spec.title,
    defaultMessage: spec.defaultMessage,
    severities: [InfoItemType.error],
    suites: [ProjectInfoSuite.sharingStrict],
    source: {
      file: "app/src/info/projectGenerators/checkLangFiles/CheckLangFilesData.ts",
      symbol: `CheckLangFilesTests.${spec.name[0].toUpperCase()}${spec.name.substring(1)}`,
    },
  });

export const CheckLangFilesTests: Record<string, ValidationRuleDefinition> = {
  MissingLanguagesJson: rule({ ruleIndex: 101, name: "missingLanguagesJson", title: "languages.json Not Found" }),
  PrimaryLangMissing: rule({ ruleIndex: 102, name: "primaryLangMissing", title: "en_US lang code is required." }),
  FailedToParseFile: rule({ ruleIndex: 103, name: "failedToParseFile", title: "Failed To Parse File" }),
  LangFileMissing: rule({
    ruleIndex: 104,
    name: "langFileMissing",
    title: "Lang File Missing",
    defaultMessage: "All entries in languages.json must have corresponding .lang file.",
  }),
  ExtraLangFile: rule({
    ruleIndex: 105,
    name: "extraLangFile",
    title: "Lang File Without Catalog Entry",
    defaultMessage: ".lang file exists in pack but its lang code is not referenced in languages.json",
  }),
};

/** The LANGFILES validation-rule inventory (see CheckLangFilesGenerator). */
export const CheckLangFilesValidationRules: readonly ValidationRuleDefinition[] =
  Object.values(CheckLangFilesTests);
