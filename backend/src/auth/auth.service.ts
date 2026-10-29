import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { UsersService, type RegisteredUser } from '../users/users.service.js';
import type { RegisterDto } from './dto/register.dto.js';
import { PasswordService } from './password.service.js';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly users: UsersService,
    private readonly passwords: PasswordService,
  ) {}

  async register(input: RegisterDto): Promise<RegisteredUser> {
    let passwordHash: string;
    try {
      passwordHash = await this.passwords.hash(input.password);
    } catch {
      this.logger.error('Nie udało się obliczyć hasha hasła.');
      throw new InternalServerErrorException('Nie udało się utworzyć konta.');
    }

    return this.users.create({ email: input.email, passwordHash });
  }
}
