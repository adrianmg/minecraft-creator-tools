// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * MultiPackRulePairs — sibling-pack isolation coverage. Each pair puts an
 * invalid condition in exactly one pack of a multi-pack project and proves,
 * via the exact-count and path assertions, that the sibling pack is not
 * flagged (rejecting) and that one pack's valid state does not mask or
 * contaminate the other (accepting).
 *
 * The Vibrant Visuals pair deliberately names the sibling packs so one
 * path is a prefix of the other (test_rp / test_rp2) — the historical
 * cross-pack VV bug (#1611504) involved prefix-based pack resolution.
 */

import { InfoItemType } from "../../info/IInfoItemData";
import { ProjectInfoSuite } from "../../info/IProjectInfoData";
import { ValidationRuleCoveragePair, ValidationFixtureFiles } from "../ValidationRuleHarness";
import {
  bpManifest,
  coveragePairFromBase,
  fixtureUuid,
  json,
  langFiles,
  pngBytes,
  rpManifest,
  skinManifest,
} from "./PairFixtureBuilders";

const Bp1ManifestPath = "behavior_packs/test_bp/manifest.json";
const Bp2ManifestPath = "behavior_packs/test_bp2/manifest.json";
const Rp1Root = "resource_packs/test_rp";
const Rp2Root = "resource_packs/test_rp2";

const secondPackIds = { headerUuid: fixtureUuid(0x70), moduleUuid: fixtureUuid(0x71) };

const textureSetJson = json({
  format_version: "1.16.100",
  "minecraft:texture_set": {
    color: "harness_stone",
    metalness_emissive_roughness: "harness_stone_mer",
  },
});

// Skin pack pair fixtures: pack A stays fully valid; pack B carries the
// invalid purchase type.
const skinPack = (root: string, packLocName: string, skinType: string, uuidBase: number): ValidationFixtureFiles => ({
  [`${root}/manifest.json`]: json(
    skinManifest({ headerUuid: fixtureUuid(uuidBase), moduleUuid: fixtureUuid(uuidBase + 1) })
  ),
  [`${root}/skins.json`]: json({
    serialize_name: packLocName,
    localization_name: packLocName,
    skins: [
      {
        localization_name: `${packLocName}_one`,
        geometry: "geometry.humanoid.custom",
        texture: "harness_one_custom.png",
        type: skinType,
      },
    ],
  }),
  [`${root}/harness_one_custom.png`]: pngBytes(64, 64),
  ...langFiles(root, {
    [`skinpack.${packLocName}`]: packLocName,
    [`skin.${packLocName}.${packLocName}_one`]: "One",
  }),
});

export const MultiPackRulePairs: readonly ValidationRuleCoveragePair[] = [
  // CHKMANIF:111 — a UUID defect in one behavior pack must be attributed to
  // that pack's manifest only.
  coveragePairFromBase({
    ruleKey: "CHKMANIF:111",
    category: "project",
    suite: ProjectInfoSuite.currentPlatformVersions,
    baseFiles: { [Bp1ManifestPath]: json(bpManifest()) },
    accepting: {
      id: "harness-multipack-chkmanif-uuid-accept",
      description: "Two sibling behavior packs, both with valid UUIDs; CHKMANIF:111 must stay quiet.",
      files: { [Bp2ManifestPath]: json(bpManifest(secondPackIds)) },
    },
    rejecting: {
      id: "harness-multipack-chkmanif-uuid-reject",
      description:
        "Two sibling behavior packs where only the second has an invalid UUID; CHKMANIF:111 must flag exactly that pack.",
      files: { [Bp2ManifestPath]: json(bpManifest({ ...secondPackIds, headerUuid: "not-a-uuid" })) },
    },
    rejectingExpectation: {
      severity: InfoItemType.error,
      count: 1,
      projectPath: /test_bp2\/manifest\.json$/,
      data: "not-a-uuid",
    },
  }),

  // MINENGINEVER:120 — a version defect in one pack manifest must not
  // implicate the up-to-date sibling.
  coveragePairFromBase({
    ruleKey: "MINENGINEVER:120",
    category: "manager",
    suite: ProjectInfoSuite.currentPlatformVersions,
    baseFiles: { [Bp1ManifestPath]: json(bpManifest()) },
    accepting: {
      id: "harness-multipack-minenginever-accept",
      description: "Two sibling behavior packs, both on the current min_engine_version; MINENGINEVER:120 must stay quiet.",
      files: { [Bp2ManifestPath]: json(bpManifest(secondPackIds)) },
    },
    rejecting: {
      id: "harness-multipack-minenginever-reject",
      description:
        "Two sibling behavior packs where only the second is behind the minor-version window; MINENGINEVER:120 must flag exactly that pack.",
      files: { [Bp2ManifestPath]: json(bpManifest({ ...secondPackIds, minEngineVersion: [1, 19, 0] })) },
    },
    rejectingExpectation: {
      severity: InfoItemType.error,
      count: 1,
      projectPath: /test_bp2\/manifest\.json$/,
      message: "has a lower minor version number",
    },
  }),

  // CHKMANIF:135 — one pack's Vibrant Visuals content must never make a
  // sibling resource pack fail the pbr-capability requirement, and a
  // capability gap is attributed to the VV pack alone.
  coveragePairFromBase({
    ruleKey: "CHKMANIF:135",
    category: "project",
    suite: ProjectInfoSuite.currentPlatformVersions,
    baseFiles: {
      [`${Rp1Root}/textures/blocks/harness_stone.texture_set.json`]: textureSetJson,
      [`${Rp2Root}/manifest.json`]: json(rpManifest(secondPackIds)),
      [`${Rp2Root}/textures/environment/harness_plain.png`]: pngBytes(4, 4),
    },
    accepting: {
      id: "harness-multipack-chkmanif-vv-accept",
      description:
        "A PBR-capable pack with Vibrant Visuals content beside a plain sibling pack; CHKMANIF:135 must flag neither.",
      files: { [`${Rp1Root}/manifest.json`]: json(rpManifest({ capabilities: ["pbr"] })) },
    },
    rejecting: {
      id: "harness-multipack-chkmanif-vv-reject",
      description:
        "A pack with Vibrant Visuals content but no pbr capability beside a plain sibling; CHKMANIF:135 must flag only the VV pack.",
      files: { [`${Rp1Root}/manifest.json`]: json(rpManifest()) },
    },
    rejectingExpectation: {
      severity: InfoItemType.error,
      count: 1,
      projectPath: /test_rp\/manifest\.json$/,
      message: `must declare the "pbr" capability`,
    },
  }),

  // CSPJ:114 — a defective skin in one skin pack must not implicate the
  // sibling skin pack.
  coveragePairFromBase({
    ruleKey: "CSPJ:114",
    category: "project",
    suite: ProjectInfoSuite.defaultInDevelopment,
    baseFiles: skinPack("skin_packs/harness_skins_a", "harness_a", "paid", 0x80),
    accepting: {
      id: "harness-multipack-cspj-accept",
      description: "Two sibling skin packs, both with allowed purchase types; CSPJ:114 must stay quiet.",
      files: skinPack("skin_packs/harness_skins_b", "harness_b", "free", 0x84),
    },
    rejecting: {
      id: "harness-multipack-cspj-reject",
      description:
        "Two sibling skin packs where only the second has an unknown purchase type; CSPJ:114 must flag exactly one skin.",
      files: skinPack("skin_packs/harness_skins_b", "harness_b", "premium", 0x84),
    },
    rejectingExpectation: {
      severity: InfoItemType.error,
      count: 1,
      message: "Skin Purchase Type Not Allowed",
    },
  }),
];
