// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * ProcessHostedProxyMinecraftTest.ts
 *
 * Tests for the renderer-side proxy's error contracts: start() rejects on an
 * "<error>" completion payload, and the wrappers around it (prepareAndStart,
 * initialize) must translate that rejection into the established
 * IPrepareAndStartResult error result / error state instead of letting it
 * propagate as an unhandled renderer rejection.
 *
 * Also covers the renderer debug IPC wiring the Electron gate
 * (DebuggerRealBdsGate.spec.ts) deliberately does NOT exercise: raw appsvc
 * wire strings through AppServiceProxy's dispatch and CreatorTools' routing
 * into this proxy's typed debug events, and AppServiceProxy's outbound
 * async command formatting / positional completion matching.
 */

import { expect } from "chai";
import { EventDispatcher } from "ste-events";
import ProcessHostedMinecraft from "../clientapp/ProcessHostedProxyMinecraft";
import { CreatorToolsMinecraftState } from "../app/CreatorTools";
import { PrepareAndStartResultType } from "../app/IMinecraft";
import AppServiceProxy from "../core/AppServiceProxy";
import TestPaths from "./TestPaths";

describe("ProcessHostedProxyMinecraft", function () {
  // The real constructor immediately issues an IPC status query, which is
  // unavailable outside Electron - build a prototype-based instance with just
  // the state the tested paths touch.
  function createProxy(): ProcessHostedMinecraft {
    const mc = Object.create(ProcessHostedMinecraft.prototype) as ProcessHostedMinecraft;

    mc.state = CreatorToolsMinecraftState.none;
    (mc as any)._project = undefined;
    (mc as any)._onStateChanged = new EventDispatcher();
    (mc as any)._onRefreshed = new EventDispatcher();

    return mc;
  }

  it("prepareAndStart translates a start() rejection into the error result contract", async function () {
    // Callers like MinecraftDisplay._startClick() consume
    // { type: error, errorMessage } - a rejection would bypass that contract
    // and surface as an unhandled renderer rejection with no visible message.
    const mc = createProxy();

    (mc as any).start = async () => {
      throw new Error("Server executable not found at [path]bedrock_server.exe");
    };

    const result = await mc.prepareAndStart({} as any);

    expect(result.type).to.equal(PrepareAndStartResultType.error);
    expect(result.errorMessage).to.include("Server executable not found");
    expect(mc.state, "the proxy must land on the error state").to.equal(CreatorToolsMinecraftState.error);
  });

  it("prepareAndStart returns the started result when start() succeeds", async function () {
    const mc = createProxy();

    (mc as any).start = async () => {};

    const result = await mc.prepareAndStart({} as any);

    expect(result.type).to.equal(PrepareAndStartResultType.started);
    expect(result.errorMessage).to.be.undefined;
  });

  it("initialize resolves (never rejects) when start() fails", async function () {
    // initialize() has no result contract and its callers
    // (CreatorTools.connectToMinecraft) do not catch; the error state set by
    // start() is the established signal.
    const mc = createProxy();

    (mc as any).start = async () => {
      mc.notifyStateChanged(CreatorToolsMinecraftState.error);
      throw new Error("Could not create a server.");
    };

    await mc.initialize();

    expect(mc.state).to.equal(CreatorToolsMinecraftState.error);
  });
});

describe("Renderer debug IPC wiring (appsvc wire format -> typed events)", function () {
  /**
   * The real-BDS Electron gate proves preload -> main process -> BDS across
   * the wire, but drives raw IPC - so the renderer production stack never
   * sees its traffic. These tests pin that stack with the SAME wire shapes
   * the gate records: AppServiceProxy._handleNewMessage splitting,
   * CreatorTools' default-route into processHostedMinecraft, and this
   * proxy's JSON parsing into the typed events DebugStatsPanel subscribes
   * to (panel DOM rendering itself is covered by the ServerUI Playwright
   * suite).
   */

  const sent: { channel: string; command: string; data: unknown }[] = [];
  let originalApi: unknown;

  before(function () {
    originalApi = (AppServiceProxy as any)._api;

    // A fake preload bridge: records outbound sends; inbound delivery is
    // driven directly through _handleNewMessage below.
    (AppServiceProxy as any)._api = {
      send: (channel: string, command: string, data: unknown) => {
        sent.push({ channel, command, data });
      },
      receive: () => {},
    };
  });

  after(function () {
    (AppServiceProxy as any)._api = originalApi;

    // Re-run init with the bridge removed: init() registered an AppLogger
    // with Log while the fake bridge was installed (createTestEnvironment
    // runs CreatorToolsHost.init -> AppServiceProxy.init), and only another
    // init() pass unregisters it. Without this, every later Log call in the
    // same mocha process routes into AppServiceProxy.send and throws
    // "Not an Electron API".
    AppServiceProxy.init();
  });

  const deliver = (raw: string) => (AppServiceProxy as any)._handleNewMessage(raw);

  it("sendAsync formats commands as async<name>|<position> and resolves on the positional completion", async function () {
    const promise = AppServiceProxy.sendAsync("getDebugStatus", "");

    const last = sent[sent.length - 1];
    expect(last.channel).to.equal("appweb");
    expect(last.command, "the wire format the preload/main handler parses").to.match(/^asyncgetDebugStatus\|\d+$/);

    const position = last.command.substring(last.command.indexOf("|") + 1);
    deliver(`asyncgetDebugStatusComplete|${position}|{"stage":"connected"}`);

    expect(await promise).to.equal('{"stage":"connected"}');
  });

  it("a completion this proxy did not originate is ignored, not thrown on", function () {
    // The gate sends its own requests over the shared appsvc channel with
    // ids far above any position this proxy allocates; their completions
    // must neither resolve a pending request nor abort the dispatch.
    deliver('asyncgetDedicatedServerStatusComplete|900123|"-1"');
  });

  it("raw appsvc debug notifications reach the proxy's typed events through the production dispatch chain", async function () {
    const env = await TestPaths.createTestEnvironment();
    const mc = new ProcessHostedMinecraft(env.creatorTools);

    // The production wiring: CreatorTools' appsvc handler routes unknown
    // commands to its processHostedMinecraft.
    env.creatorTools.processHostedMinecraft = mc;

    const stats: { tick: number }[] = [];
    const stages: { stage: string; debugPort?: number }[] = [];
    const connects: { protocolVersion: number }[] = [];

    mc.onDebugStats.subscribe((_s, body) => stats.push(body));
    mc.onDebugStage.subscribe((_s, body) => stages.push(body));
    mc.onDebugConnected.subscribe((_s, body) => connects.push(body));

    // The exact wire shapes the main process emits (and the gate records).
    deliver(
      'dedicatedServerDebugStats|{"eventName":"debugStats","tick":4242,"stats":[{"name":"server_tick","values":[1]}]}'
    );
    deliver(
      'dedicatedServerDebugStage|{"eventName":"debugStage","stage":"connected","debugPort":19144}'
    );
    deliver('dedicatedServerDebugConnected|{"eventName":"debugConnected","protocolVersion":10}');

    expect(stats, "the stats notification must arrive as a typed onDebugStats event").to.have.length(1);
    expect(stats[0].tick).to.equal(4242);
    expect(stages).to.have.length(1);
    expect(stages[0].stage).to.equal("connected");
    expect(stages[0].debugPort).to.equal(19144);
    expect(connects).to.have.length(1);
    expect(connects[0].protocolVersion).to.equal(10);

    // Malformed notification JSON is contained: no throw, no event.
    deliver("dedicatedServerDebugStats|this is not json");
    expect(stats).to.have.length(1);

    env.creatorTools.processHostedMinecraft = undefined;
  });
});
