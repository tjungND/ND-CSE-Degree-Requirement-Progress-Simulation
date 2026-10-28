// §5.2 transfer credit — the same row for both degrees (2026-09-11).
//
// The Ph.D. has reported its transfer cap since the app was built; the MSCSE
// enforced the cap but never showed it, so a master's student with a completed
// prior degree could only discover their nine credits by going over them (DGS
// 2026-09-11: "add a row to show how many credits may be transferred if a
// MSCSE student submits a prior transcript"). The caps themselves live in the
// Parameters tab, one key per degree and prior-degree state.
import { isNotreDameInstitution, needsApproval } from '../../data/external.ts';
import { formatCredits } from '../credits.ts';
import { compareTerm, semesterNumber, termOfDate } from '../term.ts';
import type { DetailPart, RequirementResult, Status } from '../types.ts';
import type { Ctx } from './context.ts';
import { conferralWindow, earlierTransferPrograms, firstSemesterComplete, outsideIncompleteNote, transferWindowClosedText } from '../allocate.ts';
import { joinedDetail, missingParamDetail, countedCourseIds } from './context.ts';

/** §4.2 + §5.2 transfer credit: window, B floor, and the 6/24 caps are enforced
 * by the classifier/allocator; this row reports the result. Every transfer is
 * needs-DGS-review until attested (§5.2 requires DGS + Graduate School approval) —
 * except when every pending course is already ruled transferable: then the row
 * is "in progress" until the Grad Admin has processed it (DGS 2026-09-07). */
export function transferRow(ctx: Ctx, opts: { id: string; group: string; capKeyCompleted: string; section: string }): RequirementResult {
  // §5.2's own sentence (clarity review 2026-09-26): the row applies these
  // five conditions, so the § chip shows them; §4.2's summary sentence used
  // to sit here.
  const quote =
    'A student may transfer credits earned at another accredited university only if: 1) the student is in degree status at Notre Dame; 2) the courses taken are graduate courses appropriate to the Notre Dame graduate program and the student had graduate student status when they took these courses; 3) the courses were completed within a five-year period prior to admission to a graduate degree program at Notre Dame or while enrolled in a graduate degree program at Notre Dame; 4) grades of "B" (3.0 on 4.0 scale) or better were achieved; and 5) the transfer is recommended by the DGS and approved by the Graduate School.';
  // Undergraduate courses are invisible here (DGS request 2026-09-04): they
  // can never transfer (§5.2), so this card neither lists nor counts them —
  // their core-knowledge role shows on the coursework list and the core rows.
  // …and neither is Notre Dame coursework taken as an undergraduate, which
  // counts toward the degree without being transfer credit (2026-09-10): it
  // has no 'transfer' cap, and listing it here would ask the DGS to decide a
  // transfer nobody is requesting.
  const transfers = ctx.classified.filter(
    (c) =>
      c.entry.origin === 'transfer' &&
      c.entry.degreeLevel !== 'bachelors' &&
      c.notTransferCredit !== true &&
      (c.caps.includes('transfer') || c.pool === 'none' || c.transferOutsideCap === true),
  );
  const capKey =
    ctx.student.priorMs === 'completed'
      ? opts.capKeyCompleted
      : 'transfer_unfinished_ms_credits_max';
  const cap = ctx.params.number(capKey);
  let status: Status;
  // Which courses are counted, waiting or refused, against how much, are the
  // facts; the allowance's basis, the reasons and the instructions are notes
  // (DGS 2026-10-03).
  const parts: DetailPart[] = [];
  if (transfers.length === 0) {
    status = 'not_applicable';
    parts.push('No transfer courses entered');
  } else if (cap === undefined) {
    status = 'cannot_evaluate';
    parts.push(missingParamDetail(capKey));
  } else if (ctx.params.gradeLetter('transfer_min_grade') === undefined || ctx.params.number(ctx.student.program === 'mscse' ? 'ms_transfer_window_years' : 'phd_transfer_window_years') === undefined) {
    // §5.2's grade and window cannot be checked (item 1): no course is counted
    // (allocate.ts), and the row says which number is missing.
    status = 'cannot_evaluate';
    for (const key of ['transfer_min_grade', ctx.student.program === 'mscse' ? 'ms_transfer_window_years' : 'phd_transfer_window_years']) {
      if ((key === 'transfer_min_grade' ? ctx.params.gradeLetter(key) : ctx.params.number(key)) === undefined) parts.push(missingParamDetail(key));
    }
  } else {
    // "Counted" means counted: provisional credit is said separately, so a
    // row whose every course is still pending no longer reads "24 of 24
    // transfer credits counted" (2026-09-11).
    const counted = ctx.alloc.transfer.definite + ctx.alloc.transfer.in_progress;
    const provisional = ctx.alloc.transfer.provisional;
    // Posted credit outside the working limit (P4-transfer-2 (a)) counts, but
    // not against the limit: the meter below says what the limit admitted.
    // Measured as `counted` is (allocate.ts sums.transfer): without the
    // non-CSE allowance's spill into the total (`overCapToTotal`), which
    // sums.transfer leaves out — the meter read "-3 of the 6" for a posted
    // non-CSE course past the nine (policy review round 5; DGS 2026-10-14).
    const outsideCap = ctx.alloc.perCourse
      .filter((p) => p.course.transferOutsideCap === true && !p.course.superseded && p.course.tier !== 'provisional')
      .reduce((sum, p) => sum + p.countedRegular + p.countedOther - (p.overCapToTotal ?? 0), 0);
    // Split the pending courses by what the DGS's ExternalCourses tab says,
    // so the student knows exactly what to do next (2026-09-01). Ruled
    // transferable already → nothing is left for the DGS to decide: the
    // credit waits for the Grad Admin's processing, so the row is "in
    // progress", not "needs DGS review" (DGS 2026-09-07).
    const pending = transfers.filter((c) => !c.superseded && c.approvalPending);
    // Held for the DGS whatever the sheet says (policy review 2026-10-03): a
    // pass/fail grade, a course taken elsewhere after admission, a lapsed
    // Incomplete, credit from before a readmission after five years or more.
    // The sheet's `yes` does not settle these, so they are never "approved".
    const held = pending.filter((c) => c.passFailGrade || c.afterAdmission || c.noPriorProgram || c.windowStartUnknown || c.twoPrograms || c.cseUnknown || c.incompleteLapsed || c.outsideIncomplete || c.interrupted || c.ndPostingHeld !== undefined);
    const heldReason = (c: (typeof pending)[number]): string =>
      [
        // Credit on the Notre Dame record that still waits (P3-import-1, 2026-10-05).
        ...(c.ndPostingHeld !== undefined ? [`on your Notre Dame record as accepted transfer credit, but ${c.ndPostingHeld.replace('; and ', ', and ')} — the DGS confirms it counts toward this degree`] : []),
        ...(c.passFailGrade ? ['graded pass/fail, which cannot show the B §5.2 requires'] : []),
        ...(c.afterAdmission ? ['taken after admission — the department and the Graduate School must have approved it in advance (DGS Handbook §3.14)'] : []),
        // A Notre Dame MSCSE holder's course taken in no program at that university (P3-prior-programs-6 (a), 2026-10-07).
        ...(c.noPriorProgram
          ? [ctx.student.ndMasters !== undefined
              ? 'taken outside any degree program at that university — your earlier program is the Notre Dame MSCSE, and the Academic Code states no transfer allowance for a course taken outside a program (Academic Code §4.6)'
              : 'taken outside any degree program — the Academic Code states no transfer allowance for a student with no earlier graduate program (Academic Code §4.6)']
          : []),
        // P3-prior-programs-3 (3), 2026-10-07: said once, as the row's first fact.
        ...(c.twoPrograms ? ['from one of your two earlier graduate programs — the DGS decides how their allowances combine'] : []),
        // P3-prior-programs-4 (b), 2026-10-07.
        ...(c.windowStartUnknown ? ['more than five years before your Ph.D. entry — §5.2 counts back from your Notre Dame MSCSE admission, which this record does not date'] : []),
        ...(c.cseUnknown ? ['the course rules do not say whether it is a CSE course, so §4.2’s nine-credit non-CSE allowance cannot be applied yet'] : []),
        ...(c.incompleteLapsed ? ['an Incomplete past its deadline (Academic Code §4.4)'] : []),
        // Another university's Incomplete (P3-ac-4-1, 2026-10-05).
        ...(c.outsideIncomplete ? [`${outsideIncompleteNote(c.entry)} — the DGS decides once the grade is final`] : []),
        ...(c.interrupted ? ['taken before a readmission after five years or more (Academic Code §5.5)'] : []),
      ].join('; ');
    const preApproved = pending.filter((c) => c.transferable === 'yes' && !held.includes(c));
    // Ruled `dgs_approval` / `adgs_approval`: the sheet says this one needs an
    // approval, so it is neither pre-approved nor unreviewed (2026-09-08,
    // split by program 2026-09-09).
    const caseByCase = pending.filter((c) => needsApproval(c.transferable) && !held.includes(c));
    const unreviewed = pending.filter((c) => !c.external && !held.includes(c));
    const listedUndecided = pending.filter((c) => c.external && c.transferable === undefined && !held.includes(c));
    // "Needs DGS review" only while the DGS actually has a course to decide
    // (2026-09-09 — the sibling shared.approvals row already worked this way).
    // With every entered course excluded on its own terms — taken before the
    // bachelor's degree, below the B floor, outside the five-year window, or
    // ruled non-transferable — there is nothing to ask for, and an amber row
    // the student can never clear is worse than no row.
    // The attestation makes the row "met" only when it has settled every
    // course: a never-reviewed course stays pending whatever is ticked
    // (2026-09-11), and the row must say so rather than read met beside it.
    // Every course settled (2026-09-27: by the sheet's `yes`, or by the tick on
    // a case-by-case course) and something counted → met.
    // …and "met" only once the Graduate School has approved and the Grad
    // Admin recorded the transfer (§5.2 criterion 5: "recommended by the DGS
    // and approved by the Graduate School" — policy review 2026-10-03,
    // refining 2026-09-27: the credits still count as the DGS's `yes` or tick
    // decided; this row's pill waits for the Graduate School).
    // Credit the Notre Dame record already shows as accepted is recorded by
    // definition (P3-import-1, Option 1; DGS 2026-10-05): when every counted
    // transfer course is such credit, nothing is left for the tick to confirm.
    const countedTransfers = transfers.filter((c) => !c.superseded && c.approvalPending === undefined && c.ineligibleReason === undefined);
    const onRecord = countedTransfers.filter((c) => c.ndPosting !== undefined);
    const recorded = ctx.student.attestations.transferRecorded === true || (onRecord.length > 0 && onRecord.length === countedTransfers.length);
    status = pending.length === 0
      ? counted > 0
        ? recorded
          ? 'met'
          : 'in_progress'
        : 'not_applicable'
        : preApproved.length === pending.length
          ? 'in_progress'
          : 'needs_dgs_review';
    const first = firstSemesterComplete(ctx.student, ctx.entry, ctx.today);
    // The conferral semester named, or the window said closed (P3-import-4 (b)).
    const window = conferralWindow(ctx.student, ctx.today);
    const processWhen =
      window.closed !== undefined
        ? transferWindowClosedText(window.closed)
        : first.done
          ? `send the Grad Admin the processing request — the Graduate School considers it only after your first semester ${first.byEarlierProgram ? '(met by your finished earlier Notre Dame graduate program)' : '(done)'} and ${window.before} (§5.2)`
          : `send the Grad Admin the processing request once your first semester is complete — the Graduate School considers a transfer request only then, and ${window.before} (§5.2)`;
    // The cap's name says whose cap it is. A student with no prior graduate
    // program at all is under the smaller cap too, but is not "a prior program
    // that was not completed" (2026-09-11).
    // An UNFINISHED PH.D. elsewhere (policy review 2026-10-03, DGS: fix as
    // suggested): the Code's §4.6 and CSE §5.2 state the six for an unfinished
    // MASTER'S and no figure at all for an unfinished Ph.D. — the six stays as
    // the conservative default and the row says so; the question is with the
    // Graduate School (docs/HANDBOOK-REVISIONS.md §10).
    const unfinishedPhd = ctx.student.priorMs === 'unfinished' && transfers.some((c) => !c.superseded && c.entry.degreeLevel === 'phd');
    // Where no document states a figure, the number is this page's working
    // limit and is called that — not "§5.2's allowance" (policy review round
    // 3, P3-cse-5-6-1; DGS 2026-10-06: "apply the suggested handling"; the
    // 2026-10-03 fix left the "§5.2's allowance for" prefix in place). The
    // no-earlier-program wording follows the courses held for that reason,
    // not priorMs 'none' alone: a student who finished the Notre Dame MSCSE
    // also has priorMs 'none', and has an earlier program.
    const noPriorProgram = transfers.some((c) => !c.superseded && c.noPriorProgram === true);
    const capNote =
      ctx.student.priorMs === 'completed'
        ? `The ${cap} is §5.2’s allowance for a completed prior degree`
        : ctx.student.priorMs === 'unfinished'
          ? unfinishedPhd
            ? `The ${cap} is this page’s working limit: the Academic Code states six for an unfinished master’s and no figure for an unfinished Ph.D. (Academic Code §4.6), so the DGS decides each course and may put your case to the Graduate School`
            : `The ${cap} is §5.2’s allowance for a prior program that was not completed`
          : noPriorProgram
            ? ctx.student.ndMasters !== undefined
              ? `The ${cap} is this page’s working limit: your earlier program is the Notre Dame MSCSE, one program with the Ph.D., and no document states a transfer allowance for a course taken outside a program elsewhere, so the DGS decides each course (DGS 2026-10-03, 2026-10-07)`
              : `The ${cap} is this page’s working limit: no document states a transfer allowance for a student with no earlier graduate program, so the DGS decides each course (DGS 2026-10-03)`
            : `The ${cap} is this page’s working limit: no document states a transfer allowance for your record, so the DGS decides each course (DGS 2026-10-03)`;
    // The action first (DGS 2026-09-27): the courses waiting for the DGS and
    // what to do, then the count against the allowance.
    const upper = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
    // Two earlier programs (P3-prior-programs-3; DGS 2026-10-07: option (3)):
    // the case, named once, before its courses.
    const programs = ctx.classified.some((c) => c.twoPrograms === true) ? earlierTransferPrograms(ctx.classified) : [];
    if (programs.length >= 2)
      parts.push(`Transfer credit from ${programs.length} earlier graduate programs: ${programs.slice(0, -1).join(', ')} and ${programs[programs.length - 1]}`, {
        note: 'The Academic Code and §5.2 state a transfer allowance after a finished program and one after an unfinished one, but not how two programs’ allowances combine, so every course from them waits for the DGS (Academic Code §4.6); the review request asks',
      });
    for (const c of held) parts.push(`Waiting for the DGS: ${c.entry.courseId}`, { note: `${c.entry.courseId}: ${upper(heldReason(c))}; the review request asks` });
    if (unreviewed.length > 0) {
      const credits = unreviewed.reduce((sum, c) => sum + (c.entry.credits ?? 0), 0);
      parts.push(`Waiting for the DGS: ${unreviewed.map((c) => c.entry.courseId).join(', ')} (${formatCredits(credits)} credits)`, { note: 'Send the review request from the Transcripts card' });
    }
    parts.push(`${formatCredits(Math.max(0, counted - outsideCap))} of the ${cap} credits you may transfer are counted${provisional > 0 ? `; ${formatCredits(provisional)} more pending review` : ''}${outsideCap > 0 ? `, besides ${formatCredits(outsideCap)} on your Notre Dame record, counted in full` : ''}`, { note: capNote });
    // Only courses under §5.2's own cap belong on this row: Notre Dame
    // coursework taken as an undergraduate is filed as 'transfer' but is not
    // transfer credit (2026-09-10), and its lines used to be repeated here.
    const awarded = ctx.student.bachelorsAwarded;
    const excluded = ctx.alloc.perCourse.filter((p) => {
      const e = p.course.entry;
      if (e.origin !== 'transfer' || e.degreeLevel === 'bachelors' || p.excluded <= 0) return false;
      // The second row of one course (P3-import-1 (c)): counted on its twin's line.
      if (p.course.superseded) return false;
      // Notre Dame coursework taken in or before the bachelor's award term went
      // down the undergraduate path, not §5.2's.
      if (awarded !== undefined && isNotreDameInstitution(e.institution) && compareTerm(e.term, awarded) <= 0) return false;
      // An unreviewed candidate the allocator happened to leave outside the
      // cap is not "over the cap" — the DGS decides which candidates transfer
      // (2026-09-06); the line already says "candidate", and so does this row.
      if (p.course.tier === 'provisional' && p.course.transferable !== 'yes' && p.course.caps.includes('transfer') && p.course.ineligibleReason === undefined) return false;
      return true;
    });
    // A course a cap admits in part says how much is out (DGS 2026-10-27: the
    // non-CSE nine cut INFO 6205 to one of its four credits).
    for (const p of excluded) {
      const whole = p.course.effectiveCredits ?? p.course.entry.credits;
      const part = p.excluded < whole - 1e-9 ? `${formatCredits(p.excluded)} of its ${formatCredits(whole)} ${whole === 1 ? 'credit' : 'credits'} ` : '';
      parts.push(`${p.course.entry.courseId}: ${part}${p.excludedReason ?? 'not counted'}`);
    }
    if (status === 'not_applicable') {
      parts.push({ note: 'Nothing here needs a decision by the DGS — none of the courses you entered can transfer under §5.2, for the reason on each course’s line' });
    }
    // Accepted and recorded already: said as a fact, nothing to send (P3-import-1).
    if (onRecord.length > 0) {
      parts.push(`On your Notre Dame record as accepted transfer credit: ${onRecord.map((c) => c.entry.courseId).join(', ')}`, {
        note: `The Graduate School approved this credit and recorded it (Academic Code §4.6), so it counts with no review or processing request${transfers.some((c) => c.transferOutsideCap === true) ? ' — in full: no document states a transfer limit for your record, so this page’s working limit covers only the courses the DGS still decides (DGS 2026-10-11)' : ''}`,
      });
    }
    // A `yes` in the course rules counts outright (2026-09-27); the Grad
    // Admin still records it, so the row says which courses to send — not
    // one a cap left no credit of (DGS 2026-10-27: TELE 5600, over the
    // non-CSE nine, is not submitted; its own line above says why).
    const admitted = (c: (typeof transfers)[number]): number => {
      const a = ctx.alloc.perCourse.find((p) => p.course === c);
      return a === undefined ? 0 : a.countedRegular + a.countedOther - (a.overCapToTotal ?? 0);
    };
    const approvedForAll = transfers.filter((c) => !c.superseded && c.transferable === 'yes' && c.ineligibleReason === undefined && c.approvalPending === undefined && c.ndPosting === undefined && admitted(c) > 0);
    if (approvedForAll.length > 0) {
      parts.push(`Approved by the DGS in the course rules: ${approvedForAll.map((c) => c.entry.courseId).join(', ')}${recorded ? ' — recorded by the Grad Admin, as you ticked under Approvals (§5.2)' : ''}`, ...(recorded ? [] : [{ note: upper(processWhen) }]));
    }
    if (pending.length === 0 && counted > 0 && !recorded) {
      parts.push({ note: 'Final once the Graduate School has approved the transfer and the Grad Admin has recorded it (§5.2, criterion 5) — then tick “The Graduate School approved my transfer credit” under Approvals' });
    }
    if (status !== 'met') {
      if (preApproved.length > 0) {
        parts.push(`Approved by the DGS: ${preApproved.map((c) => c.entry.courseId).join(', ')}`, { note: `Final once the Graduate School has approved and the Grad Admin has recorded the transfer; ${processWhen}` });
      }
      if (caseByCase.length > 0) {
        parts.push(
          `Waiting for the DGS’s approval, decided case by case: ${caseByCase.map((c) => c.entry.courseId).join(', ')}`,
        );
      }
      // A row whose transferable cell is blank is none of the three above, and
      // used to go unnamed here (found reviewing the dgs_approval change).
      if (listedUndecided.length > 0) {
        parts.push(
          `Listed in the course rules, decision still open: ${listedUndecided.map((c) => c.entry.courseId).join(', ')}`,
        );
      }
    }
  }
  // The student's own Notre Dame MSCSE (Graduate School through the DGS,
  // 2026-09-22; DGS 2026-10-03: "the graduate school treats MS and PhD the
  // same graduate program"): its coursework is Ph.D. coursework, not transfer
  // credit, and is not on this row.
  const ndMasters = ctx.classified.filter((c) => c.ndMastersCredit && !c.superseded);
  if (ndMasters.length > 0) {
    parts.push({ note: `Your Notre Dame MSCSE courses (${ndMasters.map((c) => c.entry.courseId).join(', ')}) are not transfer credit, so they are not counted here: the Graduate School treats the CSE MSCSE and Ph.D. as one graduate program, so MSCSE coursework not applied to your bachelor’s degree counts as Ph.D. coursework — outside this allowance and with no transfer approval. Each course’s own line shows how it counts` });
  }
  // The counted transfer courses (2026-09-06) — the card's own list. The
  // processing request reads the report's `transferCredits` and submits only
  // the decided courses the cap admits (policy review round 3,
  // P3-prior-programs-5); held ones go through the DGS's own recommendation.
  // …and the posted credit outside the working limit (P4-transfer-2), which
  // left this list when it left the cap (round 5, item 8; DGS 2026-10-14).
  const transferSatisfied = countedCourseIds(ctx, (p) => (p.course.caps.includes('transfer') || p.course.transferOutsideCap === true ? p.countedRegular : 0));
  return {
    id: opts.id,
    ...(transferSatisfied.length > 0 ? { satisfiedBy: transferSatisfied } : {}),
    group: opts.group,
    // The same row governs prior Ph.D. coursework (red-team wording table, 2026-09-12).
    title: 'Transfer credit from prior graduate study',
    shortTitle: 'Transfer credit (§5.2)',
    status,
    // An allowance has nothing to "meet": the pill says what is happening
    // (DGS 2026-09-27) — "Waiting for the DGS" while a course is unreviewed,
    // and (2026-10-03) "Graduate School approval pending" once the DGS has
    // decided and only §5.2's criterion 5 is left.
    ...(status === 'needs_dgs_review'
      ? { statusLabel: 'Waiting for the DGS' }
      : status === 'in_progress' && transfers.length > 0 && !transfers.some((c) => !c.superseded && c.approvalPending)
        ? { statusLabel: 'Graduate School approval pending' }
        : {}),
    ...joinedDetail(parts),
    citation: { section: opts.section, quote },
  };
}
