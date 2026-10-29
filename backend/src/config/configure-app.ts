import { ValidationPipe, type INestApplication } from '@nestjs/common';
import type { Express } from 'express';
import { SessionService } from '../sessions/session.service.js';
import { getFrontendOrigin } from './cors.js';

export function configureApp(app: INestApplication): void {
  app.enableCors({
    origin: getFrontendOrigin(),
    credentials: true,
    methods: ['GET', 'HEAD', 'POST'],
    allowedHeaders: ['Content-Type'],
  });
  const sessions = app.get(SessionService);
  const express = app.getHttpAdapter().getInstance() as Express;
  express.set('trust proxy', sessions.config.trustProxyHops);
  app.use(sessions.middleware);
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      validationError: { target: false, value: false },
    }),
  );
}
