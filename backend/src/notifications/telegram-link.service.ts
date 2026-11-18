import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { telegramConfigured } from './telegram.client.js';

export type TelegramSettings = {
  quietStart: number;
  quietEnd: number;
  timeZone: string;
  dailySummaryEnabled: boolean;
};
@Injectable()
export class TelegramLinkService {
  constructor(private readonly prisma: PrismaService) {}
  async status(userId: string) {
    const row = await this.prisma.telegramConnection.findUnique({
      where: { userId },
    });
    return {
      configured: telegramConfigured(),
      connected: !!row,
      quietStart: row?.quietStart ?? 1320,
      quietEnd: row?.quietEnd ?? 420,
      timeZone: row?.timeZone ?? 'Europe/Warsaw',
      dailySummaryEnabled: row?.dailySummaryEnabled ?? false,
    };
  }
  async pair(userId: string, now = new Date()) {
    if (!telegramConfigured())
      throw new BadRequestException(
        'Powiadomienia Telegram nie są jeszcze dostępne.',
      );
    const code = randomBytes(24).toString('base64url'),
      codeHash = createHash('sha256').update(code).digest('hex');
    const expiresAt = new Date(now.getTime() + 300000);
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT "id" FROM "User" WHERE "id" = ${userId}::uuid FOR UPDATE`;
      await tx.telegramPairing.deleteMany({ where: { userId } });
      await tx.telegramPairing.create({
        data: { userId, codeHash, expiresAt },
      });
    });
    const username = process.env.TELEGRAM_BOT_USERNAME;
    return {
      code,
      expiresAt: expiresAt.toISOString(),
      url:
        username && /^[A-Za-z0-9_]{5,32}$/.test(username)
          ? `https://t.me/${username}?start=${code}`
          : null,
    };
  }
  verifySecret(header: string | undefined) {
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (
      !telegramConfigured() ||
      !header ||
      !secret ||
      Buffer.byteLength(header) !== Buffer.byteLength(secret) ||
      !timingSafeEqual(Buffer.from(header), Buffer.from(secret))
    )
      throw new ForbiddenException('Niepoprawne uwierzytelnienie webhooka.');
  }
  async consume(update: unknown, now = new Date()) {
    if (!update || typeof update !== 'object') return { ok: true };
    const message = (
      update as {
        message?: {
          text?: unknown;
          chat?: { type?: unknown; id?: unknown };
          from?: { id?: unknown; is_bot?: unknown };
        };
      }
    ).message;
    if (
      !message ||
      message.chat?.type !== 'private' ||
      message.from?.is_bot === true ||
      typeof message.text !== 'string'
    )
      return { ok: true };
    const chatId = message.chat.id,
      fromId = message.from?.id;
    if (
      typeof chatId !== 'number' ||
      !Number.isSafeInteger(chatId) ||
      chatId <= 0 ||
      chatId !== fromId
    )
      return { ok: true };
    const match = /^\/start(?:@[A-Za-z0-9_]+)?\s+([A-Za-z0-9_-]{32})$/.exec(
      message.text.trim(),
    );
    if (!match) return { ok: true };
    const codeHash = createHash('sha256').update(match[1]).digest('hex');
    const candidate = await this.prisma.telegramPairing.findUnique({
      where: { codeHash },
      select: { userId: true },
    });
    if (!candidate) return { ok: true };
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT "id" FROM "User" WHERE "id" = ${candidate.userId}::uuid FOR UPDATE`;
      const pairing = await tx.telegramPairing.findUnique({
        where: { codeHash },
      });
      if (!pairing || pairing.consumedAt || pairing.expiresAt <= now) return;
      const existingChat = await tx.telegramConnection.findUnique({
        where: { chatId: String(chatId) },
      });
      if (existingChat && existingChat.userId !== pairing.userId)
        throw new ConflictException(
          'Ta rozmowa jest połączona z innym kontem. Najpierw ją odłącz.',
        );
      await tx.telegramConnection.upsert({
        where: { userId: pairing.userId },
        create: { userId: pairing.userId, chatId: String(chatId) },
        update: {
          chatId: String(chatId),
          bindingId: randomUUID(),
          linkedAt: now,
        },
      });
      await tx.telegramPairing.update({
        where: { codeHash },
        data: { consumedAt: now },
      });
    });
    return { ok: true };
  }
  async disconnect(userId: string) {
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT "id" FROM "User" WHERE "id" = ${userId}::uuid FOR UPDATE`;
      await tx.telegramConnection.deleteMany({ where: { userId } });
      await tx.telegramPairing.deleteMany({ where: { userId } });
      await tx.notification.updateMany({
        where: { userId, state: { in: ['PENDING', 'FAILED'] } },
        data: { state: 'CANCELLED', lastError: 'disconnected' },
      });
    });
  }
  async settings(userId: string, input: TelegramSettings) {
    if (
      !(await this.prisma.telegramConnection.findUnique({ where: { userId } }))
    )
      throw new BadRequestException('Najpierw połącz Telegram.');
    await this.prisma.telegramConnection.update({
      where: { userId },
      data: input,
    });
    return this.status(userId);
  }
}
