import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Client } from 'pg';
import { getTestDatabaseUrl } from './support/database.js';

describe('Wallet migration (isolated PostgreSQL schema)', () => {
  let client: Client;
  let schema: string;
  let userMigration: string;
  let sessionMigration: string;
  let walletMigration: string;

  beforeAll(async () => {
    [userMigration, sessionMigration, walletMigration] = await Promise.all([
      readFile(
        new URL(
          '../prisma/migrations/20261029112004_create_user/migration.sql',
          import.meta.url,
        ),
        'utf8',
      ),
      readFile(
        new URL(
          '../prisma/migrations/20261029121329_add_sessions/migration.sql',
          import.meta.url,
        ),
        'utf8',
      ),
      readFile(
        new URL(
          '../prisma/migrations/20261102120000_add_wallet/migration.sql',
          import.meta.url,
        ),
        'utf8',
      ),
    ]);
    client = new Client({
      connectionString: getTestDatabaseUrl(process.env.DATABASE_URL_TEST),
    });
    await client.connect();
  });

  beforeEach(async () => {
    schema = 'wallet_migration_' + randomUUID().replaceAll('-', '');
    await client.query(`CREATE SCHEMA "${schema}"`);
    // No public fallback: these tests cannot modify the normal test tables.
    await client.query(`SET search_path TO "${schema}"`);
    await client.query(userMigration);
    await client.query(sessionMigration);
  });

  afterEach(async () => {
    // Also recover the connection if a migration statement failed.
    await client.query('ROLLBACK');
    await client.query('SET search_path TO public');
    await client.query(`DROP SCHEMA "${schema}" CASCADE`);
  });

  afterAll(async () => {
    await client?.end();
  });

  it('applies to an empty database', async () => {
    await client.query(walletMigration);
    const result = await client.query('SELECT * FROM "Wallet"');
    expect(result.rows).toEqual([]);
  });

  it('backfills one zero PLN wallet per existing account and preserves users and sessions', async () => {
    const ids = [randomUUID(), randomUUID()];
    for (const id of ids) {
      await client.query(
        'INSERT INTO "User" ("id", "email", "passwordHash", "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $4)',
        [
          id,
          `legacy-${id}@example.invalid`,
          `legacy-hash-${id}`,
          new Date('2026-10-01T12:00:00Z'),
        ],
      );
    }
    await client.query(
      'INSERT INTO "session" ("sid", "sess", "expire") VALUES ($1, $2, $3)',
      [
        'legacy-session',
        JSON.stringify({ userId: ids[0] }),
        new Date('2026-12-01T12:00:00Z'),
      ],
    );
    const usersBefore = await client.query(
      'SELECT * FROM "User" ORDER BY "id"',
    );
    const sessionsBefore = await client.query('SELECT * FROM "session"');

    await client.query(walletMigration);

    const usersAfter = await client.query('SELECT * FROM "User" ORDER BY "id"');
    const sessionsAfter = await client.query('SELECT * FROM "session"');
    expect(usersAfter.rows).toEqual(usersBefore.rows);
    expect(sessionsAfter.rows).toEqual(sessionsBefore.rows);
    const wallets = await client.query<{
      id: string;
      userId: string;
      name: string;
      currency: string;
      openingBalance: string;
    }>('SELECT * FROM "Wallet" ORDER BY "userId"');
    expect(wallets.rows).toEqual(
      [...ids].sort().map((userId) => ({
        id: expect.any(String),
        userId,
        name: 'Mój portfel',
        currency: 'PLN',
        openingBalance: '0.00',
      })),
    );
    expect(new Set(wallets.rows.map((wallet) => wallet.id)).size).toBe(
      ids.length,
    );
  });
});
