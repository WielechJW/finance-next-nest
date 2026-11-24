import {
  expectedSession,
  previousDay,
  session,
  zonedClock,
} from '../../src/market-data/calendar.js';
import { login } from './actions.js';
import { API_URL, FRONTEND_URL, expect, test } from './fixtures.js';

for (const market of [
  {
    mic: 'XWAR',
    currency: 'PLN',
    ordered: '3',
    filled: '2',
    price: '100',
    fee: '1',
    cash: '799,00 PLN',
  },
  {
    mic: 'XNAS',
    currency: 'USD',
    ordered: '1',
    filled: '1',
    price: '50',
    fee: '0,50',
    cash: '949,50 USD',
  },
] as const) {
  test(`links a strategy signal to a reconciled ${market.mic} position`, async ({
    page,
    accounts,
  }) => {
    const owner = await accounts.register();
    const instrument = await accounts.investmentInstrument(market.mic);
    await login(page, owner);
    const headers = { Origin: FRONTEND_URL };
    async function create(path: string, data: object) {
      const response = await page.request.post(API_URL + path, {
        headers,
        data,
      });
      expect(response.status()).toBe(201);
      return (await response.json()) as { id: string; signal?: { id: string } };
    }
    const portfolio = await create('/investments/portfolios', {
      name: 'Portfel strategii testowej',
    });
    const accountPath = `/investments/portfolios/${portfolio.id}/accounts`;
    const account = await create(accountPath, {
      name: 'Rachunek strategii testowej',
    });
    const base = `${accountPath}/${account.id}`;
    await create(`${base}/events`, {
      type: 'DEPOSIT',
      currency: market.currency,
      amount: '1000',
      occurredOn: zonedClock(new Date(), 'Europe/Warsaw').day,
      timePrecision: 'DATE',
      daySequence: 1,
      idempotencyKey: 'paper-workflow-signal-deposit',
    });
    const strategy = await create(`${base}/strategies`, {
      name: 'Test SMA',
      instrumentId: instrument.id,
      parameters: { fastSessions: 2, slowSessions: 3, validForMinutes: 60 },
    });
    const decisionAt = new Date();
    let on = expectedSession(market.mic, decisionAt);
    for (const close of ['125', '95', '85', '120']) {
      await accounts.investmentQuote(instrument.id, close, on, decisionAt);
      do {
        on = previousDay(on);
      } while (!session(market.mic, on).trading);
    }
    const decision = await create(`${base}/strategies/${strategy.id}/runs`, {
      decidedAt: decisionAt.toISOString(),
    });
    expect(decision.signal?.id).toBeTruthy();
    await page.goto(
      `/dashboard/investments/${portfolio.id}/accounts/${account.id}/strategies`,
    );
    await page
      .getByRole('link', { name: 'Przenieś sygnał do symulatora' })
      .click();
    await expect(page).toHaveURL(
      new RegExp(`/paper\\?signal=${decision.signal!.id}$`),
    );
    await page
      .getByLabel('Nazwa rachunku', { exact: true })
      .fill('Lokalny test');
    await page.getByLabel('Kapitał PLN').fill('1000');
    await page.getByLabel('Kapitał USD').fill('1000');
    await page
      .getByRole('button', { name: 'Utwórz rachunek symulowany' })
      .click();

    await expect(
      page.getByText(`Ze strategii: Kupno ${instrument.ticker}`, {
        exact: false,
      }),
    ).toBeVisible();
    await page.getByLabel('Ilość zlecenia').fill(market.ordered);
    await page.getByRole('button', { name: 'Zapisz intencję' }).click();
    const order = page.getByRole('article', {
      name: new RegExp(`Zlecenie ${instrument.ticker}`),
    });
    await expect(order.getByText('Intencja', { exact: true })).toBeVisible();
    if (market.mic === 'XWAR') {
      await order
        .getByLabel('Scenariusz wysyłki')
        .selectOption('SESSION_EXPIRED');
      await order.getByRole('button', { name: 'Wyślij do symulatora' }).click();
      await expect(order.getByRole('alert')).toContainText(
        'Sesja symulatora wygasła',
      );
      await order.getByLabel('Scenariusz wysyłki').selectOption('NONE');
    }
    await order.getByRole('button', { name: 'Wyślij do symulatora' }).click();
    await expect(order.getByText('Przyjęte', { exact: true })).toBeVisible();
    await order.getByLabel('Ilość wykonania').fill(market.filled);
    await order
      .getByLabel(`Cena wykonania w ${market.currency}`)
      .fill(market.price);
    await order.getByLabel(`Prowizja w ${market.currency}`).fill(market.fee);
    await order
      .getByRole('button', { name: 'Zapisz zdarzenie symulatora' })
      .click();
    const position = page.getByRole('list', { name: 'Otwarte pozycje' });
    await expect(
      position.getByText(
        `${instrument.ticker} · ${market.mic} · ${market.filled} szt.`,
      ),
    ).toBeVisible();
    const reconcile = page.getByRole('button', { name: 'Uzgodnij rachunek' });
    await reconcile.click();
    if (market.mic === 'XWAR') {
      await order
        .getByRole('combobox', { name: 'Zdarzenie', exact: true })
        .selectOption('CANCELLED');
      await order
        .getByRole('button', { name: 'Zapisz zdarzenie symulatora' })
        .click();
      await expect(order.getByText('Anulowane', { exact: true })).toBeVisible();
      await reconcile.click();
    } else {
      await expect(order.getByText('Wykonane', { exact: true })).toBeVisible();
    }
    await expect(
      page.getByText('Rachunek wymaga uzgodnienia.', { exact: false }),
    ).toHaveCount(0);
    await expect(
      page.getByText('Rachunek uzgodniony', { exact: false }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page
        .getByRole('region', { name: 'Gotówka i pozycje' })
        .getByText(market.cash, { exact: true }),
    ).toBeVisible();
    await expect(
      order.getByText('Sygnał strategii', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText('Rachunek uzgodniony', { exact: false }),
    ).toBeVisible();
  });
}
