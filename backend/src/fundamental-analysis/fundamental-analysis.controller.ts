import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import type { Response } from 'express';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import type { RegisteredUser } from '../users/users.service.js';
import { FinancialReportsService } from './financial-reports.service.js';
import { FundamentalAnalysisService } from './fundamental-analysis.service.js';

class ChatInput {
  @IsString()
  @MaxLength(1500, { message: 'Pytanie może mieć maksymalnie 1500 znaków.' })
  question!: string;

  @IsOptional()
  @IsString()
  @MaxLength(48_000)
  history?: string;

  @IsOptional()
  @IsUUID()
  instrumentId?: string;

  @IsOptional()
  @IsUUID()
  reportId?: string;
}

@Controller('fundamental-analysis')
@UseGuards(SessionAuthGuard)
export class FundamentalAnalysisController {
  constructor(
    private readonly analysis: FundamentalAnalysisService,
    private readonly reports: FinancialReportsService,
  ) {}

  @Get('status')
  @Header('Cache-Control', 'no-store')
  status() {
    return this.analysis.status();
  }

  @Post('chat')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @UseInterceptors(
    FileInterceptor('report', {
      limits: {
        fileSize: 15 * 1024 * 1024,
        files: 1,
        fields: 4,
        fieldSize: 128 * 1024,
      },
    }),
  )
  async chat(
    @CurrentUser() user: RegisteredUser,
    @Body() input: ChatInput,
    @UploadedFile() report: { buffer: Buffer } | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (input.reportId && (report || input.instrumentId))
      throw new BadRequestException(
        'Wybierz zapisany raport albo dołącz nowy plik.',
      );
    const controller = new AbortController();
    const cancel = () => controller.abort();
    response.once('close', cancel);
    if (response.destroyed) cancel();
    try {
      const saved = input.reportId
        ? await this.reports.forAnalysis(user.id, input.reportId)
        : undefined;
      return await this.analysis.chat(
        input,
        report?.buffer,
        controller.signal,
        saved,
      );
    } finally {
      response.off('close', cancel);
    }
  }
}
