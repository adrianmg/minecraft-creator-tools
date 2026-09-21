// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { expect } from "chai";
import "./debugStatsPanelSpecSetup";
import DebugStatsPanel from "./DebugStatsPanel";

// Regression coverage for HttpStorage's INTERNAL WebSocket replacement.
// HttpStorage swaps its mutable webSocket on auto-reconnect without any prop
// changing, so componentDidUpdate's prop-visible reset path never runs; the
// _trySubscribe interval is the only place that can observe the swap. A
// replacement is a new debugger notification session, and the connected
// hydration only overwrites the schema when the snapshot carries one — so if
// the replacement path does not reset session-scoped state, a reconnect to a
// schema-less (or pre-v9) session keeps the PREVIOUS session's tabs and stat
// values on screen indefinitely.
//
// The same hazard exists for prop-visible source changes that socket
// inequality does not cover: a slot change over one shared transport, and a
// storage swap while neither storage has a socket yet (undefined === undefined
// skips the WebSocket-comparison reset path). componentDidUpdate must treat
// slot and storage identity as part of the source identity.
//
// These specs drive a real DebugStatsPanel instance through its actual private
// lifecycle methods (the same pattern as GridEditor.spec.ts) instead of a DOM
// render: setState is patched to apply synchronously, and the "mount" performs
// exactly the WebSocket-mode steps componentDidMount performs, minus the
// intervals (the specs call _trySubscribe directly, as the interval would).

interface IFakeSocket {
  listeners: string[];
  addEventListener(type: string): void;
  removeEventListener(type: string): void;
}

function fakeSocket(): IFakeSocket {
  const socket: IFakeSocket = {
    listeners: [],
    addEventListener(type: string) {
      socket.listeners.push(type);
    },
    removeEventListener(type: string) {
      const index = socket.listeners.indexOf(type);
      if (index >= 0) {
        socket.listeners.splice(index, 1);
      }
    },
  };
  return socket;
}

const VALID_DESCRIPTOR = {
  name: "Server Timing",
  stat_group_id: "server_tick_timings",
  data_source: "server",
  display_type: "line_chart",
};

function connectedSlotConfig(withSchema: boolean) {
  return {
    debugConnectionState: "connected",
    debugProtocolVersion: withSchema ? 10 : 8,
    debugOwnership: "attachedByMct",
    debuggerEnabled: true,
    debuggerStreamingEnabled: true,
    debugSchema: withSchema ? [VALID_DESCRIPTOR] : undefined,
  };
}

interface IHarness {
  panel: any;
  storage: any;
  flush(): Promise<void>;
}

function createMountedPanel(initialSocket: IFakeSocket): IHarness {
  const storage: any = {
    webSocket: initialSocket,
    isConnected: true,
    subscribe: () => {},
    fetchApi: async () => ({ ok: false }),
  };

  const panel: any = new (DebugStatsPanel as any)({ theme: {}, slot: 0, storage: storage });

  // Outside a React renderer setState is a no-op; apply updates synchronously
  // so the specs can assert on state. Supports both object and functional
  // updater forms (the connected hydration uses the functional form).
  panel.setState = (updater: any, callback?: () => void) => {
    const partial = typeof updater === "function" ? updater(panel.state, panel.props) : updater;
    panel.state = { ...panel.state, ...partial };
    if (callback) {
      callback();
    }
  };

  // The WebSocket-mode portion of componentDidMount, minus the intervals.
  panel._hydrationGate.setSource(storage);
  panel._setupWebSocket();
  panel._trySubscribe();

  return {
    panel: panel,
    storage: storage,
    flush: () => new Promise<void>((resolve) => setTimeout(resolve, 10)),
  };
}

describe("DebugStatsPanel session source changes", () => {
  it("resets session state and does not resurrect the old schema when the new session has none", async () => {
    const socketA = fakeSocket();
    const harness = createMountedPanel(socketA);

    // Session 1: hydrates connected WITH a schema, then receives stats.
    harness.storage.fetchApi = async () => ({
      ok: true,
      json: async () => ({ slotConfig: connectedSlotConfig(true) }),
    });
    harness.panel._fetchInitialDebugStatus();
    await harness.flush();

    harness.panel._handleDebugStats({
      eventName: "debugStats",
      slot: 0,
      tick: 120,
      stats: [{ name: "server_tick_timings.tick", value: 5 }],
    });

    expect(harness.panel.state.connectionStatus).to.equal("connected");
    expect(harness.panel.state.schema?.tabs.length).to.equal(1);
    expect(harness.panel.state.hasReceivedStats).to.equal(true);
    expect(harness.panel.state.stats.length).to.equal(1);

    // HttpStorage auto-reconnects: the storage object (and thus the panel's
    // props) is unchanged, but its webSocket is replaced in place. The new
    // session's /status is connected but carries NO schema (pre-v9 target).
    harness.storage.fetchApi = async () => ({
      ok: true,
      json: async () => ({ slotConfig: connectedSlotConfig(false) }),
    });
    const socketB = fakeSocket();
    harness.storage.webSocket = socketB;

    harness.panel._trySubscribe();

    // The replacement must synchronously drop the previous session's rendered
    // state — before the re-hydration response arrives.
    expect(harness.panel.state.schema).to.equal(undefined);
    expect(harness.panel.state.stats.length).to.equal(0);
    expect(harness.panel.state.hasReceivedStats).to.equal(false);
    expect(harness.panel.state.connectionStatus).to.equal("connecting");

    // The listener moved to the replacement socket.
    expect(socketA.listeners.length).to.equal(0);
    expect(socketB.listeners).to.deep.equal(["message"]);

    await harness.flush();

    // The schema-less connected hydration must not bring the old session's
    // tabs or values back.
    expect(harness.panel.state.connectionStatus).to.equal("connected");
    expect(harness.panel.state.schema).to.equal(undefined);
    expect(harness.panel.state.stats.length).to.equal(0);
    expect(harness.panel.state.hasReceivedStats).to.equal(false);
  });

  it("resets and re-hydrates at the new slot when the slot changes on one shared transport", async () => {
    // Regression: componentDidUpdate used to treat only WebSocket inequality
    // as a source change, so switching slots over the SAME socket/storage
    // kept the previous slot's schema, stats, and ownership rendered
    // indefinitely when the new slot had no schema.
    const socketA = fakeSocket();
    const harness = createMountedPanel(socketA);

    // Slot 0: connected WITH a schema, then receives stats.
    harness.storage.fetchApi = async () => ({
      ok: true,
      json: async () => ({ slotConfig: connectedSlotConfig(true) }),
    });
    harness.panel._fetchInitialDebugStatus();
    await harness.flush();

    harness.panel._handleDebugStats({
      eventName: "debugStats",
      slot: 0,
      tick: 120,
      stats: [{ name: "server_tick_timings.tick", value: 5 }],
    });

    expect(harness.panel.state.connectionStatus).to.equal("connected");
    expect(harness.panel.state.schema?.tabs.length).to.equal(1);
    expect(harness.panel.state.stats.length).to.equal(1);

    // Repoint at slot 1 over the same transport. Its session is connected but
    // schema-less (pre-v9 target).
    const fetchedPaths: string[] = [];
    harness.storage.fetchApi = async (path: string) => {
      fetchedPaths.push(path);
      return {
        ok: true,
        json: async () => ({ slotConfig: connectedSlotConfig(false) }),
      };
    };

    const prevProps = harness.panel.props;
    harness.panel.props = { ...prevProps, slot: 1 };
    harness.panel.componentDidUpdate(prevProps);

    // The slot change must synchronously drop slot 0's rendered diagnostics.
    expect(harness.panel.state.schema).to.equal(undefined);
    expect(harness.panel.state.stats.length).to.equal(0);
    expect(harness.panel.state.hasReceivedStats).to.equal(false);
    expect(harness.panel.state.connectionStatus).to.equal("connecting");

    await harness.flush();

    // Re-hydration targeted the NEW slot, and its schema-less connected
    // session must not resurrect slot 0's tabs or values.
    expect(fetchedPaths.some((p) => p.startsWith("/api/1/status"))).to.equal(true);
    expect(harness.panel.state.connectionStatus).to.equal("connected");
    expect(harness.panel.state.schema).to.equal(undefined);
    expect(harness.panel.state.stats.length).to.equal(0);
    expect(harness.panel.state.hasReceivedStats).to.equal(false);
  });

  it("resets and re-sources when the storage changes while neither storage has a socket", async () => {
    // Regression: with both sockets undefined (equal), a storage prop swap
    // used to skip the reset entirely, keeping the old server's diagnostics
    // and leaving the hydration gate sourced at the previous storage.
    const harness = createMountedPanel(undefined as unknown as IFakeSocket);
    harness.storage.webSocket = undefined;

    harness.storage.fetchApi = async () => ({
      ok: true,
      json: async () => ({ slotConfig: connectedSlotConfig(true) }),
    });
    harness.panel._fetchInitialDebugStatus();
    await harness.flush();
    expect(harness.panel.state.schema?.tabs.length).to.equal(1);

    // A different storage (different server), also without a socket yet, whose
    // session is connected but schema-less.
    const storageB: any = {
      webSocket: undefined,
      isConnected: true,
      subscribe: () => {},
      fetchApi: async () => ({
        ok: true,
        json: async () => ({ slotConfig: connectedSlotConfig(false) }),
      }),
    };

    const prevProps = harness.panel.props;
    harness.panel.props = { ...prevProps, storage: storageB };
    harness.panel.componentDidUpdate(prevProps);

    // The storage swap must synchronously drop the old server's diagnostics.
    expect(harness.panel.state.schema).to.equal(undefined);
    expect(harness.panel.state.connectionStatus).to.equal("connecting");

    await harness.flush();

    // Hydration from the NEW storage applies (the gate was re-sourced) and
    // does not bring the old server's schema back.
    expect(harness.panel.state.connectionStatus).to.equal("connected");
    expect(harness.panel.state.schema).to.equal(undefined);
  });

  it("does not discard state when a socket merely appears after mount", async () => {
    // Mount before the storage has a socket at all: _attachedWebSocket stays
    // null, and the mount hydration connects the panel via REST alone.
    const harness = createMountedPanel(undefined as unknown as IFakeSocket);
    harness.storage.webSocket = undefined;

    harness.storage.fetchApi = async () => ({
      ok: true,
      json: async () => ({ slotConfig: connectedSlotConfig(true) }),
    });
    harness.panel._fetchInitialDebugStatus();
    await harness.flush();
    expect(harness.panel.state.schema?.tabs.length).to.equal(1);

    // The socket APPEARING (attached was null) is not a new session: the
    // interval tick must attach without resetting the hydrated state.
    const socketA = fakeSocket();
    harness.storage.webSocket = socketA;
    harness.panel._trySubscribe();

    expect(socketA.listeners).to.deep.equal(["message"]);
    expect(harness.panel.state.connectionStatus).to.equal("connected");
    expect(harness.panel.state.schema?.tabs.length).to.equal(1);
  });
});
