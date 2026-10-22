// "Save to a file" and "Load a file" (blue-team review 2026-10-17, batch F):
// the saved file's name carries the day of the check (U24); the load toast
// says when the file was saved, at Notre Dame, and how many courses it holds
// (U24) and what it replaced (U23); only a record that held entries — a
// course or a milestone answer — gets the Undo (U23).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { CourseEntry } from '../src/engine/types.ts';
import { emptyStudent, loadedRecordToast, recordHoldsEntries, selfCheckFileName } from '../src/ui/state.ts';

/** A record with `n` Notre Dame courses. */
function withCourses(n: number) {
  const s = emptyStudent();
  for (let i = 0; i < n; i++) {
    const c: CourseEntry = { courseId: `CSE 6064${i}`, credits: 3, term: { season: 'fall', year: 2026 }, grade: 'A', origin: 'nd' };
    s.courses.push(c);
  }
  return s;
}

describe('the saved file’s name carries the day the check was made (U24)', () => {
  it('program and date, so copies saved on different days are told apart', () => {
    assert.equal(selfCheckFileName('phd', '2026-10-21'), 'cse-degree-audit-phd-2026-10-21.json');
    assert.equal(selfCheckFileName('mscse', '2027-01-05'), 'cse-degree-audit-mscse-2027-01-05.json');
  });
});

describe('what "Load a file" replaces — and so what gets an Undo (U23)', () => {
  it('an empty record holds nothing; a course or a milestone answer counts', () => {
    const s = emptyStudent();
    assert.equal(recordHoldsEntries(s), false, 'a fresh record');
    s.milestones.advisorName = '';
    assert.equal(recordHoldsEntries(s), false, 'a milestone box cleared again');
    s.milestones.advisorName = 'Prof. Example';
    assert.equal(recordHoldsEntries(s), true, 'a milestone answer');
    assert.equal(recordHoldsEntries(withCourses(1)), true, 'a course');
    const dated = emptyStudent();
    dated.milestones.candidacyPassed = '2026-04-01';
    assert.equal(recordHoldsEntries(dated), true, 'a milestone date');
  });
});

describe('the load toast (U24, U23)', () => {
  it('says when the file was saved — the day at Notre Dame — and how many courses it holds', () => {
    assert.equal(loadedRecordToast({ savedAt: '2026-10-03T15:00:00.000Z', student: {} }, withCourses(3), undefined), 'File loaded — saved October 3, 2026 (3 courses).');
    // 03:30 UTC on 4 October is still the evening of 3 October at Notre Dame (EDT, UTC−4).
    assert.equal(loadedRecordToast({ savedAt: '2026-10-04T03:30:00.000Z' }, withCourses(1), undefined), 'File loaded — saved October 3, 2026 (1 course).');
    assert.equal(loadedRecordToast({ savedAt: '2026-10-03T15:00:00.000Z' }, withCourses(0), undefined), 'File loaded — saved October 3, 2026 (0 courses).');
  });
  it('is the bare "File loaded." when the file carries no readable savedAt and nothing was replaced', () => {
    assert.equal(loadedRecordToast({ student: {} }, withCourses(2), undefined), 'File loaded.');
    assert.equal(loadedRecordToast({ savedAt: 'yesterday' }, withCourses(2), undefined), 'File loaded.');
    assert.equal(loadedRecordToast({ savedAt: 20261003 }, withCourses(2), undefined), 'File loaded.');
    assert.equal(loadedRecordToast(null, withCourses(2), undefined), 'File loaded.');
  });
  it('names what the file replaced — the courses that were on this device, or the record when it held answers only', () => {
    assert.equal(
      loadedRecordToast({ savedAt: '2026-10-03T15:00:00.000Z' }, withCourses(3), withCourses(8)),
      'File loaded — saved October 3, 2026 (3 courses). It replaced the 8 courses that were on this device.',
    );
    assert.equal(loadedRecordToast({}, withCourses(3), withCourses(8)), 'File loaded — it replaced the 8 courses that were on this device.');
    assert.equal(loadedRecordToast({}, withCourses(3), withCourses(1)), 'File loaded — it replaced the 1 course that was on this device.');
    const answered = emptyStudent();
    answered.milestones.advisorName = 'Prof. Example';
    assert.equal(loadedRecordToast({}, withCourses(3), answered), 'File loaded — it replaced the record that was on this device.');
  });
});
