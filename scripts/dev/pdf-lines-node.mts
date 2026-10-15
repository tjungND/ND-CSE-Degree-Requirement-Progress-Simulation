// The one Node-side PDF loader for the dev scripts (2026-10-09, transcript
// accuracy program, Batch A): pdfjs's legacy build run in node, through the
// SAME layout stage the browser uses (`runsFromTextItems` → `runsToLines` in
// src/transcript/layout.ts), and opened as src/transcript/pdf.ts opens it —
// WITHOUT pdfjs's standard-font folder — so a line list made here is exactly
// what the app hands the parser. The review of 2026-10-15 ran the app's own
// reader (`pdfToLinesForImport`) in Chrome and WebKit: its lines equalled this
// read, and differed from a read WITH the folder wherever a glyph lies outside
// its font's encoding (tests/fixtures/combined-transcript.pdf's em dash,
// written as byte 0x14: the folder's read keeps "\u0014", the browser drops
// it). The default has been the browser's since 2026-10-15 (before, the
// folder was named, and the dev tools kept such glyphs); `standardFonts: true`
// still asks for the folder — the diagnosis's comparison read, and the page
// renderer below, which draws no base-14 text without it.
// scripts/dev/pdf-to-lines.mts, scripts/dev/replay.mts,
// scripts/dev/make-nd-corpus.mts, scripts/diagnose-transcript.mjs and the OCR
// bench all call this instead of carrying their own pdfjs loop.
//
// FERPA: this module prints nothing and keeps nothing; what a caller does with
// the verbatim lines is the caller's rule (pdf-to-lines.mts: public documents
// only; diagnose-transcript.mjs: shapes only).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pageLayout, runsFromTextItems, type ColumnHint, type Run } from '../../src/transcript/layout.ts';
import { paintedImageSizes, scanResolution } from '../../src/transcript/ocr-lines.ts';
import { pageScanLayer, type PageLayerFigures } from '../../src/transcript/scanner-layer.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** What the layout stage read from one page, for callers that report
 * structure (diagnose-transcript.mjs) as well as the lines. */
export interface PageRuns {
  /** 1-based. */
  page: number;
  /** In the page's reading orientation, as `runsFromTextItems` gives them. */
  runs: Run[];
  /** The page width in that orientation. */
  width: number;
  /** The page was turned upright (its content was drawn sideways). */
  turned: boolean;
  /** This page's lines, as `runsToLines` gives them (no page-break line). */
  lines: string[];
}

// pdfjs's legacy build is the one that runs in node; loaded by file URL so the
// package's browser entry is never resolved. Loaded once.
let pdfjsModule: Promise<any> | undefined;
function pdfjs(): Promise<any> {
  pdfjsModule ??= import(pathToFileURL(join(root, 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.mjs')).href);
  return pdfjsModule;
}

/** Open a PDF the way every dev script should: no worker fetch, no eval, no
 * font faces (node has none), pdfjs's own warnings silenced (verbosity 0 —
 * pdfjs prints them through console.log, which would land in a script's JSON
 * output), and — by default, as the app's own pdfjs (src/transcript/pdf.ts)
 * is opened — no standard-font folder (2026-10-15). `standardFonts: true`
 * names the folder, for a caller that asks for it (above). */
async function openDocument(file: string, { standardFonts = false }: { standardFonts?: boolean } = {}): Promise<any> {
  const lib = await pdfjs();
  const data = new Uint8Array(readFileSync(file));
  return lib.getDocument({
    data,
    useWorkerFetch: false,
    isEvalSupported: false,
    disableFontFace: true,
    verbosity: 0,
    ...(standardFonts ? { standardFontDataUrl: join(root, 'node_modules', 'pdfjs-dist', 'standard_fonts') + '/' } : {}),
  }).promise;
}

/** The text lines of a PDF, exactly as the browser's `pdfToLines` reads them:
 * each page's runs in reading orientation → lines, with an empty line after
 * every page (the page break the parser expects). `onPage` receives each
 * page's runs and lines as they are read; `options.standardFonts: true` opens
 * it with the standard-font folder instead — not the browser's read (above). */
export async function pdfToLinesNode(file: string, onPage?: (page: PageRuns) => void, options: { standardFonts?: boolean } = {}): Promise<string[]> {
  const doc = await openDocument(file, options);
  const lines: string[] = [];
  // The previous page's column layout, as the browser passes it (F4, 2026-10-09).
  let hint: ColumnHint | undefined;
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const viewport = page.getViewport({ scale: 1 });
      const { runs, width } = runsFromTextItems(content.items.filter((it: { str?: string }) => 'str' in it), viewport);
      const read = pageLayout(runs, width, hint);
      hint = read.hint;
      const pageLines = read.lines;
      onPage?.({ page: p, runs, width, turned: width !== viewport.width, lines: pageLines });
      lines.push(...pageLines);
      lines.push('');
    }
  } finally {
    await doc.destroy();
  }
  return lines;
}

/** Whether every page of a PDF is a scan — one image covering the page and no
 * text visible over it — as src/transcript/pdf.ts's `pdfToLinesForImport` asks
 * it (Batch C answer (6), 2026-10-09; the same `pageScanLayer`), with each
 * page's figures. Unlike the browser it reads every page (for the figures)
 * and does not look at the text: the browser's `scannedTextLayer` is this
 * AND a text layer with anything in it. */
export async function pdfScanPagesNode(file: string): Promise<{ everyPageScanned: boolean; pages: PageLayerFigures[] }> {
  const lib = await pdfjs();
  const doc = await openDocument(file);
  const pages: PageLayerFigures[] = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) pages.push(await pageScanLayer(await doc.getPage(p), lib.OPS));
  } finally {
    await doc.destroy();
  }
  return { everyPageScanned: pages.length > 0 && pages.every((f) => f.imageBacked), pages };
}

/** Render every page of a PDF to a PNG at `dpi` (72 = the page's own size),
 * named `<pdf base name>-p<page>.png` under `outDir` (created if missing);
 * returns the paths in page order. For the OCR bench: a line list rendered
 * back to pages, or a public PDF rendered for degradation. Uses pdfjs's legacy
 * build with @napi-rs/canvas, which pdfjs-dist installs as its optional
 * dependency — when that package is missing (an `npm ci --omit=optional`, an
 * unsupported platform) the error says so instead of failing inside pdfjs. */
export async function pdfToPagePngs(file: string, dpi: number, outDir: string): Promise<string[]> {
  if (!(dpi > 0)) throw new Error(`pdfToPagePngs: dpi must be positive, got ${dpi}`);
  return (await pdfToPagePngsAt(file, () => dpi, outDir)).map((p) => p.path);
}

/** One rendered page of `pdfToPagePngsAt`: where it went, the dpi it was
 * rendered at, and the page's size in PDF units (points) at scale 1. */
export interface RenderedPage {
  page: number;
  path: string;
  dpi: number;
  widthPt: number;
  heightPt: number;
  /** The scan's own resolution (`scanResolution`), undefined for a page that paints no image. */
  scanDpi: number | undefined;
}

/** `pdfToPagePngs` with the dpi chosen PER PAGE from the page's size and its
 * scan's resolution — the OCR bench's `--scale auto` (OCR step 12,
 * 2026-10-09), which renders each page as src/transcript/ocr.ts does with
 * `ocrRenderScale(width, height, scanDpi)`: `dpiOf` receives the page number,
 * its size in points (in its own rotation, as pdfjs reports it) and the
 * resolution of the image it paints, and returns the dpi. */
export async function pdfToPagePngsAt(file: string, dpiOf: (page: { page: number; widthPt: number; heightPt: number; scanDpi: number | undefined }) => number, outDir: string): Promise<RenderedPage[]> {
  let canvasLib: { createCanvas: (w: number, h: number) => any };
  try {
    canvasLib = await import('@napi-rs/canvas');
  } catch (e) {
    throw new Error(`pdfToPagePngs: @napi-rs/canvas is not available (${e instanceof Error ? e.message : String(e)}); it is pdfjs-dist's optional dependency — reinstall with \`npm ci\` without --omit=optional.`);
  }
  mkdirSync(outDir, { recursive: true });
  const stem = basename(file).replace(/\.pdf$/i, '');
  const lib = await pdfjs();
  // WITH the standard-font folder, unlike the line reads: node has no font
  // faces, so without it pdfjs paints no text set in a base-14 font it does
  // not embed (every generator PDF — nd-transcript.pdf's first page rendered
  // blank, 0 dark pixels against 30,935 with the folder, 2026-10-15). The
  // browser paints such text with a system font; the app OCRs only scans,
  // whose page is an image either way.
  const doc = await openDocument(file, { standardFonts: true });
  const out: RenderedPage[] = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const base = page.getViewport({ scale: 1 });
      const scanDpi = scanResolution(await paintedImageSizes(page, lib.OPS), base.width, base.height);
      const dpi = dpiOf({ page: p, widthPt: base.width, heightPt: base.height, scanDpi });
      if (!(dpi > 0)) throw new Error(`pdfToPagePngs: dpi must be positive, got ${dpi} for page ${p}`);
      const viewport = page.getViewport({ scale: dpi / 72 });
      const canvas = canvasLib.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const ctx = canvas.getContext('2d');
      // Paper is white; pdfjs paints only what the page draws.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      const path = join(outDir, `${stem}-p${p}.png`);
      writeFileSync(path, canvas.toBuffer('image/png'));
      out.push({ page: p, path, dpi, widthPt: base.width, heightPt: base.height, scanDpi });
    }
  } finally {
    await doc.destroy();
  }
  return out;
}
