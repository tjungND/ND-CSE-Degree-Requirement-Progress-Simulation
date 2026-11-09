// What the pages show of the rules sheet's own issues (DGS 2026-10-12 / -13:
// a row listed twice — "show a warning on the web pages"), without the DOM so
// tests can read it (policy review round 5, item 36; DGS 2026-10-14).
import type { Rules, SheetIssue } from '../data/types.ts';
import { termLabel } from '../engine/term.ts';
import type { Term } from '../engine/types.ts';
import { lastOfferedTypos, latestDatable } from './schedule-terms.ts';

/** The warnings the pages show although the sheet has no error (SheetIssue
 * `onPage`): a university or a Courses row listed twice. */
export function onPageWarnings(issues: readonly SheetIssue[]): SheetIssue[] {
  return issues.filter((i) => i.onPage === true);
}

/** The self-check's diagnostics box: every issue while the sheet has an error
 * (usability review 2026-09-05, item 19 — warnings alone are the DGS's and the
 * sync prints them), else only the on-page warnings; null when there is
 * nothing to show. */
export function diagnosticsContent(issues: readonly SheetIssue[]): { issues: SheetIssue[]; summary: string } | null {
  const errors = issues.filter((i) => i.severity === 'error').length;
  const shown = errors > 0 ? [...issues] : onPageWarnings(issues);
  if (shown.length === 0) return null;
  return {
    issues: shown,
    summary:
      errors > 0
        ? `Rules-sheet diagnostics (${errors} errors, ${issues.filter((i) => i.severity === 'warning').length} warnings) — for the DGS`
        : `Rules-sheet ${shown.length === 1 ? 'warning' : `warnings (${shown.length})`} — for the DGS`,
  };
}

/** Where the course-rules page shows its on-page warnings: under the
 * rules-date line, and — the embedded page has no masthead — at the head of
 * the notices instead (round 5, item 17; DGS 2026-10-14). */
export function coursesPageWarnings(issues: readonly SheetIssue[], embedded: boolean): { masthead: SheetIssue[]; notices: SheetIssue[] } {
  const shown = onPageWarnings(issues);
  return embedded ? { masthead: [], notices: shown } : { masthead: shown, notices: [] };
}

/** The course-rules page's line for an on-page warning. */
export function sheetWarningText(i: SheetIssue): string {
  return `Rules sheet — for the DGS: ${i.message}`;
}

/** A `last_offered` later than the semester after today's (DGS 2026-11-08:
 * "when there is such a typo, show a warning on the webpage"): the schedule
 * already ignores it (reading (c)); this says so on both pages, as an on-page
 * warning beside the sheet's own. It depends on today's date, so the pages
 * add it when they render — the sheet's parse knows no date. One per row. */
export function lastOfferedTypoIssues(rules: Pick<Rules, 'courses'>, today: Term): SheetIssue[] {
  const latest = termLabel(latestDatable(today));
  const seen = new Set<number>();
  const out: SheetIssue[] = [];
  for (const r of lastOfferedTypos([...rules.courses.values()].flat(), today)) {
    if (seen.has(r.sheetRow)) continue;
    seen.add(r.sheetRow);
    out.push({
      severity: 'warning',
      tab: 'Courses',
      row: r.sheetRow,
      column: 'last_offered',
      onPage: true,
      message: `Courses row ${r.sheetRow} (${r.courseId}): last_offered is ${termLabel(r.lastOffered!)}, later than ${latest} — a course cannot last have been offered then, so it is taken for a typo: it does not set the semester the schedule describes, and the course is left off the schedule. Correct the cell.`,
    });
  }
  return out.sort((a, b) => (a.row ?? 0) - (b.row ?? 0));
}
