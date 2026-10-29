export const UNAUTHORIZED_EVENT = "finance:unauthorized";
let authRevision = 0;

export function invalidateAuthRequests(): void {
  authRevision++;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

type ApiOptions = Omit<RequestInit, "cache" | "credentials"> & {
  notifyUnauthorized?: boolean;
};

function requestUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
  try {
    const url = new URL(base);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      throw new Error("Invalid API URL");
    }
    return `${base.replace(/\/+$/, "")}${path}`;
  } catch {
    throw new ApiError(
      0,
      "Nie można połączyć się z serwerem. Spróbuj ponownie później.",
    );
  }
}

function errorMessage(status: number, payload: unknown): string {
  if (status >= 500)
    return "Serwer nie mógł wykonać operacji. Spróbuj ponownie.";
  if (payload && typeof payload === "object" && "message" in payload) {
    const message = payload.message;
    if (typeof message === "string") return message;
    if (
      Array.isArray(message) &&
      message.every((value) => typeof value === "string")
    ) {
      return message.join(" ");
    }
  }
  return "Nie udało się wykonać operacji. Spróbuj ponownie.";
}

export async function apiRequest<T>(
  path: string,
  options: ApiOptions = {},
): Promise<T> {
  const { notifyUnauthorized = true, signal, ...init } = options;
  const revision = authRevision;
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener("abort", cancel, { once: true });
  if (signal?.aborted) controller.abort();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 15000);

  try {
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    if (init.body && !headers.has("Content-Type"))
      headers.set("Content-Type", "application/json");
    const response = await fetch(requestUrl(path), {
      ...init,
      headers,
      signal: controller.signal,
      credentials: "include",
      cache: "no-store",
    });
    if (signal?.aborted)
      throw new DOMException("Żądanie anulowane.", "AbortError");
    if (response.status === 204) return undefined as T;

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      payload = undefined;
    }
    if (signal?.aborted || timedOut)
      throw new DOMException("Żądanie anulowane.", "AbortError");

    if (!response.ok) {
      if (
        response.status === 401 &&
        notifyUnauthorized &&
        revision === authRevision &&
        typeof window !== "undefined"
      ) {
        window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
      }
      throw new ApiError(
        response.status,
        errorMessage(response.status, payload),
      );
    }
    if (payload === undefined)
      throw new ApiError(
        502,
        "Serwer zwrócił nieprawidłową odpowiedź. Spróbuj ponownie.",
      );
    return payload as T;
  } catch (error) {
    if (signal?.aborted)
      throw new DOMException("Żądanie anulowane.", "AbortError");
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      0,
      timedOut
        ? "Serwer nie odpowiada. Spróbuj ponownie."
        : "Nie można połączyć się z serwerem. Sprawdź połączenie i spróbuj ponownie.",
    );
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", cancel);
  }
}
