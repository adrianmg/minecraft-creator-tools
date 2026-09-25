// Converts DocFX `YamlMime:Landing` pages into MDX card grids.

import { load } from "js-yaml";
import { jsx, serialize } from "./markdown.mjs";

const ICONS = {
  architecture: "sitemap",
  concept: "lightbulb",
  deploy: "rocket",
  download: "download",
  "get-started": "rocket",
  "how-to-guide": "list-check",
  learn: "graduation-cap",
  overview: "eye",
  quickstart: "bolt",
  reference: "book",
  sample: "code",
  tutorial: "graduation-cap",
  video: "video",
  "whats-new": "sparkles",
};

const text = (value) => ({ type: "text", value: String(value ?? "") });

/**
 * @param {string} yamlText
 * @param {(url: string) => string} rewriteUrl
 * @returns {{ mdx: string, title?: string, description?: string }}
 */
export function landingToMdx(yamlText, rewriteUrl) {
  const landing = load(yamlText) ?? {};
  const cards = (landing.landingContent ?? []).map((section) => {
    const linkLists = section.linkLists ?? [];
    const links = linkLists.flatMap((list) => list.links ?? []);
    const list = {
      type: "list",
      ordered: false,
      spread: false,
      children: links.map((link) => {
        const url = rewriteUrl(String(link.url ?? ""));
        const label = text(link.text);
        return {
          type: "listItem",
          spread: false,
          children: [
            { type: "paragraph", children: [url === null ? label : { type: "link", url, children: [label] }] },
          ],
        };
      }),
    };
    const icon = ICONS[linkLists[0]?.linkListType] ?? "book-open";
    return jsx("Card", { title: String(section.title ?? ""), icon }, links.length ? [list] : []);
  });

  const children = [];
  if (landing.summary) children.push({ type: "paragraph", children: [text(landing.summary)] });
  if (cards.length) children.push(jsx("CardGroup", { cols: 2 }, cards));

  return {
    mdx: serialize({ type: "root", children }),
    title: landing.title ?? landing.metadata?.title,
    description: landing.metadata?.description ?? landing.summary,
  };
}
