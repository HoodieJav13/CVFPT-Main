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
  await expect(page.getByRole('heading', { name: 'Hey, Marcus' })).toBeVisible();
  await expect(page.getByTestId('coach-dashboard-today-sessions-card')).toBeVisible();

  await page.getByTestId('sidebar-nav-clients').click();
  await expect(page.getByRole('heading', { name: 'Clients' })).toBeVisible();
  await page.getByTestId('add-client-button').click();
  await page.getByTestId('client-name-input').fill('CVF TEST Browser Client');
  await page.getByTestId('client-email-input').fill('cvf-test-browser@example.invalid');
  await page.getByTestId('client-save-button').click();
  await expect(page.getByText('CVF TEST Browser Client added')).toBeVisible();
  await expect(page.getByText('cvf-test-browser@example.invalid')).toBeVisible();

  await page.getByTestId('sidebar-nav-sessions').click();
  await expect(page.getByTestId('session-create-button')).toBeVisible();
  await expect(page.getByTestId('session-row').first()).toBeVisible();

  await page.getByTestId('sidebar-nav-programs').click();
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

  await page.getByTestId('sidebar-nav-resources').click();
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

  await page.getByTestId('sidebar-nav-messages').click();
  await expect(page.getByTestId('message-thread-row').first()).toBeVisible();
});

test('exercise library filters narrow the list, combine with search, and clear at mobile width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await usePreviewRole(page, 'coach');
  await page.goto('/coach/programs');
  await expect(page.getByTestId('exercise-library-filters')).toBeVisible();

  const cards = page.getByTestId('exercise-library-card');
  const total = await cards.count();
  expect(total).toBeGreaterThan(1);
  await expect(page.getByTestId('exercise-library-count')).toHaveText(`${total} exercises`);
  await expect(page.getByTestId('exercise-library-clear-filters')).toHaveCount(0);

  await page.getByTestId('exercise-library-filter-category').click();
  const options = page.getByRole('option');
  expect(await options.count()).toBeGreaterThan(1);
  await options.nth(1).click();
  const narrowed = await cards.count();
  expect(narrowed).toBeGreaterThan(0);
  expect(narrowed).toBeLessThanOrEqual(total);
  await expect(page.getByTestId('exercise-library-count')).toHaveText(`Showing ${narrowed} of ${total} exercises`);

  await page.getByTestId('exercise-library-search-input').fill('zzz-no-such-exercise');
  await expect(cards).toHaveCount(0);
  await expect(page.getByText('Nothing matches these filters. Try clearing them.')).toBeVisible();

  await page.getByTestId('exercise-library-clear-filters').click();
  await expect(cards).toHaveCount(total);
  await expect(page.getByTestId('exercise-library-count')).toHaveText(`${total} exercises`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
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
  await expect(page.getByRole('heading', { name: 'Today, Sarah' })).toBeVisible();
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
  await expect(page.getByTestId('sidebar-nav-packages-credits')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Today, Sarah' })).toBeVisible();

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

test('brand backdrop variants, one-time dashboard motion, and genuine PR moment stay wired', async ({ page }) => {
  await usePreviewRole(page, 'client');
  await page.goto('/client');

  const dashboardBackdrop = page.getByTestId('brand-backdrop-dashboard');
  await expect(dashboardBackdrop).toHaveAttribute('data-photo-state', 'fallback');
  await expect(dashboardBackdrop).toHaveAttribute('data-intensity', 'spectacle');
  await expect(dashboardBackdrop).toHaveAttribute('data-signature-treatment', 'poster');
  await expect(dashboardBackdrop.locator('.brand-backdrop__photo')).toHaveCount(0);
  await expect(page.locator('[data-entry-motion]')).toHaveAttribute('data-entry-motion', 'enabled');
  await expect(page.locator('[data-motion-intensity]')).toHaveAttribute('data-motion-intensity', 'spectacle');
  await expect(page.locator('[data-entry-direction]')).toHaveAttribute('data-entry-direction', 'surge');
  await expect(page.getByTestId('preview-intensity-select')).toHaveCount(0);

  await page.evaluate(() => localStorage.setItem('cvfpt_visual_intensity', 'restrained'));
  await page.reload();
  await expect(page.getByTestId('brand-backdrop-dashboard')).toHaveAttribute('data-intensity', 'spectacle');
  await expect(page.locator('[data-motion-intensity]')).toHaveAttribute('data-motion-intensity', 'spectacle');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('cvfpt_visual_intensity'))).toBe('restrained');

  await page.getByTestId('sidebar-nav-programs').click();
  await page.getByTestId('sidebar-nav-home').click();
  await expect(page.locator('[data-entry-motion]')).toHaveAttribute('data-entry-motion', 'skipped');
  await page.reload();
  await expect(page.locator('[data-entry-motion]')).toHaveAttribute('data-entry-motion', 'skipped');

  await page.getByTestId('sidebar-nav-progress').click();
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
  await expect(page.getByTestId('bottom-tab-sessions')).toBeVisible();
  await page.getByTestId('bottom-tab-sessions').click();
  await expect(page).toHaveURL(/\/client\/sessions$/);
  await expect(page.getByTestId('booking-request-button')).toBeVisible();
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

async function runConflictFlow(page) {
  await usePreviewRole(page, 'coach');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/coach/sessions', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('session-create-button')).toBeVisible();

  // Days are computed in the BROWSER (so a fixed browser clock and timezone stay consistent with the
  // calendar) and chosen by the full date. Selecting by the day NUMBER alone is ambiguous at month
  // boundaries: on Sept 30 the calendar also shows "Sunday, August 30th" as a leading day, listed first.
  const pickDay = async (offsetDays) => {
    const panel = page.getByTestId('session-datetime-input-panel');
    const { dateKey, sameMonth } = await page.evaluate((offset) => {
      const now = new Date();
      const target = new Date(now);
      target.setDate(target.getDate() + offset);
      const pad = (n) => String(n).padStart(2, '0');
      return {
        dateKey: `${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(target.getDate())}`,
        sameMonth: target.getMonth() === now.getMonth(),
      };
    }, offsetDays);
    if (!sameMonth) await panel.getByRole('button', { name: /next/i }).click();
    await panel.locator(`[data-day="${dateKey}"]`).getByRole('button').click();
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
}

test('session conflicts surface inline, clear on relevant edits, and keep refused bookings pending', async ({ page }) => {
  await runConflictFlow(page);
});

// Date-boundary regression: the same flow under fixed browser clocks, including month ends where the
// calendar shows leading days from the previous month (the reproduced failure was Sept 30).
test.describe('session conflict flow at month boundaries', () => {
  test.use({ timezoneId: 'America/Denver' });
  for (const instant of ['2026-09-30T22:54:00-06:00', '2026-10-01T06:29:00-06:00', '2026-01-31T12:00:00-07:00', '2026-03-31T12:00:00-06:00']) {
    test(`at ${instant}`, async ({ page }) => {
      await page.clock.setFixedTime(new Date(instant));
      await runConflictFlow(page);
    });
  }
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

test('workout builder links supersets and giant sets and reorders exercises at mobile width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await usePreviewRole(page, 'coach');
  await page.goto('/coach/programs');
  await page.getByTestId('training-builder-tab-workouts').click();
  await page.getByTestId('workout-create-button').click();

  const dialog = page.getByRole('dialog');
  const names = dialog.getByTestId('workout-exercise-name-input');
  await names.first().fill('Bench Press');
  for (const name of ['Chest-Supported Row', 'Curl']) {
    await dialog.getByTestId('workout-exercise-add-button').click();
    const rows = dialog.getByTestId('workout-exercise-row');
    await rows.last().locator('h3 button').click(); // expand the new row
    await names.last().fill(name);
  }
  const markers = dialog.getByTestId('workout-exercise-marker');
  const order = () => names.evaluateAll((inputs) => inputs.map((input) => input.value));
  await expect(markers).toHaveText(['1', '2', '3']);

  // Bench + Row -> superset; then + Curl -> giant set.
  await dialog.getByTestId('workout-exercise-link-button').first().click();
  await expect(dialog.getByTestId('workout-superset-label')).toContainText('Superset · 2 exercises');
  await expect(markers).toHaveText(['A1', 'A2', 'B']);
  await dialog.getByTestId('workout-exercise-link-button').click();
  await expect(dialog.getByTestId('workout-superset-label')).toContainText('Giant set · 3 exercises');
  await expect(markers).toHaveText(['A1', 'A2', 'A3']);

  // Reorder inside the group keeps it intact.
  await dialog.getByLabel('Move Curl up').click();
  await expect.poll(order).toEqual(['Bench Press', 'Curl', 'Chest-Supported Row']);
  await expect(dialog.getByTestId('workout-superset-group')).toHaveCount(1);

  // Split off the last exercise, then move it above the superset as a block.
  await dialog.getByTestId('workout-exercise-unlink-button').nth(1).click();
  await expect(markers).toHaveText(['A1', 'A2', 'B']);
  await dialog.getByTestId('workout-superset-move-down-button').click();
  await expect.poll(order).toEqual(['Chest-Supported Row', 'Bench Press', 'Curl']);
  await expect(markers).toHaveText(['A', 'B1', 'B2']);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  if (process.env.CVF_SHOT_DIR) await dialog.screenshot({ path: `${process.env.CVF_SHOT_DIR}/builder-mobile.png` });

  await dialog.getByTestId('workout-superset-ungroup-button').click();
  await expect(dialog.getByTestId('workout-superset-group')).toHaveCount(0);
  await expect(markers).toHaveText(['1', '2', '3']);

  // Drag and drop with a pointer: Curl (3rd) dragged onto the top row.
  const openRows = dialog.locator('[data-testid="workout-exercise-row"] h3 button[data-state="open"]');
  while (await openRows.count()) await openRows.first().click();
  const handles = dialog.getByTestId('workout-exercise-drag-handle');
  const from = await handles.nth(2).boundingBox();
  const to = await handles.nth(0).boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2, from.y - 10, { steps: 5 });
  await page.mouse.move(to.x + to.width / 2, to.y + 4, { steps: 12 });
  await page.mouse.up();
  await expect(dialog.getByTestId('workout-exercise-row').locator('h3')).toHaveText([/Curl/, /Chest-Supported Row/, /Bench Press/]);

  // Keyboard dragging: focus the grip, space to lift, arrow down, space to drop.
  await handles.nth(0).focus();
  // dnd-kit measures drop positions between keystrokes.
  for (const key of ['Space', 'ArrowDown', 'Space']) {
    await page.keyboard.press(key);
    await page.waitForTimeout(250);
  }
  await expect(dialog.getByTestId('workout-exercise-row').locator('h3')).toHaveText([/Chest-Supported Row/, /Curl/, /Bench Press/]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  if (process.env.CVF_SHOT_DIR) await dialog.screenshot({ path: `${process.env.CVF_SHOT_DIR}/builder-drag-mobile.png` });
});

test('a saved superset survives reopen, reaches the client tracker, and rests once per round', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await usePreviewRole(page, 'coach');
  await page.goto('/coach/programs');
  await page.getByTestId('training-builder-tab-workouts').click();
  const rail = page.getByTestId('workout-rail-row');
  await rail.filter({ hasText: 'Lower Strength A' }).click();

  // Link RDL + Pallof (rows 2 and 3) and save.
  await page.getByTestId('workout-exercise-link-button').nth(1).click();
  await expect(page.getByTestId('workout-superset-label')).toContainText('Superset · 2 exercises');
  // The fixed preview toolbar overlaps the pane's Save at this width; use
  // the keyboard (a real path) rather than a forced click.
  await page.getByTestId('workout-save-button').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Workout updated')).toBeVisible();

  // Reopen from the list: the group came back from the saved copy.
  await rail.filter({ hasText: 'Upper Strength A' }).click();
  await expect(page.getByTestId('workout-superset-group')).toHaveCount(0);
  await rail.filter({ hasText: 'Lower Strength A' }).click();
  await expect(page.getByTestId('workout-superset-label')).toContainText('Superset · 2 exercises');
  await expect(page.getByTestId('workout-exercise-marker')).toHaveText(['A', 'B1', 'B2']);

  // Same in-memory preview data, now as the client (no reload).
  await page.getByTestId('preview-role-select').selectOption('client');
  await expect(page).toHaveURL(/\/client$/);
  await page.evaluate(() => {
    window.history.pushState({}, '', '/client/programs');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(page.getByTestId('superset-group').first()).toContainText('alternate B1–B2');
  await page.getByTestId('client-program-card').first().getByTestId('start-program-workout').first().click();
  await expect(page).toHaveURL(/\/client\/workouts\/[^/]+\/track$/);

  const group = page.getByTestId('superset-group');
  await expect(group).toHaveCount(1);
  // Rest is the longest in the group: RDL 90s vs Pallof 45s.
  await expect(group).toContainText('alternate B1–B2, then rest 1:30');
  const cards = page.getByTestId('tracker-exercise-card');
  const [squat, rdl, pallof] = [cards.nth(0), cards.nth(1), cards.nth(2)];
  await expect(rdl.getByTestId('exercise-marker')).toHaveText('B1');
  await expect(pallof.getByTestId('exercise-marker')).toHaveText('B2');
  const timer = page.getByTestId('rest-timer');

  // Straight set: its own rest starts.
  await squat.getByRole('button', { name: 'Complete set 1' }).click();
  await expect(timer).toBeVisible();
  // B1 mid-round: no rest, and the running timer is cleared.
  await rdl.getByRole('button', { name: 'Complete set 1' }).click();
  await expect(timer).toHaveCount(0);
  // B2 closes the round: one 1:30 rest.
  await pallof.getByRole('button', { name: 'Complete set 1' }).click();
  await expect(timer).toBeVisible();
  await expect(timer).toHaveText(/1:(30|29|28)/);
  // Next round starts on B1 again: no rest until B2.
  await rdl.getByRole('button', { name: 'Complete set 2' }).click();
  await expect(timer).toHaveCount(0);
});

test.describe('touch device', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('builder rows reorder by touch-dragging the grip inside a scrolling dialog', async ({ page }) => {
    await usePreviewRole(page, 'coach');
    await page.goto('/coach/programs');
    await page.getByTestId('training-builder-tab-workouts').tap();
    const card = page.locator('[data-testid="workout-edit-button"][aria-label="Edit Lower Strength A"]');
    await card.tap();
    const dialog = page.getByRole('dialog');
    const titles = dialog.getByTestId('workout-exercise-row').locator('h3');
    await expect(titles).toHaveText([/Goblet Squat/, /Romanian Deadlift/, /Half-kneeling Pallof Press/]);
    // Leave the first row expanded so the dialog scrolls: a grip that let
    // the browser treat the gesture as a pan would scroll instead of drag.
    await dialog.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    expect(await dialog.evaluate((element) => element.scrollHeight > element.clientHeight + 100)).toBeTruthy();

    // Real touch input through Chromium's input pipeline (touch -> pointer
    // events), not mouse events: drag the Pallof grip up onto the RDL row.
    const cdp = await page.context().newCDPSession(page);
    const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', {
      type, touchPoints: type === 'touchEnd' ? [] : [{ x: Math.round(x), y: Math.round(y) }],
    });
    const handles = dialog.getByTestId('workout-exercise-drag-handle');
    const from = await handles.nth(2).boundingBox();
    const to = await handles.nth(1).boundingBox();
    const x = from.x + from.width / 2;
    await touch('touchStart', x, from.y + from.height / 2);
    const steps = 14;
    for (let i = 1; i <= steps; i += 1) {
      const y = from.y + from.height / 2 + ((to.y + 4) - (from.y + from.height / 2)) * (i / steps);
      await touch('touchMove', x, y);
      await page.waitForTimeout(16);
    }
    await touch('touchEnd');

    // Pallof moved up (dnd-kit may auto-scroll the dialog near its edge, so
    // the exact slot can vary); the other two keep their order. Without
    // touch-action: none on the grip, Chromium pans instead and nothing moves.
    await expect.poll(async () => {
      const order = (await titles.allTextContents()).map((text) => (/Pallof/.test(text) ? 'P' : /Goblet/.test(text) ? 'G' : 'R'));
      return order.indexOf('P') < 2 && order.indexOf('G') < order.indexOf('R');
    }).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  });
});

test('re-opening a workout while the list reload is slow shows the saved superset, and saving again keeps it', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await usePreviewRole(page, 'coach');
  await page.goto('/coach/programs');
  await page.getByTestId('training-builder-tab-workouts').click();
  const rail = page.getByTestId('workout-rail-row');
  const reopenLower = async () => {
    await rail.filter({ hasText: 'Upper Strength A' }).click();
    await rail.filter({ hasText: 'Lower Strength A' }).click();
  };
  const save = async () => {
    // The fixed preview toolbar overlaps the pane's Save at this width.
    await page.getByTestId('workout-save-button').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Workout updated').last()).toBeVisible();
  };
  await rail.filter({ hasText: 'Lower Strength A' }).click();

  // From here on the workout list reload is slow (preview test harness).
  await page.evaluate(() => localStorage.setItem('cvf_preview_latency', JSON.stringify([{ path: '^/programs/workouts$', ms: 2500 }])));
  await page.getByTestId('workout-exercise-link-button').nth(1).click();
  await save();

  // Switch away and back before the reload lands: the saved group shows.
  await reopenLower();
  await expect(page.getByTestId('workout-superset-label')).toContainText('Superset · 2 exercises');
  await expect(page.getByTestId('workout-exercise-marker')).toHaveText(['A', 'B1', 'B2']);

  // Saving again from that form keeps the group once everything settles.
  await save();
  await page.evaluate(() => localStorage.removeItem('cvf_preview_latency'));
  await page.waitForTimeout(3000);
  await reopenLower();
  await expect(page.getByTestId('workout-superset-label')).toContainText('Superset · 2 exercises');
  await expect(page.getByTestId('workout-exercise-marker')).toHaveText(['A', 'B1', 'B2']);
});

test('switching workouts while a save is pending never retargets the editor or overwrites the other workout', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await usePreviewRole(page, 'coach');
  await page.goto('/coach/programs');
  await page.getByTestId('training-builder-tab-workouts').click();
  const rail = page.getByTestId('workout-rail-row');
  const titles = page.getByTestId('workout-exercise-row').locator('h3');
  const pressSave = async () => {
    // The fixed preview toolbar overlaps the pane's Save at this width.
    await page.getByTestId('workout-save-button').focus();
    await page.keyboard.press('Enter');
  };

  await rail.filter({ hasText: 'Lower Strength A' }).click();
  await page.getByTestId('workout-exercise-link-button').nth(1).click();
  // Slow the save (PUT /programs/workouts/:id) via the preview test harness.
  await page.evaluate(() => localStorage.setItem('cvf_preview_latency', JSON.stringify([{ path: '^/programs/workouts/[^/]+$', ms: 2000 }])));
  await pressSave();

  // Open another workout while Lower's save is still in flight.
  await rail.filter({ hasText: 'Upper Strength A' }).click();
  await expect(titles).toHaveText([/Bench/, /Row/]);
  await expect(page.getByText('Workout updated').first()).toBeVisible({ timeout: 6000 });

  // The response must not retarget the editor: still Upper, with Upper's rows.
  await expect(page.getByRole('heading', { name: 'Upper Strength A' })).toBeVisible();
  await expect(titles).toHaveText([/Bench/, /Row/]);

  // Saving now writes Upper, not Lower.
  await page.evaluate(() => localStorage.removeItem('cvf_preview_latency'));
  await pressSave();
  await expect(page.getByTestId('workout-save-button')).toBeDisabled();
  await expect(page.getByTestId('workout-save-button')).toBeEnabled({ timeout: 6000 });
  await page.waitForTimeout(1500); // let the background list reload land

  await rail.filter({ hasText: 'Lower Strength A' }).click();
  await expect(titles).toHaveText([/Goblet Squat/, /Romanian Deadlift/, /Pallof/]);
  await expect(page.getByTestId('workout-superset-label')).toContainText('Superset · 2 exercises');
  await rail.filter({ hasText: 'Upper Strength A' }).click();
  await expect(titles).toHaveText([/Bench/, /Row/]);
  await expect(page.getByTestId('workout-superset-group')).toHaveCount(0);
});

test('returning to a workout while its save is still in flight shows the edits being saved', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await usePreviewRole(page, 'coach');
  await page.goto('/coach/programs');
  await page.getByTestId('training-builder-tab-workouts').click();
  const rail = page.getByTestId('workout-rail-row');
  const pressSave = async () => {
    // The fixed preview toolbar overlaps the pane's Save at this width.
    await page.getByTestId('workout-save-button').focus();
    await page.keyboard.press('Enter');
  };

  await rail.filter({ hasText: 'Lower Strength A' }).click();
  await page.getByTestId('workout-exercise-link-button').nth(1).click();
  // Slow the save (PUT /programs/workouts/:id) via the preview test harness.
  await page.evaluate(() => localStorage.setItem('cvf_preview_latency', JSON.stringify([{ path: '^/programs/workouts/[^/]+$', ms: 2500 }])));
  await pressSave();

  // Away and straight back while the save is still pending.
  await rail.filter({ hasText: 'Upper Strength A' }).click();
  await rail.filter({ hasText: 'Lower Strength A' }).click();
  await expect(page.getByTestId('workout-superset-label')).toContainText('Superset · 2 exercises');
  await expect(page.getByTestId('workout-exercise-marker')).toHaveText(['A', 'B1', 'B2']);

  // Once it lands, saving again from this form keeps the superset.
  await expect(page.getByTestId('workout-save-button')).toBeEnabled({ timeout: 6000 });
  await page.evaluate(() => localStorage.removeItem('cvf_preview_latency'));
  await pressSave();
  await expect(page.getByTestId('workout-save-button')).toBeEnabled({ timeout: 6000 });
  await page.waitForTimeout(1500); // let the background list reload land
  await rail.filter({ hasText: 'Upper Strength A' }).click();
  await rail.filter({ hasText: 'Lower Strength A' }).click();
  await expect(page.getByTestId('workout-superset-label')).toContainText('Superset · 2 exercises');
  await expect(page.getByTestId('workout-exercise-marker')).toHaveText(['A', 'B1', 'B2']);
});
