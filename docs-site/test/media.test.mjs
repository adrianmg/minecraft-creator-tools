import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import sharp from "sharp";
import { preprocessDocfx } from "../tools/convert/docfx.mjs";
import { markdownToMdx } from "../tools/convert/markdown.mjs";
import { decideMedia, MEDIA_POLICY, posterPath, processMedia, videoPath } from "../tools/convert/media.mjs";
import { createSite } from "../tools/convert/site.mjs";

describe("decideMedia", () => {
  const cases = [
    {
      name: "animated GIF becomes a video with even dimensions capped at the max width",
      metadata: { format: "gif", width: 2001, height: 1000, pageHeight: 501, pages: 12 },
      expected: { kind: "video", width: 1600, height: 400 },
    },
    {
      name: "small animated GIF keeps its size",
      metadata: { format: "gif", width: 541, height: 305, pages: 3 },
      expected: { kind: "video", width: 542, height: 306 },
    },
    {
      name: "static GIF is copied",
      metadata: { format: "gif", width: 400, height: 300, pages: 1 },
      expected: { kind: "copy", width: 400, height: 300 },
    },
    {
      name: "wide PNG under the WebP threshold is resized",
      metadata: { format: "png", width: 3840, height: 2160 },
      expected: { kind: "resize", width: 1920, height: 1080 },
    },
    {
      name: "PNG under the WebP threshold at the max width is copied",
      metadata: { format: "png", width: 1920, height: 1080 },
      expected: { kind: "copy", width: 1920, height: 1080 },
    },
    {
      name: "PNG at the WebP threshold becomes lossless WebP",
      metadata: { format: "png", width: 800, height: 600 },
      bytes: 50_000,
      expected: { kind: "webp", width: 800, height: 600, sourceWidth: 800 },
    },
    {
      name: "wide PNG over the threshold becomes resized lossless WebP",
      metadata: { format: "png", width: 2560, height: 1440 },
      bytes: 3_000_000,
      expected: { kind: "webp", width: 1920, height: 1080, sourceWidth: 2560 },
    },
    {
      name: "large JPEG stays JPEG",
      metadata: { format: "jpeg", width: 1200, height: 800 },
      bytes: 3_000_000,
      expected: { kind: "copy", width: 1200, height: 800 },
    },
    {
      name: "wide JPEG is resized",
      metadata: { format: "jpeg", width: 2400, height: 1200 },
      expected: { kind: "resize", width: 1920, height: 960 },
    },
  ];

  for (const { name, metadata, bytes, expected } of cases) {
    it(name, () => assert.deepEqual(decideMedia(metadata, bytes), expected));
  }
});

describe("markdownToMdx video conversion", () => {
  const url = "/media/walk.gif.mp4";
  const videoFor = (candidate) =>
    candidate === url ? { poster: "/media/walk.gif.webp", width: 800, height: 400 } : undefined;
  const convert = (markdown) =>
    markdownToMdx(markdown, { rewriteUrl: (value) => (value === "walk.gif" ? url : value), videoFor }).mdx.trim();
  const video =
    '<video controls muted loop playsInline preload="none" poster="/media/walk.gif.webp" width={800} height={400} ' +
    'className="w-full h-auto rounded-xl" aria-label="Walking" src="/media/walk.gif.mp4">';

  it("replaces an image on its own line", () => {
    assert.equal(convert("![Walking](walk.gif)"), `${video}\n  Your browser doesn't support video playback.\n</video>`);
  });

  it("splits a list step whose animation follows on the next line", () => {
    const mdx = convert("1. Do the thing.\n   ![Walking](walk.gif)");
    assert.match(mdx, /^1\. Do the thing\.\n {3}<video /);
  });

  it("fails when the animation is inside a sentence", () => {
    assert.throws(() => convert("See ![Walking](walk.gif) here."), /must be on its own line/);
  });

  it("omits aria-label when the alt text is empty", () => {
    assert.doesNotMatch(convert("![](walk.gif)"), /aria-label/);
  });
});

describe("media paths", () => {
  it("rewrites only image uses of a video-planned file", () => {
    const site = createSite({
      files: ["Media/Walk.gif"],
      pages: [],
      mediaPath: (file, kind) => (kind === "image" ? videoPath(file) : file.toLowerCase()),
    });
    assert.equal(site.rewriteUrl("Media/Walk.gif", { from: "Page.md", kind: "image" }), "/media/walk.gif.mp4");
    assert.equal(site.rewriteUrl("Media/Walk.gif", { from: "Page.md", kind: "link" }), "/media/walk.gif");
    assert.deepEqual([...site.media.get("Media/Walk.gif")], ["image", "link"]);
    assert.equal(posterPath("Media/Walk.gif"), "media/walk.gif.webp");
  });

  it("lazy-loads video iframes", () => {
    assert.match(preprocessDocfx("[!VIDEO https://www.youtube.com/embed/abc]"), /loading="lazy"/);
  });
});

describe("processMedia", () => {
  const root = mkdtempSync(join(tmpdir(), "docs-site-media-"));
  after(() => rmSync(root, { recursive: true, force: true }));

  it("resizes wide images, copies the rest, and reuses the cache", async () => {
    const contentRoot = join(root, "content");
    const siteRoot = join(root, "site");
    const cacheRoot = join(root, "cache");
    const policy = { ...MEDIA_POLICY, maxImageWidth: 8 };
    const noise = Buffer.from(Array.from({ length: 64 * 32 * 3 }, (_, index) => (index * 97) % 256));
    mkdirSync(contentRoot, { recursive: true });
    await sharp(noise, { raw: { width: 64, height: 32, channels: 3 } })
      .png()
      .toFile(join(contentRoot, "Wide.PNG"));
    writeFileSync(join(contentRoot, "data.json"), "{}");

    const run = () =>
      processMedia({
        uses: new Map([
          ["Wide.PNG", new Set(["image"])],
          ["data.json", new Set(["link"])],
        ]),
        plan: new Map([["Wide.PNG", { kind: "resize", width: 8, height: 4 }]]),
        contentRoot,
        siteRoot,
        cacheRoot,
        policy,
      });

    const results = await run();
    assert.equal((await sharp(join(siteRoot, "wide.png")).metadata()).width, 8);
    assert.equal((await sharp(join(siteRoot, "wide.png")).metadata()).paletteBitDepth, undefined, "must stay lossless");
    assert.equal(statSync(join(siteRoot, "data.json")).size, 2);
    assert.deepEqual(results.map(({ kind }) => kind).sort(), ["copy", "resize"]);

    const cacheFiles = readdirSync(cacheRoot);
    await run();
    assert.deepEqual(readdirSync(cacheRoot), cacheFiles);

    await processMedia({
      uses: new Map([["Wide.PNG", new Set(["image"])]]),
      plan: new Map([["Wide.PNG", { kind: "resize", width: 4, height: 2 }]]),
      contentRoot,
      siteRoot,
      cacheRoot,
      policy,
    });
    assert.equal((await sharp(join(siteRoot, "wide.png")).metadata()).width, 4, "a changed recipe must re-encode");
  });

  it("writes lossless WebP with identical pixels and keeps linked originals", async () => {
    const contentRoot = join(root, "content-webp");
    const siteRoot = join(root, "site-webp");
    const noise = Buffer.from(Array.from({ length: 32 * 16 * 3 }, (_, index) => (index * 31) % 256));
    mkdirSync(contentRoot, { recursive: true });
    await sharp(noise, { raw: { width: 32, height: 16, channels: 3 } })
      .png()
      .toFile(join(contentRoot, "Shot.png"));

    await processMedia({
      uses: new Map([["Shot.png", new Set(["image", "link"])]]),
      plan: new Map([["Shot.png", { kind: "webp", width: 32, height: 16 }]]),
      contentRoot,
      siteRoot,
      cacheRoot: join(root, "cache-webp"),
    });

    const pixels = async (path) => (await sharp(path).removeAlpha().raw().toBuffer()).toString("base64");
    assert.equal(await pixels(join(siteRoot, "shot.png.webp")), await pixels(join(contentRoot, "Shot.png")));
    assert.ok(statSync(join(siteRoot, "shot.png")).size > 0);
  });
});
