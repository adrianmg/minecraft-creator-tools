// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { InfoItemType } from "../info/IInfoItemData";
import { ProjectInfoSuite } from "../info/IProjectInfoData";
import {
  defineValidationRule,
  ValidationRuleDefinition,
  ValidationSeverity,
} from "../info/tests/ValidationRuleDefinition";

/**
 * Rule metadata for FormatVersionManager (FORMATVER). The generator applies
 * one shared version comparison (checkVersions) to eleven definition-file
 * families, each anchored at its own rule-index offset; the concrete rule
 * index is offset + a fixed per-check delta:
 *
 *   +0  format_version missing or malformed (error; for families that read a
 *                                          missing version as 0.0.0 this fires
 *                                          only on a malformed component count)
 *   +2  major lower than expected         (recommendation; error in the
 *                                          currentPlatformVersions suite)
 *   +4  major higher than expected        (error)
 *   +6  minor older than the N-1 window   (recommendation; error in the
 *                                          currentPlatformVersions suite)
 *   +8  minor higher than expected        (warning; suppressed in the
 *                                          currentPlatformVersions suite)
 *   +10 patch lower than expected         (recommendation)
 *   +12 patch higher, same minor          (error; suppressed in the
 *                                          currentPlatformVersions suite)
 *
 * Families that allow higher versions (attachables) skip +4/+8/+12, and
 * families pinned to an expected version with patch 0 can never emit +10;
 * those unreachable slots are deliberately not part of the rule inventory.
 */

export interface IFormatVersionFamily {
  /** lowerCamelCase family key used to derive rule names and fixture slugs. */
  readonly key: string;
  /** The type string the generator embeds in result messages (e.g. "Block type"). */
  readonly label: string;
  /** Rule-index offset passed to checkVersions for this family. */
  readonly offset: number;
  /**
   * Fixed expected version, or undefined when the family is compared against
   * the current product version from Database.getLatestVersionInfo.
   */
  readonly expectedVersion?: readonly number[];
  /** Families that tolerate higher-than-expected versions (attachables). */
  readonly allowHigherVersions?: boolean;
  /**
   * Families whose definition wrapper reports a missing format_version as
   * 0.0.0 (MinecraftUtilities.getVersionArrayFrom(undefined)); for these a
   * missing format_version is flagged by the lower-major check rather than the
   * +0 slot. The +0 slot is still reachable through a malformed version whose
   * component count is not three (e.g. "1.26.0.1"), so it is titled as a
   * malformed-version rule for these families instead of a missing one.
   */
  readonly missingFormatVersionReadsAsZero?: boolean;
}

export const FormatVersionFamilies: readonly IFormatVersionFamily[] = [
  { key: "blockType", label: "Block type", offset: 110, missingFormatVersionReadsAsZero: true },
  { key: "itemType", label: "Item type", offset: 130, missingFormatVersionReadsAsZero: true },
  { key: "recipe", label: "Recipe", offset: 150 },
  { key: "behaviorAnimation", label: "Behavior animation", offset: 170, expectedVersion: [1, 10, 0] },
  { key: "behaviorAnimationController", label: "Behavior animation controller", offset: 190, expectedVersion: [1, 10, 0] },
  { key: "resourceAnimation", label: "Resource animation", offset: 210, expectedVersion: [1, 10, 0] },
  {
    key: "resourceAnimationController",
    label: "Resource animation controller",
    offset: 230,
    expectedVersion: [1, 10, 0],
  },
  { key: "spawnRules", label: "Spawn rules", offset: 250, expectedVersion: [1, 12, 0] },
  { key: "attachable", label: "Attachables", offset: 270, expectedVersion: [1, 10, 0], allowHigherVersions: true },
  { key: "entityTypeResource", label: "Entity type resource", offset: 290, missingFormatVersionReadsAsZero: true },
  { key: "fogResource", label: "Fog resource", offset: 310 },
] as const;

const rule = (spec: {
  ruleIndex: number;
  name: string;
  title: string;
  severities: readonly ValidationSeverity[];
}): ValidationRuleDefinition =>
  defineValidationRule({
    generatorId: "FORMATVER",
    ruleIndex: spec.ruleIndex,
    name: spec.name,
    title: spec.title,
    severities: spec.severities,
    suites: [ProjectInfoSuite.defaultInDevelopment, ProjectInfoSuite.currentPlatformVersions],
    source: {
      file: "app/src/manager/FormatVersionManagerData.ts",
      symbol: "FormatVersionValidationRules",
    },
  });

export const FormatVersionValidationRules: readonly ValidationRuleDefinition[] = FormatVersionFamilies.flatMap(
  (family) => {
    const rules: ValidationRuleDefinition[] = [];

    // The +0 slot fires whenever checkVersions sees a version that is not
    // exactly three components. For most families the only way to reach that
    // is a missing format_version. For families whose wrapper reports a
    // missing version as 0.0.0 (missingFormatVersionReadsAsZero) the missing
    // case is caught by the lower-major check instead, but a malformed version
    // with the wrong number of components (e.g. "1.26.0.1") still trips +0 —
    // so the slot is reachable for every family and belongs in the inventory.
    rules.push(
      rule({
        ruleIndex: family.offset,
        name: family.missingFormatVersionReadsAsZero
          ? `${family.key}MalformedFormatVersion`
          : `${family.key}NoFormatVersion`,
        title: family.missingFormatVersionReadsAsZero
          ? `${family.label} Format Version Malformed`
          : `${family.label} Format Version Missing`,
        severities: [InfoItemType.error],
      })
    );

    rules.push(
      rule({
        ruleIndex: family.offset + 2,
        name: `${family.key}MajorVersionLower`,
        title: `${family.label} Format Version Major Version Lower Than Expected`,
        severities: [InfoItemType.recommendation, InfoItemType.error],
      })
    );

    if (!family.allowHigherVersions) {
      rules.push(
        rule({
          ruleIndex: family.offset + 4,
          name: `${family.key}MajorVersionHigher`,
          title: `${family.label} Format Version Major Version Higher Than Expected`,
          severities: [InfoItemType.error],
        })
      );
    }

    rules.push(
      rule({
        ruleIndex: family.offset + 6,
        name: `${family.key}MinorVersionTooOld`,
        title: `${family.label} Format Version Minor Version Below the Supported Window`,
        severities: [InfoItemType.recommendation, InfoItemType.error],
      })
    );

    if (!family.allowHigherVersions) {
      rules.push(
        rule({
          ruleIndex: family.offset + 8,
          name: `${family.key}MinorVersionHigher`,
          title: `${family.label} Format Version Minor Version Higher Than Expected`,
          severities: [InfoItemType.warning],
        })
      );
    }

    // Patch-lower is only emittable when the expected version has a nonzero
    // patch component, i.e. families compared against the current product
    // version.
    if (family.expectedVersion === undefined) {
      rules.push(
        rule({
          ruleIndex: family.offset + 10,
          name: `${family.key}PatchVersionLower`,
          title: `${family.label} Format Version Patch Version Lower Than Expected`,
          severities: [InfoItemType.recommendation],
        })
      );
    }

    if (!family.allowHigherVersions) {
      rules.push(
        rule({
          ruleIndex: family.offset + 12,
          name: `${family.key}PatchVersionHigher`,
          title: `${family.label} Format Version Patch Version Higher Than Expected`,
          severities: [InfoItemType.error],
        })
      );
    }

    return rules;
  }
);
