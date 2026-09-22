// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * DebuggerLifecycleTest.ts
 *
 * Tests for the managed-BDS debugger lifecycle model:
 * - DebuggerLifecycleTracker stage transitions, failure states, and history
 * - Diagnostic text sanitization (paths, passcodes, tokens, xuids)
 * - Failure classification for BDS listen failures and client disconnects
 * - Stage-specific recovery action mapping
 * - DebugPortRegistry collision-free port selection and reservation release
 */

import { expect } from "chai";
import { createServer, Server } from "net";
import DebuggerLifecycleTracker, {
  DebuggerFailureKind,
  DebuggerLifecycleStage,
  DebuggerRecoveryAction,
  IDebuggerStageEventData,
  classifyDebugClientDisconnectReason,
  classifyDebuggerListenFailure,
  getRecoveryActionsForFailure,
  sanitizeDebuggerDiagnosticText,
} from "../debugger/DebuggerLifecycle";
import DebugPortRegistry from "../debugger/DebugPortRegistry";

describe("DebuggerLifecycle", function () {
  describe("DebuggerLifecycleTracker", function () {
    it("starts idle with no failure", function () {
      const tracker = new DebuggerLifecycleTracker();

      expect(tracker.stage).to.equal(DebuggerLifecycleStage.idle);
      expect(tracker.failureKind).to.equal(DebuggerFailureKind.none);
      expect(tracker.errorMessage).to.be.undefined;
    });

    it("records transitions in order with timestamps", function () {
      const tracker = new DebuggerLifecycleTracker();

      tracker.transition(DebuggerLifecycleStage.configuring);
      tracker.transition(DebuggerLifecycleStage.startingListener);
      tracker.transition(DebuggerLifecycleStage.waitingForReadiness, "port 19144");

      const history = tracker.history;

      expect(history.map((h) => h.stage)).to.deep.equal([
        DebuggerLifecycleStage.configuring,
        DebuggerLifecycleStage.startingListener,
        DebuggerLifecycleStage.waitingForReadiness,
      ]);
      expect(history[2].detail).to.equal("port 19144");
      expect(new Date(history[0].at).getTime()).to.be.greaterThan(0);
    });

    it("dispatches stage change events", function () {
      const tracker = new DebuggerLifecycleTracker();
      const events: IDebuggerStageEventData[] = [];

      tracker.onStageChanged.subscribe((_t, data) => {
        events.push(data);
      });

      tracker.transition(DebuggerLifecycleStage.connectingTcp);
      tracker.fail(DebuggerFailureKind.tcpConnect, "connect ECONNREFUSED");

      expect(events.length).to.equal(2);
      expect(events[0].stage).to.equal(DebuggerLifecycleStage.connectingTcp);
      expect(events[1].stage).to.equal(DebuggerLifecycleStage.failed);
      expect(events[1].failureKind).to.equal(DebuggerFailureKind.tcpConnect);
    });

    it("clears failure details when moving forward again", function () {
      const tracker = new DebuggerLifecycleTracker();

      tracker.fail(DebuggerFailureKind.listenerReadiness, "no confirmation");
      expect(tracker.failureKind).to.equal(DebuggerFailureKind.listenerReadiness);
      expect(tracker.errorMessage).to.not.be.undefined;

      tracker.transition(DebuggerLifecycleStage.startingListener);

      expect(tracker.failureKind).to.equal(DebuggerFailureKind.none);
      expect(tracker.errorMessage).to.be.undefined;
    });

    it("deduplicates repeat transitions except reconnecting", function () {
      const tracker = new DebuggerLifecycleTracker();

      tracker.transition(DebuggerLifecycleStage.connected);
      tracker.transition(DebuggerLifecycleStage.connected);
      expect(tracker.history.length).to.equal(1);

      tracker.transition(DebuggerLifecycleStage.reconnecting, "attempt 1");
      tracker.transition(DebuggerLifecycleStage.reconnecting, "attempt 2");
      expect(tracker.history.length).to.equal(3);
    });

    it("sanitizes failure messages before storing them", function () {
      const tracker = new DebuggerLifecycleTracker();

      tracker.fail(DebuggerFailureKind.settings, "Cannot read C:\\Users\\someone\\server\\server.properties");

      expect(tracker.errorMessage).to.not.include("C:\\Users");
      expect(tracker.errorMessage).to.include("<path>");
    });
  });

  describe("sanitizeDebuggerDiagnosticText", function () {
    it("redacts Windows and Unix paths", function () {
      const result = sanitizeDebuggerDiagnosticText(
        "loaded from C:\\Users\\alex\\AppData\\mct\\slot0 and /Users/alex/worlds/main"
      );

      expect(result).to.not.include("alex");
      expect(result).to.include("<path>");
    });

    it("redacts Unix paths glued to common diagnostic delimiters", function () {
      // Regression: the prefix class accepted only whitespace/quote/(/=/,
      // so paths directly after :, [, {, or -> survived into copied
      // diagnostics while equivalent Windows paths were already covered.
      const inputs = [
        "world at [/home/jane/mct/server]",
        "serverPath:/home/jane/mct/server",
        "{path:/home/jane/mct/server}",
        "x->/home/jane/worlds/mine",
        "cwd:/opt/server",
      ];

      for (const input of inputs) {
        const result = sanitizeDebuggerDiagnosticText(input);

        expect(result, input).to.include("<path>");
        expect(result, input).to.not.include("jane");
        expect(result, input).to.not.include("/home");
        expect(result, input).to.not.include("/opt");
        expect(result, input).to.not.include("server]");
      }
    });

    it("redacts passcodes and tokens", function () {
      const result = sanitizeDebuggerDiagnosticText('passcode: "abc123" token=xyz789 Authorization: Bearer 998877');

      expect(result).to.not.include("abc123");
      expect(result).to.not.include("xyz789");
      expect(result).to.not.include("998877");
      expect(result).to.include("<redacted>");
    });

    it("fully redacts Windows paths whose segments contain spaces", function () {
      // Regression: the redactor previously stopped at whitespace, leaking
      // "<path> Doe\server\server.properties" - the username and every
      // trailing path component.
      const result = sanitizeDebuggerDiagnosticText("Cannot read C:\\Users\\John Doe\\server\\server.properties");

      expect(result).to.not.include("John");
      expect(result).to.not.include("Doe");
      expect(result).to.not.include("server.properties");
      expect(result).to.include("<path>");
    });

    it("fully redacts UNC paths whose segments contain spaces", function () {
      const result = sanitizeDebuggerDiagnosticText("Loading \\\\fileserver\\shared drive\\John Doe\\world");

      expect(result).to.not.include("John");
      expect(result).to.not.include("Doe");
      expect(result).to.not.include("shared drive");
      expect(result).to.not.include("world");
      expect(result).to.include("<path>");
    });

    it("fully redacts Unix paths whose segments contain spaces", function () {
      const result = sanitizeDebuggerDiagnosticText("Cannot open /Users/John Doe/world backup/level.dat right now");

      expect(result).to.not.include("John");
      expect(result).to.not.include("Doe");
      expect(result).to.not.include("world backup");
      expect(result).to.not.include("level.dat");
      expect(result).to.include("<path>");
    });

    it("redacts quoted paths entirely, including spaces in the final segment", function () {
      const result = sanitizeDebuggerDiagnosticText(
        'Cannot open "C:\\Users\\John Doe\\my world\\level test.dat" for writing'
      );

      expect(result).to.include('"<path>"');
      expect(result).to.not.include("John");
      expect(result).to.not.include("my world");
      expect(result).to.not.include("level test.dat");
      expect(result).to.include("for writing");
    });

    it("redacts space-containing final segments rather than leaking suffixes", function () {
      // Regression: the final segment previously stopped at whitespace, so
      // "C:\Program Files\Minecraft Server" leaked as "<path> Server". A
      // segment suffix is a path fragment; trailing words after a path are
      // swallowed rather than risk leaking one (the tradeoff the copied-
      // diagnostics guarantee requires).
      const result = sanitizeDebuggerDiagnosticText("Executable not found at C:\\Program Files\\Minecraft Server");

      expect(result, "no fragment of any segment may survive").to.equal("Executable not found at <path>");
    });

    it("preserves sentence text after a path terminated by punctuation", function () {
      const result = sanitizeDebuggerDiagnosticText(
        "Digital signature verification failed for C:\\Program Files\\srv\\bedrock_server.exe. Status: HashMismatch"
      );

      expect(result).to.not.include("Program");
      expect(result).to.not.include("bedrock_server");
      expect(result).to.include("<path>. Status: HashMismatch");
    });

    it("redacts Unix paths under arbitrary absolute roots", function () {
      // Regression: only /home and /Users were recognized, so user-selected
      // BDS locations under /opt, /mnt, /var, or /tmp were copied verbatim.
      const inputs = [
        "executable not found at /opt/Minecraft Creator Tools/bedrock_server",
        "executable not found at /mnt/c/servers/slot one/bedrock_server",
        "executable not found at /var/lib/mct/slot0/bedrock_server",
        "executable not found at /tmp/bds test/bedrock_server",
      ];

      for (const input of inputs) {
        const result = sanitizeDebuggerDiagnosticText(input);

        expect(result, input).to.include("executable not found at <path>");
        expect(result, input).to.not.include("bedrock_server");
        expect(result, input).to.not.include("Minecraft");
        expect(result, input).to.not.include("servers");
        expect(result, input).to.not.include("mct");
        expect(result, input).to.not.include("bds test");
      }
    });

    it("does not mangle URLs or slash-joined word pairs", function () {
      const line = "See https://aka.ms/mcbds and/or retry";

      expect(sanitizeDebuggerDiagnosticText(line)).to.equal(line);
    });

    it("redacts player xuids", function () {
      const result = sanitizeDebuggerDiagnosticText("Player connected: Steve, xuid: 2535405283421337");

      expect(result).to.not.include("2535405283421337");
    });

    it("redacts a complete bare JWT that no Bearer/key prefix introduces", function () {
      // Regression: only "Bearer <x>" and key:value credential forms were
      // redacted, so a JWT standing alone (query string, JSON field, pasted
      // log line) survived sanitization in full.
      const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIyNTM1NDA1MjgzNDIxMzM3In0.dGVzdHNpZ25hdHVyZQ";
      const result = sanitizeDebuggerDiagnosticText(`session resumed with ${jwt} attached`);

      expect(result).to.not.include(jwt);
      expect(result).to.not.include("eyJ");
      expect(result).to.include("session resumed with <redacted> attached");
    });

    it("keeps non-sensitive infrastructure text intact", function () {
      const line = "Debugger listening on port 19144";

      expect(sanitizeDebuggerDiagnosticText(line)).to.equal(line);
    });
  });

  describe("failure classification", function () {
    it("classifies listen failures by cause", function () {
      expect(classifyDebuggerListenFailure("Failed to start debugger: port 19144 already in use")).to.equal(
        DebuggerFailureKind.portOccupied
      );
      expect(classifyDebuggerListenFailure("Failed to start debugger: ports exhausted")).to.equal(
        DebuggerFailureKind.portOccupied
      );
      expect(classifyDebuggerListenFailure("Failed to start debugger")).to.equal(
        DebuggerFailureKind.listenerReadiness
      );
      // "port" must match as a WORD - a substring check would hit
      // "unsupported"/"support"/"export" and mislabel these as portOccupied,
      // steering users toward the wrong recovery actions.
      expect(classifyDebuggerListenFailure("Failed to start debugger: unsupported configuration")).to.equal(
        DebuggerFailureKind.listenerReadiness
      );
      expect(classifyDebuggerListenFailure("Failed to start debugger: exporting diagnostics not supported")).to.equal(
        DebuggerFailureKind.listenerReadiness
      );
    });

    it("classifies client disconnect reasons distinctly", function () {
      expect(classifyDebugClientDisconnectReason("Passcode required by Minecraft but none was provided")).to.equal(
        DebuggerFailureKind.passcode
      );
      expect(
        classifyDebugClientDisconnectReason("Protocol mismatch: Minecraft reported an unsupported protocol version (0)")
      ).to.equal(DebuggerFailureKind.protocolMismatch);
      // A handshake timeout proves only slowness/silence, never an observed
      // incompatible version - it must classify as its own RETRYABLE kind,
      // not as the permanent protocolMismatch.
      expect(classifyDebugClientDisconnectReason("Protocol handshake timeout - no ProtocolEvent received")).to.equal(
        DebuggerFailureKind.handshakeTimeout
      );
      expect(
        classifyDebugClientDisconnectReason("Failed to connect to localhost:19144 after 5 attempts: connect ECONNREFUSED")
      ).to.equal(DebuggerFailureKind.tcpConnect);
      expect(classifyDebugClientDisconnectReason("Socket closed")).to.equal(DebuggerFailureKind.prematureClose);
    });
  });

  describe("getRecoveryActionsForFailure", function () {
    it("leads with Change Settings for settings-type failures", function () {
      const actions = getRecoveryActionsForFailure(DebuggerFailureKind.settings);

      expect(actions[0]).to.equal(DebuggerRecoveryAction.changeSettings);
      expect(actions).to.include(DebuggerRecoveryAction.retry);
      expect(actions).to.include(DebuggerRecoveryAction.copyDiagnostics);
      expect(actions).to.include(DebuggerRecoveryAction.stopServer);
    });

    it("leads with Retry for transient failures", function () {
      const actions = getRecoveryActionsForFailure(DebuggerFailureKind.tcpConnect);

      expect(actions[0]).to.equal(DebuggerRecoveryAction.retry);
      expect(actions).to.include(DebuggerRecoveryAction.viewLogs);
    });

    it("excludes Retry for permanent failure kinds", function () {
      // serverStartup: a debugger-connection retry cannot fix a server that
      // never started. protocolMismatch: incompatible builds - DedicatedServer
      // fails it without auto-reconnect, so a retry is a guaranteed repeat.
      for (const kind of [DebuggerFailureKind.serverStartup, DebuggerFailureKind.protocolMismatch]) {
        const actions = getRecoveryActionsForFailure(kind);

        expect(actions, kind).to.not.include(DebuggerRecoveryAction.retry);
        expect(actions, kind).to.include(DebuggerRecoveryAction.copyDiagnostics);
        expect(actions, kind).to.include(DebuggerRecoveryAction.viewLogs);
        expect(actions, kind).to.include(DebuggerRecoveryAction.stopServer);
      }
    });
  });
});

describe("DebugPortRegistry", function () {
  this.timeout(10000);

  const occupiers: Server[] = [];

  async function occupyPort(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = createServer();
      occupiers.push(server);
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => resolve());
    });
  }

  afterEach(async function () {
    for (const server of occupiers.splice(0)) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    // Clean up any leftover reservations between tests. release() is
    // token-conditional, so cleanup goes through the unconditional
    // owner-level teardown path.
    for (let port = 19700; port < 19760; port++) {
      const owner = DebugPortRegistry.reservedBy(port);

      if (owner !== undefined) {
        DebugPortRegistry.releaseAllForOwner(owner);
      }
    }
  });

  it("reserves the preferred port when free", async function () {
    const reservation = await DebugPortRegistry.reserve(19700, "ownerA");

    expect(reservation?.port).to.equal(19700);
    expect(DebugPortRegistry.reservedBy(19700)).to.equal("ownerA");
  });

  it("skips a port occupied by another process", async function () {
    await occupyPort(19710);

    const reservation = await DebugPortRegistry.reserve(19710, "ownerA");

    expect(reservation?.port).to.equal(19711);
  });

  it("skips a port occupied only on IPv6 loopback", async function () {
    // The debug client connects to "localhost", which may resolve to ::1
    // first - so a port whose IPv6 loopback endpoint is taken (e.g., a
    // VS Code debugger bound only on ::1) must not be handed out even
    // though its IPv4 endpoint is free. Platform-tolerant: skipped where
    // IPv6 loopback is unavailable.
    const v6Occupant = createServer();
    const bound = await new Promise<boolean>((resolve) => {
      v6Occupant.once("error", () => resolve(false));
      v6Occupant.listen(19755, "::1", () => resolve(true));
    });

    if (!bound) {
      this.skip();
      return;
    }

    occupiers.push(v6Occupant);

    const reservation = await DebugPortRegistry.reserve(19755, "ownerA");

    expect(reservation?.port, "an IPv6-only occupant must fail the probe").to.equal(19756);
  });

  it("does not hand the same port to two owners", async function () {
    const first = await DebugPortRegistry.reserve(19720, "ownerA");
    const second = await DebugPortRegistry.reserve(19720, "ownerB");

    expect(first?.port).to.equal(19720);
    expect(second?.port).to.equal(19721);
  });

  it("does not hand the same port to owners reserving concurrently", async function () {
    // Regression for the check->await->set race: the map claim must happen
    // BEFORE the async bind probe, or every concurrent owner reads the
    // candidate as unclaimed, yields in the probe, and all of them are
    // handed the same port - violating the in-process collision guarantee
    // when server starts overlap.
    const owners = ["concurrentA", "concurrentB", "concurrentC", "concurrentD"];

    const reservations = await Promise.all(owners.map((owner) => DebugPortRegistry.reserve(19715, owner)));

    expect(
      reservations.every((reservation) => reservation !== undefined),
      "every concurrent owner must receive a port"
    ).to.be.true;

    const ports = reservations.map((reservation) => reservation?.port);
    expect(new Set(ports).size, "every concurrent owner must receive a DISTINCT port").to.equal(owners.length);

    for (let i = 0; i < owners.length; i++) {
      expect(ports[i]).to.be.within(19715, 19715 + owners.length - 1);
      expect(DebugPortRegistry.reservedBy(ports[i] as number)).to.equal(owners[i]);
    }
  });

  it("same-owner re-reserve returns the same port and supersedes the earlier handle", async function () {
    const first = await DebugPortRegistry.reserve(19730, "ownerA");
    const again = await DebugPortRegistry.reserve(19730, "ownerA");

    expect(first?.port).to.equal(19730);
    expect(again?.port).to.equal(19730);

    // The newest claim owns the port: the superseded handle's release must
    // no-op instead of dropping the active reservation.
    DebugPortRegistry.release(first);
    expect(DebugPortRegistry.reservedBy(19730), "a stale handle must not release the active claim").to.equal("ownerA");

    DebugPortRegistry.release(again);
    expect(DebugPortRegistry.reservedBy(19730)).to.be.undefined;
  });

  it("release makes the port available again", async function () {
    const first = await DebugPortRegistry.reserve(19740, "ownerA");
    DebugPortRegistry.release(first);

    const second = await DebugPortRegistry.reserve(19740, "ownerB");

    expect(second?.port).to.equal(19740);
    expect(DebugPortRegistry.reservedBy(19740)).to.equal("ownerB");
  });

  it("a re-reserve during a pending probe shares the probe, and the superseded release no-ops", async function () {
    // Regression for the tentative-claim race: attempt A's map entry is
    // inserted BEFORE its bind probe resolves. A same-owner attempt B that
    // re-reserves in that window must not treat the unconfirmed entry as a
    // completed reservation (it could issue a listen on a port the probe
    // later reports occupied), and when A - superseded and resolving LAST -
    // releases its handle, B's now-active reservation must survive.
    const originalIsPortFree = DebugPortRegistry.isPortFree;
    let resolveProbe: ((free: boolean) => void) | undefined;
    (DebugPortRegistry as any).isPortFree = () =>
      new Promise<boolean>((resolve) => {
        resolveProbe = resolve;
      });

    try {
      // Attempt A claims 19745 tentatively; its probe stays pending.
      const attemptA = DebugPortRegistry.reserve(19745, "sameOwner");

      // Give A's synchronous claim a chance to land before B enters.
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Attempt B (same owner - e.g., a retry that superseded A) re-reserves
      // while A's probe is still pending.
      const attemptB = DebugPortRegistry.reserve(19745, "sameOwner");

      let bResolved = false;
      attemptB.then(() => {
        bResolved = true;
      });

      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(bResolved, "B must wait for the shared probe, not trust the tentative claim").to.be.false;

      // The probe (started once, shared by both attempts) reports free.
      resolveProbe!(true);

      const a = await attemptA;
      const b = await attemptB;

      expect(a?.port).to.equal(19745);
      expect(b?.port, "B must receive the same port once the shared probe confirms it").to.equal(19745);

      // A was superseded; its stale cleanup must not drop B's reservation.
      DebugPortRegistry.release(a);
      expect(DebugPortRegistry.reservedBy(19745), "the superseded release must not drop B's claim").to.equal(
        "sameOwner"
      );

      DebugPortRegistry.release(b);
      expect(DebugPortRegistry.reservedBy(19745)).to.be.undefined;
    } finally {
      (DebugPortRegistry as any).isPortFree = originalIsPortFree;
    }
  });

  it("a shared probe that reports occupied moves both attempts to the next candidate", async function () {
    // Same tentative-claim window as above, but the probe reports the
    // candidate externally occupied: neither attempt may hand out the
    // occupied port, and the withdrawn claim must not linger in the map.
    const originalIsPortFree = DebugPortRegistry.isPortFree;
    let firstProbeResolve: ((free: boolean) => void) | undefined;
    let probeCalls = 0;
    (DebugPortRegistry as any).isPortFree = () => {
      probeCalls++;

      if (probeCalls === 1) {
        return new Promise<boolean>((resolve) => {
          firstProbeResolve = resolve;
        });
      }

      return Promise.resolve(true);
    };

    try {
      const attemptA = DebugPortRegistry.reserve(19747, "sameOwner");
      await new Promise((resolve) => setTimeout(resolve, 10));
      const attemptB = DebugPortRegistry.reserve(19747, "sameOwner");

      firstProbeResolve!(false);

      const a = await attemptA;
      const b = await attemptB;

      expect(a?.port, "A must skip the occupied candidate").to.not.equal(19747);
      expect(b?.port, "B must skip the occupied candidate").to.not.equal(19747);
      expect(DebugPortRegistry.reservedBy(19747), "the withdrawn tentative claim must not linger").to.be.undefined;
    } finally {
      (DebugPortRegistry as any).isPortFree = originalIsPortFree;
    }
  });

  it("releaseAllForOwner clears every reservation held by that owner", async function () {
    await DebugPortRegistry.reserve(19750, "ownerA");
    await DebugPortRegistry.reserve(19751, "ownerA");
    await DebugPortRegistry.reserve(19752, "ownerB");

    DebugPortRegistry.releaseAllForOwner("ownerA");

    expect(DebugPortRegistry.reservedBy(19750)).to.be.undefined;
    expect(DebugPortRegistry.reservedBy(19751)).to.be.undefined;
    expect(DebugPortRegistry.reservedBy(19752)).to.equal("ownerB");
  });
});
