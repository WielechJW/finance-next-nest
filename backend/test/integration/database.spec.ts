import { getTestDatabaseUrl } from './database.js';

describe('Integration database isolation', () => {
  it.each([
    undefined,
    '',
    'invalid-url',
    'postgresql://user:secret@127.0.0.1:5432/finance',
    'postgresql://user:secret@remote.example:5432/finance_test',
    'https://user:secret@127.0.0.1/finance_test',
    'postgresql://user:secret@127.0.0.1:5432/finance_test?schema=other',
    'postgresql://user:secret@127.0.0.1:5432/finance_test?database=finance',
    'postgresql://user:secret@127.0.0.1:5432/finance_test?host=remote.example',
  ])('rejects a missing, unsafe or non-test database URL (%#)', (value) => {
    expect(() => getTestDatabaseUrl(value)).toThrow();
    try {
      getTestDatabaseUrl(value);
    } catch (error) {
      expect((error as Error).message).not.toContain('secret');
    }
  });

  it('accepts an explicit local test database', () => {
    const value =
      'postgresql://finance:password@127.0.0.1:5432/finance_test?schema=public';
    expect(getTestDatabaseUrl(value)).toBe(value);
  });
});
