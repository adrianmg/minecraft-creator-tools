// Fetches MicrosoftDocs/minecraft-creator at the commit pinned in source.json into .source/.
// Usage: node tools/sync.mjs [--commit <sha>]

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sourceJsonPath = join(root, "source.json");
const source = JSON.parse(readFileSync(sourceJsonPath, "utf8"));
const target = join(root, ".source");

const commitArg = process.argv.indexOf("--commit");
const commit = commitArg > -1 ? process.argv[commitArg + 1] : source.commit;

const git = (...args) => execFileSync("git", args, { cwd: target, stdio: "inherit" });

if (!existsSync(join(target, ".git"))) {
  execFileSync("git", ["clone", "--filter=blob:none", "--no-checkout", source.repository, target], {
    stdio: "inherit",
  });
  git("sparse-checkout", "set", source.contentFolder);
} else {
  git("fetch", "--filter=blob:none", "origin");
}

git("checkout", "--detach", commit);

if (commit !== source.commit) {
  const resolved = execFileSync("git", ["rev-parse", "HEAD"], { cwd: target }).toString().trim();
  writeFileSync(sourceJsonPath, JSON.stringify({ ...source, commit: resolved }, null, 2) + "\n");
  console.log(`Updated source.json to ${resolved}`);
}
