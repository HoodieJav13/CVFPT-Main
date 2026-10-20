// Coach media editor seams (normal build, every /api call routed here, photos
// mode, grant transport): a server reply for one draft must never land in the
// form of another, and finishing a photo upload must not wipe alt text or cues
// typed before it. Synthetic data only; the uploaded image is a generated
// solid-colour PNG.
import zlib from 'node:zlib';
import { test, expect } from '@playwright/test';

test.setTimeout(60_000);

function solidPng(width, height) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type), data]); const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body)); return Buffer.concat([len, body, sum]); };
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x55)]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(Buffer.concat(Array(height).fill(row)))), chunk('IEND', Buffer.alloc(0))]);
}
const PNG = solidPng(320, 180);

function revision(id, extra = {}) {
  return {
    id, exercise_id: 'lib-goblet', status: 'draft', review_status: 'needs_review', version: 1, recipe_version: 1, failure_code: null, based_on_revision_id: null,
    owned_by_you: true, owner_name: 'Synthetic Coach', published_at: null, is_current: false, archived: false, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    text: { alt_text: null, end_frame_alt_text: null, cues: [], transcript: null, caption_language: null, caption_cues: [], instruction_audio: false },
    recipe: { include_instruction: false, poster_mode: null, poster_frame_ms: null, poster_crop: null, preview_start_ms: null, preview_end_ms: null, preview_crop: null, end_frame_ms: null, end_frame_crop: null },
    reviewed: null, derivatives: [], job: null, sources: { image: null, video: null },
    permissions: { can_edit: true, can_upload: true, can_process: false, can_review: false, can_publish: false, publish_requires_admin: false, can_archive: true },
    ...extra,
  };
}
const withAlt = (id, alt) => revision(id, { text: { ...revision(id).text, alt_text: alt } });

async function setup(page, drafts, { viewport = { width: 390, height: 844 } } = {}) {
  const calls = { patches: [], holdPatch: null, stalePatch: false, revisionReads: 0, holdReload: null, uploads: [], unexpected: [] };
  const state = { drafts };
  await page.addInitScript(() => localStorage.setItem('cvf_access_token', 'synthetic-coach-token'));
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const p = new URL(request.url()).pathname.replace(/^\/api/, '');
    const json = (value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) }).catch(() => {});
    if (p === '/auth/me') return json({ role: 'coach', email: 'coach@example.invalid', profile: { id: 'coach-a', name: 'Synthetic Coach', is_admin: false } });
    if (p === '/telemetry/events') return route.fulfill({ status: 204 });
    if (p.endsWith('/unread-count')) return json({ unread: 0 });
    if (p === '/programs/exercise-library') return json([{ id: 'lib-goblet', name: 'Synthetic Goblet Squat', category: 'Synthetic', equipment: 'Kettlebell', primary_muscle: 'Synthetic', video_url: null, hidden: false, archived: false }]);
    if (p === '/programs/workouts' || p === '/programs' || p === '/clients') return json([]);
    if (p === '/exercise-media/library-status') return json({ enabled: true, items: [], summary: null });
    if (p === '/exercise-media/capabilities') return json({ enabled: true, mode: 'photos', video_sources: false, upload_transport: 'grant', processing: 'inline', local_still_selection: false, processing_available: true, limits: {} });
    if (p === '/exercise-media/exercises/lib-goblet/revisions') {
      calls.revisionReads += 1;
      if (calls.revisionReads > 1 && calls.holdReload) await calls.holdReload;
      return json({ exercise: { id: 'lib-goblet', name: 'Synthetic Goblet Squat', equipment: 'Kettlebell', category: 'Synthetic', primary_muscle: 'Synthetic', hidden: false }, current: null, current_version: 0, drafts: state.drafts, next_before: null });
    }
    const patch = p.match(/^\/exercise-media\/revisions\/([^/]+)\/recipe$/);
    if (patch && request.method() === 'PATCH') {
      const body = request.postDataJSON();
      calls.patches.push({ id: patch[1], body });
      if (calls.holdPatch) await calls.holdPatch;
      if (calls.stalePatch) return json({ error: 'This draft changed. Reload to continue.', code: 'stale' }, 409);
      const before = state.drafts.find((d) => d.id === patch[1]);
      // Optimistic concurrency, as the server enforces it.
      if (body.expected_version !== before.version) return json({ error: 'This draft changed. Reload to continue.', code: 'stale' }, 409);
      const next = { ...before, version: before.version + 1, text: { ...before.text, ...(body.alt_text !== undefined ? { alt_text: body.alt_text } : {}), ...(body.cues ? { cues: body.cues } : {}) } };
      state.drafts = state.drafts.map((d) => (d.id === next.id ? next : d));
      return json(next);
    }
    const upload = p.match(/^\/exercise-media\/revisions\/([^/]+)\/uploads$/);
    if (upload) { const body = request.postDataJSON(); calls.uploads.push(body); return json({ intent: { id: 'intent-1', state: 'issued', request_id: body.request_id }, upload: { method: 'PUT', url: '/api/exercise-media/staging/grant-1.sig', headers: { 'content-type': body.mime_type } }, replayed: false }, 201); }
    if (p === '/exercise-media/staging/grant-1.sig' && request.method() === 'PUT') return json({ status: 'stored', bytes: request.postDataBuffer().length }, 201);
    const finalize = p.match(/^\/exercise-media\/revisions\/([^/]+)\/uploads\/intent-1\/finalize$/);
    if (finalize) {
      const before = state.drafts.find((d) => d.id === finalize[1]);
      const next = { ...before, version: before.version + 1, recipe: { ...before.recipe, poster_mode: 'uploaded_image' }, sources: { image: { asset_id: 'source-1', width: 320, height: 180, bytes: PNG.length, mime_type: 'image/png', display_name: 'synthetic.png', rights_basis: 'owned', rights_note: null, uploaded_by_you: true, copied: false }, video: null } };
      state.drafts = state.drafts.map((d) => (d.id === next.id ? next : d));
      return json({ revision: next, replayed: false }, 201);
    }
    if (p === '/exercise-media/links') { const body = request.postDataJSON(); return json({ links: body.assets.map(({ asset_id: id }) => ({ asset_id: id, url: `/api/exercise-media/content/${id}.sig`, expires_at: new Date(Date.now() + 300_000).toISOString() })), missing: [] }); }
    if (p.startsWith('/exercise-media/content/')) {
      if (request.method() === 'HEAD') return route.fulfill({ status: 200, headers: { 'content-type': 'image/png', 'content-length': String(PNG.length) } });
      const range = /^bytes=(\d+)-(\d+)$/.exec(request.headers().range || '');
      if (range) return route.fulfill({ status: 206, headers: { 'content-type': 'image/png', 'content-range': `bytes ${range[1]}-${Math.min(Number(range[2]), PNG.length - 1)}/${PNG.length}` }, body: PNG.subarray(Number(range[1]), Number(range[2]) + 1) });
      return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
    }
    calls.unexpected.push(`${request.method()} ${p}`);
    return json({ error: `unexpected ${request.method()} ${p}` }, 404);
  });
  await page.setViewportSize(viewport);
  await page.goto('/coach/programs');
  await page.getByTestId('exercise-library-media-button').first().click();
  const editor = page.getByTestId('exercise-media-editor');
  await expect(editor.getByTestId('media-draft-editor')).toBeVisible();
  return { calls, editor, state };
}

test('a save reply for one draft never lands in the form of the draft selected meanwhile', async ({ page }) => {
  const { calls, editor } = await setup(page, [withAlt('rev-a', 'Synthetic alt A'), withAlt('rev-b', 'Synthetic alt B')]);
  const chips = editor.getByTestId('media-draft-chip');
  await chips.nth(0).click();
  await expect(editor.getByTestId('media-alt-text')).toHaveValue('Synthetic alt A');
  let release;
  calls.holdPatch = new Promise((resolve) => { release = resolve; });
  await editor.getByTestId('media-alt-text').fill('Synthetic alt A edited');
  await editor.getByTestId('media-save').click();
  await expect.poll(() => calls.patches.length).toBe(1);
  await chips.nth(1).click();
  await expect(editor.getByTestId('media-alt-text')).toHaveValue('Synthetic alt B');
  release();
  await expect(editor.getByTestId('media-save')).toHaveText(/Save draft/);
  await page.waitForTimeout(300);
  await expect(editor.getByTestId('media-alt-text')).toHaveValue('Synthetic alt B');
  await expect(editor.getByTestId('media-save')).toBeDisabled();
  // The saved draft kept its own saved text.
  await chips.nth(0).click();
  await expect(editor.getByTestId('media-alt-text')).toHaveValue('Synthetic alt A edited');
  expect(calls.unexpected).toEqual([]);
});

test('alt text typed before a photo upload survives the upload finishing', async ({ page }) => {
  const { calls, editor } = await setup(page, [revision('rev-a')]);
  await editor.getByTestId('media-alt-text').fill('Synthetic stance, kettlebell at chest');
  await editor.getByTestId('media-file-source_image').setInputFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: PNG });
  await editor.getByTestId('media-rights-confirm-source_image').click();
  await editor.getByTestId('media-upload-start-source_image').click();
  await expect(editor.getByTestId('media-source-facts')).toContainText('Image');
  await expect(editor.getByTestId('media-alt-text')).toHaveValue('Synthetic stance, kettlebell at chest');
  await expect(editor.getByTestId('media-save')).toBeEnabled();
  await editor.getByTestId('media-save').click();
  await expect.poll(() => calls.patches.at(-1)?.body.alt_text).toBe('Synthetic stance, kettlebell at chest');
  expect(calls.uploads).toHaveLength(1);
  expect(calls.unexpected).toEqual([]);
});

test('a stale reply for one draft does not pull the coach back from the draft selected meanwhile', async ({ page }) => {
  const { calls, editor } = await setup(page, [withAlt('rev-a', 'Synthetic alt A'), withAlt('rev-b', 'Synthetic alt B')]);
  const chips = editor.getByTestId('media-draft-chip');
  await chips.nth(0).click();
  let release;
  calls.holdPatch = new Promise((resolve) => { release = resolve; });
  calls.stalePatch = true;
  await editor.getByTestId('media-alt-text').fill('Synthetic alt A edited');
  await editor.getByTestId('media-save').click();
  await expect.poll(() => calls.patches.length).toBe(1);
  await chips.nth(1).click();
  await editor.getByTestId('media-alt-text').fill('Synthetic alt B edited');
  release();
  await expect(editor.getByTestId('media-problem')).toBeVisible();
  await page.waitForTimeout(300);
  await expect(chips.nth(1)).toHaveAttribute('aria-pressed', 'true');
  await expect(editor.getByTestId('media-alt-text')).toHaveValue('Synthetic alt B edited');
  expect(calls.unexpected).toEqual([]);
});

// R1/R2 (independent review of 5600029): error recovery must never pair one
// draft's identity with another draft's form, and must never advance the
// expected version while carrying stale untouched fields. Exact PATCH target,
// version and fields are asserted at phone and desktop widths.
const holds = () => { let release; const promise = new Promise((resolve) => { release = resolve; }); return { promise, release }; };
async function holdStaleSaveOnA(editor, calls, text) {
  const patch = holds();
  calls.holdPatch = patch.promise;
  calls.stalePatch = true;
  await editor.getByTestId('media-draft-chip').nth(0).click();
  await editor.getByTestId('media-alt-text').fill(text);
  await editor.getByTestId('media-save').click();
  await expect.poll(() => calls.patches.length).toBe(1);
  return patch;
}
const pressed = async (chips) => ((await chips.nth(0).getAttribute('aria-pressed')) === 'true' ? 'rev-a' : 'rev-b');

for (const [label, viewport] of [['phone', { width: 390, height: 844 }], ['desktop', { width: 1280, height: 800 }]]) {
  test(`R1 ${label}: a second draft switch during the recovery reload keeps the current draft, its edits and its save target`, async ({ page }) => {
    const { calls, editor, state } = await setup(page, [withAlt('rev-a', 'Synthetic alt A'), withAlt('rev-b', 'Synthetic alt B')], { viewport });
    const chips = editor.getByTestId('media-draft-chip');
    const reload = holds();
    calls.holdReload = reload.promise;
    const patch = await holdStaleSaveOnA(editor, calls, 'Synthetic A first save');
    await chips.nth(1).click();
    await editor.getByTestId('media-alt-text').fill('Synthetic B unsaved');
    patch.release();
    await expect.poll(() => calls.revisionReads).toBe(2);
    // The recovery reload is still in flight: switch back to A and edit again.
    await chips.nth(0).click();
    await editor.getByTestId('media-alt-text').fill('Synthetic A second edit');
    reload.release();
    // Recovery finished (busy cleared; the edited form keeps Save enabled).
    await expect(editor.getByTestId('media-save')).toBeEnabled();
    await page.waitForTimeout(300);
    expect(await pressed(chips)).toBe('rev-a');
    await expect(editor.getByTestId('media-alt-text')).toHaveValue('Synthetic A second edit');
    calls.stalePatch = false;
    calls.holdPatch = null;
    await editor.getByTestId('media-save').click();
    await expect.poll(() => calls.patches.length).toBe(2);
    expect(calls.patches).toEqual([
      { id: 'rev-a', body: { expected_version: 1, alt_text: 'Synthetic A first save' } },
      { id: 'rev-a', body: { expected_version: 1, alt_text: 'Synthetic A second edit' } },
    ]);
    expect(state.drafts.map((d) => [d.id, d.version, d.text.alt_text])).toEqual([['rev-a', 2, 'Synthetic A second edit'], ['rev-b', 1, 'Synthetic alt B']]);
    expect(calls.unexpected).toEqual([]);
  });

  test(`R2 ${label}: a recovery reload takes untouched fields from the newer version and saves only the cue edited here`, async ({ page }) => {
    const { calls, editor, state } = await setup(page, [withAlt('rev-a', 'Synthetic alt A'), withAlt('rev-b', 'Synthetic B original alt')], { viewport });
    const chips = editor.getByTestId('media-draft-chip');
    const reload = holds();
    calls.holdReload = reload.promise;
    const patch = await holdStaleSaveOnA(editor, calls, 'Synthetic A first save');
    await chips.nth(1).click();
    await editor.getByTestId('media-cue-0').fill('Synthetic B new unsaved cue');
    // Another tab saves B's alt text (never edited here) while A's request waits.
    state.drafts = state.drafts.map((d) => (d.id === 'rev-b' ? { ...d, version: 2, text: { ...d.text, alt_text: 'Synthetic B newer server alt' } } : d));
    patch.release();
    await expect.poll(() => calls.revisionReads).toBe(2);
    // Same identity throughout the reload.
    expect(await pressed(chips)).toBe('rev-b');
    reload.release();
    await expect(editor.getByTestId('media-alt-text')).toHaveValue('Synthetic B newer server alt');
    await expect(editor.getByTestId('media-cue-0')).toHaveValue('Synthetic B new unsaved cue');
    await expect(editor.getByTestId('media-conflict')).toHaveCount(0);
    expect(await pressed(chips)).toBe('rev-b');
    calls.stalePatch = false;
    calls.holdPatch = null;
    await editor.getByTestId('media-save').click();
    await expect.poll(() => calls.patches.length).toBe(2);
    expect(calls.patches.at(-1)).toEqual({ id: 'rev-b', body: { expected_version: 2, cues: ['Synthetic B new unsaved cue'] } });
    const saved = state.drafts.find((d) => d.id === 'rev-b');
    expect([saved.version, saved.text.alt_text, saved.text.cues]).toEqual([3, 'Synthetic B newer server alt', ['Synthetic B new unsaved cue']]);
    expect(calls.unexpected).toEqual([]);
  });

  test(`R2 ${label}: a field edited here and changed elsewhere keeps the old version until the coach loads the latest`, async ({ page }) => {
    const { calls, editor, state } = await setup(page, [withAlt('rev-a', 'Synthetic alt A'), withAlt('rev-b', 'Synthetic B original alt')], { viewport });
    const chips = editor.getByTestId('media-draft-chip');
    const patch = await holdStaleSaveOnA(editor, calls, 'Synthetic A first save');
    await chips.nth(1).click();
    await editor.getByTestId('media-alt-text').fill('Synthetic B local alt');
    state.drafts = state.drafts.map((d) => (d.id === 'rev-b' ? { ...d, version: 2, text: { ...d.text, alt_text: 'Synthetic B newer server alt' } } : d));
    patch.release();
    await expect(editor.getByTestId('media-conflict')).toBeVisible();
    await expect(editor.getByTestId('media-alt-text')).toHaveValue('Synthetic B local alt');
    expect(await pressed(chips)).toBe('rev-b');
    // Saving still carries the original version, so the server refuses it.
    calls.stalePatch = false;
    calls.holdPatch = null;
    await editor.getByTestId('media-save').click();
    await expect.poll(() => calls.patches.length).toBe(2);
    expect(calls.patches.at(-1)).toEqual({ id: 'rev-b', body: { expected_version: 1, alt_text: 'Synthetic B local alt' } });
    await expect(editor.getByTestId('media-conflict')).toBeVisible();
    expect(state.drafts.find((d) => d.id === 'rev-b').text.alt_text).toBe('Synthetic B newer server alt');
    // Deliberate reconciliation: load the latest version.
    await editor.getByTestId('media-conflict-load-latest').click();
    await expect(editor.getByTestId('media-conflict')).toHaveCount(0);
    await expect(editor.getByTestId('media-alt-text')).toHaveValue('Synthetic B newer server alt');
    await expect(editor.getByTestId('media-save')).toBeDisabled();
    await editor.getByTestId('media-alt-text').fill('Synthetic B reconciled alt');
    await editor.getByTestId('media-save').click();
    await expect.poll(() => calls.patches.length).toBe(3);
    expect(calls.patches.at(-1)).toEqual({ id: 'rev-b', body: { expected_version: 2, alt_text: 'Synthetic B reconciled alt' } });
    expect(calls.unexpected).toEqual([]);
  });
}
