// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { expect } from "chai";
import "mocha";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import MinecraftMcpServer from "../local/MinecraftMcpServer";

const EULA_ENV = "MCTOOLS_I_ACCEPT_EULA_AT_MINECRAFTDOTNETSLASHEULA";

/** Minimal stand-in for LocalEnvironment: `onDisk` is what another process, such as `mct eula`, wrote. */
function createFakeEnvironment(accepted: boolean, onDisk = accepted) {
  return {
    accepted,
    onDisk,
    saved: false,
    async load() {},
    async reload() {
      this.accepted = this.onDisk;
    },
    async save() {
      this.saved = true;
    },
    get iAgreeToTheMinecraftEndUserLicenseAgreementAndPrivacyStatementAtMinecraftDotNetSlashEula() {
      return this.accepted;
    },
    set iAgreeToTheMinecraftEndUserLicenseAgreementAndPrivacyStatementAtMinecraftDotNetSlashEula(value: boolean) {
      this.accepted = value;
    },
  };
}

function createServer(env: ReturnType<typeof createFakeEnvironment>) {
  const server = new MinecraftMcpServer() as any;
  server._env = env;
  server._creatorTools = {};
  return server;
}

describe("MinecraftMcpServer EULA handling", () => {
  let previousEnvValue: string | undefined;

  beforeEach(() => {
    previousEnvValue = process.env[EULA_ENV];
    delete process.env[EULA_ENV];
  });

  afterEach(() => {
    if (previousEnvValue === undefined) {
      delete process.env[EULA_ENV];
    } else {
      process.env[EULA_ENV] = previousEnvValue;
    }
  });

  const cases = [
    { name: "returns an actionable error when not accepted", accepted: false, onDisk: false, envVar: "", error: true },
    { name: "allows the call when already accepted", accepted: true, onDisk: true, envVar: "", error: false },
    {
      name: "picks up acceptance made by another process without a restart",
      accepted: false,
      onDisk: true,
      envVar: "",
      error: false,
    },
    { name: "accepts through the environment variable", accepted: false, onDisk: false, envVar: "true", error: false },
  ];

  for (const testCase of cases) {
    it(testCase.name, async () => {
      if (testCase.envVar) {
        process.env[EULA_ENV] = testCase.envVar;
      }
      const env = createFakeEnvironment(testCase.accepted, testCase.onDisk);

      const result = await createServer(env)._eulaNotAcceptedResult();

      if (testCase.error) {
        expect(result?.isError).to.equal(true);
        expect(result?.content[0].text).to.contain("mct eula");
      } else {
        expect(result).to.equal(undefined);
      }
      if (testCase.envVar) {
        expect(env.saved).to.equal(true);
      }
    });
  }

  it("createProject returns the EULA error instead of reporting success", async () => {
    const folder = path.join(os.tmpdir(), `mct-eula-test-${process.pid}-${Date.now()}`);

    const result = await createServer(createFakeEnvironment(false))._createOp({
      folderPathToCreateProjectAt: folder,
      title: "Goblin Chef",
      newName: "goblin_chef",
      creator: "Test",
      template: "addonStarter",
    });

    expect(result.isError).to.equal(true);
    expect(result.content[0].text).to.contain("mct eula");
    expect(fs.existsSync(folder)).to.equal(false);
  });
});
