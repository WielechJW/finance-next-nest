import { createHash } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { session, previousDay, zonedClock } from '../market-data/calendar.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { movingAverage } from '../strategies/moving-average.js';
import type { StrategyScope } from '../strategies/strategies.service.js';
import type { StrategyInstrument } from '../strategies/strategy.js';
import type { BacktestInputDto } from './backtest-input.js';
import { buildBacktestReport } from './backtest-report.js';
import type { ReplayCorporateAction } from './execution-policy.js';

const modelVersion = 'next-open-1';
const roundedDate = (day: string) => new Date(`${day}T00:00:00Z`);
const day = (date: Date) => date.toISOString().slice(0, 10);
function ownerWhere(scope: StrategyScope, id: string) {
  return {
    id,
    accountId: scope.accountId,
    account: {
      portfolioId: scope.portfolioId,
      portfolio: { userId: scope.userId },
    },
  };
}
const summary = {
  id: true,
  baselineId: true,
  phase: true,
  status: true,
  fromOn: true,
  toOn: true,
  modelVersion: true,
  inputHash: true,
  error: true,
  createdAt: true,
  version: { select: { number: true, codeVersion: true, ruleKey: true } },
} satisfies Prisma.BacktestRunSelect;
const detail = { ...summary, report: true } satisfies Prisma.BacktestRunSelect;

function actions(
  input: BacktestInputDto,
  instrumentId: string,
): ReplayCorporateAction[] {
  return input.actions.map((row) => {
    const base = {
      id: row.id,
      instrumentId,
      exDate: row.exDate,
      availableAt: new Date(row.availableAt),
    };
    if (row.kind === 'SPLIT') {
      if (!row.numerator || !row.denominator)
        throw new Error('Split wymaga licznika i mianownika.');
      return {
        ...base,
        kind: 'SPLIT',
        numerator: row.numerator,
        denominator: row.denominator,
      };
    }
    if (!row.paymentOn || !row.amountPerShare || row.withholdingBps == null)
      throw new Error(
        'Dywidenda wymaga daty wypłaty, kwoty i stawki potrącenia.',
      );
    return {
      ...base,
      kind: 'DIVIDEND',
      paymentOn: row.paymentOn,
      amountPerShare: row.amountPerShare,
      withholdingBps: row.withholdingBps,
    };
  });
}

function checkTimeline(
  input: BacktestInputDto,
  instrument: StrategyInstrument,
) {
  const expected = [];
  for (
    let current = input.fromOn;
    current <= input.toOn;
    current = previousDay(current, -1)
  ) {
    if (session(instrument.mic, current).trading) expected.push(current);
  }
  if (
    expected.length !== input.sessions.length ||
    expected.some((value, index) => value !== input.sessions[index].sessionOn)
  )
    throw new Error(
      'Snapshot musi zawierać wszystkie sesje z podanego okresu.',
    );
  if (input.sessions.some((row) => new Date(row.decidedAt) > new Date()))
    throw new Error('Czas decyzji wykracza poza dostępną historię.');
  const sessions = new Set(expected);
  if (input.fx.some((row) => !sessions.has(row.sessionOn)))
    throw new Error('Dzień wymiany walut jest poza sesjami symulacji.');
}

export function generateReport(
  input: BacktestInputDto,
  instrument: StrategyInstrument,
  parameters: unknown,
) {
  checkTimeline(input, instrument);
  return buildBacktestReport({
    rule: movingAverage,
    instrument,
    parameters: movingAverage.parseParameters(parameters),
    reportingCurrency: input.reportingCurrency,
    startingCash: input.startingCash,
    orderQuantity: input.orderQuantity,
    maxWaitSessions: input.maxWaitSessions,
    sessions: input.sessions.map((row) => ({
      sessionOn: row.sessionOn,
      decidedAt: new Date(row.decidedAt),
      opening: row.opening ?? null,
    })),
    bars: input.bars.map(({ id, sessionOn, revision, close, availableAt }) => ({
      id,
      sessionOn,
      revision,
      close,
      instrumentId: instrument.id,
      availableAt: new Date(availableAt),
    })),
    fxMarks: input.fxMarks.map(({ id, sessionOn, usdPln, availableAt }) => ({
      id,
      sessionOn,
      usdPln,
      availableAt: new Date(availableAt),
    })),
    splits: [],
    execution: {
      priceBasis: input.priceBasis,
      costs: input.costs,
      fx: input.fx,
      actions: actions(input, instrument.id),
    },
  });
}

function canonicalJson(value: Prisma.InputJsonValue | null): string {
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value))
    return '[' + value.map(canonicalJson).join(',') + ']';
  const object = value as Prisma.InputJsonObject;
  return (
    '{' +
    Object.keys(object)
      .sort()
      .filter((key) => object[key] !== undefined)
      .map((key) => JSON.stringify(key) + ':' + canonicalJson(object[key]!))
      .join(',') +
    '}'
  );
}

@Injectable()
export class BacktestsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    scope: StrategyScope,
    strategyId: string,
    input: BacktestInputDto,
  ) {
    if (
      input.fromOn > input.toOn ||
      input.toOn > zonedClock(new Date(), 'Europe/Warsaw').day ||
      Date.parse(input.toOn) - Date.parse(input.fromOn) > 365 * 86400000
    )
      throw new BadRequestException(
        'Podaj poprawny zakres obejmujący do 366 dni.',
      );
    const owned = ownerWhere(scope, strategyId);
    const strategy = await this.prisma.strategy.findFirst({
      where: owned,
      include: {
        instrument: { select: { id: true, mic: true, currency: true } },
        versions: { orderBy: { number: 'desc' }, take: 1 },
      },
    });
    if (!strategy) throw new NotFoundException('Nie znaleziono strategii.');
    let version = strategy.versions[0];
    if (input.phase === 'OUT_OF_SAMPLE') {
      if (!input.baselineId)
        throw new BadRequestException(
          'Wskaż wcześniejszą próbę doboru parametrów.',
        );
      const baseline = await this.prisma.backtestRun.findFirst({
        where: {
          id: input.baselineId,
          status: 'COMPLETE',
          phase: 'DEVELOPMENT',
          version: { strategy: owned },
        },
        include: { version: true },
      });
      if (!baseline || day(baseline.toOn) >= input.fromOn)
        throw new BadRequestException(
          'Próba poza próbą musi zaczynać się po okresie doboru parametrów tej strategii.',
        );
      version = baseline.version;
    } else if (input.baselineId) {
      throw new BadRequestException(
        'Dobór parametrów nie przyjmuje próby odniesienia.',
      );
    }
    const snapshot = JSON.parse(
      JSON.stringify({
        instrument: strategy.instrument,
        request: input,
        parameters: version.parameters,
        ruleKey: version.ruleKey,
        codeVersion: version.codeVersion,
      }),
    ) as Prisma.InputJsonObject;
    const data = {
      versionId: version.id,
      baselineId: input.baselineId,
      phase: input.phase,
      fromOn: roundedDate(input.fromOn),
      toOn: roundedDate(input.toOn),
      modelVersion,
      inputHash: createHash('sha256')
        .update(canonicalJson(snapshot))
        .digest('hex'),
      input: snapshot,
    };
    let report: ReturnType<typeof generateReport>;
    try {
      if (
        version.ruleKey !== movingAverage.key ||
        version.codeVersion !== movingAverage.codeVersion
      )
        throw new Error('Wersja kodu strategii jest niedostępna.');
      report = generateReport(input, strategy.instrument, version.parameters);
    } catch (failure) {
      return this.prisma.backtestRun.create({
        data: {
          ...data,
          status: 'FAILED',
          error: (failure instanceof Error
            ? failure.message
            : 'Próba zakończyła się błędem.'
          ).slice(0, 500),
        },
        select: detail,
      });
    }
    return this.prisma.backtestRun.create({
      data: { ...data, status: 'COMPLETE', report },
      select: detail,
    });
  }

  async list(scope: StrategyScope, strategyId: string) {
    const owned = ownerWhere(scope, strategyId);
    const strategy = await this.prisma.strategy.findFirst({
      where: owned,
      select: { id: true },
    });
    if (!strategy) throw new NotFoundException('Nie znaleziono strategii.');
    return this.prisma.backtestRun.findMany({
      where: { version: { strategy: owned } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100,
      select: summary,
    });
  }

  async get(scope: StrategyScope, strategyId: string, id: string) {
    const run = await this.prisma.backtestRun.findFirst({
      where: { id, version: { strategy: ownerWhere(scope, strategyId) } },
      select: detail,
    });
    if (!run) throw new NotFoundException('Nie znaleziono próby historycznej.');
    return run;
  }
}
