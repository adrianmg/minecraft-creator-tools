// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * MAS 1.4.10 Reflow regression for the LootTableVisualEditor (Bug 1643412
 * follow-up).
 *
 * The editor viewport-pins its container (`calc(100vh - heightOffset)`) so
 * that pool content scrolls internally on desktop. At the 320×256 reflow
 * viewport with the status area expanded, the app-chrome offsets total at
 * least 276px — more than the whole viewport — so an unconditional pin
 * clamps the editor to zero height. The pin is therefore media-query gated
 * (see LootTableVisualEditor.css); below the breakpoint the container grows
 * with its content instead. This spec asserts the editor keeps a nonzero
 * usable height with the status area expanded at both reflow viewports.
 *
 * The Advanced sub-tab hosts LootTableEditor, which pins its own schema-form
 * FlexBox to calc(100vh - (heightOffset + 36)); the same reflow-gating lives in
 * LootTableEditor.css. The final test switches to Advanced and asserts the form
 * likewise keeps a nonzero usable height and stays reachable.
 */

import { test, expect, Page, ConsoleMessage } from "@playwright/test";
import { processMessage, enterEditor } from "../testweb/WebTestUtilities";

function setupConsoleTracking(page: Page) {
  const consoleErrors: { url: string; error: string }[] = [];
  const consoleWarnings: { url: string; error: string }[] = [];

  page.on("console", (msg: ConsoleMessage) => {
    processMessage(msg, page, consoleErrors, consoleWarnings);
  });

  return { consoleErrors, consoleWarnings };
}

/**
 * Create a loot table via the Content Wizard and open it. Mirrors the happy
 * path of SpawnLootRecipeVisualEditors.spec.ts, but defensively returns false
 * (→ skip) rather than failing when the zoomed layout blocks a navigation
 * step, matching the conventions of the other reflow specs.
 */
async function openLootTableEditor(page: Page, screenshotSuffix: string): Promise<boolean> {
  // On failure at any step, capture where the flow stopped — a skipped
  // regression test should leave evidence of why.
  const failShot = (step: string) =>
    page
      .screenshot({
        path: `debugoutput/screenshots/reflow-loot-table-blocked-${step}-${screenshotSuffix}.png`,
        fullPage: true,
      })
      .catch(() => {});

  const existingDialog = page.locator(".MuiDialog-root").first();
  if (await existingDialog.isVisible({ timeout: 500 }).catch(() => false)) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
  }

  // The "Add new content" button lives in the item-list sidebar, which the
  // narrow layout hides (`.pe-col1 { display: none }` below 480px). Switch to
  // the items-focus view via the toolbar first, like Reflow.spec.ts does.
  let addButton = page.locator('button[aria-label="Add new content"]').first();
  if (!(await addButton.isVisible({ timeout: 5000 }).catch(() => false))) {
    const itemsButton = page.getByRole("button", { name: /Items/i }).first();
    if (await itemsButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await itemsButton.click();
      await page.waitForTimeout(500);
    }
    addButton = page.locator('button[aria-label="Add new content"]').first();
  }
  if (!(await addButton.isVisible({ timeout: 10000 }).catch(() => false))) {
    console.log("openLootTableEditor: 'Add new content' button not found");
    await failShot("add-button");
    return false;
  }
  await addButton.scrollIntoViewIfNeeded().catch(() => {});
  // At 320×256 a lingering toolbar tooltip ("Save (Ctrl+S)") can cover the
  // button and intercept pointer events; park the mouse away and let it
  // dismiss, then force-click as a last resort.
  await page.mouse.move(0, 150);
  await page.waitForTimeout(400);
  try {
    await addButton.click({ timeout: 5000 });
  } catch {
    await addButton.click({ force: true });
  }
  await page.waitForTimeout(800);

  const tile = page.locator(".cwiz-main-option").filter({ hasText: "Loot Table" }).first();
  if (!(await tile.isVisible({ timeout: 3000 }).catch(() => false))) {
    console.log("openLootTableEditor: 'Loot Table' wizard tile not found");
    await failShot("wizard-tile");
    return false;
  }
  await tile.scrollIntoViewIfNeeded().catch(() => {});
  await tile.click();
  await page.waitForTimeout(800);

  // Accept the naming dialog if one appears.
  const dialog = page.locator(".MuiDialog-root, dialog, [role='dialog']").first();
  if (await dialog.isVisible({ timeout: 3000 }).catch(() => false)) {
    const confirm = dialog.locator('button:has-text("Add"), button:has-text("OK"), button:has-text("Create")').first();
    if (await confirm.isVisible({ timeout: 1500 }).catch(() => false)) {
      await confirm.click();
    } else {
      await page.keyboard.press("Enter");
    }
    await page.waitForTimeout(1500);
  }

  // The wizard usually auto-opens the new file; fall back to the sidebar.
  const container = page.locator(".ltve-container").first();
  if (await container.isVisible({ timeout: 2000 }).catch(() => false)) {
    return true;
  }

  const sidebar = page.locator('[role="listbox"][aria-label="Project items"], .pil-projectItemList').first();
  const scope = (await sidebar.count().catch(() => 0)) > 0 ? sidebar : page;
  const option = scope.locator('[role="option"]').filter({ hasText: /loot/i }).first();
  if (await option.isVisible({ timeout: 5000 }).catch(() => false)) {
    await option.click();
    await page.waitForTimeout(2000);
  }

  const opened = await container.isVisible({ timeout: 5000 }).catch(() => false);
  if (!opened) {
    console.log("openLootTableEditor: .ltve-container never appeared");
    await failShot("editor-open");
  }
  return opened;
}

/**
 * Expands the status area as a HARD precondition. The expanded status area is
 * what pushes the chrome offsets past 100vh at the reflow viewports — without
 * it the assertions below regress a much easier layout than the one Bug
 * 1643412 describes, so a missing toggle must fail the test, not soften it.
 * Expansion is verified structurally via the .pe-gridOuterExpanded grid class
 * (ProjectEditor.tsx applies it only when statusAreaMode === expanded).
 */
async function expandStatusArea(page: Page) {
  const expandButton = page
    .getByRole("button", { name: /Show more information in the status area/i })
    .or(page.locator('[title="Show more information in the status area"]'))
    .first();
  await expect(expandButton, "status-area expand toggle must be present").toBeVisible({ timeout: 10000 });
  await expandButton.click();
  await expect(
    page.locator(".pe-gridOuterExpanded"),
    "status area did not actually expand after clicking the toggle"
  ).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(300);
}

/**
 * Asserts the editor's content is reachable: either the container already
 * fits within the viewport, or a scrollable ancestor (the .pe-col* editor
 * column below the reflow breakpoint, per ProjectEditor.css) can bring its
 * bottom edge into view. Without such a scroll container the grown editor is
 * silently clipped by the overflow:hidden project grid — the bug this spec
 * regresses against.
 *
 * Geometry alone is not trusted: getBoundingClientRect ignores ancestor
 * clipping, so a child inside an overflow:hidden ancestor reports a healthy
 * box while being invisible. After scrolling, the bottom edge is therefore
 * also hit-tested with document.elementFromPoint — the probe only succeeds if
 * the container (or a descendant) is genuinely painted at that point.
 */
async function assertEditorReachable(page: Page, label: string) {
  const reach = await page.evaluate(() => {
    const container = document.querySelector(".ltve-container");
    if (!container) {
      return null;
    }
    let scroller: Element | null = null;
    for (let el = container.parentElement; el; el = el.parentElement) {
      const overflowY = window.getComputedStyle(el).overflowY;
      if ((overflowY === "auto" || overflowY === "scroll") && el.scrollHeight > el.clientHeight + 1) {
        scroller = el;
        break;
      }
    }
    const before = container.getBoundingClientRect();
    const fitsUnscrolled = before.height > 0 && before.bottom <= window.innerHeight + 1;
    if (scroller) {
      scroller.scrollTop = scroller.scrollHeight;
    }
    const after = container.getBoundingClientRect();

    // Hit-test just inside the container's bottom edge: elementFromPoint sees
    // only what is actually painted, so ancestor clipping (or an overlay
    // covering the editor) fails this where pure rect math would pass. Probe
    // a few candidate points to tolerate borders/scrollbar gutters.
    const x = Math.min(after.left + after.width / 2, window.innerWidth - 4);
    let bottomEdgeVisible = false;
    const probeHits: string[] = [];
    for (const dy of [3, 8, 16]) {
      const y = Math.min(after.bottom - dy, window.innerHeight - 2);
      if (y <= after.top) {
        continue;
      }
      const hit = document.elementFromPoint(x, y);
      if (hit && (hit === container || container.contains(hit))) {
        bottomEdgeVisible = true;
        break;
      }
      probeHits.push(
        `(${Math.round(x)},${Math.round(y)})→` +
          (hit ? `${hit.tagName.toLowerCase()}.${(hit as HTMLElement).className}` : "null")
      );
    }

    const result = {
      fitsUnscrolled,
      scrollerClass: scroller ? scroller.className : null,
      bottomAfterScroll: after.bottom,
      containerHeight: after.height,
      viewportHeight: window.innerHeight,
      bottomEdgeVisible,
      probeHits,
    };
    if (scroller) {
      scroller.scrollTop = 0;
    }
    return result;
  });

  expect(reach, `${label}: .ltve-container not found`).not.toBeNull();
  if (reach) {
    expect(reach.containerHeight, `${label}: editor collapsed to zero height`).toBeGreaterThan(0);
    const reachable = reach.fitsUnscrolled || reach.bottomAfterScroll <= reach.viewportHeight + 1;
    expect(
      reachable,
      `${label}: editor bottom sits at ${Math.round(reach.bottomAfterScroll)}px after scrolling ` +
        `(viewport ${reach.viewportHeight}px, scroll container: ${reach.scrollerClass ?? "none found"}) — ` +
        `content below the fold is unreachable`
    ).toBeTruthy();
    expect(
      reach.bottomEdgeVisible,
      `${label}: the editor's bottom edge is within the viewport geometrically but hit-testing found ` +
        `another element painted there — the editor is clipped or covered (scroll container: ` +
        `${reach.scrollerClass ?? "none found"}; probes: ${reach.probeHits.join("; ")})`
    ).toBeTruthy();
  }
}

/**
 * Switches the visual editor to its Advanced (schema) sub-tab as a HARD
 * precondition. The Advanced tab hosts LootTableEditor, which pins its own
 * FlexBox to calc(100vh - (heightOffset + 36)); the +36 tab-bar allowance makes
 * it collapse even more aggressively than the container, so its reflow-gating is
 * what this coverage exercises. A missing/inert tab must fail the test rather
 * than silently regress the Simple-tab layout the other specs already cover.
 */
async function switchToAdvancedTab(page: Page) {
  const advancedTab = page.locator(".ltve-tab-bar .ltve-tab").filter({ hasText: "Advanced" }).first();
  await expect(advancedTab, "Advanced sub-tab button must be present").toBeVisible({ timeout: 10000 });
  // A lingering toolbar tooltip can intercept the click at 320×256; park the
  // mouse and force-click as a fallback, mirroring openLootTableEditor.
  await page.mouse.move(0, 150);
  await page.waitForTimeout(200);
  try {
    await advancedTab.click({ timeout: 5000 });
  } catch {
    await advancedTab.click({ force: true });
  }
  // The schema editor's sized wrapper (.lte-advanced-flex) is the element under
  // test — wait for it to mount before measuring.
  await expect(
    page.locator(".lte-advanced-flex").first(),
    "Advanced (schema) editor did not mount after switching tabs"
  ).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(300);
}

test.describe("Reflow: Loot Table Visual Editor @reflow", () => {
  test("editor keeps a nonzero usable height with the status area expanded", async ({ page }, testInfo) => {
    testInfo.setTimeout(120000);
    setupConsoleTracking(page);

    const entered = await enterEditor(page);
    if (!entered) {
      test.skip(true, "Could not enter editor — skipping reflow test");
      return;
    }

    const opened = await openLootTableEditor(page, testInfo.project.name);
    if (!opened) {
      test.skip(true, "Could not open a loot table in the editor — skipping reflow test");
      return;
    }

    // Expand the status area — this adds the largest chrome offset (190px on
    // top of the 86px base), the exact condition under which an unconditional
    // viewport pin drives calc(100vh - offset) negative at 320×256. Hard
    // precondition: without it this test regresses a softer layout.
    await expandStatusArea(page);

    await page.screenshot({
      path: `debugoutput/screenshots/reflow-loot-table-expanded-status-${testInfo.project.name}.png`,
      fullPage: true,
    });

    const metrics = await page.evaluate(() => {
      const container = document.querySelector(".ltve-container");
      const content = document.querySelector(".ltve-content");
      if (!container || !content) {
        return null;
      }
      return {
        containerHeight: container.getBoundingClientRect().height,
        contentHeight: content.getBoundingClientRect().height,
        viewportHeight: window.innerHeight,
      };
    });

    expect(metrics, "loot table editor container/content not found after opening").not.toBeNull();
    if (metrics) {
      // With the unconditional pin, calc(100vh - 276px) clamps the container
      // (and its flex:1 content area) to zero height at 320×256. The editor
      // must instead retain a usable band: the tab bar (~30px) plus a nonzero
      // content region.
      expect(
        metrics.containerHeight,
        `editor container is ${Math.round(metrics.containerHeight)}px tall in a ${metrics.viewportHeight}px viewport`
      ).toBeGreaterThan(40);
      expect(metrics.contentHeight, "editor content area has collapsed to zero height").toBeGreaterThan(0);
    }
  });

  test("content stays reachable via an explicit scroll container at narrow and wide-but-short viewports", async ({
    page,
  }, testInfo) => {
    testInfo.setTimeout(120000);
    setupConsoleTracking(page);

    const entered = await enterEditor(page);
    if (!entered) {
      test.skip(true, "Could not enter editor — skipping reflow test");
      return;
    }

    const opened = await openLootTableEditor(page, `reachable-${testInfo.project.name}`);
    if (!opened) {
      test.skip(true, "Could not open a loot table in the editor — skipping reflow test");
      return;
    }

    // Expand the status area so the chrome offsets are at their worst-case
    // maximum — the condition under which the viewport pin is disabled and
    // the editor grows past the visible band. Hard precondition (see
    // expandStatusArea): a silently-skipped expansion would let this pass
    // against a layout the bug never affected.
    await expandStatusArea(page);

    // Project viewport (320×256 for reflow-400pct, 640×512 for reflow-200pct).
    await assertEditorReachable(page, `${testInfo.project.name} default viewport`);

    // Wide-but-short: width keeps the desktop column layout while the height
    // disables the viewport pin — the clipping regression is identical, but
    // through .pe-col3and4 instead of the collapsed single-column grid.
    await page.setViewportSize({ width: 1280, height: 400 });
    await page.waitForTimeout(600);
    await page.screenshot({
      path: `debugoutput/screenshots/reflow-loot-table-wide-short-${testInfo.project.name}.png`,
      fullPage: true,
    });
    await assertEditorReachable(page, "1280×400 wide-but-short");
  });

  test("Advanced tab keeps a nonzero usable height with the status area expanded", async ({ page }, testInfo) => {
    testInfo.setTimeout(120000);
    setupConsoleTracking(page);

    const entered = await enterEditor(page);
    if (!entered) {
      test.skip(true, "Could not enter editor — skipping reflow test");
      return;
    }

    const opened = await openLootTableEditor(page, `advanced-${testInfo.project.name}`);
    if (!opened) {
      test.skip(true, "Could not open a loot table in the editor — skipping reflow test");
      return;
    }

    // Advanced hosts LootTableEditor, which receives heightOffset + 36 and used
    // to apply calc(100vh - offset) unconditionally — at 320×256 with the status
    // area expanded that drives the schema form to zero height, which the outer
    // scrolling cannot recover. Switch to Advanced, then expand the status area
    // (largest chrome offset — the worst case for the pin).
    await switchToAdvancedTab(page);
    await expandStatusArea(page);

    await page.screenshot({
      path: `debugoutput/screenshots/reflow-loot-table-advanced-expanded-${testInfo.project.name}.png`,
      fullPage: true,
    });

    const metrics = await page.evaluate(() => {
      const container = document.querySelector(".ltve-container");
      const advancedFlex = document.querySelector(".lte-advanced-flex");
      if (!container || !advancedFlex) {
        return null;
      }
      return {
        containerHeight: container.getBoundingClientRect().height,
        advancedFlexHeight: advancedFlex.getBoundingClientRect().height,
        viewportHeight: window.innerHeight,
      };
    });

    expect(metrics, "Advanced loot table editor container/flex not found after switching tabs").not.toBeNull();
    if (metrics) {
      // The decisive regression check: with the unconditional pin, calc(100vh -
      // (heightOffset + 36)) clamps the schema form's FlexBox to zero height at
      // 320×256 with status expanded. Reflow-gating must instead let it grow
      // with its content.
      expect(
        metrics.advancedFlexHeight,
        `Advanced schema form is ${Math.round(metrics.advancedFlexHeight)}px tall in a ` +
          `${metrics.viewportHeight}px viewport — the viewport pin collapsed it`
      ).toBeGreaterThan(0);
      // The wrapper must also retain a usable band (tab bar + nonzero content),
      // not merely a hairline.
      expect(
        metrics.containerHeight,
        `editor container is ${Math.round(metrics.containerHeight)}px tall in a ${metrics.viewportHeight}px viewport`
      ).toBeGreaterThan(40);
    }

    // And the grown Advanced content must be reachable through a scroll
    // container (the .pe-col* editor column) rather than clipped by the
    // overflow:hidden project grid.
    await assertEditorReachable(page, `${testInfo.project.name} Advanced tab`);
  });
});
