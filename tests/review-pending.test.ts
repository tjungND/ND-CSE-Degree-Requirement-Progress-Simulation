// Which courses the review request asks about (2026-09-06 evening: the DGS
// reported the "Ask the DGS to review" card vanishing for good). A row in the
// ExternalCourses tab is a decision only where its cells say something.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { coursesNeedingDgsReview, reviewRequestSummary } from '../src/engine/review.ts';
import type { CourseEntry, Student } from '../src/engine/types.ts';
import { buildRules } from './helpers.ts';
import { phdStudent, transferCourse as purdue } from './helpers/student.ts';

describe('reviewRequestSummary — the card chip and its copy button', () => {
  it('names courses, courses and a note, or (2026-09-12 bug) just a note — never "0 courses"', () => {
    assert.equal(reviewRequestSummary(3, false), '3 courses');
    assert.equal(reviewRequestSummary(1, false), '1 course');
    assert.equal(reviewRequestSummary(2, true), '2 courses and a note');
    assert.equal(reviewRequestSummary(0, true), 'a note');
  });
});

type Row = Record<string, string>;
// A blank course_title: the row decides every course with that id (DGS 2026-11-07 — a titled row decides only the course of that title).
const row = (course_id: string, extra: Row = {}): Row => ({ university: 'PURDUE UNIVERSITY', course_id, course_title: '', ...extra });

const student = (courses: CourseEntry[]): Student => phdStudent({ priorMs: 'completed', courses });
const ids = (s: Student, external: Row[] | undefined) =>
  coursesNeedingDgsReview(s, external === undefined ? buildRules() : buildRules({ external }))
    .map((p) => `${p.course.entry.courseId}:${p.unlisted ? 'new-row' : 'decide'}`)
    .sort();
const reasonOf = (s: Student, external: Row[], courseId: string) =>
  coursesNeedingDgsReview(s, buildRules({ external })).find((p) => p.course.entry.courseId === courseId)?.reason;

describe('coursesNeedingDgsReview — courses from another university', () => {
  it('no row: a graduate course is pending and needs a new row; below the grade floor only a core-sounding title is', () => {
    assert.deepEqual(ids(student([purdue('CS 51000', 'Data Mining')]), []), ['CS 51000:new-row']);
    assert.equal(reasonOf(student([purdue('CS 51000', 'Data Mining')]), [], 'CS 51000'), 'not in the course rules yet — the DGS enters it');
    assert.deepEqual(ids(student([purdue('CS 51000', 'Data Mining', { grade: 'C' })]), []), []);
    assert.deepEqual(ids(student([purdue('CS 50300', 'Operating Systems', { grade: 'C' })]), []), ['CS 50300:new-row']);
    assert.match(reasonOf(student([purdue('CS 50300', 'Operating Systems', { grade: 'C' })]), [], 'CS 50300')!, /no transfer credit, but the title suggests/);
  });

  it('a row with both cells blank (pasted from the request, not decided yet) keeps the course in the request', () => {
    // The regression: before the fix any row counted as "ruled" and the course dropped out for good.
    const blank = [row('CS 51000'), row('CS 50300')];
    assert.deepEqual(ids(student([purdue('CS 51000', 'Data Mining'), purdue('CS 50300', 'Operating Systems')]), blank), ['CS 50300:decide', 'CS 51000:decide']);
    assert.equal(reasonOf(student([purdue('CS 51000', 'Data Mining')]), blank, 'CS 51000'), 'listed in the course rules, decision still open (§5.2)');
    assert.match(reasonOf(student([purdue('CS 50300', 'Operating Systems')]), blank, 'CS 50300')!, /decision still open \(§5\.2\), and no core area recorded/);
  });

  it('a blank row for an undergraduate course: pending only while a core-sounding title has no core-area decision', () => {
    const blank = [row('CS 25100'), row('CS 30700')];
    const s = student([purdue('CS 25100', 'Operating Systems', { degreeLevel: 'bachelors' }), purdue('CS 30700', 'Special Topics', { degreeLevel: 'bachelors' })]);
    assert.deepEqual(ids(s, blank), ['CS 25100:decide']);
    assert.match(reasonOf(s, blank, 'CS 25100')!, /reviewed by the DGS, but no core area recorded/);
  });

  it('transferable decided: still pending while a core-sounding title has no core-area decision; `none` closes it', () => {
    const s = student([purdue('CS 50300', 'Advanced Algorithms')]);
    assert.deepEqual(ids(s, [row('CS 50300', { transferable: 'yes' })]), ['CS 50300:decide']);
    assert.deepEqual(ids(s, [row('CS 50300', { transferable: 'yes', satisfies_core_area: 'algorithms' })]), []);
    assert.deepEqual(ids(s, [row('CS 50300', { transferable: 'no' })]), ['CS 50300:decide']);
    assert.deepEqual(ids(s, [row('CS 50300', { transferable: 'no', satisfies_core_area: 'none' })]), []);
    assert.deepEqual(ids(student([purdue('CS 59000', 'Special Topics')]), [row('CS 59000', { transferable: 'no' })]), []);
  });

  // `dgs_approval` (DGS 2026-09-08) decides the COURSE and leaves the STUDENT
  // open, so the course keeps its place in the request — with a reason that
  // tells the student what to say — while `yes` and `no` close the §5.2 part.
  // The card names the open decision and nothing else (DGS 2026-09-08): why a
  // course is decided case by case — its relevance to the student's research —
  // is settled between the advisor and the DGS, so the student is not asked to
  // argue it anywhere on the page.
  it('transferable = dgs_approval keeps the course in the request, without asking the student to justify it', () => {
    const s = student([purdue('STAT 51200', 'Applied Regression Analysis')]);
    const caseRow = [row('STAT 51200', { transferable_PhD: 'dgs_approval', satisfies_core_area: 'none' })];
    assert.deepEqual(ids(s, caseRow), ['STAT 51200:decide'], 'it needs a DECISION, not a new sheet row');
    // No pronoun, and no instruction: this reason is a column of the e-mail
    // the student sends the DGS, so it must read the same way to both of them.
    assert.equal(reasonOf(s, caseRow, 'STAT 51200'), 'listed as case by case — needs the DGS’s approval for you (§5.2)');
    // A core-sounding title with no core-area decision adds its half to the
    // same line rather than replacing it.
    const both = student([purdue('CS 50300', 'Operating Systems')]);
    assert.match(
      reasonOf(both, [row('CS 50300', { transferable_PhD: 'dgs_approval' })], 'CS 50300')!,
      /needs the DGS’s approval for you \(§5\.2\), and no core area recorded/,
    );
    // `yes` and `no` still close the transfer half.
    assert.deepEqual(ids(s, [row('STAT 51200', { transferable: 'yes', satisfies_core_area: 'none' })]), []);
    assert.deepEqual(ids(s, [row('STAT 51200', { transferable: 'no', satisfies_core_area: 'none' })]), []);
    // And so does the tick on the course itself (per course since 2026-09-27)
    // — otherwise the report says "met" while the card still asks the DGS to
    // decide the same course (2026-09-08).
    const attested = { ...s, courses: s.courses.map((c) => ({ ...c, dgsApproved: true as const })) };
    assert.deepEqual(ids(attested, caseRow), []);
    // …but a listed row whose cell is BLANK is not a decision, so the tick
    // cannot close it (ruling 2026-09-11; red-team F5, 2026-09-12).
    assert.deepEqual(ids(attested, [row('STAT 51200')]), ['STAT 51200:decide'], 'a blank cell stays asked whatever is ticked');
  });

  // The DGS types these words by hand into a spreadsheet cell.
  it('a hand-typed verdict forgives the separator and the capitals', () => {
    const s2 = student([purdue('STAT 51200', 'Applied Regression Analysis')]);
    for (const typed of ['dgs_approval', 'DGS approval', 'dgs-approval', 'DGS_Approval', 'adgs_approval', 'ADGS approval']) {
      const rules = buildRules({ external: [row('STAT 51200', { transferable_PhD: typed, satisfies_core_area: 'none' })] });
      assert.match(rules.external[0]?.transferablePhd ?? '', /^a?dgs_approval$/, typed);
      assert.equal(rules.issues.filter((i) => i.tab === 'ExternalCourses').length, 0, typed);
      assert.equal(coursesNeedingDgsReview(s2, rules).length, 1, typed);
    }
    // A different word is still an error, and the cell is ignored.
    const bad = buildRules({ external: [row('STAT 51200', { transferable_PhD: 'maybe' })] });
    assert.equal(bad.external[0]?.transferablePhd, undefined);
    assert.match(bad.issues.find((i) => i.column === 'transferable_phd')?.message ?? '', /'yes', 'no', 'dgs_approval', 'adgs_approval' or blank/);
  });

  // Two columns since 2026-09-09: the ruling that applies depends on the
  // student's own program, and a sheet still using the one `transferable`
  // column fills both.
  it('the Ph.D. and the MSCSE ruling are read separately', () => {
    const split = [row('STAT 51200', { transferable_PhD: 'yes', transferable_MSCSE: 'adgs_approval', satisfies_core_area: 'none' })];
    const phd = student([purdue('STAT 51200', 'Applied Regression Analysis')]);
    const ms: Student = { ...phd, program: 'mscse' };
    assert.deepEqual(ids(phd, split), [], 'pre-approved for a Ph.D. student');
    assert.deepEqual(ids(ms, split), ['STAT 51200:decide'], 'the MSCSE side still needs an approval');
    assert.equal(reasonOf(ms, split, 'STAT 51200'), 'listed as case by case — needs the ADGS’s approval for you (§5.2)'); // the ADGS decides for the MSCSE (2026-09-11)
  });

  it('the old single column still fills both programs', () => {
    const oneColumn = [row('STAT 51200', { transferable: 'yes', satisfies_core_area: 'none' })];
    const phd = student([purdue('STAT 51200', 'Applied Regression Analysis')]);
    assert.deepEqual(ids(phd, oneColumn), []);
    assert.deepEqual(ids({ ...phd, program: 'mscse' }, oneColumn), []);
  });

  it('the `none` value parses as a decision (null), a blank as undecided (undefined)', () => {
    const rules = buildRules({ external: [row('CS 47300', { satisfies_core_area: 'none' }), row('CS 47301')] });
    assert.equal(rules.external.find((r) => r.courseId === 'CS 47300')?.satisfiesCoreArea, null);
    assert.equal(rules.external.find((r) => r.courseId === 'CS 47301')?.satisfiesCoreArea, undefined);
    assert.equal(buildRules().external.find((r) => r.courseId === 'CS 47300')?.satisfiesCoreArea, null, 'the fixture tab carries a none row');
  });
});

describe('coursesNeedingDgsReview — Notre Dame coursework', () => {
  const nd = (courseId: string, title: string, extra: Partial<CourseEntry> = {}): CourseEntry => ({
    courseId,
    title,
    credits: 3,
    term: { season: 'fall', year: 2026 },
    grade: 'A',
    origin: 'nd',
    ...extra,
  });

  it('an unlisted course needs a new Courses-tab row — CSE or not (MATH 60610 used to be listed but never offered as a row)', () => {
    const s = student([nd('CSE 60641', 'Graduate Operating Systems'), nd('CSE 69999', 'Unknown Seminar'), nd('MATH 60610', 'Basic Real Analysis')]);
    const pending = coursesNeedingDgsReview(s, buildRules());
    assert.deepEqual(pending.map((p) => `${p.course.entry.courseId}:${p.kind}:${p.unlisted ? 'new-row' : 'decide'}`), ['CSE 69999:nd:new-row', 'MATH 60610:nd:new-row']);
    assert.equal(pending[0]!.reason, 'not in the course rules yet');
    assert.match(pending[1]!.reason, /outside CSE|non-CSE course/);
  });

  it('prior Notre Dame coursework: a Courses-tab core area decides §4.4.1; otherwise a core-sounding undergraduate title is asked about', () => {
    const prior = (courseId: string, title: string, degreeLevel: CourseEntry['degreeLevel']): CourseEntry =>
      nd(courseId, title, { origin: 'transfer', institution: 'University of Notre Dame', degreeLevel, term: { season: 'fall', year: 2024 } });
    const s = student([prior('CSE 30321', 'Computer Architecture', 'bachelors'), prior('CSE 20110', 'Discrete Mathematics', 'bachelors'), prior('CSE 60641', 'Graduate Operating Systems', 'bachelors')]);
    const pending = coursesNeedingDgsReview(s, buildRules());
    assert.deepEqual(pending.map((p) => `${p.course.entry.courseId}:${p.kind}:${p.unlisted ? 'new-row' : 'decide'}`), ['CSE 30321:priorNd:new-row']);
    assert.match(pending[0]!.reason, /taken at Notre Dame before entering the program \(undergraduate\) — not in the course rules yet/);
  });

  // DGS 2026-09-11: "they 'may' count, subject to all other constraints, so
  // they should be listed when a MSCSE uploads an ND undergrad transcript for
  // further decisions & review." The sheet's `adgs_approval` (the MSCSE's side
  // of `dgs_approval`) is what makes them a "may"; the ticked attestation is
  // what settles it. The course carrying that shape is CSE 40437 (2026-09-18:
  // the live sheet says adgs_approval for the MSCSE, dgs_approval for the
  // Ph.D.); CSE 40600 carries the blocked-outright shape beside it.
  it('an MSCSE student’s own 40000-level undergraduate coursework is listed until the approval exists', () => {
    const ug = (courseId: string, title: string): CourseEntry =>
      nd(courseId, title, { origin: 'transfer', institution: 'University of Notre Dame', degreeLevel: 'bachelors', term: { season: 'fall', year: 2025 }, countedToward: 'bs' });
    const ms = (attested: boolean): Student => ({
      schemaVersion: 1,
      program: 'mscse',
      entryTerm: { season: 'fall', year: 2026 },
      bachelorsAwarded: { season: 'spring', year: 2026 },
      priorMs: 'none',
      // The tick sits on the course since 2026-09-27.
      courses: [{ ...ug('CSE 40437', 'Social Sensing and Cyber-Physical Systems'), ...(attested ? { dgsApproved: true as const } : {}) }, ug('CSE 40600', 'CSE Service Projects'), ug('CSE 20110', 'Discrete Mathematics')],
      milestones: {},
      attestations: {},
    });
    const pending = coursesNeedingDgsReview(ms(false), buildRules());
    // CSE 40600 is `no` in the sheet and CSE 20110 too low to count: neither is a decision to make.
    assert.deepEqual(pending.map((p) => `${p.course.entry.courseId}:${p.kind}:${p.unlisted ? 'new-row' : 'decide'}`), ['CSE 40437:priorNd:decide']);
    assert.match(pending[0]!.reason, /may count toward the MSCSE \(§3\.2\) inside the allowance for courses below the 60000 level — needs advisor \+ ADGS approval/); // the ADGS decides for the MSCSE (2026-09-11)
    assert.deepEqual(coursesNeedingDgsReview(ms(true), buildRules()), []);
  });
});

// Nothing is asked when no possible answer changes the report (DGS 2026-09-13,
// answering a red-team pass). A passed grade below C earns no credit (Academic
// Code §4.3) and cannot clear §4.4.2's B floor, so a DGS ruling can only still
// add a §4.4.1 core area — for a Ph.D. student, on an unlisted course whose
// title names an area.
describe('the review request skips a course no ruling can help', () => {
  const rules = buildRules();
  const nd = (courseId: string, grade: CourseEntry['grade'], title?: string): Student => ({
    schemaVersion: 1,
    program: 'phd',
    entryTerm: { season: 'fall', year: 2026 },
    priorMs: 'none',
    courses: [{ courseId, title, credits: 3, term: { season: 'fall', year: 2026 }, grade, origin: 'nd' }],
    milestones: {},
    attestations: {},
  });
  const asked = (s: Student) => coursesNeedingDgsReview(s, rules).map((p) => p.course.entry.courseId);

  it('a listed dgs_approval course with a D is not asked about — approval could add nothing', () => {
    // CSE 40243 is a 40000-level course the sheet lets the Ph.D. count only
    // with the DGS's approval (2026-09-18: the course that used to stand here,
    // CSE 40113, counts outright in the live sheet).
    assert.deepEqual(asked(nd('CSE 40243', 'D')), []);
    // The same course with a countable grade is still asked about.
    assert.deepEqual(asked(nd('CSE 40243', 'B')), ['CSE 40243']);
  });

  it('a C- whose core area the sheet already gives is not asked about either', () => {
    // CSE 50502 is tagged core_area=algorithms, so §4.4.1 is already satisfied
    // without any ruling; credit is foreclosed by the grade. (It replaced
    // CSE 50120, which the live sheet has never carried — 2026-09-18.)
    assert.deepEqual(asked(nd('CSE 50502', 'C-')), []);
  });

  it('an UNLISTED C- whose title names a core area is still asked about', () => {
    assert.deepEqual(asked(nd('CSE 61234', 'C-', 'Operating Systems Design')), ['CSE 61234']);
    assert.deepEqual(asked(nd('CSE 61234', 'C-', 'Databases')), []);
  });

  it('for an MSCSE student there is no §4.4.1 to save it, so a C- is never asked about', () => {
    const ms: Student = { ...nd('CSE 61234', 'C-', 'Operating Systems Design'), program: 'mscse' };
    assert.deepEqual(asked(ms), []);
  });
});

describe('what the request asks of the DGS — ReviewAsk (DGS 2026-09-28: the request says which items need a reply)', () => {
  const askOf = (s: Student, external: Row[] | undefined, courseId: string) =>
    coursesNeedingDgsReview(s, external === undefined ? buildRules() : buildRules({ external })).find((p) => p.course.entry.courseId === courseId)?.ask;

  it('a course with no row: a new row, no reply — the sheet’s own questions; a blank row: complete it, no reply', () => {
    assert.deepEqual(askOf(student([purdue('CS 51000', 'Data Mining')]), [], 'CS 51000'), { needsRow: true, replyNeeded: false, decide: ['transferable to the Ph.D. (§5.2): yes / no / case by case'] });
    assert.deepEqual(askOf(student([purdue('CS 50300', 'Operating Systems')]), [], 'CS 50300'), { needsRow: true, replyNeeded: false, decide: ['transferable to the Ph.D. (§5.2): yes / no / case by case', 'core area (§4.4.1), if any'] });
    assert.deepEqual(askOf(student([purdue('CS 50300', 'Operating Systems', { grade: 'C' })]), [], 'CS 50300'), { needsRow: true, replyNeeded: false, decide: ['core area (§4.4.1), if any'] }, 'no transfer credit below the floor — only the core area');
    assert.deepEqual(askOf(student([purdue('CS 51000', 'Data Mining')]), [row('CS 51000')], 'CS 51000'), { needsRow: false, replyNeeded: false, decide: ['transferable to the Ph.D. (§5.2): yes / no / case by case — the row is blank'] });
    assert.deepEqual(askOf(student([purdue('CS 50300', 'Operating Systems')]), [row('CS 50300', { transferable: 'yes' })], 'CS 50300'), { needsRow: false, replyNeeded: false, decide: ['core area (§4.4.1), if any'] });
  });

  it('a course the rules decide case by case: an answer for this student — a reply', () => {
    assert.deepEqual(askOf(student([purdue('STAT 51200', 'Applied Regression Analysis')]), [row('STAT 51200', { transferable: 'dgs_approval' })], 'STAT 51200'), { needsRow: false, replyNeeded: true, decide: ['approve the transfer for me — the course rules say case by case (§5.2)'], rulings: ['approve the transfer for me — the course rules say case by case (§5.2)'] });
  });

  it('Notre Dame coursework: an unlisted course asks for the row and the qualifier columns; a listed case-by-case row asks for the answer', () => {
    const math: CourseEntry = { courseId: 'MATH 60610', title: 'Basic Linear Algebra', credits: 3, term: { season: 'fall', year: 2026 }, grade: 'A', origin: 'nd' };
    assert.deepEqual(askOf(student([math]), undefined, 'MATH 60610'), { needsRow: true, replyNeeded: false, decide: ['counts toward the Ph.D.: yes / no / case by case', 'core area (§4.4.1), if any', 'specialization group (§4.4.2), if any'] });
    // CSE 40567 is a 4xxxx course the fixture Courses tab lists with dgs_approval (the allowance's own approval).
    const cse4 = { ...math, courseId: 'CSE 40567', title: undefined };
    const a = askOf(student([cse4]), undefined, 'CSE 40567');
    assert.equal(a?.needsRow, false);
    assert.equal(a?.replyNeeded, true);
    assert.equal(a?.decide.length, 1);
    assert.match(a!.decide[0]!, /^approve it for me/);
  });
});
