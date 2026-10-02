import { test, expect, usePreviewRole, callPreviewApi } from './preview-test.mjs';

const pad = (n) => String(n).padStart(2, '0');
const dayIso = (daysAhead) => {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const weekdayOf = (dateStr) => new Date(`${dateStr}T12:00:00`).getDay();
const plusDays = (dateStr, n) => {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const START = dayIso(10);
const ruleFor = (start = START, overrides = {}) => ({
  start_date: start, time: '09:00', weekdays: [weekdayOf(start)], interval_weeks: 1, end: { count: 3 }, ...overrides,
});
const previewBody = (clientId, start = START, overrides = {}) => ({
  client_id: clientId, duration_minutes: 60, location: 'CVF Studio', ...ruleFor(start, overrides),
});
const threeSlots = (start = START) => [0, 7, 14].map((offset, index) => ({ key: `g${index + 1}`, date: plusDays(start, offset), time: '09:00' }));
const createBody = (clientId, requestId, overrides = {}) => ({
  request_id: requestId, client_id: clientId, duration_minutes: 60, location: 'CVF Studio', rule: ruleFor(),
  slots: threeSlots().map((slot) => ({ ...slot, workout_id: null })),
  program_id: null, assign_program: false, notify: true, ...overrides,
});

async function openCoach(page) {
  await usePreviewRole(page, 'coach');
  await page.goto('/coach/sessions');
  await expect(page.getByTestId('session-create-button')).toBeVisible();
}

test('preview expands the rule into weekly Denver-time slots with no conflicts', async ({ page }) => {
  await openCoach(page);
  const { status, data } = await callPreviewApi(page, 'post', '/sessions/series/preview', previewBody('client_david'));
  expect(status).toBe(200);
  expect(data.slots.map((slot) => slot.key)).toEqual(['g1', 'g2', 'g3']);
  expect(data.slots.map((slot) => slot.date)).toEqual([START, plusDays(START, 7), plusDays(START, 14)]);
  expect(data.slots.every((slot) => slot.time === '09:00' && slot.conflict === null && slot.suggestions.length === 0)).toBe(true);
  expect(data.slots[0].display).toMatch(/9:00\sAM$/); // \s: newer ICU uses a narrow no-break space
});

test('preview mirrors the server validation messages', async ({ page }) => {
  await openCoach(page);
  const tooMany = await callPreviewApi(page, 'post', '/sessions/series/preview', previewBody('client_david', START, { end: { count: 53 } }));
  expect(tooMany.status).toBe(400);
  expect(tooMany.data.error).toBe('A series has between 1 and 52 sessions');
  const past = await callPreviewApi(page, 'post', '/sessions/series/preview', previewBody('client_david', dayIso(-3)));
  expect(past.status).toBe(400);
  expect(past.data.error).toBe('A series cannot start in the past');
});

test('create saves the series, replays the same request, and rejects a changed one', async ({ page }) => {
  await openCoach(page);
  const body = createBody('client_david', '11111111-1111-4111-8111-111111111111');
  const created = await callPreviewApi(page, 'post', '/sessions/series', body);
  expect(created.status).toBe(201);
  expect(created.data.replayed).toBe(false);
  expect(created.data.receipt.slots.map((slot) => [slot.key, slot.ordinal])).toEqual([['g1', 1], ['g2', 2], ['g3', 3]]);
  expect(created.data.series.created_count).toBe(3);

  const replay = await callPreviewApi(page, 'post', '/sessions/series', body);
  expect(replay.status).toBe(200);
  expect(replay.data.replayed).toBe(true);
  expect(replay.data.series.id).toBe(created.data.series.id);

  const changed = await callPreviewApi(page, 'post', '/sessions/series', { ...body, location: 'Somewhere else' });
  expect(changed.status).toBe(409);
  expect(changed.data.code).toBe('request_mismatch');

  const sessions = (await callPreviewApi(page, 'get', '/sessions')).data.filter((row) => row.series_id === created.data.series.id);
  expect(sessions).toHaveLength(3);
  expect(sessions.map((row) => row.series_ordinal)).toEqual([1, 2, 3]);
  expect(sessions[0].series).toEqual({ id: created.data.series.id, rule: body.rule, created_count: 3 });
  const detail = await callPreviewApi(page, 'get', `/sessions/${sessions[0].id}/coach-detail`);
  expect(detail.data.series.created_count).toBe(3);
  expect(detail.data.series_ordinal).toBe(1);
});

test('a second client at the same coach times conflicts, with the nearest free suggestions, and nothing is saved', async ({ page }) => {
  await openCoach(page);
  await callPreviewApi(page, 'post', '/sessions/series', createBody('client_david', '22222222-2222-4222-8222-222222222222'));
  const before = (await callPreviewApi(page, 'get', '/sessions')).data.length;

  const check = await callPreviewApi(page, 'post', '/sessions/series/check', {
    client_id: 'client_sarah', duration_minutes: 60, start_date: START, seq: 7, slots: threeSlots(),
  });
  expect(check.status).toBe(200);
  expect(check.data.seq).toBe(7);
  expect(check.data.slots.map((slot) => slot.conflict.scope)).toEqual(['coach', 'coach', 'coach']);
  expect(check.data.slots[1].suggestions.map((s) => s.time)).toEqual(['10:00', '08:00', '10:15']);

  const refused = await callPreviewApi(page, 'post', '/sessions/series', createBody('client_sarah', '33333333-3333-4333-8333-333333333333'));
  expect(refused.status).toBe(409);
  expect(refused.data.error).toBe('Some dates are no longer available');
  expect(refused.data.conflicts.map((conflict) => [conflict.key, conflict.scope])).toEqual([['g1', 'coach'], ['g2', 'coach'], ['g3', 'coach']]);
  expect((await callPreviewApi(page, 'get', '/sessions')).data).toHaveLength(before);
});

test('two rows of one request that overlap are both flagged as a batch conflict', async ({ page }) => {
  await openCoach(page);
  const check = await callPreviewApi(page, 'post', '/sessions/series/check', {
    client_id: 'client_david', duration_minutes: 60, start_date: START, seq: 1,
    slots: [{ key: 'g1', date: START, time: '09:00' }, { key: 'g2', date: START, time: '09:30' }],
  });
  expect(check.data.slots.map((slot) => slot.conflict)).toEqual([
    { scope: 'batch', with_key: 'g2', display: null },
    { scope: 'batch', with_key: 'g1', display: null },
  ]);
});

test('cancel "this and all future" cancels from the anchor on and is safe to repeat', async ({ page }) => {
  await openCoach(page);
  const created = await callPreviewApi(page, 'post', '/sessions/series', createBody('client_david', '44444444-4444-4444-8444-444444444444'));
  const seriesId = created.data.series.id;
  const anchor = created.data.receipt.slots[1].session_id;

  const cancelled = await callPreviewApi(page, 'patch', `/sessions/series/${seriesId}/cancel`, { from_session_id: anchor, notify: false });
  expect(cancelled.status).toBe(200);
  expect(cancelled.data.cancelled).toHaveLength(2);
  const rows = (await callPreviewApi(page, 'get', '/sessions')).data.filter((row) => row.series_id === seriesId);
  expect(rows.map((row) => row.status)).toEqual(['scheduled', 'cancelled', 'cancelled']);

  const again = await callPreviewApi(page, 'patch', `/sessions/series/${seriesId}/cancel`, { from_session_id: anchor, notify: false });
  expect(again.data.cancelled).toEqual([]);
  const wrong = await callPreviewApi(page, 'patch', '/sessions/series/no_such_series/cancel', { from_session_id: anchor, notify: false });
  expect(wrong.status).toBe(404);
  expect(wrong.data.error).toBe('Series not found');
});

test('a reload clears a pending recurring save left by a preview coach', async ({ page }) => {
  await openCoach(page);
  await page.evaluate(() => {
    localStorage.setItem('cvf_series_pending:coach_marcus:client_david', JSON.stringify({ request_id: 'r', body: {}, state: 'pending' }));
    localStorage.setItem('cvf_series_pending:3f2b8c1e-1111-4222-8333-444455556666:client_x', '{}');
  });
  await page.reload();
  await expect(page.getByTestId('session-create-button')).toBeVisible();
  const keys = await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('cvf_series_pending')));
  expect(keys).toEqual(['cvf_series_pending:3f2b8c1e-1111-4222-8333-444455556666:client_x']);
  await expect(page.getByTestId('series-unknown')).toHaveCount(0);
});
test('"also assign this program" gives a client without it a private, editable copy', async ({ page }) => {
  await usePreviewRole(page, 'coach');
  await page.goto('/coach/clients/client_david');
  await page.getByTestId('tab-programs').click();
  await expect(page.getByTestId('assigned-program-card')).toHaveCount(0);

  const created = await callPreviewApi(page, 'post', '/sessions/series',
    createBody('client_david', '55555555-5555-4555-8555-555555555555', { program_id: 'program_foundation', assign_program: true }));
  expect(created.status).toBe(201);

  // In-app navigation keeps the in-memory fixtures; a reload would rebuild them.
  await page.getByTestId('preview-quick-link').filter({ hasText: 'Clients' }).first().click();
  await page.getByTestId('client-row').filter({ hasText: 'David Chen' }).click();
  await page.getByTestId('tab-programs').click();
  const copy = page.getByTestId('assigned-program-card').filter({ hasText: 'Foundation Strength - Phase 1' });
  await expect(copy).toHaveCount(1);
  // Only a client copy offers Edit; a template assigned directly does not.
  await expect(copy.getByTestId('edit-client-workout-button').first()).toBeVisible();
});

test('a client who already has the program, or a copy of it, gets no second assignment', async ({ page }) => {
  await usePreviewRole(page, 'coach');
  await page.goto('/coach/clients/client_sarah');
  await page.getByTestId('tab-programs').click();
  await expect(page.getByTestId('assigned-program-card').first()).toBeVisible();
  const before = await page.getByTestId('assigned-program-card').count();

  const created = await callPreviewApi(page, 'post', '/sessions/series',
    createBody('client_sarah', '66666666-6666-4666-8666-666666666666', { program_id: 'program_foundation', assign_program: true }));
  expect(created.status).toBe(201);

  await page.getByTestId('preview-quick-link').filter({ hasText: 'Clients' }).first().click();
  await page.getByTestId('client-row').filter({ hasText: 'Sarah Martinez' }).click();
  await page.getByTestId('tab-programs').click();
  await expect(page.getByTestId('assigned-program-card').first()).toBeVisible();
  await expect(page.getByTestId('assigned-program-card')).toHaveCount(before);
});
test('each program day gets its own workout copy, owned by the client\'s coach', async ({ page }) => {
  await openCoach(page);
  // Hybrid Strength: days 1 and 4 both use the Lower Strength A template.
  const created = await callPreviewApi(page, 'post', '/sessions/series',
    createBody('client_david', '88888888-8888-4888-8888-888888888888', { program_id: 'program_hybrid', assign_program: true }));
  expect(created.status).toBe(201);

  const workouts = (await callPreviewApi(page, 'get', '/programs/workouts')).data;
  const davidCopies = workouts.filter((workout) => workout.client_id === 'client_david' && workout.is_template === false);
  expect(davidCopies).toHaveLength(4);
  expect(new Set(davidCopies.map((workout) => workout.id)).size).toBe(4);
  expect(davidCopies.filter((workout) => workout.source_workout_id === 'workout_lower_a')).toHaveLength(2);
  expect(davidCopies.every((workout) => workout.coach_id === 'coach_marcus')).toBe(true);
  expect(davidCopies.map((workout) => workout.name).sort()).toEqual(
    ['Lower Strength A', 'Lower Strength A', 'Run Prep Mobility', 'Upper Strength A']);
});
