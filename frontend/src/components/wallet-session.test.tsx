import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProtectedDashboard } from "./protected-dashboard";
import { SessionProvider } from "./session-provider";
import { WalletPanel } from "./wallet-panel";

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard/wallet",
  useRouter: () => router,
}));

describe("Wallet session integration", () => {
  it("redirects to login when the protected wallet request returns 401", async () => {
    router.replace.mockReset();
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockImplementation(async (input) => {
        const session = String(input).endsWith("/auth/me");
        return new Response(
          JSON.stringify(
            session
              ? {
                  id: "a",
                  email: "anna@example.invalid",
                  createdAt: "2026-11-03",
                }
              : { message: "Zaloguj się." },
          ),
          { status: session ? 200 : 401 },
        );
      }),
    );
    render(
      <SessionProvider>
        <ProtectedDashboard>
          <WalletPanel />
        </ProtectedDashboard>
      </SessionProvider>,
    );
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/login"));
  });
});
