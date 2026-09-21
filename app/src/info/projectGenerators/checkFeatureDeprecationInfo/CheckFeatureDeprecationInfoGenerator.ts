// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import ProjectInfoItem from "../../ProjectInfoItem";
import IProjectInfoGenerator from "../../IProjectInfoGenerator";
import { InfoItemType } from "../../IInfoItemData";
import ProjectInfoSet from "../../ProjectInfoSet";
import Project from "../../../app/Project";
import StorageUtilities from "../../../storage/StorageUtilities";
import {
  CheckFeatureDeprecationInfoGeneratorTest,
  CheckFeatureDeprecationValidationRules,
  DEPRECATED_BLOCKS,
  DEPRECATED_TEXTURES,
  DEPRECATED_TEXTURE_ENTRIES,
} from "./CheckFeatureDeprecationInfoData";
import { IValidationRuleProvider, ValidationRuleDefinition } from "../../tests/ValidationRuleDefinition";

/***********
 * Generator for Checking Feature Deprecation
 *
 * Will check:
 *  * blocks.json for deprecated block overrides (fletching_table, smithing_table)
 *  * terrain_texture.json for deprecated texture entries
 *  * textures/blocks/ folder for deprecated textures
 *
 * @see {@link ../../../../public/data/forms/mctoolsval/checkfeaturedeprecation.form.json} for topic definitions
 */

/**
 * True when a pack-relative texture path sits directly in the canonical
 * textures/blocks folder of the pack root or of a subpack root — the only
 * locations Minecraft reads vanilla block-texture overrides from.
 */
function isCanonicalBlocksTexturePath(packRelativePath: string) {
  const normalized = packRelativePath.replace(/\\/g, "/").toLowerCase();
  const folderPath = normalized.substring(0, normalized.lastIndexOf("/") + 1);

  return folderPath === "/textures/blocks/" || /^\/subpacks\/[^/]+\/textures\/blocks\/$/.test(folderPath);
}

export default class CheckFeatureDeprecationInfoGenerator implements IProjectInfoGenerator, IValidationRuleProvider {
  id = "CHECKFEATUREDEPRECATION";
  title = "Feature Deprecation";

  readonly validationRules: readonly ValidationRuleDefinition[] = CheckFeatureDeprecationValidationRules;

  summarize(info: any, infoSet: ProjectInfoSet) {
    info.deprecatedBlockOverride = infoSet.getSummedDataValue(
      this.id,
      CheckFeatureDeprecationInfoGeneratorTest.deprecatedBlockOverride
    );

    info.deprecatedTerrainTexture = infoSet.getSummedDataValue(
      this.id,
      CheckFeatureDeprecationInfoGeneratorTest.deprecatedTerrainTexture
    );

    info.deprecatedTexture = infoSet.getSummedDataValue(
      this.id,
      CheckFeatureDeprecationInfoGeneratorTest.deprecatedTexture
    );
  }

  async generate(project: Project): Promise<ProjectInfoItem[]> {
    const items: ProjectInfoItem[] = [];
    const projItems = project.getItemsCopy();

    for (const item of projItems) {
      if (item.name === "blocks.json") {
        if (!item.isContentLoaded) {
          await item.loadContent();
        }

        if (!item.primaryFile) {
          continue;
        }

        if (!item.primaryFile.isContentLoaded) {
          await item.primaryFile.loadContent();
        }

        const content = item.primaryFile.content;
        if (!content || typeof content !== "string") {
          continue;
        }

        try {
          const parsedContent = StorageUtilities.getJsonObject(item.primaryFile);
          if (parsedContent) {
            for (const deprecatedBlock of DEPRECATED_BLOCKS) {
              if (parsedContent[deprecatedBlock]) {
                items.push(
                  new ProjectInfoItem(
                    InfoItemType.warning,
                    this.id,
                    CheckFeatureDeprecationInfoGeneratorTest.deprecatedBlockOverride,
                    `Entity [${deprecatedBlock}] will be affected in an upcoming client update.`,
                    item,
                    deprecatedBlock
                  )
                );
              }
            }
          }
        } catch (error) {
          items.push(
            new ProjectInfoItem(
              InfoItemType.warning,
              this.id,
              CheckFeatureDeprecationInfoGeneratorTest.jsonParseError,
              `Failed to parse JSON for entity. Error: ${error}`,
              item
            )
          );
        }
      }

      if (item.name === "terrain_texture.json") {
        if (!item.isContentLoaded) {
          await item.loadContent();
        }

        if (!item.primaryFile) {
          continue;
        }

        if (!item.primaryFile.isContentLoaded) {
          await item.primaryFile.loadContent();
        }

        const content = item.primaryFile.content;
        if (!content || typeof content !== "string") {
          continue;
        }

        const parsedContent = StorageUtilities.getJsonObject(item.primaryFile);
        try {
          if (parsedContent) {
            for (const deprecatedTexture of DEPRECATED_TEXTURE_ENTRIES) {
              if (parsedContent.texture_data[deprecatedTexture]) {
                items.push(
                  new ProjectInfoItem(
                    InfoItemType.warning,
                    this.id,
                    CheckFeatureDeprecationInfoGeneratorTest.deprecatedTerrainTexture,
                    `Entity [${deprecatedTexture}] will be affected in an upcoming client update.`,
                    item,
                    deprecatedTexture
                  )
                );
              }
            }
          }
        } catch (error) {
          items.push(
            new ProjectInfoItem(
              InfoItemType.warning,
              this.id,
              CheckFeatureDeprecationInfoGeneratorTest.jsonParseError,
              `Failed to parse JSON for entity. Error: ${error}`,
              item
            )
          );
        }
      }

      if (DEPRECATED_TEXTURES.includes(item.name)) {
        if (!item.isContentLoaded) {
          await item.loadContent();
        }

        // Only textures at the canonical pack- or subpack-relative
        // textures/blocks location override vanilla block textures; a custom
        // texture whose parent folder merely happens to be named "blocks"
        // (e.g. textures/harness/blocks/) does not.
        const packRelativePath = await item.getPackRelativePath();

        if (packRelativePath && isCanonicalBlocksTexturePath(packRelativePath)) {
          items.push(
            new ProjectInfoItem(
              InfoItemType.warning,
              this.id,
              CheckFeatureDeprecationInfoGeneratorTest.deprecatedTexture,
              `Texture [${item.name}] will be affected in an upcoming client update. Please resubmit with no modifications to this texture.`,
              item,
              item.name
            )
          );
        }
      }
    }

    return items;
  }
}
