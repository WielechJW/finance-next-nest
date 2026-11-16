import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Client } from 'pg';
import { getTestDatabaseUrl } from './support/database.js';

describe('Investment precision migration (isolated PostgreSQL schema)', () => {
  let client: Client;
  let schema: string;
  let previousMigrations: string[];
  let migration: string;

  beforeAll(async () => {
    const names = [
      '20261029112004_create_user',
      '20261029121329_add_sessions',
      '20261102120000_add_wallet',
      '20261109120000_add_transactions_and_categories',
      '20261116130000_add_investment_models',
      '20261116133000_add_investment_ledger',
      '20261116170000_investment_precision_and_order',
    ];
    const migrations = await Promise.all(
      names.map((name) => readFile(
        new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url),
        'utf8',
      )),
    );
    previousMigrations = migrations.slice(0, -1);
    migration = migrations.at(-1)!;
    client = new Client({
      connectionString: getTestDatabaseUrl(process.env.DATABASE_URL_TEST),
    });
    await client.connect();
  });

  beforeEach(async () => {
    schema = `precision_migration_${randomUUID().replaceAll('-', '')}`;
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    for (const previous of previousMigrations) await client.query(previous);
  });

  afterEach(async () => {
    await client.query('ROLLBACK');
    await client.query('SET search_path TO public');
    await client.query(`DROP SCHEMA "${schema}" CASCADE`);
  });

  afterAll(async () => {
    await client?.end();
  });

  async function existingAccount() {
    const userId = randomUUID();
    const portfolioId = randomUUID();
    const accountId = randomUUID();
    await client.query(
      'INSERT INTO "User" ("id", "email", "passwordHash", "updatedAt") VALUES ($1, $2, $3, NOW())',
      [userId, `legacy-${userId}@example.invalid`, 'test-hash'],
    );
    await client.query(
      'INSERT INTO "Portfolio" ("id", "userId", "name", "updatedAt") VALUES ($1, $2, $3, NOW())',
      [portfolioId, userId, 'Legacy'],
    );
    await client.query(
      'INSERT INTO "InvestmentAccount" ("id", "portfolioId", "name", "updatedAt") VALUES ($1, $2, $3, NOW())',
      [accountId, portfolioId, 'Broker'],
    );
    return accountId;
  }

  it('adds timing and ordering fields to an empty ledger', async () => {
    await client.query(migration);
    expect((await client.query('SELECT * FROM "InvestmentEvent"')).rows).toEqual([]);
    expect((await client.query('SELECT * FROM "CashEntry"')).rows).toEqual([]);
  });

  it('preserves legacy events and labels their provisional order', async () => {
    const accountId = await existingAccount();
    const earlierId = randomUUID();
    const laterId = randomUUID();
    for (const [id, recordedAt] of [
      [laterId, '2026-11-10T11:00:00Z'],
      [earlierId, '2026-11-10T10:00:00Z'],
    ]) {
      await client.query(
        'INSERT INTO "InvestmentEvent" ("id", "accountId", "type", "occurredOn", "recordedAt") VALUES ($1, $2, $3, $4, $5)',
        [id, accountId, 'DEPOSIT', '2026-11-10', recordedAt],
      );
    }
    const cashId = randomUUID();
    await client.query(
      'INSERT INTO "CashEntry" ("id", "eventId", "kind", "currency", "amount") VALUES ($1, $2, $3, $4, $5)',
      [cashId, earlierId, 'EXTERNAL_TRANSFER', 'PLN', '100.00'],
    );

    await client.query(migration);

    const events = (await client.query(
      'SELECT "id", "daySequence", "orderingSource", "timePrecision", "executedAt" FROM "InvestmentEvent" ORDER BY "daySequence"',
    )).rows;
    expect(events).toEqual([
      { id: earlierId, daySequence: 1, orderingSource: 'MIGRATED_UNVERIFIED', timePrecision: 'DATE', executedAt: null },
      { id: laterId, daySequence: 2, orderingSource: 'MIGRATED_UNVERIFIED', timePrecision: 'DATE', executedAt: null },
    ]);
    expect((await client.query('SELECT "amount" FROM "CashEntry" WHERE "id" = $1', [cashId])).rows[0].amount)
      .toBe('100.00000000');
  });

  it('fails instead of silently rounding a legacy fractional-cent cash entry', async () => {
    const accountId = await existingAccount();
    const eventId = randomUUID();
    await client.query(
      'INSERT INTO "InvestmentEvent" ("id", "accountId", "type", "occurredOn") VALUES ($1, $2, $3, $4)',
      [eventId, accountId, 'DEPOSIT', '2026-11-10'],
    );
    await client.query(
      'INSERT INTO "CashEntry" ("id", "eventId", "kind", "currency", "amount") VALUES ($1, $2, $3, $4, $5)',
      [randomUUID(), eventId, 'EXTERNAL_TRANSFER', 'PLN', '0.001'],
    );
    await expect(client.query(migration)).rejects.toThrow();
  });
});
