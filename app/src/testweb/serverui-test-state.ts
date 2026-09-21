/// <reference types="node" />

import * as path from "path";

export type ServerUiTestStateNamespace = "full" | "fast";

interface ServerUiTestStateFiles {
  portFile: string;
  slotFile: string;
}

export function getServerStateFiles(namespace: ServerUiTestStateNamespace): ServerUiTestStateFiles {
  const statePrefix = `.serverui-${namespace}-test`;
  const debugOutputDir = path.resolve(__dirname, "../../debugoutput");

  return {
    portFile: path.join(debugOutputDir, `${statePrefix}-port`),
    slotFile: path.join(debugOutputDir, `${statePrefix}-slot`),
  };
}
