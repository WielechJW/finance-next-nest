import { quietUntil } from './quiet-hours.js';
import { TelegramClient } from './telegram.client.js';

describe('Telegram transport and quiet hours', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
  it('defers overnight hours across DST and allows an explicit disabled window', () => {
    const settings = {
      quietStart: 1320,
      quietEnd: 420,
      timeZone: 'Europe/Warsaw',
    };
    expect(
      quietUntil(settings, new Date('2026-10-24T23:00:00Z'))?.toISOString(),
    ).toBe('2026-10-25T06:00:00.000Z');
    expect(
      quietUntil(settings, new Date('2026-03-28T23:00:00Z'))?.toISOString(),
    ).toBe('2026-03-29T05:00:00.000Z');
    expect(
      quietUntil(
        { ...settings, quietEnd: 1320 },
        new Date('2026-11-18T22:00:00Z'),
      ),
    ).toBeNull();
  });
  it('distinguishes known rejection, rate limit and uncertain delivery without leaking secrets', async () => {
    vi.stubEnv(
      'TELEGRAM_BOT_TOKEN',
      '123456:synthetic_token_for_unit_tests_only',
    );
    vi.stubEnv('TELEGRAM_WEBHOOK_SECRET', 'x'.repeat(32));
    const client = new TelegramClient();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('{"ok":true,"result":{"message_id":9007199254740993}}'),
      )
      .mockResolvedValueOnce(
        new Response(
          '{"ok":false,"error_code":429,"parameters":{"retry_after":45}}',
          { status: 429 },
        ),
      )
      .mockResolvedValueOnce(new Response('server failure', { status: 503 }))
      .mockRejectedValueOnce(
        new Error('https://api.telegram.org/botSECRET/sendMessage'),
      )
      .mockResolvedValueOnce(new Response('{"ok":false}', { status: 403 }));
    vi.stubGlobal('fetch', fetch);
    expect(await client.send('123', 'text')).toEqual({
      state: 'SENT',
      messageId: '9007199254740993',
    });
    expect(await client.send('123', 'text')).toEqual({
      state: 'RETRY',
      code: 'rate_limit',
      retryAfter: 45,
    });
    expect(await client.send('123', 'text')).toEqual({
      state: 'UNKNOWN',
      code: 'upstream',
    });
    expect(await client.send('123', 'text')).toEqual({
      state: 'UNKNOWN',
      code: 'network',
    });
    expect(await client.send('123', 'text')).toEqual({
      state: 'FAILED',
      code: 'rejected',
    });
  });
});
