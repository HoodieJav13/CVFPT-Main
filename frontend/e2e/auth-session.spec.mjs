import { test, expect } from '@playwright/test';

const ACCESS = 'fictional-existing-access';
const REFRESH = 'fictional-existing-refresh';
const EMAIL = 'fictional@example.invalid';
const PASSWORD = 'fictional-password';
const verdict = (role) => ({ role, email: EMAIL, profile: { id: 'fictional-user', name: 'Fictional User' } });

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function install(page, { role = 'coach', stored = true, meStatus = 200 } = {}) {
  const destination = role === 'client' ? '/client/programs' : '/coach/sessions';
  const started = deferred(), release = deferred();
  const signupPosts = [], unexpected = [], external = [], errors = [];
  let signupAllowed = false;
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(({ stored, destination, access, refresh }) => {
    if (stored) {
      localStorage.setItem('cvf_access_token', access);
      localStorage.setItem('cvf_refresh_token', refresh);
    }
    history.replaceState({ usr: { from: { pathname: destination } } }, '');
  }, { stored, destination, access: ACCESS, refresh: REFRESH });
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== 'http://127.0.0.1:42734') {
      external.push(url.origin);
      return route.abort();
    }
    if (!url.pathname.startsWith('/api/')) return route.continue();
    const path = url.pathname.slice(4);
    if (path === '/auth/me' && request.method() === 'GET') {
      started.resolve();
      await release.promise;
      return route.fulfill({ status: meStatus, json: meStatus === 200 ? verdict(role) : { error: 'Fictional session rejected' } });
    }
    if (path === '/auth/signup' && request.method() === 'POST') {
      signupPosts.push(request.postDataJSON());
      return route.fulfill(signupAllowed
        ? { status: 201, json: { ...verdict(role), access_token: 'fictional-new-access', refresh_token: 'fictional-new-refresh' } }
        : { status: 403, json: { error: 'Fictional invite rejected' } });
    }
    if (path === '/telemetry/events' && request.method() === 'POST') return route.fulfill({ status: 204 });
    if (request.method() === 'GET') {
      if (['/notifications/unread-count', '/workout-logs/coach-feedback/unread-count'].includes(path)) return route.fulfill({ json: { unread: 0 } });
      if (path === '/workout-logs/active') return route.fulfill({ json: null });
      if (path === '/workout-logs/mine') return route.fulfill({ json: { logs: [], next_cursor: null } });
      if (['/sessions', '/bookings', '/clients', '/programs', '/programs/client/assigned'].includes(path)) return route.fulfill({ json: [] });
    }
    unexpected.push(`${request.method()} ${path}`);
    return route.fulfill({ status: 500, json: { error: 'Unexpected fictional request' } });
  });
  return {
    destination, started: started.promise, release: release.resolve, signupPosts,
    allowSignup: () => { signupAllowed = true; },
    verify: () => { expect(external).toEqual([]); expect(unexpected).toEqual([]); expect(errors).toEqual([]); },
  };
}

async function fillSignup(page) {
  await page.getByTestId('signup-email-input').fill(EMAIL);
  await page.getByTestId('signup-password-input').fill(PASSWORD);
  await page.getByTestId('signup-confirm-input').fill(PASSWORD);
}

const tokens = page => page.evaluate(() => ({ access: localStorage.getItem('cvf_access_token'), refresh: localStorage.getItem('cvf_refresh_token') }));

for (const role of ['coach', 'client']) {
  test(`signup waits for pending ${role} session and preserves the protected destination`, async ({ page }) => {
    const mock = await install(page, { role });
    try {
      await page.goto('/signup');
      await mock.started;
      await expect(page.getByTestId('loading-screen')).toBeVisible();
      await expect(page.getByTestId('invite-claim-submit-button')).toHaveCount(0);
      await expect(page.getByTestId('signup-email-input')).toHaveCount(0);
      expect(mock.signupPosts).toEqual([]);
      mock.release();
      await expect(page).toHaveURL(mock.destination);
      await expect(page.getByRole('heading', { name: role === 'client' ? 'My training' : 'Sessions', exact: true })).toBeVisible();
      expect(await tokens(page)).toEqual({ access: ACCESS, refresh: REFRESH });
      expect(mock.signupPosts).toEqual([]);
      mock.verify();
    } finally { mock.release(); }
  });
}

test('a rejected stored session finishes loading and permits an invite rejection', async ({ page }) => {
  const mock = await install(page, { meStatus: 403 });
  try {
    await page.goto('/signup');
    await mock.started;
    await expect(page.getByTestId('loading-screen')).toBeVisible();
    mock.release();
    await fillSignup(page);
    await page.getByTestId('invite-claim-submit-button').click();
    await expect(page.getByTestId('invite-invalid-state-text')).toContainText('Fictional invite rejected');
    await expect(page.getByTestId('invite-claim-submit-button')).toBeEnabled();
    await expect(page).toHaveURL('/signup');
    expect(mock.signupPosts).toEqual([{ email: EMAIL, password: PASSWORD }]);
    expect(await tokens(page)).toEqual({ access: ACCESS, refresh: REFRESH });
    mock.verify();
  } finally { mock.release(); }
});

test('signed-out signup retains validation, rejection and successful claim behavior', async ({ page }) => {
  const mock = await install(page, { role: 'client', stored: false });
  await page.goto('/signup');
  await fillSignup(page);
  await page.getByTestId('signup-confirm-input').fill(`${PASSWORD}-mismatch`);
  await page.getByTestId('invite-claim-submit-button').click();
  await expect(page.getByTestId('invite-invalid-state-text')).toContainText('Passwords do not match');
  expect(mock.signupPosts).toEqual([]);
  await page.getByTestId('signup-confirm-input').fill(PASSWORD);
  await page.getByTestId('invite-claim-submit-button').click();
  await expect(page.getByTestId('invite-invalid-state-text')).toContainText('Fictional invite rejected');
  expect(await tokens(page)).toEqual({ access: null, refresh: null });
  mock.allowSignup();
  await page.getByTestId('invite-claim-submit-button').click();
  await expect(page).toHaveURL(mock.destination);
  await expect(page.getByRole('heading', { name: 'My training', exact: true })).toBeVisible();
  expect(mock.signupPosts).toEqual([{ email: EMAIL, password: PASSWORD }, { email: EMAIL, password: PASSWORD }]);
  expect(await tokens(page)).toEqual({ access: 'fictional-new-access', refresh: 'fictional-new-refresh' });
  mock.verify();
});
