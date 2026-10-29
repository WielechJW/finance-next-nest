import {
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { SessionService } from '../sessions/session.service.js';
import { UsersService } from '../users/users.service.js';

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    private readonly users: UsersService,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const userId = request.session?.userId;

    if (
      typeof userId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        userId,
      )
    ) {
      this.sessions.clearCookie(response);
      throw new UnauthorizedException('Zaloguj się, aby kontynuować.');
    }

    const user = await this.users.findPublicById(userId);
    if (!user) {
      await this.sessions.logout(request, response);
      throw new UnauthorizedException('Zaloguj się, aby kontynuować.');
    }

    request.user = user;
    return true;
  }
}
