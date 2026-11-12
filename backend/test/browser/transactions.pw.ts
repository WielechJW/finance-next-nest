import type { Page } from '@playwright/test';
import { login, saveWallet } from './actions.js';
import { API_URL, FRONTEND_URL, test, expect } from './fixtures.js';

async function openTransactions(page: Page) {
  await page.getByRole('link', { name: 'Transakcje', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/transactions$/);
  await expect(
    page.getByRole('link', { name: 'Transakcje', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
  await expect(
    page.getByRole('option', { name: 'Jedzenie', exact: true }),
  ).toBeAttached();
}

async function fillTransaction(page: Page, income = false, amount = '12,50') {
  await page
    .getByLabel('Typ operacji', { exact: true })
    .selectOption(income ? 'INCOME' : 'EXPENSE');
  await page.getByLabel('Kwota', { exact: true }).fill(amount);
  await page
    .getByLabel('Kategoria', { exact: true })
    .selectOption({ label: income ? 'Wynagrodzenie' : 'Jedzenie' });
  await page
    .getByLabel('Tytuł', { exact: true })
    .fill(income ? 'Wypłata' : 'Zakupy spożywcze');
  await page.getByLabel('Data operacji', { exact: true }).fill('9999-12-31');
  await page
    .getByLabel('Notatka (opcjonalnie)', { exact: true })
    .fill('Notatka do operacji');
}

async function expectTotal(page: Page, total: number) {
  const response = await page.request.get(API_URL + '/transactions');
  expect(response.status()).toBe(200);
  const body = (await response.json()) as {
    total: number;
    items: { type: string; amount: string; occurredOn: string }[];
  };
  expect(body.total).toBe(total);
  return body.items;
}

test('adds an expense and income, refreshes the balance and preserves the result on the wallet page', async ({
  page,
  accounts,
}, testInfo) => {
  await login(page, await accounts.register());
  await saveWallet(page, 'Portfel z formularzem', '100,00');
  await openTransactions(page);
  await expect(page.getByText('100,00 zł', { exact: true })).toBeVisible();
  await fillTransaction(page, false, '20,10');
  await page
    .getByRole('button', { name: 'Zapisz transakcję', exact: true })
    .click();
  await expect(
    page.getByText('Wydatek zapisany.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('79,90 zł', { exact: true })).toBeVisible();
  await page.getByLabel('Typ operacji', { exact: true }).selectOption('INCOME');
  await expect(page.getByLabel('Kategoria', { exact: true })).toHaveValue('');
  await expect(
    page.getByRole('option', { name: 'Jedzenie', exact: true }),
  ).toHaveCount(0);
  await fillTransaction(page, true, '50,20');
  await page
    .getByRole('button', { name: 'Zapisz transakcję', exact: true })
    .click();
  await expect(
    page.getByText('Przychód zapisany.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('130,10 zł', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Kwota', { exact: true })).toHaveValue('');
  const items = await expectTotal(page, 2);
  expect(items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: 'EXPENSE',
        amount: '20.10',
        occurredOn: '9999-12-31',
      }),
      expect.objectContaining({
        type: 'INCOME',
        amount: '50.20',
        occurredOn: '9999-12-31',
      }),
    ]),
  );
  await page.screenshot({
    path: testInfo.outputPath('transactions-desktop.png'),
    fullPage: true,
  });
  await page.getByRole('link', { name: 'Portfel', exact: true }).click();
  await expect(page.getByText('130,10 zł', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('130,10 zł', { exact: true })).toBeVisible();
});

test('preserves all fields after a network error and saves exactly one transaction on retry', async ({
  page,
  accounts,
}) => {
  await login(page, await accounts.register());
  await openTransactions(page);
  let posts = 0;
  await page.route(API_URL + '/transactions', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    posts += 1;
    if (posts === 1) await route.abort('failed');
    else await route.continue();
  });
  await fillTransaction(page);
  await page
    .getByRole('button', { name: 'Zapisz transakcję', exact: true })
    .click();
  await expect(page.getByText(/Sprawdź połączenie/)).toBeVisible();
  await expect(page.getByLabel('Kwota', { exact: true })).toHaveValue('12,50');
  await expect(page.getByLabel('Tytuł', { exact: true })).toHaveValue(
    'Zakupy spożywcze',
  );
  await expect(page.getByLabel('Data operacji', { exact: true })).toHaveValue(
    '9999-12-31',
  );
  await expect(
    page.getByLabel('Notatka (opcjonalnie)', { exact: true }),
  ).toHaveValue('Notatka do operacji');
  await page
    .getByRole('button', { name: 'Zapisz transakcję', exact: true })
    .click();
  await expect(
    page.getByText('Wydatek zapisany.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('-12,50 zł', { exact: true })).toBeVisible();
  expect(posts).toBe(2);
  await expectTotal(page, 1);
});

test('retries only the wallet read after it fails following a confirmed save', async ({
  page,
  accounts,
}) => {
  await login(page, await accounts.register());
  await openTransactions(page);
  await expect(page.getByText('0,00 zł', { exact: true })).toBeVisible();
  await page.route(
    API_URL + '/wallet',
    async (route) => {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        headers: {
          'Access-Control-Allow-Origin': FRONTEND_URL,
          'Access-Control-Allow-Credentials': 'true',
        },
        body: JSON.stringify({ message: 'Testowy błąd odczytu.' }),
      });
    },
    { times: 1 },
  );
  await fillTransaction(page);
  await page
    .getByRole('button', { name: 'Zapisz transakcję', exact: true })
    .click();
  await expect(
    page.getByText('Wydatek zapisany.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/Nie udało się odświeżyć salda/)).toBeVisible();
  await page
    .getByRole('button', { name: 'Odśwież saldo', exact: true })
    .click();
  await expect(page.getByText('-12,50 zł', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Kwota', { exact: true })).toHaveValue('');
  await expectTotal(page, 1);
});

test('blocks repeated submission while a POST is pending', async ({
  page,
  accounts,
}) => {
  await login(page, await accounts.register());
  await openTransactions(page);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let posts = 0;
  await page.route(API_URL + '/transactions', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    posts += 1;
    await pending;
    await route.continue();
  });
  await fillTransaction(page);
  await page
    .getByRole('button', { name: 'Zapisz transakcję', exact: true })
    .click();
  try {
    await expect(
      page.getByRole('button', { name: 'Zapisywanie…', exact: true }),
    ).toBeDisabled();
    await page
      .getByRole('form', { name: 'Nowa transakcja', exact: true })
      .evaluate((form: HTMLFormElement) => {
        form.requestSubmit();
        form.requestSubmit();
      });
    expect(posts).toBe(1);
  } finally {
    release();
  }
  await expect(
    page.getByText('Wydatek zapisany.', { exact: true }),
  ).toBeVisible();
  await expectTotal(page, 1);
});

test('redirects to login when the session expires before saving', async ({
  page,
  accounts,
}) => {
  const account = await accounts.register();
  await login(page, account);
  await openTransactions(page);
  await fillTransaction(page);
  await accounts.expireSessions(account);
  const response = page.waitForResponse(
    (item) =>
      new URL(item.url()).pathname === '/transactions' &&
      item.request().method() === 'POST',
  );
  await page
    .getByRole('button', { name: 'Zapisz transakcję', exact: true })
    .click();
  expect((await response).status()).toBe(401);
  await expect(page).toHaveURL(/\/login$/);
});

test('validates fields and supports keyboard submission on a narrow screen', async ({
  page,
  accounts,
}, testInfo) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await login(page, await accounts.register());
  await openTransactions(page);
  await page
    .getByRole('button', { name: 'Zapisz transakcję', exact: true })
    .click();
  await expect(page.getByLabel('Kwota', { exact: true })).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await expect(page.getByLabel('Kwota', { exact: true })).toBeFocused();
  await expectTotal(page, 0);
  await fillTransaction(page, false, '0,10');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('transactions-mobile.png'),
    fullPage: true,
  });
  await page.getByLabel('Notatka (opcjonalnie)', { exact: true }).press('Tab');
  await expect(
    page.getByRole('button', { name: 'Zapisz transakcję', exact: true }),
  ).toBeFocused();
  await page
    .getByRole('button', { name: 'Zapisz transakcję', exact: true })
    .press('Enter');
  await expect(
    page.getByText('Wydatek zapisany.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('-0,10 zł', { exact: true })).toBeVisible();
});
