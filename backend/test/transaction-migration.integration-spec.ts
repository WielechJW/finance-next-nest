import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Client } from 'pg';
import { getTestDatabaseUrl } from './support/database.js';

describe('Transaction migration (isolated PostgreSQL schema)', () => {
  let client: Client;
  let schema: string;
  let previousMigrations: string[];
  let transactionMigration: string;

  beforeAll(async () => {
    const migrations = await Promise.all(
      [
        '20261029112004_create_user',
        '20261029121329_add_sessions',
        '20261102120000_add_wallet',
        '20261109120000_add_transactions_and_categories',
      ].map((name) =>
        readFile(
          new URL(
            '../prisma/migrations/' + name + '/migration.sql',
            import.meta.url,
          ),
          'utf8',
        ),
      ),
    );
    previousMigrations = migrations.slice(0, -1);
    transactionMigration = migrations.at(-1)!;
    client = new Client({
      connectionString: getTestDatabaseUrl(process.env.DATABASE_URL_TEST),
    });
    await client.connect();
  });

  beforeEach(async () => {
    schema = 'transaction_migration_' + randomUUID().replaceAll('-', '');
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

  async function existingData() {
    return {
      users: (await client.query('SELECT * FROM "User"')).rows,
      wallets: (await client.query('SELECT * FROM "Wallet"')).rows,
      sessions: (await client.query('SELECT * FROM "session"')).rows,
    };
  }

  it('applies to an empty database without creating transactions or categories', async () => {
    await client.query(transactionMigration);
    expect((await client.query('SELECT * FROM "Transaction"')).rows).toEqual(
      [],
    );
    expect((await client.query('SELECT * FROM "Category"')).rows).toEqual([]);
  });

  it('preserves existing users, wallets, opening balances and sessions', async () => {
    const userId = randomUUID();
    await client.query(
      'INSERT INTO "User" ("id", "email", "passwordHash", "updatedAt") VALUES ($1, $2, $3, NOW())',
      [userId, `legacy-${userId}@example.invalid`, 'legacy-hash'],
    );
    await client.query(
      'INSERT INTO "Wallet" ("id", "userId", "name", "openingBalance") VALUES ($1, $2, $3, $4)',
      [randomUUID(), userId, 'Istniejący portfel', '-123.45'],
    );
    await client.query(
      'INSERT INTO "session" ("sid", "sess", "expire") VALUES ($1, $2, $3)',
      [
        'legacy-session',
        JSON.stringify({ userId }),
        new Date('2026-12-01T12:00:00Z'),
      ],
    );
    const before = await existingData();

    await client.query(transactionMigration);

    expect(await existingData()).toEqual(before);
    expect((await client.query('SELECT * FROM "Transaction"')).rows).toEqual(
      [],
    );
  });
});
