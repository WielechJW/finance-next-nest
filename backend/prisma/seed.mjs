import { seedSystemCategories } from '../dist/categories/system-categories.js';
import { seedInvestmentTestCatalog } from '../dist/instruments/test-catalog.js';
import { seedManualInvestmentCatalog } from '../dist/instruments/manual-catalog.js';
import { PrismaService } from '../dist/prisma/prisma.service.js';

let prisma;
try {
  prisma = new PrismaService();
  await prisma.$connect();
  await seedSystemCategories(prisma);
  await seedManualInvestmentCatalog(prisma);
  console.log('Kategorie systemowe zostały zapisane.');
  if (process.env.SEED_INVESTMENT_TEST_CATALOG === '1') {
    await seedInvestmentTestCatalog(prisma);
    console.log('Testowy katalog instrumentów został zapisany.');
  }
} catch {
  // Database errors can contain credentials; only report the failed operation.
  console.error('Nie udało się zapisać danych startowych. Sprawdź bazę i migracje.');
  process.exitCode = 1;
} finally {
  await prisma?.$disconnect();
}
