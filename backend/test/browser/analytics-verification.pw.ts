import type { Page } from '@playwright/test';
import {
  ANALYTICS_ACCOUNT_A,
  ANALYTICS_ACCOUNT_B,
  ANALYTICS_STEPS,
  SCENARIO_PERIODS,
  scenarioDaily,
  scenarioMonthly,
  scenarioInput,
  type ScenarioAccount,
  type ScenarioExpectation,
  type ScenarioPeriod,
} from '../support/analytics-scenario.js';
import { fillCredentials, login, logout, saveWallet } from './actions.js';
import { API_URL, FRONTEND_URL, test, expect } from './fixtures.js';

const money = (value: string) => value.replace('.', ',') + ' zł';
function dateLabel(value: string) {
  const [year, month, day] = value.split('-');
  return day ? `${day}.${month}.${year}` : `${month}.${year}`;
}

async function seedTransactions(page: Page, scenario: ScenarioAccount) {
  for (const entry of scenario.entries) {
    const response = await page.request.post(API_URL + '/transactions', {
      headers: { Origin: FRONTEND_URL },
      data: scenarioInput(entry),
    });
    expect(response.status()).toBe(201);
  }
  // Fixture writes bypass React's mutation callbacks. Mount a fresh view
  // before comparing UI values with the newly populated history.
  await page.reload();
}

async function expectWalletUI(page: Page, expected: ScenarioExpectation) {
  await page.getByRole('link', { name: 'Portfel', exact: true }).click();
  await expect(
    page
      .getByRole('region', { name: 'Podsumowanie portfela', exact: true })
      .locator('dd'),
  ).toHaveText([money(expected.balance), money(expected.openingBalance)]);
}

async function openTable(page: Page, name: 'kategorii' | 'trendu') {
  const toggle = page.getByText(`Pokaż dane ${name}`, { exact: true });
  await expect(toggle).toBeVisible();
  if ((await toggle.locator('..').getAttribute('open')) === null)
    await toggle.click();
  return page
    .getByRole('region', {
      name: name === 'kategorii' ? 'Tabela kategorii' : 'Tabela trendu',
      exact: true,
    })
    .getByRole('table');
}

async function expectReportUI(
  page: Page,
  expected: ScenarioExpectation,
  period: ScenarioPeriod,
  granularity: 'day' | 'month',
) {
  const range = SCENARIO_PERIODS[period];
  const fixed = expected.periods[period];
  if (new URL(page.url()).pathname !== '/dashboard/analytics')
    await page.getByRole('link', { name: 'Analityka', exact: true }).click();
  const form = page.getByRole('form', {
    name: 'Filtry analityki',
    exact: true,
  });
  await form.getByRole('button', { name: 'Własny zakres' }).click();
  await form.getByLabel('Data od', { exact: true }).fill(range.from);
  await form.getByLabel('Data do', { exact: true }).fill(range.to);
  await form
    .getByLabel('Podział trendu', { exact: true })
    .selectOption(granularity);
  await form.getByRole('button', { name: 'Zastosuj', exact: true }).click();
  await expect(page).toHaveURL(
    new RegExp(`from=${range.from}&to=${range.to}&granularity=${granularity}$`),
  );
  await expect(
    page
      .getByRole('region', { name: 'Podsumowanie okresu', exact: true })
      .locator('dd'),
  ).toHaveText([
    money(fixed.income),
    money(fixed.expenses),
    money(fixed.periodResult),
  ]);

  const categories = page.getByRole('region', {
    name: 'Wydatki według kategorii',
    exact: true,
  });
  if (fixed.categories.length) {
    const table = await openTable(page, 'kategorii');
    await expect(table.locator('caption')).toContainText(
      `${dateLabel(range.from)} – ${dateLabel(range.to)}`,
    );
    const rows = table.locator('tbody tr');
    await expect(rows).toHaveCount(fixed.categories.length);
    for (const [index, category] of fixed.categories.entries()) {
      await expect(rows.nth(index).locator('th, td')).toHaveText([
        category.categoryName,
        money(category.amount),
        category.percentage.replace('.', ',') + '%',
      ]);
    }
    await expect(
      categories.getByText(`Łącznie: ${money(fixed.expenses)}`),
    ).toBeVisible();
  } else {
    await expect(
      categories.getByText('Brak wydatków w wybranym okresie.', {
        exact: true,
      }),
    ).toBeVisible();
  }

  const table = await openTable(page, 'trendu');
  await expect(table.locator('caption')).toContainText(
    `${dateLabel(range.from)} – ${dateLabel(range.to)}`,
  );
  const points =
    granularity === 'day'
      ? scenarioDaily(expected, period)
      : scenarioMonthly(expected, period);
  const rows = table.locator('tbody tr');
  await expect(rows).toHaveCount(points.length);
  for (const [index, point] of points.entries()) {
    await expect(rows.nth(index).locator('th, td')).toHaveText([
      dateLabel(point.period),
      money(point.income),
      money(point.expenses),
      money(point.periodResult),
    ]);
  }
}

test('verifies registration, both wallets and all analytics periods against one independent shared fixture', async ({
  page,
  browser,
  accounts,
}) => {
  test.setTimeout(90000);
  const a = accounts.newAccount();
  const b = await accounts.register();
  await page.goto('/register');
  await fillCredentials(page, a);
  await page.getByLabel('Powtórz hasło', { exact: true }).fill(a.password);
  await page
    .getByRole('button', { name: 'Zarejestruj się', exact: true })
    .click();
  await expect(page).toHaveURL(/\/login\?registered=1$/);
  await login(page, a);
  await saveWallet(
    page,
    'Portfel weryfikacji A',
    ANALYTICS_ACCOUNT_A.openingBalance,
  );
  await seedTransactions(page, ANALYTICS_ACCOUNT_A);

  const contextB = await browser.newContext({ baseURL: FRONTEND_URL });
  try {
    const pageB = await contextB.newPage();
    await login(pageB, b);
    await saveWallet(
      pageB,
      'Portfel weryfikacji B',
      ANALYTICS_ACCOUNT_B.openingBalance,
    );
    await seedTransactions(pageB, ANALYTICS_ACCOUNT_B);
    for (const [currentPage, expected] of [
      [page, ANALYTICS_ACCOUNT_A.expected],
      [pageB, ANALYTICS_ACCOUNT_B.expected],
    ] as const) {
      await expectWalletUI(currentPage, expected);
      for (const period of Object.keys(SCENARIO_PERIODS) as ScenarioPeriod[]) {
        for (const granularity of ['day', 'month'] as const)
          await expectReportUI(currentPage, expected, period, granularity);
      }
    }

    await page.getByRole('link', { name: 'Portfel', exact: true }).click();
    await saveWallet(page, 'Portfel weryfikacji A', '-200.00');
    const openingChanged = {
      ...ANALYTICS_ACCOUNT_A.expected,
      openingBalance: '-200.00',
      balance: '-158.90',
    };
    await expectWalletUI(page, openingChanged);
    await expectReportUI(page, openingChanged, 'full', 'month');
    await expectReportUI(page, openingChanged, 'january', 'day');
    await logout(page);
    await page.goto('/dashboard/analytics');
    await expect(page).toHaveURL(/\/login$/);
    await expectWalletUI(pageB, ANALYTICS_ACCOUNT_B.expected);
    await expectReportUI(pageB, ANALYTICS_ACCOUNT_B.expected, 'full', 'month');
  } finally {
    await contextB.close();
  }
});

test('keeps cards, categories, day/month tables and global balances consistent through the complete mutation lifecycle', async ({
  page,
  browser,
  accounts,
}) => {
  test.setTimeout(120000);
  const a = await accounts.register();
  const b = await accounts.register();
  await login(page, a);
  await saveWallet(
    page,
    'Portfel mutacji A',
    ANALYTICS_ACCOUNT_A.openingBalance,
  );
  await seedTransactions(page, ANALYTICS_ACCOUNT_A);
  const contextB = await browser.newContext({ baseURL: FRONTEND_URL });
  try {
    const pageB = await contextB.newPage();
    await login(pageB, b);
    await saveWallet(
      pageB,
      'Portfel mutacji B',
      ANALYTICS_ACCOUNT_B.openingBalance,
    );
    await seedTransactions(pageB, ANALYTICS_ACCOUNT_B);
    await expectWalletUI(page, ANALYTICS_ACCOUNT_A.expected);
    await expectReportUI(page, ANALYTICS_ACCOUNT_A.expected, 'full', 'month');

    for (const step of ANALYTICS_STEPS) {
      await test.step(step.name, async () => {
        await page
          .getByRole('link', { name: 'Transakcje', exact: true })
          .click();
        const title = ANALYTICS_ACCOUNT_A.entries.find(
          (entry) => entry.key === step.key,
        )!.title;
        if (step.patch) {
          await page
            .getByRole('button', { name: 'Edytuj: ' + title, exact: true })
            .click();
          const dialog = page.getByRole('dialog', {
            name: 'Edycja transakcji',
            exact: true,
          });
          if (step.patch.type)
            await dialog
              .getByLabel('Typ operacji', { exact: true })
              .selectOption(step.patch.type);
          if (step.patch.amount)
            await dialog
              .getByLabel('Kwota', { exact: true })
              .fill(step.patch.amount.replace('.', ','));
          if (step.patch.categoryId)
            await dialog
              .getByLabel('Kategoria', { exact: true })
              .selectOption(step.patch.categoryId);
          if (step.patch.occurredOn)
            await dialog
              .getByLabel('Data operacji', { exact: true })
              .fill(step.patch.occurredOn);
          await dialog
            .getByRole('button', { name: 'Zapisz zmiany', exact: true })
            .click();
          await expect(
            page.getByText('Transakcja zaktualizowana.', { exact: true }),
          ).toBeVisible();
        } else {
          await page
            .getByRole('button', { name: 'Usuń: ' + title, exact: true })
            .click();
          await page
            .getByRole('dialog', { name: 'Usunąć transakcję?', exact: true })
            .getByRole('button', { name: 'Usuń transakcję', exact: true })
            .click();
          await expect(
            page.getByText('Transakcja usunięta.', { exact: true }),
          ).toBeVisible();
        }
        await expectWalletUI(page, step.expected);
        await expectReportUI(page, step.expected, 'full', 'month');
        await expectReportUI(page, step.expected, 'january', 'month');
        await expectReportUI(page, step.expected, 'february', 'month');
        await expectReportUI(page, step.expected, 'leap', 'day');
        await expectWalletUI(pageB, ANALYTICS_ACCOUNT_B.expected);
        await expectReportUI(
          pageB,
          ANALYTICS_ACCOUNT_B.expected,
          'full',
          'month',
        );
      });
    }
  } finally {
    await contextB.close();
  }
});
