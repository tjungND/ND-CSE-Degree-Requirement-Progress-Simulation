# Test data: every file here is synthetic or public — never a student's record

Nothing under `tests/` comes from a real student's transcript, and nothing may (FERPA; the
project rule in `CLAUDE.md`). Every fixture is one of two kinds:

- **synthetic** — invented by a script or by the DGS's own generator: fictitious names, ids,
  courses and grades that never belonged to anyone;
- **public** — a registrar's own published sample transcript, transcript key, legend, template
  or regulation, copied as the registrar prints it (with the registrar's placeholder name and
  id where the document carries one).

If a fixture ever needs the *layout* of a real transcript, the layout is rebuilt synthetically
(`tests/fixtures/make-transcript-pdfs.mjs` shows how) — a de-identified copy of the real file is
never committed. The outputs of the sanitizers in `scripts/sanitize*` (`sanitized-*.pdf`,
`sanitized-scan-*.png`) are git-ignored for that reason, and the de-identified samples the DGS
shared with the maintainer on 2026-09-05 stayed outside the repository, as did the sanitized
line dumps used for regression checks in that session (session scratchpads only).

## What each folder holds

| Where | Count | Kind | Provenance |
|---|---|---|---|
| `fixtures/*.pdf` | 12 | synthetic | Hand-built by `fixtures/make-transcript-pdfs.mjs` (11 PDFs: Notre Dame unofficial and official, undergraduate, combined, Banner two-column, watermarked, external, UC-system, no-lines, other) and `fixtures/make-scan-fixture.py` (the image-only scan). The student is "Jane Q. Student"; every course, grade and date is invented. Regenerate with `node tests/fixtures/make-transcript-pdfs.mjs` and `python3 tests/fixtures/make-scan-fixture.py`. |
| `fixtures/ms-transcripts/` | 48 + `expected.json` | synthetic | The DGS's 48 synthetic master's and combined transcripts (2026-09-20), produced by his own generator with invented names, ids, courses and dates in each school's layout. Each `.json` is the line list the app's PDF layout step read from one synthetic PDF, except that the student's name now prints as "SAMPLE, STUDENT" and the student id as zeros of the same length (DGS 2026-10-27: the generator's realistic names made the files look like real records); `expected.json` is what the parser must return. The synthetic PDFs themselves are not in the repository. |
| `fixtures/public-transcripts/` | 168 + `expected.json`, `sources.json` | public | 93 line lists composed on 2026-09-26 from public registrar sample transcripts, transcript keys, ECTS and credential-evaluator templates (rows composed to the documented layout, "SAMPLE STUDENT" / "000000000" where a name or id would print; only the SJTU and Peradeniya templates carry the rows their publishers printed), and 34 `pdf-*` line lists read by the app's own layout stage from public registrar PDFs later the same day (the ANU sample transcript, whose registrar prints the placeholder "Filanes Filankesov Filankesovich" / 5123456; the University of Vaasa template with `[Student's Name]`; and 32 keys, legends, forms and regulations pinned as producing no course row); and 20 more `pdf-*` line lists on 2026-10-09 (Batch A step 5: the University of Alberta CR/NC sample, whose registrar prints "Sample Two Student" / "Sample One Student"; the Evergreen State College sample RAA with blank name fields, a code-less record; five negatives — Hampshire's key, Western Ontario's back page, the ARUCC legend guideline, Parchment's authentication page kept to the lines the parser must ignore, Algeria's blank MESRS template; and the thirteen McGill synthetic Minerva pages of an MIT-licensed student project, pinned at a commit, whose identities its generator makes up — printed in the committed lines as "SAMPLE, STUDENT", an all-zero McGill ID and permanent code `XXXX00000000` since 2026-10-27 — layout imitations, so no parser rule may rest on them alone); and 21 line lists composed on 2026-10-09 (Batch B step 6, one per layout family in applicant-pool order, each `kind: composed` with the registrar or vendor documentation it follows: Workday Student under UBC's name, Ellucian Colleague (Lesley), CUNYfirst (City College), Oregon's Banner quarter transcript, UCLA's eTranscript, McMaster Mosaic, Western Ontario, Lund's Ladok transcript, SNU, Sabanci, the Ukrainian MON supplement, the Algerian MESRS relevé filled in, IIT Kharagpur's grade card, NIT Tiruchirappalli's consolidated statement, an HEC semester transcript (UET Lahore), an Iranian translator rendering (Isfahan), North South University, Tribhuvan IOE, and three vendor wrappers — Parchment, National Student Clearinghouse, eScrip-Safe — around existing fixtures; placeholder identities only, never an exposed real record; 17 of them on the known-failing list with their Batch B family when added, 14 after step 8's F4–F6 fixes, each entry naming only its open families). `sources.json` names each source (URL; for the PDFs also SHA-256, byte size and line count); the PDFs are not committed. `../public-transcripts-known-failing.json` lists the fixtures waiting on a DGS decision or on a Batch B parser family (each entry names it); their expectations are the truth, the parser catches up. |
| `fixtures/ocr-scans/` | 9 pages + `README.md` | synthetic | One degraded page per level of the OCR benchmark's ladder (2026-10-09, `docs/OCR-BENCHMARK.md`), pinned by `scripts/dev/ocr-bench/pin-pages.mjs` from the generator PDFs only (placeholder identities): each page with its `.expected.json` (truth lines, expected rows, ladder parameters, the page's pixel size, the OCR lines the app's pipeline builds from it) and, for the OCR levels, the engine's `blocks` captured once and trimmed to lines and words (`.blocks.json`), so the pure word-boxes-to-lines stage (`src/transcript/ocr-lines.ts`, OCR step 11) is unit-tested without the engine — `ocr-lines.test.ts` pins each page's reading. `npm run ocr-bench -- --pinned` re-reads them with the engine. |
| `fixtures/rules/` | 4 CSVs | synthetic | Sample tabs of the rules sheet (Courses, Categories, Parameters, ExternalCourses) modelled on the live sheet for the parser and validation tests. Course rules, not student data. |
| `scenarios/` | 71 + `README.md` | synthetic | One invented student per file — program, entry term, GPA, courses, milestones — and the audit result expected of it. No names. `scenarios/README.md` documents the keys. |
| `helpers/student.ts`, `helpers/row-of.ts`, `helpers.ts` | — | synthetic | Builders for invented student records used by the unit tests; `rowOf`, the one-line course-row form both transcript corpora are pinned against (nothing imports it from a `*.test.ts` file — importing a test file runs it). |
| documents written inline in `*.test.ts` | — | synthetic | Minimal transcripts and sheet rows typed into the tests ("Some University", "SAMPLE STUDENT", "CS 500 Topics 3.00 A"). |

## Adding a fixture

- Synthetic or public only. Use "SAMPLE STUDENT" and an all-zero id where a name or id
  would print; never a file name that could carry a student's name. This holds for a generated
  or third-party specimen too: replace its invented name and id before committing the lines, since a
  realistic invented name reads as a real record (DGS 2026-10-27).
- Public material: record where it came from in the folder's `sources.json` (URL, kind; for
  a PDF its SHA-256 and size), and regenerate the line list with the app's own extraction —
  `node --experimental-strip-types scripts/dev/pdf-to-lines.mts sample.pdf > lines.json`
  (or `scripts/dev/ocr-lines.mjs` for an image-only PDF) — so the fixture is exactly what the
  browser would read.
- A real transcript is for the DGS's own testing on his own machine. To report how one reads
  without revealing it, `scripts/diagnose-transcript.mjs` prints shapes only; to share a
  de-identified copy with the maintainer, the sanitizers in `MAINTENANCE.md` — but neither
  output belongs in this folder.

## Replaying the transcript corpora

`npm run replay` runs every line-list fixture of both transcript corpora (`fixtures/public-transcripts/`,
`fixtures/ms-transcripts/`) through the current parser and scores each against its `expected.json` entry with
the one scorer, `scripts/dev/score.mts` (its header comment defines the metric; `replay-score.test.ts`
pins it and asserts its `exact` is exactly what `public-transcripts.test.ts` and `ms-transcripts.test.ts`
decide). The scoreboard says, per corpus and — for the public corpus — per `sources.json` lens and country:
fixtures exact (= the test's pass), row recall (expected rows found, by course id + year) and precision,
cell accuracy for title / credits / grade / term / level over the matched rows, false rows read from
`negative` keys and legends, and the known-failing list's status (`npm run replay -- --corpus public` is
what `scripts/dev/public-status.mts` now runs; `--only <name>` prints one fixture's full diffs). Sample PDFs
live OUTSIDE the repo in `$TRANSCRIPT_SAMPLES` (default `~/degree-audit-samples/`): `public-pdfs/` holds
re-downloaded registrar PDFs (rebuildable from the URLs and SHA-256s in `sources.json`; `--verify` checks
them), `private/` the DGS's own synthetic PDFs and sanitized scans (never named in any committed file),
`bench-out/` the `--out` files. Before a parser change, `npm run replay -- --out before.json`; after it,
`npm run replay -- --baseline before.json` prints every document that got worse first (exit code 1), then
every one that got better. The `--out` file holds counts only, never a document's text.

## Measuring OCR

`npm run ocr-bench` (`scripts/dev/ocr-bench/`, 2026-10-09; dev-only, never in `npm test`) degrades the
generator PDFs and the public registrar PDFs down a seeded ladder (clean raster, good scan, office scan,
photocopy, stamped, phone photo, turned, a poor scanner text layer), runs the app's real OCR path on every
level and scores it with the same scorer as the replay plus line CER, flag precision/recall and seconds
per page — method, seeds and every measured change in `docs/OCR-BENCHMARK.md`, the commands in
`MAINTENANCE.md` "Measuring OCR". Two tests guard it in `npm test`: `ocr-bench-score.test.ts` pins the
bench's own scoring pieces (Levenshtein, line CER, flag counts), and `ocr-assets.test.ts` fails when
`public/ocr/` grows past 7.5 MB — the download cap a second engine or a bigger model must clear with the
DGS first (plan step 14, the engine gate). `ocr-lines.test.ts` pins the pure stage (word boxes → lines)
on the nine pages of `fixtures/ocr-scans/` without the engine.
