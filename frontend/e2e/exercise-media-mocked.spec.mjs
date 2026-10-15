// Normal (non-preview) build with every /api request intercepted. Asserts what
// only real network traffic can show: request/byte budgets, link batching,
// expiry refresh, 5xx metadata recovery, offline logging, and that no link or
// media metadata is ever persisted. No backend, no real auth.
import { test, expect } from '@playwright/test';

test.setTimeout(60_000);

// A real PNG (Playwright decodes nothing; the browser does).
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAJCAIAAAC0SDtlAAAAGklEQVR4nGP8z8Dwn4EIwESMolGFowqHmEIAQJcCERg5oyQAAAAASUVORK5CYII=', 'base64');
const media = (n, extra = {}) => ({
  exercise_id: `lib-${n}`, revision_id: `rev-${n}`, version: 1, kind: 'photo', alt_text: `Synthetic photo ${n}`, cues: ['Synthetic cue'],
  poster: { asset_id: `poster-${n}`, width: 640, height: 360 }, end_frame: null, preview: null, instruction: null, transcript_available: false, ...extra,
});
const sets = (id) => [1, 2].map((n) => ({ id: `${id}-set-${n}`, workout_log_exercise_id: id, set_number: n, status: 'pending', set_origin: 'prescribed', actual_load_value: null, actual_load_unit: 'lb', actual_reps: null, actual_rpe: null }));

function workout(count, decorate = () => ({})) {
  return {
    id: 'media-log', client_id: 'client-1', workout_name: 'Synthetic media workout', status: 'active', started_at: new Date().toISOString(), coach_responses: [],
    exercises: Array.from({ length: count }, (_, i) => ({
      id: `ex-${i}`, exercise_name: `Synthetic exercise ${i + 1}`, exercise_library_id: `lib-${i}`, tracking_type: 'reps_weight', prescribed_reps: '8', prescribed_rest_seconds: 60, sort_order: i,
      sets: sets(`ex-${i}`), media: media(i, i % 3 === 1 ? { kind: 'video', preview: { asset_id: `preview-${i}`, duration_ms: 2000, width: 640, height: 360, bytes: 1_200_000 } } : {}), ...decorate(i),
    })),
  };
}

async function mockApi(page, log, { links, content, resolve } = {}) {
  const calls = { links: [], content: [], videoContent: 0, resolve: 0, writes: [] };
  await page.addInitScript(() => localStorage.setItem('cvf_access_token', 'synthetic-media-token'));
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api/, '');
    const json = (value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
    if (path === '/auth/me') return json({ role: 'client', email: 'client@example.invalid', profile: { id: 'client-1', name: 'Synthetic Client', waiver_signed: true } });
    if (path === '/telemetry/events') return route.fulfill({ status: 204 });
    if (path.endsWith('/unread-count')) return json({ unread: 0 });
    if (path === `/workout-logs/${log.id}` && request.method() === 'GET') return json(log);
    if (path.startsWith(`/workout-logs/${log.id}/sets/`) && request.method() === 'PATCH') {
      calls.writes.push(request.postDataJSON());
      const set = log.exercises.flatMap((e) => e.sets).find((s) => s.id === path.split('/').at(-1));
      Object.assign(set, request.postDataJSON());
      return json(set);
    }
    if (path === '/exercise-media/links') {
      const body = request.postDataJSON();
      calls.links.push(body.assets.map((a) => a.asset_id));
      if (links) return links(body, json, calls);
      return json({ links: body.assets.map(({ asset_id: id }) => ({ asset_id: id, url: `/api/exercise-media/content/${id}.sig${calls.links.length}`, expires_at: new Date(Date.now() + 60_000).toISOString() })), missing: [] });
    }
    if (path === '/exercise-media/resolve') { calls.resolve += 1; return resolve ? resolve(json) : json({ media: [] }); }
    if (path.startsWith('/exercise-media/content/')) {
      const token = path.split('/').at(-1);
      calls.content.push(token);
      if (token.startsWith('preview-')) calls.videoContent += 1;
      if (content && await content(token, route)) return undefined;
      return route.fulfill({ status: 200, contentType: 'image/png', headers: { 'cache-control': 'private, max-age=60' }, body: PNG });
    }
    return json({ error: `unexpected ${request.method()} ${path}` }, 404);
  });
  return calls;
}

async function openTracker(page) {
  await page.goto('/client/workouts/media-log/track');
  await expect(page.getByTestId('workout-tracker')).toBeVisible();
}

test('50 exercises: one batched link request, only active+next posters fetched, zero video requests', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const calls = await mockApi(page, workout(50));
  await openTracker(page);
  await expect(page.getByTestId('exercise-media-poster')).toHaveCount(2);
  await expect(page.getByTestId('exercise-media-deferred')).toHaveCount(48);
  await page.waitForTimeout(500);
  expect(calls.links.length).toBe(2);
  expect(calls.links.every((batch) => batch.length <= 20)).toBe(true);
  expect(calls.content).toHaveLength(2);
  expect(calls.videoContent).toBe(0);
  // Scrolling the long list never triggers more media requests.
  await page.getByTestId('workout-scroll-region').evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
  await page.waitForTimeout(500);
  expect(calls.content).toHaveLength(2);
  expect(await page.locator('video').count()).toBe(0);
});

test('expired/404 poster falls back to text; one explicit retry fetches one fresh link (no polling)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let fail = true;
  const calls = await mockApi(page, workout(2), {
    content: async (token, route) => {
      if (!(token.startsWith('poster-0') && fail)) return false;
      await route.fulfill({ status: 403, contentType: 'application/json', body: '{"code":"link_expired"}' });
      return true;
    },
  });
  await openTracker(page);
  const card = page.getByTestId('tracker-exercise-card').first();
  await expect(card.getByText('Preview unavailable')).toBeVisible();
  await expect(card.getByTestId('exercise-media-poster')).toHaveCount(0);
  const before = calls.links.length;
  await page.waitForTimeout(1500);
  expect(calls.links.length).toBe(before, 'no automatic polling after a failure');
  fail = false;
  await card.getByTestId('exercise-media-retry').click();
  await expect(card.getByTestId('exercise-media-poster')).toBeVisible();
  expect(calls.links.length).toBe(before + 1);
  // Logging is unaffected throughout.
  await card.getByRole('button', { name: 'Complete set 1' }).click();
  await expect.poll(() => calls.writes.length).toBeGreaterThan(0);
});

test('metadata lookup failure keeps logging; Retry resolves guides without touching set data', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const log = workout(3, () => ({ media: null, media_status: 'unavailable' }));
  const calls = await mockApi(page, log, { resolve: (json) => json({ media: [media(0), media(1)] }) });
  await openTracker(page);
  const card = page.getByTestId('tracker-exercise-card').first();
  await expect(card.getByTestId('exercise-media-unavailable')).toBeVisible();
  const weight = card.getByRole('spinbutton', { name: /set 1 weight/ });
  await weight.fill('22.5');
  await weight.blur();
  await expect.poll(() => calls.writes.length).toBe(1);
  await card.getByTestId('exercise-media-unavailable').getByRole('button', { name: 'Retry' }).click();
  await expect(card.getByTestId('exercise-media-poster')).toBeVisible();
  expect(calls.resolve).toBe(1);
  await expect(weight).toHaveValue('22.5');
});

test('links failing (503) never spin forever and never block offline logging; nothing is persisted', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const calls = await mockApi(page, workout(2), { links: (_body, json) => json({ error: 'unavailable', code: 'media_unavailable' }, 503) });
  await openTracker(page);
  const card = page.getByTestId('tracker-exercise-card').first();
  await expect(card.getByText('Preview unavailable')).toBeVisible();
  await context.setOffline(true);
  await card.getByRole('button', { name: 'Complete set 1' }).click();
  await expect(page.getByTestId('workout-save-state')).toContainText(/Offline|Not saved/);
  await context.setOffline(false);
  const stored = await page.evaluate(() => Object.entries(localStorage).map(([k, v]) => `${k}=${v}`).join('\n'));
  expect(stored).not.toContain('/exercise-media/content/');
  expect(stored).not.toContain('poster-');
  expect(stored).not.toContain('rev-0');
  expect(calls.content).toHaveLength(0);
});

test('data saver and reduced motion: stills only, preview size shown, video loads only after an explicit tap', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => Object.defineProperty(navigator, 'connection', { value: { saveData: true }, configurable: true }));
  const calls = await mockApi(page, workout(3), {
    content: async (token, route) => {
      if (!token.startsWith('preview-')) return false;
      await route.fulfill({ status: 200, contentType: 'video/mp4', body: Buffer.alloc(64) });
      return true;
    },
  });
  await openTracker(page);
  const card = page.getByTestId('tracker-exercise-card').nth(1);
  const play = card.getByTestId('exercise-media-play');
  await expect(play).toContainText('(1.1 MB)');
  await page.waitForTimeout(500);
  expect(calls.videoContent).toBe(0);
  await play.click();
  await expect.poll(() => calls.links.flat().includes('preview-1')).toBe(true);
  // An undecodable preview degrades to a retry, never a broken player.
  await expect(card.getByRole('button', { name: 'Retry preview' })).toBeVisible();
});
