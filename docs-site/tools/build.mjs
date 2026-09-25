// Builds the Mintlify project in site/ from the upstream checkout in .source/ and the files in authored/ and config/.
// Usage: node tools/build.mjs

import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { dump, load } from "js-yaml";
import { preprocessDocfx } from "./convert/docfx.mjs";
import { landingToMdx } from "./convert/landing.mjs";
import { markdownToMdx } from "./convert/markdown.mjs";
import { buildNavigation, findTocNode, loadToc } from "./convert/nav.mjs";
import { createSite, isScriptApi } from "./convert/site.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = JSON.parse(readFileSync(join(root, "source.json"), "utf8"));
const contentRoot = join(root, ".source", source.contentFolder);
const siteRoot = join(root, "site");
const readJson = (path) => JSON.parse(readFileSync(join(root, path), "utf8"));

if (!existsSync(contentRoot)) {
  console.error("Upstream content not found. Run `npm run sync` first.");
  process.exit(1);
}

function listFiles(directory, prefix = "") {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.name.startsWith(".")) return [];
    return entry.isDirectory() ? listFiles(join(directory, entry.name), relative) : [relative];
  });
}

const read = (relative) => readFileSync(join(contentRoot, relative), "utf8").replace(/\r\n/g, "\n");

function splitFrontMatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/);
  if (!match) return { data: {}, body: text };
  let data = {};
  try {
    data = load(match[1]) ?? {};
  } catch {
    // Malformed front matter is treated as absent.
  }
  return { data, body: text.slice(match[0].length) };
}

// Inventory
const files = listFiles(contentRoot);
const readRedirections = () => {
  const path = join(contentRoot, ".openpublishing.redirection.json");
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")).redirections : [];
};
const isExcluded = (file) => /(^|\/)breadcrumb\//i.test(file) || /(^|\/)toc\.yml$/i.test(file);
const isLanding = (file) => /\.yml$/i.test(file) && read(file).startsWith("### YamlMime:Landing");
const pages = files.filter((file) => !isExcluded(file) && (/\.md$/i.test(file) || isLanding(file)));

const frontMatter = new Map(
  pages.filter((page) => page.endsWith(".md")).map((page) => [page, splitFrontMatter(read(page))])
);
const experimentalOnly = new Set(
  [...frontMatter]
    .filter(([page, { data }]) => isScriptApi(page) && /experimental/.test(data.monikerRange ?? ""))
    .map(([page]) => page)
);

const site = createSite({ files, pages, experimentalOnly, redirections: readRedirections() });
const pageSet = new Set(pages);

// Navigation
const navigationConfig = readJson("config/navigation.json");
const toc = findTocNode(loadToc(read, "TOC.yml"), navigationConfig.tocRoot).items;
const routeForHref = (href, variant) => {
  const page = site.findFile(href);
  if (!page || !pageSet.has(page)) return null;
  if (variant === "stable" && experimentalOnly.has(page)) return null;
  return site.routeFor(page, variant);
};
const { navigation, placed } = buildNavigation(toc, navigationConfig, routeForHref);

// Pages
rmSync(siteRoot, { recursive: true, force: true });
mkdirSync(siteRoot, { recursive: true });

const outputs = pages.flatMap((page) => {
  if (!isScriptApi(page)) return [{ page, variant: "stable" }];
  const variants = experimentalOnly.has(page) ? ["beta"] : ["stable", "beta"];
  return variants.map((variant) => ({ page, variant }));
});

const failures = [];
let written = 0;

for (const { page, variant } of outputs) {
  const route = site.routeFor(page, variant);
  if (route === "index") continue; // Replaced by authored/index.mdx.

  const rewriteUrl = (url) => site.rewriteUrl(url, { from: page, variant });
  try {
    let converted;
    if (page.endsWith(".yml")) {
      converted = landingToMdx(read(page), rewriteUrl);
    } else {
      const { data, body } = frontMatter.get(page);
      const readInclude = (includeSource) => {
        const file = site.readableIncludePath(page, includeSource);
        return file ? read(file) : undefined;
      };
      const markdown = preprocessDocfx(body, { variant, readInclude });
      const { mdx, title } = markdownToMdx(markdown, { rewriteUrl });
      converted = { mdx, title: title ?? data.title, description: data.description };
    }

    const title = String(converted.title ?? posix.basename(route));
    const sidebarTitle = placed.get(route);
    const pageFrontMatter = { title };
    if (sidebarTitle && sidebarTitle !== title) pageFrontMatter.sidebarTitle = sidebarTitle;
    if (converted.description) pageFrontMatter.description = String(converted.description);

    const target = join(siteRoot, `${route}.mdx`);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, `---\n${dump(pageFrontMatter, { lineWidth: -1 })}---\n\n${converted.mdx}`);
    written++;
  } catch (error) {
    failures.push({ page, variant, message: error.message });
  }
}

// Authored pages, media, and configuration
cpSync(join(root, "authored"), siteRoot, { recursive: true });

let mediaBytes = 0;
for (const file of site.media) {
  const target = join(siteRoot, file.toLowerCase());
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(join(contentRoot, file), target);
  mediaBytes += readFileSync(target).length;
}

const base = readJson("config/docs.base.json");
writeFileSync(
  join(siteRoot, "docs.json"),
  JSON.stringify({ ...base, navigation: { ...base.navigation, ...navigation }, redirects: site.redirects() }, null, 2) +
    "\n"
);

// Report
const report = {
  source: source.commit,
  pagesWritten: written,
  pagesInNavigation: placed.size,
  mediaFiles: site.media.size,
  mediaMegabytes: Math.round(mediaBytes / 1048576),
  unresolvedLinks: site.unresolved.length,
  failures,
  unresolved: site.unresolved,
};
writeFileSync(join(root, "build-report.json"), JSON.stringify(report, null, 2) + "\n");

console.log(
  `Wrote ${written} pages (${placed.size} in navigation), ${site.media.size} media files (${report.mediaMegabytes} MB).`
);
console.log(
  `Unresolved links: ${site.unresolved.length}. Conversion failures: ${failures.length}. Details: build-report.json`
);
if (failures.length) process.exitCode = 1;
