import { login } from './actions.js';
import { API_URL, FRONTEND_URL, expect, test } from './fixtures.js';

test('uploads a report, reopens saved validation results and leaves cash unchanged', async ({
  page,
  accounts,
}) => {
  await login(page, await accounts.register());
  const headers = { Origin: FRONTEND_URL };
  const portfolios = API_URL + '/investments/portfolios';
  const portfolio = await page.request.post(portfolios, {
    headers,
    data: { name: 'Portfel CSV' },
  });
  expect(portfolio.status()).toBe(201);
  const portfolioId = ((await portfolio.json()) as { id: string }).id;
  const account = await page.request.post(
    `${portfolios}/${portfolioId}/accounts`,
    { headers, data: { name: 'Rachunek CSV' } },
  );
  expect(account.status()).toBe(201);
  const accountId = ((await account.json()) as { id: string }).id;
  await page.goto(
    `/dashboard/investments/${portfolioId}/accounts/${accountId}`,
  );
  await page.getByRole('link', { name: 'Import historii CSV' }).click();
  await page.getByLabel('Plik CSV (do 1 MB)').setInputFiles({
    name: 'historia.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'type,occurredOn,currency,amount\nDEPOSIT,2025-01-08,PLN,100.02\nDEPOSIT,2025-01-09,EUR,1',
    ),
  });
  await page.getByRole('button', { name: 'Sprawdź plik' }).click();
  const table = page.getByRole('table', { name: 'Wiersze partii' });
  await expect(table.getByText('Poprawny format')).toBeVisible();
  await expect(
    table.getByText('Obsługiwane waluty to PLN i USD.'),
  ).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: /Szablon ogólny/ }).click();
  await expect(table.getByText('DEPOSIT · 2025-01-08')).toBeVisible();
  await page.getByRole('link', { name: 'Wróć do rachunku' }).click();
  await expect(
    page
      .getByRole('region', { name: 'Gotówka inwestycyjna' })
      .getByText('0,00 PLN', { exact: true }),
  ).toBeVisible();
});
