import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { MarketDataError } from './contracts.js';

@Injectable()
export class MarketDataBudgetService {
  constructor(private readonly prisma: PrismaService) {}
  async reserve(keyHash: string, observed: number, limit: number, now = new Date(), cost = 1): Promise<number> {
    const day = new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
    return this.prisma.$transaction(async tx => {
      await tx.$executeRaw`INSERT INTO "MarketDataBudget" ("provider", "keyHash", "day") VALUES ('EODHD', ${keyHash}, ${day}) ON CONFLICT DO NOTHING`;
      const [row] = await tx.$queryRaw<{ spent: number; lastRequestAt: Date | null; blockedUntil: Date | null }[]>`
        SELECT "spent", "lastRequestAt", "blockedUntil" FROM "MarketDataBudget"
        WHERE "provider" = 'EODHD' AND "keyHash" = ${keyHash} AND "day" = ${day} FOR UPDATE`;
      const spent = Math.max(row.spent, observed);
      if (row.blockedUntil && row.blockedUntil > now) throw new MarketDataError('rate_limit', 'Dostawca tymczasowo ograniczył zapytania.');
      if (cost > 0 && spent >= limit) throw new MarketDataError('budget', 'Wyczerpano dzienny budżet danych.');
      const at = new Date(Math.max(now.getTime(), (row.lastRequestAt?.getTime() ?? 0) + 3200));
      await tx.marketDataBudget.update({ where: { provider_keyHash_day: { provider: 'EODHD', keyHash, day } }, data: { spent: spent + cost, lastRequestAt: at } });
      return at.getTime() - now.getTime();
    });
  }
  async block(keyHash: string, until: Date, now = new Date()) {
    await this.prisma.marketDataBudget.updateMany({ where: { provider: 'EODHD', keyHash, day: new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`) }, data: { blockedUntil: until } });
  }
}
