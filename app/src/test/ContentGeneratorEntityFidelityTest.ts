// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * ContentGeneratorEntityFidelityTest - Table-driven tests asserting that entity (mob)
 * fields in the content meta-schema are reflected in the generated Bedrock JSON:
 *
 * 1. drops[].chance / killedByPlayer / lootingBonus -> loot table pools & conditions
 * 2. spawning.timeOfDay / lightLevel -> minecraft:brightness_filter
 * 3. population_control derived from traits (monster / water_animal / animal)
 * 4. tameable / rideable / breedable config objects (and boolean shorthands) -> trait components
 * 5. User-specified components are merged into trait component groups instead of being replaced
 */

import { expect } from "chai";
import "mocha";
import { ContentGenerator, IGeneratedContent } from "../minecraft/ContentGenerator";
import { MinecraftContentSchema } from "../minecraft/ContentMetaSchemaZod";
import {
  IBlockTypeDefinition,
  IEntityTypeDefinition,
  IMinecraftContentDefinition,
  ISpawnRuleDefinition,
} from "../minecraft/IContentMetaSchema";
import TestPaths from "./TestPaths";

const NAMESPACE = "fid";

const PLAYER_FILTER = { test: "is_family", subject: "other", value: "player" };
const VILLAGER_FILTER = { test: "is_family", subject: "other", value: "villager" };

function makeDefinition(
  entityTypes: IEntityTypeDefinition[],
  extra: Partial<IMinecraftContentDefinition> = {}
): IMinecraftContentDefinition {
  return { schemaVersion: "1.0.0", namespace: NAMESPACE, entityTypes, ...extra };
}

/**
 * Validates with the Zod schema and generates from the parsed data, mirroring the
 * createMinecraftContent MCP tool.
 */
async function generate(definition: IMinecraftContentDefinition): Promise<IGeneratedContent> {
  const parsed = MinecraftContentSchema.safeParse(definition);
  expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues)).to.equal(true);
  return new ContentGenerator(parsed.data as IMinecraftContentDefinition).generate();
}

async function generateEntity(entity: IEntityTypeDefinition) {
  const result = await generate(makeDefinition([entity]));
  const behavior = result.entityBehaviors[0].content as any;
  return { result, entity: behavior["minecraft:entity"] };
}

function findComponent(entityJson: any, key: string): any {
  if (entityJson.components?.[key] !== undefined) {
    return entityJson.components[key];
  }
  for (const group of Object.values(entityJson.component_groups ?? {}) as any[]) {
    if (group?.[key] !== undefined) {
      return group[key];
    }
  }
  return undefined;
}

function brightnessOf(spawnRule: any): any {
  return spawnRule["minecraft:spawn_rules"].conditions[0]["minecraft:brightness_filter"];
}

describe("ContentGenerator entity fidelity", function () {
  this.timeout(20000);

  before(async function () {
    // Sets up CreatorToolsHost (UUIDs, PNG codecs) so this file can run on its own.
    await TestPaths.createTestEnvironment();
  });

  describe("drops -> loot table", function () {
    const cases: {
      name: string;
      drops: IEntityTypeDefinition["drops"];
      expectedPools: any[];
    }[] = [
      {
        name: "no chance -> unconditional pool",
        drops: [{ item: "bone" }],
        expectedPools: [{ rolls: 1, entries: [{ type: "item", name: "minecraft:bone", weight: 1 }] }],
      },
      {
        name: "chance 1 -> no random_chance condition",
        drops: [{ item: "bone", chance: 1 }],
        expectedPools: [{ rolls: 1, entries: [{ type: "item", name: "minecraft:bone", weight: 1 }] }],
      },
      {
        name: "chance < 1 -> random_chance condition",
        drops: [{ item: "emerald", chance: 0.25 }],
        expectedPools: [
          {
            rolls: 1,
            entries: [{ type: "item", name: "minecraft:emerald", weight: 1 }],
            conditions: [{ condition: "random_chance", chance: 0.25 }],
          },
        ],
      },
      {
        name: "killedByPlayer -> killed_by_player condition",
        drops: [{ item: "fid:trophy", killedByPlayer: true }],
        expectedPools: [
          {
            rolls: 1,
            entries: [{ type: "item", name: "fid:trophy", weight: 1 }],
            conditions: [{ condition: "killed_by_player" }],
          },
        ],
      },
      {
        name: "killedByPlayer + chance -> both conditions",
        drops: [{ item: "diamond", killedByPlayer: true, chance: 0.05 }],
        expectedPools: [
          {
            rolls: 1,
            entries: [{ type: "item", name: "minecraft:diamond", weight: 1 }],
            conditions: [{ condition: "killed_by_player" }, { condition: "random_chance", chance: 0.05 }],
          },
        ],
      },
      {
        name: "count + lootingBonus -> set_count + looting_enchant",
        drops: [{ item: "rotten_flesh", count: { min: 0, max: 2 }, lootingBonus: 1 }],
        expectedPools: [
          {
            rolls: 1,
            entries: [
              {
                type: "item",
                name: "minecraft:rotten_flesh",
                weight: 1,
                functions: [
                  { function: "set_count", count: { min: 0, max: 2 } },
                  { function: "looting_enchant", count: { min: 0, max: 1 } },
                ],
              },
            ],
          },
        ],
      },
      {
        name: "multiple drops -> one independent pool per drop",
        drops: [
          { item: "bone", count: 2 },
          { item: "arrow", chance: 0.5 },
        ],
        expectedPools: [
          {
            rolls: 1,
            entries: [
              { type: "item", name: "minecraft:bone", weight: 1, functions: [{ function: "set_count", count: 2 }] },
            ],
          },
          {
            rolls: 1,
            entries: [{ type: "item", name: "minecraft:arrow", weight: 1 }],
            conditions: [{ condition: "random_chance", chance: 0.5 }],
          },
        ],
      },
    ];

    for (const testCase of cases) {
      it(testCase.name, async function () {
        const { result, entity } = await generateEntity({
          id: "looter",
          displayName: "Looter",
          drops: testCase.drops,
        });

        expect(result.lootTables).to.have.length(1);
        expect(result.lootTables[0].path).to.equal("loot_tables/entities/looter.json");
        expect(JSON.parse(JSON.stringify(result.lootTables[0].content))).to.deep.equal({
          pools: testCase.expectedPools,
        });
        expect(entity.components["minecraft:loot"]).to.deep.equal({ table: "loot_tables/entities/looter.json" });
      });
    }

    const blockCases: {
      name: string;
      drops: IBlockTypeDefinition["drops"];
      expectedConditions: any;
      expectWarning: boolean;
    }[] = [
      {
        name: "block drop chance -> random_chance condition",
        drops: [{ item: "flint", chance: 0.1 }],
        expectedConditions: [{ condition: "random_chance", chance: 0.1 }],
        expectWarning: false,
      },
      {
        name: "block drop killedByPlayer is ignored with a warning",
        drops: [{ item: "flint", killedByPlayer: true }],
        expectedConditions: undefined,
        expectWarning: true,
      },
    ];

    for (const testCase of blockCases) {
      it(testCase.name, async function () {
        const result = await generate({
          schemaVersion: "1.0.0",
          namespace: NAMESPACE,
          blockTypes: [{ id: "gravelish", displayName: "Gravelish", drops: testCase.drops }],
        });

        const lootTable = result.lootTables.find((l) => l.path === "loot_tables/blocks/gravelish.json");
        expect(lootTable, "block loot table").to.not.be.undefined;
        const pools = (lootTable!.content as any).pools;
        expect(pools).to.have.length(1);
        expect(pools[0].conditions).to.deep.equal(testCase.expectedConditions);

        const hasWarning = result.summary.warnings.some((w) => w.includes("killedByPlayer"));
        expect(hasWarning).to.equal(testCase.expectWarning);
      });
    }

    it("explicit loot table entries honor chance and killedByPlayer", async function () {
      const result = await generate({
        schemaVersion: "1.0.0",
        namespace: NAMESPACE,
        lootTables: [
          {
            id: "entities/boss_bonus",
            pools: [
              {
                rolls: 1,
                entries: [
                  { item: "nether_star", chance: 0.2, killedByPlayer: true },
                  { item: "gold_ingot", weight: 3 },
                ],
              },
            ],
          },
        ],
      });

      const entries = JSON.parse(JSON.stringify(result.lootTables[0].content)).pools[0].entries;
      expect(entries).to.deep.equal([
        {
          type: "item",
          name: "minecraft:nether_star",
          weight: 1,
          conditions: [{ condition: "killed_by_player" }, { condition: "random_chance", chance: 0.2 }],
        },
        { type: "item", name: "minecraft:gold_ingot", weight: 3 },
      ]);
    });
  });

  describe("spawning.timeOfDay / lightLevel -> brightness_filter", function () {
    const cases: {
      name: string;
      spawning: IEntityTypeDefinition["spawning"];
      expected: any;
    }[] = [
      {
        name: "night -> dark brightness filter adjusted for weather",
        spawning: { timeOfDay: "night" },
        expected: { min: 0, max: 7, adjust_for_weather: true },
      },
      {
        name: "day -> bright brightness filter",
        spawning: { timeOfDay: "day" },
        expected: { min: 7, max: 15, adjust_for_weather: false },
      },
      { name: "any -> no brightness filter", spawning: { timeOfDay: "any" }, expected: undefined },
      { name: "unset -> no brightness filter", spawning: { weight: 5 }, expected: undefined },
      {
        name: "night + lightLevel.max -> explicit bound wins, night fills the rest",
        spawning: { timeOfDay: "night", lightLevel: { max: 4 } },
        expected: { min: 0, max: 4, adjust_for_weather: true },
      },
      {
        name: "lightLevel only -> honors explicit zero bounds",
        spawning: { lightLevel: { min: 0, max: 0 } },
        expected: { min: 0, max: 0, adjust_for_weather: true },
      },
    ];

    for (const testCase of cases) {
      it(`inline: ${testCase.name}`, async function () {
        const { result } = await generateEntity({
          id: "spawner",
          displayName: "Spawner",
          spawning: testCase.spawning,
        });

        expect(result.spawnRules).to.have.length(1);
        expect(brightnessOf(result.spawnRules[0].content)).to.deep.equal(testCase.expected);
      });

      it(`top-level spawnRules: ${testCase.name}`, async function () {
        const spawnRule: ISpawnRuleDefinition = { entity: "minecraft:zombie", ...testCase.spawning };
        const result = await generate({ schemaVersion: "1.0.0", namespace: NAMESPACE, spawnRules: [spawnRule] });

        expect(result.spawnRules).to.have.length(1);
        expect(brightnessOf(result.spawnRules[0].content)).to.deep.equal(testCase.expected);
      });
    }
  });

  describe("population_control", function () {
    const cases: {
      name: string;
      entity: Partial<IEntityTypeDefinition>;
      expected: string;
    }[] = [
      { name: "no traits -> animal", entity: {}, expected: "animal" },
      { name: "passive -> animal", entity: { traits: ["quadruped", "passive"] }, expected: "animal" },
      { name: "hostile -> monster", entity: { traits: ["humanoid", "hostile"] }, expected: "monster" },
      { name: "undead -> monster", entity: { traits: ["humanoid", "undead"] }, expected: "monster" },
      { name: "exploder -> monster", entity: { traits: ["exploder"] }, expected: "monster" },
      { name: "hostile flag -> monster", entity: { hostile: true }, expected: "monster" },
      { name: "monster family -> monster", entity: { families: ["monster", "mob"] }, expected: "monster" },
      { name: "aquatic -> water_animal", entity: { traits: ["aquatic", "passive"] }, expected: "water_animal" },
      { name: "aquatic + hostile -> monster", entity: { traits: ["aquatic", "hostile"] }, expected: "monster" },
    ];

    for (const testCase of cases) {
      it(`inline: ${testCase.name}`, async function () {
        const { result } = await generateEntity({
          id: "pop_mob",
          displayName: "Pop Mob",
          ...testCase.entity,
          spawning: { weight: 10 },
        });

        const description = (result.spawnRules[0].content as any)["minecraft:spawn_rules"].description;
        expect(description.identifier).to.equal(`${NAMESPACE}:pop_mob`);
        expect(description.population_control).to.equal(testCase.expected);
      });

      it(`top-level spawnRules: ${testCase.name}`, async function () {
        const result = await generate(
          makeDefinition([{ id: "pop_mob", displayName: "Pop Mob", ...testCase.entity }], {
            spawnRules: [{ entity: "pop_mob", weight: 10 }],
          })
        );

        const description = (result.spawnRules[0].content as any)["minecraft:spawn_rules"].description;
        expect(description.identifier).to.equal(`${NAMESPACE}:pop_mob`);
        expect(description.population_control).to.equal(testCase.expected);
      });
    }

    it("top-level spawn rule for an entity outside the definition defaults to animal", async function () {
      const result = await generate({
        schemaVersion: "1.0.0",
        namespace: NAMESPACE,
        spawnRules: [{ entity: "minecraft:cow", weight: 5 }],
      });

      const description = (result.spawnRules[0].content as any)["minecraft:spawn_rules"].description;
      expect(description.population_control).to.equal("animal");
    });
  });

  describe("tameable / rideable / breedable configuration", function () {
    const fullId = `${NAMESPACE}:critter`;

    const cases: {
      name: string;
      entity: Partial<IEntityTypeDefinition>;
      expect: Record<string, any>;
      absent?: string[];
    }[] = [
      {
        name: "tameable config -> tame items and probability",
        entity: { traits: ["tameable"], tameable: { tameItems: ["cod", "salmon"], chance: 0.5 } },
        expect: {
          "minecraft:tameable": {
            probability: 0.5,
            tame_items: ["cod", "salmon"],
            tame_event: { event: "on_tame", target: "self" },
          },
        },
      },
      {
        name: "tameable config without the trait -> trait applied",
        entity: { tameable: { tameItems: ["cod"] } },
        expect: {
          "minecraft:tameable": {
            probability: 0.33,
            tame_items: ["cod"],
            tame_event: { event: "on_tame", target: "self" },
          },
        },
      },
      {
        name: "tameable: true -> default bone taming",
        entity: { tameable: true },
        expect: {
          "minecraft:tameable": {
            probability: 0.33,
            tame_items: ["bone"],
            tame_event: { event: "on_tame", target: "self" },
          },
        },
      },
      {
        name: "breedable config -> breed items, cooldown, and own identifier as mate/baby",
        entity: { traits: ["breedable"], breedable: { breedItems: ["apple", "golden_carrot"], breedCooldown: 300 } },
        expect: {
          "minecraft:breedable": {
            require_tame: false,
            breed_items: ["apple", "golden_carrot"],
            breeds_with: { mate_type: fullId, baby_type: fullId },
            breed_cooldown: 300,
          },
          "minecraft:behavior.breed": { priority: 3, speed_multiplier: 1.0 },
        },
      },
      {
        name: "breedable: true -> default wheat, own identifier as mate/baby",
        entity: { breedable: true },
        expect: {
          "minecraft:breedable": {
            require_tame: false,
            breed_items: ["wheat"],
            breeds_with: { mate_type: fullId, baby_type: fullId },
          },
        },
      },
      {
        name: "rideable config -> seats, item control",
        entity: {
          traits: ["rideable"],
          rideable: { seatCount: 2, controllable: true, controlItems: ["carrot_on_a_stick"] },
        },
        expect: {
          "minecraft:rideable": {
            seat_count: 2,
            family_types: ["player"],
            interact_text: "action.interact.ride.horse",
            seats: [{ position: [0.0, 1.1, 0.1] }, { position: [0.0, 1.1, -0.5] }],
          },
          "minecraft:item_controllable": { control_items: ["carrot_on_a_stick"] },
          "minecraft:behavior.controlled_by_player": { priority: 0 },
        },
        absent: ["minecraft:input_ground_controlled"],
      },
      {
        name: "rideable controllable:false -> no rider control",
        entity: { rideable: { controllable: false } },
        expect: {
          "minecraft:rideable": {
            seat_count: 1,
            family_types: ["player"],
            interact_text: "action.interact.ride.horse",
            seats: [{ position: [0.0, 1.1, -0.2] }],
          },
        },
        absent: [
          "minecraft:input_ground_controlled",
          "minecraft:item_controllable",
          "minecraft:behavior.controlled_by_player",
        ],
      },
      {
        name: "rideable: true -> single seat, ground controlled",
        entity: { rideable: true },
        expect: {
          "minecraft:rideable": {
            seat_count: 1,
            family_types: ["player"],
            interact_text: "action.interact.ride.horse",
            seats: [{ position: [0.0, 1.1, -0.2] }],
          },
          "minecraft:input_ground_controlled": {},
        },
        absent: ["minecraft:item_controllable"],
      },
    ];

    for (const testCase of cases) {
      it(testCase.name, async function () {
        const { entity } = await generateEntity({ id: "critter", displayName: "Critter", ...testCase.entity });

        for (const [key, value] of Object.entries(testCase.expect)) {
          expect(findComponent(entity, key), key).to.deep.equal(value);
        }
        for (const key of testCase.absent ?? []) {
          expect(findComponent(entity, key), key).to.be.undefined;
        }
      });
    }

    it("legacy top-level tameItems/tameChance are still honored by the direct API", async function () {
      const legacyEntity = {
        id: "critter",
        displayName: "Critter",
        traits: ["tameable"],
        tameItems: ["carrot"],
        tameChance: 0.9,
      };
      const result = await new ContentGenerator(makeDefinition([legacyEntity as IEntityTypeDefinition])).generate();
      const entity = (result.entityBehaviors[0].content as any)["minecraft:entity"];

      expect(entity.components["minecraft:tameable"]).to.deep.equal({
        probability: 0.9,
        tame_items: ["carrot"],
        tame_event: { event: "on_tame", target: "self" },
      });
    });
  });

  describe("user components vs trait component groups", function () {
    const villagerTarget = { filters: VILLAGER_FILTER, max_dist: 20 };

    const cases: {
      name: string;
      entity: Partial<IEntityTypeDefinition>;
      group: string;
      component: string;
      expected: any;
    }[] = [
      {
        name: "hostile + user nearest_attackable_target -> user targets merged into hostile_angry",
        entity: {
          traits: ["hostile"],
          components: {
            "minecraft:behavior.nearest_attackable_target": { priority: 1, entity_types: [villagerTarget] },
          },
        },
        group: "hostile_angry",
        component: "minecraft:behavior.nearest_attackable_target",
        expected: {
          priority: 1,
          must_see: true,
          reselect_targets: true,
          entity_types: [{ filters: PLAYER_FILTER, max_dist: 35 }, villagerTarget],
        },
      },
      {
        name: "hostile + single-object entity_types -> normalized and merged",
        entity: {
          traits: ["hostile"],
          components: {
            "minecraft:behavior.nearest_attackable_target": { entity_types: villagerTarget },
          },
        },
        group: "hostile_angry",
        component: "minecraft:behavior.nearest_attackable_target",
        expected: {
          priority: 2,
          must_see: true,
          reselect_targets: true,
          entity_types: [{ filters: PLAYER_FILTER, max_dist: 35 }, villagerTarget],
        },
      },
      {
        name: "hostile + target_players preset -> same filter combined, not duplicated",
        entity: { traits: ["hostile"], behaviors: ["target_players"] },
        group: "hostile_angry",
        component: "minecraft:behavior.nearest_attackable_target",
        expected: {
          priority: 2,
          must_see: true,
          reselect_targets: true,
          entity_types: [{ filters: PLAYER_FILTER, max_dist: 35 }],
        },
      },
      {
        name: "hostile + target_monsters preset -> monster target kept in hostile_angry",
        entity: { traits: ["hostile"], behaviors: ["target_monsters"] },
        group: "hostile_angry",
        component: "minecraft:behavior.nearest_attackable_target",
        expected: {
          priority: 2,
          must_see: true,
          reselect_targets: true,
          entity_types: [
            { filters: PLAYER_FILTER, max_dist: 35 },
            { filters: { test: "is_family", subject: "other", value: "monster" } },
          ],
        },
      },
      {
        name: "exploder + user nearest_attackable_target -> merged into exploder_idle",
        entity: {
          traits: ["exploder"],
          components: {
            "minecraft:behavior.nearest_attackable_target": { entity_types: [villagerTarget] },
          },
        },
        group: "exploder_idle",
        component: "minecraft:behavior.nearest_attackable_target",
        expected: {
          priority: 1,
          entity_types: [{ filters: PLAYER_FILTER, max_dist: 25 }, villagerTarget],
        },
      },
      {
        name: "non-targeting components keep the trait group's value (hostile_calm random_stroll)",
        entity: {
          traits: ["hostile"],
          components: { "minecraft:behavior.random_stroll": { priority: 3, speed_multiplier: 0.8 } },
        },
        group: "hostile_calm",
        component: "minecraft:behavior.random_stroll",
        expected: { priority: 6, speed_multiplier: 1.0 },
      },
      {
        name: "baby_variant keeps its per-state scale when the user sets a base scale",
        entity: { traits: ["baby_variant"], components: { "minecraft:scale": { value: 1.5 } } },
        group: "baby",
        component: "minecraft:scale",
        expected: { value: 0.5 },
      },
      {
        name: "boss keeps its per-phase movement when the user sets a base movement",
        entity: { traits: ["boss"], components: { "minecraft:movement": { value: 0.3 } } },
        group: "phase_3",
        component: "minecraft:movement",
        expected: { value: 0.35 },
      },
      {
        name: "exploder keeps its fuse-lit charge when the melee_attack preset is used",
        entity: { traits: ["exploder"], behaviors: ["melee_attack"] },
        group: "exploder_fuse_lit",
        component: "minecraft:behavior.melee_attack",
        expected: { priority: 2, speed_multiplier: 1.5, track_target: true, reach_multiplier: 0.0 },
      },
      {
        name: "user-defined component group replaces the trait group as-is",
        entity: {
          traits: ["hostile"],
          components: {
            "minecraft:behavior.nearest_attackable_target": { entity_types: [villagerTarget] },
          },
          componentGroups: {
            hostile_angry: {
              "minecraft:behavior.nearest_attackable_target": { priority: 5, entity_types: [villagerTarget] },
            },
          },
        },
        group: "hostile_angry",
        component: "minecraft:behavior.nearest_attackable_target",
        expected: { priority: 5, entity_types: [villagerTarget] },
      },
    ];

    for (const testCase of cases) {
      it(testCase.name, async function () {
        const { entity } = await generateEntity({ id: "brute", displayName: "Brute", ...testCase.entity });

        expect(entity.component_groups?.[testCase.group]?.[testCase.component]).to.deep.equal(testCase.expected);

        const userComponent = (testCase.entity.components as any)?.[testCase.component];
        if (userComponent) {
          expect(entity.components[testCase.component], "base component stays as the user wrote it").to.deep.equal(
            userComponent
          );
        }
      });
    }

    it("does not leak merged user components across entities", async function () {
      const result = await generate(
        makeDefinition([
          {
            id: "villager_hunter",
            displayName: "Villager Hunter",
            traits: ["hostile"],
            components: {
              "minecraft:behavior.nearest_attackable_target": { entity_types: [villagerTarget] },
            },
          },
          { id: "plain_hostile", displayName: "Plain Hostile", traits: ["hostile"] },
        ])
      );

      const plain = (result.entityBehaviors[1].content as any)["minecraft:entity"];
      expect(
        plain.component_groups.hostile_angry["minecraft:behavior.nearest_attackable_target"].entity_types
      ).to.deep.equal([{ filters: PLAYER_FILTER, max_dist: 35 }]);
    });
  });
});
