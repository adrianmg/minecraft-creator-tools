/**
 * Global setup for fast HTTP-only server tests.
 */
import { startServer } from "./serverui-global-setup";

export default async function globalSetup(): Promise<void> {
  await startServer("basicwebservices", "fast");
}
