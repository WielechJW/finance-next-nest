import {
  Injectable,
  InternalServerErrorException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { UsersService, type RegisteredUser } from '../users/users.service.js';
import type { RegisterDto } from './dto/register.dto.js';
import { PasswordService } from './password.service.js';
import type { LoginDto } from './dto/login.dto.js';

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

  async login(input: LoginDto): Promise<RegisteredUser> {
    const user = await this.users.findByEmailForLogin(input.email);
    let matches: boolean;
    try {
      matches = await this.passwords.verifyForLogin(
        user?.passwordHash,
        input.password,
      );
    } catch {
      this.logger.error('Nie udało się sprawdzić hasła.');
      throw new InternalServerErrorException('Nie udało się zalogować.');
    }
    if (!user || !matches) {
      throw new UnauthorizedException('Nieprawidłowy e-mail lub hasło.');
    }
    return { id: user.id, email: user.email, createdAt: user.createdAt };
  }
}
