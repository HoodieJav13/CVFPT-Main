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

  const row = page.getByTestId('booking-request-row').first();
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

test('client preview covers dashboard and every client navigation destination', async ({ page }) => {
  await usePreviewRole(page, 'client');
  await page.goto('/client');
  await expect(page.getByRole('heading', { name: 'Today, Sarah' })).toBeVisible();
  await expect(page.getByTestId('daily-check-in-card')).toBeVisible();

  await page.goto('/client/sessions');
  await expect(page.getByTestId('booking-request-button')).toBeVisible();
  await expect(page.getByTestId('client-upcoming-session-row').first()).toBeVisible();

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

test('brand backdrop variants, one-time dashboard motion, and genuine PR moment stay wired', async ({ page }) => {
  await usePreviewRole(page, 'client');
  await page.goto('/client');

  const dashboardBackdrop = page.getByTestId('brand-backdrop-dashboard');
  await expect(dashboardBackdrop).toHaveAttribute('data-photo-state', 'fallback');
  await expect(dashboardBackdrop).toHaveAttribute('data-intensity', 'spectacle');
  await expect(dashboardBackdrop.locator('.brand-backdrop__photo')).toHaveCount(0);
  await expect(page.locator('[data-entry-motion]')).toHaveAttribute('data-entry-motion', 'enabled');
  await expect(page.locator('[data-motion-intensity]')).toHaveAttribute('data-motion-intensity', 'spectacle');
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
  await expect(squat.getByText('Rest 90s')).toBeVisible();

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
  await expect(page.getByRole('button', { name: 'Finish workout' })).toBeDisabled();

  await context.setOffline(false);
  await expect(page.getByTestId('workout-save-state')).toContainText('Saved');
  await expect(page.getByLabel(/Rest timer/)).toBeVisible();

  await page.getByRole('button', { name: 'Finish workout' }).click();
  await page.getByLabel('Feedback for your coach').fill('Strong session from the preview flow.');
  await page.getByRole('button', { name: 'Confirm completion' }).click();
  await expect(page).toHaveURL(/\/client\/workouts\/[^/]+$/);
  await expect(page.getByText('Strong session from the preview flow.')).toBeVisible();
  await expect(page.getByText('Offline sequence preserved.')).toBeVisible();
  await expect(page.getByText('37.5 kg')).toBeVisible();
  await expect(page.getByText('1 completed')).toBeVisible();
  await expect(page.getByText('8 skipped')).toBeVisible();
  await expect(page.getByText('42.5 kg')).toHaveCount(0);

  await page.getByTestId('preview-toolbar-toggle').click();
  await page.getByTestId('preview-role-select').selectOption('coach');
  await expect(page).toHaveURL(/\/coach$/);
  await page.getByTestId('mobile-notifications-link').click();
  await expect(page.getByTestId('notification-row').filter({ hasText: 'Lower Strength A' })).toBeVisible();
  await page.getByTestId('notification-row').filter({ hasText: 'Lower Strength A' }).click();
  await expect(page).toHaveURL(/\/coach\/workouts\/[^/]+$/);
  await expect(page.getByText('Strong session from the preview flow.')).toBeVisible();
  const messageClient = page.getByRole('link', { name: 'Message client' });
  const quickAdd = page.getByTestId('coach-quick-add-button');
  await expect(messageClient).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const [messageRect, quickAddRect] = await Promise.all([messageClient.boundingBox(), quickAdd.boundingBox()]);
  expect(messageRect.height).toBeGreaterThanOrEqual(44);
  expect(
    messageRect.right <= quickAddRect.x
      || quickAddRect.x + quickAddRect.width <= messageRect.x
      || messageRect.y + messageRect.height <= quickAddRect.y
      || quickAddRect.y + quickAddRect.height <= messageRect.y,
  ).toBeTruthy();
  await messageClient.click();
  await expect(page).toHaveURL(/\/coach\/messages\/client_sarah$/);
});
