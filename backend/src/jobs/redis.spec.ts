import { redisConnection } from './redis.js';

describe('Redis isolation', () => {
  it('rejects production/default Redis and non-loopback hosts in the integration test configuration', () => {
    expect(() => redisConnection('redis://localhost:6379/0', true)).toThrow();
    expect(() => redisConnection('redis://remote.invalid:6380/0', true)).toThrow();
    expect(redisConnection('redis://127.0.0.1:6380/0', true)).toMatchObject({ port: 6380 });
    expect(() => redisConnection('https://private:secret@redis.invalid')).toThrow('Skonfiguruj poprawny REDIS_URL.');
  });
});
