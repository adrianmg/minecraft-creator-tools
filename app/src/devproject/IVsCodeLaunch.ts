// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export interface IVsCodeConfiguration {
  type?: string;
  request?: string;
  name?: string;
  mode?: string;
  host?: string;
  preLaunchTask?: string;
  /**
   * Script-module UUID the debugger should attach to. This is the key the
   * official minecraft-debugger extension declares and reads
   * (IAttachRequestArguments.targetModuleUuid) - the only spelling it
   * understands.
   */
  targetModuleUuid?: string;
  /**
   * Legacy misspelling emitted by earlier MCT versions; the official
   * extension has no such alias and silently ignores it. Read only so the
   * updater can migrate it into targetModuleUuid - never written.
   */
  targetedModuleUuid?: string;
  sourceMapRoot?: string;
  generatedSourceRoot?: string;
  port: number;
}

export default interface IVsCodeLaunch {
  version?: string;
  configurations?: IVsCodeConfiguration[];
}
