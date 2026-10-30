import { getAuthRateLimitOptions } from './rate-limit.js';

describe('Authentication rate limit configuration', () => {
  it('provides separate login and registration limits and converts seconds to milliseconds', () => {
    expect(getAuthRateLimitOptions({})).toMatchObject({
      throttlers: [
        { name: 'login', limit: 10, ttl: 60000, blockDuration: 60000 },
        { name: 'register', limit: 5, ttl: 900000, blockDuration: 900000 },
      ],
    });
  });

  it('accepts explicit limits and periods', () => {
    expect(
      getAuthRateLimitOptions({
        AUTH_LOGIN_LIMIT: '20',
        AUTH_LOGIN_TTL_SECONDS: '120',
        AUTH_REGISTER_LIMIT: '3',
        AUTH_REGISTER_TTL_SECONDS: '300',
      }),
    ).toMatchObject({
      throttlers: [
        { name: 'login', limit: 20, ttl: 120000, blockDuration: 120000 },
        { name: 'register', limit: 3, ttl: 300000, blockDuration: 300000 },
      ],
    });
  });

  it.each([
    'AUTH_LOGIN_LIMIT',
    'AUTH_LOGIN_TTL_SECONDS',
    'AUTH_REGISTER_LIMIT',
    'AUTH_REGISTER_TTL_SECONDS',
  ])('rejects invalid %s without echoing its value', (name) => {
    for (const value of [
      '',
      '0',
      '-1',
      '1.5',
      'Infinity',
      '1e3',
      ' 10 ',
      'private-value',
      '1000001',
    ]) {
      expect(() => getAuthRateLimitOptions({ [name]: value })).toThrow(name);
      try {
        getAuthRateLimitOptions({ [name]: value });
      } catch (error) {
        expect((error as Error).message).not.toContain('private-value');
      }
    }
  });

  it.each(['AUTH_LOGIN_TTL_SECONDS', 'AUTH_REGISTER_TTL_SECONDS'])(
    'rejects a period longer than a week (%s)',
    (name) => {
      expect(() => getAuthRateLimitOptions({ [name]: '604801' })).toThrow(name);
    },
  );
});
