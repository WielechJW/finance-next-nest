import { NotificationsService } from './notifications/notifications.service.js';
import { TelegramClient } from './notifications/telegram.client.js';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module.js';
import { PortfolioValuationService } from './portfolio-analytics/valuation.service.js';
import { MarketJobsService } from './jobs/jobs.service.js';
import { MarketSchedulerService } from './jobs/scheduler.service.js';
import { runWorkerCycle } from './jobs/worker-cycle.js';
import { MarketWorkerRuntime } from './jobs/runtime.js';
import { redisConnection } from './jobs/redis.js';
import { MarketSyncService } from './market-data/sync.service.js';
import {
  MarketDataError,
  object,
  marketDate,
} from './market-data/contracts.js';
import { expectedSession } from './market-data/calendar.js';
import { PrismaService } from './prisma/prisma.service.js';
import { PriceAlertsService } from './alerts/alerts.service.js';

async function bootstrap() {
  if (process.env.MARKET_DATA_ENABLED !== '1') {
    console.log(
      'Worker wyłączony. Ustaw MARKET_DATA_ENABLED=1 po skonfigurowaniu usług.',
    );
    return;
  }
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: false,
    abortOnError: false,
  });
  const sync = app.get(MarketSyncService);
  const scheduler = app.get(MarketSchedulerService);
  const notifications = app.get(NotificationsService);
  const kinds = [
    'prices',
    'dividends',
    'splits',
    'fx',
    'valuation',
    ...(app.get(TelegramClient).enabled()
      ? ['notification', 'retry_notification', 'summary']
      : []),
  ];
  const runtime = new MarketWorkerRuntime(
    app.get(MarketJobsService),
    redisConnection(),
    async (job) => {
      const payload = object(job.payload);
      if (job.kind === 'valuation') {
        if (
          typeof payload.userId !== 'string' ||
          typeof payload.portfolioId !== 'string'
        )
          throw new MarketDataError(
            'configuration',
            'Niepoprawne zadanie wyceny.',
          );
        return app
          .get(PortfolioValuationService)
          .record(
            payload.userId,
            payload.portfolioId,
            marketDate(payload.asOf),
          );
      }
      if (job.kind === 'notification' && typeof payload.eventId === 'string')
        return notifications.event(payload.eventId);
      if (
        job.kind === 'retry_notification' &&
        typeof payload.notificationId === 'string'
      )
        return notifications.deliver(payload.notificationId);
      if (job.kind === 'summary' && typeof payload.userId === 'string')
        return notifications.summary(payload.userId, marketDate(payload.day));
      const from = marketDate(payload.from),
        to = marketDate(payload.to);
      if (job.kind === 'fx') return sync.fx(from, to);
      if (
        !['prices', 'dividends', 'splits'].includes(job.kind) ||
        typeof payload.instrumentId !== 'string' ||
        !/^[0-9a-f-]{36}$/i.test(payload.instrumentId)
      )
        throw new MarketDataError(
          'configuration',
          'Niepoprawne zadanie synchronizacji.',
        );
      if (job.kind === 'prices' && payload.scheduled === true) {
        const instrument = await app
          .get(PrismaService)
          .instrument.findUnique({ where: { id: payload.instrumentId } });
        if (!instrument || to < expectedSession(instrument.mic))
          return { skipped: 'superseded' };
      }
      const result = await sync.instrument(
        payload.instrumentId,
        job.kind as 'prices' | 'dividends' | 'splits',
        from,
        to,
      );
      if (job.kind === 'prices')
        await app
          .get(PriceAlertsService)
          .evaluateInstrument(payload.instrumentId);
      return result;
    },
    'finance-market-data',
    kinds,
  );
  let ticking = false;
  const tick = async () => {
    if (ticking) return;
    ticking = true;
    try {
      await runWorkerCycle({
        market: () => scheduler.schedule(),
        summaries: () => notifications.scheduleSummaries(),
        dispatch: () => runtime.dispatch(),
        heartbeat: () => scheduler.heartbeat(),
      });
    } finally {
      ticking = false;
    }
  };
  await tick();
  const timer = setInterval(() => {
    void tick();
  }, 30000);
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    clearInterval(timer);
    await runtime.close();
    await app.close();
  };
  process.once('SIGTERM', () => {
    void close();
  });
  process.once('SIGINT', () => {
    void close();
  });
}
try {
  await bootstrap();
} catch {
  console.error('Nie udało się uruchomić workera. Sprawdź konfigurację usług.');
  process.exitCode = 1;
}
