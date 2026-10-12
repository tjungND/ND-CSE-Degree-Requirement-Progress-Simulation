// A Notre Dame MSCSE five years or more before the Ph.D. (DGS 2026-10-06,
// with policy review round 3, P3-cse-5-6-3: "If a student finished MSCSE in
// Spring 2019 and come back to PhD in Fall 2026, that can be treated as a
// separation from the graduate program that is 5 years or longer, so the
// prior credits/coursework may be forfeited. This needs to be reviewed by DGS
// and approved by the graduate school. So, the student must get an approval
// for all the credits/coursework to count towards the PhD."). The CSE MSCSE
// and Ph.D. are one graduate program (2026-10-03), so Academic Code §5.5
// applies: "Credit for any course or examination will be forfeited if the
// student interrupts his or her program of study for five years or more."
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mscseSeparation } from '../src/engine/allocate.ts';
import { audit } from '../src/engine/audit.ts';
import { coursesNeedingDgsReview } from '../src/engine/review.ts';
import type { CourseEntry, Student, Term } from '../src/engine/types.ts';
import { buildRules } from './helpers.ts';
import { ndCourse, phdStudent } from './helpers/student.ts';

const rules = buildRules();
const t = (season: Term['season'], year: number): Term => ({ season, year });
/** A course of the student's own Notre Dame MSCSE, as the Notre Dame import files it. */
const ms = (id: string, term: Term, extra: Partial<CourseEntry> = {}): CourseEntry => ({ ...ndCourse(id, { term }), origin: 'transfer', institution: 'University of Notre Dame', degreeLevel: 'masters', ...extra });
const MSCSE = (y: number): CourseEntry[] => [ms('CSE 60641', t('fall', y - 2)), ms('CSE 60111', t('fall', y - 2)), ms('CSE 60321', t('spring', y - 1)), ms('CSE 60427', t('spring', y - 1)), ms('CSE 60535', t('fall', y - 1)), ms('CSE 60762', t('spring', y))];
const student = (finished: Term, courses: CourseEntry[], extra: Partial<Student> = {}): Student =>
  phdStudent({ entryTerm: t('fall', 2026), bachelorsAwarded: t('spring', finished.year - 2), priorMs: 'none', gpa: 3.6, ndMasters: { term: finished }, courses, ...extra });
const run = (s: Student) => {
  const report = audit(s, rules, '2026-10-06');
  const find = (id: string) => report.requirements.find((r) => r.id === id)!;
  return { report, find };
};

describe('the DGS’s example: the MSCSE finished Spring 2019, the Ph.D. begun Fall 2026', () => {
  const s = student(t('spring', 2019), MSCSE(2019));
  it('is a separation of five years or more', () => {
    assert.deepEqual(mscseSeparation(s), t('spring', 2019));
  });
  it('every MSCSE course waits for the DGS and the Graduate School; nothing counts in full yet', () => {
    const { report, find } = run(s);
    assert.match(find('phd.credits.regular').detail, /^0 of 24 credits complete\. 18 pending review\/approval/);
    assert.equal(find('phd.qualifier.core.os').status, 'needs_dgs_review');
    assert.equal(find('phd.qualifier.core.os').forfeitReview, true);
    assert.equal(find('phd.qualifier.categories').forfeitReview, true);
    const line = report.courseLines?.find((l) => l.courseId === 'CSE 60641');
    assert.equal(line?.mark, 'pending');
    assert.match(line?.text ?? '', /from your Notre Dame MSCSE, which ended in Spring 2019, five years or more before you entered the Ph\.D\. in Fall 2026 — a separation that long may forfeit its credit \(Academic Code §5\.5\), so it counts as Ph\.D\. coursework once the DGS reviews it and the Graduate School approves/);
    assert.doesNotMatch(line?.text ?? '', /counts in full/);
    assert.ok(report.warnings.some((w) => w.startsWith('Your Notre Dame MSCSE ended in Spring 2019, five years or more before you entered the Ph.D. in Fall 2026')), report.warnings.join(' | '));
    assert.ok((report.reviewFlags ?? []).some((f) => /My Notre Dame MSCSE ended in Spring 2019, five years or more before I entered the Ph\.D\. in Fall 2026: please review its credit and coursework and request the Graduate School’s approval/.test(f)), JSON.stringify(report.reviewFlags));
  });
  it('the review request asks for each course', () => {
    const asks = coursesNeedingDgsReview(s, rules, '2026-10-06');
    const os = asks.find((a) => a.course.entry.courseId === 'CSE 60641');
    assert.ok(os, 'CSE 60641 is in the review request');
    assert.match(JSON.stringify(os), /rule on the credit from my Notre Dame MSCSE, which ended five years or more before I entered the Ph\.D\., and request the Graduate School’s approval \(Academic Code §5\.5\)/);
  });
});

describe('the edges', () => {
  it('under five years: the MSCSE counts in full, as before', () => {
    const s = student(t('spring', 2022), MSCSE(2022));
    assert.equal(mscseSeparation(s), undefined);
    const { report, find } = run(s);
    assert.match(find('phd.credits.regular').detail, /^18 of 24 credits complete/);
    assert.match(report.courseLines?.find((l) => l.courseId === 'CSE 60641')?.text ?? '', /counts in full as Ph\.D\. coursework/);
  });
  it('to the semester: Spring 2021 to Fall 2026 is five years; Fall 2021 is not', () => {
    assert.deepEqual(mscseSeparation(student(t('spring', 2021), MSCSE(2021))), t('spring', 2021));
    assert.equal(mscseSeparation(student(t('fall', 2021), [...MSCSE(2021), ms('CSE 60770', t('fall', 2021))])), undefined);
  });
  it('a bachelor’s-only Notre Dame course is not the graduate program’s: left alone', () => {
    const bs = { ...ndCourse('CSE 60641', { term: t('fall', 2015) }), origin: 'transfer' as const, institution: 'University of Notre Dame', countedToward: 'bs' as const };
    const s = student(t('spring', 2019), [bs, ...MSCSE(2019).filter((c) => c.courseId !== 'CSE 60641')], { bachelorsAwarded: t('spring', 2016) });
    const { find } = run(s);
    assert.equal(find('phd.qualifier.core.os').forfeitReview, undefined, find('phd.qualifier.core.os').detail);
  });
  it('a 4+1’s course counted toward the MSCSE, from before the bachelor’s, is the program’s: it waits', () => {
    const fourPlusOne = { ...ndCourse('CSE 60770', { term: t('fall', 2016) }), origin: 'transfer' as const, institution: 'University of Notre Dame', countedToward: 'mscse' as const };
    const s = student(t('spring', 2019), [fourPlusOne, ...MSCSE(2019)], { bachelorsAwarded: t('spring', 2017), integratedBsMs: true });
    const line = run(s).report.courseLines?.find((l) => l.courseId === 'CSE 60770');
    assert.match(line?.text ?? '', /five years or more before you entered the Ph\.D\./);
  });
});

// The same course filed at the bachelor's level — typed by hand, or registered
// UG — is still the MSCSE's when the student says it counted toward it: the
// answer is read before the level sets it aside (policy review round 4,
// P4-phd-9; DGS 2026-10-12). It used to count in full with no §5.5 hold.
describe('a separated 4+1 MSCSE: a senior-year course filed at the bachelor’s level (P4-phd-9)', () => {
  it('counted toward the MSCSE: it waits, as the fifth-year courses do', () => {
    const senior = { ...ndCourse('CSE 60770', { term: t('fall', 2016) }), origin: 'transfer' as const, institution: 'University of Notre Dame', degreeLevel: 'bachelors' as const, countedToward: 'mscse' as const };
    const s = student(t('spring', 2019), [senior, ...MSCSE(2019)], { bachelorsAwarded: t('spring', 2017), integratedBsMs: true });
    const line = run(s).report.courseLines?.find((l) => l.courseId === 'CSE 60770');
    assert.match(line?.text ?? '', /five years or more before you entered the Ph\.D\./, line?.text ?? 'no line');
    assert.notEqual(line?.mark, 'counts');
  });
  it('the §5.2 window still starts at the MSCSE’s own first course', async () => {
    const { ownMscseStart } = await import('../src/engine/allocate.ts');
    const senior = { ...ndCourse('CSE 60770', { term: t('fall', 2016) }), origin: 'transfer' as const, institution: 'University of Notre Dame', degreeLevel: 'bachelors' as const, countedToward: 'mscse' as const };
    const s = student(t('spring', 2019), [senior, ...MSCSE(2019)], { bachelorsAwarded: t('spring', 2017), integratedBsMs: true });
    assert.deepEqual(ownMscseStart(s), t('fall', 2017));
  });
});

// The qualifier card's chip names the cause (policy review round 4, P4-phd-8;
// DGS 2026-10-12): a student whose MSCSE ended five years before the Ph.D. was
// never readmitted.
describe('the qualifier chip after a separated MSCSE (P4-phd-8)', () => {
  it('every part done, the course parts from the MSCSE: “Done in your Notre Dame MSCSE …”, not “before your readmission”', () => {
    const s = student(t('spring', 2019), MSCSE(2019), { milestones: { researchQualifierPassed: '2027-03-01' } });
    const q = audit(s, rules, '2027-06-01').requirements.find((r) => r.id === 'phd.qualifier')!;
    assert.equal(q.status, 'needs_dgs_review');
    assert.equal(q.deadline?.label, 'Done in your Notre Dame MSCSE, five years or more before the Ph.D. — waiting for the DGS');
  });
});
