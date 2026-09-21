// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * ItemFileRulePairs — paired E2E coverage for the generic item and file
 * validation rules: UNLINK (unfulfilled links and unused assets), UNKFILE
 * (disallowed file extensions), VALFILE (malformed and empty JSON), and
 * PATHLENGTH (path length, segment count, and casing conventions).
 *
 * UNKJSON:101 and NOBOM:101 keep their original representative pairs in
 * ValidationRuleHarnessPairs.ts; this module covers the remaining rules of
 * the family.
 *
 * File generators only run on files that map to project items, so every
 * fixture file here uses an extension the inference walker classifies
 * (.json, .png, .ogg, .mp3, .lang). VALFILE emits only on failures and is
 * not always-process, so each VALFILE pair carries a second, constant
 * "anchor" file that trips the sibling rule in both fixtures — proving the
 * generator ran — while the file under test differs.
 *
 * Path rules are exercised at their exact boundaries: the shared base holds
 * an at-the-limit path that must stay quiet, and the rejecting fixture adds
 * the one-over path (the single differing file).
 */

import { InfoItemType } from "../../info/IInfoItemData";
import { ProjectInfoSuite } from "../../info/IProjectInfoData";
import { ValidationRuleCoveragePair } from "../ValidationRuleHarness";
import { BpRoot, RpRoot, coveragePairFromBase, json, minimalBpFiles, minimalRpFiles, pngBytes } from "./PairFixtureBuilders";

// ---------------------------------------------------------------------------
// UNLINK — unfulfilled links (vanilla and in-pack) and unused assets.
// ---------------------------------------------------------------------------

const OrphanTexturePath = `${RpRoot}/textures/harness/harness_orphan.png`;
const ItemTextureJsonPath = `${RpRoot}/textures/item_texture.json`;

const itemTextureJson = (textureData: { [id: string]: { textures: string } }) =>
  json({
    resource_pack_name: "test_rp",
    texture_name: "atlas.items",
    texture_data: textureData,
  });

const unusedTextureBase = {
  ...minimalRpFiles(),
  [OrphanTexturePath]: pngBytes(16, 16),
};

const LootChildPath = `${BpRoot}/loot_tables/harness_child.json`;
const LootParentPath = `${BpRoot}/loot_tables/harness_parent.json`;

const lootTableReferencing = (lootTablePath: string) =>
  json({
    pools: [
      {
        rolls: 1,
        entries: [{ type: "loot_table", name: lootTablePath }],
      },
    ],
  });

const lootTableBase = {
  ...minimalBpFiles(),
  [LootChildPath]: json({ pools: [] }),
};

// ---------------------------------------------------------------------------
// PATHLENGTH — boundary paths, counted after the pack-root prefix is
// trimmed: "/behavior_packs/" is stripped, so "test_bp/..." is what counts.
// ---------------------------------------------------------------------------

const CountedPackPrefix = "test_bp/";

/** File name whose counted pack path ("test_bp/<name>") has exactly `length` characters. */
const nameOfCountedLength = (length: number) =>
  "harness_length_" + "a".repeat(length - CountedPackPrefix.length - "harness_length_".length - ".json".length) + ".json";

const AtLimitLengthName = nameOfCountedLength(100);
const OverLimitLengthName = nameOfCountedLength(101);

// Nine counted segments (test_bp + seven folders + file) is the last quiet
// boundary; the rejecting fixture adds a tenth via one more folder.
const NineSegmentPath = `${BpRoot}/d01/d02/d03/d04/d05/d06/d07/harness_seg.json`;
const TenSegmentPath = `${BpRoot}/d01/d02/d03/d04/d05/d06/d07/d08/harness_deep.json`;

const markerJson = json({ harness_marker: true });

const pathRuleBase = {
  ...minimalBpFiles(),
  // Exactly at both boundaries: 100 counted characters and 9 counted segments.
  [`${BpRoot}/${AtLimitLengthName}`]: markerJson,
  [NineSegmentPath]: markerJson,
  // Uppercase under texts/ and .lang are supported conventions that must stay quiet.
  [`${BpRoot}/texts/HarnessNotes.lang`]: "harness.title=Harness\n",
};

// ---------------------------------------------------------------------------
// VALFILE — malformed and empty JSON, at the exact two-character boundary.
// ---------------------------------------------------------------------------

const EmptyAnchorPath = `${BpRoot}/data/harness_empty.json`;
const BrokenAnchorPath = `${BpRoot}/data/harness_broken.json`;
const SyntaxTargetPath = `${BpRoot}/data/harness_syntax.json`;
const LengthTargetPath = `${BpRoot}/data/harness_len.json`;

export const ItemFileRulePairs: readonly ValidationRuleCoveragePair[] = [
  coveragePairFromBase({
    ruleKey: "UNLINK:191",
    category: "projectItem",
    suite: ProjectInfoSuite.defaultInDevelopment,
    baseFiles: unusedTextureBase,
    accepting: {
      id: "harness-unlink-unused-texture-accept",
      description: "Pack texture referenced from item_texture.json; UNLINK:191 must stay quiet.",
      files: {
        [ItemTextureJsonPath]: itemTextureJson({
          harness_orphan: { textures: "textures/harness/harness_orphan" },
        }),
      },
    },
    rejecting: {
      id: "harness-unlink-unused-texture-reject",
      description: "The same texture with no references anywhere in the pack; UNLINK:191 must flag it.",
      files: {
        [ItemTextureJsonPath]: itemTextureJson({}),
      },
    },
    rejectingExpectation: {
      severity: InfoItemType.warning,
      count: 1,
      projectPath: /harness_orphan\.png$/,
      message: "does not have any items in this pack that are using this",
    },
  }),

  coveragePairFromBase({
    ruleKey: "UNLINK:205",
    category: "projectItem",
    suite: ProjectInfoSuite.defaultInDevelopment,
    baseFiles: lootTableBase,
    accepting: {
      id: "harness-unlink-vanilla-loot-accept",
      description: "Loot table linking to a loot table in the same pack; UNLINK:205 must stay quiet.",
      files: {
        [LootParentPath]: lootTableReferencing("loot_tables/harness_child"),
      },
    },
    rejecting: {
      id: "harness-unlink-vanilla-loot-reject",
      description: "Loot table linking to the vanilla zombie loot table; UNLINK:205 must recommend avoiding it.",
      files: {
        [LootParentPath]: lootTableReferencing("loot_tables/entities/zombie"),
      },
    },
    rejectingExpectation: {
      severity: InfoItemType.recommendation,
      count: 1,
      projectPath: /harness_parent\.json$/,
      message: "avoid if possible",
      data: "loot_tables/entities/zombie",
    },
  }),

  coveragePairFromBase({
    ruleKey: "UNLINK:324",
    category: "projectItem",
    suite: ProjectInfoSuite.defaultInDevelopment,
    baseFiles: lootTableBase,
    accepting: {
      id: "harness-unlink-loot-missing-accept",
      description: "Loot table linking to a loot table present in the pack; UNLINK:324 must stay quiet.",
      files: {
        [LootParentPath]: lootTableReferencing("loot_tables/harness_child"),
      },
    },
    rejecting: {
      id: "harness-unlink-loot-missing-reject",
      description: "Loot table linking to a loot table that exists nowhere; UNLINK:324 must flag the dangling link.",
      files: {
        [LootParentPath]: lootTableReferencing("loot_tables/harness_missing"),
      },
    },
    rejectingExpectation: {
      severity: InfoItemType.warning,
      count: 1,
      projectPath: /harness_parent\.json$/,
      message: "is not found in this pack",
    },
  }),

  // UNKFILE:102 has no pair: NodeFolder.load only lists files whose extension
  // passes StorageUtilities.isUsableFile, so a disallowed-extension file never
  // reaches the pipeline on node storage — the rule is reachable only through
  // browser FileSystemStorage folders. Zip containers are no back door either:
  // ZipFolder applies the same isUsableFile filter unless the storage opts
  // into allowAllFiles, which the validation pipeline does not.

  coveragePairFromBase({
    ruleKey: "VALFILE:102",
    category: "file",
    suite: ProjectInfoSuite.defaultInDevelopment,
    baseFiles: {
      ...minimalBpFiles(),
      [EmptyAnchorPath]: "",
    },
    accepting: {
      id: "harness-valfile-compliant-accept",
      description: "Parseable JSON alongside the empty-file anchor; VALFILE:102 must stay quiet.",
      files: {
        [SyntaxTargetPath]: markerJson,
      },
    },
    rejecting: {
      id: "harness-valfile-compliant-reject",
      description: "The same JSON file truncated mid-object; VALFILE:102 must flag it.",
      files: {
        [SyntaxTargetPath]: '{"harness_marker":',
      },
    },
    rejectingExpectation: {
      severity: InfoItemType.error,
      count: 1,
      message: "JSON file is not JSON compliant",
    },
  }),

  coveragePairFromBase({
    ruleKey: "VALFILE:103",
    category: "file",
    suite: ProjectInfoSuite.defaultInDevelopment,
    baseFiles: {
      ...minimalBpFiles(),
      [BrokenAnchorPath]: '{"harness_marker":',
    },
    accepting: {
      id: "harness-valfile-empty-accept",
      description: "A two-character JSON file, the exact minimum length; VALFILE:103 must stay quiet.",
      files: {
        [LengthTargetPath]: "{}",
      },
    },
    rejecting: {
      id: "harness-valfile-empty-reject",
      description: "A one-character JSON file, one below the minimum; VALFILE:103 must flag it.",
      files: {
        [LengthTargetPath]: "{",
      },
    },
    rejectingExpectation: {
      severity: InfoItemType.error,
      count: 1,
      message: "JSON file is empty",
      data: "1 characters",
    },
  }),

  coveragePairFromBase({
    ruleKey: "PATHLENGTH:102",
    category: "file",
    suite: ProjectInfoSuite.defaultInDevelopment,
    baseFiles: pathRuleBase,
    accepting: {
      id: "harness-pathlength-segments-accept",
      description: "Deepest pack path at exactly nine counted segments; PATHLENGTH:102 must stay quiet.",
    },
    rejecting: {
      id: "harness-pathlength-segments-reject",
      description: "A pack path with a tenth counted segment; PATHLENGTH:102 must flag it.",
      files: {
        [TenSegmentPath]: markerJson,
      },
    },
    rejectingExpectation: {
      severity: InfoItemType.error,
      count: 1,
      message: "8 or more directory segments",
      data: "test_bp/d01/d02/d03/d04/d05/d06/d07/d08/harness_deep.json",
    },
  }),

  coveragePairFromBase({
    ruleKey: "PATHLENGTH:103",
    category: "file",
    suite: ProjectInfoSuite.defaultInDevelopment,
    baseFiles: pathRuleBase,
    accepting: {
      id: "harness-pathlength-length-accept",
      description: "Pack path at exactly 100 counted characters; PATHLENGTH:103 must stay quiet.",
    },
    rejecting: {
      id: "harness-pathlength-length-reject",
      description: "Pack path at 101 counted characters; PATHLENGTH:103 must flag it.",
      files: {
        [`${BpRoot}/${OverLimitLengthName}`]: markerJson,
      },
    },
    rejectingExpectation: {
      severity: InfoItemType.error,
      count: 1,
      message: "more than 100 characters",
      data: CountedPackPrefix + OverLimitLengthName,
    },
  }),

  coveragePairFromBase({
    ruleKey: "PATHLENGTH:104",
    category: "file",
    suite: ProjectInfoSuite.defaultInDevelopment,
    baseFiles: pathRuleBase,
    accepting: {
      id: "harness-pathlength-casing-accept",
      description:
        "All-lowercase pack paths (uppercase only in the exempt texts/.lang location); PATHLENGTH:104 must stay quiet.",
    },
    rejecting: {
      id: "harness-pathlength-casing-reject",
      description: "A pack path with uppercase letters outside the exempt locations; PATHLENGTH:104 must flag it.",
      files: {
        [`${BpRoot}/misc/Harness_Case.json`]: markerJson,
      },
    },
    rejectingExpectation: {
      severity: InfoItemType.recommendation,
      count: 1,
      message: "File path contains non-lowercase letters",
      data: "/misc/Harness_Case.json",
    },
  }),
];
