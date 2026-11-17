import type { Page } from '@playwright/test';
import { login, logout } from './actions.js';
import { test, expect, API_URL } from './fixtures.js';

const operation = (page: Page) =>
  page.getByRole('form', { name: 'Nowa operacja inwestycyjna', exact: true });
const cash = (page: Page) =>
  page.getByRole('region', { name: 'Gotówka inwestycyjna', exact: true });
const positions = (page: Page) =>
  page.getByRole('region', { name: 'Posiadane akcje', exact: true });

async function createPortfolioAndAccount(page: Page) {
  await page.goto('/dashboard/investments');
  await page
    .getByLabel('Nazwa portfela inwestycyjnego', { exact: true })
    .fill('Portfel scenariusza');
  await page
    .getByRole('button', { name: 'Utwórz portfel', exact: true })
    .click();
  await page
    .getByRole('link', { name: 'Portfel scenariusza', exact: true })
    .click();
  await page
    .getByLabel('Nazwa rachunku', { exact: true })
    .fill('Rachunek scenariusza');
  await page
    .getByRole('button', { name: 'Utwórz rachunek', exact: true })
    .click();
  await page
    .getByRole('link', { name: 'Rachunek scenariusza', exact: true })
    .click();
  await expect(operation(page)).toBeVisible();
}

test('runs deposit, purchase, partial sale, reload and historical correction against the real API', async ({
  page,
  accounts,
}, testInfo) => {
  const user = await accounts.register();
  const instrument = await accounts.investmentInstrument();
  await login(page, user);
  await createPortfolioAndAccount(page);
  await operation(page).getByLabel('Kwota', { exact: true }).fill('1000,00');
  await operation(page)
    .getByRole('button', { name: 'Zapisz operację', exact: true })
    .click();
  await expect(
    cash(page).getByText('1000,00 PLN', { exact: true }),
  ).toBeVisible();
  await operation(page)
    .getByRole('combobox', { name: 'Typ operacji', exact: true })
    .selectOption('BUY');
  await operation(page)
    .getByRole('combobox', { name: 'Instrument', exact: true })
    .selectOption(instrument.id);
  await operation(page).getByLabel('Ilość akcji', { exact: true }).fill('10');
  await operation(page).getByLabel('Cena za akcję', { exact: true }).fill('50');
  await operation(page).getByLabel('Prowizja', { exact: true }).fill('5');
  await operation(page)
    .getByRole('button', { name: 'Zapisz operację', exact: true })
    .click();
  await expect(
    cash(page).getByText('495,00 PLN', { exact: true }),
  ).toBeVisible();
  await operation(page)
    .getByRole('combobox', { name: 'Typ operacji', exact: true })
    .selectOption('SELL');
  await operation(page)
    .getByRole('combobox', { name: 'Instrument', exact: true })
    .selectOption(instrument.id);
  await operation(page).getByLabel('Ilość akcji', { exact: true }).fill('4');
  await operation(page).getByLabel('Cena za akcję', { exact: true }).fill('60');
  await operation(page).getByLabel('Prowizja', { exact: true }).fill('2');
  await operation(page)
    .getByRole('button', { name: 'Zapisz operację', exact: true })
    .click();
  await expect(
    cash(page).getByText('733,00 PLN', { exact: true }),
  ).toBeVisible();
  await expect(positions(page).getByText('6', { exact: true })).toBeVisible();
  await expect(
    positions(page).getByText('303,00 PLN', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('Wynik sprzedaży: 36,00 PLN', { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    cash(page).getByText('733,00 PLN', { exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', {
      name: `Koryguj: Zakup ${instrument.ticker}`,
      exact: true,
    })
    .click();
  const edit = page.getByRole('form', {
    name: 'Korekta operacji',
    exact: true,
  });
  await edit.getByLabel('Cena za akcję', { exact: true }).fill('55');
  await edit
    .getByLabel('Powód korekty', { exact: true })
    .fill('Poprawna cena zakupu');
  await edit
    .getByRole('button', { name: 'Zapisz korektę', exact: true })
    .click();
  await expect(
    cash(page).getByText('683,00 PLN', { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('investment-dashboard.png'),
    fullPage: true,
  });
  await expect(
    positions(page).getByText('333,00 PLN', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('Wynik sprzedaży: 16,00 PLN', { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    cash(page).getByText('683,00 PLN', { exact: true }),
  ).toBeVisible();
  const accountPath = page.url();
  await logout(page);
  const stranger = await accounts.register();
  await login(page, stranger);
  await page.goto(accountPath);
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Nie znaleziono');
  await expect(cash(page)).toHaveCount(0);
});

test('recovers an acknowledgement lost after the backend committed without duplicating the deposit', async ({
  page,
  accounts,
}) => {
  await login(page, await accounts.register());
  await createPortfolioAndAccount(page);
  let failed = false;
  await page.route(
    API_URL + '/investments/portfolios/**/events',
    async (route) => {
      if (route.request().method() === 'POST' && !failed) {
        failed = true;
        const response = await route.fetch();
        expect(response.status()).toBe(201);
        await route.abort('failed');
      } else await route.continue();
    },
  );
  await operation(page).getByLabel('Kwota', { exact: true }).fill('100');
  await operation(page)
    .getByRole('button', { name: 'Zapisz operację', exact: true })
    .click();
  await expect(operation(page).getByRole('alert')).toContainText(
    'Nie udało się potwierdzić',
  );
  await expect(
    operation(page).getByLabel('Kwota', { exact: true }),
  ).toBeDisabled();
  await operation(page)
    .getByRole('button', { name: 'Ponów ten sam zapis', exact: true })
    .click();
  await expect(
    cash(page).getByText('100,00 PLN', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('Strona 1 · Operacje: 1', { exact: true }),
  ).toBeVisible();
});
