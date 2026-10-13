// The "Integrated B.S. + M.S." note promises a 60000-level undergraduate
// course counts toward the MSCSE alone only to the students the course lines
// count it for — an Integrated (4+1) student admitted before the bachelor's
// was awarded; a 4+1 admitted after it counts only the shared six; a student
// not in the 4+1 counts none (policy review round 4, P4-transfer-7; DGS
// 2026-10-12: "apply the suggested handling").
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { audit } from '../src/engine/audit.ts';
import type { Student } from '../src/engine/types.ts';
import { buildRules } from './helpers.ts';
import { ndCourse, phdStudent } from './helpers/student.ts';

const rules = buildRules();
const fall = (year: number) => ({ season: 'fall' as const, year });
const spring = (year: number) => ({ season: 'spring' as const, year });
const student = (over: Partial<Student>): Student =>
  phdStudent({
    program: 'mscse',
    msOption: 'project',
    entryTerm: fall(2026),
    bachelorsAwarded: spring(2026),
    // Filed as the Notre Dame import files an undergraduate row.
    courses: [{ ...ndCourse('CSE 60641', { term: fall(2025) }), origin: 'transfer', institution: 'University of Notre Dame', degreeLevel: 'bachelors', registeredLevel: 'undergraduate' }, ndCourse('CSE 60111', { term: fall(2026) })],
    ...over,
  });
const run = (s: Student) => {
  const r = audit(s, rules, '2026-10-12');
  return { note: r.tracks?.find((t) => t.id === 'integrated')?.text ?? '', line: r.courseLines.find((l) => l.courseId === 'CSE 60641')?.text ?? '' };
};

describe('the Integrated B.S. + M.S. note follows the record (P4-transfer-7)', () => {
  it('not in the 4+1: no promise, and the line refuses the course', () => {
    const { note, line } = run(student({ integratedBsMs: false }));
    assert.doesNotMatch(note, /whenever you took it/);
    assert.match(note, /counts toward the MSCSE only if you were in the Integrated B\.S\. \+ M\.S\. \(4\+1\) program and admitted before your bachelor’s degree was awarded/);
    assert.match(line, /^not counted — a 60000-level course taken as an undergraduate earns MSCSE credit only for a student who was in the Integrated/);
  });
  it('a 4+1 admitted after the bachelor’s: only the shared six', () => {
    const { note } = run(student({ integratedBsMs: true, integratedAdmitted: fall(2026) }));
    assert.doesNotMatch(note, /whenever you took it/);
    assert.match(note, /You were admitted to the Integrated program for Fall 2026, after your bachelor’s degree \(Spring 2026\), so a 60000-level course you took as an undergraduate counts only among the shared 6 \(4\+1 guidance\)/);
  });
  it('a 4+1 admitted before the bachelor’s: the promise stands', () => {
    const { note } = run(student({ integratedBsMs: true, integratedAdmitted: fall(2025) }));
    assert.match(note, /A 60000-level course your bachelor’s degree did not use counts toward the MSCSE alone, whenever you took it/);
  });
});
