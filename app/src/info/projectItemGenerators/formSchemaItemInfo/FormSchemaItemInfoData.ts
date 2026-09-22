// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { DataFormIssueType } from "../../../dataform/DataFormValidator";
import { InfoItemType } from "../../IInfoItemData";
import { ProjectInfoSuite } from "../../IProjectInfoData";
import {
  defineValidationRule,
  ValidationRuleDefinition,
  ValidationSeverity,
} from "../../tests/ValidationRuleDefinition";

export enum FormSchemaItemInfoGeneratorTest {
  couldNotParseJson = 401,
  couldNotFindForm = 402,
}

const SourceFile = "app/src/info/projectItemGenerators/formSchemaItemInfo/FormSchemaItemInfoData.ts";

const rule = (spec: {
  ruleIndex: number;
  name: string;
  title: string;
  severities?: readonly ValidationSeverity[];
}): ValidationRuleDefinition =>
  defineValidationRule({
    generatorId: "JSONF",
    ruleIndex: spec.ruleIndex,
    name: spec.name,
    title: spec.title,
    severities: spec.severities ?? [InfoItemType.warning],
    suites: [ProjectInfoSuite.defaultInDevelopment],
    source: { file: SourceFile, symbol: "FormSchemaValidationRules" },
  });

/**
 * The JSONF validation-rule inventory (see FormSchemaItemInfoGenerator).
 * Structure results reuse DataFormIssueType values as rule indexes.
 *
 * Issue types whose triggering form features are unused by the shipped form
 * catalog are omitted: no string field declares maxLength (stringTooLong),
 * and no field declares fixedLength (arrayLengthMismatch), allowedKeys
 * (keyNotAllowed), or strictAdditionalProperties (unexpectedProperty).
 * couldNotFindForm (402) reports as an internal processing error, not a
 * validation severity.
 */
export const FormSchemaValidationRules: readonly ValidationRuleDefinition[] = [
  rule({
    ruleIndex: DataFormIssueType.unexpectedStringUsedWhenObjectExpected,
    name: "unexpectedStringUsedWhenObjectExpected",
    title: "String Found Where A Document Object Was Expected",
  }),
  rule({
    ruleIndex: DataFormIssueType.unexpectedBooleanUsedWhenObjectExpected,
    name: "unexpectedBooleanUsedWhenObjectExpected",
    title: "Boolean Found Where A Document Object Was Expected",
  }),
  rule({
    ruleIndex: DataFormIssueType.unexpectedNumberUsedWhenObjectExpected,
    name: "unexpectedNumberUsedWhenObjectExpected",
    title: "Number Found Where A Document Object Was Expected",
  }),
  rule({
    ruleIndex: DataFormIssueType.dataTypeMismatch,
    name: "dataTypeMismatch",
    title: "Field Value Does Not Match The Expected Type",
  }),
  rule({
    ruleIndex: DataFormIssueType.valueBelowMinimum,
    name: "valueBelowMinimum",
    title: "Field Value Is Below The Allowed Minimum",
  }),
  rule({
    ruleIndex: DataFormIssueType.valueAboveMaximum,
    name: "valueAboveMaximum",
    title: "Field Value Is Above The Allowed Maximum",
  }),
  rule({
    ruleIndex: DataFormIssueType.stringTooShort,
    name: "stringTooShort",
    title: "String Value Is Shorter Than The Allowed Minimum Length",
  }),
  rule({
    ruleIndex: DataFormIssueType.valueNotInChoices,
    name: "valueNotInChoices",
    title: "Field Value Is Not One Of The Allowed Choices",
  }),
  // Reachable through matchesPattern validity conditions in the shipped form
  // catalog (e.g. the biome description form's identifier pattern).
  rule({
    ruleIndex: DataFormIssueType.patternMismatch,
    name: "patternMismatch",
    title: "String Value Does Not Match The Required Pattern",
  }),
  rule({
    ruleIndex: DataFormIssueType.pointSizeMismatch,
    name: "pointSizeMismatch",
    title: "Range Or Point Value Has The Wrong Number Of Elements",
  }),
  rule({
    ruleIndex: DataFormIssueType.missingRequiredField,
    name: "missingRequiredField",
    title: "Required Field Is Missing",
  }),
  rule({
    ruleIndex: FormSchemaItemInfoGeneratorTest.couldNotParseJson,
    name: "couldNotParseJson",
    title: "File Could Not Be Parsed As JSON",
    severities: [InfoItemType.error],
  }),
];
