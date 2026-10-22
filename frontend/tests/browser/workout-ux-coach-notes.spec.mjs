// Coach Notes save outcomes and unsaved text (normal mode, synthetic API in
// this test process; fictional data). Covers the separate review's P3-1 (a
// lost or 5xx reply after the server stored a note) and P3-2 (unsaved text on
// a tab switch). Privacy is server-side and unchanged; it is proven by
// backend/test/coach-notes.test.js and the local Supabase trial, not here.
import { test, expect } from '@playwright/test';

const COACH = { id: 'fict-coach-n1', name: 'Fictional Coach N1', email: 'coach-n1@example.invalid', is_admin: false };
const CLIENT = { id: 'fict-client-n1', coach_id: COACH.id, name: 'Sample Client N1 (fictional)', email: 'client-n1@example.invalid', archived: false, auth_user_id: 'user-client-n1', invited: true, created_at: '2026-06-01T12:00:00.000Z' };
const TOKEN = 'synthetic-n1-coach-token';
const UNSAVED_NOTE = 'You have an unsaved coach note. Discard it and continue?';

async function setup(page, width, behaviour = {}) {
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const store = {
    notes: [{ id: 'fict-note-own', client_id: CLIENT.id, author_coach_id: COACH.id, author_name_snapshot: COACH.name, content: 'Fictional own note.', created_at: '2026-10-20T15:00:00.000Z', updated_at: '2026-10-20T15:00:00.000Z' }],
    posts: 0, gets: 0, unexpected: [], seq: 0, behaviour,
  };
  const json = (route, value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) }).catch(() => {});
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api/, '');
    const method = request.method();
    if (path === '/telemetry/events') return route.fulfill({ status: 204 });
    if ((request.headers().authorization || '') !== `Bearer ${TOKEN}`) return json(route, { error: 'Invalid or expired token' }, 401);
    if (path === '/auth/me') return json(route, { role: 'coach', email: COACH.email, profile: COACH });
    if (path.endsWith('/unread-count')) return json(route, { unread: 0 });
    if (path === `/clients/${CLIENT.id}`) return json(route, { ...CLIENT, invite: null });
    if (path === `/waivers/client/${CLIENT.id}/status`) return json(route, { has_version: false, signed_latest: false, history: [] });
    if (path === `/workout-logs/clients/${CLIENT.id}/week-rhythm`) return json(route, { week_total: 0, week_done: 0, days: [] });
    if (path === `/check-ins/clients/${CLIENT.id}`) return json(route, []);
    if (path === `/clients/${CLIENT.id}/coach-notes` && method === 'GET') {
      store.gets += 1;
      if (store.behaviour.failNextGets > 0) { store.behaviour.failNextGets -= 1; return json(route, { error: 'Synthetic list outage' }, 503); }
      return json(route, { notes: [...store.notes].sort((a, b) => b.created_at.localeCompare(a.created_at)) });
    }
    if (path === `/clients/${CLIENT.id}/coach-notes` && method === 'POST') {
      store.posts += 1;
      const outcome = store.behaviour.nextPost; store.behaviour.nextPost = null;
      if (outcome === 'refuse-400') return json(route, { error: 'A note needs 1 to 4,000 characters' }, 400);
      if (outcome === 'fail-503-unstored') return json(route, { error: 'Synthetic outage' }, 503);
      const at = new Date(Date.UTC(2026, 9, 22, 12, 0, store.seq += 1)).toISOString();
      const row = { id: `fict-note-${store.seq}`, client_id: CLIENT.id, author_coach_id: COACH.id, author_name_snapshot: COACH.name, content: String(request.postDataJSON().content).trim(), created_at: at, updated_at: at };
      store.notes.push(row);
      if (outcome === 'lose-reply-after-store') return route.abort('connectionreset');
      if (outcome === 'fail-500-after-store') return json(route, { error: 'Failed to save coach note' }, 500);
      return json(route, row, 201);
    }
    const put = path.match(new RegExp(`^/clients/${CLIENT.id}/coach-notes/([^/]+)$`));
    if (put && method === 'PUT') {
      const row = store.notes.find((n) => n.id === put[1]);
      Object.assign(row, { content: String(request.postDataJSON().content).trim(), updated_at: new Date(Date.UTC(2026, 9, 22, 13, 0, store.seq += 1)).toISOString() });
      return json(route, row);
    }
    store.unexpected.push(`${method} ${path}`);
    return json(route, { error: 'Unexpected synthetic route' }, 404);
  });
  const prompts = [];
  page.on('dialog', (dialog) => { prompts.push(dialog.message()); return store.behaviour.dismissPrompts ? dialog.dismiss() : dialog.accept(); });
  await page.goto('/login');
  await page.evaluate((token) => localStorage.setItem('cvf_access_token', token), TOKEN);
  await page.goto(`/coach/clients/${CLIENT.id}`);
  const card = page.getByTestId('coach-notes');
  await expect(card.getByTestId('coach-notes-list')).toBeVisible();
  await page.waitForTimeout(300);
  store.loadGets = store.gets; // list reads made by the page load itself
  return { card, store, prompts, input: card.getByTestId('coach-note-input'), save: card.getByTestId('coach-note-save-button'), notice: card.getByTestId('coach-note-add-unconfirmed') };
}
const copies = (store, text) => store.notes.filter((n) => n.content === text).length;

for (const width of [390, 1440]) {
  test(`P3-1 ${width}: a reply lost after the server stored the note is not called "Not saved"; the list is reloaded and shows it once`, async ({ page }) => {
    const { card, store, input, save, notice } = await setup(page, width, { nextPost: 'lose-reply-after-store' });
    await input.fill('Lost-reply fictional note.');
    await save.click();
    await expect(notice).toHaveAttribute('data-phase', 'reloaded');
    await expect(notice).toContainText("Not confirmed: the server did not give a definite answer (no reply or a server error), so this note may already be saved.");
    await expect(notice).toContainText('The reloaded list now shows a note of yours with this exact text, so it was probably saved. Check it before saving again. Your text is still here.');
    await expect(card.getByTestId('coach-note-add-error')).toHaveCount(0);
    await expect(card.getByTestId('coach-note-content').filter({ hasText: 'Lost-reply fictional note.' })).toHaveCount(1);
    await expect(input).toHaveValue('Lost-reply fictional note.');
    await page.waitForTimeout(300);
    // One POST, one stored copy, and exactly one list reload after the lost reply.
    expect([store.posts, copies(store, 'Lost-reply fictional note.'), store.gets - store.loadGets]).toEqual([1, 1, 1]);
    expect(store.unexpected).toEqual([]);
  });

  test(`P3-1 ${width}: a 500 after the note was stored takes the same not-confirmed path`, async ({ page }) => {
    const { card, store, input, save, notice } = await setup(page, width, { nextPost: 'fail-500-after-store' });
    await input.fill('Stored-then-500 fictional note.');
    await save.click();
    await expect(notice).toHaveAttribute('data-phase', 'reloaded');
    await expect(notice).toContainText('so it was probably saved');
    await expect(card.getByTestId('coach-note-add-error')).toHaveCount(0);
    await expect(card.getByTestId('coach-note-content').filter({ hasText: 'Stored-then-500 fictional note.' })).toHaveCount(1);
    expect([store.posts, copies(store, 'Stored-then-500 fictional note.')]).toEqual([1, 1]);
  });

  test(`P3-1 ${width}: if the list cannot be reloaded, saving again stays paused until it reloads`, async ({ page }) => {
    const { card, store, input, save, notice } = await setup(page, width, { nextPost: 'lose-reply-after-store' });
    store.behaviour.failNextGets = 1;
    await input.fill('Paused fictional note.');
    await save.click();
    await expect(notice).toHaveAttribute('data-phase', 'reload-failed');
    await expect(notice).toContainText('Saving again is paused until they reload, so the note is not added twice. Your text is still here.');
    await expect(save).toBeDisabled();
    await card.getByTestId('coach-note-reload-notes').click();
    await expect(notice).toHaveAttribute('data-phase', 'reloaded');
    await expect(save).toBeEnabled();
    await expect(card.getByTestId('coach-note-content').filter({ hasText: 'Paused fictional note.' })).toHaveCount(1);
    expect([store.posts, copies(store, 'Paused fictional note.')]).toEqual([1, 1]);
  });

  test(`P3-1 ${width}: a 503 that stored nothing reloads, finds no match, and a deliberate second save stores it once`, async ({ page }) => {
    const { card, store, input, save, notice } = await setup(page, width, { nextPost: 'fail-503-unstored' });
    await input.fill('Retry fictional note.');
    await save.click();
    await expect(notice).toHaveAttribute('data-phase', 'reloaded');
    await expect(notice).toContainText('The list below was reloaded. Check it before saving again. Your text is still here.');
    await expect(notice).not.toContainText('probably saved');
    expect(copies(store, 'Retry fictional note.')).toBe(0);
    await save.click();
    await expect(page.getByText('Coach note saved').first()).toBeVisible();
    await expect(notice).toHaveCount(0);
    await expect(input).toHaveValue('');
    expect([store.posts, copies(store, 'Retry fictional note.')]).toEqual([2, 1]);
  });

  test(`P3-1 control ${width}: a 400 is a definite refusal; "Not saved", text kept, nothing stored, no reload`, async ({ page }) => {
    const { card, store, input, save, notice } = await setup(page, width, { nextPost: 'refuse-400' });
    await input.fill('Refused fictional note.');
    await save.click();
    await expect(card.getByTestId('coach-note-add-error')).toHaveText('Not saved: A note needs 1 to 4,000 characters. Your text is still here.');
    await expect(notice).toHaveCount(0);
    await expect(input).toHaveValue('Refused fictional note.');
    expect([store.posts, store.gets - store.loadGets, copies(store, 'Refused fictional note.')]).toEqual([1, 0, 0]);
  });

  test(`P3-2 ${width}: unsaved note text is guarded on a tab switch; cancel keeps it, discard clears it`, async ({ page }) => {
    const { store, input, prompts } = await setup(page, width, { dismissPrompts: true });
    await input.fill('Unsaved fictional draft.');
    await page.getByTestId('tab-check-ins').click();
    await expect.poll(() => prompts.length).toBe(1);
    expect(prompts[0]).toBe(UNSAVED_NOTE);
    await expect(page.getByTestId('tab-overview')).toHaveAttribute('data-state', 'active');
    await expect(input).toHaveValue('Unsaved fictional draft.');
    store.behaviour.dismissPrompts = false;
    await page.getByTestId('tab-check-ins').click();
    await expect(page.getByTestId('tab-check-ins')).toHaveAttribute('data-state', 'active');
    expect(prompts).toEqual([UNSAVED_NOTE, UNSAVED_NOTE]);
    await page.getByTestId('tab-overview').click();
    await expect(page.getByTestId('coach-note-input')).toHaveValue('');
    expect(prompts).toHaveLength(2);
    expect(store.posts).toBe(0);
  });

  test(`P3-2 ${width}: an unsaved edit is guarded too; saved or untouched text switches tabs without a prompt`, async ({ page }) => {
    const { card, store, input, save, prompts } = await setup(page, width, { dismissPrompts: true });
    await card.getByTestId('coach-note-edit-button').click();
    await card.getByTestId('coach-note-edit-input').fill('Edited but unsaved.');
    await page.getByTestId('tab-check-ins').click();
    await expect.poll(() => prompts.length).toBe(1);
    expect(prompts[0]).toBe(UNSAVED_NOTE);
    await expect(card.getByTestId('coach-note-edit-input')).toHaveValue('Edited but unsaved.');
    await card.getByTestId('coach-note-update-button').click();
    await expect(page.getByText('Coach note updated').first()).toBeVisible();
    await input.fill('Saved fictional note.');
    await save.click();
    await expect(page.getByText('Coach note saved').first()).toBeVisible();
    await page.getByTestId('tab-check-ins').click();
    await expect(page.getByTestId('tab-check-ins')).toHaveAttribute('data-state', 'active');
    expect(prompts).toHaveLength(1);
    expect([store.posts, store.unexpected]).toEqual([1, []]);
  });
}
