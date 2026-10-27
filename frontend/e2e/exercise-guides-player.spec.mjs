// Click-to-load YouTube demos in the real tracker (docs/exercise-guides/design.md).
// Normal (non-preview) build; every /api call AND every YouTube host is routed
// here: the provider boundary is a deterministic stub (an IFrame API shim and a
// synthetic embed page), so these tests prove the app's behavior, never Google's
// availability. Records every request to a provider host.
import { test, expect } from '@playwright/test';

test.setTimeout(60_000);

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAJCAIAAAC0SDtlAAAAGklEQVR4nGP8z8Dwn4EIwESMolGFowqHmEIAQJcCERg5oyQAAAAASUVORK5CYII=', 'base64');
const PROVIDER = /(^|\.)(youtube\.com|youtube-nocookie\.com|youtu\.be|ytimg\.com|googlevideo\.com|doubleclick\.net|google\.com|gstatic\.com)$/;
const ID_A = 'SYNTHdemo01';
const ID_B = 'SYNTHdemo02';
const sets = (id) => [1, 2].map((n) => ({ id: `${id}-set-${n}`, workout_log_exercise_id: id, set_number: n, status: 'pending', set_origin: 'prescribed', actual_load_value: null, actual_load_unit: 'lb', actual_reps: null, actual_rpe: null }));
const photo = (n, cues = ['Synthetic cue one', 'Synthetic cue two']) => ({ exercise_id: `lib-${n}`, revision_id: `rev-${n}`, version: 1, kind: 'photo', alt_text: `Synthetic photo ${n}`, cues, poster: { asset_id: `poster-${n}`, width: 640, height: 360 }, end_frame: null, preview: null, instruction: null, transcript_available: false });
// Long unbroken fictional text: nothing may depend on the short sample name.
const LONG_NAME = 'SyntheticUnbrokenExerciseIdentifierWithoutAnySpacesForWrappingChecks0123456789';
const LONG_CUE = 'SyntheticCueWithoutAnySpacesThatMustWrapInsideTheDialogOnSmallPhones0123456789';

function log() {
  const demo = (id) => ({ kind: 'youtube', url: `https://www.youtube.com/watch?v=${id}`, video_id: id, source: 'library', current_guide: true });
  return {
    id: 'guide-log', client_id: 'client-1', workout_name: 'Synthetic guides workout', status: 'active', started_at: new Date().toISOString(), coach_responses: [],
    exercises: [
      { id: 'ex-0', exercise_name: 'Synthetic Goblet Squat', exercise_library_id: 'lib-0', tracking_type: 'reps_weight', prescribed_reps: '8', prescribed_rest_seconds: 60, position: 0, sets: sets('ex-0'), media: photo(0), demo: demo(ID_A), video_url: `https://youtu.be/${ID_A}` },
      { id: 'ex-1', exercise_name: 'Synthetic Plank (no photo)', exercise_library_id: 'lib-1', tracking_type: 'reps_weight', prescribed_reps: '8', position: 1, sets: sets('ex-1'), media: null, demo: demo(ID_B), video_url: `https://youtu.be/${ID_B}` },
      { id: 'ex-2', exercise_name: 'Synthetic Band Row', exercise_library_id: 'lib-2', tracking_type: 'reps_weight', prescribed_reps: '8', position: 2, sets: sets('ex-2'), media: null, demo: { kind: 'external', url: 'https://example.com/synthetic-coach-override', source: 'override', current_guide: true }, video_url: 'https://example.com/synthetic-coach-override' },
      // A tampered DTO must not become an embed: the URL is generic.
      { id: 'ex-3', exercise_name: 'Synthetic Tampered', exercise_library_id: 'lib-3', tracking_type: 'reps_weight', prescribed_reps: '8', position: 3, sets: sets('ex-3'), media: null, demo: { kind: 'youtube', url: 'https://example.com/not-youtube', video_id: ID_A, source: 'library', current_guide: true }, video_url: 'https://example.com/not-youtube' },
      { id: 'ex-4', exercise_name: LONG_NAME, exercise_library_id: 'lib-4', tracking_type: 'reps_weight', prescribed_reps: '8', position: 4, sets: sets('ex-4'), media: photo(4, [LONG_CUE, 'Synthetic cue two']), demo: demo(ID_A), video_url: `https://youtu.be/${ID_A}` },
      { id: 'ex-5', exercise_name: `${LONG_NAME} (no photo)`, exercise_library_id: 'lib-5', tracking_type: 'reps_weight', prescribed_reps: '8', position: 5, sets: sets('ex-5'), media: null, demo: demo(ID_B), video_url: `https://youtu.be/${ID_B}` },
    ],
  };
}

// IFrame API shim: records construction/teardown and replays a chosen outcome.
const IFRAME_API_SHIM = `
  window.__yt = { players: 0, destroyed: 0, paused: 0, options: [] };
  window.YT = { PlayerState: { ENDED: 0, PLAYING: 1, PAUSED: 2 }, Player: function (el, opts) {
    const iframe = typeof el === 'string' ? document.getElementById(el) : el;
    window.__yt.players += 1; window.__yt.options.push(Object.keys(opts || {}));
    this.getIframe = () => iframe;
    this.destroy = () => { window.__yt.destroyed += 1; };
    this.pauseVideo = () => { window.__yt.paused += 1; };
    const mode = window.__ytMode || 'ready';
    setTimeout(() => {
      if (mode === 'ready') opts.events && opts.events.onReady && opts.events.onReady({ target: this });
      else if (mode !== 'silent') opts.events && opts.events.onError && opts.events.onError({ target: this, data: Number(mode) });
    }, 30);
  } };
  if (typeof window.onYouTubeIframeAPIReady === 'function') window.onYouTubeIframeAPIReady();
`;

async function setup(page, { mode = 'ready', apiBlocked = false, viewport = { width: 390, height: 844 }, reducedMotion = false, posterStatus = 200 } = {}) {
  const provider = [];
  const writes = [];
  const fixture = log();
  await page.setViewportSize(viewport);
  if (reducedMotion) await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript((value) => { localStorage.setItem('cvf_access_token', 'synthetic-guides-token'); window.__ytMode = value; }, mode);
  page.on('request', (request) => {
    const host = new URL(request.url()).hostname;
    if (PROVIDER.test(host)) provider.push({ url: request.url(), type: request.resourceType(), referer: request.headers().referer || null });
  });
  await page.route((url) => PROVIDER.test(url.hostname), async (route) => {
    const url = new URL(route.request().url());
    if (url.href === 'https://www.youtube.com/iframe_api') {
      if (apiBlocked) return route.abort('blockedbyclient');
      return route.fulfill({ status: 200, contentType: 'text/javascript', body: IFRAME_API_SHIM });
    }
    if (url.hostname === 'www.youtube-nocookie.com' && url.pathname.startsWith('/embed/')) {
      return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>synthetic embed stub</title><p>synthetic embed stub</p>' });
    }
    return route.abort('blockedbyclient');
  });
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api/, '');
    const json = (value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
    if (path === '/auth/me') return json({ role: 'client', email: 'client@example.invalid', profile: { id: 'client-1', name: 'Synthetic Client', waiver_signed: true } });
    if (path === '/telemetry/events') return route.fulfill({ status: 204 });
    if (path.endsWith('/unread-count')) return json({ unread: 0 });
    if (path === '/workout-logs/guide-log' && request.method() === 'GET') return json(fixture);
    if (path.startsWith('/workout-logs/guide-log/sets/') && request.method() === 'PATCH') {
      writes.push(request.postDataJSON());
      const set = fixture.exercises.flatMap((e) => e.sets).find((s) => s.id === path.split('/').at(-1));
      Object.assign(set, request.postDataJSON());
      return json(set);
    }
    if (path === '/exercise-media/links') {
      const body = request.postDataJSON();
      return json({ links: body.assets.map(({ asset_id: id }) => ({ asset_id: id, url: `/api/exercise-media/content/${id}.sig`, expires_at: new Date(Date.now() + 60_000).toISOString() })), missing: [] });
    }
    if (path.startsWith('/exercise-media/content/')) {
      if (posterStatus !== 200) return route.fulfill({ status: posterStatus, contentType: 'application/json', body: '{"code":"link_expired"}' });
      return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
    }
    return json({ error: `unexpected ${request.method()} ${path}` }, 404);
  });
  await page.goto('/client/workouts/guide-log/track');
  await expect(page.getByTestId('workout-tracker')).toBeVisible();
  return { provider, writes, cards: page.getByTestId('tracker-exercise-card') };
}

test('no provider request, iframe, script or preconnect before the deliberate action; one fixed-origin player after', async ({ page, baseURL }) => {
  const { provider, cards } = await setup(page);
  await expect(cards.nth(0).getByTestId('exercise-media-poster')).toBeVisible();
  await expect(page.locator('iframe')).toHaveCount(0);
  expect(await page.locator('link[href*="youtube"], link[href*="ytimg"], script[src*="youtube"], img[src*="ytimg"]').count(), 'no provider preconnect, script or thumbnail').toBe(0);
  // Opening the dialog shows the first-party facade only.
  await cards.nth(0).getByTestId('tracker-exercise-demo').click();
  const dialog = page.getByTestId('exercise-demo-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('exercise-demo-poster')).toBeVisible();
  await expect(dialog.getByTestId('exercise-demo-cues')).toContainText('Synthetic cue one');
  await expect(dialog.getByTestId('exercise-demo-notice')).toContainText(/YouTube/);
  await expect(dialog.getByTestId('exercise-demo-external')).toHaveAttribute('href', `https://www.youtube.com/watch?v=${ID_A}`);
  await page.waitForTimeout(300);
  expect(provider, 'nothing reaches a provider before Play').toEqual([]);
  // Deliberate activation.
  await dialog.getByTestId('exercise-demo-play').click();
  const iframe = dialog.getByTestId('exercise-demo-iframe');
  await expect(iframe).toHaveCount(1);
  const src = await iframe.getAttribute('src');
  const origin = new URL(baseURL).origin;
  expect(src).toBe(`https://www.youtube-nocookie.com/embed/${ID_A}?playsinline=1&rel=0&cc_load_policy=1&enablejsapi=1&autoplay=1&origin=${encodeURIComponent(origin)}`);
  expect(src).not.toMatch(/guide-log|client|token|Synthetic/i);
  await expect(iframe).toHaveAttribute('title', /Synthetic Goblet Squat/);
  await expect(iframe).toHaveAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
  expect(await iframe.getAttribute('allow')).toMatch(/fullscreen/);
  await expect(iframe).toHaveAttribute('allowfullscreen', '');
  const box = await iframe.boundingBox();
  expect(box.width).toBeGreaterThanOrEqual(200);
  expect(box.height).toBeGreaterThanOrEqual(200);
  await expect(dialog.getByTestId('exercise-demo-status')).toHaveText(/ready|playing/i);
  await expect.poll(() => page.evaluate(() => window.__yt?.players)).toBe(1);
  const embeds = provider.filter((r) => r.url.startsWith('https://www.youtube-nocookie.com/embed/'));
  expect(embeds).toHaveLength(1);
  expect(embeds[0].referer, 'origin-only referrer').toBe(`${origin}/`);
  expect(provider.filter((r) => r.url === 'https://www.youtube.com/iframe_api')).toHaveLength(1);
  expect(provider.every((r) => r.url.startsWith('https://www.youtube-nocookie.com/embed/') || r.url === 'https://www.youtube.com/iframe_api')).toBe(true);
  // Closing tears the player down and removes the iframe.
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(page.locator('iframe')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__yt.destroyed)).toBe(1);
});

test('switching guides keeps exactly one player and reuses the one IFrame API load', async ({ page }) => {
  const { provider, cards } = await setup(page);
  await cards.nth(0).getByTestId('tracker-exercise-demo').click();
  await page.getByTestId('exercise-demo-play').click();
  await expect(page.getByTestId('exercise-demo-iframe')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('iframe')).toHaveCount(0);
  await cards.nth(1).getByTestId('tracker-exercise-demo').click();
  const dialog = page.getByTestId('exercise-demo-dialog');
  // No photo: a neutral first-party facade with the name, still no provider traffic.
  await expect(dialog.getByTestId('exercise-demo-facade')).toContainText('Synthetic Plank');
  await dialog.getByTestId('exercise-demo-play').click();
  await expect(page.locator('iframe')).toHaveCount(1);
  await expect(page.getByTestId('exercise-demo-iframe')).toHaveAttribute('src', new RegExp(`/embed/${ID_B}\\?`));
  await expect.poll(() => page.evaluate(() => [window.__yt.players, window.__yt.destroyed])).toEqual([2, 1]);
  expect(provider.filter((r) => r.url === 'https://www.youtube.com/iframe_api')).toHaveLength(1);
});

for (const [code, copy] of [[100, /removed|private/i], [101, /play it here|embed/i], [150, /play it here|embed/i], [153, /identif/i]]) {
  test(`player error ${code} explains, keeps Open on YouTube and never blocks logging`, async ({ page }) => {
    const { cards, writes } = await setup(page, { mode: String(code) });
    await cards.nth(0).getByTestId('tracker-exercise-demo').click();
    const dialog = page.getByTestId('exercise-demo-dialog');
    await dialog.getByTestId('exercise-demo-play').click();
    await expect(dialog.getByTestId('exercise-demo-error')).toContainText(copy);
    await expect(dialog.getByTestId('exercise-demo-external')).toBeVisible();
    await expect(dialog.getByTestId('exercise-demo-external')).toHaveAttribute('target', '_blank');
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(page.locator('iframe')).toHaveCount(0);
    const weight = cards.nth(0).getByLabel('Synthetic Goblet Squat set 1 weight', { exact: true });
    await weight.fill('20');
    await weight.blur();
    await expect.poll(() => writes.length).toBeGreaterThan(0);
    await expect(page.getByRole('button', { name: /Finish workout/ })).toBeVisible();
  });
}

test('a blocked IFrame API still leaves the privacy-enhanced embed and the external fallback', async ({ page }) => {
  const { cards } = await setup(page, { apiBlocked: true });
  await cards.nth(0).getByTestId('tracker-exercise-demo').click();
  const dialog = page.getByTestId('exercise-demo-dialog');
  await dialog.getByTestId('exercise-demo-play').click();
  await expect(dialog.getByTestId('exercise-demo-iframe')).toHaveCount(1);
  await expect(dialog.getByTestId('exercise-demo-status')).toContainText(/limited|unavailable/i);
  // Honest: the external link is a fallback, never promised to work.
  await expect(dialog.getByTestId('exercise-demo-status')).not.toContainText(/always/i);
  await expect(dialog.getByTestId('exercise-demo-external')).toBeVisible();
});

test('generic and tampered demos stay external links; they never become iframes', async ({ page }) => {
  const { cards, provider } = await setup(page);
  for (const index of [2, 3]) {
    await expect(cards.nth(index).getByTestId('tracker-exercise-demo')).toHaveCount(0);
    const link = cards.nth(index).getByTestId('tracker-exercise-video');
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', /noopener/);
  }
  await expect(cards.nth(3).getByTestId('tracker-exercise-video')).toHaveAttribute('href', 'https://example.com/not-youtube');
  await expect(page.locator('iframe')).toHaveCount(0);
  expect(provider).toEqual([]);
});

test('View demo sits where the external link sat: same left edge and type as External video', async ({ page }) => {
  const { cards } = await setup(page);
  const measure = (locator) => locator.evaluate((el) => {
    const icon = el.querySelector('svg').getBoundingClientRect();
    const style = getComputedStyle(el);
    return { iconLeft: Math.round(icon.left), fontSize: style.fontSize, fontWeight: style.fontWeight, height: Math.round(el.getBoundingClientRect().height) };
  });
  const demo = await measure(cards.nth(0).getByTestId('tracker-exercise-demo'));
  const external = await measure(cards.nth(2).getByTestId('tracker-exercise-video'));
  expect(demo).toEqual(external);
  expect(demo.height).toBeGreaterThanOrEqual(44);
});

test('an expired or missing photo falls back to the exercise name in the dialog; Play still works', async ({ page }) => {
  const { cards } = await setup(page, { posterStatus: 403 });
  await cards.nth(0).getByTestId('tracker-exercise-demo').click();
  const dialog = page.getByTestId('exercise-demo-dialog');
  await expect(dialog.getByTestId('exercise-demo-facade')).toContainText('Synthetic Goblet Squat');
  await expect(dialog.getByTestId('exercise-demo-poster')).toHaveCount(0);
  await dialog.getByTestId('exercise-demo-play').click();
  await expect(dialog.getByTestId('exercise-demo-iframe')).toHaveCount(1);
});

test('a short window (200% zoom) caps the player at 60% of its height, never below 200px', async ({ page }) => {
  const { cards } = await setup(page, { viewport: { width: 640, height: 450 } });
  await cards.nth(0).getByTestId('tracker-exercise-demo').click();
  const dialog = page.getByTestId('exercise-demo-dialog');
  const facade = await dialog.getByTestId('exercise-demo-facade').boundingBox();
  expect(facade.height).toBeLessThanOrEqual(Math.ceil(450 * 0.6));
  expect(facade.height).toBeGreaterThanOrEqual(200);
  await dialog.getByTestId('exercise-demo-play').click();
  const frame = await dialog.getByTestId('exercise-demo-iframe').boundingBox();
  expect(frame.height).toBeLessThanOrEqual(Math.ceil(450 * 0.6));
  expect(frame.height).toBeGreaterThanOrEqual(200);
  expect(frame.width).toBeGreaterThanOrEqual(200);
});

// Opens a card's demo dialog and lets the entrance animation, fonts and any
// photo decode settle. Never scrolls the dialog sideways.
async function openSettled(page, card, { keyboard = false } = {}) {
  const action = card.getByTestId('tracker-exercise-demo');
  if (keyboard) { await action.focus(); await page.keyboard.press('Enter'); } else await action.click();
  const dialog = page.getByTestId('exercise-demo-dialog');
  await expect(dialog).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await dialog.evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => {}))));
  const poster = dialog.getByTestId('exercise-demo-poster');
  if (await poster.count()) await expect.poll(() => poster.evaluate((img) => img.complete && img.naturalWidth > 0)).toBe(true);
  return dialog;
}

// Before Play: no sideways scrolling in the dialog or the document, every part
// inside the dialog's PADDED CONTENT box (not just the outer dialog box), no
// clipped text, the close button inside the dialog, and an undistorted photo.
async function expectContained(dialog) {
  const g = await dialog.evaluate((el) => {
    const style = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    const left = box.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft);
    const right = box.right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight);
    const parts = [
      ...['exercise-demo-facade', 'exercise-demo-poster', 'exercise-demo-cues', 'exercise-demo-notice', 'exercise-demo-play', 'exercise-demo-external'].map((id) => [id, el.querySelector(`[data-testid="${id}"]`)]),
      ['title', el.querySelector('h2')], ['description', el.querySelector('p[id]')],
    ].filter(([, node]) => node);
    const outside = parts.filter(([, node]) => { const r = node.getBoundingClientRect(); return r.left < left - 0.5 || r.right > right + 0.5; })
      .map(([id, node]) => `${id} ${node.getBoundingClientRect().left.toFixed(1)}..${node.getBoundingClientRect().right.toFixed(1)}`);
    const clipped = parts.filter(([id, node]) => id !== 'exercise-demo-poster' && node.scrollWidth > node.clientWidth + 1).map(([id]) => id);
    const close = [...el.querySelectorAll('button')].find((button) => /close/i.test(button.textContent || ''));
    const c = close.getBoundingClientRect();
    const img = el.querySelector('[data-testid="exercise-demo-poster"]');
    const ratio = img ? img.getBoundingClientRect().width / img.getBoundingClientRect().height : null;
    return { scrollLeft: el.scrollLeft, client: el.clientWidth, scroll: el.scrollWidth, doc: document.documentElement.scrollWidth, inner: innerWidth, outside, clipped, closeInside: c.left >= box.left && c.right <= box.right, ratio, content: `${left.toFixed(1)}..${right.toFixed(1)}` };
  });
  expect(g.scrollLeft).toBe(0);
  expect(g.scroll, 'no sideways scrolling inside the dialog').toBeLessThanOrEqual(g.client);
  expect(g.doc, 'no sideways scrolling in the document').toBeLessThanOrEqual(g.inner);
  expect(g.outside, `every part inside the padded content box ${g.content}`).toEqual([]);
  expect(g.clipped, 'no clipped text or controls').toEqual([]);
  expect(g.closeInside, 'Close stays inside the dialog').toBe(true);
  if (g.ratio !== null) expect(Math.abs(g.ratio - 16 / 9), 'the photo keeps its 16:9 shape').toBeLessThan(0.02);
  return g;
}

// Pairwise: width x photo state x name length x motion, each case once.
for (const [label, options, index] of [
  ['photo, 320px, reduced motion', { viewport: { width: 320, height: 740 }, reducedMotion: true }, 0],
  ['photo, 390px, ordinary motion', { viewport: { width: 390, height: 740 } }, 0],
  ['no photo, 320px, ordinary motion', { viewport: { width: 320, height: 740 } }, 1],
  ['failed photo, 390px, reduced motion', { viewport: { width: 390, height: 740 }, reducedMotion: true, posterStatus: 403 }, 0],
  ['long unbroken name and cue with photo, 320px, reduced motion', { viewport: { width: 320, height: 740 }, reducedMotion: true }, 4],
  ['long unbroken name without photo, 390px, ordinary motion', { viewport: { width: 390, height: 740 } }, 5],
]) {
  test(`before Play the demo dialog fits its content width: ${label}`, async ({ page }) => {
    const { cards, provider } = await setup(page, options);
    const dialog = await openSettled(page, cards.nth(index));
    if (options.posterStatus) await expect(dialog.getByTestId('exercise-demo-facade')).toContainText('Synthetic Goblet Squat');
    await expectContained(dialog);
    expect(provider, 'still nothing from the provider before Play').toEqual([]);
  });
}

test('before Play at 320px, keyboard reaches Play, the fallback and Close in view; Enter plays and Escape restores the opener', async ({ page }) => {
  const { cards } = await setup(page, { viewport: { width: 320, height: 740 }, reducedMotion: true });
  const opener = cards.nth(0).getByTestId('tracker-exercise-demo');
  const dialog = await openSettled(page, cards.nth(0), { keyboard: true });
  await expectContained(dialog);
  const stops = [];
  for (let i = 0; i < 3; i += 1) {
    stops.push(await page.evaluate(() => {
      const el = document.activeElement;
      const r = el.getBoundingClientRect();
      return { id: el.getAttribute('data-testid') || el.textContent.trim(), inView: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight };
    }));
    await page.keyboard.press('Tab');
  }
  expect(stops.map((stop) => stop.id)).toEqual(['exercise-demo-play', 'exercise-demo-external', 'Close']);
  expect(stops.every((stop) => stop.inView), JSON.stringify(stops)).toBe(true);
  await expect(dialog.getByTestId('exercise-demo-play')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(dialog.getByTestId('exercise-demo-player')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('iframe')).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test('a short landscape window keeps every action reachable by vertical scrolling only', async ({ page }) => {
  const { cards } = await setup(page, { viewport: { width: 640, height: 360 }, reducedMotion: true });
  const dialog = await openSettled(page, cards.nth(4));
  await expectContained(dialog);
  for (const id of ['exercise-demo-play', 'exercise-demo-external']) {
    const reached = await dialog.evaluate((el, testId) => {
      const target = el.querySelector(`[data-testid="${testId}"]`);
      el.scrollTop += Math.max(0, target.getBoundingClientRect().bottom - el.getBoundingClientRect().bottom + 8);
      const r = target.getBoundingClientRect();
      const d = el.getBoundingClientRect();
      return { scrollLeft: el.scrollLeft, visible: r.top >= d.top && r.bottom <= d.bottom && r.left >= d.left && r.right <= d.right && r.bottom <= innerHeight };
    }, id);
    expect(reached, id).toEqual({ scrollLeft: 0, visible: true });
  }
});

test('320px phone: the dialog fits, the player keeps 200x200, and keyboard users can open, play and close', async ({ page }) => {
  const { cards } = await setup(page, { viewport: { width: 320, height: 640 }, reducedMotion: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const open = cards.nth(0).getByTestId('tracker-exercise-demo');
  expect((await open.boundingBox()).height).toBeGreaterThanOrEqual(44);
  await open.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByTestId('exercise-demo-dialog');
  await expect(dialog).toBeVisible();
  // Reduced motion: still nothing loads or moves until the coach/client asks.
  await expect(page.locator('iframe')).toHaveCount(0);
  const play = dialog.getByTestId('exercise-demo-play');
  expect((await play.boundingBox()).height).toBeGreaterThanOrEqual(44);
  await play.focus();
  await page.keyboard.press('Enter');
  // Play unmounts its own button: focus lands on the player region (in this
  // document, so Escape still closes the dialog), and Tab enters the player.
  await expect(dialog.getByTestId('exercise-demo-player')).toBeFocused();
  await expect(dialog.getByTestId('exercise-demo-player')).toHaveAccessibleName(/Synthetic Goblet Squat demo player/);
  const box = await dialog.getByTestId('exercise-demo-iframe').boundingBox();
  expect(box.width).toBeGreaterThanOrEqual(200);
  expect(box.height).toBeGreaterThanOrEqual(200);
  const dialogBox = await dialog.boundingBox();
  expect(dialogBox.x).toBeGreaterThanOrEqual(0);
  expect(dialogBox.x + dialogBox.width).toBeLessThanOrEqual(320);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.keyboard.press('Tab');
  await expect(dialog.getByTestId('exercise-demo-iframe')).toBeFocused();
  await dialog.getByTestId('exercise-demo-player').focus();
  await page.keyboard.press('Escape');
  await expect(page.locator('iframe')).toHaveCount(0);
  await expect(open).toBeFocused();
});

test('history labels the demo as today\'s current demo and still loads nothing before Play', async ({ page }) => {
  const provider = [];
  const completed = { ...log(), status: 'completed', completed_at: new Date().toISOString() };
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => localStorage.setItem('cvf_access_token', 'synthetic-guides-token'));
  page.on('request', (request) => { if (PROVIDER.test(new URL(request.url()).hostname)) provider.push(request.url()); });
  await page.route((url) => PROVIDER.test(url.hostname), (route) => route.abort('blockedbyclient'));
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const p = new URL(request.url()).pathname.replace(/^\/api/, '');
    const json = (value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
    if (p === '/auth/me') return json({ role: 'client', email: 'client@example.invalid', profile: { id: 'client-1', name: 'Synthetic Client', waiver_signed: true } });
    if (p === '/telemetry/events') return route.fulfill({ status: 204 });
    if (p.endsWith('/unread-count')) return json({ unread: 0 });
    if (p === '/workout-logs/guide-log') return json(completed);
    if (p.startsWith('/workout-logs/') && p.includes('previous')) return json(null);
    if (p === '/exercise-media/links') return json({ links: [], missing: [] });
    return json({ error: `unexpected ${request.method()} ${p}` }, 404);
  });
  await page.goto('/client/workouts/guide-log');
  const demo = page.getByTestId('history-current-demo').first();
  await expect(demo).toHaveText(/Current demo/);
  // Sits with the "Current exercise guide" action as a matching pair.
  const look = (locator) => locator.evaluate((el) => {
    const style = getComputedStyle(el);
    return { iconLeft: Math.round(el.querySelector('svg').getBoundingClientRect().left), fontSize: style.fontSize, height: Math.round(el.getBoundingClientRect().height) };
  });
  expect(await look(demo)).toEqual(await look(page.getByTestId('history-current-guide').first()));
  expect(await look(page.getByTestId('history-current-demo-link').first())).toEqual(await look(page.getByTestId('history-current-guide').first()));
  await demo.click();
  const dialog = page.getByTestId('exercise-demo-dialog');
  await expect(dialog).toContainText(/today's demo for this exercise, not a record of what was shown/);
  await expect(page.locator('iframe')).toHaveCount(0);
  await expect(page.getByTestId('history-current-demo-link').first()).toHaveAttribute('href', 'https://example.com/synthetic-coach-override');
  expect(provider).toEqual([]);
});

test('plan view Demo and Video pills keep a 44px-tall touch target without growing the row', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.addInitScript(() => localStorage.setItem('cvf_access_token', 'synthetic-guides-token'));
  await page.route((url) => PROVIDER.test(url.hostname), (route) => route.abort('blockedbyclient'));
  const rows = log().exercises.map((exercise, index) => ({ id: `we-${index}`, exercise_library_id: exercise.exercise_library_id, custom_name: exercise.exercise_name, sets: 2, reps: '8', tracking_type: 'reps_weight', video_url: exercise.video_url, demo: exercise.demo }));
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const p = new URL(request.url()).pathname.replace(/^\/api/, '');
    const json = (value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
    if (p === '/auth/me') return json({ role: 'client', email: 'client@example.invalid', profile: { id: 'client-1', name: 'Synthetic Client', waiver_signed: true } });
    if (p === '/telemetry/events') return route.fulfill({ status: 204 });
    if (p.endsWith('/unread-count')) return json({ unread: 0 });
    if (p === '/programs/client/assigned') return json({ programs: [], workouts: [{ id: 'wa-1', assignment_mode: 'active', exercise_loads: [], workout: { id: 'wk-1', name: 'Synthetic plan', exercises: rows } }] });
    if (p === '/workout-logs/active') return json(null);
    if (p === '/workout-logs/mine') return json({ logs: [], next_cursor: null });
    return json({ error: `unexpected ${request.method()} ${p}` }, 404);
  });
  await page.goto('/client/programs?view=other');
  const card = page.getByTestId('client-workout-assignment-card');
  await card.getByRole('button', { name: /Exercises/ }).click();
  for (const pill of [card.getByTestId('client-exercise-demo').first(), card.getByTestId('client-exercise-row').nth(2).locator('a[target="_blank"]')]) {
    const box = await pill.boundingBox();
    const hits = await page.evaluate(({ x, y }) => [-20, 20].map((dy) => {
      const el = document.elementFromPoint(x, y + dy);
      return Boolean(el && el.closest('[data-testid="client-exercise-demo"], a[target="_blank"]'));
    }), { x: box.x + box.width / 2, y: box.y + box.height / 2 });
    expect(hits, 'taps 20px above and below the pill still hit it').toEqual([true, true]);
  }
});
