import { IsIn } from 'class-validator';
import type { AnalyticsGranularity } from '../analytics-trends.js';
import { AnalyticsPeriodDto } from './analytics-period.dto.js';

export class AnalyticsTrendsDto extends AnalyticsPeriodDto {
  @IsIn(['day', 'month'], {
    message: 'Granularność musi mieć wartość day albo month.',
  })
  granularity: AnalyticsGranularity = 'day';
}
