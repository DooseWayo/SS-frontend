import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { EarlyRepaymentBanner } from "../EarlyRepaymentBanner";
import { earlyRepaymentBannerDismissalKey } from "@/lib/earlyRepayment";
import type { EarlyRepayment } from "@/lib/api";

const MY_ADDRESS = "Ginvestor0001";
const OTHER_ADDRESS = "Ginvestor0002";

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ address: MY_ADDRESS, jwt: null, isConnecting: false, logout: vi.fn() }),
}));

const REPAYMENT: EarlyRepayment = {
  invoice_id: "inv-1",
  status: "active",
  repayment_amount: 10_800,
  original_maturity_date: "2026-12-31T00:00:00.000Z",
  settlement_date: "2026-07-01T00:00:00.000Z",
  issued_at: "2026-01-01T00:00:00.000Z",
  investor_return_amount: 10_800,
};

const INVESTORS = [
  { address: MY_ADDRESS, amount: 4_000 },
  { address: OTHER_ADDRESS, amount: 6_000 },
];

/** Formats a date the same way the banner does, for exact-text assertions. */
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function renderBanner(props: Partial<React.ComponentProps<typeof EarlyRepaymentBanner>> = {}) {
  return render(
    <EarlyRepaymentBanner
      invoiceId="inv-1"
      earlyRepayment={REPAYMENT}
      investors={INVESTORS}
      raised={10_000}
      {...props}
    />
  );
}

describe("EarlyRepaymentBanner", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  describe("visibility gating", () => {
    it("renders nothing when the invoice has no early repayment", async () => {
      renderBanner({ earlyRepayment: null });
      await waitFor(() =>
        expect(screen.queryByTestId("early-repayment-banner")).not.toBeInTheDocument()
      );
    });

    it("renders nothing when the early repayment field is absent", async () => {
      renderBanner({ earlyRepayment: undefined });
      await waitFor(() =>
        expect(screen.queryByTestId("early-repayment-banner")).not.toBeInTheDocument()
      );
    });

    it("renders nothing once the repayment is settled", async () => {
      renderBanner({ earlyRepayment: { ...REPAYMENT, status: "settled" } });
      await waitFor(() =>
        expect(screen.queryByTestId("early-repayment-banner")).not.toBeInTheDocument()
      );
    });

    it("renders nothing when the repayment was cancelled", async () => {
      renderBanner({ earlyRepayment: { ...REPAYMENT, status: "cancelled" } });
      await waitFor(() =>
        expect(screen.queryByTestId("early-repayment-banner")).not.toBeInTheDocument()
      );
    });

    it("renders for a repayment that is still pending", async () => {
      renderBanner({ earlyRepayment: { ...REPAYMENT, status: "pending" } });
      expect(await screen.findByTestId("early-repayment-banner")).toBeInTheDocument();
    });
  });

  describe("repayment and settlement timeline", () => {
    it("shows the early repayment amount", async () => {
      renderBanner();
      expect(await screen.findByTestId("early-repayment-amount")).toHaveTextContent(
        "10,800.00 XLM"
      );
    });

    it("shows the original maturity date", async () => {
      renderBanner();
      expect(
        await screen.findByTestId("early-repayment-original-maturity")
      ).toHaveTextContent(formatDate(REPAYMENT.original_maturity_date));
    });

    it("shows the new settlement date", async () => {
      renderBanner();
      expect(await screen.findByTestId("early-repayment-settlement-date")).toHaveTextContent(
        formatDate(REPAYMENT.settlement_date)
      );
    });

    it("shows the new settlement date before the original maturity date", async () => {
      renderBanner();
      const settlement = await screen.findByTestId("early-repayment-settlement-date");
      const maturity = screen.getByTestId("early-repayment-original-maturity");
      expect(
        new Date(settlement.textContent ?? "").getTime()
      ).toBeLessThan(new Date(maturity.textContent ?? "").getTime());
    });

    it("falls back to a placeholder when a date is missing", async () => {
      renderBanner({ earlyRepayment: { ...REPAYMENT, settlement_date: "" } });
      expect(await screen.findByTestId("early-repayment-settlement-date")).toHaveTextContent(
        "—"
      );
    });
  });

  describe("investor return", () => {
    it("shows the signed-in investor's pro-rata share of the repayment", async () => {
      // Backend credits 10,800 across 10,000 raised; this investor put in 4,000.
      renderBanner();
      expect(await screen.findByTestId("early-repayment-investor-return")).toHaveTextContent(
        "4,320.00 XLM"
      );
    });

    it("prorates the yield when the backend does not supply a return figure", async () => {
      renderBanner({
        earlyRepayment: { ...REPAYMENT, investor_return_amount: undefined },
        yieldPercentage: 8,
      });
      const shown = await screen.findByTestId("early-repayment-investor-return");
      // 4,000 principal plus ~half of the 320 XLM full-term yield.
      expect(shown.textContent).toMatch(/4,1\d\d\.\d\d XLM/);
    });

    it("omits the investor return when the wallet holds no position", async () => {
      renderBanner({ investors: [{ address: OTHER_ADDRESS, amount: 10_000 }] });
      await screen.findByTestId("early-repayment-banner");
      expect(
        screen.queryByTestId("early-repayment-investor-return")
      ).not.toBeInTheDocument();
    });
  });

  describe("dismissal", () => {
    it("hides the banner when dismissed", async () => {
      renderBanner();
      fireEvent.click(await screen.findByTestId("dismiss-early-repayment-btn"));
      expect(screen.queryByTestId("early-repayment-banner")).not.toBeInTheDocument();
    });

    it("records the acknowledgement for the session", async () => {
      renderBanner();
      fireEvent.click(await screen.findByTestId("dismiss-early-repayment-btn"));
      expect(sessionStorage.getItem(earlyRepaymentBannerDismissalKey("inv-1"))).toBe("true");
    });

    it("does not reappear when the page is revisited in the same session", async () => {
      const { unmount } = renderBanner();
      fireEvent.click(await screen.findByTestId("dismiss-early-repayment-btn"));
      unmount();

      renderBanner();
      await waitFor(() =>
        expect(screen.queryByTestId("early-repayment-banner")).not.toBeInTheDocument()
      );
    });

    it("does not silence the banner for a different invoice", async () => {
      const { unmount } = renderBanner({ invoiceId: "inv-1" });
      fireEvent.click(await screen.findByTestId("dismiss-early-repayment-btn"));
      unmount();

      renderBanner({ invoiceId: "inv-2" });
      expect(await screen.findByTestId("early-repayment-banner")).toBeInTheDocument();
    });

    it("has an accessible label on the dismiss control", async () => {
      renderBanner();
      expect(
        await screen.findByLabelText("Dismiss early repayment notice")
      ).toBeInTheDocument();
    });
  });

  it("announces itself as a status region", async () => {
    renderBanner();
    expect(await screen.findByRole("status")).toBeInTheDocument();
  });
});
