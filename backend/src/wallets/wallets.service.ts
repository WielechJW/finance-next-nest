import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { UpdateWalletDto } from './dto/update-wallet.dto.js';
import { formatMoney } from './money.js';
import {
  findWalletWithBalance,
  type WalletWithBalance,
} from './wallet-balance.js';
import type { WalletResponse } from './wallet-response.js';

@Injectable()
export class WalletsService {
  private readonly logger = new Logger(WalletsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getForUser(userId: string): Promise<WalletResponse> {
    let wallet: WalletWithBalance | null;
    try {
      wallet = await findWalletWithBalance(this.prisma, userId);
    } catch {
      this.logger.error('Nie udało się odczytać portfela.');
      throw new InternalServerErrorException('Nie udało się pobrać portfela.');
    }

    if (!wallet) throw new NotFoundException('Nie znaleziono portfela.');
    return this.toResponse(wallet);
  }

  async updateForUser(
    userId: string,
    input: UpdateWalletDto,
  ): Promise<WalletResponse> {
    if (input.name === undefined && input.openingBalance === undefined) {
      throw new BadRequestException(
        'Podaj nazwę lub saldo początkowe portfela.',
      );
    }

    const data: Prisma.WalletUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.openingBalance !== undefined) {
      data.openingBalance = new Prisma.Decimal(input.openingBalance);
    }

    try {
      return await this.prisma.$transaction(async (database) => {
        await database.wallet.update({
          where: { userId },
          data,
          select: { id: true },
        });
        // The update holds the wallet row lock until its balance has been read.
        // An aggregation failure rolls back the settings change as well.
        const wallet = await findWalletWithBalance(database, userId);
        if (!wallet) throw new NotFoundException('Nie znaleziono portfela.');
        return this.toResponse(wallet);
      });
    } catch (error: unknown) {
      if (error instanceof NotFoundException) throw error;
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new NotFoundException('Nie znaleziono portfela.');
      }

      this.logger.error('Nie udało się zapisać portfela.');
      throw new InternalServerErrorException('Nie udało się zapisać portfela.');
    }
  }

  private toResponse(wallet: WalletWithBalance): WalletResponse {
    return {
      id: wallet.id,
      name: wallet.name,
      currency: wallet.currency,
      openingBalance: formatMoney(wallet.openingBalance),
      balance: formatMoney(wallet.balance),
    };
  }
}
