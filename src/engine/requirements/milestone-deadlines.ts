// The deadline beside every date in the Milestones card (DGS 2026-10-04: "In
// the Milestones, next to all the dates, specify the deadlines."). Each one is
// the date the matching requirement row counts against — computed by the same
// helpers, so the card and the report cannot disagree — said without the
// row's state words. Nothing here changes a verdict. A deadline the record no
// longer has to meet (the other §3.4 route once one is complete, a form whose
// qualifier is complete) or one that is someone else's to meet (the DGS's
// committee) carries no state, so it is never shown as late or overdue; a
// missing date (an admission not entered on a record whose dissertation
// milestones are dated) is never called late either.
import { addMonthsIso, deadlineHorizon, deadlineTerm, endOfNextSemester, endOfTerm, startOfTerm, termLabel, compareTerm } from '../term.ts';
import type { MilestoneDateKey, MilestoneDeadline, RequirementResult } from '../types.ts';
import type { Ctx } from './context.ts';
import { clockShiftNote, graduateSchoolExtensionClause, timeLimitDate } from './context.ts';
import { SUMMER_ONLY_MS_TIME_LIMIT_YEARS, summerSessionOnly } from './mscse.ts';
import { ADMISSION_DEADLINE_SEMESTER, eighthSemester, qualifierDeadline, qualifierExtensionSemesters, qualifierPassedUnderPriorRules } from './phd.ts';

type Deadlines = Partial<Record<MilestoneDateKey, MilestoneDeadline>>;
type StateRule = MilestoneDeadline['state'] | false | 'auto';

/** "by the end of Spring 2030" / "before Fall 2034" / "by mid-Spring 2028". */
function duePhrase(iso: string): string {
  const { term, when } = deadlineTerm(iso);
  return when === 'end' ? `by the end of ${termLabel(term)}` : when === 'start' ? `before ${termLabel(term)}` : `by mid-${termLabel(term)}`;
}
/** "the end of Spring 2030" / "the start of Fall 2034" / "mid-Spring 2028". */
function pointPhrase(iso: string): string {
  const { term, when } = deadlineTerm(iso);
  return when === 'during' ? `mid-${termLabel(term)}` : `the ${when} of ${termLabel(term)}`;
}

/** A deadline and where a milestone dated `doneOn` (or not) stands against
 * it. `state: false` leaves the state out — for a deadline that is someone
 * else's to meet, one the record no longer has to meet, or one the record
 * cannot judge. `also` is a clause said while the deadline is still to be
 * met or was met, and left out once it has passed. */
function at(ctx: Ctx, iso: string, basis: string, doneOn: string | undefined, state: StateRule = 'auto', also?: string): MilestoneDeadline {
  const out: MilestoneDeadline = { due: duePhrase(iso), point: pointPhrase(iso), basis, date: iso, ...(also ? { also } : {}) };
  if (state === false) return out;
  if (state !== 'auto') return { ...out, state };
  if (doneOn) return { ...out, state: doneOn <= iso ? 'done' : 'late' };
  if (ctx.today > iso) return { ...out, state: 'overdue' };
  const horizon = deadlineHorizon(iso, ctx.today);
  return horizon ? { ...out, state: 'due_soon', horizon } : { ...out, state: 'open' };
}

/** ", extended by the DGS by one semester" — the §4.4 extension in the
 * words the research qualifier and the qualifier rows use. */
function extensionClause(extra: number): string {
  return extra > 0 ? `, extended by the DGS by ${extra === 1 ? 'one semester' : `${extra} semesters`}` : '';
}

/** The master's candidacy application has no date of its own (Academic Code
 * §6.1.6: "The applicable deadline is published in the Graduate School
 * calendar") — 2026-10-04. */
const MS_CANDIDACY_BASIS = 'No date of its own — by the Graduate School calendar’s deadline for the semester you graduate in (Academic Code §6.1.6)';

/** The Ph.D.'s milestones. */
export function phdMilestoneDeadlines(ctx: Ctx, rows: readonly RequirementResult[]): Deadlines {
  const m = ctx.student.milestones;
  const out: Deadlines = {};
  const dissertationDated = !!(m.defensePassed || m.dissertationSubmitted);
  // §2.3 sets no date for a Ph.D. advisor: "Continuous advisor supervision is
  // required throughout the duration of the Ph.D. program."
  out.advisorIdentified = { basis: 'No deadline of its own — continuous advisor supervision is required throughout the Ph.D. (§2.3)' };
  // The MSCSE along the way's candidacy application (2026-10-04).
  out.msCandidacyApplied = { basis: MS_CANDIDACY_BASIS };

  const fromTransfer = compareTerm(ctx.qualifierEntry, ctx.entry) !== 0;
  const qualifierMet = rows.find((r) => r.id === 'phd.qualifier')?.status === 'met';
  // Every part done, some after the deadline (P3-cse-4a-2, DGS 2026-10-06):
  // the form waits for the DGS's confirmation, and the box says so.
  const qualifierLate = rows.find((r) => r.id === 'phd.qualifier')?.completedLate === true;
  const courseComponentsDone = rows.find((r) => r.id === 'phd.qualifier')?.qualifierCourseComponentsDone === true;
  if (qualifierPassedUnderPriorRules(ctx)) {
    const basis = 'Does not apply — you passed the qualifying examination under the earlier requirements';
    out.researchQualifierPassed = { basis };
    out.researchQualifierFailed = { basis };
    // The form is still asked for (the qualifier row: "If the completion form
    // is not on file, file it with the Grad Admin"); only its date is not.
    out.qualifierFormFiled = {
      basis: `No deadline of its own — you passed the qualifying examination under the earlier requirements${m.qualifierFormFiled ? '' : '; if the completion form is not on file, file it with the Grad Admin (§4.4)'}`,
    };
  } else {
    // §4.4.3: "Within 18 months of the student entering the program, the
    // research advisor must determine whether the student has passed or
    // failed the research component" — with the DGS's extension in semesters,
    // as researchQualifierRow counts it.
    const months = ctx.params.number('research_qualifier_deadline_months');
    if (months !== undefined) {
      const date = addMonthsIso(startOfTerm(ctx.qualifierEntry).date, months);
      const extra = qualifierExtensionSemesters(ctx);
      const effective = extra > 0 ? endOfNextSemester(date, extra) : date;
      const from = fromTransfer ? 'your transfer into the Ph.D.' : 'entry';
      const failedOn = m.researchQualifierFailed;
      if (failedOn) {
        // After a fail the DGS's committee has six months for its final
        // judgement (§4.4.3: "forming a final judgement on the case within 6
        // months"), and a pass recorded then is measured against that date —
        // as researchQualifierRow measures it (2026-10-04). The fail box
        // carries the date without a state: it is the committee's to meet.
        const remediation = addMonthsIso(failedOn, 6);
        out.researchQualifierPassed = at(ctx, remediation, 'after the fail, the DGS’s committee decides within six months (§4.4.3)', m.researchQualifierPassed);
        out.researchQualifierFailed = at(ctx, remediation, 'the DGS’s committee decides within six months of the fail (§4.4.3)', undefined, false);
      } else {
        // With the dissertation dated and no date here, the date is missing,
        // not late (P4-phd-3, DGS 2026-10-11) — no state, as the OCE's box.
        out.researchQualifierPassed = at(ctx, effective, `${months} months after ${from}${extensionClause(extra)} (§4.4.3)`, m.researchQualifierPassed, dissertationDated && !m.researchQualifierPassed ? false : 'auto');
        out.researchQualifierFailed = at(ctx, effective, `the advisor’s pass or fail, ${months} months after ${from}${extensionClause(extra)} (§4.4.3)`, undefined, false);
      }
    }
    // §4.4: "Students must complete all three components of the qualifier
    // requirement within four (4) semesters of starting". The form records
    // the completion ("When the student has completed the qualifier course
    // requirement, they must notify the CSE DGS office by filing the
    // appropriate form") and has no date of its own: once the qualifier's
    // COURSE components are complete — core knowledge, specialization and the
    // nine Notre Dame credits (policy review round 3, P3-cse-4a-3; DGS
    // 2026-10-07: option (a)) — the box says so instead of a date.
    const due = qualifierDeadline(ctx);
    const semesters = ctx.params.number('qualifier_deadline_semesters');
    if (qualifierMet) {
      out.qualifierFormFiled = { basis: `No deadline of its own — the qualifier is complete${m.qualifierFormFiled ? '' : '; file the completion form with the Grad Admin'} (§4.4)` };
    } else if (courseComponentsDone) {
      out.qualifierFormFiled = { basis: `No deadline of its own — the qualifier’s course components are complete${m.qualifierFormFiled ? '' : '; file the completion form with the Grad Admin'} (§4.4)` };
    } else if (qualifierLate) {
      out.qualifierFormFiled = { basis: `No deadline of its own — every part is done, some after the deadline${m.qualifierFormFiled ? '' : '; once the DGS confirms the extension, file the completion form with the Grad Admin'} (§4.4)` };
    } else if (due !== undefined && semesters !== undefined) {
      const basis = `the qualifier’s ${semesters} semesters${fromTransfer ? ', counted from your transfer' : ''}${extensionClause(qualifierExtensionSemesters(ctx))} (§4.4)`;
      out.qualifierFormFiled = at(ctx, due.effectiveDate, basis, m.qualifierFormFiled);
    }
  }

  // The Graduate School's eighth semester for admission (DGS Handbook
  // §3.22.3), which the RCR training is a condition of: the RCR box follows
  // the admission — done once admitted, no state while the admission itself
  // is a missing date (2026-10-04).
  const admission = eighthSemester(ctx, ADMISSION_DEADLINE_SEMESTER);
  const ordinal = (n: number) => ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'][n - 1] ?? `${n}th`;
  // "semester 8", or "semester 9: the eighth, extended" when a leave, an
  // accommodation or the Spring 2020 cohort moved it.
  const semesterBasis = (sem: number, effective: number, section: string) => `semester ${effective}${effective !== sem ? `: the ${ordinal(sem)}, extended` : ''} (${section})`;
  out.rcrTrainingCompleted = at(
    ctx,
    admission.date,
    'a condition of admission to doctoral candidacy (DGS Handbook §3.22.3)',
    m.rcrTrainingCompleted,
    m.candidacyAdmitted ? (m.rcrTrainingCompleted ? 'done' : false) : dissertationDated ? false : 'auto',
  );
  // §4.5: "The candidacy exam must be taken before the end of the eighth
  // semester in the program."
  const oceSem = ctx.params.number('candidacy_deadline_semester');
  if (oceSem !== undefined) {
    const oce = eighthSemester(ctx, oceSem);
    // An admission, a defense or a submission dated with no exam date: the
    // OCE row asks for the date; no state here either (P3-cse-4b-3).
    out.candidacyPassed = at(ctx, oce.date, semesterBasis(oceSem, oce.effectiveSem, '§4.5'), m.candidacyPassed, (m.candidacyAdmitted || dissertationDated) && !m.candidacyPassed ? false : 'auto');
  }
  out.candidacyAdmitted = at(
    ctx,
    admission.date,
    semesterBasis(ADMISSION_DEADLINE_SEMESTER, admission.effectiveSem, 'DGS Handbook §3.22.3'),
    m.candidacyAdmitted,
    // A record with dated dissertation milestones and no admission date is
    // missing a date, not late (the admission row says so).
    !m.candidacyAdmitted && dissertationDated ? false : 'auto',
  );

  // §4.3: "Failure to complete all requirements for the Ph.D. degree within
  // eight (8) years results in forfeiture of degree eligibility." The defense
  // and the submission also have the Graduate School calendar's dates for a
  // given graduation (DGS Handbook §3.22.4; Academic Code §6.2.12).
  const years = ctx.params.number('phd_time_limit_years');
  if (years !== undefined) {
    const limit = timeLimitDate(ctx, years);
    // The limit's own words, with what moved it (clockShiftNote: leaves,
    // accommodations, the Spring 2020 cohort's year, Academic Code Appendix A).
    const theLimit = `the ${years}-year limit (§4.3)${clockShiftNote(ctx)}${graduateSchoolExtensionClause(ctx, years)}`;
    const calendar = (section: string) => `to graduate in a given semester, also by that semester’s date on the Graduate School calendar (${section})`;
    out.defensePassed = at(ctx, limit, theLimit, m.defensePassed, 'auto', calendar('DGS Handbook §3.22.4'));
    out.dissertationSubmitted = at(ctx, limit, theLimit, m.dissertationSubmitted, 'auto', calendar('Academic Code §6.2.12'));
  }
  return out;
}

/** The MSCSE's milestones. */
export function msMilestoneDeadlines(ctx: Ctx): Deadlines {
  const m = ctx.student.milestones;
  const out: Deadlines = {};
  // §2.3: "M.S. students … are expected to identify a thesis or project
  // advisor by the end of their first semester, unless an exception is
  // granted by the ADGS." An advisor on record — dated or only named — is
  // done, as the advisor row reads it (an identification after the first
  // semester may be the ADGS's exception; the card does not call it late).
  const onRecord = !!(m.advisorIdentified || m.advisorName || m.advisorName2);
  out.advisorIdentified = at(ctx, endOfTerm(ctx.entry).date, 'your first semester (§2.3)', m.advisorIdentified, onRecord ? 'done' : 'auto');
  // Academic Code §6.1.6 dates the master's candidacy application by the
  // Graduate School calendar only (2026-10-04).
  out.msCandidacyApplied = { basis: MS_CANDIDACY_BASIS };
  // Academic Code §6.1.7 sets the topic no date: it comes before the defense.
  out.thesisTopicApproved = { basis: 'No deadline of its own — it comes before the thesis defense (§3.4; Academic Code §6.1.7)' };
  // §3.3: "Failure to complete all requirements for the M.S. degree within 5
  // years results in forfeiture of degree eligibility." §3.4 completes the
  // degree by either route: once one is complete, the other route's box
  // carries the date without a state (review of the card, 2026-10-04).
  const years = ctx.params.number('ms_time_limit_years');
  if (years !== undefined) {
    const limit = timeLimitDate(ctx, years);
    const theLimit = `the ${years}-year limit (§3.3)${clockShiftNote(ctx)}${graduateSchoolExtensionClause(ctx, years)}`;
    const thesisDone = !!m.thesisDefensePassed;
    const projectDone = !!m.projectReportAccepted;
    // A summer-session-only record (Academic Code §6.1.4; 2026-10-04): the
    // seven years may apply instead, as the DGS confirms — said beside the
    // five while they are open, and the date an open box counts against once
    // the five have passed inside the seven (the time-limit row then runs
    // against the seven too, not Overdue). A dated box keeps the five, as the
    // route rows do.
    const seven = summerSessionOnly(ctx) ? timeLimitDate(ctx, SUMMER_ONLY_MS_TIME_LIMIT_YEARS) : undefined;
    const sevenBasis = 'seven years if you attend summer sessions only, as the DGS confirms (Academic Code §6.1.4)';
    const routeBox = (doneOn: string | undefined, state: StateRule): MilestoneDeadline =>
      seven !== undefined && !doneOn && state === 'auto' && ctx.today > limit && ctx.today <= seven
        ? at(ctx, seven, sevenBasis, undefined)
        : at(ctx, limit, theLimit, doneOn, state, seven !== undefined ? `or ${duePhrase(seven)} if you attend summer sessions only — seven years (Academic Code §6.1.4), as the DGS confirms` : undefined);
    // After a failed first attempt the retake is due by the end of the
    // following semester (Academic Code §6.1.5, 2026-10-04) — that, not the
    // five years, is the defense's deadline then; the fail box carries it
    // without a state.
    if (m.thesisDefenseFailed) {
      const retakeDue = endOfNextSemester(m.thesisDefenseFailed, 1);
      out.thesisDefensePassed = at(ctx, retakeDue, 'the retake, if the program recommends one, by the end of the semester after the fail (Academic Code §6.1.5)', m.thesisDefensePassed);
      out.thesisDefenseFailed = at(ctx, retakeDue, 'the retake, if the program recommends one, by the end of the following semester (Academic Code §6.1.5)', undefined, false);
    } else {
      out.thesisDefensePassed = routeBox(m.thesisDefensePassed, !thesisDone && projectDone ? false : 'auto');
      out.thesisDefenseFailed = { basis: 'No deadline of its own — after a failed attempt, one retake if the program recommends it, by the end of the following semester (Academic Code §6.1.5)' };
    }
    out.projectReportAccepted = routeBox(m.projectReportAccepted, !projectDone && thesisDone ? false : 'auto');
    // The final thesis to the Graduate School (Academic Code §6.1.8 —
    // 2026-10-04): inside the five years, and by the calendar's date for the
    // graduation wanted, as the Ph.D.'s submission box says.
    // A summer-session-only record gets the route boxes' seven-year switch,
    // keeping the calendar clause (policy review round 3, P3-text-engine-2;
    // DGS 2026-10-07: "apply the suggested handling"): the box read Overdue
    // at five years while the defense box and the time-limit row ran to the
    // seven.
    const calendar = 'to graduate in a given semester, also by that semester’s date on the Graduate School calendar (Academic Code §6.1.8)';
    out.thesisSubmitted =
      seven !== undefined && !m.thesisSubmitted && ctx.today > limit && ctx.today <= seven
        ? at(ctx, seven, sevenBasis, undefined, 'auto', calendar)
        : at(ctx, limit, theLimit, m.thesisSubmitted, 'auto', seven !== undefined ? `${calendar}; or ${duePhrase(seven)} if you attend summer sessions only — seven years (Academic Code §6.1.4), as the DGS confirms` : calendar);
  }
  return out;
}
