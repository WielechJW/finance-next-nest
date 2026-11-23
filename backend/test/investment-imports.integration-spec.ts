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
});
