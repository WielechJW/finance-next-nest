import {
  Controller,
  Delete,
  Logger,
  Patch,
  type INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getOptionsToken } from '@nestjs/throttler';
import session from 'express-session';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { PasswordService } from '../src/auth/password.service.js';
import { configureApp } from '../src/config/configure-app.js';
import { getFrontendOrigin } from '../src/config/cors.js';
import { getAuthRateLimitOptions } from '../src/config/rate-limit.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { SessionService } from '../src/sessions/session.service.js';
import { UsersService } from '../src/users/users.service.js';

const write = vi.fn();

// Future resource controllers inherit the same application-level protection.
@Controller('security-test-resource')
class ResourceController {
  @Patch()
  update() {
    write();
    return { updated: true };
  }

  @Delete()
  remove() {
    write();
    return { deleted: true };
  }
}

describe('Authentication request security (HTTP)', () => {
  const origin = getFrontendOrigin();
  const credentials = {
    email: 'security@example.invalid',
    password: 'private-test-password-123',
  };
  const user = {
    id: 'c572fa63-9c72-4cd1-a272-cc80ee2ef022',
    email: credentials.email,
    createdAt: new Date('2026-10-30T10:00:00Z'),
  };
  const passwords = {
    hash: vi.fn().mockResolvedValue('private-password-hash'),
    verifyForLogin: vi.fn().mockResolvedValue(true),
  };
  const users = {
    create: vi.fn().mockResolvedValue(user),
    findByEmailForLogin: vi.fn().mockResolvedValue({
      ...user,
      passwordHash: 'private-password-hash',
    }),
  };
  const sessions = {
    config: { trustProxyHops: 0 },
    middleware: session({
      secret: 'security-http-test-only-secret-32-bytes',
      resave: false,
      saveUninitialized: false,
    }),
    login: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn().mockResolvedValue(undefined),
  };
  let app: INestApplication<App>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const module = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [ResourceController],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .overrideProvider(UsersService)
      .useValue(users)
      .overrideProvider(PasswordService)
      .useValue(passwords)
      .overrideProvider(SessionService)
      .useValue(sessions)
      .overrideProvider(getOptionsToken())
      .useFactory({
        factory: () =>
          getAuthRateLimitOptions({
            AUTH_LOGIN_LIMIT: '2',
            AUTH_LOGIN_TTL_SECONDS: '60',
            AUTH_REGISTER_LIMIT: '1',
            AUTH_REGISTER_TTL_SECONDS: '60',
          }),
      })
      .compile();
    app = module.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await app?.close();
  });

  it.each([
    ['/auth/register', 201],
    ['/auth/login', 200],
    ['/auth/logout', 204],
  ] as const)(
    'accepts a write from the trusted frontend: %s',
    async (path, status) => {
      const response = await request(app.getHttpServer())
        .post(path)
        .set('Origin', origin)
        .set('Sec-Fetch-Site', 'same-site')
        .send(credentials)
        .expect(status);
      expect(response.headers['access-control-allow-origin']).toBe(origin);
      expect(response.headers['access-control-allow-credentials']).toBe('true');
    },
  );

  it.each([
    { Origin: 'https://foreign.example', 'Sec-Fetch-Site': 'cross-site' },
    { Origin: 'http://localhost:4444', 'Sec-Fetch-Site': 'same-site' },
    { Origin: 'https://foreign.example' },
    { Origin: 'null' },
    { 'Sec-Fetch-Site': 'cross-site' },
  ])(
    'rejects foreign writes before authentication, session or resource changes (%#)',
    async (headers) => {
      const errorLog = vi
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => {});
      const log = vi
        .spyOn(Logger.prototype, 'log')
        .mockImplementation(() => {});
      for (const path of ['/auth/register', '/auth/login', '/auth/logout']) {
        const response = await request(app.getHttpServer())
          .post(path)
          .set(headers)
          .set('Cookie', 'finance.sid=private-cookie-value')
          .send(credentials)
          .expect(403);
        expect(JSON.stringify(response.body)).not.toContain(
          credentials.password,
        );
        expect(JSON.stringify(response.headers)).not.toContain(
          'private-cookie-value',
        );
      }
      for (const method of ['patch', 'delete'] as const) {
        await request(app.getHttpServer())
          [method]('/security-test-resource')
          .set(headers)
          .expect(403);
      }
      expect(passwords.hash).not.toHaveBeenCalled();
      expect(passwords.verifyForLogin).not.toHaveBeenCalled();
      expect(users.create).not.toHaveBeenCalled();
      expect(users.findByEmailForLogin).not.toHaveBeenCalled();
      expect(sessions.login).not.toHaveBeenCalled();
      expect(sessions.logout).not.toHaveBeenCalled();
      expect(write).not.toHaveBeenCalled();
      const output = JSON.stringify([log.mock.calls, errorLog.mock.calls]);
      expect(output).not.toContain(credentials.password);
      expect(output).not.toContain('private-cookie-value');
    },
  );

  it('permits trusted resource writes, safe reads, preflight and non-browser clients', async () => {
    await request(app.getHttpServer())
      .patch('/security-test-resource')
      .set('Origin', origin)
      .set('Sec-Fetch-Site', 'same-site')
      .expect(200);
    await request(app.getHttpServer())
      .delete('/security-test-resource')
      .set('Origin', origin)
      .set('Sec-Fetch-Site', 'same-site')
      .expect(200);
    expect(write).toHaveBeenCalledTimes(2);
    await request(app.getHttpServer())
      .get('/')
      .set('Origin', 'https://foreign.example')
      .expect(200);
    await request(app.getHttpServer())
      .options('/auth/login')
      .set('Origin', origin)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type')
      .expect(204);
    await request(app.getHttpServer())
      .post('/auth/login')
      .send(credentials)
      .expect(200);
  });

  it('returns 429 before password verification and permits login after the block expires', async () => {
    const errorLog = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    for (let index = 0; index < 2; index++) {
      await request(app.getHttpServer())
        .post('/auth/login')
        .set('Origin', origin)
        .send(credentials)
        .expect(200);
    }
    const blocked = await request(app.getHttpServer())
      .post('/auth/login')
      .set('Origin', origin)
      .set('Cookie', 'finance.sid=private-cookie-value')
      .send(credentials)
      .expect(429);
    expect(blocked.body.message).toMatch(
      /^Zbyt wiele prób\. Spróbuj ponownie za \d+ s\.$/,
    );
    expect(Number(blocked.headers['retry-after-login'])).toBeGreaterThan(0);
    expect(passwords.verifyForLogin).toHaveBeenCalledTimes(2);
    expect(sessions.login).toHaveBeenCalledTimes(2);
    const output = JSON.stringify([
      blocked.body,
      log.mock.calls,
      errorLog.mock.calls,
    ]);
    for (const sensitive of [
      credentials.password,
      'private-cookie-value',
      'private-password-hash',
    ]) {
      expect(output).not.toContain(sensitive);
    }

    // Move only the storage clock; sockets and application timers stay real.
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 61000);
    await request(app.getHttpServer())
      .post('/auth/login')
      .set('Origin', origin)
      .send(credentials)
      .expect(200);
    expect(passwords.verifyForLogin).toHaveBeenCalledTimes(3);
  });

  it('limits registration before hashing and keeps its counter separate from login', async () => {
    await request(app.getHttpServer())
      .post('/auth/register')
      .set('Origin', origin)
      .send(credentials)
      .expect(201);
    await request(app.getHttpServer())
      .post('/auth/register')
      .set('Origin', origin)
      .send(credentials)
      .expect(429);
    expect(passwords.hash).toHaveBeenCalledTimes(1);
    expect(users.create).toHaveBeenCalledTimes(1);
    for (let index = 0; index < 2; index++) {
      await request(app.getHttpServer())
        .post('/auth/login')
        .set('Origin', origin)
        .send(credentials)
        .expect(200);
    }
    await request(app.getHttpServer())
      .post('/auth/login')
      .set('Origin', origin)
      .send(credentials)
      .expect(429);
    // Logging out is still possible while login and registration are blocked.
    await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Origin', origin)
      .expect(204);
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 61000);
    await request(app.getHttpServer())
      .post('/auth/register')
      .set('Origin', origin)
      .send(credentials)
      .expect(201);
    expect(passwords.hash).toHaveBeenCalledTimes(2);
  });

  it('counts invalid requests and rejects spoofed proxy IPs when no proxy is trusted', async () => {
    for (const forwardedIp of ['192.0.2.1', '192.0.2.2']) {
      await request(app.getHttpServer())
        .post('/auth/login')
        .set('Origin', origin)
        .set('X-Forwarded-For', forwardedIp)
        .send({ email: 'invalid' })
        .expect(400);
    }
    await request(app.getHttpServer())
      .post('/auth/login')
      .set('Origin', origin)
      .set('X-Forwarded-For', '192.0.2.3')
      .send(credentials)
      .expect(429);
    expect(passwords.verifyForLogin).not.toHaveBeenCalled();
  });
});
