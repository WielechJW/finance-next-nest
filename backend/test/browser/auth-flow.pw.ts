import { fillCredentials } from './actions.js';
import { API_URL, test, expect } from './fixtures.js';

test('registers, logs in, survives a reload and revokes access after logout', async ({
  page,
  request,
  accounts,
}) => {
  const account = accounts.newAccount();
  await page.goto('/register');
  await fillCredentials(page, account);
  await page
    .getByLabel('Powtórz hasło', { exact: true })
    .fill(account.password);
  await page
    .getByRole('button', { name: 'Zarejestruj się', exact: true })
    .click();
  await expect(page).toHaveURL(/\/login\?registered=1$/);
  await expect(
    page.getByText('Konto zostało utworzone. Możesz się zalogować.'),
  ).toBeVisible();

  await fillCredentials(page, account);
  await page.getByRole('button', { name: 'Zaloguj się', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/wallet$/);
  await expect(page.getByText(account.email, { exact: true })).toBeVisible();
  const cookie = (await page.context().cookies(API_URL)).find(
    (entry) => entry.name === 'finance.sid',
  );
  expect(cookie).toMatchObject({
    httpOnly: true,
    sameSite: 'Lax',
    secure: false,
  });

  await page.reload();
  await expect(page.getByText(account.email, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Wyloguj się', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login$/);
  await expect(
    page.getByText(account.email, { exact: true }),
  ).not.toBeVisible();
  const oldSession = await request.get(API_URL + '/auth/me', {
    headers: { Cookie: 'finance.sid=' + cookie!.value },
  });
  expect(oldSession.status()).toBe(401);
});

test('redirects an anonymous visitor away from the dashboard', async ({
  page,
}) => {
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login$/);
  await expect(
    page.getByRole('heading', { name: 'Logowanie', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Wyloguj się' }),
  ).not.toBeVisible();
});
