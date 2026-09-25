"use client";

/**
 * Pro-rata return breakdown (issue #284)
 *
 * On the settled invoice detail page, displays each investor's pro-rata
 * return — share percentage, principal invested, return amount, and net
 * profit — using the backend's floor-division calculation. The current
 * user's row is highlighted, a tooltip explains the calculation, and the
 * table can be exported to CSV.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchInvoiceReturns, type InvoiceReturnRow } from "@/lib/api";
import { proRataFloorShare } from "@/lib/returns";
import { useAuth } from "@/hooks/useAuth";

interface ReturnsBreakdownProps {
  invoiceId: string;
}

/**
 * Floor-division pro-rata share, mirroring the backend calculation:
 * each investor receives floor(principal / totalPrincipal * totalReturn).
 *
 * The implementation is shared with the early repayment banner (see
 * `lib/returns.ts`) so the two surfaces can never disagree.
 */
export const computeProRataFloorShare = proRataFloorShare;

export function ReturnsBreakdown({ invoiceId }: { invoiceId: string }) {
  const { address } = useAuth();
  const [exported, setExported] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["invoice-returns", invoiceId],
    queryFn: () => fetchInvoiceReturns(invoiceId),
    enabled: Boolean(invoiceId),
  });

  if (isLoading) {
    return (
      <div className="space-y-2 rounded-lg border border-border p-4" data-testid="returns-loading">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        Failed to load the returns breakdown.
      </div>
    );
  }

  const rows = data.returns;

  function handleExportCsv() {
    const csv = buildReturnsCsv(rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `returns-${invoiceId}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setExported(true);
  }

  return (
    <div
      className="rounded-lg border border-border bg-card/30 p-4"
      data-testid="returns-breakdown"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <h3 className="text-sm font-semibold">Returns Breakdown</h3>
          {/* Calculation methodology tooltip (#284) */}
          <ProRataTooltip />
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            data-testid="returns-export-btn"
            onClick={handleExportCsv}
          >
            <Download className="mr-1 h-3.5 w-3.5" />
            Export CSV
          </Button>
          {exported && (
            <span className="text-xs text-muted-foreground" data-testid="returns-exported-note">
              Downloaded
            </span>
          )}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm" data-testid="returns-table">
          <thead className="border-b bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th className="p-2 font-medium">Investor Wallet</th>
              <th className="p-2 font-medium">Share %</th>
              <th className="p-2 font-medium">Principal (XLM)</th>
              <th className="p-2 font-medium">Return (XLM)</th>
              <th className="p-2 font-medium">Net Profit (XLM)</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((row) => {
              const isCurrentUser =
                Boolean(address) && row.investor_wallet === address;
              return (
                <tr
                  key={row.investor_wallet}
                  data-testid={`returns-row-${row.investor_wallet}`}
                  className={
                    isCurrentUser ? "bg-primary/10 font-medium" : "hover:bg-muted/30"
                  }
                >
                  <td className="p-2 font-mono text-xs">{row.investor_wallet}</td>
                  <td className="p-2">{row.share_percentage.toFixed(2)}%</td>
                  <td className="p-2 font-mono">{row.principal_invested.toLocaleString()}</td>
                  <td className="p-2 font-mono">{row.return_amount.toLocaleString()}</td>
                  <td className="p-2 font-mono text-green-700">
                    {row.net_profit.toLocaleString()}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {rows.length === 0 && (
        <p className="py-4 text-center text-sm text-muted-foreground">
          No investors participated in this invoice.
        </p>
      )}
    </div>
  );
}

/** Tooltip explaining the pro-rata floor-division methodology. */
function ProRataTooltip() {
  return (
    <span className="group relative inline-flex cursor-help" data-testid="returns-tooltip">
      <span
        aria-hidden="true"
        className="flex h-4 w-4 items-center justify-center rounded-full border border-muted-foreground/40 text-[10px] text-muted-foreground"
      >
        ?
      </span>
      <span
        role="tooltip"
        data-testid="returns-tooltip-content"
        className="invisible absolute left-4 top-5 z-10 w-64 rounded-md border border-border bg-popover p-2 text-xs leading-relaxed text-popover-foreground shadow-lg group-hover:visible"
      >
        Each investor's return is computed with{" "}
        <strong>floor division</strong>:
        <code className="mt-1 block rounded bg-muted px-1 py-0.5">
          net = floor(principal ÷ totalPrincipal × totalReturn)
        </code>
        The fractional remainder is not credited to any investor — it stays
        in the contract treasury, so the displayed amounts match the
        on-chain settlement exactly.
      </span>
    </span>
  );
}

/** Build the CSV export for the returns table (#284). */
export function buildReturnsCsv(rows: InvoiceReturnRow[]): string {
  const header = [
    "investor_wallet",
    "share_percentage",
    "principal_invested",
    "return_amount",
    "net_profit",
  ].join(",");
  const lines = rows.map((row) =>
    [
      row.investor_wallet,
      row.share_percentage.toFixed(2),
      row.principal_invested,
      row.return_amount,
      row.net_profit,
    ].join(","),
  );
  return [header, ...lines].join("\n");
}

export default ReturnsBreakdown;
