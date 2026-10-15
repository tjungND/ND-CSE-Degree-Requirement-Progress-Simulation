// Diagnose how a transcript PDF reads — WITHOUT revealing what is in it.
//
//   node scripts/diagnose-transcript.mjs path/to/transcript.pdf
//
// Runs the app's own extraction (pdfjs → src/transcript/layout.ts → the
// external-transcript parser) locally, exactly as the browser does, and prints
// only STRUCTURE: per-page run counts, how many runs were dropped as
// watermarks, whether a page was read as two columns, how many course rows
// the parser accepted, and every line's SHAPE with letters replaced by a/A and
// digits by 9 ("COMPSCI 501  Formal Language Theory  3.00 A" becomes
// "AAAAAAA 999  Aaaaaa Aaaaaaaa Aaaaaa  9.99 A"). No name, id, course, title,
// grade or date survives, so the output can be shared with whoever maintains
// the parser (FERPA). A tiled watermark phrase is shown verbatim only when it
// names an institution; anything else is masked too.
//
// Needs the repo's node_modules (npm install) and Node ≥ 22.18 (it imports the
// app's TypeScript directly, like `npm test` does). The pdfjs loop is the
// shared one in scripts/dev/pdf-lines-node.mts (2026-10-09), so this reads a
// page exactly as the replay and pdf-to-lines.mts do.
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/diagnose-transcript.mjs path/to/transcript.pdf');
  process.exit(2);
}

const { pdfToLinesNode } = await import(pathToFileURL(join(root, 'scripts', 'dev', 'pdf-lines-node.mts')).href);
const { dropWatermarks, columnLayout } = await import(pathToFileURL(join(root, 'src', 'transcript', 'layout.ts')).href);
const { parseExternalTranscript } = await import(pathToFileURL(join(root, 'src', 'transcript', 'external.ts')).href);
const { parseTranscript } = await import(pathToFileURL(join(root, 'src', 'transcript', 'parse.ts')).href);

const mask = (s) => s.replace(/[A-Z]/g, 'A').replace(/[a-z]/g, 'a').replace(/\d/g, '9');
const INSTITUTION_RE = /universit|college|institute|school|polytechnic|official|unofficial|copy/i;
const showPhrase = (s) => (INSTITUTION_RE.test(s) ? s : mask(s));

// Runs in the page's reading orientation, exactly as the app takes them (a
// sideways page is turned upright first — 2026-09-05); one structure line per
// page as each is read.
const pageReports = [];
// The previous page's column layout, as the app passes it (F4, 2026-10-09).
let hint;
const allLines = await pdfToLinesNode(file, ({ page: p, runs, width, turned, lines }) => {
  const kept = dropWatermarks(runs);
  const rotated = runs.filter((r) => r.rotated).length;
  const dropped = runs.filter((r) => !r.rotated && !kept.includes(r));
  const phrases = [...new Set(dropped.map((r) => r.text.replace(/\s+/g, ' ').trim()))].map(showPhrase);
  const layout = columnLayout(kept, width, hint);
  hint = layout.hint;
  const columns = layout.columns.length;
  pageReports.push(
    `page ${p}: width ${width.toFixed(0)}${turned ? ' (page turned upright)' : ''}, runs ${runs.length}, rotated ${rotated}, watermark runs dropped ${dropped.length}` +
      (phrases.length ? ` (${phrases.map((s) => JSON.stringify(s)).join(', ')})` : '') +
      `, read as ${columns} column${columns === 1 ? '' : 's'}, ${lines.length} lines`,
  );
});
console.log(`pages: ${pageReports.length}`);
for (const line of pageReports) console.log(line);

const parsed = parseExternalTranscript(allLines);
console.log(`\nhasTextLayer: ${parsed.hasTextLayer}, looksLikeNotreDame: ${parsed.looksLikeNotreDame}`);
console.log(`university guess: ${parsed.university ? (INSTITUTION_RE.test(parsed.university) ? parsed.university : mask(parsed.university)) : '(none)'}`);
console.log(`degreeConferred: ${parsed.degreeConferred ?? false}, transfer-block rows skipped: ${parsed.transferRowsSkipped ?? 0}`);
const c = parsed.courses;
console.log(
  `course rows accepted: ${c.length} — with credits ${c.filter((x) => x.credits !== undefined).length}, ` +
    `mapped grade ${c.filter((x) => x.grade).length}, raw grade ${c.filter((x) => !x.grade && x.rawGrade).length}, ` +
    `no grade ${c.filter((x) => !x.grade && !x.rawGrade).length}, with year ${c.filter((x) => x.year).length}, ` +
    `with season ${c.filter((x) => x.season).length}, distinct years ${new Set(c.map((x) => x.year)).size}`,
);
console.log(`code shapes: ${[...new Set(c.map((x) => mask(x.courseId)))].join(', ') || '(none)'}`);

// The Notre Dame reader's own verdict (2026-10-14: a Parchment-delivered
// Notre Dame transcript of a new student read no course — "no course lines
// could be read"): its rows by kind, whether it read a GPA, the rows' levels,
// the degrees it read, and its warnings as COUNTS per kind — a warning names
// courses and grade codes, so its text is never printed (review of the fix,
// 2026-10-14); an unknown kind is counted, never shown.
const nd = parseTranscript(allLines);
const ndRows = nd.courses;
const count = (pred) => ndRows.filter(pred).length;
console.log(
  `\nNotre Dame reader: isNotreDame ${nd.isNotreDame}, rows read ${ndRows.length} ` +
    `(in progress ${count((x) => x.grade === 'IP')}, graded ${count((x) => x.grade !== 'IP')}; Notre Dame ${count((x) => x.origin === 'nd')}, transfer ${count((x) => x.origin === 'transfer')}; ` +
    `graduate ${count((x) => x.level === 'graduate')}, undergraduate ${count((x) => x.level === 'undergraduate')}, level unknown ${count((x) => x.level === undefined)}), ` +
    `terms ${new Set(ndRows.map((x) => `${x.term.season} ${x.term.year}`)).size}, entry term read ${nd.entryTerm ? 'yes' : 'no'}, ` +
    `GPA read ${nd.cumulativeGpa !== undefined ? 'yes' : 'no'}, degrees awarded read ${nd.degreesAwarded.length}`,
);
const ids = (w) => (w.match(/\b[A-Z]{2,5} \d{5}\b/g) ?? []).length;
const kinds = { 'rows skipped for no grade': 0, 'not reported (NR)': 0, 'before any term header': 0, other: 0 };
for (const w of nd.warnings) {
  if (/^Skipped \(no grade shown\):/.test(w)) kinds['rows skipped for no grade'] += ids(w);
  else if (/^Grade not reported yet \(NR\):/.test(w)) kinds['not reported (NR)'] += ids(w);
  else if (/appeared before any term header/.test(w)) kinds['before any term header'] += ids(w) || 1;
  else kinds.other += 1;
}
console.log(`  warnings: ${Object.entries(kinds).map(([k, n]) => `${k} ${n}`).join(', ')}`);

console.log('\nline shapes in reading order (letters→a/A, digits→9; "|" marks a column gap):');
for (const [i, line] of allLines.entries()) {
  const shape = mask(line).replace(/\s{2,}/g, ' | ');
  console.log(`${String(i).padStart(4)} ${shape.slice(0, 120)}`);
}
