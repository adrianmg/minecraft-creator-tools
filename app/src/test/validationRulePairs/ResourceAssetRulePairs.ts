// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * ResourceAssetRulePairs — paired E2E coverage for the resource-asset rule
 * families: GEOFMT (restricted poly_mesh geometry), GEOMETRY (block-geometry
 * cube budget), CPARTI (particle identifier requirements), and CPACKICON
 * (pack icon presence/uniqueness/validity/size).
 *
 * All image fixtures are synthesized at test time (pngBytes and friends), so
 * no binary assets are checked in.
 *
 * GEOFMT:102 (jsonParseError) has no pair: every JSON shape that reaches its
 * catch block (a non-iterable bones value) also throws inside
 * GeometryInfoGenerator's bones loop, so the run always carries an
 * internal-processing error the harness must reject.
 *
 * CWI (world icons) resolves the world folder from the manifest file's
 * parent (worldTemplateManifestJson items are singleFile storage, so
 * ProjectItem.getFolder() is null for them); its icon fixtures live inside
 * the generated world template folder, and only the world root's direct
 * files count (icons nested in embedded packs are ignored, mirroring how
 * Minecraft loads the thumbnail). isWorldIcon matches on the
 * world_icon*.jpeg name while parseImageMetadata detects the format from the
 * bytes, so the synthesized PNG payloads parse fine under the .jpeg name.
 */

import { InfoItemType } from "../../info/IInfoItemData";
import { ProjectInfoSuite } from "../../info/IProjectInfoData";
import { ValidationRuleCoveragePair } from "../ValidationRuleHarness";
import {
  BpRoot,
  RpRoot,
  WtRoot,
  coveragePairFromBase,
  corruptPngBytes,
  json,
  minimalBpFiles,
  minimalRpFiles,
  pngBytes,
  worldTemplateFiles,
} from "./PairFixtureBuilders";

// ---------------------------------------------------------------------------
// GEOFMT — restricted poly_mesh geometry (third-party content only).
// ---------------------------------------------------------------------------

const EntityGeometryPath = `${RpRoot}/models/entity/harness_entity.geo.json`;

const entityGeometry = (bone: object) =>
  json({
    format_version: "1.16.0",
    "minecraft:geometry": [
      {
        description: {
          identifier: "geometry.harness_entity",
          texture_width: 16,
          texture_height: 16,
        },
        bones: [bone],
      },
    ],
  });

const cubeBone = {
  name: "harness_bone",
  pivot: [0, 0, 0],
  cubes: [{ origin: [0, 0, 0], size: [1, 1, 1], uv: [0, 0] }],
};

const polyMeshBone = {
  name: "harness_bone",
  pivot: [0, 0, 0],
  poly_mesh: { normalized_uvs: true, positions: [], normals: [], polys: [] },
};

// ---------------------------------------------------------------------------
// GEOMETRY — the 50-cube budget for custom block geometry.
// ---------------------------------------------------------------------------

const BlockGeometryPath = `${RpRoot}/models/blocks/harness_block.geo.json`;
const BlockCubeBudget = 50;

const blockGeometryWithCubes = (cubeCount: number) => {
  const cubes = [];

  for (let i = 0; i < cubeCount; i++) {
    cubes.push({ origin: [0, i, 0], size: [1, 1, 1], uv: [0, 0] });
  }

  return json({
    format_version: "1.16.0",
    "minecraft:geometry": [
      {
        description: {
          identifier: "geometry.harness_block",
          texture_width: 16,
          texture_height: 16,
        },
        bones: [{ name: "harness_block_root", pivot: [0, 0, 0], cubes }],
      },
    ],
  });
};

// ---------------------------------------------------------------------------
// CPARTI — particle identifier namespace requirements (1.20.60+).
// ---------------------------------------------------------------------------

const ParticlePath = `${RpRoot}/particles/harness_flame.json`;

const particleJson = (options: { formatVersion?: string; identifier?: string }) => {
  const particle: any = {
    particle_effect: {
      description: {
        identifier: options.identifier,
        basic_render_parameters: {
          material: "particles_alpha",
          texture: "textures/particle/particles",
        },
      },
      components: {},
    },
  };

  if (options.formatVersion !== undefined) {
    particle.format_version = options.formatVersion;
  }

  return json(particle);
};

// ---------------------------------------------------------------------------
// CPACKICON — pack icon presence, uniqueness, validity, and size.
// ---------------------------------------------------------------------------

const PackIconPath = `${BpRoot}/pack_icon.png`;
const SecondPackIconPath = `${BpRoot}/pack_icon_2.png`;
const validPackIcon = pngBytes(16, 16);

const WorldIconPath = `${WtRoot}/world_icon.jpeg`;
const validWorldIcon = pngBytes(800, 450);

export const ResourceAssetRulePairs: readonly ValidationRuleCoveragePair[] = [
  coveragePairFromBase({
    ruleKey: "GEOFMT:101",
    category: "project",
    suite: ProjectInfoSuite.defaultInDevelopment,
    baseFiles: minimalRpFiles(),
    accepting: {
      id: "harness-geofmt-poly-mesh-accept",
      description: "Entity geometry whose bone uses ordinary cubes; GEOFMT:101 must stay quiet.",
      files: { [EntityGeometryPath]: entityGeometry(cubeBone) },
    },
    rejecting: {
      id: "harness-geofmt-poly-mesh-reject",
      description: "Entity geometry whose bone declares a poly_mesh; GEOFMT:101 must flag the bone.",
      files: { [EntityGeometryPath]: entityGeometry(polyMeshBone) },
    },
    rejectingExpectation: {
      severity: InfoItemType.error,
      count: 1,
      projectPath: /harness_entity\.geo\.json$/,
      message: "contains poly_mesh definition",
      data: "harness_bone",
    },
  }),

  coveragePairFromBase({
    ruleKey: "GEOMETRY:501",
    category: "project",
    suite: ProjectInfoSuite.defaultInDevelopment,
    baseFiles: minimalRpFiles(),
    accepting: {
      id: "harness-geometry-block-cubes-accept",
      description: "Block geometry at exactly the 50-cube budget; GEOMETRY:501 must stay quiet.",
      files: { [BlockGeometryPath]: blockGeometryWithCubes(BlockCubeBudget) },
    },
    rejecting: {
      id: "harness-geometry-block-cubes-reject",
      description: "Block geometry one cube over the 50-cube budget; GEOMETRY:501 must flag it.",
      files: { [BlockGeometryPath]: blockGeometryWithCubes(BlockCubeBudget + 1) },
    },
    rejectingExpectation: {
      severity: InfoItemType.warning,
      count: 1,
      projectPath: /harness_block\.geo\.json$/,
      message: "cubes in custom blocks may lead to degraded performance",
      data: BlockCubeBudget + 1,
    },
  }),

  coveragePairFromBase({
    ruleKey: "CPARTI:101",
    category: "project",
    suite: ProjectInfoSuite.defaultInDevelopment,
    baseFiles: minimalRpFiles(),
    accepting: {
      id: "harness-cparti-readable-accept",
      description: "Well-formed particle JSON; CPARTI:101 must stay quiet.",
      files: { [ParticlePath]: particleJson({ formatVersion: "1.20.60", identifier: "test:harness_flame" }) },
    },
    rejecting: {
      id: "harness-cparti-readable-reject",
      description: "Particle file with unparseable JSON; CPARTI:101 must flag the read failure.",
      files: { [ParticlePath]: '{ "particle_effect": { "description": ' },
    },
    rejectingExpectation: {
      severity: InfoItemType.error,
      count: 1,
      projectPath: /harness_flame\.json$/,
      message: "Failed to read file",
    },
  }),

  coveragePairFromBase({
    ruleKey: "CPARTI:102",
    category: "project",
    suite: ProjectInfoSuite.defaultInDevelopment,
    baseFiles: minimalRpFiles(),
    accepting: {
      id: "harness-cparti-format-version-accept",
      description: "Particle JSON declaring a format_version; CPARTI:102 must stay quiet.",
      files: { [ParticlePath]: particleJson({ formatVersion: "1.20.60", identifier: "test:harness_flame" }) },
    },
    rejecting: {
      id: "harness-cparti-format-version-reject",
      description: "Particle JSON without a format_version; CPARTI:102 must flag it.",
      files: { [ParticlePath]: particleJson({ identifier: "test:harness_flame" }) },
    },
    rejectingExpectation: {
      severity: InfoItemType.error,
      count: 1,
      projectPath: /harness_flame\.json$/,
      message: "'format_version' expected",
    },
  }),

  coveragePairFromBase({
    ruleKey: "CPARTI:103",
    category: "project",
    suite: ProjectInfoSuite.defaultInDevelopment,
    baseFiles: minimalRpFiles(),
    accepting: {
      id: "harness-cparti-identifier-accept",
      description: "Particle identifier with a namespace; CPARTI:103 must stay quiet.",
      files: { [ParticlePath]: particleJson({ formatVersion: "1.20.60", identifier: "test:harness_flame" }) },
    },
    rejecting: {
      id: "harness-cparti-identifier-reject",
      description: "Particle identifier without a namespace; CPARTI:103 must flag it.",
      files: { [ParticlePath]: particleJson({ formatVersion: "1.20.60", identifier: "harness_flame" }) },
    },
    rejectingExpectation: {
      severity: InfoItemType.error,
      count: 1,
      projectPath: /harness_flame\.json$/,
      message: "Particle identifier requires a namespace",
    },
  }),

  coveragePairFromBase({
    ruleKey: "CPACKICON:101",
    category: "project",
    suite: ProjectInfoSuite.defaultInDevelopment,
    baseFiles: minimalBpFiles(),
    accepting: {
      id: "harness-cpackicon-present-accept",
      description: "Behavior pack with a pack_icon.png; CPACKICON:101 must stay quiet.",
      files: { [PackIconPath]: validPackIcon },
    },
    rejecting: {
      id: "harness-cpackicon-present-reject",
      description: "Behavior pack without any pack icon; CPACKICON:101 must flag it.",
    },
    rejectingExpectation: {
      severity: InfoItemType.error,
      count: 1,
      message: "pack_icon image file not found",
    },
  }),

  coveragePairFromBase({
    ruleKey: "CPACKICON:102",
    category: "project",
    suite: ProjectInfoSuite.defaultInDevelopment,
    baseFiles: { ...minimalBpFiles(), [PackIconPath]: validPackIcon },
    accepting: {
      id: "harness-cpackicon-single-accept",
      description: "Behavior pack with exactly one pack icon; CPACKICON:102 must stay quiet.",
    },
    rejecting: {
      id: "harness-cpackicon-single-reject",
      description: "Behavior pack with two pack icon files; CPACKICON:102 must flag it.",
      files: { [SecondPackIconPath]: pngBytes(16, 16, [32, 64, 128, 255]) },
    },
    rejectingExpectation: {
      severity: InfoItemType.error,
      count: 1,
      message: "Found multiple pack icon files",
    },
  }),

  coveragePairFromBase({
    ruleKey: "CPACKICON:103",
    category: "project",
    suite: ProjectInfoSuite.defaultInDevelopment,
    baseFiles: minimalBpFiles(),
    accepting: {
      id: "harness-cpackicon-image-accept",
      description: "Pack icon with parseable image metadata; CPACKICON:103 must stay quiet.",
      files: { [PackIconPath]: validPackIcon },
    },
    rejecting: {
      id: "harness-cpackicon-image-reject",
      description: "Pack icon whose bytes yield no image metadata; CPACKICON:103 must flag it.",
      files: { [PackIconPath]: corruptPngBytes() },
    },
    rejectingExpectation: {
      severity: InfoItemType.error,
      count: 1,
      message: "is not valid",
    },
  }),

  coveragePairFromBase({
    ruleKey: "CPACKICON:104",
    category: "project",
    suite: ProjectInfoSuite.defaultInDevelopment,
    baseFiles: minimalBpFiles(),
    accepting: {
      id: "harness-cpackicon-size-accept",
      description: "Square power-of-two 16x16 pack icon; CPACKICON:104 must stay quiet.",
      files: { [PackIconPath]: validPackIcon },
    },
    rejecting: {
      id: "harness-cpackicon-size-reject",
      description: "Square 17x17 pack icon (not a power of two); CPACKICON:104 must flag it.",
      files: { [PackIconPath]: pngBytes(17, 17) },
    },
    rejectingExpectation: {
      severity: InfoItemType.error,
      count: 1,
      message: "pack_icon must be square with size 2, 4, 8, 16, 32, 64, 128, or 256",
    },
  }),

  // -------------------------------------------------------------------------
  // CWI — world icon presence/uniqueness/validity/size (800x450 Bedrock size).
  // -------------------------------------------------------------------------

  coveragePairFromBase({
    ruleKey: "CWI:101",
    category: "project",
    suite: ProjectInfoSuite.defaultInDevelopment,
    baseFiles: worldTemplateFiles(),
    accepting: {
      id: "harness-cwi-icon-present-accept",
      description: "World template with one valid 800x450 world icon; CWI:101 must stay quiet.",
      files: { [WorldIconPath]: validWorldIcon },
    },
    rejecting: {
      id: "harness-cwi-icon-present-reject",
      description: "World template without any world icon; CWI:101 must flag it.",
    },
    rejectingExpectation: {
      severity: InfoItemType.error,
      count: 1,
      message: "No World Icon found",
    },
  }),

  coveragePairFromBase({
    ruleKey: "CWI:102",
    category: "project",
    suite: ProjectInfoSuite.defaultInDevelopment,
    // The icon nested inside an embedded pack must never count toward the
    // world's icon tally: Minecraft only loads the thumbnail from the world
    // root, so the accepting side (root icon + nested copy) must stay quiet.
    baseFiles: {
      ...worldTemplateFiles(),
      [WorldIconPath]: validWorldIcon,
      [`${WtRoot}/resource_packs/harness_rp/world_icon.jpeg`]: pngBytes(800, 450, [32, 64, 128, 255]),
    },
    accepting: {
      id: "harness-cwi-single-icon-accept",
      description:
        "World template with one root world icon plus an icon nested inside an embedded pack; CWI:102 must stay quiet.",
    },
    rejecting: {
      id: "harness-cwi-single-icon-reject",
      description: "World template with two world icon files; CWI:102 must flag it.",
      files: { [`${WtRoot}/world_icon_b.jpeg`]: pngBytes(800, 450, [32, 64, 128, 255]) },
    },
    rejectingExpectation: {
      severity: InfoItemType.error,
      count: 1,
      message: "Too many World Icons found",
    },
  }),

  coveragePairFromBase({
    ruleKey: "CWI:103",
    category: "project",
    suite: ProjectInfoSuite.defaultInDevelopment,
    baseFiles: worldTemplateFiles(),
    accepting: {
      id: "harness-cwi-icon-image-accept",
      description: "World icon with parseable image metadata; CWI:103 must stay quiet.",
      files: { [WorldIconPath]: validWorldIcon },
    },
    rejecting: {
      id: "harness-cwi-icon-image-reject",
      description: "World icon whose bytes yield no image metadata; CWI:103 must flag it.",
      files: { [WorldIconPath]: corruptPngBytes() },
    },
    rejectingExpectation: {
      severity: InfoItemType.error,
      count: 1,
      message: "Image (world_icon.jpeg) is not valid",
    },
  }),

  coveragePairFromBase({
    ruleKey: "CWI:104",
    category: "project",
    suite: ProjectInfoSuite.defaultInDevelopment,
    baseFiles: worldTemplateFiles(),
    accepting: {
      id: "harness-cwi-icon-size-accept",
      description: "World icon at the exact 800x450 Bedrock size; CWI:104 must stay quiet.",
      files: { [WorldIconPath]: validWorldIcon },
    },
    rejecting: {
      id: "harness-cwi-icon-size-reject",
      description: "World icon at 801x450; CWI:104 must flag it.",
      files: { [WorldIconPath]: pngBytes(801, 450) },
    },
    rejectingExpectation: {
      severity: InfoItemType.error,
      count: 1,
      message: "Image (world_icon.jpeg) is not valid",
    },
  }),
];
