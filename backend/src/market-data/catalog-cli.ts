import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { MarketDataModule } from './market-data.module.js';
import { MarketInstrumentsService } from './instruments.service.js';

if (!process.argv.includes('--execute')) {
  console.log('Synchronizacja katalogów kosztuje 2 jednostki API. Uruchom z --execute.');
} else {
  const app = await NestFactory.createApplicationContext(MarketDataModule, { logger: false, abortOnError: false });
  try { console.log(JSON.stringify(await app.get(MarketInstrumentsService).synchronize())); }
  catch { console.error('Nie udało się zsynchronizować katalogów. Sprawdź konfigurację i dzienny budżet.'); process.exitCode = 1; }
  finally { await app.close(); }
}
