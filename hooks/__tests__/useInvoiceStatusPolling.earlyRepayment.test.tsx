import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useInvoiceStatusPolling, EARLY_REPAYMENT_MESSAGE } from "../useInvoiceStatusPolling";
import { UNREAD_COUNT_QUERY_KEY } from "@/hooks/useNotifications";
import * as api from "@/lib/api";
import { toast } from "sonner";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

/** A funded invoice with no early repayment unless `overrides` says otherwise. */
function invoiceDetail(overrides: Partial<api.InvoiceDetail> = {}): api.InvoiceDetail {
  return {
    id: "inv-1",
    title: "Test Invoice",
    seller: "Seller",
    amount: 10_000,
    raised: 10_000,
    investor_count: 2,
    status: "funded",
    due_date: "2026-12-31T00:00:00Z",
    description: "",
    investors: [],
    document_url: "",
    early_repayment: null,
    ...overrides,
  };
}

const ACTIVE_REPAYMENT: api.EarlyRepayment = {
  invoice_id: "inv-1",
  status: "active",
  repayment_amount: 10_800,
  original_maturity_date: "2026-12-31T00:00:00Z",
  settlement_date: "2026-07-01T00:00:00Z",
};

describe("useInvoiceStatusPolling — early repayment trigger", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.restoreAllMocks();
    toast.success = vi.fn() as unknown as typeof toast.success;
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
  });

  afterEach(() => {
    queryClient.clear();
  });

  it("notifies investors and bumps the badge when early repayment is triggered", async () => {
    let current = invoiceDetail();
    vi.spyOn(api, "fetchInvoiceDetail").mockImplementation(async () => current);

    // Seed a cached unread count the way the nav bell would have.
    queryClient.setQueryData(UNREAD_COUNT_QUERY_KEY, { count: 2 });

    const { result } = renderHook(
      () => useInvoiceStatusPolling({ invoiceId: "inv-1" }),
      { wrapper: createWrapper(queryClient) }
    );

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(toast.success).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(UNREAD_COUNT_QUERY_KEY)).toEqual({ count: 2 });

    // The seller initiates the early repayment; the invoice stays "funded".
    current = invoiceDetail({ early_repayment: ACTIVE_REPAYMENT });
    await act(async () => {
      await result.current.refetch();
    });

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith(EARLY_REPAYMENT_MESSAGE);
    });
    // The badge reflects the new investor notification straight away.
    expect(queryClient.getQueryData(UNREAD_COUNT_QUERY_KEY)).toEqual({ count: 3 });
  });

  it("does not notify when the invoice already had an early repayment on load", async () => {
    vi.spyOn(api, "fetchInvoiceDetail").mockResolvedValue(
      invoiceDetail({ early_repayment: ACTIVE_REPAYMENT })
    );
    queryClient.setQueryData(UNREAD_COUNT_QUERY_KEY, { count: 2 });

    const { result } = renderHook(
      () => useInvoiceStatusPolling({ invoiceId: "inv-1" }),
      { wrapper: createWrapper(queryClient) }
    );

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(toast.success).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(UNREAD_COUNT_QUERY_KEY)).toEqual({ count: 2 });
  });

  it("does not re-notify on subsequent polls of the same early repayment", async () => {
    let current = invoiceDetail();
    const fetchMock = vi.fn(async () => current);
    vi.spyOn(api, "fetchInvoiceDetail").mockImplementation(fetchMock);
    queryClient.setQueryData(UNREAD_COUNT_QUERY_KEY, { count: 2 });

    const { result } = renderHook(
      () => useInvoiceStatusPolling({ invoiceId: "inv-1" }),
      { wrapper: createWrapper(queryClient) }
    );

    await waitFor(() => expect(result.current.data).toBeDefined());

    current = invoiceDetail({ early_repayment: ACTIVE_REPAYMENT });
    await act(async () => {
      await result.current.refetch();
    });
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));

    // Two more polls, same early repayment.
    await act(async () => {
      await result.current.refetch();
      await result.current.refetch();
    });

    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData(UNREAD_COUNT_QUERY_KEY)).toEqual({ count: 3 });
  });

  it("leaves the badge alone when nothing is cached yet", async () => {
    let current = invoiceDetail();
    vi.spyOn(api, "fetchInvoiceDetail").mockImplementation(async () => current);

    const { result } = renderHook(
      () => useInvoiceStatusPolling({ invoiceId: "inv-1" }),
      { wrapper: createWrapper(queryClient) }
    );

    await waitFor(() => expect(result.current.data).toBeDefined());

    current = invoiceDetail({ early_repayment: ACTIVE_REPAYMENT });
    await act(async () => {
      await result.current.refetch();
    });

    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    // No fabricated count — the invalidate that follows fetches the real one.
    expect(queryClient.getQueryData(UNREAD_COUNT_QUERY_KEY)).toBeUndefined();
  });
});
