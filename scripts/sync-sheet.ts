// Pulls the published sheet CSVs and, when their content changed, rewrites
// data/snapshot.json (raw CSV text + syncedAt). Run every 6 hours by
// .github/workflows/sync-sheet.yml and by hand via `npm run sync-sheet`.
// The snapshot stores raw CSV so the app's one parser handles live and fallback
// identically, and each snapshot commit diff reads as "what the DGS changed".
// Unchanged content leaves the file untouched ON PURPOSE: that makes `syncedAt`
// the moment the current rules were first seen, which is what both pages print
// as "Course rules last updated <date>" (see src/data/rules-date.ts).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rulesFromCsvTexts, type CsvTexts } from '../src/data/assemble.ts';
import { changedTabs } from '../src/data/rules-date.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const snapshotPath = join(root, 'data', 'snapshot.json');
const urls = JSON.parse(readFileSync(join(root, 'data', 'sheet-urls.json'), 'utf8'));

// Google occasionally leaves a request from a GitHub runner hanging (the first
// scheduled run, 2026-09-01, timed out after 30 s with no response at all), so
// the tabs are fetched one at a time, with retries, a generous timeout and a
// timing line per tab — the Action log then shows what happened.
const FETCH_TIMEOUT_MS = 60_000;
const FETCH_ATTEMPTS = 3;

async function fetchCsv(name: string, url: string): Promise<string> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt++) {
    const started = Date.now();
    const seconds = () => ((Date.now() - started) / 1000).toFixed(1);
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), redirect: 'follow' });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status} after ${seconds()} s`);
      if (/^\s*</.test(text)) throw new Error(`got HTML instead of CSV after ${seconds()} s — is the tab still published?`);
      console.log(`Fetched ${name}: ${text.length} characters in ${seconds()} s${attempt > 1 ? ` (attempt ${attempt})` : ''}.`);
      return text;
    } catch (e) {
      lastError = e;
      console.warn(`Fetching ${name} failed (attempt ${attempt} of ${FETCH_ATTEMPTS}, ${seconds()} s): ${e instanceof Error ? e.message : String(e)}`);
      if (attempt < FETCH_ATTEMPTS) await new Promise((r) => setTimeout(r, 5_000 * attempt));
    }
  }
  throw new Error(
    `Could not fetch the ${name} tab (${url}): ${lastError instanceof Error ? lastError.message : String(lastError)}. ` +
      'If this keeps happening from GitHub Actions, see MAINTENANCE.md "Sync, deploy, test".',
  );
}

/** The committed snapshot, or undefined if it is missing or unreadable. */
function readPrevious(): { syncedAt: string; csv: CsvTexts } | undefined {
  if (!existsSync(snapshotPath)) return undefined;
  try {
    const s = JSON.parse(readFileSync(snapshotPath, 'utf8'));
    if (typeof s?.syncedAt === 'string' && s?.csv && ['courses', 'parameters', 'categories'].every((k) => typeof s.csv[k] === 'string')) {
      return { syncedAt: s.syncedAt, csv: s.csv };
    }
  } catch {
    /* fall through: treat as no previous snapshot */
  }
  console.warn('data/snapshot.json is missing or malformed — it will be rewritten.');
  return undefined;
}

const courses = await fetchCsv('Courses', urls.courses);
const parameters = await fetchCsv('Parameters', urls.parameters);
const categories = await fetchCsv('Categories', urls.categories);
// The ExternalCourses tab is optional (unconfigured until the DGS creates and
// publishes it — data/sheet-urls.json 'external'). If it alone fails, keep the
// previous snapshot's copy rather than losing it or failing the whole sync.
let external: string | undefined;
if (typeof urls.external === 'string' && urls.external !== '') {
  try {
    external = await fetchCsv('ExternalCourses', urls.external);
  } catch (e) {
    external = readPrevious()?.csv.external;
    console.warn(
      `ExternalCourses could not be fetched (${e instanceof Error ? e.message : String(e)}) — ` +
        (external !== undefined ? 'keeping the copy from the previous snapshot.' : 'there is no previous copy to keep.'),
    );
  }
}
// The Universities tab (DGS 2026-10-10: each university's credit system) is
// optional in the same way: if it alone fails, keep the previous copy.
let universities: string | undefined;
if (typeof urls.universities === 'string' && urls.universities !== '') {
  try {
    universities = await fetchCsv('Universities', urls.universities);
  } catch (e) {
    universities = readPrevious()?.csv.universities;
    console.warn(
      `Universities could not be fetched (${e instanceof Error ? e.message : String(e)}) — ` +
        (universities !== undefined ? 'keeping the copy from the previous snapshot.' : 'there is no previous copy to keep.'),
    );
  }
}
const live: CsvTexts = {
  courses,
  parameters,
  categories,
  ...(external !== undefined ? { external } : {}),
  ...(universities !== undefined ? { universities } : {}),
};

const syncedAt = new Date().toISOString();
const rules = rulesFromCsvTexts(live, { source: 'live', syncedAt });

if (rules.courses.size === 0 || rules.parameters.raw.size === 0 || rules.categoryGroups.length === 0) {
  console.error('Refusing to write a snapshot with an empty Courses/Parameters/Categories tab — check the published sheet.');
  process.exit(1);
}

const errors = rules.issues.filter((i) => i.severity === 'error');
const warnings = rules.issues.filter((i) => i.severity === 'warning');
console.log(`Fetched: ${rules.courses.size} courses, ${rules.parameters.raw.size} parameters, ` +
  `${rules.coreAreas.length} core areas, ${rules.categoryGroups.length} groups.`);
for (const i of rules.issues) console.log(`  [${i.severity}] ${i.message}`);
console.log(`${errors.length} error(s), ${warnings.length} warning(s) — the app shows these in its diagnostics panel.`);

const previous = readPrevious();
const changed = previous ? changedTabs(previous.csv, live) : [];
if (previous && changed.length === 0) {
  console.log(`Sheet content unchanged since ${previous.syncedAt} — data/snapshot.json left as is.`);
} else {
  const snapshot = { schemaVersion: 1, syncedAt, csv: live };
  writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2) + '\n');
  console.log(
    previous
      ? `Sheet content changed since ${previous.syncedAt} (tab${changed.length > 1 ? 's' : ''}: ${changed.join(', ')}) — wrote data/snapshot.json (synced ${syncedAt}).`
      : `Wrote data/snapshot.json (synced ${syncedAt}).`,
  );
}
