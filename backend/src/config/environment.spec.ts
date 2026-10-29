import { getDatabaseUrl } from './environment.js';

describe('Database configuration', () => {
  it.each([undefined, '', '   '])(
    'explains how to configure a missing DATABASE_URL (%j)',
    (DATABASE_URL) => {
      expect(() => getDatabaseUrl({ DATABASE_URL })).toThrow(
        'Brak DATABASE_URL',
      );
    },
  );

  it.each([
    'not-a-url',
    'https://user:private-password@example.com/finance',
    'postgresql://localhost:5432/',
  ])(
    'rejects invalid database settings without exposing credentials',
    (value) => {
      let failure: unknown;
      try {
        getDatabaseUrl({ DATABASE_URL: value });
      } catch (error) {
        failure = error;
      }

      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toContain('DATABASE_URL');
      expect((failure as Error).message).not.toContain(value);
      expect((failure as Error).message).not.toContain('private-password');
    },
  );

  it.each(['postgresql', 'postgres'])(
    'accepts the %s protocol and preserves connection options',
    (protocol) => {
      const value = `${protocol}://finance:password@127.0.0.1:5432/finance?schema=public`;

      expect(getDatabaseUrl({ DATABASE_URL: value })).toBe(value);
    },
  );
});
