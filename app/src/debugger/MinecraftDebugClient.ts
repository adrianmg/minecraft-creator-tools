// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * ARCHITECTURE DOCUMENTATION: MinecraftDebugClient
 * ================================================
 *
 * This class implements a client for the Minecraft Bedrock Edition debug protocol,
 * allowing server-side code to connect to a running Minecraft instance's debug server.
 *
 * ## Overview
 *
 * When Minecraft Dedicated Server starts with script debugging enabled, it listens
 * for debug connections (typically on port 19144). This client connects to that port
 * and receives real-time events including:
 *
 * - **Statistics**: Performance metrics, entity counts, chunk loading, etc.
 * - **Debug events**: Breakpoint hits, thread events, exceptions
 * - **Print events**: Script console output
 * - **Profiler captures**: CPU profiling data
 *
 * ## Connection Flow
 *
 * 1. Client connects to Minecraft's debug port
 * 2. Minecraft sends ProtocolEvent with version and capabilities
 * 3. Client responds with protocol handshake (negotiated = min(server, v10))
 * 4. Events flow continuously (StatEvent2 every tick, SchemaEvent on v9+, etc.)
 *
 * ## Protocol Versions
 *
 * This client implements protocol v10 (SupportEmptyTabs) and negotiates down
 * to whatever the server reports - older servers keep their original wire
 * shapes (e.g., the v5-v7 nested command/profiler payloads vs. v8+ Cereal
 * flat payloads), and a shape newer than the negotiated version is never
 * sent. Correlated debugger-request / debuggee-response round trips (v7+)
 * are managed by DebugRequestManager (sequences, timeouts, disconnect
 * cleanup). Malformed or unsupported protocol input terminates the session
 * with an actionable error instead of hanging.
 *
 * ## Integration Points
 *
 * - **DedicatedServer.ts**: Starts debug listener, creates this client
 * - **HttpServer.ts**: Subscribes to events and broadcasts to web clients
 * - **DebugPanel.tsx**: Web UI that displays the statistics
 *
 * ## Usage
 *
 * ```typescript
 * const client = new MinecraftDebugClient();
 * client.onStats.subscribe((_, stats) => console.log(stats));
 * client.onConnected.subscribe(() => console.log("Connected!"));
 * await client.connect("localhost", 19144);
 * ```
 */

import { createConnection, createServer, Socket } from "net";
import { EventDispatcher, IEvent } from "ste-events";
import Log from "../core/Log";
import DebugMessageStreamParser from "./DebugMessageStreamParser";
import DebugRequestManager, { DEBUG_REQUEST_TIMEOUT_MS } from "./DebugRequestManager";
import {
  DebugConnectionState,
  DiagnosticsDataSource,
  DiagnosticsDisplayType,
  IDebugEventEnvelope,
  IDebuggeeResponseEnvelope,
  IDebuggerRequestEnvelope,
  IDebuggerRequestLegacyEnvelope,
  IDebugMessageEnvelope,
  IDebugProtocolEnvelope,
  IDebugResponseEnvelope,
  IDebugSessionInfo,
  IDiagnosticsTabDescriptor,
  IMinecraftDebugCapabilities,
  INotificationEvent,
  IPluginDetails,
  IProfilerCaptureEvent,
  IProtocolEvent,
  IPrintEvent,
  ISchemaEvent,
  IStatData,
  IStatDataModel,
  IStatEvent,
  IStoppedEvent,
  IThreadEvent,
  MaxSupportedProtocolVersion,
  MinSupportedProtocolVersion,
  DebugAttachFailureReason,
  ProtocolVersion,
} from "./IMinecraftDebugProtocol";

const CONNECTION_RETRY_ATTEMPTS = 5;
const CONNECTION_RETRY_WAIT_MS = 1000;
const CONNECTION_TIMEOUT_MS = 5000; // Timeout for each connection attempt

/**
 * How long the client waits for the ProtocolEvent after the socket connects.
 * Exported so callers that wait on an attach outcome (DedicatedServer's
 * reattach) can size their deadline to the REAL handshake window instead of
 * guessing and reporting a slow-but-valid negotiation as failed.
 */
export const PROTOCOL_HANDSHAKE_TIMEOUT_MS = 10000;

// Allowed union values for SchemaEvent descriptor validation - mirror the
// official DiagnosticsDataSource / DiagnosticsDisplayType types verbatim.
const DIAGNOSTICS_DATA_SOURCES: readonly DiagnosticsDataSource[] = ["server", "client", "server_script"];
const DIAGNOSTICS_DISPLAY_TYPES: readonly DiagnosticsDisplayType[] = [
  "line_chart",
  "stacked_line_chart",
  "stacked_bar_chart",
  "table",
  "multi_column_table",
  "dynamic_properties_table",
];

const DESCRIPTOR_OPTIONAL_STRINGS = ["title", "y_label", "key_label", "statistic_id"] as const;
const DESCRIPTOR_OPTIONAL_NUMBERS = ["tick_range", "value_scalar", "target_value"] as const;
const DESCRIPTOR_OPTIONAL_STRING_ARRAYS = ["value_labels", "statistic_ids"] as const;

/**
 * Describe the first way a wire value violates the IDiagnosticsTabDescriptor
 * contract, or undefined when it satisfies it. This is the typed schema
 * boundary: everything past it is trusted as IDiagnosticsTabDescriptor by
 * consumers - a schema-driven renderer selects its component by display_type
 * and iterates the optional arrays as arrays - so required fields, union
 * membership, and the types of present optional fields are all enforced
 * here rather than at every consumer.
 */
function describeDescriptorViolation(descriptor: unknown, index: number): string | undefined {
  if (typeof descriptor !== "object" || descriptor === null) {
    return `descriptor[${index}] is ${JSON.stringify(descriptor)}, expected a DiagnosticsTabDescriptor object`;
  }

  const d = descriptor as Record<string, unknown>;

  for (const field of ["name", "stat_group_id"]) {
    if (typeof d[field] !== "string") {
      return `descriptor[${index}] required string field '${field}' is ${JSON.stringify(d[field])}`;
    }
  }

  if (!DIAGNOSTICS_DATA_SOURCES.includes(d.data_source as DiagnosticsDataSource)) {
    return (
      `descriptor[${index}] 'data_source' is ${JSON.stringify(d.data_source)}, ` +
      `expected one of: ${DIAGNOSTICS_DATA_SOURCES.join(", ")}`
    );
  }

  if (!DIAGNOSTICS_DISPLAY_TYPES.includes(d.display_type as DiagnosticsDisplayType)) {
    return (
      `descriptor[${index}] 'display_type' is ${JSON.stringify(d.display_type)}, ` +
      `expected one of: ${DIAGNOSTICS_DISPLAY_TYPES.join(", ")}`
    );
  }

  for (const field of DESCRIPTOR_OPTIONAL_STRINGS) {
    if (d[field] !== undefined && typeof d[field] !== "string") {
      return `descriptor[${index}] optional field '${field}' is ${JSON.stringify(d[field])}, expected a string`;
    }
  }

  for (const field of DESCRIPTOR_OPTIONAL_NUMBERS) {
    if (d[field] !== undefined && typeof d[field] !== "number") {
      return `descriptor[${index}] optional field '${field}' is ${JSON.stringify(d[field])}, expected a number`;
    }
  }

  for (const field of DESCRIPTOR_OPTIONAL_STRING_ARRAYS) {
    const value = d[field];

    if (value !== undefined && (!Array.isArray(value) || value.some((entry) => typeof entry !== "string"))) {
      return `descriptor[${index}] optional field '${field}' is ${JSON.stringify(value)}, expected an array of strings`;
    }
  }

  if (d.is_empty_tab !== undefined && typeof d.is_empty_tab !== "boolean") {
    return `descriptor[${index}] optional field 'is_empty_tab' is ${JSON.stringify(d.is_empty_tab)}, expected a boolean`;
  }

  return undefined;
}

export default class MinecraftDebugClient {
  private _socket: Socket | undefined;
  // The socket of a TCP dial still in flight (not yet assigned to _socket).
  // Retained so disconnect() can abort the dial itself instead of letting an
  // obsolete dial connect briefly; see connect()/disconnect().
  private _pendingDialSocket: Socket | undefined;
  // Resolves the retry loop's backoff sleep early; set only while a sleep is
  // pending. disconnect() invokes it so cancellation interrupts the sleep
  // instead of waiting out the remaining backoff window.
  private _connectBackoffCancel: (() => void) | undefined;
  private _parser: DebugMessageStreamParser;
  private _state: DebugConnectionState = DebugConnectionState.Disconnected;
  private _host: string = "localhost";
  private _port: number = 19144;
  private _protocolVersion: number = ProtocolVersion.Unknown;
  private _clientProtocolVersion: number = MaxSupportedProtocolVersion;
  private _targetModuleUuid: string | undefined;
  // The caller's explicit target (requestTargetModule), kept separate from
  // _targetModuleUuid so an AUTO-selected module from a previous session is
  // never mistaken for a caller request on reconnect. Only this value is
  // validated against the offered plugin list during the handshake.
  private _requestedTargetModuleUuid: string | undefined;
  private _plugins: IPluginDetails[] = [];
  private _capabilities: IMinecraftDebugCapabilities = MinecraftDebugClient.capabilitiesForVersion(
    ProtocolVersion.Unknown
  );
  // Last negotiated diagnostics schema (v9+ SchemaEvent); cleared on disconnect
  private _schema: IDiagnosticsTabDescriptor[] | undefined;
  private _lastStatTick: number = 0;
  private _errorMessage: string | undefined;
  private _passcode: string | undefined;
  // Typed reason for the last failed attach attempt; undefined once a
  // handshake completes or before any attempt. See DebugAttachFailureReason.
  private _lastAttachFailure: DebugAttachFailureReason | undefined;

  // Diagnostic tracking
  private _lastDataReceivedTime: number = 0;
  private _messageCount: number = 0;
  private _statWarningLogged: boolean = false;
  private _statusCheckInterval: NodeJS.Timeout | undefined;

  // Correlated request/response bookkeeping (v7+ debugger-requests and the
  // legacy "response" envelope): sequence allocation, timeouts, disconnect
  // cleanup. See DebugRequestManager.
  private _requests = new DebugRequestManager();

  // Generation counter for connect() attempts. disconnect() advances it, so
  // an in-flight retry loop (backoff sleep or TCP dial) notices it has been
  // canceled and aborts BEFORE a socket is assigned - otherwise a stop or
  // teardown during the retry window would leave a zombie attempt that later
  // attaches and consumes Minecraft's single debugger slot.
  private _connectAttemptId: number = 0;

  // Events
  private _onConnected = new EventDispatcher<MinecraftDebugClient, IDebugSessionInfo>();
  private _onDisconnected = new EventDispatcher<MinecraftDebugClient, string>();
  private _onStats = new EventDispatcher<MinecraftDebugClient, { tick: number; stats: IStatData[] }>();
  private _onStopped = new EventDispatcher<MinecraftDebugClient, IStoppedEvent>();
  private _onThread = new EventDispatcher<MinecraftDebugClient, IThreadEvent>();
  private _onPrint = new EventDispatcher<MinecraftDebugClient, IPrintEvent>();
  private _onError = new EventDispatcher<MinecraftDebugClient, Error>();
  private _onProtocol = new EventDispatcher<MinecraftDebugClient, IProtocolEvent>();
  private _onProfilerCapture = new EventDispatcher<MinecraftDebugClient, IProfilerCaptureEvent>();
  private _onSchema = new EventDispatcher<MinecraftDebugClient, IDiagnosticsTabDescriptor[]>();
  private _onNotification = new EventDispatcher<MinecraftDebugClient, INotificationEvent>();

  public get onConnected(): IEvent<MinecraftDebugClient, IDebugSessionInfo> {
    return this._onConnected.asEvent();
  }

  public get onDisconnected(): IEvent<MinecraftDebugClient, string> {
    return this._onDisconnected.asEvent();
  }

  public get onStats(): IEvent<MinecraftDebugClient, { tick: number; stats: IStatData[] }> {
    return this._onStats.asEvent();
  }

  public get onStopped(): IEvent<MinecraftDebugClient, IStoppedEvent> {
    return this._onStopped.asEvent();
  }

  public get onThread(): IEvent<MinecraftDebugClient, IThreadEvent> {
    return this._onThread.asEvent();
  }

  public get onPrint(): IEvent<MinecraftDebugClient, IPrintEvent> {
    return this._onPrint.asEvent();
  }

  public get onError(): IEvent<MinecraftDebugClient, Error> {
    return this._onError.asEvent();
  }

  public get onProtocol(): IEvent<MinecraftDebugClient, IProtocolEvent> {
    return this._onProtocol.asEvent();
  }

  public get onProfilerCapture(): IEvent<MinecraftDebugClient, IProfilerCaptureEvent> {
    return this._onProfilerCapture.asEvent();
  }

  /** Diagnostics schema descriptors (v9+ SchemaEvent), including v10 is_empty_tab. */
  public get onSchema(): IEvent<MinecraftDebugClient, IDiagnosticsTabDescriptor[]> {
    return this._onSchema.asEvent();
  }

  /** NotificationEvent messages (warnings/errors) from Minecraft. */
  public get onNotification(): IEvent<MinecraftDebugClient, INotificationEvent> {
    return this._onNotification.asEvent();
  }

  /**
   * Last negotiated diagnostics schema descriptors, or undefined if the
   * current session hasn't received a SchemaEvent (or is disconnected).
   */
  public get schema(): IDiagnosticsTabDescriptor[] | undefined {
    return this._schema;
  }

  /** Number of correlated requests currently awaiting a response. */
  public get pendingRequestCount(): number {
    return this._requests.pendingCount;
  }

  public get state(): DebugConnectionState {
    return this._state;
  }

  public get isConnected(): boolean {
    return this._state === DebugConnectionState.Connected;
  }

  public get sessionInfo(): IDebugSessionInfo {
    return {
      state: this._state,
      host: this._host,
      port: this._port,
      protocolVersion: this._protocolVersion,
      targetModuleUuid: this._targetModuleUuid,
      plugins: this._plugins,
      capabilities: this._capabilities,
      lastStatTick: this._lastStatTick,
      errorMessage: this._errorMessage,
      schema: this._schema,
    };
  }

  /**
   * Request a specific script module to debug. Must be set before the
   * handshake completes to take effect: the requested UUID is advertised in
   * the protocol response instead of auto-selecting the first module
   * Minecraft offers. Pass undefined to restore auto-selection.
   *
   * The requested UUID is validated against the plugin list Minecraft
   * offers in its ProtocolEvent (as the official debugger does): a UUID
   * absent from the offer fails the handshake as a moduleSelection
   * disconnect BEFORE the session enters Connected - advertising a
   * nonexistent target and resuming would report a false connected state
   * for a session Minecraft has nothing to stream to.
   */
  public requestTargetModule(moduleUuid: string | undefined): void {
    this._requestedTargetModuleUuid = moduleUuid;
    this._targetModuleUuid = moduleUuid;
  }

  /**
   * Capabilities implied by a negotiated protocol version. Mirrors the
   * version history in IMinecraftDebugProtocol.ts.
   */
  static capabilitiesForVersion(version: number): IMinecraftDebugCapabilities {
    return {
      supportsCommands: version >= ProtocolVersion.SupportProfilerCaptures,
      supportsProfiler: version >= ProtocolVersion.SupportProfilerCaptures,
      supportsBreakpointsAsRequest: version >= ProtocolVersion.SupportBreakpointsAsRequest,
      supportsDebuggerRequests: version >= ProtocolVersion.SupportDebuggerRequests,
      supportsDiagnosticsSchema: version >= ProtocolVersion.SupportNativeDescriptors,
      supportsEmptyTabs: version >= ProtocolVersion.SupportEmptyTabs,
    };
  }

  /**
   * Typed reason for the most recent failed attach attempt, or undefined if
   * the last attempt succeeded (or none was made). "connectFailed" means TCP
   * never connected; "handshakeFailed" means the socket was accepted but died
   * before the ProtocolEvent handshake — the latter is the single-client
   * contention signature.
   */
  public get lastAttachFailure(): DebugAttachFailureReason | undefined {
    return this._lastAttachFailure;
  }

  constructor() {
    this._parser = new DebugMessageStreamParser();

    this._parser.onMessage.subscribe((_, message) => {
      this._handleMessage(message as IDebugMessageEnvelope);
    });

    this._parser.onError.subscribe((_, error) => {
      Log.error(`Debug protocol parse error: ${error.message}`);

      // Malformed framing means the byte stream is unrecoverable or the peer
      // is not speaking this protocol - terminate the session with an
      // actionable reason rather than hanging on a stream we cannot parse.
      // The parser dispatches onError ONLY for framing/JSON failures; a
      // throwing downstream subscriber is contained there and never reaches
      // this disconnect (a consumer bug must not kill a healthy session).
      //
      // Cleanup runs BEFORE public notification: the state transition,
      // socket teardown, and pending-request rejection are mandatory, while
      // notification is best-effort. In the reverse order, a throwing
      // onError consumer aborts this callback mid-flight - the exception
      // escapes the socket data handler as an uncaught exception and the
      // socket is never destroyed.
      if (this._state === DebugConnectionState.Connected || this._state === DebugConnectionState.Connecting) {
        this.disconnectWithError(`Malformed debug protocol input: ${error.message}`);
      }

      this._notifyError(error);
    });
  }

  /**
   * Notify public onError subscribers, containing any subscriber exception:
   * ste-events dispatches synchronously without catching, so a throwing
   * consumer would otherwise abort the calling parser/socket callback -
   * bypassing mandatory transport cleanup or escaping as an uncaught
   * exception. Notification is best-effort; session state and the recorded
   * error reason are never derived from whether it succeeded.
   */
  private _notifyError(error: Error): void {
    try {
      this._onError.dispatch(this, error);
    } catch (e) {
      Log.error(`[DebugClient] An onError subscriber threw while handling "${error.message}": ${e}`);
    }
  }

  /**
   * Connect to the Minecraft debug server.
   * This method includes connection timeouts and retries to handle slow server startup.
   * The protocol handshake completes asynchronously after the socket connects.
   */
  public async connect(host: string = "localhost", port: number = 19144, passcode?: string): Promise<void> {
    if (this._state === DebugConnectionState.Connected || this._state === DebugConnectionState.Connecting) {
      throw new Error("Already connected or connecting");
    }

    this._host = host;
    this._port = port;
    this._passcode = passcode;
    this._state = DebugConnectionState.Connecting;
    this._errorMessage = undefined;
    this._lastAttachFailure = undefined;

    const attemptId = ++this._connectAttemptId;

    let socket: Socket | undefined;
    let lastError: Error | undefined;

    // Retry connection with exponential backoff
    Log.debug(`[Debug] Starting connection attempts to ${host}:${port} (max ${CONNECTION_RETRY_ATTEMPTS} attempts)...`);
    for (let attempt = 0; attempt < CONNECTION_RETRY_ATTEMPTS; attempt++) {
      const waitMs = attempt > 0 ? CONNECTION_RETRY_WAIT_MS * Math.pow(2, attempt - 1) : 0;
      if (waitMs > 0) {
        Log.debug(`[Debug] Waiting ${waitMs}ms before retry...`);

        // Interruptible: disconnect() resolves this sleep immediately (the
        // post-sleep generation check then aborts), so cancellation never
        // waits out the remaining backoff window - up to 16s at the later
        // attempts.
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            this._connectBackoffCancel = undefined;
            resolve();
          }, waitMs);

          this._connectBackoffCancel = () => {
            clearTimeout(timer);
            this._connectBackoffCancel = undefined;
            resolve();
          };
        });
      }

      // disconnect() may have canceled this attempt during the backoff sleep;
      // stop before dialing again.
      if (this._connectAttemptId !== attemptId) {
        throw new Error("Debug connection attempt canceled");
      }

      // disconnect() may have canceled this attempt during the backoff sleep;
      // stop before dialing again.
      if (this._connectAttemptId !== attemptId) {
        throw new Error("Debug connection attempt canceled");
      }

      Log.debug(`[Debug] Connection attempt ${attempt + 1}/${CONNECTION_RETRY_ATTEMPTS} to ${host}:${port}...`);

      try {
        socket = await new Promise<Socket>((resolve, reject) => {
          const client = createConnection({ host, port });

          // Retain the dialing socket so disconnect() can abort the TCP dial
          // itself. It is not assigned to _socket until the dial succeeds, so
          // without this a cancellation during the pending dial only took
          // effect after the dial settled - the obsolete dial could still
          // complete its TCP handshake and briefly consume Minecraft's
          // single-client debugger slot before the generation check released
          // it.
          this._pendingDialSocket = client;

          const settleDial = () => {
            if (this._pendingDialSocket === client) {
              this._pendingDialSocket = undefined;
            }
          };

          // Set a connection timeout
          const timeout = setTimeout(() => {
            settleDial();
            client.destroy();
            reject(new Error(`Connection timeout after ${CONNECTION_TIMEOUT_MS}ms`));
          }, CONNECTION_TIMEOUT_MS);

          client.on("connect", () => {
            clearTimeout(timeout);
            settleDial();
            client.removeAllListeners();
            resolve(client);
          });

          client.on("close", () => {
            clearTimeout(timeout);
            settleDial();
            client.destroy();
            reject(new Error("Connection closed"));
          });

          client.on("error", (err) => {
            clearTimeout(timeout);
            settleDial();
            client.destroy();
            reject(err);
          });
        });
        break;
      } catch (e: any) {
        // Node's autoSelectFamily dial rejects with an AggregateError whose
        // own message is EMPTY - the per-family causes (e.g. ECONNREFUSED on
        // ::1 and 127.0.0.1) live in .errors. Flatten them so the failure
        // surfaces a diagnosable cause instead of "unknown error".
        if (e instanceof AggregateError && Array.isArray(e.errors) && e.errors.length > 0 && !e.message) {
          lastError = new Error(e.errors.map((inner: any) => inner?.message ?? String(inner)).join("; "));
        } else {
          lastError = e;
        }

        Log.debug(`[Debug] Connection attempt ${attempt + 1} failed: ${lastError?.message}`);

        // A canceled attempt settles immediately instead of sleeping out the
        // next backoff window (the post-sleep generation check would abort
        // anyway; this just removes the pointless wait).
        if (this._connectAttemptId !== attemptId) {
          throw new Error("Debug connection attempt canceled");
        }
      }
    }

    // disconnect() may have canceled this attempt while the dial was in
    // flight; release whatever the dial produced and bail out before any
    // socket or session state is assigned.
    if (this._connectAttemptId !== attemptId) {
      socket?.destroy();
      throw new Error("Debug connection attempt canceled");
    }

    if (!socket) {
      this._state = DebugConnectionState.Error;
      this._lastAttachFailure = "connectFailed";
      this._errorMessage = `Failed to connect to ${host}:${port} after ${CONNECTION_RETRY_ATTEMPTS} attempts: ${lastError?.message || "unknown error"}`;
      Log.message(`[Debug] Connection failed: ${lastError?.message || "unknown error"}`);
      throw new Error(this._errorMessage);
    }

    Log.debug(`[Debug] Socket connection established to ${host}:${port}`);

    this._beginSession(socket);
  }

  /**
   * Listen on host:port and wait for Minecraft to establish the OUTBOUND
   * debugger connection (`script debugger connect <host> <port>`). Counterpart
   * of connect() for current BDS builds, whose inbound `script debugger
   * listen` listener has been observed to flap (accept-then-reset loop);
   * the outbound direction matches the official minecraft-debugger extension
   * model. Resolves once the first connection is accepted; the protocol
   * handshake then completes asynchronously exactly as with connect().
   *
   * The caller should issue the `script debugger connect` command AFTER this
   * method has been started (the listener is bound before the returned
   * promise's first await completes) - awaiting the returned promise itself
   * only resolves once Minecraft dials in.
   */
  public async serve(host: string = "127.0.0.1", port: number = 19144, acceptTimeoutMs: number = 15000): Promise<void> {
    if (this._state === DebugConnectionState.Connected || this._state === DebugConnectionState.Connecting) {
      throw new Error("Already connected or connecting");
    }

    this._host = host;
    this._port = port;
    this._state = DebugConnectionState.Connecting;
    this._errorMessage = undefined;

    const attemptId = ++this._connectAttemptId;

    let socket: Socket;

    try {
      socket = await new Promise<Socket>((resolve, reject) => {
        const server = createServer();
        this._pendingAcceptServer = server;

        const cleanup = () => {
          clearTimeout(timer);

          if (this._pendingAcceptServer === server) {
            this._pendingAcceptServer = undefined;
          }

          server.close();
        };

        const timer = setTimeout(() => {
          cleanup();
          reject(
            new Error(
              `Minecraft did not establish the outbound debugger connection to ${host}:${port} within ${
                acceptTimeoutMs / 1000
              }s`
            )
          );
        }, acceptTimeoutMs);

        server.once("error", (e: NodeJS.ErrnoException) => {
          cleanup();
          reject(new Error(`Could not listen for the debugger connection on ${host}:${port}: ${e.message}`));
        });

        server.once("connection", (accepted) => {
          cleanup();
          resolve(accepted);
        });

        // disconnect() cancels a pending accept by closing the server; make
        // that settle the promise promptly instead of waiting out the
        // accept timeout. (After a normal accept, this rejection is a no-op.)
        server.once("close", () => {
          cleanup();
          reject(new Error("Debug connection attempt canceled"));
        });

        server.listen(port, host, () => {
          Log.debug(`[Debug] Listening on ${host}:${port} for Minecraft's outbound debugger connection...`);
        });
      });
    } catch (e: any) {
      // disconnect() cancels the pending accept by closing the server; the
      // rejection then races the generation check here.
      if (this._connectAttemptId !== attemptId) {
        throw new Error("Debug connection attempt canceled");
      }

      this._state = DebugConnectionState.Error;
      this._errorMessage = e?.message ? String(e.message) : String(e);
      Log.message(`[Debug] Outbound debugger connection failed: ${this._errorMessage}`);
      throw new Error(this._errorMessage);
    }

    if (this._connectAttemptId !== attemptId) {
      socket.destroy();
      throw new Error("Debug connection attempt canceled");
    }

    Log.debug(`[Debug] Accepted Minecraft's outbound debugger connection on ${host}:${port}`);

    this._beginSession(socket);
  }

  // Pending accept-mode listener (serve()); closed on disconnect/cancel.
  private _pendingAcceptServer: ReturnType<typeof createServer> | undefined;

  /**
   * Wire an established socket into the session: parser, keep-alive, event
   * handlers, status checks, and the protocol-handshake timeout. Shared by
   * connect() (MCT dials BDS) and serve() (BDS dials MCT).
   */
  private _beginSession(socket: Socket): void {
    // Defensive: a previous session's timers must never survive into this
    // one (the normal teardown clears them, but overwriting the handles
    // below without clearing would leak a still-armed timer otherwise).
    if (this._statusCheckInterval) {
      clearInterval(this._statusCheckInterval);
      this._statusCheckInterval = undefined;
    }

    if (this._handshakeTimeoutId) {
      clearTimeout(this._handshakeTimeoutId);
      this._handshakeTimeoutId = undefined;
    }

    this._socket = socket;
    this._parser.reset();
    this._lastDataReceivedTime = Date.now();
    this._messageCount = 0;

    // Set TCP keep-alive to detect dead connections
    socket.setKeepAlive(true, 30000); // 30 second keep-alive

    // Every handler below is identity-gated on its ORIGINATING socket:
    // socket callbacks can fire asynchronously after the session moved to a
    // replacement socket (a torn-down socket's buffered "close" arrives on
    // a later tick), and without the gate a stale socket's close would call
    // _handleDisconnect() - whose teardown destroys this._socket, now the
    // REPLACEMENT - killing the new handshake. Teardown also detaches a
    // released socket's listeners (_releaseSocket); the gate is the second
    // line of defense.
    socket.on("data", (data) => {
      if (this._socket !== socket) {
        return;
      }

      this._lastDataReceivedTime = Date.now();
      this._messageCount++;
      Log.verbose(`[DebugClient] Socket received ${data.length} bytes of raw data (msg #${this._messageCount})`);
      this._parser.write(data);
    });

    socket.on("error", (e) => {
      if (this._socket !== socket) {
        Log.debug(`[DebugClient] Ignoring ERROR from an abandoned session's socket: ${e.message}`);
        return;
      }

      Log.message(`[DebugClient] Socket ERROR event: ${e.message}`);
      this._handleDisconnect(`Socket error: ${e.message}`);
    });

    socket.on("close", () => {
      if (this._socket !== socket) {
        Log.debug(`[DebugClient] Ignoring CLOSE from an abandoned session's socket`);
        return;
      }

      Log.debug(`[DebugClient] Socket CLOSE event`);
      this._handleDisconnect("Socket closed");
    });

    socket.on("end", () => {
      Log.debug(`[DebugClient] Socket END event - remote side closed connection`);
    });

    socket.on("timeout", () => {
      Log.debug(`[DebugClient] Socket TIMEOUT event`);
    });

    socket.on("drain", () => {
      Log.verbose(`[DebugClient] Socket DRAIN event - write buffer emptied`);
    });

    // Periodic status check - log if we haven't received data in a while
    this._statusCheckInterval = setInterval(() => {
      if (this._state === DebugConnectionState.Connected) {
        const silentMs = Date.now() - this._lastDataReceivedTime;
        const socketState = this._socket
          ? `readable=${this._socket.readable}, writable=${this._socket.writable}, destroyed=${this._socket.destroyed}`
          : "no socket";
        Log.verbose(
          `[DebugClient] STATUS CHECK: Connected, silent for ${silentMs}ms, ${this._messageCount} msgs received, ${socketState}`
        );

        // If we haven't received any data for 10 seconds after connecting, something is wrong.
        // Only log this warning once to avoid spamming the console every 5 seconds.
        if (silentMs > 10000 && this._messageCount <= 2 && !this._statWarningLogged) {
          this._statWarningLogged = true;
          Log.debug(
            `[DebugClient] WARNING: No stat events received after ${silentMs}ms - Minecraft may not be sending stats`
          );
        }
      }
    }, 5000);

    // Set a timeout for the protocol handshake
    // If we don't receive a ProtocolEvent within the timeout, disconnect
    const handshakeTimeout = setTimeout(() => {
      // Same identity gate as the socket handlers: a stale session's timeout
      // must not tear down the replacement's in-progress handshake.
      if (this._socket === socket && this._state === DebugConnectionState.Connecting) {
        Log.message(
          `[Debug] Protocol handshake TIMEOUT after ${PROTOCOL_HANDSHAKE_TIMEOUT_MS}ms - no ProtocolEvent received`
        );
        this._handleDisconnect("Protocol handshake timeout - no ProtocolEvent received");
      }
    }, PROTOCOL_HANDSHAKE_TIMEOUT_MS);

    // Clear the timeout when we receive the protocol event (handled in _handleProtocolEvent)
    this._handshakeTimeoutId = handshakeTimeout;

    // Now wait for the ProtocolEvent from Minecraft
    // The _handleMessage method will complete the connection handshake
    Log.debug(`[Debug] Socket connected, waiting for ProtocolEvent (timeout: ${PROTOCOL_HANDSHAKE_TIMEOUT_MS}ms)...`);
  }

  // Timeout ID for protocol handshake
  private _handshakeTimeoutId: NodeJS.Timeout | undefined;

  /**
   * Disconnect from the debug server. Idempotent: safe to call on an
   * already-disconnected client (e.g., an owner disposing a client whose
   * onDisconnected event it is currently handling). Also cancels an
   * in-flight connect(): the retry loop checks the attempt generation after
   * every await and aborts before assigning a socket, AND the pending dial
   * socket itself is destroyed - generation invalidation alone would let an
   * obsolete dial complete its TCP handshake and briefly occupy Minecraft's
   * single-client debug endpoint before being released.
   *
   * Destroys the socket BEFORE running the disconnect handling so a
   * user-initiated disconnect during the Connecting state is never
   * misclassified as "handshakeFailed" (see _handleDisconnect).
   */
  public disconnect(): void {
    this._connectAttemptId++;

    // Cancel a pending accept-mode listener (serve()) so its port is
    // released and its promise rejects instead of accepting a late dial.
    if (this._pendingAcceptServer) {
      this._pendingAcceptServer.close();
      this._pendingAcceptServer = undefined;
    }

    // Interrupt a pending retry-backoff sleep so the canceled connect()
    // settles now instead of after the remaining backoff window.
    if (this._connectBackoffCancel) {
      this._connectBackoffCancel();
    }

    // Abort an in-flight outbound dial synchronously: destroying the
    // retained socket settles the pending dial promise now, instead of
    // letting the obsolete dial complete its TCP handshake first.
    if (this._pendingDialSocket) {
      this._pendingDialSocket.destroy();
      this._pendingDialSocket = undefined;
    }

    if (this._socket) {
      this._releaseSocket(this._socket);
      this._socket = undefined;
    }

    if (this._state === DebugConnectionState.Disconnected) {
      return;
    }

    this._handleDisconnect("Client requested disconnect");
  }

  /**
   * Detach an abandoned socket's listeners and destroy it. Detaching BEFORE
   * destruction means its buffered/deferred events (Node delivers "close" on
   * a later tick) can never re-enter the session handlers - which by then
   * may belong to a replacement socket. A no-op error listener stays behind:
   * an orphaned socket erroring with zero listeners would throw as an
   * uncaught exception.
   */
  private _releaseSocket(socket: Socket): void {
    socket.removeAllListeners();
    socket.on("error", () => {});
    socket.destroy();
  }

  /**
   * Terminate the session because of a protocol violation (malformed input,
   * unsupported version, missing required fields), preserving the actionable
   * reason as the session's error state - the alternative is a session that
   * silently hangs on a stream it cannot interpret.
   */
  private disconnectWithError(reason: string): void {
    Log.message(`[DebugClient] Terminating debug session: ${reason}`);

    if (this._socket) {
      this._releaseSocket(this._socket);
      this._socket = undefined;
    }

    this._handleDisconnect(reason);
  }

  /**
   * Send a Minecraft command. The wire shape is version-gated: the nested
   * { command: { command, dimension_type } } object exists only between v5
   * (SupportProfilerCaptures) and v8 (SupportCerealSerialization); Cereal
   * serialization flattened outbound payloads back to top-level fields.
   * Mirrors the branching in Mojang/minecraft-debugger's session handling -
   * a shape newer than the negotiated version is never sent.
   */
  public sendCommand(command: string, dimensionType: "overworld" | "nether" | "the_end" = "overworld"): void {
    if (!this.isConnected) {
      throw new Error("Not connected to debug server");
    }

    const useNestedShape =
      this._protocolVersion >= ProtocolVersion.SupportProfilerCaptures &&
      this._protocolVersion < ProtocolVersion.SupportCerealSerialization;

    if (useNestedShape) {
      this._sendMessage({
        type: "minecraftCommand",
        command: {
          command: command,
          dimension_type: dimensionType,
        },
      });
    } else {
      this._sendMessage({
        type: "minecraftCommand",
        command: command,
        dimension_type: dimensionType,
      });
    }
  }

  /**
   * Send a correlated debugger request (protocol v7+, SupportDebuggerRequests)
   * and await Minecraft's debuggee-response for the same request_seq. Resolves
   * with the response's args; rejects with a DebugRequestError on a Minecraft-
   * reported failure, on timeout, or when the session disconnects.
   */
  public sendRequest(request: string, args?: unknown, timeoutMs: number = DEBUG_REQUEST_TIMEOUT_MS): Promise<unknown> {
    if (!this.isConnected) {
      return Promise.reject(new Error("Not connected to debug server"));
    }

    if (!this._capabilities.supportsDebuggerRequests) {
      return Promise.reject(
        new Error(
          `Correlated debugger requests require protocol v${ProtocolVersion.SupportDebuggerRequests}+ ` +
            `(SupportDebuggerRequests); this session negotiated v${this._protocolVersion}.`
        )
      );
    }

    const requestSeq = this._requests.allocateSequence();

    // The wire shape is version-gated exactly like command/profiler
    // serialization: v7 (SupportDebuggerRequests, pre-Cereal) nests the
    // correlated fields under `request`, while v8+
    // (SupportCerealSerialization) flattens them to the top level. Mirrors
    // the official request-manager's branching - a v7 server cannot
    // deserialize the flat shape, so every request would be rejected or
    // time out. Sequence allocation and timeout tracking are identical in
    // both shapes; the debuggee-response comes back with a top-level
    // request_seq in either case.
    const envelope: IDebuggerRequestEnvelope | IDebuggerRequestLegacyEnvelope =
      this._protocolVersion >= ProtocolVersion.SupportCerealSerialization
        ? {
            type: "debugger-request",
            request_seq: requestSeq,
            request: request,
            args: args,
          }
        : {
            type: "debugger-request",
            request: {
              request_seq: requestSeq,
              request: request,
              args: args,
            },
          };

    const responsePromise = this._requests.track(requestSeq, request, timeoutMs);

    // A synchronous send failure - circular args, BigInt, a throwing
    // toJSON, a socket-write error - must settle the tracked request NOW.
    // Without this, sendRequest threw before returning responsePromise, and
    // the inaccessible pending request sat until its timeout fired and
    // rejected unhandled.
    try {
      this._sendMessage(envelope);
    } catch (e) {
      this._requests.rejectSendFailure(requestSeq, e instanceof Error ? e.message : String(e));
    }

    return responsePromise;
  }

  /**
   * Resume execution (continue from breakpoint).
   */
  public resume(): void {
    this._sendMessage({ type: "resume" });
  }

  /**
   * Pause execution.
   */
  public pause(): void {
    this._sendMessage({ type: "pause" });
  }

  /**
   * Start the profiler. v8+ Cereal serialization expects flat payloads;
   * older servers expect the fields nested under "profiler".
   */
  public startProfiler(): void {
    if (!this._capabilities.supportsProfiler) {
      throw new Error("Profiler not supported by this Minecraft version");
    }

    if (this._protocolVersion >= ProtocolVersion.SupportCerealSerialization) {
      this._sendMessage({
        type: "startProfiler",
        target_module_uuid: this._targetModuleUuid,
      });
    } else {
      this._sendMessage({
        type: "startProfiler",
        profiler: {
          target_module_uuid: this._targetModuleUuid,
        },
      });
    }
  }

  /**
   * Stop the profiler and capture data. Same v8 shape branching as
   * startProfiler.
   */
  public stopProfiler(capturesPath: string): void {
    if (!this._capabilities.supportsProfiler) {
      throw new Error("Profiler not supported by this Minecraft version");
    }

    if (this._protocolVersion >= ProtocolVersion.SupportCerealSerialization) {
      this._sendMessage({
        type: "stopProfiler",
        captures_path: capturesPath,
        target_module_uuid: this._targetModuleUuid,
      });
    } else {
      this._sendMessage({
        type: "stopProfiler",
        profiler: {
          captures_path: capturesPath,
          target_module_uuid: this._targetModuleUuid,
        },
      });
    }
  }

  /**
   * Send a message to the debug server.
   */
  private _sendMessage(envelope: unknown): void {
    if (!this._socket) {
      Log.message(`[DebugClient] SEND FAILED: No socket! Message: ${JSON.stringify(envelope).substring(0, 200)}`);
      return;
    }

    const json = JSON.stringify(envelope);
    Log.verbose(`[DebugClient] SENDING (${json.length} bytes): ${json.substring(0, 300)}`);
    const jsonBuffer = Buffer.from(json);

    // Length prefix: 8 hex digits + newline
    const messageLength = jsonBuffer.byteLength + 1; // +1 for trailing newline
    let lengthStr = "00000000" + messageLength.toString(16) + "\n";
    lengthStr = lengthStr.substring(lengthStr.length - 9);

    const lengthBuffer = Buffer.from(lengthStr);
    const newline = Buffer.from("\n");
    const buffer = Buffer.concat([lengthBuffer, jsonBuffer, newline]);

    this._socket.write(buffer);
  }

  /**
   * Handle incoming messages.
   */
  private _handleMessage(envelope: IDebugMessageEnvelope): void {
    Log.verbose(`[DebugClient] Processing message type: ${envelope.type}`);
    if (envelope.type === "event") {
      const eventEnvelope = envelope as IDebugEventEnvelope;
      const eventType = (eventEnvelope.event as any)?.type || "unknown";
      Log.verbose(`[DebugClient] Event type: ${eventType}`);
      this._handleEvent(eventEnvelope.event as { type: string; [key: string]: unknown });
    } else if (envelope.type === "response") {
      Log.verbose(`[DebugClient] Response for command: ${(envelope as IDebugResponseEnvelope).command}`);
      this._handleResponse(envelope as IDebugResponseEnvelope);
    } else if (envelope.type === "debuggee-response") {
      this._handleDebuggeeResponse(envelope as IDebuggeeResponseEnvelope);
    } else if (envelope.type === "protocol") {
      Log.verbose(`[DebugClient] Received protocol message (as envelope.type=protocol)`);
      // Handle protocol messages that come as envelope.type="protocol" instead of event
      this._handleProtocolEvent(envelope as unknown as IProtocolEvent);
    } else {
      Log.message(
        `[DebugClient] UNKNOWN message type: ${envelope.type} - full envelope: ${JSON.stringify(envelope).substring(0, 500)}`
      );
    }
  }

  /**
   * Handle event messages from Minecraft.
   */
  private _handleEvent(event: { type: string; [key: string]: unknown }): void {
    switch (event.type) {
      case "ProtocolEvent":
        Log.verbose(`[DebugClient] Received ProtocolEvent`);
        this._handleProtocolEvent(event as unknown as IProtocolEvent);
        break;

      case "StatEvent2":
        this._handleStatEvent(event as unknown as IStatEvent);
        break;

      case "SchemaEvent":
        this._handleSchemaEvent(event as unknown as ISchemaEvent);
        break;

      case "StoppedEvent":
        Log.verbose(`[DebugClient] Received StoppedEvent`);
        this._onStopped.dispatch(this, event as unknown as IStoppedEvent);
        break;

      case "ThreadEvent":
        Log.verbose(`[DebugClient] Received ThreadEvent`);
        this._onThread.dispatch(this, event as unknown as IThreadEvent);
        break;

      case "PrintEvent":
        this._onPrint.dispatch(this, event as unknown as IPrintEvent);
        break;

      case "NotificationEvent":
        Log.verbose(`Debug notification: ${event.message}`);
        this._onNotification.dispatch(this, event as unknown as INotificationEvent);
        break;

      case "ProfilerCapture":
        Log.verbose("Received profiler capture");
        this._onProfilerCapture.dispatch(this, event as unknown as IProfilerCaptureEvent);
        break;

      default:
        Log.verbose(`Unknown debug event type: ${event.type}`);
    }
  }

  /**
   * Handle protocol handshake event: validate the server-reported version,
   * negotiate down to min(server, client) - so a newer server is used at
   * MCT's maximum and every older supported version keeps working - and
   * terminate with an actionable error on malformed or unsupported input
   * instead of continuing with an undefined protocol level.
   */
  private _handleProtocolEvent(event: IProtocolEvent): void {
    Log.debug(`[DebugClient] ProtocolEvent received: version=${event.version}, plugins=${event.plugins?.length || 0}`);
    Log.verbose(`[DebugClient] Server version: ${event.version}, Our version: ${this._clientProtocolVersion}`);
    Log.verbose(`[DebugClient] Plugins: ${JSON.stringify(event.plugins)}`);
    Log.verbose(`[DebugClient] Requires passcode: ${event.require_passcode}`);

    // The protocol version is a discrete integer enum. A fractional value
    // (e.g. 7.5) would otherwise be negotiated as a real wire version -
    // min(7.5, client) advertises nonexistent v7.5 in the handshake response
    // while capability checks and serialization branches independently
    // truncate-compare it - leaving the endpoints disagreeing about the wire
    // shape on a session that stays "connected" but is unusable. Integer
    // FUTURE versions (e.g. 11) remain accepted and are capped to the
    // client's maximum by the min() negotiation below.
    if (typeof event.version !== "number" || !Number.isInteger(event.version)) {
      const error = new Error(
        `Malformed ProtocolEvent: required integer 'version' field is ${JSON.stringify(
          event.version
        )}. The peer is not a compatible Minecraft debug server.`
      );
      // Disconnect BEFORE notifying: a throwing onError consumer must not
      // leave the session in Connecting (with the handshake timeout as the
      // only way out) by aborting this handler ahead of the cleanup.
      this.disconnectWithError(error.message);
      this._notifyError(error);
      return;
    }

    if (event.version < MinSupportedProtocolVersion) {
      const error = new Error(
        `Unsupported debug protocol version ${event.version}: MCT supports v${MinSupportedProtocolVersion} ` +
          `through v${MaxSupportedProtocolVersion}. Update Minecraft or Minecraft Creator Tools.`
      );
      this.disconnectWithError(error.message);
      this._notifyError(error);
      return;
    }

    // Fail fast with a distinct reason when Minecraft requires a passcode we
    // don't have; otherwise the server silently drops us after the handshake
    // response, which surfaces as a confusing premature close.
    if (event.require_passcode && !this._passcode) {
      this._handleDisconnect("Passcode required by Minecraft but none was provided");
      return;
    }

    this._protocolVersion = Math.min(event.version, this._clientProtocolVersion);
    this._plugins = event.plugins || [];

    // Determine capabilities based on the negotiated protocol version
    this._capabilities = MinecraftDebugClient.capabilitiesForVersion(this._protocolVersion);

    // A caller-requested target must be one of the modules Minecraft just
    // offered (the official debugger validates configured UUIDs the same
    // way). Advertising an unoffered UUID and resuming would mark this
    // session connected while Minecraft has no such module to stream from -
    // a false connected state. UUIDs compare case- and brace-insensitively:
    // manifests and BDS can disagree on both.
    if (this._requestedTargetModuleUuid !== undefined) {
      const normalizeUuid = (uuid: string) => uuid.toLowerCase().replace(/[{}]/g, "");
      const requested = normalizeUuid(this._requestedTargetModuleUuid);
      const offered = this._plugins.some((p) => p.module_uuid && normalizeUuid(p.module_uuid) === requested);

      if (!offered) {
        this._handleDisconnect("The requested target module was not offered by Minecraft");
        return;
      }
    }

    // Auto-select the first plugin if no target module specified
    // This is required to receive stats events for that module
    if (!this._targetModuleUuid && this._plugins.length > 0) {
      this._targetModuleUuid = this._plugins[0].module_uuid;
      Log.debug(`[DebugClient] Auto-selected plugin: ${this._plugins[0].name} (${this._targetModuleUuid})`);
    }

    // Log available plugins
    if (this._plugins.length > 0) {
      Log.verbose(
        `[DebugClient] Available plugins: ${this._plugins.map((p) => `${p.name} (${p.module_uuid})`).join(", ")}`
      );
    } else {
      Log.verbose(`[DebugClient] No plugins available - stats may not be reported`);
    }

    // Send protocol response
    const response: IDebugProtocolEnvelope = {
      type: "protocol",
      version: this._protocolVersion,
      target_module_uuid: this._targetModuleUuid,
      passcode: this._passcode,
    };
    Log.debug(
      `[DebugClient] Sending protocol response: version=${this._protocolVersion}, target=${this._targetModuleUuid}, hasPasscode=${!!this._passcode}`
    );
    this._sendMessage(response);

    // Clear the handshake timeout since we received the protocol event
    if (this._handshakeTimeoutId) {
      clearTimeout(this._handshakeTimeoutId);
      this._handshakeTimeoutId = undefined;
    }

    // Send a "resume" message to start stats flow
    // This mimics what VS Code's configurationDoneRequest does
    const resumeMessage = { type: "resume" };
    Log.debug(`[DebugClient] Sending 'resume' to start stats streaming...`);
    this._sendMessage(resumeMessage);

    // Mark as connected
    this._state = DebugConnectionState.Connected;
    this._lastAttachFailure = undefined;
    Log.message(`[Debug] Connected to Minecraft debugger (v${this._protocolVersion})`);

    this._onProtocol.dispatch(this, event);
    this._onConnected.dispatch(this, this.sessionInfo);
  }

  /**
   * Handle statistics event. State-guarded like the protocol/connected
   * paths: stats arriving outside a connected session (e.g. a frame parsed
   * after a fatal error already disconnected it) must not be published -
   * consumers like DebugStatsPanel treat incoming stats as proof of a live
   * connection.
   */
  private _handleStatEvent(event: IStatEvent): void {
    if (this._state !== DebugConnectionState.Connected) {
      Log.verbose(`[DebugClient] Dropping StatEvent2 (tick=${event.tick}) - session state is ${this._state}`);
      return;
    }

    this._lastStatTick = event.tick;
    Log.verbose(`[DebugClient] StatEvent2 received: tick=${event.tick}, top-level stats: ${event.stats?.length || 0}`);

    // Flatten the hierarchical stats into a flat list
    const flatStats: IStatData[] = [];
    this._flattenStats(event.stats, event.tick, flatStats);

    Log.verbose(
      `[DebugClient] StatEvent2 processed: tick ${event.tick}, ${flatStats.length} flattened stats, dispatching to ${this._onStats.count} subscribers`
    );
    this._onStats.dispatch(this, { tick: event.tick, stats: flatStats });
  }

  /**
   * Flatten hierarchical stats into a flat list.
   */
  private _flattenStats(stats: IStatDataModel[], tick: number, output: IStatData[], parent?: IStatData): void {
    for (const stat of stats) {
      const statId = stat.name.toLowerCase();

      const statData: IStatData = {
        name: stat.name,
        id: statId,
        full_id: parent ? `${parent.full_id}_${statId}` : statId,
        parent_name: parent?.name || "",
        parent_id: parent?.id || "",
        parent_full_id: parent?.full_id || "",
        values: stat.values || [],
        children_string_values: [],
        should_aggregate: stat.should_aggregate,
        tick: tick,
      };

      // If aggregating, collect child string values
      if (stat.should_aggregate && stat.children) {
        for (const child of stat.children) {
          if (child.values && child.values.length > 0) {
            if (typeof child.values[0] === "string" && child.values[0].length > 0) {
              statData.children_string_values.push([child.name, child.values[0] as string]);
            } else if (typeof child.values[0] === "number") {
              const valueStrings = child.values.map((v) => v.toString());
              statData.children_string_values.push([child.name, ...valueStrings]);
            }
          }
        }
      }

      output.push(statData);

      // Recursively process children (if not aggregating)
      if (!stat.should_aggregate && stat.children) {
        this._flattenStats(stat.children, tick, output, statData);
      }
    }
  }

  /**
   * Handle a diagnostics SchemaEvent (protocol v9+): store the descriptors as
   * the session's negotiated schema and notify typed consumers. A malformed
   * payload is surfaced as an actionable error and ignored - a bad schema
   * must not take down an otherwise healthy session.
   */
  private _handleSchemaEvent(event: ISchemaEvent): void {
    if (!Array.isArray(event.descriptors)) {
      const error = new Error(
        `Malformed SchemaEvent: required 'descriptors' field is ${JSON.stringify(
          event.descriptors
        )}, expected an array of DiagnosticsTabDescriptor. Ignoring the event.`
      );
      Log.message(`[DebugClient] ${error.message}`);
      this._notifyError(error);
      return;
    }

    // Validate every descriptor before caching or dispatching: past this
    // point the payload is typed IDiagnosticsTabDescriptor[] and consumers
    // trust that contract. An invalid descriptor is dropped and surfaced as
    // an actionable error while valid descriptors still apply - a newer
    // server introducing an unknown display_type must not take down every
    // other diagnostics view. Consumers still never receive (or find
    // cached) a partially typed entry.
    const validDescriptors: IDiagnosticsTabDescriptor[] = [];

    for (let i = 0; i < event.descriptors.length; i++) {
      const violation = describeDescriptorViolation(event.descriptors[i], i);

      if (violation !== undefined) {
        const error = new Error(`Malformed SchemaEvent: ${violation}. Ignoring this descriptor.`);
        Log.message(`[DebugClient] ${error.message}`);
        this._notifyError(error);
      } else {
        validDescriptors.push(event.descriptors[i]);
      }
    }

    // Nothing usable in a non-empty payload: keep whatever schema (if any)
    // the session already has instead of caching an empty tab strip.
    if (validDescriptors.length === 0 && event.descriptors.length > 0) {
      return;
    }

    Log.debug(
      `[DebugClient] SchemaEvent received: ${event.descriptors.length} descriptors (${validDescriptors.length} valid)`
    );

    this._schema = validDescriptors;
    this._onSchema.dispatch(this, validDescriptors);
  }

  /**
   * Handle legacy DAP-style response messages (pre-v7 "response" envelope).
   * Correlated through the same request manager as debuggee-responses.
   */
  private _handleResponse(response: IDebugResponseEnvelope): void {
    if (typeof response.request_seq !== "number") {
      this._notifyError(
        new Error(
          `Malformed response envelope: required numeric 'request_seq' field is ${JSON.stringify(
            response.request_seq
          )}. The response cannot be correlated to a request.`
        )
      );
      return;
    }

    const known = this._requests.resolveResponse(response.request_seq, response.success, response.body, response.message);

    if (!known) {
      this._notifyError(
        new Error(
          `Invalid response correlation: no pending request has request_seq ${response.request_seq} ` +
            `(command '${response.command}'). The response was dropped.`
        )
      );
    }
  }

  /**
   * Handle a correlated debuggee-response (protocol v7+). Mirrors the
   * official DebuggeeResponseEnvelope: payload in 'args', settlement
   * requires an explicit success === true (the official request-manager
   * rejects on !success), failures carry 'response_message'.
   */
  private _handleDebuggeeResponse(response: IDebuggeeResponseEnvelope): void {
    if (typeof response.request_seq !== "number") {
      this._notifyError(
        new Error(
          `Malformed debuggee-response: required numeric 'request_seq' field is ${JSON.stringify(
            response.request_seq
          )}. The response cannot be correlated to a request.`
        )
      );
      return;
    }

    const known = this._requests.resolveResponse(
      response.request_seq,
      response.success,
      response.args,
      response.response_message
    );

    if (!known) {
      this._notifyError(
        new Error(
          `Invalid response correlation: no pending debugger-request has request_seq ${response.request_seq}. ` +
            `The debuggee-response was dropped.`
        )
      );
    }
  }

  /**
   * Handle disconnect.
   */
  private _handleDisconnect(reason: string): void {
    // A redundant disconnect must not overwrite the recorded session
    // reason: after disconnectWithError() tears the session down for a
    // protocol violation, the destroyed socket's async "close" event fires
    // this handler again with a generic "Socket closed" - which would
    // clobber the specific, actionable reason the session actually ended
    // for.
    if (this._state === DebugConnectionState.Disconnected) {
      return;
    }

    const wasConnected = this._state === DebugConnectionState.Connected;
    const wasConnecting = this._state === DebugConnectionState.Connecting;

    // TCP was accepted (we still hold a live socket) but the connection died
    // before the ProtocolEvent handshake completed. This is the signature of
    // Minecraft's single-client endpoint being busy: it accepts the socket and
    // then closes/ignores it. User-initiated disconnect() clears _socket
    // before calling us, so it doesn't land here.
    if (wasConnecting && this._socket !== undefined) {
      this._lastAttachFailure = "handshakeFailed";
    }

    this._state = DebugConnectionState.Disconnected;
    this._errorMessage = reason;

    // Clear handshake timeout if still pending
    if (this._handshakeTimeoutId) {
      clearTimeout(this._handshakeTimeoutId);
      this._handshakeTimeoutId = undefined;
    }

    // Clear status check interval
    if (this._statusCheckInterval) {
      clearInterval(this._statusCheckInterval);
      this._statusCheckInterval = undefined;
    }

    // Release the socket - callers of _handleDisconnect (handshake timeout,
    // passcode/protocol rejection) may reach here with the socket still
    // open. Listeners are detached before destruction so the destroyed
    // socket's deferred close event cannot re-enter this handler against a
    // future replacement session.
    if (this._socket) {
      this._releaseSocket(this._socket);
    }

    this._socket = undefined;
    this._protocolVersion = ProtocolVersion.Unknown;
    this._plugins = [];
    this._capabilities = MinecraftDebugClient.capabilitiesForVersion(ProtocolVersion.Unknown);
    // The schema belongs to the session; a reconnect renegotiates it.
    this._schema = undefined;
    // So does an AUTO-selected target: restore the target to the caller's
    // explicit request (undefined when none), or a reused client's next
    // handshake would skip auto-selection and advertise the module the
    // PREVIOUS session picked - stale, and possibly absent from the new offer.
    this._targetModuleUuid = this._requestedTargetModuleUuid;

    // Reject all pending correlated requests so nothing leaks or hangs.
    this._requests.rejectAll(reason);

    if (wasConnected || wasConnecting) {
      Log.message(`Debug client disconnected: ${reason}`);
      this._onDisconnected.dispatch(this, reason);
    }
  }
}
