import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { investmentHttpContext } from './support/investment-http.js';

describe('Readiness and operator controls', () => {
  let ctx: Awaited<ReturnType<typeof investmentHttpContext>>;
  const keys: string[] = [];
  beforeAll(async () => {
    ctx = await investmentHttpContext();
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await ctx.prisma.marketJob.deleteMany({ where: { key: { in: keys } } });
    keys.length = 0;
    await ctx.cleanup();
  });
  afterAll(async () => {
    await ctx?.app.close();
  });
  it('exposes safe liveness and readiness without needing a market provider', async () => {
    vi.stubEnv('MARKET_DATA_ENABLED', '0');
    expect(
      (await request(ctx.app.getHttpServer()).get('/health/live').expect(200))
        .body,
    ).toEqual({ alive: true });
    expect(
      (await request(ctx.app.getHttpServer()).get('/health/ready').expect(200))
        .body,
    ).toEqual({ ready: true, database: true, redis: null, worker: null });
    vi.stubEnv('MARKET_DATA_ENABLED', '1');
    vi.stubEnv('REDIS_URL', 'invalid');
    const response = await request(ctx.app.getHttpServer())
      .get('/health/ready')
      .expect(503);
    expect(JSON.stringify(response.body)).not.toContain('invalid');
  });
  it('limits monitoring/retry to the configured operator and excludes delivery jobs', async () => {
    const operator = await ctx.signIn(),
      user = await ctx.signIn();
    vi.stubEnv('OPERATOR_USER_ID', operator.userId);
    await request(ctx.app.getHttpServer())
      .get('/operations/market-data')
      .expect(401);
    await user.agent.get('/operations/market-data').expect(403);
    const key = `operations-test-${randomUUID()}`;
    keys.push(key);
    const job = await ctx.prisma.marketJob.create({
      data: {
        key,
        kind: 'prices',
        payload: { private: 'private-payload' },
        status: 'FAILED',
        attempts: 5,
        errorCode: 'access',
      },
    });
    const response = await operator.agent
      .get('/operations/market-data')
      .expect(200);
    expect(JSON.stringify(response.body)).not.toContain('private-payload');
    await user.agent
      .post(`/operations/market-data/jobs/${job.id}/retry`)
      .set('Origin', ctx.origin)
      .send({})
      .expect(403);
    await operator.agent
      .post(`/operations/market-data/jobs/${job.id}/retry`)
      .set('Origin', ctx.origin)
      .send({})
      .expect(201);
    expect(
      (await ctx.prisma.marketJob.findUniqueOrThrow({ where: { id: job.id } }))
        .status,
    ).toBe('PENDING');
    await ctx.prisma.marketJob.update({
      where: { id: job.id },
      data: { kind: 'notification', status: 'FAILED' },
    });
    await operator.agent
      .post(`/operations/market-data/jobs/${job.id}/retry`)
      .set('Origin', ctx.origin)
      .send({})
      .expect(400);
  });
});
