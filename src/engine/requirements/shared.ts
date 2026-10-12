// §2 requirements shared by both programs.
import { GPA_RANGE, formatValue, inRange, rangeSpan, usableGpa } from '../ranges.ts';
import { coursesNeedingDgsReviewFor } from '../review.ts';
import { openDeadline } from '../status.ts';
import { endOfTerm, termLabel } from '../term.ts';
import type { DetailPart, RequirementResult } from '../types.ts';
import type { Ctx } from './context.ts';
import { DUAL_DEGREE_SHARED_CREDITS_MAX } from '../allocate.ts';
import { capRow, joinedDetail, missingParamDetail } from './context.ts';

const GROUP = 'Basic requirements — §2.2–2.3';

/** §2.2: "Continuation in a CSE graduate degree program, admission to degree
 * candidacy, and graduation require maintenance of at least a 3.0 (B)
 * cumulative GPA." */
/** A GPA as the student entered it or the transcript printed it — up to three
 * decimals, never rounded (policy review 2026-10-03: 2.996 printed as "3.00"
 * beside "is below the 3.0 minimum"). */
export function gpaText(gpa: number): string {
  const three = gpa.toFixed(3); // "2.900", "2.996", "3.500"
  return three.endsWith('0') ? three.slice(0, -1) : three; // at least two decimals, as a transcript prints them
}

/** §2.2 for a defense ALREADY dated (policy review 2026-10-03, P1-gpa-10 —
 * mirroring the candidacy row): "A student whose cumulative GPA is below 3.0
 * may not defend their thesis or dissertation." A defense date entered while
 * the cumulative GPA is below the minimum is not a met row: the row goes to
 * the DGS with this sentence. Empty when it does not apply — no minimum in
 * the sheet, no usable GPA (an off-scale figure gates nothing, R1), or a GPA
 * at or above it. The M.S. project route is not gated: §2.2 names the thesis
 * and the dissertation only. */
export function defendedBelowGpaNote(ctx: Ctx): string {
  const min = ctx.params.number('gpa_min');
  const gpa = usableGpa(ctx.student.gpa);
  return min !== undefined && gpa !== undefined && gpa < min
    ? ` You show a ${gpaText(gpa)} GPA — §2.2 requires a cumulative GPA of ${min.toFixed(1)} or higher to defend; confirm with the DGS that the defense could be held.`
    : '';
}

export function gpaRow(ctx: Ctx): RequirementResult {
  const quote =
    'Continuation in a CSE graduate degree program, admission to degree candidacy, and graduation require maintenance of at least a 3.0 (B) cumulative GPA.';
  const min = ctx.params.number('gpa_min');
  const gpa = ctx.student.gpa;
  let status: RequirementResult['status'];
  // The GPA is the fact; what a low one means is a note (DGS 2026-10-03).
  const parts: DetailPart[] = [];
  if (min === undefined) {
    status = 'cannot_evaluate';
    parts.push(missingParamDetail('gpa_min'));
  } else if (gpa === undefined) {
    status = 'cannot_evaluate';
    // The graduate career's figure (P1-gpa-c4, DGS 2026-10-03): the label and this line say so.
    parts.push('Enter your graduate-level cumulative GPA from your transcript (transferred grades are not part of it, §5.2)');
  } else if (!inRange(gpa, GPA_RANGE)) {
    // A figure off the 4.00 scale is not a low GPA and not a high one — it is
    // no answer at all, so §2.2 cannot be checked (interface review R1,
    // 2026-09-18). The form now refuses such a value before it is stored; this
    // is the floor under a hand-edited save file, so the row can never read
    // "35.00 meets the 3.0 minimum" with a green pill again.
    status = 'cannot_evaluate';
    parts.push(`Cumulative GPA ${formatValue(gpa, GPA_RANGE)} is outside the ${rangeSpan(GPA_RANGE)} range, so it cannot be checked — correct it under Coursework`);
  } else if (gpa >= min) {
    status = 'met';
    parts.push(`Cumulative GPA ${gpaText(gpa)} meets the ${min.toFixed(1)} minimum`);
  } else {
    status = 'unmet';
    parts.push(`Cumulative GPA ${gpaText(gpa)} is below the ${min.toFixed(1)} minimum`, { note: 'You cannot receive a degree or defend until it recovers (§2.2)' });
  }
  // One cumulative GPA (Academic Code §4.5: "the ratio of accumulated earned
  // quality points to the accumulated graded semester credit hours", over
  // every Notre Dame course): the registrar's figure decides §2.2. When an
  // earlier Notre Dame graduate program sits inside it and this program's
  // courses alone fall on the other side of the minimum, the DGS is asked
  // rather than the student choosing a figure (policy review 2026-10-03,
  // replacing the 2026-09-05 choice).
  const gs = ctx.student.gpaSource;
  if (min !== undefined && gpa !== undefined && inRange(gpa, GPA_RANGE) && gs !== undefined) {
    const other = gs.basis === 'transcript-graduate' ? gs.programGpa : gs.transcriptGpa;
    if (other !== undefined && inRange(other, GPA_RANGE) && other >= min !== gpa >= min) {
      status = 'needs_dgs_review';
      parts.push({
        note:
        gs.basis === 'transcript-graduate'
          ? `Your transcript’s cumulative GPA includes an earlier graduate program at Notre Dame; this program’s courses alone average ${gpaText(other)}, on the other side of the minimum — the Academic Code reads one cumulative GPA (Academic Code §4.5), so confirm your standing with the DGS.`
          : `This figure was computed from this program’s courses alone; your transcript’s cumulative GPA is ${gpaText(other)}, on the other side of the minimum, and the Academic Code reads that registrar’s figure (Academic Code §4.5) — confirm your standing with the DGS.`,
      });
    }
  }
  return {
    id: 'shared.gpa',
    group: GROUP,
    // Read from the sheet, formatted as the row's own sentence formats it
    // (P4-data-5).
    title: `Cumulative GPA of at least ${(min ?? 3).toFixed(1)}`,
    status,
    ...joinedDetail(parts),
    citation: { section: '§2.2', quote },
  };
}

/** §2.3 (September 2026 edition): "M.S. students, with assistance from the
 * ADGS, are expected to identify a thesis or project advisor by the end of
 * their first semester, unless an exception is granted by the ADGS." /
 * "Continuous advisor supervision is required throughout the duration of the
 * Ph.D. program." (The July 2026 edition said "by the beginning of their
 * first semester"; the engine followed it until 2026-10-02.) §2.5.2's
 * proper-progress list agrees since the DGS corrected it on 2026-10-03
 * (P1-deadlines-18): "Obtaining a thesis/project advisor by the end of the
 * first semester of the program" — it used to say "at the start of the
 * program". */
/** Whether a Ph.D. student's advisor is tenured or tenure-track CSE faculty,
 * as the student answers it (policy review 2026-10-04, P2-ac-6.2-app-8; DGS:
 * "apply the suggested handling"). CSE §2.3: "A research advisor must be a
 * Tenure and Tenure Track (TTT) faculty member of the department. Exceptions
 * to this policy require approval of the DGS." Academic Code §6.2.7:
 * "Advisors and dissertation directors are chosen from the tenured and
 * tenure-track faculty of the student's program", a non-TTT member only as a
 * co-director with a TTT one. The app cannot see faculty status, so it asks;
 * 'yes' for any advisor on record is enough, 'no' or 'not sure' for every
 * one goes to the DGS, and an unanswered question is a missing input. */
/** Who is asked (policy review 2026-10-04, P2-dh-10-5; DGS: "Apply suggested
 * handling"): every Ph.D. student, and an MSCSE student on the thesis option —
 * the Graduate School's adviser criteria are written for a research master's
 * (DGS Handbook §10.3.2: "Students doing a research master's must have at
 * least one thesis adviser who is: current tenured or tenure-track faculty at
 * Notre Dame … If the student's primary research director does not meet these
 * requirements, they must have a co-adviser who meets the criteria"; §10.3.8
 * the same on the Reader's Report). Whether CSE §2.3's "A research advisor
 * must be a Tenure and Tenure Track (TTT) faculty member" also covers an M.S.
 * PROJECT advisor is the handbook's to say (HANDBOOK-REVISIONS 18), so the
 * project option is not asked. */
export function advisorTttAsked(ctx: Ctx): boolean {
  return ctx.student.program === 'phd' || (ctx.student.program === 'mscse' && ctx.student.msOption === 'thesis');
}

/** What a "no" or "not sure" means — two cases (policy review round 3,
 * P3-cross-doc-2; DGS 2026-10-07: option (a), with a change: "a
 * non-tenure-track advisor cannot advise someone alone. A tenure-track
 * co-advisor must be accompanied" — current department policy, the outcome of
 * the graduate studies committee's discussion of 2026-10-07). An advisor who
 * is tenured or tenure-track in another Notre Dame department needs the DGS's
 * approval (§2.3's exception); one who is not tenured or tenure-track needs a
 * tenured or tenure-track co-advisor, with no exception (the Graduate School's
 * rule too: DGS Handbook §10.3.1 / §10.3.2, Academic Code §6.2.7). It used to
 * say a non-TTT or outside advisor "needs the DGS's written approval". The
 * same for the Ph.D. and the MSCSE thesis advisor — the policy is general. */
export function advisorCasesRule(ms: boolean): string {
  return `an advisor who is tenured or tenure-track in another Notre Dame department needs the DGS’s approval (§2.3); an advisor who is not tenured or tenure-track cannot advise alone — a tenured or tenure-track co-advisor is required (department policy; ${ms ? 'DGS Handbook §10.3.2' : 'Academic Code §6.2.7; DGS Handbook §10.3.1'})`;
}

export function advisorTttState(ctx: Ctx): 'yes' | 'no' | 'unanswered' {
  const m = ctx.student.milestones;
  const answers = [...(m.advisorName || m.advisorIdentified ? [m.advisorTtt] : []), ...(m.advisorName2 ? [m.advisorTtt2] : [])];
  if (answers.some((a) => a === 'yes')) return 'yes';
  if (answers.length > 0 && answers.every((a) => a === 'no' || a === 'unsure')) return 'no';
  return 'unanswered';
}

/** The review-request note for an advisor the DGS must approve (Ph.D.; MSCSE
 * thesis since 2026-10-04 — the caller words it for the ADGS). */
export function advisorReviewFlag(ctx: Ctx): string | undefined {
  if (!advisorTttAsked(ctx) || advisorTttState(ctx) !== 'no') return undefined;
  const m = ctx.student.milestones;
  const who = (name: string | undefined, answer: 'yes' | 'no' | 'unsure' | undefined) =>
    `${name ?? 'my advisor'} — ${answer === 'unsure' ? 'not sure whether tenured or tenure-track CSE faculty' : 'not tenured or tenure-track CSE faculty'}`;
  const listed = [who(m.advisorName, m.advisorTtt), ...(m.advisorName2 ? [who(m.advisorName2, m.advisorTtt2)] : [])];
  return ctx.student.program === 'phd'
    ? `Advisor’s faculty status: ${listed.join('; ')}. A dissertation director must be tenured or tenure-track CSE faculty (§2.3; Academic Code §6.2.7) — ${advisorCasesRule(false)}.`
    : `Thesis advisor’s faculty status: ${listed.join('; ')}. A thesis advisor must be tenured or tenure-track CSE faculty (§2.3), and the Graduate School requires at least one thesis adviser who is tenured or tenure-track at Notre Dame, or a co-adviser who is (DGS Handbook §10.3.2, §10.3.8) — ${advisorCasesRule(true)}.`;
}

/** Academic Code §5.7.1: "Students must be in good standing to receive a
 * graduate degree." §5.7.2: a student on probation "must complete the
 * stipulations outlined in the probation letter within the required
 * timeframe", and "will be returned to good standing the next semester of
 * enrollment" once they are met. Shown only while a probation letter's
 * deadline is on the record (Your standing; policy review 2026-10-04,
 * P2-ac-5b-6.1-2; DGS: "Apply the suggested handling"). The suggestion named
 * Conditionally met; this row is In progress instead — nothing about it is
 * satisfied yet, and Conditionally met says a requirement is (the standing
 * rule for needs_dgs_review). Being scored, it keeps the headline from
 * reading "All automatically checkable items are currently satisfied". */
export function goodStandingRow(ctx: Ctx): RequirementResult | undefined {
  const due = ctx.student.probationLetterDeadline;
  if (due === undefined) return undefined;
  const passed = due < ctx.today;
  return {
    id: 'shared.goodStanding',
    group: GROUP,
    title: 'In good standing to receive the degree',
    shortTitle: 'Good standing',
    status: 'in_progress',
    ...joinedDetail([
      `On probation — the letter’s deadline is ${due}`,
      {
        note: 'A degree is conferred only to a student in good standing (Academic Code §5.7.1). You return to good standing the semester after the letter’s stipulations are met (Academic Code §5.7.2); once the DGS confirms it, clear the probation date under Your standing',
      },
    ]),
    deadline: passed ? { date: due, approx: false, state: 'overdue', label: `The letter’s deadline, ${due}, has passed — confirm your standing with the DGS` } : openDeadline(due, ctx.today, `The probation letter’s deadline: ${due}`),
    citation: { section: 'Academic Code §5.7.1', quote: 'Students must be in good standing to receive a graduate degree.' },
  };
}

export function advisorRow(ctx: Ctx): RequirementResult {
  const ms = ctx.student.program === 'mscse';
  const quote = ms
    ? 'M.S. students, with assistance from the ADGS, are expected to identify a thesis or project advisor by the end of their first semester, unless an exception is granted by the ADGS.'
    : 'Continuous advisor supervision is required throughout the duration of the Ph.D. program.';
  const { advisorIdentified, advisorName, advisorName2 } = ctx.student.milestones;
  const names = [advisorName, advisorName2].filter((n): n is string => !!n);
  let status: RequirementResult['status'];
  const parts: DetailPart[] = [];
  // §2.3's "by the end of their first semester" is a deadline for an MSCSE
  // student (DGS 2026-09-27; the end, not the start, since the September 2026
  // edition — DGS 2026-10-02): the row reads Overdue once that semester is
  // over with no advisor entered, and the dial counts it.
  const end = endOfTerm(ctx.entry).date;
  const deadline: RequirementResult['deadline'] | undefined = ms
    ? advisorIdentified || names.length > 0
      ? { date: end, approx: true, state: 'done', label: 'Complete' }
      : ctx.today > end
        ? { date: end, approx: true, state: 'overdue', label: `Overdue — was expected by the end of ${termLabel(ctx.entry)}` }
        : openDeadline(end, ctx.today, `Due by the end of ${termLabel(ctx.entry)}`)
    : undefined;
  if (advisorIdentified || names.length > 0) {
    status = 'met';
    // Two advisors are one supervision (DGS 2026-09-22): "Advisors: A and B".
    parts.push(`${names.length > 1 ? 'Advisors' : 'Advisor'}${names.length > 0 ? `: ${names.join(' and ')}` : ' identified'}${advisorIdentified ? ` (since ${advisorIdentified})` : ''}`);
    // A tenured or tenure-track CSE advisor (2026-10-04, advisorTttState):
    // the Ph.D., and the MSCSE thesis option (P2-dh-10-5, advisorTttAsked).
    if (advisorTttAsked(ctx)) {
      const ttt = advisorTttState(ctx);
      const rule = ms
        ? 'a thesis advisor must be (§2.3), and the Graduate School requires at least one thesis adviser who is tenured or tenure-track at Notre Dame, or a co-adviser who is (DGS Handbook §10.3.2, §10.3.8)'
        : 'a dissertation director must be (§2.3; Academic Code §6.2.7)';
      if (ttt === 'unanswered') {
        status = 'cannot_evaluate';
        parts.push({ note: `Answer under Milestones whether your ${ms ? 'thesis ' : ''}advisor is tenured or tenure-track CSE faculty — ${rule}` });
      } else if (ttt === 'no') {
        status = 'needs_dgs_review';
        parts.push({ note: `Your ${ms ? 'thesis ' : ''}advisor is not (or you are not sure they are) tenured or tenure-track CSE faculty — ${rule}; ${advisorCasesRule(ms)} — this is in the review request; ask the DGS` });
      }
    }
  } else {
    status = 'unmet';
    // The fact, and what to do about it behind the card's Details (DGS 2026-10-03).
    // Ph.D. (policy review 2026-10-04, P2-dh-3.14-3.20-23; DGS: "Apply
    // suggested handling"): what being without an advisor can lead to — CSE
    // §2.3: "Students who are not under the supervision of a faculty advisor
    // may be subject to dismissal from the program"; DGS Handbook §3.17: "If
    // the student and the DGS are unable to find an adviser, the student may
    // be dismissed from the program." A note; the decision is the DGS's.
    if (ms && ctx.today <= end) parts.push({ note: 'Identify a thesis or project advisor by the end of your first semester (§2.3)' });
    else
      parts.push(
        'No advisor entered yet',
        ms
          ? { note: 'Talk to the DGS; an exception is the DGS’s to grant (§2.3)' }
          : { note: 'Enter your advisor under Milestones. A student who is not under the supervision of a faculty advisor may be subject to dismissal from the program (§2.3; DGS Handbook §3.17) — report any disruption to the DGS at once' },
      );
  }
  return {
    id: 'shared.advisor',
    group: GROUP,
    title: ms ? 'A project or thesis advisor is identified' : 'Under continuous advisor supervision',
    status,
    ...joinedDetail(parts),
    ...(deadline ? { deadline } : {}),
    citation: { section: '§2.3', quote },
  };
}

/** The Application for Admission to Master's Degree Candidacy (policy review
 * 2026-10-04, P2-dh-3.21-3.24-2, -4 and P2-dh-front-1-2-2; DGS: "Apply the
 * suggested fix"). Academic Code §6.1.6: "Admission to candidacy is a
 * prerequisite to receiving any graduate degree. It is the student's
 * responsibility to apply for admission by submitting the appropriate form to
 * the Graduate School office through either the program chair or the director
 * of graduate studies. The applicable deadline is published in the Graduate
 * School calendar." DGS Handbook §3.21.1: "A doctoral student who wishes to
 * receive a master's degree must also apply for admission to master's degree
 * candidacy." An uncounted step, shown once the GPA and credits are in hand —
 * `ready`: for the MSCSE a cumulative GPA at the minimum and 30 credits counting
 * the ones in progress (the application is filed in the semester of
 * graduation, before its grades), for a Ph.D. student the MSCSE along the way
 * met — or once a date is entered; it is in the processing request while open. */
export function msCandidacyApplicationRow(ctx: Ctx, args: { group: string; ready: boolean; alongTheWay: boolean; thesis?: boolean }): RequirementResult | undefined {
  const dated = ctx.student.milestones.msCandidacyApplied;
  if (dated === undefined && !args.ready) return undefined;
  const dates = ctx.rules.parameters.raw.get('candidacy_form_deadlines')?.value.trim();
  const how = `the Grad Admin submits the Graduate School’s Application for Admission to Master’s Degree Candidacy by the Graduate School calendar’s deadline for the semester you graduate in${dates ? ` (${dates})` : ''} — it is in the processing request; enter the date under Milestones once it is submitted`;
  return {
    id: 'shared.msCandidacy',
    group: args.group,
    title: args.alongTheWay ? 'Application for admission to master’s degree candidacy (MSCSE along the way)' : 'Application for admission to master’s degree candidacy',
    shortTitle: 'Master’s candidacy application',
    status: dated !== undefined ? 'met' : 'unmet',
    unscored: true,
    ...joinedDetail(
      dated !== undefined
        ? [`Submitted ${dated}`]
        : [
            'Not submitted yet',
            {
              note: args.alongTheWay
                ? `A Ph.D. student receiving a master’s degree applies for master’s degree candidacy too (DGS Handbook §3.21.1): ${how}`
                : // What is in hand, not "its conditions" (policy review round 3,
                  // P3-dh-10-1): the Code's other condition on the thesis option
                  // is the program's approval of the thesis, tracked in its rows.
                  `Your GPA and credits are in hand — a cumulative GPA of 3.0 or better and 30 credits, counting this semester’s (DGS Handbook §3.21.1)${args.thesis ? '. The Academic Code’s other condition is the program’s approval of your thesis (Academic Code §6.1.6), tracked in the thesis rows above' : ''}: ${how}`,
            },
          ],
    ),
    citation: {
      section: 'Academic Code §6.1.6',
      quote:
        'Admission to candidacy is a prerequisite to receiving any graduate degree. It is the student’s responsibility to apply for admission by submitting the appropriate form to the Graduate School office through either the program chair or the director of graduate studies. The applicable deadline is published in the Graduate School calendar.',
    },
  };
}

/** Who still has to act on a course counted provisionally (DGS 2026-09-07:
 * the row said "Needs DGS review" even when every course was pre-approved and
 * only the Grad Admin had anything left to do, and when the only thing missing
 * was the advisor's approval). The reason strings are written in allocate.ts:
 * a "pre-approved" transfer is DECIDED and waiting to be processed, never a
 * DGS decision; a non-CSE course needs the advisor AND the DGS, so it is
 * listed under both. `advisorSummary` routes the same strings the same way —
 * keep the two in step. */
export type SignOffActor = 'dgs' | 'advisor' | 'gradAdmin' | 'graduateSchool';
/** The dual-degree plan of study's wait (allocate.ts withSharedDegree), and
 * whatever other ask follows it after "; ". */
export const DUAL_PLAN_REASON = /^also counts toward your other degree — the Graduate School must approve your dual-degree plan of study \(DGS Handbook §2\.9\)(?:; ([\s\S]*))?$/;
export function signOffActors(reason: string): SignOffActor[] {
  // The dual-degree plan is the Graduate School's to approve, not the DGS's
  // (policy review round 3, P3-dh-front-1-2-2; DGS Handbook §2.9) — "DGS
  // Handbook" in its citation used to route it to the DGS. A real DGS ask
  // after it keeps its own route.
  const dual = DUAL_PLAN_REASON.exec(reason);
  if (dual) return dual[1] ? signOffActors(dual[1]) : ['graduateSchool'];
  // (A course the DGS has decided carries no pending reason — its `yes` or its
  // tick settles it, allocate.ts — so no reason here belongs to the Grad
  // Admin; the advisor summary reads the processing request's transfer list
  // instead, P3-emails-1.)
  const actors: SignOffActor[] = [];
  if (/advisor/i.test(reason)) actors.push('advisor');
  if (/DGS|rules sheet/i.test(reason)) actors.push('dgs');
  return actors.length > 0 ? actors : ['dgs'];
}

/** Advisory row aggregating every course that still needs a human sign-off
 * (dgs_approval rows, unknown courses, free-text non-CSE, transfers). */
export function approvalsRow(ctx: Ctx): RequirementResult {
  // A course the review request still asks about — a `yes` transfer whose
  // §4.4.1 core area is unrecorded — belongs here too, though nothing is
  // pending on its line (2026-09-27: a `yes` counts outright).
  const stillWithDgs = new Set(coursesNeedingDgsReviewFor(ctx.classified, ctx.student).map((p) => p.course.entry.courseId));
  const pending = ctx.classified.filter((c) => !c.superseded && c.pool !== 'none' && (c.approvalPending !== undefined || stillWithDgs.has(c.entry.courseId)));
  // §3.2/§4.2: "All courses taken by a student must have the approval of their
  // advisor." — self-attested via the plan-of-study checkbox (decision Q21).
  const planUnconfirmed =
    ctx.student.courses.length > 0 && ctx.student.attestations.advisorApprovedPlan !== true;
  // Group by WHO must act, so the row's status is honest: only a course the
  // DGS has yet to decide makes this "Needs DGS review" (DGS 2026-09-07).
  // The groups are MUTUALLY EXCLUSIVE — a course needing two people is listed
  // once, under a lead naming both — so no course is printed twice.
  // A pre-approved transfer whose §4.4.1 core area the DGS has not recorded is
  // still in the review request (review.ts), so it belongs to the DGS too: the
  // reason string alone cannot tell, hence the second source here.
  const ACTOR_ORDER = ['advisor', 'dgs', 'gradAdmin', 'graduateSchool'] as const;
  const reasonOf = (c: (typeof pending)[number]): string => c.approvalPending ?? 'the DGS has still to record its core-knowledge area (§4.4.1)';
  const actorsOf = (c: (typeof pending)[number]): SignOffActor[] => {
    const actors = new Set<SignOffActor>(signOffActors(reasonOf(c)));
    if (stillWithDgs.has(c.entry.courseId)) actors.add('dgs');
    return ACTOR_ORDER.filter((a) => actors.has(a));
  };
  const LEADS: Record<string, string> = {
    dgs: 'The DGS has still to decide these — send the review request',
    advisor: 'Your advisor has still to approve these',
    gradAdmin: 'Already decided by the DGS — the Grad Admin has still to process these',
    'advisor,dgs': 'Your advisor and the DGS must both approve these — send the review request',
    'dgs,gradAdmin': 'The transfer is approved — the Grad Admin processes it, and the DGS has still to record the core-knowledge area',
    'advisor,dgs,gradAdmin': 'Your advisor, the DGS and the Grad Admin each have something left to do with these',
    // P3-dh-front-1-2-2: the whole plan, approved by the Graduate School.
    graduateSchool: 'Waiting for the Graduate School’s approval of your dual-degree plan of study — tick it under Approvals you already have once it is approved',
  };
  const groups = new Map<string, typeof pending>();
  for (const c of pending) {
    const key = actorsOf(c).join(',');
    const list = groups.get(key);
    if (list) list.push(c);
    else groups.set(key, [c]);
  }
  const anyDgs = [...groups.keys()].some((key) => key.split(',').includes('dgs'));
  const status = anyDgs ? 'needs_dgs_review' : groups.size > 0 || planUnconfirmed ? 'in_progress' : 'not_applicable';
  const parts: DetailPart[] = [];
  // The page's version (DGS 2026-10-03: the card shows what waits on whom; the
  // reasons and the instructions sit behind its Details). The copied messages
  // keep `parts`, with each reason beside its courses.
  const pageParts: DetailPart[] = [];
  const pageNotes: DetailPart[] = [];
  // {lead, items} → the report renders one nested bullet per course
  // (DGS request 2026-09-04); the prose flattens to the same sentence.
  for (const key of ['dgs', 'advisor,dgs', 'advisor', 'dgs,gradAdmin', 'advisor,dgs,gradAdmin', 'gradAdmin', 'graduateSchool']) {
    const list = groups.get(key);
    if (list === undefined || list.length === 0) continue;
    // One item per REASON, the courses that share it listed together
    // (clarity review 2026-09-26): four transfers with the same 40-word
    // reason used to print it four times. advisor-summary.ts splits the
    // course list back up.
    const byReason = new Map<string, string[]>();
    for (const c of list) byReason.set(reasonOf(c), [...(byReason.get(reasonOf(c)) ?? []), c.entry.courseId]);
    parts.push({ lead: LEADS[key]!, items: [...byReason].map(([reason, ids]) => `${ids.join(', ')} (${reason})`) });
    pageParts.push({ lead: LEADS[key]!, items: [...byReason].map(([, ids]) => ids.join(', ')) });
    for (const [reason, ids] of byReason) pageNotes.push({ note: `${ids.join(', ')}: ${reason}` });
  }
  // "tick the box", not "the attestation": the student never sees that word —
  // the card is "Approvals you already have" (trim review 2026-09-18, P-55).
  // advisor-summary.ts REWRITES re-voices the first sentence; keep in step.
  const instructions: DetailPart[] = [];
  if (planUnconfirmed) {
    // "coursework", not "plan of study" (DGS 2026-10-08); advisor-summary.ts reads this sentence.
    instructions.push({ note: `Confirm your advisor approved your coursework (${ctx.student.program === 'mscse' ? '§3.2' : '§4.2'}) and tick the box below the milestones` });
  }
  // Only when a course waits on the DGS: a list that waits only on the
  // Graduate School's plan approval, or only on the advisor, has no DGS
  // answer to tick (P3-dh-front-1-2-2).
  if (anyDgs) instructions.push({ note: 'When the DGS answers, tick the box next to each course it approved for you' });
  parts.push(...instructions);
  pageParts.push(...pageNotes, ...instructions);
  // Courses a tick cleared stay named here (P1-levels-grades-credits-30,
  // 2026-10-03): the approval is the student's own word; the DGS office
  // holds the record.
  const ticked = ctx.classified.filter((c) => !c.superseded && c.pool !== 'none' && c.tickApproved).map((c) => c.entry.courseId);
  const tickedNote = ticked.length > 0 ? ` Approved by the DGS, as you ticked: ${ticked.join(', ')} — the DGS office holds the record.` : '';
  const joined = parts.length === 0 ? { detail: `No entered course that counts toward the degree is waiting on anyone.${tickedNote}` } : joinedDetail(parts);
  return {
    id: 'shared.approvals',
    group: 'Approvals',
    title: 'Courses still to be approved or processed',
    status,
    informational: true,
    ...joined,
    ...(pageNotes.length > 0 ? { shortDetailParts: pageParts } : {}),
    citation: {
      // The degree's own section only (DGS 2026-09-11: no §4 on the MSCSE tab).
      section: ctx.student.program === 'mscse' ? '§3.2/§5.2' : '§4.2/§5.2',
      quote: 'All courses taken by a student must have the approval of their advisor.',
    },
  };
}

/** Academic Code §2.2 (policy review 2026-10-04, P2-ac-1-3-2): "No more than
 * nine credit hours of classes from any one master's degree may be counted
 * toward any other graduate degree." DGS Handbook §2.9: "No more than nine
 * credit hours from any one master's degree can count towards any other
 * master's degree. The plan must then be approved by the Graduate School."
 * For a student enrolled in a second Notre Dame program at the same time, the
 * courses ticked as also counting toward it draw on these nine credits. The
 * nine is the Graduate School's, so it lives in code
 * (DUAL_DEGREE_SHARED_CREDITS_MAX), never in the Parameters tab. The row
 * appears only for a student with such a course; it reads Conditionally met
 * while the dual plan of study still waits for the Graduate School. */
export function otherDegreeCapRow(ctx: Ctx, args: { id: string; group: string }): RequirementResult | undefined {
  if (!ctx.classified.some((c) => c.caps.includes('otherdegree'))) return undefined;
  const approved = ctx.student.attestations.dualPlanApproved === true;
  return capRow({
    id: args.id,
    group: args.group,
    title: `At most ${DUAL_DEGREE_SHARED_CREDITS_MAX} credits shared with your other degree`,
    capId: 'otherdegree',
    capLabel: 'credits shared with your other degree',
    limitKey: 'DUAL_DEGREE_SHARED_CREDITS_MAX',
    section: 'Academic Code §2.2; DGS Handbook §2.9',
    quote:
      'No more than nine credit hours of classes from any one master’s degree may be counted toward any other graduate degree. (Academic Code §2.2) — No more than nine credit hours from any one master’s degree can count towards any other master’s degree. The plan must then be approved by the Graduate School. (DGS Handbook §2.9)',
    ctx,
    approvalDriven: true,
    extraDetail: [
      `The courses you ticked as also counting toward your other degree: at most ${DUAL_DEGREE_SHARED_CREDITS_MAX} of their credits count here, and any beyond that count toward nothing for this degree. They still count as registrations toward each semester’s full-time status (Academic Code §3.5)`,
      ...(approved
        ? []
        : ['They wait for the Graduate School’s approval of your dual-degree plan of study (DGS Handbook §2.9). Once it is approved, tick it under Approvals you already have']),
    ],
  });
}
