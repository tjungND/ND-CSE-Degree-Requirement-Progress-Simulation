// OCR cell evidence (DGS 2026-10-11, item 13): on a scan, a row the engine
// read with confidence is flagged all the same when the document says it may
// be wrong — a credit value no other row has, a grade cell holding a number or
// a stray sign, a term whose rows do not add up to its totals line. A text
// layer is never flagged.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseExternalTranscript } from '../src/transcript/external.ts';

const doc = (rows: string[], extra: string[] = []): string[] => [
  'Example State University',
  'Office of the Registrar',
  'Official Transcript',
  'Fall 2023',
  ...rows,
  ...extra,
  'This document lists the courses taken by the student at the university and is issued by the registrar.',
];
const sure = (lines: string[]) => lines.map(() => 95); // every line read with confidence
const flags = (lines: string[], confident = true) =>
  parseExternalTranscript(lines, confident ? sure(lines) : undefined).courses.map((c) => [c.courseId, c.lowConfidence === true, c.evidence ?? null]);

describe('cell evidence on a scan', () => {
  it('a credit value no other row has (four rows or more)', () => {
    const lines = doc(['CS 50100   Advanced Algorithms   3.0   A', 'CS 50200   Operating Systems   3.0   A', 'CS 50300   Databases   3.0   B', 'CS 50400   Networks   8.0   A']);
    assert.deepEqual(flags(lines), [
      ['CS 50100', false, null],
      ['CS 50200', false, null],
      ['CS 50300', false, null],
      ['CS 50400', true, 'credits'],
    ]);
    // Three rows: too few to call a value odd.
    assert.ok(flags(lines.filter((l) => !/CS 50300/.test(l))).every(([, f]) => f === false));
  });

  it('a grade cell holding a number or a stray sign — never a mark of letters a school prints', () => {
    const row = (mark: string) => {
      const lines = doc(['CS 50100   Advanced Algorithms   3.0   A', `CS 50200   Operating Systems   3.0   ${mark}`, 'CS 50300   Databases   3.0   B', 'CS 50400   Networks   3.0   A']);
      const c = parseExternalTranscript(lines, sure(lines)).courses.find((x) => x.courseId === 'CS 50200')!;
      return [c.lowConfidence === true, c.evidence ?? null];
    };
    assert.deepEqual(row('3.0'), [true, 'mark']); // the credits read into the grade column
    // McGill's deferred / no grade reported / withdrawn marks, Banner's "no
    // grade": real marks, read right — flagging them cost 9–11 right rows on
    // the bench for 1–2 wrong ones.
    for (const mark of ['K', 'NR', 'W', 'NG']) assert.deepEqual(row(mark), [false, null], mark);
  });

  it('a term whose rows do not add up to its own totals line', () => {
    const lines = doc(['CS 50100   Advanced Algorithms   3.00 A 12.00', 'CS 50200   Operating Systems   3.00 A 12.00', 'CS 50300   Databases   3.00 A 12.00'], ['Ehrs:   12.00 GPA-Hrs: 12.00   QPts:   48.00 GPA:   4.00']);
    assert.deepEqual(flags(lines).map(([, f, e]) => [f, e]), [[true, 'totals'], [true, 'totals'], [true, 'totals']]);
  });

  it('a text layer is never flagged on evidence', () => {
    const lines = doc(['CS 50100   Advanced Algorithms   3.0   A', 'CS 50200   Operating Systems   3.0   A', 'CS 50300   Databases   3.0   B', 'CS 50400   Networks   8.0   A']);
    assert.ok(flags(lines, false).every(([, f, e]) => f === false && e === null));
  });
});
