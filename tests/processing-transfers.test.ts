// The processing request submits only what is decided and what the §5.2 cap
// admits (policy review round 3, P3-prior-programs-5; DGS 2026-10-07: "apply
// the suggested handling"). Academic Code §4.6 transfers what "is recommended
// by the program and approved by the Graduate School", up to 6, 9 or 24
// credits; a course the §5.2 card holds for the DGS — pass/fail, taken after
// admission, no earlier program — was still submitted "recommended by the DGS
// in the course rules", and so was credit over the cap.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { audit } from '../src/engine/audit.ts';
import type { Student, Term } from '../src/engine/types.ts';
import { gradAdminRequest, processingItems } from '../src/ui/grad-admin-request.ts';
import { allScenarios, buildRules } from './helpers.ts';
import { phdStudent, transferCourse } from './helpers/student.ts';

describe('held transfers are not submitted (P3-prior-programs-5)', () => {
  for (const name of ['phd-transfer-no-prior-program', 'phd-transfer-pass-fail-grade', 'phd-transfer-taken-after-admission']) {
    it(name, () => {
      const sc = allScenarios().find((x) => x.name === name)!;
      const rules = buildRules(sc.rules.patch);
      const report = audit(sc.student, rules, sc.today);
      const items = processingItems(report, sc.student, rules);
      const held = new Set(sc.student.courses.filter((c) => c.origin === 'transfer').map((c) => c.courseId));
      assert.deepEqual(items.transfers.filter((t) => held.has(t.courseId) && report.courseLines.find((l) => l.courseId === t.courseId)?.mark === 'pending').map((t) => t.courseId), []);
    });
  }
});

describe('credit over the §5.2 cap is not submitted (P3-prior-programs-5)', () => {
  it('phd-transfer-cap-binds: only what the cap admits, the rest named for the DGS', () => {
    const sc = allScenarios().find((x) => x.name === 'phd-transfer-cap-binds')!;
    const rules = buildRules(sc.rules.patch);
    const report = audit(sc.student, rules, sc.today);
    const items = processingItems(report, sc.student, rules);
    const submitted = items.transfers.reduce((n, t) => n + (t.cappedCredits ?? t.ndCredits ?? t.credits), 0);
    assert.ok(report.transferCap !== undefined);
    assert.ok(submitted <= report.transferCap!, `${submitted} submitted, cap ${report.transferCap}`);
  });
  const t = (season: Term['season'], year: number): Term => ({ season, year });
  const UMASS = 'University of Massachusetts Amherst';
  const rules = buildRules({
    external: ['COMPSCI 589', 'COMPSCI 682', 'COMPSCI 670', 'COMPSCI 646'].map((course_id) => ({ university: UMASS, course_id, course_title: course_id, transferable_PhD: 'yes', transferable_MSCSE: 'adgs_approval', is_cse: 'yes' })),
  });
  it('the MSCSE: four ticked approvals over the nine-credit cap — nine submitted, the fourth named', () => {
    const s: Student = phdStudent({
      program: 'mscse', msOption: 'project', entryTerm: t('fall', 2025), bachelorsAwarded: t('spring', 2022), priorMs: 'completed', gpa: 3.7,
      courses: ['COMPSCI 589', 'COMPSCI 682', 'COMPSCI 670', 'COMPSCI 646'].map((id, i) => transferCourse(id, id, { term: t(i % 2 ? 'spring' : 'fall', 2023 + Math.floor(i / 2)), institution: UMASS, degreeLevel: 'masters', dgsApproved: true })),
    });
    const report = audit(s, rules, '2026-03-01');
    const items = processingItems(report, s, rules);
    assert.equal(report.transferCap, 9);
    assert.equal(items.transfers.reduce((n, x) => n + (x.cappedCredits ?? x.credits), 0), 9);
    assert.equal(items.transfersOverCap.length, 1);
    const { text } = gradAdminRequest(report, s, rules, { todayIso: '2026-03-01', entryTerm: 'Fall 2025', priorStudy: 'Completed prior M.S. or Ph.D.' });
    assert.match(text, /Not submitted — over the 9-credit transfer cap/i); // no section in the request (DGS 2026-10-28)
    assert.doesNotMatch(text, /§/);
    assert.match(text, /the DGS may choose which courses fill it|the ADGS may choose which courses fill it/);
  });
});
