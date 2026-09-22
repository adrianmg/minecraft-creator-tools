import ProjectInfoItem from "../../ProjectInfoItem";
import Project from "../../../app/Project";
import ProjectInfoSet from "../../ProjectInfoSet";
import IProjectInfoGenerator from "../../IProjectInfoGenerator";
import { InfoItemType } from "../../IInfoItemData";
import { ProjectItemType } from "../../../app/IProjectItemData";
import StorageUtilities from "../../../storage/StorageUtilities";
import Utilities from "../../../core/Utilities";
import ProjectItem from "../../../app/ProjectItem";
import ResourceManifestDefinition from "../../../minecraft/ResourceManifestDefinition";
import BehaviorManifestDefinition from "../../../minecraft/BehaviorManifestDefinition";
import {
  defineValidationRule,
  IValidationRuleProvider,
  ValidationRuleDefinition,
} from "../../tests/ValidationRuleDefinition";
import { ProjectInfoSuite } from "../../IProjectInfoData";

export enum CheckWorldPackReferencesGeneratorTest {
  invalidWorldPackReferencesJson = 201,
  missingWorldPackReferencesFile = 202,
  invalidPackId = 203,
  missingManifestVersion = 204,
  invalidManifestVersion = 205,
  packReferenceNotFound = 206,
  internalProcessingError = 207,
}

const wpackRule = (spec: { ruleIndex: number; name: string; title: string }): ValidationRuleDefinition =>
  defineValidationRule({
    generatorId: "WPACKREFS",
    ruleIndex: spec.ruleIndex,
    name: spec.name,
    title: spec.title,
    severities: [InfoItemType.error],
    suites: [ProjectInfoSuite.defaultInDevelopment],
    source: {
      file: "app/src/info/projectGenerators/CheckWorldPackReferences/CheckWorldPackReferencesGenerator.ts",
      symbol: "WorldPackReferencesValidationRules",
    },
  });

/**
 * The WPACKREFS validation-rule inventory. Rules 202 (missing references
 * file) and 204 (missing manifest version) have no emission site and stay
 * out. Rule 207 is reachable: a reference version that parses to a
 * non-array with a length of 3 (e.g. {"length": 3}) throws inside version
 * validation and is reported as an ordinary error.
 */
export const WorldPackReferencesValidationRules: readonly ValidationRuleDefinition[] = [
  wpackRule({
    ruleIndex: CheckWorldPackReferencesGeneratorTest.invalidWorldPackReferencesJson,
    name: "invalidWorldPackReferencesJson",
    title: "Invalid World Pack References JSON",
  }),
  wpackRule({
    ruleIndex: CheckWorldPackReferencesGeneratorTest.invalidPackId,
    name: "invalidPackId",
    title: "Missing or Invalid Pack Id",
  }),
  wpackRule({
    ruleIndex: CheckWorldPackReferencesGeneratorTest.invalidManifestVersion,
    name: "invalidManifestVersion",
    title: "Invalid Pack Reference Version",
  }),
  wpackRule({
    ruleIndex: CheckWorldPackReferencesGeneratorTest.packReferenceNotFound,
    name: "packReferenceNotFound",
    title: "Pack Reference Not Found",
  }),
  wpackRule({
    ruleIndex: CheckWorldPackReferencesGeneratorTest.internalProcessingError,
    name: "packReferenceProcessingError",
    title: "World Pack References Could Not Be Processed",
  }),
];

/**
 * Validates world pack references including world_behavior_packs.json and world_resource_packs.json.
 *
 * @see {@link ../../../public/data/forms/mctoolsval/wpackrefs.form.json} for topic definitions
 */
export default class CheckWorldPackReferencesGenerator implements IProjectInfoGenerator, IValidationRuleProvider {
  id = "WPACKREFS";
  title = "World Pack References";
  canAlwaysProcess = true;

  readonly validationRules: readonly ValidationRuleDefinition[] = WorldPackReferencesValidationRules;

  summarize(info: any, infoSet: ProjectInfoSet) {
    info.invalidWorldPackReferencesJson = infoSet.getSummedDataValue(
      this.id,
      CheckWorldPackReferencesGeneratorTest.invalidWorldPackReferencesJson
    );

    info.missingWorldPackReferencesFile = infoSet.getSummedDataValue(
      this.id,
      CheckWorldPackReferencesGeneratorTest.missingWorldPackReferencesFile
    );

    info.invalidPackIds = infoSet.getSummedDataValue(this.id, CheckWorldPackReferencesGeneratorTest.invalidPackId);

    info.missingManifestVersion = infoSet.getSummedDataValue(
      this.id,
      CheckWorldPackReferencesGeneratorTest.missingManifestVersion
    );

    info.invalidManifestVersion = infoSet.getSummedDataValue(
      this.id,
      CheckWorldPackReferencesGeneratorTest.invalidManifestVersion
    );

    info.packReferencesNotFound = infoSet.getSummedDataValue(
      this.id,
      CheckWorldPackReferencesGeneratorTest.packReferenceNotFound
    );

    info.internalProcessingErrors = infoSet.getSummedDataValue(
      this.id,
      CheckWorldPackReferencesGeneratorTest.internalProcessingError
    );
  }

  async generate(project: Project): Promise<ProjectInfoItem[]> {
    const items: ProjectInfoItem[] = [];
    const projItems = project.getItemsCopy();
    const availablePacks: { uuid: string; manifestItem: ProjectItem }[] = [];

    try {
      // First, collect all available pack UUIDs from manifests
      await this.collectAvailablePacks(projItems, availablePacks, items);

      // Check for pack reference files
      for (const item of projItems) {
        if (item.itemType === ProjectItemType.resourcePackListJson) {
          await this.checkPackReferences(item, availablePacks, items);
        } else if (item.itemType === ProjectItemType.behaviorPackListJson) {
          await this.checkPackReferences(item, availablePacks, items);
        }
      }
    } catch (error) {
      items.push(
        new ProjectInfoItem(
          InfoItemType.error,
          this.id,
          CheckWorldPackReferencesGeneratorTest.internalProcessingError,
          `Internal processing error: ${error}`,
          undefined
        )
      );
    }

    return items;
  }

  private async collectAvailablePacks(
    projItems: ProjectItem[],
    availablePacks: { uuid: string; manifestItem: ProjectItem }[],
    items: ProjectInfoItem[]
  ): Promise<void> {
    for (const item of projItems) {
      if (
        item.itemType !== ProjectItemType.resourcePackManifestJson &&
        item.itemType !== ProjectItemType.behaviorPackManifestJson
      ) {
        continue;
      }

      if (!item.isContentLoaded) {
        await item.loadContent();
      }

      if (!item.primaryFile) {
        continue;
      }

      if (!item.primaryFile.isContentLoaded) {
        await item.primaryFile.loadContent();
      }

      try {
        if (item.itemType === ProjectItemType.resourcePackManifestJson) {
          const resourceManifest = await ResourceManifestDefinition.ensureOnFile(item.primaryFile);
          if (resourceManifest && resourceManifest.id && Utilities.isValidUuid(resourceManifest.id)) {
            availablePacks.push({
              uuid: resourceManifest.id,
              manifestItem: item,
            });
          }
        } else if (item.itemType === ProjectItemType.behaviorPackManifestJson) {
          const behaviorManifest = await BehaviorManifestDefinition.ensureOnFile(item.primaryFile);
          if (behaviorManifest && behaviorManifest.id && Utilities.isValidUuid(behaviorManifest.id)) {
            availablePacks.push({
              uuid: behaviorManifest.id,
              manifestItem: item,
            });
          }
        }
      } catch (error) {
        items.push(
          new ProjectInfoItem(
            InfoItemType.error,
            this.id,
            CheckWorldPackReferencesGeneratorTest.internalProcessingError,
            `Error processing manifest ${item.name}: ${error}`,
            item
          )
        );
      }
    }
  }

  private async checkPackReferences(
    packReferencesFile: ProjectItem,
    availablePacks: { uuid: string; manifestItem: ProjectItem }[],
    items: ProjectInfoItem[]
  ): Promise<void> {
    if (!packReferencesFile.isContentLoaded) {
      await packReferencesFile.loadContent();
    }

    if (!packReferencesFile.primaryFile) {
      return;
    }

    if (!packReferencesFile.primaryFile.isContentLoaded) {
      await packReferencesFile.primaryFile.loadContent();
    }

    const parsedContent = StorageUtilities.getJsonObject(packReferencesFile.primaryFile);

    if (!parsedContent || !Array.isArray(parsedContent)) {
      items.push(
        new ProjectInfoItem(
          InfoItemType.error,
          this.id,
          CheckWorldPackReferencesGeneratorTest.invalidWorldPackReferencesJson,
          `Invalid JSON format in ${packReferencesFile.name}. Expected an array of pack references.`,
          packReferencesFile
        )
      );
      return;
    }

    const packRefsFoundInJson: string[] = [];

    // Validate each pack reference object
    for (let i = 0; i < parsedContent.length; i++) {
      const packRef = parsedContent[i];

      if (typeof packRef !== "object" || packRef === null) {
        items.push(
          new ProjectInfoItem(
            InfoItemType.error,
            this.id,
            CheckWorldPackReferencesGeneratorTest.invalidWorldPackReferencesJson,
            `Invalid pack reference object at index ${i} in ${packReferencesFile.name}`,
            packReferencesFile
          )
        );
        continue;
      }

      // Validate pack_id
      if (!packRef.pack_id || typeof packRef.pack_id !== "string") {
        items.push(
          new ProjectInfoItem(
            InfoItemType.error,
            this.id,
            CheckWorldPackReferencesGeneratorTest.invalidPackId,
            `Missing or invalid pack_id at index ${i} in ${packReferencesFile.name}`,
            packReferencesFile
          )
        );
        continue;
      }

      if (!Utilities.isValidUuid(packRef.pack_id)) {
        items.push(
          new ProjectInfoItem(
            InfoItemType.error,
            this.id,
            CheckWorldPackReferencesGeneratorTest.invalidPackId,
            `Invalid UUID format for pack_id [${packRef.pack_id}] at index ${i} in ${packReferencesFile.name}`,
            packReferencesFile
          )
        );
        continue;
      }

      // Valid pack_id found, add to list
      packRefsFoundInJson.push(packRef.pack_id);

      // Validate version
      const versionValidation = ResourceManifestDefinition.validatePackReferenceVersion(packRef.version);
      if (!versionValidation.isValid) {
        items.push(
          new ProjectInfoItem(
            InfoItemType.error,
            this.id,
            CheckWorldPackReferencesGeneratorTest.invalidManifestVersion,
            `${versionValidation.errorMessage} for pack_id [${packRef.pack_id}] at index ${i} in ${packReferencesFile.name}`,
            packReferencesFile
          )
        );
        continue;
      }
    }

    // Check if each referenced pack exists in the available packs
    for (const packRef of packRefsFoundInJson) {
      const foundPack = availablePacks.find((pack) => pack.uuid === packRef);

      if (!foundPack) {
        items.push(
          new ProjectInfoItem(
            InfoItemType.error,
            this.id,
            CheckWorldPackReferencesGeneratorTest.packReferenceNotFound,
            `Pack reference [${packRef}] not found in project.`,
            packReferencesFile
          )
        );
      }
    }
  }
}
