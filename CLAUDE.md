# CSE Graduate Degree Audit — project instructions for Claude Code

## What this is
A static, client-side web app for Notre Dame CSE graduate students. A student enters the
courses they have taken (or are taking), grades, and milestones — or uploads their ND
unofficial transcript PDF, parsed entirely in the browser — and the app reports, requirement
by requirement, whether they currently satisfy the **MSCSE** (Graduate Handbook §3) or **Ph.D.**
(Graduate Handbook §4) degree requirements, with the handbook section cited next to every line.

**The app is built, tested, and in maintenance.** Before changing rule logic or architecture,
read `docs/CLAUDE-HANDOFF.md` — the context capsule from the session that built it (non-obvious
design decisions, invariants, and recipes for common maintenance asks). The humans' guide is
`README.md` (Track A: sheet edits without code; Track B: changing the app with Claude Code or
Codex); deeper ops notes are in `MAINTENANCE.md`. `AGENTS.md` points Codex and other agents at
this file — keep the two consistent.

The Director of Graduate Studies (DGS) changes every few years. The next DGS must be able to
update which courses count, and the tunable numbers, by editing a Google Sheet — without
touching code and without the original author.

## Hard constraints (do not relax these without asking)
- **No backend, no database, no login.** Student data never leaves the browser (localStorage,
  plus export/import of a JSON file so a student can move between devices; transcript PDFs are
  parsed locally by bundled pdfjs). Nothing is sent to any server other than the read-only
  fetch of the rules sheet. The UI promises this explicitly (FERPA) — keep the promise true.
- **Static deployment.** `npm run build` must produce a `dist/` folder that works on GitHub
  Pages and also works if copied to any plain web host or embedded in an `<iframe>` on
  cse.nd.edu. Use relative asset paths.
- **Policy lives in the sheet, structure lives in code.** Which courses count, their core-area
  and specialization-group tags, and every numeric threshold the DEPARTMENT sets come from the
  Google Sheet. A number set above the department — the Graduate School's Academic Code or DGS
  Handbook — lives in code beside its quoted sentence, never as a Parameters key (DGS 2026-09-27,
  2026-10-04; README § A5b lists them, and a new one is added there). The *shape* of the
  requirements comes from the handbook and is implemented in code with a comment quoting the
  handbook sentence and its § number.
- **Never guess.** If a course is not in the sheet, or the sheet says `dgs_approval`, tell the
  student "needs DGS review" rather than silently counting or rejecting it. A missing
  parameter renders "cannot evaluate", never a default.
- **Cite everything.** Every requirement row carries the § it comes from — behind the card's "Relevant
  Policies" selector since 2026-10-03 (DGS), with its document named: "CSE §" is the CSE handbook, "Academic Code §"
  and "DGS Handbook §" are the Graduate School's (`src/ui/citations.ts` labels bare sections on every surface).
- **Maintainable by a stranger.** Plain, commented code; docs written for a future DGS.

- **University names in the ExternalCourses tab are never altered** (DGS 2026-10-07). Each was read
  from an official transcript by the app's import and pasted from a review request; a future
  transcript from that school must read the same name. Neither an AI agent nor the DGS renames,
  abbreviates, re-cases or "cleans" one — not even a name that looks like a header fragment
  ("GEORGIA INSTITUTE OF TECHNOLOGY OFFICIAL DOCUMENT INFORMATION" is Georgia Tech's) — and a
  change to the transcript reader's name extraction must keep reading the names already listed.

## Sources of truth (read these before touching rule logic)
1. `policy-sources/CSE-Graduate-Handbook-live.pdf` — the current edition (“Updated September
   2026”; the DGS replaces this file in place when a new edition is adopted, 2026-10-02 — the July
   2026 PDF it replaced is in git history under `docs/`). §3 (MSCSE) and §4 (Ph.D.). When code and
   handbook disagree, the handbook wins; flag the discrepancy instead of silently choosing. After
   replacing it, run `npm run handbook-text` and commit `src/ui/handbook-text.ts` — the section
   chips' hover text (DGS 2026-10-05); `tests/handbook-text.test.ts` fails until you do.
2. Google Sheet **CSE-Degree-Checking-Rules** (renamed from CSE-Degree-Audit-Rules, 2026-09-05) — the DGS-editable data (tabs Courses, Parameters,
   Categories, ExternalCourses, Universities). Published-CSV URLs: `data/sheet-urls.json`. Schema: `data/README.md`.
3. `docs/DECISIONS.md` — every interpretation decision already made, with dates and reasons.
   Read it before re-deciding anything; append when a new call is made. Its companion
   `docs/HANDBOOK-REVISIONS.md` is the other direction: the questions the audit forced whose
   answer belongs in the HANDBOOK, written for the graduate committee. Add to it whenever a
   decision only papers over a gap in the handbook's own text.
4. `docs/CLAUDE-HANDOFF.md` — engineering decisions, invariants, verification, recipes.

(The build-time starter kit — the pre-build prototype `reference/CSE-Degree-Audit.html`, whose rule
logic was superseded and found buggy, `START-HERE.md`, `KICKOFF-PROMPT.md`, the seed spreadsheet
`CSE-Degree-Audit-Rules.xlsx` and the Banner sweep `cse_courses.csv` — was removed on 2026-09-14;
it lives in git history only. `DGS-READ-THIS.md` was replaced by `README.md` on 2026-09-01.)

## Architecture (as built)
- Vite + TypeScript, vanilla UI, zero runtime dependencies except two lazily-loaded ones:
  `pdfjs-dist` (transcript PDFs) and `tesseract.js` (opt-in OCR of scanned external
  transcripts — self-hosted engine + English model in `public/ocr/`, ~7 MB, fetched
  same-origin only when a student explicitly chooses OCR).
- `src/engine/` — pure functions only: `audit(student, rules, today)`. No DOM, no fetch, no
  `Date.now()` ("today" is an argument so tests are deterministic). One function per
  requirement with its handbook sentence quoted above it; stable requirement ids in `audit.ts`.
- `src/data/` — published-CSV fetch → parse → validate → typed `Rules`. Validation reports bad
  rows in plain English (the person who broke it is a DGS editing a spreadsheet). On fetch
  failure: THROW a typed `RulesLoadError` — the loading card (`src/ui/loading.ts`) then suggests
  reloading first and offers `data/snapshot.json` (raw CSV text) as a student-chosen fallback,
  never automatically (DGS decision 2026-09-01). The rules are dated against that snapshot
  (`src/data/rules-date.ts`): Google sends no Last-Modified header, so "when did the rules last
  change" = when the six-hourly sync first saw the current content.
- `src/ui/` — form, course table with sheet-driven autocomplete, transcript upload + preview,
  report. All user-entered text rendered via `textContent`, never innerHTML. `app.ts` is the
  render loop and the cards that read the mutable record; the pieces with a clean interface live
  beside it (refactor 2026-09-20): `nd-upload.ts` (the Notre Dame transcript import and preview),
  `toasts.ts`, `stamp.ts` (the "Checked with" line every result carries — rules fingerprint,
  handbook edition, build — and the saved file's stamp; `npm run reproduce -- <saved file>` re-runs
  one, 2026-10-11), `focus-keeper.ts` (focus restored by `data-key` across re-renders), `refusals.ts`
  (out-of-range numbers kept in their box), `form-helpers.ts`, `email-html.ts`
  (what the three generated emails share). A second page,
  `courses.html` → `src/courses.ts` → `src/ui/courses-page.ts`, is the public course-rules list
  (read-only view of the Courses tab; no student data); both pages are built by Vite from
  `vite.config.ts` `rollupOptions.input`. `src/ui/embed.ts` is the `?embed=1` mode both pages
  share — the page trimmed to sit in an ND WordPress iframe, and (courses.html only) the
  height it broadcasts to the parent so the frame resizes; the allowlist of parent origins lives
  there and nowhere else, and the page never listens for an incoming message.
- `src/transcript/` — ND unofficial-transcript PDF → text → courses, all in-browser
  (`pdf.ts` + `layout.ts`: pdfjs runs → lines, reading two-column Banner pages column by
  column; `nd-markers.ts`: the shared "is this Notre Dame's transcript?" test; `parse.ts` also
  reads the ENTRY TERM, the degrees awarded and each row's UG/GR level, so a combined
  transcript's pre-entry Notre Dame courses become prior coursework — `src/ui/prior-nd.ts`);
  plus
  `external.ts`, the best-effort parser for transcripts from OTHER universities (all four
  transcript imports live in the single "Transcripts" card: Notre Dame + Previous
  Undergraduate/Master's/Ph.D.; system-generated PDFs are read directly, scanned ones via the
  opt-in in-browser OCR, English-language transcripts only; everything previewed and
  student-corrected before it is added; every course still needing a DGS decision — ND or
  external — feeds ONE combined review request in the "Ask the DGS to review" card). Matched against the sheet's optional
  ExternalCourses tab (`src/data/external.ts`) for §4.4.1 core-knowledge confirmation and §5.2
  transferability — unmatched courses always show "not yet reviewed by the DGS".
- `tests/` — **node's built-in runner** (`node --test`; that's why relative imports carry `.ts`
  extensions). One JSON fixture per student scenario in `tests/scenarios/`; add a scenario for
  every bug fixed. `tests/verdicts.json` pins every row of every scenario (2026-10-11): an engine
  change that moves one fails `npm test` with the list — show the list to the DGS, then
  `npm run verdicts -- --update` and commit the file with the change. `npm run e2e` drives real headless Chrome, `E2E_BROWSER=webkit npm run e2e`
  Safari's engine, `E2E_BROWSER=firefox npm run e2e` Firefox, `E2E_BROWSER=opera npm run e2e`
  Opera and `E2E_BROWSER=safari npm run e2e` real Safari (its window opens; the Mac must be
  unlocked) through the same drivers (see
  `.claude/skills/run-app/`).
- `scripts/sync-sheet.ts` + `.github/workflows/` — six-hourly sheet snapshot (rewritten, committed
  and redeployed only when the sheet content changed), CI tests, Pages deploy.

## Working rules
- **What the student sees first (DGS 2026-10-03 — "apply this to future changes too").** A result card on
  the right shows what is satisfied by what: the title, the status, the deadline, the facts and the courses
  counted. Every explanation, reason, next step, Graduate School form and citation is written in the engine
  as a `{ note }` detail part, which the card folds behind its "Relevant Policies" selector (plain text in `detail`
  and the emails). On the input side, anything that is not the common standard case goes behind a
  `rareFold(...)` selector (`src/ui/form-helpers.ts`), open once the record holds an answer in it — except Your standing's selectors, which stay closed unless they need attention (a warning, an unanswered transcript gap) and show what is on file in their summary line (DGS 2026-10-04).
- Start non-trivial work in plan mode; show the plan before writing code.
- Before implementing or changing a requirement, quote the handbook sentence in a comment with
  its §, and check `docs/DECISIONS.md` for an existing interpretation.
- Ask before changing the sheet schema (column names, allowed values, parameter keys). The
  schema is a contract with humans; changes need matching updates to `data/README.md`,
  `MAINTENANCE.md`, `KNOWN_PARAMETER_KEYS` (engine inputs — missing = error) or
  `DISPLAY_PARAMETER_KEYS` (page text only, e.g. `rules_effective_date` — missing = warning),
  the sample CSVs, and the test fixtures.
- Record every new interpretation choice in `docs/DECISIONS.md` (date, question, decision, who).
- `npm test` and `npm run build` must pass before you say something is done; run `npm run e2e`
  for UI-visible changes and look at the screenshots.
- Do not add analytics, tracking, runtime network calls beyond the sheet fetch (same-origin
  loads of the app's own bundled assets, e.g. `public/ocr/`, are fine), or any dependency
  without saying why.
- Never let a `:` (colon) into any parent folder name — it breaks npm's PATH and vite's module
  loader (details in `MAINTENANCE.md`).
- The project is dual-licensed by the University of Notre Dame (free for non-commercial use,
  paid commercial license via the IDEA Center). Do not edit, remove, or add license files or the
  README's License section unless the DGS asks; do not add dependencies whose licenses conflict
  with redistribution.

## Session protocol (how the DGS works with Claude on this repo — Claude Code Desktop, Code tab)
- The DGS keeps ONE long-lived Desktop session for this repo (never archived; a second session would
  mean a second branch to reconcile). Desktop runs the session in its own git worktree under
  `.claude/worktrees/<name>/` on the branch `claude/<name>`; the first command of a new session is
  `npm ci` (a worktree starts without `node_modules`).
- Start by reading `docs/CLAUDE-HANDOFF.md`, `docs/STATE.md` (where things stand, open items) and
  the newest rows of `docs/DECISIONS.md`. Never re-decide a recorded decision; append a row for
  every new one. Keep `docs/STATE.md` and the handoff current as you go, not at the end.
- The DGS sends numbered lists of changes; answer them by number. Verify EVERY change before
  calling it done — `npx tsc --noEmit`, `npm test`, `npm run build`, `npm run e2e`, and look at the
  screenshots — and check Safari's engine and Firefox too when layout changed (`E2E_BROWSER=webkit
  npm run e2e`, `E2E_BROWSER=firefox npm run e2e`; Chromium alone missed a Safari-only bug on
  2026-09-06 and a Firefox-only one on 2026-10-10). Show the result (screenshot or preview)
  in the reply that delivers it. Since 2026-10-04 (DGS: "From now on, commit and give the line to
  merge and push without my approval") a verified batch is committed at once and the reply ends with
  the merge-and-push line; revisions the DGS asks for afterwards are new commits.
- Commit on the session's branch under the DGS's own git identity (Taeho Jung <tjung@nd.edu>, the
  global git config on his Macs) with the change explained in the message. Before each commit that
  the DGS will ship, run `git fetch origin && git merge origin/main` (the sheet-sync Action commits
  to `main` every six hours) and re-run the checks if anything came in.
- Claude NEVER pushes, opens PRs or uses "Continue in → Claude Code on the Web". The DGS merges and
  pushes himself: after every shippable commit, end the reply with the exact line for him to paste
  into Terminal, with the real branch name (`git branch --show-current`) filled in —
  `cd ~/degree-audit-app && git pull --ff-only && git merge --no-edit <branch> && git push` —
  and tell him what it deploys. (The second merge is deliberately NOT `--ff-only` — DGS
  2026-09-28: the sheet-sync Action's six-hourly snapshot commit on `main` kept landing between
  Claude's merge and his push, and a fast-forward was then impossible; a plain merge fast-forwards
  when it can and otherwise makes the same merge commit Claude would have made. A conflict cannot
  arise: only the Action writes `data/snapshot.json`.) Never rewrite history that has been pushed.
- FERPA: never open a real transcript. Sanitized copies only, kept outside the repo under neutral
  names; never let a student's name into code, fixtures, docs or commit messages.
- Wording: "Grad Admin" is the Graduate Program Administrator; every student-facing string Claude
  drafts is listed, numbered, in the reply that delivers it, for the DGS to edit (the first round, W1–W47, was approved in full and its
  file removed on 2026-09-06; `docs/WORDING-REVIEW.md` is back as the running wording register).
