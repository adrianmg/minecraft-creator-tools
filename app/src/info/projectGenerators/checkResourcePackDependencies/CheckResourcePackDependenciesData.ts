// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { InfoItemType } from "../../IInfoItemData";
import { ProjectInfoSuite } from "../../IProjectInfoData";
import { defineValidationRule, ValidationRuleDefinition } from "../../tests/ValidationRuleDefinition";

export enum CheckResourcePackDependenciesGeneratorTest {
  invalidManifestJson = 101,
  missingResourcePackDependency = 102,
  internalProcessingError = 103,
}

/**
 * The RPDEPENDS validation-rule inventory (see
 * CheckResourcePackDependenciesGenerator). The invalidManifestJson guard
 * (101) is defensive-only — manifest definitions always report loaded once a
 * file exists — and stays out of the inventory. Rule 103 is reachable: a
 * manifest whose dependencies value is not iterable (e.g. an object) throws
 * inside the scan and is reported as an ordinary error on that manifest.
 */
export const ResourcePackDependenciesValidationRules: readonly ValidationRuleDefinition[] = [
  defineValidationRule({
    generatorId: "RPDEPENDS",
    ruleIndex: CheckResourcePackDependenciesGeneratorTest.missingResourcePackDependency,
    name: "missingResourcePackDependency",
    title: "Missing Resource Pack Dependency",
    severities: [InfoItemType.error],
    suites: [ProjectInfoSuite.defaultInDevelopment],
    source: {
      file: "app/src/info/projectGenerators/checkResourcePackDependencies/CheckResourcePackDependenciesData.ts",
      symbol: "ResourcePackDependenciesValidationRules",
    },
  }),
  defineValidationRule({
    generatorId: "RPDEPENDS",
    ruleIndex: CheckResourcePackDependenciesGeneratorTest.internalProcessingError,
    name: "manifestProcessingError",
    title: "Pack Manifest Could Not Be Processed",
    severities: [InfoItemType.error],
    suites: [ProjectInfoSuite.defaultInDevelopment],
    source: {
      file: "app/src/info/projectGenerators/checkResourcePackDependencies/CheckResourcePackDependenciesData.ts",
      symbol: "ResourcePackDependenciesValidationRules",
    },
  }),
];
