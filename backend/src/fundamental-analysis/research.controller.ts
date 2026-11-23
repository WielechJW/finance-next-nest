import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import type { RegisteredUser } from '../users/users.service.js';
import { ResearchService } from './research.service.js';

class NoteDto {
  @IsString() @MaxLength(4000) thesis!: string;
  @IsString() @MaxLength(4000) risks!: string;
  @IsString() @MaxLength(4000) reviewConditions!: string;
}

class ScreenDto {
  @IsIn(['CONSOLIDATED', 'STANDALONE']) scope: 'CONSOLIDATED' | 'STANDALONE' =
    'CONSOLIDATED';
  @IsOptional()
  @Matches(/^-?\d{1,12}(?:\.\d{1,2})?$/)
  minOperatingMargin?: string;
  @IsOptional() @Matches(/^-?\d{1,12}(?:\.\d{1,2})?$/) minNetMargin?: string;
  @IsIn(['include', 'exclude', 'only']) missing:
    'include' | 'exclude' | 'only' = 'include';
}

@Controller('fundamental-analysis/research')
@UseGuards(SessionAuthGuard)
export class ResearchController {
  constructor(private readonly research: ResearchService) {}

  @Get('screen')
  @Header('Cache-Control', 'no-store')
  screen(@CurrentUser() user: RegisteredUser, @Query() query: ScreenDto) {
    return this.research.screen(user.id, query);
  }

  @Get('notes/:instrumentId')
  @Header('Cache-Control', 'no-store')
  async note(
    @CurrentUser() user: RegisteredUser,
    @Param('instrumentId', ParseUUIDPipe) instrumentId: string,
  ) {
    return { note: await this.research.note(user.id, instrumentId) };
  }

  @Patch('notes/:instrumentId')
  @Header('Cache-Control', 'no-store')
  saveNote(
    @CurrentUser() user: RegisteredUser,
    @Param('instrumentId', ParseUUIDPipe) instrumentId: string,
    @Body() input: NoteDto,
  ) {
    return this.research.saveNote(user.id, instrumentId, input);
  }

  @Delete('notes/:instrumentId')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  remove(
    @CurrentUser() user: RegisteredUser,
    @Param('instrumentId', ParseUUIDPipe) instrumentId: string,
  ) {
    return this.research.deleteNote(user.id, instrumentId);
  }
}
