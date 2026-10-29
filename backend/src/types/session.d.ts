import 'express-session';
import type { RegisteredUser } from '../users/users.service.js';

declare module 'express-session' {
  interface SessionData {
    userId?: string;
  }
}

declare global {
  namespace Express {
    interface Request {
      user?: RegisteredUser;
    }
  }
}
