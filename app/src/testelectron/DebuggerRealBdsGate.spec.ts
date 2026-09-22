/**
 * DebuggerRealBdsGate.spec.ts — the real-BDS Electron script-debugger release gate
 *
 * WHAT THIS IS
 * ============
 * Release-gate E2E for the managed-BDS script debugger driven through the REAL
 * Electron app (Task 1669105). It launches the production Electron bundle,
 * drives the actual preload IPC bridge (`window.api`), starts a REAL
 * downloaded Bedrock Dedicated Server, and asserts the debugger path from the
 * preload bridge outward across the wire:
 *
 *   settings -> dynamic port reservation -> BDS ready -> debugger transport
 *   armed -> TCP session established -> protocol negotiation (v10-capable
 *   client) -> passcode/target-module selection -> resume -> connected
 *   diagnostics streaming
 *
 * plus disconnect/reconnect, graceful shutdown, restart, fault injection,
 * leak detection, and Copy Diagnostic Details privacy checks.
 *
 * COVERAGE BOUNDARY (what this gate does and does not prove)
 * ==========================================================
 * This gate covers the preload bridge, the Electron main process
 * (DedicatedServerCommandHandler/DedicatedServer), and real BDS across the
 * wire. It drives `window.api` directly and records replies in a test-owned
 * event array, so the renderer PRODUCTION stack above the bridge is NOT
 * exercised here: a server started via raw IPC is invisible to the
 * renderer's CreatorTools state, so the real DebugStatsPanel cannot display
 * this gate's sessions. That renderer stack is covered elsewhere:
 *
 * - AppServiceProxy async command formatting + positional completion
 *   matching, and the appsvc wire-string dispatch through CreatorTools into
 *   ProcessHostedProxyMinecraft's typed debug events (the exact wire shapes
 *   this gate records): ProcessHostedProxyMinecraftTest.ts
 * - Preload whitelist <-> main-process handler pairing for every debug
 *   channel: DebugAdapterTest.ts (Electron debug IPC preload boundary) and
 *   the bridge test below
 * - DebugStatsPanel subscription/DOM rendering (connected schema tabs,
 *   stats streaming, disconnect states): the ServerUI Playwright suite
 *   (src/testweb/ServerUI.spec.ts) over the production WebSocket source
 *
 * Not covered anywhere today: DebugStatsPanel rendering fed specifically by
 * the ProcessHostedProxyMinecraft (Electron IPC) data source in a live app;
 * that requires a UI-driven server start (project open -> Minecraft display
 * -> start) and is tracked as follow-on work rather than claimed here.
 *
 * STRICTNESS CONTRACT (the release-gate property)
 * ===============================================
 * NO branch in this file converts a timeout, a missing IPC bridge, or a
 * skipped core behavior into success. Every wait helper throws on deadline;
 * every completion is demanded; the happy-path tests demand `connected` and
 * the fault tests demand the SPECIFIC failure kind. If the required path did
 * not execute, this suite fails.
 *
 * A mock debugger server is explicitly out of scope (non-goal): every
 * across-the-wire assertion runs against real BDS. Failure kinds that real
 * BDS cannot be driven to produce on demand (unsupported protocol, wrong
 * passcode, invalid module UUID, bad source-map roots) are validated at the
 * classification/recovery-mapping boundary — the exact modules the Electron
 * main process and DebugStatsPanel execute (see the failure-matrix test).
 *
 * GATING AND PREREQUISITES
 * ========================
 * This suite spawns real BDS processes and downloads BDS on first run, so it
 * is opt-in: it runs only when MCT_BDS_DEBUGGER_GATE=true (use
 * `npm run test-electron-debugger-gate`). When the gate flag is NOT set the
 * suite is skipped (visible as skipped, never as passed). When the gate flag
 * IS set, missing prerequisites are FAILURES, not skips.
 *
 * Local prerequisites:
 *   - Windows (BDS Windows binary required)
 *   - npm run webbuild && npm run jsncorebuild   (or test-electron-debugger-gate-full)
 *   - Network access for the one-time BDS download (~500MB disk)
 *   - Ports 19132+ (server) and 19144-19163 (debug window) free
 *   - The Minecraft EULA is accepted per-run via the start message
 *     (iagree: true), exactly as the Electron UI does; no machine state needed.
 *
 * CI: run in a gated, Windows, network-enabled job (schedule/label), NOT in
 * the default PR loop. Repeated runs are isolated: each run gets a unique
 * MCTOOLS_DATA_DIR/user-data-dir slug, and the debug port is dynamically
 * reserved by the app under test.
 *
 * ISOLATION / CLEANUP
 * ===================
 * All state lives under a unique per-run temp slug. afterAll verifies the
 * storage can actually be deleted (a locked file means a leaked handle or
 * process — that FAILS the run) and that no bedrock_server process from this
 * run survives.
 *
 * The fixed-name output directory (debugoutput/debugger-gate) is
 * invalidated (removed) at the START of every gated invocation, before the
 * prerequisite checks and before Electron launches — an artifact found
 * there is therefore guaranteed to come from the most recent gated run,
 * never left over from a previous invocation that a failing run did not
 * overwrite.
 *
 * RELATED FILES
 * =============
 * - src/electron/preload.ts                       the bridge under test
 * - src/electron/DedicatedServerCommandHandler.ts IPC handler under test
 * - src/local/DedicatedServer.ts                  lifecycle driver under test
 * - src/debugger/DebuggerLifecycle.ts             stage machine + recovery map
 * - src/test-extra/DebuggerReliabilityEvidenceTest.ts  node-side evidence twin
 * - docs/DebuggerElectronE2EGate.md               repro record + runbook
 *
 * Run with: npm run test-electron-debugger-gate   (from app/)
 */

import { test, expect, _electron as electron, ElectronApplication, Page } from "@playwright/test";
import { execFileSync } from "child_process";
import * as net from "net";
import path from "path";
import fs from "fs";
import os from "os";
import { takeScreenshot } from "../testshared/TestUtilities";
import {
  DebuggerFailureKind,
  DebuggerLifecycleStage,
  DebuggerRecoveryAction,
  classifyDebugClientDisconnectReason,
  classifyDebuggerListenFailure,
  getRecoveryActionsForFailure,
  sanitizeDebuggerDiagnosticText,
} from "../debugger/DebuggerLifecycle";

const GATE_ENABLED = process.env.MCT_BDS_DEBUGGER_GATE === "true";

const appDir = process.cwd();
const electronMainPath = path.join(appDir, "toolbuild/jsn/electron/main.mjs");

// Unique per-run slug: storage and userdata isolation, and the marker used to
// recognize THIS run's bedrock_server processes in leak checks.
const testSlug = `mct-dbggate-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const testStorageDir = path.join(os.tmpdir(), testSlug);
const testUserDataDir = path.join(os.tmpdir(), `${testSlug}-userdata`);

// Derived paths inside the app-under-test's storage (LocalUtilities with
// MCTOOLS_DATA_DIR set): server/servers/slot0 is the provisioned BDS slot.
const slotPath = path.join(testStorageDir, "server", "servers", "slot0");
const serverPropertiesPath = path.join(slotPath, "server.properties");

const SERVER_BASE_PORT = 19132;
const PREFERRED_DEBUG_PORT = SERVER_BASE_PORT + 12; // DebugPortRegistry preferred offset
const DEBUG_PORT_CANDIDATES = 20; // DebugPortRegistry probe window

const GATE_OUTPUT_DIR = path.join(appDir, "debugoutput", "debugger-gate");

// Generous end-to-end deadlines. First start includes the one-time BDS
// download; later cold starts are dominated by BDS boot (~12-30s observed).
const FIRST_START_TIMEOUT_MS = 15 * 60 * 1000;
const START_TIMEOUT_MS = 4 * 60 * 1000;
const CONNECT_TIMEOUT_MS = 3 * 60 * 1000;
const STOP_TIMEOUT_MS = 60 * 1000;
// tcpConnect exhaustion: 6 accept windows (15s) + backoff (2+4+8+16+32s) + slack
const FAILURE_EXHAUSTION_TIMEOUT_MS = 4 * 60 * 1000;
// Quiet window to detect stale timers still emitting after a stop (the listen
// delay is 3s; the first reconnect backoffs are 2s/4s).
const POST_STOP_QUIET_MS = 10 * 1000;

/** Start message mirroring what the Electron UI sends. Minimal on purpose so
 * the world layout matches the node-side evidence harness (worlds/defaultWorld). */
const START_STATE_JSON = JSON.stringify({ mode: 0, iagree: true });

interface IGateEvent {
  at: number;
  data: string;
}

interface IStageEventBody {
  eventName: string;
  stage: string;
  failureKind?: string;
  message?: string;
  detail?: string;
  debugPort?: number;
}

let electronApp: ElectronApplication;
let page: Page;

// Set by the page crash handler and ASSERTED in afterEach and afterAll: a
// renderer crash between requests (e.g., near teardown) would otherwise only
// print a console line and leave the gate green.
let rendererCrashReport: string | undefined;

// Request ids share the appsvc pipe with the app's own AppServiceProxy, whose
// completions are matched purely by numeric position. Start far above any
// position the app itself can plausibly reach in a gate run so a completion
// for a gate request can never resolve one of the app's pending requests.
let requestId = 900000;

/**
 * DedicatedServerCommandHandler uses irregular completion message names for
 * a few channels; everything else follows `${command}Complete`.
 */
const COMPLETION_NAME_OVERRIDES: { [command: string]: string } = {
  asyncstartDedicatedServer: "asyncdedicatedServerStartComplete",
  asyncstopDedicatedServer: "asyncdedicatedServerStopComplete",
  asyncdedicatedServerCommand: "asyncdedicatedServerComplete",
};

function completionName(command: string): string {
  return COMPLETION_NAME_OVERRIDES[command] ?? `${command}Complete`;
}

// ---------------------------------------------------------------------------
// Renderer IPC driving helpers (the REAL preload bridge; no fallbacks)
// ---------------------------------------------------------------------------

/**
 * Install the appsvc event recorder in the renderer. Throws when the preload
 * bridge is missing: a missing IPC bridge is a gate FAILURE, never a skip.
 */
async function installRecorder(): Promise<void> {
  await page.evaluate(() => {
    const w = window as any;

    if (!w.api || typeof w.api.send !== "function" || typeof w.api.receive !== "function") {
      throw new Error(
        "GATE FAILURE: the Electron preload bridge (window.api.send/receive) is not available in the renderer"
      );
    }

    if (!w.__gateEvents) {
      w.__gateEvents = [];
      w.api.receive("appsvc", (data: unknown) => {
        w.__gateEvents.push({ at: Date.now(), data: String(data) });
      });
    }
  });
}

/** Snapshot renderer events from a given index. */
async function eventsSince(index: number): Promise<IGateEvent[]> {
  return (await page.evaluate((i) => (window as any).__gateEvents.slice(i), index)) as IGateEvent[];
}

/**
 * Full renderer event log. STRICT: an unavailable snapshot (crashed or
 * closed renderer) is a gate failure, never an empty event log — afterEach's
 * privacy assertions must not be silently skipped because the page died.
 */
async function allEventsSnapshot(): Promise<IGateEvent[]> {
  try {
    return (await page.evaluate(() => (window as any).__gateEvents.slice())) as IGateEvent[];
  } catch (e) {
    throw new Error(`GATE FAILURE: could not snapshot the renderer event log (crashed/closed renderer?): ${e}`);
  }
}

/**
 * Best-effort variant for building CONTEXT inside an already-failing path
 * (the waitForEvent timeout message): losing the context must not mask the
 * original timeout error.
 */
async function allEventsSnapshotBestEffort(): Promise<IGateEvent[]> {
  try {
    return (await page.evaluate(() => (window as any).__gateEvents.slice())) as IGateEvent[];
  } catch {
    return [];
  }
}

async function eventCount(): Promise<number> {
  return (await page.evaluate(() => (window as any).__gateEvents.length)) as number;
}

/**
 * Send one command through the real preload bridge. Returns the numeric
 * request id used (preload parses the id with parseInt, so ids are numeric).
 */
async function sendCommand(command: string, data: string): Promise<number> {
  const id = ++requestId;

  await page.evaluate(
    ({ command, id, data }) => {
      // Throws for non-whitelisted channels — that propagates to the test.
      (window as any).api.send("appweb", `${command}|${id}`, data);
    },
    { command, id, data }
  );

  return id;
}

/**
 * Wait until an appsvc event satisfying `predicate` arrives at/after
 * fromIndex. THROWS on deadline (with recent-event context); there is no
 * timeout-to-success path anywhere in this suite.
 */
async function waitForEvent(
  predicate: (data: string) => boolean,
  fromIndex: number,
  timeoutMs: number,
  label: string
): Promise<{ data: string; index: number }> {
  const deadline = Date.now() + timeoutMs;
  let cursor = fromIndex;

  for (;;) {
    const events = await eventsSince(cursor);

    for (let i = 0; i < events.length; i++) {
      if (predicate(events[i].data)) {
        return { data: events[i].data, index: cursor + i };
      }
    }

    cursor += events.length;

    if (Date.now() > deadline) {
      // Sanitize BEFORE truncating: thrown errors land in Playwright's
      // stdout/report, and raw appsvc payloads relay path-bearing
      // main-process failures (the missing-executable start error carries
      // the absolute slot path). Truncating first could also split a path
      // and leave a fragment the sanitizer no longer recognizes.
      const recent = (await allEventsSnapshotBestEffort())
        .slice(-25)
        .map((e) => sanitizeDebuggerDiagnosticText(e.data).substring(0, 200))
        .join("\n  ");
      throw new Error(
        `GATE FAILURE: timed out after ${timeoutMs}ms waiting for ${label}.\nRecent events:\n  ${recent}`
      );
    }

    await page.waitForTimeout(250);
  }
}

/** Send a command and demand its completion payload. */
async function request(command: string, data: string, timeoutMs: number): Promise<string> {
  const fromIndex = await eventCount();
  const id = await sendCommand(command, data);
  const prefix = `${completionName(command)}|${id}|`;

  const result = await waitForEvent((d) => d.startsWith(prefix), fromIndex, timeoutMs, `${command} completion`);

  return result.data.substring(prefix.length);
}

function parseStageEvent(data: string): IStageEventBody | undefined {
  const prefix = "dedicatedServerDebugStage|";

  if (!data.startsWith(prefix)) {
    return undefined;
  }

  try {
    return JSON.parse(data.substring(prefix.length)) as IStageEventBody;
  } catch {
    return undefined;
  }
}

/**
 * Wait for a debugger lifecycle stage satisfying `isDone`. Throws on timeout.
 * When failIsTerminal is true (the default for happy paths), reaching
 * `failed` before `isDone` throws immediately with the failure details
 * instead of burning the whole deadline.
 */
async function waitForStage(
  isDone: (body: IStageEventBody) => boolean,
  fromIndex: number,
  timeoutMs: number,
  label: string,
  failIsTerminal: boolean = true
): Promise<{ body: IStageEventBody; index: number }> {
  const deadline = Date.now() + timeoutMs;
  let cursor = fromIndex;

  for (;;) {
    const events = await eventsSince(cursor);

    for (let i = 0; i < events.length; i++) {
      const body = parseStageEvent(events[i].data);

      if (!body) {
        continue;
      }

      if (isDone(body)) {
        return { body, index: cursor + i };
      }

      if (failIsTerminal && body.stage === DebuggerLifecycleStage.failed) {
        // Stage messages are sanitized by the main process already; sanitize
        // again anyway — this string lands in the runner report, and the
        // gate must not depend on upstream having done it.
        throw new Error(
          `GATE FAILURE: debugger flow failed while waiting for ${label}: kind=${body.failureKind} ` +
            `message=${sanitizeDebuggerDiagnosticText(body.message ?? "")}`
        );
      }
    }

    cursor += events.length;

    if (Date.now() > deadline) {
      throw new Error(`GATE FAILURE: timed out after ${timeoutMs}ms waiting for debugger stage: ${label}`);
    }

    await page.waitForTimeout(250);
  }
}

/** Collect every stage event name observed at/after fromIndex, in order. */
async function stagesObserved(fromIndex: number): Promise<IStageEventBody[]> {
  const events = await eventsSince(fromIndex);
  const stages: IStageEventBody[] = [];

  for (const e of events) {
    const body = parseStageEvent(e.data);
    if (body) {
      stages.push(body);
    }
  }

  return stages;
}

/** Assert `expected` appears as an ordered subsequence of the observed stages. */
function assertOrderedStageSubsequence(observed: IStageEventBody[], expected: string[], label: string): void {
  let cursor = 0;

  for (const stage of observed) {
    if (cursor < expected.length && stage.stage === expected[cursor]) {
      cursor++;
    }
  }

  expect(
    cursor,
    `${label}: expected ordered stage subsequence [${expected.join(" -> ")}] but observed [${observed
      .map((s) => s.stage)
      .join(", ")}]`
  ).toBe(expected.length);
}

// ---------------------------------------------------------------------------
// Server driving helpers
// ---------------------------------------------------------------------------

/** Start the server and demand a non-error completion. */
async function startServer(timeoutMs: number, stateJson: string = START_STATE_JSON): Promise<void> {
  const payload = await request("asyncstartDedicatedServer", stateJson, timeoutMs);

  if (payload.startsWith("<error>")) {
    // Thrown errors reach the runner's stdout/report: relay only the
    // sanitized form of the raw main-process error.
    throw new Error(
      `GATE FAILURE: server start failed: ${sanitizeDebuggerDiagnosticText(payload.substring("<error>".length))}`
    );
  }
}

/**
 * Start the server and demand an <error> completion; returns the RAW error
 * text so callers can assert against the unsanitized producer — callers must
 * sanitize before relaying it to any runner-visible sink.
 */
async function startServerExpectingError(timeoutMs: number, stateJson: string): Promise<string> {
  const payload = await request("asyncstartDedicatedServer", stateJson, timeoutMs);

  expect(
    payload.startsWith("<error>"),
    `expected the start to fail, got completion payload: '${sanitizeDebuggerDiagnosticText(payload)}'`
  ).toBe(true);

  return payload.substring("<error>".length);
}

/**
 * Stop the server and demand: the stop completion, the stopped notification,
 * and actual BDS process exit. A stop that does not stop is a gate failure.
 */
async function stopServer(): Promise<void> {
  const fromIndex = await eventCount();

  const stopped = waitForEvent(
    (d) => d.startsWith("dedicatedServerStopped|"),
    fromIndex,
    STOP_TIMEOUT_MS,
    "dedicatedServerStopped notification"
  );

  await request("asyncstopDedicatedServer", "", STOP_TIMEOUT_MS);
  await stopped;

  await waitForNoBdsProcess(STOP_TIMEOUT_MS, "after stop");
}

/** Fetch the sanitized diagnostics JSON — the exact text Copy Diagnostic Details copies. */
async function getDiagnosticsText(): Promise<string> {
  const text = await request("asyncgetDebugDiagnostics", "", 30 * 1000);

  expect(text.length, "diagnostics must not be empty while a server exists").toBeGreaterThan(2);

  return text;
}

/**
 * Run one full cycle: start -> connected. Returns the connected stage body
 * and session info from the dedicatedServerDebugConnected event.
 */
async function startToConnected(
  label: string,
  startTimeoutMs: number
): Promise<{ fromIndex: number; debugPort: number; protocolVersion: number }> {
  const fromIndex = await eventCount();

  await startServer(startTimeoutMs);

  await waitForEvent(
    (d) => d.startsWith("dedicatedServerStarted|"),
    fromIndex,
    startTimeoutMs,
    `${label}: BDS 'Server started'`
  );

  const connected = await waitForStage(
    (b) => b.stage === DebuggerLifecycleStage.connected,
    fromIndex,
    CONNECT_TIMEOUT_MS,
    `${label}: connected`
  );

  const connEvent = await waitForEvent(
    (d) => d.startsWith("dedicatedServerDebugConnected|"),
    fromIndex,
    30 * 1000,
    `${label}: debugConnected session event`
  );

  const session = JSON.parse(connEvent.data.substring("dedicatedServerDebugConnected|".length)) as {
    protocolVersion: number;
  };

  expect(typeof connected.body.debugPort, `${label}: connected stage must carry the dynamic debug port`).toBe("number");

  return { fromIndex, debugPort: connected.body.debugPort as number, protocolVersion: session.protocolVersion };
}

// ---------------------------------------------------------------------------
// Node-side environment helpers (processes, ports, files)
// ---------------------------------------------------------------------------

/** List bedrock_server.exe processes belonging to THIS run (path contains the slug). */
function listGateBdsProcesses(): { pid: number; exePath: string }[] {
  const script =
    "Get-CimInstance Win32_Process -Filter \"Name='bedrock_server.exe'\" | " +
    "Select-Object ProcessId, ExecutablePath | ConvertTo-Json -Compress";

  let raw: string;

  try {
    raw = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      encoding: "utf8",
      timeout: 30000,
    });
  } catch (e) {
    throw new Error(`GATE FAILURE: could not enumerate bedrock_server processes: ${e}`);
  }

  const trimmed = raw.trim();

  if (trimmed.length === 0) {
    return [];
  }

  const parsed = JSON.parse(trimmed);
  const rows: { ProcessId: number; ExecutablePath: string | null }[] = Array.isArray(parsed) ? parsed : [parsed];

  return rows
    .filter((r) => r.ExecutablePath && r.ExecutablePath.includes(testSlug))
    .map((r) => ({ pid: r.ProcessId, exePath: r.ExecutablePath as string }));
}

/** Wait until no BDS process from this run remains; throw on deadline. */
async function waitForNoBdsProcess(timeoutMs: number, context: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const procs = listGateBdsProcesses();

    if (procs.length === 0) {
      return;
    }

    if (Date.now() > deadline) {
      throw new Error(
        `GATE FAILURE: leaked bedrock_server process(es) ${context}: ${procs.map((p) => p.pid).join(", ")}`
      );
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

/** Bind-probe: throws if the TCP port is not free (leaked socket/listener). */
async function assertTcpPortFree(port: number, context: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const probe = net.createServer();

    probe.once("error", (e: NodeJS.ErrnoException) => {
      reject(new Error(`GATE FAILURE: TCP port ${port} is not free ${context}: ${e.code ?? e.message}`));
    });

    probe.listen(port, "127.0.0.1", () => {
      probe.close(() => resolve());
    });
  });
}

/** Hold a set of ports open so the app-under-test cannot reserve them. */
async function holdPorts(ports: number[]): Promise<net.Server[]> {
  const holders: net.Server[] = [];

  for (const port of ports) {
    const holder = net.createServer();

    await new Promise<void>((resolve, reject) => {
      holder.once("error", (e) => reject(new Error(`could not hold port ${port}: ${e}`)));
      holder.listen(port, "127.0.0.1", () => resolve());
    });

    holders.push(holder);
  }

  return holders;
}

async function releasePorts(holders: net.Server[]): Promise<void> {
  await Promise.all(holders.map((h) => new Promise<void>((resolve) => h.close(() => resolve()))));
}

const GATE_PACK_HEADER_UUID = "3f7a1c22-5555-4666-8777-2c3d4e5f6a7b";
const GATE_PACK_MODULE_UUID = "9b8c7d66-4444-4333-8222-6a5b4c3d2e1f";

/**
 * Provision a minimal script behavior pack into the slot and register it on
 * the default world. The script debugger needs a debuggee: without a script
 * module BDS has no script engine and no session can be established in
 * either direction. Mirrors the node-side evidence harness. Idempotent.
 */
function provisionMinimalScriptPack(): void {
  const packDir = path.join(slotPath, "development_behavior_packs", "mct_gate_probe");

  fs.mkdirSync(path.join(packDir, "scripts"), { recursive: true });

  fs.writeFileSync(
    path.join(packDir, "manifest.json"),
    JSON.stringify(
      {
        format_version: 2,
        header: {
          name: "MCT Gate Probe",
          description: "Minimal script pack so the script debugger has a debuggee",
          uuid: GATE_PACK_HEADER_UUID,
          version: [1, 0, 0],
          min_engine_version: [1, 20, 0],
        },
        modules: [
          {
            description: "Scripts",
            language: "javascript",
            type: "script",
            uuid: GATE_PACK_MODULE_UUID,
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
    'import { system } from "@minecraft/server";\nsystem.runInterval(() => {}, 20);\nconsole.warn("mct gate probe pack loaded");\n'
  );

  const worldDir = path.join(slotPath, "worlds", "defaultWorld");
  fs.mkdirSync(worldDir, { recursive: true });
  fs.writeFileSync(
    path.join(worldDir, "world_behavior_packs.json"),
    JSON.stringify([{ pack_id: GATE_PACK_HEADER_UUID, version: [1, 0, 0] }], undefined, 2)
  );
}

/**
 * Assert that a text blob that leaves the app (diagnostics copy, repro
 * record) contains no machine-identifying or secret content.
 */
function assertSanitized(text: string, label: string): void {
  expect(text, `${label} must not contain the test storage path`).not.toContain(testSlug);
  expect(text, `${label} must not contain the user home directory`).not.toContain(os.homedir());
  expect(text, `${label} must not contain the local user name`).not.toContain(os.userInfo().username);

  // Any surviving drive-letter path (JSON-escaped or not). The drive letter
  // must sit on a real path boundary (start of text or a non-alphanumeric,
  // mirroring the sanitizer's own path detector): URI schemes are two or
  // more letters, so "https://..." (which contains "s://") is not flagged -
  // a privacy-safe diagnostic/recovery URL must not fail the gate.
  expect(
    /(^|[^A-Za-z0-9])[A-Za-z]:[\\/]/.test(text),
    `${label} must not contain absolute filesystem paths; got: ${text.substring(0, 400)}`
  ).toBe(false);

  expect(/\\\\[A-Za-z0-9_.$-]/.test(text), `${label} must not contain UNC paths`).toBe(false);
  expect(/bearer\s+[^\s"<]/i.test(text), `${label} must not contain bearer credentials`).toBe(false);
  // Bare JWTs are self-identifying ("eyJ" = base64url '{"') and can appear
  // with no Bearer/key prefix; the sanitizer redacts the dotted shape.
  expect(/\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\./.test(text), `${label} must not contain JWT-shaped tokens`).toBe(
    false
  );
  expect(
    /(passcode|password|token|secret|authorization)["']?\s*[:=]\s*(?!\s*["']?<redacted>)["']?[^\s"',}<]/i.test(text),
    `${label} must not contain unredacted credentials`
  ).toBe(false);
  expect(/xuid["']?\s*:?\s*\d{6,}/i.test(text), `${label} must not contain player xuids`).toBe(false);
}

function writeGateArtifact(name: string, content: string): void {
  try {
    fs.mkdirSync(GATE_OUTPUT_DIR, { recursive: true });
    fs.writeFileSync(path.join(GATE_OUTPUT_DIR, name), content);
  } catch (e) {
    // Raw fs errors (EPERM, ENOSPC, locked directory) interpolate the
    // absolute checkout path; sanitize before the error reaches the runner,
    // keeping the artifact name and errno context actionable. The name is a
    // fixed, non-sensitive filename, so it is safe to include.
    throw new Error(
      `GATE FAILURE: could not write gate artifact '${name}' ` +
        "(in the debugger-gate directory under app/debugoutput): " +
        sanitizeDebuggerDiagnosticText(e instanceof Error ? e.message : String(e))
    );
  }
}

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

// Serial: each test builds on real, expensive shared state (the provisioned
// BDS slot); after a failure the remaining tests would only produce noise.
test.describe.configure({ mode: "serial" });

test.describe("Real-BDS Electron debugger release gate", () => {
  test.beforeAll(async () => {
    test.skip(
      !GATE_ENABLED,
      "Gated suite: set MCT_BDS_DEBUGGER_GATE=true (npm run test-electron-debugger-gate) to run the real-BDS debugger gate"
    );

    test.setTimeout(120 * 1000);

    // Invalidate the PREVIOUS invocation's artifacts first - before the
    // prerequisite checks and before launching Electron - so anything found
    // at the documented output path afterward is guaranteed to come from
    // THIS invocation. Without this, a run that fails before rewriting
    // repro-record.json / happy-path-diagnostics.json / appsvc-events.log
    // leaves the previous run's files in place to be mistaken for current
    // evidence. A removal that does not stick (locked file) is a failure
    // for the same reason. Mirrors the node-side evidence harness's
    // invalidate-on-start policy.
    try {
      fs.rmSync(GATE_OUTPUT_DIR, { recursive: true, force: true });
    } catch (e) {
      // Raw fs errors interpolate the absolute path (checkout dir, and on
      // temp-relocated setups the username); sanitize before it reaches the
      // runner, keeping the errno/action context.
      throw new Error(
        "GATE FAILURE: could not invalidate the previous invocation's gate output " +
          "(the debugger-gate directory under app/debugoutput): " +
          sanitizeDebuggerDiagnosticText(e instanceof Error ? e.message : String(e))
      );
    }

    if (fs.existsSync(GATE_OUTPUT_DIR)) {
      // Neutral label: the absolute value embeds the checkout path (and on
      // some setups the username), and this error goes straight to the
      // runner with no sanitization pass in front of it.
      throw new Error(
        "GATE FAILURE: could not invalidate the previous invocation's gate output " +
          "(the debugger-gate directory under app/debugoutput)"
      );
    }

    // With the gate enabled, missing prerequisites are FAILURES, not skips.
    if (os.platform() !== "win32") {
      throw new Error("GATE FAILURE: the real-BDS debugger gate requires Windows (BDS Windows binary).");
    }

    if (!fs.existsSync(electronMainPath)) {
      // Neutral, repo-relative location only - the absolute path embeds the
      // checkout directory and reaches the runner unsanitized.
      throw new Error(
        "GATE FAILURE: Electron main bundle missing (app/toolbuild/jsn/electron). Run 'npm run jsncorebuild' first."
      );
    }

    if (!fs.existsSync(path.join(appDir, "build/index.html"))) {
      throw new Error(`GATE FAILURE: built web assets missing (build/index.html). Run 'npm run webbuild' first.`);
    }

    fs.mkdirSync(GATE_OUTPUT_DIR, { recursive: true });

    electronApp = await electron.launch({
      args: [electronMainPath, `--user-data-dir=${testUserDataDir}`],
      cwd: appDir,
      env: {
        ...process.env,
        NODE_ENV: "test",
        ELECTRON_FORCE_PROD: "true",
        MCT_TEST_STORAGE_ROOT: testStorageDir,
        MCTOOLS_DATA_DIR: testStorageDir,
      },
      timeout: 60000,
    });

    electronApp.on("console", (msg) => {
      // The relay reaches the runner's stdout: sanitize like every other
      // runner-visible sink (main-process log lines can carry paths).
      console.log(`[Electron] ${sanitizeDebuggerDiagnosticText(msg.text()).substring(0, 400)}`);
    });

    page = await electronApp.firstWindow({ timeout: 30000 });

    page.on("crash", () => {
      // Recorded, not just printed: afterEach and afterAll assert this flag,
      // so a crash that lands between requests (where no in-flight page
      // evaluation fails naturally) still fails the gate.
      rendererCrashReport = `the Electron renderer crashed at ${new Date().toISOString()}`;
      console.log("[Electron] RENDERER CRASHED");
    });

    await page.waitForLoadState("domcontentloaded");

    // The recorder must be in place before any command; installRecorder
    // throws when the preload bridge is absent (missing-IPC-bridge = FAIL).
    await installRecorder();
  });

  test.afterEach(async () => {
    if (!GATE_ENABLED) {
      return;
    }

    // A renderer crash is a gate failure even when it lands between requests
    // (no in-flight evaluation to fail naturally, e.g. near teardown).
    expect(rendererCrashReport, "the renderer must not crash during the gate").toBeUndefined();

    // Persist the full event log so a failure is diagnosable from artifacts.
    // The snapshot is STRICT: an unavailable event log (crashed/closed
    // renderer) throws here instead of skipping the privacy assertions as an
    // empty log. Payloads are sanitized before persisting: completion errors
    // relay raw main-process messages (the missing-executable start error
    // carries the absolute slot path), so the artifact must honor the same
    // privacy contract as the diagnostics it accompanies.
    const events = await allEventsSnapshot();

    if (events.length > 0) {
      const serialized = events
        .map((e) => `${new Date(e.at).toISOString()} ${sanitizeDebuggerDiagnosticText(e.data)}`)
        .join("\n");

      // Write first so the artifact survives for diagnosis even when the
      // privacy assertions below fail the run.
      writeGateArtifact("appsvc-events.log", serialized);

      expect(
        sanitizeDebuggerDiagnosticText(serialized),
        "the appsvc events artifact must be sanitizer-stable (re-sanitizing must be a no-op)"
      ).toBe(serialized);
      assertSanitized(serialized, "the appsvc events artifact");
    }
  });

  test.afterAll(async () => {
    if (!GATE_ENABLED) {
      return;
    }

    // The hook timeout must exceed the SUMMED worst case of every bounded
    // step below (stop 70s + close 60s + sweep ~90s + two 60s removals =
    // ~340s) with slack - under compounded hangs Playwright would otherwise
    // abort the hook before the final backstops and the aggregation ran.
    test.setTimeout(480 * 1000);

    // One shared outer deadline with a reserved aggregation budget: each
    // step's cap is additionally clamped to what remains, so even compounded
    // worst cases leave room for the trailing backstops and the combined
    // failure report to run inside the hook timeout.
    const teardownDeadline = Date.now() + 420 * 1000;
    const AGGREGATION_RESERVE_MS = 20 * 1000;
    const stepBudget = (capMs: number): number =>
      Math.max(1000, Math.min(capMs, teardownDeadline - AGGREGATION_RESERVE_MS - Date.now()));

    // Every teardown backstop runs INDEPENDENTLY and failures are aggregated
    // at the end: a throwing (or hanging) earlier step must not prevent the
    // later backstops from running — that would leave the real BDS process
    // or test data behind on exactly the failure paths this gate polices.
    const failures: string[] = [];

    const attemptCleanup = async (label: string, action: () => Promise<void>): Promise<void> => {
      try {
        await action();
      } catch (e) {
        // Sanitize before aggregating: raw fs/OS errors carry absolute temp
        // paths (username, local temp layout) - the same content
        // assertSanitized forbids in every other runner-visible sink.
        failures.push(sanitizeDebuggerDiagnosticText(`${label}: ${e instanceof Error ? e.message : String(e)}`));
      }
    };

    /** Bound a step that can hang (not just throw) so later backstops still run. */
    const withDeadline = (action: () => Promise<void>, ms: number, label: string): Promise<void> =>
      new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${label} did not complete within ${ms}ms`)), ms);

        action().then(
          () => {
            clearTimeout(timer);
            resolve();
          },
          (e) => {
            clearTimeout(timer);
            reject(e);
          }
        );
      });

    // Best-effort stop through the app, then close it. Deadline-bounded and
    // aggregated: the request timeout runs inside the renderer's own
    // page.evaluate, so a wedged renderer can hang the call itself - without
    // an outer deadline that would consume the whole afterAll budget and
    // skip every later backstop.
    if (electronApp && page && !page.isClosed()) {
      await attemptCleanup("stopping the dedicated server via IPC", () =>
        withDeadline(
          async () => {
            await request("asyncstopDedicatedServer", "", STOP_TIMEOUT_MS);
          },
          stepBudget(STOP_TIMEOUT_MS + 10 * 1000),
          "the preliminary asyncstopDedicatedServer"
        )
      );
    }

    if (electronApp) {
      await attemptCleanup("closing the Electron app", () =>
        withDeadline(() => electronApp.close(), stepBudget(60 * 1000), "electronApp.close()")
      );
    }

    // Absolute backstop: no BDS process from this run may survive the suite —
    // enforced even when the app close failed or hung above. If app close
    // left one alive, terminate it first (only PIDs whose executable path
    // carries this run's slug, never any other BDS on the host) and then
    // verify exit: the gate must still FAIL on the leak, but it must not
    // leave a real server running on the host after merely reporting it.
    await attemptCleanup("BDS process sweep", () =>
      withDeadline(
        async () => {
          const leaked = listGateBdsProcesses();

          for (const proc of leaked) {
            try {
              process.kill(proc.pid, "SIGKILL");
            } catch {
              // Exited between the listing and the kill.
            }
          }

          await waitForNoBdsProcess(30 * 1000, "after closing the Electron app");

          if (leaked.length > 0) {
            throw new Error(
              `GATE FAILURE: bedrock_server process(es) survived app close and were force-killed: ${leaked
                .map((p) => p.pid)
                .join(", ")}`
            );
          }
        },
        stepBudget(90 * 1000),
        "the BDS process sweep"
      )
    );

    // Leaked handles keep Windows directories undeletable: removal is the
    // cleanup assertion itself. Brief per-directory retry to let the OS
    // release handles from the just-closed app; each directory is attempted
    // regardless of what happened to the other.
    // Labels are non-sensitive on purpose: the absolute directory values
    // embed the username and local temp layout.
    for (const { dir, label } of [
      { dir: testStorageDir, label: "the slug storage dir" },
      { dir: testUserDataDir, label: "the user-data dir" },
    ]) {
      await attemptCleanup(`removing test storage (${label})`, async () => {
        // Clamped to the shared teardown budget so two compounded 60s
        // removals cannot push the aggregation past the hook timeout.
        const deadline = Date.now() + stepBudget(60 * 1000);

        for (;;) {
          try {
            if (fs.existsSync(dir)) {
              fs.rmSync(dir, { recursive: true, force: true });
            }
            break;
          } catch (e) {
            if (Date.now() > deadline) {
              throw new Error(`test storage could not be removed (leaked handle?): ${e}`);
            }
            await new Promise((resolve) => setTimeout(resolve, 2000));
          }
        }

        if (fs.existsSync(dir)) {
          throw new Error("test storage still present after removal");
        }
      });
    }

    // Renderer-crash backstop, aggregated with the rest: a crash after the
    // last test's afterEach — during teardown itself — must still fail the
    // gate, and it must never mask (or be masked by) a cleanup failure.
    if (rendererCrashReport) {
      failures.push(rendererCrashReport);
    }

    if (failures.length > 0) {
      // Entries are sanitized as they are pushed; sanitize the combined text
      // once more so nothing aggregated outside attemptCleanup (the renderer
      // crash report) can carry a path to the runner either.
      throw new Error(
        sanitizeDebuggerDiagnosticText(`GATE FAILURE: teardown backstops failed:\n  - ${failures.join("\n  - ")}`)
      );
    }
  });

  test("preload bridge: debug IPC channels exist and unknown channels are rejected", async () => {
    test.setTimeout(60 * 1000);

    // 1) A command OUTSIDE the whitelist must throw in the preload — proving
    //    the bridge validates, and giving this suite a live detector for the
    //    historical failure where debug channels were missing and every debug
    //    action died as 'PLD: Unknown command'.
    const unknownRejected = await page.evaluate(() => {
      try {
        (window as any).api.send("appweb", "asyncdebugNotARealChannel|1", "");
        return "no-error";
      } catch (e) {
        return String(e);
      }
    });

    expect(unknownRejected, "the preload must reject non-whitelisted commands").toContain("PLD: Unknown command");

    // 2) Every debug channel the DebugStatsPanel uses must round-trip to the
    //    main process and back. With no server, these complete with empty/0
    //    payloads — the assertion is that the completion ARRIVES (whitelisted
    //    + handled), not what it carries.
    for (const channel of [
      "asyncgetDebugStatus",
      "asyncgetDebugDiagnostics",
      "asyncdebugPause",
      "asyncdebugResume",
      "asyncdebugStartProfiler",
      "asyncdebugStopProfiler",
      "asyncdebugRetryConnection",
      "asyncdebugReattach",
      "asyncgetDedicatedServerDebugStatus",
    ]) {
      await request(channel, "", 15 * 1000);
    }

    // 3) Baseline: no server yet.
    const status = await request("asyncgetDedicatedServerStatus", "", 15 * 1000);
    expect(status, "no server should exist before the first start").toBe("-1");

    await takeScreenshot(page, "debugger-gate-bridge-verified");
  });

  test("fault: start without EULA acceptance fails with an error and starts nothing", async () => {
    test.setTimeout(120 * 1000);

    const errorText = await startServerExpectingError(90 * 1000, JSON.stringify({ mode: 0, iagree: false }));

    console.log(`[Gate] EULA-refused start error: ${sanitizeDebuggerDiagnosticText(errorText).substring(0, 300)}`);
    expect(errorText.length, "the EULA failure must carry an error message").toBeGreaterThan(0);

    // Nothing may have been left running or half-provisioned as startable.
    expect(listGateBdsProcesses()).toHaveLength(0);

    const status = await request("asyncgetDedicatedServerStatus", "", 15 * 1000);
    expect(status === "-1" || status === "1", `status should be none/stopped after EULA refusal, got ${status}`).toBe(
      true
    );
  });

  test("repro (sequence 0): no script debuggee — debugger fails as moduleSelection with sanitized diagnostics", async () => {
    // First real start: provisions the slot and downloads BDS on first run.
    test.setTimeout(FIRST_START_TIMEOUT_MS + FAILURE_EXHAUSTION_TIMEOUT_MS + 120 * 1000);

    const fromIndex = await eventCount();

    await startServer(FIRST_START_TIMEOUT_MS);

    await waitForEvent(
      (d) => d.startsWith("dedicatedServerStarted|"),
      fromIndex,
      FIRST_START_TIMEOUT_MS,
      "BDS 'Server started' (first provisioned run)"
    );

    // Without a behavior pack containing a script module, BDS accepts the
    // outbound connection and completes the handshake but has no script
    // module to select — and closes the session right after. The reconnect
    // loop must exhaust into a TERMINAL moduleSelection failure with the
    // actionable cause — never an endless connect/drop churn, never a fake
    // success, never a hang.
    const failed = await waitForStage(
      (b) => b.stage === DebuggerLifecycleStage.failed,
      fromIndex,
      FAILURE_EXHAUSTION_TIMEOUT_MS,
      "terminal debugger failure with no debuggee",
      false
    );

    expect(failed.body.failureKind).toBe(DebuggerFailureKind.moduleSelection);
    expect(failed.body.message, "the failure must name the actionable cause").toMatch(/script module/i);
    expect(failed.body.message, "the terminal failure must explain the exhausted reconnects").toContain("giving up");

    const observed = await stagesObserved(fromIndex);
    assertOrderedStageSubsequence(
      observed,
      [
        DebuggerLifecycleStage.startingServer,
        DebuggerLifecycleStage.configuring,
        DebuggerLifecycleStage.startingListener,
        DebuggerLifecycleStage.connectingTcp,
        DebuggerLifecycleStage.reconnecting,
        DebuggerLifecycleStage.failed,
      ],
      "no-debuggee repro"
    );

    // Capture the sanitized reproduction record (sequence 0 deliverable).
    const diagnosticsText = await getDiagnosticsText();
    const diagnostics = JSON.parse(diagnosticsText);
    const electronVersion = await electronApp.evaluate(() => process.versions.electron);

    const reproRecord = {
      capturedAt: new Date().toISOString(),
      scenario:
        "Electron UI start of a managed BDS with no script behavior pack on the world; " +
        "the script debugger cannot establish a session (no script engine to attach to).",
      electronBuild: electronVersion,
      bdsBuild: diagnostics.bdsVersion,
      selectedMode: "auto (managed slot 0), outbound debugger direction",
      ports: { serverPort: diagnostics.serverPort, debugPort: diagnostics.debugPort },
      worldProject: "transient gate world 'defaultWorld', no project deployed",
      lifecycleStage: diagnostics.stage,
      failureKind: diagnostics.failureKind,
      exactError: diagnostics.errorMessage,
      relevantLogs: diagnostics.recentServerMessages,
      stageHistory: diagnostics.stageHistory,
    };

    const serializedRecord = JSON.stringify(reproRecord, undefined, 2);
    assertSanitized(serializedRecord, "the reproduction record");
    writeGateArtifact("repro-record.json", serializedRecord);
    console.log(`[Gate] Repro record captured: stage=${diagnostics.stage} kind=${diagnostics.failureKind}`);

    await takeScreenshot(page, "debugger-gate-repro-no-debuggee");

    await stopServer();
  });

  test("happy path: full lifecycle to connected — settings, dynamic port, negotiation, target, resume, diagnostics", async () => {
    test.setTimeout(START_TIMEOUT_MS + CONNECT_TIMEOUT_MS + 120 * 1000);

    // Give the debugger its debuggee, then run the real path.
    expect(fs.existsSync(slotPath), "the slot must exist after the repro run").toBe(true);
    provisionMinimalScriptPack();

    const { fromIndex, debugPort, protocolVersion } = await startToConnected("happy path", START_TIMEOUT_MS);

    // Dynamic port: within the reserved probe window.
    expect(debugPort).toBeGreaterThanOrEqual(PREFERRED_DEBUG_PORT);
    expect(debugPort).toBeLessThan(PREFERRED_DEBUG_PORT + DEBUG_PORT_CANDIDATES);

    // The v10-capable handshake must have negotiated a real protocol version
    // (>= 7 carries debugger-request support; current BDS negotiates 9+).
    expect(protocolVersion).toBeGreaterThanOrEqual(7);

    // Full stage path, in order.
    const observed = await stagesObserved(fromIndex);
    assertOrderedStageSubsequence(
      observed,
      [
        DebuggerLifecycleStage.startingServer,
        DebuggerLifecycleStage.configuring,
        DebuggerLifecycleStage.startingListener,
        DebuggerLifecycleStage.connectingTcp,
        DebuggerLifecycleStage.negotiating,
        DebuggerLifecycleStage.selectingTarget,
        DebuggerLifecycleStage.resuming,
        DebuggerLifecycleStage.connected,
      ],
      "happy path"
    );

    // Streaming: real stats must arrive over the established session.
    await waitForEvent(
      (d) => d.startsWith("dedicatedServerDebugStats|"),
      fromIndex,
      60 * 1000,
      "debug stats streaming after connected"
    );

    // Connected diagnostics — the exact Copy Diagnostic Details payload.
    const diagnosticsText = await getDiagnosticsText();
    const diagnostics = JSON.parse(diagnosticsText);

    expect(diagnostics.stage).toBe(DebuggerLifecycleStage.connected);
    expect(diagnostics.failureKind).toBe(DebuggerFailureKind.none);
    expect(diagnostics.protocolVersion).toBe(protocolVersion);
    expect(diagnostics.debugPort).toBe(debugPort);
    expect(typeof diagnostics.bdsVersion, "diagnostics must carry the BDS build").toBe("string");
    // Normalize case/braces: BDS may report the module id in either form.
    const normalizedTarget = String(diagnostics.targetModuleUuid ?? "")
      .toLowerCase()
      .replace(/[{}]/g, "");
    expect(
      normalizedTarget,
      "the gate pack's script module must have been selected (passcode/target-selection step)"
    ).toBe(GATE_PACK_MODULE_UUID);
    expect(diagnostics.outboundScriptDebuggingEnabled, "settings snapshot must be surfaced").not.toBeUndefined();

    const historyStages = (diagnostics.stageHistory as { stage: string }[]).map((t) => t.stage);
    for (const required of [
      DebuggerLifecycleStage.negotiating,
      DebuggerLifecycleStage.selectingTarget,
      DebuggerLifecycleStage.resuming,
      DebuggerLifecycleStage.connected,
    ]) {
      expect(historyStages, `stage history must include ${required}`).toContain(required);
    }

    // Copy Diagnostic Details privacy gate.
    assertSanitized(diagnosticsText, "the Copy Diagnostic Details payload");

    writeGateArtifact("happy-path-diagnostics.json", diagnosticsText);
    await takeScreenshot(page, "debugger-gate-happy-path-connected");

    await stopServer();
    await assertTcpPortFree(debugPort, "after the happy-path stop");
  });

  test("disconnect/reconnect: user retry drops the session and rejoins the live server", async () => {
    test.setTimeout(START_TIMEOUT_MS + CONNECT_TIMEOUT_MS + 180 * 1000);

    const first = await startToConnected("reconnect cycle initial", START_TIMEOUT_MS);

    // The DebugStatsPanel Retry action path: asyncdebugRetryConnection.
    const retryFrom = await eventCount();
    const retryPayload = await request("asyncdebugRetryConnection", "", 60 * 1000);
    expect(retryPayload, "retry must be accepted while the server runs").toBe("1");

    // The deliberate drop is a silent teardown by design (no disconnect
    // notification - it must not be classified as a failure). The strict
    // evidence of a REAL re-established session is: a fresh connect attempt,
    // a fresh connected stage, and a fresh session event - all AFTER the
    // retry request.
    await waitForStage(
      (b) => b.stage === DebuggerLifecycleStage.connectingTcp,
      retryFrom,
      60 * 1000,
      "fresh connect attempt after retry"
    );

    const reconnected = await waitForStage(
      (b) => b.stage === DebuggerLifecycleStage.connected,
      retryFrom,
      CONNECT_TIMEOUT_MS,
      "re-connected after retry"
    );

    await waitForEvent(
      (d) => d.startsWith("dedicatedServerDebugConnected|"),
      retryFrom,
      30 * 1000,
      "fresh debug session event after retry"
    );

    expect(reconnected.body.debugPort, "the rejoined session must carry a live debug port").toBeDefined();

    const diagnostics = JSON.parse(await getDiagnosticsText());
    expect(diagnostics.stage).toBe(DebuggerLifecycleStage.connected);

    await takeScreenshot(page, "debugger-gate-reconnected");

    await stopServer();
    await assertTcpPortFree(first.debugPort, "after the reconnect-cycle stop");
  });

  test("restart: a fresh start after stop reconnects and reuses the released debug port", async () => {
    test.setTimeout(2 * (START_TIMEOUT_MS + CONNECT_TIMEOUT_MS) + 180 * 1000);

    const first = await startToConnected("restart cycle 1", START_TIMEOUT_MS);
    await stopServer();
    await assertTcpPortFree(first.debugPort, "between restart cycles");

    const second = await startToConnected("restart cycle 2", START_TIMEOUT_MS);

    // If the first run's reservation, socket, or timer survived the stop, the
    // registry could not hand out the same preferred port again.
    expect(second.debugPort, "the released debug port must be reusable on restart").toBe(first.debugPort);

    await stopServer();
    await assertTcpPortFree(second.debugPort, "after the restart cycles");
  });

  test("fault: all candidate debug ports occupied fails fast as portOccupied with retry recovery", async () => {
    test.setTimeout(START_TIMEOUT_MS + 180 * 1000);

    const heldPorts: number[] = [];
    for (let i = 0; i < DEBUG_PORT_CANDIDATES; i++) {
      heldPorts.push(PREFERRED_DEBUG_PORT + i);
    }

    const holders = await holdPorts(heldPorts);

    try {
      const fromIndex = await eventCount();

      await startServer(START_TIMEOUT_MS);

      const failed = await waitForStage(
        (b) => b.stage === DebuggerLifecycleStage.failed,
        fromIndex,
        CONNECT_TIMEOUT_MS,
        "portOccupied failure",
        false
      );

      expect(failed.body.failureKind).toBe(DebuggerFailureKind.portOccupied);
      expect(failed.body.message, "the failure must name the exhausted port range").toMatch(/port/i);

      // The category the user sees maps to the documented recovery actions.
      const actions = getRecoveryActionsForFailure(DebuggerFailureKind.portOccupied);
      expect(actions[0]).toBe(DebuggerRecoveryAction.retry);
      expect(actions).toContain(DebuggerRecoveryAction.copyDiagnostics);

      // The failed-state diagnostics are also privacy-safe.
      assertSanitized(await getDiagnosticsText(), "portOccupied failure diagnostics");

      await takeScreenshot(page, "debugger-gate-port-occupied");
    } finally {
      await releasePorts(holders);
    }

    // Recovery across the wire: with the ports free again, the user Retry
    // action must produce a real connected session on the SAME server run.
    const retryFrom = await eventCount();
    const retryPayload = await request("asyncdebugRetryConnection", "", 60 * 1000);
    expect(retryPayload).toBe("1");

    await waitForStage(
      (b) => b.stage === DebuggerLifecycleStage.connected,
      retryFrom,
      CONNECT_TIMEOUT_MS,
      "recovery retry after freeing the ports"
    );

    await stopServer();
  });

  test("fault: script debugging disabled in server.properties fails as settings with changeSettings recovery", async () => {
    test.setTimeout(START_TIMEOUT_MS + 180 * 1000);

    expect(fs.existsSync(serverPropertiesPath), "server.properties must exist in the provisioned slot").toBe(true);
    const original = fs.readFileSync(serverPropertiesPath, "utf8");
    expect(original).toMatch(/^allow-outbound-script-debugging=/m);

    try {
      fs.writeFileSync(
        serverPropertiesPath,
        original.replace(/^allow-outbound-script-debugging=.*$/m, "allow-outbound-script-debugging=false"),
        "utf8"
      );

      const fromIndex = await eventCount();

      await startServer(START_TIMEOUT_MS);

      const failed = await waitForStage(
        (b) => b.stage === DebuggerLifecycleStage.failed,
        fromIndex,
        CONNECT_TIMEOUT_MS,
        "settings failure",
        false
      );

      expect(failed.body.failureKind).toBe(DebuggerFailureKind.settings);
      expect(failed.body.message).toContain("allow-outbound-script-debugging");

      const actions = getRecoveryActionsForFailure(DebuggerFailureKind.settings);
      expect(actions[0]).toBe(DebuggerRecoveryAction.changeSettings);
      expect(actions).toContain(DebuggerRecoveryAction.retry);

      await takeScreenshot(page, "debugger-gate-settings-disabled");

      await stopServer();
    } finally {
      fs.writeFileSync(serverPropertiesPath, original, "utf8");
    }
  });

  test("fault: unexpected BDS exit — the app recovers to a fresh connected session, then stops cleanly", async () => {
    test.setTimeout(START_TIMEOUT_MS + 2 * CONNECT_TIMEOUT_MS + 240 * 1000);

    await startToConnected("pre-kill", START_TIMEOUT_MS);

    const procs = listGateBdsProcesses();
    expect(procs.length, "exactly one BDS process should be running").toBe(1);

    const killFrom = await eventCount();

    console.log(`[Gate] Killing BDS pid ${procs[0].pid} to simulate an unexpected exit...`);
    execFileSync("taskkill.exe", ["/PID", String(procs[0].pid), "/F"], { timeout: 15000 });

    // The established debug session must observably drop...
    await waitForEvent(
      (d) => d.startsWith("dedicatedServerDebugDisconnected|") || d.startsWith("dedicatedServerStopped|"),
      killFrom,
      60 * 1000,
      "disconnect/stop notification after the BDS process was killed"
    );

    // ...and DedicatedServer's crash auto-restart (backoff 1s/2s/4s) must
    // produce a genuinely fresh connected session — the user-visible recovery.
    await waitForStage(
      (b) => b.stage === DebuggerLifecycleStage.connected,
      killFrom,
      START_TIMEOUT_MS + CONNECT_TIMEOUT_MS,
      "reconnected session after crash auto-restart",
      false
    );

    const diagnostics = JSON.parse(await getDiagnosticsText());
    expect(diagnostics.stage).toBe(DebuggerLifecycleStage.connected);

    await takeScreenshot(page, "debugger-gate-recovered-after-kill");

    // And the stop path must still fully work after the crash/recovery churn.
    await stopServer();
  });

  test("fault: missing BDS executable fails the start with an actionable error and a terminal debugger state", async () => {
    test.setTimeout(180 * 1000);

    const exePath = path.join(slotPath, "bedrock_server.exe");
    expect(fs.existsSync(exePath), "the provisioned slot must contain bedrock_server.exe").toBe(true);

    const hiddenPath = exePath + ".gate-hidden";
    fs.renameSync(exePath, hiddenPath);

    try {
      const fromIndex = await eventCount();

      const errorText = await startServerExpectingError(120 * 1000, START_STATE_JSON);

      // Regression for the runner-output leak path: this failure is the
      // concrete path-bearing producer (its raw main-process error carries
      // the absolute slot path), and everything the gate relays to a
      // runner-visible sink must be the sanitized form.
      expect(
        errorText,
        "fixture check: the raw missing-executable error must actually carry the slot path"
      ).toContain(testSlug);

      const sanitizedError = sanitizeDebuggerDiagnosticText(errorText);
      expect(sanitizedError, "the sanitized error must not carry the slot path").not.toContain(testSlug);
      assertSanitized(sanitizedError, "the missing-executable error relayed to the runner");

      console.log(`[Gate] Missing-executable start error: ${sanitizedError.substring(0, 300)}`);
      expect(errorText.length).toBeGreaterThan(0);

      // The debugger lifecycle must land terminally failed as serverStartup —
      // not report 'starting' forever, and not attempt a connection retry.
      const failed = await waitForStage(
        (b) => b.stage === DebuggerLifecycleStage.failed,
        fromIndex,
        60 * 1000,
        "serverStartup debugger failure",
        false
      );

      expect(failed.body.failureKind).toBe(DebuggerFailureKind.serverStartup);

      const actions = getRecoveryActionsForFailure(DebuggerFailureKind.serverStartup);
      expect(actions, "a connection retry cannot fix a server that never started").not.toContain(
        DebuggerRecoveryAction.retry
      );

      expect(listGateBdsProcesses()).toHaveLength(0);
    } finally {
      fs.renameSync(hiddenPath, exePath);
    }
  });

  test("failure matrix: every failure category maps to the correct classification and recovery actions", async () => {
    // These are the EXACT modules the Electron main process classifies with
    // and the DebugStatsPanel renders recovery actions from. Categories real
    // BDS cannot be driven to emit on demand (unsupported protocol, wrong
    // passcode, invalid module UUID, bad source-map roots) are pinned here;
    // the wire-reachable categories are additionally proven live above.
    const disconnectMatrix: { reason: string; kind: DebuggerFailureKind }[] = [
      { reason: "Unsupported protocol version 99 (protocol mismatch)", kind: DebuggerFailureKind.protocolMismatch },
      { reason: "The debugger passcode was rejected", kind: DebuggerFailureKind.passcode },
      { reason: "Target module abc is missing or invalid", kind: DebuggerFailureKind.moduleSelection },
      { reason: "Invalid source map roots for the selected target", kind: DebuggerFailureKind.sourceMapConfiguration },
      { reason: "Failed to connect to localhost:19144: ECONNREFUSED", kind: DebuggerFailureKind.tcpConnect },
      { reason: "Connection timeout after 10000ms", kind: DebuggerFailureKind.tcpConnect },
      { reason: "Handshake timeout: no ProtocolEvent received", kind: DebuggerFailureKind.handshakeTimeout },
      { reason: "Socket closed", kind: DebuggerFailureKind.prematureClose },
    ];

    for (const row of disconnectMatrix) {
      expect(classifyDebugClientDisconnectReason(row.reason), `classify('${row.reason}')`).toBe(row.kind);
    }

    const listenMatrix: { line: string; kind: DebuggerFailureKind }[] = [
      { line: "Failed to start debugger: port 19144 already in use", kind: DebuggerFailureKind.portOccupied },
      { line: "Failed to start debugger: could not bind listener", kind: DebuggerFailureKind.portOccupied },
      { line: "Failed to start debugger: unsupported request", kind: DebuggerFailureKind.listenerReadiness },
    ];

    for (const row of listenMatrix) {
      expect(classifyDebuggerListenFailure(row.line), `classify listen('${row.line}')`).toBe(row.kind);
    }

    // Recovery actions shown to the user, per category.
    const recoveryMatrix: { kind: DebuggerFailureKind; leading: DebuggerRecoveryAction; retryable: boolean }[] = [
      { kind: DebuggerFailureKind.settings, leading: DebuggerRecoveryAction.changeSettings, retryable: true },
      { kind: DebuggerFailureKind.passcode, leading: DebuggerRecoveryAction.changeSettings, retryable: true },
      {
        kind: DebuggerFailureKind.sourceMapConfiguration,
        leading: DebuggerRecoveryAction.changeSettings,
        retryable: true,
      },
      { kind: DebuggerFailureKind.portOccupied, leading: DebuggerRecoveryAction.retry, retryable: true },
      { kind: DebuggerFailureKind.listenerReadiness, leading: DebuggerRecoveryAction.retry, retryable: true },
      { kind: DebuggerFailureKind.tcpConnect, leading: DebuggerRecoveryAction.retry, retryable: true },
      { kind: DebuggerFailureKind.handshakeTimeout, leading: DebuggerRecoveryAction.retry, retryable: true },
      { kind: DebuggerFailureKind.moduleSelection, leading: DebuggerRecoveryAction.retry, retryable: true },
      { kind: DebuggerFailureKind.prematureClose, leading: DebuggerRecoveryAction.retry, retryable: true },
      { kind: DebuggerFailureKind.serverStartup, leading: DebuggerRecoveryAction.viewLogs, retryable: false },
      { kind: DebuggerFailureKind.protocolMismatch, leading: DebuggerRecoveryAction.viewLogs, retryable: false },
    ];

    for (const row of recoveryMatrix) {
      const actions = getRecoveryActionsForFailure(row.kind);

      expect(actions[0], `${row.kind}: leading recovery action`).toBe(row.leading);
      expect(actions.includes(DebuggerRecoveryAction.retry), `${row.kind}: retry offered`).toBe(row.retryable);
      expect(actions, `${row.kind}: diagnostics always available`).toContain(DebuggerRecoveryAction.copyDiagnostics);
      expect(actions, `${row.kind}: logs always available`).toContain(DebuggerRecoveryAction.viewLogs);
      expect(actions, `${row.kind}: stop always available`).toContain(DebuggerRecoveryAction.stopServer);
    }

    // The sanitizer the whole pipeline funnels free text through must redact
    // the canonical secret shapes end to end. The JWT is a COMPLETE bare
    // three-segment token with no Bearer/key prefix: the Bearer rule cannot
    // save it, so this assertion is only satisfiable by real JWT redaction.
    const bareJwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIyNTM1NDA1MjgzNDIxMzM3In0.dGVzdHNpZ25hdHVyZQ";
    const dirty =
      'at "C:\\Users\\someone\\worlds\\my world" with passcode: hunter2, token=abc123, ' +
      `Bearer eyJhbGciOi, session ${bareJwt} attached, xuid: 2535405000000000, and /home/someone/projects/x.js`;
    const clean = sanitizeDebuggerDiagnosticText(dirty);

    expect(clean).not.toContain("C:\\Users");
    expect(clean).not.toContain("hunter2");
    expect(clean).not.toContain("abc123");
    expect(clean, "the complete bare JWT must be redacted").not.toContain(bareJwt);
    expect(clean).not.toContain("eyJhbGciOi");
    expect(clean).not.toContain("2535405000000000");
    expect(clean).not.toContain("/home/someone");

    // assertSanitized's drive-path detector: real drive paths must fail in
    // both raw and JSON-escaped forms, while URI schemes must pass - the
    // detector requires a path boundary before the single drive letter, so
    // "https://..." (which contains "s://") is not a false positive.
    expect(() => assertSanitized("exe at Q:\\slot\\bedrock_server.exe", "drive-path fixture")).toThrow();
    expect(() => assertSanitized('{"exe":"Q:\\\\slot\\\\bedrock_server.exe"}', "escaped drive-path fixture")).toThrow();
    assertSanitized("see https://aka.ms/minecraft-debugger for recovery guidance", "URL fixture");
  });

  test("leaks: no BDS process, no held ports, and no stray debugger events remain", async () => {
    test.setTimeout(120 * 1000);

    // Every scenario above stopped its server; anything still alive leaked.
    expect(listGateBdsProcesses(), "no bedrock_server process from this run may remain").toHaveLength(0);

    // The whole dynamic debug-port window must be externally bindable again.
    for (let i = 0; i < DEBUG_PORT_CANDIDATES; i++) {
      await assertTcpPortFree(PREFERRED_DEBUG_PORT + i, "in the post-suite leak sweep");
    }

    // Stale timers/subscriptions from any prior run would keep emitting
    // debugger or stats events after everything is stopped. Demand quiet.
    const quietFrom = await eventCount();
    await page.waitForTimeout(POST_STOP_QUIET_MS);
    const late = await eventsSince(quietFrom);
    const lateDebuggerEvents = late.filter(
      (e) =>
        e.data.startsWith("dedicatedServerDebugStage|") ||
        e.data.startsWith("dedicatedServerDebugStats|") ||
        e.data.startsWith("dedicatedServerDebugConnected|")
    );

    expect(
      lateDebuggerEvents.map((e) => e.data.substring(0, 120)),
      "no debugger events may fire after all servers are stopped (leaked timer/subscription)"
    ).toHaveLength(0);

    // Final status check through the same strict pipeline.
    const status = await request("asyncgetDedicatedServerStatus", "", 15 * 1000);
    expect(status === "-1" || status === "1", `expected stopped/none status at gate end, got ${status}`).toBe(true);

    await takeScreenshot(page, "debugger-gate-leak-sweep-clean");
  });
});
