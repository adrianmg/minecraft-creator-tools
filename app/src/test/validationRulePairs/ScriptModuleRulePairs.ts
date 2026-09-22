// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * ScriptModuleRulePairs — paired E2E coverage for the script module
 * dependency manager (SCRIPTMODULE), which cross-checks @minecraft/* module
 * dependencies declared in behavior pack manifests against npm registry
 * descriptors and package.json registrations.
 *
 * Registry lookups are pinned via the prepare hook (TestScriptModulePin):
 * fixture module names live under synthetic @minecraft/mct-harness-* ids
 * that only these pairs reference, and the not-registered case seeds a
 * known-missing descriptor so no fixture ever consults the live registry.
 */

import { InfoItemType } from "../../info/IInfoItemData";
import { ProjectInfoSuite } from "../../info/IProjectInfoData";
import {
  ValidationFixtureFiles,
  ValidationRuleCoveragePair,
  ValidationResultExpectation,
} from "../ValidationRuleHarness";
import { ValidationRuleKey } from "../../info/tests/ValidationRuleDefinition";
import { pinMissingModuleDescriptor, pinModuleDescriptor } from "../TestScriptModulePin";
import { BpManifestPath, bpManifest, coveragePairFromBase, json } from "./PairFixtureBuilders";

const StableModule = "@minecraft/mct-harness-stable";
const BetaModule = "@minecraft/mct-harness-beta";
const UnregisteredModule = "@minecraft/mct-harness-unregistered";

const StableLatestVersion = "2.0.0";
const BetaCurrentVersion = "1.5.0";
const BetaOutdatedVersion = "1.4.0";

const PackageJsonPath = "package.json";

function pinHarnessModuleDescriptors() {
  pinModuleDescriptor(StableModule, { latest: StableLatestVersion });
  pinModuleDescriptor(BetaModule, { latest: BetaOutdatedVersion, beta: BetaCurrentVersion });
  pinMissingModuleDescriptor(UnregisteredModule);
}

/** BP manifest declaring one script module dependency. */
function bpManifestWithModule(moduleName: string, version: string): string {
  return json(bpManifest({ dependencies: [{ module_name: moduleName, version }] }));
}

/** Minimal npm package manifest registering the given @minecraft/* modules. */
function packageJson(dependencies: { readonly [moduleName: string]: string }): string {
  return json({
    name: "mct-harness-scripts",
    version: "1.0.0",
    dependencies,
  });
}

const scriptModulePair = (spec: {
  ruleIndex: number;
  slug: string;
  baseFiles: ValidationFixtureFiles;
  acceptingDescription: string;
  acceptingFiles: ValidationFixtureFiles;
  rejectingDescription: string;
  rejectingFiles: ValidationFixtureFiles;
  expectation: ValidationResultExpectation;
}): ValidationRuleCoveragePair =>
  coveragePairFromBase({
    ruleKey: `SCRIPTMODULE:${spec.ruleIndex}` as ValidationRuleKey,
    category: "manager",
    suite: ProjectInfoSuite.defaultInDevelopment,
    baseFiles: spec.baseFiles,
    prepare: pinHarnessModuleDescriptors,
    accepting: {
      id: `harness-scriptmodule-${spec.slug}-accept`,
      description: spec.acceptingDescription,
      files: spec.acceptingFiles,
    },
    rejecting: {
      id: `harness-scriptmodule-${spec.slug}-reject`,
      description: spec.rejectingDescription,
      files: spec.rejectingFiles,
    },
    rejectingExpectation: spec.expectation,
  });

export const ScriptModuleRulePairs: readonly ValidationRuleCoveragePair[] = [
  scriptModulePair({
    ruleIndex: 110,
    slug: "package-json-registration",
    baseFiles: { [BpManifestPath]: bpManifestWithModule(StableModule, StableLatestVersion) },
    acceptingDescription:
      "package.json registers the module the behavior pack depends on; SCRIPTMODULE:110 must stay quiet.",
    acceptingFiles: { [PackageJsonPath]: packageJson({ [StableModule]: StableLatestVersion }) },
    rejectingDescription:
      "package.json exists but does not register the module the behavior pack depends on; SCRIPTMODULE:110 must flag it.",
    rejectingFiles: { [PackageJsonPath]: packageJson({}) },
    expectation: {
      severity: InfoItemType.error,
      count: 1,
      message: "Could not find an package.json registration",
      data: StableModule,
    },
  }),
  scriptModulePair({
    ruleIndex: 111,
    slug: "npm-registration",
    baseFiles: {
      [PackageJsonPath]: packageJson({
        [StableModule]: StableLatestVersion,
        [UnregisteredModule]: "1.0.0",
      }),
    },
    acceptingDescription:
      "Behavior pack depends on a module with a registry descriptor; SCRIPTMODULE:111 must stay quiet.",
    acceptingFiles: { [BpManifestPath]: bpManifestWithModule(StableModule, StableLatestVersion) },
    rejectingDescription:
      "Behavior pack depends on a module with no registry descriptor; SCRIPTMODULE:111 must flag it.",
    rejectingFiles: { [BpManifestPath]: bpManifestWithModule(UnregisteredModule, "1.0.0") },
    expectation: {
      severity: InfoItemType.error,
      count: 1,
      message: "Could not find an NPMJS.org NPM module registration",
      data: UnregisteredModule,
    },
  }),
  scriptModulePair({
    ruleIndex: 114,
    slug: "beta-version",
    baseFiles: { [PackageJsonPath]: packageJson({ [BetaModule]: `${BetaCurrentVersion}-beta` }) },
    acceptingDescription:
      "Behavior pack beta dependency matches the module's current beta version; SCRIPTMODULE:114 must stay quiet.",
    acceptingFiles: { [BpManifestPath]: bpManifestWithModule(BetaModule, `${BetaCurrentVersion}-beta`) },
    rejectingDescription:
      "Behavior pack beta dependency is behind the module's current beta version; SCRIPTMODULE:114 must flag it.",
    rejectingFiles: { [BpManifestPath]: bpManifestWithModule(BetaModule, `${BetaOutdatedVersion}-beta`) },
    expectation: {
      severity: InfoItemType.error,
      count: 1,
      projectPath: /manifest\.json$/,
      message: "using an out of date beta version",
      data: `${BetaOutdatedVersion}-beta`,
    },
  }),
];
