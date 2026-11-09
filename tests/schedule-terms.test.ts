// Which semesters the course-rules page's two schedule cards stand for, and
// what a row's offered_now / offered_next say about them.
//
// Since 2026-11-08 the SHEET dates the schedule (DGS: "I want to change how
// 'current semester' is calculated. Use the 'last_offered' column to infer
// that. The latest semester there is the current semester."), after the DGS
// found the Spring 2027 card missing every course not running in Fall 2026:
// `offered_next` had been read only on rows dated this semester, and a course
// not running now cannot honestly be dated now (DGS 2026-09-18: last_offered is
// "the last time this course was offered").
//
// So: the schedule's semester is the latest fall or spring in last_offered;
// `offered_now` speaks for it only on a row dated it (a course running now was
// last offered now); `offered_next` speaks for the semester after it on every
// row. A date past the semester after today's is a typo, and is left out.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Term } from '../src/engine/types.ts';
import { afterTeachingTerm, latestDatable, rowSchedule, scheduleTerms, sheetSemester, teachingTermOf } from '../src/ui/schedule-terms.ts';

const fall = (year: number): Term => ({ season: 'fall', year });
const spring = (year: number): Term => ({ season: 'spring', year });
const summer = (year: number): Term => ({ season: 'summer', year });
const dated = (...terms: (Term | undefined)[]) => terms.map((lastOffered) => (lastOffered ? { lastOffered } : {}));

describe('the teaching terms a schedule is kept for', () => {
  it('fall is followed by the next spring, spring by the same year’s fall', () => {
    assert.deepEqual(afterTeachingTerm(fall(2026)), spring(2027));
    assert.deepEqual(afterTeachingTerm(spring(2027)), fall(2027));
  });
  it('during the summer, the date’s teaching semester is the fall that is coming', () => {
    assert.deepEqual(teachingTermOf(summer(2027)), fall(2027));
    assert.deepEqual(scheduleTerms(fall(2026)), { thisTerm: fall(2026), nextTerm: spring(2027) });
  });
});

describe('the schedule’s semester is the latest fall or spring in last_offered (DGS 2026-11-08)', () => {
  it('the latest date in the column, whatever the calendar says', () => {
    assert.deepEqual(sheetSemester(dated(spring(2026), fall(2026), fall(2025), undefined), fall(2026)), { term: fall(2026), fromSheet: true });
    // The calendar moved on and the sheet did not: the sheet's semester stands.
    assert.deepEqual(sheetSemester(dated(spring(2026), fall(2026)), spring(2027)), { term: fall(2026), fromSheet: true });
    // The DGS dated next semester's courses early: the schedule rolls over now.
    assert.deepEqual(sheetSemester(dated(fall(2026), spring(2027)), fall(2026)), { term: spring(2027), fromSheet: true });
  });
  it('a summer date does not move it — the cards are fall and spring', () => {
    assert.deepEqual(sheetSemester(dated(spring(2027), summer(2027)), summer(2027)), { term: spring(2027), fromSheet: true });
  });
  it('a date past the semester after today’s is a typo, and is left out', () => {
    assert.deepEqual(latestDatable(fall(2026)), spring(2027));
    assert.deepEqual(sheetSemester(dated(fall(2026), fall(2062), fall(2027)), fall(2026)), { term: fall(2026), fromSheet: true });
  });
  it('with no fall or spring date at all, the date’s own semester', () => {
    assert.deepEqual(sheetSemester(dated(undefined, summer(2026)), fall(2026)), { term: fall(2026), fromSheet: false });
    assert.deepEqual(sheetSemester([], summer(2027)), { term: fall(2027), fromSheet: false });
  });
});

describe('what one row says about the two cards', () => {
  const row = (lastOffered: Term | undefined, offeredNow?: boolean, offeredNext?: boolean) => ({ ...(lastOffered ? { lastOffered } : {}), ...(offeredNow !== undefined ? { offeredNow } : {}), ...(offeredNext !== undefined ? { offeredNext } : {}) });
  const TODAY = fall(2026);
  it('dated the schedule’s semester: both columns as written', () => {
    assert.deepEqual(rowSchedule(fall(2026), TODAY, row(fall(2026), true, false)), { freshness: 'current', this: true, next: false });
    assert.deepEqual(rowSchedule(fall(2026), TODAY, row(fall(2026), true)), { freshness: 'current', this: true });
  });
  it('not running now, on next semester’s schedule: listed for next semester (the DGS’s report)', () => {
    // CSE 60111: last offered Spring 2026, offered_next = yes, read in Fall 2026.
    assert.deepEqual(rowSchedule(fall(2026), TODAY, row(spring(2026), undefined, true)), { freshness: 'other', next: true });
    assert.deepEqual(rowSchedule(fall(2026), TODAY, row(fall(2025), undefined, true)), { freshness: 'other', next: true });
    assert.deepEqual(rowSchedule(fall(2026), TODAY, row(undefined, undefined, true)), { freshness: 'undated', next: true });
  });
  it('an offered_now beside an earlier date is left over from when the course ran: not shown', () => {
    assert.deepEqual(rowSchedule(fall(2026), TODAY, row(spring(2026), true, false)), { freshness: 'other', next: false });
    assert.deepEqual(rowSchedule(fall(2026), TODAY, row(undefined, true)), { freshness: 'undated' });
    // The sheet rolled to Spring 2027: last semester's fall courses leave the card.
    assert.deepEqual(rowSchedule(spring(2027), TODAY, row(fall(2026), true, true)), { freshness: 'other', next: true });
  });
  it('a row dated past the semester after today’s shows nothing', () => {
    assert.deepEqual(rowSchedule(fall(2026), TODAY, row(fall(2027), true, true)), { freshness: 'ahead' });
    assert.deepEqual(rowSchedule(spring(2027), TODAY, row(spring(2027), true, true)), { freshness: 'current', this: true, next: true });
  });
  it('a summer last_offered counts as the fall that follows it', () => {
    assert.deepEqual(rowSchedule(fall(2026), TODAY, row(summer(2026), true)), { freshness: 'current', this: true });
    assert.deepEqual(rowSchedule(fall(2026), TODAY, row(summer(2025), false, true)), { freshness: 'other', next: true });
  });
  it('the live sheet: 13 courses running now and 24 that are not, all on the Spring 2027 card', () => {
    const live = [...Array(13).fill(row(fall(2026), true, true)), ...Array(24).fill(row(spring(2026), undefined, true))];
    const semester = sheetSemester(live, TODAY).term;
    assert.deepEqual(semester, fall(2026));
    assert.equal(live.filter((r) => rowSchedule(semester, TODAY, r).next === true).length, 37);
    assert.equal(live.filter((r) => rowSchedule(semester, TODAY, r).this === true).length, 13);
  });
});

// Reading (c), confirmed by the DGS on 2026-11-08 with: "For (c), when there
// is such a typo, show a warning on the webpage."
describe('a last_offered too late to be true is warned about on the pages', () => {
  it('a date past the semester after today’s: one on-page warning per row, naming the cell', async () => {
    const { buildRules } = await import('./helpers.ts');
    const { lastOfferedTypoIssues, coursesPageWarnings, diagnosticsContent } = await import('../src/ui/sheet-warnings.ts');
    const rules = buildRules({ courses: [{ course_id: 'CSE 60641', set: { last_offered: 'Fall 2062' } }] });
    const issues = lastOfferedTypoIssues(rules, fall(2026));
    assert.equal(issues.length, 1);
    const [w] = issues;
    assert.equal(w!.onPage, true);
    assert.equal(w!.severity, 'warning');
    assert.equal(w!.column, 'last_offered');
    assert.match(w!.message, /^Courses row \d+ \(CSE 60641\): last_offered is Fall 2062, later than Spring 2027 — a course cannot last have been offered then, so it is taken for a typo: it does not set the semester the schedule describes, and the course is left off the schedule\. Correct the cell\.$/);
    // Shown on both pages: the course-rules page and the self-check's box.
    assert.equal(coursesPageWarnings(issues, false).masthead.length, 1);
    assert.equal(coursesPageWarnings(issues, true).notices.length, 1);
    assert.match(diagnosticsContent(issues)!.summary, /^Rules-sheet warning — for the DGS$/);
  });
  it('next semester is not a typo — dating next semester’s courses is how the schedule rolls over', async () => {
    const { buildRules } = await import('./helpers.ts');
    const { lastOfferedTypoIssues } = await import('../src/ui/sheet-warnings.ts');
    assert.deepEqual(lastOfferedTypoIssues(buildRules({ courses: [{ course_id: 'CSE 60641', set: { last_offered: 'Spring 2027' } }] }), fall(2026)), []);
    assert.deepEqual(lastOfferedTypoIssues(buildRules(), fall(2026)), [], 'the fixture sheet has none');
    // In the summer, "today's" semester is the coming fall: Spring 2028 is the limit.
    assert.deepEqual(lastOfferedTypoIssues(buildRules({ courses: [{ course_id: 'CSE 60641', set: { last_offered: 'Spring 2028' } }] }), summer(2027)), []);
    assert.equal(lastOfferedTypoIssues(buildRules({ courses: [{ course_id: 'CSE 60641', set: { last_offered: 'Fall 2028' } }] }), summer(2027)).length, 1);
  });
});
