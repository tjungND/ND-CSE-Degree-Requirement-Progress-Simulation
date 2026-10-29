// Printing credit counts (DGS 2026-09-08).
//
// Credits stopped being whole numbers when quarter-system universities began
// converting. The factor is the DGS Handbook's §3.14 pro-rata table, 0.66 for
// quarter hours (0.88 for trimester hours) — QUARTER_CREDIT_FACTOR in
// src/data/external.ts since 2026-10-04; it was 2/3 until 2026-09-12. The DGS
// chose to keep the exact product rather than round it, so the ARITHMETIC
// carries full precision — 4 quarter hours are 2.64 Notre Dame hours, and
// three such courses 7.92, not a rounded figure that would move the student
// against the §5.2 cap — and only the PRINTING is shortened. (Under 0.66 nine
// quarter hours are 5.94, not six: a student one quarter course from a
// threshold can land just short of it; the DGS ruled the arithmetic fine,
// policy review P1-units-4plus1-1, -2, -c6.) Everything a student reads goes
// through here.

/** A credit figure on the arithmetic's own grid: six decimals. Full precision
 * stays (above) — every real figure, a §3.14 product such as 2.64 or a value
 * the DGS typed such as 3.3, has at most a few decimals — but binary floating
 * point adds noise when they are added and subtracted (3 × 0.66 is
 * 1.9800000000000002; a cap's room after 1.98 + 2.64 + 2.64 is
 * 1.7399999999999989), and a sum that is exactly 24 came out as
 * 23.999999999999996, so the row printed "24 of 24 credits complete" and read
 * Not met (credit-transfer review 2026-10-28). Every converted credit, cap
 * room and sum the allocator keeps passes through here. */
export function exactCredits(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/** A credit count as a student should read it: a whole number plain ("3"),
 * anything else to at most two decimals with no trailing zeros ("2.67",
 * "2.5"). Never scientific notation, never "2.6666666666666665". */
export function formatCredits(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  const rounded = Number(n.toFixed(2));
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/0$/, '');
}
