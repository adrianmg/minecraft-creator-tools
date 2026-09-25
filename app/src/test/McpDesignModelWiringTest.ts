// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Tests for the designModel MCP tool's naming and wiring (see ModelDesignWiring and
 * MinecraftMcpServer._applyModelDesignToProject).
 *
 * Regressions covered:
 * - The geometry identifier came from design.identifier (often a template placeholder such as
 *   "custom_humanoid") instead of following modelId, so nothing referenced the new geometry.
 * - The tool claimed to auto-wire but never updated the client entity; a mob created with
 *   createMinecraftContent kept pointing at the old geometry and became invisible.
 * - Designs were stored under a placeholder "design_packs/contoso_<x>_dp" folder.
 */

import { expect, assert } from "chai";
import "mocha";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import CreatorTools from "../app/CreatorTools";
import Project, { ProjectAutoDeploymentMode } from "../app/Project";
import { ProjectItemType } from "../app/IProjectItemData";
import MinecraftMcpServer from "../local/MinecraftMcpServer";
import ModelDesignUtilities from "../minecraft/ModelDesignUtilities";
import ModelDesignWiring from "../minecraft/ModelDesignWiring";
import { IMcpModelDesign } from "../minecraft/IMcpModelDesign";
import ProjectInfoSet from "../info/ProjectInfoSet";
import { ProjectInfoSuite } from "../info/IProjectInfoData";
import { UnlinkedItemNotFoundByType } from "../info/projectItemGenerators/unlinkedItemInfo/UnlinkedItemInfoData";
import TestPaths from "./TestPaths";

/** A small design whose identifier is a template placeholder, like getModelTemplates output. */
function makeDesign(identifier: string = "custom_humanoid"): IMcpModelDesign {
  return {
    identifier,
    textureSize: [32, 32],
    textures: {
      fur: { background: { type: "solid", colors: ["#FFFFFF"] } },
      patch: { background: { type: "solid", colors: ["#111111"] } },
    },
    bones: [
      {
        name: "body",
        pivot: [0, 0, 0],
        cubes: [
          {
            origin: [-4, 0, -4],
            size: [8, 8, 8],
            faces: {
              north: { textureId: "patch" },
              south: { textureId: "fur" },
              east: { textureId: "fur" },
              west: { textureId: "fur" },
              up: { textureId: "fur" },
              down: { textureId: "fur" },
            },
          },
        ],
      },
    ],
  } as IMcpModelDesign;
}

function readJson(filePath: string): any {
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function writeJson(filePath: string, content: object) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(content, null, 2), "utf-8");
}

describe("designModel naming and wiring", function () {
  this.timeout(60000);

  let creatorTools: CreatorTools;
  let server: MinecraftMcpServer;
  const tempRoots: string[] = [];

  before(async function () {
    const env = await TestPaths.createTestEnvironment();
    creatorTools = env.creatorTools;
    server = new MinecraftMcpServer();
    (server as any)._creatorTools = creatorTools;
  });

  after(function () {
    for (const root of tempRoots) {
      try {
        fs.rmSync(root, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
    }
  });

  function freshFolder(name: string): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mct-designmodel-"));
    tempRoots.push(root);
    const folder = path.join(root, name);
    fs.mkdirSync(folder, { recursive: true });
    return folder;
  }

  async function createContent(folder: string, definition: object): Promise<string> {
    const result: any = await (server as any)._createMinecraftContentOp({ definition, outputPath: folder });
    const projectRoot = result?.structuredContent?.projectRoot;
    assert.isString(projectRoot, `createMinecraftContent failed: ${JSON.stringify(result?.content)}`);
    return projectRoot;
  }

  async function applyDesign(args: object): Promise<any> {
    const applied = await (server as any)._applyModelDesignToProject(args);
    if ("errorResult" in applied) {
      assert.fail(`designModel failed: ${JSON.stringify(applied.errorResult.content)}`);
    }
    return applied;
  }

  async function createPanda(name: string): Promise<string> {
    return createContent(freshFolder(name), {
      schemaVersion: "1.0.0",
      namespace: "e2e",
      displayName: "E2E Panda",
      entityTypes: [{ id: "panda", displayName: "Panda", traits: ["quadruped", "passive"] }],
    });
  }

  // -------------------------------------------------------------------------
  // Pure helpers
  // -------------------------------------------------------------------------

  describe("ModelDesignUtilities.getGeometryIdentifierForModelId", function () {
    const cases: { modelId: string; identifier?: string; expected: string }[] = [
      { modelId: "panda", identifier: "custom_humanoid", expected: "geometry.panda" },
      { modelId: "panda", identifier: "geometry.custom_humanoid", expected: "geometry.panda" },
      { modelId: "panda", identifier: "geometry.demo.panda", expected: "geometry.demo.panda" },
      { modelId: "panda", identifier: "demo.panda", expected: "geometry.demo.panda" },
      { modelId: "panda", identifier: "panda", expected: "geometry.panda" },
      { modelId: "panda", identifier: "geometry.panda", expected: "geometry.panda" },
      { modelId: "panda", identifier: "red_panda", expected: "geometry.panda" },
      { modelId: "panda", identifier: undefined, expected: "geometry.panda" },
      { modelId: "disco.pig", identifier: "geometry.demo.disco.pig", expected: "geometry.demo.disco.pig" },
    ];

    for (const c of cases) {
      it(`modelId "${c.modelId}" + identifier "${c.identifier}" -> "${c.expected}"`, function () {
        expect(ModelDesignUtilities.getGeometryIdentifierForModelId(c.modelId, c.identifier)).to.equal(c.expected);
      });
    }
  });

  describe("ModelDesignUtilities.isValidModelId", function () {
    const cases: { modelId: string; valid: boolean }[] = [
      { modelId: "disco_pig", valid: true },
      { modelId: "Magic-Sword.v2", valid: true },
      { modelId: "demo:panda", valid: false },
      { modelId: "models/panda", valid: false },
      { modelId: "..\\panda", valid: false },
      { modelId: ".hidden", valid: false },
      { modelId: "has space", valid: false },
      { modelId: "", valid: false },
    ];

    for (const c of cases) {
      it(`"${c.modelId}" is ${c.valid ? "valid" : "invalid"}`, function () {
        expect(ModelDesignUtilities.isValidModelId(c.modelId)).to.equal(c.valid);
      });
    }
  });

  describe("ModelDesignWiring.identifierMatches", function () {
    const cases: { identifier: string; query: string; matches: boolean }[] = [
      { identifier: "e2e:panda", query: "panda", matches: true },
      { identifier: "e2e:panda", query: "e2e:panda", matches: true },
      { identifier: "e2e:panda", query: "E2E:Panda", matches: true },
      { identifier: "e2e:panda", query: "other:panda", matches: false },
      { identifier: "e2e:red_panda", query: "panda", matches: false },
      { identifier: "panda", query: "panda", matches: true },
    ];

    for (const c of cases) {
      it(`"${c.identifier}" ${c.matches ? "matches" : "does not match"} "${c.query}"`, function () {
        expect(ModelDesignWiring.identifierMatches(c.identifier, c.query)).to.equal(c.matches);
      });
    }
  });

  describe("design pack short name", function () {
    const cases: { projectPath: string; packFolder?: string; expected: string }[] = [
      { projectPath: "/work/mob", packFolder: "e2e", expected: "e2e" },
      { projectPath: "/work/mob", packFolder: "e2epanda_rp", expected: "e2epanda" },
      { projectPath: "/work/mob", packFolder: "my_pack_bp", expected: "my_pack" },
      { projectPath: "/work/mob", packFolder: "Cool Pack RP", expected: "cool_pack" },
      { projectPath: "/work/Panda Project", packFolder: undefined, expected: "panda_project" },
      { projectPath: "/work/a-very-long-project-name", packFolder: undefined, expected: "a_very_long_p" },
    ];

    for (const c of cases) {
      it(`${c.projectPath} + ${c.packFolder} -> ${c.expected}`, function () {
        expect((MinecraftMcpServer as any)._getDesignProjectShortName(c.projectPath, c.packFolder)).to.equal(
          c.expected
        );
      });
    }
  });

  // -------------------------------------------------------------------------
  // End-to-end: createMinecraftContent + designModel
  // -------------------------------------------------------------------------

  describe("entity wiring", function () {
    it("rewires the client entity created by createMinecraftContent to the new geometry", async function () {
      const projectRoot = await createPanda("panda_project");
      const clientEntityPath = path.join(projectRoot, "resource_packs", "e2e", "entity", "panda.entity.json");

      expect(readJson(clientEntityPath)["minecraft:client_entity"].description.geometry.default).to.equal(
        "geometry.e2e.panda"
      );

      const applied = await applyDesign({ projectPath: projectRoot, design: makeDesign(), modelId: "panda" });

      expect(applied.geometryIdentifier).to.equal("geometry.panda");
      expect(applied.identifierNote).to.contain("custom_humanoid");
      expect(applied.wiring.status).to.equal("wired");
      expect(applied.wiring.targetId).to.equal("e2e:panda");

      const geo = readJson(path.join(projectRoot, "resource_packs", "e2e", "models", "entity", "panda.geo.json"));
      expect(geo["minecraft:geometry"][0].description.identifier).to.equal("geometry.panda");

      const desc = readJson(clientEntityPath)["minecraft:client_entity"].description;
      expect(desc.geometry.default).to.equal("geometry.panda");
      expect(desc.textures.default).to.equal("textures/entity/panda");
      expect(desc.render_controllers).to.deep.equal(["controller.render.e2e.panda"]);

      // The persisted design uses the resolved identifier too.
      expect(applied.design.identifier).to.equal("geometry.panda");
    });

    it("leaves no unlinked geometry reference for validation to flag", async function () {
      const projectRoot = await createPanda("panda_validate");
      await applyDesign({ projectPath: projectRoot, design: makeDesign(), modelId: "panda" });

      const project = new Project(creatorTools, "panda_validate", null);
      project.autoDeploymentMode = ProjectAutoDeploymentMode.noAutoDeployment;
      project.localFolderPath = projectRoot;
      await project.inferProjectItemsFromFiles();

      const infoSet = new ProjectInfoSet(project, ProjectInfoSuite.defaultInDevelopment);
      await infoSet.generateForProject();

      const unlinkedGeometry = infoSet.items.filter(
        (item) =>
          item.generatorId === "UNLINK" &&
          item.generatorIndex === UnlinkedItemNotFoundByType + ProjectItemType.modelGeometryJson
      );

      expect(unlinkedGeometry.map((i) => `${i.projectItemPath}: ${i.message}`)).to.deep.equal([]);
    });

    it("stores the design in a design pack named after the project, not contoso", async function () {
      const projectRoot = await createPanda("mob");
      await applyDesign({ projectPath: projectRoot, design: makeDesign(), modelId: "panda" });

      const designPacks = fs.readdirSync(path.join(projectRoot, "design_packs"));
      expect(designPacks).to.deep.equal(["e2e_dp"]);

      const designPackRoot = path.join(projectRoot, "design_packs", "e2e_dp");
      const designJson = fs
        .readdirSync(designPackRoot, { recursive: true })
        .map((f) => String(f))
        .find((f) => f.endsWith("model_design.json"));
      assert.isDefined(designJson, "model_design.json should be saved in the design pack");

      const saved = readJson(path.join(designPackRoot, designJson!));
      expect(saved.design.identifier).to.equal("geometry.panda");
      expect(saved.wiredTo).to.equal("e2e:panda");
    });

    it("names packs after the project folder when the project is empty", async function () {
      const folder = freshFolder("Empty Models");
      const applied = await applyDesign({ projectPath: folder, design: makeDesign(), modelId: "blob" });

      expect(applied.wiring.status).to.equal("notFound");
      expect(fs.readdirSync(path.join(folder, "resource_packs"))).to.deep.equal(["empty_models_rp"]);
      expect(fs.readdirSync(path.join(folder, "design_packs"))).to.deep.equal(["empty_models_dp"]);
    });

    it("does not modify the client entity when wireTo is false", async function () {
      const projectRoot = await createPanda("panda_nowire");
      const clientEntityPath = path.join(projectRoot, "resource_packs", "e2e", "entity", "panda.entity.json");
      const before = fs.readFileSync(clientEntityPath, "utf-8");

      const applied = await applyDesign({
        projectPath: projectRoot,
        design: makeDesign(),
        modelId: "panda",
        wireTo: false,
      });

      expect(applied.wiring.status).to.equal("skipped");
      expect(applied.wiring.filesUpdated).to.deep.equal([]);
      expect(fs.readFileSync(clientEntityPath, "utf-8")).to.equal(before);
    });

    it("wires to an explicit wireTo target with a different modelId", async function () {
      const projectRoot = await createPanda("panda_explicit");

      const applied = await applyDesign({
        projectPath: projectRoot,
        design: makeDesign("geometry.e2e.panda_v2"),
        modelId: "panda_v2",
        wireTo: "e2e:panda",
      });

      expect(applied.geometryIdentifier).to.equal("geometry.e2e.panda_v2");
      expect(applied.identifierNote).to.be.undefined;
      expect(applied.wiring.status).to.equal("wired");

      const desc = readJson(path.join(projectRoot, "resource_packs", "e2e", "entity", "panda.entity.json"))[
        "minecraft:client_entity"
      ].description;
      expect(desc.geometry.default).to.equal("geometry.e2e.panda_v2");
      expect(desc.textures.default).to.equal("textures/entity/panda_v2");
    });

    it("reports an unknown wireTo target instead of wiring", async function () {
      const projectRoot = await createPanda("panda_missing");

      const applied = await applyDesign({
        projectPath: projectRoot,
        design: makeDesign(),
        modelId: "panda",
        wireTo: "e2e:koala",
      });

      expect(applied.wiring.status).to.equal("notFound");
      expect(applied.wiring.message).to.contain("e2e:koala");
    });

    it("refuses to guess when the modelId matches entities in several namespaces", async function () {
      const projectRoot = await createPanda("panda_ambiguous");
      writeJson(path.join(projectRoot, "resource_packs", "e2e", "entity", "other_panda.entity.json"), {
        format_version: "1.10.0",
        "minecraft:client_entity": {
          description: {
            identifier: "other:panda",
            materials: { default: "entity_alphatest" },
            textures: { default: "textures/entity/other_panda" },
            geometry: { default: "geometry.other.panda" },
            render_controllers: ["controller.render.default"],
          },
        },
      });

      const applied = await applyDesign({ projectPath: projectRoot, design: makeDesign(), modelId: "panda" });

      expect(applied.wiring.status).to.equal("ambiguous");
      expect(applied.wiring.message).to.contain("e2e:panda");
      expect(applied.wiring.message).to.contain("other:panda");
      expect(
        readJson(path.join(projectRoot, "resource_packs", "e2e", "entity", "panda.entity.json"))[
          "minecraft:client_entity"
        ].description.geometry.default
      ).to.equal("geometry.e2e.panda");
    });

    it("rejects a modelId that is not file-name safe", async function () {
      const folder = freshFolder("bad_model_id");
      const applied = await (server as any)._applyModelDesignToProject({
        projectPath: folder,
        design: makeDesign(),
        modelId: "e2e:panda",
      });

      expect(applied.errorResult?.isError).to.equal(true);
      expect(applied.errorResult.content[0].text).to.contain("modelId");
    });
  });

  describe("block wiring", function () {
    it("sets minecraft:geometry and material_instances on the matching block", async function () {
      const projectRoot = await createContent(freshFolder("crystal_project"), {
        schemaVersion: "1.0.0",
        namespace: "e2e",
        blockTypes: [{ id: "crystal", displayName: "Crystal" }],
      });

      const applied = await applyDesign({
        projectPath: projectRoot,
        design: makeDesign("custom_block"),
        modelId: "crystal",
        usage: "block",
      });

      expect(applied.wiring.status).to.equal("wired");
      expect(applied.wiring.targetId).to.equal("e2e:crystal");

      const components = readJson(path.join(projectRoot, "behavior_packs", "e2e", "blocks", "crystal.json"))[
        "minecraft:block"
      ].components;
      expect(components["minecraft:geometry"]).to.equal("geometry.crystal");
      expect(Object.keys(components["minecraft:material_instances"])).to.deep.equal(["*"]);

      const textureKey = components["minecraft:material_instances"]["*"].texture;
      const terrain = readJson(path.join(projectRoot, "resource_packs", "e2e", "textures", "terrain_texture.json"));
      expect(terrain.texture_data[textureKey].textures).to.equal("textures/blocks/crystal");
      expect(fs.existsSync(path.join(projectRoot, "resource_packs", "e2e", "textures", "blocks", "crystal.png"))).to.be
        .true;
    });
  });

  describe("item wiring", function () {
    const gemDefinition = {
      schemaVersion: "1.0.0",
      namespace: "e2e",
      itemTypes: [{ id: "gem", displayName: "Gem" }],
    };

    it("says clearly that it did not wire when the item has no attachable", async function () {
      const projectRoot = await createContent(freshFolder("gem_project"), gemDefinition);
      const itemPath = path.join(projectRoot, "behavior_packs", "e2e", "items", "gem.json");
      const before = fs.readFileSync(itemPath, "utf-8");

      const applied = await applyDesign({
        projectPath: projectRoot,
        design: makeDesign(),
        modelId: "gem",
        usage: "item",
      });

      expect(applied.wiring.status).to.equal("notSupported");
      expect(applied.wiring.message).to.contain("Not wired");
      expect(applied.wiring.message).to.contain("e2e:gem");
      expect(fs.readFileSync(itemPath, "utf-8")).to.equal(before);
    });

    it("updates an existing attachable for the item", async function () {
      const projectRoot = await createContent(freshFolder("gem_attachable"), gemDefinition);
      const attachablePath = path.join(projectRoot, "resource_packs", "e2e", "attachables", "gem.json");
      writeJson(attachablePath, {
        format_version: "1.10.0",
        "minecraft:attachable": {
          description: {
            identifier: "e2e:gem",
            materials: { default: "entity_alphatest" },
            textures: { default: "textures/items/old_gem" },
            geometry: { default: "geometry.old_gem" },
            render_controllers: ["controller.render.item_default"],
          },
        },
      });

      const applied = await applyDesign({
        projectPath: projectRoot,
        design: makeDesign(),
        modelId: "gem",
        usage: "item",
      });

      expect(applied.wiring.status).to.equal("wired");

      const desc = readJson(attachablePath)["minecraft:attachable"].description;
      expect(desc.geometry.default).to.equal("geometry.gem");
      expect(desc.textures.default).to.equal("textures/items/gem");
      expect(desc.render_controllers).to.deep.equal(["controller.render.item_default"]);
    });
  });
});
