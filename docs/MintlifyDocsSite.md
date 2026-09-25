# Mintlify docs site

_Last revised: September 25, 2026_

`docs-site/` converts the Minecraft: Bedrock Edition creator documentation from [MicrosoftDocs/minecraft-creator](https://github.com/MicrosoftDocs/minecraft-creator) (DocFX markdown published on Microsoft Learn) into a Mintlify project. It's a standalone npm package and doesn't affect the `app/` build. See [docs-site/README.md](../docs-site/README.md) for commands.

## Pipeline

`npm run build` runs `tools/build.mjs`:

1. **Inventory.** Lists every file under `.source/creator/`. Pages are `.md` files and `YamlMime:Landing` `.yml` files; `TOC.yml` and `breadcrumb/` files are skipped. The root `index.yml` hub is replaced by `authored/index.mdx`.
2. **Navigation.** `tools/convert/nav.mjs` loads `TOC.yml`, following nested `TOC.yml` references, and maps the entries named in `config/navigation.json` to Mintlify tabs, groups, and versions. Each page is placed once; the first placement wins. Its TOC label becomes its `sidebarTitle`. Pages not in the TOC are still published as hidden pages.
3. **DocFX preprocessing.** `tools/convert/docfx.mjs` rewrites line-based DocFX syntax before parsing: `::: moniker` blocks, `:::image`, `:::code source=` includes, `[!VIDEO]`, and `:::row`/`:::column`. Lines in fenced code blocks are left alone.
4. **Markdown to MDX.** `tools/convert/markdown.mjs` parses the page as CommonMark, transforms the syntax tree, and serializes it with `remark-mdx`. The serializer escapes characters that are literal in CommonMark but syntax in MDX, such as `{` and `Array<string>`. Transforms:
   - The first H1 becomes the page title.
   - `> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, and `[!CAUTION]` become `Note`, `Tip`, `Info`, `Warning`, and `Danger` callouts.
   - `[!div class="nextstepaction"]` becomes cards; `[!div class="checklist"]` is unwrapped.
   - `### [Title](#tab/id)` sections become `Tabs`.
   - Raw HTML becomes JSX (`tools/convert/html.mjs`). Tags outside an allowlist, such as `<players>` in command syntax, become text.
   - Links and images are rewritten (see Routes).
5. **Landing pages.** `tools/convert/landing.mjs` turns `landingContent` into a `CardGroup`.
6. **Media.** Only files that pages reference are written, to lowercase paths. See Media below.
7. **Configuration.** `config/docs.base.json` plus the generated navigation and redirects are written to `site/docs.json`. `authored/` is copied over the result.

## Routes

Routes are the lowercase source path without its extension, which matches the Learn URL path. For example, `Documents/GettingStarted.md` becomes `/documents/gettingstarted`. Keeping Learn's URL scheme means links convert one-to-one and needs no redirect table. Media paths are lowercased too, which fixes source references whose case differs from the file name.

`tools/convert/site.mjs` resolves relative links, absolute Learn links (`https://learn.microsoft.com/.../minecraft/creator/...` and `/minecraft/creator/...`), and backslash paths, case-insensitively. Links to pages that upstream moved are resolved through `creator/.openpublishing.redirection.json`, and those entries also become Mintlify redirects. Other site-relative Learn links point to `https://learn.microsoft.com`. Links that can't be resolved are left unchanged and listed in `build-report.json`.

## Script API versions

Only Script API pages use Learn monikers. Each Script API page is generated twice:

- **Stable** at `/scriptapi/...` keeps `minecraft-bedrock-stable` blocks and drops experimental ones. Pages whose front matter sets `monikerRange` to experimental aren't published here.
- **Beta** at `/beta/scriptapi/...` keeps `minecraft-bedrock-experimental` blocks.

Links from Beta pages to other Script API pages stay in Beta. `PriorScriptAPI` is the **1.x** version. The three versions are Mintlify `versions` inside the Script API tab.

Within each version, every `@minecraft/*` module is its own sidebar dropdown (`perChild` in `config/navigation.json`), because Mintlify renders every link in the active navigation, including collapsed groups. `@minecraft/server` is further split with `partitions`: Events (`…AfterEvent`, `…BeforeEvent`, and their signals) and Components. `@minecraft/server-editor` is split into UI (panes, properties, and controls) and Tools and widgets. This keeps Script API sidebars at about 340 links or fewer, instead of about 1,350.

Pages outside the navigation are hidden in Mintlify. `seo.indexing: "all"` in `config/docs.base.json` keeps them in search, sitemaps, and AI context.

## Media

`tools/convert/media.mjs` reads image headers before pages are converted (`planMedia`), so links can point at the final files, and writes the referenced files after conversion (`processMedia`):

| Source | Output | Why |
| --- | --- | --- |
| Animated GIF | H.264 MP4 at `name.gif.mp4` (max 1600 px wide) plus a WebP poster at `name.gif.webp` | GIFs were most of the page weight, and Mintlify rejects files of 20 MB or more. |
| PNG of 50 KB or more | Lossless WebP at `name.png.webp`, with identical pixels. For PNGs wider than 1920 px, both a full-size and a 1920 px version are encoded and the smaller is kept. | On this content, lossless WebP was never larger than the PNG above 50 KB, so the path can be chosen before encoding. Downscaling blends the flat colors of diagrams and UI screenshots into gradients, which lossless encoding handles poorly, so the resized version isn't always smaller. |
| Smaller PNG or any JPEG wider than 1920 px | Same path and format, resized to 1920 px | JPEG stays JPEG; re-encoding it losslessly would make it bigger. |
| Anything else | Copied unchanged | |

PNG re-encodes use only `compressionLevel`: in sharp, the PNG `effort`, `quality`, and `colours` options turn on palette quantization, which is lossy.

In `tools/convert/markdown.mjs`, an image that became a video is replaced with `<video controls muted loop playsInline preload="none">`, including its poster, dimensions, and alt text as `aria-label`. Videos don't autoplay and download only when played. When the image shares a paragraph with other lines, such as a list step followed by its animation, the paragraph is split around it. An animated GIF in the middle of a sentence fails the build.

Encoded files are cached in `.cache/media/` by source content, the exact encode parameters, and tool versions (sharp, libvips, ffmpeg), so rebuilds only re-encode what changed. Unused cache entries are removed after each build. The build fails if `ffmpeg` with `libx264` is missing, an encode fails, or any output is 20 MB or larger. It warns if a WebP ends up larger than its PNG.

`build-report.json` lists media totals by action and the heaviest pages. For each page, `loadBytes` is images and posters, which load with the page, and `onPlayBytes` is video, which loads only when played.

## Checks

- `npm test`: table-driven unit tests for each transform, URL rewriting, and navigation.
- `npm run check`: compiles every generated page with `@mdx-js/mdx`.
- `npm run validate` and `npm run broken-links`: Mintlify CLI checks.

## Known gaps

- Images are lossless. Referenced media is about 156 MB, mostly lossless WebP screenshots; `EditorTutorial` still loads about 15 MB. Lossy WebP would cut much more (about 83% in a sample) but can soften UI text. Mintlify's CDN also optimizes images on deploy, but it doesn't document how.
- About 60 links are broken upstream (moved or removed pages) and stay broken here.
- Navigation mirrors upstream TOC groups; duplicate TOC entries keep only their first placement.
