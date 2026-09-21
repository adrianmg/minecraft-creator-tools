// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * DebuggerExtensionGuidanceTest.ts
 *
 * Tests for the official Mojang Minecraft Debugger extension guidance and launch.json
 * generation (ADR-0001, docs/adr/0001-minecraft-debugger-reuse.md):
 * - Detection guidance for the mojang-studios.minecraft-debugger extension
 * - No silent-install behavior: guidance actions only open UI, never install
 * - Debug port derivation from server slots
 * - Generated minecraft-js launch configurations (module UUID, source-map roots, mode, port)
 */

import { expect } from "chai";
import MinecraftUtilities from "../minecraft/MinecraftUtilities";
import MinecraftDebuggerExtension, {
  MinecraftDebuggerExtensionId,
  MinecraftDebuggerExtensionStatus,
  MinecraftDebuggerGuidanceFlavor,
  MinecraftDebuggerHandoffNotice,
  MinecraftDebuggerLocalGameAttachNotice,
  MinecraftDebuggerMarketplaceUrl,
  MinecraftDebuggerRemoteAttachNotice,
  MinecraftDebuggerRepositoryUrl,
  MinecraftDebuggerVerifiedVersion,
} from "../devproject/MinecraftDebuggerExtension";
import VsCodeLaunchDefinition from "../devproject/VsCodeLaunchDefinition";
import ProjectAutogeneration from "../app/ProjectAutogeneration";
import ProjectUtilities from "../app/ProjectUtilities";
import TestPaths from "./TestPaths";
import VsCodeFileManager from "../manager/VsCodeFileManager";
import { VsCodeRecommendations } from "../devproject/VsCodeExtensionsDefinition";
import BehaviorManifestDefinition from "../minecraft/BehaviorManifestDefinition";
import Project from "../app/Project";
import { ProjectItemCreationType, ProjectItemStorageType, ProjectItemType } from "../app/IProjectItemData";

describe("MinecraftDebuggerExtension guidance", () => {
  it("pins the official extension identity and evidence links", () => {
    expect(MinecraftDebuggerExtensionId).to.equal("mojang-studios.minecraft-debugger");
    expect(MinecraftDebuggerMarketplaceUrl).to.equal(
      "https://marketplace.visualstudio.com/items?itemName=mojang-studios.minecraft-debugger"
    );
    expect(MinecraftDebuggerRepositoryUrl).to.equal("https://github.com/Mojang/minecraft-debugger");
    expect(MinecraftDebuggerVerifiedVersion).to.match(/^\d+\.\d+\.\d+$/);
  });

  it("is included in generated .vscode extension recommendations", () => {
    expect(VsCodeRecommendations).to.include(MinecraftDebuggerExtensionId);
  });

  it("recommends installation with actionable open guidance when not installed", () => {
    const guidance = MinecraftDebuggerExtension.getGuidance(undefined);

    expect(guidance.status).to.equal(MinecraftDebuggerExtensionStatus.notInstalled);
    expect(guidance.message).to.contain("Minecraft");
    expect(guidance.message).to.contain("install");
    expect(guidance.actions.length).to.be.greaterThan(0);

    const openAction = guidance.actions.find((action) => action.commandId === "extension.open");
    expect(openAction, "an action should open the extension page in the Extensions view").to.not.be.undefined;
    expect(openAction?.commandArguments).to.deep.equal([MinecraftDebuggerExtensionId]);
    expect(openAction?.url).to.equal(MinecraftDebuggerMarketplaceUrl);

    const marketplaceAction = guidance.actions.find((action) => action.url === MinecraftDebuggerMarketplaceUrl);
    expect(marketplaceAction).to.not.be.undefined;
  });

  it("never proposes silent programmatic installation", () => {
    for (const installedVersion of [undefined, "1.53.0"]) {
      const guidance = MinecraftDebuggerExtension.getGuidance(installedVersion);

      for (const action of guidance.actions) {
        expect(action.commandId ?? "").to.not.contain("installExtension");
        expect(action.title.toLowerCase()).to.not.contain("install");
      }
    }
  });

  it("explains the single-client handoff requirement to installed AND not-installed users", () => {
    // Installed users are exactly the ones who will attach while MCT's
    // diagnostics streaming (enabled by default for managed BDS) holds the
    // single permitted debug socket - the notice must reach them too.
    for (const installedVersion of [undefined, "1.53.0"]) {
      const guidance = MinecraftDebuggerExtension.getGuidance(installedVersion);

      expect(guidance.handoffNotice).to.equal(MinecraftDebuggerHandoffNotice);
      expect(guidance.message, `message must carry the handoff notice (installed=${installedVersion !== undefined})`)
        .to.contain(MinecraftDebuggerHandoffNotice);
    }

    expect(MinecraftDebuggerHandoffNotice).to.contain("one debug client");
    // The prescribed handoff must leave the managed server running AND
    // listening on its debug port - it releases only MCT's own diagnostics
    // connection, so the official extension has a debuggee to attach to.
    expect(MinecraftDebuggerHandoffNotice).to.contain("keeps listening");
    // The notice must name the EXACT action that releases the diagnostics
    // connection, so the user can actually perform the handoff.
    expect(MinecraftDebuggerHandoffNotice).to.contain("enableDebuggerStreaming");
  });

  it("offers no installation actions when the extension is already installed", () => {
    const guidance = MinecraftDebuggerExtension.getGuidance("1.53.0");

    expect(guidance.status).to.equal(MinecraftDebuggerExtensionStatus.installed);
    expect(guidance.installedVersion).to.equal("1.53.0");
    expect(guidance.actions).to.be.empty;
  });

  it("gives remote-flavor users install guidance without the local socket-handoff instructions", () => {
    // Remote script debugging is supported, so the remote development mode
    // must surface the same install/open guidance - but the local handoff
    // wording references the MANAGED server's world settings
    // (enableDebuggerStreaming) and a restart MCT performs, none of which
    // exist for a server MCT does not manage. Remote guidance carries the
    // remote attach notice instead.
    const notInstalled = MinecraftDebuggerExtension.getGuidance(undefined, MinecraftDebuggerGuidanceFlavor.remote);

    expect(notInstalled.message).to.contain("install");
    expect(notInstalled.actions.map((action) => action.title)).to.deep.equal(["Show Extension", "View on Marketplace"]);
    expect(notInstalled.message, "remote guidance must not prescribe the local handoff").to.not.contain(
      "enableDebuggerStreaming"
    );
    expect(notInstalled.message).to.contain(MinecraftDebuggerRemoteAttachNotice);
    expect(notInstalled.handoffNotice, "the local handoff notice is not part of remote guidance").to.be.undefined;
    expect(notInstalled.attachNotice).to.equal(MinecraftDebuggerRemoteAttachNotice);

    // Installed users get the remote attach notice too - the launch
    // configuration's host is exactly what they must point at the remote
    // machine before attaching.
    const installed = MinecraftDebuggerExtension.getGuidance("1.53.0", MinecraftDebuggerGuidanceFlavor.remote);
    expect(installed.actions).to.be.empty;
    expect(installed.message).to.contain(MinecraftDebuggerRemoteAttachNotice);
    expect(installed.message).to.not.contain("enableDebuggerStreaming");

    // The remote notice still states the single-client constraint, just
    // without the managed-server release procedure.
    expect(MinecraftDebuggerRemoteAttachNotice).to.contain("one debug client");
  });

  it("gives local-game users attach guidance without the managed-server handoff instructions", () => {
    // The game-proxy path talks to the retail game over the command
    // WebSocket and does not own the BDS script-debug socket; the
    // localManaged notice would tell these users to disable a managed
    // server's world setting and restart a server they do not have.
    for (const installedVersion of [undefined, "1.53.0"]) {
      const guidance = MinecraftDebuggerExtension.getGuidance(
        installedVersion,
        MinecraftDebuggerGuidanceFlavor.localGame
      );

      expect(guidance.attachNotice).to.equal(MinecraftDebuggerLocalGameAttachNotice);
      expect(guidance.message).to.contain(MinecraftDebuggerLocalGameAttachNotice);
      expect(
        guidance.message,
        "local-game guidance must not prescribe the managed-server handoff"
      ).to.not.contain("enableDebuggerStreaming");
      expect(guidance.handoffNotice, "the managed-server handoff notice is not part of local-game guidance").to.be
        .undefined;
    }

    // Not-installed users still get the install/open actions.
    const notInstalled = MinecraftDebuggerExtension.getGuidance(undefined, MinecraftDebuggerGuidanceFlavor.localGame);
    expect(notInstalled.actions.map((a) => a.title)).to.deep.equal(["Show Extension", "View on Marketplace"]);
  });

  describe("show-once display flow (displayGuidanceOnce)", () => {
    /**
     * The display flow ExtensionManager.ensureMinecraftDebuggerGuidance runs
     * on entering a Minecraft development mode. Regression for the branch
     * that returned early when no installation actions existed: installed
     * users never received the required socket-handoff notice even though
     * MCT's diagnostics streaming holds the debug socket by default.
     */

    function createRecorder() {
      const shown: { message: string; actionTitles: string[] }[] = [];
      return {
        shown: shown,
        showMessage: (message: string, actionTitles: string[]) => {
          shown.push({ message: message, actionTitles: actionTitles });
        },
      };
    }

    it("shows the handoff notice once for installed users, with no installation action", () => {
      const state = { hasShown: false };
      const recorder = createRecorder();

      const guidance = MinecraftDebuggerExtension.displayGuidanceOnce("1.53.0", state, recorder.showMessage);

      expect(guidance).to.not.be.undefined;
      expect(recorder.shown.length, "the notice must be shown despite there being no actions").to.equal(1);
      expect(recorder.shown[0].message).to.contain(MinecraftDebuggerHandoffNotice);
      expect(recorder.shown[0].actionTitles, "installed users get no installation action").to.deep.equal([]);
    });

    it("shows the same notice plus the open-page actions when the extension is missing", () => {
      const state = { hasShown: false };
      const recorder = createRecorder();

      MinecraftDebuggerExtension.displayGuidanceOnce(undefined, state, recorder.showMessage);

      expect(recorder.shown.length).to.equal(1);
      expect(recorder.shown[0].message).to.contain(MinecraftDebuggerHandoffNotice);
      expect(recorder.shown[0].actionTitles).to.deep.equal(["Show Extension", "View on Marketplace"]);
    });

    it("does not duplicate the notification across repeated mode changes", () => {
      for (const installedVersion of [undefined, "1.53.0"]) {
        const state = { hasShown: false };
        const recorder = createRecorder();

        // The user switches development modes several times in one session.
        MinecraftDebuggerExtension.displayGuidanceOnce(installedVersion, state, recorder.showMessage);
        MinecraftDebuggerExtension.displayGuidanceOnce(installedVersion, state, recorder.showMessage);
        MinecraftDebuggerExtension.displayGuidanceOnce(installedVersion, state, recorder.showMessage);

        expect(
          recorder.shown.length,
          `repeat mode changes must not duplicate (installed=${installedVersion !== undefined})`
        ).to.equal(1);
      }
    });

    it("surfaces guidance from all three development-mode entry points", () => {
      // Production wiring (ExtensionManager): developUsingMinecraftGame runs
      // the localGame flavor, developUsingRemoteMinecraft the remote flavor,
      // and developUsingDedicatedServer the localManaged flavor. Regression:
      // the remote entry point previously surfaced no guidance at all, so a
      // user who selected remote development first got neither
      // extension-install guidance nor any attach explanation, even though
      // remote script debugging is supported.
      const flavors = [
        MinecraftDebuggerGuidanceFlavor.localGame, // developUsingMinecraftGame
        MinecraftDebuggerGuidanceFlavor.remote, // developUsingRemoteMinecraft
        MinecraftDebuggerGuidanceFlavor.localManaged, // developUsingDedicatedServer
      ];

      for (const firstFlavor of flavors) {
        const state = { hasShown: false };
        const recorder = createRecorder();

        const guidance = MinecraftDebuggerExtension.displayGuidanceOnce(
          undefined,
          state,
          recorder.showMessage,
          firstFlavor
        );

        expect(guidance, `entry point with flavor ${firstFlavor} must surface guidance`).to.not.be.undefined;
        expect(recorder.shown.length).to.equal(1);
        expect(recorder.shown[0].actionTitles, "install guidance must reach every entry point").to.deep.equal([
          "Show Extension",
          "View on Marketplace",
        ]);
      }
    });

    it("still delivers the handoff notice to a remote-first user entering a local managed mode", () => {
      // Entry order: developUsingRemoteMinecraft, then
      // developUsingDedicatedServer. The remote guidance (correctly) omits
      // the local socket-handoff instructions - but entering a local
      // managed mode is exactly when MCT's diagnostics streaming starts
      // holding the debug socket, so the handoff notice must still arrive.
      const state = { hasShown: false };
      const recorder = createRecorder();

      MinecraftDebuggerExtension.displayGuidanceOnce(
        "1.53.0",
        state,
        recorder.showMessage,
        MinecraftDebuggerGuidanceFlavor.remote
      );

      expect(recorder.shown.length).to.equal(1);
      expect(recorder.shown[0].message).to.not.contain("enableDebuggerStreaming");

      MinecraftDebuggerExtension.displayGuidanceOnce(
        "1.53.0",
        state,
        recorder.showMessage,
        MinecraftDebuggerGuidanceFlavor.localManaged
      );

      expect(recorder.shown.length, "the local handoff notice must still be delivered").to.equal(2);
      expect(recorder.shown[1].message).to.contain(MinecraftDebuggerHandoffNotice);

      // And the flow settles: further mode changes in either flavor show
      // nothing more.
      for (const flavor of [MinecraftDebuggerGuidanceFlavor.remote, MinecraftDebuggerGuidanceFlavor.localManaged]) {
        MinecraftDebuggerExtension.displayGuidanceOnce("1.53.0", state, recorder.showMessage, flavor);
      }
      expect(recorder.shown.length).to.equal(2);
    });

    it("shows nothing further when a local-mode user later enters remote mode", () => {
      // Entry order: developUsingDedicatedServer, then
      // developUsingRemoteMinecraft. The local guidance already delivered
      // the install actions, so the remote entry has nothing new to say.
      const state = { hasShown: false };
      const recorder = createRecorder();

      MinecraftDebuggerExtension.displayGuidanceOnce(
        undefined,
        state,
        recorder.showMessage,
        MinecraftDebuggerGuidanceFlavor.localManaged
      );
      MinecraftDebuggerExtension.displayGuidanceOnce(
        undefined,
        state,
        recorder.showMessage,
        MinecraftDebuggerGuidanceFlavor.remote
      );

      expect(recorder.shown.length, "local-first users must not see a second notification").to.equal(1);
      expect(recorder.shown[0].message).to.contain(MinecraftDebuggerHandoffNotice);
    });

    it("still delivers the handoff notice to a local-game-first user entering managed BDS", () => {
      // Entry order: developUsingMinecraftGame, then
      // developUsingDedicatedServer. Local-game guidance (correctly) omits
      // the managed-server handoff instructions - but managed BDS is when
      // MCT's diagnostics streaming starts holding the debug socket, so the
      // handoff notice must still arrive.
      const state = { hasShown: false };
      const recorder = createRecorder();

      MinecraftDebuggerExtension.displayGuidanceOnce(
        "1.53.0",
        state,
        recorder.showMessage,
        MinecraftDebuggerGuidanceFlavor.localGame
      );

      expect(recorder.shown.length).to.equal(1);
      expect(recorder.shown[0].message).to.contain(MinecraftDebuggerLocalGameAttachNotice);
      expect(recorder.shown[0].message).to.not.contain("enableDebuggerStreaming");

      MinecraftDebuggerExtension.displayGuidanceOnce(
        "1.53.0",
        state,
        recorder.showMessage,
        MinecraftDebuggerGuidanceFlavor.localManaged
      );

      expect(recorder.shown.length, "the managed-server handoff notice must still be delivered").to.equal(2);
      expect(recorder.shown[1].message).to.contain(MinecraftDebuggerHandoffNotice);
    });

    it("shows nothing further when a managed-BDS-first user later enters local game mode", () => {
      // The managed guidance already delivered both the install actions and
      // the handoff notice; the local-game entry has nothing new to say.
      const state = { hasShown: false };
      const recorder = createRecorder();

      MinecraftDebuggerExtension.displayGuidanceOnce(
        undefined,
        state,
        recorder.showMessage,
        MinecraftDebuggerGuidanceFlavor.localManaged
      );
      MinecraftDebuggerExtension.displayGuidanceOnce(
        undefined,
        state,
        recorder.showMessage,
        MinecraftDebuggerGuidanceFlavor.localGame
      );

      expect(recorder.shown.length, "managed-first users must not see a second notification").to.equal(1);
    });
  });

  it("derives the debug port from the server slot, with explicit port winning", () => {
    expect(VsCodeLaunchDefinition.getDebugPort(undefined)).to.be.undefined;
    expect(VsCodeLaunchDefinition.getDebugPort({ isServer: true })).to.be.undefined;
    expect(VsCodeLaunchDefinition.getDebugPort({ isServer: true, slot: 0 })).to.equal(19144);
    expect(VsCodeLaunchDefinition.getDebugPort({ isServer: true, slot: 1 })).to.equal(19176);
    expect(VsCodeLaunchDefinition.getDebugPort({ isServer: true, slot: 2 })).to.equal(
      MinecraftUtilities.getDebugPortForSlot(2)
    );
    expect(VsCodeLaunchDefinition.getDebugPort({ isServer: true, slot: 1, port: 20000 })).to.equal(20000);
  });
});

describe("VsCodeLaunchDefinition generated configuration", () => {
  const scriptModuleUuid = "6f4bdd91-1f2a-4bd8-a2f5-1a0ddc8e34f2";

  function createFakeProject(): Project {
    const manifest = new BehaviorManifestDefinition();

    manifest.definition = {
      format_version: 2,
      header: {
        name: "test",
        description: "test",
        version: [0, 0, 1],
        min_engine_version: [1, 20, 10],
        uuid: "0a2b7a34-9a3f-4a64-8ba7-2c0ddc8e34f1",
      },
      modules: [
        {
          type: "script",
          description: "test",
          version: [0, 0, 1],
          uuid: scriptModuleUuid,
          language: "javascript",
        },
      ],
    } as any;

    const fakePack = { manifest: manifest };

    return {
      getDefaultBehaviorPack: async () => fakePack,
    } as unknown as Project;
  }

  it("creates a minecraft-js configuration for the current project with module UUID and source-map roots", async () => {
    const launch = new VsCodeLaunchDefinition();
    launch.project = createFakeProject();

    const result = await launch.ensureMinContent({ isServer: false });

    expect(result).to.be.true;
    expect(launch.definition?.configurations).to.have.lengthOf(1);

    const config = launch.definition!.configurations![0];

    expect(config.type).to.equal("minecraft-js");
    expect(config.name).to.equal("Debug with Minecraft");
    // The official extension contributes minecraft-js under
    // configurationAttributes.attach - VS Code rejects the profile (F5
    // cannot start the debugger) without "request": "attach".
    expect(config.request).to.equal("attach");
    // targetModuleUuid is the key the official extension reads; the legacy
    // misspelling (targetedModuleUuid) is ignored by it and must not appear.
    expect(config.targetModuleUuid).to.equal(scriptModuleUuid);
    expect(config.targetedModuleUuid).to.be.undefined;
    // eslint-disable-next-line no-template-curly-in-string
    expect(config.sourceMapRoot).to.equal("${workspaceFolder}/dist/debug/");
    // eslint-disable-next-line no-template-curly-in-string
    expect(config.generatedSourceRoot).to.equal("${workspaceFolder}/dist/scripts/");
    expect(config.mode).to.equal("listen");
    expect(config.port).to.equal(19144);
  });

  it("uses a dynamic port derived from the server slot", async () => {
    const launch = new VsCodeLaunchDefinition();
    launch.project = createFakeProject();

    const result = await launch.ensureMinContent({ isServer: true, slot: 1 });

    expect(result).to.be.true;

    const config = launch.definition!.configurations![0];

    expect(config.port).to.equal(19176);
    expect(config.mode, "server configurations should not use listen mode").to.be.undefined;
  });

  it("applies an explicit host and port for remote debuggees", async () => {
    const launch = new VsCodeLaunchDefinition();
    launch.project = createFakeProject();

    const result = await launch.ensureMinContent({ isServer: true, port: 20500, host: "192.168.1.50" });

    expect(result).to.be.true;

    const config = launch.definition!.configurations![0];

    expect(config.port).to.equal(20500);
    expect(config.host).to.equal("192.168.1.50");
  });

  it("treats a slot-derived port mismatch as missing min content", async () => {
    const launch = new VsCodeLaunchDefinition();
    launch.project = createFakeProject();

    await launch.ensureMinContent({ isServer: true, slot: 0 });

    expect(await launch.hasMinContent({ isServer: true, slot: 0 })).to.be.true;
    expect(await launch.hasMinContent({ isServer: true, slot: 1 })).to.be.false;

    await launch.ensureMinContent({ isServer: true, slot: 1 });

    expect(launch.definition!.configurations![0].port).to.equal(19176);
  });

  describe("managed host semantics", () => {
    /**
     * The generated configuration's host field is managed by IDebugSettings
     * (omission = localhost). Regressions for host-only changes being
     * ignored: hasMinContent previously never compared host, so an
     * otherwise-matching config neither received a newly requested host nor
     * dropped a stale remote one - a later local attach targeted the
     * previous machine.
     */

    it("adds a newly requested remote host to an otherwise-matching config", async () => {
      const launch = new VsCodeLaunchDefinition();
      launch.project = createFakeProject();

      await launch.ensureMinContent({ isServer: true, slot: 0 });
      expect(launch.definition!.configurations![0].host).to.be.undefined;

      // A host-only change: mode and port already match.
      expect(await launch.hasMinContent({ isServer: true, slot: 0, host: "192.168.1.50" })).to.be.false;

      await launch.ensureMinContent({ isServer: true, slot: 0, host: "192.168.1.50" });

      expect(launch.definition!.configurations![0].host).to.equal("192.168.1.50");
      expect(await launch.hasMinContent({ isServer: true, slot: 0, host: "192.168.1.50" })).to.be.true;
    });

    it("updates one remote host to another", async () => {
      const launch = new VsCodeLaunchDefinition();
      launch.project = createFakeProject();

      await launch.ensureMinContent({ isServer: true, slot: 0, host: "192.168.1.50" });

      expect(await launch.hasMinContent({ isServer: true, slot: 0, host: "192.168.1.60" })).to.be.false;

      await launch.ensureMinContent({ isServer: true, slot: 0, host: "192.168.1.60" });

      expect(launch.definition!.configurations![0].host).to.equal("192.168.1.60");
    });

    it("preserves an existing remote host when settings express no host intent", async () => {
      // Tri-state contract: no production caller persists a host setting, so
      // an unspecified host means "no intent" and must NOT read as an
      // explicit localhost selection - otherwise every updater pass erases a
      // valid remote endpoint.
      const launch = new VsCodeLaunchDefinition();
      launch.project = createFakeProject();

      await launch.ensureMinContent({ isServer: true, slot: 0, host: "192.168.1.50" });

      expect(await launch.hasMinContent({ isServer: true, slot: 0 })).to.be.true;

      await launch.ensureMinContent({ isServer: true, slot: 0 });

      expect(
        launch.definition!.configurations![0].host,
        "a no-intent update must preserve the remote host"
      ).to.equal("192.168.1.50");
    });

    it("removes a stale remote host when settings explicitly select localhost", async () => {
      const launch = new VsCodeLaunchDefinition();
      launch.project = createFakeProject();

      await launch.ensureMinContent({ isServer: true, slot: 0, host: "192.168.1.50" });

      // An explicit "localhost" is a real selection: the stale remote host
      // must not survive, or a later local attach targets the previous
      // machine.
      expect(await launch.hasMinContent({ isServer: true, slot: 0, host: "localhost" })).to.be.false;

      await launch.ensureMinContent({ isServer: true, slot: 0, host: "localhost" });

      expect(launch.definition!.configurations![0].host, "the stale remote host must be removed").to.be.undefined;
      expect(await launch.hasMinContent({ isServer: true, slot: 0, host: "localhost" })).to.be.true;
    });
  });

  describe("managed mode semantics", () => {
    /**
     * The managed configuration's mode is tri-state like host (see
     * IDebugSettings.isServer). Regression: hasMinContent/ensureMinContent
     * defaulted an argless call to { isServer: false } - a fabricated
     * listen-mode intent - so ProjectAutogeneration's save pass flipped the
     * connect-mode server profile the deployment boundary had just
     * reconciled back to "listen", leaving F5 waiting for Minecraft to
     * connect instead of attaching to the running managed BDS.
     */

    it("preserves connect mode through a no-intent pass", async () => {
      const launch = new VsCodeLaunchDefinition();
      launch.project = createFakeProject();

      await launch.ensureMinContent({ isServer: true, slot: 1 });
      expect(launch.definition!.configurations![0].mode).to.be.undefined;

      // The argless autogeneration-style pass carries no mode intent...
      expect(await launch.hasMinContent()).to.be.true;
      await launch.ensureMinContent();

      const config = launch.definition!.configurations![0];
      expect(config.mode, "a no-intent pass must not flip the server profile to listen").to.be.undefined;
      expect(config.port, "the slot-derived port must survive too").to.equal(19176);
    });

    it("preserves listen mode through a no-intent pass", async () => {
      const launch = new VsCodeLaunchDefinition();
      launch.project = createFakeProject();

      await launch.ensureMinContent({ isServer: false });
      expect(launch.definition!.configurations![0].mode).to.equal("listen");

      await launch.ensureMinContent();

      expect(launch.definition!.configurations![0].mode).to.equal("listen");
    });

    it("defaults a newly created configuration to listen when no mode intent is given", async () => {
      // A fresh project with no managed configuration has no existing mode
      // to preserve: the argless creation path keeps its historical listen
      // default (the local-game profile).
      const launch = new VsCodeLaunchDefinition();
      launch.project = createFakeProject();

      await launch.ensureMinContent();

      const config = launch.definition!.configurations![0];
      expect(config.mode).to.equal("listen");
      expect(config.port).to.equal(19144);
    });

    it("fixes other incomplete fields under a no-intent pass without touching mode", async () => {
      // An argless pass is still allowed to migrate structural problems
      // (here: the missing required "request") - it just may not rewrite
      // the mode while doing so.
      const launch = new VsCodeLaunchDefinition();
      launch.project = createFakeProject();
      launch.definition = {
        version: "0.3.0",
        configurations: [
          {
            type: "minecraft-js",
            name: "Debug with Minecraft",
            port: 19176,
          },
        ],
      };

      expect(await launch.hasMinContent(), "the missing request must read as incomplete").to.be.false;

      await launch.ensureMinContent();

      const config = launch.definition!.configurations![0];
      expect(config.request).to.equal("attach");
      expect(config.mode, "the connect-mode profile must not be flipped while fixing request").to.be.undefined;
      expect(config.port).to.equal(19176);
    });
  });
});

describe("VsCodeFileManager launch.json migration", () => {
  /**
   * Updater/migration path for launch.json files an EARLIER updater run
   * already produced: those have a server-mode minecraft-js configuration
   * but predate module-UUID injection. hasMinContent must treat a missing
   * targetModuleUuid (when the project can supply one) as incomplete so
   * ensureMinecraftDebugConfig enriches and persists it - otherwise the
   * debugger can attach to the wrong pack when several scripted packs are
   * active. Explicitly authored UUIDs are preserved, never overwritten. The
   * legacy misspelled key (targetedModuleUuid), which the official
   * extension ignores, is migrated to targetModuleUuid and removed.
   */

  const scriptModuleUuid = "7c1fddb2-2b3a-4cd9-b3f6-2b1eed9f45a3";

  function createUpdaterHarness(initialLaunchJson: object) {
    const fakeFile: any = {
      name: "launch.json",
      storageRelativePath: "/.vscode/launch.json",
      manager: undefined,
      content: JSON.stringify(initialLaunchJson),
      isInErrorState: false,
      loadContent: async () => {},
      setObjectContentIfSemanticallyDifferent: (obj: object) => {
        const next = JSON.stringify(obj);
        const changed = JSON.stringify(JSON.parse(fakeFile.content)) !== next;
        fakeFile.content = next;
        return changed;
      },
      saveContent: async () => {},
    };

    const manifest = new BehaviorManifestDefinition();

    manifest.definition = {
      format_version: 2,
      header: {
        name: "test",
        description: "test",
        version: [0, 0, 1],
        min_engine_version: [1, 20, 10],
        uuid: "1b3c8a45-0b4f-4b75-9cb8-3d1eed9f45a2",
      },
      modules: [
        {
          type: "script",
          description: "test",
          version: [0, 0, 1],
          uuid: scriptModuleUuid,
          language: "javascript",
        },
      ],
    } as any;

    const fakeItem = {
      itemType: ProjectItemType.vsCodeLaunchJson,
      storageType: ProjectItemStorageType.singleFile,
      creationType: ProjectItemCreationType.generated,
      isContentLoaded: true,
      loadContent: async () => {},
      primaryFile: fakeFile,
    };

    const fakeProject = {
      getItemsCopy: () => [fakeItem],
      getDefaultBehaviorPack: async () => ({ manifest: manifest, folder: { name: "testbp" } }),
    } as unknown as Project;

    // Real ProjectItems carry their owning project; the autogeneration
    // side-file pass reads it to attach the project before reconciliation.
    (fakeItem as any).project = fakeProject;

    return {
      project: fakeProject,
      item: fakeItem,
      readLaunch: () => JSON.parse(fakeFile.content),
    };
  }

  // A launch.json a previous updater generation produced: server-mode
  // minecraft-js configuration, no module UUID, plus an unrelated
  // user-authored entry that must never be touched.
  const legacyLaunchJson = {
    version: "0.3.0",
    configurations: [
      {
        type: "minecraft-js",
        name: "Debug with Minecraft",
        port: 19144,
      },
      {
        type: "node",
        request: "launch",
        name: "Run unit tests",
        port: 9229,
      },
    ],
  };

  it("persists the default pack's script UUID into an existing config that lacks one", async () => {
    const harness = createUpdaterHarness(legacyLaunchJson);
    const manager = new VsCodeFileManager();

    const results = await manager.ensureMinecraftDebugConfig(harness.project);

    expect(results.length, "the migration must report a persisted update").to.equal(1);

    // Inspect the SERIALIZED launch.json: the official extension reads
    // targetModuleUuid only; the legacy misspelling must not be emitted.
    const serialized = harness.readLaunch().configurations[0];
    expect(serialized.targetModuleUuid).to.equal(scriptModuleUuid);
    expect(serialized.targetedModuleUuid, "the unsupported legacy alias must not be written").to.be.undefined;
  });

  it("the autogeneration pass attaches the project so the managed profile is enriched", async () => {
    // Regression: updateItemAutogeneration() ran ensureMinContent() without
    // assigning the already-loaded item.project. In that path
    // getExpectedScriptModuleUuid() returned undefined, so a managed launch
    // profile missing targetModuleUuid was treated as complete and could
    // keep attaching to the wrong pack until another updater happened to
    // run.
    const harness = createUpdaterHarness(legacyLaunchJson);

    await ProjectAutogeneration.updateItemAutogeneration(harness.item as any);

    const serialized = harness.readLaunch().configurations[0];
    expect(
      serialized.targetModuleUuid,
      "the autogeneration pass must enrich the managed profile with the pack's module UUID"
    ).to.equal(scriptModuleUuid);
  });

  it("updates only the MCT-managed profile, preserving user-authored minecraft-js profiles byte-for-byte", async () => {
    // Regression: the deployment boundary (managed-BDS start) runs
    // ensureMinecraftDebugConfig automatically. It must reconcile ONLY the
    // MCT-managed profile (stable name "Debug with Minecraft"); a project
    // can legitimately keep a listen-mode profile for the local game and a
    // connect profile for a remote BDS, and starting the built-in server
    // must not rewrite them to connect mode / the managed slot port.
    const userListenProfile = {
      type: "minecraft-js",
      request: "attach",
      name: "Debug local Minecraft game",
      mode: "listen",
      port: 19144,
      targetModuleUuid: "aaaaaaaa-1111-2222-3333-444444444444",
      // eslint-disable-next-line no-template-curly-in-string
      sourceMapRoot: "${workspaceFolder}/custom/debug/",
    };
    // The managed profile still carries the legacy misspelled key an
    // earlier MCT emitted; the update pass must migrate it.
    const managedProfile = {
      type: "minecraft-js",
      name: "Debug with Minecraft",
      port: 19144,
      targetedModuleUuid: scriptModuleUuid,
    };
    // A user-authored profile carrying the legacy key stays byte-for-byte
    // untouched - migration is scoped to the managed profile only.
    const userRemoteProfile = {
      type: "minecraft-js",
      name: "Debug remote BDS",
      host: "192.168.1.99",
      port: 20044,
      targetedModuleUuid: "bbbbbbbb-1111-2222-3333-444444444444",
      // eslint-disable-next-line no-template-curly-in-string
      generatedSourceRoot: "${workspaceFolder}/custom/scripts/",
    };

    const harness = createUpdaterHarness({
      version: "0.3.0",
      configurations: [userListenProfile, managedProfile, userRemoteProfile],
    });
    const manager = new VsCodeFileManager();

    // The managed-BDS deployment boundary passes its real slot.
    await manager.ensureMinecraftDebugConfig(harness.project, 1);

    const configs = harness.readLaunch().configurations;

    expect(configs, "no profile may be added or removed").to.have.lengthOf(3);
    // Ordering preserved; user-authored profiles byte-for-byte identical
    // (mode, host, port, UUID, source roots all untouched).
    expect(configs[0]).to.deep.equal(userListenProfile);
    expect(configs[2]).to.deep.equal(userRemoteProfile);
    // Only the managed profile received the slot-derived port - and its
    // legacy misspelled key was migrated to the field the official
    // extension actually reads, and the required attach request was added.
    expect(configs[1].name).to.equal("Debug with Minecraft");
    expect(configs[1].port).to.equal(MinecraftUtilities.getDebugPortForSlot(1));
    expect(configs[1].mode, "the managed profile is a connect-mode server config").to.be.undefined;
    expect(configs[1].targetModuleUuid).to.equal(scriptModuleUuid);
    expect(configs[1].targetedModuleUuid, "the legacy alias must be removed from the managed profile").to.be.undefined;
    expect(configs[1].request).to.equal("attach");
    // User-authored profiles retain their ORIGINAL request values (already
    // covered by the byte-for-byte deep equality above): the listen profile
    // keeps its authored "attach", and the remote profile stays without one.
    expect(configs[0].request).to.equal("attach");
    expect(configs[2].request).to.be.undefined;
  });

  it("preserves an existing remote host through the real updater entry point", async () => {
    // Regression: ensureMinecraftDebugConfig builds settings without a host
    // (no production path persists one). That omission previously read as an
    // explicit localhost selection, so an existing remote minecraft-js
    // configuration failed hasMinContent and its host was silently cleared
    // on the next updater/deployment pass.
    const remoteLaunchJson = {
      version: "0.3.0",
      configurations: [
        {
          type: "minecraft-js",
          name: "Debug with Minecraft",
          port: 19144,
          host: "192.168.1.50",
        },
      ],
    };

    const harness = createUpdaterHarness(remoteLaunchJson);
    const manager = new VsCodeFileManager();

    // First pass may enrich other fields (module UUID etc.) but must keep
    // the remote host intact.
    await manager.ensureMinecraftDebugConfig(harness.project);
    expect(harness.readLaunch().configurations[0].host, "the remote host must survive the updater pass").to.equal(
      "192.168.1.50"
    );

    // And the flow converges: a second pass reports nothing further and the
    // host is still there.
    const secondRun = await manager.ensureMinecraftDebugConfig(harness.project);
    expect(secondRun.length, "a converged config must not keep re-updating").to.equal(0);
    expect(harness.readLaunch().configurations[0].host).to.equal("192.168.1.50");
  });

  it("removes a remote host when the local-BDS boundary passes explicit localhost intent", async () => {
    // Regression: the local-BDS deployment boundary
    // (VscDedicatedServerManager.prepareAndStart) starts the LOCAL built-in
    // server, but previously called ensureMinecraftDebugConfig with no host
    // intent - so a managed profile still pointing at a remote machine kept
    // that host, and F5 attached to the previous machine instead of the
    // server just started. The boundary now passes explicit "localhost",
    // which under the tri-state contract removes the field.
    const remoteLaunchJson = {
      version: "0.3.0",
      configurations: [
        {
          type: "minecraft-js",
          name: "Debug with Minecraft",
          port: 19144,
          host: "192.168.1.50",
        },
      ],
    };

    const harness = createUpdaterHarness(remoteLaunchJson);
    const manager = new VsCodeFileManager();

    const results = await manager.ensureMinecraftDebugConfig(harness.project, 0, "localhost");

    expect(results.length, "the stale remote host must trigger a persisted update").to.equal(1);
    expect(harness.readLaunch().configurations[0].host, "the remote host must be removed, not preserved").to.be
      .undefined;

    // Converges: a second boundary pass changes nothing...
    expect((await manager.ensureMinecraftDebugConfig(harness.project, 0, "localhost")).length).to.equal(0);

    // ...and a later generic (no-intent) updater pass does not resurrect or
    // re-report anything either.
    expect((await manager.ensureMinecraftDebugConfig(harness.project)).length).to.equal(0);
  });

  it("keeps the managed BDS connect profile intact through a later project autogeneration save", async () => {
    // Regression for the full production sequence: the deployment boundary
    // reconciles the managed profile as a connect-mode server config, but
    // ProjectAutogeneration.updateItemAutogeneration later runs
    // ensureMinContent() with no settings on every project save. That
    // argless call used to default to { isServer: false } - a fabricated
    // listen intent - flipping the profile back to mode: "listen", so F5
    // waited for Minecraft to connect instead of attaching to the running
    // managed BDS.
    const harness = createUpdaterHarness(legacyLaunchJson);
    const manager = new VsCodeFileManager();

    // 1. Built-in BDS starts in slot 1: the deployment boundary produces a
    //    connect-mode profile on the slot-derived port.
    await manager.ensureMinecraftDebugConfig(harness.project, 1, "localhost");

    const afterDeploy = harness.readLaunch();
    expect(afterDeploy.configurations[0].mode, "the deployment boundary produces a connect-mode profile").to.be
      .undefined;
    expect(afterDeploy.configurations[0].port).to.equal(19176);

    // 2. The user saves the project: the autogeneration pass runs
    //    ensureMinContent() + save() with NO settings on the same file
    //    (mirrors ProjectAutogeneration.updateItemAutogeneration).
    const file = (harness.project.getItemsCopy()[0] as any).primaryFile;
    const launch = await VsCodeLaunchDefinition.ensureOnFile(file);

    expect(launch).to.not.be.undefined;

    await launch!.ensureMinContent();
    await launch!.save();

    const afterAutogen = harness.readLaunch();
    expect(
      afterAutogen.configurations[0].mode,
      "autogeneration must not flip the server profile back to listen"
    ).to.be.undefined;
    expect(afterAutogen.configurations[0].port, "the slot-derived port must survive").to.equal(19176);
    expect(JSON.stringify(afterAutogen), "the autogeneration pass must be a no-op on a reconciled file").to.equal(
      JSON.stringify(afterDeploy)
    );
  });

  it("is idempotent: a second updater run changes nothing", async () => {
    const harness = createUpdaterHarness(legacyLaunchJson);
    const manager = new VsCodeFileManager();

    await manager.ensureMinecraftDebugConfig(harness.project);
    const contentAfterFirstRun = JSON.stringify(harness.readLaunch());

    const secondRunResults = await manager.ensureMinecraftDebugConfig(harness.project);

    expect(secondRunResults.length, "a second run must not report further updates").to.equal(0);
    expect(JSON.stringify(harness.readLaunch())).to.equal(contentAfterFirstRun);
  });

  it("persists the slot-derived port when the session boundary supplies slot 1", async () => {
    // The production deployment boundary (VscDedicatedServerManager
    // .prepareAndStart) passes its managed-session slot; content deployed to
    // slot 1 must get the slot-1 debug port, not the slot-0 default.
    const harness = createUpdaterHarness(legacyLaunchJson);
    const manager = new VsCodeFileManager();

    const results = await manager.ensureMinecraftDebugConfig(harness.project, 1);

    expect(results.length).to.equal(1);
    expect(harness.readLaunch().configurations[0].port, "slot 1 derives port 19176").to.equal(19176);
  });

  it("targets the lifecycle-confirmed fallback port when the session boundary supplies one", async () => {
    // Regression: the deploy-time write uses the static slot derivation, but
    // the listener reserves a collision-free port and can land on a FALLBACK
    // when the preferred port is occupied. The session boundary re-runs this
    // update with the confirmed port (VscDedicatedServerManager
    // .watchForDebugPortFallback); the managed profile must target it, or F5
    // attaches to the stale preferred port instead of the actual listener.
    const harness = createUpdaterHarness(legacyLaunchJson);
    const manager = new VsCodeFileManager();

    const results = await manager.ensureMinecraftDebugConfig(harness.project, 0, "localhost", 19146);

    expect(results.length).to.equal(1);
    expect(harness.readLaunch().configurations[0].port, "the confirmed fallback port must win").to.equal(19146);
  });

  it("keeps slot 0 at 19144 and lets an explicit port take precedence", async () => {
    const harness = createUpdaterHarness(legacyLaunchJson);
    const manager = new VsCodeFileManager();

    // The generic updater path defaults to slot 0 - the slot every embedded
    // surface manages - so the existing 19144 port stays.
    await manager.ensureMinecraftDebugConfig(harness.project);
    expect(harness.readLaunch().configurations[0].port).to.equal(19144);

    // An explicit port always wins over the slot derivation.
    const launch = new VsCodeLaunchDefinition();
    launch.project = harness.project;
    await launch.ensureMinContent({ isServer: true, slot: 1, port: 20500 });
    expect(launch.definition!.configurations![0].port).to.equal(20500);
  });

  it("corrects the generated port when moving between slots, leaving unrelated entries untouched", async () => {
    const harness = createUpdaterHarness(legacyLaunchJson);
    const manager = new VsCodeFileManager();

    const slot1Results = await manager.ensureMinecraftDebugConfig(harness.project, 1);
    expect(slot1Results.length).to.equal(1);
    expect(harness.readLaunch().configurations[0].port).to.equal(19176);

    // Re-running for the same slot is idempotent...
    expect((await manager.ensureMinecraftDebugConfig(harness.project, 1)).length).to.equal(0);

    // ...and moving back to slot 0 corrects the generated port again.
    const slot0Results = await manager.ensureMinecraftDebugConfig(harness.project, 0);
    expect(slot0Results.length).to.equal(1);
    expect(harness.readLaunch().configurations[0].port).to.equal(19144);

    // The unrelated user-authored launch entry is never touched.
    expect(harness.readLaunch().configurations[1]).to.deep.equal({
      type: "node",
      request: "launch",
      name: "Run unit tests",
      port: 9229,
    });
  });

  it("preserves a pre-existing explicitly authored UUID", async () => {
    const userAuthoredUuid = "9e8d7c6b-5a49-4838-a726-151413121110";
    const harness = createUpdaterHarness({
      version: "0.3.0",
      configurations: [
        {
          type: "minecraft-js",
          request: "attach",
          name: "Debug with Minecraft",
          port: 19144,
          targetModuleUuid: userAuthoredUuid,
        },
      ],
    });
    const manager = new VsCodeFileManager();

    const results = await manager.ensureMinecraftDebugConfig(harness.project);

    expect(results.length, "an explicitly targeted config needs no migration").to.equal(0);
    expect(harness.readLaunch().configurations[0].targetModuleUuid).to.equal(userAuthoredUuid);
  });

  it("adds the required attach request to an existing managed profile and converges", async () => {
    // Prior generated profiles carried no "request" field; the official
    // extension contributes minecraft-js only under
    // configurationAttributes.attach, so VS Code rejects such a profile and
    // F5 cannot start the debugger. The updater must upgrade it in place.
    const harness = createUpdaterHarness(legacyLaunchJson);
    const manager = new VsCodeFileManager();

    const results = await manager.ensureMinecraftDebugConfig(harness.project);
    expect(results.length, "the missing request must trigger a persisted upgrade").to.equal(1);

    const serialized = harness.readLaunch().configurations[0];
    expect(serialized.request).to.equal("attach");

    // Idempotent: the upgraded profile passes hasMinContent and a second
    // run changes nothing.
    expect((await manager.ensureMinecraftDebugConfig(harness.project)).length).to.equal(0);
    expect(harness.readLaunch().configurations[0].request).to.equal("attach");
  });

  it("migrates the legacy targetedModuleUuid key without losing its value", async () => {
    // Prior MCT versions emitted targetedModuleUuid, which the official
    // extension neither declares nor reads - the UUID was silently ignored
    // and, with multiple scripted packs active, the extension still
    // prompted for a target. The value (which may differ from the project
    // default) must move to targetModuleUuid, and the dead key must be
    // absent from the serialized file.
    const legacyAuthoredUuid = "9e8d7c6b-5a49-4838-a726-151413121110";
    const harness = createUpdaterHarness({
      version: "0.3.0",
      configurations: [
        {
          type: "minecraft-js",
          name: "Debug with Minecraft",
          port: 19144,
          targetedModuleUuid: legacyAuthoredUuid,
        },
      ],
    });
    const manager = new VsCodeFileManager();

    const results = await manager.ensureMinecraftDebugConfig(harness.project);
    expect(results.length, "the legacy key must trigger a persisted migration").to.equal(1);

    const serialized = harness.readLaunch().configurations[0];
    expect(serialized.targetModuleUuid, "the legacy value must carry over, not the project default").to.equal(
      legacyAuthoredUuid
    );
    expect(serialized.targetedModuleUuid, "the unsupported alias must be absent after migration").to.be.undefined;

    // And the migration converges: a second pass changes nothing.
    expect((await manager.ensureMinecraftDebugConfig(harness.project)).length).to.equal(0);
  });

  it("drops the legacy key without overwriting an existing valid targetModuleUuid", async () => {
    const authoredUuid = "9e8d7c6b-5a49-4838-a726-151413121110";
    const harness = createUpdaterHarness({
      version: "0.3.0",
      configurations: [
        {
          type: "minecraft-js",
          name: "Debug with Minecraft",
          port: 19144,
          targetModuleUuid: authoredUuid,
          targetedModuleUuid: "cccccccc-1111-2222-3333-444444444444",
        },
      ],
    });
    const manager = new VsCodeFileManager();

    const results = await manager.ensureMinecraftDebugConfig(harness.project);
    expect(results.length, "removing the dead alias must persist").to.equal(1);

    const serialized = harness.readLaunch().configurations[0];
    expect(serialized.targetModuleUuid, "the existing valid value must win over the legacy one").to.equal(authoredUuid);
    expect(serialized.targetedModuleUuid).to.be.undefined;
  });
});

describe("randomizeAllUids launch-profile retargeting", () => {
  /**
   * ProjectUtilities.randomizeAllUids gives the default pack's script module
   * a new UUID. A managed launch profile whose targetModuleUuid was filled
   * from that module (the fill source is the MANIFEST's script module - see
   * getExpectedScriptModuleUuid) would otherwise keep targeting the retired
   * UUID: a nonexistent module, or the wrong pack when several scripted
   * packs are active. Randomization therefore retargets a managed profile
   * whose target equals the module's previous UUID, while a target pointing
   * anywhere else was authored deliberately and is preserved.
   */

  const initialScriptUuid = "3a5b7c92-4d6e-4f80-9a1b-2c3d4e5f6a7b";
  const bpHeaderUuid = "2b4c6d81-3c5d-4e7f-8901-6a5b4c3d2e1f";

  // randomizeAllUids generates uuids through the host crypto provider;
  // the standard test environment initializes CreatorToolsHost.
  before(async () => {
    await TestPaths.createTestEnvironment();
  });

  function createRandomizeHarness(launchJson: object, options?: { projectScriptUuidDiffers?: boolean }) {
    const makeFakeFile = (name: string, content: object) => {
      const fakeFile: any = {
        name: name,
        storageRelativePath: "/" + name,
        manager: undefined,
        content: JSON.stringify(content),
        isInErrorState: false,
        loadContent: async () => {},
        setObjectContentIfSemanticallyDifferent: (obj: object) => {
          const next = JSON.stringify(obj);
          const changed = JSON.stringify(JSON.parse(fakeFile.content)) !== next;
          fakeFile.content = next;
          return changed;
        },
        saveContent: async () => {},
      };
      return fakeFile;
    };

    const bpFile = makeFakeFile("manifest.json", {
      format_version: 2,
      header: {
        name: "test",
        description: "test",
        version: [0, 0, 1],
        min_engine_version: [1, 20, 10],
        uuid: bpHeaderUuid,
      },
      modules: [
        {
          type: "script",
          description: "test",
          version: [0, 0, 1],
          uuid: initialScriptUuid,
          language: "javascript",
        },
      ],
    });
    const launchFile = makeFakeFile("launch.json", launchJson);

    const items = [
      {
        itemType: ProjectItemType.behaviorPackManifestJson,
        storageType: ProjectItemStorageType.singleFile,
        isContentLoaded: true,
        loadContent: async () => {},
        primaryFile: bpFile,
      },
      {
        itemType: ProjectItemType.vsCodeLaunchJson,
        storageType: ProjectItemStorageType.singleFile,
        isContentLoaded: true,
        loadContent: async () => {},
        primaryFile: launchFile,
      },
    ];

    const fakeProject: any = {
      defaultBehaviorPackUniqueId: bpHeaderUuid,
      defaultResourcePackUniqueId: "5d7e9fa3-6e8f-4a92-b1c2-9d8e7f6a5b4c",
      defaultDataUniqueId: "6e8fa0b4-7f90-4ba3-82d3-8c7d6e5f4a3b",
      // The manifest is the launch profile's fill source; the project-level
      // default script uuid can drift from it (projectScriptUuidDiffers).
      defaultScriptModuleUniqueId: options?.projectScriptUuidDiffers
        ? "00000000-0000-4000-8000-000000000000"
        : initialScriptUuid,
      setDefaultResourcePackUniqueIdAndUpdateDependencies: async (uuid: string) => {
        fakeProject.defaultResourcePackUniqueId = uuid;
      },
      setDefaultBehaviorPackUniqueIdAndUpdateDependencies: async (uuid: string) => {
        fakeProject.defaultBehaviorPackUniqueId = uuid;
      },
      getItemsCopy: () => items,
      getDefaultBehaviorPack: async () => ({ manifest: await BehaviorManifestDefinition.ensureOnFile(bpFile) }),
      save: async () => {},
    };

    return {
      project: fakeProject as Project,
      readLaunch: () => JSON.parse(launchFile.content),
      getManifestScriptUuid: async () =>
        (await BehaviorManifestDefinition.ensureOnFile(bpFile))?.getScriptModule()?.uuid,
    };
  }

  it("retargets a managed profile filled from the default script module to the renamed module", async () => {
    const harness = createRandomizeHarness({
      version: "0.3.0",
      configurations: [
        {
          type: "minecraft-js",
          request: "attach",
          name: "Debug with Minecraft",
          port: 19144,
          targetModuleUuid: initialScriptUuid,
        },
      ],
    });

    await ProjectUtilities.randomizeAllUids(harness.project);

    const newScriptUuid = await harness.getManifestScriptUuid();
    expect(newScriptUuid, "randomization must give the script module a new uuid").to.not.equal(initialScriptUuid);

    const serialized = harness.readLaunch().configurations[0];
    expect(serialized.targetModuleUuid, "the serialized target must follow the renamed script module").to.equal(
      newScriptUuid
    );
  });

  it("preserves an authored target pointing at a different module", async () => {
    const authoredUuid = "aaaaaaaa-1111-2222-3333-444444444444";
    const harness = createRandomizeHarness({
      version: "0.3.0",
      configurations: [
        {
          type: "minecraft-js",
          request: "attach",
          name: "Debug with Minecraft",
          port: 19144,
          targetModuleUuid: authoredUuid,
        },
      ],
    });

    await ProjectUtilities.randomizeAllUids(harness.project);

    const serialized = harness.readLaunch().configurations[0];
    expect(serialized.targetModuleUuid, "a target pointing at another module was authored on purpose").to.equal(
      authoredUuid
    );
  });

  it("follows the manifest's script module even when the project default script uuid drifted", async () => {
    // The fill source is the manifest's script module, not
    // project.defaultScriptModuleUniqueId. When they differ, randomization
    // assigns the module a fresh random uuid (not the new project default) -
    // and the profile must follow the module's actual new uuid.
    const harness = createRandomizeHarness(
      {
        version: "0.3.0",
        configurations: [
          {
            type: "minecraft-js",
            request: "attach",
            name: "Debug with Minecraft",
            port: 19144,
            targetModuleUuid: initialScriptUuid,
          },
        ],
      },
      { projectScriptUuidDiffers: true }
    );

    await ProjectUtilities.randomizeAllUids(harness.project);

    const newScriptUuid = await harness.getManifestScriptUuid();
    expect(newScriptUuid).to.not.equal(initialScriptUuid);

    const serialized = harness.readLaunch().configurations[0];
    expect(serialized.targetModuleUuid).to.equal(newScriptUuid);
  });

  it("retargets through the legacy targetedModuleUuid key without resurrecting the stale uuid", async () => {
    const harness = createRandomizeHarness({
      version: "0.3.0",
      configurations: [
        {
          type: "minecraft-js",
          name: "Debug with Minecraft",
          port: 19144,
          targetedModuleUuid: initialScriptUuid,
        },
      ],
    });

    await ProjectUtilities.randomizeAllUids(harness.project);

    const newScriptUuid = await harness.getManifestScriptUuid();
    const serialized = harness.readLaunch().configurations[0];

    expect(
      serialized.targetModuleUuid,
      "the legacy-keyed target must follow the rename under the supported key"
    ).to.equal(newScriptUuid);
    expect(serialized.targetedModuleUuid, "the unsupported alias must not survive").to.be.undefined;
  });

  it("leaves a user-authored minecraft-js profile untouched", async () => {
    const harness = createRandomizeHarness({
      version: "0.3.0",
      configurations: [
        {
          type: "minecraft-js",
          request: "attach",
          name: "Debug my other pack",
          port: 19144,
          targetModuleUuid: initialScriptUuid,
        },
      ],
    });

    await ProjectUtilities.randomizeAllUids(harness.project);

    const serialized = harness.readLaunch().configurations[0];
    expect(
      serialized.targetModuleUuid,
      "only the MCT-managed profile is MCT's to retarget - a user-authored profile is not"
    ).to.equal(initialScriptUuid);
  });
});
