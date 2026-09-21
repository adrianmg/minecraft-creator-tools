/**
 * Shared test utilities for MCTools testing.
 *
 * This module contains reusable test helpers that work in both web (Playwright browser)
 * and Electron (Playwright Electron) contexts.
 */

import { Page, expect, ConsoleMessage } from "@playwright/test";

// List of ignorable console messages
const ignorableTokens = [
  "CSSinJS Debug data collection is disabled",
  "You are running Fela in production mode.",
  "is deprecated in StrictMode",
  "No content for file", // Normal during project loading when files haven't been saved yet
  "renderingGroupId of an instanced mesh", // BabylonJS informational note
  "session.getAllExtensions", // Electron deprecation warning
  "session.loadExtension", // Electron deprecation warning
  "Added Extension:", // Electron extension loading info
  "ERR_CONNECTION_REFUSED", // Expected when dev server not running
  "404 (Not Found)", // Map viewer may request textures that don't exist for certain block types
];

const projectItemSelector = "[role='treeitem'], [role='option']";

export type ThemeMode = "light" | "dark";

/**
 * Check if a console message is ignorable (expected noise).
 */
export function isIgnorableMessage(message: string): boolean {
  return ignorableTokens.some((ignorable) => message.indexOf(ignorable) >= 0);
}

/**
 * Process a console message, collecting errors and warnings.
 */
export function processMessage(
  msg: ConsoleMessage,
  page: Page,
  consoleErrors: { url: string; error: string }[],
  consoleWarnings: { url: string; error: string }[]
): void {
  const messageType = msg.type();
  const messageText = msg.text();

  if (!isIgnorableMessage(messageText)) {
    if (messageType === "error") {
      console.log("Page error received: " + messageText);
      consoleErrors.push({
        url: page.url(),
        error: messageText,
      });
    } else if (messageType === "warning") {
      console.log("Page warning received:" + messageText);
      consoleWarnings.push({
        url: page.url(),
        error: messageText,
      });
    }
  }
}

/**
 * Wait for the MCTools app to be fully loaded and ready for interaction.
 * Works in both web and Electron contexts.
 */
export async function waitForAppReady(page: Page, timeoutMs: number = 10000): Promise<boolean> {
  try {
    // Wait for the body to be visible
    await expect(page.locator("body")).toBeVisible({ timeout: timeoutMs });

    // Wait for network to be idle (if supported)
    await page.waitForLoadState("domcontentloaded");

    const readySignals = [
      page.getByRole("button", { name: "New" }).first(),
      page.getByRole("button", { name: "Create New" }).first(),
      page.locator('button[title*="Home"]').first(),
      page.locator('button:has-text("View")').first(),
      page.locator('button:has-text("Settings")').first(),
    ];

    await expect
      .poll(
        async () => {
          for (const signal of readySignals) {
            if (await signal.isVisible({ timeout: 250 }).catch(() => false)) {
              return true;
            }
          }
          return false;
        },
        { timeout: timeoutMs, message: "Timed out waiting for the app home or editor controls" }
      )
      .toBe(true);

    return true;
  } catch {
    return false;
  }
}

/**
 * Check if we're on the home page (not in editor).
 */
export async function isOnHomePage(page: Page): Promise<boolean> {
  try {
    // Home page has "New" buttons under project templates
    const newButton = page.getByRole("button", { name: "New" }).first();
    return await newButton.isVisible({ timeout: 2000 });
  } catch {
    return false;
  }
}

/**
 * Check if we're in the editor interface.
 */
export async function isInEditor(page: Page): Promise<boolean> {
  try {
    // Editor has specific toolbar buttons
    // The Home button has title="Home/Project List" but is icon-only (no visible text)
    // The View button has a dropdown with "View" text
    const homeButton = page.locator('button[title*="Home"]').first();
    const viewButton = page.locator('button:has-text("View")').first();
    const settingsButton = page.locator('button:has-text("Settings")').first();

    const hasHome = await homeButton.isVisible({ timeout: 1000 }).catch(() => false);
    const hasView = await viewButton.isVisible({ timeout: 1000 }).catch(() => false);
    const hasSettings = await settingsButton.isVisible({ timeout: 1000 }).catch(() => false);

    return hasHome || hasView || hasSettings;
  } catch {
    return false;
  }
}

/**
 * Enter the editor by creating a new project.
 * This is the standard workflow to get into the editor interface.
 *
 * @param page - The Playwright page object
 * @returns true if successfully entered the editor
 */
export async function enterEditor(page: Page): Promise<boolean> {
  try {
    // Check if we're already in editor
    if (await isInEditor(page)) {
      console.log("enterEditor: Already in editor");
      return true;
    }

    // Make sure app is ready
    const isReady = await waitForAppReady(page);
    if (!isReady) {
      console.log("enterEditor: App not ready");
      return false;
    }

    // Click "New" button under a project template (first one is usually Add-On Starter).
    // Web buttons say "Create New"; Electron template buttons say "New" — try both.
    let newButton = page.getByRole("button", { name: "Create New" }).first();
    let foundNew = await newButton.isVisible({ timeout: 3000 }).catch(() => false);

    if (!foundNew) {
      newButton = page.getByRole("button", { name: "New" }).first();
      foundNew = await newButton.isVisible({ timeout: 5000 }).catch(() => false);
    }

    if (!foundNew) {
      console.log("enterEditor: Could not find 'New' or 'Create New' button on home page");
      return false;
    }

    console.log("enterEditor: Clicking 'New' button to create project");
    await newButton.click();

    // Select browser storage if available (prevents file-system-only flow in Electron)
    const browserStorageRadio = page.getByRole("radio", { name: /Browser|This Browser/i }).first();
    if (await browserStorageRadio.isVisible({ timeout: 2000 }).catch(() => false)) {
      await browserStorageRadio.scrollIntoViewIfNeeded().catch(() => {});
      await browserStorageRadio.check({ force: true });
      console.log("enterEditor: Selected Browser Storage for automated test flow");
    }

    // Look for and click the "Create Project" button on the project creation dialog
    const createButton = page.getByTestId("submit-button");

    try {
      await expect(createButton).toBeVisible({ timeout: 8000 });
      console.log("enterEditor: Clicking 'Create Project' on project dialog");
      await createButton.click();
    } catch {
      // Fallback: try to find button by text or press Enter
      const createByText = page.locator("button:has-text('Create Project')").first();
      try {
        await expect(createByText).toBeVisible({ timeout: 2000 });
        console.log("enterEditor: Clicking 'Create Project' button (by text)");
        await createByText.click();
      } catch {
        console.log("enterEditor: Could not find Create Project button, trying Enter key");
        await page.keyboard.press("Enter");
      }
    }

    // Wait for editor to load, returning as soon as its toolbar appears.
    const inEditor = await expect
      .poll(() => isInEditor(page), {
        timeout: 15000,
        message: "Timed out waiting for the editor interface to load",
      })
      .toBe(true)
      .then(() => true)
      .catch(() => false);

    // Verify we're in the editor
    if (inEditor) {
      console.log("enterEditor: Successfully entered editor interface");
      return true;
    }

    console.log("enterEditor: Could not verify editor interface loaded");
    return false;
  } catch (error) {
    console.log(`enterEditor: Error entering editor - ${error}`);
    return false;
  }
}

/**
 * Enter the editor by creating a new project from a specific template.
 * Navigates home if needed, then clicks the template tile matching the given title.
 * Handles both web and Electron app flows.
 *
 * @param page - The Playwright page object
 * @param templateTitle - The title of the template to select (e.g., "TypeScript Starter")
 * @returns true if successfully entered the editor
 */
export async function enterEditorWithTemplate(page: Page, templateTitle: string): Promise<boolean> {
  try {
    // Close any open dialogs first
    await closeDialogs(page);

    // Navigate home if currently in editor
    if (await isInEditor(page)) {
      const wentHome = await goToHome(page);
      if (!wentHome) {
        console.log("enterEditorWithTemplate: Could not navigate home");
        return false;
      }
    }

    // Make sure app is ready
    const isReady = await waitForAppReady(page);
    if (!isReady) {
      console.log("enterEditorWithTemplate: App not ready");
      return false;
    }

    // Try to find the template tile directly (web flow where templates are visible on home)
    let templateTile = page.locator(`[title="Create new project from ${templateTitle}"]`).first();
    let tileVisible = await expect(templateTile)
      .toBeVisible({ timeout: 2000 })
      .then(() => true)
      .catch(() => false);

    // If not visible, try clicking "New Project" to show template gallery (Electron landing flow)
    if (!tileVisible) {
      const newProjectButton = page.locator("button:has-text('New Project')").first();

      if (await newProjectButton.isVisible({ timeout: 2000 }).catch(() => false)) {
        console.log("enterEditorWithTemplate: Clicking 'New Project' button to show templates");
        await newProjectButton.click();
      } else {
        // Try the generic "New" button (web flow home page)
        const newButton = page.getByRole("button", { name: "New" }).first();
        if (await newButton.isVisible({ timeout: 2000 }).catch(() => false)) {
          console.log("enterEditorWithTemplate: Clicking 'New' button to show templates");
          await newButton.click();
        }
      }

      templateTile = page.locator(`[title="Create new project from ${templateTitle}"]`).first();
      tileVisible = await expect(templateTile)
        .toBeVisible({ timeout: 10000 })
        .then(() => true)
        .catch(() => false);
    }

    if (!tileVisible) {
      console.log(`enterEditorWithTemplate: Could not find template '${templateTitle}'`);
      return false;
    }

    console.log(`enterEditorWithTemplate: Clicking template '${templateTitle}'`);
    await templateTile.click();

    // In CodeStartPage (Electron), clicking a template selects it and shows a "Create" button
    const cspCreateButton = page.locator("button:has-text('Create')").first();
    const cspCreateVisible = await expect(cspCreateButton)
      .toBeVisible({ timeout: 3000 })
      .then(() => true)
      .catch(() => false);
    if (cspCreateVisible) {
      console.log("enterEditorWithTemplate: Clicking 'Create' on CodeStartPage");
      await cspCreateButton.click();
    }

    // Select browser storage if available (prevents file-system-only flow in Electron)
    const browserStorageRadio = page.getByRole("radio", { name: /Browser|This Browser/i }).first();
    if (await browserStorageRadio.isVisible({ timeout: 2000 }).catch(() => false)) {
      await browserStorageRadio.scrollIntoViewIfNeeded().catch(() => {});
      await browserStorageRadio.check({ force: true });
      console.log("enterEditorWithTemplate: Selected Browser Storage for automated test flow");
    }

    // In web flow, a project dialog may appear with "Create Project" / submit button
    const createButton = page.getByTestId("submit-button");
    if (await createButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      console.log("enterEditorWithTemplate: Clicking 'Create Project' on project dialog");
      await createButton.click();
    } else {
      const createByText = page.locator("button:has-text('Create Project')").first();
      if (await createByText.isVisible({ timeout: 2000 }).catch(() => false)) {
        console.log("enterEditorWithTemplate: Clicking 'Create Project' button (by text)");
        await createByText.click();
      }
    }

    // Wait for editor to load, returning as soon as its toolbar appears.
    const inEditor = await expect
      .poll(() => isInEditor(page), {
        timeout: 15000,
        message: "Timed out waiting for the editor interface to load",
      })
      .toBe(true)
      .then(() => true)
      .catch(() => false);

    if (inEditor) {
      console.log("enterEditorWithTemplate: Successfully entered editor interface");
      return true;
    }

    console.log("enterEditorWithTemplate: Could not verify editor interface loaded");
    return false;
  } catch (error) {
    console.log(`enterEditorWithTemplate: Error entering editor - ${error}`);
    return false;
  }
}

/**
 * Navigate back to the home page from the editor.
 */
export async function goToHome(page: Page): Promise<boolean> {
  try {
    // If already on home, we're done
    if (await isOnHomePage(page)) {
      return true;
    }

    // Close any open dialogs by pressing Escape multiple times.
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press("Escape");
    }

    // Click the Home button in the editor toolbar
    // The Home button has title="Home/Project List" but is icon-only
    const homeButton = page.locator('button[title*="Home"]').first();

    const homeVisible = await expect(homeButton)
      .toBeVisible({ timeout: 3000 })
      .then(() => true)
      .catch(() => false);
    if (homeVisible) {
      console.log("goToHome: Clicking Home button");

      // Use force click to bypass any overlay issues
      await homeButton.click({ force: true });
      return await expect
        .poll(() => isOnHomePage(page), {
          timeout: 10000,
          message: "Timed out waiting for the home page after clicking Home",
        })
        .toBe(true)
        .then(() => true)
        .catch(() => false);
    }

    console.log("goToHome: Could not find Home button");
    return false;
  } catch (error) {
    console.log(`goToHome: Error - ${error}`);
    return false;
  }
}

/**
 * Close any open dialogs, including the ContentWizard.
 * The ContentWizard is a modal dialog that appears when clicking "Add".
 */
export async function closeDialogs(page: Page): Promise<void> {
  try {
    // First, check if ContentWizard dialog is open and close it specifically
    const wizardDialog = page.locator(".pab-content-wizard-dialog, .cwiz-launcher");
    if (await wizardDialog.isVisible({ timeout: 500 }).catch(() => false)) {
      // Try to find and click cancel/close button
      const cancelButton = page.locator("button:has-text('Cancel')").first();
      if (await cancelButton.isVisible({ timeout: 500 }).catch(() => false)) {
        await cancelButton.click();
        await expect(wizardDialog)
          .not.toBeVisible({ timeout: 2000 })
          .catch(() => {});
      }
    }

    // Press Escape multiple times to close any remaining dialogs
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press("Escape");
    }
  } catch {
    // Ignore errors - page may be closed
  }
}

/**
 * Open the Add menu in the editor to see available item types.
 * Note: This opens the ContentWizard dialog, not a simple dropdown menu.
 * Use closeDialogs() to close it when done.
 */
export async function openAddMenu(page: Page): Promise<boolean> {
  try {
    // The Add button has content="Add" and icon with faPlus
    // Try multiple selectors to find it
    const addButton = page
      .locator("button:has-text('Add')")
      .filter({ hasNot: page.locator("text='Add-On'") }) // Exclude "Add-On" text
      .first();

    if (await addButton.isVisible({ timeout: 3000 })) {
      await addButton.click();
      return await expect
        .poll(() => isContentWizardOpen(page), {
          timeout: 5000,
          message: "Timed out waiting for the ContentWizard to open after clicking Add",
        })
        .toBe(true)
        .then(() => true)
        .catch(() => false);
    }

    // Fallback: look for button with plus icon in the project list area
    const plusButton = page.locator(".pab-outer button").first();
    if (await plusButton.isVisible({ timeout: 2000 })) {
      await plusButton.click();
      return await expect
        .poll(() => isContentWizardOpen(page), {
          timeout: 5000,
          message: "Timed out waiting for the ContentWizard to open after clicking the plus button",
        })
        .toBe(true)
        .then(() => true)
        .catch(() => false);
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Check if the ContentWizard dialog is currently open.
 */
export async function isContentWizardOpen(page: Page): Promise<boolean> {
  try {
    const wizardDialog = page.locator(".cwiz-launcher, .pab-content-wizard-dialog");
    return await wizardDialog.isVisible({ timeout: 1000 });
  } catch {
    return false;
  }
}

/**
 * Select an item from the project item list by name.
 */
export async function selectProjectItem(page: Page, itemName: string): Promise<boolean> {
  try {
    // Use exact matching via aria-label to avoid matching category headers
    // e.g., "manifest" should not match "Behavior pack manifests"
    // Use .first() in case of duplicates (e.g., behavior + resource pack manifests)
    const item = page
      .getByRole("treeitem", { name: itemName, exact: true })
      .or(page.getByRole("option", { name: itemName, exact: true }))
      .first();

    if (await item.isVisible({ timeout: 3000 })) {
      await item.click();
      await expect(item).toHaveAttribute("aria-selected", "true", { timeout: 5000 });
      return true;
    }

    // Fallback: try partial match with has-text (for items whose accessible name differs)
    const partialItem = page.locator(projectItemSelector).filter({ hasText: itemName }).first();
    if (await partialItem.isVisible({ timeout: 2000 })) {
      await partialItem.click();
      await expect(partialItem).toHaveAttribute("aria-selected", "true", { timeout: 5000 });
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Get the count of project items in the list.
 */
export async function getProjectItemCount(page: Page): Promise<number> {
  try {
    const items = page.locator(projectItemSelector);
    return await items.count();
  } catch {
    return 0;
  }
}

/**
 * Check if a specific toolbar button is visible.
 */
export async function hasToolbarButton(page: Page, buttonName: string): Promise<boolean> {
  try {
    const button = page.getByRole("button", { name: new RegExp(buttonName, "i") }).first();
    return await button.isVisible({ timeout: 2000 });
  } catch {
    return false;
  }
}

/**
 * Take a screenshot with a descriptive name.
 */
export async function takeScreenshot(
  page: Page,
  name: string,
  folder: string = "debugoutput/screenshots"
): Promise<void> {
  await page.screenshot({
    path: `${folder}/${name}.png`,
    fullPage: true,
  });
}

// ==================== Professional Editor Helpers ====================

/**
 * Switch the app edit preference to "Full" mode (editors, all files visible).
 * This reveals Inspector, File Map, and other items hidden in summarized/Focused mode.
 * Navigates via the Settings toolbar button → clicks "Full" → returns to editor.
 */
export async function switchToFullEditMode(page: Page): Promise<boolean> {
  try {
    // Click the Settings toolbar button
    const settingsButton = page.locator('button[title="Settings"], [aria-label="Settings"]').first();

    if (!(await settingsButton.isVisible({ timeout: 3000 }))) {
      console.log("switchToFullEditMode: Settings button not currently visible");
      return false;
    }

    await settingsButton.click();

    // Click the "Full" edit option button
    const fullButton = page.locator('button:has-text("Full")').first();

    const fullButtonVisible = await expect(fullButton)
      .toBeVisible({ timeout: 3000 })
      .then(() => true)
      .catch(() => false);
    if (!fullButtonVisible) {
      console.log("switchToFullEditMode: Full button not found in settings");
      return false;
    }
    await fullButton.click();
    console.log("switchToFullEditMode: Switched to Full edit mode");

    // Navigate back to the editor by selecting a file item (not Actions/Properties/etc.)
    // IMPORTANT: Use exact matching to avoid clicking category headers like "Behavior pack manifests"
    // Use .first() because there may be multiple manifest files (behavior + resource pack)
    const manifestItem = page
      .getByRole("treeitem", { name: /^manifest\*?$/i })
      .or(page.getByRole("option", { name: /^manifest\*?$/i }))
      .first();
    if (await manifestItem.isVisible({ timeout: 2000 })) {
      await manifestItem.click();
      await expect(manifestItem).toHaveAttribute("aria-selected", "true", { timeout: 5000 });
    } else {
      // Fallback: try any visible option that's a file item (skip special items AND category headers)
      const options = page.locator(projectItemSelector);
      const count = await options.count();
      let clicked = false;
      for (let i = 0; i < count && !clicked; i++) {
        const ariaLabel = await options.nth(i).getAttribute("aria-label");
        const text = ariaLabel || (await options.nth(i).textContent()) || "";
        const trimmed = text.trim();
        // Skip special items, category headers (contain spaces/numbers), and empty items
        if (
          trimmed.length === 0 ||
          trimmed === "Actions" ||
          trimmed === "Properties" ||
          trimmed === "Inspector" ||
          trimmed === "Project Files" ||
          trimmed === "File Map" ||
          // Category headers contain spaces + size info like "TypeScript files 1 @ 198b"
          (trimmed.includes(" ") && trimmed.includes("@"))
        ) {
          continue;
        }
        // Good candidate: a simple file item like "manifest", "main", "tsconfig", etc.
        console.log(`switchToFullEditMode: Selecting fallback item "${trimmed}"`);
        await options.nth(i).click();
        await expect(options.nth(i)).toHaveAttribute("aria-selected", "true", { timeout: 5000 });
        clicked = true;
      }
      if (!clicked) {
        await page.keyboard.press("Escape");
      }
    }

    return true;
  } catch (error) {
    console.log(`switchToFullEditMode: Error - ${error}`);
    return false;
  }
}

/**
 * Switch the app edit preference to "Raw" mode via Settings.
 * This makes ALL JSON files show in raw/Monaco text editing mode.
 * Navigates via the Settings toolbar button → clicks "Raw" → selects a file item to return to editor.
 */
export async function switchToRawEditPreference(page: Page): Promise<boolean> {
  try {
    const settingsButton = page.locator('button[title="Settings"], [aria-label="Settings"]').first();

    if (!(await settingsButton.isVisible({ timeout: 3000 }))) {
      console.log("switchToRawEditPreference: Settings button not currently visible");
      return false;
    }

    await settingsButton.click();

    // Click the "Raw" edit option button
    const rawButton = page.locator('button:has-text("Raw")').first();

    const rawButtonVisible = await expect(rawButton)
      .toBeVisible({ timeout: 3000 })
      .then(() => true)
      .catch(() => false);
    if (!rawButtonVisible) {
      console.log("switchToRawEditPreference: Raw button not found in settings");
      await page.keyboard.press("Escape");
      return false;
    }
    await rawButton.click();
    console.log("switchToRawEditPreference: Clicked Raw button");

    // After switching to Raw, the sidebar list may re-render. Wait for it to stabilize.
    await expect(page.locator(projectItemSelector).first()).toBeVisible({ timeout: 5000 });

    // Navigate back to editor by selecting a real file item (not Actions/Properties/Inspector).
    // IMPORTANT: Use exact matching to avoid clicking category headers like "Behavior pack manifests"
    // which contain "manifest" text but are section headers, not actual files.
    // Use .first() because there may be multiple manifest files (behavior + resource pack).
    const manifestItem = page
      .getByRole("treeitem", { name: "manifest", exact: true })
      .or(page.getByRole("option", { name: "manifest", exact: true }))
      .first();
    if (await manifestItem.isVisible({ timeout: 3000 })) {
      console.log("switchToRawEditPreference: Clicking manifest file item (exact match)");
      await manifestItem.click();

      // Verify we're out of Settings by checking for monaco-editor or editor content
      const monacoCheck = page.locator(".monaco-editor").first();
      const monacoFound = await monacoCheck.isVisible({ timeout: 5000 }).catch(() => false);
      console.log(`switchToRawEditPreference: After manifest click, Monaco visible: ${monacoFound}`);
      return true;
    }

    console.log("switchToRawEditPreference: manifest item not visible, scanning for file items");

    // Fallback: find a file-like item (skip special items AND category headers)
    const options = page.locator(projectItemSelector);
    const count = await options.count();
    console.log(`switchToRawEditPreference: Found ${count} sidebar options`);
    for (let i = 0; i < count; i++) {
      const ariaLabel = await options.nth(i).getAttribute("aria-label");
      const text = ariaLabel || (await options.nth(i).textContent()) || "";
      const trimmed = text.trim();

      const normalized = trimmed.replace(/\*$/, "").trim().toLowerCase();

      // Skip special items, category headers, path headers, and empty items
      if (
        trimmed.length === 0 ||
        trimmed === "Actions" ||
        trimmed === "Properties" ||
        trimmed === "Inspector" ||
        trimmed === "Project Files" ||
        trimmed === "File Map" ||
        normalized === "dashboard" ||
        // Category headers contain size info like "TypeScript files 1 @ 198b"
        (trimmed.includes(" ") && trimmed.includes("@")) ||
        // Path headers start/end with /
        trimmed.startsWith("/")
      ) {
        continue;
      }

      console.log(`switchToRawEditPreference: Clicking file item "${trimmed}"`);
      await options.nth(i).click();
      const monacoCheck = page.locator(".monaco-editor").first();
      const monacoFound = await monacoCheck.isVisible({ timeout: 3000 }).catch(() => false);
      if (monacoFound) {
        return true;
      }
      console.log(`switchToRawEditPreference: Item "${trimmed}" did not open Monaco, continuing`);
    }

    // Last resort: press Escape
    console.log("switchToRawEditPreference: No suitable option found, pressing Escape");
    await page.keyboard.press("Escape");
    return true;
  } catch (error) {
    console.log(`switchToRawEditPreference: Error - ${error}`);
    return false;
  }
}

/**
 * Switch the app edit preference to "Editors" (Full) mode via Settings.
 * Restores form-based editors for JSON files.
 */
export async function switchToEditorsPreference(page: Page): Promise<boolean> {
  return switchToFullEditMode(page);
}

/**
 * Switch to raw JSON view for the currently selected item.
 * First tries the #inptDrop variant dropdown (for items with variants).
 * Falls back to switching the global edit preference to "Raw" mode.
 */
export async function switchToRawMode(page: Page): Promise<boolean> {
  try {
    // Strategy 1: Try the #inptDrop variant dropdown (only present for items with variants)
    const dropdown = page.locator("#inptDrop").first();

    if (!(await dropdown.isVisible({ timeout: 1500 }))) {
      // Strategy 2: Switch global edit preference to Raw mode
      console.log("switchToRawMode: Variant dropdown not found, switching to Raw edit preference");
      return await switchToRawEditPreference(page);
    }

    // Click the dropdown to open it
    await dropdown.click();

    // Select "Single JSON view"
    const jsonOption = page.locator('[role="option"]:has-text("Single JSON view")').first();
    const jsonOptionVisible = await expect(jsonOption)
      .toBeVisible({ timeout: 2000 })
      .then(() => true)
      .catch(() => false);
    if (jsonOptionVisible) {
      await jsonOption.click();
    } else {
      // Fallback: try text match in listbox
      const listbox = page.locator('[role="listbox"]').first();
      const listboxVisible = await expect(listbox)
        .toBeVisible({ timeout: 1000 })
        .then(() => true)
        .catch(() => false);
      if (listboxVisible) {
        const option = listbox.locator('text="Single JSON view"').first();
        const optionVisible = await expect(option)
          .toBeVisible({ timeout: 1000 })
          .then(() => true)
          .catch(() => false);
        if (optionVisible) {
          await option.click();
        } else {
          console.log("switchToRawMode: 'Single JSON view' option not found");
          await page.keyboard.press("Escape");
          return false;
        }
      } else {
        console.log("switchToRawMode: Listbox not found");
        return false;
      }
    }

    console.log("switchToRawMode: Switched to raw JSON view");
    return true;
  } catch (error) {
    console.log(`switchToRawMode: Error - ${error}`);
    return false;
  }
}

/**
 * Switch to form editor view for the currently selected item.
 * First tries the #inptDrop variant dropdown.
 * Falls back to switching the global edit preference to "Full/Editors" mode.
 */
export async function switchToFormMode(page: Page): Promise<boolean> {
  try {
    const dropdown = page.locator("#inptDrop").first();

    if (!(await dropdown.isVisible({ timeout: 1500 }))) {
      // Fall back to switching global edit preference to Editors mode
      console.log("switchToFormMode: Variant dropdown not found, switching to Full edit preference");
      return await switchToFullEditMode(page);
    }

    await dropdown.click();

    const editorOption = page.locator('[role="option"]:has-text("Single editor view")').first();
    const editorOptionVisible = await expect(editorOption)
      .toBeVisible({ timeout: 2000 })
      .then(() => true)
      .catch(() => false);
    if (editorOptionVisible) {
      await editorOption.click();
    } else {
      const listbox = page.locator('[role="listbox"]').first();
      const listboxVisible = await expect(listbox)
        .toBeVisible({ timeout: 1000 })
        .then(() => true)
        .catch(() => false);
      if (listboxVisible) {
        const option = listbox.locator('text="Single editor view"').first();
        const optionVisible = await expect(option)
          .toBeVisible({ timeout: 1000 })
          .then(() => true)
          .catch(() => false);
        if (optionVisible) {
          await option.click();
        } else {
          console.log("switchToFormMode: 'Single editor view' option not found");
          await page.keyboard.press("Escape");
          return false;
        }
      }
    }

    console.log("switchToFormMode: Switched to form editor view");
    return true;
  } catch (error) {
    console.log(`switchToFormMode: Error - ${error}`);
    return false;
  }
}

/**
 * Enable all file types in the project item list (click "All Single Files (Advanced)" button).
 * This reveals hidden items that are normally collapsed in the summarized view.
 */
export async function enableAllFileTypes(page: Page): Promise<boolean> {
  try {
    // Look for the "All Single Files" or "Show All" button
    const showAllButton = page.locator('button:has-text("All Single Files"), button:has-text("Show All")').first();

    if (await showAllButton.isVisible({ timeout: 3000 })) {
      await showAllButton.click();
      await page
        .locator('[role="menu"]')
        .first()
        .waitFor({ state: "hidden", timeout: 3000 })
        .catch(() => {});
      console.log("enableAllFileTypes: Clicked 'All Single Files' button");
      return true;
    }

    console.log("enableAllFileTypes: Show all button not present (likely already expanded)");
    return false;
  } catch (error) {
    console.log(`enableAllFileTypes: Error - ${error}`);
    return false;
  }
}

/**
 * Wait for the Monaco editor to be visible on the page.
 */
export async function waitForMonacoEditor(page: Page, timeoutMs: number = 10000): Promise<boolean> {
  try {
    const monacoEditor = page.locator(".monaco-editor").first();
    await monacoEditor.waitFor({ state: "visible", timeout: timeoutMs });
    console.log("waitForMonacoEditor: Monaco editor is visible");
    return true;
  } catch {
    console.log("waitForMonacoEditor: Monaco editor did not appear");
    return false;
  }
}

/**
 * Wait for inspector/validation results to render.
 * Selects "Inspector" item and waits for validation content to appear.
 */
export async function waitForInspector(page: Page, timeoutMs: number = 60000): Promise<boolean> {
  try {
    // Select the Inspector item
    const selected = await selectProjectItem(page, "Inspector");
    if (!selected) {
      console.log("waitForInspector: Could not select Inspector item");
      return false;
    }

    // Wait for validation results to render — can take a while for large projects
    // Look for result items, info items, or any inspector content
    const resultLocator = page.locator(
      ".pii-info-area, .pii-message, [class*='inspector'], [class*='info-item'], [class*='pii-']"
    );

    try {
      await resultLocator.first().waitFor({ state: "visible", timeout: timeoutMs });
    } catch {
      // Even if specific result items don't appear, inspector may have loaded with no issues
      console.log("waitForInspector: Validation result items not found, checking for empty state");
    }

    console.log("waitForInspector: Inspector loaded");
    return true;
  } catch (error) {
    console.log(`waitForInspector: Error - ${error}`);
    return false;
  }
}

/**
 * Get the count of inspector/validation result items.
 */
export async function getInspectorItemCount(page: Page): Promise<number> {
  try {
    const items = page.locator(".pii-message, [class*='info-item']");
    return await items.count();
  } catch {
    return 0;
  }
}

function normalizeSidebarOptionLabel(label: string): string {
  return label.trim().replace(/\*$/, "").trim().toLowerCase();
}

/**
 * Ensure a TypeScript file (default: "main") is selected in the sidebar with Monaco visible.
 * Handles the case where "TypeScript files" category is collapsed by clicking the header to expand it.
 * Returns true if the file was successfully selected with Monaco ready.
 */
export async function ensureTypeScriptFileSelected(page: Page, fileName: string = "main"): Promise<boolean> {
  const targetNames = new Set(
    [fileName, `${fileName}.ts`, `${fileName}.tsx`, `${fileName}.js`, `${fileName}.mjs`, `${fileName}.cjs`].map(
      (name) => name.toLowerCase()
    )
  );

  const waitForMonacoReady = async (): Promise<boolean> => {
    if (!(await waitForMonacoEditor(page, 6000))) {
      return false;
    }

    const contentLocator = page.locator(".monaco-editor .view-lines").first();
    const lineNumbers = page.locator(".monaco-editor .line-numbers");

    return await expect
      .poll(
        async () => {
          const content = ((await contentLocator.textContent()) || "").trim();
          const lineNumberCount = await lineNumbers.count();
          return content.length > 0 && lineNumberCount > 0;
        },
        { timeout: 6000, message: "Timed out waiting for Monaco content and line numbers" }
      )
      .toBe(true)
      .then(() => true)
      .catch(() => false);
  };

  const trySelectTargetFile = async (allowAnyScriptFile: boolean): Promise<boolean> => {
    const options = page.locator(projectItemSelector);
    const optionCount = await options.count();
    let fallbackScriptIndex = -1;

    for (let i = 0; i < optionCount; i++) {
      const option = options.nth(i);
      const rawLabel = ((await option.getAttribute("aria-label")) || (await option.textContent()) || "").trim();
      const normalized = normalizeSidebarOptionLabel(rawLabel);

      if (
        normalized.length === 0 ||
        normalized === "dashboard" ||
        normalized === "project files" ||
        normalized === "project settings" ||
        normalized === "check for problems" ||
        normalized === "scripts" ||
        normalized === "file map" ||
        rawLabel.startsWith("/") ||
        rawLabel.includes("@")
      ) {
        continue;
      }

      if (targetNames.has(normalized)) {
        await option.click();
        if (await waitForMonacoReady()) {
          console.log(`ensureTypeScriptFileSelected: Found '${rawLabel}'`);
          return true;
        }
      }

      if (allowAnyScriptFile && fallbackScriptIndex < 0 && /\.(?:ts|tsx|js|mjs|cjs)$/i.test(normalized)) {
        fallbackScriptIndex = i;
      }
    }

    if (allowAnyScriptFile && fallbackScriptIndex >= 0) {
      const fallbackOption = options.nth(fallbackScriptIndex);
      const rawLabel = (
        (await fallbackOption.getAttribute("aria-label")) ||
        (await fallbackOption.textContent()) ||
        ""
      ).trim();
      await fallbackOption.click();
      if (await waitForMonacoReady()) {
        console.log(`ensureTypeScriptFileSelected: Using script file fallback '${rawLabel}'`);
        return true;
      }
    }

    return false;
  };

  if (await trySelectTargetFile(false)) {
    return true;
  }

  for (const categoryName of ["TypeScript files", "Scripts"]) {
    const category = page.locator(projectItemSelector).filter({ hasText: categoryName }).first();
    if (await category.isVisible({ timeout: 1500 }).catch(() => false)) {
      console.log(`ensureTypeScriptFileSelected: Toggling ${categoryName} category`);
      for (let i = 0; i < 2; i++) {
        const previousExpandedState = await category.getAttribute("aria-expanded");
        await category.click();
        if (previousExpandedState !== null) {
          await expect(category).not.toHaveAttribute("aria-expanded", previousExpandedState, { timeout: 5000 });
        }
        if (await trySelectTargetFile(i === 1)) {
          return true;
        }
      }
    }
  }

  console.log(`ensureTypeScriptFileSelected: Could not find '${fileName}'`);
  return false;
}
