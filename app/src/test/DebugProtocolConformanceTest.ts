// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * DebugProtocolConformanceTest
 *
 * Protocol-version conformance for the Minecraft script-debug wire protocol
 * (Task 1669106): exact envelope shapes for v6 / v8 / v9 / v10 (plus the v7
 * legacy debugger-request nesting), length-prefixed framing including
 * fragmented and combined delivery, and the distinct failure classification
 * for every handshake-adjacent failure mode.
 *
 * TEST DATA POLICY
 * ================
 * Every frame in this file is INERT, DETERMINISTIC test data constructed from
 * the authoritative wire definitions (Mojang/minecraft-debugger
 * protocol-events.ts / diagnostics-schema.ts, mirrored one-to-one in
 * IMinecraftDebugProtocol.ts). No project content, filesystem paths, real
 * module names, passcodes, or tokens appear anywhere - a self-check test
 * proves the frames are sanitizer-stable. There is deliberately NO mock
 * debug server here: incoming frames are fed through the real
 * DebugMessageStreamParser as bytes, and outgoing envelopes are captured at
 * the socket-write seam of the real MinecraftDebugClient. The live
 * across-the-wire handshake against real BDS lives in
 * src/test-extra/DebugProtocolRealBdsTest.ts.
 *
 * Related files:
 * - ../debugger/IMinecraftDebugProtocol.ts  wire types + version history
 * - ../debugger/DebugMessageStreamParser.ts length-prefixed framing
 * - ../debugger/MinecraftDebugClient.ts     handshake + version-gated shapes
 * - ../debugger/DebuggerLifecycle.ts        failure classification
 * - ./DebugAdapterTest.ts                   pre-existing client/session tests
 */

import { expect } from "chai";
import { EventEmitter } from "events";
import MinecraftDebugClient from "../debugger/MinecraftDebugClient";
import DebugMessageStreamParser, { MAX_DEBUG_MESSAGE_LENGTH } from "../debugger/DebugMessageStreamParser";
import {
  DebugConnectionState,
  IDebugSessionInfo,
  MaxSupportedProtocolVersion,
  ProtocolVersion,
} from "../debugger/IMinecraftDebugProtocol";
import {
  DebuggerFailureKind,
  classifyDebugClientDisconnectReason,
  sanitizeDebuggerDiagnosticText,
} from "../debugger/DebuggerLifecycle";

// ---------------------------------------------------------------------------
// Inert deterministic test data (see TEST DATA POLICY above)
// ---------------------------------------------------------------------------

/** Inert module identity - clearly synthetic, never a real pack's. */
const INERT_MODULE_UUID = "00000000-0000-4000-8000-00000000000a";
const INERT_MODULE_NAME = "InertConformanceModule";
const INERT_SECOND_MODULE_UUID = "00000000-0000-4000-8000-00000000000b";
const INERT_PASSCODE = "inert-conformance-passcode";

const INERT_PLUGINS = [{ name: INERT_MODULE_NAME, module_uuid: INERT_MODULE_UUID }];

/** Build an inert ProtocolEvent event envelope for a given server version. */
function protocolEventEnvelope(version: number, extras?: { require_passcode?: boolean; plugins?: unknown }): object {
  return {
    type: "event",
    event: {
      type: "ProtocolEvent",
      version: version,
      plugins: extras?.plugins !== undefined ? extras.plugins : INERT_PLUGINS,
      ...(extras?.require_passcode !== undefined ? { require_passcode: extras.require_passcode } : {}),
    },
  };
}

/** Frame a JSON value (or raw string) exactly as the wire protocol requires. */
function frame(message: object | string): Buffer {
  const json = typeof message === "string" ? message : JSON.stringify(message);
  const body = Buffer.from(json, "utf8");
  const length = body.byteLength + 1; // trailing newline is included in the length
  const header = ("00000000" + length.toString(16)).slice(-8) + "\n";

  return Buffer.concat([Buffer.from(header, "ascii"), body, Buffer.from("\n")]);
}

/**
 * Capturing transport seam: stands in for the TCP socket at the exact
 * write() boundary so the REAL client serialization (envelope construction,
 * version gating, framing) is what gets asserted. This simulates no server
 * behavior whatsoever - it only records bytes. It extends EventEmitter so
 * tests can also wire it through the real _beginSession() socket handlers
 * (emit "data"/"close"/"error") when session lifetime is what's under test.
 */
class CaptureTransport extends EventEmitter {
  written: Buffer[] = [];
  destroyed = false;

  write(data: Buffer): boolean {
    this.written.push(Buffer.from(data));
    return true;
  }

  destroy(): void {
    this.destroyed = true;
  }

  setKeepAlive(_enable?: boolean, _initialDelay?: number): this {
    return this;
  }

  /** Decode the captured outgoing bytes through the real stream parser. */
  decode(): unknown[] {
    const parser = new DebugMessageStreamParser();
    const messages: unknown[] = [];
    const errors: Error[] = [];

    parser.onMessage.subscribe((_p, m) => messages.push(m));
    parser.onError.subscribe((_p, e) => errors.push(e));

    for (const chunk of this.written) {
      parser.write(chunk);
    }

    expect(errors, "outgoing frames must round-trip through the real parser without framing errors").to.be.empty;

    return messages;
  }
}

interface IHarnessedClient {
  client: MinecraftDebugClient;
  transport: CaptureTransport;
  disconnects: string[];
  errors: Error[];
  sessions: IDebugSessionInfo[];
  /** Deliver an inert frame to the client through the real byte parser. */
  deliver: (message: object | string) => void;
  /** Outgoing envelopes decoded so far (clears nothing). */
  sent: () => unknown[];
}

/**
 * Create a real MinecraftDebugClient wired to the capturing transport, with
 * incoming frames delivered as BYTES through a real DebugMessageStreamParser
 * (so framing, parsing, and client handling are all the production code).
 */
function harnessClient(options?: { passcode?: string; targetModuleUuid?: string }): IHarnessedClient {
  const client = new MinecraftDebugClient();
  const transport = new CaptureTransport();
  const parser = new DebugMessageStreamParser();

  const anyClient = client as any;

  anyClient._socket = transport;
  anyClient._state = DebugConnectionState.Connecting;

  if (options?.passcode !== undefined) {
    anyClient._passcode = options.passcode;
  }

  if (options?.targetModuleUuid !== undefined) {
    client.requestTargetModule(options.targetModuleUuid);
  }

  const disconnects: string[] = [];
  const errors: Error[] = [];
  const sessions: IDebugSessionInfo[] = [];

  client.onDisconnected.subscribe((_c, reason) => disconnects.push(reason));
  client.onError.subscribe((_c, error) => errors.push(error as Error));
  client.onConnected.subscribe((_c, info) => sessions.push(info));

  parser.onMessage.subscribe((_p, message) => {
    anyClient._handleMessage(message);
  });

  return {
    client,
    transport,
    disconnects,
    errors,
    sessions,
    deliver: (message) => parser.write(frame(message)),
    sent: () => transport.decode(),
  };
}

/** Complete an inert handshake at the given server version; returns the harness. */
function connectedHarness(
  serverVersion: number,
  options?: { passcode?: string; targetModuleUuid?: string; plugins?: unknown }
): IHarnessedClient {
  const h = harnessClient(options);

  h.deliver(protocolEventEnvelope(serverVersion, { plugins: options?.plugins }));

  expect(h.sessions, `handshake at server v${serverVersion} should reach connected`).to.have.length(1);

  return h;
}

// ---------------------------------------------------------------------------

describe("Debug protocol conformance (inert frames)", () => {
  // -------------------------------------------------------------------------
  describe("length-prefixed framing", () => {
    let parser: DebugMessageStreamParser;
    let messages: unknown[];
    let errors: Error[];

    beforeEach(() => {
      parser = new DebugMessageStreamParser();
      messages = [];
      errors = [];
      parser.onMessage.subscribe((_p, m) => messages.push(m));
      parser.onError.subscribe((_p, e) => errors.push(e));
    });

    it("parses a single complete frame", () => {
      parser.write(frame({ type: "resume" }));

      expect(messages).to.deep.equal([{ type: "resume" }]);
      expect(errors).to.be.empty;
    });

    it("parses a frame delivered one byte at a time (maximal fragmentation)", () => {
      const bytes = frame(protocolEventEnvelope(ProtocolVersion.SupportEmptyTabs));

      for (let i = 0; i < bytes.length; i++) {
        parser.write(bytes.subarray(i, i + 1));
      }

      expect(messages).to.have.length(1);
      expect((messages[0] as any).event.version).to.equal(10);
      expect(errors).to.be.empty;
    });

    it("parses frames split inside the header, between header and body, and inside the body", () => {
      const bytes = frame({ type: "pause" });

      // Split inside the 9-byte length header
      parser.write(bytes.subarray(0, 4));
      parser.write(bytes.subarray(4, 9));
      // Body in two pieces
      parser.write(bytes.subarray(9, 12));
      parser.write(bytes.subarray(12));

      expect(messages).to.deep.equal([{ type: "pause" }]);
      expect(errors).to.be.empty;
    });

    it("parses multiple frames combined into a single chunk", () => {
      const combined = Buffer.concat([
        frame({ type: "resume" }),
        frame({ type: "pause" }),
        frame({ type: "event", event: { type: "StatEvent2", tick: 7, stats: [] } }),
      ]);

      parser.write(combined);

      expect(messages).to.have.length(3);
      expect((messages[0] as any).type).to.equal("resume");
      expect((messages[1] as any).type).to.equal("pause");
      expect((messages[2] as any).event.tick).to.equal(7);
      expect(errors).to.be.empty;
    });

    it("parses a frame boundary that straddles two chunks", () => {
      const a = frame({ type: "resume" });
      const b = frame({ type: "pause" });
      const joined = Buffer.concat([a, b]);

      // Cut mid-way through frame B's header.
      const cut = a.length + 5;
      parser.write(joined.subarray(0, cut));
      parser.write(joined.subarray(cut));

      expect(messages).to.deep.equal([{ type: "resume" }, { type: "pause" }]);
      expect(errors).to.be.empty;
    });

    it("reports a malformed header (missing newline) and stops the stream instead of resyncing", () => {
      // A malformed header proves the stream's framing can no longer be
      // trusted; scanning forward for something frame-shaped risks
      // misinterpreting arbitrary bytes as frames. The parser fails
      // fatally - the error is surfaced and NO later bytes are delivered.
      parser.write(Buffer.from("XXXXXXXXX", "ascii"));
      parser.write(frame({ type: "resume" }));

      expect(errors.length, "the malformed header must be reported").to.be.greaterThan(0);
      expect(String(errors[0].message)).to.include("framing");
      expect(messages, "no frames may be delivered after a fatal framing error").to.deep.equal([]);
    });

    it("reports a non-hexadecimal length header distinctly", () => {
      parser.write(Buffer.from("0000ZZ42\n", "ascii"));

      expect(errors).to.have.length(1);
      expect(errors[0].message).to.include("hexadecimal");
    });

    it("refuses an absurd declared length instead of waiting forever", () => {
      const huge = (MAX_DEBUG_MESSAGE_LENGTH + 1).toString(16).padStart(8, "0") + "\n";
      parser.write(Buffer.from(huge, "ascii"));

      expect(errors).to.have.length(1);
      expect(errors[0].message).to.include("maximum");
    });

    it("reports an invalid JSON body and stops the stream instead of resyncing", () => {
      // Same fatal contract as the framing error above: a body that fails to
      // parse means the peer (or the framing) is broken; later frames must
      // not be trusted or delivered.
      const bad = "not json at all";
      const body = Buffer.from(bad, "utf8");
      const header = ("00000000" + (body.byteLength + 1).toString(16)).slice(-8) + "\n";

      parser.write(Buffer.concat([Buffer.from(header, "ascii"), body, Buffer.from("\n")]));
      parser.write(frame({ type: "resume" }));

      expect(errors).to.have.length(1);
      expect(errors[0].message).to.include("not valid JSON");
      expect(messages, "no frames may be delivered after a fatal body error").to.deep.equal([]);
    });
  });

  // -------------------------------------------------------------------------
  describe("outgoing frame byte-exactness", () => {
    it("frames outgoing messages as 8 hex digits + newline + JSON + newline", () => {
      const h = connectedHarness(ProtocolVersion.SupportEmptyTabs);
      h.transport.written = [];

      h.client.resume();

      expect(h.transport.written).to.have.length(1);
      const raw = h.transport.written[0].toString("utf8");
      const expectedJson = '{"type":"resume"}';
      const expectedHeader = ("00000000" + (expectedJson.length + 1).toString(16)).slice(-8) + "\n";

      expect(raw).to.equal(expectedHeader + expectedJson + "\n");
    });
  });

  // -------------------------------------------------------------------------
  describe("v6 (SupportBreakpointsAsRequest) envelope shapes", () => {
    it("negotiates v6, answers with a v6 protocol response, and sends resume", () => {
      const h = connectedHarness(ProtocolVersion.SupportBreakpointsAsRequest);
      const sent = h.sent();

      expect(sent).to.have.length(2);
      expect(sent[0]).to.deep.equal({
        type: "protocol",
        version: 6,
        target_module_uuid: INERT_MODULE_UUID,
      });
      expect(sent[1]).to.deep.equal({ type: "resume" });

      expect(h.client.sessionInfo.protocolVersion).to.equal(6);
      expect(h.client.sessionInfo.capabilities).to.deep.equal({
        supportsCommands: true,
        supportsProfiler: true,
        supportsBreakpointsAsRequest: true,
        supportsDebuggerRequests: false,
        supportsDiagnosticsSchema: false,
        supportsEmptyTabs: false,
      });
    });

    it("sends the legacy NESTED minecraftCommand shape on v6", () => {
      const h = connectedHarness(ProtocolVersion.SupportBreakpointsAsRequest);
      h.transport.written = [];

      h.client.sendCommand("time query daytime", "nether");

      expect(h.sent()).to.deep.equal([
        {
          type: "minecraftCommand",
          command: { command: "time query daytime", dimension_type: "nether" },
        },
      ]);
    });

    it("sends the legacy NESTED profiler shapes on v6", () => {
      const h = connectedHarness(ProtocolVersion.SupportBreakpointsAsRequest);
      h.transport.written = [];

      h.client.startProfiler();
      h.client.stopProfiler("inert_captures");

      expect(h.sent()).to.deep.equal([
        { type: "startProfiler", profiler: { target_module_uuid: INERT_MODULE_UUID } },
        { type: "stopProfiler", profiler: { captures_path: "inert_captures", target_module_uuid: INERT_MODULE_UUID } },
      ]);
    });

    it("rejects correlated debugger requests on v6 (they require v7+)", async () => {
      const h = connectedHarness(ProtocolVersion.SupportBreakpointsAsRequest);

      let rejection: Error | undefined;
      try {
        await h.client.sendRequest("inert-request");
      } catch (e) {
        rejection = e as Error;
      }

      expect(rejection, "sendRequest must reject on v6").to.not.equal(undefined);
      expect(rejection!.message).to.include("v7");
    });
  });

  // -------------------------------------------------------------------------
  describe("v7 (SupportDebuggerRequests) legacy request nesting", () => {
    it("sends the pre-Cereal NESTED debugger-request envelope on v7", () => {
      const h = connectedHarness(ProtocolVersion.SupportDebuggerRequests);
      h.transport.written = [];

      // Fire-and-forget; settlement is covered in the v8 group.
      h.client.sendRequest("inert-request", { inert: true }).catch(() => {});

      const sent = h.sent();
      expect(sent).to.have.length(1);

      const envelope = sent[0] as any;
      expect(envelope.type).to.equal("debugger-request");
      expect(envelope.request_seq, "v7 must NOT carry a top-level request_seq").to.equal(undefined);
      expect(envelope.request).to.be.an("object");
      expect(envelope.request.request_seq).to.be.a("number");
      expect(envelope.request.request).to.equal("inert-request");
      expect(envelope.request.args).to.deep.equal({ inert: true });

      h.client.disconnect(); // settle the pending request
    });
  });

  // -------------------------------------------------------------------------
  describe("v8 (SupportCerealSerialization) envelope shapes", () => {
    it("sends the FLAT minecraftCommand shape on v8", () => {
      const h = connectedHarness(ProtocolVersion.SupportCerealSerialization);
      h.transport.written = [];

      h.client.sendCommand("time query daytime");

      expect(h.sent()).to.deep.equal([
        { type: "minecraftCommand", command: "time query daytime", dimension_type: "overworld" },
      ]);
    });

    it("sends the FLAT profiler shapes on v8", () => {
      const h = connectedHarness(ProtocolVersion.SupportCerealSerialization);
      h.transport.written = [];

      h.client.startProfiler();
      h.client.stopProfiler("inert_captures");

      expect(h.sent()).to.deep.equal([
        { type: "startProfiler", target_module_uuid: INERT_MODULE_UUID },
        { type: "stopProfiler", captures_path: "inert_captures", target_module_uuid: INERT_MODULE_UUID },
      ]);
    });

    it("sends the FLAT debugger-request envelope on v8 and resolves on an explicit success", async () => {
      const h = connectedHarness(ProtocolVersion.SupportCerealSerialization);
      h.transport.written = [];

      const pending = h.client.sendRequest("inert-request");

      const sent = h.sent();
      const envelope = sent[0] as any;
      expect(envelope.type).to.equal("debugger-request");
      expect(envelope.request_seq).to.be.a("number");
      expect(envelope.request).to.equal("inert-request");

      h.deliver({
        type: "debuggee-response",
        request_seq: envelope.request_seq,
        success: true,
        args: { inert: "result" },
      });

      expect(await pending).to.deep.equal({ inert: "result" });
    });

    it("a synchronous serialization failure rejects the tracked request immediately, leaving none pending", async () => {
      // Regression: tracking (and its timeout) started before _sendMessage
      // serialized the envelope. Circular args made JSON.stringify throw
      // synchronously - sendRequest threw before returning responsePromise,
      // and the inaccessible tracked request sat until its timeout fired
      // and rejected unhandled.
      const h = connectedHarness(ProtocolVersion.SupportCerealSerialization);
      h.transport.written = [];

      const circular: { self?: unknown } = {};
      circular.self = circular;

      let rejection: Error | undefined;
      try {
        await h.client.sendRequest("inert-request", circular);
      } catch (e) {
        rejection = e as Error;
      }

      expect(rejection, "the returned promise must reject (exactly one rejection, not a throw)").to.not.equal(
        undefined
      );
      expect(rejection!.name).to.equal("DebugRequestError");
      expect((rejection as any).kind).to.equal("sendFailure");
      expect(rejection!.message).to.include("could not be sent");
      expect(
        (h.client as any)._requests.pendingCount,
        "no inaccessible request may remain pending until its timeout"
      ).to.equal(0);
      expect(h.sent(), "nothing may reach the wire for the failed request").to.deep.equal([]);
    });

    it("rejects a debuggee-response with success=false, carrying the response message", async () => {
      const h = connectedHarness(ProtocolVersion.SupportCerealSerialization);
      h.transport.written = [];

      const pending = h.client.sendRequest("inert-request");
      const envelope = h.sent()[0] as any;

      h.deliver({
        type: "debuggee-response",
        request_seq: envelope.request_seq,
        success: false,
        response_message: "inert failure reason",
      });

      let rejection: Error | undefined;
      try {
        await pending;
      } catch (e) {
        rejection = e as Error;
      }

      expect(rejection).to.not.equal(undefined);
      expect(rejection!.message).to.include("inert failure reason");
    });

    it("rejects a debuggee-response that OMITS the success flag (never success-shaped)", async () => {
      const h = connectedHarness(ProtocolVersion.SupportCerealSerialization);
      h.transport.written = [];

      const pending = h.client.sendRequest("inert-request");
      const envelope = h.sent()[0] as any;

      h.deliver({
        type: "debuggee-response",
        request_seq: envelope.request_seq,
        args: { looksLike: "a result" },
      });

      let rejection: Error | undefined;
      try {
        await pending;
      } catch (e) {
        rejection = e as Error;
      }

      expect(rejection, "an absent success flag must reject, not resolve").to.not.equal(undefined);
    });
  });

  // -------------------------------------------------------------------------
  describe("v9 (SupportNativeDescriptors) SchemaEvent shapes", () => {
    const inertDescriptor = {
      name: "inert_tab",
      stat_group_id: "inert_group",
      data_source: "server",
      display_type: "line_chart",
      title: "Inert Tab",
    };

    it("negotiates v9 and applies a valid SchemaEvent to the session schema", () => {
      const h = connectedHarness(ProtocolVersion.SupportNativeDescriptors);

      h.deliver({ type: "event", event: { type: "SchemaEvent", descriptors: [inertDescriptor] } });

      expect(h.client.sessionInfo.protocolVersion).to.equal(9);
      expect(h.client.sessionInfo.capabilities.supportsDiagnosticsSchema).to.equal(true);
      expect(h.client.sessionInfo.capabilities.supportsEmptyTabs).to.equal(false);
      expect(h.client.sessionInfo.schema).to.deep.equal([inertDescriptor]);
      expect(h.errors).to.be.empty;
    });

    it("rejects a SchemaEvent descriptor with an invalid display_type, naming the field", () => {
      const h = connectedHarness(ProtocolVersion.SupportNativeDescriptors);

      h.deliver({
        type: "event",
        event: {
          type: "SchemaEvent",
          descriptors: [{ ...inertDescriptor, display_type: "hologram" }],
        },
      });

      expect(h.client.sessionInfo.schema, "an invalid schema must not be applied").to.equal(undefined);
      expect(h.errors.length).to.be.greaterThan(0);
      expect(h.errors[0].message).to.include("display_type");
    });
  });

  // -------------------------------------------------------------------------
  describe("v10 (SupportEmptyTabs) shapes and negotiation bounds", () => {
    it("negotiates v10 and accepts is_empty_tab on descriptors", () => {
      const h = connectedHarness(ProtocolVersion.SupportEmptyTabs);

      h.deliver({
        type: "event",
        event: {
          type: "SchemaEvent",
          descriptors: [
            {
              name: "inert_empty_tab",
              stat_group_id: "inert_group",
              data_source: "client",
              display_type: "table",
              is_empty_tab: true,
            },
          ],
        },
      });

      expect(h.client.sessionInfo.protocolVersion).to.equal(10);
      expect(h.client.sessionInfo.capabilities.supportsEmptyTabs).to.equal(true);
      expect(h.client.sessionInfo.schema![0].is_empty_tab).to.equal(true);
    });

    it("rejects a non-boolean is_empty_tab, naming the field", () => {
      const h = connectedHarness(ProtocolVersion.SupportEmptyTabs);

      h.deliver({
        type: "event",
        event: {
          type: "SchemaEvent",
          descriptors: [
            {
              name: "inert_tab",
              stat_group_id: "inert_group",
              data_source: "server",
              display_type: "table",
              is_empty_tab: "yes",
            },
          ],
        },
      });

      expect(h.client.sessionInfo.schema).to.equal(undefined);
      expect(h.errors.length).to.be.greaterThan(0);
      expect(h.errors[0].message).to.include("is_empty_tab");
    });

    it("caps an integer FUTURE server version to the client maximum", () => {
      const h = connectedHarness(MaxSupportedProtocolVersion + 1);

      expect(h.client.sessionInfo.protocolVersion).to.equal(MaxSupportedProtocolVersion);

      const response = h.sent()[0] as any;
      expect(response.version, "the response must advertise the negotiated version, not the server's").to.equal(
        MaxSupportedProtocolVersion
      );
    });

    it("accepts the alternate top-level 'protocol' envelope variant", () => {
      const h = harnessClient();

      h.deliver({ type: "protocol", version: 10, plugins: INERT_PLUGINS });

      expect(h.sessions).to.have.length(1);
      expect(h.client.sessionInfo.protocolVersion).to.equal(10);
    });
  });

  // -------------------------------------------------------------------------
  describe("handshake target selection and passcode shapes", () => {
    it("auto-selects the only available module when none is requested", () => {
      const h = connectedHarness(ProtocolVersion.SupportEmptyTabs);

      expect(h.client.sessionInfo.targetModuleUuid).to.equal(INERT_MODULE_UUID);
    });

    it("a reused client re-runs auto-selection and ignores delayed events from the abandoned session", () => {
      // Regression, part 1: an AUTO-selected target survived _handleDisconnect,
      // so a reused client's second handshake skipped both explicit-request
      // validation (nothing was requested) and auto-selection
      // (_targetModuleUuid still held session A's pick), advertising a stale
      // module the new offer did not contain while reporting connected.
      //
      // Regression, part 2: session A's socket error/close handlers were not
      // identity-gated or detached, so a delayed "close" from A's destroyed
      // socket (they deliver asynchronously) fired _handleDisconnect after
      // session B was live and tore B down. Both sessions therefore run
      // through the real _beginSession() wiring on DISTINCT transports here,
      // and A's close is delivered after B begins.
      const h = harnessClient();
      const anyClient = h.client as any;

      const transportA = h.transport;
      anyClient._beginSession(transportA);

      try {
        transportA.emit("data", frame(protocolEventEnvelope(ProtocolVersion.SupportEmptyTabs)));

        expect(h.sessions, "the first handshake should reach connected").to.have.length(1);
        expect(h.client.sessionInfo.targetModuleUuid).to.equal(INERT_MODULE_UUID);

        // Snapshot A's real close handler before disconnect() detaches it:
        // this models a close that was already queued for dispatch when the
        // listeners were removed, so the identity gate itself is exercised.
        const queuedCloseFromA = transportA.listeners("close")[0] as () => void;
        expect(queuedCloseFromA, "the real _beginSession close handler should be attached").to.not.equal(undefined);

        h.client.disconnect();
        expect(h.disconnects).to.have.length(1);
        expect(transportA.listeners("close"), "disconnect must detach the abandoned session's handlers").to.have.length(
          0
        );

        // Reconnect the SAME client instance on a DISTINCT transport, against
        // an offer that contains only the second module.
        const transportB = new CaptureTransport();
        anyClient._state = DebugConnectionState.Connecting;
        anyClient._beginSession(transportB);

        transportB.emit(
          "data",
          frame(
            protocolEventEnvelope(ProtocolVersion.SupportEmptyTabs, {
              plugins: [{ name: "InertSecondModule", module_uuid: INERT_SECOND_MODULE_UUID }],
            })
          )
        );

        expect(h.sessions, "the second handshake must reach connected").to.have.length(2);
        expect(
          h.client.sessionInfo.targetModuleUuid,
          "the second session must auto-select from ITS offer, not reuse session A's module"
        ).to.equal(INERT_SECOND_MODULE_UUID);

        // Session A's delayed events arrive now, after B is live. The queued
        // handler invocation must be rejected by the socket-identity gate,
        // and the emits must find no listeners left to invoke.
        queuedCloseFromA();
        transportA.emit("close");
        transportA.emit("error", new Error("inert delayed failure from session A"));

        expect(h.client.sessionInfo.state, "session B must survive A's delayed close/error").to.equal(
          DebugConnectionState.Connected
        );
        expect(h.disconnects, "A's delayed events must not dispatch a disconnect for B").to.have.length(1);
        expect(transportB.destroyed, "session B's transport must not be destroyed by A's delayed events").to.equal(
          false
        );

        const responseA = transportA.decode().filter((m: any) => m && m.target_module_uuid !== undefined) as any[];
        const responseB = transportB.decode().filter((m: any) => m && m.target_module_uuid !== undefined) as any[];
        expect(responseA, "the first handshake must have sent a protocol response").to.have.length(1);
        expect(responseB, "the second handshake must have sent a protocol response").to.have.length(1);
        expect(
          responseB[0].target_module_uuid,
          "the second response must advertise the newly offered module"
        ).to.equal(INERT_SECOND_MODULE_UUID);
      } finally {
        h.client.disconnect();
      }
    });

    it("keeps a requested module UUID instead of auto-selecting", () => {
      const h = connectedHarness(ProtocolVersion.SupportEmptyTabs, {
        targetModuleUuid: INERT_SECOND_MODULE_UUID,
        plugins: [
          { name: INERT_MODULE_NAME, module_uuid: INERT_MODULE_UUID },
          { name: "InertSecondModule", module_uuid: INERT_SECOND_MODULE_UUID },
        ],
      });

      expect(h.client.sessionInfo.targetModuleUuid).to.equal(INERT_SECOND_MODULE_UUID);

      const response = h.sent()[0] as any;
      expect(response.target_module_uuid).to.equal(INERT_SECOND_MODULE_UUID);
    });

    it("rejects a requested module UUID that Minecraft did not offer, before entering Connected", () => {
      // Regression: the client used to advertise ANY requested UUID, resume,
      // and dispatch onConnected unconditionally - a false connected state
      // for a target Minecraft never offered. The reason below is the REAL
      // production string (also pinned in the failure-classification
      // matrix), no longer a synthetic fixture.
      const h = harnessClient({ targetModuleUuid: INERT_SECOND_MODULE_UUID });

      // The offer carries only INERT_MODULE_UUID.
      h.deliver(protocolEventEnvelope(ProtocolVersion.SupportEmptyTabs));

      expect(h.sessions, "no connected session may be dispatched").to.have.length(0);
      expect(h.client.sessionInfo.state).to.equal(DebugConnectionState.Disconnected);
      expect(h.sent(), "no protocol response may advertise the unoffered target").to.have.length(0);
      expect(h.disconnects).to.deep.equal(["The requested target module was not offered by Minecraft"]);
      expect(classifyDebugClientDisconnectReason(h.disconnects[0])).to.equal(DebuggerFailureKind.moduleSelection);
    });

    it("accepts a requested module offered under different case and braces", () => {
      // Manifests and BDS can disagree on UUID case and brace wrapping; the
      // offer validation must not reject a genuinely offered module over
      // formatting.
      const h = connectedHarness(ProtocolVersion.SupportEmptyTabs, {
        targetModuleUuid: `{${INERT_MODULE_UUID.toUpperCase()}}`,
      });

      expect(h.sessions).to.have.length(1);
      expect(h.disconnects).to.have.length(0);
    });

    it("includes the passcode in the protocol response when Minecraft requires one", () => {
      const h = harnessClient({ passcode: INERT_PASSCODE });

      h.deliver(protocolEventEnvelope(ProtocolVersion.SupportEmptyTabs, { require_passcode: true }));

      expect(h.sessions).to.have.length(1);
      const response = h.sent()[0] as any;
      expect(response.passcode).to.equal(INERT_PASSCODE);
    });

    it("omits the passcode field entirely when none is set", () => {
      const h = connectedHarness(ProtocolVersion.SupportEmptyTabs);
      const responseJson = JSON.stringify(h.sent()[0]);

      expect(responseJson).to.not.include("passcode");
    });

    it("fails DISTINCTLY when Minecraft requires a passcode and none was provided", () => {
      const h = harnessClient();

      h.deliver(protocolEventEnvelope(ProtocolVersion.SupportEmptyTabs, { require_passcode: true }));

      expect(h.sessions, "no session may be reported connected").to.be.empty;
      expect(h.disconnects).to.have.length(1);
      expect(classifyDebugClientDisconnectReason(h.disconnects[0])).to.equal(DebuggerFailureKind.passcode);
    });
  });

  // -------------------------------------------------------------------------
  describe("malformed and unsupported handshakes", () => {
    it("terminates on a fractional protocol version as malformed peer input", () => {
      const h = harnessClient();

      h.deliver(protocolEventEnvelope(7.5));

      expect(h.sessions).to.be.empty;
      expect(h.disconnects).to.have.length(1);
      expect(h.disconnects[0]).to.include("Malformed ProtocolEvent");
    });

    it("terminates DISTINCTLY on an unsupported (too old) protocol version", () => {
      const h = harnessClient();

      h.deliver(protocolEventEnvelope(0));

      expect(h.sessions).to.be.empty;
      expect(h.disconnects).to.have.length(1);
      expect(classifyDebugClientDisconnectReason(h.disconnects[0])).to.equal(DebuggerFailureKind.protocolMismatch);
    });
  });

  // -------------------------------------------------------------------------
  describe("incoming event shapes (version-independent)", () => {
    it("flattens a hierarchical StatEvent2 into parent-linked flat stats", () => {
      const h = connectedHarness(ProtocolVersion.SupportEmptyTabs);
      const received: { tick: number; names: string[]; parents: string[] }[] = [];

      h.client.onStats.subscribe((_c, data) => {
        received.push({
          tick: data.tick,
          names: data.stats.map((s) => s.name),
          parents: data.stats.map((s) => s.parent_name),
        });
      });

      h.deliver({
        type: "event",
        event: {
          type: "StatEvent2",
          tick: 41,
          stats: [
            {
              name: "inert_root",
              should_aggregate: false,
              values: [1],
              children: [{ name: "inert_child", should_aggregate: false, values: [2] }],
            },
          ],
        },
      });

      expect(received).to.have.length(1);
      expect(received[0].tick).to.equal(41);
      expect(received[0].names).to.include("inert_root");
      expect(received[0].names).to.include("inert_child");
      const childIndex = received[0].names.indexOf("inert_child");
      expect(received[0].parents[childIndex]).to.equal("inert_root");
    });

    it("passes a ProfilerCapture event through with its base64 payload intact", () => {
      const h = connectedHarness(ProtocolVersion.SupportEmptyTabs);
      const captures: { basePath: string; data: string }[] = [];

      h.client.onProfilerCapture.subscribe((_c, event) => {
        captures.push({ basePath: event.capture_base_path, data: event.capture_data });
      });

      h.deliver({
        type: "event",
        event: {
          type: "ProfilerCapture",
          capture_base_path: "inert_capture_base",
          capture_data: "aW5lcnQ=",
        },
      });

      expect(captures).to.deep.equal([{ basePath: "inert_capture_base", data: "aW5lcnQ=" }]);
    });
  });

  // -------------------------------------------------------------------------
  describe("distinct failure classification for the six handshake failure modes", () => {
    it("classifies each failure mode to its own kind, with no two modes colliding", () => {
      // The reason strings are the EXACT shapes the client produces (asserted
      // above where the client emits them - including the not-offered module
      // rejection) plus the missing-module reason the managed flow reports.
      const scenarios: { scenario: string; reason: string; kind: DebuggerFailureKind }[] = [
        {
          scenario: "missing module",
          reason: "No script module was available to select for debugging",
          kind: DebuggerFailureKind.moduleSelection,
        },
        {
          scenario: "invalid module UUID",
          reason: "The requested target module was not offered by Minecraft",
          kind: DebuggerFailureKind.moduleSelection,
        },
        {
          scenario: "passcode failure",
          reason: "Passcode required by Minecraft but none was provided",
          kind: DebuggerFailureKind.passcode,
        },
        {
          scenario: "protocol mismatch",
          reason: "Unsupported debug protocol version 0: MCT supports v1 through v10.",
          kind: DebuggerFailureKind.protocolMismatch,
        },
        {
          scenario: "handshake timeout",
          reason: "Protocol handshake timeout - no ProtocolEvent received",
          kind: DebuggerFailureKind.handshakeTimeout,
        },
        {
          scenario: "premature close",
          reason: "Socket closed",
          kind: DebuggerFailureKind.prematureClose,
        },
      ];

      for (const s of scenarios) {
        expect(classifyDebugClientDisconnectReason(s.reason), s.scenario).to.equal(s.kind);
      }

      // Distinctness: apart from the two module-selection flavors (same
      // category by design - both recover the same way), every failure mode
      // must map to a DIFFERENT kind.
      const kinds = scenarios.map((s) => s.kind);
      expect(new Set(kinds).size, "failure modes must not collapse into shared kinds").to.equal(kinds.length - 1);
    });
  });

  // -------------------------------------------------------------------------
  describe("test-data hygiene", () => {
    it("every inert frame is sanitizer-stable (contains no paths, passcodes, tokens, or xuids)", () => {
      // Note: frames carrying passcode-related KEYS (require_passcode,
      // passcode) are intentionally excluded - the sanitizer redacts
      // anything adjacent to those key names by design, so they can never
      // be sanitizer-stable even with inert values.
      const frames = [
        JSON.stringify(protocolEventEnvelope(6)),
        JSON.stringify(protocolEventEnvelope(8)),
        JSON.stringify(protocolEventEnvelope(9)),
        JSON.stringify(protocolEventEnvelope(10)),
        JSON.stringify({ type: "event", event: { type: "StatEvent2", tick: 1, stats: [] } }),
        JSON.stringify({ type: "debuggee-response", request_seq: 1, success: true, args: { inert: true } }),
      ];

      for (const text of frames) {
        expect(sanitizeDebuggerDiagnosticText(text), "frame must already be inert").to.equal(text);
      }
    });
  });
});
