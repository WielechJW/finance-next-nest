import { login, logout } from './actions.js';
import { API_URL, FRONTEND_URL, expect, test } from './fixtures.js';

test('configures a private strategy, stops the schedule and replays a saved decision', async ({
  page,
  accounts,
}) => {
  const instrument = await accounts.investmentInstrument();
  const owner = await accounts.register();
  const stranger = await accounts.register();
  await login(page, owner);
  const headers = { Origin: FRONTEND_URL };
  const portfolios = API_URL + '/investments/portfolios';
  const portfolio = await page.request.post(portfolios, {
    headers,
    data: { name: 'Portfel strategii' },
  });
  expect(portfolio.status()).toBe(201);
  const portfolioId = ((await portfolio.json()) as { id: string }).id;
  const account = await page.request.post(
    `${portfolios}/${portfolioId}/accounts`,
    { headers, data: { name: 'Rachunek strategii' } },
  );
  expect(account.status()).toBe(201);
  const accountId = ((await account.json()) as { id: string }).id;
  const path = `/dashboard/investments/${portfolioId}/accounts/${accountId}`;
  await page.goto(path);
  await page.getByRole('link', { name: 'Strategie sygnałowe' }).click();
  await expect(
    page.getByText('Brak zapisanych strategii na tym rachunku.'),
  ).toBeVisible();
  const form = page.getByRole('form', { name: 'Nowa strategia SMA' });
  await form.getByLabel('Nazwa strategii').fill('Moja reguła SMA');
  await form.getByLabel('Szukaj instrumentu').fill(instrument.ticker);
  await form
    .getByRole('combobox', { name: 'Instrument', exact: true })
    .selectOption(instrument.id);
  await form.getByLabel('Szybka średnia (sesje)').fill('21');
  await form.getByRole('button', { name: 'Dodaj strategię' }).click();
  await expect(form.getByRole('alert')).toContainText(
    'Użyj co najmniej dwóch sesji',
  );
  await form.getByLabel('Szybka średnia (sesje)').fill('5');
  await form.getByRole('button', { name: 'Dodaj strategię' }).click();
  await expect(
    page.getByRole('heading', { name: 'Moja reguła SMA' }),
  ).toBeVisible();
  await expect(page.getByText('Brak uruchomień tej strategii.')).toBeVisible();
  const schedule = page.getByRole('form', { name: 'Harmonogram strategii' });
  await schedule.getByLabel('Automatyczne uruchomienia').check();
  await schedule.getByRole('button', { name: 'Zapisz harmonogram' }).click();
  await expect(page.getByText('Włączono harmonogram.')).toBeVisible();
  await schedule.getByLabel('Automatyczne uruchomienia').uncheck();
  await schedule.getByRole('button', { name: 'Zapisz harmonogram' }).click();
  await expect(page.getByText('Wyłączono harmonogram.')).toBeVisible();
  await page.getByRole('button', { name: 'Uruchom analizę teraz' }).click();
  const table = page.getByRole('table', { name: 'Uruchomienia strategii' });
  await expect(table.getByText('Brak sygnału', { exact: true })).toBeVisible();
  await table.getByRole('button', { name: 'Odtwórz decyzję' }).click();
  await expect(
    page
      .getByRole('region', { name: 'Odtworzenie decyzji' })
      .getByText('Średnie z 5 i 20 sesji · ważność 60 min'),
  ).toBeVisible();
  await logout(page);
  await login(page, stranger);
  await page.goto(`${path}/strategies`);
  await expect(
    page.getByText('Nie znaleziono rachunku inwestycyjnego.'),
  ).toBeVisible();
  await expect(page.getByText('Moja reguła SMA', { exact: true })).toHaveCount(
    0,
  );
});
