# Maintenance guide — for the next DGS

> **Start with [`README.md`](README.md)** — the practical guide to running this app (Track A:
> sheet edits without code; Track B: changing the app with Claude Code or Codex). This file holds
> the deeper technical notes it refers to.

You inherited a small static web app that lets CSE graduate students self-check their standing
against the Graduate Handbook (§3 MSCSE, §4 Ph.D.). You should almost never need to touch code:
**policy lives in a Google Sheet you edit; the handbook's structure lives in code.**

```
Google Sheet (you edit)  ──publish-to-web CSV──►  static web app (student's browser)
         │                                                ▲
         └── 6-hourly GitHub Action ─► data/snapshot.json ┘ (offered if the fetch fails; dates the rules)
```

Student data never leaves the student's browser (localStorage + a save-to-file button).
Nothing about students is stored anywhere you can see. There is no server.

## The three things you'll actually do

### 1. A course changes (new course, retired course, counts differently)
Open the Google Sheet **CSE-Degree-Checking-Rules** (named CSE-Degree-Audit-Rules until 2026-09-05) → `Courses` tab.
- New course: add a row. `counts_toward_mscse` / `counts_toward_phd` ∈ `yes | no | dgs_approval | adgs_approval`
  (`dgs_approval` / `adgs_approval` = counts provisionally, the app tells the student to get sign-off; blank = the
  app says "needs DGS review"). Tag `core_area` (§4.4.1) and `category_group` (§4.4.2) if it
  qualifies; a course that belongs in every group names all five (`alg, hcc, arch, dsai, sys`).
- Retired course: set `active` to `no` (hides it from the picker; still recognized when typed,
  for students who took it years ago). Do not delete rows.
- A rule *changes* from some term: **add a new row** with the later `rules_effective_term` instead of
  editing the old one. The app applies, per course a student took, the newest row whose
  `rules_effective_term` is not after that course's term (the oldest row applies retroactively).
  Set the new row's term **before** editing its policy columns: two rows with the same course and
  term are a duplicate, the last one wins for every student, and both pages warn (README § A3).
Students see edits on their next page load (~5 minutes for Google to republish).

### 2. A number in the handbook changes
`Parameters` tab: edit the value, update `handbook_section`. That's it — the cards' titles read
the value too (since 2026-10-12, policy review round 4, P4-data-5); the quoted handbook sentence
under Relevant Policies stays the handbook's words until the handbook PDF changes.
**Caveat:** the app audits everyone with the current numbers — there is no per-cohort
grandfathering of Parameters. If a change must only apply to new students, that needs a code
change; ask for it.

### 3. A new handbook year
1. Put the new PDF in `docs/` (keep the old one) and update the path in `CLAUDE.md`.
2. Ask Claude Code: *"Diff §3 and §4 of the new handbook against the old one; list every rule
   that changed; propose Parameters/Courses edits and any code changes."*
3. Run `npm run handbook-text` and commit `src/ui/handbook-text.ts`: the "CSE §" chips on both
   pages show the handbook's own text on hover, read from `policy-sources/CSE-Graduate-Handbook-live.pdf`
   (DGS 2026-10-05). `tests/handbook-text.test.ts` fails while the two disagree.
4. Update the handbook edition and PDF link in `src/ui/handbook.ts` (one place — the page header,
   footer and copied summary read from it), then search the repo for the old edition string.
5. Record any interpretation calls in `docs/DECISIONS.md` (that file is the memory of every
   judgment call ever made — read it before overruling one).

## Sheet items (all clear as of 2026-09-03)

The one-time setup is done: the seven Parameters rows the engine needs are in the sheet, and the
three mistyped `Courses` rows (`CSE 98900`, `CSE 68900`, `CSE 87701`) are fixed. `CSE 44901` was
decided on 2026-09-03 (dgs_approval for both degrees; kept inactive so students who took it
years ago can still enter it), and the last active rows with blank verdicts were filled the
same day (both verified against the live CSV). The sheet's own README tab was fixed the same
day too (its "How the app reads it" cell now names `data/sheet-urls.json` and includes
ExternalCourses in the publish list) — nothing sheet-side is open. The app's
diagnostics panel (bottom of the input column) lists every sheet problem whenever it loads.

The Courses tab's `category_group` cell may name SEVERAL groups since 2026-09-08 — `hcc;dsai` means
the course may fill either one and the student picks which; a course that belongs in every group
names all five. `ineligible` still means none. A typo in one code is reported and dropped; the
other codes on the row keep working. (`any`, the old shorthand for every group, was retired on
2026-09-18 — a cell that still says it is reported as a code the Categories tab does not define.)

Since 2026-09-09 the Courses tab has `offered_now` and `offered_next` (`yes` / `no` / blank). They
are the DGS's word on the current and next semester's schedule, where `typically_offered` is a
pattern from past years. The course-rules page shows them as two CARDS at the top, "Offered this semester" and "Offered
next semester", each listing its courses with every attribute the table carries except "Typically
offered", "DGS reviewed" and the notes; there is also a filter on the table itself. No column is
added to the table, and nothing else in the app reads them. A card whose column is entirely blank
says "Not released yet." instead of showing an empty list, and the filter appears only once at
least one course carries a value.

**Each row's `last_offered` is what dates them** (since 2026-09-14; until then one Parameters
stamp, `current_semester`, dated the whole sheet — that key is no longer read and its row may go).
`last_offered` means **the last term the course was actually offered** (DGS, 2026-09-18). The
current semester comes from Notre Dame's date, so the card headings are always right; what the page
has to know is whether a row's `offered_now` / `offered_next` were written for that semester, and
the definition answers it: a course running now was last offered now.

| the row's `last_offered` is | what the page shows for that row |
|---|---|
| this semester | both columns as recorded |
| an earlier semester | nothing — the row describes a schedule that has passed, and its "next" names a semester nobody can identify |
| a later semester | nothing — a course cannot last have been offered in a term that has not happened; check the cell |
| not a term, or blank | nothing |

Each of those "nothing" rows is counted, with its reason, in the line under the two cards, so a
stale schedule is visible rather than quiet. The worst a late update can do is show less than it
could, never something false. **Fill the three cells together each semester** — set `last_offered`
to the semester you are describing at the same time as `offered_now` / `offered_next` — and a stale
`yes` can never outlive its date.

One consequence worth knowing (review R-1, 2026-09-18): a course that does NOT run this semester
but is already timetabled for the next one cannot be shown on the "next semester" card, because
its honest `last_offered` is some earlier term and the page has no way to tell a freshly written
`offered_next` from one left over from last year. If that case matters, the sheet needs a separate
"schedule last updated" column — a schema change, so ask the DGS first.

Since 2026-09-08 a university whose transcript prints its name only in the letterhead IMAGE can
still be recognised from an acronym in the text: `NAME_ONLY_IN_IMAGE` in
`src/transcript/external.ts` holds one line per school ("JHU" → Johns Hopkins University, "UCSD" →
University of California, San Diego), tried when nothing in the text names a university outright.
The student sees the name pre-filled but editable, with a note saying it was worked out from an
abbreviation, so a wrong guess can be corrected before the courses are added. Add a line there if another school turns up with
the same problem — and write the school's real name, since that is the key the ExternalCourses tab
is matched on (matching ignores case). If the tab already has rows for that school, use the name in
their `university` cell exactly: those names were read from official transcripts and are never
renamed (DGS 2026-10-07), so any change to how the reader extracts a name must keep reading them.

Since 2026-09-09 a student's review request emits ONE paste-ready row per course, not per attempt:
a course taken several times (a master's project, thesis credits) used to become several identical
rows, and since the last row wins, earlier rulings were shadowed by later blank ones. The course
details in the same email still list every attempt. If the tab already holds duplicates, the
diagnostics list them — keep the row you want and delete the rest.

Notre Dame coursework a student took as an UNDERGRADUATE counts toward their graduate degrees
(Graduate School, 2026-09-10): 60000-level and above in full — beyond §5.2's twenty-four, and not
transfer credit at all — and below that up to six credits, inside §4.2's own allowance. Nothing below
the 40000 level counts, and neither does a non-CSE course below 60000. The one hard limit: no course
counts toward three degrees, so a course a student spent on both their B.S. and their MSCSE counts
nothing in the Ph.D.

The app cannot know which degrees a course was spent on, so it asks the student, per course, in the
coursework table — and only where the answer changes something: their own Notre Dame undergraduate
coursework, and only if they hold a Notre Dame master's. Until they answer, the course counts nothing
and says so. Their answers are on the self-check page and in the review request, so you can correct
one that looks wrong. On the MSCSE side, coursework shared with the bachelor's is capped at
the Graduate School's 6 credits (§3.5; Academic Code §4.6) — `BS_SHARED_CREDITS_MAX` in
`src/engine/allocate.ts` since 2026-10-07, no longer a Parameters row.

Since 2026-09-09 the app can tell a CSE course from a non-CSE one on ANOTHER university's
transcript, which is what §4.2's nine-credit limit on courses "taken from a department other than
CSE" needs. Two places say so, and both are yours: the Parameters key `cse_subject_codes` lists the
subject codes that mean CSE (`CS; CSCI; COMPSCI; CSE; CMSC; EECS; CSYE; ECE; 198; 332` — a number is the subject
of a school:subject:course code, Rutgers' `16:198:507` → `198`, Computer Science, and `332`, its Electrical and
Computer Engineering, DGS 2026-10-16), and an
ExternalCourses row's `is_cse` cell (`yes` / `no`) settles one course the list should not decide.
`ECE` is listed on purpose: the department reads "a department other than CSE" as "outside
computing", so an ECE course is inside CSE whatever its topic (DGS 2026-10-04) — give a single ECE
course ruled otherwise `is_cse = no`. A code the list does not name counts against the nine credits. If
you delete the parameter (or blank its cell), no transferred course can be placed by its code, so
every transferred course whose ExternalCourses row has no `is_cse` cell is held for you to decide
instead of counting (since 2026-10-03) — nearly all of them today; the diagnostics box says so.

Since 2026-09-09 the ExternalCourses tab decides §5.2 transferability per PROGRAM: `transferable_PhD`
and `transferable_MSCSE`, each taking `yes` / `no` / `dgs_approval` / `adgs_approval` / blank. The app
reads whichever matches the student's own program, so the same course can be pre-approved for a
Ph.D. student and need an approval for an MSCSE one. A sheet still carrying the single
`transferable` column has it applied to both programs, so nothing breaks mid-rename. The two
approval words are one case for now and both tell the student "needs DGS approval"; the sheet's own
word is preserved in the parsed rule, so the MSCSE message can name the ADGS later without touching
the sheet again.

Since 2026-09-08 the ExternalCourses tab's `transferable` column takes a third value,
`dgs_approval`, beside `yes` and `no`: the course is outside the usual CSE ground but can still
transfer when it is relevant to a particular student's dissertation, so the DGS decides it one
student at a time. The app treats such a course as a transfer CANDIDATE — it stays in the students'
review request as an open decision; it is never pre-approved, and the Grad Admin's processing
request ignores it until the student attests that the approval came through. The page never asks
the student to argue that the course serves their research — that is settled between the advisor
and the DGS (DGS 2026-09-08). Use `yes` for a course any student may transfer; use `dgs_approval`
when the answer depends on the student.

Each other university's credit system (`quarter` / `semester` / blank; `trimester` since
2026-09-12, × 0.88) is set ONCE in the **Universities** tab, one row per university (DGS
2026-10-10; from 2026-09-08 it was a `credit_system` cell on every ExternalCourses row, which the
app reads now only from a sheet or saved copy without a Universities tab, and otherwise reports
as no longer read). Every course from that university, ruled on or not, converts from
the credits printed on the student's transcript (by 0.66 and 0.88, the DGS Handbook's §3.14 pro-rata
table — Parameters rows from 2026-09-12, constants in `src/data/external.ts` since 2026-10-04, as
Graduate School numbers; README § A5b) — the way to handle a
course whose credits vary from term to term. `nd_credits` still means a FIXED value for one course
and overrides the conversion.

Since 2026-09-06 the ExternalCourses tab's `satisfies_core_area` also accepts `none` ("decided: no core
area" — it stops a core-sounding title from staying in the review request); blank still means not
decided yet, and a course with a blank-verdict row stays in the request (`data/README.md`). When two
rows name the same university + course, the LAST row wins (DGS 2026-09-06 — a corrected row pasted
below an old one takes effect; the diagnostics still warn so the older row can be deleted).

One-time setup for the external-transcripts feature — DONE 2026-09-02: the **ExternalCourses**
tab exists in the rules sheet (header row in `data/README.md`; sample rows in
`data/external.sample.csv`), is published to the web as CSV, and its URL is in
`data/sheet-urls.json` (`external`). The app, sync and snapshot all treat the tab as
optional, so clearing that URL turns the external rulings off without breaking anything.

The optional Parameters row `rules_effective_date` (`2026-09-01` format) replaces the automatic
"The course rules here were last updated on <date>" half of the dated line on both pages with
"are effective as of <date>"; add it only when the rules should carry a different date than the
last edit (see "Sync" below).

## Sync, deploy, test

- **Sync (every 6 hours)**: the `sync-sheet` GitHub Action fetches the published sheet and,
  only when its content has changed, rewrites `data/snapshot.json`, commits it, and starts the
  `deploy` workflow (by `workflow_dispatch` — a push made with the Action's own token never
  triggers `on: push`). Unchanged content leaves the file untouched on purpose: the snapshot's
  `syncedAt` is therefore the moment the current rules were first seen, and that is the date both
  pages print as "The course rules here were last updated on …" (Google sends no Last-Modified
  header for published CSVs — verified 2026-09-01 — so this is the only zero-setup source); the
  sentence ends ", and are up-to-date as of <the day the page read the sheet>". While the live
  sheet is newer than the deployed copy the first half says "were updated after <date>" and the
  diagnostics panel explains; that state should last at most ~6 hours. Run the sync by hand: repo → Actions →
  sync-sheet → Run workflow; locally `npm run sync-sheet` (then commit the snapshot if it changed).
  The build writes `dist/data/snapshot.json` (the committed file) and `dist/data/snapshot-meta.json`
  (its date and one fingerprint per tab, computed by `vite.config.ts`) — the pages fetch the meta on
  every load and the snapshot only on the saved-copy button; the sync Action still commits only
  `data/snapshot.json`, and the dev server serves the same two paths (2026-10-22).
- **Size**: after a change that could move a lot of code (a new dependency, a moved module, a lazy
  chunk), run `npm run build && npm run bundle-report` and paste the two "first load" totals into the
  commit message — 2026-10-22, after the review's weight batches: self-check 709 KB / 213 KB gz,
  course-rules page 131 KB / 44 KB gz.
- **Styles are three sheets** since 2026-10-22: `src/style-base.css` (both pages), `src/style-app.css`
  (the self-check), `src/style-courses.css` (the course rules). Put a new rule where its page is; when
  unsure, in base. After moving a rule between sheets, run `npm run e2e` in all three engines and
  compare the screenshots pixel for pixel with a run of the previous build — the one rule misplaced
  during the split (`.pill.small`) showed only as a pill one size larger in the Next steps box.
- **A stalled e2e run**: the Chrome driver's DevTools `send` has no timeout; once (2026-10-22) a run hung
  at the plain-page reopen after the `?embed=1` check although the tab answered a second connection at
  once. If a run stalls past ~3 minutes with its log stopped, kill `scripts/e2e/run.mjs`, the `vite
  preview` and the headless Chrome on its ports, and rerun.
  **GitHub pauses scheduled workflows in a public repository after 60 days without repository
  activity** and emails the owner — re-enable from the Actions tab (Actions → sync-sheet →
  "Enable workflow"). If a run fails at `npm run sync-sheet` with a timeout: the very first run
  (2026-09-01) did — Google left the runner's request hanging for 30 s — so the script now
  fetches the four tabs one at a time with three attempts and a 60 s timeout, and the workflow
  logs a `curl` reachability line per tab just before it. Look at those lines: an `HTTP 200` in
  a few seconds means the hang was transient (re-run the workflow: Actions → sync-sheet → Re-run,
  or `gh run rerun <run-id>`); a timeout there too means Google is not answering GitHub's
  runners at all, and the fallback is to run `npm run sync-sheet` on your own Mac and commit
  `data/snapshot.json` (the pages then date the rules from that commit).
- **Deploy**: every push to `main` rebuilds and redeploys GitHub Pages (`deploy` Action).
  One-time repo setting: Settings → Pages → Source: **GitHub Actions**. A WordPress page embedding
  the course rules points at `…/courses.html?embed=1` and needs no separate deploy — it is the same
  live page (README § "Embedding these pages in a WordPress page"). GitHub Pages sends no
  `X-Frame-Options` or `frame-ancestors`, which is the only reason framing works at all; if a future
  host ever adds either header, every embed breaks at once and the fix is on the host, not here.
- **Tests**: `npm test` (one JSON scenario per student case in `tests/scenarios/`
  plus engine/loader/transcript units). `npm run build` type-checks and bundles. Both must pass
  before merging anything; `npm run e2e` additionally drives the built app in headless Chrome
  (screenshots land in `.e2e-out/`, including the public course-rules page `courses.html`) — run
  it for UI-visible changes. Since 2026-09-05 the e2e run also gates accessibility: axe-core
  (a devDependency used only by the e2e harness) must report zero WCAG 2.x A/AA violations on
  both pages, the opening notice must behave as a modal dialog, keyboard focus must survive a
  change (the page re-renders), and nothing may scroll sideways at a phone width (390 px). If a
  UI change trips one of these, fix the page rather than the check — each one pins a defect
  students actually hit. `E2E_ONLY=access npm run e2e` runs just that driver. Since 2026-09-06
  `E2E_BROWSER=webkit npm run e2e` runs the same drivers on Safari's engine (Playwright's WebKit
  build — `playwright-core` is a devDependency, the browser a one-time `npx playwright-core
  install webkit` per Mac) with screenshots in `.e2e-out/webkit/`; run it too whenever layout
  changed, since Chrome alone missed a Safari-only bug that day. Since 2026-10-10
  `E2E_BROWSER=firefox npm run e2e` runs them on the installed Firefox too (headless, a
  throwaway profile, WebDriver BiDi — `scripts/e2e/firefox.mjs`, nothing to install), with
  screenshots in `.e2e-out/firefox/`; `E2E_PORT` / `E2E_DEBUG_PORT` move the ports so two
  engines can run at once. `E2E_BROWSER=opera npm run e2e` (= `npm run e2e:opera`, 2026-10-10) runs them in the installed
  Opera — Blink, Opera's own Chromium build — over the same DevTools Protocol as Chrome (`OPERA_BIN`
  overrides the path), headless, screenshots in `.e2e-out/opera/`. `E2E_HEADED=1` runs Chrome or
  Opera in a real window instead (the drivers' scripts then count as user gestures, or a
  clipboard write waits on a permission); `E2E_BLINK_PREFS='<json>'` starts it with browser
  preferences, e.g. Opera's “Force dark pages” (the JSON is in `scripts/e2e/run.mjs`) — under it
  the page must show its own dark theme on Auto (`src/ui/theme.ts` `browserForcesDark`). Also since 2026-10-10 `E2E_BROWSER=safari npm run e2e` (=
  `npm run e2e:safari`) runs them in REAL Safari through `safaridriver` (classic WebDriver,
  `scripts/e2e/safari.mjs`; nothing to install), screenshots in `.e2e-out/safari/`. One-time per
  Mac: Safari → Settings → Advanced → "Show features for web developers", then Settings →
  Developer → "Allow remote automation". It is not headless: Safari's striped automation window
  opens and must stay visible — a locked or sleeping screen draws nothing, and the run stops at
  once saying so — and clicking into it ends the session. Safari's window is never narrower than
  336 px, so the 320 px phone checks measure 336 px (the run notes it). Safari follows the Mac's
  light/dark setting. One Safari run at a time. Since 2026-10-10 the transcript
  driver also checks, on both engines, the OCR preview's scanned-line strips (drawn at once on a
  ⚠ row, gone after Add, never in the saved record; a crop at 390 px) and a transcript that prints
  no course numbers (`tests/fixtures/codeless-transcript.pdf`: the empty, required id box keeps the
  row unticked and Add refuses until an id is typed); since 2026-10-11 (item 13) also a clean scan
  (`external-transcript-scan-clean.pdf`: an unflagged row's strip drawn only when opened, a flagged
  row's ⚠ saying why) and a scanner's own
  text layer (`scanner-layer-transcript.pdf`, the bench's L7 of `external-transcript.pdf`: every row
  flagged as the scanner's reading). Every fixture PDF comes from
  `node tests/fixtures/make-transcript-pdfs.mjs` (the scan from `make-scan-fixture.py`); the
  generator rewrites the others byte for byte, so a new fixture shows up in `git status` alone.
  When a student finds a
  wrong verdict: add a scenario JSON reproducing it, fix, keep the scenario forever.
  Since 2026-10-11 `tests/verdicts.json` pins every row of every scenario (status, the pill's
  words, credit count, deadline state): an engine change that moves any of them fails `npm test`
  with the list of changed rows. Show that list to the DGS; once approved, `npm run verdicts --
  --update` rewrites the file, and it is committed with the change (`tests/scenarios/README.md`).
- **Stamps and `npm run reproduce`** (2026-10-11). Every result says what it was checked with:
  the rules' fingerprint (`src/data/fingerprint.ts` — eight hex characters from the five tabs'
  text, normalized as the rules' dating normalizes it), live or saved copy, the rules' date, the
  handbook edition (`src/ui/handbook-text.ts`) and the build (`vite.config.ts` puts the git
  commit and its date into `__APP_BUILD__`; tests and scripts read "dev"). One line,
  `src/ui/stamp.ts`, on both footers, the print header, the three emails and the saved file —
  which also records the date checked and every row's verdict. `npm run reproduce -- <saved
  file>` walks `git log -- data/snapshot.json` for the matching fingerprint (also without an
  optional tab, in case one failed to load for the student), re-runs `audit()` on the saved
  date and exits 1 if any row reads differently. A snapshot's fingerprint changes whenever its
  content does, so nothing has to be kept in step by hand; never rewrite or squash the
  snapshot commits — they ARE the record of which rules a student saw.
- **Browsers** (cross-browser review, 2026-10-10). The pages are built for Vite's default floor —
  no `build.target` in `vite.config.ts`, so Safari 14, Chrome 87, Firefox 78 — and verified in
  Chrome, Safari's engine (WebKit) and Firefox; Edge, Opera, Brave and Samsung Internet are
  Chromium, and every browser on an iPhone or iPad is Safari underneath. Two things the build
  does NOT catch, so keep them out by hand:
  - **No regex lookbehind in `src/`.** esbuild cannot lower one for Safari before 16.4 and,
    instead of failing, rewrites it as `new RegExp("…")`, which throws there at run time. Two
    of them ran as the shared module loaded and left both pages BLANK on Safari 14–16.3
    (iOS 15 and 16.0–16.3 devices included) until 2026-10-10; `tests/browser-support.test.ts`
    fails on one now. Write the check out in code (see `otherNotreDameSpans` in
    `src/transcript/nd-markers.ts`).
  - **pdf.js is imported from its LEGACY build** (`pdfjs-dist/legacy/build/pdf.mjs` and its
    worker, in `src/transcript/pdf.ts` and `ocr.ts`). The modern build calls
    `Promise.withResolvers` unguarded, so every transcript import failed — blaming the file — on
    Safari before 17.4, Chrome before 119 and Firefox before 121. The legacy build reads the same
    text and lowers the transcript-import floor to Safari 16.4, Chrome 94, Firefox 93 (OCR needs
    WebAssembly SIMD, which those versions have). The same test pins every pdf.js import in
    `src/`. Below that floor a failed import says the browser is too old to read a PDF and to
    update it or add the courses by hand (`src/ui/pdf-support.ts`), instead of blaming the file.
  A host that adds a Content-Security-Policy must allow `'wasm-unsafe-eval'` for the opt-in OCR
  (the engine is WebAssembly); without it OCR says it cannot run here, at once.
  Left as they are, cosmetic only: `:has()`, which Firefox before 121 (ESR 115) lacks, still
  styles the opening notice's answers (the chosen one's highlight and focus ring — the radio dot
  still shows it) and three layout details of the compact transcript preview (its Level header,
  a separator dot, one-line rows that do not wrap). Real Safari can be automated only after
  `safaridriver --enable` (an administrator's password, once per Mac); the harness uses
  Playwright's WebKit build instead, which is Safari's engine but not Safari itself.
- **Transcript replay** (2026-10-09): `npm run replay` scores every pinned transcript fixture (the 168
  public line lists and the 48 synthetic master's ones) and any sample PDFs kept outside the repo
  through the current parser, and prints a scoreboard — fixtures exact (the test's pass), row recall
  and precision, cell accuracy per field, false rows read from keys and legends, the known-failing
  list's status — per corpus and, for the public corpus, per lens and country. Sample PDFs go in
  `~/degree-audit-samples/` (or `$TRANSCRIPT_SAMPLES`): `public-pdfs/` for re-downloaded registrar
  PDFs (`--verify` checks their SHA-256 against `tests/fixtures/public-transcripts/sources.json`),
  `private/` for your own synthetic PDFs and sanitized scans (never named in a committed file),
  `bench-out/` for the numbers. Save the numbers before a parser change (`npm run replay -- --out
  before.json`) and compare after it (`npm run replay -- --baseline before.json`): regressions print
  first and make the exit code 1. `tests/README.md` has the details; the scorer is
  `scripts/dev/score.mts` and the runner `scripts/dev/replay.mts`.
- **For AI coding sessions**: `CLAUDE.md` holds the project rules (Claude Code reads it
  automatically; Codex reads `AGENTS.md`, which points to it); `docs/CLAUDE-HANDOFF.md` is the
  context capsule (design decisions, invariants, recipes); `.claude/skills/run-app/` teaches
  Claude Code to launch and screenshot the app.
- **Published-CSV URLs** live in `data/sheet-urls.json` (the only file to edit if the sheet is
  ever re-published or replaced). Its `sheet_edit_url` is the spreadsheet's own link, shown on
  both pages with a "faculty only" note (`src/ui/sheet-source.ts`, 2026-09-04) — the sheet is
  shared with faculty, not students, who see the same rules on `courses.html`. Moving the sheet
  between Drive locations changes none of these addresses: the file id, the published `/d/e/…`
  token and the tab gids all survive a move (verified on 2026-09-21, My Drive → the "CSE Department
  Adminstration: Graduate Programs" shared drive, all four tabs still served anonymously). Only
  unpublishing and re-publishing, or replacing the file, changes them.

## A transcript that will not import

Students (or you) may hit a PDF the parser reads badly — too few courses, none, or a
false "this looks like a Notre Dame transcript". You cannot send the PDF to an AI tool
(FERPA), but you can share its SHAPE. With the repo checked out and `npm install` done:

    npm run diagnose -- /path/to/transcript.pdf

prints only structure — per-page run counts, how many runs were dropped as a text
watermark, whether a page was read as two columns, how many course rows the parser
accepted, and every line with letters replaced by a/A and digits by 9 (`AAAAAAA 999 |
Aaaaaa Aaaaaaaa | 9.99 | A`). No name, id, course, title, grade or date survives; a tiled
watermark phrase is shown verbatim only when it names an institution. Since 2026-10-15 it
reads the PDF exactly as the app's own pdfjs opens it (and says where a read with pdfjs's
standard-font folder differs — the developer tools' read until that day; since then they read
as the app does too), masks letters of every script, says whether the app would read it as a
scanner's text layer, and says what the Previous Undergraduate row does with it — "the
preview opens…", "REFUSED as still in progress", "no text layer: OCR offered" … — with
the line numbers of the rows it read without a final grade. Paste that output
into your Claude Code / Codex session and describe the university; the layout logic lives
in `src/transcript/layout.ts` (columns, watermarks) and the row patterns in
`src/transcript/external.ts`. Add an invented fixture in the same shape to
`tests/fixtures/make-transcript-pdfs.mjs` with every fix (see `banner-transcript.pdf`).

When shapes are not enough, a **de-identified copy** of the transcript can be shared instead —
it keeps the layout the parsers react to and removes the record:

    node ~/degree-audit-app/scripts/sanitize-transcript.mjs "transcript.pdf"   # system-generated (text) PDF
    python3 ~/degree-audit-app/scripts/sanitize-scan.py "scan.pdf"             # scanned / photographed PDF or PNG/JPG

Both can be run from the folder that holds the transcripts (they find the repo from their own
location; quote file names with spaces). `npm run sanitize -- "<full path>"` does the same but
only from inside the repo folder, because npm needs its `package.json`. Output lands next to the
input as `sanitized-<seed>.pdf` (the scan tool: `sanitized-scan-<tag>.pdf` plus one PNG per
page) — never under the input's own name, because transcript files are usually named after the
student and a file name travels with the file (2026-09-05; rename older `*.sanitized.pdf`
outputs before sharing them). A whole folder:
`for f in *.pdf; do node ~/degree-audit-app/scripts/sanitize-transcript.mjs "$f"; done`.

The text tool rebuilds the PDF with every text run at its original position, width and
rotation, but names, addresses and titles become random letters (same length and case),
student/ID numbers become random digits, every year shifts by one random offset, dates' days
change, e-mail local parts change (domains stay), letter grades become other grades (always on a
common scale — never A+ or D±), and course numbers keep only their first digit. Since
2026-10-11 the copy still ADDS UP: each course row's quality points are its new grade's
(credits × points — the old figure gave the original grade away), and a totals line keeps its
hours (sums of credits the copy keeps anyway) while its quality points and GPA are recomputed
from the rows of its term, its level or the whole record — so the import's own check of credits
and GPA against the printed totals can be tested on the copy. A totals line whose rows do not add
up to its GPA hours (a layout the tool does not read) and any free-standing GPA stay random; the
tool's report counts both. Structural words
(term names, INSTITUTION CREDIT, Ehrs/GPA labels, column headers), subject codes (`CS`,
`COMPSCI`), credit values and lines naming an institution (watermarks included) stay, so the
app reads the copy the way it read the original. `--keep-titles` leaves course titles readable —
only when you judge that safe. The scan tool OCRs each page with the app's own bundled engine
(no tesseract install; Pillow required, PyMuPDF for PDF input), applies the same rules, paints
over every changed word with the surrounding paper and redraws it at the same size, and leaves
all other pixels — scan noise, rules, stamps — untouched; output is PNGs plus an image-only PDF.

**Both tools print every word or run they kept verbatim, and the scan tool cannot see text
OCR failed to read.** Look at that list and at every output page before sharing anything; the
outputs are git-ignored (`sanitized-*.pdf`, `sanitized-scan-*.png`, and the older
`*.sanitized.pdf` / `*.sanitized-p*.png` names) so they are never committed by accident. You
remain the judge of what leaves your computer. The tools preserve page rotation, so a landscape
transcript sanitizes to a landscape copy the app reads the same way (2026-09-05).

## Which reading errors matter

`npm run audit-impact` (2026-10-11, DGS item 14) checks, for every document in the line-list
corpora, the degree check twice — once with the transcript's true rows, once with the rows the
reader read — and lists the documents whose misreads change a requirement's verdict or the
transfer credit counted, most impact first; `-- --ocr <bench run>` adds a bench run's saved OCR
reads, `-- --only <name>` prints every changed row. Fix in that order: a misread that moves no
verdict still shows the student a wrong row, but it can wait behind one that changes the check.

## Measuring the Notre Dame import

Since 2026-10-11 (DGS item 12) the Notre Dame transcript reader (`src/transcript/parse.ts`) has a
corpus of its own, `tests/fixtures/nd-transcripts/`: the generator's five Notre Dame PDFs read
through the app's layout stage, plus the invented insideND and Banner line lists from the tests
(rebuilt with `node --experimental-strip-types scripts/dev/make-nd-corpus.mts` after the fixture
PDFs change; `expected.json` is the generator's own data, reviewed by hand). `npm test` pins it
exactly (tests/nd-corpus.test.ts), and the replay scores it field by field — rows, title,
credits, grade, term, UG/GR level, then isNotreDame, the cumulative GPA and each level's, the
entry term and the degrees awarded:

    npm run replay -- --corpus nd

A sanitized REAL Notre Dame transcript can be measured the same way without entering the
repository: put the sanitized PDF in the outside PDF folder (`~/degree-audit-samples/public-pdfs/`
or `--pdfs <dir>`) with an `expected.json` entry carrying `"isNotreDame": true` and the fields
above; the replay then reads it with the Notre Dame parser. The fixture PDFs' printed totals now
add up to their rows (2026-10-11), as a real transcript's do.

## Measuring OCR

The opt-in OCR path (scanned external transcripts, `src/transcript/ocr.ts`) has a benchmark of
its own, `scripts/dev/ocr-bench/` (2026-10-09; dev-only, never part of `npm test`; method and
baseline numbers in `docs/OCR-BENCHMARK.md`). It takes clean documents — the generator PDFs in
`tests/fixtures/`, the public registrar PDFs kept outside the repo in
`~/degree-audit-samples/public-pdfs/` (rebuilt from `sources.json` with `--fetch`, each verified by
SHA-256), optionally line-list fixtures rendered to pages — degrades them down a seeded ladder
(L0 clean raster … L5 phone photo, L6 rotated, L7 a poor scanner text layer; Pillow + numpy, so
`python3 -c "import PIL, numpy"` must work), wraps every level as an image-only PDF, runs the
app's real path on it (pdfjs at the app's own per-page scale — the scan's resolution between
216 and 300 dpi since OCR step 12 — → the bundled Tesseract in `public/ocr/` → the word boxes
through `src/transcript/ocr-lines.ts` and the layout stage → the parser) and scores it with the
replay's scorer plus line CER, flag precision/recall and seconds per page.

    npm run ocr-bench -- --quick                                   # one seed per family × L0/L2/L5, about a minute
    npm run ocr-bench -- --quick --out ~/degree-audit-samples/bench-out/ocr-before-quick     # BEFORE a change, same code
    npm run ocr-bench -- --quick --baseline ~/degree-audit-samples/bench-out/ocr-before-quick # after it: the deltas
    npm run ocr-bench -- --families generator-external,generator-nd,generator-scan,public-pdf --levels L2,L5   # the medium set, ~15 min
    npm run ocr-bench -- --levels L0,L1,L2,L3,L4,L5,L6,L7 --families generator-external,generator-nd,generator-scan,public-pdf --dpi 200   # the full ladder, ~45 min
    npm run ocr-bench -- --full          # adds the synthetic renders; prints the estimate (hours); add --yes to run it, attended
    npm run ocr-bench -- --pinned        # the nine committed pages in tests/fixtures/ocr-scans/
    npm run ocr-bench -- --compare <after-dir> --baseline <before-dir>   # the deltas of two finished runs
    npm run ocr-bench -- --levels L2,L5 --families … --reparse <run-dir> --out <dir>   # a PARSER change: re-score a run's saved OCR lines, no engine, seconds
    npm run ocr-bench -- --levels L7 --l7 exact|app|flag-only --out <dir>   # L7, a scan with its scanner's own text: as the app reads it (app, the default — OCR-grade since Batch C (6)), as before (exact), or flagged only

Every A/B of an OCR change (`--config knobs.json` holds the engine knobs: scale, PSM, dpi,
interword spaces, threshold, invert, rotateAuto, border, rotationTrial) is `--quick` — and, for
a verdict, the medium set: two step-12 verdicts reversed between the two — against a run made
on the SAME parser code just before the change (a stale baseline confounds: the 11:05 run
`ocr-baseline-20261009` predates Batch B's parser fixes, step 10's lesson); `--baseline` prints
the per-level deltas with regressions first and exits 1 on any, and a worse false-row count on
the negatives is a regression whatever the rows gained. Output goes under
`~/degree-audit-samples/bench-out/ocr-<date>/` (`results.csv`, `results.md`, `results.json`,
and every degraded page) — never under the repo. Your own scans go in with `--seeds-dir <dir>`
(PDFs plus an `expected.json` in the corpus shape); they are named `private-NN` in every
output and appear in `results.md` as one aggregate line, and nothing about them belongs in a
committed file. `tests/ocr-assets.test.ts` fails when `public/ocr/` grows past 7.5 MB — the cap
a second engine or a bigger model must clear with you first.

## Repo peculiarities you should know

- **`public/ocr/` holds the self-hosted OCR engine** (tesseract.js v7 worker, SIMD+LSTM WASM
  core, English best_int model — ~7 MB committed on purpose): the app promises no external
  network calls, so these may NEVER be swapped for CDN URLs. They load only when a student
  explicitly chooses OCR for a scanned external transcript (English-only, opt-in). Update
  recipe in `docs/CLAUDE-HANDOFF.md`.

- Tests run on **node's built-in runner** (`node --test`; Node ≥ 24 runs the TypeScript
  directly) — no test-framework dependency. `npm run dev` gives a live-reload dev server;
  `npm run build && npm run preview` serves the production build.
- **Never put a `:` (colon) in any parent folder's name.** This repo once lived under
  `FY26-27 (DGS: Taeho Jung)` and the colon silently broke npm's script PATH and vite's module
  loader; the folder was renamed to fix it. The dependency-free test runner was kept.
- **Transcript upload** (`src/transcript/`): students can upload their ND unofficial transcript
  PDF; it is parsed **in the browser** (pdfjs-dist — one of the app's two lazily-loaded runtime dependencies, with tesseract.js for
  opt-in OCR; both bundled, no network) and the parsed courses are shown for confirmation before anything is added.
  The Transcripts card has four slots — Notre Dame, and a previous Undergraduate, Master's and
  Ph.D. transcript from another university (`src/transcript/external.ts`, best-effort; scanned
  PDFs through the opt-in in-browser OCR); every external course not matched in the sheet's
  ExternalCourses tab shows "not yet reviewed by the DGS". ND PDF parsing is
  best-effort against the Banner self-service transcript layout: if the Registrar changes the
  format, collect one fresh transcript PDF (any volunteer student), and ask Claude Code to
  update `src/transcript/parse.ts` and its tests against it. Nothing uploaded ever leaves the
  student's browser — the page says so explicitly next to the upload button, in the save card,
  and in the footer (FERPA: no education records are transmitted or stored anywhere; the app's
  only network request is the read-only fetch of the public course-rules sheet).
- The engine (`src/engine/`) is pure: every requirement function has the handbook sentence
  quoted above it, and `audit(student, rules, today)` takes "today" as an argument. If code and
  handbook disagree, the handbook wins — fix the code.
- Sheet-schema changes (column names, allowed values) are a contract with the humans who edit
  the sheet: update `data/README.md` and this file together with the loader.
- **Never keep a working copy inside Google Drive (or OneDrive/Dropbox).** The repo lived in a
  Drive-synced folder until 2026-09-02, and in two days Drive damaged `.git` four different ways:
  a vanished index (every file shown as deleted), stranded `index.lock` files, `Icon\r` badge
  files dropped into `.git/refs/` ("fatal: bad object refs/Icon?"), and conflict-duplicated
  object directories (`objects/0a 2/`) that made trees unreadable. Since then each machine keeps
  an ordinary clone OUTSIDE any synced folder (e.g. `~/degree-audit-app` — still no `:` in the
  path) and GitHub does the syncing: `git push` on one Mac, `git pull` on the other. If a repo
  ever shows those symptoms again, everything is on GitHub — `git fetch --refetch origin` repairs
  missing objects (after `find .git -name $'Icon\r' -delete` if refs are poisoned), and a fresh
  clone is always the fastest cure. Drive's own files (`*.gsheet`, `*.gdoc`, `Icon\r`) are
  git-ignored for anyone who ignores this advice.

## Handoff checklist

The canonical checklist is in [`README.md` § Handoff checklist](README.md#handoff-checklist)
(sheet ownership, repository access or transfer — which changes the live URL — one live edit
together, and pointing the next DGS at the README). Nothing else — students keep their own data.

## License

Dual-licensed by the University of Notre Dame: free for non-commercial (academic and research)
use, paid non-exclusive license for commercial use via the IDEA Center (softwarelicensing@nd.edu).
Full text in [`LICENSE.md`](LICENSE.md); summary in the README.
