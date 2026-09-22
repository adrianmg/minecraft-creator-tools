// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { InfoItemType } from "../IInfoItemData";
import { ProjectInfoSuite } from "../IProjectInfoData";
// Type-only: TestDefinition's module pulls the ProjectItem/ProjectInfoItem
// graph in at runtime, which rule-data modules (leaf modules by design)
// should not depend on.
import type { TestDefinition } from "./TestDefinition";

/**
 * Severities a validation rule may emit. Informational item types
 * (info, featureAggregate, test completion markers) are not validation
 * severities and are deliberately excluded.
 */
export type ValidationSeverity = InfoItemType.error | InfoItemType.warning | InfoItemType.recommendation;

/** Stable catalog key: `${generatorId}:${ruleIndex}`, e.g. "CHKMANIF:101". */
export type ValidationRuleKey = `${string}:${number}`;

/** Repo-relative pointer to where a rule is defined. Never an absolute path. */
export interface IValidationRuleSource {
  /** File name (or repo-relative path) that defines the rule. */
  readonly file: string;
  /** Exported symbol holding the definition, when one exists. */
  readonly symbol?: string;
}

/**
 * Authoritative, machine-readable definition of one validation rule.
 *
 * Extends TestDefinition so the very same object can be passed to
 * resultFromTest()/resultFromTestWithMessage() when constructing
 * ProjectInfoItem results: the catalog and production behavior share one
 * definition and cannot drift independently (`id` === `ruleIndex`,
 * `severity` === `severities[0]`).
 */
export interface ValidationRuleDefinition extends TestDefinition {
  readonly key: ValidationRuleKey;
  readonly generatorId: string;
  readonly ruleIndex: number;
  /** Stable machine-readable name, lowerCamelCase (e.g. "invalidFormatVersion"). */
  readonly name: string;
  readonly title: string;
  readonly description?: string;
  /** Severities this rule can emit; the first entry is the default severity. */
  readonly severities: readonly ValidationSeverity[];
  /** Suites the owning generator participates in for this rule. */
  readonly suites: readonly ProjectInfoSuite[];
  readonly source: IValidationRuleSource;
}

/**
 * Implemented by generators that expose their rule inventory. The catalog
 * builder (ValidationRuleCatalog.ts) discovers providers among the
 * GeneratorRegistrations arrays; generators that do not implement this are
 * reported as missing metadata.
 */
export interface IValidationRuleProvider {
  readonly validationRules: readonly ValidationRuleDefinition[];
}

export function isValidationRuleProvider(candidate: unknown): candidate is IValidationRuleProvider {
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    Array.isArray((candidate as IValidationRuleProvider).validationRules)
  );
}

export interface IValidationRuleSpec {
  generatorId: string;
  ruleIndex: number;
  name: string;
  title: string;
  description?: string;
  severities: readonly ValidationSeverity[];
  suites: readonly ProjectInfoSuite[];
  source: IValidationRuleSource;
  /** Default message used when a result is created without an explicit one. */
  defaultMessage?: string;
}

/**
 * Create a ValidationRuleDefinition, failing fast on malformed metadata so a
 * bad definition breaks at module load instead of surfacing as a silent
 * catalog gap. Duplicate-key detection across rules happens at catalog build
 * (see ValidationRuleCatalog.buildValidationRuleCatalog).
 */
export function defineValidationRule(spec: IValidationRuleSpec): ValidationRuleDefinition {
  if (!spec.generatorId || spec.generatorId.trim() !== spec.generatorId || spec.generatorId.length === 0) {
    throw new Error(`Validation rule '${spec.name}': generatorId must be a non-empty trimmed string.`);
  }

  if (!Number.isInteger(spec.ruleIndex) || spec.ruleIndex < 0) {
    throw new Error(`Validation rule '${spec.generatorId}:${spec.name}': ruleIndex must be a non-negative integer.`);
  }

  if (!spec.name || !/^[a-z][A-Za-z0-9]*$/.test(spec.name)) {
    throw new Error(
      `Validation rule '${spec.generatorId}:${spec.ruleIndex}': name must be a lowerCamelCase identifier.`
    );
  }

  if (!spec.title || spec.title.length === 0) {
    throw new Error(`Validation rule '${spec.generatorId}:${spec.ruleIndex}': title is required.`);
  }

  if (spec.severities.length === 0) {
    throw new Error(`Validation rule '${spec.generatorId}:${spec.ruleIndex}': at least one severity is required.`);
  }

  if (spec.suites.length === 0) {
    throw new Error(`Validation rule '${spec.generatorId}:${spec.ruleIndex}': at least one suite is required.`);
  }

  if (!spec.source || !spec.source.file || spec.source.file.length === 0) {
    throw new Error(`Validation rule '${spec.generatorId}:${spec.ruleIndex}': source.file is required.`);
  }

  return {
    key: `${spec.generatorId}:${spec.ruleIndex}`,
    generatorId: spec.generatorId,
    ruleIndex: spec.ruleIndex,
    name: spec.name,
    title: spec.title,
    description: spec.description,
    severities: spec.severities,
    suites: spec.suites,
    source: spec.source,
    // TestDefinition compatibility: resultFromTest() reads these.
    id: spec.ruleIndex,
    severity: spec.severities[0],
    defaultMessage: spec.defaultMessage,
  };
}

/**
 * A test-suite declaration that fixtures exercise a rule end to end.
 * Fixture ids must exist in ValidationFixtures (ValidationRuleCoverage.ts);
 * only fixtures of kind "fullPipelineE2E" earn coverage credit.
 */
export interface ValidationRuleCoverageReference {
  readonly ruleKey: ValidationRuleKey;
  /** Fixtures the rule must PASS on (no error/warning/recommendation emitted). */
  readonly acceptingFixtureIds: readonly string[];
  /** Fixtures the rule must FLAG (at least one result emitted). */
  readonly rejectingFixtureIds: readonly string[];
}

export type ValidationRuleCoverageStatus = "complete" | "missing-accepting" | "missing-rejecting" | "missing-both";

/** One catalog row: a rule definition joined with its E2E coverage state. */
export interface ValidationRuleCoverageRecord extends ValidationRuleDefinition {
  readonly coverage: ValidationRuleCoverageReference;
  readonly status: ValidationRuleCoverageStatus;
}
