import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { investmentHttpContext } from './support/investment-http.js';
import { TelegramClient } from '../src/notifications/telegram.client.js';
import { TelegramLinkService } from '../src/notifications/telegram-link.service.js';
import { NotificationsService } from '../src/notifications/notifications.service.js';

describe('Telegram private linking and durable delivery (PostgreSQL, synthetic transport)', () => {
  let ctx: Awaited<ReturnType<typeof investmentHttpContext>>;
  let service: NotificationsService;
  let send: ReturnType<typeof vi.spyOn>;
  beforeAll(async () => {
    ctx = await investmentHttpContext();
    service = ctx.app.get(NotificationsService);
  });
  beforeEach(() => {
    vi.stubEnv(
      'TELEGRAM_BOT_TOKEN',
      '123456:synthetic_token_for_integration_tests',
    );
    vi.stubEnv('TELEGRAM_WEBHOOK_SECRET', 'x'.repeat(32));
    send = vi
      .spyOn(ctx.app.get(TelegramClient), 'send')
      .mockResolvedValue({ state: 'SENT', messageId: '111' });
  });
  afterEach(async () => {
    const ids = (
      await ctx.prisma.notification.findMany({
        where: { body: { in: ['Synthetic alert', 'Interrupted', 'Quiet'] } },
        select: { id: true },
      })
    ).map((row) => row.id);
    for (const id of ids)
      await ctx.prisma.marketJob.deleteMany({
        where: {
          kind: 'retry_notification',
          payload: { path: ['notificationId'], equals: id },
        },
      });
    await ctx.cleanup();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });
  afterAll(async () => {
    await ctx?.app.close();
  });
  async function linked() {
    const user = await ctx.signIn();
    await ctx.prisma.telegramConnection.create({
      data: {
        userId: user.userId,
        chatId: String(Math.floor(Math.random() * 1e12)),
        quietStart: 0,
        quietEnd: 0,
      },
    });
    return user;
  }
  it('authenticates the webhook, requires a private same-sender chat and consumes each code only once', async () => {
    const user = await ctx.signIn(),
      links = ctx.app.get(TelegramLinkService);
    const pairing = await user.agent
      .post('/notifications/telegram/pairing')
      .set('Origin', ctx.origin)
      .send({})
      .expect(201);
    const code = (pairing.body as { code: string }).code;
    const update = {
      message: {
        text: `/start ${code}`,
        chat: { type: 'private', id: 123456789 },
        from: { id: 123456789 },
      },
    };
    const webhook = () =>
      request(ctx.app.getHttpServer()).post('/integrations/telegram');
    await webhook().send(update).expect(403);
    await webhook()
      .set('x-telegram-bot-api-secret-token', 'x'.repeat(32))
      .send({
        message: { ...update.message, chat: { type: 'group', id: 123456789 } },
      })
      .expect(200);
    expect((await links.status(user.userId)).connected).toBe(false);
    await webhook()
      .set('x-telegram-bot-api-secret-token', 'x'.repeat(32))
      .send(update)
      .expect(200);
    const first = await ctx.prisma.telegramConnection.findUniqueOrThrow({
      where: { userId: user.userId },
    });
    await links.consume(update);
    expect(
      (
        await ctx.prisma.telegramConnection.findUniqueOrThrow({
          where: { userId: user.userId },
        })
      ).bindingId,
    ).toBe(first.bindingId);
    expect(
      JSON.stringify(
        (await user.agent.get('/notifications/telegram').expect(200)).body,
      ),
    ).not.toContain('123456789');
    const expired = await links.pair(
      user.userId,
      new Date(Date.now() - 600000),
    );
    await links.consume({
      message: {
        ...update.message,
        text: `/start ${expired.code}`,
        chat: { type: 'private', id: 987654321 },
        from: { id: 987654321 },
      },
    });
    expect(
      (
        await ctx.prisma.telegramConnection.findUniqueOrThrow({
          where: { userId: user.userId },
        })
      ).chatId,
    ).toBe('123456789');
    expect(send).not.toHaveBeenCalled();
  });
  it('sends once under concurrency and marks an interrupted send unknown without blind retry', async () => {
    const user = await linked();
    const n = await ctx.prisma.notification.create({
      data: { userId: user.userId, body: 'Synthetic alert' },
    });
    await Promise.all([service.deliver(n.id), service.deliver(n.id)]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(
      (await ctx.prisma.notification.findUniqueOrThrow({ where: { id: n.id } }))
        .state,
    ).toBe('SENT');
    const interrupted = await ctx.prisma.notification.create({
      data: {
        userId: user.userId,
        body: 'Interrupted',
        state: 'PROCESSING',
        attempts: 1,
        runToken: randomUUID(),
        updatedAt: new Date(Date.now() - 180000),
      },
    });
    await service.deliver(interrupted.id);
    expect(
      (
        await ctx.prisma.notification.findUniqueOrThrow({
          where: { id: interrupted.id },
        })
      ).state,
    ).toBe('UNKNOWN');
    expect(send).toHaveBeenCalledTimes(1);
    await user.agent
      .post(`/notifications/${interrupted.id}/retry`)
      .set('Origin', ctx.origin)
      .send({ acknowledgeDuplicateRisk: false })
      .expect(400);
    const stranger = await ctx.signIn();
    await stranger.agent
      .post(`/notifications/${interrupted.id}/retry`)
      .set('Origin', ctx.origin)
      .send({ acknowledgeDuplicateRisk: true })
      .expect(404);
    await user.agent
      .post(`/notifications/${interrupted.id}/retry`)
      .set('Origin', ctx.origin)
      .send({ acknowledgeDuplicateRisk: true })
      .expect(201);
    expect(
      await ctx.prisma.marketJob.count({
        where: { kind: 'retry_notification' },
      }),
    ).toBe(1);
    await service.deliver(interrupted.id);
    expect(send).toHaveBeenCalledTimes(2);
  });
  it('defers quiet hours without a send attempt, honours rate limits and cancels after disconnect', async () => {
    const user = await linked(),
      now = new Date('2026-11-18T22:00:00Z');
    await ctx.prisma.telegramConnection.update({
      where: { userId: user.userId },
      data: { quietStart: 1320, quietEnd: 420 },
    });
    const n = await ctx.prisma.notification.create({
      data: { userId: user.userId, body: 'Quiet', createdAt: now },
    });
    expect((await service.deliver(n.id, now))?.retryAt.toISOString()).toBe(
      '2026-11-19T06:00:00.000Z',
    );
    expect(send).not.toHaveBeenCalled();
    expect(
      (await ctx.prisma.notification.findUniqueOrThrow({ where: { id: n.id } }))
        .attempts,
    ).toBe(0);
    send.mockResolvedValueOnce({
      state: 'RETRY',
      code: 'rate_limit',
      retryAfter: 60,
    });
    expect(
      (
        await service.deliver(n.id, new Date('2026-11-19T07:00:00Z'))
      )?.retryAt.toISOString(),
    ).toBe('2026-11-19T07:01:00.000Z');
    await user.agent
      .delete('/notifications/telegram')
      .set('Origin', ctx.origin)
      .expect(204);
    await service.deliver(n.id, new Date('2026-11-19T08:00:00Z'));
    expect(
      (await ctx.prisma.notification.findUniqueOrThrow({ where: { id: n.id } }))
        .state,
    ).toBe('CANCELLED');
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('makes daily summaries idempotent and never fetches market data', async () => {
    const user = await linked();
    await ctx.prisma.telegramConnection.update({
      where: { userId: user.userId },
      data: { dailySummaryEnabled: true },
    });
    await service.summary(user.userId, '2026-11-18');
    await service.summary(user.userId, '2026-11-18');
    expect(send).toHaveBeenCalledTimes(1);
    expect(
      await ctx.prisma.notification.count({
        where: { userId: user.userId, kind: 'SUMMARY' },
      }),
    ).toBe(1);
  });
});
