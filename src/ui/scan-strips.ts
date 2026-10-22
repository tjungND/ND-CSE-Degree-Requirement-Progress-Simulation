// The scanned line beside an OCR preview row (transcript accuracy program,
// Batch C — the DGS's answer (5) of 2026-10-09: "The OCR preview shows a crop of
// the scanned line beside the fields of flagged rows, behind a 'show the scanned
// line' toggle on the others; in memory only, never saved or exported (a test
// asserts it)").
//
// The images live HERE, in a Map keyed by the preview's row objects, and
// nowhere else: not on a row (so nothing that copies, saves or exports a row
// can carry one), not in the student record, its JSON export or localStorage,
// and never as a data: URL — a strip is drawn straight from the kept page copy
// into a <canvas>. They are held for one preview (`owner`, the preview object)
// and dropped — their canvases emptied — when it closes: added, cancelled,
// replaced by another import, or the record reset (external-upload.ts calls
// `releaseScanStrips` at each). The pure half (which part of which page) is
// src/transcript/scan-strip.ts.
import type { OcrPageImage } from '../transcript/ocr.ts';
import { scaledRegion, type StripRegion } from '../transcript/scan-strip.ts';
import { el } from './dom.ts';

/** The one toggle's label (W-CL413) and the image's accessible name (W-CL414). */
export const SHOW_SCANNED_LINE = 'show the scanned line';
export const SCANNED_LINE_LABEL = 'The scanned line this row was read from';

interface Held {
  owner: object;
  pages: Map<number, OcrPageImage>;
  regions: Map<object, StripRegion>;
  /** Rows whose toggle the student opened — kept across re-renders. */
  open: Set<object>;
}
let held: Held | undefined;

/** Hold the page copies and each row's strip region for the preview `owner`
 * (the OCR route, once the preview is built). Any earlier preview's images
 * are released first. */
export function holdScanStrips(owner: object, pages: Map<number, OcrPageImage>, regions: Map<object, StripRegion>): void {
  releaseScanStrips();
  if (regions.size === 0 || pages.size === 0) {
    emptyPageImages(pages);
    return;
  }
  held = { owner, pages, regions, open: new Set() };
}

/** Empty page copies no preview will hold (the import was refused). */
export function emptyPageImages(pages: Map<number, OcrPageImage>): void {
  for (const page of pages.values()) empty(page.canvas);
  pages.clear();
}

/** Drop the images (the preview closed): every kept page copy is emptied at
 * once, so WebKit's canvas-memory count falls without waiting for a collection. */
export function releaseScanStrips(): void {
  if (held === undefined) return;
  emptyPageImages(held.pages);
  held.regions.clear();
  held = undefined;
}

/** True while images are held for `owner` — what a test, and the preview's
 * header cell, ask. */
export function holdsScanStrips(owner: object): boolean {
  return held !== undefined && held.owner === owner;
}

function empty(canvas: { width: number; height: number }): void {
  canvas.width = 0;
  canvas.height = 0;
}

/** The strip of one row, drawn from its page copy into a new canvas. */
function stripCanvas(page: OcrPageImage, region: StripRegion): HTMLCanvasElement | null {
  const r = scaledRegion(region, page.scale, page.canvas);
  if (page.canvas.width === 0) return null;
  const canvas = el('canvas', { class: 'scan-strip-image', role: 'img', 'aria-label': SCANNED_LINE_LABEL });
  canvas.width = r.width;
  canvas.height = r.height;
  // Shown across the card and shrunk to fit it, however narrow (DGS
  // 2026-10-10: "yes, shrink" — at phone width the 60 % floor it had hid the
  // credits and grade behind a sideways swipe); src/style-app.css.
  canvas.getContext('2d')?.drawImage(page.canvas, r.x, r.y, r.width, r.height, 0, 0, r.width, r.height);
  return canvas;
}

/** The scanned line of preview row `row` (index `i`) of preview `owner`:
 * shown at once for a flagged row, behind the "show the scanned line" toggle
 * otherwise; null when no strip is held for it (a text-layer import, a row
 * added by hand, a line no engine word made). */
export function scanStripFor(owner: object, row: object, i: number, flagged: boolean): HTMLElement | null {
  if (held === undefined || held.owner !== owner) return null;
  const region = held.regions.get(row);
  const page = region === undefined ? undefined : held.pages.get(region.page);
  if (region === undefined || page === undefined) return null;
  if (flagged) {
    const canvas = stripCanvas(page, region);
    return canvas ? el('div', { class: 'scan-strip', 'data-key': `ext.row.${i}.scan` }, canvas) : null;
  }
  const h = held;
  const details = el('details', { class: 'scan-strip scan-line' }, el('summary', { 'data-key': `ext.row.${i}.scan` }, SHOW_SCANNED_LINE));
  const fill = () => {
    if (details.querySelector('canvas') === null) {
      const canvas = stripCanvas(page, region);
      if (canvas) details.append(canvas);
    }
  };
  if (h.open.has(row)) {
    details.open = true;
    fill();
  }
  details.addEventListener('toggle', () => {
    if (details.open) {
      h.open.add(row);
      fill();
    } else h.open.delete(row);
  });
  return details;
}
