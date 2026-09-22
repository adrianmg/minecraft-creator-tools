// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * PackReferenceRulePairs — paired E2E coverage for the pack-reference rule
 * families: RPDEPENDS (resource pack manifest dependency resolution) and
 * WPACKREFS (world_behavior_packs.json / world_resource_packs.json
 * reference files).
 *
 * Every fixture shares one deterministic UUID set: the behavior pack header
 * is fixtureUuid(0x10) and the resource pack header is fixtureUuid(0x20),
 * exactly as the bpManifest/rpManifest builders emit them, so reference
 * files and manifests can only agree (accepting) or disagree (rejecting) by
 * construction. Reference files live in a world template folder alongside
 * levelname.txt, mirroring how exported worlds carry them.
 */

import { InfoItemType } from "../../info/IInfoItemData";
import { ProjectInfoSuite } from "../../info/IProjectInfoData";
import { ValidationRuleCoveragePair, ValidationFixtureFiles } from "../ValidationRuleHarness";
import {
  BpManifestPath,
  RpManifestPath,
  WtRoot,
  bpManifest,
  coveragePairFromBase,
  fixtureUuid,
  json,
  rpManifest,
  worldTemplateFiles,
} from "./PairFixtureBuilders";

const BpHeaderUuid = fixtureUuid(0x10);
const RpHeaderUuid = fixtureUuid(0x20);

/** A syntactically valid (36-character) UUID no pack in the fixtures owns. */
const UnknownPackUuid = fixtureUuid(0x7e);

const RpReferencesPath = `${WtRoot}/world_resource_packs.json`;
const BpReferencesPath = `${WtRoot}/world_behavior_packs.json`;

const packReference = (packId: string, version: unknown = [1, 0, 0]) => ({ pack_id: packId, version });

/** Both pack manifests plus a world template to carry the reference files. */
const packReferenceBase: ValidationFixtureFiles = {
  [BpManifestPath]: json(bpManifest()),
  [RpManifestPath]: json(rpManifest()),
  ...worldTemplateFiles(),
};

export const PackReferenceRulePairs: readonly ValidationRuleCoveragePair[] = [
  // RPDEPENDS:102 — a resource pack manifest dependency must resolve to a
  // pack that is actually part of the project.
  coveragePairFromBase({
    ruleKey: "RPDEPENDS:102",
    category: "project",
    suite: ProjectInfoSuite.defaultInDevelopment,
    baseFiles: { [BpManifestPath]: json(bpManifest()) },
    accepting: {
      id: "harness-rpdepends-missing-dependency-accept",
      description:
        "Resource pack manifest depending on the sibling behavior pack's UUID; RPDEPENDS:102 must stay quiet.",
      files: {
        [RpManifestPath]: json(rpManifest({ dependencies: [{ uuid: BpHeaderUuid, version: [1, 0, 0] }] })),
      },
    },
    rejecting: {
      id: "harness-rpdepends-missing-dependency-reject",
      description:
        "Resource pack manifest depending on a UUID no included pack owns; RPDEPENDS:102 must flag the manifest.",
      files: {
        [RpManifestPath]: json(rpManifest({ dependencies: [{ uuid: UnknownPackUuid, version: [1, 0, 0] }] })),
      },
    },
    rejectingExpectation: {
      severity: InfoItemType.error,
      count: 1,
      projectPath: /test_rp\/manifest\.json$/,
      message: "is not located in any included resource or behavior packs",
    },
  }),

  // RPDEPENDS:103 — a manifest whose dependencies value cannot be iterated
  // throws inside the dependency scan and is reported as an ordinary error
  // on that manifest.
  coveragePairFromBase({
    ruleKey: "RPDEPENDS:103",
    category: "project",
    suite: ProjectInfoSuite.defaultInDevelopment,
    baseFiles: { [BpManifestPath]: json(bpManifest()) },
    accepting: {
      id: "harness-rpdepends-processing-accept",
      description: "Resource pack manifest whose dependencies value is an array; RPDEPENDS:103 must stay quiet.",
      files: {
        [RpManifestPath]: json(rpManifest({ dependencies: [{ uuid: BpHeaderUuid, version: [1, 0, 0] }] })),
      },
    },
    rejecting: {
      id: "harness-rpdepends-processing-reject",
      description:
        "Resource pack manifest whose dependencies value is an object (not iterable); RPDEPENDS:103 must flag the manifest.",
      files: {
        [RpManifestPath]: json(rpManifest({ dependencies: {} })),
      },
    },
    rejectingExpectation: {
      severity: InfoItemType.error,
      count: 1,
      projectPath: /test_rp\/manifest\.json$/,
      message: "Error processing manifest",
    },
  }),

  // WPACKREFS:201 — the reference file must be a JSON array of references.
  coveragePairFromBase({
    ruleKey: "WPACKREFS:201",
    category: "project",
    suite: ProjectInfoSuite.defaultInDevelopment,
    baseFiles: packReferenceBase,
    accepting: {
      id: "harness-wpackrefs-invalid-json-accept",
      description:
        "world_resource_packs.json holding an array with one resolvable reference; WPACKREFS:201 must stay quiet.",
      files: { [RpReferencesPath]: json([packReference(RpHeaderUuid)]) },
    },
    rejecting: {
      id: "harness-wpackrefs-invalid-json-reject",
      description: "world_resource_packs.json holding an object instead of an array; WPACKREFS:201 must flag it.",
      files: { [RpReferencesPath]: json(packReference(RpHeaderUuid)) },
    },
    rejectingExpectation: {
      severity: InfoItemType.error,
      count: 1,
      projectPath: /world_resource_packs\.json$/,
      message: "Invalid JSON format in world_resource_packs.json. Expected an array of pack references.",
    },
  }),

  // WPACKREFS:203 — every reference's pack_id must be a well-formed UUID.
  coveragePairFromBase({
    ruleKey: "WPACKREFS:203",
    category: "project",
    suite: ProjectInfoSuite.defaultInDevelopment,
    baseFiles: packReferenceBase,
    accepting: {
      id: "harness-wpackrefs-invalid-pack-id-accept",
      description:
        "world_resource_packs.json whose reference carries the resource pack's UUID; WPACKREFS:203 must stay quiet.",
      files: { [RpReferencesPath]: json([packReference(RpHeaderUuid)]) },
    },
    rejecting: {
      id: "harness-wpackrefs-invalid-pack-id-reject",
      description: "world_resource_packs.json whose reference pack_id is not a UUID; WPACKREFS:203 must flag it.",
      files: { [RpReferencesPath]: json([packReference("not-a-valid-uuid")]) },
    },
    rejectingExpectation: {
      severity: InfoItemType.error,
      count: 1,
      projectPath: /world_resource_packs\.json$/,
      message: "Invalid UUID format for pack_id [not-a-valid-uuid] at index 0",
    },
  }),

  // WPACKREFS:205 — a reference's version must be three non-negative numbers.
  coveragePairFromBase({
    ruleKey: "WPACKREFS:205",
    category: "project",
    suite: ProjectInfoSuite.defaultInDevelopment,
    baseFiles: packReferenceBase,
    accepting: {
      id: "harness-wpackrefs-invalid-version-accept",
      description: "world_resource_packs.json reference with a [1, 0, 0] version; WPACKREFS:205 must stay quiet.",
      files: { [RpReferencesPath]: json([packReference(RpHeaderUuid)]) },
    },
    rejecting: {
      id: "harness-wpackrefs-invalid-version-reject",
      description:
        "world_resource_packs.json reference whose version has only two components; WPACKREFS:205 must flag it.",
      files: { [RpReferencesPath]: json([packReference(RpHeaderUuid, [1, 0])]) },
    },
    rejectingExpectation: {
      severity: InfoItemType.error,
      count: 1,
      projectPath: /world_resource_packs\.json$/,
      message: `Invalid version format. Expected valid version string or array of 3 non-negative numbers for pack_id [${RpHeaderUuid}] at index 0`,
    },
  }),

  // WPACKREFS:206 — a well-formed reference must resolve to a pack in the
  // project (exercised through the behavior-pack reference file).
  coveragePairFromBase({
    ruleKey: "WPACKREFS:206",
    category: "project",
    suite: ProjectInfoSuite.defaultInDevelopment,
    baseFiles: packReferenceBase,
    accepting: {
      id: "harness-wpackrefs-unresolved-reference-accept",
      description: "world_behavior_packs.json referencing the behavior pack's UUID; WPACKREFS:206 must stay quiet.",
      files: { [BpReferencesPath]: json([packReference(BpHeaderUuid)]) },
    },
    rejecting: {
      id: "harness-wpackrefs-unresolved-reference-reject",
      description:
        "world_behavior_packs.json referencing a UUID no included pack owns; WPACKREFS:206 must flag the reference.",
      files: { [BpReferencesPath]: json([packReference(UnknownPackUuid)]) },
    },
    rejectingExpectation: {
      severity: InfoItemType.error,
      count: 1,
      projectPath: /world_behavior_packs\.json$/,
      message: `Pack reference [${UnknownPackUuid}] not found in project.`,
    },
  }),

  // WPACKREFS:207 — a reference version that parses to a non-array whose
  // length happens to be 3 (e.g. {"length": 3}) throws inside version
  // validation and is reported as an ordinary error.
  coveragePairFromBase({
    ruleKey: "WPACKREFS:207",
    category: "project",
    suite: ProjectInfoSuite.defaultInDevelopment,
    baseFiles: packReferenceBase,
    accepting: {
      id: "harness-wpackrefs-processing-accept",
      description: "world_resource_packs.json reference with an array version; WPACKREFS:207 must stay quiet.",
      files: { [RpReferencesPath]: json([packReference(RpHeaderUuid)]) },
    },
    rejecting: {
      id: "harness-wpackrefs-processing-reject",
      description:
        "world_resource_packs.json reference whose version is an object with a length of 3; WPACKREFS:207 must flag it.",
      files: { [RpReferencesPath]: json([packReference(RpHeaderUuid, { length: 3 })]) },
    },
    rejectingExpectation: {
      severity: InfoItemType.error,
      count: 1,
      message: "Internal processing error",
    },
  }),
];
