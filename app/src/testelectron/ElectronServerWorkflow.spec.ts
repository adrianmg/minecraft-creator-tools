/**
 * ElectronServerWorkflow.spec.ts — Electron BDS IPC surface smoke test
 *
 * ARCHITECTURE DOCUMENTATION
 * ==========================
 *
 * Verifies the Electron app's dedicated-server IPC surface without starting a
 * real BDS process:
 *   1. Launch Electron app
 *   2. Assert the REAL preload bridge (window.api.send/receive) is present
 *   3. Check status via IPC (asyncgetDedicatedServerStatus) end to end
 *
 * STRICTNESS NOTE: an earlier version of this spec drove IPC through
 * `window.electron.ipcRenderer`, which does not exist under context isolation
 * (the preload exposes `window.api`), so every test silently resolved
 * "no-ipc-bridge" and passed without proving anything. All permissive
 * branches (no-ipc-bridge / timeout-to-success) have been removed: a missing
 * bridge or an unanswered request now FAILS.
 *
 * The full real-BDS lifecycle (start/command/debugger/stop, fault injection,
 * leak checks) is covered by the gated release-gate suite in
 * DebuggerRealBdsGate.spec.ts (npm run test-electron-debugger-gate); it is
 * deliberately NOT part of the default test-electron run because it downloads
 * and spawns a real BDS.
 *
 * IPC PROTOCOL (via the preload bridge):
 * - send:    window.api.send("appweb", "<command>|<numericRequestId>", data)
 *            (the preload parses the request id with parseInt)
 * - receive: window.api.receive("appsvc", handler) — completions arrive as
 *            "<command>Complete|<requestId>|<payload>"
 *
 * RELATED FILES:
 * - src/electron/preload.ts — the bridge under test
 * - src/electron/DedicatedServerCommandHandler.ts — IPC handler
 * - src/testelectron/DebuggerRealBdsGate.spec.ts — real-BDS release gate
 *
 * Run with: npm run test-electron
 */

import { test, expect, _electron as electron, ElectronApplication, Page } from "@playwright/test";
import path from "path";
import fs from "fs";
import os from "os";
import { takeScreenshot } from "../testshared/TestUtilities";

const appDir = process.cwd();
const electronMainPath = path.join(appDir, "toolbuild/jsn/electron/main.mjs");

const testSlug = `mct-srvtest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const testStorageDir = path.join(os.tmpdir(), testSlug);
const testUserDataDir = path.join(os.tmpdir(), `${testSlug}-userdata`);

const hasToolbuild = fs.existsSync(path.join(appDir, "toolbuild/jsn"));
const hasElectronMain = fs.existsSync(electronMainPath);
const isWindows = os.platform() === "win32";

test.describe("Electron Server Workflow", () => {
  let electronApp: ElectronApplication;
  let page: Page;

  test.setTimeout(120000);

  test.beforeAll(async () => {
    if (!isWindows) {
      console.log("Skipping: BDS requires Windows");
      test.skip();
      return;
    }

    if (!hasToolbuild || !hasElectronMain) {
      console.log("Skipping: Electron app not built. Run 'npm run jsnbuild' first.");
      test.skip();
      return;
    }

    console.log("Launching Electron app for server workflow test...");
    console.log("Test storage:", testStorageDir);

    electronApp = await electron.launch({
      args: [electronMainPath, `--user-data-dir=${testUserDataDir}`],
      cwd: appDir,
      env: {
        ...process.env,
        NODE_ENV: "test",
        ELECTRON_FORCE_PROD: "true",
        MCT_TEST_STORAGE_ROOT: testStorageDir,
        MCTOOLS_DATA_DIR: testStorageDir,
      },
      timeout: 60000,
    });

    electronApp.on("console", (msg) => {
      console.log(`[Electron] ${msg.text()}`);
    });

    page = await electronApp.firstWindow({ timeout: 30000 });

    page.on("crash", () => {
      console.log("[Electron] RENDERER CRASHED!");
    });

    await page.waitForLoadState("domcontentloaded");
  });

  test.afterAll(async () => {
    if (electronApp) {
      await electronApp.close();
    }

    // Clean up test storage
    try {
      if (fs.existsSync(testStorageDir)) {
        fs.rmSync(testStorageDir, { recursive: true, force: true });
      }
      if (fs.existsSync(testUserDataDir)) {
        fs.rmSync(testUserDataDir, { recursive: true, force: true });
      }
    } catch {
      console.log("Note: Could not clean up test directories");
    }
  });

  test("should launch Electron app successfully", async () => {
    const title = await page.title();
    console.log("App title:", title);

    await takeScreenshot(page, "server-workflow-app-launched");
    expect(page).toBeTruthy();
  });

  test("should expose the preload API bridge", async () => {
    // The preload exposes window.api (send/receive/invoke) under context
    // isolation. A missing bridge means the renderer cannot reach any
    // dedicated-server or debugger IPC at all — a hard failure.
    const bridgeShape = await page.evaluate(() => {
      const api = (window as any).api;
      return {
        hasApi: typeof api !== "undefined",
        hasSend: typeof api?.send === "function",
        hasReceive: typeof api?.receive === "function",
      };
    });

    console.log("Preload bridge shape:", JSON.stringify(bridgeShape));

    expect(bridgeShape.hasApi, "window.api must be exposed by the preload").toBe(true);
    expect(bridgeShape.hasSend, "window.api.send must be a function").toBe(true);
    expect(bridgeShape.hasReceive, "window.api.receive must be a function").toBe(true);

    const isMainProcessAccessible = await electronApp.evaluate(({ app }) => {
      return app.isReady();
    });

    expect(isMainProcessAccessible).toBe(true);
  });

  test("should get server status via IPC", async () => {
    // Round-trip a status request through the REAL preload bridge. The
    // request must complete — a timeout REJECTS (fails the test), it is
    // never converted into success.
    const statusResult = await page.evaluate(async () => {
      return new Promise<string>((resolve, reject) => {
        // High id: the appsvc pipe is shared with the app's own
        // AppServiceProxy, which matches completions purely by numeric
        // position — a low id could resolve one of the app's requests.
        const requestId = 990042;
        const prefix = "asyncgetDedicatedServerStatusComplete|" + requestId + "|";

        (window as any).api.receive("appsvc", (data: unknown) => {
          const text = String(data);
          if (text.startsWith(prefix)) {
            resolve(text.substring(prefix.length));
          }
        });

        try {
          (window as any).api.send("appweb", "asyncgetDedicatedServerStatus|" + requestId, "");
        } catch (e) {
          reject(new Error("IPC send failed: " + e));
          return;
        }

        setTimeout(() => reject(new Error("Timed out waiting for the status completion")), 15000);
      });
    });

    console.log("Server status:", statusResult);

    // -1 means no server exists, which is expected before any start.
    expect(statusResult).toBe("-1");

    await takeScreenshot(page, "server-workflow-status-check");
  });
});
