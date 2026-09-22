// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * VsCodeFileValidationTest — E2E coverage for the VS Code configuration
 * manager (VSCODEFILE) through the production pipeline
 * (ProjectInfoSet.generateForProject via the paired harness's
 * runValidationPipeline).
 *
 * VSCODEFILE emits only informational items — 100 (tasks.json without
 * Minecraft deploy tasks) and 101 (launch.json without a Minecraft server
 * debug configuration) — never a validation severity, so its catalog rule
 * inventory is empty (see VsCodeFileManager.validationRules) and these
 * conditions are covered here instead of in the paired rule tables. Each
 * condition gets an accepting fixture (well-configured file stays quiet), a
 * rejecting fixture (missing managed configuration is reported exactly
 * once), and a false-positive check proving user-authored unrelated
 * tasks/configurations neither trigger nor suppress the report.
 *
 * Runs as part of the default mocha test set over src/test.
 */

import { assert, expect } from "chai";
import { InfoItemType } from "../info/IInfoItemData";
import { ProjectInfoSuite } from "../info/IProjectInfoData";
import ProjectInfoItem from "../info/ProjectInfoItem";
import {
  ValidationFixtureRecipe,
  cleanUpFixtureOutput,
  runValidationPipeline,
} from "./ValidationRuleHarness";
import { minimalBpFiles } from "./validationRulePairs/PairFixtureBuilders";

const VsCodeTasksPath = ".vscode/tasks.json";
const VsCodeLaunchPath = ".vscode/launch.json";

const TestTimeout = 60000;

const ValidationSeverities: readonly InfoItemType[] = [
  InfoItemType.error,
  InfoItemType.warning,
  InfoItemType.recommendation,
];

function tasksJson(tasks: object[]): string {
  return JSON.stringify({ version: "2.0.0", tasks }, undefined, 2);
}

function launchJson(configurations: object[]): string {
  return JSON.stringify({ version: "0.3.0", configurations }, undefined, 2);
}

const minecraftBuildTasks: object[] = [
  { label: "build", dependsOn: ["minecraft: deploy"] },
  { label: "minecraft: deploy", type: "shell", command: "echo deploy" },
];

const userAuthoredTask = { label: "lint", type: "shell", command: "eslint ." };

const managedLaunchConfig = {
  type: "minecraft-js",
  request: "attach",
  name: "Debug with Minecraft",
  mode: "connect",
  host: "localhost",
  port: 19144,
};

const userAuthoredNodeConfig = { type: "node", request: "attach", name: "Attach to Node", port: 9229 };

const userAuthoredListenConfig = {
  type: "minecraft-js",
  request: "attach",
  name: "Listen for game connections",
  mode: "listen",
  port: 19145,
};

function recipe(id: string, kind: "accepting" | "rejecting", files: { [path: string]: string }) {
  const fixture: ValidationFixtureRecipe = {
    id,
    description: "VSCODEFILE informational condition fixture",
    kind,
    suite: ProjectInfoSuite.defaultInDevelopment,
    files: { ...minimalBpFiles(), ...files },
  };

  return fixture;
}

async function runFixture(fixture: ValidationFixtureRecipe): Promise<ProjectInfoItem[]> {
  try {
    const result = await runValidationPipeline(fixture);

    const internalErrors = result.items.filter((item) => item.itemType === InfoItemType.internalProcessingError);
    assert.deepEqual(
      internalErrors.map((item) => result.infoSet.itemToString(item)),
      [],
      "the pipeline run must not produce internal-processing errors"
    );

    return result.items.filter((item) => item.generatorId === "VSCODEFILE");
  } finally {
    cleanUpFixtureOutput(fixture.id);
  }
}

function infoItems(items: ProjectInfoItem[], generatorIndex: number): ProjectInfoItem[] {
  return items.filter((item) => item.itemType === InfoItemType.info && item.generatorIndex === generatorIndex);
}

function assertNoValidationSeverities(items: ProjectInfoItem[]) {
  const flagged = items.filter((item) => ValidationSeverities.includes(item.itemType));

  assert.deepEqual(
    flagged.map((item) => `${item.generatorId}:${item.generatorIndex} (${item.itemType})`),
    [],
    "VSCODEFILE must never emit error/warning/recommendation results (its rule inventory is empty)"
  );
}

describe("VsCodeFileManager E2E validation (VSCODEFILE)", function () {
  it("stays quiet on a tasks.json with Minecraft deploy tasks, alongside user-authored tasks", async function () {
    this.timeout(TestTimeout);

    const items = await runFixture(
      recipe("vscodefile-tasks-accept", "accepting", {
        [VsCodeTasksPath]: tasksJson([userAuthoredTask, ...minecraftBuildTasks]),
      })
    );

    expect(infoItems(items, 100)).to.have.lengthOf(0);
    assertNoValidationSeverities(items);
  });

  it("reports exactly one informational item for a tasks.json without Minecraft deploy tasks", async function () {
    this.timeout(TestTimeout);

    const items = await runFixture(
      recipe("vscodefile-tasks-reject", "rejecting", {
        [VsCodeTasksPath]: tasksJson([userAuthoredTask]),
      })
    );

    const reported = infoItems(items, 100);

    expect(reported).to.have.lengthOf(1);
    expect(reported[0].message).to.contain("no minecraft deploy tasks");
    expect(reported[0].projectItemPath).to.contain("tasks.json");
    assertNoValidationSeverities(items);
  });

  it("stays quiet on a launch.json with the managed Minecraft server debug configuration", async function () {
    this.timeout(TestTimeout);

    const items = await runFixture(
      recipe("vscodefile-launch-accept", "accepting", {
        [VsCodeLaunchPath]: launchJson([userAuthoredNodeConfig, managedLaunchConfig]),
      })
    );

    expect(infoItems(items, 101)).to.have.lengthOf(0);
    assertNoValidationSeverities(items);
  });

  it("reports exactly one informational item for a launch.json without a Minecraft server configuration", async function () {
    this.timeout(TestTimeout);

    const items = await runFixture(
      recipe("vscodefile-launch-reject", "rejecting", {
        [VsCodeLaunchPath]: launchJson([userAuthoredNodeConfig]),
      })
    );

    const reported = infoItems(items, 101);

    expect(reported).to.have.lengthOf(1);
    expect(reported[0].message).to.contain("not configured for Minecraft server launch");
    expect(reported[0].projectItemPath).to.contain("launch.json");
    assertNoValidationSeverities(items);
  });

  it("does not judge user-authored minecraft-js profiles when the managed configuration is present", async function () {
    this.timeout(TestTimeout);

    // A user-authored listen-mode game profile under its own name must be
    // ignored by managed-configuration detection: with the managed connect
    // profile also present, nothing is reported.
    const items = await runFixture(
      recipe("vscodefile-launch-user-profiles", "accepting", {
        [VsCodeLaunchPath]: launchJson([userAuthoredListenConfig, managedLaunchConfig]),
      })
    );

    expect(infoItems(items, 101)).to.have.lengthOf(0);
    assertNoValidationSeverities(items);
  });

  it("evaluates tasks and launch files independently in one project", async function () {
    this.timeout(TestTimeout);

    const items = await runFixture(
      recipe("vscodefile-mixed", "rejecting", {
        [VsCodeTasksPath]: tasksJson(minecraftBuildTasks),
        [VsCodeLaunchPath]: launchJson([userAuthoredNodeConfig]),
      })
    );

    expect(infoItems(items, 100)).to.have.lengthOf(0);
    expect(infoItems(items, 101)).to.have.lengthOf(1);
    assertNoValidationSeverities(items);
  });
});
