// Optional still selection from a LOCAL clip in the coach media editor
// (docs/exercise-guides/design.md). Normal build; every /api call is routed
// here. Proves the browser half only: the clip never leaves the device, only the
// exported image goes through the photo transport, the confirmed still is bound
// to its exact clip and time, blob URLs are released, and an unreadable clip
// leaves ordinary photo upload working. Server verification of the uploaded
// still is the photo pipeline's job (backend tests + local integration).
import path from 'node:path';
import { test, expect } from '@playwright/test';

test.setTimeout(60_000);

const CLIP = path.join(import.meta.dirname, 'fixtures/exercise-media/synthetic-moving-geometry.mp4');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAJCAIAAAC0SDtlAAAAGklEQVR4nGP8z8Dwn4EIwESMolGFowqHmEIAQJcCERg5oyQAAAAASUVORK5CYII=', 'base64');
const MP4_MARKER = Buffer.from('ftyp');

function draftRevision(extra = {}) {
  return {
    id: 'rev-draft', exercise_id: 'lib-goblet', status: 'draft', review_status: 'needs_review', version: 1, recipe_version: 1, failure_code: null, based_on_revision_id: null,
    owned_by_you: true, owner_name: 'Synthetic Coach', published_at: null, is_current: false, archived: false, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    text: { alt_text: null, end_frame_alt_text: null, cues: [], transcript: null, caption_language: null, caption_cues: [], instruction_audio: false },
    recipe: { include_instruction: false, poster_mode: null, poster_frame_ms: null, poster_crop: null, preview_start_ms: null, preview_end_ms: null, preview_crop: null, end_frame_ms: null, end_frame_crop: null },
    reviewed: null, derivatives: [], job: null, sources: { image: null, video: null },
    permissions: { can_edit: true, can_upload: true, can_process: false, can_review: false, can_publish: false, publish_requires_admin: false, can_archive: true },
    ...extra,
  };
}

async function setup(page, { sourceBytes = PNG, initialSource = false, failReadOnce = false } = {}) {
  const calls = { uploads: [], puts: [], finalize: [], bodies: [], sourceReads: [], linkIssues: 0, authActor: 'coach-a', blockLinks: false, releaseLinks: null };
  let revision = draftRevision(initialSource ? { recipe: { ...draftRevision().recipe, poster_mode: 'uploaded_image', poster_crop: { x: 0, y: 0, width: 1, height: 1 } }, sources: { image: { asset_id: 'source-1', width: 1280, height: 720, bytes: sourceBytes.length, mime_type: 'image/png', display_name: 'synthetic-geometry.png' }, video: null } } : {});
  await page.addInitScript(() => {
    localStorage.setItem('cvf_access_token', 'synthetic-coach-token');
    window.__revoked = 0; window.__created = 0;
    const create = URL.createObjectURL.bind(URL); const revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (obj) => { window.__created += 1; return create(obj); };
    URL.revokeObjectURL = (url) => { window.__revoked += 1; return revoke(url); };
  });
  page.on('request', (request) => { const body = request.postDataBuffer(); if (body) calls.bodies.push({ url: request.url(), body }); });
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const p = new URL(request.url()).pathname.replace(/^\/api/, '');
    const json = (value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
    if (p === '/auth/me') return json({ role: 'coach', email: 'coach@example.invalid', profile: { id: calls.authActor, name: 'Synthetic Coach', is_admin: false } });
    if (p === '/telemetry/events') return route.fulfill({ status: 204 });
    if (p.endsWith('/unread-count')) return json({ unread: 0 });
    if (p === '/programs/exercise-library') return json([{ id: 'lib-goblet', name: 'Synthetic Goblet Squat', category: 'Synthetic', equipment: 'Kettlebell', primary_muscle: 'Synthetic', video_url: null, hidden: false, archived: false }]);
    if (p === '/programs/workouts' || p === '/programs' || p === '/clients') return json([]);
    if (p === '/exercise-media/library-status') return json({ enabled: true, items: [], summary: null });
    if (p === '/exercise-media/capabilities') return json({ enabled: true, mode: 'photos', video_sources: false, upload_transport: 'grant', processing: 'inline', local_still_selection: true, processing_available: true, limits: {} });
    if (p === '/exercise-media/exercises/lib-goblet/revisions') return json({ exercise: { id: 'lib-goblet', name: 'Synthetic Goblet Squat', equipment: 'Kettlebell', category: 'Synthetic', primary_muscle: 'Synthetic', hidden: false }, current: null, current_version: 0, drafts: [revision], next_before: null });
    if (p === '/exercise-media/revisions/rev-draft/uploads') {
      const body = request.postDataJSON();
      calls.uploads.push(body);
      return json({ intent: { id: 'intent-1', state: 'issued', request_id: body.request_id }, upload: { method: 'PUT', url: '/api/exercise-media/staging/grant-1.sig', headers: { 'content-type': body.mime_type } }, replayed: false }, 201);
    }
    if (p === '/exercise-media/staging/grant-1.sig' && request.method() === 'PUT') {
      calls.puts.push({ type: request.headers()['content-type'], body: request.postDataBuffer() });
      return json({ status: 'stored', bytes: request.postDataBuffer().length }, 201);
    }
    if (p === '/exercise-media/revisions/rev-draft/uploads/intent-1/finalize') {
      calls.finalize.push(request.postDataJSON());
      revision = draftRevision({ version: 2, recipe: { ...draftRevision().recipe, poster_mode: 'uploaded_image' }, sources: { image: { asset_id: 'source-1', width: 1280, height: 720, bytes: calls.puts[0].body.length, mime_type: calls.puts[0].type, display_name: 'still.jpg', rights_basis: 'owned', rights_note: null, uploaded_by_you: true, copied: false }, video: null } });
      return json({ revision, replayed: false }, 201);
    }
    if (p === '/exercise-media/links') {
      const body = request.postDataJSON();
      calls.linkIssues += 1;
      if (calls.blockLinks) await new Promise((resolve) => { calls.releaseLinks = resolve; });
      return json({ links: body.assets.map(({ asset_id: id }) => ({ asset_id: id, url: `/api/exercise-media/content/${id}.${calls.authActor}sig${calls.linkIssues}`, expires_at: new Date(Date.now() + 300_000).toISOString() })), missing: [] });
    }
    if (p.startsWith('/exercise-media/content/')) {
      calls.sourceReads.push({ method: request.method(), range: request.headers().range });
      if (request.method() === 'HEAD') return route.fulfill({ status: 200, headers: { 'content-type': 'image/png', 'content-length': String(sourceBytes.length) } });
      if (failReadOnce) { failReadOnce = false; return route.fulfill({ status: 404 }); }
      const range = /^bytes=(\d+)-(\d+)$/.exec(request.headers().range || '');
      if (range) return route.fulfill({ status: 206, headers: { 'content-type': 'image/png', 'content-range': `bytes ${range[1]}-${range[2]}/${sourceBytes.length}` }, body: sourceBytes.subarray(Number(range[1]), Number(range[2]) + 1) });
      return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
    }
    return json({ error: `unexpected ${request.method()} ${p}` }, 404);
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/coach/programs');
  await page.getByTestId('exercise-library-media-button').first().click();
  const editor = page.getByTestId('exercise-media-editor');
  await expect(editor.getByTestId('media-draft-editor')).toBeVisible();
  return { calls, editor };
}

async function chooseClipAndTime(page, editor, seconds) {
  await editor.getByTestId('media-still-open').click();
  await editor.getByTestId('media-still-file').setInputFiles(CLIP);
  const video = editor.getByTestId('media-still-video');
  await expect.poll(() => video.evaluate((el) => el.readyState)).toBeGreaterThanOrEqual(1);
  await setTime(editor, video, seconds);
  return video;
}

async function setTime(editor, video, seconds) {
  const field = editor.getByTestId('media-still-time');
  await field.fill(String(seconds));
  await field.press('Enter');
  await expect.poll(() => video.evaluate((el, target) => !el.seeking && Math.abs(el.currentTime - target) < 0.05 && el.readyState >= 2, seconds)).toBe(true);
}

test('a still from a local clip uploads only the exported image; the clip is not uploaded or backed up', async ({ page }) => {
  const { calls, editor } = await setup(page);
  await chooseClipAndTime(page, editor, 1);
  await expect(editor.getByTestId('media-still-disclosure')).toContainText(/not uploaded/i);
  await expect(editor.getByTestId('media-still-disclosure')).toContainText(/keep your original/i);
  await editor.getByTestId('media-still-use').click();
  await expect(editor.getByTestId('media-still-preview')).toBeVisible();
  await expect(editor.getByTestId('media-still-confirmed')).toContainText('0:01.0');
  await expect(editor.getByTestId('media-upload-preset-source_image')).toContainText(/still-0m01\.0s/);
  // The confirmation points to where the still actually waits: the upload above.
  await expect(editor.getByTestId('media-still-confirmed')).toContainText(/above/);
  const preset = await editor.getByTestId('media-upload-preset-source_image').boundingBox();
  const selector = await editor.getByTestId('media-still-selector').boundingBox();
  expect(preset.y).toBeLessThan(selector.y);
  await editor.getByTestId('media-rights-confirm-source_image').click();
  await editor.getByTestId('media-upload-start-source_image').click();
  await expect(editor.getByTestId('media-source-facts')).toContainText('Image');
  expect(calls.uploads).toHaveLength(1);
  expect(['image/jpeg', 'image/png', 'image/webp']).toContain(calls.uploads[0].mime_type);
  expect(calls.puts).toHaveLength(1);
  const sent = calls.puts[0].body;
  expect(calls.uploads[0].bytes).toBe(sent.length);
  const isImage = (sent[0] === 0xff && sent[1] === 0xd8) || sent.readUInt32BE(0) === 0x89504e47 || sent.toString('latin1', 8, 12) === 'WEBP';
  expect(isImage, 'the PUT carries an image').toBe(true);
  expect(calls.bodies.every(({ body }) => body.indexOf(MP4_MARKER) === -1 || body.length < 64), 'no request ever carries the clip').toBe(true);
  expect(calls.finalize).toHaveLength(1);
});

test('changing the time or the clip invalidates a confirmed still and releases blob URLs', async ({ page }) => {
  const { editor } = await setup(page);
  const video = await chooseClipAndTime(page, editor, 1);
  await editor.getByTestId('media-still-use').click();
  await expect(editor.getByTestId('media-upload-preset-source_image')).toBeVisible();
  await setTime(editor, video, 2);
  await expect(editor.getByTestId('media-still-stale')).toBeVisible();
  await expect(editor.getByTestId('media-upload-preset-source_image')).toHaveCount(0);
  await expect(editor.getByTestId('media-upload-start-source_image')).toBeDisabled();
  await editor.getByTestId('media-still-use').click();
  await expect(editor.getByTestId('media-still-confirmed')).toContainText('0:02.0');
  const before = await page.evaluate(() => window.__revoked);
  await editor.getByTestId('media-still-file').setInputFiles({ name: 'other-synthetic.mp4', mimeType: 'video/mp4', buffer: Buffer.from('not a real clip') });
  await expect(editor.getByTestId('media-upload-preset-source_image')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__revoked)).toBeGreaterThan(before);
  await editor.getByTestId('media-still-close').click();
  await expect.poll(() => page.evaluate(() => window.__created - window.__revoked)).toBeLessThanOrEqual(1);
});

test('an unreadable clip explains recovery and ordinary photo upload keeps working', async ({ page }) => {
  const { editor } = await setup(page);
  await editor.getByTestId('media-still-open').click();
  await editor.getByTestId('media-still-file').setInputFiles({ name: 'broken-synthetic.mp4', mimeType: 'video/mp4', buffer: Buffer.from('this is not a playable clip') });
  await expect(editor.getByTestId('media-still-error')).toContainText(/can.t (read|play)/i);
  await expect(editor.getByTestId('media-still-error')).toContainText(/photo/i);
  await expect(editor.getByTestId('media-still-use')).toHaveCount(0);
  await expect(editor.getByTestId('media-file-source_image')).toBeEnabled();
});

for (const width of [320, 390]) {
  test(`${width}px: the photo-first draft editor and still option fit without sideways scrolling`, async ({ page }) => {
    const { editor } = await setup(page);
    await page.setViewportSize({ width, height: 740 });
    await expect(editor.getByTestId('media-still-open')).toBeVisible();
    const overflow = () => page.getByRole('dialog').evaluate((el) => {
      const wide = [...el.querySelectorAll('*')].filter((child) => child.getBoundingClientRect().right > el.getBoundingClientRect().right + 1).map((child) => child.getAttribute('data-testid') || child.tagName);
      return { scroll: el.scrollWidth - el.clientWidth, wide: wide.slice(0, 5) };
    });
    expect(await overflow()).toEqual({ scroll: 0, wide: [] });
    await editor.getByTestId('media-still-open').click();
    await editor.getByTestId('media-still-file').setInputFiles(CLIP);
    await expect(editor.getByTestId('media-still-use')).toBeVisible();
    expect(await overflow()).toEqual({ scroll: 0, wide: [] });
  });
}

// Holds the canvas export until the test releases it.
async function holdExports(page) {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.toBlob;
    window.__exportGate = null;
    HTMLCanvasElement.prototype.toBlob = function (callback, ...rest) {
      if (!window.__holdExport) return original.call(this, callback, ...rest);
      return original.call(this, (blob) => { window.__exportGate = () => callback(blob); }, ...rest);
    };
  });
}
async function startHeldExport(page, editor) {
  await chooseClipAndTime(page, editor, 1);
  await page.evaluate(() => { window.__holdExport = true; });
  await editor.getByTestId('media-still-use').click();
  await expect.poll(() => page.evaluate(() => typeof window.__exportGate)).toBe('function');
}

test('while a frame exports, the clip cannot be swapped and the selector cannot close under it', async ({ page }) => {
  await holdExports(page);
  const { editor } = await setup(page);
  await startHeldExport(page, editor);
  await expect(editor.getByTestId('media-still-file')).toBeDisabled();
  await expect(editor.getByTestId('media-still-close')).toBeDisabled();
  await page.evaluate(() => window.__exportGate());
  await expect(editor.getByTestId('media-still-confirmed')).toContainText('0:01.0');
  await expect(editor.getByTestId('media-still-file')).toBeEnabled();
});

test('a frame that finishes after the editor closed is dropped, and no blob URL leaks', async ({ page }) => {
  await holdExports(page);
  const { editor } = await setup(page);
  await startHeldExport(page, editor);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('exercise-media-editor')).toHaveCount(0);
  await page.evaluate(() => window.__exportGate());
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 150)));
  const [created, revoked] = await page.evaluate(() => [window.__created, window.__revoked]);
  expect(revoked, `blob URLs created ${created}, revoked ${revoked}`).toBe(created);
});


for (const width of [320, 390]) {
  test(`crop editor loads an exact 10 MiB source through bounded ranges at ${width}px and releases it on close`, async ({ page }) => {
    const sourceBytes = Buffer.concat([PNG, Buffer.alloc(10 * 1024 * 1024 - PNG.length)]);
    const { editor, calls } = await setup(page, { sourceBytes, initialSource: true });
    await page.setViewportSize({ width, height: 844 });
    const image = editor.getByTestId('poster-crop').locator('img');
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate((el) => el.complete && el.naturalWidth > 0)).toBe(true);
    expect(await image.getAttribute('src')).toMatch(/^blob:/);
    expect(calls.sourceReads.map((call) => call.method)).toEqual(['HEAD', ...Array(10).fill('GET')]);
    const rangeLengths = calls.sourceReads.slice(1).map((call) => { const [, a, b] = /bytes=(\d+)-(\d+)/.exec(call.range); return Number(b) - Number(a) + 1; });
    expect(rangeLengths.every((length) => length === 1024 * 1024)).toBe(true);
    await expect(editor.getByRole('button', { name: 'Move crop right', exact: true })).toBeEnabled();
    expect(await editor.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    const revokedBefore = await page.evaluate(() => window.__revoked);
    await page.keyboard.press('Escape');
    await expect(editor).not.toBeVisible();
    await expect.poll(() => page.evaluate(() => window.__revoked)).toBeGreaterThan(revokedBefore);
  });
}

test('source authorization failure has a bounded manual retry and never displays a partial crop image', async ({ page }) => {
  const { editor, calls } = await setup(page, { initialSource: true, failReadOnce: true });
  await expect(editor.getByRole('button', { name: 'Retry source photo' })).toBeVisible();
  await expect(editor.getByTestId('poster-crop').locator('img')).toHaveCount(0);
  await expect(editor.getByRole('button', { name: 'Move crop right', exact: true })).toBeDisabled();
  expect(calls.sourceReads).toHaveLength(2);
  await editor.getByRole('button', { name: 'Retry source photo' }).click();
  const image = editor.getByTestId('poster-crop').locator('img');
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((el) => el.complete && el.naturalWidth > 0)).toBe(true);
  expect(calls.sourceReads).toHaveLength(4);
});


test('actor switch hides previous capability before replacement links resolve', async ({ page }) => {
  const { calls } = await setup(page);
  await page.keyboard.press('Escape');
  // REAL auth provider and link hook, with an in-place session reload so a full
  // navigation cannot conceal a stale module-cache capability.
  await page.evaluate(async () => {
    const React = (await import('/node_modules/.vite/deps/react.js')).default;
    const { createRoot } = (await import('/node_modules/.vite/deps/react-dom_client.js')).default;
    const { AuthProvider, useAuth } = await import('/src/context/AuthContext.jsx');
    const { useMediaLinks } = await import('/src/components/training/media/mediaLinks.js');
    function Probe() {
      const auth = useAuth(); const links = useMediaLinks({ type: 'revision', id: 'rev-draft' }, ['source-1']);
      window.__reloadMediaActor = auth.reload;
      return React.createElement('output', { 'data-testid': 'actor-link-probe', 'data-actor': auth.user?.profile?.id || '' }, [...links.urls.values()].join(','));
    }
    const node = document.createElement('section'); document.body.append(node);
    createRoot(node).render(React.createElement(AuthProvider, null, React.createElement(Probe)));
  });
  const probe = page.getByTestId('actor-link-probe');
  await expect(probe).toContainText('coach-asig');
  calls.authActor = 'coach-b'; calls.blockLinks = true;
  await page.evaluate(() => { window.__reloadMediaActor(); });
  await expect(probe).toHaveAttribute('data-actor', 'coach-b');
  try { await expect(probe).toHaveText(''); }
  finally { calls.blockLinks = false; calls.releaseLinks?.(); }
  await expect(probe).toContainText('coach-bsig');
});
