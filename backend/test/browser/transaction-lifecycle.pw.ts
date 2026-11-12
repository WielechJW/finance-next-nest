import type { Page } from '@playwright/test';
import { expectWallet, login, logout, saveWallet } from './actions.js';
import { test, expect } from './fixtures.js';

const history = (page: Page) =>
  page.getByRole('region', { name: 'Historia transakcji', exact: true });
const balance = (page: Page) =>
  page.getByRole('region', { name: 'Saldo portfela', exact: true });

async function openTransactions(page: Page) {
  await page.getByRole('link', { name: 'Transakcje', exact: true }).click();
  await expect(
    page.getByRole('form', { name: 'Nowa transakcja', exact: true }),
  ).toBeVisible();
}

async function addTransaction(
  page: Page,
  type: 'INCOME' | 'EXPENSE',
  amount: string,
  title: string,
  occurredOn: string,
) {
  const form = page.getByRole('form', { name: 'Nowa transakcja', exact: true });
  await form.getByLabel('Typ operacji', { exact: true }).selectOption(type);
  await form
    .getByLabel('Kategoria', { exact: true })
    .selectOption({ label: type === 'INCOME' ? 'Wynagrodzenie' : 'Jedzenie' });
  await form.getByLabel('Kwota', { exact: true }).fill(amount);
  await form.getByLabel('Tytuł', { exact: true }).fill(title);
  await form.getByLabel('Data operacji', { exact: true }).fill(occurredOn);
  await form
    .getByRole('button', { name: 'Zapisz transakcję', exact: true })
    .click();
  await expect(
    page.getByText(
      type === 'INCOME' ? 'Przychód zapisany.' : 'Wydatek zapisany.',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    history(page).getByRole('heading', { name: title, exact: true }),
  ).toBeVisible();
}

async function filterExpenses(page: Page) {
  await page.getByLabel('Filtr typu', { exact: true }).selectOption('EXPENSE');
  await page.getByLabel('Data od', { exact: true }).fill('2024-02-01');
  await page.getByLabel('Data do', { exact: true }).fill('2024-02-29');
  await history(page)
    .getByRole('button', { name: 'Filtruj', exact: true })
    .click();
  await expect(history(page).getByRole('listitem')).toHaveCount(1);
}

test('runs the complete wallet lifecycle through the UI and preserves it across reloads and account switches', async ({
  page,
  accounts,
}) => {
  const a = await accounts.register();
  const b = await accounts.register();
  await login(page, a);

  await test.step('set the opening balance and add both directions with exact cents', async () => {
    await saveWallet(page, 'Portfel pełnego scenariusza', '100,00');
    await openTransactions(page);
    await expect(
      balance(page).getByText('100,00 zł', { exact: true }),
    ).toBeVisible();
    await addTransaction(
      page,
      'INCOME',
      '50,20',
      'Wypłata scenariusza',
      '2024-02-01',
    );
    await expect(
      balance(page).getByText('150,20 zł', { exact: true }),
    ).toBeVisible();
    await addTransaction(
      page,
      'EXPENSE',
      '20,10',
      'Zakupy scenariusza',
      '2024-02-29',
    );
    await expect(
      balance(page).getByText('130,10 zł', { exact: true }),
    ).toBeVisible();
    await expect(history(page).getByRole('listitem')).toHaveCount(2);
  });

  await test.step('filter inclusively, correct the expense and verify the persisted wallet', async () => {
    await filterExpenses(page);
    await expect(
      history(page).getByText('29.02.2024', { exact: true }),
    ).toBeVisible();
    await expect(
      balance(page).getByText('130,10 zł', { exact: true }),
    ).toBeVisible();
    await history(page)
      .getByRole('button', { name: 'Edytuj: Zakupy scenariusza', exact: true })
      .click();
    const dialog = page.getByRole('dialog', {
      name: 'Edycja transakcji',
      exact: true,
    });
    await expect(dialog.getByLabel('Kwota', { exact: true })).toHaveValue(
      '20.10',
    );
    await dialog.getByLabel('Kwota', { exact: true }).fill('30,10');
    await dialog
      .getByRole('button', { name: 'Zapisz zmiany', exact: true })
      .click();
    await expect(
      page.getByText('Transakcja zaktualizowana.', { exact: true }),
    ).toBeVisible();
    await expect(
      history(page).getByText('-30,10 zł', { exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel('Filtr typu', { exact: true })).toHaveValue(
      'EXPENSE',
    );
    await expect(
      balance(page).getByText('120,10 zł', { exact: true }),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Portfel', exact: true }).click();
    await expect(
      page.getByLabel('Saldo początkowe', { exact: true }),
    ).toHaveValue('100,00');
    await expect(page.getByText('120,10 zł', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText('120,10 zł', { exact: true })).toBeVisible();
  });

  await test.step('delete the corrected expense and retain the income and opening balance', async () => {
    await openTransactions(page);
    await filterExpenses(page);
    await history(page)
      .getByRole('button', { name: 'Usuń: Zakupy scenariusza', exact: true })
      .click();
    const confirmation = page.getByRole('dialog', {
      name: 'Usunąć transakcję?',
      exact: true,
    });
    await expect(
      confirmation.getByText('-30,10 zł', { exact: true }),
    ).toBeVisible();
    await confirmation
      .getByRole('button', { name: 'Usuń transakcję', exact: true })
      .click();
    await expect(
      page.getByText('Transakcja usunięta.', { exact: true }),
    ).toBeVisible();
    await expect(
      history(page).getByText('Brak transakcji spełniających wybrane filtry.', {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      balance(page).getByText('150,20 zł', { exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel('Filtr typu', { exact: true })).toHaveValue(
      'EXPENSE',
    );
    await history(page)
      .getByRole('button', { name: 'Wyczyść filtry', exact: true })
      .click();
    await expect(history(page).getByRole('listitem')).toHaveCount(1);
    await expect(
      history(page).getByText('+50,20 zł', { exact: true }),
    ).toBeVisible();
    await expect(
      history(page).getByRole('heading', {
        name: 'Zakupy scenariusza',
        exact: true,
      }),
    ).toHaveCount(0);
    await page.reload();
    await expect(
      balance(page).getByText('150,20 zł', { exact: true }),
    ).toBeVisible();
    await expect(history(page).getByRole('listitem')).toHaveCount(1);
    await page.getByRole('link', { name: 'Portfel', exact: true }).click();
    await expect(
      page.getByLabel('Saldo początkowe', { exact: true }),
    ).toHaveValue('100,00');
    await expect(page.getByText('150,20 zł', { exact: true })).toBeVisible();
  });

  await test.step('switch accounts without leaking history or losing the original ledger', async () => {
    await logout(page);
    await login(page, b);
    await expectWallet(page, {
      name: 'Mój portfel',
      openingBalance: '0,00',
      balanceText: '0,00 zł',
    });
    await openTransactions(page);
    await expect(
      history(page).getByText(
        'Nie masz jeszcze transakcji. Dodaj pierwszy przychód lub wydatek.',
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      history(page).getByRole('heading', {
        name: 'Wypłata scenariusza',
        exact: true,
      }),
    ).toHaveCount(0);
    await logout(page);
    await login(page, a);
    await expect(page.getByText('150,20 zł', { exact: true })).toBeVisible();
    await openTransactions(page);
    await expect(history(page).getByRole('listitem')).toHaveCount(1);
    await expect(
      history(page).getByRole('heading', {
        name: 'Wypłata scenariusza',
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      balance(page).getByText('150,20 zł', { exact: true }),
    ).toBeVisible();
  });
});
