import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import type { RegisteredUser } from '../users/users.service.js';
import { BacktestInputDto } from './backtest-input.js';
import { BacktestsService } from './backtests.service.js';

function parseFile(buffer: Buffer) {
  let payload: unknown;
  try {
    payload = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(buffer),
    );
  } catch {
    throw new BadRequestException('Plik musi być dokumentem JSON w UTF-8.');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    throw new BadRequestException('Plik testu musi zawierać obiekt.');
  const input = plainToInstance(BacktestInputDto, payload);
  const errors = validateSync(input, {
    whitelist: true,
    forbidNonWhitelisted: true,
    validationError: { target: false, value: false },
  });
  if (errors.length)
    throw new BadRequestException(
      'Sprawdź pola pliku: ' +
        errors.map((entry) => entry.property).join(', ') +
        '.',
    );
  return input;
}

@Controller(
  'investments/portfolios/:portfolioId/accounts/:accountId/strategies/:strategyId/backtests',
)
@UseGuards(SessionAuthGuard)
export class BacktestsController {
  constructor(private readonly backtests: BacktestsService) {}

  @Post()
  @Header('Cache-Control', 'no-store')
  @UseInterceptors(
    FileInterceptor('snapshot', {
      limits: { fileSize: 1024 * 1024, files: 1, fields: 0 },
    }),
  )
  create(
    @CurrentUser() user: RegisteredUser,
    @Param('portfolioId', ParseUUIDPipe) portfolioId: string,
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Param('strategyId', ParseUUIDPipe) strategyId: string,
    @UploadedFile() file?: { buffer: Buffer },
  ) {
    if (!file)
      throw new BadRequestException('Dołącz plik danych testu historycznego.');
    return this.backtests.create(
      { userId: user.id, portfolioId, accountId },
      strategyId,
      parseFile(file.buffer),
    );
  }

  @Get()
  @Header('Cache-Control', 'no-store')
  list(
    @CurrentUser() user: RegisteredUser,
    @Param('portfolioId', ParseUUIDPipe) portfolioId: string,
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Param('strategyId', ParseUUIDPipe) strategyId: string,
  ) {
    return this.backtests.list(
      { userId: user.id, portfolioId, accountId },
      strategyId,
    );
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  get(
    @CurrentUser() user: RegisteredUser,
    @Param('portfolioId', ParseUUIDPipe) portfolioId: string,
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Param('strategyId', ParseUUIDPipe) strategyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.backtests.get(
      { userId: user.id, portfolioId, accountId },
      strategyId,
      id,
    );
  }
}
