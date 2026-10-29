import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { PrismaService } from './../src/prisma/prisma.service.js';
import { configureApp } from './../src/config/configure-app.js';
import session from 'express-session';
import { SessionService } from './../src/sessions/session.service.js';
import { getFrontendOrigin } from './../src/config/cors.js';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      // The root endpoint does not use the database.
      .overrideProvider(PrismaService)
      .useValue({})
      .overrideProvider(SessionService)
      .useValue({
        config: { trustProxyHops: 0 },
        middleware: session({
          secret: 'root-endpoint-test-only-secret-32-bytes',
          resave: false,
          saveUninitialized: false,
        }),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  it('allows credentialed browser requests from the configured frontend', async () => {
    const origin = getFrontendOrigin();
    const response = await request(app.getHttpServer())
      .options('/auth/login')
      .set('Origin', origin)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type')
      .expect(204);
    expect(response.headers['access-control-allow-origin']).toBe(origin);
    expect(response.headers['access-control-allow-credentials']).toBe('true');
    expect(
      response.headers['access-control-allow-headers'].toLowerCase(),
    ).toContain('content-type');
  });

  it('does not grant a different browser origin access to responses', async () => {
    const response = await request(app.getHttpServer())
      .get('/')
      .set('Origin', 'https://other.example.com')
      .expect(200);
    expect(response.headers['access-control-allow-origin']).not.toBe(
      'https://other.example.com',
    );
  });

  afterEach(async () => {
    await app.close();
  });
});
