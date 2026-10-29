import { config } from 'dotenv';

// The same path works from src/config and compiled dist/config.
config({ path: new URL('../../.env', import.meta.url), quiet: true });

export function getDatabaseUrl(
  environment: Record<string, string | undefined> = process.env,
): string {
  const value = environment.DATABASE_URL?.trim();

  if (!value) {
    throw new Error(
      'Brak DATABASE_URL. Ustaw zmienną środowiskową lub dodaj backend/.env według backend/.env.example.',
    );
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('DATABASE_URL musi być poprawnym adresem PostgreSQL.');
  }

  if (
    !['postgresql:', 'postgres:'].includes(url.protocol) ||
    !url.hostname ||
    url.pathname.length <= 1
  ) {
    throw new Error(
      'DATABASE_URL musi mieć format postgresql://użytkownik:hasło@host:port/baza.',
    );
  }

  return value;
}
