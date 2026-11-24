import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { getFrontendOrigin } from '../config/cors.js';
import { Prisma } from '../generated/prisma/client.js';
import { MarketJobsService } from '../jobs/jobs.service.js';
import { expectedSession, previousDay } from '../market-data/calendar.js';
import { MarketDataError } from '../market-data/contracts.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { recordStrategyDecision } from './record-strategy-decision.js';
import { movingAverage } from './moving-average.js';
import {
  collectStrategyData,
  copySnapshot,
  strategyLookbackDays,
} from './strategy-data.js';
import { lockStrategy, withLatest } from './strategies.service.js';

const retryDelay = 5 * 60_000;
const sessionDate = (day: string) => new Date(day + 'T00:00:00Z');
const strategyPath = (portfolioId: string, accountId: string) =>
  `/dashboard/investments/${portfolioId}/accounts/${accountId}/strategies`;

@Injectable()
export class StrategyRunnerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: MarketJobsService,
  ) {}

  async schedule(now = new Date()) {
    const rows = await this.prisma.strategy.findMany({
      where: { enabled: true, account: { archivedAt: null } },
      include: withLatest,
    });
    for (const strategy of rows) {
      let day: string;
      try {
        day = expectedSession(strategy.instrument.mic, now);
      } catch (error) {
        if (error instanceof MarketDataError && error.code === 'configuration')
          continue;
        throw error;
      }
      const version = strategy.versions[0];
      if (!version) continue;
      await this.jobs.ensure(
        `strategy_${version.id}_${day}`,
        'strategy',
        { strategyId: strategy.id, versionId: version.id, sessionOn: day },
        25,
      );
    }
  }

  async execute(
    strategyId: string,
    versionId: string,
    target: string,
    now = new Date(),
  ) {
    const ownership = await this.prisma.strategy.findUnique({
      where: { id: strategyId },
      select: {
        account: {
          select: {
            id: true,
            portfolioId: true,
            portfolio: { select: { userId: true } },
          },
        },
      },
    });
    if (!ownership) return { skipped: 'deleted' };
    const { account } = ownership;
    const scope = {
      userId: account.portfolio.userId,
      portfolioId: account.portfolioId,
      accountId: account.id,
    };
    return this.prisma.$transaction(
      async (tx) => {
        try {
          await lockStrategy(tx, scope, strategyId);
        } catch (error) {
          if (error instanceof NotFoundException) return { skipped: 'deleted' };
          throw error;
        }
        const strategy = await tx.strategy.findUniqueOrThrow({
          where: { id: strategyId },
          include: { ...withLatest, account: { select: { archivedAt: true } } },
        });
        const version = strategy.versions[0];
        if (
          !strategy.enabled ||
          strategy.account.archivedAt ||
          version?.id !== versionId
        )
          return { skipped: 'inactive' };
        const key = { versionId, scheduledSessionOn: sessionDate(target) };
        const existing = await tx.strategyRun.findUnique({
          where: { versionId_scheduledSessionOn: key },
          select: { id: true },
        });
        if (existing) return { runId: existing.id };

        const timed = {
          instrumentId: strategy.instrumentId,
          decidedAt: now.toISOString(),
          evidence: { expectedSessionOn: target, barIds: [], splitIds: [] },
        };
        const terminal = (reason: string) =>
          tx.strategyRun.create({
            data: {
              ...key,
              decidedAt: now,
              input: Prisma.JsonNull,
              decision: { ...timed, kind: 'NO_SIGNAL', reason },
            },
            select: { id: true },
          });
        let current: string;
        try {
          current = expectedSession(strategy.instrument.mic, now);
        } catch (error) {
          if (
            error instanceof MarketDataError &&
            error.code === 'configuration'
          )
            return { runId: (await terminal('CALENDAR_UNAVAILABLE')).id };
          throw error;
        }
        if (current < target)
          return { retryAt: new Date(now.getTime() + retryDelay) };
        if (current > target)
          return { runId: (await terminal('MARKET_DATA_TIMEOUT')).id };
        if (
          version.ruleKey !== movingAverage.key ||
          version.codeVersion !== movingAverage.codeVersion
        )
          return { runId: (await terminal('RULE_UNAVAILABLE')).id };
        const parameters = movingAverage.parseParameters(version.parameters);
        const coverageFrom = previousDay(
          target,
          Math.max(strategyLookbackDays(parameters.slowSessions), 90),
        );
        const sync = await tx.marketJob.findMany({
          where: {
            kind: 'splits',
            status: 'SUCCEEDED',
            AND: [
              {
                payload: {
                  path: ['instrumentId'],
                  equals: strategy.instrumentId,
                },
              },
              { payload: { path: ['to'], equals: target } },
            ],
          },
          select: { payload: true },
        });
        const sufficient = sync.some(
          ({ payload }) =>
            payload &&
            typeof payload === 'object' &&
            !Array.isArray(payload) &&
            typeof payload.from === 'string' &&
            payload.from <= coverageFrom,
        );
        if (!sufficient)
          return { retryAt: new Date(now.getTime() + retryDelay) };

        let recorded: Awaited<
          ReturnType<typeof collectStrategyData<typeof parameters>>
        >;
        try {
          recorded = await collectStrategyData(
            tx,
            scope.accountId,
            strategy.instrument,
            now,
            parameters,
          );
        } catch (error) {
          if (error instanceof ConflictException)
            return { runId: (await terminal('PORTFOLIO_UNRECONCILED')).id };
          throw error;
        }
        const decision = movingAverage.evaluate(recorded);
        if (
          decision.kind === 'NO_SIGNAL' &&
          ['STALE_PRICE', 'INSUFFICIENT_HISTORY'].includes(decision.reason)
        )
          return { retryAt: new Date(now.getTime() + retryDelay) };
        const run = await recordStrategyDecision(
          tx,
          versionId,
          copySnapshot(recorded),
          decision,
          key.scheduledSessionOn,
        );
        if (run.signal && strategy.notifyOnSignal) {
          const connection = await tx.telegramConnection.findUnique({
            where: { userId: scope.userId },
            select: { userId: true },
          });
          const notification = await tx.notification.create({
            data: {
              userId: scope.userId,
              signalId: run.signal.id,
              kind: 'SIGNAL',
              state: connection ? 'PENDING' : 'CANCELLED',
              lastError: connection ? null : 'disconnected',
              body: [
                `Sygnał ${run.signal.side === 'BUY' ? 'kupna' : 'sprzedaży'} ${strategy.instrument.ticker} (${strategy.instrument.mic})`,
                run.signal.rationale,
                `Sesja ${target}. Ważność do ${run.signal.validUntil.toISOString()}.`,
                new URL(
                  strategyPath(scope.portfolioId, scope.accountId),
                  getFrontendOrigin(),
                ).href,
              ].join('\n'),
            },
          });
          if (connection)
            await tx.marketJob.create({
              data: {
                key: `signal_notification_${run.signal.id}`,
                kind: 'retry_notification',
                payload: { notificationId: notification.id },
                priority: 5,
              },
            });
        }
        return { runId: run.id };
      },
      { timeout: 20000 },
    );
  }
}
