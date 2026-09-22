// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { EventDispatcher, IEvent } from "ste-events";
import Log from "../core/Log";

/**
 * Parses the Minecraft debug protocol message stream.
 *
 * The protocol uses length-prefixed messages:
 * - 8 hex digits for length + newline (9 bytes total)
 * - JSON message body + newline
 *
 * Example:
 * ```
 * 00000042\n
 * {"type":"event","event":{"type":"StatEvent2",...}}\n
 * ```
 */
/**
 * Upper bound on a single frame's declared length. Real protocol messages
 * (profiler captures included) stay far below this; a larger value almost
 * certainly means the stream is not the Minecraft debug protocol, and
 * waiting for it to "complete" would hang the session forever.
 */
export const MAX_DEBUG_MESSAGE_LENGTH = 64 * 1024 * 1024;

export default class DebugMessageStreamParser {
  private _buffer: Buffer = Buffer.alloc(0);
  private _expectedLength: number = -1;

  /**
   * Set on the first framing/JSON error and cleared only by reset(). Every
   * onError is session-fatal upstream (the client destroys the socket), so
   * frames buffered BEHIND a malformed one must never be delivered: a valid
   * StatEvent2 in the same socket chunk would otherwise publish stale stats
   * into a session that just disconnected.
   */
  private _fatalError: boolean = false;

  private _onMessage = new EventDispatcher<DebugMessageStreamParser, unknown>();
  private _onError = new EventDispatcher<DebugMessageStreamParser, Error>();

  public get onMessage(): IEvent<DebugMessageStreamParser, unknown> {
    return this._onMessage.asEvent();
  }

  public get onError(): IEvent<DebugMessageStreamParser, Error> {
    return this._onError.asEvent();
  }

  /**
   * Feed data from the socket into the parser.
   */
  public write(data: Buffer): void {
    // A fatal error already ended this stream; drop late socket data
    // instead of parsing it into a dead session.
    if (this._fatalError) {
      return;
    }

    // Append new data to buffer
    this._buffer = Buffer.concat([this._buffer, data]);

    // Process as many complete messages as possible
    while (this._processBuffer()) {
      // Continue processing
    }
  }

  /**
   * Enter the dead state: dispatch the error, drop everything buffered
   * (including any frames queued behind the malformed one), and stop
   * parsing until reset(). Returns false to end the processing loop.
   */
  private _failFatally(error: Error): false {
    this._fatalError = true;
    this._buffer = Buffer.alloc(0);
    this._expectedLength = -1;

    this._onError.dispatch(this, error);

    return false;
  }

  /**
   * Process the buffer and extract a complete message if available.
   * Returns true if a message was processed (and we should continue checking).
   */
  private _processBuffer(): boolean {
    // If we don't know the expected length yet, try to read it
    if (this._expectedLength < 0) {
      // Need at least 9 bytes for length header (8 hex + newline)
      if (this._buffer.length < 9) {
        return false;
      }

      // Read the length header
      const lengthStr = this._buffer.subarray(0, 8).toString("ascii");
      const newline = this._buffer[8];

      if (newline !== 0x0a) {
        // Not a valid length header, report an actionable error: show what
        // arrived so a mis-speaking peer (wrong port, non-debug protocol)
        // is diagnosable from the message alone. Fatal: the upstream client
        // tears the session down on this error, so byte-skipping "resync"
        // would only spam errors and deliver frames into a dead session.
        return this._failFatally(
          new Error(
            `Malformed frame header: expected 8 hex digits + newline, got "${this._buffer
              .subarray(0, 9)
              .toString("ascii")
              .replace(/\n/g, "\\n")}" - the peer is not speaking the Minecraft debug protocol framing.`
          )
        );
      }

      // Strict 8-hex-digit check: parseInt alone would silently accept
      // trailing garbage (parseInt("0000004Z", 16) === 4).
      if (!/^[0-9a-fA-F]{8}$/.test(lengthStr)) {
        return this._failFatally(
          new Error(`Malformed frame length "${lengthStr}": expected exactly 8 hexadecimal digits.`)
        );
      }

      this._expectedLength = parseInt(lengthStr, 16);

      if (this._expectedLength > MAX_DEBUG_MESSAGE_LENGTH) {
        return this._failFatally(
          new Error(
            `Frame length ${this._expectedLength} exceeds the ${MAX_DEBUG_MESSAGE_LENGTH}-byte maximum - ` +
              `refusing to wait for it (the stream is likely not the Minecraft debug protocol).`
          )
        );
      }

      // Remove length header from buffer
      this._buffer = this._buffer.subarray(9);
    }

    // Check if we have enough data for the message
    if (this._buffer.length < this._expectedLength) {
      return false;
    }

    // Extract the message (length includes trailing newline)
    const messageBytes = this._buffer.subarray(0, this._expectedLength);
    this._buffer = this._buffer.subarray(this._expectedLength);

    // Parse the JSON (trim trailing newline). ONLY the parse sits inside
    // this try: onError signals malformed PEER input and terminates the
    // session upstream, so a throwing downstream subscriber (ste-events
    // dispatches synchronously without catching) must never be classified
    // as a protocol error.
    const jsonStr = messageBytes.toString("utf8").trim();

    let message: unknown;

    try {
      message = JSON.parse(jsonStr);
    } catch (e) {
      Log.message(`[DebugParser] JSON parse error: ${e}`);

      // Fatal: onError synchronously tears the session down upstream, so a
      // valid frame buffered behind this one (same socket chunk) must NOT
      // be delivered - it would publish stale stats into a session that
      // just disconnected.
      return this._failFatally(
        new Error(`Malformed frame body: not valid JSON (${e}). First bytes: "${jsonStr.substring(0, 80)}"`)
      );
    }

    // Log raw message receipt (truncate large messages) - use verbose since this fires frequently
    const msgType = (message as any)?.type || "unknown";
    const eventType = (message as any)?.event?.type || "";
    const preview = jsonStr.length > 200 ? jsonStr.substring(0, 200) + "..." : jsonStr;
    Log.verbose(
      `[DebugParser] Received ${msgType}${eventType ? "/" + eventType : ""} (${jsonStr.length} bytes): ${preview}`
    );

    try {
      this._onMessage.dispatch(this, message);
    } catch (e) {
      // A consumer failure over a VALID frame: the stream itself is healthy,
      // so surface the bug without dispatching onError - one throwing event
      // handler must not tear down the debug session or reject its pending
      // requests.
      Log.error(`[DebugParser] A message subscriber threw while handling ${msgType}${eventType ? "/" + eventType : ""}: ${e}`);
    }

    // Reset for next message
    this._expectedLength = -1;

    return true;
  }

  /**
   * Reset the parser state. Also revives a parser that went dead on a
   * fatal framing/JSON error - called when a new session begins.
   */
  public reset(): void {
    this._buffer = Buffer.alloc(0);
    this._expectedLength = -1;
    this._fatalError = false;
  }
}
