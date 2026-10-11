// Re-run a student's saved self-check against the very rules it was checked
// with (DGS 2026-10-11, item 8: "stamp every result").
//
//   npm run reproduce -- <saved file .json>
//
// A file saved with "Save to a file" carries a stamp (src/ui/stamp.ts): the
// rules' fingerprint, the date the check ran against, the app build and every
// row's verdict as the page showed it. This script finds the commit of
// data/snapshot.json whose tabs give the same fingerprint, re-runs audit()
// with this checkout's code on that date, and lists every row whose verdict
// differs from the saved one. Nothing is sent anywhere; the file stays where
// it is. FERPA: a student's file holds their record — run it on your own Mac
// and keep the file out of the repository.
//
// Exit code: 0 when every row reads as saved, 1 when a row differs, 2 when the
// file or the rules could not be read.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { rulesFromCsvTexts, type CsvTexts } from '../../src/data/assemble.ts';
import { rulesFingerprint } from '../../src/data/fingerprint.ts';
import { ndDateOnly } from '../../src/data/rules-date.ts';
import { audit } from '../../src/engine/audit.ts';
import { termLabel } from '../../src/engine/term.ts';
import { verdictsOf } from '../../src/engine/verdict.ts';
import { HANDBOOK_SOURCE } from '../../src/ui/handbook-text.ts';
import type { SavedStamp } from '../../src/ui/stamp.ts';
import { validateStudent, type Refusal } from '../../src/ui/state.ts';

const path = process.argv.slice(2).find((a) => !a.startsWith('--'));
if (!path) {
  console.error('Usage: npm run reproduce -- <saved self-check file .json>');
  process.exit(2);
}

let raw: { savedAt?: string; stamp?: SavedStamp; simulation?: unknown; student?: unknown };
try {
  raw = JSON.parse(readFileSync(path, 'utf8'));
} catch (e) {
  console.error(`Cannot read ${path} as JSON: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(2);
}
const refusals: Refusal[] = [];
const student = validateStudent(raw, refusals);
for (const r of refusals) console.log(`Note: the page would refuse part of this file too — ${r.message}`);
const stamp = raw.stamp;
if (raw.simulation) console.log('This is a SIMULATION file: a planning copy, not the student’s record.');

const git = (...args: string[]): string => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();

/** Every committed snapshot, newest first, and the working tree's copy. */
type Snapshot = { where: string; syncedAt: string; csv: CsvTexts };
function snapshots(): Snapshot[] {
  const out: Snapshot[] = [];
  let shas: string[] = [];
  try {
    shas = git('log', '--format=%H', '--', 'data/snapshot.json').split('\n').filter(Boolean);
  } catch {
    console.log('Note: git is not available here — only this checkout’s data/snapshot.json is searched.');
  }
  for (const sha of shas) {
    try {
      const s = JSON.parse(git('show', `${sha}:data/snapshot.json`));
      out.push({ where: `the snapshot commit ${sha.slice(0, 7)}`, syncedAt: s.syncedAt, csv: s.csv });
    } catch {
      /* a commit that removed the file */
    }
  }
  // This checkout's copy, when no commit holds it yet (a sync run here, uncommitted).
  try {
    const s = JSON.parse(readFileSync('data/snapshot.json', 'utf8'));
    if (!out.some((o) => o.syncedAt === s.syncedAt)) out.unshift({ where: 'data/snapshot.json (this checkout, not committed yet)', syncedAt: s.syncedAt, csv: s.csv });
  } catch {
    /* no working copy */
  }
  return out;
}

/** The snapshot's tabs as the audit may have read them: all of them, or
 * without an optional tab that failed to load (the fingerprint leaves out a
 * tab the app could not read). */
function variants(csv: CsvTexts): { label: string; csv: CsvTexts }[] {
  const { external, universities, ...required } = csv;
  return [
    { label: 'every tab', csv },
    ...(external !== undefined ? [{ label: 'without the ExternalCourses tab (it failed to load for the student)', csv: { ...required, ...(universities !== undefined ? { universities } : {}) } }] : []),
    ...(universities !== undefined ? [{ label: 'without the Universities tab (it failed to load for the student)', csv: { ...required, ...(external !== undefined ? { external } : {}) } }] : []),
    ...(external !== undefined && universities !== undefined ? [{ label: 'without the ExternalCourses and Universities tabs', csv: required }] : []),
  ];
}

const all = snapshots();
if (all.length === 0) {
  console.error('No data/snapshot.json found — run this from the repository folder.');
  process.exit(2);
}

let chosen: { snap: Snapshot; csv: CsvTexts; how: string } | undefined;
if (!stamp) {
  console.log('This file has no stamp (saved before 2026-10-11): re-running with the newest snapshot and the date it was saved.');
  chosen = { snap: all[0]!, csv: all[0]!.csv, how: 'newest snapshot (the file names no rules)' };
} else {
  const want = stamp.rules.fingerprint;
  const hits: { snap: Snapshot; csv: CsvTexts; label: string }[] = [];
  for (const snap of all) for (const v of variants(snap.csv)) if (rulesFingerprint(v.csv) === want) hits.push({ snap, csv: v.csv, label: v.label });
  if (hits.length > 0) {
    const h = hits[0]!;
    // The same content can come back (an edit undone): the newest copy is used, the others named.
    const others = hits.slice(1).map((x) => x.snap.where.replace(/^the snapshot /, ''));
    chosen = { snap: h.snap, csv: h.csv, how: `fingerprint ${want} matches ${h.snap.where} (synced ${h.snap.syncedAt}; ${h.label})${others.length > 0 ? ` — the same content is also in ${others.join(', ')}` : ''}` };
  } else {
    // Read live within hours of an edit the sync had not saved yet: the next
    // snapshot after the rules' date is the likeliest copy (and may differ).
    const after = stamp.rules.rulesDate?.at;
    const next = after ? [...all].reverse().find((s) => s.syncedAt > after) : undefined;
    const pick = next ?? all[0]!;
    chosen = {
      snap: pick,
      csv: pick.csv,
      how: `NO snapshot has fingerprint ${want} — the student read the live sheet after an edit the six-hourly sync had not saved yet, or the sheet changed again before it did. Using ${pick.where} (synced ${pick.syncedAt}), ${next ? 'the first snapshot after the rules’ date' : 'the newest snapshot'}; rows may differ for that reason alone`,
    };
  }
}

const rules = rulesFromCsvTexts(chosen.csv, { source: 'snapshot', syncedAt: chosen.snap.syncedAt });
const today = stamp?.auditDate ?? ndDateOnly(raw.savedAt ?? new Date().toISOString());
const report = audit(student, rules, today);
const now = verdictsOf(report.requirements);

const head = (() => {
  try {
    return git('rev-parse', '--short=7', 'HEAD');
  } catch {
    return 'unknown';
  }
})();
console.log(`Rules: ${chosen.how}.`);
console.log(`Checked as of: ${today}${raw.savedAt ? ` (file saved ${raw.savedAt})` : ''}.`);
if (stamp) {
  console.log(`App: the student's page ran ${stamp.app.commit}${stamp.app.date ? ` (${stamp.app.date})` : ''}${stamp.app.modified ? ' with local changes' : ''}; this re-run uses the code at ${head}.`);
  if (stamp.app.commit !== head) {
    console.log(`  A difference below may come from code changed since ${stamp.app.commit}. To re-run with that code exactly:`);
    console.log(`  git worktree add ../reproduce-${stamp.app.commit} ${stamp.app.commit} && cd ../reproduce-${stamp.app.commit} && npm ci && npm run reproduce -- ${path}`);
  }
  if (stamp.handbook.sha256 !== HANDBOOK_SOURCE.sha256) console.log(`Handbook: the student's page used the edition “${stamp.handbook.edition}”; this checkout has “${HANDBOOK_SOURCE.edition}”.`);
}
console.log('');
console.log(`${student.program === 'mscse' ? 'M.S. in CSE' : 'Ph.D.'}, entered ${termLabel(student.entryTerm)} — every row:`);
for (const r of report.requirements) console.log(`  ${r.id}: ${now[r.id]}`);

if (!stamp) process.exit(0);
const ids = [...new Set([...Object.keys(stamp.verdicts), ...Object.keys(now)])];
const changed = ids.filter((id) => stamp.verdicts[id] !== now[id]);
console.log('');
if (changed.length === 0) {
  console.log(`Every row reads as the page showed it when the file was saved (${ids.length} rows).`);
} else {
  console.log(`${changed.length} row(s) read differently from what the page showed when the file was saved:`);
  for (const id of changed) console.log(`  ${id}: ${stamp.verdicts[id] ?? '(no row)'} → ${now[id] ?? '(no row)'}`);
  process.exitCode = 1;
}
