import { expectWallet, login, saveWallet } from './actions.js';
import { test, expect } from './fixtures.js';

test('edits the wallet with a Polish decimal separator and preserves settings after reload', async ({
  page,
  accounts,
}, testInfo) => {
  const account = await accounts.register();
  await login(page, account);
  await expect(
    page.getByRole('heading', { name: 'Mój portfel', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Portfel', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
  await expect(page.getByText('0,00 zł', { exact: true })).toHaveCount(2);
  await expect(
    page.getByRole('button', { name: 'Zapisz zmiany' }),
  ).toBeDisabled();
  await page
    .getByLabel('Nazwa portfela', { exact: true })
    .fill('Budżet domowy');
  await page.getByLabel('Saldo początkowe', { exact: true }).fill('-250,5');
  await page.getByRole('button', { name: 'Zapisz zmiany' }).click();
  await expect(
    page.getByText('Zmiany zapisane.', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Budżet domowy', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('-250,50 zł', { exact: true })).toHaveCount(2);
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Budżet domowy', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel('Saldo początkowe', { exact: true }),
  ).toHaveValue('-250,50');
  await expect(page.getByText('-250,50 zł', { exact: true })).toHaveCount(2);
  await page.screenshot({
    path: testInfo.outputPath('wallet-desktop.png'),
    fullPage: true,
  });
});

test('supports keyboard submission on a narrow screen with a long name and the minimum balance', async ({
  page,
  accounts,
}, testInfo) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const account = await accounts.register();
  await login(page, account);
  const name = page.getByLabel('Nazwa portfela', { exact: true });
  const balance = page.getByLabel('Saldo początkowe', { exact: true });
  await name.fill('Portfel '.repeat(12).trim());
  await name.press('Tab');
  await expect(balance).toBeFocused();
  await balance.fill('-999999999999,99');
  await balance.press('Enter');
  await expect(
    page.getByText('Zmiany zapisane.', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('-999 999 999 999,99 zł', { exact: true }),
  ).toHaveCount(2);
  await expect(balance).toHaveValue('-999999999999,99');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('wallet-mobile.png'),
    fullPage: true,
  });
  await page.reload();
  await expectWallet(page, {
    name: 'Portfel '.repeat(12).trim(),
    openingBalance: '-999999999999,99',
    balanceText: '-999 999 999 999,99 zł',
  });
});

test('preserves the maximum positive balance and its cents after reload', async ({
  page,
  accounts,
}) => {
  const account = await accounts.register();
  await login(page, account);
  const wallet = {
    name: 'Portfel z maksymalnym saldem',
    openingBalance: '999999999999,99',
    balanceText: '999 999 999 999,99 zł',
  };
  await saveWallet(page, wallet.name, wallet.openingBalance);
  await expectWallet(page, wallet);
  await page.reload();
  await expectWallet(page, wallet);
});

test('rejects invalid settings without sending a write or changing the saved wallet', async ({
  page,
  accounts,
}) => {
  const account = await accounts.register();
  await login(page, account);
  const wallet = {
    name: 'Zapisany portfel',
    openingBalance: '-250,50',
    balanceText: '-250,50 zł',
  };
  await saveWallet(page, wallet.name, wallet.openingBalance);
  await expectWallet(page, wallet);

  let writes = 0;
  page.on('request', (request) => {
    if (
      request.method() === 'PATCH' &&
      new URL(request.url()).pathname === '/wallet'
    ) {
      writes += 1;
    }
  });
  const name = page.getByLabel('Nazwa portfela', { exact: true });
  const balance = page.getByLabel('Saldo początkowe', { exact: true });
  const save = page.getByRole('button', { name: 'Zapisz zmiany' });
  await name.fill('');
  await save.click();
  await expect(name).toHaveAttribute('aria-invalid', 'true');
  await expect(name).toBeFocused();
  await expect(
    page.getByText('Nazwa portfela musi mieć od 1 do 100 znaków.', {
      exact: true,
    }),
  ).toBeVisible();

  // A valid name must not be partially saved when the amount is invalid.
  await name.fill('Niezapisana nazwa');
  for (const invalid of [
    '0,001',
    '1000000000000,00',
    '-1000000000000,00',
    '1e2',
  ]) {
    await balance.fill(invalid);
    await save.click();
    await expect(balance).toHaveAttribute('aria-invalid', 'true');
    await expect(balance).toBeFocused();
    await expect(balance).toHaveValue(invalid);
    await expect(name).toHaveValue('Niezapisana nazwa');
    await expect(
      page.getByRole('alert').getByText('Popraw zaznaczone pola.', {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByText('Zmiany zapisane.', { exact: true }),
    ).not.toBeVisible();
    await expect(
      page.getByRole('heading', { name: wallet.name, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(wallet.balanceText, { exact: true }),
    ).toHaveCount(2);
  }

  await page.reload();
  await expectWallet(page, wallet);
  expect(writes).toBe(0);
});
