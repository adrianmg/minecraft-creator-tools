// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * BlocksCatalogRulePairs — paired E2E coverage for the resource pack blocks
 * catalog manager (BLOCKSCAT), which checks blocks.json entries against the
 * block types the project defines and the vanilla block catalog.
 *
 * Both pairs share a base that defines one custom block type in the behavior
 * pack; only the catalog entry in blocks.json varies:
 *   - an entry matching the custom block id is a supported definition,
 *   - an entry matching no block anywhere is unused (100),
 *   - a colon-less entry matching a vanilla block id (via
 *     Database.getVanillaMatches over the prebuilt vanilla content index) is
 *     a vanilla override (102).
 */

import { InfoItemType } from "../../info/IInfoItemData";
import { ProjectInfoSuite } from "../../info/IProjectInfoData";
import {
  ValidationFixtureFiles,
  ValidationRuleCoveragePair,
  ValidationResultExpectation,
} from "../ValidationRuleHarness";
import { ValidationRuleKey } from "../../info/tests/ValidationRuleDefinition";
import {
  BpRoot,
  RpRoot,
  PinnedVersion,
  coveragePairFromBase,
  json,
  minimalBpFiles,
  minimalRpFiles,
} from "./PairFixtureBuilders";

const HarnessBlockId = "test:harness_block";
const BlocksCatalogPath = `${RpRoot}/blocks.json`;

/** Custom block type definition backing the supported catalog entry. */
const harnessBlockFiles: ValidationFixtureFiles = {
  [`${BpRoot}/blocks/harness_block.json`]: json({
    format_version: PinnedVersion.join("."),
    "minecraft:block": {
      description: { identifier: HarnessBlockId, menu_category: { category: "construction" } },
      components: { "minecraft:destructible_by_mining": { seconds_to_destroy: 1.5 } },
    },
  }),
};

/** blocks.json catalog with a single block resource entry. */
function blocksCatalog(blockId: string): string {
  return json({
    format_version: [1, 1, 0],
    [blockId]: { textures: "harness_block", sound: "stone" },
  });
}

const blocksCatalogPair = (spec: {
  ruleIndex: number;
  slug: string;
  acceptingDescription: string;
  acceptingBlockId: string;
  rejectingDescription: string;
  rejectingBlockId: string;
  expectation: ValidationResultExpectation;
}): ValidationRuleCoveragePair =>
  coveragePairFromBase({
    ruleKey: `BLOCKSCAT:${spec.ruleIndex}` as ValidationRuleKey,
    category: "manager",
    suite: ProjectInfoSuite.defaultInDevelopment,
    baseFiles: { ...minimalBpFiles(), ...minimalRpFiles(), ...harnessBlockFiles },
    accepting: {
      id: `harness-blockscat-${spec.slug}-accept`,
      description: spec.acceptingDescription,
      files: { [BlocksCatalogPath]: blocksCatalog(spec.acceptingBlockId) },
    },
    rejecting: {
      id: `harness-blockscat-${spec.slug}-reject`,
      description: spec.rejectingDescription,
      files: { [BlocksCatalogPath]: blocksCatalog(spec.rejectingBlockId) },
    },
    rejectingExpectation: spec.expectation,
  });

export const BlocksCatalogRulePairs: readonly ValidationRuleCoveragePair[] = [
  blocksCatalogPair({
    ruleIndex: 100,
    slug: "unused-resource",
    acceptingDescription:
      "blocks.json entry matches the project's custom block type; BLOCKSCAT:100 must stay quiet.",
    acceptingBlockId: HarnessBlockId,
    rejectingDescription: "blocks.json entry matches no project or vanilla block; BLOCKSCAT:100 must flag it.",
    rejectingBlockId: "test:harness_unmatched_block",
    expectation: {
      severity: InfoItemType.warning,
      count: 1,
      projectPath: /blocks\.json$/,
      message: "Blocks catalog resource is not used",
      data: "test:harness_unmatched_block",
    },
  }),
  blocksCatalogPair({
    ruleIndex: 102,
    slug: "vanilla-override",
    acceptingDescription:
      "blocks.json entry matches the project's custom block type; BLOCKSCAT:102 must stay quiet.",
    acceptingBlockId: HarnessBlockId,
    rejectingDescription: "blocks.json entry overrides the vanilla stone block; BLOCKSCAT:102 must flag it.",
    rejectingBlockId: "stone",
    expectation: {
      severity: InfoItemType.recommendation,
      count: 1,
      projectPath: /blocks\.json$/,
      message: "Overrides vanilla resource",
      data: "stone",
    },
  }),
];
