# Mintlify docs site

_Last revised: September 24, 2026_

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
6. **Media.** Only files that pages reference are copied, to lowercase paths.
7. **Configuration.** `config/docs.base.json` plus the generated navigation and redirects are written to `site/docs.json`. `authored/` is copied over the result.

## Routes

Routes are the lowercase source path without its extension, which matches the Learn URL path. For example, `Documents/GettingStarted.md` becomes `/documents/gettingstarted`. Keeping Learn's URL scheme means links convert one-to-one and needs no redirect table. Media paths are lowercased too, which fixes source references whose case differs from the file name.

`tools/convert/site.mjs` resolves relative links, absolute Learn links (`https://learn.microsoft.com/.../minecraft/creator/...` and `/minecraft/creator/...`), and backslash paths, case-insensitively. Links to pages that upstream moved are resolved through `creator/.openpublishing.redirection.json`, and those entries also become Mintlify redirects. Other site-relative Learn links point to `https://learn.microsoft.com`. Links that can't be resolved are left unchanged and listed in `build-report.json`.

## Script API versions

Only Script API pages use Learn monikers. Each Script API page is generated twice:

- **Stable** at `/scriptapi/...` keeps `minecraft-bedrock-stable` blocks and drops experimental ones. Pages whose front matter sets `monikerRange` to experimental aren't published here.
- **Beta** at `/beta/scriptapi/...` keeps `minecraft-bedrock-experimental` blocks.

Links from Beta pages to other Script API pages stay in Beta. `PriorScriptAPI` is the **1.x** version. The three versions are Mintlify `versions` inside the Script API tab.

Within each version, every `@minecraft/*` module is its own sidebar dropdown (`perChild` in `config/navigation.json`), because Mintlify renders every link in the active navigation, including collapsed groups. `@minecraft/server` is further split with `partitions`: Events (`…AfterEvent`, `…BeforeEvent`, and their signals) and Components. This keeps Script API sidebars between about 5 and 450 links instead of about 1,350.

Pages outside the navigation are hidden in Mintlify. `seo.indexing: "all"` in `config/docs.base.json` keeps them in search, sitemaps, and AI context.

## Checks

- `npm test`: table-driven unit tests for each transform, URL rewriting, and navigation.
- `npm run check`: compiles every generated page with `@mdx-js/mdx`.
- `npm run validate` and `npm run broken-links`: Mintlify CLI checks.

## Known gaps

- Media isn't optimized yet. Referenced media is about 565 MB, and 43 animated GIFs account for about 320 MB.
- About 60 links are broken upstream (moved or removed pages) and stay broken here.
- Navigation mirrors upstream TOC groups; duplicate TOC entries keep only their first placement.
