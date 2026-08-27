// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { expect } from "chai";
import "./gridEditorSpecSetup";
import GridEditor from "./GridEditor";
import TextCellRenderer from "./TextCellRenderer";
import { OptColumn } from "tui-grid/types/options";

// Companion to TextCellRenderer.spec.ts for GHSA-gx9m-whjm-85jf: that spec
// proves TextCellRenderer writes cell values via textContent; this one proves
// GridEditor actually wires it in. It exercises the real private
// _withSafeRenderers method on a real GridEditor instance — the same
// transformation _addGrid applies to props.columns before constructing
// TuiGrid — so deleting or gutting that method fails these tests instead of
// silently restoring TUI Grid's vulnerable innerHTML-based DefaultRenderer.

class ExplicitRenderer {
  private el = { textContent: "" };
  getElement() {
    return this.el;
  }
  render() {}
}

function transform(columns?: OptColumn[]): OptColumn[] {
  const editor = new GridEditor({ readOnly: true } as any);
  return (editor as any)._withSafeRenderers(columns);
}

describe("GridEditor._withSafeRenderers", () => {
  it("defaults columns without a renderer to TextCellRenderer", () => {
    const result = transform([
      { name: "status", header: "Status" },
      { name: "message", header: "Message" },
    ]);

    expect(result.length).to.equal(2);
    for (const column of result) {
      expect((column.renderer as any)?.type).to.equal(TextCellRenderer);
    }
  });

  it("preserves columns that opt into an explicit renderer", () => {
    const explicit: OptColumn = {
      name: "custom",
      header: "Custom",
      renderer: { type: ExplicitRenderer as any },
    };

    const result = transform([explicit]);

    expect(result.length).to.equal(1);
    // The column must pass through untouched — same object, same renderer.
    expect(result[0]).to.equal(explicit);
    expect((result[0].renderer as any).type).to.equal(ExplicitRenderer);
  });

  it("handles a mix of defaulted and explicit renderers by position", () => {
    const explicit: OptColumn = { name: "b", renderer: { type: ExplicitRenderer as any } };
    const result = transform([{ name: "a" }, explicit, { name: "c" }]);

    expect(result.map((c) => c.name)).to.deep.equal(["a", "b", "c"]);
    expect((result[0].renderer as any).type).to.equal(TextCellRenderer);
    expect((result[1].renderer as any).type).to.equal(ExplicitRenderer);
    expect((result[2].renderer as any).type).to.equal(TextCellRenderer);
  });

  it("returns an empty column set when no columns are provided", () => {
    expect(transform(undefined)).to.deep.equal([]);
  });

  it("does not mutate the caller's column objects", () => {
    const original: OptColumn = { name: "status" };
    transform([original]);

    expect(original.renderer).to.equal(undefined);
  });
});
