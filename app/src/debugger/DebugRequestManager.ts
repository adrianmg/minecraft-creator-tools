// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * DebugRequestManager
 *
 * Owns the correlated request/response bookkeeping for the Minecraft debug
 * protocol's v7+ debugger-request / debuggee-response messages (and the
 * legacy DAP-style "response" envelope, which correlates the same way):
 *
 * - Monotonic request_seq allocation
 * - Pending-response registration with per-request timeout
 * - Resolution/rejection from a correlated response
 * - Detection of invalid correlation (a response no pending request matches)
 * - Bulk rejection on disconnect so no pending promise leaks or hangs
 *
 * Kept free of socket/transport concerns so the correlation semantics are
 * unit-testable in isolation. MinecraftDebugClient owns the transport and
 * feeds responses in.
 */

/** Why a tracked request failed. */
export type DebugRequestFailureKind = "rejected" | "timeout" | "disconnected" | "sendFailure";

/**
 * Error a tracked request rejects with. `kind` distinguishes a Minecraft-
 * reported failure ("rejected") from a local timeout or disconnect, so
 * callers can offer the right recovery.
 */
export class DebugRequestError extends Error {
  constructor(
    message: string,
    public readonly kind: DebugRequestFailureKind,
    public readonly command: string,
    public readonly requestSeq: number
  ) {
    super(message);
    this.name = "DebugRequestError";
  }
}

interface IPendingDebugRequest {
  command: string;
  resolve: (body: unknown) => void;
  reject: (error: DebugRequestError) => void;
  timeoutHandle: ReturnType<typeof setTimeout> | undefined;
}

/** Default time a correlated request may await its response. */
export const DEBUG_REQUEST_TIMEOUT_MS = 10000;

export default class DebugRequestManager {
  private _nextRequestSeq: number = 1;
  private _pending = new Map<number, IPendingDebugRequest>();

  /** Number of requests currently awaiting a response. */
  public get pendingCount(): number {
    return this._pending.size;
  }

  /** Allocate the next request sequence number (monotonic, never reused). */
  public allocateSequence(): number {
    return this._nextRequestSeq++;
  }

  /**
   * Track a sent request: returns a promise that settles when a correlated
   * response arrives (resolveResponse), the timeout elapses, or the session
   * disconnects (rejectAll). The caller sends the wire message itself.
   */
  public track(requestSeq: number, command: string, timeoutMs: number = DEBUG_REQUEST_TIMEOUT_MS): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        this._pending.delete(requestSeq);
        reject(
          new DebugRequestError(
            `Debug request '${command}' (request_seq ${requestSeq}) timed out after ${timeoutMs}ms - ` +
              `Minecraft did not send a correlated response. The session may be stalled or the request unsupported.`,
            "timeout",
            command,
            requestSeq
          )
        );
      }, timeoutMs);

      this._pending.set(requestSeq, {
        command: command,
        resolve: resolve,
        reject: reject,
        timeoutHandle: timeoutHandle,
      });
    });
  }

  /**
   * Feed a correlated response in. Mirrors the official request-manager's
   * settlement (`if (!envelope.success) reject`): a response resolves ONLY
   * on an explicit success === true; an absent or false success rejects
   * with the peer's message or a default failure. A malformed response - or
   * a failed one that carries response_message but omits success - must
   * never be reported to callers as success. Returns false when no pending
   * request matches requestSeq - an invalid correlation the caller should
   * surface as an actionable error.
   */
  public resolveResponse(requestSeq: number, success: boolean | undefined, body: unknown, message?: string): boolean {
    const pending = this._pending.get(requestSeq);

    if (pending === undefined) {
      return false;
    }

    this._pending.delete(requestSeq);

    if (pending.timeoutHandle !== undefined) {
      clearTimeout(pending.timeoutHandle);
    }

    if (success !== true) {
      pending.reject(
        new DebugRequestError(
          `Debug request '${pending.command}' (request_seq ${requestSeq}) failed` +
            (message
              ? `: ${message}`
              : success === false
                ? ": rejected by Minecraft."
                : ": the response did not report success."),
          "rejected",
          pending.command,
          requestSeq
        )
      );
    } else {
      pending.resolve(body);
    }

    return true;
  }

  /**
   * Reject ONE tracked request immediately because its wire message could
   * not be sent (serialization or socket-write failure): removes it, clears
   * its timeout, and rejects its promise now - a request that never went
   * out must not sit pending until the timeout fires against a response
   * that can never arrive. Returns false when requestSeq is not pending.
   */
  public rejectSendFailure(requestSeq: number, reason: string): boolean {
    const pending = this._pending.get(requestSeq);

    if (pending === undefined) {
      return false;
    }

    this._pending.delete(requestSeq);

    if (pending.timeoutHandle !== undefined) {
      clearTimeout(pending.timeoutHandle);
    }

    pending.reject(
      new DebugRequestError(
        `Debug request '${pending.command}' (request_seq ${requestSeq}) could not be sent: ${reason}`,
        "sendFailure",
        pending.command,
        requestSeq
      )
    );

    return true;
  }

  /**
   * Reject every pending request (disconnect cleanup). All timeouts are
   * cleared and the map emptied, so nothing leaks or fires later.
   */
  public rejectAll(reason: string): void {
    for (const [requestSeq, pending] of this._pending) {
      if (pending.timeoutHandle !== undefined) {
        clearTimeout(pending.timeoutHandle);
      }

      pending.reject(
        new DebugRequestError(
          `Debug request '${pending.command}' (request_seq ${requestSeq}) canceled: ${reason}`,
          "disconnected",
          pending.command,
          requestSeq
        )
      );
    }

    this._pending.clear();
  }
}
