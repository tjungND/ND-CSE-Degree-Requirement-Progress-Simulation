// Repro: precedence (#4, "posted credit first") orders singles among singles
// and multis among multis, but every single runs before any multi. Posted
// credit for a course outside CSE draws two caps ('transfer' + 'noncse'), so
// unposted single-cap CSE transfers take the whole 24 first and the credit the
// Graduate School already posted reads "over the transfer-credit cap".
import assert from 'node:assert/strict';
import { it } from 'node:test';
import { audit } from '../src/engine/audit.ts';
import { buildRules } from './helpers.ts';
import { phdStudent, transferCourse } from './helpers/student.ts';

it('posted non-CSE credit keeps its share of the 24 before unposted CSE transfers', () => {
  const ids = ['CS 50100', 'CS 50200', 'CS 50300', 'CS 50400', 'CS 50500', 'CS 50600', 'CS 50700', 'CS 50800'];
  const rules = buildRules({
    external: ids.map((id) => ({ university: 'PURDUE UNIVERSITY', course_id: id, course_title: 'Some Course', transferable_PhD: 'yes', transferable_MSCSE: 'yes' })),
  });
  const ms = { degreeLevel: 'masters' as const, term: { season: 'fall' as const, year: 2024 } };
  const student = phdStudent({
    priorMs: 'completed',
    bachelorsAwarded: { season: 'spring', year: 2020 },
    courses: [
      ...ids.map((id) => transferCourse(id, 'Some Course', ms)),
      transferCourse('MA 51100', 'Linear Algebra', { ...ms, term: { season: 'spring', year: 2024 }, ndPosted: { term: { season: 'spring', year: 2027 }, credits: 3, level: 'graduate' } }),
    ],
  });
  const report = audit(student, rules, '2027-06-01');
  const posted = report.courseLines.find((l) => l.courseId === 'MA 51100')!;
  assert.doesNotMatch(posted.text, /over the transfer-credit cap/, 'credit already posted on the Notre Dame record is refused by the cap');
});
