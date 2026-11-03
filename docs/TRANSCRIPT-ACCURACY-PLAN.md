# Transcript import accuracy — the program (DGS request 2026-10-09)

The DGS asked, on 2026-10-09: "1. Improve the accuracy of the transcript import function for non-OCR type
importing. Gather as many transcript sample/example as possible, and use them to improve the function.
2. Improve the accuracy of OCR-type transcript importing. Install the best state-of-the-art OCR and/or
gather as many examples/samples of image/scanned transcripts as possible and use them to improve the
accuracy." He then asked for everything to be auto-approved; the work proceeds in measured batches, each
committed with its before/after numbers, and only the questions that reverse a recorded decision or set
policy go back to him (listed at the end).

This file is the plan and the research record, written so a future DGS can repeat or extend the work
without the original author or this session. The read-only research behind it was done on 2026-10-09 by
nine agents (three code readers, three web researchers, two designers, one critic); the critic's
adjustments are folded in below.

## 1. Where things stand (measured on 2026-10-09)

- Text-layer import: `tests/public-transcripts.test.ts` pins 127 public line-list fixtures (95 positive,
  32 `negative` keys/legends/forms): 122 pass, 5 are on `public-transcripts-known-failing.json` and must
  keep failing until the DGS answers the 2026-09-26 questions (CC15 code-less rows, CC16 side-by-side
  semesters, TH02 Thai calendar). `tests/ms-transcripts.test.ts` pins 48 synthetic US master's layouts
  (648 rows). Accuracy today is pass/fail per fixture on exact row strings — one missed row makes the
  whole fixture "wrong", nothing scores a folder of PDFs, and `scripts/dev/public-status.mts` disagrees
  with the test on negatives ("95 pass, 32 fail" vs 122/127).
- OCR import: tesseract.js 7 (Tesseract 5.1 core, `eng` best_int model), 6.6 MB self-hosted in
  `public/ocr/`, pages rendered at scale 3.0 (216 dpi), PSM left at the default 6, no DPI hint, every run
  of whitespace collapsed to one space before the parser sees the line (`src/transcript/ocr.ts`), so no
  OCR line ever reaches the parser's column-mapped path — only the position-free token scan. No OCR
  accuracy number exists anywhere; the only scan fixture is a clean Pillow-rendered page.

### Text-layer failure modes found (probes on 2026-10-09)
- Code-less transcripts read nothing (CC15, DGS-decided): cairo, chesicc-verification-report, nankai-graduate-record, sjtu-lifelong-template — rows have course NAMES only; leadCode (external.ts:1376) requires a code, so the page offers hand entry.
- Side-by-side semesters (CC16): sjtu-lifelong-template prints two terms as left/right halves of one table; groupLines merges them and only the first course per line survives (fixture diff: 20 rows missing).
- Thai calendar (TH02): chulalongkorn 'First Semester 2022' reads spring 2022, expected fall (readTermLine calendar-order rule, external.ts:1685); same fixture also wants degreeConferred from 'Degree: Master of Engineering' + 'Date of Graduation: 30 June 2024' on ADJACENT lines — open question (f), same-line evidence required (2026-09-03).
- Two-column page with fewer than 40 runs is never split (layout.ts:244): probed a merged line 'CS 445 … 12.00   Spring 2014' / 'CS 525 … CS 530 …' → CS 445 took the right column's term (spring 2014), CS 525 kept fall 2013, CS 530 was lost. Likely on the short last page of a Banner transcript.
- A wrapped title whose continuation line carries ≥4 wordy words plus the numbers drops the row entirely (readCourseRow external.ts:1845, nextWordy ≤ 3): probed 'CS 500   Advanced Topics in Distributed' / 'Systems and Cloud Infrastructure Design   3   A' → no row. With ≤3 words it reads correctly.
- A code printed alone on its line with title and numbers on the next line yields no row (external.ts:1834 requires titleParts before trying the continuation): probed 'CS 500' / 'Advanced Topics   3   A' → [].
- Gradeless row ending in quality points, no header line: 'CS 500   Topics   3   12.0' → rawGrade '12.0' (scanTokens external.ts:1133 numericGrade fallback); the header-mapped path handles it (lastNumeric, line 1234) but the position-free path does not.
- In-progress row whose title ends in a digit with 1–2-decimal credits and no grade: 'MATH 1220   Calculus 2   3.0' → title 'Calculus', credits 2, rawGrade '3.0' (integerInTitle external.ts:992 needs a grade token after the credits).
- Numeric scales are never mapped: a 10-point '9', German '1,7', a 100-point mark all stay raw for the student; S/E/N/P meanings come only from the transcript's own legend (open question (g)) — Anna University S=10 without a key reads as the app's S.
- Quarter/trimester is one flag per transcript (quarterSystem external.ts:1965): a record mixing quarter and semester terms (Cincinnati/Ohio State conversions, probed Autumn Quarter 2019 + Fall Semester 2021) flags the WHOLE transcript as quarter — open question (d). Unit-based credits (CMU, Penn, UChicago, MIT) keep printed values — open (c).
- Column-header reader knows only Latin-script header words (COLUMN_KIND_RES external.ts:454; TERM_WORD_RE has 学期 only): CJK, Arabic, Cyrillic headers fall back to the position-free scan; CJK grade characters map only after titleDone.
- ANU pin keeps two known artefacts (sources.json note): a letter-spaced row reads 'XAM 25 | 01 C LASS 7', and 'CLASS 29   16   STI *' reads 29 as credits (two-digit units look like a mark).
- Glyph-per-item PDFs are joined only when ≥60% of a page's runs are single characters over ≥20 runs (layout.ts:191); a page between ~40–59% would still read letter-spaced words.
- Workday Student layouts have no fixture in either corpus (grep finds none); a probe of 'Course Listing | Grade | Units | Earned | Grade Points' with 'CS 101 - Introduction to Programming   A   3   3   12' read correctly, but 'Course Listing' is not a known header word, so such rows go through the position-free scan and the term header '2023 Fall Semester (09/05/2023-12/15/2023)' is untested beyond this probe.
- Ambiguous slashed dates ('05/06/2023') are left to dateOnLine's US reading unless the document has one unambiguous day-first date (dayFirstDocument external.ts:875).
- Row year can be polluted by a stray year on the same line that is not in the title (rowYear, external.ts:1895) — the merged-column probe above is one instance.
- public-status.mts does not honour `negative`, so its headline count (95/32) overstates failures by 27 relative to the test.

### OCR failure modes found
- Column structure destroyed: ocr.ts:89 collapses all whitespace to one space (and Tesseract's default preserve_interword_spaces=0 already does), so every cell split on \s{2,} / \s{3,} in external.ts (480, 808, 1382, 1697, 1712, 1733, 1839, 1918) and the header-mapped scanWithMap path never fire for OCR; rows only reach the position-free scanTokens.
- Wrong page-segmentation assumption: PSM is the API default 6 SINGLE_BLOCK (nothing sets it; api.md table) — two-column Banner-style scanned official transcripts are spliced across columns, the very defect layout.ts splitColumns fixes for text PDFs; OCR bypasses layout.ts entirely.
- No DPI: canvas → toBlob PNG without pHYs (loadImage.js:55) → Tesseract assumes 70 dpi (api.md user_defined_dpi note) — line finding/noise thresholds mis-sized.
- Resolution: fixed RENDER_SCALE 3.0 = 216 dpi (ocr.ts:47; handoff 1230 says 2.5 — stale) downsamples 300/600-dpi embedded scans and leaves 7-9 pt print at ~10-13 px x-height, under the LSTM sweet spot.
- No deskew/orientation: rotateAuto unused; no OSD possible with LSTM-only data (worker.detect needs legacyCore/legacyLang); a 90°/180° scan yields junk with no fallback but 'add by hand'.
- Confidence is line-level only (ocr.ts:90, external.ts:1875-1909): a confident line with one wrong digit (3.0→3.6 at 85) is flagged only by oddCredits; term headers, university, level blocks and conferral lines carry no confidence, so a misread 'Fall 2O23' silently mis-years a whole block; the 80 floor is untested against real scans.
- 'Unofficial' on scans: isUnofficial (external-upload.ts:552-561) is exact-regex on OCR lines — 'UNOFFlClAL'/'UN0FFICIAL' escape, and diagonal stamps/watermarks are rotated text the LSTM does not read, so the 2026-09-15/09-17 warning rarely fires on scans.
- Scanner-embedded text layers: hasTextLayer = ≥200 non-space chars (external.ts:865) — a scan whose scanner/registrar already embedded (poor) OCR text goes down the exact path: rows LOCKED (external-upload.ts:950), no flags, no OCR offer unless zero course lines parse (671-679); no image-backed-page detection exists (no getOperatorList/paintImageXObject use anywhere).
- Engine time wasted: tessedit_do_invert default on (re-runs weak lines inverted); each page's canvas encoded to PNG; pages sequential; in-page engine progress not shown (logger used only for load).
- WebKit bounds: single-file corePath (ocr.ts:60) means no feature-detected relaxed-SIMD/non-SIMD fallback (getCore.js); any DPI increase must respect iOS Safari's canvas area cap (~16.7 MP / 4096 px — a too-large canvas renders blank, OCR then reads nothing) and WASM memory on phones.
- Test fixture is unrealistic: make-scan-fixture.py renders clean Arial/DejaVu text at 150 dpi, no noise/skew/security paper; the e2e fills missing credits/years by hand without asserting how many were missing.
- Stale/incidental: ocr.ts:12-29 polyfills written for pdf.js v6 while pdfjs is pinned ^4.10.38; MAX_PAGES 10 note in the preview only when exceeded.

## 2. The plan, in order

Principle: measure first; grow the corpus only from public or composed material (FERPA: never a real
record, never a student's name, sanitized copies only outside the repo); fix by failure family, each
change pinned by a fixture and recorded in `docs/DECISIONS.md`; improve the bundled Tesseract pipeline
before any new engine; verify on Chrome and WebKit.

### Batch A — measurement harness, first fixes, new specimens (text)
1. **One scorer** `scripts/dev/score.mts` (pure): `scoreDocument(parsed, expected)` → header-field
   cells, row alignment by course id (+ year), per-field cell accuracy (title, credits, grade, term,
   level), rows matched/missing/extra; `negative` fixtures score rows only (the test's rule). `rowOf`
   moves to `tests/helpers/row-of.ts` and every test and script imports it from there (nothing imports
   from a `*.test.ts` file). `tests/replay-score.test.ts` pins the metric on three tiny cases.
2. **One Node pdfjs loader** `scripts/dev/pdf-lines-node.mts`: `pdfToLinesNode(file)` (the browser's own
   `runsFromTextItems`/`runsToLines`) and `pdfToPagePngs(file, dpi)` (pdfjs legacy + `@napi-rs/canvas`,
   already installed as pdfjs-dist's optional dependency); `pdf-to-lines.mts`, `diagnose-transcript.mjs`
   and the OCR bench call it.
3. **Replay** `npm run replay -- [--corpus public|ms|all] [--pdfs <dir>] [--only s] [--out f] [--baseline f]`:
   scoreboard per corpus and per family (row recall/precision, cell accuracy per field, false rows on
   negatives, known-failing status), deltas against a baseline with regressions first. `public-status.mts`
   becomes an alias. The outside folder is `$TRANSCRIPT_SAMPLES` (default `~/degree-audit-samples/`):
   `public-pdfs/` (rebuildable from the SHA-256s in `sources.json`), `private/` (the DGS's synthetic
   PDFs and sanitized scans — never listed by name in any committed file), `bench-out/`.
4. **Parser fixes F1–F3** (`src/transcript/external.ts`), each with a `tests/public-transcript-rules.test.ts`
   case and a replay delta showing zero new rows across all 32 negative fixtures:
   - F1 continuation: a code alone on its line, then title + numbers; a wrapped title whose continuation
     carries ≥4 words AND ends in credits + grade. The points-vs-grade rule reads a trailing two-decimal
     number as points only when a `points` column was mapped by the header or the row has the
     credits/earned/points triple — never from the product test alone (a 20-point mark stays `rawGrade`).
     `integerInTitle` for an in-progress row only inside an in-progress block or under a header with no
     grade/mark column.
   - F2 terms: `2023FA`/`2024SP` and six-digit Banner codes only from a header-mapped `term` cell or the
     first cell of a row whose second cell is the course code; Workday `2023 Fall Semester (09/05/2023-…)`.
   - F3 codes: `ENG M 612`, `CS 101 - Title`, `CS-101 01 Title`.
   - F5 precondition first: `tests/external-names.test.ts` — every university name in the rules fixtures
     and in `data/snapshot.json`'s ExternalCourses tab must keep being read unchanged (the 2026-10-07 rule).
5. **New public specimens** (each download approved by the standing auto-approval, each opened in the
   scratchpad first to confirm the printed name is a placeholder, recorded in `sources.json.note`):
   Alberta CR/NC sample (PeopleSoft SQR, "Sample One/Two Student"), Evergreen sample RAA (CC15,
   known-failing), Hampshire key, Western Ontario legend, ARUCC guidelines, Parchment authentication page,
   Algeria MESRS template (negatives), and the twelve MIT-licensed synthetic McGill Minerva PDFs
   (licence and generator verified at a pinned commit; line lists + converted expectations committed,
   PDFs outside the repo; no parser rule may rest on them alone).

### Batch B — composed layouts and geometry (text)
6. Composed line lists, one per family, in applicant-pool order: Workday Student (UBC/WashU/Stevens
   style — no public text specimen exists; one sanitized Workday PDF from a consenting student would
   validate the family), CUNYfirst, Ellucian Colleague (term as the last cell of every row), McMaster
   Mosaic, Oregon Banner quarter, UCLA electronic transcript, IIT grade card, Pakistan HEC semester
   table, Sabanci dual-credit, SNU English transcript, Iran translator rendering, Ladok verifiable,
   Ukraine supplement; wrapper variants (Parchment page, NSC certification page, eScrip-Safe cover sheet)
   around existing fixtures. Composed from registrar documentation only — never from an exposed real
   record (the research found many; they are listed in §4 as never-to-open).
7. Positioned PDFs via `tests/fixtures/make-transcript-pdfs.mjs`: a Banner transcript with a short
   two-column last page; a Parchment-wrapped Banner transcript; (if CC16 is approved) side-by-side terms.
8. **F4 layout** (`src/transcript/layout.ts`): a short page splits at the previous page's column gap when
   its runs line up with it and nothing crosses it — pinned with the one-column legend page of
   `banner-transcript.pdf` unchanged and a run-array case for a short one-column last page; per-line
   glyph join with a run-array fixture modelled on the insideND glyph-per-item page. **F5** vendor
   wrappers never name the university. **F6** header words (`Course Listing`, `Grade Remark`,
   `Units Taken/Passed`, `Class Avg`, `TM`, `MEDIAN`, …).

### OCR — benchmark, then the bundled pipeline, then (maybe) a second engine
9. **Benchmark** `scripts/dev/ocr-bench/` (dev only, never in `npm test`): seeds = the generator PDFs,
   the 34 public `pdf-*` PDFs (negatives measure false rows under noise), line-list fixtures rendered to
   pages (regression only — a layout no registrar printed), synthetic bilingual pages for the countries
   with no safe public image; degradation ladder in Pillow + numpy only (L0 clean, L1 good scan, L2
   office scan, L3 photocopy, L4 stamped/watermarked with a drawn seal — never a real one, L5 phone
   photo, L6 rotated, L7 scanner-embedded text layer), seeded, re-wrapped as image-only PDFs so the real
   `ocrPdfToLines` path runs; `ocr-run.mjs` (grown from `scripts/dev/ocr-lines.mjs`, same engine and
   assets, knobs for scale/PSM/dpi/interword/threshold/rotateAuto, imports the same line builder the
   browser uses); scoring through the one scorer plus line CER, flag precision/recall and seconds per
   page. `--quick` (one seed per family × L0/L2/L5 × one dpi, minutes) for every A/B; the full ladder
   only for the baseline and the sign-off (≈5 h of machine time each). Output goes to
   `$TRANSCRIPT_SAMPLES/bench-out/`, never under the repo; `docs/OCR-BENCHMARK.md` carries per-file rows
   for public/synthetic seeds and ONE aggregate line for the private set. 8–10 pinned synthetic pages
   (≤3 MB) go under `tests/fixtures/ocr-scans/` with their expected rows and captured `blocks` JSON, so
   `tests/ocr-lines.test.ts` tests the pure stage without the engine.
10. **First measured OCR commit**: `preserve_interword_spaces: '1'` via `worker.setParameters` and the
    removal of the whitespace collapse in `src/transcript/ocr.ts`, measured on `--quick` against the
    baseline.
11. **2.1 Word boxes → `layout.ts`**: new pure `src/transcript/ocr-lines.ts` builds `Run{x, y, text, width}`
    from Tesseract's word boxes (each word at its line's baseline) and feeds `runsToLines`, which gives
    column gaps, two-column splitting and watermark dropping for free; per-line confidence = min word
    confidence; `OCR_CONFIDENCE_FLOOR` re-calibrated from the bench. (Not in parallel with F4: both edit
    `layout.ts`.)
12. **2.2–2.4**: PSM 4 vs 6 vs 11, `user_defined_dpi`, render at 300 dpi behind a pure
    `ocrRenderScale(pageWidthPt, pageHeightPt)` with the 16 MP / 4096-px cap and a unit test (desktop
    WebKit cannot exercise iOS limits), `rotateAuto`, thresholding proven with `imageBinary`, a white
    border; the four-rotation trial on page 1 for sideways scans. Each an A/B on `--quick`.
13. **2.5–2.7** (after the DGS's answers on numeric corrections and image strips): per-column second
    pass with `rectangle` + whitelist; OCR-aware term-header repair and an OCR-tolerant `isUnofficial`
    that each raise a warning rather than silently changing a value; cell-level flags and an in-memory
    image strip (never saved or exported — a test asserts it).
14. **Engine gate**: PaddleOCR PP-OCRv6_tiny via the MIT `paddleocr` runtime on onnxruntime-web
    (≈17.5 MB first download, single-threaded WASM on Safari — COOP/COEP is impossible on GitHub Pages and
    in the cse.nd.edu iframe) is the only candidate under 20 MB that helps where Tesseract is weak (phone
    photos, skew). It is run OFFLINE first, in `scripts/dev/ocr-bench/engine-gate/` with its own
    `package.json` (root `npm ci`, the sync Action and the Pages deploy never install onnxruntime), and
    adopted only if it scores ≥10 points higher row accuracy than the improved Tesseract on the
    office-scan/photocopy/stamped/phone levels at ≤2× time and passes the WebKit e2e — as a SECOND opt-in
    whose sentence names its size. `tests/ocr-assets.test.ts` keeps `public/ocr/` ≤ 7.5 MB until the DGS
    raises it. `ocrs` (CC-BY-SA weights), tesseract-wasm (same engine), TrOCR/Florence/Donut/GLM-OCR
    (64–650 MB, WebGPU, no iOS) are out.

### Batch C — the questions only the DGS can answer (nothing lands before his numbered answer)
CC15 code-less rows (import with an empty required id box, unticked until filled, `''` never reaching
`canonicalCourseId`/the review request), CC16 side-by-side terms, TH02 (a country-level calendar table in
code beside `readTermLine`), adjacent-line graduate conferral (both labels required), OCR numeric
corrections shown beside the raw reading, image strips, scanner-embedded poor text layers treated as
OCR-grade, the schema-bound questions (c)/(d)/(g) deferred.

## 3. Verification, records, effort
Every batch: `npx tsc --noEmit`, `npm test`, `npm run build`, `npm run replay -- --baseline before.json`
(no regression line; scoreboard pasted into the reply and into `docs/STATE.md`), `npm run e2e` and
`E2E_BROWSER=webkit npm run e2e` whenever a PDF fixture, the OCR path or the preview changes;
`public-status` must still fail the known-failing five until Batch C. A committed `tests/README.md`
paragraph and `MAINTENANCE.md` section say how to run the replay and the bench and how to add a seed.
DECISIONS rows: the metric; each interpretation; the benchmark; the engine gate and its outcome.
Effort (critic-adjusted): Batch A ≈ 20 h, Batch B ≈ 20 h, OCR benchmark ≈ 25 h + pipeline ≈ 35 h,
Batch C ≈ 12 h, engine gate ≈ 6 h (+24–30 h if adopted) — ≈ 140 h over several sessions.

## 4. Research record

### 4.1 In-browser OCR engines (October 2026)
| Engine / resource | Licence | Size | Usable | Notes | URL |
|---|---|---|---|---|---|
| tesseract.js 7.0.0 (current engine) + tessdata variants | Apache-2.0 (tesseract.js, tesseract.js-core, naptha/tessdata and tesseract-ocr traineddat… | Shipped in public/ocr: tesseract-core-simd-lstm.wasm.js 3.72 MB + worker.min.js 0.11 MB + eng.traineddata.gz … | yes | v7.0.0 released 2025-12-15 (npm): 15-35% faster than v6, new relaxedsimd build (Chrome/Edge 114+ only; Safari and Firefox lack relaxed SIMD per caniuse, so Safari keeps the plain simd build); repo last pushed 2026-05-17. Compiles Tesseract 5.3.0 (Balearica/te… | https://github.com/naptha/tesseract.js/releases |
| tesseract-wasm 0.11.0 (robertknight) - leaner Tesseract wrapper | BSD-2-Clause (wrapper); Tesseract Apache-2.0; tessdata_fast Apache-2.0 | tesseract-core.wasm 1.75 MB + tesseract-core-fallback.wasm 1.72 MB + worker; README claims ~2.1 MB total with… | yes | Released 2025-10-24, repo pushed 2025-11-17. API: createOCREngine -> loadModel, loadImage(ImageBitmap/ImageData), getTextBoxes('word'/'line') -> {rect{left,top,right,bottom}, text, confidence 0-1, flags StartOfLine/EndOfLine}, getBoundingBoxes (layout only), … | https://github.com/robertknight/tesseract-wasm |
| PaddleOCR.js official SDK (@paddleocr/paddleocr-js 0.4.2) - PP-OCRv5 … | Apache-2.0 (npm license field) for the SDK; PaddleOCR code and all PP-OCR weights Apache-… | Package 22.7 MB on npm, of which the runtime worker bundle is 10.8 MB (bundles OpenCV.js ~9.9 MB) + onnxrunti… | yes | Published 2026-06-11 (same day as PP-OCRv6). predict(File/Blob/canvas) -> OcrResult[] { image{width,height}, items[{poly: 4-point quad, text, score}], metrics{detMs,recMs,totalMs,detectedBoxes,recognizedCount}, runtime{backend,provider} }; no word boxes, no t… | https://www.paddleocr.ai/v3.5.0/en/version3.x/deployment/browser.html |
| ppu-paddle-ocr 6.6.1 (/web entry, canvas-native, no OpenCV.js) | MIT (wrapper); PP-OCR weights Apache-2.0; onnxruntime-web MIT | Package 0.27 MB; web entry uses HTMLCanvasElement/OffscreenCanvas instead of OpenCV.js; + onnxruntime-web 11.… | yes | Very active (published 2026-10-08). recognize() returns text grouped by lines (flatten option); boxes and per-line confidence are not documented in the README; no table support. Self-reported 99.22% character accuracy on a receipt benchmark; M1 timing 225 ms/… | https://cdn.jsdelivr.net/npm/ppu-paddle-ocr@5.1.1/README.md |
| @gutenye/ocr-browser 1.4.9 (PP-OCRv4/v5 on onnxruntime-web) | MIT (code); models remain Apache-2.0 (PaddleOCR) - README states ONNX conversion does not… | @gutenye/ocr-models 1.4.2 (2024-05-20): ch_PP-OCRv4_det 4.53 MB + ch_PP-OCRv4_rec 10.32 MB + cls 0.55 MB + di… | yes | Published 2026-09-19, 211 stars. detect(image) -> { texts: [{text, score, frame{top,left,width,height}}], resizedImageWidth/Height }: line level, no words, no tables. No default models in the browser build (app must host them). A December 2025 write-up report… | https://github.com/gutenye/ocr/blob/main/README.md |
| paddleocr (npm) 1.2.0 - dependency-free TypeScript runtime for PP-OCR… | MIT (runtime); PP-OCR weights Apache-2.0; app supplies onnxruntime-web (MIT) | Runtime small (no OpenCV.js, no image decoders - app decodes to raw pixels); + onnxruntime-web 11.35 MB + the… | yes | Published 2026-07-03. recognize() + processRecognition(results).text; progress events carry per-item result and box; sortByReadingOrder / sameLineThresholdRatio group lines; per-result confidence not documented. Pre/post-processing follows PaddleX at a high l… | https://cdn.jsdelivr.net/npm/paddleocr@1.2.0/README.md |
| ocrs (robertknight) - Rust OCR engine via RTen, WASM build alpha | Code Apache-2.0 OR MIT. Model weights on Hugging Face are tagged cc-by-sa-4.0 and were tr… | text-detection 2.52 MB + text-recognition 9.71 MB (.rten or .onnx) + WASM engine (size not published) | no | Repo pushed 2026-10-05, 1.9k stars, tags up to v0.4.0 / ocrs-v0.13.1, no GitHub releases. The JS package (js/package.json: @robertknight/ocrs 0.1.0, MIT) is NOT published on npm (registry returns nothing) - you would build the WASM yourself. README calls it a… | https://github.com/robertknight/ocrs |
| Transformers.js 4.3.1 + TrOCR (Xenova/trocr-small-printed) | TrOCR weights MIT (Microsoft); Transformers.js Apache-2.0; onnxruntime-web MIT | encoder_model_quantized 23.1 MB + decoder_model_merged_quantized 40.5 MB = ~64 MB (fp32 ~247 MB); trocr-base/… | yes | Autoregressive decoding per line is slow on CPU; returns text only (no boxes, no confidences); would still need a PP-OCR/Tesseract detector for layout. Accuracy on clean print is good but not better than PP-OCRv6 for the size. Not worth it here. | https://huggingface.co/Xenova/trocr-small-printed/tree/main/onnx |
| Transformers.js + Florence-2-base-ft (onnx-community) | MIT (Microsoft Florence-2); Transformers.js Apache-2.0 | q4f16 minimal set: embed_tokens 78.8 + vision_encoder 62.4 + encoder 25.7 + decoder_merged 56.5 = ~223 MB (fp… | yes | Generative VLM; OCR quality on dense tables is mediocre and ordering is not guaranteed; far too large for an opt-in on a 7 MB budget; no table structure output. | https://huggingface.co/onnx-community/Florence-2-base-ft/tree/main/onnx |
| Transformers.js + Donut (Xenova/donut-base-finetuned-cord-v2) | MIT (Clova Donut); Transformers.js Apache-2.0 | encoder_model_quantized 91.4 MB + decoder_model_merged_quantized 128 MB = ~219 MB (fp32 ~820 MB); 2560x1920 i… | yes | Would need fine-tuning on transcript layouts to output anything useful; irrelevant for word-level OCR; listed only to close the question. | https://huggingface.co/Xenova/donut-base-finetuned-cord-v2/tree/main/onnx |
| GLM-OCR 0.9B (zai-org) via Transformers.js WebGPU (onnx-community/GLM… | MIT (model), bundled PP-DocLayoutV3 Apache-2.0; ONNX export MIT | q4f16 ~635-650 MB one-time download, ~2 GB GPU memory in one tab; model card speed 1.86 pages/s on a server G… | yes | The only in-browser option that returns table STRUCTURE (rows/cells) rather than boxes; OmniDocBench v1.5 94.62 (#1), olmOCR-bench 75.2, MDPBench photographed 63.7. Generative, so it can smooth over or invent text on poor scans (SafeOCR warns about this) - un… | https://huggingface.co/zai-org/GLM-OCR |
| onnxruntime-web 1.30.0 (runtime for all PaddleOCR/Transformers.js opt… | MIT | ort-wasm-simd-threaded.wasm 11.35 MB; ort-wasm-simd-threaded.jsep.wasm (WebGPU build) 22.72 MB; asyncify buil… | yes | Self-hostable (wasmPaths). Multi-threading needs crossOriginIsolated (COOP/COEP) - impossible on GitHub Pages without a service-worker shim and impossible inside the cse.nd.edu iframe; single-threaded SIMD WASM is the realistic mode. Relaxed SIMD not used. Tr… | https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/README.md |
| docTR / OnnxTR (Mindee) - no maintained browser port | Apache-2.0 (docTR, OnnxTR, demo) | Demo model sizes not stated; docTR v1.1.0 released 2026-08-21, OnnxTR pushed 2026-10-09 (active, Python) | yes | Running docTR in a browser today means exporting the ONNX models (OnnxTR already has 8-bit ones) and porting DB post-processing and CRNN decoding to onnxruntime-web yourself; nobody maintains such a port, and PP-OCRv6 already covers that design with an offici… | https://github.com/mindee/doctr-tfjs-demo |
| MMOCR (OpenMMLab) - dormant, no browser port | Apache-2.0 | Last release v1.0.1 2023-07-04; last push 2024-11-27 | no | No JS/WASM port exists and the project is effectively unmaintained; excluded. | https://github.com/open-mmlab/mmocr |
| RapidOCR - no JS/WASM port | Apache-2.0 | n/a in browser | no | Its models are the same PP-OCR exports the JS wrappers above already use; nothing to gain. | https://gitee.com/RapidAI/RapidOCRWeb |
| Browser built-in AI (Chrome 148 Prompt API, Edge 148 on-device APIs) … | Browser-vendor models, not redistributable | n/a | no | No standards-track text-recognition API shipped in 2025-2026 (Shape Detection TextDetector remains Chrome-only/experimental). Cannot satisfy the Safari + same-origin requirements. | https://blogs.windows.com/msedgedev/2026/06/02/expanding-on-device-ai-in-microsoft-edge-new-models-and-apis-for-the-web/ |
| Browser support facts for WASM/WebGPU (caniuse + WebKit) | CC-BY (caniuse data), WebKit blog | n/a | yes | caniuse: WASM SIMD Safari 16.4 / iOS 16.4 / Chrome 91 / Firefox 89; WASM threads Safari 14.1 / iOS 14.5 (needs COOP/COEP) / Chrome 74 / Firefox 79; relaxed SIMD Chrome/Edge 114 only (Safari, Firefox: no); WebGPU Chrome/Edge 113, iOS Safari 26.0 full, macOS Sa… | https://webkit.org/blog/17333/ |
| Tesseract table levers (tessdoc ImproveQuality + Command-Line-Usage +… | Apache-2.0 docs | n/a | yes | Tesseract 'works best on images with at least 300 dpi'; a 2018 mailing-list study (v4, six fonts) found error rate tracks capital-letter height in pixels, not the dpi tag. Internal Otsu; 5.0 added Adaptive Otsu (1) and Sauvola (2) via thresholding_method (+ t… | https://tesseract-ocr.github.io/tessdoc/ImproveQuality.html |

Recommendations from the research:
- (1) Best accuracy per megabyte: keep tesseract.js 7 with the eng 4.0.0_best_int model it already ships (6.6 MB total, Apache-2.0, runs on iOS/macOS Safari and Chrome with no headers). Nothing in the 7-17 MB band beats it on clean 300-dpi scans: tessdata_fast is not even available on the @tesseract.js-data CDN and is no more accurate, tessdata_best (15.4 MB raw) buys 'negligible to marginal' accuracy at up to 4x the time, and tesseract-wasm (1.75 MB core) saves ~2 MB but is the same engine. The first option that is both small and better on phone photos (skew, shadows, perspective) is PP-OCRv6_tiny on onnxruntime-web: 1.7 MB det + 4.4 MB rec + 11.35 MB ORT wasm = ~17.5 MB with a canvas-native wrapper (ppu-paddle-ocr/web or the `paddleocr` npm runtime), ~28 MB with the official SDK's OpenCV.js worker; in-house Print-EN recognition accuracy 88.4% vs PP-OCRv5_mobile 86.0%. Adopt it only after measuring both engines on a few sanitized scanned transcripts and phone photos, because on clean scans Tesseract is at least as good. Sources: https://github.com/naptha/tesseract.js/releases ; https://github.com/naptha/tessdata ; https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz ; https://towardsdatascience.com/googles-tesseract-ocr-how-good-is-it-on-documents-d71d4bf7640 ; https://github.com/robertknight/tesseract-wasm ; https://huggingface.co/PaddlePaddle/PP-OCRv6_tiny_det/tree/main ; https://huggingface.co/PaddlePaddle/PP-OCRv6_tiny_rec/tree/main ; https://www.paddleocr.ai/latest/en/version3.x/algorithm/PP-OCRv6/PP-OCRv6.html ; https://data.jsdelivr.com/v1/packages/npm/onnxruntime-web@1.30.0?structure=flat ; https://cdn.jsdelivr.net/npm/paddleocr@1.2.0/README.md
- (2) Best absolute accuracy that still satisfies no-server, same-origin, Safari + Chrome: PP-OCRv6_small through the official @paddleocr/paddleocr-js 0.4.2 (Apache-2.0 code and weights): self-host the PP-OCRv6_small_det/_rec .tar bundles (9.8 + 21.1 MB; the SDK's defaults point at Baidu BOS, which the app must not call) next to onnxruntime-web's wasm (11.35 MB) and the 10.8 MB worker bundle, run backend 'wasm' single-threaded (COOP/COEP is unavailable on GitHub Pages and inside the cse.nd.edu iframe; coi-serviceworker can enable threads on the standalone page only) and let 'auto' pick WebGPU in Chrome; first download ~53 MB, cached afterwards. It returns line polygons + text + score (no word boxes, no table structure), so rows are rebuilt by clustering polygons on y and columns on x, and the same 'preview and correct' flow applies. In-house Print-EN recognition accuracy 93.3% (det Hmean 93.6) against PP-OCRv5_mobile 86.0 - the largest gain of any option under 100 MB. Verify on Safari 26 (ORT's own table omits Safari WebGPU; WebKit says ORT runs there; keep WASM as the only guaranteed path) and on an iPhone, since 30 MB of models plus a 2550x3300 canvas is near iOS tab-memory limits. GLM-OCR (MIT, 650 MB, WebGPU + shader-f16 + 2 GB, desktop only, hallucination risk) is the absolute-accuracy leader and the only engine that emits table structure, but it cannot be an opt-in on this static app. Sources: https://www.paddleocr.ai/v3.5.0/en/version3.x/deployment/browser.html ; https://github.com/PaddlePaddle/PaddleOCR/blob/main/paddleocr-js/packages/core/README.md ; https://raw.githubusercontent.com/PaddlePaddle/PaddleOCR/main/paddleocr-js/packages/core/src/resources/model-asset.ts ; https://huggingface.co/PaddlePaddle/PP-OCRv6_small_det/tree/main ; https://huggingface.co/PaddlePaddle/PP-OCRv6_small_rec/tree/main ; https://www.paddleocr.ai/latest/en/version3.x/algorithm/PP-OCRv6/PP-OCRv6.html ; https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/README.md ; https://webkit.org/blog/17333/ ; https://github.com/gzuidhof/coi-serviceworker ; https://github.com/ysjprojects/safeocr ; https://huggingface.co/zai-org/GLM-OCR ; https://huggingface.co/onnx-community/GLM-OCR-ONNX
- (3) Do these to the existing tesseract.js pipeline (src/transcript/ocr.ts) regardless of engine choice: (a) render pages at 300 dpi - RENDER_SCALE 300/72 = 4.17 instead of 3.0 (~216 dpi), or at least ensure capital letters are >= 20-30 px tall, and pass user_defined_dpi '300'; downscale only if canvas memory fails on iOS; (b) pre-process on the canvas before recognize: grayscale, optional 10 px white border, and test thresholding_method '2' (Sauvola) / '1' (adaptive Otsu) with thresholding_window_size and thresholding_kfactor via setParameters, confirming with the imageBinary output that the parameter took effect; if it does not, apply your own Sauvola on the canvas for shaded phone photos (Tesseract 5's LSTM often scores better on grayscale than on hand-binarized input, so A/B it); (c) deskew: pass rotateAuto: true in the recognize options (Tesseract's own orientation estimate) and/or compute skew from the word-box baselines and re-run on a rotated canvas when |angle| > 0.5 deg; (d) segmentation: replace the default PSM.SINGLE_BLOCK ('6') with PSM.SINGLE_COLUMN ('4') for transcript tables, with PSM.SPARSE_TEXT ('11') as the second pass for pages where '4' merges columns, and set preserve_interword_spaces '1' so line.text keeps the column gaps; (e) stop consuming line.text only: the {blocks:true} output already carries words with bbox/confidence/baseline, so cluster words into rows by baseline y (rowAttributes) and into columns by x gaps, and keep per-cell confidence for the preview's low-confidence flags; add {tsv:true} if a flat word table is easier; (f) never set a global tessedit_char_whitelist (titles need letters) - instead, once rows and columns are known, re-recognize the credits and grade columns through the `rectangle` option with a per-column whitelist ('0123456789.' and 'ABCDFIPSWX+-') for a second opinion, and use PSM.SINGLE_LINE ('7') on those cells; (g) multi-pass voting: run the page at two scales (e.g. 3.0x and 4.17x) and/or PSM 4 and 6, align words by bbox overlap and take the higher-confidence reading per cell (consensus voting of repeated single-engine passes cut errors 20-50% in Lopresti & Zhou's classic study; gains depend on the passes making different errors, so measure on sanitized samples); (h) keep OEM.LSTM_ONLY with 4.0.0_best_int (the fast variant is not on the CDN and best is 5x larger for no gain), consider load_system_dawg/load_freq_dawg false via the createWorker config only after testing, because course titles are dictionary words; (i) the v7 relaxedsimd core is Chrome-only - do not ship it instead of the simd-lstm build Safari needs; (j) keep MAX_PAGES and the worker.terminate() finally, and read Tesseract's version at runtime (page.version) to document that the core is Tesseract 5.3.0. Sources: https://tesseract-ocr.github.io/tessdoc/ImproveQuality.html ; https://tesseract-ocr.github.io/tessdoc/Command-Line-Usage.html ; https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/src/index.d.ts ; https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/docs/api.md ; https://github.com/tesseract-ocr/tesseract/pull/2294 ; https://github.com/naptha/tesseract.js/issues/883 ; https://groups.google.com/g/tesseract-ocr/c/Wdh_JJwnw94/m/24JHDYQbBQAJ ; https://pyimagesearch.com/2021/11/15/tesseract-page-segmentation-modes-psms-explained-how-to-improve-your-ocr-accuracy/ ; https://arxiv.org/abs/1711.09670 ; https://arxiv.org/abs/2204.00052 ; https://raw.githubusercontent.com/Balearica/tesseract/2a9c1c49c360462733c386d2a44fcd22c4e21411/VERSION ; https://github.com/naptha/tesseract.js-core/releases

### 4.2 Public text-layer specimens and layout families
| Source | Kind | Coverage | In corpus | Usable | Terms | Notes | URL |
|---|---|---|---|---|---|---|---|
| University of Alberta - Credit/No Credit sample unofficial record (Pe… | text-specimen | Canada / PeopleSoft Campus Solutions batch transcript (SQR zsrr119, PDFlib) / columns 'Course / Description / Grade Remark / Units Taken / Units Pass… | no | yes | Public registrar publication, no licence stated; compose from layout | Official registrar sample with fictitious students 'Sample Two Student' (ID 1578110, M.Eng) and 'Sample One Student' (ID 1571314, BA). Courier text layer, 2 pages, verified with pdftotext. Original URL https://cms.cloud… | https://www.ualberta.ca/en/registrar/media-library/forms/cr-nc-transcript-sample.pdf |
| McGill-Plan-Your-Degree synthetic Minerva transcript fixtures (PDF + … | dataset | Canada / McGill Minerva (Banner self-service) unofficial transcript / scenarios: cegep-engineering, deferred-grades, failures, long-record (multi-pag… | yes | yes | MIT (repository LICENSE) | McGill is in the corpus only as a key-composed line list; this is a different kind: 12 generated PDFs (55-90 KB each, pdf text layer) with fake identities plus a JSON ground truth per file ({degree, programs, minors, cr… | https://github.com/CBC-Mcgill/McGill-Plan-Your-Degree/tree/main/lib/transcript/fixtures |
| Evergreen State College - sample Record of Academic Achievement | text-specimen | US narrative-evaluation transcript / no course codes / program blocks with sub-credit lines ('13 - General Chemistry with Laboratory', '*6 - Organic … | no | yes | Public registrar sample; compose only | Text layer (XSL Formatter), 1 page, name/ID fields blank. Falls in the CC15 (no code column) exclusion family, so its value is as a known-failing fixture that must be refused cleanly. Companion 'sample-summary.pdf' at /… | https://www.evergreen.edu/sites/default/files/2023-07/sample-raa.pdf |
| Hampshire College - Transcript Explanation and Key | guide | US narrative-evaluation college / header columns 'Course / Title / CmplStat / Inst/Cred / Div/Use' / completion codes EVL, W, INC, NO, TR, NR, AUD / … | no | yes | Public registrar document | Text layer, 1 page. Low priority for CSE applicants; documents another no-grade layout to refuse (CC15 family). | https://www.hampshire.edu/sites/default/files/centralrecords/17F%20Transcript%20Explanation%20and%20Key.pdf |
| Western University (Ontario) - transcript legend, back of transcript … | guide | Canada / percentage grades A+ 90-100 ... F / no GPA issued / class AVG and SIZ columns / abbreviations AEG, AUD, AVG, COM, CR, DEF, DNW, DRP, FAI, FT… | no | yes | Public registrar document | Text layer (InDesign), 1 landscape page. Front-of-transcript rows not shown; compose rows from the legend (numeric mark column + AVG/SIZ). | https://registrar.uwo.ca/services/pdfs/Transcript_2022_back.pdf |
| McMaster University - transcript legend (Mosaic/PeopleSoft era) | guide | Canada / 12-point scale (A+ 12 ... F 0) / columns TM (term) and MEDIAN (median grade + class size) / no cumulative GPA / notations DEF, EXTRA, REPEAT… | no | yes | Public registrar page | HTML legend, post-March-2015 (Mosaic implementation). Official transcripts delivered via Parchment. | https://registrar.mcmaster.ca/?p=24125 |
| ARUCC - Transcript Legend Best Practice Guidelines (and Academic Tran… | guide | Canada-wide / what a legend must list (abbreviations, calendar, course numbering, credit system, grading equivalency chart, GPA methodology, transfer… | no | yes | Public guideline; cite, do not redistribute | Text layer, 2 pages (2015 ARUCC/PCCAT study). Useful checklist for composing Canadian fixtures; no sample rows. | https://guide.arucc.ca/uploads/pdf/Transcript_Legend_Best_Practice_Guidelines.pdf |
| Parchment eTranscript - 'How to Authenticate This Official Transcript… | text-specimen | Vendor wrapper (Parchment, also Credentials/eScrip-Safe since 2020 merger) / the exact page Parchment appends to certified eTranscripts: 'This offici… | no | yes | Parchment boilerplate republished by a college; quote structure, do n… | Text layer, 1 page (Word 2010). The blue ribbon is a PDF certification signature, not page text; 'PRINTED COPY' appears on printed-out PDFs. A parser must skip this page and any institution-specific key page that follow… | https://ssu.edu/wp-content/uploads/2015/01/Blue-Ribbon-Electronic-Transcript-Security-Features-from-Parchment.pdf |
| National Student Clearinghouse eTranscript - structure (key as PDF at… | guide | Vendor wrapper (NSC / Ellucian eTranscripts for Banner and Colleague) / certified PDF / transcript key delivered as a PDF ATTACHMENT (Adobe paper-cli… | no | yes | Public registrar pages | No public specimen found on studentclearinghouse.org; USNA page links its own key separately, Connecticut College (https://www.conncoll.edu/academics/registrar/transcripts/) warns the key is invisible without the attach… | https://www.usna.edu/Registrar/Transcripts.php |
| eScrip-Safe (Credentials Solutions) secure PDF - structure | guide | Vendor wrapper / cover sheet naming sender, student and receiver, then the institution's transcript and key / sender-to-receiver transmission line in… | no | yes | Public state guidance | Structure only; every actual eScrip-Safe file found online (SlideShare, Evergreen folders) is a real student's record. UW Seattle 2015-era and many state universities used it before Parchment absorbed it. | https://www.mass.gov/doc/official-transcriptsdegree-conferral-an-overview-0/download |
| Workday Student transcript - layout descriptions (Suffolk 'Transition… | guide | Workday Student (2018+; ~100 NA institutions live, 200+ selected) / each academic period header carries start and end dates / 'GPA credits' column in… | no | yes | Public registrar/vendor pages; compose a synthetic fixture from the d… | No public text-layer Workday transcript exists anywhere found: every registrar guide (UAFS, UA System, SCU, SOU, Stevens, Brandeis, Pensacola, Bowdoin, UBC) shows screenshots only; Workday docs (https://doc.workday.com/… | https://suffolk.edu/about/directory/registrars-office/law-resources/transcript/transition-to-workday |
| Sweet-Rice/shep4proj - redacted Workday transcript PDF fixtures (PRs … | dataset | Workday Student / two redacted real Workday transcript formats under fixtures/transcripts/ with a parser (31 of 35 courses parsed in its test) | no | no | Unknown; repo not accessible | Repository returns 404 via gh api on 2026-10-09 (private or deleted). Even if it reappears, the fixtures are redacted REAL records, not synthetic; use only as a layout reference, never copy. | https://github.com/Sweet-Rice/shep4proj/pull/162 |
| Lesley University - example unofficial transcript (Ellucian Colleague… | scan-specimen | Ellucian Colleague unofficial transcript family / monospaced block: '**** UNOFFICIAL TRANSCRIPT ****' banner, table 'Course/Section and Title / Grade… | no | yes | Help-desk article; layout reference only | PNG image only (name blurred, real student) at https://s3.amazonaws.com/cdn.freshdesk.com/data/helpdesk/attachments/production/4140330037/original/5ERhiAMOnlgSI7NMgABI5lCXINq0o-CwmA.png?1698854167 - use as a layout refe… | https://support.lesley.edu/support/solutions/articles/4000199746-how-do-i-view-my-unofficial-transcript- |
| CUNY Uniform Grade Glossary (Fall 2024) + Queens College Transcript K… | guide | CUNYfirst (PeopleSoft Campus Solutions, 25 campuses incl. CCNY, Hunter, Queens, Brooklyn, Baruch, CityTech) / uniform symbols A+/A 4.00 ... F 0.00, W… | no | yes | Public university policy documents | Alternate copies: https://www.hostos.cuny.edu/Hostos/media/Office-of-Academic-Affairs/CUNY_Uniform_Grade_Symbols.pdf (TLS error on fetch), https://facultycommons.citytech.cuny.edu/wp-content/uploads/2024/03/CUNY-Uniform… | https://lcw.lehman.edu/college-senate/documents/December%204,%202024/CUNY-Uniform-Grade-Glossary-Policies-and-Guidelines-caeas.pdf |
| University of Oregon - Transcript Key (Banner, quarter system) | guide | US large public / Banner official transcript (DuckWeb) / quarter hours / totals abbreviations Ehrs, GPA-hrs, Pts / major and student type printed wit… | no | yes | Public registrar page | HTML key, no sample PDF on the site. Real UO eTranscripts seen only inside Evergreen's open application folders (unusable). Oregon State (also Banner, quarter) publishes no key; contact registrar. | https://registrar.uoregon.edu/transcripts/transcript-key |
| UCLA - Academic Transcript Format | guide | US large public, quarter system / electronic transcript = cover page (UCLA, student, recipient) + transcript pages with background design and border … | no | yes | Public registrar page | No column headings or sample given; compose rows from UCLA grade symbols. UC Berkeley, UCSD and UC Davis publish no standalone legend; their Parchment PDFs carry 'Certified Digital Credential' footers (seen only in real… | https://registrar.ucla.edu/student-records/academic-transcript/academic-transcript-format |
| LSAC - Interpretive Guide to Undergraduate Grading Systems (per-insti… | dataset | Nearly every US institution / per-school HTML key: Time Period, Term/Credit Type (e.g. 'QTR 1 CR=2/3 SEM HR'), Grade Conversion Table to LSDAS scale,… | no | yes | LSAC public pages; compose from them, do not mirror | URL pattern <institution code>_<MMYYYY from>_<MMYYYY to>.htm (example is Evergreen, code 4292). Directory index returns 403, so codes must be found via search. Text only; good for grade-symbol calibration when a new US … | https://transcripts.lsac.org/TranscriptKeys/4292_091979_129999.htm |
| University of Melbourne - sample academic transcript (My eQuals-issue… | text-specimen | Australia / My eQuals (Digitary) certified transcript / subject codes and titles, marks, points and grades, weighted average mark, conferral dates, s… | no | yes | Public university sample; compose from layout | Page links 'View a PDF sample (1mb)'; the site returns HTTP 403 to automated fetch, so the direct PDF URL and text layer are unverified - open the page in a browser. ANU's sample is already in the corpus; Melbourne adds… | https://students.unimelb.edu.au/course-admin/academic-transcripts-and-statements/academic-transcript |
| University of Limerick - sample academic transcript (Digitary CORE / … | text-specimen | Ireland / Digitary-issued secure PDF / blue certification bar 'certified by Academic Registry' (PDF signature, not text) / sender @ul.ie / 'Student S… | no | no | Public HSE/UL document (if it returns) | Indexed by search engines but returned HTTP 404 on both https and http on 2026-10-09; re-check later. Digitary CORE was renamed Parchment for Irish/UK/ANZ institutions; UL, DkIT, TU Dublin, SETU, Cambridge, Manchester u… | https://www.hse.ie/eng/staff/jobs/job-search/medical-dental/nchd/interns/academic-intern-track/sample-academic-transcript-ul.pdf |
| Linköping University - Examples of Transcript of Records (Ladok paper… | scan-specimen | Sweden / Ladok national SIS output / two annotated examples: stamped-and-signed transcript and the electronically verifiable transcript with 'Electro… | yes | yes | Public university document; images - compose, do not copy | 2 pages; the transcripts themselves are embedded JPEG images, only the annotation callouts are text. Sweden is in the corpus via KTH (composed from an Aalto page), so the Ladok verifiable-PDF layout itself is new; OCR t… | https://liu.se/dfsmedia/dd35e243dfb7406993c1815aaf88a675/26997-source/options/download/example-of-transcript-of-records-190307 |
| Algeria MESRS - Modele de releve de notes (LMD licence/master) | other | Francophone Africa (Algeria; same LMD model in Morocco, Tunisia, Senegal) / French headings / per teaching unit (UE) code, title, credits, coefficien… | no | yes | Public ministry template | Blank ministry template (text layer not verified). TU Dresden's ECTS ToR form (https://redundancy.webcms.tu-dresden.de/studium/vor-dem-studium/ressourcen/dateien/internationales/transcript-of-records.pdf) is a similar b… | https://old.univ-eloued.dz/images/Forumphoto/ha_ge2018/PDF/MODELE_RELEVE_DE_NOTES_MESRS_LM.pdf |
| University of South Dakota - Transcript/Mark sheet Grading Scale FAQ … | scan-specimen | Five countries' mark sheet/transcript examples with grading-scale and (Nigeria) degree-classification blocks | yes | no | University help article; unclear rights | Images only (thumbnails open full size), provenance and anonymisation not stated - view for layout, do not copy. Countries already have one fixture each (unilag, anna-university etc., sharif, ug_ghana, tribhuvan_ioe). | https://td.usd.edu/TDClient/33/Portal/KB/ArticleDet?ID=9156 |
| University of Toronto CES - Iran document requirements (which univers… | guide | Iran / Sharif, Shiraz, Amirkabir and University of Tehran issue English transcripts directly; others arrive as Ministry-of-Justice certified translat… | yes | yes | Public page | No public Iranian specimen found (only guides: WKU https://www-prod01.wku.edu/international/documents/iran.pdf, SFU, Kurdistan grading page). Parser implication: two layout families per Iranian applicant - university-is… | https://learn.utoronto.ca/comparative-education-service/apply-now/document-requirements/iran |
| UMDTerpTracker - Testudo-layout fixed-width text fixtures | text-specimen | University of Maryland Testudo unofficial transcript / fixtures/testudo-standard/transcript.txt (column positions measured from a real PDF) and sampl… | yes | yes | No licence (compose only) | UMD exists in ms-transcripts as a synthetic layout; this gives measured column offsets. No LICENSE file (all rights reserved by default) - read for layout and compose; do not copy files. Note UMD moves to Workday 2027-2… | https://github.com/sanirb-debug/UMDTerpTracker/tree/main/fixtures |
| rice-degree-planner - ESTHER (Banner self-service) sample transcript … | text-specimen | Rice University ESTHER unofficial transcript text in js/schools/rice/sample.js; parser also skips DegreeWorks 'still needed' lines | yes | yes | MIT | Rice is already in the corpus (pdf-key-rice); the sample text shows the as-rendered Banner self-service line order and can calibrate the composed fixture. | https://github.com/ryan-racer/rice-degree-planner |
| Transcript-QA (Stony Brook) - frontend/public/sample.pdf | dataset | Stony Brook SOLAR (PeopleSoft) unofficial transcript, CS students | no | no | No licence; provenance unknown | No licence and no statement that the sample is synthetic - treat as a possible real record until verified. muschellij2/transcriptr (GPL-3.0, https://github.com/muschellij2/transcriptr) reads JHU unofficial transcripts b… | https://github.com/BaybhinProgramming25/Transcript-QA |
| Anthology Student portal - unofficial transcript (one- or two-column)… | guide | Anthology Student (ex-CampusNexus; career/for-profit colleges) / portal transcript configurable single- or two-column / organised by program, include… | no | yes | Vendor documentation; structure only | Portal help page https://help.anthology.com/PRT/24.3/Student/Content/StudentPortal/UnofficialTranscript.htm redirects to anthology-help.ellucian.com and returns 403 to automated fetch; it carries an 'Unofficial Transcri… | https://help.anthology.com/CNS/24.0/WebClient/Content/GR/AR/Reports/p_TransUnOff.htm |
| ENIC Ukraine - samples of higher-education academic supplements | scan-specimen | Ukraine / no single national form since May 2015; bilingual Ukrainian/English entries since June 2016; required elements: document number, official's… | no | yes | Public ENIC samples | Official ENIC sample images; compose from layout. Low volume for ND CSE but a distinct bilingual-row family. | https://enic.in.ua/index.php/en/educational-documents-samples/higher-education-samples/academic-supplement |
| Curtin University Dubai - 'Transcript File Sample' | scan-specimen | Nine SECONDARY-school documents as images (Cambridge AS/GCSE, Nepal Grade 12, Pearson A-level, UAE Grade 12, AP report, GED, US Grade 12, SAT report) | no | no | n/a | Not university transcripts; listed so it is not re-proposed. | https://curtindubai.ac.ae/wp-content/uploads/sas-forms/Transcript-File-Sample.pdf |
| Real student records exposed on the open web - DO NOT OPEN OR USE | other | Evergreen State College GPAC application folders (myfiles/calfiles.evergreen.edu) expose named applicants' transcripts from UC Berkeley, UGA, U Orego… | no | no | Unusable (personal data, no consent) | All are identifiable real people (FERPA/GDPR). Column headings quoted here came from search-engine snippets only; none of these files was opened. Where a layout is needed (IIT KGP grade card, HEC-style Pakistani 'Course… | https://myfiles.evergreen.edu/offices/Remote%20Graduate%20Studies/GPAC/ |

Recommendations from the research:
- 1. Workday Student synthetic fixture (highest adoption growth; UBC, WashU, LSU, W&M, Wake Forest, Stevens, UA system, Georgetown, Brandeis live; UMD, GVSU, Montclair, Columbus State 2026-28): compose from the Suffolk and Wake Forest descriptions - period headers with start/end dates, single column, 'GPA credits' in period and cumulative totals, subject+number without section, 'Transfer Credit' as grade text, 'Repeated Course' marker, status footer. No public text specimen exists; ask the DGS for one sanitised Workday PDF from a consenting student to validate.
- 2. PeopleSoft SQR official/unofficial record: compose from the University of Alberta sample (fictitious students) - 'Grade Remark | Units Taken | Units Passed | Grade Points | Class Avg | Class Enrl', per-term GPA sentence, multi-token subject codes, narrative paragraphs between terms, two students in one PDF.
- 3. Run the 12 MIT-licensed McGill synthetic Minerva PDFs through the external parser with their JSON as ground truth (multi-page header/footer removal, terms split across pages, multi-term courses, deferred grades, remarks, pass/fail, withdrawals, non-transcript input).
- 4. CUNYfirst (PeopleSoft, 25 campuses, large NYC applicant pool): compose on the Binghamton layout with CUNY uniform symbols WU, WN, INC, R, P/NC, PEN and Queens College suffix codes.
- 5. Ellucian Colleague per-row-term layout (Lesley image): 'Course/Section and Title | Grade | Credits | Term', transfer rows first with grade TR, fixed-width truncated titles, 'Cumulative GPA.(A)/(C)' totals - compose; this family is absent from both corpora.
- 6. Parchment wrapper variant: prepend/append the 'How to Authenticate This Official Transcript' page to an existing Banner and a PeopleSoft fixture, plus a 'PRINTED COPY' watermark variant; assert the parser ignores the page.
- 7. NSC eTranscript variant: certification/cover page present, transcript key absent from the page stream (it is a PDF attachment); assert no dependence on a key page.
- 8. eScrip-Safe variant: cover sheet, margin transmission line, document ID footer, repeated watermark text on every page.
- 9. UCLA quarter-system electronic transcript (cover page + transcript pages + legend page) composed from UCLA grade symbols; reuse for UC Berkeley/UCSD/UC Davis Parchment 'Certified Digital Credential' footers.
- 10. University of Oregon Banner quarter official transcript: Ehrs/GPA-hrs/Pts totals, major and student type on each term line, standing after totals, >1..>5 symbols; also covers Oregon State.
- 11. Western Ontario: percentage marks, no GPA, AVG and SIZ columns, 0.5/0.25 course weights.
- 12. McMaster Mosaic: 12-point scale, TM and MEDIAN columns, no cumulative GPA.
- 13. Ladok electronically verifiable transcript (Sweden; KTH/Chalmers/Lund/Linköping): OCR the Linköping example image for layout, then compose with the 'electronic transcript disclaimer' block.
- 14. Digitary/My eQuals certified PDFs (Melbourne sample via browser; UL sample if the link returns): certification bar is a signature not text; 'Student Status: Graduated' line; WAM column.
- 15. Francophone LMD releve de notes (Algeria MESRS template; Morocco/Tunisia/Senegal): UE code/title/credits/coefficient/mark, jury decision, French headings only.
- 16. Korea beyond KAIST: compose an SNU-style English transcript with 4.3-scale default plus optional 4.0/4.5 columns (SNU certificates page); no public specimen found.
- 17. Iran translator-template variant (Ministry of Justice certified translation: translator letterhead, 20-point marks, Persian/English side by side) alongside the existing Sharif direct-English fixture.
- 18. India NIT/IIT grade-card family: compose 'Subno | Name | L-T-P | CRD | GRD' semester cards and an NIT Consolidated Statement of Grades from column names only (all real cards found are applicants' uploads).
- 19. Pakistan HEC-style semester table 'Course Code | Course Title | CH | Grade | GPs' with 'valid only when signed by the Controller of Examinations' footer (NUST/UET/COMSATS) - compose; found files are real students.
- 20. Turkey dual-credit table (Sabanci-style 'LEVEL | GRADE | SU CREDIT | QUALITY POINT | ECTS CREDIT | REPEAT') to complement Bilkent/METU.
- 21. Narrative-evaluation transcripts (Evergreen RAA sample, Hampshire key): add as known-failing CC15 fixtures so the parser refuses cleanly.
- 22. Ukraine bilingual academic supplement (ENIC samples) - low volume, distinct bilingual-row family.
- 23. Anthology Student two-column program-organised transcript and Jenzabar J1 - defer until a real applicant appears; layouts are school-custom.
- 24. Use LSAC per-institution transcript keys as the grade-symbol calibration source whenever a new US school appears (needs the institution code).
- 25. Re-check existing fixtures against SIS migrations: washu (Workday since 2024), stevens (Workday since 2021), ubc (Workday since 2021), umd (Workday 2027-28), uw-seattle (Workday Student planned); the composed layouts may describe the legacy system.
- 26. Policy: never ingest the exposed real records listed above (Evergreen GPAC folders, Scribd/SlideShare uploads, IIT-KGP application uploads, org.uib.no, Hamburg forum, cargo.site); where their column names are quoted here they came from search snippets, and fixtures must be composed, not copied.
- 27. Melbourne, Limerick, Anthology and Queens College/Lehman CUNY pages blocked or 404'd automated fetch on 2026-10-09; retrieve them in a browser before composing.

### 4.3 Public scanned/image specimens, datasets and tools
| Source | Kind | Coverage | Usable | Terms | Notes | URL |
|---|---|---|---|---|---|---|
| MERIT Dataset (synthetic school transcripts, digital + photorealistic) | dataset | Synthetic secondary-school grade reports, English and Spanish, 14 templates (7 EN / 7 SP); digital pages plus Blender photorealistic renders (cloth-s… | yes | MIT (dataset card); generator code MIT (github.com/nachoDRT/MERIT-Dataset); pap… | Each sample: PNG + ground-truth JSON (gt_parse: school year -> subject -> grade) and FUNSD-format JSON labels (400+ classes; later update adds word bounding boxes). Fully synthetic names from name databases; grades tied… | https://huggingface.co/datasets/de-Rodrigo/merit |
| ASEE 2025 paper: 'Automating Structured Information Extraction from I… | dataset | Claims 'the first labeled, open-source dataset of purely academic transcript images' (University of Toronto M.Eng. project; YOLOv8 + Tesseract + Mist… | no | Paper © ASEE (free to read); dataset licence and hosting NOT stated on the land… | Provenance (real students, web-scraped samples, or synthetic) and PII handling could not be verified without opening the PDF; no GitHub/HF/Zenodo link surfaced. Do not use until the paper's data statement confirms synth… | https://peer.asee.org/55493 |
| CHSI / CSSD official sample images: Verification Report of China High… | scan-specimen | China — CHESICC/CSSD transcript verification report (English version): report no., ID no., course table, red seal, QR/verification code; the document… | yes | CHSI (chsi.com.cn) copyright; no licence — reference/testing only, do not redis… | The only official IMAGE specimen of a real-world red-seal verification report found. The corpus already has a text-composed fixture (chesicc-verification-report.json, on the known-failing list for CC15 'no code column')… | https://www.chsi.com.cn/en/pvr/brief_chesat.jsp |
| ANU Sample Academic Transcript (watermarked) | text-specimen | Australia (ANU) — 3-page registrar sample, 'Certified Correct' layout, UNITS TAKEN / MARK / GRADE table, diagonal watermark; placeholder student 'Fil… | yes | Registrar-published sample; no licence stated (public reference document); PDF … | Already fixture pdf-anu-sample (line list read by the app's layout stage, two known artefacts noted in DECISIONS). Highest-value rasterisation seed: the text layer gives exact ground truth; the watermark is a real-world… | https://d1zkbwgd2iyy9p.cloudfront.net/files/resource/documents/Sample_Transcript_Watermark.pdf |
| University of Bath — Student transcript examples (4 PDFs) | text-specimen | UK — example transcript, record of assessment, and their self-service versions (unit codes, credits, marks /100, classification lines) | yes | Academic Registry publication; no licence stated; accessible formats on request… | Could not open the PDFs here (binary); verify the names are placeholders (a registrar 'example' normally is) before pinning. Text PDFs -> exact ground truth; two layouts (official vs self-service) of the same record are… | https://www.bath.ac.uk/publications/student-transcript-examples/ |
| University of Vaasa / Asia Exchange annotated example Transcript of R… | text-specimen | Finland / ECTS Transcript of Records with [Student's Name] / [Teacher Name] placeholders and annotations | yes | Public template; no licence stated | Already fixture pdf-vaasa-template. Annotation callouts around the table are a useful negative for OCR (they must not become course rows). Rasterise with the ANU and Bath PDFs. | https://asiaexchange.org/wp-content/uploads/2020/04/Transcript_Example.pdf |
| Europass Diploma Supplement examples | text-specimen | EU — Diploma Supplement examples with ECTS course tables and placeholders | yes | European Commission document (Europass); reuse per EU reuse policy (CC BY 4.0 f… | Already fixture pdf-europass-ds-examples. Rasterisation seed for European-layout scans. | https://europass.europa.eu/system/files/2022-05/dsupplementexamples-en.pdf |
| KMU (Karamanoğlu Mehmetbey Üniversitesi) 'Örnek Öğrenci Transkripti' … | text-specimen | Turkey — 'Not Döküm Belgesi' (transcript) layout for a fictitious 'Örnek Öğrenci' (Sample Student), AA–FF letter grades, AKTS/ECTS columns, several n… | yes | University-published explanatory documents; no licence stated | Explicitly synthetic ('Örnek Öğrenci' = sample student). Convert with LibreOffice (MPL-2.0) to PDF, then rasterise. The corpus has only METU/Bilkent composed rows for Turkey, so this adds a genuine Turkish layout. Turki… | https://dosya.kmu.edu.tr/ekshmyo/userfiles/files/%C3%96rnek%20%C3%96%C4%9Frenci%20-%20-%204%20Transkripti%20(Not%20D%C3%B6k%C3%BCm%20Belgesi)%20-%20Hakk%C4%B1nda%20A%C3%A7%C4%B1klama(1).docx |
| WES WENR 'INDIA Sample Documents' (2012) | scan-specimen | India — image-based pages of mark sheets, a consolidated marksheet for a 4-year engineering programme, degree/provisional certificates from several u… | no | © 2012 World Education Services (all rights reserved); no reuse licence | Exactly the degradations wanted (low DPI, stamps, photocopy) but the student names/roll numbers could not be checked without opening it; WES sample sets have historically shown real documents with partial redaction. Tre… | https://wenr.wes.org/wp-content/uploads/2012/05/INDIA_SampleDocuments.pdf |
| Quebec MIFI — 'Documents scolaires acceptés (évaluations comparatives… | guide | Government credential-evaluation guide listing accepted school documents by country (links to CHSI for China, Cuba's Ministry of Justice, etc.) | yes | Gouvernement du Québec; no licence stated | French-language policy table, not an image specimen; the thumbnails are too small for OCR work. Low value — listed because it was the only government 'document examples' guide found for the requested countries. | https://cdn-contenu.quebec.ca/cdn-contenu/immigration/formulaires/fr/reconnaissance-competences/TAB_Exemples_DocScolaires_Acceptes_ECEEHQ.pdf |
| Alberta Education — 'How to read and authenticate an Alberta high sch… | guide | Canada (Alberta) — annotated sample HIGH-SCHOOL transcript with numbered callouts and security features (thermochromic ink, microprint line) | yes | Government of Alberta publication; no licence stated | The only registrar-style annotated 'how to read' sample image found; high-school, so of marginal relevance to graduate audits. Could serve as a security-paper/background-pattern example for degradation realism. | https://education.alberta.ca/media/3272622/how-to-read-and-authenticate-alberta-high-school-transcript.pdf |
| Unifesspa — 'Modelo de digitalização do Histórico escolar do Ensino M… | scan-specimen | Brazil — a university's model of how a scanned histórico escolar (front/back) should look when uploaded | no | University page; no licence; name on the model unverified | Shows the scan style Brazilian applicants produce (two-sided, stamps), but it is a secondary-school record and may show a real name — verify before any use; otherwise rebuild the layout synthetically from the usp/unicam… | https://crca.unifesspa.edu.br/images/sisu/model_arquivos/Modelo_de_digitaliza%C3%A7%C3%A3o_do_Hist%C3%B3rico_escolar_do_Ensino_M%C3%A9dio.pdf |
| UNIST graduate admission — example upload files (Korea) | guide | Korea — a university's examples of correctly scanned application documents (likely includes a transcript page image) | no | University publication; no licence; content and placeholder status unverified | Lead only: Korean registrars (SNU, Korea U., Ewha, Sahmyook) publish fee tables, not sample images; commercial 'bizforms' samples are paywalled and not official. If this PDF shows a placeholder transcript it would be th… | https://adm-g.unist.ac.kr/wp-content/uploads/2026/03/%EB%8C%80%ED%95%99%EC%9B%90%EA%B3%BC%EC%A0%95-%EC%9E%85%ED%95%99%EC%A7%80%EC%9B%90-%EC%A0%9C%EC%B6%9C%EC%84%9C%EB%A5%98-%EC%97%85%EB%A1%9C%EB%93%9C-%ED%8C%8C%EC%9D%BC-%EC%98%88%EC%8B%9C%EC%9E%90%EB%A3%8CUNIST-1.pdf |
| NoisyOffice (UCI ML Repository id 318) | dataset | Printed English office text in 17 fonts with real and simulated noise: folded sheets, wrinkled sheets, coffee stains, footprints; 200 and 400 ppi | yes | CC BY 4.0 (UCI) | Small, permissive, and the only set with REAL stains/folds paired (simulated subset) with clean pages. Use to check that the chosen Augraphy stain/fold parameters produce OCR error rates in the same range as real noise;… | https://archive.ics.uci.edu/dataset/318/noisyoffice |
| ShabbyPages (Augraphy-generated denoising benchmark) | dataset | 6,000+ born-digital page images with synthetically degraded counterparts (printing, faxing, scanning, copier artefacts via Augraphy) | yes | MIT (dataset and recipe; © 2023 Sparkfish LLC); paper arXiv 2303.09339 | No text ground truth shipped, but the clean page is the reference (OCR of the clean page ≈ GT). Main use: calibrate Augraphy pipeline parameters to its published recipe so the benchmark's 'scanner' levels are realistic;… | https://github.com/sparkfish/shabby-pages |
| SmartDoc 2015 — Challenge 2: Mobile OCR (ICDAR 2015) | dataset | Smartphone-captured images of printed document pages under varying conditions (lighting, blur, perspective) for OCR; public-domain source texts | yes | CC BY 4.0 (Zenodo); organisers ask to be told of uses and to cite the ICDAR 201… | The best phone-photo calibration set with ground-truth text (inside the archives; verify on extraction). Pull the sample archive only. Companion sets: Challenge 1 page-outline detection videos (https://doi.org/10.5281/z… | https://zenodo.org/records/2572929 |
| DDI-100: Distorted Document Images | dataset | 99,870 distorted images from 6,658 unique document pages (public papers/reports); geometric transformations and distortions; ground truth = text mask… | yes | MIT (repository LICENSE) | Useful for two things: realistic stamp placement/appearance (stamp masks) and checking geometric-distortion robustness. Not tabular; ShabbyPages' authors note its geometric warps make it unsuitable for pixel metrics (ir… | https://github.com/machine-intelligence-laboratory/DDI-100 |
| PubTables-1M | dataset | 575,305 pages / 947,642 tables from PubMed Central with bounding boxes for rows, columns, cells (incl. blank), column headers, projected row headers,… | yes | CDLA-Permissive-2.0 (dataset card); Table Transformer code MIT (github.com/micr… | The richest row/column/word ground truth for testing table-row reconstruction after scan degradation (apply Augraphy to the clean page images, OCR, then check that words are regrouped into the right rows). Clean scienti… | https://huggingface.co/datasets/bsmock/pubtables-1m |
| PubTabNet 2.0 | dataset | 568k+ table images from PMC Open Access with HTML structure tokens, cell text tokens and cell bboxes (non-empty cells) | yes | Annotations CDLA-Permissive-1.0; images under the PMC Open Access Subset terms | Same use as PubTables-1M at table level; relevant to row reconstruction, less so to page-level OCR. Prefer PubTables-1M (word-level boxes) unless HTML-structure scoring is wanted. | https://github.com/ibm-aur-nlp/PubTabNet |
| SynthTabNet (IBM DS4SD) | dataset | ~600k synthetic table PNGs in four styles — fintabnet-like, marketing, pubtabnet-like, SPARSE — with HTML structure tokens, bbox for EVERY cell (empt… | yes | CDLA-Permissive-1.0 (LICENSE.md) | Fully synthetic, so zero PII risk; the 'sparse' style (many blank cells, short numeric columns) is the closest generic analogue to transcript course tables. Use a few thousand sparse tables + Augraphy for row-alignment … | https://github.com/IBM/SynthTabNet |
| WTW — Wired Table in the Wild | dataset | 14,581 images of wired tables from photos, scans and web pages (~50% natural-scene photos) with cell quadrilaterals and start/end row/column indices … | yes | No licence stated in the repo (LICENSE file linked but not shown); hosted on Al… | The most realistic PHOTOGRAPHED-table set (phone photos with perspective, shadows, curvature) and the only one with row/column indices; no cell text, so OCR scoring needs manual GT for a small subset. Good for evaluatin… | https://github.com/wangwen-whu/WTW-Dataset |
| FUNSD — Form Understanding in Noisy Scanned Documents | dataset | 199 real noisy scanned forms (RVL-CDIP/tobacco-archive subset) with 31,485 words, 9,707 entities, 5,304 relations; word boxes and text | yes | Research / non-commercial use per the project's licence page (secondhand; the p… | Relevant to the header block (Name / ID / Program key-value lines) under genuine scanner noise, not to tables. SROIE (ICDAR 2019 receipts, 1,000 scans with line text and key fields; registration required, licence unstat… | https://guillaumejaume.github.io/FUNSD/ |
| Augraphy | other | Python document-image degradation library: ink/paper/post phases; BadPhotoCopy, BleedThrough, Brightness, DirtyDrum, DirtyRollers, Faxify, Folding, G… | yes | MIT (© 2023 Sparkfish LLC); depends on OpenCV (Apache-2.0), NumPy (BSD) | Single engine covering every degradation the task lists except stamps (use WaterMark or draw seals with Pillow). Seed random/numpy for reproducibility. Masks/keypoints/bboxes are carried through spatial augmentations, s… | https://github.com/sparkfish/augraphy |
| ocrodeg (NVlabs) | other | Small numpy/scipy library: random_transform (rotation, anisotropy, scale, translation), bounded_gaussian_noise page warps (paper curl, ink spread), n… | no | NO LICENSE file in the repository (raw LICENSE 404); PyPI metadata could not be… | Avoid as a dependency: unlicensed code cannot be redistributed and the project is unmaintained. Its two warps (bounded Gaussian displacement field, 1-D ruled distortion) are a few lines of scipy.ndimage.map_coordinates … | https://github.com/NVlabs/ocrodeg |
| genalog (Microsoft) | other | Synthetic document generation from simple HTML layouts (WeasyPrint), custom image degradation to imitate scanned-text noise, plus a text-alignment mo… | yes | MIT; 'limited support' maintenance mode | Its genalog.text alignment (GT ↔ OCR output) and metrics are reusable for CER/WER scoring even if Augraphy does the degradation. HTML-template generation is an alternative to the repo's PDFKit-style generator for new la… | https://github.com/microsoft/genalog |
| DocCreator (LaBRI) | other | GUI tool (macOS .dmg, Windows .exe, Docker, source on GitHub) for semi-synthetic document images: bleed-through, ink degradation, adaptive blur, hole… | yes | Open source; LGPL-3.0 per LaBRI's software listing (verify in the GitHub LICENS… | Interactive, so handy for one-off visual experiments (3D page curl, bleed-through of a back page) rather than a scripted benchmark. Qt GUI — not for CI. | https://doc-creator.labri.fr/ |
| Rasterising and basic image ops (Python and Node, offline) | other | Pillow (HPND 'MIT-CMU'): rotate/blur/JPEG/noise/alpha-composite stamp & watermark/perspective transform/save as image-only PDF (already used by tests… | yes | Pillow HPND; poppler GPL (CLI, no linking); pdf2image MIT; PyMuPDF AGPL-3.0; Op… | Pillow alone can do the whole requested ladder (rotation 0.5–3° via Image.rotate(bicubic, fillcolor=255), GaussianBlur σ 0.5–1.2, JPEG quality 40–75, Gaussian/salt-pepper noise via numpy, stamps via alpha_composite of a… | https://pypi.org/project/Pillow/ |
| OCR scoring tools | other | ocreval (ISRI Analytic Tools: accuracy, wordacc, synctext — character/word accuracy per the UNLV/ISRI standard); rapidfuzz (Levenshtein / normalized … | yes | ocreval Apache-2.0; rapidfuzz MIT; jiwer Apache-2.0 (avoid python-Levenshtein, … | Score two things separately: line-stream CER after the app's whitespace collapse, and course-row recovery (code, credits, grade exact match; title fuzzy ≥ 0.9) through the real parser — the second is what the DGS cares … | https://github.com/eddieantonio/ocreval |

Recommendations from the research:
- TOP SOURCES (in priority order). 1) MERIT (HF de-Rodrigo/merit, MIT): download only en-render-seq plus the en-digital rotation / rotation-zoom / watermark / noisy degradation subsets (~30 GB, not the 307 GB) as the large labelled photo-degraded table benchmark. 2) The repo's own synthetic PDFs from tests/fixtures/make-transcript-pdfs.mjs (11 layouts: ND unofficial/official/undergrad/combined, Banner two-column, watermarked, external, UC-system, no-lines, other) — exact ground truth from the generator, zero PII. 3) Public placeholder text PDFs: ANU sample (already pinned), University of Bath's four example transcripts, the Vaasa template, Europass DS examples, Turkey's KMU 'Örnek Öğrenci' DOCX set (via LibreOffice) — rasterise, never commit the sources. 4) CHSI/CSSD English sample JPGs of the transcript verification report (the only official red-seal image specimen found; reference only, hand-typed GT, not committed). 5) NoisyOffice (CC BY 4.0) for real stain/fold calibration. 6) ShabbyPages (MIT) to calibrate Augraphy parameters to scanner reality. 7) SmartDoc 2015 Challenge 2 sample archive (CC BY 4.0) for phone-photo calibration. 8) DDI-100 (MIT) for stamp masks and geometric warps. 9) SynthTabNet 'sparse' (CDLA-Permissive-1.0) and a few thousand PubTables-1M pages (CDLA-Permissive-2.0) for row/column reconstruction tests. 10) WTW (Tianchi registration, licence unstated, research only) if a photo-deskew pre-step is ever considered. 11) FUNSD (research terms) only for header key/value lines. Tools: Augraphy (MIT) + Pillow (HPND) + pdfjs-dist/@napi-rs/canvas or pdftoppm for rendering; ocreval/rapidfuzz for CER; the app's own tesseract.js via scripts/dev/ocr-lines.mjs so numbers match the browser.
- DO NOT USE: any Scribd/ngrok/personal-page transcript uploads (real students' records surfaced for Nigeria, Pakistan, Taiwan high school, IIT Kharagpur, UPES, Himachal Pradesh, an ngrok eTranscript); the WES 2012 'India Sample Documents' PDF until someone off-repo confirms every name/roll number is redacted (and even then © WES, uncommitted); the ASEE 2025 'open-source transcript image dataset' until its data statement confirms synthetic/placeholder data and a licence; ocrodeg (no licence file); PyMuPDF inside anything shipped (AGPL — dev scripts only). RVL-CDIP/DIBCO add nothing for this task.
- COVERAGE GAPS (no safe public image specimen exists): Iran (Sharif/Tehran/Amirkabir), Korea, Taiwan, Vietnam, Bangladesh, Nepal, Pakistan, Nigeria, Ghana, Ethiopia, Egypt, Mexico, Colombia, Saudi Arabia, and India beyond the unverified WES set. Build these synthetically from the composed text fixtures already in tests/fixtures/public-transcripts (sharif, kaist-korea, ntu-taiwan, nthu-taiwan, hust-vietnam, buet, tribhuvan_ioe, lums, unilag, ug_ghana, aau, cairo, unam, uniandes, kfupm, anna-university, university-of-mumbai, jntu-hyderabad, vtu, university-of-delhi): render each line list to a page with a bilingual second column where the real document is bilingual (Noto Sans Arabic / Devanagari / Bengali / CJK / KR / Thai, all SIL OFL), Solar Hijri or B.S. dates where applicable, a synthetic circular red seal drawn with Pillow (never a real institution's seal or logo), and run the degradation ladder. 'Jane Q. Student' / 'SAMPLE STUDENT' / 000000000 only.
- BENCHMARK RECIPE — generation. (a) Seeds: the 11 generator PDFs + ANU + Bath ×4 + Vaasa + Europass + KMU + the synthetic country pages above (~30 source pages). (b) Render each page at 150, 200 and 300 dpi, grayscale and RGB, with pdfjs-dist + @napi-rs/canvas in Node (scale = dpi/72; identical rasteriser to the browser) or `pdftoppm -r N -png`; keep the text layer's line list as ground truth (scripts/dev/pdf-to-lines.mts already produces it). (c) Degradation ladder, every level seeded (random.seed / numpy.random.seed / augraphy seed) and written to a manifest: L0 clean raster (sanity: must equal the text layer); L1 'good scan' — 200 dpi, GaussianBlur σ 0.6, JPEG q 75; L2 'office scan' — 150 dpi, rotation ±0.5–1.5°, additive Gaussian noise σ 6, Augraphy LightingGradient + SubtleNoise, JPEG q 60; L3 'photocopy' — 200 dpi, rotation 2–3°, Augraphy BadPhotoCopy + LowInkRandomLines + DirtyRollers + BleedThrough + PageBorder, salt-and-pepper 0.2%; L4 'stamped/watermarked' — L1 plus a Pillow-drawn red seal (ring, star, text on path, alpha 0.5–0.7) over the course table, a diagonal 'UNOFFICIAL' / university-name watermark at alpha 0.15, and Augraphy WaterMark; L5 'phone photo' — 300 dpi source, Image.transform(PERSPECTIVE) with 1–3% corner offsets, Augraphy ShadowCast + Folding + DepthSimulatedBlur, optional Moire, downscale to 1200–1600 px wide (≈100–130 effective dpi), JPEG q 50; L6 'bilingual' — the synthetic bilingual pages at L1 and L5 to measure how non-Latin glyphs disturb the English-only model. 3 seeds per cell. (d) Re-wrap each image as an image-only PDF with Pillow (`img.save(..., 'PDF', resolution=dpi)`, as make-scan-fixture.py does) so the artefact goes through the real ocrPdfToLines path — note the app re-renders at scale 3.0 regardless of the embedded dpi, so 150-dpi scans are upsampled; measure that effect explicitly. Matrix ≈ 30 pages × 3 dpi × 7 levels × 3 seeds ≈ 1,900 images; tesseract.js in Node ≈ 1–2 s each.
- BENCHMARK RECIPE — scoring and pinning. (a) OCR with `node scripts/dev/ocr-lines.mjs out.json page.png` (bundled public/ocr model, whitespace collapsed like the browser), and for a pinned subset through the real browser via the e2e OCR leg (`npm run e2e`, Chromium and WebKit). (b) Metrics per image: line-stream character accuracy (ocreval `accuracy` or rapidfuzz normalized Levenshtein on the joined lines); course-row recovery by running scripts/dev/parse-lines.mts on the OCR lines and comparing to the page's expected rows (code / credits / grade exact, title fuzzy ≥ 0.9) — report rows found, rows correct, false rows; a confusion tally for the field-level errors that matter (0↔O, 1↔l/I, 5↔S, 8↔B, 'B+'↔'Bt', '3.00'↔'3,00'/'3 00', '-' lost from 'A-', term headers merged); and tesseract per-line confidence vs row correctness to calibrate the .ocr-low threshold. (c) Report as CSV + a markdown table by level × dpi (mean, worst page), kept in docs/ once the DGS approves; the script under scripts/dev/make-scan-benchmark.py (Pillow + Augraphy) with its manifest; generated images git-ignored except 6–10 pinned PNG/PDFs (one per level, synthetic names only) committed under tests/fixtures with their expected lines so the e2e OCR leg stays fast and `tests/public-transcripts.test.ts`-style regression catches OCR-path changes. (d) Use NoisyOffice, ShabbyPages and SmartDoc Ch.2 only to sanity-check that each level's error rate sits inside the range real scans/photos produce; use SynthTabNet sparse + Augraphy for row-reconstruction unit tests of scanWithMap/scanTokens. No app changes are needed for the benchmark; if results show large gains from pre-processing, the candidates to evaluate next are deskew (Hough/projection), adaptive binarisation (Sauvola) and upscaling 150-dpi scans — all in-browser, same-origin, no new network calls.

### 4.4 The critic's verdict
Both plans point the right way — measure first, grow the corpus only from public or composed material, fix the text parser by failure family, and improve the bundled Tesseract pipeline before any new engine — and they reuse the existing tooling (public-status, expected.json, make-transcript-pdfs.mjs, ocr-lines.mjs, make-scan-fixture.py, the sanitizers) far more than they duplicate it; the claims checked against the repo hold (public-status really says 95/32, the line references are accurate, @napi-rs/canvas is already installed, tesseract.js 7 exposes setParameters/rotateAuto, the handoff's scale 2.5 is stale). They should not be executed as written, though: the two harness layers must be merged (one scorer, one node loader, one outside folder, rowOf as a helper — the OCR plan's import from the test file provably runs the whole suite), three F1/F2 rules would make the parser guess silently and must be tightened to header or context evidence, FERPA needs two fixes (bench output outside the repo and no per-file rows naming institutions for the DGS's sanitized scans; placeholder-name checks before fetching the Alberta/Evergreen samples), the benchmark's machine time is underestimated by about five times, a CI step-order bug and a native-dependency hazard sit in the OCR verification section, and nothing user-visible ships from the OCR plan for ~33 hours unless the ten-minute interword-spaces experiment is pulled forward. With the adjustments above — text Batch A first, then OCR step 1 on the shared harness — the combined ~140 hours are credible and the before/after proof is real. Timing (from `date`): estimate 20–30 min, actual 6 min 12 s (08:48:18–08:54:30 EDT); nothing was created, edited or downloaded.

Risks the critic raised (each addressed in §2): 
- FERPA (OCR plan §1a.5/§1c): the bench writes degraded images and OCR text to `.ocr-bench/` under the repo tree; when the DGS points `--seeds-dir` at his three sanitized scans, material derived from real records lands inside the repository folder (gitignored, but the 2026-09-05 rule keeps sanitized outputs OUTSIDE the repo under neutral names). And `docs/OCR-BENCHMARK.md` with per-file rows for those scans would publish institution names the sanitizer deliberately keeps (`scripts/sanitize-scan.py` keeps institution names), i.e. that a student from university X applied.
- FERPA (text plan §2a): the Alberta CR/NC sample and the Evergreen 'sample RAA' are asserted fictitious but not checked, while the same plan lists Evergreen GPAC folders among exposed REAL records never to fetch; §2b composes fixtures from 'column names' of exposed real records (Scribd, IIT-KGP uploads, cargo.site…), so a composed fixture could carry distinctive rows of a real person and its sources.json entry could cite an exposed record. The OCR plan handles this correctly for Bath/KMU (its Q8); the text plan does not.
- Concrete defect (OCR plan §1c score.mts, §2.1): importing `rowOf` from `tests/public-transcripts.test.ts` executes the whole 127-fixture suite and prints its TAP output on every bench run — verified: `node --experimental-strip-types -e "await import('./tests/public-transcripts.test.ts')"` runs the tests. The text plan's `tests/helpers/row-of.ts` is the right fix and must be the one both plans use.
- Duplication between the two plans: two scorers (`scripts/dev/score.mts` and `scripts/dev/ocr-bench/score.mts`), two node pdfjs loaders (`pdf-lines-node.mts` and `render-pages.mts`), two `rowOf` relocations, two outside sample folders, two `tests/layout.test.ts` additions, two manifests duplicating the SHA-256s already in `tests/fixtures/public-transcripts/sources.json`. A stranger inheriting both would find two metrics that drift apart.
- 'Never guess' (text plan F1 scanTokens): the points-vs-grade rule 'last numeric token > 4.3 … equals credits×{0..4}' silently discards a legitimate mark on a 20-point scale — credits 4, mark 16.0 (Iran, in the corpus) or credits 3, mark 12.0 — leaving the row with no grade and no flag. The product test alone is a guess; today the token stays as rawGrade for the student to choose.
- 'Never guess' (text plan F1 integerInTitle): 'a 1–2-digit integer is a title word when the decimal after it is the row's last token and ≤ 6' is ambiguous with a 10-point mark — 'Topics 1   5.0' (credits 1, mark 5.0) would become title 'Topics 1', credits 5, no grade. The parser already has `inProgressBlock` context; the bound '≤ 6' is not evidence.
- Regression (text plan F1 continuation): allowing ≥4 wordy tokens on a continuation line reopens the 2026-09-26 rule ('a two-line row takes its numbers only from a line of numbers, never from the next sentence') that removed 55 false rows from 15 registrar keys; the 32 negative fixtures are the guard and must show zero new rows in the replay delta before the change merges.
- 'Never guess' (text plan F2): six-digit Banner term codes 202310/202320 look exactly like the all-digit course ids the parser accepts ('30240233' shape) and like student ids; read from an arbitrary trailing cell they would silently re-term rows.
- Regression (text plan F4): carrying the previous page's column gap to a short page can split a short ONE-column last page — a legend/back page after two-column pages is precisely what travels inside real PDFs; `tests/fixtures/banner-transcript.pdf` already has such a legend page (the institution is named only there) and must be pinned unchanged. The per-line glyph-join test replaces the page-level 60 % rule chosen on 2026-10-08 for the insideND redacted PDFs; that case has no run-array fixture yet.
- Unguarded change (text plan F5): no test enforces the 2026-10-07 rule that every ExternalCourses university name must keep being read (grep finds no test touching stripRecordWords or the listed names); editing `guessUniversity` for Parchment/NSC/eScrip-Safe wording is blind without it.
- Blast radius (text plan F8/CC15): `courseId: ''` flows into `canonicalCourseId`, duplicate detection, the review-request email, the saved/exported JSON, `data-key` attributes and `rowOf`; unless such rows are un-addable until an id is typed (the mechanism rows without a grade already use), empty ids reach the engine and the DGS's request. The 6–8 h estimate holds only with that scope.
- Time realism (OCR plan §1b): 60 seeds × 3 dpi × 8 levels × 3 seeds = 4 320 pages at 3–6 s per 300-dpi page in Node is 4–7 hours per engine configuration, not 'an hour'; the PSM/threshold/dpi A/Bs multiply that into days. Rendering 93 + 48 line-list fixtures also yields ~140 seeds, not 60.
- Measurement validity (OCR plan §1a.2): rendering composed line lists to images with 'three-space gaps as tab stops' measures OCR on a layout no registrar printed — twice removed from a real scan. Only the 34 public registrar PDFs (the 32 negatives are valuable: 'no row under noise') and the DGS's private material are realistic; the plan seeds only ANU/Vaasa/Europass from the public set.
- CI (OCR plan §4): `.github/workflows/test.yml` runs `npm test` BEFORE `npm run build`, so a `tests/ocr-assets.test.ts` that inspects the lazy chunk in `dist/` fails or is vacuous in CI.
- Dependency hygiene (OCR plan §3): `onnxruntime-node` + `paddleocr` as root devDependencies add a native post-install (tens of MB) to every `npm ci`, including the six-hourly sync-sheet Action and Pages deploy, for a gate run once. Augraphy/OpenCV are fine licence-wise (MIT/Apache) but 'Pillow + numpy need nothing new' is false on a fresh machine — same precedent as `scripts/sanitize-scan.py`, which must be said in MAINTENANCE.
- Safari (OCR plan §2.3): the 16 MP / 4096-px cap is only exercised by the DGS's hands-on iOS pass; `E2E_BROWSER=webkit` is desktop WebKit with no canvas ceiling, so the fallback arithmetic needs its own unit test or it ships untested.
- Guessing in the UI (OCR plan §2.6): an OCR-tolerant `isUnofficial` ('UNOFFlClAL') infers a word from a garble; it only warns (2026-09-17), but false warnings on official scans must be measured on the negatives, and the term-header repair ('Fall 2O23') mis-years a block silently if it is wrong — it must raise the proposed warning, not just fix.
- Privacy of image strips (OCR plan §2.7): preview rows are copied into the Student record on Add, which is autosaved to localStorage and exported; a data-URL field on the row object leaks into both unless a test asserts it never does.
- Delivery (OCR plan): nothing user-visible ships until ≈33 h in (benchmark + 2.1); the ten-minute `preserve_interword_spaces` + collapse-removal experiment is the obvious first measured commit and is buried in 2.1.
- Known-failing list (text plan §4): an ungated F1–F3 change may make a listed fixture pass by accident; the test then fails ('now passes — remove it') while the DGS question is still open, and the plan says nothing about what to do.
- Licence/provenance (text plan §2a Q7): the McGill set's MIT licence and 'identities fake by construction' are asserted, not verified at a pinned commit; and a student project's imitation of Minerva is not registrar geometry — calibrating to it risks fitting the imitation. Vendor pages (Parchment, NSC, eScrip-Safe, GlobalSign) committed verbatim as negative fixtures are copyrighted commercial content; the registrar-key precedent exists but should be stated in sources.json and the lines kept minimal.
- Sequencing: both plans edit `src/transcript/layout.ts` (text F4 hint and glyph join; OCR 2.1 routes word boxes through it) and both need the scorer and node loader; done in parallel they will conflict and double-count the layout tests.
- Scope of the DGS list: CC16 (an engineering gap, not on the DGS's (a)–(g) list), the ANU re-pin (anticipated in DECISIONS 2026-09-26), Augraphy, the benchmark table's location and the render-scale/rotation internals are Claude's calls; asking the DGS 21 questions dilutes the eight that genuinely reverse a recorded decision or set policy.

## 5. Progress

### Batch A — done 2026-10-09 (branch `claude/policy-compliance-degree-engine-44a431`)

Commits, oldest first; each was verified with `npx tsc --noEmit` and the full `npm test` before it was
made, and the parser commits with the replay against the baseline:

- `d124c11` rowOf moves to tests/helpers/row-of.ts; nothing imports a test file any more (step 1)
- `433a376` One scorer for parsed transcripts: scripts/dev/score.mts, pinned by tests/replay-score.test.ts (step 1)
- `ab2bdff` One Node pdfjs loader: scripts/dev/pdf-lines-node.mts (lines and page PNGs) (step 2)
- `bbee934` Replay: npm run replay scores both corpora and a PDF folder; public-status is its alias (step 3)
- `bcd810a` tests/external-names.test.ts: every listed university name keeps reading unchanged (F5 precondition)
- `26daf0e` Docs for the transcript replay: tests/README, MAINTENANCE, the handoff, STATE, three DECISIONS rows
- `335f0b6` External parser F1: two-line rows (code alone, wrapped title), points vs grade, in-progress integer in the title
- `5d516d0` External parser F2: term-code cells (2023FA, 202310) and Workday term headers
- `ed8861d` External parser F3: "ENG M 612" subjects, Workday's dash after the number, Colleague's section cell
- `dd3b3cb` Parser fixes F1-F3: review fixes (six confirmed findings, five DECISIONS rows)
- `2bf3185` Batch A step 5: twenty public specimens as fixtures (Alberta CR/NC, Evergreen RAA, five negatives, the McGill Minerva set)
- `eb9cd8f` Specimens: review fixes (the McGill ground truth's two `unrecognized` lines pinned as rows)
- the closing commit "Batch A: verification and records" — this section, STATE.md, the handoff's Batch A
  index, and the WordPress footer snippet's repository name (the rename commit `5b28784` had missed
  `docs/wordpress-footer-snippet.html`, which failed the e2e's snippet check on both engines).

Numbers — before is `bench-out/text-baseline-20261009.json` (after step 3, before any parser change),
after is `bench-out/text-batch-a-final.json`; on the 127 fixtures both hold: 0 regressions, 0 improvements.

| | before | after |
|---|---|---|
| public fixtures (positive + negative) | 127 (95 + 32) | 147 (108 + 39) |
| known-failing | 5 (5 still failing) | 18 (18 still failing, 0 now passing) |
| exact (= the test's pass) | 122/127 | 129/147 |
| row recall | 1113/1164 (95.6%) | 1248/1328 (94.0%) |
| row precision | 1113/1113 (100%) | 1248/1255 (99.4%) |
| false rows on negatives | 0 (in 0/32) | 1 (in 1/39) |
| cells title / credits / grade / term / level | 100 / 100 / 100 / 99.3 / 100% | 93.8 / 98.4 / 94.2 / 99.4 / 100% |
| ms corpus | 48/48 exact, 648/648 rows | 48/48 exact, 648/648 rows |
| pdfs board (`public-pdfs/`, `--verify`) | — | 20 PDFs, 20 hash ok; exact 7/20; recall 135/164 (82.3%); precision 135/142 (95.1%); cells 42.2 / 85.2 / 45.9 / 100 / 100% |
| `npm test` | 1475 pass | 1536 pass, 0 fail |

Every drop on the public board is the 20 specimens pinned to the truth (13 known-failing, each naming
its Batch B family); the F1–F3 commits and their review fixes left the board identical to the baseline
(false rows on negatives stayed 0/32). At the closing commit `npx tsc --noEmit`, `npm run build`,
`npm run e2e` (Chrome) and `E2E_BROWSER=webkit npm run e2e` pass, and `public-status` reports the five
original known-failing fixtures and the 13 specimens failing.

Deviations from §2, each recorded in `docs/DECISIONS.md` (2026-10-09): `tests/replay-score.test.ts`
pins six cases, not three, and asserts `exact` against both corpus tests for every fixture; F1b's
points evidence is the header in force (`columnKinds`) — the review found the planned document-wide
"a Points column was mapped" flag wrong; the McGill set is thirteen pages, not twelve; the
known-failing list names each fixture's family, which answers the critic's "ungated change" case (a
listed fixture that starts passing still fails the test until the list is edited on purpose).

Open issues (carried into Batch B unless marked for the DGS):

- **DGS:** Melbourne (My eQuals sample, 403) and Limerick (Digitary sample, 404) refuse automated fetch
  — download them in a browser if wanted. Nothing else planned for Batch A was dropped.
- **DGS:** `docs/wordpress-footer-snippet.html` now names the renamed repository; the copy pasted into
  WordPress's footer field must be re-pasted from it when the iframes move to the new Pages address —
  the deployed copy matches frames by the old name and would leave the frame at its starting height.
- The pdfs board does not apply the known-failing list, so its exact 7/20 reads worse than the public
  board's 129/147 for the same documents.
- `sources.json` labels 18 US negatives `USA` and 37 fixtures `US`; the per-country board splits them.
- From the F1–F3 review, unfixed: a remark with no function word and a real grade cell after a bare
  code ("Excellent performance in all courses   4   A") still reads as that code's row — nothing on
  the line distinguishes it from a title.
- The build's chunk warning (`src/transcript/external.ts` imported dynamically and statically) predates
  Batch A (present at `e34279d`).
- Batch B's first targets are the 13 specimen fixtures: F6 (Alberta's and Minerva's headers), F5
  (transfer and exemption blocks read as the university), F4 (Alberta page 2's header runs dropped by
  `dropWatermarks`), F3 (Minerva's multi-term mark), F1c, and an "is this a transcript" gate for the
  course-outline page. The five original known-failing fixtures wait on Batch C, whose DGS answers are
  recorded (DECISIONS 2026-10-09).

### Batch B — done 2026-10-09 (branch `claude/policy-compliance-degree-engine-44a431`)

Commits, oldest first; each was verified with `npx tsc --noEmit` and the full `npm test` before it was
made, and the parser and layout commits with the replay against the previous step's file:

- `ab2d41c` Batch B step 6: 21 composed layout fixtures (Workday, Colleague, CUNYfirst, Oregon, UCLA,
  McMaster, Western, Ladok, SNU, Sabanci, Ukraine, Algeria, IIT, NIT, HEC, Iran, NSU, Tribhuvan;
  Parchment, NSC and eScrip-Safe wrappers)
- `bc5f1ba` External parser F6: header words and header shapes the column reader could not map (step 8)
- `a803ef2` External parser F5: vendor covers, transfer and exemption blocks and recipient lines never
  name the university; F3: Minerva's multi-term mark (step 8)
- `4ca40c7` Layout F4: watermark tiles counted where a word repeats down the page, a short last page
  split by the previous page's column hint, the glyph join per line; Alberta reads exact (step 8)
- `0af7c3d` Batch B F4-F6: review fixes (four confirmed findings, four DECISIONS rows)
- the closing commit "Batch B: verification and records" — this section, STATE.md, the handoff's
  "Batch B at a glance" index, the counts in `MAINTENANCE.md` and `tests/README.md`, one DECISIONS
  row (step 7 deferred; the e2e driver), and `scripts/e2e/drive-transcript.mjs`, which still asserted
  the skipped-rows warning's pre-W-CL372 sentence ("listed under “Transfer credit accepted by the
  institution”") and so failed Chrome's transcript-upload driver on the Banner preview until it read
  the F5 sentence (`a803ef2` had not run the e2e — another agent's task).

(The OCR benchmark's `c7cc8c8` sits between the step-6 and step-8 commits on the branch; it belongs
to the OCR steps, not to Batch B.)

Step 7 — positioned PDFs through `tests/fixtures/make-transcript-pdfs.mjs` (a Banner transcript with
a short two-column last page, a Parchment-wrapped Banner transcript) — was not built: F4 is pinned by
run-array cases in `tests/layout.test.ts` and by `banner-transcript.pdf` read through the Node
loader, and the Parchment wrapper exists as a composed line list (`pdf-key-rice-parchment-wrapped`).
It stays an open item below (DECISIONS 2026-10-09).

Numbers — before is `bench-out/text-batch-a-final.json` (the end of Batch A), after is
`bench-out/text-batch-b-final.json`; on the 147 fixtures both hold: 0 regressions, 22 improvements
(eleven fixtures, each on the public and the pdfs board — Alberta and the ten McGill Minerva record
pages, now exact).

| | before | after |
|---|---|---|
| public fixtures (positive + negative) | 147 (108 + 39) | 168 (129 + 39) |
| known-failing | 18 (18 still failing) | 21 (21 still failing, 0 now passing) |
| exact (= the test's pass) | 129/147 | 147/168 (87.5%) |
| row recall | 1248/1328 (94.0%) | 1663/1809 (91.9%) |
| row precision | 1248/1255 (99.4%) | 1663/1678 (99.1%) |
| false rows on negatives | 1 (in 1/39) | 1 (in 1/39) |
| cells title / credits / grade / term / level | 93.8 / 98.4 / 94.2 / 99.4 / 100% | 100 / 99.9 / 99.3 / 97.8 / 100% |
| ms corpus | 48/48 exact, 648/648 rows | 48/48 exact, 648/648 rows |
| pdfs board (`public-pdfs/`, `--verify`) | 20 PDFs, 20 hash ok; exact 7/20; recall 135/164 (82.3%); precision 135/142 (95.1%); cells 42.2 / 85.2 / 45.9 / 100 / 100% | 49 PDFs, 49 hash ok; exact 47/49; recall 184/203 (90.6%); precision 184/184 (100%); cells 100 / 100 / 100 / 100 / 100% |
| `npm test` | 1536 pass | 1585 pass, 0 fail (1590 with the OCR step's two uncommitted test files) |

The pdfs board grew from 20 to 49 PDFs because the OCR benchmark's `--fetch` re-downloaded the keys
and forms Batch A had not (each verified against `sources.json`; four links were dead and Rice's key
had changed upstream, so 49 of the 54 `pdf` entries are on disk); its two failures are Evergreen's
code-less RAA (CC15, Batch C) and the McGill course outline's one false row (the transcript gate).
The recall and term drops on the public board are the 21 composed fixtures pinned to the truth
(14 of them known-failing, each naming its family); the parser commits only raised the board
(step 8's table below: 133 → 147 exact over F6, F5 and F4, 0 regressions at every step). At the
closing commit `npx tsc --noEmit`, `npm run build`, `npm run e2e` (Chrome) and
`E2E_BROWSER=webkit npm run e2e` pass, and `public-status` reports "exact 147/168 (87.5%),
known-failing 21 (21 still failing, 0 now passing), test: passes".

Deviations from §2, each recorded in `docs/DECISIONS.md` (2026-10-09): step 7's positioned PDFs were
not built (above); F4's "30% of runs" became 30% of a short page's baselines holding a run at the
hinted edge, with two wordy texts there, nothing crossing and a course column on both sides (the F4
row and its review row); the glyph join is per line at 80%, with the page-level 60% signal as a
second trigger at 50% (the review row); the known-failing list grew to 35 at step 6 and shrank to 21
through step 8, each entry naming only the families still open.

Open issues (carried into the OCR steps and Batch C unless marked for the DGS):

- **DGS:** the transcript gate — the McGill course-outline page still reads one false row (the one
  false row on the negatives); a step-8 DECISIONS row proposes an "is this a transcript at all?" test
  and asks before any page-level guess.
- **DGS:** whether "The City University of New York" is a campus system for `campus.ts` (the
  CUNYfirst fixture's system line beats the college's header), and whether a "Trimester GPA" totals
  label and a registrar's calendar sentence count as trimester evidence (the North South fixture).
- **DGS:** open question (g) — Sabanci's legend-defined P (Progressing). Answered 2026-11-03 (question 6 (a): the key decides — P reads in progress; `sabanci-dual-credit` passes).
- Families still open on 14 composed fixtures (their known-failing entries name them): F2 (Workday's
  "2024-25 Winter Term 1" headers; Nepal's continuously numbered semesters under an academic-year
  range), F3 (McMaster's digit-letter-digit, SNU's dotted and UCLA's one-digit course numbers), F1
  (UCLA's "IN PROGRESS" term header), Ladok's module lines and "Date of issue", Western's
  course-number suffix terms, Oregon's glued grade symbols and key-page "quarter hours", the
  Ukrainian supplement's Cyrillic codes and grading-scale line, the Algerian relevé (CC15, Batch C),
  Bangladesh's trimester evidence (the DGS question above).
- Step 7's positioned PDFs: the short two-column last page and the Parchment-wrapped Banner
  transcript are pinned on run arrays and a composed line list, not on pdfjs's own text runs.
- The term cell at 97.8% on the public board is the composed term headers above, all on the list.
  From Batch A, still open: the remark-row case from the F1–F3 review, the pdfs board not applying
  the known-failing list (its 47/49 now reads better than the public board's 147/168 only because
  the composed fixtures have no PDF), the `USA` / `US` country labels in `sources.json`, and the
  build's chunk warning.

### Batch B step 8 — parser and layout fixes F4–F6 (2026-10-09)

Three commits, by family, each verified with `npx tsc --noEmit`, the full `npm test` and the replay
against the previous step's file (0 regressions at every step): F6 `bc5f1ba` (header words and
header shapes), F5 + F3's multi-term mark `a803ef2` (what never names the university; the exemption
block; the recipient line in nd-markers), F4 (the layout stage; the Alberta fixture regenerated from
its PDF and its CR rows re-checked to S). The rules are quoted in the DECISIONS rows of the date; the
handoff's "Batch B step 8" bullet indexes the code.

| | after step 6 (`text-after-composed.json`) | after F6 | after F5 | after F4 (`text-after-F4.json`) |
|---|---|---|---|---|
| public exact | 133/168 | 142/168 | 146/168 | 147/168 |
| public row recall / precision | 91.4% / 98.7% | 91.9% / 98.7% | 91.9% / 99.1% | 91.9% / 99.1% |
| public cells title / credits / grade / term | 91.9 / 95.3 / 92.6 / 97.6% | 98.6 / 99.0 / 98.1 / 97.8% | 99.0 / 99.0 / 98.1 / 97.8% | 100 / 99.9 / 99.3 / 97.8% |
| false rows on negatives | 1 (in 1/39) | 1 | 1 | 1 (the McGill course outline — the gate question) |
| pdfs exact (`--verify`, 49 PDFs) | 36/49 | 43/49 | 46/49 | 47/49 |
| pdfs cells title / credits / grade | 55.2 / 88.5 / 58.0% | 87.0 / 91.8 / 89.1% | 90.8 / 91.8 / 89.1% | 100 / 100 / 100% |
| known-failing | 35 | 26 | 22 | 21 |
| ms corpus | 48/48, 648/648 | unchanged | unchanged | unchanged |

**Review of F4–F6 (2026-10-09)** — four confirmed findings, one commit ("Batch B F4-F6: review
fixes"), each reproduced on HEAD and pinned: F6's term ordinal fired under any header-mapped term
column (a numbered Semester or Year column read 2 as spring and 3 as summer) — a bare number is now
a term cell only under a term-numbering header word and is read as the ordinal only under "TM";
F6's "CH" read a Brazilian histórico's 60 and 90 hours as credits — CH beside a Portuguese or
Spanish header word is the carga horária, and an English CH value above the credit-hour range
leaves the credits blank; F4's hinted split parted a label/value "Degree Awarded: / Conferred:"
page — both sides must now show a course column (a term header, a Banner total, a code); F4's
per-line glyph join left a 75% line on a glyph page letter-spaced — the page-level 60% signal is
back as a second trigger. Board unchanged (`text-after-F4F6-review.json` vs `text-after-F4.json`:
0 regressions, 0 improvements); `npm test` 1590 pass. The rules are in the four DECISIONS rows.

Still open after this step (their entries on the known-failing list name them): F2 (Workday's
"2024-25 Winter Term 1" headers, Nepal's continuously numbered semesters), F3 (McMaster's
digit-letter-digit numbers, SNU's dotted numbers, UCLA's one-digit numbers), F1 (UCLA's "IN
PROGRESS" term header), Ladok's module lines and "Date of issue", Western's suffix terms, Oregon's
glued grade symbols and key-page "quarter hours", the Ukrainian supplement (Cyrillic codes) and its
grading-scale line, the Algerian relevé (CC15), Bangladesh's trimester evidence, the CUNY question,
open question (g) (Sabanci's legend-defined P), and the transcript gate (a DGS question, DECISIONS).


### OCR step 10 — done 2026-10-09 (branch `claude/policy-compliance-degree-engine-44a431`): measured, not adopted

Two commits. The first (`75b4f9a`) set `preserve_interword_spaces: '1'` through `worker.setParameters` in
`src/transcript/ocr.ts`, removed the whitespace collapse, and moved the line builder into the new pure
`src/transcript/ocr-lines.ts`, imported by `ocr.ts`, by the bench's `ocr-run.mjs` and by
`scripts/dev/ocr-lines.mjs` (never a hand copy); `tests/ocr-lines.test.ts` pins it. The second reversed the
shipped behaviour on the evidence below and kept the plumbing: `OCR_ENGINE_PARAMETERS` (empty — where a
later step adds a parameter with its measurement), `ocrLineText` (the collapse), `ocrKeepSpaces` (the
variant, behind `ocr-run.mjs --interword`), and the bench's `--compare <dir> --baseline <dir>` for two
finished runs. Both verified with `npx tsc --noEmit`, `npm test` (1594 pass) and `npm run build`.

Numbers on the same code — `npm run ocr-bench -- --quick` (6 seeds, 12 pages), before = the collapse
(`bench-out/ocr-step10-before-quick/`), after = the variant (`bench-out/ocr-step10-after-quick/`):

| level | row acc | rows found | false rows | field acc | CER | before → after |
|---|---|---|---|---|---|---|
| L0 | 55.2% | 82.8% | 10 (0/1 neg) | 87.5% | 60.6% | identical |
| L2 | 51.7% | 82.8% | 12 (1/1 neg) | 85.0% | 60.3% | identical |
| L5 | 48.3% | 79.3% | 11 (0/1 neg) | 87.8% | 60.2% | identical |

Per-seed probes of the full ladder, same code, both configurations: Alberta's CR/NC sample at L2 (office
scan, 150 dpi) 23 → 21 rows with 13 of 21 mis-celled — the engine prints the title–grade gap as one space
and only the points gap as three, so the header-mapped path reads points as credits and loses the grade;
Duke's grade key at L0 3 → 5 false rows; ANU's sideways L6-90 page 0 → 1 junk row (confidence 34, flagged).
The engine's space counts shrink with resolution and are not column evidence; word-box geometry is
(step 11, which rebuilds lines from boxes and needs no engine spacing).

The full ladder with the variant (`bench-out/ocr-step10-20261009/`, the baseline's 62 seeds and degraded
PDFs, 620 rows, 41 min): row accuracy 50.0 / 48.5 / 42.2 / 49.6 / 36.3 / 44.4 % and false rows 21 / 23 /
25 / 24 / 22 / 23 at L0–L5; L6-90 315 false rows, L6-180 52. Its deltas against `ocr-baseline-20261009`
(47 regressions, 36 improvements; L6-90 221 → 315) are confounded: that baseline ran at 11:05 on the
parser before Batch B's F4–F6 (its `text` row 49/62 exact, today's 60/62), so only the L6-90 jump and the
probes are attributable. A clean before run on today's code (`bench-out/ocr-step10-before-20261009/`)
was started detached at the second commit; `npm run ocr-bench -- --compare <after> --baseline <before>`
prints the clean deltas (open item in `docs/STATE.md`). Every later OCR A/B takes that run, made on
today's parser, as its baseline. `--pinned` waits for step 9's pinned pages.

### OCR step 11 — done 2026-10-09 (branch `claude/policy-compliance-degree-engine-44a431`): word boxes through the layout stage

The pipeline is now render → recognize (`blocks`) → `src/transcript/ocr-lines.ts` → `src/transcript/layout.ts`
→ parser. `blocksToRuns(blocks, scale, pageHeightPx)` turns the engine's word boxes into the layout's `Run`s
(pixels / scale = PDF units, y flipped up, every run of a line at its line's baseline middle) and
`ocrPageLayout(blocks, canvasWidth, canvasHeight, scale, { hint, confidence })` reads them through `pageLayout`
exactly as a text PDF's runs are read: watermark tiles dropped, a two-column page split and read column by
column, a gap past 8 units rendered as three spaces, the column hint handed to the next page. `ocr.ts` keeps
rendering and the worker; the bench's `ocr-run.mjs` and `scripts/dev/ocr-lines.mjs` import the same module
(`--engine-lines` / `--interword` run the step-9/10 builder, kept as `linesFromBlocks`). One rule of its own:
words of one engine line a word space apart — at most 0.55 of the line's height (`WORD_SPACE_SHARE`; word spaces
measure 0.2–0.5 on the pinned pages, cell gaps 0.75 or more) — are one phrase run, as pdfjs gives the layout
"College of Science" as one item (per-word runs made "Science" a watermark tile on the Banner page); two TITLE
WORDS (letters only, ≥ 2, ≥ 3 when all capitals — never a grade) up to 1.1 of the line height apart are one
phrase too (`TITLE_WORD_SPACE_SHARE`): a monospace face's word space is a whole cell, 0.8–0.9 of the height, and
the app's own scan fixture (DejaVu Sans Mono rows) read "Operating   Systems" under the first tier alone; the
tier is neutral on rows (`--quick`, `--pinned`), CER within 1.4 points on one key page. Each line's
confidence is its least confident word's (`OCR_LINE_CONFIDENCE = 'min-word'`; the A/B and the floor are in
DECISIONS). `layout.ts` gained `groupLineRuns` and `pageLayout().lineRuns`; the text path is unchanged (replay
0 / 0 against `text-batch-b-final.json`). Tests: `tests/ocr-lines.test.ts` (hand-made blocks, a two-column page the
engine read across both columns, the hint across pages, the glyph join on word boxes, and every pinned page's
reading under `PINNED_READING`), `tests/layout.test.ts` (an OCR-word two-column page, `groupLineRuns`, per-word
tiles vs phrases). Step 9's nine pinned pages (`tests/fixtures/ocr-scans/`, 0.96 MB, placeholder identities) are
committed with this step; their `.expected.json` now carries the page's pixel `width` / `height`.

Numbers, same parser (`--quick`: 6 seeds, 12 pages; before = `bench-out/ocr-step11-before-quick/`, after =
`bench-out/ocr-step11-after-quick/`):

| level | row acc | rows found | false rows | field acc | CER | flag P/R |
|---|---|---|---|---|---|---|
| L0 | 55.2 → 65.5 % | 82.8 → 93.1 % | 10 → 2 | 87.5 → 88.9 % | 60.6 → 22.5 % | 85.7 / 33.3 → 44.4 / 80.0 % |
| L2 | 51.7 → 62.1 % | 82.8 → 93.1 % | 12 → 2 | 85.0 → 86.7 % | 60.3 → 23.5 % | 87.5 / 33.3 → 41.2 / 63.6 % |
| L5 | 48.3 → 58.6 % | 79.3 → 93.1 % | 11 → 4 | 87.8 → 88.9 % | 60.2 → 30.6 % | 75.0 / 15.0 → 70.6 / 85.7 % |

Per seed: the Banner transcript 4/5 → 7/8, 3/6 → 6/9, 2/5 → 5/9 rows right/found of 10 at L0/L2/L5 (CER 54 → 9 %);
the Vaasa template's 10–11 extra rows → 0–1 (CER 33 → 17 %); the other generator seeds identical. One regression:
Stanford's grade key (a negative) 0 → 2 false rows at L0 and 0 → 3 at L5 — junk lines read at confidence 18–33
whose cells the parser's cell path takes for a code ("CONTIN 44", "343332"), all flagged; the position-free scan
had refused them (a cell-level rule belongs to step 2.5). `--pinned` (`bench-out/ocr-step11-after-pinned/` vs
`-before-pinned/`): the L2 Banner page 5/6 → 6/10 rows right/found, CER 67.6 → 11.8 %; the other eight pages
identical (the sideways L6 pages read nothing either way). Verified: `npx tsc --noEmit`, `npm test` 1605 pass,
`npm run build`.

The full ladder, same parser (62 seeds — 26 positives, 36 negatives — 151 pages, 620 rows; before =
`bench-out/ocr-step10-before-20261009/`, the clean run of today's parser with the engine's lines, 43.9 min;
after = `bench-out/ocr-step11-after-20261009/`, 43.9 min, 2.17 s/page; `--compare` prints the deltas):

| level | exact | row acc | rows found | false rows (negatives with any) | field acc | CER | flag P/R |
|---|---|---|---|---|---|---|---|
| L0 | 34 → 35 /62 | 50.0 → 65.2 % | 87.8 → 89.6 % | 19 (5/36) → 13 (6/36) | 81.7 → 87.3 % | 40.5 → 29.1 % | 76.9 / 8.3 → 70.0 / 53.2 % |
| L1 | 33 → 34 | 48.9 → 63.7 % | 88.5 → 90.7 % | 24 (6) → 15 (7) | 81.3 → 86.3 % | 40.4 → 29.5 % | 61.5 / 6.1 → 72.0 / 61.4 % |
| L2 | 34 → 32 | 46.3 → 54.1 % | 86.7 → 88.1 % | 24 (6) → 16 (7) | 80.3 → 80.9 % | 45.5 → 37.2 % | 86.4 / 14.3 → 70.8 / 63.0 % |
| L3 | 34 → 33 | 45.6 → 41.5 % | 83.7 → 81.9 % | 27 (6) → 19 (8) | 83.9 → 81.4 % | 42.6 → 42.2 % | 76.9 / 15.4 → 60.8 / 59.4 % |
| L4 | 32 → 29 | 38.1 → 41.5 % | 85.9 → 86.3 % | 22 (5) → 17 (8) | 76.1 → 73.1 % | 42.3 → 32.0 % | 81.8 / 23.8 → 88.1 / 69.6 % |
| L5 | 34 → 34 | 47.4 → 58.1 % | 87.0 → 89.6 % | 23 (4) → 21 (5) | 81.2 → 83.8 % | 42.3 → 35.8 % | 84.2 / 12.3 → 79.5 / 66.0 % |
| L6-90 | 7 → 6 | 0 % | 0 % | 221 (29) → 274 (30) | — | 90.5 → 90.4 % | — |
| L6-180 | 15 → 16 | 0 % | 0 % | 54 (21) → 48 (20) | — | 91.2 → 91.0 % | — |
| L7 | 30 | 1.1 % | 38.1 % | 100 (6) | 56.7 % | 17.3 % | unchanged (the text layer, never OCR'd) |

128 regression lines, 126 improvement lines (the bench counts a CER move of a point as one). What moved, by
family: the two-column Banner seed reads column by column at every level (rows right/found 4/5 → 7/8 at L0,
6/6 → 9/10 at L1, 3/6 → 6/9 at L2, 6/6 → 9/10 at L4, 2/5 → 5/9 at L5 of 10; its watermarked twin likewise,
with one extra row each level); the Minerva long record 10 → 49 rows right of 49 at L0/L1 (exact), 47 at L2,
48 at L5; the CEGEP record exact at L0/L1; the Vaasa template's 10–11 extra rows → 0–1 at every level; the
ANU sample +1 row found at L2. The losses, all three the parser's cell path on OCR'd cells where the
position-free token scan had been tolerant — the word-box lines themselves are right, and match the text
fixture's line for line: (1) the Alberta sample (PeopleSoft, two-row header): rows right 19 → 18 / 19 → 3 /
18 → 7 / 17 → 12 / 21 → 9 of 24 at L1–L5 — one misread header word ("Avy" for "Avg", "~~", a stray "2")
unmaps the term's columns and the rows under it read their grade into the title ("DIGITAL SIGNAL PROCESSING B
3.0 | 3 | ?") or not at all, while the block whose header the engine read clean (Fall 2019) is exact; (2) the
Minerva multi-term pages: the section cell and the diamond's misreading stay in the title cell ("<> 001
Capstone Design Project"; multi-term-courses rows right 5 → 1 at L0/L1/L5, 4 → 0 at L4; pass-fail L4 2 → 0;
transfer-credits L2 3 → 2; simple-record L4 5 → 4) and every Minerva page's CER rises 0.3–1 → 9–15 % (the
layout now reads the page's header block as cells and in a different order — rows unaffected); (3) negatives:
15 seed × level lines at L0–L5 gained a false row (Duke's key 3 → 4 / 3 → 5 / 2 → 3 / 5 → 10 at L0 / L2 / L3 /
L5, Western Ontario's key 0 → 1 at L0–L4, Stanford's 0 → 2 / 3, McGill's key L4 0 → 2, UTK L3 0 → 1, Tokyo L4
0 → 1, the Minerva "too many pages" L2 0 → 1) — junk cells the cell path takes for a code — against more
lines that lost theirs (total false rows down at every readable level); sideways L6-90 junk 221 → 274. One
loss is the layout's: the insideND page at L4 only (the seal and watermark level) splits its one-column table
into two columns — short titles never cross the middle, the right half's repeated header phrases ("Credit
Hours", "Quality Points", "Academic Standing") pass the wordy-edge test, and `headerStraddles` does not veto a
left header that already holds "Grade" — so the ND parser reads 0 of 5 rows there (the same page reads as
before at L0–L3 and L5). Verdict: ADOPTED — the structural gains (two-column scans, long records, false rows
and CER down at every readable level, flag recall 6–24 → 53–70 %) outweigh the losses, and the losses have one
cause the next OCR step owns: the header-mapped cell path must tolerate OCR noise at least as well as the
token scan did (a fuzzy header word, a stray cell, a title cell's leading section number and symbol), and a
one-column table's split needs a veto that the ND header's "Grade" does not disarm. The Alberta family is the
first target: it is the one real registrar scan family in the bench and it lost most at office-scan quality.

### OCR step 12 — done 2026-10-09 (branch `claude/policy-compliance-degree-engine-44a431`): the engine's parameters, the render scale, preprocessing (plan steps 2.2–2.4)

Every knob an A/B on the same parser against a baseline made on the same code: `--quick` (6 seeds, 12 pages,
L0 / L2 / L5; `bench-out/ocr-step12-before-quick/`), the medium set (62 seeds, 151 pages at L2 and L5;
`-before-medium/`, whose figures equal the step-11 full ladder's row for row, so that ladder served as the
baseline for L3 and L6), and for the resolution a run of L0 at 300 dpi (`-before-l0-300/`). The table of every
experiment with its numbers and verdict is in `docs/OCR-BENCHMARK.md` ("OCR step 12"); the DECISIONS rows of
this date carry the reasons. The runner grew the knobs the step needed (`ocr-run.mjs`: `--scale auto`, `--dpi
auto`, `--border`, `--rotation-trial` / `--trial-always`, `--binary-dir`; `bench.mjs` keeps each page's render
dpi, scan dpi, mean word confidence and trial figures in `results.json` as `pageFigures`).

**2.2 — PSM and the dpi hint: nothing adopted.** PSM 4 and 11 (and 3, run as an extra) all lose rows at L2 /
L5 (row accuracy 58.6 → 27.6 / 34.5 / 27.6 % at L5 on `--quick`; PSM 11 keeps the words and loses the grade
cells, grade accuracy 85 → 56 %) for a cleaner reading of one key page; `user_defined_dpi = 216` changes no
line on `--quick` or the medium set — a no-op for the LSTM engine. PSM 6 stays; `OCR_ENGINE_PARAMETERS` is
still empty.

**2.3 — the render scale: adopted as a SOURCE-AWARE scale.** `ocrRenderScale(pageWidthPt, pageHeightPt,
scanDpi)` in `src/transcript/ocr-lines.ts` renders a page at its scan's own resolution — the largest image the
page paints over the page's inches, read from pdfjs's operator list (`paintedImageSizes`: the operator's own
`[id, width, height]`, never the decoded object, which pdfjs resolves only when drawn; `scanResolution`) —
floored at `OCR_BASE_DPI` 216 (the scale 3.0 the app used before) and capped at `OCR_TARGET_DPI` 300, then
lowered only as far as iOS Safari's canvas caps require (4096 px a side, 16 megapixels; whole thousandths,
the rounded-up canvas checked; unit-tested on Letter, A4, legal, tabloid and a 40-inch page). Evidence: a
flat 300 was a wash at L2 (54.1 → 53.7 %) and LOST at L5 (58.1 → 52.2 %) on the ladder's 150–200-dpi sources —
the rows read better and more confidently at 300, but Minerva's header cell "Cr./C.E.U." came out
"Cr./C.E\U." and the parser's header-mapped path lost every grade under it (the step-2.5 brittleness named
by step 11) — while on 300-dpi sources (L0 at 300, 62 seeds) 300 beat 216: exact 36 → 40, row accuracy 66.3
→ 70.0 %, rows found 89.3 → 92.2 %, false rows 15 → 9, 1.18 × the time (the DGS had accepted up to 2 ×). Under
the shipped rule every ladder level reads exactly as before (`--quick` 0 / 0) and the L0-at-300 board is the
300 one. `ocr.ts` computes the scale per page; a page the caps bring under 216 dpi is listed in
`reducedPages` and the preview's OCR banner names it with its dpi (W-CL373, `ocrReducedPagesNote` in
`preview-layout.ts`); a legal page (293 dpi) or a tabloid (241) is not reduced. The runner's `--scale auto`
is the same rule and is now the bench's baseline config (`--scale 3` reproduces the app before this step).

**2.4 — preprocessing: the orientation trial adopted; the rest measured and not adopted.** The ORIENTATION TRIAL (`ocr.ts`, constants in `ocr-lines.ts`): page 1 is read as it comes and, when the engine's mean word confidence in that reading (`meanWordConfidence`) is under `OCR_ORIENTATION_TRIAL_SKIP_ABOVE` = 70, rendered turned 90 / 180 / 270° (`OCR_TRIAL_TURNS`, pdfjs's viewport rotation) and read again; a turned reading wins only by `OCR_ORIENTATION_TRIAL_MARGIN` = 5 points over the page as it came, and the winning turn is applied to every later page; the preview's banner says the scan was turned (W-CL374, `ocrTurnedNote`). Measured with all four turns always read (medium set, 248 rows): L6-90 row accuracy 0 → 65.2 %, rows found 0 → 90.0 %, false rows 274 → 23; L6-180 0 → 64.4 %, 0 → 90.7 %, 48 → 15; L2 / L5 unchanged but for two junk pages the margin now keeps upright. The two figures are the trial's own data: upright pages score ≥ 70 nine times in ten (median 89.9), the wrong way round ≤ 54.6; the right turn wins by a median of 45.8 points and by ≥ 11.3 on all but a junk form page, the two wrong "wins" by 1.5 and 3.5. Cost: about three extra page-1 recognitions for one page in ten (and for every sideways scan). `--quick` with L6: L6-90 0 → 69.0 %, L6-180 0 → 65.5 %, L0–L5 identical.
`rotateAuto` (the engine's own skew correction) gains 17 points at L3 (photocopies skewed 2–3°: row accuracy
41.5 → 58.9 %, false rows 19 → 15) and loses 16 at L2 (office scans skewed ±0.5–1.5°: 54.1 → 37.8 %, the
Minerva long record 47 → 1) at 1.25–1.3 × the time — the engine's angle is accurate at both levels (0.5–0.6°
applied where L2 lost, 2.8° at L3), so the small-angle re-rendering itself hurts; not adopted, and the
next step's candidate is the two-pass form (keep the deskewed reading only when the engine's estimate is
≥ 1.5°, else read the page plain again). `thresholding_method` was proven to reach the engine (`--binary-dir`
writes the engine's own binarised page; 0, 1 and 2 differ byte for byte) and then rejected: 1 (Leptonica
Otsu) reads nothing at L2 and takes 18 s/page, 2 (Sauvola) cuts false rows (16 → 14, 21 → 14) but loses rows
(L2 54.1 → 41.1 %). `tessedit_do_invert = 0` is 3–7 % faster and +1.5 / +0.4 points, but adds false rows on
the medium set (16 → 17, 21 → 23) — out by the false-row rule. A 10-px white border is neutral on rows and
scrambles a key page's reading order. Verified: `npx tsc --noEmit`, `npm test` 1615 pass, `npm run
build`; e2e not run (not this agent's — the OCR leg on Chrome and WebKit should be run before the DGS ships
this: the scan fixture still reads its three rows at the shipped scale, measured in node).

### Closing verification — 2026-10-09 (Batch B and OCR steps 9–12, plan steps 1–2.4)

The whole program since the plan commit `e34279d`, by step (30 commits before the closing one, all on
`claude/policy-compliance-degree-engine-44a431`):

| step | commits |
|---|---|
| Batch A 1–3, the harness | `d124c11` rowOf · `433a376` the scorer · `ab2bdff` the Node pdfjs loader · `bbee934` the replay · `bcd810a` external-names · `26daf0e` docs |
| Batch A 4, F1–F3 | `335f0b6` F1 · `5d516d0` F2 · `ed8861d` F3 · `dd3b3cb` review fixes |
| Batch A 5, specimens | `2bf3185` twenty public specimens · `eb9cd8f` review fixes |
| Batch A closing | `3b576f2` |
| Batch B 6, composed fixtures | `ab2d41c` (21) |
| Batch B 8, F4–F6 | `bc5f1ba` F6 · `a803ef2` F5 + F3's mark · `4ca40c7` F4 · `0af7c3d` review fixes |
| Batch B closing | `f1ebb50` (step 7 deferred) |
| OCR 9, the bench | `c7cc8c8` (stopped by the harness mid-task; its `MAINTENANCE.md` section, `tests/ocr-assets.test.ts`, `tests/ocr-bench-score.test.ts` and DECISIONS row land in the closing commit below) |
| OCR 10 | `75b4f9a` the variant · `dce9b05` the verdict (not adopted; plumbing stays) |
| OCR 11 (2.1) | `4cdee5f` word boxes through the layout stage, the pinned pages · `689c0e0` the title-word tier · `3aa3805` the ladder's verdict |
| OCR 12 (2.2–2.4) | `350abb9` knobs, helpers, the parameters not adopted · `c830544` the source-aware scale · `9f0fc49` the orientation trial |
| closing | "Batch B and OCR steps 1-2.4: verification and records" — this section, STATE.md, the handoff's program index, `docs/OCR-BENCHMARK.md` ("Baseline and the ladder so far"), `MAINTENANCE.md`, `tests/README.md`, one DECISIONS row |

Verified at HEAD before the closing commit (started 17:40 EDT): `npx tsc --noEmit` clean; `npm test`
1615 pass / 0 fail (1475 at `e34279d`; the two step-9 test files add 5); `npm run build` OK (the
chunk warning that predates the program); `npm run e2e` Chrome 63.9 s "E2E passed" and
`E2E_BROWSER=webkit npm run e2e` 58.5 s "E2E passed", the OCR leg on both reading "Purdue University"
and 2 core-relevant rows from the scan fixture, 1 field fixed by hand, 5 external course lines after
adding (`.e2e-out/external-ocr-preview.png` and `.e2e-out/webkit/external-ocr-preview.png` are the
same 1400 × 1900 frame on both engines: the preview's "Add 2 selected courses" / "Cancel" buttons at
the top edge, then "Your standing" with Fall 2026 read from the transcript and the three not-full-time
semesters, "Coursework" with the six Notre Dame rows, the result cards and "Next steps (10)" on the
right, and the two toasts "Reading the transcript… (it never leaves this browser)" and the
specialization-group note — the OCR table itself sits above the frame, where the driver asserted the
banner, the university and the row count in the DOM).

**Text, before → after the program** (`bench-out/text-baseline-20261009.json`, after Batch A's harness
and before any parser change → `bench-out/text-final-20261009.json`, written at the close; against
`text-batch-a-final.json`: 0 regressions, 22 improvements — Alberta and the ten Minerva record pages,
each on the public and the pdfs board — 21 public and 29 pdfs entries new):

| | before (`e34279d` + harness) | after |
|---|---|---|
| public fixtures (positive + negative) | 127 (95 + 32) | 168 (129 + 39) |
| known-failing | 5 | 21 (21 still failing, 0 now passing) |
| exact (= the test's pass) | 122/127 | 147/168 (87.5 %) |
| row recall / precision | 95.6 % / 100 % | 91.9 % / 99.1 % |
| false rows on negatives | 0 (in 0/32) | 1 (in 1/39, the McGill course outline — the gate question) |
| cells title / credits / grade / term / level | 100 / 100 / 100 / 99.3 / 100 % | 100 / 99.9 / 99.3 / 97.8 / 100 % |
| ms corpus | 48/48, 648/648 | 48/48, 648/648 |
| pdfs board (`public-pdfs/`, `--verify`) | — (20 PDFs at the end of Batch A: exact 7/20) | 49 PDFs, 49 hash ok; exact 47/49; recall 90.6 %; precision 100 %; cells 100 / 100 / 100 / 100 / 100 % |
| `npm test` | 1475 | 1615 |

The recall and term drops are the 41 fixtures added and pinned to the truth (specimens and composed
layouts; 16 of them still on the list with their family); every parser commit only raised the board.

**OCR, before → after the program** (the full ladder, 62 seeds — 26 positives, 36 negatives — 151
pages, 620 rows; before = `bench-out/ocr-step10-before-20261009/`, the step-9 pipeline on today's
parser; after = `ocr-step11-after-20261009/` for L0–L5, which the shipped pipeline reproduces on the
ladder's 150–200-dpi sources, and `ocr-step12-rotation-trial-medium/` for L6; the whole table is in
`docs/OCR-BENCHMARK.md` "Baseline and the ladder so far"):

| level | exact | row acc | rows found | false rows | CER | flag P / R |
|---|---|---|---|---|---|---|
| L0 clean | 34 → 35 /62 | 50.0 → 65.2 % | 87.8 → 89.6 % | 19 → 13 | 40.5 → 29.1 % | 76.9 / 8.3 → 70.0 / 53.2 % |
| L1 good scan | 33 → 34 | 48.9 → 63.7 % | 88.5 → 90.7 % | 24 → 15 | 40.4 → 29.5 % | 61.5 / 6.1 → 72.0 / 61.4 % |
| L2 office scan | 34 → 32 | 46.3 → 54.1 % | 86.7 → 88.1 % | 24 → 16 | 45.5 → 37.2 % | 86.4 / 14.3 → 70.8 / 63.0 % |
| L3 photocopy | 34 → 33 | 45.6 → 41.5 % | 83.7 → 81.9 % | 27 → 19 | 42.6 → 42.2 % | 76.9 / 15.4 → 60.8 / 59.4 % |
| L4 stamped | 32 → 29 | 38.1 → 41.5 % | 85.9 → 86.3 % | 22 → 17 | 42.3 → 32.0 % | 81.8 / 23.8 → 88.1 / 69.6 % |
| L5 phone photo | 34 → 34 | 47.4 → 58.1 % | 87.0 → 89.6 % | 23 → 21 | 42.3 → 35.8 % | 84.2 / 12.3 → 79.5 / 66.0 % |
| L6-90 sideways | 7 → 34 | 0 → 65.2 % | 0 → 90.0 % | 221 → 23 | 90.5 → 29.4 % | — → 69.9 / 56.7 % |
| L6-180 upside down | 15 → 33 | 0 → 64.4 % | 0 → 90.7 % | 54 → 15 | 91.2 → 29.5 % | — → 70.3 / 52.3 % |
| L7 text layer | 30 | 1.1 % | 38.1 % | 100 | 17.3 % | unchanged (never OCR'd) |
| L0 on 300-dpi sources | 36 → 40 | 66.3 → 70.0 % | 89.3 → 92.2 % | 15 → 9 | — | — (`ocr-step12-before-l0-300` → `-shipped-l0-300`, 1.18 × the time) |

At the close: `npm run ocr-bench -- --pinned` (`bench-out/ocr-final-pinned-20261009/`) is identical to
step 12's shipped run — L0 2/3, L1 7/9, L2 6/10, L3 exact, L4 2/5, L5 exact, L6-180 2/3, L6-90 4/5
rows right/expected, L7 0/6 (the text layer), 1.08 s/page. The medium set under the shipped config
(`bench-out/ocr-final-medium-20261009/`, 62 seeds at L2 / L5, against the 11:05 `ocr-baseline-20261009`
as the task asked — a confounded pair, that run predating F4–F6): L2 row accuracy 44.4 → 54.1 %, rows
found 86.7 → 88.1 %, false rows 27 (6/36 negatives) → 16 (7/36), field accuracy 79.8 → 80.9 %, CER
45.6 → 37.2 %, flag P / R 91.3 / 14.9 → 70.8 / 63.0 %; L5 45.2 → 58.1 %, 87.0 → 89.6 %, 26 (4) → 21 (5),
80.7 → 83.8 %, 42.4 → 35.8 %, 90.0 / 12.9 → 79.5 / 66.0 %; `text` 60.0 → 93.0 % row accuracy and 8 → 1
false rows (the parser, not the OCR); 34 regression lines, 49 improvements, 186 rows in 15.4 min. The
shipped config's L2 and L5 boards are identical, row for row, to the step-11 ladder's and to step 12's
`-before-medium` (54.1 % / 58.1 %, false rows 16 / 21), so the same-parser delta is 0 / 0 — the only
moved figure is s/page (3.04 / 2.49 against 2.16 / 1.79), because the two e2e runs shared the machine
with this run. The clean step-10
deltas, left unpasted by step 10 (`--compare ocr-step10-20261009 --baseline ocr-step10-before-20261009`):
L0 false rows 19 → 21; L1 row acc 48.9 → 48.5 %; L2 46.3 → 42.2 %, false rows 24 → 25; L3 45.6 →
49.6 %, false rows 27 → 24; L4 38.1 → 36.3 %; L5 47.4 → 44.4 %; L6-90 false rows 221 → 315; 48
regression lines, 16 improvements — the verdict (not adopted) stands. The full ladder on the shipped
pipeline — the sign-off run — was started detached at the close:
`~/degree-audit-samples/bench-out/ocr-full-20261009/` (log `ocr-full-20261009.log`, ≈ 45 min); read it
with `npm run ocr-bench -- --compare ~/degree-audit-samples/bench-out/ocr-full-20261009 --baseline
~/degree-audit-samples/bench-out/ocr-step11-after-20261009` — expected L0–L5 within the trial's two
junk pages of identical and L6 as the row above; paste its "By level" board into
`docs/OCR-BENCHMARK.md` under "Baseline and the ladder so far" and a line into STATE.md.

Deviations from §2, each in DECISIONS (2026-10-09): step 7's positioned PDFs deferred (Batch B);
step 9's harness committed in two parts (the stopped step's leftovers in the closing commit); step
10 measured and reversed; step 12's "300 dpi" shipped as a source-aware scale, not a flat one; the
full ladder's sign-off read after the close rather than waited for.

Open issues, all steps (the DGS's are marked):

- **DGS:** Batch C — CC15 code-less rows, CC16 side-by-side terms, TH02, the adjacent-line conferral,
  OCR numeric corrections, image strips, scanner-embedded poor text layers (his answers are recorded,
  DECISIONS 2026-10-09 `d3a853d`; nothing lands before his numbered go-ahead).
- **DGS:** the transcript gate — "is this a transcript at all?" (the McGill course-outline page, the
  one false row on the negatives); whether "The City University of New York" is a campus system;
  whether "Trimester GPA" and a calendar sentence are trimester evidence; open question (g)
  (Sabanci's legend-defined P).
- **DGS:** Melbourne (403) and Limerick (404) specimens for his browser; the five public PDFs not on
  disk (UConn, Delaware, Jadavpur, Chulalongkorn — dead links; Rice — changed upstream).
- **DGS:** `docs/wordpress-footer-snippet.html` must be re-pasted into WordPress when the iframes move
  to the renamed Pages address (Batch A).
- Text: the 16 composed and specimen fixtures still on the known-failing list with their families (F2
  Workday / Nepal, F3 McMaster / SNU / UCLA numbers, F1 UCLA's "IN PROGRESS", Ladok's module lines,
  Western's suffix terms, Oregon's glued symbols, the Ukrainian supplement, Algeria CC15, Bangladesh);
  the remark-row case from the F1–F3 review; the pdfs board not applying the known-failing list; the
  `USA` / `US` labels in `sources.json`; the build's chunk warning; step 7's positioned PDFs.
- OCR: plan step 2.5 — the header-mapped cell path's tolerance of OCR noise (Alberta 19 → 3 rows right
  at L2 after step 11; a misread Minerva header cell is what made a flat 300 dpi lose), the title
  cell's leading section number and symbol, junk cells taken for a code on the negatives, the
  insideND one-column table split at L4; the two-pass deskew (keep `rotateAuto`'s reading only when
  the engine's estimate is ≥ 1.5°); steps 2.6–2.7 (term-header repair, an OCR-tolerant `isUnofficial`,
  cell-level flags, the image strip) after the DGS's Batch C answers; `--full` with the synthetic
  renders never run (estimated only); the engine gate (step 14) not started; line CER is
  order-sensitive (a multi-column page read across columns scores high even with every word right).
- The sign-off ladder `ocr-full-20261009/` — its board to be pasted (above).

### Batch C, the text side — done 2026-10-09 (branch `claude/policy-compliance-degree-engine-44a431`)

The DGS's Batch C answers (DECISIONS 2026-10-09, “I will follow your recommendations for all”), the
four that are parser and preview work, one commit each; each verified with `npx tsc --noEmit` and the
full `npm test` on the index tree before it was made (another agent's OCR step-2.5 edits to
`external.ts` were in the working tree and were left out of every commit), the replay against the
previous item's file, and the OCR side as a parser-only A/B — every saved OCR line set
(`ocr-step25-before-20261009`, `ocr-step25-flat300-medium`, written by the OCR agent's runs) re-parsed
with the previous commit's parser and with the item's:

- `418f9d1` item 1, **CC15** — code-less rows imported with an EMPTY, required course-id box: two
  shapes only (a line lining up cell for cell with a header that names a title and no code column;
  Evergreen's credit breakdown that adds up to its program line), none kept in a document that prints
  a course number on any row; the preview's row starts unticked, its id box required, its tick box
  disabled until an id is typed (W-CL407–W-CL410); `''` never reaches `canonicalCourseId`, the saved
  record, the review request or the duplicate check. Cairo's “Full Mark” column and banded “Pass
  60-64%” read from the transcript's own evidence; a raw printed result is no longer “still in
  progress”. The scorer pairs code-less rows by title.
- `33e037f` item 2, **CC16** — side-by-side semesters split at the header's second group; each half
  under its column's semester; a one-group line's term left blank.
- `300eb52` item 3, **TH02** — `COUNTRY_CALENDARS` beside `readTermLine`, Thailand first, with its
  source; the country only from a header cell; only numbered semesters; never where a term prints its
  months.
- `3f9a7f3` item 4 — the **adjacent-line graduate conferral**, both labels required.
- the records commit “Batch C text side: records” — this section, STATE.md, the handoff's bullet.

Numbers — before is `bench-out/text-final-20261009.json` (the end of Batch B), after is
`bench-out/text-batch-c-final.json`; per item `text-batch-c-cc15.json`, `-cc16.json` (rewritten from the
item-2 commit), `-th02.json`. 0 regressions at every step; false rows on the negatives unchanged.

| | before | CC15 | CC16 | TH02 | adjacent conferral |
|---|---|---|---|---|---|
| public exact | 147/168 | 151 | 151 | 151 | 152/168 (90.5 %) |
| known-failing | 21 | 17 | 17 | 17 | 16 |
| public row recall / precision | 91.9 / 99.1 % | 94.8 / 99.1 % | 95.8 / 99.1 % | 95.8 / 99.1 % | 95.8 / 99.1 % |
| public term cells | 97.8 % | 97.7 % | 97.1 % | 97.5 % | 97.5 % |
| false rows on negatives | 1 (in 1/39) | 1 | 1 | 1 | 1 (the McGill course outline) |
| pdfs exact / recall | 47/49, 90.6 % | 48/49, 100 % | unchanged | unchanged | 48/49, 100 % |
| ms corpus | 48/48, 648/648 | unchanged | unchanged | unchanged | unchanged |
| OCR re-parse, documents changed | — | 0 of 177 + 44 | 0 of 196 + 78 | 0 of 205 + 97 | 0 of 223 + 120 |
| `npm test` (index tree) | 1615 | 1677 | 1681 | 1685 | 1687 |

(The term-cell dip at CC16 is the sjtu template's rows found with blank terms: its single-year
“Academic Year” needs a country calendar the template gives no country for.) On OCR lines the Evergreen
seed of the flat-300 medium run reads its 19 code-less rows exactly at L2 and L5.

Deviations, each in DECISIONS (2026-10-09): cairo's expectation lost its bachelor's date (19 lines from
the degree name — no rule reaches it, the adjacent-line rule included) and nankai's gained the graduate
level its heading gives; sjtu's six one-group rows expect a blank term; `undergraduateInProgress` reads a
printed raw result as final (otherwise the bachelor's statements CC15 was decided for were refused); the
e2e was not run (the task excluded it — the preview's code-less row is UI-visible and needs the e2e on
both engines from the agent told to run it).

Open issues (the DGS's are marked):

- **DGS:** may a city in the university's name stand for the country (SJTU's template prints
  “SHANGHAI JIAOTONG UNIVERSITY” and no country)? With China in the calendar table (first semester = the
  fall), sjtu-lifelong-template's fourteen two-group rows and its 2003 table would read their terms.
- **DGS:** a Thai “Summer Session 2022” keeps its printed year (academic year 2022's summer falls in
  2023); Buddhist-era years (“2565”) are not read. Answered 2026-11-03 (question 6 (b), (c): the summer moves to
  2023 — `calendarSummer`; Buddhist-era years are converted on a document whose heading names Thailand —
  `inCommonEra`). The SJTU question above was answered “No” on 2026-10-10.
- Coded side-by-side tables (a course number in each half) are not split — no specimen.
- The e2e on Chrome and WebKit for the code-less preview row (`ext.row.N.id` empty and required, the
  tick box disabled, W-CL409 above the table) — a driver step and screenshots.
- Batch C's OCR answers (numeric corrections beside the raw reading, the scanned-line image strip,
  scanner-embedded text layers as OCR-grade) belong to the OCR steps 2.5–2.7.

### Engine gate (step 14) — done 2026-10-09 (branch `claude/policy-compliance-degree-engine-44a431`): measured offline, not adopted

PaddleOCR PP-OCRv6_tiny, the §4.1 candidate, against the shipped Tesseract — offline only, in
`scripts/dev/ocr-bench/engine-gate/` (its own `package.json`, git-ignored `node_modules/`; `fetch-models.mjs`
puts the official Apache-2.0 ONNX models, pinned by revision and SHA-256, in
`~/degree-audit-samples/engine-gate-models/`; `gate.mjs` the runner; `calibrate.mjs` the one height
calibration). The runner reads the sign-off run's own page renders, runs the engine on onnxruntime-web
(WebAssembly, one thread — the browser's mode) and feeds the app's `ocrPageLayout`, `layout.ts`, the parser and
the bench's scorer, with Tesseract re-reading every page beside it; `src/` and the root `package.json` are
untouched. Full method and boards: `docs/OCR-BENCHMARK.md` "Engine gate"; the DECISIONS row of this date.

| level (62 seeds, 270 rows) | Tesseract row acc | PP-OCRv6_tiny | Δ | time × | false rows |
|---|---|---|---|---|---|
| L2 | 54.1 % | 68.9 % | +14.8 | 1.06 | 16 → 7 |
| L3 | 41.5 % | 47.8 % | +6.3 | 1.10 | 19 → 7 |
| L4 | 41.5 % | 38.9 % | −2.6 | 1.39 | 17 → 8 |
| L5 | 58.1 % | 70.4 % | +12.2 | 1.32 | 21 → 6 |
| **L2–L5** | 48.8 % | 56.5 % | **+7.7** (gate: ≥ +10) | 1.20 (per transcript, median 2.30) | 73 → 28 |
| L2–L5 on `81b038d` (Batch C + step 2.5 (a)(b)(d)) | 55.2 % | 60.5 % | +5.3 | 1.23 | 65 → 33 |
| L6-90 / L6-180 (not gated) | 65.2 / 64.4 % | 80.4 / 80.7 % | +15.2 / +16.3 | 1.13 / 1.14 | 23 → 8 / 15 → 6 |

Verdict: not adopted — the accuracy half fails (+7.7 pooled; +5.3 on today's parser); the time half passes on
the bench's pooled figure only. Its flag recall falls 64.6 → 21.4 % and its term cells 99.3 → 95.5 %. Runs:
`~/degree-audit-samples/bench-out/engine-gate-20261009/` (`medium/`, `L3/`, `L4/`, `L6-90/`, `L6-180/`,
`head-81b038d-L2/` … `-L5/`, `trial-calibration-L1/`). Not run: `npm run e2e` (the task's verification is
`npx tsc --noEmit` and `npm test`; nothing the browser loads changed).

Open issues:
- **DGS (only if an engine is ever proposed again):** the 7.5 MB `public/ocr/` cap — PP-OCRv6_tiny on
  onnxruntime-web is ≈ 20.7 MB.
- The layout stage splits the insideND one-column table into two columns at its "Credit Hours" gutter under
  Paddle's boxes at L2 and L5 (Tesseract's at L4) — plan step 2.5's ground, measurable with either engine.
- A future engine needs a confidence rule of its own before the ⚠ flag can trust it (Paddle's probabilities
  stay high on wrong rows).

### OCR step 2.5 — done 2026-10-09 (branch `claude/policy-compliance-degree-engine-44a431`): the parser on a scan's noise

Commits: `a120c2b` the bench's `--reparse` (every run saves the lines the parser read; a parser-only A/B
re-scores them without the engine) · `5620628` (a) header noise · `ce56a71` (d) Minerva's multi-term mark as
a scan reads it · `81b038d` (b) the junk-code guard · `bc36cde` (c) the flat 300 re-tested, not adopted · the records commit. Each rule runs ONLY on
OCR lines (`parseExternalTranscript` given confidences); the text replay against HEAD's own
(`bench-out/text-step25-head-5acf871.json`) was 0 / 0 after every commit. The tables and the lines used are in
`docs/OCR-BENCHMARK.md` "Plan step 2.5"; the reasons in four DECISIONS rows of this date.

- **(a)** `src/transcript/external.ts`: the scan's noise marks (`OCR_HEADER_NOISE_RE`) are no part of a
  header cell; a header cell no pattern names has each word of four letters or more repaired to the
  header word one letter away (`ocrRepairHeaderCell`, `OCR_HEADER_WORDS` — 61 words, each a header cell
  on its own), only on a line already ≥ 60 % named exactly (two-line headers: 60 % of the joined pairs);
  a two-line header's run-together lower line is split back into its words (`joinedHeaderKinds` →
  `joinAt`). Pinned: `tests/ocr-header-noise.test.ts` (7).
- **(d)** `dropSection`: a first token of one to three characters with no letter and at most one digit
  ("<>", "<~", "2") is Minerva's mark when the zero-padded section and a wordy title follow. Pinned:
  `tests/ocr-row-noise.test.ts` (2).
- **(b)** `ocrJunkCode`, on lines under `OCR_CONFIDENCE_FLOOR`: an all-lower-case subject with a letter
  whose capital differs, a decimal number taken for a code (`leadCode`'s new `decimalCell`), a title with
  no word of four letters. Two stricter forms cost real rows on rendered layouts and were not adopted.
  Pinned: `tests/ocr-row-noise.test.ts` (3).

Numbers — the medium set (62 seeds, 151 pages, L2 / L5) at the shipped scale, the same lines read by
HEAD `5acf871`'s parser and by the three rules: L2 row accuracy 58.1 → 63.0 %, rows found 92.2 → 92.6 %,
false rows 16 (7/36 negatives) → 13 (6/36), field accuracy 81.8 → 83.8 %; L5 62.2 → 67.0 %, 93.7 → 94.1 %,
21 (5/36) → 14 (4/36), 84.5 → 86.8 %; 0 regression lines (Alberta 3 → 11 and 9 → 16 rows right of 24,
Minerva's multi-term page 2 → 7 and 1 → 7 of 8, Stanford's key L5 3 → 0 false rows, Duke's 5 → 3 and
10 → 7, Western Ontario's L2 1 → 0). On the whole ladder (L0–L6, the shipped-scale lines, `bench-out/ocr-step25-lines-auto/`) every level gains with no row lost: row accuracy 72.2 → 74.8 / 70.7 → 73.3 / 58.1 → 63.0 / 43.3 → 44.1 / 44.8 → 46.7 / 62.2 → 67.0 % at L0–L5, 72.2 → 74.8 / 71.5 → 74.1 % at L6-90 / L6-180; false rows 13 → 11 / 15 → 11 / 16 → 13 / 19 → 15 / 27 → 23 / 21 → 14, 23 → 13 / 15 → 12; 0 regression lines, 33 improvements. `--quick`: false rows L0 2 → 1, L5 4 → 1, rows
unchanged; `--pinned` 0 / 0 after each rule; ten numeric-code / capitalised-subject layouts rendered and
scanned (synthetic, L2 / L5) 0 / 0. Verified: `npx tsc --noEmit`, `npm test` 1699 pass; e2e not run
(not this agent's — no student-facing string changed; the OCR leg should be run on Chrome and WebKit
before the DGS ships this). No wording entries: the step adds no student-facing string.

**(c) not adopted** (`bc36cde`): the flat 300-dpi render re-tested on the new parser, same parser both sides
(`ocr-step25-flat300-medium` + `-flat300-rest` against `ocr-step25-lines-auto`). The medium set gains — L2 row
accuracy 63.0 → 67.0 %, rows found 92.6 → 96.7 %, false rows 13 → 13; L5 67.0 → 69.6 %, 94.1 → 96.7 %, 14 → 9 —
but almost all of it is Evergreen (19 rows at 300 against 11 at 216: one breakdown line is missing at 216 and the
program's sum refuses all eight); without it, +3 rows right at L2 and −1 at L5; and new false rows appear on four
keys and the Banner pair. On the other levels: L0 74.8 → 77.0 %, L1 73.3 → 76.3 %, but L3 (the photocopy) 44.1 →
7.8 % with false rows 15 → 28 at 3.3 → 10.4 s/page, and L4 46.7 → 39.6 %. `OCR_BASE_DPI` stays 216.

Open issues from this step:

- Alberta's first table: "Avy" (Avg) is a three-letter misread, never repaired by rule (one letter from
  "Any" and "Ave" too) — the table stays unmapped.
- Alberta's page 2: the LAYOUT stage drops "Points" from three of the four lower header lines on the
  scan (the engine reads the word at confidence 84–95; `dropWatermarks` takes the repeated word for a tile
  on the skewed word boxes), so those tables stay unmapped — a `layout.ts` change for the OCR path, to be
  measured on the ladder and the text replay.
- Duke's grade key still reads "SP 40 / HP 35 / LP 25" rows (the engine drops the point of "4.0"); its false
  rows remain the largest on the negatives.
- A misread digit inside a cell ("3:0", "3.0:", "38" for "3.8") is Batch C's answer (4) — the numeric
  correction shown beside the raw reading (plan step 2.6).
- Rule (b) refuses a real course titled only with short words ("Lab for CS 2000", 2 of 2,457 fixture
  rows) on a low-confidence scan line.

### Batch C, the OCR side — done 2026-10-10 (branch `claude/policy-compliance-degree-engine-44a431`): the DGS's answers (4)–(6)

Commits: `21c56f9` (4) OCR numeric corrections · `e001129` (5) the scanned line beside a row · `2560c53` (6)
scanner text layers read OCR-grade · the records commit. One DECISIONS row per item (2026-10-09); wording
W-CL411–W-CL420; `docs/OCR-BENCHMARK.md` "Batch C, the OCR side". The e2e was not run (another agent's): the
OCR leg on Chrome and WebKit should look at items (4) and (5) before this ships, and no e2e fixture is a
scanner-layer PDF yet (item (6)).

| item | what | where | measured |
|---|---|---|---|
| (4) | On OCR lines only, `ocrCellCorrection` rewrites a number with ≥ 1 real digit and ≥ 1 O/o/l/I/\| ("3.O" → 3.0, "8O" → 80) and a grade "At/Bt/Ct/Dt" (→ A+ … D+); `ocrCorrectedScan` keeps the corrected reading only where it FILLS credits or a grade the scan left empty, every other value and every title word as read (a corrected token a raw reading took into the title may leave it). The row is flagged and carries `ocrRead`; the preview prints "scan shows “3.O”" under the box (W-CL411/412). Never: S/B/Z/G, a colon for a point, a code, a title, a name, the university. | `src/transcript/external.ts` (`ocrCellCorrection`, `scanLead`, `ocrCorrectedScan`, `readMappedValues` now records `gradeText`), `src/ui/external-upload.ts` (`ocrRawNote`, `ocrRawTitle`), `tests/ocr-numeric-correction.test.ts` (12) | `--reparse` of the whole ladder L0–L6, the medium set and `--quick`: every level unchanged, 0 / 0; `--pinned` 0 / 0; text replay 0 / 0 against HEAD's own. The engine never printed the shape in a course row of the 62 seeds; it acts on scanner layers (L7). |
| (5) | Every OCR line carries its pixel box (`OcrLine.box`, its words' union) and page; every OCR row its `sourceLines`; `stripRegion` crops them, padded, from a copy of the page kept at ≤ 1,700 px (the engine's canvas and every trial reading are emptied once read). Flagged rows show the strip at once, the others behind "show the scanned line" (W-CL413–415). The copies and regions live in `src/ui/scan-strips.ts`'s Map keyed by the preview's rows — never on a row — and are emptied when the preview closes; the Add builds each course field by field (`courseEntryOf`). | `src/transcript/ocr-lines.ts`, `ocr.ts`, `scan-strip.ts`, `src/ui/scan-strips.ts`, `external-upload.ts`, `src/style.css`; `tests/scan-strip.test.ts` (9) — after Add, the record, `saveLocal`'s copy and `exportFile`'s JSON hold no image, data: URL or OCR field | parser values untouched: `--reparse` of the ladder and the medium set 0 / 0 |
| (6) | A PDF whose EVERY page is a scan (an image over ≥ 90 % of the page, no text visible over it — modes 3/7 after the image, or text under it) with a text layer: its lines are parsed at `SCANNER_LAYER_CONFIDENCE` (0) — every row flagged, the scan-only repairs on — in an OCR preview with its own banner and ⚠ text; OCR is offered beside it ("Try OCR" replaces the preview; "Keep the rows below", Add and Cancel withdraw the offer). A system PDF over a background image keeps the exact path. | `src/transcript/scanner-layer.ts`, `pdf.ts` (`pdfToLinesForImport`), `external-upload.ts` (W-CL416–420), the bench's `--l7`, `scripts/dev/pdf-lines-node.mts` (`pdfScanPagesNode`); `tests/scanner-layer.test.ts` (11) | L7 (62 seeds) exact → OCR-grade: rows found 38.1 → 37.8 %, false rows 100 (6/36) → 94 (5/36), field acc 56.7 → 57.3 %, flag P/R —/0 → 99.0/100 %; one regression line (ANU, a placeholder title garbled to "CLA5S"); detected on 62/62 L7, no generator fixture, 2 public scans (negatives, 0 rows either way) |

Open issues from this batch:

- A colon or a dropped point in a numeric cell ("3:0", "3.0:", "38" for "3.8", Duke's "SP 40") is not a
  letter-for-digit shape and stays raw — the DGS's answer covers letters only; a colon is also IISc's
  lecture:lab pair.
- The correction does not touch a code-less row (CC15) or a two-line row's numbers line, and it never
  REPLACES a value the scan read: under a mapped header a misread grade ("Compilers   3.00   Bt   9.90")
  can push the row's cells one column over, read 9.9 as the credits, and stay that way (flagged by the
  odd-credits check). Each is a measured follow-up.
- The strips were checked in node only (regions, release, the no-save assertion); the browser has not
  drawn one in this batch — the OCR leg of the e2e on both engines is the check, with a look at a phone
  width.
- ANU's L7 placeholder row, refused by the junk-code guard on the scanner's garbled title.
- An e2e leg for a scanner-layer PDF (the generator has none; the committed L7 page is a Notre Dame page,
  which the external import refuses).

### Batch C review fixes — done 2026-10-10 (branch `claude/policy-compliance-degree-engine-44a431`)

One commit, "Transcript accuracy next stage: review fixes": a review of the Batch C commits found five places
where a rule read more than its evidence; each reproduced, fixed, pinned by a test that fails on HEAD `2c3888f`,
and recorded (DECISIONS 2026-10-10, five rows). No student-facing string changed (W-CL411/W-CL412 are true again
as written).

| finding | was | now | pinned |
|---|---|---|---|
| TH02 (`300eb52`) | any header cell naming Thailand — a student's “Nationality   Thailand” or address — put a Korean transcript on Thailand's calendar (SNU: 9 of 10 rows moved) | only the INSTITUTION's heading (`institutionHeading`: the line naming the institution and the two under it, ending at any field line; a mailing block above it never counts) | `tests/public-transcript-rules.test.ts` |
| adjacent conferral (`3f9a7f3`) | an empty “Date of Graduation:” borrowed the next cell — another label's date, or “Withdrawn 2023-06-30” — and set `degreeConferred` | the next cell only when it is no label; the value a date and nothing else (`bareDate`) | same file |
| numeric correction (`21c56f9`) | a bar read as 1 (“3\|” → 31 credits); “Calculus I1” → 11 credits, title “Calculus” | no bar, no whole number of strokes, no whole number led by a letter; only a decimal or a grade leaves a title | `tests/ocr-numeric-correction.test.ts` |
| scanner layer + junk guard (`2560c53`, `81b038d`) | at confidence 0 every row went through the guard: short titles, lower-case subjects, decimal codes dropped (SNU 10 of 10) | `{ scannerLayer: true }` — the guard reads only our engine's poor lines | `tests/scanner-layer.test.ts` |
| in-progress gate (`418f9d1`) | any raw grade counted as final — REG, CUR, PEND, NR, I … let an unfinished bachelor's through | only a mark or a band word | `tests/in-progress.test.ts` |

Numbers — text replay vs `text-final-20261009.json`: 0 regressions (public exact 152/168, recall 95.8 %, precision
99.1 %, false rows on negatives 1 in 1/39; pdfs 48/49, 1 in 1/34; ms 48/48), vs HEAD's own
(`text-review-fix-head.json`) 0 / 0. OCR, the same lines read by HEAD's parser and the fix (`--reparse`,
`bench-out/review-fix-before-*` → `-after-*`): `--quick`, the medium set (L2 63.0 % / L5 67.0 % row accuracy,
false rows 13 / 14) and the ladder L0–L6 unchanged, 0 / 0; `--pinned` 0 / 0; the medium set against
`ocr-full-20261009` 0 regressions, 11 improvements (step 2.5's, unchanged). L7: rows found 37.8 → 38.1 %, false
rows 94 (5/36) → 100 (6/36) = the exact path's figure, three regression lines (ANU's recovered “CLA5S” row and
4 garbled extras, McGill's key 0 → 1, Minerva's transfer page 2 → 3), each a row the guard had dropped, each
flagged. Every saved OCR line set under bench-out (1,752 files) re-parsed by both parsers: 3 documents changed,
the three L7 lines. The 216 line fixtures read as a scanner layer: rows the text path reads and the layer loses,
12 → 0. `npx tsc --noEmit`, `npm test` 1738 pass. Not run: the e2e (not this agent's — no student-facing string
changed; the scanner-layer preview has no e2e fixture yet).

Open issues:

- ~~**DGS:** the L7 trade~~ — closed 2026-10-10, DGS “(a)”: kept as built (every row of a scanner's layer shown
  ticked and flagged; 94 → 100 accepted). See “The DGS's answers to the stage report” below.
- TH02's heading test reads English institution words only (University / Institute / Polytechnic / College): a
  Thai heading printed only in Thai script, or a name with none of those words, falls back to the calendar-order
  rule.
- `dateOnLine` does not read “February 26th, 2024” (an ordinal ending), so that graduation date is no conferral
  under the adjacent-line rule — pre-existing, now a test note.

### Next stage — verification and records — done 2026-10-10 (branch `claude/policy-compliance-degree-engine-44a431`)

One commit, "Transcript accuracy next stage: verification and records", closing the stage that ran on
2026-10-09/10: Batch C's text side (`418f9d1` `33e037f` `300eb52` `3f9a7f3` `5acf871`), the engine gate
(`cbbae3e`), OCR step 2.5 (`a120c2b` `5620628` `ce56a71` `81b038d` `bc36cde` `4288662`), Batch C's OCR side
(`21c56f9` `e001129` `2560c53` `2c3888f`) and the review fixes (`5b8b521`). Nothing in `src/` changed in this
commit: it adds the two e2e legs those batches asked for, a fixture for one of them, and the records.
`origin/main` was fetched and merged first (already up to date).

**The e2e legs** (`scripts/e2e/drive-transcript.mjs`, run on Chrome and WebKit):

- **The scanned-line strip** (Batch C answer (5)), in the existing OCR leg (`external-transcript-scan.pdf`, the
  Bachelor's row): the preview carries the hidden “Scanned line” column header; every ⚠ row shows its strip
  at once as a drawn canvas (both rows of this scan are flagged on both engines: canvases 815 × 40 and
  829 × 40 px, shown 780 × 40 at 1400 px, 851 and 886 dark pixels, named “The scanned line this row was read
  from”); an unflagged row would have to show the “show the scanned line” toggle and no canvas. At 390 px the
  page does not scroll sideways (the strip is 489 × 26 px from x = 49 and scrolls inside its own box). After
  Add no strip is left on the page, and the saved record holds no `data:image`, `ocrRead`, `sourceLines` or
  `lowConfidence`. Crops: `external-ocr-strip.png`, `phone-external-ocr-strip.png` (the window's floating
  panels are held out of that crop — WebKit's element shot paints them over a 1900-px-tall phone frame).
- **CC15, a code-less transcript** (new fixture `tests/fixtures/codeless-transcript.pdf` from
  `make-transcript-pdfs.mjs`: an invented “Example Normal University” record, a title column and no code
  column, cells positioned like the insideND fixture's; not a bench seed — the bench's generator list is
  explicit), in the Master's row of a fresh record: three rows, each with an EMPTY id box that is required,
  `aria-invalid`, placeholder “course number”, its tick box unticked and disabled; W-CL409 above the table;
  “Add 0 selected courses”; Add refused out loud (“No rows are complete yet …”) with nothing added; typing
  “CS 60100” into the first box ticks that row only (“Add 1 selected course”); Add files exactly CS 60100 under
  the university and the saved record holds no empty id. Crops: `codeless-preview.png`,
  `codeless-preview-filled.png`.

**Numbers** (all at HEAD `5b8b521` + this commit's driver and fixture; times from `date`, 00:39–01:08 EDT):

| check | result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npm test` | 1738 pass / 0 fail |
| `npm run build` | OK (the chunk warning that predates the program) |
| text replay vs `text-final-20261009.json` → `bench-out/text-final-20261010.json` | 0 regressions, 7 improvements (cairo, chesicc, chulalongkorn, nankai, Evergreen on both boards, sjtu's rows) |
| public board | exact 147 → 152/168 (90.5 %); known-failing 21 → 16 (16 still failing, 0 now passing); recall 91.9 → 95.8 % (1733/1809); precision 99.1 % (1733/1748); false rows on negatives 1 (in 1/39, the McGill course outline) unchanged; cells title 100 / credits 99.9 / grade 99.3 → 99.4 / term 97.8 → 97.5 / level 100 % |
| ms / pdfs boards | ms 48/48, 648/648 unchanged; pdfs exact 47 → 48/49, recall 90.6 → 100 % (203/203), precision 100 %, false rows 1 (in 1/34) unchanged |
| OCR `--pinned` (`bench-out/final-20261010-pinned/` vs `review-fix-after-pinned/`) | 0 / 0: L0 2/3, L1 7/9, L2 6/10, L3 exact, L4 2/5, L5 exact, L6-180 2/3, L6-90 4/5, L7 0/6 rows right/expected; 1.08 s/page |
| OCR medium set, a fresh engine run (`bench-out/final-20261010-medium/` vs the sign-off run `ocr-full-20261009/`) | 0 regressions, 11 improvements (step 2.5's: Alberta, Minerva's multi-term page, Stanford's / Duke's / Western's keys; Evergreen at text / L2 / L5). L2 row acc 54.1 → 63.0 %, rows found 88.1 → 92.6 %, false rows 16 (7/36) → 13 (6/36), field acc 80.9 → 83.8 %, flag P/R 70.8 / 63.0 → 61.3 / 61.3 %; L5 58.1 → 67.0 %, 89.6 → 94.1 %, 21 (5/36) → 14 (4/36), 83.8 → 86.8 %, 79.5 / 66.0 → 66.7 / 59.8 %; `text` row acc 93.0 → 100 %. 186 rows, 15.3 min, 2.76 s/page. Against the review fixes' re-parse of the same lines (`review-fix-after-medium/`): identical boards (s/page only, 3.24 → 3.03 and 2.65 → 2.48) — a fresh engine run reproduces the `--reparse` |
| `npm run e2e` (Chrome) | “E2E passed”, 72.2 s, four drivers |
| `E2E_BROWSER=webkit npm run e2e` | “E2E passed”, 74.9 s, four drivers; the same figures as Chrome in both new legs |

**What the OCR preview screenshots show** (both engines alike): the Bachelor's-row preview under its
“Read by OCR from a scan — approximate. English transcripts only.” banner and the undergraduate note (“1 other
course was read and left out”); “Purdue University” in the University box; two ⚠ rows, each with its strip — a
grey band with the scanned line in the scan's monospace (“CS 50300   Operating Systems   3.0   A”, “CS 58000
Algorithm Design   3.0   B+”) across the row's full width under its fields. Row 1 reads 3 / A / Fall 2023; row 2
reads its title as “Algorithm Design B.D” with the credits box EMPTY, and the strip under it shows the “3.0” the
engine misread — the case the strip exists for. At 390 px each row stacks its fields and the strip shows the
line's left part (“CS 50300   Operating Systems”); the credits and grade end of the line sits off to the right
inside the strip's own scroll box. The full frame (`external-ocr-preview.png`) has the preview at the top, then
Your standing, Coursework and the result cards, with Next steps and the warnings floating bottom-right. The
code-less crops show the three rows with red-bordered empty “course number” boxes, greyed tick boxes and
“Add 0 selected courses”; after the id is typed, the first row ticked with “CS 60100” and “Add 1 selected
course”, and the refused-Add message still at the top (it stays until the next Add).

Open issues from this verification (the DGS's are marked):

- **DGS:** at phone width the strip shows only the left ~60 % of the line (the recorded “never below 60 % of its
  own pixels” rule, Batch C (5)): the credits and grade a flagged row most often needs are behind a sideways
  swipe inside the strip, on both engines. Options: fit the whole line to the card at phone widths (glyphs at
  about a third of their pixels), or keep the rule and show a visible scroll cue. Not changed here.
- The unflagged row's “show the scanned line” toggle has no e2e coverage: both rows of the scan fixture are
  flagged on both engines (the toggle is pinned in node by `tests/scan-strip.test.ts` only).
- The scanner-layer preview (Batch C (6)) still has no e2e fixture: the generator makes no image page with an
  invisible text layer of an EXTERNAL transcript (the committed L7 page is a Notre Dame one, which the
  external import refuses).
- OCR flag precision / recall at the medium set fell between the sign-off run and step 2.5 (L2 70.8 / 63.0 →
  61.3 / 61.3 %, L5 79.5 / 66.0 → 66.7 / 59.8 %: `ocr-step25-auto-medium` already 65.6 / 62.4 and 76.5 / 65.0,
  `step26-before-medium` the present figures) and has not moved since. Rows found and false rows improved, so
  the bench calls it no regression; the figures fit the step-2.5 guard removing rows that were flagged wrong
  rows, but that is not checked row by row — a follow-up.
- The OCR leg's second row: the engine read “3.0” as “B.D” into the title (no digit, so the numeric correction
  rightly does not apply); the student types the credits, as before this stage.
- Pre-existing, seen in the crops: the “Credit system on this transcript” select shows “Semest” (also in the
  combined preview); a full-size text-layer row prints its term as “FA23” under TERM with an empty YEAR column —
  code-less rows are always full-size, so they show it every time.
- Carried, unchanged: question (g), Thai
  summers and Buddhist-era years (DGS; all three answered 2026-11-03); Melbourne / Limerick and the five public PDFs not
  on disk (DGS); the WordPress footer snippet (DGS); a sanitized Workday sample (DGS, later); the 16
  known-failing text fixtures; Alberta's “Avy” and dropped “Points”; Duke's key; colon / dropped-point numerics;
  rule (b) on short-word titles; TH02's English-only heading words; `dateOnLine` and ordinal dates.

### The DGS's answers to the stage report (2026-10-10)

1. “yes, shrink” — the scanned-line strip shrinks to fit the row at any width (`328b1ac`; `src/ui/scan-strips.ts`,
   `src/style.css`; the e2e asserts no sideways scroll at 390 px on both engines).
2. “(a)” — the L7 trade is kept: a scanner's own text layer skips the junk-code guard, every row shown ticked and
   flagged; L7 false rows 94 → 100 accepted, real rows never dropped. No code change.
3. “No” — a city in a university's name does not stand for its country; SJTU stays known-failing (`328b1ac`).
4. “4a (a), 4b (a), 4c (a)” — (a) the transcript gate as proposed: one row, no university, no GPA or totals on a
   text layer → nothing imported, W-CL421 (`notATranscript`); (b) CUNY is a campus system, its 26 colleges, the
   first-named college in its header wins and a transfer-credit line names none; (c) “Trimester GPA: 3.47” is trimester
   evidence and “Quarter GPA” quarter evidence, a key's sentence neither. Text replay 0 regressions, public exact
   151 → 154/168, false rows on negatives 1 → 0, pdfs 49/49; OCR `--reparse` (L0–L7, the medium set) unchanged.
