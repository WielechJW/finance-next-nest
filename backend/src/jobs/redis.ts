import type { ConnectionOptions } from 'bullmq';

export function redisConnection(value = process.env.REDIS_URL, testOnly = false): ConnectionOptions {
  try {
    if (!value) throw new Error();
    const url = new URL(value);
    const port = Number(url.port || 6379);
    const db = Number(url.pathname.slice(1) || '0');
    if (!['redis:', 'rediss:'].includes(url.protocol) || !Number.isInteger(port) || port < 1 || port > 65535 || !Number.isInteger(db) || db < 0 || db > 15 || url.search) throw new Error();
    if (testOnly && (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || port !== 6380)) throw new Error();
    return { host: url.hostname, port, db, ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
      ...(url.password ? { password: decodeURIComponent(url.password) } : {}), ...(url.protocol === 'rediss:' ? { tls: {} } : {}), maxRetriesPerRequest: null };
  } catch { throw new Error(testOnly ? 'REDIS_URL_TEST musi wskazywać osobny lokalny Redis na porcie 6380.' : 'Skonfiguruj poprawny REDIS_URL.'); }
}
