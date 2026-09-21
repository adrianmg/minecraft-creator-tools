// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { InfoItemType } from "../IInfoItemData";
import { ProjectInfoSuite } from "../IProjectInfoData";
import ProjectInfoSet from "../ProjectInfoSet";
import IProjectInfoGeneratorBase from "../IProjectInfoGeneratorBase";
import {
  ValidationRuleCoverageRecord,
  ValidationRuleCoverageReference,
  ValidationRuleCoverageStatus,
  ValidationRuleDefinition,
  isValidationRuleProvider,
} from "../tests/ValidationRuleDefinition";
import GeneratorRegistrations from "./GeneratorRegistrations";
import {
  ValidationFixtureDefinition,
  ValidationFixtures,
  ValidationRuleCoverageDeclarations,
} from "./ValidationRuleCoverage";

/**
 * Builds the authoritative validation rule coverage catalog from the
 * production generator registrations (GeneratorRegistrations.ts). There is no
 * separate manual generator list: whatever is registered is what the catalog
 * inventories, so newly registered rules cannot remain invisible.
 *
 * Hard failures (throw): duplicate generatorId:ruleIndex keys — two rules
 * claiming one identity make every downstream report ambiguous.
 * Reported errors (issues list): generators without rule metadata, rule
 * definitions whose generatorId does not match the generator that exposes
 * them, declared suites drifting from production suite membership, and
 * coverage declarations referencing unknown rules or fixtures.
 */

export type CatalogIssueKind =
  | "missingMetadata"
  | "generatorIdMismatch"
  | "duplicateGeneratorId"
  | "suiteDrift"
  | "unknownRule"
  | "unknownFixture"
  | "duplicateCoverageDeclaration";

export interface CatalogIssue {
  readonly kind: CatalogIssueKind;
  /** Generator id, rule key, or fixture id the issue is about. */
  readonly subject: string;
  readonly message: string;
}

export interface ValidationRuleCatalog {
  readonly rules: readonly ValidationRuleCoverageRecord[];
  readonly issues: readonly CatalogIssue[];
  readonly generatorIds: readonly string[];
  readonly generatorIdsWithMetadata: readonly string[];
  readonly generatorIdsMissingMetadata: readonly string[];
  readonly fixtures: readonly ValidationFixtureDefinition[];
}

export interface IBuildCatalogOptions {
  /** Override the production coverage declarations (for tests). */
  coverageDeclarations?: readonly ValidationRuleCoverageReference[];
  /** Override the production fixture registry (for tests). */
  fixtures?: readonly ValidationFixtureDefinition[];
  /** Override the production generator registrations (for tests). */
  generators?: readonly IProjectInfoGeneratorBase[];
}

const AllSuites: readonly ProjectInfoSuite[] = [
  ProjectInfoSuite.defaultInDevelopment,
  ProjectInfoSuite.currentPlatformVersions,
  ProjectInfoSuite.cooperativeAddOn,
  ProjectInfoSuite.sharing,
  ProjectInfoSuite.sharingStrict,
];

const SeverityNames: Record<number, string> = {
  [InfoItemType.error]: "error",
  [InfoItemType.warning]: "warning",
  [InfoItemType.recommendation]: "recommendation",
};

/**
 * Every registered generator, deduplicated. Managers are reachable through
 * both projectGenerators (spread) and updaters, so instance identity is the
 * primary dedupe; two DISTINCT instances sharing one id are reported by the
 * catalog build as duplicateGeneratorId.
 */
export function listRegisteredGenerators(): IProjectInfoGeneratorBase[] {
  const seen = new Set<IProjectInfoGeneratorBase>();
  const result: IProjectInfoGeneratorBase[] = [];

  const allArrays: IProjectInfoGeneratorBase[][] = [
    GeneratorRegistrations.projectGenerators,
    GeneratorRegistrations.itemGenerators,
    GeneratorRegistrations.fileGenerators,
    GeneratorRegistrations.updaters,
  ];

  for (const generators of allArrays) {
    for (const generator of generators) {
      if (!seen.has(generator)) {
        seen.add(generator);
        result.push(generator);
      }
    }
  }

  return result;
}

function computeSuitesForGenerator(generator: IProjectInfoGeneratorBase): ProjectInfoSuite[] {
  return AllSuites.filter((suite) => ProjectInfoSet.generatorMatchesSuite(generator, suite));
}

function classifyCoverage(
  coverage: ValidationRuleCoverageReference,
  creditedFixtureIds: ReadonlySet<string>
): ValidationRuleCoverageStatus {
  const hasAccepting = coverage.acceptingFixtureIds.some((id) => creditedFixtureIds.has(id));
  const hasRejecting = coverage.rejectingFixtureIds.some((id) => creditedFixtureIds.has(id));

  if (hasAccepting && hasRejecting) {
    return "complete";
  }
  if (hasRejecting) {
    return "missing-accepting";
  }
  if (hasAccepting) {
    return "missing-rejecting";
  }
  return "missing-both";
}

export function buildValidationRuleCatalog(options?: IBuildCatalogOptions): ValidationRuleCatalog {
  const generators = options?.generators ?? listRegisteredGenerators();
  const fixtures = options?.fixtures ?? ValidationFixtures;
  const declarations = options?.coverageDeclarations ?? ValidationRuleCoverageDeclarations;

  const issues: CatalogIssue[] = [];
  const generatorIds: string[] = [];
  const generatorIdsWithMetadata: string[] = [];
  const generatorIdsMissingMetadata: string[] = [];
  const rulesByKey = new Map<string, ValidationRuleDefinition>();
  const seenGeneratorIds = new Map<string, IProjectInfoGeneratorBase>();

  for (const generator of generators) {
    const existing = seenGeneratorIds.get(generator.id);

    if (existing && existing !== generator) {
      issues.push({
        kind: "duplicateGeneratorId",
        subject: generator.id,
        message: `Two distinct registered generators share the id '${generator.id}'.`,
      });
      continue;
    }

    seenGeneratorIds.set(generator.id, generator);
    generatorIds.push(generator.id);

    if (!isValidationRuleProvider(generator)) {
      generatorIdsMissingMetadata.push(generator.id);
      issues.push({
        kind: "missingMetadata",
        subject: generator.id,
        message: `Generator '${generator.id}' does not expose validation rule metadata (IValidationRuleProvider).`,
      });
      continue;
    }

    generatorIdsWithMetadata.push(generator.id);

    const productionSuites = computeSuitesForGenerator(generator);

    for (const rule of generator.validationRules) {
      if (rule.generatorId !== generator.id) {
        issues.push({
          kind: "generatorIdMismatch",
          subject: rule.key,
          message: `Rule '${rule.key}' is exposed by generator '${generator.id}' but declares generatorId '${rule.generatorId}'.`,
        });
      }

      const declaredSuites = [...rule.suites].sort((a, b) => a - b).join(",");
      const actualSuites = [...productionSuites].sort((a, b) => a - b).join(",");

      if (declaredSuites !== actualSuites) {
        issues.push({
          kind: "suiteDrift",
          subject: rule.key,
          message:
            `Rule '${rule.key}' declares suites [${declaredSuites}] but production registration ` +
            `resolves generator '${generator.id}' to suites [${actualSuites}].`,
        });
      }

      const existingRule = rulesByKey.get(rule.key);

      if (existingRule) {
        throw new Error(
          `Duplicate validation rule key '${rule.key}': '${existingRule.name}' and '${rule.name}' both claim it.`
        );
      }

      rulesByKey.set(rule.key, rule);
    }
  }

  // Coverage resolution: unknown rules/fixtures are errors; only
  // full-pipeline E2E fixtures earn coverage credit.
  const fixtureById = new Map(fixtures.map((fixture) => [fixture.id, fixture]));
  const creditedFixtureIds = new Set(
    fixtures.filter((fixture) => fixture.kind === "fullPipelineE2E").map((fixture) => fixture.id)
  );
  const coverageByRuleKey = new Map<string, ValidationRuleCoverageReference>();

  for (const declaration of declarations) {
    if (!rulesByKey.has(declaration.ruleKey)) {
      issues.push({
        kind: "unknownRule",
        subject: declaration.ruleKey,
        message: `Coverage declaration references rule '${declaration.ruleKey}', which is not in the catalog.`,
      });
      continue;
    }

    if (coverageByRuleKey.has(declaration.ruleKey)) {
      issues.push({
        kind: "duplicateCoverageDeclaration",
        subject: declaration.ruleKey,
        message: `Rule '${declaration.ruleKey}' has more than one coverage declaration.`,
      });
      continue;
    }

    for (const fixtureId of [...declaration.acceptingFixtureIds, ...declaration.rejectingFixtureIds]) {
      if (!fixtureById.has(fixtureId)) {
        issues.push({
          kind: "unknownFixture",
          subject: fixtureId,
          message: `Coverage declaration for '${declaration.ruleKey}' references unknown fixture '${fixtureId}'.`,
        });
      }
    }

    coverageByRuleKey.set(declaration.ruleKey, declaration);
  }

  const emptyCoverage = (ruleKey: ValidationRuleDefinition["key"]): ValidationRuleCoverageReference => ({
    ruleKey,
    acceptingFixtureIds: [],
    rejectingFixtureIds: [],
  });

  const rules: ValidationRuleCoverageRecord[] = [...rulesByKey.values()]
    .sort((a, b) =>
      a.generatorId === b.generatorId ? a.ruleIndex - b.ruleIndex : a.generatorId < b.generatorId ? -1 : 1
    )
    .map((rule) => {
      const coverage = coverageByRuleKey.get(rule.key) ?? emptyCoverage(rule.key);

      return {
        ...rule,
        coverage,
        status: classifyCoverage(coverage, creditedFixtureIds),
      };
    });

  return {
    rules,
    issues,
    generatorIds: [...generatorIds].sort(),
    generatorIdsWithMetadata: [...generatorIdsWithMetadata].sort(),
    generatorIdsMissingMetadata: [...generatorIdsMissingMetadata].sort(),
    fixtures: [...fixtures].sort((a, b) => (a.id < b.id ? -1 : 1)),
  };
}

/**
 * Deterministic JSON artifact for the catalog: sorted by generator id and
 * numeric rule index, no timestamps, no absolute paths — reruns over the same
 * source produce byte-identical output so diffs are meaningful.
 */
export function buildCatalogJson(catalog: ValidationRuleCatalog): string {
  const artifact = {
    schemaVersion: 1,
    generators: {
      total: catalog.generatorIds.length,
      withMetadata: catalog.generatorIdsWithMetadata,
      missingMetadata: catalog.generatorIdsMissingMetadata,
    },
    rules: catalog.rules.map((rule) => ({
      key: rule.key,
      generatorId: rule.generatorId,
      ruleIndex: rule.ruleIndex,
      name: rule.name,
      title: rule.title,
      description: rule.description,
      severities: rule.severities.map((severity) => SeverityNames[severity]),
      suites: rule.suites.map((suite) => ProjectInfoSet.getSuiteString(suite)),
      source: rule.source,
      coverage: {
        acceptingFixtureIds: rule.coverage.acceptingFixtureIds,
        rejectingFixtureIds: rule.coverage.rejectingFixtureIds,
      },
      status: rule.status,
    })),
    fixtures: catalog.fixtures,
    issues: catalog.issues,
    summary: summarizeCatalog(catalog),
    generatorSummaries: summarizeCatalogByGenerator(catalog),
  };

  return JSON.stringify(artifact, undefined, 2);
}

export interface IGeneratorCoverageSummary {
  readonly generatorId: string;
  readonly totalRules: number;
  readonly complete: number;
  /** True when every rule the generator exposes has paired E2E coverage. */
  readonly isComplete: boolean;
}

/**
 * Per-generator coverage rollup: how many of each adopted generator's rules
 * have complete paired E2E coverage. Generators with an empty rule inventory
 * report as complete (there is nothing to pair).
 */
export function summarizeCatalogByGenerator(catalog: ValidationRuleCatalog): IGeneratorCoverageSummary[] {
  const byGenerator = new Map<string, { total: number; complete: number }>();

  for (const generatorId of catalog.generatorIdsWithMetadata) {
    byGenerator.set(generatorId, { total: 0, complete: 0 });
  }

  for (const rule of catalog.rules) {
    let counts = byGenerator.get(rule.generatorId);

    if (!counts) {
      counts = { total: 0, complete: 0 };
      byGenerator.set(rule.generatorId, counts);
    }

    counts.total++;

    if (rule.status === "complete") {
      counts.complete++;
    }
  }

  return [...byGenerator.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([generatorId, counts]) => ({
      generatorId,
      totalRules: counts.total,
      complete: counts.complete,
      isComplete: counts.complete === counts.total,
    }));
}

export function summarizeCatalog(catalog: ValidationRuleCatalog) {
  const byStatus = (status: ValidationRuleCoverageStatus) =>
    catalog.rules.filter((rule) => rule.status === status).length;

  return {
    totalGenerators: catalog.generatorIds.length,
    generatorsWithMetadata: catalog.generatorIdsWithMetadata.length,
    generatorsMissingMetadata: catalog.generatorIdsMissingMetadata.length,
    totalRules: catalog.rules.length,
    complete: byStatus("complete"),
    missingAccepting: byStatus("missing-accepting"),
    missingRejecting: byStatus("missing-rejecting"),
    missingBoth: byStatus("missing-both"),
    issues: catalog.issues.length,
  };
}

/** Human-readable console report for the catalog. */
export function formatCatalogConsoleReport(catalog: ValidationRuleCatalog): string {
  const summary = summarizeCatalog(catalog);
  const lines: string[] = [];

  lines.push("Validation rule coverage catalog");
  lines.push("================================");
  lines.push(
    `Generators: ${summary.totalGenerators} registered, ${summary.generatorsWithMetadata} with rule metadata, ` +
      `${summary.generatorsMissingMetadata} missing metadata`
  );
  lines.push(
    `Rules: ${summary.totalRules} | complete: ${summary.complete} | missing-accepting: ${summary.missingAccepting} | ` +
      `missing-rejecting: ${summary.missingRejecting} | missing-both: ${summary.missingBoth}`
  );
  lines.push("");
  lines.push("Coverage by generator:");

  for (const generatorSummary of summarizeCatalogByGenerator(catalog)) {
    lines.push(
      `  [${generatorSummary.isComplete ? "complete" : "incomplete"}] ${generatorSummary.generatorId}: ` +
        `${generatorSummary.complete}/${generatorSummary.totalRules} rules paired`
    );
  }

  lines.push("");

  for (const rule of catalog.rules) {
    lines.push(`  [${rule.status}] ${rule.key} ${rule.name} — ${rule.title}`);
  }

  if (catalog.generatorIdsMissingMetadata.length > 0) {
    lines.push("");
    lines.push("Generators without rule metadata (adopt IValidationRuleProvider):");
    lines.push(`  ${catalog.generatorIdsMissingMetadata.join(", ")}`);
  }

  const nonMetadataIssues = catalog.issues.filter((issue) => issue.kind !== "missingMetadata");

  if (nonMetadataIssues.length > 0) {
    lines.push("");
    lines.push("Errors:");

    for (const issue of nonMetadataIssues) {
      lines.push(`  [${issue.kind}] ${issue.subject}: ${issue.message}`);
    }
  }

  return lines.join("\n");
}
