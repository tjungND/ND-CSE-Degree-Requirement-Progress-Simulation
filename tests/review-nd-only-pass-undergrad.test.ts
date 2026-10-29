// Repro: the Notre Dame-only second pass of allocate() drops Notre Dame
// coursework taken as an undergraduate (origin 'transfer', notTransferCredit)
// from the competition for the caps it shares with the Ph.D.'s own courses
// (the 40000-level six here). No transfer credit is on this record at all, yet
// a Ph.D. course the six refused counts toward §4.2's nine at Notre Dame and
// its line says it "still counts … regardless of any credits transferred".
import assert from 'node:assert/strict';
import { it } from 'node:test';
import { audit } from '../src/engine/audit.ts';
import { buildRules } from './helpers.ts';
import { ndCourse, phdStudent } from './helpers/student.ts';

it('a Ph.D. 40000-level course the six refused does not count toward the nine at Notre Dame', () => {
  const ugNd = { origin: 'transfer' as const, institution: 'University of Notre Dame', degreeLevel: 'bachelors' as const, term: { season: 'fall' as const, year: 2025 }, countedToward: 'neither' as const };
  const student = phdStudent({
    background: { bachelors: 'nd-cse' } as never,
    bachelorsAwarded: { season: 'spring', year: 2026 },
    courses: [
      // Two 40000-level courses from the bachelor's years, not used for it: they fill §4.2's six.
      ndCourse('CSE 40113', ugNd),
      ndCourse('CSE 40567', { ...ugNd, dgsApproved: true }),
      // The Ph.D.'s own 40000-level course, in progress this fall.
      ndCourse('CSE 40243', { grade: 'IP', dgsApproved: true }),
    ],
  });
  const report = audit(student, buildRules(), '2026-10-29');
  const line = report.courseLines.find((l) => l.courseId === 'CSE 40243')!;
  const nd = report.requirements.find((r) => r.id === 'phd.credits.nd')!;
  const regular = report.requirements.find((r) => r.id === 'phd.credits.regular')!;
  // The course is not counted toward the 24 (the six is spent) …
  assert.match(line.text, /not counted|over the/);
  // … so it must not count toward the nine either — nothing was transferred.
  assert.equal(nd.contributions?.some((c) => c.courseId === 'CSE 40243') ?? false, false, 'CSE 40243 counts toward the nine at Notre Dame although the six refused it');
  assert.doesNotMatch(line.text, /still counts toward the regular-course credits taken at Notre Dame/);
});
