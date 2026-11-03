import { login, logout } from './actions.js';
import { API_URL, FRONTEND_URL, test, expect } from './fixtures.js';

test('redirects to login when the server-side session expires while the cookie still exists', async ({
  page,
  accounts,
}) => {
  const account = await accounts.register();
  await login(page, account);
  await accounts.expireSessions(account);
  expect(
    (await page.context().cookies(API_URL)).some(
      (entry) => entry.name === 'finance.sid',
    ),
  ).toBe(true);
  const response = page.waitForResponse(
    (entry) =>
      new URL(entry.url()).pathname === '/auth/me' && entry.status() === 401,
  );
  await page.reload();
  expect((await response).status()).toBe(401);
  await expect(page).toHaveURL(/\/login$/);
  await expect(
    page.getByText(account.email, { exact: true }),
  ).not.toBeVisible();
});

test('isolates two browser contexts and keeps B logged in after A logs out', async ({
  page,
  browser,
  accounts,
}) => {
  const first = await accounts.register();
  const second = await accounts.register();
  const secondContext = await browser.newContext({ baseURL: FRONTEND_URL });
  try {
    const secondPage = await secondContext.newPage();
    await login(page, first);
    await login(secondPage, second);
    await page.reload();
    await secondPage.reload();
    await expect(page.getByText(first.email, { exact: true })).toBeVisible();
    await expect(
      page.getByText(second.email, { exact: true }),
    ).not.toBeVisible();
    await expect(
      secondPage.getByText(second.email, { exact: true }),
    ).toBeVisible();
    await expect(
      secondPage.getByText(first.email, { exact: true }),
    ).not.toBeVisible();
    await logout(page);
    await secondPage.reload();
    await expect(
      secondPage.getByText(second.email, { exact: true }),
    ).toBeVisible();
    await expect(secondPage).toHaveURL(/\/dashboard\/wallet$/);
  } finally {
    await secondContext.close();
  }
});

test('shows only B after logging out A and switching accounts in the same context', async ({
  page,
  accounts,
}) => {
  const first = await accounts.register();
  const second = await accounts.register();
  await login(page, first);
  await logout(page);
  await login(page, second);
  await expect(page.getByText(first.email, { exact: true })).not.toBeVisible();
  await page.reload();
  await expect(page.getByText(second.email, { exact: true })).toBeVisible();
  await expect(page.getByText(first.email, { exact: true })).not.toBeVisible();
});

test('does not restore private account data when navigating back after logout', async ({
  page,
  accounts,
}) => {
  const account = await accounts.register();
  await login(page, account);
  // Create a previous protected history entry before logout replaces this one.
  await page.goto('/dashboard/wallet?history=1');
  await expect(page.getByText(account.email, { exact: true })).toBeVisible();
  await logout(page);
  await page.goBack();
  await expect(page).toHaveURL(/\/login$/);
  await expect(
    page.getByText(account.email, { exact: true }),
  ).not.toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Logowanie', exact: true }),
  ).toBeVisible();
});
