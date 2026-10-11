// Each import checks itself against the transcript's own totals (DGS
// 2026-10-11, item 11). The rows read must add up to the earned hours and
// the GPA the transcript prints, per term and for the whole record; when they
// do not, the preview names the term and both figures. The corpus guard:
// on every document the readers get exactly right, the check says nothing.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { parseExternalTranscript } from '../src/transcript/external.ts';
import { parseTranscript, totalsMismatchesOf } from '../src/transcript/parse.ts';
import { checkTotals, doubtedTerms, type CheckedRow } from '../src/transcript/totals-check.ts';
import { scoreDocument } from '../scripts/dev/score.mts';

// The Banner lines tests/banner-transcript.test.ts pins, read from its source
// (importing a test file would run its suite again — tests/layout.test.ts
// reads it the same way).
const BANNER_LINES = JSON.parse(
  /export const BANNER_LINES = (\[[\s\S]*?\n\]);/.exec(readFileSync(new URL('./banner-transcript.test.ts', import.meta.url), 'utf8'))![1]!.replace(/,\s*\]$/, ']').replace(/'/g, '"'),
) as string[];

const fall23 = { season: 'fall' as const, year: 2023 };
const row = (credits: number, grade: string, term = fall23): CheckedRow => ({ term, credits, grade });

describe('the check', () => {
  it('a missing row: the term, both figures, and its rows put in doubt', () => {
    const m = checkTotals([row(3, 'A'), row(3, 'B+')], [{ scope: 'term', term: fall23, earned: 9, gpaHours: 9, gpa: 3.56 }]);
    assert.deepEqual(m.map((x) => x.message), [
      'Fall 2023 prints 9.0 earned hours; the rows read add to 6.0 — a row may be missing or misread.',
      'Fall 2023 prints a 3.56 GPA; the grades read give 3.67 — a grade may be misread.',
    ]);
    assert.deepEqual(doubtedTerms(m), [fall23, fall23]);
  });

  it('a misread grade: the GPA alone', () => {
    const m = checkTotals([row(3, 'A'), row(3, 'A')], [{ scope: 'term', term: fall23, earned: 6, gpaHours: 6, gpa: 3.5 }]);
    assert.deepEqual(m.map((x) => x.kind), ['gpa']);
  });

  it('rows that add up say nothing — on either common scale (A− as 3.667 or 3.7)', () => {
    assert.deepEqual(checkTotals([row(3, 'A'), row(3, 'A-')], [{ scope: 'term', term: fall23, earned: 6, gpaHours: 6, gpa: 3.83 }]), []);
    assert.deepEqual(checkTotals([row(3, 'A'), row(3, 'A-')], [{ scope: 'term', term: fall23, earned: 6, gpaHours: 6, gpa: 3.85 }]), []);
    // An F earns nothing but counts in the GPA; an S earns but does not.
    assert.deepEqual(checkTotals([row(3, 'A'), row(3, 'F'), row(1, 'S')], [{ scope: 'term', term: fall23, earned: 4, gpaHours: 6, gpa: 2 }]), []);
  });

  it('a term still in progress, or a row whose grade is unread, is not judged', () => {
    assert.deepEqual(checkTotals([row(3, 'A'), row(3, 'IP')], [{ scope: 'term', term: fall23, earned: 3, gpaHours: 3, gpa: 4 }]), []);
    assert.deepEqual(checkTotals([row(3, 'A'), row(3, '')], [{ scope: 'term', term: fall23, earned: 9, gpaHours: 9, gpa: 4 }]), []);
  });

  it('a line that names its rows checks those alone, plus rows the student typed for that term', () => {
    const rows = [row(3, 'A'), row(3, 'A'), { ...row(3, 'A'), typed: true }];
    // Rows 0 and 1 belong to another record's line; this one names row 1 only.
    assert.deepEqual(checkTotals(rows, [{ scope: 'term', term: fall23, earned: 6, gpaHours: 6, gpa: 4, rows: [1] }]), []);
    assert.equal(checkTotals(rows, [{ scope: 'term', term: fall23, earned: 3, gpaHours: 3, gpa: 4, rows: [1] }]).length, 1);
  });
});

describe('the readers record their totals', () => {
  it('the Banner fixture: every term and the institution total add up; a dropped row names its term', () => {
    const p = parseExternalTranscript(BANNER_LINES);
    assert.ok((p.printedTotals ?? []).length >= 5, JSON.stringify(p.printedTotals));
    const aligned = p.courses.map((c) => (c.season && c.year && c.credits !== undefined ? { term: { season: c.season, year: c.year }, credits: c.credits, grade: c.grade ?? '' } : undefined));
    assert.deepEqual(checkTotals(aligned, p.printedTotals!), []);
    // The reader missing CS 550 (Spring 2020, B+): its term no longer adds up.
    const i = p.courses.findIndex((c) => c.courseId === 'CS 550');
    const missed = p.printedTotals!.map((t) => (t.rows ? { ...t, rows: t.rows.filter((k) => k !== i) } : t));
    const m = checkTotals(aligned, missed);
    assert.ok(m.some((x) => x.message === 'Spring 2020 prints 6.0 earned hours; the rows read add to 3.0 — a row may be missing or misread.'), JSON.stringify(m.map((x) => x.message)));
  });

  it('a Notre Dame transcript missing a row says so', () => {
    const lines = JSON.parse(readFileSync(new URL('./fixtures/nd-transcripts/nd-insidend-transcript.json', import.meta.url), 'utf8')) as string[];
    assert.deepEqual(totalsMismatchesOf(parseTranscript(lines)), []);
    const without = lines.filter((l) => !/^CSE 60111\b/.test(l));
    const m = totalsMismatchesOf(parseTranscript(without));
    assert.ok(m.some((x) => /^Fall 2025 prints 3\.0 earned hours; the rows read add to 0\.0/.test(x.message)), JSON.stringify(m.map((x) => x.message)));
    assert.ok(m.some((x) => /graduate totals print 6\.0 earned hours; the rows read add to 3\.0/.test(x.message)), JSON.stringify(m.map((x) => x.message)));
  });
});

describe('the corpus guard: no alarm on a document read exactly', () => {
  for (const corpus of ['public-transcripts', 'ms-transcripts']) {
    it(corpus, () => {
      const dir = new URL(`./fixtures/${corpus}/`, import.meta.url);
      const expected = JSON.parse(readFileSync(new URL('expected.json', dir), 'utf8'));
      const alarms: string[] = [];
      let checked = 0;
      for (const f of readdirSync(dir).filter((n) => n.endsWith('.json') && n !== 'expected.json' && n !== 'sources.json')) {
        const name = f.replace(/\.json$/, '');
        const p = parseExternalTranscript(JSON.parse(readFileSync(new URL(f, dir), 'utf8')));
        if (!p.printedTotals || !scoreDocument(p, expected[name]).exact) continue;
        checked++;
        const aligned = p.courses.map((c) => (c.season && c.year && c.credits !== undefined ? { term: { season: c.season, year: c.year }, credits: c.credits, grade: c.grade ?? '', level: c.level } : undefined));
        for (const m of checkTotals(aligned, p.printedTotals)) alarms.push(`${name}: ${m.message}`);
      }
      assert.deepEqual(alarms, [], `${alarms.length} false alarm(s) over ${checked} documents`);
    });
  }
});
