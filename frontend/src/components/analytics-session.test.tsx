import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SessionProvider } from "./session-provider";
import { ProtectedDashboard } from "./protected-dashboard";
import { AnalyticsPanel } from "./analytics-panel";

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard/analytics",
  useRouter: () => router,
}));
vi.mock("./analytics-charts", () => ({
  CategoryChart: () => null,
  TrendChart: () => null,
}));
describe("Analytics session integration", () => {
  it("redirects after an analytics request returns 401", async () => {
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
                  createdAt: "2026-11-13",
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
          <AnalyticsPanel />
        </ProtectedDashboard>
      </SessionProvider>,
    );
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/login"));
  });
});
