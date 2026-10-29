// The Coursework card's sentences, built without the DOM so tests can read
// them (policy review round 5, item 36; DGS 2026-10-14): the §5.2 paragraph
// above each earlier program's courses and the transfer-limit helpers it
// shares with the card.
import { transferRecordedFor } from '../engine/transfer-recorded.ts';
import { isNotreDameInstitution } from '../data/external.ts';
import type { Rules } from '../data/types.ts';
import { BS_SHARED_CREDITS_MAX, conferralWindow, firstSemesterComplete, ownMscseEnd, ownMscseStart, transferWindowClosedText } from '../engine/allocate.ts';
import { compareTerm, normalizeEntryTerm, termLabel } from '../engine/term.ts';
import type { Student } from '../engine/types.ts';
import { phdTotalFor } from '../engine/requirements/phd.ts';
import { unfinishedPhdElsewhere } from './program-history.ts';

/** Whether a document states this student's transfer limit (P3-cse-5-6-1):
 * after a completed degree, or an unfinished master's — not with no earlier
 * graduate program, nor after an unfinished Ph.D. (Academic Code §4.6 states
 * no figure for either). */
export function transferLimitStated(student: Student): boolean {
  if (student.priorMs === 'completed') return true;
  if (student.priorMs === 'unfinished') return !unfinishedPhdElsewhere(student);
  return false;
}

/** The §5.2 cap's number for this record, from the Parameters tab. */
export function transferCapLimit(student: Student, rules: Rules): string {
  const key =
    student.program === 'mscse'
      ? student.priorMs === 'completed' ? 'ms_transfer_completed_ms_credits_max' : 'transfer_unfinished_ms_credits_max'
      : student.priorMs === 'completed' ? 'phd_transfer_completed_ms_credits_max' : 'transfer_unfinished_ms_credits_max';
  const n = rules.parameters.number(key);
  return n === undefined ? 'a capped number of' : String(n);
}

/** §5.2 said once, above every prior-graduate group (clarity review
 * 2026-09-26). The three conditions the page checks are named with their
 * numbers from the Parameters tab; the cap, the CSE norm and the two approvals
 * stay as the DGS worded them (2026-09-06, trimmed 2026-09-18, shortened
 * 2026-10-09). "Candidate" is the DGS's word. `todayIso` is the page's
 * (simulated) today, the date the engine reads. */
export function transferRuleText(student: Student, rules: Rules, todayIso: string, fromNotreDame: boolean): string {
  const windowYears = rules.parameters.number(student.program === 'mscse' ? 'ms_transfer_window_years' : 'phd_transfer_window_years');
  const floor = rules.parameters.gradeLetter('transfer_min_grade');
  // The same term the engine measures from (allocate.ts normalises the entry
  // term), so the two can never drift (policy review 2026-10-03) — and from
  // the same start: the Notre Dame MSCSE's admission for a Ph.D. student who
  // holds it (P3-prior-programs-4 (b); allocate.ts windowFrom; P4-transfer-5).
  const entry = normalizeEntryTerm(student.entryTerm).term;
  const mscseStart = student.program === 'phd' ? ownMscseStart(student) : undefined;
  const fromMscse = mscseStart !== undefined && compareTerm(mscseStart, entry) < 0;
  // The MSCSE held but not dated on the record: the engine holds a course
  // older than the Ph.D.'s window for the DGS (windowStartUnknown), so no
  // fixed cutoff is given (policy review round 5, item 12; DGS 2026-10-14).
  const mscseUndated = student.program === 'phd' && student.ndMasters !== undefined && mscseStart === undefined;
  const mscseEnd = mscseUndated ? ownMscseEnd(student) : undefined;
  const cutoffFrom = (from: { season: Student['entryTerm']['season']; year: number }) => termLabel({ season: from.season, year: from.year - (windowYears ?? 0) });
  const window =
    windowYears === undefined
      ? 'within the years §5.2 allows (the number is missing from the rules sheet)'
      : mscseUndated
        ? // …and the MSCSE's end, when the record knows it and it is older
          // than the Ph.D.'s window: a course after it and outside that window
          // is refused, as its line says (review of the fixes, 2026-10-29).
          mscseEnd !== undefined && windowYears !== undefined && compareTerm(mscseEnd, { season: entry.season, year: entry.year - windowYears }) < 0
          ? `within ${windowYears} years before your admission to the Notre Dame MSCSE, or while you were enrolled in it — this record does not date the admission, so a course from before ${cutoffFrom(entry)} goes to the DGS if it is from ${termLabel(mscseEnd)} or earlier, and does not count if it is later`
          : `within ${windowYears} years before your admission to the Notre Dame MSCSE — this record does not date it, so a course from before ${cutoffFrom(entry)} goes to the DGS`
        : `within ${windowYears} years before ${fromMscse ? 'your admission to the Notre Dame MSCSE' : 'you entered'} (${cutoffFrom(fromMscse ? mscseStart! : entry)} or later)`;
  const grade = floor === undefined ? 'with the grade §5.2 requires (missing from the rules sheet)' : `with a grade of ${floor} or better (the DGS decides pass/fail grades)`;
  // The timing as the course lines say it (allocate.ts processWhen): recorded,
  // the window closed once the semester of graduation has begun, or when to
  // send it — named by that semester when it is on file (policy review round
  // 5, item 3; DGS 2026-10-14: the paragraph said "now" beside a line saying
  // the window had closed). The first semester as the engine reads it
  // (firstSemesterComplete): a finished earlier Notre Dame degree meets it.
  const conferral = conferralWindow(student, todayIso);
  const firstSemester = firstSemesterComplete(student, entry, todayIso);
  const timing =
    // Every transfer on the record ticked as recorded (per transfer since
    // the credit-transfer review, 2026-10-28, #31).
    student.courses.some((c) => transferRecordedFor(student, c)) &&
    student.courses.filter((c) => c.origin === 'transfer' && !isNotreDameInstitution(c.institution) && c.degreeLevel !== 'bachelors' && c.fromNdTranscript !== true).every((c) => transferRecordedFor(student, c))
      ? 'the Grad Admin recorded your transfer credit, as you ticked under Approvals (§5.2).'
      : conferral.closed !== undefined
        ? `${transferWindowClosedText(conferral.closed)}.`
        : `the processing request (below the milestones) goes to the Grad Admin ${firstSemester.done ? `now${firstSemester.byEarlierProgram ? ' (your finished earlier Notre Dame degree already meets §5.2’s first semester)' : ''}` : 'after your first semester'}, ${conferral.before}.`;
  const limit = transferLimitStated(student) ? `up to ${transferCapLimit(student, rules)} credits` : `and how much — no document sets a limit for your case; this page holds it to ${transferCapLimit(student, rules)} until the DGS decides`;
  return (
    `Transfer credit (§5.2): a graduate course from ${fromNotreDame ? 'your earlier Notre Dame program' : 'another university'} can count if you took it after your bachelor’s degree, ${window}, and ${grade} — this page checks those three. ` +
    `Which courses transfer (normally CSE-related ones, ${limit}) is the DGS’s recommendation, approved by the Graduate School and recorded by the Grad Admin once your official transcript reaches the Graduate School. ` +
    `Until the DGS decides, every graduate course here is a candidate: send the review request (Transcripts card) at any time; ${timing}`
  );
}

/** "Your earlier graduate program was not finished, so up to 6 credits …" —
 * for an unfinished Ph.D. no document states a figure, so the 6 is this
 * page's working limit (P4-transfer-4; DGS 2026-10-12). `who` opens the
 * sentence; `tail` follows the number. */
export function notFinishedSentence(student: Student, who: string, unfinished: string, finished: string, tail = ''): string {
  return unfinishedPhdElsewhere(student)
    ? `${who} — a Ph.D. — was not finished; no document states a transfer limit for an unfinished Ph.D., so the DGS decides how much transfers (§5.2), and this page holds it to ${unfinished} until then${tail}; it would be ${finished} after a finished degree`
    : `${who} was not finished, so up to ${unfinished} credits from it may transfer (§5.2)${tail}; it would be ${finished} after a finished degree`;
}

/** The MSCSE Coursework intro's clause for a Notre Dame undergraduate's
 * courses, by the 4+1 answer (P3-fourplusone-6; P4-transfer-7: a 4+1
 * admitted after the bachelor's counts only the shared six). */
export function ndUndergraduateClause(student: Student): string {
  const six = String(BS_SHARED_CREDITS_MAX);
  if (student.integratedBsMs === true && student.integratedAdmitted !== undefined && student.bachelorsAwarded !== undefined && compareTerm(student.integratedAdmitted, student.bachelorsAwarded) > 0)
    return `CSE courses below the 60000 level inside §3.2’s allowance — you were admitted to the Integrated program after your bachelor’s degree, so a 60000-level course counts only among the shared ${six} (4+1 guidance)`;
  if (student.integratedBsMs === true) return '60000-level courses your bachelor’s degree did not use, whenever you took them, and CSE courses below that inside §3.2’s allowance';
  if (student.integratedBsMs === false) return 'CSE courses below the 60000 level inside §3.2’s allowance — 60000-level courses you took as an undergraduate do not count (§3.5); only students in the Integrated B.S. + M.S. program may count them';
  return 'CSE courses below the 60000 level inside §3.2’s allowance, and 60000-level courses only if you were in the Integrated B.S. + M.S. (4+1) program (§3.5) — the earlier-degrees questions in the Transcripts card ask whether you were';
}

/** The total the coursework card's key states — the Ph.D.'s as its card
 * holds it, sixty for a student without an earlier master's whatever a lower
 * row says (P4-data-1; round 5, item 15); "required" when the sheet has none. */
export function totalCreditsWord(student: Student, rules: Rules): string {
  const v = student.program === 'mscse' ? rules.parameters.number('ms_total_credits_min') : phdTotalFor(rules.parameters, student);
  return v === undefined ? 'required' : String(v);
}
