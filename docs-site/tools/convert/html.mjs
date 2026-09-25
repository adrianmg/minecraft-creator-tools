// Converts raw HTML fragments from CommonMark into MDX-safe JSX.
// Tags outside the allowlist (for example `<players>` in command syntax) become literal text.

const ALLOWED_TAGS = new Set([
  "a",
  "b",
  "blockquote",
  "br",
  "caption",
  "center",
  "code",
  "col",
  "colgroup",
  "dd",
  "del",
  "details",
  "div",
  "dl",
  "dt",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "i",
  "iframe",
  "img",
  "ins",
  "kbd",
  "li",
  "ol",
  "p",
  "pre",
  "s",
  "small",
  "span",
  "strong",
  "sub",
  "summary",
  "sup",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "u",
  "ul",
  "video",
]);

const VOID_TAGS = new Set(["br", "col", "hr", "img"]);

const ATTRIBUTE_NAMES = {
  allowfullscreen: "allowFullScreen",
  cellpadding: "cellPadding",
  cellspacing: "cellSpacing",
  class: "className",
  colspan: "colSpan",
  for: "htmlFor",
  frameborder: "frameBorder",
  rowspan: "rowSpan",
  srcset: "srcSet",
  tabindex: "tabIndex",
};

const TOKEN =
  /<!--[\s\S]*?-->|<(\/?)([A-Za-z][A-Za-z0-9-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/g;
const ATTRIBUTE = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

export function escapeJsxText(text) {
  return text.replace(/[{}<>]/g, (character) => `&#${character.charCodeAt(0)};`);
}

function styleObject(style) {
  const result = {};
  for (const declaration of style.split(";")) {
    const separator = declaration.indexOf(":");
    if (separator < 1) continue;
    const property = declaration
      .slice(0, separator)
      .trim()
      .replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    result[property] = declaration.slice(separator + 1).trim();
  }
  return result;
}

function jsxAttributes(text, rewriteUrl) {
  const attributes = [];
  for (const match of text.matchAll(ATTRIBUTE)) {
    const lower = match[1].toLowerCase();
    if (lower.startsWith("on")) continue;
    const name = ATTRIBUTE_NAMES[lower] ?? lower;
    let value = match[2] ?? match[3] ?? match[4];
    if (value === undefined) {
      attributes.push(name);
    } else if (lower === "style") {
      attributes.push(`style={${JSON.stringify(styleObject(value))}}`);
    } else {
      if ((lower === "href" || lower === "src") && rewriteUrl) {
        value = rewriteUrl(value, lower === "src" ? "image" : "link") ?? value;
      }
      attributes.push(value.includes('"') ? `${name}={${JSON.stringify(value)}}` : `${name}="${value}"`);
    }
  }
  return attributes.length ? " " + attributes.join(" ") : "";
}

/**
 * @param {string} html
 * @param {(url: string, kind: "link" | "image") => string} [rewriteUrl]
 * @returns {{ type: "jsx" | "text", value: string } | null} null when the fragment only holds comments.
 */
export function htmlToJsx(html, rewriteUrl) {
  let output = "";
  let text = "";
  let hasTag = false;
  let position = 0;

  for (const match of html.matchAll(TOKEN)) {
    const between = html.slice(position, match.index);
    output += escapeJsxText(between);
    text += between;
    position = match.index + match[0].length;

    if (match[0].startsWith("<!--")) continue;

    const [, closing, rawName, attributeText, selfClosing] = match;
    const name = rawName.toLowerCase();
    if (!ALLOWED_TAGS.has(name)) {
      output += escapeJsxText(match[0]);
      text += match[0];
      continue;
    }

    hasTag = true;
    if (VOID_TAGS.has(name)) {
      if (!closing) output += `<${name}${jsxAttributes(attributeText, rewriteUrl)} />`;
    } else if (closing) {
      output += `</${name}>`;
    } else {
      output += `<${name}${jsxAttributes(attributeText, rewriteUrl)}${selfClosing ? " />" : ">"}`;
    }
  }

  const rest = html.slice(position);
  output += escapeJsxText(rest);
  text += rest;

  if (hasTag) return { type: "jsx", value: output };
  if (text.trim()) return { type: "text", value: text };
  return null;
}
