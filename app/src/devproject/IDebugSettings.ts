// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export default interface IDebugSettings {
  /**
   * Debug transport mode intent for the managed configuration, TRI-STATE
   * like `host`:
   * - undefined: this caller expresses NO mode intent, and the managed
   *   configuration's existing mode is PRESERVED. Generic passes with no
   *   mode knowledge (project autogeneration/save, project setup) must not
   *   flip a connect-mode server profile back to listen (or vice versa) -
   *   only mode-aware boundaries (the deployment boundary, the project
   *   updater) are authoritative for mode. A NEWLY CREATED configuration
   *   with no mode intent defaults to listen (the local-game default).
   * - true: connect-mode server profile (mode field removed).
   * - false: listen-mode profile for the local game (mode: "listen").
   */
  isServer?: boolean;
  port?: number;
  /** Server slot; used to derive the debug port (19144 + slot * 32) when no explicit port is set. */
  slot?: number;
  /**
   * Debuggee host for connect-mode configurations.
   *
   * The generated minecraft-js configuration's host field is managed under a
   * TRI-STATE contract:
   * - undefined: this caller expresses NO host intent, and the
   *   configuration's existing host (local or remote) is PRESERVED.
   *   Authoritative update paths that carry no persisted host setting (e.g.
   *   the generic project updater's ensureMinecraftDebugConfig pass) must
   *   not erase a valid remote endpoint on their next pass.
   * - an explicit "localhost": selects localhost, represented by REMOVING
   *   the field so a stale remote host is never left behind and a later
   *   local attach cannot target the previous machine. Boundaries that KNOW
   *   the debuggee is local - starting the built-in local BDS - must pass
   *   this explicitly rather than undefined, or a managed profile left
   *   pointing at a remote machine survives and F5 attaches to it.
   * - an explicit remote host: applied to the configuration
   *   (comparison is case-insensitive).
   */
  host?: string;
  behaviorPackFolderName?: string;
}
