// Preview mode (fictional fixtures, no backend): the optional offline MOCK
// draft proposal import, as an owner would try it with the preview toolbar.
// The proposal was exported by the offline companion against the fresh preview
// catalog (fixtures/offline-proposal/PROVENANCE.md). Saving creates a program
// template only; assigning stays the separate Assignments step.
import { readFileSync } from 'node:fs';
import { test, expect, usePreviewRole, callPreviewApi } from './preview-test.mjs';

const file = (path) => ({ name: path.split('/').pop(), mimeType: 'application/json', buffer: readFileSync(new URL(path, import.meta.url)) });
const PROGRAM = 'Preview Foundations (offline draft)';

for (const [label, viewport] of [['390', { width: 390, height: 844 }], ['1440', { width: 1440, height: 900 }]]) {
  test(`${label}: a preview-catalog proposal is checked, coach-confirmed and saved unassigned, then assigned separately`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await usePreviewRole(page, 'coach');
    await page.goto('/coach/programs');
    await page.getByTestId('training-builder-tab-programs').click();
    const before = await callPreviewApi(page, 'get', '/programs/program-assignments/client/client_sarah');
    await page.getByTestId('program-import-open-button').click();
    const dialog = page.getByTestId('program-import-dialog');
    await dialog.getByTestId('program-import-source-select').click();
    await page.getByRole('option', { name: 'Offline draft proposal (MOCK)' }).click();

    // A proposal drafted against another catalog is refused here.
    await dialog.getByTestId('program-import-proposal-file-input').setInputFiles(file('../tests/browser/fixtures/offline-proposal/proposal.json'));
    await dialog.getByTestId('program-import-proposal-check-button').click();
    await expect(dialog.getByTestId('program-import-proposal-refusal')).toHaveAttribute('data-code', 'catalog_revision_mismatch');

    await dialog.getByTestId('program-import-proposal-file-input').setInputFiles(file('./fixtures/offline-proposal/preview-proposal.json'));
    await dialog.getByTestId('program-import-proposal-check-button').click();
    const panel = dialog.getByTestId('program-import-proposal-panel');
    await expect(panel.getByTestId('program-import-proposal-sha')).toHaveText('37e0d9ea4e54c12f1acc0e11fca4e8a48151cb449312564435cde1b3eb91c5f2');
    await expect(panel.getByTestId('program-import-proposal-binding-row')).toHaveCount(6);
    await expect(dialog.getByTestId('program-import-save-button')).toBeDisabled();
    await page.screenshot({ path: test.info().outputPath(`preview-${label}-proposal-review.png`) });
    await dialog.getByTestId('program-import-proposal-confirm').check();
    await dialog.getByTestId('program-import-save-button').click();
    await expect(page.getByText('Program saved to vault (not assigned)').first()).toBeVisible();
    await expect(page.getByTestId('program-card').filter({ hasText: PROGRAM })).toBeVisible();
    const programs = (await callPreviewApi(page, 'get', '/programs')).data;
    const saved = programs.find((program) => program.name === PROGRAM);
    expect(saved.days.map((day) => day.workout.exercises.map((row) => row.exercise_library_id))).toEqual([
      ['lib_goblet_squat', 'lib_rdl'], ['lib_db_bench', 'lib_cable_row'], ['lib_world_stretch', 'lib_goblet_squat'],
    ]);
    expect((await callPreviewApi(page, 'get', '/programs/program-assignments/client/client_sarah')).data).toHaveLength(before.data.length);

    await page.getByTestId('training-builder-tab-assignments').click();
    await page.getByTestId('assignment-client-select').click();
    await page.getByRole('option', { name: 'Sarah Martinez' }).click();
    await page.getByTestId('assignment-program-select').click();
    await page.getByRole('option', { name: PROGRAM }).click();
    await page.getByTestId('assignment-submit-button').click();
    await expect(page.getByText('Program assigned').first()).toBeVisible();
    const after = (await callPreviewApi(page, 'get', '/programs/program-assignments/client/client_sarah')).data;
    expect(after.some((assignment) => assignment.program?.name === PROGRAM)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  });
}
