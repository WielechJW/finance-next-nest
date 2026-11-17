import { Body, Controller, Get, Header, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import type { RegisteredUser } from '../users/users.service.js';
import { InvestmentAccountsService } from './accounts.service.js';
import { InvestmentNameDto, UpdateInvestmentAccountDto } from './dto/account.dto.js';

@Controller('investments/portfolios')
@UseGuards(SessionAuthGuard)
export class InvestmentAccountsController {
  constructor(private readonly accounts: InvestmentAccountsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(@CurrentUser() user: RegisteredUser) { return this.accounts.listPortfolios(user.id); }

  @Post()
  @Header('Cache-Control', 'no-store')
  create(@CurrentUser() user: RegisteredUser, @Body() input: InvestmentNameDto) {
    return this.accounts.createPortfolio(user.id, input.name);
  }

  @Get(':portfolioId')
  @Header('Cache-Control', 'no-store')
  get(@CurrentUser() user: RegisteredUser, @Param('portfolioId', ParseUUIDPipe) portfolioId: string) {
    return this.accounts.getPortfolio(user.id, portfolioId);
  }

  @Patch(':portfolioId')
  @Header('Cache-Control', 'no-store')
  rename(@CurrentUser() user: RegisteredUser, @Param('portfolioId', ParseUUIDPipe) portfolioId: string,
    @Body() input: InvestmentNameDto) {
    return this.accounts.renamePortfolio(user.id, portfolioId, input.name);
  }

  @Get(':portfolioId/accounts')
  @Header('Cache-Control', 'no-store')
  listAccounts(@CurrentUser() user: RegisteredUser, @Param('portfolioId', ParseUUIDPipe) portfolioId: string) {
    return this.accounts.listAccounts(user.id, portfolioId);
  }

  @Post(':portfolioId/accounts')
  @Header('Cache-Control', 'no-store')
  createAccount(@CurrentUser() user: RegisteredUser, @Param('portfolioId', ParseUUIDPipe) portfolioId: string,
    @Body() input: InvestmentNameDto) {
    return this.accounts.createAccount(user.id, portfolioId, input.name);
  }

  @Get(':portfolioId/accounts/:accountId')
  @Header('Cache-Control', 'no-store')
  getAccount(@CurrentUser() user: RegisteredUser, @Param('portfolioId', ParseUUIDPipe) portfolioId: string,
    @Param('accountId', ParseUUIDPipe) accountId: string) {
    return this.accounts.getAccount(user.id, portfolioId, accountId);
  }

  @Patch(':portfolioId/accounts/:accountId')
  @Header('Cache-Control', 'no-store')
  updateAccount(@CurrentUser() user: RegisteredUser, @Param('portfolioId', ParseUUIDPipe) portfolioId: string,
    @Param('accountId', ParseUUIDPipe) accountId: string, @Body() input: UpdateInvestmentAccountDto) {
    return this.accounts.updateAccount(user.id, portfolioId, accountId, input);
  }
}
