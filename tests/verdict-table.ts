// The approved verdicts (DGS 2026-10-11, item 3: "Check every row of every test
// student"). Each scenario fixture pins only the rows it was written about —
// a median of two of its ~40 — so an engine change that moved any other row
// passed silently. This table pins EVERY row of EVERY scenario: its status,
// the pill's own wording when the row has one, its credit count and its
// deadline state. tests/verdicts.test.ts compares the engine with the
// approved copy in tests/verdicts.json and prints each changed verdict;
// `npm run verdicts -- --update` rewrites the copy once the DGS has approved
// the list. Shared by the test and scripts/dev/verdicts.mts.
import { readFileSync } from 'node:fs';
import { audit } from '../src/engine/audit.ts';
import type { RequirementResult } from '../src/engine/types.ts';
import { allScenarios, buildRules } from './helpers.ts';

export const VERDICTS_FILE = new URL('./verdicts.json', import.meta.url);

/** scenario name → requirement id → verdict. */
export type VerdictTable = Record<string, Record<string, string>>;

/** One row in one line: "met", "needs_dgs_review “Waiting for the DGS”",
 * "in_progress 18/24", "unmet [overdue]". */
export function verdictOf(r: RequirementResult): string {
  return [
    r.status,
    ...(r.statusLabel ? [`“${r.statusLabel}”`] : []),
    ...(r.progress ? [`${+r.progress.have.toFixed(2)}/${r.progress.need}`] : []),
    ...(r.deadline ? [`[${r.deadline.state}]`] : []),
  ].join(' ');
}

export function verdictTable(): VerdictTable {
  const out: VerdictTable = {};
  for (const sc of allScenarios()) {
    const report = audit(sc.student, buildRules(sc.rules.patch), sc.today);
    out[sc.name] = Object.fromEntries(report.requirements.map((r) => [r.id, verdictOf(r)]));
  }
  return out;
}

export function readApproved(): VerdictTable {
  return JSON.parse(readFileSync(VERDICTS_FILE, 'utf8')) as VerdictTable;
}

/** Stable text: scenarios and rows in name order, one row per line, so a
 * commit's diff of the file IS the list of changed verdicts. */
export function serialize(table: VerdictTable): string {
  const scenarios = Object.keys(table).sort();
  const lines = ['{'];
  scenarios.forEach((name, i) => {
    const rows = table[name]!;
    const ids = Object.keys(rows).sort();
    lines.push(`  ${JSON.stringify(name)}: {`);
    ids.forEach((id, j) => lines.push(`    ${JSON.stringify(id)}: ${JSON.stringify(rows[id])}${j < ids.length - 1 ? ',' : ''}`));
    lines.push(`  }${i < scenarios.length - 1 ? ',' : ''}`);
  });
  lines.push('}');
  return lines.join('\n') + '\n';
}

/** "scenario · row: approved → now", one line per difference. */
export function differences(approved: VerdictTable, now: VerdictTable): string[] {
  const out: string[] = [];
  for (const name of [...new Set([...Object.keys(approved), ...Object.keys(now)])].sort()) {
    const a = approved[name];
    const b = now[name];
    if (!a) {
      out.push(`${name}: new scenario (${Object.keys(b!).length} rows)`);
      continue;
    }
    if (!b) {
      out.push(`${name}: scenario removed`);
      continue;
    }
    for (const id of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
      if (a[id] !== b[id]) out.push(`${name} · ${id}: ${a[id] ?? '(no row)'} → ${b[id] ?? '(no row)'}`);
    }
  }
  return out;
}
