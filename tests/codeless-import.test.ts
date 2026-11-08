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
