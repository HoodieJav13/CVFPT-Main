// Coaching cockpit (preview). Fictional replay data only; no account data.

import { test, expect, usePreviewRole } from './preview-test.mjs';

test.skip(process.env.REACT_APP_PT_COCKPIT !== 'true', 'Fictional Cockpit is opt-in');

const LATE_FINAL = '/coach/cockpit?scenario=late&step=6';

test.use({ viewport: { width: 1440, height: 1000 } });

test.beforeEach(async ({ page }) => {
  await usePreviewRole(page, 'coach');
});

test('the next person to help is named first, and one key clears it with a ten-second Undo', async ({ page }) => {
  await page.goto(LATE_FINAL);
  // Tile buttons only: each tile also contains a cockpit-tile-name-… element.
  const tiles = page.getByTestId('cockpit-roster').locator('button[data-testid^="cockpit-tile-"]');
  await expect(tiles).toHaveCount(12);
  const ids = await tiles.evaluateAll((nodes) => nodes.map((node) => node.dataset.testid));
  expect(new Set(ids).size).toBe(12);
  await expect(page.getByTestId('cockpit-next-name')).toHaveText('Sol Varga');
  await expect(page.getByTestId('cockpit-next-reason')).toContainText('Two different values');

  await page.keyboard.press('c');
  await expect(page.getByTestId('cockpit-undo')).toContainText('Sol Varga');
  await expect(page.getByTestId('cockpit-next-name')).toHaveText('Pell Rios');

  // A second clear inside the window keeps the first one undoable too.
  await page.keyboard.press('c');
  await expect(page.getByTestId('cockpit-undo-more')).toContainText('+1 more');
  await page.keyboard.press('u');
  await expect(page.getByTestId('cockpit-next-name')).toHaveText('Pell Rios');
  await page.keyboard.press('u');
  await expect(page.getByTestId('cockpit-undo')).toHaveCount(0);
  await expect(page.getByTestId('cockpit-next-name')).toHaveText('Sol Varga');
  // Undo restores the item and selects it again.
  await expect(page.getByTestId('cockpit-item-0')).toHaveAttribute('aria-current', 'true');

  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('cockpit-item-1')).toHaveAttribute('aria-current', 'true');
  await page.keyboard.press('ArrowUp');
  await expect(page.getByTestId('cockpit-item-0')).toHaveAttribute('aria-current', 'true');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press(' ');
  await expect(page.getByTestId('cockpit-item-0')).toHaveAttribute('aria-current', 'true');
  await expect(page.locator('#cockpit-client-title')).toHaveText('Sol Varga');
});

test('a note written from the keyboard shows on that client’s next set in their phone view', async ({ page }) => {
  await page.goto(LATE_FINAL);
  // The cockpit route is lazy: wait until it is ready before keyboard input.
  await expect(page.getByTestId('cockpit-next-name')).toHaveText('Sol Varga');
  await page.keyboard.press(' ');
  await expect(page.locator('#cockpit-client-title')).toHaveText('Sol Varga');
  await page.keyboard.press('n');
  await expect(page.getByTestId('cockpit-note-input')).toBeFocused();
  await page.keyboard.type('Sit back into the heels');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('cockpit-client-notes')).toContainText('Sit back into the heels');
  await expect(page.getByTestId('cockpit-note-persistence')).toContainText('Fictional replay');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/coach/cockpit/phone/client_sol?scenario=late&step=6');
  await expect(page.getByTestId('phone-client-name')).toHaveText('Sol Varga');
  await expect(page.getByTestId('phone-exercise')).toBeVisible();
  await expect(page.getByTestId('phone-note-text')).toHaveText('Sit back into the heels');
  await expect(page.getByTestId('preview-toolbar')).toHaveCount(0);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('N and P put the cursor in the note in the same instant, so the first typed letter is never a board shortcut', async ({ page }) => {
  await page.goto(LATE_FINAL);
  await expect(page.getByTestId('cockpit-next-name')).toHaveText('Sol Varga');
  await page.keyboard.press(' ');
  await expect(page.locator('#cockpit-client-title')).toHaveText('Sol Varga');
  // Both keys land in one task, with no frame in between: the worst case of fast typing.
  for (const key of ['p', 'n']) {
    const result = await page.evaluate((shortcut) => {
      document.activeElement?.blur();
      window.dispatchEvent(new KeyboardEvent('keydown', { key: shortcut, bubbles: true, cancelable: true }));
      const focused = document.activeElement;
      const letter = new KeyboardEvent('keydown', { key: 'c', bubbles: true, cancelable: true });
      focused.dispatchEvent(letter);
      return { focused: focused?.dataset?.testid || focused?.tagName, swallowed: letter.defaultPrevented };
    }, key);
    expect(result).toEqual({ focused: 'cockpit-note-input', swallowed: false });
  }
  await expect(page.getByTestId('cockpit-undo')).toHaveCount(0);
  await expect(page.getByTestId('cockpit-next-name')).toHaveText('Sol Varga');
});

test('the preview controls are an inline cockpit button that opens and closes the real toolbar', async ({ page }) => {
  await page.goto(LATE_FINAL);
  await expect(page.getByTestId('preview-toolbar')).toBeHidden({ timeout: 10_000 });
  const inline = page.getByTestId('cockpit-preview-controls');
  await expect(inline).toBeVisible();
  await inline.click();
  await expect(page.locator('#preview-toolbar-controls')).toBeVisible();
  await page.getByTestId('preview-toolbar-desktop-toggle').click();
  await expect(page.getByTestId('preview-toolbar')).toBeHidden();
  // Names are never cut short on the roster.
  await expect(page.getByTestId('cockpit-tile-name-client_tess')).toHaveText('Tess Oyelaran');
  const clipped = await page.getByTestId('cockpit-tile-name-client_tess').evaluate((node) => node.scrollWidth > node.clientWidth);
  expect(clipped).toBe(false);
});

test('live sessions are explicitly unavailable in preview', async ({ page, missingMocks }) => {
  await page.goto('/coach/cockpit?source=live');
  await expect(page.getByTestId('cockpit-live-unsupported')).toContainText('Not available in preview');
  expect(missingMocks).toEqual([]);
});

test('a template edit is previewed client by client and nothing applies until each is confirmed', async ({ page }) => {
  await page.goto('/coach/cockpit?view=template');
  await page.getByTestId('template-tx_squat-load').fill('85');
  await expect(page.getByTestId('template-client-client_juno')).toHaveAttribute('data-decision', 'needs_confirm');
  await expect(page.getByTestId('template-client-client_ezra')).toHaveAttribute('data-decision', 'no_effect');
  await expect(page.getByTestId('template-client-client_noor')).toHaveAttribute('data-decision', 'paused');
  await expect(page.getByTestId('template-summary')).toContainText('0 confirmed · 4 to confirm');

  await page.getByTestId('template-confirm-client_juno').click();
  await expect(page.getByTestId('template-client-client_juno')).toHaveAttribute('data-decision', 'confirmed');
  await expect(page.getByTestId('template-client-client_quinn')).toHaveAttribute('data-decision', 'needs_confirm');
  await expect(page.getByTestId('template-undo-client_juno')).toBeVisible();

  await page.getByTestId('template-tx_squat-sets').fill('5');
  await expect(page.getByTestId('template-client-client_juno')).toHaveAttribute('data-decision', 'stale');
});

test('a device dropping mid-set is counted once and its differing value waits for the coach', async ({ page }) => {
  await page.goto('/coach/cockpit?scenario=drop');
  await expect(page.getByTestId('cockpit-step')).toHaveText('Step 7 of 7');
  await expect(page.getByTestId('cockpit-next-name')).toHaveText('Pell Rios');
  await expect(page.getByTestId('cockpit-tile-client_pell')).toHaveAttribute('data-heat', 'needs_cue');
  await expect(page.getByTestId('cockpit-tile-client_pell')).toContainText('5/9');
  await page.getByTestId('cockpit-step-back').click();
  await page.getByTestId('cockpit-step-back').click();
  await page.getByTestId('cockpit-step-back').click();
  await expect(page.getByTestId('cockpit-step')).toHaveText('Step 4 of 7');
  await expect(page.getByTestId('cockpit-tile-client_pell')).toContainText('3/9');
});
