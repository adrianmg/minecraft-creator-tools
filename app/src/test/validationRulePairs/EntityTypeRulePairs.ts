// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * EntityTypeRulePairs — paired E2E coverage for the behavior pack entity
 * type manager (ENTITYTYPE), which checks entity definition format_versions
 * against the pinned current product version (TestVersionPin via
 * Database.getLatestVersionInfo).
 *
 * The six version-boundary pairs come from the shared type-manager case
 * table (typeManagerFormatVersionPairs); only the missing-format_version
 * rule is declared here, because for this manager it fires solely when the
 * definition file cannot be read as text at all (an empty file) — a
 * parseable definition without a format_version reads as 0.0.0 and is
 * flagged by the lower-major rule instead (see EntityTypeManagerData.ts).
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

const EntityDefPath = `${BpRoot}/entities/harness_mob.json`;

function entityContent(formatVersion: readonly number[] | undefined): string {
  const value: any = {
    "minecraft:entity": {
      description: {
        identifier: "test:harness_mob",
        is_spawnable: true,
        is_summonable: true,
        is_experimental: false,
      },
      components: {},
    },
  };

  if (formatVersion !== undefined) {
    value.format_version = formatVersion.join(".");
  }

  return json(value);
}

const missingFormatVersionPair: ValidationRuleCoveragePair = coveragePairFromBase({
  ruleKey: "ENTITYTYPE:100",
  category: "manager",
  suite: ProjectInfoSuite.defaultInDevelopment,
  baseFiles: minimalBpFiles(),
  accepting: {
    id: "harness-entitytype-no-fv-accept",
    description: "Entity type definition with the current format_version; ENTITYTYPE:100 must stay quiet.",
    files: { [EntityDefPath]: entityContent(PinnedVersion) },
  },
  rejecting: {
    id: "harness-entitytype-no-fv-reject",
    description:
      "Entity type definition file that is empty, so no format_version can be read; ENTITYTYPE:100 must flag it.",
    files: { [EntityDefPath]: "" },
  },
  rejectingExpectation: {
    severity: InfoItemType.error,
    count: 1,
    projectPath: /harness_mob\.json$/,
    message: "does not define a format_version",
  },
});

export const EntityTypeRulePairs: readonly ValidationRuleCoveragePair[] = [
  missingFormatVersionPair,
  ...typeManagerFormatVersionPairs({
    generatorId: "ENTITYTYPE",
    familySlug: "entitytype",
    label: "Entity type",
    defPath: EntityDefPath,
    packFiles: minimalBpFiles(),
    content: entityContent,
  }),
];
