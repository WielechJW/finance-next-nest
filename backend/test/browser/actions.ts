import { expect, type Page } from '@playwright/test';
import type { TestAccount } from './database.js';

export async function fillCredentials(
  page: Page,
  account: TestAccount,
): Promise<void> {
  await page.getByLabel('E-mail', { exact: true }).fill(account.email);
  await page.getByLabel('Hasło', { exact: true }).fill(account.password);
}

export async function login(page: Page, account: TestAccount): Promise<void> {
  await page.goto('/login');
  await fillCredentials(page, account);
  await page.getByRole('button', { name: 'Zaloguj się', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/wallet$/);
  await expect(page.getByText(account.email, { exact: true })).toBeVisible();
}

export async function logout(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Wyloguj się', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(
    page.getByRole('heading', { name: 'Logowanie', exact: true }),
  ).toBeVisible();
}

export async function saveWallet(
  page: Page,
  name: string,
  openingBalance: string,
): Promise<void> {
  await page.getByLabel('Nazwa portfela', { exact: true }).fill(name);
  await page
    .getByLabel('Saldo początkowe', { exact: true })
    .fill(openingBalance);
  await page.getByRole('button', { name: 'Zapisz zmiany' }).click();
  await expect(
    page.getByText('Zmiany zapisane.', { exact: true }),
  ).toBeVisible();
}

export async function expectWallet(
  page: Page,
  wallet: { name: string; openingBalance: string; balanceText: string },
): Promise<void> {
  await expect(
    page.getByRole('heading', { name: wallet.name, exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('Nazwa portfela', { exact: true })).toHaveValue(
    wallet.name,
  );
  await expect(
    page.getByLabel('Saldo początkowe', { exact: true }),
  ).toHaveValue(wallet.openingBalance);
  await expect(page.getByText(wallet.balanceText, { exact: true })).toHaveCount(
    2,
  );
}
