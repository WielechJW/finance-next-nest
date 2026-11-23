import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsString,
  IsUrl,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import type { RegisteredUser } from '../users/users.service.js';
import {
  FinancialReportsService,
  type ReportImport,
} from './financial-reports.service.js';

class ReportImportDto implements ReportImport {
  @IsUUID() instrumentId!: string;
  @IsIn(['CONSOLIDATED', 'STANDALONE']) scope!: ReportImport['scope'];
  @IsIn(['ANNUAL', 'QUARTERLY']) periodKind!: ReportImport['periodKind'];
  @IsIn(['PLN', 'USD', 'EUR']) currency!: ReportImport['currency'];
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  periodStart!: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  periodEnd!: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  publishedOn!: string;
  @MaxLength(2048)
  @IsUrl({ protocols: ['https'], require_protocol: true, disallow_auth: true })
  sourceUrl!: string;
  @IsString() @MaxLength(200) filename!: string;
}

class ReportListDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(1_000_000) page = 1;
}

@Controller('fundamental-analysis/reports')
@UseGuards(SessionAuthGuard)
export class FinancialReportsController {
  constructor(private readonly reports: FinancialReportsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(@CurrentUser() user: RegisteredUser, @Query() query: ReportListDto) {
    return this.reports.list(user.id, query.page);
  }

  @Post()
  @Header('Cache-Control', 'no-store')
  @UseInterceptors(
    FileInterceptor('report', {
      limits: {
        fileSize: 15 * 1024 * 1024,
        files: 1,
        fields: 9,
        fieldSize: 4096,
      },
    }),
  )
  import(
    @CurrentUser() user: RegisteredUser,
    @Body() input: ReportImportDto,
    @UploadedFile() file?: { buffer: Buffer },
  ) {
    if (!file) throw new BadRequestException('Dołącz raport PDF.');
    return this.reports.import(
      user.id,
      input,
      file.buffer,
      AbortSignal.timeout(60_000),
    );
  }

  @Get(':id/pdf')
  @Header('Cache-Control', 'no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async download(
    @CurrentUser() user: RegisteredUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const { pdf } = await this.reports.pdf(user.id, id);
    return new StreamableFile(pdf, {
      type: 'application/pdf',
      disposition: 'inline',
    });
  }

  @Delete(':id')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  remove(
    @CurrentUser() user: RegisteredUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.reports.remove(user.id, id);
  }
}
