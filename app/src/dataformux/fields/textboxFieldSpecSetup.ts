// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Environment shim that lets TextboxField.tsx (and the MUI/react-dom modules it
// pulls in) be required and rendered inside the Node-based unit-test process.
// Import this module BEFORE importing react-dom or TextboxField in a spec file:
// react-dom and emotion capture "is there a DOM?" at module-load time, so the
// jsdom globals must already be installed when they are first required.
//
// The unit specs share one Mocha process, so the globals installed here must
// not stay behind between module load and test execution (several modules
// branch on `typeof window` for host detection). Specs call restoreDomGlobals()
// right after their imports, then installDomGlobals()/restoreDomGlobals() from
// before()/after() hooks around the tests that actually render.

import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true });

const g = globalThis as any;

const domGlobalNames = [
  "window",
  "document",
  "navigator",
  "Node",
  "Element",
  "HTMLElement",
  "HTMLInputElement",
  "HTMLIFrameElement",
  "SVGElement",
  "Event",
  "MouseEvent",
  "KeyboardEvent",
];

const addedGlobals: string[] = [];

const elementPrototype = dom.window.HTMLElement.prototype;
const originalGetBoundingClientRect = elementPrototype.getBoundingClientRect;

/**
 * The jsdom window backing the installed globals. Use it to construct DOM
 * events and to reach prototype setters (e.g. HTMLInputElement value).
 */
export const domWindow: any = dom.window;

/**
 * Exposes the jsdom browser globals on globalThis (only those not already
 * defined) and marks the process as a React act() environment.
 */
export function installDomGlobals(): void {
  for (const name of domGlobalNames) {
    if (g[name] === undefined) {
      g[name] = domWindow[name];
      addedGlobals.push(name);
    }
  }

  // jsdom does no layout, so every rect is all zeros and MUI's Popper warns that
  // its anchor is not part of the document layout. Report a 1x1 box instead.
  elementPrototype.getBoundingClientRect = () => ({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 1,
    bottom: 1,
    width: 1,
    height: 1,
    toJSON: () => ({}),
  });

  g.IS_REACT_ACT_ENVIRONMENT = true;
}

/**
 * Removes whatever installDomGlobals() added so later-loaded specs keep seeing
 * a Node-like environment.
 */
export function restoreDomGlobals(): void {
  for (const name of addedGlobals) {
    delete g[name];
  }

  addedGlobals.length = 0;
  elementPrototype.getBoundingClientRect = originalGetBoundingClientRect;
  delete g.IS_REACT_ACT_ENVIRONMENT;
}

installDomGlobals();
