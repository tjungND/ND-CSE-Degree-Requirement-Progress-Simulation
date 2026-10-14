// The student's Notre Dame programs with their entry terms — the subject line
// and the standing paragraph of every copied email (DGS 2026-09-28: "need all
// ND programs and their entry terms including transfer — in case students
// have BS, MS at ND and/or transferred into PhD from MS"). DOM-free.
//
// What the record knows: the current program and its entry term; the
// earlier-degrees answer (src/ui/background.ts); for a transfer from the
// Notre Dame MSCSE into the Ph.D., the transfer term (asked in the same
// dialog — the entry term stays the MSCSE's, which §4.3 and §4.5 count from,
// DGS 2026-09-26; the qualifier clocks count from the transfer, DGS
// 2026-10-03); the award terms a Notre Dame transcript carries
// (`bachelorsAwarded`, `ndMasters.term`, `ndDegrees`); and the terms of the
// Notre Dame coursework from before the entry term, which bound each earlier
// program. Nothing is guessed: a term the record does not hold is left out.
import { isNotreDameInstitution } from '../data/external.ts';
import { compareTerm, conferralTerm, termLabel } from '../engine/term.ts';
import type { Student, Term } from '../engine/types.ts';
import { programShort } from './email-html.ts';

export interface ProgramHistory {
  /** For a subject line: "Ph.D., entered Fall 2025; MSCSE at Notre Dame, Fall 2023–Spring 2025". */
  compact: string;
  /** The earlier Notre Dame programs as one sentence for the standing
   * paragraph — "Earlier Notre Dame programs: …" — or '' when the current
   * program is the only one. */
  earlier: string;
}

/** First and last term of the Notre Dame coursework from before entry at one
 * degree level (the transcript's UG/GR column decided the level). */
function span(student: Student, level: 'bachelors' | 'masters'): { from?: Term; to?: Term } {
  const terms = student.courses
    .filter((c) => c.origin === 'transfer' && isNotreDameInstitution(c.institution) && c.degreeLevel === level)
    .map((c) => c.term)
    .sort(compareTerm);
  return terms.length === 0 ? {} : { from: terms[0], to: terms[terms.length - 1] };
}

/** The award term the record holds for a Notre Dame degree, if any. A
 * bachelor's known only as "before <term>" is not an award term. */
function awarded(student: Student, level: 'bachelors' | 'masters'): Term | undefined {
  if (level === 'bachelors') return student.bachelorsAwardedInferred?.before ? undefined : student.bachelorsAwarded;
  if (student.ndMasters?.term) return student.ndMasters.term;
  const conferral = (student.ndDegrees ?? []).find((d) => d.level === 'masters');
  return conferral ? conferralTerm(conferral.date) : undefined;
}

/** ", Fall 2021–Spring 2023" / ", awarded Spring 2023" / ", from Fall 2021" / "". */
function range(from: Term | undefined, to: Term | undefined, award: Term | undefined): string {
  const end = award ?? to;
  if (from && end && compareTerm(from, end) < 0) return `, ${termLabel(from)}–${termLabel(end)}`;
  if (award) return `, awarded ${termLabel(award)}`;
  if (from) return `, from ${termLabel(from)}`;
  return '';
}

export function programHistory(student: Student): ProgramHistory {
  const b = student.background;
  const entry = termLabel(student.entryTerm);
  // The current program. A transfer from the MSCSE keeps the MSCSE's entry
  // term, which §4.3 and §4.5 count from (DGS 2026-09-26), and names the term
  // of the transfer, which the qualifier, research-component and first-year
  // seminar clocks count from (DGS 2026-10-03).
  const current =
    student.program === 'phd' && b?.graduate === 'nd-mscse-transfer'
      ? `Ph.D. (transferred ${b.transferredTerm ? termLabel(b.transferredTerm) : 'term not entered'} from the Notre Dame MSCSE, entered ${entry})`
      : `${programShort(student.program)}, entered ${entry}`;
  const earlier: string[] = [];
  if (b?.graduate === 'nd-mscse' || b?.graduate === 'nd-4plus1' || b?.graduate === 'nd-other') {
    const { from, to } = span(student, 'masters');
    // Another department's program by whether it was finished — the fact
    // Academic Code §4.6's transfer cap turns on, and the page's own words
    // (policy review round 3, P3-emails-6): "a graduate degree" only when it
    // was; unanswered, neither.
    const what =
      b.graduate === 'nd-other'
        ? b.finished === true
          ? 'a graduate degree at Notre Dame (another department)'
          : `a graduate program at Notre Dame (another department)${b.finished === false ? ', not finished' : ''}`
        : `MSCSE at Notre Dame${b.graduate === 'nd-4plus1' ? ' (Integrated 4+1)' : ''}`;
    earlier.push(`${what}${range(from, to, awarded(student, 'masters'))}`);
  }
  if (b?.bachelors === 'nd-cse' || b?.bachelors === 'nd-other') {
    const { from, to } = span(student, 'bachelors');
    const what = b.bachelors === 'nd-cse' ? `B.S. at Notre Dame CSE${b.ndIntegrated ? ' (Integrated 4+1)' : ''}` : 'B.S. at Notre Dame (another department)';
    earlier.push(`${what}${range(from, to, awarded(student, 'bachelors'))}`);
  }
  return {
    compact: [current, ...earlier].join('; '),
    earlier: earlier.length > 0 ? `Earlier Notre Dame programs: ${earlier.join('; ')}.` : '',
  };
}

/** An unfinished earlier program that was a Ph.D. — a transfer course filed
 * at the Ph.D. level — for which no document states a transfer limit
 * (Academic Code §4.6 states six for an unfinished master's only; the same
 * test as the transfer card's and app.ts transferLimitStated). Policy review
 * round 4, P4-transfer-4; DGS 2026-10-12. */
export function unfinishedPhdElsewhere(student: Student): boolean {
  return student.priorMs === 'unfinished' && student.courses.some((c) => c.origin === 'transfer' && c.degreeLevel === 'phd');
}

/** The unfinished case's label as the record reads it — what the import's
 * toast says it set (round 5, item 13), read AFTER the import has re-filed
 * any Notre Dame rows, so the toast and the emails agree (verification,
 * transfer-3, 2026-10-14). */
export function unfinishedPriorLabel(student: Student): string {
  return unfinishedPhdElsewhere(student) ? 'Prior Ph.D., not completed' : PRIOR_LABELS.unfinished;
}

/** The "Prior graduate study" values as the page labels them — the §5.2
 * transfer cap's three cases. */
export const PRIOR_LABELS: Record<Student['priorMs'], string> = {
  none: 'No prior graduate degree',
  unfinished: 'Prior M.S., not completed',
  completed: 'Completed prior M.S. or Ph.D.',
};

/** The emails' "Prior graduate study" line (policy review round 3,
 * P3-prior-programs-6; DGS 2026-10-07: "apply the suggested handling"). A
 * Ph.D. student holding the Notre Dame MSCSE (as a regular student or
 * through the 4+1) has `priorMs` "none" — its courses count as one program
 * with the Ph.D. (DGS 2026-09-26) — and the emails said "No prior graduate
 * degree" beside "Earlier Notre Dame programs: MSCSE at Notre Dame". The
 * earlier-degrees answer says what the student holds; the cap is unchanged. */
export function priorStudyLabel(student: Student): string {
  const b = student.background;
  const g = b?.graduate;
  // A degree elsewhere beside it (P3-prior-programs-1; DGS 2026-10-07).
  if (student.program === 'phd' && (g === 'nd-mscse' || g === 'nd-4plus1'))
    return `MSCSE at Notre Dame (one graduate program with the Ph.D.); ${b?.alsoElsewhere ? (b.finished ? 'a completed graduate degree elsewhere' : unfinishedPhdElsewhere(student) ? 'an unfinished Ph.D. elsewhere' : 'an unfinished graduate program elsewhere') : 'no graduate degree elsewhere'}`;
  // Unanswered, and nothing read from a transcript: the emails must not say
  // "no prior graduate degree" for a student nobody has asked yet (review of
  // Option 1, 2026-10-08 — the opening dialog no longer forces the answer).
  if (b === undefined && student.priorMs === 'none' && student.priorMsInferred !== true && student.backgroundDraft?.graduate !== 'none') return 'not answered yet';
  // Not "Prior M.S." for an unfinished Ph.D. (P4-transfer-4).
  if (student.priorMs === 'unfinished') return unfinishedPriorLabel(student);
  return PRIOR_LABELS[student.priorMs];
}
