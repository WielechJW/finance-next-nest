import { expectWallet, login, logout, saveWallet } from './actions.js';
import { API_URL, FRONTEND_URL, test, expect } from './fixtures.js';

const walletA = {
  name: 'Portfel Ani',
  openingBalance: '100,50',
  balanceText: '100,50 zł',
};
const walletB = {
  name: 'Portfel Bartka',
  openingBalance: '-20,20',
  balanceText: '-20,20 zł',
};

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

test('isolates wallets in two browser contexts and keeps B logged in after A logs out', async ({
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
    await saveWallet(page, walletA.name, walletA.openingBalance);
    await login(secondPage, second);
    await saveWallet(secondPage, walletB.name, walletB.openingBalance);
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
    await expectWallet(page, walletA);
    await expectWallet(secondPage, walletB);
    await expect(
      page.getByRole('heading', { name: walletB.name, exact: true }),
    ).not.toBeVisible();
    await expect(
      secondPage.getByRole('heading', { name: walletA.name, exact: true }),
    ).not.toBeVisible();
    await logout(page);
    await expect(
      page.getByRole('heading', { name: walletA.name, exact: true }),
    ).not.toBeVisible();
    await secondPage.reload();
    await expect(
      secondPage.getByText(second.email, { exact: true }),
    ).toBeVisible();
    await expect(secondPage).toHaveURL(/\/dashboard\/wallet$/);
    await expectWallet(secondPage, walletB);
  } finally {
    await secondContext.close();
  }
});

test('shows only the current wallet when switching from A to B and back in the same context', async ({
  page,
  accounts,
}) => {
  const first = await accounts.register();
  const second = await accounts.register();
  await login(page, first);
  await saveWallet(page, walletA.name, walletA.openingBalance);
  await expectWallet(page, walletA);
  await logout(page);
  await login(page, second);
  await expectWallet(page, {
    name: 'Mój portfel',
    openingBalance: '0,00',
    balanceText: '0,00 zł',
  });
  await expect(
    page.getByText(walletA.balanceText, { exact: true }),
  ).not.toBeVisible();
  await saveWallet(page, walletB.name, walletB.openingBalance);
  await expectWallet(page, walletB);
  await expect(page.getByText(first.email, { exact: true })).not.toBeVisible();
  await page.reload();
  await expectWallet(page, walletB);
  await expect(page.getByText(second.email, { exact: true })).toBeVisible();
  await expect(page.getByText(first.email, { exact: true })).not.toBeVisible();
  await expect(
    page.getByRole('heading', { name: walletA.name, exact: true }),
  ).not.toBeVisible();
  await expect(
    page.getByText(walletA.balanceText, { exact: true }),
  ).not.toBeVisible();

  await logout(page);
  await login(page, first);
  await expectWallet(page, walletA);
  await expect(page.getByText(second.email, { exact: true })).not.toBeVisible();
  await expect(
    page.getByRole('heading', { name: walletB.name, exact: true }),
  ).not.toBeVisible();
  await expect(
    page.getByText(walletB.balanceText, { exact: true }),
  ).not.toBeVisible();
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
