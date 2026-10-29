// Shared context handed to every requirement builder, plus small helpers used
// across the §3 and §4 modules.
import { formatCredits } from '../credits.ts';
import { isNotreDameInstitution } from '../../data/external.ts';
import type { Parameters, Rules } from '../../data/types.ts';
import type { AllocationResult, CapId, ClassifiedCourse, CourseAllocation } from '../allocate.ts';
import { holdAwaitsRuling } from '../allocate.ts';
import { usableGpa } from '../ranges.ts';
import { openDeadline } from '../status.ts';
import type { TierSums } from '../status.ts';
import { thresholdStatus } from '../status.ts';
import { addMonthsIso, compareTerm, conferralTerm, deadlineTermLabel, dueTermPhrase, endOfTerm, startOfTerm, termIndex, termLabel, termOfDate } from '../term.ts';
import type { Contribution, DetailPart, RequirementResult, Status, Student, Term } from '../types.ts';

export interface Ctx {
  student: Student;
  rules: Rules;
  today: string;
  /** Entry term normalized (summer entry → the following fall, decision Q17c). */
  entry: Term;
  /** The term the DEPARTMENT's qualifier clocks run from — §4.4's four
   * semesters, §4.4.3's eighteen months, §4.2's first-year seminars. The entry
   * term, except for a student who transferred into the Ph.D. from the
   * unfinished Notre Dame MSCSE: then the term of the transfer (DGS
   * 2026-10-03: "qualifier clock runs from the transfer"), while the Graduate
   * School's clocks (§4.3 eight years, §4.5 eighth semester) keep the MSCSE
   * start (DGS 2026-09-26). */
  qualifierEntry: Term;
  /** Semesters added to the §4.3 limit and §4.5's eighth semester for approved
   * leaves of absence and childbirth/adoption accommodations (DGS 2026-10-03). */
  clockShift: number;
  /** The readmission term after an interruption of five years or more
   * (Academic Code §5.5): what is dated before it waits for the DGS. */
  forfeitBefore?: Term;
  /** Academic Code Appendix A: a Ph.D. student enrolled in Spring 2020 has nine
   * years (A.5) and a ninth-semester candidacy deadline (A.4) — applied from
   * the record, never a tick box (DGS 2026-10-03: "Just read the admission
   * term"; 2026-10-07: a Notre Dame graduate enrollment in Spring 2020 too). */
  covidCohort: boolean;
  alloc: AllocationResult;
  classified: ClassifiedCourse[];
  params: Parameters;
  /** Ph.D. with an OCE date on file: the record as it stood at the exam
   * (policy review round 3, P3-cse-4b-1; DGS 2026-10-06: "Decision 1: The
   * exam's semester"). Courses after the exam's semester are left out and the
   * exam semester's own courses read as in progress, whatever their final
   * grade — so the dated check reads the coursework as of the exam, with the
   * same classification and allocation as everything else. */
  atOce?: Ctx;
}

/** The last day a Ph.D. student enrolled in Spring 2020 could have been
 * admitted by: an entry term on or before Spring 2020. */
export const COVID_COHORT_LAST_ENTRY: Term = { season: 'spring', year: 2020 };
/** Appendix A covers "Students enrolled during the spring 2020 semester". The
 * Ph.D. entry term on or before it shows that (Item 15, DGS 2026-10-03). So,
 * since 2026-10-07 (policy review round 3, P3-ac-6.2-app-2; DGS: option (a),
 * "Yes, automatically, from the record"), does a Notre Dame graduate
 * enrollment IN Spring 2020 before the Ph.D. — a student who was in the
 * MSCSE, or a master's in another Notre Dame department, then:
 *   - a Notre Dame graduate-level course dated Spring 2020, or
 *   - a Notre Dame master's conferred in Spring 2020 or later, with Notre Dame
 *     graduate coursework dated before Spring 2020.
 * "In Spring 2020", not "in or before": a master's conferred in Spring 2019
 * does not qualify. A conferral term comes only from a transcript import, so
 * a record typed by hand is caught through its dated courses. */
export function isCovidCohort(student: Student, entry: Term): boolean {
  if (student.program !== 'phd') return false;
  if (compareTerm(entry, COVID_COHORT_LAST_ENTRY) <= 0) return true;
  // Graduate rows only: the program's own, or earlier Notre Dame rows the
  // record files at the master's or Ph.D. level (an unlevelled row may be an
  // undergraduate course, and an undergraduate's enrollment is not the Ph.D.'s).
  const ndGraduate = student.courses.filter((c) => c.origin === 'nd' || (isNotreDameInstitution(c.institution) && (c.degreeLevel === 'masters' || c.degreeLevel === 'phd')));
  if (ndGraduate.some((c) => compareTerm(c.term, COVID_COHORT_LAST_ENTRY) === 0)) return true;
  const conferrals = [
    ...(student.ndMasters?.term ? [student.ndMasters.term] : []),
    ...(student.ndDegrees ?? []).filter((d) => d.level === 'masters').map((d) => conferralTerm(d.date)),
  ];
  return conferrals.some((t) => compareTerm(t, COVID_COHORT_LAST_ENTRY) >= 0) && ndGraduate.some((c) => compareTerm(c.term, COVID_COHORT_LAST_ENTRY) < 0);
}

/** An examination dated before a readmission after an interruption of five
 * years or more (policy review round 3, P3-ac-5a-3; DGS 2026-10-05: "Apply the
 * suggested handling", finishing P1-deadlines-c7 of 2026-10-03). Academic Code
 * §5.5: "Credit for any course or examination will be forfeited if the student
 * interrupts his or her program of study for five years or more." Routed to
 * the DGS, never reset. */
export function beforeForfeiture(ctx: Ctx, date: string | undefined): boolean {
  // The DGS's ruling that the examinations stand, ticked under Approvals
  // (policy review round 4, P4-ac-2; DGS 2026-10-11: option (a)).
  if (ctx.student.attestations.examsBeforeInterruptionStand === true) return false;
  return datedBeforeForfeiture(ctx, date);
}
/** Dated before the interruption, whatever the DGS ruled — what the
 * examinations tick can release (the page offers it from these). */
export function datedBeforeForfeiture(ctx: Ctx, date: string | undefined): boolean {
  return ctx.forfeitBefore !== undefined && date !== undefined && date < startOfTerm(ctx.forfeitBefore).date;
}
/** A qualifier passed under the earlier requirements, after a readmission
 * following five years or more: its attestation has no date, so it waits for
 * the DGS (P3-ac-5a-3) — until the examinations tick records the DGS's and the
 * Graduate School's ruling that the examinations stand, which releases it like
 * any dated examination (policy review round 5; DGS 2026-10-14: "Apply 1–28":
 * the tick read only by `beforeForfeiture` left this one held for good). */
export function priorRulesQualifierHeld(ctx: Ctx): boolean {
  return ctx.forfeitBefore !== undefined && ctx.student.attestations.examsBeforeInterruptionStand !== true;
}
/** The fact such an examination or course carries on its card, and the rule. */
export const FORFEIT_FACT = 'before an interruption of five years or more';
export const FORFEIT_NOTE = 'Academic Code §5.5 forfeits it unless the DGS and the Graduate School rule otherwise; the review request asks';

/** The sentence a shifted clock carries, or '' when nothing moved it. */
export function clockShiftNote(ctx: Ctx): string {
  const parts: string[] = [];
  const leave = ctx.student.leaveSemesters ?? 0;
  const accommodation = ctx.student.accommodationSemesters ?? 0;
  if (leave > 0) parts.push(`${leave} semester${leave === 1 ? '' : 's'} on approved medical leave`);
  if (accommodation > 0) parts.push(`${accommodation} childbirth/adoption accommodation semester${accommodation === 1 ? '' : 's'}`);
  if (ctx.covidCohort) parts.push(`one year for students enrolled in Spring 2020 (Academic Code Appendix A)`);
  return parts.length > 0 ? ` — extended by ${parts.join(' and ')}` : '';
}

export function missingParamDetail(key: string): string {
  return `Cannot evaluate — the rules sheet is missing '${key}'. Ask the DGS to add it to the Parameters tab`;
}

/** The Parameters keys read as something other than a number, each with its
 * reader (P4-data-2): a held key is checked with the reader the engine uses
 * for it. Every other engine key is a number. */
const PARAMETER_READERS: Record<string, 'grade' | 'codes' | 'courses'> = {
  category_min_grade: 'grade',
  transfer_min_grade: 'grade',
  cse_subject_codes: 'codes',
  phd_seminar_courses: 'courses',
};

function readParameter(ctx: Ctx, key: string): unknown {
  switch (PARAMETER_READERS[key]) {
    case 'grade':
      return ctx.params.gradeLetter(key);
    case 'codes':
      return ctx.params.codeList(key);
    case 'courses':
      return ctx.params.courseList(key);
    default:
      return ctx.params.number(key);
  }
}

/** A row whose verdict passed through a check that needs a sheet number the
 * Parameters tab lacks: held at "cannot evaluate", with one sentence per
 * missing key (CLAUDE.md: "A missing parameter renders 'cannot evaluate',
 * never a default"). The 2026-10-10 review found eight keys whose absence
 * skipped a check instead — with gpa_min gone, a student below the 3.0 floor
 * read Met for admission to candidacy, the defense and the MSCSE along the
 * way, which goes straight into the Grad Admin's processing request. Only a
 * row that would claim something (Met, or Conditionally met) is held; one
 * that is not done keeps its own status. The pill's own wording goes with the
 * status it described. */
export function heldForMissingParams(row: RequirementResult, ctx: Ctx, keys: readonly string[]): RequirementResult {
  if (row.status !== 'met' && row.status !== 'needs_dgs_review') return row;
  // A key is missing when ITS OWN reader finds no value (policy review round
  // 4, P4-data-2, 2026-10-11): a mistyped "3.0 (B)" in gpa_min is no number —
  // the GPA check is skipped, exactly as for a deleted row — though any text
  // reads as a code list, which is how the first version of this test let 18
  // rows read Met. params.ts promises a malformed value reads as a missing one.
  const missing = keys.filter((k) => readParameter(ctx, k) === undefined);
  if (missing.length === 0) return row;
  const base: DetailPart[] = row.detailParts ?? (row.detail ? [row.detail.replace(/\.$/, '')] : []);
  const { statusLabel: _label, completedLate: _late, ...rest } = row;
  return {
    ...rest,
    status: 'cannot_evaluate',
    ...joinedDetail([...base, ...missing.map(missingParamDetail)]),
    ...(row.shortDetailParts ? { shortDetailParts: [...row.shortDetailParts, ...missing.map(missingParamDetail)] } : {}),
  };
}

/** The courses a credit row counts only provisionally — named on the row
 * whenever its verdict leans on them. Read from the row's own allocation
 * (`pick`), not the pool (credit-transfer review 2026-10-28, #35): a pending
 * course a cap refused changes no count, and a pending total-only course
 * does count toward the total. */
export function provisionalCourseIds(ctx: Ctx, pick: (p: CourseAllocation) => number): string[] {
  return [...new Set(ctx.alloc.perCourse.filter((p) => pick(p) > 0 && p.course.tier === 'provisional' && !p.course.superseded).map((p) => p.course.entry.courseId))];
}

/** §2.2's bar on defending with a low GPA, as the sentence the defense rows
 * append (empty when it does not apply). */
export function defendGpaNote(ctx: Ctx): string {
  const min = ctx.params.number('gpa_min');
  const defenseGpa = usableGpa(ctx.student.gpa); // R1: an off-scale figure gates nothing
  return min !== undefined && defenseGpa !== undefined && defenseGpa < min
    ? ` Note §2.2: a student whose cumulative GPA is below ${gpaMinText(min)} may not defend.`
    : '';
}

/** A sentence written for concatenation (" Note §2.2: … ." — leading space,
 * closing period, or empty) as a note part, or nothing (DGS 2026-10-03: the
 * card shows facts; notes sit behind its Details). */
export function noteOf(sentence: string): DetailPart[] {
  const text = sentence.trim().replace(/\.$/, '');
  return text === '' ? [] : [{ note: text }];
}

/** The degree's time limit — §3.3's five years / §4.3's eight — as one row.
 * "Met" only when everything else already is, and able to tell "not finished"
 * from "cannot be judged yet" (red-team 2026-09-13): a blank rules-sheet cell
 * elsewhere used to make a student who had finished everything read "Overdue
 * — the 8-year limit passed". */
/** The degree's time-limit date: `years` from the entry term's nominal start,
 * plus six months per semester of approved MEDICAL leave or childbirth/adoption
 * accommodation, plus a year for the COVID cohort (Academic Code §6.2.6 "unless
 * interrupted by approved medical leave(s) and/or approved childbirth
 * accommodation(s)"; Appendix A.5). The leave count is medical leave only since
 * policy review round 3, P3-cross-doc-1 (DGS 2026-10-06: option A, the input
 * renamed "Semesters on approved medical leave") — a leave for another reason
 * is not entered and moves no clock. The MSCSE's five years follow the same
 * count (DGS 2026-10-03, item 17). */
export function timeLimitDate(ctx: Ctx, years: number): string {
  const extension = graduateSchoolExtension(ctx, years);
  return extension !== undefined ? endOfTerm(extension).date : baseTimeLimitDate(ctx, years);
}

/** The limit before any Graduate School extension. */
export function baseTimeLimitDate(ctx: Ctx, years: number): string {
  return addMonthsIso(startOfTerm(ctx.entry).date, years * 12 + ctx.clockShift * 6 + (ctx.covidCohort ? 12 : 0));
}

/** The Graduate School's extension of the limit — dissertation completion
 * status after the eighth year (Academic Code §6.2.6.1: "may apply for
 * dissertation completion status for up to two semesters"; DGS Handbook
 * §3.19: "a one-year dissertation completion status … the one-year extension
 * may be renewed one time") or an eligibility extension (DGS Handbook §10.3.5)
 * — through the end of the term the student entered (policy review
 * 2026-10-04, P2-ac-6.2-app-7, P2-dh-3.14-3.20-27, P2-dh-10-10; DGS: "apply
 * the suggested fix"). Only when it ends after the limit it extends; the DGS
 * confirms it. Not a clock shift: the eighth semester (§4.5) does not move. */
export function graduateSchoolExtension(ctx: Ctx, years: number): Term | undefined {
  const t = ctx.student.attestations.timeLimitExtendedThrough;
  return t !== undefined && endOfTerm(t).date > baseTimeLimitDate(ctx, years) ? t : undefined;
}

/** ", extended by the Graduate School through the end of Spring 2027", or ''. */
export function graduateSchoolExtensionClause(ctx: Ctx, years: number): string {
  const t = graduateSchoolExtension(ctx, years);
  return t === undefined ? '' : `, extended by the Graduate School through the end of ${termLabel(t)}`;
}

/** What the time-limit row says about an extension the student entered: what
 * it is, that the DGS confirms it, and — for dissertation completion status —
 * how far the Graduate School goes. */
function extensionNotes(ctx: Ctx, years: number): DetailPart[] {
  const t = ctx.student.attestations.timeLimitExtendedThrough;
  if (t === undefined) return [];
  const base = baseTimeLimitDate(ctx, years);
  const end = endOfTerm(t).date;
  if (end <= base) return [{ note: `The Graduate School extension you entered (through the end of ${termLabel(t)}) ends before your ${years}-year limit, so it changes nothing — check it under Approvals` }];
  if (ctx.student.program !== 'phd') return [{ note: 'An eligibility extension from the Graduate School (DGS Handbook §10.3.5) — you entered it yourself; the DGS confirms it' }];
  return [
    {
      note: 'Dissertation completion status lasts up to two semesters (Academic Code §6.2.6.1); the DGS Handbook (§3.19) grants one year, renewable once in extremely rare circumstances, and a student in it is part-time and pays one credit hour of resident tuition each semester. You entered the extension yourself — the DGS confirms it',
    },
    ...(end > addMonthsIso(base, 24)
      ? [{ note: 'That is longer than the Graduate School grants — one year of dissertation completion status, renewed once at most (DGS Handbook §3.19); the review request asks the DGS' }]
      : end > addMonthsIso(base, 12)
        ? [{ note: 'Beyond one year: the Graduate School renews dissertation completion status once, in extremely rare circumstances (DGS Handbook §3.19)' }]
        : []),
  ];
}

/** The review-request line for a Ph.D. extension longer than the Graduate
 * School grants (more than two years past the eight). */
export function extensionReviewFlag(ctx: Ctx): string | undefined {
  const years = ctx.params.number('phd_time_limit_years');
  const t = ctx.student.attestations.timeLimitExtendedThrough;
  if (ctx.student.program !== 'phd' || years === undefined || t === undefined) return undefined;
  if (endOfTerm(t).date <= addMonthsIso(baseTimeLimitDate(ctx, years), 24)) return undefined;
  return `Time limit: I entered a Graduate School extension through the end of ${termLabel(t)}, more than two years past my ${years}-year limit — longer than the Graduate School grants (one year of dissertation completion status, renewed once at most; DGS Handbook §3.19). Please confirm it.`;
}

/** DGS Handbook §4.2.6, Academic-Year Tuition Scholarships: "All doctoral
 * students in good standing are eligible for tuition scholarships through the
 * 8th year. … Master's students in good standing are eligible through the 5th
 * year." The Graduate School's numbers, so they live here and not in the
 * rules sheet (README § A5b). Said beside the degree's time limit, which the
 * sheet sets — a note only; the app does not model funding (policy review
 * 2026-10-04, P2-dh-4-5-4; DGS: "Apply suggested handling"). */
export const TUITION_SCHOLARSHIP_LAST_YEAR = { phd: 8, mscse: 5 } as const;

/** "5th", "8th", "21st". */
function ordinal(n: number): string {
  const tens = n % 100;
  return `${n}${tens >= 11 && tens <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')}`;
}

/** The tuition-scholarship sentence the time-limit row carries. */
export function tuitionScholarshipNote(ctx: Ctx): DetailPart {
  const phd = ctx.student.program === 'phd';
  return { note: `${phd ? 'Doctoral' : 'Master’s'} students in good standing are eligible for Graduate School tuition scholarships through the ${ordinal(TUITION_SCHOLARSHIP_LAST_YEAR[ctx.student.program])} year (DGS Handbook §4.2.6)` };
}

export function timeLimitRow(
  ctx: Ctx,
  others: { allMet: boolean; anyCannotEvaluate: boolean; mastersApplicationOpen?: boolean },
  args: {
    id: string;
    group: string;
    title: string;
    yearsKey: string;
    section: string;
    quote: string;
    /** The LAST requirement completed, when the record shows it (the Ph.D.'s
     * official submission, else the defense; the MSCSE's thesis defense,
     * submission or project report — policy review 2026-10-03 — and, since
     * policy review round 3, P3-cse-3-1, the term a credit requirement was
     * first met) — a completion after the limit cannot read "complete within
     * the limit". */
    completed?: Completion;
    /** A longer limit that may apply instead — the DGS confirms whether it
     * does: the Graduate School's seven years for a master's student
     * attending summer session only (Academic Code §6.1.4; policy review
     * 2026-10-04, P2-dh-3.21-3.24-3). `why` is the fact on the record that
     * raises it, `rule` the sentence with its citation. Past the row's own
     * limit but inside this one, the row reads In progress against this one
     * instead of Overdue, and the DGS is asked which applies. */
    longer?: { years: number; why: string; rule: string };
    /** Funding sentences (Ph.D.; policy review 2026-10-04, P2-dh-4-5-1):
     * `whenDue` is said where the tuition sentence is — once the limit is
     * due soon or past — and `always` in every state but complete. Notes
     * only; they never change the status. */
    funding?: { whenDue: DetailPart; always?: DetailPart };
  },
): RequirementResult {
  const years = ctx.params.number(args.yearsKey);
  let status: Status;
  // Facts as strings, the rule and the advice as notes (DGS 2026-10-03: the
  // card shows what is satisfied, the rest sits behind its Details).
  let parts: DetailPart[] = [];
  let deadline: RequirementResult['deadline'];
  let statusLabel: string | undefined;
  if (years === undefined) {
    status = 'cannot_evaluate';
    parts = [missingParamDetail(args.yearsKey)];
  } else {
    // Shown as a semester, never a date (DGS request 2026-09-05): eight years
    // from the entry term's start is the start of a term.
    const date = timeLimitDate(ctx, years);
    // Leaves, accommodations and Appendix A shift the clock; the Graduate
    // School's extension (2026-10-04) replaces the date — both are said.
    const shiftNote = `${clockShiftNote(ctx)}${graduateSchoolExtensionClause(ctx, years)}`;
    const extended = graduateSchoolExtension(ctx, years) !== undefined;
    const extNotes = extensionNotes(ctx, years);
    const longerDate = args.longer ? timeLimitDate(ctx, args.longer.years) : undefined;
    // The longer limit's sentence, by whether `when` (a completion, or today)
    // is still inside it.
    const longerNote = (when: string): DetailPart[] =>
      args.longer && longerDate
        ? [
            {
              note:
                when <= longerDate
                  ? `${args.longer.why}: ${args.longer.rule}, until ${deadlineTermLabel(longerDate)} (approximate) — whether it applies to you is for the DGS to confirm`
                  : `${args.longer.why}: ${args.longer.rule}, and that limit passed at ${deadlineTermLabel(longerDate)} too (approximate)`,
            },
          ]
        : [];
    const tuition = tuitionScholarshipNote(ctx);
    const fundingDue: DetailPart[] = [...(args.funding ? [args.funding.whenDue] : []), ...(args.funding?.always ? [args.funding.always] : [])];
    const fundingAlways: DetailPart[] = args.funding?.always ? [args.funding.always] : [];
    const done = args.completed;
    // "counted" while the uncounted master's candidacy application is still
    // open, as the met branch says (P3-dh-3.21-3.24-1; round 5, item 32: DGS
    // 2026-10-14, "32 yes").
    const everyDone = others.mastersApplicationOpen ? 'Every counted requirement' : 'Every requirement';
    if (others.allMet && done !== undefined && done.date > date) {
      // Finished, but after the limit (Academic Code §6.2.6 / §6.1.4): the
      // Graduate School decides eligibility (dissertation completion status,
      // an extension) — the same "Eligibility at risk" the defense row shows.
      // A course that completed a credit requirement after the limit is named
      // with its term (P3-cse-3-1, DGS 2026-10-06).
      status = 'needs_dgs_review';
      statusLabel = 'Eligibility at risk';
      parts = [
        done.course
          ? `${everyDone} is complete, but the last one was completed after the ${years}-year limit passed at ${deadlineTermLabel(date)} (approximate)${shiftNote}: ${done.course.courseId}, taken in ${termLabel(done.course.term)}, completed ${done.course.requirement}`
          : `${everyDone} is complete, but the last one was dated ${done.date}, after the ${years}-year limit passed at ${deadlineTermLabel(date)} (approximate)${shiftNote}`,
        { note: `${args.section} makes that a forfeiture of degree eligibility unless the Graduate School granted an extension — confirm it with the DGS` },
        ...longerNote(done.date),
        ...extNotes,
      ];
      deadline = { date, approx: true, state: 'done', label: `Done ${done.course ? termLabel(done.course.term) : done.date} — after the limit` };
    } else if (others.allMet) {
      status = 'met';
      // The master's candidacy application is uncounted but still open
      // (policy review round 3, P3-dh-3.21-3.24-1): "every counted
      // requirement", and the application named.
      parts = others.mastersApplicationOpen
        ? [
            `Every counted requirement is complete within the ${years}-year limit${shiftNote} — the Application for Admission to Master’s Degree Candidacy is still open`,
            { note: 'The application is the Graduate School’s condition for conferring the master’s degree (Academic Code §6.1.6)' },
            ...extNotes,
          ]
        : [`All requirements are complete within the ${years}-year limit${shiftNote}`, ...extNotes];
      deadline = { date, approx: true, state: 'done', label: 'Complete' };
    } else if (ctx.today > date && others.anyCannotEvaluate) {
      // A missing rules-sheet value is not a missed deadline (red-team
      // 2026-09-13): a student who has finished everything used to read
      // "Overdue — forfeiture" because one unrelated parameter was blank. Nor
      // is a date missing from the record (2026-10-04: the admission to
      // candidacy of a record whose dissertation milestones are dated), so
      // the sentence names both and leaves "which" to that row.
      status = 'cannot_evaluate';
      parts = [`The ${years}-year limit passed at ${deadlineTermLabel(date)} (approximate)${shiftNote}, but a requirement above cannot be evaluated yet — a value is missing from the rules sheet or from your record, and that row says which — so whether everything was finished in time cannot be judged`, ...longerNote(ctx.today), ...extNotes, tuition, ...fundingDue];
      deadline = { date, approx: true, state: 'overdue', label: `The ${years}-year limit passed at ${deadlineTermLabel(date)}` };
    } else if (ctx.today > date && longerDate !== undefined && ctx.today <= longerDate) {
      // Past the row's own limit, inside a longer one that may apply: the DGS
      // confirms which (the caller puts the question in the review request),
      // so the row runs against the longer limit — not "Overdue", and not
      // "Conditionally met" either, since nothing is complete (policy review
      // 2026-10-04).
      status = 'in_progress';
      parts = [`The ${years}-year limit passed at ${deadlineTermLabel(date)} (approximate)${shiftNote}`, ...longerNote(ctx.today), ...extNotes, tuition, ...fundingDue];
      deadline = openDeadline(longerDate, ctx.today, `Due ${dueTermPhrase(longerDate)} if the ${args.longer!.years}-year limit applies (approximate)`);
    } else if (ctx.today > date) {
      status = 'unmet';
      // What a passed limit means at the Graduate School (Academic Code
      // §6.2.6.1 / DGS Handbook §3.19): dissertation completion status or an
      // eligibility extension, applied for through the Graduate School — the
      // DGS advises, the Graduate School decides (policy review 2026-10-03).
      parts = [
        `Overdue — the ${years}-year limit passed at ${deadlineTermLabel(date)} (approximate)${shiftNote}`,
        // The Spring 2020 cohort's limit is nine years (Appendix A.5), and A.6
        // restates completion status after it (policy review round 3,
        // P3-ac-6.2-app-3 (c)).
        {
          note:
            ctx.student.program !== 'phd'
              ? 'Talk to the DGS about an eligibility extension from the Graduate School'
              : ctx.covidCohort
                ? 'After the time limit a student may apply to the Graduate School for dissertation completion status (Academic Code Appendix A.6) — talk to the DGS'
                : 'After the eighth year a student may apply to the Graduate School for dissertation completion status (Academic Code §6.2.6.1) — talk to the DGS',
        },
        ...longerNote(ctx.today),
        ...extNotes,
        tuition,
        ...fundingDue,
      ];
      deadline = { date, approx: true, state: 'overdue', label: `Overdue — the ${years}-year limit passed at ${deadlineTermLabel(date)}` };
    } else {
      status = 'in_progress';
      // The deadline chip carries the when (2026-09-03); the detail says only
      // what moved it, if anything (leaves, accommodations, Appendix A).
      // A semester, never a date (DGS request 2026-09-05).
      deadline = openDeadline(date, ctx.today, extended ? `Due ${dueTermPhrase(date)} — extended by the Graduate School (approximate)` : `Due ${dueTermPhrase(date)} — ${years} years after entry${shiftNote !== '' ? ', extended' : ''} (approximate)`);
      // The tuition sentence once the limit is this semester or next — before
      // that it is not news (and every email would carry it).
      // The Spring 2020 cohort: Appendix A extends Academic Code policies
      // only, so the Graduate School's eight-year tuition and funding cut-offs
      // (DGS Handbook §4.2.6, §4.1) did not move (policy review round 3,
      // P3-dh-4-5-1; DGS 2026-10-07: option A, "the literal text"). Their notes
      // follow the eight years, not the cohort's nine, which used to bring them
      // a year late. And for every student (policy review round 4, P4-ac-7;
      // DGS 2026-10-11: option (a)) only an approved medical leave moves them:
      // a leave stops the funding clock (DGS Handbook §3.4), but “the total
      // number of years of funding will not be extended” by a childbirth or
      // adoption accommodation (§3.7.3), nor by a Graduate School extension of
      // the time limit — so an accommodated student is no longer told in the
      // ninth year about the eighth.
      const medicalLeave = Math.max(0, Math.floor(ctx.student.leaveSemesters ?? 0));
      const fundingDate = addMonthsIso(startOfTerm(ctx.entry).date, years * 12 + medicalLeave * 6);
      const fundingNews = ctx.today > fundingDate || openDeadline(fundingDate, ctx.today, '').state === 'due_soon';
      parts = [...(shiftNote !== '' ? [{ note: `The limit counts ${years} years from ${termLabel(ctx.entry)}${shiftNote}` }] : []), ...longerNote(ctx.today), ...extNotes, ...(fundingNews ? [tuition, ...fundingDue] : fundingAlways)];
    }
  }
  return {
    id: args.id,
    group: args.group,
    title: args.title,
    status,
    ...(statusLabel ? { statusLabel } : {}),
    ...joinedDetail(parts),
    deadline,
    citation: { section: args.section, quote: args.quote },
  };
}

/** Join independent detail statements into the prose `detail`, keeping the
 * pieces as `detailParts` so the report can bullet a long detail (DGS request
 * 2026-09-04). A part may be {lead, items} — flattened to "lead: a; b; c" in
 * the prose and rendered as a nested list by the report. Single plain
 * statements stay plain text. */
export function joinedDetail(parts: DetailPart[]): { detail: string; detailParts?: DetailPart[] } {
  const flat = (p: DetailPart): string =>
    typeof p === 'string' ? p : 'warn' in p ? p.warn : 'note' in p ? p.note : 'check' in p ? p.check : `${p.lead}: ${p.items.join('; ')}`;
  const structured = parts.some((p) => typeof p !== 'string');
  return {
    // A closing period only where the last part has none (a part ending in
    // "the Ph.D." used to reach the emails as "the Ph.D..", 2026-09-26).
    // …and no period after a middle part that already ends in one ("the
    // Ph.D.. The Graduate School’s answer …", credit-transfer review 2026-10-28, #46).
    detail:
      parts.map(flat).map((t, i, all) => (i === all.length - 1 ? t : /[.!?]$/.test(t) ? `${t} ` : `${t}. `)).join('') +
      (parts.length > 0 && !/[.!?]$/.test(flat(parts[parts.length - 1]!)) ? '.' : ''),
    detailParts: parts.length > 1 || structured ? parts : undefined,
  };
}

/** Standard credit-threshold row: "X of N credits complete", with in-progress
 * and pending-approval credits called out, and the provisional courses named
 * whenever the verdict leans on them. */
export function thresholdRow(args: {
  id: string;
  group: string;
  title: string;
  /** Short name for lists that reference this row (2026-09-08). */
  shortTitle?: string;
  sums: TierSums;
  required: number | undefined;
  requiredKey: string;
  section: string;
  quote: string;
  unit?: string;
  provisionalCourses?: string[];
  extraDetail?: string[];
  /** Advice about what to register for: shown only while the definite and
   * in-progress credits together are still short of the minimum (a student
   * with the six project credits in progress was told to register for them,
   * clarity review 2026-09-26). */
  extraDetailWhenShort?: true;
  /** The courses whose definite credits count here (processing request, 2026-09-06). */
  satisfiedBy?: string[];
  /** The courses whose credits will count here once passed/approved (2026-09-08). */
  pendingBy?: string[];
  /** Which courses contribute, and how much (2026-09-22) — `courseContributions`. */
  contributions?: Contribution[];
}): RequirementResult {
  const { sums, required } = args;
  const status = thresholdStatus(sums, required);
  const unit = args.unit ?? 'credits';
  const parts: DetailPart[] = [];
  if (required === undefined) {
    parts.push(missingParamDetail(args.requiredKey));
  } else {
    // Credits can be fractional since quarter-system conversion (2026-09-08).
    const n = (v: number) => (unit === 'credits' ? formatCredits(v) : String(v));
    // "15 of 9 credits complete" is not a sentence (blue-team B3, 2026-09-18):
    // past the minimum the row says what the student HAS and that the floor is
    // behind them, instead of counting toward a number they have overshot.
    parts.push(
      sums.definite >= required
        ? `${n(sums.definite)} ${unit} — the ${n(required)}-${unit.replace(/s$/, '')} minimum is met`
        : `${n(sums.definite)} of ${required} ${unit} complete`,
    );
    if (sums.in_progress > 0) parts.push(`${n(sums.in_progress)} in progress`);
    if (sums.provisional > 0) parts.push(`${n(sums.provisional)} pending review/approval`);
    if (status === 'needs_dgs_review' && args.provisionalCourses?.length) {
      parts.push(`meeting this depends on courses that still need review: ${args.provisionalCourses.join(', ')}`);
    }
  }
  // Advice about what to register for belongs to a row that is not yet met:
  // a finished student was still being told "Register for CSE 68902 (project)
  // or CSE 68901 (thesis direction)" beside their own completed six credits
  // (2026-09-11).
  const stillShort = required === undefined || sums.definite + sums.in_progress < required;
  // Advice and rule sentences are explanation: behind the card's Details
  // (DGS 2026-10-03), plain text in `detail`.
  if (status !== 'met' && (!args.extraDetailWhenShort || stillShort)) parts.push(...(args.extraDetail ?? []).map((note) => ({ note })));
  return {
    id: args.id,
    group: args.group,
    title: args.title,
    ...(args.shortTitle ? { shortTitle: args.shortTitle } : {}),
    status,
    ...joinedDetail(parts),
    ...(required === undefined ? {} : { progress: { have: sums.definite, need: required, unit } }),
    citation: { section: args.section, quote: args.quote },
    ...(args.satisfiedBy && args.satisfiedBy.length > 0 ? { satisfiedBy: args.satisfiedBy } : {}),
    ...(args.pendingBy && args.pendingBy.length > 0 ? { pendingBy: args.pendingBy } : {}),
    ...(args.contributions && args.contributions.length > 0 ? { contributions: args.contributions } : {}),
  };
}

/** The ids of the courses whose DEFINITE credits (passed, no approval
 * pending) count toward a pool, by `pick` (e.g. the regular-pool credits) —
 * what the processing request tables as "which courses meet this
 * requirement" (DGS request 2026-09-06 evening). */
export function countedCourseIds(ctx: Ctx, pick: (p: CourseAllocation) => number): string[] {
  return ctx.alloc.perCourse
    .filter((p) => pick(p) > 0 && p.course.tier === 'definite' && !p.course.superseded)
    .map((p) => p.course.entry.courseId);
}

/** Every course that contributes to a row by `pick`, with the credits it
 * contributes; a course still to be passed or approved is `pending` (DGS
 * 2026-09-22: the report folds these behind "Courses counted"). */
export function courseContributions(ctx: Ctx, pick: (p: CourseAllocation) => number): Contribution[] {
  return ctx.alloc.perCourse
    .filter((p) => pick(p) > 0 && !p.course.superseded)
    .map((p) => ({ courseId: p.course.entry.courseId, credits: pick(p), ...(p.course.tier === 'definite' ? {} : { pending: true as const, kind: p.course.tier === 'in_progress' ? ('in_progress' as const) : p.course.dualPlanOnly ? ('plan' as const) : ('waiting' as const) }) }));
}

/** The same courses, but the ones still to be passed or approved (2026-09-08):
 * what a student's course line means by "will count toward". */
export function pendingCourseIds(ctx: Ctx, pick: (p: CourseAllocation) => number): string[] {
  return ctx.alloc.perCourse
    .filter((p) => pick(p) > 0 && p.course.tier !== 'definite' && !p.course.superseded)
    .map((p) => p.course.entry.courseId);
}

/** The last requirement completed, for the time-limit rows: its date, and —
 * when a course completed it — the course, its term and the requirement it
 * completed (policy review round 3, P3-cse-3-1; DGS 2026-10-06). */
export interface Completion {
  date: string;
  course?: { courseId: string; term: Term; requirement: string };
}

/** When a credit requirement was first met: the counted courses in term
 * order, and the term in which their credits first reached `min` — the end of
 * that term is the completion date (term.ts `endOfTerm`). Surplus courses
 * taken after it do not move it: a student who kept taking courses after the
 * limit is not flagged. Completed (definite) credit only; undefined while the
 * minimum is not reached or the sheet has no minimum. Transfer credit is
 * dated by its own term, which is before entry, so it never makes a
 * completion late. (P3-cse-3-1: CSE §3.3 and Academic Code §6.1.4 / §6.2.6
 * count coursework among "all requirements".) */
export function creditsReachedAt(
  ctx: Ctx,
  pick: (p: CourseAllocation) => number,
  min: number | undefined,
  requirement: string,
): Completion | undefined {
  if (min === undefined || min <= 0) return undefined;
  const counted = ctx.alloc.perCourse
    .filter((p) => pick(p) > 0 && p.course.tier === 'definite' && !p.course.superseded)
    .map((p) => ({ courseId: p.course.entry.courseId, term: p.course.entry.term, credits: pick(p) }))
    .sort((a, b) => compareTerm(a.term, b.term));
  let sum = 0;
  for (const c of counted) {
    sum += c.credits;
    if (sum >= min - 1e-9) return { date: endOfTerm(c.term).date, course: { courseId: c.courseId, term: c.term, requirement } };
  }
  return undefined;
}

/** The sheet's GPA minimum as the page prints it: at least one decimal and
 * never rounded — 3 → "3.0", 3.25 → "3.25" (round 5, item 14; DGS
 * 2026-10-14): toFixed(1) showed 3.25 as "3.3" while the check used 3.25. */
export function gpaMinText(n: number): string {
  const s = String(+n.toFixed(3));
  return s.includes('.') ? s : n.toFixed(1);
}

/** A card title's number (policy review round 4, P4-data-5; DGS 2026-10-12:
 * "apply the suggested handling"): the value its row already reads — the
 * Parameters value, held at the Graduate School's where the sheet would loosen
 * it — so editing a number in the sheet changes the title with the count.
 * With the key missing, the handbook's own number, as the title always read;
 * the row itself then reads Cannot evaluate. */
export function titleCount(n: number | undefined, handbook: number): string {
  return formatCredits(n ?? handbook);
}

/** "Four" for 4 — a title that spells its number (§4.3's residency). Digits
 * past ten. */
export function titleCountWord(n: number | undefined, handbook: number): string {
  const v = n ?? handbook;
  const words = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
  return Number.isInteger(v) && v >= 0 && v <= 10 ? words[v]! : formatCredits(v);
}

/** The latest of several completions (milestone dates and credit requirements). */
export function lastCompletion(list: readonly (Completion | undefined)[]): Completion | undefined {
  return list.filter((c): c is Completion => c !== undefined).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)).pop();
}

/** Cap row: caps are enforced by the engine, so the row reports usage and names
 * every excluded credit; it is n/a when nothing touches the cap. */
/** The credits an allowance admitted of a course, as allocate.ts take()
 * charges them: the non-CSE nine what it counted, any other cap the spill
 * into the total as well. */
function admittedBy(p: Ctx['alloc']['perCourse'][number] | undefined, capId: CapId): number {
  if (p === undefined) return 0;
  return p.countedRegular + p.countedOther - (capId === 'noncse' ? (p.overCapToTotal ?? 0) : 0);
}

export function capRow(args: {
  id: string;
  group: string;
  title: string;
  capId: CapId;
  capLabel: string;
  /** The Parameters key the limit comes from, named when it is missing.
   * Absent for a limit held in code (BS_SHARED_CREDITS_MAX, 2026-10-07). */
  limitKey?: string;
  section: string;
  quote: string;
  ctx: Ctx;
  /** Cap rows whose own handbook sentence makes the credit conditional on an
   * approval go needs_dgs_review while any of their courses is still waiting
   * for it, rather than met. Set it exactly where the quote on the card says
   * so — §4.2's two allowances ("subject to approval of the student's advisor
   * and DGS"), §3.2's non-CSE allowance ("subject to approval by the advisor
   * and the DGS") and §3.5's shared credits ("With approval of the instructor
   * and DGS").
   *
   * Not on `ms.cap.fourk`: §3.2's "Up to six (6) credits at the 40000 level
   * may be used to satisfy the course requirement" names no approval, so its
   * absence there is the handbook's, not an oversight (interface review R3,
   * 2026-09-18 — the other two were oversights and are fixed). */
  approvalDriven?: boolean;
  /** Plain sentences after the usage line — what the cap's number does not
   * say on its own (the Ph.D.'s two-degree allowance names what an earlier
   * degree already used, 2026-09-22). */
  extraDetail?: string[];
}): RequirementResult {
  const usage = args.ctx.alloc.capUsage.get(args.capId);
  const relevant = args.ctx.classified.filter((c) => !c.superseded && c.caps.includes(args.capId));
  // Credits the cap DISCARDS. A row that loses a student credit must never
  // present as an unqualified pass (interface review R2, 2026-09-18): these are
  // emitted as warning parts, so the report gives them their own treatment
  // instead of the grey prose they used to share with everything else.
  // Only what THIS cap refused (credit-transfer review 2026-10-28, #11): a
  // course another cap cut is named, with that cap, on its own line and on
  // the §5.2 card — listed here too, it read "beyond the allowance" beside a
  // meter with room left. Nor a §5.2 candidate: which candidates fill a cap is
  // the DGS's choice, not a refusal (DGS 2026-09-06).
  const excludedLines: DetailPart[] = args.ctx.alloc.perCourse
    .filter((p) => p.course.caps.includes(args.capId) && p.candidate !== true)
    .filter((p) => (p.excluded > 0 && (p.boundCaps ?? []).includes(args.capId)) || ((p.overCapToTotal ?? 0) > 0 && args.capId === 'noncse'))
    // Every number a student reads goes through formatCredits (credits.ts:
    // "never scientific notation, never '2.6666666666666665'"). These three
    // were raw (red-team 2026-09-13): one ordinary quarter-system transfer
    // course, converted by the sheet's own pro-rata factor, printed
    // "2.666666668 of the 9 non-CSE allowance credits used".
    .map((p) => ({
      warn:
        p.excluded > 0
          ? `${p.course.entry.courseId}: ${formatCredits(p.excluded)} ${p.excluded === 1 ? 'credit' : 'credits'} not counted — beyond the allowance`
          : // The non-CSE allowance limits regular-course credit only (F1,
            // 2026-09-12): what it refuses still counts toward the total.
            `${p.course.entry.courseId}: ${formatCredits(p.overCapToTotal ?? 0)} ${p.overCapToTotal === 1 ? 'credit' : 'credits'} beyond the allowance — count toward the total-credit requirement only`,
    }));

  let status: Status;
  let label: string | undefined;
  const parts: DetailPart[] = [];
  if (usage?.limit === undefined) {
    status = 'cannot_evaluate';
    parts.push(args.limitKey !== undefined ? missingParamDetail(args.limitKey) : 'Cannot evaluate — the limit is unknown');
  } else if (relevant.length === 0) {
    // "Does not apply — No courses touch this cap" read as an EXEMPTION from
    // §4.2's limit (blue-team B4, 2026-09-18). The allowance applies; it is
    // simply unused, and the row says so in the same shape as when it is used.
    // The status stays not_applicable — an unused allowance is not a
    // requirement to meet, so it must not join the score — and only the pill's
    // wording changes, through the same override as W-CS2.
    status = 'not_applicable';
    label = 'Not used yet';
    parts.push(`${formatCredits(0)} of the ${formatCredits(usage.limit)} ${args.capLabel} used`);
  } else {
    // Only a course the allowance actually admits is worth an approval: one
    // refused as beyond it is told so on its own line, not sent to seek an
    // approval that cannot help (clarity review 2026-09-26).
    // Any credit the allowance admits, toward the 24 or toward the total only
    // — a seminar, research or independent-study course drawing on it waits
    // for its approval like a regular one (credit-transfer review 2026-10-28, #13).
    const admitted = (c: (typeof relevant)[number]): boolean => admittedBy(args.ctx.alloc.perCourse.find((p) => p.course === c), args.capId) > 0;
    const pending = relevant.filter((c) => c.approvalPending && admitted(c));
    status = args.approvalDriven && pending.length > 0 ? 'needs_dgs_review' : 'met';
    parts.push(`${formatCredits(usage.used)} of the ${formatCredits(usage.limit)} ${args.capLabel} used`);
    if (pending.length > 0) {
      parts.push(`needs approval: ${pending.map((c) => c.entry.courseId).join(', ')}`);
    }
    // A tick is what cleared these (P1-levels-grades-credits-30, 2026-10-03):
    // the row stays Met, and says the approval is the student's own word.
    const ticked = relevant.filter((c) => c.tickApproved && admitted(c) && !holdAwaitsRuling(c));
    if (ticked.length > 0) {
      parts.push(`approved by the DGS, as you ticked: ${ticked.map((c) => c.entry.courseId).join(', ')} — the DGS office holds the record`);
    }
    parts.push(...excludedLines);
  }
  // What the number does not say on its own is explanation (DGS 2026-10-03).
  if (usage?.limit !== undefined) parts.push(...(args.extraDetail ?? []).map((note) => ({ note })));
  // What each course draws on this allowance (2026-09-22): the regular-course
  // credits it counts, or every counted credit for a transfer cap and for the
  // credits shared with another degree (2026-10-04).
  // What the allowance admitted of each course, so the list adds up to the
  // meter: the non-CSE nine is charged what it counted, every other cap the
  // credit that counts anywhere (allocate.ts take(); #13).
  const contributions = courseContributions(args.ctx, (p) => (p.course.caps.includes(args.capId) ? admittedBy(p, args.capId) : 0));
  return {
    id: args.id,
    group: args.group,
    title: args.title,
    status,
    ...(label ? { statusLabel: label } : {}),
    // An allowance, drawn as a meter (DGS 2026-09-27).
    allowance: true,
    ...(usage?.limit !== undefined ? { progress: { have: usage.used, need: usage.limit, unit: 'credits' } } : {}),
    ...joinedDetail(parts),
    citation: { section: args.section, quote: args.quote },
    ...(contributions.length > 0 ? { contributions } : {}),
  };
}

/** DGS Handbook §8.2.5: "Notre Dame requires students to be enrolled and
 * registered for the term in which they defend their theses or
 * dissertations"; Academic Code §3.7 requires registration in the semester of
 * graduation, "this includes the summer session" (policy review 2026-10-04,
 * P2-dh-6-9-5; DGS: "Apply the suggested handling"). A pointer only, never a
 * status change: a dated defense in a semester with no Notre Dame course on
 * the record and no full-time tick for it. Research registrations are often
 * not typed in, so a missing row is not proof the student was unregistered. */
export function defenseRegistrationNote(ctx: Ctx, defendedOn: string | undefined): DetailPart[] {
  if (defendedOn === undefined) return [];
  const term = termOfDate(defendedOn);
  const key = termIndex(term);
  const registered =
    ctx.student.courses.some((c) => c.origin === 'nd' && termIndex(c.term) === key) || (ctx.student.fullTimeTermOverrides ?? []).some((t) => termIndex(t) === key);
  if (registered) return [];
  return [{ note: `No Notre Dame course is entered for ${termLabel(term)}, the semester of your defense: Notre Dame requires registration in the term you defend — confirm your registration with the Grad Admin (DGS Handbook §8.2.5; Academic Code §3.7)` }];
}
