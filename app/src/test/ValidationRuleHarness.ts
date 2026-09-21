// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * ValidationRuleHarness — reusable paired E2E test harness for validation
 * rules (see docs/ValidationRuleCatalog.md).
 *
 * A ValidationRuleCoveragePair links one rule key (`GENERATORID:ruleIndex`)
 * to two generated fixtures that differ only in the condition under test:
 * a rejecting fixture the rule must flag, and an accepting fixture the rule
 * must stay quiet on while the owning generator still demonstrably runs.
 * Both fixtures execute through the production pipeline
 * (ProjectInfoSet.generateForProject()), never through a generator in
 * isolation.
 *
 * Fixture output is generated deterministically from compact typed recipes
 * into app/debugoutput/validation-rule-harness/ (gitignored) and removed
 * after each verification, so runs cannot dirty the worktree.
 *
 * Failure policy: unexpected skips (generator missing from the run or
 * reporting no applicable items), fixture load failures, duplicate target
 * results, and internal-processing errors all fail verification.
 *
 * Local debugging filters (see getHarnessFilterFromEnv):
 *   MCT_RULE_HARNESS_FILTER=CHKMANIF,MINENGINEVER:120,file
 *   MCT_RULE_HARNESS_SUITE=currentplatform
 *   MCT_RULE_HARNESS_SHARD=1/3   (deterministic CI fan-out; see getHarnessShardFromEnv)
 *
 * Representative pairs live in ValidationRuleHarnessPairs.ts; the mocha
 * suite that runs them is ValidationRuleHarnessTest.ts.
 */

import * as fs from "fs";
import * as path from "path";
import Project, { ProjectAutoDeploymentMode } from "../app/Project";
import ProjectInfoSet from "../info/ProjectInfoSet";
import ProjectInfoItem from "../info/ProjectInfoItem";
import { InfoItemType } from "../info/IInfoItemData";
import { ProjectInfoSuite } from "../info/IProjectInfoData";
import { ValidationRuleKey, ValidationSeverity } from "../info/tests/ValidationRuleDefinition";
import TestPaths, { ITestEnvironment } from "./TestPaths";

export type ValidationFixtureRecipeKind = "accepting" | "rejecting";

/** Generator category a pair exercises; also usable as a filter token. */
export type ValidationRuleCategory = "project" | "projectItem" | "file" | "manager";

/**
 * Fixture contents keyed by project-relative path (forward slashes). Strings
 * are written as UTF-8 without a BOM; Uint8Array contents are written verbatim
 * (e.g. to place a deliberate BOM or other binary bytes).
 */
export type ValidationFixtureFiles = { readonly [relativePath: string]: string | Uint8Array };

/** A compact, deterministic recipe for one generated fixture project. */
export interface ValidationFixtureRecipe {
  /** Stable fixture id; doubles as the generated output folder name. */
  readonly id: string;
  readonly description: string;
  readonly kind: ValidationFixtureRecipeKind;
  /** Suite the pipeline runs under for this fixture. */
  readonly suite: ProjectInfoSuite;
  readonly files: ValidationFixtureFiles;
  /**
   * Optional deterministic environment setup run before the pipeline (e.g.
   * seeding Database.moduleDescriptors so script-module lookups never reach
   * the live npm registry). Must be idempotent: the hook runs once per
   * fixture execution and fixtures may execute multiple times per process.
   */
  readonly prepare?: () => void | Promise<void>;
}

/** What the rejecting fixture must produce for the target rule. */
export interface ValidationResultExpectation {
  readonly severity: ValidationSeverity;
  /** Exact number of expected results; defaults to 1. More is a duplicate failure. */
  readonly count?: number;
  /** Substring (string) or pattern (RegExp) the result's project path must match. */
  readonly projectPath?: string | RegExp;
  /** Substring (string) or pattern (RegExp) the result's message must match. */
  readonly message?: string | RegExp;
  /** Structured data the result must carry (deep-equal comparison). */
  readonly data?: string | boolean | number | number[];
}

/** One catalog rule paired with its accepting and rejecting fixtures. */
export interface ValidationRuleCoveragePair {
  readonly ruleKey: ValidationRuleKey;
  readonly category: ValidationRuleCategory;
  readonly accepting: ValidationFixtureRecipe;
  readonly rejecting: ValidationFixtureRecipe;
  readonly rejectingExpectation: ValidationResultExpectation;
}

/** Outcome of one full-pipeline run over a fixture recipe. */
export interface ValidationPipelineResult {
  readonly recipe: ValidationFixtureRecipe;
  readonly infoSet: ProjectInfoSet;
  readonly items: readonly ProjectInfoItem[];
  /** Every generator id that contributed at least one result item. */
  readonly executedGeneratorIds: ReadonlySet<string>;
}

const ValidationSeverities: readonly InfoItemType[] = [
  InfoItemType.error,
  InfoItemType.warning,
  InfoItemType.recommendation,
];

/** Root for all generated fixture output; gitignored, wiped per fixture run. */
export const HarnessOutputRoot = path.join(TestPaths.appRoot, "debugoutput", "validation-rule-harness");

// Fixture ids double as folder names beneath HarnessOutputRoot and are later
// passed to a recursive rmSync, so they are restricted to a flat slug — no
// separators of either style, no dots, nothing path-like.
const SafeFixtureIdPattern = /^[A-Za-z0-9][A-Za-z0-9-]*$/;

/**
 * Resolves the output folder for a fixture id, refusing any id that is not a
 * plain slug or whose resolved path lands outside HarnessOutputRoot. Every
 * write and recursive deletion the harness performs goes through this check.
 */
export function fixtureOutputPath(fixtureId: string) {
  if (!SafeFixtureIdPattern.test(fixtureId)) {
    throw new Error(`'${fixtureId}' is not a valid fixture id; expected a slug of letters, digits, and hyphens.`);
  }

  const target = path.resolve(HarnessOutputRoot, fixtureId);

  if (!target.startsWith(path.resolve(HarnessOutputRoot) + path.sep)) {
    throw new Error(`Fixture id '${fixtureId}' resolves outside the harness output root.`);
  }

  return target;
}

export function parseRuleKey(ruleKey: ValidationRuleKey): { generatorId: string; ruleIndex: number } {
  const separator = ruleKey.lastIndexOf(":");
  const generatorId = separator > 0 ? ruleKey.substring(0, separator) : "";
  const indexText = separator > 0 ? ruleKey.substring(separator + 1) : "";
  const ruleIndex = /^\d+$/.test(indexText) ? Number(indexText) : NaN;

  if (generatorId.length === 0 || !Number.isInteger(ruleIndex) || ruleIndex < 0) {
    throw new Error(`'${ruleKey}' is not a valid rule key; expected 'GENERATORID:ruleIndex'.`);
  }

  return { generatorId, ruleIndex };
}

let environmentPromise: Promise<ITestEnvironment> | undefined;

/** Lazily creates (once per process) the standard test environment. */
export function ensureHarnessEnvironment(): Promise<ITestEnvironment> {
  if (!environmentPromise) {
    environmentPromise = TestPaths.createTestEnvironment();
  }

  return environmentPromise;
}

function fixtureError(recipe: ValidationFixtureRecipe, message: string): Error {
  return new Error(`[fixture '${recipe.id}' | suite '${ProjectInfoSet.getSuiteString(recipe.suite)}'] ${message}`);
}

/**
 * Removes one fixture's generated output. Safe to call when nothing exists.
 * Retries cover Windows EPERM/EBUSY races when removing directories with
 * many freshly written files (e.g. antivirus still holding a handle).
 */
export function cleanUpFixtureOutput(fixtureId: string) {
  fs.rmSync(fixtureOutputPath(fixtureId), { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

function writeFixture(recipe: ValidationFixtureRecipe): string {
  const relativePaths = Object.keys(recipe.files);

  if (relativePaths.length === 0) {
    throw fixtureError(recipe, "Fixture load failure: the recipe declares no files.");
  }

  const fixtureRoot = fixtureOutputPath(recipe.id);

  // Deterministic: any prior output for this fixture id is removed first so
  // reruns always start from the recipe alone.
  fs.rmSync(fixtureRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });

  for (const relativePath of relativePaths) {
    const segments = relativePath.split("/");

    // Recipe paths use forward slashes only; backslashes are rejected rather
    // than normalized so a Windows-style '..\\..' can never sneak past the
    // per-segment check below.
    if (
      relativePath.includes("\\") ||
      path.isAbsolute(relativePath) ||
      segments.includes("..") ||
      segments.includes(".") ||
      segments.includes("")
    ) {
      throw fixtureError(recipe, `Fixture load failure: illegal fixture path '${relativePath}'.`);
    }

    const targetPath = path.join(fixtureRoot, ...segments);

    // Belt and braces: whatever the segments contained, the resolved write
    // target must stay beneath this fixture's root.
    if (!path.resolve(targetPath).startsWith(path.resolve(fixtureRoot) + path.sep)) {
      throw fixtureError(recipe, `Fixture load failure: '${relativePath}' resolves outside the fixture root.`);
    }

    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, recipe.files[relativePath]);

    if (!fs.existsSync(targetPath)) {
      throw fixtureError(recipe, `Fixture load failure: could not create '${relativePath}'.`);
    }
  }

  return fixtureRoot;
}

/**
 * Generates the fixture from its recipe and runs the full production
 * validation pipeline (ProjectInfoSet.generateForProject()) over it.
 * Callers own cleanup via cleanUpFixtureOutput (verifyCoveragePair does both).
 */
export async function runValidationPipeline(recipe: ValidationFixtureRecipe): Promise<ValidationPipelineResult> {
  const fixtureRoot = writeFixture(recipe);
  const environment = await ensureHarnessEnvironment();

  if (recipe.prepare) {
    await recipe.prepare();
  }

  const project = new Project(environment.creatorTools, recipe.id, null);
  project.autoDeploymentMode = ProjectAutoDeploymentMode.noAutoDeployment;
  project.localFolderPath = fixtureRoot + path.sep;

  await project.inferProjectItemsFromFiles();

  if (project.items.length === 0) {
    throw fixtureError(recipe, "Fixture load failure: no project items were inferred from the generated fixture.");
  }

  const infoSet = new ProjectInfoSet(project, recipe.suite);

  await infoSet.generateForProject();

  if (!infoSet.completedGeneration) {
    throw fixtureError(recipe, "The validation pipeline did not complete generation.");
  }

  return {
    recipe,
    infoSet,
    items: infoSet.items,
    executedGeneratorIds: new Set(infoSet.items.map((item) => item.generatorId)),
  };
}

function formatGeneratorResults(result: ValidationPipelineResult, generatorId: string) {
  const items = result.items.filter((item) => item.generatorId === generatorId);

  if (items.length === 0) {
    return `  (no ${generatorId} results at all)`;
  }

  return items.map((item) => "  " + result.infoSet.itemToString(item)).join("\n");
}

function verificationError(result: ValidationPipelineResult, ruleKey: ValidationRuleKey, message: string): Error {
  const { generatorId } = parseRuleKey(ruleKey);

  return new Error(
    `[rule ${ruleKey} | fixture '${result.recipe.id}' | suite '${ProjectInfoSet.getSuiteString(
      result.recipe.suite
    )}'] ${message}\nActual ${generatorId} results:\n${formatGeneratorResults(result, generatorId)}`
  );
}

/**
 * Proves the rule's generator ran and found applicable content: at least one
 * result item exists for the generator, and none of them is the
 * testCompleteNoApplicableItemsFound verdict. Either miss is an unexpected
 * skip and fails.
 */
export function assertRuleWasApplicable(result: ValidationPipelineResult, ruleKey: ValidationRuleKey) {
  const { generatorId } = parseRuleKey(ruleKey);

  if (!result.executedGeneratorIds.has(generatorId)) {
    throw verificationError(
      result,
      ruleKey,
      `Unexpected skip: generator '${generatorId}' produced no results — it did not run in this suite. ` +
        `Generators that ran: ${[...result.executedGeneratorIds].sort().join(", ")}`
    );
  }

  const notApplicable = result.items.some(
    (item) => item.generatorId === generatorId && item.itemType === InfoItemType.testCompleteNoApplicableItemsFound
  );

  if (notApplicable) {
    throw verificationError(
      result,
      ruleKey,
      `Unexpected skip: generator '${generatorId}' ran but reported no applicable items, so the rule was never evaluated.`
    );
  }
}

/** Any internal-processing error anywhere in the run fails verification. */
export function assertNoInternalProcessingErrors(result: ValidationPipelineResult) {
  const internalErrors = result.items.filter((item) => item.itemType === InfoItemType.internalProcessingError);

  if (internalErrors.length > 0) {
    throw new Error(
      `[fixture '${result.recipe.id}' | suite '${ProjectInfoSet.getSuiteString(result.recipe.suite)}'] ` +
        `${internalErrors.length} internal-processing error(s) occurred during the pipeline run:\n` +
        internalErrors.map((item) => "  " + result.infoSet.itemToString(item)).join("\n")
    );
  }
}

/** Accepting side: the rule must not emit at any validation severity. */
export function assertRuleAbsent(result: ValidationPipelineResult, ruleKey: ValidationRuleKey) {
  const { generatorId, ruleIndex } = parseRuleKey(ruleKey);

  const offending = result.items.filter(
    (item) =>
      item.generatorId === generatorId &&
      item.generatorIndex === ruleIndex &&
      ValidationSeverities.includes(item.itemType)
  );

  if (offending.length > 0) {
    throw verificationError(
      result,
      ruleKey,
      `The rule fired ${offending.length} time(s) on an accepting fixture; it must stay quiet.`
    );
  }
}

function matchesText(actual: string | null | undefined, expected: string | RegExp) {
  if (actual === undefined || actual === null) {
    return false;
  }

  return typeof expected === "string" ? actual.indexOf(expected) >= 0 : expected.test(actual);
}

function dataMatches(actual: unknown, expected: ValidationResultExpectation["data"]) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

/**
 * Rejecting side: the rule must emit exactly the expected number of results,
 * every one of them at the expected severity, and every one satisfying the
 * path, message, and data expectations. The count is taken over ALL of the
 * target rule's validation-severity results before the severity is checked,
 * so a duplicate that fires at an unexpected severity (e.g. a stray warning
 * beside the expected error) is caught as a duplicate rather than silently
 * filtered away. Extra results are unexpected duplicates and fail.
 */
export function assertRuleMatches(
  result: ValidationPipelineResult,
  ruleKey: ValidationRuleKey,
  expectation: ValidationResultExpectation
) {
  const { generatorId, ruleIndex } = parseRuleKey(ruleKey);
  const expectedCount = expectation.count ?? 1;

  const candidates = result.items.filter(
    (item) =>
      item.generatorId === generatorId &&
      item.generatorIndex === ruleIndex &&
      ValidationSeverities.includes(item.itemType)
  );

  if (candidates.length > expectedCount) {
    throw verificationError(
      result,
      ruleKey,
      `Unexpected duplicate results: expected ${expectedCount} result(s) but found ${candidates.length}.`
    );
  }

  if (candidates.length < expectedCount) {
    throw verificationError(
      result,
      ruleKey,
      `Expected ${expectedCount} result(s) but found ${candidates.length}.`
    );
  }

  for (const item of candidates) {
    if (item.itemType !== expectation.severity) {
      throw verificationError(
        result,
        ruleKey,
        `Result severity '${InfoItemType[item.itemType]}' does not match the expected severity '${
          InfoItemType[expectation.severity]
        }'.`
      );
    }

    if (expectation.projectPath !== undefined && !matchesText(item.projectItemPath, expectation.projectPath)) {
      throw verificationError(
        result,
        ruleKey,
        `Result path '${item.projectItemPath}' does not match the expected path ${String(expectation.projectPath)}.`
      );
    }

    if (expectation.message !== undefined && !matchesText(item.message, expectation.message)) {
      throw verificationError(
        result,
        ruleKey,
        `Result message '${item.message}' does not match the expected message ${String(expectation.message)}.`
      );
    }

    if (expectation.data !== undefined && !dataMatches(item.data, expectation.data)) {
      throw verificationError(
        result,
        ruleKey,
        `Result data '${JSON.stringify(item.data)}' does not deep-equal the expected data '${JSON.stringify(
          expectation.data
        )}'.`
      );
    }
  }
}

/** Paths whose contents differ between two fixture recipes. */
export function differingFilePaths(a: ValidationFixtureFiles, b: ValidationFixtureFiles): string[] {
  const allPaths = new Set([...Object.keys(a), ...Object.keys(b)]);
  const differing: string[] = [];

  for (const filePath of allPaths) {
    const contentsA = a[filePath];
    const contentsB = b[filePath];

    if (typeof contentsA === "string" && typeof contentsB === "string") {
      if (contentsA !== contentsB) {
        differing.push(filePath);
      }
    } else if (contentsA instanceof Uint8Array && contentsB instanceof Uint8Array) {
      if (contentsA.length !== contentsB.length || contentsA.some((byte, index) => byte !== contentsB[index])) {
        differing.push(filePath);
      }
    } else {
      // One side missing or a string/binary kind mismatch.
      differing.push(filePath);
    }
  }

  return differing.sort();
}

/**
 * Verifies one coverage pair end to end:
 *   accepting — no internal errors, generator ran on applicable content, and
 *   the target rule stayed quiet;
 *   rejecting — no internal errors, generator ran on applicable content, and
 *   the target rule fired exactly as expected.
 * Generated fixture output is cleaned up even when assertions fail.
 */
export async function verifyCoveragePair(pair: ValidationRuleCoveragePair): Promise<void> {
  if (pair.accepting.kind !== "accepting" || pair.rejecting.kind !== "rejecting") {
    throw new Error(
      `Coverage pair for ${pair.ruleKey} is miswired: '${pair.accepting.id}' must be accepting and '${pair.rejecting.id}' must be rejecting.`
    );
  }

  if (differingFilePaths(pair.accepting.files, pair.rejecting.files).length === 0) {
    throw new Error(
      `Coverage pair for ${pair.ruleKey} is degenerate: fixtures '${pair.accepting.id}' and '${pair.rejecting.id}' have identical contents.`
    );
  }

  try {
    const accepting = await runValidationPipeline(pair.accepting);

    assertNoInternalProcessingErrors(accepting);
    assertRuleWasApplicable(accepting, pair.ruleKey);
    assertRuleAbsent(accepting, pair.ruleKey);
  } finally {
    cleanUpFixtureOutput(pair.accepting.id);
  }

  try {
    const rejecting = await runValidationPipeline(pair.rejecting);

    assertNoInternalProcessingErrors(rejecting);
    assertRuleWasApplicable(rejecting, pair.ruleKey);
    assertRuleMatches(rejecting, pair.ruleKey, pair.rejectingExpectation);
  } finally {
    cleanUpFixtureOutput(pair.rejecting.id);
  }
}

/** Local-debugging filter parsed from the environment. */
export interface IHarnessFilter {
  /** Uppercased tokens; each may be a generator id, rule key, rule index, or category. */
  readonly tokens: readonly string[];
  readonly suite?: ProjectInfoSuite;
}

/**
 * MCT_RULE_HARNESS_FILTER is a comma-separated list where each token matches a
 * pair by generator id ("CHKMANIF"), full rule key ("CHKMANIF:101"), bare rule
 * index ("101"), or category ("project", "projectItem", "file", "manager").
 * MCT_RULE_HARNESS_SUITE narrows to one suite by its report name (e.g.
 * "currentplatform", "addon"). Pairs excluded by a filter run as explicitly
 * skipped mocha tests, never as silent omissions.
 */
export function getHarnessFilterFromEnv(env: { [name: string]: string | undefined } = process.env): IHarnessFilter {
  const tokens = (env["MCT_RULE_HARNESS_FILTER"] ?? "")
    .split(",")
    .map((token) => token.trim().toUpperCase())
    .filter((token) => token.length > 0);

  const suiteName = env["MCT_RULE_HARNESS_SUITE"]?.trim();

  return {
    tokens,
    suite: suiteName ? ProjectInfoSet.getSuiteFromString(suiteName) : undefined,
  };
}

export function harnessFilterAllows(pair: ValidationRuleCoveragePair, filter: IHarnessFilter): boolean {
  if (filter.suite !== undefined && pair.accepting.suite !== filter.suite && pair.rejecting.suite !== filter.suite) {
    return false;
  }

  if (filter.tokens.length === 0) {
    return true;
  }

  const { generatorId, ruleIndex } = parseRuleKey(pair.ruleKey);
  const matchable = [generatorId, pair.ruleKey, String(ruleIndex), pair.category].map((value) => value.toUpperCase());

  return filter.tokens.some((token) => matchable.includes(token));
}

/** Deterministic shard assignment parsed from MCT_RULE_HARNESS_SHARD. */
export interface IHarnessShard {
  /** 1-based shard index (1 ≤ index ≤ total). */
  readonly index: number;
  readonly total: number;
}

/**
 * MCT_RULE_HARNESS_SHARD partitions the pair table for CI fan-out: "k/n"
 * keeps the pairs whose zero-based position in the registered pair table,
 * modulo n, equals k-1. Partitioning is by the table's fixed registration
 * order, so the same shard value always runs the same pairs and the n shards
 * together cover every pair exactly once. A malformed value throws rather
 * than silently running everything; pairs excluded by a shard run as
 * explicitly skipped tests, matching the filter behavior.
 */
export function getHarnessShardFromEnv(
  env: { [name: string]: string | undefined } = process.env
): IHarnessShard | undefined {
  const raw = env["MCT_RULE_HARNESS_SHARD"]?.trim();

  if (!raw) {
    return undefined;
  }

  const match = /^([1-9]\d*)\/([1-9]\d*)$/.exec(raw);

  if (!match) {
    throw new Error(`'${raw}' is not a valid MCT_RULE_HARNESS_SHARD; expected 'k/n' (e.g. '1/3').`);
  }

  const index = Number(match[1]);
  const total = Number(match[2]);

  if (index > total) {
    throw new Error(`MCT_RULE_HARNESS_SHARD '${raw}' is out of range; the shard index must not exceed the total.`);
  }

  return { index, total };
}

export function harnessShardAllows(pairPosition: number, shard: IHarnessShard | undefined): boolean {
  if (!shard) {
    return true;
  }

  return pairPosition % shard.total === shard.index - 1;
}
