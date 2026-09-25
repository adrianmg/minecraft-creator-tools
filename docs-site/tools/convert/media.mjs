// Optimizes media referenced by the generated site.
//
// v1 policy:
// - Animated GIFs become H.264 MP4 videos with a WebP poster (first frame). Mintlify rejects files of
//   20 MB or more, and GIFs are most of the page weight.
// - PNG and JPEG files stay lossless and keep their paths; only files wider than maxImageWidth are
//   resized. Keeping paths means no link changes and no quality loss for UI text or pixel art.
// - Everything else is copied unchanged.
// Encoded outputs are cached in .cache/media/ by source content, operation, and tool versions.

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import sharp from "sharp";

export const MEDIA_POLICY = {
  maxImageWidth: 1920,
  maxVideoWidth: 1600,
  videoCrf: 26,
  videoPreset: "medium",
  maxFileBytes: 20_000_000,
  encodeConcurrency: 2,
};

const IMAGE_EXTENSION = /\.(png|jpe?g|gif)$/i;
const even = (value) => Math.max(2, Math.round(value / 2) * 2);

/** Deterministic output paths that can't collide with source files. */
export const videoPath = (file) => `${file.toLowerCase()}.mp4`;
export const posterPath = (file) => `${file.toLowerCase()}.webp`;

/**
 * Decides what to do with one image from its metadata.
 * @param {{ format?: string, width?: number, height?: number, pageHeight?: number, pages?: number }} metadata
 */
export function decideMedia(metadata, policy = MEDIA_POLICY) {
  const { format, width = 0, pages = 1 } = metadata;
  const height = metadata.pageHeight ?? metadata.height ?? 0;

  if (format === "gif" && pages > 1 && width && height) {
    const outWidth = even(Math.min(width, policy.maxVideoWidth));
    return { kind: "video", width: outWidth, height: even((height * outWidth) / width) };
  }
  if ((format === "png" || format === "jpeg") && width > policy.maxImageWidth) {
    return {
      kind: "resize",
      width: policy.maxImageWidth,
      height: Math.round((height * policy.maxImageWidth) / width),
    };
  }
  return { kind: "copy", width, height };
}

/** Reads image headers under contentRoot and decides an action per file. */
export async function planMedia(files, contentRoot, policy = MEDIA_POLICY) {
  const plan = new Map();
  for (const file of files.filter((candidate) => IMAGE_EXTENSION.test(candidate))) {
    try {
      plan.set(file, decideMedia(await sharp(join(contentRoot, file)).metadata(), policy));
    } catch {
      plan.set(file, { kind: "copy" });
    }
  }
  return plan;
}

function toolVersions() {
  const ffmpeg = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" });
  return {
    sharp: sharp.versions.sharp ?? "",
    vips: sharp.versions.vips,
    ffmpeg: ffmpeg.status === 0 ? ffmpeg.stdout.split("\n")[0] : "",
  };
}

function assertFfmpeg() {
  const encoders = spawnSync("ffmpeg", ["-hide_banner", "-encoders"], { encoding: "utf8" });
  if (encoders.status !== 0 || !/libx264/.test(encoders.stdout)) {
    throw new Error(
      "Converting animated GIFs requires ffmpeg with libx264 on PATH (for example `brew install ffmpeg`)."
    );
  }
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${command} failed: ${stderr.trim()}`))));
  });
}

async function mapWithConcurrency(items, limit, worker) {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await worker(items[next++]);
  });
  await Promise.all(runners);
}

/**
 * Writes every used file into siteRoot.
 * @param {Map<string, Set<"image" | "link">>} uses Source file to how pages reference it.
 * @returns {Promise<{ file: string, kind: string, sourceBytes: number, outputs: { path: string, bytes: number, role: string }[] }[]>}
 */
export async function processMedia({ uses, plan, contentRoot, siteRoot, cacheRoot, policy = MEDIA_POLICY }) {
  const versions = toolVersions();
  const usedCacheFiles = new Set();
  mkdirSync(cacheRoot, { recursive: true });

  const cached = async (file, operation, extension, encode) => {
    const source = readFileSync(join(contentRoot, file));
    const key = createHash("sha256")
      .update(source)
      .update(JSON.stringify({ operation, policy, versions }))
      .digest("hex");
    const target = join(cacheRoot, `${key}${extension}`);
    usedCacheFiles.add(target);
    if (!existsSync(target)) {
      const temporary = `${target}.${process.pid}.tmp${extension}`;
      await encode(join(contentRoot, file), temporary);
      renameSync(temporary, target);
    }
    return target;
  };

  const write = (from, path) => {
    const target = join(siteRoot, path);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(from, target);
    const bytes = statSync(target).size;
    if (bytes >= policy.maxFileBytes) throw new Error(`${path} is ${bytes} bytes; Mintlify requires under 20 MB.`);
    return bytes;
  };

  const entries = [...uses].map(([file, kinds]) => ({ file, kinds, action: plan.get(file) ?? { kind: "copy" } }));
  if (entries.some(({ kinds, action }) => action.kind === "video" && kinds.has("image"))) assertFfmpeg();

  const results = [];
  await mapWithConcurrency(entries, policy.encodeConcurrency, async ({ file, kinds, action }) => {
    const sourcePath = join(contentRoot, file);
    const result = { file, kind: action.kind, sourceBytes: statSync(sourcePath).size, outputs: [] };
    const add = (from, path, role) => result.outputs.push({ path, bytes: write(from, path), role });

    if (action.kind === "video" && kinds.has("image")) {
      const video = await cached(file, "video", ".mp4", (input, output) =>
        run("ffmpeg", [
          ...["-v", "error", "-y", "-i", input, "-an", "-movflags", "+faststart", "-pix_fmt", "yuv420p"],
          ...["-vf", `scale=${action.width}:${action.height}:flags=lanczos`, "-c:v", "libx264"],
          ...["-crf", String(policy.videoCrf), "-preset", policy.videoPreset, "-f", "mp4", output],
        ])
      );
      const poster = await cached(file, "poster", ".webp", (input, output) =>
        sharp(input, { pages: 1 }).resize({ width: action.width }).webp({ quality: 80 }).toFile(output)
      );
      add(video, videoPath(file), "video");
      add(poster, posterPath(file), "poster");
    }

    if (action.kind === "resize") {
      const format = file.toLowerCase().endsWith(".png") ? "png" : "jpeg";
      const resized = await cached(file, "resize", `.${format}`, (input, output) =>
        sharp(input)
          .resize({ width: action.width, withoutEnlargement: true })
          .toFormat(format, format === "png" ? { compressionLevel: 9, effort: 10 } : { quality: 90, mozjpeg: true })
          .toFile(output)
      );
      add(statSync(resized).size < result.sourceBytes ? resized : sourcePath, file.toLowerCase(), "image");
    }

    if (action.kind === "copy" || (action.kind === "video" && kinds.has("link"))) {
      add(sourcePath, file.toLowerCase(), "image");
    }

    results.push(result);
  });

  for (const entry of readdirSync(cacheRoot)) {
    const path = join(cacheRoot, entry);
    if (!usedCacheFiles.has(path)) rmSync(path, { force: true });
  }

  return results;
}
