import { config } from 'dotenv';

export function getTestDatabaseUrl(value: string | undefined): string {
  if (!value) {
    throw new Error(
      'Brak DATABASE_URL_TEST. Przygotuj backend/.env.test według backend/.env.test.example.',
    );
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('DATABASE_URL_TEST musi być poprawnym adresem PostgreSQL.');
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

export function configureTestDatabase(): string {
  config({ path: new URL('../../.env.test', import.meta.url), quiet: true });
  const url = getTestDatabaseUrl(process.env.DATABASE_URL_TEST);
  process.env.DATABASE_URL = url;
  return url;
}
