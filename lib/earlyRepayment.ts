import { differenceInCalendarDays } from "date-fns";

import type { EarlyRepayment, EarlyRepaymentStatus } from "@/lib/api";
import { proRataFloorShare } from "@/lib/returns";

/**
 * Early repayment
 *
 * A seller may repay a funded invoice before its maturity date. This module
 * holds the pure decisions behind the notice banner: whether an early
 * repayment is currently live, what an individual investor's return becomes
 * under the shortened term, and whether the banner has already been
 * acknowledged in this browser session.
 */

/**
 * Statuses in which the seller has committed to an early repayment and
 * investors must be told. `pending` counts as live: the money has not landed
 * yet, but the shortened settlement date is already committed to.
 */
const EARLY_REPAYMENT_ACTIVE_STATUSES: ReadonlySet<EarlyRepaymentStatus> =
  new Set<EarlyRepaymentStatus>(["pending", "active"]);

/**
 * Whether `repayment` is an early repayment investors should currently be
 * shown. `null`/`undefined` (never initiated) and terminal or cancelled
 * records both return `false`, which is what keeps the banner off every
 * invoice that has not opted in.
 */
export function isEarlyRepaymentActive(
  repayment: EarlyRepayment | null | undefined
): repayment is EarlyRepayment {
  return Boolean(repayment) && EARLY_REPAYMENT_ACTIVE_STATUSES.has(repayment.status);
}

/**
 * The investor return for a single invoice under early repayment terms.
 *
 * The backend's `investor_return_amount` is authoritative when present. When
 * it is absent the yield is prorated over the part of the original term that
 * actually elapses: settling six months into a twelve-month term earns half
 * the full-term yield.
 *
 * Falls back to `principal` (no yield) whenever a date needed for the
 * prorating is missing or unparseable, so the banner never shows a wrong
 * number — worst case it shows the principal back.
 */
export function computeEarlyRepaymentReturn(input: {
  /** Principal being returned, in XLM. */
  principal: number;
  /** Full-term yield as a percentage, e.g. `8` for 8%. */
  yieldPercentage?: number;
  /** When the term started — the invoice funding date. */
  issuedAt: string;
  /** When the term would have ended. */
  originalMaturityDate: string;
  /** When the early repayment actually settles. */
  settlementDate: string;
}): number {
  const {
    principal,
    yieldPercentage = 0,
    issuedAt,
    originalMaturityDate,
    settlementDate,
  } = input;

  if (principal <= 0) return 0;

  const issued = new Date(issuedAt);
  const maturity = new Date(originalMaturityDate);
  const settlement = new Date(settlementDate);
  if (
    Number.isNaN(issued.getTime()) ||
    Number.isNaN(maturity.getTime()) ||
    Number.isNaN(settlement.getTime())
  ) {
    return principal;
  }

  const termDays = differenceInCalendarDays(maturity, issued);
  // No measurable term left to prorate over (missing or already-matured
  // `issued_at`): the full yield stands.
  if (termDays <= 0) return principal + principal * (yieldPercentage / 100);

  const heldDays = differenceInCalendarDays(settlement, issued);
  const earnedFraction = Math.min(1, Math.max(0, heldDays / termDays));

  return principal + principal * (yieldPercentage / 100) * earnedFraction;
}

interface ResolveInvestorReturnInput {
  repayment: EarlyRepayment;
  /** This investor's own principal on the invoice, in XLM. */
  principal: number;
  /** Principal raised across all investors, in XLM. */
  raised: number;
  /** Full-term yield as a percentage; only used if the backend omitted its own figure. */
  yieldPercentage?: number;
}

/**
 * What the signed-in investor is due back on an invoice under early
 * repayment. Returns `0` when the investor holds no position, since a share of
 * nothing is nothing.
 *
 * The backend figure wins when it is present; otherwise the invoice-level
 * amount is prorated over the shortened term. The investor's own share of that
 * invoice-level amount is then taken with the same floor division the
 * settlement contract uses (see `proRataFloorShare`).
 */
export function resolveInvestorReturn({
  repayment,
  principal,
  raised,
  yieldPercentage,
}: ResolveInvestorReturnInput): number {
  if (principal <= 0) return 0;

  const serverTotal = repayment.investor_return_amount;
  const invoiceTotal =
    typeof serverTotal === "number" && Number.isFinite(serverTotal) && serverTotal > 0
      ? serverTotal
      : computeEarlyRepaymentReturn({
          principal: raised,
          yieldPercentage,
          issuedAt: repayment.issued_at ?? "",
          originalMaturityDate: repayment.original_maturity_date,
          settlementDate: repayment.settlement_date,
        });

  return proRataFloorShare(principal, raised, invoiceTotal);
}

/* ─── Per-session dismissal ──────────────────────────────────────────────── */

/**
 * Acknowledgement is per session, not permanent: a seller can trigger a new
 * early repayment and investors must hear about it even if they dismissed a
 * previous one, so `sessionStorage` (cleared when the tab closes) is the right
 * lifetime. Keyed per invoice so dismissing one notice never silences another.
 */
const BANNER_DISMISSAL_KEY_PREFIX = "early_repayment_banner_dismissed";

export function earlyRepaymentBannerDismissalKey(invoiceId: string): string {
  return `${BANNER_DISMISSAL_KEY_PREFIX}:${invoiceId}`;
}

/** Whether the banner for this invoice was already acknowledged this session. */
export function isEarlyRepaymentBannerDismissed(invoiceId: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return (
      window.sessionStorage.getItem(earlyRepaymentBannerDismissalKey(invoiceId)) === "true"
    );
  } catch {
    // sessionStorage unavailable (disabled cookies, some private modes).
    return false;
  }
}

/** Records the acknowledgement so the banner stays hidden for this session. */
export function dismissEarlyRepaymentBanner(invoiceId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(earlyRepaymentBannerDismissalKey(invoiceId), "true");
  } catch {
    // Dismissal is best-effort: the banner simply reappears next visit.
  }
}
