# Minecraft Creator Docs on Mintlify

Builds a [Mintlify](https://www.mintlify.com/) version of the Minecraft: Bedrock Edition creator documentation from [MicrosoftDocs/minecraft-creator](https://github.com/MicrosoftDocs/minecraft-creator). For how the conversion works, see [docs/MintlifyDocsSite.md](../docs/MintlifyDocsSite.md).

Requires Node.js 22 or later, git, and [ffmpeg](https://ffmpeg.org/) with `libx264` (for converting animated GIFs to video, for example `brew install ffmpeg`).

## Build and preview

```bash
npm ci
npm run sync    # Clone the upstream docs at the commit in source.json into .source/ (about 1 GB)
npm run build   # Generate the Mintlify project in site/
npm run dev     # Preview at http://localhost:3000
```

To preview on another port, run `cd site && npx mint dev --port 3333`. `npm run build` replaces `site/`, so restart the preview after rebuilding.

## Check

| Command | What it checks |
| --- | --- |
| `npm test` | Converter unit tests. |
| `npm run check` | Compiles every generated page with the MDX compiler. |
| `npm run validate` | Runs `mint validate` on the generated site. |
| `npm run broken-links` | Runs `mint broken-links`. Upstream link mistakes are fixed during the build; see `config/link-fixes.json`. |

## What's in git

| Path | Contents |
| --- | --- |
| `source.json` | Upstream repository and pinned commit. Update with `npm run sync -- --commit <sha>`. |
| `config/docs.base.json` | Mintlify theme, navbar, footer, and global anchors. |
| `config/navigation.json` | Tabs and groups, mapped to entries in the upstream `TOC.yml`. |
| `config/link-fixes.json` | Replacements for upstream links that no generic rule can resolve. |
| `authored/` | Pages written for this site, such as the home page and Get started. Copied over generated pages. |
| `tools/` | Sync, build, and check scripts. |
| `test/` | Converter tests. |

`.source/`, `.cache/`, `site/`, and `build-report.json` are generated and ignored by git. The first build encodes all media (about 2 minutes); later builds reuse `.cache/media/`.
