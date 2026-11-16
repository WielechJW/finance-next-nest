import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Client } from 'pg';
import { getTestDatabaseUrl } from './support/database.js';

describe('Investment ledger migration (isolated PostgreSQL schema)', () => {
  let client: Client;
  let schema: string;
  let previousMigrations: string[];
  let ledgerMigration: string;

  beforeAll(async () => {
    const names = [
      '20261029112004_create_user',
      '20261029121329_add_sessions',
      '20261102120000_add_wallet',
      '20261109120000_add_transactions_and_categories',
      '20261116130000_add_investment_models',
      '20261116133000_add_investment_ledger',
    ];
    const migrations = await Promise.all(
      names.map((name) =>
        readFile(
          new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url),
          'utf8',
        ),
      ),
    );
    previousMigrations = migrations.slice(0, -1);
    ledgerMigration = migrations.at(-1)!;
    client = new Client({
      connectionString: getTestDatabaseUrl(process.env.DATABASE_URL_TEST),
    });
    await client.connect();
  });

  beforeEach(async () => {
    schema = `ledger_migration_${randomUUID().replaceAll('-', '')}`;
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    for (const migration of previousMigrations) await client.query(migration);
  });

  afterEach(async () => {
    await client.query('ROLLBACK');
    await client.query('SET search_path TO public');
    await client.query(`DROP SCHEMA "${schema}" CASCADE`);
  });

  afterAll(async () => {
    await client?.end();
  });

  it('creates empty ledger tables on an empty database', async () => {
    await client.query(ledgerMigration);
    for (const table of [
      'InvestmentEvent',
      'Trade',
      'CashEntry',
      'SecurityEntry',
    ]) {
      expect((await client.query(`SELECT * FROM "${table}"`)).rows).toEqual(
        [],
      );
    }
  });

  it('preserves existing users, budget transactions and investment models', async () => {
    const userId = randomUUID();
    const walletId = randomUUID();
    const categoryId = randomUUID();
    const portfolioId = randomUUID();
    const accountId = randomUUID();
    const instrumentId = randomUUID();
    await client.query(
      'INSERT INTO "User" ("id", "email", "passwordHash", "updatedAt") VALUES ($1, $2, $3, NOW())',
      [userId, `existing-${userId}@example.invalid`, 'test-hash'],
    );
    await client.query(
      'INSERT INTO "Wallet" ("id", "userId", "name", "openingBalance") VALUES ($1, $2, $3, $4)',
      [walletId, userId, 'Budget', '42.50'],
    );
    await client.query(
      'INSERT INTO "Category" ("id", "name", "type") VALUES ($1, $2, $3)',
      [categoryId, 'Food', 'EXPENSE'],
    );
    await client.query(
      'INSERT INTO "Transaction" ("id", "walletId", "type", "amount", "categoryId", "title", "occurredOn", "updatedAt") VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())',
      [randomUUID(), walletId, 'EXPENSE', '12.34', categoryId, 'Lunch', '2026-11-10'],
    );
    await client.query(
      'INSERT INTO "Portfolio" ("id", "userId", "name", "updatedAt") VALUES ($1, $2, $3, NOW())',
      [portfolioId, userId, 'Investments'],
    );
    await client.query(
      'INSERT INTO "InvestmentAccount" ("id", "portfolioId", "name", "updatedAt") VALUES ($1, $2, $3, NOW())',
      [accountId, portfolioId, 'Broker'],
    );
    await client.query(
      'INSERT INTO "Instrument" ("id", "ticker", "mic", "currency", "updatedAt") VALUES ($1, $2, $3, $4, NOW())',
      [instrumentId, 'CDR', 'XWAR', 'PLN'],
    );
    const oldTables = [
      'User', 'Wallet', 'Category', 'Transaction',
      'Portfolio', 'InvestmentAccount', 'Instrument',
    ];
    const before = await Promise.all(
      oldTables.map((table) =>
        client.query(`SELECT * FROM "${table}" ORDER BY 1`).then((result) => result.rows),
      ),
    );

    await client.query(ledgerMigration);

    const after = await Promise.all(
      oldTables.map((table) =>
        client.query(`SELECT * FROM "${table}" ORDER BY 1`).then((result) => result.rows),
      ),
    );
    expect(after).toEqual(before);
    expect((await client.query('SELECT * FROM "InvestmentEvent"')).rows).toEqual([]);
  });
});
