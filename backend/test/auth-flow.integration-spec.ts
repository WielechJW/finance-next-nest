import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getOptionsToken } from '@nestjs/throttler';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/config/configure-app.js';
import { getFrontendOrigin } from '../src/config/cors.js';
import { getAuthRateLimitOptions } from '../src/config/rate-limit.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { setCookieHeaders } from './support/cookies.js';

describe('Complete authentication flow (PostgreSQL)', () => {
  const email = 'flow-' + randomUUID() + '@example.invalid';
  const credentials = { email, password: '  Hasło pełnego przepływu 123!  ' };
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
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

  afterAll(async () => {
    try {
      if (prisma) {
        const users = await prisma.user.findMany({
          where: { email },
          select: { id: true },
        });
        for (const user of users) {
          await prisma.session.deleteMany({
            where: { sess: { path: ['userId'], equals: user.id } },
          });
        }
        await prisma.user.deleteMany({ where: { email } });
      }
    } finally {
      await app?.close();
    }
  });

  it('registers, logs in, repeatedly reads the session, logs out and rejects the copied cookie', async () => {
    const server = app.getHttpServer();
    const headers = {
      Origin: getFrontendOrigin(),
      'Sec-Fetch-Site': 'same-site',
    };
    await request(server).get('/auth/me').expect(401);
    const registered = await request(server)
      .post('/auth/register')
      .set(headers)
      .send(credentials)
      .expect(201);
    const user = registered.body as {
      id: string;
      email: string;
      createdAt: string;
    };
    expect(user.email).toBe(email);
    expect(Object.keys(user).sort()).toEqual(['createdAt', 'email', 'id']);
    const login = await request(server)
      .post('/auth/login')
      .set(headers)
      .send(credentials)
      .expect(200);
    expect(login.body).toEqual(user);
    const cookieHeader = setCookieHeaders(login).find((entry) =>
      entry.startsWith('finance.sid='),
    );
    expect(cookieHeader).toBeDefined();
    const cookie = cookieHeader!.split(';')[0]!;

    for (let count = 0; count < 2; count++) {
      const me = await request(server)
        .get('/auth/me')
        .set('Cookie', cookie)
        .expect(200);
      expect(me.body).toEqual(user);
      expect(me.headers['cache-control']).toBe('no-store');
    }
    await request(server)
      .post('/auth/logout')
      .set(headers)
      .set('Cookie', cookie)
      .expect(204);
    await request(server).get('/auth/me').set('Cookie', cookie).expect(401);
    expect(
      await prisma.session.count({
        where: { sess: { path: ['userId'], equals: user.id } },
      }),
    ).toBe(0);
  });
});
