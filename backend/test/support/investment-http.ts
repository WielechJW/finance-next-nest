import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getOptionsToken } from '@nestjs/throttler';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/config/configure-app.js';
import { getFrontendOrigin } from '../../src/config/cors.js';
import { getAuthRateLimitOptions } from '../../src/config/rate-limit.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';

export async function investmentHttpContext() {
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(getOptionsToken()).useFactory({ factory: () => getAuthRateLimitOptions({
      AUTH_LOGIN_LIMIT: '1000', AUTH_REGISTER_LIMIT: '1000',
    }) }).compile();
  const app: INestApplication<App> = module.createNestApplication({ logger: false });
  configureApp(app);
  await app.init();
  const prisma = app.get(PrismaService);
  const userIds: string[] = [];
  const origin = getFrontendOrigin();
  return {
    app, prisma, origin,
    async signIn() {
      const email = `investment-http-${randomUUID()}@example.invalid`;
      const password = 'Investment integration password 123!';
      const agent = request.agent(app.getHttpServer());
      const registration = await agent.post('/auth/register').send({ email, password }).expect(201);
      const user = registration.body as { id: string };
      userIds.push(user.id);
      await agent.post('/auth/login').send({ email, password }).expect(200);
      return { agent, userId: user.id };
    },
    async cleanup() {
      await prisma.session.deleteMany({ where: { OR: userIds.map((userId) => ({ sess: { path: ['userId'], equals: userId } })) } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      userIds.length = 0;
    },
  };
}
