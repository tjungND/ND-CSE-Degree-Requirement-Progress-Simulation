# Pinned OCR pages (2026-10-09, transcript accuracy program, OCR step 9)

Nine degraded pages, one per level of the OCR benchmark's ladder, all from the generator PDFs in
`tests/fixtures/` (placeholder identities — Jane Q. Student, John Q. Boilermaker — never a real
record), pinned by `scripts/dev/ocr-bench/pin-pages.mjs` from the baseline run
`~/degree-audit-samples/bench-out/ocr-baseline-20261009/` (ladder seed 7, L0 at 200 dpi). Method and
numbers: `docs/OCR-BENCHMARK.md`.

| file | level | seed page | what |
|---|---|---|---|
| `l0-external-transcript-p1.png` | L0 | external-transcript p1 | clean raster, 200 dpi |
| `l1-nd-transcript-p1.jpg` | L1 | nd-transcript p1 | good scan: blur σ 0.6, JPEG q75, 200 dpi |
| `l2-banner-transcript-p1.jpg` | L2 | banner-transcript p1 | office scan: skew, noise σ 6, lighting gradient, JPEG q60, 150 dpi — the two-column Banner page |
| `l3-uc-system-transcript-p1.png` | L3 | uc-system-transcript p1 | photocopy: skew 2–3°, tone curve, salt-and-pepper, streaks, border band |
| `l4-combined-transcript-p1.jpg` | L4 | combined-transcript p1 | L1 + a drawn red seal over the table and a diagonal watermark |
| `l5-external-transcript-scan-p1.jpg` | L5 | external-transcript-scan p1 | phone photo: perspective, shadow, 1200–1600 px wide, JPEG q50 |
| `l6-90-nd-undergrad-transcript-p1.jpg` | L6-90 | nd-undergrad-transcript p1 | L1 turned 90° |
| `l6-180-external-transcript-p1.jpg` | L6-180 | external-transcript p1 | L1 turned 180° |
| `l7-nd-undergrad-in-progress-transcript-p1.pdf` | L7 | nd-undergrad-in-progress-transcript p1 | the L2 image wrapped with a deliberately poor invisible text layer — the app takes its exact text path on this one and never offers OCR |

Beside each page:

- `<name>.expected.json` — the page's ground-truth lines (`truthLines`, the exact path's reading of
  the clean page — L4's two degree lines re-read on 2026-10-15 as the browser reads them, the em
  dash the generator writes as byte 0x14 dropped, where the pinning read had kept "\u0014"), its
  expected rows (`expected.courses`, the parser on those lines; the ND pages
  carry `university` for "is this Notre Dame"), the ladder parameters the page was drawn with
  (`params`), the page image's pixel size (`width`, `height` — with `dpi`, the scale the line
  builder needs: dpi / 72 pixels per PDF unit), the OCR lines the app's pipeline builds from the
  engine's output on it (`ocrLines`, text + confidence — since OCR step 11 the word boxes through
  the layout stage, so a two-column page comes out column by column with its cells) and, for L7,
  the poor text layer as `pdfToLinesNode` reads it (`textLayerLines`).
- `<name>.blocks.json` (OCR levels only) — the engine's `blocks` output for the file, captured
  once with the baseline configuration and trimmed to blocks → paragraphs → lines (text,
  confidence, bbox, baseline) → words (text, confidence, bbox); symbols and alternative choices
  are dropped. The pure stage of OCR step 11 (2.1: word boxes → lines through the layout stage,
  `src/transcript/ocr-lines.ts`) is unit-tested against these without running the engine —
  `tests/ocr-lines.test.ts` pins each page's reading (`PINNED_READING`); the engine is
  deterministic, so a re-pin from the same bench folder reproduces the blocks byte for byte.

`npm run ocr-bench -- --pinned` OCRs the nine files as images (not through a PDF rendered at scale
3.0, so its numbers are not the ladder's) and scores them: a quick check that the engine still
reads what it read. Re-pin (`node --experimental-strip-types scripts/dev/ocr-bench/pin-pages.mjs
<bench-out-dir>`) only after a deliberate change to `degrade.py` or the generator, and say so in
the commit; the script refuses pages over 300 KB and a folder over 3 MB.
