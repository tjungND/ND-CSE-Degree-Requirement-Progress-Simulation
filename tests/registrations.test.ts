// Credit-transfer review 2026-10-28: two registrations of one course are two
// rows everywhere — the Grad Admin request (#20, #55) and the course lines'
// "Counts toward" (#21) no longer match them by course number.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { audit } from '../src/engine/audit.ts';
import { gradAdminRequest } from '../src/ui/grad-admin-request.ts';
import { buildRules } from './helpers.ts';
import { ndCourse, phdStudent, transferCourse } from './helpers/student.ts';

const fall = (year: number) => ({ season: 'fall' as const, year });
const spring = (year: number) => ({ season: 'spring' as const, year });

describe('one row per registration', () => {
  it('#20: two topic sections of one course, one term — each submitted at its own admitted credits', () => {
    const rules = buildRules({ external: [{ university: 'PURDUE UNIVERSITY', course_id: 'CS 59000', course_title: 'Special Topics', transferable_PhD: 'yes', transferable_MSCSE: 'yes', is_cse: 'yes', credit_system: 'semester' }] });
    const s = phdStudent({
      entryTerm: fall(2026), priorMs: 'unfinished', bachelorsAwarded: spring(2023),
      courses: [
        transferCourse('CS 59000', 'Special Topics: Networks', { credits: 4, term: fall(2024), degreeLevel: 'masters' }),
        transferCourse('CS 59000', 'Special Topics: Crypto', { credits: 4, term: fall(2024), degreeLevel: 'masters' }),
      ],
    });
    const report = audit(s, rules, '2027-01-15');
    const items = gradAdminRequest(report, s, rules, { todayIso: '2027-01-15', entryTerm: 'Fall 2026', priorStudy: 'x' }).items;
    assert.deepEqual(items.transfers.map((t) => [t.title, t.cappedCredits ?? t.credits]), [['Special Topics: Networks', 4], ['Special Topics: Crypto', 2]]);
  });

  it('#55: the request’s table prints the registration that counts, not a C- beside it', () => {
    const s = phdStudent({ program: 'mscse', msOption: 'project', entryTerm: fall(2026), courses: [ndCourse('CSE 60641', { term: fall(2026) }), ndCourse('CSE 68902', { term: fall(2026), grade: 'C-' }), ndCourse('CSE 68902', { term: spring(2027) })] });
    const rules = buildRules();
    const { text } = gradAdminRequest(audit(s, rules, '2027-06-01'), s, rules, { todayIso: '2027-06-01', entryTerm: 'Fall 2026', priorStudy: 'x' });
    assert.match(text, /CSE 68902\t[^\n]*\tA\tSpring 2027/);
    assert.doesNotMatch(text, /CSE 68902\t[^\n]*\tC-\t/);
  });

  it('#21: an in-progress registration will count; it does not count now because a graded one does', () => {
    const s = phdStudent({ entryTerm: fall(2025), courses: [ndCourse('CSE 98900', { term: spring(2026), credits: 9, grade: 'S' }), ndCourse('CSE 98900', { term: fall(2026), credits: 9, grade: 'IP' })] });
    const lines = audit(s, buildRules(), '2026-10-28').courseLines.filter((l) => l.courseId === 'CSE 98900');
    assert.deepEqual(lines.map((l) => [l.term.season, l.counts.map((c) => c.when)]), [['spring', ['now']], ['fall', ['later']]]);
  });
});
