import { getBrowserDatabaseUrl } from './database.js';

describe('Browser test database isolation', () => {
  const browserUrl =
    'postgresql://user:secret@localhost:5432/finance_browser_test?schema=public';
  it('accepts a dedicated local test database', () => {
    expect(
      getBrowserDatabaseUrl({
        DATABASE_URL_BROWSER_TEST: browserUrl,
        DATABASE_URL_TEST: 'postgresql://localhost/finance_test',
        DATABASE_URL: 'postgresql://localhost/finance',
      }),
    ).toBe(browserUrl);
  });
  it('requires an explicit browser database instead of falling back to another URL', () => {
    expect(() =>
      getBrowserDatabaseUrl({
        DATABASE_URL_TEST: 'postgresql://localhost/finance_test',
        DATABASE_URL: 'postgresql://localhost/finance',
      }),
    ).toThrow('DATABASE_URL_BROWSER_TEST');
  });
  it.each(['DATABASE_URL_TEST', 'DATABASE_URL'])(
    'rejects a shared database through a localhost alias (%s)',
    (name) => {
      expect(() =>
        getBrowserDatabaseUrl({
          DATABASE_URL_BROWSER_TEST: browserUrl,
          [name]: 'postgresql://another:private@127.0.0.1/finance_browser_test',
        }),
      ).toThrow('inną bazę');
    },
  );
  it.each([
    'postgresql://localhost/finance',
    'postgresql://remote.example/finance_browser_test',
    'postgresql://localhost/finance_browser_test?host=remote.example',
  ])('rejects an unsafe browser database (%#)', (value) => {
    expect(() =>
      getBrowserDatabaseUrl({ DATABASE_URL_BROWSER_TEST: value }),
    ).toThrow();
  });
});
