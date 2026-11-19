import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { reconcileSplit } from '../investments/split-reconciliation.js';
import { replayBalances } from '../investments/posting.js';
import { replayFifo } from '../investments/fifo.js';
import { eventInclude } from '../investments/events.service.js';
import { InvestmentCalculation as D } from '../investments/precision.js';
import { expectedSession, previousDay, zonedClock } from '../market-data/calendar.js';

const dayOf = (value: Date) => value.toISOString().slice(0, 10);
const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const zero = () => new D(0);

@Injectable()
export class PortfolioValuationService {
  constructor(private readonly prisma: PrismaService) {}
  async load(userId: string, portfolioId: string, asOf: string, benchmarkId?: string) {
    return this.prisma.$transaction(async tx => {
      const portfolio = await tx.portfolio.findFirst({ where: { id: portfolioId, userId }, select: { id: true, name: true } });
      if (!portfolio) throw new NotFoundException('Nie znaleziono portfela inwestycyjnego.');
      const accounts = await tx.investmentAccount.findMany({ where: { portfolioId }, include: { events: { where: { activeSlot: 1, occurredOn: { lte: new Date(`${asOf}T00:00:00Z`) } }, include: eventInclude, orderBy: [{ occurredOn: 'asc' }, { daySequence: 'asc' }, { id: 'asc' }] } } });
      const ids = new Set(accounts.flatMap(account => account.events.flatMap(event => [event.trade?.instrumentId, event.openingLot?.instrumentId, event.split?.instrumentId].filter((id): id is string => !!id))));
      if (benchmarkId) ids.add(benchmarkId);
      const instruments = await tx.instrument.findMany({ where: { id: { in: [...ids] } }, orderBy: { id: 'asc' } });
      const prices = await tx.priceBar.findMany({ where: { instrumentId: { in: [...ids] }, source: 'EODHD', currentSlot: 1, sessionOn: { lte: new Date(`${asOf}T00:00:00Z`) } }, orderBy: { sessionOn: 'desc' } });
      const fx = await tx.fxRate.findMany({ where: { source: 'NBP', base: 'USD', quote: 'PLN', currentSlot: 1, sessionOn: { lte: new Date(`${asOf}T00:00:00Z`) } }, orderBy: { sessionOn: 'desc' } });
      const splits = await tx.corporateAction.findMany({ where: { instrumentId: { in: [...ids] }, kind: 'SPLIT', currentSlot: 1, exDate: { lte: new Date(asOf) } }, orderBy: [{ exDate: 'asc' }, { id: 'asc' }] });
      const unresolved = accounts.flatMap(account => splits.flatMap(action => {
        const { instrumentId, exDate } = action;
        if (reconcileSplit(account.events, action).matches) return [];
        const prior = replayBalances(account.events.filter(event => event.occurredOn < exDate));
        if (!new D(prior.securities[instrumentId] ?? 0).gt(0)) return [];
        return [{ accountId: account.id, instrumentId, ticker: instruments.find(row => row.id === instrumentId)!.ticker, exDate: dayOf(exDate), actionId: action.id }];
      })).sort((a, b) => a.actionId.localeCompare(b.actionId) || a.accountId.localeCompare(b.accountId));
      return { portfolio, accounts, instruments, prices, fx, unresolved };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
  calculate(data: Awaited<ReturnType<PortfolioValuationService['load']>>, asOf: string, now = new Date(`${asOf}T22:59:59Z`)) {
    const events = data.accounts.flatMap(account => account.events.filter(event => dayOf(event.occurredOn) <= asOf));
    const fxIds = new Set<string>();
    const convert = (amount: string, currency: 'PLN' | 'USD', date = asOf): InstanceType<typeof D> | null => {
      if (currency === 'PLN' || new D(amount).isZero()) return new D(amount);
      const rate = data.fx.find(row => dayOf(row.sessionOn) <= date);
      if (!rate || Date.parse(date) - rate.sessionOn.getTime() > 7 * 86400000) return null;
      fxIds.add(rate.id); return new D(amount).times(rate.rate.toString());
    };
    const cash = { PLN: zero(), USD: zero() };
    const held = new Map<string, { quantity: InstanceType<typeof D>; cost: InstanceType<typeof D>; currency: 'PLN' | 'USD' }>();
    const realized = { PLN: zero(), USD: zero() };
    for (const account of data.accounts) {
      const effective = account.events.filter(event => dayOf(event.occurredOn) <= asOf);
      const balances = replayBalances(effective), fifo = replayFifo(effective);
      for (const currency of ['PLN', 'USD'] as const) cash[currency] = cash[currency].plus(balances.cash[currency]);
      for (const sale of fifo.sales) realized[sale.currency] = realized[sale.currency].plus(sale.result);
      for (const position of fifo.positions) {
        const prior = held.get(position.instrumentId) ?? { quantity: zero(), cost: zero(), currency: position.currency };
        prior.quantity = prior.quantity.plus(position.quantity); prior.cost = prior.cost.plus(position.cost); held.set(position.instrumentId, prior);
      }
    }
    const pendingSplits = data.unresolved.filter(split => split.exDate <= asOf);
    const affected = new Set(pendingSplits.map(split => split.instrumentId));
    let complete = pendingSplits.length === 0;
    let known = cash.PLN;
    const usdCash = convert(cash.USD.toFixed(), 'USD');
    if (usdCash === null) complete = false; else known = known.plus(usdCash);
    const positions = [...held].map(([instrumentId, position]) => {
      const instrument = data.instruments.find(row => row.id === instrumentId)!;
      const expected = expectedSession(instrument.mic, now);
      const price = data.prices.find(row => row.instrumentId === instrumentId && dayOf(row.sessionOn) <= expected);
      const status = !price ? 'missing' : dayOf(price.sessionOn) < expected ? 'stale' : 'fresh';
      const value = price && !affected.has(instrumentId) ? position.quantity.times(price.close.toString()) : null;
      const pln = value ? convert(value.toFixed(), position.currency) : null;
      if (status !== 'fresh' || pln === null) complete = false;
      if (pln) known = known.plus(pln);
      return { instrument: { id: instrument.id, ticker: instrument.ticker, mic: instrument.mic, currency: instrument.currency, name: instrument.name },
        quantity: position.quantity.toFixed(10), cost: position.cost.toFixed(8), status, expectedSessionOn: expected,
        quote: price ? { id: price.id, source: price.source, sessionOn: dayOf(price.sessionOn), close: price.close.toFixed(10), revision: price.revision } : null,
        value: value?.toFixed(8) ?? null, valuePln: pln?.toFixed(8) ?? null, unrealized: value?.minus(position.cost).toFixed(8) ?? null,
        allocationPercent: null as string | null };
    });
    let flows = zero(), todayFlow = zero(), flowsComplete = true, todayFlowComplete = true;
    const dividends = { PLN: zero(), USD: zero() }, fees = { PLN: zero(), USD: zero() };
    for (const event of events) {
      const eventDay = dayOf(event.occurredOn);
      for (const entry of event.cashEntries) {
        if (entry.kind === 'DIVIDEND_GROSS') dividends[entry.currency] = dividends[entry.currency].plus(entry.amount.toString());
        if (['FEE', 'COMMISSION', 'WITHHOLDING_TAX'].includes(entry.kind)) fees[entry.currency] = fees[entry.currency].minus(entry.amount.toString());
        if (entry.kind !== 'EXTERNAL_TRANSFER') continue;
        const flow = convert(entry.amount.toString(), entry.currency, eventDay);
        if (flow === null) { flowsComplete = false; if (eventDay === asOf) todayFlowComplete = false; } else { flows = flows.plus(flow); if (eventDay === asOf) todayFlow = todayFlow.plus(flow); }
      }
      if (event.openingLot) {
        const flow = convert(event.openingLot.totalCost.toString(), event.openingLot.instrument.currency, eventDay);
        if (flow === null) flowsComplete = false; else flows = flows.plus(flow);
      }
    }
    if (complete && known.gt(0)) for (const position of positions) position.allocationPercent = new D(position.valuePln!).div(known).times(100).toFixed(4);
    const marketValues = new Map<string, InstanceType<typeof D>>([['CASH', cash.PLN.plus(usdCash ?? 0)]]);
    const currencyValues = { PLN: cash.PLN, USD: usdCash ?? zero() };
    for (const position of positions) if (position.valuePln !== null) {
      marketValues.set(position.instrument.mic, (marketValues.get(position.instrument.mic) ?? zero()).plus(position.valuePln));
      currencyValues[position.instrument.currency] = currencyValues[position.instrument.currency].plus(position.valuePln);
    }
    const allocation = (label: string, value: InstanceType<typeof D>) => ({ label, valuePln: value.toFixed(8), percent: complete && known.gt(0) ? value.div(known).times(100).toFixed(4) : null });
    const ledgerHash = sha(events.map(event => [event.id, event.revision]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
    const fx = data.fx.find(row => row.id === [...fxIds].at(0));
    const result = { portfolio: data.portfolio, asOf, complete, pendingSplits, valuePln: complete ? known.toFixed(8) : null, knownValuePln: known.toFixed(8),
      cash: { PLN: cash.PLN.toFixed(2), USD: cash.USD.toFixed(2) }, positions,
      allocation: { markets: [...marketValues].map(([label, value]) => allocation(label, value)), currencies: (['PLN', 'USD'] as const).map(label => allocation(label, currencyValues[label])) },
      netContributionsPln: flowsComplete ? flows.toFixed(8) : null, externalFlowTodayPln: todayFlowComplete ? todayFlow.toFixed(8) : null,
      resultPln: complete && flowsComplete ? known.minus(flows).toFixed(8) : null,
      realized: { PLN: realized.PLN.toFixed(8), USD: realized.USD.toFixed(8) }, dividendsGross: { PLN: dividends.PLN.toFixed(2), USD: dividends.USD.toFixed(2) },
      feesAndTaxes: { PLN: fees.PLN.toFixed(2), USD: fees.USD.toFixed(2) },
      fx: fx ? { id: fx.id, source: fx.source, sessionOn: dayOf(fx.sessionOn), rate: fx.rate.toFixed(8), reference: fx.reference } : null,
      openingPositionToday: events.some(event => !!event.openingLot && dayOf(event.occurredOn) === asOf), ledgerHash };
    return { ...result, contentHash: sha({ ledgerHash, asOf, complete, pendingSplits, prices: positions.map(row => [row.quote?.id, row.expectedSessionOn]), fx: [...fxIds].sort(), method: 'portfolio-v2' }) };
  }
  async current(userId: string, portfolioId: string, now = new Date()) {
    const day = zonedClock(now, 'Europe/Warsaw').day;
    return this.calculate(await this.load(userId, portfolioId, day), day, now);
  }
  async record(userId: string, portfolioId: string, day: string) {
    const data = this.calculate(await this.load(userId, portfolioId, day), day);
    return this.prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT "id" FROM "Portfolio" WHERE "id" = ${portfolioId}::uuid FOR UPDATE`;
      await tx.portfolioValuationSnapshot.updateMany({ where: { portfolioId, asOf: new Date(`${day}T00:00:00Z`), currentSlot: 1 }, data: { currentSlot: null } });
      return tx.portfolioValuationSnapshot.upsert({ where: { portfolioId_asOf_contentHash: { portfolioId, asOf: new Date(`${day}T00:00:00Z`), contentHash: data.contentHash } },
        create: { portfolioId, asOf: new Date(`${day}T00:00:00Z`), contentHash: data.contentHash, ledgerHash: data.ledgerHash, data: JSON.parse(JSON.stringify(data)) as Prisma.InputJsonValue }, update: { currentSlot: 1 } });
    });
  }
  async history(userId: string, portfolioId: string, from: string, to: string, benchmarkId?: string) {
    if (from > to || Date.parse(to) - Date.parse(from) > 92 * 86400000 || to > zonedClock(new Date(), 'Europe/Warsaw').day) throw new BadRequestException('Podaj historyczny zakres do 93 dni.');
    const data = await this.load(userId, portfolioId, to, benchmarkId);
    const items = [];
    let previous = this.calculate(data, previousDay(from));
    let factor = new D(1), twrComplete = true;
    const benchmark = benchmarkId ? data.instruments.find(row => row.id === benchmarkId) : null;
    if (benchmarkId && !benchmark) throw new NotFoundException('Nie znaleziono benchmarku.');
    const benchmarkValue = (day: string) => {
      if (!benchmark) return null;
      const price = data.prices.find(row => row.instrumentId === benchmarkId && dayOf(row.sessionOn) <= day);
      const fx = benchmark.currency === 'USD' ? data.fx.find(row => dayOf(row.sessionOn) <= day) : null;
      if (!price || Date.parse(day) - price.sessionOn.getTime() > 7 * 86400000 || (benchmark.currency === 'USD' && (!fx || Date.parse(day) - fx.sessionOn.getTime() > 7 * 86400000))) return null;
      return new D(price.adjustedClose.toString()).times(fx?.rate.toString() ?? '1');
    };
    const benchmarkStart = benchmarkValue(previousDay(from));
    for (let day = from; day <= to; day = previousDay(day, -1)) {
      const row = this.calculate(data, day);
      const denominator = previous.valuePln !== null && row.externalFlowTodayPln !== null ? new D(previous.valuePln).plus(row.externalFlowTodayPln) : null;
      const valid = row.valuePln !== null && denominator !== null && !row.openingPositionToday && (denominator.gt(0) || (denominator.isZero() && new D(row.valuePln).isZero()));
      const dailyFactor = valid ? denominator!.isZero() ? new D(1) : new D(row.valuePln!).div(denominator!) : null;
      if (!dailyFactor) twrComplete = false; else factor = factor.times(dailyFactor);
      const benchmarkEnd = benchmarkValue(day);
      items.push({ asOf: day, valuePln: row.valuePln, resultPln: row.resultPln, complete: row.complete, pendingSplits: row.pendingSplits, externalFlowPln: row.externalFlowTodayPln,
        dailyReturnPercent: dailyFactor?.minus(1).times(100).toFixed(6) ?? null,
        twrPercent: twrComplete ? factor.minus(1).times(100).toFixed(6) : null,
        benchmarkPercent: benchmarkStart && benchmarkEnd ? benchmarkEnd.div(benchmarkStart).minus(1).times(100).toFixed(6) : null });
      previous = row;
    }
    return { from, to, convention: 'external_flows_at_start_of_day', twrPercent: twrComplete ? factor.minus(1).times(100).toFixed(6) : null,
      benchmark: benchmark ? { id: benchmark.id, ticker: benchmark.ticker, method: 'provider_adjusted_close_in_PLN' } : null, items };
  }
}
