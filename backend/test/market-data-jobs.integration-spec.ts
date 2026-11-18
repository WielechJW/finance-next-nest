import { randomUUID } from 'node:crypto';
import { Queue } from 'bullmq';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { MarketJobsService } from '../src/jobs/jobs.service.js';
import { MarketWorkerRuntime } from '../src/jobs/runtime.js';
import { redisConnection } from '../src/jobs/redis.js';
import { MarketDataError } from '../src/market-data/contracts.js';

describe('Durable market jobs and isolated Redis', () => {
  let prisma: PrismaService;
  let jobs: MarketJobsService;
  const prefix = `market-test-${randomUUID()}`;
  const connection = redisConnection(process.env.REDIS_URL_TEST, true);
  beforeAll(async () => { prisma = new PrismaService(); await prisma.$connect(); jobs = new MarketJobsService(prisma); });
  afterAll(async () => {
    await prisma?.marketJob.deleteMany({ where: { key: { startsWith: prefix } } });
    await prisma?.$disconnect();
  });
  it('serializes claims, recovers an expired process and refuses a stale completion token', async () => {
    const job = await jobs.ensure(`${prefix}-lease`, 'prices', {});
    const now = new Date();
    const claims = await Promise.all([jobs.begin(job.id, now), jobs.begin(job.id, now)]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const first = claims.find(Boolean)!;
    const recovered = await jobs.begin(job.id, new Date(now.getTime() + 121000));
    expect(recovered?.runToken).not.toBe(first.runToken);
    expect((await jobs.complete(job.id, first.runToken!)).count).toBe(0);
    await jobs.complete(job.id, recovered!.runToken!);
  });
  it('rebuilds an erased Redis queue from PostgreSQL and executes a business job only once', async () => {
    const name = `finance-test-${randomUUID()}`;
    const row = await jobs.ensure(`${prefix}-recover`, 'prices', {});
    const oldQueue = new Queue(name, { connection });
    await oldQueue.add('execute', { id: row.id }, { jobId: row.id });
    await oldQueue.obliterate({ force: true });
    await oldQueue.close();
    let executions = 0;
    const runtime = new MarketWorkerRuntime(jobs, connection, async job => { if (job.id === row.id) executions += 1; }, name);
    try {
      await runtime.worker.waitUntilReady();
      await runtime.dispatch();
      await vi.waitFor(async () => { expect((await prisma.marketJob.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('SUCCEEDED'); }, { timeout: 8000 });
      await runtime.dispatch();
      expect(executions).toBe(1);
    } finally { await runtime.close(); const clean = new Queue(name, { connection }); await clean.obliterate({ force: true }); await clean.close(); }
  }, 15000);
  it('delays a quota-blocked job until the next UTC day without exposing raw error text', async () => {
    const row = await jobs.ensure(`${prefix}-quota`, 'prices', {});
    const claim = await jobs.begin(row.id);
    await jobs.fail(row.id, claim!.runToken!, new MarketDataError('budget', 'PRIVATE_INTERNAL_DETAILS'));
    const stored = await prisma.marketJob.findUniqueOrThrow({ where: { id: row.id } });
    expect(stored.status).toBe('RETRY');
    expect(stored.errorCode).toBe('budget');
    expect(stored.runAfter.getTime()).toBeGreaterThan(Date.now());
    expect(JSON.stringify(stored)).not.toContain('PRIVATE_INTERNAL_DETAILS');
  });
});
