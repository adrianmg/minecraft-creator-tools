// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * SkinPackRulePairs — paired E2E coverage for the CSPJ skin-pack family:
 * skins.json structure, purchase types, texture sizes and naming, cape and
 * Minecraft-Creator restrictions, orphaned assets, and localization
 * consistency.
 *
 * Every fixture is a complete skin pack (manifest + skins.json + textures +
 * texts/), mirroring samplecontent/sample_skins_good, and each rejecting
 * fixture differs from its accepting twin in exactly one file. Boundary
 * coverage: 2 free skins (the maximum) vs 3, and 80 skins (the maximum) vs
 * 81.
 */

import { InfoItemType } from "../../info/IInfoItemData";
import { ProjectInfoSuite } from "../../info/IProjectInfoData";
import { ValidationRuleCoveragePair, ValidationFixtureFiles, ValidationResultExpectation } from "../ValidationRuleHarness";
import { ValidationRuleKey } from "../../info/tests/ValidationRuleDefinition";
import {
  SkinPackRoot,
  SkinManifestPath,
  SkinsJsonPath,
  coveragePairFromBase,
  corruptPngBytes,
  json,
  langFiles,
  pngBytes,
  skinManifest,
} from "./PairFixtureBuilders";

const PackLocName = "harness_sp";

const skinTexture = pngBytes(64, 64);

interface ISkinSpec {
  localization_name: string;
  geometry?: string;
  texture: string;
  type?: string;
  cape?: string;
  animations?: string;
}

const skin = (locName: string, texture: string, extras?: Partial<ISkinSpec>): ISkinSpec => ({
  localization_name: locName,
  geometry: "geometry.humanoid.custom",
  texture,
  type: "paid",
  ...extras,
});

const skinsJson = (skins: ISkinSpec[], packOverrides?: { serialize_name?: string }) =>
  json({
    serialize_name: packOverrides?.serialize_name ?? PackLocName,
    localization_name: PackLocName,
    skins,
  });

const langForSkins = (skinLocNames: string[], extraLines: Record<string, string> = {}) =>
  langFiles(SkinPackRoot, {
    [`skinpack.${PackLocName}`]: "Harness Skin Pack",
    ...Object.fromEntries(skinLocNames.map((name) => [`skin.${PackLocName}.${name}`, name])),
    ...extraLines,
  });

/** A complete, fully-valid one-skin pack. */
const baseSkinPack: ValidationFixtureFiles = {
  [SkinManifestPath]: json(skinManifest()),
  [SkinsJsonPath]: skinsJson([skin("harness_one", "harness_one_custom.png")]),
  [`${SkinPackRoot}/harness_one_custom.png`]: skinTexture,
  ...langForSkins(["harness_one"]),
};

const cspjPair = (spec: {
  ruleIndex: number;
  slug: string;
  baseFiles: ValidationFixtureFiles;
  acceptingDescription: string;
  acceptingFiles?: ValidationFixtureFiles;
  rejectingDescription: string;
  rejectingFiles?: ValidationFixtureFiles;
  expectation: ValidationResultExpectation;
}): ValidationRuleCoveragePair =>
  coveragePairFromBase({
    ruleKey: `CSPJ:${spec.ruleIndex}` as ValidationRuleKey,
    category: "project",
    suite: ProjectInfoSuite.defaultInDevelopment,
    baseFiles: spec.baseFiles,
    accepting: {
      id: `harness-cspj-${spec.slug}-accept`,
      description: spec.acceptingDescription,
      files: spec.acceptingFiles,
    },
    rejecting: {
      id: `harness-cspj-${spec.slug}-reject`,
      description: spec.rejectingDescription,
      files: spec.rejectingFiles,
    },
    rejectingExpectation: spec.expectation,
  });

// CSPJ:101 — pack without skins.json. The base carries everything except
// skins.json; the accepting side adds it.
const { [SkinsJsonPath]: baseSkinsJson, ...skinPackWithoutSkinsJson } = baseSkinPack;

// CSPJ:104 / CSPJ:105 — three-skin pack shared by the free-skin and
// duplicate-texture pairs.
const threeSkinTextures: ValidationFixtureFiles = {
  [SkinManifestPath]: json(skinManifest()),
  [`${SkinPackRoot}/harness_one_custom.png`]: skinTexture,
  [`${SkinPackRoot}/harness_two_custom.png`]: skinTexture,
  [`${SkinPackRoot}/harness_three_custom.png`]: skinTexture,
  ...langForSkins(["harness_one", "harness_two", "harness_three"]),
};

const threeSkins = (types: [string, string, string]) =>
  skinsJson([
    skin("harness_one", "harness_one_custom.png", { type: types[0] }),
    skin("harness_two", "harness_two_custom.png", { type: types[1] }),
    skin("harness_three", "harness_three_custom.png", { type: types[2] }),
  ]);

// CSPJ:116 — 81 skins sharing one texture. Base lang declares all 81 keys;
// the accepting 80-skin pack leaves one lang key unused (tripping only the
// unrelated localized-key rule), keeping the pairs one file apart.
const manySkinLocNames = Array.from({ length: 81 }, (_, i) => `skin_${i.toString().padStart(3, "0")}`);

const manySkins = (count: number) =>
  skinsJson(manySkinLocNames.slice(0, count).map((locName) => skin(locName, "harness_shared_custom.png")));

const manySkinsBase: ValidationFixtureFiles = {
  [SkinManifestPath]: json(skinManifest()),
  [`${SkinPackRoot}/harness_shared_custom.png`]: skinTexture,
  ...langForSkins(manySkinLocNames),
};

export const SkinPackRulePairs: readonly ValidationRuleCoveragePair[] = [
  cspjPair({
    ruleIndex: 101,
    slug: "skins-json-missing",
    baseFiles: skinPackWithoutSkinsJson,
    acceptingDescription: "Skin pack with skins.json present; CSPJ:101 must stay quiet.",
    acceptingFiles: { [SkinsJsonPath]: baseSkinsJson },
    rejectingDescription: "Skin pack folder without skins.json; CSPJ:101 must flag it.",
    expectation: {
      severity: InfoItemType.error,
      count: 1,
      message: "Could not find skins.json file",
    },
  }),

  cspjPair({
    ruleIndex: 102,
    slug: "skins-json-schema",
    baseFiles: baseSkinPack,
    acceptingDescription: "Schema-valid skins.json; CSPJ:102 must stay quiet.",
    rejectingDescription: "skins.json whose skins value is not an array; CSPJ:102 must flag the schema error.",
    rejectingFiles: {
      [SkinsJsonPath]: json({
        serialize_name: PackLocName,
        localization_name: PackLocName,
        skins: {},
      }),
    },
    expectation: {
      severity: InfoItemType.error,
      count: 1,
      message: "object value found, but a array is required",
    },
  }),

  cspjPair({
    ruleIndex: 103,
    slug: "loc-name-mismatch",
    baseFiles: baseSkinPack,
    acceptingDescription: "Matching localization_name and serialize_name; CSPJ:103 must stay quiet.",
    rejectingDescription: "serialize_name differing from localization_name; CSPJ:103 must flag it.",
    rejectingFiles: {
      [SkinsJsonPath]: skinsJson([skin("harness_one", "harness_one_custom.png")], {
        serialize_name: "other_serialize_name",
      }),
    },
    expectation: {
      severity: InfoItemType.error,
      count: 1,
      message: "must be the same",
    },
  }),

  cspjPair({
    ruleIndex: 104,
    slug: "free-skins",
    baseFiles: threeSkinTextures,
    acceptingDescription: "Pack with exactly two free skins (the maximum allowed); CSPJ:104 must stay quiet.",
    acceptingFiles: { [SkinsJsonPath]: threeSkins(["free", "free", "paid"]) },
    rejectingDescription: "Pack with three free skins; CSPJ:104 must flag the overage.",
    rejectingFiles: { [SkinsJsonPath]: threeSkins(["free", "free", "free"]) },
    expectation: {
      severity: InfoItemType.error,
      count: 1,
      message: "3 free skins found",
    },
  }),

  cspjPair({
    ruleIndex: 105,
    slug: "duplicate-texture",
    baseFiles: threeSkinTextures,
    acceptingDescription: "Each skin using its own texture; CSPJ:105 must stay quiet.",
    acceptingFiles: { [SkinsJsonPath]: threeSkins(["paid", "paid", "paid"]) },
    rejectingDescription: "Two skins sharing one texture; CSPJ:105 must warn about the duplicate.",
    rejectingFiles: {
      [SkinsJsonPath]: skinsJson([
        skin("harness_one", "harness_one_custom.png"),
        skin("harness_two", "harness_one_custom.png"),
        skin("harness_three", "harness_three_custom.png"),
      ]),
    },
    expectation: {
      severity: InfoItemType.warning,
      count: 1,
      message: "Duplicate skin texture found: harness_one_custom.png",
    },
  }),

  cspjPair({
    ruleIndex: 106,
    slug: "cape",
    baseFiles: { ...baseSkinPack, [`${SkinPackRoot}/harness_cape.png`]: pngBytes(64, 32) },
    acceptingDescription: "Skin without a cape; CSPJ:106 must stay quiet.",
    rejectingDescription: "Skin declaring a cape texture (not allowed outside Minecraft-created packs); CSPJ:106 must flag it.",
    rejectingFiles: {
      [SkinsJsonPath]: skinsJson([skin("harness_one", "harness_one_custom.png", { cape: "harness_cape.png" })]),
    },
    expectation: {
      severity: InfoItemType.error,
      count: 1,
      message: "Cape Texture Not Allowed",
    },
  }),

  cspjPair({
    ruleIndex: 107,
    slug: "texture-size",
    baseFiles: baseSkinPack,
    acceptingDescription: "Skin texture at the valid 64x64 resolution; CSPJ:107 must stay quiet.",
    rejectingDescription: "Skin texture at an unsupported 60x60 resolution; CSPJ:107 must flag it.",
    rejectingFiles: { [`${SkinPackRoot}/harness_one_custom.png`]: pngBytes(60, 60) },
    expectation: {
      severity: InfoItemType.error,
      count: 1,
      message: "invalid size (60x60)",
    },
  }),

  cspjPair({
    ruleIndex: 108,
    slug: "creator-property",
    baseFiles: baseSkinPack,
    acceptingDescription: "Skin without Minecraft-Creator-only properties; CSPJ:108 must stay quiet.",
    rejectingDescription: "Skin declaring animations (a Minecraft-Creator-only property); CSPJ:108 must flag it.",
    rejectingFiles: {
      [SkinsJsonPath]: skinsJson([
        skin("harness_one", "harness_one_custom.png", { animations: "animations/harness.json" }),
      ]),
    },
    expectation: {
      severity: InfoItemType.error,
      count: 1,
      message: "animations and enable_attachables not allowed",
    },
  }),

  cspjPair({
    ruleIndex: 109,
    slug: "unreadable-texture",
    baseFiles: baseSkinPack,
    acceptingDescription: "Readable skin texture; CSPJ:109 must stay quiet.",
    rejectingDescription: "Skin texture whose dimensions cannot be read; CSPJ:109 must flag it.",
    rejectingFiles: { [`${SkinPackRoot}/harness_one_custom.png`]: corruptPngBytes() },
    expectation: {
      severity: InfoItemType.error,
      count: 1,
      message: "Failed to read dimensions",
    },
  }),

  cspjPair({
    ruleIndex: 110,
    slug: "orphaned-texture",
    baseFiles: baseSkinPack,
    acceptingDescription: "Every pack texture referenced from skins.json; CSPJ:110 must stay quiet.",
    rejectingDescription: "A pack texture missing from skins.json; CSPJ:110 must flag the orphan.",
    rejectingFiles: { [`${SkinPackRoot}/harness_extra_custom.png`]: skinTexture },
    expectation: {
      severity: InfoItemType.error,
      count: 1,
      message: "harness_extra_custom.png in skin pack not found in skins.json",
    },
  }),

  cspjPair({
    ruleIndex: 111,
    slug: "missing-loc-key",
    baseFiles: baseSkinPack,
    acceptingDescription: "Every skins.json loc key present in en_US.lang; CSPJ:111 must stay quiet.",
    rejectingDescription: "en_US.lang missing a skins.json loc key; CSPJ:111 must flag it.",
    rejectingFiles: langForSkins([]),
    expectation: {
      severity: InfoItemType.error,
      count: 1,
      message: "not found in en_US.lang file",
    },
  }),

  cspjPair({
    ruleIndex: 112,
    slug: "extra-loc-key",
    baseFiles: baseSkinPack,
    acceptingDescription: "No skin loc keys beyond skins.json; CSPJ:112 must stay quiet.",
    rejectingDescription: "en_US.lang declaring a skin loc key that skins.json does not; CSPJ:112 must flag it.",
    rejectingFiles: langForSkins(["harness_one"], { [`skin.${PackLocName}.harness_ghost`]: "Ghost" }),
    expectation: {
      severity: InfoItemType.error,
      count: 1,
      message: "not found in skins.json",
    },
  }),

  cspjPair({
    ruleIndex: 113,
    slug: "loc-key-spacing",
    baseFiles: baseSkinPack,
    acceptingDescription: "Loc keys without leading or trailing spaces; CSPJ:113 must stay quiet.",
    rejectingDescription: "A loc key with a trailing space; CSPJ:113 must flag it.",
    rejectingFiles: langForSkins(["harness_one"], { [`skin.${PackLocName}.harness_spaced `]: "Spaced" }),
    expectation: {
      severity: InfoItemType.error,
      count: 1,
      message: "must not contain leading or trailing spaces",
    },
  }),

  cspjPair({
    ruleIndex: 114,
    slug: "purchase-type",
    baseFiles: baseSkinPack,
    acceptingDescription: "Skin with the allowed 'paid' purchase type; CSPJ:114 must stay quiet.",
    rejectingDescription: "Skin with an unknown purchase type; CSPJ:114 must flag it.",
    rejectingFiles: {
      [SkinsJsonPath]: skinsJson([skin("harness_one", "harness_one_custom.png", { type: "premium" })]),
    },
    expectation: {
      severity: InfoItemType.error,
      count: 1,
      message: "Skin Purchase Type Not Allowed",
    },
  }),

  cspjPair({
    ruleIndex: 115,
    slug: "model-target",
    baseFiles: baseSkinPack,
    acceptingDescription: "Skin with the allowed humanoid.custom geometry; CSPJ:115 must stay quiet.",
    rejectingDescription: "Skin with a geometry outside the allowed humanoid targets; CSPJ:115 must flag it.",
    rejectingFiles: {
      [SkinsJsonPath]: skinsJson([
        skin("harness_one", "harness_one_custom.png", { geometry: "geometry.humanoid.other" }),
      ]),
    },
    expectation: {
      severity: InfoItemType.error,
      count: 1,
      message: "geometry property: geometry.humanoid.other not allowed",
    },
  }),

  cspjPair({
    ruleIndex: 116,
    slug: "skin-count",
    baseFiles: manySkinsBase,
    acceptingDescription: "Pack with exactly 80 skins (the maximum allowed); CSPJ:116 must stay quiet.",
    acceptingFiles: { [SkinsJsonPath]: manySkins(80) },
    rejectingDescription: "Pack with 81 skins; CSPJ:116 must flag the overage.",
    rejectingFiles: { [SkinsJsonPath]: manySkins(81) },
    expectation: {
      severity: InfoItemType.error,
      count: 1,
      message: "Maximum Allowable skins is: 80",
    },
  }),
];
