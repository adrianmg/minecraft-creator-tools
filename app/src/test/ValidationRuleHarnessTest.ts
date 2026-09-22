// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * ValidationRuleHarnessTest — runs the representative coverage pairs through
 * the paired E2E validation-rule harness (ValidationRuleHarness.ts) and
 * proves the harness's own failure detection: unexpected skips, fixture load
 * failures, duplicate target results, internal-processing errors, and
 * expectation mismatches must all throw.
 *
 * Run with: npm run test-validation-harness (from app/)
 * Filter locally with MCT_RULE_HARNESS_FILTER / MCT_RULE_HARNESS_SUITE;
 * shard deterministically for CI fan-out with MCT_RULE_HARNESS_SHARD=k/n.
 */

import { assert, expect } from "chai";
import * as fs from "fs";
import * as path from "path";
import ProjectInfoSet from "../info/ProjectInfoSet";
import ProjectInfoItem from "../info/ProjectInfoItem";
import { InfoItemType } from "../info/IInfoItemData";
import { ProjectInfoSuite } from "../info/IProjectInfoData";
import {
  HarnessOutputRoot,
  ValidationFixtureRecipe,
  ValidationPipelineResult,
  assertNoInternalProcessingErrors,
  assertRuleAbsent,
  assertRuleMatches,
  assertRuleWasApplicable,
  cleanUpFixtureOutput,
  differingFilePaths,
  fixtureOutputPath,
  getHarnessFilterFromEnv,
  getHarnessShardFromEnv,
  harnessFilterAllows,
  harnessShardAllows,
  parseRuleKey,
  runValidationPipeline,
  verifyCoveragePair,
} from "./ValidationRuleHarness";
import { ValidationRuleCoveragePairs, coveragePairFromBase, noByteOrderMarkPair } from "./ValidationRuleHarnessPairs";
import { ValidationFixtures, ValidationRuleCoverageDeclarations } from "../info/registration/ValidationRuleCoverage";
import TestPaths from "./TestPaths";

const PairTimeout = 60000;

async function expectRejection(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  try {
    await promise;
  } catch (e: any) {
    expect(String(e.message ?? e)).to.match(pattern);
    return;
  }

  assert.fail(`Expected a rejection matching ${pattern}, but the promise resolved.`);
}

function syntheticRecipe(id: string, suite: ProjectInfoSuite = ProjectInfoSuite.defaultInDevelopment) {
  const recipe: ValidationFixtureRecipe = {
    id,
    description: "synthetic",
    kind: "rejecting",
    suite,
    files: { "behavior_packs/test_bp/manifest.json": "{}" },
  };

  return recipe;
}

function syntheticResult(items: ProjectInfoItem[]): ValidationPipelineResult {
  const infoSet = new ProjectInfoSet(undefined, ProjectInfoSuite.defaultInDevelopment);

  infoSet.items = items;

  return {
    recipe: syntheticRecipe("synthetic-result"),
    infoSet,
    items,
    executedGeneratorIds: new Set(items.map((item) => item.generatorId)),
  };
}

describe("ValidationRuleHarness coverage pairs", function () {
  const filter = getHarnessFilterFromEnv();
  const shard = getHarnessShardFromEnv();

  ValidationRuleCoveragePairs.forEach((pair, pairPosition) => {
    const title =
      `${pair.ruleKey} (${pair.category}): '${pair.rejecting.id}' flags and ` +
      `'${pair.accepting.id}' stays quiet through the production pipeline`;

    // Pairs excluded by a local filter or a CI shard show up as explicitly
    // skipped tests, never as silent omissions.
    const testFn = harnessFilterAllows(pair, filter) && harnessShardAllows(pairPosition, shard) ? it : it.skip;

    testFn(title, async function () {
      this.timeout(PairTimeout);

      await verifyCoveragePair(pair);

      // Cleanup is part of the harness contract: no generated output survives.
      assert.isFalse(fs.existsSync(fixtureOutputPath(pair.accepting.id)));
      assert.isFalse(fs.existsSync(fixtureOutputPath(pair.rejecting.id)));
    });
  });

  it("keeps every generated fixture under app/debugoutput so runs cannot dirty the worktree", function () {
    const debugOutputRoot = path.join(TestPaths.appRoot, "debugoutput");

    expect(HarnessOutputRoot.startsWith(debugOutputRoot)).to.equal(true);

    for (const pair of ValidationRuleCoveragePairs) {
      for (const recipe of [pair.accepting, pair.rejecting]) {
        expect(fixtureOutputPath(recipe.id).startsWith(HarnessOutputRoot), recipe.id).to.equal(true);
      }
    }
  });

  it("pairs fixtures that differ only in the file carrying the condition under test", function () {
    ValidationRuleCoveragePairs.forEach((pair, pairPosition) => {
      // Reading a pair's files materializes its (possibly lazy) fixture
      // content, so respect the local filter and the CI shard here too: a
      // targeted or sharded run must not synthesize the bulky payloads of
      // excluded pairs. Unfiltered, unsharded runs still check every pair.
      if (!harnessFilterAllows(pair, filter) || !harnessShardAllows(pairPosition, shard)) {
        return;
      }

      const differing = differingFilePaths(pair.accepting.files, pair.rejecting.files);

      expect(differing, pair.ruleKey).to.have.lengthOf(1);
    });
  });

  it("materializes lazy base-file builders only when a fixture's files are read, exactly once", function () {
    let builds = 0;

    const pair = coveragePairFromBase({
      ruleKey: "CHKMANIF:101",
      category: "project",
      suite: ProjectInfoSuite.defaultInDevelopment,
      baseFiles: () => {
        builds++;
        return { "behavior_packs/test_bp/manifest.json": "{}" };
      },
      accepting: { id: "harness-selftest-lazy-accept", description: "synthetic" },
      rejecting: {
        id: "harness-selftest-lazy-reject",
        description: "synthetic",
        files: { "behavior_packs/test_bp/extra.json": "{}" },
      },
      rejectingExpectation: { severity: InfoItemType.error },
    });

    // Building the pair (what registry import does) must not run the thunk;
    // this is what keeps the multi-hundred-megabyte pack-size payloads out
    // of runs that never execute those pairs.
    expect(builds).to.equal(0);

    expect(Object.keys(pair.accepting.files)).to.have.lengthOf(1);
    expect(Object.keys(pair.rejecting.files)).to.have.lengthOf(2);

    // The resolved base is cached and shared by both sides; repeat reads
    // never re-run the thunk.
    expect(Object.keys(pair.accepting.files)).to.have.lengthOf(1);
    expect(builds).to.equal(1);
  });

  it("covers the project, projectItem, file, and manager generator categories", function () {
    const categories = new Set(ValidationRuleCoveragePairs.map((pair) => pair.category));

    expect([...categories].sort()).to.deep.equal(["file", "manager", "project", "projectItem"]);
  });
});

describe("ValidationRuleHarness coverage declarations", function () {
  // Rules whose pairs cannot be declared without producing an unknown-rule
  // catalog error. Empty now that every pair's generator exposes catalog
  // metadata; a pair for a not-yet-adopted generator would be listed here.
  const undeclarablePairRuleKeys = new Set<string>([]);

  const acceptingPairIds = new Set(ValidationRuleCoveragePairs.map((pair) => `${pair.ruleKey}|${pair.accepting.id}`));
  const rejectingPairIds = new Set(ValidationRuleCoveragePairs.map((pair) => `${pair.ruleKey}|${pair.rejecting.id}`));

  // Fixture ids the registry attributes to this test file: the explicit
  // harness fixtures plus every id auto-registered from the HarnessCoverage
  // table. Identified through the registry rather than an id prefix, so a
  // mistyped or unconventionally-named coverage id still has to be backed by
  // an executed pair before it can earn catalog credit.
  const harnessDeclaredFixtureIds = new Set(
    ValidationFixtures.filter((fixture) => fixture.declaredBy === "app/src/test/ValidationRuleHarnessTest.ts").map(
      (fixture) => fixture.id
    )
  );

  it("backs every harness-declared fixture id with a registered pair for the same rule", function () {
    for (const declaration of ValidationRuleCoverageDeclarations) {
      for (const fixtureId of declaration.acceptingFixtureIds) {
        if (harnessDeclaredFixtureIds.has(fixtureId)) {
          assert(
            acceptingPairIds.has(`${declaration.ruleKey}|${fixtureId}`),
            `declaration for ${declaration.ruleKey} references accepting fixture '${fixtureId}' with no matching pair`
          );
        }
      }

      for (const fixtureId of declaration.rejectingFixtureIds) {
        if (harnessDeclaredFixtureIds.has(fixtureId)) {
          assert(
            rejectingPairIds.has(`${declaration.ruleKey}|${fixtureId}`),
            `declaration for ${declaration.ruleKey} references rejecting fixture '${fixtureId}' with no matching pair`
          );
        }
      }
    }
  });

  it("declares every registered pair's fixtures in the coverage declarations", function () {
    const declarationsByRuleKey = new Map(
      ValidationRuleCoverageDeclarations.map((declaration) => [declaration.ruleKey, declaration])
    );

    for (const pair of ValidationRuleCoveragePairs) {
      if (undeclarablePairRuleKeys.has(pair.ruleKey)) {
        continue;
      }

      const declaration = declarationsByRuleKey.get(pair.ruleKey);

      assert(declaration, `pair for ${pair.ruleKey} has no coverage declaration`);
      expect(declaration.acceptingFixtureIds, `${pair.ruleKey} accepting`).to.include(pair.accepting.id);
      expect(declaration.rejectingFixtureIds, `${pair.ruleKey} rejecting`).to.include(pair.rejecting.id);
    }
  });
});

describe("ValidationRuleHarness failure detection", function () {
  it("fails on a recipe with no files (fixture load failure)", async function () {
    const recipe: ValidationFixtureRecipe = {
      id: "harness-selftest-empty",
      description: "synthetic",
      kind: "rejecting",
      suite: ProjectInfoSuite.defaultInDevelopment,
      files: {},
    };

    await expectRejection(runValidationPipeline(recipe), /Fixture load failure/);
  });

  it("fails on a recipe whose paths escape the fixture root (fixture load failure)", async function () {
    const recipe: ValidationFixtureRecipe = {
      id: "harness-selftest-escape",
      description: "synthetic",
      kind: "rejecting",
      suite: ProjectInfoSuite.defaultInDevelopment,
      files: { "../escaped.json": "{}" },
    };

    await expectRejection(runValidationPipeline(recipe), /illegal fixture path/);

    cleanUpFixtureOutput(recipe.id);
  });

  it("rejects backslash and traversal variants in recipe paths", async function () {
    // Backslashes are refused outright (never normalized), so Windows-style
    // traversal cannot bypass the forward-slash segment check.
    for (const badPath of ["..\\..\\escaped.json", "a\\..\\b.json", "sub\\file.json", "./file.json", "a/./b.json"]) {
      const recipe: ValidationFixtureRecipe = {
        id: "harness-selftest-badpath",
        description: "synthetic",
        kind: "rejecting",
        suite: ProjectInfoSuite.defaultInDevelopment,
        files: { [badPath]: "{}" },
      };

      await expectRejection(runValidationPipeline(recipe), /illegal fixture path/);

      cleanUpFixtureOutput(recipe.id);
    }
  });

  it("rejects fixture ids that are not plain slugs before writing or deleting anything", async function () {
    for (const badId of ["../..", "..\\..", "a/../b", "a\\b", "..", ".", "", "-leading-dash"]) {
      expect(() => fixtureOutputPath(badId), badId).to.throw(/not a valid fixture id/);
      expect(() => cleanUpFixtureOutput(badId), badId).to.throw(/not a valid fixture id/);

      const recipe: ValidationFixtureRecipe = {
        id: badId,
        description: "synthetic",
        kind: "rejecting",
        suite: ProjectInfoSuite.defaultInDevelopment,
        files: { "behavior_packs/test_bp/manifest.json": "{}" },
      };

      await expectRejection(runValidationPipeline(recipe), /not a valid fixture id/);
    }
  });

  it("fails when the target generator is not part of the suite (unexpected skip)", async function () {
    this.timeout(PairTimeout);

    // NOBOM does not participate in the currentPlatformVersions suite, so the
    // same fixture contents must be reported as an unexpected skip there.
    const recipe: ValidationFixtureRecipe = {
      ...noByteOrderMarkPair.rejecting,
      id: "harness-selftest-skip",
      suite: ProjectInfoSuite.currentPlatformVersions,
    };

    try {
      const result = await runValidationPipeline(recipe);

      expect(() => assertRuleWasApplicable(result, noByteOrderMarkPair.ruleKey)).to.throw(/Unexpected skip/);
    } finally {
      cleanUpFixtureOutput(recipe.id);
    }
  });

  it("fails when the generator reports no applicable items (unexpected skip)", function () {
    const result = syntheticResult([
      new ProjectInfoItem(InfoItemType.testCompleteNoApplicableItemsFound, "CHKMANIF", 2, "No applicable items found"),
    ]);

    expect(() => assertRuleWasApplicable(result, "CHKMANIF:101")).to.throw(/no applicable items/);
  });

  it("fails on internal-processing errors anywhere in the run", function () {
    const result = syntheticResult([
      new ProjectInfoItem(InfoItemType.internalProcessingError, "WORLDDATA", 501, "IP2: something threw"),
      new ProjectInfoItem(InfoItemType.error, "CHKMANIF", 101, "InvalidFormatVersion"),
    ]);

    expect(() => assertNoInternalProcessingErrors(result)).to.throw(/internal-processing error/);
  });

  it("fails on unexpected duplicate target results", function () {
    const result = syntheticResult([
      new ProjectInfoItem(InfoItemType.error, "CHKMANIF", 101, "InvalidFormatVersion"),
      new ProjectInfoItem(InfoItemType.error, "CHKMANIF", 101, "InvalidFormatVersion"),
    ]);

    expect(() => assertRuleMatches(result, "CHKMANIF:101", { severity: InfoItemType.error, count: 1 })).to.throw(
      /Unexpected duplicate results/
    );
  });

  it("fails on a duplicate target result at a different severity than the one expected", function () {
    // The rule fires once at the expected severity and once at another; the
    // count is taken before the severity filter, so the stray result cannot
    // escape the exact-count contract.
    const result = syntheticResult([
      new ProjectInfoItem(InfoItemType.error, "CHKMANIF", 101, "InvalidFormatVersion"),
      new ProjectInfoItem(InfoItemType.warning, "CHKMANIF", 101, "InvalidFormatVersion"),
    ]);

    expect(() => assertRuleMatches(result, "CHKMANIF:101", { severity: InfoItemType.error, count: 1 })).to.throw(
      /Unexpected duplicate results/
    );
  });

  it("fails when the rule does not fire on a rejecting fixture", function () {
    const result = syntheticResult([
      new ProjectInfoItem(InfoItemType.testCompleteSuccess, "CHKMANIF", 1, "Check Manifest completed successfully"),
    ]);

    expect(() => assertRuleMatches(result, "CHKMANIF:101", { severity: InfoItemType.error })).to.throw(
      /Expected 1 result/
    );
  });

  it("fails when the fired rule mismatches the path, message, or data expectations", function () {
    const result = syntheticResult([
      new ProjectInfoItem(InfoItemType.error, "CHKMANIF", 101, "InvalidFormatVersion", undefined, 99),
    ]);

    expect(() =>
      assertRuleMatches(result, "CHKMANIF:101", { severity: InfoItemType.error, message: "some other message" })
    ).to.throw(/does not match the expected message/);

    expect(() => assertRuleMatches(result, "CHKMANIF:101", { severity: InfoItemType.error, data: 2 })).to.throw(
      /does not deep-equal the expected data/
    );

    expect(() =>
      assertRuleMatches(result, "CHKMANIF:101", { severity: InfoItemType.error, projectPath: /manifest\.json$/ })
    ).to.throw(/does not match the expected path/);
  });

  it("fails when the rule fires on an accepting fixture", function () {
    const result = syntheticResult([new ProjectInfoItem(InfoItemType.error, "CHKMANIF", 101, "InvalidFormatVersion")]);

    expect(() => assertRuleAbsent(result, "CHKMANIF:101")).to.throw(/must stay quiet/);
  });

  it("accepts a correctly-firing rule with matching severity, path, message, and data", function () {
    const result = syntheticResult([
      new ProjectInfoItem(InfoItemType.error, "CHKMANIF", 101, "InvalidFormatVersion", undefined, 99),
      new ProjectInfoItem(InfoItemType.testCompleteFail, "CHKMANIF", 0, "Found 1 error in Check Manifest check"),
    ]);

    assertRuleWasApplicable(result, "CHKMANIF:101");
    assertNoInternalProcessingErrors(result);
    assertRuleMatches(result, "CHKMANIF:101", {
      severity: InfoItemType.error,
      count: 1,
      message: "InvalidFormatVersion",
      data: 99,
    });
  });
});

describe("ValidationRuleHarness filtering", function () {
  const samplePair = ValidationRuleCoveragePairs[0];

  it("parses generator, rule key, index, and category tokens plus a suite from the environment", function () {
    const filter = getHarnessFilterFromEnv({
      MCT_RULE_HARNESS_FILTER: "chkmanif, MINENGINEVER:120 ,file",
      MCT_RULE_HARNESS_SUITE: "currentplatform",
    });

    expect(filter.tokens).to.deep.equal(["CHKMANIF", "MINENGINEVER:120", "FILE"]);
    expect(filter.suite).to.equal(ProjectInfoSuite.currentPlatformVersions);
  });

  it("returns an all-pass filter when no environment variables are set", function () {
    const filter = getHarnessFilterFromEnv({});

    expect(filter.tokens).to.have.lengthOf(0);
    expect(filter.suite).to.equal(undefined);

    for (const pair of ValidationRuleCoveragePairs) {
      expect(harnessFilterAllows(pair, filter), pair.ruleKey).to.equal(true);
    }
  });

  it("matches pairs by generator id, full rule key, rule index, and category", function () {
    const { generatorId, ruleIndex } = parseRuleKey(samplePair.ruleKey);

    for (const token of [generatorId, samplePair.ruleKey, String(ruleIndex), samplePair.category]) {
      expect(harnessFilterAllows(samplePair, { tokens: [token.toUpperCase()] }), `token '${token}'`).to.equal(true);
    }

    expect(harnessFilterAllows(samplePair, { tokens: ["NOSUCHGENERATOR"] })).to.equal(false);
  });

  it("narrows by suite", function () {
    expect(harnessFilterAllows(samplePair, { tokens: [], suite: samplePair.accepting.suite })).to.equal(true);
    expect(harnessFilterAllows(samplePair, { tokens: [], suite: ProjectInfoSuite.cooperativeAddOn })).to.equal(false);
  });
});

describe("ValidationRuleHarness sharding", function () {
  it("parses a k/n shard from the environment and returns undefined when unset", function () {
    expect(getHarnessShardFromEnv({ MCT_RULE_HARNESS_SHARD: "2/3" })).to.deep.equal({ index: 2, total: 3 });
    expect(getHarnessShardFromEnv({})).to.equal(undefined);
    expect(getHarnessShardFromEnv({ MCT_RULE_HARNESS_SHARD: "  " })).to.equal(undefined);
  });

  it("rejects malformed or out-of-range shard values", function () {
    for (const bad of ["3", "0/3", "1/0", "a/b", "1/3/5", "-1/3"]) {
      expect(() => getHarnessShardFromEnv({ MCT_RULE_HARNESS_SHARD: bad }), bad).to.throw(
        /MCT_RULE_HARNESS_SHARD/
      );
    }

    expect(() => getHarnessShardFromEnv({ MCT_RULE_HARNESS_SHARD: "4/3" })).to.throw(/out of range/);
  });

  it("partitions pair positions deterministically with every position in exactly one shard", function () {
    const total = 3;
    const shards = [1, 2, 3].map((index) => ({ index, total }));

    for (let position = 0; position < ValidationRuleCoveragePairs.length; position++) {
      const owners = shards.filter((shard) => harnessShardAllows(position, shard));

      expect(owners, `position ${position}`).to.have.lengthOf(1);
      // Deterministic: repeat evaluation assigns the same shard.
      expect(harnessShardAllows(position, owners[0])).to.equal(true);
    }
  });

  it("allows every position when no shard is configured", function () {
    expect(harnessShardAllows(0, undefined)).to.equal(true);
    expect(harnessShardAllows(41, undefined)).to.equal(true);
  });
});

describe("ValidationRuleHarness rule keys", function () {
  it("parses generator id and rule index from a rule key", function () {
    expect(parseRuleKey("CHKMANIF:101")).to.deep.equal({ generatorId: "CHKMANIF", ruleIndex: 101 });
  });

  it("rejects malformed rule keys", function () {
    for (const bad of ["CHKMANIF", ":101", "CHKMANIF:", "CHKMANIF:-1", "CHKMANIF:x"]) {
      expect(() => parseRuleKey(bad as any), bad).to.throw(/not a valid rule key/);
    }
  });
});
