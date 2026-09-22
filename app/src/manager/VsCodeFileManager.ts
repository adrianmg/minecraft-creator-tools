// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import ProjectInfoItem from "../info/ProjectInfoItem";
import Project from "../app/Project";
import IProjectInfoGenerator from "../info/IProjectInfoGenerator";
import { ProjectItemStorageType, ProjectItemType } from "../app/IProjectItemData";
import { InfoItemType } from "../info/IInfoItemData";
import IProjectUpdater from "../updates/IProjectUpdater";
import ProjectUpdateResult from "../updates/ProjectUpdateResult";
import VsCodeTasksDefinition from "../devproject/VsCodeTasksDefinition";
import { UpdateResultType } from "../updates/IUpdateResult";
import VsCodeLaunchDefinition from "../devproject/VsCodeLaunchDefinition";
import ProjectInfoSet from "../info/ProjectInfoSet";
import ContentIndex from "../core/ContentIndex";
import IDebugSettings from "../devproject/IDebugSettings";
import { ValidationRuleDefinition } from "../info/tests/ValidationRuleDefinition";

/**
 * Validates and updates VS Code configuration files (tasks.json, launch.json).
 *
 * @see {@link ../../../public/data/forms/mctoolsval/vscodefile.form.json} for topic definitions
 */
export default class VsCodeFileManager implements IProjectInfoGenerator, IProjectUpdater {
  id = "VSCODEFILE";
  title = "VSCode Files";

  /**
   * VSCODEFILE emits only informational items (100: tasks.json without
   * Minecraft deploy tasks; 101: launch.json without a Minecraft server debug
   * configuration) that point at the corresponding updaters — never an error,
   * warning, or recommendation — so its validation rule inventory is empty.
   * The informational conditions are E2E-covered by
   * src/test/VsCodeFileValidationTest.ts.
   */
  readonly validationRules: readonly ValidationRuleDefinition[] = [];

  getUpdaterData(updateId: number) {
    return {
      title: updateId.toString(),
    };
  }

  summarize(info: any, infoSet: ProjectInfoSet) {}

  async generate(project: Project, contentIndex: ContentIndex): Promise<ProjectInfoItem[]> {
    const infoItems: ProjectInfoItem[] = [];

    const itemsCopy = project.getItemsCopy();

    for (const pi of itemsCopy) {
      if (pi.itemType === ProjectItemType.vsCodeTasksJson && pi.storageType === ProjectItemStorageType.singleFile) {
        if (!pi.isContentLoaded) {
          await pi.loadContent();
        }

        if (pi.primaryFile) {
          const vscodeTasksJson = await VsCodeTasksDefinition.ensureOnFile(pi.primaryFile);

          if (vscodeTasksJson) {
            const hasMinecraftTasks = await vscodeTasksJson.hasMinContent();

            if (!hasMinecraftTasks) {
              infoItems.push(
                new ProjectInfoItem(
                  InfoItemType.info,
                  this.id,
                  100,
                  "Project has a VSCode tasks file, but no minecraft deploy tasks.",
                  pi,
                  undefined,
                  pi.primaryFile.storageRelativePath
                )
              );
            }
          }
        }
      } else if (
        pi.itemType === ProjectItemType.vsCodeLaunchJson &&
        pi.storageType === ProjectItemStorageType.singleFile
      ) {
        if (!pi.isContentLoaded) {
          await pi.loadContent();
        }

        if (pi.primaryFile) {
          const vscodeLaunchJson = await VsCodeLaunchDefinition.ensureOnFile(pi.primaryFile);

          if (vscodeLaunchJson) {
            vscodeLaunchJson.project = project;
            const hasMinecraftDebugConfig = await vscodeLaunchJson.hasMinContent({ isServer: true });

            if (!hasMinecraftDebugConfig) {
              infoItems.push(
                new ProjectInfoItem(
                  InfoItemType.info,
                  this.id,
                  101,
                  "Project has a VSCode launch file, but is not configured for Minecraft server launch.",
                  pi,
                  undefined,
                  pi.primaryFile.storageRelativePath
                )
              );
            }
          }
        }
      }
    }

    return infoItems;
  }

  async update(project: Project, updateId: number): Promise<ProjectUpdateResult[]> {
    const results: ProjectUpdateResult[] = [];

    switch (updateId) {
      case 1:
        results.push(...(await this.ensureMinecraftLaunchTasks(project)));
        break;
      case 2:
        results.push(...(await this.ensureMinecraftDebugConfig(project)));
        break;
    }

    return results;
  }

  getUpdateIds() {
    return [1, 2];
  }

  async ensureMinecraftLaunchTasks(project: Project) {
    const results: ProjectUpdateResult[] = [];

    const itemsCopy = project.getItemsCopy();

    for (const pi of itemsCopy) {
      if (pi.itemType === ProjectItemType.vsCodeTasksJson && pi.storageType === ProjectItemStorageType.singleFile) {
        if (!pi.isContentLoaded) {
          await pi.loadContent();
        }

        if (pi.primaryFile) {
          const vscodeTasksJson = await VsCodeTasksDefinition.ensureOnFile(pi.primaryFile);

          if (vscodeTasksJson) {
            const hasTasks = await vscodeTasksJson.hasMinContent();

            if (!hasTasks) {
              const result = await vscodeTasksJson.ensureMinContent();

              if (result) {
                await vscodeTasksJson.save();
                results.push(
                  new ProjectUpdateResult(UpdateResultType.updatedFile, this.id, 1, "Updated Minecraft Tasks", pi)
                );
              }
            }
          }
        }
      }
    }

    return results;
  }

  /**
   * Ensure the project's launch.json carries a complete minecraft-js server
   * debug configuration. `slot` is the managed-session slot the content runs
   * in - it drives the derived debug port (19144 + slot * 32), so the
   * generated configuration attaches to the server that actually hosts the
   * content. Session-aware boundaries (e.g., VscDedicatedServerManager's
   * deploy flow) pass their real slot; the generic project updater defaults
   * to slot 0, which is the slot every embedded surface manages.
   *
   * `host` follows the tri-state contract on IDebugSettings.host: leave it
   * undefined to express no host intent (the generic updater path - an
   * existing remote endpoint is preserved), or pass an explicit host when
   * the boundary knows where the debuggee runs - the local-BDS deployment
   * boundary passes "localhost" so a managed profile left pointing at a
   * remote machine is re-targeted to the server actually being started.
   *
   * `port` is the lifecycle-CONFIRMED debug port, when the boundary knows
   * it (DebugPortRegistry can reserve a later candidate than the
   * slot-derived preferred port on collision). An explicit port takes
   * precedence over the slot derivation, so post-confirmation boundaries
   * regenerate the profile against the endpoint the debugger actually
   * listens on - without it, F5 would target the stale preferred port
   * instead of the actual listener; leave it undefined where only the slot
   * is known.
   */
  async ensureMinecraftDebugConfig(project: Project, slot: number = 0, host?: string, port?: number) {
    const results: ProjectUpdateResult[] = [];

    const itemsCopy = project.getItemsCopy();

    for (const pi of itemsCopy) {
      if (pi.itemType === ProjectItemType.vsCodeLaunchJson && pi.storageType === ProjectItemStorageType.singleFile) {
        if (!pi.isContentLoaded) {
          await pi.loadContent();
        }

        if (pi.primaryFile) {
          const vscodeLaunchJson = await VsCodeLaunchDefinition.ensureOnFile(pi.primaryFile);

          if (vscodeLaunchJson) {
            vscodeLaunchJson.project = project;
          }

          const pack = await project.getDefaultBehaviorPack();

          const debugSettings: IDebugSettings = { isServer: true, slot: slot, host: host, port: port };

          if (pack && pack.folder) {
            debugSettings.behaviorPackFolderName = pack.folder.name;
          }

          if (vscodeLaunchJson) {
            const hasConfig = await vscodeLaunchJson.hasMinContent(debugSettings);

            if (!hasConfig) {
              const result = await vscodeLaunchJson.ensureMinContent(debugSettings);

              if (result) {
                await vscodeLaunchJson.save();
                results.push(
                  new ProjectUpdateResult(UpdateResultType.updatedFile, this.id, 2, "Updated Minecraft Launch JSON", pi)
                );
              }
            }
          }
        }
      }
    }

    return results;
  }
}
