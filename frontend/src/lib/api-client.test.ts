import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  UNAUTHORIZED_EVENT,
  apiRequest,
  invalidateAuthRequests,
} from "./api-client";
import { authApi } from "./auth-api";

const user = {
  id: "user-id",
  email: "anna@example.com",
  createdAt: "2026-10-29T10:00:00.000Z",
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status });

describe("API client", () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:3001");
  });

  it("sends credentials, disables caching and excludes confirmation/password hashes from the public contract", async () => {
    fetchMock.mockResolvedValueOnce(
      json({ ...user, passwordHash: "private-hash" }),
    );
    const data = {
      email: user.email,
      password: "  Exact password 123  ",
      confirmPassword: "unused",
    };
    expect(await authApi.register(data)).toEqual(user);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://localhost:3001/auth/register");
    expect(init).toMatchObject({
      credentials: "include",
      cache: "no-store",
      method: "POST",
    });
    expect(JSON.parse(init!.body as string)).toEqual({
      email: data.email,
      password: data.password,
    });
    expect(new Headers(init!.headers).get("Content-Type")).toBe(
      "application/json",
    );
  });

  it("accepts an empty logout response", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(authApi.logout()).resolves.toBeUndefined();
  });

  it("preserves validation messages and status codes", async () => {
    fetchMock.mockResolvedValueOnce(
      json({ message: ["Błędny e-mail.", "Podaj hasło."] }, 400),
    );
    await expect(apiRequest("/auth/register")).rejects.toMatchObject({
      status: 400,
      message: "Błędny e-mail. Podaj hasło.",
    });
  });

  it("does not expose technical server failures", async () => {
    fetchMock.mockResolvedValueOnce(
      json({ message: "database password=private" }, 500),
    );
    await expect(apiRequest("/auth/login")).rejects.toEqual(
      new ApiError(500, "Serwer nie mógł wykonać operacji. Spróbuj ponownie."),
    );
  });

  it("replaces technical 403 errors and preserves useful 429 messages without invalidating the session", async () => {
    const listener = vi.fn();
    window.addEventListener(UNAUTHORIZED_EVENT, listener);
    try {
      fetchMock.mockResolvedValueOnce(
        json(
          {
            message: "Cross-origin request detected from Sec-Fetch-Site header",
          },
          403,
        ),
      );
      await expect(
        apiRequest("/auth/logout", { method: "POST" }),
      ).rejects.toMatchObject({
        status: 403,
        message:
          "Serwer odrzucił żądanie ze względów bezpieczeństwa. Odśwież stronę i spróbuj ponownie.",
      });
      fetchMock.mockResolvedValueOnce(
        json({ message: "Zbyt wiele prób. Spróbuj ponownie za 60 s." }, 429),
      );
      await expect(
        apiRequest("/auth/login", { method: "POST" }),
      ).rejects.toMatchObject({
        status: 429,
        message: "Zbyt wiele prób. Spróbuj ponownie za 60 s.",
      });
      expect(listener).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener(UNAUTHORIZED_EVENT, listener);
    }
  });

  it.each([{}, { message: "" }, { message: [] }])(
    "provides a fallback for a 429 without a message (%#)",
    async (payload) => {
      fetchMock.mockResolvedValueOnce(json(payload, 429));
      await expect(apiRequest("/auth/login")).rejects.toMatchObject({
        status: 429,
        message: "Zbyt wiele prób. Odczekaj chwilę i spróbuj ponownie.",
      });
    },
  );

  it("reports a network failure with a retryable message", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(apiRequest("/auth/me")).rejects.toMatchObject({
      status: 0,
      message: expect.stringContaining("Sprawdź połączenie"),
    });
  });

  it("rejects malformed user responses", async () => {
    fetchMock.mockResolvedValueOnce(json({ id: "only-an-id" }));
    await expect(authApi.getCurrentUser()).rejects.toMatchObject({
      status: 502,
    });
  });

  it("notifies protected requests about 401 without treating invalid login credentials as a global logout", async () => {
    const listener = vi.fn();
    window.addEventListener(UNAUTHORIZED_EVENT, listener);
    try {
      fetchMock.mockResolvedValueOnce(json({ message: "Unauthorized" }, 401));
      await expect(
        authApi.login({ email: user.email, password: "wrong" }),
      ).rejects.toMatchObject({ status: 401 });
      expect(listener).not.toHaveBeenCalled();
      fetchMock.mockResolvedValueOnce(json({ message: "Unauthorized" }, 401));
      await expect(apiRequest("/wallet")).rejects.toMatchObject({
        status: 401,
      });
      expect(listener).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(UNAUTHORIZED_EVENT, listener);
    }
  });

  it("ignores a delayed 401 from before an account change", async () => {
    let resolve!: (response: Response) => void;
    fetchMock.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const listener = vi.fn();
    window.addEventListener(UNAUTHORIZED_EVENT, listener);
    try {
      const pending = apiRequest("/wallet");
      invalidateAuthRequests();
      resolve(json({ message: "Unauthorized" }, 401));
      await expect(pending).rejects.toMatchObject({ status: 401 });
      expect(listener).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener(UNAUTHORIZED_EVENT, listener);
    }
  });

  it("supports cancelling obsolete requests", async () => {
    fetchMock.mockImplementationOnce(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init!.signal!.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    );
    const controller = new AbortController();
    const pending = apiRequest("/auth/me", { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("times out unresponsive requests", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementationOnce(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init!.signal!.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    );
    const expectation = expect(apiRequest("/auth/me")).rejects.toMatchObject({
      status: 0,
      message: "Serwer nie odpowiada. Spróbuj ponownie.",
    });
    await vi.advanceTimersByTimeAsync(15000);
    await expectation;
  });
});
