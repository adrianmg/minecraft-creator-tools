// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { EntityContentTrait, IEntityTraitData, ITraitConfig } from "./ContentTraits";

/**
 * Breedable - can be bred to produce offspring.
 *
 * Config:
 * - `entityId`: full identifier of the entity (e.g. "demo:unicorn"). Used for
 *   `breeds_with.mate_type` / `baby_type`. When omitted, `breeds_with` is left out
 *   rather than emitting an invalid identifier.
 * - `breedItems`: items that put the entity into love mode. Default: ["wheat"].
 * - `breedCooldown`: seconds before the entity can breed again (`breed_cooldown`).
 */
export class BreedableEntityTrait extends EntityContentTrait {
  get id(): string {
    return "breedable";
  }

  getData(config?: ITraitConfig): IEntityTraitData {
    const breedItems = config?.breedItems ?? ["wheat"];
    const entityId: string | undefined = config?.entityId;
    const breedCooldown: number | undefined = config?.breedCooldown;

    const breedable: Record<string, any> = {
      require_tame: false,
      breed_items: breedItems,
    };

    if (entityId) {
      breedable.breeds_with = {
        mate_type: entityId,
        baby_type: entityId,
      };
    }

    if (breedCooldown !== undefined) {
      breedable.breed_cooldown = breedCooldown;
    }

    return {
      id: "breedable",
      displayName: "Breedable",
      description: "Can be bred to produce offspring",
      category: "interaction",
      components: {
        "minecraft:breedable": breedable,
        // Without the breed goal, entities enter love mode but never path to a mate.
        "minecraft:behavior.breed": { priority: 3, speed_multiplier: 1.0 },
      },
    };
  }
}
