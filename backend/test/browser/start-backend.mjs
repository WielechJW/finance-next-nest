import { randomBytes } from 'node:crypto';
import {
  getBrowserDatabaseUrl,
  loadTestEnvironment,
  prepareTestDatabase,
} from '../support/database.ts';

try {
  loadTestEnvironment();
  const databaseUrl = getBrowserDatabaseUrl();
  await prepareTestDatabase(databaseUrl);
  Object.assign(process.env, {
    DATABASE_URL: databaseUrl,
    SESSION_SECRET: randomBytes(32).toString('hex'),
    SESSION_TTL_SECONDS: '3600',
    TRUST_PROXY_HOPS: '0',
    FRONTEND_ORIGIN: 'http://localhost:3100',
    PORT: '3101',
    NODE_ENV: 'test',
    AUTH_LOGIN_LIMIT: '1000',
    AUTH_LOGIN_TTL_SECONDS: '60',
    AUTH_REGISTER_LIMIT: '1000',
    AUTH_REGISTER_TTL_SECONDS: '900',
  });
  const { PrismaService } =
    await import('../../.browser-dist/prisma/prisma.service.js');
  const { seedSystemCategories } =
    await import('../../.browser-dist/categories/system-categories.js');
  const prisma = new PrismaService();
  try {
    await prisma.$connect();
    await seedSystemCategories(prisma);
  } finally {
    await prisma.$disconnect();
  }
  await import('../../.browser-dist/main.js');
} catch {
  // Driver/CLI errors can contain credentials; report only the setup context.
  console.error(
    'Nie udało się uruchomić backendu testowego. Sprawdź DATABASE_URL_BROWSER_TEST w backend/.env.test, gotowość PostgreSQL i migracje.',
  );
  process.exitCode = 1;
}
