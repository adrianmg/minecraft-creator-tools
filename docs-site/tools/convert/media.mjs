// Optimizes media referenced by the generated site.
//
// v1 policy:
// - Animated GIFs become H.264 MP4 videos with a WebP poster (first frame). Mintlify rejects files of
//   20 MB or more, and GIFs are most of the page weight.
// - PNG files of minWebpBytes or more become lossless WebP (pixels are identical). Measured on this
//   content, lossless WebP was never larger than the PNG above 50 KB, so the decision needs no encoding.
// - PNG and JPEG files wider than maxImageWidth are resized. JPEG stays JPEG: re-encoding it
//   losslessly would make it bigger.
// - Everything else is copied unchanged.
// Encoded outputs are cached in .cache/media/ by source content, operation, and tool versions.

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import sharp from "sharp";

export const MEDIA_POLICY = {
  maxImageWidth: 1920,
  minWebpBytes: 50_000,
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
export const webpPath = (file) => `${file.toLowerCase()}.webp`;

/**
 * Decides what to do with one image from its metadata and file size.
 * @param {{ format?: string, width?: number, height?: number, pageHeight?: number, pages?: number }} metadata
 */
export function decideMedia(metadata, bytes = 0, policy = MEDIA_POLICY) {
  const { format, width = 0, pages = 1 } = metadata;
  const height = metadata.pageHeight ?? metadata.height ?? 0;
  const capped = () => {
    const outWidth = Math.min(width, policy.maxImageWidth);
    return { width: outWidth, height: width ? Math.round((height * outWidth) / width) : height };
  };

  if (format === "gif" && pages > 1 && width && height) {
    const outWidth = even(Math.min(width, policy.maxVideoWidth));
    return { kind: "video", width: outWidth, height: even((height * outWidth) / width) };
  }
  if (format === "png" && bytes >= policy.minWebpBytes) {
    return { kind: "webp", ...capped(), sourceWidth: width };
  }
  if ((format === "png" || format === "jpeg") && width > policy.maxImageWidth) {
    return { kind: "resize", ...capped() };
  }
  return { kind: "copy", width, height };
}

/** Reads image headers under contentRoot and decides an action per file. */
export async function planMedia(files, contentRoot, policy = MEDIA_POLICY) {
  const plan = new Map();
  for (const file of files.filter((candidate) => IMAGE_EXTENSION.test(candidate))) {
    const path = join(contentRoot, file);
    try {
      plan.set(file, decideMedia(await sharp(path).metadata(), statSync(path).size, policy));
    } catch {
      plan.set(file, { kind: "copy" });
    }
  }
  return plan;
}

/** Output path for a file referenced as an image or a link, according to the plan. */
export function outputPath(file, kind, plan) {
  const action = kind === "image" ? plan.get(file)?.kind : undefined;
  if (action === "video") return videoPath(file);
  if (action === "webp") return webpPath(file);
  return file.toLowerCase();
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

  // `recipe` describes the exact encode, so any change to its parameters produces a new cache entry.
  const cached = async (file, recipe, extension, encode) => {
    const source = readFileSync(join(contentRoot, file));
    const key = createHash("sha256").update(source).update(JSON.stringify({ recipe, versions })).digest("hex");
    const target = join(cacheRoot, `${key}${extension}`);
    usedCacheFiles.add(target);
    if (!existsSync(target)) {
      const temporary = `${target}.${process.pid}.tmp${extension}`;
      await encode(join(contentRoot, file), temporary, recipe);
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
      const videoRecipe = {
        operation: "video",
        width: action.width,
        height: action.height,
        crf: policy.videoCrf,
        preset: policy.videoPreset,
      };
      const video = await cached(file, videoRecipe, ".mp4", (input, output, recipe) =>
        run("ffmpeg", [
          ...["-v", "error", "-y", "-i", input, "-an", "-movflags", "+faststart", "-pix_fmt", "yuv420p"],
          ...["-vf", `scale=${recipe.width}:${recipe.height}:flags=lanczos`, "-c:v", "libx264"],
          ...["-crf", String(recipe.crf), "-preset", recipe.preset, "-f", "mp4", output],
        ])
      );
      const posterRecipe = { operation: "poster", width: action.width, quality: 80 };
      const poster = await cached(file, posterRecipe, ".webp", (input, output, recipe) =>
        sharp(input, { pages: 1 }).resize({ width: recipe.width }).webp({ quality: recipe.quality }).toFile(output)
      );
      add(video, videoPath(file), "video");
      add(poster, posterPath(file), "poster");
    }

    if (action.kind === "resize") {
      const format = file.toLowerCase().endsWith(".png") ? "png" : "jpeg";
      const resizeRecipe = {
        operation: "resize",
        width: action.width,
        format,
        options: format === "png" ? { compressionLevel: 9 } : { quality: 90, mozjpeg: true },
      };
      const resized = await cached(file, resizeRecipe, `.${format}`, (input, output, recipe) =>
        sharp(input)
          .resize({ width: recipe.width, withoutEnlargement: true })
          .toFormat(recipe.format, recipe.options)
          .toFile(output)
      );
      add(statSync(resized).size < result.sourceBytes ? resized : sourcePath, file.toLowerCase(), "image");
    }

    if (action.kind === "webp" && kinds.has("image")) {
      // Downscaling blends flat colors into gradients, which lossless encoding handles poorly, so a
      // resized diagram can be larger than the full-size one. Keep whichever is smaller.
      const encode = (input, output, recipe) =>
        (recipe.width ? sharp(input).resize({ width: recipe.width, withoutEnlargement: true }) : sharp(input))
          .webp({ lossless: true, effort: recipe.effort })
          .toFile(output);
      const webpRecipe = { operation: "webp", lossless: true, effort: 4, width: null };
      const candidates = [await cached(file, webpRecipe, ".webp", encode)];
      if (action.sourceWidth > action.width) {
        candidates.push(await cached(file, { ...webpRecipe, width: action.width }, ".webp", encode));
      }
      const [smallest] = candidates.sort((a, b) => statSync(a).size - statSync(b).size);
      add(smallest, webpPath(file), "image");
    }

    const linkedOriginal = (action.kind === "video" || action.kind === "webp") && kinds.has("link");
    if (action.kind === "copy" || linkedOriginal) {
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
