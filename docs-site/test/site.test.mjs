import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildNavigation } from "../tools/convert/nav.mjs";
import { createSite } from "../tools/convert/site.mjs";

describe("createSite.rewriteUrl", () => {
  const files = [
    "Documents/GettingStarted.md",
    "Documents/Media/Shot.PNG",
    "Documents/Structures/index.yml",
    "ScriptAPI/minecraft/server/Entity.md",
    "ScriptAPI/minecraft/server/BetaOnly.md",
  ];
  const site = createSite({
    files,
    pages: files.filter((file) => !file.endsWith(".PNG")),
    experimentalOnly: new Set(["ScriptAPI/minecraft/server/BetaOnly.md"]),
    redirections: [
      { source_path: "Documents/OldName.md", redirect_url: "/minecraft/creator/documents/gettingstarted" },
    ],
  });

  const cases = [
    {
      name: "relative page link",
      url: "GettingStarted.md#setup",
      from: "Documents/Other.md",
      expected: "/documents/gettingstarted#setup",
    },
    {
      name: "case-insensitive media",
      url: "Media/shot.png",
      from: "Documents/Other.md",
      expected: "/documents/media/shot.png",
    },
    {
      name: "backslash path",
      url: "Media\\Shot.PNG",
      from: "Documents/Other.md",
      expected: "/documents/media/shot.png",
    },
    { name: "landing index", url: "Structures/", from: "Documents/Other.md", expected: "/documents/structures/index" },
    {
      name: "absolute Learn link",
      url: "https://learn.microsoft.com/en-us/minecraft/creator/documents/gettingstarted?view=minecraft-bedrock-stable",
      from: "Documents/Other.md",
      expected: "/documents/gettingstarted",
    },
    { name: "Learn home", url: "/minecraft/creator", from: "Documents/Other.md", expected: "/" },
    {
      name: "other Learn docset",
      url: "/shows/series/",
      from: "Documents/Other.md",
      expected: "https://learn.microsoft.com/shows/series/",
    },
    {
      name: "external link",
      url: "https://github.com/Mojang",
      from: "Documents/Other.md",
      expected: "https://github.com/Mojang",
    },
    {
      name: "upstream redirection",
      url: "OldName.md",
      from: "Documents/Other.md",
      expected: "/documents/gettingstarted",
    },
    {
      name: "Script API link from stable",
      url: "Entity.md",
      from: "ScriptAPI/minecraft/server/X.md",
      expected: "/scriptapi/minecraft/server/entity",
    },
    {
      name: "Script API link from beta",
      url: "Entity.md",
      from: "ScriptAPI/minecraft/server/X.md",
      variant: "beta",
      expected: "/beta/scriptapi/minecraft/server/entity",
    },
    {
      name: "experimental-only page always resolves to beta",
      url: "../ScriptAPI/minecraft/server/BetaOnly.md",
      from: "Documents/Other.md",
      expected: "/beta/scriptapi/minecraft/server/betaonly",
    },
    { name: "missing target is unchanged", url: "Nope.md", from: "Documents/Other.md", expected: "Nope.md" },
  ];

  for (const { name, url, from, variant, expected } of cases) {
    it(name, () => assert.equal(site.rewriteUrl(url, { from, variant }), expected));
  }

  it("collects referenced media and unresolved links", () => {
    assert.ok(site.media.has("Documents/Media/Shot.PNG"));
    assert.deepEqual(site.unresolved.at(-1), { from: "Documents/Other.md", url: "Nope.md" });
  });

  it("emits redirects for redirected paths", () => {
    assert.deepEqual(site.redirects(), [{ source: "/documents/oldname", destination: "/documents/gettingstarted" }]);
  });
});

describe("buildNavigation", () => {
  const toc = [
    {
      name: "Guides",
      href: null,
      items: [
        { name: "Intro", href: "a.md", items: [] },
        { name: "Scripting", href: null, items: [{ name: "Scripts", href: "s.md", items: [] }] },
        { name: "Duplicate", href: "a.md", items: [] },
      ],
    },
    {
      name: "Reference",
      href: "ref.md",
      items: [{ name: "Blocks", href: null, items: [{ name: "Block", href: "b.md", items: [] }] }],
    },
  ];
  const routeForHref = (href, variant) => (variant === "beta" ? "beta/" : "") + href.replace(".md", "");

  it("groups, flattens, excludes, and places each page once", () => {
    const config = {
      tabs: [
        { tab: "Guides", groups: [{ toc: ["Guides"], exclude: ["Scripting"] }] },
        { tab: "Reference", groups: [{ toc: ["Reference"], flatten: true, group: "Overview" }] },
        {
          tab: "API",
          versions: [
            { version: "Stable", groups: [{ toc: ["Guides", "Scripting"], group: "Scripting guides" }] },
            { version: "Beta", variant: "beta", groups: [{ toc: ["Guides", "Scripting"] }] },
          ],
        },
      ],
    };
    const { navigation, placed } = buildNavigation(toc, config, routeForHref);
    assert.deepEqual(navigation.tabs, [
      { tab: "Guides", groups: [{ group: "Guides", pages: ["a"] }] },
      {
        tab: "Reference",
        groups: [
          { group: "Overview", pages: ["ref"] },
          { group: "Blocks", pages: ["b"] },
        ],
      },
      {
        tab: "API",
        versions: [
          { version: "Stable", groups: [{ group: "Scripting guides", pages: ["s"] }] },
          { version: "Beta", groups: [{ group: "Scripting", pages: ["beta/s"] }] },
        ],
      },
    ]);
    assert.equal(placed.get("a"), "Intro");
  });

  it("builds one dropdown per child and splits partitions into their own dropdowns", () => {
    const apiToc = [
      {
        name: "APIs",
        href: null,
        items: [
          {
            name: "minecraft/server",
            href: null,
            items: [
              { name: "Entity", href: "entity.md", items: [] },
              { name: "WorldAfterEvents", href: "events.md", items: [] },
              { name: "EntityHealthComponent", href: "health.md", items: [] },
            ],
          },
          { name: "minecraft/server-ui", href: null, items: [{ name: "Form", href: "form.md", items: [] }] },
        ],
      },
    ];
    const config = {
      tabs: [
        {
          tab: "API",
          versions: [
            {
              version: "Stable",
              dropdowns: [
                {
                  toc: ["APIs"],
                  perChild: true,
                  labelPrefix: "@",
                  partitions: {
                    "minecraft/server": [
                      { suffix: "· Events", match: "(After|Before)Events?$" },
                      { suffix: "· Components", match: "Component" },
                    ],
                  },
                },
              ],
            },
          ],
        },
      ],
    };
    const { navigation } = buildNavigation(apiToc, config, routeForHref);
    const names = navigation.tabs[0].versions[0].dropdowns.map(({ dropdown, groups }) => [dropdown, groups[0].pages]);
    assert.deepEqual(names, [
      ["@minecraft/server", ["entity"]],
      ["@minecraft/server · Events", ["events"]],
      ["@minecraft/server · Components", ["health"]],
      ["@minecraft/server-ui", ["form"]],
    ]);
  });
});
