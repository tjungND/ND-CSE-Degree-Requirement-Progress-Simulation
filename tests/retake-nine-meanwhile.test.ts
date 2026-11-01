// A retake of a course whose earlier attempt this degree counts but §4.2's
// nine at Notre Dame cannot (DGS 2026-11-01, question 14 of the
// credit-transfer review: option (b)), and the fix found with it: an earlier
// attempt its own line refuses no longer keeps a live retake out. Scenarios:
// phd-earlier-nd-program-retake-nine-meanwhile and
// phd-earlier-nd-program-refused-attempt-live-retake.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { audit } from '../src/engine/audit.ts';
import type { AuditReport, CourseEntry, Student } from '../src/engine/types.ts';
import { buildRules } from './helpers.ts';
import { ndCourse, phdStudent, transferCourse } from './helpers/student.ts';

const fall = (year: number) => ({ season: 'fall' as const, year });
const spring = (year: number) => ({ season: 'spring' as const, year });
/** A course from the student's master's in another Notre Dame department. */
const earlier = (courseId: string, title: string, extra: Partial<CourseEntry> = {}): CourseEntry =>
  transferCourse(courseId, title, { term: fall(2024), institution: 'University of Notre Dame', degreeLevel: 'masters', registeredLevel: 'graduate', ...extra });
const rulesFor = (verdict: string, courseId = 'CSE 60535', title = 'Computer Vision', area = 'none') =>
  buildRules({ external: [{ university: 'UNIVERSITY OF NOTRE DAME', course_id: courseId, course_title: title, transferable_PhD: verdict, transferable_MSCSE: verdict, is_cse: 'yes', satisfies_core_area: area }] });
const student = (courses: CourseEntry[], extra: Partial<Student> = {}): Student =>
  phdStudent({ entryTerm: fall(2025), priorMs: 'completed', bachelorsAwarded: spring(2023), gpa: 3.7, background: { bachelors: 'elsewhere', graduate: 'nd-other', finished: true } as never, courses, ...extra });
const row = (r: AuditReport, id: string) => r.requirements.find((x) => x.id === id)!;
const lineOf = (r: AuditReport, entryIndex: number) => r.courseLines.find((l) => l.entryIndex === entryIndex)!;
const MEANWHILE =
  'in progress — will count toward the regular-course credits taken at Notre Dame (3 cr) when passed (§4.2); until then the Fall 2024 attempt is the one counted toward regular courses — its credits count once — and this retake replaces it once passed';

describe('a Ph.D. retake in progress counts toward the nine meanwhile (DGS 2026-11-01, question 14: (b))', () => {
  const record = (grade: CourseEntry['grade']) => student([earlier('CSE 60535', 'Computer Vision'), ndCourse('CSE 60111', { term: fall(2025) }), ndCourse('CSE 60535', { term: spring(2026), grade })]);

  it('toward the nine in progress, and nothing else; the earlier attempt keeps the 24 and the transfer', () => {
    const r = audit(record('IP'), rulesFor('yes'), '2026-03-01');
    assert.match(row(r, 'phd.credits.nd').detail, /^3 of 9 credits complete\. 3 in progress\./);
    assert.match(row(r, 'phd.credits.regular').detail, /^6 of 24 credits complete\./);
    assert.doesNotMatch(row(r, 'phd.credits.regular').detail, /in progress/);
    assert.doesNotMatch(row(r, 'phd.credits.total').detail, /in progress/);
    assert.match(row(r, 'phd.transfer').detail, /3 of the 24 credits you may transfer are counted/);
    assert.equal(lineOf(r, 0).mark, 'counts');
    const retake = lineOf(r, 2);
    assert.equal(retake.mark, 'in_progress');
    assert.equal(retake.text, MEANWHILE);
    assert.deepEqual((retake.counts ?? []).map((x) => [x.id, x.when]), [['phd.credits.nd', 'later']]);
    assert.deepEqual(row(r, 'phd.credits.nd').contributions?.map((c) => [c.courseId, c.entryIndex, c.kind]), [['CSE 60111', 1, undefined], ['CSE 60535', 2, 'in_progress']]);
  });

  it('a core course: the area stays the earlier attempt’s, and the retake’s line names only the nine', () => {
    const s = student([earlier('CSE 60111', 'Complexity and Algorithms'), ndCourse('CSE 60641', { term: fall(2025) }), ndCourse('CSE 60111', { term: spring(2026), grade: 'IP' })]);
    const r = audit(s, rulesFor('yes', 'CSE 60111', 'Complexity and Algorithms', 'algorithms'), '2026-03-01');
    assert.equal(row(r, 'phd.qualifier.core.algorithms').status, 'met');
    const retake = lineOf(r, 2);
    assert.deepEqual((retake.counts ?? []).map((x) => x.id), ['phd.credits.nd']);
    assert.equal(retake.qualifier, undefined);
  });

  it('graded, the retake rule decides as before: an A replaces the earlier attempt, an F leaves it', () => {
    const passed = audit(record('A'), rulesFor('yes'), '2026-06-01');
    assert.equal(lineOf(passed, 2).mark, 'counts');
    assert.match(lineOf(passed, 0).text, /^superseded by the Spring 2026 retake/);
    assert.match(row(passed, 'phd.credits.nd').detail, /^6 of 9 credits complete\./);
    const failed = audit(record('F'), rulesFor('yes'), '2026-06-01');
    assert.equal(lineOf(failed, 0).mark, 'counts');
    assert.equal(lineOf(failed, 2).text, 'not counted — its credits count once — the Fall 2024 attempt of this course is the one counted');
    assert.match(row(failed, 'phd.credits.nd').detail, /^3 of 9 credits complete\.$/m);
    assert.doesNotMatch(row(failed, 'phd.credits.nd').detail, /in progress/);
  });

  it('an earlier attempt still waiting for the DGS: the retake counts toward the nine meanwhile too', () => {
    const r = audit(record('IP'), rulesFor('dgs_approval'), '2026-03-01');
    assert.match(row(r, 'phd.credits.regular').detail, /3 pending review\/approval/);
    assert.match(row(r, 'phd.credits.nd').detail, /3 in progress/);
    assert.equal(lineOf(r, 2).text, MEANWHILE);
  });

  it('not beside a course of the student’s own Notre Dame MSCSE, which counts toward the nine itself', () => {
    const own = (courseId: string, extra: Partial<CourseEntry>): CourseEntry => ({ courseId, credits: 3, term: fall(2024), grade: 'A', origin: 'transfer', institution: 'University of Notre Dame', degreeLevel: 'masters', registeredLevel: 'graduate', ...extra });
    const s = phdStudent({ entryTerm: fall(2025), bachelorsAwarded: spring(2023), ndMasters: { term: spring(2025) }, background: { bachelors: 'elsewhere', graduate: 'nd-mscse', finished: true } as never, courses: [own('CSE 60535', {}), ndCourse('CSE 60535', { term: spring(2026), grade: 'IP' })] });
    const r = audit(s, buildRules(), '2026-03-01');
    assert.equal(lineOf(r, 1).mark, 'excluded');
    assert.match(lineOf(r, 1).text, /the Fall 2024 attempt of this course is the one counted/);
    assert.match(row(r, 'phd.credits.nd').detail, /^3 of 9 credits complete\./);
  });

  it('the MSCSE along the way reads the retake at Notre Dame too', () => {
    const s = { ...record('IP'), attestations: { wantsMsAlongTheWay: true } };
    const along = audit(s, rulesFor('yes'), '2026-03-01').requirements.find((x) => /along the way/i.test(x.title))!;
    assert.match(along.detail, /A course in progress joins the count once it is graded/);
  });

  it('the Notre Dame-only pass counts the course once: the earlier attempt leaves the 40000-level allowance to the retake', () => {
    // A non-degree attempt before admission, ruled to count, shares the
    // 40000-level allowance with the Ph.D.'s courses in that pass; left in,
    // it took the room the retake needs.
    const before: CourseEntry = { courseId: 'CSE 40113', credits: 3, term: spring(2025), grade: 'A', origin: 'transfer', institution: 'University of Notre Dame', degreeLevel: 'masters', registeredLevel: 'graduate', dgsApproved: true, dgsHoldApproved: true };
    const s = phdStudent({ entryTerm: fall(2025), gpa: 3.6, ndNonDegree: true, bachelorsAwarded: spring(2024), courses: [before, ndCourse('CSE 40243', { term: fall(2025), dgsApproved: true }), ndCourse('CSE 40113', { term: spring(2026), grade: 'IP' })] });
    const r = audit(s, buildRules(), '2026-03-01');
    assert.match(row(r, 'phd.credits.nd').detail, /^3 of 9 credits complete\. 3 in progress\./);
    assert.match(row(r, 'phd.credits.regular').detail, /^6 of 24 credits complete\./);
  });

  it('a semester over its maximum: the nine counts the retake within the maximum', () => {
    const full = ['CSE 60111', 'CSE 60641', 'CSE 60321', 'CSE 60868', 'CSE 60625', 'CSE 60427'].map((id) => ndCourse(id, { term: spring(2026), grade: 'IP' }));
    const s = student([earlier('CSE 60535', 'Computer Vision'), ...full, ndCourse('CSE 60535', { term: spring(2026), grade: 'IP' })]);
    const r = audit(s, rulesFor('yes'), '2026-03-01');
    assert.match(row(r, 'phd.credits.nd').detail, /^0 of 9 credits complete\. 15 in progress\./);
  });
});

describe('an earlier attempt its own line refuses no longer keeps a live retake out (found with question 14)', () => {
  const record = (grade: CourseEntry['grade'], retake: CourseEntry['grade'], program: Student['program'] = 'phd') =>
    student([earlier('CSE 60535', 'Computer Vision', { grade }), ndCourse('CSE 60111', { term: fall(2025) }), ndCourse('CSE 60535', { term: spring(2026), grade: retake })], { program });

  it('below B (§5.2): the retake counts in progress toward the 24 and the nine', () => {
    const r = audit(record('B-', 'IP'), rulesFor('yes'), '2026-03-01');
    assert.match(row(r, 'phd.credits.regular').detail, /^3 of 24 credits complete\. 3 in progress\./);
    assert.match(row(r, 'phd.credits.nd').detail, /^3 of 9 credits complete\. 3 in progress\./);
    assert.equal(lineOf(r, 2).text, 'in progress — will count toward regular courses (3 cr) when passed');
    assert.match(lineOf(r, 0).text, /^superseded by the Spring 2026 retake/);
  });

  it('ruled not to transfer: the same', () => {
    const r = audit(record('A', 'IP'), rulesFor('no'), '2026-03-01');
    assert.equal(lineOf(r, 2).mark, 'in_progress');
    assert.match(row(r, 'phd.credits.regular').detail, /3 in progress/);
  });

  it('a failed retake beside it keeps its own line', () => {
    const r = audit(record('B-', 'F'), rulesFor('yes'), '2026-06-01');
    assert.match(lineOf(r, 2).text, /^failed — earns no credit/);
    assert.match(lineOf(r, 0).text, /grade below B \(§5\.2\)/);
  });

  it('on the MSCSE too', () => {
    const r = audit(record('B-', 'IP', 'mscse'), rulesFor('yes'), '2026-03-01');
    assert.equal(lineOf(r, 2).mark, 'in_progress');
    assert.match(row(r, 'ms.credits.regular').detail, /3 in progress/);
  });
});
