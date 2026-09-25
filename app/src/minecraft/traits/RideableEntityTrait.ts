// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { EntityContentTrait, IEntityTraitData, ITraitConfig } from "./ContentTraits";

const DEFAULT_SEAT_HEIGHT = 1.1;
const DEFAULT_SEAT_Z = -0.2;
const SEAT_SPACING = 0.6;

/**
 * Rideable - can be ridden by the player.
 *
 * Config:
 * - `seatCount`: number of riders. Default: 1. One seat position is emitted per rider.
 * - `controllable`: whether the rider steers the entity. Default: true.
 * - `controlItems`: items the rider must hold to steer (pig/carrot-on-a-stick style).
 *   When set, emits `minecraft:item_controllable` + `minecraft:behavior.controlled_by_player`
 *   instead of `minecraft:input_ground_controlled`.
 * - `requiresSaddle`: whether a saddle must be equipped before riding. Default: true.
 */
export class RideableEntityTrait extends EntityContentTrait {
  get id(): string {
    return "rideable";
  }

  static buildSeats(seatCount: number): { position: number[] }[] {
    const count = Math.max(1, Math.floor(seatCount));
    const seats: { position: number[] }[] = [];

    for (let i = 0; i < count; i++) {
      // Front-to-back, centered on the default single-seat position.
      const z = Math.round((DEFAULT_SEAT_Z + SEAT_SPACING * ((count - 1) / 2 - i)) * 100) / 100;
      seats.push({ position: [0.0, DEFAULT_SEAT_HEIGHT, z] });
    }

    return seats;
  }

  getData(config?: ITraitConfig): IEntityTraitData {
    const seatCount: number = config?.seatCount ?? 1;
    const controllable: boolean = config?.controllable ?? true;
    const controlItems: string[] | undefined =
      Array.isArray(config?.controlItems) && config!.controlItems.length > 0 ? config!.controlItems : undefined;
    const requiresSaddle = config?.requiresSaddle ?? true;

    const baseComponents: Record<string, any> = {
      "minecraft:rideable": {
        seat_count: seatCount,
        family_types: ["player"],
        interact_text: "action.interact.ride.horse",
        seats: RideableEntityTrait.buildSeats(seatCount),
      },
    };

    if (controllable) {
      if (controlItems) {
        baseComponents["minecraft:item_controllable"] = { control_items: controlItems };
        baseComponents["minecraft:behavior.controlled_by_player"] = { priority: 0 };
      } else {
        baseComponents["minecraft:input_ground_controlled"] = {};
      }
    }

    const componentGroups: Record<string, Record<string, any>> = {};
    const events: Record<string, any> = {};

    if (requiresSaddle) {
      componentGroups["unsaddled"] = {};
      componentGroups["saddled"] = {
        "minecraft:is_saddled": {},
        ...baseComponents,
      };

      events["on_saddle"] = {
        remove: { component_groups: ["unsaddled"] },
        add: { component_groups: ["saddled"] },
      };

      return {
        id: "rideable",
        displayName: "Rideable",
        description: "Can be ridden by the player",
        category: "interaction",
        components: {
          "minecraft:equippable": {
            slots: [
              {
                slot: 0,
                item: "saddle",
                accepted_items: ["saddle"],
                on_equip: { event: "on_saddle" },
              },
            ],
          },
        },
        componentGroups,
        events,
        spawnEvent: {
          add: { component_groups: ["unsaddled"] },
        },
      };
    }

    return {
      id: "rideable",
      displayName: "Rideable",
      description: "Can be ridden by the player",
      category: "interaction",
      components: baseComponents,
    };
  }
}
