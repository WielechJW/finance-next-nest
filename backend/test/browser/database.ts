import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { expectedSession } from '../../src/market-data/calendar.js';
import {
  getBrowserDatabaseUrl,
  loadTestEnvironment,
} from '../support/database.js';

export interface TestAccount {
  email: string;
  password: string;
}

export class BrowserDatabase {
  private readonly pool: Pool;
  private readonly emails = new Set<string>();
  private readonly instrumentIds = new Set<string>();

  constructor() {
    loadTestEnvironment();
    this.pool = new Pool({ connectionString: getBrowserDatabaseUrl(), max: 1 });
  }

  newAccount(): TestAccount {
    const email = 'browser-' + randomUUID() + '@example.invalid';
    this.emails.add(email);
    return { email, password: '  Testowe hasło przeglądarkowe 123!  ' };
  }

  async investmentInstrument() {
    const id = randomUUID();
    const ticker = 'PW' + randomUUID().slice(0, 8);
    await this.pool.query('INSERT INTO "Instrument" (id, ticker, mic, currency, "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, NOW(), NOW())',
      [id, ticker, 'XWAR', 'PLN']);
    this.instrumentIds.add(id);
    return { id, ticker };
  }

  async expireSessions(account: TestAccount): Promise<void> {
    if (!this.emails.has(account.email))
      throw new Error('Konto nie należy do tego testu.');
    const result = await this.pool.query(
      "UPDATE session SET expire = NOW() - INTERVAL '1 minute' WHERE sess->>'userId' IN (SELECT id::text FROM \"User\" WHERE email = $1)",
      [account.email],
    );
    if (!result.rowCount)
      throw new Error('Brak sesji konta testowego do wygaszenia.');
  }

  async investmentQuote(instrumentId: string, close = '70') {
    if (!this.instrumentIds.has(instrumentId)) throw new Error('Instrument nie należy do testu.');
    await this.pool.query('INSERT INTO "PriceBar" (id, "instrumentId", source, "sessionOn", open, high, low, close, "adjustedClose", volume, revision, "currentSlot", "contentHash", "fetchedAt") VALUES ($1, $2, $3, $4, $5, $5, $5, $5, $5, 100, 1, 1, $6, NOW())',
      [randomUUID(), instrumentId, 'EODHD', expectedSession('XWAR'), close, '0'.repeat(64)]);
  }

  async dispose(): Promise<void> {
    try {
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        const emails = [...this.emails];
        await client.query(
          'DELETE FROM session WHERE sess->>\'userId\' IN (SELECT id::text FROM "User" WHERE email = ANY($1::text[]))',
          [emails],
        );
        await client.query('DELETE FROM "User" WHERE email = ANY($1::text[])', [
          emails,
        ]);
        await client.query('DELETE FROM "PriceBar" WHERE "instrumentId" = ANY($1::uuid[])', [[...this.instrumentIds]]);
        await client.query('DELETE FROM "Instrument" WHERE id = ANY($1::uuid[])', [[...this.instrumentIds]]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } finally {
      await this.pool.end();
    }
  }
}
