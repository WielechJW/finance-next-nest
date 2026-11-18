import {
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { RegisteredUser } from '../users/users.service.js';
import { OperationsService } from './operations.service.js';
@Controller('health')
export class HealthController {
  constructor(private readonly operations: OperationsService) {}
  @Get('live') @Header('Cache-Control', 'no-store') live() {
    return { alive: true };
  }
  @Get('ready') @Header('Cache-Control', 'no-store') ready() {
    return this.operations.ready();
  }
}
@Controller('operations/market-data')
@UseGuards(SessionAuthGuard)
export class OperationsController {
  constructor(private readonly operations: OperationsService) {}
  @Get() @Header('Cache-Control', 'no-store') status(
    @CurrentUser() user: RegisteredUser,
  ) {
    return this.operations.status(user.id);
  }
  @Post('jobs/:id/retry') retry(
    @CurrentUser() user: RegisteredUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.operations.retry(user.id, id);
  }
}
