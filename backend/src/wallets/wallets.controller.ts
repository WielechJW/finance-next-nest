import {
  Body,
  Controller,
  Get,
  Header,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import type { RegisteredUser } from '../users/users.service.js';
import { UpdateWalletDto } from './dto/update-wallet.dto.js';
import type { WalletResponse } from './wallet-response.js';
import { WalletsService } from './wallets.service.js';

@Controller('wallet')
@UseGuards(SessionAuthGuard)
export class WalletsController {
  constructor(private readonly wallets: WalletsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  get(@CurrentUser() user: RegisteredUser): Promise<WalletResponse> {
    return this.wallets.getForUser(user.id);
  }

  @Patch()
  @Header('Cache-Control', 'no-store')
  update(
    @CurrentUser() user: RegisteredUser,
    @Body() input: UpdateWalletDto,
  ): Promise<WalletResponse> {
    return this.wallets.updateForUser(user.id, input);
  }
}
