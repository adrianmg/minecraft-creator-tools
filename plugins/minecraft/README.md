# Minecraft plugin for AI coding agents

Skills and the [Minecraft Creator Tools](https://aka.ms/mcthomepage) MCP server, packaged for Claude Code, GitHub Copilot CLI, and Codex. Ask your agent for what you want to make ("create a hostile swamp goblin", "why won't my add-on load?") and the skills handle the Bedrock Edition details: which files to create, how they connect, and how to check the result.

The MCP server gives the agent tools (create content, validate, design models). The skills teach it how to use them for common Minecraft tasks.

## Skills

| Skill                                          | What it does                                                                                                           | Try asking                                                                                    |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| [`create-mob`](skills/create-mob/SKILL.md)     | Creates a new mob or changes an existing one: health, attacks, AI behavior, taming, riding, drops, and spawning.       | "Make a rideable red panda." "Make my goblin scared of zombies."                              |
| [`create-item`](skills/create-item/SKILL.md)   | Creates or changes weapons, tools, food, armor, throwables, and crafting recipes.                                      | "Add a magic hammer that mines like an iron pickaxe." "Create ruby armor."                    |
| [`create-block`](skills/create-block/SKILL.md) | Creates or changes blocks: light, mining time, drops, facing direction, and ore generation.                            | "Make a glowing mushroom block you can harvest." "Add a ruby ore that generates underground." |
| [`design-model`](skills/design-model/SKILL.md) | Designs 3D models and textures for mobs, and draws pixel-art item icons and block textures.                            | "Make my beetle look like a beetle." "Draw a purple hammer icon."                             |
| [`debug-addon`](skills/debug-addon/SKILL.md)   | Validates an add-on, fixes what's wrong, explains Content Log errors, upgrades old add-ons, and packages a `.mcaddon`. | "Why won't my add-on load?" "Package my add-on to share."                                     |

All skills target Minecraft: Bedrock Edition add-ons (behavior packs and resource packs), not Java Edition.

## Install

Requires Node.js 22 or later. The first run downloads [`@minecraft/creator-tools`](https://aka.ms/mctnpm) through `npx`. The plugin pins the version its skills were tested with (currently 0.17.8), so the skills and the MCP server always match.

**Claude Code**

```
/plugin marketplace add Mojang/minecraft-creator-tools
/plugin install minecraft@minecraft-creator-tools
```

**GitHub Copilot CLI**

```bash
copilot plugin marketplace add Mojang/minecraft-creator-tools
copilot plugin install minecraft@minecraft-creator-tools
```

**Codex**

```bash
codex plugin marketplace add Mojang/minecraft-creator-tools
```

Then open `/plugins` in Codex and install **Minecraft**.

**Skills only (any agent that supports Agent Skills)**

```bash
npx skills add Mojang/minecraft-creator-tools
```

This installs the skills without the MCP server. The create and design skills need the server's tools, so also add it to your agent: command `npx`, arguments `-y @minecraft/creator-tools@0.17.8 mcp`. See [Using the MCP Server](../../app/jsnode/README.md#using-the-mcp-server-with-vs-code) for an example.

## Things to know

- **Minecraft EULA.** Validation, fixes, and packaging don't need it. Creating projects from Creator Tools templates does; accept it yourself with `npx @minecraft/creator-tools@0.17.8 eula`. The skills never accept it for you.
- **Trying content in game.** Deploying straight into Minecraft (`mct deploy`) works on Windows. On other platforms, `npx @minecraft/creator-tools@0.17.8 view -i <folder>` opens a browser preview, and `exportaddon` builds a `.mcaddon` you can open on any device with Minecraft.
- **Generator workarounds.** The create skills include steps that work around gaps in Creator Tools 0.17's content generator (missing names and pack icons, some ignored fields). These steps will be removed as the generator is fixed.

## Coming next

- `add-script`: gameplay with the Script API (events, custom components, "make this interactive").
- `override-vanilla`: safe changes to vanilla mobs, loot, recipes, and spawning.
- Later: structure design, and testing in game once there are tools to deploy and read the Content Log.

## For contributors

Skills follow the [Agent Skills](https://agentskills.io) format. Test prompts and trigger tests live in [`plugins/evals`](../evals/README.md). See [docs/AgentPluginAndSkills.md](../../docs/AgentPluginAndSkills.md) for how the plugin is laid out for each client.
