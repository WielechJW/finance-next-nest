import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { MarketJobsModule } from './jobs/jobs.module.js';
import { MarketJobsService } from './jobs/jobs.service.js';
import { MarketSchedulerService } from './jobs/scheduler.service.js';
import { MarketWorkerRuntime } from './jobs/runtime.js';
import { redisConnection } from './jobs/redis.js';
import { MarketSyncService } from './market-data/sync.service.js';
import { MarketDataError, object, marketDate } from './market-data/contracts.js';

async function bootstrap() {
  if (process.env.MARKET_DATA_ENABLED !== '1') { console.log('Worker wyłączony. Ustaw MARKET_DATA_ENABLED=1 po skonfigurowaniu usług.'); return; }
  const app = await NestFactory.createApplicationContext(MarketJobsModule, { logger: false, abortOnError: false });
  const sync = app.get(MarketSyncService);
  const scheduler = app.get(MarketSchedulerService);
  const runtime = new MarketWorkerRuntime(app.get(MarketJobsService), redisConnection(), async job => {
    const payload = object(job.payload);
    const from = marketDate(payload.from), to = marketDate(payload.to);
    if (job.kind === 'fx') return sync.fx(from, to);
    if (!['prices', 'dividends', 'splits'].includes(job.kind) || typeof payload.instrumentId !== 'string' || !/^[0-9a-f-]{36}$/i.test(payload.instrumentId)) throw new MarketDataError('configuration', 'Niepoprawne zadanie synchronizacji.');
    return sync.instrument(payload.instrumentId, job.kind as 'prices' | 'dividends' | 'splits', from, to);
  });
  let ticking = false;
  const tick = async () => {
    if (ticking) return;
    ticking = true;
    try { await scheduler.schedule(); await runtime.dispatch(); }
    catch { console.error('Nie udało się zaplanować synchronizacji; ponowienie przy następnym przebiegu.'); }
    finally { ticking = false; }
  };
  await tick();
  const timer = setInterval(() => { void tick(); }, 30000);
  let closing = false;
  const close = async () => { if (closing) return; closing = true; clearInterval(timer); await runtime.close(); await app.close(); };
  process.once('SIGTERM', () => { void close(); }); process.once('SIGINT', () => { void close(); });
}
try { await bootstrap(); } catch { console.error('Nie udało się uruchomić workera. Sprawdź konfigurację usług.'); process.exitCode = 1; }
