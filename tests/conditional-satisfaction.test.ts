// Conditional satisfaction (interface review R2, 2026-09-18). Three things the
// report used to get wrong at once, on the same rows:
//
//   1. a row read "Met" while naming the courses still waiting for the approval
//      its own handbook quote requires;
//   2. the credits a cap DISCARDED were printed as ordinary body text under the
//      green pill, so a row that costs a student three credits looked like an
//      unqualified pass;
//   3. the dashboard had no count for "satisfied except for a signature" — it
//      was folded into "not yet" with a parenthetical.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { audit } from '../src/engine/audit.ts';
import type { AuditReport } from '../src/engine/types.ts';
import { scoreLine } from '../src/ui/report.ts';
import { allScenarios, buildRules } from './helpers.ts';

const reports: { name: string; report: AuditReport }[] = allScenarios().map((sc) => ({
  name: sc.name,
  report: audit(sc.student, buildRules(sc.rules.patch), sc.today),
}));

/** The ONE row allowed to read "Met" while naming a course that needs an
 * approval, and why. §3.2's "Up to six (6) credits at the 40000 level may be
 * used to satisfy the course requirement" names no approval at all, so the
 * absence is the handbook's — the DGS ruled on 2026-09-18 that this row keeps
 * its verdict while `phd.cap.fourk` and `ms.cap.sharedbs` gained theirs. If
 * this list ever grows, the reason belongs in docs/DECISIONS.md first. */
const MET_MAY_NAME_AN_APPROVAL = new Set<string>(); // empty since 2026-10-02: §3.2 gained its approval clause (September 2026 edition)

// What makes an outstanding approval LOAD-BEARING. A surplus note is not:
// "24 of 24 credits complete. 3 pending review/approval." is met on the
// definite credits alone and merely says three more are on their way — which is
// what tests/scenarios/dgs-approval-not-load-bearing.json is named for, and
// what thresholdStatus's certainty ladder already gets right. The review's
// complaint (R2) is the other case: a row satisfied only BECAUSE of something
// nobody has approved yet.
const LOAD_BEARING = /needs approval|Pending review:|meeting this depends on courses that still need review/i;

describe('no row reads "Met" while an approval it depends on is outstanding (R2)', () => {
  it('across every scenario', () => {
    const offenders: string[] = [];
    for (const { name, report } of reports) {
      for (const r of report.requirements) {
        if (r.status !== 'met' || MET_MAY_NAME_AN_APPROVAL.has(r.id)) continue;
        if (LOAD_BEARING.test(r.detail)) offenders.push(`${name} → ${r.id}: ${r.detail.slice(0, 120)}`);
      }
    }
    assert.deepEqual(offenders, [], `a "Met" pill above an outstanding approval:\n${offenders.join('\n')}`);
  });

  it('and no row is exempt any more — §3.2 gained its approval clause in the September 2026 edition (DGS 2026-10-02)', () => {
    const exempt = reports.flatMap(({ report }) =>
      report.requirements.filter((r) => r.status === 'met' && /needs approval/i.test(r.detail)).map((r) => r.id),
    );
    assert.deepEqual([...new Set(exempt)].sort(), []);
  });
});

describe('credits a cap discards are warnings, not prose (R2)', () => {
  const over = reports.find(({ name }) => name === 'phd-caps-unapproved')!;

  it('the over-cap lines come through as warning parts', () => {
    const row = over.report.requirements.find((r) => r.id === 'phd.cap.fourk')!;
    const warnings = (row.detailParts ?? []).filter((p) => typeof p === 'object' && 'warn' in p);
    assert.equal(warnings.length, 1, JSON.stringify(row.detailParts));
    assert.match((warnings[0] as { warn: string }).warn, /CSE 40567: 3 credits not counted — beyond the allowance/);
  });

  it('…and the prose detail is unchanged, so the copied messages still read as before', () => {
    const row = over.report.requirements.find((r) => r.id === 'phd.cap.noncse')!;
    assert.match(row.detail, /PSY 60119: 3 credits beyond the allowance — count toward the total-credit requirement only/);
  });

  it('a row with discarded credits never presents as an unqualified pass', () => {
    for (const { name, report } of reports) {
      for (const r of report.requirements) {
        const discards = (r.detailParts ?? []).some((p) => typeof p === 'object' && 'warn' in p);
        if (discards && r.status === 'met' && !MET_MAY_NAME_AN_APPROVAL.has(r.id)) {
          // A cap may legitimately be "met" while discarding credits — what it
          // may not do is discard them silently, so the warning must be there.
          assert.ok(
            (r.detailParts ?? []).some((p) => typeof p === 'object' && 'warn' in p),
            `${name} → ${r.id} discards credits with no warning`,
          );
        }
      }
    }
  });
});

describe('the dashboard tells the three states apart (R2)', () => {
  it('the summary counts conditional satisfaction on its own, disjoint from met', () => {
    for (const { name, report } of reports) {
      const { met, conditional, scored } = report.summary;
      // The qualifier's parts and the allowances are shown but not counted (2026-09-27).
      const rows = report.requirements.filter((r) => !r.informational && !r.unscored && !r.allowance && r.status !== 'not_applicable');
      assert.equal(met, rows.filter((r) => r.status === 'met').length, name);
      assert.equal(conditional, rows.filter((r) => r.status === 'needs_dgs_review').length, name);
      assert.ok(met + conditional <= scored, name);
    }
  });

  it('the sticky score line names it instead of hiding it', () => {
    const withCond = reports.find(({ report }) => report.summary.conditional > 0)!;
    assert.match(scoreLine(withCond.report), /\d+ of \d+ met · \d+ conditionally met/);
    const noCond = reports.find(({ report }) => report.summary.conditional === 0)!;
    assert.doesNotMatch(scoreLine(noCond.report), /conditionally/);
  });
});

describe('the one row that must not read "Conditionally met" (W-CS2)', () => {
  it('a defense past §4.3’s limit overrides the pill', () => {
    const late = reports.find(({ name }) => name === 'phd-defense-after-the-eight-year-limit')!;
    const row = late.report.requirements.find((r) => r.id === 'phd.dissertation.defense')!;
    assert.equal(row.status, 'needs_dgs_review', 'the status — and so the dashboard count — is unchanged');
    assert.equal(row.statusLabel, 'Eligibility at risk');
    assert.match(row.detail, /forfeiture of degree eligibility/);
  });

  it('a defense inside the limit carries no override', () => {
    for (const { report } of reports) {
      for (const r of report.requirements) {
        if (r.id !== 'phd.dissertation.defense') continue;
        if (r.status !== 'needs_dgs_review') assert.equal(r.statusLabel, undefined, r.detail.slice(0, 80));
      }
    }
  });

  it('only the rows that are meant to override their pill do', () => {
    // Two, each for a stated reason: the §4.7 defense past §4.3's limit
    // ("Eligibility at risk", W-CS2), and a cap nobody has drawn on yet ("Not
    // used yet", blue-team B4 — "Does not apply" read as an exemption from a
    // limit that does apply). Anything else appearing here is a bug.
    const overridden = new Map<string, Set<string>>();
    for (const { report } of reports) {
      for (const r of report.requirements) {
        if (!r.statusLabel) continue;
        overridden.set(r.statusLabel, (overridden.get(r.statusLabel) ?? new Set()).add(r.id));
      }
    }
    // …and, since 2026-09-27 (DGS, clarity proposal 4): the transfer row reads
    // "Waiting for the DGS" (ADGS on the M.S. tab) while a course is
    // unreviewed — an allowance has nothing to "meet" — and the along-the-way
    // MSCSE reads "Not started" until the OCE.
    // …and, since 2026-10-03 (policy review): "Eligibility at risk" also on the
    // Ph.D.'s official submission, the MSCSE's thesis defense and project
    // report, and the two time-limit rows, each when its date is after the
    // degree's limit; "Graduate School approval pending" on the transfer row
    // once the DGS has decided and only §5.2's criterion 5 is left.
    // …and, since 2026-10-04: the MSCSE's final thesis submission (Academic
    // Code §6.1.8), the master's counterpart of the Ph.D.'s.
    // …and, since 2026-10-11 (DGS, question 3a: option (b)): the along-the-way
    // MSCSE reads "Qualifies" while the record qualifies but the student has
    // not asked for the master's.
    const allowed = ['Eligibility at risk', 'Not started', 'Not used yet', 'Waiting for the ADGS', 'Waiting for the DGS', 'Graduate School approval pending', 'Qualifies'];
    for (const label of overridden.keys()) assert.ok(allowed.includes(label), label);
    for (const id of overridden.get('Eligibility at risk') ?? []) assert.ok(['phd.dissertation.defense', 'phd.dissertation.submitted', 'ms.thesis.defense', 'ms.thesis.submitted', 'ms.project.report', 'phd.timeLimit', 'ms.timeLimit'].includes(id), id);
    assert.ok((overridden.get('Eligibility at risk') ?? new Set()).has('phd.dissertation.defense'));
    for (const id of overridden.get('Not used yet') ?? []) assert.match(id, /\.cap\./, id);
    for (const id of overridden.get('Not started') ?? []) assert.equal(id, 'phd.msAlongTheWay');
    for (const id of overridden.get('Qualifies') ?? []) assert.equal(id, 'phd.msAlongTheWay');
    for (const id of [...(overridden.get('Waiting for the DGS') ?? []), ...(overridden.get('Waiting for the ADGS') ?? []), ...(overridden.get('Graduate School approval pending') ?? [])]) assert.match(id, /\.transfer$/, id);
  });
});
