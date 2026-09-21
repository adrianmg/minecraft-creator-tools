// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * ARCHITECTURE DOCUMENTATION: Minecraft Debug Protocol Types
 * ===========================================================
 *
 * This file defines interfaces for communicating with the Minecraft Bedrock Edition
 * debug server using a protocol similar to the VS Code Debug Adapter Protocol (DAP).
 *
 * ## Protocol Overview
 *
 * The Minecraft debug server uses a length-prefixed JSON message format:
 * - Messages are prefixed with an 8-character hex length + newline (e.g., "00000042\n")
 * - The message body is JSON followed by a newline
 *
 * ## Message Types
 *
 * 1. **Protocol Event**: Initial handshake with version negotiation
 * 2. **Stat Events**: Real-time performance statistics (StatEvent2)
 * 3. **Debug Events**: Breakpoint hits, thread events, etc.
 * 4. **Profiler Captures**: CPU profiling data
 *
 * ## Connection Flow
 *
 * 1. Server starts debug listener: `script debugger listen 19144`
 * 2. Client connects via TCP
 * 3. Server sends ProtocolEvent with capabilities
 * 4. Client responds with protocol version and target selection
 * 5. Real-time events flow (stats, breakpoints, etc.)
 *
 * ## Related Files
 *
 * - MinecraftDebugClient.ts: TCP client implementation
 * - DedicatedServer.ts: Starts debug listener on server start
 * - HttpServer.ts: Proxies debug data to web clients
 */

// ============================================================================
// Protocol Envelope Types
// ============================================================================

/**
 * Base envelope for all debug protocol messages.
 */
export interface IDebugMessageEnvelope {
  type: "event" | "response" | "request" | "protocol" | "debugger-request" | "debuggee-response";
}

/**
 * Event message from Minecraft.
 */
export interface IDebugEventEnvelope extends IDebugMessageEnvelope {
  type: "event";
  event: IDebugEvent;
}

/**
 * Response to a request.
 */
export interface IDebugResponseEnvelope extends IDebugMessageEnvelope {
  type: "response";
  request_seq: number;
  success: boolean;
  command: string;
  body?: unknown;
  message?: string;
}

/**
 * Request message to Minecraft.
 */
export interface IDebugRequestEnvelope extends IDebugMessageEnvelope {
  type: "request";
  request: {
    request_seq: number;
    command: string;
    args?: unknown;
  };
}

/**
 * Protocol handshake message.
 */
export interface IDebugProtocolEnvelope extends IDebugMessageEnvelope {
  type: "protocol";
  version: number;
  target_module_uuid?: string;
  passcode?: string;
}

/**
 * Correlated debugger request in the v8+ (SupportCerealSerialization) flat
 * wire shape: the correlated fields ride at the top level. Sent debugger ->
 * Minecraft; Minecraft answers with a debuggee-response carrying the same
 * request_seq. Field names mirror the official Mojang/minecraft-debugger
 * protocol-events.ts (DebuggerRequestEnvelope) verbatim - `request` is the
 * command NAME string. A v7 session must use
 * IDebuggerRequestLegacyEnvelope instead.
 */
export interface IDebuggerRequestEnvelope extends IDebugMessageEnvelope {
  type: "debugger-request";
  request_seq: number;
  request: string;
  args?: unknown;
}

/**
 * Correlated debugger request in the pre-Cereal wire shape (protocol v7,
 * SupportDebuggerRequests before SupportCerealSerialization): the correlated
 * fields ride NESTED under `request`. Mirrors the official request-manager's
 * version branching - a v7 server cannot deserialize the flat v8+ shape, so
 * every request would be rejected or time out.
 */
export interface IDebuggerRequestLegacyEnvelope extends IDebugMessageEnvelope {
  type: "debugger-request";
  request: {
    request_seq: number;
    request: string;
    args?: unknown;
  };
}

/**
 * Correlated response from Minecraft to a debugger-request (protocol v7+).
 * Mirrors the official DebuggeeResponseEnvelope verbatim: the payload rides
 * in `args`, failures set success=false with a human-readable
 * response_message. Settlement follows the official request-manager: only an
 * explicit success === true resolves - an absent success field REJECTS, so a
 * malformed or failed response that omits the flag is never reported as
 * success.
 */
export interface IDebuggeeResponseEnvelope extends IDebugMessageEnvelope {
  type: "debuggee-response";
  request_seq: number;
  args?: unknown;
  success?: boolean;
  response_message?: string;
}

// ============================================================================
// Event Types
// ============================================================================

export type DebugEventType =
  | "StoppedEvent"
  | "ThreadEvent"
  | "PrintEvent"
  | "NotificationEvent"
  | "ProtocolEvent"
  | "StatEvent2"
  | "SchemaEvent"
  | "ProfilerCapture";

/**
 * Base debug event.
 */
export interface IDebugEvent {
  type: DebugEventType;
}

/**
 * Protocol capabilities sent by Minecraft on connection.
 */
export interface IProtocolEvent extends IDebugEvent {
  type: "ProtocolEvent";
  version: number;
  plugins: IPluginDetails[];
  require_passcode?: boolean;
}

export interface IPluginDetails {
  name: string;
  module_uuid: string;
}

/**
 * Breakpoint hit or pause event.
 */
export interface IStoppedEvent extends IDebugEvent {
  type: "StoppedEvent";
  reason: "breakpoint" | "exception" | "pause" | "step";
  thread: number;
  description?: string;
}

/**
 * Thread lifecycle event.
 */
export interface IThreadEvent extends IDebugEvent {
  type: "ThreadEvent";
  reason: "started" | "exited";
  thread: number;
}

/**
 * Console/script output event.
 */
export interface IPrintEvent extends IDebugEvent {
  type: "PrintEvent";
  message: string;
  logLevel?: number;
}

/**
 * Notification event (warnings, errors, etc.).
 */
export interface INotificationEvent extends IDebugEvent {
  type: "NotificationEvent";
  message: string;
  logLevel?: number;
}

/**
 * Profiler capture event.
 */
export interface IProfilerCaptureEvent extends IDebugEvent {
  type: "ProfilerCapture";
  capture_base_path: string;
  capture_data: string; // Base64 encoded
}

// ============================================================================
// Diagnostics Schema Types (protocol v9+, SupportNativeDescriptors)
// ============================================================================

/** Where a diagnostics tab's data originates. Mirrors the official DiagnosticsDataSource. */
export type DiagnosticsDataSource = "server" | "client" | "server_script";

/** How a diagnostics tab renders. Mirrors the official DiagnosticsDisplayType. */
export type DiagnosticsDisplayType =
  | "line_chart"
  | "stacked_line_chart"
  | "stacked_bar_chart"
  | "table"
  | "multi_column_table"
  | "dynamic_properties_table";

/**
 * One native diagnostics tab descriptor, delivered by a v9+ SchemaEvent.
 * Field names mirror the official Mojang/minecraft-debugger
 * diagnostics-schema.ts DiagnosticsTabDescriptor verbatim (snake_case is the
 * Cereal wire format used by Minecraft). is_empty_tab is protocol v10
 * (SupportEmptyTabs): it flags a view that is INTENTIONALLY empty on this
 * target (e.g., client-only views on a dedicated server).
 */
export interface IDiagnosticsTabDescriptor {
  name: string;
  stat_group_id: string;
  data_source: DiagnosticsDataSource;
  display_type: DiagnosticsDisplayType;
  title?: string;
  y_label?: string;
  tick_range?: number;
  value_scalar?: number;
  target_value?: number;
  key_label?: string;
  value_labels?: string[];
  statistic_id?: string;
  statistic_ids?: string[];
  /**
   * When true (protocol v10+), the tab is intentionally empty on this target -
   * e.g. a client-only view when attached to a dedicated server. Render the tab
   * with an intentional empty state; this is NOT missing data.
   */
  is_empty_tab?: boolean;
}

/**
 * Diagnostics schema event (protocol v9+): Minecraft describes which
 * diagnostics views/tabs this target provides. Wire name "SchemaEvent"
 * (the official IncomingEventType.DiagnosticsDescriptor).
 */
export interface ISchemaEvent extends IDebugEvent {
  type: "SchemaEvent";
  descriptors: IDiagnosticsTabDescriptor[];
}

// ============================================================================
// Statistics Types (StatEvent2)
// ============================================================================

/**
 * Real-time statistics event from Minecraft.
 */
export interface IStatEvent extends IDebugEvent {
  type: "StatEvent2";
  tick: number;
  stats: IStatDataModel[];
}

/**
 * Hierarchical statistic data model.
 */
export interface IStatDataModel {
  name: string;
  children?: IStatDataModel[];
  values?: (number | string)[];
  should_aggregate: boolean;
}

/**
 * Flattened statistic data for processing.
 */
export interface IStatData {
  name: string;
  parent_name: string;
  id: string;
  full_id: string;
  parent_id: string;
  parent_full_id: string;
  values: (number | string)[];
  children_string_values: string[][];
  should_aggregate: boolean;
  tick: number;
}

// ============================================================================
// Command Types
// ============================================================================

/**
 * Minecraft command request.
 */
export interface IMinecraftCommandRequest {
  type: "minecraftCommand";
  command:
    | string
    | {
        command: string;
        dimension_type: "overworld" | "nether" | "the_end";
      };
  dimension_type?: "overworld" | "nether" | "the_end";
}

/**
 * Resume execution request.
 */
export interface IResumeRequest {
  type: "resume";
}

/**
 * Pause execution request.
 */
export interface IPauseRequest {
  type: "pause";
}

/**
 * Set breakpoint request.
 */
export interface ISetBreakpointRequest {
  type: "breakpoint";
  breakpoint: {
    path: string;
    line: number;
    column?: number;
  };
}

/**
 * Stop on exception configuration.
 */
export interface IStopOnExceptionRequest {
  type: "stopOnException";
  stopOnException: boolean;
}

/**
 * Start profiler request.
 */
export interface IStartProfilerRequest {
  type: "startProfiler";
  profiler: {
    target_module_uuid?: string;
  };
}

/**
 * Stop profiler request.
 */
export interface IStopProfilerRequest {
  type: "stopProfiler";
  profiler: {
    captures_path: string;
    target_module_uuid?: string;
  };
}

// ============================================================================
// Protocol Version Constants
// ============================================================================

/**
 * Protocol version history (mirrors the official Mojang/minecraft-debugger
 * protocol-events.ts ProtocolVersion enum):
 * 1  - Initial version
 * 2  - Add targetModuleUuid to protocol event
 * 3  - Add array of plugins and target module IDs
 * 4  - Minecraft can require passcode
 * 5  - Debugger can take profiler captures
 * 6  - Breakpoints as request (MC can reject)
 * 7  - Correlated debugger-request / debuggee-response messages
 * 8  - Cereal serialization: outbound command/profiler payloads flatten
 *      back to top-level fields (the v5-v7 nested shapes are pre-Cereal)
 * 9  - Native diagnostics descriptors (SchemaEvent) for schema-driven UI
 * 10 - is_empty_tab on DiagnosticsTabDescriptor (intentionally-empty views)
 */
export enum ProtocolVersion {
  Unknown = 0,
  Initial = 1,
  SupportTargetModuleUuid = 2,
  SupportTargetSelection = 3,
  SupportPasscode = 4,
  SupportProfilerCaptures = 5,
  SupportBreakpointsAsRequest = 6,
  SupportDebuggerRequests = 7,
  SupportCerealSerialization = 8,
  SupportNativeDescriptors = 9,
  SupportEmptyTabs = 10,
}

/** Oldest server protocol version MCT can talk to. */
export const MinSupportedProtocolVersion = ProtocolVersion.Initial;

/** Newest protocol version MCT implements; negotiation never exceeds this. */
export const MaxSupportedProtocolVersion = ProtocolVersion.SupportEmptyTabs;

/**
 * Capabilities based on negotiated protocol version.
 */
export interface IMinecraftDebugCapabilities {
  supportsCommands: boolean;
  supportsProfiler: boolean;
  supportsBreakpointsAsRequest: boolean;
  /** v7+: correlated debugger-request / debuggee-response round trips */
  supportsDebuggerRequests: boolean;
  /** v9+: native diagnostics SchemaEvent descriptors */
  supportsDiagnosticsSchema: boolean;
  /** v10+: is_empty_tab on diagnostics descriptors */
  supportsEmptyTabs: boolean;
}

// ============================================================================
// Client State Types
// ============================================================================

/**
 * Current state of the debug connection.
 */
export enum DebugConnectionState {
  Disconnected = "disconnected",
  Connecting = "connecting",
  Connected = "connected",
  Error = "error",
}

/**
 * Who currently owns (is attached to) the single-client Minecraft debug endpoint.
 * Minecraft's script debugger accepts only ONE attached debugger at a time, so
 * MCT and VS Code cannot both be attached to the same endpoint.
 */
export type DebugOwnershipState =
  /** No debugger is attached to the endpoint */
  | "unattached"
  /** MCT's debug client is attached and owns the endpoint */
  | "attachedByMct"
  /** Another debugger (typically VS Code) owns the endpoint; MCT cannot attach */
  | "attachedExternally"
  /** Ownership can't be determined (e.g., no debug session context) */
  | "unknown";

/**
 * Why the last debug attach attempt failed. Distinguishes transport-level
 * failures (no TCP connection was ever established: refused, timeout,
 * unreachable, listener not up yet) from handshake-level failures (the socket
 * was ACCEPTED but closed or went silent before Minecraft sent its
 * ProtocolEvent). Only the latter — on a listener Minecraft explicitly
 * confirmed — is positive evidence that the single-client endpoint is owned by
 * another debugger; transport failures have too many innocent causes
 * (startup races, firewalls, BDS shutting down) to blame anyone.
 */
export type DebugAttachFailureReason =
  /** TCP connect exhausted all retries without ever being accepted */
  | "connectFailed"
  /** TCP accepted, but the connection closed or timed out before the ProtocolEvent handshake completed */
  | "handshakeFailed";

/**
 * Debug session information.
 */
export interface IDebugSessionInfo {
  state: DebugConnectionState;
  host: string;
  port: number;
  protocolVersion: number;
  targetModuleUuid?: string;
  plugins: IPluginDetails[];
  capabilities: IMinecraftDebugCapabilities;
  lastStatTick?: number;
  errorMessage?: string;
  /** Last negotiated diagnostics schema (v9+ SchemaEvent); cleared on disconnect - a reconnect renegotiates */
  schema?: IDiagnosticsTabDescriptor[];
}

// ============================================================================
// Notification Types (for WebSocket broadcast)
// ============================================================================

/**
 * Debug notification for web clients.
 */
export interface IDebugNotification {
  type: "debugger";
  eventType: "connected" | "disconnected" | "stats" | "stopped" | "print" | "protocol" | "error";
  data: unknown;
  timestamp: number;
}

/**
 * Stats update notification.
 */
export interface IDebugStatsNotification extends IDebugNotification {
  eventType: "stats";
  data: {
    tick: number;
    stats: IStatData[];
  };
}

/**
 * Connection state notification.
 */
export interface IDebugConnectionNotification extends IDebugNotification {
  eventType: "connected" | "disconnected";
  data: IDebugSessionInfo;
}
