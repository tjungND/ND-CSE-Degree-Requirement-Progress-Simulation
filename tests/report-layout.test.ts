// The report column's layout (DGS 2026-10-27). Core knowledge's three areas
// draw as one card whose pill is the area furthest behind; the allowances sit
// under Coursework; the residency sits under Basic requirements and the time
// limit last under the dissertation (Ph.D.) or the project/thesis (MSCSE),
// so there is no "Residence and time" group. The drawing itself is checked in
// the browser (scripts/e2e/drive-app.mjs); this pins the rule and the groups.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { audit } from '../src/engine/audit.ts';
import type { RequirementResult, Student } from '../src/engine/types.ts';
import { furthestBehind, pillLabel } from '../src/ui/report.ts';
import { buildRules } from './helpers.ts';
import { ndCourse, phdStudent } from './helpers/student.ts';

const rules = buildRules();
const TODAY = '2026-10-27';
const core = (s: Student): RequirementResult[] => audit(s, rules, TODAY).requirements.filter((r) => r.id.startsWith('phd.qualifier.core.'));

describe('the core-knowledge card shows the area furthest behind', () => {
  it('one area met, one in progress, one with no course: the card reads as the one with no course', () => {
    const rows = core(phdStudent({ courses: [ndCourse('CSE 60111'), ndCourse('CSE 60321', { grade: 'IP' })] }));
    assert.deepEqual(
      rows.map((r) => [r.id, r.status]),
      [
        ['phd.qualifier.core.os', 'unmet'],
        ['phd.qualifier.core.algorithms', 'met'],
        ['phd.qualifier.core.architecture', 'in_progress'],
      ],
    );
    assert.equal(furthestBehind(rows).id, 'phd.qualifier.core.os');
  });

  it('two met and one in progress: the card reads In progress', () => {
    const rows = core(phdStudent({ courses: [ndCourse('CSE 60111'), ndCourse('CSE 60641'), ndCourse('CSE 60321', { grade: 'IP' })] }));
    const lead = furthestBehind(rows);
    assert.equal(lead.id, 'phd.qualifier.core.architecture');
    assert.equal(pillLabel(lead), 'In progress');
  });

  it('all three met: the card reads Met', () => {
    const rows = core(phdStudent({ courses: [ndCourse('CSE 60111'), ndCourse('CSE 60641'), ndCourse('CSE 60321')] }));
    assert.ok(rows.every((r) => r.status === 'met'));
    assert.equal(pillLabel(furthestBehind(rows)), 'Met');
  });

  it('an overdue area outranks one that is merely not yet, and conditionally met outranks only met', () => {
    const base = core(phdStudent())[0]!;
    const row = (status: RequirementResult['status'], state?: 'overdue' | 'upcoming'): RequirementResult => ({
      ...base,
      status,
      deadline: state ? { date: '2028-05-15', approx: true, state, label: 'Due by the end of Spring 2028' } : undefined,
    });
    assert.equal(furthestBehind([row('unmet', 'upcoming'), row('unmet', 'overdue')]).deadline?.state, 'overdue');
    assert.equal(furthestBehind([row('met'), row('needs_dgs_review'), row('in_progress')]).status, 'in_progress');
    assert.equal(furthestBehind([row('met'), row('needs_dgs_review')]).status, 'needs_dgs_review');
  });
});

describe('the report groups (DGS 2026-10-27)', () => {
  const phd = audit(phdStudent(), rules, TODAY).requirements;
  const ms = audit(phdStudent({ program: 'mscse', msOption: 'project' }), rules, TODAY).requirements;
  const groupOf = (rows: RequirementResult[], id: string): string | undefined => rows.find((r) => r.id === id)?.group;
  const heads = (rows: RequirementResult[]): string[] => [...new Set(rows.map((r) => r.group))];

  it('there is no "Residence and time" group in either program', () => {
    assert.ok(!heads(phd).some((g) => g.startsWith('Residence and time')), heads(phd).join(' | '));
    assert.ok(!heads(ms).some((g) => g.startsWith('Residence and time')), heads(ms).join(' | '));
  });

  it('the residency sits under Basic requirements', () => {
    assert.match(groupOf(phd, 'phd.residency') ?? '', /^Basic requirements/);
    assert.match(groupOf(ms, 'ms.residency') ?? '', /^Basic requirements/);
  });

  it('the time limit is the last row of the dissertation (Ph.D.) or project/thesis (MSCSE) group', () => {
    const last = (rows: RequirementResult[], group: RegExp) => rows.filter((r) => group.test(r.group)).at(-1)?.id;
    assert.match(groupOf(phd, 'phd.timeLimit') ?? '', /^Dissertation and defense/);
    assert.equal(last(phd, /^Dissertation and defense/), 'phd.timeLimit');
    assert.match(groupOf(ms, 'ms.timeLimit') ?? '', /^M\.S\. project or thesis/);
    assert.equal(last(ms, /^M\.S\. project or thesis/), 'ms.timeLimit');
  });

  it('every allowance sits under Coursework', () => {
    for (const rows of [phd, ms]) {
      const allowances = rows.filter((r) => r.allowance);
      assert.ok(allowances.length >= 2);
      for (const r of allowances) assert.match(r.group, /^Coursework/, r.id);
    }
  });
});
