import { ValidationPipe, type INestApplication } from '@nestjs/common';
import type { Express } from 'express';
import { SessionService } from '../sessions/session.service.js';
import { getFrontendOrigin } from './cors.js';

export function configureApp(app: INestApplication): void {
  const frontendOrigin = getFrontendOrigin();
  app.enableCors({
    origin: frontendOrigin,
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PATCH'],
    allowedHeaders: ['Content-Type'],
  });
  // Reject foreign browser writes before loading a session or running a handler.
  app.enableCsrfProtection({ trustedOrigins: [frontendOrigin] });
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
