import { defineConfig } from "@playwright/test";
import * as path from "path";

/**
 * Fast server checks that do not require a browser or Bedrock Dedicated Server.
 *
 * Run with:
 *   npm run test-server-ui-fast
 */
export default defineConfig({
  testDir: "./src/testweb",
  testMatch: "ServerApi.spec.ts",
  outputDir: "./debugoutput/playwright-serverui-fast-results",
  globalSetup: path.resolve(__dirname, "./src/testweb/serverui-basic-global-setup.ts"),
  globalTeardown: path.resolve(__dirname, "./src/testweb/serverui-basic-global-teardown.ts"),
  fullyParallel: true,
  workers: 1,
  reporter: "line",
  use: {
    trace: "on-first-retry",
  },
  timeout: 15000,
});
