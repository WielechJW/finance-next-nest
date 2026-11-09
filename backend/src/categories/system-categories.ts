import type { Prisma, PrismaClient } from '../generated/prisma/client.js';

// These IDs are part of the reference data contract; never regenerate them.
export const SYSTEM_CATEGORIES = [
  {
    id: '10000000-0000-4000-8000-000000000001',
    name: 'Jedzenie',
    type: 'EXPENSE',
  },
  {
    id: '10000000-0000-4000-8000-000000000002',
    name: 'Transport',
    type: 'EXPENSE',
  },
  {
    id: '10000000-0000-4000-8000-000000000003',
    name: 'Mieszkanie',
    type: 'EXPENSE',
  },
  {
    id: '10000000-0000-4000-8000-000000000004',
    name: 'Inne wydatki',
    type: 'EXPENSE',
  },
  {
    id: '10000000-0000-4000-8000-000000000005',
    name: 'Wynagrodzenie',
    type: 'INCOME',
  },
  {
    id: '10000000-0000-4000-8000-000000000006',
    name: 'Inne przychody',
    type: 'INCOME',
  },
] as const satisfies readonly Prisma.CategoryCreateInput[];

export async function seedSystemCategories(
  prisma: PrismaClient,
): Promise<void> {
  // One transaction keeps the reference data consistent if any upsert fails.
  await prisma.$transaction(
    SYSTEM_CATEGORIES.map((category) =>
      prisma.category.upsert({
        where: { id: category.id },
        create: category,
        update: { name: category.name, type: category.type },
      }),
    ),
  );
}
