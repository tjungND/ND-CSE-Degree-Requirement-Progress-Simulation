// PDF in / PDF out for the text-transcript sanitizer (2026-09-05). Kept apart
// from the CLI so tests can sanitize a fixture in-process and re-read it.
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createSanitizer } from './rules.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** pdfjs text runs per page, exactly what the app's pdf.ts sees. */
export async function readRuns(bytes) {
  const pdfjs = await import(pathToFileURL(join(root, 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.mjs')).href);
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), useWorkerFetch: false, isEvalSupported: false, disableFontFace: true }).promise;
  const pages = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const runs = [];
      for (const item of content.items) {
        if (!('str' in item) || item.str.trim() === '') continue;
        const [a, b, c, d, x, y] = item.transform;
        // `rotated` as in src/transcript/pdf.ts, so layout.ts drops diagonal watermarks the same way.
        runs.push({ x, y, text: item.str, width: item.width ?? 0, height: item.height ?? 0, a, b, c, d, rotated: Math.abs(b) > 0.01 || Math.abs(c) > 0.01 || a < 0 });
      }
      const [x0, y0, x1, y1] = page.view;
      // /Rotate is kept (2026-09-05): a landscape transcript stored as a
      // rotated portrait page must sanitize to the same orientation.
      pages.push({ width: x1 - x0, height: y1 - y0, x0, y0, rotate: page.rotate || 0, runs });
    }
  } finally {
    await doc.destroy();
  }
  return pages;
}

/** De-identify every page's runs; returns the new PDF and the sanitizer (for its report). */
export async function sanitizePdf(bytes, options = {}) {
  const pages = await readRuns(bytes);
  const { findColumnGap, dropWatermarks } = await import(pathToFileURL(join(root, 'src', 'transcript', 'layout.ts')).href);
  // Locate the column gap the way the app does: watermark tiles dropped first.
  const columnGap = (runs, width) => findColumnGap(dropWatermarks(runs), width);
  const sanitizer = createSanitizer({ ...options, columnGap });
  for (const page of pages) sanitizer.sanitizeRuns(page.runs, page.width);
  // Totals that agree with the rows, and each row's points from its new grade
  // (rules.mjs finish(); DGS 2026-10-11, item 12).
  const final = sanitizer.finish();
  pages.forEach((page, p) => {
    page.runs = page.runs.map((r, i) => ({ ...r, text: final[p][i] }));
  });
  return { pdf: buildPdf(pages), sanitizer, pages };
}

/** A PDF of positioned Courier runs, each horizontally scaled to the width
 * pdfjs measured for the original run, with the original rotation — so the
 * app reads the same geometry (column gaps, merged runs, watermark tiles). */
export function buildPdf(pages) {
  const esc = (s) =>
    [...s]
      .map((ch) => {
        const code = ch.charCodeAt(0);
        if (ch === '\\' || ch === '(' || ch === ')') return '\\' + ch;
        if (code < 32 || code > 255) return '?';
        if (code > 126) return '\\' + code.toString(8).padStart(3, '0');
        return ch;
      })
      .join('');
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', null, '<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>'];
  const kids = [];
  for (const page of pages) {
    let text = '';
    for (const r of page.runs) {
      const size = Math.hypot(r.a, r.b) || r.height || 8;
      const [ua, ub, uc, ud] = [r.a / size, r.b / size, r.c / size, r.d / size].map((v) => (Number.isFinite(v) ? v : 0));
      const courierWidth = 0.6 * size * r.text.length;
      const tz = courierWidth > 0 && r.width > 0 ? Math.min(1000, Math.max(5, (100 * r.width) / courierWidth)) : 100;
      text += `BT /F1 ${size.toFixed(2)} Tf ${tz.toFixed(1)} Tz ${ua.toFixed(4)} ${ub.toFixed(4)} ${uc.toFixed(4)} ${ud.toFixed(4)} ${(r.x - page.x0).toFixed(2)} ${(r.y - page.y0).toFixed(2)} Tm (${esc(r.text)}) Tj ET\n`;
    }
    const pageIndex = objects.length + 1;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${page.width.toFixed(2)} ${page.height.toFixed(2)}]${page.rotate ? ` /Rotate ${page.rotate}` : ''} /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageIndex + 1} 0 R >>`,
    );
    objects.push(`<< /Length ${Buffer.byteLength(text, 'latin1')} >>\nstream\n${text}\nendstream`);
    kids.push(`${pageIndex} 0 R`);
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${kids.length} >>`;
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefPos = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}
