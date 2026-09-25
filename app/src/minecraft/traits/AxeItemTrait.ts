// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ItemContentTrait, IItemTraitData, ITraitConfig } from "./ContentTraits";
import { buildDiggerComponent, buildToolTagsComponent, getToolMiningSpeed, getToolTier } from "./ToolTiers";

/**
 * Axe - chopping tool.
 *
 * Config: miningLevel (wood|stone|iron|diamond|netherite, default iron), miningSpeed, durability.
 */
export class AxeItemTrait extends ItemContentTrait {
  get id(): string {
    return "axe";
  }

  getData(config?: ITraitConfig): IItemTraitData {
    const tier = getToolTier(config?.miningLevel);
    const miningSpeed = getToolMiningSpeed(config?.miningSpeed, tier);
    const durability = config?.durability ?? 250;

    return {
      id: "axe",
      displayName: "Axe",
      description: "Chopping tool",
      category: "tool",
      components: {
        "minecraft:durability": {
          max_durability: durability,
        },
        "minecraft:hand_equipped": true,
        "minecraft:digger": buildDiggerComponent("minecraft:is_axe_item_destructible", miningSpeed),
        "minecraft:enchantable": {
          value: 10,
          slot: "axe",
        },
        "minecraft:tags": buildToolTagsComponent("minecraft:is_axe", tier, true),
      },
    };
  }
}
