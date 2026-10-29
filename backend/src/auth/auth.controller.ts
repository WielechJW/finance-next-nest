import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import type { RegisteredUser } from '../users/users.service.js';
import { AuthService } from './auth.service.js';
import { RegisterDto } from './dto/register.dto.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  register(@Body() input: RegisterDto): Promise<RegisteredUser> {
    return this.auth.register(input);
  }
}
