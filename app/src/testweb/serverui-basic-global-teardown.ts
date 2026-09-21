/**
 * Global teardown for the fast HTTP-only server tests.
 */
import { stopServer } from "./serverui-global-teardown";

export default async function globalTeardown(): Promise<void> {
  await stopServer("fast");
}
