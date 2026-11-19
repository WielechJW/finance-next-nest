import { randomUUID } from 'node:crypto';
import { investmentHttpContext } from './support/investment-http.js';
import { MarketHistoryService } from '../src/market-data/history.service.js';
import { PriceAlertsService } from '../src/alerts/alerts.service.js';
import { parseBars } from '../src/market-data/history-contracts.js';

describe('Private watchlists and atomic alerts (PostgreSQL)', () => {
  let ctx: Awaited<ReturnType<typeof investmentHttpContext>>;
  let instrumentId: string;
  beforeAll(async () => { ctx = await investmentHttpContext(); });
  beforeEach(async () => { instrumentId = (await ctx.prisma.instrument.create({ data: { ticker: `A${randomUUID().slice(0, 8)}`, mic: 'XWAR', currency: 'PLN' } })).id; });
  afterEach(async () => {
    const events = await ctx.prisma.alertEvent.findMany({ where: { alert: { instrumentId } }, select: { id: true } });
    await ctx.prisma.marketJob.deleteMany({ where: { key: { in: events.map(row => `notification_${row.id}`) } } });
    await ctx.cleanup();
    await ctx.prisma.priceBar.deleteMany({ where: { instrumentId } });
    await ctx.prisma.instrument.delete({ where: { id: instrumentId } });
  });
  afterAll(async () => { await ctx?.app.close(); });
  async function price(day: string, close: string) {
    await ctx.app.get(MarketHistoryService).saveBars(instrumentId, parseBars([{ date: day, open: close, high: close, low: close, close, adjusted_close: close, volume: '100' }], day, day));
  }
  it('isolates list membership and rule writes and rejects noncanonical price thresholds', async () => {
    const owner = await ctx.signIn(), stranger = await ctx.signIn();
    const response = await owner.agent.post('/watchlists').set('Origin', ctx.origin).send({ name: 'GPW' }).expect(201);
    const id = (response.body as { id: string }).id;
    await owner.agent.post(`/watchlists/${id}/items`).set('Origin', ctx.origin).send({ instrumentId }).expect(201);
    await owner.agent.post(`/watchlists/${id}/items`).set('Origin', ctx.origin).send({ instrumentId }).expect(201);
    expect(await ctx.prisma.watchlistItem.count({ where: { watchlistId: id } })).toBe(1);
    await stranger.agent.post(`/watchlists/${id}/items`).set('Origin', ctx.origin).send({ instrumentId }).expect(404);
    await stranger.agent.delete(`/watchlists/${id}`).set('Origin', ctx.origin).expect(404);
    expect((await stranger.agent.get('/watchlists').expect(200)).body).toEqual([]);
    await owner.agent.post('/price-alerts').set('Origin', ctx.origin).send({ instrumentId, direction: 'ABOVE', mode: 'ONCE', threshold: '1e2', cooldownMinutes: 0 }).expect(400);
  });
  it('fires exactly once under concurrency, atomically records an outbox, ignores corrections and retains deleted-rule history', async () => {
    const owner = await ctx.signIn(), stranger = await ctx.signIn();
    await price('2026-11-10', '49');
    const response = await owner.agent.post('/price-alerts').set('Origin', ctx.origin).send({ instrumentId, direction: 'ABOVE', mode: 'REARM', threshold: '50', cooldownMinutes: 0 }).expect(201);
    const ruleId = (response.body as { id: string }).id;
    const engine = ctx.app.get(PriceAlertsService);
    await engine.evaluateInstrument(instrumentId, new Date('2026-11-10T22:00:00Z'));
    await price('2026-11-12', '50');
    const results = await Promise.all([engine.evaluateInstrument(instrumentId, new Date('2026-11-12T22:00:00Z')), engine.evaluateInstrument(instrumentId, new Date('2026-11-12T22:00:00Z'))]);
    expect(results.reduce((sum, row) => sum + row.fired, 0)).toBe(1);
    const event = await ctx.prisma.alertEvent.findFirstOrThrow({ where: { alertId: ruleId } });
    expect(await ctx.prisma.marketJob.count({ where: { key: `notification_${event.id}`, status: 'PENDING' } })).toBe(1);
    await price('2026-11-12', '48');
    await engine.evaluateInstrument(instrumentId, new Date('2026-11-12T22:00:00Z'));
    expect(await ctx.prisma.alertEvent.count({ where: { alertId: ruleId } })).toBe(1);
    await price('2026-11-13', '50');
    expect((await engine.evaluateInstrument(instrumentId, new Date('2026-11-13T22:00:00Z'))).fired).toBe(1);
    await stranger.agent.patch(`/price-alerts/${ruleId}`).set('Origin', ctx.origin).send({ active: false }).expect(404);
    await owner.agent.delete(`/price-alerts/${ruleId}`).set('Origin', ctx.origin).expect(204);
    expect((await owner.agent.get('/price-alerts/events').expect(200)).body.total).toBe(2);
    expect((await stranger.agent.get('/price-alerts/events').expect(200)).body.total).toBe(0);
  });
  it('arms a resumed alert from the fresh quote and preserves the first crossing under retries', async () => {
    const { userId } = await ctx.signIn();
    const alerts = ctx.app.get(PriceAlertsService);
    await price('2026-11-10', '90');
    const rule = await alerts.create(userId, { instrumentId, threshold: '100', direction: 'ABOVE', mode: 'ONCE', cooldownMinutes: 5 });
    await alerts.update(userId, rule.id, false);
    const baselineTime = new Date('2026-11-10T22:00:00Z');
    expect((await alerts.update(userId, rule.id, true, baselineTime)).armed).toBe(true);
    await price('2026-11-12', '110');
    const next = new Date('2026-11-12T22:00:00Z');
    await alerts.update(userId, rule.id, true, next);
    const attempts = await Promise.all([alerts.evaluateInstrument(instrumentId, next), alerts.evaluateInstrument(instrumentId, next)]);
    expect(attempts.reduce((sum, row) => sum + row.fired, 0)).toBe(1);
    expect(await ctx.prisma.alertEvent.count({ where: { alertId: rule.id } })).toBe(1);
  });
  it('does not evaluate a stale quote', async () => {
    const owner = await ctx.signIn(); await price('2026-11-10', '49');
    const engine = ctx.app.get(PriceAlertsService);
    await engine.create(owner.userId, { instrumentId, direction: 'ABOVE', mode: 'ONCE', threshold: '50', cooldownMinutes: 0 });
    expect((await engine.evaluateInstrument(instrumentId, new Date('2026-11-18T12:00:00Z'))).fired).toBe(0);
    expect(await ctx.prisma.alertEvent.count({ where: { alert: { instrumentId } } })).toBe(0);
  });
});
