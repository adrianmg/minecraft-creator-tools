// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Regression spec for Bug 1660628: viewing a Rabbit-template entity type made
 * other entity type previews render the RABBIT model under their own texture.
 *
 * Root cause: the rabbit gallery template's project relations are incomplete
 * (its client entity references geometry the copied files don't define), so
 * its preview resolves through the VANILLA fallback, which stores
 * state.transformedGeometry. _loadEntityFromProject (the path other entities
 * use) then set the new model WITHOUT clearing transformedGeometry, and
 * VolumeEditor prefers customGeometry (= transformedGeometry) over the fresh
 * model — rabbit shape, cow/pig texture, until the project was reloaded.
 *
 * The spec drives the real repro (create rabbit + cow from the gallery, view
 * rabbit, then view cow) and asserts the EFFECTIVE rendered geometry via the
 * data-geometry-id attribute ModelViewer stamps on its 3D area — which mirrors
 * VolumeEditor's customGeometry-over-model precedence, exactly the state the
 * bug corrupted.
 *
 * NOTE: gallery mob templates download from mojang/bedrock-samples on GitHub,
 * so this spec needs outbound network access (same class of dependency as
 * CatEntityPreview.spec.ts).
 *
 * Because of that network dependency this describe is intentionally NOT tagged
 * @focused: @focused routes tests into the required core Playwright suite
 * (playwright-core.config.js), where a restricted runner, rate limit, or GitHub
 * outage would fail required CI independently of product behavior. Left
 * untagged it runs in the default (non-required) suite, matching
 * CatEntityPreview.spec.ts. Do not add @focused back without local fixtures.
 */

import { test, expect, Page } from "@playwright/test";
import { enterEditor } from "./WebTestUtilities";

const SCREENSHOT_DIR = "debugoutput/screenshots/bug1660628";

test.setTimeout(240000);

async function openContentWizard(page: Page): Promise<boolean> {
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

async function clickMobFromMinecraft(page: Page): Promise<boolean> {
  const quickAction = page
    .locator(
      '.cwiz-main-option:has-text("Start from a Minecraft Mob"), .cwiz-main-option:has-text("Mob from Minecraft"), .cwiz-main-option:has-text("Mob"), .cwiz-main-option:has-text("Entity")'
    )
    .first();
  if (!(await quickAction.isVisible({ timeout: 5000 }).catch(() => false))) {
    const labels = await page.locator(".cwiz-main-option").allTextContents();
    console.log(`clickMobFromMinecraft: quick action not found. Options: ${labels.join(" | ")}`);
    return false;
  }
  await quickAction.click();
  await page.waitForTimeout(600);
  return true;
}

async function selectGalleryMob(page: Page, title: string): Promise<boolean> {
  const dialog = page.locator(".MuiDialog-root, dialog, [role='dialog']").first();
  await expect(dialog).toBeVisible({ timeout: 5000 });
  const anyTile = dialog.locator(".itbi-outer").first();
  await expect(anyTile).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(500);

  const found = await dialog.evaluate((el: Element, mobTitle: string) => {
    const titles = el.querySelectorAll(".itbi-title");
    for (const t of titles) {
      if (t.textContent?.toLowerCase().trim() === mobTitle.toLowerCase()) {
        const outer = t.closest(".itbi-outer");
        if (outer) {
          outer.scrollIntoView({ block: "center" });
          (outer as HTMLElement).click();
          return true;
        }
      }
    }
    return false;
  }, title);
  await page.waitForTimeout(500);
  if (!found) {
    const titles = await dialog.locator(".itbi-title").allTextContents();
    console.log(`selectGalleryMob: "${title}" not found. Available: ${titles.join(", ")}`);
  }
  return found;
}

async function confirmAddDialog(page: Page): Promise<void> {
  const dialog = page.locator(".MuiDialog-root, dialog, [role='dialog']").first();
  if (!(await dialog.isVisible({ timeout: 3000 }).catch(() => false))) {
    return;
  }
  const addButton = dialog.locator('button:has-text("Add")').first();
  if (await addButton.isVisible({ timeout: 2000 }).catch(() => false)) {
    await addButton.click();
  } else {
    await page.keyboard.press("Enter");
  }
  await page.waitForTimeout(2000);
}

async function createMobFromGallery(page: Page, title: string): Promise<void> {
  expect(await openContentWizard(page), `wizard must open for ${title}`).toBe(true);
  expect(await clickMobFromMinecraft(page), `mob quick action for ${title}`).toBe(true);
  expect(await selectGalleryMob(page, title), `${title} tile must be present`).toBe(true);
  await confirmAddDialog(page);
  // Template files copy + relations settle
  await page.waitForTimeout(4000);
}

/**
 * Open an entity's overview via the sidebar and return the effective rendered
 * geometry id (data-geometry-id on ModelViewer's 3D area).
 *
 * EntityTypeOverviewPanel keeps the SAME ModelViewer — canvas and
 * data-geometry-id element included — mounted while entityTypeId changes, so
 * right after navigation the canvas is already visible and the attribute
 * still holds the PREVIOUS entity's geometry until the async load commits.
 * Canvas visibility plus elapsed time therefore proves nothing; instead poll
 * the attribute until it names the destination entity. All callers navigate
 * to entities whose geometry ids contain the entity name (geometry.cow.v2,
 * geometry.rabbit.v2, geometry.cat). On a regression that leaves stale
 * geometry in place, the poll times out and fails the test instead of
 * intermittently reading the previous entity's value.
 */
async function openEntityOverviewAndReadGeometry(page: Page, name: RegExp, shot: string): Promise<string | null> {
  const treeItem = page.getByRole("treeitem", { name }).first();
  if (await treeItem.isVisible({ timeout: 3000 }).catch(() => false)) {
    await treeItem.click();
  } else {
    const sidebar = page.locator('[role="listbox"][aria-label="Project items"], .pil-projectItemList').first();
    const scope = (await sidebar.count().catch(() => 0)) > 0 ? sidebar : page;
    const option = scope.locator('[role="option"]').filter({ hasText: name }).first();
    await expect(option, `entity ${name} must be in sidebar`).toBeVisible({ timeout: 10000 });
    await option.click();
  }
  await page.waitForTimeout(1000);

  const overviewTab = page.locator('button:has-text("Overview")').first();
  if (await overviewTab.isVisible({ timeout: 2000 }).catch(() => false)) {
    await overviewTab.click();
  }

  const canvas = page.locator(".etop-modelViewer canvas, .etop-modelSection canvas, .mov-area canvas").first();
  await expect(canvas, `3D canvas must render for ${name}`).toBeVisible({ timeout: 30000 });

  const area = page.locator("[data-geometry-id]").first();
  await expect
    .poll(() => area.getAttribute("data-geometry-id"), {
      message: `data-geometry-id must settle on a ${name} geometry (stale value means the async load never committed)`,
      timeout: 30000,
    })
    .toMatch(name);

  await page.screenshot({ path: `${SCREENSHOT_DIR}/${shot}.png`, fullPage: true });
  return area.getAttribute("data-geometry-id");
}

/**
 * Read the effective rendered texture path (data-texture-path on ModelViewer's
 * 3D area). ModelViewer stamps the Minecraft texture path whose bytes it
 * resolved for the selected variant — the value reflects what is actually
 * painted on the model, not just what the variant picker claims.
 */
async function readEffectiveTexturePath(page: Page): Promise<string | null> {
  const area = page.locator("[data-geometry-id]").first();
  await expect(area, "3D area must be stamped").toBeVisible({ timeout: 10000 });
  return area.getAttribute("data-texture-path");
}

/**
 * Count the texture-variant picker(s) rendered in the entity overview's
 * ModelViewer. Mirrors the selector CatEntityPreview.spec.ts uses. A
 * multi-variant entity (e.g., cat) renders exactly one; a vanilla-fallback
 * entity must render none.
 */
async function variantPickerCount(page: Page): Promise<number> {
  return page
    .locator(".etop-modelViewer .MuiSelect-select, .etop-modelSection .MuiSelect-select, .mov-area .MuiSelect-select")
    .count();
}

test.describe("Entity preview model bleed (Bug 1660628)", () => {
  test("cow preview keeps the cow model after viewing the rabbit", async ({ page }) => {
    expect(await enterEditor(page)).toBe(true);
    await page.waitForTimeout(1000);

    await createMobFromGallery(page, "Rabbit");
    await page.waitForTimeout(3000);
    await createMobFromGallery(page, "Cow");
    await page.waitForTimeout(3000);

    // Baseline: the cow (auto-opened after creation, but navigate explicitly
    // for determinism) must render a cow geometry.
    const cowBefore = await openEntityOverviewAndReadGeometry(page, /cow/i, "01-cow-baseline");
    console.log(`cow geometry before viewing rabbit: ${cowBefore}`);
    expect(cowBefore, "cow baseline preview must render a cow geometry").toMatch(/cow/i);

    // Poisoning step: view the rabbit. Its incomplete project relations make
    // it resolve through the vanilla fallback, which sets transformedGeometry.
    const rabbitGeo = await openEntityOverviewAndReadGeometry(page, /rabbit/i, "02-rabbit");
    console.log(`rabbit geometry: ${rabbitGeo}`);
    expect(rabbitGeo, "rabbit preview must render a rabbit geometry").toMatch(/rabbit/i);

    // Regression: the cow must STILL render a cow geometry — with the bug, the
    // stale rabbit transformedGeometry won over the cow model and this reads
    // "geometry.rabbit.v2" while the texture stays the cow's.
    const cowAfter = await openEntityOverviewAndReadGeometry(page, /cow/i, "03-cow-after-rabbit");
    console.log(`cow geometry after viewing rabbit: ${cowAfter}`);
    expect(cowAfter, "cow preview after viewing rabbit must not render the rabbit model").not.toMatch(/rabbit/i);
    expect(cowAfter, "cow preview after viewing rabbit must render a cow geometry").toMatch(/cow/i);
  });

  test("vanilla-fallback preview clears the variant picker left by a multi-variant entity", async ({ page }) => {
    expect(await enterEditor(page)).toBe(true);
    await page.waitForTimeout(1000);

    // Cat is the canonical multi-variant entity: its project relations resolve
    // through _loadEntityFromProject, which populates textureVariants /
    // entityResourceDef and renders the texture-variant picker.
    await createMobFromGallery(page, "Cat");
    await page.waitForTimeout(3000);
    // Rabbit's incomplete gallery relations force the VANILLA fallback path —
    // the path that (before the fix) failed to clear the variant context.
    await createMobFromGallery(page, "Rabbit");
    await page.waitForTimeout(3000);

    // Viewing the cat must show the multi-variant picker.
    await openEntityOverviewAndReadGeometry(page, /cat/i, "04-cat-variants");
    await expect.poll(() => variantPickerCount(page), { timeout: 15000 }).toBeGreaterThan(0);

    // Switching to the rabbit (vanilla fallback) must leave NO picker behind.
    // With the bug, the cat's textureVariants / selectedTextureVariant /
    // entityResourceDef leaked in: the stale picker stayed visible and
    // selecting it resolved the cat's resource definition, painting a cat
    // texture onto the rabbit. The fix clears all variant context on the
    // vanilla path.
    const rabbitGeo = await openEntityOverviewAndReadGeometry(page, /rabbit/i, "05-rabbit-after-cat");
    console.log(`rabbit geometry after viewing cat: ${rabbitGeo}`);
    expect(rabbitGeo, "rabbit preview must render a rabbit geometry").toMatch(/rabbit/i);
    await expect.poll(() => variantPickerCount(page), { timeout: 15000 }).toBe(0);
  });

  /**
   * Regression for the geometry/texture variant-pairing follow-up: the cow's
   * client entity declares default/warm/cold geometry AND texture variants, and
   * the gallery import's child-item order ends in a non-default variant
   * (cow_warm). _loadEntityFromProject used to keep the LAST texture child, so
   * the primary (default) geometry rendered under the warm texture while the
   * picker reported the default variant. Geometry and texture are now resolved
   * together from getMatchedGeometryAndTexture(selectedVariant); this asserts
   * the initially rendered PAIR is the default one.
   */
  test("cow initial preview pairs the default geometry with the default texture", async ({ page }) => {
    expect(await enterEditor(page)).toBe(true);
    await page.waitForTimeout(1000);

    await createMobFromGallery(page, "Cow");
    await page.waitForTimeout(3000);

    const cowGeo = await openEntityOverviewAndReadGeometry(page, /cow/i, "06-cow-variant-pairing");
    console.log(`cow effective geometry: ${cowGeo}`);
    expect(cowGeo, "cow preview must render a cow geometry").toMatch(/cow/i);
    expect(cowGeo, "cow preview must render the PRIMARY (default) geometry, not a climate variant").not.toMatch(
      /warm|cold|baby/i
    );

    const cowTexture = await readEffectiveTexturePath(page);
    console.log(`cow effective texture path: ${cowTexture}`);
    expect(cowTexture, "cow preview must resolve a texture by variant key").toBeTruthy();
    expect(cowTexture, "cow preview texture must belong to the cow").toMatch(/cow/i);
    expect(
      cowTexture,
      "cow preview must initially render the DEFAULT texture, not the last-listed variant (e.g., cow_warm)"
    ).not.toMatch(/warm|cold|baby/i);

    // The cow is multi-variant, so the picker must be present and must report
    // the default variant — matching the rendered pair asserted above.
    await expect.poll(() => variantPickerCount(page), { timeout: 15000 }).toBeGreaterThan(0);
    const pickerText = await page
      .locator(".etop-modelViewer .MuiSelect-select, .etop-modelSection .MuiSelect-select, .mov-area .MuiSelect-select")
      .first()
      .textContent();
    console.log(`cow variant picker shows: ${pickerText}`);
    expect(pickerText, "picker must report the default variant").toMatch(/default/i);
  });
});
