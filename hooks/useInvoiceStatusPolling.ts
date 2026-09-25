"use client";

/**
 * Real-time invoice status updates (issue #282).
 *
 * Polls the invoice status endpoint every 30 seconds with React Query's
 * refetchInterval, toasts on status transitions (exactly once per
 * transition), invalidates the relevant caches, and stops polling once the
 * invoice reaches a terminal state (settled / rejected).
 *
 * Also watches for a seller triggering an early repayment, which is a change
 * to the invoice that is independent of `status` — the invoice stays "funded"
 * throughout.
 */

import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { fetchInvoiceDetail, type Invoice, type InvoiceDetail } from "@/lib/api";
import { isEarlyRepaymentActive } from "@/lib/earlyRepayment";
import {
  NOTIFICATIONS_QUERY_KEY,
  UNREAD_COUNT_QUERY_KEY,
  bumpUnreadCount,
} from "@/hooks/useNotifications";

export const INVOICE_STATUS_POLL_INTERVAL_MS = 30_000;

/** Statuses that end the invoice lifecycle — polling stops on these. */
const TERMINAL_STATUSES = new Set<Invoice["status"]>(["settled", "rejected"]);

export function isTerminalInvoiceStatus(status: Invoice["status"]): boolean {
  return TERMINAL_STATUSES.has(status);
}

/** Toast copy per status transition shown to investors and sellers. */
export function statusChangeMessage(status: Invoice["status"]): string {
  switch (status) {
    case "funded":
      return "Invoice is fully funded 🎉";
    case "settled":
      return "Invoice has settled — returns are ready to claim";
    case "rejected":
      return "Invoice was rejected";
    default:
      return `Invoice status changed to ${status}`;
  }
}

/** Toast copy when a seller initiates an early repayment on a funded invoice. */
export const EARLY_REPAYMENT_MESSAGE =
  "Seller initiated early repayment — this invoice now settles sooner";

interface UseInvoiceStatusPollingOptions {
  invoiceId: string;
  /** Disable polling entirely (e.g. during tests or before an id exists). */
  enabled?: boolean;
}

export function useInvoiceStatusPolling({
  invoiceId,
  enabled = true,
}: UseInvoiceStatusPollingOptions) {
  const queryClient = useQueryClient();
  const previousStatusRef = useRef<Invoice["status"] | null>(null);
  const previousEarlyRepaymentRef = useRef<boolean | null>(null);
  const notifiedTransitionsRef = useRef<Set<string>>(new Set());
  const notifiedEarlyRepaymentRef = useRef(false);

  const query = useQuery<InvoiceDetail>({
    queryKey: ["invoice", invoiceId],
    queryFn: () => fetchInvoiceDetail(invoiceId),
    enabled: enabled && Boolean(invoiceId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      // Polling stops when the invoice reaches a terminal state.
      if (status && isTerminalInvoiceStatus(status)) return false;
      return INVOICE_STATUS_POLL_INTERVAL_MS;
    },
  });

  const status = query.data?.status;
  // `null` until the first response lands, so the effect below can tell
  // "no early repayment" apart from "not loaded yet".
  const earlyRepaymentActive = query.data
    ? isEarlyRepaymentActive(query.data.early_repayment)
    : null;

  useEffect(() => {
    if (!status) return;

    const previous = previousStatusRef.current;
    if (previous && previous !== status) {
      const transitionKey = `${previous}->${status}`;
      // No duplicate notifications for the same status event.
      if (!notifiedTransitionsRef.current.has(transitionKey)) {
        notifiedTransitionsRef.current.add(transitionKey);
        toast.success(statusChangeMessage(status));

        // Invalidate relevant caches on a status change: the detail record
        // (refetched) and aggregate lists (marketplace/dashboard).
        queryClient.invalidateQueries({ queryKey: ["invoice", invoiceId] });
        queryClient.invalidateQueries({ queryKey: ["invoices"] });
      }
    }
    previousStatusRef.current = status;
  }, [status, invoiceId, queryClient]);

  // A seller triggering early repayment is a transition the `status` field
  // never reports: the invoice stays "funded" from start to finish. Detect it
  // here so investors are notified and the nav badge reflects the new
  // notification without waiting for a page load.
  useEffect(() => {
    if (earlyRepaymentActive === null) return;

    const previous = previousEarlyRepaymentRef.current;
    // The first response only establishes a baseline. An invoice that already
    // had an early repayment when this page loaded is not a new trigger — the
    // banner and the notification centre already say so.
    const isNewTrigger =
      previous !== null && earlyRepaymentActive && !previous && !notifiedEarlyRepaymentRef.current;

    if (isNewTrigger) {
      notifiedEarlyRepaymentRef.current = true;
      toast.success(EARLY_REPAYMENT_MESSAGE);

      // The backend fans the notification out to investors; bump the cached
      // badge so it reflects that immediately, then re-sync with the server.
      bumpUnreadCount(queryClient, 1);
      queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: UNREAD_COUNT_QUERY_KEY });
    }

    previousEarlyRepaymentRef.current = earlyRepaymentActive;
  }, [earlyRepaymentActive, queryClient]);

  return query;
}
