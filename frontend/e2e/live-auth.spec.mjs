import { test, expect } from '@playwright/test';
import { randomBytes } from 'node:crypto';

const backendUrl = process.env.CVF_E2E_BACKEND_URL;
const accounts = {
  admin: { email: process.env.CVF_E2E_ADMIN_EMAIL, password: process.env.CVF_E2E_ADMIN_PASSWORD },
  coach: { email: process.env.CVF_E2E_COACH_EMAIL, password: process.env.CVF_E2E_COACH_PASSWORD },
  client: { email: process.env.CVF_E2E_CLIENT_EMAIL, password: process.env.CVF_E2E_CLIENT_PASSWORD },
};
const configured = Boolean(
  backendUrl
  && Object.values(accounts).every((account) => account.email && account.password)
  && process.env.REACT_APP_BACKEND_URL,
);
const clientFlowMarker = `CVF LIVE CLIENT ${Date.now()}`;

test.skip(!configured, 'Live-auth browser tests require the documented CVF_E2E_* environment variables');

async function login(page, account, expectedPath) {
  await page.goto('/login');
  await page.getByTestId('login-email-input').fill(account.email);
  await page.getByTestId('login-password-input').fill(account.password);
  await page.getByTestId('login-submit-button').click();
  await expect(page).toHaveURL(new RegExp(`${expectedPath}$`));
}

async function logout(page) {
  await page.locator('[data-testid="user-menu-trigger"]:visible').click();
  await page.getByTestId('logout-button').click();
  await expect(page).toHaveURL(/\/login$/);
}

test('auth forms reject invalid login and non-invited signup without creating an account', async ({ page }) => {
  const email = `cvf-live-not-invited-${Date.now()}@example.invalid`;
  const password = `CvF-${randomBytes(18).toString('base64url')}!`;
  await page.goto('/login');
  await page.getByTestId('login-email-input').fill(email);
  await page.getByTestId('login-password-input').fill(password);
  await page.getByTestId('login-submit-button').click();
  await expect(page.getByTestId('login-error-text')).toHaveText('Invalid email or password');
  await page.getByTestId('go-to-signup-link').click();
  await page.getByTestId('signup-email-input').fill(email);
  await page.getByTestId('signup-password-input').fill(password);
  await page.getByTestId('signup-confirm-input').fill(`${password} mismatch`);
  await page.getByTestId('invite-claim-submit-button').click();
  await expect(page.getByTestId('invite-invalid-state-text')).toHaveText('Passwords do not match');
  await page.getByTestId('signup-confirm-input').fill(password);
  await page.getByTestId('invite-claim-submit-button').click();
  await expect(page.getByTestId('invite-invalid-state-text')).toContainText("couldn't find an invitation");
});

test('live client and coach loads expose recoverable error states', async ({ page }) => {
  let failClientLoads = true;
  await page.route('**/api/sessions/client/mine', async (route) => {
    if (failClientLoads) {
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'CVF test client load failure' }) });
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
    await route.continue();
  });
  await login(page, accounts.client, '/client');
  await page.goto('/client/sessions');
  await expect(page.getByTestId('load-error-state')).toHaveAttribute('data-load-error-scope', 'client-sessions');
  await expect(page.getByTestId('load-error-message')).toHaveText('CVF test client load failure');
  failClientLoads = false;
  await page.getByTestId('load-error-retry-button').click();
  await expect(page.getByTestId('loading-skeleton')).toBeVisible();
  await expect(page.getByTestId('booking-request-button')).toBeVisible();
  await page.unroute('**/api/sessions/client/mine');
  await logout(page);

  let failCoachLoads = true;
  await page.route('**/api/dashboard/coach', async (route) => {
    if (failCoachLoads) {
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'CVF test coach load failure' }) });
      return;
    }
    await route.continue();
  });
  await login(page, accounts.coach, '/coach');
  await expect(page.getByTestId('load-error-state')).toHaveAttribute('data-load-error-scope', 'coach-dashboard');
  await expect(page.getByTestId('load-error-message')).toHaveText('CVF test coach load failure');
  failCoachLoads = false;
  await page.getByTestId('load-error-retry-button').click();
  await expect(page.getByTestId('coach-dashboard-today-sessions-card')).toBeVisible();
  await page.unroute('**/api/dashboard/coach');
  await logout(page);
});

test('real client auth covers check-in, booking, messaging, route protection, and navigation', async ({ page, request }) => {
  const marker = clientFlowMarker;
  await login(page, accounts.client, '/client');
  await expect(page.getByRole('heading', { name: /Today, CVF/ })).toBeVisible();
  await expect(page.getByTestId('daily-check-in-card')).toBeVisible();

  await page.getByTestId('open-check-in-button').click();
  for (const id of ['check-in-energy', 'check-in-soreness', 'check-in-sleep', 'check-in-stress']) {
    await page.getByTestId(id).getByRole('button', { name: '3' }).click();
  }
  await page.getByTestId('check-in-general-notes').fill(marker);
  await page.getByTestId('check-in-save-button').click();
  await expect(page.getByText(/Check-in (saved|updated)/)).toBeVisible();

  await page.goto('/client/sessions');
  await expect(page.getByRole('heading', { name: 'Sessions' })).toBeVisible();
  await page.getByTestId('booking-request-button').click();
  const tomorrow = new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString().slice(0, 16);
  await page.getByTestId('booking-datetime-input').fill(tomorrow);
  await page.getByTestId('booking-location-input').fill('CVF Preview Studio');
  await page.getByTestId('booking-note-input').fill(marker);
  await page.getByTestId('booking-submit-button').click();
  await expect(page.getByText('Request sent - your coach will confirm')).toBeVisible();
  await expect(page.getByTestId('my-booking-request-row').filter({ hasText: marker })).toBeVisible();

  await page.goto('/client/progress');
  await expect(page.getByRole('heading', { name: 'Progress' })).toBeVisible();
  await expect(page.getByTestId('client-progress-empty')).toBeVisible();
  await page.goto('/client/programs');
  await expect(page.getByRole('heading', { name: 'My programs' })).toBeVisible();
  await expect(page.getByTestId('client-programs-empty')).toBeVisible();
  await page.goto('/client/messages');
  await page.getByTestId('chat-input').fill(marker);
  await page.getByTestId('chat-send-button').click();
  await expect(page.getByTestId('chat-message-list').getByText(marker)).toBeVisible();
  await page.goto('/client/waiver');
  await expect(page.getByRole('heading', { name: 'Waiver' })).toBeVisible();
  await expect(page.getByTestId('waiver-unavailable-state')).toBeVisible();
  await expect(page.getByTestId('waiver-submit-button')).toHaveCount(0);
  await page.goto('/client/packages');
  await expect(page.getByTestId('payments-not-configured-card')).toBeVisible();
  await expect(page.getByTestId('credits-balance-text')).toContainText('0');

  await page.goto('/coach');
  await expect(page).toHaveURL(/\/client$/);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [tab, path] of [
    ['home', '/client'],
    ['sessions', '/client/sessions'],
    ['progress', '/client/progress'],
    ['programs', '/client/programs'],
    ['messages', '/client/messages'],
  ]) {
    await page.getByTestId(`bottom-tab-${tab}`).click();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
  }

  const accessToken = await page.evaluate(() => localStorage.getItem('cvf_access_token'));
  const checkIns = await request.get(`${backendUrl}/api/check-ins/mine`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  expect(checkIns.ok()).toBeTruthy();
  const created = (await checkIns.json()).find((row) => row.general_notes === marker);
  if (created) {
    const archived = await request.patch(`${backendUrl}/api/check-ins/${created.id}/archive`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(archived.ok()).toBeTruthy();
  }
  await logout(page);
});

test('real coach auth covers ownership surfaces and archives created test data', async ({ page, request }) => {
  const marker = `CVF LIVE ${Date.now()}`;
  const email = `cvf-live-${Date.now()}@example.invalid`;
  const clientLoginResponse = await request.post(`${backendUrl}/api/auth/login`, { data: accounts.client });
  expect(clientLoginResponse.ok()).toBeTruthy();
  const clientSession = await clientLoginResponse.json();
  const authenticatedClient = clientSession.profile;
  await login(page, accounts.coach, '/coach');
  await expect(page.getByTestId('coach-dashboard-today-sessions-card')).toBeVisible();

  const pending = page.getByTestId('booking-request-row').filter({ hasText: clientFlowMarker });
  if (await pending.count()) {
    await pending.first().getByTestId('booking-decline-button').click();
    await expect(pending.first()).toBeHidden();
  }

  await page.getByTestId('sidebar-nav-clients').click();
  await page.getByTestId('add-client-button').click();
  await page.getByTestId('client-name-input').fill(marker);
  await page.getByTestId('client-email-input').fill(email);
  await page.getByTestId('client-goals-input').fill('Preview-only live browser verification');
  await page.getByTestId('client-save-button').click();
  await expect(page.getByText(`${marker} added`)).toBeVisible();
  await page.getByTestId('client-row').filter({ hasText: marker }).click();
  await expect(page.getByTestId('client-detail-name')).toHaveText(marker);
  const clientId = page.url().split('/').pop();

  await page.getByTestId('edit-client-button').click();
  await page.getByTestId('edit-goals-input').fill(`CVF LIVE UPDATED ${marker}`);
  await page.getByTestId('edit-save-button').click();
  await expect(page.getByText('Client updated')).toBeVisible();
  await page.getByTestId('client-invite-switch').click();
  await expect(page.getByText(/Client invited/)).toBeVisible();
  await expect(page.getByTestId('waiver-status-text')).toHaveText('No waiver version exists yet');
  await expect(page.getByTestId('mark-paper-signed-button')).toHaveCount(0);

  await page.getByTestId('tab-check-ins').click();
  await page.getByTestId('coach-new-check-in-button').click();
  for (const id of ['check-in-energy', 'check-in-soreness', 'check-in-sleep', 'check-in-stress']) {
    await page.getByTestId(id).getByRole('button', { name: '3' }).click();
  }
  await page.getByTestId('check-in-general-notes').fill(marker);
  await page.getByTestId('check-in-coach-notes').fill(`Coach review ${marker}`);
  await page.getByTestId('check-in-save-button').click();
  await expect(page.getByText('Check-in saved')).toBeVisible();
  const coachCheckInCard = page.getByTestId('coach-check-in-card').filter({ hasText: marker });
  await expect(coachCheckInCard).toBeVisible();
  await coachCheckInCard.getByTestId('coach-edit-check-in-button').click();
  await page.getByTestId('check-in-coach-notes').fill(`Coach review updated ${marker}`);
  await page.getByTestId('check-in-save-button').click();
  await expect(page.getByText('Check-in updated')).toBeVisible();

  await page.getByTestId('tab-progress').click();
  await page.getByTestId('add-metric-button').click();
  await page.getByTestId('metric-name-input').fill(marker);
  await page.getByTestId('metric-unit-input').fill('reps');
  await page.getByTestId('metric-save-button').click();
  await expect(page.getByText('Metric added')).toBeVisible();
  const metricCard = page.getByTestId('metric-card').filter({ hasText: marker });
  await metricCard.getByTestId('log-entry-button').click();
  await page.getByTestId('entry-value-input').fill('8');
  await page.getByTestId('entry-notes-input').fill(marker);
  await page.getByTestId('entry-save-button').click();
  await expect(page.getByText('Entry logged')).toBeVisible();
  await metricCard.getByTestId('coach-edit-entry-button').click();
  await page.getByTestId('entry-value-input').fill('9');
  await page.getByTestId('entry-save-button').click();
  await expect(page.getByText('Entry updated')).toBeVisible();
  await metricCard.getByTestId('archive-metric-button').click();
  await expect(page.getByText(`"${marker}" archived`)).toBeVisible();

  await page.getByTestId('tab-sessions').click();
  await page.getByTestId('schedule-for-client-button').click();
  await page.getByTestId('session-client-select').click();
  await page.getByRole('option', { name: marker }).click();
  await page.getByTestId('session-datetime-input').fill(new Date(Date.now() + 4 * 86_400_000).toISOString().slice(0, 16));
  await page.getByTestId('session-location-input').fill(marker);
  await page.getByTestId('session-save-button').click();
  await expect(page.getByText('Session scheduled')).toBeVisible();
  const sessionRow = page.getByTestId('session-row').filter({ hasText: marker });
  await sessionRow.getByTestId('session-actions-button').click();
  await page.getByTestId('session-cancel-action').click();
  await expect(sessionRow).toBeHidden();
  await page.getByRole('button', { name: 'Cancelled' }).click();
  await expect(page.getByTestId('session-row').filter({ hasText: marker })).toContainText('cancelled');

  await page.goto(`/coach/clients/${clientId}`);
  await expect(page.getByTestId('client-detail-name')).toHaveText(marker);

  for (const tab of ['tab-check-ins', 'tab-progress', 'tab-sessions', 'tab-programs', 'tab-payments']) {
    await page.getByTestId(tab).click();
  }
  await page.getByTestId('tab-overview').click();

  const exerciseName = `${marker} Exercise`;
  const csvExerciseName = `${marker} CSV Exercise`;
  const workoutName = `${marker} Workout`;
  const programName = `${marker} Program`;
  const importedProgramName = `${marker} Imported Program`;
  const pastedProgramName = `${marker} Pasted Program`;
  const pastedExerciseName = `${marker} Pasted Exercise`;
  const programAssignmentNote = `${marker} program assignment`;
  const workoutAssignmentNote = `${marker} workout assignment`;
  const activeWorkoutAssignmentNote = `${marker} active workout assignment`;

  await page.goto('/coach/programs');
  await page.getByTestId('exercise-library-create-button').click();
  await page.getByTestId('exercise-library-name-input').fill(exerciseName);
  await page.getByTestId('exercise-library-category-input').fill('Strength');
  await page.getByTestId('exercise-library-equipment-input').fill('Dumbbell');
  await page.getByTestId('exercise-library-primary-muscle-input').fill('Legs');
  await page.getByTestId('exercise-library-video-input').fill('https://example.com/cvf-live-video');
  await page.getByTestId('exercise-library-notes-input').fill(marker);
  await page.getByTestId('exercise-library-save-button').click();
  await expect(page.getByText('Exercise added')).toBeVisible();
  const exerciseCard = page.getByTestId('exercise-library-card').filter({ hasText: exerciseName });
  await expect(exerciseCard).toBeVisible();
  await exerciseCard.getByTestId('exercise-library-edit-button').click();
  await page.getByTestId('exercise-library-notes-input').fill(`${marker} updated`);
  await page.getByTestId('exercise-library-save-button').click();
  await expect(page.getByText('Exercise updated')).toBeVisible();

  await page.getByTestId('exercise-library-import-input').setInputFiles({
    name: 'cvf-live-exercises.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(`name,category,equipment,primary_muscle,secondary_muscles,video_url,notes\n${csvExerciseName},Strength,Band,Back,,https://example.com/cvf-live-csv-video,${marker}`),
  });
  await expect(page.getByText('Imported 1 exercises')).toBeVisible();
  await expect(page.getByTestId('exercise-library-card').filter({ hasText: csvExerciseName })).toBeVisible();
  await page.getByTestId('exercise-library-search-input').fill(csvExerciseName);
  await expect(page.getByTestId('exercise-library-card')).toHaveCount(1);
  await page.getByTestId('exercise-library-search-input').clear();

  await page.getByTestId('training-builder-tab-workouts').click();
  await page.getByTestId('workout-create-button').click();
  await page.getByTestId('workout-name-input').fill(workoutName);
  await page.getByTestId('workout-goal-input').fill('Real-auth UI verification');
  await page.getByTestId('workout-exercise-name-input').fill(exerciseName);
  await page.getByTestId('workout-exercise-sets-input').fill('3');
  await page.getByTestId('workout-exercise-reps-input').fill('8');
  await page.getByTestId('workout-exercise-rest-input').fill('60s');
  await page.getByTestId('workout-exercise-video-input').fill('https://example.com/cvf-live-video');
  await page.getByTestId('workout-exercise-client-notes-input').fill(marker);
  await page.getByTestId('workout-exercise-add-button').click();
  await page.getByTestId('workout-exercise-name-input').nth(1).fill(`${marker} Temporary Exercise`);
  await page.getByTestId('workout-exercise-remove-button').nth(1).click();
  await expect(page.getByTestId('workout-exercise-name-input')).toHaveCount(1);
  await page.getByTestId('workout-save-button').click();
  await expect(page.getByText('Workout created')).toBeVisible();
  const workoutCard = page.getByTestId('workout-card').filter({ hasText: workoutName });
  await expect(workoutCard).toBeVisible();
  await workoutCard.getByTestId('workout-edit-button').click();
  await page.getByTestId('workout-goal-input').fill('Updated real-auth UI verification');
  await page.getByTestId('workout-save-button').click();
  await expect(page.getByText('Workout updated')).toBeVisible();

  await page.getByTestId('training-builder-tab-programs').click();
  await page.getByTestId('program-create-button').click();
  await page.getByTestId('program-name-input').fill(programName);
  await page.getByTestId('program-description-input').fill('Real-auth UI verification');
  await page.getByTestId('program-frequency-select').click();
  await page.getByRole('option', { name: '4 days/week', exact: true }).click();
  await expect(page.getByTestId('program-day-workout-select')).toHaveCount(4);
  await page.getByTestId('program-frequency-select').click();
  await page.getByRole('option', { name: '3 days/week', exact: true }).click();
  await page.getByTestId('program-day-notes-input').first().fill(marker);
  for (let index = 0; index < 3; index += 1) {
    await page.getByTestId('program-day-workout-select').nth(index).click();
    await page.getByRole('option', { name: workoutName, exact: true }).click();
  }
  await page.getByTestId('program-save-button').click();
  await expect(page.getByText('Program created')).toBeVisible();
  const programCard = page.getByTestId('program-card').filter({ hasText: programName });
  await expect(programCard).toBeVisible();
  await programCard.getByTestId('program-edit-button').click();
  await page.getByTestId('program-description-input').fill('Updated real-auth UI verification');
  await page.getByTestId('program-save-button').click();
  await expect(page.getByText('Program updated')).toBeVisible();
  const exportDownload = page.waitForEvent('download');
  await programCard.getByTestId('program-export-pdf-button').click();
  await expect((await exportDownload).suggestedFilename()).toMatch(/\.pdf$/i);
  await expect(page.getByText('PDF export ready')).toBeVisible();

  await page.getByTestId('program-import-open-button').click();
  const templateDownload = page.waitForEvent('download');
  await page.getByTestId('program-import-template-button').click();
  await expect((await templateDownload).suggestedFilename()).toMatch(/\.csv$/i);
  const importCsv = [
    'program_name,program_description,frequency_days,day_number,workout_name,exercise_name,sets,reps,video_url',
    `${importedProgramName},Real-auth imported program,3,1,${marker} Import Day 1,${marker} Import Exercise 1,3,8,https://example.com/cvf-live-import-1`,
    `${importedProgramName},Real-auth imported program,3,2,${marker} Import Day 2,${marker} Import Exercise 2,3,9,https://example.com/cvf-live-import-2`,
    `${importedProgramName},Real-auth imported program,3,3,${marker} Import Day 3,${marker} Import Exercise 3,3,10,https://example.com/cvf-live-import-3`,
  ].join('\n');
  await page.getByTestId('program-import-file-input').setInputFiles({
    name: 'cvf-live-program.csv', mimeType: 'text/csv', buffer: Buffer.from(importCsv),
  });
  await page.getByTestId('program-import-parse-button').click();
  await expect(page.getByTestId('program-import-name-input')).toHaveValue(importedProgramName);
  await page.getByTestId('program-import-name-input').fill(importedProgramName);
  await expect(page.getByTestId('program-import-save-button')).toBeEnabled();
  await page.getByTestId('program-import-save-button').click();
  await expect(page.getByText('Program imported to vault')).toBeVisible();
  await expect(page.getByTestId('program-card').filter({ hasText: importedProgramName })).toBeVisible();

  await page.getByTestId('program-import-open-button').click();
  await page.getByTestId('program-import-source-select').click();
  await page.getByRole('option', { name: 'Paste program', exact: true }).click();
  const pastedText = `${exerciseName.toLowerCase().replace(/ /g, '  ')} 2x7 to true failure\n${pastedExerciseName} 3x8`;
  await page.getByTestId('program-import-paste-textarea').fill(pastedText);
  await page.getByTestId('program-import-paste-parse-button').click();
  await expect(page.getByTestId('program-import-review')).toBeVisible();
  await expect(page.getByTestId('program-import-frequency-select')).toContainText('1 day/week');
  await expect(page.getByTestId('program-import-exercise-card')).toHaveCount(2);
  await expect(page.getByTestId('program-import-exercise-client-notes-input').first()).toHaveValue('to true failure');
  await page.getByTestId('program-import-name-input').fill(pastedProgramName);
  await page.getByTestId('program-import-day-name-input').fill(`${marker} Pasted Day`);
  await expect(page.getByTestId('program-import-save-button')).toBeEnabled();
  await page.getByTestId('program-import-save-button').click();
  await expect(page.getByText('Program imported to vault')).toBeVisible();
  const pastedProgramCard = page.getByTestId('program-card').filter({ hasText: pastedProgramName });
  await expect(pastedProgramCard).toBeVisible();
  await pastedProgramCard.getByTestId('program-edit-button').click();
  await expect(page.getByTestId('program-frequency-select')).toContainText('1 day/week');
  await page.getByTestId('program-description-input').fill('Updated one-day pasted program');
  await page.getByTestId('program-save-button').click();
  await expect(page.getByText('Program updated')).toBeVisible();

  await page.getByTestId('training-builder-tab-assignments').click();
  await page.getByTestId('assignment-client-select').click();
  await page.getByRole('option', { name: authenticatedClient.name, exact: true }).click();
  await page.getByTestId('assignment-program-select').click();
  await page.getByRole('option', { name: programName, exact: true }).click();
  await page.getByTestId('assignment-notes-input').fill(programAssignmentNote);
  await page.getByTestId('assignment-submit-button').click();
  await expect(page.getByText('Program assigned')).toBeVisible();

  await page.getByTestId('assignment-type-select').click();
  await page.getByRole('option', { name: 'Standalone workout', exact: true }).click();
  await page.getByTestId('assignment-workout-select').click();
  await page.getByRole('option', { name: workoutName, exact: true }).click();
  await page.getByTestId('assignment-mode-select').click();
  await page.getByRole('option', { name: 'Dated workout', exact: true }).click();
  await page.getByTestId('assignment-date-input').fill(new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10));
  await page.getByTestId('assignment-notes-input').fill(workoutAssignmentNote);
  await page.getByTestId('assignment-submit-button').click();
  await expect(page.getByText('Workout assigned').last()).toBeVisible();

  await page.getByTestId('assignment-mode-select').click();
  await page.getByRole('option', { name: 'Active template', exact: true }).click();
  await expect(page.getByTestId('assignment-date-input')).toBeDisabled();
  await page.getByTestId('assignment-notes-input').fill(activeWorkoutAssignmentNote);
  await page.getByTestId('assignment-submit-button').click();
  await expect(page.getByText('Workout assigned').last()).toBeVisible();

  await logout(page);
  await login(page, accounts.client, '/client');
  await page.goto('/client/programs');
  const assignedProgram = page.getByTestId('client-program-card').filter({ hasText: programName });
  await expect(assignedProgram).toBeVisible();
  await expect(assignedProgram.getByTestId('client-exercise-row').filter({ hasText: exerciseName }).first()).toBeVisible();
  await expect(assignedProgram.getByTestId('program-video-link').first()).toHaveAttribute('href', 'https://example.com/cvf-live-video');
  await expect(page.getByText(workoutAssignmentNote)).toBeVisible();
  await expect(page.getByText(activeWorkoutAssignmentNote)).toBeVisible();
  await logout(page);
  await login(page, accounts.coach, '/coach');
  await page.goto(`/coach/clients/${authenticatedClient.id}`);
  await page.getByTestId('tab-programs').click();
  const assignedProgramCard = page.getByTestId('assigned-program-card').filter({ hasText: programName });
  await assignedProgramCard.getByTestId('unassign-program-button').click();
  await expect(page.getByText('Program unassigned')).toBeVisible();
  for (const note of [workoutAssignmentNote, activeWorkoutAssignmentNote]) {
    const assignedWorkoutCard = page.getByTestId('assigned-workout-card').filter({ hasText: note });
    await assignedWorkoutCard.getByTestId('unassign-workout-button').click();
    await expect(page.getByText('Workout unassigned').last()).toBeVisible();
  }
  await page.goto('/coach/programs');

  const accessToken = await page.evaluate(() => localStorage.getItem('cvf_access_token'));
  const programListResponse = await request.get(`${backendUrl}/api/programs`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  expect(programListResponse.ok()).toBeTruthy();
  const testPrograms = (await programListResponse.json()).filter((row) => [programName, importedProgramName, pastedProgramName].includes(row.name));
  const assignedTestProgram = testPrograms.find((row) => row.name === programName);
  expect(assignedTestProgram).toBeTruthy();
  expect(testPrograms.find((row) => row.name === pastedProgramName)?.frequency_days).toBe(1);
  const programDetailResponse = await request.get(`${backendUrl}/api/programs/${assignedTestProgram.id}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  expect(programDetailResponse.ok()).toBeTruthy();
  for (const assignment of (await programDetailResponse.json()).assignments.filter((row) => row.notes === programAssignmentNote)) {
    const archived = await request.patch(`${backendUrl}/api/programs/assignments/${assignment.id}/archive`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(archived.ok()).toBeTruthy();
  }
  const workoutAssignmentsResponse = await request.get(`${backendUrl}/api/programs/workout-assignments/client/${authenticatedClient.id}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  expect(workoutAssignmentsResponse.ok()).toBeTruthy();
  for (const assignment of (await workoutAssignmentsResponse.json()).filter((row) => [workoutAssignmentNote, activeWorkoutAssignmentNote].includes(row.notes))) {
    const archived = await request.patch(`${backendUrl}/api/programs/workout-assignments/${assignment.id}/archive`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(archived.ok()).toBeTruthy();
  }

  await page.getByTestId('training-builder-tab-programs').click();
  for (const name of [programName, importedProgramName, pastedProgramName]) {
    const card = page.getByTestId('program-card').filter({ hasText: name });
    await card.getByTestId('program-archive-button').click();
    await expect(page.getByText('Program archived').last()).toBeVisible();
    await expect(card).toBeHidden();
  }
  await page.getByTestId('training-builder-tab-workouts').click();
  await workoutCard.getByTestId('workout-archive-button').click();
  await expect(page.getByText('Workout archived')).toBeVisible();
  await page.getByTestId('training-builder-tab-library').click();

  const preCleanupExercisesResponse = await request.get(`${backendUrl}/api/programs/exercise-library`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  expect(preCleanupExercisesResponse.ok()).toBeTruthy();
  const preCleanupExercises = await preCleanupExercisesResponse.json();
  const pastedExercise = preCleanupExercises.find((row) => row.name === pastedExerciseName);
  expect(pastedExercise?.source).toBe('manual');
  expect(pastedExercise?.review_status).toBe('needs_review');
  const normalizedExerciseName = exerciseName.toLowerCase().trim().replace(/\s+/g, ' ');
  expect(preCleanupExercises.filter((row) => row.name.toLowerCase().trim().replace(/\s+/g, ' ') === normalizedExerciseName)).toHaveLength(1);

  for (const name of [exerciseName, csvExerciseName]) {
    const card = page.getByTestId('exercise-library-card').filter({ hasText: name });
    await card.getByTestId('exercise-library-archive-button').click();
    await expect(page.getByText('Exercise archived').last()).toBeVisible();
  }

  const remainingWorkoutsResponse = await request.get(`${backendUrl}/api/programs/workouts`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  expect(remainingWorkoutsResponse.ok()).toBeTruthy();
  for (const workout of (await remainingWorkoutsResponse.json()).filter((row) => row.name.startsWith(marker))) {
    const archived = await request.patch(`${backendUrl}/api/programs/workouts/${workout.id}/archive`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(archived.ok()).toBeTruthy();
  }
  const remainingExercisesResponse = await request.get(`${backendUrl}/api/programs/exercise-library`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  expect(remainingExercisesResponse.ok()).toBeTruthy();
  const remainingExercises = await remainingExercisesResponse.json();
  for (const exercise of remainingExercises.filter((row) => row.name.startsWith(marker))) {
    const archived = await request.patch(`${backendUrl}/api/programs/exercise-library/${exercise.id}/archive`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(archived.ok()).toBeTruthy();
  }

  const checkIns = await request.get(`${backendUrl}/api/check-ins/clients/${clientId}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  expect(checkIns.ok()).toBeTruthy();
  const createdCheckIn = (await checkIns.json()).find((row) => row.general_notes === marker);
  if (createdCheckIn) {
    const archived = await request.patch(`${backendUrl}/api/check-ins/${createdCheckIn.id}/archive`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(archived.ok()).toBeTruthy();
  }
  await page.goto(`/coach/clients/${clientId}`);
  await page.getByTestId('archive-client-button').click();
  await expect(page.getByTestId('archive-client-button')).toContainText('Restore client');
  await page.getByTestId('archive-client-button').click();
  await expect(page.getByTestId('archive-client-button')).toContainText('Archive client');
  await page.getByTestId('archive-client-button').click();
  await expect(page.getByTestId('archive-client-button')).toContainText('Restore client');

  await page.goto('/coach/clients');
  await page.getByTestId('client-list-search-input').fill(marker);
  await expect(page.getByTestId('client-row')).toHaveCount(0);
  await page.getByTestId('client-archive-toggle').click();
  await expect(page.getByTestId('client-row').filter({ hasText: marker })).toBeVisible();
  await page.getByTestId('client-archive-toggle').click();
  await expect(page.getByTestId('client-row')).toHaveCount(0);

  await page.goto('/coach/sessions');
  await expect(page.getByRole('heading', { name: 'Sessions' })).toBeVisible();
  await expect(page.getByTestId('session-create-button')).toBeVisible();
  await page.goto('/coach/programs');
  await expect(page.getByRole('heading', { name: 'Training builder' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Exercise Library' })).toBeVisible();
  await page.goto('/coach/messages');
  await expect(page.getByRole('heading', { name: 'Messages' })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [tab, path] of [
    ['home', '/coach'],
    ['clients', '/coach/clients'],
    ['sessions', '/coach/sessions'],
    ['programs', '/coach/programs'],
    ['messages', '/coach/messages'],
  ]) {
    await page.getByTestId(`bottom-tab-${tab}`).click();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
  }
  await page.getByTestId('coach-quick-add-button').click();
  await expect(page.getByTestId('session-editor-drawer')).toBeVisible();
  await page.keyboard.press('Escape');
  await logout(page);
});

test('real session, payment, progress, booking, and messaging controls complete end to end', async ({ page, request }) => {
  const marker = `CVF LIVE FLOW ${Date.now()}`;
  const packageName = `${marker} Package`;
  const metricName = `${marker} Metric`;
  const approveNote = `${marker} APPROVE`;
  const declineNote = `${marker} DECLINE`;
  const approveLocation = `${marker} Booking Studio`;
  const editedLocation = `${marker} Updated Studio`;
  const sharedNote = `${marker} shared session note`;
  const clientMessage = `${marker} client message`;
  const coachReply = `${marker} coach reply`;

  const [adminLoginResponse, coachLoginResponse, clientLoginResponse] = await Promise.all([
    request.post(`${backendUrl}/api/auth/login`, { data: accounts.admin }),
    request.post(`${backendUrl}/api/auth/login`, { data: accounts.coach }),
    request.post(`${backendUrl}/api/auth/login`, { data: accounts.client }),
  ]);
  expect(adminLoginResponse.ok()).toBeTruthy();
  expect(coachLoginResponse.ok()).toBeTruthy();
  expect(clientLoginResponse.ok()).toBeTruthy();
  const adminSession = await adminLoginResponse.json();
  const coachSession = await coachLoginResponse.json();
  const clientSession = await clientLoginResponse.json();
  const adminHeaders = { authorization: `Bearer ${adminSession.access_token}` };
  const coachHeaders = { authorization: `Bearer ${coachSession.access_token}` };
  const clientHeaders = { authorization: `Bearer ${clientSession.access_token}` };

  const packageResponse = await request.post(`${backendUrl}/api/packages`, {
    headers: adminHeaders,
    data: { name: packageName, description: marker, price: 25, session_credits: 1, is_recurring: false },
  });
  expect(packageResponse.status()).toBe(201);
  const packageRow = await packageResponse.json();
  const metricResponse = await request.post(`${backendUrl}/api/progress/clients/${clientSession.profile.id}/metrics`, {
    headers: coachHeaders,
    data: { name: metricName, unit: 'reps' },
  });
  expect(metricResponse.status()).toBe(201);
  const metricRow = await metricResponse.json();

  for (const [days, note, location] of [[7, approveNote, approveLocation], [8, declineNote, `${marker} Decline Studio`]]) {
    const bookingResponse = await request.post(`${backendUrl}/api/bookings`, {
      headers: clientHeaders,
      data: {
        requested_time: new Date(Date.now() + days * 86_400_000).toISOString(),
        duration_minutes: 60,
        location,
        note,
      },
    });
    expect(bookingResponse.status()).toBe(201);
  }

  try {
    await login(page, accounts.coach, '/coach');
    const approveRequest = page.getByTestId('booking-request-row').filter({ hasText: approveNote });
    const declineRequest = page.getByTestId('booking-request-row').filter({ hasText: declineNote });
    await approveRequest.getByTestId('booking-approve-button').click();
    await expect(page.getByText('Approved - session created')).toBeVisible();
    await expect(approveRequest).toBeHidden();
    await declineRequest.getByTestId('booking-decline-button').click();
    await expect(page.getByText('Request declined')).toBeVisible();
    await expect(declineRequest).toBeHidden();

    await page.goto(`/coach/clients/${clientSession.profile.id}`);
    const startingCredits = Number.parseInt(await page.getByTestId('client-credits-badge').textContent(), 10);
    expect(Number.isFinite(startingCredits)).toBeTruthy();
    await page.getByTestId('tab-payments').click();
    await page.getByTestId('record-purchase-button').click();
    await page.getByTestId('purchase-package-select').click();
    await page.getByTestId('purchase-package-option').filter({ hasText: packageName }).click();
    await page.getByTestId('purchase-confirm-button').click();
    await expect(page.getByText(/Purchase recorded - balance now/)).toBeVisible();
    await expect(page.getByTestId('payment-history-row').filter({ hasText: packageName })).toBeVisible();
    await expect(page.getByTestId('client-credits-badge')).toContainText(`${startingCredits + 1} credits`);

    await page.goto('/coach/sessions');
    const approvedSession = page.getByTestId('session-row').filter({ hasText: approveLocation });
    await expect(approvedSession).toBeVisible();
    await approvedSession.getByTestId('session-actions-button').click();
    await page.getByTestId('session-edit-action').click();
    await expect(page.getByTestId('session-editor-drawer')).toBeVisible();
    await page.getByTestId('session-location-input').fill(editedLocation);
    await page.getByTestId('session-save-button').click();
    await expect(page.getByText('Session updated')).toBeVisible();
    const editedSession = page.getByTestId('session-row').filter({ hasText: editedLocation });
    await editedSession.getByTestId('session-actions-button').click();
    await page.getByTestId('session-notes-action').click();
    await expect(page.getByTestId('session-notes-dialog')).toBeVisible();
    await page.getByTestId('session-notes-textarea').fill(sharedNote);
    await page.getByTestId('session-notes-share-switch').click();
    await page.getByTestId('note-save-button').click();
    await expect(page.getByText('Note saved & shared with client')).toBeVisible();
    const noteRow = page.getByTestId('session-note-row').filter({ hasText: sharedNote });
    await expect(noteRow).toBeVisible();
    await noteRow.getByTestId('note-share-toggle').click();
    await expect(noteRow.getByTestId('note-share-toggle')).toHaveAttribute('data-state', 'unchecked');
    await noteRow.getByTestId('note-share-toggle').click();
    await expect(noteRow.getByTestId('note-share-toggle')).toHaveAttribute('data-state', 'checked');
    await page.keyboard.press('Escape');
    await editedSession.getByTestId('session-actions-button').click();
    await page.getByTestId('session-complete-action').click();
    await expect(page.getByText(/Session completed - 1 credit used/)).toBeVisible();
    await page.getByTestId('session-filter-past').click();
    await expect(page.getByTestId('session-row').filter({ hasText: editedLocation })).toContainText('completed');

    await logout(page);
    await login(page, accounts.client, '/client');
    await page.goto('/client/sessions');
    const pastSession = page.getByTestId('client-past-session-row').filter({ hasText: sharedNote });
    await expect(pastSession).toBeVisible();
    await expect(pastSession.getByTestId('shared-note-row').filter({ hasText: sharedNote })).toBeVisible();
    await page.goto('/client/packages');
    await expect(page.getByTestId('client-payment-row').filter({ hasText: packageName })).toBeVisible();
    await expect(page.getByTestId('credits-balance-text')).toContainText(String(startingCredits));

    await page.goto('/client/progress');
    const metricCard = page.getByTestId('client-metric-card').filter({ hasText: metricName });
    await metricCard.getByTestId('client-log-entry-button').click();
    await page.getByTestId('client-entry-value-input').fill('10');
    await page.getByTestId('client-entry-notes-input').fill(marker);
    await page.getByTestId('client-entry-save-button').click();
    await expect(page.getByText('Progress entry logged')).toBeVisible();
    const entryRow = metricCard.getByTestId('client-progress-entry-row').filter({ hasText: marker });
    await entryRow.getByTestId('client-edit-entry-button').click();
    await page.getByTestId('client-entry-value-input').fill('11');
    await page.getByTestId('client-entry-notes-input').fill(`${marker} updated`);
    await page.getByTestId('client-entry-save-button').click();
    await expect(page.getByText('Progress entry updated')).toBeVisible();
    await expect(metricCard.getByTestId('client-progress-entry-row').filter({ hasText: `${marker} updated` })).toContainText('11');

    await page.goto('/client/messages');
    await page.getByTestId('chat-input').fill(clientMessage);
    await page.getByTestId('chat-send-button').click();
    await expect(page.getByTestId('chat-message-list').getByText(clientMessage)).toBeVisible();
    await logout(page);
    await login(page, accounts.coach, '/coach');
    await page.goto('/coach/messages');
    await page.getByTestId('message-thread-row').filter({ hasText: clientSession.profile.name }).click();
    await page.getByTestId('chat-input').fill(coachReply);
    await page.getByTestId('chat-send-button').click();
    await expect(page.getByTestId('chat-message-list').getByText(coachReply)).toBeVisible();
    await logout(page);
    await login(page, accounts.client, '/client');
    await page.goto('/client/messages');
    await expect(page.getByTestId('chat-message-list').getByText(coachReply)).toBeVisible();
    await logout(page);
  } finally {
    const metricsResponse = await request.get(`${backendUrl}/api/progress/clients/${clientSession.profile.id}/metrics`, {
      headers: coachHeaders,
    });
    if (metricsResponse.ok()) {
      const createdMetric = (await metricsResponse.json()).find((row) => row.id === metricRow.id);
      for (const entry of createdMetric?.entries || []) {
        const archivedEntry = await request.patch(`${backendUrl}/api/progress/entries/${entry.id}/archive`, { headers: coachHeaders });
        expect(archivedEntry.ok()).toBeTruthy();
      }
      const archivedMetric = await request.patch(`${backendUrl}/api/progress/metrics/${metricRow.id}/archive`, { headers: coachHeaders });
      expect(archivedMetric.ok()).toBeTruthy();
    }
    const archivedPackage = await request.patch(`${backendUrl}/api/packages/${packageRow.id}/archive`, {
      headers: adminHeaders,
      data: { archived: true },
    });
    expect(archivedPackage.ok()).toBeTruthy();
  }
});

test('real admin auth covers management, safe waiver gate, reassignment, and role boundaries', async ({ page, request }) => {
  const marker = `CVF LIVE PACKAGE ${Date.now()}`;
  const clientLoginResponse = await request.post(`${backendUrl}/api/auth/login`, { data: accounts.client });
  expect(clientLoginResponse.ok()).toBeTruthy();
  const clientSession = await clientLoginResponse.json();
  await login(page, accounts.admin, '/coach');
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Admin' })).toBeVisible();
  await expect(page.getByTestId('admin-tab-coaches')).toBeVisible();
  await expect(page.getByTestId('admin-tab-waivers')).toBeVisible();
  await expect(page.getByTestId('admin-tab-packages')).toBeVisible();

  await page.getByTestId('admin-add-coach-button').click();
  await expect(page.getByTestId('admin-coach-create-dialog')).toBeVisible();
  await page.getByTestId('coach-name-input').fill('CVF LIVE Duplicate Account Check');
  await page.getByTestId('coach-email-input').fill(accounts.admin.email);
  await page.getByTestId('coach-password-input').fill(`CvF-${randomBytes(18).toString('base64url')}!`);
  await page.getByTestId('coach-admin-switch').click();
  await page.getByTestId('coach-create-button').click();
  await expect(page.getByText('An account with this email already exists')).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByTestId('admin-tab-waivers').click();
  await page.getByTestId('waiver-version-create-button').click();
  await expect(page.getByTestId('admin-waiver-create-dialog')).toBeVisible();
  await expect(page.getByTestId('waiver-text-input')).toHaveValue('');
  await expect(page.getByTestId('waiver-publish-button')).toBeDisabled();
  await page.keyboard.press('Escape');

  await page.getByTestId('admin-tab-packages').click();
  await page.getByTestId('package-create-button').click();
  await page.getByTestId('package-name-input').fill(marker);
  await page.getByTestId('package-description-input').fill('Real-auth browser verification');
  await page.getByTestId('package-price-input').fill('99');
  await page.getByTestId('package-credits-input').fill('2');
  await page.getByTestId('package-recurring-switch').click();
  await page.getByTestId('package-save-button').click();
  await expect(page.getByText('Package created')).toBeVisible();
  const packageRow = page.getByTestId('admin-package-row').filter({ hasText: marker });
  await packageRow.getByTestId('package-edit-button').click();
  await page.getByTestId('package-description-input').fill('Updated real-auth browser verification');
  await page.getByTestId('package-save-button').click();
  await expect(page.getByText('Package updated')).toBeVisible();
  await packageRow.getByTestId('package-archive-button').click();
  await expect(packageRow).toContainText('Archived');
  await packageRow.getByTestId('package-archive-button').click();
  await expect(page.getByText('Package restored')).toBeVisible();
  await expect(packageRow).not.toContainText('Archived');
  await packageRow.getByTestId('package-archive-button').click();
  await expect(page.getByText('Package archived').last()).toBeVisible();
  await expect(packageRow).toContainText('Archived');

  const adminToken = await page.evaluate(() => localStorage.getItem('cvf_access_token'));
  const coachesResponse = await request.get(`${backendUrl}/api/admin/coaches`, {
    headers: { authorization: `Bearer ${adminToken}` },
  });
  expect(coachesResponse.ok()).toBeTruthy();
  const coaches = await coachesResponse.json();
  const originalCoach = coaches.find((coach) => coach.id === clientSession.profile.coach_id);
  const alternateCoach = coaches.find((coach) => coach.id !== clientSession.profile.coach_id && !coach.is_admin);
  expect(originalCoach).toBeTruthy();
  expect(alternateCoach).toBeTruthy();
  let restoreOriginalCoach = false;
  try {
    await page.goto(`/coach/clients/${clientSession.profile.id}`);
    await page.getByTestId('admin-reassign-client-button').click();
    restoreOriginalCoach = true;
    await page.getByTestId('admin-reassign-coach-option').filter({ hasText: alternateCoach.name }).click();
    await expect(page.getByText('Client reassigned').last()).toBeVisible();
    await page.getByTestId('admin-reassign-client-button').click();
    await page.getByTestId('admin-reassign-coach-option').filter({ hasText: originalCoach.name }).click();
    await expect(page.getByText('Client reassigned').last()).toBeVisible();
    restoreOriginalCoach = false;

    await page.goto('/client');
    await expect(page).toHaveURL(/\/coach$/);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByTestId('mobile-admin-link')).toBeVisible();
    await page.getByTestId('mobile-admin-link').click();
    await expect(page).toHaveURL(/\/admin$/);
    await logout(page);
  } finally {
    if (restoreOriginalCoach) {
      const restored = await request.patch(`${backendUrl}/api/admin/clients/${clientSession.profile.id}/reassign`, {
        headers: { authorization: `Bearer ${adminToken}` },
        data: { coach_id: originalCoach.id },
      });
      expect(restored.ok()).toBeTruthy();
    }
  }
});
