/**
 * CommandLineTest - Validation CLI integration tests
 *
 * Tests the validate command with various content types and error scenarios.
 */

import { assert } from "chai";
import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
// Side-effect import: ensures module initialization order for ts-node.
// Without this, the GitHubFile → FileBase class hierarchy may not resolve
// before TestUtilities triggers a transitive import of it.
import "../app/Project";
import { removeResultFolder, collectLines } from "./CommandLineTestHelpers";

function readFilesRecursively(folderPath: string): string[] {
  const fileContents: string[] = [];

  for (const entry of fs.readdirSync(folderPath, { withFileTypes: true })) {
    const entryPath = folderPath + "/" + entry.name;
    if (entry.isDirectory()) {
      fileContents.push(...readFilesRecursively(entryPath));
    } else if (entry.isFile()) {
      fileContents.push(fs.readFileSync(entryPath, "utf8"));
    }
  }

  return fileContents;
}

describe("validate CLI end-to-end", () => {
  it("should execute validate command and generate output files", async function () {
    this.timeout(30000);

    let exitCode: number | null = null;
    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];

    removeResultFolder("validateCLIEndToEnd");

    const process = spawn("node", [
      "./toolbuild/jsn/cli/index.mjs",
      "validate",
      "addon",
      "--warn-only",
      "-i",
      "./../samplecontent/addon/build/content1",
      "-o",
      "./test/results/validateCLIEndToEnd/",
    ]);

    collectLines(process.stdout, stdoutLines);
    collectLines(process.stderr, stderrLines);

    await new Promise<void>((resolve) => {
      process.on("exit", (code) => {
        exitCode = code;
        resolve();
      });
    });

    // Verify CLI executed successfully
    assert.equal(exitCode, 0, "CLI should exit with code 0");

    // Verify output files were generated (basic smoke test)
    const outputDir = "./test/results/validateCLIEndToEnd/";
    assert(fs.existsSync(outputDir), "Output directory should exist");

    // Verify at least one output file was created
    const files = fs.readdirSync(outputDir);
    assert(files.length > 0, "Should generate at least one output file");
  });
});

describe("validate CLI VANPRO coverage", () => {
  it("should report protected vanilla behavior assets as errors in default validation", async function () {
    this.timeout(30000);

    let exitCode: number | null = null;
    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];

    removeResultFolder("validateVanproDefaultInput");
    removeResultFolder("validateVanproDefaultOutput");

    const inputDir = "./test/results/validateVanproDefaultInput/";
    const behaviorPackDir = inputDir + "behavior_packs/vanpro_bp/";
    const structureDir = behaviorPackDir + "structures/sulfur_spring/";
    fs.mkdirSync(structureDir, { recursive: true });
    fs.writeFileSync(
      behaviorPackDir + "manifest.json",
      JSON.stringify(
        {
          format_version: 2,
          header: {
            name: "VANPRO Test BP",
            description: "Test behavior pack for protected vanilla asset validation.",
            uuid: "11111111-1111-4111-8111-111111111111",
            version: [1, 0, 0],
            min_engine_version: [1, 20, 0],
          },
          modules: [
            {
              type: "data",
              uuid: "22222222-2222-4222-8222-222222222222",
              version: [1, 0, 0],
            },
          ],
        },
        undefined,
        2
      )
    );
    fs.writeFileSync(structureDir + "feature.mcstructure", "");

    const process = spawn("node", [
      "./toolbuild/jsn/cli/index.mjs",
      "validate",
      "--warn-only",
      "-i",
      inputDir,
      "-o",
      "./test/results/validateVanproDefaultOutput/",
    ]);

    collectLines(process.stdout, stdoutLines);
    collectLines(process.stderr, stderrLines);

    await new Promise<void>((resolve) => {
      process.on("exit", (code) => {
        exitCode = code;
        resolve();
      });
    });

    assert.equal(exitCode, 0, "CLI should exit with code 0. stderr: " + stderrLines.join("\n"));

    const outputDir = "./test/results/validateVanproDefaultOutput/";
    const reportJson = JSON.parse(fs.readFileSync(outputDir + "validatevanprodefaultinput.mcr.json", "utf8"));
    assert.equal(reportJson.info.vanillaProtectedAssetOverrides, 1);

    const reportText = readFilesRecursively(outputDir).join("\n");
    assert.include(reportText, "ERROR: [VANPRO101]", "Default validation report should include the protected asset error.");
  });
});

describe("validateLinkErrors", async () => {
  let exitCode: number | null = null;
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];

  before(function (done) {
    this.timeout(30000);

    removeResultFolder("validateLinkErrors");

    const process = spawn("node", [
      "./toolbuild/jsn/cli/index.mjs",
      "validate",
      "all",
      "--warn-only",
      "-i",
      "./../samplecontent/addon/build/content_linkerrors",
      "-o",
      "./test/results/validateLinkErrors/",
    ]);

    collectLines(process.stdout, stdoutLines);
    collectLines(process.stderr, stderrLines);

    process.on("exit", (code) => {
      exitCode = code;
      done();
    });
  });

  it("exit code should be zero", async () => {
    assert.equal(exitCode, 0);
  });
});

describe("validateTexturefulvv", async () => {
  let exitCode: number | null = null;
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];

  before(function (done) {
    this.timeout(30000);

    removeResultFolder("validateTexturefulvv");

    const process = spawn("node", [
      "./toolbuild/jsn/cli/index.mjs",
      "validate",
      "all",
      "--warn-only",
      "-i",
      "./../samplecontent/addon/build/content_texturefulvv",
      "-o",
      "./test/results/validateTexturefulvv/",
    ]);

    collectLines(process.stdout, stdoutLines);
    collectLines(process.stderr, stderrLines);

    process.on("exit", (code) => {
      exitCode = code;
      done();
    });
  });

  it("exit code should be zero", async () => {
    assert(exitCode !== null, "Process should have exited");
    assert(exitCode !== undefined, "Exit code should be defined");
    assert.equal(exitCode, 0);
  });
});

interface ICliRunResult {
  exitCode: number | null;
  stdoutLines: string[];
  stderrLines: string[];
}

const cliScriptPath = path.resolve("./toolbuild/jsn/cli/index.mjs");

async function runCli(args: string[], cwd?: string): Promise<ICliRunResult> {
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];

  const proc = spawn("node", [cliScriptPath, ...args], cwd ? { cwd } : undefined);

  collectLines(proc.stdout, stdoutLines);
  collectLines(proc.stderr, stderrLines);

  const exitCode = await new Promise<number | null>((resolve) => {
    proc.on("exit", (code) => resolve(code));
  });

  return { exitCode, stdoutLines, stderrLines };
}

function parseValidateJson(result: ICliRunResult) {
  const jsonLine = result.stdoutLines.find((line) => line.trim().startsWith("{"));
  assert(jsonLine, "Expected JSON on stdout. stderr: " + result.stderrLines.join("\n"));
  const parsed = JSON.parse(jsonLine!);
  assert.equal(parsed.command, "validate");
  return parsed;
}

function countVanproErrors(validateJson: any): number {
  let count = 0;

  for (const project of validateJson.projects) {
    for (const item of project.items) {
      if (item.type === "error" && item.generatorId === "VANPRO") {
        count++;
      }
    }
  }

  return count;
}

/**
 * Write a minimal project with one behavior pack. With `includeProtectedAsset`, the pack also
 * overrides a protected vanilla structure, which default validation reports as a VANPRO error.
 */
function writeReportReuseProject(projectDir: string, includeProtectedAsset: boolean) {
  const behaviorPackDir = path.join(projectDir, "behavior_packs", "reuse_bp");
  fs.mkdirSync(behaviorPackDir, { recursive: true });
  fs.writeFileSync(
    path.join(behaviorPackDir, "manifest.json"),
    JSON.stringify(
      {
        format_version: 2,
        header: {
          name: "Report Reuse Test BP",
          description: "Test behavior pack for validation report reuse.",
          uuid: "33333333-3333-4333-8333-333333333333",
          version: [1, 0, 0],
          min_engine_version: [1, 20, 0],
        },
        modules: [{ type: "data", uuid: "44444444-4444-4444-8444-444444444444", version: [1, 0, 0] }],
      },
      undefined,
      2
    )
  );

  if (includeProtectedAsset) {
    addProtectedAsset(projectDir);
  }
}

function addProtectedAsset(projectDir: string) {
  const structureDir = path.join(projectDir, "behavior_packs", "reuse_bp", "structures", "sulfur_spring");
  fs.mkdirSync(structureDir, { recursive: true });
  fs.writeFileSync(path.join(structureDir, "feature.mcstructure"), "");
}

function listFilesRecursively(folderPath: string): string[] {
  if (!fs.existsSync(folderPath)) {
    return [];
  }

  const files: string[] = [];

  for (const entry of fs.readdirSync(folderPath, { withFileTypes: true })) {
    const entryPath = path.join(folderPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFilesRecursively(entryPath));
    } else {
      files.push(entryPath);
    }
  }

  return files;
}

function resetScenarioFolder(scenarioName: string) {
  const scenarioDir = path.resolve("./test/results", scenarioName);
  fs.rmSync(scenarioDir, { recursive: true, force: true });
  return scenarioDir;
}

function isReportFile(filePath: string) {
  return filePath.endsWith(".csv") || filePath.endsWith(".report.html") || filePath.endsWith(".mcr.json");
}

describe("validate CLI --json report files", () => {
  it("should not write report files into the current folder when -o is not given", async function () {
    this.timeout(60000);

    const scenarioDir = resetScenarioFolder("validateJsonNoOutput");
    const projectDir = path.join(scenarioDir, "myproject");
    const cwdDir = path.join(scenarioDir, "cwd");

    writeReportReuseProject(projectDir, false);
    fs.mkdirSync(cwdDir, { recursive: true });

    const projectFilesBefore = listFilesRecursively(projectDir).sort();

    const result = await runCli(["validate", "--json", "--warn-only", "-i", projectDir], cwdDir);

    assert.equal(result.exitCode, 0, "stderr: " + result.stderrLines.join("\n"));
    parseValidateJson(result);

    assert.deepEqual(fs.readdirSync(cwdDir), [], "validate --json without -o should not create ./out");
    assert.deepEqual(
      listFilesRecursively(projectDir).sort(),
      projectFilesBefore,
      "validate --json should not write into the project"
    );
  });

  it("should not write report files with --ot noreports, even with -o", async function () {
    this.timeout(60000);

    const scenarioDir = resetScenarioFolder("validateJsonNoReports");
    const projectDir = path.join(scenarioDir, "myproject");
    const outputDir = path.join(scenarioDir, "out");

    writeReportReuseProject(projectDir, false);

    const result = await runCli([
      "validate",
      "--json",
      "--warn-only",
      "--ot",
      "noreports",
      "-i",
      projectDir,
      "-o",
      outputDir,
    ]);

    assert.equal(result.exitCode, 0, "stderr: " + result.stderrLines.join("\n"));
    parseValidateJson(result);

    const reportFiles = listFilesRecursively(outputDir).filter(isReportFile);
    assert.deepEqual(reportFiles, [], "--ot noreports should not write .csv, .report.html, or .mcr.json files");
  });
});

describe("validate CLI report reuse", () => {
  it("should re-validate after the project changes, and reuse the report only while it is unchanged", async function () {
    this.timeout(120000);

    const scenarioDir = resetScenarioFolder("validateReportReuse");
    const projectDir = path.join(scenarioDir, "myproject");
    const outputDir = path.join(scenarioDir, "out");
    const mcrJsonPath = path.join(outputDir, "myproject.mcr.json");
    const args = ["validate", "--json", "--warn-only", "-i", projectDir, "-o", outputDir];

    writeReportReuseProject(projectDir, false);

    const first = await runCli(args);
    assert.equal(first.exitCode, 0, "stderr: " + first.stderrLines.join("\n"));
    assert.equal(countVanproErrors(parseValidateJson(first)), 0, "clean project should have no VANPRO errors");
    assert(fs.existsSync(mcrJsonPath), "validate -o should write " + mcrJsonPath);

    addProtectedAsset(projectDir);

    const second = await runCli(args);
    assert.equal(second.exitCode, 0, "stderr: " + second.stderrLines.join("\n"));
    assert.isAbove(
      countVanproErrors(parseValidateJson(second)),
      0,
      "results after adding a protected asset should not come from the stale report"
    );
    assert.equal(JSON.parse(fs.readFileSync(mcrJsonPath, "utf8")).info.vanillaProtectedAssetOverrides, 1);

    const reportTimeAfterSecond = fs.statSync(mcrJsonPath).mtimeMs;

    const third = await runCli(args);
    assert.equal(third.exitCode, 0, "stderr: " + third.stderrLines.join("\n"));
    assert.isAbove(countVanproErrors(parseValidateJson(third)), 0, "reused report should keep the VANPRO error");
    assert.equal(
      fs.statSync(mcrJsonPath).mtimeMs,
      reportTimeAfterSecond,
      "an unchanged project should reuse its existing report"
    );

    const forced = await runCli([...args, "--force"]);
    assert.equal(forced.exitCode, 0, "stderr: " + forced.stderrLines.join("\n"));
    assert.notEqual(fs.statSync(mcrJsonPath).mtimeMs, reportTimeAfterSecond, "--force should always re-validate");
  });

  it("should not reuse a report from another project with the same folder name", async function () {
    this.timeout(120000);

    const scenarioDir = resetScenarioFolder("validateReportReuseSameName");
    const cleanProjectDir = path.join(scenarioDir, "a", "myproject");
    const brokenProjectDir = path.join(scenarioDir, "b", "myproject");
    const outputDir = path.join(scenarioDir, "out");

    // Create the project with errors first, so its files are older than the clean project's report and
    // a timestamp-only check would wrongly treat that report as current.
    writeReportReuseProject(brokenProjectDir, true);
    writeReportReuseProject(cleanProjectDir, false);

    const clean = await runCli(["validate", "--json", "--warn-only", "-i", cleanProjectDir, "-o", outputDir]);
    assert.equal(clean.exitCode, 0, "stderr: " + clean.stderrLines.join("\n"));
    assert.equal(countVanproErrors(parseValidateJson(clean)), 0);

    const broken = await runCli(["validate", "--json", "--warn-only", "-i", brokenProjectDir, "-o", outputDir]);
    assert.equal(broken.exitCode, 0, "stderr: " + broken.stderrLines.join("\n"));
    assert.isAbove(
      countVanproErrors(parseValidateJson(broken)),
      0,
      "a project with the same folder name should not reuse another project's report"
    );
  });
});
