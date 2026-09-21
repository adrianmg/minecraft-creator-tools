// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { InfoItemType } from "../../IInfoItemData";
import { ProjectInfoSuite } from "../../IProjectInfoData";
import { defineValidationRule, ValidationRuleDefinition } from "../../tests/ValidationRuleDefinition";

export enum GeometryInfoGeneratorTest {
  blockGeometry = 101,
  entityGeometry = 102,
  itemGeometry = 103,
  overlyComplexBlockGeometry = 501,
}

/**
 * The GEOMETRY validation-rule inventory (see GeometryInfoGenerator).
 * Indexes 101-103 are featureAggregate roll-ups, not validation rules.
 */
export const GeometryValidationRules: readonly ValidationRuleDefinition[] = [
  defineValidationRule({
    generatorId: "GEOMETRY",
    ruleIndex: GeometryInfoGeneratorTest.overlyComplexBlockGeometry,
    name: "overlyComplexBlockGeometry",
    title: "Overly Complex Block Geometry",
    severities: [InfoItemType.warning],
    suites: [ProjectInfoSuite.defaultInDevelopment],
    source: {
      file: "app/src/info/projectGenerators/geometryInfo/GeometryInfoData.ts",
      symbol: "GeometryValidationRules",
    },
  }),
];
