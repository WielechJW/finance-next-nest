import request from 'supertest';
import { investmentHttpContext } from './support/investment-http.js';

const file = Buffer.from(
  'type,occurredOn,currency,amount\nDEPOSIT,2025-01-08,PLN,1000.02\nDEPOSIT,2025-01-09,EUR,1',
);

describe('Investment CSV import batches (PostgreSQL)', () => {
  let context: Awaited<ReturnType<typeof investmentHttpContext>>;
  beforeAll(async () => {
    context = await investmentHttpContext();
  });
  afterEach(async () => {
    await context.cleanup();
  });
  afterAll(async () => {
    await context?.app.close();
  });

  async function setup() {
    const owner = await context.signIn();
    const portfolio = await owner.agent
      .post('/investments/portfolios')
      .send({ name: 'Portfel importu' })
      .expect(201);
    const accounts = `/investments/portfolios/${portfolio.body.id}/accounts`;
    const account = await owner.agent
      .post(accounts)
      .send({ name: 'CSV' })
      .expect(201);
    const path = `${accounts}/${account.body.id}`;
    return {
      ...owner,
      path,
      imports: `${path}/imports`,
      accountId: account.body.id as string,
    };
  }

  it('persists only parsed rows and errors, is idempotent under concurrent upload, and leaves the ledger untouched', async () => {
    const owner = await setup();
    const upload = () =>
      owner.agent
        .post(owner.imports)
        .set('Origin', context.origin)
        .field('format', 'GENERIC')
        .attach('csv', file, 'fixture.csv')
        .expect(201);
    const [first, retry] = await Promise.all([upload(), upload()]);
    expect(first.body).toEqual(retry.body);
    expect(first.body).toMatchObject({
      authorId: owner.userId,
      format: 'GENERIC',
      status: 'INVALID',
      encoding: 'utf-8',
      separator: ',',
      rows: [
        {
          number: 2,
          data: { amount: '1000.02', type: 'DEPOSIT' },
          error: null,
        },
        { number: 3, data: null, error: expect.stringContaining('PLN i USD') },
      ],
    });
    expect(first.body).not.toHaveProperty('contentHash');
    const list = await owner.agent
      .get(owner.imports)
      .expect(200)
      .expect('Cache-Control', 'no-store');
    expect(list.body).toMatchObject([
      { id: first.body.id, _count: { rows: 2 } },
    ]);
    expect(list.body[0]).not.toHaveProperty('rows');
    await owner.agent
      .get(`${owner.imports}/${first.body.id}`)
      .expect(200, first.body);
    await owner.agent
      .get(`${owner.path}/summary`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.cash).toEqual({ PLN: '0.00', USD: '0.00' });
      });
    expect(
      await context.prisma.investmentEvent.count({
        where: { accountId: owner.accountId },
      }),
    ).toBe(0);
  });

  it('rejects other accounts, archived accounts, oversized files and an invalid CSV header', async () => {
    const owner = await setup();
    const other = await setup();
    await request(context.app.getHttpServer()).get(owner.imports).expect(401);
    await other.agent.get(owner.imports).expect(404);
    await other.agent
      .post(owner.imports)
      .set('Origin', context.origin)
      .field('format', 'GENERIC')
      .attach('csv', file, 'fixture.csv')
      .expect(404);
    const upload = (data: Buffer) =>
      owner.agent
        .post(owner.imports)
        .set('Origin', context.origin)
        .field('format', 'GENERIC')
        .attach('csv', data, 'fixture.csv');
    await upload(Buffer.from('wrong,header')).expect(400);
    await upload(Buffer.alloc(1024 * 1024 + 1)).expect(413);
    const created = await upload(file).expect(201);
    await other.agent.get(`${other.imports}/${created.body.id}`).expect(404);
    await owner.agent
      .patch(owner.path)
      .set('Origin', context.origin)
      .send({ archived: true })
      .expect(200);
    await upload(file).expect(409);
    await owner.agent.get(`${owner.imports}/${created.body.id}`).expect(200);
  });

  it('warns on overlaps with manual events and lets the owner map an unknown ticker in its own currency', async () => {
    const owner = await setup();
    const other = await setup();
    await owner.agent
      .post(`${owner.path}/events`)
      .send({
        type: 'DEPOSIT',
        currency: 'USD',
        amount: '20.00',
        occurredOn: '2025-01-08',
        timePrecision: 'DATE',
        daySequence: 1,
        idempotencyKey: 'manual-before-import',
      })
      .expect(201);
    const instrument = await context.prisma.instrument.create({
      data: { ticker: 'IMPORT81TEST', mic: 'XNAS', currency: 'USD' },
    });
    try {
      const rows = [
        [
          'type',
          'occurredOn',
          'currency',
          'amount',
          'ticker',
          'mic',
          'quantity',
          'unitPrice',
          'commission',
          'externalId',
          'soldCurrency',
          'boughtCurrency',
          'soldAmount',
          'boughtAmount',
          'grossAmount',
          'withholdingTax',
        ],
        [
          'DEPOSIT',
          '2025-01-08',
          'USD',
          '20',
          '',
          '',
          '',
          '',
          '',
          'd1',
          '',
          '',
          '',
          '',
          '',
          '',
        ],
        [
          'DEPOSIT',
          '2025-01-08',
          'USD',
          '20',
          '',
          '',
          '',
          '',
          '',
          'd2',
          '',
          '',
          '',
          '',
          '',
          '',
        ],
        [
          'BUY',
          '2025-01-09',
          'USD',
          '',
          'UNKNOWNCSV',
          'XNAS',
          '2',
          '9',
          '0.25',
          'p1',
          '',
          '',
          '',
          '',
          '',
          '',
        ],
        [
          'BUY',
          '2025-01-09',
          'PLN',
          '',
          instrument.ticker,
          'XNAS',
          '2',
          '9',
          '0.25',
          'p2',
          '',
          '',
          '',
          '',
          '',
          '',
        ],
        [
          'FX',
          '2025-01-09',
          '',
          '',
          '',
          '',
          '',
          '',
          '0.10',
          'fx1',
          'PLN',
          'USD',
          '40',
          '10',
          '',
          '',
        ],
        [
          'DIVIDEND',
          '2025-01-09',
          'USD',
          '',
          '',
          '',
          '',
          '',
          '',
          'dv1',
          '',
          '',
          '',
          '',
          '5',
          '1',
        ],
        [
          'DEPOSIT',
          '2025-02-30',
          'USD',
          '20',
          '',
          '',
          '',
          '',
          '',
          'd3',
          '',
          '',
          '',
          '',
          '',
          '',
        ],
      ];
      const upload = await owner.agent
        .post(owner.imports)
        .set('Origin', context.origin)
        .field('format', 'GENERIC')
        .attach(
          'csv',
          Buffer.from(rows.map((row) => row.join(',')).join('\n')),
          'preview.csv',
        )
        .expect(201);
      const { id } = upload.body as { id: string };
      const preview = `${owner.imports}/${id}/preview`;
      await other.agent.get(preview).expect(404);
      const read = await owner.agent
        .get(preview)
        .expect(200)
        .expect('Cache-Control', 'no-store');
      expect(read.body).toMatchObject([
        {
          number: 2,
          duplicate: 'POSSIBLE',
          details: { currency: 'USD', amount: '20' },
        },
        { number: 3, duplicate: 'POSSIBLE' },
        {
          number: 4,
          instrument: null,
          mappingError: expect.stringContaining('Nie znaleziono'),
          details: { commission: '0.25' },
        },
        {
          number: 5,
          instrument: null,
          mappingError: expect.stringContaining('Waluta'),
        },
        {
          number: 6,
          needsInstrument: false,
          details: {
            soldCurrency: 'PLN',
            boughtCurrency: 'USD',
            commission: '0.1',
          },
        },
        { number: 7, details: { grossAmount: '5', withholdingTax: '1' } },
      ]);
      const map = (number: number) =>
        `${owner.imports}/${id}/rows/${number}/instrument`;
      await other.agent
        .patch(map(4))
        .set('Origin', context.origin)
        .send({ instrumentId: instrument.id })
        .expect(404);
      await owner.agent
        .patch(map(5))
        .set('Origin', context.origin)
        .send({ instrumentId: instrument.id })
        .expect(400);
      await owner.agent
        .patch(map(4))
        .set('Origin', context.origin)
        .send({ instrumentId: instrument.id })
        .expect(204);
      const mapped = await owner.agent.get(preview).expect(200);
      expect(mapped.body[2]).toMatchObject({
        number: 4,
        instrument: { id: instrument.id },
        mappingError: null,
      });
      await owner.agent
        .patch(map(4))
        .set('Origin', context.origin)
        .send({ instrumentId: null })
        .expect(204);
      expect(
        (await owner.agent.get(preview).expect(200)).body[2],
      ).toMatchObject({ instrument: null });
      expect(
        await context.prisma.investmentEvent.count({
          where: { accountId: owner.accountId },
        }),
      ).toBe(1);
    } finally {
      await context.prisma.instrument.delete({ where: { id: instrument.id } });
    }
  });

  it('rolls back a failed posting, then confirms a valid batch exactly once and reports broker differences', async () => {
    const owner = await setup();
    const other = await setup();
    const input = {
      completeHistory: true,
      asOf: '2025-01-10',
      cash: { PLN: '179.00', USD: '0' },
      positions: [],
      decisions: [],
    };
    const upload = async (content: string) => {
      const report = await owner.agent
        .post(owner.imports)
        .set('Origin', context.origin)
        .field('format', 'GENERIC')
        .attach(
          'csv',
          Buffer.from('type,occurredOn,currency,amount,externalId\n' + content),
          'confirmation.csv',
        )
        .expect(201);
      return report.body.id as string;
    };
    const confirm = (id: string, changes: object = {}) =>
      owner.agent
        .post(`${owner.imports}/${id}/confirm`)
        .set('Origin', context.origin)
        .send({ ...input, ...changes });
    const bad = await upload(
      'DEPOSIT,2025-01-08,PLN,200,cash-1\nWITHDRAWAL,2025-01-09,PLN,400,cash-2',
    );
    await confirm(bad).expect(409);
    expect(
      await context.prisma.investmentEvent.count({
        where: { accountId: owner.accountId },
      }),
    ).toBe(0);
    expect(
      (await owner.agent.get(`${owner.imports}/${bad}`).expect(200)).body
        .status,
    ).toBe('PARSED');
    const good = await upload(
      'DEPOSIT,2025-01-08,PLN,200,cash-1\nWITHDRAWAL,2025-01-09,PLN,20,cash-2',
    );
    await other.agent
      .post(`${owner.imports}/${good}/confirm`)
      .set('Origin', context.origin)
      .send(input)
      .expect(404);
    const [first, retry] = await Promise.all([
      confirm(good).expect(200),
      confirm(good).expect(200),
    ]);
    expect(retry.body).toEqual(first.body);
    expect(first.body).toMatchObject({
      posted: 2,
      skipped: [],
      reconciliation: {
        asOf: '2025-01-10',
        cash: [
          {
            currency: 'PLN',
            expected: '179.00',
            actual: '180.00',
            difference: '1',
          },
        ],
        positions: [],
      },
    });
    await confirm(good, { cash: { PLN: '180', USD: '0' } }).expect(409);
    const read = await owner.agent.get(`${owner.imports}/${good}`).expect(200);
    expect(read.body).toMatchObject({
      status: 'CONFIRMED',
      confirmation: first.body,
    });
    const overlap = await upload('DEPOSIT,2025-01-08,PLN,200.00,cash-1');
    expect((await confirm(overlap).expect(200)).body).toMatchObject({
      posted: 0,
      skipped: [2],
    });
    const mismatched = await upload('DEPOSIT,2025-01-08,PLN,201,cash-1');
    await confirm(mismatched).expect(409);
    expect(
      await context.prisma.investmentEvent.count({
        where: { accountId: owner.accountId },
      }),
    ).toBe(2);
  });

  it('requires an explicit state for partial history and supports a dated opening lot', async () => {
    const owner = await setup();
    const stock = await context.prisma.instrument.create({
      data: { ticker: 'IMPORT82TEST', mic: 'XNAS', currency: 'USD' },
    });
    try {
      const file = [
        'type,occurredOn,currency,ticker,mic,quantity,totalCost,acquiredOn,unitPrice,externalId',
        `OPENING_POSITION,2025-01-01,USD,${stock.ticker},XNAS,2,15,2024-04-30,,opening`,
        `SELL,2025-01-08,USD,${stock.ticker},XNAS,1,,,10,sale`,
      ].join('\n');
      const saved = await owner.agent
        .post(owner.imports)
        .set('Origin', context.origin)
        .field('format', 'GENERIC')
        .attach('csv', Buffer.from(file), 'partial.csv')
        .expect(201);
      const id = saved.body.id as string;
      const path = `${owner.imports}/${id}/confirm`;
      const partial = {
        completeHistory: false,
        asOf: '2025-01-09',
        cash: { PLN: '0', USD: '10' },
        positions: [{ instrumentId: stock.id, quantity: '2' }],
        decisions: [],
      };
      const confirm = (changes: object = {}) =>
        owner.agent
          .post(path)
          .set('Origin', context.origin)
          .send({ ...partial, ...changes });
      await confirm().expect(400);
      await confirm({ openingOn: '2025-01-01', openingEmpty: true }).expect(
        409,
      );
      const result = await confirm({ openingOn: '2025-01-01' }).expect(200);
      expect(result.body).toMatchObject({
        posted: 2,
        reconciliation: {
          cash: [],
          positions: [
            {
              instrumentId: stock.id,
              expected: '2',
              actual: '1.0000000000',
              difference: '-1',
            },
          ],
        },
      });
      const balances = await owner.agent
        .get(`${owner.path}/summary`)
        .expect(200);
      expect(balances.body).toMatchObject({
        cash: { USD: '10.00' },
        positions: [{ quantity: '1.0000000000', cost: '7.50000000' }],
      });
      await owner.agent
        .patch(`${owner.imports}/${id}/rows/2/instrument`)
        .set('Origin', context.origin)
        .send({ instrumentId: stock.id })
        .expect(409);
    } finally {
      await context.cleanup();
      await context.prisma.instrument.delete({ where: { id: stock.id } });
    }
  });
});
