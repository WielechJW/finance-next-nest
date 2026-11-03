export interface WalletDto {
  id: string;
  name: string;
  currency: "PLN";
  openingBalance: string;
  balance: string;
}

export interface UpdateWalletInput {
  name?: string;
  openingBalance?: string;
}
