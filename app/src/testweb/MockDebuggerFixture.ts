// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * MockDebuggerFixture
 *
 * A minimal, self-contained stand-in for Minecraft's script debugger listener,
 * used by Playwright server-UI tests to drive the MCT server's debug client
 * into a REAL connected v10 session without needing a Bedrock Dedicated
 * Server. The standard server-UI setup starts only the MCT HTTP server, so
 * without this fixture the connected/v9+ diagnostics payload would never be
 * exercised in CI.
 *
 * Flow (mirrors a real Minecraft debug listener):
 * 1. Listen on the slot's debug port (base Minecraft port + 12 - see
 *    DedicatedServer.debugPort; base port is 19132 + slot * 32).
 * 2. The test POSTs /api/{slot}/debug/reattach; the server's
 *    MinecraftDebugClient connects here.
 * 3. On connect, send ProtocolEvent (negotiates the protocol version).
 * 4. When the client's protocol response arrives, send SchemaEvent with the
 *    configured descriptors and start streaming StatEvent2 ticks.
 *
 * Wire format (see DebugMessageStreamParser): each message is an 8-hex-digit
 * length + "\n", then the JSON body + "\n" (the length includes the trailing
 * newline). This file deliberately imports NOTHING from app source - only
 * node:net - so the Playwright transpile never pulls the app module graph.
 */

import { createServer, Server, Socket } from "net";

export interface IMockDebuggerFixtureOptions {
  /** TCP port to listen on (the slot's debug port) */
  port: number;
  /** Protocol version to negotiate (default 10) */
  protocolVersion?: number;
  /** SchemaEvent descriptors to send once the handshake completes */
  descriptors?: unknown[];
}

export class MockDebuggerFixture {
  private _server: Server | undefined;
  private _sockets: Socket[] = [];
  private _statInterval: ReturnType<typeof setInterval> | undefined;
  private _tick = 0;
  private readonly _port: number;
  private readonly _protocolVersion: number;
  private readonly _descriptors: unknown[];

  constructor(options: IMockDebuggerFixtureOptions) {
    this._port = options.port;
    this._protocolVersion = options.protocolVersion ?? 10;
    this._descriptors = options.descriptors ?? [];
  }

  get port(): number {
    return this._port;
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this._server = createServer((socket) => {
        this._sockets.push(socket);
        socket.on("error", () => {
          // Teardown resets are expected; never fail the test from here.
        });
        socket.on("close", () => {
          const index = this._sockets.indexOf(socket);
          if (index >= 0) {
            this._sockets.splice(index, 1);
          }
        });

        // Real Minecraft sends ProtocolEvent as soon as a debugger attaches.
        this._send(socket, {
          type: "event",
          event: {
            type: "ProtocolEvent",
            version: this._protocolVersion,
            plugins: [{ module_uuid: "serverui-test-module-uuid", name: "ServerUiTestPlugin" }],
          },
        });

        // The client answers ProtocolEvent with its protocol response; the
        // first inbound bytes therefore mean the handshake completed. Send
        // the diagnostics schema and start streaming stat ticks, like a real
        // v9+ target does after negotiation.
        socket.once("data", () => {
          this._send(socket, {
            type: "event",
            event: { type: "SchemaEvent", descriptors: this._descriptors },
          });

          this._statInterval = setInterval(() => {
            this._tick += 20;
            this._send(socket, {
              type: "event",
              event: {
                type: "StatEvent2",
                tick: this._tick,
                stats: [
                  {
                    name: "worldTick",
                    parent_name: "server_tick_timings",
                    id: "worldtick",
                    full_id: "server_tick_timings_worldtick",
                    parent_id: "server_tick_timings",
                    parent_full_id: "server_tick_timings",
                    values: [1.5],
                    children_string_values: [],
                    should_aggregate: false,
                    tick: this._tick,
                  },
                ],
              },
            });
          }, 250);
        });
      });

      this._server.on("error", reject);
      this._server.listen(this._port, "localhost", () => resolve());
    });
  }

  async stop(): Promise<void> {
    if (this._statInterval) {
      clearInterval(this._statInterval);
      this._statInterval = undefined;
    }
    for (const socket of this._sockets) {
      socket.destroy();
    }
    this._sockets = [];

    return new Promise((resolve) => {
      if (this._server) {
        this._server.close(() => {
          this._server = undefined;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  private _send(socket: Socket, envelope: unknown): void {
    if (socket.destroyed) {
      return;
    }
    const jsonBuffer = Buffer.from(JSON.stringify(envelope));
    const messageLength = jsonBuffer.byteLength + 1;
    const lengthStr = ("00000000" + messageLength.toString(16)).slice(-8) + "\n";
    socket.write(Buffer.concat([Buffer.from(lengthStr), jsonBuffer, Buffer.from("\n")]));
  }
}
