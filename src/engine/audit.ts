// The engine's only entry point: audit(student, rules, today) → AuditReport.
// Pure by contract (CLAUDE.md): no DOM, no fetch, no Date.now() — "today" is an
// argument so tests are deterministic.
import { transferRecordedFor } from './transfer-recorded.ts';
import { undergraduateGraduateCourseworkFlagFor } from './review.ts';
import type { Rules } from '../data/types.ts';
import { BS_SHARED_CREDITS_MAX, DUAL_DEGREE_SHARED_CREDITS_MAX, NON_DEGREE_CREDITS_MAX, allocate, classify, conferralWindow, levelOf, decidedCaseByCase, heldByRecord, longInterruptionReadmission, mscseSeparation, overMaxTerms, registrationCaps, spentOnBachelorsAndMasters, type CapId, type CapSpec, type CourseMark } from './allocate.ts';
import { specialTracks } from './tracks.ts';
import { decisionWording, decisionWordingDeep } from './decider.ts';
import { beforeProgramStart } from './early-start.ts';
import { normalizeEntryTerm, termIndex, termLabel, compareTerm, termOfDate, semesterSeq, startOfTerm } from './term.ts';
import type { AuditReport, Grade, RequirementResult, Student, TermGpa } from './types.ts';
import { beforeForfeiture, datedBeforeForfeiture, isCovidCohort, priorRulesQualifierHeld, type Ctx } from './requirements/context.ts';
import { uncoveredRegistrationGaps } from './registration-gaps.ts';
import { fullTimeTermRecords, graduateLevelFlag, sameTermDuplicate } from './requirements/residency.ts';
import { transferCourseChecks } from '../data/course-checks.ts';
import { isNotreDameInstitution } from '../data/external.ts';
import { advisorReviewFlag, advisorRow, approvalsRow, goodStandingRow, gpaRow, gpaText, noGpaYet } from './requirements/shared.ts';
import { mscseRows, msTimeLimitRow, summerOnlyReviewFlag, thesisReadersReviewFlag } from './requirements/mscse.ts';
import { extensionReviewFlag } from './requirements/context.ts';
import { ADMISSION_DEADLINE_SEMESTER, eighthSemester, phdRows, phdTimeLimitRow, qualifierPriorRulesEligible, readmissionGapCounted } from './requirements/phd.ts';
import { msMilestoneDeadlines, phdMilestoneDeadlines } from './requirements/milestone-deadlines.ts';
import { exactCredits, formatCredits } from './credits.ts';
import { GRADE_POINTS, isAudit, isInProgress, isPassed, meetsGradeFloor } from './grades.ts';

/** Requirement id ↔ plan-inventory mapping (docs/DECISIONS.md, plan §1):
 *   shared.gpa=S1  shared.advisor=S2  shared.approvals=advisory
 *   ms.credits.total=M1  ms.credits.regular=M2  ms.credits.project=M3
 *   ms.cap.fourk=M4  ms.cap.noncse=M5  ms.residency=M6  ms.timeLimit=M7
 *   ms.thesis.topic=M8a (unscored, Academic Code §6.1.7 — 2026-10-04)
 *   ms.thesis.defense=M8  ms.project.report=M9
 *   phd.credits.total=P1  phd.credits.regular=P2  phd.seminar=P3
 *   phd.cap.noncse=P4  phd.cap.fourk=P5  phd.credits.nd=P6  phd.transfer=P7
 *   phd.residency=P8  phd.timeLimit=P9  phd.qualifier=P10
 *   phd.qualifier.core.{os,algorithms,architecture}=P10a
 *   phd.qualifier.categories=P10b  phd.qualifier.research=P10c
 *   phd.candidacy=P11 (the OCE)  phd.candidacyAdmission=P11a (admission to
 *   candidacy, Academic Code §6.2.9 — DGS 2026-10-04)  (P12, the readers'
 *   approval phd.dissertation.approval, removed 2026-10-04 — the defense row
 *   stands for it)
 *   phd.dissertation.defense=P13  phd.msAlongTheWay=P14 */
export const REQUIREMENT_IDS = [
  'shared.gpa',
  'shared.advisor',
  'shared.goodStanding',
  'shared.approvals',
  'shared.msCandidacy',
  'ms.credits.total',
  'ms.credits.regular',
  'ms.credits.project',
  'ms.cap.fourk',
  'ms.cap.noncse',
  'ms.cap.sharedbs',
  'ms.cap.otherdegree',
  'ms.transfer',
  'ms.residency',
  'ms.timeLimit',
  'ms.thesis.topic',
  'ms.thesis.defense',
  'ms.thesis.submitted',
  'ms.project.report',
  'phd.credits.total',
  'phd.credits.regular',
  'phd.credits.nd',
  'phd.seminar',
  'phd.cap.fourk',
  'phd.cap.noncse',
  'phd.cap.sharedbs',
  'phd.cap.otherdegree',
  'phd.transfer',
  'phd.residency',
  'phd.timeLimit',
  'phd.qualifier',
  'phd.qualifier.core.os',
  'phd.qualifier.core.algorithms',
  'phd.qualifier.core.architecture',
  'phd.qualifier.categories',
  'phd.qualifier.research',
  'phd.rcr',
  'phd.candidacy',
  'phd.candidacyAdmission',
  'phd.dissertation.defense',
  'phd.dissertation.submitted',
  'phd.msAlongTheWay',
] as const;

/** "6-credit non-CSE cap" — or just "non-CSE cap" when the Parameters tab has
 * no value for it, since "?-credit" reads like a typo in the sentence that
 * then tells the student the sheet is missing it (2026-09-09). */
function capLabel(limit: number | undefined, name: string): string {
  return limit === undefined ? name : `${limit}-credit ${name}`;
}

/** The Ph.D.'s cap on coursework counted toward two degrees: the sheet's six
 * credits less what the bachelor's-and-MSCSE courses already took. */
function sharedDegreesCap(base: number | undefined, spent: number): CapSpec {
  const limit = base === undefined ? undefined : Math.max(0, base - spent);
  return {
    id: 'sharedbs',
    limit,
    label:
      spent > 0 && base !== undefined
        ? // Never "9 of its 6" (credit-transfer review 2026-10-28, #45): the
          // answers that say more are warned about at the top.
          `allowance for coursework counted toward two degrees — ${spent > base ? 'all' : formatCredits(spent)} of its ${formatCredits(base)} credits already used by the courses counted toward your bachelor’s degree and your MSCSE`
        : capLabel(limit, 'allowance for coursework counted toward two degrees'),
    section: 'Graduate School',
  };
}

/** The Graduate School's numbers for its probation and dismissal grounds
 * (Academic Code §5.7.3, §5.8) — kept in code, not on the sheet, as the
 * Graduate School's (DGS 2026-10-04; README § A5b). */
export const PROBATION_CUMULATIVE_GPA = 3.0; // §5.7.3: "A cumulative grade point average below 3.0 in any two semesters"
export const DISMISSAL_TERM_GPA = 2.5; // §5.8: "A semester G.P.A. below 2.5 in any single semester"
export const DISMISSAL_TWO_TERMS_GPA = 3.0; // §5.8: "or below 3.0 for two consecutive semesters"
export const PROBATION_RESEARCH_U = 2; // §5.7.3: "Earning a U in research for two consecutive semesters"
export const DISMISSAL_RESEARCH_U = 3; // §5.8: "three consecutive U grades in research"

/** The longest run of consecutive fall/spring semesters in `seqs` (semesterSeq). */
function longestRun(seqs: number[]): number[] {
  const sorted = [...new Set(seqs)].sort((a, b) => a - b);
  let best: number[] = [];
  let run: number[] = [];
  for (const s of sorted) {
    run = run.length > 0 && run[run.length - 1]! + 1 === s ? [...run, s] : [s];
    if (run.length > best.length) best = run;
  }
  return best;
}

export function audit(asEntered: Student, rules: Rules, today: string): AuditReport {
  // A 0.00 typed in the first semester, before any grade, is the
  // transcript's "0.000 over 0 GPA hours" — no GPA at all, on every row and in
  // every email, not a GPA below the minimum (DGS 2026-10-14; review of the
  // change: the defense and candidacy checks still read it as 0.00).
  const student: Student = asEntered.gpa === 0 && noGpaYet(asEntered, today) ? { ...asEntered, gpa: undefined } : asEntered;
  const params = rules.parameters;
  const { term: entry, normalized } = normalizeEntryTerm(student.entryTerm);

  const { classified, warnings, staleInProgress } = classify(student, rules, today);

  const num = (key: string) => params.number(key);
  // Academic Code §2.3's limit on coursework earned in non-degree status — a
  // Graduate School number kept in code (policy review 2026-10-03).
  const nonDegreeCap: CapSpec = { id: 'nondegree', limit: NON_DEGREE_CREDITS_MAX, label: `${NON_DEGREE_CREDITS_MAX}-credit allowance for non-degree coursework`, section: 'Academic Code §2.3' };
  // Academic Code §2.2's nine credits shared with another degree the student
  // is enrolled in at the same time — also a Graduate School number (policy
  // review 2026-10-04, P2-ac-1-3-2).
  const otherDegreeCap: CapSpec = {
    id: 'otherdegree',
    limit: DUAL_DEGREE_SHARED_CREDITS_MAX,
    label: `${DUAL_DEGREE_SHARED_CREDITS_MAX}-credit allowance for coursework shared with your other degree`,
    section: 'Academic Code §2.2',
  };
  const baseCapSpecs: CapSpec[] =
    student.program === 'mscse'
      ? [
          nonDegreeCap,
          otherDegreeCap,
          { id: 'fourk', limit: num('ms_4xxxx_credits_max'), label: capLabel(num('ms_4xxxx_credits_max'), 'cap on courses below the 60000 level'), section: '§3.2' },
          { id: 'noncse', limit: num('ms_noncse_credits_max'), label: capLabel(num('ms_noncse_credits_max'), 'non-CSE cap'), section: '§3.2' },
          // §3.5's limit on coursework shared with the bachelor's (2026-09-10):
          // Academic Code §4.6's six, in code since 2026-10-07 (P3-sheet-5 (a)).
          {
            id: 'sharedbs',
            limit: BS_SHARED_CREDITS_MAX,
            label: capLabel(BS_SHARED_CREDITS_MAX, 'allowance for coursework shared with your bachelor’s degree'),
            section: '§3.5',
          },
          {
            id: 'transfer',
            limit: num(student.priorMs === 'completed' ? 'ms_transfer_completed_ms_credits_max' : 'transfer_unfinished_ms_credits_max'),
            label: 'transfer-credit cap',
            section: '§5.2',
          },
        ]
      : [
          nonDegreeCap,
          otherDegreeCap,
          { id: 'fourk', limit: num('phd_4xxxx_cse_credits_max'), label: capLabel(num('phd_4xxxx_cse_credits_max'), 'cap on courses below the 60000 level'), section: '§4.2' },
          { id: 'noncse', limit: num('phd_noncse_6xxxx_credits_max'), label: capLabel(num('phd_noncse_6xxxx_credits_max'), 'non-CSE cap'), section: '§4.2' },
          // The Graduate School's six credits that may count toward two degrees
          // (through the DGS, 2026-09-22): what the courses counted toward the
          // bachelor's AND the MSCSE used up is gone for the Ph.D. — "If 6
          // credits have double-counted to BS & MS, no more credits can
          // double-count to BS & PhD later". The same six as §3.5's allowance
          // (BS_SHARED_CREDITS_MAX, in code since 2026-10-07).
          sharedDegreesCap(BS_SHARED_CREDITS_MAX, spentOnBachelorsAndMasters(student)),
          {
            id: 'transfer',
            limit: num(student.priorMs === 'completed' ? 'phd_transfer_completed_ms_credits_max' : 'transfer_unfinished_ms_credits_max'),
            label: 'transfer-credit cap',
            section: '§5.2',
          },
        ];

  // More than six credits answered as counted toward both the bachelor's and
  // the MSCSE (credit-transfer review 2026-10-28, #45): the Graduate School
  // allows at most six toward two degrees, so at least one answer is likely
  // wrong — said, rather than read as "9 of its 6 credits already used".
  const sharedSpent = spentOnBachelorsAndMasters(student);
  if (student.program === 'phd' && sharedSpent > BS_SHARED_CREDITS_MAX)
    warnings.push(
      `Your answers count ${formatCredits(sharedSpent)} credits of Notre Dame coursework toward both your bachelor’s degree and your MSCSE — the Graduate School allows at most ${BS_SHARED_CREDITS_MAX} toward two degrees, so check the “Counted toward” answers on those courses.`,
    );

  // On probation (Academic Code §5.7.2; DGS 2026-10-04, policy review
  // P2-ac-5b-6.1-3 — "a rare case", asked under Your standing behind a
  // selector): the probation letter's stipulations and date govern, and may be
  // earlier than any deadline this page computes (an OCE "by the end of next
  // semester", say). Said at the top; no row is recomputed.
  const probation = student.probationLetterDeadline;
  if (probation !== undefined) {
    warnings.push(
      probation < today
        ? `On probation: the deadline in your probation letter, ${probation}, has passed. Confirm your standing with the DGS — missing the letter’s stipulations can lead to dismissal (Academic Code §5.7.2, §5.8).`
        : `On probation: the deadline in your probation letter is ${probation}. The letter’s stipulations and that date govern — the deadlines on this page do not extend them, and missing them can lead to dismissal (Academic Code §5.7.2, §5.8).`,
    );
  }

  // Academic Code §3.8's maximal registration (DGS 2026-10-03,
  // P1-residency-enrollment-c4: "cap a semester's credits"): at most 15
  // credits of graduate courses count from a fall or spring semester, 10 from
  // a summer session, unless the student marks the semester's credit overload
  // as approved. Usually a duplicate row or a wrong credit value — the warning
  // says which semester.
  const overMax = overMaxTerms(classified, student, entry);
  const capSpecs: CapSpec[] = [...baseCapSpecs, ...registrationCaps(overMax)];

  // Non-CSE credit the nine-credit allowance refuses: into the total for the
  // Ph.D. (F1, 2026-09-12), nowhere for the MSCSE (DGS 2026-10-03 — §3.2's
  // September text counts the nine "toward both" the 30 and the 24).
  const allocOptions = {
    nonCseSpillsToTotal: student.program === 'phd',
    // Only the Ph.D. has a research seminar requirement (§4.2); on the MSCSE a
    // seminar the ADGS approves counts toward the 30, never the 24 (DGS
    // 2026-10-04, P1-sheet-40).
    seminarCourseIds: student.program === 'phd' ? (params.courseList('phd_seminar_courses') ?? []) : [],
    // §4.2's nine at Notre Dame and the MSCSE along the way, counted from the
    // Notre Dame courses alone (credit-transfer review 2026-10-28) — Ph.D. rows.
    notreDameCounts: student.program === 'phd',
  };
  const alloc = allocate(classified, capSpecs, allocOptions);
  // The semesters over §3.8's maximum, with the credits the maximum itself
  // refused — not the excess over it, part of which another cap may already
  // refuse (credit-transfer review 2026-10-28, #70: "so 2 credits are not
  // counted" when the maximum cut nothing).
  for (const o of overMax) {
    if (o.overloadApproved) continue;
    const capId: CapId = `term:${termIndex(o.term)}`;
    const refused = exactCredits(alloc.perCourse.filter((p) => (p.boundCaps ?? []).includes(capId)).reduce((sum, p) => sum + p.excluded, 0));
    const summer = o.term.season === 'summer';
    warnings.push(
      `${termLabel(o.term)}: ${formatCredits(o.credits)} credits of ${summer ? 'courses' : 'graduate courses (60000 level or higher)'} are entered — the Graduate School allows at most ${o.max} in ${summer ? 'the summer session' : 'a semester'} (Academic Code §3.8; DGS Handbook §3.9)${refused > 0 ? `, so ${formatCredits(refused)} ${refused === 1 ? 'credit is' : 'credits are'} not counted` : ''}. Check for a duplicate row or a wrong credit value; if a credit overload was approved for you, tick it under Approvals you already have.`,
    );
  }

  // The department's qualifier clocks run from the Ph.D.'s own start: for a
  // transfer from the unfinished MSCSE, the term of the transfer (DGS
  // 2026-10-03), while §4.3 and §4.5 keep the MSCSE's entry (DGS 2026-09-26).
  const transferred = student.background?.graduate === 'nd-mscse-transfer' ? student.background.transferredTerm : undefined;
  const qualifierEntry = transferred !== undefined && compareTerm(transferred, entry) > 0 ? normalizeEntryTerm(transferred).term : entry;
  const clockShift = Math.max(0, Math.floor(student.leaveSemesters ?? 0)) + Math.max(0, Math.floor(student.accommodationSemesters ?? 0));
  const ctx: Ctx = {
    student,
    rules,
    today,
    entry,
    qualifierEntry,
    clockShift,
    ...(longInterruptionReadmission(student) ? { forfeitBefore: longInterruptionReadmission(student)! } : {}),
    covidCohort: isCovidCohort(student, entry),
    alloc,
    classified,
    params,
  };
  // The record as it stood at a dated OCE (policy review round 3, P3-cse-4b-1;
  // DGS 2026-10-06: "Decision 1: The exam's semester"). CSE §4.5: "All
  // coursework for the Ph.D. must be completed (or in progress the same
  // semester) before the candidacy exam can be taken." Courses after the
  // exam's semester are left out, and the exam semester's own courses read as
  // in progress whatever their final grade — they were in progress when the
  // exam was taken, so a later W or F does not flag a legitimate exam, and a
  // course registered later does not hide a short one. The same
  // classification and allocation run on it ("today" being the exam date).
  const oceDate = student.program === 'phd' ? student.milestones.candidacyPassed : undefined;
  if (oceDate !== undefined) {
    const examTerm = termOfDate(oceDate);
    const asOfExam: Student = {
      ...student,
      courses: student.courses
        .filter((c) => compareTerm(c.term, examTerm) <= 0)
        .map((c) => (compareTerm(c.term, examTerm) === 0 && !isAudit(c.grade) ? { ...c, grade: 'IP' as Grade } : c)),
    };
    const atExam = classify(asOfExam, rules, oceDate).classified;
    const atExamAlloc = allocate(atExam, [...baseCapSpecs, ...registrationCaps(overMaxTerms(atExam, asOfExam, entry))], allocOptions);
    ctx.atOce = { ...ctx, student: asOfExam, today: oceDate, alloc: atExamAlloc, classified: atExam };
  }
  const reviewFlags: string[] = [];
  // The examinations from before an interruption of five years or more, for the page's Approvals tick (below).
  let examsBeforeInterruption: string[] = [];
  const ugFlag = undergraduateGraduateCourseworkFlagFor(classified, student);
  if (ugFlag) {
    reviewFlags.push(ugFlag);
    warnings.push(`${ugFlag} This is included in the review request.`);
  }
  // A `yes` in the ExternalCourses tab the DGS may not have meant (DGS
  // 2026-10-04, P1-sheet-48 / -c2: "a warning needs to be shown to
  // ADGS/DGS/Grad Admin"): an undergraduate-looking number, or a title that
  // suggests independent study, research or a seminar. Carried to the review
  // request and the processing request; nothing is counted or refused on it.
  // The number is checked on every course from another institution that
  // could count — `yes`, case by case, or not in the rules yet (DGS
  // 2026-10-04, after IIT CS 455: "If you notice such courses that look like
  // undergrad courses from another institution, raise warnings to
  // DGS/ADGS/Grad Admin"); the title on a `yes` only.
  const staffChecks: string[] = [];
  for (const cc of classified) {
    const c = cc.entry;
    if (c.origin !== 'transfer' || isNotreDameInstitution(c.institution) || cc.pool === 'none' || cc.superseded) continue;
    // Credit the Graduate School already accepted is not to be checked
    // "before approving it" (credit-transfer review 2026-10-28, #65); its
    // own checks follow (a thesis or independent-study title).
    if (cc.ndPosting !== undefined) continue;
    const verdict = cc.transferable === 'yes' ? 'yes' : cc.transferable === 'dgs_approval' || cc.transferable === 'adgs_approval' ? 'case' : cc.transferable === undefined ? 'unlisted' : undefined;
    if (verdict === undefined) continue; // the rules say no
    staffChecks.push(...transferCourseChecks(c.courseId, c.institution ?? cc.external?.university ?? 'another university', c.title ?? cc.external?.title, student.program === 'mscse' ? '§3.2' : '§4.2', verdict));
  }
  // Transfer credit on the Notre Dame record whose title reads as research,
  // independent study or a seminar is counted toward the total only (policy
  // review round 4, P4-transfer-8; DGS 2026-10-11: option (a)) — said to the
  // DGS and the Grad Admin, who can see what the course was.
  for (const cc of classified) {
    if (cc.postedNonRegular !== true || cc.superseded) continue;
    const c = cc.entry;
    staffChecks.push(
      `${c.courseId}${c.title ? ` “${c.title}”` : ''}: transfer credit on the Notre Dame record, counted toward the total only because its title reads as research, independent study or a seminar, which are not regular courses (${student.program === 'mscse' ? '§3.2' : '§4.2'}; DGS 2026-09-22). If it was in fact a regular course, the DGS decides how it counts.`,
    );
  }
  // Academic Code §4.1: three credits at the 60000 level or higher in every
  // full-time semester, unless the associate dean permitted otherwise — routed
  // to the DGS, never a failed term (policy review 2026-10-03, P1-residency-enrollment-c5).
  const graduateFlag = graduateLevelFlag(fullTimeTermRecords(ctx), params.number('fulltime_credits_min'));
  if (graduateFlag) {
    reviewFlags.push(graduateFlag);
    warnings.push(`${graduateFlag} This is included in the review request.`);
  }
  // A Ph.D. advisor who is not tenured or tenure-track CSE faculty, or whose
  // status the student is not sure of (CSE §2.3; Academic Code §6.2.7 —
  // policy review 2026-10-04, P2-ac-6.2-app-8): the review request asks. Two
  // cases since 2026-10-07 (P3-cross-doc-2, department policy): the DGS
  // approves a tenured or tenure-track advisor from another department; a
  // non-tenure-track advisor needs a tenured or tenure-track co-advisor.
  const advisorFlag = advisorReviewFlag(ctx);
  if (advisorFlag) reviewFlags.push(decisionWording(student.program, advisorFlag)); // the ADGS's on the MSCSE thesis option
  // MSCSE thesis readers who are not both tenured or tenure-track CSE faculty,
  // or one of them the advisor, or the student is not sure (CSE §3.4; DGS
  // Handbook §10.3.8 — policy review 2026-10-04, P2-dh-10-19): the DGS's prior
  // approval. The request goes to the ADGS, so it says ADGS.
  const readersFlag = thesisReadersReviewFlag(ctx);
  if (readersFlag) reviewFlags.push(decisionWording(student.program, readersFlag));

  if (normalized) {
    // Admissions are in fall and spring only (DGS 2026-10-03); a student who
    // starts in the summer is an early-start student whose official
    // matriculation is the fall, so every clock — the five-year window
    // included — counts from it.
    warnings.push(
      `You started in a summer session — Notre Dame admits in fall and spring, so an early-start summer counts from your official matriculation in ${termLabel(entry)}: every deadline and the §5.2 window are counted from it.`,
    );
  }
  // A leave of absence lasts at most two consecutive semesters; a student who
  // did not return must be readmitted, and the program may reject earlier
  // credits (DGS Handbook §3.3). More than two is not necessarily wrong (two
  // separate leaves), so the record is sent to the DGS rather than refused.
  // CSE §5.7 is cited for the two: "a student in good academic standing may
  // request a leave of absence for a maximum of two consecutive semesters".
  // The Academic Code's §5.1 says the same for most students, but its
  // Appendix A.2 gives the Spring 2020 cohort three, so citing it alone would
  // be wrong for them; the CSE limit holds for everyone (policy review round
  // 3, P3-cse-5-6-4, the citation part). The Spring 2020 cohort keeps the
  // department's two, and its warning names the Graduate School's three
  // (P3-ac-5a-4; DGS 2026-10-07: option (a), "Keep two for everyone, and add
  // a note for the cohort") — CSE §5.7 may be stricter than the Code, and a
  // cohort student whose third semester was allowed is not alarmed.
  // Both counts (round 5, item 7; DGS 2026-10-14): the approved leave for
  // another reason (P4-ac-3) covers a transcript gap too, so three semesters of
  // it were silently accepted where three of medical leave warn.
  const leaveTotal = (student.leaveSemesters ?? 0) + (student.otherLeaveSemesters ?? 0);
  if (leaveTotal > 2) {
    warnings.push(
      `${leaveTotal} semesters ${(student.otherLeaveSemesters ?? 0) > 0 ? 'of leave' : 'on medical leave'}: a leave of absence lasts at most two consecutive semesters (§5.7) — a student who did not return at its end needed readmission, and the program may reject some or all earlier credits (DGS Handbook §3.3).${ctx.covidCohort ? ' For students enrolled in Spring 2020, the Graduate School allowed three consecutive semesters (Academic Code Appendix A.2).' : ''} Confirm your standing with the DGS.`,
    );
  }
  // The transcript's unregistered semesters against the leave count (policy
  // review round 3, P3-ac-5a-5; DGS 2026-10-07: option (a), "In the audit"):
  // more of them than the leave covers, with no readmission term, means the
  // student was readmitted, or the record is incomplete — the DGS confirms the
  // standing and the earlier credits; the credits are not decided here.
  const uncovered = uncoveredRegistrationGaps(student, today);
  if (uncovered !== undefined) {
    const n = (student.leaveSemesters ?? 0) + (student.otherLeaveSemesters ?? 0);
    const leaveKind = (student.otherLeaveSemesters ?? 0) > 0 ? 'leave' : 'medical leave';
    const listed = uncovered.length <= 1 ? uncovered.map(termLabel).join('') : `${uncovered.slice(0, -1).map(termLabel).join(', ')} and ${termLabel(uncovered[uncovered.length - 1]!)}`;
    warnings.push(
      `Your Notre Dame transcript shows no registration in ${listed} — ${uncovered.length} semesters, more than the ${n} ${n === 1 ? 'semester' : 'semesters'} of ${leaveKind} you entered. A leave of absence lasts at most two consecutive semesters (§5.7), and a student who does not return at its end must be readmitted; the program may then reject some or all earlier credits (DGS Handbook §3.3).${ctx.covidCohort ? ' For students enrolled in Spring 2020, the Graduate School allowed three consecutive semesters (Academic Code Appendix A.2).' : ''} Enter the semester you were readmitted under Your standing, or ask the DGS.`,
    );
    reviewFlags.push(
      decisionWording(
        student.program,
        `Semesters without registration: my Notre Dame transcript shows none in ${listed}, more than the ${n} ${n === 1 ? 'semester' : 'semesters'} of ${leaveKind} I entered, and no readmission is on file. Please confirm my standing and which of my earlier credits stand (DGS Handbook §3.1, §3.3).`,
      ),
    );
  }
  // The Notre Dame MSCSE five years or more before the Ph.D. (DGS 2026-10-06,
  // with policy review round 3, P3-cse-5-6-3): its courses wait course by
  // course; the record-level question goes to the DGS too.
  const separatedSince = mscseSeparation(student);
  if (separatedSince !== undefined) {
    warnings.push(
      // "they are in the review request" only while a course still waits;
      // once every one is ruled on, it says so (round 5 verification, as item 5).
      `Your Notre Dame MSCSE ended in ${termLabel(separatedSince)}, five years or more before you entered the Ph.D. in ${termLabel(entry)}: a separation that long from the graduate program may forfeit its credit and coursework (Academic Code §5.5), so every MSCSE course counts only once the DGS reviews it and the Graduate School approves${classified.some((c) => !c.superseded && c.mscseSeparated === true && c.dgsHoldTicked !== true) ? ' — they are in the review request' : classified.some((c) => c.dgsHoldTicked === true) ? ' — they ruled on its courses, as you ticked on each' : ''}.`,
    );
    reviewFlags.push(
      decisionWording(
        student.program,
        `My Notre Dame MSCSE ended in ${termLabel(separatedSince)}, five years or more before I entered the Ph.D. in ${termLabel(entry)}: please review its credit and coursework and request the Graduate School’s approval for it to count toward the Ph.D. (Academic Code §5.5).`,
      ),
    );
  }
  if (student.readmittedTerm !== undefined) {
    // Which text: the interruption's own length (five years or more, ctx.
    // forfeitBefore), not whether a course is still held — once the DGS's
    // ticks released every course, the five-year case fell into the short
    // text (policy review round 5; DGS 2026-10-14). And the closing clause
    // says only what still waits: the courses, the examinations, or that the
    // DGS has ruled, as ticked.
    const long = ctx.forfeitBefore !== undefined;
    const m = student.milestones;
    const coursesHeld = classified.some((c) => !c.superseded && (long ? c.interrupted === true : c.beforeReadmission === true));
    const examsHeld =
      long &&
      ((student.program === 'phd' && student.attestations.qualifierPassedUnderPriorRules === true && priorRulesQualifierHeld(ctx)) ||
        [m.researchQualifierPassed, m.candidacyPassed, m.thesisDefensePassed, m.projectReportAccepted].some((d) => beforeForfeiture(ctx, d)));
    const ruled = classified.some((c) => !c.superseded && c.dgsHoldTicked === true) || (long && student.attestations.examsBeforeInterruptionStand === true);
    const longClause =
      coursesHeld && examsHeld
        ? ', so those courses and examinations wait for the DGS and are in the review request'
        : coursesHeld
          ? ', so those courses wait for the DGS and are in the review request'
          : examsHeld
            ? ', so those examinations wait for the DGS and are in the review request'
            : ruled
              ? ' unless the DGS and the Graduate School rule otherwise — they ruled on what you entered from before it, as you ticked'
              : '';
    const shortClause = coursesHeld
      ? ', so the courses from before your readmission wait for the DGS and are in the review request'
      : ruled
        ? '; the DGS ruled on the courses from before your readmission, as you ticked on each'
        : '';
    warnings.push(
      long
        ? `Readmitted ${termLabel(student.readmittedTerm)} after an interruption of five years or more: the Academic Code forfeits credit for every course and examination from before it (Academic Code §5.5)${longClause}; the clocks still count from ${termLabel(entry)}, your original matriculation, in calendar semesters with the time away included.`
        : // The MSCSE's own limit and section (policy review round 3,
          // P3-dh-3.1-3.13-4): §6.2.6 is the Ph.D.'s; no master's section says
          // when the five years start, so the app's reading is said plainly.
          student.program === 'mscse'
          ? `Readmitted ${termLabel(student.readmittedTerm)}: the five-year limit still counts from ${termLabel(entry)}, your original entry term, in calendar semesters with the time away included (§3.3; Academic Code §6.1.4); the program may reject some or all of your earlier credits (DGS Handbook §3.3)${shortClause}.`
          : `Readmitted ${termLabel(student.readmittedTerm)}: the clocks still count from ${termLabel(entry)}, your original matriculation, in calendar semesters with the time away included (Academic Code §6.2.6; DGS 2026-10-06); the program may reject some or all of your earlier credits (DGS Handbook §3.3)${shortClause}.`,
    );
    // The readmission itself goes to the DGS (policy review 2026-10-04,
    // P2-dh-3.1-3.13-3/-9): DGS Handbook §3.1 — "A student who fails to
    // complete the ND Roll Call process and registration for fall and/or spring
    // semester must complete the readmission process upon their return" — and
    // §3.8's withdrawal. The app cannot see the readmission; it asks.
    reviewFlags.push(
      decisionWording(
        student.program,
        `Readmission: I was readmitted in ${termLabel(student.readmittedTerm)} after a withdrawal or a fall or spring semester I was not registered for (DGS Handbook §3.1, §3.3, §3.8; Academic Code §3.5). Please confirm my readmission and which of my earlier credits stand; ${student.program === 'mscse' ? `my five years still count from ${termLabel(entry)} (§3.3; Academic Code §6.1.4)` : `my clocks still count from ${termLabel(entry)} (Academic Code §6.2.6)`}.`,
      ),
    );
    // The candidacy deadline keeps the gap (policy review round 3,
    // P3-ac-6.2-app-1; DGS 2026-10-06: "The clock counts by calendar semesters
    // regardless of the gap. However, exceptions can be approved by the
    // graduate school when requested by the DGS."). While the Oral Candidacy
    // Exam or admission to candidacy is still to come, the DGS is asked whether
    // to request the Graduate School's exception; the rows name the deadline.
    const gap = readmissionGapCounted(ctx);
    if (gap !== undefined) {
      const m = student.milestones;
      const oceSem = ctx.params.number('candidacy_deadline_semester');
      const open = [
        ...(!m.candidacyPassed && oceSem !== undefined ? [{ what: 'the Oral Candidacy Exam', term: eighthSemester(ctx, oceSem).term }] : []),
        ...(!m.candidacyAdmitted ? [{ what: 'admission to candidacy', term: eighthSemester(ctx, ADMISSION_DEADLINE_SEMESTER).term }] : []),
      ];
      const same = open.length === 2 && compareTerm(open[0]!.term, open[1]!.term) === 0;
      const deadlines = same
        ? `my deadline for the Oral Candidacy Exam and admission to candidacy, the end of ${termLabel(open[0]!.term)}, counts`
        : `my ${open.length === 1 ? 'deadline' : 'deadlines'}, ${open.map((o) => `the end of ${termLabel(o.term)} for ${o.what}`).join(' and ')}, ${open.length === 1 ? 'counts' : 'count'}`;
      if (open.length > 0) {
        reviewFlags.push(
          decisionWording(
            student.program,
            `Candidacy deadline after my readmission: ${deadlines} the semesters I was away before my readmission in ${termLabel(gap)} (Academic Code §6.2.8; DGS Handbook §3.22.3; DGS 2026-10-06). Please decide whether to ask the Graduate School for an exception.`,
          ),
        );
      }
    }
    // The examinations from before an interruption of five years or more
    // (Academic Code §5.5: "Credit for any course or examination will be
    // forfeited …"; P3-ac-5a-3, DGS 2026-10-05) — each row waits for the DGS,
    // and the request names them.
    if (ctx.forfeitBefore !== undefined) {
      const m = student.milestones;
      // Every examination from before the interruption, whatever the DGS
      // ruled — the page offers the Approvals tick from this list (policy
      // review round 5; DGS 2026-10-14: it was offered for any date, the
      // advisor's included) — and those still held: none once the tick is on.
      examsBeforeInterruption = [
        ...(student.program === 'phd' && student.attestations.qualifierPassedUnderPriorRules === true ? ['the qualifying examination I passed under the earlier requirements'] : []),
        ...(datedBeforeForfeiture(ctx, m.researchQualifierPassed) ? [`the research qualifier (passed ${m.researchQualifierPassed})`] : []),
        ...(datedBeforeForfeiture(ctx, m.candidacyPassed) ? [`the Oral Candidacy Exam (passed ${m.candidacyPassed})`] : []),
        ...(datedBeforeForfeiture(ctx, m.thesisDefensePassed) ? [`the thesis defense (passed ${m.thesisDefensePassed})`] : []),
        ...(datedBeforeForfeiture(ctx, m.projectReportAccepted) ? [`the project report (accepted ${m.projectReportAccepted})`] : []),
      ];
      const exams = student.attestations.examsBeforeInterruptionStand === true ? [] : examsBeforeInterruption;
      if (exams.length > 0) {
        const list = exams.length === 1 ? exams[0]! : `${exams.slice(0, -1).join(', ')} and ${exams[exams.length - 1]!}`;
        reviewFlags.push(decisionWording(student.program, `My examinations from before my readmission after an interruption of five years or more: please rule on ${list} (Academic Code §5.5).`));
      }
    }
  }
  // A 4+1's graduate credits beyond the shared pair must be moved from UG to
  // GR registration and transferred BEFORE the bachelor's degree is conferred
  // (Graduate School 4+1 guidance): a current senior is told while there is
  // still time (policy review 2026-10-03).
  if (student.bachelorsAwarded !== undefined && compareTerm(student.bachelorsAwarded, termOfDate(today)) >= 0 && classified.some((c) => c.ugToGrUnverified)) {
    warnings.push(
      `Before your bachelor’s degree is conferred (${termLabel(student.bachelorsAwarded)}): the graduate courses you are counting beyond the shared pair must be moved from undergraduate (UG) to graduate (GR) registration with the Graduate School’s transfer-of-credit form, approved by your advising dean and the Graduate School — after conferral they cannot be (Graduate School 4+1 guidance). Ask the Grad Admin for the form.`,
    );
  }
  // The admission term against the transcript (policy review round 3,
  // P3-fourplusone-2; DGS 2026-10-07: option (2)): a course Notre Dame
  // registers GR was moved before the bachelor's was awarded, so an answered
  // admission AFTER the bachelor's is likely a slip — the student is asked to
  // recheck it while the course counts provisionally (allocate.ts).
  const conflicted = [...new Set(classified.filter((c) => c.admissionTermConflict && !c.superseded).map((c) => c.entry.courseId))];
  if (conflicted.length > 0 && student.integratedAdmitted !== undefined && student.bachelorsAwarded !== undefined) {
    const list = conflicted.length === 1 ? conflicted[0]! : `${conflicted.slice(0, -1).join(', ')} and ${conflicted[conflicted.length - 1]!}`;
    const one = conflicted.length === 1;
    warnings.push(
      `${list} ${one ? 'is' : 'are'} registered at the graduate level on your Notre Dame transcript — moved from undergraduate (UG) to graduate (GR) registration, which the Graduate School approves only before the bachelor’s degree is awarded — but the Integrated-program admission you gave, ${termLabel(student.integratedAdmitted)}, is after your bachelor’s degree (${termLabel(student.bachelorsAwarded)}). Check that term under Your standing. Until the two agree, ${one ? 'the course counts' : 'the courses count'} only provisionally, and the DGS confirms ${one ? 'it' : 'them'}.`,
    );
  }
  // No course counts toward three degrees (DGS 2026-10-07, policy review
  // round 3, P3-fourplusone-1; the Graduate School's 2026-09-22 answer: "If 6
  // credits have double-counted to BS & MS, no more credits can double-count
  // to BS & PhD later"): a 4+1's graduate course from before the bachelor's
  // that counts toward both the bachelor's and the MSCSE cannot count toward
  // a Ph.D. later — said whenever such a course is on the record.
  if (student.program === 'mscse' && student.integratedBsMs === true) {
    const awarded = student.bachelorsAwarded;
    const ids = [
      ...new Set(
        classified
          .filter(
            (c) =>
              !c.superseded &&
              c.entry.origin === 'transfer' &&
              isNotreDameInstitution(c.entry.institution) &&
              levelOf(c.entry, c.rule) >= 6 &&
              (c.entry.degreeLevel === 'bachelors' || (awarded !== undefined && compareTerm(c.entry.term, awarded) <= 0)),
          )
          .map((c) => c.entry.courseId),
      ),
    ];
    if (ids.length > 0) {
      const list = ids.length === 1 ? ids[0]! : `${ids.slice(0, -1).join(', ')} and ${ids[ids.length - 1]!}`;
      warnings.push(
        ids.length === 1
          ? `${list} is a graduate course you took before your bachelor’s degree was awarded. No course counts toward three degrees: if it counts toward both your bachelor’s degree and the MSCSE, it cannot also count toward a Ph.D. should you later continue to the Ph.D. at Notre Dame (the Graduate School).`
          : `${list} are graduate courses you took before your bachelor’s degree was awarded. No course counts toward three degrees: one that counts toward both your bachelor’s degree and the MSCSE cannot also count toward a Ph.D. should you later continue to the Ph.D. at Notre Dame (the Graduate School).`,
      );
    }
  }
  // CSE §5.1: "The department and the Graduate School will review a student
  // who receives more than one grade of I in a semester or a grade of I in two
  // or more consecutive semesters, to determine their eligibility for
  // continued support and enrollment."
  // Fall and spring only (policy review round 3, P3-cse-5-6-2; DGS 2026-10-07:
  // option A): a summer session is not one of §5.1's "semesters" — CSE §4.3
  // "not including the summer session"; Academic Code §4.3 "semester or
  // summer session" — as the GPA and U-in-research warnings below read it.
  // semesterSeq files a summer under the spring before it, so a Spring and a
  // Summer I used to read as "more than one … in one semester".
  const incompleteTerms = classified.filter((c) => c.entry.grade === 'I' && c.entry.origin === 'nd' && !c.superseded && c.entry.term.season !== 'summer').map((c) => c.entry.term);
  const perTerm = new Map<number, number>();
  for (const t of incompleteTerms) perTerm.set(semesterSeq(t), (perTerm.get(semesterSeq(t)) ?? 0) + 1);
  const twoInOne = [...perTerm.values()].some((n) => n > 1);
  const consecutive = [...perTerm.keys()].some((seq) => perTerm.has(seq + 1));
  if (twoInOne || consecutive) {
    warnings.push(
      `${twoInOne ? 'More than one Incomplete in one semester' : 'Incompletes in two consecutive semesters'}: the department and the Graduate School review such a record for continued support and enrollment (§5.1) — talk to the DGS.`,
    );
  }
  // The Graduate School's probation and dismissal grounds (Academic Code
  // §5.7.3, §5.8 — policy review 2026-10-04, P2-ac-5b-6.1-4, -6, -7; DGS:
  // "apply the suggested handling"). Said at the top, no row recomputed. The
  // GPA figures are the transcript's own, kept per term by the Notre Dame
  // import (student.termGpas) — never computed from entered grades (decision
  // 2026-08-31); a hand-entered record gets no GPA line. Fall and spring only
  // (DGS 2026-10-07, P3-cse-5-6-2: option A — a summer is not a "semester").
  // A figure of 0.00 for a semester with no Notre Dame course graded into the
  // GPA (only S or W — research, a withdrawal) is the transcript's empty GPA
  // cell, not a GPA (policy review round 3, P3-ac-5b-6.1-1; DGS 2026-10-05:
  // the import now reads the GPA hours and keeps no such figure, and records
  // saved before that are read the same way here). Academic Code §4.3: "An S
  // grade … does not factor into the computation of the G.P.A."
  const gradedIn = (t: TermGpa['term']) => student.courses.some((c) => c.origin === 'nd' && compareTerm(c.term, t) === 0 && GRADE_POINTS[c.grade] !== undefined);
  // This program's semesters only (policy review round 3, P3-dh-3.14-3.20-2;
  // DGS 2026-10-06: "Apply the handling"): "A graduate student can only have
  // one designation, per program, at any given time" (Academic Code §5.7),
  // and dismissal is "from his or her program of study" (§5.8) — the same
  // scope as the U-in-research line below. The entry term already carries a
  // program transfer (an MSCSE start kept, 2026-09-26; another department's
  // matriculation kept, 2026-10-03 item 16). A semester before it gets no
  // line: a finished earlier degree implies good standing (§5.7.1).
  const gpaTerms = (student.termGpas ?? [])
    .filter((t) => t.term.season !== 'summer' && compareTerm(t.term, entry) >= 0)
    .map((t) => (gradedIn(t.term) ? t : { term: t.term, ...(t.termGpa ? { termGpa: t.termGpa } : {}), ...(t.cumulativeGpa ? { cumulativeGpa: t.cumulativeGpa } : {}) }))
    .sort((a, b) => compareTerm(a.term, b.term));
  const listGpas = (ts: typeof gpaTerms, pick: (t: (typeof gpaTerms)[number]) => number | undefined) => ts.map((t) => `${termLabel(t.term)}: ${gpaText(pick(t)!)}`).join(', ');
  const cumulativeBelow = gpaTerms.filter((t) => t.cumulativeGpa !== undefined && t.cumulativeGpa < PROBATION_CUMULATIVE_GPA);
  if (cumulativeBelow.length >= 2) {
    warnings.push(
      `Your transcript shows a cumulative GPA below ${PROBATION_CUMULATIVE_GPA.toFixed(1)} in ${cumulativeBelow.length} semesters (${listGpas(cumulativeBelow, (t) => t.cumulativeGpa)}) — a Graduate School probation trigger (Academic Code §5.7.3); confirm your standing with the DGS.`,
    );
  }
  const termBelowDismissal = gpaTerms.filter((t) => t.termGpa !== undefined && t.termGpa < DISMISSAL_TERM_GPA);
  if (termBelowDismissal.length > 0) {
    warnings.push(
      `Your transcript shows a semester GPA below ${DISMISSAL_TERM_GPA.toFixed(1)} (${listGpas(termBelowDismissal, (t) => t.termGpa)}) — the Academic Code lists this as a ground for dismissal (Academic Code §5.8, extreme under-performance); talk to the DGS.`,
    );
  }
  const termBelowThree = gpaTerms.filter((t) => t.termGpa !== undefined && t.termGpa < DISMISSAL_TWO_TERMS_GPA);
  const lowRun = longestRun(termBelowThree.map((t) => semesterSeq(t.term)));
  if (lowRun.length >= 2) {
    const inRun = termBelowThree.filter((t) => lowRun.includes(semesterSeq(t.term)));
    warnings.push(
      `Your transcript shows a semester GPA below ${DISMISSAL_TWO_TERMS_GPA.toFixed(1)} in ${lowRun.length} consecutive semesters (${listGpas(inRun, (t) => t.termGpa)}) — the Academic Code lists this as a ground for dismissal (Academic Code §5.8, extreme under-performance); talk to the DGS.`,
    );
  }
  // U in research (§5.7.3 item 3, §5.8): a Notre Dame course the course rules
  // type research or project, graded U, in consecutive fall/spring semesters.
  const researchU = classified.filter(
    (c) => c.entry.origin === 'nd' && c.entry.grade === 'U' && c.entry.term.season !== 'summer' && (c.rule?.courseType === 'research' || c.rule?.courseType === 'project'),
  );
  const uRun = longestRun(researchU.map((c) => semesterSeq(c.entry.term)));
  if (uRun.length >= PROBATION_RESEARCH_U) {
    const terms = [...new Map(researchU.filter((c) => uRun.includes(semesterSeq(c.entry.term))).map((c) => [semesterSeq(c.entry.term), c.entry.term])).values()]
      .sort(compareTerm)
      .map(termLabel)
      .join(', ');
    warnings.push(
      uRun.length >= DISMISSAL_RESEARCH_U
        ? `A U in research in ${uRun.length} consecutive semesters (${terms}) — the Academic Code lists three consecutive U grades in research as a ground for dismissal (Academic Code §5.8, extreme under-performance); talk to the DGS.`
        : `A U in research in two consecutive semesters (${terms}) — a Graduate School probation trigger (Academic Code §5.7.3); a third in a row is a ground for dismissal (Academic Code §5.8). Talk to the DGS.`,
    );
  }

  // A Notre Dame course entered as THIS program's coursework but dated before
  // the entry term (policy review 2026-10-04, P2-dh-front-1-2-6, case b; DGS:
  // "apply the suggested fix"): the page files a hand-added one as earlier
  // coursework (app.ts), but a loaded file can carry one, and it would count
  // with no word — transfer credit (§5.2) and non-degree credit (Academic Code
  // §2.3) each have their own limit. Said, not refused. The saved entry term
  // is the yardstick, and the early-start summer just before a fall entry is
  // the program's own — a fall entry is right for that student, so nothing
  // here tells them to check it (P3-chg-other-1; DGS 2026-10-05, option (a)).
  {
    const before = student.courses.filter((c) => c.origin === 'nd' && beforeProgramStart(c, student));
    if (before.length > 0) {
      const list = before.map((c) => `${c.courseId} (${termLabel(c.term)})`).join(', ');
      const one = before.length === 1;
      warnings.push(
        `${list} ${one ? 'is' : 'are'} entered as coursework of this program but dated before your entry term (${termLabel(student.entryTerm)}). Coursework from before you entered counts only as transfer credit (§5.2) or as non-degree credit (Academic Code §2.3), each with its own limit — check the entry term, or remove ${one ? 'the course' : 'these courses'} and add ${one ? 'it' : 'them'} again so the page files ${one ? 'it' : 'them'} as earlier coursework.`,
      );
    }
  }

  // The bachelor's award term (2026-09-06) must precede the entry term — a
  // later or equal one would file the whole record as pre-graduate.
  if (student.bachelorsAwarded !== undefined && compareTerm(student.bachelorsAwarded, entry) >= 0) {
    warnings.push(
      `Your bachelor’s degree is set as awarded in ${termLabel(student.bachelorsAwarded)}, which is not before your entry term (${termLabel(entry)}) — check both under Your standing; courses from another university dated up to the award term are not counted as graduate coursework (§5.2).`,
    );
  }

  // Required, not optional (DGS 2026-09-07) — but only worth saying once the
  // student has entered coursework for it to apply to.
  if (student.bachelorsAwarded === undefined && student.courses.length > 0) {
    warnings.push(
      '“Bachelor’s degree awarded” is not set under Your standing. It is required: §5.2 counts a course as transfer credit only when it was taken after your bachelor’s degree was awarded, whether or not you also hold a graduate degree.',
    );
  }

  // The prior-rules qualifier attestation is for third-year-and-later students
  // only (DGS 2026-09-21); a ticked box on an earlier record is ignored, and said.
  if (student.program === 'phd' && student.attestations.qualifierPassedUnderPriorRules === true && !qualifierPriorRulesEligible(entry, today)) {
    warnings.push(
      `“I passed the qualifying examination under the earlier requirements” is ticked, but with an entry term of ${termLabel(entry)} you are not yet in your third year — the box applies only from the fifth semester, so the current qualifier requirements are shown.`,
    );
  }

  const rows: RequirementResult[] = [gpaRow(ctx), advisorRow(ctx)];
  // On probation (Academic Code §5.7.1 — policy review 2026-10-04, P2-ac-5b-6.1-2).
  const standing = goodStandingRow(ctx);
  if (standing) rows.push(standing);
  rows.push(...(student.program === 'mscse' ? mscseRows(ctx) : phdRows(ctx)));

  // The time-limit row is "met" only when everything else already is — and it
  // must be able to tell "not finished" from "cannot be judged yet" (red-team
  // 2026-09-13): a blank rules-sheet cell elsewhere used to make a student who
  // had finished everything read "Overdue — the 8-year limit passed".
  // The qualifier's five parts and the allowances are shown but not counted
  // (DGS 2026-09-27): the headline used to count the qualifier six times and
  // grow by one when an allowance was first drawn on.
  const isScored = (r: RequirementResult) => !r.informational && !r.unscored && !r.allowance && r.status !== 'not_applicable';
  // The OCE and the ethics training are shown inside the admission card since
  // 2026-10-04 and leave the headline, but they are still requirements: the
  // eight-year row reads them too, so it cannot say "complete" while either
  // date is blank (policy review round 3, P3-ac-6.2-app-4; the invariant of
  // P2-dh-6-9-1, 2026-10-04).
  const otherRows = rows.filter((r) => isScored(r) || (r.mergedInto !== undefined && r.status !== 'not_applicable'));
  // A requirement completed AFTER the limit reads "Eligibility at risk" rather
  // than met (policy review 2026-10-03) — for the time-limit row it is still
  // complete, so that row can say the same thing instead of "Overdue".
  // So is a milestone done late against its OWN deadline only (a late OCE or
  // admission to candidacy, 2026-10-04): the §4.3 question is whether
  // everything was done within the limit.
  const completeOrLate = (r: RequirementResult) => r.status === 'met' || (r.status === 'needs_dgs_review' && (r.statusLabel === 'Eligibility at risk' || r.completedLate === true));
  const others = {
    allMet: otherRows.every(completeOrLate),
    anyCannotEvaluate: otherRows.some((r) => r.status === 'cannot_evaluate'),
    // The master's candidacy application is uncounted (2026-10-04), so the
    // MSCSE card must not say "all requirements are complete" while it is
    // open (policy review round 3, P3-dh-3.21-3.24-1). The MSCSE's own card
    // only: on a Ph.D. record the open application is the optional MSCSE
    // along the way's, not a requirement of the Ph.D. the card is about.
    mastersApplicationOpen: student.program === 'mscse' && rows.some((r) => r.id === 'shared.msCandidacy' && r.status === 'unmet'),
  };
  rows.push(student.program === 'mscse' ? msTimeLimitRow(ctx, others) : phdTimeLimitRow(ctx, others));
  // A summer-session-only record past the five years and inside the seven
  // (Academic Code §6.1.4 — policy review 2026-10-04, P2-dh-3.21-3.24-3): the
  // review request asks the DGS whether the seven years apply.
  const summerFlag = summerOnlyReviewFlag(ctx, others);
  if (summerFlag) reviewFlags.push(decisionWording(student.program, summerFlag));
  // A Graduate School extension longer than it grants (DGS Handbook §3.19 —
  // policy review 2026-10-04, P2-ac-6.2-app-7): the DGS confirms it.
  const extensionFlag = extensionReviewFlag(ctx);
  if (extensionFlag) reviewFlags.push(extensionFlag);
  // A leave beside an unfinished Ph.D. residency run (policy review
  // 2026-10-04, P2-ac-5a-3; DGS: "Apply the suggested handling"): the run
  // restarts after a leave — the reading recorded 2026-08-31 — but the
  // Graduate School says a leave "stops the student's eligibility clock" (DGS
  // Handbook §3.7.2), so the DGS is asked. The row says so too (phd.ts).
  const residency = rows.find((r) => r.id === 'phd.residency');
  if (residency?.status === 'in_progress' && (student.leaveSemesters ?? 0) > 0) {
    reviewFlags.push(
      `Residency and my medical leave: I was on approved medical leave for ${student.leaveSemesters} ${student.leaveSemesters === 1 ? 'semester' : 'semesters'}, and my longest run of consecutive full-time semesters is short of four (§4.3). Please confirm whether the run continues across the leave — DGS Handbook §3.7.2: a leave “stops the student’s eligibility clock” — or restarts after it.`,
    );
  }
  rows.push(approvalsRow(ctx));
  // The deadline beside each date in the Milestones card (DGS 2026-10-04).
  const milestoneDeadlines = student.program === 'phd' ? phdMilestoneDeadlines(ctx, rows) : msMilestoneDeadlines(ctx);

  const scored = rows.filter(isScored);
  // Conditional satisfaction gets its own number (interface review R2,
  // 2026-09-18): the dashboard could not tell "satisfied, pending a signature"
  // from "not satisfied", so it buried the first inside the second and
  // mentioned it in a parenthetical.
  const summary = {
    met: scored.filter((r) => r.status === 'met').length,
    conditional: scored.filter((r) => r.status === 'needs_dgs_review').length,
    scored: scored.length,
  };

  // Which requirements each course feeds (DGS request 2026-09-08). The rows
  // already say which courses satisfy them (`satisfiedBy`, written for the
  // processing request) and, since today, which will (`pendingBy`); this is
  // simply that index read the other way round, in report order. Ids that are
  // not courses — the residency row lists SEMESTERS — are skipped by checking
  // against the record.
  const entered = new Set(student.courses.map((c) => c.courseId));
  const feeds = new Map<string, { id: string; title: string; long: string; when: 'now' | 'later' }[]>();
  const note = (courseId: string, row: RequirementResult, when: 'now' | 'later'): void => {
    if (!entered.has(courseId)) return;
    const list = feeds.get(courseId) ?? [];
    // The short name where there is one: a course's cell lists several of
    // these side by side (2026-09-08). The full title stays for the tooltip.
    if (!list.some((x) => x.id === row.id)) list.push({ id: row.id, title: row.shortTitle ?? row.title, long: row.title, when });
    feeds.set(courseId, list);
  };
  for (const r of rows) {
    if (r.informational || r.status === 'not_applicable') continue;
    for (const id of r.satisfiedBy ?? []) note(id, r, 'now');
    for (const id of r.pendingBy ?? []) note(id, r, 'later');
  }

  // The rows name course IDS, so two entries of one number — a refused earlier
  // attempt beside a pending one (the Notre Dame transcript's own transfer
  // block plus the source transcript, 2026-09-26) — would both carry the
  // pending entry's "Will count toward" list. The lists go to the entries that
  // can still count; only when every entry of a number is refused do they all
  // keep them (a core-area row may still name such a course).
  const canCount = (p: (typeof alloc.perCourse)[number]): boolean => p.mark !== 'excluded';
  // A Notre Dame course taken in the program never gets the classifier's
  // core-knowledge clause, so its qualifier roles showed only in the folded
  // link row (DGS 2026-09-28: "it does not say it counts toward core
  // knowledge … Is this an error?"). Its second line is read off the rows it
  // feeds instead — a core area, a specialization group — with a mark of its
  // own: green now, blue while the course is in progress, amber while it
  // waits on an approval.
  // §4.4.2's grade floor, said on the course's own line (DGS 2026-10-02: a
  // C in a specialization-group course showed only its core-knowledge role,
  // so nothing told the student the course does NOT serve the specialization
  // requirement; the categories row said so, five cards away).
  const categoryFloor = params.gradeLetter('category_min_grade');
  const groupCodes = new Set(rules.categoryGroups.map((g) => g.code));
  const qualifierFromFeeds = (p: (typeof alloc.perCourse)[number], counts: { id: string; long: string; when: 'now' | 'later' }[]): { mark: CourseMark; text: string } | undefined => {
    const roles = counts.filter((x) => x.id.startsWith('phd.qualifier.core.') || x.id === 'phd.qualifier.categories');
    const grade = p.course.entry.grade;
    const inAGroup = (p.course.rule?.categoryGroups ?? []).some((g) => groupCodes.has(g));
    const belowFloor =
      student.program === 'phd' && inAGroup && !roles.some((x) => x.id === 'phd.qualifier.categories') && categoryFloor !== undefined && isPassed(grade) && !isInProgress(grade) && !meetsGradeFloor(grade, categoryFloor as Grade);
    if (roles.length === 0 && !belowFloor) return undefined;
    const parts = [
      ...roles.map((x) => (x.id === 'phd.qualifier.categories' ? 'specialization course (§4.4.2)' : `${x.long.replace(/^Core knowledge:\s*/, '')} core knowledge (§4.4.1)`)),
      ...(belowFloor ? [`specialization course (§4.4.2): not counted — ${grade} is below the ${categoryFloor} floor`] : []),
    ];
    const mark: CourseMark = roles.some((x) => x.when === 'now') ? 'counts' : roles.length === 0 ? 'excluded' : p.mark === 'in_progress' ? 'in_progress' : 'pending';
    return { mark, text: parts.join(' · ') };
  };
  const entryIndex = new Map(student.courses.map((c, i) => [c, i]));
  const courseLines = alloc.perCourse.map((p) => {
    const id = p.course.entry.courseId;
    const aLiveSibling = !canCount(p) && alloc.perCourse.some((q) => q !== p && q.course.entry.courseId === id && canCount(q));
    // A registration still in progress or waiting does not count toward
    // anything NOW, whatever a graded registration of the same course does
    // (credit-transfer review 2026-10-28, #21: the Fall research semester read
    // "Counts toward: 60 total credits" from the Spring one).
    const notYet = p.mark === 'in_progress' || p.mark === 'pending';
    const counts = (aLiveSibling ? [] : (feeds.get(id) ?? [])).map((x) => (notYet && x.when === 'now' ? { ...x, when: 'later' as const } : x));
    const qualifier = p.qualifier ?? qualifierFromFeeds(p, counts);
    return {
      courseId: id,
      term: p.course.entry.term,
      // Which row of the record this is — two registrations of one course in
      // one term share an id and a term (#20, #55).
      ...(entryIndex.has(p.course.entry) ? { entryIndex: entryIndex.get(p.course.entry)! } : {}),
      ...(p.countedRegular + p.countedOther > 0 && p.excluded > 0 && p.excludedReason !== undefined
        ? { part: { counted: p.countedRegular + p.countedOther, whole: p.course.effectiveCredits ?? p.course.entry.credits, rest: p.excludedReason } }
        : {}),
      text: p.explanation,
      mark: p.mark,
      ...(qualifier ? { qualifier } : {}),
      // The tick box belongs on a course the sheet decides case by case
      // (DGS 2026-09-27), and only while the course can still count.
      // A held course's box reads the hold's own ruling (round 5, item 29 (b)).
      ...(decidedCaseByCase(p.course, student.program) && p.course.ineligibleReason === undefined
        ? heldByRecord(p.course)
          ? { approvable: true as const, holdRuling: true as const, ...(p.course.entry.dgsHoldApproved ? { approved: true as const } : {}) }
          : { approvable: true as const, ...(p.course.entry.dgsApproved ? { approved: true as const } : {}) }
        : {}),
      counts,
    };
  });

  // The semester of graduation (policy review 2026-10-04, P2-dh-3.21-3.24-24;
  // DGS: "apply the suggested fix"). DGS Handbook §3.23.1: "Enrollment and
  // registration for at least one credit hour during the semester of
  // graduation (or for a zero-credit course, during the summer session)";
  // Academic Code §3.7. Registered = a Notre Dame course entered for that term,
  // of at least one credit in a fall or spring, of any credits in a summer —
  // not a withdrawn or audited one. A retake is a registration too, whichever
  // attempt counts: only a same-term duplicate is dropped, as the full-time
  // record already does (policy review round 3, P3-chg-other-2; DGS
  // 2026-10-06 — an in-progress retake of a course passed with a C used to
  // read as "no course entered"). The report's next steps and the processing
  // request say it; once the term has begun, an unregistered one is a warning.
  let graduation: AuditReport['graduation'];
  if (student.graduationTerm !== undefined) {
    const t = student.graduationTerm;
    const inTerm = classified.filter(
      (cc) => cc.entry.origin === 'nd' && !sameTermDuplicate(cc, classified) && !cc.withdrawn && !cc.audited && !cc.unrecognizedGrade && compareTerm(cc.entry.term, t) === 0,
    );
    const credits = inTerm.reduce((sum, cc) => sum + cc.entry.credits, 0);
    const registered = t.season === 'summer' ? inTerm.length > 0 : credits >= 1;
    // DGS Handbook §3.23.1: "No 'I' grades in any course during the final
    // semester of a terminal degree"; §3.13: an I may not be given then (policy
    // review round 3, P3-dh-3.1-3.13-3; DGS 2026-10-06: "apply the handling
    // including the optional (3)"). Both programs: no document defines
    // "terminal degree", and the semester asked is the student's own degree's.
    const incompletes = [...new Set(classified.filter((cc) => cc.entry.origin === 'nd' && cc.entry.grade === 'I' && compareTerm(cc.entry.term, t) === 0).map((cc) => cc.entry.courseId))];
    graduation = { term: t, registeredCredits: credits, registered, ...(incompletes.length > 0 ? { incompletes } : {}) };
    if (incompletes.length > 0) {
      warnings.push(
        `An Incomplete cannot stand in the semester you graduate: ${incompletes.join(', ')} ${incompletes.length === 1 ? 'is' : 'are'} graded I in ${termLabel(t)}, and the Graduate School confers the degree only with no I grades in that semester. Have the grade made final before conferral, or move your graduation semester (DGS Handbook §3.23.1, §3.13; Academic Code §4.3).`,
      );
    }
    if (!registered && today >= startOfTerm(t).date) {
      warnings.push(
        `You plan to graduate in ${termLabel(t)}, but no Notre Dame course${t.season === 'summer' ? '' : ' of at least one credit'} is entered for it — register for at least one credit hour (a zero-credit course in a summer session) and complete ND Roll Call in ${termLabel(t)}: the Graduate School confers the degree only then (Academic Code §3.7; DGS Handbook §3.23.1).`,
      );
    }
  }

  // CSE §5.2 considers a transfer request only "before the semester in which
  // the graduate degree is conferred" (policy review round 3, P3-import-4;
  // DGS 2026-10-07: option (b), "Term-aware wording"): once the semester the
  // student plans to graduate in has begun, with a counted transfer course
  // not yet recorded, the page says the window has closed and the processing
  // request asks whether it was sent in time. No count or status changes —
  // the app cannot tell a late request from one still being processed.
  const transferWindow = conferralWindow(student, today);
  const unrecordedTransfer = classified.some(
    (cc) => !cc.superseded && cc.ineligibleReason === undefined && cc.caps.includes('transfer') && cc.ndPosting === undefined && cc.tier !== 'provisional' && !transferRecordedFor(student, cc.entry),
  );
  const transferRequestWindowClosed = transferWindow.closed !== undefined && unrecordedTransfer ? transferWindow.closed : undefined;
  if (transferRequestWindowClosed !== undefined)
    warnings.push(`You plan to graduate in ${termLabel(transferRequestWindowClosed)}; §5.2 considers a transfer request only before that semester — if yours was not sent before then, ask the DGS.`);

  // When the semester of graduation is worth asking (DGS 2026-10-05: "Let's
  // show it only when it matters"): the Ph.D. once the OCE is passed — the
  // dissertation is what is left — and the MSCSE once its total credits are
  // complete or in progress.
  const m = student.milestones;
  const msTotal = params.number('ms_total_credits_min');
  const graduationInSight =
    student.program === 'phd'
      ? !!(m.candidacyPassed || m.candidacyAdmitted || m.defensePassed || m.dissertationSubmitted)
      : msTotal !== undefined && ctx.alloc.total.definite + ctx.alloc.total.in_progress >= msTotal;

  // The degree's decider, said once at the boundary (2026-09-11): for an
  // MSCSE student every "DGS" in what follows is the ADGS. Handbook quotes
  // (`citation`) are left as written.
  const p = student.program;
  const summerFloor = p === 'mscse' ? params.number('summer_fulltime_credits_min') : undefined;
  // What the §5.2 cap admitted, course by course (P3-prior-programs-5).
  const transferCredits = alloc.perCourse
    .filter((a) => a.course.caps.includes('transfer') && !a.course.superseded)
    .map((a) => ({
      courseId: a.course.entry.courseId,
      ...(student.courses.indexOf(a.course.entry) >= 0 ? { entryIndex: student.courses.indexOf(a.course.entry) } : {}),
      ...(a.course.entry.institution !== undefined ? { institution: a.course.entry.institution } : {}),
      term: a.course.entry.term,
      counted: a.countedRegular + a.countedOther,
      // Another cap cut the course (round 5 verification, transfer-1) — alone,
      // or with §5.2's own (credit-transfer review 2026-10-28, #34): its own
      // reason, as the course's line gives it, naming every cap that ran out.
      ...(a.boundCaps !== undefined && a.boundCaps.some((id) => id !== 'transfer') && a.excludedReason !== undefined ? { restOver: a.excludedReason } : {}),
      // …or a limit missing from the sheet — §5.2's own included: the course
      // cannot be checked, which is not "over" anything (DGS 2026-10-27 review).
      ...(a.course.caps.some((id) => alloc.capUsage.get(id)?.limit === undefined) && a.excludedReason !== undefined
        ? { restUnknown: true as const, ...(a.boundCaps?.some((id) => id !== 'transfer') ? {} : { restOver: a.excludedReason }) }
        : {}),
    }));
  const transferCap = alloc.capUsage.get('transfer')?.limit;
  return {
    reviewFlags,
    ...(transferCredits.length > 0 ? { transferCredits } : {}),
    ...(transferCap !== undefined ? { transferCap } : {}),
    // The first semester, no grade yet: the emails say what the GPA card says
    // (DGS 2026-10-14) — the card's own state, so a missing gpa_min (the card
    // cannot evaluate) never reads "no GPA yet" in an email.
    ...(rows.find((r) => r.id === 'shared.gpa')?.status === 'in_progress' ? { noGpaYet: true as const } : {}),
    // The decider named for the degree, as everything else at this boundary
    // (credit-transfer review 2026-10-28, #57: "the DGS decides" to the ADGS).
    ...(staffChecks.length > 0 ? { staffChecks: staffChecks.map((x) => decisionWording(p, x)) } : {}),
    ...(summerFloor !== undefined ? { summerFullTimeCredits: summerFloor } : {}),
    program: p,
    requirements: rows.map((r) => decisionWordingDeep(p, r)),
    courseLines: courseLines.map((l) => ({ ...l, text: decisionWording(p, l.text), ...(l.qualifier ? { qualifier: { ...l.qualifier, text: decisionWording(p, l.qualifier.text) } } : {}) })),
    summary,
    warnings: warnings.map((w) => decisionWording(p, w)),
    // The ended-semester IP groups behind one of those warnings, as data for
    // the Next steps list (blue-team review 2026-10-17, U21).
    ...(staleInProgress.length > 0 ? { staleInProgress } : {}),
    tracks: specialTracks(student, classified).map((t) => ({ ...t, text: decisionWording(p, t.text) })),
    // The MSCSE's summer-session sentence names the decider (2026-10-04).
    milestoneDeadlines: decisionWordingDeep(p, milestoneDeadlines),
    ...(graduation !== undefined ? { graduation } : {}),
    ...(transferRequestWindowClosed !== undefined ? { transferRequestWindowClosed } : {}),
    ...(graduationInSight ? { graduationInSight: true as const } : {}),
    ...(examsBeforeInterruption.length > 0 ? { examsBeforeInterruption: examsBeforeInterruption.map((e) => decisionWording(p, e)) } : {}),
  };
}
