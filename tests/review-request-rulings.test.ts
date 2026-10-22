// The review request's two lists split on what an ask IS, not on its wording
// (policy review round 3, P3-emails-2; DGS 2026-10-06: "apply the suggested
// handling"). List A, "enter or complete these in the course rules — no reply
// needed", holds the sheet's questions; list B, "decide these for me — a reply
// is needed", the rulings for this student — a readmission, a lapsed
// Incomplete, an S grade … — which no sheet cell can hold. They used to land
// in A as "complete the row", with B repeating the same courses with nothing
// after the dash.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { coursesNeedingDgsReview } from '../src/engine/review.ts';
import type { Student, Term } from '../src/engine/types.ts';
import { buildCombinedReviewRequest, reviewRequestCourses } from '../src/ui/review-request.ts';
import { buildRules } from './helpers.ts';
import { ndCourse, phdStudent, transferCourse } from './helpers/student.ts';

const rules = buildRules();
const t = (season: Term['season'], year: number): Term => ({ season, year });
const TODAY = '2026-10-06';
const student: Student = phdStudent({
  entryTerm: t('fall', 2022),
  bachelorsAwarded: t('spring', 2020),
  priorMs: 'completed',
  gpa: 3.5,
  readmittedTerm: t('fall', 2025),
  courses: [
    ndCourse('CSE 60111', { term: t('fall', 2022) }), // before the readmission
    ndCourse('CSE 60641', { term: t('spring', 2026), grade: 'I' }), // an Incomplete past its deadline
    transferCourse('CS 50300', 'Operating Systems', { term: t('fall', 2021), grade: 'S', degreeLevel: 'masters' }), // pass/fail, cannot show a B
  ],
});

describe('rulings for this student go to list B, once, with their text (P3-emails-2)', () => {
  const pending = coursesNeedingDgsReview(student, rules, TODAY);
  const { nd, external } = reviewRequestCourses(pending, () => 'Master’s');
  const { text } = buildCombinedReviewRequest({ priorStudy: 'Completed prior M.S. or Ph.D.', nd, external });
  const listA = text.split('A. Please enter or complete these in the course rules')[1]?.split('B. Please decide these for me')[0] ?? '';
  const listB = (text.split('B. Please decide these for me — a reply is needed:')[1] ?? '').split('Thank you!')[0]!;
  const rulings: [string, RegExp][] = [
    ['CSE 60111', /confirm the credit from before my readmission still counts \(DGS Handbook §3\.3\)/],
    ['CSE 60641', /confirm whether the Graduate School extended my Incomplete, or the grade was posted \(Academic Code §4\.4\)/],
    ['CS 50300', /decide whether this S \(pass\/fail\) course transfers — it cannot show the B §5\.2 requires/],
  ];
  for (const [course, ruling] of rulings) {
    it(`${course}: in B, not in A`, () => {
      assert.match(listB, new RegExp(`${course.replace(' ', ' ')}[^\\n]* — [^\\n]*${ruling.source}`), listB);
      assert.doesNotMatch(listA, ruling, listA);
      assert.equal((text.split('Course details:')[0]!.match(ruling) ?? []).length, 1, 'said once above the details');
    });
  }
  it('no B item has an empty ask', () => {
    for (const line of listB.split('\n').filter((l) => /^\d+\. /.test(l))) assert.match(line, / — \S/, line);
  });
  it('the intro covers rulings made by reply', () => {
    assert.match(text, /It cannot count them until they are decided — in the course rules, or by your reply where the question is about my record\./);
  });
});
