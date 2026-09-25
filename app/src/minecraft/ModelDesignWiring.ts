// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * ARCHITECTURE DOCUMENTATION: ModelDesignWiring
 * =============================================
 *
 * Connects a model produced by the `designModel` MCP tool to the content that should
 * render it. The tool writes `<modelId>.geo.json` (geometry identifier resolved by
 * ModelDesignUtilities.getGeometryIdentifierForModelId) plus `<modelId>.png`, then calls
 * `ModelDesignWiring.wire()`:
 *
 * - entity: updates every client entity (RP `entity/*.json`) whose identifier matches, setting
 *   `geometry.default` and `textures.default` (and adding a default material/render controller
 *   when they are missing).
 * - block: updates the block behavior (BP `blocks/*.json`) whose identifier matches, setting
 *   `minecraft:geometry` and a `*` entry in `minecraft:material_instances`, and registers the
 *   texture in the resource pack's `textures/terrain_texture.json`.
 * - item: updates an existing attachable (RP `attachables/*.json`) whose identifier matches.
 *   Attachables are NOT created, because they need hand-tuned first/third-person animations;
 *   the result says so explicitly.
 *
 * Target matching: `wireTo` (or modelId when wireTo is omitted) is compared against the
 * target identifier. A value containing ':' must match the full identifier; otherwise it
 * matches the part after the namespace. If several different identifiers match, nothing is
 * wired and the caller is asked to pass the full identifier.
 */

import Project from "../app/Project";
import ProjectItem from "../app/ProjectItem";
import { ProjectItemType } from "../app/IProjectItemData";
import IFolder from "../storage/IFolder";
import IFile from "../storage/IFile";
import StorageUtilities from "../storage/StorageUtilities";
import Log from "../core/Log";
import EntityTypeResourceDefinition from "./EntityTypeResourceDefinition";
import AttachableResourceDefinition from "./AttachableResourceDefinition";
import BlockTypeDefinition from "./BlockTypeDefinition";

export type ModelDesignUsage = "entity" | "block" | "item";

export type ModelDesignWiringStatus = "wired" | "skipped" | "notFound" | "ambiguous" | "notSupported" | "failed";

export interface IModelDesignWiringOptions {
  project: Project;
  /** Resource pack the model files were written into. */
  rpFolder: IFolder;
  modelId: string;
  usage: ModelDesignUsage;
  /** Geometry identifier written into `<modelId>.geo.json`. */
  geometryIdentifier: string;
  /** Target identifier, `false` to skip wiring, or undefined to auto-discover by modelId. */
  wireTo?: string | false;
}

export interface IModelDesignWiringResult {
  status: ModelDesignWiringStatus;
  /** Identifier of the entity/block/item the model was wired to. */
  targetId?: string;
  /** Storage-relative paths of files that were modified. */
  filesUpdated: string[];
  message: string;
}

interface IWiringCandidate {
  item: ProjectItem;
  file: IFile;
  identifier: string;
}

const DEFAULT_ENTITY_MATERIAL = "entity_alphatest";
const DEFAULT_RENDER_CONTROLLER = "controller.render.default";

export default class ModelDesignWiring {
  /**
   * Resource-pack-relative texture path (no extension) that designModel writes for a model.
   */
  static getTexturePath(usage: ModelDesignUsage, modelId: string): string {
    if (usage === "block") {
      return `textures/blocks/${modelId}`;
    }

    if (usage === "item") {
      return `textures/items/${modelId}`;
    }

    return `textures/entity/${modelId}`;
  }

  /**
   * True when `identifier` is the target described by `query`: a query containing ':' must
   * match the full identifier; otherwise it matches the identifier's name (after the namespace).
   */
  static identifierMatches(identifier: string | undefined, query: string): boolean {
    if (!identifier || !query) {
      return false;
    }

    const id = identifier.toLowerCase();
    const q = query.toLowerCase();

    if (q.indexOf(":") >= 0) {
      return id === q;
    }

    const colon = id.indexOf(":");
    const name = colon >= 0 ? id.substring(colon + 1) : id;

    return name === q || id === q;
  }

  static async wire(options: IModelDesignWiringOptions): Promise<IModelDesignWiringResult> {
    if (options.wireTo === false) {
      return { status: "skipped", filesUpdated: [], message: "Wiring skipped (wireTo: false)." };
    }

    const query = typeof options.wireTo === "string" && options.wireTo.trim().length > 0 ? options.wireTo.trim() : "";

    try {
      if (options.usage === "block") {
        return await this._wireBlock(options, query || options.modelId, query.length > 0);
      }

      if (options.usage === "item") {
        return await this._wireItem(options, query || options.modelId, query.length > 0);
      }

      return await this._wireEntity(options, query || options.modelId, query.length > 0);
    } catch (e) {
      Log.debug(`ModelDesignWiring: failed to wire ${options.usage} ${options.modelId}: ${e}`);

      return {
        status: "failed",
        filesUpdated: [],
        message: `Not wired: wiring failed: ${e}`,
      };
    }
  }

  private static async _wireEntity(
    options: IModelDesignWiringOptions,
    query: string,
    isExplicit: boolean
  ): Promise<IModelDesignWiringResult> {
    const candidates = await this._findCandidates(
      options.project,
      ProjectItemType.entityTypeResource,
      "minecraft:client_entity",
      query
    );

    const selection = this._selectTarget(candidates, "client entity", query, isExplicit);

    if (!selection.targetId) {
      if (selection.result.status === "notFound") {
        const behaviors = await this._findCandidates(
          options.project,
          ProjectItemType.entityTypeBehavior,
          "minecraft:entity",
          query
        );

        if (behaviors.length > 0) {
          selection.result.message =
            `Found behavior entity "${behaviors[0].identifier}" but no client entity (resource pack entity/*.json) ` +
            `for it, so the model was not wired. Create a client entity whose geometry.default is ` +
            `"${options.geometryIdentifier}" and textures.default is "${this.getTexturePath("entity", options.modelId)}".`;
        }
      }

      return selection.result;
    }

    const texturePath = this.getTexturePath("entity", options.modelId);
    const filesUpdated: string[] = [];

    for (const candidate of selection.targets) {
      const def = await EntityTypeResourceDefinition.ensureOnFile(candidate.file);

      if (!def) {
        continue;
      }

      await def.load(true);

      const desc = def.data;

      if (!desc) {
        continue;
      }

      desc.geometry = desc.geometry || {};
      desc.geometry["default"] = options.geometryIdentifier;

      desc.textures = desc.textures || {};
      desc.textures["default"] = texturePath;

      if (!desc.materials || Object.keys(desc.materials).length === 0) {
        desc.materials = { default: DEFAULT_ENTITY_MATERIAL };
      }

      if (!Array.isArray(desc.render_controllers) || desc.render_controllers.length === 0) {
        desc.render_controllers = [DEFAULT_RENDER_CONTROLLER];
      }

      if (def.persist()) {
        await candidate.file.saveContent(false);
      }

      filesUpdated.push(candidate.file.storageRelativePath);
    }

    if (filesUpdated.length === 0) {
      return this._couldNotUpdate("client entity", selection.targetId);
    }

    return {
      status: "wired",
      targetId: selection.targetId,
      filesUpdated,
      message:
        `Wired to entity "${selection.targetId}": geometry.default → ${options.geometryIdentifier}, ` +
        `textures.default → ${texturePath}.`,
    };
  }

  private static async _wireBlock(
    options: IModelDesignWiringOptions,
    query: string,
    isExplicit: boolean
  ): Promise<IModelDesignWiringResult> {
    const candidates = await this._findCandidates(
      options.project,
      ProjectItemType.blockTypeBehavior,
      "minecraft:block",
      query
    );

    const selection = this._selectTarget(candidates, "block", query, isExplicit);

    if (!selection.targetId) {
      return selection.result;
    }

    const texturePath = this.getTexturePath("block", options.modelId);
    const filesUpdated: string[] = [];
    const blocks: { file: IFile; def: BlockTypeDefinition }[] = [];

    for (const candidate of selection.targets) {
      const def = await BlockTypeDefinition.ensureOnFile(candidate.file, undefined, true);

      if (def && def.data) {
        blocks.push({ file: candidate.file, def });
      }
    }

    if (blocks.length === 0) {
      return this._couldNotUpdate("block", selection.targetId);
    }

    const terrain = await this._ensureTerrainTexture(options.rpFolder, selection.targetId, texturePath);

    if (terrain.updated) {
      filesUpdated.push(terrain.file.storageRelativePath);
    }

    for (const { file, def } of blocks) {
      const data: any = def.data;
      data.components = data.components || {};

      const existingInstances = data.components["minecraft:material_instances"];
      const existingStar =
        existingInstances && typeof existingInstances === "object" ? existingInstances["*"] : undefined;
      const renderMethod =
        existingStar && typeof existingStar === "object" && typeof existingStar.render_method === "string"
          ? existingStar.render_method
          : "alpha_test";

      data.components["minecraft:geometry"] = options.geometryIdentifier;
      data.components["minecraft:material_instances"] = {
        "*": {
          texture: terrain.textureKey,
          render_method: renderMethod,
        },
      };

      // minecraft:unit_cube conflicts with custom geometry.
      if (data.components["minecraft:unit_cube"] !== undefined) {
        delete data.components["minecraft:unit_cube"];
      }

      if (def.persist()) {
        await file.saveContent(false);
      }

      filesUpdated.push(file.storageRelativePath);
    }

    return {
      status: "wired",
      targetId: selection.targetId,
      filesUpdated,
      message:
        `Wired to block "${selection.targetId}": minecraft:geometry → ${options.geometryIdentifier}, ` +
        `minecraft:material_instances "*" → "${terrain.textureKey}" (${texturePath} in terrain_texture.json).`,
    };
  }

  private static async _wireItem(
    options: IModelDesignWiringOptions,
    query: string,
    isExplicit: boolean
  ): Promise<IModelDesignWiringResult> {
    const candidates = await this._findCandidates(
      options.project,
      ProjectItemType.attachableResourceJson,
      "minecraft:attachable",
      query
    );

    const selection = this._selectTarget(candidates, "attachable", query, isExplicit);

    if (!selection.targetId) {
      if (selection.result.status === "notFound") {
        const items = await this._findCandidates(
          options.project,
          ProjectItemType.itemTypeBehavior,
          "minecraft:item",
          query
        );
        const itemLabel = items.length > 0 ? `item "${items[0].identifier}"` : `an item matching "${query}"`;

        selection.result = {
          status: "notSupported",
          filesUpdated: [],
          message:
            `Not wired: no attachable (resource pack attachables/*.json) exists for ${itemLabel}, and designModel ` +
            `does not create attachables. The model files were written, but the item still renders as its icon. ` +
            `To show the model when held, add an attachable for the item with geometry.default ` +
            `"${options.geometryIdentifier}" and textures.default "${this.getTexturePath("item", options.modelId)}", ` +
            `then run designModel again to keep it in sync.`,
        };
      }

      return selection.result;
    }

    const texturePath = this.getTexturePath("item", options.modelId);
    const filesUpdated: string[] = [];

    for (const candidate of selection.targets) {
      const def = await AttachableResourceDefinition.ensureOnFile(candidate.file);

      if (!def) {
        continue;
      }

      await def.load(true);

      const desc = def.data;

      if (!desc) {
        continue;
      }

      desc.geometry = desc.geometry || {};
      desc.geometry["default"] = options.geometryIdentifier;

      desc.textures = desc.textures || {};
      desc.textures["default"] = texturePath;

      if (!desc.materials || Object.keys(desc.materials).length === 0) {
        desc.materials = { default: DEFAULT_ENTITY_MATERIAL };
      }

      if (!Array.isArray(desc.render_controllers) || desc.render_controllers.length === 0) {
        desc.render_controllers = [DEFAULT_RENDER_CONTROLLER];
      }

      if (def.persist()) {
        await candidate.file.saveContent(false);
      }

      filesUpdated.push(candidate.file.storageRelativePath);
    }

    if (filesUpdated.length === 0) {
      return this._couldNotUpdate("attachable", selection.targetId);
    }

    return {
      status: "wired",
      targetId: selection.targetId,
      filesUpdated,
      message:
        `Wired to item attachable "${selection.targetId}": geometry.default → ${options.geometryIdentifier}, ` +
        `textures.default → ${texturePath}.`,
    };
  }

  private static _couldNotUpdate(kindLabel: string, targetId: string): IModelDesignWiringResult {
    return {
      status: "failed",
      filesUpdated: [],
      message: `Not wired: found ${kindLabel} "${targetId}" but could not read or update its definition file.`,
    };
  }

  /**
   * Picks the single identifier to wire. All files sharing that identifier are updated.
   */
  private static _selectTarget(
    candidates: IWiringCandidate[],
    kindLabel: string,
    query: string,
    isExplicit: boolean
  ): { targetId?: string; targets: IWiringCandidate[]; result: IModelDesignWiringResult } {
    const identifiers = Array.from(new Set(candidates.map((c) => c.identifier)));

    if (identifiers.length === 0) {
      return {
        targets: [],
        result: {
          status: "notFound",
          filesUpdated: [],
          message: isExplicit
            ? `Not wired: no ${kindLabel} with identifier matching wireTo "${query}" was found in the project.`
            : `Not wired: no ${kindLabel} matching modelId "${query}" was found in the project. ` +
              `Pass wireTo with the target identifier (e.g. "namespace:${query}") to wire it.`,
        },
      };
    }

    if (identifiers.length > 1) {
      return {
        targets: [],
        result: {
          status: "ambiguous",
          filesUpdated: [],
          message:
            `Not wired: "${query}" matches several ${kindLabel} identifiers (${identifiers.join(", ")}). ` +
            `Pass wireTo with the full identifier.`,
        },
      };
    }

    return {
      targetId: identifiers[0],
      targets: candidates,
      result: { status: "wired", targetId: identifiers[0], filesUpdated: [], message: "" },
    };
  }

  private static async _findCandidates(
    project: Project,
    itemType: ProjectItemType,
    rootKey: string,
    query: string
  ): Promise<IWiringCandidate[]> {
    const results: IWiringCandidate[] = [];

    for (const item of project.getItemsByType(itemType)) {
      const file = await item.loadFileContent();

      if (!file) {
        continue;
      }

      const json = StorageUtilities.getJsonObject(file);
      const identifier = json?.[rootKey]?.description?.identifier;

      if (typeof identifier === "string" && this.identifierMatches(identifier, query)) {
        results.push({ item, file, identifier });
      }
    }

    return results;
  }

  /**
   * Ensures the resource pack's terrain_texture.json has an entry pointing at `texturePath`,
   * reusing an existing entry for that path when there is one. Returns the texture key.
   */
  private static async _ensureTerrainTexture(
    rpFolder: IFolder,
    blockId: string,
    texturePath: string
  ): Promise<{ file: IFile; textureKey: string; updated: boolean }> {
    const file = await rpFolder.ensureFileFromRelativePath("/textures/terrain_texture.json");

    let catalog: any = undefined;

    if (await file.exists()) {
      if (!file.isContentLoaded) {
        await file.loadContent();
      }

      catalog = StorageUtilities.getJsonObjectWithComments(file);
    }

    if (!catalog || typeof catalog !== "object") {
      catalog = {
        resource_pack_name: rpFolder.name,
        texture_name: "atlas.terrain",
        padding: 8,
        num_mip_levels: 4,
        texture_data: {},
      };
    }

    if (!catalog.texture_data || typeof catalog.texture_data !== "object") {
      catalog.texture_data = {};
    }

    const textureData = catalog.texture_data;
    const canonicalPath = texturePath.toLowerCase();

    for (const key of Object.keys(textureData)) {
      if (this._getTerrainEntryPath(textureData[key]) === canonicalPath) {
        return { file, textureKey: key, updated: false };
      }
    }

    const baseKey = blockId.replace(/:/g, "_");
    let textureKey = baseKey;
    let suffix = 1;

    while (textureData[textureKey] !== undefined) {
      textureKey = `${baseKey}_model${suffix > 1 ? suffix : ""}`;
      suffix++;
    }

    textureData[textureKey] = { textures: texturePath };

    file.setObjectContentIfSemanticallyDifferent(catalog);
    await file.saveContent(false);

    return { file, textureKey, updated: true };
  }

  private static _getTerrainEntryPath(entry: any): string | undefined {
    if (!entry || typeof entry !== "object") {
      return undefined;
    }

    let textures = entry.textures;

    if (Array.isArray(textures)) {
      textures = textures.length === 1 ? textures[0] : undefined;
    }

    if (textures && typeof textures === "object" && typeof textures.path === "string") {
      textures = textures.path;
    }

    if (typeof textures !== "string") {
      return undefined;
    }

    return textures.toLowerCase().replace(/\.(png|tga|jpg|jpeg)$/, "");
  }
}
