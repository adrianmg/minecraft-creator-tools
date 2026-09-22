// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import ContentIndex from "../../../core/ContentIndex";
import { HashCatalog } from "../../../core/HashUtilities";
import { InfoItemType } from "../../IInfoItemData";
import { ProjectInfoSuite } from "../../IProjectInfoData";
import { defineValidationRule, ValidationRuleDefinition } from "../../tests/ValidationRuleDefinition";

const rule = (spec: { ruleIndex: number; name: string; title: string }) =>
  defineValidationRule({
    generatorId: "VANDUPES",
    ruleIndex: spec.ruleIndex,
    name: spec.name,
    title: spec.title,
    severities: [InfoItemType.warning],
    suites: [ProjectInfoSuite.sharingStrict],
    source: {
      file: "app/src/info/projectGenerators/checkVanillaDuplicatesInfo/CheckVanillaDuplicatesInfoGeneratorData.ts",
      symbol: "CheckVanillaDuplicatesValidationRules",
    },
  });

/** The VANDUPES validation-rule inventory (see CheckVanillaDuplicatesInfoGenerator). */
export const CheckVanillaDuplicatesValidationRules: readonly ValidationRuleDefinition[] = [
  rule({ ruleIndex: 101, name: "completeVanillaCopy", title: "Complete Copy of a Vanilla File" }),
  rule({ ruleIndex: 102, name: "partialVanillaCopy", title: "Partial Copy of a Vanilla File" }),
];

export const VANILLA_TEST_FILE_HASH = "abc123def456abc123def456abc12345";
export const VANILLA_TEST_FILE_PATH = "RP/textures/creeper.png";
export const VANILLA_TEST_FILE_NAME = "creeper.png";

/**
 * Creates a ContentIndex stub pre-populated with the given hash catalog entries.
 * The hashCatalog getter returns the internal reference, so entries are added directly.
 */
export function createStubContentIndex(entries: HashCatalog = {}): ContentIndex {
  const index = new ContentIndex();
  const catalog = index.hashCatalog;
  for (const [key, value] of Object.entries(entries)) {
    catalog[key] = value;
  }
  return index;
}
