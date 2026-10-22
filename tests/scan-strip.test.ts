// The scanned line beside an OCR preview row (Batch C, the DGS's answer (5) of
// 2026-10-09: "The OCR preview shows a crop of the scanned line beside the
// fields of flagged rows, behind a 'show the scanned line' toggle on the
// others; in memory only, never saved or exported (a test asserts it)").
//
// Pinned here: every OCR line carries its pixel box (the union of its words'),
// every OCR row the lines it was read from, the strip region of a row on a
// pinned scan holds that row's words, and — the assertion the DGS asked for —
// after Add, the student record, its JSON export and its localStorage copy
// hold no image, no data: URL and nothing of the preview's OCR extras, while
// the images themselves sit in the preview's own Map and are emptied when it
// closes.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';
import type { Student } from '../src/engine/types.ts';
import { parseExternalTranscript } from '../src/transcript/external.ts';
import { ocrLinesFromPage, type OcrBlockLike, type OcrLine } from '../src/transcript/ocr-lines.ts';
import { scaledRegion, STRIP_PAGE_MAX_SIDE_PX, stripPageSize, stripRegion } from '../src/transcript/scan-strip.ts';
import { courseEntryOf, previewRowOf } from '../src/ui/external-upload.ts';
import { holdScanStrips, holdsScanStrips, releaseScanStrips, SCANNED_LINE_LABEL, SHOW_SCANNED_LINE } from '../src/ui/scan-strips.ts';
import { emptyStudent, exportFile, saveLocal } from '../src/ui/state.ts';

const SCANS = new URL('./fixtures/ocr-scans/', import.meta.url);
const pinned = (name: string) => {
  const e = JSON.parse(readFileSync(new URL(`${name}.expected.json`, SCANS), 'utf8')) as { dpi: number; width: number; height: number };
  return { ...e, blocks: JSON.parse(readFileSync(new URL(`${name}.blocks.json`, SCANS), 'utf8')) as OcrBlockLike[] };
};
const word = (text: string, x0: number, x1: number, y0 = 100, y1 = 120, confidence = 95) => ({ text, confidence, bbox: { x0, y0, x1, y1 } });

describe('every OCR line carries its pixel box; every OCR row the lines it came from', () => {
  it('a line\'s box is its words\' boxes together', () => {
    const blocks: OcrBlockLike[] = [
      { paragraphs: [{ lines: [{ text: 'CS 50300 Operating Systems 3.0 A', confidence: 90, bbox: { x0: 100, y0: 98, x1: 900, y1: 122 }, baseline: { x0: 100, y0: 118, x1: 900, y1: 118 }, words: [word('CS', 100, 130), word('50300', 160, 230), word('Operating', 300, 420, 99), word('Systems', 432, 530, 100, 124), word('3.0', 700, 740), word('A', 860, 875)] }] }] },
    ];
    const [line] = ocrLinesFromPage(blocks, 1000, 1300, 3);
    assert.equal(line!.text.replace(/\s+/g, ' '), 'CS 50300 Operating Systems 3.0 A');
    assert.deepEqual(line!.box, { x0: 100, y0: 99, x1: 875, y1: 124 });
  });

  it('OCR rows name their source lines (a two-line row both); a text layer\'s rows carry none', () => {
    const lines = ['Purdue University', 'Office of the Registrar', 'Official Academic Transcript', 'Student: Jane Q. Student', 'Fall 2023', 'CS 50300   Operating Systems   3.0   A', 'CS 50400   Compilers and Translators', '3.0   B+', '', 'This document lists the courses taken by the student at the university and is issued by the registrar.'];
    const ocr = parseExternalTranscript(lines, lines.map(() => 90)).courses;
    assert.deepEqual(ocr.map((c) => [c.courseId, c.sourceLines]), [['CS 50300', { from: 5, to: 5 }], ['CS 50400', { from: 6, to: 7 }]]);
    assert.ok(parseExternalTranscript(lines).courses.every((c) => c.sourceLines === undefined));
  });

  it('on a pinned scan (L5, a phone photo) each row\'s strip lies inside the page and holds the row\'s own words', () => {
    const page = pinned('l5-external-transcript-scan-p1');
    const read = ocrLinesFromPage(page.blocks, page.width, page.height, page.dpi / 72).map((l): OcrLine => ({ ...l, page: 1 }));
    const parsed = parseExternalTranscript([...read.map((l) => l.text), ''], [...read.map((l) => l.confidence), 100]);
    assert.equal(parsed.courses.length, 3);
    for (const c of parsed.courses) {
      const region = stripRegion(read, c.sourceLines, () => ({ width: page.width, height: page.height }));
      assert.ok(region, c.courseId);
      assert.ok(region.x >= 0 && region.y >= 0 && region.x + region.width <= page.width && region.y + region.height <= page.height, `${c.courseId} inside the page`);
      const box = read[c.sourceLines!.from]!.box!;
      assert.ok(region.x <= box.x0 && region.y <= box.y0 && region.x + region.width >= box.x1 && region.y + region.height >= box.y1, `${c.courseId}: the strip holds its line`);
      assert.ok(region.height < 4 * (box.y1 - box.y0), `${c.courseId}: one line, not a block of the page`);
    }
  });
});

describe('stripRegion, stripPageSize, scaledRegion', () => {
  const line = (page: number, x0: number, y0: number, x1: number, y1: number) => ({ page, box: { x0, y0, x1, y1 } });
  it('joins the span\'s lines on the first one\'s page, pads them, keeps them inside the page', () => {
    const lines = [line(1, 100, 100, 900, 120), {}, line(1, 120, 124, 600, 144), line(2, 0, 0, 50, 20)];
    assert.deepEqual(stripRegion(lines, { from: 0, to: 0 }, () => ({ width: 1000, height: 1300 })), { page: 1, x: 88, y: 93, width: 824, height: 34 });
    assert.deepEqual(stripRegion(lines, { from: 0, to: 3 }, () => ({ width: 1000, height: 1300 })), { page: 1, x: 88, y: 93, width: 824, height: 58 });
    assert.deepEqual(stripRegion([line(1, 2, 3, 990, 23)], { from: 0, to: 0 }, () => ({ width: 1000, height: 1300 })), { page: 1, x: 0, y: 0, width: 1000, height: 30 });
    assert.equal(stripRegion(lines, undefined, () => undefined), undefined);
    assert.equal(stripRegion([{}, { page: 1 }], { from: 0, to: 1 }, () => undefined), undefined);
  });
  it('keeps a small copy of a page and maps a region into it', () => {
    assert.deepEqual(stripPageSize(1836, 2376), { width: Math.round(1836 * (STRIP_PAGE_MAX_SIDE_PX / 2376)), height: STRIP_PAGE_MAX_SIDE_PX, scale: STRIP_PAGE_MAX_SIDE_PX / 2376 });
    assert.deepEqual(stripPageSize(1200, 1600), { width: 1200, height: 1600, scale: 1 });
    assert.deepEqual(scaledRegion({ page: 1, x: 100, y: 200, width: 800, height: 40 }, 0.5, { width: 600, height: 800 }), { page: 1, x: 50, y: 100, width: 400, height: 20 });
    assert.deepEqual(scaledRegion({ page: 1, x: 1100, y: 200, width: 400, height: 40 }, 0.5, { width: 600, height: 800 }), { page: 1, x: 550, y: 100, width: 50, height: 20 });
  });
});

describe('the scanned-line images are never saved, exported or put in localStorage (the DGS\'s test)', () => {
  // node has no DOM: a stand-in canvas whose pixels could only leave as a data: URL.
  const fakeCanvas = () => ({ width: 1300, height: 1700, toDataURL: () => 'data:image/png;base64,AAAA', getContext: () => null });
  const stored = new Map<string, string>();
  let exported: Blob | undefined;
  const saved: Record<string, PropertyDescriptor | undefined> = {};
  const createObjectURL = URL.createObjectURL;
  const revokeObjectURL = URL.revokeObjectURL;
  before(() => {
    for (const k of ['localStorage', 'document']) saved[k] = Object.getOwnPropertyDescriptor(globalThis, k);
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (k: string) => stored.get(k) ?? null, setItem: (k: string, v: string) => void stored.set(k, v), removeItem: (k: string) => void stored.delete(k) } });
    Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => ({ click() {}, href: '', download: '' }) } });
    URL.createObjectURL = (b: Blob) => {
      exported = b;
      return 'blob:test';
    };
    URL.revokeObjectURL = () => {};
  });
  after(() => {
    for (const [k, d] of Object.entries(saved)) {
      if (d) Object.defineProperty(globalThis, k, d);
      else delete (globalThis as Record<string, unknown>)[k];
    }
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
  });

  /** Every key and every string in a JSON value. */
  const walk = (v: unknown, keys: string[], strings: string[]): void => {
    if (typeof v === 'string') strings.push(v);
    else if (Array.isArray(v)) for (const x of v) walk(x, keys, strings);
    else if (v !== null && typeof v === 'object') for (const [k, x] of Object.entries(v)) {
      keys.push(k);
      walk(x, keys, strings);
    }
  };
  const assertClean = (what: string, json: string) => {
    const keys: string[] = [];
    const strings: string[] = [];
    walk(JSON.parse(json), keys, strings);
    assert.deepEqual(keys.filter((k) => /image|canvas|strip|scan|dataurl|bitmap|pixel|ocr|sourcelines|box/i.test(k)), [], `${what}: no image or OCR field`);
    assert.deepEqual(strings.filter((s) => /^data:|^blob:|base64,/i.test(s)), [], `${what}: no data: or blob: URL`);
    assert.doesNotMatch(json, /data:image|base64/i, what);
  };

  it('after Add: the record, its save and its export hold the courses — and no image, data: URL or OCR extra', async () => {
    const lines = ['Purdue University', 'Office of the Registrar', 'Official Academic Transcript', 'Student: Jane Q. Student', 'Fall 2023', 'CS 50300   Operating Systems   3.O   A', 'CS 58000   Algorithm Design   3.0   Bt', '', 'This document lists the courses taken by the student at the university and is issued by the registrar.'];
    const parsed = parseExternalTranscript(lines, lines.map(() => 70));
    const rows = parsed.courses.map((c) => previewRowOf(c, 'masters'));
    assert.deepEqual(rows.map((r) => r.ocrRead), [{ credits: '3.O' }, { grade: 'Bt' }], 'the rows carry the OCR extras the preview shows');
    assert.ok(parsed.courses.every((c) => c.sourceLines !== undefined));
    // The preview holds each row's strip beside it, in its own Map.
    const owner = {};
    const page = fakeCanvas();
    holdScanStrips(owner, new Map([[1, { canvas: page as unknown as HTMLCanvasElement, scale: 0.7 }]]), new Map(rows.map((r) => [r, { page: 1, x: 10, y: 10, width: 500, height: 30 }])));
    assert.equal(holdsScanStrips(owner), true);
    for (const r of rows) assert.ok(!Object.values(r).some((v) => v === page || (typeof v === 'object' && v !== null && 'canvas' in v)), 'no image on a row');
    // Add: each ready row becomes a course — the preview closes and lets its images go.
    const student: Student = emptyStudent();
    student.program = 'phd';
    for (const r of rows) student.courses.push(courseEntryOf({ ...r, year: r.year ?? 2023 }, { slot: 'masters' }, 'Purdue University'));
    releaseScanStrips();
    assert.equal(holdsScanStrips(owner), false);
    assert.equal(page.width, 0, 'the kept page copy is emptied when the preview closes');
    assert.equal(student.courses.length, 2);
    assert.deepEqual(student.courses.map((c) => [c.courseId, c.credits, c.grade]), [['CS 50300', 3, 'A'], ['CS 58000', 3, 'B+']]);
    // The record…
    assertClean('the student record', JSON.stringify(student));
    // …its localStorage copy…
    saveLocal(student);
    assert.equal(stored.size, 1);
    for (const v of stored.values()) assertClean('the localStorage save', v);
    // …and the exported file.
    exportFile(student, '2026-10-21');
    assert.ok(exported, 'exportFile handed the browser a file');
    assertClean('the JSON export', await exported.text());
  });

  it('the toggle and the image say what they are (W-CL413, W-CL414)', () => {
    assert.equal(SHOW_SCANNED_LINE, 'show the scanned line');
    assert.equal(SCANNED_LINE_LABEL, 'The scanned line this row was read from');
  });
});

it('the pinned pages all have boxes on every line the engine read', () => {
  for (const f of readdirSync(SCANS).filter((n) => n.endsWith('.blocks.json'))) {
    const page = pinned(f.replace('.blocks.json', ''));
    const lines = ocrLinesFromPage(page.blocks, page.width, page.height, page.dpi / 72);
    for (const l of lines) {
      assert.ok(l.box, `${f}: "${l.text}" has a box`);
      assert.ok(l.box.x1 > l.box.x0 && l.box.y1 > l.box.y0 && l.box.x0 >= 0 && l.box.y0 >= 0, `${f}: "${l.text}" box ${JSON.stringify(l.box)}`);
    }
  }
});
