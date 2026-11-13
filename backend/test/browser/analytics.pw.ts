import type { Page } from '@playwright/test';
import { login, logout } from './actions.js';
import { API_URL, FRONTEND_URL, test, expect } from './fixtures.js';

function monthRange(previous = false) {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Europe/Warsaw',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date());
  let year = Number(parts.find((part) => part.type === 'year')!.value);
  let month =
    Number(parts.find((part) => part.type === 'month')!.value) -
    (previous ? 1 : 0);
  if (month === 0) {
    month = 12;
    year--;
  }
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  return {
    from: prefix + '-01',
    to: `${prefix}-${new Date(Date.UTC(year, month, 0)).getUTCDate()}`,
  };
}
const summary = (page: Page) =>
  page.getByRole('region', { name: 'Podsumowanie okresu', exact: true });
async function expectCards(page: Page, values: string[]) {
  await expect(summary(page).locator('dd')).toHaveText(values);
}
async function seed(
  page: Page,
  type: 'INCOME' | 'EXPENSE',
  amount: string,
  day: string,
  title = 'Operacja raportu',
  transport = false,
) {
  const response = await page.request.post(API_URL + '/transactions', {
    headers: { Origin: FRONTEND_URL },
    data: {
      type,
      amount,
      title,
      occurredOn: day,
      categoryId:
        type === 'INCOME'
          ? '10000000-0000-4000-8000-000000000005'
          : transport
            ? '10000000-0000-4000-8000-000000000002'
            : '10000000-0000-4000-8000-000000000001',
    },
  });
  expect(response.status()).toBe(201);
}
async function openAnalytics(page: Page) {
  await page.getByRole('link', { name: 'Analityka', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Analityka', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Analityka', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
}
async function applyCustom(
  page: Page,
  from: string,
  to: string,
  granularity = 'day',
) {
  const form = page.getByRole('form', { name: 'Filtry analityki' });
  await form.getByRole('button', { name: 'Własny zakres' }).click();
  await form.getByLabel('Data od', { exact: true }).fill(from);
  await form.getByLabel('Data do', { exact: true }).fill(to);
  await form.getByLabel('Podział trendu').selectOption(granularity);
  await form.getByRole('button', { name: 'Zastosuj' }).click();
}

test('shows real reports, both charts, presets, custom months and empty periods', async ({
  page,
  accounts,
}) => {
  const account = await accounts.register();
  const range = monthRange();
  await login(page, account);
  const wallet = await page.request.patch(API_URL + '/wallet', {
    headers: { Origin: FRONTEND_URL },
    data: { openingBalance: '100.00' },
  });
  expect(wallet.status()).toBe(200);
  await seed(page, 'INCOME', '50.20', range.from);
  await seed(page, 'EXPENSE', '15.10', range.from);
  await seed(page, 'EXPENSE', '5.00', range.to, 'Bilet', true);
  await seed(page, 'INCOME', '7.00', monthRange(true).from);
  await openAnalytics(page);
  await expectCards(page, ['50,20 zł', '20,10 zł', '30,10 zł']);
  await expect(
    page
      .getByRole('figure', { name: 'Wykres wydatków według kategorii' })
      .locator('.recharts-bar-rectangle'),
  ).toHaveCount(2);
  await expect(
    page
      .getByRole('figure', { name: 'Wykres trendu przychodów i wydatków' })
      .locator('.recharts-line-curve'),
  ).toHaveCount(2);
  await page.screenshot({
    path: '/tmp/finance-analytics-desktop.png',
    fullPage: true,
  });
  await page.getByText('Pokaż dane kategorii', { exact: true }).click();
  const table = page.getByRole('table', { name: /Wydatki według kategorii/ });
  await expect(table.getByRole('row', { name: /Jedzenie/ })).toContainText(
    '15,10 zł',
  );
  await expect(table.getByRole('row', { name: /Transport/ })).toContainText(
    '5,00 zł',
  );
  await page.getByRole('button', { name: 'Poprzedni miesiąc' }).click();
  await expectCards(page, ['7,00 zł', '0,00 zł', '7,00 zł']);
  await applyCustom(page, range.from, range.from, 'month');
  await expectCards(page, ['50,20 zł', '15,10 zł', '35,10 zł']);
  await page.getByText('Pokaż dane trendu', { exact: true }).click();
  const trends = page.getByRole('table', {
    name: /Przychody i wydatki w czasie/,
  });
  await expect(trends.locator('tbody tr')).toHaveCount(1);
  await expect(trends.locator('tbody')).toContainText('35,10 zł');
  await applyCustom(page, '2024-01-01', '2025-01-01');
  await expect(
    page.getByRole('form', { name: 'Filtry analityki' }).getByRole('alert'),
  ).toContainText('366 dni');
  await expectCards(page, ['50,20 zł', '15,10 zł', '35,10 zł']);
  await applyCustom(page, '2020-07-01', '2020-07-02');
  await expectCards(page, ['0,00 zł', '0,00 zł', '0,00 zł']);
  await expect(
    page.getByText('Brak wydatków w wybranym okresie.'),
  ).toBeVisible();
  await page.getByText('Pokaż dane trendu', { exact: true }).click();
  await expect(trends.locator('tbody tr')).toHaveCount(2);
});

test('retains successful reports and retries only a failed category read', async ({
  page,
  accounts,
}) => {
  const account = await accounts.register();
  await login(page, account);
  await seed(page, 'INCOME', '50.20', monthRange().from);
  await seed(page, 'EXPENSE', '20.10', monthRange().from);
  let failing = true;
  const reads = { summary: 0, categories: 0, trends: 0 };
  page.on('request', (request) => {
    const match = new URL(request.url()).pathname.match(
      /^\/analytics\/(summary|categories|trends)$/,
    );
    if (match) reads[match[1] as keyof typeof reads]++;
  });
  await page.route(/\/analytics\/categories\?/, async (route) =>
    failing ? route.abort('failed') : route.continue(),
  );
  await openAnalytics(page);
  await expectCards(page, ['50,20 zł', '20,10 zł', '30,10 zł']);
  await expect(
    page.getByRole('button', { name: 'Ponów kategorie' }),
  ).toBeVisible();
  await expect(
    page.getByRole('figure', { name: 'Wykres trendu przychodów i wydatków' }),
  ).toBeVisible();
  const before = { ...reads };
  failing = false;
  await page.getByRole('button', { name: 'Ponów kategorie' }).click();
  await expect(
    page.getByRole('figure', { name: 'Wykres wydatków według kategorii' }),
  ).toBeVisible();
  expect(reads).toEqual({ ...before, categories: before.categories + 1 });
});

test('ignores a delayed obsolete response after switching months rapidly', async ({
  page,
  accounts,
}) => {
  const account = await accounts.register();
  await login(page, account);
  await seed(page, 'INCOME', '50.20', monthRange().from);
  await seed(page, 'INCOME', '7.00', monthRange(true).from);
  await openAnalytics(page);
  await expectCards(page, ['50,20 zł', '0,00 zł', '50,20 zł']);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let arrived!: () => void;
  const started = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  let finish!: () => void;
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  await page.route(/\/analytics\/summary\?/, async (route) => {
    if (
      new URL(route.request().url()).searchParams.get('from') !==
      monthRange(true).from
    )
      return route.continue();
    try {
      const response = await route.fetch();
      arrived();
      await gate;
      await route.fulfill({ response });
    } finally {
      finish();
    }
  });
  try {
    await page.getByRole('button', { name: 'Poprzedni miesiąc' }).click();
    await started;
    await expect(summary(page).getByRole('status')).toHaveText(
      'Pobieranie podsumowania…',
    );
    await page.getByRole('button', { name: 'Bieżący miesiąc' }).click();
    await expectCards(page, ['50,20 zł', '0,00 zł', '50,20 zł']);
    release();
    await finished;
    await expectCards(page, ['50,20 zł', '0,00 zł', '50,20 zł']);
  } finally {
    release();
  }
});

test('refreshes analytics after editing and deleting a transaction and returning with Back', async ({
  page,
  accounts,
}) => {
  const account = await accounts.register();
  await login(page, account);
  await seed(page, 'INCOME', '50.20', monthRange().from);
  await seed(page, 'EXPENSE', '20.10', monthRange().from, 'Koszt raportu');
  await openAnalytics(page);
  await expectCards(page, ['50,20 zł', '20,10 zł', '30,10 zł']);
  await applyCustom(page, monthRange().from, monthRange().to, 'month');
  await expectCards(page, ['50,20 zł', '20,10 zł', '30,10 zł']);
  await page.getByRole('link', { name: 'Transakcje', exact: true }).click();
  await page
    .getByRole('button', { name: 'Edytuj: Koszt raportu', exact: true })
    .click();
  const edit = page.getByRole('dialog', { name: 'Edycja transakcji' });
  await edit.getByLabel('Kwota', { exact: true }).fill('30,10');
  await edit
    .getByRole('button', { name: 'Zapisz zmiany', exact: true })
    .click();
  await expect(
    page.getByText('Transakcja zaktualizowana.', { exact: true }),
  ).toBeVisible();
  await page.goBack();
  await expectCards(page, ['50,20 zł', '30,10 zł', '20,10 zł']);
  await expect(page.getByLabel('Podział trendu')).toHaveValue('month');
  await page.goForward();
  await page
    .getByRole('button', { name: 'Usuń: Koszt raportu', exact: true })
    .click();
  await page
    .getByRole('dialog', { name: 'Usunąć transakcję?' })
    .getByRole('button', { name: 'Usuń transakcję', exact: true })
    .click();
  await expect(
    page.getByText('Transakcja usunięta.', { exact: true }),
  ).toBeVisible();
  await page.goBack();
  await expectCards(page, ['50,20 zł', '0,00 zł', '50,20 zł']);
  await expect(
    page.getByText('Brak wydatków w wybranym okresie.'),
  ).toBeVisible();
});

test('isolates analytics across account changes and refreshes after returning to the first account', async ({
  page,
  accounts,
}) => {
  const a = await accounts.register();
  const b = await accounts.register();
  await login(page, a);
  await seed(page, 'INCOME', '50.20', monthRange().from);
  await openAnalytics(page);
  await expectCards(page, ['50,20 zł', '0,00 zł', '50,20 zł']);
  await logout(page);
  await login(page, b);
  await openAnalytics(page);
  await expectCards(page, ['0,00 zł', '0,00 zł', '0,00 zł']);
  await expect(summary(page).getByText('50,20 zł')).toHaveCount(0);
  await logout(page);
  await login(page, a);
  await openAnalytics(page);
  await expectCards(page, ['50,20 zł', '0,00 zł', '50,20 zł']);
});

test('protects the route and redirects after session expiration during a filter change', async ({
  page,
  accounts,
}) => {
  await page.goto('/dashboard/analytics');
  await expect(page).toHaveURL(/\/login$/);
  const account = await accounts.register();
  await login(page, account);
  await openAnalytics(page);
  await expectCards(page, ['0,00 zł', '0,00 zł', '0,00 zł']);
  await accounts.expireSessions(account);
  await page.getByRole('button', { name: 'Poprzedni miesiąc' }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test('keeps charts, exact large amounts and keyboard filters usable at 375 px', async ({
  page,
  accounts,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const account = await accounts.register();
  await login(page, account);
  for (let i = 0; i < 3; i++)
    await seed(page, 'INCOME', '999999999999.99', monthRange().from);
  await seed(page, 'EXPENSE', '0.10', monthRange().to);
  await openAnalytics(page);
  await expectCards(page, [
    '2 999 999 999 999,97 zł',
    '0,10 zł',
    '2 999 999 999 999,87 zł',
  ]);
  await expect(
    page
      .getByRole('figure', { name: 'Wykres trendu przychodów i wydatków' })
      .locator('.recharts-line-curve'),
  ).toHaveCount(2);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(375);
  await page.screenshot({
    path: '/tmp/finance-analytics-mobile.png',
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Własny zakres' }).click();
  await page.getByLabel('Data od', { exact: true }).fill(monthRange().from);
  await page.getByLabel('Data do', { exact: true }).fill(monthRange().to);
  await page.getByLabel('Podział trendu').selectOption('month');
  await page.getByRole('button', { name: 'Zastosuj' }).focus();
  await page.keyboard.press('Enter');
  await expectCards(page, [
    '2 999 999 999 999,97 zł',
    '0,10 zł',
    '2 999 999 999 999,87 zł',
  ]);
  const toggle = page.getByText('Pokaż dane trendu', { exact: true });
  await toggle.focus();
  await page.keyboard.press('Enter');
  const table = page.getByRole('table', {
    name: /Przychody i wydatki w czasie/,
  });
  await expect(table.locator('tbody tr')).toHaveCount(1);
  await expect(
    table.getByText('2 999 999 999 999,97 zł', { exact: true }),
  ).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(375);
});
