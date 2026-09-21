// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * DebugPortRegistry
 *
 * Selects and reserves collision-free dynamic ports for the script debugger.
 *
 * Two collision sources are handled:
 * - In-process: two server slots (or a retry racing a stop) picking the same
 *   port. Prevented by an in-process reservation map keyed by owner.
 * - External: another process (VS Code minecraft-debugger, a zombie BDS)
 *   already bound to the port. Detected by briefly binding a probe listener
 *   just before the port is handed out.
 *
 * A reservation does not hold the OS port open (BDS itself needs to bind it);
 * it prevents MCT from handing the same port to two flows, and the bind probe
 * catches external occupants at selection time.
 *
 * Claims are tokenized: reserve() returns a handle carrying a unique claim
 * token, and release(handle) only removes the reservation if that token still
 * owns it. This is what makes same-owner supersession safe: when a retry or
 * restart re-reserves for the same owner, the newest attempt takes over the
 * claim under a fresh token, and the superseded attempt's late release
 * becomes a no-op instead of dropping the active reservation. A claim whose
 * initial bind probe is still in flight is TENTATIVE - a same-owner re-entry
 * shares that pending probe rather than trusting the unconfirmed claim, so a
 * replacement attempt can never issue a listen command on a port the probe
 * later reports as occupied.
 */

import { createServer } from "net";
import Log from "../core/Log";

// Slots are spaced 32 ports apart (base 19132, 19164, ...) and the preferred
// debug port is base + 12, so up to 20 candidates fit before the next slot.
const MAX_PORT_CANDIDATES = 20;

/**
 * Handle returned by reserve(). The token scopes release to the attempt that
 * (last) claimed the port: a stale handle from a superseded attempt cannot
 * release the current claim.
 */
export interface IDebugPortReservation {
  port: number;
  token: number;
}

interface IPortClaim {
  owner: string;
  token: number;
  // Present only while the initial bind probe for this claim is in flight.
  // While set, the claim is tentative: it blocks other owners, but a
  // same-owner re-entry must await this probe instead of treating the claim
  // as confirmed.
  pendingProbe?: Promise<boolean>;
}

export default class DebugPortRegistry {
  private static _reservations = new Map<number, IPortClaim>();
  private static _nextClaimToken = 1;

  /**
   * Probe one loopback family: "free" (bind succeeded), "occupied" (in use /
   * access denied), or "unavailable" (the address family itself does not
   * exist on this machine - e.g., IPv6 disabled).
   */
  private static probeFamily(port: number, host: string): Promise<"free" | "occupied" | "unavailable"> {
    return new Promise((resolve) => {
      const probe = createServer();

      probe.once("error", (e: NodeJS.ErrnoException) => {
        if (e.code === "EADDRNOTAVAIL" || e.code === "EAFNOSUPPORT" || e.code === "EINVAL") {
          resolve("unavailable");
        } else {
          resolve("occupied");
        }
      });

      probe.once("listening", () => {
        probe.close(() => resolve("free"));
      });

      probe.listen(port, host);
    });
  }

  /**
   * Check whether a TCP port can be bound on BOTH loopback families. The
   * debug client connects to "localhost", which may resolve to ::1 before
   * 127.0.0.1, so an occupant bound only on IPv6 loopback (a VS Code
   * debugger, a zombie process) must fail the probe too - an IPv4-only
   * probe would hand out a port whose IPv6 endpoint is already taken. A
   * family that is unavailable on this machine (IPv6 disabled) is skipped
   * rather than treated as occupied.
   */
  public static async isPortFree(port: number): Promise<boolean> {
    const ipv4 = await this.probeFamily(port, "127.0.0.1");

    if (ipv4 === "occupied") {
      return false;
    }

    const ipv6 = await this.probeFamily(port, "::1");

    return ipv6 !== "occupied";
  }

  private static logFallback(preferredPort: number, candidate: number) {
    if (candidate !== preferredPort) {
      Log.message(`[Debug] Preferred debugger port ${preferredPort} unavailable; using ${candidate} instead.`);
    }
  }

  /**
   * Reserve a free port at or after preferredPort for the given owner.
   * Returns a tokenized reservation handle, or undefined if no candidate was
   * free. Re-reserving with the same owner is allowed (retry/supersession):
   * the newest call takes over the claim under a fresh token, and any handle
   * a prior attempt still holds becomes stale - its release() no-ops.
   */
  public static async reserve(preferredPort: number, ownerKey: string): Promise<IDebugPortReservation | undefined> {
    for (let i = 0; i < MAX_PORT_CANDIDATES; i++) {
      const candidate = preferredPort + i;
      const existing = this._reservations.get(candidate);

      if (existing !== undefined && existing.owner !== ownerKey) {
        continue;
      }

      if (existing !== undefined) {
        if (existing.pendingProbe !== undefined) {
          // Tentative same-owner claim: an earlier attempt inserted it but
          // its bind probe has not resolved yet. Share that probe rather
          // than trusting the unconfirmed claim - returning immediately
          // would let a replacement attempt issue a listen command on a
          // port the probe may yet report as externally occupied.
          const free = await existing.pendingProbe;
          const current = this._reservations.get(candidate);

          if (!free || current === undefined || current.owner !== ownerKey) {
            // Occupied (the probing attempt withdraws the claim), or the
            // claim was released and re-taken by another owner meanwhile.
            continue;
          }
        }

        // Confirmed same-owner claim - presumed in use by our own listener
        // (e.g., BDS bound it after a prior listen command), so no bind
        // probe. Take it over under a fresh token so the superseded
        // attempt's late release cannot drop this reservation.
        const token = this._nextClaimToken++;
        this._reservations.set(candidate, { owner: ownerKey, token: token });
        this.logFallback(preferredPort, candidate);

        return { port: candidate, token: token };
      }

      // Claim the candidate synchronously BEFORE the async bind probe. The
      // map IS the in-process collision guarantee: with a check->await->set
      // sequence, two owners can both read the port as unclaimed, yield in
      // the probe, and both set it - handing the same port to two flows. The
      // probe below only screens for EXTERNAL occupants. The claim carries
      // the pending probe so a same-owner re-entry can share it.
      const token = this._nextClaimToken++;
      const probe = this.isPortFree(candidate);
      this._reservations.set(candidate, { owner: ownerKey, token: token, pendingProbe: probe });

      const free = await probe;
      const current = this._reservations.get(candidate);

      if (current === undefined || current.token !== token) {
        // While probing, the claim was released, or taken over by a newer
        // same-owner attempt (which shared this probe and now owns the
        // port). Either way it is no longer this attempt's to confirm or
        // withdraw.
        continue;
      }

      if (free) {
        // Confirm the claim: drop the pending-probe marker.
        this._reservations.set(candidate, { owner: ownerKey, token: token });
        this.logFallback(preferredPort, candidate);

        return { port: candidate, token: token };
      }

      // Externally occupied: withdraw the claim and try the next candidate.
      this._reservations.delete(candidate);
    }

    return undefined;
  }

  /**
   * Release a reservation. Conditional on the handle's token: if a newer
   * attempt has taken over the claim (or the port was released and re-issued),
   * a stale handle no-ops instead of dropping the active reservation.
   */
  public static release(reservation: IDebugPortReservation | undefined): void {
    if (reservation === undefined) {
      return;
    }

    const current = this._reservations.get(reservation.port);

    if (current !== undefined && current.token === reservation.token) {
      this._reservations.delete(reservation.port);
    }
  }

  /**
   * Release all reservations held by an owner (e.g., on server teardown).
   * Unconditional: teardown outranks any in-flight attempt's token.
   */
  public static releaseAllForOwner(ownerKey: string): void {
    for (const [port, claim] of this._reservations) {
      if (claim.owner === ownerKey) {
        this._reservations.delete(port);
      }
    }
  }

  public static reservedBy(port: number): string | undefined {
    return this._reservations.get(port)?.owner;
  }
}
