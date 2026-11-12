import type { Page } from '@playwright/test';
import { login, saveWallet } from './actions.js';
import { API_URL, FRONTEND_URL, test, expect } from './fixtures.js';

const expenseCategory = '10000000-0000-4000-8000-000000000001';
const incomeCategory = '10000000-0000-4000-8000-000000000005';
const history = (page: Page) =>
  page.getByRole('region', { name: 'Historia transakcji', exact: true });
const balance = (page: Page) =>
  page.getByRole('region', { name: 'Saldo portfela', exact: true });
const dialog = (page: Page) => page.getByRole('dialog');

async function create(
  page: Page,
  changes: Record<string, string> = {},
): Promise<string> {
  const response = await page.request.post(API_URL + '/transactions', {
    headers: { Origin: FRONTEND_URL },
    data: {
      type: 'EXPENSE',
      categoryId: expenseCategory,
      amount: '12.50',
      title: 'Zakupy do poprawy',
      occurredOn: '2026-11-12',
      note: 'Notatka do wyczyszczenia',
      ...changes,
    },
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

async function open(page: Page) {
  await page.getByRole('link', { name: 'Transakcje', exact: true }).click();
  await expect(history(page).getByRole('listitem').first()).toBeVisible();
}

test('edits every field, clears a note and updates the actual balance and persisted history', async ({
  page,
  accounts,
}) => {
  await login(page, await accounts.register());
  await saveWallet(page, 'Portfel edycji', '100,00');
  const id = await create(page);
  await open(page);
  await history(page)
    .getByRole('button', { name: 'Edytuj: Zakupy do poprawy', exact: true })
    .click();
  await expect(
    dialog(page).getByLabel('Notatka (opcjonalnie)', { exact: true }),
  ).toHaveValue('Notatka do wyczyszczenia');
  await dialog(page)
    .getByLabel('Typ operacji', { exact: true })
    .selectOption('INCOME');
  await expect(
    dialog(page).getByLabel('Kategoria', { exact: true }),
  ).toHaveValue('');
  await dialog(page)
    .getByLabel('Kategoria', { exact: true })
    .selectOption(incomeCategory);
  await dialog(page).getByLabel('Kwota', { exact: true }).fill('50,20');
  await dialog(page)
    .getByLabel('Tytuł', { exact: true })
    .fill('Poprawiony przychód');
  await dialog(page)
    .getByLabel('Data operacji', { exact: true })
    .fill('0001-01-01');
  await dialog(page)
    .getByLabel('Notatka (opcjonalnie)', { exact: true })
    .fill('');
  await dialog(page)
    .getByRole('button', { name: 'Zapisz zmiany', exact: true })
    .click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(
    page.getByText('Transakcja zaktualizowana.', { exact: true }),
  ).toBeVisible();
  await expect(
    history(page).getByText('Poprawiony przychód', { exact: true }),
  ).toBeVisible();
  await expect(
    history(page).getByText('01.01.0001', { exact: true }),
  ).toBeVisible();
  await expect(
    history(page).getByRole('list').getByText('Wynagrodzenie', { exact: true }),
  ).toBeVisible();
  await expect(
    balance(page).getByText('150,20 zł', { exact: true }),
  ).toBeVisible();
  await expect(
    history(page).getByRole('heading', {
      name: 'Historia transakcji',
      exact: true,
    }),
  ).toBeFocused();
  const response = await page.request.get(API_URL + '/transactions/' + id);
  expect(await response.json()).toMatchObject({
    amount: '50.20',
    type: 'INCOME',
    categoryId: incomeCategory,
    note: null,
    occurredOn: '0001-01-01',
  });
  await page.reload();
  await expect(
    history(page).getByText('+50,20 zł', { exact: true }),
  ).toBeVisible();
});

test('cancels editing and deletion with keyboard focus returning to the original action', async ({
  page,
  accounts,
}, testInfo) => {
  await login(page, await accounts.register());
  const id = await create(page);
  await open(page);
  const draft = page.getByRole('form', {
    name: 'Nowa transakcja',
    exact: true,
  });
  await draft.getByLabel('Tytuł', { exact: true }).fill('Zachowany szkic');
  const edit = history(page).getByRole('button', {
    name: 'Edytuj: Zakupy do poprawy',
    exact: true,
  });
  await edit.focus();
  await edit.press('Enter');
  await expect(
    dialog(page).getByLabel('Typ operacji', { exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(
    dialog(page).getByRole('button', { name: 'Anuluj', exact: true }),
  ).toBeFocused();
  await dialog(page)
    .getByLabel('Tytuł', { exact: true })
    .fill('Anulowana zmiana');
  const cancel = dialog(page).getByRole('button', {
    name: 'Anuluj',
    exact: true,
  });
  await cancel.focus();
  await page.keyboard.press('Tab');
  await expect(
    dialog(page).getByLabel('Typ operacji', { exact: true }),
  ).toBeFocused();
  await dialog(page).screenshot({
    path: testInfo.outputPath('edit-desktop.png'),
  });
  await page.keyboard.press('Escape');
  await expect(edit).toBeFocused();
  await expect(draft.getByLabel('Tytuł', { exact: true })).toHaveValue(
    'Zachowany szkic',
  );
  const remove = history(page).getByRole('button', {
    name: 'Usuń: Zakupy do poprawy',
    exact: true,
  });
  await remove.click();
  await expect(
    dialog(page).getByText(/Operacja „Zakupy do poprawy”/),
  ).toBeVisible();
  await expect(
    dialog(page).getByText('-12,50 zł', { exact: true }),
  ).toBeVisible();
  await expect(
    dialog(page).getByRole('button', { name: 'Anuluj', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(remove).toBeFocused();
  const response = await page.request.get(API_URL + '/transactions/' + id);
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({
    title: 'Zakupy do poprawy',
    amount: '12.50',
  });
});

test('preserves an edit after a failed PATCH and retries only GET after a confirmed save', async ({
  page,
  accounts,
}) => {
  await login(page, await accounts.register());
  await create(page);
  await open(page);
  let patches = 0;
  let failHistory = false;
  await page.route(API_URL + '/transactions**', async (route) => {
    const method = route.request().method();
    if (method === 'PATCH') {
      patches += 1;
      if (patches === 1) {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          headers: {
            'Access-Control-Allow-Origin': FRONTEND_URL,
            'Access-Control-Allow-Credentials': 'true',
          },
          body: '{}',
        });
        return;
      }
      failHistory = true;
    }
    if (method === 'GET' && failHistory) {
      failHistory = false;
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        headers: {
          'Access-Control-Allow-Origin': FRONTEND_URL,
          'Access-Control-Allow-Credentials': 'true',
        },
        body: '{}',
      });
    } else await route.continue();
  });
  await history(page)
    .getByRole('button', { name: 'Edytuj: Zakupy do poprawy', exact: true })
    .click();
  await dialog(page).getByLabel('Kwota', { exact: true }).fill('2,50');
  await dialog(page)
    .getByLabel('Tytuł', { exact: true })
    .fill('Zachowana poprawka');
  await dialog(page)
    .getByRole('button', { name: 'Zapisz zmiany', exact: true })
    .click();
  await expect(dialog(page).getByRole('alert')).toContainText(
    'Serwer nie mógł wykonać operacji.',
  );
  await expect(dialog(page).getByLabel('Kwota', { exact: true })).toHaveValue(
    '2,50',
  );
  await expect(dialog(page).getByLabel('Tytuł', { exact: true })).toHaveValue(
    'Zachowana poprawka',
  );
  await expect(
    page.getByText('Transakcja zaktualizowana.', { exact: true }),
  ).toHaveCount(0);
  await dialog(page)
    .getByRole('button', { name: 'Zapisz zmiany', exact: true })
    .click();
  await expect(
    page.getByText('Transakcja zaktualizowana.', { exact: true }),
  ).toBeVisible();
  await history(page)
    .getByRole('button', { name: 'Ponów pobieranie historii', exact: true })
    .click();
  await expect(
    history(page).getByText('Zachowana poprawka', { exact: true }),
  ).toBeVisible();
  await expect(
    balance(page).getByText('-2,50 zł', { exact: true }),
  ).toBeVisible();
  expect(patches).toBe(2);
});

test('deletes the last row of page two, retains filters and refreshes the balance', async ({
  page,
  accounts,
}) => {
  await login(page, await accounts.register());
  await saveWallet(page, 'Portfel usuwania', '100,00');
  await Promise.all(
    Array.from({ length: 21 }, (_, index) =>
      create(page, {
        title: 'Operacja ' + (index + 1),
        amount: '1.00',
        occurredOn: '2026-11-' + String(index + 1).padStart(2, '0'),
      }),
    ),
  );
  await open(page);
  await page.getByLabel('Filtr typu', { exact: true }).selectOption('EXPENSE');
  await history(page)
    .getByRole('button', { name: 'Filtruj', exact: true })
    .click();
  await expect(history(page).getByRole('status')).toContainText(
    'Liczba wyników: 21.',
  );
  await history(page)
    .getByRole('button', { name: 'Następna strona', exact: true })
    .click();
  await expect(history(page).getByRole('status')).toContainText(
    'Strona 2 z 2.',
  );
  await history(page)
    .getByRole('button', { name: 'Usuń: Operacja 1', exact: true })
    .click();
  await dialog(page)
    .getByRole('button', { name: 'Usuń transakcję', exact: true })
    .click();
  await expect(history(page).getByRole('status')).toContainText(
    'Liczba wyników: 20. Strona 1 z 1.',
  );
  await expect(history(page).getByRole('listitem')).toHaveCount(20);
  await expect(page.getByLabel('Filtr typu', { exact: true })).toHaveValue(
    'EXPENSE',
  );
  await expect(
    balance(page).getByText('80,00 zł', { exact: true }),
  ).toBeVisible();
  await expect(
    history(page).getByRole('heading', {
      name: 'Historia transakcji',
      exact: true,
    }),
  ).toBeFocused();
});

for (const kind of ['edit', 'delete'] as const) {
  test(`redirects to login if the session expires during ${kind}`, async ({
    page,
    accounts,
  }) => {
    const account = await accounts.register();
    await login(page, account);
    await create(page);
    await open(page);
    await history(page)
      .getByRole('button', {
        name: `${kind === 'edit' ? 'Edytuj' : 'Usuń'}: Zakupy do poprawy`,
        exact: true,
      })
      .click();
    await accounts.expireSessions(account);
    await dialog(page)
      .getByRole('button', {
        name: kind === 'edit' ? 'Zapisz zmiany' : 'Usuń transakcję',
        exact: true,
      })
      .click();
    await expect(page).toHaveURL(/\/login$/);
  });

  test(`handles a transaction deleted elsewhere before ${kind} without a false success`, async ({
    page,
    accounts,
  }) => {
    await login(page, await accounts.register());
    const id = await create(page);
    await open(page);
    await history(page)
      .getByRole('button', {
        name: `${kind === 'edit' ? 'Edytuj' : 'Usuń'}: Zakupy do poprawy`,
        exact: true,
      })
      .click();
    const deleted = await page.request.delete(API_URL + '/transactions/' + id, {
      headers: { Origin: FRONTEND_URL },
    });
    expect(deleted.status()).toBe(204);
    await dialog(page)
      .getByRole('button', {
        name: kind === 'edit' ? 'Zapisz zmiany' : 'Usuń transakcję',
        exact: true,
      })
      .click();
    await expect(dialog(page).getByRole('alert')).toContainText(
      'Ta transakcja nie jest już dostępna.',
    );
    await dialog(page)
      .getByRole('button', { name: 'Anuluj', exact: true })
      .click();
    await expect(
      history(page).getByText(
        'Nie masz jeszcze transakcji. Dodaj pierwszy przychód lub wydatek.',
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      history(page).getByRole('heading', {
        name: 'Historia transakcji',
        exact: true,
      }),
    ).toBeFocused();
    await expect(
      balance(page).getByText('0,00 zł', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(/Transakcja (zaktualizowana|usunięta)\./),
    ).toHaveCount(0);
  });
}

test('keeps edit and delete dialogs usable on a narrow screen and removes an edited row excluded by its filter', async ({
  page,
  accounts,
}, testInfo) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await login(page, await accounts.register());
  await create(page);
  await open(page);
  await page.getByLabel('Filtr typu', { exact: true }).selectOption('EXPENSE');
  await history(page)
    .getByRole('button', { name: 'Filtruj', exact: true })
    .click();
  await history(page)
    .getByRole('button', { name: 'Edytuj: Zakupy do poprawy', exact: true })
    .click();
  await dialog(page).screenshot({
    path: testInfo.outputPath('edit-mobile.png'),
  });
  await expect(dialog(page)).toBeInViewport();
  expect(
    await dialog(page).evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  await dialog(page)
    .getByLabel('Typ operacji', { exact: true })
    .selectOption('INCOME');
  await dialog(page)
    .getByLabel('Kategoria', { exact: true })
    .selectOption(incomeCategory);
  await dialog(page)
    .getByRole('button', { name: 'Zapisz zmiany', exact: true })
    .click();
  await expect(
    history(page).getByText('Brak transakcji spełniających wybrane filtry.', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText('Transakcja zaktualizowana.', { exact: true }),
  ).toBeVisible();
  await expect(
    balance(page).getByText('12,50 zł', { exact: true }),
  ).toBeVisible();
  await history(page)
    .getByRole('button', { name: 'Wyczyść filtry', exact: true })
    .click();
  await history(page)
    .getByRole('button', { name: 'Usuń: Zakupy do poprawy', exact: true })
    .click();
  await dialog(page).screenshot({
    path: testInfo.outputPath('delete-mobile.png'),
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await dialog(page)
    .getByRole('button', { name: 'Anuluj', exact: true })
    .click();
});
