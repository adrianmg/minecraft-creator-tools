// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { expect } from "chai";
import { JSDOM } from "jsdom";
import TextCellRenderer from "./TextCellRenderer";
import { CellRendererProps } from "tui-grid/types/renderer";

// Regression coverage for GHSA-gx9m-whjm-85jf: tui-grid's built-in
// DefaultRenderer renders cells via `innerHTML = dompurify.sanitize(value)`
// using the DOMPurify 2.3.9 copy inlined in the tui-grid bundle, which is
// vulnerable to nesting-based mXSS. TextCellRenderer is the mitigation:
// GridEditor defaults every column to it, and it must write cell values as
// literal text (textContent), never as parsed HTML.

// Craft a renderer props object; only formattedValue is exercised by the renderer.
function props(formattedValue: string): CellRendererProps {
  return { formattedValue } as unknown as CellRendererProps;
}

describe("TextCellRenderer", () => {
  // The unit specs share one Mocha process, so the jsdom document installed for
  // these tests must not leak into later specs (which could otherwise take
  // browser-only branches with `document` defined but `window` undefined).
  let hadPriorDocument = false;
  let priorDocument: unknown;

  before(() => {
    // Provide a DOM for document.createElement / textContent / innerHTML.
    const dom = new JSDOM("<!doctype html><html><body></body></html>");
    hadPriorDocument = "document" in globalThis;
    priorDocument = (globalThis as any).document;
    (globalThis as any).document = dom.window.document;
  });

  after(() => {
    if (hadPriorDocument) {
      (globalThis as any).document = priorDocument;
    } else {
      delete (globalThis as any).document;
    }
  });

  const craftedValues = [
    '<img src=x onerror="window.__xss=1">',
    "<svg><style><![CDATA[</style><img src=x onerror=alert(1)>]]></style></svg>",
    '<a id="mutate"><style></style><img src=1 onerror=alert(1)></a>',
    "<div><table><td><style></style><img src=x onerror=alert(1)></td></table></div>",
    "plain status message",
  ];

  craftedValues.forEach((value) => {
    it(`renders "${value.slice(0, 32)}..." as literal text, not HTML`, () => {
      const renderer = new TextCellRenderer(props(value));
      const el = renderer.getElement();

      // The exact input must round-trip as text...
      expect(el.textContent).to.equal(value);
      // ...and no HTML must have been parsed into child elements.
      expect(el.children.length).to.equal(0);
      expect(el.querySelector("img")).to.equal(null);
      expect(el.querySelector("svg")).to.equal(null);
    });
  });

  it("re-renders new values via textContent on update", () => {
    const renderer = new TextCellRenderer(props("first"));
    renderer.render(props('<img src=x onerror="alert(1)">'));
    const el = renderer.getElement();

    expect(el.textContent).to.equal('<img src=x onerror="alert(1)">');
    expect(el.children.length).to.equal(0);
  });

  it("tolerates null/undefined formattedValue", () => {
    const renderer = new TextCellRenderer(props(undefined as unknown as string));
    expect(renderer.getElement().textContent).to.equal("");
  });
});
