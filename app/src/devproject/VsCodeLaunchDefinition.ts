// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import IFile from "../storage/IFile";
import { EventDispatcher, IEventHandler } from "ste-events";
import IDebugSettings from "./IDebugSettings";
import IVsCodeLaunch, { IVsCodeConfiguration } from "./IVsCodeLaunch";
import StorageUtilities from "../storage/StorageUtilities";
import Project from "../app/Project";
import BehaviorManifestDefinition from "../minecraft/BehaviorManifestDefinition";
import MinecraftUtilities from "../minecraft/MinecraftUtilities";
import Log from "../core/Log";

/**
 * Stable identity of the MCT-managed launch configuration. Updates at the
 * deployment boundary (and the project updater) create or reconcile ONLY the
 * configuration carrying this name - user-authored minecraft-js profiles
 * (e.g. a listen-mode profile for the local game alongside a connect profile
 * for a remote BDS) are never rewritten. A legacy nameless minecraft-js
 * entry counts as managed (earlier MCT versions generated it) and receives
 * this name on its next update.
 */
export const MinecraftManagedLaunchConfigName = "Debug with Minecraft";

export default class VsCodeLaunchDefinition {
  /**
   * Resolves the debug port for a set of debug settings: an explicit port wins, otherwise the
   * port is derived from the server slot (19144, 19176, ...). Returns undefined when neither is
   * specified so callers can apply their own default.
   */
  static getDebugPort(debugSettings?: IDebugSettings): number | undefined {
    if (debugSettings === undefined) {
      return undefined;
    }

    if (debugSettings.port !== undefined) {
      return debugSettings.port;
    }

    if (debugSettings.slot !== undefined) {
      return MinecraftUtilities.getDebugPortForSlot(debugSettings.slot);
    }

    return undefined;
  }

  /**
   * Normalized host semantics for comparison: on the CONFIGURATION side an
   * absent host field means localhost, and comparison is case-insensitive.
   * NOTE: on the SETTINGS side, an undefined IDebugSettings.host means "no
   * host intent" (preserve the existing value) - callers must check for
   * undefined BEFORE normalizing; this helper is for defined values and the
   * config-side field.
   */
  static normalizeDebugHost(host: string | undefined): string {
    return (host === undefined ? "localhost" : host).toLowerCase();
  }

  private _file?: IFile;
  private _id?: string;
  private _isLoaded: boolean = false;

  public definition?: IVsCodeLaunch;

  private _onLoaded = new EventDispatcher<VsCodeLaunchDefinition, VsCodeLaunchDefinition>();

  public project: Project | undefined = undefined;

  public get isLoaded() {
    return this._isLoaded;
  }

  public get file() {
    return this._file;
  }

  public set file(newFile: IFile | undefined) {
    this._file = newFile;
  }

  public get onLoaded() {
    return this._onLoaded.asEvent();
  }

  public get id() {
    return this._id;
  }

  public set id(newId: string | undefined) {
    this._id = newId;
  }

  static async ensureOnFile(file: IFile, loadHandler?: IEventHandler<VsCodeLaunchDefinition, VsCodeLaunchDefinition>) {
    let dt: VsCodeLaunchDefinition | undefined;

    if (file.manager === undefined) {
      dt = new VsCodeLaunchDefinition();

      dt.file = file;

      file.manager = dt;
    }

    if (file.manager !== undefined && file.manager instanceof VsCodeLaunchDefinition) {
      dt = file.manager as VsCodeLaunchDefinition;

      if (!dt.isLoaded && loadHandler) {
        dt.onLoaded.subscribe(loadHandler);
      }

      await dt.load();

      return dt;
    }

    return dt;
  }

  /**
   * The script-module UUID of the attached project's default behavior pack,
   * or undefined when no project, pack, or script module is available.
   */
  private async getExpectedScriptModuleUuid(): Promise<string | undefined> {
    if (!this.project) {
      return undefined;
    }

    const pack = await this.project.getDefaultBehaviorPack();

    if (pack && pack.manifest instanceof BehaviorManifestDefinition) {
      return pack.manifest.getScriptModule()?.uuid;
    }

    return undefined;
  }

  /**
   * The MCT-managed configuration, identified by its stable generated name
   * (see MinecraftManagedLaunchConfigName). A nameless legacy minecraft-js
   * entry counts as managed. User-authored minecraft-js profiles with their
   * own names are never selected.
   */
  private getManagedConfig(): IVsCodeConfiguration | undefined {
    return this.definition?.configurations?.find(
      (config) =>
        config.type === "minecraft-js" &&
        (config.name === undefined || config.name === MinecraftManagedLaunchConfigName)
    );
  }

  /**
   * Retargets the managed configuration after the project's default script
   * module gets a new UUID (ProjectUtilities.randomizeAllUids). The
   * fill-only policy cannot distinguish "filled from the default script
   * module" from "explicitly authored" - but a target equal to the module's
   * PREVIOUS uuid is exactly the filled case (that value is what
   * getExpectedScriptModuleUuid supplied), while any other value points at
   * a different module on purpose and is preserved. The legacy
   * targetedModuleUuid key gets the same treatment so its later migration
   * to targetModuleUuid cannot resurrect the stale uuid. Returns whether
   * the configuration changed.
   */
  async applyScriptModuleUuidChange(previousUuid: string | undefined, newUuid: string | undefined): Promise<boolean> {
    if (previousUuid === undefined || newUuid === undefined || previousUuid === newUuid) {
      return false;
    }

    await this.load();

    const config = this.getManagedConfig();

    if (config === undefined) {
      return false;
    }

    // UUIDs compare case-insensitively: manifests may carry uppercase ids.
    const matchesPrevious = (value: string | undefined) =>
      value !== undefined && value.toLowerCase() === previousUuid.toLowerCase();

    let changed = false;

    if (matchesPrevious(config.targetModuleUuid)) {
      config.targetModuleUuid = newUuid;
      changed = true;
    }

    if (matchesPrevious(config.targetedModuleUuid)) {
      // Mirror the migration policy: an existing targetModuleUuid wins over
      // the legacy key, so only fill it from the rename when it is absent.
      if (!config.targetModuleUuid) {
        config.targetModuleUuid = newUuid;
      }

      delete config.targetedModuleUuid;
      changed = true;
    }

    return changed;
  }

  async hasMinContent(debugSettings?: IDebugSettings) {
    if (!debugSettings) {
      // No settings at all = a generic pass (project autogeneration/save,
      // project setup) with no mode/port/host intent: it checks structural
      // completeness only and matches whatever mode the managed
      // configuration already has.
      debugSettings = {};
    }

    await this.load();

    if (!this.definition || !this.definition.configurations) {
      return false;
    }

    // Only the MCT-managed configuration is evaluated: user-authored
    // minecraft-js profiles (a listen-mode game profile, a remote connect
    // profile) are not MCT's to judge, and must never make this file look
    // complete or incomplete on their behalf.
    const config = this.getManagedConfig();

    if (config === undefined) {
      return false;
    }

    // The official extension contributes minecraft-js under
    // configurationAttributes.attach: "request": "attach" is required for
    // VS Code to recognize the profile, and without it F5 cannot start the
    // debugger. Generated files that predate this field are incomplete and
    // must be migrated by the next update pass.
    if (config.request !== "attach") {
      return false;
    }

    // Mode reconciliation is tri-state (see IDebugSettings.isServer): an
    // unspecified isServer expresses no mode intent and matches either
    // mode. Without the exemption, project autogeneration's argless save
    // pass (which used to default to listen intent) flipped the managed
    // connect-mode server profile back to "listen" right after the
    // deployment boundary reconciled it - leaving F5 waiting for Minecraft
    // to connect instead of attaching to the running managed BDS.
    if (debugSettings.isServer !== undefined) {
      if (debugSettings.isServer && config.mode === "listen") {
        return false;
      }

      if (!debugSettings.isServer && config.mode !== "listen") {
        return false;
      }
    }

    const expectedPort = VsCodeLaunchDefinition.getDebugPort(debugSettings);

    if (expectedPort !== undefined && config.port !== expectedPort) {
      return false;
    }

    // Host reconciliation is tri-state (see IDebugSettings.host): an
    // unspecified settings host expresses no intent and matches any
    // existing value, while an explicit host must match (explicit
    // "localhost" = absent field). Without the explicit-host comparison,
    // a host-only change never reaches an otherwise-matching config and
    // a later local attach would target the previous machine; without
    // the no-intent exemption, an updater that carries no host setting
    // would erase a valid remote endpoint.
    if (
      debugSettings.host !== undefined &&
      VsCodeLaunchDefinition.normalizeDebugHost(config.host) !==
        VsCodeLaunchDefinition.normalizeDebugHost(debugSettings.host)
    ) {
      return false;
    }

    // A configuration still carrying the legacy misspelled key
    // (targetedModuleUuid) is incomplete regardless of anything else: the
    // official extension only reads targetModuleUuid, so the legacy key is
    // dead weight that must be migrated on the next update pass.
    if (config.targetedModuleUuid !== undefined) {
      return false;
    }

    // A configuration generated before module-UUID injection existed has
    // no targetModuleUuid; when the attached project can supply one,
    // that configuration is incomplete - without it, the debugger can
    // attach to the wrong pack when several scripted packs are active.
    // A configuration that HAS a UUID counts as complete even if it
    // differs from the project default: enrichment only fills missing
    // values and never overwrites an explicitly authored one.
    if (!config.targetModuleUuid && (await this.getExpectedScriptModuleUuid()) !== undefined) {
      return false;
    }

    return true;
  }

  async ensureMinContent(debugSettings?: IDebugSettings) {
    if (!debugSettings) {
      // No settings at all = no mode/port/host intent (see hasMinContent):
      // an existing managed configuration keeps its current mode; only a
      // newly created configuration falls back to the listen default below.
      debugSettings = {};
    }

    const hasDebug = await this.hasMinContent(debugSettings);

    if (hasDebug) {
      return true;
    }

    if (!this.definition) {
      this.definition = {};
    }

    if (!this.definition.version || this.definition.version === "0.2.0") {
      this.definition.version = "0.3.0";
    }

    if (!this.definition.configurations) {
      this.definition.configurations = [];
    }

    // Update or create ONLY the MCT-managed configuration (stable identity:
    // MinecraftManagedLaunchConfigName). A project can legitimately keep
    // other minecraft-js profiles - e.g. a listen-mode profile for the local
    // game next to a connect profile for a remote BDS - and an automatic
    // update pass at the deployment boundary must preserve those
    // byte-for-byte, never rewrite them to the managed slot's settings.
    const managedConfig = this.getManagedConfig();

    if (managedConfig !== undefined) {
      await this.applyDebugSettingsToConfig(managedConfig, debugSettings);
      return true;
    }

    const minecraftConfig = {
      type: "minecraft-js",
      port: VsCodeLaunchDefinition.getDebugPort(debugSettings) ?? MinecraftUtilities.getDebugPortForSlot(0),
    };

    // A brand-new configuration has no existing mode to preserve, so a
    // no-intent creation defaults to listen - the local-game profile a
    // fresh project starts from.
    if (debugSettings.isServer === undefined) {
      debugSettings = { ...debugSettings, isServer: false };
    }

    await this.applyDebugSettingsToConfig(minecraftConfig, debugSettings);

    this.definition.configurations.push(minecraftConfig);

    return true;
  }

  private async applyDebugSettingsToConfig(config: IVsCodeConfiguration, debugSettings: IDebugSettings) {
    // Mode follows the tri-state contract on IDebugSettings.isServer: only
    // a caller with explicit mode intent (deployment boundary, project
    // updater) rewrites it; a no-intent pass fixing OTHER fields (request,
    // module UUID, legacy-key migration) must leave the mode alone.
    if (debugSettings.isServer !== undefined) {
      if (debugSettings.isServer) {
        config.mode = undefined;
      } else {
        config.mode = "listen";
      }
    }

    if (config.name === undefined) {
      config.name = MinecraftManagedLaunchConfigName;
    }

    if (config.preLaunchTask === undefined) {
      config.preLaunchTask = "build";
    }

    // "attach" is the only request the official extension contributes for
    // minecraft-js (configurationAttributes.attach); VS Code rejects the
    // profile without it, so a missing or divergent value is corrected -
    // this runs only against the MCT-managed profile, never user-authored
    // ones.
    if (config.request !== "attach") {
      config.request = "attach";
    }

    let bpName = debugSettings.behaviorPackFolderName;

    if (bpName === undefined) {
      bpName = "starterbp";
    }

    // Migrate the legacy misspelled key: earlier MCT versions emitted
    // targetedModuleUuid, which the official minecraft-debugger extension
    // (verified against v1.53.0) neither declares nor reads - only
    // targetModuleUuid works. An existing targetModuleUuid always wins over
    // the legacy value; the legacy key is removed either way so the
    // serialized launch.json carries only the supported field.
    if (config.targetedModuleUuid !== undefined) {
      if (!config.targetModuleUuid) {
        config.targetModuleUuid = config.targetedModuleUuid;
      }

      delete config.targetedModuleUuid;
    }

    // Fill a missing module UUID from the project's default behavior pack;
    // an explicitly authored targetModuleUuid is always preserved.
    if (!config.targetModuleUuid) {
      const expectedUuid = await this.getExpectedScriptModuleUuid();

      if (expectedUuid !== undefined) {
        config.targetModuleUuid = expectedUuid;
      }
    }

    if (!config.sourceMapRoot) {
      // eslint-disable-next-line no-template-curly-in-string
      config.sourceMapRoot = "${workspaceFolder}/dist/debug/";
    }

    if (!config.generatedSourceRoot) {
      // eslint-disable-next-line no-template-curly-in-string
      config.generatedSourceRoot = "${workspaceFolder}/dist/scripts/";
    }

    const port = VsCodeLaunchDefinition.getDebugPort(debugSettings);

    if (port !== undefined) {
      config.port = port;
    }

    // The host field is managed under a tri-state contract (see
    // IDebugSettings.host): an explicit remote host is applied, an explicit
    // "localhost" REMOVES the field rather than leaving the config pointed
    // at a previously-configured remote machine, and an UNSPECIFIED host
    // preserves whatever the configuration already has - an update path
    // that carries no host intent must not erase a valid remote endpoint.
    if (debugSettings.host !== undefined) {
      if (VsCodeLaunchDefinition.normalizeDebugHost(debugSettings.host) !== "localhost") {
        config.host = debugSettings.host;
      } else {
        config.host = undefined;
      }
    }
  }

  async persist(): Promise<boolean> {
    if (this._file === undefined) {
      return false;
    }

    Log.assert(this.definition !== null, "VSLP");

    if (!this.definition) {
      return false;
    }

    return this._file.setObjectContentIfSemanticallyDifferent(this.definition);
  }

  async save() {
    if (this._file === undefined) {
      return;
    }

    this.persist();

    await this._file.saveContent(false);
  }

  async load() {
    if (this._file === undefined || this._isLoaded) {
      return;
    }

    await this._file.loadContent();

    if (this._file.content === null || this._file.content instanceof Uint8Array) {
      return;
    }

    this.id = this._file.name;

    this.definition = StorageUtilities.getJsonObject(this._file);

    this._isLoaded = true;
  }
}
