import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import type { RegisteredUser } from '../users/users.service.js';
import { StrategiesService } from './strategies.service.js';

class StrategyVersionDto {
  @IsObject() parameters!: Record<string, unknown>;
}
class StrategyDto extends StrategyVersionDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(1, 100)
  name!: string;
  @IsUUID() instrumentId!: string;
}
class RunStrategyDto {
  @IsOptional()
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/)
  decidedAt?: string;
}
class PageDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(100000) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 30;
}

@Controller(
  'investments/portfolios/:portfolioId/accounts/:accountId/strategies',
)
@UseGuards(SessionAuthGuard)
export class StrategiesController {
  constructor(private readonly strategies: StrategiesService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(
    @CurrentUser() user: RegisteredUser,
    @Param('portfolioId', ParseUUIDPipe) portfolioId: string,
    @Param('accountId', ParseUUIDPipe) accountId: string,
  ) {
    return this.strategies.list({ userId: user.id, portfolioId, accountId });
  }

  @Post()
  @Header('Cache-Control', 'no-store')
  create(
    @CurrentUser() user: RegisteredUser,
    @Param('portfolioId', ParseUUIDPipe) portfolioId: string,
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Body() input: StrategyDto,
  ) {
    return this.strategies.create(
      { userId: user.id, portfolioId, accountId },
      input.name,
      input.instrumentId,
      input.parameters,
    );
  }

  @Get(':id/versions')
  @Header('Cache-Control', 'no-store')
  versions(
    @CurrentUser() user: RegisteredUser,
    @Param('portfolioId', ParseUUIDPipe) portfolioId: string,
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.strategies.versions(
      { userId: user.id, portfolioId, accountId },
      id,
    );
  }

  @Post(':id/versions')
  @Header('Cache-Control', 'no-store')
  revise(
    @CurrentUser() user: RegisteredUser,
    @Param('portfolioId', ParseUUIDPipe) portfolioId: string,
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: StrategyVersionDto,
  ) {
    return this.strategies.revise(
      { userId: user.id, portfolioId, accountId },
      id,
      input.parameters,
    );
  }

  @Get(':id/runs')
  @Header('Cache-Control', 'no-store')
  runs(
    @CurrentUser() user: RegisteredUser,
    @Param('portfolioId', ParseUUIDPipe) portfolioId: string,
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() page: PageDto,
  ) {
    return this.strategies.runs(
      { userId: user.id, portfolioId, accountId },
      id,
      page.page,
      page.pageSize,
    );
  }

  @Post(':id/runs')
  @Header('Cache-Control', 'no-store')
  run(
    @CurrentUser() user: RegisteredUser,
    @Param('portfolioId', ParseUUIDPipe) portfolioId: string,
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: RunStrategyDto,
  ) {
    return this.strategies.run(
      { userId: user.id, portfolioId, accountId },
      id,
      input.decidedAt ? new Date(input.decidedAt) : undefined,
    );
  }

  @Get(':id/runs/:runId/replay')
  @Header('Cache-Control', 'no-store')
  replay(
    @CurrentUser() user: RegisteredUser,
    @Param('portfolioId', ParseUUIDPipe) portfolioId: string,
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('runId', ParseUUIDPipe) runId: string,
  ) {
    return this.strategies.replay(
      { userId: user.id, portfolioId, accountId },
      id,
      runId,
    );
  }
}
