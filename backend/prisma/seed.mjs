import { seedSystemCategories } from '../dist/categories/system-categories.js';
import { PrismaService } from '../dist/prisma/prisma.service.js';

let prisma;
try {
  prisma = new PrismaService();
  await prisma.$connect();
  await seedSystemCategories(prisma);
  console.log('Kategorie systemowe zostały zapisane.');
} catch {
  // Database errors can contain credentials; only report the failed operation.
  console.error('Nie udało się zapisać kategorii. Sprawdź bazę i migracje.');
  process.exitCode = 1;
} finally {
  await prisma?.$disconnect();
}
