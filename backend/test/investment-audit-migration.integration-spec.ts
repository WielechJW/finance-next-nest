import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Client } from 'pg';
import { getTestDatabaseUrl } from './support/database.js';

describe('Investment audit migration (isolated PostgreSQL schema)', () => {
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
      '20261116173000_add_investment_audit_idempotency',
    ];
    const migrations = await Promise.all(names.map((name) => readFile(
      new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url),
      'utf8',
    )));
    previousMigrations = migrations.slice(0, -1);
    migration = migrations.at(-1)!;
    client = new Client({
      connectionString: getTestDatabaseUrl(process.env.DATABASE_URL_TEST),
    });
    await client.connect();
  });

  beforeEach(async () => {
    schema = `audit_migration_${randomUUID().replaceAll('-', '')}`;
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

  it('migrates an empty ledger', async () => {
    await client.query(migration);
    expect((await client.query('SELECT * FROM "InvestmentEvent"')).rows).toEqual([]);
    const indexes = (await client.query(
      'SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND tablename = $2',
      [schema, 'InvestmentEvent'],
    )).rows.map((row: { indexname: string }) => row.indexname);
    expect(indexes).toEqual(expect.arrayContaining([
      'InvestmentEvent_accountId_occurredOn_daySequence_key',
      'InvestmentEvent_external_identity_key',
      'InvestmentEvent_accountId_idempotencyKey_key',
      'InvestmentEvent_accountId_recordedAt_id_idx',
      'InvestmentEvent_correctionOfId_idx',
    ]));
  });

  it('keeps legacy events, corrections and entries without invented authors', async () => {
    const userId = randomUUID();
    const portfolioId = randomUUID();
    const accountId = randomUUID();
    const originalId = randomUUID();
    const correctionId = randomUUID();
    const cashId = randomUUID();
    await client.query(
      'INSERT INTO "User" ("id", "email", "passwordHash", "updatedAt") VALUES ($1, $2, $3, NOW())',
      [userId, `audit-${userId}@example.invalid`, 'test-hash'],
    );
    await client.query(
      'INSERT INTO "Portfolio" ("id", "userId", "name", "updatedAt") VALUES ($1, $2, $3, NOW())',
      [portfolioId, userId, 'Existing portfolio'],
    );
    await client.query(
      'INSERT INTO "InvestmentAccount" ("id", "portfolioId", "name", "updatedAt") VALUES ($1, $2, $3, NOW())',
      [accountId, portfolioId, 'Existing account'],
    );
    await client.query(
      'INSERT INTO "InvestmentEvent" ("id", "accountId", "type", "source", "occurredOn", "daySequence") VALUES ($1, $2, $3, $4, $5, $6)',
      [originalId, accountId, 'DEPOSIT', 'BROKER', '2026-11-10', 1],
    );
    await client.query(
      'INSERT INTO "InvestmentEvent" ("id", "accountId", "type", "occurredOn", "daySequence", "correctionOfId", "correctionReason") VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [correctionId, accountId, 'CORRECTION', '2026-11-10', 2, originalId, 'Legacy fix'],
    );
    await client.query(
      'INSERT INTO "CashEntry" ("id", "eventId", "kind", "currency", "amount") VALUES ($1, $2, $3, $4, $5)',
      [cashId, originalId, 'EXTERNAL_TRANSFER', 'PLN', '100.00'],
    );

    await client.query(migration);

    const rows = (await client.query(
      'SELECT "id", "sourceKey", "recordedBy", "correctionOfId", "correctionReason" FROM "InvestmentEvent" ORDER BY "daySequence"',
    )).rows;
    expect(rows).toEqual([
      { id: originalId, sourceKey: 'legacy:broker', recordedBy: 'legacy:unknown', correctionOfId: null, correctionReason: null },
      { id: correctionId, sourceKey: 'manual', recordedBy: 'legacy:unknown', correctionOfId: originalId, correctionReason: 'Legacy fix' },
    ]);
    expect((await client.query('SELECT "amount" FROM "CashEntry" WHERE "id" = $1', [cashId])).rows[0].amount)
      .toBe('100.00000000');
  });
});
