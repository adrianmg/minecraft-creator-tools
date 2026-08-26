// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * ZipImportSizeTest.ts
 *
 * Tests for the content-scoped zip-import size handling:
 *  - The 500 MiB limit applies only to files under the top-level "Content/" folder.
 *  - Non-Content/ files do not count toward the 500 MiB content limit.
 *  - The lower-level unzip safety ceiling is 2 GiB.
 *  - Specific, structured ZipImportErrors are raised for the content-over-limit and
 *    package-over-safety-ceiling cases (instead of a generic failure).
 *
 * The size-budget logic is verified through the pure SecurityUtilities helpers using
 * synthetic sizes (no multi-GB buffers), and the real throw path is verified end-to-end
 * through ZipStorage.loadFromUint8Array on small zips.
 */

// NOTE: import CreatorTools first to prime the module-load order. The storage module graph
// has a circular dependency (FileBase <-> StorageUtilities <-> ... <-> GitHubFile) that only
// resolves cleanly when a higher-level module is evaluated first; importing ZipStorage in
// isolation triggers "Class extends value undefined". Other standalone tests do the same.
import "../app/CreatorTools";
import { expect } from "chai";
import SecurityUtilities from "../core/SecurityUtilities";
import ZipStorage from "../storage/ZipStorage";
import ZipImportError, { ZipImportErrorCode } from "../storage/ZipImportError";
import { buildSizeSpoofedZip, SpoofedZipEntry } from "./ZipFixtures";

const MB = 1024 * 1024;

describe("Zip import size handling", function () {
  // Fixtures are compact (sizes are declared in zip metadata, not materialized), so these run
  // fast; the timeout mainly covers first-time module/graph initialization.
  this.timeout(30000);

  describe("SecurityUtilities.isContentPath", () => {
    it("recognizes top-level Content/ files", () => {
      expect(SecurityUtilities.isContentPath("Content/world_template/level.dat")).to.equal(true);
      expect(SecurityUtilities.isContentPath("Content/")).to.equal(true);
    });

    it("normalizes leading slashes and backslashes", () => {
      expect(SecurityUtilities.isContentPath("/Content/foo.json")).to.equal(true);
      expect(SecurityUtilities.isContentPath("Content\\foo.json")).to.equal(true);
    });

    it("rejects non-Content paths", () => {
      expect(SecurityUtilities.isContentPath("docs/readme.md")).to.equal(false);
      expect(SecurityUtilities.isContentPath("ContentExtra/foo.json")).to.equal(false);
      expect(SecurityUtilities.isContentPath("worlds/Content/foo.json")).to.equal(false);
      expect(SecurityUtilities.isContentPath("")).to.equal(false);
    });
  });

  describe("SecurityUtilities.checkDecompressedSizeLimits", () => {
    it("keeps the compressed upload limit aligned with the total decompressed safety ceiling", () => {
      expect(SecurityUtilities.MAX_UPLOAD_SIZE).to.equal(SecurityUtilities.MAX_DECOMPRESSED_SIZE);
    });

    it("does not flag when only non-Content files push total over the content limit", () => {
      // Content/ stays under 500 MiB; non-Content build artifacts push the total well over it,
      // but stay under the 2 GiB safety ceiling -> no violation.
      const entries = [
        { path: "Content/world_template/level.dat", uncompressedSize: 100 * MB },
        { path: "build/artifact.bin", uncompressedSize: 600 * MB },
      ];

      const result = SecurityUtilities.checkDecompressedSizeLimits(entries);

      expect(result.contentSize).to.equal(100 * MB);
      expect(result.totalSize).to.equal(700 * MB);
      expect(result.violation).to.equal(undefined);
    });

    it("flags a content violation when Content/ exceeds 500 MiB", () => {
      const entries = [
        { path: "Content/world_template/big.dat", uncompressedSize: 501 * MB },
        { path: "docs/readme.md", uncompressedSize: 1 * MB },
      ];

      const result = SecurityUtilities.checkDecompressedSizeLimits(entries);

      expect(result.contentSize).to.equal(501 * MB);
      expect(result.violation).to.equal("content");
    });

    it("flags a total violation when the package exceeds the 2 GiB safety ceiling", () => {
      // Non-Content files alone push the total past 2 GiB; total/safety takes precedence.
      const entries = [
        { path: "Content/world_template/level.dat", uncompressedSize: 10 * MB },
        { path: "huge/blob.bin", uncompressedSize: 2100 * MB },
      ];

      const result = SecurityUtilities.checkDecompressedSizeLimits(entries);

      expect(result.totalSize).to.equal(2110 * MB);
      expect(result.violation).to.equal("total");
    });

    it("honors custom (small) limits for deterministic testing", () => {
      const entries = [
        { path: "Content/a.json", uncompressedSize: 150 },
        { path: "other/b.json", uncompressedSize: 400 },
      ];

      // maxContent=100, maxTotal=10000 -> content violation (150 > 100).
      expect(SecurityUtilities.checkDecompressedSizeLimits(entries, 100, 10000).violation).to.equal("content");

      // maxContent=10000, maxTotal=500 -> total violation (550 > 500), takes precedence.
      expect(SecurityUtilities.checkDecompressedSizeLimits(entries, 10000, 500).violation).to.equal("total");

      // Generous limits -> no violation.
      expect(SecurityUtilities.checkDecompressedSizeLimits(entries, 10000, 10000).violation).to.equal(undefined);
    });
  });

  describe("ZipImportError", () => {
    it("carries a stable code and status code, and is recognized by its type guard", () => {
      const err = new ZipImportError(ZipImportErrorCode.contentSizeExceeded, "too big", 413);

      expect(err.code).to.equal("CONTENT_SIZE_EXCEEDED");
      expect(err.statusCode).to.equal(413);
      expect(err.message).to.equal("too big");
      expect(err instanceof Error).to.equal(true);
      expect(ZipImportError.is(err)).to.equal(true);
      expect(ZipImportError.is(new Error("plain"))).to.equal(false);
    });

    it("pins the externally consumed wire values (changing any of these is a breaking API change)", () => {
      // These strings are serialized over /api/validate and switched on by external clients
      // (notably Auger). Assert the LITERALS — not enum-to-enum — so a rename of a wire value
      // fails loudly here instead of silently moving producer and assertion together, which is
      // exactly what an enum-based assertion elsewhere (e.g. the ServerCommandLineTest HTTP
      // suites) cannot catch on its own.
      expect(ZipImportErrorCode.contentSizeExceeded).to.equal("CONTENT_SIZE_EXCEEDED");
      expect(ZipImportErrorCode.packageSizeExceeded).to.equal("PACKAGE_SIZE_EXCEEDED");
      expect(ZipImportErrorCode.uploadTooLarge).to.equal("ZIP_UPLOAD_TOO_LARGE");
      expect(ZipImportErrorCode.tooManyFiles).to.equal("ZIP_TOO_MANY_FILES");
      expect(ZipImportErrorCode.invalidPath).to.equal("ZIP_INVALID_PATH");

      // String enums have no reverse mappings, so this count guards against a NEW code being
      // added without a corresponding literal pin above.
      expect(Object.keys(ZipImportErrorCode).length).to.equal(5);
    });
  });

  describe("ZipStorage.loadFromUint8Array (end-to-end small zips)", () => {
    // Entries at or below this size are materialized as REAL bytes, so the positive-path
    // fixtures are fully valid archives whose contents can be read back (JSZip verifies the
    // declared uncompressed size when an entry is actually decompressed). Only sizes above
    // this threshold are merely DECLARED in the central directory (see ZipFixtures), keeping
    // the 500 MiB cases a few hundred bytes without compressing or allocating large buffers —
    // the guard reads that declared metadata before any decompression happens.
    const REAL_DATA_MAX = 4096;

    function fixtureBytes(size: number): Uint8Array {
      const bytes = new Uint8Array(size);
      for (let i = 0; i < size; i++) {
        bytes[i] = 0x41 + (i % 26); // deterministic A..Z pattern; text-friendly for .json/.md reads
      }
      return bytes;
    }

    async function buildZip(files: { path: string; size: number }[]): Promise<Uint8Array> {
      const entries: SpoofedZipEntry[] = files.map((f) =>
        f.size <= REAL_DATA_MAX ? { path: f.path, data: fixtureBytes(f.size) } : { path: f.path, declaredSize: f.size }
      );

      return buildSizeSpoofedZip(entries);
    }

    it("imports a small package with a Content/ file", async () => {
      const data = await buildZip([
        { path: "Content/world_template/manifest.json", size: 64 },
        { path: "README.md", size: 16 },
      ]);

      const zs = new ZipStorage();
      await zs.loadFromUint8Array(data, "small.zip");

      const contentFolder = zs.rootFolder.ensureFolder("Content");
      expect(await contentFolder.exists()).to.equal(true);

      // Read the entry's bytes back to prove the fixture is a VALID archive (JSZip checks the
      // declared uncompressed size on read, so a spoofed small entry would fail here).
      const manifestFile = await zs.rootFolder.ensureFileFromRelativePath("/Content/world_template/manifest.json");
      await manifestFile.loadContent();
      expect((manifestFile.content as string).length).to.equal(64);
    });

    it("throws a content-size error when Content/ exceeds the content limit", async () => {
      // Build a compact zip whose Content/ entry DECLARES an uncompressed size just over 500 MiB
      // (no large buffer is materialized), so the guard trips fast and low-memory.
      const data = await buildZip([{ path: "Content/big.bin", size: SecurityUtilities.MAX_CONTENT_DECOMPRESSED_SIZE + 1 }]);

      const zs = new ZipStorage();
      let caught: unknown;

      try {
        await zs.loadFromUint8Array(data, "overcontent.zip");
      } catch (e) {
        caught = e;
      }

      expect(ZipImportError.is(caught)).to.equal(true);
      expect((caught as ZipImportError).code).to.equal(ZipImportErrorCode.contentSizeExceeded);
    });

    it("imports past size checks when only non-Content files are large", async () => {
      // Non-Content file just over the 500 MiB content limit, but under the 2 GiB ceiling:
      // this must NOT raise a content-size error (acceptance criterion 1, end to end).
      const data = await buildZip([
        { path: "Content/small.json", size: 32 },
        { path: "artifacts/blob.bin", size: SecurityUtilities.MAX_CONTENT_DECOMPRESSED_SIZE + 1 },
      ]);

      const zs = new ZipStorage();

      await zs.loadFromUint8Array(data, "noncontent.zip");

      const contentFolder = zs.rootFolder.ensureFolder("Content");
      expect(await contentFolder.exists()).to.equal(true);

      // The small Content/ entry is real data and must read back intact; only the oversized
      // non-Content entry uses a declared (spoofed) size.
      const smallFile = await zs.rootFolder.ensureFileFromRelativePath("/Content/small.json");
      await smallFile.loadContent();
      expect((smallFile.content as string).length).to.equal(32);
    });
  });
});
