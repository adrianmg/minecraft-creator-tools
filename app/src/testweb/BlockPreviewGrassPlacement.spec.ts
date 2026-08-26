// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Regression spec for Bug 1633420: clicking the "Solid Cube Dice Block"
 * (basicdieblock) block type and then switching to a custom-geometry block
 * (e.g., "Crate Starter Block") made the second block render at y=0 — inside
 * the dirt/grass slab of the preview — so it "disappeared under the grass".
 *
 * Root cause: BlockTypeOverviewPanel reuses the same ModelViewer instance for
 * every block the user clicks. The unit-cube dice preview loads via
 * loadFromDirectData (skipVanillaResources=true, empty volume, model at y=0);
 * the crate preview loads via loadFromModelItem (grass-filled volume, model
 * expected at y=2). loadFromModelItem did not reset skipVanillaResources, so
 * the stale flag from the dice made render() keep y=0 for the crate.
 *
 * The test asserts the model placement through the `data-model-y` attribute
 * ModelViewer exposes on its 3D-area wrapper: "0" for the platform-based
 * unit-cube preview, "2" (on top of the grass) for grass-slab previews.
 *
 * NOTE: "New Block Based on Existing" templates download their files from the
 * microsoft/minecraft-samples GitHub repo, so this spec needs outbound network
 * access (same class of dependency as CatEntityPreview.spec.ts). Like that
 * spec, it is intentionally NOT tagged @focused: the core CI suite
 * (playwright-core.config.js) runs on restricted-network runners where the
 * template download cannot be relied on, and the first test on a cold Vite
 * server can also time out before the editor UI finishes loading. Run it via
 * the full suite (npm run test-web) or directly by filename.
 */

import { test, expect, ConsoleMessage, Page } from "@playwright/test";
import { enterEditor, processMessage } from "./WebTestUtilities";

const SCREENSHOT_DIR = "debugoutput/screenshots/block-preview-grass";

test.setTimeout(180000);

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

/**
 * From the open Content Wizard, run the "New Block Based on Existing" flow and
 * pick the gallery tile whose title matches `tileTitle`, then confirm Add.
 */
async function createBlockFromGallery(page: Page, tileTitle: string | RegExp): Promise<boolean> {
  const quickAction = page.locator('.cwiz-main-option:has-text("New Block Based on Existing")').first();
  if (!(await quickAction.isVisible({ timeout: 5000 }).catch(() => false))) {
    console.log("createBlockFromGallery: 'New Block Based on Existing' tile not found");
    return false;
  }
  await quickAction.scrollIntoViewIfNeeded().catch(() => {});
  await quickAction.click();
  await page.waitForTimeout(800);

  const dialog = page.locator(".MuiDialog-root, dialog, [role='dialog']").first();
  await expect(dialog).toBeVisible({ timeout: 5000 });

  // Gallery items load asynchronously from gallery.json.
  const anyTile = dialog.locator(".itbi-outer").first();
  await expect(anyTile).toBeVisible({ timeout: 15000 });

  const tile = dialog
    .locator(".itbi-outer")
    .filter({ has: page.locator(".itbi-title", { hasText: tileTitle }) })
    .first();
  if (!(await tile.isVisible({ timeout: 2000 }).catch(() => false))) {
    // The gallery may need scrolling to reveal the tile.
    await tile.scrollIntoViewIfNeeded().catch(() => {});
  }
  if (!(await tile.isVisible({ timeout: 3000 }).catch(() => false))) {
    const titles = await dialog.locator(".itbi-title").allTextContents();
    console.log(`createBlockFromGallery: tile "${tileTitle}" not found. Available: ${titles.join(", ")}`);
    return false;
  }
  await tile.click();
  await page.waitForTimeout(400);

  const addButton = dialog.locator('button:has-text("Add"), button:has-text("OK"), button:has-text("Create")').first();
  if (await addButton.isVisible({ timeout: 2000 }).catch(() => false)) {
    await addButton.click();
  } else {
    await page.keyboard.press("Enter");
  }

  // Template files download from GitHub; give the project a moment to settle.
  await page.waitForTimeout(4000);
  return true;
}

/** Click a block item in the project sidebar by label fragment. */
async function clickSidebarItem(page: Page, label: RegExp): Promise<boolean> {
  // The focused-mode explorer renders items as treeitems; other layouts use a
  // listbox of options. Try both.
  const treeItem = page.getByRole("treeitem", { name: label }).first();
  if (await treeItem.isVisible({ timeout: 5000 }).catch(() => false)) {
    await treeItem.click();
    await page.waitForTimeout(1500);
    return true;
  }

  const sidebar = page.locator('[role="listbox"][aria-label="Project items"], .pil-projectItemList').first();
  const scope = (await sidebar.count().catch(() => 0)) > 0 ? sidebar : page;

  const option = scope.locator('[role="option"]').filter({ hasText: label }).first();
  if (await option.isVisible({ timeout: 5000 }).catch(() => false)) {
    await option.click();
    await page.waitForTimeout(1500);
    return true;
  }
  return false;
}

/**
 * Read the block preview's data-model-y attribute once it appears, or null if
 * the 3D preview didn't render within the timeout (e.g., the texture/geometry
 * relationship chain hasn't been indexed yet, which shows a placeholder).
 */
async function readModelY(page: Page, timeoutMs: number): Promise<string | null> {
  const area = page.locator("[data-model-y]").first();
  const visible = await area.isVisible({ timeout: timeoutMs }).catch(() => false);
  if (!visible) {
    return null;
  }
  return area.getAttribute("data-model-y");
}

/**
 * Open `target` in the sidebar and wait for its 3D preview. The overview
 * panel resolves textures from asynchronously-built project relationships and
 * only reloads when the selected item changes, so if the preview shows the
 * "needs a texture" placeholder, bounce through `other` and back to force a
 * reload, retrying a few times.
 */
async function openBlockPreview(page: Page, target: RegExp, other: RegExp, label: string): Promise<string | null> {
  let modelY: string | null = null;

  for (let attempt = 0; attempt < 4 && modelY === null; attempt++) {
    if (attempt > 0) {
      console.log(`${label}: no 3D preview yet, bouncing selection (attempt ${attempt + 1})`);
      await clickSidebarItem(page, other);
      await page.waitForTimeout(2000);
    }
    expect(await clickSidebarItem(page, target), `${label}: block must appear in the sidebar`).toBe(true);
    modelY = await readModelY(page, 15000);
  }

  return modelY;
}

/**
 * Requires the user-visible renderer to be up: the VolumeEditor loading
 * overlay gone and the 3D canvas present. The data-model-y attribute is
 * computed by ModelViewer and attached to its outer wrapper before the inner
 * VolumeEditor renders, so a placement assertion on its own can pass while
 * the child is permanently stuck on "Loading definitions..." (e.g., a child
 * retained across a skipVanillaResources mode flip, which never loads the
 * vanilla definitions the non-skip render path requires). Placement is only
 * meaningful once the renderer is actually on screen.
 */
async function assertPreviewRendered(page: Page, label: string): Promise<void> {
  const loadingOverlay = page.locator(".ve-loading-overlay").first();
  await expect(loadingOverlay, `${label}: must not stay on the 'Loading definitions...' overlay`).toBeHidden({
    timeout: 20000,
  });
  const canvas = page.locator(".ve-canvas-wrapper canvas").first();
  await expect(canvas, `${label}: must render its 3D canvas`).toBeVisible({ timeout: 20000 });
}

test.describe("Block preview grass placement", () => {
  const consoleErrors: { url: string; error: string }[] = [];
  const consoleWarnings: { url: string; error: string }[] = [];

  test.beforeEach(async ({ page }) => {
    consoleErrors.length = 0;
    consoleWarnings.length = 0;
    page.on("console", (msg: ConsoleMessage) => {
      processMessage(msg, page, consoleErrors, consoleWarnings);
    });
    // Template files download from GitHub at creation time; surface any
    // network failures in the test log to make missing-asset issues obvious.
    page.on("requestfailed", (req) => {
      console.log(`[requestfailed] ${req.url()} — ${req.failure()?.errorText}`);
    });
    page.on("response", (res) => {
      if (res.status() >= 400 && !res.url().startsWith("data:")) {
        console.log(`[http ${res.status()}] ${res.url()}`);
      }
    });
  });

  test("custom-geometry block stays on top of the grass after viewing a unit-cube block", async ({ page }) => {
    // Full mode, matching the bug repro video — in Focused mode the crate's
    // texture-relationship chain doesn't resolve and the preview shows the
    // "needs a texture" placeholder instead of the 3D view.
    expect(await enterEditor(page, { editMode: "full" })).toBe(true);

    // Create the custom-geometry crate block first, then the unit-cube dice
    // block. The Bug 1633420 repro only requires the VIEWING order (dice, then
    // crate); creating the crate first sidesteps an unrelated gallery-import
    // issue where a block's terrain_texture.json entries don't merge into a
    // pre-existing file, which would leave the crate texture unresolved and
    // its preview stuck on the "needs a texture" placeholder.
    expect(await openContentWizard(page), "content wizard must open (crate)").toBe(true);
    expect(await createBlockFromGallery(page, /Crate Starter Block/i), "crate block must be created").toBe(true);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/01-crate-created.png`, fullPage: true });

    expect(await openContentWizard(page), "content wizard must open (dice)").toBe(true);
    expect(await createBlockFromGallery(page, /Solid Cube Dice Block/i), "dice block must be created").toBe(true);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/02-die-created.png`, fullPage: true });

    // Save so relationship indexing (block json → terrain_texture → texture)
    // has a chance to complete before the previews resolve textures.
    await page.keyboard.press("Control+S");
    await page.waitForTimeout(3000);

    // Repro: view the dice block first...
    // The unit-cube preview uses the empty-volume platform path: model at y=0.
    const dieY = await openBlockPreview(page, /dieblock/i, /crate/i, "dice block preview");
    await page.screenshot({ path: `${SCREENSHOT_DIR}/03-die-preview.png`, fullPage: true });
    expect(dieY, "dice block preview must expose a model placement").not.toBeNull();
    // Renderer first, placement second: the attribute alone can read correctly
    // while the child is stuck loading. Re-read placement after the canvas is
    // up so the assertion is bound to what the user actually sees.
    await assertPreviewRendered(page, "dice block preview");
    expect(await readModelY(page, 2000), "dice block preview should render its model at y=0").toBe("0");

    // ...then switch to the crate. Its grass-slab preview must place the model
    // at y=2 (on top of the grass). With the regression, the stale
    // skipVanillaResources flag from the dice kept it at y=0 — buried. Every
    // bounce inside the helper goes die → crate, which is exactly the repro
    // sequence; with the bug present the attribute reads "0" on the first
    // attempt, so the retry loop exits immediately and the assertion fails.
    const crateY = await openBlockPreview(page, /crate/i, /dieblock/i, "crate block preview");
    console.log(`console errors so far: ${JSON.stringify(consoleErrors)}`);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/04-crate-preview-after-die.png`, fullPage: true });

    if (crateY === null) {
      // Diagnostic: list stored project files mentioning crate/terrain/die so a
      // missing-download vs missing-relationship failure is distinguishable.
      const storedKeys = await page.evaluate(async () => {
        const dbs = (await indexedDB.databases()) || [];
        const found: string[] = [];
        for (const dbInfo of dbs) {
          if (!dbInfo.name) continue;
          const db = await new Promise<IDBDatabase | null>((resolve) => {
            const req = indexedDB.open(dbInfo.name as string);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => resolve(null);
          });
          if (!db) continue;
          for (const storeName of Array.from(db.objectStoreNames)) {
            try {
              const keys = await new Promise<IDBValidKey[]>((resolve) => {
                const tx = db.transaction(storeName, "readonly");
                const req = tx.objectStore(storeName).getAllKeys();
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => resolve([]);
              });
              for (const k of keys) {
                const ks = String(k);
                if (/crate|terrain|die|blocks\.json/i.test(ks)) {
                  found.push(`${dbInfo.name}/${storeName}: ${ks}`);
                }
              }
            } catch {
              // ignore stores we can't read
            }
          }
          db.close();
        }
        return found;
      });
      console.log(`stored keys mentioning crate/terrain/die:\n${storedKeys.join("\n")}`);
    }

    expect(crateY, "crate block preview must expose a model placement").not.toBeNull();

    // Renderer first, placement second (see assertPreviewRendered): the
    // die→crate switch flips VolumeEditor from skip mode to vanilla mode, the
    // exact transition where a retained child hangs on the loading overlay
    // while the wrapper attribute already reads "2". ModelViewer keys
    // VolumeEditor by resource mode to force a remount; prove the overlay
    // clears and the canvas renders, then assert placement from that state.
    await assertPreviewRendered(page, "crate preview after die→crate switch");
    await page.screenshot({ path: `${SCREENSHOT_DIR}/05-crate-canvas-rendered.png`, fullPage: true });
    expect(await readModelY(page, 2000), "crate block preview after viewing dice should sit on the grass (y=2)").toBe(
      "2"
    );
  });
});
