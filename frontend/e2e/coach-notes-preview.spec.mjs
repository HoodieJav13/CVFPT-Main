// Coach Notes in preview mode (fictional fixtures, no backend): the coach-only
// section on the client page. Preview verifies UI behavior only; the real
// authorization is the Express route (backend/test/coach-notes.test.js) and the
// database grants (supabase/tests/coach_notes).
import { test, expect, usePreviewRole, callPreviewApi } from './preview-test.mjs';

const MARCUS_NOTE = 'Prefers morning sessions. Keep lunges shallow until the knee settles.';
const JORDAN_NOTE = 'Covered two sessions in September; responds well to short rest timers.';

for (const [label, viewport] of [['390', { width: 390, height: 844 }], ['1440', { width: 1440, height: 900 }]]) {
  test(`${label}: a coach reads, adds and edits private Coach Notes with author and times`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await usePreviewRole(page, 'coach');
    await page.goto('/coach/clients/client_sarah');
    const section = page.getByTestId('coach-notes');
    await expect(section).toBeVisible();
    await expect(section.getByTestId('coach-notes-private-badge')).toHaveText('Private · coaches only');
    await expect(section.getByTestId('coach-notes-visibility')).toHaveText("Visible only to this client's coach and admins. Never shown to the client.");
    const notes = section.getByTestId('coach-note');
    await expect(notes).toHaveCount(2);
    await expect(notes.nth(0).getByTestId('coach-note-content')).toHaveText(MARCUS_NOTE);
    await expect(notes.nth(0).getByTestId('coach-note-meta')).toContainText('Marcus Rivera · Added ');
    await expect(notes.nth(0).getByTestId('coach-note-meta')).toContainText(' · Edited ');
    await expect(notes.nth(1).getByTestId('coach-note-meta')).toContainText('Jordan Banks · Added ');
    await expect(notes.nth(1).getByTestId('coach-note-meta')).not.toContainText('Edited');
    // Only the author can edit; Jordan's older note is read-only for Marcus.
    await expect(notes.nth(0).getByTestId('coach-note-edit-button')).toBeVisible();
    await expect(notes.nth(1).getByTestId('coach-note-edit-button')).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath(`coach-notes-${label}.png`) });

    // A 5xx (preview's simulated 503) is not a definite refusal: the note may be
    // stored, so the list is reloaded before saving again; the text is kept.
    await section.getByTestId('coach-note-input').fill('  Ask about sleep before Thursday.  ');
    await page.evaluate(() => localStorage.setItem('cvf_preview_fail', 'write-once'));
    await section.getByTestId('coach-note-save-button').click();
    const unconfirmed = section.getByTestId('coach-note-add-unconfirmed');
    await expect(unconfirmed).toHaveAttribute('data-phase', 'reloaded');
    await expect(unconfirmed).toContainText('Not confirmed: the server\'s reply was lost, so this note may already be saved.');
    await expect(unconfirmed).toContainText('The list below was reloaded. Check it before saving again. Your text is still here.');
    await expect(section.getByTestId('coach-note-add-error')).toHaveCount(0);
    await expect(section.getByTestId('coach-note-input')).toHaveValue('  Ask about sleep before Thursday.  ');
    await expect(notes).toHaveCount(2);
    await section.getByTestId('coach-note-save-button').click();
    await expect(page.getByText('Coach note saved').first()).toBeVisible();
    await expect(notes).toHaveCount(3);
    await expect(notes.nth(0).getByTestId('coach-note-content')).toHaveText('Ask about sleep before Thursday.');
    await expect(notes.nth(0).getByTestId('coach-note-meta')).toContainText('Marcus Rivera · Added ');
    await expect(section.getByTestId('coach-note-input')).toHaveValue('');

    // Edit own note.
    await notes.nth(0).getByTestId('coach-note-edit-button').click();
    await notes.nth(0).getByTestId('coach-note-edit-input').fill('Ask about sleep and stress before Thursday.');
    await notes.nth(0).getByTestId('coach-note-update-button').click();
    await expect(page.getByText('Coach note updated').first()).toBeVisible();
    await expect(notes.nth(0).getByTestId('coach-note-content')).toHaveText('Ask about sleep and stress before Thursday.');
    await expect(notes.nth(0).getByTestId('coach-note-meta')).toContainText(' · Edited ');

    // An edit based on an older version is refused; the typed text stays and the latest version is shown.
    await notes.nth(1).getByTestId('coach-note-edit-button').click();
    await notes.nth(1).getByTestId('coach-note-edit-input').fill('My stale edit');
    const latest = (await callPreviewApi(page, 'get', '/clients/client_sarah/coach-notes')).data.notes.find((n) => n.content === MARCUS_NOTE);
    await callPreviewApi(page, 'put', `/clients/client_sarah/coach-notes/${latest.id}`, { content: 'Saved from another tab.', expected_updated_at: latest.updated_at });
    await notes.nth(1).getByTestId('coach-note-update-button').click();
    await expect(notes.nth(1).getByTestId('coach-note-edit-error')).toContainText('This note changed since you opened it');
    await expect(notes.nth(1).getByTestId('coach-note-latest')).toContainText('Saved from another tab.');
    await expect(notes.nth(1).getByTestId('coach-note-edit-input')).toHaveValue('My stale edit');
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  });
}

test('the client role is refused by the notes API and no client page shows note text', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await usePreviewRole(page, 'client');
  await page.goto('/client');
  for (const [method, path, body] of [
    ['get', '/clients/client_sarah/coach-notes'],
    ['post', '/clients/client_sarah/coach-notes', { content: 'Client attempt' }],
    ['put', '/clients/client_sarah/coach-notes/coach_note_sarah_1', { content: 'Client attempt', expected_updated_at: 'x' }],
  ]) {
    const result = await callPreviewApi(page, method, path, body);
    expect(result.status, `${method} ${path}`).toBe(403);
    expect(JSON.stringify(result.data)).not.toContain('morning');
  }
  const profile = (await callPreviewApi(page, 'get', '/auth/me')).data;
  expect(JSON.stringify(profile)).not.toMatch(/coach_note|morning sessions|short rest timers/);
  for (const route of ['/client', '/client/programs', '/client/progress', '/client/sessions', '/client/resources', '/client/messages', '/client/notifications']) {
    await page.goto(route);
    await page.waitForLoadState('networkidle');
    const text = await page.locator('body').innerText();
    expect(text, route).not.toContain(MARCUS_NOTE);
    expect(text, route).not.toContain(JORDAN_NOTE);
    expect(text, route).not.toContain('Coach Notes');
  }
});

test('an archived client keeps its notes readable but closed to new notes', async ({ page }) => {
  // 390: on desktop the preview toolbar overlaps the Archive button.
  await page.setViewportSize({ width: 390, height: 844 });
  await usePreviewRole(page, 'coach');
  await page.goto('/coach/clients/client_sarah');
  const section = page.getByTestId('coach-notes');
  await expect(section.getByTestId('coach-note')).toHaveCount(2);
  // Preview data is memory-only, so archive through the page (no reload).
  await page.getByTestId('archive-client-button').click();
  await expect(page.getByText('Client archived').first()).toBeVisible();
  await expect(section.getByTestId('coach-note')).toHaveCount(2);
  await expect(section.getByTestId('coach-notes-read-only')).toContainText('Archived client: notes are read-only.');
  await expect(section.getByTestId('coach-note-input')).toHaveCount(0);
  await expect(section.getByTestId('coach-note-edit-button')).toHaveCount(0);
});
