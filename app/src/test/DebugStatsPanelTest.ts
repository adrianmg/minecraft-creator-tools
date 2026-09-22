// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * DebugStatsPanelTest.ts
 *
 * Unit tests for DebugStatsPanel's WebSocket transport lifecycle - the
 * logic layer only, no DOM rendering. The component instance is constructed
 * directly with fake storage/socket stand-ins and its lifecycle methods are
 * driven by hand; setState is stubbed to apply into state synchronously.
 * Panel DOM rendering is covered by the ServerUI Playwright suite.
 */

import { expect } from "chai";
import { createRequire } from "module";
import * as path from "path";

// The panel imports its stylesheet, which no test loader handles. Load the
// component through the CommonJS loader (ts-node's require hook compiles
// the .tsx) with a no-op .css extension registered first - an ES import
// would hoist above the registration and fail on the stylesheet.
const cjsRequire = createRequire(path.join(process.cwd(), "src", "test", "DebugStatsPanelTest.ts"));
(cjsRequire as any).extensions[".css"] = () => {};

const DebugStatsPanel = cjsRequire("../UX/appShell/DebugStatsPanel").default;

/** Minimal WebSocket stand-in: records listener attachment by identity. */
class FakeSocket {
  listeners: { type: string; fn: unknown }[] = [];

  addEventListener(type: string, fn: unknown): void {
    this.listeners.push({ type: type, fn: fn });
  }

  removeEventListener(type: string, fn: unknown): void {
    this.listeners = this.listeners.filter((l) => !(l.type === type && l.fn === fn));
  }

  get messageListenerCount(): number {
    return this.listeners.filter((l) => l.type === "message").length;
  }
}

describe("DebugStatsPanel transport poll", function () {
  function createHarness() {
    const wsA = new FakeSocket();
    const subscribeCalls: string[][] = [];

    const storage = {
      webSocket: wsA as unknown as WebSocket,
      isConnected: true,
      baseUrl: "http://localhost:6126/api/0/",
      authToken: undefined,
      slot: 0,
      subscribe: (events: string[]) => {
        subscribeCalls.push(events);
      },
    };

    const panel = new DebugStatsPanel({ storage: storage, theme: {} } as never);

    // Apply state synchronously - the instance is never mounted into React.
    (panel as any).setState = (partial: object) => {
      Object.assign(panel.state, partial);
    };

    // Count rehydrations instead of letting the real fetch hit the network.
    let hydrations = 0;
    (panel as any)._fetchInitialDebugStatus = async () => {
      hydrations++;
    };

    return {
      panel,
      storage,
      wsA,
      subscribeCalls,
      hydrationCount: () => hydrations,
    };
  }

  it("detects an in-place HttpStorage webSocket replacement: detach, reattach, resubscribe, rehydrate", function () {
    // Regression: _trySubscribe() returned permanently once _hasSubscribed
    // was true and never compared the attached socket with
    // storage.webSocket. HttpStorage replaces its socket internally during
    // auto-reconnect WITHOUT changing the React prop object, so
    // componentDidUpdate never fires - the panel stayed attached to the
    // dead transport with stale lifecycle/stats.
    const h = createHarness();

    try {
      h.panel.componentDidMount();

      expect(h.wsA.messageListenerCount, "mount must attach to the initial socket").to.equal(1);
      expect(h.subscribeCalls.length, "mount must subscribe").to.equal(1);
      const hydrationsAtMount = h.hydrationCount();

      // HttpStorage auto-reconnect: the socket is replaced IN PLACE - the
      // storage prop object is unchanged and no React update occurs.
      const wsB = new FakeSocket();
      h.storage.webSocket = wsB as unknown as WebSocket;

      // The 2-second tick (driven directly rather than waiting it out).
      (h.panel as any)._trySubscribe();

      expect(h.wsA.messageListenerCount, "the dead socket must be detached").to.equal(0);
      expect(wsB.messageListenerCount, "the replacement socket must be attached").to.equal(1);
      expect(h.subscribeCalls.length, "the new server-side connection must be resubscribed").to.equal(2);
      expect(h.hydrationCount(), "the panel must rehydrate from the new transport").to.be.greaterThan(
        hydrationsAtMount
      );
      expect(
        h.panel.state.connectionStatus,
        "stale session state must reset until the rehydration snapshot answers"
      ).to.equal("connecting");

      // A tick with a STABLE socket must not churn the attachment.
      (h.panel as any)._trySubscribe();
      expect(wsB.messageListenerCount).to.equal(1);
      expect(h.subscribeCalls.length).to.equal(2);
    } finally {
      h.panel.componentWillUnmount();
    }

    expect((h.storage.webSocket as unknown as FakeSocket).messageListenerCount, "unmount must detach").to.equal(0);
  });

  it("attaches when a socket appears only after mount", function () {
    // The mount-time _setupWebSocket is a no-op with no socket; the poll
    // must attach (and subscribe) once the storage produces one.
    const h = createHarness();
    h.storage.webSocket = undefined as unknown as WebSocket;

    try {
      h.panel.componentDidMount();

      const wsLate = new FakeSocket();
      h.storage.webSocket = wsLate as unknown as WebSocket;

      (h.panel as any)._trySubscribe();

      expect(wsLate.messageListenerCount, "the late socket must be attached").to.equal(1);
      expect(h.subscribeCalls.length).to.be.greaterThan(0);
    } finally {
      h.panel.componentWillUnmount();
    }
  });
});
