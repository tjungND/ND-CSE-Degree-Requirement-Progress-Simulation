// One requirement row as one short line — its verdict (DGS 2026-10-11).
// The approved-verdicts table pins every row of every test student with it
// (tests/verdict-table.ts, item 3), and a saved self-check file records the
// verdicts the page showed when it was saved, so `npm run reproduce` can say
// whether a re-run reads the same (src/ui/stamp.ts, item 8).
import type { RequirementResult } from './types.ts';

/** "met", "needs_dgs_review “Waiting for the DGS”", "in_progress 18/24",
 * "unmet [overdue]": the status, the pill's own wording when the row has one,
 * its credit count and its deadline state. */
export function verdictOf(r: RequirementResult): string {
  return [
    r.status,
    ...(r.statusLabel ? [`“${r.statusLabel}”`] : []),
    ...(r.progress ? [`${+r.progress.have.toFixed(2)}/${r.progress.need}`] : []),
    ...(r.deadline ? [`[${r.deadline.state}]`] : []),
  ].join(' ');
}

/** Every row of a report, id → verdict. */
export function verdictsOf(rows: readonly RequirementResult[]): Record<string, string> {
  return Object.fromEntries(rows.map((r) => [r.id, verdictOf(r)]));
}
