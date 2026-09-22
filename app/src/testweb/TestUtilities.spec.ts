import { expect, test } from "@playwright/test";
import { selectProjectItem } from "../testshared/TestUtilities";

test.describe("TestUtilities project-item selection", () => {
  test("applies partial text matching to tree items", async ({ page }) => {
    await page.setContent(`
      <div role="tree">
        <div role="treeitem" aria-selected="false">Properties</div>
        <div role="treeitem" aria-label="File entry" aria-selected="false">manifest metadata</div>
      </div>
    `);

    const treeItems = page.locator("[role='treeitem']");
    await treeItems.evaluateAll((items) => {
      items.forEach((item) => {
        item.addEventListener("click", () => {
          items.forEach((candidate) => candidate.setAttribute("aria-selected", "false"));
          item.setAttribute("aria-selected", "true");
        });
      });
    });

    const selected = await selectProjectItem(page, "manifest");

    expect(selected).toBe(true);
    await expect(treeItems.nth(0)).toHaveAttribute("aria-selected", "false");
    await expect(treeItems.nth(1)).toHaveAttribute("aria-selected", "true");
  });
});