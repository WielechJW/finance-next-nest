import { reportPdf } from '../support/fundamental-pdf.js';
import { login } from './actions.js';
import { API_URL, FRONTEND_URL, expect, test } from './fixtures.js';

test('compares reports and keeps a saved note on the company card', async ({
  page,
  accounts,
}) => {
  const [first, second] = await Promise.all([
    accounts.investmentInstrument(),
    accounts.investmentInstrument(),
  ]);
  await login(page, await accounts.register());
  async function importReport(
    instrumentId: string,
    contents: Buffer,
    periodEnd: string,
  ) {
    const response = await page.request.post(
      API_URL + '/fundamental-analysis/reports',
      {
        headers: { Origin: FRONTEND_URL },
        multipart: {
          instrumentId,
          scope: 'CONSOLIDATED',
          periodKind: 'ANNUAL',
          currency: 'USD',
          periodStart: '2025-02-01',
          periodEnd,
          publishedOn: '2026-03-01',
          filename: 'issuer.pdf',
          sourceUrl: 'https://issuer.example/report.pdf',
          report: {
            name: 'issuer.pdf',
            mimeType: 'application/pdf',
            buffer: contents,
          },
        },
      },
    );
    expect(response.status()).toBe(201);
  }
  await importReport(first.id, reportPdf(), '2026-01-31');
  await importReport(second.id, reportPdf('150'), '2025-12-31');
  await page.goto('/dashboard/fundamental-analysis');
  await page
    .getByRole('link', { name: 'Screener i porównanie spółek' })
    .click();
  await page.getByRole('checkbox', { name: new RegExp(first.ticker) }).check();
  await page.getByRole('checkbox', { name: new RegExp(second.ticker) }).check();
  const table = page.getByRole('table', {
    name: 'Porównanie wybranych spółek',
  });
  await expect(table.getByText('2025-02-01 – 2026-01-31 · USD')).toBeVisible();
  await expect(table.getByText('2025-02-01 – 2025-12-31 · USD')).toBeVisible();
  await expect(
    table.getByRole('link', { name: 'Strona 1 PDF' }).first(),
  ).toHaveAttribute('href', /\/reports\/[^/]+\/pdf#page=1$/);
  await page
    .getByRole('textbox', { name: 'Minimalna marża EBIT (%)' })
    .fill('7,00');
  await page.getByRole('button', { name: 'Filtruj spółki' }).click();
  await expect(
    page.getByRole('checkbox', { name: new RegExp(first.ticker) }),
  ).toBeVisible();
  await expect(
    page.getByRole('checkbox', { name: new RegExp(second.ticker) }),
  ).toHaveCount(0);

  await page.goto('/dashboard/market/' + first.id);
  const note = page.getByRole('form', { name: 'Prywatna notatka' });
  await note.getByLabel('Teza inwestycyjna').fill('Rozwój produktów');
  await note.getByLabel('Ryzyka').fill('Utrata licencji');
  await note
    .getByLabel('Warunki ponownej analizy')
    .fill('Po następnym raporcie');
  await note.getByRole('button', { name: 'Zapisz notatkę' }).click();
  await expect(note.getByRole('status')).toHaveText('Zapisano notatkę.');
  await page.reload();
  await expect(note.getByLabel('Ryzyka')).toHaveValue('Utrata licencji');
  await note.getByRole('button', { name: 'Usuń notatkę' }).click();
  await expect(note.getByRole('status')).toHaveText('Usunięto notatkę.');
  await expect(note.getByLabel('Ryzyka')).toHaveValue('');
});
