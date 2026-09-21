// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * ValidationFixtureSizeAuditTest — the tracked-file size audit for the
 * paired-validation fixture footprint (see docs/ValidationRuleCatalog.md,
 * "CI enforcement").
 *
 * The designated footprint is every unique contentPath declared in
 * ValidationFixtures: the checked-in sample content plus the recipe modules
 * that generate fixtures at test time. The budget is 25 MiB (26,214,400
 * bytes). Generated packs must always be synthesized during a run and never
 * checked in, so the tracked footprint stays small and roughly constant; a
 * breach means fixture content is being committed instead of generated.
 *
 * The audit also pins the generated-output roots as gitignored, so harness
 * and catalog runs cannot dirty the worktree.
 *
 * Run with: npm run test-validation-size-audit (from app/)
 */

import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { assert, expect } from "chai";
import { ValidationFixtures } from "../info/registration/ValidationRuleCoverage";
import TestPaths from "./TestPaths";

/** 25 MiB — the hard budget for the tracked paired-validation fixture footprint. */
const FixtureFootprintBudgetBytes = 26_214_400;

const repoRoot = path.resolve(TestPaths.appRoot, "..");

/** Repo-relative roots that only ever hold generated validation output. */
const GeneratedOutputRoots = [
  "app/debugoutput/validation-rule-harness",
  "app/debugoutput/validation-rule-catalog",
];

/**
 * Repo-relative roots designated as fixture content beyond the declared
 * ValidationFixtures contentPaths: the per-family pair modules (including
 * synthesized-byte helpers such as WorldFixtureBytes.ts) are where checked-in
 * fixture bytes would creep in.
 */
const AdditionalFixtureRoots = ["app/src/test/validationRulePairs"];

function runGit(args: string[]): { status: number; stdout: string } {
  try {
    return { status: 0, stdout: execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }) };
  } catch (e: any) {
    return { status: typeof e.status === "number" ? e.status : 1, stdout: e.stdout ?? "" };
  }
}

/** Tracked files (repo-relative, forward slashes) under a repo-relative path. */
function trackedFiles(repoRelativePath: string): string[] {
  const result = runGit(["ls-files", "-z", "--", repoRelativePath]);

  assert.strictEqual(result.status, 0, `git ls-files failed for '${repoRelativePath}'`);

  return result.stdout.split("\0").filter((entry) => entry.length > 0);
}

describe("ValidationFixtureSizeAudit", function () {
  const contentPaths = [
    ...new Set([...ValidationFixtures.map((fixture) => fixture.contentPath), ...AdditionalFixtureRoots]),
  ].sort();

  it("keeps the tracked paired-validation fixture footprint within the 25 MiB budget", function () {
    let totalBytes = 0;
    const breakdown: string[] = [];

    for (const contentPath of contentPaths) {
      const files = trackedFiles(contentPath);

      // A declared fixture whose content is not tracked would silently audit
      // as zero bytes; the catalog test separately checks it exists on disk,
      // and here it must also be committed.
      expect(files.length, `fixture content '${contentPath}' has no tracked files`).to.be.greaterThan(0);

      let pathBytes = 0;

      for (const file of files) {
        const absolutePath = path.join(repoRoot, file);

        assert(fs.existsSync(absolutePath), `tracked fixture file missing on disk: ${file}`);
        pathBytes += fs.statSync(absolutePath).size;
      }

      totalBytes += pathBytes;
      breakdown.push(`  ${contentPath}: ${files.length} file(s), ${pathBytes.toLocaleString()} bytes`);
    }

    console.log(
      `Paired-validation fixture footprint: ${totalBytes.toLocaleString()} of ` +
        `${FixtureFootprintBudgetBytes.toLocaleString()} bytes\n${breakdown.join("\n")}`
    );

    expect(
      totalBytes,
      `the tracked paired-validation fixture footprint exceeds the 25 MiB budget — generate fixture ` +
        `content at test time instead of committing it`
    ).to.be.at.most(FixtureFootprintBudgetBytes);
  });

  it("keeps every generated-output root gitignored so runs stay untracked", function () {
    for (const outputRoot of GeneratedOutputRoots) {
      // check-ignore exits 0 when the path is covered by an ignore rule; it
      // works on the pattern itself, so the directory need not exist yet.
      const result = runGit(["check-ignore", "-q", outputRoot]);

      expect(result.status, `'${outputRoot}' must be gitignored`).to.equal(0);
    }
  });

  it("has no generated validation output tracked in git", function () {
    for (const outputRoot of GeneratedOutputRoots) {
      const files = trackedFiles(outputRoot);

      expect(files, `generated output under '${outputRoot}' must never be committed`).to.have.lengthOf(0);
    }
  });
});
