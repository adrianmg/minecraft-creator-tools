// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from "chai";
import JsonSchemaItemInfoGenerator from "./JsonSchemaItemInfoGenerator";
import { OfficialSchemaItemTypes } from "./JsonSchemaItemInfoData";
import ProjectItemUtilities from "../../../app/ProjectItemUtilities";
import { ProjectItemType } from "../../../app/IProjectItemData";
import { createStubProjectItem } from "../../../test/stubs/app/projects/StubProjectItem";
import { createStubFile } from "../../../test/stubs/app/io/StubFile";

const noOpContentIndex = { insert: () => {} } as any;

describe("JsonSchemaItemInfoGenerator", () => {
  const gen = new JsonSchemaItemInfoGenerator();

  it("has expected id and title", () => {
    assert.strictEqual(gen.id, "JSON");
    assert.strictEqual(gen.title, "JSON Schema Validation");
  });

  it("returns empty array when item has no primaryFile", async () => {
    const item = createStubProjectItem({ file: undefined });
    const results = await gen.generate(item, noOpContentIndex);
    assert.deepEqual(results, []);
  });

  it("returns empty array when primaryFile content is null", async () => {
    const file = createStubFile({ name: "entity.json", content: null });
    const item = createStubProjectItem({ file });
    const results = await gen.generate(item, noOpContentIndex);
    assert.deepEqual(results, []);
  });

  it("returns empty array when primaryFile content is a Uint8Array", async () => {
    const file = createStubFile({ name: "entity.png", content: new Uint8Array([1, 2, 3]) });
    const item = createStubProjectItem({ file });
    const results = await gen.generate(item, noOpContentIndex);
    assert.deepEqual(results, []);
  });

  it("returns empty array when getOfficialSchemaPath returns undefined", async () => {
    const file = createStubFile({ name: "entity.json", content: '{"format_version":"1.20.0"}' });
    const item = createStubProjectItem({
      file,
      getOfficialSchemaPath: () => undefined,
    });
    const results = await gen.generate(item, noOpContentIndex);
    assert.deepEqual(results, []);
  });

  // The rule inventory is a leaf data module that cannot import
  // ProjectItemUtilities, so it enumerates official-schema item types as a
  // literal list; this test keeps that list from drifting apart from the
  // production mapping in either direction.
  it("inventories exactly the item types with an official schema", () => {
    const expected = Object.values(ProjectItemType)
      .filter((value): value is ProjectItemType => typeof value === "number")
      .filter((itemType) => ProjectItemUtilities.getOfficialSchemaPathForType(itemType) !== undefined)
      .sort((a, b) => a - b);

    assert.deepEqual(
      [...OfficialSchemaItemTypes].sort((a, b) => a - b).map((t) => ProjectItemType[t]),
      expected.map((t) => ProjectItemType[t])
    );
  });
});
