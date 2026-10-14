// What the pages show of the rules sheet's own issues (DGS 2026-10-12 / -13:
// a row listed twice — "show a warning on the web pages"), without the DOM so
// tests can read it (policy review round 5, item 36; DGS 2026-10-14).
import type { SheetIssue } from '../data/types.ts';

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
