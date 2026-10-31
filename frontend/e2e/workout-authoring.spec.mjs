import { test, expect, usePreviewRole, callPreviewApi } from './preview-test.mjs';

// Workout Authoring Studio (docs/workout-authoring/first-slice.md). Preview
// verifies UI behavior only: parsing is local, and the only write is the
// existing builder save (POST /programs/workouts) against fictional fixtures.
test.setTimeout(60_000);

const STUDIO_TEXT = [
  'Day 1 Upper',
  'Cable Row 3x10',
  'Goblet squat 3 sets of 8 to 10 reps, rest 90 seconds, tempo 3-1-1, chest tall',
  'Plank 3 x 30 sec',
  'Row erg 2x500m',
  'Sled push 4 rounds',
  'Day 2 Lower',
  'Romanian deadlift 3x8',
].join('\n');

const fitsWidth = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test('dictated text becomes a reviewed draft, is accepted once and saves through the normal builder at phone width', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await usePreviewRole(page, 'coach');
  await page.goto('/coach');
  await expect(page.getByRole('heading', { name: 'Hey, Marcus' })).toBeVisible();
  // A second catalog row with exactly the same name: the studio must not pick one for the coach.
  expect((await callPreviewApi(page, 'post', '/programs/exercise-library', { name: 'Cable Row' })).status).toBe(201);
  const libraryBefore = (await callPreviewApi(page, 'get', '/programs/exercise-library?include_hidden=true')).data;
  const workoutsBefore = (await callPreviewApi(page, 'get', '/programs/workouts')).data;

  await page.getByTestId('sidebar-nav-programs').click();
  await expect(page.getByRole('heading', { name: 'Training builder' })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId('training-builder-tab-workouts').click();
  await page.getByTestId('workout-authoring-open-button').click();

  const studio = page.getByTestId('authoring-dialog');
  await expect(studio).toBeVisible();
  await expect(studio.getByTestId('authoring-intro')).toContainText('microphone on your device keyboard');
  await expect(studio.getByTestId('authoring-intro')).toContainText('does not record or receive audio');
  const transcript = studio.getByTestId('authoring-transcript');
  await transcript.fill(STUDIO_TEXT);
  await studio.getByTestId('authoring-build-button').click();

  // The original text stays visible and unchanged while the draft is reviewed.
  await expect(transcript).toHaveValue(STUDIO_TEXT);
  await expect(transcript).toHaveJSProperty('readOnly', true);

  // Two days: nothing is chosen for the coach, and accepting waits for a choice.
  await expect(studio.getByTestId('authoring-day-option')).toHaveCount(2);
  await expect(studio.getByTestId('authoring-day-hint')).toContainText('one day at a time');
  await expect(studio.getByTestId('authoring-day-hint')).toContainText('save each reviewed day, then select those workouts in Programs');
  const accept = studio.getByTestId('authoring-accept-button');
  await expect(accept).toBeDisabled();
  await expect(studio.getByTestId('authoring-issues')).toContainText('Choose which day');
  await studio.getByTestId('authoring-day-option').first().click();

  const cards = studio.getByTestId('authoring-exercise-card');
  await expect(cards).toHaveCount(5);
  await expect(studio.getByTestId('authoring-workout-name-input')).toHaveValue('Day 1 Upper');

  // Exact duplicate catalog name: both offered, neither linked.
  await expect(cards.nth(0)).toHaveAttribute('data-catalog', 'ambiguous');
  await expect(cards.nth(0).getByTestId('authoring-exercise-name-input')).toHaveValue('Cable Row');
  await expect(cards.nth(0).getByTestId('authoring-candidate-button')).toHaveCount(2);
  await expect(cards.nth(0).getByTestId('authoring-keep-custom-button')).toHaveCount(0);

  // Exact unique name links at once; reps range, rest, tempo and cue kept as written.
  const squat = cards.nth(1);
  await expect(squat).toHaveAttribute('data-catalog', 'matched');
  await expect(squat.getByTestId('authoring-heard')).toContainText('Goblet squat 3 sets of 8 to 10 reps');
  await expect(squat.getByTestId('authoring-exercise-name-input')).toHaveValue('Goblet Squat');
  await expect(squat.getByTestId('authoring-sets-input')).toHaveValue('3');
  await expect(squat.getByTestId('authoring-reps-input')).toHaveValue('8-10');
  await expect(squat.getByTestId('authoring-rest-input')).toHaveValue('90 seconds');
  await expect(squat.getByTestId('authoring-tempo-input')).toHaveValue('3-1-1');
  await expect(squat.getByTestId('authoring-client-notes-input')).toHaveValue('chest tall');

  // Duration and distance keep value and unit and are never reps.
  const plank = cards.nth(2);
  await expect(plank).toHaveAttribute('data-catalog', 'unmatched');
  await expect(plank.getByLabel('Exercise tracking type')).toHaveValue('duration');
  await expect(plank.getByLabel('Target duration', { exact: true })).toHaveValue('30');
  await expect(plank.getByLabel('Target duration unit')).toHaveValue('s');
  await expect(plank.getByTestId('authoring-reps-input')).toHaveCount(0);
  const erg = cards.nth(3);
  await expect(erg.getByLabel('Exercise tracking type')).toHaveValue('distance');
  await expect(erg.getByLabel('Target distance', { exact: true })).toHaveValue('500');
  await expect(erg.getByLabel('Target distance unit')).toHaveValue('m');
  // Possible catalog matches are offered, not picked.
  await expect(erg.getByTestId('authoring-suggestion-button')).toHaveCount(2);
  await expect(erg).toHaveAttribute('data-catalog', 'unmatched');

  // An unsupported unit is an explicit decision, not reps.
  const sled = cards.nth(4);
  await expect(sled.getByTestId('authoring-prescription-issue')).toContainText('4 rounds');
  await expect(sled.getByTestId('authoring-use-entered-button')).toBeDisabled();
  await expect(sled.getByTestId('authoring-reps-input')).toHaveValue('');
  await expect(accept).toBeDisabled();

  expect(await fitsWidth(page)).toBeTruthy();
  expect(await studio.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBeTruthy();

  // Resolve every item and edit a value.
  await cards.nth(0).getByTestId('authoring-candidate-button').filter({ hasText: 'Strength' }).click();
  await expect(cards.nth(0)).toHaveAttribute('data-catalog', 'matched');
  await squat.getByTestId('authoring-sets-input').fill('4');
  await plank.getByTestId('authoring-keep-custom-button').click();
  await erg.getByTestId('authoring-keep-custom-button').click();
  await sled.getByTestId('authoring-keep-custom-button').click();
  await expect(accept).toBeDisabled();
  await sled.getByTestId('authoring-keep-coach-note-button').click();
  await expect(sled.getByTestId('authoring-coach-notes-input')).toHaveValue('As written: 4 rounds');
  await studio.getByTestId('authoring-workout-name-input').fill('CVF TEST Studio Upper');
  await expect(studio.getByTestId('authoring-issues')).toHaveAttribute('data-count', '0');
  await expect(studio.getByTestId('authoring-replace-copy')).toContainText('Nothing is saved until you press Save workout');
  await expect(accept).toBeEnabled();

  // Two taps in the same task, before React re-renders: only one accept may apply.
  await accept.evaluate((button) => { button.click(); button.click(); });
  await expect(studio).toBeHidden();
  const builder = page.getByRole('dialog', { name: 'New workout day' });
  await expect(builder).toBeVisible();
  await expect(builder.getByTestId('workout-name-input')).toHaveValue('CVF TEST Studio Upper');
  await expect(builder.getByTestId('workout-exercise-row')).toHaveCount(5);
  await expect(builder.getByTestId('workout-exercise-summary').nth(1)).toContainText('4 × 8-10 reps');
  await expect(builder.getByTestId('workout-exercise-summary').nth(2)).toContainText('3 × 30 s');
  await expect(builder.getByTestId('workout-exercise-summary').nth(3)).toContainText('2 × 500 m');
  // Accepting is not a save.
  expect((await callPreviewApi(page, 'get', '/programs/workouts')).data).toHaveLength(workoutsBefore.length);

  await builder.getByTestId('workout-save-button').click();
  await expect(page.getByText('Workout created')).toBeVisible();

  const workoutsAfter = (await callPreviewApi(page, 'get', '/programs/workouts')).data;
  expect(workoutsAfter).toHaveLength(workoutsBefore.length + 1);
  const saved = workoutsAfter.filter((workout) => workout.name === 'CVF TEST Studio Upper');
  expect(saved).toHaveLength(1);
  const exercises = saved[0].exercises;
  expect(exercises.map((exercise) => [exercise.exercise_library_id, exercise.custom_name])).toEqual([
    ['lib_cable_row', null], ['lib_goblet_squat', null], [null, 'Plank'], [null, 'Row erg'], [null, 'Sled push'],
  ]);
  expect(exercises[0]).toMatchObject({ video_link_mode: 'inherit', video_url: null, sets: '3', reps: '10' });
  expect(exercises[1]).toMatchObject({
    sets: '4', reps: '8-10', rest: '90 seconds', rest_seconds: 90, tempo: '3-1-1', client_notes: 'chest tall', tracking_type: 'reps_weight', video_link_mode: 'inherit',
  });
  expect(exercises[2]).toMatchObject({ sets: '3', reps: null, tracking_type: 'duration', duration_value: 30, duration_unit: 's', distance_value: null, video_link_mode: null });
  expect(exercises[3]).toMatchObject({ sets: '2', reps: null, tracking_type: 'distance', distance_value: 500, distance_unit: 'm', duration_value: null });
  expect(exercises[4]).toMatchObject({ reps: null, tracking_type: 'reps_weight', coach_notes: 'As written: 4 rounds' });
  // Custom exercises were not added to the catalog.
  expect((await callPreviewApi(page, 'get', '/programs/exercise-library?include_hidden=true')).data).toHaveLength(libraryBefore.length);
});

test('cancel never touches the builder, unsaved builder work needs consent, and the accepted form is independent', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await usePreviewRole(page, 'coach');
  await page.goto('/coach/programs');
  await page.getByTestId('training-builder-tab-workouts').click();
  const workoutsBefore = (await callPreviewApi(page, 'get', '/programs/workouts')).data;
  const studio = page.getByTestId('authoring-dialog');
  const pane = page.getByTestId('workout-editor-pane');

  // Cancel with a built draft: confirmed discard, builder untouched.
  await page.getByTestId('workout-rail-authoring-open').click();
  await studio.getByTestId('authoring-transcript').fill('Goblet squat 3x10');
  await studio.getByTestId('authoring-build-button').click();
  await expect(studio.getByTestId('authoring-exercise-card')).toHaveCount(1);
  page.once('dialog', (dialog) => dialog.accept());
  await studio.getByTestId('authoring-cancel-button').click();
  await expect(studio).toBeHidden();
  await expect(page.getByTestId('workout-editor-empty')).toBeVisible();

  // Unsaved builder work is never replaced without consent.
  await page.getByTestId('workout-rail-create').click();
  await pane.getByTestId('workout-name-input').fill('Unsaved coach work');
  await page.getByTestId('workout-rail-authoring-open').click();
  await expect(studio.getByTestId('authoring-transcript')).toHaveValue('');
  await studio.getByTestId('authoring-transcript').fill('Goblet squat 3x10\nPlank 3 x 30 sec');
  await studio.getByTestId('authoring-build-button').click();
  await studio.getByTestId('authoring-exercise-card').nth(1).getByTestId('authoring-keep-custom-button').click();
  await expect(studio.getByTestId('authoring-replace-copy')).toContainText('unsaved changes');
  page.once('dialog', (dialog) => dialog.dismiss());
  await studio.getByTestId('authoring-accept-button').click();
  await expect(studio).toBeVisible();
  await expect(studio.getByTestId('authoring-exercise-card')).toHaveCount(2);
  await expect(pane.getByTestId('workout-name-input')).toHaveValue('Unsaved coach work');

  page.once('dialog', (dialog) => dialog.accept());
  await studio.getByTestId('authoring-accept-button').click();
  await expect(studio).toBeHidden();
  await expect(pane.getByTestId('workout-name-input')).toHaveValue('Day 1');
  await expect(pane.getByTestId('workout-exercise-row')).toHaveCount(2);

  // Builder edits do not reach the studio's copy, and the text is kept for another pass.
  await pane.getByTestId('workout-exercise-sets-input').first().fill('5');
  await page.getByTestId('workout-rail-authoring-open').click();
  await expect(studio.getByTestId('authoring-transcript')).toHaveValue('Goblet squat 3x10\nPlank 3 x 30 sec');
  await expect(studio.getByTestId('authoring-kept-text')).toBeVisible();
  await studio.getByTestId('authoring-build-button').click();
  await expect(studio.getByTestId('authoring-exercise-card').first().getByTestId('authoring-sets-input')).toHaveValue('3');
  page.once('dialog', (dialog) => dialog.accept());
  await studio.getByTestId('authoring-cancel-button').click();
  await expect(studio).toBeHidden();
  await expect(pane.getByTestId('workout-exercise-sets-input').first()).toHaveValue('5');
  await expect(pane.getByTestId('workout-exercise-row')).toHaveCount(2);

  // Nothing above wrote to the server.
  expect((await callPreviewApi(page, 'get', '/programs/workouts')).data).toHaveLength(workoutsBefore.length);
});

test('blank text, spelled-out numbers and unreadable lines are actionable at phone width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await usePreviewRole(page, 'coach');
  await page.goto('/coach/programs');
  await page.getByTestId('training-builder-tab-workouts').click();
  await page.getByTestId('workout-authoring-open-button').click();
  const studio = page.getByTestId('authoring-dialog');

  await studio.getByTestId('authoring-build-button').click();
  await expect(studio.getByTestId('authoring-parse-error')).toContainText("Couldn't find any exercises in this text.");
  await expect(studio.getByTestId('authoring-review')).toHaveCount(0);

  const transcript = studio.getByTestId('authoring-transcript');
  await transcript.fill('Goblet squat three sets of ten');
  await expect(studio.getByTestId('authoring-parse-error')).toHaveCount(0);
  await studio.getByTestId('authoring-build-button').click();
  await expect(studio.getByTestId('authoring-parse-error')).toContainText('change them to digits');
  await expect(studio.getByTestId('authoring-parse-error')).toContainText('Goblet squat three sets of ten');

  await transcript.fill('Goblet squat 3x10\nGoblet squat three sets of ten');
  await studio.getByTestId('authoring-build-button').click();
  const line = studio.getByTestId('authoring-extra-line');
  await expect(line).toHaveAttribute('data-choice', 'pending');
  await expect(studio.getByTestId('authoring-accept-button')).toBeDisabled();
  await line.getByTestId('authoring-make-exercise-button').click();
  const added = studio.getByTestId('authoring-exercise-card').nth(1);
  await expect(added.getByTestId('authoring-prescription-issue')).toContainText('Goblet squat three sets of ten');
  await added.getByTestId('authoring-suggestion-button').filter({ hasText: 'Goblet Squat' }).click();
  await expect(added).toHaveAttribute('data-catalog', 'matched');
  await expect(studio.getByTestId('authoring-accept-button')).toBeDisabled();
  await added.getByTestId('authoring-sets-input').fill('3');
  await added.getByTestId('authoring-reps-input').fill('10');
  await added.getByTestId('authoring-use-entered-button').click();
  await expect(studio.getByTestId('authoring-issues')).toHaveAttribute('data-count', '0');
  await expect(studio.getByTestId('authoring-accept-button')).toBeEnabled();
  expect(await fitsWidth(page)).toBeTruthy();
  expect(await studio.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBeTruthy();

  // Changing the text is deliberate: the draft is discarded only after confirmation.
  page.once('dialog', (dialog) => dialog.dismiss());
  await studio.getByTestId('authoring-edit-text-button').click();
  await expect(studio.getByTestId('authoring-review')).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await studio.getByTestId('authoring-edit-text-button').click();
  await expect(studio.getByTestId('authoring-review')).toHaveCount(0);
  await expect(transcript).toHaveValue('Goblet squat 3x10\nGoblet squat three sets of ten');
  await expect(transcript).toHaveJSProperty('readOnly', false);
});

test('unknown unit suffixes and secondary targets require an explicit note choice before accepting', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await usePreviewRole(page, 'coach');
  await page.goto('/coach/programs');
  await page.getByTestId('training-builder-tab-workouts').click();
  await page.getByTestId('workout-authoring-open-button').click();
  const studio = page.getByTestId('authoring-dialog');
  for (const [text, raw] of [
    ['Carry 3x40 furlongs', '3x40 furlongs'],
    ['Row 3x500 m in 2-3 min', '3x500 m in 2-3 min'],
    ['Plank 3x30 sec + 2 hours', '3x30 sec + 2 hours'],
  ]) {
    await studio.getByTestId('authoring-transcript').fill(text);
    await studio.getByTestId('authoring-build-button').click();
    await expect(studio.getByTestId('authoring-prescription-issue')).toContainText(raw);
    await expect(studio.getByTestId('authoring-reps-input')).toHaveValue('');
    await studio.getByTestId('authoring-keep-custom-button').click();
    await expect(studio.getByTestId('authoring-issues')).toHaveAttribute('data-count', '1');
    await expect(studio.getByTestId('authoring-accept-button')).toBeDisabled();
    await studio.getByTestId('authoring-keep-coach-note-button').click();
    await expect(studio.getByTestId('authoring-coach-notes-input')).toHaveValue(`As written: ${raw}`);
    await expect(studio.getByTestId('authoring-accept-button')).toBeEnabled();
    page.once('dialog', (dialog) => dialog.accept());
    await studio.getByTestId('authoring-edit-text-button').click();
  }
});
