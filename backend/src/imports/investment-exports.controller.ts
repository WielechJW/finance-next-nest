import {
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Query,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { IsIn, IsOptional } from 'class-validator';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import { IsCalendarDate } from '../transactions/transaction-validators.js';
import type { RegisteredUser } from '../users/users.service.js';
import {
  InvestmentExportsService,
  investmentExportKinds,
  type InvestmentExportKind,
} from './investment-exports.service.js';

class ExportCsvDto {
  @IsIn(investmentExportKinds) kind!: InvestmentExportKind;
  @IsCalendarDate() asOf!: string;
  @IsOptional() @IsCalendarDate() from?: string;
}
@Controller('investments/portfolios/:portfolioId/accounts/:accountId/exports')
@UseGuards(SessionAuthGuard)
export class InvestmentExportsController {
  constructor(private readonly exports: InvestmentExportsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async download(
    @CurrentUser() user: RegisteredUser,
    @Param('portfolioId', ParseUUIDPipe) portfolioId: string,
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Query() input: ExportCsvDto,
  ) {
    const csv = await this.exports.csv(
      user.id,
      portfolioId,
      accountId,
      input.kind,
      input.asOf,
      input.from,
    );
    return new StreamableFile(Buffer.from(csv, 'utf8'), {
      type: 'text/csv; charset=utf-8',
      disposition: `attachment; filename="finance-${input.kind}-${input.asOf}.csv"`,
    });
  }
}
