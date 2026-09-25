"use client";

/**
 * Early repayment notice
 *
 * Shown on the invoice detail page once a seller has initiated an early
 * repayment on a funded invoice. It states how much is being repaid, when the
 * invoice would have matured, when the money now lands, and what the
 * signed-in investor is due back under the shortened term.
 *
 * The banner is dismissible, and the acknowledgement lasts for the browser
 * session only — see `lib/earlyRepayment.ts`.
 */

import { useEffect, useMemo, useState } from "react";
import { CalendarClock, TrendingUp, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatXLM } from "@/lib/format";
import type { EarlyRepayment } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import {
  dismissEarlyRepaymentBanner,
  isEarlyRepaymentActive,
  isEarlyRepaymentBannerDismissed,
  resolveInvestorReturn,
} from "@/lib/earlyRepayment";

interface EarlyRepaymentBannerProps {
  invoiceId: string;
  /** The invoice's early repayment record, or null if there is none. */
  earlyRepayment: EarlyRepayment | null | undefined;
  /** Every investor's position on the invoice. */
  investors?: { address: string; amount: number }[];
  /** Principal raised across all investors, in XLM. */
  raised?: number;
  /** Full-term yield as a percentage; fallback only. */
  yieldPercentage?: number;
}

/** Renders an ISO date, or an em dash when the backend did not supply one. */
function formatDate(isoDate: string): string {
  if (!isoDate) return "—";
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Gate and dismissal only. Deliberately free of `useAuth`, so an invoice with
 * no early repayment costs nothing and renders nothing — the notice itself
 * lives in the child, which is only mounted once we know it will be shown.
 */
export function EarlyRepaymentBanner({
  invoiceId,
  earlyRepayment,
  investors,
  raised,
  yieldPercentage,
}: EarlyRepaymentBannerProps) {
  const [dismissed, setDismissed] = useState(false);
  // sessionStorage is read in an effect rather than during render: the server
  // has no session, so reading eagerly would not match the server-rendered HTML.
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setDismissed(isEarlyRepaymentBannerDismissed(invoiceId));
    setMounted(true);
  }, [invoiceId]);

  // Not opted in, or already acknowledged this session.
  if (!isEarlyRepaymentActive(earlyRepayment)) return null;
  if (!mounted || dismissed) return null;

  function handleDismiss() {
    setDismissed(true);
    dismissEarlyRepaymentBanner(invoiceId);
  }

  return (
    <EarlyRepaymentNotice
      repayment={earlyRepayment}
      investors={investors}
      raised={raised}
      yieldPercentage={yieldPercentage}
      onDismiss={handleDismiss}
    />
  );
}

interface EarlyRepaymentNoticeProps {
  repayment: EarlyRepayment;
  investors?: { address: string; amount: number }[];
  raised?: number;
  yieldPercentage?: number;
  onDismiss: () => void;
}

function EarlyRepaymentNotice({
  repayment,
  investors = [],
  raised = 0,
  yieldPercentage,
  onDismiss,
}: EarlyRepaymentNoticeProps) {
  const { address } = useAuth();

  // The signed-in investor's own principal, so "your return" is their figure
  // and not the invoice-wide one.
  const investorPrincipal = useMemo(() => {
    if (!address) return 0;
    return investors.find((i) => i.address === address)?.amount ?? 0;
  }, [address, investors]);

  const investorReturn = resolveInvestorReturn({
    repayment,
    principal: investorPrincipal,
    raised,
    yieldPercentage,
  });

  return (
    <div
      role="status"
      aria-label="Early repayment notice"
      data-testid="early-repayment-banner"
      className="rounded-md border border-amber-300 bg-amber-50 p-4 text-amber-900"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <CalendarClock className="h-4 w-4 shrink-0" aria-hidden="true" />
            Early repayment initiated
          </p>
          <p className="text-sm">
            The seller is repaying this invoice ahead of its maturity date. Funds
            settle sooner and your return is calculated on the shortened term.
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 shrink-0 text-amber-900 hover:bg-amber-100"
          onClick={onDismiss}
          aria-label="Dismiss early repayment notice"
          data-testid="dismiss-early-repayment-btn"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="rounded-md border border-amber-200 bg-white/60 px-3 py-2">
          <dt className="text-xs text-amber-800">Repayment amount</dt>
          <dd className="font-mono text-sm font-medium" data-testid="early-repayment-amount">
            {formatXLM(repayment.repayment_amount)}
          </dd>
        </div>
        <div className="rounded-md border border-amber-200 bg-white/60 px-3 py-2">
          <dt className="text-xs text-amber-800">Original maturity date</dt>
          <dd
            className="text-sm font-medium"
            data-testid="early-repayment-original-maturity"
          >
            {formatDate(repayment.original_maturity_date)}
          </dd>
        </div>
        <div className="rounded-md border border-amber-200 bg-white/60 px-3 py-2">
          <dt className="text-xs text-amber-800">New settlement date</dt>
          <dd
            className="text-sm font-medium"
            data-testid="early-repayment-settlement-date"
          >
            {formatDate(repayment.settlement_date)}
          </dd>
        </div>
        {investorPrincipal > 0 && (
          <div className="rounded-md border border-amber-200 bg-white/60 px-3 py-2">
            <dt className="flex items-center gap-1 text-xs text-amber-800">
              <TrendingUp className="h-3 w-3" aria-hidden="true" />
              Your return
            </dt>
            <dd
              className="font-mono text-sm font-medium"
              data-testid="early-repayment-investor-return"
            >
              {formatXLM(investorReturn)}
            </dd>
          </div>
        )}
      </dl>
    </div>
  );
}

export default EarlyRepaymentBanner;
