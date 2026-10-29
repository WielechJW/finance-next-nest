import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { configureTestDatabase } from './database.js';

export default async function setup(): Promise<void> {
  const connectionString = configureTestDatabase();
  const databaseUrl = new URL(connectionString);
  const databaseName = databaseUrl.pathname.slice(1);
  const adminUrl = new URL(databaseUrl);
  adminUrl.pathname = '/postgres';

  const client = new Client({ connectionString: adminUrl.toString() });
  try {
    await client.connect();
    const existing = await client.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [databaseName],
    );
    if (existing.rowCount === 0) {
      // getTestDatabaseUrl restricts this identifier to letters, digits and _.
      await client.query(`CREATE DATABASE "${databaseName}"`);
    }
  } finally {
    await client.end();
  }

  execFileSync(
    process.execPath,
    [
      fileURLToPath(
        new URL('../../node_modules/prisma/build/index.js', import.meta.url),
      ),
      'migrate',
      'deploy',
    ],
    {
      cwd: fileURLToPath(new URL('../../', import.meta.url)),
      env: { ...process.env, DATABASE_URL: connectionString },
      stdio: 'pipe',
      timeout: 30000,
    },
  );
}
