// "After the student's admission" for Ph.D. credit is the Ph.D. admission
// (DGS 2026-10-30, question 5 of the credit-transfer review, with 5a option 1,
// 5b and 5c). DGS Handbook §3.14: "The University requires prior approval of
// the department and the Graduate School for formal courses taken elsewhere
// and applied to the degree program after the student’s admission to Notre
// Dame." For a Notre Dame MSCSE holder's course from another university taken
// after the MSCSE began and before the Ph.D. began, the semester of the Ph.D.
// admission letter decides: later, after admission (held for the DGS);
// earlier, an ordinary transfer; the same semester, the DGS decides; none
// given, the student is asked under Your standing.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { admissionTiming, classify } from '../src/engine/allocate.ts';
import { audit } from '../src/engine/audit.ts';
import { coursesNeedingDgsReview } from '../src/engine/review.ts';
import type { CourseEntry, Student, Term } from '../src/engine/types.ts';
import { buildRules } from './helpers.ts';
import { phdStudent, transferCourse } from './helpers/student.ts';

const TODAY = '2026-10-30';
const fall = (year: number): Term => ({ season: 'fall', year });
const spring = (year: number): Term => ({ season: 'spring', year });
const summer = (year: number): Term => ({ season: 'summer', year });
const ND = 'University of Notre Dame';
const rules = buildRules({
  external: [
    { university: 'NORTHEASTERN UNIVERSITY', course_id: 'CS 5001', course_title: 'Intensive Foundations', transferable_PhD: 'yes', transferable_MSCSE: 'yes', is_cse: 'yes', credit_system: 'semester' },
    { university: 'PURDUE UNIVERSITY', course_id: 'CS 50300', course_title: 'Operating Systems', transferable_PhD: 'yes', transferable_MSCSE: 'yes', is_cse: 'yes', credit_system: 'semester' },
  ],
});
const ms = (id: string, term: Term): CourseEntry => ({ courseId: id, credits: 3, term, grade: 'A', origin: 'transfer', institution: ND, degreeLevel: 'masters', registeredLevel: 'graduate' });
const neu = (term: Term): CourseEntry => transferCourse('CS 5001', 'Intensive Foundations', { term, institution: 'Northeastern University', degreeLevel: 'masters' });
// The Notre Dame MSCSE Fall 2020 – Spring 2022, the Ph.D. from Fall 2022.
const record = (course: CourseEntry, extra: Partial<Student> = {}): Student =>
  phdStudent({
    entryTerm: fall(2022),
    priorMs: 'completed',
    bachelorsAwarded: spring(2020),
    ndMasters: { term: spring(2022) },
    background: { bachelors: 'elsewhere', graduate: 'nd-mscse', alsoElsewhere: true, finished: true } as never,
    courses: [ms('CSE 60641', fall(2020)), ms('CSE 60111', spring(2021)), ms('CSE 60321', fall(2021)), course],
    ...extra,
  });
const line = (s: Student, id = 'CS 5001'): string => audit(s, rules, TODAY).courseLines.find((l) => l.courseId === id)!.text;
const classified = (s: Student, id = 'CS 5001') => classify(s, rules, TODAY).classified.find((c) => c.entry.courseId === id)!;

describe('admissionTiming', () => {
  it('reads the semester of the Ph.D. admission letter for a course between the MSCSE’s start and the Ph.D.', () => {
    const s = record(neu(summer(2021)), { phdAdmittedTerm: spring(2021) });
    assert.equal(admissionTiming(s, fall(2022), summer(2021)), 'after');
    assert.equal(admissionTiming({ ...s, phdAdmittedTerm: summer(2021) }, fall(2022), summer(2021)), 'admission-semester');
    assert.equal(admissionTiming({ ...s, phdAdmittedTerm: spring(2022) }, fall(2022), summer(2021)), 'before');
    assert.equal(admissionTiming({ ...s, phdAdmittedTerm: undefined }, fall(2022), summer(2021)), 'unknown');
  });
  it('at or after the entry term is after admission; before the MSCSE, or with no Notre Dame MSCSE, before', () => {
    const s = record(neu(summer(2021)));
    assert.equal(admissionTiming(s, fall(2022), fall(2022)), 'after');
    assert.equal(admissionTiming(s, fall(2022), spring(2020)), 'before');
    assert.equal(admissionTiming({ ...s, ndMasters: undefined }, fall(2022), summer(2021)), 'before');
  });
});

describe('the course’s line', () => {
  it('no letter on file: not counted yet, and Your standing asks for it', () => {
    const s = record(neu(summer(2021)));
    assert.equal(classified(s).phdAdmissionUnknown, true);
    assert.match(line(s), /not counted yet — taken Summer 2021, while you were enrolled in your Notre Dame MSCSE: .* set the semester of your Ph\.D\. admission letter, under Your standing/);
  });
  it('a case-by-case course the DGS ticked is not asked again', () => {
    const caseByCase = buildRules({ external: [{ university: 'NORTHEASTERN UNIVERSITY', course_id: 'CS 5001', course_title: 'Intensive Foundations', transferable_PhD: 'dgs_approval', transferable_MSCSE: 'dgs_approval', is_cse: 'yes', credit_system: 'semester' }] });
    const s = record({ ...neu(summer(2021)), dgsApproved: true });
    const c = classify(s, caseByCase, TODAY).classified.find((x) => x.entry.courseId === 'CS 5001')!;
    assert.equal(c.phdAdmissionUnknown, undefined);
    assert.equal(c.ineligibleReason, undefined);
  });
  it('before the Ph.D. admission: an ordinary transfer, no advance-approval hold (5c)', () => {
    const s = record(neu(summer(2021)), { phdAdmittedTerm: spring(2022) });
    const c = classified(s);
    assert.equal(c.afterAdmission, undefined);
    assert.equal(c.approvalPending, undefined);
    assert.doesNotMatch(line(s), /after admission/);
  });
  it('after the letter, during the MSCSE: held for the advance approval', () => {
    const s = record(neu(summer(2021)), { phdAdmittedTerm: spring(2021) });
    assert.equal(classified(s).afterAdmission, true);
    assert.match(line(s), /taken Summer 2021, after your Ph\.D\. admission \(Spring 2021\), while you were enrolled in your Notre Dame MSCSE — a course taken elsewhere after admission needs the department’s and the Graduate School’s approval in advance/);
    assert.doesNotMatch(line(s), /exception/);
  });
  it('after the letter, between the MSCSE and the Ph.D.: held, and only an exception counts it without the approval', () => {
    const s = record(neu(summer(2022)), { phdAdmittedTerm: spring(2022) });
    assert.match(line(s), /taken Summer 2022, after your Ph\.D\. admission \(Spring 2022\), before you entered the Ph\.D\. — .*; taken while you were enrolled in no Notre Dame program, without that approval it counts only by an exception the Graduate School approves in writing; the DGS confirms it was approved/);
  });
  it('the semester of the letter: the DGS decides, and the review request asks', () => {
    const s = record(neu(summer(2021)), { phdAdmittedTerm: summer(2021) });
    assert.equal(classified(s).admissionSemester, true);
    assert.match(line(s), /taken Summer 2021, the semester of your Ph\.D\. admission letter, while you were enrolled in your Notre Dame MSCSE/);
    const ask = coursesNeedingDgsReview(s, rules, TODAY).find((p) => p.course.entry.courseId === 'CS 5001')!;
    assert.match(ask.ask.decide.join(' | '), /decide whether I took this course after my Ph\.D\. admission/);
  });
});

describe('a course taken during the MSCSE is still no earlier program', () => {
  it('before the Ph.D. admission, beside a finished master’s elsewhere: not a second earlier program', () => {
    // A finished master's at Purdue before Notre Dame, and a Northeastern
    // summer course during the MSCSE: without the after-admission hold, the
    // course must still not make Northeastern a second earlier program (#23).
    const purdue = transferCourse('CS 50300', 'Operating Systems', { term: fall(2019), degreeLevel: 'masters' });
    const s = record(neu(summer(2021)), { phdAdmittedTerm: spring(2022), bachelorsAwarded: spring(2018) });
    s.courses.push(purdue);
    const c = classified(s);
    assert.equal(c.duringNdEnrollment, true);
    assert.equal(c.twoPrograms, undefined);
    assert.equal(classified(s, 'CS 50300').twoPrograms, undefined);
  });
});

describe('Your standing asks only when it decides something', () => {
  // The question shows while a course's line asks for it (app.ts phdAdmissionField).
  it('not for a course before the MSCSE, nor without a Notre Dame MSCSE, nor for one the sheet refuses', () => {
    assert.equal(classified(record(neu(spring(2020)))).phdAdmissionUnknown, undefined);
    assert.equal(classified({ ...record(neu(summer(2021))), ndMasters: undefined }).phdAdmissionUnknown, undefined);
    const refusing = buildRules({ external: [{ university: 'NORTHEASTERN UNIVERSITY', course_id: 'CS 5001', course_title: 'Intensive Foundations', transferable_PhD: 'no', transferable_MSCSE: 'no', is_cse: 'yes', credit_system: 'semester' }] });
    assert.equal(classify(record(neu(summer(2021))), refusing, TODAY).classified.find((c) => c.entry.courseId === 'CS 5001')!.phdAdmissionUnknown, undefined);
  });
});
