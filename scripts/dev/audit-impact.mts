// Reading errors by their effect on the degree check (DGS 2026-10-11, item 14:
// "fix reading errors by verdict impact"). The replay says how many rows and
// cells a transcript reads wrong; this says which of those errors would change
// what the self-check tells a student.
//
//   npm run audit-impact                      # the line-list corpora (text path)
//   npm run audit-impact -- --ocr <run dir>   # …and a bench run's saved OCR lines (L2, L5…)
//   npm run audit-impact -- --only ucla       # one document, every changed row
//
// For each document, two Ph.D. records are checked with the same rules on the
// same date — one holding the transcript's TRUE rows (expected.json), one the
// rows the reader read — and every requirement row's verdict is compared
// (status, pill, credit count, deadline: src/engine/verdict.ts), with the
// transfer credit each counts. The record: a Ph.D. student with a finished
// master's at that university, entering the fall after the transcript's last
// term, checked a year later, every graduate row a transfer candidate. The
// rules: the saved snapshot, with an ExternalCourses row ruling every TRUE
// course transferable (no core area) — the DGS's decision the student would
// ask for — so a misread id finds no ruling, a misread grade meets §5.2's B
// floor, a misread term meets its window, a misread credit counts wrong.
//
// FERPA: public and synthetic documents only; prints names and counts.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { rulesFromCsvTexts, type CsvTexts } from '../../src/data/assemble.ts';
import { audit } from '../../src/engine/audit.ts';
import { compareTerm, termOfDate } from '../../src/engine/term.ts';
import type { CourseEntry, Grade, Student, Term } from '../../src/engine/types.ts';
import { verdictsOf } from '../../src/engine/verdict.ts';
import { parseExternalTranscript, type ExternalCourseCandidate } from '../../src/transcript/external.ts';
import { splitRow } from './score.mts';
import { collectSeeds } from './ocr-bench/seeds.mts';

const root = new URL('../../', import.meta.url).pathname;
const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const only = flag('--only');
const ocrRun = flag('--ocr');
const snapshot = JSON.parse(readFileSync(join(root, 'data', 'snapshot.json'), 'utf8')) as { syncedAt: string; csv: CsvTexts };
const UNIVERSITY = 'EXAMPLE UNIVERSITY';

const GRADES = new Set(['A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D', 'F', 'S', 'U', 'IP', 'I', 'W', 'V']);
interface Row { courseId: string; title: string; credits?: number; grade?: string; season?: Term['season']; year?: number; level?: string }
const fromExpected = (text: string): Row => {
  const c = splitRow(text);
  const [season, year] = c.cells.term.split(' ');
  return { courseId: c.id, title: c.cells.title, credits: c.cells.credits === '?' ? undefined : Number(c.cells.credits), grade: c.cells.grade === '?' ? undefined : c.cells.grade, season: (season || undefined) as Term['season'] | undefined, year: year ? Number(year) : undefined, level: c.cells.level || undefined };
};
const fromParsed = (c: ExternalCourseCandidate): Row => ({ courseId: c.courseId, title: c.title ?? '', credits: c.credits, grade: c.grade, season: c.season, year: c.year, level: c.level });
const rawMarksOf = (courses: ExternalCourseCandidate[]): Set<string> => new Set(courses.filter((c) => !c.grade && c.rawGrade).map((c) => `${c.courseId}|${c.rawGrade}`));

/** The rows as a record's transfer courses: only what the preview would let
 * the student add — an id, credits, a term and a grade the app knows. A mark
 * the reader left for the student to turn into a letter (Anna University's
 * "S" is its TOP grade, not a pass) is left out of both records alike:
 * which letter the student chooses is not a reading error. */
const entries = (rows: Row[], rawMarks: Set<string>): CourseEntry[] =>
  rows.flatMap((r) =>
    r.courseId && r.credits !== undefined && r.credits > 0 && r.season && r.year && r.grade && GRADES.has(r.grade) && !rawMarks.has(`${r.courseId}|${r.grade}`)
      ? [{ courseId: r.courseId, title: r.title || undefined, credits: r.credits, term: { season: r.season, year: r.year }, grade: r.grade as Grade, origin: 'transfer' as const, institution: UNIVERSITY, degreeLevel: r.level === 'undergraduate' ? ('bachelors' as const) : ('masters' as const) }]
      : [],
  );

const csvCell = (v: string): string => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
function rulesFor(truth: Row[]) {
  const header = 'university,course_id,course_title,satisfies_core_area,transferable_PhD,transferable_MSCSE,is_cse,nd_credits,decided_on,notes';
  const lines = [...new Map(truth.filter((r) => r.courseId).map((r) => [r.courseId, r])).values()].map((r) => [UNIVERSITY, r.courseId, r.title, 'none', 'yes', 'yes', '', '', '2026-10-11', 'audit-impact'].map(csvCell).join(','));
  return rulesFromCsvTexts({ ...snapshot.csv, external: [header, ...lines].join('\n') + '\n' }, { source: 'snapshot', syncedAt: snapshot.syncedAt });
}

interface Impact { name: string; path: string; verdicts: string[]; creditsTrue: number; creditsRead: number }
function impactOf(name: string, path: string, truth: Row[], read: Row[], rawMarks: Set<string>): Impact | undefined {
  const terms = truth.filter((r) => r.season && r.year).map((r) => ({ season: r.season!, year: r.year! }));
  if (terms.length === 0) return undefined;
  const last = terms.reduce((a, b) => (compareTerm(a, b) >= 0 ? a : b));
  const entry: Term = { season: 'fall', year: last.season === 'fall' ? last.year + 1 : last.year };
  const today = `${entry.year + 1}-06-01`;
  void termOfDate;
  const student = (courses: CourseEntry[]): Student =>
    ({
      schemaVersion: 1,
      program: 'phd',
      entryTerm: entry,
      priorMs: 'completed',
      background: { bachelors: 'elsewhere', graduate: 'elsewhere-finished' },
      gpa: 3.7,
      milestones: { advisorIdentified: `${entry.year}-10-01`, advisorName: 'Prof. Example', advisorTtt: 'yes' },
      attestations: { advisorApprovedPlan: true },
      courses,
    }) as unknown as Student;
  const rules = rulesFor(truth);
  const a = audit(student(entries(truth, rawMarks)), rules, today);
  const b = audit(student(entries(read, rawMarks)), rules, today);
  const va = verdictsOf(a.requirements);
  const vb = verdictsOf(b.requirements);
  const verdicts = [...new Set([...Object.keys(va), ...Object.keys(vb)])].filter((id) => va[id] !== vb[id]).map((id) => `${id}: ${va[id] ?? '(none)'} → ${vb[id] ?? '(none)'}`);
  const counted = (r: typeof a) => (r.transferCredits ?? []).reduce((n, t) => n + t.counted, 0);
  return { name, path, verdicts, creditsTrue: counted(a), creditsRead: counted(b) };
}

const results: Impact[] = [];
for (const corpus of ['public-transcripts', 'ms-transcripts']) {
  const dir = join(root, 'tests', 'fixtures', corpus);
  const expected = JSON.parse(readFileSync(join(dir, 'expected.json'), 'utf8')) as Record<string, { courses: string[]; negative?: true }>;
  for (const file of readdirSync(dir).filter((n) => n.endsWith('.json') && n !== 'expected.json' && n !== 'sources.json').sort()) {
    const name = file.replace(/\.json$/, '');
    if (only && !name.includes(only)) continue;
    const want = expected[name];
    if (!want || want.negative) continue;
    const parsed = parseExternalTranscript(JSON.parse(readFileSync(join(dir, file), 'utf8')));
    const r = impactOf(`${corpus === 'ms-transcripts' ? 'ms' : 'public'}/${name}`, 'text', want.courses.map(fromExpected), parsed.courses.map(fromParsed), rawMarksOf(parsed.courses));
    if (r) results.push(r);
  }
}
if (ocrRun) {
  const run = ocrRun.startsWith('/') ? ocrRun : join(homedir(), 'degree-audit-samples', 'bench-out', ocrRun);
  const { seeds } = await collectSeeds({ families: ['generator-external', 'generator-scan', 'public-pdf'], quick: false, publicPdfsDir: join(homedir(), 'degree-audit-samples', 'public-pdfs'), fetch: false, renderDir: '/tmp/none', skins: ['mono'], renderDpi: 200 });
  for (const seed of seeds) {
    if (seed.parser !== 'external' || seed.expected.negative) continue;
    if (only && !seed.id.includes(only)) continue;
    for (const level of ['L0', 'L1', 'L2', 'L3', 'L4', 'L5', 'L6-90', 'L6-180', 'L7']) {
      const file = join(run, seed.id, level, 'ocr-lines.json');
      if (!existsSync(file)) continue;
      const saved = JSON.parse(readFileSync(file, 'utf8')) as { lines: { text: string; confidence: number }[] };
      const parsed = parseExternalTranscript(saved.lines.map((l) => l.text), saved.lines.map((l) => l.confidence));
      const r = impactOf(`ocr/${seed.id}`, level, seed.expected.courses.map(fromExpected), parsed.courses.map(fromParsed), rawMarksOf(parsed.courses));
      if (r) results.push(r);
    }
  }
}

// The board: per path, how many documents a reading error changes the check for.
const byPath = new Map<string, Impact[]>();
for (const r of results) byPath.set(r.path, [...(byPath.get(r.path) ?? []), r]);
console.log('path      documents  verdict changed  rows changed  transfer credits off by');
for (const [path, rs] of [...byPath].sort()) {
  const changed = rs.filter((r) => r.verdicts.length > 0);
  const off = rs.reduce((n, r) => n + Math.abs(r.creditsTrue - r.creditsRead), 0);
  console.log(`${path.padEnd(9)} ${String(rs.length).padStart(9)}  ${String(changed.length).padStart(15)}  ${String(rs.reduce((n, r) => n + r.verdicts.length, 0)).padStart(12)}  ${off.toFixed(2).padStart(23)}`);
}
console.log('\nDocuments whose reading changes the check, most impact first:');
for (const r of results.filter((x) => x.verdicts.length > 0 || x.creditsTrue !== x.creditsRead).sort((a, b) => b.verdicts.length - a.verdicts.length || Math.abs(b.creditsTrue - b.creditsRead) - Math.abs(a.creditsTrue - a.creditsRead))) {
  console.log(`  ${r.name} [${r.path}]: ${r.verdicts.length} row(s); transfer credits ${r.creditsTrue} → ${r.creditsRead}`);
  if (only) for (const v of r.verdicts) console.log(`      ${v}`);
}
