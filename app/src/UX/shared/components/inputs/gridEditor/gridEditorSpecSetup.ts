// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Import-time environment shims that make GridEditor.tsx requirable inside the
// Node-based unit-test process. Import this module BEFORE importing GridEditor
// in a spec file — module require order follows import declaration order.

import { JSDOM } from "jsdom";

declare const require: any;

// GridEditor.tsx imports .css files; give Node's module loader a no-op handler.
require.extensions[".css"] = () => undefined;

// tui-grid's UMD bundle (and the tui-date-picker/tui-time-picker bundles it
// requires) dereference browser globals at load time. Expose them from jsdom
// only for the duration of the module load, then remove whatever we added so
// later-loaded specs keep seeing a Node-like environment (several modules
// branch on `typeof window` for host detection).
const g = globalThis as any;
const dom = new JSDOM("<!doctype html><html><body></body></html>");
const domGlobals = ["window", "document", "navigator", "Node", "Element", "HTMLElement", "SVGElement"];
const addedGlobals: string[] = [];

for (const name of domGlobals) {
  if (g[name] === undefined) {
    g[name] = (dom.window as any)[name];
    addedGlobals.push(name);
  }
}

require("tui-grid");

for (const name of addedGlobals) {
  delete g[name];
}
