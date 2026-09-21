// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { InfoItemType } from "../../IInfoItemData";
import { ProjectInfoSuite } from "../../IProjectInfoData";
import { defineValidationRule, ValidationRuleDefinition } from "../../tests/ValidationRuleDefinition";

export enum CheckGeometryFormatInfoGeneratorTest {
  restrictedPolyMeshFound = 101,
  jsonParseError = 102,
}

/** The GEOFMT validation-rule inventory (see CheckGeometryFormatInfoGenerator). */
export const GeometryFormatValidationRules: readonly ValidationRuleDefinition[] = [
  defineValidationRule({
    generatorId: "GEOFMT",
    ruleIndex: CheckGeometryFormatInfoGeneratorTest.restrictedPolyMeshFound,
    name: "restrictedPolyMeshFound",
    title: "Restricted poly_mesh Geometry Found",
    severities: [InfoItemType.error],
    suites: [ProjectInfoSuite.defaultInDevelopment],
    source: {
      file: "app/src/info/projectGenerators/checkGeometryFormatInfo/CheckGeometryFormatInfoData.ts",
      symbol: "GeometryFormatValidationRules",
    },
  }),
  // jsonParseError (102) is reachable (e.g. a truthy, non-iterable bones
  // value such as {}), but every input that reaches its catch block also
  // makes GeometryInfoGenerator fail independently, so the paired harness
  // cannot isolate it; the rule is inventoried and declared known-uncovered
  // in ValidationRuleCoverage.ts.
  defineValidationRule({
    generatorId: "GEOFMT",
    ruleIndex: CheckGeometryFormatInfoGeneratorTest.jsonParseError,
    name: "jsonParseError",
    title: "Geometry File Could Not Be Processed",
    severities: [InfoItemType.error],
    suites: [ProjectInfoSuite.defaultInDevelopment],
    source: {
      file: "app/src/info/projectGenerators/checkGeometryFormatInfo/CheckGeometryFormatInfoData.ts",
      symbol: "GeometryFormatValidationRules",
    },
  }),
];
