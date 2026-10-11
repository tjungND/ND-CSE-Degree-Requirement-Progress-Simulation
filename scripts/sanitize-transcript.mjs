// De-identify a system-generated transcript PDF while keeping its LAYOUT, so
// parser work can be done on it by people who must not see the record.
//
//   node ~/degree-audit-app/scripts/sanitize-transcript.mjs "transcript.pdf" [--out out.pdf] [--seed N] [--keep-titles]
//
// Run it from the folder that holds the transcripts — it finds the repo (and
// node_modules) from its own location. The output is written next to the
// input as sanitized-<seed>.pdf: never under the input's name, which is
// usually the student's (2026-09-05). `npm run sanitize -- "<full path>"` is
// the same thing, but works only from inside the repo folder (npm needs its
// package.json). Quote names with spaces.
//
// Reads the PDF exactly as the app does (pdfjs text runs: text, position,
// width, rotation), de-identifies each run with scripts/sanitize/rules.mjs,
// and writes a NEW PDF with the same page sizes, the same run positions, the
// same run widths (Courier, horizontally scaled to the measured width) and
// the same rotations — so column gaps, merged runs and watermark tiles behave
// the same in the app — but with names, ids, dates, grades, GPA, course
// numbers and titles replaced (see rules.mjs). Years shift by one random
// offset per document. Nothing is uploaded anywhere; the input is not
// modified.
//
// REVIEW BEFORE SHARING: the tool prints every run it kept verbatim
// (structural words, institution names, credit values). Read that list; if
// anything personal appears there, do not share the output — report it so
// the rules can be tightened.
//
//   --words in.json out.json   (used by scripts/sanitize-scan.py) sanitizes
//   OCR words instead of a PDF: in.json = { pages: [{ words: [{ text, x, line }] }] }
//   → out.json = { pages: [{ words: [{ text, changed }] }] }, same rules.
//
// Needs the repo's node_modules (npm install); Node ≥ 22.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createSanitizer } from './sanitize/rules.mjs';
import { sanitizePdf } from './sanitize/pdf-io.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const keepTitles = args.includes('--keep-titles');
if (keepTitles) args.splice(args.indexOf('--keep-titles'), 1);
const seedArg = flag('--seed');
const outArg = flag('--out');
const seed = seedArg !== undefined ? Number(seedArg) : undefined;

if (args[0] === '--words') {
  const [, inPath, outPath] = args;
  if (!inPath || !outPath) usage();
  const input = JSON.parse(readFileSync(inPath, 'utf8'));
  const { findColumnGap, dropWatermarks } = await import(pathToFileURL(join(root, 'src', 'transcript', 'layout.ts')).href);
  // Locate the column gap the way the app does: watermark tiles dropped first.
  const columnGap = (runs, width) => findColumnGap(dropWatermarks(runs), width);
  // OCR words are one run each, so "is this an institution line?" is judged
  // on the whole OCR line (a scan has no separate watermark runs to shield a name).
  const sanitizer = createSanitizer({ seed, keepTitles, columnGap, institutionalByLine: true });
  for (const page of input.pages) {
    // Group by the OCR line id: every word of a line gets the same y, and
    // lines sit 10 apart so the 2-unit line tolerance never merges them.
    const runs = page.words.map((w) => ({ x: w.x, y: -10 * (w.line ?? 0), text: w.text, width: w.width ?? 0 }));
    sanitizer.sanitizeRuns(runs, page.width);
  }
  // Totals that agree with the rows (rules.mjs finish(); item 12, 2026-10-11).
  const final = sanitizer.finish();
  const pages = input.pages.map((page, p) => ({ words: page.words.map((w, i) => ({ text: final[p][i], changed: final[p][i] !== w.text })) }));
  writeFileSync(outPath, JSON.stringify({ seed: sanitizer.seed, yearOffset: sanitizer.yearOffset, pages }, null, 1));
  printReport(sanitizer);
  process.exit(0);
}

const input = args[0];
if (!input || input.startsWith('--')) usage();
const { pdf, sanitizer, pages } = await sanitizePdf(readFileSync(input), { seed, keepTitles });
// The output name never repeats the input name (2026-09-05): transcript files
// are usually named after the student, and a file name travels with the file.
const outPath = outArg ?? join(dirname(input), `sanitized-${sanitizer.seed}.pdf`);
writeFileSync(outPath, pdf);
console.log(`wrote ${outPath} (${pages.length} page${pages.length === 1 ? '' : 's'}) — named after the seed, not the input, so no student name rides along`);
printReport(sanitizer);

function printReport(sanitizer) {
  const r = sanitizer.report();
  console.log(`seed ${sanitizer.seed}, years shifted by ${sanitizer.yearOffset >= 0 ? '+' : ''}${sanitizer.yearOffset}`);
  console.log(`runs: ${r.runs} (changed ${r.changedRuns}, kept verbatim ${r.keptRuns}); words scrambled ${r.scrambledWords}, grades ${r.grades}, e-mails ${r.emails}`);
  console.log(`totals: ${r.totalsRecomputed} line(s) recomputed from the new grades, ${r.totalsRandomized} left random (their rows did not add up to the printed GPA hours); ${r.rowPointsRecomputed} course row(s) given their new grade's points`);
  console.log('\nREVIEW — every run kept verbatim (must be structural or institutional text only):');
  for (const [text, n] of r.keptVerbatim) console.log(`  ${n > 1 ? `×${n} ` : ''}${JSON.stringify(text)}`);
  console.log('\nIf anything personal appears above, do NOT share the output; report the line shape instead.');
}

function usage() {
  console.error('usage: node scripts/sanitize-transcript.mjs transcript.pdf [--out out.pdf] [--seed N] [--keep-titles]\n       node scripts/sanitize-transcript.mjs --words in.json out.json [--seed N] [--keep-titles]');
  process.exit(2);
}
