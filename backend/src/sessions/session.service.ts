import {
  InternalServerErrorException,
  Logger,
  type OnModuleDestroy,
} from '@nestjs/common';
import connectPgSimple from 'connect-pg-simple';
import type { CookieOptions, Request, RequestHandler, Response } from 'express';
import session from 'express-session';
import { Pool } from 'pg';
import { getDatabaseUrl } from '../config/environment.js';
import type { SessionConfig } from './session.config.js';

const PgStore = connectPgSimple(session);

export class SessionService implements OnModuleDestroy {
  private readonly logger = new Logger(SessionService.name);
  private readonly pool: Pool;
  private closed = false;
  readonly store: connectPgSimple.PGStore;
  readonly middleware: RequestHandler;

  constructor(readonly config: SessionConfig) {
    this.pool = new Pool({ connectionString: getDatabaseUrl(), max: 5 });
    this.pool.on('error', () =>
      this.logger.error('Błąd połączenia magazynu sesji.'),
    );
    this.store = new PgStore({
      pool: this.pool,
      tableName: 'session',
      schemaName: 'public',
      ttl: config.ttlSeconds,
      createTableIfMissing: false,
      errorLog: () => this.logger.error('Błąd magazynu sesji.'),
    });

    const middleware = session({
      name: config.cookieName,
      secret: config.secret,
      store: this.store,
      resave: false,
      saveUninitialized: false,
      rolling: true,
      cookie: { ...this.cookieOptions(), maxAge: config.ttlSeconds * 1000 },
    });

    this.middleware = (request, response, next) => {
      try {
        middleware(request, response, (error?: unknown) => {
          next(error ? this.failure() : undefined);
        });
      } catch {
        next(this.failure());
      }
    };
  }

  async login(request: Request, userId: string): Promise<void> {
    try {
      if (!request.session) throw new Error('Session middleware unavailable');
      await this.execute((done) => request.session.regenerate(done));
      request.session.userId = userId;
      await this.execute((done) => request.session.save(done));
    } catch {
      // Do not let express-session retry saving authenticated data after failure.
      const failedSession = request.session;
      Reflect.deleteProperty(request, 'session');
      if (failedSession) {
        try {
          await this.execute((done) => failedSession.destroy(done));
        } catch {
          this.logger.error('Nie udało się usunąć niepełnej sesji.');
        }
      }
      throw this.failure();
    }
  }

  async logout(request: Request, response: Response): Promise<void> {
    const current = request.session;
    if (current) {
      try {
        await this.execute((done) => current.destroy(done));
      } catch {
        Reflect.deleteProperty(request, 'session');
        throw this.failure();
      }
    }
    Reflect.deleteProperty(request, 'session');
    this.clearCookie(response);
  }

  clearCookie(response: Response): void {
    response.clearCookie(this.config.cookieName, this.cookieOptions());
  }

  async onModuleDestroy(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      await Promise.resolve(this.store.close());
    } finally {
      await this.pool.end();
    }
  }

  private cookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.config.secure,
      path: '/',
    };
  }

  private execute(
    action: (done: (error?: unknown) => void) => void,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      action((error) => {
        if (error) reject(new Error('Session operation failed'));
        else resolve();
      });
    });
  }

  private failure(): InternalServerErrorException {
    // Never log a raw store error: it can contain session IDs and user data.
    this.logger.error('Nie udało się obsłużyć sesji.');
    return new InternalServerErrorException('Nie udało się obsłużyć sesji.');
  }
}
