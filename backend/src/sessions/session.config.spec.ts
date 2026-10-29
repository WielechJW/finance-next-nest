import { getSessionConfig } from './session.config.js';

describe('Session configuration', () => {
  const secret = 'test-only-secret-with-at-least-32-bytes';

  it.each([undefined, '', 'too-short'])(
    'rejects a missing or short secret without echoing it (%#)',
    (value) => {
      expect(() => getSessionConfig({ SESSION_SECRET: value })).toThrow(
        'SESSION_SECRET',
      );
      try {
        getSessionConfig({ SESSION_SECRET: value });
      } catch (error) {
        expect((error as Error).message).not.toContain('too-short');
      }
    },
  );

  it.each(['0', '-1', '1.5', 'Infinity', '604801', 'text'])(
    'rejects invalid session lifetimes (%s)',
    (value) => {
      expect(() =>
        getSessionConfig({
          SESSION_SECRET: secret,
          SESSION_TTL_SECONDS: value,
        }),
      ).toThrow('SESSION_TTL_SECONDS');
    },
  );

  it.each(['-1', '1.5', '11', 'text'])(
    'rejects an invalid trusted proxy count (%s)',
    (value) => {
      expect(() =>
        getSessionConfig({ SESSION_SECRET: secret, TRUST_PROXY_HOPS: value }),
      ).toThrow('TRUST_PROXY_HOPS');
    },
  );

  it('uses an hour of inactivity and untrusted proxy headers locally', () => {
    expect(getSessionConfig({ SESSION_SECRET: secret })).toEqual({
      secret,
      ttlSeconds: 3600,
      cookieName: 'finance.sid',
      secure: false,
      trustProxyHops: 0,
    });
  });

  it('requires secure cookies in production and allows an explicit proxy topology', () => {
    expect(
      getSessionConfig({
        SESSION_SECRET: secret,
        NODE_ENV: 'production',
        TRUST_PROXY_HOPS: '1',
      }),
    ).toMatchObject({ secure: true, trustProxyHops: 1 });
  });
});
