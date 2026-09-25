// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Vanilla-equivalent tool tiers for custom tools.
 *
 * Tier tags (e.g. `minecraft:iron_tier`) tell vanilla blocks tagged
 * `minecraft:<tier>_tier_destructible` whether the tool can harvest them.
 * Speeds mirror vanilla tool mining speed multipliers; `minecraft:digger`
 * destroy speeds must be integers.
 */

export type ToolMiningLevel = "wood" | "stone" | "iron" | "diamond" | "netherite";

export interface IToolTier {
  tag: string;
  speed: number;
}

export const TOOL_TIERS: Record<ToolMiningLevel, IToolTier> = {
  wood: { tag: "minecraft:wooden_tier", speed: 2 },
  stone: { tag: "minecraft:stone_tier", speed: 4 },
  iron: { tag: "minecraft:iron_tier", speed: 6 },
  diamond: { tag: "minecraft:diamond_tier", speed: 8 },
  netherite: { tag: "minecraft:netherite_tier", speed: 9 },
};

/** Tier used when no miningLevel is supplied; matches the default 250 tool durability. */
export const DEFAULT_TOOL_MINING_LEVEL: ToolMiningLevel = "iron";

export function getToolTier(miningLevel?: string): IToolTier {
  return TOOL_TIERS[miningLevel as ToolMiningLevel] ?? TOOL_TIERS[DEFAULT_TOOL_MINING_LEVEL];
}

/** Resolves the digger speed: an explicit miningSpeed wins, otherwise the tier's vanilla speed. */
export function getToolMiningSpeed(miningSpeed: number | undefined, tier: IToolTier): number {
  if (typeof miningSpeed === "number" && isFinite(miningSpeed)) {
    return Math.max(1, Math.round(miningSpeed));
  }
  return tier.speed;
}

/**
 * Builds the `minecraft:tags` component for a tool, mirroring vanilla tools
 * (e.g. iron_pickaxe carries digger, iron_tier, is_pickaxe, is_tool).
 */
export function buildToolTagsComponent(typeTag: string, tier: IToolTier, isDigger: boolean): { tags: string[] } {
  const tags = [typeTag, "minecraft:is_tool", tier.tag];
  if (isDigger) {
    tags.push("minecraft:digger");
  }
  return { tags };
}

/** Builds a `minecraft:digger` component that targets the vanilla `<tool>_item_destructible` block tag. */
export function buildDiggerComponent(blockTag: string, speed: number) {
  return {
    use_efficiency: true,
    destroy_speeds: [
      {
        block: { tags: `q.any_tag('${blockTag}')` },
        speed,
      },
    ],
  };
}
