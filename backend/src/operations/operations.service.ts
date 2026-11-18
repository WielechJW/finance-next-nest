import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Redis } from 'ioredis';
import { PrismaService } from '../prisma/prisma.service.js';
import { redisConnection } from '../jobs/redis.js';
import { quoteFreshness } from '../market-data/calendar.js';

export async function redisReady() {
  const redis = new Redis({
    ...redisConnection(),
    lazyConnect: true,
    connectTimeout: 2000,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
  });
  redis.on('error', () => {});
  try {
    await redis.connect();
    return (await redis.ping()) === 'PONG';
  } catch {
    return false;
  } finally {
    redis.disconnect();
  }
}
@Injectable()
export class OperationsService {
  constructor(private readonly prisma: PrismaService) {}
  authorize(userId: string) {
    if (
      !process.env.OPERATOR_USER_ID ||
      process.env.OPERATOR_USER_ID !== userId
    )
      throw new ForbiddenException('Ta funkcja jest dostępna dla operatora.');
  }
  async ready() {
    let database = false,
      redis = false,
      worker = false;
    const enabled = process.env.MARKET_DATA_ENABLED === '1';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      database = true;
      if (enabled) {
        const heartbeat = await this.prisma.workerHeartbeat.findUnique({
          where: { name: 'market-data' },
        });
        worker =
          !!heartbeat && Date.now() - heartbeat.updatedAt.getTime() < 120000;
        redis = await redisReady();
      }
    } catch {
      /* Readiness exposes no connection strings or database errors. */
    }
    const result = {
      ready: database && (!enabled || (redis && worker)),
      database,
      redis: enabled ? redis : null,
      worker: enabled ? worker : null,
    };
    if (!result.ready) throw new ServiceUnavailableException(result);
    return result;
  }
  async status(userId: string, now = new Date()) {
    this.authorize(userId);
    const day = new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
    const [
      queue,
      deliveries,
      heartbeat,
      latestSuccess,
      budget,
      quotes,
      failures,
    ] = await Promise.all([
      this.prisma.marketJob.groupBy({
        by: ['kind', 'status'],
        _count: { _all: true },
      }),
      this.prisma.notification.groupBy({
        by: ['state'],
        _count: { _all: true },
      }),
      this.prisma.workerHeartbeat.findUnique({
        where: { name: 'market-data' },
      }),
      this.prisma.marketJob.findFirst({
        where: {
          status: 'SUCCEEDED',
          kind: { in: ['prices', 'fx', 'dividends', 'splits'] },
        },
        orderBy: { finishedAt: 'desc' },
        select: { kind: true, finishedAt: true },
      }),
      this.prisma.marketDataBudget.findMany({
        where: { provider: 'EODHD', day },
        select: { spent: true, lastRequestAt: true, blockedUntil: true },
      }),
      this.prisma.priceBar.findMany({
        where: { currentSlot: 1, source: 'EODHD' },
        distinct: ['instrumentId'],
        orderBy: [{ instrumentId: 'asc' }, { sessionOn: 'desc' }],
        take: 100,
        include: { instrument: { select: { ticker: true, mic: true } } },
      }),
      this.prisma.marketJob.findMany({
        where: { status: 'FAILED' },
        orderBy: { updatedAt: 'desc' },
        take: 25,
        select: {
          id: true,
          kind: true,
          errorCode: true,
          attempts: true,
          updatedAt: true,
        },
      }),
    ]);
    return {
      enabled: process.env.MARKET_DATA_ENABLED === '1',
      queue,
      deliveries,
      heartbeat,
      latestSuccess,
      budget,
      failures,
      quotes: quotes.map((row) => {
        let freshness: { status: string; expectedSessionOn: string | null };
        try {
          freshness = quoteFreshness(
            row.instrument.mic,
            row.sessionOn.toISOString().slice(0, 10),
            now,
          );
        } catch {
          freshness = {
            status: 'calendar_unavailable',
            expectedSessionOn: null,
          };
        }
        return {
          ticker: row.instrument.ticker,
          mic: row.instrument.mic,
          sessionOn: row.sessionOn.toISOString().slice(0, 10),
          fetchedAt: row.fetchedAt,
          ...freshness,
        };
      }),
    };
  }
  async retry(userId: string, id: string) {
    this.authorize(userId);
    // Delivery UNKNOWN is retried only by its owner through the explicit duplicate-risk flow.
    const updated = await this.prisma.marketJob.updateMany({
      where: {
        id,
        status: 'FAILED',
        kind: { in: ['prices', 'fx', 'dividends', 'splits', 'valuation'] },
      },
      data: {
        status: 'PENDING',
        attempts: 0,
        errorCode: null,
        runAfter: new Date(),
        runToken: null,
        leaseUntil: null,
        finishedAt: null,
      },
    });
    if (!updated.count)
      throw new BadRequestException(
        'Można ponowić tylko błędne zadanie danych lub wyceny.',
      );
    return { queued: true };
  }
}
