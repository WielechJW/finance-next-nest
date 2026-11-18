import { randomUUID } from 'node:crypto';
import { login, logout } from './actions.js';
import { test, expect, API_URL, FRONTEND_URL } from './fixtures.js';

test('shows a market valuation and preserves ownership after reload and changing accounts', async ({ page, accounts }) => {
  const user = await accounts.register();
  const instrument = await accounts.investmentInstrument();
  await accounts.investmentQuote(instrument.id);
  await login(page, user);
  const headers = { Origin: FRONTEND_URL };
  const portfolioResponse = await page.request.post(`${API_URL}/investments/portfolios`, { headers, data: { name: 'Wycena testowa' } });
  expect(portfolioResponse.status()).toBe(201);
  const portfolio = await portfolioResponse.json() as { id: string };
  const accountResponse = await page.request.post(`${API_URL}/investments/portfolios/${portfolio.id}/accounts`, { headers, data: { name: 'Rachunek testowy' } });
  const account = await accountResponse.json() as { id: string };
  const common = { occurredOn: '2026-11-10', timePrecision: 'DATE' };
  const inputs = [
    { type: 'DEPOSIT', currency: 'PLN', amount: '1000.00' },
    { type: 'BUY', instrumentId: instrument.id, quantity: '10', unitPrice: '50', commission: '5.00' },
    { type: 'SELL', instrumentId: instrument.id, quantity: '4', unitPrice: '60', commission: '2.00' },
  ];
  for (const [index, input] of inputs.entries()) {
    const response = await page.request.post(`${API_URL}/investments/portfolios/${portfolio.id}/accounts/${account.id}/events`, { headers, data: { ...common, ...input, daySequence: index + 1, idempotencyKey: randomUUID() } });
    expect(response.status()).toBe(201);
  }
  const path = `/dashboard/investments/${portfolio.id}`;
  await page.goto(path);
  const region = page.getByRole('region', { name: 'Wycena rynkowa portfela', exact: true });
  await expect(region.getByText(/1\s*153,00 PLN/, { exact: true })).toBeVisible();
  await expect(region.getByText('153,00 PLN', { exact: true })).toBeVisible();
  await page.reload();
  await expect(region.getByText('153,00 PLN', { exact: true })).toBeVisible();
  await logout(page);
  await login(page, await accounts.register());
  await page.goto(path);
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Nie znaleziono');
  await expect(region).toHaveCount(0);
});
