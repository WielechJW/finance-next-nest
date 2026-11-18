import { randomUUID } from 'node:crypto';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { MarketHistoryService } from '../src/market-data/history.service.js';
import { parseActions, parseBars } from '../src/market-data/history-contracts.js';

describe('Market history revisions (PostgreSQL)', () => {
  let prisma: PrismaService;
  let history: MarketHistoryService;
  let instrumentId: string;
  const day = '2026-11-17';
  const fetchedAt = new Date('2026-11-18T08:00:00Z');
  beforeAll(async () => { prisma = new PrismaService(); await prisma.$connect(); history = new MarketHistoryService(prisma); });
  beforeEach(async () => {
    instrumentId = (await prisma.instrument.create({ data: { ticker: `T${randomUUID().slice(0, 8)}`, mic: 'XWAR', currency: 'PLN' } })).id;
  });
  afterEach(async () => {
    await prisma.priceBar.deleteMany({ where: { instrumentId } });
    await prisma.corporateAction.deleteMany({ where: { instrumentId } });
    await prisma.fxRate.deleteMany({ where: { reference: 'synthetic-market-history' } });
    await prisma.instrument.delete({ where: { id: instrumentId } });
  });
  afterAll(async () => { await prisma?.$disconnect(); });
  it('retries idempotently and keeps both versions of a corrected price under concurrent writes', async () => {
    const bar = { date: day, open: '50', high: '71', low: '49', close: '70', adjusted_close: '69', volume: '9007199254740993' };
    await Promise.all([history.saveBars(instrumentId, parseBars([bar], day, day), fetchedAt), history.saveBars(instrumentId, parseBars([bar], day, day), fetchedAt)]);
    expect(await prisma.priceBar.count({ where: { instrumentId } })).toBe(1);
    await history.saveBars(instrumentId, parseBars([{ ...bar, close: '71' }], day, day), fetchedAt);
    const versions = await prisma.priceBar.findMany({ where: { instrumentId }, orderBy: { revision: 'asc' } });
    expect(versions.map(row => row.currentSlot)).toEqual([null, 1]);
    expect(versions[0].volume.toFixed()).toBe('9007199254740993');
    const api = await history.prices(instrumentId, day, day);
    expect(api).toHaveLength(1);
    expect(api[0]).toMatchObject({ revision: 2, close: '71.0000000000', adjustedClose: '69.0000000000', publishedAt: null });
  });
  it('versions split/dividend changes without posting ledger events or inventing payment dates', async () => {
    const dividend = { date: day, value: '1.5', currency: 'PLN' };
    await history.saveActions(instrumentId, parseActions([dividend], 'DIVIDEND', 'PLN'), fetchedAt);
    await history.saveActions(instrumentId, parseActions([{ ...dividend, value: '2' }], 'DIVIDEND', 'PLN'), fetchedAt);
    await history.saveActions(instrumentId, parseActions([{ date: day, split: '4/1' }], 'SPLIT', 'PLN'), fetchedAt);
    const rows = await prisma.corporateAction.findMany({ where: { instrumentId } });
    expect(rows).toHaveLength(3);
    expect(rows.filter(row => row.kind === 'DIVIDEND').every(row => row.paymentOn === null)).toBe(true);
    expect(await prisma.securityEntry.count({ where: { instrumentId } })).toBe(0);
  });
  it('keeps reference FX distinct from ledger exchange rates and revisions auditable', async () => {
    const row = { sessionOn: day, rate: '4.00000000', reference: 'synthetic-market-history' };
    await history.saveFx([row], fetchedAt);
    await history.saveFx([row], fetchedAt);
    await history.saveFx([{ ...row, rate: '4.10000000' }], fetchedAt);
    const rows = await prisma.fxRate.findMany({ where: { reference: row.reference }, orderBy: { revision: 'asc' } });
    expect(rows).toHaveLength(2);
    expect(rows.map(value => value.currentSlot)).toEqual([null, 1]);
  });
});
