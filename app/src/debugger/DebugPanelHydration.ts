// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * DebugPanelHydration.ts
 *
 * Guards the diagnostics panel's late-mount hydration against races with
 * live session events.
 *
 * The panel hydrates by fetching a slot-config snapshot (REST /status in web
 * mode, the debug-status IPC in Electron mode). That request is asynchronous:
 * by the time its response arrives, a live event (disconnect, schema,
 * reconnect) may have advanced the session, or the panel may have been
 * repointed at a different server / Minecraft instance entirely. Applying the
 * older snapshot then would regress newer live state - restoring a stale
 * connection, ownership, capabilities, or schema.
 *
 * HydrationGate makes snapshot application monotonic relative to live events
 * AND to other hydration requests: every live session event and every
 * transport swap bumps a generation, every begun request gets a monotonic
 * request id, and a snapshot may only be applied if the generation and the
 * source it was requested from are unchanged AND no NEWER request has already
 * applied its snapshot. Live events always win over an older in-flight
 * snapshot, and of overlapping same-source requests (the panel legitimately
 * starts one from mount and another from the subscribe path) application is
 * newest-wins: an older response resolving after a newer one applied is
 * discarded, but merely BEGINNING a newer request does not invalidate an
 * older one - if the newer fetch fails or returns empty while the older
 * succeeds, the older usable snapshot still applies (nothing retries after
 * _hasSubscribed sticks, so discarding it would strand an idle connected
 * session at "Connecting..."). A superseded snapshot is discarded, never
 * merged.
 *
 * Used by DebugStatsPanel.tsx; kept free of React/UX imports so the staleness
 * semantics stay unit-testable in the node test suite.
 */

/** Request context captured when one hydration attempt begins. */
export interface IHydrationToken {
  generation: number;
  source: unknown;
  /** Monotonic id of this request; superseded once a newer request APPLIES */
  requestId: number;
}

export class HydrationGate {
  private _generation: number = 0;
  private _source: unknown;
  private _nextRequestId: number = 0;
  private _lastAppliedRequestId: number = 0;

  /**
   * Record the transport (HttpStorage / ProcessHostedMinecraft instance) the
   * panel currently hydrates from. Changing the source supersedes any
   * in-flight hydration: a snapshot fetched from the previous server/session
   * identity must not be applied to the new one.
   */
  setSource(source: unknown): void {
    if (source !== this._source) {
      this._source = source;
      this._generation++;
    }
  }

  /**
   * Record a live session event (connected, disconnected, schema). Any
   * hydration request begun before this point is now stale: its snapshot
   * predates the event and applying it would regress the newer live state.
   */
  noteSessionEvent(): void {
    this._generation++;
  }

  /** Begin a hydration request against the current source. */
  begin(): IHydrationToken {
    this._nextRequestId++;
    return { generation: this._generation, source: this._source, requestId: this._nextRequestId };
  }

  /**
   * Whether a snapshot requested under `token` may still be applied. A newer
   * overlapping request supersedes an older one only by APPLYING a usable
   * snapshot - beginning (and then failing or returning empty) must not, or
   * the older usable response would be discarded with nothing left to retry.
   */
  shouldApply(token: IHydrationToken): boolean {
    return (
      token.generation === this._generation &&
      token.source === this._source &&
      token.requestId > this._lastAppliedRequestId
    );
  }

  /** Record that `token`'s snapshot was applied, superseding older requests. */
  noteApplied(token: IHydrationToken): void {
    if (token.requestId > this._lastAppliedRequestId) {
      this._lastAppliedRequestId = token.requestId;
    }
  }
}

export type HydrationOutcome = "applied" | "discarded" | "empty" | "failed";

/**
 * Run one hydration attempt: capture the request context, await the snapshot,
 * and apply it only if no live session event or source swap superseded the
 * request while it was in flight.
 */
export async function applyHydrationSnapshot<T>(
  gate: HydrationGate,
  fetchSnapshot: () => Promise<T | undefined>,
  apply: (snapshot: T) => void
): Promise<HydrationOutcome> {
  const token = gate.begin();

  let snapshot: T | undefined;
  try {
    snapshot = await fetchSnapshot();
  } catch {
    return "failed";
  }

  if (snapshot === undefined) {
    return "empty";
  }

  if (!gate.shouldApply(token)) {
    return "discarded";
  }

  apply(snapshot);
  gate.noteApplied(token);
  return "applied";
}
