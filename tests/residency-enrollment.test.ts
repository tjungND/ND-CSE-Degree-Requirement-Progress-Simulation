// The DGS's rulings of 2026-10-03 on the policy review's residency and
// enrollment findings:
//   P1-residency-enrollment-c4 — "cap a semester's credits by following the
//     graduate school's academic code and the DGS handbook" (Academic Code
//     §3.8: 15 credits of graduate courses a semester, 10 in a summer session);
//   -c5 — three credits at the 60000 level or higher in every full-time
//     semester (Academic Code §4.1), routed to the DGS;
//   -c6 — registration and ND Roll Call in the semester of graduation
//     (Academic Code §3.7), once every requirement is met;
//   -7  — the Ph.D. residency row says the Graduate School's rule is
//     "normally" four full-time semesters (Academic Code §6.2.2).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { audit } from '../src/engine/audit.ts';
import { classify, overMaxTerms } from '../src/engine/allocate.ts';
import type { AuditReport, CourseEntry, RequirementResult, Student, Term } from '../src/engine/types.ts';
import { gradAdminRequest } from '../src/ui/grad-admin-request.ts';
import { GRADUATION_SEMESTER_STEP, nextSteps } from '../src/ui/next-steps.ts';
import { buildRules } from './helpers.ts';
import { ndCourse, phdStudent } from './helpers/student.ts';

const rules = buildRules();
const fall = (year: number): Term => ({ season: 'fall', year });
const spring = (year: number): Term => ({ season: 'spring', year });
const at = (term: Term, ids: string[], extra: Partial<CourseEntry> = {}): CourseEntry[] => ids.map((courseId) => ndCourse(courseId, { term, ...extra }));
const row = (r: AuditReport, id: string): RequirementResult => {
  const found = r.requirements.find((x) => x.id === id);
  assert.ok(found, `no row ${id}`);
  return found;
};
const lineOf = (r: AuditReport, courseId: string) => r.courseLines.find((l) => l.courseId === courseId)!;
const SIX_60K = ['CSE 60641', 'CSE 60111', 'CSE 60321', 'CSE 60427', 'CSE 60535', 'CSE 60762'];

describe('a semester’s credits are capped at Academic Code §3.8’s maximum (P1-residency-enrollment-c4)', () => {
  it('18 graduate credits in a fall: 15 count, the course entered last is over the maximum, and a warning names the semester', () => {
    const s = phdStudent({ courses: at(fall(2026), SIX_60K) });
    const r = audit(s, rules, '2027-01-15');
    assert.match(lineOf(r, 'CSE 60762').text, /over the 15-credit semester maximum for Fall 2026 \(Academic Code §3\.8\)/);
    assert.doesNotMatch(lineOf(r, 'CSE 60641').text, /maximum/);
    assert.match(row(r, 'phd.credits.regular').detail, /\b15 of 24\b/);
    const w = r.warnings.find((x) => x.startsWith('Fall 2026: 18 credits of graduate courses'));
    assert.ok(w, r.warnings.join('\n'));
    assert.match(w, /at most 15 in a semester \(Academic Code §3\.8; DGS Handbook §3\.9\), so 3 credits are not counted/);
    assert.match(w, /duplicate row or a wrong credit value; if a credit overload was approved for you, tick it under Approvals you already have/);
  });

  it('a credit overload the student marks as approved lifts the cap for that semester only', () => {
    const s = phdStudent({ courses: at(fall(2026), SIX_60K), creditOverloadTerms: [fall(2026)] });
    const r = audit(s, rules, '2027-01-15');
    assert.doesNotMatch(lineOf(r, 'CSE 60762').text, /maximum/);
    assert.match(row(r, 'phd.credits.regular').detail, /\b18 of 24\b/);
    assert.equal(r.warnings.some((x) => /credits of graduate courses/.test(x)), false);
  });

  it('a summer session is capped at 10 credits of any course', () => {
    const s = phdStudent({ courses: [ndCourse('CSE 98900', { term: { season: 'summer', year: 2027 }, credits: 12, grade: 'S' })] });
    const r = audit(s, rules, '2027-09-01');
    assert.match(lineOf(r, 'CSE 98900').text, /over the 10-credit summer-session maximum for Summer 2027 \(Academic Code §3\.8\)/);
    assert.ok(r.warnings.some((x) => /^Summer 2027: 12 credits of courses are entered — the Graduate School allows at most 10 in the summer session/.test(x)), r.warnings.join('\n'));
  });

  it('only what could count is summed: a withdrawn course, a 40000-level course in a fall, and a semester before the program take nothing from the maximum', () => {
    const s = phdStudent({
      courses: [
        ...at(fall(2026), SIX_60K.slice(0, 5)),
        ndCourse('CSE 60770', { term: fall(2026), grade: 'W' }),
        ndCourse('CSE 40113', { term: fall(2026) }),
        ...at(spring(2026), ['CSE 60876', 'CSE 60868', 'CSE 60999', 'CSE 63801', 'CSE 63802', 'CSE 60427'].slice(0, 6)),
      ],
    });
    const over = overMaxTerms(classify(s, rules, '2027-01-15').classified, s, s.entryTerm);
    assert.deepEqual(over, []);
    const r = audit(s, rules, '2027-01-15');
    assert.equal(r.warnings.some((x) => /credits of graduate courses/.test(x)), false);
  });
});

describe('three credits at the 60000 level or higher in every full-time semester (P1-residency-enrollment-c5)', () => {
  const below = ['CSE 40113', 'CSE 40567', 'CSE 40243'];
  it('a full-time Ph.D. semester of 40000-level courses only still counts toward residence, and the row and the review request say so', () => {
    const s = phdStudent({ courses: at(fall(2026), below) });
    const r = audit(s, rules, '2027-01-15');
    const res = row(r, 'phd.residency');
    assert.equal(res.status, 'in_progress');
    assert.match(res.detail, /Fall 2026: fewer than 3 credits at the 60000 level or higher/);
    assert.match(res.detail, /unless its associate dean for academic affairs allowed otherwise \(Academic Code §4\.1\); the semester still counts here, and the review request asks the DGS/);
    assert.match(res.detail, /Longest consecutive full-time run so far: 1 of 4/);
    assert.ok(r.reviewFlags?.some((f) => f.startsWith('Fewer than 3 credits at the 60000 level or higher in a full-time semester: Fall 2026 (0 of 9 credits).')), String(r.reviewFlags));
  });

  it('a residency that would be met goes to the DGS instead', () => {
    const s = phdStudent({
      courses: [...at(fall(2026), below), ...at(spring(2027), SIX_60K.slice(0, 3)), ...at(fall(2027), SIX_60K.slice(3, 6)), ...at(spring(2028), ['CSE 60770', 'CSE 60876', 'CSE 60868'])],
    });
    const r = audit(s, rules, '2028-06-01');
    assert.equal(row(r, 'phd.residency').status, 'needs_dgs_review');
  });

  it('the MSCSE residency row does the same', () => {
    const s = phdStudent({ program: 'mscse', courses: at(fall(2026), below) });
    const r = audit(s, rules, '2027-01-15');
    const res = row(r, 'ms.residency');
    assert.equal(res.status, 'needs_dgs_review');
    assert.match(res.detail, /Fall 2026: fewer than 3 credits at the 60000 level or higher/);
  });

  it('three graduate credits in the semester are enough', () => {
    const s = phdStudent({ courses: [...at(fall(2026), below.slice(0, 2)), ...at(fall(2026), ['CSE 60641'])] });
    const r = audit(s, rules, '2027-01-15');
    assert.doesNotMatch(row(r, 'phd.residency').detail, /fewer than 3 credits/);
    assert.equal(r.reviewFlags?.some((f) => /Fewer than 3 credits/.test(f)) ?? false, false);
  });
});

describe('the Ph.D. residency row names the Code’s “normally” where a run broke (P1-residency-enrollment-7)', () => {
  it('a full-time fall, a part-time spring and a full-time fall', () => {
    const s = phdStudent({ courses: [...at(fall(2026), SIX_60K.slice(0, 3)), ...at(spring(2027), ['CSE 60427']), ...at(fall(2027), ['CSE 60535', 'CSE 60762', 'CSE 60770'])] });
    const r = audit(s, rules, '2028-01-15');
    const res = row(r, 'phd.residency');
    assert.equal(res.status, 'in_progress');
    assert.match(res.detail, /The Graduate School’s own rule asks for four full-time semesters “normally” \(Academic Code §6\.2\.2\), so an exception is possible — ask the DGS/);
  });

  it('an unbroken run says nothing about it', () => {
    const s = phdStudent({ courses: at(fall(2026), SIX_60K.slice(0, 3)) });
    assert.doesNotMatch(row(audit(s, rules, '2027-01-15'), 'phd.residency').detail, /normally/);
  });
});

describe('the semester of graduation, once every requirement is met (P1-residency-enrollment-c6)', () => {
  const fake = (met: number, scored: number): AuditReport =>
    ({ program: 'phd', requirements: [], courseLines: [], summary: { met, conditional: 0, scored }, warnings: [], tracks: [], reviewFlags: [] }) as unknown as AuditReport;
  const input = (report: AuditReport, student: Student = phdStudent()) => ({ report, student, review: { unlisted: 0, caseByCase: 0 }, processingCount: 0 });

  it('is a next step only when every scored requirement is met', () => {
    assert.ok(nextSteps(input(fake(12, 12))).some((s) => s.text === GRADUATION_SEMESTER_STEP));
    assert.equal(nextSteps(input(fake(11, 12))).some((s) => s.text === GRADUATION_SEMESTER_STEP), false);
    assert.equal(nextSteps(input(fake(0, 0))).some((s) => s.text === GRADUATION_SEMESTER_STEP), false);
    assert.equal(
      GRADUATION_SEMESTER_STEP,
      'Register for at least one credit hour (a zero-credit course in a summer session) and complete ND Roll Call in the semester you graduate (Academic Code §3.7; DGS Handbook §3.23.1).',
    );
  });

  it('and a section of the processing request, in the student’s words', () => {
    const s = phdStudent({ gpa: 3.5 });
    const opts = { todayIso: '2032-05-01', entryTerm: 'Fall 2026', priorStudy: 'None' };
    const all = gradAdminRequest(fake(12, 12), s, rules, opts);
    // The heading is the title alone — no handbook sections in the request (DGS
    // 2026-10-28); a capitals heading keeping the documents' names is upperHeading's
    // own test (email-heading-labels.test.ts). A non-source bracket stays.
    assert.match(all.text, /\nSEMESTER OF GRADUATION\n- I will be registered for at least one credit hour \(a zero-credit course in a summer session\) and complete ND Roll Call in the semester I graduate\.\n/);
    assert.doesNotMatch(all.text, /§/);
    assert.doesNotMatch(gradAdminRequest(fake(11, 12), s, rules, opts).text, /ND Roll Call/);
  });
});
