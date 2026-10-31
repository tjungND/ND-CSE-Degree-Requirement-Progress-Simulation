// Academic Code §3.8's maximum (15 graduate credits a fall or spring semester,
// 10 a summer session) when a semester is over it and no credit overload is
// ticked: "Keep the courses that complete requirements" (DGS 2026-10-31,
// question 12 of the credit-transfer review). The allocator's own order puts
// regular courses before research and other total-only credit; a course whose
// requirements are already complete now yields the room to one a requirement
// still needs — never at the cost of another requirement (keepWhatCompletes).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { audit } from '../src/engine/audit.ts';
import type { CourseEntry, Student, Term } from '../src/engine/types.ts';
import { buildRules } from './helpers.ts';
import { phdStudent } from './helpers/student.ts';

const t = (season: Term['season'], year: number): Term => ({ season, year });
const nd = (id: string, term: Term, extra: Partial<CourseEntry> = {}): CourseEntry => ({ courseId: id, credits: 3, term, grade: 'A', origin: 'nd', ...extra });
const YIELDED = /— the room went first to the courses your requirements still need/;
// Twelve regular credits and both seminars in the first year, three research
// credits in the spring; then Fall 2026: five regular courses (15) and three
// research credits (3) — 18, over the maximum, with no overload ticked.
const firstYear = [
  nd('CSE 60770', t('fall', 2025)), nd('CSE 60762', t('fall', 2025)), nd('CSE 63801', t('fall', 2025), { credits: 1, grade: 'S' }),
  nd('CSE 60876', t('spring', 2026)), nd('CSE 60535', t('spring', 2026)), nd('CSE 63802', t('spring', 2026), { credits: 1, grade: 'S' }), nd('CSE 98900', t('spring', 2026), { grade: 'S' }),
];
const fall2026 = [nd('CSE 60111', t('fall', 2026)), nd('CSE 60641', t('fall', 2026)), nd('CSE 60321', t('fall', 2026)), nd('CSE 60868', t('fall', 2026)), nd('CSE 60427', t('fall', 2026)), nd('CSE 98900', t('fall', 2026), { grade: 'S' })];
const student = (extra: Partial<Student> = {}): Student =>
  phdStudent({ entryTerm: t('fall', 2025), bachelorsAwarded: t('spring', 2025), gpa: 3.8, milestones: { candidacyPassed: '2027-04-15' }, attestations: { wantsMsAlongTheWay: true }, courses: [...firstYear, ...fall2026], ...extra });
const run = (s: Student, rules = buildRules()) => {
  const r = audit(s, rules, '2027-06-01');
  return { r, row: (id: string) => r.requirements.find((x) => x.id === id)!, lines: (id: string, term = t('fall', 2026)) => r.courseLines.filter((l) => l.courseId === id && l.term?.season === term.season && l.term.year === term.year) };
};

describe('the research the MSCSE along the way still needs keeps the room', () => {
  it('the regular credits are complete without the last course: it yields, and the award is complete', () => {
    const { r, row, lines } = run(student());
    assert.match(row('phd.msAlongTheWay').detail, /Earned at Notre Dame: 24 regular-course credits and 6 research credits/);
    assert.equal(row('phd.credits.regular').status, 'met');
    assert.equal(lines('CSE 98900')[0]!.mark, 'counts');
    // The last of the semester in the record's order (term, then course number) yields.
    assert.match(lines('CSE 60868')[0]!.text, /^not counted — over the 15-credit semester maximum for Fall 2026 \(Academic Code §3\.8\) — the room went first to the courses your requirements still need/);
    assert.equal(r.courseLines.filter((l) => YIELDED.test(l.text)).length, 1);
  });
  it('a student who does not want the MSCSE along the way: the research adds to the 60 alone, and the regular course keeps the room, as before', () => {
    const { r, lines } = run(student({ attestations: {} }));
    assert.match(lines('CSE 98900')[0]!.text, /^not counted — over the 15-credit semester maximum for Fall 2026 \(Academic Code §3\.8\)$/);
    assert.ok(!r.courseLines.some((l) => YIELDED.test(l.text)));
  });
  it('the overload ticked: no maximum, nothing cut', () => {
    const { r } = run(student({ creditOverloadTerms: [t('fall', 2026)] }));
    assert.ok(!r.courseLines.some((l) => /semester maximum/.test(l.text)));
  });
  it('the regular credits still short: no requirement is traded for another — the research waits, as before', () => {
    // Without the spring's two regular courses the Fall 2026 ones are all needed for the 24.
    const s = student({ courses: [...firstYear.filter((c) => c.courseId !== 'CSE 60876' && c.courseId !== 'CSE 60535'), ...fall2026] });
    const { r, lines } = run(s);
    assert.match(lines('CSE 98900')[0]!.text, /^not counted — over the 15-credit semester maximum for Fall 2026/);
    assert.ok(!r.courseLines.some((l) => YIELDED.test(l.text)));
  });
});

describe('the research seminars keep the room when the regular credits allow it', () => {
  // Summer 2026: four regular courses and CSE 63801 (13 of 10); Fall 2026:
  // five regular courses and CSE 63802 (16 of 15). The regular credits reach
  // 25 with no seminar counted — one to spare.
  const su = t('summer', 2026);
  const fa = t('fall', 2026);
  const courses = [nd('CSE 60111', su), nd('CSE 60641', su), nd('CSE 60321', su), nd('CSE 63801', su, { credits: 1, grade: 'S' }), nd('CSE 60535', su), nd('CSE 60770', fa), nd('CSE 60762', fa), nd('CSE 60876', fa), nd('CSE 60868', fa), nd('CSE 60427', fa), nd('CSE 63802', fa, { credits: 1, grade: 'S' })];
  it('one seminar keeps its room — the spare credit — and the other stays refused, which would cost the 24', () => {
    const { r, row } = run(phdStudent({ entryTerm: t('fall', 2025), bachelorsAwarded: t('spring', 2025), gpa: 3.8, courses }));
    const detail = row('phd.seminar').detail;
    assert.equal([/CSE 63801: done/, /CSE 63802: done/].filter((re) => re.test(detail)).length, 1, detail);
    assert.match(detail, /was taken but not counted/);
    assert.equal(row('phd.credits.regular').status, 'met');
    assert.equal(r.courseLines.filter((l) => YIELDED.test(l.text)).length, 1);
  });
});

describe('the MSCSE: the project keeps the room the 24 does not need', () => {
  it('a thesis project beside a fifth regular course', () => {
    const rules = buildRules({ courses: [{ course_id: 'CSE 68902', set: { counts_toward_mscse: 'yes' } }] });
    const s = phdStudent({
      program: 'mscse',
      entryTerm: t('fall', 2025),
      bachelorsAwarded: t('spring', 2025),
      gpa: 3.8,
      // 27 regular credits, three to spare; three project credits in the spring.
      courses: [nd('CSE 60770', t('fall', 2025)), nd('CSE 60762', t('fall', 2025)), nd('CSE 60876', t('fall', 2025)), nd('CSE 60535', t('spring', 2026)), nd('CSE 68902', t('spring', 2026)), ...fall2026.filter((c) => c.courseId !== 'CSE 98900'), nd('CSE 68902', t('fall', 2026))],
    });
    const { r, lines } = run(s, rules);
    assert.equal(lines('CSE 68902')[0]!.mark, 'counts', lines('CSE 68902')[0]!.text);
    assert.match(lines('CSE 60868')[0]!.text, YIELDED);
    assert.equal(r.courseLines.filter((l) => YIELDED.test(l.text)).length, 1);
  });
});
