// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Tests for the createMinecraftContent MCP tool (MinecraftMcpServer._createMinecraftContentOp)
 * when it runs against new and existing projects:
 *
 * 1. Existing manifests are preserved (names, descriptions, UUIDs, versions, dependencies).
 * 2. Files that already exist are skipped and reported in the response.
 * 3. Unrecognized input keys are reported as warnings instead of silently dropped.
 * 4. Summary counts reflect what was actually written (inline drops/spawning included).
 * 5. New packs get a square, power-of-two pack_icon.png; existing icons are never overwritten.
 * 6. Display names reach the game via texts/en_US.lang and item minecraft:display_name.
 */

import { expect } from "chai";
import "mocha";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { randomUUID } from "crypto";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import MinecraftMcpServer from "../local/MinecraftMcpServer";
import { MinecraftContentSchema } from "../minecraft/ContentMetaSchemaZod";
import { ContentGenerator } from "../minecraft/ContentGenerator";
import { ContentWriter } from "../minecraft/ContentWriter";
import { IMinecraftContentDefinition } from "../minecraft/IContentMetaSchema";
import { findUnrecognizedKeys, preserveUnknownKeys } from "../core/ZodUtilities";
import Lang from "../minecraft/Lang";
import CreatorToolsHost from "../app/CreatorToolsHost";
import ImageCodecNode from "../local/ImageCodecNode";
import Project, { ProjectAutoDeploymentMode } from "../app/Project";
import StorageUtilities from "../storage/StorageUtilities";
import TestPaths, { ITestEnvironment } from "./TestPaths";

CreatorToolsHost.encodeToPng = ImageCodecNode.encodeToPng;
CreatorToolsHost.decodePng = ImageCodecNode.decodePng;
if (typeof CreatorToolsHost.generateUuid !== "function") {
  CreatorToolsHost.generateUuid = () => randomUUID();
}

interface IOpResult {
  text: string;
  structured: {
    filesWritten: string[];
    filesSkipped: string[];
    unrecognizedKeys: string[];
    warnings: string[];
    written: Record<string, number>;
    projectRoot: string;
    summary: any;
  };
}

async function runCreateContent(definition: unknown, outputPath: string): Promise<IOpResult> {
  const server = new MinecraftMcpServer();
  // Only checked for presence; content generation doesn't use it.
  (server as any)._creatorTools = {};
  const result = await server._createMinecraftContentOp({ definition, outputPath });
  const text = (result.content[0] as { text: string }).text;
  expect(result.structuredContent, `expected structured content, got: ${text}`).to.not.be.undefined;
  return { text, structured: result.structuredContent as any };
}

function readJson(filePath: string): any {
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function pngSize(filePath: string): { width: number; height: number } {
  const bytes = fs.readFileSync(filePath);
  expect(bytes.subarray(1, 4).toString("ascii")).to.equal("PNG");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

const bpDir = (root: string) => path.join(root, "behavior_packs", "demo");
const rpDir = (root: string) => path.join(root, "resource_packs", "demo");

const INITIAL_DEFINITION = {
  schemaVersion: "1.0.0",
  namespace: "demo",
  displayName: "Demo Pack",
  description: "Demo description",
  entityTypes: [{ id: "orc", displayName: "Orc", health: 20 }],
};

describe("createMinecraftContent MCP tool", function () {
  this.timeout(30000);

  let tempRoot: string;

  beforeEach(function () {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mct-create-content-"));
  });

  afterEach(function () {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  describe("manifests", function () {
    it("links a new behavior pack to its new resource pack", async function () {
      await runCreateContent(INITIAL_DEFINITION, tempRoot);

      const bp = readJson(path.join(bpDir(tempRoot), "manifest.json"));
      const rp = readJson(path.join(rpDir(tempRoot), "manifest.json"));

      expect(bp.header.name).to.equal("Demo Pack");
      expect(rp.header.name).to.equal("Demo Pack");
      expect(bp.dependencies).to.deep.equal([{ uuid: rp.header.uuid, version: rp.header.version }]);
    });

    it("preserves existing manifests byte-for-byte when adding content to an existing project", async function () {
      await runCreateContent(INITIAL_DEFINITION, tempRoot);

      // Simulate a user who has customized their manifests since the first run.
      const bpManifestPath = path.join(bpDir(tempRoot), "manifest.json");
      const rpManifestPath = path.join(rpDir(tempRoot), "manifest.json");
      const bp = readJson(bpManifestPath);
      bp.header.name = "My Custom BP";
      bp.header.description = "Hand-written description";
      bp.header.version = [2, 3, 4];
      bp.dependencies.push({ module_name: "@minecraft/server", version: "1.11.0" });
      fs.writeFileSync(bpManifestPath, JSON.stringify(bp, null, 4));
      const rp = readJson(rpManifestPath);
      rp.header.name = "My Custom RP";
      fs.writeFileSync(rpManifestPath, JSON.stringify(rp, null, 4));

      const bpBefore = fs.readFileSync(bpManifestPath, "utf-8");
      const rpBefore = fs.readFileSync(rpManifestPath, "utf-8");

      // Second run: no displayName/description, new item + block. Previously this reset both
      // names to "<namespace> Behavior/Resource Pack" and replaced the BP dependency UUID.
      const { structured } = await runCreateContent(
        {
          schemaVersion: "1.0.0",
          namespace: "demo",
          itemTypes: [{ id: "ruby", displayName: "Ruby" }],
          blockTypes: [{ id: "ruby_block", displayName: "Ruby Block" }],
        },
        tempRoot
      );

      expect(fs.readFileSync(bpManifestPath, "utf-8")).to.equal(bpBefore);
      expect(fs.readFileSync(rpManifestPath, "utf-8")).to.equal(rpBefore);
      expect(readJson(bpManifestPath).dependencies[0].uuid).to.equal(readJson(rpManifestPath).header.uuid);
      expect(structured.filesSkipped).to.include.members([bpManifestPath, rpManifestPath]);
      expect(structured.filesWritten).to.not.include(bpManifestPath);
      expect(structured.filesWritten).to.not.include(rpManifestPath);
    });

    it("only adds a missing resource pack dependency to an existing behavior pack manifest", async function () {
      await runCreateContent(INITIAL_DEFINITION, tempRoot);

      const bpManifestPath = path.join(bpDir(tempRoot), "manifest.json");
      const bp = readJson(bpManifestPath);
      const danglingDependency = { uuid: "00000000-0000-0000-0000-000000000000", version: [1, 0, 0] };
      bp.dependencies = [danglingDependency];
      fs.writeFileSync(bpManifestPath, JSON.stringify(bp, null, 2));

      const { structured } = await runCreateContent(
        { schemaVersion: "1.0.0", namespace: "demo", itemTypes: [{ id: "ruby", displayName: "Ruby" }] },
        tempRoot
      );

      const rp = readJson(path.join(rpDir(tempRoot), "manifest.json"));
      const updated = readJson(bpManifestPath);
      expect(updated.dependencies).to.deep.equal([
        danglingDependency,
        { uuid: rp.header.uuid, version: rp.header.version },
      ]);
      expect({ ...updated, dependencies: undefined }).to.deep.equal({ ...bp, dependencies: undefined });
      expect(structured.warnings.some((w) => w.includes("Added a dependency"))).to.equal(true);
    });

    it("links a new behavior pack to an existing resource pack", async function () {
      const existingRp = {
        format_version: 2,
        header: {
          name: "Existing RP",
          description: "",
          uuid: "11111111-2222-3333-4444-555555555555",
          version: [3, 0, 0],
        },
        modules: [{ type: "resources", uuid: "66666666-7777-8888-9999-000000000000", version: [1, 0, 0] }],
      };
      fs.mkdirSync(path.join(tempRoot, "resource_packs", "existing_rp"), { recursive: true });
      fs.writeFileSync(
        path.join(tempRoot, "resource_packs", "existing_rp", "manifest.json"),
        JSON.stringify(existingRp)
      );

      await runCreateContent(INITIAL_DEFINITION, tempRoot);

      const bp = readJson(path.join(bpDir(tempRoot), "manifest.json"));
      expect(bp.dependencies).to.deep.equal([{ uuid: existingRp.header.uuid, version: [3, 0, 0] }]);
      expect(readJson(path.join(tempRoot, "resource_packs", "existing_rp", "manifest.json"))).to.deep.equal(existingRp);
    });

    it("writes into the resource pack the behavior pack depends on", async function () {
      const makeRp = (folder: string, uuid: string) => {
        fs.mkdirSync(path.join(tempRoot, "resource_packs", folder), { recursive: true });
        fs.writeFileSync(
          path.join(tempRoot, "resource_packs", folder, "manifest.json"),
          JSON.stringify({ format_version: 2, header: { name: folder, uuid, version: [1, 0, 0] }, modules: [] })
        );
      };
      makeRp("a_unrelated_rp", "aaaaaaaa-0000-0000-0000-000000000000");
      makeRp("b_linked_rp", "bbbbbbbb-0000-0000-0000-000000000000");
      fs.mkdirSync(path.join(tempRoot, "behavior_packs", "my_bp"), { recursive: true });
      fs.writeFileSync(
        path.join(tempRoot, "behavior_packs", "my_bp", "manifest.json"),
        JSON.stringify({
          format_version: 2,
          header: { name: "my_bp", uuid: "cccccccc-0000-0000-0000-000000000000", version: [1, 0, 0] },
          modules: [],
          dependencies: [{ uuid: "bbbbbbbb-0000-0000-0000-000000000000", version: [1, 0, 0] }],
        })
      );

      await runCreateContent(INITIAL_DEFINITION, tempRoot);

      expect(fs.existsSync(path.join(tempRoot, "resource_packs", "b_linked_rp", "entity", "orc.entity.json"))).to.equal(
        true
      );
      expect(fs.existsSync(path.join(tempRoot, "resource_packs", "a_unrelated_rp", "entity"))).to.equal(false);
    });
  });

  describe("existing files", function () {
    it("reports files that already existed and were skipped", async function () {
      const first = await runCreateContent(INITIAL_DEFINITION, tempRoot);
      expect(first.structured.filesSkipped).to.deep.equal([]);

      const entityPath = path.join(bpDir(tempRoot), "entities", "orc.json");
      const entityBefore = fs.readFileSync(entityPath, "utf-8");

      const second = await runCreateContent(
        { ...INITIAL_DEFINITION, entityTypes: [{ id: "orc", displayName: "Orc", health: 99 }] },
        tempRoot
      );

      expect(fs.readFileSync(entityPath, "utf-8")).to.equal(entityBefore);
      expect(second.structured.filesSkipped).to.include(entityPath);
      expect(second.structured.filesWritten).to.not.include(entityPath);
      expect(second.structured.written.entityTypes).to.equal(0);
      expect(second.text).to.match(/Skipped \d+ files that already existed/);
      expect(second.text).to.include(path.join("behavior_packs", "demo", "entities", "orc.json"));
    });
  });

  describe("unrecognized keys", function () {
    it("warns about keys that the schema ignores instead of dropping them silently", async function () {
      const { text, structured } = await runCreateContent(
        {
          schemaVersion: "1.0.0",
          namespace: "demo",
          itemTypes: [{ id: "blade", displayName: "Blade", damage: 7 }],
          features: [{ id: "ruby_ore", type: "ore", block: "demo:ruby_block", count: 4 }],
        },
        tempRoot
      );

      expect(structured.unrecognizedKeys).to.deep.equal([
        "itemTypes[0].damage",
        "features[0].type",
        "features[0].block",
        "features[0].count",
      ]);
      expect(text).to.include('Unrecognized key "itemTypes[0].damage" was ignored');
      expect(text).to.include("Feature 'ruby_ore': no files were generated");
      expect(structured.written.features).to.equal(0);
      expect(structured.summary.featureCount).to.equal(0);
    });

    it("reports no unrecognized keys for a valid definition", async function () {
      const { structured } = await runCreateContent(INITIAL_DEFINITION, tempRoot);
      expect(structured.unrecognizedKeys).to.deep.equal([]);
    });
  });

  describe("summary counts", function () {
    it("counts loot tables and spawn rules produced by inline drops and spawning", async function () {
      const { text, structured } = await runCreateContent(
        {
          schemaVersion: "1.0.0",
          namespace: "demo",
          entityTypes: [
            {
              id: "orc",
              displayName: "Orc",
              drops: [{ item: "bone" }],
              spawning: { biomes: ["plains"] },
            },
          ],
          blockTypes: [{ id: "ruby_block", displayName: "Ruby Block", drops: [{ item: "demo:ruby" }] }],
        },
        tempRoot
      );

      expect(structured.written.lootTables).to.equal(2);
      expect(structured.written.spawnRules).to.equal(1);
      expect(structured.summary.lootTableCount).to.equal(2);
      expect(structured.summary.spawnRuleCount).to.equal(1);
      expect(text).to.include("- 2 loot tables");
      expect(text).to.include("- 1 spawn rules");
    });
  });

  describe("pack icons", function () {
    it("writes a square power-of-two pack_icon.png for new packs", async function () {
      await runCreateContent(INITIAL_DEFINITION, tempRoot);

      for (const packDir of [bpDir(tempRoot), rpDir(tempRoot)]) {
        expect(pngSize(path.join(packDir, "pack_icon.png"))).to.deep.equal({ width: 64, height: 64 });
      }
    });

    it("never overwrites an existing pack icon", async function () {
      await runCreateContent(INITIAL_DEFINITION, tempRoot);

      const iconPath = path.join(bpDir(tempRoot), "pack_icon.png");
      const customIcon = Buffer.from("custom icon bytes");
      fs.writeFileSync(iconPath, customIcon);

      const { structured } = await runCreateContent(
        { schemaVersion: "1.0.0", namespace: "demo", itemTypes: [{ id: "ruby", displayName: "Ruby" }] },
        tempRoot
      );

      expect(fs.readFileSync(iconPath).equals(customIcon)).to.equal(true);
      expect(structured.filesWritten).to.not.include(iconPath);
    });
  });

  describe("localization", function () {
    it("writes en_US.lang, languages.json, and item display names for new content", async function () {
      await runCreateContent(
        {
          schemaVersion: "1.0.0",
          namespace: "demo",
          entityTypes: [{ id: "orc", displayName: "Orc Warrior" }],
          blockTypes: [{ id: "ruby_block", displayName: "Ruby Block" }],
          itemTypes: [{ id: "ruby", displayName: "Ruby" }],
        },
        tempRoot
      );

      const lang = Lang.parseEntries(fs.readFileSync(path.join(rpDir(tempRoot), "texts", "en_US.lang"), "utf-8"));
      expect(Object.fromEntries(lang)).to.deep.equal({
        "entity.demo:orc.name": "Orc Warrior",
        "item.spawn_egg.entity.demo:orc.name": "Orc Warrior Spawn Egg",
        "tile.demo:ruby_block.name": "Ruby Block",
      });
      expect(readJson(path.join(rpDir(tempRoot), "texts", "languages.json"))).to.deep.equal(["en_US"]);

      const item = readJson(path.join(bpDir(tempRoot), "items", "ruby.json"));
      expect(item["minecraft:item"].components["minecraft:display_name"]).to.deep.equal({ value: "Ruby" });
    });

    it("appends to existing lang files without changing existing keys", async function () {
      const textsDir = path.join(rpDir(tempRoot), "texts");
      await runCreateContent(INITIAL_DEFINITION, tempRoot);

      const langPath = path.join(textsDir, "en_US.lang");
      fs.writeFileSync(langPath, "## My translations\nentity.demo:orc.name=Grumpy Orc\ncustom.key=Custom");
      fs.writeFileSync(path.join(textsDir, "languages.json"), JSON.stringify(["de_DE"]));

      const { structured } = await runCreateContent(
        {
          schemaVersion: "1.0.0",
          namespace: "demo",
          entityTypes: [
            { id: "orc", displayName: "Orc" },
            { id: "goblin", displayName: "Goblin" },
          ],
        },
        tempRoot
      );

      expect(fs.readFileSync(langPath, "utf-8")).to.equal(
        "## My translations\nentity.demo:orc.name=Grumpy Orc\ncustom.key=Custom\n" +
          "item.spawn_egg.entity.demo:orc.name=Orc Spawn Egg\n" +
          "entity.demo:goblin.name=Goblin\n" +
          "item.spawn_egg.entity.demo:goblin.name=Goblin Spawn Egg\n"
      );
      expect(readJson(path.join(textsDir, "languages.json"))).to.deep.equal(["de_DE", "en_US"]);
      expect(structured.warnings.some((w) => w.includes('already defines "entity.demo:orc.name"'))).to.equal(true);
    });
  });
});

describe("ZodUtilities.findUnrecognizedKeys", function () {
  const base = { schemaVersion: "1.0.0", namespace: "demo" };

  const cases: { name: string; definition: object; expected: string[] }[] = [
    { name: "valid definition", definition: INITIAL_DEFINITION, expected: [] },
    { name: "unknown top-level key", definition: { ...base, author: "me" }, expected: ["author"] },
    {
      name: "unknown item property",
      definition: { ...base, itemTypes: [{ id: "a", displayName: "A", damage: 5 }] },
      expected: ["itemTypes[0].damage"],
    },
    {
      name: "malformed feature",
      definition: { ...base, features: [{ id: "f", type: "ore", block: "x", count: 3 }] },
      expected: ["features[0].type", "features[0].block", "features[0].count"],
    },
    {
      name: "unknown key inside a nested object",
      definition: { ...base, itemTypes: [{ id: "a", displayName: "A", weapon: { damage: 5, sharpness: 2 } }] },
      expected: ["itemTypes[0].weapon.sharpness"],
    },
    {
      name: "unknown key inside the object branch of a union",
      definition: {
        ...base,
        entityTypes: [{ id: "e", displayName: "E", tameable: { tameItems: ["bone"], bogus: 1 } }],
      },
      expected: ["entityTypes[0].tameable.bogus"],
    },
    {
      name: "string branch of a union",
      definition: { ...base, itemTypes: [{ id: "a", displayName: "A", icon: "textures/items/a" }] },
      expected: [],
    },
    {
      name: "free-form native components are not reported",
      definition: { ...base, itemTypes: [{ id: "a", displayName: "A", components: { "minecraft:foo": { x: 1 } } }] },
      expected: [],
    },
    {
      name: "unknown key inside a record value",
      definition: { ...base, sharedResources: { textures: { stone: { file: "x", tint: "#fff" } } } },
      expected: ["sharedResources.textures.stone.tint"],
    },
    {
      name: "non-identifier keys use bracket notation",
      definition: { ...base, "my-key": true },
      expected: ['["my-key"]'],
    },
  ];

  for (const testCase of cases) {
    it(testCase.name, function () {
      expect(findUnrecognizedKeys(MinecraftContentSchema, testCase.definition)).to.deep.equal(testCase.expected);
    });
  }

  it("does not report keys for passthrough objects or catchall schemas", function () {
    const schema = z.object({
      open: z.object({ a: z.string() }).passthrough(),
      catchall: z.object({ a: z.string() }).catchall(z.object({ b: z.number() })),
    });

    expect(
      findUnrecognizedKeys(schema, { open: { a: "x", extra: 1 }, catchall: { a: "x", c: { b: 1, d: 2 } } })
    ).to.deep.equal(["catchall.c.d"]);
  });
});

describe("ZodUtilities.preserveUnknownKeys with the MCP SDK", function () {
  async function connect(register: (server: McpServer) => void): Promise<Client> {
    const server = new McpServer({ name: "test", version: "1.0.0" });
    register(server);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "test-client", version: "1.0.0" });
    await client.connect(clientTransport);
    return client;
  }

  const echo = async (args: { definition: unknown }) => ({
    content: [{ type: "text" as const, text: JSON.stringify(args.definition) }],
  });

  it("advertises the same JSON Schema and passes raw input (with unknown keys) to the handler", async function () {
    const client = await connect((server) => {
      server.registerTool("plain", { inputSchema: { definition: MinecraftContentSchema } } as any, echo as any);
      server.registerTool(
        "preserving",
        { inputSchema: { definition: preserveUnknownKeys(MinecraftContentSchema) } } as any,
        echo as any
      );
    });

    try {
      const tools = (await client.listTools()).tools;
      const plain = tools.find((tool) => tool.name === "plain")!;
      const preserving = tools.find((tool) => tool.name === "preserving")!;
      expect(preserving.inputSchema).to.deep.equal(plain.inputSchema);

      const definition = { ...INITIAL_DEFINITION, itemTypes: [{ id: "a", displayName: "A", damage: 5 }] };
      const plainResult: any = await client.callTool({ name: "plain", arguments: { definition } });
      const preservingResult: any = await client.callTool({ name: "preserving", arguments: { definition } });

      expect(JSON.parse(plainResult.content[0].text).itemTypes[0]).to.not.have.property("damage");
      expect(JSON.parse(preservingResult.content[0].text)).to.deep.equal(definition);

      const invalid: any = await client.callTool({ name: "preserving", arguments: { definition: { namespace: 5 } } });
      expect(invalid.isError).to.equal(true);
    } finally {
      await client.close();
    }
  });
});

describe("Lang file helpers", function () {
  const appendCases: {
    name: string;
    existing: string | undefined;
    entries: { key: string; value: string }[];
    expected: string;
    added: string[];
    kept: string[];
  }[] = [
    {
      name: "creates content for a new file",
      existing: undefined,
      entries: [
        { key: "a.name", value: "A" },
        { key: "b.name", value: "B" },
      ],
      expected: "a.name=A\nb.name=B\n",
      added: ["a.name", "b.name"],
      kept: [],
    },
    {
      name: "appends after content without a trailing newline",
      existing: "x.name=X",
      entries: [{ key: "a.name", value: "A" }],
      expected: "x.name=X\na.name=A\n",
      added: ["a.name"],
      kept: [],
    },
    {
      name: "keeps existing keys and reports differing values",
      existing: "a.name=Old\t## comment\n",
      entries: [
        { key: "a.name", value: "New" },
        { key: "b.name", value: "B" },
      ],
      expected: "a.name=Old\t## comment\nb.name=B\n",
      added: ["b.name"],
      kept: ["a.name"],
    },
    {
      name: "does not report keys whose value is unchanged",
      existing: "a.name=A\n",
      entries: [{ key: "a.name", value: "A" }],
      expected: "a.name=A\n",
      added: [],
      kept: [],
    },
    {
      name: "preserves CRLF line endings",
      existing: "x.name=X\r\n",
      entries: [{ key: "a.name", value: "A" }],
      expected: "x.name=X\r\na.name=A\r\n",
      added: ["a.name"],
      kept: [],
    },
    {
      name: "flattens newlines in values and de-duplicates keys",
      existing: undefined,
      entries: [
        { key: "a.name", value: "Line1\nLine2" },
        { key: "a.name", value: "Other" },
      ],
      expected: "a.name=Line1 Line2\n",
      added: ["a.name"],
      kept: [],
    },
  ];

  for (const testCase of appendCases) {
    it(`appendMissingEntries ${testCase.name}`, function () {
      const result = Lang.appendMissingEntries(testCase.existing, testCase.entries);
      expect(result.content).to.equal(testCase.expected);
      expect(result.added).to.deep.equal(testCase.added);
      expect(result.kept.map((k) => k.key)).to.deep.equal(testCase.kept);
    });
  }

  const languagesCases: { name: string; existing: string | undefined; expected: string[] | undefined }[] = [
    { name: "creates a new list", existing: undefined, expected: ["en_US"] },
    { name: "adds to an existing list", existing: '["fr_FR"]', expected: ["fr_FR", "en_US"] },
    { name: "leaves a list that already has the language", existing: '["en_US"]', expected: undefined },
    { name: "leaves malformed content alone", existing: "{ not json", expected: undefined },
    { name: "leaves non-array content alone", existing: '{"en_US": true}', expected: undefined },
  ];

  for (const testCase of languagesCases) {
    it(`addLanguageToLanguagesJson ${testCase.name}`, function () {
      const result = Lang.addLanguageToLanguagesJson(testCase.existing, "en_US");
      expect(result === undefined ? undefined : JSON.parse(result)).to.deep.equal(testCase.expected);
    });
  }
});

describe("ContentGenerator project-level output", function () {
  it("counts generated files and produces pack icons and localization", async function () {
    const definition: IMinecraftContentDefinition = {
      schemaVersion: "1.0.0",
      namespace: "demo",
      entityTypes: [{ id: "orc", displayName: "Orc", drops: [{ item: "bone" }], spawning: { biomes: ["plains"] } }],
      blockTypes: [{ id: "ruby_block", displayName: "Ruby Block" }],
      itemTypes: [
        { id: "ruby", displayName: "Ruby" },
        { id: "named", displayName: "Named", components: { "minecraft:display_name": { value: "item.demo:named" } } },
      ],
      features: [{ id: "empty_feature" }],
    };

    const result = await new ContentGenerator(definition).generate();

    expect(result.summary.lootTableCount).to.equal(1);
    expect(result.summary.spawnRuleCount).to.equal(1);
    expect(result.summary.featureCount).to.equal(0);
    expect(result.summary.warnings.some((w) => w.includes("empty_feature"))).to.equal(true);
    expect(result.behaviorPackIcon?.path).to.equal("pack_icon.png");
    expect(result.resourcePackIcon?.pack).to.equal("resource");
    expect(result.langEntries.map((e) => e.key)).to.deep.equal([
      "entity.demo:orc.name",
      "item.spawn_egg.entity.demo:orc.name",
      "tile.demo:ruby_block.name",
    ]);

    const components = (id: string) =>
      (result.itemBehaviors.find((f) => f.path === `items/${id}.json`)!.content as any)["minecraft:item"].components;
    expect(components("ruby")["minecraft:display_name"]).to.deep.equal({ value: "Ruby" });
    expect(components("named")["minecraft:display_name"]).to.deep.equal({ value: "item.demo:named" });
  });
});

describe("ContentWriter localization", function () {
  this.timeout(30000);

  let env: ITestEnvironment;
  let tempRoot: string;

  before(async function () {
    env = await TestPaths.createTestEnvironment();
  });

  beforeEach(function () {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mct-content-writer-"));
  });

  afterEach(function () {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("appends lang entries to the project's resource pack without changing existing keys", async function () {
    const project = new Project(env.creatorTools, "writer_test", null);
    project.autoDeploymentMode = ProjectAutoDeploymentMode.noAutoDeployment;
    project.localFolderPath = StorageUtilities.ensureEndsWithDelimiter(tempRoot);
    await project.ensureProjectFolder();
    const rpFolder = await project.ensureDefaultResourcePackFolder();

    const textsPath = path.join(rpFolder.fullPath, "texts");
    fs.mkdirSync(textsPath, { recursive: true });
    fs.writeFileSync(path.join(textsPath, "en_US.lang"), "entity.demo:orc.name=Grumpy Orc\n");

    const content = await new ContentGenerator({
      schemaVersion: "1.0.0",
      namespace: "demo",
      entityTypes: [{ id: "orc", displayName: "Orc" }],
      blockTypes: [{ id: "ruby_block", displayName: "Ruby Block" }],
    }).generate();
    await ContentWriter.writeGeneratedContent(project, content);

    expect(fs.readFileSync(path.join(textsPath, "en_US.lang"), "utf-8")).to.equal(
      "entity.demo:orc.name=Grumpy Orc\n" +
        "item.spawn_egg.entity.demo:orc.name=Orc Spawn Egg\n" +
        "tile.demo:ruby_block.name=Ruby Block\n"
    );
    expect(readJson(path.join(textsPath, "languages.json"))).to.deep.equal(["en_US"]);
  });
});
