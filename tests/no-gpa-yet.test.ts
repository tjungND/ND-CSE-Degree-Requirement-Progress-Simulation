// "No GPA yet" for a first-semester student who has not finished a semester
// (DGS 2026-10-14: "Let's just say no GPA yet for the first-semester student
// who hasn't finished a semester yet"). The transcript of such a student prints
// 0.000 over 0 GPA hours; the GPA card used to ask for a figure, and the 0.000
// typed from that line read "below the 3.0 minimum".
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { audit } from '../src/engine/audit.ts';
import type { Student } from '../src/engine/types.ts';
import { actionItems, advisorSummary } from '../src/ui/advisor-summary.ts';
import { gradAdminRequest } from '../src/ui/grad-admin-request.ts';
import { buildRules } from './helpers.ts';
import { ndCourse, phdStudent, transferCourse } from './helpers/student.ts';

const rules = buildRules();
const fall2026 = { season: 'fall' as const, year: 2026 };
const inProgress = ['CSE 60111', 'CSE 60641', 'CSE 60321'].map((id) => ndCourse(id, { term: fall2026, grade: 'IP' }));
const newStudent = (over: Partial<Student> = {}): Student => phdStudent({ entryTerm: fall2026, gpa: undefined, courses: inProgress, ...over });
const gpaRow = (s: Student, today = '2026-10-14') => audit(s, rules, today).requirements.find((r) => r.id === 'shared.gpa')!;

describe('the GPA card in the first semester, before any grade', () => {
  it('says “No GPA yet” — in progress, nothing asked of the student', () => {
    const report = audit(newStudent(), rules, '2026-10-14');
    const row = report.requirements.find((r) => r.id === 'shared.gpa')!;
    assert.equal(row.status, 'in_progress');
    assert.equal(row.detail, 'No GPA yet.');
    assert.equal(report.noGpaYet, true);
    assert.ok(!actionItems(report).student.some((t) => /cumulative GPA/.test(t)));
  });

  it('a 0.00 typed from the transcript’s 0.000 line is no GPA either, never “below the minimum”', () => {
    const row = gpaRow(newStudent({ gpa: 0 }));
    assert.equal(row.status, 'in_progress');
    assert.equal(row.detail, 'No GPA yet.');
  });

  // Review of the change: the 0.00 still read as a GPA below the minimum on
  // the defense and candidacy checks and in the emails' other lines.
  it('that 0.00 is no GPA on any row or in either email', () => {
    const s = newStudent({ gpa: 0, milestones: { advisorIdentified: '2026-09-01', advisorName: 'Prof. Example', advisorTtt: 'yes', defensePassed: '2026-10-01' } });
    const report = audit(s, rules, '2026-10-14');
    for (const r of report.requirements) assert.doesNotMatch(r.detail, /\b0\.00\b|GPA[^.]*below/, r.id);
    const email = advisorSummary(report, { todayIso: '2026-10-14', entryTerm: 'Fall 2026', priorStudy: 'No prior graduate degree', gpa: 0 });
    assert.doesNotMatch(email.text, /\b0\.00\b/);
    const request = gradAdminRequest(report, s, rules, { todayIso: '2026-10-14', entryTerm: 'Fall 2026', priorStudy: 'No prior graduate degree', gpa: 0 });
    assert.doesNotMatch(request.text, /\b0\.00\b/);
  });

  it('a GPA above zero the student entered is checked as entered', () => {
    assert.equal(gpaRow(newStudent({ gpa: 3.6 })).status, 'met');
    assert.equal(gpaRow(newStudent({ gpa: 2.5 })).status, 'unmet');
  });

  it('once the first semester has ended, the GPA is asked for again, even with the courses still in progress', () => {
    const row = gpaRow(newStudent(), '2027-01-20');
    assert.equal(row.status, 'cannot_evaluate');
    assert.match(row.detail, /^Enter your graduate-level cumulative GPA/);
  });

  it('a graded Notre Dame course, or an earlier Notre Dame graduate program, means a GPA exists', () => {
    const graded = [ndCourse('CSE 60111', { term: { season: 'summer', year: 2026 }, grade: 'A' }), ...inProgress];
    assert.equal(gpaRow(newStudent({ courses: graded })).status, 'cannot_evaluate');
    assert.equal(gpaRow(newStudent({ ndMasters: { term: { season: 'spring', year: 2026 } } })).status, 'cannot_evaluate');
    assert.equal(gpaRow(newStudent({ background: { bachelors: 'elsewhere', graduate: 'nd-other', finished: true } })).status, 'cannot_evaluate');
    // Prior Notre Dame graduate coursework on the record, graded.
    const prior = transferCourse('CSE 60770', 'Machine Learning', { term: { season: 'spring', year: 2026 }, grade: 'A', institution: 'University of Notre Dame', registeredLevel: 'graduate' });
    assert.equal(gpaRow(newStudent({ courses: [prior, ...inProgress] })).status, 'cannot_evaluate');
  });

  // Review of the change (2026-10-14).
  it('the page’s guess at the entry term on a fresh record is read like every row reads it; an earlier term set brings the request back', () => {
    assert.equal(gpaRow(newStudent({ entryTermInferred: { how: 'assumed' } })).status, 'in_progress');
    assert.equal(gpaRow(newStudent({ entryTerm: { season: 'fall', year: 2024 } })).status, 'cannot_evaluate');
  });
  it('an early-start summer course still marked in progress after the summer has ended: a grade has posted', () => {
    const summer = ndCourse('CSE 60111', { term: { season: 'summer', year: 2026 }, grade: 'IP' });
    assert.equal(gpaRow(newStudent({ courses: [summer, ...inProgress] })).status, 'cannot_evaluate');
    assert.equal(gpaRow(newStudent({ courses: [summer, ...inProgress] }), '2026-07-20').status, 'in_progress', 'before the summer ended');
  });
  it('with gpa_min missing the card cannot evaluate, and the emails do not say “no GPA yet” beside it', () => {
    const report = audit(newStudent(), buildRules({ parameters: { gpa_min: null } }), '2026-10-14');
    assert.equal(report.noGpaYet, undefined);
    const email = advisorSummary(report, { todayIso: '2026-10-14', entryTerm: 'Fall 2026', priorStudy: 'No prior graduate degree' });
    assert.doesNotMatch(email.text, /no GPA yet/);
  });
  it('a 0.00 carries no §2.2 note on a defense row that is not dated yet, Ph.D. or MSCSE', () => {
    const blankVsZero = (over: Partial<Student>) => {
      const zero = audit(newStudent({ ...over, gpa: 0 }), rules, '2026-10-14');
      const blank = audit(newStudent({ ...over, gpa: undefined }), rules, '2026-10-14');
      return { zero, blank };
    };
    for (const over of [{}, { program: 'mscse' as const, msOption: 'undecided' as const }, { program: 'mscse' as const, msOption: 'thesis' as const }]) {
      const { zero, blank } = blankVsZero(over);
      for (const r of zero.requirements) assert.doesNotMatch(r.detail, /below 3\.0 may not defend|\b0\.00\b/, `${JSON.stringify(over)} ${r.id}`);
      const opts = { todayIso: '2026-10-14', entryTerm: 'Fall 2026', priorStudy: 'No prior graduate degree' };
      assert.equal(advisorSummary(zero, { ...opts, gpa: 0 }).text, advisorSummary(blank, opts).text, JSON.stringify(over));
    }
  });

  it('undergraduate Notre Dame courses are on the other record: still no graduate GPA', () => {
    const ug = transferCourse('CSE 40113', 'Algorithms', { term: { season: 'spring', year: 2026 }, grade: 'A', institution: 'University of Notre Dame', registeredLevel: 'undergraduate', degreeLevel: 'bachelors' });
    const row = gpaRow(newStudent({ courses: [ug, ...inProgress] }));
    assert.equal(row.status, 'in_progress');
    // …and a Notre Dame course typed by hand and filed as the bachelor's work —
    // unless the record is a 4+1's, whose senior-year course may be graduate-registered.
    const typed = transferCourse('CSE 30151', 'Theory of Computing', { term: { season: 'spring', year: 2026 }, grade: 'A', institution: 'University of Notre Dame', degreeLevel: 'bachelors' });
    assert.equal(gpaRow(newStudent({ courses: [typed, ...inProgress] })).status, 'in_progress');
    assert.equal(gpaRow(newStudent({ courses: [typed, ...inProgress], integratedBsMs: true })).status, 'cannot_evaluate');
  });

  it('a missing gpa_min still reads “cannot evaluate”, never a state chosen without the number', () => {
    const row = audit(newStudent(), buildRules({ parameters: { gpa_min: null } }), '2026-10-14').requirements.find((r) => r.id === 'shared.gpa')!;
    assert.equal(row.status, 'cannot_evaluate');
    assert.match(row.detail, /the rules sheet is missing 'gpa_min'/);
  });

  it('the emails say “no GPA yet”, not “not entered yet”', () => {
    const s = newStudent();
    const report = audit(s, rules, '2026-10-14');
    const email = advisorSummary(report, { todayIso: '2026-10-14', entryTerm: 'Fall 2026', priorStudy: 'No prior graduate degree' });
    assert.match(email.text, /; no GPA yet\./);
    assert.doesNotMatch(email.text, /cumulative GPA not entered yet|Report my cumulative GPA/);
    const request = gradAdminRequest(report, s, rules, { todayIso: '2026-10-14', entryTerm: 'Fall 2026', priorStudy: 'No prior graduate degree' });
    assert.match(request.text, /; no GPA yet\./);
    assert.doesNotMatch(request.text, /cumulative GPA not entered yet/);
    const gpaLine = request.items.standing.find((t) => /^Cumulative GPA/.test(t.heading));
    assert.deepEqual(gpaLine?.lines, ['Progress: No GPA yet.']);
  });
});
