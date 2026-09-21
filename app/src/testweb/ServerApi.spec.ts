/**
 * Fast HTTP-only coverage for the MCT server.
 *
 * These tests use basicwebservices, which skips BDS preparation and startup.
 * Browser, world, slot, and debug behavior remains covered by ServerUI.spec.ts.
 */
import { test, expect, APIRequestContext } from "@playwright/test";
import * as fs from "fs";
import { getServerStateFiles } from "./serverui-test-state";

const { portFile: PORT_FILE, slotFile: SLOT_FILE } = getServerStateFiles("fast");
const TEST_ADMIN_PASSCODE = "testpswd";

function getServerUrl(): string {
  const port = parseInt(fs.readFileSync(PORT_FILE, "utf-8").trim(), 10);
  return `http://localhost:${port}`;
}

async function authenticate(request: APIRequestContext) {
  return request.post(`${getServerUrl()}/api/auth`, {
    data: `passcode=${TEST_ADMIN_PASSCODE}`,
    headers: { "content-type": "application/x-www-form-urlencoded" },
  });
}

test.describe("MCTools Basic Server API", () => {
  test("starts the HTTP service without BDS", async ({ request }) => {
    const response = await request.get(`${getServerUrl()}/favicon.ico`);

    expect(response.status()).toBe(200);
  });

  test("authenticates an administrator with the configured passcode", async ({ request }) => {
    const response = await authenticate(request);

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.permissionLevel).toEqual(expect.any(Number));
    expect(body.serverStatus).toEqual(expect.any(Array));
  });

  test("rejects an incorrect passcode", async ({ request }) => {
    const response = await request.post(`${getServerUrl()}/api/auth`, {
      data: "passcode=wrongpwd",
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });

    expect(response.status()).toBe(401);
  });

  test("serves authenticated EULA status without a dedicated server", async ({ request }) => {
    const response = await request.get(`${getServerUrl()}/api/eulastatus`, {
      headers: { mctpc: TEST_ADMIN_PASSCODE },
    });

    expect(response.status()).toBe(200);
    expect(await response.json()).toHaveProperty("eulaAccepted");
  });

  test("reports no slot service in HTTP-only mode", async ({ request }) => {
    const response = await request.get(`${getServerUrl()}/api/0/status`, {
      headers: { mctpc: TEST_ADMIN_PASSCODE },
    });

    expect(response.status()).toBe(404);
  });

  test("does not start a slot service at the configured slot", async ({ request }) => {
    // Slot 0 is never used by the test setup, so the check above would pass even if
    // the setup wrongly booted `serve all`. Querying the slot the setup actually
    // configured only 404s when basicwebservices skipped slot/BDS startup.
    const slot = parseInt(fs.readFileSync(SLOT_FILE, "utf-8").trim(), 10);
    expect(Number.isNaN(slot)).toBe(false);

    const response = await request.get(`${getServerUrl()}/api/${slot}/status`, {
      headers: { mctpc: TEST_ADMIN_PASSCODE },
    });

    expect(response.status()).toBe(404);
  });
});
