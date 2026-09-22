// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * PairFixtureBuilders — shared fixture-file factories for the paired E2E
 * validation-rule coverage tables (see ValidationRuleHarnessPairs.ts and the
 * per-family modules in this folder).
 *
 * Everything here is deterministic: fixture UUIDs come from a fixed stem,
 * and every version boundary is derived from the pinned test Minecraft
 * version (TestVersionPin.ts), so pairs survive upstream version bumps by
 * changing exactly one constant.
 *
 * Layout conventions mirror the samplecontent projects that the inference
 * walker (ProjectItemInference.ts) already classifies:
 *   behavior_packs/<name>/manifest.json  → behaviorPackManifestJson
 *   resource_packs/<name>/manifest.json  → resourcePackManifestJson
 *   skin_packs/<name>/ + skins.json      → skinPackManifestJson
 *   world_templates/<name>/manifest.json → worldTemplateManifestJson
 */

import { TEST_PINNED_MC_VERSION } from "../TestVersionPin";
import { getEffectivePreviousMinor } from "../../core/versioning/MinecraftVersionRules";
import { InfoItemType } from "../../info/IInfoItemData";
import { ProjectInfoSuite } from "../../info/IProjectInfoData";
import {
  ValidationFixtureFiles,
  ValidationFixtureRecipe,
  ValidationResultExpectation,
  ValidationRuleCategory,
  ValidationRuleCoveragePair,
} from "../ValidationRuleHarness";
import { ValidationRuleKey } from "../../info/tests/ValidationRuleDefinition";

export interface ICoveragePairSideSpec {
  readonly id: string;
  readonly description: string;
  /** Files that replace or extend the shared base for this side only. */
  readonly files?: ValidationFixtureFiles;
}

export interface ICoveragePairSpec {
  readonly ruleKey: ValidationRuleKey;
  readonly category: ValidationRuleCategory;
  readonly suite: ProjectInfoSuite;
  /**
   * Shared base file set, or a thunk producing it. Pass a thunk when the
   * base is expensive to synthesize (e.g. the multi-hundred-megabyte pack
   * size fixtures): it runs only when a fixture's files are first read —
   * never at pair-registry import — and its result is cached and shared by
   * both sides.
   */
  readonly baseFiles: ValidationFixtureFiles | (() => ValidationFixtureFiles);
  readonly accepting: ICoveragePairSideSpec;
  readonly rejecting: ICoveragePairSideSpec;
  readonly rejectingExpectation: ValidationResultExpectation;
  /** Deterministic environment setup applied to both sides (see ValidationFixtureRecipe.prepare). */
  readonly prepare?: () => void | Promise<void>;
}

/**
 * Builds a coverage pair whose fixtures share one base file set, with each
 * side overlaying only its own focused mutation — the paired projects cannot
 * drift apart in unrelated files.
 */
export function coveragePairFromBase(spec: ICoveragePairSpec): ValidationRuleCoveragePair {
  let resolvedBase: ValidationFixtureFiles | undefined;

  const baseFiles = () =>
    (resolvedBase ??= typeof spec.baseFiles === "function" ? spec.baseFiles() : spec.baseFiles);

  const side = (kind: "accepting" | "rejecting", sideSpec: ICoveragePairSideSpec): ValidationFixtureRecipe => {
    let files: ValidationFixtureFiles | undefined;

    return {
      id: sideSpec.id,
      description: sideSpec.description,
      kind,
      suite: spec.suite,
      get files(): ValidationFixtureFiles {
        return (files ??= { ...baseFiles(), ...sideSpec.files });
      },
      prepare: spec.prepare,
    };
  };

  return {
    ruleKey: spec.ruleKey,
    category: spec.category,
    accepting: side("accepting", spec.accepting),
    rejecting: side("rejecting", spec.rejecting),
    rejectingExpectation: spec.rejectingExpectation,
  };
}

/** The pinned "current" Minecraft version as a numeric triplet (e.g. [1, 26, 20]). */
export const PinnedVersion: readonly number[] = TEST_PINNED_MC_VERSION.split(".")
  .slice(0, 3)
  .map((part) => Number(part));

if (PinnedVersion.length !== 3 || PinnedVersion.some((part) => !Number.isInteger(part))) {
  throw new Error(`TEST_PINNED_MC_VERSION '${TEST_PINNED_MC_VERSION}' is not a parsable x.y.z version.`);
}

/**
 * Boundary variants of an expected version triplet. "previousMinor" is the
 * newest minor still inside the supported N-1 window (accounting for skipped
 * minors, e.g. 1.21 when current is 1.26); "minorTooOld" is one below it —
 * the exact boundary the minor-version rules gate on.
 */
export const VersionBoundaries = {
  exact: (v: readonly number[]) => [...v],
  lowerMajor: (v: readonly number[]) => [v[0] - 1, v[1], v[2]],
  higherMajor: (v: readonly number[]) => [v[0] + 1, v[1], v[2]],
  previousMinor: (v: readonly number[]) => [v[0], getEffectivePreviousMinor(v[0], v[1]), 0],
  minorTooOld: (v: readonly number[]) => [v[0], getEffectivePreviousMinor(v[0], v[1]) - 1, 0],
  higherMinor: (v: readonly number[]) => [v[0], v[1] + 1, 0],
  lowerPatch: (v: readonly number[]) => [v[0], v[1], v[2] - 1],
  higherPatch: (v: readonly number[]) => [v[0], v[1], v[2] + 1],
} as const;

export const BpRoot = "behavior_packs/test_bp";
export const RpRoot = "resource_packs/test_rp";
export const WtRoot = "world_templates/test_wt";
export const SkinPackRoot = "skin_packs/test_skin_pack";

export const BpManifestPath = `${BpRoot}/manifest.json`;
export const RpManifestPath = `${RpRoot}/manifest.json`;
export const WtManifestPath = `${WtRoot}/manifest.json`;
export const SkinManifestPath = `${SkinPackRoot}/manifest.json`;
export const SkinsJsonPath = `${SkinPackRoot}/skins.json`;

/**
 * Deterministic, visibly-synthetic UUIDs. Index 0–255 lands in the last two
 * hex digits so ids are stable and never collide within a fixture set.
 */
export function fixtureUuid(index: number): string {
  const suffix = index.toString(16).padStart(2, "0");
  return `e58f1a6e-4b2d-4c6a-8f5e-1a2b3c4d5e${suffix}`;
}

export function json(value: unknown): string {
  return JSON.stringify(value, undefined, 2);
}

export interface IPackManifestOptions {
  formatVersion?: number;
  name?: string;
  description?: string;
  headerUuid?: string;
  moduleUuid?: string;
  minEngineVersion?: readonly number[] | string;
  headerExtras?: Record<string, unknown>;
  modules?: unknown[];
  /** Usually an array; deliberately-malformed fixtures may pass other shapes. */
  dependencies?: unknown;
  subpacks?: unknown[];
  capabilities?: string[];
  settings?: unknown[];
  metadata?: Record<string, unknown>;
}

function packManifestObject(moduleType: string, options: IPackManifestOptions | undefined, uuidBase: number): any {
  const opts = options ?? {};

  const manifest: any = {
    format_version: opts.formatVersion ?? 2,
    header: {
      name: opts.name ?? "Validation Harness Pack",
      description: opts.description ?? "Generated pack for the paired validation rule harness",
      uuid: opts.headerUuid ?? fixtureUuid(uuidBase),
      version: [1, 0, 0],
      ...opts.headerExtras,
    },
    modules: opts.modules ?? [
      {
        type: moduleType,
        uuid: opts.moduleUuid ?? fixtureUuid(uuidBase + 1),
        version: [1, 0, 0],
      },
    ],
  };

  if (opts.minEngineVersion !== undefined) {
    manifest.header.min_engine_version = opts.minEngineVersion;
  }

  if (opts.dependencies !== undefined) {
    manifest.dependencies = opts.dependencies;
  }

  if (opts.subpacks !== undefined) {
    manifest.subpacks = opts.subpacks;
  }

  if (opts.capabilities !== undefined) {
    manifest.capabilities = opts.capabilities;
  }

  if (opts.settings !== undefined) {
    manifest.settings = opts.settings;
  }

  if (opts.metadata !== undefined) {
    manifest.metadata = opts.metadata;
  }

  return manifest;
}

/** Behavior pack manifest object (data module, current min_engine_version). */
export function bpManifest(options?: IPackManifestOptions): any {
  return packManifestObject("data", { minEngineVersion: PinnedVersion, ...options }, 0x10);
}

/** Resource pack manifest object (resources module, current min_engine_version). */
export function rpManifest(options?: IPackManifestOptions): any {
  return packManifestObject("resources", { minEngineVersion: PinnedVersion, ...options }, 0x20);
}

/** Skin pack manifest object (skin_pack module; no min_engine_version). */
export function skinManifest(options?: IPackManifestOptions): any {
  return packManifestObject("skin_pack", options, 0x30);
}

export interface IWorldTemplateManifestOptions extends IPackManifestOptions {
  baseGameVersion?: readonly number[] | string;
  lockTemplateOptions?: boolean;
}

/**
 * World template manifest object. Defaults keep every CHKMANIF and
 * BASEGAMEVER rule quiet: format 2, lock_template_options present, and
 * base_game_version pinned to the current test version.
 */
export function worldTemplateManifest(options?: IWorldTemplateManifestOptions): any {
  const opts = options ?? {};
  const manifest = packManifestObject("world_template", opts, 0x40);

  if (opts.baseGameVersion !== undefined) {
    manifest.header.base_game_version = opts.baseGameVersion;
  } else if (!("baseGameVersion" in opts)) {
    manifest.header.base_game_version = [...PinnedVersion];
  }

  if (opts.lockTemplateOptions !== undefined) {
    manifest.header.lock_template_options = opts.lockTemplateOptions;
  } else if (!("lockTemplateOptions" in opts)) {
    manifest.header.lock_template_options = true;
  }

  return manifest;
}

/**
 * Minimal world template folder files: manifest + levelname.txt. The
 * levelname file makes the folder classify as a world even without db/
 * content (mirrors samplecontent/platform_version_world_errors).
 */
export function worldTemplateFiles(manifest?: any): { [relativePath: string]: string } {
  return {
    [WtManifestPath]: json(manifest ?? worldTemplateManifest()),
    [`${WtRoot}/levelname.txt`]: "Validation Harness World",
  };
}

/** A behavior pack whose manifest keeps every manifest-family rule quiet. */
export function minimalBpFiles(manifest?: any): { [relativePath: string]: string } {
  return { [BpManifestPath]: json(manifest ?? bpManifest()) };
}

/** A resource pack whose manifest keeps every manifest-family rule quiet. */
export function minimalRpFiles(manifest?: any): { [relativePath: string]: string } {
  return { [RpManifestPath]: json(manifest ?? rpManifest()) };
}

const PngLibrary = require("pngjs") as { PNG: any };

/**
 * Synthesizes a PNG of the given dimensions at test time (pngjs). A flat
 * fill compresses to a few hundred bytes regardless of dimensions, so
 * texture-memory fixtures never check in binary assets. Texture memory in
 * the validators is width*height*4, independent of file size.
 */
export function pngBytes(width: number, height: number, rgba: readonly number[] = [128, 64, 32, 255]): Uint8Array {
  const png = new PngLibrary.PNG({ width, height });

  for (let offset = 0; offset < png.data.length; offset += 4) {
    png.data[offset] = rgba[0];
    png.data[offset + 1] = rgba[1];
    png.data[offset + 2] = rgba[2];
    png.data[offset + 3] = rgba[3];
  }

  return new Uint8Array(PngLibrary.PNG.sync.write(png));
}

/**
 * A bare PNG signature with no chunks: exifr recognizes the format but
 * yields no metadata, which is the "could not extract metadata" condition
 * texture validators must flag.
 */
export function corruptPngBytes(): Uint8Array {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
}

const crcTable: number[] = (() => {
  const table: number[] = [];

  for (let n = 0; n < 256; n++) {
    let c = n;

    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }

    table[n] = c >>> 0;
  }

  return table;
})();

function crc32(bytes: Uint8Array, start: number, end: number): number {
  let crc = 0xffffffff;

  for (let i = start; i < end; i++) {
    crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * A tiny PNG whose IHDR *claims* the given dimensions. The texture-memory
 * validators read only the header dimensions (TextureDefinition parses
 * metadata via exifr, never decoding pixels), so multi-hundred-megabyte
 * texture-memory fixtures stay ~100 bytes on disk and in memory. The IHDR
 * of a real 1x1 pngjs image is patched in place and its CRC recomputed, so
 * the chunk structure stays valid for metadata parsers.
 */
export function stubPngBytes(claimedWidth: number, claimedHeight: number): Uint8Array {
  const bytes = pngBytes(1, 1);

  // IHDR layout: bytes 8-11 length, 12-15 "IHDR", 16-19 width (BE),
  // 20-23 height (BE), then 5 format bytes; CRC over bytes 12..29 at 29-32.
  const writeUint32BE = (offset: number, value: number) => {
    bytes[offset] = (value >>> 24) & 0xff;
    bytes[offset + 1] = (value >>> 16) & 0xff;
    bytes[offset + 2] = (value >>> 8) & 0xff;
    bytes[offset + 3] = value & 0xff;
  };

  writeUint32BE(16, claimedWidth);
  writeUint32BE(20, claimedHeight);
  writeUint32BE(29, crc32(bytes, 12, 29));

  return bytes;
}

/** One behavior-pack type-definition family run through the type-manager version pairs. */
export interface ITypeManagerPairFamily {
  /** Generator id of the owning manager ("ENTITYTYPE" or "ITEMTYPE"). */
  readonly generatorId: string;
  /** Fixture id stem, e.g. "entitytype". */
  readonly familySlug: string;
  /** Human label used in fixture descriptions, e.g. "Entity type". */
  readonly label: string;
  /** Project-relative path of the definition file under test. */
  readonly defPath: string;
  /** Shared pack files both fixtures build on. */
  readonly packFiles: ValidationFixtureFiles;
  /** Definition-file content for a format_version (undefined = omit the field). */
  readonly content: (formatVersion: readonly number[] | undefined) => string;
}

interface ITypeManagerVersionCase {
  readonly ruleIndex: number;
  readonly slug: string;
  readonly severity: ValidationResultExpectation["severity"];
  readonly message: string;
  readonly rejectVersion: (v: readonly number[]) => readonly number[];
  readonly acceptVersion: (v: readonly number[]) => readonly number[];
}

/**
 * The six format-version boundary checks EntityTypeManager and
 * ItemTypeManager share, compared against the pinned current version.
 * Unlike the FORMATVER minor-window check, these managers gate the minor
 * version at a raw current-minus-one (no skipped-minor awareness), so the
 * accepting boundary for the lower-minor rule sits exactly at minor - 1.
 */
const typeManagerVersionCases: readonly ITypeManagerVersionCase[] = [
  {
    ruleIndex: 110,
    slug: "lower-major",
    severity: InfoItemType.recommendation,
    message: "has a lower major version number",
    rejectVersion: VersionBoundaries.lowerMajor,
    acceptVersion: VersionBoundaries.exact,
  },
  {
    ruleIndex: 111,
    slug: "higher-major",
    severity: InfoItemType.error,
    message: "has a higher major version number",
    rejectVersion: VersionBoundaries.higherMajor,
    acceptVersion: VersionBoundaries.exact,
  },
  {
    ruleIndex: 120,
    slug: "lower-minor",
    severity: InfoItemType.recommendation,
    message: "has a lower minor version number",
    rejectVersion: (v) => [v[0], v[1] - 2, 0],
    // Boundary: the newest minor the raw N-1 gate still accepts.
    acceptVersion: (v) => [v[0], v[1] - 1, 0],
  },
  {
    ruleIndex: 121,
    slug: "higher-minor",
    severity: InfoItemType.error,
    message: "has a higher minor version number",
    rejectVersion: VersionBoundaries.higherMinor,
    acceptVersion: VersionBoundaries.exact,
  },
  {
    ruleIndex: 130,
    slug: "lower-patch",
    severity: InfoItemType.recommendation,
    message: "has a lower patch version number",
    rejectVersion: VersionBoundaries.lowerPatch,
    acceptVersion: VersionBoundaries.exact,
  },
  {
    ruleIndex: 131,
    slug: "higher-patch",
    severity: InfoItemType.error,
    message: "has a higher patch version number",
    rejectVersion: VersionBoundaries.higherPatch,
    acceptVersion: VersionBoundaries.exact,
  },
];

/**
 * Builds the six shared format-version boundary pairs for one type-manager
 * family (see typeManagerVersionCases). The family-specific
 * missing-format_version rule (100) differs mechanically between the two
 * managers, so each family module declares that pair itself.
 */
export function typeManagerFormatVersionPairs(family: ITypeManagerPairFamily): ValidationRuleCoveragePair[] {
  const fileName = family.defPath.substring(family.defPath.lastIndexOf("/") + 1);
  const escapedFileName = fileName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pathPattern = new RegExp(`${escapedFileName}$`);

  return typeManagerVersionCases.map((versionCase) => {
    const rejectVersion = versionCase.rejectVersion(PinnedVersion);
    const acceptVersion = versionCase.acceptVersion(PinnedVersion);
    const stem = `${family.familySlug}-${versionCase.slug}`;

    return coveragePairFromBase({
      ruleKey: `${family.generatorId}:${versionCase.ruleIndex}` as ValidationRuleKey,
      category: "manager",
      suite: ProjectInfoSuite.defaultInDevelopment,
      baseFiles: family.packFiles,
      accepting: {
        id: `harness-${stem}-accept`,
        description: `${family.label} definition at format_version ${acceptVersion.join(".")}; ${
          family.generatorId
        }:${versionCase.ruleIndex} must stay quiet.`,
        files: { [family.defPath]: family.content(acceptVersion) },
      },
      rejecting: {
        id: `harness-${stem}-reject`,
        description: `${family.label} definition at format_version ${rejectVersion.join(".")}; ${
          family.generatorId
        }:${versionCase.ruleIndex} must flag it.`,
        files: { [family.defPath]: family.content(rejectVersion) },
      },
      rejectingExpectation: {
        severity: versionCase.severity,
        count: 1,
        projectPath: pathPattern,
        message: versionCase.message,
      },
    });
  });
}

/** Standard en_US language files for a pack that uses localization. */
export function langFiles(root: string, tokens: Record<string, string>): { [relativePath: string]: string } {
  const lines = Object.entries(tokens)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  return {
    [`${root}/texts/en_US.lang`]: lines + "\n",
    [`${root}/texts/languages.json`]: json(["en_US"]),
  };
}
