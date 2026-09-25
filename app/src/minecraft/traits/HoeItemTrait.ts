// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ItemContentTrait, IItemTraitData, ITraitConfig } from "./ContentTraits";
import { buildDiggerComponent, buildToolTagsComponent, getToolMiningSpeed, getToolTier } from "./ToolTiers";

/**
 * Hoe - farming tool.
 *
 * Config: miningLevel (wood|stone|iron|diamond|netherite, default iron), miningSpeed, durability.
 */
export class HoeItemTrait extends ItemContentTrait {
  get id(): string {
    return "hoe";
  }

  getData(config?: ITraitConfig): IItemTraitData {
    const tier = getToolTier(config?.miningLevel);
    const miningSpeed = getToolMiningSpeed(config?.miningSpeed, tier);
    const durability = config?.durability ?? 250;

    return {
      id: "hoe",
      displayName: "Hoe",
      description: "Farming tool",
      category: "tool",
      components: {
        "minecraft:durability": {
          max_durability: durability,
        },
        "minecraft:hand_equipped": true,
        "minecraft:digger": buildDiggerComponent("minecraft:is_hoe_item_destructible", miningSpeed),
        "minecraft:enchantable": {
          value: 10,
          slot: "hoe",
        },
        "minecraft:tags": buildToolTagsComponent("minecraft:is_hoe", tier, true),
      },
    };
  }
}
