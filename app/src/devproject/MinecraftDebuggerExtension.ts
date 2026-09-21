// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Metadata and user guidance for the official Mojang "Minecraft Bedrock Debugger" VS Code
 * extension, plus helpers shared by the launch.json generator.
 *
 * MCT does not implement its own breakpoint/stepping debugger UX; per ADR-0001
 * (docs/adr/0001-minecraft-debugger-reuse.md) the VS Code debugging experience is provided by
 * the official extension, which MCT detects and recommends but never installs silently.
 *
 * This module is platform-neutral (no dependency on the `vscode` API) so that guidance and
 * configuration logic can be unit tested outside a VS Code extension host. The VS Code-side
 * consumer is ExtensionManager.ensureMinecraftDebuggerGuidance, which resolves the actions
 * returned here against real VS Code commands.
 *
 * Keep this module a leaf (type-only imports): VsCodeExtensionsDefinition reads
 * MinecraftDebuggerExtensionId at module-evaluation time, and a runtime import chain from here
 * back into app/ or minecraft/ creates a require cycle that leaves the constant undefined.
 */

/** Marketplace identifier (publisher.name) of the official debugger extension. */
export const MinecraftDebuggerExtensionId = "mojang-studios.minecraft-debugger";

/** Marketplace listing for the official debugger extension. */
export const MinecraftDebuggerMarketplaceUrl =
  "https://marketplace.visualstudio.com/items?itemName=mojang-studios.minecraft-debugger";

/** Source repository (MIT licensed) for the official debugger extension. */
export const MinecraftDebuggerRepositoryUrl = "https://github.com/Mojang/minecraft-debugger";

/**
 * Most recent Marketplace version verified against MCT's generated launch.json shape
 * (targetModuleUuid, sourceMapRoot, generatedSourceRoot, mode, port). Update when re-verifying
 * against a newer release of the extension.
 */
export const MinecraftDebuggerVerifiedVersion = "1.53.0";

/**
 * Explanation of the single-client constraint between MCT's diagnostics connection and a
 * VS Code debug session, naming the EXACT action that releases the connection. Surfaced to
 * every user entering the MANAGED BDS development mode - installed users especially, since
 * managed BDS enables MCT's diagnostics streaming by default, so MCT can already own the one
 * permitted debug socket when they start the official debugger. Remote-mode users get
 * MinecraftDebuggerRemoteAttachNotice and local-game users get
 * MinecraftDebuggerLocalGameAttachNotice instead: these instructions reference the managed
 * server's world settings and its restart, which exist only for a server MCT manages.
 */
export const MinecraftDebuggerHandoffNotice =
  "Minecraft accepts one debug client per debug port, and Minecraft Creator Tools' diagnostics " +
  "streaming holds that connection by default while a managed server runs. Before attaching the " +
  "Minecraft Debugger extension, release it: turn off the 'enableDebuggerStreaming' setting in " +
  "the server's world settings and restart the server. The managed server keeps running and " +
  "keeps listening on its debug port - only Creator Tools' own diagnostics connection is " +
  "released, freeing the port for your VS Code debug session. Re-enable the setting (and " +
  "restart) to resume Creator Tools diagnostics after your debug session ends.";

/**
 * Remote-flavor counterpart of the handoff notice: the single-client-per-port
 * constraint still holds, but the local handoff instructions (world settings
 * of the MCT-managed server, restart) do not apply to a server MCT does not
 * manage - prescribing them remotely would send the user to settings that do
 * not exist on their machine.
 */
export const MinecraftDebuggerRemoteAttachNotice =
  "Minecraft accepts one debug client per debug port. When attaching to a remotely hosted " +
  "server, make sure the 'Debug with Minecraft' launch configuration's host points at the " +
  "remote machine and that no other debug client on that machine holds its debug port.";

/**
 * Local-game counterpart: Creator Tools talks to the retail game through the
 * command WebSocket and never holds the game's script debug port, so there is
 * no socket to hand off and no managed-server world setting to toggle -
 * prescribing the localManaged instructions here would tell the user to
 * disable a setting and restart a server they do not have.
 */
export const MinecraftDebuggerLocalGameAttachNotice =
  "Minecraft accepts one debug client per debug port. Creator Tools connects to the local " +
  "game over its command WebSocket and does not hold the script debug port, so no handoff is " +
  "needed: start the 'Debug with Minecraft' launch configuration in VS Code, then run " +
  "'/script debugger connect' in the game to attach.";

export enum MinecraftDebuggerExtensionStatus {
  notInstalled = 0,
  installed = 1,
}

/**
 * Which development-mode surface the guidance is shown for. All three
 * developUsingXxx entry points surface guidance; the flavor selects the
 * attach notice appended to the message.
 */
export enum MinecraftDebuggerGuidanceFlavor {
  /**
   * MCT-managed built-in BDS: the socket handoff notice applies because
   * MCT's diagnostics streaming holds the single permitted debug socket by
   * default while a managed server runs.
   */
  localManaged = 0,
  /**
   * Remotely hosted Minecraft: install/open guidance plus the remote attach
   * notice - the local handoff instructions (managed-server world settings)
   * do not apply to a server MCT does not manage.
   */
  remote = 1,
  /**
   * The local retail game (game-proxy over the command WebSocket): MCT does
   * not hold the script debug port, so install/open guidance is delivered
   * with the local-game attach notice instead of the managed-server handoff
   * instructions, which reference a world setting and a server restart the
   * user does not have.
   */
  localGame = 2,
}

/**
 * One user-actionable step. commandId/commandArguments name a VS Code command for extension-host
 * surfaces; url is the equivalent (or fallback) for surfaces without the VS Code API. None of the
 * actions produced by this module install software — they only open UI the user acts on.
 */
export interface IMinecraftDebuggerGuidanceAction {
  title: string;
  commandId?: string;
  commandArguments?: string[];
  url?: string;
}

export interface IMinecraftDebuggerGuidance {
  status: MinecraftDebuggerExtensionStatus;
  installedVersion?: string;
  message: string;
  /**
   * The attach notice carried in the message: the managed-server
   * socket-handoff notice for localManaged-flavor guidance, the remote
   * attach notice for remote-flavor guidance, and the local-game attach
   * notice for localGame-flavor guidance.
   */
  attachNotice: string;
  /**
   * The managed-server socket-handoff notice, present only on
   * localManaged-flavor guidance; undefined for remote and local-game
   * guidance, whose messages must not carry the managed-server handoff
   * instructions.
   */
  handoffNotice?: string;
  actions: IMinecraftDebuggerGuidanceAction[];
}

/** Mutable show-once state for displayGuidanceOnce, owned by the display surface. */
export interface IMinecraftDebuggerGuidanceDisplayState {
  hasShown: boolean;
  /**
   * Whether the managed-server socket-handoff notice has been delivered.
   * Tracked separately from hasShown: a user who enters remote or local-game
   * mode first receives guidance without the handoff notice, and must still
   * get the handoff notice when they later enter the managed BDS mode - that
   * is exactly the moment MCT's diagnostics streaming starts holding the
   * debug socket.
   */
  hasShownHandoffNotice?: boolean;
}

export default class MinecraftDebuggerExtension {
  /**
   * Run the show-once guidance display flow against an abstract notifier.
   * The guidance message (which always carries the flavor's attach notice)
   * is shown regardless of whether installation actions exist - installed
   * users MUST still receive it. Repeat calls with the same state display
   * nothing, with one deliberate exception: a user whose first guidance was
   * remote-flavor (no local handoff notice) still receives the localManaged
   * guidance when they later enter a local managed mode, because that is
   * when MCT's diagnostics streaming starts holding the debug socket.
   * Returns the guidance that was displayed, or undefined when suppressed.
   */
  static displayGuidanceOnce(
    installedVersion: string | undefined,
    state: IMinecraftDebuggerGuidanceDisplayState,
    showMessage: (message: string, actionTitles: string[]) => void,
    flavor: MinecraftDebuggerGuidanceFlavor = MinecraftDebuggerGuidanceFlavor.localManaged
  ): IMinecraftDebuggerGuidance | undefined {
    if (flavor === MinecraftDebuggerGuidanceFlavor.localManaged) {
      if (state.hasShownHandoffNotice) {
        return undefined;
      }

      state.hasShownHandoffNotice = true;
    } else if (state.hasShown) {
      return undefined;
    }

    state.hasShown = true;

    const guidance = this.getGuidance(installedVersion, flavor);

    showMessage(
      guidance.message,
      guidance.actions.map((action) => action.title)
    );

    return guidance;
  }

  /**
   * Builds guidance for the official debugger extension given what is currently installed.
   * @param installedVersion the installed extension's version, or undefined if not installed.
   * @param flavor which development-mode surface the guidance is for; selects the attach
   * notice (local socket handoff vs. remote attach) appended to the message.
   */
  static getGuidance(
    installedVersion: string | undefined,
    flavor: MinecraftDebuggerGuidanceFlavor = MinecraftDebuggerGuidanceFlavor.localManaged
  ): IMinecraftDebuggerGuidance {
    const isLocalManaged = flavor === MinecraftDebuggerGuidanceFlavor.localManaged;
    const attachNotice = isLocalManaged
      ? MinecraftDebuggerHandoffNotice
      : flavor === MinecraftDebuggerGuidanceFlavor.localGame
        ? MinecraftDebuggerLocalGameAttachNotice
        : MinecraftDebuggerRemoteAttachNotice;
    const handoffNotice = isLocalManaged ? MinecraftDebuggerHandoffNotice : undefined;

    if (installedVersion !== undefined) {
      return {
        status: MinecraftDebuggerExtensionStatus.installed,
        installedVersion: installedVersion,
        // The attach notice is part of the installed message too: installed
        // users are exactly the ones who will attach while MCT's diagnostics
        // streaming (on by default for managed BDS) holds the single
        // permitted debug socket, or while the launch configuration still
        // points somewhere other than their remote server.
        message:
          "The Minecraft Bedrock Debugger extension (" +
          installedVersion +
          ") is installed. Use the generated 'Debug with Minecraft' launch configuration to attach. " +
          attachNotice,
        attachNotice: attachNotice,
        handoffNotice: handoffNotice,
        actions: [],
      };
    }

    return {
      status: MinecraftDebuggerExtensionStatus.notInstalled,
      message:
        "To set breakpoints and step through Minecraft scripts, install the official Minecraft " +
        "Bedrock Debugger extension from Mojang Studios. " +
        attachNotice,
      attachNotice: attachNotice,
      handoffNotice: handoffNotice,
      actions: [
        {
          title: "Show Extension",
          commandId: "extension.open",
          commandArguments: [MinecraftDebuggerExtensionId],
          url: MinecraftDebuggerMarketplaceUrl,
        },
        {
          title: "View on Marketplace",
          url: MinecraftDebuggerMarketplaceUrl,
        },
      ],
    };
  }
}
