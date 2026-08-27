import { CellRenderer, CellRendererProps } from "tui-grid/types/renderer";

/**
 * A TUI Grid cell renderer that writes cell values via `textContent` instead of
 * `innerHTML`.
 *
 * TUI Grid's built-in `DefaultRenderer` renders every cell with
 * `el.innerHTML = dompurify.sanitize("" + props.formattedValue)`, using the
 * DOMPurify 2.3.9 copy that is statically inlined into the `tui-grid` bundle
 * (`dist/tui-grid.js`). That bundled sanitizer is affected by the nesting-based
 * mXSS advisory GHSA-gx9m-whjm-85jf, and the `dompurify` override in
 * package.json does NOT change it (tui-grid never requires the external module).
 *
 * Assigning to `textContent` means the value is treated as literal text: the
 * browser never parses it as HTML, so the vulnerable sanitizer path is never
 * reached regardless of what the cell value contains. Use this renderer for any
 * column whose values can originate from persisted or otherwise untrusted data.
 */
export default class TextCellRenderer implements CellRenderer {
  private el: HTMLDivElement;

  constructor(props: CellRendererProps) {
    this.el = document.createElement("div");
    // Match the padding/whitespace behavior of tui-grid's default text cell so
    // swapping in this renderer does not visibly change cell layout.
    this.el.className = "tui-grid-cell-content";
    this.render(props);
  }

  getElement() {
    return this.el;
  }

  render(props: CellRendererProps) {
    this.el.textContent = "" + (props.formattedValue ?? "");
  }
}
