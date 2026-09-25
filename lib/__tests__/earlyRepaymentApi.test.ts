import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { normalizeEarlyRepayment, fetchInvoiceDetail } from "@/lib/api";

describe("normalizeEarlyRepayment", () => {
  it("returns null when the invoice was never offered for early repayment", () => {
    expect(normalizeEarlyRepayment(null, "inv-1")).toBeNull();
    expect(normalizeEarlyRepayment(undefined, "inv-1")).toBeNull();
    expect(normalizeEarlyRepayment({}, "inv-1")).toBeNull();
    expect(normalizeEarlyRepayment({ status: "none" }, "inv-1")).toBeNull();
  });

  it("normalises a snake_case payload", () => {
    expect(
      normalizeEarlyRepayment(
        {
          invoice_id: "inv-1",
          status: "active",
          repayment_amount: 10_800,
          original_maturity_date: "2026-12-31T00:00:00Z",
          settlement_date: "2026-07-01T00:00:00Z",
          issued_at: "2026-01-01T00:00:00Z",
          investor_return_amount: 10_800,
        },
        "inv-1"
      )
    ).toEqual({
      invoice_id: "inv-1",
      status: "active",
      repayment_amount: 10_800,
      original_maturity_date: "2026-12-31T00:00:00Z",
      settlement_date: "2026-07-01T00:00:00Z",
      issued_at: "2026-01-01T00:00:00Z",
      investor_return_amount: 10_800,
      initiated_by: undefined,
      initiated_at: undefined,
    });
  });

  it("accepts camelCase keys and numeric strings from older backends", () => {
    const normalized = normalizeEarlyRepayment(
      {
        state: "pending",
        amount: "10800.50",
        originalMaturityDate: "2026-12-31T00:00:00Z",
        settlementDate: "2026-07-01T00:00:00Z",
        issuedAt: "2026-01-01T00:00:00Z",
        investorReturnAmount: "10700",
      },
      "inv-9"
    );

    expect(normalized).not.toBeNull();
    // Falls back to the id of the invoice being fetched.
    expect(normalized?.invoice_id).toBe("inv-9");
    expect(normalized?.status).toBe("pending");
    expect(normalized?.repayment_amount).toBe(10_800.5);
    expect(normalized?.investor_return_amount).toBe(10_700);
  });

  it("degrades to zero rather than NaN for missing or unparseable amounts", () => {
    const normalized = normalizeEarlyRepayment(
      { status: "active", repayment_amount: "not-a-number" },
      "inv-1"
    );
    expect(normalized?.repayment_amount).toBe(0);
    expect(normalized?.investor_return_amount).toBeUndefined();
  });

  it("defaults missing dates to empty strings instead of undefined", () => {
    const normalized = normalizeEarlyRepayment({ status: "active" }, "inv-1");
    expect(normalized?.original_maturity_date).toBe("");
    expect(normalized?.settlement_date).toBe("");
  });
});

describe("fetchInvoiceDetail early repayment", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("normalises the early repayment record on the invoice detail response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: "inv-1",
          early_repayment: {
            status: "active",
            repayment_amount: 10800,
            original_maturity_date: "2026-12-31T00:00:00Z",
            settlement_date: "2026-07-01T00:00:00Z",
          },
        }),
      })
    );

    const detail = await fetchInvoiceDetail("inv-1");
    expect(detail.early_repayment?.status).toBe("active");
    expect(detail.early_repayment?.repayment_amount).toBe(10_800);
    expect(detail.early_repayment?.invoice_id).toBe("inv-1");
  });

  it("returns null for an invoice with no early repayment", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: "inv-1" }),
      })
    );

    const detail = await fetchInvoiceDetail("inv-1");
    expect(detail.early_repayment).toBeNull();
  });
});
