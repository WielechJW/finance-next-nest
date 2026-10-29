import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

const publicUserSelect = {
  id: true,
  email: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

export type RegisteredUser = Prisma.UserGetPayload<{
  select: typeof publicUserSelect;
}>;

interface CreateUserInput {
  email: string;
  passwordHash: string;
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateUserInput): Promise<RegisteredUser> {
    try {
      return await this.prisma.user.create({
        data: input,
        select: publicUserSelect,
      });
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Ten adres e-mail jest już zajęty.');
      }

      // A raw Prisma error can include query arguments, including passwordHash.
      this.logger.error('Nie udało się zapisać użytkownika.');
      throw new InternalServerErrorException('Nie udało się utworzyć konta.');
    }
  }

  async findByEmailForLogin(email: string) {
    try {
      return await this.prisma.user.findUnique({
        where: { email },
        select: { ...publicUserSelect, passwordHash: true },
      });
    } catch {
      this.logger.error('Nie udało się odczytać użytkownika.');
      throw new InternalServerErrorException(
        'Nie udało się sprawdzić danych użytkownika.',
      );
    }
  }

  async findPublicById(id: string): Promise<RegisteredUser | null> {
    try {
      return await this.prisma.user.findUnique({
        where: { id },
        select: publicUserSelect,
      });
    } catch {
      this.logger.error('Nie udało się odczytać użytkownika.');
      throw new InternalServerErrorException(
        'Nie udało się sprawdzić danych użytkownika.',
      );
    }
  }
}
