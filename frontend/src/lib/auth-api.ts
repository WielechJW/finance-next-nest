import { ApiError, apiRequest } from "./api-client";
import type { Credentials, UserDto } from "./auth-types";

function parseUser(value: unknown): UserDto {
  if (
    !value ||
    typeof value !== "object" ||
    !("id" in value) ||
    !("email" in value) ||
    !("createdAt" in value) ||
    typeof value.id !== "string" ||
    typeof value.email !== "string" ||
    typeof value.createdAt !== "string"
  ) {
    throw new ApiError(
      502,
      "Serwer zwrócił nieprawidłowe dane użytkownika. Spróbuj ponownie.",
    );
  }
  return { id: value.id, email: value.email, createdAt: value.createdAt };
}

export const authApi = {
  async register(data: Credentials, signal?: AbortSignal): Promise<UserDto> {
    return parseUser(
      await apiRequest<unknown>("/auth/register", {
        method: "POST",
        body: JSON.stringify({ email: data.email, password: data.password }),
        signal,
        notifyUnauthorized: false,
      }),
    );
  },
  async login(data: Credentials, signal?: AbortSignal): Promise<UserDto> {
    return parseUser(
      await apiRequest<unknown>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: data.email, password: data.password }),
        signal,
        notifyUnauthorized: false,
      }),
    );
  },
  async getCurrentUser(signal?: AbortSignal): Promise<UserDto> {
    return parseUser(
      await apiRequest<unknown>("/auth/me", {
        signal,
        notifyUnauthorized: false,
      }),
    );
  },
  logout(): Promise<void> {
    return apiRequest<void>("/auth/logout", { method: "POST" });
  },
};

export type AuthApi = typeof authApi;
