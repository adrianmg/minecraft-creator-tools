# MCP Registry Publishing

_Last revised: 2026-09-25_

The Creator Tools MCP server (`npx @minecraft/creator-tools mcp`) is described for the
[official MCP Registry](https://registry.modelcontextprotocol.io) by `server.json` at the repository root.

## Files

- `server.json`: registry manifest ([schema 2025-12-11](https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json)) for the npm package `@minecraft/creator-tools`, stdio transport, positional argument `mcp`.
- `app/jsnode/package.json`: source of the published npm `package.json`. Its `mcpName` must equal the `server.json` `name`; the registry checks this to verify package ownership.
- `app/src/local/McpToolAnnotations.ts`: MCP tool annotations (read-only, destructive, idempotent, and open-world hints) for every registered tool.
- `app/src/test/McpServerMetadataTest.ts`: checks the server info, tool annotations, tool references in descriptions, EULA handling, and `server.json`/`package.json` consistency.

## Naming

The server name is `io.github.Mojang/minecraft-creator-tools`. The registry grants GitHub Actions OIDC logins the namespace `io.github.<repository owner>/*` using the owner name exactly as GitHub reports it, and matches names case-sensitively, so the `Mojang` casing is required when publishing from this repository.

## Versions

`server.json` keeps the placeholder version `0.0.0-semantically-released` in source control, like the package manifests. During a release, semantic-release writes the new version into `app/toolbuild/jsn/package.json`, and `npm run updateversionsandreleasebuild` runs `npx gulp updateversions`. That task stamps the version into the package manifests, into `src/core/Constants.ts` (reported as the MCP server version), and into both `version` fields of `server.json`.

## Publishing

`.github/workflows/create-release.yml` publishes after `npx semantic-release`:

1. Skips if no new version was released (the pkgRoot `package.json` still has the placeholder version).
2. Verifies that the `server.json` versions match the released version.
3. Downloads a pinned `mcp-publisher` release and verifies it against the release's checksum file, whose SHA-256 is pinned in the workflow. To upgrade, update `MCP_PUBLISHER_VERSION` and `MCP_PUBLISHER_CHECKSUMS_SHA256`.
4. Runs `mcp-publisher login github-oidc` (the job has `id-token: write`) and `mcp-publisher publish`, retrying while npm metadata for the new version propagates.

The step uses `continue-on-error`, so a registry outage or rejection doesn't fail a release whose npm package and GitHub release are already published; a follow-up step emits a warning instead. To publish a missed version manually, check out the release tag, set both `server.json` versions to the released version, and run `mcp-publisher login github` (as a Mojang organization owner) followed by `mcp-publisher publish`.

## EULA

The MCP server's project `create` and `add` paths accept the Minecraft EULA either from a previous `mct eula` or from `MCTOOLS_I_ACCEPT_EULA_AT_MINECRAFTDOTNETSLASHEULA=true`, matching the CLI `create` and `add` commands. `server.json` intentionally doesn't declare this environment variable as an install-time input; doing so needs legal review.
