// A qualifier component completed after §4.4's four semesters waits for the
// DGS (policy review round 3, P3-cse-4a-2; DGS 2026-10-06: "Apply the
// handling with option A"). §4.4: "Students must complete all three
// components of the qualifier requirement within four (4) semesters of
// starting; the DGS may extend the deadline on a case-by-case basis." A core
// or specialization course still open after the deadline read Overdue, and
// the same course, once graded, read Met and "Complete" with the completion-
// form reminder — while a late research pass (2026-09-13) and a late seminar
// (2026-10-04) go to the DGS. Now a late course-based component does too,
// judged by the semester it was FIRST complete.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { audit } from '../src/engine/audit.ts';
import type { CourseEntry, Student, Term } from '../src/engine/types.ts';
import { actionItems } from '../src/ui/advisor-summary.ts';
import { buildRules } from './helpers.ts';
import { ndCourse, phdStudent } from './helpers/student.ts';

const rules = buildRules();
const fall = (year: number): Term => ({ season: 'fall', year });
const spring = (year: number): Term => ({ season: 'spring', year });
/** Entered Fall 2024: the four semesters end with Spring 2026. The core
 * courses pass (B-, below the specialization's B floor, except Architecture);
 * the specialization's groups are Architecture (Spring 2025), Systems (Fall
 * 2025) and, last, Data Science (`third`). */
const record = (third: CourseEntry, extra: Partial<Student> = {}, more: CourseEntry[] = []): Student =>
  phdStudent({
    entryTerm: fall(2024),
    bachelorsAwarded: spring(2024),
    gpa: 3.5,
    courses: [
      ndCourse('CSE 60641', { term: fall(2024), grade: 'B-' }),
      ndCourse('CSE 60111', { term: fall(2024), grade: 'B-' }),
      ndCourse('CSE 60321', { term: spring(2025) }),
      ndCourse('CSE 60770', { term: fall(2025) }),
      third,
      ...more,
    ],
    milestones: { advisorIdentified: '2024-10-01', advisorName: 'Prof. Example', advisorTtt: 'yes', researchQualifierPassed: '2025-12-01' },
    ...extra,
  });
const rowsOf = (s: Student, today: string) => {
  const report = audit(s, rules, today);
  const find = (id: string) => report.requirements.find((r) => r.id === id)!;
  return { report, find };
};

describe('a specialization completed after the four semesters (P3-cse-4a-2, option A)', () => {
  it('goes to the DGS, and so does the qualifier — no "Complete", no form reminder', () => {
    const { report, find } = rowsOf(record(ndCourse('CSE 60535', { term: fall(2026) })), '2027-01-20');
    const cat = find('phd.qualifier.categories');
    assert.equal(cat.status, 'needs_dgs_review');
    assert.equal(cat.completedLate, true);
    assert.deepEqual(cat.completedIn, fall(2026));
    assert.match(cat.detail, /Completed in Fall 2026, after the four semesters \(§4\.4\) — confirm the DGS extended the deadline/);
    assert.equal(cat.deadline?.label, 'Done Fall 2026 — after the end of Spring 2026');
    const q = find('phd.qualifier');
    assert.equal(q.status, 'needs_dgs_review');
    assert.equal(q.completedLate, true);
    assert.equal(q.deadline?.label, 'Completed after the deadline — waiting for the DGS');
    assert.match(q.detail, /^3 of 3 parts done — 1 after the deadline, waiting for the DGS\./);
    assert.match(q.detail, /Completed after the deadline: specialization \(§4\.4\.2\) in Fall 2026 — the DGS confirms the extension; then file the qualifier completion form with the Grad Admin \(§4\.4\)/);
    assert.doesNotMatch(q.detail, /Remember to file|Overdue/);
    assert.match(report.milestoneDeadlines?.qualifierFormFiled?.basis ?? '', /^No deadline of its own — every part is done, some after the deadline; once the DGS confirms the extension, file the completion form with the Grad Admin \(§4\.4\)$/);
    const dgs = actionItems(report).dgs;
    assert.ok(dgs.includes('Confirm that you extended my qualifier deadline — I completed the specialization courses in Fall 2026 after it (§4.4).'), JSON.stringify(dgs));
  });
  it('Spring 2027 the same', () => {
    const { find } = rowsOf(record(ndCourse('CSE 60535', { term: spring(2027) })), '2027-06-01');
    assert.equal(find('phd.qualifier.categories').status, 'needs_dgs_review');
    assert.equal(find('phd.qualifier').status, 'needs_dgs_review');
  });
  it('inside the DGS’s extension it stays Met, and says so', () => {
    const { find } = rowsOf(record(ndCourse('CSE 60535', { term: fall(2026) }), { attestations: { qualifierExtensionSemesters: 1 } }), '2027-01-20');
    const cat = find('phd.qualifier.categories');
    assert.equal(cat.status, 'met');
    assert.equal(cat.completedLate, undefined);
    assert.match(cat.detail, /Completed in Fall 2026, within the DGS’s one-semester extension \(§4\.4\)/);
    const q = find('phd.qualifier');
    assert.equal(q.status, 'met');
    assert.equal(q.deadline?.label, 'Complete');
  });
  it('after the extension too: confirm with the DGS', () => {
    const { find } = rowsOf(record(ndCourse('CSE 60535', { term: spring(2027) }), { attestations: { qualifierExtensionSemesters: 1 } }), '2027-06-01');
    const cat = find('phd.qualifier.categories');
    assert.equal(cat.status, 'needs_dgs_review');
    assert.match(cat.detail, /Completed in Spring 2027, after the DGS’s one-semester extension ran out at the end of Fall 2026 \(§4\.4\) — confirm with the DGS/);
  });
  it('judged by the earliest courses that meet it: an extra course later does not make an on-time student late', () => {
    const { find } = rowsOf(record(ndCourse('CSE 60868', { term: spring(2026) }), {}, [ndCourse('CSE 60535', { term: fall(2026) })]), '2027-01-20');
    const cat = find('phd.qualifier.categories');
    assert.equal(cat.status, 'met', cat.detail);
    assert.deepEqual(cat.completedIn, spring(2026));
    assert.doesNotMatch(cat.detail, /Completed in/);
    assert.equal(find('phd.qualifier').status, 'met');
  });
});

describe('a core area completed after the four semesters', () => {
  /** 24 regular credits by Fall 2026, everything else for the OCE in place; Algorithms first passed in Fall 2026. */
  const lateAlgorithms = (): Student =>
    phdStudent({
      entryTerm: fall(2024),
      bachelorsAwarded: spring(2024),
      gpa: 3.6,
      courses: [
        ndCourse('CSE 60641', { term: fall(2024) }),
        ndCourse('CSE 60321', { term: fall(2024) }),
        ndCourse('CSE 60770', { term: spring(2025) }),
        ndCourse('CSE 60535', { term: spring(2025) }),
        ndCourse('CSE 60427', { term: fall(2025) }),
        ndCourse('CSE 60762', { term: fall(2025) }),
        ndCourse('CSE 60868', { term: spring(2026) }),
        ndCourse('CSE 60111', { term: fall(2026) }),
      ],
      fullTimeTermOverrides: [fall(2024), spring(2025), fall(2025), spring(2026)],
      milestones: { advisorIdentified: '2024-10-01', advisorName: 'Prof. Example', advisorTtt: 'yes', rcrTrainingCompleted: '2025-09-15', researchQualifierPassed: '2025-12-01' },
    });
  it('the area waits for the DGS; the email asks for the extension, not a course review', () => {
    const { report, find } = rowsOf(lateAlgorithms(), '2027-01-20');
    const alg = find('phd.qualifier.core.algorithms');
    assert.equal(alg.status, 'needs_dgs_review');
    assert.match(alg.detail, /^Satisfied by CSE 60111\. Completed in Fall 2026, after the four semesters/);
    assert.equal(find('phd.qualifier').status, 'needs_dgs_review');
    const dgs = actionItems(report).dgs;
    assert.ok(dgs.includes('Confirm that you extended my qualifier deadline — I completed the Algorithms core-knowledge course in Fall 2026 after it (§4.4).'), JSON.stringify(dgs));
    assert.ok(!dgs.some((d) => /named in the review request/.test(d)), JSON.stringify(dgs));
  });
  it('the OCE gate counts it as done coursework (§4.5): the lateness is the qualifier’s question', () => {
    const { find } = rowsOf(lateAlgorithms(), '2027-01-20');
    const admission = find('phd.candidacyAdmission');
    assert.doesNotMatch(admission.detail, /^Not started/);
    assert.equal(find('phd.candidacy').status, 'in_progress');
  });
  it('a core course from before the Ph.D. is on time', () => {
    const s = lateAlgorithms();
    s.courses = s.courses.map((c) => (c.courseId === 'CSE 60111' ? { ...c, term: spring(2023), origin: 'transfer' as const, institution: 'University of Notre Dame' } : c));
    const alg = rowsOf(s, '2027-01-20').find('phd.qualifier.core.algorithms');
    assert.equal(alg.status, 'met', alg.detail);
  });
});

describe('a late research pass after the four semesters (the umbrella follows the component)', () => {
  it('the qualifier waits for the DGS instead of reading Overdue', () => {
    const s = record(ndCourse('CSE 60868', { term: spring(2026) }));
    s.milestones = { ...s.milestones, researchQualifierPassed: '2026-09-01' };
    const { report, find } = rowsOf(s, '2027-01-20');
    assert.equal(find('phd.qualifier.research').status, 'needs_dgs_review');
    const q = find('phd.qualifier');
    assert.equal(q.status, 'needs_dgs_review');
    assert.match(q.detail, /Completed after the deadline: the research component \(§4\.4\.3\) — the DGS confirms the extension/);
    const dgs = actionItems(report).dgs;
    assert.ok(dgs.some((d) => d.startsWith('Confirm the late research-component result')), JSON.stringify(dgs));
    assert.ok(!dgs.some((d) => d.startsWith('Confirm that you extended my qualifier deadline')), JSON.stringify(dgs));
  });
});
