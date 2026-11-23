import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  ParseIntPipe,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IsIn, IsUUID, ValidateIf } from 'class-validator';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import type { RegisteredUser } from '../users/users.service.js';
import { ConfirmImportDto } from './confirm-import.dto.js';
import { ImportConfirmationService } from './import-confirmation.service.js';
import { maxImportBytes } from './csv-reader.js';
import { importFormats, type ImportFormat } from './import-parser.js';
import { ImportPreviewService } from './import-preview.service.js';
import { ImportsService } from './imports.service.js';

class ImportDto {
  @IsIn(importFormats) format!: ImportFormat;
}

class MapInstrumentDto {
  @ValidateIf((_object, value: unknown) => value !== null)
  @IsUUID()
  instrumentId!: string | null;
}

@Controller('investments/portfolios/:portfolioId/accounts/:accountId/imports')
@UseGuards(SessionAuthGuard)
export class ImportsController {
  constructor(
    private readonly imports: ImportsService,
    private readonly previews: ImportPreviewService,
    private readonly confirmation: ImportConfirmationService,
  ) {}

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

  @Get(':id/preview')
  @Header('Cache-Control', 'no-store')
  preview(
    @CurrentUser() user: RegisteredUser,
    @Param('portfolioId', ParseUUIDPipe) portfolioId: string,
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.previews.preview(user.id, portfolioId, accountId, id);
  }

  @Patch(':id/rows/:number/instrument')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  async map(
    @CurrentUser() user: RegisteredUser,
    @Param('portfolioId', ParseUUIDPipe) portfolioId: string,
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('number', ParseIntPipe) number: number,
    @Body() input: MapInstrumentDto,
  ) {
    if (!Number.isSafeInteger(number) || number < 1 || number > 2147483647)
      throw new BadRequestException('Nieprawidłowy numer wiersza.');
    await this.previews.map(
      user.id,
      portfolioId,
      accountId,
      id,
      number,
      input.instrumentId,
    );
  }

  @Post(':id/confirm')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  confirm(
    @CurrentUser() user: RegisteredUser,
    @Param('portfolioId', ParseUUIDPipe) portfolioId: string,
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: ConfirmImportDto,
  ) {
    return this.confirmation.confirm(
      user.id,
      portfolioId,
      accountId,
      id,
      input,
    );
  }
}
