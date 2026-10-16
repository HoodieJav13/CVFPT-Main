// Preview-mode exercise media: UI behavior only, on the separate synthetic
// scenario (switched on per test). Processing here is a labelled simulation;
// authorization, SQL and real processing are proven by the local server lane.
import { test, expect, usePreviewRole } from './preview-test.mjs';

test.setTimeout(90_000);

async function mediaScenario(page, on = true) {
  await page.addInitScript((enabled) => {
    if (enabled) localStorage.setItem('cvf_preview_media_scenario', '1');
    else localStorage.removeItem('cvf_preview_media_scenario');
  }, on);
}

async function startMediaSession(page) {
  await page.goto('/client/programs?view=other');
  const card = page.getByTestId('client-workout-assignment-card').filter({ hasText: 'Synthetic media session' });
  await card.getByTestId('start-standalone-workout').click();
  await expect(page).toHaveURL(/\/client\/workouts\/[^/]+\/track$/);
  return page.getByTestId('tracker-exercise-card');
}

test('switch off: baseline fixtures and screens carry no media UI', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await usePreviewRole(page, 'client');
  await mediaScenario(page, false);
  await page.goto('/client/programs');
  await page.getByTestId('client-program-card').first().getByTestId('start-program-workout').first().click();
  await expect(page.getByTestId('tracker-exercise-card').first()).toBeVisible();
  await expect(page.getByTestId('exercise-media-inline')).toHaveCount(0);
  await expect(page.getByTestId('exercise-media-deferred')).toHaveCount(0);
  await expect(page.getByTestId('tracker-exercise-video').first()).toContainText('External video');
});

test('client tracker: only active+next posters load, preview plays on request, full instruction is separate', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await usePreviewRole(page, 'client');
  await mediaScenario(page);
  const cards = await startMediaSession(page);
  await expect(cards).toHaveCount(7);
  // Active (goblet photo) and next-with-media (split stills) load posters.
  await expect(cards.nth(0).getByTestId('exercise-media-poster')).toBeVisible();
  await expect(cards.nth(0).getByTestId('exercise-media-poster')).toHaveAttribute('alt', /Synthetic Goblet Squat/);
  await expect(cards.nth(1).getByTestId('exercise-media-poster')).toBeVisible();
  // Later cards stay text until asked.
  await expect(cards.nth(2).getByTestId('exercise-media-deferred')).toBeVisible();
  await expect(cards.nth(2).getByTestId('exercise-media-poster')).toHaveCount(0);
  await expect(page.locator('video')).toHaveCount(0);
  // No media on the no-media and custom exercises; the coach link is kept.
  await expect(cards.nth(5).getByTestId('exercise-media-inline')).toHaveCount(0);
  await expect(cards.nth(6).getByTestId('exercise-media-inline')).toHaveCount(0);
  await expect(cards.nth(2).getByTestId('tracker-exercise-video')).toHaveAttribute('href', /synthetic-coach-override/);
  // Load the band row on request, then play its preview explicitly.
  await cards.nth(2).getByRole('button', { name: /Show movement preview/ }).click();
  await expect(cards.nth(2).getByTestId('exercise-media-poster')).toBeVisible();
  const preview = cards.nth(2).getByTestId('exercise-media-play');
  await expect(preview).toHaveText(/Play preview/);
  await preview.click();
  const video = cards.nth(2).getByTestId('exercise-media-preview');
  await expect(video).toBeVisible();
  await expect.poll(() => video.evaluate((el) => ({ muted: el.muted, loop: el.loop, inline: el.playsInline }))).toEqual({ muted: true, loop: false, inline: true });
  // Full instruction: dialog with captions toggle, transcript, Escape returns focus.
  const open = cards.nth(2).getByTestId('exercise-media-instruction');
  await open.click();
  const dialog = page.getByTestId('exercise-instruction-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('exercise-instruction-video')).toBeVisible();
  await expect(dialog.getByTestId('exercise-instruction-video')).toHaveAttribute('controls', '');
  await dialog.getByTestId('exercise-instruction-captions').click();
  await expect(dialog.getByTestId('exercise-instruction-captions')).toHaveAttribute('aria-pressed', 'true');
  await dialog.getByTestId('exercise-instruction-transcript').click();
  await expect(dialog.getByTestId('exercise-instruction-transcript-text')).toContainText('Synthetic transcript');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(open).toBeFocused();
  // A failed/expired poster falls back to text and recovers on explicit retry.
  await cards.nth(3).getByRole('button', { name: /Show photo/ }).click();
  await expect(cards.nth(3).getByText('Preview unavailable')).toBeVisible();
  await cards.nth(3).getByTestId('exercise-media-retry').click();
  await expect(cards.nth(3).getByTestId('exercise-media-poster')).toBeVisible();
  // Logging still works with media on screen.
  await cards.nth(0).getByRole('button', { name: 'Complete set 1' }).click();
  await expect(page.getByTestId('workout-save-state')).toContainText('Saved');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
});

test('narrow phone: media stays bounded, inputs and Finish remain usable; reduced motion never autoplays', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 740 });
  await usePreviewRole(page, 'client');
  await mediaScenario(page);
  const cards = await startMediaSession(page);
  const slot = cards.nth(0).getByTestId('exercise-media-slot');
  await expect(slot).toBeVisible();
  const box = await slot.boundingBox();
  expect(box.width).toBeLessThanOrEqual(100);
  expect(Math.round(box.width / box.height * 100) / 100).toBeCloseTo(1.78, 1);
  await expect(page.locator('video')).toHaveCount(0);
  const weight = cards.nth(0).getByRole('spinbutton', { name: /set 1 weight/ });
  await weight.fill('25');
  await expect(weight).toHaveValue('25');
  const finish = page.getByRole('button', { name: 'Finish workout' });
  await expect(finish).toBeVisible();
  for (const button of await cards.nth(0).getByTestId('exercise-media-inline').getByRole('button').all()) {
    const target = await button.boundingBox();
    expect(target.height).toBeGreaterThanOrEqual(44);
  }
  // Expand to the larger bounded slot and back.
  await cards.nth(0).getByTestId('exercise-media-expand').click();
  await expect(cards.nth(0).getByTestId('exercise-media-expand')).toHaveAttribute('aria-expanded', 'true');
  const expanded = await slot.boundingBox();
  expect(expanded.width).toBeGreaterThan(200);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
});

test('coach library: readiness filter and summary; review and publish a ready draft', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await usePreviewRole(page, 'coach');
  await mediaScenario(page);
  await page.goto('/coach/programs');
  await expect(page.getByTestId('exercise-library-media-summary')).toContainText('need review');
  await page.getByTestId('exercise-library-filter-media').click();
  await page.getByRole('option', { name: 'Ready video' }).click();
  await expect(page.getByTestId('exercise-library-card')).toHaveCount(1);
  await expect(page.getByTestId('exercise-library-card').first()).toContainText('Synthetic Band Row');
  await page.getByTestId('exercise-library-clear-filters').click();
  const goblet = page.getByTestId('exercise-library-card').filter({ hasText: 'Synthetic Goblet Squat' });
  await goblet.getByTestId('exercise-library-media-button').click();
  const editor = page.getByTestId('exercise-media-editor');
  await expect(editor.getByTestId('media-exact-identity')).toContainText('Synthetic Goblet Squat · Kettlebell');
  await expect(editor.getByTestId('media-current')).toBeVisible();
  await expect(editor.getByTestId('media-review')).toBeVisible();
  await expect(editor.getByTestId('media-approve')).toBeDisabled();
  await editor.getByTestId('attest-variant').click();
  await editor.getByTestId('attest-rights').click();
  await editor.getByTestId('attest-content').click();
  await editor.getByTestId('media-approve').click();
  await editor.getByTestId('media-publish').click();
  await expect(page.getByText(/Published\. Every workout using this exercise/)).toBeVisible();
});

test('coach library and media editor never scroll sideways on a 320px phone', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await usePreviewRole(page, 'coach');
  await mediaScenario(page);
  await page.goto('/coach/programs');
  await expect(page.getByTestId('exercise-library-media-summary')).toBeVisible();
  const overflow = () => page.evaluate(() => {
    const width = window.innerWidth;
    const offenders = [...document.querySelectorAll('body *')]
      .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.right > width + 0.5; })
      .slice(0, 5).map((el) => `${el.tagName.toLowerCase()}[${el.getAttribute('data-testid') || el.className}]`);
    return { scrollWidth: document.documentElement.scrollWidth, width, offenders };
  });
  let result = await overflow();
  expect(result.scrollWidth, result.offenders.join(' | ')).toBeLessThanOrEqual(result.width);
  const goblet = page.getByTestId('exercise-library-card').filter({ hasText: 'Synthetic Goblet Squat' });
  await goblet.getByTestId('exercise-library-media-button').click();
  await expect(page.getByTestId('exercise-media-editor')).toBeVisible();
  result = await overflow();
  expect(result.scrollWidth, result.offenders.join(' | ')).toBeLessThanOrEqual(result.width);
});

test('coach uploads an image with no video, crops by keyboard, processes (simulated), approves and publishes', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await usePreviewRole(page, 'coach');
  await mediaScenario(page);
  await page.goto('/coach/programs');
  const wall = page.getByTestId('exercise-library-card').filter({ hasText: 'Synthetic Wall Sit' });
  await wall.getByTestId('exercise-library-media-button').click();
  const editor = page.getByTestId('exercise-media-editor');
  await expect(editor.getByTestId('media-none')).toBeVisible();
  await expect(editor.getByTestId('media-new-draft')).toBeDisabled();
  await editor.getByTestId('media-confirm-identity').click();
  await editor.getByTestId('media-new-draft').click();
  const png = await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 900;
    const g = canvas.getContext('2d'); g.fillStyle = '#3a6'; g.fillRect(0, 0, 1200, 450); g.fillStyle = '#36a'; g.fillRect(0, 450, 1200, 450);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  await editor.getByTestId('media-file-source_image').setInputFiles({ name: 'synthetic-wall-sit.png', mimeType: 'image/png', buffer: Buffer.from(png) });
  await expect(editor.getByTestId('media-upload-start-source_image')).toBeDisabled();
  await editor.getByTestId('media-rights-confirm-source_image').click();
  await editor.getByTestId('media-upload-start-source_image').click();
  await expect(editor.getByTestId('media-source-facts')).toContainText('Image 1200×900');
  const area = editor.getByTestId('poster-crop-area');
  await expect(area).toBeVisible();
  const readout = editor.getByTestId('poster-crop-readout');
  const before = await readout.textContent();
  await area.focus();
  await page.keyboard.press('+');
  await page.keyboard.press('ArrowDown');
  await expect(readout).not.toHaveText(before);
  await editor.getByTestId('media-alt-text').fill('Synthetic wall sit placeholder photo');
  await editor.getByTestId('media-cue-0').fill('Synthetic cue');
  await editor.getByTestId('media-save').click();
  await expect(editor.getByTestId('media-process')).toBeEnabled();
  await editor.getByTestId('media-process').click();
  await expect(editor.getByTestId('media-draft-editor')).toHaveAttribute('data-status', 'ready', { timeout: 15_000 });
  await expect(editor.getByTestId('review-poster')).toBeVisible();
  await editor.getByTestId('attest-variant').click();
  await editor.getByTestId('attest-rights').click();
  await editor.getByTestId('attest-content').click();
  await editor.getByTestId('media-approve').click();
  await editor.getByTestId('media-publish').click();
  await expect(page.getByText(/Published\. Every workout/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
});

test('photos mode: no video upload; an interrupted processing draft offers an explicit Resume that completes it', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await usePreviewRole(page, 'coach');
  await mediaScenario(page);
  await page.goto('/coach/programs');
  const split = page.getByTestId('exercise-library-card').filter({ hasText: 'Synthetic Split Squat' });
  await split.getByTestId('exercise-library-media-button').click();
  const editor = page.getByTestId('exercise-media-editor');
  const processing = editor.getByTestId('media-draft-chip').filter({ hasText: 'Processing' });
  await processing.first().click();
  await expect(editor.getByTestId('media-draft-editor')).toHaveAttribute('data-status', 'processing');
  await expect(editor.getByTestId('media-upload-source_video')).toHaveCount(0);
  const resume = editor.getByTestId('media-resume-processing');
  await expect(resume).toBeVisible();
  expect((await resume.boundingBox()).height).toBeGreaterThanOrEqual(44);
  await resume.click();
  await expect(editor.getByTestId('media-draft-editor')).toHaveAttribute('data-status', 'ready');
  await expect(editor.getByTestId('media-review')).toBeVisible();
});
