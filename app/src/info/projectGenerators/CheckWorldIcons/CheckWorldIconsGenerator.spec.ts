// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { expect } from "chai";
import CheckWorldIconsGenerator from "./CheckWorldIconsGenerator";
import { CheckWorldIconsGeneratorTest, createStubFolderWithFiles } from "./CheckWorldIconsGeneratorData";
import { createStubProject } from "../../../test/stubs/app/projects/StubProject";
import { createStubProjectItem } from "../../../test/stubs/app/projects/StubProjectItem";
import { createStubFile } from "../../../test/stubs/app/io/StubFile";
import { ProjectItemType } from "../../../app/IProjectItemData";

describe("CheckWorldIconsGenerator", () => {
  let generator: CheckWorldIconsGenerator;

  beforeEach(() => {
    generator = new CheckWorldIconsGenerator();
  });

  it("should have correct id and title", () => {
    expect(generator.id).to.equal("CWI");
    expect(generator.title).to.be.a("string").and.have.length.above(0);
  });

  it("should return no results when there are no world template manifest items", async () => {
    const results = await generator.generate(createStubProject());
    expect(results.length).to.equal(0);
  });

  it("should return no results when the world template item has no associated folder", async () => {
    const item = createStubProjectItem({
      itemType: ProjectItemType.worldTemplateManifestJson,
      getFolder: () => null,
    });
    const results = await generator.generate(createStubProject([item]));
    expect(results.length).to.equal(0);
  });

  it("should flag a missing world icon when the folder contains no icon files", async () => {
    const folder = createStubFolderWithFiles([]);
    const item = createStubProjectItem({
      itemType: ProjectItemType.worldTemplateManifestJson,
      getFolder: () => folder,
    });
    const results = await generator.generate(createStubProject([item]));
    const errors = results.filter((r) => r.generatorIndex === CheckWorldIconsGeneratorTest.NoIconFound);
    expect(errors.length).to.equal(1);
  });

  it("should flag multiple world icons when more than one icon file is found", async () => {
    const icon1 = createStubFile({ name: "world_icon.jpeg", content: null });
    const icon2 = createStubFile({ name: "world_icon_small.jpeg", content: null });
    const folder = createStubFolderWithFiles([icon1, icon2]);
    const item = createStubProjectItem({
      itemType: ProjectItemType.worldTemplateManifestJson,
      getFolder: () => folder,
    });
    const results = await generator.generate(createStubProject([item]));
    const errors = results.filter((r) => r.generatorIndex === CheckWorldIconsGeneratorTest.MultipleIconsFound);
    expect(errors.length).to.equal(1);
  });

  it("should flag an icon that cannot be parsed as a valid image", async () => {
    // File with null content: getContentsAsBinary() returns undefined → parseImageMetadata returns null
    const iconFile = createStubFile({ name: "world_icon.jpeg", content: null });
    const folder = createStubFolderWithFiles([iconFile]);
    const item = createStubProjectItem({
      itemType: ProjectItemType.worldTemplateManifestJson,
      getFolder: () => folder,
    });
    const results = await generator.generate(createStubProject([item]));
    const errors = results.filter((r) => r.generatorIndex === CheckWorldIconsGeneratorTest.IconNotValidImage);
    expect(errors.length).to.equal(1);
  });

  it("should accept a plain JFIF world icon with no EXIF metadata at the Bedrock size", async () => {
    // Exported world icons are commonly JFIF JPEGs without an EXIF block;
    // Exifr yields no metadata for those, so dimensions must come from the
    // JPEG frame-header fallback in parseImageMetadata.
    const iconFile = createStubFile({ name: "world_icon.jpeg", content: minimalJfifJpeg(800, 450) });
    const folder = createStubFolderWithFiles([iconFile]);
    const item = createStubProjectItem({
      itemType: ProjectItemType.worldTemplateManifestJson,
      getFolder: () => folder,
    });
    const results = await generator.generate(createStubProject([item]));
    expect(results.length).to.equal(0);
  });

  it("should flag a plain JFIF world icon whose frame size is not the Bedrock size", async () => {
    const iconFile = createStubFile({ name: "world_icon.jpeg", content: minimalJfifJpeg(801, 450) });
    const folder = createStubFolderWithFiles([iconFile]);
    const item = createStubProjectItem({
      itemType: ProjectItemType.worldTemplateManifestJson,
      getFolder: () => folder,
    });
    const results = await generator.generate(createStubProject([item]));
    const errors = results.filter((r) => r.generatorIndex === CheckWorldIconsGeneratorTest.IconNotValidSize);
    expect(errors.length).to.equal(1);
  });

  it("should accept a JFIF world icon whose markers carry legal 0xFF fill bytes", async () => {
    const plain = minimalJfifJpeg(800, 450);
    // Insert a fill byte after SOI: FF D8 FF E0 ... becomes FF D8 FF FF E0 ...
    const padded = new Uint8Array(plain.length + 1);
    padded.set(plain.subarray(0, 2), 0);
    padded[2] = 0xff;
    padded.set(plain.subarray(2), 3);
    const iconFile = createStubFile({ name: "world_icon.jpeg", content: padded });
    const folder = createStubFolderWithFiles([iconFile]);
    const item = createStubProjectItem({
      itemType: ProjectItemType.worldTemplateManifestJson,
      getFolder: () => folder,
    });
    const results = await generator.generate(createStubProject([item]));
    expect(results.length).to.equal(0);
  });

  it("should flag a JPEG whose frame segment is truncated before its declared length", async () => {
    // SOF0 declares a 17-byte segment (00 11) but the stream ends after 5
    // payload bytes; dimensions from such a frame must not be trusted.
    const truncated = new Uint8Array([
      0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0xc2, 0x03, 0x20, 0x03, 0xff, 0xd9,
    ]);
    const iconFile = createStubFile({ name: "world_icon.jpeg", content: truncated });
    const folder = createStubFolderWithFiles([iconFile]);
    const item = createStubProjectItem({
      itemType: ProjectItemType.worldTemplateManifestJson,
      getFolder: () => folder,
    });
    const results = await generator.generate(createStubProject([item]));
    const errors = results.filter((r) => r.generatorIndex === CheckWorldIconsGeneratorTest.IconNotValidImage);
    expect(errors.length).to.equal(1);
  });
});

/** A minimal JFIF JPEG (SOI + APP0 + SOF0 + EOI) with no EXIF segment. */
function minimalJfifJpeg(width: number, height: number): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8, // SOI
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, // APP0 "JFIF"
    0xff, 0xc0, 0x00, 0x11, 0x08, (height >> 8) & 0xff, height & 0xff, (width >> 8) & 0xff, width & 0xff, // SOF0
    0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
    0xff, 0xd9, // EOI
  ]);
}
