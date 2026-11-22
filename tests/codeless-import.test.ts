// CC15 — code-less transcripts (DGS 2026-10-09, transcript accuracy program,
// Batch C: "IMPORTED with an empty required course-id box the student fills
// before the row can be added; the course stays 'not yet reviewed by the DGS'
// until an ExternalCourses match; canonicalCourseId, duplicate detection and
// the review request never receive an empty id"). The parser's side is pinned
// in tests/public-transcript-rules.test.ts and the public fixtures; this file
// pins the preview's: the row starts unticked with an empty box, cannot be
// added until an id is typed, and `''` reaches nothing downstream.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { findExternalRule } from '../src/data/external.ts';
import { sameTransferCourse } from '../src/engine/nd-posting.ts';
import type { CourseEntry } from '../src/engine/types.ts';
import { parseExternalTranscript } from '../src/transcript/external.ts';
import { rowIsCompact } from '../src/transcript/preview-layout.ts';
import { CODE_MISSING_NOTE, CODE_MISSING_PLACEHOLDER, codeMissingHint, idStillMissing, previewRowOf, readyToAdd, undergraduateInProgress } from '../src/ui/external-upload.ts';
import { buildRules } from './helpers.ts';

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/public-transcripts/${name}.json`, import.meta.url), 'utf8')) as string[];

describe('CC15 code-less rows in the transcript preview (DGS 2026-10-09)', () => {
  const parsed = parseExternalTranscript(fixture('nankai-graduate-record'));
  const rows = parsed.courses.map((c) => previewRowOf(c, 'masters'));

  it('every code-less row starts UNTICKED with an empty id box; a coded row starts ticked', () => {
    assert.equal(rows.length, 9);
    for (const r of rows) {
      assert.equal(r.courseId, '');
      assert.equal(r.codeMissing, true);
      assert.equal(r.include, false);
      assert.equal(idStillMissing(r), true);
    }
    const coded = previewRowOf({ courseId: 'CS 500', title: 'Topics', credits: 3, grade: 'A', year: 2023, season: 'fall' }, 'masters');
    assert.equal(coded.include, true);
    assert.equal(coded.codeMissing, undefined);
    assert.equal(idStillMissing(coded), false);
  });

  it('a code-less row is never added while its id is empty — even ticked by hand — and is once one is typed', () => {
    const r = { ...rows[0]! };
    assert.equal(readyToAdd(r), false);
    r.include = true; // a stray tick cannot add it: the id is still empty
    assert.equal(readyToAdd(r), false);
    r.courseId = '   ';
    assert.equal(idStillMissing(r), true, 'blanks are no id');
    assert.equal(readyToAdd(r), false);
    r.courseId = 'CS 70101';
    assert.equal(idStillMissing(r), false);
    assert.equal(readyToAdd({ ...r, grade: 'A' }), true);
    // Nankai's marks are raw ("92"): the grade is still chosen before adding.
    assert.equal(readyToAdd(r), false);
  });

  it('the row stays an editable, full-size row (never the compact one-line form) for as long as the preview is open', () => {
    assert.equal(rowIsCompact({ locked: true, credits: 3, grade: 'S', year: 2021, codeMissing: true }), false);
    assert.equal(rowIsCompact({ locked: true, credits: 3, grade: 'S', year: 2021 }), true);
  });

  it('an empty id matches no DGS ruling and no other course', () => {
    const rules = buildRules();
    assert.equal(findExternalRule(rules.external, 'NANKAI UNIVERSITY', '', undefined), undefined);
    const blank = { courseId: '', origin: 'transfer', institution: 'Nankai University', credits: 3, grade: 'A', term: { season: 'fall', year: 2021 } } as CourseEntry;
    assert.equal(sameTransferCourse(blank, { ...blank }), false, 'two blank ids are not one course');
    assert.equal(sameTransferCourse({ ...blank, courseId: 'CS 701' }, { ...blank, courseId: 'cs-701' }), true);
  });

  it('a bachelor’s statement whose results are marks or band words is complete, not "still in progress"', () => {
    const cairo = parseExternalTranscript(fixture('cairo'));
    const cairoRows = cairo.courses.map((c) => previewRowOf(c, 'bachelors'));
    assert.ok(cairoRows.length > 0 && cairoRows.every((r) => r.grade === '' && r.rawGrade !== undefined));
    assert.equal(undergraduateInProgress('bachelors', cairoRows, cairo.bachelorsConferred === true), false);
    // A row with no result at all still means in progress (2026-09-11).
    assert.equal(undergraduateInProgress('bachelors', [{ grade: 'A' }, { grade: '' }]), true);
  });

  it('the wording (W-CL407–W-CL409)', () => {
    assert.equal(CODE_MISSING_PLACEHOLDER, 'course number');
    assert.match(CODE_MISSING_NOTE, /prints no course number/);
    assert.match(codeMissingHint(1), /^One course on this transcript has no course number printed/);
    assert.match(codeMissingHint(9), /^9 courses on this transcript have no course number printed/);
  });
});

// DGS 2026-11-22, on Xi'an Jiaotong University's transcripts, which print no
// course numbers — students typed "N/A": "When this happens, can you use the
// title to match the courses, instead of the course id?"
describe('a course with no number is matched by its title (DGS 2026-11-22)', async () => {
  const { courseIdKey, findExternalRule, hasNoCourseId, isCseCourse } = await import('../src/data/external.ts');
  const { parseExternalTab } = await import('../src/data/parse.ts');
  const { sameTransferCourse } = await import('../src/engine/nd-posting.ts');
  const { classify } = await import('../src/engine/allocate.ts');
  const { buildCombinedReviewRequest } = await import('../src/ui/review-request.ts');
  const { buildRules } = await import('./helpers.ts');
  const { phdStudent } = await import('./helpers/student.ts');
  const XJTU = "XI'AN JIAOTONG UNIVERSITY";
  const tab = (rows: string[][], issues: unknown[] = []) =>
    parseExternalTab(['university,course_id,course_title,satisfies_core_area,transferable_PhD', ...rows.map((r) => r.map((c) => `"${c}"`).join(','))].join('\n'), [{ code: 'os', name: 'Operating Systems' }], issues as never);
  it('“N/A”, “n/a”, “none”, “-” and an empty box all mean no number; a real code never does', () => {
    for (const id of ['N/A', 'n/a', 'NA', 'none', '-', '', 'TBD']) assert.equal(hasNoCourseId(id), true, id);
    for (const id of ['CS 598', 'NA 101', 'N1']) assert.equal(hasNoCourseId(id), false, id);
    assert.equal(courseIdKey('N/A'), courseIdKey('none'));
  });
  it('the ExternalCourses row of the same title decides it — whatever stands for the number', () => {
    const rows = tab([[XJTU, 'N/A', 'Theory of Parallel Computing', 'none', 'yes'], [XJTU, 'N/A', 'Social and Information Network Analysis', 'none', 'no']]);
    assert.equal(rows.length, 2, 'two titles under N/A are two courses, both rows stand');
    assert.equal(findExternalRule(rows, XJTU, 'N/A', 'Theory of Parallel Computing')?.transferablePhd, 'yes');
    assert.equal(findExternalRule(rows, XJTU, 'none', 'THEORY OF PARALLEL COMPUTING')?.transferablePhd, 'yes');
    assert.equal(findExternalRule(rows, XJTU, 'N/A', 'Social and Information Network Analysis')?.transferablePhd, 'no');
    assert.equal(findExternalRule(rows, XJTU, 'N/A', 'Special Topics of Software Engineering Medium'), undefined, 'a title the tab does not have is not reviewed');
    assert.equal(findExternalRule(rows, XJTU, 'N/A', ''), undefined, 'no number and no title: nothing to match');
  });
  it('a numbered row of the same title decides it when only one number carries the title', () => {
    assert.equal(findExternalRule(tab([[XJTU, 'CS 301', 'Theory of Parallel Computing', 'none', 'yes']]), XJTU, 'N/A', 'Theory of Parallel Computing')?.transferablePhd, 'yes');
    const two = tab([[XJTU, 'CS 301', 'Special Topics', 'none', 'yes'], [XJTU, 'CS 302', 'Special Topics', 'none', 'no']]);
    assert.equal(findExternalRule(two, XJTU, 'N/A', 'Special Topics'), undefined, 'two numbers under one title: two courses, no guess');
  });
  it('an N/A row decides a course of its title that does print a number', () => {
    const rows = tab([[XJTU, 'N/A', 'Theory of Parallel Computing', 'none', 'yes']]);
    assert.equal(findExternalRule(rows, XJTU, 'CS 301', 'Theory of Parallel Computing')?.transferablePhd, 'yes');
    assert.equal(findExternalRule(rows, XJTU, 'CS 301', 'Compilers'), undefined);
  });
  it('the sheet check: the same title under “N/A” and “none” is a repeat; different titles are not', () => {
    const issues: { message: string }[] = [];
    const rows = tab([[XJTU, 'N/A', 'Theory of Parallel Computing', 'none', 'no'], [XJTU, 'none', 'Theory of Parallel Computing', 'none', 'yes']], issues);
    assert.equal(rows.length, 1);
    assert.match(issues[0]!.message, /repeats/);
  });
  const row = (title: string, season: 'fall' | 'spring', year: number) => ({ courseId: 'N/A', title, credits: 3, grade: 'A' as const, term: { season, year }, origin: 'transfer' as const, institution: XJTU, degreeLevel: 'masters' as const });
  it('two rows with no number are one course only when their titles are', () => {
    assert.equal(sameTransferCourse(row('Theory of Parallel Computing', 'fall', 2022), row('Social and Information Network Analysis', 'fall', 2022)), false);
    assert.equal(sameTransferCourse(row('Theory of Parallel Computing', 'fall', 2022), row('theory of parallel computing', 'spring', 2023)), true);
    assert.equal(sameTransferCourse(row('Theory of Parallel Computing', 'fall', 2022), { ...row('Theory of Parallel Computing', 'fall', 2022), courseId: 'CS 301' }), false);
  });
  it('three courses with no number: no “entered 3 times” warning — they are three courses', () => {
    const s = phdStudent({ priorMs: 'completed', courses: [row('Special Topics of Software Engineering Medium', 'fall', 2022), row('Theory of Parallel Computing', 'fall', 2022), row('Social and Information Network Analysis', 'spring', 2023)] });
    assert.deepEqual(classify(s, buildRules(), '2027-01-15').warnings.filter((w) => /is entered/.test(w)), []);
    const twice = phdStudent({ priorMs: 'completed', courses: [row('Theory of Parallel Computing', 'fall', 2022), row('Theory of Parallel Computing', 'spring', 2023)] });
    assert.equal(classify(twice, buildRules(), '2027-01-15').warnings.filter((w) => /is entered 2 times/.test(w)).length, 1, 'the same title twice is still said');
  });
  it('one course number under different titles in one term: no duplicate warning (DGS 2026-11-07)', () => {
    const topic = (title: string) => ({ courseId: 'CS 598', title, credits: 4, grade: 'A' as const, term: { season: 'spring' as const, year: 2023 }, origin: 'transfer' as const, institution: 'University of Illinois Urbana-Champaign', degreeLevel: 'masters' as const });
    const s = phdStudent({ priorMs: 'completed', courses: [topic('Deep Generative Models'), topic('Topics in Systems: A Survey')] });
    assert.deepEqual(classify(s, buildRules(), '2027-01-15').warnings.filter((w) => /is entered/.test(w)), []);
  });
  it('no number, no subject: whether it is a CSE course waits for the DGS’s is_cse', () => {
    assert.equal(isCseCourse('N/A', undefined, ['CS', 'CSE']), undefined);
  });
  it('the review request: one ExternalCourses row per title, each pasted as N/A', () => {
    const pending = (courseId: string, title: string) => ({ institution: XJTU, courseId, title, credits: 3, grade: 'A', termText: 'Fall 2022', reason: 'not yet reviewed by the DGS', unlisted: true });
    const built = buildCombinedReviewRequest({
      priorStudy: 'Completed prior M.S. or Ph.D.',
      nd: [],
      external: [pending('N/A', 'Special Topics of Software Engineering Medium'), pending('N/A', 'Theory of Parallel Computing'), pending('none', 'Social and Information Network Analysis')],
    });
    const tabText = built.text.slice(built.text.indexOf('rules sheet — ExternalCourses tab:'), built.text.indexOf('Course details:'));
    for (const title of ['Special Topics of Software Engineering Medium', 'Theory of Parallel Computing', 'Social and Information Network Analysis']) {
      assert.equal((tabText.match(new RegExp(`N/A\\t${title}`, 'g')) ?? []).length, 1, title);
    }
  });
});
