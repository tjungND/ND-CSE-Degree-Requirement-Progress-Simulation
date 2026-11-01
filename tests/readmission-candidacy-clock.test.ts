// The candidacy deadline after a readmission (policy review round 3,
// P3-ac-6.2-app-1; DGS 2026-10-06: "The clock counts by calendar semesters
// regardless of the gap. However, exceptions can be approved by the graduate
// school when requested by the DGS."). The eighth semester for the Oral
// Candidacy Exam and admission to candidacy counts the fall and spring
// semesters a readmitted student was away — only an approved leave is skipped
// — and while either is still to come, the rows say so and the review request
// asks the DGS whether to request the Graduate School's exception.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { audit } from '../src/engine/audit.ts';
import type { Student } from '../src/engine/types.ts';
import { buildRules } from './helpers.ts';
import { ndCourse, phdStudent } from './helpers/student.ts';

const rules = buildRules();
const TODAY = '2025-10-05';
const fall = (year: number) => ({ season: 'fall' as const, year });
const spring = (year: number) => ({ season: 'spring' as const, year });

/** The finding's student: entered Fall 2021, enrolled to Spring 2023, withdrew, readmitted Fall 2024. */
const readmitted = (over: Partial<Student> = {}): Student =>
  phdStudent({
    entryTerm: fall(2021),
    readmittedTerm: fall(2024),
    bachelorsAwarded: spring(2021),
    gpa: 3.6,
    courses: [ndCourse('CSE 60641', { term: fall(2021) }), ndCourse('CSE 60111', { term: spring(2022) }), ndCourse('CSE 60321', { term: fall(2024) })],
    ...over,
  });
const row = (s: Student, id: string) => audit(s, rules, TODAY).requirements.find((r) => r.id === id)!;
const NOTE = 'Counted in calendar semesters from Fall 2021, the semesters you were away before your readmission in Fall 2024 included (DGS 2026-10-06); the Graduate School can approve an exception when the DGS requests one (Academic Code §1)';
const ASK = /^Candidacy deadline after my readmission: /;

describe('a readmission’s gap is counted toward the eighth semester (DGS 2026-10-06)', () => {
  it('the calendar count stands: Spring 2025, overdue — and the rows say why and name the exception', () => {
    const oce = row(readmitted(), 'phd.candidacy');
    assert.equal(oce.deadline?.state, 'overdue');
    assert.match(oce.deadline!.label, /Spring 2025/);
    assert.ok(oce.detail.includes(`${NOTE}, and your review request asks`), oce.detail);
    const admission = row(readmitted(), 'phd.candidacyAdmission');
    assert.ok(admission.detail.includes(`${NOTE}, and your review request asks`), admission.detail);
    assert.equal(admission.detail.split('Counted in calendar semesters').length, 2, 'said once on the merged card, not again under the OCE');
  });
  it('an approved leave is still the one thing that moves it', () => {
    const onLeave = readmitted({ readmittedTerm: undefined, leaveSemesters: 2, leaveTerms: [fall(2023), spring(2024)] });
    assert.match(row(onLeave, 'phd.candidacy').deadline!.label, /Spring 2026/);
    assert.ok(!row(onLeave, 'phd.candidacy').detail.includes('Counted in calendar semesters'));
  });
  it('the review request asks the DGS whether to request the exception', () => {
    const flags = audit(readmitted(), rules, TODAY).reviewFlags ?? [];
    assert.ok(
      flags.includes(
        'Candidacy deadline after my readmission: my deadline for the Oral Candidacy Exam and admission to candidacy, the end of Spring 2025, counts the semesters I was away before my readmission in Fall 2024 (Academic Code §6.2.8; DGS Handbook §3.22.3; DGS 2026-10-06). Please decide whether to ask the Graduate School for an exception.',
      ),
      JSON.stringify(flags),
    );
    assert.ok(flags.some((f) => /^Readmission: I was readmitted in Fall 2024/.test(f)), 'the readmission line stays');
  });
  it('once the OCE is passed, only admission is asked about; once admitted too, nothing', () => {
    const passed = readmitted({ milestones: { candidacyPassed: '2025-04-20' } });
    assert.ok((audit(passed, rules, TODAY).reviewFlags ?? []).some((f) => f.startsWith('Candidacy deadline after my readmission: my deadline, the end of Spring 2025 for admission to candidacy, counts the semesters I was away')));
    const admitted = readmitted({ milestones: { candidacyPassed: '2025-04-20', candidacyAdmitted: '2025-05-01' } });
    assert.ok(!(audit(admitted, rules, TODAY).reviewFlags ?? []).some((f) => ASK.test(f)));
  });
  it('the warning says the time away is counted; an MSCSE record gets no candidacy question', () => {
    const w = audit(readmitted(), rules, TODAY).warnings.find((x) => x.startsWith('Readmitted Fall 2024'))!;
    assert.match(w, /the clocks still count from Fall 2021, your original matriculation, in calendar semesters with the time away included \(Academic Code §6\.2\.6; DGS 2026-10-06\)/);
    const ms = readmitted({ program: 'mscse', msOption: 'project' });
    assert.ok(!(audit(ms, rules, TODAY).reviewFlags ?? []).some((f) => ASK.test(f)));
  });
});
