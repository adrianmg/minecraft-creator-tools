/**
 * ImageEditorEditToggle.spec.ts
 *
 * Regression test for the Image Editor mode toggle placement.
 *
 * Bug: the "Edit image" toggle in ImageManager floated over the top-left
 * corner of the content area. That is fine while previewing, but once the
 * ImageEditor toolbar rendered underneath it the floating button sat on top
 * of the toolbar's first tool (Undo), so clicking Undo could hit the toggle
 * instead and drop the user out of edit mode.
 *
 * Fix: while editing, ImageManager hands the toggle to the editor toolbar
 * (ImageEditor `toolbarEndContent`) where it renders as a "Preview" button at
 * the trailing end of the row, and no floating button is rendered.
 *
 * Repro flow this test exercises:
 *   1. Create an Add-On Starter project.
 *   2. Open `pack_icon.png` to surface the Image Editor.
 *   3. Click the Edit image toggle.
 *   4. Assert the Undo button is not covered by anything else at its center,
 *      the toggle does not intersect any toolbar tool, and the toggle sits at
 *      the trailing end of the toolbar.
 *   5. Click the toggle and assert the editor returns to preview mode.
 */

import { test, expect, ConsoleMessage } from "@playwright/test";
import { enterEditor, enableAllFileTypes, processMessage } from "./WebTestUtilities";

const DIR = "debugoutput/screenshots/image-editor-edit-toggle";

interface IBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

function intersects(a: IBox, b: IBox): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

test.describe("Image Editor edit toggle placement @full", () => {
  const consoleErrors: { url: string; error: string }[] = [];
  const consoleWarnings: { url: string; error: string }[] = [];

  test.beforeEach(async ({ page }) => {
    consoleErrors.length = 0;
    consoleWarnings.length = 0;
    page.on("console", (msg: ConsoleMessage) => {
      processMessage(msg, page, consoleErrors, consoleWarnings);
    });
  });

  test("edit toggle does not overlap the Undo button in edit mode", async ({ page }, testInfo) => {
    testInfo.setTimeout(90000);

    const ok = await enterEditor(page, { theme: "dark", editMode: "full" });
    test.skip(!ok, "Could not enter editor");

    await enableAllFileTypes(page);
    await page.waitForTimeout(500);

    // The Add-On Starter project ships pack_icon.png files, listed by basename
    // under a collapsible "Icons" section in @full mode.
    const pngSelector = "text=/^(pack_icon|.*\\.png)$/i";
    let png = page.locator(pngSelector).first();

    if (!(await png.isVisible({ timeout: 1500 }).catch(() => false))) {
      for (const label of ["Icons", "Textures"]) {
        const row = page.locator(`text=${label}`).first();
        if (!(await row.isVisible({ timeout: 1000 }).catch(() => false))) continue;
        await row.click({ force: true }).catch(() => undefined);
        await page.waitForTimeout(300);
        png = page.locator(pngSelector).first();
        if (await png.isVisible({ timeout: 1500 }).catch(() => false)) break;
      }
    }

    expect(
      await png.isVisible({ timeout: 1500 }).catch(() => false),
      "Could not surface any *.png item in the project sidebar to open the Image Editor"
    ).toBe(true);
    await png.dblclick();
    await page.waitForTimeout(2000);

    const editToggle = page.getByRole("button", { name: /edit image/i }).first();
    await expect(editToggle, "ImageManager should show an 'Edit image' toggle while previewing").toBeVisible({
      timeout: 5000,
    });
    await editToggle.click();
    await page.waitForTimeout(1000);

    await page.screenshot({ path: `${DIR}/01-edit-mode.png`, fullPage: false });

    const undoButton = page.getByRole("button", { name: /^undo$/i }).first();
    await expect(undoButton, "Undo button should be visible in the image editor toolbar").toBeVisible({
      timeout: 5000,
    });

    // While editing, the floating toggle must be gone and replaced by the
    // toolbar's Preview button.
    await expect(page.getByRole("button", { name: /edit image/i })).toHaveCount(0);
    const previewToggle = page.getByRole("button", { name: /preview image/i }).first();
    await expect(previewToggle, "Editor toolbar should show the 'Preview image' toggle").toBeVisible({
      timeout: 5000,
    });

    // The user-visible symptom: clicking the middle of Undo hit the toggle.
    const undoBox = (await undoButton.boundingBox()) as IBox | null;
    expect(undoBox, "Undo button should have a bounding box").not.toBeNull();

    const hitUndo = await page.evaluate(
      ([x, y]) => {
        const el = document.elementFromPoint(x, y);
        const button = el ? (el.closest("button") as HTMLButtonElement | null) : null;
        return button ? (button.getAttribute("aria-label") || button.textContent || "").trim() : "";
      },
      [undoBox!.x + undoBox!.width / 2, undoBox!.y + undoBox!.height / 2]
    );
    expect(hitUndo, "The element at the center of the Undo button should be the Undo button itself").toMatch(/undo/i);

    // The toggle must not intersect any toolbar tool, and it must sit to the
    // right of them all (trailing end of the toolbar).
    const toggleBox = (await previewToggle.boundingBox()) as IBox | null;
    expect(toggleBox, "Preview toggle should have a bounding box").not.toBeNull();

    const toolbar = page.locator(".ie-toolBar").first();
    const toolbarBox = (await toolbar.boundingBox()) as IBox | null;
    expect(toolbarBox, "Image editor toolbar should have a bounding box").not.toBeNull();
    expect(intersects(toggleBox!, toolbarBox!), "Preview toggle should be laid out inside the toolbar").toBe(true);

    const toolButtons = toolbar.locator(".MuiStack-root button");
    const toolCount = await toolButtons.count();
    expect(toolCount).toBeGreaterThan(0);

    let rightmostToolEdge = 0;
    for (let i = 0; i < toolCount; i++) {
      const box = (await toolButtons.nth(i).boundingBox()) as IBox | null;
      if (!box) continue;
      const name = (await toolButtons.nth(i).getAttribute("aria-label")) || (await toolButtons.nth(i).textContent());
      expect(intersects(toggleBox!, box), `Preview toggle should not overlap toolbar tool '${name?.trim()}'`).toBe(
        false
      );
      rightmostToolEdge = Math.max(rightmostToolEdge, box.x + box.width);
    }
    expect(toggleBox!.x, "Preview toggle should sit after the last editing tool").toBeGreaterThanOrEqual(
      rightmostToolEdge
    );

    // And the toggle still works: it returns to preview mode.
    await previewToggle.click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${DIR}/02-back-to-preview.png`, fullPage: false });

    await expect(page.getByRole("button", { name: /edit image/i }).first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole("button", { name: /^undo$/i })).toHaveCount(0);
  });
});
