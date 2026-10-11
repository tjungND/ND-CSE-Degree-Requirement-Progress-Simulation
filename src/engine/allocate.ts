// Credit classification and cap allocation.
//
// Every entered course is first CLASSIFIED: which pool it can fill (regular /
// project / seminar / total-only / none), which credit caps it consumes, and how
// certain its credit is (definite / in progress / provisional — see status.ts).
// Then ALLOCATION fills the caps at credit granularity, order-independently:
// uncapped and single-cap credits greedily (provably optimal by an exchange
// argument), the rare multi-cap courses by exact search — never the prototype's
// entry-order greedy, where re-sorting the course list changed the verdict.
import { formatCredits } from './credits.ts';
import { canonicalCourseId, isIncompleteCourseId, resolveRuleRow } from '../data/assemble.ts';
import { approverToken, needsCourseApproval } from './decider.ts';
import { NOTRE_DAME_ROW_UNIVERSITY, findExternalRule, isCseCourse, isNotreDameInstitution, ndEquivalentCredits, needsApproval, normalizeUniversity, transferableFor, universityCreditSystem, creditSystemFactor, creditSystemFactorLabel } from '../data/external.ts';
import type { Counts, ExternalRule, RuleCourse, Rules, Transferable } from '../data/types.ts';
import { coreTitleSuggestion } from './core-title.ts';
import { GRADES, GRADE_POINTS, isAudit, isInProgress, isPassed, isWithdrawn, meetsGradeFloor, passesCreditFloor } from './grades.ts';
import type { Tier, TierSums } from './status.ts';
import { ZERO_SUMS } from './status.ts';
import { isEarlyStartCourse } from './early-start.ts';
import { addDaysIso, addYearsIso, compareTerm, endOfTerm, normalizeEntryTerm, semesterNumber, shiftTermYears, startOfTerm, termIndex, termLabel, termOfDate } from './term.ts';
import type { Attestations, CourseEntry, Grade, NdPosting, Program, Student, Term } from './types.ts';
import { ndPostingOf, pairedBlockRows, sameTransferCourse } from './nd-posting.ts';
import { isCovidCohort } from './requirements/context.ts';

/** `nondegree` (2026-10-03): Academic Code §2.3 — "No more than 12 credit hours
 * earned by a student while in non-degree status may be counted toward a degree
 * program." A Graduate School number, so it lives in code (as §3.5's six does,
 * DGS 2026-09-27), not in the Parameters tab. */
export type CapId = 'fourk' | 'noncse' | 'transfer' | 'sharedbs' | 'nondegree' | 'otherdegree' | `term:${number}`;
export const NON_DEGREE_CREDITS_MAX = 12;

/** `otherdegree` (2026-10-04, policy review P2-ac-1-3-2): Academic Code §2.2 —
 * "No more than nine credit hours of classes from any one master's degree may
 * be counted toward any other graduate degree" (DGS Handbook §2.9: the same
 * nine). For a student enrolled in two Notre Dame programs at once, the
 * courses ticked as also counting toward the other degree. A Graduate School
 * number, so it lives in code beside NON_DEGREE_CREDITS_MAX. */
export const DUAL_DEGREE_SHARED_CREDITS_MAX = 9;
/** `sharedbs`: Academic Code §4.6 — "students in an integrated
 * bachelor's/master's degree program may count up to six graduate-level
 * credits toward both degrees" (CSE §3.5's "one or two 3-credit CSE regular
 * courses" is the same six; the Ph.D.'s six counted toward two degrees is the
 * Graduate School's 2026-09-22 answer, and the same six). A Graduate School
 * number, so it lives in code (DGS 2026-09-27: "can't be changed by DGS …
 * rooted in the code"; policy review round 3, P3-sheet-5 / P3-sheet-6 (c);
 * DGS 2026-10-07: option (a)). It was the Parameters row
 * `ms_bs_double_count_credits_max` until then (RETIRED_PARAMETER_KEYS). */
export const BS_SHARED_CREDITS_MAX = 6;

/** `term:<termIndex>` (2026-10-03): Academic Code §3.8 "Maximal Registration"
 * — "During each semester of the academic year, a graduate student should not
 * register for more than 15 credit hours of graduate courses, i.e., 60000
 * through 90000-level courses. In the summer session, a graduate student
 * should not register for more than 10 credit hours." The DGS Handbook (§3.9)
 * says "may not"; a credit overload is the Registrar's eForm (§3.10.1).
 * DGS 2026-10-03 (P1-residency-enrollment-c4): "Change the code and cap a
 * semester's credits by following the graduate school's academic code and
 * the DGS handbook." Graduate School numbers, in code like §2.3's twelve. */
export const SEMESTER_GRADUATE_CREDITS_MAX = 15;
export const SUMMER_CREDITS_MAX = 10;

/** A Notre Dame semester of the program whose countable registrations exceed
 * §3.8's maximum: graduate courses (60000-90000) in a fall or spring, every
 * course in a summer session. */
export interface OverMaxTerm {
  term: Term;
  credits: number;
  max: number;
  /** The student ticked "a credit overload was approved" for this term: no cap. */
  overloadApproved: boolean;
  /** The courses the cap applies to, in the order entered. */
  courses: ClassifiedCourse[];
}

/** The semesters over §3.8's maximum. Pure — the audit turns each one the
 * student has not marked as an approved overload into a cap (registrationCaps);
 * the milestones card reads it to offer the overload tick. Only courses that
 * could count are summed (a W, a failed grade, an ineligible row or a same-term
 * duplicate takes nothing from the cap), and only from the entry term on — an
 * undergraduate semester before the program is not a graduate registration.
 * The early-start summer just before a fall entry is one: its courses are the
 * program's (P3-chg-other-1; DGS 2026-10-05), and its student is "considered
 * fulltime … in the summer with any registration" (Academic Code §3.6). */
export function overMaxTerms(classified: readonly ClassifiedCourse[], student: Student, entry: Term): OverMaxTerm[] {
  const approved = new Set((student.creditOverloadTerms ?? []).map((t) => termIndex(t)));
  const byTerm = new Map<number, { term: Term; credits: number; courses: ClassifiedCourse[] }>();
  for (const cc of classified) {
    const c = cc.entry;
    if (c.origin !== 'nd' || (termIndex(c.term) < termIndex(entry) && !isEarlyStartCourse(c, student))) continue;
    if (cc.pool === 'none' || cc.superseded || cc.withdrawn || cc.audited || cc.unrecognizedGrade || !passesCreditFloor(c.grade)) continue;
    if (c.term.season !== 'summer' && !(levelOf(c, cc.rule) >= 6)) continue;
    const key = termIndex(c.term);
    const rec = byTerm.get(key) ?? { term: c.term, credits: 0, courses: [] };
    rec.credits += c.credits;
    rec.courses.push(cc);
    byTerm.set(key, rec);
  }
  const out: OverMaxTerm[] = [];
  for (const [key, rec] of [...byTerm.entries()].sort((a, b) => a[0] - b[0])) {
    const max = rec.term.season === 'summer' ? SUMMER_CREDITS_MAX : SEMESTER_GRADUATE_CREDITS_MAX;
    if (rec.credits > max) out.push({ term: rec.term, credits: rec.credits, max, overloadApproved: approved.has(key), courses: rec.courses });
  }
  return out;
}

/** The caps for those semesters, attached to their courses (the audit's own
 * classified list). The allocator then counts at most `max` credits from the
 * semester — the courses entered first fill it — and each line beyond it reads
 * "over the 15-credit semester maximum for Fall 2026 (Academic Code §3.8)". */
export function registrationCaps(over: readonly OverMaxTerm[]): CapSpec[] {
  const caps: CapSpec[] = [];
  for (const o of over) {
    if (o.overloadApproved) continue;
    const id: CapId = `term:${termIndex(o.term)}`;
    caps.push({ id, limit: o.max, label: `${o.max}-credit ${o.term.season === 'summer' ? 'summer-session' : 'semester'} maximum for ${termLabel(o.term)}`, section: 'Academic Code §3.8' });
    for (const cc of o.courses) if (!cc.caps.includes(id)) cc.caps = [...cc.caps, id];
  }
  return caps;
}

/** Academic Code §4.4: an Incomplete has "30 calendar days from when grades
 * were due … The instructor of record then has 14 calendar days to report the
 * grade" — after that it "will be changed permanently to a grade of F". The
 * app does not know when grades were due, so the nominal end of the term
 * stands in for it and the date is marked approximate like every other. */
export const INCOMPLETE_GRACE_DAYS = 30 + 14;
export function incompleteDeadline(term: Term): string {
  return addDaysIso(endOfTerm(term).date, INCOMPLETE_GRACE_DAYS);
}

export interface CapSpec {
  id: CapId;
  /** undefined = the Parameters tab is missing the cap → treated as 0 here and
   * surfaced as "cannot evaluate" on the cap's requirement row. */
  limit: number | undefined;
  /** e.g. "6-credit 40000-level cap" */
  label: string;
  section: string;
}

export type Pool = 'regular' | 'project' | 'seminar' | 'total_only' | 'none';

export interface ClassifiedCourse {
  entry: CourseEntry;
  rule?: RuleCourse;
  pool: Pool;
  ineligibleReason?: string; // when pool === 'none'
  caps: CapId[];
  tier: Tier;
  /** Needs advisor/DGS sign-off (dgs_approval row, unknown course, non-CSE, transfer). */
  approvalPending?: string;
  unknown?: boolean;
  /** A `yes` in the sheet for a transfer course (DGS 2026-09-27): counted
   * outright, with this note on its line — the Grad Admin still records it. */
  approvedNote?: string;
  superseded?: boolean;
  /** Who said the credits were quarter hours: the DGS's ExternalCourses row,
   * or the transcript's own term headers (2026-09-11). */
  creditSystemSource?: 'sheet' | 'transcript' | 'student';
  /** Transfer rows only (F5, 2026-09-12): the DGS has reviewed this course —
   * an ExternalCourses verdict, or a Courses-tab row for a Notre Dame course —
   * so the §5.2 checkbox can settle it. */
  reviewed?: boolean;
  /** Notre Dame coursework that is not §5.2 transfer credit even though it
   * earns nothing (a regular bachelor's 60000-level course; a pre-entry
   * course with no prior program on record — 2026-09-12): the transfer row
   * neither lists nor counts it. */
  notTransferCredit?: true;
  /** Coursework from the student's own Notre Dame MSCSE, on a Ph.D. record
   * (Graduate School through the DGS, 2026-09-22): a move from a master's to
   * a Ph.D. in the same discipline counts ALL the credits — beyond §5.2's
   * twenty-four and without transfer approval — so the course is counted by
   * the Courses tab's verdict alone, and its line says why. */
  ndMastersCredit?: true;
  /** Which non-semester system the credits were converted from (F6, 2026-09-12). */
  convertedFrom?: 'quarter' | 'trimester';
  /** The factor used for that conversion — the Graduate School's (DGS Handbook
   * §3.14), in code since 2026-10-04 (data/external.ts). */
  conversionFactor?: number;
  /** MSCSE only: how a Notre Dame course taken as an undergraduate is applied
   * — to both degrees (inside §3.5's shared credits) or to the MSCSE alone.
   * Chosen by the app, never by the student (DGS 2026-09-11). */
  bsShare?: 'both' | 'mscse';
  /** The grade is not one the app knows (an 'X' from a hand-edited file): the
   * row is not a registration the residency count may use (2026-09-11). A W
   * or an I IS a registration since 2026-10-03 and is not flagged here. */
  unrecognizedGrade?: boolean;
  /** Audited (grade V): earns nothing and is not a registration toward the
   * semester's full-time status (residency.ts) — 2026-10-04. */
  audited?: true;
  /** Withdrawn (W): a registration that earns nothing (Academic Code §4.2);
   * the full-time count still sees it (§3.3), and a semester of nothing but
   * withdrawals is sent to the DGS rather than counted (policy review 2026-10-03). */
  withdrawn?: true;
  /** An Incomplete still inside its 30 + 14 days (Academic Code §4.4): the
   * date it lapses, for the course line. */
  incompleteDue?: string;
  /** An Incomplete of a student in the Spring 2020 cohort (policy review
   * round 3, P3-cse-5-6-4; DGS 2026-10-07: option (b)): the deadline stays
   * 30 + 14 days, and the line notes that Academic Code Appendix A.1 may give
   * 60 days, for the DGS to confirm. */
  incompleteCohortNote?: true;
  /** An Incomplete past that date: an F unless the Graduate School extended
   * it — counted provisionally and sent to the DGS. */
  incompleteLapsed?: true;
  /** An Incomplete in the semester the student plans to graduate (policy
   * review round 3, P3-dh-3.1-3.13-3; DGS 2026-10-06): the Graduate School
   * confers the degree only with no I grades in that semester (DGS Handbook
   * §3.23.1), so the course line says so. */
  incompleteInGraduationTerm?: true;
  /** Shared with the student's other degree, and the Graduate School has yet
   * to approve the dual-degree plan of study — that is ALL it waits for
   * (policy review round 3, P3-dh-front-1-2-2; DGS 2026-10-06): no DGS
   * decision is open, so it stays out of the review request and the DGS's
   * to-dos (DGS Handbook §2.9: "The plan must then be approved by the
   * Graduate School"). */
  dualPlanOnly?: true;
  /** A transfer graded S (pass): a pass/fail mark cannot show the B §5.2
   * criterion 4 requires, so the course waits for the DGS (DGS 2026-10-03). */
  passFailGrade?: true;
  /** A course from another university dated at or after the entry term: the
   * Graduate School requires the department's and its own approval BEFORE
   * such a course is taken (DGS Handbook §3.14) — the DGS confirms. */
  afterAdmission?: true;
  /** A course from another university on the record of a student with NO
   * earlier graduate program: the Academic Code states a transfer allowance
   * only for an unfinished (6) or a completed (9/24) program (§4.6), none for
   * graduate courses taken outside any program — so the DGS decides (DGS
   * 2026-10-03: "route such courses to DGS review"). */
  noPriorProgram?: true;
  /** §5.2's five-year window for a student who finished the Notre Dame MSCSE
   * before the Ph.D. counts back from the MSCSE admission (policy review round
   * 3, P3-prior-programs-4; DGS 2026-10-07: option (b)), and this record does
   * not show when the MSCSE began (no MSCSE course on it) — a course outside
   * the Ph.D.'s window may be inside it, so the DGS decides. */
  windowStartUnknown?: true;
  /** One of the courses drawing on §5.2's allowance when they come from two
   * earlier graduate programs (policy review round 3, P3-prior-programs-3;
   * DGS 2026-10-07: option (3)): the documents do not say how two programs'
   * allowances combine, so every such course waits for the DGS. */
  twoPrograms?: true;
  /** An Incomplete from another university (P3-ac-4-1; DGS 2026-10-05): held
   * for the DGS until it is graded — never on Notre Dame's §4.4 clock. */
  outsideIncomplete?: true;
  /** A course from another university the sheet cannot place inside or
   * outside CSE (no `is_cse` cell, no `cse_subject_codes` list): §4.2's
   * nine-credit non-CSE allowance depends on the answer, so the course waits
   * for the DGS rather than counting as CSE by default (DGS 2026-10-03: a
   * non-CSE transfer "needs to follow the sheet's rule"). */
  cseUnknown?: true;
  /** Transfer credit the Notre Dame record shows as accepted (P3-import-1;
   * DGS 2026-10-05, Option 1): the posting this course carries — its own, or
   * that of the transcript-block row it was paired with. */
  ndPosting?: NdPosting;
  /** …and why such credit still waits for the DGS (its level is not shown, or
   * it was recorded before this program began). The DGS's answer for this
   * student is the tick on the course. */
  ndPostingHeld?: string;
  /** A course from another university whose credit system is unknown — no
   * ExternalCourses row, a row with a blank `credit_system`, or a value the
   * sheet parser rejected — and no `nd_credits`: its credits are shown as the
   * transcript prints them, and the line says so (DGS 2026-10-03,
   * P1-units-4plus1-c7: "whenever credit_system is blank or not recognized,
   * not only when the row is missing"). */
  creditsAsPrinted?: true;
  /** The student's own tick on the course is what settled a case-by-case
   * approval (DGS 2026-09-27) — the line and the rows a tick flips to Met keep
   * saying so (policy review 2026-10-03, P1-levels-grades-credits-30: the
   * approval is self-attested; the DGS office holds the record). */
  tickApproved?: true;
  /** A Notre Dame graduate course from before admission, taken in non-degree
   * status (Academic Code §2.3): counted provisionally inside the 12-credit
   * allowance, sent to the DGS. */
  nonDegree?: true;
  /** A 4+1's extra (unshared) graduate course the transcript does not show
   * moved from UG to GR registration — the Graduate School counts it only once
   * it was "officially transferred" before the bachelor's was conferred (4+1
   * guidance; policy review 2026-10-03). */
  ugToGrUnverified?: true;
  /** Notre Dame coursework taken as an undergraduate, listed in the course
   * rules, that waits (or waited) on an approval the DGS gives for THIS
   * student — the UG→GR move, the Code's §4.6 advance approval, the BS + Ph.D.
   * double count, §3.5's non-CSE course, an admission term the transcript
   * contradicts: the course carries the "The DGS approved this course for me"
   * tick (DGS 2026-10-08), and the tick settles them. */
  dgsApprovalAsked?: true;
  /** …and the tick settled such an approval (said on the line). */
  dgsTicked?: true;
  /** A 4+1's unshared graduate course the transcript registers GR (moved from
   * UG to GR, which happens before the bachelor's is awarded) on a record whose
   * answered Integrated-program admission is AFTER the bachelor's — the two
   * facts conflict, so it counts provisionally, the DGS confirms, and the
   * student is asked to recheck the term (policy review round 3,
   * P3-fourplusone-2; DGS 2026-10-07: option (2)). */
  admissionTermConflict?: true;
  /** A Notre Dame graduate course from before admission on a record whose
   * earlier graduate program was at ANOTHER university (policy review round
   * 3, P3-dh-3.14-3.20-3; DGS 2026-10-06: option (c)) — not credit from an
   * earlier Notre Dame program, and possibly non-degree coursework (Academic
   * Code §2.3's twelve): it waits for the DGS, with no §5.2 projection. */
  ndBeforeAdmission?: true;
  /** Coursework dated before an interruption of five years or more (Academic
   * Code §5.5: "Credit for any course or examination will be forfeited"),
   * sent to the DGS rather than counted or refused (policy review 2026-10-03). */
  interrupted?: true;
  /** …the same, because the student's own Notre Dame MSCSE ended five years
   * or more before the Ph.D. began (DGS 2026-10-06, with policy review round
   * 3, P3-cse-5-6-3): `interrupted` is set too, so every reader of a forfeited
   * course treats it alike; this flag only words it. */
  mscseSeparated?: true;
  /** Program coursework dated before a readmission after a shorter gap — a
   * withdrawal, or a fall or spring semester the student did not register for
   * (DGS Handbook §3.3: "the program may require the student to reapply. The
   * program may also reserve the right to reject some or all past credits").
   * Counted provisionally and sent to the DGS (policy review 2026-10-04,
   * P2-dh-3.1-3.13-4). */
  beforeReadmission?: true;
  /** Transfer-only: the DGS's ExternalCourses ruling for this course, when one
   * exists (attached even when the course earns no credit, so §4.4.1 core
   * knowledge can still see a DGS-confirmed course). */
  external?: ExternalRule;
  /** Transfer-only: the §5.2 ruling that applies to THIS student — the sheet
   * decides transferability separately for a Ph.D. and an MSCSE student
   * (2026-09-09). Resolved here, once, so nothing downstream has to know the
   * student's program or which column to read. */
  transferable?: Transferable;
  /** Transfer-only: the DGS's ND-equivalent credit value (ExternalCourses
   * nd_credits, or converted from the university's quarter system — §5.2
   * "pro-rata"); counting uses this instead of the credits
   * printed on the transcript. */
  effectiveCredits?: number;
  /** True when effectiveCredits came from converting the university's quarter
   * hours rather than from a fixed nd_credits (2026-09-08) — the line says
   * which, so a student can tell a conversion from the DGS's own figure. */
  creditsConverted?: true;
}

/** The colour of a course's line (DGS request 2026-09-06 — "pending review
 * amber, counts after review green, does not count red"): `counts` = credit
 * (or a §4.4.1 core area) is earned now; `in_progress` = taken now, credit
 * once it is passed; `pending` = counted only provisionally until an
 * advisor/DGS approval; `excluded` = earns nothing (over a cap, failed,
 * ineligible, not relevant).
 *
 * `in_progress` and `pending` were one amber mark until 2026-09-13, when the
 * DGS asked for the three states to be told apart: a course being TAKEN and a
 * course waiting on someone's signature are different things to a student
 * reading their own report, and only one of them is theirs to act on. */
export type CourseMark = 'counts' | 'in_progress' | 'pending' | 'excluded';

export interface CourseAllocation {
  course: ClassifiedCourse;
  countedRegular: number;
  countedOther: number; // project / seminar / total_only credits
  excluded: number;
  excludedReason?: string;
  /** Credits the non-CSE allowance refused that still count toward the
   * total-credit requirement (F1, 2026-09-12) — part of `countedOther`. */
  overCapToTotal?: number;
  explanation: string; // the per-course line shown to the student
  mark: CourseMark;
  /** What the course does for the Ph.D. qualifier (§4.4.1), when that is a
   * separate fact from the credit (DGS 2026-09-27): its own line, its own
   * mark. Absent on the MSCSE tab and on a line that is only about the
   * qualifier. */
  qualifier?: { mark: CourseMark; text: string };
}

export interface AllocationResult {
  perCourse: CourseAllocation[];
  /** Credits counted toward the regular-course requirement, per certainty tier. */
  regular: TierSums;
  project: TierSums;
  seminar: TierSums;
  totalOnly: TierSums;
  /** Passed/IP/provisional credits toward the 30/60 "courses and research" total. */
  total: TierSums;
  /** Regular-pool credits taken at Notre Dame (§4.2's nine-at-ND check). */
  ndRegular: TierSums;
  /** Research-ish credits taken at Notre Dame — courses the rules sheet types
   * 'research' or 'project' (thesis/project direction, research &
   * dissertation). The §4.5 along-the-way MSCSE needs 6 of these (DGS
   * decision 2026-09-04); independent study does not count. */
  ndResearch: TierSums;
  /** Counted transfer credits (all provisional unless attested). */
  transfer: TierSums;
  capUsage: Map<CapId, { used: number; limit: number | undefined; excluded: string[] }>;
}

const deptOf = (id: string) => canonicalCourseId(id).split(' ')[0] ?? '';
/** The course's level digit: the sheet row's `level` when there is one, else
 * the first digit of the five-digit number; NaN when the id has no such number. */
export const levelOf = (course: CourseEntry, rule?: RuleCourse): number => {
  if (rule?.level !== undefined) return rule.level;
  const m = /(\d)\d{4}\b/.exec(course.courseId);
  return m ? Number(m[1]) : NaN;
};

/** Could this Notre Dame course, taken as an undergraduate, count toward the
 * degree being audited? The transcript preview has to decide whether a row is
 * worth showing before the engine ever sees it, and the answer must be the
 * engine's own — the level floor below, plus the sheet's "does not count"
 * (2026-09-11). It says "could", not "does": the answer to the "already
 * counted toward…" question and the caps decide the rest. */
export function priorNdUndergraduateCanCount(course: CourseEntry, rule: RuleCourse | undefined, program: Program): boolean {
  if (!undergradLevelEligible(levelOf(course, rule), course.courseId, rule)) return false;
  if (rule === undefined) return true; // not in the sheet: counted provisionally, and the DGS is asked
  return (program === 'mscse' ? rule.countsTowardMscse : rule.countsTowardPhd) !== 'no';
}

/** A Notre Dame course filed as taken as an undergraduate (in or before the
 * bachelor's term) that can count — the branch of classifyTransfer that never
 * reads the Academic Code §2.3 non-degree answer, so the page does not ask
 * that question about it (UI review, 2026-10-08). One test for both. */
export function ndUndergraduateCounting(course: CourseEntry, rule: RuleCourse | undefined, bachelorsAwarded: Term | undefined): boolean {
  const asUndergraduate = course.degreeLevel === 'bachelors' || (bachelorsAwarded !== undefined && compareTerm(course.term, bachelorsAwarded) <= 0);
  return asUndergraduate && isNotreDameInstitution(course.institution) && undergradLevelEligible(levelOf(course, rule), course.courseId, rule);
}

/** The level floor for Notre Dame coursework taken as an undergraduate: 60000
 * and above; CSE at the 40000 level; CSE at the 50000 level only when the
 * sheet lists the course. */
function undergradLevelEligible(level: number, courseId: string, rule: RuleCourse | undefined): boolean {
  return level >= 6 || (deptOf(courseId) === 'CSE' && (level === 4 || (level === 5 && rule !== undefined)));
}

/** What a sheet row's verdict still asks of this student: undefined when the
 * course counts outright (or the matching checkbox is ticked), else the
 * approval-pending reason the course line carries. `level` is whatever the
 * caller reads as the course's level — the row's own, or the number's digit. */
function approvalStatus(counts: Counts | undefined, approved: boolean): string | undefined {
  // `approved` is the course's own tick (DGS 2026-09-27): it settles a
  // case-by-case verdict and nothing else — a `yes` needs none, a blank cell
  // is the DGS's to fill first.
  const approvalAttested = approved;
  return counts === undefined
    ? 'the course rules do not say whether it counts — needs DGS review'
    : needsCourseApproval(counts)
      ? approvalAttested
        ? undefined
        : `needs advisor + ${approverToken(counts)} approval per the course rules`
      : undefined;
}

/** §3.2 (September 2026 edition): "Up to six (6) credits at the 40000 level may
 * count … subject to approval by the advisor and the ADGS." From 2026-10-02 to
 * 2026-10-03 this made every MSCSE credit below the 60000 level wait for the
 * course's tick, a `yes` row included. DGS 2026-10-03 (P1-levels-grades-
 * credits-8): the two programs are the same — a `yes` in the course rules IS
 * the ADGS's pre-approval, `adgs_approval` means the course may count after the
 * ADGS approves it for this student (the per-course tick), and the advisor's
 * approval is the plan-of-study box; the six-credit allowance still limits a
 * pre-approved course. So nothing is left for this function to add. */

/** How an EARLIER NOTRE DAME course may count once it transfers in under §5.2
 * (2026-09-09), read from its own Courses-tab row — the same reading classify()
 * makes for a course taken in the program. Until this existed every transfer
 * landed in the regular pool, so a prior Notre Dame research or thesis course
 * counted toward §4.2's twenty-four REGULAR credits, which §4.2 excludes in as
 * many words ("Research seminar, research credits, and other similar courses
 * do not count as regular courses"), and a prior 40000-level course never
 * touched §4.2's six-credit 4xxxx cap.
 *
 * Only Notre Dame's own courses are read this way: the Courses tab describes
 * Notre Dame's catalogue, and a course from another university that happens to
 * share a Notre Dame number is not the same course. */
function priorNdShape(
  courseId: string,
  rule: RuleCourse,
  program: Program,
  approved: boolean,
): { pool: Pool; caps: CapId[]; approvalPending?: string } | { ineligibleReason: string } {
  const counts = program === 'mscse' ? rule.countsTowardMscse : rule.countsTowardPhd;
  const programName = program === 'mscse' ? 'MSCSE' : 'Ph.D.';
  if (counts === 'no') {
    // A verdict names the policy, "the course rules"; "rules sheet" is kept only where
    // the spreadsheet itself is the object, e.g. a missing parameter (trim review
    // 2026-09-18, P-54 — the same rename at the seven sibling verdicts below).
    return { ineligibleReason: `not counted — the course rules say this course does not count toward the ${programName}` };
  }
  const isCse = deptOf(courseId) === 'CSE';
  // The sheet row's verdict is read the same way for a course taken before
  // the program as for one taken in it (DGS 2026-09-11): `dgs_approval` is a
  // decision about the COURSE, not about this student, so the course counts
  // provisionally and stays in the review request until the approval exists.
  // Nearly every 40000-level row says `dgs_approval` for the MSCSE, which is
  // what makes an earlier Notre Dame undergraduate 40000-level course
  // something that MAY count — listed, never counted silently.
  // Below the 40000 level nothing earns graduate credit, whatever the sheet's
  // verdict cell says (Academic Code §4.1; policy review 2026-10-03 — the
  // guard used to exist for UNLISTED courses only).
  if (rule.level !== undefined && rule.level < 4) {
    return { ineligibleReason: 'not counted — below the 40000 level; no course under 40000 earns graduate credit (Academic Code §4.1)' };
  }
  // §3.6.1 for the MSCSE, whatever the cell says (DGS 2026-10-03) — as in classify().
  if (program === 'mscse' && rule.level === 5 && isCse) {
    return { ineligibleReason: 'not counted — a 50000-level CSE course is preparatory and does not count toward the MSCSE, whatever the course rules say (§3.6.1)' };
  }
  const belowSixty = rule.level === 4 || rule.level === 5;
  // Every course below 60000 draws the six-credit allowance, whatever its type
  // (Academic Code §4.1: "40000 – 59999 may be taken to satisfy up to six hours
  // of graduate credit requirements"; DGS 2026-10-03) — a research or
  // independent-study row at that level used to escape the cap.
  const approvalPending = approvalStatus(counts, approved);
  const shape =(pool: Pool, caps: CapId[]) => ({ pool, caps, ...(approvalPending !== undefined ? { approvalPending } : {}) });
  // The id decides for §3.2's two project courses, here as in the program (2026-09-11).
  if (program === 'mscse' && isMsProjectCourse(courseId)) return shape('project', []);
  if (belowSixty && !isCse) {
    // Cited to the degree's own section, not the decision date (policy review
    // 2026-10-03, P1-page-text-engine-20): §3.2/§4.2 admit non-CSE credit only
    // "at the 60000 level or higher".
    return { ineligibleReason: `not counted — non-CSE ${rule.level}0000-level courses do not count (${program === 'mscse' ? '§3.2' : '§4.2'})` };
  }
  // §3.2 (September 2026) caps non-CSE credit at nine toward the 30 as well as
  // the 24, so for the MSCSE every non-CSE course draws it, seminars and
  // research included (DGS 2026-10-03); §4.2 scopes the Ph.D.'s nine to the
  // course requirement, so only its regular courses do.
  const nonCse: CapId[] = !isCse && (program === 'mscse' || rule.courseType === 'regular') ? ['noncse'] : [];
  const levelCaps: CapId[] = [...(belowSixty ? (['fourk'] as CapId[]) : []), ...nonCse];
  switch (rule.courseType) {
    case 'regular':
      return shape('regular', levelCaps);
    case 'project':
      return shape('project', levelCaps);
    case 'seminar':
      return shape('seminar', levelCaps);
    case 'research':
    case 'independent':
      return shape('total_only', levelCaps);
  }
}

/** §3.2 names the M.S. project and thesis-direction courses by NUMBER — "six
 * (6) credit hours of Masters project (CSE 68902) or Masters thesis direction
 * (CSE 68901)" — so for the MSCSE the course id decides, not the Courses tab's
 * `course_type` cell (DGS 2026-09-11: "change the rule so that students can
 * take 6 credits of CSE 68902 or 6 credits of CSE 68901. Ignore the course
 * type."). The live sheet types CSE 68901 as `research`, which put every
 * thesis-option student's credits in the total-only pool and left §3.2's six
 * credits reading "0 of 6" while the row told them to register for it.
 *
 * Six credits of either course satisfies the row, and so does a mix of the
 * two. The Ph.D. is untouched: §3.2 is the master's section, and a Ph.D.
 * student's thesis-direction credits are research credits. */
const MS_PROJECT_COURSE_IDS = ['CSE 68901', 'CSE 68902'];
/** The project-course test, on the canonical id at every site (DGS 2026-09-20): the
 * entry form canonicalises ids, so this only matters for a hand-edited save file
 * with "cse 68902" — which used to be a project course on one path and not another. */
const isMsProjectCourse = (courseId: string): boolean => MS_PROJECT_COURSE_IDS.includes(canonicalCourseId(courseId));

function tierFor(grade: Grade, provisional: boolean): Tier {
  if (provisional) return 'provisional'; // worst uncertainty dominates
  if (isInProgress(grade)) return 'in_progress';
  return 'definite';
}

/** Academic Code §5.5: "Credit for any course or examination will be forfeited
 * if the student interrupts his or her program of study for five years or
 * more." A Graduate School number, so it lives here, not in the sheet. */
export const ACADEMIC_CODE_FORFEIT_YEARS = 5;

/** The readmission term, when the student was readmitted after an
 * interruption of five years or more (Academic Code §5.5) — measured from the
 * last Notre Dame term before the readmission.
 *
 * How the five years are counted (policy review round 3, P3-ac-5a-2; DGS
 * 2026-10-05: "Apply the suggested handling"): the time actually away, from
 * the END of that last term to the START of the readmission term.
 * (Subtracting the year numbers read Fall 2018 → Spring 2023, about four
 * years, as five.) The Code does not say how the years are counted — this
 * default is recorded for the DGS (DECISIONS 2026-10-05): Fall to Fall or
 * Spring to Spring five years apart is just under five years away, so it is a
 * shorter gap (DGS Handbook §3.3). Coursework from before it is held for the
 * DGS (classify), and so are the examinations passed before it (P3-ac-5a-3,
 * context.ts `beforeForfeiture`). */
export function longInterruptionReadmission(student: Student): Term | undefined {
  const readmitted = student.readmittedTerm;
  if (readmitted === undefined) return undefined;
  const lastBefore = student.courses
    .filter((c) => (c.origin === 'nd' || isNotreDameInstitution(c.institution)) && compareTerm(c.term, readmitted) < 0)
    .map((c) => c.term)
    .sort(compareTerm)
    .pop();
  if (lastBefore === undefined) return undefined;
  return startOfTerm(readmitted).date >= addYearsIso(endOfTerm(lastBefore).date, ACADEMIC_CODE_FORFEIT_YEARS) ? readmitted : undefined;
}

/** §5.2 / DGS Handbook §3.14: "A request for credit transfer is considered
 * only after a student has completed one semester in a Notre Dame graduate
 * degree program" (policy review round 3, P3-dh-3.14-3.20-4; DGS 2026-10-06:
 * "Apply the handling. My answer to the question is (b)."). Done once the
 * entry term has ended — the end the advisor deadline already uses
 * (milestone-deadlines.ts), so a spring entrant's summer counts as done; the
 * two copies of this test used to keep the summer in the spring semester.
 * And (b): a finished earlier Notre Dame graduate program already meets it —
 * the student's own MSCSE (or a 4+1's), or a degree finished in another
 * Notre Dame department. `byEarlierProgram` says which. */
export function firstSemesterComplete(student: Student, entry: Term, todayIso: string | undefined): { done: boolean; byEarlierProgram: boolean } {
  const byEarlierProgram = student.ndMasters !== undefined || (student.background?.graduate === 'nd-other' && student.background.finished === true);
  const ended = todayIso !== undefined && todayIso > endOfTerm(entry).date;
  return { done: ended || byEarlierProgram, byEarlierProgram: byEarlierProgram && !ended };
}

/** The student's own Notre Dame MSCSE coursework on a Ph.D. record: Notre
 * Dame courses dated before the Ph.D. began, after the bachelor's degree — or
 * before it, when the student says the course counted toward the MSCSE (a
 * 4+1's). Bachelor's-only courses are not the graduate program's. */
export function isOwnMscseCoursework(student: Student, c: CourseEntry): boolean {
  if (student.program !== 'phd' || student.ndMasters === undefined) return false;
  if (!(c.origin === 'nd' || isNotreDameInstitution(c.institution)) || c.degreeLevel === 'bachelors') return false;
  if (compareTerm(c.term, normalizeEntryTerm(student.entryTerm).term) >= 0) return false;
  const awarded = student.bachelorsAwarded;
  return awarded === undefined || compareTerm(c.term, awarded) > 0 || c.countedToward === 'mscse' || c.countedToward === 'both';
}

/** A course that draws on §5.2's transfer allowance and is not refused,
 * superseded or already held as outside any program. */
function drawsOnTransferAllowance(cc: ClassifiedCourse): boolean {
  return !cc.superseded && cc.ineligibleReason === undefined && cc.noPriorProgram !== true && cc.caps.includes('transfer') && cc.entry.degreeLevel !== 'bachelors';
}
/** The earlier graduate programs those courses come from, by university as
 * the record names it (folded, so "Purdue University" and "PURDUE UNIV" are
 * one) — an earlier Notre Dame program is one of them (P3-prior-programs-3). */
export function earlierTransferPrograms(classified: readonly ClassifiedCourse[]): string[] {
  const programs = new Map<string, string>();
  for (const cc of classified) {
    if (!drawsOnTransferAllowance(cc)) continue;
    const name = cc.entry.institution ?? '';
    const key = isNotreDameInstitution(name) ? 'NOTRE DAME' : normalizeUniversity(name);
    if (key !== '' && !programs.has(key)) programs.set(key, isNotreDameInstitution(name) ? 'an earlier Notre Dame program' : name);
  }
  return [...programs.values()];
}

/** CSE §5.2's "before the semester in which the graduate degree is conferred",
 * named once the student has entered the semester they plan to graduate in
 * (policy review round 3, P3-import-4; DGS 2026-10-07: option (b), "Term-aware
 * wording"). `closed`: that semester has begun. No count or status changes. */
export function conferralWindow(student: Student, todayIso: string | undefined): { before: string; closed?: Term } {
  const g = student.graduationTerm;
  if (g === undefined) return { before: 'before the semester your degree is conferred' };
  const before = `before ${termLabel(g)}, the semester you plan to graduate in`;
  return todayIso !== undefined && todayIso >= startOfTerm(g).date ? { before, closed: g } : { before };
}
/** The sentence once that semester has begun (P3-import-4 (b)). */
export function transferWindowClosedText(g: Term): string {
  return `you plan to graduate in ${termLabel(g)}, and §5.2 considers a transfer request only before that semester — if yours was not sent before then, ask the DGS`;
}

/** When the student's own Notre Dame MSCSE began, read from its earliest
 * course on the record — the admission §5.2's five-year window counts back
 * from (P3-prior-programs-4 (b)). Undefined without such a course. */
export function ownMscseStart(student: Student): Term | undefined {
  return student.courses
    .filter((c) => isOwnMscseCoursework(student, c))
    .map((c) => c.term)
    .sort(compareTerm)[0];
}

/** A separation of five years or more between the student's Notre Dame MSCSE
 * and the Ph.D. (DGS 2026-10-06, with policy review round 3, P3-cse-5-6-3: "If
 * a student finished MSCSE in Spring 2019 and come back to PhD in Fall 2026,
 * that can be treated as a separation from the graduate program that is 5
 * years or longer, so the prior credits/coursework may be forfeited. This
 * needs to be reviewed by DGS and approved by the graduate school. So, the
 * student must get an approval for all the credits/coursework to count
 * towards the PhD."). The Graduate School treats the CSE MSCSE and Ph.D. as
 * one graduate program (2026-10-03), so Academic Code §5.5 applies: "Credit
 * for any course or examination will be forfeited if the student interrupts
 * his or her program of study for five years or more." Measured as a
 * readmission's is: from the end of the MSCSE's last term (its award term, or
 * its last course) to the start of the Ph.D. Returns that last term, or
 * undefined when the gap is shorter or there is no Notre Dame MSCSE. */
export function mscseSeparation(student: Student): Term | undefined {
  if (student.program !== 'phd' || student.ndMasters === undefined) return undefined;
  const entry = normalizeEntryTerm(student.entryTerm).term;
  const last = [...student.courses.filter((c) => isOwnMscseCoursework(student, c)).map((c) => c.term), ...(student.ndMasters.term ? [student.ndMasters.term] : [])]
    .filter((t) => compareTerm(t, entry) < 0)
    .sort(compareTerm)
    .pop();
  if (last === undefined) return undefined;
  return startOfTerm(entry).date >= addYearsIso(endOfTerm(last).date, ACADEMIC_CODE_FORFEIT_YEARS) ? last : undefined;
}

/** Whether the sheet decides this course case by case — `dgs_approval` /
 * `adgs_approval` in the Courses tab for a Notre Dame course, or in the
 * ExternalCourses tab for a course from elsewhere — so that the DGS's answer
 * for THIS student is recorded on the course (DGS 2026-09-27). */
export function decidedCaseByCase(c: ClassifiedCourse, program: Program): boolean {
  // Credit on the Notre Dame record the DGS confirms for this student (P3-import-1, 2026-10-05).
  if (c.ndPostingHeld !== undefined) return true;
  if (c.entry.origin === 'transfer' && !isNotreDameInstitution(c.entry.institution)) return needsApproval(c.transferable);
  // A §5.2 candidate from an earlier Notre Dame program (policy review round
  // 3, P3-dh-10-2; DGS 2026-10-06: "Apply the suggested handling"): its
  // transfer verdict is its ExternalCourses row, so a `dgs_approval` there is
  // this student's to record — the Courses tab says only what the course is.
  if (c.entry.origin === 'transfer' && c.caps.includes('transfer') && needsApproval(c.transferable)) return true;
  // Notre Dame coursework taken as an undergraduate that waits on an approval
  // the DGS gives for this student (DGS 2026-10-08).
  if (c.dgsApprovalAsked) return true;
  if (!c.rule) return false;
  return needsCourseApproval(program === 'mscse' ? c.rule.countsTowardMscse : c.rule.countsTowardPhd);
}

/** Classify every course. Returns classified courses in a stable order
 * (term, then course id, then input order) — the allocator's fill order. */
export function classify(student: Student, rules: Rules, today?: string): {
  classified: ClassifiedCourse[];
  warnings: string[];
} {
  const warnings: string[] = [];
  const { program, attestations } = student;
  // Which subject codes mean "CSE" on another university's transcript
  // (2026-09-09). undefined = the sheet has no list, and no transferred course
  // is placed inside or outside CSE.
  const cseSubjectCodes = rules.parameters.codeList('cse_subject_codes');
  const entry = normalizeEntryTerm(student.entryTerm).term;
  const params = rules.parameters;
  const transferFloor = params.gradeLetter('transfer_min_grade');
  // §5.2 criterion 3's five-year window belongs to both degrees (DGS
  // 2026-09-11: "The five-year transfer window apply to MSCSE as well").
  // Until today only the Ph.D. had a key, so an MSCSE student's decade-old
  // coursework was never refused on age — the check simply did not run for
  // them. One key per degree, because the Graduate School may yet distinguish
  // them and the sheet is where that belongs.
  const windowYears = params.number(program === 'mscse' ? 'ms_transfer_window_years' : 'phd_transfer_window_years');
  // Each course's governing Courses-tab row, resolved once.
  const ruleRows = new Map<CourseEntry, RuleCourse | undefined>();
  const ruleOf = (c: CourseEntry): RuleCourse | undefined => {
    if (!ruleRows.has(c)) ruleRows.set(c, resolveRuleRow(rules, c.courseId, c.term));
    return ruleRows.get(c);
  };

  for (const c of student.courses) {
    if (c.origin === 'transfer' && !(c.institution ?? '').trim()) {
      warnings.push(`${c.courseId}: no university is recorded for this course — the DGS cannot look it up without one. Edit the row and add the university.`);
    }
    // A course dated after today with a final grade (DGS 2026-09-13: "yes, but
    // get a warning"). It still counts as entered — the app takes the
    // student's word for their own record — but nobody sits a course that has
    // not happened yet, so the likeliest cause is a mistyped year.
    if (today !== undefined && !isInProgress(c.grade) && GRADES.includes(c.grade) && compareTerm(c.term, termOfDate(today)) > 0) {
      warnings.push(
        `${c.courseId} is dated ${termLabel(c.term)}, which is after ${termLabel(termOfDate(today))} — it is still counted, but check the term: a final grade for a semester that has not happened yet is usually a typo.`,
      );
    }
  }
  // The same course id twice in the SAME term from different origins (DGS
  // 2026-09-13: "yes, should get a warning"). Credit is NOT de-duplicated —
  // ids may legitimately collide across universities (2026-08-31) — but
  // nobody sits the same course at two institutions in one term, so this is
  // almost always one course entered twice (an import plus a hand-added row),
  // and every other suspect-entry path in this file says something.
  const sameTerm = new Map<string, CourseEntry[]>();
  for (const c of student.courses) {
    const key = `${canonicalCourseId(c.courseId)}|${termIndex(c.term)}`;
    const group = sameTerm.get(key);
    if (group) group.push(c);
    else sameTerm.set(key, [c]);
  }
  for (const group of sameTerm.values()) {
    if (group.length < 2 || group.every((c) => c.origin === 'nd')) continue; // all-ND duplicates: the retake rule below already says it
    warnings.push(
      `${group[0]!.courseId} is entered ${group.length} times for ${termLabel(group[0]!.term)}, under different origins (${[...new Set(group.map((c) => (c.origin === 'nd' ? 'Notre Dame' : (c.institution ?? 'another university'))))].join(' and ')}). Each row is counted separately — if it is one course, remove the duplicate.`,
    );
  }
  // The same course from the same other university on two rows, whatever
  // their terms (policy review round 3, P3-import-2; the 2026-08-31 promise
  // "duplicate entries warned"). The Notre Dame transfer block's row and its
  // twin already count as one course (P3-import-1 (c), pairedBlockRows); any
  // other pair — a transcript imported twice, a row typed by hand — is
  // counted twice, so it is said. Same-term pairs are the warning above's.
  const paired = pairedBlockRows(student.courses);
  const inPair = new Set<CourseEntry>([...paired.keys(), ...paired.values()]);
  const grouped = new Set<CourseEntry>();
  for (const a of student.courses) {
    if (grouped.has(a) || inPair.has(a)) continue;
    const group = [a, ...student.courses.filter((b) => b !== a && !inPair.has(b) && sameTransferCourse(a, b))];
    if (group.length < 2) continue;
    for (const c of group) grouped.add(c);
    if (new Set(group.map((c) => termIndex(c.term))).size < 2) continue;
    warnings.push(
      `${a.courseId} from ${a.institution} is entered ${group.length} times (${group.map((c) => termLabel(c.term)).join(', ')}). Each row is counted separately, so its credit may be counted twice — if it is one course, remove the duplicate.`,
    );
  }
  // THE 4+1's SHARED CREDITS, chosen by the app (DGS 2026-09-11): "let the
  // top two CSE 40xxx courses count towards both BS and MSCSE. Do not let
  // students choose what counts to what … When the transcript has 60xxx
  // courses, try to save them for the graduate degree." So §3.5's shared
  // allowance is filled from the student's 40000-level CSE courses first —
  // best grade first, then earliest — and only if those do not fill it from
  // 60000-level courses inside §3.5's window, earliest first. Everything else
  // applies to the MSCSE alone. The student is told which is which.
  const bsShared = new Set<CourseEntry>();
  if (program === 'mscse') {
    // The Graduate School's six, in code since 2026-10-07 (P3-sheet-5 (a)): it
    // can no longer go missing, so the P3-sheet-6 (b) branch for a missing row
    // is gone with the row.
    const limit = BS_SHARED_CREDITS_MAX;
    const awarded = student.bachelorsAwarded;
    // Only a course that can count toward the MSCSE at all is worth a share of
    // the six — a 40000-level row the sheet marks `no` would otherwise take a
    // slot from one that counts.
    const undergrad = (c: CourseEntry) => {
      if (c.origin !== 'transfer' || !isNotreDameInstitution(c.institution)) return false;
      if (!(c.degreeLevel === 'bachelors' || (awarded !== undefined && compareTerm(c.term, awarded) <= 0))) return false;
      if (!GRADES.includes(c.grade) || !passesCreditFloor(c.grade)) return false;
      const rule = ruleOf(c);
      if (!priorNdUndergraduateCanCount(c, rule, 'mscse')) return false;
      // §3.5 (Sept-2026 revision draft): "3-credit CSE REGULAR courses at the
      // 60000 level or higher, and count these both as undergraduate CSE
      // electives/Tech electives and as course requirements for the MSCSE
      // degree" — a project/research/seminar/independent-study course does
      // not draw on the shared bachelor's-and-MSCSE credit, even if it is
      // otherwise eligible (DGS decision 2026-09-12). An unlisted course
      // keeps the benefit of the doubt, as elsewhere in this file.
      return rule === undefined || rule.courseType === 'regular';
    };
    const lvl = (c: CourseEntry) => levelOf(c, ruleOf(c));
    const points = (c: CourseEntry) => GRADE_POINTS[c.grade] ?? 0;
    const fourk = student.courses
      .filter((c) => undergrad(c) && deptOf(c.courseId) === 'CSE' && lvl(c) === 4)
      .sort((a, b) => points(b) - points(a) || compareTerm(a.term, b.term) || a.courseId.localeCompare(b.courseId));
    // §3.5 names "CSE regular courses at the 60000 level or higher": a MATH or
    // EE graduate course never fills the shared pair (policy review 2026-10-03).
    const sixk = student.courses
      .filter((c) => undergrad(c) && deptOf(c.courseId) === 'CSE' && lvl(c) >= 6 && (awarded === undefined || semesterNumber(awarded, c.term) >= -1))
      .sort((a, b) => compareTerm(a.term, b.term) || a.courseId.localeCompare(b.courseId));
    let used = 0;
    for (const c of [...fourk, ...sixk]) {
      if (used + c.credits > limit) continue;
      bsShared.add(c);
      used += c.credits;
    }
  }

  // ONE COURSE, TWO ROWS (policy review round 3, P3-import-1 (c) and its
  // condition 2; DGS 2026-10-05): the Notre Dame transcript's transfer-credit
  // block and the other university's own transcript can both list a course.
  // The imports keep such a course as one row; a record saved before they did,
  // or a course typed by hand, still holds both — the other university's row
  // then carries the block row's acceptance, and the block row counts nothing.
  const pairedBlocks = pairedBlockRows(student.courses);
  const twinPostings = new Map<CourseEntry, NdPosting>();
  for (const [block, twin] of pairedBlocks) twinPostings.set(twin, ndPostingOf(block)!);
  const posting = (c: CourseEntry): NdPosting | undefined => twinPostings.get(c) ?? (pairedBlocks.has(c) ? undefined : ndPostingOf(c));
  // Everything the transfer branch reads, gathered once (see ClassifyEnv).
  const env: ClassifyEnv = { rules, student, program, attestations, entry, transferFloor, windowYears, cseSubjectCodes, bsShared, today, posting };
  // Readmission after a withdrawal (Academic Code §5.5: "Credit for any course
  // or examination will be forfeited if the student interrupts his or her
  // program of study for five years or more" — policy review 2026-10-03). The
  // interruption is measured from the last Notre Dame term before the
  // readmission to the readmission term itself; five years or more and every
  // course from before it is counted provisionally and sent to the DGS.
  const readmitted = student.readmittedTerm;
  const longInterruption = longInterruptionReadmission(student) !== undefined;
  const interruptedCourse = (c: CourseEntry): boolean => longInterruption && compareTerm(c.term, readmitted!) < 0 && (c.origin === 'nd' || isNotreDameInstitution(c.institution));
  // A shorter gap (policy review 2026-10-04, P2-dh-3.1-3.13-3/-4/-9; DGS:
  // "apply the suggested handling"): readmission after a withdrawal or a missed
  // fall or spring semester lets the program "reject some or all past credits"
  // (DGS Handbook §3.3) — this program's own earlier courses wait for the DGS.
  const beforeShortReadmission = (c: CourseEntry): boolean =>
    readmitted !== undefined && !longInterruption && c.origin === 'nd' && compareTerm(c.term, readmitted) < 0;
  // The Notre Dame MSCSE five years or more before the Ph.D. (DGS 2026-10-06):
  // every one of its courses waits for the DGS and the Graduate School.
  const separatedSince = mscseSeparation(student);
  const sorted = [...student.courses].sort(
    (a, b) => compareTerm(a.term, b.term) || a.courseId.localeCompare(b.courseId),
  );

  // Retakes / duplicate entries: credits count once (DGS default 2026-08-31 —
  // no document states it; §4.4.2's grade replacement is about the category
  // specialization only, so the credit sentences no longer cite it: policy
  // review 2026-10-03, P1-page-text-engine-17). Applies to ND
  // courses that are (or look like) regular courses; project/research/seminar
  // credits legitimately accumulate, and foreign transfer ids may collide with
  // ND numbering without being retakes.
  // Which attempt counts: the last PASSING final grade; failing that, a live
  // in-progress retake (so a student re-taking a failed course gets in-progress
  // credit, and a later failed attempt never erases an earlier pass).
  const supersededSet = new Set<CourseEntry>();
  const byId = new Map<string, CourseEntry[]>();
  for (const c of sorted) {
    if (c.origin !== 'nd') continue;
    const type = ruleOf(c)?.courseType ?? 'regular';
    if (type !== 'regular') continue;
    const list = byId.get(c.courseId) ?? [];
    list.push(c);
    byId.set(c.courseId, list);
  }
  for (const [id, attempts] of byId) {
    if (attempts.length < 2) continue;
    const passing = attempts.filter((a) => isPassed(a.grade));
    const inProgress = attempts.filter((a) => isInProgress(a.grade));
    const lastPassing = passing[passing.length - 1];
    // A LIVE retake wins over a passed attempt that earns no credit — C- or D
    // since the 2026-09-12 floor (red-team 2026-09-13). The student is sitting
    // the course again for exactly the credit that grade cannot give, which is
    // the same reason the next branch prefers a live retake to a failed
    // attempt; deciding this on isPassed alone let the C- stay "the one
    // counted" and threw the in-progress credit away with it, which also
    // starved §4.5's candidacy-readiness gate. Between two FINAL grades the
    // §4.4.2 rule is unchanged: the retake grade replaces, whatever it is.
    const counted =
      lastPassing !== undefined && (passesCreditFloor(lastPassing.grade) || inProgress.length === 0)
        ? lastPassing
        : inProgress.length > 0
          ? inProgress[inProgress.length - 1]!
          : attempts[attempts.length - 1]!; // all failed → last one (earns nothing anyway)
    for (const a of attempts) if (a !== counted) supersededSet.add(a);
    warnings.push(`${id} is entered ${attempts.length} times — its credits count once.`);
  }

  const classified: ClassifiedCourse[] = sorted.map((c): ClassifiedCourse => {
    const rule = ruleOf(c);
    const grade = c.grade;
    const base: ClassifiedCourse = { entry: c, rule, pool: 'none', caps: [], tier: 'provisional' };

    // Guard rails for hand-edited/imported data: an unknown grade or a
    // missing/negative credit value must never be silently counted.
    if (!GRADES.includes(grade)) {
      warnings.push(`${c.courseId}: grade '${String(grade)}' is not recognized — the course is not counted. Fix the entry.`);
      return { ...base, unrecognizedGrade: true, ineligibleReason: `not counted — unrecognized grade '${String(grade)}'` };
    }
    // Withdrawn (Academic Code §4.2: "posted on the student's permanent record
    // with the grade of W"): no credit, but the semester's registered hours
    // still include it (§3.3) — residency.ts reads the flag (2026-10-03).
    // The full-time clause is said of a Notre Dame registration only — the
    // only kind residency.ts counts (policy review round 3, P3-ac-4-1; DGS
    // 2026-10-05): another university's W says nothing about a Notre Dame semester.
    if (isWithdrawn(grade)) {
      return { ...base, withdrawn: true, ineligibleReason: `withdrawn (W) — earns no credit${c.origin === 'nd' ? '; it still counts as a registration for that semester’s full-time status (Academic Code §3.3)' : ''}` };
    }
    // Audited (Academic Code §2.4, §4.3; DGS Handbook §3.12 — policy review
    // 2026-10-04, P2-ac-1-3-6 / P2-ac-4-10): on the record, earning nothing,
    // and not part of the semester's registered hours.
    if (isAudit(grade)) {
      return { ...base, audited: true, ineligibleReason: 'audited (V) — earns no credit and does not count toward the semester’s full-time status (Academic Code §2.4, §4.3; DGS Handbook §3.12)' };
    }
    // An Incomplete (Academic Code §4.4): in progress until 30 + 14 days after
    // the term's grades were due, then "changed permanently to a grade of F"
    // unless the Graduate School extended it — which the app cannot see, so a
    // lapsed I is counted provisionally and sent to the DGS (2026-10-03).
    // Notre Dame's own courses only (policy review round 3, P3-ac-4-1; DGS
    // 2026-10-05: "Apply the suggested handling"): §4.4's clock and the
    // Graduate School's extension govern Notre Dame graduate courses — an
    // Incomplete from another university follows that university's rules, and
    // classifyTransfer holds it for the DGS instead.
    const incompleteDue = grade === 'I' && (c.origin === 'nd' || isNotreDameInstitution(c.institution)) ? incompleteDeadline(c.term) : undefined;
    const incompleteLapsed = incompleteDue !== undefined && today !== undefined && today > incompleteDue;
    const inGraduationTerm = incompleteDue !== undefined && student.graduationTerm !== undefined && compareTerm(c.term, student.graduationTerm) === 0;
    // The Spring 2020 cohort keeps 30 + 14 days, with Appendix A.1's 60 named
    // for the DGS to confirm (P3-cse-5-6-4 (b)): the Incomplete deadline is the
    // Registrar's and the Graduate School's to administer, not the program's.
    const cohortI = incompleteDue !== undefined && isCovidCohort(student, entry);
    const incompleteNote: Partial<ClassifiedCourse> =
      incompleteDue === undefined
        ? {}
        : { incompleteDue, ...(incompleteLapsed ? { incompleteLapsed: true as const } : {}), ...(inGraduationTerm ? { incompleteInGraduationTerm: true as const } : {}), ...(cohortI ? { incompleteCohortNote: true as const } : {}) };
    const withIncomplete = (cc: ClassifiedCourse): ClassifiedCourse => {
      if (incompleteDue === undefined || cc.ineligibleReason !== undefined) return { ...cc, ...incompleteNote };
      if (!incompleteLapsed) return { ...cc, ...incompleteNote };
      return {
        ...cc,
        ...incompleteNote,
        tier: 'provisional',
        approvalPending: `Incomplete (I) past its deadline (about ${incompleteDue}) — it became an F unless the Graduate School extended it (Academic Code §4.4)${cohortI ? `; for students enrolled in Spring 2020, Academic Code Appendix A.1 may give 60 days instead of 30` : ''}; the DGS confirms${cc.approvalPending ? `; ${cc.approvalPending}` : ''}`,
      };
    };
    // A dual-degree student's course that also counts toward the other
    // program (Academic Code §2.2; DGS Handbook §2.9 — policy review
    // 2026-10-04, P2-ac-1-3-2): at most nine such credits count here, and only
    // once the Graduate School approved the dual plan of study. The row stays
    // a registration for the semester's full-time count (Academic Code §3.5:
    // registering "in either program" meets continuous enrollment).
    const withSharedDegree = (cc: ClassifiedCourse): ClassifiedCourse => {
      if (student.concurrentDegree !== true || c.sharedWithOtherDegree !== true || c.origin !== 'nd' || cc.ineligibleReason !== undefined) return cc;
      if (student.attestations.dualPlanApproved === true) return { ...cc, caps: [...cc.caps, 'otherdegree'] };
      return {
        ...cc,
        caps: [...cc.caps, 'otherdegree'],
        tier: 'provisional',
        ...(cc.approvalPending === undefined ? { dualPlanOnly: true as const } : {}),
        approvalPending: `also counts toward your other degree — the Graduate School must approve your dual-degree plan of study (DGS Handbook §2.9)${cc.approvalPending ? `; ${cc.approvalPending}` : ''}`,
      };
    };
    const withInterruption = (cc: ClassifiedCourse): ClassifiedCourse => {
      if (beforeShortReadmission(c) && cc.ineligibleReason === undefined) {
        return {
          ...cc,
          beforeReadmission: true,
          tier: 'provisional',
          approvalPending: `taken before your readmission (${termLabel(readmitted!)}) — the program may reject some or all past credits (DGS Handbook §3.3); the DGS confirms${cc.approvalPending ? `; ${cc.approvalPending}` : ''}`,
        };
      }
      if (separatedSince !== undefined && !interruptedCourse(c) && isOwnMscseCoursework(student, c) && cc.ineligibleReason === undefined) {
        return {
          ...cc,
          interrupted: true,
          mscseSeparated: true,
          tier: 'provisional',
          approvalPending: `from your Notre Dame MSCSE, which ended in ${termLabel(separatedSince)}, five years or more before you entered the Ph.D. in ${termLabel(entry)} — a separation that long may forfeit its credit (Academic Code §5.5), so it counts as Ph.D. coursework once the DGS reviews it and the Graduate School approves${cc.approvalPending ? `; ${cc.approvalPending}` : ''}`,
        };
      }
      if (!interruptedCourse(c) || cc.ineligibleReason !== undefined) return cc;
      return {
        ...cc,
        interrupted: true,
        tier: 'provisional',
        approvalPending: `taken before an interruption of five years or more (readmitted ${termLabel(readmitted!)}) — Academic Code §5.5 forfeits the credit unless the DGS and the Graduate School rule otherwise${cc.approvalPending ? `; ${cc.approvalPending}` : ''}`,
      };
    };
    return withSharedDegree(withInterruption(withIncomplete(classifyOne(c, rule, grade, base))));
  });

  // TWO EARLIER GRADUATE PROGRAMS (policy review round 3, P3-prior-programs-3;
  // DGS 2026-10-07: option (3), "Detect the case and send it to the DGS").
  // The Academic Code (§4.6) and §5.2 state one allowance after a finished
  // program and one after an unfinished one — "A student transferring from an
  // unfinished master's program may not transfer more than six" — and nothing
  // on how two programs' allowances combine; the earlier-degrees question
  // takes one "finished?" answer. So when the courses drawing on §5.2's
  // allowance come from two programs (two universities, or an earlier Notre
  // Dame program and a school elsewhere), every such course waits for the DGS
  // rather than one answer's cap being applied to both (never guess).
  const programs = earlierTransferPrograms(classified);
  if (programs.length < 2) return { classified, warnings };
  const list = programs.length === 2 ? `${programs[0]} and ${programs[1]}` : `${programs.slice(0, -1).join(', ')} and ${programs[programs.length - 1]}`;
  return {
    classified: classified.map((cc) => {
      // Credit the Notre Dame transcript already shows as accepted stays
      // counted — it is on the record (P3-import-1) — and still names its
      // program above; only what is not yet recorded waits.
      if (!drawsOnTransferAllowance(cc) || cc.ndPosting !== undefined) return cc;
      const { approvedNote: _a, tickApproved: _t, ...rest } = cc;
      return {
        ...rest,
        twoPrograms: true as const,
        tier: 'provisional',
        approvalPending: `from one of two earlier graduate programs on your record (${list}) — §5.2 states a transfer allowance after a finished program and one after an unfinished one, but not how two programs’ allowances combine, so the DGS decides${cc.approvalPending ? `; ${cc.approvalPending}` : ''}`,
      };
    }),
    warnings,
  };

  /** One course, before the Incomplete and readmission overlays above. */
  function classifyOne(c: CourseEntry, rule: RuleCourse | undefined, grade: Grade, base: ClassifiedCourse): ClassifiedCourse {
    // "CSE 6xxxx" is a number the student has not finished typing, not a
    // course: it used to be counted provisionally into the 60000-level pool.
    // Warned about, and counted only once the number is complete (DGS
    // 2026-09-11).
    if (isIncompleteCourseId(c.courseId)) {
      warnings.push(`${c.courseId}: the course number is incomplete — finish typing it (for example CSE 60641) and the course will be counted.`);
      return { ...base, unrecognizedGrade: true, ineligibleReason: 'not counted — the course number is incomplete; complete it to have the course counted' };
    }
    if (!Number.isFinite(c.credits) || c.credits < 0) {
      warnings.push(`${c.courseId}: credits '${String(c.credits)}' is not a number — the course is not counted. Fix the entry.`);
      return { ...base, ineligibleReason: 'not counted — the credit value is missing or not a number' };
    }
    // Zero credits is allowed — a transcript's credit-hours column can come
    // through blank, and refusing the row would lose the course — but it is
    // never silent (DGS 2026-09-11: "allow 0 credits for courses with grades,
    // but show a warning message"). Until today the line read a bare "not
    // counted", with no reason, no warning and nothing pointing at the
    // credits field. The course keeps its place in the table and earns
    // nothing, which is what 0 credits means.
    if (c.credits === 0) {
      // A course the course rules list at zero credits (credit_min =
      // credit_max = 0) is right as entered — above all the summer
      // "Independent Summer Research" section every stipend-funded student
      // registers for (Academic Code §3.6: "must register for their
      // program's zero-credit 'Independent Summer Research' section"). No
      // warning, nothing to correct (policy review 2026-10-04, P2-ac-1-3-15).
      if (rule !== undefined && rule.creditMax === 0 && (rule.creditMin ?? 0) === 0) {
        return {
          ...base,
          ineligibleReason:
            c.term.season === 'summer'
              ? 'zero-credit summer registration (Academic Code §3.6) — counts toward nothing, as expected'
              : 'a zero-credit course in the course rules — counts toward nothing, as expected',
        };
      }
      warnings.push(`${c.courseId} is entered with 0 credits, so it counts toward nothing. Check the credit hours on your transcript and correct the row.`);
      return { ...base, ineligibleReason: 'not counted — entered with 0 credits; check the credit hours on your transcript' };
    }

    if (supersededSet.has(c)) {
      const countedAttempt = byId.get(c.courseId)?.find((a) => !supersededSet.has(a));
      const countedIsLater = countedAttempt && compareTerm(countedAttempt.term, c.term) > 0;
      return {
        ...base,
        superseded: true,
        // When the counted attempt is in ANOTHER term, naming that term says
        // which row survived. When it is in the SAME term — what a course
        // typed by hand and then imported again produces — naming the term
        // identifies neither row, so say what actually happened instead
        // (2026-09-11).
        ineligibleReason: countedIsLater
          ? `superseded by the ${termLabel(countedAttempt.term)} retake — its credits count once${program === 'phd' && rule?.categoryGroups && rule.categoryGroups.length > 0 ? ', and for the category specialization the retake grade replaces this one (§4.4.2)' : ''}`
          : countedAttempt && compareTerm(countedAttempt.term, c.term) === 0
            ? `entered twice for ${termLabel(c.term)} — its credits count once, so this duplicate row counts nothing. Remove it if it is not a second registration`
            : `its credits count once — the ${countedAttempt ? termLabel(countedAttempt.term) : 'other'} attempt of this course is the one counted`,
      };
    }

    // DGS decision 2026-08-31: a failed course (F/U) earns no credit at all.
    if (grade === 'F' || grade === 'U') {
      return { ...base, ineligibleReason: 'failed — earns no credit (DGS decision 2026-08-31)' };
    }

    const twin = pairedBlocks.get(c);
    if (twin) {
      return {
        ...base,
        superseded: true,
        ineligibleReason: `not counted here — the same course as ${twin.courseId} from your ${twin.institution ?? 'other'} transcript, where its acceptance on your Notre Dame record is counted once`,
      };
    }
    if (c.origin === 'transfer') return classifyTransfer(env, c, rule, base);

    const level = levelOf(c, rule);
    const isCse = deptOf(c.courseId) === 'CSE';

    if (!rule) {
      if (!isCse) {
        // Free-text non-CSE course (decision Q6). Level floors per decisions
        // Q5/Q19: 40000-level counts nothing; below 60000-level counts nothing.
        if (level === 4) {
          return {
            ...base,
            ineligibleReason: `not counted — non-CSE 40000-level courses do not count (${program === 'mscse' ? '§3.2' : '§4.2'})`,
          };
        }
        if (!(level >= 6)) {
          return {
            ...base,
            ineligibleReason: `not counted — below the 60000 level (${program === 'mscse' ? '§3.2' : '§4.2'}; DGS decision 2026-08-31)`,
          };
        }
        // Not in the Courses tab: no tick can settle it (DGS 2026-09-27) —
        // the review request takes it to the DGS, who enters it in the sheet.
        return {
          ...base,
          pool: 'regular',
          caps: ['noncse'],
          tier: tierFor(grade, true),
          // Not in the Courses tab, same as an unlisted CSE course below
          // (2026-09-09). §4.4.1 core knowledge reads this flag to offer the
          // DGS a course whose TITLE names a core area, and it was set only on
          // the CSE branch — so "EE 60566 Advanced Computer Architecture"
          // could never become a core-knowledge candidate while the same
          // course from another university, and an unlisted CSE course, both
          // could. §4.4.1 puts no department limit on the course.
          unknown: true,
          approvalPending: `not in the course rules yet — send the review request so the DGS can enter it; a course from outside CSE also needs your advisor’s approval (${program === 'mscse' ? '§3.2' : '§4.2'})`,
        };
      }
      // Unknown CSE course: never silently counted or rejected (CLAUDE.md).
      // A 50000-level course the sheet does not list stays out (decision Q19):
      // the 2026-09-09 rule that lets a 50000-level course count inside §4.2's
      // six-credit cap is about a course the DGS has PERMITTED in the sheet,
      // and an unlisted one carries no such permission.
      // `unknown` is the KNOWLEDGE-side flag, not the credit-side one (red-team
      // 2026-09-13): §4.4.1 core knowledge reads it to offer the DGS a course
      // whose TITLE names a core area, and §4.4.1 has no level rule at all
      // ("either at Notre Dame or at their previous institution"). These two
      // level branches earn no CREDIT, which is what their reason says — but
      // they are still unlisted courses, so leaving the flag off made an
      // unlisted CSE 50999 "Operating Systems Foundations" invisible to the
      // core row while the same title at 60000 or 40000 was offered for review.
      // The degree's own section (DGS 2026-09-11: no §4 on the MSCSE tab):
      // §3.6.1 says CSE 50xxx courses "do not count toward the MSCSE degree
      // requirements"; §4.2's six credits are the Ph.D.'s (policy review 2026-10-03).
      // On the MSCSE tab no listing can make it count (§3.6.1's own guard,
      // DGS 2026-10-03, P1-levels-grades-credits-4), so the line says what
      // the listed course's line says instead of "counts only if listed"
      // (second reconciliation pass, 2026-10-03).
      if (level === 5) {
        return {
          ...base,
          unknown: true,
          ineligibleReason:
            program === 'mscse'
              ? 'not counted — a 50000-level CSE course is preparatory and does not count toward the MSCSE, whatever the course rules say (§3.6.1)'
              : 'not counted — a 50000-level course counts only if the DGS has listed it in the course rules (§4.2)',
        };
      }
      // No course below the 40000 level earns graduate credit (red-team F8,
      // DGS 2026-09-12): §3.2/§4.2 reach down only to "the 40000 level", and
      // an unlisted CSE 30124 or CSE 10101 used to fall through as
      // "counted provisionally". A number the pattern cannot read (NaN) is
      // still an unknown course, not a refused one.
      if (level < 4) {
        // The Graduate School's rule (Academic Code §4.1), as the two listed-row
        // refusals say — P1-page-text-engine-16 left this unlisted one behind
        // (second reconciliation pass, 2026-10-03).
        return { ...base, unknown: true, ineligibleReason: 'not counted — below the 40000 level; no course under 40000 earns graduate credit (Academic Code §4.1)' };
      }
      const caps: CapId[] = level === 4 ? ['fourk'] : [];
      return {
        ...base,
        pool: 'regular',
        caps,
        tier: 'provisional',
        unknown: true,
        approvalPending: 'not in the course rules yet — send the review request so the DGS can enter it',
      };
    }

    const counts = program === 'mscse' ? rule.countsTowardMscse : rule.countsTowardPhd;
    const programName = program === 'mscse' ? 'MSCSE' : 'Ph.D.';
    if (counts === 'no') {
      return { ...base, ineligibleReason: `the course rules say it does not count toward the ${programName}` };
    }
    // Below the 40000 level nothing earns graduate credit, whatever the verdict
    // cell says (Academic Code §4.1; policy review 2026-10-03 — the guard above
    // covered unlisted courses only, so a level-3 row flipped to `yes` would
    // have counted as a full regular course).
    if (level < 4) {
      return { ...base, ineligibleReason: 'not counted — below the 40000 level; no course under 40000 earns graduate credit (Academic Code §4.1)' };
    }
    // A sheet-listed dgs_approval course is cleared by the matching attestation:
    // BELOW the 60000 level → the "courses below the 60000 level" checkbox;
    // non-CSE → the non-CSE checkbox. A CSE course at 60000 or above flagged
    // dgs_approval has no checkbox — it stays provisional and the approvals
    // row explains.
    //
    // The checkbox covered level 4 alone until 2026-09-09, when the DGS put
    // 40000- and 50000-level courses under one six-credit cap. The cap moved
    // and this did not, so the one bridge course the sheet permits for a Ph.D.
    // (CSE 50502, `dgs_approval`) could never be cleared: it stayed amber and
    // stayed in the review request whatever the student ticked.
    const approvalPending = approvalStatus(counts, c.dgsApproved === true);
    const tier = tierFor(grade, approvalPending !== undefined);

    if (program === 'mscse' && isMsProjectCourse(c.courseId)) {
      const projectTick = c.dgsApproved === true && approvalPending === undefined && approvalStatus(counts, false) !== undefined;
      return { ...base, pool: 'project', caps: [], tier, approvalPending, ...(projectTick ? { tickApproved: true as const } : {}) };
    }

    // Below the 60000 level (DGS 2026-09-09, superseding decision Q19): a
    // 40000- or 50000-level course counts only while the rules sheet says it
    // may, and even then only within §4.2's six-credit cap — "the pre-approval
    // only means they are pre-approved to count toward the Ph.D.; they are
    // still subject to all other constraints". Both levels draw on the SAME six
    // credits — and so does every course TYPE at those levels (Academic Code
    // §4.1 caps "40000 – 59999" as such; DGS 2026-10-03): a research or
    // independent-study row at the 40000 level used to escape the allowance.
    // §3.6.1's own guard for the MSCSE (DGS 2026-10-03, P1-levels-grades-credits-4):
    // "CSE 50xxx courses are preparatory and do not count toward the MSCSE
    // degree requirements in §3.1–3.5" — refused whatever the verdict cell
    // says, so a future sheet edit cannot contradict the handbook (every live
    // 5xxxx row says `no` for the MSCSE today). The Ph.D. is untouched: the
    // sheet decides there, course by course (DGS 2026-09-03).
    if (program === 'mscse' && level === 5 && isCse) {
      return { ...base, ineligibleReason: 'not counted — a 50000-level CSE course is preparatory and does not count toward the MSCSE, whatever the course rules say (§3.6.1)' };
    }
    const belowSixty = level === 4 || level === 5;
    if (belowSixty && !isCse) {
      return {
        ...base,
        ineligibleReason: `not counted — non-CSE ${level}0000-level courses do not count (${program === 'mscse' ? '§3.2' : '§4.2'})`,
      };
    }
    // A `yes` is the pre-approval on both tabs (DGS 2026-10-03); the allowance
    // below still limits it.
    const pending = approvalPending;
    const levelTier = belowSixty ? tierFor(grade, pending !== undefined) : tier;
    // Would the course wait WITHOUT the tick? Then the tick settled it, and
    // the line says so (P1-levels-grades-credits-30, 2026-10-03).
    const tickApproved = c.dgsApproved === true && pending === undefined && approvalStatus(counts, false) !== undefined;
    // §3.2 (September 2026) caps non-CSE credit at nine toward the 30 as well
    // as the 24 — so for the MSCSE a non-CSE seminar or research credit draws
    // the same nine (DGS 2026-10-03). §4.2 scopes the Ph.D.'s nine to "the
    // course requirement", which only regular courses feed.
    const nonCse: CapId[] = !isCse && (program === 'mscse' || rule.courseType === 'regular') ? ['noncse'] : [];
    const caps: CapId[] = [...(belowSixty ? (['fourk'] as CapId[]) : []), ...nonCse];
    const shaped = (pool: Pool): ClassifiedCourse => ({ ...base, pool, caps, tier: levelTier, ...(pending !== undefined ? { approvalPending: pending } : {}), ...(tickApproved ? { tickApproved: true as const } : {}) });
    switch (rule.courseType) {
      case 'regular':
        return shaped('regular');
      case 'project':
        return shaped('project');
      case 'seminar':
        return shaped('seminar');
      case 'research':
      case 'independent':
        return shaped('total_only');
    }
  }
}

/** The record-wide facts classify() reads for every course from before the
 * program — computed once per audit, handed to the two branches below. */
interface ClassifyEnv {
  rules: Rules;
  student: Student;
  program: Program;
  attestations: Attestations;
  /** The entry term, normalized (a summer entry reads as the following fall). */
  entry: Term;
  transferFloor: string | undefined;
  windowYears: number | undefined;
  cseSubjectCodes: string[] | undefined;
  bsShared: ReadonlySet<CourseEntry>;
  /** Today's date, when the caller has one (audit() does; review.ts does not). */
  today: string | undefined;
  /** The acceptance on the Notre Dame record a transfer course carries, its
   * own or its paired block row's (P3-import-1; see nd-posting.ts). */
  posting: (c: CourseEntry) => NdPosting | undefined;
}

/** A course from before the program (origin 'transfer'): §5.2 transfer credit,
 * a Notre Dame course taken as an undergraduate, or an undergraduate course
 * from elsewhere that can only demonstrate §4.4.1 core knowledge. The body of
 * classify()'s transfer branch, moved out whole so the map
 * callback reads in one screen; nothing in it changed. */
function classifyTransfer(env: ClassifyEnv, c: CourseEntry, rule: RuleCourse | undefined, base: ClassifiedCourse): ClassifiedCourse {
  const { rules, student, program, attestations, entry, transferFloor, windowYears, cseSubjectCodes } = env;
  const grade = c.grade;
  // The DGS's ExternalCourses ruling, when one exists. Attached to every
  // return path so §4.4.1 core knowledge sees it even when no credit counts.
  // A course from an earlier Notre Dame program is ruled on in ExternalCourses
  // under UNIVERSITY OF NOTRE DAME (DECISIONS 2026-09-05; policy review round
  // 3, P3-dh-10-2), whatever spelling the student's record has ("Notre Dame").
  const external =
    findExternalRule(rules.external, c.institution ?? '', c.courseId) ??
    (isNotreDameInstitution(c.institution) ? findExternalRule(rules.external, NOTRE_DAME_ROW_UNIVERSITY, c.courseId) : undefined);
  // Set once per university in the sheet's Universities tab (DGS 2026-10-10;
  // a cell on every ExternalCourses row until then); applies to every course
  // from it. The DGS's row for the university decides the credit system;
  // failing that, what the transcript itself announced at import (2026-09-11).
  const sheetCreditSystem = universityCreditSystem(rules.universityCreditSystems, c.institution);
  const creditSystem = sheetCreditSystem ?? c.creditSystem;
  // §5.2 pro-rata: the Graduate School's factors, in code (DGS 2026-10-04).
  const conversionFactor = creditSystemFactor(creditSystem);
  const extBase: ClassifiedCourse = { ...base, external };
  // Prior NOTRE DAME coursework (2026-09-05 — an earlier Notre Dame degree
  // on a combined transcript): the Courses tab already says which §4.4.1
  // core area a Notre Dame course covers, whenever it was taken, so no
  // ExternalCourses ruling is needed for that part. Transfer credit still
  // follows §5.2 like any other prior graduate course.
  const ndCoreArea = isNotreDameInstitution(c.institution) ? rule?.coreArea : undefined;
  const areaName = (code: string) => rules.coreAreas.find((a) => a.code === code)?.name ?? code;
  // §5.2 criterion 2: transfers must be "graduate courses … [taken with]
  // graduate student status" — Bachelor's coursework can never transfer.
  // §4.4.1 core knowledge has no such restriction, so the course stays
  // visible to the core check (coreRows reads classified regardless).
  // The per-course line leads with the ONE thing an undergraduate course
  // can do — demonstrate a core-knowledge area (DGS request 2026-09-04;
  // shortened 2026-09-06 so it did not repeat "no transfer credit").
  // DGS 2026-09-07 restores that half, with its REASON: the bar is the
  // student's status when they took the course, not the course's level, so
  // a graduate-numbered course taken before the bachelor's says so on its
  // own line rather than leaving it to the group heading.
  const suggested = external === undefined && ndCoreArea === undefined ? coreTitleSuggestion(c.title) : undefined;
  // §4.4.1 core knowledge and §4.4.2 specialization are the Ph.D.
  // qualifying examination's, and the MSCSE has no qualifier at all — so
  // an MSCSE student is told nothing about either (DGS 2026-09-11:
  // "anything related to them should not be shown to current MSCSE
  // students"). The note is the one place a core area reached a course
  // line, and it is empty for them.
  const qualifierApplies = program === 'phd';
  // A DGS-confirmed core area is said on the line itself (2026-09-06 —
  // the separate "What the DGS's rules say" block is gone).
  const coreNote = !qualifierApplies
    ? ''
    : external?.satisfiesCoreArea
      ? `; satisfies the ${areaName(external.satisfiesCoreArea)} core-knowledge requirement (§4.4.1) — confirmed by the DGS`
      : ndCoreArea
        ? `; satisfies the ${areaName(ndCoreArea)} core-knowledge requirement (§4.4.1) per the course rules`
        : suggested
          ? `; may still satisfy the ${suggested} core-knowledge requirement (§4.4.1) after DGS review`
          : '';
  // NOTRE DAME COURSEWORK TAKEN AS AN UNDERGRADUATE — the Graduate School's
  // answer, through the DGS (2026-09-10, evening), which settles the
  // question §5.2 criterion 2 raised and goes well past it:
  //
  //   "Any 60000-level and above coursework taken as an undergraduate, not
  //   being used to fulfill undergraduate degree requirements can be used
  //   to satisfy both the master's and the PhD. Notably, such credits are
  //   counted towards the PhD, even those above and beyond the usual 24
  //   allowed for transfer. The only hard constraint is that the same
  //   course's credits cannot count towards three degrees (BS, MSCSE, PhD)
  //   at the same time. … up to two 40000-level courses taken by ND
  //   undergraduates can count towards both BS and MSCSE. … up to 6 credits
  //   from 40xxx courses can count towards PhD."
  //
  // So this coursework is NOT §5.2 transfer credit at all — it never
  // touches the transfer cap. A 6xxxx course counts in full whether or not
  // the B.S. used it (DGS 2026-09-10: uncapped); a course below the 60000
  // level counts inside §4.2's own six-credit allowance, the same six a
  // course taken in the program would use. The one bar is a course already
  // spent on two degrees.
  const awardedTerm = student.bachelorsAwarded;
  // Only coursework that could actually count comes down this path. A
  // 20000-level course, or a non-CSE course below the 60000 level, counts
  // nothing at any answer, so it keeps the line it has always had — which
  // leads with the one thing it CAN do, demonstrate a §4.4.1 core area,
  // and tells the student to send the review request.
  const undergradLevel = levelOf(c, rule);
  if (ndUndergraduateCounting(c, rule, awardedTerm)) {
    // Whatever it earns, it is never §5.2 transfer credit (2026-09-22: an
    // unanswered course used to sit on the transfer row as a "transfer" with
    // nothing to count, and once no real transfer was left the row read Met).
    return { ...classifyPriorNdUndergraduate(env, { c, rule, extBase, coreNote, ndCoreArea, areaName, qualifierApplies, awardedTerm, undergradLevel }), notTransferCredit: true };
  }
  // A NOTRE DAME graduate course dated before the entry term, for a student
  // whose record shows no prior graduate program (red-team F7, 2026-09-12):
  // §5.2 governs another university's work or another Notre Dame program,
  // and neither is on this record — nearly always the entry term is wrong
  // (it defaults to the coming fall). No transfer row is opened; the line
  // says what to check. §4.4.1/§4.4.2 still see the course (any ND course
  // does, 2026-09-11).
  if (isNotreDameInstitution(c.institution) && c.degreeLevel !== 'bachelors' && student.priorMs === 'none' && student.ndMasters === undefined) {
    // (student.priorMs / student.ndMasters are the record's own facts, not the program.)
    // NON-DEGREE STATUS (Academic Code §2.3, policy review 2026-10-03): "No
    // more than 12 credit hours earned by a student while in non-degree status
    // may be counted toward a degree program." The question is asked only when
    // such courses exist (DGS: "ask the question only when such courses are
    // detected based on the admission term"); answered yes, each course counts
    // provisionally inside the 12 and goes to the DGS.
    if (student.ndNonDegree === true) {
      const shape = rule ? priorNdShape(c.courseId, rule, program, c.dgsApproved === true) : undefined;
      if (shape && 'ineligibleReason' in shape) return { ...extBase, notTransferCredit: true, nonDegree: true, ineligibleReason: `${shape.ineligibleReason}${coreNote}` };
      return {
        ...extBase,
        notTransferCredit: true,
        nonDegree: true,
        reviewed: rule !== undefined,
        ...(rule === undefined ? { unknown: true as const } : {}),
        pool: shape?.pool ?? 'regular',
        caps: ['nondegree', ...(shape?.caps ?? []), ...(rule === undefined && deptOf(c.courseId) !== 'CSE' ? (['noncse'] as CapId[]) : [])],
        tier: 'provisional',
        approvalPending: `taken at Notre Dame as a non-degree student before you were admitted — at most ${NON_DEGREE_CREDITS_MAX} such credits may count toward the degree (Academic Code §2.3); the DGS decides${rule === undefined ? '; not in the course rules yet — send the review request so the DGS can enter it' : shape && !('ineligibleReason' in shape) && shape.approvalPending ? `; ${shape.approvalPending}` : ''}${coreNote}`,
      };
    }
    // A 4+1 MSCSE student with no bachelor's term yet: the course may be one
    // of the 4+1's graduate courses taken as an undergraduate, which count
    // toward the MSCSE (DGS 2026-10-07, P3-fourplusone-1) — only the award
    // term tells, so the line asks for it rather than for the entry term. It
    // still counts for nothing until then (UI review, 2026-10-08: the reason
    // sent the student to the wrong field).
    if (program === 'mscse' && student.integratedBsMs === true && student.bachelorsAwarded === undefined) {
      return {
        ...extBase,
        notTransferCredit: true,
        ineligibleReason: `not counted yet — set the semester your bachelor’s degree was awarded, under Your standing: a 4+1 student’s graduate courses from before the bachelor’s count toward the MSCSE (§3.5), and this page cannot tell which courses those are until it knows when you graduated${coreNote}`,
      };
    }
    return {
      ...extBase,
      notTransferCredit: true,
      ineligibleReason: `not counted — dated before your entry term (${termLabel(entry)}) with no earlier graduate program on your record, so it is not §5.2 transfer credit either. To fix: check the entry term under Your standing (it starts out as the coming fall), or change your earlier degrees there; if you took it as a non-degree student before you were admitted, say so under Your standing — up to ${NON_DEGREE_CREDITS_MAX} such credits may count (Academic Code §2.3)${coreNote}`,
    };
  }
  // A NOTRE DAME graduate course dated before the entry term on a record
  // whose earlier graduate program was at ANOTHER university (policy review
  // round 3, P3-dh-3.14-3.20-3; DGS 2026-10-06: "apply the handling with
  // (c). When this really happens, I will need to ask the graduate school how
  // to handle this."). It is not credit from an earlier Notre Dame program,
  // so §5.2's 6 / 24 do not meter it; it may be non-degree coursework, where
  // "No more than 12 credit hours earned by a student while in non-degree
  // status at Notre Dame may be counted toward a degree program" (DGS
  // Handbook §3.14; Academic Code §2.3). Option (c): the non-degree question
  // stays narrowed to records with no earlier program (2026-10-03, item 13);
  // this course waits for the DGS, counted provisionally, with no transfer
  // projection, and the review request names the twelve. A transfer from the
  // Notre Dame MSCSE whose student also held or started a degree elsewhere is
  // the same record (P3-prior-programs-2; DGS 2026-10-07: option (a)).
  const earlierElsewhere = student.background?.graduate === 'elsewhere' || (student.background?.graduate === 'nd-mscse-transfer' && student.background.alsoElsewhere === true);
  if (isNotreDameInstitution(c.institution) && c.degreeLevel !== 'bachelors' && student.ndMasters === undefined && earlierElsewhere) {
    const shape = rule ? priorNdShape(c.courseId, rule, program, c.dgsApproved === true) : undefined;
    if (shape && 'ineligibleReason' in shape) return { ...extBase, notTransferCredit: true, ndBeforeAdmission: true, ineligibleReason: `${shape.ineligibleReason}${coreNote}` };
    return {
      ...extBase,
      notTransferCredit: true,
      ndBeforeAdmission: true,
      reviewed: rule !== undefined,
      ...(rule === undefined ? { unknown: true as const } : {}),
      pool: shape?.pool ?? 'regular',
      caps: [...(shape?.caps ?? []), ...(rule === undefined && deptOf(c.courseId) !== 'CSE' ? (['noncse'] as CapId[]) : [])],
      tier: 'provisional',
      approvalPending: `taken at Notre Dame before you were admitted, while your earlier graduate program was at another university — not credit from an earlier Notre Dame program; if you took it as a non-degree student, at most ${NON_DEGREE_CREDITS_MAX} such credits may count (Academic Code §2.3); the DGS decides, with the Graduate School${rule === undefined ? '; not in the course rules yet — send the review request so the DGS can enter it' : shape && !('ineligibleReason' in shape) && shape.approvalPending ? `; ${shape.approvalPending}` : ''}${coreNote}`,
    };
  }
  // A row of the Notre Dame record's transfer-credit block (P3-import-1): its
  // acceptance, the record it sits on, and the term it was recorded.
  const posting = env.posting(c);
  // (b): credit on the UNDERGRADUATE record of a combined transcript — AP,
  // College Board or community-college credit the University accepted for the
  // bachelor's — is undergraduate coursework, never graduate transfer credit.
  if (c.degreeLevel === 'bachelors' || posting?.level === 'undergraduate') {
    const confirmedArea = external?.satisfiesCoreArea ? areaName(external.satisfiesCoreArea) : undefined;
    const suggested = coreTitleSuggestion(c.title);
    // Two different reasons (DGS 2026-09-22). Another university's course:
    // the student's STATUS at the time — §5.2 needs graduate student status
    // (DGS 2026-09-07). A Notre Dame course reaches this branch only because
    // its LEVEL cannot count (undergradLevelEligible): Notre Dame coursework
    // is never §5.2 transfer credit (Graduate School, 2026-09-10), so "no
    // transfer credit" named the wrong rule for it.
    const nd = isNotreDameInstitution(c.institution);
    const levelReason = `${levelOf(c, rule)}0000-level — only CSE 40000-level courses (up to 6 credits, with approval), 50000-level CSE courses listed in the course rules and 60000-level courses can count (${program === 'mscse' ? '§3.2' : '§4.2'}; Academic Code §4.1)`;
    // The credit verdict FIRST, the core clause after "; " (DGS 2026-09-29:
    // "the credit should be a cross with a note that no transfer credit for
    // courses taken as an undergrad") — the shape buildExplanation() splits
    // into a red credit line and a qualifier line of its own. Until then the
    // core clause led the line, the wrapper left it there, and the same clause
    // showed twice under a green tick once every in-program course got a
    // qualifier line from its feeds (2026-09-28).
    const credit = nd
      ? `not counted — not eligible for degree credit at the ${levelReason}`
      : posting?.level === 'undergraduate'
        ? `not counted — undergraduate credit on your Notre Dame bachelor’s record, accepted for the bachelor’s degree, not as graduate transfer credit (§5.2)`
        : `not counted — taken as an undergraduate (§5.2)`; // the group's intro says such courses bring no transfer credit (UI review, 2026-10-08)
    // For an MSCSE student there is no §4.4.1 to demonstrate: an
    // undergraduate course from another university can do nothing here,
    // and saying so once is the whole line (DGS 2026-09-11).
    if (!qualifierApplies) return { ...extBase, ineligibleReason: credit };
    return {
      ...extBase,
      ineligibleReason: confirmedArea
        ? `${credit}; satisfies the ${confirmedArea} core-knowledge requirement (§4.4.1) — confirmed by the DGS`
        : ndCoreArea
          ? `${credit}; satisfies the ${areaName(ndCoreArea)} core-knowledge requirement (§4.4.1) — a Notre Dame course listed in the course rules`
          : suggested
            ? `${credit}; may still satisfy the ${suggested} core-knowledge requirement (§4.4.1) once the DGS reviews it`
            : `${credit}; not relevant to the core knowledge requirement (§4.4.1)`,
    };
  }
  if (posting !== undefined) return classifyPosted(env, c, extBase, posting, coreNote);
  // THE STUDENT'S OWN NOTRE DAME MSCSE, on a Ph.D. record — the Graduate
  // School's answer, through the DGS (2026-09-22): "in cases where a
  // graduate student moves from a master's program to a PhD program in the
  // same discipline all the credits are counted towards the PhD, even those
  // above and beyond the usual 24 allowed for transfer." And the DGS's
  // reading of it: "any 60xxx courses taken during MS (whether part of 4+1
  // or not) transfer to PhD without needing any approval, even beyond the
  // 24-credit limit." So this coursework is not §5.2 transfer credit at all
  // — no cap, no window, no grade floor, no recommendation — and the transfer
  // row neither lists nor counts it. What still governs is the Courses tab:
  // what the course IS (regular, thesis, seminar) and §4.2's own level and
  // non-CSE allowances, exactly as for the same course taken in the program.
  // A course the sheet does not list is counted provisionally and sent for
  // review, as any unlisted Notre Dame course is (never guess).
  if (program === 'phd' && isNotreDameInstitution(c.institution) && student.ndMasters !== undefined) {
    const shape = rule ? priorNdShape(c.courseId, rule, program, c.dgsApproved === true) : undefined;
    const isProject = (shape !== undefined && !('ineligibleReason' in shape) && shape.pool === 'project') || rule?.courseType === 'project' || isMsProjectCourse(c.courseId);
    if (shape && 'ineligibleReason' in shape && !isProject) {
      return { ...extBase, notTransferCredit: true, ndMastersCredit: true, ineligibleReason: `${shape.ineligibleReason}${coreNote}` };
    }
    const shapeCaps = shape !== undefined && !('ineligibleReason' in shape) ? shape.caps : [];
    const shapePool = shape !== undefined && !('ineligibleReason' in shape) ? shape.pool : 'regular';
    // The sheet row's approval is §4.2's own (a 40000-level course's advisor
    // + DGS sign-off), kept; a thesis or project row's verdict is about taking
    // the course IN the Ph.D., and the DGS already ruled that an MSCSE's
    // thesis credits count toward the total (2026-09-22) — no approval.
    const shapeApproval = shape !== undefined && !('ineligibleReason' in shape) && !isProject ? shape.approvalPending : undefined;
    const unlistedNonCse = rule === undefined && deptOf(c.courseId) !== 'CSE';
    return {
      ...extBase,
      notTransferCredit: true,
      ndMastersCredit: true,
      reviewed: rule !== undefined,
      // A master's thesis or project is not a regular course (DGS 2026-09-22):
      // it counts toward the 60, never the 24.
      pool: isProject ? 'total_only' : shapePool,
      caps: [...shapeCaps, ...(unlistedNonCse && !shapeCaps.includes('noncse') ? ['noncse' as CapId] : [])],
      tier: tierFor(grade, rule === undefined || shapeApproval !== undefined),
      ...(rule === undefined
        ? { unknown: true as const, approvalPending: `not in the course rules yet — send the review request so the DGS can enter it${unlistedNonCse ? '; a course from outside CSE also needs your advisor’s approval (§4.2)' : ''}` }
        : shapeApproval !== undefined
          ? { approvalPending: shapeApproval }
          : {}),
    };
  }
  // Graduate courses (2026-09-04): §5.2 transfer credit is not the only
  // thing a prior course can earn — an unreviewed course whose title
  // matches the core keywords may satisfy §4.4.1 core knowledge after the
  // DGS's review, and its line says so. (A DGS-ruled course is decided.)
  const transferable = transferableFor(external, program);
  if (transferable === 'no') {
    return {
      ...extBase,
      // The university as the student's record spells it (DGS 2026-09-06, late evening: no upper-cased sheet spelling in student-facing text).
      ineligibleReason: `not counted — the DGS decided this ${c.institution ?? external?.university} course does not transfer (course rules, §5.2)${coreNote}`,
    };
  }
  // §5.2 (verbatim): "A student may transfer credits earned at another
  // accredited university only if: 1) the student is in degree status at
  // Notre Dame; 2) the courses taken are graduate courses appropriate to
  // the Notre Dame graduate program and the student had graduate student
  // status when they took these courses; 3) the courses were completed
  // within a five-year period prior to admission to a graduate degree
  // program at Notre Dame or while enrolled in a graduate degree program
  // at Notre Dame; 4) grades of "B" (3.0 on 4.0 scale) or better were
  // achieved; and 5) the transfer is recommended by the DGS and approved
  // by the Graduate School."
  // Criterion 2 by the student's own record (DGS 2026-09-06: "Only the
  // courses taken with the graduate student status can count. The
  // graduate-level courses taken before earning the bachelor's degree do
  // not count."): a course dated in or before the term the bachelor's
  // degree was awarded was not taken with graduate student status,
  // whatever its number or the level it was registered at. An unknown
  // award term changes nothing (degreeLevel decides, as before). The
  // award term is absolute (DGS 2026-09-06, later that evening): a
  // transferable=yes ruling in the ExternalCourses tab does NOT restore
  // the credit of a course taken before the bachelor's degree — the
  // ruling is about the course, criterion 2 about the student.
  const awarded = student.bachelorsAwarded;
  const beforeBachelors = awarded !== undefined && compareTerm(c.term, awarded) <= 0;
  const whenTaken = awarded !== undefined && compareTerm(c.term, awarded) === 0 ? 'in the term' : 'before';
  if (beforeBachelors) {
    return {
      ...extBase,
      ineligibleReason: `not counted — taken ${whenTaken} your bachelor’s degree was awarded (${termLabel(awarded!)}), so not as a graduate student (§5.2)${coreNote}`,
    };
  }
  // §5.2: "grades of 'B' (3.0 on 4.0 scale) or better were achieved" and
  // "completed within a five-year period prior to admission … or while
  // enrolled". Every transfer needs DGS + Graduate School approval.
  if (transferFloor !== undefined && !meetsGradeFloor(grade, transferFloor as Grade) && !isInProgress(grade)) {
    return { ...extBase, ineligibleReason: `not counted — grade below ${transferFloor} (§5.2)${coreNote}` };
  }
  // The window counts back from "admission to a graduate degree program at
  // Notre Dame" (Academic Code §4.6). For a student who finished the Notre
  // Dame MSCSE before the Ph.D., that is the MSCSE admission (policy review
  // round 3, P3-prior-programs-4; DGS 2026-10-07: option (b) — the MSCSE and
  // the Ph.D. are one graduate program, 2026-10-03), read from the earliest
  // MSCSE course on the record. Without one the start is unknown: a course
  // outside the Ph.D.'s window is held for the DGS, never refused.
  const mscseStart = ownMscseStart(student);
  const windowFrom = mscseStart !== undefined && compareTerm(mscseStart, entry) < 0 ? mscseStart : entry;
  const windowStartUnknown =
    windowYears !== undefined && program === 'phd' && student.ndMasters !== undefined && mscseStart === undefined && compareTerm(c.term, shiftTermYears(entry, -windowYears)) < 0;
  if (windowYears !== undefined && !windowStartUnknown && compareTerm(c.term, shiftTermYears(windowFrom, -windowYears)) < 0) {
    return {
      ...extBase,
      ineligibleReason:
        windowFrom === entry
          ? `not counted — completed more than ${windowYears} years before you entered (before ${termLabel(shiftTermYears(entry, -windowYears))}; §5.2)${coreNote}`
          : `not counted — completed more than ${windowYears} years before you entered the Notre Dame MSCSE in ${termLabel(windowFrom)}, your first admission to a Notre Dame graduate program (before ${termLabel(shiftTermYears(windowFrom, -windowYears))}; §5.2)${coreNote}`,
    };
  }
  // An earlier Notre Dame course keeps its own Courses-tab verdict on top
  // of §5.2's (2026-09-09): the §5.2 cap says how MUCH may transfer, the
  // sheet row says what the course IS — regular, project, research — and
  // §4.2's level rules still apply to it.
  const shape = isNotreDameInstitution(c.institution) && rule ? priorNdShape(c.courseId, rule, program, c.dgsApproved === true) : undefined;
  // A master's project or thesis does not transfer into EITHER degree (DGS
  // 2026-09-11: "Master's project is not a regular course. It cannot be
  // transferred, so it should not count toward PhD." — and §3.2's own
  // "six (6) credits hours of Masters project (CSE 68902) or Masters thesis
  // direction (CSE 68901) earned at Notre Dame", DGS decision 2026-09-12,
  // reads the same way for the MSCSE: it must be earned at Notre Dame, not
  // transferred in from another program. (The clause is §3.2's; §3.4 was
  // cited here until 2026-10-03, P1-page-text-engine-23. A 4+1 student's
  // pre-bachelor's 68901/68902 is not a transfer: it counts toward the MSCSE
  // when the bachelor's did not use it — classifyPriorNdUndergraduate.) Until 2026-09-11 a prior Notre
  // Dame CSE 68902 drew six of the twenty-four and read, on a Ph.D.
  // report, "counts toward the project/thesis requirement". Said before
  // the sheet's own verdict, because it holds whatever the row says.
  const isProject = (shape !== undefined && !('ineligibleReason' in shape) && shape.pool === 'project') || rule?.courseType === 'project' || isMsProjectCourse(c.courseId);
  // For the MSCSE that still holds. For the Ph.D. the DGS reversed it on
  // 2026-09-22: a 60000-level course that is not a regular course does not
  // count toward the 24 regular credits, but it does count toward the 60 —
  // so a prior master's thesis or project course is a transfer candidate
  // like any other, in the total-only pool (the `isProject` pool below).
  if (isProject && program !== 'phd') {
    return {
      ...extBase,
      transferable,
      ineligibleReason: `not counted — a master’s project or thesis is not a regular course and does not transfer into the MSCSE (§3.2, §5.2)${coreNote}`,
    };
  }
  const projectNote = isProject ? '; a master’s project or thesis is not a regular course, so it counts toward the total credits only (§4.2)' : '';
  if (shape && 'ineligibleReason' in shape) {
    return { ...extBase, transferable, ineligibleReason: `${shape.ineligibleReason}${coreNote}` };
  }
  // The student's "transfer approved" checkbox settles a course the DGS
  // has actually looked at — one with an ExternalCourses ruling, or a
  // Notre Dame course the Courses tab lists. A course nobody has reviewed
  // stays pending whatever is ticked (DGS 2026-09-11: "Do not let
  // never-reviewed courses count even with the checkbox checked").
  const reviewed = isNotreDameInstitution(c.institution) ? rule !== undefined : external !== undefined && transferable !== undefined;
  // The course's own tick (DGS 2026-09-27) settles a `dgs_approval` verdict;
  // a `yes` verdict needs no tick and counts outright — the processing
  // request still carries it to the Grad Admin; a course with no verdict is
  // the DGS's to enter, whatever is ticked.
  const attested = needsApproval(transferable) && c.dgsApproved === true;
  const approvedForAll = transferable === 'yes';
  // Two things no sheet verdict can settle (policy review 2026-10-03), so the
  // course waits for the DGS whatever the row says:
  // — §5.2 criterion 4 needs "B (3.0 on 4.0 scale) or better", and a pass/fail
  //   mark (S, from a registrar's P / PASS / CR …) cannot show a B (DGS: "Treat
  //   S as 'cannot show a B — needs DGS review'");
  // — a course from ANOTHER university dated at or after the entry term: "The
  //   University requires prior approval of the department and the Graduate
  //   School for formal courses taken elsewhere and applied to the degree
  //   program after the student's admission" (DGS Handbook §3.14; CSE §5.2).
  const fromNd = isNotreDameInstitution(c.institution);
  const passFail = grade === 'S' && transferFloor !== undefined;
  const afterAdmission = !fromNd && compareTerm(c.term, entry) >= 0;
  // — no earlier graduate program at all (DGS 2026-10-03: "route such courses
  //   to DGS review"): the Code's §4.6 names an allowance for an unfinished
  //   program and for a completed one, and nothing for graduate courses taken
  //   outside any program. The six of the unfinished case is used as the
  //   meter (decision 2026-08-31), but no such course counts until the DGS says.
  // …and a Ph.D. student whose only earlier program is the Notre Dame MSCSE
  // (policy review round 3, P3-prior-programs-6; DGS 2026-10-07: option (a)):
  // a course from another university was taken in no program THERE — the
  // case ruled on 2026-10-03 — so it waits for the DGS too, the 6 as the
  // meter, instead of counting against a 6 no ruling gave it. A student who
  // studied in a program there says so (P3-prior-programs-1), and gets 24 or 6.
  const ndMscseOnly = student.ndMasters !== undefined;
  const noPriorProgram = !fromNd && student.priorMs === 'none';
  // — an Incomplete from another university (policy review round 3,
  //   P3-ac-4-1; DGS 2026-10-05: "an outside I should be held for DGS
  //   review"): no final grade yet, so §5.2's B cannot be shown, and Notre
  //   Dame's §4.4 clock is not its clock — the DGS decides once it is graded.
  const outsideIncomplete = !fromNd && grade === 'I';
  const heldForDgs: string[] = [
    ...(outsideIncomplete ? [`${outsideIncompleteNote(c)} — the DGS decides once the grade is final`] : []),
    ...(windowStartUnknown
      ? [`completed more than ${windowYears} years before your Ph.D. entry (before ${termLabel(shiftTermYears(entry, -windowYears!))}) — §5.2’s five years count back from your admission to the Notre Dame MSCSE, which this record does not date (no MSCSE course on it), so the DGS confirms it falls inside them`]
      : []),
    ...(noPriorProgram
      ? [
          ndMscseOnly
            ? 'taken outside any degree program at that university — your earlier graduate program is the Notre Dame MSCSE, one program with the Ph.D., and the Academic Code states a transfer allowance only for an unfinished or a completed program (Academic Code §4.6), so the DGS decides whether, and how much, transfers'
            : 'taken outside any degree program — you have no earlier graduate program on your record, and the Academic Code states a transfer allowance only for an unfinished or a completed program (Academic Code §4.6), so the DGS decides whether, and how much, transfers',
        ]
      : []),
    ...(passFail ? [`graded S (pass/fail), which cannot show the ${transferFloor} that §5.2 requires — the DGS decides whether it transfers`] : []),
    ...(afterAdmission ? [`taken ${termLabel(c.term)}, after you entered — a course taken elsewhere after admission needs the department’s and the Graduate School’s approval in advance (§5.2; DGS Handbook §3.14); the DGS confirms it was approved`] : []),
  ];
  // A university with no ExternalCourses row has no credit system on
  // record, so its credits are shown as the transcript prints them. Say
  // so while the course is unreviewed — a quarter-system transcript would
  // otherwise read a third too generous until the DGS adds the row
  // (2026-09-11).
  // Since 2026-10-03 (DGS, P1-units-4plus1-c7) the note is a part of the
  // course line whenever the credit system is unknown — row or no row — and
  // nd_credits does not fix the number; see `creditsAsPrinted` and the line
  // builder. (The transcript's own quarter/trimester reading still converts.)
  const creditsAsPrinted = !isNotreDameInstitution(c.institution) && creditSystem === undefined && external?.ndCredits === undefined;
  // §4.2 caps credits "taken from a department other than CSE" at nine,
  // wherever they were taken — and a transcript from elsewhere spells the
  // department every way there is (DGS 2026-09-09: "CompSci, CompS, CS,
  // CE, ECE, CSYE etc. all can mean CSE in fact"). The sheet decides: the
  // `cse_subject_codes` list, or an `is_cse` cell for a course the code
  // cannot settle. A course the sheet says nothing about is left out of
  // the allowance entirely rather than guessed at, so nothing changes for
  // a student until the DGS has answered. Notre Dame's own earlier
  // courses are decided by their own subject, as they always were.
  const isCse = fromNd ? deptOf(c.courseId) === 'CSE' : isCseCourse(c.courseId, external, cseSubjectCodes);
  const nonCseCap: CapId[] = isCse === false && !(shape?.caps ?? []).includes('noncse') ? ['noncse'] : [];
  // A course the sheet cannot place (DGS 2026-10-03, P1-transfer-eligibility-23:
  // "non-CSE courses may draw on the nine-credit allowance, but it needs to
  // follow the sheet's rule"): until the ExternalCourses row's `is_cse` cell
  // or the `cse_subject_codes` list says which side of §4.2's nine it is on,
  // the course is held for the DGS instead of counting as CSE by default.
  const cseUnknown = !fromNd && isCse === undefined;
  if (cseUnknown) heldForDgs.push('the course rules do not say whether this is a CSE course (no is_cse cell on its row, and no cse_subject_codes list) — §4.2’s nine-credit non-CSE allowance depends on it; the DGS decides');
  const settled = (attested || approvedForAll) && heldForDgs.length === 0;
  // The Graduate School considers a transfer request "only after a student has
  // successfully completed one semester" (DGS Handbook §3.14) and the CSE
  // handbook adds "before the semester in which the graduate degree is
  // conferred" (§5.2) — the processing sentence says when (DGS 2026-10-03:
  // the review request may go at any time; the credit-transfer request after
  // the first semester).
  const firstSemesterDone = firstSemesterComplete(student, entry, env.today).done;
  // Once the student ticks that the Graduate School approved the transfer and
  // the Grad Admin recorded it, nothing is left to send — CSE §5.2 makes the
  // Graduate School's approval the last step — and the line says so, as the
  // §5.2 card does (policy review round 3, P3-import-5).
  // The conferral semester named, or the window said closed (P3-import-4 (b)).
  const window = conferralWindow(student, env.today);
  const processWhen = student.attestations.transferRecorded === true
    ? 'recorded by the Grad Admin, as you ticked under Approvals (§5.2)'
    : window.closed !== undefined
      ? transferWindowClosedText(window.closed)
      : firstSemesterDone
        ? `send the Grad Admin the processing request to have it recorded — ${window.before} (§5.2)`
        : `send the Grad Admin the processing request once your first semester is complete — the Graduate School considers transfer requests only then, and ${window.before} (§5.2)`;
  return {
    ...extBase,
    reviewed,
    transferable,
    ...(passFail ? { passFailGrade: true as const } : {}),
    ...(afterAdmission ? { afterAdmission: true as const } : {}),
    ...(noPriorProgram ? { noPriorProgram: true as const } : {}),
    ...(windowStartUnknown ? { windowStartUnknown: true as const } : {}),
    ...(outsideIncomplete ? { outsideIncomplete: true as const } : {}),
    ...(cseUnknown ? { cseUnknown: true as const } : {}),
    ...(creditsAsPrinted ? { creditsAsPrinted: true as const } : {}),
    ...(settled && attested ? { tickApproved: true as const } : {}),
    pool: isProject ? 'total_only' : (shape?.pool ?? 'regular'),
    caps: ['transfer', ...(shape?.caps ?? []), ...nonCseCap],
    tier: tierFor(grade, !settled),
    ...(settled && approvedForAll && !attested ? { approvedNote: `approved by the DGS in the course rules — ${processWhen}${coreNote}${projectNote}` } : {}),
    // The tick settled a case-by-case course: say so, and what to do next (2026-10-03).
    ...(settled && attested ? { approvedNote: `approved by the DGS for you, as you ticked on the course (the course rules say case by case; the DGS office holds the record) (§5.2) — ${processWhen}${coreNote}${projectNote}` } : {}),
    // §5.2 "pro-rata" for non-semester systems: the DGS's fixed value for
    // this course wins; otherwise a quarter university's credits are
    // converted from what the transcript prints (DGS 2026-09-08), which is
    // the only thing that works when a course's credits vary by term.
    effectiveCredits: ndEquivalentCredits(c.credits, external, creditSystem, conversionFactor),
    ...(external?.ndCredits === undefined && (creditSystem === 'quarter' || creditSystem === 'trimester') && conversionFactor !== undefined
      ? { creditsConverted: true as const, convertedFrom: creditSystem, conversionFactor, creditSystemSource: (sheetCreditSystem !== undefined ? 'sheet' : c.creditSystemChosen ? 'student' : 'transcript') as 'sheet' | 'transcript' | 'student' }
      : {}),
    approvalPending: settled
      ? undefined
      : heldForDgs.length > 0
        ? `waiting for the DGS — ${heldForDgs.join('; ')}${attested || approvedForAll ? '' : needsApproval(transferable) ? '; the course rules also say case by case (§5.2)' : external ? '' : fromNd && rule !== undefined ? '; no transfer decision recorded yet — send the review request so the DGS can enter it' : '; not in the course rules yet — send the review request so the DGS can enter it'}${coreNote}${projectNote}`
        : // `dgs_approval` / `adgs_approval` (DGS 2026-09-08, split by
          // program 2026-09-09): the sheet has looked at the course and
          // ruled that this one needs an approval. Unlike a blank cell,
          // that IS a decision; what is open is this student's case.
          needsApproval(transferable)
          ? `waiting for the DGS — this course needs the DGS’s approval, decided case by case (§5.2)${coreNote}${projectNote}`
          : external
            ? `waiting for the DGS — listed in the course rules, decision still open (§5.2)${coreNote}${projectNote}`
            : // An earlier Notre Dame program's course the Courses tab lists
              // has a row — what is missing is its transfer decision (P3-dh-10-2).
              fromNd && rule !== undefined
              ? `waiting for the DGS — no transfer decision recorded yet; send the review request so the DGS can enter it (§5.2)${coreNote}${projectNote}`
              : `waiting for the DGS — not in the course rules yet; send the review request so the DGS can enter it (§5.2)${coreNote.replace('; may still satisfy', '; the same review can confirm').replace(' after DGS review', '')}${projectNote}`,
  };
}

/** What an Incomplete from another university is, said the same way on its
 * line, the transfer card and the review request (P3-ac-4-1, 2026-10-05). */
export function outsideIncompleteNote(c: Pick<CourseEntry, 'institution'>): string {
  return `graded I (Incomplete) at ${c.institution ?? 'your previous university'} — no final grade yet, so it cannot show the B that §5.2 requires`;
}

/** TRANSFER CREDIT ALREADY ON THE NOTRE DAME RECORD — a row of the Notre Dame
 * transcript's "Transfer credit accepted" block, at the graduate level or a
 * level the transcript does not show (policy review round 3, P3-import-1; DGS
 * 2026-10-05: "I want to apply (a), (b), and (c), with Option 1", with the three
 * conditions that make "only approved credit" true).
 *
 * Option 1: graduate credit there has been approved by the Graduate School and
 * recorded (Academic Code §4.6 criterion 5: "the transfer is recommended by the
 * DGS and approved by the Graduate School"; DGS Handbook §3.14: "An official
 * transcript from the institution where the course/s were taken is required
 * before credits will be added to a student's record"), so it counts — inside
 * §5.2's allowance, at the hours Notre Dame recorded, with no ExternalCourses
 * row, no review request and no processing request. §5.2's other criteria (the
 * grade, the window, graduate status, approval before a course taken after
 * admission) were the Graduate School's to check before it approved, and the
 * block's date is the term the credit was RECORDED, not taken (fix (a)), so
 * none of them is applied again — an exception, for this credit alone, to the
 * 2026-09-11 rule that a course nobody has reviewed stays pending.
 *
 * It still waits for the DGS — whose answer for this student is the tick on the
 * course — when the transcript does not show that it is graduate credit
 * (condition 1), or when it was recorded before this program began, so it may
 * have been accepted for an earlier Notre Dame program (condition 3: the
 * Graduate School considers a transfer only after the first semester, DGS
 * Handbook §3.14, so this program's own credit is always recorded after entry).
 * §4.2's nine-credit non-CSE allowance follows the sheet as for any transfer. */
function classifyPosted(env: ClassifyEnv, c: CourseEntry, extBase: ClassifiedCourse, posting: NdPosting, coreNote: string): ClassifiedCourse {
  const { entry, cseSubjectCodes } = env;
  const held = [
    ...(posting.level === undefined ? ['the transcript does not show whether it is graduate credit'] : []),
    ...(compareTerm(posting.term, entry) < 0 ? [`it was posted before you entered this program, so it may have been accepted for an earlier program`] : []),
  ];
  const isCse = isCseCourse(c.courseId, extBase.external, cseSubjectCodes);
  const cseUnknown = isCse === undefined;
  const ticked = held.length > 0 && c.dgsApproved === true;
  const settled = (held.length === 0 || ticked) && !cseUnknown;
  const where = `transfer credit on your Notre Dame record (posted ${termLabel(posting.term)})`;
  return {
    ...extBase,
    reviewed: true,
    ndPosting: posting,
    ...(held.length > 0 ? { ndPostingHeld: held.join('; and ') } : {}),
    ...(cseUnknown ? { cseUnknown: true as const } : {}),
    ...(settled && ticked ? { tickApproved: true as const } : {}),
    pool: 'regular',
    caps: ['transfer', ...(isCse === false ? (['noncse'] as CapId[]) : [])],
    tier: settled ? 'definite' : 'provisional',
    effectiveCredits: posting.credits,
    ...(settled
      ? { approvedNote: `${where} — accepted by the Graduate School${ticked ? ', and the DGS confirmed it counts toward this degree, as you ticked on the course' : ''}; nothing to send (Academic Code §4.6)${coreNote}` }
      : {
          approvalPending: `${where}${held.length > 0 ? `, but ${held.join(', and ')} — the DGS confirms it counts toward this degree` : ''}${cseUnknown ? `${held.length > 0 ? '; ' : ' — '}the course rules do not say whether this is a CSE course (no is_cse cell on its row, and no cse_subject_codes list) — §4.2’s nine-credit non-CSE allowance depends on it; the DGS decides` : ''}${coreNote}`,
        }),
  };
}

/** NOTRE DAME COURSEWORK TAKEN AS AN UNDERGRADUATE that could count toward the
 * degree — the inner block of the transfer branch, moved out whole.
 * `course` carries what the transfer branch had already worked
 * out for the course before it reached this block. */
function classifyPriorNdUndergraduate(
  env: ClassifyEnv,
  course: {
    c: CourseEntry;
    rule: RuleCourse | undefined;
    extBase: ClassifiedCourse;
    coreNote: string;
    ndCoreArea: string | undefined;
    areaName: (code: string) => string;
    qualifierApplies: boolean;
    awardedTerm: Term | undefined;
    undergradLevel: number;
  },
): ClassifiedCourse {
  const { student, program, bsShared } = env;
  const { c, rule, extBase, coreNote, ndCoreArea, areaName, qualifierApplies, awardedTerm, undergradLevel } = course;
  const grade = c.grade;
  // For an MSCSE student the question has TWO answers (DGS 2026-09-11):
  // the course counted only toward the MSCSE, or toward both the
  // bachelor's and the MSCSE — "'count to neither' or no answer are not
  // options". Records saved under the earlier four-way question are
  // read the same way: 'bs' meant the bachelor's used it (→ both), and
  // 'neither' meant it did not (→ MSCSE only).
  // The MSCSE never asks: the app decides which courses are shared with
  // the bachelor's degree (bsShared, above) and says so on the line.
  const bsShare: 'both' | 'mscse' | undefined = program === 'mscse' ? (bsShared.has(c) ? 'both' : 'mscse') : undefined;
  const spent = program === 'mscse' ? bsShare : c.countedToward;
  // Every Ph.D. student is asked (Graduate School through the DGS,
  // 2026-09-22: "Only up to 6 credits may double-count towards two degrees.
  // If 6 credits have double-counted to BS & MS, no more credits can
  // double-count to BS & PhD later when the student pursues PhD."). Until
  // then only a student holding a Notre Dame master's was asked, because the
  // one bar was the three-degree one; now a course the bachelor's degree used
  // draws the same six-credit allowance for the Ph.D., so the answer decides
  // how it counts for everyone. A student without a Notre Dame master's is
  // offered the two answers that can be true of them (app.ts).
  const askedWhichDegrees = program === 'phd';
  const holdsNdMasters = student.ndMasters !== undefined;
  const shape = rule ? priorNdShape(c.courseId, rule, program, c.dgsApproved === true) : undefined;
  // "The DGS approved this course for me" (DGS 2026-10-08): on a course the
  // course rules list WITH a verdict for this program, the tick settles every
  // approval below that is the DGS's to give for this student — as it settles
  // a case-by-case verdict. A course not in the rules, or one whose verdict
  // cell is blank, still goes through the review request first: the DGS
  // enters the row (or fills the cell) before any per-student approval.
  const verdict = rule === undefined ? undefined : program === 'mscse' ? rule.countsTowardMscse : rule.countsTowardPhd;
  const ticked = verdict !== undefined && c.dgsApproved === true;
  if (shape && 'ineligibleReason' in shape) {
    return { ...extBase, ineligibleReason: `${shape.ineligibleReason}${coreNote}` };
  }
  // ONLY A 4+1's graduate coursework earns MSCSE credit (DGS 2026-09-12,
  // red-team F7, backed by §3.5): "If the student was just a BS (not 4+1
  // BS/MS integration), the 60xxx courses taken as an undergrad student do
  // not count toward credits of MSCSE or PhD. They may qualify for the
  // core knowledge and specialization category requirements of PhD
  // students even without credit transfer." The 40000-level allowance
  // (§3.2/§4.2's "up to two") is the degree's own and is not touched.
  // (§5.2's five-year window no longer binds this coursework — DGS
  // 2026-10-03, dropping the 2026-09-14 reading: the Code's window is for
  // transfer credit, and a Notre Dame undergraduate's graduate coursework is
  // not transfer credit.)
  // For the PH.D. the Academic Code's last §4.6 paragraph lets ANY Notre Dame
  // undergraduate's graduate coursework "meet graduate program requirements"
  // with the program's advance approval, and CSE §4.2 says nothing against it
  // — so a non-4+1's 60000-level course is routed to the DGS rather than
  // refused (policy review 2026-10-03, P1-units-4plus1-7).
  const plainBachelorsSixk = undergradLevel >= 6 && student.integratedBsMs !== true;
  if (plainBachelorsSixk && program === 'mscse') {
    return {
      ...extBase,
      notTransferCredit: true,
      ineligibleReason: `not counted — a 60000-level course taken as an undergraduate earns MSCSE credit only for a student who was in the Integrated B.S. + M.S. (4+1) program (§3.5)${student.integratedBsMs === false ? '' : '; if you were, say so in the earlier-degrees questions in the Transcripts card'}`,
    };
  }
  const plainBachelorsApproval = plainBachelorsSixk && !ticked
    ? `taken as an undergraduate outside the Integrated 4+1 program — the Academic Code (§4.6) lets it meet Ph.D. requirements only with the program’s advance approval; the DGS decides${student.integratedBsMs === false ? '' : '. If you were in the 4+1, say so in the earlier-degrees questions in the Transcripts card'}`
    : undefined;
  // A 4+1's pre-bachelor's CSE 68901/68902 DOES satisfy the MSCSE project or
  // thesis requirement (DGS 2026-10-03, P1-units-4plus1-17: "pre-bachelor
  // 68901/68902 can be used to satisfy MSCSE thesis/project requirements"),
  // reversing the 2026-09-12 reading of §3.2's "earned at Notre Dame" as
  // "while enrolled". The condition, in the DGS's words (2026-10-03,
  // P1-page-text-engine-23): "For the 4+1 students, 68901/68902 can be taken
  // before BS is awarded and still count towards MSCSE, given that they have
  // not been applied to BS" — which is why the course is never one of the
  // shared pair (bsShared takes regular courses only) and why it needs the
  // UG→GR move the 4+1 guidance requires of coursework kept off the bachelor's. It flows through the same path as any other 60000-level
  // course taken as an undergraduate — the sheet row's pool ('project') puts
  // it toward the six, never the 24; it is never one of §3.5's shared pair
  // (bsShared takes regular courses only); the UG→GR move is confirmed like
  // any other. A project/thesis course from ANOTHER university still does not
  // transfer (the transfer branch's own rule).
  // The level rules are the degree's, not the transcript's: this
  // coursework counts the way the same course would if it were taken in
  // the program. Below the 60000 level that means §4.2's six-credit
  // allowance and nothing under the 40000 level at all — an
  // undergraduate transcript is full of 1xxxx and 2xxxx courses, and
  // without this they filled that allowance.
  // §3.5's WINDOW, for the MSCSE: "Students in the Integrated B.S. + M.S.
  // program may take one or two 3-credit CSE courses at the 6xxxx level in
  // the second semester of the junior year and the senior year" and "count
  // these both as undergraduate CSE electives/Tech electives and as course
  // requirements for the MSCSE degree". Since 2026-10-07 (DGS, policy review
  // round 3, P3-fourplusone-1) the window limits only the courses SHARED with
  // the bachelor's — the one or two §3.5 describes; bsShared (classify)
  // chooses them inside it. A 4+1's graduate course the bachelor's did not use
  // counts toward the MSCSE from any undergraduate term (DGS: "a grad course
  // taken in the junior year may count towards MS, as long as it's not used
  // towards BS"; asked which terms: "Any undergraduate term"), on the Graduate
  // School's answer by email to the DGS, for 4+1 students only: "Any
  // graduate-level coursework a student may have taken as an undergraduate
  // that was not used to satisfy the bachelor's degree could theoretically be
  // used towards both the master's and the PhD." This replaces the 2026-09-11
  // reading that refused a course from before the junior spring, and drops
  // the ADGS approval an unshared junior-spring course needed (2026-10-03
  // default; DGS 2026-10-07: "Drop it").
  //
  // The award term places a course in the student's academic years, so a
  // course chosen to be shared cannot be checked against the window without
  // it: that one waits for it. The Ph.D. has no window at all.
  /** "CSE" in §3.5 both times, so a non-CSE graduate course taken as an
   * undergraduate is the ADGS's to approve (policy review 2026-10-03): the
   * course is provisional rather than refused. */
  let sectionThreeFiveApproval: string | undefined;
  let sectionThreeFiveAsked = false;
  if (program === 'mscse' && undergradLevel >= 6) {
    if (bsShare === 'both' && awardedTerm === undefined) {
      return {
        ...extBase,
        ineligibleReason:
          'not counted yet — set the semester your bachelor’s degree was awarded, under Your standing. §3.5 lets a course count toward both your bachelor’s degree and the MSCSE only from the second semester of your junior year on, and this page cannot tell which year this course was in until it knows when you graduated',
      };
    }
    if (deptOf(c.courseId) !== 'CSE') {
      sectionThreeFiveAsked = true;
      if (!ticked) sectionThreeFiveApproval = '§3.5 names CSE courses — a graduate course from another department, taken as an undergraduate, counts toward the MSCSE only if the DGS approves it';
    }
  }
  // THE 4+1 ADMISSION TERM. Since 2026-10-07 (DGS, policy review round 3,
  // P3-fourplusone-1) a 4+1's graduate course that the bachelor's degree did not
  // use counts toward the MSCSE whenever it was taken — before the admission
  // term too (4+1 matriculation is in the fall or the spring of the senior
  // year, DGS). This replaces the 2026-10-04 rule (P2-fourplusone-1) that
  // refused such a course before the admission term and held it until the
  // term was entered. What stays: a student who says they were admitted AFTER
  // the bachelor's is not in the 4+1 the guidance describes — "Only six credits
  // can be double-counted if a student starts the graduate program after the
  // bachelor's degree has been awarded" — so beyond the shared six nothing counts.
  //
  // The transcript can contradict that answer (policy review round 3,
  // P3-fourplusone-2; DGS 2026-10-07: option (2)): a row Notre Dame registers
  // GR was moved from UG to GR, which the guidance has approved only "before
  // the students' bachelor's degree is awarded" — so an admission after the
  // bachelor's and a moved course cannot both be right. The app does not pick
  // one: the course counts provisionally, the DGS confirms, and the student is
  // asked to recheck the term (audit.ts). A UG or unlevelled row is refused.
  let admissionTermConflict: string | undefined;
  let admissionConflictAsked = false;
  if (program === 'mscse' && undergradLevel >= 6 && student.integratedBsMs === true && bsShare === 'mscse' && awardedTerm !== undefined) {
    const admitted = student.integratedAdmitted;
    if (admitted !== undefined && compareTerm(admitted, awardedTerm) > 0) {
      if (c.registeredLevel === 'graduate') {
        admissionConflictAsked = true;
        if (!ticked) admissionTermConflict = `your Notre Dame transcript registers it at the graduate level (moved from UG to GR), but the Integrated-program admission you gave, ${termLabel(admitted)}, is after your bachelor’s degree (${termLabel(awardedTerm)}) — check that term under Your standing; the DGS confirms`;
      } else {
        return {
          ...extBase,
          ineligibleReason: `not counted — you were admitted to the Integrated program for ${termLabel(admitted)}, after your bachelor’s degree (${termLabel(awardedTerm)}); the Graduate School counts only six credits — the ones shared with the bachelor’s — for a student who started the graduate program after the bachelor’s was awarded (4+1 guidance)`,
        };
      }
    }
  }
  // THE UG→GR MOVE (Graduate School 4+1 guidance; DGS Handbook §3.21.4): a
  // 4+1's graduate courses "over and above those being used to satisfy the
  // undergraduate degree" count only once "moved from undergraduate level (UG)
  // to graduate level (GR)", approved by the advising dean and the Graduate
  // School "before the students' bachelor's degree is awarded". The transcript
  // is the evidence: a pre-bachelor's 60000-level row the Notre Dame transcript
  // registers GR was moved; one registered UG, or typed in with no level, was
  // not shown to be — so it is counted provisionally and sent to the DGS
  // (policy review 2026-10-03). The shared pair is untouched: the guidance
  // puts the moved credits "in addition to the six".
  const ugToGrAsked = undergradLevel >= 6 && !plainBachelorsSixk && c.registeredLevel !== 'graduate' && !(program === 'mscse' ? bsShare === 'both' : spent === 'bs' || spent === 'both');
  const ugToGrUnverified = ugToGrAsked && !ticked;
  // Only now, when the course could actually count, is the student asked
  // anything: no course may count toward three degrees, so the answer
  // decides it. A 20000-level course counts nothing at any answer, and
  // asking about it would be noise on every undergraduate transcript.
  // The three-degree bar is the PH.D.'s: a course already spent on the
  // bachelor's and the master's cannot be spent a third time. For an
  // MSCSE student "both" is not a bar at all — it describes the
  // double-counting §3.5 allows, and the cap below is what limits it.
  if (spent === 'both' && program === 'phd') {
    return {
      ...extBase,
      ineligibleReason: `not counted — you have told us this course already counted toward your bachelor’s degree AND your master’s, and no course may count toward three degrees${coreNote}`,
    };
  }
  // An MSCSE student is asked the same question about a 40000-level
  // course on their own undergraduate transcript. "Up to two 40000-level
  // courses taken by ND undergraduates can count towards both BS and
  // MSCSE" is a MAY, not a must (DGS 2026-09-11): the answer decides
  // which allowance the course draws on — §3.2's alone if the bachelor's
  // degree never used it, §3.5's shared six credits as well if it did —
  // and the sheet row decides whether it needs an approval on top.
  if (spent === undefined && askedWhichDegrees) {
    // The Ph.D. asks about three degrees; the MSCSE student has only two
    // in play, and what their answer decides is which allowance the
    // course draws on — §3.5's shared six credits, or §3.2's alone.
    return {
      ...extBase,
      ineligibleReason:
        // `student.program`, not the alias: the compiler has narrowed the
        // alias to 'phd' through askedWhichDegrees, and the MSCSE
        // sentence is kept as written for the record (the MSCSE never
        // reaches here — bsShared answers for it).
        student.program === 'mscse'
          ? `not counted yet — choose, next to the course, whether it counts only toward your MSCSE or toward both your bachelor’s degree and your MSCSE. At most 6 credits may count toward both (§3.5), so the answer decides how this one counts${coreNote}`
          : holdsNdMasters
            // The rule itself is said once, under the question next to the
            // course (UI review, 2026-10-08: it was on the line and under it).
            ? `not counted yet — say which degrees this course has already counted toward, next to the course${coreNote}`
            : `not counted yet — say, next to the course, whether your bachelor’s degree used this course${coreNote}`,
    };
  }
  // 60000 and above: in full, and outside every cap the app has — the
  // Graduate School put these beyond §5.2's twenty-four in as many words.
  const belowSixty = undergradLevel < 6;
  // A non-CSE course the sheet does not list — every MATH or EE 60xxx
  // on a non-CSE transcript — is still "from a department other than
  // CSE" (§4.2): it draws the nine-credit non-CSE allowance and needs
  // the same advisor + DGS approval a non-CSE course taken in the
  // program needs, cleared by the same checkbox (DGS 2026-09-11; until
  // then twelve credits of EE 60xxx touched no cap and no checkbox).
  const unlistedNonCse = rule === undefined && deptOf(c.courseId) !== 'CSE';
  const nonCseApproval =
    unlistedNonCse ? `non-CSE course — needs advisor + DGS approval (${program === 'mscse' ? '§3.2' : '§4.2'})` : undefined;
  // Counted, but the DGS is asked: not in the rules sheet at all, or in
  // it with a verdict that names an approval this student has not
  // attested (2026-09-11) — "they may count, subject to all other
  // constraints, so they should be listed for further decisions".
  const shapeApproval = shape !== undefined && !('ineligibleReason' in shape) ? shape.approvalPending : undefined;
  // §3.5 lets an MSCSE student count coursework their bachelor's degree
  // already used, up to six credits in all — "an ND 4+1 student can have
  // up to 6 credits (whether 40xxx or 60xxx courses) counted towards
  // both degrees" (DGS 2026-09-10). The Ph.D. has the same six from the
  // Graduate School (2026-09-22): a course the bachelor's degree used and
  // the MSCSE did not ('bs') would count toward two degrees here, inside
  // whatever the courses counted toward the bachelor's AND the MSCSE left
  // of the allowance (audit.ts builds that cap) — provisionally, since the
  // Academic Code's written exception (§4.6) is for an integrated
  // bachelor's/MASTER'S program and the BS + Ph.D. six rests on the Graduate
  // School's 2026-09-22 answer to the department (policy review 2026-10-03).
  // A course the MSCSE used ('mscse') is MSCSE coursework, and the Graduate
  // School treats the CSE MSCSE and Ph.D. as one graduate program (DGS
  // 2026-10-03), so it counts in full; 'neither' was extra and counts in full.
  const sharedWithBachelors: CapId[] = bsShare === 'both' || (program === 'phd' && spent === 'bs') ? ['sharedbs'] : [];
  const bsPhdAsked = program === 'phd' && spent === 'bs';
  const bsPhdDoubleCount =
    bsPhdAsked && !ticked
      ? 'the Graduate School’s 2026-09-22 answer to the department allows the sharing, but the Academic Code does not yet state it (Academic Code §4.6 writes the six-credit exception for an integrated bachelor’s/master’s program) — the DGS confirms'
      : undefined;
  const ugToGrApproval = ugToGrUnverified
    ? 'counts only if it was moved from undergraduate (UG) to graduate (GR) registration — approved by your advising dean and the Graduate School before your bachelor’s degree was conferred (Graduate School 4+1 guidance); your Notre Dame transcript does not show the move, so the DGS confirms it'
    : undefined;
  const extraApprovals = [plainBachelorsApproval, sectionThreeFiveApproval, bsPhdDoubleCount, ugToGrApproval, admissionTermConflict].filter((x): x is string => x !== undefined);
  // The approvals the DGS gives for this student (the tick settles them).
  const dgsApprovalAsked = verdict !== undefined && ((plainBachelorsSixk && program === 'phd') || sectionThreeFiveAsked || ugToGrAsked || bsPhdAsked || admissionConflictAsked);
  const dgsTicked = ticked && dgsApprovalAsked && extraApprovals.length === 0;
  const provisional = rule === undefined || shapeApproval !== undefined || extraApprovals.length > 0;
  // The Academic Code lets a Notre Dame undergraduate's graduate coursework
  // meet program requirements "with advanced approval from the graduate
  // program" (§4.6): the Courses tab's `yes` IS that approval (DGS 2026-10-03,
  // P1-transfer-eligibility-24), and a counted 60000-level course says so.
  const tickApproved = rule !== undefined && c.dgsApproved === true && shapeApproval === undefined && (() => { const s = priorNdShape(c.courseId, rule, program, false); return !('ineligibleReason' in s) && s.approvalPending !== undefined; })();
  // Only on the rules' own `yes` for this program (policy review round 3,
  // P3-fourplusone-7): a ticked case-by-case row was approved for this
  // student, and its tick sentence says so — the line used to claim the
  // rules said yes, then that they say case by case.
  const advanceApproval =
    !provisional && undergradLevel >= 6 && student.integratedBsMs === true && verdict === 'yes'
      ? 'counted on the course rules’ yes, which is the program’s advance approval for graduate coursework taken as an undergraduate (Academic Code §4.6)'
      : undefined;
  const approvalText =
    rule === undefined
      ? `not in the course rules — counted provisionally; needs DGS review${nonCseApproval ? `; ${nonCseApproval}` : ''}${extraApprovals.length > 0 ? `; ${extraApprovals.join('; ')}` : ''}`
      : [shapeApproval, ...extraApprovals].filter((x): x is string => x !== undefined).join('; ');
  return {
    ...extBase,
    ...(bsShare !== undefined ? { bsShare } : {}),
    ...(ugToGrUnverified ? { ugToGrUnverified: true as const } : {}),
    ...(admissionTermConflict !== undefined ? { admissionTermConflict: true as const } : {}),
    ...(dgsApprovalAsked ? { dgsApprovalAsked: true as const } : {}),
    ...(dgsTicked && !tickApproved ? { dgsTicked: true as const } : {}),
    pool: shape?.pool ?? 'regular',
    caps: [
      ...sharedWithBachelors,
      ...(belowSixty ? ['fourk' as CapId, ...(shape?.caps ?? []).filter((id) => id !== 'fourk')] : (shape?.caps ?? []).filter((id) => id !== 'fourk')),
      ...(unlistedNonCse ? ['noncse' as CapId] : []),
    ],
    tier: tierFor(grade, provisional),
    ...(rule === undefined ? { unknown: true as const } : {}),
    ...(approvalText !== '' ? { approvalPending: approvalText } : {}),
    ...(advanceApproval !== undefined ? { approvedNote: advanceApproval } : {}),
    ...(tickApproved ? { tickApproved: true as const } : {}),
  };
}

/** Credits of Notre Dame coursework the student says counted toward BOTH the
 * bachelor's degree and the MSCSE — the courses that used up the Graduate
 * School's two-degree allowance before the Ph.D. began (2026-09-22). Read off
 * the record, not the classification: the answer is the fact, whatever else
 * the course's line says. */
export function spentOnBachelorsAndMasters(student: Student): number {
  return student.courses
    .filter((c) => c.origin === 'transfer' && c.countedToward === 'both' && isNotreDameInstitution(c.institution))
    .reduce((sum, c) => sum + c.credits, 0);
}

const TIER_ORDER: Tier[] = ['definite', 'in_progress', 'provisional'];

/** Fill the caps. Order-independent by construction: courses are processed in
 * (tier, term, course id) order regardless of entry order, and multi-cap
 * courses get an exact best-permutation search (they are vanishingly rare —
 * after the DGS's Q5 answer every cap signature is a singleton). */
export function allocate(
  classified: ClassifiedCourse[],
  caps: CapSpec[],
  /** Where non-CSE credit the nine-credit allowance refuses goes: into the
   * total for the Ph.D. (§4.2 scopes the nine to "the course requirement" — F1,
   * 2026-09-12), nowhere for the MSCSE (§3.2, September 2026: the nine count
   * "toward both the graduate school's 30-credit requirement and the
   * department's 24-credit regular course requirement" — DGS 2026-10-03). */
  opts: {
    nonCseSpillsToTotal: boolean;
    /** The courses that fill §4.2's research seminar requirement — the
     * Ph.D.'s `phd_seminar_courses`, none on the MSCSE, which has no seminar
     * requirement. Any other seminar-type course counts toward the total only,
     * and its line says so (policy review 2026-10-04, P1-sheet-40: SOC 63270,
     * and on the MSCSE CSE 63801/63802, read "the research seminar requirement"). */
    seminarCourseIds?: readonly string[];
  } = { nonCseSpillsToTotal: true },
): AllocationResult {
  const capRoom = new Map<CapId, number>();
  const capUsage: AllocationResult['capUsage'] = new Map();
  const capById = new Map<CapId, CapSpec>();
  for (const cap of caps) {
    capRoom.set(cap.id, cap.limit ?? 0);
    capUsage.set(cap.id, { used: 0, limit: cap.limit, excluded: [] });
    if (!capById.has(cap.id)) capById.set(cap.id, cap); // first spec wins, as the scans it replaces did
  }
  const capLabel = (id: CapId) => capById.get(id)?.label ?? id;

  const sums = {
    regular: { ...ZERO_SUMS },
    project: { ...ZERO_SUMS },
    seminar: { ...ZERO_SUMS },
    totalOnly: { ...ZERO_SUMS },
    total: { ...ZERO_SUMS },
    ndRegular: { ...ZERO_SUMS },
    ndResearch: { ...ZERO_SUMS },
    transfer: { ...ZERO_SUMS },
  };

  const allocations = new Map<ClassifiedCourse, CourseAllocation>();

  /** A cap the Parameters tab does not give a limit for. Its courses are not
   * counted — nothing may be granted on a guess — but they are not "over the
   * cap" either: the app cannot tell, and says so (CLAUDE.md: "A missing
   * parameter renders 'cannot evaluate', never a default"). Before this the
   * room was `limit ?? 0`, so a missing cap silently read as zero and painted
   * every affected course red (2026-09-09). */
  const missingLimitCap = (cc: ClassifiedCourse): CapId | undefined =>
    cc.caps.find((id) => capById.get(id)?.limit === undefined);

  const take = (cc: ClassifiedCourse, amount: number) => {
    const credits = cc.effectiveCredits ?? cc.entry.credits;
    const unknownCap = missingLimitCap(cc);
    const counted = unknownCap ? 0 : Math.min(credits, amount);
    const excluded = credits - counted;
    for (const capId of cc.caps) {
      capRoom.set(capId, (capRoom.get(capId) ?? 0) - counted);
      const usage = capUsage.get(capId)!;
      usage.used += counted;
      if (excluded > 0) usage.excluded.push(cc.entry.courseId);
    }
    const isRegular = cc.pool === 'regular';
    const target =
      cc.pool === 'regular' ? sums.regular : cc.pool === 'project' ? sums.project : cc.pool === 'seminar' ? sums.seminar : sums.totalOnly;
    target[cc.tier] += counted;
    sums.total[cc.tier] += counted;
    // §4.2 / §3.2 scope the non-CSE allowance to "the course requirement":
    // "Up to nine (9) credits … may be used to satisfy the course
    // requirement." A credit that allowance refuses is still a passed
    // graduate credit toward the Graduate School's total of courses and
    // research (F1, 2026-09-12 — superseding the 2026-08-31 default for this
    // one cap; the below-60000 allowance still refuses outright).
    const boundCaps = excluded > 0 ? cc.caps.filter((id) => (capRoom.get(id) ?? Infinity) <= 0) : [];
    // …but an UNREVIEWED §5.2 candidate has no standing in any total yet (DGS
    // 2026-09-06: "every graduate course here is a candidate … until the DGS
    // has ruled", and the allocator "never ranks the candidates"). F1 is about
    // a settled credit the allowance refuses, not about a course whose place
    // in the record is still an open question — spilling a candidate's
    // over-cap credits into the total made the report contradict itself
    // (red-team 2026-09-13): the course's own line said "counts only if the
    // DGS picks it" while the 60-credit row had already counted it as pending.
    const unreviewedCandidate =
      cc.caps.includes('transfer') && cc.tier === 'provisional' && cc.entry.origin === 'transfer' && cc.transferable !== 'yes' && cc.ndPosting === undefined;
    const spillsToTotal =
      opts.nonCseSpillsToTotal && excluded > 0 && !unknownCap && !unreviewedCandidate && boundCaps.length > 0 && boundCaps.every((id) => id === 'noncse');
    if (spillsToTotal) {
      sums.totalOnly[cc.tier] += excluded;
      sums.total[cc.tier] += excluded;
    }
    // §4.2's nine at Notre Dame: courses taken in the program, and (DGS
    // 2026-09-22) the regular courses of the student's own Notre Dame MSCSE —
    // not a 4+1's undergraduate coursework (DGS 2026-09-13).
    if (isRegular && (cc.entry.origin === 'nd' || cc.ndMastersCredit)) sums.ndRegular[cc.tier] += counted;
    if (cc.entry.origin === 'nd' && (cc.rule?.courseType === 'research' || cc.rule?.courseType === 'project')) {
      sums.ndResearch[cc.tier] += counted; // §4.5 along-the-way (DGS 2026-09-04)
    }
    // §5.2's running total counts only what §5.2's cap governs. Notre Dame
    // coursework taken as an undergraduate is filed as 'transfer' (it is not
    // this program's coursework) but is NOT transfer credit: the Graduate
    // School put it "above and beyond the usual 24" (2026-09-10). Counting it
    // here made the §5.2 row read "6 of 6 transfer credits counted" for a
    // student with no transfer credit at all.
    if (cc.entry.origin === 'transfer' && cc.caps.includes('transfer')) sums.transfer[cc.tier] += counted;

    const excludedReason = unknownCap
      ? `the rules sheet does not say what the ${capLabel(unknownCap)} is, so this course cannot be counted yet — ask the DGS to fill it in (${capById.get(unknownCap)?.section ?? ''})`
      : excluded > 0 && cc.caps.length > 0
        ? (() => {
            // Name the cap that actually ran out, not every cap the course
            // draws on (2026-09-11): an all-non-CSE master's read "over the
            // transfer-credit cap and 9-credit non-CSE cap" with 15 of the 24
            // transfer credits still free.
            const named = boundCaps.length > 0 ? boundCaps : cc.caps;
            return `over the ${named.map(capLabel).join(' and ')} (${capById.get(named[0]!)?.section ?? ''})`;
          })()
        : undefined;
    // An UNREVIEWED transfer course is a candidate, whatever the cap did with
    // it here (DGS 2026-09-06): the DGS decides which courses transfer, so
    // the allocator's choice of which candidates fill the cap is not a
    // verdict — its line says "candidate", never "over the cap".
    const transferCandidate = unreviewedCandidate ? { capLimit: capById.get('transfer')?.limit } : undefined;
    allocations.set(cc, {
      course: cc,
      countedRegular: isRegular ? counted : 0,
      countedOther: (isRegular ? 0 : counted) + (spillsToTotal ? excluded : 0),
      excluded: spillsToTotal ? 0 : excluded,
      ...(spillsToTotal ? { overCapToTotal: excluded } : {}),
      excludedReason,
      ...buildExplanation(
        cc,
        counted,
        excluded,
        excludedReason,
        transferCandidate,
        unknownCap !== undefined,
        capById.get('fourk'),
        spillsToTotal,
        (opts.seminarCourseIds ?? []).includes(cc.entry.courseId.toUpperCase().replace(/\s+/g, ' ')),
      ),
    });
  };

  for (const tier of TIER_ORDER) {
    // The courses the app chose to apply to both degrees fill their caps
    // first (2026-09-11): the choice is "best grade first", and the term
    // order below would otherwise hand §3.2's six credits to a weaker course
    // taken earlier, leaving the chosen one "over the cap".
    // A passed grade below C never fills a cap or counts toward a sum
    // (passesCreditFloor — DGS decision 2026-09-12, Academic Code §4.3): such
    // a course still falls through to the "ineligible courses" loop below.
    const inTier = classified.filter((c) => c.tier === tier && c.pool !== 'none' && passesCreditFloor(c.entry.grade));
    const chosen = inTier.filter((c) => c.bsShare === 'both');
    const singles = inTier.filter((c) => c.bsShare !== 'both' && c.caps.length <= 1);
    const multis = inTier.filter((c) => c.bsShare !== 'both' && c.caps.length > 1);

    for (const cc of chosen) {
      const room = cc.caps.length === 0 ? Infinity : Math.min(...cc.caps.map((id) => Math.max(0, capRoom.get(id) ?? 0)));
      take(cc, room);
    }
    for (const cc of singles) {
      const room = cc.caps.length === 0 ? Infinity : Math.max(0, capRoom.get(cc.caps[0]!) ?? 0);
      take(cc, room);
    }

    if (multis.length > 0) {
      // Exact: try every processing order, keep the one counting the most
      // credits (first best in permutation order → deterministic).
      const best = bestMultiOrder(multis, new Map(capRoom));
      for (const cc of best) {
        const room = Math.min(...cc.caps.map((id) => Math.max(0, capRoom.get(id) ?? 0)));
        take(cc, room);
      }
    }
  }

  // Ineligible courses still get a line — pool === 'none', or a passed grade
  // below the credit floor (DGS decision 2026-09-12, Academic Code §4.3): the
  // course still satisfies §4.4.1 core knowledge via isPassed() (unaffected,
  // read straight off ctx.classified), just no credit-hour requirement.
  for (const cc of classified) {
    if (cc.pool !== 'none' && passesCreditFloor(cc.entry.grade)) continue;
    const belowCreditFloor = cc.pool !== 'none';
    const reason = belowCreditFloor
      ? 'a passed grade below C does not count toward any credit-hour requirement (Academic Code §4.3)'
      : cc.ineligibleReason;
    allocations.set(cc, {
      course: cc,
      countedRegular: 0,
      countedOther: 0,
      excluded: cc.entry.credits,
      excludedReason: reason,
      ...buildExplanation(cc, 0, cc.entry.credits, reason),
    });
  }

  const perCourse = classified.map((cc) => allocations.get(cc)!);
  return { perCourse, ...sums, capUsage };
}

/** The processing order for the multi-cap courses that counts the most credits.
 *
 * Every order is still considered and the FIRST best one still wins, so the
 * answer is exactly what enumerating the permutations gave — but the search is
 * a depth-first walk with memoing and a bound instead of a materialised list of
 * n! orders. The old version built every permutation up front: 10 courses is
 * 3.6 million arrays, 11 is 40 million, and a student with eleven unreviewed
 * prior-program courses (a transfer candidate that is also non-CSE draws on two
 * caps, so it lands here) froze the page at load for minutes on end while the
 * browser allocated them — a renderer pinned at ~200% CPU and Chrome's "Page
 * Unresponsive" (DGS report 2026-09-16). The walk below visits each remaining
 * set × cap-room state once.
 *
 * Why the result is unchanged: the credits a course takes depend only on the
 * room left when its turn comes, so what an order is worth from here on depends
 * only on (which courses are left, how much room each cap has) — never on how
 * the prefix got there. Children are visited in array order, which is
 * lexicographic permutation order, and a candidate replaces the best only when
 * it counts STRICTLY more, so the first best order is the one that survives —
 * and a branch whose optimistic bound cannot beat the best is skipped, which
 * can never discard a strictly better order. */
function bestMultiOrder(
  multis: ClassifiedCourse[],
  roomSnapshot: Map<CapId, number>,
): ClassifiedCourse[] {
  const n = multis.length;
  if (n <= 1) return multis;
  // Only the caps these courses actually draw on take part in the state.
  const capIds = [...new Set(multis.flatMap((c) => c.caps))];
  const creditsOf = (cc: ClassifiedCourse): number => cc.effectiveCredits ?? cc.entry.credits;
  const startRooms = capIds.map((id) => Math.max(0, roomSnapshot.get(id) ?? 0));
  const capIndex = new Map(capIds.map((id, k) => [id, k]));
  const courseCaps = multis.map((cc) => cc.caps.map((id) => capIndex.get(id)!));

  const memo = new Map<string, { counted: number; order: number[] }>();
  /** Best counted credits obtainable from `remaining`, and the first order that
   * gets there. `rooms` is this state's room per cap, in capIds order. */
  const solve = (remaining: number[], rooms: number[]): { counted: number; order: number[] } => {
    if (remaining.length === 0) return { counted: 0, order: [] };
    const key = remaining.join(',') + '|' + rooms.join(',');
    const hit = memo.get(key);
    if (hit) return hit;
    let best: { counted: number; order: number[] } | undefined;
    // An optimistic ceiling for the whole state — no course can take more than
    // its own credits, nor more than the smallest room it draws on.
    const ceiling = remaining.reduce(
      (sum, i) => sum + Math.min(creditsOf(multis[i]!), Math.min(...courseCaps[i]!.map((k) => rooms[k]!))),
      0,
    );
    for (let p = 0; p < remaining.length; p++) {
      const i = remaining[p]!;
      const avail = Math.min(...courseCaps[i]!.map((k) => rooms[k]!));
      const took = Math.min(creditsOf(multis[i]!), avail);
      if (best && ceiling <= best.counted) break; // no child can strictly beat it
      const nextRooms = rooms.slice();
      for (const k of courseCaps[i]!) nextRooms[k] = nextRooms[k]! - took;
      const sub = solve([...remaining.slice(0, p), ...remaining.slice(p + 1)], nextRooms);
      const counted = took + sub.counted;
      if (!best || counted > best.counted) best = { counted, order: [i, ...sub.order] };
    }
    // No room anywhere: every remaining course counts zero, in array order.
    const result = best ?? { counted: 0, order: [...remaining] };
    memo.set(key, result);
    return result;
  };

  const { order } = solve(
    multis.map((_, i) => i),
    startRooms,
  );
  return order.map((i) => multis[i]!);
}

/** The three live states a counted course can be in (DGS 2026-09-13): earned,
 * being taken now, or waiting on an approval. They were one amber mark until
 * then. */
const markForTier = (tier: Tier): CourseMark =>
  tier === 'definite' ? 'counts' : tier === 'in_progress' ? 'in_progress' : 'pending';

/** The per-course line and its colour (DGS request 2026-09-06). A credit that
 * is only counted PROVISIONALLY — until an advisor/DGS approval — is not
 * presented as counting: its line leads with "pending DGS review — would
 * count …", amber; an in-progress credit leads with "in progress — will
 * count … when passed", amber; a definite credit "counts toward …", green;
 * a credit that earns nothing "not counted — …", red. The mark is what the
 * page paints; the words carry the same fact for print and copies. */
/** The line as two: what the course does for CREDIT, and — for a Ph.D.
 * student's course that also serves §4.4.1 — what it does for the QUALIFIER,
 * each with its own mark (DGS 2026-09-27: "2 is fine"). Until then one line
 * carried both, and a red ✕ sat beside "satisfies the … core-knowledge
 * requirement" while the §4.4.1 card read Met from the same course. The core
 * clause the classifier appends ("; satisfies the … core-knowledge requirement
 * (§4.4.1) …") moves to the second line; a line that consists of that clause
 * alone (an undergraduate course that never claimed credit) stays as it was,
 * and so does the 2026-09-11 rule that a "not counted" credit line is never
 * green — the qualifier line is where the green goes. */
function buildExplanation(...args: Parameters<typeof buildExplanationText>): { explanation: string; mark: CourseMark; qualifier?: { mark: CourseMark; text: string } } {
  const r = buildExplanationText(...args);
  const m = /; ((?:the same review can confirm|satisfies|may still satisfy) [^;]*core-knowledge requirement[^;]*)/.exec(r.explanation);
  if (!m) return r;
  const text = (r.explanation.slice(0, m.index) + r.explanation.slice(m.index + m[0].length)).trim();
  if (text === '') return r;
  const clause = m[1]!;
  const qualifierMark: CourseMark = /^satisfies/.test(clause) ? 'counts' : 'pending';
  const mark: CourseMark = /^not counted yet/.test(text) ? 'pending' : /^not counted/.test(text) ? 'excluded' : r.mark;
  return { explanation: text, mark, qualifier: { mark: qualifierMark, text: clause } };
}

function buildExplanationText(
  cc: ClassifiedCourse,
  counted: number,
  excluded: number,
  excludedReason?: string,
  transferCandidate?: { capLimit: number | undefined },
  /** A cap this course draws on whose limit the Parameters tab is missing:
   * amber and honest, never the red "over the cap" (2026-09-09). */
  capLimitMissing?: boolean,
  /** The cap on courses below the 60000 level, so the line can name its own
   * degree's § and credit limit (§3.2's for the MSCSE, §4.2's for the
   * Ph.D. — 2026-09-11). */
  fourkCap?: CapSpec,
  /** The refused credits still count toward the total (the non-CSE cap, F1). */
  spillsToTotal = false,
  /** The course fills the Ph.D.'s research seminar requirement (one of
   * `phd_seminar_courses`); any other seminar-type course feeds the total only. */
  fillsSeminar = false,
): { explanation: string; mark: CourseMark } {
  const parts: string[] = [];
  if (capLimitMissing) return { explanation: excludedReason ?? 'cannot be counted yet — a cap is missing from the rules sheet', mark: 'pending' };
  const poolName =
    cc.pool === 'regular'
      ? 'regular courses'
      : cc.pool === 'project'
        ? 'the project/thesis requirement'
        : cc.pool === 'seminar' && fillsSeminar
          ? 'the research seminar requirement'
          : 'the total-credit requirement only';
  const total = cc.effectiveCredits ?? cc.entry.credits;
  if (transferCandidate) {
    // Every unreviewed graduate course from a prior program is a CANDIDATE
    // for transfer credit until the DGS rules (DGS 2026-09-06: only
    // CSE-related courses transfer, the DGS decides which, up to the cap) —
    // amber, and never "over the cap", whichever candidates the allocator
    // happened to fit under the cap for the running totals.
    // The general rule (CSE-related only, the DGS decides, the cap) is said
    // once above the transcript's group in the coursework card; each line
    // carries only what is specific to the course.
    const capWord = transferCandidate.capLimit !== undefined ? `${transferCandidate.capLimit}-credit ` : '';
    const fate =
      counted > 0 && excluded === 0
        ? `would count toward ${poolName} (${formatCredits(counted)} cr) if approved`
        : counted > 0
          ? `would count ${formatCredits(counted)} of ${formatCredits(total)} credits toward ${poolName} if approved (the ${capWord}transfer allowance limits the rest)`
          : `counts only if the DGS picks it — together the candidates exceed the ${cc.caps.includes('noncse') ? 'non-CSE allowance or the ' : ''}${capWord}transfer allowance`;
    const coreNote = /; (the same review can confirm|satisfies) [^;]*core-knowledge requirement[^;]*/.exec(cc.approvalPending ?? '')?.[0] ?? '';
    // The two facts the pending text carries that the student must see on the
    // line itself (2026-09-11): a ticked checkbox that cannot apply to an
    // unreviewed course, and credits printed in a system the sheet does not
    // know yet.
    // Since 2026-10-03 the flag, not the pending text, says so (P1-units-4plus1-c7).
    const creditNote = cc.creditsAsPrinted ? `; ${'credits as your transcript prints them — the DGS converts quarter, trimester or other units (§5.2 pro-rata)'}` : '';
    // An Incomplete from another university says so on its own line (P3-ac-4-1, 2026-10-05).
    const incompleteNote = cc.outsideIncomplete ? `; ${outsideIncompleteNote(cc.entry)} — the DGS decides once the grade is final` : '';
    return {
      // A Notre Dame course here is one from the student's EARLIER Notre Dame
      // program (red-team wording table, 2026-09-12): say so, since its
      // "Where" cell reads Taken at Notre Dame.
      // The status first, in the words the Approvals row and the emails use
      // (clarity review 2026-09-26): what is being waited for, then what the
      // course would do. "Candidate" is the DGS's word for it; the §5.2
      // paragraph above the group says it once.
      explanation: `waiting for the DGS — ${fate}${isNotreDameInstitution(cc.entry.institution) ? ' — a course from your earlier Notre Dame program' : ''} (§5.2)${incompleteNote}${creditNote}${coreNote}`,
      mark: 'pending',
    };
  }
  // A transfer the DGS has ALREADY ruled transferable (ExternalCourses tab)
  // is not "pending DGS review": it is pre-approved and waits only for the
  // Grad Admin's processing (DGS 2026-09-07 — until then one line said both
  // "would count … once approved" and "pre-approved").
  const preApproved = cc.tier === 'provisional' && /^approved by the DGS/.test(cc.approvalPending ?? '');
  // A dual-degree course whose only wait is the Graduate School's approval of
  // the plan of study (DGS Handbook §2.9; 2026-10-04) names the Graduate
  // School, not the DGS, as the one it waits for.
  const graduateSchoolOnly = cc.tier === 'provisional' && /^also counts toward your other degree/.test(cc.approvalPending ?? '') && !(cc.approvalPending ?? '').includes('; ');
  const lead = preApproved
    ? 'approved by the DGS — will count'
    : graduateSchoolOnly
      ? 'waiting for the Graduate School — would count'
      : cc.tier === 'provisional'
        ? 'waiting for the DGS — would count'
        : cc.tier === 'in_progress'
          ? 'in progress — will count'
          : 'counts';
  const unlisted = /^not in the course rules yet/.test(cc.approvalPending ?? '');
  const tail = preApproved
    ? ' as transfer credit once the Grad Admin has recorded it'
    : cc.tier === 'provisional'
      ? unlisted
        ? ' once the DGS has added it to the course rules'
        : ' once approved'
      : cc.tier === 'in_progress'
        ? ' when passed'
        : '';
  let mark: CourseMark;
  if (spillsToTotal) {
    mark = markForTier(cc.tier);
    const how = counted > 0 ? `${lead} ${formatCredits(counted)} of ${formatCredits(total)} credits toward ${poolName} and ${formatCredits(excluded)} toward the total-credit requirement only${tail}` : `${lead} toward the total-credit requirement only (${formatCredits(excluded)} cr)${tail}`;
    parts.push(`${how} — ${excludedReason ?? 'beyond the non-CSE allowance'} — the allowance limits regular-course credit, not the total`);
    return { explanation: parts.join('; '), mark };
  }
  if (counted > 0 && excluded > 0) {
    mark = markForTier(cc.tier);
    // Every conditional lead already ends in the bare "count" ("would count",
    // "will count"); only the definite lead is "counts", and the rewrite that
    // used to sit here hit exactly that one, so a passed course partly over a
    // cap read "count 1 of 4 credits toward regular courses" (2026-09-09).
    parts.push(
      `${lead} ${formatCredits(counted)} of ${formatCredits(total)} credits toward ${poolName}${tail}; ${formatCredits(excluded)} not counted — ${excludedReason ?? ''}`,
    );
  } else if (counted > 0) {
    mark = markForTier(cc.tier);
    parts.push(`${lead} toward ${poolName} (${formatCredits(counted)} cr)${tail}`);
    if (cc.ndPosting !== undefined && cc.effectiveCredits !== undefined && cc.effectiveCredits !== cc.entry.credits) {
      parts.push(`counted as ${formatCredits(cc.effectiveCredits)} ND ${cc.effectiveCredits === 1 ? 'credit' : 'credits'}, as your Notre Dame record shows them (the ${cc.entry.institution ?? 'other'} transcript shows ${formatCredits(cc.entry.credits)})`);
    } else if (cc.effectiveCredits !== undefined && cc.effectiveCredits !== cc.entry.credits) {
      parts.push(
        `counted as ${formatCredits(cc.effectiveCredits)} ND ${cc.effectiveCredits === 1 ? 'credit' : 'credits'} ${cc.creditsConverted ? `converted from the ${cc.convertedFrom ?? 'quarter'} system at ${creditSystemFactorLabel(cc.conversionFactor ?? 1)}${cc.creditSystemSource === 'transcript' ? ` — your transcript says ${cc.convertedFrom ?? 'quarter'} terms; the DGS’s decision for the university can correct this` : cc.creditSystemSource === 'student' ? ` — you chose ${cc.convertedFrom ?? 'quarter'} terms when importing; the DGS’s decision for the university can correct this` : ''}` : 'per the DGS’s value for this course'} (transcript shows ${formatCredits(cc.entry.credits)}; §5.2)`,
      );
    }
    // The cap covers both levels below 60000 since 2026-09-09, so the line
    // must name the course's OWN level: a 50000-level bridge course was
    // telling the student it "uses the 40000-level allowance".
    if (cc.caps.includes('fourk')) {
      const level = levelOf(cc.entry, cc.rule);
      // The § is the degree's: §3.2 for the MSCSE, §4.2 for the Ph.D. Both it
      // and the number of credits come from the cap the audit built, so the
      // line cannot drift from the Parameters tab (2026-09-11).
      const limit = fourkCap?.limit !== undefined ? `${formatCredits(fourkCap.limit)} credits, ` : '';
      parts.push(
        `uses the ${Number.isFinite(level) ? `${level}0000-level` : 'below-60000'} allowance (${limit}${fourkCap?.section ?? '§4.2'})`,
      );
    }
    if (cc.caps.includes('noncse')) parts.push('uses the non-CSE allowance');
    if (cc.approvedNote) parts.push(cc.approvedNote);
    if (cc.dgsTicked) parts.push('approved by the DGS for you, as you ticked on the course (the DGS office holds the record)');
    if (cc.tickApproved && !cc.caps.includes('transfer')) parts.push('approved by the DGS for you, as you ticked on the course (the course rules say case by case; the DGS office holds the record)');
    // The credit system is unknown (no row, a blank or rejected credit_system) and
    // nd_credits does not fix the number (DGS 2026-10-03, P1-units-4plus1-c7).
    if (cc.creditsAsPrinted) parts.push('credits as your transcript prints them — the DGS converts quarter, trimester or other units (§5.2 pro-rata)');
    // A letter the student chose for a mark the app could not map (policy
    // review 2026-10-03, P1-transfer-eligibility-7): said on the line, so the
    // DGS checks the conversion against §5.2's B rather than taking it as read.
    if (cc.entry.origin === 'transfer' && cc.entry.transcriptMark && GRADES.includes(cc.entry.grade)) parts.push(`${cc.entry.grade === 'IP' ? 'in progress' : cc.entry.grade} is your own reading of the transcript’s mark “${cc.entry.transcriptMark}” — the DGS checks it against the B that §5.2 requires`);
    // What the course WILL apply to — said in those words (DGS 2026-09-11:
    // "clear enough for students to know that courses WILL apply to both BS &
    // MSCSE or WILL apply to only MSCSE, instead of 'already counted'").
    if (cc.bsShare === 'both') parts.push(`will apply to both your bachelor’s degree and your MSCSE — one of the courses chosen for the six credits shared with your bachelor’s degree (${levelOf(cc.entry, cc.rule) >= 6 ? '§3.5' : 'the Graduate School’s written answer, 2026-09-10'})`);
    else if (cc.bsShare === 'mscse') parts.push('will apply to your MSCSE only');
    // The Ph.D.'s answers (Graduate School through the DGS, 2026-09-22): the
    // course's second degree is said on the line, with the rule that lets it.
    else if (cc.caps.includes('sharedbs')) parts.push('counts toward both your bachelor’s degree and the Ph.D. — inside the 6 credits that may count toward two degrees (Graduate School)');
    else if (cc.entry.countedToward === 'mscse' && cc.entry.origin === 'transfer')
      // Separated by five years or more (DGS 2026-10-06): the pending reason
      // says why it waits, so the line names only the degree.
      // The reason is said once, in the group's intro (UI review, 2026-10-08).
      parts.push(cc.mscseSeparated ? 'counted toward your MSCSE' : 'counted toward your MSCSE — counts in full as Ph.D. coursework');
    // "counts in full" only when nothing is still to be approved: a plain
    // bachelor's course or an unverified UG→GR move says why it waits instead
    // (policy review 2026-10-03).
    else if (cc.entry.countedToward === 'neither' && cc.entry.origin === 'transfer') parts.push(cc.approvalPending ? 'not used by an earlier degree' : 'not used by an earlier degree — counts in full');
    // Separated by five years or more (DGS 2026-10-06): the pending reason
    // carries the MSCSE and the rule; only a project or thesis adds its pool.
    if (cc.ndMastersCredit && cc.mscseSeparated) {
      if (cc.pool === 'total_only') parts.push('a master’s project or thesis is not a regular course, so it counts toward the total credits only (§4.2)');
    }
    // The fact on every row; the reason (one graduate program, DGS 2026-10-03)
    // once, in the group's intro above the rows (UI review, 2026-10-08).
    else if (cc.ndMastersCredit) parts.push(`from your Notre Dame MSCSE — counts in full as Ph.D. coursework (not transfer credit)${cc.pool === 'total_only' ? '; a master’s project or thesis is not a regular course, so it counts toward the total credits only (§4.2)' : ''}`);
    // The rule, not a computed date (policy review round 3, P3-cross-doc-4; DGS
    // 2026-10-06: "Apply the suggested handling"): the 30 days are the
    // student's and the 14 after them the instructor's (Academic Code §4.4:
    // "30 calendar days from when grades were due … to complete the
    // coursework. The instructor of record then has 14 calendar days to report
    // the grade"; CSE §5.1). The app does not know when grades were due, and
    // its stand-in, the term's nominal end, falls after it — so no date is
    // given. `incompleteDue` (44 days) still decides when the line lapses.
    if (cc.incompleteDue !== undefined && !cc.incompleteLapsed)
      parts.push(
        `Incomplete (I): finish the work within 30 calendar days of the date grades were due for that semester, or the I becomes an F; the instructor then has 14 days to report the grade (Academic Code §4.4; CSE §5.1)${cc.incompleteCohortNote ? '. For students enrolled in Spring 2020, Academic Code Appendix A.1 may give 60 days — confirm with the DGS' : ''}`,
      );
    // The semester the student graduates (P3-dh-3.1-3.13-3; DGS 2026-10-06, the optional (3)).
    if (cc.incompleteInGraduationTerm) parts.push(`${termLabel(cc.entry.term)} is your graduation semester, and the degree is conferred only with no I grades in it (DGS Handbook §3.23.1)`);
    // The pending note already says "transfer — …(§5.2)" (and the pre-approved
    // lead says "as transfer credit"); say it once.
    if (cc.caps.includes('transfer') && !preApproved && !cc.approvedNote && !/^transfer|§5\.2/.test(cc.approvalPending ?? '')) parts.push('transfer credit (§5.2)');
  } else {
    const reason = excludedReason ?? 'not counted';
    // An undergraduate course that satisfies (green) or may satisfy (amber) a
    // §4.4.1 core area earns no credit but is not "excluded" either.
    // …and so does a graduate course excluded for §5.2 reasons (the award
    // term, the window, the grade floor, a DGS "no") whose line carries a
    // core note: confirmed → green, keyword → amber (2026-09-06 evening).
    // A course whose fate waits on the student's own answer is amber, whatever
    // else its line says: green would tell them it is settled (2026-09-10).
    // …but a line that says "not counted" is never painted green, whatever
    // else it carries (DGS 2026-09-11): the core area it earns is reported on
    // its own §4.4.1 row, and a green tick beside "not counted" read as a
    // contradiction. Undergraduate lines that LEAD with the core area keep
    // their colour — they never claim credit.
    mark = /^not counted yet/.test(reason)
      ? 'pending'
      : /^not counted/.test(reason)
        ? 'excluded'
        : /^satisfies/.test(reason)
          ? 'counts'
          : /^may satisfy|; may still satisfy /.test(reason)
            ? 'pending'
            : 'excluded';
    parts.push(/not counted|not relevant|superseded|failed|^satisfies|^may satisfy/.test(reason) ? reason : `not counted — ${reason}`);
    // A course that earns nothing anyway does not need the approval note —
    // the review request still lists it (DGS 2026-09-06: the old suffix read
    // as if a review could make it count).
    return { explanation: parts.join('; '), mark };
  }
  // The pre-approved note's opening repeats the lead: keep its instruction.
  // Likewise a held course's reason after the lead "waiting for the DGS — …"
  // (2026-10-05: the line said it twice).
  if (cc.approvalPending)
    parts.push(
      preApproved
        ? cc.approvalPending.replace(/^approved by the DGS in the course rules — send/, 'send')
        : lead.startsWith('waiting for the DGS')
          ? cc.approvalPending.replace(/^waiting for the DGS — /, '')
          : cc.approvalPending,
    );
  return { explanation: parts.join('; '), mark };
}
