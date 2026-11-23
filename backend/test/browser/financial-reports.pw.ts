import { reportPdf } from '../support/fundamental-pdf.js';
import { login } from './actions.js';
import { expect, test } from './fixtures.js';

test('imports a source PDF and opens the same saved version after reload', async ({
  page,
  accounts,
}) => {
  await page.setViewportSize({ width: 390, height: 850 });
  const instrument = await accounts.investmentInstrument();
  await login(page, await accounts.register());
  await page.goto('/dashboard/fundamental-analysis');
  await page.getByText('Zapisane raporty', { exact: true }).click();
  await page.getByText('Dodaj raport emitenta', { exact: true }).click();
  await page
    .getByLabel('Szukaj instrumentu', { exact: true })
    .fill(instrument.ticker);
  await page
    .getByRole('combobox', { name: 'Instrument', exact: true })
    .selectOption(instrument.id);
  await page.getByLabel('Początek okresu', { exact: true }).fill('2025-02-01');
  await page.getByLabel('Koniec okresu', { exact: true }).fill('2026-01-31');
  await page.getByLabel('Data publikacji', { exact: true }).fill('2026-03-01');
  await page
    .getByRole('combobox', { name: 'Waluta raportu', exact: true })
    .selectOption('USD');
  await page
    .getByLabel('Adres dokumentu u emitenta', { exact: true })
    .fill('https://issuer.example/report.pdf');
  await page.getByLabel('Plik PDF', { exact: true }).setInputFiles({
    name: 'raport-emitenta.pdf',
    mimeType: 'application/pdf',
    buffer: reportPdf(),
  });
  await page
    .getByRole('button', { name: 'Zapisz raport', exact: true })
    .click();
  await expect(
    page.getByText('Zapisano raport, wersja 1.', { exact: true }),
  ).toBeVisible();

  await page.reload();
  await page.getByText('Zapisane raporty', { exact: true }).click();
  await expect(
    page.getByText(/opublikowano 2026-03-01 · wersja 1/),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Otwórz w czacie', exact: true })
    .click();
  await expect(
    page.getByText('Załączono raport do nowej rozmowy.', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('raport-emitenta.pdf', { exact: true }),
  ).toHaveCount(2);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.goto('/dashboard/market/' + instrument.id);
  const fundamentals = page.getByRole('region', {
    name: 'Fundamenty spółki',
    exact: true,
  });
  await expect(
    fundamentals.getByText('120 mln USD', { exact: true }),
  ).toBeVisible();
  await expect(fundamentals.getByText('7,50%', { exact: true })).toBeVisible();
  await expect(
    fundamentals
      .getByRole('link', { name: 'strona 1 PDF', exact: true })
      .first(),
  ).toHaveAttribute('href', /\/reports\/[^/]+\/pdf#page=1$/);
  await fundamentals
    .getByRole('combobox', { name: 'Okres', exact: true })
    .selectOption('trailingYear');
  await expect(
    fundamentals.getByText(
      'Do TTM potrzeba czterech kolejnych kwartałów w tej samej walucie.',
      { exact: true },
    ),
  ).toBeVisible();
});
