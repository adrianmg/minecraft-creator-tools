# Content Generator: Items, Blocks, and World Generation

_Last revised: 2026-09-25_

`ContentGenerator` (`app/src/minecraft/ContentGenerator.ts`) turns the simplified meta-schema used by the
`createMinecraftContent` MCP tool, the `mct add` wizard, and the web content wizard into native Bedrock files.
This note records what it emits for items, blocks, and feature spreads, and why.

## Items

| Input                                                                          | Output                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `food`                                                                         | `minecraft:food` with `nutrition`, numeric `saturation_modifier` (default 0.6), `can_always_eat`; plus `minecraft:use_modifiers` (`use_duration` 1.6) and `minecraft:use_animation: "eat"`, which food needs to be edible.                                                                                                                                                                                 |
| `food.effects`                                                                 | Not emitted — `minecraft:food` has no effects field. A warning tells the caller to apply them from a script (e.g. `world.afterEvents.itemCompleteUse`).                                                                                                                                                                                                                                                    |
| `pickaxe` / `axe` / `shovel` / `hoe` + `tool.miningLevel`                      | `minecraft:digger` targeting `minecraft:is_<tool>_item_destructible` at the vanilla tier speed (wood 2, stone 4, iron 6, diamond 8, netherite 9; default iron), and `minecraft:tags` with `minecraft:is_<tool>`, `minecraft:is_tool`, `minecraft:digger`, and the tier tag (e.g. `minecraft:iron_tier`) so tier-gated vanilla blocks drop. `tool.miningSpeed` overrides the speed (rounded to an integer). |
| `sword`                                                                        | Adds `minecraft:is_sword`, `minecraft:is_tool`, and the tier tag.                                                                                                                                                                                                                                                                                                                                          |
| `bow` / `crossbow`                                                             | A working `minecraft:shooter` (arrow ammunition; crossbows `charge_on_draw`) plus the `minecraft:use_modifiers` the shooter requires. `projectile.projectile` replaces the ammunition item. `minecraft:chargeable` and `minecraft:use_duration` are not used (removed in format 1.20.50).                                                                                                                  |
| Armor (`armor_*` traits, `armor`, or a native `minecraft:wearable` armor slot) | Protection on `minecraft:wearable.protection`, a resource-pack `attachables/<id>.json` mirroring vanilla armor attachables, and a 64x32 layer texture at `textures/models/armor/<namespace>_<material>_1.png` (`_2` for leggings). `<material>` is the item id without its `_helmet`/`_chestplate`/`_leggings`/`_boots` suffix, so a set shares textures.                                                  |

Tool tiers live in `app/src/minecraft/traits/ToolTiers.ts`. `TraitDetector` recognizes this output when inferring a
definition back from JSON (pickaxes aren't matched as axes; crossbows are detected by `charge_on_draw`).

## Blocks

Blocks with `drops` get `"minecraft:loot": "loot_tables/blocks/<id>.json"`; without it a block drops itself.
A native `minecraft:loot` in `components` still wins.

## Feature spreads

A spread becomes `feature_rules/<id>.json` → `features/<id>_scatter.json` → `features/<id>_placed.json`.
Identifiers always match file names (Bedrock requires this).

- The scatter feature uses the current layout (format 1.21.20): `iterations`, `scatter_chance`, `x`/`y`/`z`, and
  `coordinate_eval_order` are nested under `distribution`. X/Z default to `uniform [0, 15]`.
- `count` `{min, max}` becomes `math.random_integer(min, max)`; `rarity` N becomes `scatter_chance` 1/N.
- Placement types: `ore` → `minecraft:ore_feature`; `block` / `vegetation` → `minecraft:single_block_feature`
  (vegetation must sit on grass/dirt); `structure` → `minecraft:structure_template_feature` (bare names map to
  `mystructure:<name>`). Several placements are combined with `minecraft:aggregate_feature`. `tree` is skipped with
  a warning — use `nativeFeature` with `minecraft:tree_feature`.
- `heightPlacement` defaults to underground for ore and surface otherwise; surface uses `surface_pass` and
  `q.heightmap(v.worldx, v.worldz)`. Explicit zeros (fixed `y: 0`, range bounds of 0) are preserved.
- `scatter.type`: `uniform` (default), `cluster` (random center, gaussian ±radius), `line` (`fixed_grid` along x).

## Writing files

`ContentWriter` (CLI `add` and the web wizards) writes every generated file at its pack-relative path, so nested
paths such as `loot_tables/blocks/`, `textures/models/armor/`, `attachables/`, and `features/` match the references
above. The MCP server writes the same paths directly.

Tests: `app/src/test/ContentGeneratorFidelityTest.ts`.
