// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { RemoteServerAccessLevel } from "./ICreatorToolsData";
import {
  DebugOwnershipState,
  IDiagnosticsTabDescriptor,
  IMinecraftDebugCapabilities,
  IPluginDetails,
} from "../debugger/IMinecraftDebugProtocol";

export enum AuthenticationResult {
  pending = 0,
  success = 1,
  failed = 2,
  error = 3,
}

export interface CreatorToolsServerAuthenticationResult {
  token: string;
  iv: string;
  authTag?: string; // GCM authentication tag
  permissionLevel: RemoteServerAccessLevel;
  serverStatus: CreatorToolsServerStatus[];
  /** Whether the Minecraft EULA has been accepted (required for BDS features) */
  eulaAccepted?: boolean;
}

/**
 * Configuration for a server slot, returned once at connection time.
 * Contains settings that don't change frequently and shouldn't be
 * sent in every status update.
 */
export interface ISlotConfig {
  /** Whether the script debugger is enabled on the server (listening on port) */
  debuggerEnabled: boolean;
  /** Whether debug stats streaming is enabled (server connects and streams to web console) */
  debuggerStreamingEnabled: boolean;
  /** Server version string */
  serverVersion?: string;
  /** Debug session connection state: 'disconnected', 'connecting', 'connected', 'error' */
  debugConnectionState?: string;
  /** Debug protocol version if connected */
  debugProtocolVersion?: number;
  /** Last debug stat tick received */
  debugLastStatTick?: number;
  /** Debug connection error message if any */
  debugErrorMessage?: string;
  /** Debugger lifecycle stage snapshot (DebuggerLifecycleStage value) */
  debugStage?: string;
  /** Failure kind when debugStage is "failed" (DebuggerFailureKind value) */
  debugFailureKind?: string;
  /** Sanitized lifecycle error message when debugStage is "failed" */
  debugStageMessage?: string;
  /** UUID of the script module the debug session is targeting */
  debugTargetModuleUuid?: string;
  /** Script modules (plugins) available on the debug target */
  debugPlugins?: IPluginDetails[];
  /** Debug endpoint host */
  debugHost?: string;
  /** The dynamically reserved debug endpoint port */
  debugPort?: number;
  /** Capabilities of the negotiated debug protocol version */
  debugCapabilities?: IMinecraftDebugCapabilities;
  /** Who owns the single-client debug endpoint */
  debugOwnership?: DebugOwnershipState;
  /** Last negotiated diagnostics schema (protocol v9+); cleared on disconnect */
  debugSchema?: IDiagnosticsTabDescriptor[];
}

export interface CreatorToolsServerStatus {
  id: number;
  recentMessages?: { message: string; received: number }[];
  status?: DedicatedServerStatus;
  time: number;
  /** Slot configuration - included in initial connection, may be omitted in subsequent updates */
  slotConfig?: ISlotConfig;
  /** World ID currently associated with this slot */
  worldId?: string;
}

export enum DedicatedServerStatus {
  stopped = 1,
  deploying = 2,
  launching = 3,
  starting = 4,
  started = 5,
}

export default class CreatorToolsAuthentication {
  result: AuthenticationResult;
  permissionLevel: RemoteServerAccessLevel;

  constructor(result: AuthenticationResult, permissionLevel: RemoteServerAccessLevel) {
    this.result = result;
    this.permissionLevel = permissionLevel;
  }
}
