import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { categories, wallet, historyPage } from "../../test/transactions";
import { ProtectedDashboard } from "./protected-dashboard";
import { SessionProvider } from "./session-provider";
import { TransactionsPanel } from "./transactions-panel";

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard/transactions",
  useRouter: () => router,
}));

describe("Transaction session integration", () => {
  it.each(["categories", "create", "history"] as const)(
    "redirects to login after a 401 during %s",
    async (operation) => {
      router.replace.mockReset();
      vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:3001");
      vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
          const path = new URL(String(input)).pathname;
          const unauthorized =
            (operation === "categories" && path === "/categories") ||
            (path === "/transactions" &&
              ((operation === "create" && init?.method === "POST") ||
                operation === "history"));
          return new Response(
            JSON.stringify(
              unauthorized
                ? { message: "Zaloguj się." }
                : path === "/auth/me"
                  ? {
                      id: "a",
                      email: "anna@example.invalid",
                      createdAt: "2026-11-12",
                    }
                  : path === "/categories"
                    ? categories
                    : path === "/transactions"
                      ? historyPage(1, 0)
                      : wallet,
            ),
            { status: unauthorized ? 401 : 200 },
          );
        }),
      );
      render(
        <SessionProvider>
          <ProtectedDashboard>
            <TransactionsPanel />
          </ProtectedDashboard>
        </SessionProvider>,
      );
      if (operation === "create") {
        await within(
          await screen.findByRole("form", { name: "Nowa transakcja" }),
        ).findByRole("option", { name: "Jedzenie" });
        fireEvent.change(screen.getByLabelText("Kwota"), {
          target: { value: "12,50" },
        });
        fireEvent.change(screen.getByLabelText("Tytuł"), {
          target: { value: "Zakupy" },
        });
        fireEvent.change(screen.getByLabelText("Kategoria"), {
          target: { value: categories[0]!.id },
        });
        fireEvent.submit(screen.getByRole("form", { name: "Nowa transakcja" }));
      }
      await waitFor(() =>
        expect(router.replace).toHaveBeenCalledWith("/login"),
      );
      expect(screen.queryByText("Wydatek zapisany.")).toBeNull();
    },
  );
});
