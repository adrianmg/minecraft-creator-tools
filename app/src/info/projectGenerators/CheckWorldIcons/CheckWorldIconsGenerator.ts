import { ProjectItemType } from "../../../app/IProjectItemData";
import Project from "../../../app/Project";
import IFile from "../../../storage/IFile";
import IFolder from "../../../storage/IFolder";
import { isWorldIcon, parseImageMetadata } from "../../../storage/ImageUtilites";
import { InfoItemType } from "../../IInfoItemData";
import IProjectInfoGenerator from "../../IProjectInfoGenerator";
import ProjectInfoItem from "../../ProjectInfoItem";
import Log from "../../../core/Log";
import { CheckWorldIconsGeneratorTest, WorldIconValidationRules } from "./CheckWorldIconsGeneratorData";
import { IValidationRuleProvider, ValidationRuleDefinition } from "../../tests/ValidationRuleDefinition";

const DefaultEduImageWidth = 480;
const DefaultEduImageHeight = 270;
const DefaultBedrockImageWidth = 800;
const DefaultBedrockImageHeight = 450;

/*
 * Generator for validating World Icons
 *
 * Will ensure:
 *  * exactly 1 icon per world folder (folders with a world manifest)
 *  * icon is a valid .jpeg
 *  * icon is the correct size
 *
 * @see {@link ../../../public/data/forms/mctoolsval/cwi.form.json} for topic definitions
 */
export default class CheckWorldIconsGenerator implements IProjectInfoGenerator, IValidationRuleProvider {
  id: string = "CWI";
  title: string = "World Icons";
  canAlwaysProcess = true;

  readonly validationRules: readonly ValidationRuleDefinition[] = WorldIconValidationRules;

  private severity = InfoItemType.error;

  async generate(project: Project): Promise<ProjectInfoItem[]> {
    const itemsCopy = project.getItemsCopy();

    const isEDUOffer = itemsCopy.find((item) => item.itemType === ProjectItemType.educationJson) !== undefined;

    const worldFolders = [];

    for (const projectItem of itemsCopy) {
      if (projectItem.itemType === ProjectItemType.worldTemplateManifestJson) {
        if (!projectItem.isContentLoaded) {
          await projectItem.loadContent();
        }

        // World template manifests are single-file items, so getFolder() (which
        // only tracks folder-storage items) is null for them; resolve the world
        // folder from the manifest file's parent instead.
        const folder = projectItem.getFolder() ?? projectItem.primaryFile?.parentFolder;

        if (folder) {
          worldFolders.push(folder);
        }
      }
    }

    const results = [];
    for (const folder of worldFolders) {
      Log.assert(folder !== null, "Manifest file cannot exist without a folder");
      const resultForFolder = await this.validateWorldIconForFolder(folder, isEDUOffer);
      results.push(...resultForFolder);
    }

    return results;
  }

  private async validateWorldIconForFolder(folder: IFolder, isEDUOffer: boolean) {
    // Minecraft only loads the thumbnail from /world_icon.jpeg at the world
    // root, so icons nested inside embedded packs (e.g.
    // resource_packs/*/world_icon.jpeg) neither satisfy nor conflict with this
    // requirement; only consider the world root's direct files.
    await folder.load();

    const files: IFile[] = [];
    for (const fileName in folder.files) {
      const file = folder.files[fileName];

      if (file && isWorldIcon(file)) {
        files.push(file);
      }
    }

    if (files.length === 0) {
      const message = `No World Icon found for ${folder.getFolderRelativePath}.`;
      return [this.createResult(CheckWorldIconsGeneratorTest.NoIconFound, message)];
    } else if (files.length > 1) {
      const message = `Too many World Icons found for ${folder.getFolderRelativePath}. ${files.length} icons found, expected: 1`;
      return [this.createResult(CheckWorldIconsGeneratorTest.MultipleIconsFound, message)];
    }

    const file = files[0];
    const image = await parseImageMetadata(file);

    if (!image) {
      const message = `Image (${file.name}) is not valid.`;
      return [this.createResult(CheckWorldIconsGeneratorTest.IconNotValidImage, message)];
    }

    const isSizeCorrect = isEDUOffer ? isSizeCorrectForEDU : isSizeCorrectForBedrock;

    if (!isSizeCorrect({ width: image.ImageWidth, height: image.ImageHeight })) {
      return [this.createResult(CheckWorldIconsGeneratorTest.IconNotValidSize, `Image (${file.name}) is not valid.`)];
    }

    return [];
  }

  private createResult(test: CheckWorldIconsGeneratorTest, message: string) {
    return new ProjectInfoItem(this.severity, this.id, test, message);
  }

  summarize(): void {}
}

function isSizeCorrectForBedrock(size: { width: number; height: number }) {
  return size.width === DefaultBedrockImageWidth && size.height === DefaultBedrockImageHeight;
}

function isSizeCorrectForEDU(size: { width: number; height: number }) {
  const isEDUSize = size.width === DefaultEduImageWidth && size.height === DefaultEduImageHeight;
  return isEDUSize || isSizeCorrectForBedrock(size);
}
