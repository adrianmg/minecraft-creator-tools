// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * DedicatedServerCommandHandlerTest.ts
 *
 * Tests for the Electron-main dedicated server IPC command handler,
 * focusing on the shared-start concurrency contract: duplicate Start
 * requests must join the in-flight startup and receive its REAL outcome -
 * never an early success-shaped completion while the shared start is still
 * provisioning. EVERY joined request must be settled on failure too, with an
 * "<error>" completion payload: sendAsync resolves only on the completion
 * message (an ipcRenderer.invoke rejection is not wired to its rejecter), so
 * an unanswered request leaves the renderer's start() pending forever.
 */

import { expect } from "chai";
import { DedicatedServerCommandHandler } from "../electron/DedicatedServerCommandHandler";
import DedicatedServer, { DedicatedServerStatus } from "../local/DedicatedServer";
import ServerManager from "../local/ServerManager";
import NodeStorage from "../local/NodeStorage";
import { DebuggerFailureKind, DebuggerLifecycleStage } from "../debugger/DebuggerLifecycle";
import TestPaths, { ITestEnvironment } from "./TestPaths";
import Utilities from "../core/Utilities";
import * as fs from "fs";
import * as path from "path";

describe("DedicatedServerCommandHandler", function () {
  this.timeout(30000);

  interface ITestHarness {
    handler: DedicatedServerCommandHandler;
    events: string[];
    completions: () => string[];
  }

  async function createHarness(): Promise<ITestHarness> {
    const env: ITestEnvironment = await TestPaths.createTestEnvironment();

    const events: string[] = [];
    const fakeWindow = {
      webContents: {
        send: (_channel: string, message: string) => {
          events.push(message);
        },
      },
    };
    const fakeIpcMain = { handle: () => {} };

    const handler = new DedicatedServerCommandHandler(
      fakeWindow as any,
      fakeIpcMain as any,
      env.localEnv,
      env.creatorTools,
      {} as any
    );

    return {
      handler: handler,
      events: events,
      completions: () => events.filter((m) => m.startsWith("asyncdedicatedServerStartComplete")),
    };
  }

  describe("late-mount debug status snapshot", function () {
    /**
     * Live dedicatedServerDebugStage IPC events only cover transitions after
     * a renderer subscribes, and DebugStatsPanel is mounted only while the
     * Stats tab is open. getDebugStatus therefore exposes the CURRENT
     * lifecycle snapshot so a late-mounting panel can hydrate. This emits a
     * terminal failure BEFORE any subscriber exists and verifies the
     * snapshot carries the failed stage, failure kind, sanitized message,
     * and dynamic debug port - the inputs the panel's error display and
     * Retry / Copy Diagnostics / Stop recovery actions derive from.
     */
    it("returns the terminal failure that happened before any panel mounted", async function () {
      const harness = await createHarness();

      const env: ITestEnvironment = await TestPaths.createTestEnvironment();
      const dsm = new ServerManager(env.localEnv, env.creatorTools);
      const server = new DedicatedServer("late-stage-test", dsm, env.localEnv, "late-stage-path", env.resultsFolder);
      server.port = 19880 - 12; // debugPort = base port + 12 = 19880

      (harness.handler as any)._dsm.getActiveServer = () => server;

      // The flow settles terminally while NO renderer/panel is subscribed -
      // the live stage event fires into the void.
      server.debuggerLifecycle.fail(
        DebuggerFailureKind.listenerReadiness,
        "BDS did not confirm 'Debugger listening' on port 19880 within 15s."
      );

      // A panel mounting NOW hydrates via getDebugStatus.
      await harness.handler.getDebugStatus({} as any, "req-status-1|");

      const statusMessages = harness.events.filter((m) => m.startsWith("asyncgetDebugStatusComplete|req-status-1|"));
      expect(statusMessages.length).to.equal(1);

      const payload = JSON.parse(
        statusMessages[0].substring("asyncgetDebugStatusComplete|req-status-1|".length)
      ) as {
        eventName: string;
        stage: string;
        failureKind: string;
        message?: string;
        debugPort?: number;
      };

      expect(payload.eventName).to.equal("debugStage");
      expect(payload.stage, "the pre-mount terminal failure must be visible").to.equal(DebuggerLifecycleStage.failed);
      expect(payload.failureKind).to.equal(DebuggerFailureKind.listenerReadiness);
      expect(payload.message).to.include("did not confirm");
      expect(payload.debugPort).to.equal(19880);
    });

    it("returns an empty snapshot when no server exists", async function () {
      const harness = await createHarness();

      (harness.handler as any)._dsm.getActiveServer = () => undefined;

      await harness.handler.getDebugStatus({} as any, "req-status-2|");

      const statusMessages = harness.events.filter((m) => m.startsWith("asyncgetDebugStatusComplete|req-status-2|"));
      expect(statusMessages.length).to.equal(1);
      expect(statusMessages[0]).to.equal("asyncgetDebugStatusComplete|req-status-2|");
    });
  });

  describe("debug retry completion contract", function () {
    /**
     * sendAsync resolves only from the asyncdebugRetryConnectionComplete
     * message - an ipcRenderer.invoke rejection is not wired to its
     * rejecter - so a throwing retryDebugConnection() (e.g., the listener
     * command hitting a broken BDS stdin) must still settle the request.
     * Failures settle with an "<error>" payload the renderer-side
     * debugRetryConnection() turns into a rejection, matching startServer.
     */
    it("settles with an <error> payload when the retry throws", async function () {
      const harness = await createHarness();

      (harness.handler as any)._dsm.getActiveServer = () => ({
        retryDebugConnection: async () => {
          throw new Error("write EPIPE");
        },
      });

      await harness.handler.debugRetryConnection({} as any, "req-retry-1|");

      const messages = harness.events.filter((m) => m.startsWith("asyncdebugRetryConnectionComplete|req-retry-1|"));
      expect(messages.length, "the request must be settled even when the retry throws").to.equal(1);
      expect(messages[0]).to.equal("asyncdebugRetryConnectionComplete|req-retry-1|<error>write EPIPE");
    });

    it("settles with 1/0 on the non-throwing paths", async function () {
      const harness = await createHarness();

      (harness.handler as any)._dsm.getActiveServer = () => ({
        retryDebugConnection: async () => true,
      });
      await harness.handler.debugRetryConnection({} as any, "req-retry-2|");

      (harness.handler as any)._dsm.getActiveServer = () => undefined;
      await harness.handler.debugRetryConnection({} as any, "req-retry-3|");

      expect(harness.events).to.include("asyncdebugRetryConnectionComplete|req-retry-2|1");
      expect(harness.events).to.include("asyncdebugRetryConnectionComplete|req-retry-3|0");
    });
  });

  describe("concurrent start requests", function () {
    // Minimal onServerError stand-in for server stubs - the handler
    // subscribes to it around startServer() to capture the preflight
    // failure reason.
    function stubServerErrorEvent() {
      return { subscribe: () => {}, unsubscribe: () => {} };
    }

    it("neither request completes before the shared startup settles, then both complete", async function () {
      const harness = await createHarness();

      let releaseStart!: () => void;
      const startGate = new Promise<void>((resolve) => (releaseStart = resolve));
      let provisionCalls = 0;

      (harness.handler as any)._dsm.ensureActiveServer = async () => {
        provisionCalls++;
        return {
          onServerError: stubServerErrorEvent(),
          startServer: async () => {
            await startGate;
            return true;
          },
        };
      };

      // Two Start actions while the underlying startup is still running.
      const first = harness.handler.startServer({} as any, "req-1|not-json");
      const second = harness.handler.startServer({} as any, "req-2|not-json");

      await Utilities.sleep(250);

      expect(
        harness.completions(),
        "no request may receive a completion while the shared start is still provisioning/starting"
      ).to.deep.equal([]);

      releaseStart();
      await Promise.all([first, second]);

      expect(harness.completions().sort(), "each request must receive its own completion after settle").to.deep.equal([
        "asyncdedicatedServerStartComplete|req-1|",
        "asyncdedicatedServerStartComplete|req-2|",
      ]);
      expect(provisionCalls, "only one provisioning/start flow may run").to.equal(1);
    });

    it("a failing shared startup settles every awaiting request with a failure completion", async function () {
      const harness = await createHarness();

      (harness.handler as any)._dsm.ensureActiveServer = async () => ({
        onServerError: stubServerErrorEvent(),
        startServer: async () => {
          await Utilities.sleep(300);
          throw new Error("bedrock_server executable missing");
        },
      });

      const first = harness.handler.startServer({} as any, "req-3|not-json");
      const second = harness.handler.startServer({} as any, "req-4|not-json");

      await Utilities.sleep(100);
      expect(harness.completions(), "no completion may be sent before the shared start settles").to.deep.equal([]);

      await Promise.all([first, second]);

      expect(
        harness.completions().sort(),
        "every joined request must settle with a failure completion - an unanswered request leaves the renderer's start() pending forever"
      ).to.deep.equal([
        "asyncdedicatedServerStartComplete|req-3|<error>bedrock_server executable missing",
        "asyncdedicatedServerStartComplete|req-4|<error>bedrock_server executable missing",
      ]);

      // The shared promise must be released after failure so a later,
      // healthy Start can run and complete normally.
      (harness.handler as any)._dsm.ensureActiveServer = async () => ({
        onServerError: stubServerErrorEvent(),
        startServer: async () => true,
      });

      await harness.handler.startServer({} as any, "req-5|not-json");

      expect(harness.completions()).to.include("asyncdedicatedServerStartComplete|req-5|");
    });

    it("settles requests with a failure completion when no server could be created", async function () {
      const harness = await createHarness();

      (harness.handler as any)._dsm.ensureActiveServer = async () => {
        await Utilities.sleep(150);
        return undefined;
      };

      const first = harness.handler.startServer({} as any, "req-6|not-json");
      const second = harness.handler.startServer({} as any, "req-7|not-json");

      await Promise.all([first, second]);

      expect(harness.completions().sort(), "both requests must settle with the failure").to.deep.equal([
        "asyncdedicatedServerStartComplete|req-6|<error>Could not create a server.",
        "asyncdedicatedServerStartComplete|req-7|<error>Could not create a server.",
      ]);
      expect(
        harness.events.filter((m) => m.startsWith("dedicatedServerError")).length,
        "the shared failure is reported once, not once per joined request"
      ).to.equal(1);
    });

    it("a real missing-executable preflight failure settles as failure, not success", async function () {
      // DedicatedServer.startServer() returns NORMALLY on preflight failures
      // (missing executable, invalid signature, wrong signer) after setting
      // status = stopped - a resolved call is not a successful startup. This
      // drives the real missing-executable path end to end through the
      // handler: the request must settle with a failure completion, never a
      // success-shaped one that lets the renderer proceed as though a
      // process exists.
      const harness = await createHarness();

      const env: ITestEnvironment = await TestPaths.createTestEnvironment();
      const dsm = new ServerManager(env.localEnv, env.creatorTools);
      const serverPath =
        path.resolve(env.resultsFolder.fullPath, "handler-preflight-missing-exe") + NodeStorage.platformFolderDelimiter;
      fs.mkdirSync(serverPath, { recursive: true });
      const server = new DedicatedServer(
        "handler-preflight-missing-exe",
        dsm,
        env.localEnv,
        serverPath,
        env.resultsFolder
      );

      (harness.handler as any)._dsm.ensureActiveServer = async () => server;

      await harness.handler.startServer({} as any, "req-8|not-json");

      expect(server.status).to.equal(DedicatedServerStatus.stopped);

      const completions = harness.completions();
      expect(completions.length).to.equal(1);
      expect(completions[0]).to.include("asyncdedicatedServerStartComplete|req-8|<error>");
      expect(
        completions[0],
        "the completion must carry the actual preflight reason, not a pointer to a message that was never sent"
      ).to.include("Server executable not found");
    });

    it("forwards manager-bubbled server errors to the renderer", async function () {
      // The startup failure completion refers to the dedicatedServerError
      // broadcast. Without this constructor subscription, the only
      // dedicatedServerError ever sent was the hardcoded no-server case, so
      // preflight failures never delivered their detailed reason.
      const harness = await createHarness();

      ((harness.handler as any)._dsm as any).bubbleServerError(
        {} as any,
        "Server executable not found at [path]bedrock_server.exe"
      );

      expect(harness.events).to.include(
        "dedicatedServerError|Server executable not found at [path]bedrock_server.exe"
      );
    });
  });
});
