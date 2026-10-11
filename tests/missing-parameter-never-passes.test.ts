// A missing Parameters row never passes a requirement (CLAUDE.md: "A missing
// parameter renders 'cannot evaluate', never a default"). The 2026-10-10
// review found eight keys whose absence made 22 rows read better than with
// the row present — with gpa_min gone, a student below the 3.0 floor read
// "met" for admission to candidacy, the defense and the MSCSE along the way,
// which goes straight into the Grad Admin's processing request. This test
// removes each engine key in turn from every scenario's rules and fails if any
// row becomes MORE satisfied than it is with the key: newly met, newly
// "conditionally met" (needs_dgs_review), or newly "does not apply".
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { makeParameters } from '../src/data/params.ts';
import { KNOWN_PARAMETER_KEYS, type Parameters, type Rules } from '../src/data/types.ts';
import { audit } from '../src/engine/audit.ts';
import type { RequirementResult, Status } from '../src/engine/types.ts';
import { processingItems } from '../src/ui/grad-admin-request.ts';
import { allScenarios, buildRules } from './helpers.ts';

/** The same rules with one Parameters row gone, as if the DGS deleted it. */
export function withoutParameter(rules: Rules, key: string): Rules {
  const p = rules.parameters;
  const raw = new Map(p.raw);
  raw.delete(key);
  const gone = <T>(f: (k: string) => T | undefined) => (k: string): T | undefined => (k === key ? undefined : f.call(p, k));
  const parameters: Parameters = { number: gone(p.number), gradeLetter: gone(p.gradeLetter), courseList: gone(p.courseList), codeList: gone(p.codeList), raw };
  return { ...rules, parameters };
}

/** How far a row lets a student through, as its pill reads. A missing number
 * may lower a row (to cannot_evaluate) but never raise it. needs_dgs_review
 * reads "Conditionally met" — except where the row says "Waiting for the DGS"
 * (the transfer row), which is waiting, not passing: a course held for the DGS
 * by its own ruling on a missing cse_subject_codes (P3-sheet-6) reads so. */
const passOf = (r: RequirementResult): number =>
  r.status === 'needs_dgs_review' && r.statusLabel === 'Waiting for the DGS'
    ? 2
    : ({ cannot_evaluate: 0, unmet: 1, in_progress: 2, needs_dgs_review: 3, met: 4, not_applicable: 4 } satisfies Record<Status, number>)[r.status];
const PASSING: readonly Status[] = ['met', 'needs_dgs_review', 'not_applicable'];
/** Rows outside the rule: the allowance meters, which count credits against a
 * cap rather than give a verdict (a cap whose number is missing counts its
 * courses as zero by design, allocate.ts, so its meter honestly reads within
 * the allowance), and shared.approvals, the informational list of who must act
 * (a course held for the DGS by P3-sheet-6 is the DGS's to act on). */
const outsideTheRule = (r: RequirementResult): boolean => r.allowance === true || r.id === 'shared.approvals';

describe('a missing Parameters row never passes a requirement', () => {
  it('every engine key, removed in turn, across every scenario', () => {
    const scenarios = allScenarios();
    const raised: string[] = [];
    let runs = 0;
    for (const sc of scenarios) {
      const rules = buildRules(sc.rules.patch);
      const base = new Map(audit(sc.student, rules, sc.today).requirements.map((r) => [r.id, r]));
      for (const key of KNOWN_PARAMETER_KEYS) {
        if (rules.parameters.raw.get(key) === undefined) continue; // the scenario already lacks it
        runs++;
        for (const r of audit(sc.student, withoutParameter(rules, key), sc.today).requirements) {
          const before = base.get(r.id);
          if (before === undefined || outsideTheRule(r)) continue;
          if (PASSING.includes(r.status) && passOf(r) > passOf(before)) raised.push(`${sc.name}: without ${key}, ${r.id} ${before.status} → ${r.status}`);
        }
      }
    }
    assert.ok(runs > 4000, `expected the full matrix, ran ${runs}`);
    assert.deepEqual(raised, [], `${raised.length} row(s) read better with a Parameters row missing:\n${raised.join('\n')}`);
  });
});

/** The same rules with one Parameters cell MISTYPED — "3.0 (B)" for 3.0, "B or
 * better" for B — read by the app's own readers (policy review round 4,
 * P4-data-2, 2026-10-11): params.ts promises a malformed value reads as a
 * missing one, so it must never pass a requirement either. */
export function withMistypedParameter(rules: Rules, key: string): Rules | undefined {
  const entry = rules.parameters.raw.get(key);
  if (entry === undefined) return undefined;
  const v = entry.value.trim();
  const mistyped = /^-?\d+(\.\d+)?$/.test(v) ? `${v} (see note)` : /^[A-D][+-]?$/i.test(v) ? `${v} or better` : undefined;
  if (mistyped === undefined) return undefined; // a list cell: any text is a list
  const raw = new Map(rules.parameters.raw);
  raw.set(key, { ...entry, value: mistyped });
  return { ...rules, parameters: makeParameters(raw, []) };
}

describe('a mistyped Parameters cell never passes a requirement (policy review round 4, P4-data-2)', () => {
  it('every number or grade key, mistyped in turn, across every scenario', () => {
    const raised: string[] = [];
    let runs = 0;
    for (const sc of allScenarios()) {
      const rules = buildRules(sc.rules.patch);
      const base = new Map(audit(sc.student, rules, sc.today).requirements.map((r) => [r.id, r]));
      for (const key of KNOWN_PARAMETER_KEYS) {
        const mistyped = withMistypedParameter(rules, key);
        if (mistyped === undefined) continue;
        runs++;
        for (const r of audit(sc.student, mistyped, sc.today).requirements) {
          const before = base.get(r.id);
          if (before === undefined || outsideTheRule(r)) continue;
          if (PASSING.includes(r.status) && passOf(r) > passOf(before)) raised.push(`${sc.name}: ${key} mistyped, ${r.id} ${before.status} → ${r.status}`);
        }
      }
    }
    assert.ok(runs > 4000, `expected the full matrix, ran ${runs}`);
    assert.deepEqual(raised, [], `${raised.length} row(s) read better with a Parameters cell mistyped:\n${raised.join('\n')}`);
  });
});

describe('the cases the review found, by name (item 1, 2026-10-10)', () => {
  const run = (scenario: string, key: string) => {
    const sc = allScenarios().find((s) => s.name === scenario)!;
    const rules = withoutParameter(buildRules(sc.rules.patch), key);
    return { report: audit(sc.student, rules, sc.today), sc, rules };
  };

  it('gpa_min missing: the award along the way cannot be evaluated, and the Grad Admin is not asked to process it', () => {
    const { report, sc, rules } = run('phd-ms-along-the-way-gpa-gate', 'gpa_min');
    const along = report.requirements.find((r) => r.id === 'phd.msAlongTheWay')!;
    assert.equal(along.status, 'cannot_evaluate');
    assert.match(along.detail, /Cannot evaluate — the rules sheet is missing 'gpa_min'/);
    assert.equal(processingItems(report, sc.student, rules).msAlongTheWay, false);
  });

  it('gpa_min missing: a dated defense and admission cannot read Met', () => {
    const { report } = run('phd-defense-below-gpa-floor', 'gpa_min');
    for (const id of ['phd.dissertation.defense', 'phd.candidacyAdmission']) {
      const row = report.requirements.find((r) => r.id === id)!;
      assert.equal(row.status, 'cannot_evaluate', id);
      assert.match(row.detail, /missing 'gpa_min'/, id);
    }
  });

  it('a transfer window missing: no transferred course counts, and the transfer row says why', () => {
    const { report } = run('phd-nd-mscse-and-masters-elsewhere-window', 'phd_transfer_window_years');
    const transfer = report.requirements.find((r) => r.id === 'phd.transfer')!;
    assert.equal(transfer.status, 'cannot_evaluate');
    assert.match(transfer.detail, /missing 'phd_transfer_window_years'/);
    assert.ok(report.courseLines.some((l) => /§5\.2’s five-year window cannot be checked: the rules sheet is missing 'phd_transfer_window_years'/.test(l.text)));
  });
});
