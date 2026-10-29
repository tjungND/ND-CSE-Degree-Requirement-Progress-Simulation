// The "Ask the Grad Admin to process" request — pure string building over an
// AuditReport and the student record (no DOM), in the two clipboard flavours
// the advisor summary uses (plain text; HTML with real tables).
//
// Two people, two jobs (DGS 2026-09-06 evening): the DGS determines
// eligibility by the handbook and the course rules — that is what the review
// request asks for; the Graduate Program Administrator (Grad Admin) processes
// what has been decided and keeps the official record. §5.2: "A student
// should send the credit transfer request to the Graduate Program Coordinator
// and the DGS will approve and make a recommendation to the Graduate School."
// So this request carries everything processable (the DGS's answer): transfer
// credits ruled transferable in the ExternalCourses tab or already approved
// (the student's §5.2 attestation), the qualifier completion form once the
// components are done, the MSCSE along the way once its row is met, and EVERY
// requirement the self-check shows as met, each as a table of what satisfies
// it — the courses, the semesters, the date (DGS request, later that evening)
// — with the DGS in cc. Since 2026-09-28 (DGS) the request also carries the
// requirements still open — in progress and not started, each in the page's
// own colour (green / amber / grey; red for overdue, blue for conditionally
// met) — and highlights any deadline that falls in this semester or the next,
// so the Grad Admin sees what is coming. Like the review request, the student's own words stay
// above a marker line and the tables below it are not to be modified. Never
// the word "audit" (the page is a self-check).
import { formatCredits } from '../engine/credits.ts';
import type { Rules } from '../data/types.ts';
import { classify, decidedCaseByCase, type ClassifiedCourse } from '../engine/allocate.ts';
import { termLabel } from '../engine/term.ts';
import type { AuditReport, CourseEntry, Milestones, RequirementResult, Student } from '../engine/types.ts';
import { shortenAfterFirst } from './first-mention.ts';
import { decisionWording } from '../engine/decider.ts';
import { gpaText } from '../engine/requirements/shared.ts';
import { ACTION_HEADING, DO_NOT_MODIFY_MARKER, EDITABLE_MARKER, MARKER_DIVIDER, STUDENT_LINE, esc, htmlRequirementBlock, plural, programLabel, programShort, studentLineHtml, textRequirementBlock, unofficialTranscriptNote, type StandingColor, upperHeading } from './email-html.ts';
import type { ProgramHistory } from './program-history.ts';
import { formatYmdLong } from './handbook.ts';
import { allRequirementsMet } from './next-steps.ts';
import { deadlineAlert, isNotStarted, standingColor, scoredRows, statusWord } from './report.ts';
import { msLimitPassedClause, whyFor } from './email-why.ts'; // not advisor-summary.ts, which loads at its button's click (2026-10-26)
import { compareTerm } from '../engine/term.ts';
import { courseSources, hasOwnStatements, sourceOf } from './provenance.ts';
import { withoutCitations } from './citations.ts';
import { ndPostingOf } from '../engine/nd-posting.ts';

export { selfCheckFileName } from './state.ts';

export interface MilestoneField {
  key: keyof Milestones;
  label: string;
  section: string;
  program: 'phd' | 'mscse' | 'both';
}

/** The dated milestones, as the milestones card labels them (keep in step
 * with `milestonesCard` in app.ts). */
export const MILESTONE_FIELDS: readonly MilestoneField[] = [
  { key: 'advisorIdentified', label: 'Advisor identified', section: '§2.3', program: 'both' },
  { key: 'researchQualifierPassed', label: 'Research qualifier passed — advisor filed the form', section: '§4.4.3', program: 'phd' },
  { key: 'qualifierFormFiled', label: 'Qualifier completion form filed with the Grad Admin', section: '§4.4', program: 'phd' },
  { key: 'candidacyPassed', label: 'Oral Candidacy Exam (OCE) passed', section: '§4.5', program: 'phd' },
  { key: 'candidacyAdmitted', label: 'Admitted to doctoral candidacy', section: 'Academic Code §6.2.9', program: 'phd' },
  { key: 'rcrTrainingCompleted', label: 'Responsible Conduct of Research and ethics training completed', section: 'Academic Code §6.2.4', program: 'phd' },
  { key: 'defensePassed', label: 'Dissertation defense passed', section: '§4.7', program: 'phd' },
  { key: 'dissertationSubmitted', label: 'Final dissertation submitted to the Graduate School', section: 'Academic Code §6.2.12', program: 'phd' },
  { key: 'thesisTopicApproved', label: 'Thesis topic approved', section: 'Academic Code §6.1.7', program: 'mscse' },
  { key: 'thesisDefensePassed', label: 'Thesis defense passed', section: '§3.4', program: 'mscse' },
  { key: 'thesisDefenseFailed', label: 'Thesis defense failed (first attempt)', section: 'Academic Code §6.1.5', program: 'mscse' },
  { key: 'thesisSubmitted', label: 'Final thesis submitted to the Graduate School', section: 'Academic Code §6.1.8', program: 'mscse' },
  { key: 'projectReportAccepted', label: 'Project report accepted by advisor', section: '§3.4', program: 'mscse' },
  // 2026-10-04: the MSCSE's, or the Ph.D.'s MSCSE along the way.
  { key: 'msCandidacyApplied', label: 'Application for Admission to Master’s Degree Candidacy submitted', section: 'Academic Code §6.1.6', program: 'both' },
];

/** Which milestone date a dated requirement row rests on. */
const ROW_MILESTONE: Record<string, keyof Milestones> = {
  'shared.advisor': 'advisorIdentified',
  'phd.qualifier.research': 'researchQualifierPassed',
  'phd.candidacy': 'candidacyPassed',
  'phd.candidacyAdmission': 'candidacyAdmitted',
  'phd.dissertation.defense': 'defensePassed',
  'phd.dissertation.submitted': 'dissertationSubmitted',
  'phd.rcr': 'rcrTrainingCompleted',
  'ms.thesis.topic': 'thesisTopicApproved',
  'ms.thesis.defense': 'thesisDefensePassed',
  'ms.thesis.submitted': 'thesisSubmitted',
  'ms.project.report': 'projectReportAccepted',
  'shared.msCandidacy': 'msCandidacyApplied',
};

export interface ProcessingTransfer {
  courseId: string;
  institution?: string;
  title?: string;
  credits: number;
  ndCredits?: number;
  grade: string;
  termText: string;
  /** `pre-approved`: ruled transferable in the ExternalCourses tab — to be
   * processed; `approved`: the student attests the DGS + Graduate School
   * approval — to be checked against the record. */
  state: 'pre-approved' | 'approved';
  /** The part of the course that transfers, when it is less than the whole:
   * what the §5.2 cap admits (P3-prior-programs-5) — or another cap, `cutBy`. */
  cappedCredits?: number;
  /** The cap that cut the course when it is not §5.2's — the course's own
   * reason, e.g. "over the 9-credit non-CSE cap (§4.2)": only the credits it
   * admits transfer (DGS 2026-10-27, superseding round 5's transfer-1). */
  cutBy?: string;
  /** `cutBy` is a limit missing from the rules sheet: the course cannot be
   * checked yet — not submitted, and not "over" anything. */
  cutUnknown?: true;
  /** Where the row came from (src/ui/provenance.ts; DGS 2026-10-11, item 6). */
  source: string;
  /** Read from a transcript marked unofficial: not for official processing
   * until the official transcript reaches the Graduate School (DGS 2026-10-16). */
  unofficial?: true;
}

/** One met requirement as a table: what satisfies it. */
export interface MetTable {
  heading: string;
  columns: string[];
  rows: string[][];
}

/** One requirement, met or not, as the Grad Admin request prints it: the
 * page's status word, its colour, what meets it so far, and its deadline —
 * flagged when it falls in this semester or the next, or has passed. */
export interface StandingTable extends MetTable {
  word: string;
  color: StandingColor;
  deadline?: { text: string; alert?: 'this' | 'next' | 'passed' };
  /** What the request prints under the heading (DGS 2026-09-28: no filler
   * tables): "Evidence: …" for a met row, "Progress: …" for an open one,
   * nothing for a row with nothing to say. */
  lines: string[];
  /** The courses this row counts, for the one course table (DGS 2026-09-28:
   * the same courses used to print under three rows). */
  courseIds: string[];
  /** The same courses as the record's rows — one per registration, so a
   * course taken in two semesters (thesis direction, research) is two rows of
   * the course table, each with its own term and source (2026-10-11). */
  courseEntries: CourseEntry[];
}

/** One row of the course table: a course and every requirement it counts toward. */
export interface CountedCourse {
  courseId: string;
  title: string;
  credits: string;
  grade: string;
  term: string;
  where: string;
  countsToward: string[];
  /** Where the row came from (src/ui/provenance.ts; DGS 2026-10-11, item 6). */
  source: string;
}

export interface ProcessingItems {
  transfers: ProcessingTransfer[];
  /** Decided courses the §5.2 cap has no room for: not submitted — the
   * allocator fills the cap in term order, which is not a DGS ruling, so the
   * request says which ones and that the DGS may choose (P3-prior-programs-5). */
  transfersOverCap: ProcessingTransfer[];
  transferCap?: number;
  milestones: { label: string; date: string; section: string }[];
  advisorName?: string;
  msAlongTheWay: boolean;
  qualifierFormDue: boolean;
  /** Every condition for admission to doctoral candidacy is met and no
   * admission date is entered: "The program must initiate the Application for
   * Admission to Doctoral Candidacy form" (DGS Handbook §3.22.3; DGS
   * 2026-10-04 — admission is a step of its own after the OCE). */
  candidacyApplicationDue: boolean;
  /** The master's candidacy application is open (2026-10-04): the row
   * `shared.msCandidacy` shows and is not dated. */
  msCandidacyDue: boolean;
  /** Every met requirement (scored rows only), each with the courses,
   * semesters or date that satisfy it. */
  met: MetTable[];
  /** Every scored requirement, met or not (DGS 2026-09-28), in the order the
   * request prints them: overdue first, then met, conditionally met, in
   * progress, not started, cannot evaluate. */
  standing: StandingTable[];
  /** Every course a standing row counts, once, with the rows it feeds. */
  courses: CountedCourse[];
  /** The numbered "Action requested" list (DGS 2026-09-28). */
  actions: string[];
  /** The counts behind the standing list, and the sentence that states them. */
  tally: { met: number; conditional: number; inProgress: number; notStarted: number; cannot: number; overdue: number; dueSoon: number; text: string };
  /** The card's item lines, one per processable thing — the major events
   * (below) — and the over-cap courses, which are shown, never counted. */
  lines: string[];
  /** What goes along in the request for the record, never on its own (DGS
   * 2026-10-15): the milestone dates, transfer credit already on the record,
   * and the standing — one line for the card, undefined when there is none. */
  forTheRecord?: string;
  /** The MAJOR events only (DGS 2026-10-15: "Can you determine major events
   * so that only when those happen, students need to submit…" — superseding
   * 2026-09-06, when any met requirement counted): transfer credit to submit
   * (§5.2), the qualifier completion form (§4.4), the MSCSE along the way
   * (§4.5), and the applications for admission to doctoral (DGS Handbook
   * §3.22.3) and master's (Academic Code §6.1.6) candidacy — the things the
   * Grad Admin must act on, the same list as the advisor email's "What the
   * Grad Admin needs to do". A milestone date (the committee's form is the
   * record of an exam or defense; the advisor files the research qualifier's),
   * the standing and transfer credit already recorded go along with a request,
   * never start one. The button is active only when this is above zero. */
  count: number;
}

const COURSE_COLUMNS = ['Course', 'Title', 'Credits', 'Grade', 'Term', 'Where'];

/** The table for one requirement (DGS 2026-09-06 evening): the courses the
 * engine says satisfy it — or, for an open row, the ones counted so far; the
 * semesters for residency; the date for a milestone; the figure for the GPA;
 * otherwise the row's own detail (which, for an open row, says what is still
 * missing). */
function metTable(r: RequirementResult, student: Student, countedEntries?: (courseId: string) => CourseEntry[]): MetTable & { entries?: CourseEntry[] } {
  const heading = `${r.title} (${r.citation.section})`;
  const evidence = r.status === 'met' ? 'Evidence' : 'Progress';
  const byId = new Map<string, CourseEntry>();
  for (const c of student.courses) byId.set(c.courseId, c);
  const ids = r.satisfiedBy ?? [];
  if (ids.length > 0 && ids.every((id) => byId.has(id))) {
    // The k-th time an id is listed is the k-th counted registration of it
    // (2026-10-11: CSE 68901 taken in two semesters printed one row twice).
    const seen = new Map<string, number>();
    const entries = ids.map((id) => {
      const k = seen.get(id) ?? 0;
      seen.set(id, k + 1);
      const counted = countedEntries?.(id) ?? [];
      return counted[k] ?? counted[counted.length - 1] ?? byId.get(id)!;
    });
    return {
      heading,
      columns: COURSE_COLUMNS,
      rows: entries.map((c) => [c.courseId, c.title ?? '', formatCredits(c.credits), c.grade, termLabel(c.term), c.origin === 'nd' ? 'Notre Dame' : (c.institution ?? 'another university')]),
      entries,
    };
  }
  if (ids.length > 0) return { heading, columns: ['Semester'], rows: ids.map((s) => [s]) };
  const milestoneKey = ROW_MILESTONE[r.id];
  if (milestoneKey) {
    const date = student.milestones[milestoneKey];
    // The student's own statement (DGS 2026-10-11, item 6): said beside the date.
    const rows: string[][] = [['Date', typeof date === 'string' && date !== '' ? `${date}, as I entered it` : 'not entered']];
    if (r.id === 'shared.advisor') {
      const names = [student.milestones.advisorName, student.milestones.advisorName2].filter((n): n is string => !!n);
      rows.unshift([names.length > 1 ? 'Advisors' : 'Advisor', names.length > 0 ? names.join(' and ') : 'name not entered']);
    }
    return { heading, columns: ['What', evidence], rows };
  }
  // As the §2.2 card prints it: 2.996 is not "3.00" (P3-cse-1-2-1, DGS 2026-10-06).
  // The GPA row is in progress only while no GPA exists yet — the first
  // semester, no grade posted (DGS 2026-10-14): no figure to list, so the
  // request prints the card's own fact ("Progress: No GPA yet.").
  if (r.id === 'shared.gpa') return { heading, columns: ['What', evidence], rows: r.status === 'in_progress' ? [] : [['Cumulative GPA', student.gpa !== undefined ? gpaText(student.gpa) : 'not entered']] };
  return { heading, columns: [evidence], rows: [[r.detail || statusWord(r).toLowerCase()]] };
}

const STANDING_ORDER: Record<StandingColor, number> = { red: 0, green: 1, blue: 2, amber: 3, grey: 4 };

/** Every scored requirement as the request prints it (DGS 2026-09-28). */
function standingTable(r: RequirementResult, student: Student, countedEntries?: (courseId: string) => CourseEntry[]): StandingTable {
  // A done deadline is the milestone's own date, already in the table.
  const alert = deadlineAlert(r);
  const deadline = alert === null ? undefined : { text: r.deadline!.label, ...(alert ? { alert } : {}) };
  const { entries: tableEntries, ...table } = metTable(r, student, countedEntries);
  const met = r.status === 'met';
  const lead = met ? 'Evidence' : 'Progress';
  // The lines (DGS 2026-09-28: "drop the filler tables"): a course-based row
  // points at the one course table; a residency row keeps its semesters as
  // a table; a milestone row says its date only when there is one; a row
  // whose only progress would be its status word says nothing.
  const courseIds = table.columns === COURSE_COLUMNS ? table.rows.map((row) => row[0]!) : [];
  // The detail re-voiced for an email from the student (advisor-summary.ts
  // whyFor: "you" → "I", page instructions dropped) — its facts only, as the
  // card shows them first (DGS 2026-10-28: "there are too many texts").
  const why = whyFor(r, false, true);
  const lines: string[] = [];
  if (courseIds.length > 0) lines.push(`${lead}: ${met ? '' : why ? `${why} ` : ''}${courseIds.join(', ')} (in the course table above).`);
  else if (table.columns[0] === 'What') {
    const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
    const facts = table.rows.filter((row) => row[1] !== 'not entered' && row[1] !== 'name not entered').map((row) => `${lower(row[0]!)} ${row[1]}`);
    if (facts.length > 0) lines.push(`${lead}: ${facts.join('; ')}.`);
    else if (!met && why && !/^Not started\b/.test(why)) lines.push(`${lead}: ${why}`);
  } else if (table.columns[0] === 'Semester') {
    // kept as a table below
  } else if (why && why.toLowerCase() !== `${statusWord(r).toLowerCase()}.` && !/^Not started\b/.test(why)) lines.push(`${lead}: ${why}`);
  const rows = table.columns[0] === 'Semester' ? table.rows : [];
  return { ...table, rows, word: statusWord(r), color: standingColor(r), ...(deadline ? { deadline } : {}), lines, courseIds, courseEntries: courseIds.length > 0 ? (tableEntries ?? []) : [] };
}

/** The one course table: every course a standing row counts, with the rows
 * it feeds (their short titles and §). */
/** The credits a row prints: what the self-check counts — the hours on the
 * Notre Dame record, or the §5.2 pro-rata conversion — with the transcript's
 * own figure in brackets when they differ; and "—" for the grade of credit on
 * the Notre Dame record, which is finished credit, not "in progress", as the
 * coursework table prints it (policy review round 4, P4-transfer-6; DGS
 * 2026-10-12; DGS Handbook §3.14: credits are reported in semester hours). */
function creditsCell(c: CourseEntry, cc: ClassifiedCourse | undefined, capCounted?: { counted: number; restOver?: string }, transferCap?: number): string {
  const whole = cc?.effectiveCredits ?? c.credits;
  const converted = Math.abs(whole - c.credits) >= 1e-9 ? `${formatCredits(c.credits)}${cc?.convertedFrom ? ` ${cc.convertedFrom}` : ''} credits on the transcript` : '';
  // A course the §5.2 cap admits only in part prints the part it counts, as
  // the request's own totals do (round 5, item 11; DGS 2026-10-14) — naming
  // the cap that cut it, which is not always §5.2's (verification, transfer-1).
  if (capCounted !== undefined && capCounted.counted < whole - 1e-9)
    return `${formatCredits(capCounted.counted)} of ${formatCredits(whole)} (${converted ? `${converted}; ` : ''}the rest ${capCounted.restOver ?? `over the ${transferCap !== undefined ? `${formatCredits(transferCap)}-credit ` : ''}transfer cap`})`;
  return converted ? `${formatCredits(whole)} (${converted})` : formatCredits(c.credits);
}
function gradeCell(c: CourseEntry): string {
  return c.grade === 'IP' && ndPostingOf(c) !== undefined ? '—' : c.grade;
}

function countedCourses(standing: StandingTable[], report: AuditReport, student: Student, classifiedOf: (c: CourseEntry) => ClassifiedCourse | undefined = () => undefined): CountedCourse[] {
  const byId = new Map(report.requirements.map((r) => [`${r.title} (${r.citation.section})`, r]));
  const out = new Map<string, CountedCourse>();
  // In the report's order, so "Counts toward" reads the way the page does.
  const ordered = [...standing].sort((a, b) => report.requirements.findIndex((r) => `${r.title} (${r.citation.section})` === a.heading) - report.requirements.findIndex((r) => `${r.title} (${r.citation.section})` === b.heading));
  // One row per registration (2026-10-11): a course taken in two semesters is two rows.
  const termOf = new Map<string, CourseEntry['term']>();
  for (const t of ordered) {
    const r = byId.get(t.heading);
    const label = r ? `${r.shortTitle ?? r.title} (${r.citation.section})` : t.heading;
    for (const c of t.courseEntries) {
      const key = `${c.courseId}|${c.institution ?? ''}|${termLabel(c.term)}`;
      const capCounted = report.transferCredits?.find((x) => x.courseId === c.courseId && x.institution === c.institution && compareTerm(x.term, c.term) === 0);
      const row = out.get(key) ?? { courseId: c.courseId, title: c.title ?? '', credits: creditsCell(c, classifiedOf(c), capCounted, report.transferCap), grade: gradeCell(c), term: termLabel(c.term), where: c.origin === 'nd' ? 'Notre Dame' : (c.institution ?? 'another university'), countsToward: [], source: sourceOf(c).text };
      if (!row.countsToward.includes(label)) row.countsToward.push(label);
      out.set(key, row);
      termOf.set(key, c.term);
    }
  }
  // Term order, then id — a transcript's own order.
  const keyOf = (c: CountedCourse) => [...out].find(([, v]) => v === c)![0];
  return [...out.values()].sort((a, b) => compareTerm(termOf.get(keyOf(a))!, termOf.get(keyOf(b))!) || a.courseId.localeCompare(b.courseId));
}

/** A decided transfer the §5.2 cap — or another cap, `cutBy` — has no room
 * for (P3-prior-programs-5; DGS 2026-10-27); a limit missing from the sheet
 * leaves it unchecked, with no choice to make yet. */
function overCapText(cap: number | undefined, cutBy?: string, cutUnknown?: true): string {
  if (cutUnknown) return `not submitted: ${cutBy}`;
  return `not submitted: ${cutBy ?? `over the §5.2 transfer cap${cap !== undefined ? ` of ${formatCredits(cap)} credits` : ''}`}; the DGS may choose which courses fill it`;
}
/** How many credits of a course to transfer, said outright (DGS 2026-10-28:
 * "explicitly state how many credits need to be transferred"): "4 credits",
 * "1 of its 4 credits", "3.3 Notre Dame credits (5 on the transcript)". The
 * cap that cut the rest is named under "Courses counted so far". */
export function transferAmount(t: ProcessingTransfer): string {
  const whole = t.ndCredits ?? t.credits;
  const n = t.cappedCredits ?? whole;
  const converted = t.ndCredits !== undefined && t.ndCredits !== t.credits;
  const unit = (n < whole ? whole : n) === 1 ? 'credit' : 'credits';
  return `${formatCredits(n)}${n < whole ? ` of its ${formatCredits(whole)}` : ''} ${converted ? 'Notre Dame ' : ''}${unit}${converted ? ` (${formatCredits(t.credits)} on the transcript)` : ''}`;
}

/** `classified` — the engine's classification of the student's courses, when
 * the caller already has it for this record (app.ts classifies once per
 * render); otherwise it is computed here. */
export function processingItems(report: AuditReport, student: Student, rules: Rules, classified?: readonly ClassifiedCourse[]): ProcessingItems {
  classified ??= classify(student, rules).classified;
  // The DGS's approval for this student is on the course (2026-09-27).
  const approvedForMe = (c: ClassifiedCourse): boolean => c.entry.dgsApproved === true && decidedCaseByCase(c, student.program);
  // What transfers of each course (audit.ts): what every cap admitted, when
  // the report says. Only that part is submitted, whichever cap cut the rest
  // (DGS 2026-10-27: "If credits cannot be transferred because of the non-CSE
  // limit or others, only those credits should be transferred" — reversing
  // round 5's transfer-1, which submitted a course another cap cut whole).
  const capOf = (c: ClassifiedCourse) =>
    report.transferCredits?.find((x) => x.courseId === c.entry.courseId && x.institution === c.entry.institution && compareTerm(x.term, c.entry.term) === 0);
  const decided: (ProcessingTransfer & { overCap: boolean })[] = classified
    .filter(
      (c) =>
        c.entry.origin === 'transfer' &&
        c.entry.degreeLevel !== 'bachelors' &&
        // Notre Dame coursework that is not §5.2 transfer credit — a 4+1's
        // graduate course from before the bachelor's, even registered GR,
        // counts on the program's advance approval (Academic Code §4.6, last
        // paragraph), with no Transfer of Credits form (policy review round 3,
        // P3-fourplusone-5) — as the transfer card already reads it.
        c.notTransferCredit !== true &&
        !c.superseded &&
        // Already on the Notre Dame record as accepted transfer credit: there
        // is nothing for the Grad Admin to submit (P3-import-1, 2026-10-05).
        c.ndPosting === undefined &&
        c.pool !== 'none' && // the §5.2 floors the engine applies (grade, window, the bachelor's award term) are final
        // A course that still needs an approval is NOT processable
        // (2026-09-08). Only `yes` for this student's program, or their
        // attestation that the approval came through, reaches the Grad Admin.
        (c.transferable === 'yes' || approvedForMe(c)) &&
        // …and nothing the §5.2 card holds for the DGS — a pass/fail grade, a
        // course after admission, no earlier program, any later hold: a held
        // course reaches the Graduate School through the DGS's own
        // recommendation, not through this request (policy review round 3,
        // P3-prior-programs-5).
        c.approvalPending === undefined,
    )
    .map((c) => {
      const cap = capOf(c);
      const counted = cap?.counted;
      const whole = c.effectiveCredits ?? c.entry.credits;
      return {
      courseId: c.entry.courseId,
      institution: c.entry.institution,
      title: c.entry.title ?? c.external?.title,
      credits: c.entry.credits,
      ndCredits: c.effectiveCredits,
      grade: c.entry.grade,
      termText: termLabel(c.entry.term),
      state: approvedForMe(c) ? ('approved' as const) : ('pre-approved' as const),
      ...(counted !== undefined && counted > 0 && counted < whole ? { cappedCredits: counted } : {}),
      ...(cap?.restOver !== undefined && counted !== undefined && counted < whole ? { cutBy: cap.restOver, ...(cap.restUnknown ? { cutUnknown: true as const } : {}) } : {}),
      source: sourceOf(c.entry).text,
      ...(c.entry.fromUnofficialTranscript === true ? { unofficial: true as const } : {}),
      overCap: counted === 0,
      };
    });
  const transfers: ProcessingTransfer[] = decided.filter((t) => !t.overCap).map(({ overCap: _o, ...t }) => t);
  const transfersOverCap: ProcessingTransfer[] = decided.filter((t) => t.overCap).map(({ overCap: _o, ...t }) => t);
  const milestones = MILESTONE_FIELDS.filter((f) => f.program === 'both' || f.program === student.program).flatMap((f) => {
    const date = student.milestones[f.key];
    return typeof date === 'string' && date !== '' ? [{ label: f.label, date, section: f.section }] : [];
  });
  const byId = new Map(report.requirements.map((r) => [r.id, r]));
  // Met AND requested (DGS 2026-10-11, question 3a: option (b)) — a record
  // that only qualifies ("Qualifies") sends nothing to the Grad Admin.
  const msAlongTheWay = byId.get('phd.msAlongTheWay')?.status === 'met' && byId.get('phd.msAlongTheWay')?.statusLabel !== 'Qualifies';
  // A pass attested under the earlier rules (2026-09-21) was recorded back then; no form to chase.
  // Once the qualifier's course components are complete (P3-cse-4a-3; DGS
  // 2026-10-07: option (a)) — not the whole qualifier, whose research part
  // has the advisor's own form (§4.4.3).
  const qualifierFormDue = byId.get('phd.qualifier')?.qualifierCourseComponentsDone === true && !student.milestones.qualifierFormFiled && student.attestations.qualifierPassedUnderPriorRules !== true;
  // The engine's admission row opens its note with "Every condition is met"
  // when only the application is left (phd.ts candidacyAdmissionRow).
  const admission = byId.get('phd.candidacyAdmission');
  const candidacyApplicationDue =
    admission !== undefined && (admission.status === 'in_progress' || admission.status === 'unmet') && (admission.detailParts ?? []).some((p) => typeof p === 'object' && 'note' in p && p.note.startsWith('Every condition is met'));
  // The master's candidacy application (Academic Code §6.1.6; 2026-10-04):
  // its row appears once the GPA and credits are in hand and stays open until dated.
  const msCandidacyDue = byId.get('shared.msCandidacy')?.status === 'unmet';
  // Every scored row, met or not (DGS 2026-09-28); the Approvals row is the
  // DGS's errand list, not a standing. Overdue rows lead, then the page's
  // order of colours; within a colour, the report's own order.
  // The transfer row is left out too: the transfer sections above carry what
  // the Grad Admin may process, and a course still waiting for the DGS must
  // not reach them by another door (2026-09-08).
  // The counted registrations of each course id, in the classifier's order —
  // what `satisfiedBy` lists (countedCourseIds: definite, not superseded).
  const countedById = new Map<string, CourseEntry[]>();
  for (const c of classified) {
    if (c.superseded || c.tier !== 'definite') continue;
    countedById.set(c.entry.courseId, [...(countedById.get(c.entry.courseId) ?? []), c.entry]);
  }
  const countedEntries = (id: string): CourseEntry[] => countedById.get(id) ?? [];
  const standing = scoredRows(report)
    .filter((r) => r.group !== 'Approvals' && !r.id.endsWith('.transfer'))
    .map((r) => standingTable(r, student, countedEntries))
    .sort((a, b) => STANDING_ORDER[a.color] - STANDING_ORDER[b.color] || (a.word === 'Not started' ? 0 : 1) - (b.word === 'Not started' ? 0 : 1));
  const met = report.requirements
    .filter((r) => r.status === 'met' && !r.informational && r.group !== 'Approvals')
    .map((r) => {
      const { entries: _e, ...t } = metTable(r, student, countedEntries);
      return t;
    });
  const tally = {
    met: standing.filter((s) => s.color === 'green').length,
    conditional: standing.filter((s) => s.color === 'blue').length,
    inProgress: standing.filter((s) => s.color === 'amber').length,
    notStarted: standing.filter((s) => s.color === 'grey' && s.word === 'Not started').length,
    cannot: standing.filter((s) => s.color === 'grey' && s.word !== 'Not started').length,
    overdue: standing.filter((s) => s.color === 'red').length,
    dueSoon: standing.filter((s) => s.deadline?.alert === 'this' || s.deadline?.alert === 'next').length,
  };
  const tallyText = [
    `${plural(tally.met, 'requirement')} met`,
    ...(tally.overdue > 0 ? [`${tally.overdue} overdue`] : []),
    ...(tally.conditional > 0 ? [`${tally.conditional} conditionally met`] : []),
    `${tally.inProgress} in progress`,
    `${tally.notStarted} not started`,
    ...(tally.cannot > 0 ? [`${tally.cannot} cannot be evaluated`] : []),
  ].join(', ');
  const classifiedByEntry = new Map(classified.map((c) => [c.entry, c]));
  const courses = countedCourses(standing, report, student, (c) => classifiedByEntry.get(c));
  // The numbered actions (DGS 2026-09-28): one per processable thing, and
  // the standing on file last.
  // The DGS RECOMMENDS a transfer; the Graduate School approves it (Academic
  // Code §4.6 criterion 5; DGS Handbook §10.3.11, the Transfer of Credits
  // eForm) — policy review 2026-10-04, P1-page-text-ui-3; DGS: "Apply the
  // suggested fix". So the Grad Admin is asked to submit the request, and to
  // check the record only once the student says the Graduate School approved it.
  const recorded = student.attestations.transferRecorded === true;
  // Once the semester the student graduates in has begun (P3-import-4 (b)):
  // §5.2 considers a request only before it, so the item asks whether it was
  // sent in time rather than asking for it now; the warning sends the student
  // to the DGS if it was not.
  const closedWindow = report.transferRequestWindowClosed;
  // The tick is the student's own statement (DGS 2026-10-11, item 6).
  const recommendedBy = (t: ProcessingTransfer): string => (t.state === 'approved' ? 'recommended by the DGS for my case, as I ticked' : 'recommended by the DGS in the course rules');
  // Transfer credit is a major event until the student ticks it recorded
  // (DGS 2026-10-15): then it goes along for the record, nothing to do.
  const toProcess = recorded ? [] : transfers;
  // The numbered actions are the major events only (DGS 2026-10-15): a
  // milestone date and the standing are below the line, for the record —
  // each date is the evidence under its requirement — never an action.
  const actions = [
    ...toProcess.map(
      (t) =>
        `${closedWindow !== undefined ? 'Check whether the Transfer of Credits request was sent before ' + termLabel(closedWindow) + ', the semester I plan to graduate in, for' : 'Submit the Transfer of Credits request to the Graduate School for'} ${t.courseId}${t.title ? ` ${t.title}` : ''} (${t.institution ?? 'another university'}, ${t.termText}) — transfer ${transferAmount(t)}; ${recommendedBy(t)} (§5.2).`,
    ),
    ...(qualifierFormDue ? ['Tell me what you need for the qualifier completion form — the qualifier’s course components are complete and the form is not filed yet (§4.4).'] : []),
    ...(msAlongTheWay ? ['Process the MSCSE along the way — the self-check, which is the DGS’s review of the award (§3.1), shows its requirements met (§4.5).'] : []),
    ...(candidacyApplicationDue ? ['Initiate my Application for Admission to Doctoral Candidacy — the self-check shows every condition met (DGS Handbook §3.22.3).'] : []),
    // The 30 credits are DGS Handbook §3.21.1's, the application Academic Code
    // §6.1.6's (P4-mscse-2, with P4-text-2's citation); a passed time limit is
    // named beside it (option (b), DGS 2026-10-11).
    ...(msCandidacyDue ? [`Initiate my Application for Admission to Master’s Degree Candidacy (Academic Code §6.1.6) — the self-check shows a 3.0 GPA and 30 credits, counting this semester’s (DGS Handbook §3.21.1)${msLimitPassedClause(report)}.`] : []),
  ];
  const lines = [
    ...toProcess.map(
      (t) =>
        `${t.courseId}${t.institution ? ` (${t.institution})` : ''} — transfer ${transferAmount(t)}, ${closedWindow !== undefined ? `${recommendedBy(t)} — was the request sent before ${termLabel(closedWindow)}, the semester I plan to graduate in? (§5.2)` : `${recommendedBy(t)}, to be submitted to the Graduate School (§5.2)`}`,
    ),
    ...transfersOverCap.map((t) => `${t.courseId}${t.institution ? ` (${t.institution})` : ''} — ${overCapText(report.transferCap, t.cutBy, t.cutUnknown)}`),
    ...(qualifierFormDue ? ['Qualifier completion form — not filed yet (§4.4)'] : []),
    ...(msAlongTheWay ? ['MSCSE along the way — the self-check, which is the DGS’s review of the award (§3.1), shows its requirements met (§4.5)'] : []),
    ...(candidacyApplicationDue ? ['Application for Admission to Doctoral Candidacy — the self-check shows every condition met (DGS Handbook §3.22.3)'] : []),
    ...(msCandidacyDue ? [`Application for Admission to Master’s Degree Candidacy (Academic Code §6.1.6) — the self-check shows a 3.0 GPA and 30 credits, counting this semester’s (DGS Handbook §3.21.1)${msLimitPassedClause(report)}`] : []),
  ];
  // What goes along with a request, for the record (DGS 2026-10-15).
  const alongside = [
    ...(milestones.length > 0 ? [plural(milestones.length, 'milestone date')] : []),
    ...(recorded && transfers.length > 0 ? ['the transfer credit already on your record'] : []),
  ];
  const forTheRecord =
    alongside.length > 0 || met.length > 0
      ? `Also in the request, for the record: ${alongside.length > 0 ? `${alongside.join(', ')} and ` : ''}your standing — ${tallyText}${tally.dueSoon > 0 ? ` (${plural(tally.dueSoon, 'deadline')} this semester or next, highlighted)` : ''}.`
      : undefined;
  return {
    transfers,
    transfersOverCap,
    ...(report.transferCap !== undefined ? { transferCap: report.transferCap } : {}),
    milestones,
    advisorName: [student.milestones.advisorName, student.milestones.advisorName2].filter((n): n is string => !!n).join(' and ') || undefined,
    msAlongTheWay,
    qualifierFormDue,
    candidacyApplicationDue,
    msCandidacyDue,
    met,
    standing,
    courses,
    actions,
    tally: { ...tally, text: tallyText },
    lines,
    ...(forTheRecord !== undefined ? { forTheRecord } : {}),
    // The major events only (DGS 2026-10-15); the chip counts the card's
    // item lines (2026-09-08), the over-cap courses excepted as before.
    count: toProcess.length + (qualifierFormDue ? 1 : 0) + (msAlongTheWay ? 1 : 0) + (candidacyApplicationDue ? 1 : 0) + (msCandidacyDue ? 1 : 0),
  };
}

export interface GradAdminRequestOptions {
  todayIso: string;
  entryTerm: string;
  /** The "Prior graduate study" choice as the page labels it. */
  priorStudy: string;
  gpa?: number;
  /** The Notre Dame programs (DGS 2026-09-28): `compact` for the subject,
   * `earlier` for the standing paragraph. Optional for older callers. */
  history?: ProgramHistory;
  /** "Checked with: …" — what the request was checked with (src/ui/stamp.ts;
   * DGS 2026-10-11, item 8), the request's last line, below the do-not-modify
   * line. Optional for older callers. */
  stamp?: string;
}

export function gradAdminRequest(
  report: AuditReport,
  student: Student,
  rules: Rules,
  opts: GradAdminRequestOptions,
  classified?: readonly ClassifiedCourse[],
): { subject: string; text: string; html: string; items: ProcessingItems } {
  const items = processingItems(report, student, rules, classified);
  // No handbook sections anywhere in the request (DGS 2026-10-28: "Grad Admin
  // is familiar with the handbook. No need to refer to handbook sections").
  const bare = (s: string): string => withoutCitations(s);
  const subject = `Processing request (degree self-check) — ${opts.history?.compact ?? `${programLabel(report.program).replace(/ \(Handbook §\d\)$/, '')}, entered ${opts.entryTerm}`}`;
  const asOf = formatYmdLong(opts.todayIso.slice(0, 10)) ?? opts.todayIso.slice(0, 10);
  // Mid-sentence, lower-cased — not an acronym ("MSCSE at Notre Dame …", P3-prior-programs-6).
  const prior = /^[A-Z]{2}/.test(opts.priorStudy) ? opts.priorStudy : opts.priorStudy.charAt(0).toLowerCase() + opts.priorStudy.slice(1);
  // "in cc" said once, in the intro; the closing's "The DGS is in cc." repeated
  // the Cc line the mail client shows (trim review 2026-09-18, P-12).
  const intro = 'Could you process the items below for my degree record? The DGS (in cc) decides eligibility; this request is only for processing.';
  // (The self-check file is no longer attached — DGS 2026-09-15.) The
  // "whichever apply" hedge instructs the student and lives in the dialog step
  // (trim review 2026-09-18, P-14). Asked for only when there is transfer
  // credit to process — nothing else in this request is decided from a
  // transcript (P-45), and not once the student ticked it recorded (DGS
  // 2026-10-15); the dialog step and the card hint follow the same condition
  // (app.ts needsTranscripts).
  // The official transcript goes from the registrar straight to the Graduate
  // School (DGS 2026-10-04, P1-page-text-ui-5); the attached PDFs are copies.
  const attached = items.transfers.length > 0 && student.attestations.transferRecorded !== true ? 'Attached: copies of my transcripts (PDF); the official transcripts go directly from each university’s registrar to the Graduate School' : '';
  // Which imported transcripts were unofficial copies (DGS 2026-10-03) —
  // not for official processing (DGS 2026-10-16).
  const unofficial = unofficialTranscriptNote(student.courses, 'gradAdmin');
  const earlier = opts.history?.earlier ?? '';
  // "Informational only" is not true of the MSCSE along the way (P3-cse-3-2):
  // when the request carries that award, the closing says so (DGS 2026-10-11, item 6).
  const closing = items.msAlongTheWay
    ? 'Generated by the CSE degree self-check tool (alpha version under testing; informational only — every decision rests with the DGS — except the MSCSE along the way above, for which this self-check is the DGS’s own review).'
    : 'Generated by the CSE degree self-check tool (alpha version under testing; informational only — every decision rests with the DGS).';
  // The opening as short bullets (DGS 2026-10-28: "there are too many texts
  // … turn [it] to short bullet points"): the standing, where the courses
  // came from (item 6 — milestone dates and ticks are the student's own), the
  // attachments; `strong` as before for what the Grad Admin must not miss.
  const sources = courseSources(student);
  const bullets: { text: string; strong?: true }[] = [
    { text: `Program: ${programShort(report.program)}, entered ${opts.entryTerm}` },
    ...(earlier ? [{ text: earlier.replace(/\.$/, '') }] : []),
    { text: `Prior study: ${prior}` },
    // The first semester, no grade yet: no GPA exists (DGS 2026-10-14).
    { text: `GPA: ${report.noGpaYet ? 'none yet' : opts.gpa !== undefined ? gpaText(opts.gpa) : 'not entered yet'}` },
    ...(sources !== undefined ? [{ text: `Courses: ${sources}` }] : []),
    ...(hasOwnStatements(student) ? [{ text: 'Milestone dates and ticked approvals: my own entries' }] : []),
    ...(attached ? [{ text: attached, strong: true as const }] : []),
    ...(unofficial ? [{ text: unofficial.replace(/\.$/, ''), strong: true as const }] : []),
    { text: `Checked with the CSE degree self-check on ${asOf}` },
  ].map((b) => ({ ...b, text: bare(b.text) }));

  const TRANSFER_COLUMNS = ['University', 'Course', 'Title', 'Credits', 'ND credits', 'Grade', 'Term', 'Source'];
  const transferRow = (t: ProcessingTransfer): string[] => [
    t.institution ?? '',
    t.courseId,
    t.title ?? '',
    String(t.credits),
    // Always the credits to transfer (DGS 2026-10-28: "Do not leave them empty").
    formatCredits(t.cappedCredits ?? t.ndCredits ?? t.credits),
    t.grade,
    t.termText,
    t.source,
  ];
  type Section = { heading: string; badge?: { word: string; color: StandingColor }; deadline?: StandingTable['deadline']; columns?: string[]; table?: string[][]; lines?: string[]; plain?: string[] };
  const sections: Section[] = [];
  // A `yes` in the course rules the DGS may not have meant (DGS 2026-10-04,
  // P1-sheet-48 / -c2: "a warning needs to be shown to ADGS/DGS/Grad Admin"):
  // the first thing below the line, before the transfer tables. Not an item to process.
  if ((report.staffChecks ?? []).length > 0) {
    sections.push({ heading: 'Please check before processing', lines: report.staffChecks! });
  }
  const pre = items.transfers.filter((t) => t.state === 'pre-approved');
  const approved = items.transfers.filter((t) => t.state === 'approved');
  // Recommended by the DGS, approved by the Graduate School (2026-10-04,
  // P1-page-text-ui-3): the sections say which step is asked for.
  if (student.attestations.transferRecorded === true && items.transfers.length > 0) {
    // Nothing to do: on the record, as the student ticked — for the record (DGS 2026-10-15).
    sections.push({ heading: 'Transfer credit the Graduate School approved (§5.2) — on my record, as I ticked', columns: TRANSFER_COLUMNS, table: items.transfers.map(transferRow) });
  } else {
    // Once the semester of graduation has begun the window has closed, and the
    // action above asks whether the request was sent in time; the heading says
    // the same (policy review round 4, P4-transfer-1; DGS 2026-10-12).
    const closed = report.transferRequestWindowClosed;
    const lead = closed !== undefined ? `Transfer credit — was the request sent to the Graduate School before ${termLabel(closed)}, the semester I plan to graduate in? (§5.2)` : 'Transfer credit to submit to the Graduate School (§5.2)';
    if (pre.length > 0) {
      sections.push({
        // The "Attached:" line above already says the transcripts are attached
        // (trim review 2026-09-18, P-43).
        heading: `${lead} — recommended by the DGS in the course rules`,
        columns: TRANSFER_COLUMNS,
        table: pre.map(transferRow),
      });
    }
    if (approved.length > 0) {
      sections.push({ heading: `${lead} — recommended by the DGS for my case, as I ticked`, columns: TRANSFER_COLUMNS, table: approved.map(transferRow) });
    }
  }
  // Over the cap: for the record, not to submit (P3-prior-programs-5) — one
  // section per cap that cut them (DGS 2026-10-27: the non-CSE allowance too).
  const overCapGroups = new Map<string, ProcessingTransfer[]>();
  for (const t of items.transfersOverCap) overCapGroups.set(t.cutBy ?? '', [...(overCapGroups.get(t.cutBy ?? '') ?? []), t]);
  for (const [cutBy, group] of overCapGroups) {
    const named = group.map((t) => `${t.courseId}${t.institution ? ` (${t.institution}, ${t.termText})` : ''}`).join('; ');
    sections.push(
      cutBy === ''
        ? {
            heading: `Not submitted — over the ${items.transferCap !== undefined ? `${formatCredits(items.transferCap)}-credit ` : ''}transfer cap`,
            lines: [`${named} — the self-check filled the cap in term order, which is not a ruling; the DGS may choose which courses fill it.`],
          }
        : group[0]!.cutUnknown
          ? { heading: 'Not submitted — cannot be checked yet', lines: [`${named} — ${cutBy}.`] }
          : {
              heading: `Not submitted — ${cutBy}`,
              lines: [`${named} — which courses fill it is the self-check’s choice, not a ruling; the DGS may choose.`],
            },
    );
  }
  // ONE course table (DGS 2026-09-28): every course a requirement counts,
  // with the requirements it feeds — the standing rows point here.
  if (items.courses.length > 0) {
    sections.push({
      heading: 'Courses counted so far',
      columns: ['Course', 'Title', 'Credits', 'Grade', 'Term', 'Where', 'Counts toward', 'Source'],
      table: items.courses.map((c) => [c.courseId, c.title, c.credits, c.grade, c.term, c.where, c.countsToward.join('; '), c.source]),
    });
  }
  if (items.qualifierFormDue) {
    sections.push({
      heading: 'Qualifier completion form (§4.4)',
      lines: ['The self-check shows the qualifier’s course components complete (core knowledge, specialization and the nine Notre Dame credits; the research component has the advisor’s own form, §4.4.3), and the completion form is not filed yet — please tell me what you need from me.'],
    });
  }
  if (items.msAlongTheWay) {
    sections.push({
      // P3-cse-3-2 (DGS 2026-10-07): the self-check is §3.1's DGS review.
      heading: 'MSCSE along the way (§3.1, §4.5)',
      lines: ['The self-check, which is the DGS’s review of the award (§3.1), shows the requirements for the MSCSE along the way met (the Oral Candidacy Exam (OCE) passed, the M.S. coursework completed at Notre Dame) — please process the award.'],
    });
  }
  if (items.candidacyApplicationDue) {
    sections.push({
      heading: 'Admission to doctoral candidacy (Academic Code §6.2.9)',
      lines: [
        'The self-check shows every condition for admission to doctoral candidacy met — the Oral Candidacy Exam (OCE) passed, four consecutive full-time semesters, the coursework complete with a cumulative GPA of 3.0 or better, the Responsible Conduct of Research and ethics training, and a tenured or tenure-track dissertation advisor — please initiate the Application for Admission to Doctoral Candidacy.',
      ],
    });
  }
  if (items.msCandidacyDue) {
    sections.push({
      heading: 'Admission to master’s degree candidacy (Academic Code §6.1.6)',
      lines: [
        report.program === 'phd'
          ? 'The self-check shows the requirements for the MSCSE along the way met — please initiate my Application for Admission to Master’s Degree Candidacy as well (DGS Handbook §3.21.1), by the Graduate School calendar’s deadline for the semester I graduate in.'
          : `The self-check shows a cumulative GPA of 3.0 or better and 30 credits, counting this semester’s (DGS Handbook §3.21.1) — please initiate my Application for Admission to Master’s Degree Candidacy by the Graduate School calendar’s deadline for the semester I graduate in${msLimitPassedClause(report)}.`,
      ],
    });
  }
  // Once every requirement is met — or once the student named the semester —
  // the Graduate School's last condition in the student's own words (Academic
  // Code §3.7; DGS Handbook §3.23.1 — policy review 2026-10-03,
  // P1-residency-enrollment-c6; the named semester 2026-10-04,
  // P2-dh-3.21-3.24-24). A reminder, not an item to process: the count is unchanged.
  const g = report.graduation;
  if (g !== undefined || allRequirementsMet(report)) {
    sections.push({
      // Both sources (P3-emails-8): §3.7 is Roll Call and registration, DGS
      // Handbook §3.23.1 the "at least one credit hour".
      heading: 'Semester of graduation (Academic Code §3.7; DGS Handbook §3.23.1)',
      lines: [
        g === undefined
          ? 'I will be registered for at least one credit hour (a zero-credit course in a summer session) and complete ND Roll Call in the semester I graduate.'
          : g.incompletes !== undefined && g.incompletes.length > 0
            ? // An I in that semester (P3-dh-3.1-3.13-3; DGS Handbook §3.23.1).
              `I plan to graduate in ${termLabel(g.term)}, but ${g.incompletes.join(', ')} ${g.incompletes.length === 1 ? 'is' : 'are'} graded I in that semester — the degree is conferred only with no I grades in it, so I will have ${g.incompletes.length === 1 ? 'the grade' : 'the grades'} made final first (DGS Handbook §3.23.1)${g.registered ? '' : `; I will also register for at least one credit hour${g.term.season === 'summer' ? ' (a zero-credit course is enough in a summer session)' : ''} and complete ND Roll Call then`}.`
            : g.registered
            ? `I plan to graduate in ${termLabel(g.term)}; I am registered for it (${formatCredits(g.registeredCredits)} credits entered) and will complete ND Roll Call then.`
            : `I plan to graduate in ${termLabel(g.term)}; I will register for at least one credit hour${g.term.season === 'summer' ? ' (a zero-credit course is enough in a summer session)' : ''} and complete ND Roll Call then.`,
      ],
    });
  }
  // Every milestone date the student entered, for the record — never an
  // action (DGS 2026-10-15): not every one has a requirement row of its own
  // below (the master's candidacy application, say), so they are listed here.
  if (items.milestones.length > 0) {
    sections.push({ heading: 'Milestone dates, for the record', lines: items.milestones.map((m) => `${m.label}: ${m.date}, as I entered it (${m.section})`) });
  }
  // Every requirement, met or not, with what satisfies it so far (2026-09-06
  // evening; the open rows since 2026-09-28): the page's status word as a
  // coloured badge, and the deadline highlighted when it is this semester,
  // next semester, or already past.
  sections.push({
    heading: 'My standing, requirement by requirement',
    lines: [`${items.tally.text}.`, ...(items.tally.dueSoon > 0 ? [`${plural(items.tally.dueSoon, 'deadline')} in this semester or the next — highlighted below.`] : [])],
  });
  for (const t of items.standing) sections.push({ heading: t.heading, badge: { word: t.word, color: t.color }, deadline: t.deadline, plain: t.lines, ...(t.rows.length > 0 ? { columns: t.columns, table: t.rows } : {}) });

  // ---- plain text ----
  // Plain text has no colour: the badge is a [WORD] tag before the heading,
  // and a near or passed deadline a "!!" line under it (email-html.ts — the
  // advisor summary prints the same).
  // A standing row is a block (email-html.ts, DGS 2026-09-28 evening): the
  // tag and the heading, its deadline and evidence lines indented beneath.
  // The heading is "title (§)"; the block wants them apart.
  const split = (heading: string): { title: string; section: string } => {
    // A section of the Graduate School's documents too — "(Academic Code
    // §6.2.4)" read as no section and printed "()" (2026-10-04).
    const m = /^(.*) \(((?:Academic Code |DGS Handbook )?§[^)]*)\)$/.exec(heading);
    return m ? { title: m[1]!, section: m[2]! } : { title: heading, section: '' };
  };
  const textSection = (s: Section): string =>
    (s.badge
      ? `${textRequirementBlock({ word: s.badge.word, title: split(s.heading).title, section: '', lines: s.plain?.map(bare), deadline: s.deadline ? { text: s.deadline.text, alert: s.deadline.alert } : undefined })}\n`
      : `${upperHeading(bare(s.heading))}\n`) +
    (s.table && s.columns ? `${s.table.length > 0 && s.badge ? '    ' : ''}${s.columns.join('\t')}\n${s.table.map((r) => `${s.badge ? '    ' : ''}${r.map(bare).join('\t')}`).join('\n')}\n` : '') +
    (s.lines && s.lines.length > 0 ? s.lines.map((l) => `- ${bare(l)}`).join('\n') + '\n' : '') +
    '\n';
  // The same skeleton as the other two emails (DGS 2026-09-28): the student
  // line, the intro and standing, the numbered actions, the sign-off; the
  // tables below the line.
  const actionsText = items.actions.length > 0 ? `${ACTION_HEADING.toUpperCase()}\n${items.actions.map((a, i) => `${i + 1}. ${bare(a)}`).join('\n')}\n\n` : '';
  const text =
    `Subject: ${subject}\n\nDear Grad Admin,\n\n${STUDENT_LINE}\n\n${intro}\n${bullets.map((b) => `- ${b.text}`).join('\n')}\n\n${actionsText}Thank you!\n\n` +
    `${EDITABLE_MARKER}\n${MARKER_DIVIDER}\n${DO_NOT_MODIFY_MARKER}\n\n` +
    (sections.length > 0 ? sections.map(textSection).join('') : 'Nothing to process yet.\n\n') +
    `${closing}\n${opts.stamp ? `${opts.stamp}\n` : ''}`;

  // ---- HTML ----
  const htmlTable = (columns: string[], rows: string[][]): string =>
    `<table border="1" cellspacing="0" cellpadding="4"><tr>${columns.map((h) => `<th>${esc(h)}</th>`).join('')}</tr>` +
    rows.map((r) => `<tr>${r.map((c) => `<td>${esc(bare(c))}</td>`).join('')}</tr>`).join('') +
    '</table>';
  // The badge and the deadline box are the shared style (email-html.ts).
  const htmlSection = (s: Section): string =>
    (s.badge
      ? htmlRequirementBlock({ word: s.badge.word, color: s.badge.color, title: split(s.heading).title, section: '', lines: s.plain?.map(bare), deadline: s.deadline ? { text: s.deadline.text, alert: s.deadline.alert } : undefined }).replace(/<\/div>$/, (s.table && s.columns ? htmlTable(s.columns, s.table) : '') + '</div>')
      : `<p><strong>${esc(bare(s.heading))}</strong></p>` + (s.table && s.columns ? htmlTable(s.columns, s.table) : '')) +
    (s.lines ? `<ul>${s.lines.map((l) => `<li>${esc(bare(l))}</li>`).join('')}</ul>` : '');
  const actionsHtml = items.actions.length > 0 ? `<p><strong>${esc(ACTION_HEADING)}</strong></p><ol>${items.actions.map((a) => `<li>${esc(bare(a))}</li>`).join('')}</ol>` : '';
  const html =
    `<p>Subject: ${esc(subject)}</p><p>Dear Grad Admin,</p>${studentLineHtml()}<p>${esc(intro)}</p><ul>${bullets.map((b) => `<li>${b.strong ? `<strong>${esc(b.text)}</strong>` : esc(b.text)}</li>`).join('')}</ul>${actionsHtml}<p>Thank you!</p>` +
    `<p><strong>${esc(EDITABLE_MARKER)}</strong></p><hr><p><strong>${esc(DO_NOT_MODIFY_MARKER)}</strong></p>` +
    (sections.length > 0 ? sections.map(htmlSection).join('') : '<p>Nothing to process yet.</p>') +
    `<p>${esc(closing)}</p>${opts.stamp ? `<p>${esc(opts.stamp)}</p>` : ''}`;

  // "Oral Candidacy Exam (OCE)" once per flavour, then "OCE" (2026-09-06 evening).
  const p = student.program;
  return { subject: decisionWording(p, subject), text: decisionWording(p, shortenAfterFirst(text)), html: decisionWording(p, shortenAfterFirst(html)), items: { ...items, lines: items.lines.map((l) => decisionWording(p, l)) } };
}
