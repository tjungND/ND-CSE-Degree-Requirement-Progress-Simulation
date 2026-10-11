# OCR benchmark — method, seeds, baseline (2026-10-09)

The opt-in OCR path (`src/transcript/ocr.ts`: a scanned external transcript's PDF rendered by pdfjs,
read by the bundled Tesseract in `public/ocr/`, then `parseExternalTranscript`) had no accuracy
number before this bench (plan `docs/TRANSCRIPT-ACCURACY-PLAN.md` §2 step 9; the path then rendered
at a fixed scale 3.0 and fed the engine's own lines, whitespace collapsed — since steps 11 and 12 it
renders at the scan's own resolution and reads the engine's word boxes through the layout stage).
This file is the method, the seed sections, the baseline and the ladder so far, every measured
change with its verdict, and how to run it — written so the next maintainer can repeat a run, add
a seed, or judge an OCR change by its numbers rather than by one lucky scan.

Everything lives in `scripts/dev/ocr-bench/` and is dev-only: `npm run ocr-bench` never runs in
`npm test`, needs Python 3 with Pillow and numpy (the same two the scan sanitizer needs), and writes
only under `~/degree-audit-samples/bench-out/` (`$TRANSCRIPT_SAMPLES`), never under the repo.

## Method

1. **Seeds** (`seeds.mts`): a clean document plus its ground truth (below).
2. **Clean pages**: each seed is rendered once at 300 dpi (`scripts/dev/pdf-lines-node.mts`
   `pdfToPagePngs`, pdfjs + @napi-rs/canvas — the same renderer the app's OCR path uses, in node), or
   taken from `render-lines.py` for a line-list fixture. The app reads at most ten pages
   (`MAX_PAGES`), so the ladder stops there; the truth keeps every page and what the app never reads
   counts against it.
3. **The ladder** (`degrade.py`, Pillow + numpy, seeded — every drawn value is in the run's
   `manifest.json`):

   | level | what | dpi | file |
   |---|---|---|---|
   | L0 | clean raster | `--dpi` (200 in the baseline) | PNG |
   | L1 | good scan: Gaussian blur σ 0.6, JPEG q75 | 200 | JPEG |
   | L2 | office scan: skew ±0.5–1.5°, Gaussian noise σ 6, a lighting gradient, JPEG q60 | 150 | JPEG |
   | L3 | photocopy: skew 2–3°, a hard tone curve, salt-and-pepper 0.2 %, thin white streaks, a dark border band | 200 | PNG |
   | L4 | stamped: L1 + a DRAWN red seal (rings, star, invented text on a circle; alpha 0.5–0.7) over the table and a diagonal watermark (UNOFFICIAL or the university's name, alpha 0.15) | 200 | JPEG q75 |
   | L5 | phone photo: perspective (1–3 % corner offsets), shadow gradient and vignette, 1200–1600 px wide, JPEG q50 | ≈ width/8.5 | JPEG |
   | L6-90, L6-180 | L1 turned 90° and 180° | 200 | JPEG |
   | L7 | scanner text layer: the L2 image wrapped with a deliberately poor invisible text layer (the truth lines with seeded OCR-style confusions, some column gaps collapsed) | 150 | PDF only |

   Every level is re-wrapped as an image-only PDF by the bench's own writer (lossless FlateDecode for
   PNG levels, the level's own JPEG bytes for JPEG levels — Pillow's PDF writer would re-encode every
   page as JPEG q75), so the app's real path runs on it. L7 is the one level the app does not OCR on
   its own: a PDF with a text layer takes the text path (`hasTextLayer`). Until Batch C answer (6)
   (2026-10-09) that was the exact path — rows locked, no flags; since then a PDF whose EVERY page is
   a scan (one image over the page, no text visible over it — `src/transcript/scanner-layer.ts`) has
   its text read OCR-grade (each line at `SCANNER_LAYER_CONFIDENCE`: every row flagged, the scan-only
   repairs on) and OCR offered beside the preview. The bench reads L7 with `pdfToLinesNode` and the
   same test (`pdfScanPagesNode`) exactly as the app would; `--l7 exact` reads it as before the
   change, `--l7 flag-only` as the exact parse with every row flagged (the alternative measured).
4. **The engine** (`ocr-run.mjs`, grown from `scripts/dev/ocr-lines.mjs`): the same tesseract.js,
   core and English model as the app (`public/ocr/`, `cacheMethod: 'none'`), on the level's PDF
   rendered as the app renders it — since OCR step 12 at the scan's own resolution between 216 and
   300 dpi per page (`ocrRenderScale`; `--scale auto`), before it at a fixed 72 × 3.0 = 216 dpi
   (`--scale 3`). With no knob set it reproduces `ocr.ts` line for line (the header comment names
   each line) — that is the `baseline` config, and the orientation trial of step 12 is part of it.
   Knobs for the plan's experiments: `--scale`, `--psm`, `--dpi` (`user_defined_dpi`),
   `--interword` (preserve the spaces AND stop collapsing them), `--engine-lines`,
   `--line-confidence`, `--threshold`, `--invert`, `--rotate-auto`, `--border`,
   `--rotation-trial` / `--trial-always`, `--binary-dir` (the engine's own binarised page — proof
   that a thresholding parameter reached it), `--words`, `--max-pages`, or a `--config file.json`
   whose base name labels the results' `config` column. `results.json` keeps each page's render
   dpi, scan dpi, mean word confidence, rotation and trial figures (`pageFigures`).
5. **Parse and score** (`score.mts` here, over `scripts/dev/score.mts` — the replay's one scorer, so
   an OCR'd page and a text page are judged alike): the seed's parser (external, or the ND parser
   for ND generator PDFs) on the OCR lines and confidences; then per (seed, level, dpi, config):
   - `exact` — the corpus test's own pass criterion;
   - **row accuracy** = matched rows whose five cells (title, credits, grade, term, level) all
     agree / expected rows; **rows found** = matched / expected (the replay's recall);
     **precision** = matched / parsed;
   - **false rows** = rows read from a negative (a key, legend, form) + unmatched rows on a positive;
   - **field accuracy** = right cells / cells over the matched rows (pooled, and per field);
   - **line CER** = Levenshtein distance between the OCR line stream and the truth line stream,
     page by page (both whitespace-collapsed, empty lines dropped), / truth characters;
   - **flag precision / recall** = of the rows the parser flagged `lowConfidence`, how many were
     actually wrong / of the rows actually wrong, how many were flagged;
   - **s/page** = the engine's recognize time per page read (rendering excluded; node on an
     M-series Mac — the browser is slower).
   A `text` row per seed — the exact path on the source document — is the parser's own ceiling: an
   OCR level cannot beat it, and a known-failing public PDF is inexact there already.
6. **Boards** (`bench.mjs`): by level over the real seeds (generator + public PDFs), by family ×
   level, synthetic renders on their own board, private seeds as one aggregate line per level;
   `results.csv` has every row, `results.json` feeds `--baseline`, which prints per-level deltas
   and per-(seed, level) regressions first (exit 1 on any).

## Seeds

### Synthetic (generator PDFs and the scan fixture)

`tests/fixtures/*.pdf` from `make-transcript-pdfs.mjs` — five Notre Dame transcripts (read by the ND
parser; the expectation is the rows plus "is this Notre Dame"), seven external ones (the Banner
two-column pair among them), and `external-transcript-scan.pdf` (image-only, from
`make-scan-fixture.py`; its truth lines are the script's own text). Ground truth = the exact path's
reading of the same PDF, so L0 must reproduce it; `other-transcript` and `no-lines-transcript` read
no rows and are negatives. All identities are placeholders (Jane Q. Student, John Q. Boilermaker).

### Public registrar PDFs

Every `pdf` entry of `tests/fixtures/public-transcripts/sources.json` (54 on 2026-10-09: 15
positives, 39 negatives — keys, legends, forms and regulations, which measure false rows under
noise), kept outside the repo in `~/degree-audit-samples/public-pdfs/<name>.pdf`. A missing file is
rebuilt with `--fetch` from the entry's URL and kept only when its SHA-256 and byte size match the
pinned ones; a dead link or a changed file is logged and skipped — on 2026-10-09, UConn, Delaware,
Jadavpur and Chulalongkorn's regulations did not answer and Rice's key had changed upstream (not
kept), so 49 seed the bench. Rows come from `expected.json`; the known-failing list's entries are
marked † in the per-seed table (their `text` row is inexact by the parser's own doing).

### Synthetic renders (regression only)

`render-lines.py` draws any line-list fixture (public or master's corpus) to letter pages in three
skins — `mono` (Courier New), `ruled` (Arial with column rules), `banner` (two 7.5-pt halves) —
every three-space gap a tab stop, the type shrunk until a table fits, the truth stream carrying the
page breaks as rendered. These are layouts no registrar printed, twice removed from a real scan, so
they sit on their own board (`--full` or `--families synthetic-render`) and count for regressions
only. `--quick` renders one (the Vaasa template, `ruled`) beside its real PDF.

### Private seeds (aggregate only)

`--seeds-dir <dir>`: the maintainer's own PDFs (sanitized scans, synthetic records) with an
`expected.json` beside them keyed by file stem — the corpus shape (`courses` as
`code | title | credits | grade | season year[ | level]`, the seven header fields, `negative`,
plus an optional `"parser": "nd"`). They are `private-NN` in every output, one aggregate line per
level in `results.md`, and nothing about them — name, numbers, count — goes into a committed
file. This file reports numbers for the two public sections only.

## Pinned pages (`tests/fixtures/ocr-scans/`)

`pin-pages.mjs <bench-out-dir>` copies one generator page per level (nine: L0 … L7, placeholder
identities only — the script refuses any other family; ≤ 300 KB each, ≤ 3 MB together) with a
`.expected.json` (the page's truth lines, its expected rows, the ladder parameters it was drawn
with) and, for the OCR levels, a `.blocks.json` — the engine's `blocks` output captured once and
trimmed to lines and words with boxes and confidences. The pure stage of OCR step 2.1 (word boxes →
lines) unit-tests against those captures without the engine; `npm run ocr-bench -- --pinned` OCRs
the nine files as images (not through a PDF, so its numbers are not the ladder's) for a quick
check that the engine still reads what it read.

## How to run

    npm run ocr-bench -- --quick                       # one seed per family × L0/L2/L5 (about a minute)
    npm run ocr-bench -- --quick --config knobs.json --baseline ~/degree-audit-samples/bench-out/ocr-baseline-20261009
    npm run ocr-bench -- --families generator-external,generator-nd,generator-scan,public-pdf --levels L0,L1,L2,L3,L4,L5,L6,L7 --dpi 200
    npm run ocr-bench -- --full                        # prints the estimate; --yes runs it (hours; attended)
    npm run ocr-bench -- --pinned                      # the committed pages
    npm run ocr-bench -- --only banner --levels L2     # one seed, its diffs printed (public seeds only)
    node --experimental-strip-types scripts/dev/ocr-bench/ocr-run.mjs --interword --psm 4 scan.pdf   # the engine alone

`knobs.json` is any of `{scale, psm, dpi, engineLines, interword, lineConfidence, threshold, invert,
rotateAuto, border, rotationTrial, trialAlways, binaryDir, words, maxPages, params}`; `--seed` changes
the ladder's draws, `--dpi` L0's raster (300 makes L0 a true 300-dpi source — the resolution A/B of
step 12), `--skins` the renders, `--fetch` rebuilds missing public PDFs. A medium-set A/B —
`--families generator-external,generator-nd,generator-scan,public-pdf --levels L2,L5` (62 seeds,
151 pages, ~12 min) — is the one to trust over `--quick`: two step-12 verdicts reversed between them. The run folder holds every degraded page and PDF
(`<seed>/<level>/`), the 300-dpi masters, `results.csv`, `results.md` and `results.json`.

Adding a seed: a generator PDF is picked up by name in `seeds.mts` (`GENERATOR_PDFS`); a public PDF
needs its `sources.json` `pdf` entry (URL, SHA-256, bytes) and `expected.json` rows, as for the
replay; a line-list fixture is rendered automatically under `--families synthetic-render`.


## Baseline and the ladder so far (2026-10-09)

Four full-ladder runs exist under `~/degree-audit-samples/bench-out/` (62 seeds — the 13 generator
PDFs and the 49 public PDFs, 26 positives + 36 negatives, 151 pages, 620 rows each, ≈ 44 min):

| run | code | use |
|---|---|---|
| `ocr-baseline-20261009/` (11:05) | the step-9 pipeline — the engine's own lines, whitespace collapsed — on the parser BEFORE Batch B's F4–F6 | the pinned pages were cut from it; its `text` row is 49/62 exact against 60/62 today, so deltas against it are confounded (step 10's lesson) and it is kept as history, not as a baseline |
| `ocr-step10-before-20261009/` | the same pipeline on today's parser | the clean "before" of the OCR steps: every number below starts here |
| `ocr-step11-after-20261009/` | word boxes through the layout stage (step 11) | the ladder in force for L0–L5 after step 12 too: the source-aware scale renders the ladder's 150–200-dpi sources exactly as before (`--quick` and the medium set 0 / 0), and the orientation trial leaves every upright page its 0° reading |
| `ocr-full-20261009/` | the shipped pipeline (steps 11 + 12) | the sign-off run, started detached by the closing verification; read it with `--compare ~/degree-audit-samples/bench-out/ocr-full-20261009 --baseline ~/degree-audit-samples/bench-out/ocr-step11-after-20261009` — expected: L0–L5 within the trial's two junk pages of identical, L6-90 / L6-180 from 0 to about 65 % row accuracy |

By level, before (`ocr-step10-before`) → after (`ocr-step11-after`; the L6 figures from the step-12
medium-set trial run `ocr-step12-rotation-trial-medium/`, which read all four turns):

| level | exact | row acc | rows found | false rows (negatives with any) | field acc | CER | flag P/R | s/page |
|---|---|---|---|---|---|---|---|---|
| text | 60/62 | 93.0 % | 93.0 % | 1 (1/36) | 100 % | 0 | — | 0 |
| L0 | 34 → 35 | 50.0 → 65.2 % | 87.8 → 89.6 % | 19 (5) → 13 (6) | 81.7 → 87.3 % | 40.5 → 29.1 % | 76.9 / 8.3 → 70.0 / 53.2 % | 1.93 |
| L1 | 33 → 34 | 48.9 → 63.7 % | 88.5 → 90.7 % | 24 (6) → 15 (7) | 81.3 → 86.3 % | 40.4 → 29.5 % | 61.5 / 6.1 → 72.0 / 61.4 % | 1.96 |
| L2 | 34 → 32 | 46.3 → 54.1 % | 86.7 → 88.1 % | 24 (6) → 16 (7) | 80.3 → 80.9 % | 45.5 → 37.2 % | 86.4 / 14.3 → 70.8 / 63.0 % | 2.16 |
| L3 | 34 → 33 | 45.6 → 41.5 % | 83.7 → 81.9 % | 27 (6) → 19 (8) | 83.9 → 81.4 % | 42.6 → 42.2 % | 76.9 / 15.4 → 60.8 / 59.4 % | 1.87 |
| L4 | 32 → 29 | 38.1 → 41.5 % | 85.9 → 86.3 % | 22 (5) → 17 (8) | 76.1 → 73.1 % | 42.3 → 32.0 % | 81.8 / 23.8 → 88.1 / 69.6 % | 2.04 |
| L5 | 34 → 34 | 47.4 → 58.1 % | 87.0 → 89.6 % | 23 (4) → 21 (5) | 81.2 → 83.8 % | 42.3 → 35.8 % | 84.2 / 12.3 → 79.5 / 66.0 % | 1.79 |
| L6-90 | 7 → 34 | 0 → 65.2 % | 0 → 90.0 % | 221 (29) → 23 (7) | — → 87.4 % | 90.5 → 29.4 % | — → 69.9 / 56.7 % | 3.63 → ≈ 8 (four readings of page 1) |
| L6-180 | 15 → 33 | 0 → 64.4 % | 0 → 90.7 % | 54 (21) → 15 (8) | — → 86.4 % | 91.2 → 29.5 % | — → 70.3 / 52.3 % | 2.07 → ≈ 8 |
| L7 | 30 | 1.1 % | 38.1 % | 100 (6) | 56.7 % | 17.3 % | — | 0 (the text layer, never OCR'd) |

And on 300-dpi sources (L0 rendered at `--dpi 300`, 62 seeds): 216 dpi (`ocr-step12-before-l0-300/`)
→ the source-aware scale (`ocr-step12-shipped-l0-300/`): exact 36 → 40, row accuracy 66.3 → 70.0 %,
rows found 89.3 → 92.2 %, false rows 15 → 9, 1.18 × the time.

Where the losses sit (the step-11 verdict, unchanged by step 12): the parser's header-mapped cell
path on OCR'd cells — one misread header word unmaps a table (Alberta 19 → 3 rows right at L2),
a section cell left in the title (Minerva), junk cells taken for a code on 15 negative lines — and
one layout case (the insideND page at L4 split into two columns). Those are plan step 2.5's; the
two-pass deskew (keep `rotateAuto`'s reading only when the engine's own estimate is ≥ 1.5°) is the
next preprocessing candidate.

## OCR step 12 — the engine's parameters, the render scale, preprocessing (2026-10-09)

Plan steps 2.2–2.4, each an A/B on the same parser against a baseline made on the same code
(`bench-out/ocr-step12-before-quick/`, `-before-medium/` = 62 seeds, 151 pages at L2 and L5, and the
step-11 full ladder `ocr-step11-after-20261009/` for L3 and L6). `--quick` is 6 seeds (12 pages) at
L0 / L2 / L5. Row accuracy / rows found / false rows per level, then the verdict; the full per-run
boards are in each run folder's `results.md`.

| experiment (config) | L0 | L2 | L5 | medium set (62 seeds) | time | verdict |
|---|---|---|---|---|---|---|
| baseline (PSM 6, no dpi hint, scale 3.0 = 216 dpi) | 65.5 / 93.1 / 2 | 62.1 / 93.1 / 2 | 58.6 / 93.1 / 4 | L2 54.1 / 88.1 / 16; L5 58.1 / 89.6 / 21 | 1.8 s/page | — |
| 2.2 PSM 4 (one column) | 65.5 / 93.1 / 3 | 55.2 / 86.2 / 4 | 27.6 / 58.6 / 1 | — | 1.0 × | no: the phone-photo pages lose two thirds of their rows |
| 2.2 PSM 11 (sparse text) | 37.9 / 93.1 / 1 | 27.6 / 55.2 / 0 | 34.5 / 93.1 / 2 | — | 1.2 × | no: the words come back, the grade cells do not (grade accuracy 85 → 56 %) |
| 2.2 PSM 3 (automatic, extra) | 69.0 / 93.1 / 0 | 55.2 / 86.2 / 1 | 27.6 / 55.2 / 2 | — | 1.1 × | no: the Banner page exact and the Stanford key clean at L0, the same L5 collapse |
| 2.2 `user_defined_dpi` 216 | identical | identical | identical | 124 rows identical | 1.0 × | no-op for the LSTM engine; not set |
| 2.3 flat 300 dpi (scale 4.166) | 65.5 / 96.6 / 2 | 65.5 / 96.6 / 2 | 69.0 / 96.6 / 3 | L2 53.7 / 89.6 / 15; L5 52.2 / 90.7 / 14 | 1.2 × | not as a flat scale: the ladder's 150–200-dpi sources lose rows at L5 (upsampled past their own resolution; a misread header cell unmaps a Minerva table) |
| 2.3 300 dpi on 300-dpi sources (L0 at `--dpi 300`, 62 seeds) | 66.3 → 70.0 / 89.3 → 92.2 / 15 → 9; exact 36 → 40 | — | — | — | 1.18 × | **adopted as the source-aware scale**: a page renders at its scan's own resolution between 216 and 300 dpi (`ocrRenderScale(w, h, scanDpi)`), so every ladder level reads as before and a 300-dpi scan gains |
| 2.4 `rotateAuto` (the engine's skew) | — | 48.3 / 93.1 / 4 | 62.1 / 96.6 / 4 | L2 37.8 / 88.5 / 17; L3 41.5 → 58.9 / 81.9 → 86.7 / 19 → 15; L5 58.5 / 90.4 / 20; L6 unchanged | 1.25–1.3 × | no: photocopies (2–3°) gain 17 points, office scans (±0.5–1.5°) lose 16 — the small-angle re-rendering itself hurts (the angle estimate is accurate); the two-pass form is the next step's candidate |
| 2.4 `thresholding_method` 1 (Leptonica Otsu) | 65.5 / 93.1 / 1 | 0.0 / 0.0 / 5 | 17.2 / 34.5 / 4 | — | 10 × at L2 | no (proven to take effect: the engine's `imageBinary` differs under 0 / 1 / 2) |
| 2.4 `thresholding_method` 2 (Sauvola) | 75.9 / 100 / 0 | 55.2 / 96.6 / 0 | 55.2 / 100 / 2 | L2 41.1 / 88.9 / 14; L5 57.8 / 89.6 / 14 | 1.0 × | no: fewer false rows, far fewer rows right (the Minerva long record 47 → 10) |
| 2.4 `tessedit_do_invert` 0 | 72.4 / 100 / 1 | 62.1 / 96.6 / 2 | 62.1 / 96.6 / 4 | L2 55.6 / 88.5 / 17; L5 58.5 / 90.0 / 23 | 0.93–0.97 × | no: +1.5 / +0.4 points and faster, but false rows rise on the medium set (16 → 17, 21 → 23) |
| 2.4 10-px white border | 65.5 / 93.1 / 2 | 62.1 / 93.1 / 2 | 58.6 / 96.6 / 1 | — | 1.08 × | no: neutral on rows, scrambles a key page's reading order (Stanford CER 31 → 75 %) |
| 2.4 orientation trial (page 1 at 0 / 90 / 180 / 270°, the best mean word confidence kept) | 65.5 / 93.1 / 2 | 62.1 / 93.1 / 2 | 58.6 / 93.1 / 4 | L6-90 row accuracy 0 → 65.2 %, rows found 0 → 90.0 %, false rows 274 → 23, CER 90.4 → 29.4 %; L6-180 0 → 64.4 %, 0 → 90.7 %, 48 → 15, 91.0 → 29.5 % — the turned levels now read within a point or two of the upright ones (L2 54.1 %, L5 58.1 %); L2 and L5 themselves unchanged row for row but for the two junk pages a turn beat by 1.5 / 3.5 points (one false row each), which the margin keeps upright | 4 × page 1 without the early exit | **adopted with the early exit** — see below |

The orientation trial on `--quick` with L6 added (`bench-out/ocr-step12-rotation-trial-quick/` vs
`-before-quick-l6/`): L6-90 row accuracy 0 → 69.0 %, rows found 0 → 93.1 %, false rows 18 → 2;
L6-180 0 → 65.5 %, 0 → 96.6 %, 9 → 1; L0–L5 identical to the baseline (every upright page kept its
0° reading). `--pinned` under the shipped config (`bench-out/ocr-step12-shipped-pinned/`): the two
sideways pinned pages read as their upright selves — L6-180 external-transcript 0 → 2 of 3 rows right,
CER 85.7 → 0.3 %; L6-90 nd-undergrad 0 → 4 of 5, CER 94.7 → 0.2 % — the other seven unchanged. On the medium set with all four turns always read (`bench-out/ocr-step12-rotation-trial-medium/` vs the step-11 ladder): L6-90 row accuracy 0 → 65.2 %, rows found 0 → 90.0 %, false rows 274 → 23; L6-180 0 → 64.4 %, 0 → 90.7 %, 48 → 15 — the turned levels read within a point or two of L2 / L5 — and L2 / L5 unchanged row for row except two junk pages a turn "beat" by 1.5 and 3.5 points (one false row each; the shipped margin of 5 keeps them upright). The early exit and the margin come from the trial figures kept in that run's `results.json` (`pageFigures`): upright pages score 70 or more nine times in ten and never under 21; the wrong way round never over 54.6; the right turn won 123 of 124 turned pages, by a median of 45.8 points.


## Sign-off run of the shipped pipeline (2026-10-09, full ladder)

`npm run ocr-bench -- --compare ~/degree-audit-samples/bench-out/ocr-full-20261009 --baseline ~/degree-audit-samples/bench-out/ocr-step11-after-20261009`
(62 seeds: the generator PDFs and the public registrar PDFs; the shipped pipeline = word boxes through the layout
stage, each page rendered at its scan's own resolution between 216 and 300 dpi, the orientation trial on page 1):

| level | row accuracy | rows found | false rows (negatives) | CER | s/page |
|---|---|---|---|---|---|
| text (reference) | unchanged | | | | |
| L0–L5 (clean … phone photo) | unchanged from step 11 | unchanged | unchanged | unchanged | 1.9–2.2 → 2.4–3.0 (the resolution step) |
| L6-90 (sideways scan) | 0.0% → **65.2%** | 0% → 90.0% | 274 (30/36) → 23 (7/36) | 90.4% → 29.4% | 3.6 → 8.0 (the trial on page 1) |
| L6-180 (upside down) | 0.0% → **64.4%** | 0% → 90.7% | 48 (20/36) → 15 (8/36) | 91.0% → 29.5% | 2.1 → 7.9 |
| L7 (scanner text layer) | unchanged | | | | |

The ten "regressions" the compare lists are all at L6: pages that read nothing before now read, and a few key/legend
pages (Duke, Waterloo, UWO, HKU, the McGill course outline) yield one to six junk rows once turned — the same false
rows those pages produce upright at L2/L5, now reachable. 113 improvements. Private seeds: none in this run.


## Engine gate — PaddleOCR PP-OCRv6_tiny (plan step 14, 2026-10-09): measured offline, NOT adopted

The gate (DECISIONS 2026-10-09, the program row): a second engine is adopted only if it reads ≥ 10 points
more rows right (row accuracy) than the improved Tesseract on the office-scan, photocopy, stamped and phone
levels (L2–L5) at ≤ 2× the seconds per page — and then passes the WebKit e2e, as a second opt-in whose
sentence names its size. The one candidate under 20 MB the research named (§4.1 of the plan) was measured.

**What ran.** `scripts/dev/ocr-bench/engine-gate/` — dev only, with its OWN `package.json` (the MIT
`paddleocr` 1.2.0 runtime, `onnxruntime-web` and `onnxruntime-node` 1.30.0, MIT) and git-ignored
`node_modules/`; the root `npm ci`, the sheet-sync Action and the Pages deploy never install it, and nothing
in `src/` imports it. `fetch-models.mjs` downloads PaddlePaddle's own ONNX exports of PP-OCRv6_tiny
(`PaddlePaddle/PP-OCRv6_tiny_det_onnx` 1.78 MB and `_rec_onnx` 4.46 MB, Apache-2.0, at pinned Hugging Face
revisions, each checked against its pinned SHA-256 and size) into `~/degree-audit-samples/engine-gate-models/`
— never into the repo — and cuts the recogniser's 6904-character list from its official `inference.yml`.
`gate.mjs` reads, for each seed × level, the very page renders the shipped Tesseract read in the sign-off run
`ocr-full-20261009/` (`<seed>/<level>/render/`, at the dpi its `results.json` records per page) →
PP-OCRv6_tiny detection + recognition on **onnxruntime-web, WebAssembly, one thread** (the browser's runtime;
GitHub Pages and the cse.nd.edu iframe give no cross-origin isolation, so no threads) → word boxes → page rows
→ `src/transcript/ocr-lines.ts` `ocrPageLayout` (the SAME `blocksToRuns` word-space shares and `layout.ts`
`pageLayout`) → the seed's parser → `score.mts` `scoreBench`. With `--tesseract` the shipped Tesseract
(`ocr-run.mjs` `BASELINE_CONFIG`, orientation trial included) re-read every page in the same process, page by
page beside Paddle, so the time ratio is taken under the same machine load; the code ran from a frozen
`git archive` of `13f97e5` (the commit the sign-off ran on; `--code` and the transcript code's hash are in
each `results.json`), and the same-session Tesseract reproduced the sign-off run's rows, matches and CER on
all 372 seed × level documents.

**The adapter** (engine output → what `ocrPageLayout` reads; each figure measured on L0 or L1, never on a
scored level): a detected text line's CTC character positions give its words' extents — split at the spaces
it emits and, where it emits none, at a gap of `GAP_SPLIT_PITCHES` = 3 character pitches (on the L0 page 1 of
40 seeds, letters with no space between them sit 1.0 pitch apart at the median and 2.0 at the 99th
percentile; a monospace "3.0    A" otherwise reads "3.0A"); a detected box is 1.33× the height of the
Tesseract line on the same line at the median (1687 boxes, 30 seeds' L0 page 1, `calibrate.mjs`), so its height
× `DETECTION_BOX_INK_SHARE` 0.75 is the line height the shares measure gaps against; the lines are grouped into
page rows across the page's skew (the median slope of the wide boxes); every word is Unicode-NFKC-normalised
(the multilingual character list emits "B⁺" for "B+"); and page 1's orientation trial keeps the shipped rule's
shape on Paddle's mean character probability (floor 90, margin 5 — on L1 every upright page read ≥ 95.8 and
every page turned 180° or 270° ≤ 64.2) with one addition the runtime forces: it turns a crop 1.5× taller than
wide a quarter before reading it, so a page lying on its side reads every word right at its upright confidence
(0° and 90° within 0.2 points at the median on L1) in a layout of columns that are really rows — a reading
whose lines run down the page (`wideShare` < ½) never stands. The trial turned all 124 L6 documents the right
way and no upright one, and read a turn at all on 3 of the 248 L2–L5 documents.

**The numbers** (62 seeds: the generator PDFs and the public registrar PDFs — 26 positives with 270 expected
rows, 36 negatives — 124 pages per level; `~/degree-audit-samples/bench-out/engine-gate-20261009/`
`medium/` (L2 + L5), `L3/`, `L4/`, `L6-90/`, `L6-180/`; five runs side by side, each Paddle and Tesseract
interleaved; row accuracy / rows found / false rows (negatives with any) / CER / s/page):

| level | Tesseract (shipped) | PP-OCRv6_tiny | Δ row acc | time × |
|---|---|---|---|---|
| L2 office scan | 54.1 % / 88.1 % / 16 (7) / 37.2 % / 3.32 | **68.9 %** / 87.8 % / 7 (4) / 28.0 % / 3.50 | +14.8 | 1.06 |
| L3 photocopy | 41.5 % / 81.9 % / 19 (8) / 42.2 % / 3.16 | 47.8 % / 83.3 % / 7 (4) / 34.1 % / 3.49 | +6.3 | 1.10 |
| L4 stamped | 41.5 % / 86.3 % / 17 (8) / 32.0 % / 2.71 | 38.9 % / 86.3 % / 8 (4) / 29.8 % / 3.76 | −2.6 | 1.39 |
| L5 phone photo | 58.1 % / 89.6 % / 21 (5) / 35.8 % / 2.69 | **70.4 %** / 87.8 % / 6 (3) / 28.5 % / 3.54 | +12.2 | 1.32 |
| **L2–L5 pooled** | 48.8 % (527 / 1080 rows) / 86.5 % / 73 (28/144) / 36.8 % / 2.97 | 56.5 % (610 / 1080) / 86.3 % / 28 (15/144) / 30.1 % / 3.57 | **+7.7** | **1.20** |
| L6-90 sideways (not gated) | 65.2 % / 90.0 % / 23 (7) / 29.4 % / 8.57 | 80.4 % / 89.6 % / 8 / 26.8 % / 9.70 | +15.2 | 1.13 |
| L6-180 upside down (not gated) | 64.4 % / 90.7 % / 15 (8) / 29.5 % / 8.53 | 80.7 % / 90.0 % / 6 / 26.6 % / 9.69 | +16.3 | 1.14 |

Pooled over L2–L5 beside that: exact documents 128 → 158 of 248, field accuracy 79.9 → 86.9 % (title 63.8 →
77.4, credits 72.5 → 86.9, grade 73.3 → 84.0, term 99.3 → **95.5**, level 90.4 → 90.6 %), precision 97.8 →
98.6 %, flag precision / recall 74.2 / 64.6 → 55.6 / **21.4 %**. Per document, Paddle read more rows right on
53 positive seed × level documents, fewer on 23, as many on 28, and fewer false rows on 17 negatives, more on 2.
The bench's own delta printer reads the gate's runs (`npm run ocr-bench -- --compare
~/degree-audit-samples/bench-out/engine-gate-20261009/medium --baseline
~/degree-audit-samples/bench-out/ocr-full-20261009`: L2 / L5 as above, 16 regression lines, 85 improvements).

**Verdict: NOT adopted — the accuracy half fails.** +7.7 points pooled over L2–L5 against the ≥ +10 the gate
asks; level by level it clears the bar on the office scan (+14.8) and the phone photo (+12.2) and not on the
photocopy (+6.3) or the stamped page (−2.6). The time half passes on the bench's figure (s/page pooled, ×1.20;
×1.06–1.39 per level), but that figure is pulled down by Tesseract's orientation trial re-reading low-confidence
key pages four times (the Stanford key at L5: 21.2 s/page). Per document the median ratio is ×1.78 (L2 1.66,
L3 1.88, L4 1.74, L5 1.97) and on the 26 transcripts themselves — the documents with rows — ×2.30: the Minerva
long record ×2.3–2.5, the Banner pages ×1.4–2.2. On the pages a student uploads it is over the gate's 2×. Two further reasons it is not a drop-in:
(1) its flag recall — the share of wrong rows the preview marks ⚠ for the student to check — falls from 64.6
to 21.4 %, because its character probabilities stay high on rows it reads wrong; the app's "never guess"
safety net would need a new confidence rule before it could ship; (2) it reads term cells worse (99.3 →
95.5 %). The swings are concentrated: the Minerva long record (49 rows) gains 9 → 32 at L3 and loses 28 → 1
at L4 (each title's trailing number read as the credits, the term headers lost), ANU's sample 0 → 12 of 32 at
L2 (and 0 both ways at L5, every row read without its level cell), Alberta 9 → 21 of 24 at L5; the insideND page reads 0 rows at L2 and L5 because `layout.ts` splits its one-column table into two
columns at the gutter before "Credit Hours" (the grades' right-hand cells come out as a second column after
the first) — the split Tesseract's boxes hit only at L4 — so part of the
difference either way is the layout stage and the parser, not the engine (plan step 2.5's ground).

**Re-measured on the parser that landed during the gate** (`81b038d`: Batch C's text side and OCR step 2.5
(a), (b), (d) — a frozen archive again, both engines re-read in one session, `head-81b038d-L2/` … `-L5/`):
both engines gain and Tesseract gains more — row accuracy L2 63.0 → 76.3 % (+13.3), L3 44.1 → 51.1 % (+7.0),
L4 46.7 → 39.3 % (−7.4), L5 67.0 → 75.2 % (+8.1); pooled 55.2 → 60.5 %, **+5.3 points** (596 → 653 of 1080);
false rows 65 → 33; time ×1.23 pooled. The verdict holds, with a wider margin.

Where it would help, measured: false rows fall by more than half at every level (L2–L5 73 → 28; L6 38 → 14),
and a turned page reads 15–16 points better. Size if it were adopted: 1.78 + 4.46 MB of models, 14.24 MB
`ort-wasm-simd-threaded.wasm` (onnxruntime-web 1.30.0) and 0.2 MB of runtime ≈ 20.7 MB raw beside the 6.6 MB
of `public/ocr/` (`tests/ocr-assets.test.ts` caps it at 7.5 MB until the DGS raises it).

The runner, the fetcher and the calibration stay in the tree for a re-run — on new parser code (the gate's
two columns go through the same parser, so a parser change moves both), a new model (PP-OCRv6_small, 31 MB
of models, is the research's accuracy pick), or a new runtime:

    cd scripts/dev/ocr-bench/engine-gate && npm install && node fetch-models.mjs
    node --experimental-strip-types gate.mjs --from ~/degree-audit-samples/bench-out/ocr-full-20261009 \
         --levels L2,L5 --tesseract --out ~/degree-audit-samples/bench-out/engine-gate-<date>-medium
    node --experimental-strip-types calibrate.mjs --from ~/degree-audit-samples/bench-out/ocr-full-20261009

(`--levels L3`, `L4`, `L6` likewise; `--backend node --threads 4` for a faster accuracy-only pass — the same
numerics, not the browser's time; `--only <seed>` prints the row diffs; `--trial-always` reads all four turns.)
`trial-calibration-L1/` holds the trial's L1 figures only (read from the working tree with an earlier word
splitter; confidences do not depend on either). FERPA: public and generator seeds only.


## Plan step 2.5 — the parser on a scan's noise (2026-10-09)

The step-11 and step-12 verdicts left one cause behind most OCR losses: the parser's header-mapped path
read a scan's header line as strictly as a text layer's, so one misread or run-together header cell left
a table unmapped (Alberta 19 → 3 rows right at L2; Minerva's "Cr./C.E.U." read "Cr./C.E\U." at 300 dpi),
the multi-term mark stayed in Minerva's titles, and junk cells became course codes on the keys. Three
rules, each on OCR lines ONLY (`parseExternalTranscript` given confidences — a text layer reads exactly as
before: the replay against HEAD's own is 0 / 0 after each), each with its DECISIONS row and tests, then
the flat 300-dpi render re-tested on the new parser.

**How a parser rule is measured now.** Every bench run writes the lines the parser read
(`<seed>/<level>/ocr-lines.json`); `npm run ocr-bench -- --reparse <run>` re-scores them with today's
parser and starts no engine. The engine is deterministic, so a reparse equals a fresh run — checked: the
step's `--quick` lines reparsed with HEAD's parser reproduce `ocr-step12-shipped-quick` row for row. Every
row below is the SAME OCR lines read by the parser before and after the rule. The lines:
`ocr-step25-auto-medium/` (the shipped scale; the medium set, 62 seeds, L2 / L5), `ocr-step25-flat300-medium/`
and `ocr-step25-flat300-rest/` (scale 4.1667 = 300 dpi; L2 / L5 and L0 / L1 / L3 / L4),
`ocr-step25-before-20261009/` + `ocr-step25-rest/` (the shipped scale at L0–L6), `ocr-step25a-quick/`,
and `ocr-step25-synth/` — ten line-list fixtures with numeric course codes or capitalised subjects
(Addis Ababa, Polimi, DTU, Chulalongkorn, the Iran rendering, Delhi, UNAM, Sharif, MIT, CMU) rendered
in the `ruled` skin and scanned at L2 / L5, the check that a guard costs no real row on layouts the
public seeds do not cover.

Row accuracy / rows found / false rows (negatives with any), the medium set; "before" is HEAD `5acf871`
(Batch C's parser):

| rule | L2 | L5 | flat-300 lines L2 | flat-300 lines L5 | other checks | verdict |
|---|---|---|---|---|---|---|
| before | 58.1 / 92.2 / 16 (7) | 62.2 / 93.7 / 21 (5) | 60.7 / 96.7 / 17 (7) | 58.5 / 96.7 / 11 (6) | — | — |
| (a) header noise: noise marks out of header cells; a word ≥ 4 letters one letter off a header word repaired on a line already ≥ 60 % header; a two-line header's run-together lower line split back | 61.1 / 92.6 / 16 | 64.8 / 94.1 / 21 | 64.4 / 96.7 / 17 | 67.0 / 96.7 / 11 | `--quick`, `--pinned` 0 / 0 | adopted `5620628` — Alberta 3 → 11 / 9 → 16 rows right; Minerva's three header pages 0 → 4–5 on the 300-dpi lines |
| (d) Minerva's multi-term mark as a scan reads it ("<>", "<~", "2") before the section and the title | 63.0 / 92.6 / 16 | 67.0 / 94.1 / 21 | 67.0 / 96.7 / 17 | 69.6 / 96.7 / 11 | 0 / 0 | adopted `ce56a71` — the multi-term page 2 → 7 / 1 → 7 of 8 |
| (b) the junk-code guard on lines under the floor (80): an all-lower-case subject with a letter whose capital differs, a decimal number taken for a code, a title with no word of four letters | 63.0 / 92.6 / 13 (6) | 67.0 / 94.1 / 14 (4) | 67.0 / 96.7 / 13 (5) | 69.6 / 96.7 / 9 (5) | `--quick` false rows L0 2 → 1, L5 4 → 1; synthetic 0 / 0 | adopted `81b038d` |
| (b) with any lower-case letter refused ("Contin", "Math") | — / — / 12 | — / — / 12 | — / — / 13 | — / — / 8 | the Addis Ababa render loses 2 of 9 rows (L2), 1 (L5) | not adopted |
| (b) with a numeric code needing its credits (and a grade) | unchanged rows | | | | the renders lose 3 (34) real rows whose credits the scan misread | not adopted |

The three rules together, same lines: L2 58.1 → 63.0 %, rows found 92.2 → 92.6 %, false rows 16 → 13,
field accuracy 81.8 → 83.8 %; L5 62.2 → 67.0 %, 93.7 → 94.1 %, 21 → 14, 84.5 → 86.8 %; 0 regression lines.
On the whole ladder — the shipped-scale lines of L0–L6 (`ocr-step25-lines-auto/`: the full run's lines for 41 seeds; it was stopped there while another agent's engine gate held the machine, and the other 21 seeds were read in parallel into `ocr-step25-rest/`; L2 / L5 from the medium run) — every level gains and loses no row: row accuracy 72.2 → 74.8 / 70.7 → 73.3 / 58.1 → 63.0 / 43.3 → 44.1 / 44.8 → 46.7 / 62.2 → 67.0 % at L0–L5 and 72.2 → 74.8 / 71.5 → 74.1 % at L6-90 / L6-180; false rows 13 → 11 / 15 → 11 / 16 → 13 / 19 → 15 / 27 → 23 / 21 → 14 and 23 → 13 / 15 → 12; 0 regression lines, 33 improvements.

**(c) The flat 300-dpi render, re-tested on the new parser — NOT adopted** (`bc36cde`). Step 12 rejected a flat
300 because a misread header cell unmapped a table; with rules (a), (d), (b) in place the same pages were read at a
flat 300 dpi (`--config {"scale": 4.1667}`; `ocr-step25-flat300-medium/` + `-flat300-rest/`) and scored by the same
parser against the shipped scale (`ocr-step25-lines-auto/`):

| level | row acc | rows found | false rows (negatives with any) | note |
|---|---|---|---|---|
| L0 clean (200 dpi) | 74.8 → 77.0 % | 96.7 → 96.7 % | 11 (5) → 9 (3) | |
| L1 good scan | 73.3 → 76.3 % | 97.8 → 97.4 % | 11 (4) → 7 (4) | |
| L2 office scan | 63.0 → 67.0 % | 92.6 → 96.7 % | 13 (6) → 13 (5) | new false rows: the generator's "other" page 0 → 1, Duke 3 → 4, the Banner pair's extras |
| L3 photocopy | 44.1 → **7.8 %** | 84.4 → 51.9 % | 15 (6) → 28 (7) | 3.3 → 10.4 s/page: the upsampled speckle reads so poorly (median mean word confidence 62) that the orientation trial reads page 1 four times |
| L4 stamped | 46.7 → 39.6 % | 89.6 → 88.9 % | 23 (6) → 12 (6) | the Minerva long record 28 → 1 rows right |
| L5 phone photo | 67.0 → 69.6 % | 94.1 → 96.7 % | 14 (4) → 9 (5) | new false rows: Stanford 0 → 1, Tokyo 0 → 1 |

The medium set's gain is almost all one document: Evergreen's code-less credit list reads 19 rows at 300 against 11
at 216, because at 216 one breakdown line ("*5 - Microbiology with Laboratory") is missing from the OCR lines and
the program's sum then refuses all eight; without Evergreen it is +3 rows right at L2 and −1 at L5. The task's
criterion — the medium set improves WITHOUT new false rows — fails (new false rows on four keys and the Banner pair,
the totals held only by others vanishing), and the photocopy level collapses. `OCR_BASE_DPI` stays 216 (its comment
in `src/transcript/ocr-lines.ts` carries this re-test); Evergreen's lost line at 216 is the open item.

Left for the next step (2.6–2.7 and a layout fix): Alberta's "Avy" (a three-letter misread, never
repaired by rule) keeps its first table unmapped; on Alberta's page 2 the LAYOUT stage drops "Points"
from three of the four lower header lines — the engine reads it (confidence 84–95), `dropWatermarks`
takes the repeated word for a tile on the skewed word boxes — so those tables stay unmapped too; Duke's
grade key still yields "SP 40 / HP 35 / LP 25" rows (the engine drops the decimal point of "4.0") and its
false rows remain the largest; a misread digit in a cell ("3:0", "3.0:") is Batch C's answer (4), the
numeric correction shown beside the raw reading.


## Batch C, the OCR side — numeric corrections, scanned-line strips, scanner text layers (2026-10-09/10)

The DGS's answers (4)–(6) of 2026-10-09 (DECISIONS rows of that date; the plan's §5 "Batch C, the OCR side").

**(4) OCR numeric corrections** (`21c56f9`): a credits or grade cell printed with a letter for a digit
("3.O", "l.5", "8O") or a plus read as "t" ("Bt") is read corrected on OCR lines only, and only where it
fills a value the scan's own reading left empty. On the same OCR lines read by HEAD `4288662`'s parser
and by the rule (`--reparse`): the whole ladder L0–L6 (`ocr-step25-lines-auto/`), the medium set
(`ocr-step25-auto-medium/`) and `--quick` — every level unchanged, 0 regression lines, 0 improvements;
`--pinned` 0 / 0. Tesseract's LSTM printed no such number or "Bt" in a course row of the 62 seeds; a
survey of the saved lines found 17 letter-for-digit numbers and 38 "At / Bt / Ct / Dt", all on keys,
legends, junk lines and Vaasa's two titles ("Course I1" for "Course II" — a title, which the rule leaves
alone). Where the rule acts is a scanner's own layer (L7, below).

**(5) Scanned-line strips** (`e001129`): a preview-only change — every OCR line carries its pixel box and
every OCR row its source lines; the parser's values are untouched (`--reparse` of the ladder and the medium
set: 0 / 0).

**(6) Scanner text layers** (`2560c53`): a PDF whose every page is a scan (one image over ≥ 90 % of the
page, no text visible over it) with a text layer is read OCR-grade. L7 on the sign-off run's own 62 L7
PDFs (`bench-out/step26c-l7-exact/` → `-app/`, `-flag/`):

| L7 read as | row acc | rows found | false rows (negatives with any) | field acc | flag P / R |
|---|---|---|---|---|---|
| exact (before; the 2026-09-06 lock) | 1.1 % | 38.1 % | 100 (6/36) | 56.7 % | — / 0 % |
| **OCR-grade (`--l7 app`, adopted)** | 1.1 % | 37.8 % | 94 (5/36) | 57.3 % | 99.0 / 100 % |
| exact, every row flagged (`--l7 flag-only`) | 1.1 % | 38.1 % | 100 (6/36) | 56.7 % | 99.0 / 100 % |
| **OCR-grade without the junk-code guard (review fix 2026-10-10, shipped)** | 1.1 % | 38.1 % | 100 (6/36) | 56.7 % | 99.0 / 100 % |

Detected on 62 of 62 L7 PDFs; on none of the generator fixtures with text; of the 49 public PDFs on two
real scans with an OCR layer (Algeria's relevé template, Cornell's key — negatives, 0 rows either way).
The one regression line is ANU's sample at L7 (rows found 13 → 12, extras 13 → 9): the poor layer turned
its placeholder title "CLASS" into "CLA5S", which the junk-code guard refuses on a low-confidence line;
McGill's key loses its false row and Minerva's transfer page one extra. Row accuracy stays at 1 % because
the seeded layer garbles nearly every title — the level measures false rows and flags, not titles.

**Review fixes (2026-10-10).** A review found the guard behind those gains dropping REAL rows on a scanner's
layer — read at confidence 0, every row went through OCR step 2.5 (b): titles with no four-letter word ("Dir
Res", "Art"), lower-case subjects ("ee 501"), decimal course numbers (all ten of SNU's rows). The guard now
reads only our engine's poor lines (`{ scannerLayer: true }`; the bench's L7 passes it, fresh and `--reparse`).
`--reparse` of `step26c-l7-app`, HEAD `2c3888f`'s parser → the fix (`bench-out/review-fix-before-l7` →
`review-fix-after-l7`): rows found 37.8 → 38.1 %, field acc 57.3 → 56.7 %, false rows 94 (5/36) → 100 (6/36) —
the exact path's figure; against `step26c-l7-exact` 0 / 0 with flags 99.0 / 100 %. Three regression lines, each
a row the guard had dropped, each flagged in the preview: ANU rows found 12 → 13 ("CLA5S" back) with extras
9 → 13, McGill's key 0 → 1 false row, Minerva's transfer page 2 → 3 extras. The 216 line fixtures read as a
scanner layer now lose 0 rows the text path reads (HEAD lost 12). The same batch narrowed the numeric
correction (a bar is a table rule, never a 1; a whole number of strokes — "I1" — or led by a letter — "IO1" — is
never corrected; only a decimal or a grade may leave a title): `--quick`, the medium set, the ladder L0–L6 and
`--pinned` 0 / 0 (`review-fix-before-*` → `review-fix-after-*`), and no L7 row changed by it; and, on the text
side, TH02's country evidence, the adjacent-line conferral's value cell and the in-progress gate — every saved
OCR line set under bench-out (1,752 files) re-parsed by both parsers: 3 documents changed, all three the L7
lines above. DECISIONS 2026-10-10.

## Verification at the close of the next stage (2026-10-10)

The shipped pipeline at `5b8b521` (Batch C's OCR side and its review fixes), measured fresh — the engine run
again, not a re-parse:

- `--pinned` (`bench-out/final-20261010-pinned/` against `review-fix-after-pinned/`): 0 regressions, 0
  improvements — L0 2/3, L1 7/9, L2 6/10, L3 exact, L4 2/5, L5 exact, L6-180 2/3, L6-90 4/5 rows right of
  expected, L7 0/6 (a Notre Dame page; the level measures the text layer); 1.08 s/page.
- The medium set (62 seeds, 151 pages, L2 / L5; `bench-out/final-20261010-medium/`, 15.3 min) against the
  sign-off run `ocr-full-20261009/`: 0 regressions, 11 improvements — every one of them step 2.5's or Evergreen's
  (CC15) — and against the review fixes' `--reparse` of the same lines (`review-fix-after-medium/`) identical
  boards, only s/page differing. So a fresh engine run reproduces the re-parse exactly, as `--reparse` assumes.

| level | exact | row acc | rows found | precision | false rows (negatives with any) | field acc | CER | flag P / R | s/page |
|---|---|---|---|---|---|---|---|---|---|
| text | 61/62 | 100.0 % (93.0) | 100.0 % (93.0) | 100.0 % | 1 (1/36) | 100.0 % | 0.0 % | — | — |
| L2 | 33/62 | 63.0 % (54.1) | 92.6 % (88.1) | 98.0 % | 13 (6/36) (16, 7/36) | 83.8 % (80.9) | 37.2 % | 61.3 / 61.3 % (70.8 / 63.0) | 3.03 |
| L5 | 35/62 | 67.0 % (58.1) | 94.1 % (89.6) | 98.4 % | 14 (4/36) (21, 5/36) | 86.8 % (83.8) | 35.8 % | 66.7 / 59.8 % (79.5 / 66.0) | 2.48 |

(The sign-off run's figure in brackets.) The flag figures are the one column that fell: they moved between the
sign-off run and step 2.5 (`ocr-step25-auto-medium`: 65.6 / 62.4 and 76.5 / 65.0 %; `step26-before-medium`: the
present figures) and not since. The rows and the false rows improved, so the bench's rule calls it no
regression; that the step-2.5 junk-code guard removed rows which had been flagged wrong rows would explain both
falling together, but it has not been checked row by row (an open item in plan §5).

The e2e now looks at the strips in a real browser on both engines (plan §5 “Next stage — verification and
records”): the e2e scan's two rows are both flagged, each strip a drawn 815–829 × 40 px canvas shown at 780 ×
40 px at 1400 px wide and 489 × 26 px at 390 px (where the line's right end — credits, grade — sits behind a
sideways scroll inside the strip; put to the DGS).

## Item 13 — why the flag figures fell, and flags on cell evidence (2026-10-11)

**Why both flag figures fell** (the open item above). The same saved OCR lines (`final-20261010-medium/`, the
medium set at L2 / L5) read by each parser since the sign-off run, scored on the other universities'
documents — the Notre Dame import refuses a scan, so its seeds' rows never reach a student (the bench's own
figures count them, never flagged, which is why its recall reads lower):

| parser | L2 wrong rows | flagged | flagged and wrong | flag P / R | L5 wrong rows | flagged | flagged and wrong | flag P / R |
|---|---|---|---|---|---|---|---|---|
| before step 2.5 (`5620628^`) | 99 | 96 | 68 | 70.8 / 68.7 % | 98 | 88 | 70 | 79.5 / 71.4 % |
| step 2.5 (a), (d), (b) (`81b038d`) | 84 | 93 | 57 | 61.3 / 67.9 % | 79 | 78 | 52 | 66.7 / 65.8 % |
| Batch C (4), the review fixes (`21c56f9`, `5b8b521`) | 84 | 93 | 57 | unchanged | 79 | 78 | 52 | unchanged |
| item 14 (`308e304`) | 83 | 92 | 56 | 60.9 / 67.5 % | 79 | 78 | 52 | 66.7 / 65.8 % |

Both figures fell at step 2.5 and nowhere else, because the parser got better. Step 2.5 removed 15 wrong rows
at L2 and 19 at L5 (net), and 11 and 18 of them were rows the flag had rightly marked. Most of those rows still
sit on a line the engine read poorly, so they stay flagged now that they read right: flags on right rows went
28 → 36 at L2 and 18 → 26 at L5, and precision fell. The rows left wrong were more often read with confidence,
so recall fell a little. The junk-code guard explains little of it: with the guard off (`item13-reparse-nojunk/`)
the bench reads 62.5 / 62.5 % at L2 and 69.4 / 62.8 % at L5, against 61.3 / 61.3 and 66.7 / 59.8 %.

**Flags on the document's own evidence (adopted).** What stays wrong and unflagged — 27 rows at each level — is
a confident misread: a credit read as another value ("3" as "8"), a grade cell that took the credits' "3.0", a
term whose rows do not add up. Three facts of the document now flag such a row on OCR lines (`evidence` on the
row, after the rows are read; the preview's ⚠ says which in its hover text; a text layer is never touched):

- `credits` — a credit value no other row of the document has, on a document of four rows or more;
- `mark` — a mark that is not a grade the app reads and has a digit or a stray sign in it;
- `totals` — a term whose rows do not add up to the transcript's own totals line (item 11's check).

Each rule on the medium set, item 14's parser plus the rule, other universities' documents (rows flagged / of
them wrong):

| rule | L2 | L5 |
|---|---|---|
| before: a poorly read line, a corrected cell, a scanner's layer | 92 / 56 | 78 / 52 |
| + `credits` | 24 / 15 | 21 / 13 |
| + `mark` as first written: any mark not read as a grade | 11 / 2 | 14 / 6 |
| + `mark` adopted: a digit or a stray sign in it | 0 / 0 | 5 / 5 |
| + `totals` | 1 / 1 | 1 / 0 |
| + an empty grade where three in four rows have one (tried) | 1 / 0 | 1 / 0 |

The first form of `mark` flagged McGill's deferred, incomplete, no-grade-reported and withdrawn marks (K, L, KE,
NR, KF, WL, WF, J) and Banner's NG — real marks, read right. A mark of letters alone is now no evidence. The
empty-grade rule flagged one in-progress course and caught nothing, so it is not used.

The result, the same lines re-parsed by item 14's parser and then item 13's (`item13-base308-medium/` →
`item13-final-medium/`):

| level | flag P / R, bench (all documents) | flag P / R, other universities' documents |
|---|---|---|
| L2 | 60.9 / 60.9 % → 61.5 / 78.3 % | 60.9 / 67.5 % → 61.5 / 86.7 % |
| L5 | 66.7 / 59.8 % → 66.7 / 80.5 % | 66.7 / 65.8 % → 66.7 / 88.6 % |

The whole ladder, the saved lines of L0–L6 (`ocr-step25-lines-auto/`) and L7 (`step26c-l7-app/`), the bench's
figures (`item13-base308-ladder/`, `-l7/` → `item13-final-ladder/`, `-l7/`):

| level | flag precision | flag recall |
|---|---|---|
| L0 clean | 59.3 → 57.3 % | 50.0 → 72.9 % |
| L1 good scan | 62.0 → 60.2 % | 57.1 → 76.6 % |
| L2 office scan | 60.9 → 61.5 % | 60.9 → 78.3 % |
| L3 photocopy | 59.1 → 63.7 % | 59.5 → 79.4 % |
| L4 stamped | 85.3 → 85.6 % | 70.7 → 89.3 % |
| L5 phone photo | 66.7 → 66.7 % | 59.8 → 80.5 % |
| L6-90 / L6-180 rotated | 57.1 → 55.9 / 60.7 → 60.2 % | 49.3 → 71.2 / 48.7 → 73.7 % |
| L7 scanner's layer | 99.0 → 99.0 % | 100 → 100 % |

Rows, false rows and field accuracy are unchanged at every level, with no regression line: a flag changes no
row. The e2e now reads a clean scan (`tests/fixtures/external-transcript-scan-clean.pdf`, written by
`make-scan-fixture.py`: three of its four rows unflagged, each one's scanned-line strip drawn only when its toggle
opens; the engine scores the fourth line below its floor though it reads it right, and that row's ⚠ says so) and a scanner's own text layer (`tests/fixtures/scanner-layer-transcript.pdf`, byte for byte the bench's
L7 of `external-transcript.pdf` — `npm run ocr-bench -- --levels L7 --only external-transcript --out <dir>` writes
it again: the preview says the reading is the scanner's, and every row is flagged), on Chrome, Safari's engine
and Firefox.

**What the full-ladder check found besides.** Against yesterday's parser (`q4-after2-ladder/`), three regression
lines that item 14 made and its L2 / L5 check could not see: one more false row each on Duke's grading key at
L3 ("LP 2.5" read "LP 2S") and Tokyo's grading page at L3 and L4 ("RE 1", "HPAL 6"). Each was read by item 14's
rule for UCLA's one-digit course numbers alone in their cell; the next commit reads that rule on text layers only.
