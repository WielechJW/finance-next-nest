import { describe, expect, it, vi } from "vitest";
import { ApiError } from "./api-client";
import type { AuthApi } from "./auth-api";
import type { UserDto } from "./auth-types";
import { SessionStore } from "./session-store";

const user = {
  id: "one",
  email: "one@example.com",
  createdAt: "2026-10-29T10:00:00.000Z",
};
const another = { ...user, id: "two", email: "two@example.com" };

function client() {
  return {
    register: vi.fn<AuthApi["register"]>().mockResolvedValue(user),
    login: vi.fn<AuthApi["login"]>().mockResolvedValue(user),
    getCurrentUser: vi.fn<AuthApi["getCurrentUser"]>().mockResolvedValue(user),
    logout: vi.fn<AuthApi["logout"]>().mockResolvedValue(undefined),
  } satisfies AuthApi;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe("Session state", () => {
  it("distinguishes a missing session from a connection error and allows retrying", async () => {
    const api = client();
    const store = new SessionStore(api);
    api.getCurrentUser.mockRejectedValueOnce(new ApiError(401, "Unauthorized"));
    await store.refresh();
    expect(store.getSnapshot()).toMatchObject({
      status: "unauthenticated",
      user: null,
    });
    api.getCurrentUser.mockRejectedValueOnce(new ApiError(0, "Offline"));
    await store.refresh();
    expect(store.getSnapshot()).toMatchObject({ status: "error", user: null });
    await store.refresh();
    expect(store.getSnapshot()).toMatchObject({
      status: "authenticated",
      user,
    });
  });

  it("checks that a session cookie works before reporting a successful login", async () => {
    const api = client();
    const store = new SessionStore(api);
    api.getCurrentUser.mockRejectedValueOnce(new ApiError(401, "Unauthorized"));
    await expect(
      store.login({ email: user.email, password: "password" }),
    ).rejects.toMatchObject({ status: 0 });
    expect(store.getSnapshot().status).toBe("unauthenticated");
  });

  it("does not restore a user from a delayed request after logout", async () => {
    const api = client();
    const store = new SessionStore(api);
    const old = deferred<UserDto>();
    api.getCurrentUser.mockReturnValueOnce(old.promise);
    const pending = store.refresh();
    await store.logout();
    old.resolve(user);
    await pending;
    expect(store.getSnapshot()).toMatchObject({
      status: "unauthenticated",
      user: null,
    });
  });

  it("does not overwrite a newly logged-in account with an older response", async () => {
    const api = client();
    const store = new SessionStore(api);
    const old = deferred<UserDto>();
    api.getCurrentUser
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce(another);
    const pending = store.refresh();
    await store.login({ email: another.email, password: "password" });
    old.resolve(user);
    await pending;
    expect(store.getSnapshot()).toMatchObject({
      status: "authenticated",
      user: another,
    });
  });

  it("hides the previous user's data while refreshing or handling a protected 401", async () => {
    const store = new SessionStore(client());
    await store.refresh();
    store.invalidate();
    expect(store.getSnapshot()).toMatchObject({
      status: "loading",
      user: null,
    });
    store.markUnauthorized();
    expect(store.getSnapshot()).toMatchObject({
      status: "unauthenticated",
      user: null,
    });
  });

  it("does not pretend a failed logout succeeded", async () => {
    const api = client();
    const store = new SessionStore(api);
    await store.refresh();
    api.logout.mockRejectedValueOnce(new ApiError(500, "Unavailable"));
    await expect(store.logout()).rejects.toMatchObject({ status: 500 });
    expect(store.getSnapshot()).toMatchObject({
      status: "authenticated",
      user,
    });
  });

  it("blocks concurrent authentication mutations", async () => {
    const api = client();
    const pending = deferred<UserDto>();
    api.login.mockReturnValueOnce(pending.promise);
    const store = new SessionStore(api);
    const login = store.login({ email: user.email, password: "password" });
    await expect(store.logout()).rejects.toBeInstanceOf(ApiError);
    expect(api.logout).not.toHaveBeenCalled();
    pending.resolve(user);
    await login;
  });

  it("cancels obsolete work when the provider is unmounted", async () => {
    const api = client();
    const pending = deferred<UserDto>();
    api.getCurrentUser.mockReturnValueOnce(pending.promise);
    const store = new SessionStore(api);
    const request = store.refresh();
    store.cancel();
    pending.resolve(user);
    await request;
    expect(store.getSnapshot()).toMatchObject({
      status: "loading",
      user: null,
    });
  });
});
