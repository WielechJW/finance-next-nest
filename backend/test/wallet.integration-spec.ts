import { randomUUID } from 'node:crypto';
import { Prisma } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { UsersService } from '../src/users/users.service.js';
import { formatMoney } from '../src/wallets/money.js';

describe('Wallet constraints and money (PostgreSQL)', () => {
  const emails = new Set<string>();
  let prisma: PrismaService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
  });

  afterEach(async () => {
    await prisma.user.deleteMany({ where: { email: { in: [...emails] } } });
    emails.clear();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  async function createWallet() {
    const email = `wallet-${randomUUID()}@example.invalid`;
    emails.add(email);
    const user = await new UsersService(prisma).create({
      email,
      passwordHash: 'test-only-hash',
    });
    return prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } });
  }

  it('rejects a second wallet for the same user', async () => {
    const wallet = await createWallet();
    await expect(
      prisma.wallet.create({ data: { userId: wallet.userId } }),
    ).rejects.toMatchObject({ code: 'P2002' });
    expect(
      await prisma.wallet.count({ where: { userId: wallet.userId } }),
    ).toBe(1);
  });

  it('rejects a wallet without an existing user', async () => {
    await expect(
      prisma.wallet.create({ data: { userId: randomUUID() } }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  it('only permits PLN at the database level', async () => {
    const wallet = await createWallet();
    await expect(
      prisma.$executeRaw`UPDATE "Wallet" SET "currency" = 'EUR' WHERE "id" = ${wallet.id}::uuid`,
    ).rejects.toThrow();
    const stored = await prisma.wallet.findUniqueOrThrow({
      where: { id: wallet.id },
    });
    expect(stored.currency).toBe('PLN');
  });

  it.each([
    '0.00',
    '0.10',
    '0.20',
    '-123.45',
    '999999999999.99',
    '-999999999999.99',
  ])('stores and serializes opening balance %s exactly', async (amount) => {
    const wallet = await createWallet();
    await prisma.wallet.update({
      where: { id: wallet.id },
      data: { openingBalance: new Prisma.Decimal(amount) },
    });
    const stored = await prisma.wallet.findUniqueOrThrow({
      where: { id: wallet.id },
    });
    expect(formatMoney(stored.openingBalance)).toBe(amount);
  });

  it('preserves cents when adding 0.10 and 0.20 read from PostgreSQL', async () => {
    const first = await createWallet();
    const second = await createWallet();
    await prisma.wallet.update({
      where: { id: first.id },
      data: { openingBalance: new Prisma.Decimal('0.10') },
    });
    await prisma.wallet.update({
      where: { id: second.id },
      data: { openingBalance: new Prisma.Decimal('0.20') },
    });
    const left = await prisma.wallet.findUniqueOrThrow({
      where: { id: first.id },
    });
    const right = await prisma.wallet.findUniqueOrThrow({
      where: { id: second.id },
    });
    expect(formatMoney(left.openingBalance.plus(right.openingBalance))).toBe(
      '0.30',
    );
  });

  it.each(['1000000000000.00', '-1000000000000.00'])(
    'rejects %s outside the Decimal(14,2) range',
    async (amount) => {
      const wallet = await createWallet();
      await expect(
        prisma.wallet.update({
          where: { id: wallet.id },
          data: { openingBalance: new Prisma.Decimal(amount) },
        }),
      ).rejects.toThrow();
      const stored = await prisma.wallet.findUniqueOrThrow({
        where: { id: wallet.id },
      });
      expect(formatMoney(stored.openingBalance)).toBe('0.00');
    },
  );

  it('deletes the wallet with its owner', async () => {
    const wallet = await createWallet();
    await prisma.user.delete({ where: { id: wallet.userId } });
    expect(
      await prisma.wallet.findUnique({ where: { id: wallet.id } }),
    ).toBeNull();
  });
});
