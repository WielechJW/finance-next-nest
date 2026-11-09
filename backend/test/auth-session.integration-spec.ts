import { randomUUID } from 'node:crypto';
import { Logger, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getOptionsToken } from '@nestjs/throttler';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { PasswordService } from '../src/auth/password.service.js';
import { configureApp } from '../src/config/configure-app.js';
import { getFrontendOrigin } from '../src/config/cors.js';
import { getAuthRateLimitOptions } from '../src/config/rate-limit.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  getSessionConfig,
  type SessionConfig,
} from '../src/sessions/session.config.js';
import { SessionService } from '../src/sessions/session.service.js';
import { setCookieHeaders } from './support/cookies.js';

describe('Login and PostgreSQL sessions', () => {
  const password = '  Moje testowe hasło 123!  ';
  const userIds = new Set<string>();
  const sessionIds = new Set<string>();
  let app: INestApplication<App>;
  let prisma: PrismaService;

  async function startApp(
    config?: Partial<SessionConfig>,
  ): Promise<INestApplication<App>> {
    const builder = Test.createTestingModule({ imports: [AppModule] });
    builder.overrideProvider(getOptionsToken()).useFactory({
      factory: () =>
        getAuthRateLimitOptions({
          AUTH_LOGIN_LIMIT: '1000',
          AUTH_REGISTER_LIMIT: '1000',
        }),
    });
    if (config) {
      builder.overrideProvider(SessionService).useFactory({
        factory: () => new SessionService({ ...getSessionConfig(), ...config }),
      });
    }
    const module = await builder.compile();
    const instance = module.createNestApplication({ logger: false });
    configureApp(instance);
    await instance.init();
    return instance;
  }

  async function register() {
    const email = `session-${randomUUID()}@example.invalid`;
    const response = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password })
      .expect(201);
    const user = response.body as {
      id: string;
      email: string;
      createdAt: string;
    };
    userIds.add(user.id);
    return user;
  }

  function cookieFrom(response: request.Response): string {
    const cookies = setCookieHeaders(response);
    const header = cookies.find((entry) => entry.startsWith('finance.sid='));
    expect(header).toBeDefined();
    const cookie = header!.split(';')[0]!;
    sessionIds.add(sidFrom(cookie));
    return cookie;
  }

  function sidFrom(cookie: string): string {
    return decodeURIComponent(cookie.slice(cookie.indexOf('=') + 1))
      .slice(2)
      .split('.')[0]!;
  }

  async function login(email: string) {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);
    return { response, cookie: cookieFrom(response) };
  }

  beforeAll(async () => {
    app = await startApp();
    prisma = app.get(PrismaService);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (prisma) {
      if (sessionIds.size || userIds.size) {
        await prisma.session.deleteMany({
          where: {
            OR: [
              { sid: { in: [...sessionIds] } },
              ...[...userIds].map((id) => ({
                sess: { path: ['userId'], equals: id },
              })),
            ],
          },
        });
      }
      if (userIds.size)
        await prisma.user.deleteMany({ where: { id: { in: [...userIds] } } });
    }
    sessionIds.clear();
    userIds.clear();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('logs in, stores only the user ID and returns safe data on repeated /me requests', async () => {
    const user = await register();
    const { response, cookie } = await login(`  ${user.email.toUpperCase()} `);
    expect(response.body).toEqual(user);
    expect(response.headers['cache-control']).toBe('no-store');
    const header = setCookieHeaders(response)[0]!;
    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=Lax');
    expect(header).toContain('Path=/');
    expect(header).not.toContain('Secure');
    expect(header).not.toContain(user.id);

    const stored = await prisma.session.findUniqueOrThrow({
      where: { sid: sidFrom(cookie) },
    });
    expect(stored.sess).toMatchObject({
      userId: user.id,
      cookie: { httpOnly: true, sameSite: 'lax' },
    });
    expect(Object.keys(stored.sess as object).sort()).toEqual([
      'cookie',
      'userId',
    ]);
    const encoded = JSON.stringify([response.body, stored.sess]);
    expect(encoded).not.toContain(password);
    expect(encoded).not.toContain('passwordHash');

    for (let count = 0; count < 2; count++) {
      const me = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Cookie', cookie)
        .expect(200);
      expect(me.body).toEqual(user);
      expect(me.headers['cache-control']).toBe('no-store');
    }
  });

  it('returns identical 401 responses for a wrong password and an unknown email', async () => {
    const user = await register();
    const verification = vi.spyOn(app.get(PasswordService), 'verify');
    const wrong = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: user.email, password: 'wrong' })
      .expect(401);
    const unknown = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: `missing-${randomUUID()}@example.invalid`,
        password: 'wrong',
      })
      .expect(401);
    expect(wrong.body).toEqual(unknown.body);
    expect(wrong.body.message).toBe('Nieprawidłowy e-mail lub hasło.');
    expect(verification).toHaveBeenCalledTimes(2);
    expect(wrong.headers['set-cookie']).toBeUndefined();
    expect(unknown.headers['set-cookie']).toBeUndefined();
    expect(await prisma.session.count()).toBe(0);
  });

  it('preserves a real session after foreign login/logout attempts and allows trusted logout', async () => {
    const user = await register();
    const origin = getFrontendOrigin();
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .set('Origin', origin)
      .set('Sec-Fetch-Site', 'same-site')
      .send({ email: user.email, password })
      .expect(200);
    const cookie = cookieFrom(response);
    const log = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    for (const path of ['/auth/login', '/auth/logout']) {
      const rejected = await request(app.getHttpServer())
        .post(path)
        .set('Origin', 'http://localhost:4444')
        .set('Sec-Fetch-Site', 'same-site')
        .set('Cookie', cookie)
        .send({ email: user.email, password })
        .expect(403);
      expect(rejected.headers['set-cookie']).toBeUndefined();
      expect(JSON.stringify([rejected.body, log.mock.calls])).not.toContain(
        password,
      );
      expect(JSON.stringify([rejected.body, log.mock.calls])).not.toContain(
        cookie,
      );
    }
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', cookie)
      .expect(200);
    const logout = await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Origin', origin)
      .set('Sec-Fetch-Site', 'same-site')
      .set('Cookie', cookie)
      .expect(204);
    const cleared = setCookieHeaders(logout)[0]!;
    expect(cleared).toContain('HttpOnly');
    expect(cleared).toContain('SameSite=Lax');
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', cookie)
      .expect(401);
  });

  it.each([
    { email: undefined, password: 'anything' },
    { email: 'invalid-email', password: 'anything' },
    { email: 42, password: 'anything' },
    { email: 'valid@example.invalid', password: '' },
    { email: 'valid@example.invalid', password: 42 },
    { email: 'valid@example.invalid', password: 'x'.repeat(129) },
    { email: 'valid@example.invalid', password: 'anything', userId: 'forged' },
  ])(
    'rejects invalid login input before verifying the password (%#)',
    async (input) => {
      const verification = vi.spyOn(app.get(PasswordService), 'verify');
      await request(app.getHttpServer())
        .post('/auth/login')
        .send(input)
        .expect(400);
      expect(verification).not.toHaveBeenCalled();
    },
  );

  it('keeps two accounts isolated and reads current user data from the database', async () => {
    const first = await register();
    const second = await register();
    const firstLogin = await login(first.email);
    const secondLogin = await login(second.email);
    const email = `updated-${randomUUID()}@example.invalid`;
    await prisma.user.update({ where: { id: first.id }, data: { email } });
    const firstMe = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', firstLogin.cookie)
      .expect(200);
    const secondMe = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', secondLogin.cookie)
      .expect(200);
    expect(firstMe.body).toEqual({ ...first, email });
    expect(secondMe.body).toEqual(second);
  });

  it('rotates the session on a second login and rejects the previous cookie', async () => {
    const user = await register();
    const first = await login(user.email);
    const secondResponse = await request(app.getHttpServer())
      .post('/auth/login')
      .set('Cookie', first.cookie)
      .send({ email: user.email, password })
      .expect(200);
    const secondCookie = cookieFrom(secondResponse);
    expect(secondCookie).not.toBe(first.cookie);
    expect(
      await prisma.session.findUnique({
        where: { sid: sidFrom(first.cookie) },
      }),
    ).toBeNull();
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', first.cookie)
      .expect(401);
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', secondCookie)
      .expect(200);
  });

  it('preserves the session after closing and recreating the entire application', async () => {
    const user = await register();
    const { cookie } = await login(user.email);
    await app.close();
    app = await startApp();
    prisma = app.get(PrismaService);
    const response = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', cookie)
      .expect(200);
    expect(response.body).toEqual(user);
  });

  it('rejects expired sessions even when the browser still sends the old cookie', async () => {
    const user = await register();
    const { cookie } = await login(user.email);
    await prisma.session.update({
      where: { sid: sidFrom(cookie) },
      data: { expire: new Date(Date.now() - 60000) },
    });
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', cookie)
      .expect(401);
  });

  it('renews the cookie and database expiry when an authenticated user is active', async () => {
    const user = await register();
    const { cookie } = await login(user.email);
    const previousExpiry = new Date(Date.now() + 10000);
    await prisma.session.update({
      where: { sid: sidFrom(cookie) },
      data: { expire: previousExpiry },
    });
    const response = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', cookie)
      .expect(200);
    const stored = await prisma.session.findUniqueOrThrow({
      where: { sid: sidFrom(cookie) },
    });
    expect(stored.expire.getTime()).toBeGreaterThan(
      previousExpiry.getTime() + 3000000,
    );
    const header = setCookieHeaders(response)[0]!;
    const cookieExpiry = new Date(/Expires=([^;]+)/i.exec(header)![1]!);
    expect(
      Math.abs(cookieExpiry.getTime() - stored.expire.getTime()),
    ).toBeLessThan(2000);
  });

  it('rejects missing and tampered cookies without creating anonymous stored sessions', async () => {
    await request(app.getHttpServer()).get('/auth/me').expect(401);
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', 'finance.sid=s%3Anot-a-session.invalid-signature')
      .expect(401);
    expect(await prisma.session.count()).toBe(0);
  });

  it('invalidates a session whose user was removed', async () => {
    const user = await register();
    const { cookie } = await login(user.email);
    await prisma.user.delete({ where: { id: user.id } });
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', cookie)
      .expect(401);
    expect(
      await prisma.session.findUnique({ where: { sid: sidFrom(cookie) } }),
    ).toBeNull();
  });

  it('destroys the stored session, clears the cookie and makes logout repeatable', async () => {
    const user = await register();
    const { cookie } = await login(user.email);
    const response = await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Cookie', cookie)
      .expect(204);
    const header = setCookieHeaders(response)[0]!;
    expect(header).toMatch(/^finance\.sid=;/);
    expect(header).toContain('Path=/');
    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=Lax');
    expect(
      new Date(/Expires=([^;]+)/i.exec(header)![1]!).getTime(),
    ).toBeLessThan(Date.now());
    expect(
      await prisma.session.findUnique({ where: { sid: sidFrom(cookie) } }),
    ).toBeNull();
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', cookie)
      .expect(401);
    await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Cookie', cookie)
      .expect(204);
    await request(app.getHttpServer()).post('/auth/logout').expect(204);
    expect(await prisma.session.count()).toBe(0);
  });

  it('does not authenticate when saving a session fails and never logs sensitive store errors', async () => {
    const user = await register();
    const secretError = `${password} sensitive-session-identifier`;
    const log = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    vi.spyOn(app.get(SessionService).store, 'set').mockImplementationOnce(
      (_sid, _data, done) => {
        done?.(new Error(secretError));
      },
    );
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: user.email, password })
      .expect(500);
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(await prisma.session.count()).toBe(0);
    expect(log).toHaveBeenCalled();
    expect(JSON.stringify([response.body, log.mock.calls])).not.toContain(
      password,
    );
    expect(JSON.stringify([response.body, log.mock.calls])).not.toContain(
      'sensitive-session-identifier',
    );
  });

  it('reports a store read failure as a sanitized 500', async () => {
    const user = await register();
    const { cookie } = await login(user.email);
    const log = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    vi.spyOn(app.get(SessionService).store, 'get').mockImplementationOnce(
      (_sid, done) => {
        done(new Error(`sensitive-session-identifier ${password}`));
      },
    );
    const response = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', cookie)
      .expect(500);
    expect(response.body.message).toBe('Nie udało się obsłużyć sesji.');
    expect(JSON.stringify([response.body, log.mock.calls])).not.toContain(
      'sensitive-session-identifier',
    );
    expect(JSON.stringify([response.body, log.mock.calls])).not.toContain(
      password,
    );
  });

  it('reports a failed logout as 500 and allows retrying it', async () => {
    const user = await register();
    const { cookie } = await login(user.email);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    const destroy = vi
      .spyOn(app.get(SessionService).store, 'destroy')
      .mockImplementationOnce((_sid, done) =>
        done?.(new Error('store unavailable')),
      );
    await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Cookie', cookie)
      .expect(500);
    expect(
      await prisma.session.findUnique({ where: { sid: sidFrom(cookie) } }),
    ).not.toBeNull();
    destroy.mockRestore();
    await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Cookie', cookie)
      .expect(204);
    expect(
      await prisma.session.findUnique({ where: { sid: sidFrom(cookie) } }),
    ).toBeNull();
  });

  it('sets Secure only for HTTPS through explicitly trusted proxy hops', async () => {
    const user = await register();
    const secureApp = await startApp({ secure: true, trustProxyHops: 1 });
    try {
      const response = await request(secureApp.getHttpServer())
        .post('/auth/login')
        .set('X-Forwarded-Proto', 'https')
        .send({ email: user.email, password })
        .expect(200);
      const cookie = cookieFrom(response);
      expect(setCookieHeaders(response)[0]).toContain('Secure');
      const logout = await request(secureApp.getHttpServer())
        .post('/auth/logout')
        .set('X-Forwarded-Proto', 'https')
        .set('Cookie', cookie)
        .expect(204);
      expect(setCookieHeaders(logout)[0]).toContain('Secure');
    } finally {
      await secureApp.close();
    }
    const untrusted = await startApp({ secure: true, trustProxyHops: 0 });
    try {
      const response = await request(untrusted.getHttpServer())
        .post('/auth/login')
        .set('X-Forwarded-Proto', 'https')
        .send({ email: user.email, password })
        .expect(200);
      expect(response.headers['set-cookie']).toBeUndefined();
    } finally {
      await untrusted.close();
    }
  });
});
