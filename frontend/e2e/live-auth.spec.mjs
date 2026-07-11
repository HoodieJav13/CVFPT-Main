import { test, expect } from '@playwright/test';

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

test('real client auth covers check-in, booking, messaging, route protection, and navigation', async ({ page, request }) => {
  const marker = `CVF LIVE ${Date.now()}`;
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
  await page.goto('/client/packages');
  await expect(page.getByTestId('payments-not-configured-card')).toBeVisible();
  await expect(page.getByTestId('credits-balance-text')).toContainText('0');

  await page.goto('/coach');
  await expect(page).toHaveURL(/\/client$/);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId('bottom-tab-sessions')).toBeVisible();

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

test('real coach auth covers ownership surfaces and archives created test data', async ({ page }) => {
  const marker = `CVF LIVE ${Date.now()}`;
  const email = `cvf-live-${Date.now()}@example.invalid`;
  await login(page, accounts.coach, '/coach');
  await expect(page.getByTestId('coach-dashboard-today-sessions-card')).toBeVisible();

  const pending = page.getByTestId('booking-request-row').filter({ hasText: 'CVF LIVE' });
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

  for (const tab of ['tab-check-ins', 'tab-progress', 'tab-sessions', 'tab-programs', 'tab-payments']) {
    await page.getByTestId(tab).click();
  }
  await page.getByTestId('tab-overview').click();
  await page.getByTestId('archive-client-button').click();
  await expect(page.getByTestId('archive-client-button')).toContainText('Restore client');

  await page.goto('/coach/sessions');
  await expect(page.getByRole('heading', { name: 'Sessions' })).toBeVisible();
  await expect(page.getByTestId('session-create-button')).toBeVisible();
  await page.goto('/coach/programs');
  await expect(page.getByRole('heading', { name: 'Training builder' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Exercise Library' })).toBeVisible();
  await page.goto('/coach/messages');
  await expect(page.getByRole('heading', { name: 'Messages' })).toBeVisible();
  await logout(page);
});

test('real admin auth exposes admin-only management and blocks client routes', async ({ page }) => {
  await login(page, accounts.admin, '/coach');
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Admin' })).toBeVisible();
  await expect(page.getByTestId('admin-tab-coaches')).toBeVisible();
  await expect(page.getByTestId('admin-tab-waivers')).toBeVisible();
  await expect(page.getByTestId('admin-tab-packages')).toBeVisible();
  await page.goto('/client');
  await expect(page).toHaveURL(/\/coach$/);
  await logout(page);
});
