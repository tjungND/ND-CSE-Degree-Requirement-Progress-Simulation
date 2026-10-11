// Replay: score every pinned transcript fixture — and any sample PDFs kept
// outside the repo — through the current parser, and print a scoreboard
// (2026-10-09, transcript accuracy program, Batch A). The numbers come from
// scripts/dev/score.mts (one scorer, pinned by tests/replay-score.test.ts), so
// "exact" here is exactly the corpus tests' pass/fail, and the rest says how
// far off each document is.
//
//   npm run replay                                   # the three line-list corpora + the PDF folder
//   npm run replay -- --corpus nd                    # the Notre Dame corpus alone (2026-10-11)
//   npm run replay -- --corpus public --only cairo   # one corpus, names containing "cairo", full diffs
//   npm run replay -- --out before.json              # save the numbers …
//   npm run replay -- --baseline before.json         # … and show what changed (regressions first)
//   npm run replay -- --pdfs ~/x/pdfs --verify       # score a folder of PDFs, checking their hashes
//
// Options
//   --corpus public|ms|nd|all  which line-list corpus (default all). `nd` (DGS 2026-10-11, item 12)
//                            is tests/fixtures/nd-transcripts/, read by the Notre Dame parser
//                            (src/transcript/parse.ts) and scored by scripts/dev/score-nd.mts: rows,
//                            title, credits, grade, term and UG/GR level as for the others, plus
//                            isNotreDame, the cumulative GPA and each level's, the entry term and the
//                            degrees awarded
//   --pdfs <dir>             a folder of PDFs to read with the app's own layout stage
//                            (default $TRANSCRIPT_SAMPLES/public-pdfs, else ~/degree-audit-samples/
//                            public-pdfs; skipped with a note when absent). A PDF is scored against
//                            <dir>/expected.json when pinned there, else against the public corpus's
//                            expectation of the same name (a re-downloaded registrar PDF), else
//                            printed as "unpinned (rows read: N)". An expectation with
//                            `isNotreDame: true` is read by the Notre Dame parser and scored like
//                            the nd corpus — a sanitized Notre Dame transcript kept outside the repo.
//   --verify                 check each PDF's SHA-256 and byte size against sources.json's pdf entry
//                            of the fixture with the same name
//   --only <substring>       only documents whose name contains it; prints their full diffs
//   --out <file.json>        write every document's numbers and the boards (counts only — no text)
//   --baseline <file.json>   compare with an earlier --out file; regressions first; exit code 1 if any
//   --quiet                  boards only, no per-document lines
//
// The scoreboard, per corpus and (public corpus) per sources.json lens and
// country: fixtures exact; row recall (matched / expected rows, positives) and
// precision (matched / parsed rows, positives); cell accuracy per field over
// the matched rows; false rows on negatives (rows read from a key, legend or
// form, which must read none); the known-failing list's status (a fixture on
// tests/fixtures/public-transcripts-known-failing.json must still fail until
// its DGS decision lands — the test enforces it, the board shows it).
//
// FERPA: the line-list corpora are public or synthetic. The PDF folder is
// whatever the maintainer keeps outside the repo; this prints a PDF's NAME
// and numbers, never its text (--only prints the scorer's diffs, which quote
// rows — use it on public documents). The --out file holds counts only.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseExternalTranscript } from '../../src/transcript/external.ts';
import { parseTranscript } from '../../src/transcript/parse.ts';
import { ND_FIELDS, scoreNdDocument, type ExpectedNdDocument, type NdField, type NdScore } from './score-nd.mts';
import { pdfToLinesNode } from './pdf-lines-node.mts';
import { CELL_FIELDS, scoreDocument, type CellField, type ExpectedDocument, type Score } from './score.mts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PUBLIC_DIR = join(root, 'tests', 'fixtures', 'public-transcripts');
const MS_DIR = join(root, 'tests', 'fixtures', 'ms-transcripts');
const ND_DIR = join(root, 'tests', 'fixtures', 'nd-transcripts');
const KNOWN_FAILING_FILE = join(root, 'tests', 'fixtures', 'public-transcripts-known-failing.json');

type Corpus = 'public' | 'ms' | 'nd' | 'pdfs';

interface Options {
  corpus: 'public' | 'ms' | 'nd' | 'all';
  pdfs: string | undefined;
  pdfsExplicit: boolean;
  verify: boolean;
  only: string | undefined;
  out: string | undefined;
  baseline: string | undefined;
  quiet: boolean;
}

/** One scored document. */
interface Doc {
  corpus: Corpus;
  name: string;
  lens?: string;
  country?: string;
  /** The gap ids it waits on (public corpus, known-failing list). */
  known?: string[];
  score: Score;
  /** PDF lane: where its expectation came from, and the hash check. */
  pinnedIn?: 'folder' | 'public corpus';
  verify?: string;
  /** A Notre Dame document: its own fields, right or wrong (score-nd.mts). */
  nd?: NdScore['nd'];
}

/** The numbers kept per document in --out (counts only). */
interface DocRecord {
  corpus: Corpus;
  name: string;
  lens?: string;
  country?: string;
  known?: string[];
  negative: boolean;
  exact: boolean;
  rows: { expectedRows: number; parsedRows: number; matched: number; missing: number; extra: number };
  cells: Record<CellField, { right: number; total: number }>;
  /** Notre Dame documents: each scored field, right or not. */
  nd?: Partial<Record<NdField, boolean>>;
}

interface Board {
  fixtures: number;
  positives: number;
  negatives: number;
  exact: number;
  knownFailing: number;
  knownStillFailing: number;
  knownNowPassing: number;
  /** Positives only. */
  expectedRows: number;
  parsedRows: number;
  matched: number;
  /** Negatives: rows read where none may be. */
  falseRows: number;
  negativesWithFalseRows: number;
  cells: Record<CellField, { right: number; total: number }>;
}

interface OutFile {
  generatedAt: string;
  args: string[];
  boards: Record<string, Board>;
  documents: Record<string, DocRecord>;
}

function parseArgs(argv: string[]): Options {
  const o: Options = { corpus: 'all', pdfs: undefined, pdfsExplicit: false, verify: false, only: undefined, out: undefined, baseline: undefined, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === '--corpus') {
      const v = next();
      if (v !== 'public' && v !== 'ms' && v !== 'nd' && v !== 'all') throw new Error(`--corpus public|ms|nd|all, not ${v}`);
      o.corpus = v;
    } else if (a === '--pdfs') {
      o.pdfs = resolve(next());
      o.pdfsExplicit = true;
    } else if (a === '--verify') o.verify = true;
    else if (a === '--only') o.only = next();
    else if (a === '--out') o.out = resolve(next());
    else if (a === '--baseline') o.baseline = resolve(next());
    else if (a === '--quiet') o.quiet = true;
    else throw new Error(`unknown option ${a} (see the header of scripts/dev/replay.mts)`);
  }
  if (o.pdfs === undefined) o.pdfs = join(process.env['TRANSCRIPT_SAMPLES'] ?? join(homedir(), 'degree-audit-samples'), 'public-pdfs');
  return o;
}

const readJson = <T,>(file: string): T => JSON.parse(readFileSync(file, 'utf8')) as T;

/** The line-list fixtures of one corpus, scored. */
function scoreCorpus(corpus: 'public' | 'ms', only: string | undefined): Doc[] {
  const dir = corpus === 'public' ? PUBLIC_DIR : MS_DIR;
  const expected = readJson<Record<string, ExpectedDocument>>(join(dir, 'expected.json'));
  const sources = corpus === 'public' ? readJson<Record<string, { lens?: string; country?: string }>>(join(dir, 'sources.json')) : {};
  const known = corpus === 'public' ? readJson<Record<string, string[]>>(KNOWN_FAILING_FILE) : {};
  const docs: Doc[] = [];
  for (const file of readdirSync(dir).filter((n) => n.endsWith('.json') && n !== 'expected.json' && n !== 'sources.json').sort()) {
    const name = file.replace(/\.json$/, '');
    if (only !== undefined && !name.includes(only)) continue;
    const want = expected[name];
    if (want === undefined) throw new Error(`${corpus}/${name} has no expected.json entry`);
    const parsed = parseExternalTranscript(readJson<string[]>(join(dir, file)));
    const doc: Doc = { corpus, name, score: scoreDocument(parsed, want) };
    const src = sources[name];
    if (src?.lens !== undefined) doc.lens = src.lens;
    if (src?.country !== undefined) doc.country = src.country;
    if (known[name] !== undefined) doc.known = known[name];
    docs.push(doc);
  }
  return docs;
}

/** The Notre Dame corpus (DGS 2026-10-11, item 12), read by the Notre Dame parser. */
function scoreNdCorpus(only: string | undefined): Doc[] {
  const expected = readJson<Record<string, ExpectedNdDocument>>(join(ND_DIR, 'expected.json'));
  const docs: Doc[] = [];
  for (const file of readdirSync(ND_DIR).filter((n) => n.endsWith('.json') && n !== 'expected.json').sort()) {
    const name = file.replace(/\.json$/, '');
    if (only !== undefined && !name.includes(only)) continue;
    const want = expected[name];
    if (want === undefined) throw new Error(`nd/${name} has no expected.json entry`);
    const score = scoreNdDocument(parseTranscript(readJson<string[]>(join(ND_DIR, file))), want);
    docs.push({ corpus: 'nd', name, score, nd: score.nd });
  }
  return docs;
}

/** One line per Notre Dame field: right / scored, over the documents given. */
function ndFieldLine(docs: Doc[]): string | undefined {
  const withNd = docs.filter((d) => d.nd !== undefined);
  if (withNd.length === 0) return undefined;
  const parts = ND_FIELDS.map((f) => {
    const scored = withNd.filter((d) => d.nd![f] !== undefined);
    return scored.length === 0 ? undefined : `${f} ${scored.filter((d) => d.nd![f]!.ok).length}/${scored.length}`;
  }).filter((x): x is string => x !== undefined);
  return `  fields ${parts.join('   ')}`;
}

/** The PDFs of the outside folder, read with the app's layout stage; scored
 * where an expectation exists. Returns the scored ones and notes for the rest. */
async function scorePdfs(dir: string, only: string | undefined, verify: boolean): Promise<{ docs: Doc[]; notes: string[] }> {
  const notes: string[] = [];
  const docs: Doc[] = [];
  const files = readdirSync(dir).filter((n) => /\.pdf$/i.test(n)).sort();
  const folderExpected = existsSync(join(dir, 'expected.json')) ? readJson<Record<string, ExpectedDocument>>(join(dir, 'expected.json')) : {};
  const publicExpected = readJson<Record<string, ExpectedDocument>>(join(PUBLIC_DIR, 'expected.json'));
  const sources = readJson<Record<string, { pdf?: { sha256: string; bytes: number } }>>(join(PUBLIC_DIR, 'sources.json'));
  for (const file of files) {
    const name = file.replace(/\.pdf$/i, '');
    if (only !== undefined && !name.includes(only)) continue;
    const path = join(dir, file);
    let verifyNote: string | undefined;
    if (verify) {
      const pinned = sources[name]?.pdf;
      if (pinned === undefined) verifyNote = 'not a pinned PDF (no sources.json pdf entry of this name)';
      else {
        const bytes = statSync(path).size;
        const sha256 = createHash('sha256').update(readFileSync(path)).digest('hex');
        verifyNote = sha256 === pinned.sha256 && bytes === pinned.bytes ? 'hash ok' : `HASH MISMATCH (sha256 ${sha256.slice(0, 12)}…, ${bytes} bytes; pinned ${pinned.sha256.slice(0, 12)}…, ${pinned.bytes} bytes)`;
      }
    }
    const lines = await pdfToLinesNode(path);
    const want = folderExpected[name] ?? publicExpected[name];
    // A Notre Dame transcript (its expectation says so) goes through the Notre
    // Dame parser, as the app's Notre Dame row would read it (item 12).
    if ((want as ExpectedNdDocument & { isNotreDame?: boolean } | undefined)?.isNotreDame === true) {
      const score = scoreNdDocument(parseTranscript(lines), want as unknown as ExpectedNdDocument);
      const doc: Doc = { corpus: 'pdfs', name, score, nd: score.nd, pinnedIn: 'folder' };
      if (verifyNote !== undefined) doc.verify = verifyNote;
      docs.push(doc);
      continue;
    }
    const parsed = parseExternalTranscript(lines);
    if (want === undefined) {
      notes.push(`  ${name}: unpinned (rows read: ${parsed.courses.length})${verifyNote ? ` — ${verifyNote}` : ''}`);
      continue;
    }
    const doc: Doc = { corpus: 'pdfs', name, score: scoreDocument(parsed, want), pinnedIn: folderExpected[name] ? 'folder' : 'public corpus' };
    if (verifyNote !== undefined) doc.verify = verifyNote;
    docs.push(doc);
  }
  if (files.length === 0) notes.push(`  (no PDFs in ${dir})`);
  return { docs, notes };
}

const emptyCells = (): Record<CellField, { right: number; total: number }> => Object.fromEntries(CELL_FIELDS.map((f) => [f, { right: 0, total: 0 }])) as Record<CellField, { right: number; total: number }>;

function aggregate(docs: Doc[]): Board {
  const b: Board = { fixtures: 0, positives: 0, negatives: 0, exact: 0, knownFailing: 0, knownStillFailing: 0, knownNowPassing: 0, expectedRows: 0, parsedRows: 0, matched: 0, falseRows: 0, negativesWithFalseRows: 0, cells: emptyCells() };
  for (const d of docs) {
    const s = d.score;
    b.fixtures += 1;
    if (s.exact) b.exact += 1;
    if (d.known) {
      b.knownFailing += 1;
      if (s.exact) b.knownNowPassing += 1;
      else b.knownStillFailing += 1;
    }
    if (s.negative) {
      b.negatives += 1;
      b.falseRows += s.rows.parsedRows;
      if (s.rows.parsedRows > 0) b.negativesWithFalseRows += 1;
    } else {
      b.positives += 1;
      b.expectedRows += s.rows.expectedRows;
      b.parsedRows += s.rows.parsedRows;
      b.matched += s.rows.matched;
      for (const f of CELL_FIELDS) {
        b.cells[f].right += s.cells[f].right;
        b.cells[f].total += s.cells[f].total;
      }
    }
  }
  return b;
}

const pct = (n: number, d: number): string => (d === 0 ? '—' : `${((100 * n) / d).toFixed(1)}%`);
const ratio = (n: number, d: number): string => `${n}/${d} (${pct(n, d)})`;

function boardLines(label: string, b: Board, opts: { known: boolean }): string[] {
  const out: string[] = [];
  out.push(`== ${label}: ${b.fixtures} ${b.fixtures === 1 ? 'document' : 'documents'} (${b.positives} positive, ${b.negatives} negative) ==`);
  let exactLine = `  exact ${ratio(b.exact, b.fixtures)}`;
  if (opts.known) {
    // The test's view: every fixture off the list must pass, every one on it must still fail.
    const testPasses = b.exact + b.knownStillFailing === b.fixtures && b.knownNowPassing === 0;
    exactLine += `   known-failing ${b.knownFailing} (${b.knownStillFailing} still failing, ${b.knownNowPassing} now passing)   test: ${testPasses ? 'passes' : 'FAILS'}`;
  }
  out.push(exactLine);
  out.push(`  rows   recall ${ratio(b.matched, b.expectedRows)}   precision ${ratio(b.matched, b.parsedRows)}   false rows on negatives ${b.falseRows} (in ${b.negativesWithFalseRows}/${b.negatives})`);
  out.push(`  cells  ${CELL_FIELDS.map((f) => `${f} ${pct(b.cells[f].right, b.cells[f].total)}`).join('   ')}   (over ${b.matched} matched rows)`);
  return out;
}

/** Group a corpus's documents by a sources.json facet and summarise each group on one line. */
function facetLines(docs: Doc[], facet: 'lens' | 'country'): string[] {
  const groups = new Map<string, Doc[]>();
  for (const d of docs) {
    const key = d[facet];
    if (key === undefined) continue;
    groups.set(key, [...(groups.get(key) ?? []), d]);
  }
  if (groups.size === 0) return [];
  const width = Math.max(...[...groups.keys()].map((k) => k.length));
  const out = [`  by ${facet}:`];
  for (const [key, group] of [...groups].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const b = aggregate(group);
    out.push(`    ${key.padEnd(width)}  exact ${String(b.exact).padStart(3)}/${String(b.fixtures).padEnd(3)}  recall ${pct(b.matched, b.expectedRows).padStart(6)}  precision ${pct(b.matched, b.parsedRows).padStart(6)}  false rows ${b.falseRows}${b.knownStillFailing ? `  (${b.knownStillFailing} known-failing)` : ''}`);
  }
  return out;
}

const docKey = (d: { corpus: Corpus; name: string }): string => `${d.corpus}/${d.name}`;

function toRecord(d: Doc): DocRecord {
  const r: DocRecord = {
    corpus: d.corpus,
    name: d.name,
    negative: d.score.negative,
    exact: d.score.exact,
    rows: { expectedRows: d.score.rows.expectedRows, parsedRows: d.score.rows.parsedRows, matched: d.score.rows.matched, missing: d.score.rows.missing.length, extra: d.score.rows.extra.length },
    cells: d.score.cells,
  };
  if (d.lens !== undefined) r.lens = d.lens;
  if (d.country !== undefined) r.country = d.country;
  if (d.known !== undefined) r.known = d.known;
  if (d.nd !== undefined) r.nd = Object.fromEntries(Object.entries(d.nd).map(([f, s]) => [f, s!.ok]));
  return r;
}

/** What changed since a baseline --out file: per document, regressions first. */
function deltaLines(baseline: OutFile, current: OutFile): { lines: string[]; regressions: number } {
  const regressions: string[] = [];
  const improvements: string[] = [];
  const only: string[] = [];
  for (const [key, now] of Object.entries(current.documents)) {
    const was = baseline.documents[key];
    if (was === undefined) {
      only.push(`  ${key}: new (not in the baseline)`);
      continue;
    }
    const worse: string[] = [];
    const better: string[] = [];
    const change = (label: string, a: number, b: number, higherIsBetter: boolean) => {
      if (a === b) return;
      (higherIsBetter === b > a ? better : worse).push(`${label} ${a} → ${b}`);
    };
    if (was.exact !== now.exact) (now.exact ? better : worse).push(`exact ${was.exact} → ${now.exact}`);
    change('matched', was.rows.matched, now.rows.matched, true);
    change('missing', was.rows.missing, now.rows.missing, false);
    change(now.negative ? 'false rows' : 'extra', was.rows.extra, now.rows.extra, false);
    for (const f of CELL_FIELDS) change(`${f} cells right`, was.cells[f].right, now.cells[f].right, true);
    if (worse.length) regressions.push(`  ${key}: ${[...worse, ...better].join('; ')}`);
    else if (better.length) improvements.push(`  ${key}: ${better.join('; ')}`);
  }
  for (const key of Object.keys(baseline.documents)) if (!(key in current.documents)) only.push(`  ${key}: in the baseline only`);
  const lines: string[] = [];
  lines.push(`REGRESSIONS (${regressions.length})${regressions.length ? ':' : ''}`, ...regressions);
  lines.push(`IMPROVEMENTS (${improvements.length})${improvements.length ? ':' : ''}`, ...improvements);
  if (only.length) lines.push('NOT COMPARABLE:', ...only);
  for (const [label, now] of Object.entries(current.boards)) {
    const was = baseline.boards[label];
    if (was === undefined) continue;
    const parts: string[] = [];
    if (was.exact !== now.exact) parts.push(`exact ${was.exact} → ${now.exact} of ${now.fixtures}`);
    if (was.matched !== now.matched || was.expectedRows !== now.expectedRows) parts.push(`recall ${pct(was.matched, was.expectedRows)} → ${pct(now.matched, now.expectedRows)}`);
    if (was.matched !== now.matched || was.parsedRows !== now.parsedRows) parts.push(`precision ${pct(was.matched, was.parsedRows)} → ${pct(now.matched, now.parsedRows)}`);
    if (was.falseRows !== now.falseRows) parts.push(`false rows ${was.falseRows} → ${now.falseRows}`);
    for (const f of CELL_FIELDS) if (was.cells[f].right !== now.cells[f].right || was.cells[f].total !== now.cells[f].total) parts.push(`${f} ${pct(was.cells[f].right, was.cells[f].total)} → ${pct(now.cells[f].right, now.cells[f].total)}`);
    if (parts.length) lines.push(`  board ${label}: ${parts.join('; ')}`);
  }
  return { lines, regressions: regressions.length };
}

/** Run the replay with command-line arguments; returns the exit code. */
export async function runReplay(argv: string[]): Promise<number> {
  const o = parseArgs(argv);
  const say = (s = '') => console.log(s);
  const docsByCorpus = new Map<string, Doc[]>();
  const corpora: ('public' | 'ms' | 'nd')[] = o.corpus === 'all' ? ['public', 'ms', 'nd'] : [o.corpus];
  for (const c of corpora) docsByCorpus.set(c, c === 'nd' ? scoreNdCorpus(o.only) : scoreCorpus(c, o.only));

  const pdfNotes: string[] = [];
  if (o.corpus === 'all' || o.pdfsExplicit) {
    if (o.pdfs !== undefined && existsSync(o.pdfs) && statSync(o.pdfs).isDirectory()) {
      const { docs, notes } = await scorePdfs(o.pdfs, o.only, o.verify);
      docsByCorpus.set('pdfs', docs);
      pdfNotes.push(...notes);
    } else {
      pdfNotes.push(`  (no PDF folder at ${o.pdfs} — skipped; set TRANSCRIPT_SAMPLES or pass --pdfs <dir>)`);
    }
  }

  // Per-document lines: failures (and known-failing fixtures that now pass).
  if (!o.quiet) {
    for (const [corpus, docs] of docsByCorpus) {
      for (const d of docs) {
        const s = d.score;
        const tag = d.known ? ` (${d.known.join(', ')})` : '';
        const pdfTag = d.corpus === 'pdfs' ? ` [pinned in the ${d.pinnedIn}${d.verify ? `; ${d.verify}` : ''}]` : '';
        if (s.exact) {
          if (o.only !== undefined || d.known || d.corpus === 'pdfs') say(`PASS ${corpus}/${d.name}${tag}${d.known ? '   (still on the known-failing list — remove it)' : ''}${pdfTag}`);
          continue;
        }
        const where = s.negative ? `${s.rows.parsedRows} false row${s.rows.parsedRows === 1 ? '' : 's'}` : `matched ${s.rows.matched}/${s.rows.expectedRows}, missing ${s.rows.missing.length}, extra ${s.rows.extra.length}`;
        say(`FAIL ${corpus}/${d.name}${tag} — ${s.diffs.length} diffs; ${where}${pdfTag}`);
        const shown = o.only !== undefined ? s.diffs : s.diffs.slice(0, 3);
        for (const diff of shown) say('   ' + (o.only !== undefined ? diff : diff.split('\n')[0]));
      }
    }
    if (pdfNotes.length) {
      say('PDF folder:');
      for (const n of pdfNotes) say(n);
    }
    say();
  }

  // Boards.
  const boards: Record<string, Board> = {};
  for (const [corpus, docs] of docsByCorpus) {
    if (docs.length === 0 && corpus === 'pdfs') continue;
    const b = aggregate(docs);
    boards[corpus] = b;
    for (const line of boardLines(corpus, b, { known: corpus === 'public' })) say(line);
    const nd = ndFieldLine(docs);
    if (nd !== undefined) say(nd);
    if (corpus === 'public') {
      for (const line of facetLines(docs, 'lens')) say(line);
      for (const line of facetLines(docs, 'country')) say(line);
    }
    say();
  }

  const current: OutFile = { generatedAt: new Date().toISOString(), args: argv, boards, documents: {} };
  for (const docs of docsByCorpus.values()) for (const d of docs) current.documents[docKey(d)] = toRecord(d);
  if (o.out !== undefined) {
    mkdirSync(dirname(o.out), { recursive: true });
    writeFileSync(o.out, JSON.stringify(current, null, 1));
    say(`wrote ${o.out}`);
  }

  let code = 0;
  if (o.baseline !== undefined) {
    const baseline = readJson<OutFile>(o.baseline);
    const { lines, regressions } = deltaLines(baseline, current);
    say(`== deltas vs ${basename(o.baseline)} (${baseline.generatedAt}) ==`);
    for (const line of lines) say(line);
    if (regressions > 0) code = 1;
  }
  return code;
}

// Run when invoked directly (`npm run replay`, `node --experimental-strip-types
// scripts/dev/replay.mts`); public-status.mts imports runReplay instead.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await runReplay(process.argv.slice(2));
}
