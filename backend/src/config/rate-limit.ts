import './environment.js';
import type { ThrottlerModuleOptions } from '@nestjs/throttler';

function positiveInteger(
  environment: Record<string, string | undefined>,
  name: string,
  fallback: number,
  maximum: number,
): number {
  const value = environment[name] ?? String(fallback);
  const number = Number(value);
  if (
    !/^\d+$/.test(value) ||
    !Number.isSafeInteger(number) ||
    number < 1 ||
    number > maximum
  ) {
    throw new Error(`${name} musi być liczbą całkowitą od 1 do ${maximum}.`);
  }
  return number;
}

export function getAuthRateLimitOptions(
  environment: Record<string, string | undefined> = process.env,
): ThrottlerModuleOptions {
  const loginTtl =
    positiveInteger(environment, 'AUTH_LOGIN_TTL_SECONDS', 60, 604800) * 1000;
  const registerTtl =
    positiveInteger(environment, 'AUTH_REGISTER_TTL_SECONDS', 900, 604800) *
    1000;

  return {
    throttlers: [
      {
        name: 'login',
        limit: positiveInteger(environment, 'AUTH_LOGIN_LIMIT', 10, 1000000),
        ttl: loginTtl,
        blockDuration: loginTtl,
      },
      {
        name: 'register',
        limit: positiveInteger(environment, 'AUTH_REGISTER_LIMIT', 5, 1000000),
        ttl: registerTtl,
        blockDuration: registerTtl,
      },
    ],
    errorMessage: (_context, detail) =>
      `Zbyt wiele prób. Spróbuj ponownie za ${Math.max(1, Math.ceil(detail.timeToBlockExpire))} s.`,
  };
}
