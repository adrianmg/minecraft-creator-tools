/**
 * Global Teardown for Server UI Tests
 *
 * This module stops the MCT server after all tests have completed.
 */
import * as fs from "fs";
import { getServerStateFiles, ServerUiTestStateNamespace } from "./serverui-test-state";

/**
 * Global teardown function called by Playwright after all tests.
 */
export async function stopServer(namespace: ServerUiTestStateNamespace = "full"): Promise<void> {
  const { portFile, slotFile } = getServerStateFiles(namespace);
  console.log("Stopping MCT server...");

  // Get the server process from global
  const serverProcess = global.__MCT_SERVER_PROCESS__;

  if (serverProcess) {
    // Kill the server process
    try {
      // On Windows, we need to kill the process tree
      if (process.platform === "win32") {
        const { spawn } = await import("child_process");
        // Use taskkill to kill the process tree
        spawn("taskkill", ["/pid", serverProcess.pid!.toString(), "/f", "/t"], {
          stdio: "ignore",
        });
      } else {
        // On Unix, send SIGTERM
        serverProcess.kill("SIGTERM");
      }
      console.log("MCT server stopped");
    } catch (err) {
      console.error("Error stopping MCT server:", err);
    }
  } else {
    console.log("No MCT server process found to stop");
  }

  // Clean up the port and slot files
  try {
    if (fs.existsSync(portFile)) {
      fs.unlinkSync(portFile);
    }
    if (fs.existsSync(slotFile)) {
      fs.unlinkSync(slotFile);
    }
  } catch {
    // Ignore cleanup errors
  }

  // Clear globals
  global.__MCT_SERVER_PROCESS__ = undefined;
  global.__MCT_SERVER_PORT__ = undefined;
  global.__MCT_SERVER_SLOT__ = undefined;
}

async function globalTeardown(): Promise<void> {
  await stopServer("full");
}

export default globalTeardown;
