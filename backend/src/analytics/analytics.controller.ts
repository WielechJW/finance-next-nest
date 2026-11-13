import { Controller, Get, Header, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import type { RegisteredUser } from '../users/users.service.js';
import type {
  AnalyticsCategoriesResponse,
  AnalyticsSummaryResponse,
  AnalyticsTrendsResponse,
} from './analytics-response.js';
import { AnalyticsService } from './analytics.service.js';
import { AnalyticsPeriodDto } from './dto/analytics-period.dto.js';
import { AnalyticsTrendsDto } from './dto/analytics-trends.dto.js';

@Controller('analytics')
@UseGuards(SessionAuthGuard)
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('summary')
  @Header('Cache-Control', 'no-store')
  summary(
    @CurrentUser() user: RegisteredUser,
    @Query() input: AnalyticsPeriodDto,
  ): Promise<AnalyticsSummaryResponse> {
    return this.analytics.summaryForUser(user.id, input);
  }

  @Get('categories')
  @Header('Cache-Control', 'no-store')
  categories(
    @CurrentUser() user: RegisteredUser,
    @Query() input: AnalyticsPeriodDto,
  ): Promise<AnalyticsCategoriesResponse> {
    return this.analytics.categoriesForUser(user.id, input);
  }

  @Get('trends')
  @Header('Cache-Control', 'no-store')
  trends(
    @CurrentUser() user: RegisteredUser,
    @Query() input: AnalyticsTrendsDto,
  ): Promise<AnalyticsTrendsResponse> {
    return this.analytics.trendsForUser(user.id, input);
  }
}
