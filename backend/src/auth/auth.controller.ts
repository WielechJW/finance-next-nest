import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { SessionService } from '../sessions/session.service.js';
import type { RegisteredUser } from '../users/users.service.js';
import { AuthService } from './auth.service.js';
import { RegisterDto } from './dto/register.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { CurrentUser } from './current-user.decorator.js';
import { SessionAuthGuard } from './session-auth.guard.js';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
  ) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  register(@Body() input: RegisterDto): Promise<RegisteredUser> {
    return this.auth.register(input);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  async login(
    @Body() input: LoginDto,
    @Req() request: Request,
  ): Promise<RegisteredUser> {
    const user = await this.auth.login(input);
    await this.sessions.login(request, user.id);
    return user;
  }

  @Get('me')
  @UseGuards(SessionAuthGuard)
  @Header('Cache-Control', 'no-store')
  me(@CurrentUser() user: RegisteredUser): RegisteredUser {
    return user;
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Header('Cache-Control', 'no-store')
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.sessions.logout(request, response);
  }
}
