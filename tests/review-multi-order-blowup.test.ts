// Repro: bestMultiOrder's new ceiling `total` is the sum of ALL remaining
// credits, which an untransferred course (no F1 spill) can never reach, so a
// state whose non-CSE nine is spent is no longer pruned: the search visits
// every subset. 20 non-CSE prior-master's courses: ~6.5 s (was ~30 ms before
// 2b95d0f; 24 courses took 27 ms there).
import assert from 'node:assert/strict';
import { it } from 'node:test';
import { audit } from '../src/engine/audit.ts';
import { buildRules } from './helpers.ts';

const SUBJECTS = ['INFO', 'TELE', 'MENG', 'BIOS', 'ECON', 'PSYC', 'HIST', 'MATH', 'STAT', 'PHIL'];
const ids = (n: number) => Array.from({ length: n }, (_, i) => `${SUBJECTS[i % SUBJECTS.length]} 5${String(1000 + i).slice(-4)}`);

it('20 two-cap prior-program courses audit inside 2 s', () => {
  const n = 20;
  const rules = buildRules({
    parameters: { cse_subject_codes: 'CS; CSCI; COMPSCI; CSYE' },
    external: ids(n).map((id) => ({ university: 'PURDUE UNIVERSITY', course_id: id, course_title: 'Some Course', transferable_PhD: 'yes', transferable_MSCSE: 'yes' })),
  });
  const student = {
    schemaVersion: 1, program: 'phd', entryTerm: { season: 'fall', year: 2026 }, bachelorsAwarded: { season: 'spring', year: 2020 },
    priorMs: 'completed', gpa: 3.7, milestones: {}, attestations: { transferApproved: true },
    courses: ids(n).map((courseId) => ({ courseId, credits: 3, term: { season: 'fall', year: 2024 }, grade: 'A', origin: 'transfer', institution: 'Purdue University', degreeLevel: 'masters' })),
  };
  const t0 = performance.now();
  audit(student as never, rules, '2027-06-01');
  const ms = performance.now() - t0;
  assert.ok(ms < 2000, `audit took ${ms.toFixed(0)} ms`);
});
