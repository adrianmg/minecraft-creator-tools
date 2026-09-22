// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Regression tests for adding several "New Block Based on Existing" blocks to one project.
 *
 * Each block gallery item ships its own copy of the pack-wide catalogs (blocks.json and
 * terrain_texture.json). Adding a second block used to copy those straight over the
 * project's versions, so the entries the first block relied on were dropped, and the
 * catalog Definition that the editor had already parsed kept describing the previous
 * file contents, so the new block could not find its texture either.
 */

import { assert, expect } from "chai";
import * as fs from "fs";
import CreatorTools from "../app/CreatorTools";
import Project, { ProjectAutoDeploymentMode } from "../app/Project";
import IFolder from "../storage/IFolder";
import StorageUtilities from "../storage/StorageUtilities";
import TestPaths, { ITestEnvironment } from "./TestPaths";
import IGalleryItem, { GalleryItemType } from "../app/IGalleryItem";
import ProjectCreateManager from "../app/ProjectCreateManager";
import ProjectItem from "../app/ProjectItem";
import ProjectItemUtilities from "../app/ProjectItemUtilities";
import { ProjectItemType } from "../app/IProjectItemData";
import BlockTypeDefinition from "../minecraft/BlockTypeDefinition";
import TerrainTextureCatalogDefinition from "../minecraft/TerrainTextureCatalogDefinition";
import BlocksCatalogDefinition from "../minecraft/BlocksCatalogDefinition";

let creatorTools: CreatorTools | undefined = undefined;
let resultsFolder: IFolder | undefined = undefined;

const RESULT_FOLDER_NAME = "galleryBlockTypeAdd";

// Mirrors the block entries in public/data/gallery.json. The crate comes from the
// starter_blocks sample and the sushi roll from custom_blocks, so each add brings a
// different blocks.json / terrain_texture.json into the project.
const crateBlockGalleryItem: IGalleryItem = {
  title: "Crate Starter Block",
  description: "The crate starter block is an example of a simple block with a custom model.",
  gitHubOwner: "microsoft",
  gitHubRepoName: "minecraft-samples",
  gitHubFolder: "/starter_blocks",
  thumbnailImage: "",
  id: "crateBlock",
  nameReplacers: ["crate"],
  fileList: [
    "/behavior_packs/starter_blocks/blocks/crate.json",
    "/resource_packs/starter_blocks/blocks.json",
    "/resource_packs/starter_blocks/texts/en_US.lang",
    "/resource_packs/starter_blocks/models/blocks/crate.geo.json",
    "/resource_packs/starter_blocks/textures/blocks/crate.png",
    "/resource_packs/starter_blocks/textures/terrain_texture.json",
  ],
  type: GalleryItemType.blockType,
};

const sushiRollBlockGalleryItem: IGalleryItem = {
  title: "Sushi Block",
  description: "The sushi roll block is an example of a simple block with a custom model.",
  gitHubOwner: "microsoft",
  gitHubRepoName: "minecraft-samples",
  gitHubFolder: "/custom_blocks",
  thumbnailImage: "",
  id: "sushiRollBlock",
  nameReplacers: ["sushi", "salmon_roll"],
  fileList: [
    "/behavior_packs/custom_blocks/blocks/salmon_roll.json",
    "/resource_packs/custom_blocks/blocks.json",
    "/resource_packs/custom_blocks/texts/en_US.lang",
    "/resource_packs/custom_blocks/models/blocks/sushi.geo.json",
    "/resource_packs/custom_blocks/textures/blocks/sushi_wrap.png",
    "/resource_packs/custom_blocks/textures/blocks/salmon_roll.png",
    "/resource_packs/custom_blocks/textures/terrain_texture.json",
  ],
  type: GalleryItemType.blockType,
};

const basicUnitCubeBlockGalleryItem: IGalleryItem = {
  title: "Solid Cube Block Starter",
  description: "This is a simple solid unit cube block.",
  gitHubOwner: "microsoft",
  gitHubRepoName: "minecraft-samples",
  gitHubFolder: "/starter_blocks",
  thumbnailImage: "",
  id: "basicUnitCubeBlock",
  nameReplacers: ["simple_cube"],
  fileList: [
    "/behavior_packs/starter_blocks/blocks/simple_cube.json",
    "/resource_packs/starter_blocks/blocks.json",
    "/resource_packs/starter_blocks/texts/en_US.lang",
    "/resource_packs/starter_blocks/textures/blocks/simple_cube.png",
    "/resource_packs/starter_blocks/textures/terrain_texture.json",
  ],
  type: GalleryItemType.blockType,
};

(async () => {
  const env: ITestEnvironment = await TestPaths.createTestEnvironment();
  creatorTools = env.creatorTools;
  resultsFolder = env.resultsFolder;
})();

function must<T>(value: T | undefined | null, message: string): T {
  if (value === undefined || value === null) {
    assert.fail(message);
  }

  return value;
}

function removeResultFolder(folderName: string) {
  if (resultsFolder) {
    const path =
      StorageUtilities.ensureEndsWithDelimiter(resultsFolder.fullPath) +
      StorageUtilities.ensureEndsWithDelimiter(folderName);

    if (fs.existsSync(path) && !StorageUtilities.isPathRiskyForDelete(path)) {
      fs.rmSync(path, { recursive: true });
    }
  }
}

async function createEmptyProject(folderName: string) {
  if (!creatorTools || !resultsFolder) {
    assert.fail("Not properly initialized");
  }

  removeResultFolder(folderName);

  const projectFolder = resultsFolder.ensureFolder(folderName);
  await projectFolder.ensureExists();

  const project = new Project(creatorTools, folderName, null);

  project.autoDeploymentMode = ProjectAutoDeploymentMode.noAutoDeployment;
  project.localFolderPath = StorageUtilities.ensureEndsWithDelimiter(projectFolder.fullPath);

  await project.ensureProjectFolder();
  await project.ensureDefaultBehaviorPackFolder();
  await project.ensureDefaultResourcePackFolder();

  return project;
}

async function addBlock(project: Project, galleryItem: IGalleryItem, name: string): Promise<ProjectItem> {
  await ProjectCreateManager.addBlockTypeFromGallery(project, galleryItem, name);

  const blockItem = must(
    ProjectItemUtilities.getItemByTypeAndName(project, name, ProjectItemType.blockTypeBehavior),
    `Block '${name}' was not added to the project`
  );

  if (!blockItem.isContentLoaded) {
    await blockItem.loadContent();
  }

  // The block editor resolves textures from the block's relations; build them the same way it does.
  await blockItem.ensureDependencies();

  return blockItem;
}

async function getBlockType(blockItem: ProjectItem) {
  const primaryFile = must(blockItem.primaryFile, `Block '${blockItem.name}' should have a primary file`);

  return must(await BlockTypeDefinition.ensureOnFile(primaryFile), `Block '${blockItem.name}' should parse`);
}

async function getTextureIds(project: Project, blockItem: ProjectItem) {
  const blockType = await getBlockType(blockItem);
  const textureIds = [...(blockType.getTextureList() ?? [])];

  // Unit cube blocks reference their textures through blocks.json rather than material_instances.
  if (blockType.isUnitCube) {
    textureIds.push(...(await blockType.getTextureListFromBlocksCatalog(project)));
  }

  assert.isAbove(textureIds.length, 0, `Block '${blockItem.name}' should reference at least one texture`);

  return textureIds;
}

async function readRpJson(project: Project, relativePath: string) {
  const rpFolder = await project.ensureDefaultResourcePackFolder();
  const file = must(
    await rpFolder.getFileFromRelativePath(relativePath),
    `Expected '${relativePath}' in the resource pack`
  );

  if (!file.isContentLoaded) {
    await file.loadContent();
  }

  return must(StorageUtilities.getJsonObject(file), `Expected '${relativePath}' to be parseable JSON`);
}

function assertBlockResolvesTexture(blockItem: ProjectItem, textureIds: string[], label: string) {
  const catalogChild = blockItem.childItems?.find(
    (rel) => rel.childItem.itemType === ProjectItemType.terrainTextureCatalogResourceJson
  );

  assert.isDefined(
    catalogChild,
    `${label}: the terrain texture catalog should be linked to the block (texture ids: ${textureIds.join(", ")})`
  );
}

describe("gallery block type add", async () => {
  it("keeps the first block's texture entries when a second block from another sample is added", async () => {
    const project = await createEmptyProject(RESULT_FOLDER_NAME + "Second");

    const crateItem = await addBlock(project, crateBlockGalleryItem, "crateblock");
    const crateTextureIds = await getTextureIds(project, crateItem);
    assertBlockResolvesTexture(crateItem, crateTextureIds, "first block (crate)");

    const sushiItem = await addBlock(project, sushiRollBlockGalleryItem, "sushirollblock");
    const sushiTextureIds = await getTextureIds(project, sushiItem);

    const terrainTextures = await readRpJson(project, "/textures/terrain_texture.json");

    for (const textureId of [...crateTextureIds, ...sushiTextureIds]) {
      assert.isDefined(
        terrainTextures.texture_data?.[textureId],
        `terrain_texture.json should still contain '${textureId}' after adding a second block`
      );
    }

    const blocksCatalog = await readRpJson(project, "/blocks.json");
    const crateDef = await getBlockType(crateItem);
    const sushiDef = await getBlockType(sushiItem);
    const crateId = must(crateDef.id, "crate block should have an identifier");
    const sushiId = must(sushiDef.id, "sushi block should have an identifier");

    assert.isDefined(blocksCatalog[crateId], "blocks.json should keep the first block's entry");
    assert.isDefined(blocksCatalog[sushiId], "blocks.json should contain the second block's entry");

    assertBlockResolvesTexture(sushiItem, sushiTextureIds, "second block (sushi)");

    // The parsed catalogs must describe the merged file, not the copy from the first add.
    const terrainCatalog = must(
      await TerrainTextureCatalogDefinition.getTerrainTextureCatalog(project),
      "project should have a terrain texture catalog"
    );

    for (const textureId of [...crateTextureIds, ...sushiTextureIds]) {
      assert.isDefined(
        terrainCatalog.getTexture(textureId),
        `the loaded terrain texture catalog should know '${textureId}'`
      );
    }

    const blockCatalog = must(
      await BlocksCatalogDefinition.getBlockCatalog(project),
      "project should have a blocks catalog"
    );
    assert.isDefined(blockCatalog.getCatalogResource(crateId), "the loaded blocks catalog should know the crate");
    assert.isDefined(blockCatalog.getCatalogResource(sushiId), "the loaded blocks catalog should know the sushi roll");

    // And the second block's textures must resolve to actual texture files, as the editor preview requires.
    const sushiTextures = must(
      await sushiDef.getTextureItems(sushiItem, project),
      "sushi block should resolve texture items"
    );
    expect(Object.keys(sushiTextures).length).to.be.above(0);
  });

  it("keeps both blocks' texture entries when two blocks come from the same sample", async () => {
    const project = await createEmptyProject(RESULT_FOLDER_NAME + "SameSample");

    const crateItem = await addBlock(project, crateBlockGalleryItem, "crateblock");
    const crateTextureIds = await getTextureIds(project, crateItem);

    const cubeItem = await addBlock(project, basicUnitCubeBlockGalleryItem, "cubeblock");
    const cubeTextureIds = await getTextureIds(project, cubeItem);

    const terrainTextures = await readRpJson(project, "/textures/terrain_texture.json");

    for (const textureId of [...crateTextureIds, ...cubeTextureIds]) {
      assert.isDefined(
        terrainTextures.texture_data?.[textureId],
        `terrain_texture.json should contain '${textureId}' after adding a second block from the same sample`
      );
    }

    assertBlockResolvesTexture(cubeItem, cubeTextureIds, "second block (cube)");

    // Relations for the first block were built before the second add; it must still resolve.
    await crateItem.ensureDependencies();
    assertBlockResolvesTexture(crateItem, crateTextureIds, "first block (crate) after second add");
  });

  it("survives a reload of the project from disk", async () => {
    if (!creatorTools) {
      assert.fail("Not properly initialized");
    }

    const folderName = RESULT_FOLDER_NAME + "Reload";
    const project = await createEmptyProject(folderName);

    await addBlock(project, crateBlockGalleryItem, "crateblock");
    await addBlock(project, sushiRollBlockGalleryItem, "sushirollblock");
    await project.save();

    const reloaded = new Project(creatorTools, folderName, null);
    reloaded.autoDeploymentMode = ProjectAutoDeploymentMode.noAutoDeployment;
    reloaded.localFolderPath = project.localFolderPath;

    await reloaded.inferProjectItemsFromFiles();

    for (const name of ["crateblock", "sushirollblock"]) {
      const blockItem = must(
        ProjectItemUtilities.getItemByTypeAndName(reloaded, name, ProjectItemType.blockTypeBehavior),
        `Block '${name}' should exist after reload`
      );

      if (!blockItem.isContentLoaded) {
        await blockItem.loadContent();
      }

      await blockItem.ensureDependencies();

      const textureIds = await getTextureIds(reloaded, blockItem);
      assertBlockResolvesTexture(blockItem, textureIds, `${name} after reload`);
    }
  });
});
