import { randomBytes } from 'node:crypto';
import {
  getTestDatabaseUrl,
  loadTestEnvironment,
} from '../support/database.js';

export { getTestDatabaseUrl } from '../support/database.js';

export function configureTestDatabase(): string {
  loadTestEnvironment();
  const url = getTestDatabaseUrl(process.env.DATABASE_URL_TEST);
  process.env.DATABASE_URL = url;
  // Never use the developer's cookie signing secret in integration tests.
  process.env.SESSION_SECRET =
    process.env.SESSION_SECRET_TEST?.trim() || randomBytes(32).toString('hex');
  process.env.SESSION_TTL_SECONDS = '3600';
  process.env.TRUST_PROXY_HOPS = '0';
  process.env.NODE_ENV = 'test';
  return url;
}
