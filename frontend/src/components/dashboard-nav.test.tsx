import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DashboardNav } from "./dashboard-nav";

const location = vi.hoisted(() => ({ pathname: "/dashboard/wallet" }));
vi.mock("next/navigation", () => ({ usePathname: () => location.pathname }));

describe("Dashboard navigation", () => {
  it("marks the wallet link as the current page", () => {
    location.pathname = "/dashboard/wallet";
    render(<DashboardNav />);
    expect(
      screen.getByRole("navigation", { name: "Nawigacja panelu" }),
    ).toBeDefined();
    const link = screen.getByRole("link", { name: "Portfel" });
    expect(link.getAttribute("href")).toBe("/dashboard/wallet");
    expect(link.getAttribute("aria-current")).toBe("page");
  });

  it("does not mark the wallet as active for another page", () => {
    location.pathname = "/dashboard/transactions";
    render(<DashboardNav />);
    expect(
      screen
        .getByRole("link", { name: "Portfel" })
        .getAttribute("aria-current"),
    ).toBeNull();
    const transactions = screen.getByRole("link", { name: "Transakcje" });
    expect(transactions.getAttribute("href")).toBe("/dashboard/transactions");
    expect(transactions.getAttribute("aria-current")).toBe("page");
  });
});
