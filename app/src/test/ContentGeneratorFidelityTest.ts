// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * ContentGeneratorFidelityTest - Table-driven checks that ContentGenerator emits item, block, and
 * world-generation JSON matching current Bedrock formats:
 *
 * - Food: numeric saturation_modifier, no unsupported `effects`, edible via use_modifiers.
 * - Tools: miningLevel drives digger speed + vanilla tier/type tags.
 * - Bows/crossbows: working minecraft:shooter defaults (arrow ammunition) without `projectile`.
 * - Blocks: drops are wired through minecraft:loot.
 * - Armor: attachables + 64x32 armor layer textures so worn armor renders.
 * - Features: scatter params nested under `distribution`, every placement type resolves to a
 *   generated feature (or is skipped with a warning), and 0-valued bounds are preserved.
 */

import { expect } from "chai";
import "mocha";
import * as fs from "fs";
import * as path from "path";
import { ContentGenerator, IGeneratedContent, IGeneratedFile } from "../minecraft/ContentGenerator";
import {
  IBlockTypeDefinition,
  IFeatureSpread,
  IItemTypeDefinition,
  IMinecraftContentDefinition,
} from "../minecraft/IContentMetaSchema";
import TestPaths, { ITestEnvironment } from "./TestPaths";
import Project, { ProjectAutoDeploymentMode } from "../app/Project";
import ProjectInfoSet from "../info/ProjectInfoSet";
import { ProjectInfoSuite } from "../info/IProjectInfoData";
import { InfoItemType } from "../info/IInfoItemData";
import { ContentWriter } from "../minecraft/ContentWriter";
import TraitDetector from "../minecraft/TraitDetector";

function definition(partial: Partial<IMinecraftContentDefinition>): IMinecraftContentDefinition {
  return { schemaVersion: "1.0.0", namespace: "test", ...partial };
}

async function generate(partial: Partial<IMinecraftContentDefinition>): Promise<IGeneratedContent> {
  return new ContentGenerator(definition(partial)).generate();
}

async function generateItem(item: Partial<IItemTypeDefinition>) {
  const result = await generate({ itemTypes: [{ id: "thing", displayName: "Thing", ...item } as IItemTypeDefinition] });
  const components = (result.itemBehaviors[0].content as any)["minecraft:item"].components;
  return { result, components };
}

function fileContent(files: IGeneratedFile[], filePath: string): any {
  return files.find((f) => f.path === filePath)?.content;
}

function pngSize(png: Uint8Array): { width: number; height: number } {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

const ARROW_AMMUNITION = { use_offhand: true, search_inventory: true, use_in_creative: true };
const CHUNK_EXTENT = { distribution: "uniform", extent: [0, 15] };

describe("ContentGenerator fidelity", function () {
  this.timeout(20000);

  let env: ITestEnvironment;

  before(async function () {
    env = await TestPaths.createTestEnvironment();
  });

  // ==========================================================================
  // FOOD
  // ==========================================================================

  describe("food", function () {
    const cases: {
      name: string;
      item: Partial<IItemTypeDefinition>;
      expectedFood: object;
      expectsEffectsWarning?: boolean;
    }[] = [
      {
        name: "emits the requested saturation as a number",
        item: { food: { nutrition: 6, saturation: 1.2 } },
        expectedFood: { nutrition: 6, saturation_modifier: 1.2, can_always_eat: false },
      },
      {
        name: "defaults saturation to the vanilla 0.6",
        item: { food: { nutrition: 4 } },
        expectedFood: { nutrition: 4, saturation_modifier: 0.6, can_always_eat: false },
      },
      {
        name: "keeps a saturation of 0 and can_always_eat",
        item: { food: { nutrition: 1, saturation: 0, canAlwaysEat: true } },
        expectedFood: { nutrition: 1, saturation_modifier: 0, can_always_eat: true },
      },
      {
        name: "drops unsupported effects and warns",
        item: { food: { nutrition: 6, saturation: 1.2, effects: [{ name: "speed", duration: 30 }] } },
        expectedFood: { nutrition: 6, saturation_modifier: 1.2, can_always_eat: false },
        expectsEffectsWarning: true,
      },
      {
        name: "food trait alone is edible",
        item: { traits: ["food"] },
        expectedFood: { nutrition: 4, saturation_modifier: 0.6, can_always_eat: false },
      },
      {
        name: "food trait uses food.saturation",
        item: { traits: ["food"], food: { nutrition: 8, saturation: 0.8 } },
        expectedFood: { nutrition: 8, saturation_modifier: 0.8, can_always_eat: false },
      },
    ];

    for (const c of cases) {
      it(c.name, async function () {
        const { result, components } = await generateItem(c.item);

        expect(components["minecraft:food"]).to.deep.equal(c.expectedFood);
        expect(components["minecraft:use_modifiers"]).to.deep.equal({ use_duration: 1.6, movement_modifier: 0.35 });
        expect(components["minecraft:use_animation"]).to.equal("eat");
        expect(components["minecraft:use_duration"], "minecraft:use_duration was removed in 1.20.50").to.be.undefined;

        const effectsWarnings = result.summary.warnings.filter((w) => w.includes("food.effects"));
        expect(effectsWarnings).to.have.length(c.expectsEffectsWarning ? 1 : 0);
      });
    }
  });

  // ==========================================================================
  // TOOL TIERS
  // ==========================================================================

  describe("tool tiers", function () {
    const cases: {
      trait: "pickaxe" | "axe" | "shovel" | "hoe";
      miningLevel?: "wood" | "stone" | "iron" | "diamond" | "netherite";
      miningSpeed?: number;
      expectedSpeed: number;
      expectedTierTag: string;
    }[] = [
      { trait: "pickaxe", expectedSpeed: 6, expectedTierTag: "minecraft:iron_tier" },
      { trait: "pickaxe", miningLevel: "wood", expectedSpeed: 2, expectedTierTag: "minecraft:wooden_tier" },
      { trait: "pickaxe", miningLevel: "stone", expectedSpeed: 4, expectedTierTag: "minecraft:stone_tier" },
      { trait: "pickaxe", miningLevel: "iron", expectedSpeed: 6, expectedTierTag: "minecraft:iron_tier" },
      { trait: "pickaxe", miningLevel: "diamond", expectedSpeed: 8, expectedTierTag: "minecraft:diamond_tier" },
      { trait: "pickaxe", miningLevel: "netherite", expectedSpeed: 9, expectedTierTag: "minecraft:netherite_tier" },
      {
        trait: "pickaxe",
        miningLevel: "diamond",
        miningSpeed: 10.4,
        expectedSpeed: 10,
        expectedTierTag: "minecraft:diamond_tier",
      },
      { trait: "axe", miningLevel: "stone", expectedSpeed: 4, expectedTierTag: "minecraft:stone_tier" },
      { trait: "shovel", miningLevel: "diamond", expectedSpeed: 8, expectedTierTag: "minecraft:diamond_tier" },
      { trait: "hoe", miningLevel: "netherite", expectedSpeed: 9, expectedTierTag: "minecraft:netherite_tier" },
    ];

    for (const c of cases) {
      const label = `${c.trait} (${c.miningLevel ?? "default"}${c.miningSpeed !== undefined ? `, speed ${c.miningSpeed}` : ""})`;
      it(`${label} gets digger speed ${c.expectedSpeed} and ${c.expectedTierTag}`, async function () {
        const { components } = await generateItem({
          traits: [c.trait],
          tool: { durability: 500, miningLevel: c.miningLevel, miningSpeed: c.miningSpeed },
        });

        expect(components["minecraft:digger"]).to.deep.equal({
          use_efficiency: true,
          destroy_speeds: [
            { block: { tags: `q.any_tag('minecraft:is_${c.trait}_item_destructible')` }, speed: c.expectedSpeed },
          ],
        });
        expect(components["minecraft:tags"].tags).to.have.members([
          `minecraft:is_${c.trait}`,
          "minecraft:is_tool",
          "minecraft:digger",
          c.expectedTierTag,
        ]);
        expect(components["minecraft:durability"]).to.deep.equal({ max_durability: 500 });
      });
    }

    it("sword gets sword/tool/tier tags without a digger", async function () {
      const { components } = await generateItem({ traits: ["sword"], tool: { durability: 300, miningLevel: "stone" } });

      expect(components["minecraft:tags"].tags).to.have.members([
        "minecraft:is_sword",
        "minecraft:is_tool",
        "minecraft:stone_tier",
      ]);
      expect(components["minecraft:digger"]).to.be.undefined;
    });

    it("warns when tool tier properties have no tool trait to apply to", async function () {
      const { result, components } = await generateItem({ tool: { durability: 100, miningLevel: "iron" } });

      expect(components["minecraft:durability"]).to.deep.equal({ max_durability: 100 });
      expect(result.summary.warnings.some((w) => w.includes("tool.miningLevel"))).to.equal(true);
    });
  });

  // ==========================================================================
  // BOWS / CROSSBOWS
  // ==========================================================================

  describe("bows and crossbows", function () {
    const bowShooter = (item: string) => ({
      ammunition: [{ item, ...ARROW_AMMUNITION }],
      max_draw_duration: 1.0,
      scale_power_by_draw_duration: true,
      charge_on_draw: false,
    });
    const crossbowShooter = (item: string) => ({
      ammunition: [{ item, ...ARROW_AMMUNITION }],
      max_draw_duration: 1.25,
      scale_power_by_draw_duration: false,
      charge_on_draw: true,
    });

    const cases: { name: string; item: Partial<IItemTypeDefinition>; expectedShooter: object }[] = [
      {
        name: "bow trait alone shoots arrows",
        item: { traits: ["bow"] },
        expectedShooter: bowShooter("minecraft:arrow"),
      },
      {
        name: "crossbow trait alone charges and shoots arrows",
        item: { traits: ["crossbow"] },
        expectedShooter: crossbowShooter("minecraft:arrow"),
      },
      {
        name: "chargeable projectile without a trait behaves like a bow",
        item: { projectile: { projectile: "arrow", chargeable: true } },
        expectedShooter: bowShooter("minecraft:arrow"),
      },
      {
        name: "bow trait with a custom projectile implies chargeable",
        item: { traits: ["bow"], projectile: { projectile: "test:fire_arrow" } },
        expectedShooter: bowShooter("test:fire_arrow"),
      },
      {
        name: "crossbow trait with a projectile keeps crossbow charging",
        item: { traits: ["crossbow"], projectile: { projectile: "arrow" } },
        expectedShooter: crossbowShooter("minecraft:arrow"),
      },
    ];

    for (const c of cases) {
      it(c.name, async function () {
        const { components } = await generateItem(c.item);

        expect(components["minecraft:shooter"]).to.deep.equal(c.expectedShooter);
        expect(components["minecraft:use_modifiers"]).to.deep.equal({ use_duration: 3600, movement_modifier: 0.35 });
        expect(components["minecraft:use_duration"]).to.be.undefined;
        expect(components["minecraft:chargeable"]).to.be.undefined;
        expect(components["minecraft:throwable"]).to.be.undefined;
      });
    }

    it("bow trait is a single, damageable item", async function () {
      const { components } = await generateItem({ traits: ["bow"] });

      expect(components["minecraft:max_stack_size"]).to.equal(1);
      expect(components["minecraft:durability"]).to.deep.equal({ max_durability: 384 });
      expect(components["minecraft:enchantable"]).to.deep.equal({ slot: "bow", value: 1 });
    });

    it("explicit non-chargeable projectile stays a throwable", async function () {
      const { components } = await generateItem({
        traits: ["bow"],
        projectile: { projectile: "snowball", chargeable: false },
      });

      expect(components["minecraft:throwable"]).to.exist;
      expect(components["minecraft:projectile"]).to.deep.equal({ projectile_entity: "minecraft:snowball" });
      expect(components["minecraft:shooter"]).to.be.undefined;
      expect(components["minecraft:use_modifiers"]).to.be.undefined;
    });
  });

  // ==========================================================================
  // TRAIT ROUND-TRIP
  // ==========================================================================

  describe("trait detection round-trip", function () {
    const cases: ("pickaxe" | "axe" | "shovel" | "hoe" | "bow" | "crossbow")[] = [
      "pickaxe",
      "axe",
      "shovel",
      "hoe",
      "bow",
      "crossbow",
    ];

    for (const trait of cases) {
      it(`generated ${trait} is detected only as ${trait}`, async function () {
        const { components } = await generateItem({ traits: [trait] });
        const detected = TraitDetector.detectItemTraits(components)
          .map((r) => r.traitId)
          .filter((t) => (cases as string[]).includes(t));

        expect(detected).to.deep.equal([trait]);
      });
    }
  });

  // ==========================================================================
  // BLOCK DROPS
  // ==========================================================================

  describe("block drops", function () {
    const cases: { name: string; block: Partial<IBlockTypeDefinition>; expectedLoot?: string }[] = [
      {
        name: "drops wire minecraft:loot to the generated table",
        block: { id: "gem_ore", drops: [{ item: "test:gem", count: { min: 1, max: 3 } }] },
        expectedLoot: "loot_tables/blocks/gem_ore.json",
      },
      { name: "no drops leaves the default self-drop", block: { id: "plain_block" } },
      {
        name: "native minecraft:loot overrides the generated reference",
        block: {
          id: "vault_block",
          drops: [{ item: "diamond" }],
          components: { "minecraft:loot": "loot_tables/custom/vault.json" },
        },
        expectedLoot: "loot_tables/custom/vault.json",
      },
    ];

    for (const c of cases) {
      it(c.name, async function () {
        const result = await generate({ blockTypes: [{ displayName: "Block", ...c.block } as IBlockTypeDefinition] });
        const components = (result.blockBehaviors[0].content as any)["minecraft:block"].components;

        expect(components["minecraft:loot"]).to.equal(c.expectedLoot);
        if (c.block.drops) {
          expect(result.lootTables.map((l) => l.path)).to.include(`loot_tables/blocks/${c.block.id}.json`);
        } else {
          expect(result.lootTables).to.have.length(0);
        }
      });
    }
  });

  // ==========================================================================
  // ARMOR
  // ==========================================================================

  describe("armor attachables", function () {
    const cases: {
      item: Partial<IItemTypeDefinition>;
      piece: string;
      layer: 1 | 2;
      visibilityVariable: string;
      protection: number;
    }[] = [
      {
        item: { id: "ruby_helmet", armor: { slot: "helmet", defense: 3, durability: 200 } },
        piece: "helmet",
        layer: 1,
        visibilityVariable: "helmet_layer_visible",
        protection: 3,
      },
      {
        item: { id: "ruby_chestplate", traits: ["armor_chestplate"] },
        piece: "chestplate",
        layer: 1,
        visibilityVariable: "chest_layer_visible",
        protection: 6,
      },
      {
        item: { id: "ruby_leggings", armor: { slot: "leggings", defense: 5, durability: 225 } },
        piece: "leggings",
        layer: 2,
        visibilityVariable: "leg_layer_visible",
        protection: 5,
      },
      {
        item: { id: "ruby_boots", traits: ["armor_boots"] },
        piece: "boots",
        layer: 1,
        visibilityVariable: "boot_layer_visible",
        protection: 2,
      },
    ];

    for (const c of cases) {
      it(`${c.item.id} renders via an attachable using layer ${c.layer}`, async function () {
        const { result, components } = await generateItem({ displayName: "Armor", color: "#B0202A", ...c.item });
        const texturePath = `textures/models/armor/test_ruby_${c.layer}`;

        expect(fileContent(result.itemResources, `attachables/${c.item.id}.json`)).to.deep.equal({
          format_version: "1.10.0",
          "minecraft:attachable": {
            description: {
              identifier: `test:${c.item.id}`,
              materials: { default: "armor", enchanted: "armor_enchanted" },
              textures: { default: texturePath, enchanted: "textures/misc/enchanted_actor_glint" },
              geometry: { default: `geometry.humanoid.armor.${c.piece}` },
              scripts: { parent_setup: `variable.${c.visibilityVariable} = 0.0;` },
              render_controllers: ["controller.render.armor"],
            },
          },
        });

        const texture = result.textures.find((t) => t.path === `${texturePath}.png`);
        expect(texture, "armor layer texture").to.exist;
        expect(texture!.pack).to.equal("resource");
        expect(pngSize(texture!.content as Uint8Array)).to.deep.equal({ width: 64, height: 32 });

        expect(components["minecraft:wearable"].protection).to.equal(c.protection);
        expect(components["minecraft:armor"], "minecraft:armor is a legacy component").to.be.undefined;
      });
    }

    it("a full set shares one texture per layer", async function () {
      const result = await generate({
        itemTypes: [
          { id: "ruby_helmet", displayName: "Helmet", traits: ["armor_helmet"] },
          { id: "ruby_chestplate", displayName: "Chestplate", traits: ["armor_chestplate"] },
          { id: "ruby_leggings", displayName: "Leggings", traits: ["armor_leggings"] },
          { id: "ruby_boots", displayName: "Boots", traits: ["armor_boots"] },
        ],
      });

      expect(result.itemResources.map((f) => f.path)).to.have.members([
        "attachables/ruby_helmet.json",
        "attachables/ruby_chestplate.json",
        "attachables/ruby_leggings.json",
        "attachables/ruby_boots.json",
      ]);
      expect(
        result.textures.filter((t) => t.path.startsWith("textures/models/armor/")).map((t) => t.path)
      ).to.have.members(["textures/models/armor/test_ruby_1.png", "textures/models/armor/test_ruby_2.png"]);
    });

    it("non-wearable items get no attachable", async function () {
      const { result } = await generateItem({ traits: ["sword"] });

      expect(result.itemResources).to.have.length(0);
    });
  });

  // ==========================================================================
  // WORLD GENERATION
  // ==========================================================================

  describe("feature spreads", function () {
    const cases: {
      name: string;
      spread: IFeatureSpread;
      expectedPlaced: object;
      expectedDistribution: object;
      expectedPass: string;
      expectedRuleOrigin?: { x: any; z: any };
    }[] = [
      {
        name: "ore in a range that ends at y=0",
        spread: {
          places: [{ type: "ore", id: "gem_ore", count: 8, replacesBlocks: ["stone", "minecraft:deepslate"] }],
          heightPlacement: { type: "range", min: -64, max: 0 },
          count: { min: 2, max: 6 },
          rarity: 4,
        },
        expectedPlaced: {
          format_version: "1.13.0",
          "minecraft:ore_feature": {
            description: { identifier: "test:gen_placed" },
            count: 8,
            replace_rules: [{ places_block: "test:gem_ore", may_replace: ["minecraft:stone", "minecraft:deepslate"] }],
          },
        },
        expectedDistribution: {
          iterations: "math.random_integer(2, 6)",
          scatter_chance: { numerator: 1, denominator: 4 },
          x: CHUNK_EXTENT,
          y: { distribution: "uniform", extent: [-64, 0] },
          z: CHUNK_EXTENT,
        },
        expectedPass: "underground_pass",
      },
      {
        name: "single block at fixed y=0",
        spread: { places: [{ type: "block", id: "crystal" }], heightPlacement: { type: "fixed", y: 0 }, count: 3 },
        expectedPlaced: {
          format_version: "1.21.40",
          "minecraft:single_block_feature": {
            description: { identifier: "test:gen_placed" },
            places_block: [{ block: "test:crystal", weight: 1 }],
            enforce_placement_rules: true,
            enforce_survivability_rules: true,
            may_replace: ["minecraft:air"],
          },
        },
        expectedDistribution: { iterations: 3, x: CHUNK_EXTENT, y: 0, z: CHUNK_EXTENT },
        expectedPass: "underground_pass",
      },
      {
        name: "vegetation defaults to the surface",
        spread: { places: [{ type: "vegetation", id: "minecraft:poppy" }], count: 4 },
        expectedPlaced: {
          format_version: "1.21.40",
          "minecraft:single_block_feature": {
            description: { identifier: "test:gen_placed" },
            places_block: [{ block: "minecraft:poppy", weight: 1 }],
            enforce_placement_rules: true,
            enforce_survivability_rules: true,
            may_replace: ["minecraft:air"],
            may_attach_to: {
              min_sides_must_attach: 1,
              bottom: [
                "minecraft:grass_block",
                "minecraft:dirt",
                "minecraft:coarse_dirt",
                "minecraft:podzol",
                "minecraft:moss_block",
              ],
            },
          },
        },
        expectedDistribution: {
          iterations: 4,
          coordinate_eval_order: "xzy",
          x: CHUNK_EXTENT,
          y: "q.heightmap(v.worldx, v.worldz)",
          z: CHUNK_EXTENT,
        },
        expectedPass: "surface_pass",
      },
      {
        name: "structure on the surface",
        spread: { places: [{ type: "structure", id: "ruins" }], rarity: 16 },
        expectedPlaced: {
          format_version: "1.13.0",
          "minecraft:structure_template_feature": {
            description: { identifier: "test:gen_placed" },
            structure_name: "mystructure:ruins",
            adjustment_radius: 4,
            facing_direction: "random",
            constraints: {
              grounded: {},
              unburied: {},
              block_intersection: { block_allowlist: ["minecraft:air"] },
            },
          },
        },
        expectedDistribution: {
          iterations: 1,
          scatter_chance: { numerator: 1, denominator: 16 },
          coordinate_eval_order: "xzy",
          x: CHUNK_EXTENT,
          y: "q.heightmap(v.worldx, v.worldz)",
          z: CHUNK_EXTENT,
        },
        expectedPass: "surface_pass",
      },
      {
        name: "clustered vegetation picks a random center",
        spread: {
          places: [{ type: "vegetation", id: "blue_flower" }],
          count: { min: 5, max: 5 },
          scatter: { type: "cluster", radius: 3 },
        },
        expectedPlaced: {
          format_version: "1.21.40",
          "minecraft:single_block_feature": {
            description: { identifier: "test:gen_placed" },
            places_block: [{ block: "test:blue_flower", weight: 1 }],
            enforce_placement_rules: true,
            enforce_survivability_rules: true,
            may_replace: ["minecraft:air"],
            may_attach_to: {
              min_sides_must_attach: 1,
              bottom: [
                "minecraft:grass_block",
                "minecraft:dirt",
                "minecraft:coarse_dirt",
                "minecraft:podzol",
                "minecraft:moss_block",
              ],
            },
          },
        },
        expectedDistribution: {
          iterations: 5,
          coordinate_eval_order: "xzy",
          x: { distribution: "gaussian", extent: [-3, 3] },
          y: "q.heightmap(v.worldx, v.worldz)",
          z: { distribution: "gaussian", extent: [-3, 3] },
        },
        expectedPass: "surface_pass",
        expectedRuleOrigin: {
          x: { distribution: "uniform", extent: [3, 12] },
          z: { distribution: "uniform", extent: [3, 12] },
        },
      },
      {
        name: "line of ore along x",
        spread: {
          places: [{ type: "ore", id: "vein", count: 3 }],
          heightPlacement: { type: "underground", min: 0, max: 0 },
          count: 6,
          scatter: { type: "line", radius: 3 },
        },
        expectedPlaced: {
          format_version: "1.13.0",
          "minecraft:ore_feature": {
            description: { identifier: "test:gen_placed" },
            count: 3,
            replace_rules: [{ places_block: "test:vein", may_replace: ["minecraft:stone"] }],
          },
        },
        expectedDistribution: {
          iterations: 6,
          x: { distribution: "fixed_grid", extent: [0, 6] },
          y: { distribution: "uniform", extent: [0, 0] },
          z: 0,
        },
        expectedPass: "underground_pass",
        expectedRuleOrigin: { x: 0, z: CHUNK_EXTENT },
      },
    ];

    for (const c of cases) {
      it(c.name, async function () {
        const result = await generate({ features: [{ id: "gen", spread: c.spread }] });

        expect(result.summary.warnings).to.deep.equal([]);
        expect(result.features.map((f) => f.path)).to.have.members([
          "features/gen_scatter.json",
          "features/gen_placed.json",
        ]);
        expect(fileContent(result.features, "features/gen_placed.json")).to.deep.equal(c.expectedPlaced);
        expect(fileContent(result.features, "features/gen_scatter.json")).to.deep.equal({
          format_version: "1.21.20",
          "minecraft:scatter_feature": {
            description: { identifier: "test:gen_scatter" },
            places_feature: "test:gen_placed",
            distribution: c.expectedDistribution,
          },
        });

        const rule = fileContent(result.featureRules, "feature_rules/gen.json")["minecraft:feature_rules"];
        expect(rule.description).to.deep.equal({ identifier: "test:gen", places_feature: "test:gen_scatter" });
        expect(rule.conditions.placement_pass).to.equal(c.expectedPass);
        expect(rule.distribution).to.deep.equal({
          iterations: 1,
          x: c.expectedRuleOrigin?.x ?? 0,
          y: 0,
          z: c.expectedRuleOrigin?.z ?? 0,
        });
      });
    }

    it("aggregates multiple placements so each one resolves", async function () {
      const result = await generate({
        features: [
          {
            id: "mixed",
            spread: {
              places: [
                { type: "ore", id: "gem_ore" },
                { type: "ore", id: "gem_ore_deep", replacesBlocks: ["deepslate"] },
              ],
            },
          },
        ],
      });

      expect(fileContent(result.features, "features/mixed_placed.json")).to.deep.equal({
        format_version: "1.13.0",
        "minecraft:aggregate_feature": {
          description: { identifier: "test:mixed_placed" },
          features: ["test:mixed_placed_1", "test:mixed_placed_2"],
        },
      });
      expect(
        fileContent(result.features, "features/mixed_placed_2.json")["minecraft:ore_feature"].replace_rules
      ).to.deep.equal([{ places_block: "test:gem_ore_deep", may_replace: ["minecraft:deepslate"] }]);
    });

    it("skips unsupported tree placements with a warning instead of a broken chain", async function () {
      const result = await generate({
        features: [
          { id: "grove", spread: { places: [{ type: "tree", id: "palm" }], heightPlacement: { type: "surface" } } },
        ],
      });

      expect(result.features).to.have.length(0);
      expect(result.featureRules).to.have.length(0);
      expect(result.summary.warnings.some((w) => w.includes("'tree'"))).to.equal(true);
    });

    it("keeps supported placements when mixed with unsupported ones", async function () {
      const result = await generate({
        features: [
          {
            id: "grove",
            spread: {
              places: [
                { type: "tree", id: "palm" },
                { type: "vegetation", id: "fern" },
              ],
            },
          },
        ],
      });

      expect(result.features.map((f) => f.path)).to.have.members([
        "features/grove_scatter.json",
        "features/grove_placed.json",
      ]);
      expect(fileContent(result.features, "features/grove_placed.json")["minecraft:single_block_feature"]).to.exist;
      expect(result.summary.warnings).to.have.length(1);
    });

    it("collapses an ore vein range to its midpoint with a warning", async function () {
      const result = await generate({
        features: [{ id: "veins", spread: { places: [{ type: "ore", id: "gem_ore", count: { min: 4, max: 9 } }] } }],
      });

      expect(fileContent(result.features, "features/veins_placed.json")["minecraft:ore_feature"].count).to.equal(7);
      expect(result.summary.warnings.some((w) => w.includes("vein size range 4-9"))).to.equal(true);
    });

    it("every identifier matches its file name and every reference resolves", async function () {
      const result = await generate({
        features: [
          {
            id: "ores",
            spread: {
              places: [
                { type: "ore", id: "a" },
                { type: "block", id: "b" },
              ],
            },
          },
          { id: "flowers", spread: { places: [{ type: "vegetation", id: "c" }], scatter: { type: "cluster" } } },
          { id: "ruins", spread: { places: [{ type: "structure", id: "test:ruin" }] } },
        ],
      });

      const identifiers = new Set<string>();
      for (const file of result.features) {
        const [featureType] = Object.keys(file.content).filter((k) => k !== "format_version");
        const identifier = (file.content as any)[featureType].description.identifier;
        expect(identifier).to.equal(`test:${path.basename(file.path, ".json")}`);
        identifiers.add(identifier);
      }

      const references: string[] = [];
      for (const file of result.features) {
        const body = Object.values(file.content).find((v) => typeof v === "object") as any;
        if (body.places_feature) references.push(body.places_feature);
        if (body.features) references.push(...body.features);
      }
      for (const file of result.featureRules) {
        const rule = (file.content as any)["minecraft:feature_rules"];
        expect(rule.description.identifier).to.equal(`test:${path.basename(file.path, ".json")}`);
        references.push(rule.description.places_feature);
      }

      expect(references.length).to.be.greaterThan(0);
      for (const reference of references) {
        expect(identifiers.has(reference), `${reference} should be a generated feature`).to.equal(true);
      }
    });
  });

  // ==========================================================================
  // CONTENT WRITER
  // ==========================================================================

  describe("ContentWriter paths", function () {
    it("keeps nested pack paths so cross-file references resolve", async function () {
      const root = path.resolve(__dirname, "../../debugoutput/content-writer-nested-paths");
      fs.rmSync(root, { recursive: true, force: true });
      fs.mkdirSync(root, { recursive: true });

      const project = new Project(env.creatorTools, "writerpaths", null);
      project.autoDeploymentMode = ProjectAutoDeploymentMode.noAutoDeployment;
      project.localFolderPath = root + path.sep;
      await project.inferProjectItemsFromFiles();

      const content = await generate({
        itemTypes: [{ id: "ruby_boots", displayName: "Ruby Boots", traits: ["armor_boots"] }],
        blockTypes: [{ id: "ruby_ore", displayName: "Ruby Ore", drops: [{ item: "diamond" }] }],
        features: [{ id: "ruby_gen", spread: { places: [{ type: "ore", id: "ruby_ore" }] } }],
      });
      await ContentWriter.writeGeneratedContent(project, content);

      const bpFolder = await project.ensureDefaultBehaviorPackFolder();
      const rpFolder = await project.ensureDefaultResourcePackFolder();
      const bpRoot = bpFolder!.fullPath;
      const rpRoot = rpFolder!.fullPath;

      const expectedFiles = [
        [bpRoot, "loot_tables/blocks/ruby_ore.json"],
        [bpRoot, "features/ruby_gen_scatter.json"],
        [bpRoot, "features/ruby_gen_placed.json"],
        [bpRoot, "feature_rules/ruby_gen.json"],
        [rpRoot, "attachables/ruby_boots.json"],
        [rpRoot, "textures/models/armor/test_ruby_1.png"],
        [rpRoot, "textures/items/ruby_boots.png"],
      ];
      for (const [packRoot, relativePath] of expectedFiles) {
        expect(fs.existsSync(path.join(packRoot, relativePath)), relativePath).to.equal(true);
      }
    });
  });

  // ==========================================================================
  // VALIDATION
  // ==========================================================================

  describe("validation of generated content", function () {
    const FIDELITY_ADDON: IMinecraftContentDefinition = definition({
      namespace: "fidelity",
      itemTypes: [
        { id: "ruby_apple", displayName: "Ruby Apple", food: { nutrition: 4, saturation: 1.2 } },
        {
          id: "ruby_pickaxe",
          displayName: "Ruby Pickaxe",
          traits: ["pickaxe"],
          tool: { durability: 900, miningLevel: "diamond" },
        },
        { id: "ruby_bow", displayName: "Ruby Bow", traits: ["bow"] },
        { id: "ruby_helmet", displayName: "Ruby Helmet", traits: ["armor_helmet"], color: "#B0202A" },
        {
          id: "ruby_leggings",
          displayName: "Ruby Leggings",
          armor: { slot: "leggings", defense: 5, durability: 300 },
          color: "#B0202A",
        },
      ],
      blockTypes: [
        { id: "ruby_ore", displayName: "Ruby Ore", destroyTime: 3, drops: [{ item: "fidelity:ruby_apple" }] },
        { id: "ruby_flower", displayName: "Ruby Flower", traits: ["transparent"] },
      ],
      features: [
        {
          id: "ruby_ore_gen",
          spread: {
            places: [{ type: "ore", id: "ruby_ore", count: 6 }],
            heightPlacement: { type: "range", min: -32, max: 16 },
            count: { min: 1, max: 4 },
          },
        },
        { id: "ruby_flowers", spread: { places: [{ type: "vegetation", id: "ruby_flower" }], count: 2 } },
      ],
    });

    function writePackFiles(root: string, result: IGeneratedContent) {
      const bpRoot = path.join(root, "behavior_packs", "fidelity");
      const rpRoot = path.join(root, "resource_packs", "fidelity");
      const files: IGeneratedFile[] = [
        result.behaviorPackManifest!,
        result.resourcePackManifest!,
        ...result.blockBehaviors,
        ...result.itemBehaviors,
        ...result.itemResources,
        ...result.lootTables,
        ...result.features,
        ...result.featureRules,
        ...result.textures,
        result.terrainTextures!,
        result.itemTextures!,
        result.blocksCatalog!,
      ];

      for (const file of files) {
        const filePath = path.join(file.pack === "behavior" ? bpRoot : rpRoot, file.path);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(
          filePath,
          file.content instanceof Uint8Array ? Buffer.from(file.content) : JSON.stringify(file.content, null, 2)
        );
      }
    }

    it("reports no validation errors for generated items, blocks, and features", async function () {
      const root = path.resolve(__dirname, "../../debugoutput/content-generator-fidelity");
      fs.rmSync(root, { recursive: true, force: true });

      const result = await new ContentGenerator(FIDELITY_ADDON).generate();
      writePackFiles(root, result);

      const project = new Project(env.creatorTools, "fidelity", null);
      project.autoDeploymentMode = ProjectAutoDeploymentMode.noAutoDeployment;
      project.localFolderPath = root + path.sep;
      await project.inferProjectItemsFromFiles();

      const infoSet = new ProjectInfoSet(project, ProjectInfoSuite.defaultInDevelopment);
      await infoSet.generateForProject();

      const generatedPaths = [
        ...result.itemBehaviors,
        ...result.itemResources,
        ...result.blockBehaviors,
        ...result.lootTables,
        ...result.features,
        ...result.featureRules,
      ].map((f) => "/" + f.path);

      // The unit-test environment has no vanilla content index, so links to vanilla armor
      // geometry and the enchantment glint can't be resolved here.
      const isVanillaArmorLink = (data: unknown) =>
        typeof data === "string" &&
        /`(geometry\.humanoid\.armor\.\w+|textures\/misc\/enchanted_actor_glint)`$/.test(data);

      const problems = infoSet.items.filter(
        (item) =>
          (item.itemType === InfoItemType.error ||
            item.itemType === InfoItemType.internalProcessingError ||
            item.itemType === InfoItemType.warning) &&
          generatedPaths.some((p) => (item.projectItemPath || "").endsWith(p)) &&
          !(item.generatorId === "UNLINK" && isVanillaArmorLink(item.data))
      );

      expect(
        problems.map((p) => `[${p.generatorId}#${p.generatorIndex}] ${p.projectItemPath}: ${p.message}`)
      ).to.deep.equal([]);
    });
  });
});
