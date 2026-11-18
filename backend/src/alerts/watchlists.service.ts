import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { quoteFreshness } from '../market-data/calendar.js';

@Injectable()
export class WatchlistsService {
  constructor(private readonly prisma: PrismaService) {}
  async owned(userId: string, id: string) {
    const list = await this.prisma.watchlist.findFirst({ where: { id, userId } });
    if (!list) throw new NotFoundException('Nie znaleziono watchlisty.');
    return list;
  }
  async list(userId: string) {
    const lists = await this.prisma.watchlist.findMany({ where: { userId }, orderBy: { createdAt: 'asc' }, include: { items: { orderBy: { createdAt: 'asc' }, include: { instrument: { include: { priceBars: { where: { source: 'EODHD', currentSlot: 1 }, orderBy: { sessionOn: 'desc' }, take: 1 } } } } } } });
    return lists.map(list => ({ id: list.id, name: list.name, items: list.items.map(item => {
      const i = item.instrument, price = i.priceBars[0], sessionOn = price?.sessionOn.toISOString().slice(0, 10) ?? null;
      let status = 'unverified_calendar'; try { status = quoteFreshness(i.mic, sessionOn).status; } catch { /* Explicitly report the calendar gap. */ }
      return { instrument: { id: i.id, ticker: i.ticker, name: i.name, mic: i.mic, currency: i.currency },
        quote: price ? { close: price.close.toFixed(10), sessionOn, source: price.source } : null, status };
    }) }));
  }
  async create(userId: string, name: string) {
    return this.prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT "id" FROM "User" WHERE "id" = ${userId}::uuid FOR UPDATE`;
      if (await tx.watchlist.count({ where: { userId } }) >= 10) throw new BadRequestException('Możesz utworzyć najwyżej 10 watchlist.');
      return tx.watchlist.create({ data: { userId, name }, select: { id: true, name: true } });
    });
  }
  async rename(userId: string, id: string, name: string) { await this.owned(userId, id); return this.prisma.watchlist.update({ where: { id, userId }, data: { name }, select: { id: true, name: true } }); }
  async remove(userId: string, id: string) { await this.owned(userId, id); await this.prisma.watchlist.delete({ where: { id, userId } }); }
  async add(userId: string, listId: string, instrumentId: string) {
    return this.prisma.$transaction(async tx => {
      const lock = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Watchlist" WHERE "id" = ${listId}::uuid AND "userId" = ${userId}::uuid FOR UPDATE`;
      if (!lock.length) throw new NotFoundException('Nie znaleziono watchlisty.');
      const existing = await tx.watchlistItem.findUnique({ where: { watchlistId_instrumentId: { watchlistId: listId, instrumentId } } });
      if (existing) return { instrumentId };
      if (await tx.watchlistItem.count({ where: { watchlistId: listId } }) >= 50) throw new BadRequestException('Watchlista może zawierać najwyżej 50 instrumentów.');
      if (!await tx.instrument.findUnique({ where: { id: instrumentId } })) throw new NotFoundException('Nie znaleziono instrumentu.');
      await tx.watchlistItem.create({ data: { watchlistId: listId, instrumentId } }); return { instrumentId };
    });
  }
  async removeItem(userId: string, listId: string, instrumentId: string) { await this.owned(userId, listId); await this.prisma.watchlistItem.deleteMany({ where: { watchlistId: listId, instrumentId } }); }
}
