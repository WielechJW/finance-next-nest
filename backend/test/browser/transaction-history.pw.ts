import type { Page } from '@playwright/test';
import { login, logout, saveWallet } from './actions.js';
import { API_URL, FRONTEND_URL, test, expect } from './fixtures.js';

const history = (page: Page) =>
  page.getByRole('region', { name: 'Historia transakcji', exact: true });
const balance = (page: Page) =>
  page.getByRole('region', { name: 'Saldo portfela', exact: true });

async function createOperation(
  page: Page,
  changes: Record<string, string> = {},
) {
  const response = await page.request.post(API_URL + '/transactions', {
    headers: { Origin: FRONTEND_URL },
    data: {
      type: 'EXPENSE',
      categoryId: '10000000-0000-4000-8000-000000000001',
      amount: '1.00',
      title: 'Operacja testowa',
      occurredOn: '2026-11-12',
      ...changes,
    },
  });
  expect(response.status()).toBe(201);
}

async function seedHistory(page: Page) {
  await Promise.all(
    Array.from({ length: 21 }, (_, index) =>
      createOperation(page, {
        title: 'Wydatek ' + String(index + 1).padStart(2, '0'),
        occurredOn: '2026-11-' + String(index + 1).padStart(2, '0'),
      }),
    ),
  );
  await createOperation(page, {
    type: 'INCOME',
    categoryId: '10000000-0000-4000-8000-000000000005',
    title: 'Wypłata listopadowa',
    amount: '50.20',
  });
  await createOperation(page, {
    categoryId: '10000000-0000-4000-8000-000000000002',
    title: 'Bilet grudniowy',
    amount: '4.50',
    occurredOn: '2026-12-01',
  });
}

async function openHistory(page: Page) {
  await page.getByRole('link', { name: 'Transakcje', exact: true }).click();
  await expect(
    history(page).getByRole('heading', {
      name: 'Historia transakcji',
      exact: true,
    }),
  ).toBeVisible();
}

test('paginates and combines inclusive filters while keeping the global balance unchanged', async ({
  page,
  accounts,
}, testInfo) => {
  await login(page, await accounts.register());
  await saveWallet(page, 'Portfel z historią', '100,00');
  await seedHistory(page);
  await openHistory(page);
  await expect(history(page).getByRole('status')).toContainText(
    'Liczba wyników: 23. Strona 1 z 2.',
  );
  await expect(history(page).getByRole('listitem')).toHaveCount(20);
  await expect(
    history(page).getByText('+50,20 zł', { exact: true }),
  ).toBeVisible();
  await expect(
    history(page).getByText('-4,50 zł', { exact: true }),
  ).toBeVisible();
  await expect(
    balance(page).getByText('124,70 zł', { exact: true }),
  ).toBeVisible();
  await history(page)
    .getByRole('button', { name: 'Następna strona', exact: true })
    .click();
  await expect(history(page).getByRole('status')).toContainText(
    'Strona 2 z 2.',
  );
  await expect(history(page).getByRole('listitem')).toHaveCount(3);
  await expect(
    history(page).getByText('Wydatek 01', { exact: true }),
  ).toBeVisible();
  await page.getByLabel('Filtr typu', { exact: true }).selectOption('EXPENSE');
  await page
    .getByLabel('Filtr kategorii', { exact: true })
    .selectOption({ label: 'Jedzenie' });
  await page.getByLabel('Data od', { exact: true }).fill('2026-11-01');
  await page.getByLabel('Data do', { exact: true }).fill('2026-11-05');
  await history(page)
    .getByRole('button', { name: 'Filtruj', exact: true })
    .click();
  await expect(history(page).getByRole('status')).toContainText(
    'Liczba wyników: 5. Strona 1 z 1.',
  );
  await expect(history(page).getByRole('listitem')).toHaveCount(5);
  await expect(
    history(page).getByText('Wydatek 01', { exact: true }),
  ).toBeVisible();
  await expect(
    history(page).getByText('Wydatek 05', { exact: true }),
  ).toBeVisible();
  await expect(
    balance(page).getByText('124,70 zł', { exact: true }),
  ).toBeVisible();
  await history(page).screenshot({
    path: testInfo.outputPath('history-desktop.png'),
  });
  await history(page)
    .getByRole('button', { name: 'Wyczyść filtry', exact: true })
    .click();
  await expect(history(page).getByRole('status')).toContainText(
    'Liczba wyników: 23. Strona 1 z 2.',
  );
});

test('refreshes from the first page after a save while retaining filters that exclude the new entry', async ({
  page,
  accounts,
}) => {
  await login(page, await accounts.register());
  await saveWallet(page, 'Portfel z filtrem', '100,00');
  await seedHistory(page);
  await openHistory(page);
  await page.getByLabel('Filtr typu', { exact: true }).selectOption('EXPENSE');
  await page
    .getByLabel('Filtr kategorii', { exact: true })
    .selectOption({ label: 'Jedzenie' });
  await history(page)
    .getByRole('button', { name: 'Filtruj', exact: true })
    .click();
  await expect(history(page).getByRole('status')).toContainText(
    'Liczba wyników: 21. Strona 1 z 2.',
  );
  await history(page)
    .getByRole('button', { name: 'Następna strona', exact: true })
    .click();
  await expect(history(page).getByRole('status')).toContainText(
    'Strona 2 z 2.',
  );
  await page.getByLabel('Typ operacji', { exact: true }).selectOption('INCOME');
  await page
    .getByLabel('Kategoria', { exact: true })
    .selectOption({ label: 'Wynagrodzenie' });
  await page.getByLabel('Kwota', { exact: true }).fill('5,00');
  await page.getByLabel('Tytuł', { exact: true }).fill('Nowy przychód');
  await page.getByLabel('Data operacji', { exact: true }).fill('9999-12-31');
  await page
    .getByRole('button', { name: 'Zapisz transakcję', exact: true })
    .click();
  await expect(
    page.getByText('Przychód zapisany.', { exact: true }),
  ).toBeVisible();
  await expect(history(page).getByRole('status')).toContainText(
    'Liczba wyników: 21. Strona 1 z 2.',
  );
  await expect(
    history(page).getByText('Nowy przychód', { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByLabel('Filtr typu', { exact: true })).toHaveValue(
    'EXPENSE',
  );
  await expect(
    balance(page).getByText('129,70 zł', { exact: true }),
  ).toBeVisible();
});

test('retries only history after a failed GET following a confirmed save', async ({
  page,
  accounts,
}) => {
  await login(page, await accounts.register());
  await openHistory(page);
  await expect(
    history(page).getByText(
      'Nie masz jeszcze transakcji. Dodaj pierwszy przychód lub wydatek.',
      { exact: true },
    ),
  ).toBeVisible();
  let fail = true;
  let posts = 0;
  await page.route(API_URL + '/transactions*', async (route) => {
    if (route.request().method() === 'POST') posts += 1;
    if (route.request().method() === 'GET' && fail) {
      fail = false;
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        headers: {
          'Access-Control-Allow-Origin': FRONTEND_URL,
          'Access-Control-Allow-Credentials': 'true',
        },
        body: JSON.stringify({ message: 'Testowy błąd historii.' }),
      });
    } else await route.continue();
  });
  await page
    .getByLabel('Kategoria', { exact: true })
    .selectOption({ label: 'Jedzenie' });
  await page.getByLabel('Kwota', { exact: true }).fill('12,50');
  await page.getByLabel('Tytuł', { exact: true }).fill('Zapisana operacja');
  await page
    .getByRole('button', { name: 'Zapisz transakcję', exact: true })
    .click();
  await expect(
    page.getByText('Wydatek zapisany.', { exact: true }),
  ).toBeVisible();
  await history(page)
    .getByRole('button', { name: 'Ponów pobieranie historii', exact: true })
    .click();
  await expect(
    history(page).getByText('Zapisana operacja', { exact: true }),
  ).toBeVisible();
  expect(posts).toBe(1);
});

test('redirects to login when the session expires before applying a history filter', async ({
  page,
  accounts,
}) => {
  const account = await accounts.register();
  await login(page, account);
  await openHistory(page);
  await expect(history(page).getByRole('status')).toContainText(
    'Liczba wyników: 0.',
  );
  await page.getByLabel('Filtr typu', { exact: true }).selectOption('INCOME');
  await accounts.expireSessions(account);
  const response = page.waitForResponse(
    (item) =>
      new URL(item.url()).pathname === '/transactions' &&
      item.request().method() === 'GET',
  );
  await history(page)
    .getByRole('button', { name: 'Filtruj', exact: true })
    .click();
  expect((await response).status()).toBe(401);
  await expect(page).toHaveURL(/\/login$/);
});

test('keeps calendar dates and filter controls readable on a narrow screen', async ({
  page,
  accounts,
}, testInfo) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await login(page, await accounts.register());
  await seedHistory(page);
  await openHistory(page);
  await expect(history(page).getByRole('listitem')).toHaveCount(20);
  await page.getByLabel('Data od', { exact: true }).fill('2026-11-05');
  await page.getByLabel('Data do', { exact: true }).fill('2026-11-01');
  await history(page)
    .getByRole('button', { name: 'Filtruj', exact: true })
    .click();
  await expect(page.getByLabel('Data do', { exact: true })).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await expect(page.getByLabel('Data do', { exact: true })).toBeFocused();
  await page.getByLabel('Data od', { exact: true }).fill('2026-11-01');
  await page.getByLabel('Data do', { exact: true }).fill('2026-11-02');
  await history(page)
    .getByRole('button', { name: 'Filtruj', exact: true })
    .focus();
  await history(page)
    .getByRole('button', { name: 'Filtruj', exact: true })
    .press('Enter');
  await expect(history(page).getByRole('listitem')).toHaveCount(2);
  await expect(
    history(page).getByText('01.11.2026', { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await history(page).screenshot({
    path: testInfo.outputPath('history-mobile.png'),
  });
});

test('shows the empty history of account B after signing out of account A', async ({
  page,
  accounts,
}) => {
  const a = await accounts.register();
  const b = await accounts.register();
  await login(page, a);
  await createOperation(page, { title: 'Operacja prywatna A' });
  await openHistory(page);
  await expect(
    history(page).getByText('Operacja prywatna A', { exact: true }),
  ).toBeVisible();
  await logout(page);
  await login(page, b);
  await openHistory(page);
  await expect(
    history(page).getByRole('link', {
      name: 'Dodaj pierwszą transakcję',
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText('Operacja prywatna A', { exact: true }),
  ).toHaveCount(0);
});
