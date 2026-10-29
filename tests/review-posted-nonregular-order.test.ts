// Repro: posted credit "takes its share of §5.2's cap before courses still to
// be requested" (precedence, #4) — but only inside its group. A posted thesis
// (postedNonRegular, pool total_only) is in the total-only group, which runs
// after every regular transfer (#12), so unposted regular transfers take the
// 24 and the credit the Graduate School already posted reads "over the
// transfer-credit cap" while the request submits the full 24.
import assert from 'node:assert/strict';
import { it } from 'node:test';
import { audit } from '../src/engine/audit.ts';
import { buildRules } from './helpers.ts';
import { phdStudent, transferCourse } from './helpers/student.ts';

it('posted thesis credit keeps its share of the 24 before unposted transfers', () => {
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
      // Already on the Notre Dame record as accepted graduate transfer credit.
      transferCourse('CS 69800', 'Master’s Thesis Research', { ...ms, credits: 6, ndPosted: { term: { season: 'spring', year: 2027 }, credits: 6, level: 'graduate' } }),
    ],
  });
  const report = audit(student, rules, '2027-06-01');
  const posted = report.courseLines.find((l) => l.courseId === 'CS 69800')!;
  const row = report.requirements.find((r) => r.id === 'phd.transfer')!;
  assert.doesNotMatch(posted.text, /over the transfer-credit cap/, 'credit already posted on the Notre Dame record is refused by the cap');
});
