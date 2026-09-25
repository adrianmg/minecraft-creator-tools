// Line-level rewrites for DocFX syntax that CommonMark would otherwise mis-parse.
// Runs before the markdown AST pass. Lines inside fenced code blocks are left untouched.

const FENCE = /^\s*(?:>\s*)*(`{3,}|~{3,})/;
const MONIKER_START = /^\s*:::\s*moniker\s+range="=?([^"]+)"\s*$/;
const MONIKER_END = /^\s*:::\s*moniker-end\s*$/;
const ROW_COLUMN = /^\s*(?:>\s*)*:::(?:row|column)(?:-end)?:::\s*$/;
const IMAGE = /:::image((?:\s+[\w-]+="[^"]*")*)\s*:::/g;
const CODE = /^(\s*(?:>\s*)*):::code((?:\s+[\w-]+="[^"]*")*)\s*:::\s*$/;
const VIDEO = /\[!VIDEO\s+([^\]\s]+)\s*\]/g;

export const VARIANT_MONIKERS = {
  stable: "minecraft-bedrock-stable",
  beta: "minecraft-bedrock-experimental",
};

export function parseAttributes(text) {
  const attributes = {};
  for (const match of text.matchAll(/([\w-]+)="([^"]*)"/g)) {
    attributes[match[1]] = match[2];
  }
  return attributes;
}

export function videoEmbedUrl(url) {
  if (/^[0-9a-f-]{36}$/i.test(url)) {
    return `https://learn-video.azurefd.net/vod/player?id=${url}`;
  }
  const short = url.match(/^https?:\/\/youtu\.be\/([\w-]+)/);
  if (short) {
    return `https://www.youtube.com/embed/${short[1]}`;
  }
  const watch = url.match(/^https?:\/\/(?:www\.)?youtube\.com\/watch\?v=([\w-]+)/);
  if (watch) {
    return `https://www.youtube.com/embed/${watch[1]}`;
  }
  return url;
}

function imageMarkdown(attributeText) {
  const attributes = parseAttributes(attributeText);
  const alt = (attributes["alt-text"] ?? "").replace(/[[\]]/g, "\\$&");
  return `![${alt}](<${attributes.source ?? ""}>)`;
}

function videoHtml(url) {
  return (
    `<iframe class="w-full aspect-video rounded-xl" src="${videoEmbedUrl(url)}" title="Video" loading="lazy" ` +
    `allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`
  );
}

function codeBlock(prefix, attributeText, readInclude) {
  const attributes = parseAttributes(attributeText);
  const content = readInclude(attributes.source);
  if (content === undefined) {
    return [`${prefix}\`[Missing code sample: ${attributes.source}]\``];
  }
  const longestRun = Math.max(2, ...[...content.matchAll(/`+/g)].map((match) => match[0].length));
  const fence = "`".repeat(longestRun + 1);
  const body = content.replace(/\r\n/g, "\n").replace(/\n+$/, "").split("\n");
  return [
    `${prefix}${fence}${attributes.language ?? ""}`,
    ...body.map((line) => `${prefix}${line}`),
    `${prefix}${fence}`,
  ];
}

/**
 * @param {string} markdown
 * @param {{ variant?: "stable" | "beta", readInclude?: (source: string) => string | undefined }} options
 */
export function preprocessDocfx(markdown, { variant = "stable", readInclude = () => undefined } = {}) {
  const keepMoniker = VARIANT_MONIKERS[variant];
  const output = [];
  let fence = null;
  let dropping = false;

  for (const line of markdown.split("\n")) {
    if (fence) {
      if (!dropping) output.push(line);
      const closing = line.replace(/^\s*(?:>\s*)*/, "").trimEnd();
      if (closing.startsWith(fence) && new RegExp(`^\\${fence[0]}+$`).test(closing)) fence = null;
      continue;
    }

    const fenceMatch = line.match(FENCE);
    if (fenceMatch) {
      fence = fenceMatch[1];
      if (!dropping) output.push(line);
      continue;
    }

    const monikerStart = line.match(MONIKER_START);
    if (monikerStart) {
      dropping = monikerStart[1] !== keepMoniker;
      continue;
    }
    if (MONIKER_END.test(line)) {
      dropping = false;
      continue;
    }
    if (dropping || ROW_COLUMN.test(line)) {
      continue;
    }

    const code = line.match(CODE);
    if (code) {
      output.push(...codeBlock(code[1], code[2], readInclude));
      continue;
    }

    output.push(
      line.replace(IMAGE, (_, attributes) => imageMarkdown(attributes)).replace(VIDEO, (_, url) => videoHtml(url))
    );
  }

  return output.join("\n");
}
