// Builds Mintlify navigation from the DocFX TOC.yml tree and config/navigation.json.
// Each page is placed once; later references to an already placed page are skipped.

import { load } from "js-yaml";
import { posix } from "node:path";

export function loadToc(readFile, tocPath) {
  const parsed = load(readFile(tocPath));
  const items = Array.isArray(parsed) ? parsed : (parsed?.items ?? []);
  const directory = posix.dirname(tocPath);

  const toNode = (item) => {
    const node = { name: String(item.name ?? ""), href: null, items: [] };
    if (item.href && !/^[a-z]+:/i.test(item.href)) {
      const resolved = posix.normalize(posix.join(directory, item.href));
      if (/(^|\/)toc\.yml$/i.test(resolved)) node.items.push(...loadToc(readFile, resolved));
      else node.href = resolved;
    }
    for (const child of item.items ?? []) node.items.push(toNode(child));
    return node;
  };

  return items.map(toNode);
}

export function findTocNode(nodes, path) {
  let current = { items: nodes };
  for (const name of path) {
    current = current.items.find((node) => node.name === name);
    if (!current) throw new Error(`TOC entry not found: ${path.join(" > ")}`);
  }
  return current;
}

/**
 * @param {object[]} toc Top-level TOC nodes that config paths are relative to.
 * @param {{ tabs: object[] }} config
 * @param {(href: string, variant: string) => string | null} routeForHref Returns null for hrefs that aren't published pages.
 */
export function buildNavigation(toc, config, routeForHref) {
  const placed = new Map();

  const place = (route, name) => {
    if (!route || placed.has(route)) return null;
    placed.set(route, name);
    return route;
  };

  const toEntry = (node, variant, exclude = new Set()) => {
    const route = node.href ? place(routeForHref(node.href, variant), node.name) : null;
    const pages = node.items
      .filter((child) => !exclude.has(child.name))
      .map((child) => toEntry(child, variant))
      .filter(Boolean);
    if (!pages.length) return route;
    return route ? { group: node.name, root: route, pages } : { group: node.name, pages };
  };

  const groupsFor = (spec, variant) => {
    if (spec.pages) {
      spec.pages.forEach((page) => place(page, undefined));
      return [{ group: spec.group, pages: spec.pages }];
    }

    const node = findTocNode(toc, spec.toc);
    const exclude = new Set(spec.exclude ?? []);
    const name = spec.group ?? node.name;

    if (!spec.flatten) {
      const entry = toEntry(node, variant, exclude);
      if (!entry) return [];
      return [typeof entry === "string" ? { group: name, pages: [entry] } : { ...entry, group: name }];
    }

    const groups = [];
    let leaves = null;
    const rootRoute = node.href ? place(routeForHref(node.href, variant), node.name) : null;
    if (rootRoute) {
      leaves = { group: name, pages: [rootRoute] };
      groups.push(leaves);
    }
    for (const child of node.items.filter((item) => !exclude.has(item.name))) {
      const entry = toEntry(child, variant);
      if (!entry) continue;
      if (typeof entry === "string") {
        if (!leaves) groups.push((leaves = { group: name, pages: [] }));
        leaves.pages.push(entry);
      } else {
        groups.push(entry);
      }
    }
    return groups;
  };

  const dropdownsFor = (spec, variant) => {
    if (!spec.perChild) {
      const groups = spec.groups.flatMap((groupSpec) => groupsFor(groupSpec, variant));
      return groups.length ? [{ dropdown: spec.dropdown, icon: spec.icon, groups }] : [];
    }

    // One dropdown per child of the TOC node. `partitions` moves matching entries of a child into extra dropdowns.
    return findTocNode(toc, spec.toc).items.flatMap((child) => {
      const label = (spec.labelPrefix ?? "") + child.name;
      const partitions = (spec.partitions?.[child.name] ?? []).map((partition) => ({
        ...partition,
        pattern: new RegExp(partition.match),
        items: [],
      }));
      const rest = [];
      for (const item of child.items) {
        (partitions.find((partition) => partition.pattern.test(item.name))?.items ?? rest).push(item);
      }
      const dropdown = (name, items, icon) => {
        const pages = items.map((item) => toEntry(item, variant)).filter(Boolean);
        return pages.length ? { dropdown: name, icon, groups: [{ group: name, pages }] } : null;
      };
      return [
        dropdown(label, rest, spec.icon),
        ...partitions.map((partition) => dropdown(`${label} ${partition.suffix}`, partition.items, partition.icon)),
      ].filter(Boolean);
    });
  };

  const tabs = config.tabs.map(({ groups, versions, ...tab }) => {
    if (versions) {
      return {
        ...tab,
        versions: versions.map(({ groups: versionGroups, dropdowns, variant = "stable", ...version }) =>
          dropdowns
            ? { ...version, dropdowns: dropdowns.flatMap((spec) => dropdownsFor(spec, variant)) }
            : { ...version, groups: versionGroups.flatMap((spec) => groupsFor(spec, variant)) }
        ),
      };
    }
    return { ...tab, groups: groups.flatMap((spec) => groupsFor(spec, "stable")) };
  });

  return { navigation: { tabs }, placed };
}
