// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * DebugProtocolRealBdsTest
 *
 * Real-BDS handshake coverage for the Minecraft script-debug protocol
 * (Task 1669106). This suite proves the across-the-wire path against a real,
 * downloaded Bedrock Dedicated Server - there is NO mock server and no mock
 * product path; the exact envelope-shape conformance lives in
 * src/test/DebugProtocolConformanceTest.ts using inert frames.
 *
 * What it exercises, driving the raw MinecraftDebugClient directly (the
 * DedicatedServer-managed debugger flow is deliberately disabled so this
 * suite validates the protocol client itself):
 *
 *   1. enable inbound script debugging (server.properties, persisted)
 *   2. select a collision-free debug port (DebugPortRegistry bind probe)
 *   3. run `script debugger listen <port>`
 *   4. wait for the parsed "Debugger listening" readiness confirmation
 *   5. attempt the inbound MCT-dials-BDS connection and record a definitive
 *      verdict: connected (future BDS) or the documented listener-flap
 *      failure (current BDS tears the inbound listener down and re-arms it
 *      every few ticks, so clients see accept-then-reset / refused). Any
 *      OTHER outcome fails.
 *   6. complete the REQUIRED full handshake in the outbound direction
 *      (MCT listens, `script debugger connect` makes BDS dial - the same
 *      model the official minecraft-debugger extension uses): version
 *      negotiation, no-passcode handling, REQUESTED module UUID selection,
 *      resume, and observed stat streaming as proof of a valid connected
 *      state
 *   7. distinct real failure modes: invalid requested module UUID,
 *      missing module (no script pack), and premature close (server stop
 *      mid-session)
 *
 * The BDS build/version and the negotiated protocol version are recorded in
 * the test output and in a privacy-checked artifact
 * (debugoutput/debugger-protocol/handshake-results.json). Every failure
 * message names the handshake stage it occurred in, and every free-text
 * detail passes through sanitizeDebuggerDiagnosticText.
 *
 * PREREQUISITES (explicit; the suite skips VISIBLY when unavailable):
 *   - Windows (BDS Windows binary)
 *   - Persisted Minecraft EULA acceptance (`npx mct eula --accept`) or
 *     MCTOOLS_I_ACCEPT_EULA_AT_MINECRAFTDOTNETSLASHEULA=true
 *   - Network access for the one-time BDS download; ~500MB disk
 *   - Ports 19132+ and the 19144+ debug window free
 *
 * Run with: npm run test-debugger-protocol-bds   (from app/)
 * NOT run in CI's default loop - this spawns real BDS processes.
 */

import { assert } from "chai";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import TestPaths, { ITestEnvironment } from "../test/TestPaths";
import ServerManager, { ServerManagerFeatures } from "../local/ServerManager";
import DedicatedServer, { DedicatedServerStatus } from "../local/DedicatedServer";
import MinecraftDebugClient from "../debugger/MinecraftDebugClient";
import DebugPortRegistry, { IDebugPortReservation } from "../debugger/DebugPortRegistry";
import {
  DebuggerFailureKind,
  classifyDebugClientDisconnectReason,
  sanitizeDebuggerDiagnosticText,
} from "../debugger/DebuggerLifecycle";
import { IDebugSessionInfo, ProtocolVersion } from "../debugger/IMinecraftDebugProtocol";

const RESULTS_DIR = path.resolve(__dirname, "../../debugoutput/debugger-protocol");
const RESULTS_PATH = path.join(RESULTS_DIR, "handshake-results.json");

const SERVER_START_TIMEOUT_MS = 240000;
const STOP_TIMEOUT_MS = 45000;
const LISTEN_SETTLE_MS = 3000;
const LISTENER_READY_TIMEOUT_MS = 15000;
const OUTBOUND_ACCEPT_TIMEOUT_MS = 15000;
const SESSION_EVENT_TIMEOUT_MS = 20000;
// First stats can lag well behind the handshake while the world's scripts
// finish loading; the managed-flow gate observed the same.
const STATS_TIMEOUT_MS = 60000;

/** Inert identity for the probe pack - never a real project's. */
const PROBE_PACK_HEADER_UUID = "11111111-2222-4333-8444-555566667777";
const PROBE_PACK_MODULE_UUID = "aaaa1111-bbbb-4ccc-8ddd-eeee2222ffff";
const BOGUS_MODULE_UUID = "99999999-0000-4000-8000-000000000099";

let env: ITestEnvironment;
let sm: ServerManager;
let server: DedicatedServer | undefined;

/**
 * The handshake stage currently executing. Every thrown failure names it, so
 * a red run identifies exactly where the flow stopped.
 */
let currentStage = "provisioning";

function atStage(stage: string): void {
  currentStage = stage;
  console.log(`      [handshake] stage: ${stage}`);
}

function stageFailure(message: string): Error {
  return new Error(`[handshake stage=${currentStage}] ${sanitizeDebuggerDiagnosticText(message)}`);
}

/** Rolling, sanitized capture of debugger-relevant BDS output lines. */
const serverLines: string[] = [];
let observedBdsVersion: string | undefined;

/** Findings recorded across the suite; written as the results artifact. */
const results: {
  bdsVersion?: string;
  negotiatedProtocolVersion?: number;
  clientMaxProtocolVersion: number;
  listenerReadinessConfirmed?: boolean;
  inboundVerdict?: string;
  outboundHandshake?: string;
  requestedModuleSelected?: boolean;
  statStreamingObserved?: boolean;
  invalidModuleVerdict?: string;
  missingModuleVerdict?: string;
  prematureCloseVerdict?: string;
} = { clientMaxProtocolVersion: ProtocolVersion.SupportEmptyTabs };

function watchServerOutput(srv: DedicatedServer): void {
  srv.onServerOutput.subscribe((_s, message) => {
    if (!message || !message.fullMessage) {
      return;
    }

    const line = message.fullMessage;

    const versionMatch = line.match(/Version:?\s+(\d+\.\d+\.\d+(?:\.\d+)?)/);
    if (versionMatch) {
      observedBdsVersion = versionMatch[1];
    }

    if (/debugger/i.test(line) || /Server started/.test(line) || /Version/.test(line)) {
      serverLines.push(sanitizeDebuggerDiagnosticText(line));
      if (serverLines.length > 60) {
        serverLines.splice(0, serverLines.length - 60);
      }
    }
  });
}

function waitForStatus(srv: DedicatedServer, status: DedicatedServerStatus, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();

    const poll = () => {
      if (srv.status === status) {
        resolve();
      } else if (Date.now() - started > timeoutMs) {
        reject(stageFailure(`server did not reach status ${status} within ${timeoutMs}ms (status: ${srv.status})`));
      } else {
        setTimeout(poll, 500);
      }
    };

    poll();
  });
}

/** Wait for a BDS output line matching the pattern; reject on deadline. */
function waitForServerLine(srv: DedicatedServer, pattern: RegExp, timeoutMs: number, label: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsub();
      reject(
        stageFailure(
          `timed out after ${timeoutMs}ms waiting for ${label}. Recent debugger-relevant lines:\n` +
            serverLines.slice(-8).join("\n")
        )
      );
    }, timeoutMs);

    const unsub = srv.onServerOutput.subscribe((_s, message) => {
      if (message && message.fullMessage && pattern.test(message.fullMessage)) {
        clearTimeout(timer);
        unsub();
        resolve(message.fullMessage);
      }
    });
  });
}

interface ISessionObservation {
  client: MinecraftDebugClient;
  session?: IDebugSessionInfo;
  disconnectReason?: string;
  sawStats: boolean;
  errors: string[];
}

/**
 * Wire a client for observation, then wait until it either reaches connected
 * or disconnects. Never resolves on a timeout - a hang is a failure.
 */
function observeSession(
  client: MinecraftDebugClient,
  timeoutMs: number,
  label: string
): { observation: ISessionObservation; connectedOrDropped: Promise<"connected" | "dropped"> } {
  const observation: ISessionObservation = { client, sawStats: false, errors: [] };

  const connectedOrDropped = new Promise<"connected" | "dropped">((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(stageFailure(`timed out after ${timeoutMs}ms waiting for ${label} to connect or disconnect`));
    }, timeoutMs);

    client.onConnected.subscribe((_c, info) => {
      observation.session = info;
      clearTimeout(timer);
      resolve("connected");
    });

    client.onDisconnected.subscribe((_c, reason) => {
      observation.disconnectReason = reason;
      if (!observation.session) {
        clearTimeout(timer);
        resolve("dropped");
      }
    });
  });

  client.onStats.subscribe(() => {
    observation.sawStats = true;
  });

  client.onError.subscribe((_c, error) => {
    observation.errors.push(sanitizeDebuggerDiagnosticText(String((error as Error)?.message ?? error)));
  });

  return { observation, connectedOrDropped };
}

/** Wait for a follow-up condition on an observed session; reject on deadline. */
function waitForObservation(
  check: () => boolean,
  timeoutMs: number,
  label: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();

    const poll = () => {
      if (check()) {
        resolve();
      } else if (Date.now() - started > timeoutMs) {
        reject(stageFailure(`timed out after ${timeoutMs}ms waiting for ${label}`));
      } else {
        setTimeout(poll, 250);
      }
    };

    poll();
  });
}

/**
 * Establish an OUTBOUND session: MCT listens on a freshly reserved port and
 * BDS dials it via `script debugger connect`. Returns the observation once
 * connected-or-dropped resolves. The reservation is always released.
 */
async function establishOutboundSession(
  srv: DedicatedServer,
  requestedModuleUuid: string | undefined,
  label: string
): Promise<{ observation: ISessionObservation; outcome: "connected" | "dropped" }> {
  const reservation = await reservePort(srv);

  const client = new MinecraftDebugClient();

  if (requestedModuleUuid !== undefined) {
    client.requestTargetModule(requestedModuleUuid);
  }

  const { observation, connectedOrDropped } = observeSession(client, SESSION_EVENT_TIMEOUT_MS, label);

  try {
    const accepted = client.serve("127.0.0.1", reservation.port, OUTBOUND_ACCEPT_TIMEOUT_MS);
    accepted.catch(() => {
      // Inspected below through connectedOrDropped/observation.
    });

    await srv.runCommand(`script debugger connect 127.0.0.1 ${reservation.port}`);

    try {
      await accepted;
    } catch (e) {
      throw stageFailure(
        `Minecraft did not establish the outbound connection for ${label}: ${e instanceof Error ? e.message : e}`
      );
    }

    const outcome = await connectedOrDropped;

    return { observation, outcome };
  } finally {
    DebugPortRegistry.release(reservation);
  }
}

async function reservePort(srv: DedicatedServer): Promise<IDebugPortReservation> {
  const preferred = (srv.port ?? 19132) + 12;
  const reservation = await DebugPortRegistry.reserve(preferred, srv.serverPath);

  if (reservation === undefined) {
    throw stageFailure(`no collision-free debug port available in ${preferred}-${preferred + 19}`);
  }

  return reservation;
}

/** Write the probe script pack and register it as the world's ONLY pack. */
function provisionProbePack(srv: DedicatedServer): void {
  const packDir = path.join(srv.serverPath, "development_behavior_packs", "mct_protocol_probe");

  fs.mkdirSync(path.join(packDir, "scripts"), { recursive: true });

  fs.writeFileSync(
    path.join(packDir, "manifest.json"),
    JSON.stringify(
      {
        format_version: 2,
        header: {
          name: "MCT Protocol Probe",
          description: "Minimal script pack so the script debugger has a debuggee",
          uuid: PROBE_PACK_HEADER_UUID,
          version: [1, 0, 0],
          min_engine_version: [1, 20, 0],
        },
        modules: [
          {
            description: "Scripts",
            language: "javascript",
            type: "script",
            uuid: PROBE_PACK_MODULE_UUID,
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
    'import { system } from "@minecraft/server";\nsystem.runInterval(() => {}, 20);\nconsole.warn("mct protocol probe pack loaded");\n'
  );

  const worldDir = path.join(srv.serverPath, "worlds", "defaultWorld");
  fs.mkdirSync(worldDir, { recursive: true });
  fs.writeFileSync(
    path.join(worldDir, "world_behavior_packs.json"),
    JSON.stringify([{ pack_id: PROBE_PACK_HEADER_UUID, version: [1, 0, 0] }], undefined, 2)
  );
}

/** Remove every script pack so BDS has no debuggee (missing-module phase). */
function removeAllScriptPacks(srv: DedicatedServer): void {
  const devPacks = path.join(srv.serverPath, "development_behavior_packs");

  if (fs.existsSync(devPacks)) {
    fs.rmSync(devPacks, { recursive: true, force: true });
  }

  const worldPacksPath = path.join(srv.serverPath, "worlds", "defaultWorld", "world_behavior_packs.json");
  fs.mkdirSync(path.dirname(worldPacksPath), { recursive: true });
  fs.writeFileSync(worldPacksPath, "[]");
}

/** Set a server.properties key (replace or append), preserving the rest. */
function setServerProperty(srv: DedicatedServer, key: string, value: string): void {
  const propsPath = path.join(srv.serverPath, "server.properties");
  let content = fs.existsSync(propsPath) ? fs.readFileSync(propsPath, "utf8") : "";

  const linePattern = new RegExp(`^${key}=.*$`, "m");

  if (linePattern.test(content)) {
    content = content.replace(linePattern, `${key}=${value}`);
  } else {
    content = content.trimEnd() + `\n${key}=${value}\n`;
  }

  fs.writeFileSync(propsPath, content, "utf8");
}

async function startServerAtStage(srv: DedicatedServer, stage: string): Promise<void> {
  atStage(stage);

  const started = await srv.startServer(false, undefined);

  // startServer(_, undefined) adopts creatorTools.worldSettings as the start
  // message, and on the run's FIRST start worldSettings.enableDebugger
  // silently overwrites the instance's debuggerEnabled flag - re-enabling
  // the managed debugger flow, which would then race this suite's raw
  // client for the single debugger session BDS allows (reserving the same
  // preferred port, serving on it, and superseding our sessions). Re-assert
  // the disable IMMEDIATELY after the call: the managed flow only begins
  // when BDS reports "Server started.", which is still seconds away.
  srv.debuggerEnabled = false;
  console.log(`      [handshake] managed debugger flow enabled: ${srv.debuggerEnabled}`);

  assert.isTrue(started, `[stage=${currentStage}] BDS should start`);

  await waitForServerLine(srv, /Server started/, SERVER_START_TIMEOUT_MS, "the parsed 'Server started.' line");

  // Let BDS finish startup work before it takes debugger commands, exactly
  // like the managed flow's settle delay.
  await new Promise((resolve) => setTimeout(resolve, LISTEN_SETTLE_MS));
}

async function stopServerAtStage(srv: DedicatedServer, stage: string): Promise<void> {
  atStage(stage);

  if (srv.status !== DedicatedServerStatus.stopped) {
    await srv.stopServer();
    await waitForStatus(srv, DedicatedServerStatus.stopped, STOP_TIMEOUT_MS);
  }
}

describe("Debug protocol real-BDS handshake (live integration)", function () {
  this.timeout(600000);

  before(async function () {
    this.timeout(600000);

    if (os.platform() !== "win32") {
      console.log("Skipping: Windows is required to run BDS.");
      this.skip();
      return;
    }

    env = await TestPaths.createTestEnvironment({ isLocalNode: true });
    await env.localEnv.load();

    if (!env.localEnv.iAgreeToTheMinecraftEndUserLicenseAgreementAndPrivacyStatementAtMinecraftDotNetSlashEula) {
      if (process.env.MCTOOLS_I_ACCEPT_EULA_AT_MINECRAFTDOTNETSLASHEULA?.toLowerCase() === "true") {
        env.localEnv.iAgreeToTheMinecraftEndUserLicenseAgreementAndPrivacyStatementAtMinecraftDotNetSlashEula = true;
      } else {
        console.log("Skipping: Minecraft EULA not accepted (run `mct eula --accept`).");
        this.skip();
        return;
      }
    }

    fs.rmSync(RESULTS_DIR, { recursive: true, force: true });
    fs.mkdirSync(RESULTS_DIR, { recursive: true });

    sm = new ServerManager(env.localEnv, env.creatorTools);
    sm.features = ServerManagerFeatures.dedicatedServerOnly;

    atStage("provisioning");
    console.log("      Provisioning BDS (downloads on first run; this can take a few minutes)...");
    server = await sm.ensureActiveServer(0, undefined);

    if (!server) {
      throw stageFailure("could not provision a dedicated server instance");
    }

    // This suite drives the raw protocol client itself; the managed
    // DedicatedServer debugger flow must not compete for the session.
    server.debuggerEnabled = false;

    watchServerOutput(server);

    // The task-mandated settings step: inbound script debugging enabled,
    // persisted in server.properties (outbound stays enabled for the
    // required outbound handshake leg).
    atStage("settings");
    setServerProperty(server, "allow-inbound-script-debugging", "true");
    setServerProperty(server, "allow-outbound-script-debugging", "true");

    provisionProbePack(server);

    console.log(`      BDS provisioned (slot 0, base port ${server.port ?? 19132}).`);
  });

  afterEach(async function () {
    this.timeout(120000);

    // A failed stage must not leave BDS running and poison the next phase.
    if (server && server.status !== DedicatedServerStatus.stopped) {
      try {
        await server.stopServer();
        await waitForStatus(server, DedicatedServerStatus.stopped, STOP_TIMEOUT_MS);
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
        await waitForStatus(server, DedicatedServerStatus.stopped, STOP_TIMEOUT_MS);
      } catch (e) {
        console.log(`      Cleanup stop failed: ${e}`);
      }
    }

    if (sm) {
      await sm.shutdown("protocol handshake suite complete");
    }
  });

  it("confirms inbound listener readiness on a collision-free port, then records the inbound dial verdict", async function () {
    const srv = server!;

    await startServerAtStage(srv, "serverStart");

    assert.isDefined(observedBdsVersion, "the BDS version line should have been parsed from startup output");
    results.bdsVersion = observedBdsVersion;
    console.log(`      [handshake] BDS build: ${observedBdsVersion}`);

    // Collision-free dynamic port, then the listener command.
    atStage("listenerStart");
    const reservation = await reservePort(srv);

    try {
      const readiness = waitForServerLine(
        srv,
        /Debugger listening/i,
        LISTENER_READY_TIMEOUT_MS,
        `the 'Debugger listening' confirmation for port ${reservation.port}`
      );

      await srv.runCommand(`script debugger listen ${reservation.port}`);

      atStage("listenerReadiness");
      const confirmation = await readiness;
      results.listenerReadinessConfirmed = true;
      console.log(`      [handshake] listener confirmed: ${sanitizeDebuggerDiagnosticText(confirmation).trim()}`);

      // Inbound dial. On current BDS builds the inbound listener FLAPS
      // (torn down and re-armed every few ticks), so the dial sees
      // accept-then-reset or refused - that documented finding is a valid,
      // recorded verdict. A working inbound session (future BDS) is the
      // other valid verdict. Anything else fails.
      atStage("inboundDial");
      const client = new MinecraftDebugClient();
      const { observation, connectedOrDropped } = observeSession(client, SESSION_EVENT_TIMEOUT_MS, "inbound session");

      let dialError: Error | undefined;

      try {
        await client.connect("localhost", reservation.port);
      } catch (e) {
        dialError = e as Error;
      }

      if (dialError === undefined) {
        const outcome = await connectedOrDropped;

        if (outcome === "connected") {
          results.inboundVerdict = `connected (protocol v${observation.session!.protocolVersion})`;
        } else {
          // Accepted then dropped before the handshake completed - the
          // reset half of the documented flap.
          const kind = classifyDebugClientDisconnectReason(observation.disconnectReason ?? "");
          assert.include(
            [DebuggerFailureKind.prematureClose, DebuggerFailureKind.tcpConnect, DebuggerFailureKind.handshakeTimeout],
            kind,
            `[stage=${currentStage}] an inbound drop must classify as the documented flap, got '${kind}' ` +
              `(reason: ${sanitizeDebuggerDiagnosticText(observation.disconnectReason ?? "none")})`
          );
          results.inboundVerdict = `listener flap: accepted then dropped (${kind})`;
        }
      } else {
        const message = sanitizeDebuggerDiagnosticText(dialError.message);
        const kind = classifyDebugClientDisconnectReason(dialError.message);

        assert.include(
          [DebuggerFailureKind.tcpConnect, DebuggerFailureKind.prematureClose, DebuggerFailureKind.handshakeTimeout],
          kind,
          `[stage=${currentStage}] the inbound dial failure must be the documented flap signature, got '${kind}': ${message}`
        );

        results.inboundVerdict = `listener flap: dial failed (${kind}: ${message.substring(0, 120)})`;
      }

      client.disconnect();
      console.log(`      [handshake] inbound verdict: ${results.inboundVerdict}`);

      // Tear the BDS-side listener down before the outbound phases.
      await srv.runCommand("script debugger close");
    } finally {
      DebugPortRegistry.release(reservation);
    }

    await stopServerAtStage(srv, "cleanup");
  });

  it("completes the REQUIRED outbound handshake: negotiation, module selection (auto and requested), resume, streaming", async function () {
    const srv = server!;

    await startServerAtStage(srv, "serverStart");

    // Session A - auto-selection: with the probe pack as the only module,
    // the client must select "the only available module" and stats must
    // stream after resume. This also captures the module UUID EXACTLY as
    // Minecraft offers it (its casing/format is Minecraft's, not ours).
    atStage("outboundHandshake");
    const auto = await establishOutboundSession(srv, undefined, "auto-select outbound session");

    assert.equal(
      auto.outcome,
      "connected",
      `[stage=${currentStage}] the outbound handshake must complete; ` +
        `disconnect reason: ${sanitizeDebuggerDiagnosticText(auto.observation.disconnectReason ?? "none")}`
    );

    const autoSession = auto.observation.session!;

    atStage("negotiation");
    assert.isAtLeast(
      autoSession.protocolVersion,
      ProtocolVersion.SupportDebuggerRequests,
      "the negotiated protocol version should be v7+ on current BDS"
    );
    assert.isAtMost(autoSession.protocolVersion, ProtocolVersion.SupportEmptyTabs, "negotiation must never exceed v10");
    results.negotiatedProtocolVersion = autoSession.protocolVersion;
    console.log(
      `      [handshake] negotiated protocol v${autoSession.protocolVersion} against BDS ${results.bdsVersion} ` +
        `(client max v${results.clientMaxProtocolVersion})`
    );

    atStage("targetSelection");
    assert.isAtLeast(autoSession.plugins.length, 1, "Minecraft should offer the probe pack's script module");
    const offeredUuid = autoSession.plugins[0].module_uuid;
    assert.equal(
      autoSession.targetModuleUuid,
      offeredUuid,
      "auto-selection must pick the only module Minecraft offered"
    );
    assert.equal(
      offeredUuid.toLowerCase().replace(/[{}]/g, ""),
      PROBE_PACK_MODULE_UUID,
      "the offered module must be the probe pack's script module"
    );

    // resume was sent as part of the handshake; streamed stats are the
    // observable proof it took effect and the connected state is valid.
    atStage("resume");
    await waitForObservation(() => auto.observation.sawStats, STATS_TIMEOUT_MS, "stat streaming after resume");
    results.statStreamingObserved = true;
    results.outboundHandshake = "connected";

    auto.observation.client.disconnect();

    // Session B - REQUESTED selection: request the module UUID exactly as
    // Minecraft offered it and prove the requested target is honored on a
    // fresh session, again with streamed stats as the validity proof.
    atStage("requestedModuleSelection");
    const requested = await establishOutboundSession(srv, offeredUuid, "requested-module outbound session");

    assert.equal(
      requested.outcome,
      "connected",
      `[stage=${currentStage}] the requested-module handshake must complete; ` +
        `disconnect reason: ${sanitizeDebuggerDiagnosticText(requested.observation.disconnectReason ?? "none")}`
    );
    assert.equal(
      requested.observation.session!.targetModuleUuid,
      offeredUuid,
      "the REQUESTED module UUID must be the selected target"
    );

    await waitForObservation(
      () => requested.observation.sawStats,
      STATS_TIMEOUT_MS,
      "stat streaming on the requested-module session"
    );
    results.requestedModuleSelected = true;

    // Premature close distinctness: stop the server mid-session and demand
    // the drop classifies as prematureClose.
    atStage("prematureClose");
    const dropped = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(stageFailure("the session did not observe the server stopping")),
        STOP_TIMEOUT_MS
      );

      requested.observation.client.onDisconnected.subscribe((_c, reason) => {
        clearTimeout(timer);
        resolve(reason);
      });
    });

    await stopServerAtStage(srv, "prematureClose");

    const dropReason = await dropped;
    const dropKind = classifyDebugClientDisconnectReason(dropReason);
    assert.equal(
      dropKind,
      DebuggerFailureKind.prematureClose,
      `a mid-session server stop must classify as prematureClose, got '${dropKind}'`
    );
    results.prematureCloseVerdict = `distinct (${dropKind})`;

    requested.observation.client.disconnect();
  });

  it("produces a DISTINCT failure for an invalid requested module UUID", async function () {
    const srv = server!;

    await startServerAtStage(srv, "serverStart");

    atStage("invalidModuleUuid");
    const { observation, outcome } = await establishOutboundSession(srv, BOGUS_MODULE_UUID, "bogus-module session");

    // The client validates the requested UUID against the plugin list BDS
    // offers in its ProtocolEvent and rejects BEFORE entering Connected
    // (mirroring the official debugger). Against real BDS the only valid
    // outcome is therefore a handshake-stage drop with the production
    // moduleSelection reason - never a connected session for a target the
    // server never offered.
    assert.equal(outcome, "dropped", "an unoffered target must never produce a connected session");
    assert.include(
      observation.disconnectReason ?? "",
      "was not offered by Minecraft",
      "the drop must carry the production not-offered reason"
    );

    const kind = classifyDebugClientDisconnectReason(observation.disconnectReason ?? "");
    assert.equal(kind, DebuggerFailureKind.moduleSelection, `expected moduleSelection, got '${kind}'`);

    results.invalidModuleVerdict = `rejected at handshake (${kind})`;
    console.log(`      [handshake] invalid-module verdict: ${results.invalidModuleVerdict}`);

    observation.client.disconnect();
    await stopServerAtStage(srv, "cleanup");
  });

  it("produces a DISTINCT failure when no script module exists (missing module)", async function () {
    const srv = server!;

    atStage("missingModuleSetup");
    removeAllScriptPacks(srv);

    try {
      await startServerAtStage(srv, "serverStart");

      atStage("missingModule");
      const { observation, outcome } = await establishOutboundSession(srv, undefined, "module-less session");

      if (outcome === "connected") {
        const session = observation.session!;

        assert.equal(session.plugins.length, 0, "Minecraft should offer no modules with all packs removed");
        assert.isUndefined(session.targetModuleUuid, "no target can be selected with no modules offered");

        // Observed live (Task 1669105 gate): BDS closes module-less sessions
        // right after the handshake. Demand the drop and its distinct
        // context: plugins=0 distinguishes missing-module from every other
        // premature close.
        await waitForObservation(
          () => observation.disconnectReason !== undefined,
          SESSION_EVENT_TIMEOUT_MS,
          "the post-handshake drop of a module-less session"
        );

        results.missingModuleVerdict = `connected with 0 modules, then dropped (${classifyDebugClientDisconnectReason(
          observation.disconnectReason!
        )})`;
      } else {
        results.missingModuleVerdict = `dropped at handshake (${classifyDebugClientDisconnectReason(
          observation.disconnectReason ?? "Socket closed"
        )})`;
      }

      console.log(`      [handshake] missing-module verdict: ${results.missingModuleVerdict}`);

      observation.client.disconnect();
      await stopServerAtStage(srv, "cleanup");
    } finally {
      // Restore the probe pack for any later suite runs against this slot.
      provisionProbePack(srv);
    }
  });

  it("records the handshake results artifact with privacy-safe content", function () {
    // The REQUIRED across-the-wire path must actually have run - a suite
    // where the outbound handshake did not complete cannot pass.
    assert.equal(results.outboundHandshake, "connected", "the outbound handshake must have completed");
    assert.equal(results.listenerReadinessConfirmed, true, "listener readiness must have been confirmed");
    assert.isDefined(results.bdsVersion, "the BDS build must have been recorded");
    assert.isDefined(results.negotiatedProtocolVersion, "the negotiated protocol must have been recorded");
    assert.isDefined(results.inboundVerdict, "the inbound dial verdict must have been recorded");
    assert.isDefined(results.invalidModuleVerdict, "the invalid-module verdict must have been recorded");
    assert.isDefined(results.missingModuleVerdict, "the missing-module verdict must have been recorded");
    assert.isDefined(results.prematureCloseVerdict, "the premature-close verdict must have been recorded");

    const artifact = {
      generatedAt: new Date().toISOString(),
      ...results,
      recentDebuggerLines: serverLines.slice(-20),
    };

    const serialized = JSON.stringify(artifact, undefined, 2);

    // Privacy gate on the artifact itself.
    assert.notInclude(serialized, os.homedir().replace(/\\/g, "\\\\"), "no home directory in the artifact");
    assert.notInclude(serialized, os.userInfo().username, "no username in the artifact");
    assert.isFalse(/[A-Za-z]:[\\/]/.test(serialized), "no absolute filesystem paths in the artifact");
    assert.equal(
      sanitizeDebuggerDiagnosticText(serialized),
      serialized,
      "the artifact must be sanitizer-stable (nothing left to redact)"
    );

    fs.writeFileSync(RESULTS_PATH, serialized);
    console.log(`      [handshake] results artifact written to ${RESULTS_PATH}`);
    console.log(
      `      [handshake] SUMMARY: BDS ${results.bdsVersion}, negotiated v${results.negotiatedProtocolVersion}, ` +
        `inbound='${results.inboundVerdict}', outbound='${results.outboundHandshake}'`
    );
  });
});
