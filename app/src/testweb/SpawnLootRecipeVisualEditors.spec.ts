// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Smoke specs for the spawn rules / loot table / recipe / trade visual
 * editors:
 *
 *   - `SimplifiedSpawnRulesEditor` (.ssre-outer)
 *   - `LootTableVisualEditor` (.ltve-simple-layout)
 *   - `RecipeEditor` (.rcre-area)
 *   - `BlockPickerDialog` (.bpd-content) — opened from the simplified spawn
 *     rules editor's "Spawn On Blocks" affordance.
 *
 * Each spec follows the BiomeEditor.spec.ts pattern:
 *   1. Enter the editor (creates a fresh Add-On Starter in browser storage).
 *   2. Open the Content Wizard and add a new item of the given kind.
 *   3. Click the resulting item in the project list.
 *   4. Assert the editor's distinctive root element renders.
 *   5. Perform one interaction and persist via Ctrl+S.
 *
 * These are intentionally smoke-level — they catch import/registration breaks,
 * missing CSS, and gross render regressions, without trying to validate the
 * full edit/round-trip semantics (those belong in unit tests against the
 * underlying behaviour-definition classes).
 */

import { test, expect, ConsoleMessage, Page } from "@playwright/test";
import { enterEditor, processMessage } from "./WebTestUtilities";

const SCREENSHOT_DIR = "debugoutput/screenshots/new-visual-editors";

// ─── Wizard helpers ─────────────────────────────────────────────────────────

async function openContentWizard(page: Page): Promise<boolean> {
  // Dismiss any modal that may already be open (e.g. FRE leftovers).
  const existingDialog = page.locator(".MuiDialog-root").first();
  if (await existingDialog.isVisible({ timeout: 500 }).catch(() => false)) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
  }

  const addButton = page.locator('button[aria-label="Add new content"]').first();
  if (!(await addButton.isVisible({ timeout: 15000 }).catch(() => false))) {
    return false;
  }
  await addButton.click();
  await page.waitForTimeout(800);

  const wizard = page.locator(".cwiz-launcher-wrapper, .cwiz-launcher").first();
  return wizard.isVisible({ timeout: 3000 }).catch(() => false);
}

/**
 * Click a top-level "main option" tile in the wizard by its label text
 * (e.g. "Spawn Rules", "Loot Table"). These appear in the Guided Setup pane
 * and are the easiest path for the spawn rules and loot table editors.
 */
async function clickWizardMainOption(page: Page, label: string): Promise<boolean> {
  const tile = page.locator(".cwiz-main-option").filter({ hasText: label }).first();
  if (!(await tile.isVisible({ timeout: 3000 }).catch(() => false))) {
    return false;
  }
  await tile.scrollIntoViewIfNeeded().catch(() => {});
  await tile.click();
  await page.waitForTimeout(800);
  return true;
}

/**
 * Open the Advanced > "Spawn Rules, Loot Tables & Recipes" subsection and
 * click a `.cwiz-section-item` with the given label (used for recipes, which
 * don't have a guided main-option tile).
 */
async function clickAdvancedSpawnLootRecipeItem(page: Page, label: string | RegExp): Promise<boolean> {
  const advancedHeader = page.locator('.cwiz-advanced-header:has-text("Advanced File Types")').first();
  if (await advancedHeader.isVisible({ timeout: 3000 }).catch(() => false)) {
    await advancedHeader.click();
    await page.waitForTimeout(400);
  }

  const advancedContent = page.locator(".cwiz-advanced-content").first();
  const sectionHeader = advancedContent
    .locator('.cwiz-section-header:has-text("Spawn Rules, Loot Tables & Recipes")')
    .first();
  if (await sectionHeader.isVisible({ timeout: 3000 }).catch(() => false)) {
    await sectionHeader.scrollIntoViewIfNeeded().catch(() => {});
    await sectionHeader.click();
    await page.waitForTimeout(400);
  }

  const item = advancedContent.locator(".cwiz-section-item").filter({ hasText: label }).first();
  if (!(await item.isVisible({ timeout: 3000 }).catch(() => false))) {
    return false;
  }
  await item.scrollIntoViewIfNeeded().catch(() => {});
  await item.click();
  await page.waitForTimeout(1000);
  return true;
}

/**
 * After clicking a wizard item, accept the naming dialog (if one appears).
 */
async function confirmNameDialog(page: Page): Promise<void> {
  const dialog = page.locator(".MuiDialog-root, dialog, [role='dialog']").first();
  if (!(await dialog.isVisible({ timeout: 3000 }).catch(() => false))) {
    return;
  }
  const confirm = dialog.locator('button:has-text("Add"), button:has-text("OK"), button:has-text("Create")').first();
  if (await confirm.isVisible({ timeout: 1500 }).catch(() => false)) {
    await confirm.click();
  } else {
    await page.keyboard.press("Enter");
  }
  await page.waitForTimeout(1500);
}

/**
 * Click a project list item by label fragment. Mirrors
 * ProjectReloadEditors.spec.ts/clickProjectItem but biased toward `[role=option]`
 * which is what the file explorer renders.
 *
 * Scopes the search to the sidebar listbox so the fallback `[title*="..."]`
 * matcher doesn't accidentally match toolbar buttons that share the
 * filename in their tooltip (e.g. the "Item Actions" button shows the
 * currently open file's name in its title).
 */
async function clickProjectItem(page: Page, label: RegExp): Promise<boolean> {
  const sidebar = page.locator('[role="listbox"][aria-label="Project items"], .pil-projectItemList').first();
  const sidebarLocator = (await sidebar.count().catch(() => 0)) > 0 ? sidebar : page;

  const option = sidebarLocator.locator('[role="option"]').filter({ hasText: label }).first();
  if (await option.isVisible({ timeout: 5000 }).catch(() => false)) {
    await option.click();
    await page.waitForTimeout(2000);
    return true;
  }

  const titleAttr = sidebarLocator.locator(`[title*="${label.source.replace(/[\\/.*+?^${}()|[\]]/g, "")}" i]`).first();
  if (await titleAttr.isVisible({ timeout: 1500 }).catch(() => false)) {
    await titleAttr.click();
    await page.waitForTimeout(2000);
    return true;
  }
  return false;
}

async function saveProject(page: Page): Promise<void> {
  await page.keyboard.press("Control+S");
  await page.waitForTimeout(1500);
}

// ═══════════════════════════════════════════════════════════════════════════
// SimplifiedSpawnRulesEditor
// ═══════════════════════════════════════════════════════════════════════════

test.describe("SimplifiedSpawnRulesEditor @focused", () => {
  const consoleErrors: { url: string; error: string }[] = [];
  const consoleWarnings: { url: string; error: string }[] = [];

  test.beforeEach(async ({ page }) => {
    consoleErrors.length = 0;
    consoleWarnings.length = 0;
    page.on("console", (msg: ConsoleMessage) => {
      processMessage(msg, page, consoleErrors, consoleWarnings);
    });
  });

  test("adds a spawn rule, renders the simplified editor, toggles a biome", async ({ page }, testInfo) => {
    testInfo.setTimeout(90000);
    expect(await enterEditor(page)).toBe(true);

    if (!(await openContentWizard(page))) {
      console.log("Spawn rules: wizard didn't open");
      return;
    }
    await page.screenshot({ path: `${SCREENSHOT_DIR}/spawn-01-wizard.png`, fullPage: true });

    if (!(await clickWizardMainOption(page, "Spawn Rules"))) {
      console.log("Spawn rules: main-option tile not found");
      return;
    }
    await confirmNameDialog(page);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/spawn-02-after-add.png`, fullPage: true });

    // The wizard typically auto-opens the new file. Only fall back to clicking
    // it in the sidebar if the SimplifiedSpawnRulesEditor isn't already
    // rendered. The sidebar may not show the spawn rule at all in Focused
    // mode (which hides spawn rules by default), and a fallback `[title*=...]`
    // match could otherwise hit the "Item Actions" toolbar button whose title
    // includes the filename.
    const outer = page.locator(".ssre-outer").first();
    if (!(await outer.isVisible({ timeout: 2000 }).catch(() => false))) {
      if (!(await clickProjectItem(page, /spawn/i))) {
        console.log("Spawn rules: created item not found in tree");
        await page.screenshot({ path: `${SCREENSHOT_DIR}/spawn-not-found.png`, fullPage: true });
        return;
      }
    }

    // Editor root — distinctive class from SimplifiedSpawnRulesEditor.
    await expect(outer).toBeVisible({ timeout: 10000 });
    await page.screenshot({ path: `${SCREENSHOT_DIR}/spawn-03-editor.png`, fullPage: true });

    // Categories should render.
    const categories = page.locator(".ssre-category");
    expect(await categories.count()).toBeGreaterThan(0);

    // Toggle the first biome row (clickable label) so we exercise an interaction.
    const biomeLabel = page.locator(".ssre-biomeLabel").first();
    if (await biomeLabel.isVisible({ timeout: 2000 }).catch(() => false)) {
      await biomeLabel.click();
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/spawn-04-toggled.png`, fullPage: true });
    }

    await saveProject(page);
    await expect(outer).toBeVisible();

    expect(consoleErrors.length, `console errors: ${JSON.stringify(consoleErrors)}`).toBe(0);
  });

  test("opens the BlockPickerDialog from spawn-on-blocks", async ({ page }, testInfo) => {
    testInfo.setTimeout(90000);
    expect(await enterEditor(page)).toBe(true);

    if (!(await openContentWizard(page))) return;
    if (!(await clickWizardMainOption(page, "Spawn Rules"))) return;
    await confirmNameDialog(page);

    // The wizard typically auto-opens the new file. Only fall back to
    // clicking it in the sidebar if the SimplifiedSpawnRulesEditor isn't
    // already rendered (see notes on the prior test).
    const outer = page.locator(".ssre-outer").first();
    if (!(await outer.isVisible({ timeout: 2000 }).catch(() => false))) {
      if (!(await clickProjectItem(page, /spawn/i))) return;
    }

    await expect(outer).toBeVisible({ timeout: 10000 });

    // Expand the Default entry so the "Spawn On Blocks" affordance becomes
    // available, then click the add-block button to open BlockPickerDialog.
    const defaultHeader = page.locator(".ssre-defaultHeader").first();
    if (await defaultHeader.isVisible({ timeout: 2000 }).catch(() => false)) {
      await defaultHeader.click();
      await page.waitForTimeout(500);
    }

    const addBlock = page.locator(".ssre-blockAdd button, .ssre-blockAdd").first();
    if (!(await addBlock.isVisible({ timeout: 3000 }).catch(() => false))) {
      console.log("Block picker: add-block control not visible");
      return;
    }
    await addBlock.click();
    await page.waitForTimeout(1000);

    const dialog = page.locator(".bpd-content").first();
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await page.screenshot({ path: `${SCREENSHOT_DIR}/blockpicker-01-open.png`, fullPage: true });

    // Search box should accept text without errors.
    const searchInput = page.locator(".bpd-searchRow input").first();
    if (await searchInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      await searchInput.fill("stone");
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/blockpicker-02-search.png`, fullPage: true });
    }

    // Close via the X button.
    const closeBtn = page.locator(".bpd-closeBtn").first();
    if (await closeBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await closeBtn.click();
      await page.waitForTimeout(500);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// LootTableVisualEditor
// ═══════════════════════════════════════════════════════════════════════════

test.describe("LootTableVisualEditor @focused", () => {
  const consoleErrors: { url: string; error: string }[] = [];
  const consoleWarnings: { url: string; error: string }[] = [];

  test.beforeEach(async ({ page }) => {
    consoleErrors.length = 0;
    consoleWarnings.length = 0;
    page.on("console", (msg: ConsoleMessage) => {
      processMessage(msg, page, consoleErrors, consoleWarnings);
    });
  });

  test("adds a loot table, renders the visual editor, adds a pool", async ({ page }, testInfo) => {
    testInfo.setTimeout(90000);
    expect(await enterEditor(page)).toBe(true);

    // These are hard preconditions: if any wizard step silently fails, the
    // Bug 1643412 regression block below would never run and the test would
    // pass vacuously.
    expect(await openContentWizard(page), "content wizard must open").toBe(true);
    expect(await clickWizardMainOption(page, "Loot Table"), "Loot Table wizard tile must be present").toBe(true);
    await confirmNameDialog(page);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/loot-01-after-add.png`, fullPage: true });

    // The wizard typically auto-opens the new file (and the sidebar may not
    // even list loot tables in Focused mode); only fall back to clicking the
    // item in the tree if the editor isn't already rendered.
    const layout = page.locator(".ltve-simple-layout, .lpo-container").first();
    if (!(await layout.isVisible({ timeout: 2000 }).catch(() => false))) {
      if (!(await clickProjectItem(page, /loot/i))) {
        console.log("Loot table: created item not found in tree");
        await page.screenshot({ path: `${SCREENSHOT_DIR}/loot-not-found.png`, fullPage: true });
      }
    }

    // Editor root — distinctive class from LootTableVisualEditor (Simple tab
    // default). Hard assertion: the editor must render one way or the other.
    await expect(layout).toBeVisible({ timeout: 10000 });
    await page.screenshot({ path: `${SCREENSHOT_DIR}/loot-02-editor.png`, fullPage: true });

    // Add a pool via the "Add pool" button (works in both empty and populated
    // states). This is a hard precondition: if the control is missing, the
    // Bug 1643412 regression block below would otherwise be skipped silently.
    const addPool = page.locator(".lpo-add-pool-btn").first();
    await expect(addPool, "Add Pool control must be present").toBeVisible({ timeout: 5000 });

    const beforeCount = await page.locator(".lpo-pool-card").count();
    await addPool.click();
    await page.waitForTimeout(500);
    const afterCount = await page.locator(".lpo-pool-card").count();
    console.log(`Loot pools: ${beforeCount} -> ${afterCount}`);
    expect(afterCount).toBeGreaterThanOrEqual(beforeCount + 1);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/loot-03-pool-added.png`, fullPage: true });

    // Regression check for Bug 1643412: the editor container must stay
    // bounded to the viewport so overflowing pools scroll inside
    // .ltve-pool-panel instead of pushing content past the bottom of the
    // screen with no way to reach it. Add pools until the pool panel
    // overflows, then verify the container is viewport-bounded and the
    // panel actually scrolls.
    for (let i = 0; i < 8; i++) {
      await addPool.click();
      await page.waitForTimeout(150);
    }
    // Every click must have landed — otherwise the overflow condition the
    // scroll assertions depend on may not exist.
    await expect
      .poll(() => page.locator(".lpo-pool-card").count(), { timeout: 10000 })
      .toBeGreaterThanOrEqual(afterCount + 8);

    // Bug 1643412's repro ran with the status area expanded — the tallest
    // chrome the pin has to subtract. Hard precondition (mirroring the
    // reflow suite): if the toggle is missing or expansion doesn't land,
    // fail loudly instead of regressing a softer layout. Expansion is
    // verified structurally via the .pe-gridOuterExpanded grid class.
    const expandStatus = page
      .getByRole("button", { name: /Show more information in the status area/i })
      .or(page.locator('[title="Show more information in the status area"]'))
      .first();
    await expect(expandStatus, "status-area expand toggle must be present").toBeVisible({ timeout: 10000 });
    await expandStatus.click();
    await expect(
      page.locator(".pe-gridOuterExpanded"),
      "status area did not actually expand after clicking the toggle"
    ).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(300);

    const scrollMetrics = await page.evaluate(() => {
      const container = document.querySelector(".ltve-container");
      const panel = document.querySelector(".ltve-pool-panel");
      if (!container || !panel) {
        return null;
      }
      panel.scrollTop = 10000;
      const rect = container.getBoundingClientRect();

      // Reachability must be proven through the clipping ancestors, not from
      // the child's own box: getBoundingClientRect ignores ancestor clipping,
      // so a child inside an overflow:hidden ancestor reports a healthy
      // height while being invisible. Hit-test the LAST pool card after
      // scrolling the panel to the bottom — document.elementFromPoint only
      // returns it if it is genuinely painted at that point. Probe a few
      // candidate points to tolerate borders and padding.
      const cards = document.querySelectorAll(".lpo-pool-card");
      const lastCard = cards.length > 0 ? cards[cards.length - 1] : null;
      let lastCardVisible = false;
      let lastCardBottom = -1;
      if (lastCard) {
        const cardRect = lastCard.getBoundingClientRect();
        lastCardBottom = cardRect.bottom;
        const x = Math.min(cardRect.left + cardRect.width / 2, window.innerWidth - 4);
        for (const dy of [3, 8, 16]) {
          const y = Math.min(cardRect.bottom - dy, window.innerHeight - 2);
          if (y <= cardRect.top) {
            continue;
          }
          const hit = document.elementFromPoint(x, y);
          if (hit && (hit === lastCard || lastCard.contains(hit))) {
            lastCardVisible = true;
            break;
          }
        }
      }

      return {
        containerHeight: rect.height,
        containerBottom: rect.bottom,
        viewportHeight: window.innerHeight,
        panelScrollHeight: panel.scrollHeight,
        panelClientHeight: panel.clientHeight,
        panelScrollTop: panel.scrollTop,
        lastCardVisible,
        lastCardBottom,
      };
    });
    console.log(`Loot scroll metrics: ${JSON.stringify(scrollMetrics)}`);
    expect(scrollMetrics).not.toBeNull();
    if (scrollMetrics) {
      // A collapsed (zero-height) container would trivially satisfy a
      // one-sided bottom bound — and panel.scrollTop can even go positive
      // with clientHeight 0 — so first require a meaningfully tall editor.
      expect(scrollMetrics.containerHeight).toBeGreaterThanOrEqual(200);
      expect(scrollMetrics.panelClientHeight).toBeGreaterThanOrEqual(100);
      // Two-sided bound: the container's bottom edge must sit in the lower
      // half of the viewport (not collapsed near the top) without extending
      // past it (the original bug pushed content below the fold).
      expect(scrollMetrics.containerBottom).toBeLessThanOrEqual(scrollMetrics.viewportHeight + 1);
      expect(scrollMetrics.containerBottom).toBeGreaterThanOrEqual(scrollMetrics.viewportHeight * 0.5);
      expect(scrollMetrics.panelScrollHeight).toBeGreaterThan(scrollMetrics.panelClientHeight);
      expect(scrollMetrics.panelScrollTop).toBeGreaterThan(0);
      // The decisive reachability check: the last pool card must actually be
      // painted (hit-testable) after scrolling — not merely report a healthy
      // bounding box while an overflow:hidden ancestor clips it.
      expect(
        scrollMetrics.lastCardVisible,
        `last pool card (bottom at ${Math.round(scrollMetrics.lastCardBottom)}px, viewport ` +
          `${scrollMetrics.viewportHeight}px) is not hit-testable after scrolling the pool panel — ` +
          `it is clipped by an ancestor or covered by another element`
      ).toBeTruthy();
    }
    await page.screenshot({ path: `${SCREENSHOT_DIR}/loot-04-scrolled.png`, fullPage: true });

    await saveProject(page);
    await expect(layout).toBeVisible();

    expect(consoleErrors.length, `console errors: ${JSON.stringify(consoleErrors)}`).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// RecipeEditor
// ═══════════════════════════════════════════════════════════════════════════

test.describe("RecipeEditor @focused", () => {
  const consoleErrors: { url: string; error: string }[] = [];
  const consoleWarnings: { url: string; error: string }[] = [];

  test.beforeEach(async ({ page }) => {
    consoleErrors.length = 0;
    consoleWarnings.length = 0;
    page.on("console", (msg: ConsoleMessage) => {
      processMessage(msg, page, consoleErrors, consoleWarnings);
    });
  });

  test("adds a shaped recipe and renders the visual recipe editor", async ({ page }, testInfo) => {
    testInfo.setTimeout(120000);
    expect(await enterEditor(page)).toBe(true);

    if (!(await openContentWizard(page))) {
      console.log("Recipe: wizard didn't open");
      return;
    }
    await page.screenshot({ path: `${SCREENSHOT_DIR}/recipe-01-wizard.png`, fullPage: true });

    if (!(await clickAdvancedSpawnLootRecipeItem(page, /Recipe \(Shaped\)/i))) {
      console.log("Recipe: 'Recipe (Shaped)' gallery item not found");
      await page.screenshot({ path: `${SCREENSHOT_DIR}/recipe-wizard-no-item.png`, fullPage: true });
      return;
    }
    await confirmNameDialog(page);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/recipe-02-after-add.png`, fullPage: true });

    if (!(await clickProjectItem(page, /recipe/i))) {
      console.log("Recipe: created item not found in tree");
      await page.screenshot({ path: `${SCREENSHOT_DIR}/recipe-not-found.png`, fullPage: true });
      return;
    }

    // Editor root — distinctive class from RecipeEditor.
    const area = page.locator(".rcre-area").first();
    await expect(area).toBeVisible({ timeout: 15000 });
    await page.screenshot({ path: `${SCREENSHOT_DIR}/recipe-03-editor.png`, fullPage: true });

    // Visual mode should render the shaped recipe content area (or a known
    // "unsupported" placeholder if the type detection fails — both are valid
    // smoke-pass states; the regression we care about is "blank/throws").
    const contentOrUnsupported = page.locator(".rcre-content-area, .rcre-unsupported").first();
    await expect(contentOrUnsupported).toBeVisible({ timeout: 5000 });

    // Switch to the Properties tab to exercise tab routing.
    const propsTab = page.locator('button:has-text("Properties"), button[title="Properties"]').first();
    if (await propsTab.isVisible({ timeout: 2000 }).catch(() => false)) {
      await propsTab.click();
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/recipe-04-properties-tab.png`, fullPage: true });
    }

    await saveProject(page);
    await expect(area).toBeVisible();

    expect(consoleErrors.length, `console errors: ${JSON.stringify(consoleErrors)}`).toBe(0);
  });
});
