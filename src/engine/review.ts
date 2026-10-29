// Which courses still need a DGS decision — and why. Moved out of the "Ask
// the DGS to review" card (2026-09-06 evening) so the rule is one pure
// function with a test matrix (tests/review-pending.test.ts).
//
// The DGS's rulings for courses from other universities live in the
// ExternalCourses tab. A row there is a DECISION only where its cells say
// something: `transferable` (yes / no) decides the §5.2 part, and
// `satisfies_core_area` (a core area, or `none`) decides the §4.4.1 part.
// `transferable = dgs_approval` (DGS 2026-09-08) is a decision about the
// COURSE — outside the usual CSE ground, transferable when it serves the
// dissertation — but not about this student, so such a course stays in the
// request until the DGS has ruled on their case. A
// row pasted straight from the review request — both cells still blank — is
// not a decision yet, and the course stays in the request. (The card used to
// treat any row as "ruled" and dropped such courses for good — the DGS's
// "the card disappears and never reappears until the courses are re-added".)
//
// §4.4.1: the core-knowledge courses may have been passed "either at Notre
// Dame or at their previous institution" — undergraduate or graduate — once
// the DGS confirms the course. §5.2 criterion 5: "the transfer is recommended
// by the DGS and approved by the Graduate School."
import { BS_SHARED_CREDITS_MAX, bachelorsSixSpent, spentOnBachelorsAndMasters } from './allocate.ts';
import { termIndex } from './term.ts';
import { isNotreDameInstitution, needsApproval } from '../data/external.ts';
import type { Rules } from '../data/types.ts';
import { classify, levelOf, type ClassifiedCourse } from './allocate.ts';
import { decisionWording, needsCourseApproval } from './decider.ts';
import { CORE_TITLE_RE } from './core-title.ts';
import { isPassed, passesCreditFloor } from './grades.ts';
import { transferRecordedFor } from './transfer-recorded.ts';
import type { Student } from './types.ts';

/** What the review request asks the DGS to do about one course (DGS
 * 2026-09-28: the request now says which items need a reply). */
export interface ReviewAsk {
  /** The course has no row in the sheet: the DGS enters one. */
  needsRow: boolean;
  /** The DGS must answer THIS student — a course decided case by case, a
   * §5.2 recommendation, an allowance approval. Entering or completing a
   * sheet row needs no reply: the page reads the rules on its next visit. */
  replyNeeded: boolean;
  /** The decisions, as the sheet's own columns or the answer wanted:
   * "counts toward the Ph.D.: yes / no / case by case". */
  decide: string[];
  /** The part of `decide` that is a ruling for THIS student — a readmission,
   * a lapsed Incomplete, a UG→GR move, a case-by-case approval, an S grade …
   * — which no sheet cell can hold (policy review round 3, P3-emails-2; DGS
   * 2026-10-06: "apply the suggested handling"). The rest are sheet
   * questions. Tagged by identity, not wording: everything that is not one of
   * the sheet's own questions. Absent when there is none; `replyNeeded`
   * follows it. */
  rulings?: string[];
}

export interface PendingDgsReview {
  course: ClassifiedCourse;
  /** Program coursework at Notre Dame; Notre Dame coursework from before the
   * entry term (asked about as a Notre Dame course); a course from another
   * university. */
  kind: 'nd' | 'priorNd' | 'external';
  /** "Why it needs a decision" — the card line and the request's last column. */
  reason: string;
  /** Needs a NEW sheet row: no Courses-tab row (a Notre Dame course — CSE or
   * not), or no ExternalCourses row. A course with a row needs a decision in
   * that row, not another row. */
  unlisted: boolean;
  ask: ReviewAsk;
  /** A graduate course from an earlier Notre Dame program with no
   * ExternalCourses row (policy review round 3, P3-dh-10-2; DGS 2026-10-06):
   * its §5.2 transfer decision is a row the DGS enters under UNIVERSITY OF
   * NOTRE DAME (DECISIONS 2026-09-05), so the request asks for that row in its
   * "enter in the course rules" list — no email reply — and the page reads it.
   * `ask` keeps only what the Courses tab still needs (a row, when the course
   * is not listed there). */
  transferRow?: { decide: string[]; reason: string };
  /** The DGS's answer decides a §5.2 transfer that the Grad Admin request then
   * submits — not a core area, a sheet cell, a hold, credit already on the
   * Notre Dame record, or a course with no final grade yet. Next steps ask the
   * late-request question only for these (review of the fixes, 2026-10-29). */
  decidesTransfer?: true;
}

/** What the "Ask the DGS to review" card's chip and its copy button both say
 * is pending — one phrase, shared, so the two can never drift apart (2026-09-12
 * bug: the button counted courses alone, so a review that was only a note —
 * no pending course at all — read "Copy review request for 0 courses"
 * instead of naming the note). */
export function reviewRequestSummary(courseCount: number, hasNote: boolean): string {
  if (courseCount > 0) return `${courseCount} course${courseCount === 1 ? '' : 's'}${hasNote ? ' and a note' : ''}`;
  return 'a note';
}

/** A 4+1's undergraduate graduate-level coursework, when there is a lot of it
 * (DGS 2026-09-12, red-team F8 item 1, answer (c)). §3.5 speaks of "one or
 * two 3-credit CSE courses at the 6xxxx level"; the app presumes any further
 * such course was saved for the graduate degree rather than ask every student
 * about a rare case — so when more than two are counted, the DGS is told to
 * confirm the bachelor's degree did not use them. Returned as one sentence
 * for the warnings and the review request; undefined when nothing to flag. */
export function undergraduateGraduateCourseworkFlag(student: Student, rules: Rules): string | undefined {
  const { classified } = classify(student, rules);
  return undergraduateGraduateCourseworkFlagFor(classified, student);
}
export function undergraduateGraduateCourseworkFlagFor(classified: readonly ClassifiedCourse[], student: Student): string | undefined {
  const awarded = student.bachelorsAwarded;
  if (awarded === undefined) return undefined;
  // §3.5's "one or two" is the Integrated program's rule; a plain bachelor's
  // graduate coursework waits for the DGS course by course since 2026-10-03
  // (Academic Code §4.6), so there is nothing to presume about it here.
  if (student.integratedBsMs !== true) return undefined;
  // The MSCSE only (policy review round 3, P3-text-engine-3): a Ph.D. student
  // says per course which degrees it already counted toward, and the
  // six-credit cap line says what counts — §3.5's presumption does not apply.
  if (student.program !== 'mscse') return undefined;
  const counted = classified.filter(
    (c) =>
      c.entry.origin === 'transfer' &&
      isNotreDameInstitution(c.entry.institution) &&
      !c.superseded &&
      c.ineligibleReason === undefined &&
      c.pool !== 'none' &&
      termIndex(c.entry.term) <= termIndex(awarded) &&
      // The number's own digit, whatever the sheet row's `level` says (NaN
      // when the id has no five-digit number, and NaN >= 6 is false).
      levelOf(c.entry) >= 6,
  );
  if (counted.length <= 2) return undefined;
  const ids = counted.map((c) => c.entry.courseId).join(', ');
  // Worded for the degree's decider HERE, at the one place the sentence is
  // built (red-team 2026-09-13): the review card calls this function directly,
  // so a sentence rewritten only on audit()'s warnings path reached an MSCSE
  // student — on the page and in the e-mail they are told to send — still
  // naming the DGS, who does not decide for them.
  return decisionWording(
    student.program,
    `${counted.length} graduate-level courses taken as an undergraduate are counted toward the ${student.program === 'mscse' ? 'MSCSE' : 'Ph.D.'} (${ids}). §3.5 speaks of one or two; the self-check presumes the extra ones were not used by the bachelor’s degree — the DGS should confirm that against the undergraduate record.`,
  );
}

/** The courses the review request asks the DGS about, in the order the
 * request lists them: Notre Dame program coursework, Notre Dame coursework
 * from before entry, then other universities. */
export function coursesNeedingDgsReview(student: Student, rules: Rules, today?: string): PendingDgsReview[] {
  // `today` (2026-10-03): a lapsed Incomplete is only known against a date.
  const { classified } = classify(student, rules, today);
  return coursesNeedingDgsReviewFor(classified, student);
}
/** The same, over courses already classified — what audit() hands the
 * approvals row, so the record is not classified a second time for it. */
export function coursesNeedingDgsReviewFor(classified: readonly ClassifiedCourse[], student: Student): PendingDgsReview[] {
  const nd: PendingDgsReview[] = [];
  const priorNd: PendingDgsReview[] = [];
  const external: PendingDgsReview[] = [];
  // §4.4.1 core knowledge belongs to the Ph.D. qualifying examination, which
  // the MSCSE does not have — so for an MSCSE student a core-sounding title is
  // not a reason to ask the DGS anything, and no line here names §4.4.1
  // (DGS 2026-09-11).
  const qualifierApplies = student.program === 'phd';
  const coreTitle = (c: ClassifiedCourse) => qualifierApplies && CORE_TITLE_RE.test(c.entry.title ?? '');
  // The sheet's questions, as the request words them (DGS 2026-09-28).
  const degree = student.program === 'mscse' ? 'MSCSE' : 'Ph.D.';
  const COUNTS = `counts toward the ${degree}: yes / no / case by case`;
  const CORE = 'core area (§4.4.1), if any';
  const GROUP = 'specialization group (§4.4.2), if any';
  const TRANSFERABLE = `transferable to the ${degree} (§5.2): yes / no / case by case`;
  const IS_CSE = `say whether this counts as a CSE course for ${student.program === 'mscse' ? '§3.2' : '§4.2'}’s nine-credit non-CSE allowance (the is_cse cell on its row)`;
  // The sheet's own questions (P3-emails-2): a cell the DGS fills in, read by
  // the page on its next visit — no reply. Every other ask is a ruling.
  const SHEET_QUESTIONS = new Set([COUNTS, CORE, GROUP, TRANSFERABLE, `${COUNTS} — the row is blank`, `${TRANSFERABLE} — the row is blank`, IS_CSE]);
  const tagged = (p: PendingDgsReview): PendingDgsReview => {
    const rulings = p.ask.decide.filter((d) => !SHEET_QUESTIONS.has(d));
    const { rulings: _old, ...rest } = p.ask;
    return { ...p, ask: { ...rest, replyNeeded: rulings.length > 0, ...(rulings.length > 0 ? { rulings } : {}) } };
  };
  const forMe = (what: string): ReviewAsk => ({ needsRow: false, replyNeeded: true, decide: [what] });

  for (const c of classified) {
    if (c.superseded) continue;

    // Notre Dame program coursework: not in the Courses tab (CSE or not — an
    // unlisted non-CSE course needs a row as much as an unlisted CSE one), or
    // a row that needs an approval the student has not attested
    // (dgs_approval, non-CSE, a blank verdict).
    if (c.entry.origin === 'nd') {
      // Nothing is asked when no possible answer changes the report (DGS
      // 2026-09-13). A passed grade below C earns no credit (Academic Code
      // §4.3) and cannot clear §4.4.2's B floor either, so the only thing left
      // a DGS ruling could add is a §4.4.1 core area — and only for a Ph.D.
      // student, on a course the sheet does not list, whose title names an
      // area. Otherwise the DGS was being asked to approve something inert.
      const couldStillEarnACoreArea = qualifierApplies && c.unknown === true && coreTitle(c);
      // A lapsed Incomplete has no passing grade yet — that is the question (2026-10-03).
      if (!passesCreditFloor(c.entry.grade) && !couldStillEarnACoreArea && !c.incompleteLapsed) continue;
      // Waiting only on the Graduate School's approval of the dual-degree plan
      // (P3-dh-front-1-2-2; DGS Handbook §2.9): nothing for the DGS to decide.
      if (c.dualPlanOnly === true) continue;
      if (c.unknown === true || c.approvalPending !== undefined) {
        // The record-level facts no sheet row can settle (policy review
        // 2026-10-03): a lapsed Incomplete, and coursework from before a
        // readmission — after five years or more (Academic Code §5.5), or a
        // shorter gap (DGS Handbook §3.3; 2026-10-04).
        const heldAsks = [
          ...(c.incompleteLapsed ? ['confirm whether the Graduate School extended my Incomplete, or the grade was posted (Academic Code §4.4)'] : []),
          ...(c.interrupted ? [c.mscseSeparated ? 'rule on the credit from my Notre Dame MSCSE, which ended five years or more before I entered the Ph.D., and request the Graduate School’s approval (Academic Code §5.5)' : 'rule on the credit from before my readmission (Academic Code §5.5)'] : []),
          ...(c.beforeReadmission ? ['confirm the credit from before my readmission still counts (DGS Handbook §3.3)'] : []),
        ];
        nd.push({
          course: c,
          kind: 'nd',
          // Both facts when both are true (2026-09-09): a non-CSE course has
          // no Courses-tab row AND §4.2 makes its allowance "subject to
          // approval of the student's advisor and DGS". The unlisted-CSE
          // note already says it is missing from the sheet, so it is not
          // repeated there.
          ask:
            c.unknown === true
              ? { needsRow: true, replyNeeded: heldAsks.length > 0, decide: [COUNTS, ...(qualifierApplies ? [CORE, GROUP] : []), ...heldAsks] }
              : heldAsks.length > 0
                ? { needsRow: false, replyNeeded: true, decide: heldAsks }
                : needsCourseApproval(student.program === 'mscse' ? c.rule?.countsTowardMscse : c.rule?.countsTowardPhd)
                  ? forMe('approve it for me — the course rules say case by case')
                  : /advisor \+ .* approval per (?:the course rules|§3\.2)/.test(c.approvalPending ?? '')
                    ? forMe('approve it for me (the allowance for courses below the 60000 level)')
                    : { needsRow: false, replyNeeded: false, decide: [`${COUNTS} — the row is blank`] },
          reason:
            c.unknown === true
              ? (() => {
                  // The verdict's words (P-54, 2026-09-18), minus the line's own
                  // "send the review request" lead — the card IS the request;
                  // what stays is any second fact (a non-CSE course's advisor
                  // approval, 2026-09-27).
                  const rest = (c.approvalPending ?? '').replace(/^not in the course rules yet — send the review request so the DGS can enter it/, '').replace(/^;\s*/, '');
                  return rest !== '' ? `not in the course rules yet; ${rest}` : 'not in the course rules yet';
                })()
              : (c.approvalPending ?? 'needs DGS review'),
          unlisted: c.rule === undefined,
        });
      }
      continue;
    }
    if (c.entry.origin !== 'transfer') continue;

    const fromNotreDame = isNotreDameInstitution(c.entry.institution);
    // The undergraduate career: the transcript's UG level, or any Notre Dame
    // row the engine filed as coursework from before the bachelor's (allocate.ts
    // classifyPriorNdUndergraduate) — which is never §5.2 transfer credit,
    // whatever level it was registered at (Academic Code §4.6, last
    // paragraph). A GR-registered 4+1 course used to be sent for a §5.2
    // recommendation (policy review round 3, P3-fourplusone-5).
    // (Graduate credit the Notre Dame record posts from a bachelor's-transcript
    // row is transfer credit — credit-transfer review 2026-10-28, #47.)
    const bachelors =
      (c.entry.degreeLevel === 'bachelors' && c.ndPosting?.level !== 'graduate') || (fromNotreDame && c.notTransferCredit === true && !c.nonDegree && !c.ndBeforeAdmission && !c.ndMastersCredit);
    // Prior Notre Dame coursework whose Courses-tab row names a core area is
    // decided for §4.4.1 already (2026-09-05) — no ruling to ask for.
    const coreDecidedByCoursesTab = fromNotreDame && c.rule?.coreArea !== undefined;
    // …and, passed below C, it earns no credit (Academic Code §4.3), as a course
    // in the program does not (DGS 2026-09-13): only a core area could still be
    // asked (review of the fixes, 2026-10-29 — a 4+1 course graded C- was sent
    // for its UG→GR move with no box to record the answer).
    if (fromNotreDame && !passesCreditFloor(c.entry.grade) && !c.incompleteLapsed && !(qualifierApplies && c.rule === undefined && coreTitle(c))) continue;
    // …and a course the bachelor's used once the six are spent counts toward
    // no Ph.D. credit, so only what still can is asked: an unlisted course's
    // core area and specialization group, through its row (a final check of
    // the fixes, 2026-10-29 — its group could never be asked).
    if (fromNotreDame && bachelorsSixSpent(c, student)) {
      if (qualifierApplies && c.rule === undefined && isPassed(c.entry.grade))
        priorNd.push({
          course: c,
          kind: 'priorNd',
          ask: { needsRow: true, replyNeeded: false, decide: [CORE, GROUP] },
          reason: 'taken at Notre Dame before entering the program (undergraduate) — not in the course rules yet; with the six shared credits spent it cannot count toward the Ph.D.’s credits, but its §4.4.1 core area and §4.4.2 group still can',
          unlisted: true,
        });
      continue;
    }
    // What no sheet verdict can settle, so the DGS is asked for THIS student
    // whatever the row says (policy review 2026-10-03): a pass/fail transfer
    // grade, a course taken elsewhere after admission, a lapsed Incomplete,
    // credit from before a readmission after five years or more.
    // A transfer already recorded says so to the DGS ruling on it (review of the fixes, 2026-10-29).
    const recordedHere = c.ndPosting === undefined && c.caps.includes('transfer') && transferRecordedFor(student, c.entry);
    const RECORDED = ' — the Grad Admin has already recorded it, as I ticked';
    const heldAsks = [
      ...(c.passFailGrade ? ['decide whether this S (pass/fail) course transfers — it cannot show the B §5.2 requires'] : []),
      ...(c.afterAdmission ? ['confirm the department and the Graduate School approved this course before I took it (taken after admission, DGS Handbook §3.14)'] : []),
      ...(c.noPriorProgram
        ? [student.ndMasters !== undefined
            ? 'decide whether this course transfers, and how much — I took it outside any degree program at that university (my earlier program is the Notre Dame MSCSE), and the Academic Code states no transfer allowance for that case (Academic Code §4.6)'
            : 'decide whether this course transfers, and how much — I had no earlier graduate program, and the Academic Code states no transfer allowance for that case (Academic Code §4.6)']
        : []),
      // P3-prior-programs-3 (3): two earlier programs; the DGS decides how their allowances combine.
      // Count-free: there may be more than two (review of the fix, 2026-10-29).
      ...(c.twoPrograms ? ['decide how the transfer allowances of my earlier graduate programs combine — §5.2 states one after a finished program and one after an unfinished one, not for several (Academic Code §4.6)'] : []),
      // P3-prior-programs-4 (b): the window runs from the MSCSE admission, which the record does not date.
      ...(c.windowStartUnknown ? ['confirm this course falls within five years before my admission to the Notre Dame MSCSE (§5.2) — it is more than five years before my Ph.D. entry'] : []),
      ...(c.cseUnknown ? [IS_CSE] : []),
      ...(c.incompleteLapsed ? ['confirm whether the Graduate School extended my Incomplete, or the grade was posted (Academic Code §4.4)'] : []),
      // Another university's Incomplete (P3-ac-4-1; DGS 2026-10-05: held for DGS review).
      ...(c.outsideIncomplete ? ['decide this course once its final grade is posted — it is graded I (Incomplete) at my previous university, so it cannot show the B that §5.2 requires yet'] : []),
      ...(c.interrupted ? [`${c.mscseSeparated ? 'rule on the credit from my Notre Dame MSCSE, which ended five years or more before I entered the Ph.D., and request the Graduate School’s approval (Academic Code §5.5)' : 'rule on the credit from before my readmission (Academic Code §5.5)'}${recordedHere ? RECORDED : ''}`] : []),
      // A shorter readmission's hold on the student's own MSCSE courses (review of the fix, 2026-10-29).
      ...(c.beforeReadmission ? [`confirm the credit from before my readmission still counts (DGS Handbook §3.3)${recordedHere ? RECORDED : ''}`] : []),
    ];

    // Credit the Notre Dame record already shows as accepted (P3-import-1;
    // DGS 2026-10-05, Option 1): counted, it is left out of the request — the
    // Graduate School has decided it — unless its title suggests a §4.4.1 core
    // area the sheet has not recorded, which is a separate question. Held (its
    // level not shown, or recorded before this program), the DGS is asked one
    // thing for this student, answered by the tick on the course.
    if (c.ndPosting !== undefined && !bachelors && c.ineligibleReason === undefined) {
      const coreOpen = !coreDecidedByCoursesTab && coreTitle(c) && c.external?.satisfiesCoreArea === undefined;
      if (c.approvalPending === undefined) {
        if (coreOpen) {
          external.push({
            course: c,
            kind: 'external',
            ask: { needsRow: c.external === undefined, replyNeeded: false, decide: [CORE] },
            reason: 'transfer credit on my Notre Dame record, already accepted; the title suggests a §4.4.1 core area',
            unlisted: c.external === undefined,
          });
        }
        continue;
      }
      external.push({
        course: c,
        kind: 'external',
        ask: {
          // A row question (is_cse, the core area) for a course with no
          // ExternalCourses row asks for the row, with a paste-ready one
          // (credit-transfer review 2026-10-28, #65).
          needsRow: c.external === undefined && (c.cseUnknown === true || coreOpen),
          // A record-level hold on posted credit is asked as its ruling too —
          // a readmission after five years or more, or a shorter one (review
          // of the fix, 2026-10-29: the §5.2 card said "the review request
          // asks" while it asked nothing).
          replyNeeded: c.ndPostingHeld !== undefined || c.interrupted === true || c.beforeReadmission === true,
          decide: [
            ...(c.ndPostingHeld !== undefined ? ['confirm this credit, already accepted on my Notre Dame record, counts toward this degree (I tick the box on the course when you do)'] : []),
            ...(c.interrupted ? ['rule on the credit from before my readmission (Academic Code §5.5) — it is already accepted on my Notre Dame record'] : []),
            ...(c.beforeReadmission ? ['confirm the credit from before my readmission still counts (DGS Handbook §3.3) — it is already accepted on my Notre Dame record'] : []),
            ...(c.cseUnknown ? [IS_CSE] : []),
            ...(coreOpen ? [CORE] : []),
          ],
        },
        reason: c.approvalPending,
        // Asked for its row: it has none yet (review of the fix, 2026-10-29).
        unlisted: c.external === undefined && (c.cseUnknown === true || coreOpen),
      });
      continue;
    }

    if (c.external !== undefined) {
      // Ruled — or merely listed. Pending while transferability is undecided
      // (graduate rows the engine has not already excluded — bachelors never
      // transfers), and while a core-sounding title has no core-area decision.
      const caseByCase = needsApproval(c.transferable);
      // A student who has ticked "the DGS and the Graduate School approved my
      // transfer" is not waiting on a transferability decision — every other
      // surface already treats that attestation as closing the §5.2 question
      // (allocate.ts clears `approvalPending`, and the §5.2 row reads "met"),
      // and the card used to go on asking anyway (2026-09-08).
      const transferAttested = c.entry.dgsApproved === true; // the course's own tick (2026-09-27)
      // …but only for a course the DGS has reviewed (a verdict in the sheet):
      // a listed row with a BLANK verdict stays pending whatever is ticked
      // (2026-09-11 ruling; red-team F5, 2026-09-12).
      const transferUndecided = (c.transferable === undefined || (caseByCase && !transferAttested)) && !bachelors && c.ineligibleReason === undefined;
      const coreUndecided = c.external.satisfiesCoreArea === undefined && !coreDecidedByCoursesTab && coreTitle(c);
      const held = heldAsks.length > 0 && !bachelors && c.ineligibleReason === undefined;
      if (!transferUndecided && !coreUndecided && !held) continue;
      // Why the course is decided case by case — its relevance to the
      // student's research — is settled between the advisor and the DGS (DGS
      // 2026-09-08), so the student is told only that the decision is open.
      const transferReason = caseByCase ? 'listed as case by case — needs the DGS’s approval for you (§5.2)' : 'listed in the course rules, decision still open (§5.2)';
      const reason =
        transferUndecided && coreUndecided
          ? `${transferReason}, and no core area recorded although the title suggests a §4.4.1 core area`
          : transferUndecided
            ? transferReason
            : coreUndecided
              ? 'reviewed by the DGS, but no core area recorded — the title suggests a §4.4.1 core area'
              : (c.approvalPending ?? 'needs the DGS’s decision');
      // A case-by-case course needs the DGS's answer for this student; a
      // blank cell needs the row completed, nothing more.
      const ask: ReviewAsk = {
        needsRow: false,
        replyNeeded: (transferUndecided && caseByCase) || held,
        decide: [
          ...(transferUndecided ? [caseByCase ? 'approve the transfer for me — the course rules say case by case (§5.2)' : `${TRANSFERABLE} — the row is blank`] : []),
          ...(held ? heldAsks : []),
          ...(coreUndecided ? [CORE] : []),
        ],
      };
      const submits = transferUndecided && !held && c.caps.includes('transfer') && c.ndPosting === undefined && c.notTransferCredit !== true && c.entry.grade !== 'IP';
      (fromNotreDame ? priorNd : external).push({ course: c, kind: fromNotreDame ? 'priorNd' : 'external', reason, unlisted: false, ask, ...(submits ? { decidesTransfer: true as const } : {}) });
      continue;
    }

    // Unreviewed. Undergraduate courses earn no transfer credit, but the DGS
    // keywords (2026-09-03) flag the ones whose TITLE suggests a §4.4.1 core
    // area — those are worth a ruling. Graduate courses are pending when
    // transfer credit is still possible (no hard §5.2 ineligibility) — and
    // even when it is not (outside the window, below the grade floor, before
    // the bachelor's degree), a core-keyword title still belongs in the
    // request, because §4.4.1 core knowledge has no such restrictions.
    const keyword = !coreDecidedByCoursesTab && coreTitle(c);
    // A Notre Dame course taken as an undergraduate that MAY count toward the
    // degree being audited — the 40000-level courses §3.2/§4.2 allow, whose
    // sheet row asks for the advisor's and the DGS's approval — is counted
    // provisionally and belongs in the request (DGS 2026-09-11: "they may
    // count, subject to all other constraints, so they should be listed …
    // for further decisions & review").
    const needsApprovalOnTop = c.approvalPending !== undefined && c.ineligibleReason === undefined;
    // A prior Notre Dame course the Courses tab lists is a course the DGS has
    // reviewed; once the student records the DGS's recommendation and the
    // Graduate School's approval there is nothing left to ask (2026-09-11 —
    // the guard used to cover only ExternalCourses rulings, so a student who
    // did the MSCSE here was asked to request a recommendation already
    // given). And a course that counts WITHOUT being transfer credit — Notre
    // Dame coursework taken as an undergraduate, which never draws the
    // transfer cap — is not a §5.2 request at all.
    const transferSettled = fromNotreDame && c.rule !== undefined && c.approvalPending === undefined;
    const notTransferCredit = fromNotreDame && !c.caps.includes('transfer') && c.ineligibleReason === undefined && c.approvalPending === undefined;
    if (transferSettled || notTransferCredit) continue;
    const pending = (bachelors ? keyword : c.ineligibleReason === undefined || keyword) || needsApprovalOnTop;
    if (!pending) continue;
    if (fromNotreDame) {
      // Asked about as a NOTRE DAME course — a row for the Courses tab when
      // it is not listed there (its core_area then decides §4.4.1); the §5.2
      // transfer part stays a per-student recommendation.
      // The row is the DGS's to enter; the §5.2 recommendation (or the
      // allowance approval) is an answer for this student.
      // The per-student questions the policy review added (2026-10-03) —
      // non-degree coursework, a 4+1 extra's UG→GR move, the BS + Ph.D.
      // double count, a plain bachelor's 60000-level course, §3.5's window —
      // all carry their own approvalPending sentence, which is the ask.
      const policyAsks = [
        ...(c.nonDegree ? ['rule on my non-degree coursework — at most 12 credits may count (Academic Code §2.3)'] : []),
        // P3-dh-3.14-3.20-3 (option (c)): the twelve named for the DGS to decide.
        ...(c.ndBeforeAdmission ? ['decide whether this course counts — I took it at Notre Dame before admission, while my earlier graduate program was at another university; if it was in non-degree status, at most 12 such credits may count (Academic Code §2.3)'] : []),
        ...(c.ugToGrUnverified ? ['confirm this course was moved from UG to GR and transferred before my bachelor’s was conferred (Graduate School 4+1 guidance)'] : []),
        // P3-fourplusone-2 (DGS 2026-10-07: option (2)): the GR registration and
        // the answered admission term disagree; the DGS settles it.
        ...(c.admissionTermConflict ? ['confirm this course counts — my Notre Dame transcript registers it at the graduate level (moved from UG to GR), but the Integrated-program admission I entered is after my bachelor’s degree (Graduate School 4+1 guidance)'] : []),
        // Not when the six are already spent on the bachelor's and the MSCSE:
        // no ruling can make it count (credit-transfer review 2026-10-28, #44).
        ...(c.caps.includes('sharedbs') && student.program === 'phd' && c.entry.countedToward === 'bs' && c.entry.dgsApproved !== true && spentOnBachelorsAndMasters(student) < BS_SHARED_CREDITS_MAX
          ? ['confirm it may count toward both my bachelor’s degree and the Ph.D. (the Graduate School’s 2026-09-22 answer)']
          : []),
        ...(bachelors && !c.ugToGrUnverified && !c.caps.includes('sharedbs') && c.approvalPending !== undefined && /advance approval|§3\.5/.test(c.approvalPending)
          ? // Each document named (policy review round 3, P3-text-ui-4): the
            // advance approval is the Code's §4.6, the window CSE's §3.5.
            [`approve it for me (${[...(/advance approval/.test(c.approvalPending) ? ['Academic Code §4.6'] : []), ...(/§3\.5/.test(c.approvalPending) ? ['CSE §3.5'] : [])].join('; ')})`]
          : []),
        ...heldAsks,
      ];
      // A §5.2 candidate from an earlier Notre Dame program (P3-dh-10-2): its
      // transfer decision is an ExternalCourses row under UNIVERSITY OF NOTRE
      // DAME, asked for as a row — not an email reply the page cannot record.
      const transferRow = policyAsks.length === 0 && !bachelors && !c.ndMastersCredit && c.ineligibleReason === undefined && c.caps.includes('transfer') && c.external === undefined;
      // "Case by case" only when the row says so: a blank verdict is a sheet
      // question (list A), as for a course taken in the program, and an
      // unlisted course's questions are its row's (credit-transfer review
      // 2026-10-28, #26 — both were asked "the course rules say case by case").
      const verdict = student.program === 'mscse' ? c.rule?.countsTowardMscse : c.rule?.countsTowardPhd;
      const caseByCaseRow = needsCourseApproval(verdict);
      const blankRow = c.rule !== undefined && verdict === undefined && needsApprovalOnTop;
      const recommendation =
        policyAsks.length > 0
          ? policyAsks
          : transferRow
            ? []
            : bachelors
              ? // What the line waits on (P3-fourplusone-5): the allowance
                // below the 60000 level, or the row's case-by-case approval —
                // both only on a case-by-case row; a blank row is the sheet's
                // question, an unlisted row's questions are the row's (review
                // of the fix, 2026-10-29).
                needsApprovalOnTop && caseByCaseRow
                ? [c.caps.includes('fourk') ? 'approve it for me (the allowance for courses below the 60000 level)' : 'approve it for me — the course rules say case by case']
                : []
              : c.ndMastersCredit
                ? needsApprovalOnTop && caseByCaseRow
                  ? ['approve it for me — the course rules say case by case']
                  : []
                : c.ineligibleReason === undefined
                  ? ['recommend the transfer credit for me (§5.2)']
                  : [];
      priorNd.push({
        course: c,
        kind: 'priorNd',
        ask: {
          needsRow: c.rule === undefined,
          replyNeeded: recommendation.length > 0,
          decide: [...(c.rule === undefined ? [COUNTS, ...(qualifierApplies ? [CORE, GROUP] : [])] : blankRow ? [`${COUNTS} — the row is blank`] : []), ...recommendation],
        },
        reason:
          `taken at Notre Dame before entering the program (${bachelors ? 'undergraduate' : c.ndMastersCredit ? 'MSCSE' : c.nonDegree ? 'non-degree' : 'graduate'}) — ` +
          (c.rule === undefined
            ? qualifierApplies
              ? `not in the course rules yet; does it cover a §4.4.1 core area?${policyAsks.length > 0 ? ` ${c.approvalPending}` : ''}`
              : `not in the course rules yet${policyAsks.length > 0 ? `; ${c.approvalPending}` : ''}`
            : policyAsks.length > 0
              ? (c.approvalPending ?? 'needs the DGS’s decision')
              : bachelors && needsApprovalOnTop
              ? c.caps.includes('fourk')
                ? `may count toward the ${student.program === 'mscse' ? 'MSCSE (§3.2)' : 'Ph.D. (§4.2)'} inside the allowance for courses below the 60000 level — ${c.approvalPending}`
                : `may count toward the ${student.program === 'mscse' ? 'MSCSE' : 'Ph.D.'} — ${c.approvalPending}`
              : c.ndMastersCredit
                ? // Not transfer credit (Graduate School 2026-09-22): what is
                  // open is the sheet row's own approval, and nothing else.
                  `counts toward the Ph.D. from your Notre Dame MSCSE — ${c.approvalPending}`
                : transferRow
                  ? 'no transfer decision recorded yet — the DGS enters it in the course rules (§5.2)'
                  : 'transfer credit needs a DGS recommendation (§5.2)'),
        unlisted: c.rule === undefined,
        ...(transferRow
          ? { transferRow: { decide: [TRANSFERABLE], reason: 'graduate course from my earlier Notre Dame program — §5.2 applies; no transfer decision recorded yet' } }
          : {}),
        ...((transferRow || recommendation.includes('recommend the transfer credit for me (§5.2)')) && c.entry.grade !== 'IP' && c.ndPosting === undefined ? { decidesTransfer: true as const } : {}),
      });
    } else {
      external.push({
        course: c,
        kind: 'external',
        ask: {
          needsRow: true,
          replyNeeded: heldAsks.length > 0 && !bachelors,
          decide: [...(!bachelors && c.ineligibleReason === undefined ? [TRANSFERABLE] : []), ...(!bachelors ? heldAsks : []), ...(keyword ? [CORE] : [])],
        },
        ...(!bachelors && c.ineligibleReason === undefined && heldAsks.length === 0 && c.caps.includes('transfer') && c.entry.grade !== 'IP' ? { decidesTransfer: true as const } : {}),
        reason: bachelors
          ? 'not in the course rules yet; the title suggests a §4.4.1 core area'
          : c.ineligibleReason !== undefined
            ? 'no transfer credit, but the title suggests a §4.4.1 core area — not in the course rules yet'
            : heldAsks.length > 0
              ? // The pending text ends by saying the course is not in the rules yet; the reason already opens with it (2026-10-05).
                `not in the course rules yet — the DGS enters it; ${(c.approvalPending ?? '').replace(/^waiting for the DGS — /, '').replace(/; not in the course rules yet — send the review request so the DGS can enter it/, '')}`
              : 'not in the course rules yet — the DGS enters it',
        unlisted: true,
      });
    }
  }
  // Said for the degree's decider (2026-09-11): the ADGS for an MSCSE student.
  return [...nd, ...priorNd, ...external].map((p) => ({ ...tagged(p), reason: decisionWording(student.program, p.reason) }));
}
