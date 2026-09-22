// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * TextureRulePairs — paired E2E coverage for the texture family:
 * TEXTUREIMAGE (texture-image memory budgets, performance tiers, MER/MERS
 * subpack union rules, and vanilla override coverage), TEXTURELIST
 * (texture_list.json consistency), and TEXTURE (the add-on texture-handle
 * ceiling).
 *
 * Texture memory in the validators is width*height*4 computed from image
 * HEADER dimensions, so oversized-texture fixtures use stubPngBytes —
 * ~100-byte PNGs whose IHDR claims the target dimensions. Budget boundaries
 * are exercised exactly: accepting fixtures sit at == budget, rejecting
 * fixtures one row of pixels over.
 *
 * The vanilla-override rules (460/461/462) compare against the actual
 * vanilla texture inventory (public/data/mci/release.mci.json — the same
 * data Database.getVanillaPathList serves), so their fixtures generate one
 * tiny override image per vanilla game texture and cross the 70%/60%
 * thresholds by exactly one file.
 *
 * TEXTURELIST emits nothing on fully-clean content, so each accepting
 * fixture keeps the generator demonstrably applicable by tripping only the
 * sibling texture-list rule.
 */

// The generator classes participate in a module cycle with Project; loading
// them through the registration entry point first (as production does) keeps
// the cycle resolvable when this pairs module is the first thing a test
// loads. This side-effect import must stay ahead of the generator import.
import "../../info/registration/GeneratorRegistrations";
import * as fs from "fs";
import * as path from "path";
import { InfoItemType } from "../../info/IInfoItemData";
import { ProjectInfoSuite } from "../../info/IProjectInfoData";
import { ValidationRuleCoveragePair, ValidationFixtureFiles } from "../ValidationRuleHarness";
import { ValidationRuleKey } from "../../info/tests/ValidationRuleDefinition";
import TextureImageInfoGenerator from "../../info/projectGenerators/textureImageInfo/TextureImageInfoGenerator";
import StorageUtilities from "../../storage/StorageUtilities";
import TestPaths from "../TestPaths";
import {
  RpManifestPath,
  RpRoot,
  bpManifest,
  coveragePairFromBase,
  corruptPngBytes,
  json,
  minimalBpFiles,
  minimalRpFiles,
  pngBytes,
  rpManifest,
  stubPngBytes,
} from "./PairFixtureBuilders";
import { chunkRecordKey, worldFolderFiles } from "./WorldFixtureBytes";

const MiB = 1024 * 1024;

const tinyPng = pngBytes(1, 1);

// ---------------------------------------------------------------------------
// Vanilla override inventory (rules 460/461/462).
// ---------------------------------------------------------------------------

/** Vanilla game-texture paths, filtered exactly like TextureImageInfoGenerator. */
const vanillaGameTexturePaths: readonly string[] = (() => {
  const dataPath = path.join(TestPaths.publicRoot, "data", "mci", "release.mci.json");
  const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
  const items: unknown[] = data?.index?.items ?? [];

  return items.filter(
    (entry): entry is string =>
      typeof entry === "string" && entry.startsWith("/") && TextureImageInfoGenerator.isGameTexturePath(entry)
  );
})();

/** Unique extensionless override keys ("/resource_pack/textures/..."), sorted. */
const overrideKeys: readonly string[] = [
  ...new Set(vanillaGameTexturePaths.map((entry) => StorageUtilities.stripExtension(entry))),
].sort();

const vanillaEntryCount = vanillaGameTexturePaths.length;

if (overrideKeys.length < 100 || (overrideKeys.length - 1) / vanillaEntryCount < 0.95) {
  throw new Error(
    `Vanilla texture inventory shape changed (entries ${vanillaEntryCount}, unique ${overrideKeys.length}); ` +
      "the override-coverage fixtures need near-1:1 unique keys."
  );
}

/** RP-relative override image path for a vanilla override key. */
const overridePathForKey = (key: string) => `${RpRoot}/${key.substring("/resource_pack/".length)}.png`;

/** One tiny override image per given key (all sharing a single PNG buffer). */
function overrideFiles(keys: readonly string[]): ValidationFixtureFiles {
  const files: { [relativePath: string]: Uint8Array } = {};

  for (const key of keys) {
    files[overridePathForKey(key)] = tinyPng;
  }

  return files;
}

const overrideCountFor = (percent: number) => Math.ceil(percent * vanillaEntryCount);

// ---------------------------------------------------------------------------
// Shared fixture ingredients.
// ---------------------------------------------------------------------------

const LoosePath = `${RpRoot}/textures/environment/harness_env.png`;
const AtlasTexturePath = `${RpRoot}/textures/blocks/harness_big.png`;

/** terrain_texture.json that makes textures/blocks/harness_big block-related (atlassed). */
const terrainTextureCatalog: ValidationFixtureFiles = {
  [`${RpRoot}/textures/terrain_texture.json`]: json({
    resource_pack_name: "harness",
    texture_name: "atlas.terrain",
    padding: 8,
    num_mip_levels: 4,
    texture_data: {
      harness_big: { textures: "textures/blocks/harness_big" },
    },
  }),
};

const addOnPackOptions = {
  metadata: { product_type: "addon" },
  headerExtras: { pack_scope: "world" },
};

/** BP+RP manifests shaped so ProjectUtilities.getMetaCategory returns addOn. */
const addOnManifests: ValidationFixtureFiles = {
  ...minimalBpFiles(bpManifest(addOnPackOptions)),
  ...minimalRpFiles(rpManifest(addOnPackOptions)),
};

const rpManifestWithSubpackTier = (tier: number, folderName: string = "sub_a") =>
  json(rpManifest({ subpacks: [{ folder_name: folderName, name: `Tier ${tier}`, memory_performance_tier: tier }] }));

const addOnRpManifestWithSubpackTier = (tier: number) =>
  json(
    rpManifest({
      ...addOnPackOptions,
      subpacks: [{ folder_name: "sub_a", name: `Tier ${tier}`, memory_performance_tier: tier }],
    })
  );

/** width/height whose memory (w*h*4) is exactly the given MiB budget. */
const dimensionsForMiB: { [mib: number]: [number, number] } = {
  150: [6144, 6400],
  225: [7680, 7680],
  300: [8192, 9600],
  350: [8960, 10240],
  500: [12800, 10240],
  600: [12288, 12800],
  650: [13312, 12800],
  800: [16384, 12800],
  1250: [25600, 12800],
  1650: [33792, 12800],
};

for (const [mib, [width, height]] of Object.entries(dimensionsForMiB)) {
  if (width * height * 4 !== Number(mib) * MiB) {
    throw new Error(`Texture budget dimension table is wrong for ${mib} MiB.`);
  }
}

const atBudgetPng = (mib: number) => stubPngBytes(dimensionsForMiB[mib][0], dimensionsForMiB[mib][1]);
const overBudgetPng = (mib: number) => stubPngBytes(dimensionsForMiB[mib][0], dimensionsForMiB[mib][1] + 1);

const AddOnTierBudgetsMiB = [150, 150, 225, 300, 600, 800] as const;
const TexturePackTierBudgetsMiB = [350, 350, 500, 650, 1250, 1650] as const;

const texImagePair = (spec: {
  ruleIndex: number;
  slug: string;
  baseFiles: ValidationFixtureFiles;
  acceptingDescription: string;
  acceptingFiles?: ValidationFixtureFiles;
  rejectingDescription: string;
  rejectingFiles?: ValidationFixtureFiles;
  expectation: Parameters<typeof coveragePairFromBase>[0]["rejectingExpectation"];
}): ValidationRuleCoveragePair =>
  coveragePairFromBase({
    ruleKey: `TEXTUREIMAGE:${spec.ruleIndex}` as ValidationRuleKey,
    category: "project",
    suite: ProjectInfoSuite.defaultInDevelopment,
    baseFiles: spec.baseFiles,
    accepting: {
      id: `harness-textureimage-${spec.slug}-accept`,
      description: spec.acceptingDescription,
      files: spec.acceptingFiles,
    },
    rejecting: {
      id: `harness-textureimage-${spec.slug}-reject`,
      description: spec.rejectingDescription,
      files: spec.rejectingFiles,
    },
    rejectingExpectation: spec.expectation,
  });

const textureImagePairs: ValidationRuleCoveragePair[] = [
  texImagePair({
    ruleIndex: 402,
    slug: "loose-budget",
    baseFiles: minimalRpFiles(),
    acceptingDescription:
      "Loose texture at exactly the 16 MiB individual budget (2048x2048); TEXTUREIMAGE:402 must stay quiet.",
    acceptingFiles: { [LoosePath]: stubPngBytes(2048, 2048) },
    rejectingDescription: "Loose texture over the 16 MiB individual budget; TEXTUREIMAGE:402 must warn.",
    rejectingFiles: { [LoosePath]: stubPngBytes(2560, 2048) },
    expectation: {
      severity: InfoItemType.warning,
      count: 1,
      projectPath: /harness_env\.png$/,
      message: "loose texture memory exceeds budget",
      data: 2560 * 2048 * 4,
    },
  }),

  texImagePair({
    ruleIndex: 403,
    slug: "total-budget",
    baseFiles: addOnManifests,
    acceptingDescription:
      "Add-on with total texture memory exactly at the 150 MiB base budget; TEXTUREIMAGE:403 must stay quiet.",
    acceptingFiles: { [LoosePath]: atBudgetPng(150) },
    rejectingDescription: "Add-on with total texture memory over the 150 MiB base budget; TEXTUREIMAGE:403 must flag it.",
    rejectingFiles: { [LoosePath]: overBudgetPng(150) },
    expectation: {
      severity: InfoItemType.error,
      count: 1,
      message: "not using subpacks to target specific tiers",
      data: (dimensionsForMiB[150][0] * (dimensionsForMiB[150][1] + 1)) * 4,
    },
  }),

  texImagePair({
    ruleIndex: 405,
    slug: "atlas-individual",
    baseFiles: { ...minimalRpFiles(), ...terrainTextureCatalog },
    acceptingDescription:
      "Atlassed block texture at exactly the 256 KiB individual budget (256x256); TEXTUREIMAGE:405 must stay quiet.",
    acceptingFiles: { [AtlasTexturePath]: stubPngBytes(256, 256) },
    rejectingDescription: "Atlassed block texture over the 256 KiB individual budget; TEXTUREIMAGE:405 must warn.",
    rejectingFiles: { [AtlasTexturePath]: stubPngBytes(512, 512) },
    expectation: {
      severity: InfoItemType.warning,
      count: 1,
      projectPath: /harness_big\.png$/,
      message: "atlassed texture memory exceeds budget",
      data: 512 * 512 * 4,
    },
  }),

  texImagePair({
    ruleIndex: 406,
    slug: "atlas-total-warn",
    baseFiles: { ...minimalRpFiles(), ...terrainTextureCatalog },
    acceptingDescription:
      "Block atlas at exactly the 64 MiB recommended budget (4096x4096); TEXTUREIMAGE:406 must stay quiet.",
    acceptingFiles: { [AtlasTexturePath]: stubPngBytes(4096, 4096) },
    rejectingDescription: "Block atlas over the 64 MiB recommended budget; TEXTUREIMAGE:406 must warn.",
    rejectingFiles: { [AtlasTexturePath]: stubPngBytes(8192, 4096) },
    expectation: {
      severity: InfoItemType.warning,
      // The atlas budget check runs once per performance tier (6 tiers).
      count: 6,
      message: "block atlas exceeds budget",
      data: 8192 * 4096 * 4,
    },
  }),

  texImagePair({
    ruleIndex: 407,
    slug: "atlas-total-error",
    baseFiles: { ...minimalRpFiles(), ...terrainTextureCatalog },
    acceptingDescription:
      "Block atlas at exactly the 256 MiB hard limit (8192x8192, tripping only the recommended-budget warning); TEXTUREIMAGE:407 must stay quiet.",
    acceptingFiles: { [AtlasTexturePath]: stubPngBytes(8192, 8192) },
    rejectingDescription: "Block atlas over the 256 MiB hard limit; TEXTUREIMAGE:407 must flag it.",
    rejectingFiles: { [AtlasTexturePath]: stubPngBytes(8192, 16384) },
    expectation: {
      severity: InfoItemType.error,
      // The atlas limit check runs once per performance tier (6 tiers).
      count: 6,
      message: "block atlas exceeds hard limit",
      data: 8192 * 16384 * 4,
    },
  }),

  texImagePair({
    ruleIndex: 408,
    slug: "unreadable-image",
    baseFiles: minimalRpFiles(),
    acceptingDescription: "Well-formed PNG; TEXTUREIMAGE:408 must stay quiet.",
    acceptingFiles: { [`${RpRoot}/textures/environment/harness_meta.png`]: pngBytes(8, 8) },
    rejectingDescription: "PNG with an unreadable header; TEXTUREIMAGE:408 must warn.",
    rejectingFiles: { [`${RpRoot}/textures/environment/harness_meta.png`]: corruptPngBytes() },
    expectation: {
      severity: InfoItemType.warning,
      count: 1,
      projectPath: /harness_meta\.png$/,
      message: "Could not extract metadata",
    },
  }),

  texImagePair({
    ruleIndex: 409,
    slug: "tier-ordering",
    baseFiles: {
      [RpManifestPath]: json(
        rpManifest({
          subpacks: [
            { folder_name: "sub_lo", name: "Low", memory_performance_tier: 2 },
            { folder_name: "sub_hi", name: "High", memory_performance_tier: 3 },
          ],
        })
      ),
      [`${RpRoot}/textures/environment/harness_t409.png`]: stubPngBytes(16, 16),
      [`${RpRoot}/subpacks/sub_hi/textures/environment/harness_t409.png`]: stubPngBytes(16, 16),
    },
    acceptingDescription:
      "Lower-tier subpack texture no larger than the higher tier's; TEXTUREIMAGE:409 must stay quiet.",
    acceptingFiles: { [`${RpRoot}/subpacks/sub_lo/textures/environment/harness_t409.png`]: stubPngBytes(16, 16) },
    rejectingDescription:
      "Tier-2 subpack requiring more texture memory than tier 3; TEXTUREIMAGE:409 must flag the inversion.",
    rejectingFiles: { [`${RpRoot}/subpacks/sub_lo/textures/environment/harness_t409.png`]: stubPngBytes(2048, 2048) },
    expectation: {
      severity: InfoItemType.error,
      count: 1,
      message: "has a higher memory requirement",
    },
  }),

  texImagePair({
    ruleIndex: 410,
    slug: "vibrant-visuals-tiering",
    baseFiles: { [LoosePath]: stubPngBytes(16384, 16384) },
    acceptingDescription:
      "Resource pack without the pbr capability carrying heavy textures; TEXTUREIMAGE:410 must stay quiet.",
    acceptingFiles: minimalRpFiles(),
    rejectingDescription:
      "PBR-capable resource pack whose textures exceed the tier-2 budget; TEXTUREIMAGE:410 must flag it.",
    rejectingFiles: minimalRpFiles(rpManifest({ capabilities: ["pbr"] })),
    expectation: {
      severity: InfoItemType.error,
      count: 1,
      message: "vibrant visuals",
      data: 16384 * 16384 * 4,
    },
  }),

  texImagePair({
    ruleIndex: 411,
    slug: "four-mib-mip",
    baseFiles: minimalRpFiles(),
    acceptingDescription:
      "Texture at exactly the 4 MiB highest-resolution-mip budget (1024x1024); TEXTUREIMAGE:411 must stay quiet.",
    acceptingFiles: { [LoosePath]: stubPngBytes(1024, 1024) },
    rejectingDescription: "Texture over the 4 MiB highest-resolution-mip budget; TEXTUREIMAGE:411 must warn.",
    rejectingFiles: { [LoosePath]: stubPngBytes(1024, 2048) },
    expectation: {
      severity: InfoItemType.warning,
      count: 1,
      projectPath: /harness_env\.png$/,
      message: "exceeds the 4 MiB budget",
      data: 1024 * 2048 * 4,
    },
  }),

  // Targeted-tier errors (420+tier): an add-on that explicitly targets each
  // performance tier via a subpack and exceeds that tier's budget.
  ...AddOnTierBudgetsMiB.map((budgetMiB, tier) =>
    texImagePair({
      ruleIndex: 420 + tier,
      slug: `tier-${tier}-targeted`,
      baseFiles: {
        ...minimalBpFiles(bpManifest(addOnPackOptions)),
        [RpManifestPath]: addOnRpManifestWithSubpackTier(tier),
      },
      acceptingDescription: `Add-on targeting tier ${tier} at exactly its ${budgetMiB} MiB budget; TEXTUREIMAGE:${
        420 + tier
      } must stay quiet.`,
      acceptingFiles: { [LoosePath]: atBudgetPng(budgetMiB) },
      rejectingDescription: `Add-on targeting tier ${tier} over its ${budgetMiB} MiB budget; TEXTUREIMAGE:${
        420 + tier
      } must flag it.`,
      rejectingFiles: { [LoosePath]: overBudgetPng(budgetMiB) },
      expectation: {
        severity: InfoItemType.error,
        count: 1,
        message: `at tier ${tier}`,
      },
    })
  ),

  // Tier budget warnings (440+tier): texture-pack-shaped content whose total
  // memory crosses each tier's budget.
  ...TexturePackTierBudgetsMiB.map((budgetMiB, tier) =>
    texImagePair({
      ruleIndex: 440 + tier,
      slug: `tier-${tier}-budget`,
      baseFiles: minimalRpFiles(),
      acceptingDescription: `Texture memory at exactly the ${budgetMiB} MiB tier ${tier} budget; TEXTUREIMAGE:${
        440 + tier
      } must stay quiet.`,
      acceptingFiles: { [LoosePath]: atBudgetPng(budgetMiB) },
      rejectingDescription: `Texture memory over the ${budgetMiB} MiB tier ${tier} budget; TEXTUREIMAGE:${
        440 + tier
      } must warn.`,
      rejectingFiles: { [LoosePath]: overBudgetPng(budgetMiB) },
      expectation: {
        severity: InfoItemType.warning,
        count: 1,
        message: `at tier ${tier}`,
      },
    })
  ),

  texImagePair({
    ruleIndex: 460,
    slug: "vanilla-override-gap",
    baseFiles: { ...minimalRpFiles(), ...overrideFiles(overrideKeys.slice(0, overrideKeys.length - 1)) },
    acceptingDescription:
      "Texture pack overriding every vanilla game texture; TEXTUREIMAGE:460 must stay quiet.",
    acceptingFiles: overrideFiles(overrideKeys.slice(overrideKeys.length - 1)),
    rejectingDescription:
      "Texture pack overriding all but one vanilla game texture; TEXTUREIMAGE:460 must warn about the gap.",
    expectation: {
      severity: InfoItemType.warning,
      count: 1,
      message: "does not override vanilla texture",
      data: overrideKeys[overrideKeys.length - 1],
    },
  }),

  texImagePair({
    ruleIndex: 461,
    slug: "texture-pack-coverage",
    baseFiles: { ...minimalRpFiles(), ...overrideFiles(overrideKeys.slice(0, overrideCountFor(0.7) - 1)) },
    acceptingDescription:
      "Resource pack overriding just under 70% of vanilla textures (below the texture-pack threshold); TEXTUREIMAGE:461 must stay quiet.",
    rejectingDescription:
      "Texture pack crossing the 70% override threshold without reaching 95% coverage; TEXTUREIMAGE:461 must flag it.",
    rejectingFiles: overrideFiles(overrideKeys.slice(overrideCountFor(0.7) - 1, overrideCountFor(0.7))),
    expectation: {
      severity: InfoItemType.error,
      count: 1,
      message: "should override at least 95% of vanilla textures",
    },
  }),

  texImagePair({
    ruleIndex: 462,
    slug: "mashup-coverage",
    baseFiles: {
      ...minimalRpFiles(),
      ...worldFolderFiles("worlds/harness_world", "Harness Mashup World", [
        { key: chunkRecordKey(0, 0, 0, 44), value: new Uint8Array([40]) },
      ]),
      ...overrideFiles(overrideKeys.slice(0, overrideCountFor(0.6) - 1)),
    },
    acceptingDescription:
      "Mashup (world + global resource pack) overriding at least 60% of vanilla textures; TEXTUREIMAGE:462 must stay quiet.",
    acceptingFiles: overrideFiles(overrideKeys.slice(overrideCountFor(0.6) - 1, overrideCountFor(0.6))),
    rejectingDescription:
      "Mashup whose resource pack overrides less than 60% of vanilla textures; TEXTUREIMAGE:462 must flag it.",
    expectation: {
      severity: InfoItemType.error,
      count: 1,
      message: "mashup pack",
    },
  }),

  texImagePair({
    ruleIndex: 463,
    slug: "base-content-unused",
    baseFiles: {
      [`${RpRoot}/textures/environment/harness_o1.png`]: tinyPng,
      [`${RpRoot}/textures/environment/harness_o2.png`]: tinyPng,
      [`${RpRoot}/subpacks/sub_a/textures/environment/harness_o1.png`]: tinyPng,
      [`${RpRoot}/subpacks/sub_a/textures/environment/harness_o2.png`]: tinyPng,
    },
    acceptingDescription:
      "Subpack at tier 1 duplicating base pack content (the base pack still serves tier 1); TEXTUREIMAGE:463 must stay quiet.",
    acceptingFiles: { [RpManifestPath]: rpManifestWithSubpackTier(1) },
    rejectingDescription:
      "Lowest subpack tier of 2 with its content fully duplicated in the base pack; TEXTUREIMAGE:463 must warn.",
    rejectingFiles: { [RpManifestPath]: rpManifestWithSubpackTier(2) },
    expectation: {
      severity: InfoItemType.warning,
      count: 1,
      message: "consider specifying an empty subpack",
      data: 1,
    },
  }),

  texImagePair({
    ruleIndex: 464,
    slug: "tier-one-mers",
    baseFiles: { [`${RpRoot}/textures/blocks/harness_stone_mer.png`]: tinyPng },
    acceptingDescription:
      "MER material files with the subpack targeting tier 2 (never loaded at tier 1); TEXTUREIMAGE:464 must stay quiet.",
    acceptingFiles: { [RpManifestPath]: rpManifestWithSubpackTier(2) },
    rejectingDescription:
      "Tier-1 subpack whose union with the base pack loads MER material files; TEXTUREIMAGE:464 must flag it.",
    rejectingFiles: { [RpManifestPath]: rpManifestWithSubpackTier(1) },
    expectation: {
      severity: InfoItemType.error,
      count: 1,
      message: "corrupt textures on the lowest performance tier",
    },
  }),
];

// ---------------------------------------------------------------------------
// TEXTURELIST — texture_list.json consistency. The generator is silent on
// clean content, so each accepting fixture trips only the sibling rule.
// ---------------------------------------------------------------------------

const ListedTexturePath = `${RpRoot}/textures/environment/harness_la.png`;
const ColorStem = "textures/blocks/harness_st";
const SetImageStem = "textures/blocks/harness_st_mer";

// A texture set's tracked "set images" are its material layers (MER/MERS,
// heightmap, normal) — the color layer stays an ordinary listed texture.
const textureListBase: ValidationFixtureFiles = {
  ...minimalRpFiles(),
  [ListedTexturePath]: tinyPng,
  [`${RpRoot}/${ColorStem}.png`]: tinyPng,
  [`${RpRoot}/${SetImageStem}.png`]: tinyPng,
  [`${RpRoot}/${ColorStem}.texture_set.json`]: json({
    format_version: "1.16.100",
    "minecraft:texture_set": { color: "harness_st", metalness_emissive_roughness: "harness_st_mer" },
  }),
};

const textureListJsonPath = `${RpRoot}/textures/texture_list.json`;

const textureListPairs: ValidationRuleCoveragePair[] = [
  coveragePairFromBase({
    ruleKey: "TEXTURELIST:101",
    category: "project",
    suite: ProjectInfoSuite.defaultInDevelopment,
    baseFiles: textureListBase,
    accepting: {
      id: "harness-texturelist-unlisted-accept",
      description:
        "texture_list.json listing every pack texture (and, to keep the generator applicable, a texture-set image tripping only rule 102); TEXTURELIST:101 must stay quiet.",
      files: { [textureListJsonPath]: json([ColorStem, SetImageStem, "textures/environment/harness_la"]) },
    },
    rejecting: {
      id: "harness-texturelist-unlisted-reject",
      description: "texture_list.json missing a pack texture; TEXTURELIST:101 must flag the unlisted texture.",
      files: { [textureListJsonPath]: json([ColorStem, SetImageStem]) },
    },
    rejectingExpectation: {
      severity: InfoItemType.error,
      count: 1,
      projectPath: /harness_la\.png$/,
      message: "is not referenced in texture_list.json",
      data: "textures/environment/harness_la",
    },
  }),
  coveragePairFromBase({
    ruleKey: "TEXTURELIST:102",
    category: "project",
    suite: ProjectInfoSuite.defaultInDevelopment,
    baseFiles: textureListBase,
    accepting: {
      id: "harness-texturelist-set-image-accept",
      description:
        "texture_list.json without texture-set images (leaving one ordinary texture unlisted so the generator stays applicable via rule 101); TEXTURELIST:102 must stay quiet.",
      files: { [textureListJsonPath]: json([ColorStem]) },
    },
    rejecting: {
      id: "harness-texturelist-set-image-reject",
      description: "texture_list.json referencing a texture-set image; TEXTURELIST:102 must flag the entry.",
      files: { [textureListJsonPath]: json([ColorStem, SetImageStem]) },
    },
    rejectingExpectation: {
      severity: InfoItemType.error,
      count: 1,
      message: "Texture set image must not be referenced",
      data: SetImageStem,
    },
  }),
];

// ---------------------------------------------------------------------------
// TEXTURE — the 800-texture-handle add-on ceiling (cooperativeAddOn suite).
// ---------------------------------------------------------------------------

const entityWithTextureHandles = (count: number) => {
  const textures: { [key: string]: string } = {};

  for (let i = 0; i < count; i++) {
    textures[`slot_${i}`] = `textures/entity/harness_handle_${i}`;
  }

  return json({
    format_version: "1.10.0",
    "minecraft:client_entity": {
      description: { identifier: "test:harness_handles", textures },
    },
  });
};

const handleEntityPath = `${RpRoot}/entity/harness_handles.entity.json`;

const texturePairs: ValidationRuleCoveragePair[] = [
  coveragePairFromBase({
    ruleKey: "TEXTURE:100",
    category: "project",
    suite: ProjectInfoSuite.cooperativeAddOn,
    baseFiles: minimalRpFiles(),
    accepting: {
      id: "harness-texture-handles-accept",
      description: "Entity referencing exactly 800 texture handles (the inclusive limit); TEXTURE:100 must stay quiet.",
      files: { [handleEntityPath]: entityWithTextureHandles(800) },
    },
    rejecting: {
      id: "harness-texture-handles-reject",
      description: "Entity referencing 801 texture handles; TEXTURE:100 must flag the overage.",
      files: { [handleEntityPath]: entityWithTextureHandles(801) },
    },
    rejectingExpectation: {
      severity: InfoItemType.error,
      count: 1,
      message: "more than 800 texture handles",
      data: 801,
    },
  }),
];

export const TextureRulePairs: readonly ValidationRuleCoveragePair[] = [
  ...textureImagePairs,
  ...textureListPairs,
  ...texturePairs,
];
