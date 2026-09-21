// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * ValidationRuleCatalogTest — the targeted registration-drift gate for the
 * validation rule coverage catalog (see docs/ValidationRuleCatalog.md).
 *
 * What this suite guards:
 *   1. The catalog builds from the PRODUCTION GeneratorRegistrations (no
 *      manual generator list) and fails on duplicate generatorId:ruleIndex.
 *   2. Rule metadata cannot drift from registration: generatorId mismatches
 *      and declared-suite drift are catalog errors this test rejects.
 *   3. Coverage declarations must reference known rules and known fixtures;
 *      only full-pipeline E2E fixtures earn coverage credit.
 *   4. The JSON and console reports are (re)generated deterministically under
 *      app/debugoutput/validation-rule-catalog/ on every run — no timestamps,
 *      no absolute paths — so the baseline is reproducible.
 *
 * Run with: npm run test-validation-catalog (from app/)
 */

import { assert, expect } from "chai";
import * as fs from "fs";
import * as path from "path";
import {
  buildCatalogJson,
  buildValidationRuleCatalog,
  CatalogIssueKind,
  formatCatalogConsoleReport,
  listRegisteredGenerators,
  summarizeCatalog,
  summarizeCatalogByGenerator,
} from "../info/registration/ValidationRuleCatalog";
import { KnownUncoveredValidationRules, ValidationFixtures } from "../info/registration/ValidationRuleCoverage";
import { defineValidationRule, IValidationRuleProvider } from "../info/tests/ValidationRuleDefinition";
import IProjectInfoGeneratorBase from "../info/IProjectInfoGeneratorBase";
import { InfoItemType } from "../info/IInfoItemData";
import { ProjectInfoSuite } from "../info/IProjectInfoData";
import { Tests as CheckManifestTests } from "../info/projectGenerators/checkManifest/CheckManifestData";
import TestPaths from "./TestPaths";

const reportDir = path.join(TestPaths.appRoot, "debugoutput", "validation-rule-catalog");

type ProviderGenerator = IProjectInfoGeneratorBase & IValidationRuleProvider;

function syntheticGenerator(id: string, rules: ProviderGenerator["validationRules"]): ProviderGenerator {
  return {
    id,
    title: `${id} synthetic`,
    validationRules: rules,
    summarize: () => {},
  };
}

function syntheticRule(generatorId: string, ruleIndex: number, name: string) {
  return defineValidationRule({
    generatorId,
    ruleIndex,
    name,
    title: name,
    severities: [InfoItemType.error],
    suites: [ProjectInfoSuite.defaultInDevelopment],
    source: { file: "src/test/ValidationRuleCatalogTest.ts", symbol: name },
  });
}

describe("ValidationRuleCatalog", function () {
  describe("production catalog", function () {
    const catalog = buildValidationRuleCatalog();

    it("inventories every registered generator exactly once", function () {
      const generators = listRegisteredGenerators();
      const ids = generators.map((generator) => generator.id);

      expect(new Set(ids).size, "registered generator ids must be unique").to.equal(ids.length);
      expect(catalog.generatorIds.length).to.equal(ids.length);
      // Managers are reachable through both projectGenerators and updaters;
      // dedupe must keep exactly one entry for each.
      expect(catalog.generatorIds.filter((id) => id === "SCRIPTMODULE")).to.have.lengthOf(1);
    });

    it("lists every rule exposed by adopted generators exactly once, sorted deterministically", function () {
      const keys = catalog.rules.map((rule) => rule.key);

      expect(new Set(keys).size).to.equal(keys.length);

      const sortedKeys = [...catalog.rules]
        .sort((a, b) =>
          a.generatorId === b.generatorId ? a.ruleIndex - b.ruleIndex : a.generatorId < b.generatorId ? -1 : 1
        )
        .map((rule) => rule.key);
      expect(keys).to.deep.equal(sortedKeys);

      // Every CHKMANIF rule definition appears exactly once in the catalog.
      for (const test of Object.values(CheckManifestTests)) {
        expect(keys.filter((key) => key === test.key)).to.have.lengthOf(1);
      }
    });

    it("carries complete metadata on every catalog entry", function () {
      for (const rule of catalog.rules) {
        expect(rule.generatorId, rule.key).to.have.length.greaterThan(0);
        expect(Number.isInteger(rule.ruleIndex), rule.key).to.equal(true);
        expect(rule.name, rule.key).to.match(/^[a-z][A-Za-z0-9]*$/);
        expect(rule.title, rule.key).to.have.length.greaterThan(0);
        expect(rule.severities.length, rule.key).to.be.greaterThan(0);
        expect(rule.suites.length, rule.key).to.be.greaterThan(0);
        expect(rule.source.file, rule.key).to.have.length.greaterThan(0);
        expect(rule.source.file, `${rule.key} source must be repo-relative`).to.not.match(/^([A-Za-z]:[\\/]|\/)/);
      }
    });

    it("has no registration drift: every issue kind except missingMetadata fails this gate", function () {
      // Fail closed: rather than allowlisting drift kinds (which silently
      // exempted duplicateCoverageDeclaration), treat EVERY issue as drift
      // unless its kind is explicitly known to be benign here.
      // missingMetadata is the one expected kind while generators remain
      // un-adopted, and it has its own assertion below. A new CatalogIssueKind
      // therefore fails this gate until it is deliberately classified.
      const expectedKinds: CatalogIssueKind[] = ["missingMetadata"];
      const drift = catalog.issues.filter((issue) => !expectedKinds.includes(issue.kind));

      assert.deepEqual(drift, [], `catalog must have no drift errors:\n${JSON.stringify(drift, undefined, 2)}`);
    });

    it("reports generators without rule metadata as errors", function () {
      const missing = catalog.issues.filter((issue) => issue.kind === "missingMetadata");

      expect(missing.map((issue) => issue.subject).sort()).to.deep.equal([...catalog.generatorIdsMissingMetadata]);
      // CHKMANIF is adopted and must never appear as missing metadata.
      expect(catalog.generatorIdsMissingMetadata).to.not.include("CHKMANIF");
      expect(catalog.generatorIdsWithMetadata).to.include("CHKMANIF");
    });

    it("keeps CHKMANIF:101's baseline coverage intact", function () {
      const invalidFormatVersion = catalog.rules.find((rule) => rule.key === "CHKMANIF:101");

      assert(invalidFormatVersion, "CHKMANIF:101 must be in the catalog");
      expect(invalidFormatVersion.status).to.equal("complete");
      expect(invalidFormatVersion.name).to.equal("invalidFormatVersion");
      expect(invalidFormatVersion.suites).to.deep.equal([
        ProjectInfoSuite.defaultInDevelopment,
        ProjectInfoSuite.currentPlatformVersions,
      ]);
    });

    it("reports paired E2E coverage for every target family rule not in the known-uncovered ledger", function () {
      // The rule families targeted by the paired-coverage effort: manifest
      // structure, platform-version managers, texture validation, skin
      // packs, world/custom-dimension data, pack limits/metadata, language
      // catalogs and sounds, resource assets (animations, geometry,
      // particles, icons), pack/world references, schema validation, generic
      // item/file checks, policy and project-integrity checks, and the
      // cross-reference index.
      //
      // UNKFILE is deliberately not gated: its only rule (unknown file
      // extension) is reachable solely through browser FileSystemStorage —
      // NodeFolder and ZipFolder filter non-allowlisted extensions before
      // the pipeline sees them — so it cannot earn node-side E2E coverage.
      const targetFamilyGeneratorIds = [
        "CHKMANIF",
        "FORMATVER",
        "MINENGINEVER",
        "BASEGAMEVER",
        "TEXTURE",
        "TEXTUREIMAGE",
        "TEXTUREREF",
        "TEXTURELIST",
        "CSPJ",
        "WORLDDATA",
        "CDWORLDDATA",
        "PACKSIZE",
        "PACKFILECOUNT",
        "PACKMETADATA",
        "LANGFILES",
        "SNDSDEF",
        "RESOURCEANIMATION",
        "GEOFMT",
        "GEOMETRY",
        "CPARTI",
        "CPACKICON",
        "CWI",
        "FORBFILE",
        "RPDEPENDS",
        "WPACKREFS",
        "JSON",
        "COMJSON",
        "JSONF",
        "UNKJSON",
        "UNLINK",
        "VALFILE",
        "NOBOM",
        "PATHLENGTH",
        "CBFG",
        "EXPFLAG",
        "CHECKFEATUREDEPRECATION",
        "VANDUPES",
        "VANPRO",
        "PRJINT",
        "CROSSREFINDEX",
        "SCRIPTMODULE",
        "BLOCKSCAT",
        "ENTITYTYPE",
        "ITEMTYPE",
        // VSCODEFILE only emits informational items, so its (empty) rule
        // inventory is complete by construction; the informational conditions
        // are E2E-covered by VsCodeFileValidationTest.ts.
        "VSCODEFILE",
      ];

      const generatorSummaries = summarizeCatalogByGenerator(catalog);
      const summariesById = new Map(generatorSummaries.map((summary) => [summary.generatorId, summary]));

      // Rules without a pair must still be inventoried, but only if they are
      // acknowledged in the KnownUncoveredValidationRules ledger with a
      // reason. The deep-equality below enforces both directions: an
      // unlisted incomplete rule fails (silent coverage loss), and a ledger
      // entry whose rule is complete or missing from the catalog also fails
      // (stale ledger).
      const knownUncoveredKeys = new Set(KnownUncoveredValidationRules.map((entry) => entry.ruleKey));

      expect(knownUncoveredKeys.size, "known-uncovered ledger must not repeat rule keys").to.equal(
        KnownUncoveredValidationRules.length
      );

      for (const generatorId of targetFamilyGeneratorIds) {
        expect(catalog.generatorIdsWithMetadata, `${generatorId} must expose rule metadata`).to.include(generatorId);

        const generatorSummary = summariesById.get(generatorId);

        assert(generatorSummary, `${generatorId} must appear in the per-generator rollup`);

        const incomplete = catalog.rules
          .filter((rule) => rule.generatorId === generatorId && rule.status !== "complete")
          .map((rule) => rule.key)
          .sort();

        const expectedUncovered = [...knownUncoveredKeys]
          .filter((ruleKey) => ruleKey.startsWith(`${generatorId}:`))
          .sort();

        assert.deepEqual(
          incomplete,
          expectedUncovered,
          `every ${generatorId} rule must either have paired accepting+rejecting E2E coverage or be declared in KnownUncoveredValidationRules`
        );
        expect(generatorSummary.isComplete, generatorId).to.equal(expectedUncovered.length === 0);
      }
    });

    it("declares fixtures whose content exists in the repository", function () {
      for (const fixture of ValidationFixtures) {
        const fixturePath = path.join(TestPaths.appRoot, "..", fixture.contentPath);
        assert(fs.existsSync(fixturePath), `fixture '${fixture.id}' content missing at ${fixture.contentPath}`);
      }
    });
  });

  describe("catalog integrity checks", function () {
    it("fails generation on duplicate generatorId:ruleIndex keys", function () {
      const duplicated = syntheticGenerator("SYNTH", [
        syntheticRule("SYNTH", 101, "firstRule"),
        syntheticRule("SYNTH", 101, "secondRule"),
      ]);

      expect(() =>
        buildValidationRuleCatalog({ generators: [duplicated], coverageDeclarations: [], fixtures: [] })
      ).to.throw(/Duplicate validation rule key 'SYNTH:101'/);
    });

    it("reports coverage declarations for unknown rules and unknown fixtures as errors", function () {
      const generator = syntheticGenerator("SYNTH", [syntheticRule("SYNTH", 101, "firstRule")]);

      const catalog = buildValidationRuleCatalog({
        generators: [generator],
        fixtures: [
          {
            id: "goodFixture",
            kind: "fullPipelineE2E",
            contentPath: "samplecontent/simple",
            declaredBy: "src/test/ValidationRuleCatalogTest.ts",
            description: "synthetic",
          },
        ],
        coverageDeclarations: [
          { ruleKey: "SYNTH:999", acceptingFixtureIds: ["goodFixture"], rejectingFixtureIds: [] },
          { ruleKey: "SYNTH:101", acceptingFixtureIds: ["nonexistentFixture"], rejectingFixtureIds: ["goodFixture"] },
        ],
      });

      expect(
        catalog.issues.filter((issue) => issue.kind === "unknownRule").map((issue) => issue.subject)
      ).to.deep.equal(["SYNTH:999"]);
      expect(
        catalog.issues.filter((issue) => issue.kind === "unknownFixture").map((issue) => issue.subject)
      ).to.deep.equal(["nonexistentFixture"]);
    });

    it("reports a duplicate coverage declaration as an error and keeps the first declaration", function () {
      const generator = syntheticGenerator("SYNTH", [syntheticRule("SYNTH", 101, "firstRule")]);

      const catalog = buildValidationRuleCatalog({
        generators: [generator],
        fixtures: [
          {
            id: "e2e",
            kind: "fullPipelineE2E",
            contentPath: "samplecontent/simple",
            declaredBy: "src/test/ValidationRuleCatalogTest.ts",
            description: "synthetic",
          },
        ],
        coverageDeclarations: [
          { ruleKey: "SYNTH:101", acceptingFixtureIds: ["e2e"], rejectingFixtureIds: ["e2e"] },
          { ruleKey: "SYNTH:101", acceptingFixtureIds: [], rejectingFixtureIds: [] },
        ],
      });

      expect(
        catalog.issues.filter((issue) => issue.kind === "duplicateCoverageDeclaration").map((issue) => issue.subject)
      ).to.deep.equal(["SYNTH:101"]);
      // The first declaration stays in effect; the duplicate is reported, not applied.
      expect(catalog.rules[0].status).to.equal("complete");
    });

    it("classifies coverage as complete / missing-accepting / missing-rejecting / missing-both", function () {
      const generator = syntheticGenerator("SYNTH", [
        syntheticRule("SYNTH", 101, "completeRule"),
        syntheticRule("SYNTH", 102, "rejectOnlyRule"),
        syntheticRule("SYNTH", 103, "acceptOnlyRule"),
        syntheticRule("SYNTH", 104, "uncoveredRule"),
      ]);

      const fixtures = [
        {
          id: "e2e",
          kind: "fullPipelineE2E" as const,
          contentPath: "samplecontent/simple",
          declaredBy: "src/test/ValidationRuleCatalogTest.ts",
          description: "synthetic",
        },
      ];

      const catalog = buildValidationRuleCatalog({
        generators: [generator],
        fixtures,
        coverageDeclarations: [
          { ruleKey: "SYNTH:101", acceptingFixtureIds: ["e2e"], rejectingFixtureIds: ["e2e"] },
          { ruleKey: "SYNTH:102", acceptingFixtureIds: [], rejectingFixtureIds: ["e2e"] },
          { ruleKey: "SYNTH:103", acceptingFixtureIds: ["e2e"], rejectingFixtureIds: [] },
        ],
      });

      const statusByKey = new Map(catalog.rules.map((rule) => [rule.key, rule.status]));
      expect(statusByKey.get("SYNTH:101")).to.equal("complete");
      expect(statusByKey.get("SYNTH:102")).to.equal("missing-accepting");
      expect(statusByKey.get("SYNTH:103")).to.equal("missing-rejecting");
      expect(statusByKey.get("SYNTH:104")).to.equal("missing-both");
    });

    it("gives E2E credit only to full-pipeline fixtures", function () {
      const generator = syntheticGenerator("SYNTH", [syntheticRule("SYNTH", 101, "unitOnlyRule")]);

      const catalog = buildValidationRuleCatalog({
        generators: [generator],
        fixtures: [
          {
            id: "unitFixture",
            kind: "unit",
            contentPath: "samplecontent/simple",
            declaredBy: "src/test/ValidationRuleCatalogTest.ts",
            description: "generator-in-isolation fixture; earns no E2E credit",
          },
        ],
        coverageDeclarations: [
          { ruleKey: "SYNTH:101", acceptingFixtureIds: ["unitFixture"], rejectingFixtureIds: ["unitFixture"] },
        ],
      });

      // The declaration is legal (fixture is known) but does not credit E2E
      // coverage: the rule stays missing-both.
      expect(catalog.issues.filter((issue) => issue.kind === "unknownFixture")).to.have.lengthOf(0);
      expect(catalog.rules[0].status).to.equal("missing-both");
    });

    it("reports a rule exposed under a foreign generator id as drift", function () {
      const generator = syntheticGenerator("SYNTH", [syntheticRule("OTHER", 101, "strayRule")]);

      const catalog = buildValidationRuleCatalog({ generators: [generator], coverageDeclarations: [], fixtures: [] });

      expect(catalog.issues.some((issue) => issue.kind === "generatorIdMismatch")).to.equal(true);
    });
  });

  describe("reports under app/debugoutput", function () {
    it("writes deterministic JSON and console reports", function () {
      const catalog = buildValidationRuleCatalog();
      const json = buildCatalogJson(catalog);
      const consoleReport = formatCatalogConsoleReport(catalog);

      // Deterministic: a second build over the same source is byte-identical.
      expect(buildCatalogJson(buildValidationRuleCatalog())).to.equal(json);

      // No timestamps and no absolute paths in the artifact.
      expect(json).to.not.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
      expect(json).to.not.match(/[A-Za-z]:\\\\/);

      fs.mkdirSync(reportDir, { recursive: true });
      fs.writeFileSync(path.join(reportDir, "validation-rule-catalog.json"), json);
      fs.writeFileSync(path.join(reportDir, "validation-rule-catalog.txt"), consoleReport);

      const summary = summarizeCatalog(catalog);
      console.log(consoleReport);
      console.log(
        `\nReports written to debugoutput/validation-rule-catalog (rules: ${summary.totalRules}, ` +
          `generators missing metadata: ${summary.generatorsMissingMetadata})`
      );

      expect(summary.totalRules).to.be.greaterThan(0);
      expect(summary.complete).to.be.greaterThan(0);
    });
  });
});
