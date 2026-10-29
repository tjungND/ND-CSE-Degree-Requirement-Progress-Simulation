// Warnings for the people who decide and process (DGS 2026-10-04): a `yes`
// in the ExternalCourses tab for a course whose number looks undergraduate
// (P1-sheet-48: "If a course is an undergrad version, they should not
// transfer … a warning needs to be shown to ADGS/DGS/Grad Admin") or whose
// title suggests a non-regular course (P1-sheet-c2). src/data/course-checks.ts.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { looksNonRegularTitle, looksUndergraduateNumber } from '../src/data/course-checks.ts';
import { parseExternalTab } from '../src/data/parse.ts';
import type { SheetIssue } from '../src/data/types.ts';
import { audit } from '../src/engine/audit.ts';
import { gradAdminRequest } from '../src/ui/grad-admin-request.ts';
import { buildRules } from './helpers.ts';
import { ndCourse, phdStudent, transferCourse } from './helpers/student.ts';

describe('the two guesses', () => {
  it('an undergraduate-looking number: 4- and 5-digit below 5000/50000, 3-digit in the 100s, 300s and 400s', () => {
    for (const id of ['ECE 4804', 'CS 455', 'CS 101', 'CS 30100', 'MATH 3510']) assert.equal(looksUndergraduateNumber(id), true, id);
    // The 200s stay out (the University of California's graduate courses);
    // graduate numbers, and ids with no 3–5-digit number, are never flagged.
    for (const id of ['ECE 201', 'CSCI 570', 'CS 8903', 'CS 50300', 'COMP 9417', '30240233', '6.006', 'CSE 60641']) assert.equal(looksUndergraduateNumber(id), false, id);
  });

  it('a title that suggests a non-regular course', () => {
    for (const t of ['Special Problems', 'Reading and Special Problems', "Master's Thesis", 'Doctoral Seminar', 'Independent Study', 'MENG INTERNSHIP PROJECT', 'Graduate Research'])
      assert.equal(looksNonRegularTitle(t), true, t);
    for (const t of ['Special Topics', 'Research Methods', 'Advanced Database Organization', 'Machine Learning', undefined]) assert.equal(looksNonRegularTitle(t), false, String(t));
  });
});

describe('the sheet check warns the DGS', () => {
  const header = 'university,course_id,course_title,satisfies_core_area,transferable_PhD,transferable_MSCSE,is_cse,nd_credits,credit_system,decided_on,notes';
  it('an undergraduate number on any row that lets the course count (yes or case by case); a non-regular title on a yes row only', () => {
    const csv = [
      header,
      'GEORGIA INSTITUTE OF TECHNOLOGY,ECE 4804,Special Topics,none,yes,no,yes,,semester,2026-10-04,',
      'GEORGIA INSTITUTE OF TECHNOLOGY,CS 8903,Special Problems,none,yes,no,yes,,semester,2026-10-04,',
      'ILLINOIS INSTITUTE OF TECHNOLOGY,CS 430,Introduction Algorithms,none,no,adgs_approval,yes,,semester,2026-10-04,',
      'ILLINOIS INSTITUTE OF TECHNOLOGY,CS 597,Reading and Special Problems,none,no,adgs_approval,yes,,semester,2026-10-04,',
      'ILLINOIS INSTITUTE OF TECHNOLOGY,CS 455,Data Communication,none,no,no,yes,,semester,2026-10-04,',
    ].join('\n');
    const issues: SheetIssue[] = [];
    parseExternalTab(csv, [{ code: 'os', name: 'Operating Systems' }], issues);
    const warnings = issues.filter((i) => i.severity === 'warning').map((i) => i.message);
    assert.equal(warnings.length, 3, warnings.join('\n'));
    assert.match(warnings[0]!, /^ExternalCourses row 2: GEORGIA INSTITUTE OF TECHNOLOGY ECE 4804 may count for the Ph\.D\. \(yes\), but its number looks like an undergraduate course — only graduate courses transfer \(Academic Code §4\.6\)\./);
    assert.match(warnings[1]!, /^ExternalCourses row 3: GEORGIA INSTITUTE OF TECHNOLOGY CS 8903 “Special Problems” transfers for the Ph\.D\. \(yes\) and would count toward the regular-course credits/);
    assert.match(warnings[2]!, /^ExternalCourses row 4: ILLINOIS INSTITUTE OF TECHNOLOGY CS 430 may count for the MSCSE \(case by case\), but its number looks like an undergraduate course/);
    // CS 597 is case by case (its title is the decider's to read); CS 455 is no for both.
  });
});

describe('the review and processing requests carry the checks for a student’s own courses', () => {
  const rules = buildRules({
    external: [
      { university: 'GEORGIA INSTITUTE OF TECHNOLOGY', course_id: 'ECE 4804', course_title: 'Special Topics', satisfies_core_area: 'none', transferable_PhD: 'yes', transferable_MSCSE: 'no', is_cse: 'yes' },
      { university: 'GEORGIA INSTITUTE OF TECHNOLOGY', course_id: 'CS 8903', course_title: 'Special Problems', satisfies_core_area: 'none', transferable_PhD: 'yes', transferable_MSCSE: 'no', is_cse: 'yes' },
      { university: 'GEORGIA INSTITUTE OF TECHNOLOGY', course_id: 'CS 6210', course_title: 'Advanced Operating Systems', satisfies_core_area: 'os', transferable_PhD: 'yes', transferable_MSCSE: 'no', is_cse: 'yes' },
    ],
  });
  const gt = (courseId: string, title: string) => transferCourse(courseId, title, { institution: 'Georgia Institute of Technology', degreeLevel: 'masters', dgsApproved: undefined });
  const student = phdStudent({
    priorMs: 'completed',
    bachelorsAwarded: { season: 'spring', year: 2022 },
    gpa: 3.6,
    courses: [gt('ECE 4804', 'Special Topics'), gt('CS 8903', 'Special Problems'), gt('CS 6210', 'Advanced Operating Systems'), ndCourse('CSE 60641')],
    milestones: { advisorIdentified: '2026-09-10', advisorName: 'Prof. Example' },
  });

  it('the report lists one check per course and guess; a graduate regular course gets none', () => {
    const r = audit(student, rules, '2027-01-15');
    assert.deepEqual(
      (r.staffChecks ?? []).map((t) => t.split(':')[0]).sort(),
      ['CS 8903 (Georgia Institute of Technology) “Special Problems”', 'ECE 4804 (Georgia Institute of Technology)'],
      JSON.stringify(r.staffChecks),
    );
  });

  it('the processing request says them before anything is processed', () => {
    const r = audit(student, rules, '2027-01-15');
    const { text } = gradAdminRequest(r, student, rules, { todayIso: '2027-01-15', entryTerm: 'Fall 2026', priorStudy: 'Completed prior M.S. or Ph.D.', gpa: 3.6 });
    // First below the line, before the transfer tables.
    assert.match(text, /\(DO NOT MODIFY ANYTHING BELOW THIS LINE\)\n\nPLEASE CHECK BEFORE PROCESSING\n- /);
    assert.match(text, /\n- ECE 4804 \(Georgia Institute of Technology\): the course rules let it transfer, but its number looks like an undergraduate course/);
    // No handbook sections in the request (DGS 2026-10-28): the check's own
    // "(§4.2)" is dropped, the sentence after it kept.
    assert.match(text, /\n- CS 8903 \(Georgia Institute of Technology\) “Special Problems”: the course rules let it transfer, and it counts toward the regular-course credits, but its title suggests independent study, research or a seminar, which are not regular courses\. Check it, and correct its ExternalCourses row if so\.\n/);
    assert.match(text, /\n- ECE 4804 \(Georgia Institute of Technology\): the course rules let it transfer, but its number looks like an undergraduate course — only graduate courses transfer\. Check that it is the graduate version, and correct its ExternalCourses row if not\.\n/);
    // The Graduate School's own rows print their title alone now — and never
    // an empty bracket (one printed "()" until 2026-10-04).
    // (The RCR training's own line merged into admission to candidacy on 2026-10-04.)
    assert.match(text, /\n\[NOT STARTED\] Admitted to doctoral candidacy\n/);
    assert.doesNotMatch(text, /\(\)/);
    assert.doesNotMatch(text, /§/);
  });

  it('an undergraduate number on a case-by-case or an unlisted course is flagged too, worded for the decision still to come', () => {
    const caseRules = buildRules({
      external: [{ university: 'ILLINOIS INSTITUTE OF TECHNOLOGY', course_id: 'CS 455', course_title: 'Data Communication', satisfies_core_area: 'none', transferable_PhD: 'dgs_approval', transferable_MSCSE: 'adgs_approval', is_cse: 'yes' }],
    });
    const iit = (courseId: string, title: string) => transferCourse(courseId, title, { institution: 'Illinois Institute of Technology', degreeLevel: 'masters' });
    const s = phdStudent({ priorMs: 'completed', bachelorsAwarded: { season: 'spring', year: 2022 }, courses: [iit('CS 455', 'Data Communication'), iit('CS 351', 'Systems Programming')] });
    const checks = audit(s, caseRules, '2027-01-15').staffChecks ?? [];
    assert.ok(checks.includes('CS 455 (Illinois Institute of Technology): the course rules decide it case by case, but its number looks like an undergraduate course — only graduate courses transfer (Academic Code §4.6). Check that it is the graduate version before approving it.'), JSON.stringify(checks));
    assert.ok(checks.includes('CS 351 (Illinois Institute of Technology): it is not in the course rules yet, but its number looks like an undergraduate course — only graduate courses transfer (Academic Code §4.6). Check that it is the graduate version before approving it.'), JSON.stringify(checks));
  });

  it('nothing for a student with no such course', () => {
    const plain = phdStudent({ priorMs: 'completed', bachelorsAwarded: { season: 'spring', year: 2022 }, courses: [gt('CS 6210', 'Advanced Operating Systems')] });
    assert.equal(audit(plain, rules, '2027-01-15').staffChecks, undefined);
  });
});
