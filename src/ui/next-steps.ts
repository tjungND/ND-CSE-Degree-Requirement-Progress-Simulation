// The "Next steps" a record calls for, read off the report and the record
// (DGS 2026-09-27, clarity proposal 1: "1 is fine"). Until then the import's
// outcome existed only as a four-second toast, "Needs your attention" listed
// credit thresholds nobody could act on today, and the one thing waiting —
// the review request — appeared only in the Approvals row at the end of the
// report. String building only, no DOM; report.ts renders the result under
// the dial and in the phone summary. Every "DGS" here is a bare token so the
// page's ADGS rewrite applies on the M.S. tab.
import { termLabel } from '../engine/term.ts';
import type { AuditReport, CourseLine, Student } from '../engine/types.ts';
import { completeBackground } from './background.ts';
import { plural } from './email-html.ts'; // the one plural (W9, 2026-10-22): this file had a copy

/** Each step's identity, the same from one render to the next whatever its
 * text says (DGS 2026-10-17: "after student completes each step, highlight
 * the next things to do"): a key that was on the list and is gone is a step
 * the student finished, and next-step.ts highlights the one after it. In the
 * order the steps are listed. */
export const STEP_KEYS = ['standing.entry', 'standing.check', 'grades.update', 'earlier-degrees', 'coursework.degrees', 'review.send', 'advisor.faculty', 'dual-plan', 'advisor.name', 'advisor.tenure', 'advisor.approved', 'thesis.topic', 'review.wait', 'processing.send', 'ms-candidacy', 'incomplete', 'graduation', 'advisor-summary', 'simulation'] as const;
export type StepKey = (typeof STEP_KEYS)[number];

export interface NextStep {
  key: StepKey;
  /** Nothing to do on the page until someone else acts (the Graduate
   * School's approval, the DGS's answer) — never highlighted as the next
   * step. */
  waiting?: true;
  text: string;
  /** The place on the page where the step is done, as a fragment link. */
  href?: string;
  /** Requirement rows this step already says everything about — the
   * attention list leaves them out rather than list them twice. */
  covers?: string[];
}

export interface NextStepsInput {
  report: AuditReport;
  student: Student;
  /** Courses the DGS still has to act on — the review card's list, split
   * (DGS 2026-09-27): not in the course rules yet (the DGS enters them),
   * or listed as case by case (the DGS decides for this student). */
  review: { unlisted: number; caseByCase: number; /** Every course in it is earlier coursework (from before this program). */ earlierOnly?: boolean };
  /** Items the Grad Admin could process now — the processing request's count. */
  processingCount: number;
  /** Courses waiting for the student's answer — which degrees they already
   * counted toward (UI review, 2026-10-08). */
  needsAnswer?: string[];
  /** Simulation mode (DGS 2026-10-09: "no DGS request, grad admin request,
   * or advisor report should be possible"): true while the mode is on. The
   * steps that send something — the review request, the processing request,
   * what follows the DGS's answer, the candidacy application, the advisor
   * summary — are folded into ONE "nothing is sent" step that carries the
   * union of their `covers`, so the attention list below reads the same. */
  simulation?: boolean;
}

/** The advisor summary's step — a constant so the simulation fold can tell
 * it apart (it is the one step without a place on the page). */
const ADVISOR_SUMMARY_STEP = 'Send the summary to your advisor whenever you like.';

/** The simulation's one step in place of every step that sends something
 * (D7): the first of them keeps its place in the list, the rest go, and the
 * union of their `covers` stays so attentionRows is unchanged. Nothing to
 * fold → the list as it is. */
function foldSentSteps(steps: NextStep[], dgs: { count: number; allCourses: boolean }, processingCount: number): NextStep[] {
  const sends = (s: NextStep): boolean => s.href === '#dgs-review' || s.href === '#grad-admin' || s.text === ADVISOR_SUMMARY_STEP;
  const first = steps.findIndex(sends);
  if (first < 0) return steps;
  const covers = [...new Set(steps.filter(sends).flatMap((s) => s.covers ?? []))];
  const before = dgs.count > 0 ? `${plural(dgs.count, dgs.allCourses ? 'course' : 'item')} before the DGS` : '';
  const toRecord = processingCount > 0 ? `${plural(processingCount, 'item')} before the Grad Admin` : '';
  const text =
    before && toRecord
      ? `In simulation mode nothing is sent: this plan would put ${before} and ${toRecord}.`
      : before || toRecord
        ? `In simulation mode nothing is sent: this plan would put ${before || toRecord}.`
        : 'In simulation mode nothing is sent — no request or summary goes out from a plan.';
  const href = dgs.count > 0 ? '#dgs-review' : processingCount > 0 ? '#grad-admin' : undefined;
  const folded: NextStep = { key: 'simulation', waiting: true, text, ...(href ? { href } : {}), ...(covers.length > 0 ? { covers } : {}) };
  return [...steps.slice(0, first), folded, ...steps.slice(first + 1).filter((s) => !sends(s))];
}

/** The review request's advisor item (shared.ts advisorReviewFlag): the
 * advisor step names it, so the count of other items leaves it out. */
export const ADVISOR_FLAG = /^(?:Thesis advisor|Advisor)’s faculty status:/;

/** Every scored requirement met outright — the moment the semester of
 * graduation is the next thing (the headline's own count). */
export function allRequirementsMet(report: AuditReport): boolean {
  return report.summary.scored > 0 && report.summary.met === report.summary.scored;
}

/** Academic Code §3.7 and DGS Handbook §3.23.1, as a step. */
export const GRADUATION_SEMESTER_STEP =
  'Register for at least one credit hour (a zero-credit course in a summer session) and complete ND Roll Call in the semester you graduate (Academic Code §3.7; DGS Handbook §3.23.1).';

/** The reason after "not counted — ", cut at the first semicolon: the line's
 * own words, never re-summarised. */
function reasonOf(line: CourseLine): string {
  const m = /^not counted(?: yet)? — ([^;]+)/.exec(line.text);
  return m ? m[1]!.trim() : 'see its line';
}

/** "Your coursework: 5 courses count now, 1 is in progress, 4 are waiting for
 * the DGS (…), 1 does not count (…)." — from the course lines' marks. */
export function courseworkSentence(report: AuditReport, needsAnswer: readonly string[] = []): string | undefined {
  const lines = report.courseLines;
  if (lines.length === 0) return undefined;
  const by = (mark: CourseLine['mark']) => lines.filter((l) => l.mark === mark);
  const parts: string[] = [];
  const counts = by('counts').length;
  if (counts > 0) parts.push(`${plural(counts, 'course')} count${counts === 1 ? 's' : ''} now`);
  const inProgress = by('in_progress').length;
  if (inProgress > 0) parts.push(`${inProgress} ${inProgress === 1 ? 'is' : 'are'} in progress`);
  // A pending course that waits for the student's answer says so (UI review,
  // 2026-10-08: "waiting for the DGS" left the student waiting).
  const pendingAll = by('pending');
  // A "not counted yet — …" line always waits on the student's own input.
  const waitsOnStudent = (l: CourseLine): boolean => needsAnswer.includes(l.courseId) || /^not counted yet/.test(l.text);
  const yours = pendingAll.filter(waitsOnStudent);
  const pending = pendingAll.filter((l) => !waitsOnStudent(l));
  if (yours.length > 0) parts.push(`${yours.length} need${yours.length === 1 ? 's' : ''} your answer (${yours.map((l) => l.courseId).join(', ')})`);
  if (pending.length > 0) parts.push(`${pending.length} ${pending.length === 1 ? 'is' : 'are'} waiting for the DGS (${pending.map((l) => l.courseId).join(', ')})`);
  const excluded = by('excluded');
  if (excluded.length > 0) {
    // Up to three with their reasons; more than that, the ids alone.
    const what = excluded.length <= 3 ? excluded.map((l) => `${l.courseId} — ${reasonOf(l)}`).join('; ') : `${excluded.map((l) => l.courseId).join(', ')} — each line says why`;
    parts.push(`${excluded.length} ${excluded.length === 1 ? 'does' : 'do'} not count (${what})`);
  }
  return `Your coursework: ${parts.join(', ')}.`;
}

/** The steps, each only when it applies, in the order a student takes them. */
export function nextSteps(input: NextStepsInput): NextStep[] {
  const { report, student, review, processingCount } = input;
  const steps: NextStep[] = [];
  const hasCourses = student.courses.length > 0;
  // 1. What the transcript set and the student has not yet confirmed.
  const settings: string[] = [];
  // A Ph.D. student who finished the Notre Dame MSCSE first: the term read is
  // the MSCSE's, and the step names the action (UI review, 2026-10-08).
  const inferred = student.entryTermInferred;
  const earlierGraduate = (student.background ?? student.backgroundDraft)?.graduate;
  const heldMscseReading = student.program === 'phd' && inferred !== undefined && inferred.how !== 'assumed' && !/admit-term|admission/.test(inferred.how) && (earlierGraduate === 'nd-mscse' || earlierGraduate === 'nd-4plus1');
  // A move into CSE from an UNFINISHED program in another Notre Dame
  // department (UI review item 11; DGS 2026-10-09: option (b)): the term read
  // is the first CSE term; the transfer keeps the earlier program's clock, so
  // the step names its first term, read from the transcript.
  const earlierBackground = student.background ?? student.backgroundDraft;
  const unfinishedOther = inferred?.alternative?.otherProgram === true && earlierBackground?.graduate === 'nd-other' && earlierBackground.finished === false;
  // Only readings the page can confirm go in the check step (blue-team review
  // 2026-10-17, U4): a fresh record's entry term is ASSUMED (state.ts), not
  // read, and the card offers no "Looks right" for it — so it is its own
  // "set it" step; a bachelor's known only to be BEFORE a term (the standalone
  // master's, DGS 2026-09-20) has nothing to confirm, and its "Set the exact
  // semester" is optional; a Ph.D. reading whose "Looks right" waits for the
  // earlier-degrees answer (app.ts, UI review 2026-10-08) is said to wait.
  let entryWithheld = false;
  if (heldMscseReading) steps.push({ key: 'standing.entry', text: `Set the semester you entered the Ph.D. (Your standing) — ${termLabel(student.entryTerm)}, read from your transcript, is your MSCSE’s first semester.`, href: '#standing' });
  else if (unfinishedOther && inferred?.alternative) steps.push({ key: 'standing.entry', text: `Set the semester you entered your earlier Notre Dame program (Your standing) — ${termLabel(student.entryTerm)}, read from your transcript, is your first CSE semester; a move from an unfinished program keeps that program’s clock, and your transcript shows ${termLabel(inferred.alternative.term)} (DGS Handbook §3.15).`, href: '#standing' });
  else if (inferred?.how === 'assumed') steps.push({ key: 'standing.entry', text: `Set the semester you entered the program under Your standing — ${termLabel(student.entryTerm)} is only assumed.`, href: '#standing' });
  else if (inferred) {
    // The same condition app.ts puts on the entry term's "Looks right".
    if (student.program === 'phd' && student.background === undefined && !/admit-term|admission/.test(inferred.how)) entryWithheld = true;
    else settings.push(`first semester ${termLabel(student.entryTerm)}`);
  }
  if (student.bachelorsAwardedInferred && student.bachelorsAwarded && !student.bachelorsAwardedInferred.before) settings.push(`bachelor’s degree ${termLabel(student.bachelorsAwarded)}`);
  if (settings.length > 0) steps.push({ key: 'standing.check', text: `Check what your transcript set — ${settings.join(', ')} (Your standing)${entryWithheld ? ' — the entry term is checked after you answer the earlier-degrees questions' : ''}.`, href: '#standing' });
  // Courses still "In progress" in a semester that has ended (blue-team
  // review 2026-10-17, U21): the engine's warning (allocate.ts
  // staleInProgressSentence), as ONE step with its place on the page — the
  // Transcripts card's "Import again", which next-step.ts rings, or the
  // course's own grade under Coursework. In simulation mode the imports are
  // inert (DGS 2026-10-09), and a group with no Notre Dame course has no
  // transcript to import again: the grade path alone, linked to Coursework.
  const stale = report.staleInProgress ?? [];
  if (stale.length > 0) {
    const ids = stale.flatMap((g) => g.courseIds);
    const terms = stale.map((g) => termLabel(g.term));
    const one = ids.length === 1;
    const importAgain = !input.simulation && stale.some((g) => g.nd);
    const fix = `set ${one ? 'its' : 'each course’s'} grade under Coursework`;
    steps.push({
      key: 'grades.update',
      text: `${terms.length === 1 ? terms[0] : `${terms.slice(0, -1).join(', ')} and ${terms[terms.length - 1]}`} ${terms.length === 1 ? 'has' : 'have'} ended and ${ids.join(', ')} still ${one ? 'reads' : 'read'} In progress — ${importAgain ? `import your updated Notre Dame transcript (Import again, in the Transcripts card) or ${fix}` : fix}.`,
      href: importAgain ? '#transcripts' : '#coursework',
    });
  }
  // The earlier-degrees questions, asked on the page since 2026-10-08 (DGS,
  // Option 1: the opening dialog asks only the program).
  // Every question answered but not confirmed (the transcripts filled them):
  // the step is to check them and click Done (review of Option 1, 2026-10-08).
  if (student.background === undefined)
    steps.push({
      key: 'earlier-degrees',
      text:
        completeBackground(student.backgroundDraft, student.program) !== undefined
          ? 'Check the answers about your earlier degrees in the Transcripts card and click Done — they decide which earlier transcripts to add and how §5.2 applies to them.'
          : 'Answer the questions about your earlier degrees in the Transcripts card — they decide which earlier transcripts to add and how §5.2 applies to them.',
      href: '#earlier-degrees',
      // While the review holds only earlier coursework, the transfer and
      // approvals rows wait on this answer too (UI review, 2026-10-08).
      ...(review.earlierOnly ? { covers: ['shared.approvals', 'phd.transfer', 'ms.transfer'] } : {}),
    });
  // The courses waiting for the student's own answer (UI review, 2026-10-08;
  // a missing input stays on the list, DGS 2026-09-27).
  const asked = input.needsAnswer ?? [];
  if (asked.length > 0) {
    const ids = asked.length === 1 ? asked[0]! : `${asked.slice(0, -1).join(', ')} and ${asked[asked.length - 1]!}`;
    steps.push({ key: 'coursework.degrees', text: `Say which degrees ${ids} already counted toward — next to ${asked.length === 1 ? 'the course' : 'each course'} under Coursework; if you are not sure, ask the DGS.`, href: '#coursework' });
  }
  // 2. The decisions the DGS has to make — the courses, two kinds (DGS
  // 2026-09-27); since policy review round 3 (P3-cse-1-2-2, DGS 2026-10-06)
  // also an advisor whose faculty status needs the DGS's approval and the
  // review request's other items (report.reviewFlags: a readmission, the
  // thesis readers, an extension …). Said as one step, so "Send the review
  // request" is never on the list twice. Courses alone keep the 2026-09-27
  // sentences.
  const reviewCount = review.unlisted + review.caseByCase;
  const advisor = report.requirements.find((r) => r.id === 'shared.advisor');
  const thesis = report.program === 'mscse';
  const advisorToDgs = advisor?.status === 'needs_dgs_review';
  const otherItems = (report.reviewFlags ?? []).filter((f) => !(advisorToDgs && ADVISOR_FLAG.test(f))).length;
  // Only earlier coursework, before the earlier degrees are answered: the
  // answer comes first and can change the list (UI review, 2026-10-08) — the
  // "Answer the questions" step is already above.
  // The advisor has its own step since P4-phd-6, so a "no" there no longer
  // skips the wait (round 5, item 26; DGS 2026-10-14).
  const waitsForEarlierDegrees = student.background === undefined && review.earlierOnly === true && otherItems === 0;
  if ((reviewCount > 0 || otherItems > 0) && !waitsForEarlierDegrees) {
    let text: string;
    if (otherItems === 0)
      text =
        review.unlisted > 0 && review.caseByCase > 0
          ? `Send the review request: ${plural(review.unlisted, 'course')} ${review.unlisted === 1 ? 'is' : 'are'} not in the course rules yet, and ${review.caseByCase} need${review.caseByCase === 1 ? 's' : ''} the DGS’s approval for you.`
          : review.unlisted > 0
            ? `Send the review request for ${plural(review.unlisted, 'course')} not in the course rules yet — the DGS enters ${review.unlisted === 1 ? 'it' : 'them'}.`
            : `Send the review request for ${plural(review.caseByCase, 'course')} that need${review.caseByCase === 1 ? 's' : ''} the DGS’s approval for you.`;
    else {
      const parts = [
        ...(review.unlisted > 0 ? [`${plural(review.unlisted, 'course')} ${review.unlisted === 1 ? 'is' : 'are'} not in the course rules yet`] : []),
        ...(review.caseByCase > 0 ? [`${plural(review.caseByCase, 'course')} need${review.caseByCase === 1 ? 's' : ''} the DGS’s approval for you`] : []),
      ];
      parts.push(`${otherItems} ${parts.length > 0 ? 'other ' : ''}item${otherItems === 1 ? ' needs' : 's need'} the DGS’s decision`);
      text = `Send the review request: ${parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`}.`;
    }
    // The transfer and approvals rows are this step's only while it carries
    // courses.
    const covers = reviewCount > 0 ? ['phd.transfer', 'ms.transfer', 'shared.approvals'] : [];
    steps.push({ key: 'review.send', text, href: '#dgs-review', ...(covers.length > 0 ? { covers } : {}) });
  }
  // An advisor who is not tenured or tenure-track CSE faculty: the card's two
  // cases, each with its own remedy (policy review round 4, P4-phd-6; DGS
  // 2026-10-12: "apply the suggested handling"). The answer "no" cannot tell
  // them apart, so the step gives both: tenured or tenure-track in another
  // Notre Dame department → the DGS's approval, through the review request
  // (§2.3); not tenured or tenure-track → a tenured or tenure-track
  // co-advisor, with no exception (department policy of 2026-10-07). It used
  // to be one review-request step for both, the wrong remedy for the second.
  if (advisorToDgs)
    steps.push({
      key: 'advisor.faculty',
      text: `Your ${thesis ? 'thesis ' : ''}advisor is not tenured or tenure-track CSE faculty (or you are not sure): if they are tenured or tenure-track in another Notre Dame department, ${input.simulation ? 'the DGS approves them' : 'send the review request for the DGS’s approval'}; if not, add a tenured or tenure-track co-advisor under Milestones (§2.3; department policy).`,
      href: '#milestones',
      covers: ['shared.advisor'],
    });
  // The dual-degree plan of study (P3-dh-front-1-2-2; DGS Handbook §2.9): the
  // Graduate School approves it, and the tick under Approvals records it.
  const dualWaiting = report.requirements.some((r) => r.id === 'shared.approvals' && (r.detailParts ?? []).some((p) => typeof p === 'object' && 'lead' in p && /^Waiting for the Graduate School’s approval of your dual-degree plan of study/.test(p.lead)));
  if (dualWaiting) steps.push({ key: 'dual-plan', waiting: true, text: 'Once the Graduate School approves your dual-degree plan of study, tick it under Approvals you already have (DGS Handbook §2.9).', href: '#milestones' });
  // 3. The advisor, and the plan-of-study box — neither waits for the DGS.
  // The step says what the advisor card says (P3-cse-1-2-2): no advisor on
  // file → enter the name; a name on file but the faculty-status question
  // unanswered → answer it (since 2026-10-04 the card is not met then either,
  // and "Enter your advisor’s name" told a student who had done so to do it
  // again); a status the DGS must approve → its own step above (P4-phd-6).
  if (advisor?.status === 'unmet') steps.push({ key: 'advisor.name', text: 'Enter your advisor’s name under Milestones.', href: '#milestones', covers: ['shared.advisor'] });
  else if (advisor?.status === 'cannot_evaluate')
    steps.push({ key: 'advisor.tenure', text: `Answer under Milestones whether your ${thesis ? 'thesis ' : ''}advisor is tenured or tenure-track CSE faculty (§2.3).`, href: '#milestones', covers: ['shared.advisor'] });
  if (hasCourses && !student.attestations.advisorApprovedPlan) steps.push({ key: 'advisor.approved', text: 'Confirm your advisor approved your coursework and tick the box under Approvals.', href: '#milestones' });
  // The MSCSE thesis topic (policy review round 3, P3-emails-4 (3); DGS
  // 2026-10-07: option (a)) — the step the advisor email's to-do already
  // carries (Academic Code §6.1.7: "With the approval of his or her advisor,
  // the student proposes a thesis topic for program approval"), so a student
  // who reads only the page does not miss it.
  const topic = report.requirements.find((r) => r.id === 'ms.thesis.topic');
  if (topic !== undefined && topic.status !== 'met')
    steps.push({ key: 'thesis.topic', text: 'Propose your thesis topic, with your advisor’s approval, for the program’s approval (Academic Code §6.1.7).', href: '#milestones', covers: ['ms.thesis.topic'] });
  // 4. After the DGS answers; and what the Grad Admin can already record.
  const approvals = report.requirements.find((r) => r.id === 'shared.approvals');
  if (!waitsForEarlierDegrees && (approvals?.status === 'needs_dgs_review' || reviewCount > 0)) steps.push({ key: 'review.wait', waiting: true, text: 'When the DGS answers, come back to this page — it reads the latest course rules — and tick the box next to each course approved for you; then send the processing request, and the Grad Admin records it.', href: '#grad-admin', covers: ['shared.approvals'] });
  if (processingCount > 0) steps.push({ key: 'processing.send', text: `Send the processing request (${plural(processingCount, 'item')}) — the Grad Admin records it.`, href: '#grad-admin' });
  // The master's candidacy application, once its conditions are in hand
  // (Academic Code §6.1.6 — policy review 2026-10-04, P2-dh-front-1-2-2).
  if (report.requirements.some((r) => r.id === 'shared.msCandidacy' && r.status === 'unmet'))
    steps.push({
      key: 'ms-candidacy',
      text: 'Ask the Grad Admin to submit your Application for Admission to Master’s Degree Candidacy by the Graduate School calendar’s deadline for the semester you graduate in — it is in the processing request (Academic Code §6.1.6).',
      href: '#grad-admin',
      covers: ['shared.msCandidacy'],
    });
  // 5. Once every requirement is met: what the Graduate School checks in the
  // semester of graduation, which no row shows (policy review 2026-10-03,
  // P1-residency-enrollment-c6). Academic Code §3.7: "Degree students must
  // register and complete the ND Roll Call process during the semester in
  // which they plan to graduate; this includes the summer session." DGS
  // Handbook §3.23.1: "at least one credit hour during the semester of
  // graduation (or for a zero-credit course, during the summer session)".
  // With the semester named (2026-10-04, P2-dh-3.21-3.24-24): no course of at
  // least one credit entered for it is a step at any time; registered, the
  // Roll Call reminder once everything is met.
  const g = report.graduation;
  // An I in that semester comes first (P3-dh-3.1-3.13-3; DGS Handbook
  // §3.23.1): no "you are registered for it" as if the student were clear.
  const gradIncompletes = g?.incompletes ?? [];
  if (g !== undefined && gradIncompletes.length > 0)
    steps.push({ key: 'incomplete', text: `Have the I in ${gradIncompletes.join(', ')} made final before your degree is conferred — the Graduate School confers it only with no I grades in ${termLabel(g.term)}, the semester you graduate; otherwise move your graduation semester (DGS Handbook §3.23.1).` });
  if (g !== undefined && !g.registered)
    steps.push({ key: 'graduation', text: `Register for at least one credit hour in ${termLabel(g.term)}${g.term.season === 'summer' ? ' (a zero-credit course is enough in a summer session)' : ''} and complete ND Roll Call — the Graduate School confers your degree only then (Academic Code §3.7; DGS Handbook §3.23.1).` });
  else if (allRequirementsMet(report) && gradIncompletes.length === 0)
    steps.push({ key: 'graduation', text: g !== undefined ? `Complete ND Roll Call in ${termLabel(g.term)}, the semester you graduate — you are registered for it (Academic Code §3.7).` : GRADUATION_SEMESTER_STEP });
  // 6. The advisor summary, any time.
  if (hasCourses) steps.push({ key: 'advisor-summary', text: ADVISOR_SUMMARY_STEP });
  // Simulation mode (D7): the sending steps become one "nothing is sent"
  // step naming what the plan would put before the DGS (the review card's
  // courses, plus the advisor and the other items when there are any) and
  // before the Grad Admin (the processing request's count).
  if (input.simulation) return foldSentSteps(steps, { count: reviewCount + (advisorToDgs ? 1 : 0) + otherItems, allCourses: !advisorToDgs && otherItems === 0 }, processingCount);
  return steps;
}

/** The nearest deadline still ahead, as its own chip label — for the "nothing
 * to do right now" state. */
export function nearestDeadline(report: AuditReport): string | undefined {
  const ahead = report.requirements
    .filter((r) => r.deadline && (r.deadline.state === 'upcoming' || r.deadline.state === 'due_soon'))
    .sort((a, b) => (a.deadline!.date < b.deadline!.date ? -1 : 1));
  const first = ahead[0];
  return first ? `${first.shortTitle ?? first.title}: ${first.deadline!.label}` : undefined;
}
