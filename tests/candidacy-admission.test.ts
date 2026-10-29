// The Oral Candidacy Exam and admission to doctoral candidacy are two rows
// (DGS 2026-10-04, P2-dh-3.21-3.24-16): "OCE and doctoral candidacy are two
// different things. One can pass OCE first and then enter the doctoral
// candidacy later. Passing OCE is one of the requirements of doctoral
// candidacy." The OCE row keeps §4.5's exam and its coursework condition; the
// admission row (phd.candidacyAdmission) carries the Graduate School's
// conditions — Academic Code §6.2.9 and the DGS Handbook's list (§3.22.3) —
// and its eighth-semester deadline (§5.7.3, §3.22.3).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { audit } from '../src/engine/audit.ts';
import type { CourseEntry, Milestones, Student, Term } from '../src/engine/types.ts';
import { actionItems, advisorSummary } from '../src/ui/advisor-summary.ts';
import { gradAdminRequest } from '../src/ui/grad-admin-request.ts';
import { doesNotApply, scoredRows } from '../src/ui/report.ts';
import { buildRules } from './helpers.ts';
import { ndCourse, phdStudent, transferCourse } from './helpers/student.ts';

const rules = buildRules();
const fall = (year: number): Term => ({ season: 'fall', year });
const spring = (year: number): Term => ({ season: 'spring', year });
const REGULAR = ['CSE 60641', 'CSE 60111', 'CSE 60321', 'CSE 60427', 'CSE 60535', 'CSE 60762', 'CSE 60770', 'CSE 60876'];
/** A Fall 2026 entrant with the 24 regular credits over the first four
 * semesters, those four ticked full-time, a 3.6 GPA and the RCR training. */
function ready(milestones: Milestones, over: Partial<Student> = {}): Student {
  const terms = [fall(2026), spring(2027), fall(2027), spring(2028)];
  return phdStudent({
    gpa: 3.6,
    courses: REGULAR.map((id, i) => ndCourse(id, { term: terms[Math.floor(i / 2)]! })),
    fullTimeTermOverrides: terms,
    milestones: { advisorIdentified: '2026-10-01', advisorName: 'Prof. Example', advisorTtt: 'yes', rcrTrainingCompleted: '2027-09-15', ...milestones },
    ...over,
  });
}
const rows = (s: Student, today: string) => {
  const r = audit(s, rules, today);
  return { report: r, oce: r.requirements.find((x) => x.id === 'phd.candidacy')!, admission: r.requirements.find((x) => x.id === 'phd.candidacyAdmission')! };
};

describe('the OCE passed is not yet admission to candidacy (P2-dh-3.21-3.24-16)', () => {
  it('an OCE passed in the third semester: the OCE row is Met, admission waits for the fourth full-time semester', () => {
    // The review's own case, moved to this fixture's calendar: the exam in
    // semester 3 (Fall 2027), three full-time semesters so far.
    // The coursework complete or in progress by the exam's semester (P3-cse-4b-1, 2026-10-06).
    const firstThree = [fall(2026), spring(2027), fall(2027)];
    const s = ready({ candidacyPassed: '2027-12-10' }, { fullTimeTermOverrides: firstThree, courses: REGULAR.map((id, i) => ndCourse(id, { term: firstThree[Math.min(2, Math.floor(i / 3))]! })) });
    const { oce, admission } = rows(s, '2028-01-15');
    assert.equal(oce.status, 'met');
    assert.match(oce.detail, /Passing the OCE is one of the conditions for admission to doctoral candidacy|Passing the Oral Candidacy Exam \(OCE\) is one of the conditions for admission to doctoral candidacy/);
    assert.equal(admission.status, 'in_progress');
    assert.equal(admission.title, 'Admitted to doctoral candidacy');
    assert.equal(admission.citation.section, 'Academic Code §6.2.9');
    assert.match(admission.detail, /Oral Candidacy Exam \(OCE\): passed 2027-12-10/);
    assert.match(admission.detail, /4 consecutive full-time semesters: 3 so far \(Fall 2026–Fall 2027\)/);
    assert.doesNotMatch(admission.detail, /Every condition is met/);
    assert.equal(admission.deadline?.label, 'Due by the end of Spring 2030 — semester 8 (approximate)');
  });

  it('the OCE row no longer weighs the GPA; the admission row does', () => {
    const { oce, admission } = rows(ready({ candidacyPassed: '2028-04-01' }, { gpa: 2.8 }), '2028-06-01');
    assert.equal(oce.status, 'met');
    assert.doesNotMatch(oce.detail, /GPA/);
    assert.match(admission.detail, /Cumulative GPA of 3\.0 or better: 2\.80 — below it/);
    assert.equal(admission.status, 'in_progress');
  });

  it('the coursework condition stays on the exam (§4.5): an OCE dated with credits short goes to the DGS', () => {
    const s = ready({ candidacyPassed: '2027-04-01' }, { courses: [ndCourse('CSE 60641')] });
    const { oce, admission } = rows(s, '2027-06-01');
    assert.equal(oce.status, 'needs_dgs_review');
    assert.match(oce.detail, /At the exam \(Spring 2027\) you show 3 of 24 regular-course credits/);
    assert.match(admission.detail, /Coursework: 3 of 24 regular-course credits complete/);
  });
});

describe('every condition met, not yet admitted', () => {
  const s = ready({ candidacyPassed: '2028-04-01' });
  const today = '2028-06-01';
  it('the row says to apply, and names the Graduate School’s form', () => {
    const { admission } = rows(s, today);
    assert.equal(admission.status, 'in_progress');
    assert.match(admission.detail, /4 consecutive full-time semesters: done \(Fall 2026–Spring 2028\)/);
    assert.match(admission.detail, /Coursework: 24 of 24 regular-course credits complete/);
    assert.match(admission.detail, /Every condition is met: apply now — the Grad Admin submits the Graduate School’s Application for Admission to Doctoral Candidacy/);
  });
  it('the advisor summary and the processing request carry the application', () => {
    const { report } = rows(s, today);
    const items = actionItems(report);
    assert.ok(items.student.some((t) => /^Apply for admission to doctoral candidacy through the Grad Admin by the end of Spring 2030 \(Academic Code §6\.2\.9\)\.$/.test(t)), JSON.stringify(items.student));
    assert.ok(items.gradAdmin.includes('Submit my Application for Admission to Doctoral Candidacy to the Graduate School (DGS Handbook §3.22.3).'), JSON.stringify(items.gradAdmin));
    const { text } = gradAdminRequest(report, s, rules, { todayIso: today, entryTerm: 'Fall 2026', priorStudy: 'None', gpa: 3.6 });
    // No handbook sections in the request (DGS 2026-10-28).
    assert.match(text, /\d\. Initiate my Application for Admission to Doctoral Candidacy — the self-check shows every condition met\.\n/);
    assert.match(text, /\nADMISSION TO DOCTORAL CANDIDACY\n/);
    assert.doesNotMatch(text, /§/);
    // A major event: it makes the Grad Admin button active (DGS 2026-10-15).
    const { items: ga } = gradAdminRequest(report, s, rules, { todayIso: today, entryTerm: 'Fall 2026', priorStudy: 'None', gpa: 3.6 });
    // The item itself keeps its section (it feeds the page card).
    assert.ok(ga.actions.includes('Initiate my Application for Admission to Doctoral Candidacy — the self-check shows every condition met (DGS Handbook §3.22.3).'), JSON.stringify(ga.actions));
    assert.equal(ga.candidacyApplicationDue, true);
    assert.ok(ga.count >= 1 && ga.lines.some((l) => l.startsWith('Application for Admission to Doctoral Candidacy')), JSON.stringify(ga.lines));
  });
});

describe('a dated admission', () => {
  it('on time: Met, and the time-limit row counts it', () => {
    const { oce, admission } = rows(ready({ candidacyPassed: '2028-04-01', candidacyAdmitted: '2028-05-01' }), '2028-06-01');
    assert.equal(admission.status, 'met');
    assert.equal(admission.detail, 'Admitted to doctoral candidacy 2028-05-01.');
    assert.doesNotMatch(oce.detail, /one of the conditions for admission/);
  });
  it('after the eighth semester: the DGS confirms the standing', () => {
    const { admission } = rows(ready({ candidacyPassed: '2030-04-01', candidacyAdmitted: '2030-09-15' }), '2030-10-01');
    assert.equal(admission.status, 'needs_dgs_review');
    assert.match(admission.detail, /Completed after the end of Spring 2030 — semester 8 \(approximate\) — you may have been placed on probation \(Academic Code §5\.7\.3\), and admission after the eighth semester risks the loss of Graduate School funding/);
    assert.equal(admission.completedLate, true, 'late only: the eight-year row counts it done');
  });
  it('before the OCE date: the dates are checked with the DGS', () => {
    const { admission } = rows(ready({ candidacyPassed: '2028-04-01', candidacyAdmitted: '2028-03-01' }), '2028-06-01');
    assert.equal(admission.status, 'needs_dgs_review');
    assert.match(admission.detail, /The admission date is before the Oral Candidacy Exam \(OCE\) date \(2028-04-01\)/);
  });
  it('with no OCE date: Met, and the OCE row asks for its date instead of reading Overdue', () => {
    const { oce, admission } = rows(ready({ candidacyAdmitted: '2028-05-01' }), '2030-10-01');
    assert.equal(admission.status, 'met');
    assert.equal(oce.status, 'cannot_evaluate');
    assert.equal(oce.deadline, undefined);
    assert.match(oce.detail, /^Admitted to doctoral candidacy 2028-05-01\. Enter the date you passed the Oral Candidacy Exam \(OCE\) under Milestones — admission to candidacy requires it \(Academic Code §6\.2\.9\)\.$/);
  });
  it('below the 3.0 GPA: the date goes to the DGS (§2.2, as the dated candidacy did since 2026-09-12)', () => {
    const { admission } = rows(ready({ candidacyPassed: '2028-04-01', candidacyAdmitted: '2028-05-01' }, { gpa: 2.8 }), '2028-06-01');
    assert.equal(admission.status, 'needs_dgs_review');
    assert.equal(admission.completedLate, undefined);
    assert.match(admission.detail, /You show a 2\.80 GPA — §2\.2 requires a 3\.0 for admission to candidacy; confirm your admission with the DGS/);
  });
  it('late but complete: the eight-year row still reads Met', () => {
    const s = ready({ candidacyPassed: '2030-04-01', candidacyAdmitted: '2030-09-15', researchQualifierPassed: '2027-11-01', defensePassed: '2031-11-10', dissertationSubmitted: '2031-12-01' }, {
      courses: [...REGULAR.map((id, i) => ndCourse(id, { term: [fall(2026), spring(2027), fall(2027), spring(2028)][Math.floor(i / 2)]! })), ndCourse('CSE 63801', { credits: 1 }), ndCourse('CSE 63802', { credits: 1, term: spring(2027) }), ...[fall(2026), spring(2027), fall(2027), spring(2028)].map((t) => ndCourse('CSE 98900', { credits: 9, term: t, grade: 'S' }))],
    });
    const { report, admission } = rows(s, '2032-01-15');
    assert.equal(admission.status, 'needs_dgs_review');
    const limit = report.requirements.find((r) => r.id === 'phd.timeLimit')!;
    assert.equal(limit.status, 'met', limit.detail);
  });
});

describe('a record whose dissertation milestones are dated but not the admission', () => {
  it('asks for the admission date — no “apply now”, no probation — and the eight-year row cannot judge yet', () => {
    // Every saved record predates the admission field (review of the split, 2026-10-04).
    const s = ready({ candidacyPassed: '2029-04-01', defensePassed: '2031-11-10', dissertationSubmitted: '2031-12-01' });
    const { report, admission } = rows(s, '2035-02-01');
    assert.equal(admission.status, 'cannot_evaluate');
    assert.equal(admission.deadline, undefined);
    assert.match(admission.detail, /^Admission date not entered\. Your dissertation milestones are dated, so enter the date you were admitted to doctoral candidacy under Milestones\.$/);
    const items = actionItems(report);
    assert.ok(!items.student.some((t) => /Apply for admission/.test(t)) && !items.dgs.some((t) => /candidacy-admission/.test(t)), JSON.stringify(items));
    const limit = report.requirements.find((r) => r.id === 'phd.timeLimit')!;
    assert.equal(limit.status, 'cannot_evaluate');
    assert.match(limit.detail, /a value is missing from the rules sheet or from your record, and that row says which/);
  });
});

describe('a late OCE still leaves the application to make (review of the split, 2026-10-04)', () => {
  it('the advisor summary and the processing request agree', () => {
    const s = ready({ candidacyPassed: '2030-09-15' });
    const { report, oce, admission } = rows(s, '2030-10-01');
    assert.equal(oce.status, 'needs_dgs_review');
    assert.equal(admission.status, 'unmet');
    const items = actionItems(report);
    assert.ok(items.student.some((t) => t.startsWith('Apply for admission to doctoral candidacy through the Grad Admin')), JSON.stringify(items.student));
    assert.ok(items.gradAdmin.includes('Submit my Application for Admission to Doctoral Candidacy to the Graduate School (DGS Handbook §3.22.3).'));
    assert.ok(items.dgs.includes('Advise the student on the Graduate School’s consequence for the missed candidacy-admission deadline (DGS Handbook §3.22.3).'), JSON.stringify(items.dgs));
    const { text } = gradAdminRequest(report, s, rules, { todayIso: '2030-10-01', entryTerm: 'Fall 2026', priorStudy: 'None', gpa: 3.6 });
    assert.match(text, /Initiate my Application for Admission to Doctoral Candidacy/);
  });
  it('the emails read in the first person without “admits I” or the page’s Milestones card', () => {
    const opts = (todayIso: string) => ({ todayIso, entryTerm: 'Fall 2026', priorStudy: 'None', gpa: 3.6 });
    const notYet = advisorSummary(rows(ready({}), '2030-10-01').report, opts('2030-10-01'));
    const ready2 = advisorSummary(rows(ready({ candidacyPassed: '2028-04-01' }), '2028-06-01').report, opts('2028-06-01'));
    const late = advisorSummary(rows(ready({ candidacyPassed: '2030-04-01', candidacyAdmitted: '2030-09-15' }), '2030-10-01').report, opts('2030-10-01'));
    for (const t of [notYet.text, ready2.text, late.text]) {
      assert.doesNotMatch(t, /admits I\b|placed I\b|under Milestones/, t);
    }
    assert.match(late.text, /I may have been placed on probation \(Academic Code §5\.7\.3\)/);
  });
});

describe('the eighth semester', () => {
  it('not admitted by then: Overdue, with the Graduate School’s probation', () => {
    const { admission } = rows(ready({ candidacyPassed: '2028-04-01' }), '2030-08-01');
    assert.equal(admission.status, 'unmet');
    assert.equal(admission.deadline?.state, 'overdue');
    assert.match(admission.detail, /the Graduate School may place a student not admitted to doctoral candidacy by the end of the eighth semester on probation \(Academic Code §5\.7\.3\)/);
  });
  it('the Spring 2020 cohort: the ninth semester, with the probation (DGS 2026-10-04: Appendix A.4’s silence about admission is an oversight)', () => {
    const s = ready({ candidacyPassed: '2023-04-20' }, { entryTerm: fall(2019), fullTimeTermOverrides: [fall(2019), spring(2020), fall(2020), spring(2021)], courses: REGULAR.map((id, i) => ndCourse(id, { term: [fall(2019), spring(2020), fall(2020), spring(2021)][Math.floor(i / 2)]! })) });
    const { admission } = rows(s, '2026-10-04');
    assert.equal(admission.status, 'unmet');
    assert.equal(admission.deadline?.label, 'Overdue — the deadline was the end of Fall 2023 — semester 9 (approximate)');
    assert.match(admission.detail, /Overdue — the Graduate School may place a student not admitted to doctoral candidacy by the end of the ninth semester on probation \(Academic Code §5\.7\.3, Appendix A\.4\), and the student risks the loss of Graduate School funding \(DGS Handbook §3\.22\.3\)/);
    // Admitted after the ninth semester: the late note names both.
    const late = rows(ready({ candidacyPassed: '2023-04-20', candidacyAdmitted: '2024-03-01' }, { entryTerm: fall(2019), fullTimeTermOverrides: [fall(2019), spring(2020), fall(2020), spring(2021)], courses: REGULAR.map((id, i) => ndCourse(id, { term: [fall(2019), spring(2020), fall(2020), spring(2021)][Math.floor(i / 2)]! })) }), '2026-10-04').admission;
    assert.equal(late.status, 'needs_dgs_review');
    assert.match(late.detail, /you may have been placed on probation \(Academic Code §5\.7\.3, Appendix A\.4\), and admission after the ninth semester risks the loss of Graduate School funding/);
  });
  it('the Spring 2020 cohort’s overdue OCE names the ninth semester and Appendix A.4 (policy review round 3, P3-ac-6.2-app-3 (a))', () => {
    const terms = [fall(2019), spring(2020), fall(2020), spring(2021)];
    const s = ready({}, { entryTerm: fall(2019), fullTimeTermOverrides: terms, courses: REGULAR.map((id, i) => ndCourse(id, { term: terms[Math.floor(i / 2)]! })) });
    const { oce } = rows(s, '2026-10-04');
    assert.equal(oce.status, 'unmet');
    assert.match(oce.detail, /not passed the candidacy exam by the end of the ninth semester on probation and discontinues University funding \(Academic Code §6\.2\.8, Appendix A\.4\)/);
    // Everyone else: the eighth, §6.2.8 alone.
    const regular = rows(ready({}), '2030-08-01').oce;
    assert.match(regular.detail, /by the end of the eighth semester on probation and discontinues University funding \(Academic Code §6\.2\.8\); talk to the DGS/);
  });
  it('moves with an approved leave before the eighth semester, as the OCE’s does', () => {
    const { oce, admission } = rows(ready({}, { leaveSemesters: 1, leaveTerms: [spring(2029)] }), '2027-01-15');
    assert.equal(admission.deadline?.label, oce.deadline?.label);
    assert.equal(admission.deadline?.label, 'Due by the end of Fall 2030 — semester 9 (approximate)');
  });
  // P3-ac-5a-1 (DGS 2026-10-05, option (a)): only a medical leave before the end of the
  // eighth semester of enrollment moves the deadline; an accommodation counts by
  // the semester of the birth or adoption (option 1).
  it('a leave after the eighth semester, or one whose semester is not given, does not move it', () => {
    const after = rows(ready({}, { leaveSemesters: 1, leaveTerms: [fall(2030)] }), '2027-01-15');
    assert.equal(after.oce.deadline?.label, 'Due by the end of Spring 2030 — semester 8 (approximate)');
    assert.match(after.oce.detail, /Not moved by the 1 medical leave semester after it: only a medical leave before the end of your eighth semester of enrollment, or an accommodation for a birth or adoption in or before it, moves this deadline/);
    const unplaced = rows(ready({}, { leaveSemesters: 1 }), '2027-01-15');
    assert.equal(unplaced.oce.deadline?.label, 'Due by the end of Spring 2030 — semester 8 (approximate)');
    assert.match(unplaced.oce.detail, /Enter which semester your medical leave was under Your standing/);
    // Its time limit moves either way.
    assert.match(unplaced.report.requirements.find((x) => x.id === 'phd.timeLimit')!.detail, /extended by 1 semester on approved medical leave/);
  });
  it('an accommodation for a birth in the eighth semester moves it, even when taken in the ninth', () => {
    const birthIn8 = rows(ready({}, { accommodationSemesters: 1, accommodationEventTerms: [spring(2030)] }), '2027-01-15');
    assert.equal(birthIn8.oce.deadline?.label, 'Due by the end of Fall 2030 — semester 9 (approximate)');
    assert.match(birthIn8.oce.detail, /Semester 8 is counted as semester 9 — extended by 1 childbirth\/adoption accommodation for a birth or adoption in or before it/);
    const summerAfter = rows(ready({}, { accommodationSemesters: 1, accommodationEventTerms: [{ season: 'summer', year: 2030 }] }), '2027-01-15');
    assert.equal(summerAfter.oce.deadline?.label, 'Due by the end of Spring 2030 — semester 8 (approximate)', 'a birth in the summer after the eighth semester is after it');
  });
  it('a leave before the eighth semester pushes it past the leave; leaves both sides count only the one before', () => {
    const both = rows(ready({}, { leaveSemesters: 2, leaveTerms: [fall(2028), spring(2031)] }), '2027-01-15');
    assert.equal(both.oce.deadline?.label, 'Due by the end of Fall 2030 — semester 9 (approximate)');
    assert.match(both.oce.detail, /extended by 1 semester on approved medical leave before it/);
  });
});

// One card for the OCE, the RCR training and admission to candidacy (DGS
// 2026-10-04: "These seem to overlap. Can they be merged into one card?").
describe('the merged candidacy card', () => {
  const rulesM = buildRules();
  const reqs = (s: Student, today: string, r = rulesM) => audit(s, r, today).requirements;
  // A student whose OCE coursework is done (DGS 2026-10-05: the 24
  // regular-course credits and the qualifier's course components): eight
  // regular courses, the first three filling the core areas and three
  // specialization groups.
  const s = phdStudent({
    entryTerm: { season: 'fall', year: 2026 },
    // Two semesters: Academic Code §3.8 counts at most 15 graduate credits a semester.
    courses: REGULAR.map((id, i) => ndCourse(id, { term: i < 4 ? { season: 'fall', year: 2026 } : { season: 'spring', year: 2027 } })),
    // A tenured or tenure-track advisor (DGS 2026-10-05: without one the OCE is Not started).
    milestones: { advisorIdentified: '2025-10-01', advisorName: 'Prof. Example', advisorTtt: 'yes' },
  });

  it('the OCE and RCR rows are kept, unscored and shown inside the admission card', () => {
    const r = reqs(s, '2027-03-01');
    for (const id of ['phd.candidacy', 'phd.rcr']) {
      const row = r.find((x) => x.id === id)!;
      assert.equal(row.mergedInto, 'phd.candidacyAdmission', id);
      assert.equal(row.unscored, true, id);
    }
    const admission = r.find((x) => x.id === 'phd.candidacyAdmission')!;
    assert.match(admission.detail, /Responsible Conduct of Research and ethics training: not yet/);
    assert.match(admission.detail, /Complete the Graduate School’s 3-hour ethics workshop \(two 90-minute sessions/);
  });

  it('an OCE deadline earlier than the admission’s shows on the OCE line, and an overdue OCE makes the card Overdue', () => {
    const early = buildRules({ parameters: { candidacy_deadline_semester: '6' } });
    const open = reqs(s, '2027-03-01', early).find((x) => x.id === 'phd.candidacyAdmission')!;
    assert.match(open.detail, /Oral Candidacy Exam \(OCE\): not yet — due by the end of Spring 2029 — semester 6 \(approximate\)/);
    const late = reqs(s, '2029-09-01', early).find((x) => x.id === 'phd.candidacyAdmission')!;
    assert.equal(late.status, 'unmet');
    assert.equal(late.deadline!.state, 'overdue');
    assert.match(late.detail, /Oral Candidacy Exam \(OCE\): Overdue — the Graduate School places a student who has not passed the candidacy exam/);
  });

  it('a missing OCE parameter is said on the card, which cannot be evaluated', () => {
    const missing = buildRules({ parameters: { candidacy_deadline_semester: null } });
    const card = reqs(s, '2027-03-01', missing).find((x) => x.id === 'phd.candidacyAdmission')!;
    assert.equal(card.status, 'cannot_evaluate');
    assert.match(card.detail, /Oral Candidacy Exam \(OCE\): .*candidacy_deadline_semester/);
  });

});

// The OCE waits for the coursework (CSE §4.5; DGS 2026-10-05: "both 24 credits
// of regular courses and course components of the qualifier examination are
// needed (either completed or expected to complete in the same semester)").
describe('the OCE and admission wait for the coursework', () => {
  const rulesQ = buildRules();
  const row = (st: Student, id: string, today: string) => audit(st, rulesQ, today).requirements.find((x) => x.id === id)!;
  const fall26 = { season: 'fall' as const, year: 2026 };
  const spring27 = { season: 'spring' as const, year: 2027 };

  it('a first-year student: both Not started, with the eighth-semester deadline still shown', () => {
    const st = phdStudent({ entryTerm: fall26 });
    for (const id of ['phd.candidacy', 'phd.candidacyAdmission']) {
      const r = row(st, id, '2026-10-04');
      assert.equal(r.status, 'unmet', id);
      assert.match(r.detail, /^Not started\./, id);
      assert.ok(r.deadline, id);
    }
  });

  it('the last courses in progress THIS semester: the OCE can be taken — without the research component', () => {
    const st = phdStudent({
      entryTerm: fall26,
      courses: REGULAR.map((id, i) => ndCourse(id, { term: i < 4 ? fall26 : spring27, ...(i < 4 ? {} : { grade: 'IP' as const }) })),
      milestones: { advisorIdentified: '2025-10-01', advisorName: 'Prof. Example', advisorTtt: 'yes' },
    });
    assert.equal(row(st, 'phd.candidacy', '2027-03-01').status, 'in_progress');
    // …but not while those courses are a semester away.
    assert.equal(row(st, 'phd.candidacy', '2026-11-01').status, 'unmet');
  });

  it('the qualifier’s course components done but the 24 credits short: Not started', () => {
    const st = phdStudent({ entryTerm: fall26, courses: REGULAR.slice(0, 3).map((id) => ndCourse(id, { term: fall26 })) });
    const d = row(st, 'phd.candidacy', '2027-03-01').detail;
    assert.match(d, /^Not started\. Becomes In progress once your coursework is complete or completing this semester, with a tenured or tenure-track advisor: Regular-course credits: 9 of 24 complete — 15 more needed \(transferred regular-course credits count\);/);
    assert.match(d, /The OCE can be scheduled in the semester your coursework is complete or in its last semester — still needed: 15 more regular-course credits and an advisor who is tenured or tenure-track CSE faculty\./);
  });

  it('transferred regular-course credits count toward the 24', () => {
    const st = phdStudent({
      entryTerm: fall26,
      priorMs: 'completed',
      bachelorsAwarded: { season: 'spring', year: 2022 },
      courses: [...REGULAR.slice(0, 7).map((id, i) => ndCourse(id, { term: i < 4 ? fall26 : spring27 })), transferCourse('CS 50300', 'Operating Systems', { institution: 'Purdue University', degreeLevel: 'masters' })],
      milestones: { advisorIdentified: '2025-10-01', advisorName: 'Prof. Example', advisorTtt: 'yes' },
    });
    assert.equal(row(st, 'phd.candidacy', '2027-03-01').status, 'in_progress');
    assert.match(row(st, 'phd.candidacyAdmission', '2027-03-01').detail, /Coursework: 24 of 24 regular-course credits complete \(transferred regular-course credits count\)/);
  });

  it('past the eighth semester it still reads Overdue', () => {
    const r = row(phdStudent({ entryTerm: fall26 }), 'phd.candidacy', '2030-09-01');
    assert.equal(r.deadline!.state, 'overdue');
    assert.doesNotMatch(r.detail, /^Not started/);
  });
});

// Every condition for admission to doctoral candidacy on the card (DGS
// 2026-10-05: "Doctoral candidacy has more conditions than this. Double check …
// Check all the policies and include them in this card."), as page-only
// Relevant Policies: the emails keep the facts.
describe('every condition for admission to doctoral candidacy', () => {
  const rulesC = buildRules();
  const fresh = phdStudent({ entryTerm: fall(2026) });
  const card = (st: Student, today: string) => audit(st, rulesC, today).requirements.find((x) => x.id === 'phd.candidacyAdmission')!;

  it('the Not-started card lists them all under Relevant Policies', () => {
    const r = card(fresh, '2026-10-04');
    assert.match(r.detail, /^Not started\./);
    const notes = (r.detailParts ?? []).filter((p): p is { note: string; pageOnly?: true } => typeof p === 'object' && 'note' in p);
    const text = notes.map((n) => n.note).join(' | ');
    for (const re of [
      /Enrolled in the Ph\.D\. program and registered/,
      /Four consecutive semesters at full-time status in the program — at least 9 credit hours each fall and spring/,
      /the 24 regular-course credits \(§4\.2\) — transferred regular-course credits count/,
      /A cumulative GPA of 3\.0 or better/,
      /All training modules for the Responsible Conduct of Research and ethics/,
      /in CSE the written part is the dissertation proposal/,
      /send the DGS a written request naming your committee/,
      /At least one dissertation advisor who is tenured or tenure-track Notre Dame faculty, or a co-advisor who is/,
      /CSE has no language requirement \(§5\.3\)/,
      /official undergraduate transcript \(or diploma\)/,
      /Be admitted by the end of your eighth semester/,
    ])
      assert.match(text, re);
    assert.ok(notes.filter((n) => n.pageOnly).length >= 11);
  });

  it('the policies stay on the page: the processing request does not carry them', () => {
    const report = audit(fresh, rulesC, '2026-10-04');
    const { text } = gradAdminRequest(report, fresh, rulesC, { todayIso: '2026-10-04', entryTerm: 'Fall 2026', priorStudy: 'None', gpa: undefined });
    assert.doesNotMatch(text, /official undergraduate transcript \(or diploma\)|send the DGS a written request naming your committee/);
  });

  it('in progress: the advisor’s faculty status and this semester’s registration are said', () => {
    const st = ready({}, {});
    const r = card(st, '2028-03-01');
    assert.match(r.detail, /Tenured or tenure-track dissertation advisor: yes/);
    assert.match(r.detail, /Registered this semester \(Spring 2028\): 6 credits entered/);
    // Without a tenured or tenure-track advisor the card is Not started (DGS
    // 2026-10-05), and its list says so; once the OCE is passed it stays a
    // condition of admission, said on the in-progress card.
    assert.match(card(ready({ advisorTtt: 'no' }), '2028-03-01').detail, /^Not started\..*Tenured or tenure-track advisor: no or not sure \(see the advisor card\)/);
    assert.match(card(ready({ advisorTtt: undefined }), '2028-03-01').detail, /^Not started\..*Tenured or tenure-track advisor: not answered \(Milestones\)/);
    assert.match(card(ready({ advisorTtt: 'no', candidacyPassed: '2028-02-01' }), '2028-03-01').detail, /Tenured or tenure-track dissertation advisor: no or not sure — a tenured or tenure-track co-advisor is needed, or the DGS’s approval for one tenured or tenure-track in another department/);
    assert.match(card(ready({}), '2028-09-20').detail, /Registered this semester \(Fall 2028\): no Notre Dame course entered/);
  });
});

// "This seems to satisfy the condition to make OCE/candidacy in progress, but
// it is still marked as not started. Why?" (DGS 2026-10-05, with a printout):
// the card now says why, and only the courses the coursework needs are read.
describe('why the OCE is not started yet', () => {
  const rulesW = buildRules();
  const fall25 = { season: 'fall' as const, year: 2025 };
  const spring26 = { season: 'spring' as const, year: 2026 };
  const fall26w = { season: 'fall' as const, year: 2026 };
  const spring27w = { season: 'spring' as const, year: 2027 };
  const card = (st: Student, today: string) => audit(st, rulesW, today).requirements.find((x) => x.id === 'phd.candidacyAdmission')!;
  // The printout's shape: 18 regular credits done (Architecture core and three
  // specialization groups among them), Operating Systems in progress this
  // semester, one more regular course in progress next semester — and no
  // Algorithms core course at all.
  const printout = (extra: CourseEntry[] = []) =>
    phdStudent({
      entryTerm: fall25,
      gpa: 3.6,
      courses: [
        ...['CSE 60321', 'CSE 60427', 'CSE 60535'].map((id) => ndCourse(id, { term: fall25 })),
        ...['CSE 60762', 'CSE 60770', 'CSE 60876'].map((id) => ndCourse(id, { term: spring26 })),
        ndCourse('CSE 60641', { term: fall26w, grade: 'IP' }),
        ndCourse('CSE 60868', { term: spring27w, grade: 'IP' }),
        ...extra,
      ],
      milestones: { advisorIdentified: '2025-10-01', advisorName: 'Prof. Example', advisorTtt: 'yes', researchQualifierPassed: '2026-09-15' },
    });

  it('a core-knowledge area with no course: the card names it', () => {
    const r = card(printout(), '2026-10-05');
    assert.equal(r.status, 'unmet');
    assert.match(r.detail, /^Not started\. Becomes In progress once your coursework is complete or completing this semester, with a tenured or tenure-track advisor: Regular-course credits: 18 of 24 complete, 6 in progress — complete at the end of Spring 2027 \(transferred regular-course credits count\); Core knowledge: 1 of 3 areas done — Operating Systems: in progress \(CSE 60641, Fall 2026\), Algorithms: no course yet; Specialization courses: done; Tenured or tenure-track advisor: yes\. The OCE can be scheduled in the semester your coursework is complete or in its last semester — still needed: an Algorithms core-knowledge course\./);
  });

  it('every component under way, the last one next semester: the card names that semester', () => {
    const r = card(printout([ndCourse('CSE 60111', { term: spring27w, grade: 'IP' })]), '2026-10-05');
    assert.match(r.detail, /Core knowledge: 1 of 3 areas done — Operating Systems: in progress \(CSE 60641, Fall 2026\), Algorithms: in progress \(CSE 60111, Spring 2027\);/);
    assert.match(r.detail, /\. The OCE can be scheduled in Spring 2027 at the earliest, the semester your coursework is expected to be complete\./);
    // …and in that semester it is under way.
    assert.equal(card(printout([ndCourse('CSE 60111', { term: spring27w, grade: 'IP' })]), '2027-02-15').status, 'in_progress');
  });

  it('a course the coursework does not need, dated next semester, does not hold the OCE back', () => {
    const st = phdStudent({
      entryTerm: fall25,
      gpa: 3.6,
      courses: [
        ...['CSE 60641', 'CSE 60111', 'CSE 60321', 'CSE 60427'].map((id) => ndCourse(id, { term: fall25 })),
        ...['CSE 60535', 'CSE 60762', 'CSE 60770'].map((id) => ndCourse(id, { term: spring26 })),
        ndCourse('CSE 60876', { term: fall26w, grade: 'IP' }),
        // Next semester's research registration, already entered.
        ndCourse('CSE 98900', { term: spring27w, grade: 'IP', credits: 6 }),
      ],
      milestones: { advisorIdentified: '2025-10-01', advisorName: 'Prof. Example', advisorTtt: 'yes' },
    });
    assert.equal(card(st, '2026-10-05').status, 'in_progress');
  });
});

// "When something is 'does not apply', hide it and do not show it. Then,
// adjust the x of y met numbers accordingly." (DGS 2026-10-05): which rows the
// page leaves out, and the headline already does not count them.
describe('rows that do not apply', () => {
  const rulesN = buildRules();
  it('the transfer row with no transfer course does not apply; an unused allowance and the along-the-way MSCSE still show', () => {
    const report = audit(phdStudent({ entryTerm: fall(2026) }), rulesN, '2026-10-05');
    const byId = (id: string) => report.requirements.find((x) => x.id === id)!;
    assert.equal(doesNotApply(byId('phd.transfer')), true);
    assert.equal(doesNotApply(byId('phd.cap.fourk')), false);
    assert.equal(doesNotApply(byId('phd.msAlongTheWay')), false);
    assert.ok(!scoredRows(report).some(doesNotApply), 'never counted in x of y');
  });
});

// "When there is no TTT advisor, it also makes OCE/candidacy not started.
// Add that." (DGS 2026-10-05; §2.3: "A research advisor must be a Tenure and
// Tenure Track (TTT) faculty member of the department").
describe('the OCE waits for a tenured or tenure-track advisor', () => {
  const rulesA = buildRules();
  const fallA = { season: 'fall' as const, year: 2026 };
  const springA = { season: 'spring' as const, year: 2027 };
  // The coursework done in two semesters; only the advisor varies.
  const st = (milestones: Milestones) =>
    phdStudent({ entryTerm: fallA, courses: REGULAR.map((id, i) => ndCourse(id, { term: i < 4 ? fallA : springA })), milestones });
  const card = (m: Milestones) => audit(st(m), rulesA, '2027-09-15').requirements.find((x) => x.id === 'phd.candidacyAdmission')!;
  const oce = (m: Milestones) => audit(st(m), rulesA, '2027-09-15').requirements.find((x) => x.id === 'phd.candidacy')!;

  it('a TTT advisor, or a TTT co-advisor beside a non-TTT advisor: under way', () => {
    assert.equal(card({ advisorName: 'Prof. A', advisorTtt: 'yes' }).status, 'in_progress');
    assert.equal(card({ advisorName: 'Prof. A', advisorTtt: 'no', advisorName2: 'Prof. B', advisorTtt2: 'yes' }).status, 'in_progress');
  });

  it('no advisor, an unanswered faculty status, or a no: Not started, and the card says what is still needed', () => {
    const none = card({});
    assert.match(none.detail, /^Not started\..*Tenured or tenure-track advisor: no advisor entered\. The OCE can be scheduled once you have an advisor who is tenured or tenure-track CSE faculty\./);
    assert.match(card({ advisorName: 'Prof. A' }).detail, /Tenured or tenure-track advisor: not answered \(Milestones\)\. The OCE can be scheduled once you have answered your advisor’s faculty status under Milestones\./);
    assert.match(card({ advisorName: 'Prof. A', advisorTtt: 'no' }).detail, /Tenured or tenure-track advisor: no or not sure \(see the advisor card\)\. The OCE can be scheduled once you have a tenured or tenure-track advisor or co-advisor\./);
    assert.equal(oce({ advisorName: 'Prof. A', advisorTtt: 'unsure' }).status, 'unmet');
    assert.match(oce({ advisorName: 'Prof. A', advisorTtt: 'unsure' }).detail, /^Not started\./);
  });

  it('a coursework semester still to come and no TTT advisor: both are named', () => {
    const later = phdStudent({ entryTerm: fallA, courses: REGULAR.map((id, i) => ndCourse(id, { term: i < 4 ? fallA : springA, ...(i < 4 ? {} : { grade: 'IP' as const }) })), milestones: {} });
    assert.match(audit(later, rulesA, '2026-11-01').requirements.find((x) => x.id === 'phd.candidacyAdmission')!.detail, /The OCE can be scheduled in Spring 2027 at the earliest, the semester your coursework is expected to be complete — still needed: an advisor who is tenured or tenure-track CSE faculty\./);
  });
});


// The rows merged into the admission card still count for the eight-year row
// (policy review round 3, P3-ac-6.2-app-4): a dated admission with the
// training's or the OCE's date blank is a date missing from the record — the
// card says so, and the eight-year row does not read "complete".
describe('a dated admission with a blank OCE or training date (P3-ac-6.2-app-4)', () => {
  const done = { researchQualifierPassed: '2027-11-01', candidacyPassed: '2028-04-01', candidacyAdmitted: '2028-05-01', defensePassed: '2030-04-01', dissertationSubmitted: '2030-04-20', advisorName: 'Prof. Example', advisorTtt: 'yes' as const };
  it('the training’s date blank: named on the card, and the eight-year row is not complete', () => {
    const { report, admission } = rows(ready({ ...done, rcrTrainingCompleted: undefined }), '2030-05-01');
    assert.match(admission.detail, /Responsible Conduct of Research and ethics training: date not entered/);
    const limit = report.requirements.find((r) => r.id === 'phd.timeLimit')!;
    assert.notEqual(limit.status, 'met');
    assert.doesNotMatch(limit.detail, /All requirements are complete/);
    // The hidden training row is a date missing from the record, which the
    // eight-year row reads; entered, it is done.
    assert.equal(report.requirements.find((r) => r.id === 'phd.rcr')!.status, 'cannot_evaluate');
    const entered = rows(ready({ ...done, rcrTrainingCompleted: '2027-09-01' }), '2030-05-01').report.requirements.find((r) => r.id === 'phd.rcr')!;
    assert.equal(entered.status, 'met', entered.detail);
  });
  it('the OCE’s date blank: “date not entered”, not the admission repeated', () => {
    const { admission } = rows(ready({ ...done, candidacyPassed: undefined, rcrTrainingCompleted: '2027-09-01' }), '2030-05-01');
    assert.match(admission.detail, /Oral Candidacy Exam \(OCE\): date not entered/);
    assert.doesNotMatch(admission.detail, /Oral Candidacy Exam \(OCE\): Admitted to doctoral candidacy/);
  });
});
