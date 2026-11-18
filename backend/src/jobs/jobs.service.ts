import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { MarketDataError } from '../market-data/contracts.js';

@Injectable()
export class MarketJobsService {
  constructor(private readonly prisma: PrismaService) {}
  ensure(key: string, kind: string, payload: Prisma.InputJsonObject, priority = 10) {
    return this.prisma.marketJob.upsert({ where: { key }, create: { key, kind, payload, priority }, update: {} });
  }
  async dispatch(queue: Pick<Queue, 'add'>, now = new Date(), kinds = ['prices', 'dividends', 'splits', 'fx', 'valuation']) {
    const rows = await this.prisma.marketJob.findMany({ where: { kind: { in: kinds }, OR: [
      { status: { in: ['PENDING', 'RETRY'] }, runAfter: { lte: now } }, { status: 'RUNNING', leaseUntil: { lt: now } },
    ] }, orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }], take: 100 });
    for (const row of rows) await queue.add('execute', { id: row.id }, { jobId: row.id, priority: row.priority, removeOnComplete: true, removeOnFail: true });
    return rows.length;
  }
  async begin(id: string, now = new Date()) {
    return this.prisma.$transaction(async tx => {
      const [row] = await tx.$queryRaw<{ id: string; status: string; leaseUntil: Date | null; runAfter: Date; attempts: number }[]>`SELECT "id", "status", "leaseUntil", "runAfter", "attempts" FROM "MarketJob" WHERE "id" = ${id}::uuid FOR UPDATE`;
      if (!row || ['SUCCEEDED', 'FAILED'].includes(row.status) || row.runAfter > now || (row.status === 'RUNNING' && row.leaseUntil && row.leaseUntil > now)) return null;
      return tx.marketJob.update({ where: { id }, data: { status: 'RUNNING', runToken: randomUUID(), leaseUntil: new Date(now.getTime() + 120000), attempts: { increment: 1 }, errorCode: null } });
    });
  }
  heartbeat(id: string, runToken: string) {
    return this.prisma.marketJob.updateMany({ where: { id, runToken, status: 'RUNNING' }, data: { leaseUntil: new Date(Date.now() + 120000) } });
  }
  complete(id: string, runToken: string) {
    return this.prisma.marketJob.updateMany({ where: { id, runToken, status: 'RUNNING' }, data: { status: 'SUCCEEDED', leaseUntil: null, runToken: null, finishedAt: new Date() } });
  }
  async fail(id: string, runToken: string, error: unknown) {
    const row = await this.prisma.marketJob.findUniqueOrThrow({ where: { id } });
    const code = error instanceof MarketDataError ? error.code : 'internal';
    const budget = code === 'budget';
    const nextDay = new Date(); nextDay.setUTCHours(24, 5, 0, 0);
    const terminal = !budget && (row.attempts >= 5 || ['configuration', 'invalid_data', 'access'].includes(code));
    return this.prisma.marketJob.updateMany({ where: { id, runToken, status: 'RUNNING' }, data: {
      status: terminal ? 'FAILED' : 'RETRY', errorCode: code, runToken: null, leaseUntil: null,
      runAfter: budget ? nextDay : new Date(Date.now() + Math.min(3600000, 30000 * 2 ** Math.min(row.attempts, 7))),
    } });
  }
}
