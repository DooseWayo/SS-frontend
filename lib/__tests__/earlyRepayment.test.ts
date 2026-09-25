import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  isEarlyRepaymentActive,
  computeEarlyRepaymentReturn,
  resolveInvestorReturn,
  earlyRepaymentBannerDismissalKey,
  isEarlyRepaymentBannerDismissed,
  dismissEarlyRepaymentBanner,
} from "../earlyRepayment";
import type { EarlyRepayment } from "@/lib/api";

/** 12-month term starting 2026-01-01, so "half way through" is 2026-07-01. */
const TERM = {
  issuedAt: "2026-01-01T00:00:00.000Z",
  originalMaturityDate: "2026-12-31T00:00:00.000Z",
  settlementDate: "2026-07-01T00:00:00.000Z",
};

function makeRepayment(overrides: Partial<EarlyRepayment> = {}): EarlyRepayment {
  return {
    invoice_id: "inv-1",
    status: "active",
    repayment_amount: 10_800,
    original_maturity_date: TERM.originalMaturityDate,
    settlement_date: TERM.settlementDate,
    issued_at: TERM.issuedAt,
    ...overrides,
  };
}

describe("isEarlyRepaymentActive", () => {
  it("is true for a committed early repayment", () => {
    expect(isEarlyRepaymentActive(makeRepayment({ status: "pending" }))).toBe(true);
    expect(isEarlyRepaymentActive(makeRepayment({ status: "active" }))).toBe(true);
  });

  it("is false when the invoice was never offered for early repayment", () => {
    expect(isEarlyRepaymentActive(null)).toBe(false);
    expect(isEarlyRepaymentActive(undefined)).toBe(false);
  });

  it("is false once the repayment is done or cancelled", () => {
    expect(isEarlyRepaymentActive(makeRepayment({ status: "settled" }))).toBe(false);
    expect(isEarlyRepaymentActive(makeRepayment({ status: "cancelled" }))).toBe(false);
  });
});

describe("computeEarlyRepaymentReturn", () => {
  it("prorates the yield over the part of the term actually elapsed", () => {
    // 1000 principal, 8% full-term yield, settled at the halfway point.
    const returned = computeEarlyRepaymentReturn({
      ...TERM,
      principal: 1000,
      yieldPercentage: 8,
    });
    // ~half the term elapsed earns ~half the 80 XLM yield.
    expect(returned).toBeGreaterThan(1035);
    expect(returned).toBeLessThan(1045);
  });

  it("caps at the full-term yield when settlement is at or past maturity", () => {
    const returned = computeEarlyRepaymentReturn({
      ...TERM,
      settlementDate: "2027-06-01T00:00:00.000Z",
      principal: 1000,
      yieldPercentage: 8,
    });
    expect(returned).toBe(1080);
  });

  it("returns zero for a non-positive principal", () => {
    expect(
      computeEarlyRepaymentReturn({ ...TERM, principal: 0, yieldPercentage: 8 })
    ).toBe(0);
    expect(
      computeEarlyRepaymentReturn({ ...TERM, principal: -5, yieldPercentage: 8 })
    ).toBe(0);
  });

  it("returns the principal when the term cannot be measured", () => {
    // Missing issued_at: there is no term to prorate over, so no yield is claimed.
    expect(
      computeEarlyRepaymentReturn({
        issuedAt: "",
        originalMaturityDate: TERM.originalMaturityDate,
        settlementDate: TERM.settlementDate,
        principal: 1000,
        yieldPercentage: 8,
      })
    ).toBe(1000);
  });

  it("returns the principal when a date is unparseable", () => {
    expect(
      computeEarlyRepaymentReturn({
        ...TERM,
        settlementDate: "not-a-date",
        principal: 1000,
        yieldPercentage: 8,
      })
    ).toBe(1000);
  });

  it("assumes a zero yield when the invoice has none", () => {
    expect(computeEarlyRepaymentReturn({ ...TERM, principal: 1000 })).toBe(1000);
  });
});

describe("resolveInvestorReturn", () => {
  it("returns zero when the investor holds no position", () => {
    expect(
      resolveInvestorReturn({
        repayment: makeRepayment({ investor_return_amount: 10_800 }),
        principal: 0,
        raised: 10_000,
      })
    ).toBe(0);
  });

  it("uses the backend figure when it is supplied", () => {
    // Investor holds half the invoice, so half of the 10,800 credited back.
    const returned = resolveInvestorReturn({
      repayment: makeRepayment({ investor_return_amount: 10_800 }),
      principal: 5_000,
      raised: 10_000,
    });
    expect(returned).toBe(5_400);
  });

  it("falls back to the prorated yield when the backend figure is missing", () => {
    const returned = resolveInvestorReturn({
      repayment: makeRepayment({ investor_return_amount: undefined }),
      principal: 10_000,
      raised: 10_000,
      yieldPercentage: 8,
    });
    // Sole investor of a 10,000 invoice settled halfway through an 8% term:
    // 10,000 principal plus roughly half of the 800 XLM yield.
    expect(returned).toBeGreaterThan(10_350);
    expect(returned).toBeLessThan(10_450);
  });

  it("truncates the share so the sum of shares never exceeds the pot", () => {
    // Three equal investors splitting 100: each gets floor(33.33) = 33, and the
    // 1 XLM remainder stays in the treasury rather than being credited.
    const returned = resolveInvestorReturn({
      repayment: makeRepayment({ investor_return_amount: 100 }),
      principal: 1,
      raised: 3,
    });
    expect(returned).toBe(33);
  });

  it("returns zero when nothing was raised", () => {
    expect(
      resolveInvestorReturn({
        repayment: makeRepayment({ investor_return_amount: 10_800 }),
        principal: 1_000,
        raised: 0,
      })
    ).toBe(0);
  });
});

describe("early repayment banner dismissal", () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => sessionStorage.clear());

  it("keys the dismissal per invoice", () => {
    expect(earlyRepaymentBannerDismissalKey("inv-1")).not.toBe(
      earlyRepaymentBannerDismissalKey("inv-2")
    );
  });

  it("is not dismissed until acknowledged", () => {
    expect(isEarlyRepaymentBannerDismissed("inv-1")).toBe(false);
  });

  it("remembers the acknowledgement for the rest of the session", () => {
    dismissEarlyRepaymentBanner("inv-1");
    expect(isEarlyRepaymentBannerDismissed("inv-1")).toBe(true);
    expect(sessionStorage.getItem(earlyRepaymentBannerDismissalKey("inv-1"))).toBe("true");
  });

  it("does not silence the banner for a different invoice", () => {
    dismissEarlyRepaymentBanner("inv-1");
    expect(isEarlyRepaymentBannerDismissed("inv-2")).toBe(false);
  });
});
