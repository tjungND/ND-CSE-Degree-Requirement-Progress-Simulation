// A scan whose scanner embedded its own text (Batch C, the DGS's answer (6) of
// 2026-10-09: "A scan whose pages are all image-backed with an embedded text
// layer is treated as OCR-grade: rows editable and flagged, OCR offered —
// reverses the 2026-09-06 lock for that case only").
//
// Pinned: the operator-list test (`pageLayerFigures`) on composed lists — a
// scanner's page, a system-generated page printed over a background image, text
// hidden under the image, a logo, a form's own matrix, the rendering mode saved
// and restored — and on real PDFs: the committed L7 page (the bench's scanner
// layer) is a scan, every generator fixture with text is not; the parser reads
// such a layer OCR-grade (every row flagged, the scan-only repairs on); the
// preview's wording.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { pdfScanPagesNode, pdfToLinesNode } from '../scripts/dev/pdf-lines-node.mts';
import { parseExternalTranscript } from '../src/transcript/external.ts';
import { FULL_PAGE_IMAGE_SHARE, pageLayerFigures, SCANNER_LAYER_CONFIDENCE, type PdfLayerOps } from '../src/transcript/scanner-layer.ts';
import { SCANNER_LAYER_BANNER, SCANNER_LAYER_BANNER_LEAD, SCANNER_LAYER_KEEP, SCANNER_LAYER_OFFER, SCANNER_LAYER_ROW_FLAG, SCANNER_LAYER_ROW_FLAG_NAME, scannerLayerLead } from '../src/ui/external-upload.ts';

// pdfjs 4's operator codes (pdfjs.OPS) — the test feeds composed lists.
const OPS: PdfLayerOps = { save: 10, restore: 11, transform: 12, paintFormXObjectBegin: 74, paintFormXObjectEnd: 75, paintImageXObject: 85, paintInlineImageXObject: 86, paintImageMaskXObject: 83, setTextRenderingMode: 38, showText: 44, showSpacedText: 45, nextLineShowText: 46, nextLineSetSpacingShowText: 47 };
const LETTER = [0, 0, 612, 792];
type Op = [number, unknown];
const list = (...ops: Op[]) => ({ fnArray: ops.map((o) => o[0]), argsArray: ops.map((o) => o[1]) });
const fullPageImage: Op[] = [[OPS.save, null], [OPS.transform, [612, 0, 0, 792, 0, 0]], [OPS.paintImageXObject, ['img_p0_1', 1275, 1650]], [OPS.restore, null]];
const text = (n: number): Op[] => Array.from({ length: n }, (): Op => [OPS.showText, [[]]]);

describe('pageLayerFigures — is this page a scan with nothing visible over it?', () => {
  it('a scanner\'s page: one image over the whole page, its text invisible (mode 3)', () => {
    const f = pageLayerFigures(list(...fullPageImage, [OPS.setTextRenderingMode, [3]], ...text(59)), OPS, LETTER);
    assert.deepEqual(f, { imageShare: 1, textShown: 59, textOverImage: 0, imageBacked: true });
  });

  it('a system-generated page printed over a security-paper background draws its text VISIBLY over the image — not a scan', () => {
    const f = pageLayerFigures(list(...fullPageImage, ...text(40)), OPS, LETTER);
    assert.equal(f.imageBacked, false);
    assert.equal(f.textOverImage, 40);
  });

  it('text drawn first and covered by the scan, or clip-only text (mode 7), shows nothing — a scan', () => {
    assert.equal(pageLayerFigures(list(...text(30), ...fullPageImage), OPS, LETTER).imageBacked, true);
    assert.equal(pageLayerFigures(list(...fullPageImage, [OPS.setTextRenderingMode, [7]], ...text(5)), OPS, LETTER).imageBacked, true);
  });

  it('the rendering mode is restored with the graphics state: visible text after the restore is over the image', () => {
    const f = pageLayerFigures(list(...fullPageImage, [OPS.save, null], [OPS.setTextRenderingMode, [3]], ...text(3), [OPS.restore, null], ...text(2)), OPS, LETTER);
    assert.deepEqual([f.textShown, f.textOverImage, f.imageBacked], [5, 2, false]);
  });

  it('a logo, a seal or a quarter-page form image is no scan; a scan cropped by a margin still is', () => {
    const logo = pageLayerFigures(list([OPS.save, null], [OPS.transform, [100, 0, 0, 50, 20, 700]], [OPS.paintImageXObject, ['logo', 200, 100]], [OPS.restore, null], [OPS.setTextRenderingMode, [3]], ...text(4)), OPS, LETTER);
    assert.equal(logo.imageBacked, false);
    assert.ok(logo.imageShare < 0.02);
    const inForm = pageLayerFigures(list([OPS.paintFormXObjectBegin, [[0.5, 0, 0, 0.5, 0, 0], [0, 0, 612, 792]]], ...fullPageImage, [OPS.paintFormXObjectEnd, null], [OPS.setTextRenderingMode, [3]], ...text(4)), OPS, LETTER);
    assert.equal(inForm.imageShare, 0.25);
    assert.equal(inForm.imageBacked, false);
    const cropped = pageLayerFigures(list([OPS.save, null], [OPS.transform, [590, 0, 0, 770, 11, 11]], [OPS.paintImageXObject, ['img', 1200, 1600]], [OPS.restore, null]), OPS, LETTER);
    assert.ok(cropped.imageShare >= FULL_PAGE_IMAGE_SHARE && cropped.imageBacked, `share ${cropped.imageShare}`);
    // A sideways scan: the image turned a quarter onto a landscape page.
    const sideways = pageLayerFigures(list([OPS.save, null], [OPS.transform, [0, 612, -792, 0, 792, 0]], [OPS.paintImageXObject, ['img', 1650, 1275]], [OPS.restore, null]), OPS, [0, 0, 792, 612]);
    assert.equal(sideways.imageShare, 1);
  });

  it('a page with no image is no scan', () => {
    assert.deepEqual(pageLayerFigures(list(...text(121)), OPS, LETTER), { imageShare: 0, textShown: 121, textOverImage: 0, imageBacked: false });
  });
});

describe('on real PDFs', () => {
  it('the committed L7 page — a scan with the bench\'s deliberately poor invisible text layer — is a scan with text', async () => {
    const file = new URL('./fixtures/ocr-scans/l7-nd-undergrad-in-progress-transcript-p1.pdf', import.meta.url).pathname;
    const { everyPageScanned, pages } = await pdfScanPagesNode(file);
    assert.equal(everyPageScanned, true);
    assert.equal(pages[0]!.imageShare, 1);
    assert.ok(pages[0]!.textShown > 0);
    assert.ok((await pdfToLinesNode(file)).some((l) => /\S/.test(l)));
  });

  it('no generator fixture with a text layer is taken for a scan; the image-only scan fixture has no text', async () => {
    const dir = new URL('./fixtures/', import.meta.url);
    for (const name of readdirSync(dir).filter((f) => f.endsWith('.pdf'))) {
      const file = new URL(name, dir).pathname;
      const hasText = (await pdfToLinesNode(file)).some((l) => /\S/.test(l));
      const { everyPageScanned } = await pdfScanPagesNode(file);
      if (name === 'external-transcript-scan.pdf' || name === 'external-transcript-scan-clean.pdf') assert.deepEqual({ hasText, everyPageScanned }, { hasText: false, everyPageScanned: true }, name);
      // The one fixture that IS a scan with its scanner's text (item 13, 2026-10-11 — the OCR bench's L7).
      else if (name === 'scanner-layer-transcript.pdf') assert.deepEqual({ hasText, everyPageScanned }, { hasText: true, everyPageScanned: true }, name);
      else assert.equal(everyPageScanned && hasText, false, name);
    }
  });
});

describe('the parser reads a scanner\'s text OCR-grade', () => {
  const lines = ['Purdue University', 'Office of the Registrar', 'Official Academic Transcript', 'Student: Jane Q. Student', 'Fall 2023', 'CS 50300   Operating Systems   3.O   A', 'CS 58000   Algorithm Design   3.0   B+', '', 'This document lists the courses taken by the student at the university and is issued by the registrar.'];

  it('every row flagged, and the scan-only repairs apply (the numeric correction here); the same text as a text layer: nothing flagged, nothing corrected', () => {
    const scanner = parseExternalTranscript(lines, lines.map(() => SCANNER_LAYER_CONFIDENCE), { scannerLayer: true }).courses;
    assert.deepEqual(scanner.map((c) => [c.courseId, c.credits, c.grade, c.lowConfidence, c.ocrRead]), [['CS 50300', 3, 'A', true, { credits: '3.O' }], ['CS 58000', 3, 'B+', true, undefined]]);
    const exact = parseExternalTranscript(lines).courses;
    assert.deepEqual(exact.map((c) => [c.courseId, c.credits, c.grade, c.lowConfidence, c.ocrRead]), [['CS 50300', undefined, 'A', undefined, undefined], ['CS 58000', 3, 'B+', undefined, undefined]]);
  });

  it('the confidence is under the parser\'s floor (80): a line no engine of ours read is vouched for by nobody', () => {
    assert.ok(SCANNER_LAYER_CONFIDENCE < 80);
  });

  // Review fix 2026-10-10: at confidence 0 every row went through the junk-code
  // guard of our engine's poor lines, and real rows were dropped silently — the
  // answer wanted them editable and flagged.
  const asScanner = (l: string[]) => parseExternalTranscript(l, l.map(() => SCANNER_LAYER_CONFIDENCE), { scannerLayer: true }).courses;
  const ids = (cs: { courseId: string }[]) => cs.map((c) => c.courseId);
  it('no row the text path reads is dropped: short titles, lower-case subjects, decimal course numbers — each kept and flagged', () => {
    const table = ['Western State University', 'Office of the Registrar', 'Official Academic Transcript', 'Student: Sample Student', 'Fall 2023', 'Course   Title   Credits   Grade', 'CS 501   Dir Res   3   A', 'CS 502   Adv Top OS   3   A', 'CS 503   Sel Top AI   3   B', 'ART 101   Art   3   A', 'CS 504   Operating Systems   3   A', 'ee 501   Circuits and Signals   3   A', 'math 520   Real Analysis   3   B', '', 'This document lists the courses taken by the student at the university and is issued by the registrar.'];
    const text = parseExternalTranscript(table).courses;
    const scanner = asScanner(table);
    assert.equal(text.length, 7);
    assert.deepEqual(ids(scanner), ids(text));
    assert.ok(scanner.every((c) => c.lowConfidence === true));
    // SNU prints decimal course numbers ("4190.669"): all its rows — sixteen
    // since item 14 read its "M1522.001000" codes too — as on the text path.
    const snu = JSON.parse(readFileSync(new URL('./fixtures/public-transcripts/snu-english-transcript.json', import.meta.url), 'utf8')) as string[];
    assert.deepEqual(ids(asScanner(snu)), ids(parseExternalTranscript(snu).courses));
    assert.equal(asScanner(snu).length, 16);
  });

  it('our own engine\'s poorly read lines keep the guard (OCR plan step 2.5 (b)): the option is the scanner layer\'s alone', () => {
    const junk = ['Some University', 'Office of the Registrar', 'Official Academic Transcript', 'Fall 2023', 'ec   20   Grade distribution   3   A', 'CS 50300   Operating Systems   3   A', '', 'This document lists the courses taken by the student at the university and is issued by the registrar.', 'Credits are semester hours. Grades: A, A-, B+, B, B-, C+, C, D, F.'];
    assert.deepEqual(ids(parseExternalTranscript(junk, junk.map(() => 40)).courses), ['CS 50300']);
    assert.deepEqual(ids(asScanner(junk)), ['EC 20', 'CS 50300']);
  });
});

it('the preview says whose reading it is (W-CL416–W-CL420)', () => {
  assert.equal(scannerLayerLead('transcript.pdf'), '“transcript.pdf” is a scan that carries its scanner’s own reading of the text. ');
  assert.equal(SCANNER_LAYER_OFFER, 'The rows below were read from that reading — approximate, so every row can be edited and is marked ⚠. You can instead read the page images with the built-in text recognition (OCR), which replaces those rows: ');
  assert.equal(SCANNER_LAYER_KEEP, 'Keep the rows below');
  assert.equal(SCANNER_LAYER_BANNER_LEAD + SCANNER_LAYER_BANNER, 'Read from the text your scanner embedded in this scan — approximate. That text is the scanner’s own recognition, so every row is marked ⚠: check every field against your transcript before adding.');
  assert.equal(SCANNER_LAYER_ROW_FLAG, 'Read from the scanner’s embedded text — check it carefully');
  assert.equal(SCANNER_LAYER_ROW_FLAG_NAME, 'read from the scanner’s text');
});
