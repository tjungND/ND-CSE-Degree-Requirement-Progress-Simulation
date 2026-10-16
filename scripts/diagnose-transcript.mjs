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
// names an institution; anything else is masked too. Since 2026-10-15 it
// reads the PDF exactly as the app's pdfjs opens it (and compares the read
// with pdfjs's standard-font folder, the dev tools' read until then), says whether the app reads it as a scanner's text layer, and
// says what the Previous Undergraduate row does with it, with the line INDEX
// of each row read without a final grade (an index into the shapes printed
// below, never the row's text).
//
// Needs the repo's node_modules (npm install) and Node ≥ 22.18 (it imports the
// app's TypeScript directly, like `npm test` does). The pdfjs loop is the
// shared one in scripts/dev/pdf-lines-node.mts (2026-10-09), opened as the
// app opens a PDF (2026-10-15, below).
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/diagnose-transcript.mjs path/to/transcript.pdf');
  process.exit(2);
}

const { pdfToLinesNode, pdfScanPagesNode } = await import(pathToFileURL(join(root, 'scripts', 'dev', 'pdf-lines-node.mts')).href);
const { dropWatermarks, columnLayout } = await import(pathToFileURL(join(root, 'src', 'transcript', 'layout.ts')).href);
const { parseExternalTranscript } = await import(pathToFileURL(join(root, 'src', 'transcript', 'external.ts')).href);
const { parseTranscript } = await import(pathToFileURL(join(root, 'src', 'transcript', 'parse.ts')).href);
const { SCANNER_LAYER_CONFIDENCE } = await import(pathToFileURL(join(root, 'src', 'transcript', 'scanner-layer.ts')).href);
const { noRowsRoute, previewRowOf, undergraduateInProgress } = await import(pathToFileURL(join(root, 'src', 'ui', 'external-upload.ts')).href);

// Every letter of every script (a name in Chinese characters too — review of
// the fix, 2026-10-15) and every digit masked; an invisible control or format
// character shown as ¤, so a glyph one read keeps and the other drops is
// seen; and anything else outside plain ASCII — an accent printed apart, a
// private-use or enclosed letter (Ⓙ) — shown as ? (re-review of the fix).
const mask = (s) =>
  s
    .replace(/\p{L}/gu, (ch) => (/\p{Lu}/u.test(ch) ? 'A' : 'a'))
    .replace(/\p{N}/gu, '9')
    .replace(/[\p{Cc}\p{Cf}]/gu, '¤')
    .replace(/[^\x20-\x7E¤]/gu, '?');
// A phrase naming an institution is shown as printed — only its parts (between
// commas, semicolons or dashes) that name one, their digits masked; the rest
// is masked (2026-10-15: "OFFICIAL COPY" alone no longer shows a phrase, and
// "Jane Q Sample, Example State University" shows the name masked).
const INSTITUTION_RE = /universit|college|institute|school|polytechnic/i;
const showPhrase = (s) =>
  s
    .split(/(\s*[,;|]\s*|\s+[-–—]\s+)/)
    .map((part, i) => (i % 2 === 1 ? part : INSTITUTION_RE.test(part) ? part.replace(/\p{N}/gu, '9') : mask(part)))
    .join('');

// Read as the APP reads it (2026-10-15): src/transcript/pdf.ts opens a PDF
// without pdfjs's standard-font folder, and pdfjs then drops a glyph the font
// cannot show (the review of the fix ran the app's own reader in Chrome and
// WebKit: their lines equal this read). Every page report, count, shape and
// line number below is of this read. Runs in the page's reading orientation,
// exactly as the app takes them (a sideways page is turned upright first —
// 2026-09-05); one structure line per page as each is read.
const pageReports = [];
// The previous page's column layout, as the app passes it (F4, 2026-10-09).
let hint;
// A file pdfjs cannot open is said so, as the app says it (slotRow's catch),
// with no stack trace.
async function readOrSay(read) {
  try {
    return await read();
  } catch (error) {
    console.log(`Previous Undergraduate import: refused: That PDF could not be read (${error?.name ?? 'error'}).`);
    process.exit(0);
  }
}
const allLines = await readOrSay(() => pdfToLinesNode(
  file,
  ({ page: p, runs, width, turned, lines }) => {
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
  },
  { standardFonts: false },
));
console.log(`pages: ${pageReports.length}`);
for (const line of pageReports) console.log(line);

// The read WITH pdfjs's standard-font folder — the dev tools' read until
// 2026-10-15, when they took the app's (scripts/dev/pdf-lines-node.mts), and
// the read the corpora pinned before then: compared line by line, shapes
// only, labelled with the APP's line numbers. A difference is a glyph outside
// its font's encoding, which the folder keeps and the browser drops.
const devLines = await readOrSay(() => pdfToLinesNode(file, undefined, { standardFonts: true }));
// The two reads aligned line by line (a longest common subsequence), so a
// line one read has and the other lacks does not shift every pair after it
// (re-review of the fix): each differing line is shown once, under the app's
// line number.
const n = allLines.length;
const m = devLines.length;
const common = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) common[i][j] = allLines[i] === devLines[j] ? common[i + 1][j + 1] + 1 : Math.max(common[i + 1][j], common[i][j + 1]);
const differing = [];
for (let i = 0, j = 0; i < n || j < m; ) {
  if (i < n && j < m && allLines[i] === devLines[j]) (i += 1), (j += 1);
  else if (j < m && (i >= n || common[i][j + 1] >= common[i + 1][j])) differing.push({ at: i, dev: devLines[j++] });
  else differing.push({ at: i, app: allLines[i++] });
}
const shapeOf = (l) => mask(l).replace(/\s{2,}/g, ' | ').slice(0, 120);
console.log(
  `the read with pdfjs's standard-font folder (the dev tools' read until 2026-10-15): ${differing.length === 0 ? `the same ${n} lines` : `${differing.length} line${differing.length === 1 ? ' differs' : 's differ'} from the app's`}`,
);
for (const d of differing.slice(0, 12)) {
  console.log(d.app !== undefined ? `  line ${d.at}: app only "${shapeOf(d.app)}"` : `  before app line ${d.at}: folder read only "${shapeOf(d.dev)}"`);
}
// A PDF whose every page is one image under invisible text is read OCR-grade
// by the app (src/ui/external-upload.ts), so it is here too.
const hasText = allLines.some((l) => /\S/.test(l));
const scanned = hasText && (await readOrSay(() => pdfScanPagesNode(file))).everyPageScanned;
console.log(`every page a scan under its own text layer (read OCR-grade by the app): ${scanned ? 'yes' : 'no'}`);
const parseAsApp = (lines) => (scanned ? parseExternalTranscript(lines, lines.map(() => SCANNER_LAYER_CONFIDENCE), { scannerLayer: true }) : parseExternalTranscript(lines));
const parsed = parseAsApp(allLines);
console.log(`\nhasTextLayer: ${parsed.hasTextLayer}, looksLikeNotreDame: ${parsed.looksLikeNotreDame}`);
console.log(`university guess: ${parsed.university ? showPhrase(parsed.university) : '(none)'}`);
console.log(`degreeConferred: ${parsed.degreeConferred ?? false}, transfer-block rows skipped: ${parsed.transferRowsSkipped ?? 0}`);
const c = parsed.courses;
console.log(
  `course rows accepted: ${c.length} — with credits ${c.filter((x) => x.credits !== undefined).length}, ` +
    `mapped grade ${c.filter((x) => x.grade).length}, raw grade ${c.filter((x) => !x.grade && x.rawGrade).length}, ` +
    `no grade ${c.filter((x) => !x.grade && !x.rawGrade).length}, with year ${c.filter((x) => x.year).length}, ` +
    `with season ${c.filter((x) => x.season).length}, distinct years ${new Set(c.map((x) => x.year)).size}`,
);
console.log(`code shapes: ${[...new Set(c.map((x) => mask(x.courseId)))].join(', ') || '(none)'}`);

// What the app does with this file in the Previous Undergraduate row
// (2026-10-15): slotRow's checks in its order (src/ui/external-upload.ts) —
// a Notre Dame transcript, not a transcript, no text layer, still in
// progress, no course read — and the line of every row read without a final
// grade: an index into the shapes printed below, never the row's text. A row's
// line is the parser's own on the OCR path; else the next line, in reading
// order, holding the row's title and code (or either), one occurrence per row,
// so a repeated course is matched to its own line.
const rows = c.map((x) => previewRowOf(x, 'bachelors'));
const conferred = parsed.bachelorsConferred === true;
const route = parseTranscript(allLines).isNotreDame
  ? 'refused: a Notre Dame transcript (it belongs in the Notre Dame row)'
  : parsed.notATranscript
    ? 'refused: does not look like a transcript'
    : !parsed.hasTextLayer
      ? 'no text layer: OCR offered'
      : undergraduateInProgress('bachelors', rows, conferred)
        ? 'REFUSED as still in progress'
        : rows.length === 0
          ? noRowsRoute(parsed, scanned) === 'cyrillic-codes'
            ? 'no course read: the Cyrillic-codes message'
            : 'no course read: OCR offered'
          : `the preview opens with the ${rows.length} rows read`;
// A row's line: the parser's own on the OCR path; else the next line, in
// reading order from the previous row's, where the row's title is a whole
// cell (or starts one, after its code) and its code stands at cell
// boundaries — "CS 101" is not "CS 1010", "College Physics" not "College
// Physics Experiment" — a line holding the same course twice (two semesters
// side by side) matched once for each (re-review of the fix).
const escapeRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const usedOnLine = new Map();
let cursor = 0;
const lineOfRow = c.map((x) => {
  if (x.sourceLines) return (cursor = x.sourceLines.from);
  const title = (x.title ?? '').trim();
  const codeParts = x.courseId.split(/[\s:.-]+/).filter(Boolean);
  const codeRe = codeParts.length ? new RegExp(`(?<![A-Za-z0-9])${codeParts.map(escapeRe).join('[\\s:.-]*')}(?![A-Za-z0-9])`, 'g') : undefined;
  const key = `${title}|${x.courseId}`;
  // How many times the line holds the row: its title as a whole cell, or
  // its code where there is no title.
  const timesIn = (line) => {
    const cells = line.trim().split(/\s{2,}/);
    const titled = title === '' ? 0 : cells.filter((cell) => cell === title || (codeRe !== undefined && cell.replace(codeRe, '').trim() === title)).length;
    const coded = codeRe === undefined ? 0 : (line.match(codeRe) ?? []).length;
    return title !== '' && codeRe !== undefined ? Math.min(titled, coded) || 0 : title !== '' ? titled : coded;
  };
  // …else, for a row read from two lines (its title above or below), the
  // code at its boundaries alone, or the title anywhere in the line.
  const looselyIn = (line) => ((codeRe !== undefined && (line.match(codeRe) ?? []).length > 0) || (title !== '' && line.includes(title)) ? 1 : 0);
  const find = (times, from) => {
    for (let i = from; i < allLines.length; i++) {
      const used = usedOnLine.get(`${i}|${key}`) ?? 0;
      if (times(allLines[i]) > used) return i;
    }
    return -1;
  };
  let at = find(timesIn, cursor);
  if (at < 0) at = find(timesIn, 0);
  if (at < 0) at = find(looselyIn, cursor);
  if (at < 0) at = find(looselyIn, 0);
  if (at >= 0) {
    usedOnLine.set(`${at}|${key}`, (usedOnLine.get(`${at}|${key}`) ?? 0) + 1);
    cursor = at;
  }
  return at;
});
const open = c.map((_, i) => i).filter((i) => undergraduateInProgress('bachelors', [rows[i]]));
console.log(
  `Previous Undergraduate import: ${route}; bachelor's degree read as conferred: ${conferred ? 'yes' : 'no'}; ` +
    `rows without a final grade: ${open.length}${open.length ? ` (at lines ${open.map((i) => lineOfRow[i]).join(', ')})` : ''}`,
);
if (differing.length > 0) {
  const dev = parseAsApp(devLines);
  console.log(`…on the read with the folder: course rows accepted ${dev.courses.length}, transfer-block rows skipped ${dev.transferRowsSkipped ?? 0}, bachelor's degree read as conferred: ${dev.bachelorsConferred ? 'yes' : 'no'}`);
}

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
