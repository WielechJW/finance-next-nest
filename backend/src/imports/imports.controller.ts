import {
  BadRequestException,
  Body,
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
import { IsIn } from 'class-validator';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import type { RegisteredUser } from '../users/users.service.js';
import { maxImportBytes } from './csv-reader.js';
import { importFormats, type ImportFormat } from './import-parser.js';
import { ImportsService } from './imports.service.js';

class ImportDto {
  @IsIn(importFormats) format!: ImportFormat;
}

@Controller('investments/portfolios/:portfolioId/accounts/:accountId/imports')
@UseGuards(SessionAuthGuard)
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  @Post()
  @Header('Cache-Control', 'no-store')
  @UseInterceptors(
    FileInterceptor('csv', {
      limits: { fileSize: maxImportBytes, files: 1, fields: 1, fieldSize: 48 },
    }),
  )
  create(
    @CurrentUser() user: RegisteredUser,
    @Param('portfolioId', ParseUUIDPipe) portfolioId: string,
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Body() input: ImportDto,
    @UploadedFile() file?: { buffer: Buffer },
  ) {
    if (!file) throw new BadRequestException('Dołącz plik CSV.');
    return this.imports.create(
      user.id,
      portfolioId,
      accountId,
      input.format,
      file.buffer,
    );
  }

  @Get()
  @Header('Cache-Control', 'no-store')
  list(
    @CurrentUser() user: RegisteredUser,
    @Param('portfolioId', ParseUUIDPipe) portfolioId: string,
    @Param('accountId', ParseUUIDPipe) accountId: string,
  ) {
    return this.imports.list(user.id, portfolioId, accountId);
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  get(
    @CurrentUser() user: RegisteredUser,
    @Param('portfolioId', ParseUUIDPipe) portfolioId: string,
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.imports.get(user.id, portfolioId, accountId, id);
  }
}
