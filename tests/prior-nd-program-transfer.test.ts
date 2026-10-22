// A graduate course from an earlier Notre Dame master's in another department
// (policy review round 3, P3-dh-10-2; DGS 2026-10-06: "Apply the suggested
// handling on P3-dh-10-2"). CSE §5.2: "5) the transfer is recommended by the
// DGS and approved by the Graduate School. These five requirements also apply
// to the transfer of credits earned in another program at Notre Dame." The
// review request asked the DGS for an emailed recommendation the page could
// not record: no tick on the course (the Courses tab, not the transfer
// verdict, decided whether one was offered), so the course stayed "Waiting
// for the DGS" with nothing transferred. Its transfer decision is now an
// ExternalCourses row under UNIVERSITY OF NOTRE DAME (DECISIONS 2026-09-05),
// asked for as a paste-ready row.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decidedCaseByCase } from '../src/engine/allocate.ts';
import { audit } from '../src/engine/audit.ts';
import { coursesNeedingDgsReview } from '../src/engine/review.ts';
import type { Student } from '../src/engine/types.ts';
import { buildCombinedReviewRequest, reviewRequestCourses } from '../src/ui/review-request.ts';
import { processingItems } from '../src/ui/grad-admin-request.ts';
import { buildRules } from './helpers.ts';
import { phdStudent } from './helpers/student.ts';

const TODAY = '2027-01-20'; // after the first semester: the processing request may go
const student = (institution = 'University of Notre Dame', dgsApproved?: boolean): Student =>
  phdStudent({
    entryTerm: { season: 'fall', year: 2026 },
    bachelorsAwarded: { season: 'spring', year: 2023 },
    priorMs: 'completed',
    gpa: 3.6,
    background: { bachelors: 'elsewhere', graduate: 'nd-other', finished: true },
    courses: [{ courseId: 'CSE 60111', credits: 3, term: { season: 'fall', year: 2024 }, grade: 'A', origin: 'transfer', institution, degreeLevel: 'masters', ...(dgsApproved ? { dgsApproved: true } : {}) }],
  } as Partial<Student>);
const ndRow = (verdict: string) => ({ university: 'UNIVERSITY OF NOTRE DAME', course_id: 'CSE 60111', course_title: 'Complexity and Algorithms', transferable_PhD: verdict, transferable_MSCSE: verdict, is_cse: 'yes' });
const transferCard = (s: Student, rules = buildRules()) => audit(s, rules, TODAY).requirements.find((r) => r.id === 'phd.transfer')!;

describe('the review request asks for the ExternalCourses row (P3-dh-10-2)', () => {
  it('a paste-ready UNIVERSITY OF NOTRE DAME row in the "enter in the course rules" list, no email question', () => {
    const pending = coursesNeedingDgsReview(student(), buildRules(), TODAY);
    assert.equal(pending.length, 1);
    assert.match(pending[0]!.reason, /no transfer decision recorded yet — the DGS enters it in the course rules \(§5\.2\)/);
    const { nd, external } = reviewRequestCourses(pending, () => 'Master’s');
    assert.equal(nd.length, 0, 'the Courses tab lists the course: nothing to enter there');
    const { text } = buildCombinedReviewRequest({ priorStudy: 'Completed prior M.S. or Ph.D.', nd, external });
    assert.match(text, /A\. Please enter or complete these in the course rules — no reply needed[^\n]*\n1\. CSE 60111 Complexity and Algorithms \(UNIVERSITY OF NOTRE DAME, Fall 2024\) — new row: transferable to the Ph\.D\. \(§5\.2\): yes \/ no \/ case by case/);
    assert.doesNotMatch(text, /B\. Please decide these for me|recommend the transfer credit/);
    assert.match(text, /Rows for the rules sheet — ExternalCourses tab:\n\nUNIVERSITY OF NOTRE DAME\tCSE 60111\tComplexity and Algorithms/);
  });
  it('the approvals card names what is missing: a transfer decision, not a course rule', () => {
    const approvals = audit(student(), buildRules(), TODAY).requirements.find((r) => r.id === 'shared.approvals')!;
    assert.match(approvals.detail, /CSE 60111 \(waiting for the DGS — no transfer decision recorded yet; send the review request so the DGS can enter it \(§5\.2\)/);
    assert.doesNotMatch(approvals.detail, /not in the course rules yet/);
  });
});

describe('the DGS’s row decides it', () => {
  it('yes: it counts, and goes to the processing request', () => {
    const rules = buildRules({ external: [ndRow('yes')] });
    assert.match(transferCard(student(), rules).detail, /3 of the 24 credits you may transfer are counted/);
    assert.equal(coursesNeedingDgsReview(student(), rules, TODAY).length, 0);
  });
  it('case by case: the course offers the tick; ticked, it counts and goes to the processing request', () => {
    const rules = buildRules({ external: [ndRow('dgs_approval')] });
    const s = student();
    const course = audit(s, rules, TODAY);
    assert.ok(course, 'audited');
    const classifiedCourse = coursesNeedingDgsReview(s, rules, TODAY)[0]!.course;
    assert.equal(decidedCaseByCase(classifiedCourse, 'phd'), true, 'the per-course tick is offered');
    const ticked = student('University of Notre Dame', true);
    assert.match(transferCard(ticked, rules).detail, /3 of the 24 credits you may transfer are counted/);
    const report = audit(ticked, rules, TODAY);
    const items = processingItems(report, ticked, rules);
    assert.match(JSON.stringify(items), /CSE 60111/, 'the processing request carries the course');
  });
  it('a record that spells it “Notre Dame” still finds the row', () => {
    const rules = buildRules({ external: [ndRow('yes')] });
    assert.match(transferCard(student('Notre Dame'), rules).detail, /3 of the 24 credits you may transfer are counted/);
  });
});
