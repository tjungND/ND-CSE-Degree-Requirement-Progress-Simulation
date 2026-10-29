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

// Review of the fixes, 2026-10-29: Notre Dame courses outside CSE in a semester
// over its maximum, beside many non-CSE transfers — 6.5 s and 473 MB at 16
// transfers, out of memory at 2.9 GB in the heaviest shape, before the search
// dropped courses that take nothing and bounded each shared cap.
it('an over-maximum semester of Notre Dame non-CSE courses beside 20 non-CSE transfers audits inside 2 s', () => {
  const nonCse = ['MATH 60850', 'EE 60770', 'PHYS 60762', 'ACMS 60535', 'PSY 60427'];
  const from = ['CSE 60876', 'CSE 60770', 'CSE 60762', 'CSE 60535', 'CSE 60427'];
  const stat = Array.from({ length: 20 }, (_, i) => `STAT ${701 + i}`);
  const rules = buildRules({
    courses: nonCse.map((to, i) => ({ course_id: from[i]!, set: { course_id: to, title: to } })),
    external: stat.map((id) => ({ university: 'PURDUE UNIVERSITY', course_id: id, course_title: 'Stat', transferable_PhD: 'yes', transferable_MSCSE: 'yes', is_cse: 'no', credit_system: 'semester' })),
  });
  const fall2025 = { season: 'fall', year: 2025 };
  const student = {
    schemaVersion: 1, program: 'phd', entryTerm: fall2025, priorMs: 'completed', bachelorsAwarded: { season: 'spring', year: 2021 },
    background: { bachelors: 'elsewhere', graduate: 'elsewhere', samePlace: false, finished: true }, milestones: {}, attestations: {},
    courses: [
      ...stat.map((courseId, i) => ({ courseId, title: 'Stat', credits: 3, term: i % 2 === 0 ? { season: 'fall', year: 2022 } : { season: 'spring', year: 2023 }, grade: 'A', origin: 'transfer', institution: 'Purdue University', degreeLevel: 'masters' })),
      ...nonCse.map((courseId) => ({ courseId, credits: 3, term: fall2025, grade: 'A', origin: 'nd' })),
      { courseId: 'CSE 60111', credits: 3, term: fall2025, grade: 'A', origin: 'nd' },
      { courseId: 'CSE 60641', credits: 3, term: fall2025, grade: 'A', origin: 'nd' },
      { courseId: 'CSE 98900', credits: 6, term: fall2025, grade: 'S', origin: 'nd' },
    ],
  };
  const t0 = performance.now();
  const report = audit(student as never, rules, '2026-10-28');
  const ms = performance.now() - t0;
  assert.ok(ms < 2000, `audit took ${ms.toFixed(0)} ms`);
  assert.match(report.requirements.find((r) => r.id === 'phd.credits.regular')!.detail, /^15 of 24 credits complete/); // the nine and two CSE courses
});

// A final check of the fixes, 2026-10-29: twenty one-credit non-CSE transfers
// beside four Notre Dame non-CSE courses, two semesters over their maximum —
// five seconds, with the search treating twenty interchangeable courses as
// twenty different ones; identical courses now share one search state.
it('16 one-credit and 4 three-credit non-CSE transfers beside overloaded semesters audit inside 2 s', () => {
  const transfers = [...Array.from({ length: 16 }, (_, i) => ({ id: `STAT ${59000 + i}`, credits: 1 })), ...Array.from({ length: 4 }, (_, i) => ({ id: `STAT ${51100 + i}`, credits: 3 }))];
  const nd = ['MATH 60850', 'EE 60770', 'PHYS 60762', 'ACMS 60535'];
  const from = ['CSE 60876', 'CSE 60770', 'CSE 60762', 'CSE 60535'];
  const rules = buildRules({
    courses: nd.map((to, i) => ({ course_id: from[i]!, set: { course_id: to, title: to } })),
    external: transfers.map((t) => ({ university: 'PURDUE UNIVERSITY', course_id: t.id, course_title: 'Stat', transferable_PhD: 'yes', transferable_MSCSE: 'yes', is_cse: 'no', credit_system: 'semester' })),
  });
  const fall2025 = { season: 'fall', year: 2025 };
  const spring2026 = { season: 'spring', year: 2026 };
  const student = {
    schemaVersion: 1, program: 'phd', entryTerm: fall2025, priorMs: 'completed', bachelorsAwarded: { season: 'spring', year: 2021 },
    background: { bachelors: 'elsewhere', graduate: 'elsewhere', samePlace: false, finished: true }, milestones: {}, attestations: {},
    courses: [
      ...transfers.map((t, i) => ({ courseId: t.id, title: 'Stat', credits: t.credits, term: i % 2 === 0 ? { season: 'fall', year: 2022 } : { season: 'spring', year: 2023 }, grade: 'A', origin: 'transfer', institution: 'Purdue University', degreeLevel: 'masters' })),
      ...nd.map((courseId, i) => ({ courseId, credits: 3, term: i % 2 === 0 ? fall2025 : spring2026, grade: 'A', origin: 'nd' })),
      { courseId: 'CSE 60111', credits: 3, term: fall2025, grade: 'A', origin: 'nd' },
      { courseId: 'CSE 60641', credits: 3, term: fall2025, grade: 'A', origin: 'nd' },
      { courseId: 'CSE 98900', credits: 6, term: fall2025, grade: 'S', origin: 'nd' },
      { courseId: 'CSE 60211', credits: 3, term: spring2026, grade: 'A', origin: 'nd' },
      { courseId: 'CSE 60421', credits: 3, term: spring2026, grade: 'A', origin: 'nd' },
      { courseId: 'CSE 98900', credits: 6, term: spring2026, grade: 'S', origin: 'nd' },
    ],
  };
  const t0 = performance.now();
  audit(student as never, rules, '2026-10-28');
  const ms = performance.now() - t0;
  assert.ok(ms < 2000, `audit took ${ms.toFixed(0)} ms`);
});
