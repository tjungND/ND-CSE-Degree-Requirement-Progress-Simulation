// The Grad Admin request cites no section (DGS 2026-10-28: "Grad Admin is
// familiar with the handbook. No need to refer to handbook sections"), and
// its transfer table never leaves the credits to transfer empty ("Do not
// leave them empty"). Checked over every scenario, in both flavours.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { audit } from '../src/engine/audit.ts';
import { gradAdminRequest } from '../src/ui/grad-admin-request.ts';
import { programHistory } from '../src/ui/program-history.ts';
import { allScenarios, buildRules } from './helpers.ts';

describe('the Grad Admin request over every scenario (DGS 2026-10-28)', () => {
  it('no §, no empty brackets; every transfer row says how many credits to transfer', () => {
    const problems: string[] = [];
    for (const sc of allScenarios()) {
      const rules = buildRules(sc.rules?.patch);
      const report = audit(sc.student, rules, sc.today);
      const req = gradAdminRequest(report, sc.student, rules, { todayIso: sc.today, entryTerm: 'Fall 2026', priorStudy: 'x', gpa: sc.student.gpa, history: programHistory(sc.student) });
      for (const [flavour, body] of [['text', req.text], ['html', req.html]] as const) {
        const bad = /§|\(\s*\)/.exec(body);
        if (bad) problems.push(`${sc.name} (${flavour}): …${body.slice(Math.max(0, bad.index - 60), bad.index + 30)}…`);
      }
      for (const t of [...req.items.transfers]) if (!(t.cappedCredits ?? t.ndCredits ?? t.credits)) problems.push(`${sc.name}: ${t.courseId} has no credits to transfer`);
    }
    assert.deepEqual(problems, []);
  });
});
