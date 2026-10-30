import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { Client } from 'pg';

const backendDirectory = fileURLToPath(new URL('../../', import.meta.url));

export function loadTestEnvironment(): void {
  config({ path: new URL('../../.env.test', import.meta.url), quiet: true });
}

export function getTestDatabaseUrl(
  value: string | undefined,
  variableName = 'DATABASE_URL_TEST',
): string {
  if (!value) {
    throw new Error(
      'Brak ' +
        variableName +
        '. Przygotuj backend/.env.test według backend/.env.test.example.',
    );
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(variableName + ' musi być poprawnym adresem PostgreSQL.');
  }
  if (
    !['postgresql:', 'postgres:'].includes(url.protocol) ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    !/^\/[a-zA-Z0-9_]+_test$/.test(url.pathname) ||
    [...url.searchParams].some(
      ([key, entry]) => key !== 'schema' || entry !== 'public',
    )
  ) {
    throw new Error(
      'Testy wymagają lokalnej bazy PostgreSQL z nazwą zakończoną na _test i schematem public.',
    );
  }
  return value;
}

export function getBrowserDatabaseUrl(
  environment: Record<string, string | undefined> = process.env,
): string {
  const value = getTestDatabaseUrl(
    environment.DATABASE_URL_BROWSER_TEST,
    'DATABASE_URL_BROWSER_TEST',
  );
  const name = new URL(value).pathname;
  // Compare database names even across localhost aliases and different users.
  for (const other of [
    environment.DATABASE_URL_TEST,
    environment.DATABASE_URL,
  ]) {
    if (!other) continue;
    let otherName: string;
    try {
      otherName = new URL(other).pathname;
    } catch {
      throw new Error('Nieprawidłowy adres bazy w konfiguracji testów.');
    }
    if (name === otherName) {
      throw new Error(
        'DATABASE_URL_BROWSER_TEST musi wskazywać inną bazę niż DATABASE_URL_TEST i DATABASE_URL.',
      );
    }
  }
  return value;
}

export async function prepareTestDatabase(
  connectionString: string,
): Promise<void> {
  const databaseUrl = new URL(getTestDatabaseUrl(connectionString));
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
      await client.query('CREATE DATABASE "' + databaseName + '"');
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
      cwd: backendDirectory,
      env: { ...process.env, DATABASE_URL: connectionString },
      stdio: 'pipe',
      timeout: 30000,
    },
  );
}
