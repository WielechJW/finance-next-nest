import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api-client";
import AuthForm from "./auth-form";

const mocks = vi.hoisted(() => ({
  register: vi.fn(),
  login: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("@/lib/auth-api", () => ({ authApi: { register: mocks.register } }));
vi.mock("./session-provider", () => ({
  useSession: () => ({ store: { login: mocks.login } }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace, refresh: mocks.refresh }),
}));

const email = "anna@example.com";
const password = "  Moje testowe hasło 123!  ";

async function fill(mode: "login" | "register") {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("E-mail"), email);
  await user.type(screen.getByLabelText("Hasło"), password);
  if (mode === "register")
    await user.type(screen.getByLabelText("Powtórz hasło"), password);
  return user;
}

describe("Authentication forms", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.register.mockResolvedValue({});
    mocks.login.mockResolvedValue({});
  });

  it("registers without sending confirmation and redirects to the login notice", async () => {
    render(<AuthForm mode="register" />);
    const user = await fill("register");
    await user.click(screen.getByRole("button", { name: "Zarejestruj się" }));
    await waitFor(() =>
      expect(mocks.replace).toHaveBeenCalledWith("/login?registered=1"),
    );
    expect(mocks.register).toHaveBeenCalledWith(
      { email, password },
      expect.any(AbortSignal),
    );
    expect((screen.getByLabelText("Hasło") as HTMLInputElement).value).toBe("");
  });

  it("reports a duplicate email and keeps the entered values", async () => {
    mocks.register.mockRejectedValueOnce(new ApiError(409, "Conflict"));
    render(<AuthForm mode="register" />);
    const user = await fill("register");
    await user.click(screen.getByRole("button", { name: "Zarejestruj się" }));
    await screen.findByText("Ten adres e-mail jest już zajęty.");
    expect((screen.getByLabelText("Hasło") as HTMLInputElement).value).toBe(
      password,
    );
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("shows invalid login credentials without navigating away", async () => {
    mocks.login.mockRejectedValueOnce(
      new ApiError(401, "Nieprawidłowy e-mail lub hasło."),
    );
    render(<AuthForm mode="login" />);
    const user = await fill("login");
    await user.click(screen.getByRole("button", { name: "Zaloguj się" }));
    await screen.findByText("Nieprawidłowy e-mail lub hasło.");
    expect((screen.getByLabelText("E-mail") as HTMLInputElement).value).toBe(
      email,
    );
    expect((screen.getByLabelText("Hasło") as HTMLInputElement).value).toBe(
      password,
    );
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("keeps a failed network request retryable", async () => {
    mocks.login.mockRejectedValueOnce(
      new ApiError(0, "Brak połączenia. Spróbuj ponownie."),
    );
    render(<AuthForm mode="login" />);
    const user = await fill("login");
    await user.click(screen.getByRole("button", { name: "Zaloguj się" }));
    await screen.findByText("Brak połączenia. Spróbuj ponownie.");
    expect(
      (screen.getByRole("button", { name: "Zaloguj się" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    await user.click(screen.getByRole("button", { name: "Zaloguj się" }));
    await waitFor(() =>
      expect(mocks.replace).toHaveBeenCalledWith("/dashboard"),
    );
  });

  it("blocks simultaneous submissions before the first response", async () => {
    let resolve!: () => void;
    mocks.login.mockReturnValueOnce(
      new Promise<void>((done) => {
        resolve = done;
      }),
    );
    render(<AuthForm mode="login" />);
    await fill("login");
    const form = screen
      .getByRole("button", { name: "Zaloguj się" })
      .closest("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(mocks.login).toHaveBeenCalledTimes(1);
    expect(
      (screen.getByRole("button", { name: "Logowanie…" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    resolve();
    await waitFor(() =>
      expect(mocks.replace).toHaveBeenCalledWith("/dashboard"),
    );
  });

  it("checks registration length and confirmation before sending data", async () => {
    render(<AuthForm mode="register" />);
    fireEvent.change(screen.getByLabelText("E-mail"), {
      target: { value: email },
    });
    fireEvent.change(screen.getByLabelText("Hasło"), {
      target: { value: "short" },
    });
    fireEvent.change(screen.getByLabelText("Powtórz hasło"), {
      target: { value: "different" },
    });
    fireEvent.submit(
      screen.getByRole("button", { name: "Zarejestruj się" }).closest("form")!,
    );
    expect(
      screen.getByText("Hasło musi mieć co najmniej 15 znaków."),
    ).toBeDefined();
    expect(screen.getByText("Hasła nie są zgodne.")).toBeDefined();
    expect(mocks.register).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByLabelText("Hasło")),
    );
  });

  it("shows the registration confirmation on the login page", () => {
    render(<AuthForm mode="login" registered />);
    expect(screen.getByRole("status").textContent).toContain(
      "Konto zostało utworzone",
    );
  });

  it("rejects a pasted long password without silently truncating it", async () => {
    render(<AuthForm mode="register" />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("E-mail"), email);
    await user.click(screen.getByLabelText("Hasło"));
    await user.paste("x".repeat(129));
    await user.click(screen.getByLabelText("Powtórz hasło"));
    await user.paste("x".repeat(129));
    await user.click(screen.getByRole("button", { name: "Zarejestruj się" }));
    expect(
      (screen.getByLabelText("Hasło") as HTMLInputElement).value,
    ).toHaveLength(129);
    expect(
      screen.getByText("Hasło może mieć najwyżej 128 znaków."),
    ).toBeDefined();
    expect(mocks.register).not.toHaveBeenCalled();
  });
});
