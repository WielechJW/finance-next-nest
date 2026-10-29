import { ApiError, invalidateAuthRequests, isAbortError } from "./api-client";
import { authApi, type AuthApi } from "./auth-api";
import type { Credentials, UserDto } from "./auth-types";

export type SessionState =
  | { status: "loading"; user: null; error: null }
  | { status: "authenticated"; user: UserDto; error: null }
  | { status: "unauthenticated"; user: null; error: null }
  | { status: "error"; user: null; error: string };

const LOADING: SessionState = { status: "loading", user: null, error: null };
const ANONYMOUS: SessionState = {
  status: "unauthenticated",
  user: null,
  error: null,
};

export class SessionStore {
  private state: SessionState = LOADING;
  private readonly listeners = new Set<() => void>();
  private version = 0;
  private controller?: AbortController;
  private mutation = false;
  private refreshQueued = false;
  private onChange?: () => void;

  constructor(private readonly api: AuthApi = authApi) {}

  setChangeListener(listener?: () => void): void {
    this.onChange = listener;
  }

  getSnapshot = (): SessionState => this.state;
  getServerSnapshot = (): SessionState => LOADING;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  invalidate = (): void => {
    this.begin();
    this.publish(LOADING);
  };

  markUnauthorized = (): void => {
    this.begin();
    this.publish(ANONYMOUS);
  };

  cancel = (): void => {
    this.begin();
    this.onChange = undefined;
  };

  refresh = async (): Promise<void> => {
    if (this.mutation) {
      this.refreshQueued = true;
      return;
    }
    const version = this.begin();
    const controller = new AbortController();
    this.controller = controller;
    this.publish(LOADING);
    try {
      const user = await this.api.getCurrentUser(controller.signal);
      if (version === this.version)
        this.publish({ status: "authenticated", user, error: null });
    } catch (error) {
      if (version !== this.version || isAbortError(error)) return;
      this.publish(
        error instanceof ApiError && error.status === 401
          ? ANONYMOUS
          : {
              status: "error",
              user: null,
              error:
                "Nie udało się sprawdzić sesji. Sprawdź połączenie i spróbuj ponownie.",
            },
      );
    } finally {
      if (version === this.version) this.controller = undefined;
    }
  };

  login = async (data: Credentials, signal?: AbortSignal): Promise<UserDto> => {
    if (this.mutation)
      throw new ApiError(0, "Poczekaj na zakończenie poprzedniej operacji.");
    this.mutation = true;
    const version = this.begin();
    this.publish(LOADING);
    try {
      await this.api.login(data, signal);
      // Verify that the browser accepted the cookie before showing the panel.
      let user: UserDto;
      try {
        user = await this.api.getCurrentUser(signal);
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          throw new ApiError(
            0,
            "Nie udało się utrzymać sesji. Spróbuj ponownie.",
          );
        }
        throw error;
      }
      if (version !== this.version)
        throw new DOMException("Żądanie anulowane.", "AbortError");
      this.publish({ status: "authenticated", user, error: null });
      this.onChange?.();
      return user;
    } catch (error) {
      if (version === this.version) this.publish(ANONYMOUS);
      throw error;
    } finally {
      this.finishMutation();
    }
  };

  logout = async (): Promise<void> => {
    if (this.mutation)
      throw new ApiError(0, "Poczekaj na zakończenie poprzedniej operacji.");
    this.mutation = true;
    const version = this.begin();
    try {
      await this.api.logout();
      if (version === this.version) this.publish(ANONYMOUS);
      this.onChange?.();
    } finally {
      this.finishMutation();
    }
  };

  private begin(): number {
    this.controller?.abort();
    this.controller = undefined;
    invalidateAuthRequests();
    return ++this.version;
  }

  private publish(state: SessionState): void {
    this.state = state;
    this.listeners.forEach((listener) => listener());
  }

  private finishMutation(): void {
    this.mutation = false;
    if (this.refreshQueued) {
      this.refreshQueued = false;
      void this.refresh();
    }
  }
}
