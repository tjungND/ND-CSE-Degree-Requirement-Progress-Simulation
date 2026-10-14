// What the self-check's cards decide to show or record, built without the DOM
// so tests can pin it (round 5 verification, docs-tests-5 and sheet-pages-6,
// 2026-10-14: a test named for the page passed with the page's fix
// reverted). app.ts calls these; tests/round5-fixes.test.ts checks them.
import { alongTheWayWanted } from '../engine/requirements/phd.ts';
import type { AuditReport, CourseEntry, CourseLine, Student } from '../engine/types.ts';

/** Approvals: the box for examinations passed before an interruption of five
 * years or more (Academic Code §5.5) — offered while the engine has one to
 * release, a dated exam or a qualifier passed under the earlier rules, not
 * for any date, the advisor's included (round 5, item 1; DGS 2026-10-14) —
 * and kept once ticked. */
export function examsTickOffered(report: AuditReport, student: Student): boolean {
  return (report.examsBeforeInterruption ?? []).length > 0 || student.attestations.examsBeforeInterruptionStand === true;
}

/** Milestones: the "I want the MSCSE awarded along the way" box (DGS
 * 2026-10-11, question 3a: option (b)) — asked once the record qualifies, or
 * once wanted. It reads what the engine reads: a dated master's candidacy
 * application already asks for the award, so the box is ticked and the hint
 * says how to withdraw (round 5, item 28). Not shown when the report has no
 * along-the-way row — a Ph.D. student who already holds the Notre Dame MSCSE
 * (verification, sheet-pages-2). Undefined when not shown. */
export function alongTheWayBox(report: AuditReport, student: Student): { checked: boolean; hint?: string } | undefined {
  const along = report.requirements.find((r) => r.id === 'phd.msAlongTheWay');
  if (along === undefined) return undefined;
  const wanted = alongTheWayWanted(student);
  if (along.status !== 'met' && !wanted) return undefined;
  const byDate = student.milestones.msCandidacyApplied !== undefined && student.milestones.msCandidacyApplied !== '' && student.attestations.wantsMsAlongTheWay !== true;
  return { checked: wanted, ...(byDate ? { hint: 'Your dated Application for Admission to Master’s Degree Candidacy already asks for it — clear that date to withdraw.' } : {}) };
}

/** Course table: what the DGS-approval box records. On a held course the box
 * is the DGS's ruling on the hold, and that answer covers the case-by-case
 * question too (round 5, item 29 (b)); elsewhere it is the case-by-case
 * approval. Unticking clears both. */
export function applyCourseTick(entry: CourseEntry, line: Pick<CourseLine, 'holdRuling'>, ticked: boolean): void {
  if (ticked) {
    entry.dgsApproved = true;
    if (line.holdRuling) entry.dgsHoldApproved = true;
  } else {
    delete entry.dgsApproved;
    delete entry.dgsHoldApproved;
  }
}
