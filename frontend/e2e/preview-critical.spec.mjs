import { test, expect } from '@playwright/test';

test.setTimeout(60_000);

const FLAT_PASTE = `ATG DB Incline 3x12
DB fly 2x12
Lower traps 3x8
Powell raise 2x10
Flat bench 2x7 to true failure
Decline bench 2x7 to true failure
Pullovers 2x12
Tiddy lift 2x10`;

async function usePreviewRole(page, role, clientId = 'client_sarah') {
  await page.addInitScript(({ selectedRole, selectedClient }) => {
    localStorage.setItem('cvf_preview_role', selectedRole);
    localStorage.setItem('cvf_preview_client_id', selectedClient);
  }, { selectedRole: role, selectedClient: clientId });
}

test('coach booking request preserves content and actions at mobile width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await usePreviewRole(page, 'coach');
  await page.goto('/coach');

  const row = page.getByTestId('coach-action-booking').first();
  const name = row.getByTestId('booking-client-name');
  const note = row.getByTestId('booking-request-note');
  const approve = row.getByTestId('booking-approve-button');

  await expect(name).toHaveText('Sarah Martinez');
  await expect(note).toHaveText('"Late morning works best."');
  await expect(approve).toBeVisible();
  await expect(row.getByTestId('booking-decline-button')).toBeVisible();
  expect(await name.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBeTruthy();
  expect(await note.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBeTruthy();

  const [noteBox, approveBox] = await Promise.all([note.boundingBox(), approve.boundingBox()]);
  expect(approveBox.y).toBeGreaterThan(noteBox.y + noteBox.height);
});

test('closed-loop priorities, client Today plan, and mobile primary actions stay operable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await usePreviewRole(page, 'coach');
  await page.goto('/coach');
  await expect(page.getByTestId('coach-action-queue')).toBeVisible();
  await expect(page.getByTestId('coach-action-booking')).toBeVisible();

  await page.goto('/coach/sessions');
  for (const testId of ['session-hours-button', 'session-week-view-button', 'session-create-button']) {
    await expect(page.getByTestId(testId)).toBeVisible();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();

  await page.goto('/coach/clients/client_sarah');
  await expect(page.getByTestId('client-tabs-overflow-hint')).toBeVisible();
  await expect(page.getByTestId('client-detail-tabs')).toHaveAttribute('aria-label', 'Client detail sections');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();

  await usePreviewRole(page, 'client');
  await page.goto('/client');
  await expect(page.getByTestId('client-today-plan')).toBeVisible();
  await expect(page.getByTestId('client-today-primary-action')).toBeVisible();

  await page.goto('/client/programs');
  await expect(page.getByTestId('client-training-sections')).toBeVisible();
  await page.getByTestId('client-training-tab-other').click();
  await expect(page.getByTestId('client-training-other')).toBeVisible();
  await page.getByTestId('client-training-tab-history').click();
  await expect(page.getByTestId('client-workout-history')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
});

test('coach preview covers dashboard, clients, sessions, builder, resources, and messages', async ({ page }) => {
  await usePreviewRole(page, 'coach');
  await page.goto('/coach');
  await expect(page.getByRole('heading', { name: /^Good (morning|afternoon|evening), Marcus$/ })).toBeVisible();
  await expect(page.getByTestId('coach-dashboard-today-sessions-card')).toBeVisible();

  await page.getByTestId('topnav-clients').click();
  await expect(page.getByRole('heading', { name: 'Clients' })).toBeVisible();
  await page.getByTestId('add-client-button').click();
  await page.getByTestId('client-name-input').fill('CVF TEST Browser Client');
  await page.getByTestId('client-email-input').fill('cvf-test-browser@example.invalid');
  await page.getByTestId('client-save-button').click();
  await expect(page.getByText('CVF TEST Browser Client added')).toBeVisible();
  await expect(page.getByText('cvf-test-browser@example.invalid')).toBeVisible();

  await page.getByTestId('topnav-sessions').click();
  await expect(page.getByTestId('session-create-button')).toBeVisible();
  await expect(page.getByTestId('session-row').first()).toBeVisible();

  await page.getByTestId('topnav-programs').click();
  await expect(page.getByRole('heading', { name: 'Training builder' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Exercise Library' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Workout Days' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Programs' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Assignments' })).toBeVisible();

  await page.getByTestId('training-builder-tab-programs').click();
  await page.getByTestId('program-import-open-button').click();
  await page.getByTestId('program-import-source-select').click();
  await page.getByRole('option', { name: 'Paste program' }).click();
  await page.getByTestId('program-import-paste-textarea').fill('Mobility notes only');
  await page.getByTestId('program-import-paste-parse-button').click();
  await expect(page.getByTestId('program-import-paste-empty-state')).toContainText("Couldn't find any exercises in this text.");

  await page.getByTestId('program-import-paste-textarea').fill(FLAT_PASTE);
  await page.getByTestId('program-import-paste-parse-button').click();
  await expect(page.getByTestId('program-import-review')).toBeVisible();
  await expect(page.getByTestId('program-import-frequency-select')).toContainText('1 day/week');
  await expect(page.getByTestId('program-import-day-card')).toHaveCount(1);
  await expect(page.getByTestId('program-import-day-name-input')).toHaveValue('Day 1');
  await expect(page.getByTestId('program-import-exercise-card')).toHaveCount(8);
  await expect(page.getByTestId('program-import-exercise-name-input').nth(4)).toHaveValue('Flat bench');
  await expect(page.getByTestId('program-import-exercise-sets-input').nth(4)).toHaveValue('2');
  await expect(page.getByTestId('program-import-exercise-reps-input').nth(4)).toHaveValue('7');
  await expect(page.getByTestId('program-import-exercise-client-notes-input').nth(4)).toHaveValue('to true failure');
  await page.getByTestId('program-import-paste-textarea').fill(`${FLAT_PASTE}\nEdited after parsing`);
  await expect(page.getByTestId('program-import-review')).toHaveCount(0);
  await page.getByTestId('program-import-paste-textarea').fill(FLAT_PASTE);
  await page.getByTestId('program-import-paste-parse-button').click();
  await expect(page.getByTestId('program-import-review')).toBeVisible();
  await page.getByTestId('program-import-name-input').fill('CVF TEST Preview Paste Program');
  await expect(page.getByTestId('program-import-save-button')).toBeEnabled();
  await page.getByTestId('program-import-save-button').click();
  await expect(page.getByText('Program imported to vault')).toBeVisible();
  await expect(page.getByTestId('program-card').filter({ hasText: 'CVF TEST Preview Paste Program' })).toBeVisible();

  await page.getByTestId('topnav-resources').click();
  await expect(page.getByRole('heading', { name: 'Resources' })).toBeVisible();
  await expect(page.getByTestId('coach-resource-card').filter({ hasText: 'Knee Recovery Basics' })).toBeVisible();
  await page.getByTestId('resource-upload-open').click();
  await page.getByTestId('resource-new-category-input').fill('Mobility Handouts');
  await page.getByTestId('resource-new-category-save').click();
  await expect(page.getByText('Category added')).toBeVisible();
  await page.getByTestId('resource-new-category-input').fill('mobility handouts');
  await page.getByTestId('resource-new-category-save').click();
  await expect(page.getByText('Existing category selected')).toBeVisible();
  await page.getByTestId('resource-category-select').click();
  await expect(page.getByRole('option', { name: 'Mobility Handouts' })).toHaveCount(1);
  await page.keyboard.press('Escape');
  await page.getByTestId('resource-title-input').fill('CVF TEST Preview Mobility PDF');
  await page.getByTestId('resource-file-input').setInputFiles({ name: 'not-a-pdf.txt', mimeType: 'text/plain', buffer: Buffer.from('not a pdf') });
  await page.getByTestId('resource-upload-save').click();
  await expect(page.getByText('Upload a valid PDF file.')).toBeVisible();
  await page.getByTestId('resource-file-input').setInputFiles({ name: 'mobility.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF') });
  await page.getByTestId('resource-upload-save').click();
  await expect(page.getByText('Resource uploaded')).toBeVisible();
  const uploadedResource = page.getByTestId('coach-resource-card').filter({ hasText: 'CVF TEST Preview Mobility PDF' });
  await expect(uploadedResource).toBeVisible();
  await uploadedResource.getByTestId('coach-resource-assign').click();
  await page.getByTestId('resource-client-client_sarah').click();
  await page.getByTestId('resource-assignment-save').click();
  await expect(page.getByText('Resource assignments updated')).toBeVisible();
  await uploadedResource.getByTestId('coach-resource-edit').click();
  await page.getByTestId('resource-edit-public-switch').click();
  await page.getByTestId('resource-edit-save').click();
  await expect(uploadedResource.getByText('Public — visible to all clients')).toBeVisible();

  await page.getByTestId('topnav-messages').click();
  await expect(page.getByTestId('message-thread-row').first()).toBeVisible();
});

test('coach session indicators and detail page cover the workout-done confirm flow', async ({ page }) => {
  await usePreviewRole(page, 'coach');
  await page.goto('/coach/sessions');
  // session_today carries a completed linked workout log: the row shows the
  // gold chip and surfaces the one-tap confirm in place of the status badge.
  await expect(page.getByTestId('session-workout-done-chip').first()).toBeVisible();
  await expect(page.getByTestId('session-confirm-complete-button').first()).toBeVisible();

  // The row itself opens the coach session detail page.
  await page.getByTestId('coach-session-detail-link').first().click();
  await expect(page).toHaveURL(/\/coach\/sessions\/session_today$/);
  await expect(page.getByTestId('coach-session-detail-card')).toBeVisible();
  await expect(page.getByTestId('session-workout-done-chip')).toBeVisible();
  await expect(page.getByTestId('session-plan-exercise').first()).toBeVisible();
  await expect(page.getByTestId('session-detail-notes')).toBeVisible();

  // Linked workout activity opens the workout log detail.
  await page.getByTestId('session-linked-log-row').first().click();
  await expect(page).toHaveURL(/\/coach\/workouts\/log_preview_complete$/);
  await page.goBack();

  // Approving from the detail page completes the session.
  await page.getByTestId('session-detail-complete').click();
  await expect(page.getByTestId('coach-session-detail-status')).toHaveText(/completed/i);
});

test('client preview covers dashboard and every client navigation destination', async ({ page }) => {
  await usePreviewRole(page, 'client');
  await page.goto('/client');
  await expect(page.getByRole('heading', { name: /^Good (morning|afternoon|evening), Sarah$/ })).toBeVisible();
  await expect(page.getByTestId('daily-check-in-card')).toBeVisible();

  await page.goto('/client/sessions');
  await expect(page.getByTestId('booking-request-button')).toBeVisible();
  await expect(page.getByTestId('client-upcoming-session-row').first()).toBeVisible();
  // Past rows open the session detail page too (same link as upcoming rows).
  await page.getByTestId('client-past-session-detail-link').first().click();
  await expect(page).toHaveURL(/\/client\/sessions\/session_done$/);
  await expect(page.getByTestId('session-detail-card')).toBeVisible();
  await page.goBack();

  await page.goto('/client/progress');
  await expect(page.getByTestId('client-metric-card').first()).toBeVisible();

  await page.goto('/client/programs');
  await expect(page.getByTestId('client-program-card').first()).toBeVisible();

  await page.goto('/client/resources');
  await expect(page.getByTestId('client-resource-card')).toHaveCount(2);
  await expect(page.getByText('Welcome to CVF PT')).toBeVisible();
  await expect(page.getByText('Knee Recovery Basics')).toBeVisible();
  await expect(page.getByTestId('client-resource-download')).toHaveCount(2);

  await page.goto('/client/messages');
  await expect(page.getByTestId('chat-input')).toBeVisible();

  await page.goto('/client/waiver');
  await expect(page.getByTestId('waiver-signed-card')).toBeVisible();

  await page.goto('/client/packages');
  await expect(page).toHaveURL(/\/client$/);
  await expect(page.getByTestId('credits-summary-link')).toHaveCount(0);
  await expect(page.getByTestId('topnav-packages-credits')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: /^Good (morning|afternoon|evening), Sarah$/ })).toBeVisible();

  await page.goto('/coach');
  await expect(page).toHaveURL(/\/client$/);
});

test('client coach feedback badge, history marker, failure retention, and retry are deterministic', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await usePreviewRole(page, 'client');
  await page.addInitScript(() => { globalThis.__CVF_PREVIEW_FAIL_FEEDBACK_READ_ONCE__ = true; });
  await page.goto('/client/programs');

  await expect(page.getByTestId('desktop-programs-feedback-count')).toHaveText('1');
  await page.getByTestId('client-training-tab-history').click();
  const historyRow = page.getByTestId('workout-history-row').filter({ hasText: 'Upper Strength A' });
  await expect(historyRow.getByTestId('new-coach-feedback-marker')).toHaveText('New coach feedback');

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId('mobile-programs-feedback-count')).toHaveText('1');
  await historyRow.click();
  await expect(page.getByTestId('coach-response')).toHaveCount(2);
  await expect(page.getByTestId('coach-response').first()).toContainText('Jordan Banks');
  await expect(page.getByTestId('coach-response').first().getByTestId('coach-response-edited')).toHaveText('Edited');
  await expect(page.getByTestId('coach-feedback-read-error')).toContainText("Couldn't mark coach feedback read");
  await expect(page.getByTestId('mobile-programs-feedback-count')).toHaveText('1');

  await page.goBack();
  await expect(page.getByTestId('new-coach-feedback-marker')).toHaveText('New coach feedback');
  await page.getByTestId('workout-history-row').filter({ hasText: 'Upper Strength A' }).click();
  await expect(page.getByTestId('coach-feedback-read-error')).toHaveCount(0);
  await expect(page.getByTestId('coach-feedback-announcement')).toHaveText('Coach feedback marked read');
  await expect(page.getByTestId('mobile-programs-feedback-count')).toHaveCount(0);
  await page.goBack();
  await expect(page.getByTestId('new-coach-feedback-marker')).toHaveCount(0);
});

test('equal coach-feedback polls stay quiet and reduced motion suppresses badge movement', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await usePreviewRole(page, 'client');
  await page.goto('/client');
  const badge = page.getByTestId('mobile-programs-feedback-count');
  await expect(badge).toHaveAttribute('data-arrival-revision', '0');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(badge).toHaveAttribute('data-arrival-revision', '0');
  expect(await badge.evaluate((element) => getComputedStyle(element).animationName)).toBe('none');
});

test('sky scene, one-time dashboard motion, and genuine PR moment stay wired', async ({ page }) => {
  await usePreviewRole(page, 'client');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/client');

  // Sky Field: sunrise in the light theme, sunset in the dark theme, with the
  // real three-layer Sandia ridge.
  const sky = page.getByTestId('sky-scene');
  await expect(sky).toHaveAttribute('data-theme-scene', 'sunrise');
  await expect(sky.locator('.sky-scene__ridges path')).toHaveCount(4);
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(sky).toHaveAttribute('data-theme-scene', 'sunset');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('[data-entry-motion]')).toHaveAttribute('data-entry-motion', 'enabled');
  await expect(page.locator('[data-motion-intensity]')).toHaveAttribute('data-motion-intensity', 'spectacle');
  await expect(page.locator('[data-entry-direction]')).toHaveAttribute('data-entry-direction', 'surge');
  await expect(page.getByTestId('preview-intensity-select')).toHaveCount(0);

  await page.evaluate(() => localStorage.setItem('cvfpt_visual_intensity', 'restrained'));
  await page.reload();
  await expect(page.getByTestId('sky-scene')).toBeVisible();
  await expect(page.locator('[data-motion-intensity]')).toHaveAttribute('data-motion-intensity', 'spectacle');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('cvfpt_visual_intensity'))).toBe('restrained');

  await page.getByTestId('topnav-programs').click();
  await page.getByTestId('topnav-home').click();
  await expect(page.locator('[data-entry-motion]')).toHaveAttribute('data-entry-motion', 'skipped');
  await page.reload();
  await expect(page.locator('[data-entry-motion]')).toHaveAttribute('data-entry-motion', 'skipped');

  await page.getByTestId('topnav-progress').click();
  const bodyWeight = page.getByTestId('client-metric-card').filter({ hasText: 'Body Weight' });
  await bodyWeight.getByTestId('client-log-entry-button').click();
  await page.getByTestId('client-entry-value-input').fill('161');
  await page.getByTestId('client-entry-save-button').click();

  const recordMoment = page.getByTestId('personal-record-moment');
  await expect(recordMoment).toBeVisible();
  await expect(recordMoment).toHaveAttribute('data-pr-presentation', 'medal');
  await expect(recordMoment).toHaveAttribute('data-motion-duration-ms', '860');
  await expect(recordMoment).toHaveAttribute('data-motion-initial-scale', '0.82');
  await expect(recordMoment.getByTestId('brand-backdrop-achievement')).toHaveAttribute('data-intensity', 'spectacle');
  await expect(page.getByTestId('progress-delta-hero-number')).toContainText('1 lbs');
  await expect(bodyWeight).toHaveAttribute('data-achievement', 'true');
});

test('coach metrics quietly surface track-only metrics at mobile width', async ({ page }) => {
  await usePreviewRole(page, 'coach');
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/coach/clients/client_sarah');
  await page.getByTestId('tab-progress').click();
  await expect(page.getByTestId('neutral-metrics-nudge')).toHaveCount(0);

  await page.getByTestId('add-metric-button').click();
  await page.getByTestId('metric-name-input').fill('Training Readiness');
  await page.getByTestId('metric-save-button').click();

  const nudge = page.getByTestId('neutral-metrics-nudge');
  await expect(nudge).toContainText('1 metric is still track-only');
  await expect(nudge).toContainText('Set an improvement direction to enable PR recognition');
  await expect(nudge).toBeVisible();
  const box = await nudge.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(375);
});

test('admin preview exposes admin-only management surfaces', async ({ page }) => {
  await usePreviewRole(page, 'admin');
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Admin' })).toBeVisible();
  await expect(page.getByTestId('admin-tab-coaches')).toBeVisible();
  await expect(page.getByTestId('admin-tab-waivers')).toBeVisible();
  await expect(page.getByTestId('admin-tab-packages')).toHaveCount(0);
});

test('client mobile navigation reaches critical pages', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await usePreviewRole(page, 'client');
  await page.goto('/client');
  // One corner button opens the six places; choosing one navigates and closes it.
  await page.getByTestId('mobile-menu-button').click();
  await expect(page.getByTestId('bottom-tab-sessions')).toBeVisible();
  await page.getByTestId('bottom-tab-sessions').click();
  await expect(page).toHaveURL(/\/client\/sessions$/);
  await expect(page.getByTestId('booking-request-button')).toBeVisible();
  await expect(page.getByTestId('mobile-menu-button')).toHaveAttribute('aria-expanded', 'false');
  await page.getByTestId('mobile-menu-button').click();
  await expect(page.getByTestId('bottom-tab-resources')).toBeVisible();
});

test('shared dialogs, selects, and dropdowns use fade-only reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await usePreviewRole(page, 'client');
  await page.goto('/client/programs');
  await page.getByTestId('start-program-workout').first().click();
  await expect(page.getByTestId('workout-tracker')).toBeVisible();
  await expect(page.getByTestId('workout-control-dock')).toBeVisible();

  const reducedFade = async (locator) => locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      animationName: style.animationName,
      animationDuration: style.animationDuration,
      transform: style.transform,
    };
  });

  await page.getByLabel('Weight unit').first().click();
  const listbox = page.getByRole('listbox');
  await expect(listbox).toBeVisible();
  await expect.poll(async () => reducedFade(listbox)).toMatchObject({
    animationName: 'motion-reduced-fade-in',
    animationDuration: '0.2s',
  });
  await page.keyboard.press('Escape');

  const firstExercise = page.getByTestId('tracker-exercise-card').first();
  await firstExercise.getByRole('button', { name: 'Complete set 1' }).click();
  await expect(page.getByTestId('workout-save-state')).toContainText('Saved');
  await page.getByRole('button', { name: 'Finish workout' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const dialogMotion = await reducedFade(dialog);
  expect(dialogMotion).toMatchObject({
    animationName: 'motion-reduced-fade-in',
    animationDuration: '0.2s',
  });
  expect(dialogMotion.transform).not.toBe('none');
  await page.keyboard.press('Escape');

  await page.getByTestId('mobile-header-actions').getByTestId('user-menu-trigger').click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await expect.poll(async () => reducedFade(menu)).toMatchObject({
    animationName: 'motion-reduced-fade-in',
    animationDuration: '0.2s',
  });
});

test('client preview hides another client assigned resource', async ({ page }) => {
  await usePreviewRole(page, 'client', 'client_david');
  await page.goto('/client/resources');
  await expect(page.getByTestId('client-resource-card')).toHaveCount(1);
  await expect(page.getByText('Welcome to CVF PT')).toBeVisible();
  await expect(page.getByText('Knee Recovery Basics')).toHaveCount(0);
});

test('workout rest expiry uses one calm attention cue and stays persistent', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.install();
  await usePreviewRole(page, 'client');
  await page.goto('/client/programs');
  await page.getByTestId('start-program-workout').first().click();

  const firstExercise = page.getByTestId('tracker-exercise-card').first();
  await firstExercise.getByRole('button', { name: 'Complete set 1' }).click();
  await page.clock.runFor(1_000);
  await expect(page.getByTestId('workout-save-state')).toContainText('Saved');

  const timer = page.getByTestId('rest-timer');
  await expect(timer).toHaveAttribute('data-rest-state', 'running');
  await expect(timer).toContainText(/^\s*1:\d{2}$/);
  expect(await timer.evaluate((element) => getComputedStyle(element).animationName)).toBe('none');

  await page.clock.fastForward(89_000);
  await expect(timer).toHaveAttribute('data-rest-state', 'complete');
  await expect(timer).toContainText('Rest complete');
  await expect(page.getByTestId('rest-complete-announcement')).toHaveText('Rest complete');
  await expect(timer).toHaveClass(/bg-success/);
  await expect.poll(async () => timer.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      animationName: style.animationName,
      animationDuration: style.animationDuration,
      animationIterationCount: style.animationIterationCount,
      attentionScale: style.getPropertyValue('--motion-attention-scale').trim(),
    };
  })).toEqual({
    animationName: 'motion-attention-pop-once',
    animationDuration: '0.2s',
    animationIterationCount: '1',
    attentionScale: '1.05',
  });

  await timer.click();
  await expect(timer).toHaveCount(0);
});

test('reduced motion preserves workout completion and rest-expiry information without movement', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.install();
  await usePreviewRole(page, 'client');
  await page.goto('/client/programs');
  await page.getByTestId('start-program-workout').first().click();

  const firstExercise = page.getByTestId('tracker-exercise-card').first();
  await firstExercise.getByRole('button', { name: 'Complete set 1' }).click();
  // runFor dispatches every faked rAF/interval tick across the whole window —
  // ~5.6k frames through the motion loop, which can outlast the test budget
  // on slow hardware. Tick 1s for the save round-trip, then jump: fastForward
  // fires each pending timer at most once and lands on the same end state.
  await page.clock.runFor(1_000);
  await expect(page.getByTestId('workout-save-state')).toContainText('Saved');
  await page.clock.fastForward(89_000);

  const timer = page.getByTestId('rest-timer');
  await expect(timer).toHaveAttribute('data-rest-state', 'complete');
  await expect(timer).toContainText('Rest complete');
  await expect(page.getByTestId('rest-complete-announcement')).toHaveText('Rest complete');
  expect(await timer.evaluate((element) => getComputedStyle(element).animationName)).toBe('none');
  await timer.click();

  await page.getByRole('button', { name: 'Finish workout' }).click();
  await page.getByRole('button', { name: 'Confirm completion' }).click();
  await expect(page).toHaveURL(/\/client\/workouts\/[^/]+$/);
  const summary = page.getByTestId('workout-completion-summary');
  await expect(summary).toHaveAttribute('data-completion-motion', 'active');
  await expect(summary).toHaveAttribute('data-motion-reduced', 'true');
  await expect(page.getByRole('status').filter({ hasText: 'Workout complete' })).toBeVisible();
  const summaryMotion = await summary.evaluate((element) => ({
    opacity: getComputedStyle(element).opacity,
    transform: getComputedStyle(element).transform,
    animations: element.getAnimations().length,
  }));
  expect(summaryMotion.opacity).toBe('1');
  expect(['none', 'matrix(1, 0, 0, 1, 0, 0)']).toContain(summaryMotion.transform);
  expect(summaryMotion.animations).toBe(0);
});

test('client workout completion creates a coach notification with immutable results', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await usePreviewRole(page, 'client');
  await page.goto('/client/programs');

  const firstDay = page.getByTestId('client-program-card').first();
  await expect(firstDay.getByText(/Load: 35 lb/)).toBeVisible();
  await firstDay.getByTestId('start-program-workout').first().click();
  await expect(page).toHaveURL(/\/client\/workouts\/[^/]+\/track$/);
  await expect(page.getByTestId('workout-tracker')).toBeVisible();

  const squat = page.getByTestId('tracker-exercise-card').first();
  const weight = squat.getByRole('spinbutton', { name: 'Goblet Squat set 1 weight', exact: true });
  await expect(weight).toHaveValue('35');
  await expect(squat.getByRole('combobox', { name: 'Goblet Squat set 1 weight unit', exact: true })).toBeVisible();
  await expect(squat.getByRole('combobox', { name: 'Goblet Squat set 2 weight unit', exact: true })).toBeVisible();
  await expect(squat.getByText('RPE 7')).toBeVisible();
  // Structured rest formats the column clock-style (90 -> 1:30).
  await expect(squat.getByText('Rest 1:30')).toBeVisible();

  await context.setOffline(true);
  await weight.fill('37.5');
  await weight.blur();
  await squat.getByRole('combobox', { name: 'Goblet Squat set 1 weight unit', exact: true }).click();
  await page.getByRole('option', { name: 'kg', exact: true }).click();
  await squat.getByRole('button', { name: 'Complete set 1' }).click();
  await squat.getByRole('textbox', { name: 'Exercise notes' }).fill('Offline sequence preserved.');
  await squat.getByRole('textbox', { name: 'Exercise notes' }).blur();
  await squat.getByRole('button', { name: 'Add set' }).click();
  const extraWeight = squat.getByRole('spinbutton', { name: 'Goblet Squat set 4 weight', exact: true });
  await expect(extraWeight).toBeVisible();
  await expect(squat.getByRole('combobox', { name: 'Goblet Squat set 4 weight unit', exact: true })).toBeVisible();
  await extraWeight.fill('42.5');
  await extraWeight.blur();
  await squat.getByRole('button', { name: 'Complete set 4' }).click();
  await squat.getByRole('button', { name: 'Remove extra set' }).click();
  await expect(squat.getByRole('button', { name: 'Remove extra set' })).toHaveCount(0);
  await expect(page.getByTestId('workout-save-state')).toContainText('Not saved yet');
  await expect(page.getByRole('button', { name: 'Complete all remaining' })).toBeDisabled();
  // Offline completion (docs/offline-workout-completion.md, PR #16): finishing
  // is now allowed offline — the completion queues behind pending writes.
  await expect(page.getByRole('button', { name: 'Finish workout' })).toBeEnabled();

  await context.setOffline(false);
  await expect(page.getByTestId('workout-save-state')).toContainText('Saved');
  await expect(page.getByLabel(/Rest timer/)).toBeVisible();

  await page.getByRole('button', { name: 'Finish workout' }).click();
  await page.getByLabel('Feedback for your coach').fill('Strong session from the preview flow.');
  await page.getByRole('button', { name: 'Confirm completion' }).click();
  await expect(page).toHaveURL(/\/client\/workouts\/[^/]+$/);
  const completionSummary = page.getByTestId('workout-completion-summary');
  await expect(completionSummary).toHaveAttribute('data-completion-motion', 'active');
  await expect(completionSummary).toHaveAttribute('data-motion-duration-ms', '700');
  await expect(completionSummary).toHaveAttribute('data-motion-distance', '22');
  await expect(completionSummary).toHaveAttribute('data-motion-initial-scale', '0.98');
  await expect(page.getByRole('status').filter({ hasText: 'Workout complete' })).toBeVisible();
  await expect(page.getByText('Strong session from the preview flow.')).toBeVisible();
  await expect(page.getByText('Offline sequence preserved.')).toBeVisible();
  await expect(page.getByText('37.5 kg')).toBeVisible();
  await expect(page.getByText('1 completed')).toBeVisible();
  await expect(page.getByText('8 skipped')).toBeVisible();
  await expect(page.getByText('42.5 kg')).toHaveCount(0);

  expect(await page.evaluate(() => window.history.state?.usr?.completedWorkoutId ?? null)).toBeNull();
  await page.goBack();
  await expect(page).toHaveURL(/\/client\/programs$/);
  await page.goForward();
  await expect(page).toHaveURL(/\/client\/workouts\/[^/]+$/);
  await expect(page.getByTestId('workout-completion-summary')).toHaveAttribute('data-completion-motion', 'none');
  await expect(page.getByRole('status').filter({ hasText: 'Workout complete' })).toHaveCount(0);

  await page.getByTestId('preview-toolbar-toggle').click();
  await page.getByTestId('preview-role-select').selectOption('coach');
  await expect(page).toHaveURL(/\/coach$/);
  await page.getByTestId('mobile-notifications-link').click();
  await expect(page.getByTestId('notification-row').filter({ hasText: 'Lower Strength A' })).toBeVisible();
  await page.getByTestId('notification-row').filter({ hasText: 'Lower Strength A' }).click();
  await expect(page).toHaveURL(/\/coach\/workouts\/[^/]+$/);
  await expect(page.getByTestId('workout-completion-summary')).toHaveAttribute('data-completion-motion', 'none');
  await expect(page.getByText('Strong session from the preview flow.')).toBeVisible();
  const responseInput = page.getByTestId('coach-response-input');
  await responseInput.fill('Strong work. Keep this loading pattern next time.');
  await page.getByTestId('coach-response-save').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('coach-feedback-announcement')).toHaveText('Coach response added');
  await expect(page.getByTestId('coach-response').filter({ hasText: 'Marcus Rivera' })).toContainText('Strong work. Keep this loading pattern next time.');
  await responseInput.fill('Strong work. Add one controlled rep next time.');
  await page.getByTestId('coach-response-save').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('coach-feedback-announcement')).toHaveText('Coach response updated');
  const ownResponse = page.getByTestId('coach-response').filter({ hasText: 'Marcus Rivera' });
  await expect(ownResponse).toContainText('Strong work. Add one controlled rep next time.');
  await expect(ownResponse.getByTestId('coach-response-edited')).toHaveText('Edited');
  const messageClient = page.getByRole('link', { name: 'Message client' });
  await expect(messageClient).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  // The global FAB was removed (UI-4): nothing floats over interactive
  // elements anymore, so only the tap-target size remains to verify.
  await expect(page.getByTestId('coach-quick-add-button')).toHaveCount(0);
  const messageRect = await messageClient.boundingBox();
  expect(messageRect.height).toBeGreaterThanOrEqual(44);
  await messageClient.click();
  await expect(page).toHaveURL(/\/coach\/messages\/client_sarah$/);
});

test('exercise history is network-only, paginated, retryable, and independent from workout writes', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await usePreviewRole(page, 'client');
  await page.goto('/client/programs');
  await page.getByTestId('start-program-workout').first().click();

  const card = page.getByTestId('tracker-exercise-card').first();
  const reps = card.getByRole('spinbutton', { name: 'Goblet Squat set 1 performed reps' });
  const rpe = card.getByRole('spinbutton', { name: 'Goblet Squat set 1 performed RPE' });
  await expect(reps).toHaveValue('');
  await expect(rpe).toHaveValue('');
  await reps.fill('8');
  await reps.blur();
  await rpe.fill('7.5');
  await rpe.blur();
  await expect(page.getByTestId('workout-save-state')).toContainText('Saved');

  await reps.fill('-1');
  await reps.blur();
  await card.getByRole('button', { name: 'Complete set 2' }).click();
  await expect(page.getByText('Reps must be a nonnegative whole number or null')).toBeVisible();
  await expect(card.getByRole('button', { name: 'Mark incomplete set 2' })).toBeVisible();
  await expect(page.getByTestId('workout-save-state')).toContainText('Saved');

  await page.evaluate(() => localStorage.setItem('cvf_preview_history_failure', 'once'));
  const disclosure = card.getByRole('button', { name: /Exercise history/ });
  await disclosure.focus();
  await page.keyboard.press('Space');
  await expect(card.getByRole('alert')).toContainText('temporarily unavailable');
  await expect(card.getByRole('button', { name: 'Complete set 1' })).toBeEnabled();
  await card.getByRole('button', { name: 'Complete set 1' }).click();
  await expect(page.getByTestId('workout-save-state')).toContainText('Saved');

  await card.getByRole('button', { name: 'Retry' }).click();
  await expect(card.getByTestId('history-occurrence')).toHaveCount(10);
  await expect(card.getByText('Goblet Squat — Tempo')).toBeVisible();
  await expect(card.getByText('Weight: Not recorded')).toBeVisible();
  await expect(card.getByText('Reps: Not recorded')).toBeVisible();
  await expect(card.getByText('RPE: Not recorded')).toBeVisible();
  await expect(card.getByText('99 prescribed only')).toHaveCount(0);
  await card.getByRole('button', { name: 'Load more' }).click();
  await expect(card.getByTestId('history-occurrence')).toHaveCount(12);
  await expect(card.getByRole('button', { name: 'Load more' })).toHaveCount(0);

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await disclosure.click();
  await disclosure.click();
  await expect(card.getByTestId('history-occurrence')).toHaveCount(12);
  expect(await page.evaluate(() => Object.keys(localStorage).filter((key) => /history/i.test(key)))).toEqual([]);

  await context.setOffline(true);
  const secondCard = page.getByTestId('tracker-exercise-card').nth(1);
  await secondCard.getByRole('button', { name: /Exercise history/ }).click();
  await expect(secondCard.getByRole('alert')).toContainText('offline');
  await expect(card.getByRole('button', { name: 'Complete set 2' })).toBeEnabled();
  await context.setOffline(false);
});

test('exercise history disclosure stays keyboard-operable without desktop overflow', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await usePreviewRole(page, 'client');
  await page.goto('/client/programs');
  await page.getByTestId('start-program-workout').first().click();

  const card = page.getByTestId('tracker-exercise-card').first();
  const disclosure = card.getByRole('button', { name: /Exercise history/ });
  await disclosure.focus();
  await page.keyboard.press('Enter');
  await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
  await expect(card.getByTestId('history-occurrence')).toHaveCount(10);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  expect(await page.getByTestId('tracker-exercise-card').evaluateAll((cards) => (
    cards.every((element) => element.scrollWidth <= element.clientWidth)
  ))).toBeTruthy();
});

test('offline finish queues completion, defers celebration, and syncs on reconnect', async ({ page }) => {
  // App-level offline: navigator.onLine override keeps the dev server
  // reachable while the outbox believes it is offline (Playwright's
  // context.setOffline would block the SPA itself on reload).
  await page.addInitScript(() => {
    window.__cvfOnline = true;
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => window.__cvfOnline });
    window.__setOnline = (value) => {
      window.__cvfOnline = value;
      window.dispatchEvent(new Event(value ? 'online' : 'offline'));
    };
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await usePreviewRole(page, 'client');
  await page.goto('/client/programs');

  await page.getByTestId('client-program-card').first().getByTestId('start-program-workout').first().click();
  await expect(page).toHaveURL(/\/client\/workouts\/[^/]+\/track$/);
  const trackPath = new URL(page.url()).pathname;

  const squat = page.getByTestId('tracker-exercise-card').first();
  await squat.getByRole('button', { name: 'Complete set 1' }).click();
  await expect(page.getByTestId('workout-save-state')).toContainText('Saved');

  await page.evaluate(() => window.__setOnline(false));
  await page.getByRole('button', { name: 'Finish workout' }).click();
  await page.getByRole('button', { name: 'Confirm completion' }).click();

  // Finished locally: detail view, waiting banner, and no celebration for
  // unsynced data (docs/offline-workout-completion.md).
  await expect(page).toHaveURL(/\/client\/workouts\/[^/]+$/);
  await expect(page.getByTestId('waiting-to-sync-banner')).toBeVisible();
  await expect(page.getByTestId('workout-completion-summary')).toHaveAttribute('data-completion-motion', 'none');

  // SPA-return to the tracker: sealed read-only with a keep-editing undo.
  await page.evaluate((path) => {
    window.history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, trackPath);
  await expect(page.getByTestId('finished-locally-banner')).toBeVisible();
  await expect(page.getByRole('spinbutton', { name: 'Goblet Squat set 1 weight', exact: true })).toBeDisabled();
  await page.getByTestId('keep-editing-button').click();
  await expect(page.getByTestId('finished-locally-banner')).toHaveCount(0);
  await expect(page.getByRole('spinbutton', { name: 'Goblet Squat set 1 weight', exact: true })).toBeEnabled();

  // Re-finish offline, then reconnect: exactly one confirmed celebration
  // and an emptied outbox.
  await page.getByRole('button', { name: 'Finish workout' }).click();
  await page.getByRole('button', { name: 'Confirm completion' }).click();
  await expect(page.getByTestId('waiting-to-sync-banner')).toBeVisible();
  await page.evaluate(() => window.__setOnline(true));
  await expect(page.getByTestId('workout-completion-summary')).toHaveAttribute('data-completion-motion', 'active');
  await expect(page.getByTestId('waiting-to-sync-banner')).toHaveCount(0);
  const outboxes = await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('cvf_workout_outbox_')).length);
  expect(outboxes).toBe(0);
});

test('session conflicts surface inline, clear on relevant edits, and keep refused bookings pending', async ({ page }) => {
  // Pin "now" to a mid-month Denver midday. Fixtures are Denver-day relative
  // and pickDay(5) must not cross a month boundary, so a real clock made this
  // fail on evenings (UTC runner) and in the last five days of every month.
  const now = new Date('2026-09-15T12:00:00-06:00');
  await page.clock.setFixedTime(now);
  await usePreviewRole(page, 'coach');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/coach/sessions', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('session-create-button')).toBeVisible();

  const pickDay = async (offsetDays) => {
    const panel = page.getByTestId('session-datetime-input-panel');
    const target = new Date(now);
    target.setDate(target.getDate() + offsetDays);
    if (target.getMonth() !== now.getMonth()) {
      await panel.getByRole('button', { name: /next/i }).click();
    }
    await panel.getByRole('grid')
      .getByRole('button', { name: new RegExp(`\\b${target.getDate()}(st|nd|rd|th)?\\b`) })
      .first().click();
  };

  // Overlapping the fixture 3:00 PM session as the same coach is a hard
  // block: the panel names the coach scope and the conflicting session.
  await page.getByTestId('session-create-button').click();
  await page.getByTestId('session-client-select').click();
  await page.getByRole('option', { name: /David/ }).click();
  await page.getByTestId('session-datetime-input').click();
  await pickDay(0);
  await page.getByTestId('time-slot').filter({ hasText: /^3:15 PM$/ }).click();
  await page.getByTestId('session-save-button').click();
  await expect(page.getByTestId('session-conflict-panel')).toBeVisible();
  await expect(page.getByTestId('session-conflict-panel')).toHaveAttribute('data-conflict-scope', 'coach');

  // Changing duration restarts the attempt, so the stale conflict clears.
  await page.getByTestId('session-duration-select').click();
  await page.getByRole('option', { name: '45 min' }).click();
  await expect(page.getByTestId('session-conflict-panel')).toHaveCount(0);

  // Booking the pending request's exact slot succeeds (nothing there yet)…
  await page.getByTestId('session-datetime-input').click();
  await pickDay(5);
  await page.getByTestId('time-slot').filter({ hasText: /^11:00 AM$/ }).click();
  await page.getByTestId('session-save-button').click();
  await expect(page.getByTestId('session-editor-drawer')).toHaveCount(0);

  // …so approving that request now conflicts: it is refused, the reason is
  // pinned to the row, and the request stays pending.
  await page.getByTestId('booking-approve-button').click();
  await expect(page.getByTestId('booking-conflict-note')).toBeVisible();
  await expect(page.getByTestId('booking-conflict-note')).toContainText('The request stays pending');
  await expect(page.getByTestId('sessions-booking-row')).toHaveCount(1);
});

const IPHONE_SAFARI_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
const IPHONE_INSTAGRAM_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/22F76 Instagram 389.0.0.28.84 (iPhone15,2; iOS 18_5; en_US)';

test('desktop clients never see the home-screen install card', async ({ page }) => {
  await usePreviewRole(page, 'client');
  await page.goto('/client');
  await expect(page.getByTestId('client-dashboard-header')).toBeVisible();
  await expect(page.getByTestId('install-card')).toHaveCount(0);
});

test.describe('home-screen install guide on iPhone Safari', () => {
  test.use({ userAgent: IPHONE_SAFARI_UA, viewport: { width: 390, height: 844 }, hasTouch: true });

  test('Home card shows the Safari steps, and "Not now" hides only the card', async ({ page }) => {
    await usePreviewRole(page, 'client');
    await page.goto('/client');
    const card = page.getByTestId('install-card');
    await expect(card).toBeVisible();
    await card.getByTestId('install-card-show-how').click();
    const guide = page.getByTestId('install-guide');
    await expect(guide).toHaveAttribute('data-install-mode', 'ios-safari');
    await expect(guide).toContainText('Add to Home Screen');
    await expect(guide.getByTestId('install-guide-copy-link')).toHaveCount(0);
    await guide.getByTestId('install-guide-done').click();
    await expect(guide).toHaveCount(0);

    await card.getByTestId('install-card-dismiss').click();
    await expect(card).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId('client-dashboard-header')).toBeVisible();
    await expect(page.getByTestId('install-card')).toHaveCount(0);

    // The menu entry survives "Not now" so the steps stay findable.
    await page.getByTestId('user-menu-trigger').filter({ visible: true }).click();
    await page.getByTestId('install-app-item').click();
    await expect(page.getByTestId('install-guide')).toHaveAttribute('data-install-mode', 'ios-safari');
  });
});

test.describe('home-screen install guide inside an iPhone in-app browser', () => {
  test.use({ userAgent: IPHONE_INSTAGRAM_UA, viewport: { width: 390, height: 844 }, hasTouch: true });

  test('guide sends the client to Safari with a copyable link', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await usePreviewRole(page, 'client');
    await page.goto('/client');
    await page.getByTestId('install-card-show-how').click();
    const guide = page.getByTestId('install-guide');
    await expect(guide).toHaveAttribute('data-install-mode', 'ios-other');
    await expect(guide).toContainText('open CVF PT in Safari first');
    await guide.getByTestId('install-guide-copy-link').click();
    await expect(page.getByText('Link copied. Paste it into Safari.')).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${new URL(page.url()).origin}/`);
  });
});

test.describe('home-screen install on Android Chrome', () => {
  test.use({
    userAgent: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36',
    viewport: { width: 390, height: 844 },
    hasTouch: true,
  });

  test('uses the native install prompt when Chrome offers one', async ({ page }) => {
    await usePreviewRole(page, 'client');
    await page.goto('/client');
    await expect(page.getByTestId('install-card')).toBeVisible();
    // Headless Chrome never fires beforeinstallprompt; simulate Chrome's event.
    await page.evaluate(() => {
      const event = new Event('beforeinstallprompt', { cancelable: true });
      event.prompt = () => { window.__installPrompted = true; };
      event.userChoice = Promise.resolve({ outcome: 'dismissed' });
      window.dispatchEvent(event);
    });
    await page.getByTestId('install-card-show-how').click();
    await expect.poll(() => page.evaluate(() => window.__installPrompted === true)).toBe(true);
    await expect(page.getByTestId('install-guide')).toHaveCount(0);
  });
});

test('focused entry is opt-in and never turns a target into a logged value', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await usePreviewRole(page, 'client');
  await page.goto('/client/programs');
  await page.getByTestId('start-program-workout').first().click();
  await expect(page.getByTestId('workout-tracker')).toBeVisible();
  // Off by default: the set table renders until the device opts in.
  await expect(page.getByTestId('tracker-exercise-card').first()).toBeVisible();
  await expect(page.getByTestId('focused-entry')).toHaveCount(0);

  // ?entry=focused opts this device in and is remembered. Preview data lives
  // in memory, so opt in first, then start a fresh workout.
  await page.goto('/client/workouts/opt-in/track?entry=focused');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('cvf_set_entry'))).toBe('focused');
  await page.goto('/client/programs');
  await page.getByTestId('start-program-workout').first().click();
  await expect(page.getByTestId('focused-entry')).toBeVisible();
  await expect(page.getByTestId('tracker-exercise-card')).toHaveCount(0);
  await expect(page.getByText('Reps (optional)')).toBeVisible();

  // Log set 1 with only a weight: reps and RPE stay "not recorded".
  await page.locator('#focused-weight').fill('40');
  await page.getByTestId('focused-log-set').click();
  await expect(page.getByTestId('workout-save-state')).toContainText('Saved');
  await expect(page.getByTestId('focused-logged-values').first()).toHaveText('40 lb · reps not recorded · RPE not recorded');

  // The dedicated rest screen replaces the fields, then hands back to set 2.
  await expect(page.getByTestId('focused-rest')).toBeVisible();
  await page.getByRole('button', { name: '+30s' }).click();
  await page.getByTestId('focused-skip-rest').click();
  await expect(page.getByText('Set 2 of 3')).toBeVisible();

  // RPE keeps half-point steps and can be cleared back to not recorded.
  await page.getByRole('button', { name: 'Increase RPE' }).click();
  await page.getByRole('button', { name: 'Increase RPE' }).click();
  await expect(page.locator('#focused-rpe')).toHaveValue('7.5');
  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(page.locator('#focused-rpe')).toHaveValue('');

  // Correct set 1 explicitly, then check the saved values.
  await page.getByRole('button', { name: 'Edit set 1' }).click();
  await expect(page.getByTestId('focused-editing-banner')).toContainText('Editing set 1');
  await page.locator('#focused-reps').fill('10');
  await page.getByTestId('focused-save-edit').click();
  await expect(page.getByTestId('focused-logged-values').first()).toHaveText('40 lb · 10 reps · RPE not recorded');

  // Finish stays reachable and keeps both feedback and workout notes.
  await page.getByTestId('focused-finish-button').click();
  const dialog = page.getByTestId('workout-completion-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('finish-exercise-counts')).toBeVisible();
  await expect(dialog.getByLabel('Feedback for your coach')).toBeVisible();
  await expect(dialog.getByLabel('Workout notes')).toBeVisible();
  await expect(dialog.getByTestId('finish-mark-remaining-done')).toContainText('Mark the other 8 sets done');
  await page.keyboard.press('Escape');

  // ?entry=list turns it back off for this device.
  await page.goto('/client/workouts/opt-out/track?entry=list');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('cvf_set_entry'))).toBe('list');
});

test('coach agenda and client home follow the round-2 structure', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await usePreviewRole(page, 'coach');
  await page.goto('/coach');
  await expect(page.getByTestId('coach-day-summary')).toContainText('waiting on you');
  const agenda = page.getByTestId('coach-dashboard-today-sessions-card');
  await expect(agenda.getByTestId('agenda-workout-done-chip')).toBeVisible();
  await expect(agenda.getByTestId('agenda-confirm-complete-button')).toBeVisible();
  // On desktop the agenda and the queue sit side by side.
  const [agendaBox, queueBox] = await Promise.all([agenda.boundingBox(), page.getByTestId('coach-action-queue').boundingBox()]);
  expect(queueBox.x).toBeGreaterThan(agendaBox.x + agendaBox.width - 1);

  await usePreviewRole(page, 'client');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/client');
  const plan = page.getByTestId('client-today-plan');
  await expect(plan).toBeVisible();
  await expect(page.getByTestId('week-legend')).toBeVisible();
  // Today's work comes before yesterday's catch-up reminder.
  const catchUp = page.getByTestId('catch-up-card');
  if (await catchUp.count()) {
    expect((await catchUp.boundingBox()).y).toBeGreaterThan((await plan.boundingBox()).y);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
});

test('coaches pick up to three goal measures that show on both dashboards', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await usePreviewRole(page, 'coach');
  await page.goto('/coach');
  const goalCard = page.getByTestId('coach-goal-clients-card');
  const sarah = goalCard.getByTestId('coach-goal-client').filter({ hasText: 'Sarah Martinez' });
  await expect(sarah.getByTestId('goal-measure-row')).toHaveCount(2);
  await expect(sarah).toContainText('Goal 155 lbs');
  // Clients by goal sits under the agenda on desktop, not below the queue.
  const agendaBox = await page.getByTestId('coach-dashboard-today-sessions-card').boundingBox();
  const goalBox = await goalCard.boundingBox();
  expect(Math.abs(goalBox.x - agendaBox.x)).toBeLessThan(2);
  expect(goalBox.y).toBeGreaterThan(agendaBox.y + agendaBox.height - 1);

  await page.goto('/coach/clients/client_sarah?tab=progress');
  await expect(page.getByTestId('metric-goal-measure-badge')).toHaveCount(2);
  await page.getByTestId('add-metric-button').click();
  await page.getByTestId('metric-name-input').fill('Back Squat 1RM');
  await page.getByTestId('metric-goal-measure-switch').click();
  await page.getByTestId('metric-save-button').click();
  await expect(page.getByTestId('metric-goal-measure-badge')).toHaveCount(3);
  // A fourth is refused before it reaches the API.
  await page.getByTestId('add-metric-button').click();
  await expect(page.getByTestId('metric-goal-measure-switch')).toBeDisabled();
  await expect(page.getByTestId('metric-goal-measure-help')).toContainText('already has 3 goal measures');
  await page.keyboard.press('Escape');

  await usePreviewRole(page, 'client');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/client');
  const clientGoal = page.getByTestId('client-goal-card');
  await expect(clientGoal.getByTestId('client-goal-text')).toContainText('run a 10k');
  await expect(clientGoal.getByTestId('goal-measure-row')).toHaveCount(2);
  await expect(clientGoal.getByTestId('goal-measure-row').first()).toContainText('162 lbs');
  await expect(clientGoal.getByTestId('goal-measure-change').first()).toHaveText('−6 lbs');
  // Today's plan stays first on the home screen.
  expect((await clientGoal.boundingBox()).y).toBeGreaterThan((await page.getByTestId('client-today-plan').boundingBox()).y);
});

test('home never offers a new workout when training data fails, and recovers on retry', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await usePreviewRole(page, 'client');
  // Each request can fail on its own; any one of them makes today unknown.
  for (const failing of ['get /programs/client/assigned', 'get /workout-logs/active', 'get /workout-logs/mine']) {
    // Twice: dev-mode StrictMode runs Home's load effect twice on mount.
    await page.addInitScript((key) => { globalThis.__CVF_PREVIEW_FAIL_ONCE__ = [key, key]; }, failing);
    await page.goto('/client');
    const action = page.getByTestId('client-today-primary-action');
    await expect(action, failing).toHaveText('Try again');
    await expect(page.getByTestId('client-today-quick-complete')).toHaveCount(0);
    await expect(page.getByTestId('client-today-plan-description')).toContainText('isn’t a rest day');
    await action.click();
    await expect(action, `${failing} retry`).toHaveText(/Start workout/);
    await expect(page.getByTestId('client-today-quick-complete')).toBeVisible();
  }
});

test('a confirmed active workout stays resumable even if history fails', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await usePreviewRole(page, 'client');
  await page.addInitScript(() => {
    localStorage.setItem('cvf_preview_home_state', 'active');
    globalThis.__CVF_PREVIEW_FAIL_ONCE__ = ['get /workout-logs/mine', 'get /workout-logs/mine'];
  });
  await page.goto('/client');
  await expect(page.getByTestId('client-today-primary-action')).toHaveText(/Resume workout/);
});

test('every client home state renders its own plan', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await usePreviewRole(page, 'client');
  const expected = {
    ready: { action: /Start workout/ },
    active: { action: /Resume workout/ },
    done: { action: /View workout|Read feedback/ },
    'no-workout': { title: 'No workout scheduled today' },
    unassigned: { action: /Message your coach/ },
    unavailable: { action: /Try again/ },
  };
  for (const [state, want] of Object.entries(expected)) {
    await page.addInitScript((value) => localStorage.setItem('cvf_preview_home_state', value), state);
    await page.goto('/client');
    if (want.action) await expect(page.getByTestId('client-today-primary-action'), state).toHaveText(want.action);
    if (want.title) await expect(page.getByTestId('client-today-plan-title'), state).toHaveText(want.title);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), state).toBeTruthy();
  }
});

test('busy coach day and a strength/run goal client render', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await usePreviewRole(page, 'coach');
  await page.goto('/coach');
  const agenda = page.getByTestId('coach-dashboard-today-sessions-card');
  await expect(agenda.getByTestId('today-session-row')).toHaveCount(6);
  await expect(page.getByTestId('coach-day-summary')).toContainText('6 sessions today');
  const ana = page.getByTestId('coach-goal-client').filter({ hasText: 'Ana Lucero' });
  await expect(ana).toContainText('Run a sub-25 5K');
  await expect(ana.getByTestId('goal-measure-row').filter({ hasText: '5K time' })).toContainText('Goal 25 min');
  await expect(ana.getByTestId('goal-measure-row').filter({ hasText: 'Deadlift 1RM' })).toContainText('210 lb');
});

test('the desktop top bar keeps account and notifications on screen for every role', async ({ page }) => {
  for (const role of ['client', 'coach', 'admin']) {
    await usePreviewRole(page, role);
    for (const width of [1023, 1024, 1100, 1279, 1280, 1440]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(role === 'client' ? '/client' : '/coach');
      const account = page.getByTestId('mobile-header-actions').getByTestId('user-menu-trigger');
      await expect(account).toBeVisible();
      const box = await account.boundingBox();
      expect(box.x + box.width, `${role} ${width} account`).toBeLessThanOrEqual(width);
      if (role !== 'client' && width >= 1024) {
        const bell = await page.getByTestId('desktop-notifications-link').boundingBox();
        expect(bell.x >= 0 && bell.x + bell.width <= width, `${role} ${width} notifications`).toBeTruthy();
      }
    }
  }
});

test('the closed corner menu is hidden from assistive tech; the open one is modal', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await usePreviewRole(page, 'client');
  await page.goto('/client');
  const fab = page.getByTestId('mobile-menu-button');
  const nav = page.getByRole('navigation', { name: 'Main' });
  // Closed: none of the six destinations are exposed.
  await expect(page.getByRole('link', { name: /^Sessions/ })).toHaveCount(0);
  await expect(page.locator('[data-testid="mobile-bottom-navigation"] nav')).toHaveAttribute('aria-hidden', 'true');

  // Open with the keyboard (a screen reader's activate sends the same click).
  await fab.focus();
  await page.keyboard.press('Enter');
  await expect(fab).toHaveAttribute('aria-expanded', 'true');
  await expect(nav.getByRole('link', { name: /^Home/ })).toBeFocused();
  await expect(nav.getByRole('link')).toHaveCount(6);
  await expect(page.locator('main')).toHaveAttribute('inert', '');
  // Tab stays inside the menu (six items plus the close button).
  for (let i = 0; i < 7; i += 1) await page.keyboard.press('Tab');
  await expect(nav.getByRole('link', { name: /^Home/ })).toBeFocused();
  // Escape closes and returns focus to the button.
  await page.keyboard.press('Escape');
  await expect(fab).toHaveAttribute('aria-expanded', 'false');
  await expect(fab).toBeFocused();
  await expect(page.locator('main')).not.toHaveAttribute('inert', '');

  // Tap opens; tapping outside closes.
  await fab.click();
  await expect(fab).toHaveAttribute('aria-expanded', 'true');
  await page.mouse.click(40, 300);
  await expect(fab).toHaveAttribute('aria-expanded', 'false');
});
