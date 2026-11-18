import { randomUUID } from 'node:crypto';
import { MarketDataBudgetService } from '../src/market-data/budget.service.js';
import { MarketInstrumentsService } from '../src/market-data/instruments.service.js';
import type { EodhdProvider } from '../src/market-data/eodhd.provider.js';
import { investmentHttpContext } from './support/investment-http.js';

describe('Market catalog and shared budget (PostgreSQL)', () => {
  let context: Awaited<ReturnType<typeof investmentHttpContext>>;
  const ids: string[] = [];
  const keyHash = randomUUID().replaceAll('-', '').padEnd(64, '0');
  beforeAll(async () => { context = await investmentHttpContext(); });
  afterEach(async () => {
    await context.prisma.instrumentProviderMapping.deleteMany({ where: { instrumentId: { in: ids } } });
    await context.prisma.instrument.deleteMany({ where: { id: { in: ids } } });
    await context.prisma.marketDataBudget.deleteMany({ where: { keyHash } });
    ids.length = 0;
    await context.cleanup();
  });
  afterAll(async () => { await context?.app.close(); });
  it('imports idempotently, preserves identity after a symbol rename, and searches only local data', async () => {
    const ticker = `T${randomUUID().slice(0, 8).toUpperCase()}`;
    const row = { ticker, symbol: `${ticker}.WAR`, mic: 'XWAR', currency: 'PLN' as const, isin: 'PL1234567890', name: 'Synthetic catalog' };
    const service = new MarketInstrumentsService(context.prisma, {} as EodhdProvider);
    await service.importCatalog([row]);
    const original = await context.prisma.instrument.findUniqueOrThrow({ where: { mic_ticker: { mic: row.mic, ticker } } });
    ids.push(original.id);
    await service.importCatalog([row]);
    await service.importCatalog([{ ...row, ticker: `${ticker}N`, symbol: `${ticker}N.WAR` }]);
    const stored = await context.prisma.instrument.findUniqueOrThrow({ where: { id: original.id }, include: { providerMappings: true } });
    expect(stored.ticker).toBe(`${ticker}N`);
    expect(stored.providerMappings).toHaveLength(1);
    const { agent } = await context.signIn();
    const response = await agent.get('/market-data/instruments').query({ q: `${ticker}N`, pageSize: 1 }).expect(200);
    expect(response.body.total).toBe(1);
    expect(response.body.items[0].id).toBe(original.id);
    expect(JSON.stringify(response.body)).not.toContain('EODHD');
    await agent.get('/market-data/instruments').query({ pageSize: 101 }).expect(400);
    await agent.get('/market-data/instruments').query({ mic: 'INVALID' }).expect(400);
  });
  it('serializes concurrent reservations across service instances and conservatively accounts for external calls', async () => {
    const a = new MarketDataBudgetService(context.prisma);
    const b = new MarketDataBudgetService(context.prisma);
    const now = new Date('2026-11-18T12:00:00Z');
    const results = await Promise.allSettled(Array.from({ length: 5 }, (_, i) => (i % 2 ? a : b).reserve(keyHash, 18, 20, now)));
    expect(results.filter(row => row.status === 'fulfilled')).toHaveLength(2);
    const row = await context.prisma.marketDataBudget.findFirstOrThrow({ where: { keyHash } });
    expect(row.spent).toBe(20);
    await expect(a.reserve(keyHash, 0, 20, now)).rejects.toMatchObject({ code: 'budget' });
    await expect(a.reserve(keyHash, 0, 20, new Date('2026-11-19T00:01:00Z'))).resolves.toBe(0);
  });
});
