// §3 — Requirements for the Master of Science Degree (MSCSE).
// Every builder quotes the handbook sentence it implements.
import { BS_SHARED_CREDITS_MAX } from '../allocate.ts';
import { openDeadline } from '../status.ts';
import { compareTerm, deadlineTermLabel, endOfNextSemester, endOfTerm, termLabel } from '../term.ts';
import type { DeadlineInfo, DetailPart, RequirementResult, Status } from '../types.ts';
import type { Ctx } from './context.ts';
import { BASIC_GROUP, defendedBelowGpaNote, msCandidacyApplicationRow, otherDegreeCapRow } from './shared.ts';
import { usableGpa } from '../ranges.ts';
import { noteOf, joinedDetail, heldForMissingParams, capRow, beforeForfeiture, FORFEIT_FACT, FORFEIT_NOTE, defenseRegistrationNote, countedCourseIds, courseContributions, creditsReachedAt, defendGpaNote, lastCompletion, pendingCourseIds, missingParamDetail, provisionalRegularIds, thresholdRow, timeLimitDate, timeLimitRow, titleCount, type Completion } from './context.ts';
import { candidacyFormSentence } from './phd.ts';
import { fullTimeTermRecords, graduateLevelParts } from './residency.ts';
import { transferRow } from './transfer.ts';

// The allowances sit under Coursework (DGS 2026-10-27: "Fold these unless
// they become relevant. Then, include it under 'Coursework'") — still meters,
// not verdicts (2026-09-27); the residency sits under Basic requirements and
// the five-year limit last under M.S. project or thesis (DGS 2026-10-27),
// so there is no "Residence and time" group.
const COURSEWORK = 'Coursework — §3.2';
const PROJECT_THESIS = 'M.S. project or thesis — §3.4';

// The whole §3.2 sentence, "earned at Notre Dame" included — the clause the
// engine applies to a transferred project/thesis course (policy review
// 2026-10-03, P1-page-text-engine-5: the quote used to stop at "(CSE 68901).").
const REGULAR_QUOTE =
  'The MSCSE degree requires a minimum of twenty-four (24) credit hours of regular courses and six (6) credits hours of Masters project (CSE 68902) or Masters thesis direction (CSE 68901) earned at Notre Dame.';

export function mscseRows(ctx: Ctx): RequirementResult[] {
  const rows: RequirementResult[] = [];
  const provisionalRegular = provisionalRegularIds(ctx);

  // §3.2: "The graduate school requires a total of thirty (30) credits of
  // courses and research for the M.S. degree." Only passed courses count
  // toward the total (DGS decision 2026-08-31).
  rows.push(
    thresholdRow({
      id: 'ms.credits.total',
      group: COURSEWORK,
      title: `${titleCount(ctx.params.number('ms_total_credits_min'), 30)} total credits of courses and research`,
      shortTitle: `${titleCount(ctx.params.number('ms_total_credits_min'), 30)} total credits`,
      sums: ctx.alloc.total,
      satisfiedBy: countedCourseIds(ctx, (p) => p.countedRegular + p.countedOther),
      pendingBy: pendingCourseIds(ctx, (p) => p.countedRegular + p.countedOther),
      contributions: courseContributions(ctx, (p) => p.countedRegular + p.countedOther),
      required: ctx.params.number('ms_total_credits_min'),
      requiredKey: 'ms_total_credits_min',
      section: '§3.2',
      quote:
        'The graduate school requires a total of thirty (30) credits of courses and research for the M.S. degree.',
      provisionalCourses: provisionalRegular,
    }),
  );

  // §3.2: 24 regular-course credits. "Regular courses are defined as classes
  // with a regular meeting time, assigned readings, graded assignments, and a
  // final exam. Research seminar, research credits, independent study, and
  // other similar courses do not count as regular courses."
  rows.push(
    thresholdRow({
      id: 'ms.credits.regular',
      group: COURSEWORK,
      title: `${titleCount(ctx.params.number('ms_regular_credits_min'), 24)} credit hours of regular courses`,
      shortTitle: `${titleCount(ctx.params.number('ms_regular_credits_min'), 24)} regular-course credits`,
      sums: ctx.alloc.regular,
      satisfiedBy: countedCourseIds(ctx, (p) => p.countedRegular),
      pendingBy: pendingCourseIds(ctx, (p) => p.countedRegular),
      contributions: courseContributions(ctx, (p) => p.countedRegular),
      required: ctx.params.number('ms_regular_credits_min'),
      requiredKey: 'ms_regular_credits_min',
      section: '§3.2',
      quote: REGULAR_QUOTE,
      provisionalCourses: provisionalRegular,
    }),
  );

  // §3.2: 6 credits of CSE 68902 (project) or CSE 68901 (thesis direction).
  // §3.4(i) says 68901 for the project — a handbook typo; either id is
  // accepted so a mis-registration never costs a student credit (decision Q3).
  rows.push(
    thresholdRow({
      id: 'ms.credits.project',
      group: COURSEWORK,
      title: `${titleCount(ctx.params.number('ms_project_credits_min'), 6)} credit hours of M.S. project or thesis direction`,
      shortTitle: `Project/thesis (${titleCount(ctx.params.number('ms_project_credits_min'), 6)} cr)`,
      sums: ctx.alloc.project,
      satisfiedBy: countedCourseIds(ctx, (p) => (p.course.pool === 'project' ? p.countedOther : 0)),
      pendingBy: pendingCourseIds(ctx, (p) => (p.course.pool === 'project' ? p.countedOther : 0)),
      contributions: courseContributions(ctx, (p) => (p.course.pool === 'project' ? p.countedOther : 0)),
      required: ctx.params.number('ms_project_credits_min'),
      requiredKey: 'ms_project_credits_min',
      section: '§3.2',
      quote: REGULAR_QUOTE,
      extraDetail: ['Register for CSE 68902 (project) or CSE 68901 (thesis direction)'],
      extraDetailWhenShort: true,
    }),
  );

  // §5.2's cap on credit brought in from an earlier program — nine credits
  // with a completed master's, six with one that was not finished. The cap was
  // always enforced; this row is what says so (DGS 2026-09-11), and it is the
  // Ph.D.'s own row with the master's parameter key.
  rows.push(
    transferRow(ctx, {
      id: 'ms.transfer',
      group: COURSEWORK,
      capKeyCompleted: 'ms_transfer_completed_ms_credits_max',
      section: '§3.2, §5.2',
    }),
  );

  // §3.2 (September 2026 edition): "Up to six (6) credits at the 40000 level
  // may count toward both the graduate school's 30-credit requirement and the
  // department's 24-credit regular course requirement, subject to approval by
  // the advisor and the ADGS." Per the DGS (2026-08-31): CSE 4xxxx only,
  // counted inside the 24; non-CSE 40000-level courses do not count at all.
  // The same six credits also carry any CSE 50000-level course the rules
  // sheet permits (DGS 2026-09-09) — the sheet's permission does not lift
  // §3.2's limit. The approval clause is new (2026-10-02): the row reads
  // Conditionally met while a course it admits still waits for it.
  rows.push(
    capRow({
      id: 'ms.cap.fourk',
      group: COURSEWORK,
      title: `At most ${titleCount(ctx.params.number('ms_4xxxx_credits_max'), 6)} credits from CSE courses below the 60000 level`,
      capId: 'fourk',
      capLabel: 'credits below the 60000 level',
      limitKey: 'ms_4xxxx_credits_max',
      section: '§3.2',
      quote:
        'Up to six (6) credits at the 40000 level may count toward both the graduate school’s 30-credit requirement and the department’s 24-credit regular course requirement, subject to approval by the advisor and the ADGS.',
      ctx,
      approvalDriven: true,
    }),
  );

  // §3.5, through the DGS (2026-09-10): "an ND 4+1 student can have up to 6
  // credits (whether 40xxx or 60xxx courses) counted towards both degrees."
  // The 40000-level sharing is not in §3.5's text nor the Academic Code's: it
  // is the Graduate School's written answer to the DGS (email, Maureen
  // Collins, 2026-09-10; DGS 2026-10-03, P1-units-4plus1-12), for ANY Notre
  // Dame undergraduate, subject to the Courses tab's verdict on each course —
  // so the row says where the rule comes from. The row appears only for a
  // student who has such a course.
  if (ctx.classified.some((c) => c.caps.includes('sharedbs'))) {
    rows.push(
      capRow({
        id: 'ms.cap.sharedbs',
        group: COURSEWORK,
        title: `At most ${BS_SHARED_CREDITS_MAX} credits shared with your bachelor\u2019s degree`,
        capId: 'sharedbs',
        capLabel: 'credits shared with your bachelor\u2019s degree',
        section: '\u00a73.5',
        quote:
          'With approval of the instructor and DGS, students in the integrated B.S. + M.S. program may, over the second semester of their junior year and their senior year, take one or two 3-credit CSE regular courses at the 60000 level or higher, and count these both as undergraduate CSE electives/Tech electives and as course requirements for the MSCSE degree.',
        // The app's own reading, out of the quote (policy review round 3,
        // P3-text-engine-5): a note on the card, as P1-units-4plus1-12 asks.
        extraDetail: ['§3.5 names 60000-level courses; that up to six credits of 40000-level CSE courses may count toward both degrees too, subject to the course rules, is the Graduate School’s written answer (email, 2026-09-10)'],
        ctx,
        // "With approval of the instructor and DGS" — §3.5's own first words,
        // quoted on this card. A shared course still waiting on an approval no
        // longer leaves the row reading Met (interface review R3, 2026-09-18).
        approvalDriven: true,
      }),
    );
  }

  // §3.2 (September 2026 edition): "Up to nine (9) credits at the 60000 level
  // or higher taken from a department other than CSE may count toward both the
  // graduate school's 30-credit requirement and the department's 24-credit
  // regular course requirement, subject to approval by the advisor and the
  // ADGS." The level floor is new in the text (2026-10-02) but not in the
  // engine: non-CSE courses below the 60000 level have never counted for the
  // MSCSE (DGS 2026-08-31, allocate.ts).
  rows.push(
    capRow({
      id: 'ms.cap.noncse',
      group: COURSEWORK,
      title: `At most ${titleCount(ctx.params.number('ms_noncse_credits_max'), 9)} credits from outside CSE (60000 level or higher)`,
      capId: 'noncse',
      capLabel: 'non-CSE allowance credits',
      limitKey: 'ms_noncse_credits_max',
      section: '§3.2',
      quote:
        'Up to nine (9) credits at the 60000 level or higher taken from a department other than CSE may count toward both the graduate school’s 30-credit requirement and the department’s 24-credit regular course requirement, subject to approval by the advisor and the ADGS.',
      ctx,
      approvalDriven: true,
    }),
  );

  // Academic Code §2.2's nine credits shared with a second Notre Dame
  // degree the student is enrolled in at the same time (policy review
  // 2026-10-04, P2-ac-1-3-2) — shown only when a course draws on it.
  const otherDegree = otherDegreeCapRow(ctx, { id: 'ms.cap.otherdegree', group: COURSEWORK });
  if (otherDegree) rows.push(otherDegree);

  rows.push(residencyRow(ctx));
  rows.push(...optionRows(ctx));
  // The Application for Admission to Master's Degree Candidacy (Academic Code
  // §6.1.6; 2026-10-04): shown once a cumulative GPA at the minimum and 30
  // credits, counting those in progress, are in hand — or once dated.
  const gpaMin = ctx.params.number('gpa_min');
  const gpa = usableGpa(ctx.student.gpa);
  const totalMin = ctx.params.number('ms_total_credits_min');
  const ready =
    gpaMin !== undefined && gpa !== undefined && gpa >= gpaMin && totalMin !== undefined && ctx.alloc.total.definite + ctx.alloc.total.in_progress >= totalMin;
  const candidacy = msCandidacyApplicationRow(ctx, { group: PROJECT_THESIS, ready, alongTheWay: false, thesis: msRoute(ctx) === 'thesis' });
  if (candidacy) rows.push(candidacy);
  return rows;
}

/** §3.3: "The minimum residency requirement for the M.S. degree is registration
 * in full-time status for one semester during the academic year or for one
 * summer session." */
function residencyRow(ctx: Ctx): RequirementResult {
  const quote =
    'The minimum residency requirement for the M.S. degree is registration in full-time status for one semester during the academic year or for one summer session.';
  const records = fullTimeTermRecords(ctx);
  const fullTime = records.filter((r) => r.fullTime);
  const floor = ctx.params.number('fulltime_credits_min');
  // A summer session on its own counts at `summer_fulltime_credits_min`
  // registered credits (DGS Handbook §10.3.2: "may include summer session if
  // the student is registered for six or more credits"; DGS 2026-10-04,
  // P1-page-text-ui-9) — residency.ts summerFullTimeFloor.
  const summerFloor = ctx.params.number('summer_fulltime_credits_min');
  const summerNote: DetailPart = {
    note:
      summerFloor === undefined
        ? 'A summer session counts with any registration beside a full-time spring or fall of the same year (Academic Code §3.6)'
        : `A summer session counts with ${summerFloor} or more registered credits (DGS Handbook §10.3.2), or with any registration beside a full-time spring or fall of the same year (Academic Code §3.6)`,
  };
  let status: Status;
  // The semesters are the fact; how they are counted is a note (DGS 2026-10-03).
  const parts: DetailPart[] = [];
  let satisfied: string[] = [];
  if (floor === undefined) {
    status = 'cannot_evaluate';
    parts.push(missingParamDetail('fulltime_credits_min'));
  } else if (fullTime.length > 0) {
    status = 'met';
    parts.push(`Full-time in ${fullTime.map((r) => termLabel(r.term)).join(', ')}`, { note: `Full-time means ${floor} or more registered credits in the semester (§2.1.2)` });
    if (fullTime.some((r) => r.term.season === 'summer')) parts.push(summerNote);
    satisfied = fullTime.map((r) => termLabel(r.term));
  } else if (summerFloor === undefined && records.some((r) => r.term.season === 'summer' && r.credits > 0)) {
    // A summer with registration that only the summer floor could count, and
    // no floor in the rules sheet: never a default (CLAUDE.md "Never guess").
    status = 'cannot_evaluate';
    parts.push(missingParamDetail('summer_fulltime_credits_min'), summerNote);
  } else {
    status = 'in_progress';
    // A summer session counts too (§3.3 "or for one summer session"): the
    // Academic Code (§3.6) treats a student who was full-time in the academic
    // year as full-time in the summer with any registration, and the DGS
    // Handbook (§10.3.2) a summer of six or more credits — the engine applies
    // both; the nine credits are "per semester" (policy review 2026-10-03).
    parts.push(
      'No full-time semester yet',
      { note: `A semester counts once the courses you entered for it add up to ${floor} credits (§2.1.2); if you were full-time on research, tick that semester under Your standing (Full-time terms)` },
      summerNote,
    );
  }
  const withdrawnOnly = records.filter((r) => r.withdrawnOnly).map((r) => termLabel(r.term));
  if (withdrawnOnly.length > 0) parts.push(`${withdrawnOnly.join(', ')}: every course withdrawn — not counted`, { note: 'If you were registered full-time at census, tick the semester under Full-time terms; if you withdrew from the University and returned, enter your readmission under Your standing (Academic Code §5.5); otherwise ask the DGS' });
  // Academic Code §4.1 (policy review 2026-10-03, P1-residency-enrollment-c5).
  const belowGraduate = graduateLevelParts(records, floor);
  if (belowGraduate.length > 0) {
    parts.push(...belowGraduate);
    if (status === 'met') status = 'needs_dgs_review';
  }
  return {
    id: 'ms.residency',
    group: BASIC_GROUP,
    title: 'One semester of full-time status (or one summer session)',
    status,
    ...joinedDetail(parts),
    ...(satisfied.length > 0 ? { satisfiedBy: satisfied } : {}),
    citation: { section: '§3.3', quote },
  };
}

/** Academic Code §6.1.4 (also DGS Handbook §3.19 and §3.21.1): "A student
 * attending summer session only must complete all requirements within seven
 * years." The Graduate School's number, so it lives here and not in the
 * rules sheet (README § A5b). */
export const SUMMER_ONLY_MS_TIME_LIMIT_YEARS = 7;

/** Does every Notre Dame term on the record fall in a summer session — the
 * attendance pattern of a student "attending summer session only" (policy
 * review 2026-10-04, P2-dh-3.21-3.24-3; DGS: "Apply suggested handling")?
 * The engine sees the pattern; whether the student is in that category is
 * the DGS's to confirm, so the time-limit row routes and never decides. The
 * program's own courses (origin 'nd' — prior Notre Dame coursework is
 * 'transfer') and any semester ticked full-time under Your standing. */
export function summerSessionOnly(ctx: Ctx): boolean {
  const terms = [...ctx.student.courses.filter((c) => c.origin === 'nd').map((c) => c.term), ...(ctx.student.fullTimeTermOverrides ?? [])];
  return terms.length > 0 && terms.every((t) => t.season === 'summer');
}

/** The seven years as the time-limit row says them. */
const SUMMER_ONLY_LIMIT = {
  years: SUMMER_ONLY_MS_TIME_LIMIT_YEARS,
  why: 'Every Notre Dame term on your record is a summer session',
  rule: 'a student attending summer session only has seven years (Academic Code §6.1.4)',
};

/** The last dated §3.4 requirement — the thesis defense, the thesis's
 * submission to the Graduate School (Academic Code §6.1.8, 2026-10-04) or the
 * project report. */
/** The last MSCSE requirement completed: the thesis defense, the thesis
 * submission or the project report (policy review 2026-10-03), or — policy
 * review round 3, P3-cse-3-1 (DGS 2026-10-06: "Apply the suggested
 * handling") — the term in which the 30 total, the 24 regular-course or the
 * 6 project or thesis credits were first reached. CSE §3.3: "Failure to
 * complete all requirements for the M.S. degree within 5 years results in
 * forfeiture of degree eligibility"; Academic Code §6.1.4: "All requirements
 * for the master's degree must be completed within five years." A course
 * finished after the limit used to read "complete within the limit" once
 * graded. */
function lastMsCompletion(ctx: Ctx): Completion | undefined {
  const m = ctx.student.milestones;
  const p = ctx.params;
  const total = p.number('ms_total_credits_min');
  const regular = p.number('ms_regular_credits_min');
  const project = p.number('ms_project_credits_min');
  return lastCompletion([
    ...[m.thesisDefensePassed, m.thesisSubmitted, m.projectReportAccepted].filter((d): d is string => d !== undefined).map((date) => ({ date })),
    creditsReachedAt(ctx, (a) => a.countedRegular + a.countedOther, total, `the ${total} total credits`),
    creditsReachedAt(ctx, (a) => a.countedRegular, regular, `the ${regular} regular-course credits`),
    creditsReachedAt(ctx, (a) => (a.course.pool === 'project' ? a.countedOther : 0), project, `the ${project} credits of M.S. project or thesis direction`),
  ]);
}

/** §3.3: "Failure to complete all requirements for the M.S. degree within
 * 5 years results in forfeiture of degree eligibility." */
export function msTimeLimitRow(ctx: Ctx, others: { allMet: boolean; anyCannotEvaluate: boolean; mastersApplicationOpen?: boolean }): RequirementResult {
  const quote =
    'Failure to complete all requirements for the M.S. degree within 5 years results in forfeiture of degree eligibility.';
  // The same row as the Ph.D.'s, with the master's key and quote — and the
  // thesis defense or project report as the last dated requirement (policy
  // review 2026-10-03: a defense after the limit used to close the row), or
  // the course that completed a credit requirement (P3-cse-3-1).
  return timeLimitRow(ctx, others, {
    id: 'ms.timeLimit',
    group: PROJECT_THESIS,
    title: `All requirements complete within ${titleCount(ctx.params.number('ms_time_limit_years'), 5)} years`,
    yearsKey: 'ms_time_limit_years',
    section: '§3.3',
    quote,
    completed: lastMsCompletion(ctx),
    // The Graduate School's seven years, when the record shows summer
    // sessions only — for the DGS to confirm (2026-10-04).
    ...(summerSessionOnly(ctx) ? { longer: SUMMER_ONLY_LIMIT } : {}),
  });
}

/** The review-request line for a summer-session-only record past the five
 * years and inside the seven (2026-10-04) — today, while something is still
 * open, or at the last requirement's date once everything is complete. */
export function summerOnlyReviewFlag(ctx: Ctx, others: { allMet: boolean }): string | undefined {
  const years = ctx.params.number('ms_time_limit_years');
  if (ctx.student.program !== 'mscse' || years === undefined || !summerSessionOnly(ctx)) return undefined;
  const five = timeLimitDate(ctx, years);
  const seven = timeLimitDate(ctx, SUMMER_ONLY_MS_TIME_LIMIT_YEARS);
  const completedOn = lastMsCompletion(ctx)?.date;
  if (others.allMet && (completedOn === undefined || completedOn <= five)) return undefined; // complete within the five
  const when = others.allMet ? completedOn! : ctx.today;
  if (when <= five || when > seven) return undefined;
  return `Time limit: every Notre Dame term on my record is a summer session. The ${years} years of §3.3 passed at ${deadlineTermLabel(five)} (approximate); a student attending summer session only has seven years (Academic Code §6.1.4), until ${deadlineTermLabel(seven)} — please confirm whether they apply to me.`;
}

/** The MSCSE route the rows are built for: the student's choice, else the
 * one the record shows (inferMsOption), else undecided. */
function msRoute(ctx: Ctx): 'project' | 'thesis' | 'undecided' {
  const chosen = ctx.student.msOption ?? 'undecided';
  return chosen === 'undecided' ? (inferMsOption(ctx.student) ?? 'undecided') : chosen;
}

/** The thesis readers, as the student answers them (policy review
 * 2026-10-04, P2-dh-10-19; DGS: "Apply suggested handling"). CSE §3.4: "Such
 * readers are selected from among the Tenure and Tenure Track (TTT) faculty
 * of the department. The appointment of a non-TTT faculty member from CSE or
 * a faculty member from outside the department as a reader must have prior
 * approval. The approval process must be initiated by the research advisor
 * and the student by submitting a written request to the DGS. The research
 * advisor may not be one of the two official readers." DGS Handbook §10.3.8:
 * "The appointment of a reader from outside the student's program must have
 * the Graduate School's prior approval." The app cannot see faculty status,
 * so one question, asked on the thesis route only: 'no' or 'not sure' goes
 * to the DGS. Unanswered changes nothing — the readers are nominated only
 * once the advisor approves the thesis for reading, so for most of the
 * program there is nothing to answer (the Ph.D. advisor's question, asked of
 * every Ph.D. student, is a missing input when blank). The readers are not
 * recorded (P2-dh-3.21-3.24-8, ignored the same day). */
export function thesisReadersRouted(ctx: Ctx): 'no' | 'unsure' | undefined {
  if (ctx.student.program !== 'mscse' || msRoute(ctx) !== 'thesis') return undefined;
  const a = ctx.student.milestones.thesisReadersTtt;
  return a === 'no' || a === 'unsure' ? a : undefined;
}

const READERS_RULE =
  'Thesis readers come from the department’s tenured and tenure-track faculty, and your advisor may not be one of the two (§3.4): a non-TTT CSE reader or one from outside the department needs prior approval — you and your advisor send the DGS a written request — and a reader from outside the program needs the Graduate School’s prior approval too (DGS Handbook §10.3.8)';

/** The review-request line for thesis readers who need an approval. */
export function thesisReadersReviewFlag(ctx: Ctx): string | undefined {
  const routed = thesisReadersRouted(ctx);
  if (!routed) return undefined;
  return `Thesis readers: ${routed === 'unsure' ? 'I am not sure whether both are tenured or tenure-track CSE faculty and neither is my advisor' : 'not both tenured or tenure-track CSE faculty, or one of them is my advisor'}. ${READERS_RULE.replace('your advisor may not', 'the advisor may not').replace('you and your advisor send', 'the advisor and the student send')}.`;
}

/** Which §3.4 route the record itself shows (2026-09-12): a Master's project
 * course or an accepted project report → project; thesis direction, an
 * approved thesis topic or a defense → thesis; both or neither → undefined. The
 * page pre-fills "Project or thesis option" from this and says so; the
 * student's own choice always wins. */
export function inferMsOption(student: Ctx['student']): 'project' | 'thesis' | undefined {
  const m = student.milestones;
  const ids = new Set(student.courses.map((c) => c.courseId.toUpperCase().replace(/\s+/g, ' ')));
  const project = ids.has('CSE 68902') || m.projectReportAccepted !== undefined;
  const thesis = ids.has('CSE 68901') || m.thesisDefensePassed !== undefined || m.thesisTopicApproved !== undefined;
  if (project && !thesis) return 'project';
  if (thesis && !project) return 'thesis';
  return undefined;
}

function optionRows(ctx: Ctx): RequirementResult[] {
  const rows: RequirementResult[] = [];
  const option = msRoute(ctx);
  const m = ctx.student.milestones;
  // While no route is chosen or visible, the two rows are ALTERNATIVES (§3.4:
  // "in one of two ways"): either finished satisfies both (F4, 2026-09-12).
  const eitherDone = option === 'undecided' && (m.thesisDefensePassed !== undefined || m.projectReportAccepted !== undefined);
  const alternative: DetailPart[] = option === 'undecided' ? [{ note: 'Either route satisfies §3.4 — pick yours under Milestones' }] : [];
  // §3.3: "Failure to complete all requirements for the M.S. degree within 5
  // years results in forfeiture of degree eligibility." A thesis defense or a
  // project report dated after the limit cannot simply read Met — the same
  // guard the Ph.D. defense has had since 2026-09-13 (policy review 2026-10-03).
  const years = ctx.params.number('ms_time_limit_years');
  const limitDate = years === undefined ? undefined : timeLimitDate(ctx, years);
  const late = (date: string | undefined): boolean => limitDate !== undefined && date !== undefined && date > limitDate;
  // When it was late is the fact; what that means is a note (DGS 2026-10-03).
  const lateFact = ` — after the ${years}-year limit, which passed at ${limitDate === undefined ? '' : deadlineTermLabel(limitDate)} (approximate)`;
  // A summer-session-only record may have seven years instead (Academic Code
  // §6.1.4, 2026-10-04) — the DGS confirms, so the sentence names it.
  const lateRule: DetailPart = {
    note: `§3.3 makes that a forfeiture of degree eligibility unless the Graduate School granted an extension${summerSessionOnly(ctx) ? ' or the seven years of a student attending summer session only apply to you (Academic Code §6.1.4)' : ''}, so confirm it with the DGS`,
  };
  // The master's degree needs admission to master's candidacy — a Graduate
  // School form by its calendar deadline (Academic Code §6.1.6) — said once
  // the route is complete (policy review 2026-10-03).
  const formNote: DetailPart = { note: candidacyFormSentence(ctx, 'master’s') };
  // Academic Code §6.1.5 (policy review 2026-10-04, P2-ac-5b-6.1-11; DGS:
  // "apply the suggested handling"): "By the end of the term following
  // completion of the coursework required by the program, the degree
  // candidate must have taken an oral and/or written master's examination" —
  // for CSE, the project report or the thesis defense, the "equivalent
  // requirement in lieu" (DGS Handbook §3.21.2). Once the 24 regular-course
  // credits are complete, the term after the last of them; past its end with
  // neither route dated, an open route row says so. No status changes.
  const regularMin = ctx.params.number('ms_regular_credits_min');
  const lastRegular =
    regularMin !== undefined && ctx.alloc.regular.definite >= regularMin
      ? ctx.classified
          .filter((c) => c.pool === 'regular' && c.tier === 'definite' && !c.superseded && c.ineligibleReason === undefined)
          .map((c) => c.entry.term)
          .sort(compareTerm)
          .pop()
      : undefined;
  const examDue = lastRegular ? endOfNextSemester(endOfTerm(lastRegular).date, 1) : undefined;
  const examNote: DetailPart[] =
    examDue !== undefined && ctx.today > examDue && !m.thesisDefensePassed && !m.projectReportAccepted
      ? [{ note: `Academic Code §6.1.5 expects the master’s examination — for CSE, the project report or the thesis defense — by the end of the term after your coursework, here ${deadlineTermLabel(examDue)} (approximate); confirm your timeline with the DGS` }]
      : [];

  // The thesis topic (Academic Code §6.1.7: "With the approval of his or her
  // advisor, the student proposes a thesis topic for program approval"; CSE
  // §3.4(ii): "propose an M.S. thesis topic with the approval and supervision
  // of their research advisor") — a step before the defense, shown on the
  // thesis route and not counted in the headline (policy review 2026-10-04,
  // P2-ac-5b-6.1-14; DGS: "Apply suggested handling"). "Not started" until
  // dated; a passed defense comes after it, so the step reads done then.
  if (option === 'thesis') {
    const topic = m.thesisTopicApproved;
    rows.push({
      id: 'ms.thesis.topic',
      group: PROJECT_THESIS,
      title: 'Thesis topic approved (thesis option)',
      shortTitle: 'Thesis topic approved',
      status: topic || m.thesisDefensePassed ? 'met' : 'unmet',
      unscored: true,
      ...joinedDetail(
        topic
          ? [`Thesis topic approved ${topic}`]
          : m.thesisDefensePassed
            ? [`Approved before the thesis defense (passed ${m.thesisDefensePassed})`]
            : ['Not started', { note: 'With your advisor’s approval you propose a thesis topic for the program’s approval (§3.4; Academic Code §6.1.7); enter the date under Milestones once it is approved' }],
      ),
      citation: { section: 'Academic Code §6.1.7', quote: 'With the approval of his or her advisor, the student proposes a thesis topic for program approval.' },
    });
  }

  if (option === 'thesis' || option === 'undecided') {
    // §3.4: "Upon acceptance of the thesis by the thesis defense examination
    // committee (advisor and two readers), the student must successfully pass
    // the oral thesis defense examination."
    const quote =
      'Upon acceptance of the thesis by the thesis defense examination committee (advisor and two readers), the student must successfully pass the oral thesis defense examination.';
    let status: Status;
    let parts: DetailPart[];
    const lateDefense = late(m.thesisDefensePassed);
    // §2.2 for a thesis defense already dated (policy review 2026-10-03,
    // P1-gpa-10): passed while the cumulative GPA was below the minimum goes to
    // the DGS rather than reading Met. (§2.2 names the thesis; the project
    // report below is not gated.)
    const gpaAtDefense = m.thesisDefensePassed ? defendedBelowGpaNote(ctx) : '';
    // A failed first attempt (Academic Code §6.1.5, policy review 2026-10-04,
    // P2-ac-5b-6.1-12): "Failure in either one or both parts of the
    // examination results in automatic forfeiture of degree eligibility,
    // unless the program recommends a retake" — one retake, "by the end of the
    // following semester". The retake decision is the program's, so the row
    // says so and dates the window; a missed window reads Overdue.
    const failedOn = m.thesisDefenseFailed;
    const retakeDue = failedOn ? endOfNextSemester(failedOn, 1) : undefined;
    const retakeRule = 'Academic Code §6.1.5: a failed master’s examination forfeits degree eligibility unless the program recommends a retake; only one retake is allowed, by the end of the following semester — the DGS decides';
    let deadline: DeadlineInfo | undefined;
    // Passed before a readmission after five years or more (Academic Code
    // §5.5; P3-ac-5a-3, DGS 2026-10-05): the DGS rules on it.
    const defenseForfeited = beforeForfeiture(ctx, m.thesisDefensePassed);
    if (m.thesisDefensePassed || eitherDone) {
      status = lateDefense || gpaAtDefense !== '' || defenseForfeited ? 'needs_dgs_review' : 'met';
      const retakeLate = failedOn !== undefined && retakeDue !== undefined && m.thesisDefensePassed !== undefined && m.thesisDefensePassed > retakeDue;
      if (retakeLate) status = 'needs_dgs_review';
      parts = m.thesisDefensePassed
        ? [
            // No readers' date of its own since 2026-10-04 (DGS: "Apply the
            // same to MSCSE thesis") — the defense stands for both.
            `Thesis defense passed ${m.thesisDefensePassed}${failedOn ? ` — the retake, after a failed attempt on ${failedOn}` : ''}${lateDefense ? lateFact : ''}${defenseForfeited ? ` — ${FORFEIT_FACT}` : ''}`,
            ...(defenseForfeited ? [{ note: FORFEIT_NOTE }] : []),
            ...(lateDefense ? [lateRule] : []),
            ...(retakeLate ? [{ note: `The retake was due by ${deadlineTermLabel(retakeDue!)} (approximate), the end of the semester after the fail (Academic Code §6.1.5) — confirm with the DGS` }] : []),
            ...noteOf(gpaAtDefense),
            // Registered in the defense term (DGS Handbook §8.2.5; 2026-10-04).
            ...defenseRegistrationNote(ctx, m.thesisDefensePassed),
            ...(lateDefense ? [] : [formNote]),
          ]
        : [`Not needed — the project route is complete (project report accepted ${m.projectReportAccepted})`, ...alternative];
    } else if (failedOn !== undefined && retakeDue !== undefined) {
      if (ctx.today <= retakeDue) {
        status = 'in_progress';
        // Conditional, as the Code is (policy review round 3, P3-ac-5b-6.1-3):
        // "unless the program recommends a retake".
        parts = [`Thesis defense failed ${failedOn} — one retake, if the program recommends it`, { note: retakeRule }, ...alternative];
        deadline = openDeadline(retakeDue, ctx.today, `Retake due by ${deadlineTermLabel(retakeDue)} (approximate)`);
      } else {
        status = 'unmet';
        parts = [`Thesis defense failed ${failedOn}, and no retake is recorded`, { note: `${retakeRule}; talk to the DGS` }, ...alternative];
        deadline = { date: retakeDue, approx: true, state: 'overdue', label: `Overdue — the retake was due by ${deadlineTermLabel(retakeDue)} (approximate)` };
      }
    } else {
      status = 'unmet';
      parts = ['Not yet passed', ...alternative, ...noteOf(defendGpaNote(ctx)), ...examNote];
    }
    // The readers' faculty status (CSE §3.4; DGS Handbook §10.3.8 — policy
    // review 2026-10-04, P2-dh-10-19): 'no' or 'not sure' puts the question
    // in the review request and the rule on the row; a passed defense then
    // reads Conditionally met (needs_dgs_review) until the DGS confirms the
    // approval. Before the defense the row stays In progress — "Conditionally
    // met" would say a defense not yet held is satisfied. Unanswered on the
    // thesis route, the question is pointed to until the defense is dated.
    const readers = thesisReadersRouted(ctx);
    if (readers) {
      if (status === 'met') status = 'needs_dgs_review';
      parts.push({ note: `${READERS_RULE} — this is in the review request; ask the DGS` });
    } else if (option === 'thesis' && m.thesisReadersTtt === undefined && !m.thesisDefensePassed) {
      parts.push({ note: 'Once your two readers are nominated, answer under Milestones whether both are tenured or tenure-track CSE faculty and neither is your advisor (§3.4)' });
    }
    const defenseRow: RequirementResult = {
      id: 'ms.thesis.defense',
      group: PROJECT_THESIS,
      title: 'Thesis accepted and oral defense passed (thesis option)',
      status,
      ...(lateDefense ? { statusLabel: 'Eligibility at risk' } : {}),
      ...joinedDetail(parts),
      ...(deadline ? { deadline } : {}),
      citation: { section: '§3.4', quote },
    };
    // A dated defense is read against §2.2's GPA bar and §3.3's five years —
    // with either number missing from the sheet it cannot read Met (item 1).
    rows.push(m.thesisDefensePassed ? heldForMissingParams(defenseRow, ctx, ['gpa_min', 'ms_time_limit_years']) : defenseRow);
  }

  // The final thesis to the Graduate School (policy review 2026-10-04,
  // P2-ac-5b-6.1-15 and P2-dh-3.21-3.24-23; DGS: "Apply the suggested
  // handling"). Academic Code §6.1.8: "the master's candidate who is
  // completing a thesis must submit it to the Graduate School on or before the
  // deadline published in the Graduate School calendar"; CSE §3.4: "After the
  // readers approve the thesis, the candidate should submit the thesis
  // electronically"; DGS Handbook §3.21.3/§3.22.5: formal submission only after
  // a successful defense and all requested changes. The Ph.D.'s
  // phd.dissertation.submitted row, on the thesis route: the last requirement,
  // so the five-year row closes on it.
  if (option === 'thesis') {
    const submitted = m.thesisSubmitted;
    const lateSubmission = late(submitted);
    const submittedRow: RequirementResult = {
      id: 'ms.thesis.submitted',
      group: PROJECT_THESIS,
      title: 'Final thesis submitted to the Graduate School (thesis option)',
      shortTitle: 'Thesis submitted',
      status: submitted ? (lateSubmission ? 'needs_dgs_review' : 'met') : m.thesisDefensePassed ? 'in_progress' : 'unmet',
      ...(submitted && lateSubmission ? { statusLabel: 'Eligibility at risk' } : {}),
      ...joinedDetail(
        submitted
          ? lateSubmission
            ? [`Submitted ${submitted}${lateFact}`, lateRule]
            : [`Submitted ${submitted}`]
          : m.thesisDefensePassed
            ? [
                'Defense passed — not submitted yet',
                { note: 'Make the changes the committee asked for, then submit the final thesis electronically, in the Graduate School’s format, by the Graduate School calendar’s deadline for the graduation you want (Academic Code §6.1.8; CSE §3.4; DGS Handbook §3.21.3); enter the date under Milestones once it is submitted' },
              ]
            : ['Not started', { note: 'The submission comes after the thesis defense (§3.4)' }],
      ),
      citation: {
        section: 'Academic Code §6.1.8',
        quote: 'The master’s candidate who is completing a thesis must submit it to the Graduate School on or before the deadline published in the Graduate School calendar.',
      },
    };
    // Read against §3.3's five years (item 1).
    rows.push(submitted ? heldForMissingParams(submittedRow, ctx, ['ms_time_limit_years']) : submittedRow);
  }

  if (option === 'project' || option === 'undecided') {
    // §3.4: "The project report and deliverables must be accepted and approved
    // by the advisor to satisfy the project requirement."
    const quote =
      'The project report and deliverables must be accepted and approved by the advisor to satisfy the project requirement.';
    const lateReport = late(m.projectReportAccepted);
    const reportRow: RequirementResult = {
      id: 'ms.project.report',
      group: PROJECT_THESIS,
      title: 'Project report accepted by the advisor (project option)',
      status: m.projectReportAccepted || eitherDone ? (lateReport || beforeForfeiture(ctx, m.projectReportAccepted) ? 'needs_dgs_review' : 'met') : 'unmet',
      ...(lateReport ? { statusLabel: 'Eligibility at risk' } : {}),
      ...joinedDetail(
        m.projectReportAccepted
          ? [
              `Project report accepted ${m.projectReportAccepted}${lateReport ? lateFact : ''}${beforeForfeiture(ctx, m.projectReportAccepted) ? ` — ${FORFEIT_FACT}` : ''}`,
              ...(beforeForfeiture(ctx, m.projectReportAccepted) ? [{ note: FORFEIT_NOTE }] : []),
              lateReport ? lateRule : formNote,
            ]
          : eitherDone
            ? [`Not needed — the thesis route is complete (defense passed ${m.thesisDefensePassed})`, ...alternative]
            : ['Not yet accepted', { note: 'The written project report and deliverables must be accepted and approved by your advisor (§3.4)' }, ...alternative, ...examNote],
      ),
      citation: { section: '§3.4', quote },
    };
    // Read against §3.3's five years (item 1).
    rows.push(m.projectReportAccepted ? heldForMissingParams(reportRow, ctx, ['ms_time_limit_years']) : reportRow);
  }
  return rows;
}
