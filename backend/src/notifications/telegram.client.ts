import { Injectable } from '@nestjs/common';
import { parseMarketJson, object } from '../market-data/contracts.js';

export type TelegramSendResult =
  | { state: 'SENT'; messageId: string }
  | { state: 'UNKNOWN' | 'FAILED'; code: string }
  | { state: 'RETRY'; code: string; retryAfter: number };
export function telegramConfigured(
  environment: Record<string, string | undefined> = process.env,
) {
  return (
    /^\d{5,20}:[A-Za-z0-9_-]{20,}$/.test(
      environment.TELEGRAM_BOT_TOKEN ?? '',
    ) &&
    /^[A-Za-z0-9_-]{32,256}$/.test(environment.TELEGRAM_WEBHOOK_SECRET ?? '')
  );
}
@Injectable()
export class TelegramClient {
  enabled() {
    return telegramConfigured();
  }
  async send(chatId: string, text: string): Promise<TelegramSendResult> {
    if (!this.enabled()) return { state: 'FAILED', code: 'configuration' };
    try {
      const response = await fetch(
        `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
        {
          method: 'POST',
          redirect: 'error',
          signal: AbortSignal.timeout(15000),
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text,
            link_preview_options: { is_disabled: true },
          }),
        },
      );
      if (response.status >= 500) {
        await response.body?.cancel();
        return { state: 'UNKNOWN', code: 'upstream' };
      }
      let data: Record<string, unknown>;
      try {
        data = object(parseMarketJson(await response.text()));
      } catch {
        return { state: 'UNKNOWN', code: 'invalid_response' };
      }
      if (response.status === 429 || data.error_code === '429') {
        const parameters =
          data.parameters && typeof data.parameters === 'object'
            ? object(data.parameters)
            : {};
        const retry = Number(parameters.retry_after);
        return {
          state: 'RETRY',
          code: 'rate_limit',
          retryAfter:
            Number.isInteger(retry) && retry >= 1 && retry <= 3600 ? retry : 60,
        };
      }
      if (!response.ok || data.ok === false)
        return { state: 'FAILED', code: 'rejected' };
      const result =
        data.result && typeof data.result === 'object'
          ? object(data.result)
          : {};
      return data.ok === true &&
        typeof result.message_id === 'string' &&
        /^\d{1,20}$/.test(result.message_id)
        ? { state: 'SENT', messageId: result.message_id }
        : { state: 'UNKNOWN', code: 'invalid_response' };
    } catch {
      return { state: 'UNKNOWN', code: 'network' };
    }
  }
}
