// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * McpServerMetadataTest - Validates the metadata that MCP clients, directories, and the
 * official MCP Registry read from the Creator Tools MCP server:
 *
 * - server info (name + version) reported during initialization
 * - tool annotations (title + behavior hints) on every registered tool
 * - tool descriptions only reference tools that actually exist
 * - EULA acceptance via MCTOOLS_I_ACCEPT_EULA_AT_MINECRAFTDOTNETSLASHEULA in project create/add
 * - server.json (MCP Registry manifest) stays consistent with the published package.json
 */

import { expect } from "chai";
import "mocha";
import * as fs from "fs";
import * as path from "path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import MinecraftMcpServer from "../local/MinecraftMcpServer";
import { getMcpToolAnnotations, MCP_TOOL_BEHAVIOR_HINTS } from "../local/McpToolAnnotations";
import { constants } from "../core/Constants";
import TestPaths from "./TestPaths";

const EULA_ENV_VAR = "MCTOOLS_I_ACCEPT_EULA_AT_MINECRAFTDOTNETSLASHEULA";
const MCP_SERVER_NAME = "minecraft-creator-tools";

interface IListedTool {
  name: string;
  title?: string;
  description?: string;
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
}

// [readOnlyHint, destructiveHint, idempotentHint, openWorldHint]
const EXPECTED_TOOL_HINTS: { [toolName: string]: [boolean, boolean, boolean, boolean] } = {
  createProject: [false, true, false, true],
  addItem: [false, true, false, true],
  createMinecraftContent: [false, true, false, false],
  getEffectiveContentSchema: [true, false, true, false],
  validateContent: [true, false, true, false],
  validateFile: [true, false, true, false],
  createMinecraftSessionWithContent: [false, false, false, true],
  moveSessionPlayerToLocation: [false, false, true, true],
  runCommandInMinecraft: [false, true, false, true],
  runActionSetInMinecraft: [false, true, false, true],
  listMinecraftSessions: [true, false, true, false],
  connectToMinecraftSession: [false, false, true, false],
  designModel: [false, true, true, false],
  getModelTemplates: [true, false, true, false],
  designStructure: [false, true, true, false],
  writeImageFile: [false, true, true, false],
  writeImageFileFromSvg: [false, true, true, false],
  writeImageFileFromPixelArt: [false, true, true, false],
};

// camelCase identifiers that read like MCP tool names (e.g. `designModel`, `previewTextureSpec`).
const TOOL_NAME_LIKE_PATTERN =
  /\b(?:create|add|get|validate|design|write|read|run|move|list|connect|preview)[A-Z][A-Za-z0-9]*\b/g;

describe("MCP Server Metadata", function () {
  this.timeout(30000);

  let mcpServer: MinecraftMcpServer;
  let client: Client;
  let tools: IListedTool[] = [];

  before(async function () {
    await TestPaths.createTestEnvironment();

    mcpServer = new MinecraftMcpServer();
    await mcpServer._configureTools();

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (mcpServer as any)._server.connect(serverTransport);

    client = new Client({ name: "mct-metadata-test", version: "1.0.0" });
    await client.connect(clientTransport);

    tools = (await client.listTools()).tools as IListedTool[];
  });

  after(async function () {
    if (client) {
      await client.close();
    }
  });

  describe("server info", function () {
    it("reports the package version from constants instead of a hard-coded value", function () {
      expect(client.getServerVersion()).to.deep.equal({ name: MCP_SERVER_NAME, version: constants.version });
    });
  });

  describe("tool annotations", function () {
    it("registers exactly the tools that have expected hints", function () {
      expect(tools.map((t) => t.name).sort()).to.deep.equal(Object.keys(EXPECTED_TOOL_HINTS).sort());
    });

    it("has no stale entries in the behavior hints table", function () {
      expect(Object.keys(MCP_TOOL_BEHAVIOR_HINTS).sort()).to.deep.equal(Object.keys(EXPECTED_TOOL_HINTS).sort());
    });

    for (const [toolName, [readOnly, destructive, idempotent, openWorld]] of Object.entries(EXPECTED_TOOL_HINTS)) {
      it(`${toolName} has title and behavior annotations`, function () {
        const tool = tools.find((t) => t.name === toolName);
        expect(tool, `tool ${toolName} is not registered`).to.not.equal(undefined);

        expect(tool!.title, "top-level title").to.be.a("string").and.not.equal("");
        expect(tool!.annotations).to.deep.equal({
          title: tool!.title,
          readOnlyHint: readOnly,
          destructiveHint: destructive,
          idempotentHint: idempotent,
          openWorldHint: openWorld,
        });
      });
    }

    it("never marks a read-only tool as destructive", function () {
      for (const tool of tools) {
        if (tool.annotations?.readOnlyHint) {
          expect(tool.annotations.destructiveHint, tool.name).to.equal(false);
        }
      }
    });

    it("falls back to title-only annotations for unknown tools", function () {
      expect(getMcpToolAnnotations("notARealTool", "Not real")).to.deep.equal({ title: "Not real" });
      expect(getMcpToolAnnotations("toString")).to.deep.equal({});
    });
  });

  describe("tool descriptions", function () {
    it("only reference registered tools", function () {
      const registered = new Set(tools.map((t) => t.name));
      const dangling: string[] = [];

      for (const tool of tools) {
        for (const match of (tool.description ?? "").matchAll(TOOL_NAME_LIKE_PATTERN)) {
          if (!registered.has(match[0])) {
            dangling.push(`${tool.name} -> ${match[0]}`);
          }
        }
      }

      expect(dangling).to.deep.equal([]);
    });
  });

  describe("EULA acceptance", function () {
    let savedEnvValue: string | undefined;

    beforeEach(function () {
      savedEnvValue = process.env[EULA_ENV_VAR];
    });

    afterEach(function () {
      if (savedEnvValue === undefined) {
        delete process.env[EULA_ENV_VAR];
      } else {
        process.env[EULA_ENV_VAR] = savedEnvValue;
      }
    });

    function createFakeEnv(persistedAcceptance: boolean | undefined) {
      const env = {
        iAgreeToTheMinecraftEndUserLicenseAgreementAndPrivacyStatementAtMinecraftDotNetSlashEula: persistedAcceptance,
        saveCount: 0,
        async load() {},
        async save() {
          env.saveCount++;
        },
      };
      return env;
    }

    function setEnvVar(value: string | undefined) {
      if (value === undefined) {
        delete process.env[EULA_ENV_VAR];
      } else {
        process.env[EULA_ENV_VAR] = value;
      }
    }

    const cases: {
      name: string;
      persisted: boolean | undefined;
      envVar: string | undefined;
      accepted: boolean;
      persistsAcceptance: boolean;
    }[] = [
      {
        name: "previously accepted, no env var",
        persisted: true,
        envVar: undefined,
        accepted: true,
        persistsAcceptance: false,
      },
      {
        name: "previously accepted, env var false",
        persisted: true,
        envVar: "false",
        accepted: true,
        persistsAcceptance: false,
      },
      {
        name: "not accepted, no env var",
        persisted: undefined,
        envVar: undefined,
        accepted: false,
        persistsAcceptance: false,
      },
      { name: "declined, env var empty", persisted: false, envVar: "", accepted: false, persistsAcceptance: false },
      {
        name: "not accepted, env var false",
        persisted: false,
        envVar: "false",
        accepted: false,
        persistsAcceptance: false,
      },
      { name: "not accepted, env var 1", persisted: false, envVar: "1", accepted: false, persistsAcceptance: false },
      {
        name: "not accepted, env var true",
        persisted: false,
        envVar: "true",
        accepted: true,
        persistsAcceptance: true,
      },
      {
        name: "not accepted, env var TRUE",
        persisted: undefined,
        envVar: "TRUE",
        accepted: true,
        persistsAcceptance: true,
      },
    ];

    for (const c of cases) {
      it(`_ensureEulaAccepted: ${c.name}`, async function () {
        const server = new MinecraftMcpServer();
        const env = createFakeEnv(c.persisted);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (server as any)._env = env;
        setEnvVar(c.envVar);

        expect(await server._ensureEulaAccepted()).to.equal(c.accepted);
        expect(env.saveCount, "save() calls").to.equal(c.persistsAcceptance ? 1 : 0);

        if (c.persistsAcceptance) {
          expect(env.iAgreeToTheMinecraftEndUserLicenseAgreementAndPrivacyStatementAtMinecraftDotNetSlashEula).to.equal(
            true
          );
        }
      });
    }

    it("_ensureEulaAccepted returns false without an environment, even with the env var set", async function () {
      setEnvVar("true");
      expect(await new MinecraftMcpServer()._ensureEulaAccepted()).to.equal(false);
    });

    const gatedOperations: { name: string; invoke: (server: MinecraftMcpServer) => Promise<unknown> }[] = [
      {
        name: "_create",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        invoke: (server) => server._create(undefined as any, "Test", "", "test", "Tester", "addonStarter"),
      },
      {
        name: "_add",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        invoke: (server) => server._add(undefined as any, "pear", "test_pear"),
      },
    ];

    for (const op of gatedOperations) {
      for (const envVar of [undefined, "true"]) {
        const accepted = envVar === "true";

        it(`${op.name} ${accepted ? "proceeds" : "stops"} when the env var is ${envVar ?? "unset"}`, async function () {
          const server = new MinecraftMcpServer();
          const env = createFakeEnv(false);
          let galleryLoads = 0;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (server as any)._env = env;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (server as any)._creatorTools = {
            gallery: undefined,
            async loadGallery() {
              galleryLoads++;
            },
          };
          setEnvVar(envVar);

          await op.invoke(server);

          expect(galleryLoads, "operation continued past the EULA check").to.equal(accepted ? 1 : 0);
          expect(env.saveCount, "acceptance persisted").to.equal(accepted ? 1 : 0);
        });
      }
    }
  });

  describe("MCP Registry manifest (server.json)", function () {
    const serverJson = JSON.parse(fs.readFileSync(path.join(TestPaths.repoRoot, "server.json"), "utf-8"));
    const packageJson = JSON.parse(fs.readFileSync(path.join(TestPaths.appRoot, "jsnode", "package.json"), "utf-8"));

    it("uses the GitHub namespace granted to Mojang/minecraft-creator-tools by OIDC (case-sensitive)", function () {
      expect(serverJson.name).to.match(/^io\.github\.Mojang\/[a-zA-Z0-9._-]+$/);
      expect(serverJson.name.endsWith("/" + MCP_SERVER_NAME)).to.equal(true);
    });

    it("matches mcpName in the published package.json", function () {
      expect(packageJson.mcpName).to.equal(serverJson.name);
    });

    it("keeps the description within the registry's 100 character limit", function () {
      expect(serverJson.description.length).to.be.within(1, 100);
    });

    it("describes the npm package with stdio transport and the `mcp` argument", function () {
      expect(serverJson.packages).to.have.length(1);
      const pkg = serverJson.packages[0];

      expect(pkg.registryType).to.equal("npm");
      expect(pkg.identifier).to.equal(packageJson.name);
      expect(pkg.transport).to.deep.equal({ type: "stdio" });
      expect(pkg.packageArguments).to.deep.equal([{ type: "positional", value: "mcp" }]);
    });

    it("keeps server, package, and package.json versions in sync", function () {
      expect(serverJson.version).to.equal(packageJson.version);
      expect(serverJson.packages[0].version).to.equal(packageJson.version);
    });

    it("points at the same repository as package.json", function () {
      expect(serverJson.repository.url + ".git").to.equal(packageJson.repository.url);
    });
  });
});
