import type { Page } from '@playwright/test';
import { login, logout } from './actions.js';
import { test, expect, API_URL } from './fixtures.js';

const main = (page: Page) => page.getByRole('main');
const form = (page: Page) =>
  page.getByRole('form', { name: 'Nowa operacja inwestycyjna', exact: true });
const cash = (page: Page) =>
  page.getByRole('region', { name: 'Gotówka inwestycyjna', exact: true });
const nav = (page: Page) =>
  page.getByRole('link', { name: 'Inwestycje', exact: true });

async function createAccountWithKeyboard(page: Page) {
  await nav(page).click();
  await page
    .getByLabel('Nazwa portfela inwestycyjnego', { exact: true })
    .fill('Portfel odbioru');
  await page
    .getByLabel('Nazwa portfela inwestycyjnego', { exact: true })
    .press('Enter');
  await page
    .getByRole('link', { name: 'Portfel odbioru', exact: true })
    .click();
  await expect(nav(page)).toHaveAttribute('aria-current', 'page');
  await expect(
    page.getByText('Ten portfel nie ma jeszcze rachunków.', { exact: false }),
  ).toBeVisible();
  await page
    .getByLabel('Nazwa rachunku', { exact: true })
    .fill('Rachunek odbioru');
  await page.getByLabel('Nazwa rachunku', { exact: true }).press('Enter');
  await page
    .getByRole('link', { name: 'Rachunek odbioru', exact: true })
    .click();
  await expect(form(page)).toBeVisible();
  await expect(nav(page)).toHaveAttribute('aria-current', 'page');
}

test('distinguishes loading, read failure, retry and an empty portfolio', async ({
  page,
  accounts,
}) => {
  await login(page, await accounts.register());
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let failReads = true;
  await page.route(API_URL + '/investments/portfolios', async (route) => {
    if (route.request().method() === 'GET' && failReads) {
      await gate;
      await route.fulfill({
        status: 503,
        json: { message: 'Test read failure' },
      });
    } else await route.continue();
  });
  await nav(page).click();
  await expect(main(page).getByRole('status')).toHaveText(
    'Ładowanie inwestycji…',
  );
  release();
  await expect(main(page).getByRole('alert')).toContainText('Serwer nie mógł');
  await expect(
    page.getByLabel('Nazwa portfela inwestycyjnego', { exact: true }),
  ).toHaveCount(0);
  failReads = false;
  await page
    .getByRole('button', { name: 'Spróbuj ponownie', exact: true })
    .click();
  await expect(
    page.getByText('Nie masz jeszcze portfela inwestycyjnego.', {
      exact: false,
    }),
  ).toBeVisible();
  await expect(
    page.getByLabel('Nazwa portfela inwestycyjnego', { exact: true }),
  ).toBeVisible();
});

test('supports mobile keyboard entry, field validation, rejected writes and correction focus', async ({
  page,
  accounts,
}, testInfo) => {
  await page.setViewportSize({ width: 375, height: 850 });
  const instrument = await accounts.investmentInstrument();
  await login(page, await accounts.register());
  await createAccountWithKeyboard(page);
  let eventWrites = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/events'))
      eventWrites++;
  });
  await form(page).getByLabel('Kwota', { exact: true }).fill('1e2');
  await form(page).getByLabel('Kwota', { exact: true }).press('Enter');
  await expect(form(page).getByLabel('Kwota', { exact: true })).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await expect(form(page).getByRole('alert')).toBeFocused();
  expect(eventWrites).toBe(0);
  let reject = true;
  await page.route(
    API_URL + '/investments/portfolios/**/events',
    async (route) => {
      if (route.request().method() === 'POST' && reject) {
        reject = false;
        await route.fulfill({
          status: 400,
          json: { message: 'Odrzucony zapis testowy.' },
        });
      } else await route.continue();
    },
  );
  await form(page).getByLabel('Kwota', { exact: true }).fill('100,00');
  await form(page).getByLabel('Kwota', { exact: true }).press('Enter');
  await expect(form(page).getByRole('alert')).toHaveText(
    'Odrzucony zapis testowy.',
  );
  await expect(form(page).getByLabel('Kwota', { exact: true })).toHaveValue(
    '100,00',
  );
  await expect(form(page).getByLabel('Kwota', { exact: true })).toBeEnabled();
  await form(page).getByLabel('Kwota', { exact: true }).press('Enter');
  await expect(
    cash(page).getByText('100,00 PLN', { exact: true }),
  ).toBeVisible();
  const trigger = page.getByRole('button', {
    name: 'Koryguj: Wpłata',
    exact: true,
  });
  await trigger.focus();
  await trigger.press('Enter');
  const edit = page.getByRole('form', {
    name: 'Korekta operacji',
    exact: true,
  });
  await expect(
    edit.getByRole('heading', { name: 'Korekta operacji', exact: true }),
  ).toBeFocused();
  await edit
    .getByRole('button', { name: 'Anuluj edycję', exact: true })
    .press('Enter');
  await expect(trigger).toBeFocused();
  await trigger.press('Enter');
  await edit.getByLabel('Kwota', { exact: true }).fill('120');
  await edit
    .getByLabel('Powód korekty', { exact: true })
    .fill('Sprawdzono wpłatę');
  await edit.getByLabel('Powód korekty', { exact: true }).press('Enter');
  await expect(
    cash(page).getByText('120,00 PLN', { exact: true }),
  ).toBeVisible();
  await form(page)
    .getByRole('combobox', { name: 'Typ operacji', exact: true })
    .selectOption('BUY');
  await form(page).getByLabel('Szukaj instrumentu').fill(instrument.ticker);
  await form(page)
    .getByRole('combobox', { name: 'Instrument', exact: true })
    .selectOption(instrument.id);
  await form(page).getByLabel('Ilość akcji', { exact: true }).fill('0,1');
  await form(page).getByLabel('Cena za akcję', { exact: true }).fill('100');
  await form(page).getByLabel('Prowizja', { exact: true }).press('Enter');
  await expect(
    cash(page).getByText('110,00 PLN', { exact: true }),
  ).toBeVisible();
  await page
    .getByRole('combobox', { name: 'Filtr typu', exact: true })
    .selectOption('BUY');
  await page
    .getByRole('button', { name: 'Filtruj', exact: true })
    .press('Enter');
  const history = page.getByRole('region', {
    name: 'Historia operacji inwestycyjnych',
    exact: true,
  });
  await expect(history.getByRole('listitem')).toHaveCount(1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('investments-mobile.png'),
    fullPage: true,
  });
});

test('clears investments on session expiry and account switches and restores only the owner history', async ({
  page,
  accounts,
}) => {
  const owner = await accounts.register();
  const stranger = await accounts.register();
  await login(page, owner);
  await createAccountWithKeyboard(page);
  await form(page).getByLabel('Kwota', { exact: true }).fill('100');
  await form(page).getByLabel('Kwota', { exact: true }).press('Enter');
  await expect(
    cash(page).getByText('100,00 PLN', { exact: true }),
  ).toBeVisible();
  const ownedUrl = page.url();
  await accounts.expireSessions(owner);
  await page.getByRole('button', { name: 'Filtruj', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(cash(page)).toHaveCount(0);
  await login(page, stranger);
  await nav(page).click();
  await expect(
    page.getByText('Nie masz jeszcze portfela inwestycyjnego.', {
      exact: false,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Portfel odbioru', exact: true }),
  ).toHaveCount(0);
  await page.goto(ownedUrl);
  await expect(main(page).getByRole('alert')).toContainText('Nie znaleziono');
  await expect(cash(page)).toHaveCount(0);
  await logout(page);
  await login(page, owner);
  await page.goto(ownedUrl);
  await expect(
    cash(page).getByText('100,00 PLN', { exact: true }),
  ).toBeVisible();
});
