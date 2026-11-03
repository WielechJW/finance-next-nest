import { login } from './actions.js';
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
});
