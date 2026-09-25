# Agent plugin and skills

_Last revised: 2026-09-24_

The `minecraft` agent plugin packages Agent Skills together with the Minecraft Creator Tools MCP server (`npx -y @minecraft/creator-tools mcp`), so coding agents can create and debug Bedrock add-ons. The user-facing index is [plugins/minecraft/README.md](../plugins/minecraft/README.md).

## Layout

One plugin folder serves every client. Each client reads a different manifest, and none of them load the others' files.

| Path                                           | Read by                                | Purpose                                                                                                        |
| ---------------------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `plugins/minecraft/plugin.json`                | Codex, Copilot CLI                     | [Agent Plugins 1.0](https://agent-plugins.org) manifest. `extensions.com.openai` holds Codex display metadata. |
| `plugins/minecraft/mcp.json`                   | Codex, Copilot CLI                     | Agent Plugins MCP config (`type: "stdio"`).                                                                    |
| `plugins/minecraft/.claude-plugin/plugin.json` | Claude Code                            | Claude Code manifest.                                                                                          |
| `plugins/minecraft/.mcp.json`                  | Claude Code                            | Claude Code MCP config. Keep it in sync with `mcp.json`.                                                       |
| `plugins/minecraft/skills/<name>/SKILL.md`     | All clients, and `npx skills add`      | The skills. Names must be lowercase and hyphenated, and match the folder.                                      |
| `.claude-plugin/marketplace.json`              | Claude Code, Copilot CLI, `npx skills` | Marketplace listing the plugin.                                                                                |
| `.agents/plugins/marketplace.json`             | Codex                                  | Codex repo marketplace listing the plugin.                                                                     |
| `plugins/evals/`                               | Maintainers                            | Eval prompts and fixtures (not installed).                                                                     |

Manifests deliberately omit `version`, so clients track the latest commit instead of pinning users to an old copy.

## Pinned Creator Tools version

The MCP configs, scripts, and skill commands all run `@minecraft/creator-tools@0.17.8`, the version the skills were tested against. The skills include workarounds for that version's bugs, so running a newer package with them could apply fixes that are no longer needed or miss new behavior.

To move to a new release:

1. Replace `@minecraft/creator-tools@0.17.8` everywhere under `plugins/minecraft/`.
2. Remove workarounds for bugs the release fixed (listed below), and update the "as of Creator Tools" notes in the skills.
3. Run the evals in `plugins/evals` before merging.

## Skills and their bundled scripts

- `create-mob`, `create-item`, `create-block`: translate requests into a `createMinecraftContent` definition, then check and finish the output. They also cover changing existing content by editing JSON directly.
- `design-model`: `getModelTemplates`, `designModel`, and the image-writing tools.
- `debug-addon`: validation, fixes, Content Log help, upgrades, and packaging. Its `scripts/` folder is shared by the other skills:
  - `validate-summary.mjs` runs `mct validate --json --force` with reports sent to a temporary folder, removes passing checks and duplicates, separates known false positives, and adds a pack-dependency check the CLI lacks (`PACKDEP`).
  - `make-pack-icon.mjs` writes a square placeholder `pack_icon.png`.
  - `add-missing-names.mjs` adds `texts/en_US.lang` entries and item `minecraft:display_name` components.

Scripts use only Node.js built-ins, because users have Node for `npx` anyway.

## Creator Tools gaps the skills work around (0.17.x)

These were found while testing the skills against the published package. Each workaround should be removed from the skills once the product is fixed.

- `mct validate` writes report files to `./out` in the current directory and reuses them as a cache (keyed by project folder name) unless `--force` is passed. `--json` overrides `--ot noreports`, so the reports can't be turned off; the summary script sends them to a temporary folder with `-o`.
- `createMinecraftContent` doesn't write pack icons or localization, ignores `drops[].chance` and `spawning.timeOfDay`, always uses `population_control: animal`, doesn't wire block loot tables, doesn't create armor attachables, writes scatter features in an older layout that validation flags, and silently drops unknown fields (including malformed `features`). Running it again doesn't update existing files. Adding content to an existing project resets manifest names and points the behavior pack's resource pack dependency at a new, non-existent UUID.
- Entity `tameable`, `rideable`, and `breedable` configuration objects are ignored (traits always use bone, wheat, and a saddle), and `breeds_with` is written with `self` instead of the entity's identifier.
- Items: `minecraft:food` is written with `effects` (not supported in current item formats) and `saturation_modifier: "custom"`; `tool.miningLevel` is ignored; bows and crossbows only shoot when `projectile` is set.
- World generation: `spread` only produces complete features for ores; other placement types reference a feature that's never written, `scatter` is ignored, count ranges use only `max`, and heights of 0 are replaced by defaults.
- `designModel` doesn't wire models to any content. The geometry is named from `design.identifier` (templates use placeholders such as `custom_humanoid`), not `modelId`, and mobs created by `createMinecraftContent` refer to `geometry.<namespace>.<id>`. Block and held-item models aren't supported by the skills for this reason. It also saves designs under a placeholder-named folder (`design_packs/contoso_mob_dp/`).
- `mct fix setnewestformatversions` can report `updatedCount: 0` without changing anything.
- Image-writing MCP tools reject paths that pass through a symlink (such as `/tmp` on macOS).
- There's no CLI equivalent of `createMinecraftContent`, so the create skills need the MCP server.

## Changing a skill

1. Edit the `SKILL.md` or reference file. Keep `SKILL.md` short; put details in `references/`.
2. Run the skill's evals in `plugins/evals` (see its README) and compare with the previous version.
3. If you change a description, rerun that skill's trigger evals, and check that sibling skills' trigger evals still pass.
