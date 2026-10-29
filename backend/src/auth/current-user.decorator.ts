import {
  createParamDecorator,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';
import type { RegisteredUser } from '../users/users.service.js';

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): RegisteredUser => {
    const user = context.switchToHttp().getRequest<Request>().user;
    if (!user) throw new UnauthorizedException('Zaloguj się, aby kontynuować.');
    return user;
  },
);
