// Compiles every page in site/ with the MDX compiler and reports pages that would fail to render.
// Usage: node tools/check.mjs

import { compile } from "@mdx-js/mdx";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import remarkGfm from "remark-gfm";

const siteRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "site");

function listMdx(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return listMdx(path);
    return entry.name.endsWith(".mdx") ? [path] : [];
  });
}

const pages = listMdx(siteRoot);
const failures = [];

for (const page of pages) {
  const body = readFileSync(page, "utf8").replace(/^---\n[\s\S]*?\n---\n/, "");
  try {
    await compile(body, { remarkPlugins: [remarkGfm] });
  } catch (error) {
    failures.push(`${relative(siteRoot, page)}:${error.line ?? "?"} ${error.reason ?? error.message}`);
  }
}

console.log(`Compiled ${pages.length} pages; ${failures.length} failed.`);
for (const failure of failures.slice(0, 50)) console.log(`  ${failure}`);
if (failures.length > 50) console.log(`  ...and ${failures.length - 50} more`);
if (failures.length) process.exitCode = 1;
