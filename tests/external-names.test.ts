// The university names the ExternalCourses tab lists must keep being read,
// unchanged, by the transcript reader (DGS 2026-10-07, the CLAUDE.md hard
// constraint): each name on the sheet is what this import read from an
// official transcript, so a future transcript from that school prints the
// same name and must read the same — "GEORGIA INSTITUTE OF TECHNOLOGY OFFICIAL
// DOCUMENT INFORMATION" included, header words and all. Before any change to
// guessUniversity / stripRecordWords / watermarkName / awardingInstitution /
// resolveCampus in src/transcript/external.ts, or to normalizeUniversity in
// src/data/external.ts, this test must still pass: every name in the fixture
// tab (tests/fixtures/rules/external.csv) and in the live sheet's snapshot
// (data/snapshot.json, the ExternalCourses tab) read from a transcript that
// prints it as its header comes back exactly as printed and finds the rows
// filed under it. The precondition for the transcript accuracy program's
// parser fixes (plan §2, F5; 2026-10-09).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { rulesFromCsvTexts, type CsvTexts } from '../src/data/assemble.ts';
import { findExternalRule } from '../src/data/external.ts';
import type { Rules } from '../src/data/types.ts';
import { parseExternalTranscript } from '../src/transcript/external.ts';
import { buildRules } from './helpers.ts';

/** A transcript body below the header line: enough text for the reader to
 * treat it as a transcript at all (the 200-character floor), course rows,
 * nothing that names another school. */
const BODY = [
  'Office of the Registrar',
  'Unofficial Transcript',
  'Student: SAMPLE STUDENT',
  '',
  'Fall 2023',
  'CS 50300   Operating Systems                 3.0   A',
  'CS 59000   Special Topics in Systems         3.0   A-',
  '',
  'Spring 2024',
  'CS 58000   Algorithm Design                  3.0   B+',
  '',
  'Cumulative GPA: 3.83',
  'Page 1 of 1   Generated 2024-06-01',
];

const snapshot = JSON.parse(readFileSync(new URL('../data/snapshot.json', import.meta.url), 'utf8')) as { syncedAt: string; csv: CsvTexts };
const SOURCES: [string, Rules][] = [
  ['tests/fixtures/rules/external.csv', buildRules()],
  ['data/snapshot.json (ExternalCourses)', rulesFromCsvTexts(snapshot.csv, { source: 'snapshot', syncedAt: snapshot.syncedAt })],
];

describe('every university name the ExternalCourses tab lists is read unchanged (DGS 2026-10-07)', () => {
  for (const [label, rules] of SOURCES) {
    const names = [...new Set(rules.external.map((r) => r.university))];
    it(`${label} lists at least one university`, () => {
      assert.ok(names.length >= 1, `${label}: no ExternalCourses rows parsed`);
    });
    for (const name of names) {
      it(`${label}: ${JSON.stringify(name)} reads as printed and finds its rows`, () => {
        const r = parseExternalTranscript([name, ...BODY]);
        assert.equal(r.university, name, 'the name must come back exactly as the sheet lists it');
        assert.equal(r.universityGuessed, undefined, 'read from the printed text, not recovered from an acronym');
        const row = rules.external.find((x) => x.university === name)!;
        assert.ok(findExternalRule(rules.external, r.university!, row.courseId, undefined), `the read name must find the ruling for ${row.courseId}`);
      });
    }
  }
});
