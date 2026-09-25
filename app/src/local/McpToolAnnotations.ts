// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * McpToolAnnotations - MCP tool behavior hints for the Creator Tools MCP server.
 *
 * MCP clients and directories (for example, connector/registry reviewers) use
 * tool annotations to decide whether a tool call needs user confirmation and how
 * to describe it. Every tool registered by MinecraftMcpServer must have an entry
 * here; McpServerMetadataTest enforces this.
 *
 * Hint semantics (see the MCP spec's ToolAnnotations):
 * - readOnlyHint: the tool does not modify its environment (files, game state, sessions).
 * - destructiveHint: the tool may overwrite or remove existing data. Tools that write
 *   files at caller-chosen paths (and replace existing files there) are destructive.
 * - idempotentHint: repeating the call with the same arguments has no additional effect.
 * - openWorldHint: the tool reaches outside its closed local domain - it downloads
 *   content from the network or acts on a live Minecraft game session.
 */

import { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

export interface IMcpToolBehaviorHints {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

const readOnlyLocal: IMcpToolBehaviorHints = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

/** Writes files at a caller-supplied path, replacing existing files; same input produces the same output. */
const overwritesLocalFiles: IMcpToolBehaviorHints = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
};

export const MCP_TOOL_BEHAVIOR_HINTS: { readonly [toolName: string]: IMcpToolBehaviorHints } = {
  // Downloads template files from GitHub and writes them into the target folder,
  // replacing files with the same name. Generates fresh pack UUIDs on each run.
  createProject: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  // Copies gallery template files (fetched from the network) into the project,
  // overwriting files with the same name.
  addItem: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  // Skips existing content files and merges shared catalogs, but currently rewrites existing
  // pack manifests (names and dependencies). Revisit destructiveHint once manifests are preserved.
  createMinecraftContent: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  getEffectiveContentSchema: readOnlyLocal,
  validateContent: readOnlyLocal,
  validateFile: readOnlyLocal,
  // Downloads/starts a Bedrock Dedicated Server in a free slot (never replaces an existing session).
  createMinecraftSessionWithContent: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  moveSessionPlayerToLocation: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  // Arbitrary slash commands and action sets can change or destroy world state.
  runCommandInMinecraft: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  runActionSetInMinecraft: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  listMinecraftSessions: readOnlyLocal,
  // Only records a session-name -> slot mapping in the MCP server's memory.
  connectToMinecraftSession: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  designModel: overwritesLocalFiles,
  getModelTemplates: readOnlyLocal,
  designStructure: overwritesLocalFiles,
  writeImageFile: overwritesLocalFiles,
  writeImageFileFromSvg: overwritesLocalFiles,
  writeImageFileFromPixelArt: overwritesLocalFiles,
};

/**
 * Builds the MCP `annotations` object for a tool. Tools without an entry in
 * MCP_TOOL_BEHAVIOR_HINTS only get a title, so clients fall back to the spec's
 * conservative defaults (not read-only, destructive, not idempotent, open world).
 */
export function getMcpToolAnnotations(toolName: string, title?: string): ToolAnnotations {
  const hints = Object.prototype.hasOwnProperty.call(MCP_TOOL_BEHAVIOR_HINTS, toolName)
    ? MCP_TOOL_BEHAVIOR_HINTS[toolName]
    : undefined;

  return {
    ...(title !== undefined ? { title } : {}),
    ...(hints ?? {}),
  };
}
