// Minimal ambient declaration for the untyped `jsdom` dev dependency, used by
// unit tests that need a DOM (e.g. TextCellRenderer.spec.ts). Only the surface
// the tests exercise is declared.
declare module "jsdom" {
  export class JSDOM {
    constructor(html?: string, options?: any);
    window: any;
  }
}
