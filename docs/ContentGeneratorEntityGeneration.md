# Content Generator: Entity Generation Mapping

_Last revised: 2026-09-25_

`ContentGenerator` (`app/src/minecraft/ContentGenerator.ts`) turns the simplified content
meta-schema (`IContentMetaSchema.ts` / `ContentMetaSchemaZod.ts`, used by the
`createMinecraftContent` MCP tool) into Bedrock behavior/resource pack JSON. This note covers how
entity (mob) fields map to native JSON, so generated mobs behave the way the definition describes.

Tests: `app/src/test/ContentGeneratorEntityFidelityTest.ts` (table-driven) and the baselines in
`app/test/scenarios/contentGenerator/`.

## Precedence

Base components are assembled in this order, later wins per component key:

1. Default components (physics, collision box, movement, ...)
2. Traits (`entity.traits`, plus shorthand traits below), in listed order
3. Behavior presets (`entity.behaviors`)
4. Simplified properties (`health`, `attackDamage`, `scale`, ...)
5. Native `entity.components`

Trait **component groups** (for example `hostile_angry`, added on `minecraft:entity_spawned`)
replace same-named base components at runtime. When the user specifies (via `behaviors` or
`components`) a **targeting** component that a trait group also defines, and both define
`entity_types` (for example `minecraft:behavior.nearest_attackable_target` or
`minecraft:behavior.avoid_mob_type`), the user's value is merged into that group:

- Object fields are shallow-merged with the user's fields winning.
- `entity_types` lists are unioned. Entries with identical `filters` are combined (user fields
  win); other entries are appended. For example, a `hostile` mob with a user
  `nearest_attackable_target` for villagers targets both players (from the trait) and villagers.

Other components in trait groups are left as the trait defines them. Some traits deliberately use
different values per state, such as `baby_variant` (`baby`/`adult` scale), `boss` (per-phase
movement and scale), and `exploder` (fuse-lit `melee_attack`), and a single base value must not
flatten them.

User-supplied `entity.componentGroups` replace a trait group with the same name as-is.

## Shorthand traits and trait configuration

`tameable`, `rideable`, and `breedable` accept `true` or a config object. Either form applies the
matching trait if it is not already in `traits`. Config objects are passed to the trait:

| Field                                              | Trait config                   | Output                                                                                                                     |
| -------------------------------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `tameable.tameItems` / `tameable.chance`           | `tameItems` / `tameChance`     | `minecraft:tameable.tame_items` / `probability` (defaults: `["bone"]`, `0.33`)                                             |
| `rideable.seatCount`                               | `seatCount`                    | `minecraft:rideable.seat_count`, plus one `seats` entry per rider                                                          |
| `rideable.controllable`                            | `controllable`                 | `false` omits rider control components                                                                                     |
| `rideable.controlItems`                            | `controlItems`                 | `minecraft:item_controllable` + `minecraft:behavior.controlled_by_player` (instead of `minecraft:input_ground_controlled`) |
| `breedable.breedItems` / `breedable.breedCooldown` | `breedItems` / `breedCooldown` | `minecraft:breedable.breed_items` / `breed_cooldown` (default items: `["wheat"]`)                                          |

The breedable trait sets `breeds_with.mate_type` / `baby_type` to the entity's own identifier and
adds `minecraft:behavior.breed` so mates path to each other. Legacy top-level `tameItems` /
`tameChance` on the entity are still honored when calling the generator directly.

## Drops

Each `drops[]` entry becomes its own loot pool (`rolls: 1`) so drops roll independently, as
vanilla loot tables do:

- `chance < 1` adds `{ "condition": "random_chance", "chance": x }`.
- `killedByPlayer` adds `{ "condition": "killed_by_player" }` for entity loot. Block loot has no
  killer, so it is ignored with a warning for blocks.
- `count` becomes `set_count`; `lootingBonus` becomes `looting_enchant` with `count: { min: 0, max: n }`.

Explicit `lootTables[].pools[].entries[]` honor `chance` / `killedByPlayer` as entry-level
conditions.

## Spawn rules

- **`timeOfDay`**: spawn rules have no time condition, so this maps to a
  `minecraft:brightness_filter` like vanilla: `night` = `{ min: 0, max: 7, adjust_for_weather: true }`
  (zombie), `day` = `{ min: 7, max: 15, adjust_for_weather: false }` (cow), and `any` adds nothing.
  Any bound set in `lightLevel` takes precedence.
- **`population_control`** is derived from the entity, for both inline `spawning` and top-level
  `spawnRules` that reference an entity in the same definition:
  - `monster`: `hostile`, `undead`, `illager`, or `exploder` trait, `hostile: true`, or a
    `monster` family. This takes priority over aquatic, as with drowned and guardians.
  - `water_animal`: `aquatic` or `aquatic_only` trait.
  - `animal`: everything else, including entities not in the definition.
