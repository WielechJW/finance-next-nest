import {
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
import { IsOptional, IsString, MaxLength } from 'class-validator';
import type { Response } from 'express';
import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import { FundamentalAnalysisService } from './fundamental-analysis.service.js';

class ChatInput {
  @IsString()
  @MaxLength(1500, { message: 'Pytanie może mieć maksymalnie 1500 znaków.' })
  question!: string;

  @IsOptional()
  @IsString()
  @MaxLength(48_000)
  history?: string;
}

@Controller('fundamental-analysis')
@UseGuards(SessionAuthGuard)
export class FundamentalAnalysisController {
  constructor(private readonly analysis: FundamentalAnalysisService) {}

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
        fields: 2,
        fieldSize: 128 * 1024,
      },
    }),
  )
  async chat(
    @Body() input: ChatInput,
    @UploadedFile() report: { buffer: Buffer } | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const controller = new AbortController();
    const cancel = () => controller.abort();
    response.once('close', cancel);
    if (response.destroyed) cancel();
    try {
      return await this.analysis.chat(input, report?.buffer, controller.signal);
    } finally {
      response.off('close', cancel);
    }
  }
}
