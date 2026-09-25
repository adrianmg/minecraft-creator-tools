// Converts DocFX-flavored CommonMark into Mintlify MDX through an mdast round-trip.
// Parsing as plain CommonMark and serializing with remark-mdx makes the serializer escape
// `{`, `<`, and other characters that are literal in CommonMark but syntax in MDX.

import remarkGfm from "remark-gfm";
import remarkMdx from "remark-mdx";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import { unified } from "unified";
import { SKIP, visit } from "unist-util-visit";
import { htmlToJsx } from "./html.mjs";

const parser = unified().use(remarkParse).use(remarkGfm);
const serializer = unified()
  .use(remarkStringify, { bullet: "-", fences: true, resourceLink: true, rule: "-" })
  .use(remarkGfm)
  .use(remarkMdx);

const ALERTS = { NOTE: "Note", TIP: "Tip", IMPORTANT: "Info", WARNING: "Warning", CAUTION: "Danger" };
const ALERT_MARKER = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*\n?/i;
const DIV_MARKER = /^\[!div\s+class="([^"]+)"\][ \t]*\n?/i;

export function jsx(name, attributes = {}, children = []) {
  return {
    type: "mdxJsxFlowElement",
    name,
    attributes: Object.entries(attributes)
      .filter(([, value]) => value !== undefined && value !== false)
      .map(([key, value]) => ({
        type: "mdxJsxAttribute",
        name: key,
        value:
          value === true
            ? null
            : typeof value === "number"
              ? { type: "mdxJsxAttributeValueExpression", value: String(value) }
              : value,
      })),
    children,
  };
}

export function serialize(tree) {
  return serializer.stringify(tree);
}

function plainText(node) {
  if (node.type === "text" || node.type === "inlineCode") return node.value;
  return (node.children ?? []).map(plainText).join("");
}

function extractTitle(tree) {
  const index = tree.children.findIndex((node) => node.type === "heading" && node.depth === 1);
  if (index === -1) return undefined;
  const title = plainText(tree.children[index]).trim();
  tree.children.splice(index, 1);
  return title;
}

/** Removes a leading `[!...]` marker from a blockquote and returns the marker match. */
function takeMarker(blockquote, pattern) {
  const paragraph = blockquote.children[0];
  const first = paragraph?.type === "paragraph" ? paragraph.children[0] : undefined;
  if (first?.type !== "text") return null;
  const match = first.value.match(pattern);
  if (!match) return null;
  first.value = first.value.slice(match[0].length);
  if (!first.value) paragraph.children.shift();
  if (!paragraph.children.length) blockquote.children.shift();
  return match;
}

function collectLinks(node, links = []) {
  if (node.type === "link") links.push(node);
  else for (const child of node.children ?? []) collectLinks(child, links);
  return links;
}

function transformBlockquotes(tree) {
  visit(tree, "blockquote", (node, index, parent) => {
    const alert = takeMarker(node, ALERT_MARKER);
    if (alert) {
      parent.children[index] = jsx(ALERTS[alert[1].toUpperCase()], {}, node.children);
      return;
    }
    const div = takeMarker(node, DIV_MARKER);
    if (!div) return;
    if (div[1] === "nextstepaction") {
      const cards = collectLinks(node).map((link) =>
        jsx("Card", { title: plainText(link).trim(), href: link.url, icon: "arrow-right" })
      );
      parent.children.splice(index, 1, ...cards);
      return [SKIP, index + cards.length];
    }
    parent.children.splice(index, 1, ...node.children);
    return [SKIP, index];
  });
}

function tabHeading(node) {
  if (node?.type !== "heading" || node.children.length !== 1) return undefined;
  const link = node.children[0];
  return link.type === "link" && link.url.startsWith("#tab/") ? plainText(link).trim() : undefined;
}

/** Converts DocFX `### [Title](#tab/id)` sections, terminated by `---`, into Mintlify tabs. */
function transformTabs(tree) {
  visit(tree, (parent) => {
    if (!parent.children) return;
    for (let start = 0; start < parent.children.length; start++) {
      if (tabHeading(parent.children[start]) === undefined) continue;
      const depth = parent.children[start].depth;
      const tabs = [];
      let end = start;
      while (end < parent.children.length) {
        const node = parent.children[end];
        if (node.type === "thematicBreak") {
          end++;
          break;
        }
        const title = tabHeading(node);
        if (title !== undefined) {
          tabs.push(jsx("Tab", { title }, []));
        } else if (node.type === "heading" && node.depth <= depth) {
          break;
        } else {
          tabs.at(-1).children.push(node);
        }
        end++;
      }
      parent.children.splice(start, end - start, jsx("Tabs", {}, tabs));
    }
  });
}

const PHRASING_PARENTS = new Set([
  "paragraph",
  "heading",
  "tableCell",
  "emphasis",
  "strong",
  "delete",
  "link",
  "linkReference",
]);

function transformHtml(tree, rewriteUrl) {
  visit(tree, "html", (node, index, parent) => {
    const result = htmlToJsx(node.value, rewriteUrl);
    if (!result) {
      parent.children.splice(index, 1);
      return [SKIP, index];
    }
    if (result.type === "jsx") {
      node.value = result.value;
      return;
    }
    const text = { type: "text", value: result.value };
    parent.children[index] = PHRASING_PARENTS.has(parent.type) ? text : { type: "paragraph", children: [text] };
  });
}

function transformUrls(tree, rewriteUrl) {
  visit(tree, (node) => {
    if (node.type === "link" || node.type === "definition") node.url = rewriteUrl(node.url, "link");
    else if (node.type === "image") node.url = rewriteUrl(node.url, "image");
  });
}

/** Replaces images that were converted to video with a user-controlled `<video>` element. */
function transformVideos(tree, videoFor) {
  const videoElement = (image, video) =>
    jsx(
      "video",
      {
        controls: true,
        muted: true,
        loop: true,
        playsInline: true,
        preload: "none",
        poster: video.poster,
        width: video.width,
        height: video.height,
        className: "w-full h-auto rounded-xl",
        "aria-label": image.alt || undefined,
        src: image.url,
      },
      [{ type: "paragraph", children: [{ type: "text", value: "Your browser doesn't support video playback." }] }]
    );

  const startsLine = (node) => !node || node.type === "break" || (node.type === "text" && /\n\s*$/.test(node.value));
  const endsLine = (node) => !node || node.type === "break" || (node.type === "text" && /^\s*\n/.test(node.value));

  // An image on its own line becomes a flow element; text on other lines of the same paragraph
  // (for example a list step followed by its animation) stays in separate paragraphs.
  visit(tree, "paragraph", (node, index, parent) => {
    const replacement = [];
    let current = [];
    const flush = () => {
      const trimmed = current.filter((child) => !(child.type === "text" && !child.value.trim()));
      if (trimmed.length) replacement.push({ type: "paragraph", children: current });
      current = [];
    };

    node.children.forEach((child, position) => {
      const video = child.type === "image" ? videoFor(child.url) : undefined;
      if (video && startsLine(node.children[position - 1]) && endsLine(node.children[position + 1])) {
        const previous = current.at(-1);
        if (previous?.type === "text") previous.value = previous.value.replace(/\s+$/, "");
        flush();
        replacement.push(videoElement(child, video));
        const next = node.children[position + 1];
        if (next?.type === "text") next.value = next.value.replace(/^\s+/, "");
      } else {
        current.push(child);
      }
    });
    flush();

    if (replacement.length === 1 && replacement[0].type === "paragraph") return;
    parent.children.splice(index, 1, ...replacement);
    return [SKIP, index + replacement.length];
  });

  visit(tree, "image", (node) => {
    if (videoFor(node.url)) throw new Error(`An animated GIF must be on its own line to become a video: ${node.url}`);
  });
}

/**
 * @param {string} markdown DocFX markdown after preprocessDocfx, without front matter.
 * @param {{
 *   rewriteUrl?: (url: string, kind: "link" | "image") => string,
 *   videoFor?: (url: string) => { poster: string, width: number, height: number } | undefined,
 * }} [options] videoFor identifies rewritten image URLs that point at videos.
 * @returns {{ mdx: string, title?: string }}
 */
export function markdownToMdx(markdown, { rewriteUrl = (url) => url, videoFor = () => undefined } = {}) {
  const tree = parser.parse(markdown);
  const title = extractTitle(tree);
  transformTabs(tree);
  transformUrls(tree, rewriteUrl);
  transformVideos(tree, videoFor);
  transformBlockquotes(tree);
  transformHtml(tree, rewriteUrl);
  return { mdx: serializer.stringify(tree), title };
}
