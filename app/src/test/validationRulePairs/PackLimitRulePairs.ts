// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * PackLimitRulePairs — paired E2E coverage for PACKSIZE (the 25 MB add-on
 * and 250 MB package content ceilings plus unreadable containers) and
 * PACKFILECOUNT (the 10,000-file ceiling and the folder-depth traversal
 * guard).
 *
 * Size and count ceilings are exercised exactly at their boundaries: the
 * accepting fixture sits at == limit and the rejecting fixture adds a single
 * one-byte file. The bulky content lives inside synthesized zip containers
 * (ZipFixtureBytes) that the validators descend into, so a fixture whose
 * countable content is 250 MB (or 10,000 files) is a few hundred KiB on
 * disk.
 *
 * The heavy base file sets are passed to coveragePairFromBase as thunks so
 * the zip payloads are synthesized only when a PACKSIZE/PACKFILECOUNT pair
 * actually runs — importing this registry (e.g. for a targeted run of
 * another family) allocates nothing.
 */

import { InfoItemType } from "../../info/IInfoItemData";
import { ProjectInfoSuite } from "../../info/IProjectInfoData";
import { ValidationRuleCoveragePair } from "../ValidationRuleHarness";
import { BpManifestPath, BpRoot, bpManifest, coveragePairFromBase, json, minimalBpFiles } from "./PairFixtureBuilders";
import { zipFileBytes, zipWithEmptyEntries, zipWithPayloadOfSize } from "./ZipFixtureBytes";

const AddOnContentSizeLimit = 25000000;
const PackageContentSizeLimit = 250000000;
const RecommendedMaxFileCount = 10000;

// Pack-size accounting counts text files whitespace-stripped
// (IFile.coreContentLength), so the manifest's contribution is its
// non-whitespace length.
const manifestBytes = json(bpManifest()).replace(/\s/g, "").length;
const ArchivePath = `${BpRoot}/data/harness_archive.zip`;
const ExtraBytePath = `${BpRoot}/harness_extra.bin`;

/** Pack whose content (manifest + zipped payload) is exactly `size` bytes. */
const packWithContentOfSize = (size: number) => ({
  ...minimalBpFiles(),
  [ArchivePath]: zipWithPayloadOfSize("payload/harness_blob.bin", size - manifestBytes),
});

const smallValidZip = zipFileBytes([{ name: "payload/harness_note.bin", data: new Uint8Array(4) }]);

// PACKFILECOUNT counts the manifest, the archive itself, and every inner
// entry; 9,998 zipped entries put the accepting fixture at exactly 10,000.
const packAtFileCountLimit = () => ({
  ...minimalBpFiles(),
  [ArchivePath]: zipWithEmptyEntries(RecommendedMaxFileCount - 2),
});

const DeepFolderChain = `${BpRoot}/d03/d04/d05/d06/d07/d08/d09/d10/d11/d12/d13/d14/d15`;

export const PackLimitRulePairs: readonly ValidationRuleCoveragePair[] = [
  coveragePairFromBase({
    ruleKey: "PACKSIZE:401",
    category: "project",
    suite: ProjectInfoSuite.cooperativeAddOn,
    baseFiles: () => packWithContentOfSize(AddOnContentSizeLimit),
    accepting: {
      id: "harness-packsize-addon-accept",
      description: "Add-on content at exactly the 25 MB ceiling; PACKSIZE:401 must stay quiet.",
    },
    rejecting: {
      id: "harness-packsize-addon-reject",
      description: "Add-on content one byte over the 25 MB ceiling; PACKSIZE:401 must flag it.",
      files: { [ExtraBytePath]: new Uint8Array(1) },
    },
    rejectingExpectation: {
      severity: InfoItemType.error,
      count: 1,
      message: "Exceeds Recommended Addon Size",
      data: AddOnContentSizeLimit + 1,
    },
  }),

  coveragePairFromBase({
    ruleKey: "PACKSIZE:402",
    category: "project",
    suite: ProjectInfoSuite.defaultInDevelopment,
    baseFiles: () => packWithContentOfSize(PackageContentSizeLimit),
    accepting: {
      id: "harness-packsize-package-accept",
      description: "Pack content at exactly the 250 MB ceiling; PACKSIZE:402 must stay quiet.",
    },
    rejecting: {
      id: "harness-packsize-package-reject",
      description: "Pack content one byte over the 250 MB ceiling; PACKSIZE:402 must flag it.",
      files: { [ExtraBytePath]: new Uint8Array(1) },
    },
    rejectingExpectation: {
      severity: InfoItemType.error,
      count: 1,
      message: "Exceeds Recommended Package Size",
      data: PackageContentSizeLimit + 1,
    },
  }),

  coveragePairFromBase({
    ruleKey: "PACKSIZE:410",
    category: "project",
    suite: ProjectInfoSuite.defaultInDevelopment,
    baseFiles: minimalBpFiles(),
    accepting: {
      id: "harness-packsize-container-accept",
      description: "Well-formed zip container; PACKSIZE:410 must stay quiet.",
      files: { [ArchivePath]: smallValidZip },
    },
    rejecting: {
      id: "harness-packsize-container-reject",
      description: "Unreadable zip container; PACKSIZE:410 must flag it.",
      files: { [ArchivePath]: new Uint8Array(64).fill(0xcd) },
    },
    rejectingExpectation: {
      severity: InfoItemType.error,
      count: 1,
      message: "Zip File Could Not Be Processed",
    },
  }),

  coveragePairFromBase({
    ruleKey: "PACKFILECOUNT:401",
    category: "project",
    suite: ProjectInfoSuite.defaultInDevelopment,
    baseFiles: packAtFileCountLimit,
    accepting: {
      id: "harness-packfilecount-limit-accept",
      description: "Pack with exactly 10,000 files (the recommended maximum); PACKFILECOUNT:401 must stay quiet.",
    },
    rejecting: {
      id: "harness-packfilecount-limit-reject",
      description: "Pack with 10,001 files; PACKFILECOUNT:401 must warn.",
      files: { [ExtraBytePath]: new Uint8Array(1) },
    },
    rejectingExpectation: {
      severity: InfoItemType.warning,
      count: 1,
      message: "Marketplace best practices recommend keeping packs under 10000 files",
      data: RecommendedMaxFileCount + 1,
    },
  }),

  coveragePairFromBase({
    ruleKey: "PACKFILECOUNT:402",
    category: "project",
    suite: ProjectInfoSuite.defaultInDevelopment,
    baseFiles: {
      [BpManifestPath]: json(bpManifest()),
      [`${DeepFolderChain}/harness_deep.bin`]: new Uint8Array(1),
    },
    accepting: {
      id: "harness-packfilecount-depth-accept",
      description: "Folder nesting within the traversal depth cap; PACKFILECOUNT:402 must stay quiet.",
    },
    rejecting: {
      id: "harness-packfilecount-depth-reject",
      description: "A subfolder beyond the traversal depth cap; PACKFILECOUNT:402 must warn about the undercount.",
      files: { [`${DeepFolderChain}/d16/harness_deeper.bin`]: new Uint8Array(1) },
    },
    rejectingExpectation: {
      severity: InfoItemType.warning,
      count: 1,
      message: "Folder nesting exceeded the maximum traversal depth",
      data: 1,
    },
  }),
];
