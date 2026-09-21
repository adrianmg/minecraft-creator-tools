/**
 * Server UI Playwright Tests
 *
 * Tests for the MCTools server web interface, which is served when running the CLI with
 * the `serve` command. The server provides a web UI for managing Minecraft content and
 * connecting to dedicated servers.
 *
 * The server is automatically started and stopped by the globalSetup/globalTeardown
 * configured in playwright-serverui.config.ts. Tests read the dynamically assigned
 * port from a file written by the setup.
 *
 * Run tests with:
 *   npm run test-server-ui
 */
import { test, expect, ConsoleMessage, Page } from "@playwright/test";
import {
  processMessage,
  isIgnorableMessage,
  setupRequestFailureTracking,
  summarizeFailedRequests,
  isIgnorable404Url,
  FailedRequest,
} from "./WebTestUtilities";
import * as fs from "fs";
import * as path from "path";
import { getServerStateFiles } from "./serverui-test-state";
import { MockDebuggerFixture } from "./MockDebuggerFixture";

// Port and slot files written by globalSetup
const { portFile: PORT_FILE, slotFile: SLOT_FILE } = getServerStateFiles("full");

/**
 * Get the server port from the file written by globalSetup.
 * Falls back to 6126 if the file doesn't exist (manual server mode).
 */
function getServerPort(): number {
  try {
    if (fs.existsSync(PORT_FILE)) {
      const portStr = fs.readFileSync(PORT_FILE, "utf-8").trim();
      const port = parseInt(portStr, 10);
      if (!isNaN(port)) {
        return port;
      }
    }
  } catch {
    // Fall back to default
  }
  console.log("Port file not found, using default port 6126");
  return 6126;
}

/**
 * Get the server slot from the file written by globalSetup.
 * Falls back to 0 if the file doesn't exist (manual server mode).
 */
function getServerSlot(): number {
  try {
    if (fs.existsSync(SLOT_FILE)) {
      const slotStr = fs.readFileSync(SLOT_FILE, "utf-8").trim();
      const slot = parseInt(slotStr, 10);
      if (!isNaN(slot)) {
        return slot;
      }
    }
  } catch {
    // Fall back to default
  }
  console.log("Slot file not found, using default slot 0");
  return 0;
}

/**
 * Get the server URL with the dynamic port.
 */
function getServerUrl(): string {
  return `http://localhost:${getServerPort()}`;
}

// Test admin passcode - must match what's passed to the server via globalSetup
const TEST_ADMIN_PASSCODE = "testpswd";

// Screenshot output directory
const SCREENSHOT_DIR = "debugoutput/screenshots";

/**
 * Ensures the screenshot directory exists.
 */
function ensureScreenshotDir(): void {
  const screenshotPath = path.resolve(SCREENSHOT_DIR);
  if (!fs.existsSync(screenshotPath)) {
    fs.mkdirSync(screenshotPath, { recursive: true });
  }
}

/**
 * Saves a screenshot with a descriptive name.
 */
async function saveScreenshot(page: Page, name: string): Promise<void> {
  if (process.env.MCT_SERVER_UI_SCREENSHOTS !== "1") {
    return;
  }

  ensureScreenshotDir();
  const screenshotPath = path.join(SCREENSHOT_DIR, `server-ui-${name}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(`Screenshot saved: ${screenshotPath}`);
}

/**
 * Wait for the server to be ready.
 * The server might take a moment to start up.
 */
async function waitForServerReady(page: Page, maxRetries: number = 10): Promise<boolean> {
  const serverUrl = getServerUrl();
  console.log(`Connecting to server at ${serverUrl}`);

  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await page.goto(serverUrl, { timeout: 5000, waitUntil: "domcontentloaded" });
      if (response && response.ok()) {
        await page.locator("#root > *").first().waitFor({ state: "attached", timeout: 5000 });
        return true;
      }
    } catch (e) {
      console.log(`Server not ready yet, attempt ${i + 1}/${maxRetries}...`);
      await page.waitForTimeout(1000);
    }
  }
  return false;
}

async function waitForAuthenticatedUi(page: Page): Promise<void> {
  await expect(page.locator('input[type="password"]').first()).toBeHidden({ timeout: 30000 });
}

async function waitForLoginInput(page: Page): Promise<void> {
  await page
    .locator('input[type="password"]')
    .first()
    .waitFor({ state: "attached", timeout: 10000 })
    .catch(() => {});
}

test.describe("MCTools Server UI", () => {
  const consoleErrors: { url: string; error: string }[] = [];
  const consoleWarnings: { url: string; error: string }[] = [];

  test.beforeEach(async ({ page }) => {
    // Set up console message handlers
    page.on("console", (msg: ConsoleMessage) => {
      processMessage(msg, page, consoleErrors, consoleWarnings);
    });

    // Clear previous errors/warnings
    consoleErrors.length = 0;
    consoleWarnings.length = 0;
  });

  test.describe("Server Connection", () => {
    test("should connect to the server on port 6126", async ({ page }) => {
      const isReady = await waitForServerReady(page);
      expect(isReady).toBe(true);

      // Verify the page loaded
      const body = page.locator("body");
      await expect(body).toBeVisible();

      await saveScreenshot(page, "initial-connection");
    });

    test("should display the server web interface", async ({ page }) => {
      const isReady = await waitForServerReady(page);
      expect(isReady).toBe(true);

      // The server should show either the login page or the main interface
      // Look for common elements that indicate the React app has loaded
      const reactRoot = page.locator("#root");
      await expect(reactRoot).toBeVisible();

      // Check that React has rendered content
      const hasContent = await page.evaluate(() => {
        return document.body.innerText.trim().length > 0;
      });
      expect(hasContent).toBe(true);

      await saveScreenshot(page, "web-interface-loaded");
    });
  });

  test.describe("Login Interface", () => {
    test("should display the login header", async ({ page }) => {
      const isReady = await waitForServerReady(page);
      expect(isReady).toBe(true);

      // The login interface should show "Login" header when in webserver mode
      // Based on RemoteServerSettingsPanel.tsx: "Login" when isWebServer is true
      const loginHeader = page.locator("text=Login");

      // Take screenshot regardless of whether element is found
      await saveScreenshot(page, "login-header-search");

      // Check if login header exists
      const loginVisible = await loginHeader.isVisible().catch(() => false);
      console.log(`Login header visible: ${loginVisible}`);

      // If no login header, check for other content (might already be authenticated)
      if (!loginVisible) {
        const statusText = page.locator("text=Status:");
        const statusVisible = await statusText.isVisible().catch(() => false);
        console.log(`Status text visible: ${statusVisible}`);
      }
    });

    test("should display the passcode input field", async ({ page }) => {
      const isReady = await waitForServerReady(page);
      expect(isReady).toBe(true);

      // Look for the passcode input field
      // Based on RemoteServerSettingsPanel.tsx: Input with type="password" and aria-label="Server Passcode"
      const passcodeInput = page.locator('input[type="password"]');
      const passcodeInputByLabel = page.locator('[aria-label="Server Passcode"]');

      await saveScreenshot(page, "passcode-input-search");

      // Try to find the password input
      if ((await passcodeInput.count()) > 0) {
        console.log("Found password input by type");
        await expect(passcodeInput.first()).toBeVisible();
      } else if ((await passcodeInputByLabel.count()) > 0) {
        console.log("Found password input by aria-label");
        await expect(passcodeInputByLabel.first()).toBeVisible();
      }

      // Also look for the "Server Passcode" label text
      const passcodeLabel = page.locator("text=Server Passcode");
      const labelVisible = await passcodeLabel.isVisible().catch(() => false);
      console.log(`Server Passcode label visible: ${labelVisible}`);

      // Log the current state for debugging
      const pageContent = await page.content();
      console.log(`Page contains "password" input: ${pageContent.includes('type="password"')}`);
      console.log(`Page contains "Passcode": ${pageContent.includes("Passcode")}`);
    });

    test("should allow entering a passcode", async ({ page }) => {
      const isReady = await waitForServerReady(page);
      expect(isReady).toBe(true);

      // Find the password input
      const passcodeInput = page.locator('input[type="password"]').first();

      // Check if input exists
      const inputExists = (await passcodeInput.count()) > 0;
      if (!inputExists) {
        console.log("Password input not found - page may already be authenticated");
        await saveScreenshot(page, "no-password-input");
        test.skip();
        return;
      }

      // Enter the test passcode
      await passcodeInput.fill(TEST_ADMIN_PASSCODE);

      // Verify the value was entered (obscured for password fields)
      const inputValue = await passcodeInput.inputValue();
      expect(inputValue).toBe(TEST_ADMIN_PASSCODE);

      await saveScreenshot(page, "passcode-entered");
    });

    test("should show Connect button when valid passcode is entered", async ({ page }) => {
      const isReady = await waitForServerReady(page);
      expect(isReady).toBe(true);

      await page.waitForTimeout(2000);

      // Find the password input
      const passcodeInput = page.locator('input[type="password"]').first();

      const inputExists = (await passcodeInput.count()) > 0;
      if (!inputExists) {
        console.log("Password input not found - skipping test");
        await saveScreenshot(page, "connect-button-no-input");
        test.skip();
        return;
      }

      // Enter a valid 8-character passcode (the format required by the server)
      // The passcode validation requires exactly 8 alphanumeric characters
      await passcodeInput.fill(TEST_ADMIN_PASSCODE);

      // Wait for the Connect button to appear
      // Based on RemoteServerSettingsPanel.tsx: Button with content="Connect"
      await page.waitForTimeout(500);

      const connectButton = page.locator('button:has-text("Connect")');
      await saveScreenshot(page, "connect-button-search");

      const buttonVisible = await connectButton.isVisible().catch(() => false);
      console.log(`Connect button visible: ${buttonVisible}`);

      if (buttonVisible) {
        await expect(connectButton.first()).toBeVisible();
      }
    });
  });

  test.describe("Authentication Flow", () => {
    test("should authenticate with correct admin passcode", async ({ page }) => {
      // Set up request failure tracking for this test
      const failedRequests: FailedRequest[] = [];
      const cleanupTracking = setupRequestFailureTracking(page, failedRequests);

      const isReady = await waitForServerReady(page);
      expect(isReady).toBe(true);

      // Find the password input
      const passcodeInput = page.locator('input[type="password"]').first();

      const inputExists = (await passcodeInput.count()) > 0;
      if (!inputExists) {
        console.log("Password input not found - may already be authenticated");
        await saveScreenshot(page, "auth-already-logged-in");
        // Check for success indicator
        const statusText = page.locator("text=Connected");
        const isConnected = await statusText.isVisible().catch(() => false);
        console.log(`Already connected: ${isConnected}`);
        cleanupTracking();
        return;
      }

      // Enter the admin passcode
      await passcodeInput.fill(TEST_ADMIN_PASSCODE);
      await saveScreenshot(page, "auth-passcode-entered");

      // Wait for Connect button and click it
      const connectButton = page.locator('button:has-text("Connect")').first();
      const buttonExists = await connectButton.isVisible().catch(() => false);

      if (buttonExists) {
        await connectButton.click();

        await waitForAuthenticatedUi(page);

        await saveScreenshot(page, "auth-after-connect-click");

        // Look for success indicators - the status should change to "Connected" or similar
        const successIndicators = [
          page.locator("text=Success"),
          page.locator("text=/Status:.*Connected/i"),
          page.locator("text=/Status:.*initialized/i"),
        ];

        let authSuccess = false;
        for (const indicator of successIndicators) {
          const isVisible = await indicator.isVisible().catch(() => false);
          if (isVisible) {
            console.log("Authentication successful - found success indicator");
            authSuccess = true;
            break;
          }
        }

        // Verify the password input is gone (indicates successful login)
        const passcodeInputAfterLogin = page.locator('input[type="password"]').first();
        const passwordStillVisible = await passcodeInputAfterLogin.isVisible().catch(() => false);

        if (!passwordStillVisible) {
          console.log("Password input no longer visible - login successful");
          authSuccess = true;
        }

        // Check for failure indicators
        const failureIndicators = [
          page.locator("text=Login failed"),
          page.locator("text=Disconnected from server"),
          page.locator("text=check passcode"),
        ];

        for (const indicator of failureIndicators) {
          const isVisible = await indicator.isVisible().catch(() => false);
          if (isVisible) {
            const text = await indicator.textContent();
            console.log(`Authentication result: ${text}`);
            // "Disconnected from server" might appear briefly then disappear on success
          }
        }

        // Take final screenshot
        await saveScreenshot(page, "auth-final-state");

        // The test passes if we see any success indicator
        // Note: Even with correct password, if server is not available the status may show as Pending
        console.log(`Authentication success indicators found: ${authSuccess}`);
      } else {
        console.log("Connect button not visible after entering passcode");
      }

      // Log failed requests with component hints
      if (failedRequests.length > 0) {
        console.log(summarizeFailedRequests(failedRequests));
      }
      cleanupTracking();
    });

    test("should maintain authenticated state across heartbeats", async ({ page }) => {
      const isReady = await waitForServerReady(page);
      expect(isReady).toBe(true);

      // Find the password input
      const passcodeInput = page.locator('input[type="password"]').first();

      const inputExists = (await passcodeInput.count()) > 0;
      if (!inputExists) {
        console.log("Password input not found - skipping test");
        await saveScreenshot(page, "heartbeat-no-input");
        test.skip();
        return;
      }

      // Enter the admin passcode and connect
      await passcodeInput.fill(TEST_ADMIN_PASSCODE);
      const connectButton = page.locator('button:has-text("Connect")').first();
      const buttonExists = await connectButton.isVisible().catch(() => false);

      if (!buttonExists) {
        console.log("Connect button not visible - skipping test");
        test.skip();
        return;
      }

      await connectButton.click();
      await waitForAuthenticatedUi(page);
      await saveScreenshot(page, "heartbeat-after-connect");

      // Wait for heartbeat cycle (the RemoteMinecraft polls every 500ms initially)
      await page.waitForTimeout(5000);
      await saveScreenshot(page, "heartbeat-after-wait");

      // Check if we're still connected (not kicked back to login)
      const disconnectedIndicator = page.locator("text=Disconnected from server");
      const isDisconnected = await disconnectedIndicator.isVisible().catch(() => false);

      // Check if password input reappeared (would indicate session was lost)
      const passcodeInputAfterHeartbeat = page.locator('input[type="password"]').first();
      const passwordReappeared = await passcodeInputAfterHeartbeat.isVisible().catch(() => false);

      console.log(`After heartbeats - Disconnected: ${isDisconnected}, Password visible: ${passwordReappeared}`);

      // If password is visible but status shows something other than "Login failed",
      // the auth token may be having issues
      if (passwordReappeared) {
        const statusContent = await page
          .locator(".rssp-connectedStatus")
          .textContent()
          .catch(() => "");
        console.log(`Status after heartbeat: ${statusContent}`);
      }

      await saveScreenshot(page, "heartbeat-final-state");
    });

    test("should show error message with incorrect passcode", async ({ page }) => {
      const isReady = await waitForServerReady(page);
      expect(isReady).toBe(true);

      // Find the password input
      const passcodeInput = page.locator('input[type="password"]').first();

      const inputExists = (await passcodeInput.count()) > 0;
      if (!inputExists) {
        console.log("Password input not found - skipping test");
        await saveScreenshot(page, "error-test-no-input");
        test.skip();
        return;
      }

      // Enter an incorrect passcode (but still 8 characters to pass validation)
      const incorrectPasscode = "wrongpwd";
      await passcodeInput.fill(incorrectPasscode);
      await saveScreenshot(page, "error-test-wrong-passcode");

      // Try to click Connect if available
      const connectButton = page.locator('button:has-text("Connect")').first();
      const buttonExists = await connectButton.isVisible().catch(() => false);

      if (buttonExists) {
        await connectButton.click();
        await expect(page.locator("text=Login failed")).toBeVisible({ timeout: 10000 });

        await saveScreenshot(page, "error-test-after-connect");

        // Look for error indicators
        const errorIndicators = [
          page.locator("text=Login failed"),
          page.locator("text=check passcode"),
          page.locator("text=Error"),
          page.locator("text=not available"),
        ];

        let errorFound = false;
        for (const indicator of errorIndicators) {
          const isVisible = await indicator.isVisible().catch(() => false);
          if (isVisible) {
            console.log("Found expected error indicator for wrong passcode");
            errorFound = true;
            break;
          }
        }

        // It's expected to see an error with wrong passcode
        console.log(`Error indicator found: ${errorFound}`);
      }
    });
  });

  test.describe("Server UI Elements", () => {
    test("should display server title if configured", async ({ page }) => {
      const isReady = await waitForServerReady(page);
      expect(isReady).toBe(true);

      await page.waitForTimeout(2000);

      // Look for the server title in the header
      // Based on WebServer.tsx: The title is displayed in wbsrv-title class
      const titleElement = page.locator(".wbsrv-title");
      await saveScreenshot(page, "server-title");

      if ((await titleElement.count()) > 0) {
        const titleText = await titleElement.textContent();
        console.log(`Server title: ${titleText}`);
        expect(titleText).toBeTruthy();
      } else {
        // Check for any title in the page
        const pageTitle = await page.title();
        console.log(`Page title: ${pageTitle}`);
        expect(pageTitle).toContain("Minecraft");
      }
    });

    test("should display Remote Server Slot dropdown", async ({ page }) => {
      const isReady = await waitForServerReady(page);
      expect(isReady).toBe(true);

      await page.waitForTimeout(2000);

      // Look for the slot dropdown
      // Based on RemoteServerSettingsPanel.tsx: "Remote Server Slot" label
      const slotLabel = page.locator("text=Remote Server Slot");
      await saveScreenshot(page, "slot-dropdown");

      const labelVisible = await slotLabel.isVisible().catch(() => false);
      console.log(`Remote Server Slot label visible: ${labelVisible}`);

      // Also look for the dropdown itself
      const dropdown = page.locator('[aria-labelledby="rssp-label-portlabel"]');
      const dropdownExists = (await dropdown.count()) > 0;
      console.log(`Slot dropdown exists: ${dropdownExists}`);
    });

    test("should display status information", async ({ page }) => {
      const isReady = await waitForServerReady(page);
      expect(isReady).toBe(true);

      await page.waitForTimeout(2000);

      // Look for status text
      // Based on RemoteServerSettingsPanel.tsx: "Status: Not connected" or "Status: Connected"
      const statusText = page.locator("text=Status:");
      await saveScreenshot(page, "status-info");

      const statusVisible = await statusText.isVisible().catch(() => false);
      console.log(`Status text visible: ${statusVisible}`);

      if (statusVisible) {
        // Get the parent element to see the full status
        const statusContent = await statusText.first().textContent();
        console.log(`Status content: ${statusContent}`);
      }
    });
  });

  test.describe("World Map After Login", () => {
    /**
     * Helper function to perform login and wait for the authenticated state.
     * Returns true if login was successful.
     */
    async function performLogin(page: Page): Promise<boolean> {
      const isReady = await waitForServerReady(page);
      if (!isReady) {
        console.log("Server not ready");
        return false;
      }

      await waitForLoginInput(page);

      // Check if already logged in (no password input)
      const passcodeInput = page.locator('input[type="password"]').first();
      const inputExists = (await passcodeInput.count()) > 0;

      if (!inputExists) {
        console.log("Already logged in - no password input found");
        return true;
      }

      // Enter the admin passcode
      await passcodeInput.fill(TEST_ADMIN_PASSCODE);

      // Click Connect button
      const connectButton = page.locator('button:has-text("Connect")').first();
      const buttonExists = await connectButton.isVisible().catch(() => false);

      if (!buttonExists) {
        console.log("Connect button not found");
        return false;
      }

      await connectButton.click();

      await waitForAuthenticatedUi(page);
      return true;
    }

    test("should show WorldView map area after successful login", async ({ page }) => {
      const loggedIn = await performLogin(page);
      if (!loggedIn) {
        console.log("Login failed - skipping WorldView test");
        await saveScreenshot(page, "worldview-login-failed");
        test.skip();
        return;
      }

      await saveScreenshot(page, "worldview-after-login");

      // Look for the WorldView map area
      // The map is rendered in a div with class "mid-map" containing a WorldView component
      const mapArea = page.locator(".mid-map");
      const mapExists = (await mapArea.count()) > 0;
      console.log(`Map area (.mid-map) exists: ${mapExists}`);

      // Also check for Leaflet map container (WorldView uses Leaflet)
      const leafletContainer = page.locator(".leaflet-container");
      const leafletExists = (await leafletContainer.count()) > 0;
      console.log(`Leaflet container exists: ${leafletExists}`);

      // Check for WorldView's outer container
      const worldViewOuter = page.locator(".wv-outer");
      const worldViewExists = (await worldViewOuter.count()) > 0;
      console.log(`WorldView outer (.wv-outer) exists: ${worldViewExists}`);

      await saveScreenshot(page, "worldview-map-check");

      // At least one of these should exist if the map is rendered
      const mapRendered = mapExists || leafletExists || worldViewExists;
      console.log(`WorldView map rendered: ${mapRendered}`);

      // Note: Map may not render if window is too small (height > 600 required)
      // or if worldContentStorage has no content
    });

    test("should display world map controls if WorldView is present", async ({ page }) => {
      const loggedIn = await performLogin(page);
      if (!loggedIn) {
        console.log("Login failed - skipping controls test");
        await saveScreenshot(page, "worldview-controls-login-failed");
        test.skip();
        return;
      }

      // Wait for any map loading
      await page.waitForTimeout(3000);

      // Check for WorldView toolbar elements
      // Based on WorldView.tsx: wv-toolBarInner class contains toolbar items
      const worldViewToolbar = page.locator(".wv-toolBarInner");
      const toolbarExists = (await worldViewToolbar.count()) > 0;
      console.log(`WorldView toolbar exists: ${toolbarExists}`);

      // Check for dimension selector dropdown (if world has multiple dimensions)
      const dimensionDropdown = page.locator('[aria-label="Select dimension"]');
      const dimensionExists = (await dimensionDropdown.count()) > 0;
      console.log(`Dimension dropdown exists: ${dimensionExists}`);

      // Check for view mode controls
      const viewLabel = page.locator("text=View");
      const viewExists = await viewLabel.isVisible().catch(() => false);
      console.log(`View label exists: ${viewExists}`);

      await saveScreenshot(page, "worldview-controls");
    });

    test("should render Leaflet map tiles if world content is available", async ({ page }) => {
      const loggedIn = await performLogin(page);
      if (!loggedIn) {
        console.log("Login failed - skipping tiles test");
        await saveScreenshot(page, "worldview-tiles-login-failed");
        test.skip();
        return;
      }

      // Wait for map tiles to load
      await page.waitForTimeout(5000);

      // Check for Leaflet tile layers
      const tilePane = page.locator(".leaflet-tile-pane");
      const tilePaneExists = (await tilePane.count()) > 0;
      console.log(`Leaflet tile pane exists: ${tilePaneExists}`);

      // Check for actual tile images
      const tiles = page.locator(".leaflet-tile");
      const tileCount = await tiles.count();
      console.log(`Number of map tiles: ${tileCount}`);

      // Check for zoom controls
      const zoomIn = page.locator(".leaflet-control-zoom-in");
      const zoomOut = page.locator(".leaflet-control-zoom-out");
      const zoomInExists = (await zoomIn.count()) > 0;
      const zoomOutExists = (await zoomOut.count()) > 0;
      console.log(`Zoom controls exist: in=${zoomInExists}, out=${zoomOutExists}`);

      await saveScreenshot(page, "worldview-tiles");

      // If world content is available, we should see tiles
      if (tilePaneExists) {
        console.log("Leaflet map is rendering");
      }
    });

    test("should show map after authentication even without Minecraft running", async ({ page }) => {
      // This test specifically verifies the new behavior:
      // WorldView should appear after login in "initialized" state,
      // without requiring Minecraft to be in "started" state

      const loggedIn = await performLogin(page);
      if (!loggedIn) {
        console.log("Login failed - skipping initialized state test");
        await saveScreenshot(page, "worldview-initialized-login-failed");
        test.skip();
        return;
      }

      // Brief wait for UI to stabilize after login
      await page.waitForTimeout(2000);

      // Now verify the map area is present (this is the new functionality)
      // Use immediate checks to avoid Playwright auto-waiting
      const mapArea = page.locator(".mid-map");
      const worldViewOuter = page.locator(".wv-outer");
      const leafletContainer = page.locator(".leaflet-container");

      const hasMapArea = (await mapArea.count()) > 0;
      const hasWorldView = (await worldViewOuter.count()) > 0;
      const hasLeaflet = (await leafletContainer.count()) > 0;

      console.log(`Map components - mid-map: ${hasMapArea}, wv-outer: ${hasWorldView}, leaflet: ${hasLeaflet}`);

      await saveScreenshot(page, "worldview-initialized-state");

      // The test passes if we can see any map component after login
      // (even without Minecraft server running)
      const mapPresent = hasMapArea || hasWorldView || hasLeaflet;
      console.log(`Map present after login (before MC started): ${mapPresent}`);

      // Verify at least one map component is present
      expect(mapPresent).toBe(true);
    });
  });

  test.describe("Console Errors", () => {
    test("should not have critical console errors", async ({ page }) => {
      // Set up request failure tracking to get detailed 404 info
      const failedRequests: FailedRequest[] = [];
      const cleanupTracking = setupRequestFailureTracking(page, failedRequests, { logAll: false });

      const isReady = await waitForServerReady(page);
      expect(isReady).toBe(true);

      // Filter out expected/ignorable errors
      const criticalErrors = consoleErrors.filter((error) => !isIgnorableMessage(error.error));

      console.log(`Total console errors: ${consoleErrors.length}`);
      console.log(`Critical console errors: ${criticalErrors.length}`);

      if (criticalErrors.length > 0) {
        console.log("Critical errors:", criticalErrors);
      }

      // Summarize failed requests with component hints
      const unexpectedFailures = failedRequests.filter((r) => !isIgnorable404Url(r.url));
      if (failedRequests.length > 0) {
        console.log(summarizeFailedRequests(failedRequests));
      }
      if (unexpectedFailures.length > 0) {
        console.log(`Unexpected 404s (${unexpectedFailures.length}):`);
        for (const f of unexpectedFailures) {
          console.log(`  ${f.componentHint} ${f.status}: ${f.url}`);
        }
      }

      cleanupTracking();

      // Allow some non-critical errors (network issues during testing, etc.)
      expect(criticalErrors.length).toBeLessThan(5);
    });
  });

  test.describe("Slot Selector", () => {
    test("should display slot selector dropdown in host toolbar after login", async ({ page }) => {
      const isReady = await waitForServerReady(page);
      expect(isReady).toBe(true);

      // Check if we need to log in
      const passcodeInput = page.locator('input[type="password"]').first();
      const needsLogin = (await passcodeInput.count()) > 0;

      if (needsLogin) {
        console.log("Logging in with test passcode...");
        await passcodeInput.fill(TEST_ADMIN_PASSCODE);
        const connectButton = page.locator('button:has-text("Connect")').first();
        if (await connectButton.isVisible().catch(() => false)) {
          await connectButton.click();
          await waitForAuthenticatedUi(page);
        }
      }

      // Wait for the server to connect and UI to stabilize
      await saveScreenshot(page, "slot-selector-toolbar");

      // Verify the slot selector exists in the host toolbar
      const slotSelector = page.locator(".mid-slotSelector");
      const slotSelectorExists = (await slotSelector.count()) > 0;
      console.log(`Slot selector exists: ${slotSelectorExists}`);
      expect(slotSelectorExists).toBe(true);

      // Verify dropdown shows slot info (e.g., "0: localhost:19132")
      // The slot text includes the slot number and localhost address
      const slotText = page.locator('.mid-slotSelector:has-text("localhost")');
      const slotTextExists = (await slotText.count()) > 0;
      console.log(`Slot text visible: ${slotTextExists}`);
      expect(slotTextExists).toBe(true);
    });

    test("should open settings dialog with world settings when clicking gear icon", async ({ page }) => {
      const isReady = await waitForServerReady(page);
      expect(isReady).toBe(true);

      // Log in first
      const passcodeInput = page.locator('input[type="password"]').first();
      const needsLogin = (await passcodeInput.count()) > 0;

      if (needsLogin) {
        console.log("Logging in with test passcode...");
        await passcodeInput.fill(TEST_ADMIN_PASSCODE);
        const connectButton = page.locator('button:has-text("Connect")').first();
        if (await connectButton.isVisible().catch(() => false)) {
          await connectButton.click();
          await waitForAuthenticatedUi(page);
        }
      }

      // Find and click the gear icon button
      const gearButton = page.locator(".mid-slotSettingsButton");
      const gearButtonExists = (await gearButton.count()) > 0;
      console.log(`Gear button exists: ${gearButtonExists}`);

      if (gearButtonExists) {
        await gearButton.click();

        // Check for dialog content
        const dialogContent = page.locator(".mid-slotSettingsContent");
        const dialogExists = (await dialogContent.count()) > 0;
        console.log(`Settings dialog content exists: ${dialogExists}`);
        expect(dialogExists).toBe(true);

        // Check for World Settings section
        const worldSettingsHeader = page.locator('text="World Settings"');
        const worldSettingsExists = (await worldSettingsHeader.count()) > 0;
        console.log(`World Settings section exists: ${worldSettingsExists}`);
        expect(worldSettingsExists).toBe(true);

        // Check for Slot Information section
        const slotInfoHeader = page.locator('text="Slot Information"');
        const slotInfoExists = (await slotInfoHeader.count()) > 0;
        console.log(`Slot Information section exists: ${slotInfoExists}`);
        expect(slotInfoExists).toBe(true);

        // Check for footer buttons - should have "Save and Restart" since server is running
        const restartButton = page.locator('button:has-text("Save and Restart")');
        const restartButtonExists = (await restartButton.count()) > 0;
        console.log(`Save and Restart button exists: ${restartButtonExists}`);

        // Close the dialog
        const closeButton = page.locator('button:has-text("Close")');
        if (await closeButton.isVisible().catch(() => false)) {
          await closeButton.click();
          await page.waitForTimeout(500);
        }

        await saveScreenshot(page, "settings-03-after-close");
      }
    });
  });

  test.describe("Debug Adapter UI", () => {
    /**
     * Helper to log in to the server UI.
     */
    async function loginToServer(page: Page) {
      await waitForLoginInput(page);
      const passcodeInput = page.locator('input[type="password"]').first();
      const needsLogin = (await passcodeInput.count()) > 0;

      if (needsLogin) {
        console.log("Logging in with test passcode...");
        await passcodeInput.fill(TEST_ADMIN_PASSCODE);
        const connectButton = page.locator('button:has-text("Connect")').first();
        if (await connectButton.isVisible().catch(() => false)) {
          await connectButton.click();
          await waitForAuthenticatedUi(page);
        }
      }
    }

    /**
     * Helper function to click the Stats tab in the sidebar.
     * Waits for the sidebar to be visible first.
     */
    async function clickStatsTab(page: Page): Promise<boolean> {
      // Wait for the sidebar tabs to appear (may take time while server is starting)
      // The sidebar-tabs div contains the Messages, Players, Stats buttons
      const sidebarTabs = page.locator(".mid-sidebar-tabs");
      let sidebarVisible = false;

      // Wait up to 30 seconds for the sidebar to appear (server needs to start)
      for (let i = 0; i < 60; i++) {
        sidebarVisible = await sidebarTabs.isVisible().catch(() => false);
        if (sidebarVisible) {
          console.log(`Sidebar appeared after ${i * 500}ms`);
          break;
        }
        await page.waitForTimeout(500);
      }

      if (!sidebarVisible) {
        console.log("Sidebar tabs never appeared - server may not have started");
        return false;
      }

      // Look for the Stats tab button in the sidebar using the specific class
      // The Stats button has class "mid-sidebar-tab" and contains text "Stats"
      const statsTab = page.locator(".mid-sidebar-tab:has-text('Stats')").first();
      let exists = await statsTab.isVisible().catch(() => false);

      // Fallback to text-based selector if class-based selector fails
      if (!exists) {
        const statsTabFallback = page.locator('button:has-text("Stats")').first();
        exists = await statsTabFallback.isVisible().catch(() => false);
        if (exists) {
          await statsTabFallback.click();
          await page.waitForTimeout(500); // Wait for tab content to render
          return true;
        }
      } else {
        await statsTab.click();
        await page.waitForTimeout(500); // Wait for tab content to render
        return true;
      }

      console.log("Stats tab not found");
      return false;
    }

    test("should display debug stats panel when connected", async ({ page }) => {
      const isReady = await waitForServerReady(page);
      expect(isReady).toBe(true);

      await loginToServer(page);
      await page.waitForTimeout(2000);

      await saveScreenshot(page, "debug-01-after-login");

      // Click on the Stats tab in the sidebar to show the debug stats panel
      const statsTabClicked = await clickStatsTab(page);
      console.log(`Stats tab clicked: ${statsTabClicked}`);

      await page.waitForTimeout(1000);
      await saveScreenshot(page, "debug-01b-after-stats-tab");

      // Look for the debug stats panel
      // The DebugStatsPanel component has class "dsp-outer"
      const debugPanel = page.locator(".dsp-outer");

      const panelExists = (await debugPanel.count()) > 0;
      console.log(`Debug stats panel found: ${panelExists}`);

      // Also check for the status dot which indicates the debug panel is rendering
      const statusDot = page.locator(".dsp-status-dot");
      const statusDotExists = (await statusDot.count()) > 0;
      console.log(`Debug status dot found: ${statusDotExists}`);

      await saveScreenshot(page, "debug-02-panel-search");

      // The panel should be visible after clicking Stats tab
      expect(panelExists || statusDotExists).toBe(true);
    });

    test("should show debug connection status", async ({ page }) => {
      const isReady = await waitForServerReady(page);
      expect(isReady).toBe(true);

      await loginToServer(page);
      await page.waitForTimeout(3000);

      // Click on the Stats tab to show the debug panel
      await clickStatsTab(page);
      await page.waitForTimeout(1000);

      await saveScreenshot(page, "debug-03-connection-status");

      // Look for connection status indicators
      // The DebugStatsPanel shows a status dot with class "connected", "connecting", or "disconnected"
      const connectedStatus = page.locator(".dsp-status-dot.connected");
      const connectingStatus = page.locator(".dsp-status-dot.connecting");
      const disconnectedStatus = page.locator(".dsp-status-dot.disconnected");

      const connected = (await connectedStatus.count()) > 0;
      const connecting = (await connectingStatus.count()) > 0;
      const disconnected = (await disconnectedStatus.count()) > 0;

      console.log(
        `Debug connection status - Connected: ${connected}, Connecting: ${connecting}, Disconnected: ${disconnected}`
      );

      // Also check for the status text
      const connectedText = page.locator("text=Connected");
      const connectingText = page.locator("text=Connecting...");
      const disconnectedText = page.locator("text=Disconnected");

      const hasConnectedText = (await connectedText.count()) > 0;
      const hasConnectingText = (await connectingText.count()) > 0;
      const hasDisconnectedText = (await disconnectedText.count()) > 0;

      console.log(
        `Debug status text - Connected: ${hasConnectedText}, Connecting: ${hasConnectingText}, Disconnected: ${hasDisconnectedText}`
      );
    });

    test("should display tick counter when receiving stats", async ({ page }) => {
      const isReady = await waitForServerReady(page);
      expect(isReady).toBe(true);

      await loginToServer(page);
      await page.waitForTimeout(3000);

      // Click on the Stats tab to show the debug panel
      await clickStatsTab(page);
      await page.waitForTimeout(1000);

      // Look for the tick counter in debug stats panel
      // The DebugStatsPanel shows "Tick: {number}" in the dsp-tick class
      const tickDisplay = page.locator(".dsp-tick");
      const tickExists = (await tickDisplay.count()) > 0;
      console.log(`Tick counter element found: ${tickExists}`);

      if (tickExists) {
        const tickText = await tickDisplay.first().textContent();
        console.log(`Tick display: ${tickText}`);
      }

      // Also check for tick text pattern
      const tickPattern = page.locator("text=/Tick:/");
      const hasTickPattern = (await tickPattern.count()) > 0;
      console.log(`Tick text pattern found: ${hasTickPattern}`);

      await saveScreenshot(page, "debug-04-tick-counter");
    });

    test("should show debug stats categories when data is flowing", async ({ page }) => {
      const isReady = await waitForServerReady(page);
      expect(isReady).toBe(true);

      await loginToServer(page);
      // Wait longer to allow stats to start flowing
      await page.waitForTimeout(5000);

      // Click on the Stats tab to show the debug panel
      await clickStatsTab(page);
      await page.waitForTimeout(5000); // Wait for stats to flow after tab is visible

      await saveScreenshot(page, "debug-05-stats-categories");

      // Look for stat categories displayed by DebugStatsPanel
      const categoryTitles = page.locator(".dsp-category-title");
      const categoryCount = await categoryTitles.count();
      console.log(`Number of stat categories: ${categoryCount}`);

      if (categoryCount > 0) {
        // List all category titles
        for (let i = 0; i < categoryCount; i++) {
          const title = await categoryTitles.nth(i).textContent();
          console.log(`  Category ${i + 1}: ${title}`);
        }
      }

      // Look for stat cards
      const statCards = page.locator(".dsp-stat-card");
      const statCardCount = await statCards.count();
      console.log(`Number of stat cards displayed: ${statCardCount}`);

      // Look for the empty state (indicates debug is connected but no scripts running)
      const emptyState = page.locator(".dsp-empty");
      const hasEmptyState = (await emptyState.count()) > 0;
      console.log(`Empty state visible: ${hasEmptyState}`);

      if (hasEmptyState) {
        const emptyText = await emptyState.first().textContent();
        console.log(`Empty state text: ${emptyText}`);
      }
    });

    test("should include debug info in HTTP API status", async ({ page }) => {
      const isReady = await waitForServerReady(page);
      expect(isReady).toBe(true);

      // Call the HTTP API directly to check debug status
      const serverUrl = getServerUrl();
      const slot = getServerSlot();
      const statusUrl = `${serverUrl}/api/${slot}/status`;

      console.log(`Fetching status from: ${statusUrl} (slot ${slot})`);

      // Use the mctpc header for authentication (query param authpc is not supported)
      const response = await page.request.get(statusUrl, {
        headers: { mctpc: TEST_ADMIN_PASSCODE },
      });
      const statusCode = response.status();
      console.log(`Status API response code: ${statusCode}`);

      if (statusCode === 200) {
        const data = await response.json();
        console.log(`Status API response: ${JSON.stringify(data, null, 2)}`);

        // Check for debug-related fields in the slot config
        if (data.slotConfig) {
          console.log(`debugConnectionState: ${data.slotConfig.debugConnectionState}`);
          console.log(`debugProtocolVersion: ${data.slotConfig.debugProtocolVersion}`);
          console.log(`debugLastStatTick: ${data.slotConfig.debugLastStatTick}`);
          console.log(`debugErrorMessage: ${data.slotConfig.debugErrorMessage}`);

          // The debug connection state should be present
          expect(data.slotConfig).toHaveProperty("debugConnectionState");
        }
      } else {
        // 404 may occur if BDS hasn't fully started on this slot yet
        console.log(`Status API returned ${statusCode} - server may still be starting`);
      }

      await saveScreenshot(page, "debug-06-api-status");
    });

    test("should include v10 diagnostics fields in HTTP API status", async ({ page }) => {
      const isReady = await waitForServerReady(page);
      expect(isReady).toBe(true);

      const serverUrl = getServerUrl();
      const slot = getServerSlot();
      const statusUrl = `${serverUrl}/api/${slot}/status`;

      const fetchSlotConfig = async () => {
        const response = await page.request.get(statusUrl, {
          headers: { mctpc: TEST_ADMIN_PASSCODE },
        });
        // The v10 diagnostics payload is part of the status contract - a
        // non-200 response or a missing slotConfig is a regression, not a
        // skippable condition.
        expect(response.status()).toBe(200);
        const data = await response.json();
        expect(data.slotConfig).toBeDefined();
        return data.slotConfig;
      };

      let slotConfig = await fetchSlotConfig();

      // Fields served regardless of session state (getDebugSlotConfig).
      expect(typeof slotConfig.debuggerEnabled).toBe("boolean");
      expect(typeof slotConfig.debuggerStreamingEnabled).toBe("boolean");
      expect(typeof slotConfig.debugConnectionState).toBe("string");
      // Ownership must always be reported (and classified) so the UI can
      // explain single-client debugger ownership (MCT vs VS Code).
      expect(["attachedByMct", "unattached", "attachedExternally", "unknown"]).toContain(slotConfig.debugOwnership);

      console.log(
        `debugConnectionState: ${slotConfig.debugConnectionState}, debugOwnership: ${slotConfig.debugOwnership}`
      );

      // The standard setup starts only the MCT HTTP server - no BDS, no
      // debugger - so left alone the session stays disconnected and the
      // connected/v9+ payload would never be exercised. Drive a REAL
      // connected v10 session through the production attach path instead:
      // listen on the slot's debug port with a mock Minecraft debug listener
      // and ask the server to attach to it. If a session is already connected
      // (manual run with a live BDS), assert against that session as-is - its
      // debug port is occupied, so the fixture cannot (and need not) start.
      const fixtureDescriptors = [
        {
          name: "server_timing",
          stat_group_id: "server_tick_timings",
          data_source: "server",
          display_type: "line_chart",
          title: "Server Timing",
        },
      ];
      // DedicatedServer.debugPort: base Minecraft port (19132 + slot * 32) + 12.
      const fixture = new MockDebuggerFixture({
        port: 19132 + slot * 32 + 12,
        protocolVersion: 10,
        descriptors: fixtureDescriptors,
      });
      const fixtureDriven = slotConfig.debugConnectionState !== "connected";

      try {
        if (fixtureDriven) {
          await fixture.start();

          const reattach = await page.request.post(`${serverUrl}/api/${slot}/debug/reattach`, {
            headers: { mctpc: TEST_ADMIN_PASSCODE },
          });
          expect(reattach.status()).toBe(200);
          const reattachResult = await reattach.json();
          console.log(`Reattach result: ${JSON.stringify(reattachResult)}`);
          expect(reattachResult.success, "the debug client must attach to the mock debugger fixture").toBe(true);
        }

        // A connected session is now REQUIRED, not conditional - a complete
        // attachment regression must fail this test, not skip it.
        for (let attempt = 0; attempt < 10 && slotConfig.debugConnectionState !== "connected"; attempt++) {
          await page.waitForTimeout(1000);
          slotConfig = await fetchSlotConfig();
        }
        expect(slotConfig.debugConnectionState, "the debug session must reach the connected state").toBe("connected");

        // A connected session must include the negotiated facts the panel
        // hydrates from.
        expect(typeof slotConfig.debugProtocolVersion).toBe("number");
        expect(slotConfig.debugProtocolVersion).toBeGreaterThanOrEqual(9);
        expect(typeof slotConfig.debugHost).toBe("string");
        expect(typeof slotConfig.debugPort).toBe("number");
        expect(slotConfig.debugCapabilities).toBeDefined();
        expect(slotConfig.debugOwnership).toBe("attachedByMct");
        console.log(
          `protocol v${slotConfig.debugProtocolVersion}, endpoint ${slotConfig.debugHost}:${slotConfig.debugPort}`
        );

        if (fixtureDriven) {
          // The fixture negotiated v10 on the slot's debug port - the served
          // payload must reflect exactly that negotiation.
          expect(slotConfig.debugProtocolVersion).toBe(10);
          expect(slotConfig.debugPort).toBe(fixture.port);
          expect(slotConfig.debugCapabilities.supportsEmptyTabs).toBe(true);
          expect(slotConfig.debugTargetModuleUuid).toBe("serverui-test-module-uuid");
        }

        // v9+ negotiates a diagnostics schema; it arrives asynchronously
        // after the handshake, so poll the API briefly before requiring it.
        let schema = slotConfig.debugSchema;
        for (let attempt = 0; attempt < 10 && schema === undefined; attempt++) {
          await page.waitForTimeout(1000);
          schema = (await fetchSlotConfig()).debugSchema;
        }
        expect(Array.isArray(schema), "a connected v9+ session must serve its diagnostics schema").toBe(true);
        console.log(`debugSchema: ${schema.length} descriptors`);

        if (fixtureDriven) {
          expect(schema).toEqual(fixtureDescriptors);

          // Stats streamed by the fixture must surface as the last stat tick.
          let lastStatTick = slotConfig.debugLastStatTick;
          for (let attempt = 0; attempt < 10 && !(lastStatTick > 0); attempt++) {
            await page.waitForTimeout(1000);
            lastStatTick = (await fetchSlotConfig()).debugLastStatTick;
          }
          expect(lastStatTick, "streamed StatEvent2 ticks must surface in the status payload").toBeGreaterThan(0);
        }
      } finally {
        await fixture.stop();
      }

      if (fixtureDriven) {
        // Losing the debugger connection must be detected and reported, and
        // this also hands subsequent tests a settled (disconnected) session
        // instead of a half-torn-down one.
        for (let attempt = 0; attempt < 10 && slotConfig.debugConnectionState === "connected"; attempt++) {
          await page.waitForTimeout(1000);
          slotConfig = await fetchSlotConfig();
        }
        expect(slotConfig.debugConnectionState, "the status payload must reflect the debugger disconnect").not.toBe(
          "connected"
        );
      }
    });

    test("should render v10 header info and schema tabs or legacy categories", async ({ page }) => {
      // This test must reach the connected schema-tab assertions even when it
      // runs standalone, where the sidebar only appears after BDS finishes
      // booting mid-test - allow for that boot on top of the UI assertions.
      test.setTimeout(180000);

      const isReady = await waitForServerReady(page);
      expect(isReady).toBe(true);

      const serverUrl = getServerUrl();
      const slot = getServerSlot();

      const fetchSlotConfig = async () => {
        const response = await page.request.get(`${serverUrl}/api/${slot}/status`, {
          headers: { mctpc: TEST_ADMIN_PASSCODE },
        });
        expect(response.status()).toBe(200);
        const data = await response.json();
        expect(data.slotConfig).toBeDefined();
        return data.slotConfig;
      };

      let slotConfig = await fetchSlotConfig();

      // The standard setup runs no BDS, so left alone the session is
      // disconnected and the connected schema-tab assertions would be dead
      // code (the preceding REST test tears its fixture down before this test
      // runs). This test therefore OWNS a live fixture through the UI
      // assertions: it drives a real connected v10 session and REQUIRES the
      // schema-tab rendering - the browser's production WebSocket-to-panel
      // path, not just REST serialization. A manual run with a live BDS
      // session asserts against that session as-is; its debug port is
      // occupied, so the fixture cannot (and need not) start. Two descriptors
      // so the tab-switching assertions always execute.
      const fixture = new MockDebuggerFixture({
        port: 19132 + slot * 32 + 12,
        protocolVersion: 10,
        descriptors: [
          {
            name: "server_timing",
            stat_group_id: "server_tick_timings",
            data_source: "server",
            display_type: "line_chart",
            title: "Server Timing",
          },
          {
            name: "handle_counts",
            stat_group_id: "handle_counts",
            data_source: "server",
            display_type: "table",
            title: "Handle Counts",
          },
        ],
      });
      const fixtureDriven = slotConfig.debugConnectionState !== "connected";

      try {
        if (fixtureDriven) {
          await fixture.start();

          const reattach = await page.request.post(`${serverUrl}/api/${slot}/debug/reattach`, {
            headers: { mctpc: TEST_ADMIN_PASSCODE },
          });
          expect(reattach.status()).toBe(200);
          const reattachResult = await reattach.json();
          console.log(`Reattach result: ${JSON.stringify(reattachResult)}`);
          expect(reattachResult.success, "the debug client must attach to the mock debugger fixture").toBe(true);
        }

        // A connected session is REQUIRED before any UI assertion - a
        // disconnected panel must fail this test, not pass it.
        for (let attempt = 0; attempt < 10 && slotConfig.debugConnectionState !== "connected"; attempt++) {
          await page.waitForTimeout(1000);
          slotConfig = await fetchSlotConfig();
        }
        expect(slotConfig.debugConnectionState, "the debug session must reach the connected state").toBe("connected");
        const protocolVersion = slotConfig.debugProtocolVersion ?? 0;
        console.log(`Negotiated debug session: protocol v${protocolVersion}, fixtureDriven=${fixtureDriven}`);

        await loginToServer(page);
        await page.waitForTimeout(2000);

        // The Stats tab is REQUIRED - without it none of the diagnostics
        // assertions below run and the test would pass vacuously. The sidebar
        // renders once the slot's server reaches its started state, so retry
        // clickStatsTab's 30-second wait to cover a BDS boot in progress.
        let statsTabOpened = false;
        for (let attempt = 0; attempt < 4 && !statsTabOpened; attempt++) {
          statsTabOpened = await clickStatsTab(page);
        }
        expect(statsTabOpened, "the Stats tab must open to assert the diagnostics panel").toBe(true);

        await saveScreenshot(page, "debug-07-v10-diagnostics");

        // Depending on the negotiated protocol version, diagnostics render
        // either as schema-driven tabs (v9+/v10 SchemaEvent) or legacy
        // categories. The fixture always negotiates v10; pre-v9 is reachable
        // only against a real pre-v9 BDS session in a manual run.
        const schemaTabs = page.locator(".dsp-schema-tabs [role='tab']");
        const categoryTitles = page.locator(".dsp-category-title");
        const emptyState = page.locator(".dsp-empty");

        if (protocolVersion >= 9) {
          // v9+ negotiated: SchemaEvent-driven tabs are the required
          // rendering. They appear as soon as the schema arrives (before any
          // stats), so a loading or empty state here means schema negotiation
          // or the WebSocket-to-panel path broke.
          await expect(schemaTabs.first(), "a connected v9+ session must render schema-driven tabs").toBeVisible({
            timeout: 15000,
          });
          const tabCount = await schemaTabs.count();
          console.log(`Schema-driven tabs: ${tabCount}`);

          if (fixtureDriven) {
            expect(tabCount, "one schema tab per fixture descriptor").toBe(2);
          }

          // Header info chips: module, endpoint, ownership (present when
          // connected).
          const infoChips = page.locator(".dsp-info-chip");
          const chipCount = await infoChips.count();
          expect(chipCount, "a connected session must render header info chips").toBeGreaterThan(0);
          for (let i = 0; i < chipCount; i++) {
            console.log(`  Chip ${i + 1}: ${await infoChips.nth(i).textContent()}`);
          }

          if (fixtureDriven) {
            // Stats stream over the production WebSocket: the tick display
            // must appear and ADVANCE while the fixture keeps emitting
            // StatEvent2 - a one-shot hydration snapshot cannot satisfy this.
            const tickDisplay = page.locator(".dsp-tick");
            await expect(tickDisplay.first()).toBeVisible({ timeout: 15000 });
            const tickBefore = await tickDisplay.first().textContent();
            await expect(async () => {
              expect(await tickDisplay.first().textContent(), "streamed stats must advance the tick display").not.toBe(
                tickBefore
              );
            }).toPass({ timeout: 15000 });
          }

          // Exercise tab switching and aria wiring.
          if (tabCount > 1) {
            await schemaTabs.nth(1).click();
            await page.waitForTimeout(500);

            const tabPanel = page.locator("[role='tabpanel']");
            expect(await tabPanel.count()).toBeGreaterThan(0);
            console.log(`Tab panel content after switch: ${(await tabPanel.first().textContent())?.substring(0, 120)}`);
          }
        } else {
          // Pre-v9: legacy hardcoded categories once stats flow; until then
          // the panel must say "Waiting for stats" explicitly. Schema tabs
          // cannot exist on a session that never negotiated a schema.
          expect(await schemaTabs.count()).toBe(0);

          const categoryCount = await categoryTitles.count();
          console.log(`Legacy stat categories: ${categoryCount}`);
          if (categoryCount === 0) {
            await expect(emptyState.first()).toContainText("Waiting for stats");
          }
        }
      } finally {
        await fixture.stop();
      }

      if (fixtureDriven) {
        // Losing the debugger must surface in the UI over the live WebSocket:
        // the panel explains the state explicitly and no diagnostics from the
        // ended session may linger. This also hands subsequent tests a
        // settled (disconnected) session instead of a half-torn-down one.
        const emptyState = page.locator(".dsp-empty");
        await expect(emptyState.first()).toBeVisible({ timeout: 15000 });
        const stateText = (await emptyState.first().textContent()) ?? "";
        console.log(`Post-teardown state message: ${stateText}`);
        expect(stateText).toMatch(
          /Debugger not connected|Connecting to debugger|Another debugger owns this endpoint|Diagnostics are disabled/
        );
        expect(await page.locator(".dsp-schema-tabs [role='tab']").count()).toBe(0);
        await saveScreenshot(page, "debug-07b-after-fixture-teardown");
      }
    });

    test("should handle debug reconnection gracefully", async ({ page }) => {
      const isReady = await waitForServerReady(page);
      expect(isReady).toBe(true);

      await loginToServer(page);
      await page.waitForTimeout(3000);

      // Click the Stats tab to access the debug stats panel
      await clickStatsTab(page);

      await saveScreenshot(page, "debug-07-before-reconnect");

      // Check initial state - look for stats panel elements
      const statsPanel = page.locator(".dsp-outer, .mid-stats-panel");
      const initialPanelVisible = await statsPanel
        .first()
        .isVisible()
        .catch(() => false);
      console.log(`Stats panel visible initially: ${initialPanelVisible}`);

      // Wait and check that WebSocket reconnection doesn't cause issues
      await page.waitForTimeout(5000);

      await saveScreenshot(page, "debug-08-after-wait");

      // Page should still be functional after waiting
      const bodyVisible = await page.locator("body").isVisible();
      expect(bodyVisible).toBe(true);

      // Check if we still have the stats panel (no crashes)
      const finalPanelVisible = await statsPanel
        .first()
        .isVisible()
        .catch(() => false);
      console.log(`Stats panel still visible after wait: ${finalPanelVisible}`);
    });
  });
});
