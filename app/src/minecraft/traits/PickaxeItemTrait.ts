// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ItemContentTrait, IItemTraitData, ITraitConfig } from "./ContentTraits";
import { buildDiggerComponent, buildToolTagsComponent, getToolMiningSpeed, getToolTier } from "./ToolTiers";

/**
 * Pickaxe - mining tool.
 *
 * Config: miningLevel (wood|stone|iron|diamond|netherite, default iron), miningSpeed, durability.
 */
export class PickaxeItemTrait extends ItemContentTrait {
  get id(): string {
    return "pickaxe";
  }

  getData(config?: ITraitConfig): IItemTraitData {
    const tier = getToolTier(config?.miningLevel);
    const miningSpeed = getToolMiningSpeed(config?.miningSpeed, tier);
    const durability = config?.durability ?? 250;

    return {
      id: "pickaxe",
      displayName: "Pickaxe",
      description: "Mining tool",
      category: "tool",
      components: {
        "minecraft:durability": {
          max_durability: durability,
        },
        "minecraft:hand_equipped": true,
        "minecraft:digger": buildDiggerComponent("minecraft:is_pickaxe_item_destructible", miningSpeed),
        "minecraft:enchantable": {
          value: 10,
          slot: "pickaxe",
        },
        "minecraft:tags": buildToolTagsComponent("minecraft:is_pickaxe", tier, true),
      },
    };
  }
}
