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
