import { ApiError, apiRequest } from "./api-client";
import { isMoneyString } from "./money";
import type { UpdateWalletInput, WalletDto } from "./wallet-types";

function parseWallet(value: unknown): WalletDto {
  if (
    !value ||
    typeof value !== "object" ||
    !("id" in value) ||
    typeof value.id !== "string" ||
    !value.id ||
    !("name" in value) ||
    typeof value.name !== "string" ||
    !value.name.trim() ||
    !("currency" in value) ||
    value.currency !== "PLN" ||
    !("openingBalance" in value) ||
    !isMoneyString(value.openingBalance) ||
    !("balance" in value) ||
    !isMoneyString(value.balance)
  ) {
    throw new ApiError(
      502,
      "Serwer zwrócił nieprawidłowe dane portfela. Spróbuj ponownie.",
    );
  }
  return {
    id: value.id,
    name: value.name,
    currency: value.currency,
    openingBalance: value.openingBalance,
    balance: value.balance,
  };
}

export const walletApi = {
  async get(signal?: AbortSignal): Promise<WalletDto> {
    return parseWallet(await apiRequest<unknown>("/wallet", { signal }));
  },

  async update(
    input: UpdateWalletInput,
    signal?: AbortSignal,
  ): Promise<WalletDto> {
    return parseWallet(
      await apiRequest<unknown>("/wallet", {
        method: "PATCH",
        body: JSON.stringify({
          name: input.name,
          openingBalance: input.openingBalance,
        }),
        signal,
      }),
    );
  },
};
