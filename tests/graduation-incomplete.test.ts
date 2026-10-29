// An Incomplete in the semester the student graduates (policy review round 3,
// P3-dh-3.1-3.13-3; DGS 2026-10-06: "apply the handling including the optional
// (3)"). DGS Handbook §3.23.1 lists among the conditions for graduating: "No
// 'I' grades in any course during the final semester of a terminal degree"
// (also §3.13; Academic Code §4.3). The app treated such an I as an ordinary
// open Incomplete, and the next step and the processing request said the
// student was registered for the graduation semester as if clear to graduate.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { audit } from '../src/engine/audit.ts';
import type { CourseEntry, Student, Term } from '../src/engine/types.ts';
import { gradAdminRequest } from '../src/ui/grad-admin-request.ts';
import { nextSteps } from '../src/ui/next-steps.ts';
import { buildRules } from './helpers.ts';
import { ndCourse } from './helpers/student.ts';

const rules = buildRules();
const t = (season: Term['season'], year: number): Term => ({ season, year });
const TODAY = '2026-12-20';
/** The finding's MSCSE student: 30 credits graded by Fall 2026, graduating Fall 2026, and a surplus CSE 60876 graded I in Fall 2026. */
const student = (iTerm: Term = t('fall', 2026)): Student => {
  const ids = ['CSE 60641', 'CSE 60111', 'CSE 60321', 'CSE 60427', 'CSE 60535', 'CSE 60762', 'CSE 60770', 'CSE 60868'];
  const terms = [t('fall', 2025), t('fall', 2025), t('fall', 2025), t('spring', 2026), t('spring', 2026), t('spring', 2026), t('fall', 2026), t('fall', 2026)];
  const courses: CourseEntry[] = [...ids.map((id, i) => ndCourse(id, { term: terms[i]! })), ndCourse('CSE 68902', { term: t('spring', 2026), credits: 6 }), ndCourse('CSE 60876', { term: iTerm, grade: 'I' })];
  return { schemaVersion: 1, program: 'mscse', entryTerm: t('fall', 2025), priorMs: 'none', graduationTerm: t('fall', 2026), milestones: {}, attestations: { advisorApprovedPlan: true }, courses };
};

describe('an I in the graduation semester (P3-dh-3.1-3.13-3)', () => {
  const s = student();
  const report = audit(s, rules, TODAY);
  it('the page warns', () => {
    assert.ok(
      report.warnings.some((w) => w.startsWith('An Incomplete cannot stand in the semester you graduate: CSE 60876 is graded I in Fall 2026, and the Graduate School confers the degree only with no I grades in that semester.')),
      report.warnings.join(' | '),
    );
    assert.deepEqual(report.graduation?.incompletes, ['CSE 60876']);
  });
  it('the next step says to make it final, not "you are registered for it"', () => {
    const steps = nextSteps({ report, student: s, review: { unlisted: 0, caseByCase: 0 }, processingCount: 0 }).map((x) => x.text);
    assert.ok(steps.some((x) => x.startsWith('Have the I in CSE 60876 made final before your degree is conferred')), steps.join(' | '));
    assert.ok(!steps.some((x) => /you are registered for it/.test(x)), steps.join(' | '));
  });
  it('the processing request says the same', () => {
    const { text } = gradAdminRequest(report, s, rules, { todayIso: TODAY, entryTerm: 'Fall 2025', priorStudy: 'None' });
    // No handbook sections in the request (DGS 2026-10-28).
    assert.match(text, /\nSEMESTER OF GRADUATION\n- I plan to graduate in Fall 2026, but CSE 60876 is graded I in that semester — the degree is conferred only with no I grades in it, so I will have the grade made final first\.\n/);
    assert.doesNotMatch(text, /I am registered for it/);
  });
  it('the I’s own line says it (the optional (3))', () => {
    const line = report.courseLines.find((l) => l.courseId === 'CSE 60876')!;
    assert.match(line.text, /Fall 2026 is your graduation semester, and the degree is conferred only with no I grades in it \(DGS Handbook §3\.23\.1\)/);
  });
  it('an I in another semester is the ordinary Incomplete', () => {
    const other = audit(student(t('spring', 2026)), rules, TODAY);
    assert.ok(!other.warnings.some((w) => w.startsWith('An Incomplete cannot stand')));
    assert.equal(other.graduation?.incompletes, undefined);
    assert.doesNotMatch(other.courseLines.find((l) => l.courseId === 'CSE 60876')!.text, /graduation semester/);
  });
});
