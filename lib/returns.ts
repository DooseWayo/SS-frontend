/**
 * Pro-rata return maths.
 *
 * The settlement contract credits each investor
 *
 *   floor(principal / totalPrincipal * totalReturn)
 *
 * so the fractional remainder is never paid out — it stays in the treasury.
 * Both the settled-invoice returns table and the early repayment banner must
 * mirror that exactly, so the calculation lives here rather than in either
 * component.
 */

/**
 * Floor-division pro-rata share.
 *
 * @param principal      This investor's principal, in XLM.
 * @param totalPrincipal Principal across every investor, in XLM.
 * @param totalReturn    The amount being distributed, in XLM.
 * @returns This investor's share, truncated towards zero. `0` when there is
 *          no principal to divide by.
 */
export function proRataFloorShare(
  principal: number,
  totalPrincipal: number,
  totalReturn: number
): number {
  if (totalPrincipal <= 0) return 0;
  return Math.floor((principal / totalPrincipal) * totalReturn);
}
