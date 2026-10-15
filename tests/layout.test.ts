// Two-column page detection (src/transcript/layout.ts, 2026-09-05): a
// Banner-style page is read left column then right; an ordinary one-column
// table — even one whose right half is all numbers — is never split.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { columnLayout, dropWatermarks, groupLineRuns, groupLines, isRepeatedPhraseRun, pageLayout, repeatedPhrase, runsFromTextItems, runsToLines, splitColumns, watermarkInstitution, type Run } from '../src/transcript/layout.ts';
import { blocksToRuns, type OcrBlockLike } from '../src/transcript/ocr-lines.ts';
import { pdfToLinesNode } from '../scripts/dev/pdf-lines-node.mts';

const W = 612;
const run = (x: number, y: number, text: string, width = text.length * 4): Run => ({ x, y, text, width });

/** A Banner-shaped page: 12 rows per column, subject / number / title /
 * credits / grade / points in separate runs, wordy headers in both columns,
 * a full-column rule and a "CONTINUED ON NEXT COLUMN" banner touching the gap,
 * one full-width header line crossing it. */
function twoColumnPage(): Run[] {
  const runs: Run[] = [run(33, 780, 'SSN: ***-**-0000   CWID 00000000   Date Issued: 01-SEP-2026', 330)];
  const column = (x0: number, label: string) => {
    let y = 760;
    const line = (text: string, width?: number) => runs.push(run(x0, (y -= 10), text, width));
    line(`${label} Fall 2019`);
    line('College of Science');
    line('Computer Science');
    for (let i = 0; i < 12; i++) {
      y -= 10;
      runs.push(run(x0, y, 'CS'), run(x0 + 27, y, `5${i}0`), run(x0 + 62, y, 'Course Title Words', 100), run(x0 + 182, y, '3.00'), run(x0 + 207, y, 'A'), run(x0 + 243, y, '12.00'));
    }
    line('Ehrs: 36.00 GPA-Hrs: 36.00 QPts: 144.00 GPA: 4.00', 200);
    line('Good Standing');
  };
  column(33, 'Left');
  runs.push(run(33, 500, '_______________________________________________', 270)); // rule touching the gap
  runs.push(run(60, 490, '****** CONTINUED ON NEXT COLUMN ******', 246)); // banner touching the gap
  column(310, 'Right');
  return runs;
}

/** A one-column table with the same cells laid across the full width. */
function oneColumnTable(titleWidth: number): Run[] {
  const runs: Run[] = [];
  let y = 760;
  for (let i = 0; i < 12; i++) {
    y -= 10;
    runs.push(run(40, y, 'CSE'), run(70, y, `6${i}641`), run(110, y, 'Graduate Operating Systems', titleWidth), run(380, y, '3.000'), run(430, y, 'A'), run(480, y, '12.000'));
  }
  return runs;
}

describe('two-column page detection', () => {
  it('splits a Banner-shaped page into left then right', () => {
    const cols = splitColumns(twoColumnPage(), W);
    assert.equal(cols.length, 2);
    const lines = runsToLines(twoColumnPage(), W);
    const left = lines.indexOf('Left Fall 2019');
    const right = lines.indexOf('Right Fall 2019');
    assert.ok(left >= 0 && right > left, 'left column precedes right column');
    // The right column's course rows stay whole and keep their column gaps.
    assert.ok(lines.some((l) => /^CS {3}5\d0 {3}Course Title Words {3}3\.00 {3}A {3}12\.00$/.test(l)), lines.join('\n'));
    // Nothing from the two columns was spliced into one line.
    assert.ok(!lines.some((l) => (l.match(/12\.00/g) ?? []).length > 1));
  });

  it('hands a straddling run\'s trailing term header to the right column', () => {
    // pdfjs merged "PTS R" (left table header) with "Fall 2013" (right column
    // term header) into one run spanning the gap.
    const runs = twoColumnPage();
    runs.push(run(285, 765, 'PTS R Fall 2013', 63));
    const lines = runsToLines(runs, W);
    const rightStart = lines.indexOf('Right Fall 2019');
    assert.ok(lines.slice(0, rightStart).includes('PTS R'), 'left keeps its header cell');
    // The header sits above the right column's first line, so it becomes that column's first line.
    assert.equal(lines.indexOf('Fall 2013'), rightStart - 1, 'right column gets the term header');
    assert.ok(!lines.some((l) => l.includes('PTS R Fall 2013')));
  });

  it('never splits a one-wide table whose header straddles the blank band between short titles and the numbers (the ANU sample, 2026-09-26)', () => {
    // Page 1 of the registrar's sample: an award table (STATUS / DATE at
    // x=326) and an enrolment table whose "CLASS n" titles end at x=175 and
    // whose UNITS TAKEN / MARK / GRADE cells start at x=405 — the band between
    // has a wordy, varied right edge, and nothing crosses it.
    const runs: Run[] = [run(46, 747, 'NAME'), run(438, 747, 'STUDENT No.'), run(46, 732, 'SAMPLE STUDENT'), run(440, 732, '5123456'), run(40, 669, 'DESCRIPTION'), run(326, 669, 'STATUS'), run(440, 669, 'DATE')];
    const awards = ['BACHELOR OF CLASSES (EXAMINATION STUDIES)', 'BACHELOR OF UNIVERSITY', 'GRADUATE DIPLOMA IN COLLEGE', 'MASTER OF COLLEGE (AUSTRALIAN STUDIES)', 'GRADUATE DIPLOMA IN SCHOOL (WITH MERIT)', 'AUSTRALIAN COLLEGE STUDIES'];
    awards.forEach((t, i) => {
      runs.push(run(40, 645 - i * 10.6, t), run(326, 645 - i * 10.6, i % 2 ? 'AWARDED' : 'TRANSFER'));
      if (i % 2) runs.push(run(440, 645 - i * 10.6, '27 SEPTEMBER 2006'));
    });
    runs.push(run(76, 525, 'COURSE CODE'), run(141, 525, 'COURSE TITLE'), run(405, 525, 'UNITS TAKEN'), run(476, 525, 'MARK'), run(508, 525, 'GRADE'), run(40, 500, 'UNDERGRADUATE | GPA: 4.261'), run(40, 477, '3500'), run(75, 477, 'BACHELOR OF CLASSES'), run(40, 453, '2003'), run(75, 453, 'FULL YEAR'));
    for (let i = 0; i < 14; i++) {
      const y = 443 - i * 12.5;
      runs.push(run(75, y, `EXAM10${String(i).padStart(2, '0')}`), run(145, y, `CLASS ${i + 1}`), run(438, y, '2'), run(481, y, String(50 + i)), run(516, y, i % 3 ? 'CR' : 'P'));
    }
    runs.push(run(167, 170, 'THE AUSTRALIAN NATIONAL UNIVERSITY', 161), run(404, 170, 'Admin Istrator'), run(404, 158, 'Registrar, Student Administration', 134), run(167, 157, 'Acton · ACT · 2601 · Australia', 140), run(167, 146, 'www.anu.edu.au'), run(404, 145, '24 August 2017'));
    assert.equal(splitColumns(runs, 595).length, 1);
    const lines = runsToLines(runs, 595);
    assert.ok(lines.includes('COURSE CODE   COURSE TITLE   UNITS TAKEN   MARK   GRADE'));
    assert.ok(lines.includes('EXAM1000   CLASS 1   2   50   P'));
  });
  it('never splits a one-column table — titles cross the middle', () => {
    assert.equal(splitColumns(oneColumnTable(220), W).length, 1);
  });

  it('never splits a one-column table with short titles — its right half starts with numbers', () => {
    assert.equal(splitColumns(oneColumnTable(120), W).length, 1);
  });

  it('never splits a wide one-column table whose only wordy text at the numbers is one repeated header (2026-09-20)', () => {
    // The DGS's synthetic transcripts: short titles, then Attempted / Earned /
    // Grade / Points far to the right, with the "Attempted" header printed
    // above every term's numbers — five wordy runs at the edge, all one word.
    const runs: Run[] = [];
    let y = 760;
    for (let term = 0; term < 6; term++) {
      y -= 12;
      runs.push(run(43, y, `2022-23 Fall Term`, 88), run(149, y, 'Academic Career: Graduate', 108));
      y -= 12;
      runs.push(run(43, y, 'Course', 25), run(155, y, 'Description', 40), run(407, y, 'Attempted', 36), run(455, y, 'Earned', 25), run(497, y, 'Grade', 21), run(544, y, 'Points', 22));
      for (let i = 0; i < 3; i++) {
        y -= 10;
        runs.push(run(43, y, `CS1${term}${i}`, 24), run(155, y, 'Operating systems design', 120), run(438, y, '3', 4), run(475, y, '3', 4), run(497, y, 'A', 5), run(542, y, '12.000', 24));
      }
      y -= 10;
      runs.push(run(43, y, 'Term Totals: 11 units', 70), run(155, y, 'Term GPA', 35), run(548, y, '3.745', 19));
    }
    assert.equal(splitColumns(runs, W).length, 1);
    assert.ok(runsToLines(runs, W).some((l) => /^CS100 {3}Operating systems design {3}3 {3}3 {3}A {3}12\.000$/.test(l)), runsToLines(runs, W).join('\n'));
  });

  it('leaves small pages alone', () => {
    assert.equal(splitColumns(twoColumnPage().slice(0, 30), W).length, 1);
  });

  it('drops a tiled text watermark and a diagonal one, leaving the page as if clean', () => {
    const clean = twoColumnPage();
    const dirty = [...clean];
    // Horizontal tiles at three x positions on a grid that collides with lines.
    for (let y = 770; y > 300; y -= 37) {
      for (const x of [20, 220, 420]) dirty.push(run(x, y, 'University of Example Technology', 150));
    }
    // A diagonal banner across the page (rotated → never body text).
    for (let y = 700; y > 300; y -= 80) dirty.push({ ...run(100, y, 'UNIVERSITY OF EXAMPLE TECHNOLOGY', 400), rotated: true });
    assert.deepEqual(runsToLines(dirty, W), runsToLines(clean, W));
    assert.equal(dropWatermarks(dirty).length, clean.length);
  });

  it('keeps a phrase that merely repeats down one column (a thesis-credit title every term)', () => {
    const runs = twoColumnPage();
    for (let i = 0; i < 8; i++) runs.push(run(95, 300 - i * 10, 'Research and Thesis Ph.D.', 100));
    assert.equal(dropWatermarks(runs).length, runs.length);
  });

  // One text item per glyph (2026-10-08, the DGS's redacted insideND copies):
  // letters touch, words are a space apart, and the line must read as words.
  it('groupLines joins touching letters when the column is laid out one glyph per run', () => {
    const glyphs = (x0: number, y: number, text: string): Run[] => {
      const out: Run[] = [];
      let x = x0;
      for (const ch of text) {
        if (ch === ' ') { x += 2.5; continue; } // a space item, dropped by runsFromTextItems: a 2.5-unit gap
        out.push(run(x, y, ch, 4));
        x += 4 + (out.length % 3 === 0 ? -0.3 : 0.2); // kerning: −0.4…+0.4 between letters of a word
      }
      return out;
    };
    const runs = [...glyphs(20, 300, 'University of Notre Dame'), ...glyphs(20, 280, 'Unofficial Academic Transcript'), ...glyphs(20, 260, 'Term: Fall Semester 2022'), ...glyphs(200, 260, 'Main GR')];
    assert.deepEqual(groupLines(runs), ['University of Notre Dame', 'Unofficial Academic Transcript', 'Term: Fall Semester 2022   Main GR']);
  });
  it('groupLines leaves word-level runs alone even when two touch', () => {
    const words = Array.from({ length: 24 }, (_, i) => run(20 + (i % 6) * 40, 300 - Math.floor(i / 6) * 12, `word${i}`, 20));
    words.push(run(40, 300, 'touching', 20)); // starts where "word0" ends
    assert.match(groupLines(words)[0]!, /^word0 touching/);
  });
  it('groupLines renders wide gaps as three spaces and keeps reading order', () => {
    const lines = groupLines([run(200, 100, 'B'), run(40, 100, 'A'), run(40, 120, 'first'), run(46, 100, 'A2')]);
    assert.deepEqual(lines, ['first', 'A A2   B']);
  });
});

// Sideways pages and security bands (2026-09-05, from the DGS's de-identified
// samples): a landscape transcript stored with /Rotate 90 (Northeastern), a
// page whose content is drawn sideways with no /Rotate (a re-saved Parchment
// official PDF), a "DUKE UNIVERSITY ? DUKE UNIVERSITY ? …" band drawn as one
// run, and a "COPY COPY COPY" tile of short words.
describe('page orientation and watermark bands', () => {
  const item = (str: string, transform: number[], width = str.length * 4) => ({ str, transform, width });

  it('reads a /Rotate 90 page through the viewport transform: upright text, x left→right, y up', () => {
    // pdfjs viewport for a 612×792 portrait page rotated 90°: 792×612, transform [0, 1, 1, 0, 0, 0].
    const viewport = { transform: [0, 1, 1, 0, 0, 0], width: 792, height: 612 };
    // Text items of a rotated page carry [0, s, -s, 0, e, f]: e runs down the
    // reading page (line order), f runs across it (left→right).
    const { runs, width } = runsFromTextItems(
      [item('First line', [0, 8, -8, 0, 49, 100]), item('Second line', [0, 8, -8, 0, 60, 100]), item('right cell', [0, 8, -8, 0, 49, 400])],
      viewport,
    );
    assert.equal(width, 792);
    assert.ok(runs.every((r) => !r.rotated), 'upright in reading orientation');
    const [first, second, right] = runs;
    assert.ok(first!.y > second!.y, 'the earlier line sits higher (y up)');
    assert.ok(right!.x > first!.x, 'the cell further along the line sits further right');
    assert.ok(Math.abs(first!.y - right!.y) < 1, 'same baseline');
    assert.deepEqual(groupLines(runs), ['First line   right cell', 'Second line']);
  });

  it('turns a page whose every run is drawn sideways (no /Rotate) upright', () => {
    const viewport = { transform: [1, 0, 0, -1, 0, 792], width: 612, height: 792 };
    // Content rotated 90° counter-clockwise: [0, s, -s, 0, e, f] on an unrotated page.
    const items = [item('Name: Jane', [0, 9.4, -9.4, 0, 36, 18]), item('Date Issued', [0, 9.4, -9.4, 0, 36, 627]), item('CSE 60641   Title   3.000 A', [0, 9.4, -9.4, 0, 285, 24], 200)];
    const { runs, width } = runsFromTextItems(items, viewport);
    assert.equal(width, 792, 'the page is landscape once turned');
    assert.ok(runs.every((r) => !r.rotated));
    const lines = groupLines(runs);
    assert.deepEqual(lines, ['Name: Jane   Date Issued', 'CSE 60641   Title   3.000 A']);
  });

  it('keeps a lone diagonal watermark rotated on an otherwise upright page', () => {
    const viewport = { transform: [1, 0, 0, -1, 0, 792], width: 612, height: 792 };
    const s = Math.SQRT1_2 * 28;
    const { runs } = runsFromTextItems(
      [item('Fall 2026', [8, 0, 0, 8, 40, 700]), item('CSE 60641 Title 3.000 A', [8, 0, 0, 8, 40, 680], 150), item('EXAMPLE TECH', [s, s, -s, s, 100, 300])],
      viewport,
    );
    assert.deepEqual(runs.map((r) => r.rotated), [false, false, true]);
  });

  it('drops a run that repeats a phrase across the page, and names the institution it repeats', () => {
    const band = 'DUKE UNIVERSITY ? DUKE UNIVERSITY ? DUKE UNIVERSITY ? DUKE UNIVERSIT';
    const partial = 'LJFCQ ? UNIVERSITY OF CALIFORNIA, SAN DIEGO ? UNIVERSITY OF CALIFORNIA, SAN DIEGO ? QCA';
    assert.equal(isRepeatedPhraseRun(band), true);
    assert.equal(isRepeatedPhraseRun(partial), true);
    assert.equal(isRepeatedPhraseRun('Term GPA   3.000   Term Earned   9.000   6.000'), false);
    assert.equal(isRepeatedPhraseRun('Graduate Independent Study'), false);
    assert.equal(repeatedPhrase(band), 'DUKE UNIVERSITY');
    assert.equal(repeatedPhrase(partial), 'UNIVERSITY OF CALIFORNIA, SAN DIEGO');
    const runs = [run(33, 700, band, 500), run(33, 700, 'ECE 565   Title   3.000   A', 200), run(33, 690, partial, 500), run(33, 680, partial, 500)];
    assert.deepEqual(dropWatermarks(runs).map((r) => r.text), ['ECE 565   Title   3.000   A']);
    assert.equal(watermarkInstitution(runs), 'UNIVERSITY OF CALIFORNIA, SAN DIEGO', 'the phrase repeated on the most runs');
    assert.equal(runsToLines(runs, W)[0], 'UNIVERSITY OF CALIFORNIA, SAN DIEGO', 'the band names the institution at the top of the page');
  });

  it('drops a tile of a SHORT word repeated at four or more x positions, never a column header', () => {
    const runs: Run[] = [];
    for (let y = 700; y > 500; y -= 20) for (const x of [40, 190, 340, 490]) runs.push(run(x, y, 'COPY'));
    for (let y = 700; y > 500; y -= 20) runs.push(run(60, y, 'CSE')); // a subject column: one x
    runs.push(run(100, 720, 'HRS'), run(160, 720, 'HRS'), run(220, 720, 'HRS')); // three headers on one line
    const kept = dropWatermarks(runs).map((r) => r.text);
    assert.ok(!kept.includes('COPY'));
    assert.equal(kept.filter((t) => t === 'CSE').length, 10);
    assert.equal(kept.filter((t) => t === 'HRS').length, 3);
  });
});

// ——— Transcript accuracy program, Batch B (DGS 2026-10-09): F4 layout ———
describe('transcript accuracy program, Batch B — F4 layout (2026-10-09)', () => {
  it('(a) a header word that repeats at two x positions under every term heading, and once each in lines of running text, is not a watermark tile (Alberta page 2)', () => {
    // The positions are the public sample's (pdf-alberta-crnc-sample.pdf, page
    // 2): "Units" at x 326.6 and 379.4 in five headers, and "units" at 197,
    // 187.4 and 192.2 in three GPA lines whose numbers shift it; "Taken" at
    // 326.6 in the headers and "taken" at 225.8, 216.2 and 221 in the same
    // GPA lines. Thirteen and eight occurrences at five and four x positions.
    const runs: Run[] = [];
    const headerYs = [609.2, 508, 397.6, 324, 186];
    for (const y of headerYs) {
      runs.push(run(278.6, y, 'Grade', 24), run(326.6, y, 'Units', 24), run(379.4, y, 'Units', 24), run(427.4, y, 'Grade', 24), run(470.6, y, 'Class', 24), run(513.8, y, 'Class', 24));
      runs.push(run(48.2, y - 9.2, 'Course', 28.8), run(115.4, y - 9.2, 'Description', 52.8), run(278.6, y - 9.2, 'Remark', 28.8), run(326.6, y - 9.2, 'Taken', 24), run(374.6, y - 9.2, 'Passed', 28.8), run(422.6, y - 9.2, 'Points', 28.8), run(480.2, y - 9.2, 'Avg', 14.4), run(518.6, y - 9.2, 'Enrl', 19.2));
    }
    for (const [x, y] of [[197, 443.6], [187.4, 360.8], [192.2, 130.8]] as const) {
      runs.push(run(48.2, y, 'GPA:', 20), run(72, y, '60.00', 24), run(100, y, 'grade points /', 60), run(165, y, '24.0', 20), run(x, y, 'units', 24), run(x + 28.8, y, 'taken', 24), run(x + 57, y, '= 2.5', 24));
    }
    for (let i = 0; i < 12; i++) runs.push(run(48.2, 590 - i * 12, 'ENGL'), run(80, 590 - i * 12, `10${i}`), run(115.4, 590 - i * 12, 'INTRO TO CRITICAL ANALYSIS', 110), run(282, 590 - i * 12, 'B-'), run(330, 590 - i * 12, '3.0'), run(382, 590 - i * 12, '3.0'), run(426, 590 - i * 12, '8.10'), run(478, 590 - i * 12, '2.8'), run(520, 590 - i * 12, '36'));
    const kept = dropWatermarks(runs).map((r) => r.text);
    assert.equal(kept.filter((t) => t === 'Units').length, 10, 'every header "Units" survives');
    assert.equal(kept.filter((t) => t === 'Taken').length, 5, 'every header "Taken" survives');
    assert.equal(kept.length, runs.length, 'nothing on the page is a tile');
    // The 2026-09-05 "COPY" tile still goes: four x positions, each repeated down the page.
    const tile: Run[] = [];
    for (let y = 700; y > 500; y -= 20) for (const x of [40, 190, 340, 490]) tile.push(run(x, y, 'COPY'));
    assert.equal(dropWatermarks([...runs, ...tile]).filter((r) => r.text === 'COPY').length, 0);
  });

  it('(b) a short two-column last page splits at the previous page\'s gap when its runs line up with it; a short one-column page does not', () => {
    const { hint } = columnLayout(twoColumnPage(), W);
    assert.ok(hint !== undefined && hint.gapX > 240 && hint.gapX < 370 && Math.abs(hint.rightEdge - 310) <= 4, `the Banner page's layout: ${JSON.stringify(hint)}`);
    // The last page: one term per column, 24 runs — under the 40 the full test needs.
    const last: Run[] = [];
    const column = (x0: number, label: string) => {
      let y = 760;
      last.push(run(x0, (y -= 10), `${label} Spring 2021`));
      for (let i = 0; i < 2; i++) {
        y -= 10;
        last.push(run(x0, y, 'CS'), run(x0 + 27, y, `6${i}0`), run(x0 + 62, y, 'Course Title Words', 100), run(x0 + 182, y, '3.00'), run(x0 + 207, y, 'A'), run(x0 + 243, y, '12.00'));
      }
      last.push(run(x0, (y -= 10), 'Ehrs: 6.00 GPA-Hrs: 6.00 QPts: 24.00 GPA: 4.00', 200));
    };
    column(33, 'Left');
    column(310, 'Right');
    assert.equal(splitColumns(last, W).length, 1, 'alone, a short page is never split');
    const split = columnLayout(last, W, hint);
    assert.equal(split.columns.length, 2);
    const lines = runsToLines(last, W, hint);
    const left = lines.indexOf('Left Spring 2021');
    const right = lines.indexOf('Right Spring 2021');
    assert.ok(left >= 0 && right > left, lines.join('\n'));
    assert.ok(!lines.some((l) => (l.match(/12\.00/g) ?? []).length > 1), 'nothing spliced across the columns');
    assert.deepEqual(split.hint, hint, 'the layout is handed on again');
    // A one-column last page (Banner's legend: full-width prose, nothing at the right edge) is read whole.
    const legend: Run[] = [];
    for (let i = 0; i < 20; i++) legend.push(run(40, 700 - i * 12, 'Example Institute of Technology grades on a four-point scale as described in this legend.', 480));
    assert.equal(columnLayout(legend, W, hint).columns.length, 1);
    assert.deepEqual(runsToLines(legend, W, hint), runsToLines(legend, W));
    // Runs at the right edge but a line crossing the gap: not split either.
    const crossing = [...last, run(100, 650, 'A full-width note that runs across the middle of the page to the right column', 400)];
    assert.equal(columnLayout(crossing, W, hint).columns.length, 1);
    // Too few runs at the hinted edge (a one-column page whose text happens to start near it): not split.
    const sparse: Run[] = [];
    for (let i = 0; i < 20; i++) sparse.push(run(33, 700 - i * 12, `Line ${i} of prose in the left column only`, 200));
    sparse.push(run(310, 300, 'Page 3', 30));
    assert.equal(columnLayout(sparse, W, hint).columns.length, 1);
  });

  it('(b) tests/fixtures/banner-transcript.pdf reads through the Node layout stage exactly as tests/banner-transcript.test.ts pins it — the one-column legend page after the two-column pages unchanged', async () => {
    const src = readFileSync(new URL('./banner-transcript.test.ts', import.meta.url), 'utf8');
    const pinned = JSON.parse(/export const BANNER_LINES = (\[[\s\S]*?\n\]);/.exec(src)![1]!.replace(/,\s*\]$/, ']').replace(/'/g, '"')) as string[];
    const got = await pdfToLinesNode(new URL('./fixtures/banner-transcript.pdf', import.meta.url).pathname);
    assert.deepEqual(got, pinned);
  });

  it('(c) glyph-per-item runs are joined line by line: a glyph line among word-level lines reads as words, and a word-level line on a glyph page keeps its spaces', () => {
    const glyphs = (x0: number, y: number, text: string): Run[] => {
      const out: Run[] = [];
      let x = x0;
      for (const ch of text) {
        if (ch === ' ') { x += 2.5; continue; }
        out.push(run(x, y, ch, 4));
        x += 4 + (out.length % 3 === 0 ? -0.3 : 0.2);
      }
      return out;
    };
    // Four word-level lines and one glyph line: under the old page-level
    // rule (60% of the page's runs) the glyph line stayed letter-spaced.
    const words: Run[] = [];
    for (let i = 0; i < 4; i++) words.push(run(20, 300 - i * 12, 'CSE'), run(45, 300 - i * 12, `6064${i}`), run(80, 300 - i * 12, 'Graduate Operating Systems', 110), run(220, 300 - i * 12, '3.0'), run(250, 300 - i * 12, 'A'));
    const mixed = [...words, ...glyphs(20, 240, 'University of Notre Dame')];
    const lines = groupLines(mixed);
    assert.ok(lines.includes('University of Notre Dame'), lines.join('\n'));
    assert.ok(lines.includes('CSE   60640   Graduate Operating Systems   3.0   A'), lines.join('\n'));
    // Two word-level runs that touch on a glyph page are not glued.
    const glyphPage = [...glyphs(20, 300, 'Unofficial Academic Transcript'), ...glyphs(20, 280, 'Term: Fall Semester 2022'), run(20, 260, 'Graduate', 36), run(56, 260, 'Operating', 40)];
    assert.ok(groupLines(glyphPage).includes('Graduate Operating'), groupLines(glyphPage).join('\n'));
  });

  // ——— The 2026-10-09 review of F4 ———
  it('(b, review) a short one-column label/value page whose values start at the hinted right edge is not split: both sides must show a course column', () => {
    const { hint } = columnLayout(twoColumnPage(), W);
    assert.ok(hint !== undefined);
    // Labels left, wordy values at the previous page's right edge, nothing
    // crossing — before the review this split into eight lines and the
    // conferral line lost its date.
    const block: Run[] = [];
    let y = 700;
    for (const [label, value] of [['Degree Awarded:', 'Bachelor of Science'], ['Conferred:', 'May 20, 2024'], ['Major:', 'Computer Science'], ['Honors:', 'Cum Laude']] as const) {
      block.push(run(50, y, label), run(hint.rightEdge, y, value));
      y -= 12;
    }
    assert.equal(columnLayout(block, W, hint).columns.length, 1);
    assert.deepEqual(runsToLines(block, W, hint), ['Degree Awarded:   Bachelor of Science', 'Conferred:   May 20, 2024', 'Major:   Computer Science', 'Honors:   Cum Laude']);
    // A term printed as a VALUE ("Entry Term:   Fall 2020") is evidence on the right only: still one column.
    const withTerm = [...block, run(50, y, 'Entry Term:'), run(hint.rightEdge, y, 'Fall 2020')];
    assert.equal(columnLayout(withTerm, W, hint).columns.length, 1);
    assert.ok(runsToLines(withTerm, W, hint).includes('Entry Term:   Fall 2020'));
    // A short last page whose LEFT column is rows only (its term header on the
    // previous page) and whose right column opens with a term header still
    // splits: the subject and number runs on the shared baselines are the
    // left side's evidence.
    const last: Run[] = [];
    y = 750;
    last.push(run(310, y, 'Right Spring 2021'));
    for (let i = 0; i < 2; i++) {
      y -= 10;
      for (const x0 of [33, 310]) last.push(run(x0, y, 'CS'), run(x0 + 27, y, `6${i}0`), run(x0 + 62, y, 'Course Title Words', 100), run(x0 + 182, y, '3.00'), run(x0 + 207, y, 'A'), run(x0 + 243, y, '12.00'));
    }
    for (const x0 of [33, 310]) last.push(run(x0, y - 10, 'Ehrs: 6.00 GPA-Hrs: 6.00 QPts: 24.00 GPA: 4.00', 200));
    assert.equal(columnLayout(last, W, hint).columns.length, 2);
    const lines = runsToLines(last, W, hint);
    assert.ok(!lines.some((l) => (l.match(/12\.00/g) ?? []).length > 1), lines.join('\n'));
    assert.ok(lines.indexOf('Right Spring 2021') > lines.findIndex((l) => l.startsWith('Ehrs:')), 'the left column is read whole before the right');
  });

  it('(c, review) on a page that is mostly glyphs, a line half glyphs and half words is joined too; on a word-level page the line test alone decides', () => {
    const glyphs = (x0: number, y: number, text: string): Run[] => {
      const out: Run[] = [];
      let x = x0;
      for (const ch of text) {
        if (ch === ' ') { x += 2.5; continue; }
        out.push(run(x, y, ch, 4));
        x += 4 + (out.length % 3 === 0 ? -0.3 : 0.2);
      }
      return out;
    };
    // The insideND pages measure 75–77% glyphs page-wide: a line of six glyph
    // runs beside two word runs (75%) read "F a l l 2023   Main   G R" under
    // the 80% line test alone, and "G P A 3.500" (75%) likewise.
    const mixedLine = [...glyphs(20, 260, 'Fall'), run(40, 260, '2023'), run(200, 260, 'Main'), ...glyphs(230, 260, 'GR')];
    const glyphPage = [...glyphs(20, 300, 'University of Notre Dame'), ...glyphs(20, 280, 'Unofficial Academic Transcript'), ...mixedLine, ...glyphs(20, 240, 'GPA'), run(40, 240, '3.500'), run(20, 220, 'Graduate', 36), run(56, 220, 'Operating', 40)];
    const lines = groupLines(glyphPage);
    assert.ok(lines.includes('Fall 2023   Main   GR'), lines.join('\n'));
    assert.ok(lines.includes('GPA 3.500'), lines.join('\n'));
    assert.ok(lines.includes('Graduate Operating'), 'a word-level line on the glyph page keeps its spaces');
    // The same 75% line on a WORD-level page (four Banner rows, 20 runs) is
    // not a glyph line: the page's share is below 60%, the line's below 80%.
    const words: Run[] = [];
    for (let i = 0; i < 4; i++) words.push(run(20, 400 - i * 12, 'CSE'), run(45, 400 - i * 12, `6064${i}`), run(80, 400 - i * 12, 'Graduate Operating Systems', 110), run(220, 400 - i * 12, '3.0'), run(250, 400 - i * 12, 'A'));
    const wordPage = groupLines([...words, ...mixedLine]);
    assert.ok(wordPage.includes('F a l l 2023   Main   G R'), wordPage.join('\n'));
  });
});

// ——— OCR word boxes (OCR step 11, 2026-10-09) ———
// The OCR path builds its runs from the engine's word boxes (src/transcript/
// ocr-lines.ts blocksToRuns) and reads them through the same layout stage as a
// text PDF's runs. What an OCR page looks like here: every row of a two-column
// Banner page is ONE engine line across both columns (the engine's default
// page segmentation), each word an ink-tight box at 216 dpi (scale 3), a
// word space ~9 px, a cell gap ~60 px, every run of a line at the line's
// baseline; nothing is rotated, and a cell is never wider than its ink.
describe('an OCR-word two-column page', () => {
  /** An engine line laid out at `x` px on baseline `y` px: 20 px per
   * character, `gaps` the pixel gap after each word. */
  const engineLine = (text: string, x: number, y: number, gaps: number[]): NonNullable<NonNullable<OcrBlockLike['paragraphs']>[number]['lines']>[number] => {
    const words = [];
    let at = x;
    const parts = text.split(' ');
    for (let i = 0; i < parts.length; i++) {
      const w = parts[i]!.length * 20;
      words.push({ text: parts[i]!, confidence: 90, bbox: { x0: at, y0: y - 22, x1: at + w, y1: y + 8 } });
      at += w + (gaps[i] ?? 9);
    }
    const x1 = words[words.length - 1]!.bbox.x1;
    return { text: `${text}\n`, confidence: 90, bbox: { x0: x, y0: y - 22, x1, y1: y + 8 }, baseline: { x0: x, y0: y, x1, y1: y }, words };
  };
  const cells = [60, 60, 9, 9, 60, 60, 60]; // subject · number · title (three words) · credits · grade · points
  const words = [9, 9, 9, 9, 9, 9, 9];
  /** The page as the engine sees it: left and right column rows on one baseline each. */
  function ocrBannerPage(): Run[] {
    const lines: ReturnType<typeof engineLine>[] = [];
    let y = 300;
    const row = (left: string, leftGaps: number[], right: string, rightGaps: number[]) => {
      const l = engineLine(left, 100, y, leftGaps);
      const r = engineLine(right, 1400, y, rightGaps);
      lines.push({ ...l, text: `${left} ${right}\n`, bbox: { ...l.bbox!, x1: r.bbox!.x1 }, baseline: { ...l.baseline!, x1: r.baseline!.x1 }, words: [...(l.words ?? []), ...(r.words ?? [])] });
      y += 40;
    };
    lines.push(engineLine('SSN: ***-**-0000 CWID 00000000 Date Issued: 01-SEP-2026', 100, 100, [9, 60, 9, 60, 9, 9]));
    row('Fall 2019', words, 'Fall 2020', words);
    row('College of Science', words, 'College of Science', words);
    row('Computer Science', words, 'Computer Science', words);
    for (let i = 0; i < 12; i++) row(`CS 5${i}0 Course Title Words 3.00 A 12.00`, cells, `CS 6${i}0 Other Title Words 3.00 B+ 9.99`, cells);
    row('Ehrs: 36.00 GPA-Hrs: 36.00 QPts: 144.00 GPA: 4.00', words, 'Ehrs: 36.00 GPA-Hrs: 36.00 QPts: 144.00 GPA: 4.00', words);
    row('Good Standing', words, 'Good Standing', words);
    return blocksToRuns([{ paragraphs: [{ lines }] }], 3, 3300);
  }

  it('splits into two columns at the gap between the word boxes and reads the left column before the right, cells three spaces apart', () => {
    const runs = ocrBannerPage();
    // Phrase runs, not word runs: "Course Title Words" is one run, its cells are separate.
    assert.ok(runs.some((r) => r.text === 'Course Title Words') && runs.some((r) => r.text === '12.00'));
    const { columns, hint } = columnLayout(runs, 2550 / 3);
    assert.equal(columns.length, 2);
    assert.ok(hint !== undefined && hint.gapX > 1000 / 3 && hint.gapX < 1400 / 3 && Math.abs(hint.rightEdge - 1400 / 3) <= 4, JSON.stringify(hint));
    const lines = runsToLines(runs, 2550 / 3);
    const left = lines.indexOf('Fall 2019');
    const right = lines.indexOf('Fall 2020');
    assert.ok(left >= 0 && right > left, lines.join('\n'));
    assert.equal(lines[left + 3], 'CS   500   Course Title Words   3.00   A   12.00');
    assert.equal(lines[right + 3], 'CS   600   Other Title Words   3.00   B+   9.99');
    assert.ok(!lines.some((l) => (l.match(/12\.00|9\.99/g) ?? []).length > 1), 'nothing spliced across the columns');
    // The one-letter grade cells sit a cell gap from their neighbours: never glued by the glyph join.
    assert.ok(lines.every((l) => !/\d\.00A|A12\.00|B\+9/.test(l)), lines.join('\n'));
    // The full-width header line stays with the left column (read first), as a text PDF's does.
    assert.ok(lines.indexOf('SSN: ***-**-0000   CWID 00000000   Date Issued: 01-SEP-2026') < left, lines.join('\n'));
  });

  it('groupLineRuns hands back the very run objects each line was built from, in reading order, and pageLayout aligns them with its lines', () => {
    const runs = ocrBannerPage();
    const grouped = groupLineRuns(runs);
    assert.deepEqual(grouped.map((l) => l.text), groupLines(runs));
    for (const l of grouped) for (const r of l.runs) assert.ok(runs.includes(r), 'the same objects, never copies');
    assert.equal(grouped.reduce((n, l) => n + l.runs.length, 0), runs.length, 'every run lands on exactly one line');
    const page = pageLayout(runs, 2550 / 3);
    assert.equal(page.lineRuns.length, page.lines.length);
    const row = page.lines.indexOf('CS   500   Course Title Words   3.00   A   12.00');
    assert.deepEqual(page.lineRuns[row]!.map((r) => r.text), ['CS', '500', 'Course Title Words', '3.00', 'A', '12.00']);
    // The text path's callers are untouched: the same lines as before.
    assert.deepEqual(page.lines, runsToLines(runs, 2550 / 3));
  });

  it('a tiled word is still a watermark when the engine reads it as its own run, and a phrase is not', () => {
    // Per-word runs of "COPY" across the page: the 2026-09-05 tile rule drops them …
    const runs = ocrBannerPage();
    const tile: ReturnType<typeof engineLine>[] = [];
    for (let y = 400; y < 1200; y += 80) tile.push(engineLine('COPY COPY COPY COPY', 200, y, [500, 500, 500]));
    const withTile = [...runs, ...blocksToRuns([{ paragraphs: [{ lines: tile }] }], 3, 3300)];
    assert.equal(dropWatermarks(withTile).filter((r) => r.text === 'COPY').length, 0);
    // … while "College of Science", repeated down each of the two columns, is a phrase at two x positions and stays.
    assert.equal(dropWatermarks(runs).filter((r) => r.text === 'College of Science').length, 2);
  });
});

// The dev tools' Node reader (scripts/dev/pdf-lines-node.mts) opens a PDF as
// src/transcript/pdf.ts does — without pdfjs's standard-font folder — so every
// line list it makes is the browser's (2026-10-15: the review of that day ran
// the app's reader in Chrome and WebKit, and its lines equalled this read).
describe("the dev tools' PDF read is the browser's (2026-10-15)", () => {
  it("combined-transcript.pdf's em dash, written as byte 0x14 outside its font's encoding, is dropped by default, as the browser drops it, and kept only when the standard-font folder is asked for", async () => {
    const file = new URL('./fixtures/combined-transcript.pdf', import.meta.url).pathname;
    const degreeLines = (lines: string[]) => lines.filter((l) => l.includes('Conferred:'));
    assert.deepEqual(degreeLines(await pdfToLinesNode(file)), ['Bachelor of Science in Computer Science Conferred: May 11, 2024', 'Master of Science in Computer Science Conferred: May 10, 2025']);
    assert.deepEqual(degreeLines(await pdfToLinesNode(file, undefined, { standardFonts: true })), ['Bachelor of Science in Computer Science \u0014 Conferred: May 11, 2024', 'Master of Science in Computer Science \u0014 Conferred: May 10, 2025']);
  });
});
