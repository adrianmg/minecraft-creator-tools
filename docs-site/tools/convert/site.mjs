// Maps source files under creator/ to Mintlify routes and rewrites links between them.
// Routes mirror the lowercase Learn URL paths, so existing links map one-to-one without redirects.
// Script API pages are also published as a Beta variant under `beta/`.

import { posix } from "node:path";

const LEARN_URL = /^(?:https?:\/\/learn\.microsoft\.com)?\/(?:[a-z]{2}-[a-z]{2}\/)?minecraft\/creator\/?([^?#]*)(\?[^#]*)?(#.*)?$/i;
const PAGE_EXTENSION = /\.(md|yml)$/i;

export const BETA_PREFIX = "beta/";

export function routeKey(relativePath) {
  return relativePath.toLowerCase().replace(PAGE_EXTENSION, "");
}

export function isScriptApi(relativePath) {
  return relativePath.toLowerCase().startsWith("scriptapi/");
}

function splitUrl(url) {
  const match = url.match(/^([^?#]*)(\?[^#]*)?(#.*)?$/);
  return { path: match[1], query: match[2] ?? "", hash: match[3] ?? "" };
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * @param {{ files: string[], pages: string[], experimentalOnly?: Set<string>, redirections?: { source_path: string, redirect_url: string }[] }} options
 *   files: every file under creator/ (posix, relative); pages: files published as pages;
 *   experimentalOnly: Script API pages that exist only in the experimental moniker;
 *   redirections: entries from creator/.openpublishing.redirection.json.
 */
export function createSite({ files, pages, experimentalOnly = new Set(), redirections = [] }) {
  const fileByLowerPath = new Map(files.map((file) => [file.toLowerCase(), file]));
  const pageByKey = new Map(pages.map((page) => [routeKey(page), page]));
  const redirectByKey = new Map(redirections.map((entry) => [routeKey(entry.source_path), entry.redirect_url]));
  const media = new Set();
  const unresolved = [];

  function routeFor(page, variant = "stable") {
    const key = routeKey(page);
    if (isScriptApi(page) && (variant === "beta" || experimentalOnly.has(page))) return BETA_PREFIX + key;
    return key;
  }

  function findPage(path, followRedirect = true) {
    const key = routeKey(path.replace(/\/$/, ""));
    const page = pageByKey.get(key) ?? pageByKey.get(key ? `${key}/index` : "index");
    if (page || !followRedirect || !redirectByKey.has(key)) return page;
    const learn = redirectByKey.get(key).match(LEARN_URL);
    return learn ? findPage(safeDecode(learn[1]), false) : undefined;
  }

  function findFile(path) {
    return fileByLowerPath.get(path.toLowerCase());
  }

  /**
   * @param {string} url
   * @param {{ from: string, variant?: string, kind?: "link" | "image" }} context
   */
  function rewriteUrl(url, { from, variant = "stable" }) {
    if (!url || url.startsWith("#")) return url;

    let target;
    let query;
    let hash;
    const learn = url.match(LEARN_URL);
    if (learn) {
      target = safeDecode(learn[1]).replace(/\/$/, "");
      query = learn[2] ?? "";
      hash = learn[3] ?? "";
      if (!target) return `/${hash}`;
    } else if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(url)) {
      return url;
    } else if (url.startsWith("/")) {
      // Site-relative links on Learn point to other Learn docsets.
      return `https://learn.microsoft.com${url}`;
    } else {
      const parts = splitUrl(url);
      target = posix.normalize(posix.join(posix.dirname(from), safeDecode(parts.path).replace(/\\/g, "/")));
      query = parts.query;
      hash = parts.hash;
      if (target.startsWith("..")) return url;
    }

    const page = findPage(target);
    if (page) {
      const targetVariant = /view=minecraft-bedrock-experimental/i.test(query) ? "beta" : variant;
      const route = routeFor(page, targetVariant);
      return route === "index" ? `/${hash}` : `/${route}${hash}`;
    }

    const file = findFile(target);
    if (file) {
      media.add(file);
      return "/" + encodeURI(file.toLowerCase());
    }

    unresolved.push({ from, url });
    return url;
  }

  function readableIncludePath(from, source) {
    return findFile(posix.normalize(posix.join(posix.dirname(from), safeDecode(source).replace(/\\/g, "/"))));
  }

  /** Mintlify redirects for upstream redirections whose targets are published pages. */
  function redirects() {
    return [...redirectByKey.keys()]
      .filter((key) => !pageByKey.has(key))
      .map((key) => ({ source: `/${key}`, page: findPage(key) }))
      .filter(({ page }) => page)
      .map(({ source, page }) => ({ source, destination: `/${routeFor(page)}` }));
  }

  return { routeFor, rewriteUrl, readableIncludePath, findFile, redirects, media, unresolved };
}
