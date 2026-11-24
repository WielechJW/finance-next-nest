import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import type { RegisteredUser } from '../users/users.service.js';
import {
  PaperConnectionDto,
  PaperEventDto,
  PaperOrderDto,
  SubmitPaperOrderDto,
} from './paper.dto.js';
import { PaperExecutionService } from './paper-execution.service.js';
import { PaperService } from './paper.service.js';

@Controller('investment-paper/connections')
@UseGuards(SessionAuthGuard)
export class PaperController {
  constructor(
    private readonly paper: PaperService,
    private readonly execution: PaperExecutionService,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(@CurrentUser() user: RegisteredUser) {
    return this.paper.list(user.id);
  }

  @Post()
  @Header('Cache-Control', 'no-store')
  create(
    @CurrentUser() user: RegisteredUser,
    @Body() input: PaperConnectionDto,
  ) {
    return this.paper.create(user.id, input);
  }

  @Get(':connectionId')
  @Header('Cache-Control', 'no-store')
  detail(
    @CurrentUser() user: RegisteredUser,
    @Param('connectionId', ParseUUIDPipe) connectionId: string,
  ) {
    return this.paper.detail(user.id, connectionId);
  }

  @Post(':connectionId/orders')
  @Header('Cache-Control', 'no-store')
  order(
    @CurrentUser() user: RegisteredUser,
    @Param('connectionId', ParseUUIDPipe) connectionId: string,
    @Body() input: PaperOrderDto,
  ) {
    return this.paper.createOrder(user.id, connectionId, input);
  }

  @Post(':connectionId/orders/:orderId/events')
  @Header('Cache-Control', 'no-store')
  record(
    @CurrentUser() user: RegisteredUser,
    @Param('connectionId', ParseUUIDPipe) connectionId: string,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() input: PaperEventDto,
  ) {
    return this.paper.recordEvent(user.id, connectionId, orderId, input);
  }

  @Post(':connectionId/orders/:orderId/submit')
  @Header('Cache-Control', 'no-store')
  submit(
    @CurrentUser() user: RegisteredUser,
    @Param('connectionId', ParseUUIDPipe) connectionId: string,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() body: SubmitPaperOrderDto,
  ) {
    return this.execution.submit(
      user.id,
      connectionId,
      orderId,
      body.fault ?? 'NONE',
    );
  }

  @Get(':connectionId/venue-orders/:clientOrderId')
  @Header('Cache-Control', 'no-store')
  lookup(
    @CurrentUser() user: RegisteredUser,
    @Param('connectionId', ParseUUIDPipe) connectionId: string,
    @Param('clientOrderId', ParseUUIDPipe) clientOrderId: string,
  ) {
    return this.execution.lookup(user.id, connectionId, clientOrderId);
  }

  @Post(':connectionId/orders/:orderId/venue-events')
  @Header('Cache-Control', 'no-store')
  venueEvent(
    @CurrentUser() user: RegisteredUser,
    @Param('connectionId', ParseUUIDPipe) connectionId: string,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() body: PaperEventDto,
  ) {
    return this.execution.venueEvent(user.id, connectionId, orderId, body);
  }

  @Post(':connectionId/reconcile')
  @Header('Cache-Control', 'no-store')
  reconcile(
    @CurrentUser() user: RegisteredUser,
    @Param('connectionId', ParseUUIDPipe) connectionId: string,
  ) {
    return this.execution.reconcile(user.id, connectionId);
  }
}
