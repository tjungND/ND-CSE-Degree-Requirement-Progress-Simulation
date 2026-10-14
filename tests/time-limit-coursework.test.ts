// Coursework counts toward "all requirements" within the time limit (policy
// review round 3, P3-cse-3-1; DGS 2026-10-06: "Apply the suggested handling
// P3-cse-3-1. Apply the same change on PhD for symmetry."). CSE §3.3:
// "Failure to complete all requirements for the M.S. degree within 5 years
// results in forfeiture of degree eligibility"; Academic Code §6.1.4: "All
// requirements for the master's degree must be completed within five years"
// (§4.3 and Academic Code §6.2.6 for the Ph.D.'s eight). The completion date
// read only the milestones, so a course finished after the limit read
// "complete within the limit" once graded. Now each credit requirement is
// dated by the term in which its counted courses first reached the minimum.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { audit } from '../src/engine/audit.ts';
import type { CourseEntry, Student } from '../src/engine/types.ts';
import { buildRules, loadScenario } from './helpers.ts';
import { ndCourse, phdStudent } from './helpers/student.ts';

const rules = buildRules();
const fall = (year: number) => ({ season: 'fall' as const, year });
const spring = (year: number) => ({ season: 'spring' as const, year });
const row = (s: Student, today: string, id: string) => audit(s, rules, today).requirements.find((r) => r.id === id)!;

/** The finding's student: a part-time MSCSE project-option student who entered Fall 2021 (five years end at the start of Fall 2026), project report accepted 2023-05-01, 21 regular credits by Fall 2022. */
const mscse = (late: CourseEntry[]): Student =>
  phdStudent({
    program: 'mscse',
    msOption: 'project',
    entryTerm: fall(2021),
    bachelorsAwarded: spring(2021),
    gpa: 3.6,
    courses: [
      ...['CSE 60641', 'CSE 60111', 'CSE 60321', 'CSE 60535'].map((id) => ndCourse(id, { term: fall(2021) })),
      ...['CSE 60762', 'CSE 60770', 'CSE 60876'].map((id) => ndCourse(id, { term: fall(2022) })),
      ndCourse('CSE 68902', { term: spring(2023), credits: 6 }),
      ...late,
    ],
    fullTimeTermOverrides: [fall(2021)],
    milestones: { advisorIdentified: '2021-10-01', advisorName: 'Prof. Example', projectReportAccepted: '2023-05-01' },
    attestations: { advisorApprovedPlan: true },
  });

describe('the MSCSE five years (CSE §3.3; Academic Code §6.1.4)', () => {
  it('the 24th regular credit in Fall 2026, after the limit: Eligibility at risk, naming the course and term', () => {
    const r = row(mscse([ndCourse('CSE 60427', { term: fall(2026) })]), '2027-01-20', 'ms.timeLimit');
    assert.equal(r.status, 'needs_dgs_review');
    assert.equal(r.statusLabel, 'Eligibility at risk');
    assert.match(r.detail, /^Every counted requirement is complete, but the last one was completed after the 5-year limit passed at the start of Fall 2026 \(approximate\): CSE 60427, taken in Fall 2026, completed the 24 regular-course credits\./);
    assert.equal(r.deadline?.label, 'Done Fall 2026 — after the limit');
  });
  it('while that course is in progress the row still reads Overdue', () => {
    assert.equal(row(mscse([ndCourse('CSE 60427', { term: fall(2026), grade: 'IP' })]), '2026-10-20', 'ms.timeLimit').deadline?.state, 'overdue');
  });
  it('a surplus course after the limit is not flagged: the requirement was met before it', () => {
    const s = mscse([ndCourse('CSE 60427', { term: spring(2023) }), ndCourse('CSE 60657', { term: fall(2026) })]);
    const r = row(s, '2027-01-20', 'ms.timeLimit');
    assert.equal(r.status, 'met');
    // The master's candidacy application is open on this record (P3-dh-3.21-3.24-1).
    assert.match(r.detail, /^Every counted requirement is complete within the 5-year limit — the Application for Admission to Master’s Degree Candidacy is still open/);
    s.milestones = { ...s.milestones, msCandidacyApplied: '2026-10-01' };
    assert.match(row(s, '2027-01-20', 'ms.timeLimit').detail, /^All requirements are complete within the 5-year limit/);
  });
  it('the project credits count too: 6 credits of CSE 68902 finished after the limit', () => {
    const s = mscse([ndCourse('CSE 60427', { term: spring(2023) })]);
    s.courses = s.courses.map((c) => (c.courseId === 'CSE 68902' ? { ...c, credits: 3 } : c));
    s.courses.push(ndCourse('CSE 68902', { term: fall(2026), credits: 3, grade: 'A' }));
    const r = row(s, '2027-01-20', 'ms.timeLimit');
    assert.equal(r.statusLabel, 'Eligibility at risk');
    assert.match(r.detail, /CSE 68902, taken in Fall 2026, completed the 6 credits of M\.S\. project or thesis direction/);
  });
});

describe('the Ph.D. eight years, for symmetry (§4.3; Academic Code §6.2.6)', () => {
  // A complete record (entered Fall 2026; eight years end at the start of
  // Fall 2034) whose 60 total credits were reached only by research taken
  // after the limit, though the dissertation was submitted in 2031.
  const complete = (): Student => structuredClone(loadScenario('phd-rcr-and-submission-done').student);
  it('the complete record is met; the 60th credit after the limit makes it Eligibility at risk', () => {
    assert.equal(row(complete(), '2035-01-15', 'phd.timeLimit').status, 'met');
    const s = complete();
    // Spring 2028's research drops from 9 to 6 credits (still full-time with its course): 59 by Spring 2030.
    s.courses = s.courses.map((c) => (c.courseId === 'CSE 98900' && c.term.season === 'spring' && c.term.year === 2028 ? { ...c, credits: 6 } : c));
    s.courses.push(ndCourse('CSE 98900', { term: fall(2034), credits: 3, grade: 'S' }));
    const r = row(s, '2035-01-15', 'phd.timeLimit');
    assert.equal(r.status, 'needs_dgs_review');
    assert.equal(r.statusLabel, 'Eligibility at risk');
    assert.match(r.detail, /CSE 98900, taken in Fall 2034, completed the 60 total credits/);
  });
  it('a surplus course after the limit is not flagged', () => {
    const s = complete();
    s.courses.push(ndCourse('CSE 60657', { term: fall(2034) }));
    assert.equal(row(s, '2035-01-15', 'phd.timeLimit').status, 'met');
  });
});
