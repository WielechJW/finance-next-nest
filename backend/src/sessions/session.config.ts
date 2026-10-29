import '../config/environment.js';

export interface SessionConfig {
  secret: string;
  ttlSeconds: number;
  cookieName: string;
  secure: boolean;
  trustProxyHops: number;
}

export function getSessionConfig(
  environment: Record<string, string | undefined> = process.env,
): SessionConfig {
  const secret = environment.SESSION_SECRET?.trim();
  if (!secret || Buffer.byteLength(secret, 'utf8') < 32) {
    throw new Error(
      'SESSION_SECRET musi zawierać co najmniej 32 bajty. Ustaw losowy sekret w backend/.env.',
    );
  }

  const ttl = environment.SESSION_TTL_SECONDS ?? '3600';
  const ttlSeconds = Number(ttl);
  if (
    !/^\d+$/.test(ttl) ||
    !Number.isSafeInteger(ttlSeconds) ||
    ttlSeconds < 1 ||
    ttlSeconds > 604800
  ) {
    throw new Error(
      'SESSION_TTL_SECONDS musi być liczbą całkowitą od 1 do 604800.',
    );
  }

  const proxy = environment.TRUST_PROXY_HOPS ?? '0';
  const trustProxyHops = Number(proxy);
  if (
    !/^\d+$/.test(proxy) ||
    !Number.isSafeInteger(trustProxyHops) ||
    trustProxyHops > 10
  ) {
    throw new Error('TRUST_PROXY_HOPS musi być liczbą całkowitą od 0 do 10.');
  }

  return {
    secret,
    ttlSeconds,
    cookieName: 'finance.sid',
    secure: environment.NODE_ENV === 'production',
    trustProxyHops,
  };
}
