// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * ItemTypeRulePairs — paired E2E coverage for the behavior pack item type
 * manager (ITEMTYPE), which checks item definition format_versions against
 * the pinned current product version (TestVersionPin via
 * Database.getLatestVersionInfo).
 *
 * The six version-boundary pairs come from the shared type-manager case
 * table (typeManagerFormatVersionPairs); the missing-format_version rule is
 * declared here — unlike EntityTypeManager, this manager checks the raw
 * format_version property, so any parseable definition that omits it is
 * flagged (see ItemTypeManagerData.ts).
 */

import { InfoItemType } from "../../info/IInfoItemData";
import { ProjectInfoSuite } from "../../info/IProjectInfoData";
import { ValidationRuleCoveragePair } from "../ValidationRuleHarness";
import {
  BpRoot,
  PinnedVersion,
  coveragePairFromBase,
  json,
  minimalBpFiles,
  typeManagerFormatVersionPairs,
} from "./PairFixtureBuilders";

const ItemDefPath = `${BpRoot}/items/harness_item.json`;

function itemContent(formatVersion: readonly number[] | undefined): string {
  const value: any = {
    "minecraft:item": {
      description: {
        identifier: "test:harness_item",
        menu_category: { category: "items" },
      },
      components: { "minecraft:max_stack_size": 64 },
    },
  };

  if (formatVersion !== undefined) {
    value.format_version = formatVersion.join(".");
  }

  return json(value);
}

const missingFormatVersionPair: ValidationRuleCoveragePair = coveragePairFromBase({
  ruleKey: "ITEMTYPE:100",
  category: "manager",
  suite: ProjectInfoSuite.defaultInDevelopment,
  baseFiles: minimalBpFiles(),
  accepting: {
    id: "harness-itemtype-no-fv-accept",
    description: "Item type definition with the current format_version; ITEMTYPE:100 must stay quiet.",
    files: { [ItemDefPath]: itemContent(PinnedVersion) },
  },
  rejecting: {
    id: "harness-itemtype-no-fv-reject",
    description: "Item type definition without a format_version; ITEMTYPE:100 must flag it.",
    files: { [ItemDefPath]: itemContent(undefined) },
  },
  rejectingExpectation: {
    severity: InfoItemType.error,
    count: 1,
    projectPath: /harness_item\.json$/,
    message: "does not define a format_version",
  },
});

export const ItemTypeRulePairs: readonly ValidationRuleCoveragePair[] = [
  missingFormatVersionPair,
  ...typeManagerFormatVersionPairs({
    generatorId: "ITEMTYPE",
    familySlug: "itemtype",
    label: "Item type",
    defPath: ItemDefPath,
    packFiles: minimalBpFiles(),
    content: itemContent,
  }),
];
