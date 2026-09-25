import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { preprocessDocfx, videoEmbedUrl } from "../tools/convert/docfx.mjs";
import { htmlToJsx } from "../tools/convert/html.mjs";
import { landingToMdx } from "../tools/convert/landing.mjs";
import { markdownToMdx } from "../tools/convert/markdown.mjs";

const convert = (markdown, options) => markdownToMdx(preprocessDocfx(markdown, options), options).mdx.trim();

describe("preprocessDocfx", () => {
  const cases = [
    {
      name: "converts :::image to markdown image",
      input: ':::image type="content" source="Media/a b.png" alt-text="Alt [x]":::',
      expected: "![Alt \\[x\\]](<Media/a b.png>)",
    },
    {
      name: "keeps the stable moniker block for the stable variant",
      input:
        '- a\n::: moniker range="=minecraft-bedrock-experimental"\n- beta\n::: moniker-end\n::: moniker range="=minecraft-bedrock-stable"\n- stable\n::: moniker-end',
      expected: "- a\n- stable",
    },
    {
      name: "keeps the experimental moniker block for the beta variant",
      options: { variant: "beta" },
      input: '- a\n::: moniker range="=minecraft-bedrock-experimental"\n- beta\n::: moniker-end',
      expected: "- a\n- beta",
    },
    {
      name: "inlines :::code includes in a fence",
      options: { readInclude: () => '{\n  "a": 1\n}\n' },
      input: ':::code language="json" source="../x.json":::',
      expected: '```json\n{\n  "a": 1\n}\n```',
    },
    {
      name: "removes row and column markers",
      input: ":::row:::\n:::column:::\ntext\n:::column-end:::\n:::row-end:::",
      expected: "text",
    },
    {
      name: "leaves DocFX syntax inside fenced code alone",
      input: '```md\n:::image source="x":::\n::: moniker range="=minecraft-bedrock-experimental"\n```',
      expected: '```md\n:::image source="x":::\n::: moniker range="=minecraft-bedrock-experimental"\n```',
    },
  ];

  for (const { name, input, expected, options } of cases) {
    it(name, () => assert.equal(preprocessDocfx(input, options), expected));
  }
});

describe("videoEmbedUrl", () => {
  const cases = [
    ["https://youtu.be/abc", "https://www.youtube.com/embed/abc"],
    ["https://www.youtube.com/watch?v=abc", "https://www.youtube.com/embed/abc"],
    ["https://www.youtube.com/embed/abc", "https://www.youtube.com/embed/abc"],
    [
      "6eee691c-6562-45f0-a62b-994195d29a4b",
      "https://learn-video.azurefd.net/vod/player?id=6eee691c-6562-45f0-a62b-994195d29a4b",
    ],
  ];
  for (const [input, expected] of cases) {
    it(input, () => assert.equal(videoEmbedUrl(input), expected));
  }
});

describe("htmlToJsx", () => {
  const cases = [
    { input: "<br>", expected: { type: "jsx", value: "<br />" } },
    { input: '<td class="a" colspan="2">', expected: { type: "jsx", value: '<td className="a" colSpan="2">' } },
    {
      input: '<span style="font-weight: bold">',
      expected: { type: "jsx", value: '<span style={{"fontWeight":"bold"}}>' },
    },
    { input: "<players>", expected: { type: "text", value: "<players>" } },
    { input: "<td>{x}</td>", expected: { type: "jsx", value: "<td>&#123;x&#125;</td>" } },
    { input: "<!-- hidden -->", expected: null },
  ];
  for (const { input, expected } of cases) {
    it(input, () => assert.deepEqual(htmlToJsx(input), expected));
  }

  it("rewrites href and src", () => {
    assert.deepEqual(
      htmlToJsx('<img src="a.png">', (url, kind) => `/${kind}/${url}`),
      {
        type: "jsx",
        value: '<img src="/image/a.png" />',
      }
    );
  });
});

describe("markdownToMdx", () => {
  const cases = [
    {
      name: "escapes MDX syntax in text",
      input: "Use {value} and Array<string> and /give <player>.",
      expected: "Use \\{value} and Array\\<string> and /give \\<player>.",
    },
    {
      name: "converts alerts to callouts",
      input: "> [!WARNING]\n> Careful.",
      expected: "<Warning>\n  Careful.\n</Warning>",
    },
    {
      name: "maps IMPORTANT to Info and CAUTION to Danger",
      input: "> [!IMPORTANT]\n> A.\n\n> [!CAUTION]\n> B.",
      expected: "<Info>\n  A.\n</Info>\n\n<Danger>\n  B.\n</Danger>",
    },
    {
      name: "converts nextstepaction links to cards",
      input: '> [!div class="nextstepaction"]\n> [Next page](next.md)',
      expected: '<Card title="Next page" href="next.md" icon="arrow-right" />',
    },
    {
      name: "unwraps checklists",
      input: '> [!div class="checklist"]\n>\n> - One',
      expected: "- One",
    },
    {
      name: "converts DocFX tabs",
      input: "### [A](#tab/a)\n\nOne\n\n### [B](#tab/b)\n\nTwo\n\n---\n\nAfter",
      expected:
        '<Tabs>\n  <Tab title="A">\n    One\n  </Tab>\n\n  <Tab title="B">\n    Two\n  </Tab>\n</Tabs>\n\nAfter',
    },
    {
      name: "rewrites links and images",
      options: { rewriteUrl: (url, kind) => `/${kind}/${url}` },
      input: "[Page](a.md) ![Alt](b.png)",
      expected: "[Page](/link/a.md) ![Alt](/image/b.png)",
    },
    {
      name: "keeps code unescaped",
      input: "`Array<string>`\n\n```js\nconst a = { b: 1 };\n```",
      expected: "`Array<string>`\n\n```js\nconst a = { b: 1 };\n```",
    },
  ];

  for (const { name, input, expected, options } of cases) {
    it(name, () => assert.equal(convert(input, options), expected));
  }

  it("moves the first H1 into the title", () => {
    const { mdx, title } = markdownToMdx("# Hello `world`\n\nBody");
    assert.equal(title, "Hello world");
    assert.equal(mdx.trim(), "Body");
  });
});

describe("landingToMdx", () => {
  it("renders cards with rewritten links", () => {
    const yaml = [
      "### YamlMime:Landing",
      "title: Structures",
      "summary: About structures.",
      "landingContent:",
      "  - title: Learn",
      "    linkLists:",
      "      - linkListType: learn",
      "        links:",
      "          - text: Intro",
      "            url: Intro.md",
    ].join("\n");
    const { mdx, title } = landingToMdx(yaml, (url) => `/x/${url}`);
    assert.equal(title, "Structures");
    assert.equal(
      mdx.trim(),
      'About structures.\n\n<CardGroup cols={2}>\n  <Card title="Learn" icon="graduation-cap">\n    - [Intro](/x/Intro.md)\n  </Card>\n</CardGroup>'
    );
  });
});
