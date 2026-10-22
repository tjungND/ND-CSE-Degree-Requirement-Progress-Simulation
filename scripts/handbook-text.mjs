// The CSE Graduate Studies Handbook's text, section by section, for the
// "CSE §4.2" chips that show the handbook's own words on hover (DGS
// 2026-10-05: "when the cursor hovers over the section of CSE handbook …,
// show its relevant texts").
//
//   npm run handbook-text
//
// Reads policy-sources/CSE-Graduate-Handbook-live.pdf with pdfjs (the app's
// own PDF library — no other tool needed) and writes TWO files (blue-team
// review 2026-10-17, W2 — before it, every visit downloaded the whole text):
//   src/ui/handbook-text.ts   — HANDBOOK_SOURCE (the PDF's edition and SHA-256,
//                               for the stamp) and HANDBOOK_INDEX (section ids
//                               and titles, ~1 KB, for the chips themselves);
//   public/handbook-text.json — the sections with their paragraphs, served
//                               as-is beside the pages and fetched the first
//                               time a chip is hovered, focused or pressed.
// Run it whenever the DGS replaces that PDF with a new edition, and commit
// both files: tests/handbook-text.test.ts fails while either generated file
// and the PDF disagree (it compares the PDF's SHA-256 with each).
//
// How the text is read: a heading is a line set in the handbook's heading
// sizes (14–18 pt bold; body text is 11–12 pt), numbered "4.4.1"; a heading
// line without a number continues the title above it (§3.5's title wraps).
// Text items on a line are joined by their actual gaps — the ligatures "fi" /
// "fl" are separate items flush against their neighbours, so "speci" + "fi" +
// "c" reads "specific", not "speci fi c". A paragraph ends at a wider vertical
// gap; a list item ("●", "1.", "(ii)") starts one of its own. The appendices
// (the forms) are left out.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PDF = 'policy-sources/CSE-Graduate-Handbook-live.pdf';
const OUT = 'src/ui/handbook-text.ts';
const OUT_JSON = 'public/handbook-text.json';
const HEADING_MIN_HEIGHT = 13.5;

const pdfjs = await import(pathToFileURL(join(root, 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.mjs')).href);
const bytes = readFileSync(join(root, PDF));
const sha256 = createHash('sha256').update(bytes).digest('hex');
const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), useWorkerFetch: false, isEvalSupported: false, disableFontFace: true }).promise;

/** Every visual line of the document: its text, its tallest item (the font
 * size, roughly), its baseline and its page. */
const lines = [];
for (let p = 1; p <= doc.numPages; p++) {
  const page = await doc.getPage(p);
  const content = await page.getTextContent();
  const items = content.items
    .filter((it) => 'str' in it && it.str !== '')
    .map((it) => ({ str: it.str.replace(/​/g, ' '), x: it.transform[4], y: it.transform[5], w: it.width, h: it.height }));
  // Group by baseline (1.5 pt tolerance), top to bottom, then left to right.
  items.sort((a, b) => b.y - a.y || a.x - b.x);
  const groups = [];
  for (const it of items) {
    const g = groups.find((x) => Math.abs(x.y - it.y) <= 1.5);
    if (g) g.items.push(it);
    else groups.push({ y: it.y, items: [it] });
  }
  for (const g of groups) {
    g.items.sort((a, b) => a.x - b.x);
    let text = '';
    let end;
    for (const it of g.items) {
      // A space only where the page leaves one: flush items (a ligature) join.
      if (text !== '' && end !== undefined && it.x - end > 1 && !/\s$/.test(text) && !/^\s/.test(it.str)) text += ' ';
      text += it.str;
      end = it.x + it.w;
    }
    text = text.replace(/\s+/g, ' ').trim();
    if (text !== '') lines.push({ text, height: Math.max(...g.items.map((i) => i.h)), y: g.y, page: p });
  }
}

/** The sections, in document order. */
const sections = [];
let current;
let paragraph;
let prev;
const flush = () => {
  if (current && paragraph && paragraph.trim() !== '') current.paragraphs.push(paragraph.trim());
  paragraph = undefined;
};
for (const line of lines) {
  if (/^Appendix [A-Z]\b/.test(line.text)) {
    flush();
    break;
  }
  const heading = line.height >= HEADING_MIN_HEIGHT;
  const numbered = /^(\d+(?:\.\d+){0,3})\s+(\S.*)$/.exec(line.text);
  if (heading && numbered) {
    flush();
    current = { id: numbered[1], title: numbered[2], paragraphs: [] };
    sections.push(current);
    prev = line;
    continue;
  }
  if (heading && current && current.paragraphs.length === 0 && paragraph === undefined) {
    current.title += ` ${line.text}`; // a title that wraps (§3.5)
    prev = line;
    continue;
  }
  if (!current) continue; // the title page
  const samePage = prev && prev.page === line.page;
  const gap = samePage ? prev.y - line.y : 0;
  const bodySize = Math.min(line.height, prev?.height ?? line.height);
  // A list item starts its own paragraph ("●", "1.", "(ii)"), and a short item
  // with no closing stop ends at the next line that starts a sentence (§4.4.2's
  // five groups, then "Each student should …").
  const listItem = /^(●|\d+\.\s|\((?:[ivx]+|[a-z])\)\s)/;
  // …and so does any item continued on a new page by a line that starts a
  // sentence (§2.5.2's last bullet, then the next page's paragraph).
  const shortItem =
    paragraph !== undefined && listItem.test(paragraph) && /^[A-Z]/.test(line.text) && ((paragraph.length < 70 && !/[.:;?!]$/.test(paragraph)) || prev?.page !== line.page);
  const newParagraph =
    paragraph === undefined ||
    listItem.test(line.text) ||
    shortItem ||
    (samePage ? gap > bodySize * 1.75 : /[.:?!”"]$/.test(paragraph.trim()));
  if (newParagraph) {
    flush();
    paragraph = line.text;
  } else paragraph = /-$/.test(paragraph) ? paragraph + line.text : `${paragraph} ${line.text}`;
  prev = line;
}
flush();

const edition = (lines.find((l) => /^Updated\s/.test(l.text))?.text ?? '').trim();
const body = `// GENERATED by scripts/handbook-text.mjs from ${PDF} — do not edit by hand.
// When the DGS replaces that PDF with a new edition, run \`npm run handbook-text\`
// and commit this file AND ${OUT_JSON} (tests/handbook-text.test.ts checks
// that both agree with the PDF). The handbook's words themselves are in the
// JSON file, fetched the first time a section chip is opened (W2, 2026-10-22);
// this file holds only what every page needs at once: the edition for the
// stamp, and the section ids and titles for the chips (DGS 2026-10-05).

/** One section of the handbook as ${OUT_JSON} holds it. */
export interface HandbookSection {
  /** "4.4.1" */
  id: string;
  /** "Core Knowledge Requirement" */
  title: string;
  paragraphs: readonly string[];
}

/** What ${OUT_JSON} is: the same source stamp, then the sections. */
export interface HandbookText {
  file: string;
  sha256: string;
  edition: string;
  sections: readonly HandbookSection[];
}

export const HANDBOOK_SOURCE = ${JSON.stringify({ file: PDF, sha256, edition }, null, 2)} as const;

/** Every section's id and title, in the handbook's order — enough for a chip
 * to know which sections it names; the paragraphs come from the JSON file. */
export const HANDBOOK_INDEX: readonly { id: string; title: string }[] = ${JSON.stringify(
  sections.map((s) => ({ id: s.id, title: s.title })),
  null,
  2,
)};
`;
writeFileSync(join(root, OUT), body);
writeFileSync(join(root, OUT_JSON), JSON.stringify({ file: PDF, sha256, edition, sections }, null, 2) + '\n');
console.log(`${OUT} + ${OUT_JSON}: ${sections.length} sections from ${PDF} (${edition || 'no edition line found'}), sha256 ${sha256.slice(0, 12)}…`);
