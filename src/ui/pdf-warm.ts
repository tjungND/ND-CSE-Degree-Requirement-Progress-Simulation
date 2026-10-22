// Warm the transcript reader while the file picker is open (blue-team review
// 2026-10-17, W8 / onboard-10). The pdfjs chunk (~415 KB) and its worker
// (~1.4 MB) used to be fetched only after the student had chosen the file —
// the chunk by the change handler's `import('../transcript/pdf.ts')`, the
// worker by pdfjs on its first getDocument — so a first import waited behind
// "Reading the transcript…" for both, when the seconds spent in the picker
// could have covered them. The two Import buttons (nd-upload.ts,
// external-upload.ts) call this in their onclick, before the picker opens:
// nothing fires before a click, and nothing leaves the browser — both are
// this app's own bundled, same-origin assets (DECISIONS 2026-09-01: pdfjs
// bundled, no CDN). src/transcript/pdf.ts is untouched: it still sets
// workerSrc from the same URL, and the later Worker load hits the HTTP cache.
// The LEGACY path, as tests/browser-support.test.ts requires of every pdfjs
// import (cross-browser review, 2026-10-10).
//
// This module is loaded by `import('./pdf-warm.ts')` at the click, never
// statically: the `?url` import below is Vite's (it becomes the hashed asset's
// address at build time), and Node's test runner — which imports the two
// upload modules directly — would resolve it to the worker module itself and
// fail on its missing default export, as pdf.ts would if a test imported it.
//
// pdf.ts is imported statically: loading this module IS loading the reader
// (pdfjs and workerSrc), and the build keeps pdfjs, pdf.ts and the worker's
// URL in the one pdf chunk this module then depends on — a dynamic import
// here instead made Vite emit a 139-byte chunk holding the URL alone, one
// more request on the import path.
import '../transcript/pdf.ts';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

/** The worker is fetched once per page load; loading this module loaded the reader's chunk. */
let workerWarmed = false;

export function warmTranscriptReader(): void {
  if (workerWarmed) return;
  workerWarmed = true;
  // A failure here is not reported: the change handler's own import runs
  // next and says what went wrong, in the message the student already knows.
  try {
    void fetch(workerUrl).catch(() => undefined);
  } catch {
    // No fetch (an old browser): the worker loads as it always did.
  }
}
