// The deadline beside every date in the Milestones card (DGS 2026-10-04: "In
// the Milestones, next to all the dates, specify the deadlines.").
// report.milestoneDeadlines (src/engine/requirements/milestone-deadlines.ts),
// worded by src/ui/milestone-deadline.ts. The cases after the first two are
// the adversarial review's (2026-10-04): the card must never raise an alarm
// the report does not, nor say "late" about a date that is merely missing.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { audit } from '../src/engine/audit.ts';
import type { MilestoneDateKey, Student } from '../src/engine/types.ts';
import { deadlineText } from '../src/ui/milestone-deadline.ts';
import { allScenarios, buildRules } from './helpers.ts';
import { ndCourse, phdStudent } from './helpers/student.ts';

const rules = buildRules();
const deadlines = (s: Student, today: string) => audit(s, rules, today).milestoneDeadlines ?? {};
const texts = (s: Student, today: string) => Object.fromEntries(Object.entries(deadlines(s, today)).map(([k, v]) => [k, deadlineText(v!)]));
const mscse = (over: Partial<Student> = {}): Student => ({ schemaVersion: 1, program: 'mscse', entryTerm: { season: 'fall', year: 2026 }, priorMs: 'none', courses: [], milestones: {}, attestations: {}, ...over });
const fall = (year: number) => ({ season: 'fall' as const, year });
const spring = (year: number) => ({ season: 'spring' as const, year });

const PHD_KEYS: MilestoneDateKey[] = ['advisorIdentified', 'researchQualifierPassed', 'researchQualifierFailed', 'qualifierFormFiled', 'rcrTrainingCompleted', 'candidacyPassed', 'candidacyAdmitted', 'defensePassed', 'dissertationSubmitted', 'msCandidacyApplied'];
const MS_KEYS: MilestoneDateKey[] = ['advisorIdentified', 'thesisTopicApproved', 'thesisDefensePassed', 'thesisDefenseFailed', 'thesisSubmitted', 'projectReportAccepted', 'msCandidacyApplied'];

describe('every date in the card has its deadline', () => {
  it('Ph.D., a Fall 2026 entrant in the first semester', () => {
    const t = texts(phdStudent(), '2026-10-04');
    assert.deepEqual(Object.keys(t).sort(), [...PHD_KEYS].sort());
    assert.deepEqual(t, {
      advisorIdentified: 'No deadline of its own — continuous advisor supervision is required throughout the Ph.D. (§2.3)',
      researchQualifierPassed: 'Due by mid-Spring 2028 — 18 months after entry (§4.4.3)',
      researchQualifierFailed: 'Due by mid-Spring 2028 — the advisor’s pass or fail, 18 months after entry (§4.4.3)',
      qualifierFormFiled: 'Due by the end of Spring 2028 — the qualifier’s 4 semesters (§4.4)',
      rcrTrainingCompleted: 'Due by the end of Spring 2030 — a condition of admission to doctoral candidacy (DGS Handbook §3.22.3)',
      candidacyPassed: 'Due by the end of Spring 2030 — semester 8 (§4.5)',
      candidacyAdmitted: 'Due by the end of Spring 2030 — semester 8 (DGS Handbook §3.22.3)',
      defensePassed: 'Due before Fall 2034 — the 8-year limit (§4.3); to graduate in a given semester, also by that semester’s date on the Graduate School calendar (DGS Handbook §3.22.4)',
      dissertationSubmitted: 'Due before Fall 2034 — the 8-year limit (§4.3); to graduate in a given semester, also by that semester’s date on the Graduate School calendar (Academic Code §6.2.12)',
      msCandidacyApplied: 'No date of its own — by the Graduate School calendar’s deadline for the semester you graduate in (Academic Code §6.1.6)',
    });
  });

  it('MSCSE: the advisor by the end of the first semester, the rest within the five years', () => {
    const t = texts(mscse(), '2026-10-04');
    assert.deepEqual(Object.keys(t).sort(), [...MS_KEYS].sort());
    assert.equal(t['advisorIdentified'], 'Due by the end of Fall 2026 — your first semester (§2.3) · due this semester');
    assert.equal(t['thesisDefensePassed'], 'Due before Fall 2031 — the 5-year limit (§3.3)');
  });
});

describe('the same date the requirement row counts against', () => {
  it('Ph.D.: OCE, admission, research qualifier, qualifier and the eight years', () => {
    const s = phdStudent({ entryTerm: fall(2024), leaveSemesters: 1, leaveTerms: [{ season: 'spring', year: 2026 }], attestations: { qualifierExtensionSemesters: 1 } });
    const r = audit(s, rules, '2025-10-01');
    const row = (id: string) => r.requirements.find((x) => x.id === id)!.deadline!.date;
    const d = r.milestoneDeadlines!;
    assert.equal(d.candidacyPassed!.date, row('phd.candidacy'));
    assert.equal(d.candidacyAdmitted!.date, row('phd.candidacyAdmission'));
    assert.equal(d.researchQualifierPassed!.date, row('phd.qualifier.research'));
    assert.equal(d.qualifierFormFiled!.date, row('phd.qualifier'));
    assert.equal(d.defensePassed!.date, row('phd.timeLimit'));
    assert.equal(deadlineText(d.candidacyPassed!), 'Due by the end of Fall 2028 — semester 9: the eighth, extended (§4.5)');
    assert.equal(deadlineText(d.qualifierFormFiled!), 'Due by the end of Fall 2026 — the qualifier’s 4 semesters, extended by the DGS by one semester (§4.4)');
    // The extension is named on the fail box too, not only on the pass box.
    assert.equal(deadlineText(d.researchQualifierFailed!), 'Due by the end of Fall 2026 — the advisor’s pass or fail, 18 months after entry, extended by the DGS by one semester (§4.4.3)');
    // The limit says what moved it.
    assert.equal(deadlineText(d.defensePassed!), 'Due by mid-Spring 2033 — the 8-year limit (§4.3) — extended by 1 semester on approved medical leave; to graduate in a given semester, also by that semester’s date on the Graduate School calendar (DGS Handbook §3.22.4)');
  });
  it('MSCSE: the advisor and the five years', () => {
    const r = audit(mscse(), rules, '2026-10-04');
    const row = (id: string) => r.requirements.find((x) => x.id === id)!.deadline!.date;
    assert.equal(r.milestoneDeadlines!.advisorIdentified!.date, row('shared.advisor'));
    assert.equal(r.milestoneDeadlines!.projectReportAccepted!.date, row('ms.timeLimit'));
  });
  it('the Spring 2020 cohort: the limit names Appendix A', () => {
    const t = texts(phdStudent({ entryTerm: fall(2019) }), '2026-10-04');
    assert.equal(t['defensePassed'], 'Due before Fall 2028 — the 8-year limit (§4.3) — extended by one year for students enrolled in Spring 2020 (Academic Code Appendix A); to graduate in a given semester, also by that semester’s date on the Graduate School calendar (DGS Handbook §3.22.4)');
  });
});

describe('where the record stands against it', () => {
  it('Overdue, late and on time, in the report’s words', () => {
    const s = phdStudent({ entryTerm: fall(2023), milestones: { researchQualifierPassed: '2025-06-01', candidacyPassed: '2026-04-15' } });
    const d = deadlines(s, '2026-10-04');
    assert.equal(d.researchQualifierPassed!.state, 'late');
    assert.equal(deadlineText(d.researchQualifierPassed!), 'Due by mid-Spring 2025 — 18 months after entry (§4.4.3). The date entered is after this deadline.');
    assert.equal(d.candidacyPassed!.state, 'done');
    assert.equal(deadlineText(d.candidacyPassed!), 'Due by the end of Spring 2027 — semester 8 (§4.5)');
    assert.equal(d.candidacyAdmitted!.state, 'due_soon');
    assert.match(deadlineText(d.candidacyAdmitted!), / · due next semester$/);
    const late = deadlines(phdStudent({ entryTerm: fall(2018) }), '2026-10-04');
    assert.equal(deadlineText(late.candidacyPassed!), 'Overdue — the deadline was the end of Fall 2022 — semester 9: the eighth, extended (§4.5)');
    // Once the limit has passed, the graduation-calendar clause is left out.
    const past = deadlines(phdStudent({ entryTerm: fall(2016) }), '2026-10-04');
    assert.equal(deadlineText(past.dissertationSubmitted!), 'Overdue — the deadline was the start of Fall 2025 — the 8-year limit (§4.3) — extended by one year for students enrolled in Spring 2020 (Academic Code Appendix A)');
  });

  it('the qualifier passed under the earlier rules: the research boxes do not apply; the form is still asked for', () => {
    const d = deadlines(phdStudent({ entryTerm: fall(2020), attestations: { qualifierPassedUnderPriorRules: true } }), '2026-10-04');
    assert.equal(deadlineText(d.researchQualifierPassed!), 'Does not apply — you passed the qualifying examination under the earlier requirements');
    assert.equal(deadlineText(d.qualifierFormFiled!), 'No deadline of its own — you passed the qualifying examination under the earlier requirements; if the completion form is not on file, file it with the Grad Admin (§4.4)');
  });

  it('a complete qualifier: the form has no date of its own', () => {
    const s = phdStudent({
      entryTerm: fall(2022),
      courses: [ndCourse('CSE 60111', { term: fall(2022) }), ndCourse('CSE 60321', { term: fall(2022) }), ndCourse('CSE 60641', { term: spring(2023) })],
      milestones: { researchQualifierPassed: '2023-12-01' },
    });
    const r = audit(s, rules, '2026-10-04');
    assert.equal(r.requirements.find((x) => x.id === 'phd.qualifier')!.status, 'met');
    assert.equal(deadlineText(r.milestoneDeadlines!.qualifierFormFiled!), 'No deadline of its own — the qualifier is complete; file the completion form with the Grad Admin (§4.4)');
  });

  it('after a fail, both research boxes use the committee’s six months; only the pass box carries a state', () => {
    const d = deadlines(phdStudent({ entryTerm: fall(2025), milestones: { researchQualifierFailed: '2026-09-01' } }), '2026-10-04');
    assert.equal(deadlineText(d.researchQualifierPassed!), 'Due by mid-Spring 2027 — after the fail, the DGS’s committee decides within six months (§4.4.3) · due next semester');
    assert.equal(d.researchQualifierFailed!.state, undefined, 'the committee’s date, not the student’s');
    assert.equal(deadlineText(d.researchQualifierFailed!), 'Due by mid-Spring 2027 — the DGS’s committee decides within six months of the fail (§4.4.3)');
    const past = deadlines(phdStudent({ entryTerm: fall(2022), milestones: { researchQualifierFailed: '2023-12-01' } }), '2026-10-04');
    assert.equal(past.researchQualifierPassed!.state, 'overdue');
    assert.equal(past.researchQualifierFailed!.state, undefined, 'one red line, on the pass box');
  });

  it('a pass inside the committee’s six months is on time — on the card and on the row', () => {
    const s = phdStudent({ entryTerm: fall(2025), milestones: { researchQualifierFailed: '2026-12-01', researchQualifierPassed: '2027-05-01' } });
    const r = audit(s, rules, '2027-05-02');
    assert.equal(r.milestoneDeadlines!.researchQualifierPassed!.state, 'done');
    const row = r.requirements.find((x) => x.id === 'phd.qualifier.research')!;
    assert.equal(row.status, 'met');
    assert.match(row.detail, /^Research qualifier passed 2027-05-01 — after a fail on 2026-12-01, within the DGS’s committee’s six months\./);
    // After the six months, the DGS confirms.
    const lateRow = audit(phdStudent({ entryTerm: fall(2025), milestones: { researchQualifierFailed: '2026-12-01', researchQualifierPassed: '2027-09-01' } }), rules, '2027-10-01').requirements.find((x) => x.id === 'phd.qualifier.research')!;
    assert.equal(lateRow.status, 'needs_dgs_review');
    assert.match(lateRow.detail, /after the DGS’s committee’s six months; confirm the outcome with the DGS \(§4\.4\.3\)/);
  });

  it('a transfer from the MSCSE: the qualifier clocks from the transfer, the eighth semester from the MSCSE start', () => {
    const s = phdStudent({ entryTerm: fall(2025), background: { bachelors: 'elsewhere', graduate: 'nd-mscse-transfer', transferredTerm: spring(2026) } });
    const t = texts(s, '2026-10-04');
    assert.equal(t['researchQualifierPassed'], 'Due by mid-Summer 2027 — 18 months after your transfer into the Ph.D. (§4.4.3) · due next semester');
    assert.equal(t['qualifierFormFiled'], 'Due by the end of Fall 2027 — the qualifier’s 4 semesters, counted from your transfer (§4.4)');
    assert.equal(t['candidacyPassed'], 'Due by the end of Spring 2029 — semester 8 (§4.5)');
  });

  it('missing dates are not called late: an admission without an OCE date, dissertation dated without an admission, and the RCR with them', () => {
    const d = deadlines(phdStudent({ entryTerm: fall(2020), milestones: { candidacyAdmitted: '2024-01-15', defensePassed: '2026-04-01' } }), '2026-10-04');
    assert.equal(d.candidacyPassed!.state, undefined);
    assert.equal(d.candidacyAdmitted!.state, 'done');
    assert.equal(d.rcrTrainingCompleted!.state, undefined, 'admitted: the RCR is not late, only not entered');
    assert.equal(d.researchQualifierPassed!.state, undefined, 'dissertation dated, research date blank: missing, not overdue (P4-phd-3)');
    const e = deadlines(phdStudent({ entryTerm: fall(2020), milestones: { candidacyPassed: '2023-04-01', defensePassed: '2026-04-01' } }), '2026-10-04');
    assert.equal(e.candidacyAdmitted!.state, undefined);
    assert.equal(e.rcrTrainingCompleted!.state, undefined, 'the RCR follows the admission’s missing-date rule');
    assert.equal(deadlineText(e.candidacyAdmitted!), 'Due by the end of Spring 2024 — semester 8 (DGS Handbook §3.22.3)');
    const f = deadlines(phdStudent({ entryTerm: fall(2020), milestones: { candidacyPassed: '2023-04-01', candidacyAdmitted: '2023-09-01', rcrTrainingCompleted: '2025-01-15' } }), '2026-10-04');
    assert.equal(f.rcrTrainingCompleted!.state, 'done', 'admitted on time: the RCR box follows the admission');
  });

  it('MSCSE: an advisor on record is done, dated after the first semester or only named', () => {
    assert.equal(deadlines(mscse({ entryTerm: fall(2025), milestones: { advisorName: 'Prof. Example' } }), '2026-10-04').advisorIdentified!.state, 'done');
    const d = deadlines(mscse({ entryTerm: fall(2025), milestones: { advisorIdentified: '2026-03-01' } }), '2026-10-04');
    assert.equal(d.advisorIdentified!.state, 'done');
    assert.equal(deadlineText(d.advisorIdentified!), 'Due by the end of Fall 2025 — your first semester (§2.3)');
  });

  it('MSCSE: once one route is complete, the other route raises nothing', () => {
    const sc = allScenarios().find((x) => x.name === 'mscse-thesis-complete')!;
    const s: Student = sc.student;
    for (const today of ['2031-05-01', '2031-10-01']) {
      const r = audit(s, buildRules(sc.rules.patch), today);
      assert.equal(r.requirements.find((x) => x.id === 'ms.timeLimit')!.status, 'met');
      for (const [k, v] of Object.entries(r.milestoneDeadlines ?? {})) assert.ok(v!.state !== 'overdue' && v!.state !== 'due_soon' && v!.state !== 'late', `${k} at ${today}: ${v!.state}`);
      assert.equal(r.milestoneDeadlines!.projectReportAccepted!.state, undefined);
    }
  });

  it('a parameter missing from the sheet: no deadline is shown for it', () => {
    const r = audit(phdStudent(), buildRules({ parameters: { candidacy_deadline_semester: null } }), '2026-10-04');
    assert.equal(r.milestoneDeadlines!.candidacyPassed, undefined);
    assert.ok(r.milestoneDeadlines!.candidacyAdmitted, 'the Graduate School’s own eighth semester does not need the sheet');
  });
});

// Appendix A: "Students enrolled during the spring 2020 semester" (policy
// review round 3, P3-ac-6.2-app-2; DGS 2026-10-07: option (a)). A Notre Dame
// graduate enrollment IN Spring 2020 puts a later Ph.D. entrant in the cohort;
// one that ended before it does not. Scenario phd-covid-cohort-through-nd-mscse
// has the MSCSE conferred in Spring 2020.
describe('the Spring 2020 cohort, read from Notre Dame graduate enrollment', () => {
  const ndMs = (courseId: string, term: Student['entryTerm']) => ({ courseId, credits: 3, term, grade: 'A' as const, origin: 'transfer' as const, institution: 'University of Notre Dame', degreeLevel: 'masters' as const });
  const limit = (s: Student) => audit(s, buildRules(), '2026-10-05').requirements.find((r) => r.id === 'phd.timeLimit')!.deadline?.label ?? '';
  const fall = (year: number) => ({ season: 'fall' as const, year });
  const spring = (year: number) => ({ season: 'spring' as const, year });
  it('a Notre Dame graduate course dated Spring 2020: in the cohort, with no conferral term on the record', () => {
    assert.match(limit(phdStudent({ entryTerm: fall(2020), courses: [ndMs('CSE 60001', spring(2020)), ndCourse('CSE 60641', { term: fall(2020) })] })), /^Due before Fall 2029/);
  });
  it('a master’s conferred in Spring 2019, its courses before then: not in the cohort', () => {
    assert.match(limit(phdStudent({ entryTerm: fall(2020), ndMasters: { term: spring(2019) }, courses: [ndMs('CSE 60001', fall(2017)), ndMs('CSE 60002', fall(2018)), ndCourse('CSE 60641', { term: fall(2020) })] })), /^Due before Fall 2028/);
  });
  it('an undergraduate course in Spring 2020 is not graduate enrollment', () => {
    const ug = { ...ndMs('CSE 40001', spring(2020)), degreeLevel: 'bachelors' as const };
    assert.match(limit(phdStudent({ entryTerm: fall(2020), courses: [ug, ndCourse('CSE 60641', { term: fall(2020) })] })), /^Due before Fall 2028/);
  });
});
