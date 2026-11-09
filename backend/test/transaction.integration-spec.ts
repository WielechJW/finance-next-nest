import { randomUUID } from 'node:crypto';
import {
  seedSystemCategories,
  SYSTEM_CATEGORIES,
} from '../src/categories/system-categories.js';
import { Prisma } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { UsersService } from '../src/users/users.service.js';
import { formatMoney } from '../src/wallets/money.js';

const expense = SYSTEM_CATEGORIES[0];
const income = SYSTEM_CATEGORIES[4];

describe('Transactions and system categories (PostgreSQL)', () => {
  const emails = new Set<string>();
  let prisma: PrismaService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await seedSystemCategories(prisma);
  });

  afterEach(async () => {
    await prisma.user.deleteMany({ where: { email: { in: [...emails] } } });
    emails.clear();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  async function createWallet() {
    const email = `transaction-${randomUUID()}@example.invalid`;
    emails.add(email);
    const user = await new UsersService(prisma).create({
      email,
      passwordHash: 'test-only-hash',
    });
    return prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } });
  }

  async function createTransaction(
    changes: Partial<Prisma.TransactionUncheckedCreateInput> = {},
  ) {
    const wallet = await createWallet();
    return prisma.transaction.create({
      data: {
        walletId: wallet.id,
        type: 'EXPENSE',
        amount: new Prisma.Decimal('12.34'),
        categoryId: expense.id,
        title: 'Zakupy',
        occurredOn: new Date('2026-11-09T00:00:00.000Z'),
        ...changes,
      },
    });
  }

  it.each([expense, income])(
    'stores a $type with its category, calendar date, optional note and timestamps',
    async (category) => {
      const transaction = await createTransaction({
        type: category.type,
        categoryId: category.id,
        note: 'Notatka do operacji',
      });
      const stored = await prisma.transaction.findUniqueOrThrow({
        where: { id: transaction.id },
        include: { category: true },
      });
      expect(stored).toMatchObject({
        id: expect.any(String),
        walletId: transaction.walletId,
        type: category.type,
        categoryId: category.id,
        category,
        title: 'Zakupy',
        note: 'Notatka do operacji',
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
      });
      expect(formatMoney(stored.amount)).toBe('12.34');
      expect(stored.occurredOn.toISOString()).toBe('2026-11-09T00:00:00.000Z');
    },
  );

  it('keeps opening balances separate from transactions', async () => {
    const wallet = await createWallet();
    await prisma.wallet.update({
      where: { id: wallet.id },
      data: { openingBalance: new Prisma.Decimal('100.50') },
    });
    expect(
      await prisma.transaction.count({ where: { walletId: wallet.id } }),
    ).toBe(0);
    const stored = await prisma.wallet.findUniqueOrThrow({
      where: { id: wallet.id },
    });
    expect(formatMoney(stored.openingBalance)).toBe('100.50');
  });

  it('seeds the same category IDs and types repeatedly without changing linked transactions', async () => {
    const transaction = await createTransaction();
    const before = await prisma.category.findMany({ orderBy: { id: 'asc' } });
    const system = before.filter((category) =>
      SYSTEM_CATEGORIES.some(({ id }) => id === category.id),
    );
    expect(system).toEqual(SYSTEM_CATEGORIES);
    await seedSystemCategories(prisma);
    await seedSystemCategories(prisma);
    expect(await prisma.category.findMany({ orderBy: { id: 'asc' } })).toEqual(
      before,
    );
    expect(
      await prisma.transaction.findUnique({ where: { id: transaction.id } }),
    ).toEqual(transaction);
  });

  it.each(['0.01', '0.10', '0.20', '999999999999.99'])(
    'stores the positive amount %s without losing cents',
    async (amount) => {
      const transaction = await createTransaction({
        amount: new Prisma.Decimal(amount),
      });
      expect(formatMoney(transaction.amount)).toBe(amount);
      expect(transaction.note).toBeNull();
    },
  );

  it.each(['0.00', '-0.01', '-123.45', '1000000000000.00', 'NaN'])(
    'rejects the invalid amount %s in SQL',
    async (amount) => {
      const wallet = await createWallet();
      await expect(prisma.$executeRaw`
        INSERT INTO "Transaction"
          ("id", "walletId", "type", "amount", "categoryId", "title", "occurredOn", "updatedAt")
        VALUES (${randomUUID()}::uuid, ${wallet.id}::uuid, 'EXPENSE',
          ${amount}::numeric, ${expense.id}::uuid, 'Błędna kwota', DATE '2026-11-09', NOW())
      `).rejects.toThrow();
      expect(
        await prisma.transaction.count({ where: { walletId: wallet.id } }),
      ).toBe(0);
    },
  );

  it.each([
    '0001-01-01',
    '2024-02-29',
    '2026-03-29',
    '2026-10-25',
    '9999-12-31',
  ])(
    'keeps %s as a calendar date regardless of database timezone',
    async (day) => {
      const transaction = await createTransaction({
        occurredOn: new Date(day + 'T00:00:00.000Z'),
      });
      await prisma.$transaction(async (database) => {
        await database.$executeRaw`SET LOCAL TIME ZONE 'Pacific/Kiritimati'`;
        const stored = await database.transaction.findUniqueOrThrow({
          where: { id: transaction.id },
        });
        expect(stored.occurredOn.toISOString()).toBe(day + 'T00:00:00.000Z');
        const rows = await database.$queryRaw<{ day: string; kind: string }[]>`
        SELECT "occurredOn"::text AS day, pg_typeof("occurredOn")::text AS kind
        FROM "Transaction" WHERE "id" = ${transaction.id}::uuid
      `;
        expect(rows).toEqual([{ day, kind: 'date' }]);
      });
    },
  );

  it.each(['2026-02-29', '2026-04-31', 'infinity', '-infinity', '10000-01-01'])(
    'rejects the invalid or unsupported date %s in SQL',
    async (day) => {
      const wallet = await createWallet();
      await expect(prisma.$executeRaw`
        INSERT INTO "Transaction"
          ("id", "walletId", "type", "amount", "categoryId", "title", "occurredOn", "updatedAt")
        VALUES (${randomUUID()}::uuid, ${wallet.id}::uuid, 'EXPENSE',
          1.00, ${expense.id}::uuid, 'Błędna data', ${day}::date, NOW())
      `).rejects.toThrow();
    },
  );

  it.each([
    { type: 'INCOME', categoryId: expense.id },
    { type: 'EXPENSE', categoryId: income.id },
  ] as const)(
    'rejects a $type with a category of the other type',
    async (changes) => {
      await expect(createTransaction(changes)).rejects.toMatchObject({
        code: 'P2003',
      });
    },
  );

  it('rejects partial updates that leave the type and category inconsistent', async () => {
    const transaction = await createTransaction();
    for (const data of [
      { type: 'INCOME' },
      { categoryId: income.id },
    ] as const) {
      await expect(
        prisma.transaction.update({ where: { id: transaction.id }, data }),
      ).rejects.toMatchObject({ code: 'P2003' });
    }
    const updated = await prisma.transaction.update({
      where: { id: transaction.id },
      data: { type: 'INCOME', categoryId: income.id },
    });
    expect(updated.type).toBe('INCOME');
    expect(updated.categoryId).toBe(income.id);
  });

  it('requires an existing wallet and category', async () => {
    await expect(
      createTransaction({ walletId: randomUUID() }),
    ).rejects.toMatchObject({ code: 'P2003' });
    await expect(
      createTransaction({ categoryId: randomUUID() }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  it('prevents deleting or retyping a category used by a transaction', async () => {
    const transaction = await createTransaction();
    await expect(
      prisma.category.delete({ where: { id: expense.id } }),
    ).rejects.toMatchObject({ code: 'P2003' });
    await expect(
      prisma.category.update({
        where: { id: expense.id },
        data: { type: 'INCOME' },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
    expect(
      await prisma.transaction.findUnique({ where: { id: transaction.id } }),
    ).toEqual(transaction);
  });

  it('deletes transactions with their owner while preserving system categories', async () => {
    const transaction = await createTransaction();
    const wallet = await prisma.wallet.findUniqueOrThrow({
      where: { id: transaction.walletId },
    });
    await prisma.user.delete({ where: { id: wallet.userId } });
    expect(
      await prisma.transaction.findUnique({ where: { id: transaction.id } }),
    ).toBeNull();
    expect(
      await prisma.category.findUnique({ where: { id: expense.id } }),
    ).toEqual(expense);
  });
});
