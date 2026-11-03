import { randomUUID } from 'node:crypto';
import { Logger, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getOptionsToken } from '@nestjs/throttler';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/config/configure-app.js';
import { getFrontendOrigin } from '../src/config/cors.js';
import { getAuthRateLimitOptions } from '../src/config/rate-limit.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import type { WalletResponse } from '../src/wallets/wallet-response.js';

describe('Private wallet API (PostgreSQL)', () => {
  const password = 'Wallet integration test password 123!';
  const origin = getFrontendOrigin();
  const userIds = new Set<string>();
  const sessionIds = new Set<string>();
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(getOptionsToken())
      .useFactory({
        factory: () =>
          getAuthRateLimitOptions({
            AUTH_LOGIN_LIMIT: '1000',
            AUTH_REGISTER_LIMIT: '1000',
          }),
      })
      .compile();
    app = module.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (prisma && (userIds.size || sessionIds.size)) {
      await prisma.session.deleteMany({
        where: {
          OR: [
            { sid: { in: [...sessionIds] } },
            ...[...userIds].map((id) => ({
              sess: { path: ['userId'], equals: id },
            })),
          ],
        },
      });
      await prisma.user.deleteMany({ where: { id: { in: [...userIds] } } });
    }
    userIds.clear();
    sessionIds.clear();
  });

  afterAll(async () => {
    await app?.close();
  });

  async function createAccount() {
    const email = `wallet-api-${randomUUID()}@example.invalid`;
    const agent = request.agent(app.getHttpServer());
    const registration = await agent
      .post('/auth/register')
      .send({ email, password })
      .expect(201);
    const user = registration.body as { id: string; email: string };
    userIds.add(user.id);

    const login = await agent
      .post('/auth/login')
      .send({ email, password })
      .expect(200);
    const headers = login.headers['set-cookie'] as string[];
    const cookie = headers
      .find((header) => header.startsWith('finance.sid='))!
      .split(';')[0]!;
    const sid = decodeURIComponent(cookie.slice(cookie.indexOf('=') + 1))
      .slice(2)
      .split('.')[0]!;
    sessionIds.add(sid);
    return { agent, user, cookie, sid };
  }

  it('requires a session for both reading and updating a wallet', async () => {
    await request(app.getHttpServer()).get('/wallet').expect(401);
    await request(app.getHttpServer())
      .patch('/wallet')
      .set('Origin', origin)
      .send({ name: 'Unauthorized change' })
      .expect(401);
  });

  it('returns only the new account wallet with fixed-point amounts and no caching', async () => {
    const { agent, user } = await createAccount();
    const stored = await prisma.wallet.findUniqueOrThrow({
      where: { userId: user.id },
    });
    const response = await agent
      .get('/wallet')
      .set('Origin', origin)
      .expect(200);
    expect(response.body).toEqual({
      id: stored.id,
      name: 'Mój portfel',
      currency: 'PLN',
      openingBalance: '0.00',
      balance: '0.00',
    });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['access-control-allow-origin']).toBe(origin);
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });

  it('updates both settings from the trusted frontend and persists them for the next read', async () => {
    const { agent } = await createAccount();
    const response = await agent
      .patch('/wallet')
      .set('Origin', origin)
      .set('Sec-Fetch-Site', 'same-site')
      .send({ name: '  Budżet domowy  ', openingBalance: '-250.50' })
      .expect(200);
    const wallet = response.body as WalletResponse;
    expect(wallet).toEqual({
      id: expect.any(String),
      name: 'Budżet domowy',
      currency: 'PLN',
      openingBalance: '-250.50',
      balance: '-250.50',
    });
    expect(response.headers['cache-control']).toBe('no-store');
    const nextRead = await agent.get('/wallet').expect(200);
    expect(nextRead.body).toEqual(wallet);
  });

  it('preserves omitted fields across partial updates and accepts a 100-character name', async () => {
    const { agent } = await createAccount();
    await agent
      .patch('/wallet')
      .send({ openingBalance: '123.45' })
      .expect(200)
      .expect(({ body }) => {
        expect(body.name).toBe('Mój portfel');
      });
    const name = 'ą'.repeat(100);
    await agent
      .patch('/wallet')
      .send({ name: `  ${name}  ` })
      .expect(200)
      .expect(({ body }) => {
        expect(body.name).toBe(name);
        expect(body.openingBalance).toBe('123.45');
      });
    await agent
      .patch('/wallet')
      .send({ openingBalance: '0.20' })
      .expect(200)
      .expect(({ body }) => {
        expect(body.name).toBe(name);
        expect(body.balance).toBe('0.20');
      });
  });

  it('does not lose independent fields when partial updates arrive concurrently', async () => {
    const { agent } = await createAccount();
    await Promise.all([
      agent.patch('/wallet').send({ name: 'Nowa nazwa' }).expect(200),
      agent.patch('/wallet').send({ openingBalance: '0.10' }).expect(200),
    ]);
    const response = await agent.get('/wallet').expect(200);
    expect(response.body).toMatchObject({
      name: 'Nowa nazwa',
      openingBalance: '0.10',
      balance: '0.10',
    });
  });

  it.each([
    ['0.00', '0.00'],
    ['-0.00', '0.00'],
    ['0.10', '0.10'],
    ['0.20', '0.20'],
    ['-0.01', '-0.01'],
    ['-123.45', '-123.45'],
    ['999999999999.99', '999999999999.99'],
    ['-999999999999.99', '-999999999999.99'],
  ])(
    'stores %s without changing its cents and returns %s',
    async (input, expected) => {
      const { agent, user } = await createAccount();
      const response = await agent
        .patch('/wallet')
        .send({ openingBalance: input })
        .expect(200);
      expect(response.body.openingBalance).toBe(expected);
      expect(response.body.balance).toBe(expected);
      const stored = await prisma.wallet.findUniqueOrThrow({
        where: { userId: user.id },
      });
      expect(stored.openingBalance.toFixed(2)).toBe(expected);
    },
  );

  it.each([
    {},
    { name: '' },
    { name: ' \n\t ' },
    { name: 'a'.repeat(101) },
    { name: null },
    { name: 123 },
    { name: true },
    { name: [] },
    { name: {} },
    { openingBalance: null },
    { openingBalance: 12.34 },
    { openingBalance: false },
    { openingBalance: [] },
    { openingBalance: {} },
    { openingBalance: '' },
    { openingBalance: '12' },
    { openingBalance: '12.3' },
    { openingBalance: '12.345' },
    { openingBalance: '-12.345' },
    { openingBalance: '12,34' },
    { openingBalance: '+12.34' },
    { openingBalance: '01.00' },
    { openingBalance: '.10' },
    { openingBalance: '1e2' },
    { openingBalance: 'NaN' },
    { openingBalance: 'Infinity' },
    { openingBalance: ' 12.34' },
    { openingBalance: '12.34 ' },
    { openingBalance: '12.34\n' },
    { openingBalance: '12.34\r\n' },
    { openingBalance: '1000000000000.00' },
    { openingBalance: '-1000000000000.00' },
    { openingBalance: '9'.repeat(1000) + '.00' },
    { name: 'Valid name', openingBalance: '0.001' },
    { name: null, openingBalance: '1.00' },
  ])(
    'rejects invalid settings without modifying the wallet (%#)',
    async (body) => {
      const { agent, user } = await createAccount();
      const before = await prisma.wallet.findUniqueOrThrow({
        where: { userId: user.id },
      });
      await agent.patch('/wallet').send(body).expect(400);
      expect(
        await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } }),
      ).toEqual(before);
    },
  );

  it.each(['null', '[]', '[{"name":"Injected"}]', '"text"', '42'])(
    'rejects a JSON body that is not an object: %s',
    async (body) => {
      const { agent, user } = await createAccount();
      await agent
        .patch('/wallet')
        .set('Content-Type', 'application/json')
        .send(body)
        .expect(400);
      const wallet = await prisma.wallet.findUniqueOrThrow({
        where: { userId: user.id },
      });
      expect(wallet.name).toBe('Mój portfel');
      expect(wallet.openingBalance.toFixed(2)).toBe('0.00');
    },
  );

  it('isolates two accounts and rejects client-selected ownership and read-only fields', async () => {
    const a = await createAccount();
    const b = await createAccount();
    await a.agent
      .patch('/wallet')
      .send({ name: 'Portfel A', openingBalance: '10.10' })
      .expect(200);
    await b.agent
      .patch('/wallet')
      .send({ name: 'Portfel B', openingBalance: '-20.20' })
      .expect(200);
    const before = await prisma.wallet.findMany({
      where: { userId: { in: [a.user.id, b.user.id] } },
      orderBy: { id: 'asc' },
    });
    const walletB = before.find((wallet) => wallet.userId === b.user.id)!;

    const read = await a.agent
      .get('/wallet')
      .query({ userId: b.user.id, walletId: walletB.id })
      .expect(200);
    expect(read.body).toMatchObject({ name: 'Portfel A', balance: '10.10' });
    expect(read.body.id).not.toBe(walletB.id);

    for (const extra of [
      { userId: b.user.id },
      { walletId: walletB.id },
      { id: walletB.id },
      { balance: '999.99' },
      { currency: 'EUR' },
      { currency: 'PLN' },
      { user: { connect: { id: b.user.id } } },
    ]) {
      await a.agent
        .patch('/wallet')
        .send({ name: 'Injected change', ...extra })
        .expect(400);
    }
    expect(
      await prisma.wallet.findMany({
        where: { userId: { in: [a.user.id, b.user.id] } },
        orderBy: { id: 'asc' },
      }),
    ).toEqual(before);
    const readB = await b.agent.get('/wallet').expect(200);
    expect(readB.body).toMatchObject({ name: 'Portfel B', balance: '-20.20' });

    await a.agent
      .patch('/wallet')
      .send({ openingBalance: '30.30' })
      .expect(200);
    const unchangedB = await b.agent.get('/wallet').expect(200);
    expect(unchangedB.body).toEqual(readB.body);
  });

  it('rejects foreign browser writes before modifying an authenticated wallet', async () => {
    const { agent, user } = await createAccount();
    const before = await prisma.wallet.findUniqueOrThrow({
      where: { userId: user.id },
    });
    for (const headers of [
      { Origin: 'https://foreign.example', 'Sec-Fetch-Site': 'cross-site' },
      { Origin: 'http://localhost:4444', 'Sec-Fetch-Site': 'same-site' },
      { Origin: 'null' },
      { 'Sec-Fetch-Site': 'cross-site' },
    ]) {
      await agent
        .patch('/wallet')
        .set(headers)
        .send({ name: 'Foreign change', openingBalance: '999.99' })
        .expect(403);
    }
    expect(
      await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } }),
    ).toEqual(before);
    await agent.get('/wallet').expect(200);
  });

  it('allows the credentialed PATCH preflight from the configured frontend', async () => {
    const response = await request(app.getHttpServer())
      .options('/wallet')
      .set('Origin', origin)
      .set('Access-Control-Request-Method', 'PATCH')
      .set('Access-Control-Request-Headers', 'content-type')
      .expect(204);
    expect(response.headers['access-control-allow-origin']).toBe(origin);
    expect(response.headers['access-control-allow-credentials']).toBe('true');
    expect(
      response.headers['access-control-allow-methods'].split(','),
    ).toContain('PATCH');
    expect(
      response.headers['access-control-allow-headers'].toLowerCase(),
    ).toContain('content-type');
  });

  it('rejects an expired session on both wallet endpoints', async () => {
    const { user, cookie, sid } = await createAccount();
    await prisma.session.update({
      where: { sid },
      data: { expire: new Date(0) },
    });
    await request(app.getHttpServer())
      .get('/wallet')
      .set('Cookie', cookie)
      .expect(401);
    await request(app.getHttpServer())
      .patch('/wallet')
      .set('Cookie', cookie)
      .send({ openingBalance: '100.00' })
      .expect(401);
    const wallet = await prisma.wallet.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(wallet.openingBalance.toFixed(2)).toBe('0.00');
  });

  it('rejects a copied cookie after logout', async () => {
    const { agent, cookie } = await createAccount();
    await agent.post('/auth/logout').expect(204);
    await request(app.getHttpServer())
      .get('/wallet')
      .set('Cookie', cookie)
      .expect(401);
    await request(app.getHttpServer())
      .patch('/wallet')
      .set('Cookie', cookie)
      .send({ name: 'Old session' })
      .expect(401);
  });

  it('returns 404 for a missing wallet without creating one during a read or update', async () => {
    const { agent, user } = await createAccount();
    await prisma.wallet.delete({ where: { userId: user.id } });
    await agent.get('/wallet').expect(404);
    await agent.patch('/wallet').send({ name: 'Missing wallet' }).expect(404);
    expect(await prisma.wallet.count({ where: { userId: user.id } })).toBe(0);
  });

  it.each(['get', 'patch'] as const)(
    'sanitizes database errors in the %s response and logs',
    async (method) => {
      const { agent, user } = await createAccount();
      const before = await prisma.wallet.findUniqueOrThrow({
        where: { userId: user.id },
      });
      const privateDetail = 'private-wallet-query-with-sensitive-arguments';
      const log = vi
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => {});
      if (method === 'get') {
        vi.spyOn(prisma.wallet, 'findUnique').mockRejectedValueOnce(
          new Error(privateDetail),
        );
      } else {
        vi.spyOn(prisma.wallet, 'update').mockRejectedValueOnce(
          new Error(privateDetail),
        );
      }
      const operation = agent[method]('/wallet');
      if (method === 'patch') operation.send({ name: 'Failed update' });
      const response = await operation.expect(500);
      expect(response.body.message).toBe(
        method === 'get'
          ? 'Nie udało się pobrać portfela.'
          : 'Nie udało się zapisać portfela.',
      );
      expect(log).toHaveBeenCalled();
      expect(JSON.stringify([response.body, log.mock.calls])).not.toContain(
        privateDetail,
      );
      expect(
        await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } }),
      ).toEqual(before);
    },
  );
});
