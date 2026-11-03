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
import type { WalletResponse } from './wallet-response.js';

const walletSelect = {
  id: true,
  name: true,
  currency: true,
  openingBalance: true,
} satisfies Prisma.WalletSelect;

type WalletRecord = Prisma.WalletGetPayload<{ select: typeof walletSelect }>;

@Injectable()
export class WalletsService {
  private readonly logger = new Logger(WalletsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getForUser(userId: string): Promise<WalletResponse> {
    let wallet: WalletRecord | null;
    try {
      wallet = await this.prisma.wallet.findUnique({
        where: { userId },
        select: walletSelect,
      });
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

    let wallet: WalletRecord;
    try {
      wallet = await this.prisma.wallet.update({
        where: { userId },
        data,
        select: walletSelect,
      });
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new NotFoundException('Nie znaleziono portfela.');
      }

      this.logger.error('Nie udało się zapisać portfela.');
      throw new InternalServerErrorException('Nie udało się zapisać portfela.');
    }

    return this.toResponse(wallet);
  }

  private toResponse(wallet: WalletRecord): WalletResponse {
    const openingBalance = formatMoney(wallet.openingBalance);
    return {
      id: wallet.id,
      name: wallet.name,
      currency: wallet.currency,
      openingBalance,
      balance: openingBalance,
    };
  }
}
