// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * DebuggerReliabilityEvidenceTest
 *
 * Live release-gate evidence generation for the managed-BDS script debugger
 * (Task 1669104, packaging the Task 1669105 release-gate flow).
 *
 * This harness drives the REAL debugger lifecycle - the same
 * ServerManager/DedicatedServer code path the Electron main process uses -
 * against a real, downloaded Bedrock Dedicated Server, and packages what
 * happened into a privacy-safe evidence bundle:
 *
 *   1. connect-success (x3)     repeated cold start -> connected -> stop
 *   2. reconnect-success        drop + reconnect against the live listener
 *   3. restart-success          in-place server restart -> fresh connect
 *   4. failure-settings         persisted allow-outbound-script-debugging=false
 *   5. failure-port-exhaustion  all 20 candidate debug ports externally held
 *   6. failure-listener-close   `script debugger close` mid-session; valid
 *                               outcomes: session unaffected - PROVEN by
 *                               BDS acknowledging the command ([Scripting]
 *                               Script Debugger closed) plus a full
 *                               observation window with no disconnect and
 *                               stat events still flowing (outbound has no
 *                               BDS-side listener) - or, after an observed
 *                               drop, auto-reconnect recovery or clean
 *                               exhaustion
 *
 * Packaging requires the EXACT scenario matrix (all eight captures, no
 * duplicates - see EXPECTED_TEST_CASE_IDS) before building or writing the
 * bundle: a scenario that fails before capturing fails the gate rather than
 * silently shrinking the bundle's denominator.
 *
 * Outputs (all under app/debugoutput/debugger-evidence/):
 *   raw/run-*.json              raw scratch captures (full diagnostics) -
 *                               DELETED automatically after bundling
 *   debugger-evidence-bundle.json  the privacy-validated bundle
 *
 * The output root is invalidated (removed) at the START of every
 * invocation, BEFORE the platform/EULA prerequisite checks - a skipped run
 * therefore leaves nothing at this path, and a bundle found here is
 * guaranteed to come from the invocation that most recently ran.
 *
 * PREREQUISITES: Windows, ~500MB disk, network for the one-time BDS
 * download, ports 19132+ free, and a persisted Minecraft EULA acceptance
 * (mct eula --accept). The suite skips (not fails) when unavailable.
 *
 * Run with: npm run test-debugger-evidence   (from app/)
 *
 * NOT run in CI - this spawns real BDS processes, like ServerWorkflowTest.
 */

import { assert } from "chai";
import { execSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createServer, Server } from "net";
import TestPaths, { ITestEnvironment } from "../test/TestPaths";
import ServerManager, { ServerManagerFeatures } from "../local/ServerManager";
import DedicatedServer, { DedicatedServerStatus } from "../local/DedicatedServer";
import ServerMessage, { ServerMessageCategory } from "../local/ServerMessage";
import DebugPortRegistry from "../debugger/DebugPortRegistry";
import {
  DebuggerFailureKind,
  DebuggerLifecycleStage,
  IDebuggerDiagnostics,
} from "../debugger/DebuggerLifecycle";
import {
  buildEvidenceBundle,
  buildEvidenceRun,
  findEvidenceCompletenessViolations,
  findEvidencePrivacyViolations,
  serializeEvidenceBundle,
  IDebuggerEvidenceRun,
  DebuggerEvidenceOutcome,
} from "../debugger/DebuggerEvidence";
import { constants } from "../core/Constants";

const EVIDENCE_ROOT = path.resolve(__dirname, "../../debugoutput/debugger-evidence");
const RAW_CAPTURE_DIR = path.join(EVIDENCE_ROOT, "raw");
const BUNDLE_PATH = path.join(EVIDENCE_ROOT, "debugger-evidence-bundle.json");

const SERVER_START_TIMEOUT_MS = 180000;
const STOP_TIMEOUT_MS = 45000;

/**
 * How long the session must remain connected after `script debugger close`
 * (zero disconnects, stat events still flowing) before "session unaffected"
 * counts as PROVEN. Without an observation window, the connected|failed
 * stage wait would resolve on the current (still connected) stage before
 * BDS even processed the command. The window alone still cannot tell
 * "processed and survived" from "never processed" - an ignored command
 * leaves the session producing stats too - so the sustained branch also
 * requires BDS's acknowledgement line ('[Scripting] Script Debugger
 * closed', ServerMessageCategory.debuggerClosing) among the output emitted
 * AFTER the command before the outcome counts.
 */
const LISTENER_CLOSE_OBSERVATION_MS = 30000;

/**
 * The full scenario matrix this suite is REQUIRED to capture - packaging
 * verifies the raw capture set against exactly these test-case ids. Mocha
 * keeps running after a scenario fails before its captureRun(), so anything
 * weaker (a count threshold) would let the bundle report a 100% pass rate
 * over a silently shrunk denominator. Keep this list in lockstep with the
 * scenarios below.
 */
const EXPECTED_TEST_CASE_IDS = [
  "connect-success-1",
  "connect-success-2",
  "connect-success-3",
  "reconnect-success",
  "restart-success",
  "failure-settings",
  "failure-port-exhaustion",
  "failure-listener-close",
];

interface IRawCapture {
  runId: string;
  testCaseId: string;
  outcome: DebuggerEvidenceOutcome;
  startedAt: string;
  endedAt: string;
  cleanup?: { stageAtEnd: DebuggerLifecycleStage; portReleased: boolean; clientDisconnected: boolean };
  diagnostics: IDebuggerDiagnostics;
}

let env: ITestEnvironment;
let sm: ServerManager;
let server: DedicatedServer | undefined;

const rawCaptures: IRawCapture[] = [];
let runCounter = 0;

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Wait for the lifecycle to reach a target stage (or any terminal failure).
 * Resolves with the stage that ended the wait.
 */
function waitForStage(
  srv: DedicatedServer,
  isDone: (stage: DebuggerLifecycleStage) => boolean,
  timeoutMs: number,
  label: string
): Promise<DebuggerLifecycleStage> {
  return new Promise((resolve, reject) => {
    const current = srv.getDebugDiagnostics().stage;

    if (isDone(current)) {
      resolve(current);
      return;
    }

    const timer = setTimeout(() => {
      unsub();
      reject(
        new Error(
          `Timed out after ${timeoutMs}ms waiting for ${label}; last stage was '${srv.getDebugDiagnostics().stage}'`
        )
      );
    }, timeoutMs);

    const unsub = srv.onDebugStageChanged.subscribe((_srv, data) => {
      if (isDone(data.stage)) {
        clearTimeout(timer);
        unsub();
        resolve(data.stage);
      }
    });
  });
}

/**
 * Wait for connected, treating failed as terminal too (so a broken flow
 * surfaces its failure immediately instead of burning the full timeout),
 * then assert the connected outcome.
 */
async function waitForConnected(srv: DedicatedServer, timeoutMs: number, label: string): Promise<void> {
  const endStage = await waitForStage(
    srv,
    (s) => s === DebuggerLifecycleStage.connected || s === DebuggerLifecycleStage.failed,
    timeoutMs,
    label
  );

  if (endStage !== DebuggerLifecycleStage.connected) {
    const d = srv.getDebugDiagnostics();
    assert.fail(`${label}: debugger failed (kind=${d.failureKind}): ${d.errorMessage ?? "no message"}`);
  }
}

/**
 * Poll until check() holds or the window elapses. Resolves true the moment
 * the condition is met, false when the FULL window passes without it -
 * which is itself an observation (e.g. "no disconnect happened").
 */
function pollFor(check: () => boolean, timeoutMs: number, intervalMs: number = 250): Promise<boolean> {
  return new Promise((resolve) => {
    const started = Date.now();

    const poll = () => {
      if (check()) {
        resolve(true);
      } else if (Date.now() - started > timeoutMs) {
        resolve(false);
      } else {
        setTimeout(poll, intervalMs);
      }
    };

    poll();
  });
}

function waitForStopped(srv: DedicatedServer, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();

    const poll = () => {
      if (srv.status === DedicatedServerStatus.stopped) {
        resolve();
      } else if (Date.now() - started > timeoutMs) {
        reject(new Error(`Server did not reach stopped status within ${timeoutMs}ms (status: ${srv.status})`));
      } else {
        setTimeout(poll, 500);
      }
    };

    poll();
  });
}

/**
 * Record one run's raw capture. The diagnostics snapshot must be taken
 * BEFORE stopServer(): entering the stopping stage clears failureKind, so a
 * post-stop snapshot would erase the failure evidence this exists to keep.
 */
function captureRun(
  diagnostics: IDebuggerDiagnostics,
  testCaseId: string,
  outcome: DebuggerEvidenceOutcome,
  startedAt: string,
  cleanup?: IRawCapture["cleanup"]
): IRawCapture {
  runCounter++;

  // Incomplete cleanup fails the run outcome: a scenario that passed its
  // arc but leaked its port reservation or its client connection is not
  // passing reliability evidence.
  if (cleanup !== undefined && (cleanup.portReleased !== true || cleanup.clientDisconnected !== true)) {
    if (outcome === "passed") {
      console.log(
        `      [evidence] ${testCaseId}: downgrading to failed - incomplete cleanup` +
          ` (portReleased=${cleanup.portReleased}, clientDisconnected=${cleanup.clientDisconnected})`
      );
    }

    outcome = "failed";
  }

  const capture: IRawCapture = {
    runId: `run-${String(runCounter).padStart(3, "0")}`,
    testCaseId: testCaseId,
    outcome: outcome,
    startedAt: startedAt,
    endedAt: nowIso(),
    cleanup: cleanup,
    diagnostics: diagnostics,
  };

  rawCaptures.push(capture);

  fs.mkdirSync(RAW_CAPTURE_DIR, { recursive: true });
  fs.writeFileSync(path.join(RAW_CAPTURE_DIR, `${capture.runId}.json`), JSON.stringify(capture, undefined, 2));

  console.log(
    `      [evidence] ${capture.runId} ${testCaseId}: ${outcome}` +
      ` (stage=${capture.diagnostics.stage}, failureKind=${capture.diagnostics.failureKind})`
  );

  return capture;
}

async function stopAndVerifyCleanup(srv: DedicatedServer): Promise<IRawCapture["cleanup"]> {
  const debugPort = srv.getDebugDiagnostics().debugPort;

  // Deliberate teardown clears the server's client reference BEFORE calling
  // client.disconnect() (so the disconnect handler recognizes the teardown
  // and does not schedule a reconnect) - which also means onDebugDisconnected
  // NEVER fires for a deliberate stop, so an event subscription cannot prove
  // client cleanup. Inspect actual state instead: capture the live client
  // (if any) and verify after the stop that the server dropped its reference
  // AND that specific client's socket is disconnected.
  const clientBeforeStop = srv.debugClient;

  await srv.stopServer();
  await waitForStopped(srv, STOP_TIMEOUT_MS);

  const stageAtEnd = srv.getDebugDiagnostics().stage;
  const portReleased = debugPort === undefined || DebugPortRegistry.reservedBy(debugPort) === undefined;

  // Vacuously clean when no client existed (failure scenarios never build
  // one); otherwise BOTH must hold - reference dropped and socket down.
  const clientDisconnected =
    clientBeforeStop === undefined || (srv.debugClient === undefined && !clientBeforeStop.isConnected);

  return {
    stageAtEnd: stageAtEnd,
    portReleased: portReleased,
    clientDisconnected: clientDisconnected,
  };
}

/**
 * Assert both cleanup flags. Every scenario calls this after its capture so
 * incomplete cleanup fails the TEST too, not just the run outcome.
 */
function assertCompleteCleanup(testCaseId: string, cleanup: IRawCapture["cleanup"]): void {
  assert.isDefined(cleanup, `${testCaseId}: cleanup evidence must exist`);
  assert.isTrue(cleanup!.portReleased, `${testCaseId}: debug port reservation should be released after stop`);
  assert.isTrue(cleanup!.clientDisconnected, `${testCaseId}: debug client should be disconnected after stop`);
}

/** Run one full cold cycle: start -> wait for connected (or failure) -> stop. */
async function runConnectCycle(testCaseId: string): Promise<void> {
  assert.isDefined(server, "server must be provisioned");
  const srv = server!;

  const startedAt = nowIso();
  const started = await srv.startServer(false, undefined);
  assert.isTrue(started, "BDS should start");

  const endStage = await waitForStage(
    srv,
    (s) => s === DebuggerLifecycleStage.connected || s === DebuggerLifecycleStage.failed,
    SERVER_START_TIMEOUT_MS,
    "debugger connected"
  );

  const outcome: DebuggerEvidenceOutcome = endStage === DebuggerLifecycleStage.connected ? "passed" : "failed";
  const diagnostics = srv.getDebugDiagnostics();
  const cleanup = await stopAndVerifyCleanup(srv);

  captureRun(diagnostics, testCaseId, outcome, startedAt, cleanup);

  assert.equal(endStage, DebuggerLifecycleStage.connected, `${testCaseId}: debugger should reach connected`);
  assertCompleteCleanup(testCaseId, cleanup);
}

const EVIDENCE_PACK_HEADER_UUID = "8f2b3c44-1111-4222-8333-9a8b7c6d5e4f";

/**
 * Write a minimal script behavior pack into the slot's development packs and
 * register it on the default world, so the script debugger has a script
 * engine to attach to. Idempotent.
 */
function provisionMinimalScriptPack(srv: DedicatedServer): void {
  const packDir = path.join(srv.serverPath, "development_behavior_packs", "mct_evidence_probe");

  fs.mkdirSync(path.join(packDir, "scripts"), { recursive: true });

  fs.writeFileSync(
    path.join(packDir, "manifest.json"),
    JSON.stringify(
      {
        format_version: 2,
        header: {
          name: "MCT Evidence Probe",
          description: "Minimal script pack so the script debugger has a debuggee",
          uuid: EVIDENCE_PACK_HEADER_UUID,
          version: [1, 0, 0],
          min_engine_version: [1, 20, 0],
        },
        modules: [
          {
            description: "Scripts",
            language: "javascript",
            type: "script",
            uuid: "7e1a2b33-2222-4333-8444-1b2c3d4e5f6a",
            version: [1, 0, 0],
            entry: "scripts/main.js",
          },
        ],
        dependencies: [{ module_name: "@minecraft/server", version: "2.6.0" }],
      },
      undefined,
      2
    )
  );

  fs.writeFileSync(
    path.join(packDir, "scripts", "main.js"),
    'import { system } from "@minecraft/server";\nsystem.runInterval(() => {}, 20);\nconsole.warn("mct evidence probe pack loaded");\n'
  );

  const worldDir = path.join(srv.serverPath, "worlds", "defaultWorld");
  fs.mkdirSync(worldDir, { recursive: true });
  fs.writeFileSync(
    path.join(worldDir, "world_behavior_packs.json"),
    JSON.stringify([{ pack_id: EVIDENCE_PACK_HEADER_UUID, version: [1, 0, 0] }], undefined, 2)
  );
}

function readServerProperties(srv: DedicatedServer): string {
  return fs.readFileSync(path.join(srv.serverPath, "server.properties"), "utf8");
}

function writeServerProperties(srv: DedicatedServer, content: string): void {
  fs.writeFileSync(path.join(srv.serverPath, "server.properties"), content, "utf8");
}

describe("Debugger reliability evidence (live release gate)", function () {
  this.timeout(600000);

  before(async function () {
    this.timeout(600000);

    // Invalidate any previous run's evidence BEFORE the prerequisite/skip
    // branches: a skipped invocation must not leave stale output at the
    // documented path, where downstream publishing or manual inspection
    // could mistake it for current results. After this point, a bundle at
    // BUNDLE_PATH can only have been written by THIS invocation's
    // packaging step.
    fs.rmSync(EVIDENCE_ROOT, { recursive: true, force: true });

    if (os.platform() !== "win32") {
      console.log("Skipping: Windows is required to run BDS. Previous evidence output (if any) was cleared.");
      this.skip();
      return;
    }

    env = await TestPaths.createTestEnvironment({ isLocalNode: true });
    await env.localEnv.load();

    if (!env.localEnv.iAgreeToTheMinecraftEndUserLicenseAgreementAndPrivacyStatementAtMinecraftDotNetSlashEula) {
      if (process.env.MCTOOLS_I_ACCEPT_EULA_AT_MINECRAFTDOTNETSLASHEULA?.toLowerCase() === "true") {
        env.localEnv.iAgreeToTheMinecraftEndUserLicenseAgreementAndPrivacyStatementAtMinecraftDotNetSlashEula = true;
      } else {
        console.log(
          "Skipping: Minecraft EULA not accepted (run `mct eula --accept`). " +
            "Previous evidence output (if any) was cleared."
        );
        this.skip();
        return;
      }
    }

    fs.mkdirSync(RAW_CAPTURE_DIR, { recursive: true });

    sm = new ServerManager(env.localEnv, env.creatorTools);
    sm.features = ServerManagerFeatures.dedicatedServerOnly;

    console.log("      Provisioning BDS (downloads on first run; this can take a few minutes)...");
    server = await sm.ensureActiveServer(0, undefined);

    if (!server) {
      throw new Error("Could not provision a dedicated server instance.");
    }

    // The script debugger needs a debuggee: without at least one behavior
    // pack with a script module, BDS has no script engine and the debugger
    // session cannot be established. Provision a minimal pack.
    provisionMinimalScriptPack(server);

    console.log(`      BDS provisioned (slot 0, base port ${server.port ?? 19132}).`);
  });

  afterEach(async function () {
    this.timeout(120000);

    // A test that failed mid-flight (e.g. a stage-wait timeout) must not
    // leave BDS running and poison the next scenario's cold start.
    if (server && server.status !== DedicatedServerStatus.stopped) {
      try {
        await server.stopServer();
        await waitForStopped(server, STOP_TIMEOUT_MS);
      } catch (e) {
        console.log(`      afterEach stop failed: ${e}`);
      }
    }
  });

  after(async function () {
    this.timeout(120000);

    if (server && server.status !== DedicatedServerStatus.stopped) {
      try {
        await server.stopServer();
        await waitForStopped(server, STOP_TIMEOUT_MS);
      } catch (e) {
        console.log(`      Cleanup stop failed: ${e}`);
      }
    }

    if (sm) {
      await sm.shutdown("evidence gate complete");
    }
  });

  it("connect-success: repeated cold start -> connected -> clean stop (3 runs)", async function () {
    for (let i = 1; i <= 3; i++) {
      await runConnectCycle(`connect-success-${i}`);
    }
  });

  it("reconnect-success: drop and reconnect against the live listener", async function () {
    const srv = server!;
    const startedAt = nowIso();

    assert.isTrue(await srv.startServer(false, undefined));
    await waitForConnected(srv, SERVER_START_TIMEOUT_MS, "initial connect");

    // Drop the client and reconnect against the still-live BDS listener -
    // the same path the DebugStatsPanel Retry action takes.
    let reconnected = false;
    const unsub = srv.onDebugConnected.subscribe(() => {
      reconnected = true;
    });

    const retried = await srv.retryDebugConnection();
    assert.isTrue(retried, "retryDebugConnection should be accepted while started");

    await waitForConnected(srv, 60000, "reconnect");
    unsub();

    const outcome: DebuggerEvidenceOutcome = reconnected ? "passed" : "failed";
    const diagnostics = srv.getDebugDiagnostics();
    const cleanup = await stopAndVerifyCleanup(srv);

    captureRun(diagnostics, "reconnect-success", outcome, startedAt, cleanup);

    assert.isTrue(reconnected, "the debug client should have reconnected");
    assertCompleteCleanup("reconnect-success", cleanup);
  });

  it("restart-success: in-place restart produces a fresh connected session", async function () {
    const srv = server!;

    assert.isTrue(await srv.startServer(false, undefined));
    await waitForConnected(srv, SERVER_START_TIMEOUT_MS, "initial connect");

    // Put clock distance between the pre-restart 'connected' transition and
    // this run's start, so the >= history trim cannot include it when both
    // land on the same millisecond (which would fake a ~0ms reconnect).
    await new Promise((resolve) => setTimeout(resolve, 25));

    const restartedAt = nowIso();
    assert.isTrue(await srv.startServer(true, undefined), "restart should succeed");

    const endStage = await waitForStage(
      srv,
      (s) => s === DebuggerLifecycleStage.connected || s === DebuggerLifecycleStage.failed,
      SERVER_START_TIMEOUT_MS,
      "reconnect after restart"
    );

    const diagnostics = srv.getDebugDiagnostics();
    const cleanup = await stopAndVerifyCleanup(srv);
    captureRun(
      diagnostics,
      "restart-success",
      endStage === DebuggerLifecycleStage.connected ? "passed" : "failed",
      restartedAt,
      cleanup
    );

    assert.equal(endStage, DebuggerLifecycleStage.connected, "restart should end connected");
    assertCompleteCleanup("restart-success", cleanup);
  });

  it("failure-settings: persisted allow-outbound-script-debugging=false fails fast with the settings kind", async function () {
    const srv = server!;
    const original = readServerProperties(srv);

    try {
      writeServerProperties(
        srv,
        original.replace(/^allow-outbound-script-debugging=.*$/m, "allow-outbound-script-debugging=false")
      );

      const startedAt = nowIso();
      assert.isTrue(await srv.startServer(false, undefined));

      const endStage = await waitForStage(
        srv,
        (s) => s === DebuggerLifecycleStage.failed || s === DebuggerLifecycleStage.connected,
        SERVER_START_TIMEOUT_MS,
        "settings failure"
      );

      const diagnostics = srv.getDebugDiagnostics();
      const behavedAsExpected =
        endStage === DebuggerLifecycleStage.failed && diagnostics.failureKind === DebuggerFailureKind.settings;

      const cleanup = await stopAndVerifyCleanup(srv);
      captureRun(diagnostics, "failure-settings", behavedAsExpected ? "passed" : "failed", startedAt, cleanup);

      assert.isTrue(behavedAsExpected, `expected settings failure, got stage=${endStage} kind=${diagnostics.failureKind}`);
      assertCompleteCleanup("failure-settings", cleanup);
    } finally {
      writeServerProperties(srv, original);
    }
  });

  it("failure-port-exhaustion: all candidate debug ports externally held", async function () {
    const srv = server!;
    const basePort = (srv.port ?? 19132) + 12;
    const holders: Server[] = [];

    try {
      for (let i = 0; i < 20; i++) {
        const holder = createServer();
        await new Promise<void>((resolve, reject) => {
          holder.once("error", reject);
          holder.listen(basePort + i, "127.0.0.1", () => resolve());
        });
        holders.push(holder);
      }

      const startedAt = nowIso();
      assert.isTrue(await srv.startServer(false, undefined));

      const endStage = await waitForStage(
        srv,
        (s) => s === DebuggerLifecycleStage.failed || s === DebuggerLifecycleStage.connected,
        SERVER_START_TIMEOUT_MS,
        "port exhaustion failure"
      );

      const diagnostics = srv.getDebugDiagnostics();
      const behavedAsExpected =
        endStage === DebuggerLifecycleStage.failed && diagnostics.failureKind === DebuggerFailureKind.portOccupied;

      const cleanup = await stopAndVerifyCleanup(srv);
      captureRun(diagnostics, "failure-port-exhaustion", behavedAsExpected ? "passed" : "failed", startedAt, cleanup);

      assert.isTrue(
        behavedAsExpected,
        `expected portOccupied failure, got stage=${endStage} kind=${diagnostics.failureKind}`
      );
      assertCompleteCleanup("failure-port-exhaustion", cleanup);
    } finally {
      for (const holder of holders) {
        holder.close();
      }
    }
  });

  it("failure-listener-close: `script debugger close` drops-and-recovers, exhausts, or provably stays connected", async function () {
    this.timeout(300000);

    const srv = server!;
    const startedAt = nowIso();

    assert.isTrue(await srv.startServer(false, undefined));
    await waitForConnected(srv, SERVER_START_TIMEOUT_MS, "initial connect");

    // The lifecycle is ALREADY connected here, and waitForStage() accepts
    // the current stage - so waiting for connected|failed right after the
    // command would resolve before BDS even processes it, letting a no-op
    // close "pass" without proving anything. Instead, subscribe for the
    // drop BEFORE issuing the command and require an observable
    // post-command outcome (see below).
    let disconnects = 0;
    let postCloseStatEvents = 0;

    const unsubDisconnect = srv.onDebugDisconnected.subscribe(() => {
      disconnects++;
    });
    const unsubStats = srv.onDebugStats.subscribe(() => {
      postCloseStatEvents++;
    });

    // Watermark the server output BEFORE the command: the sustained branch
    // must find BDS's acknowledgement among the lines that FOLLOW it.
    const preCloseOutputLength = srv.outputLines.length;

    const sawCloseAck = () =>
      srv.outputLines
        .slice(preCloseOutputLength)
        .some((line) => new ServerMessage(line.message).category === ServerMessageCategory.debuggerClosing);

    await srv.runCommand("script debugger close");

    // Outbound direction: `script debugger close` tears down BDS-side
    // debugger LISTENERS; an established outbound session has none, so the
    // valid outcomes are (a) BDS acknowledges the command AND the session
    // survives the ENTIRE observation window - proven by zero disconnects,
    // a still-connected stage, and stat events still flowing after the
    // command (a dead socket would deliver none; a missing acknowledgement
    // means the command was never processed and proves nothing) - or (b)
    // BDS drops it, and the auto-reconnect loop either recovers (re-issue
    // of the outbound connect) or exhausts cleanly (5 attempts,
    // exponential backoff). A hang is the only failure.
    const dropped = await pollFor(() => disconnects > 0, LISTENER_CLOSE_OBSERVATION_MS);

    let behavedAsExpected: boolean;
    let observed: string;

    if (!dropped) {
      // (a) Sustained connectivity across the full observation window. The
      // window alone cannot distinguish "BDS processed the close and the
      // outbound session survived" from "the command was never processed" -
      // an ignored command leaves the session producing stats too. Require
      // BDS's acknowledgement ('[Scripting] Script Debugger closed') among
      // the post-command output; the disconnect poll already gave it the
      // full window to appear.
      const stage = srv.getDebugDiagnostics().stage;
      const acknowledged = sawCloseAck();
      behavedAsExpected =
        stage === DebuggerLifecycleStage.connected && postCloseStatEvents > 0 && acknowledged;
      observed =
        `no disconnect within the ${LISTENER_CLOSE_OBSERVATION_MS}ms observation window ` +
        `(stage=${stage}, post-close stat events=${postCloseStatEvents}, ` +
        `close acknowledged by BDS=${acknowledged})`;
    } else {
      // (b) The drop was OBSERVED, so the stage left connected and the
      // connected|failed wait is now meaningful: connected again is a real
      // reconnect recovery, failed after reconnecting attempts is a real
      // clean exhaustion.
      const endStage = await waitForStage(
        srv,
        (s) => s === DebuggerLifecycleStage.failed || s === DebuggerLifecycleStage.connected,
        240000,
        "reconnect recovery or exhaustion after the observed disconnect"
      );

      const sawReconnects = srv
        .getDebugDiagnostics()
        .stageHistory.some((t) => t.stage === DebuggerLifecycleStage.reconnecting);

      behavedAsExpected =
        endStage === DebuggerLifecycleStage.connected ||
        (endStage === DebuggerLifecycleStage.failed && sawReconnects);
      observed = `disconnect observed, endStage=${endStage}, sawReconnects=${sawReconnects}`;
    }

    unsubDisconnect();
    unsubStats();

    const diagnostics = srv.getDebugDiagnostics();
    const cleanup = await stopAndVerifyCleanup(srv);
    captureRun(diagnostics, "failure-listener-close", behavedAsExpected ? "passed" : "failed", startedAt, cleanup);

    assert.isTrue(behavedAsExpected, `listener-close did not prove a valid outcome: ${observed}`);
    assertCompleteCleanup("failure-listener-close", cleanup);
  });

  it("packages the evidence bundle, proves privacy, and cleans raw captures", function () {
    // The bundle's denominator is the full scenario matrix, never "whatever
    // survived": a scenario that failed before its captureRun() must fail
    // the bundle here, not shrink it. Missing, duplicated, and unexpected
    // test-case ids all block packaging before anything is built or written.
    assert.deepEqual(
      findEvidenceCompletenessViolations(rawCaptures, EXPECTED_TEST_CASE_IDS),
      [],
      "the evidence set must cover the exact scenario matrix (a scenario likely failed before captureRun)"
    );

    const runs: IDebuggerEvidenceRun[] = rawCaptures.map((capture) => {
      const runStartMs = Date.parse(capture.startedAt);

      // Trim stage history to this run's window: cycles share one server
      // instance, and per-run timings must not include earlier cycles. No
      // grace margin - startedAt is always taken before the first transition
      // of its run, and any slop would pull in the previous session's
      // 'connected' transition on restart runs, faking a near-zero
      // time-to-connected.
      const trimmed: IDebuggerDiagnostics = {
        ...capture.diagnostics,
        stageHistory: capture.diagnostics.stageHistory.filter((t) => Date.parse(t.at) >= runStartMs),
      };

      return buildEvidenceRun(trimmed, {
        runId: capture.runId,
        testCaseId: capture.testCaseId,
        outcome: capture.outcome,
        startedAt: capture.startedAt,
        endedAt: capture.endedAt,
        host: "127.0.0.1",
        // Current flow: MCT listens on loopback and BDS establishes the
        // outbound debugger connection (`script debugger connect`).
        direction: "bdsConnectsToMct",
        cleanup: capture.cleanup,
      });
    });

    let commit: string | undefined;

    try {
      commit = execSync("git rev-parse HEAD", { cwd: __dirname, encoding: "utf8" }).trim();
    } catch {
      commit = undefined;
    }

    const bundle = buildEvidenceBundle(runs, {
      mctVersion: constants.version,
      commit: commit,
      hostKind: "testHarness",
      platform: os.platform(),
      nodeVersion: process.version,
    });

    // Privacy gate: the bundle must be provably free of prohibited content.
    const violations = findEvidencePrivacyViolations(bundle);
    assert.deepEqual(violations, [], "the evidence bundle must have no privacy violations");

    const serialized = serializeEvidenceBundle(bundle);

    // Belt-and-suspenders: raw capture text that must never reach the bundle.
    assert.notInclude(serialized, "recentServerMessages");
    assert.notInclude(serialized, "targetModuleUuid");
    assert.notInclude(serialized, os.homedir().replace(/\\/g, "\\\\"));

    // Publication invariant: before() cleared EVIDENCE_ROOT ahead of every
    // prerequisite/skip branch, so nothing may already exist at the bundle
    // path - a pre-existing file would mean stale output survived into this
    // invocation and could be mistaken for its results.
    assert.isFalse(
      fs.existsSync(BUNDLE_PATH),
      "a bundle must not pre-exist this invocation's packaging step - stale evidence survived the pre-run invalidation"
    );

    fs.writeFileSync(BUNDLE_PATH, serialized);
    console.log(`      [evidence] Bundle written to ${BUNDLE_PATH}`);
    console.log(
      `      [evidence] Summary: ${bundle.summary.passed}/${bundle.summary.totalRuns} passed` +
        (bundle.summary.timeToConnected
          ? `, time-to-connected median ${bundle.summary.timeToConnected.medianMs}ms`
          : "")
    );

    // Raw scratch captures are cleaned once the bundle exists.
    fs.rmSync(RAW_CAPTURE_DIR, { recursive: true, force: true });
    assert.isFalse(fs.existsSync(RAW_CAPTURE_DIR), "raw captures must be deleted after bundling");
  });
});
