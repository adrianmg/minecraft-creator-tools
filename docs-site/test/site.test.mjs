import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { markdownToMdx } from "../tools/convert/markdown.mjs";
import { buildNavigation } from "../tools/convert/nav.mjs";
import { createSite } from "../tools/convert/site.mjs";

describe("createSite.rewriteUrl", () => {
  const files = [
    "Documents/GettingStarted.md",
    "Documents/Media/Shot.PNG",
    "Documents/Structures/index.yml",
    "Documents/Structures/CommandTutorial.md",
    "ScriptAPI/minecraft/server/Entity.md",
    "ScriptAPI/minecraft/server/BetaOnly.md",
    "PriorScriptAPI/minecraft/server-1xx/RemovedEvent.md",
    "Reference/Content/RawMessageJson.md",
    "Reference/Content/EventActions/emit_particle.md",
  ];
  const site = createSite({
    files,
    pages: files.filter((file) => !file.endsWith(".PNG")),
    experimentalOnly: new Set(["ScriptAPI/minecraft/server/BetaOnly.md"]),
    redirections: [
      { source_path: "Documents/OldName.md", redirect_url: "/minecraft/creator/documents/gettingstarted" },
      {
        source_path: "Documents/StructureTutorial.md",
        redirect_url: "/minecraft/creator/documents/structures/tutorial",
      },
      {
        source_path: "Documents/Structures/Tutorial.md",
        redirect_url: "/minecraft/creator/documents/structures/CommandTutorial",
      },
    ],
    linkFixes: {
      "Reference/Content/OldEvents/emit_particle.md": { to: "Reference/Content/EventActions/emit_particle.md#usage" },
      "Commands/enums/Missing.md": { to: null },
    },
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
    {
      name: "redirect chain",
      url: "StructureTutorial.md#section",
      from: "Documents/Other.md",
      expected: "/documents/structures/commandtutorial#section",
    },
    {
      name: "/creator/ typo for /minecraft/creator/",
      url: "/creator/documents/gettingstarted#top",
      from: "Documents/Other.md",
      expected: "/documents/gettingstarted#top",
    },
    {
      name: "double slash in a Learn path",
      url: "/minecraft/creator/documents//gettingstarted",
      from: "Documents/Other.md",
      expected: "/documents/gettingstarted",
    },
    {
      name: "path that leaves and re-enters the content folder",
      url: "../../creator/Reference/Content/RawMessageJson.md",
      from: "Documents/Other.md",
      expected: "/reference/content/rawmessagejson",
    },
    {
      name: "removed Script API type falls back to the 1.x page",
      url: "RemovedEvent.md",
      from: "ScriptAPI/minecraft/server/changelog.md",
      expected: "/priorscriptapi/minecraft/server-1xx/removedevent",
    },
    {
      name: "link fix with its own anchor",
      url: "../Reference/Content/OldEvents/emit_particle.md",
      from: "Documents/Other.md",
      expected: "/reference/content/eventactions/emit_particle#usage",
    },
    {
      name: "link fix that removes the link",
      url: "../Commands/enums/Missing.md",
      from: "Documents/Other.md",
      expected: null,
    },
    {
      name: "site-relative path that isn't this docset",
      url: "/creators-program",
      from: "Documents/Other.md",
      expected: "https://learn.microsoft.com/creators-program",
    },
  ];

  for (const { name, url, from, variant, expected } of cases) {
    it(name, () => assert.equal(site.rewriteUrl(url, { from, variant }), expected));
  }

  it("collects referenced media, unresolved links, and removed links", () => {
    assert.ok(site.media.has("Documents/Media/Shot.PNG"));
    assert.deepEqual(site.unresolved, [{ from: "Documents/Other.md", url: "Nope.md" }]);
    assert.deepEqual(site.unlinked, [{ from: "Documents/Other.md", url: "../Commands/enums/Missing.md" }]);
  });

  it("emits redirects for redirected paths, following chains", () => {
    assert.deepEqual(site.redirects(), [
      { source: "/documents/oldname", destination: "/documents/gettingstarted" },
      { source: "/documents/structuretutorial", destination: "/documents/structures/commandtutorial" },
      { source: "/documents/structures/tutorial", destination: "/documents/structures/commandtutorial" },
    ]);
  });
});

describe("markdownToMdx link removal", () => {
  it("keeps the text of a removed link", () => {
    const { mdx } = markdownToMdx("See [the objective](missing.md) and [a page](page.md).", {
      rewriteUrl: (url) => (url === "missing.md" ? null : `/${url}`),
    });
    assert.equal(mdx.trim(), "See the objective and [a page](/page.md).");
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
