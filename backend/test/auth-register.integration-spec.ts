import { randomUUID } from 'node:crypto';
import { Logger, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { verify } from 'argon2';
import { getOptionsToken } from '@nestjs/throttler';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { PasswordService } from '../src/auth/password.service.js';
import { configureApp } from '../src/config/configure-app.js';
import { getAuthRateLimitOptions } from '../src/config/rate-limit.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

describe('POST /auth/register (PostgreSQL)', () => {
  const password = 'Moje testowe hasło 123!';
  const emails = new Set<string>();
  let app: INestApplication<App>;
  let prisma: PrismaService;

  function createEmail(): string {
    const email = `register-${randomUUID()}@example.invalid`;
    emails.add(email);
    return email;
  }

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(getOptionsToken())
      .useFactory({
        factory: () =>
          getAuthRateLimitOptions({
            AUTH_LOGIN_LIMIT: '1000',
            AUTH_REGISTER_LIMIT: '1000',
          }),
      })
      .compile();
    app = module.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (prisma && emails.size > 0) {
      await prisma.user.deleteMany({ where: { email: { in: [...emails] } } });
      emails.clear();
    }
  });

  afterAll(async () => {
    await app?.close();
  });

  it('returns safe user data, normalizes the email and stores a verifiable hash', async () => {
    const email = createEmail();
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    const errorLog = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    const response = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: `  ${email.toUpperCase()}  `, password })
      .expect(201);

    expect(response.body).toEqual({
      id: expect.any(String),
      email,
      createdAt: expect.any(String),
    });
    const stored = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(response.body.id).toBe(stored.id);
    expect(response.body.createdAt).toBe(stored.createdAt.toISOString());
    expect(stored.passwordHash).toMatch(/^\$argon2id\$/);
    expect(await verify(stored.passwordHash, password)).toBe(true);
    const output = JSON.stringify([
      response.body,
      log.mock.calls,
      errorLog.mock.calls,
    ]);
    expect(output).not.toContain(password);
    expect(output).not.toContain(stored.passwordHash);
  });

  it.each([15, 128])(
    'accepts passwords at the %i character boundary',
    async (length) => {
      const email = createEmail();
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email, password: 'ą'.repeat(length) })
        .expect(201);
    },
  );

  const invalidRequests: [
    string,
    (email: string) => Record<string, unknown>,
  ][] = [
    ['missing email', () => ({ password })],
    ['missing password', (email) => ({ email })],
    ['null email', () => ({ email: null, password })],
    ['non-string email', () => ({ email: 42, password })],
    ['non-string password', (email) => ({ email, password: 42 })],
    ['invalid email', () => ({ email: 'not-an-email', password })],
    ['short password', (email) => ({ email, password: 'x'.repeat(14) })],
    ['long password', (email) => ({ email, password: 'x'.repeat(129) })],
    ['extra fields', (email) => ({ email, password, role: 'admin' })],
  ];

  it.each(invalidRequests)(
    'rejects %s without saving a user',
    async (_label, body) => {
      const email = createEmail();
      const input = body(email);
      if (typeof input.email === 'string') emails.add(input.email);
      const hash = vi.spyOn(app.get(PasswordService), 'hash');
      const response = await request(app.getHttpServer())
        .post('/auth/register')
        .send(input)
        .expect(400);

      expect(response.body.statusCode).toBe(400);
      expect(JSON.stringify(response.body)).not.toContain(password);
      expect(hash).not.toHaveBeenCalled();
      expect(
        await prisma.user.count({ where: { email: { in: [...emails] } } }),
      ).toBe(0);
    },
  );

  it('rejects an already registered email regardless of case and surrounding spaces', async () => {
    const email = createEmail();
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password })
      .expect(201);

    const response = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: ` ${email.toUpperCase()} `, password })
      .expect(409);

    expect(response.body.message).toBe('Ten adres e-mail jest już zajęty.');
    expect(await prisma.user.count({ where: { email } })).toBe(1);
    expect(JSON.stringify(response.body)).not.toContain(password);
  });

  it('creates exactly one account for concurrent registrations with the same email', async () => {
    const email = createEmail();
    const responses = await Promise.all([
      request(app.getHttpServer())
        .post('/auth/register')
        .send({ email, password }),
      request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: email.toUpperCase(), password }),
    ]);

    expect(
      responses
        .map((response) => response.status)
        .sort((left, right) => left - right),
    ).toEqual([201, 409]);
    expect(await prisma.user.count({ where: { email } })).toBe(1);
  });

  it('returns a generic 500 and sanitized logs for an unexpected database error', async () => {
    const email = createEmail();
    const sensitive = `${password} private-hash`;
    const log = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    vi.spyOn(prisma.user, 'create').mockRejectedValueOnce(new Error(sensitive));

    const response = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password })
      .expect(500);

    expect(response.body.message).toBe('Nie udało się utworzyć konta.');
    expect(log).toHaveBeenCalled();
    const output = JSON.stringify([response.body, log.mock.calls]);
    expect(output).not.toContain(password);
    expect(output).not.toContain('private-hash');
    expect(await prisma.user.count({ where: { email } })).toBe(0);
  });
});
