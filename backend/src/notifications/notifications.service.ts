import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { TelegramClient } from './telegram.client.js';
import { quietUntil } from './quiet-hours.js';
import { PortfolioValuationService } from '../portfolio-analytics/valuation.service.js';
import {
  expectedSession,
  session,
  zonedClock,
} from '../market-data/calendar.js';

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramClient,
    private readonly valuations: PortfolioValuationService,
  ) {}
  async history(userId: string, page: number) {
    const where = { userId };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 25,
        skip: (page - 1) * 25,
        select: {
          id: true,
          kind: true,
          body: true,
          state: true,
          attempts: true,
          lastError: true,
          createdAt: true,
          sentAt: true,
        },
      }),
      this.prisma.notification.count({ where }),
    ]);
    return { items: rows, total };
  }
  async event(eventId: string, now = new Date()) {
    const event = await this.prisma.alertEvent.findUnique({
      where: { id: eventId },
      include: { alert: { include: { instrument: true } } },
    });
    if (!event) return;
    const instrument = event.alert.instrument;
    const body = [
      `Alert ${instrument.ticker} (${instrument.mic})`,
      `Cena: ${event.price.toFixed()} ${instrument.currency}; próg ${event.direction === 'ABOVE' ? '≥' : '≤'} ${event.threshold.toFixed()}.`,
      `Sesja: ${event.sessionOn.toISOString().slice(0, 10)}; zdarzenie: ${event.createdAt.toISOString()}.`,
      this.link(`/dashboard/market/${instrument.id}`),
    ].join('\n');
    const row = await this.prisma.notification.upsert({
      where: { eventId },
      create: { userId: event.alert.userId, eventId, body },
      update: {},
    });
    return this.deliver(row.id, now);
  }
  private link(path: string) {
    try {
      const url = new URL(
        process.env.FRONTEND_ORIGIN ?? 'http://localhost:3000',
      );
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password
      )
        return '';
      return `${url.origin}${path}`;
    } catch {
      return '';
    }
  }
  async scheduleSummaries(now = new Date()) {
    if (!this.telegram.enabled()) return;
    const day = zonedClock(now, 'Europe/Warsaw').day;
    const markets = ['XWAR', 'XNAS'];
    if (
      !markets.some((mic) => session(mic, day).trading) ||
      markets.some(
        (mic) => session(mic, day).trading && expectedSession(mic, now) !== day,
      )
    )
      return;
    const connections = await this.prisma.telegramConnection.findMany({
      where: { dailySummaryEnabled: true },
      select: { userId: true },
    });
    for (const { userId } of connections)
      await this.prisma.marketJob.upsert({
        where: { key: `summary_${userId}_${day}` },
        create: {
          key: `summary_${userId}_${day}`,
          kind: 'summary',
          payload: { userId, day },
          priority: 40,
        },
        update: {},
      });
  }
  async summary(userId: string, day: string, now = new Date()) {
    const connection = await this.prisma.telegramConnection.findUnique({
      where: { userId },
    });
    if (!connection?.dailySummaryEnabled) return;
    const portfolios = await this.prisma.portfolio.findMany({
      where: { userId },
      orderBy: { id: 'asc' },
      select: { id: true, name: true },
    });
    const lines = [`Podsumowanie sesji ${day}`];
    for (const portfolio of portfolios.slice(0, 15)) {
      const value = this.valuations.calculate(
        await this.valuations.load(userId, portfolio.id, day),
        day,
        now,
      );
      lines.push(
        `${portfolio.name}: ${value.complete ? `${value.valuePln} PLN; wynik ${value.resultPln ?? 'brak pełnych danych'} PLN` : value.pendingSplits.length ? `wycena niepełna — uzgodnij split: ${[...new Set(value.pendingSplits.map((split) => split.ticker))].join(', ')}` : 'wycena niepełna — sprawdź ceny/FX w aplikacji'}`,
      );
    }
    if (!portfolios.length) lines.push('Brak portfeli inwestycyjnych.');
    lines.push(this.link('/dashboard/investments'));
    const row = await this.prisma.notification.upsert({
      where: {
        userId_summaryOn: { userId, summaryOn: new Date(`${day}T00:00:00Z`) },
      },
      create: {
        userId,
        kind: 'SUMMARY',
        summaryOn: new Date(`${day}T00:00:00Z`),
        body: lines.join('\n').slice(0, 3900),
      },
      update: {},
    });
    return this.deliver(row.id, now);
  }
  async deliver(
    id: string,
    now = new Date(),
  ): Promise<void | { retryAt: Date }> {
    if (!this.telegram.enabled())
      return { retryAt: new Date(now.getTime() + 3600000) };
    const candidate = await this.prisma.notification.findUnique({
      where: { id },
      select: { userId: true },
    });
    if (!candidate) return;
    const claim = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT "id" FROM "User" WHERE "id" = ${candidate.userId}::uuid FOR UPDATE`;
      const row = await tx.notification.findUniqueOrThrow({
        where: { id },
        include: {
          event: { include: { alert: true } },
          signal: {
            include: {
              run: {
                include: {
                  version: {
                    include: { strategy: { include: { account: true } } },
                  },
                },
              },
            },
          },
        },
      });
      if (['SENT', 'UNKNOWN', 'CANCELLED', 'FAILED'].includes(row.state))
        return null;
      if (row.state === 'PROCESSING') {
        // A concurrent handler must not invalidate an active send. Recovery waits longer than the HTTP deadline.
        if (now.getTime() - row.updatedAt.getTime() < 120000)
          return { retryAt: new Date(row.updatedAt.getTime() + 120000) };
        await tx.notification.update({
          where: { id },
          data: { state: 'UNKNOWN', runToken: null, lastError: 'interrupted' },
        });
        await tx.notificationAttempt.updateMany({
          where: { notificationId: id, state: 'PROCESSING' },
          data: { state: 'UNKNOWN', finishedAt: now },
        });
        return null;
      }
      const connection = await tx.telegramConnection.findUnique({
        where: { userId: row.userId },
      });
      const scheduledStrategy = row.signal?.run.version.strategy;
      const signalCancelled =
        row.signal &&
        (now >= row.signal.validUntil
          ? 'signal_expired'
          : !scheduledStrategy?.enabled ||
              !scheduledStrategy.notifyOnSignal ||
              scheduledStrategy.account.archivedAt
            ? 'signal_disabled'
            : null);
      const cancelled = !connection
        ? 'disconnected'
        : row.event?.alert.deletedAt
          ? 'rule_deleted'
          : signalCancelled
            ? signalCancelled
            : row.kind === 'SUMMARY' && !connection.dailySummaryEnabled
              ? 'summary_disabled'
              : now.getTime() -
                    (row.event?.createdAt ?? row.createdAt).getTime() >
                  86400000
                ? 'expired'
                : null;
      if (cancelled) {
        await tx.notification.update({
          where: { id },
          data: { state: 'CANCELLED', lastError: cancelled },
        });
        return null;
      }
      const until = quietUntil(connection!, now);
      if (until) return { retryAt: until };
      const recent = await tx.notificationAttempt.count({
        where: {
          notification: { userId: row.userId },
          startedAt: { gt: new Date(now.getTime() - 3600000) },
        },
      });
      if (recent >= 10) return { retryAt: new Date(now.getTime() + 3600000) };
      if (row.attempts >= 5) {
        await tx.notification.update({
          where: { id },
          data: { state: 'FAILED', lastError: 'attempt_limit' },
        });
        return null;
      }
      const runToken = randomUUID(),
        number = row.attempts + 1;
      await tx.notification.update({
        where: { id },
        data: {
          state: 'PROCESSING',
          runToken,
          bindingId: connection!.bindingId,
          attempts: number,
          lastError: null,
        },
      });
      await tx.notificationAttempt.create({
        data: {
          notificationId: id,
          number,
          state: 'PROCESSING',
          startedAt: now,
        },
      });
      return {
        chatId: connection!.chatId,
        bindingId: connection!.bindingId,
        body: row.body,
        runToken,
        number,
      };
    });
    if (!claim) return;
    if (claim.retryAt) return { retryAt: claim.retryAt };
    // Re-check a disconnect/rebind immediately before egress; an already-started request cannot be recalled.
    const connection = await this.prisma.telegramConnection.findUnique({
      where: { userId: candidate.userId },
    });
    const result =
      connection?.bindingId === claim.bindingId
        ? await this.telegram.send(claim.chatId, claim.body)
        : { state: 'FAILED' as const, code: 'disconnected' };
    const retryAt =
      result.state === 'RETRY' && claim.number < 5
        ? new Date(now.getTime() + result.retryAfter * 1000)
        : null;
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.notification.updateMany({
        where: { id, state: 'PROCESSING', runToken: claim.runToken },
        data: {
          state: retryAt
            ? 'PENDING'
            : result.state === 'RETRY'
              ? 'FAILED'
              : result.state,
          runToken: null,
          ...(result.state === 'SENT'
            ? { messageId: result.messageId, sentAt: now, lastError: null }
            : { lastError: result.code }),
        },
      });
      if (updated.count)
        await tx.notificationAttempt.update({
          where: {
            notificationId_number: { notificationId: id, number: claim.number },
          },
          data: { state: result.state, finishedAt: new Date() },
        });
    });
    if (retryAt) return { retryAt };
  }
  async retry(userId: string, id: string, acknowledgeDuplicateRisk: boolean) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT "id" FROM "User" WHERE "id" = ${userId}::uuid FOR UPDATE`;
      const row = await tx.notification.findFirst({ where: { id, userId } });
      if (!row) throw new NotFoundException('Nie znaleziono powiadomienia.');
      if (!['FAILED', 'UNKNOWN'].includes(row.state))
        throw new BadRequestException('Ten stan nie pozwala na ponowienie.');
      if (row.state === 'UNKNOWN' && !acknowledgeDuplicateRisk)
        throw new BadRequestException('Potwierdź ryzyko ponownego doręczenia.');
      if (row.attempts >= 5)
        throw new BadRequestException('Osiągnięto limit pięciu prób.');
      await tx.notification.update({
        where: { id },
        data: { state: 'PENDING', lastError: null },
      });
      await tx.marketJob.create({
        data: {
          key: `retry_notification_${id}_${randomUUID()}`,
          kind: 'retry_notification',
          payload: { notificationId: id },
          priority: 5,
        },
      });
      return { queued: true };
    });
  }
}
