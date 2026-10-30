import { fillCredentials } from './actions.js';
import { test, expect } from './fixtures.js';

for (const unknownEmail of [false, true]) {
  test(
    unknownEmail ? 'rejects an unknown account' : 'rejects a wrong password',
    async ({ page, accounts }) => {
      const account = unknownEmail
        ? accounts.newAccount()
        : await accounts.register();
      await page.goto('/login');
      const input = { ...account, password: 'Nieprawidłowe hasło 123!' };
      await fillCredentials(page, input);
      const response = page.waitForResponse(
        (entry) =>
          new URL(entry.url()).pathname === '/auth/login' &&
          entry.request().method() === 'POST',
      );
      await page
        .getByRole('button', { name: 'Zaloguj się', exact: true })
        .click();
      expect((await response).status()).toBe(401);
      await expect(
        page
          .getByRole('region', { name: 'Logowanie', exact: true })
          .getByRole('alert'),
      ).toContainText('Nieprawidłowy e-mail lub hasło.');
      await expect(page).toHaveURL(/\/login$/);
      await expect(page.getByLabel('E-mail', { exact: true })).toHaveValue(
        input.email,
      );
      await expect(page.getByLabel('Hasło', { exact: true })).toHaveValue(
        input.password,
      );
      await expect(
        page.getByRole('button', { name: 'Zaloguj się', exact: true }),
      ).toBeEnabled();
    },
  );
}

test('reports an occupied email after normalization and preserves the form', async ({
  page,
  accounts,
}) => {
  const account = await accounts.register();
  await page.goto('/register');
  await fillCredentials(page, {
    ...account,
    email: account.email.toUpperCase(),
  });
  await page
    .getByLabel('Powtórz hasło', { exact: true })
    .fill(account.password);
  const response = page.waitForResponse(
    (entry) =>
      new URL(entry.url()).pathname === '/auth/register' &&
      entry.request().method() === 'POST',
  );
  await page
    .getByRole('button', { name: 'Zarejestruj się', exact: true })
    .click();
  expect((await response).status()).toBe(409);
  await expect(
    page.getByText('Ten adres e-mail jest już zajęty.', { exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/register$/);
  await expect(page.getByLabel('E-mail', { exact: true })).toHaveValue(
    account.email.toUpperCase(),
  );
  await expect(page.getByLabel('Hasło', { exact: true })).toHaveValue(
    account.password,
  );
  await expect(
    page.getByRole('button', { name: 'Zarejestruj się', exact: true }),
  ).toBeEnabled();
});
