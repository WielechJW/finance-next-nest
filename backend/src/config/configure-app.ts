import { ValidationPipe, type INestApplication } from '@nestjs/common';
import type { Express } from 'express';
import { SessionService } from '../sessions/session.service.js';

export function configureApp(app: INestApplication): void {
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
