# Handoff for future Claude Code sessions

You are working on a built, tested, deployed app — not a greenfield project. This file is the
context capsule from the session that built it (Aug 2026, with DGS Taeho Jung answering the
policy questions). Read `CLAUDE.md` first (constraints), then this, before changing rule logic.
The git log is narrative — commit messages explain each step's reasoning.

## State of the world

Where things stand — what is done, what is open, the newest decisions — is `docs/STATE.md`,
kept current by every session. (This section used to hold a 2026-09-01 snapshot and went stale:
the loader now hedges a stalled request after `HEDGE_AFTER_MS` and retries within `LOAD_BUDGET_MS`
— `src/data/load.ts` — and `npm test` runs several hundred tests, not 70.) The app's
**Rules-sheet diagnostics** panel is the live truth about the sheet; working copies are ordinary
git clones OUTSIDE any Drive/OneDrive/Dropbox folder (`MAINTENANCE.md` § repo peculiarities).

## Non-obvious engineering decisions (and why — don't undo these casually)

- **Every number box has a range and it is enforced** (src/engine/ranges.ts, 2026-09-18). The table is
  the single source for the form, `validateStudent()`, the transcript preview and the engine — add a
  number field and give it a range here, or it will be as decorative as the `min`/`max` attributes were
  before R1. A refused value is NOT written to `Student`: it stays in its box (`aria-invalid` + a
  `.field-error` message) and in `refusedValues`, a map in `initApp()` keyed by the field's `data-key`,
  because `render()` rebuilds the page from the record and would otherwise put the last good value back
  without a word. Clear that map wherever the record is replaced wholesale (Load example, Clear, Load a
  file) — a stale refusal marks a box the new record never filled. The engine checks the GPA again in
  `gpaRow`: the form cannot be the only guard, since a save file is hand-editable, and every row that
  compares the GPA to §2.2's minimum (§4.5 candidacy, §4.7 defense, §3.4's M.S. defense) reads it
  through `usableGpa()` — one report may not say both "cannot be checked" and "yours is -2.00".
  Remember there are TWO "Bachelor's degree awarded — year" boxes, the standing card's and the
  transcript preview's (`external-upload.ts`), writing the same field; a guard added to one belongs
  on the other.

- **Course ids go through `canonicalCourseId()`** (src/data/assemble.ts, 2026-09-11) before every
  sheet lookup and every department test, and on entry in the manual form and the preview — so
  "cse60641" is CSE 60641. `isIncompleteCourseId()` catches placeholder numbers ("CSE 6xxxx"): a
  warning, never a count. If you add a new place that reads `courseId`, canonicalise first.
- **"Reviewed" is the gate the transfer checkbox opens** (2026-09-11): an ExternalCourses row with
  `transferable` set, or a Notre Dame course the Courses tab lists. `attestations.transferApproved`
  clears nothing else — the DGS ruled that a student's own checkbox must not make a never-reviewed
  course count. The same notion decides whether review.ts stops asking.
- **§4.4.2 no longer waits for §5.2** (2026-09-11): every Notre Dame course counts toward the
  specialization row whatever happened to its credit. The `awaitingTransfer` machinery in
  `categoriesRow` is now unreachable for prior ND courses and can be removed when convenient.
- **Residency reads `ctx.classified`, not `student.courses`** (2026-09-11) — superseded duplicates
  and rows with an unrecognised grade are not registrations.

- **§3.2's two project courses are decided by ID, not by `course_type`** (2026-09-11).
  `MS_PROJECT_COURSE_IDS` in allocate.ts puts CSE 68901 and CSE 68902 in the `project` pool for an
  MSCSE student whatever the Courses tab says, because §3.2's own sentence names both numbers. The
  live sheet types CSE 68901 as `research`, which meant every thesis-option student read "0 of 6"
  beside a row telling them to register for it — and no test caught it, because the fixture typed
  the same course `project`. **The fixture now mirrors the sheet on that cell**, so
  `mscse-thesis-complete.json` and `mscse-thesis-direction.json` pass only while this rule holds.
  If you ever make the id list a Parameters key, keep the two ids as the fallback.
- **A fixture that disagrees with the live sheet hides bugs.** That is how the CSE 68901 defect
  survived. When a scenario turns on a sheet CELL (a `course_type`, a `counts_toward_*`, a level),
  check `data/snapshot.json` and make `tests/fixtures/rules/courses.csv` say the same thing, or the
  suite is testing a sheet nobody has.

- **§4.4 is the Ph.D.'s, and the MSCSE must never hear about it** (DGS 2026-09-11). Core knowledge
  (§4.4.1) and category specialization (§4.4.2) are components of the qualifying examination, which
  the MSCSE does not have. Every surface that mentions either is gated on `student.program === 'phd'`
  — `coreNote` in allocate.ts, `coreTitle` in review.ts, `isRelevantRow` in external-upload.ts, the
  coursework table's hide rule and `irrelevantPrior` in app.ts, and a dozen notes and tooltips. The
  rule is easy to break by adding one string, so it is pinned TWICE: `tests/mscse-no-qualifier.test.ts`
  greps every requirement field, course line, warning, track note, review-request reason and both
  e-mails for `/§4.4|core.knowledge|core area|specialization|qualifying examination|qualifier/i`, and
  step 11 of the transcript e2e greps the rendered page and a preview. Both also assert the Ph.D.
  still matches, so the guard cannot pass by hiding everything. When you add a student-facing string,
  ask which degree it is true of.

- **One predicate decides whether a prior Notre Dame undergraduate course is worth showing**
  (2026-09-11). `priorNdUndergraduateCanCount(course, rule, program)` is exported from
  `src/engine/allocate.ts` and used by the transcript preview (`isRelevantRow`), the coursework
  table's hide rule in `src/ui/app.ts`, and — through the engine's own classification — the report.
  Before it, each surface carried its own "only a §4.4.1 core-keyword title matters" test, written
  when undergraduate coursework could do nothing else. After the Graduate School's 2026-09-10 answer
  it can count, and the copies silently dropped courses the engine was counting: a 40000-level CSE
  course read from the transcript never reached the preview, and one added by hand was counted by
  the report while invisible in the table. If you add a fourth surface, ask the predicate.
- **`dgs_approval` means the same thing wherever the course was taken** (2026-09-11).
  `priorNdShape()` reads `counts_toward_mscse` / `counts_toward_phd` for prior Notre Dame coursework
  exactly as `classify()` does for a course taken in the program: `dgs_approval` → counted
  provisionally with `approvalPending`, cleared by the same attestation checkbox, and listed by
  `coursesNeedingDgsReview` (which now also lists an undergraduate row carrying `approvalPending`,
  not just a core-keyword title). This is what makes the DGS's "they MAY count, subject to all other
  constraints" true of an MSCSE student's 40000-level undergraduate coursework — nearly every such
  row in the live sheet says `dgs_approval` for the MSCSE.

- **The DGS batch of 2026-09-06 (evening): items 1–6 plus the OCE short form.** Mechanics, file by
  file, with the decisions in DECISIONS rows of that evening:
  - `src/engine/review.ts` `coursesNeedingDgsReview(student, rules)` is THE rule for which courses
    the review request asks about (kind nd / priorNd / external, reason, unlisted = needs a new sheet
    row — a Courses-tab row for any unlisted Notre Dame course, CSE or not). An ExternalCourses row
    is a decision only where its cells say something: `transferable` for §5.2, `satisfies_core_area`
    for §4.4.1 (`none` parses to `null` = decided, no core area; blank = undefined = undecided,
    and the course stays in the request). `askDgsCard` only formats. Matrix: tests/review-pending.test.ts.
  - Toasts: `.toast-stack` created once in startApp OUTSIDE the root (render() no longer holds a
    toast element); `toast()` = one plain slot, 4 s; `toastWithAction(msg, label, action, { ttlMs,
    focusKey })` = one element per Undo (12 s default, 20 s for the ND / slot Removes), never
    replaced by a plain toast, ≤ 3 live; `cancelUndo()` on Load example / Clear / Load a file. Every
    Undo re-inserts rows at their original indexes (`{ c, i }` pairs recorded at removal) and sets
    `focusAfterRender` from `focusKey` (the button lives outside the root, so the rebuild has
    nothing to remember). The e2e reads `.toast` = the newest (prepended).
  - `src/ui/first-mention.ts`: `shortenAfterFirst(text)` (case-insensitive regex, first match kept)
    is applied by `advisorSummary`, `gradAdminRequest` and `buildReviewRequest` to text AND html;
    `applyFirstMentionRule(root)` runs in render() between `root.append` and `restoreFocus`
    (TreeWalker, nodeValue only; skips `details.glossary`, `.print-header`, `select`, `textarea`).
    The engine keeps writing "Oral Candidacy Exam (OCE)"; surfaces shorten repeats. The e2e counts
    exactly one full mention outside the glossary.
  - Graduate student status (§5.2 criterion 2): `Student.bachelorsAwarded?: Term` +
    `bachelorsAwardedInferred?: { how }` (state.ts validates both leniently). classify():
    after the DGS "no" ruling and before the grade floor, a transfer course with
    `compareTerm(term, bachelorsAwarded) <= 0` ⇒ "not counted — taken before / in the term your
    bachelor's degree was awarded (…), so not as a graduate student (§5.2)" + coreNote — absolute
    since the DGS's second pass that evening: a `transferable: yes` ruling does NOT restore it. `buildExplanation`'s mark regex: `; satisfies the` ⇒ counts, `; may still satisfy` ⇒
    pending (so excluded lines with a confirmed core area are green, not struck). audit.ts warns when
    the award term is not before the entry term. prior-nd.ts: registered level → award term → number.
    UI: the standing card's second fieldset (data-keys `standing.bachelors.season/year`, blank year =
    unknown, `.bachelors-note` in four variants); `bachelorsAwardFrom()` / `bachelorsMayBeSet()` /
    `bachelorsTermFor()` in app.ts fill it from the ND transcript's `degreesAwarded` (preview
    `.bachelors-line`, toast fragment) and `ExternalPreview.bachelorsConferredOn` from the external
    parser; an import replaces only an inferred value; Remove/Undo leave it alone. The Master's-row
    preview of a COMBINED record (`bachelorsForPreview`: mixed levels, a conferral line, or the
    two-year rule) shows a REQUIRED `bachelorsField` (data-keys `ext.preview.bachelors.season/year`),
    pre-filled from the conferral date; a student's edit re-fills every dated row's level
    (`relevelByAward`, levelSource `award`) and is written to the record as chosen. Scenarios:
    phd-transfer-before-bachelors, phd-nd-grad-before-bachelors. The e2e ND fixture's B.S. is dated
    2021 (UG terms 2020–21) so the Purdue fixtures (2023–24) stay candidates; step 3c flips the term
    to 2024 (all three Purdue rows excluded, request 6 → 5) and back.
  - Manual form: `src/ui/university-name.ts` (`titleCaseUniversity`, `canonicalUniversityName`,
    `knownUniversities`); one `<datalist id="known-universities">` appended in render(); both
    University boxes (form, editable preview) Title-Case on change. Level = '' (graduate, NO
    degreeLevel — the row belongs to no transcript slot, groups under "graduate coursework (§5.2)")
    or 'bachelors'.
  - Roles: `src/ui/grad-admin-request.ts` (`processingItems`, `gradAdminRequest` → { subject,
    text, html, items }; `MILESTONE_FIELDS` mirrors the milestones card's labels — keep them in
    step; since the second pass the text carries the review request's markers — exported from
    src/transcript/external.ts as `EDITABLE_MARKER` / `DO_NOT_MODIFY_MARKER` / `MARKER_DIVIDER` —
    an "Attached: …" line naming `selfCheckFileName(program)`, and one "Met — …" table per met
    requirement built from `RequirementResult.satisfiedBy` (course ids from `countedCourseIds` in
    context.ts for the threshold rows, the seminar, the transfer row, the core rows and the
    specialization row; the semesters of `longestFullTimeRun` for residency; milestone dates and
    the GPA figure looked up in the student record). The Grad Admin button also calls
    `exportFile(student)` before the dialog; `askGradAdminCard(report)` after milestonesCard (always shown; `inactiveButton` when
    nothing is processable); advisor-summary.ts `ActionItems.gradAdmin` + fourth list; a
    "pre-approved" reason routes to the Grad Admin, never to the DGS list. The DGS card's intro
    must not say "Grad Admin" (e2e pin).
  - `src/ui/copy-dialog.ts`: `copyDialog(opts)` writes the clipboard (`writeClipboard`, which
    external-upload's `copyReviewRequest` now delegates to) then shows `<dialog class="consent
    copy-check">` on document.body — never `consent-overlay` (the e2e auto-dismisses that);
    OK/Escape remove it and refocus `returnFocusKey`. The three builders return `subject`. Numbered
    `steps` (paste — or select-and-copy when blocked — then the caller's steps, then "Send it"):
    the DGS and Grad Admin requests emphasise attaching the ORIGINAL transcripts, the Grad Admin one
    also the saved self-check file. An emphasised `.copy-lead` line right above the message says
    "The following message has been copied to your clipboard" (or that the clipboard was blocked) —
    DGS request 2026-09-06, late evening; e2e pins it in both dialogs.
    Headless clipboards are usually refused: the dialog then shows the "copy it yourself" variant
    with the textarea selected — the e2e accepts either heading.
- **Late-evening items** (2026-09-06, four more DGS requests; DECISIONS rows of that night):
  `processingItems().count` includes `met.length`, so the Grad Admin button is active on met
  requirements alone and the card carries a "N requirements met so far — …" line (e2e: after the ND
  import the button is not `aria-disabled`). "Taken as" values read "Undergraduate student" /
  "Graduate student" (`select.row-level` max-width 158 px; the manual form's label is "Taken as"
  too) — the values `undergraduate`/`graduate` and `degreeLevel` are unchanged; the column
  tooltip and the mixed/level notes say the value is the student's status, not the course's level.
  The review request no longer upper-cases institutions (`buildCombinedReviewRequest` heading and
  ExternalCourses paste rows), and allocate.ts's "ruled this … course non-transferable" line uses
  `c.institution` — the sheet's spelling appears nowhere student-facing; hand-typed names keep
  Title Case. The bachelor's date: `DEGREE_DATE_LINE_RE` / `NOT_YET_RE` in external.ts — a
  bachelor's-naming line takes a date from itself (with a conferral word or in a degrees block),
  from a labelled line within the next six (stopping at a course row or the next degree's name), or
  from a dated line up to two lines before (`recentDegreeDate`); `dateOnLine` also reads
  "05/2024"; the ND parser's `AWARD_WORD_RE` accepts "Conferral", "(Degree) Completion Date".
  Shortened 2026-09-07 on the DGS's request: the options read "UG student" / "Grad student"
  (`select.row-level` back to 118 px) and semesters in table cells use `termShort` ("FA26",
  "SP25", "SU25") inside `<abbr class="term" title="Fall 2026">` — the preview's locked term cell,
  the ND preview and the coursework table; everything else (prose, toasts, aria-labels, emails)
  keeps `termLabel`. e2e pins the short form and its tooltip in both tables. Same day: in the
  560–860 px compact preview the header row (`tr:first-child`, clipped for screen readers) is shown
  again for tables `:has(tr.compact)`, with only `th.level-head` ("Taken as") visible, 118 px like
  the dropdown; `checkCompactPreview` asserts exactly that header, aligned over the dropdown.
- **§4.4.2 groups are a LIST** (2026-09-08). `RuleCourse.categoryGroups` holds every group a course
  may fill (`any` kept verbatim and expanded where it is read); `categoryIneligible` distinguishes
  "not eligible" from "not decided"; `categoryGroupRaw` keeps the cell for diagnostics.
  `categoryGroupsOf` in data/parse.ts does the splitting. Both pages resolve the list through their
  own small `groupsOf` helper, which orders it by the Categories tab — use it rather than reading
  `categoryGroups` directly, or a course listed under two groups will be offered all five.
- **Short names for referenced rows** (2026-09-08): `RequirementResult.shortTitle`, used by the
  per-course "Counts toward" list and nothing else. A new row that can appear there wants one.
- **Short forms of the category names** (2026-09-08): `src/engine/short-names.ts` `shortName()` is a
  DISPLAY map (OS, Alg, Comp Arch, HCC, Arch, DS/AI, Sys/Soft), applied at exactly four call sites —
  the §4.4.1 chip in `phd.ts`, the §4.4.2 row's two lists, and the group picker in `app.ts`. Do NOT
  widen it: the DGS drew the line at course titles, requirement titles, handbook quotes, the
  glossary, the course-rules page and the copied e-mails, all of which keep the full names. Its list
  runs longest-first ("Computer Architecture" before "Architecture") and a name it does not know
  passes through, so a category the DGS adds later is readable but not abbreviated. "Notre Dame" →
  "ND" is NOT done by this function — those are hand-edited literals in `app.ts`, `report.ts`,
  `external-upload.ts` and one `shortTitle` in `requirements/phd.ts`, because each one needed its article and its e2e pin moved with it, and
  the masthead, the footer and the emails keep "Notre Dame" deliberately.
- **The schedule cards' staleness rule** (2026-09-09; per row since 2026-09-14): `src/ui/schedule-terms.ts`
  is the whole of it — DOM-free, with a test matrix. `rowSchedule(today, row)` reads a row's
  `offered_now` / `offered_next` against its own `last_offered` (parsed into `RuleCourse.lastOffered`):
  dated this teaching semester or later → both as written; dated the semester before → `offered_next`
  becomes this semester; older or undated → nothing, and the page counts those rows in a "not shown"
  line. `current_semester` / `offered_semester` are no longer read (the Parameters row is harmless).
- **The code was tidied for readers and agents on 2026-09-20** (four review passes, behaviour
  preserved; verified by the 535 unit tests and the e2e suite in both engines). What moved:
  `src/ui/app.ts` 3,141 → 2,185 lines — the ND transcript import is `src/ui/nd-upload.ts`
  (same argument shape as `external-upload.ts`: `student` is passed per call, never captured),
  toasts/undo are `toasts.ts`, focus memory is `focus-keeper.ts`, refused numbers are
  `refusals.ts`, the example student is `example.ts`, field/label/error builders are
  `form-helpers.ts`, and `email-html.ts` holds `esc`/`plural`/program names for the three email
  builders. In the engine, `classify()` is split into `classifyTransfer` /
  `classifyPriorNdUndergraduate` over a `ClassifyEnv` (pure move), each course's rule row is
  resolved once, `coursesNeedingDgsReviewFor(classified, …)` lets the UI reuse the audit's
  classification instead of re-running it, `timeLimitRow` / `provisionalRegularIds` /
  `defendGpaNote` in context.ts serve both programs, and the ExternalCourses tab is indexed once
  per rules object. On the course-rules page the per-row schedule, search text and group list are
  computed once per render. The one behavioural nuance: the add-a-course year box now defaults to
  the Notre Dame date's year, like every other date on the page, not the device clock. The three items the
  reviews left for the DGS were decided the same day (DECISIONS 2026-09-20): `isMsProjectCourse`
  matches the canonical id everywhere; test.yml skips pushes to main (deploy.yml tests there);
  the sync workflow keeps its test step as the scheduled clean-machine check.
- **The page is fluid** (2026-09-09). `#app` has NO max-width — do not re-add one. `.layout` is
  `minmax(0, 1fr) minmax(480px, 30%)`, so both columns grow. There is NO reading measure on prose
  either (DGS 2026-09-19: the 100ch, then 70ch, cap on `.card > p` etc. read as stray line breaks
  because a paragraph stopped short of its card's edge) — the inputs column is its own grid column,
  so text cannot run under the report cards. `checkWide` in scripts/e2e/drive-a11y.mjs fails if
  either page stops filling a 2200 px window. The self-check's `<footer class="legal">` is the
  `.layout` grid's THIRD child (DGS 2026-09-19): `grid-row: 2` under the inputs column while
  `.audit-col` spans both rows; below 900 px both reset and the footer is simply last. It is inside
  `<main>`, so not a contentinfo landmark — deliberate. courses.html's footer is untouched.
- **The course-rules filter bar has two shapes** (mobile review 2026-09-19): above 860 px every
  control sits in the `.filters` grid as before; below, `filterBar()` wraps everything but the view
  and the search in `<details class="more-filters">`, open when any of those is set. `display:
  contents` on a `<details>` is ignored by browsers, so the shape is chosen at build time from
  `wideFilters` (a `matchMedia('(min-width: 861px)')`, `{ matches: true }` under node) and the bar is
  rebuilt on its `change` event — the values live in `filters`, not in the controls. In e2e, use
  `checkVisibility()` for anything inside a closed details: WebKit gives its content boxes.
- **The opening dialog asks the program only** (DGS 2026-10-08, Option 1 — it asked the earlier
  degrees too from 2026-09-22). The alpha notice and the program; `closeConsent` re-applies a
  background that fits a changed program, else turns it back into a draft without its graduate
  part. `applyBackground` writes `priorMs`, `ndMasters` and `integratedBsMs` from a COMPLETE answer;
  the standing card's controls for those are gone, the program tabs are gone (`.program-name`
  shows the choice), and imports skip their inference of those facts while `student.background`
  exists. Reset (`resetAll`) empties the record and calls `openOpeningDialog(undefined)` — the
  dialog is a function for that reason.
- **The earlier-degrees questions** (DGS 2026-09-22; on the page since 2026-10-08): `src/ui/background.ts`
  owns them (`backgroundQuestions(current, prefix, program, onChange, sequential, read)`), used
  INLINE in the Transcripts card (`fieldset#earlier-degrees`, prefix `earlier`, external-upload.ts)
  until the answer is complete, and by the "Change" dialog `openBackgroundDialog` (prefix
  `background`) after. Row rules: `priorSlotsFor(background)` for an answer, `priorSlotsForDraft`
  while unanswered. Next steps (next-steps.ts) and the standing card's “Earlier degrees” line link
  to `#earlier-degrees` while it is open. The e2e consent helper (session-common.mjs) chooses the
  program, then answers “elsewhere / elsewhere / not the same place / finished” inline and clicks
  Done, so every previous row exists for the transcript driver. drive-transcript.mjs's last block
  runs Option 1 end to end on tests/fixtures/nd-insidend-transcript.pdf (invented, insideND's
  positioned columns) and the Purdue master's fixture.
- **Answer, draft, reading (Option 1, 2026-10-08).** `Student.background` = the complete answer, the
  only one the engine and the inferences read. `Student.backgroundDraft` = a partial answer, never
  read outside the questions; `Student.backgroundRead` = per answer key, where an import read it
  (“Read from your transcripts: … — change it if it is wrong.” under the question).
  src/ui/background-read.ts: `readBackgroundFromNdTerms` (the ND transcript's per-term level and
  major, parse.ts `ParsedTranscript.terms`: undergraduate terms → a Notre Dame bachelor's, the last
  undergraduate major names CSE or another department — none is NOT read as another university,
  since the transcript does not say which levels it covers; non-CSE graduate terms before the CSE
  ones → `nd-other`), `readBackgroundFromPriorBachelors`
  / `readBackgroundFromPriorGraduate` (a previous transcript from another university), `mergeReading`
  (fills gaps only, never over a part already there, nothing once an answer exists; a degree
  elsewhere read beside an MSCSE answer becomes `alsoElsewhere`), `answerBackground` (the student's
  change drops that key's mark), `settleDraft` (a complete draft becomes the answer),
  `withdrawBackground` (an applied answer back to a draft — undoes what `applyBackground` set and
  re-runs the inferences; used when the dialog closes on a program change, or on a saved answer
  `completeBackground` now rejects), `draftForProgram`, and `reconcileInferences` (after every
  draft change: `deriveNdMasters` / `derivePriorMs` in prior-nd.ts now also yield to the draft's
  graduate answer, and an inferred 4+1 to a draft “No”). On the page, `answeringEarlier`
  (external-upload.ts, not saved) keeps the questions open after they complete, until “Done”
  (`earlier.done`, focus to `transcripts.background.change`); “Done” and the Change dialog's Save
  clear `backgroundRead`. A read note's id is `${prefix}-read-${key}` and each choice it concerns
  carries it in `aria-describedby`. The term pickers report a change only when the term changes
  (a semester picked before the year re-rendered the page and snapped back to Fall).
  Since the blue/red-team review (same night): a reading NEVER applies the answer — `mergeReading`
  only fills the draft (with `backgroundReadFrom`, the source of each read part) and `confirmDraft`
  (the inline "Done", shown once every question is filled) applies it; `forgetReadings(s, source)`
  runs when an import is removed; a changed answer or a contradiction drops the follow-ups read for
  it (GRADUATE_FOLLOW_UPS / BACHELORS_FOLLOW_UPS); `derivePriorMs` follows a draft's `finished`;
  `sameUniversityReading` leaves nested names undecided. The major helpers live in
  src/transcript/majors.ts (placeholders read nothing). parse.ts `inferEntryTerm` takes `terms`:
  on insideND the entry term is the first GRADUATE term in CSE (in-progress terms only when every row
  is GR), nothing when no graduate term; nd-upload.ts `bachelorsAwardRead` reads the last undergraduate
  term as the award term when ND graduate terms follow. external.ts `saysConferred` (no level words,
  no forecasts); nd-markers.ts `OTHER_NOTRE_DAMES`; external-upload `inSlot` skips every
  `fromNdTranscript` row; Reset calls `resetPriorImports` / `resetNdImport`.
  `isOtherDepartmentMajor` decides “another department” (a whole major name only); parse.ts reads
  a College / Major value row of two or more cells (a standing value is never the major) and waits across page furniture for it. `mergeReading` returns
  `'filled' | 'disagree' | false` — a reading that contradicts a part READ from another
  transcript clears it. Previous-transcript rows stay while their preview is open (graduate rows
  while their courses are on file) whatever the answer says. What the
  insideND transcript cannot say — the 4+1, the MSCSE, a transfer into the Ph.D., whether a
  program was finished — the student answers. A read value stays if its import is removed.
- **Status words on the page and in the advisor summary** (DGS 2026-09-22): `unmet` and
  `in_progress` both display "In progress" (report.ts `pillLabel`, advisor-summary.ts `tagFor`);
  an unmet row with `deadline.state === 'overdue'` displays "Overdue" (`isOverdue`, class
  `s-overdue`). The headline counts in progress / overdue / cannot be evaluated / conditionally
  met; the engine statuses are unchanged, so tests and the attention list still read `unmet`.
  `advisorSummary` re-voices each row's own detail as the Why (`whyFor`; no course lists, no bullets, the categories row reduced to group names — DGS 2026-09-23) and takes
  `advisors` (the names; a second advisor lives in `milestones.advisorName2`). `ndRegular` (allocate.ts)
  counts `ndMastersCredit` rows as taken at Notre Dame for §4.2's nine.
- **The Graduate School's two rules** (through the DGS, 2026-09-22 — DECISIONS has the verbatim
  answers). (1) `classifyTransfer` has a branch before the §5.2 logic for a Ph.D. student's own
  Notre Dame MSCSE coursework (`program === 'phd' && ND && student.ndMasters`): `ndMastersCredit`
  + `notTransferCredit`, counted by `priorNdShape` alone — no 'transfer' cap, window, floor or
  approval; a thesis/project row is total-only with no approval. `transferRow` names those courses
  as not counted there; `review.ts` words an unlisted one as "counts toward the Ph.D. from your
  Notre Dame MSCSE — …". (2) Every Ph.D. student is asked `countedToward` for eligible prior
  undergraduate Notre Dame courses (two options without an ND master's, app.ts); 'bs' adds the
  `sharedbs` cap, which `audit.ts` builds for the Ph.D. with `limit = BS_SHARED_CREDITS_MAX
  − spentOnBachelorsAndMasters(student)` (the six in code since 2026-10-07, P3-sheet-5) (allocate.ts, the 'both' credits) and a label that says what
  was used; `phd.cap.sharedbs` (phd.ts) appears only when a course draws on it and carries an
  `extraDetail` (new optional `capRow` arg). Prior-undergraduate ND courses now always carry
  `notTransferCredit` — an unanswered one used to sit on the §5.2 row and, with no real transfer
  left, made it read Met. The pre-entry ND heading in the coursework card names the degree
  (`priorNdCourseworkWord` in app.ts: MSCSE / Ph.D. / master's / graduate).
- **A Notre Dame transcript is refused in the three Previous rows** (DGS 2026-09-22): `slotRow` in
  external-upload.ts runs the ND parser's `isNotreDame` test first and fails the slot with
  `ndInPreviousRow()`; the OCR path does the same. The 2026-09-05 path that read such a transcript as
  an earlier Notre Dame degree (the preview's `notreDame` flag, `.nd-prior-note`, the ND blocked-row
  notes) is gone. The Notre Dame row handles the whole insideND record — entry term, degrees awarded,
  pre-entry rows as prior coursework — see nd-upload.ts.
- **Public-transcript fixtures and the column-mapped parser** (2026-09-26). `tests/fixtures/public-transcripts/<name>.json` are 93 line lists composed from PUBLIC registrar samples, keys and templates (never a real record; `sources.json` says where each came from, `expected.json` what it must read, `public-transcripts-known-failing.json` the ones waiting on a DGS decision — a fixture on that list must still fail, so the list stays honest; take it off when its change lands). `tests/public-transcripts.test.ts` pins them; `tests/public-transcript-rules.test.ts` pins the reasoning on minimal documents. Tools: `node --experimental-strip-types scripts/dev/parse-lines.mts <lines.json>` prints one parse; `scripts/dev/public-status.mts [name]` prints pass/fail with diffs. In `src/transcript/external.ts` the row reader now tries `scanWithMap` first — `readColumnHeader` turns the table's header line into column kinds (`COLUMN_KIND_RES`; a cell no pattern knows is a flag; "Note" is the grade only without another grade column; "Points" before the grade with no credits column is the credits; Theoretical/Practical and Créditos Aula/Trabalho sum to the credits) and the row's tail is matched against the kinds after the title, longest title with fewest blank columns wins, one-letter flags and the rest of a type cell may trail — and falls back to the position-free `scanTokens` when the row does not fit (a decimal or trailing integer left in the title with no credits found is the tell). `readLegend` gives `mapGrade` its `LegendHints`; `CODED_*_TOKENS` map only in grade position (after the credits or right before them), so "CS Trends" stays a title. `readTermLine` replaces the old term regex (ordinals via `ordinalOf`, `academicRange` for BUET-style Level/Term lines, `explicit` marks a header that named a season so a row's own date cannot override it, `ubcStyle` gates "Winter Session"). `rowTermOf` reads per-row term cells; `isoOrEuropeanDate` (day-first, ISO, Romance months) complements parse.ts's US `dateOnLine`, and `dateAfterLabel` takes the date after "Graduation Date:" on a two-date line. Degree abbreviations are case-sensitive (`BACHELORS_ABBR_RE`, `GRAD_ABBR_RE`). The research plan with every gap, sample lines and the needs-download list is in the session scratchpad only (`transcripts/final/PLAN.md`); DECISIONS.md carries the readings and the seven open questions. (2026-10-09, Batch A step 5: 20 more `pdf-*` fixtures from public specimens — each PDF opened as text first to confirm its placeholder name, stored under its fixture name in `~/degree-audit-samples/public-pdfs/` so `npm run replay -- --verify` scores and hash-checks it; expectations are the truth and the known-failing list now also names the Batch B parser family each waits on, so a new fixture that reads wrong is pinned right and listed there, never pinned wrong.)
- **The deadline alert** (2026-09-28; DGS). `deadlineHorizon(date, today)` in term.ts says whether an open deadline falls in this semester or the next (fall/spring slots via `semesterSeq`, a summer date with the spring before it); `openDeadline(date, today, label)` in status.ts is the ONE builder for every open deadline (`deadlineStatus`, the qualifier's four semesters, the years limit, the MSCSE advisor row) and sets `state: 'due_soon'` + `DeadlineInfo.horizon` — the 120-day rule is gone. report.ts: `isDueSoon`, `dueWording` (" · due next semester"), `statusWord` (the pill's word without the suffix, for the copied messages), `pillLabel` = word + suffix, class `s-duesoon` on top of the status class; style.css `.pill.s-duesoon` / `.chip.deadline.d-due_soon` share the orange. Keep the words on the pill — colour alone is not an alert.
- **The September 2026 handbook's three rule changes** (2026-10-02; DGS). shared.ts `advisorRow`: the MSCSE deadline is `endOfTerm(ctx.entry)`. allocate.ts `msBelowSixtyApproval(program, counts, approved)` adds the §3.2 approval to a `yes` MSCSE row below the 60000 level (both the in-program `regular` branch and `classifyPriorNdUndergraduate`'s shape); `decidedCaseByCase` returns true for such a course so the tick shows; review.ts recognises "approval per §3.2" as the allowance ask; mscse.ts `ms.cap.fourk` is `approvalDriven`. The non-CSE floor was already in allocate.ts — only the quote/title moved. The handbook file is `policy-sources/CSE-Graduate-Handbook-live.pdf`, replaced in place; diff a new edition with `pdftotext` and the sentence-level script in the 2026-10-02 session (README B4).
- **Embedded cross-links go to the ND pages** (2026-09-30; DGS). sibling-links.ts `DEFAULT_HOST_PAGES` names the two sites.nd.edu pages; `siblingLink(page, search, embedded)` / `siblingAnchorAttrs(page, search, embedded)` return a named host page (query parameter, allowlisted), else the default when embedded (target `_top`), else the sibling file. Callers pass `isEmbedded()`; report.ts `courseListLink` uses the same rule in embed mode (the filter query is dropped — a frame cannot receive one). drive-app.mjs checks the default on both pages. If the ND site moves a page, edit the map or the iframe src.
- **The self-check layout's rows and the contact card's two hosts** (2026-09-30; DGS). `.layout` is `grid-template-rows: auto 1fr` from 901 px up: the report column spans both rows, and a flexible second row takes its overflow, so the footer (row 2, column 1) sits right under the last input card — with two auto rows the overflow was split between the rows and a blank band opened under the inputs whenever the report was longer. The Who-to-contact card on the self-check page follows courses.html: `contactHost` (second masthead grid child, desk) and `mainContactHost` (end of the footer, narrow and embed), one `contactNode` moved by `placeContact()` on `(min-width: 900px)`; the masthead grid is one column below 900 px. Keep the two hosts in step with the media query, or the card doubles or vanishes.
- **The opening dialog's option rows** (2026-09-29; DGS: "ugly and not quite intuitive"). background.ts `choiceRow({name, value, head, sub?, dataKey, checked, onChange})` renders one `label.choice` (input + `.choice-text` with `.choice-head` / `.choice-sub`); `radios()` there takes a notes map (`GRADUATE_NOTES`) and an `inline` flag for yes/no pairs; the program choice in app.ts uses the same helper. Steps are `fieldset.field.group.step` with `legend.step-title` (CSS counter on `.consent-box`; hidden fieldsets make no box, so the numbering follows what is shown); follow-ups are `fieldset.background-followup` with `legend.followup-title`. `.consent-actions` holds the button ("Continue") and `.consent-hint` (its text names what is missing; hidden once `isReady()`); the acknowledgement is `input[data-key=consent.ack]` inside `.consent-warning` (a `div` since 2026-09-29: the red sentence in a `p`, the tick in `label.consent-ack`), and `isReady()` = tick + every family answered — the drivers tick it before clicking (session-common.mjs, drive-app.mjs, drive-transcript.mjs, drive-a11y.mjs). Any pick that decides what shows next must call `renderFollowUps()` — the same-place answer did not, and "finished?" never appeared (fixed the same day; drive-a11y.mjs walks the elsewhere path and checks visibility, and shoots `consent-answered.png`).
- **Credit first, core clause after "; "** (2026-09-29; DGS bug report). `buildExplanation()` in allocate.ts splits a line into the credit line and the qualifier line only at "; satisfies / may still satisfy / the same review can confirm … core-knowledge requirement …"; a line that STARTS with the core clause is left whole. Every classifier branch must therefore lead with the credit verdict and append the core clause — the bachelor's-level branch (`classifyExternal`, `degreeLevel === 'bachelors'`) does so since this fix ("not counted — taken as an undergraduate student, so it brings no transfer credit (§5.2); satisfies …"). Put a new core note in the same shape, or it prints twice: `qualifierFromFeeds()` (audit.ts) adds a qualifier line from the rows a course feeds whenever the classifier gave none.
- **The qualifier's components share the umbrella's deadline** (2026-09-29; DGS bug report). phd.ts `qualifierDeadline(ctx)` → `{term, extendedTerm, effectiveDate, passed, deadline}` once per audit; `withQualifierDeadline(c, due)` puts that chip on every open core/specialization row and flips it to unmet when passed (Q17b); the umbrella row takes the same object. The research row keeps its §4.4.3 deadline; the prior-rules path resets children's deadlines to undefined. The scenario runner accepts `deadlineState` per row since this fix.
- **One block per requirement in both emails** (2026-09-28, night, later; DGS: "hard to see which text is for which requirement"). email-html.ts `htmlRequirementBlock({word, color, title, section, lines?, deadline?})` — a `<div>` card with `border-left:4px solid <RULE_COLOR[color]>` and `background:#f7f8fa`, the badge + title paragraph, the deadline box (margin `6px 0 0`), then the lines — and `textRequirementBlock(opts, indent)` — the `[WORD] title (§)` line, then the deadline and each line at `indent + 4 spaces`. advisor-summary.ts `line`/`htmlRow` and grad-admin-request.ts `textSection`/`htmlSection` (badge sections; `split()` takes the "title (§)" heading apart; a residency table is appended inside the block) build on them. Keep the deadline ABOVE the explanation in both flavours. Tests pin the block through the helper itself (`html.includes(htmlRequirementBlock({...}))`).
- **One skeleton for the three emails** (2026-09-28, night; DGS: "Do all with these"). email-html.ts holds `STUDENT_LINE` / `studentLineHtml()` (the name-netID-NDID placeholder — the app stores none of these), `FILL_IN_STEP` (the copy dialog's first step in all three) and `ACTION_HEADING`; every builder prints subject · salutation · student line · intro · standing (+ `history.earlier`) · numbered actions · Thank you · markers · evidence. `src/ui/program-history.ts` `programHistory(student)` → `{compact, earlier}` for the subjects and standing lines: the current program and entry term, a transfer from the MSCSE with `background.transferredTerm` (NEW record field, asked as a follow-up in background.ts when `nd-mscse-transfer` is chosen — data-keys `<prefix>.transferred.season/year`; validated in state.ts; optional), an MSCSE / B.S. held at Notre Dame spanned from the prior coursework's terms and the award (`ndMasters.term`, `ndDegrees`, `bachelorsAwarded` unless only "before"). engine/review.ts `ReviewAsk` (`needsRow`, `replyNeeded`, `decide[]`) rides on every `PendingDgsReview` and drives the DGS request's A/B action list and its "Please decide" column (`buildCombinedReviewRequest` takes `history` and each course's `ask`; a caller without `ask` still works). grad-admin-request.ts: `items.actions` (the numbered list), `items.courses` (`countedCourses()` — ONE table, report order, term order), `StandingTable.lines` (`whyFor`-voiced "Evidence:/Progress:" lines; no filler tables). advisor-summary.ts: actions first (`todo.advisor` numbered), `nextDeadline`, `MY STANDING…`, stacked `htmlRow`, the core collapse (`coreCollapsed`, id `phd.qualifier.core`), `meterWord` for allowances, and `approvalItems(course, reason, program)` — the per-reader wording for the approvals row's items (the "send the review request" voice bug). tests/program-history.test.ts, review-pending (ReviewAsk), external-rules, grad-admin-request, advisor-summary; drive-app.mjs checks the transfer question and the subject.
- **One style for both emails** (2026-09-28; DGS: "Use the same style as in the texts for Grad Admin to format the text summary copied for advisor"). email-html.ts holds `StandingColor`, `BADGE_STYLE` (the page's pill colours, inline), `htmlBadge(word, color)`, `htmlDeadline(text, alert, block)` (a paragraph box, or an inline box for a table cell) and `textDeadline(text, alert)` ("!! DEADLINE NEXT SEMESTER: …"); report.ts holds `standingColor(r)` and `deadlineAlert(r)` (null = nothing to print; 'this' | 'next' | 'passed' | undefined). advisor-summary.ts `tagFor` = `{statusWord, standingColor}` and `deadlineOf` = `{text, alert}`; its `COLORS`/`STATUS_TAG` are gone. Change a colour or a lead word in email-html.ts and both emails follow; tests/advisor-summary.test.ts and tests/grad-admin-request.test.ts pin both. `scripts/dev/ga-sample.mts` prints both emails for the example record.
- **The Grad Admin request's standing list** (2026-09-28; DGS). `processingItems().standing` (every scored row but Approvals and the transfer row, sorted red → green → blue → amber → grey, "Not started" before "Cannot evaluate") and `.tally`; `gradAdminRequest` prints them after the processable sections with inline-styled badges (`BADGE` map = the page's pill colours) and a `htmlDeadline` / `textDeadline` line — highlighted for `alert: 'this' | 'next' | 'passed'`, plain otherwise, omitted when done. `met` is still there for the card's count; the button's activation rule is unchanged. `scripts/dev/ga-sample.mts` prints the example record's request for a given day.
- **Qualifier line for in-program courses** (2026-09-28; DGS). `qualifierFromFeeds()` in audit.ts builds `CourseLine.qualifier` from the rows a course feeds (`phd.qualifier.core.*`, `phd.qualifier.categories`) when the classifier gave none — green if any feed is `now`, blue for an in-progress course, amber otherwise — so a Notre Dame course's core and specialization roles are on its line and not only in the folded link row.
- **The DGS's approval is on the course** (2026-09-27; DGS, clarity proposal 4g — his own model, quoted in DECISIONS). Four standings: not in the sheet (provisional, `approvalPending` starts `not in the course rules yet — send the review request so the DGS can enter it`; NO tick settles it — the 2026-09-11 non-CSE exception is gone), `yes` (counts outright; a transfer course gets `ClassifiedCourse.approvedNote` instead of `approvalPending`, and `approvedForAll` makes its tier definite), `no`, and `dgs_approval`/`adgs_approval` (case by case: `decidedCaseByCase(c, program)` in allocate.ts; the tick is `CourseEntry.dgsApproved`, read by `approvalStatus(counts, approved)`, `priorNdShape(…, approved)` and the transfer branch's `attested = needsApproval(transferable) && c.dgsApproved`). audit.ts sets `CourseLine.approvable/approved`; app.ts draws the box in the coursework cell (`course.${index}.approved`); the three record-level boxes left the milestones card and `state.ts migrateApprovalBoxes` maps a ticked old box onto every course it covered, then clears it (the `Attestations` fields stay for loading). review.ts: the tick on the course closes a case-by-case transfer; the reasons name the kind. shared.ts approvals row: `pending` also includes courses the review request still asks about (a `yes` transfer with an unrecorded core area), with `reasonOf()`. grad-admin-request.ts: `approvedForMe(c)`. next-steps.ts takes `review: {unlisted, caseByCase}`. Tests: engine-units, external-rules, review-pending, grad-admin-request rewritten to the model; 13 scenarios migrated; drive-transcript.mjs checks no tick is offered on an unlisted course.
- **Next steps under the dial** (2026-09-27; DGS approved clarity proposal 1). `src/ui/next-steps.ts` is DOM-free: `courseworkSentence(report)` counts the course lines' marks (a refused line contributes its own reason, cut at the first semicolon; more than three refused, ids only), `nextSteps({report, student, reviewCount, processingCount})` returns the record-level steps with fragment links (`#standing`, `#dgs-review`, `#milestones`, `#grad-admin`, ids on those cards in app.ts), `nearestDeadline(report)` the empty-state chip. app.ts computes them once per render (after `classify`) and hands them to `renderReport(report, untouched, next)` / `renderSummary(report, next)`; report.ts keeps them in module-level `currentNext` so `dial()` draws the sentence (`.subline.coursework-line`) and `attentionList()` renders “Next steps (N)”: the `ol.next-steps` first, then the rows, filtered by action (an unmet row with `progress` leaves unless its deadline is near or passed; a row a step `covers` — the advisor row, the transfer and approvals rows — is not listed twice), or the “Nothing to do right now” state. `tests/next-steps.test.ts`.
- **Unscored parts, allowances as meters, the transfer pill** (2026-09-27; DGS answers to clarity proposal 4, and 5). `RequirementResult.unscored` (the five qualifier children — pills kept, out of `isScored` in audit.ts, `scoredRows` and the attention list in report.ts) and `RequirementResult.allowance` (set by every `capRow` in context.ts, with `progress {have: used, need: limit}`; report.ts draws `allowanceMeter()` in the pill's place; group `ALLOWANCES` in phd.ts / mscse.ts; the fold summary appends “plus N allowances”). The transfer row sets `statusLabel: 'Waiting for the DGS'` on needs_dgs_review and leads its parts with the unreviewed courses; tests/conditional-satisfaction.test.ts lists the five labels a row may carry. The MSCSE advisor row carries a `deadline` (start of the entry term); `msAlongTheWayRow` sets `statusLabel: 'Not started'` unless `priorMs === 'completed'`; the umbrella's first part is computed from its children; the 24-credit row's allowance sentence is an `extraDetail`. app.ts `mscseClockSentence()` gates the whose-semester sentence on `background.graduate === 'nd-mscse-transfer' || ndMasters`. The §3.5 note's typed 6 stays in the code by the DGS's ruling (the Graduate School's number) — do not turn it into a Parameters key; the qualifier's group count already reads `category_distinct_groups_required`.
- **Collapse policy and the two-line course cell** (2026-09-27; DGS approved clarity proposals 2 and 3). The rule for the report column: OPEN by default = anything that asks the student to act now, plus each row's verdict sentence and pill; FOLDED = anything explaining how a verdict was reached — § quotes, contributions, the glossary, the §3.5/§3.6 track note (`<details class="track-note">`), the warnings (`<details class="warnings">`, summary with the count), and a plain ✓ course's “Counts toward” links (`.feeds-hidden` on the cell; the `courses.feeds` toggle sets module-level `showFeeds`, session-only; print CSS shows them all). Every fold's summary carries a count or its subject; the notice strips are exempt. Order in `renderReport`: back-link, dial, meters, warnings fold, track notes, attention, glossary, groups — the warnings no longer render in app.ts. The course cell: `CourseAllocation.qualifier` / `CourseLine.qualifier` (`{ mark, text }`) is filled by `buildExplanation` (a wrapper over `buildExplanationText`) whenever the explanation carries the classifier's core clause AND something else; app.ts renders “Credit: ” + “Qualifier: ” lines (`.credit-line`, `.qualifier-line`, `.line-label`), `countsNothing` skips a course with a qualifier line, `decisionWording` is applied to both texts, and the scenario runner matches `expectCourseLines` against both lines joined.
- **The clarity pass** (2026-09-26, late; DGS request). What a student reads after an import now follows three rules — verdict first, one fact per sentence, one word per concept — and the code paths that carry them: `buildExplanation` in allocate.ts leads every provisional line with `waiting for the DGS —` / `approved by the DGS —` (the `approvalPending` texts start the same way; `preApproved` is `/^approved by the DGS/`; `hasTransferCandidate` in app.ts is gone — the §5.2 paragraph `transferRule()` shows above every non-bachelors group, with `ms_/phd_transfer_window_years`, `transfer_min_grade` and the cap from Parameters); the vocabulary is `allowance` (never “cap” in student text), `decided` (never “ruled”), `course rules` (never “external-course rules”), and no decision dates in student text. `shared.ts` groups Approvals-row items by identical reason (`ids.join(', ') (reason)`) and `advisor-summary.ts` splits the list back up; its floor-sentence REWRITE and the `Retake or replace` parser follow the new §4.4.2 sentence. `audit.ts` gives a refused entry no `counts` list while a live entry of the same course number exists. `context.ts`: `extraDetailWhenShort` (the register-for advice), `joinedDetail` adds a period only when the last part has none, the allowance rows list “needs approval” only for admitted courses. `report.ts`: `unreachable()` matches “You can take the exam once”; the glossary’s first six entries are the pill words (section ''). nd-upload.ts and external-upload.ts: the preview strings and the toast (W-CL20–W-CL26). The twelve proposals and the five waiting on the DGS are in the DECISIONS rows; the e2e drivers pin the new strings.
- **Whose eighth semester** (2026-09-26, evening; DGS rule). Every §4 deadline counts from `Student.entryTerm` (`ctx.entry`, summer → the following fall); the rule about a Notre Dame MSCSE is therefore a rule about WHICH term that is: a finished MSCSE → the Ph.D. entry (`ndMasters` set, `background.graduate` = `nd-mscse` / `nd-4plus1`); a transfer into the Ph.D. from an unfinished MSCSE → the MSCSE start (`background.graduate` = `nd-mscse-transfer`, a Ph.D.-only answer in `graduateOptions`; `applyBackground` sets no prior degree for it; `state.ts` accepts it). `candidacyRow` in phd.ts appends the “Semesters are counted from …” sentence for both cases; the standing card's entry-term hints (inferred and plain) state the rule for Ph.D. records; `inferEntryTerm` in parse.ts takes the EARLIER of several admit terms unless a `masters` degree is dated between them (then the later, `how` says so), with the later term as `alternative`. Scenarios `phd-oce-clock-*`; `tests/background.test.ts`, `tests/transcript.test.ts`. The other §4 clocks use the same entry term, and the DGS confirmed that is right for the transfer student (“all clocks start at the MSCSE”) — no per-clock start exists or is needed (HANDBOOK-REVISIONS §10).
- **Registrar PDFs as fixtures, and what real geometry taught** (2026-09-26, later the same day). The DGS said to download the plan's public PDFs: 50 of 60 came down (the rest moved, bot-walled or not PDFs — the DECISIONS row lists them) and each ran through the app's OWN layout stage in node with `node --experimental-strip-types scripts/dev/pdf-to-lines.mts sample.pdf > lines.json` (pdfjs legacy build + `runsFromTextItems` / `runsToLines`, verbosity 0 so pdfjs's console warnings stay out of the JSON; PUBLIC documents only — `scripts/diagnose-transcript.mjs` is the tool for a real transcript, it prints shapes). Image-only PDFs: render pages with PyMuPDF at 200 dpi, then `node scripts/dev/ocr-lines.mjs out.json p1.png …` gives the OCR lines the browser would (tesseract.js + `public/ocr`, whitespace collapsed like `ocrPdfToLines`). The 34 `pdf-*` fixtures in `tests/fixtures/public-transcripts/` are those line lists; `sources.json` carries each PDF's URL, SHA-256, byte size and line count (the PDFs are NOT committed — re-download from the URL, check the hash, regenerate). `expected.json` gained `negative: true`: a key / legend / form / regulation must yield NO course row and its header fields are not compared. Two samples are pinned as read (ANU, the Vaasa template) — the ANU pin keeps two known artefacts, noted in DECISIONS. Parser changes the PDFs forced, all in `src/transcript/external.ts` unless said: `headerStraddles` in layout.ts vetoes a column split when one baseline holds a code/title header left of the gap and a credits/grade header right of it (ANU page 1); `CODE_STOPWORDS_RE` grew the function / document / address / money words, `proseSubject` refuses `in`/`on`/`for`/… only in prose case, digit-led codes need a capital in the title, `\d000-\d999` and a slash after a numeric code are refused; `courseLikeTitle` refuses program lines, e-mail lines, trailing commas and sentences (`PROSE_WORD_RE`, six words with two function words); the two-line continuation takes a numbers line only (≤ 3 wordy tokens); `LegendHints.hdScale` (an HD at a line end or “High Distinction”) makes `mapGrade` leave HD/D/CR/P/N raw, checked BEFORE the letter test; `scanWithMap` keeps the band beside the mark (`band`) and charges a one-digit “mark” after the credits beside an unmapped status one blank (`oneDigitMark`, credits-like column first — JNTU's marks-then-credits order is exempt); `readTermLine` joins “200 3”, knows `full year`, and gives a season-only line the current year. Tests: `tests/public-transcript-rules.test.ts` (four new cases), `tests/layout.test.ts` (the ANU page), `tests/public-transcripts.test.ts` (negatives).
- **Synthetic transcript fixtures** (2026-09-20). `tests/fixtures/ms-transcripts/<school>.json` is the
  exact line list the app's PDF layout step produced for one of the DGS's 48 synthetic master's /
  combined transcripts, and `expected.json` is what `parseExternalTranscript` must return for each;
  `tests/ms-transcripts.test.ts` pins all 48 (647 course rows). The PDFs themselves stay outside the
  repo (the DGS's iCloud Downloads, `ms-transcript-fixtures/pdf/`). To add or refresh one: run the PDF
  through pdfjs (legacy build, node) → `runsFromTextItems` → `runsToLines`, save the lines, parse, and
  write the rows as `id | title | credits | grade | season year[ | level]`; the harness that did this
  lives in the session scratchpad, not the repo — twenty lines, easy to redo. Two layout rules came
  out of this batch: a two-column split needs three DIFFERENT wordy texts at the right edge (one
  repeated header such as "Attempted" is a table, not a column), and the crossing test reads per-word
  runs joined into phrases (some generators emit one run per word).
- **The transcript accuracy program at a glance** (2026-10-09 — the index of the whole program on
  the branch `claude/policy-compliance-degree-engine-44a431`; the plan and research record is
  `docs/TRANSCRIPT-ACCURACY-PLAN.md`, its §5 the numbers per step, STATE.md's paragraphs of the date
  the running account, `docs/OCR-BENCHMARK.md` the OCR method and every measured change). The
  commits, by step, from the plan commit `e34279d`: Batch A — `d124c11` `433a376` `ab2bdff`
  `bbee934` `bcd810a` `26daf0e` (steps 1–3, the harness), `335f0b6` `5d516d0` `ed8861d` `dd3b3cb`
  (step 4, F1–F3 and their review), `2bf3185` `eb9cd8f` (step 5, the specimens), `3b576f2` (the
  closing); Batch B — `ab2d41c` (step 6, the composed fixtures), `bc5f1ba` `a803ef2` `4ca40c7`
  `0af7c3d` (step 8, F6 / F5 + F3 / F4 and their review), `f1ebb50` (the closing; step 7 deferred);
  OCR — `c7cc8c8` (step 9, the bench), `75b4f9a` `dce9b05` (step 10, measured and not adopted),
  `4cdee5f` `689c0e0` `3aa3805` (step 11, word boxes through the layout stage), `350abb9` `c830544`
  `9f0fc49` (step 12, the source-aware scale and the orientation trial), then the closing commit
  "Batch B and OCR steps 1-2.4: verification and records" (this bullet; the step-9 leftovers —
  `MAINTENANCE.md` "Measuring OCR", `tests/ocr-assets.test.ts`, `tests/ocr-bench-score.test.ts`,
  one DECISIONS row — landed in it). The three bullets after this one index Batch A, F1–F3 and
  Batch B; the OCR pipeline is the "`public/ocr/` holds the self-hosted OCR engine" bullet and the
  "OCR step 12" bullet. Rules the program taught, each in DECISIONS: a parser change that moves the
  board needs a fixture explaining why, never a re-baseline; every OCR A/B is measured against a
  run made on the SAME parser code (`ocr-baseline-20261009`, the 11:05 run, predates F4–F6 and is
  history only — the clean before is `ocr-step10-before-20261009`, the ladder in force
  `ocr-step11-after-20261009`), and a worse false-row count on the negatives is a regression
  whatever the rows gained; a student-facing sentence the e2e reads changes in the driver in the
  same commit; a step whose task excludes the e2e says so in STATE, and the closing verification
  runs both engines. Replay files and bench runs live in `~/degree-audit-samples/bench-out/`
  (`text-*.json`; `ocr-*/`), never in the repo. What is next, in order: the full ladder's sign-off
  run `ocr-full-20261009/` (started detached by the closing verification; read with
  `npm run ocr-bench -- --compare <it> --baseline …/ocr-step11-after-20261009`), Batch C once the
  DGS answers (CC15, CC16, TH02, the transcript gate, the CUNY and trimester questions, open
  question (g)), plan steps 2.5–2.7 (2.5 — the header-mapped path's tolerance of OCR noise — is done,
  the "OCR step 2.5" bullet; the 300-dpi render it was to turn on was re-tested and still loses; next
  the two-pass deskew and 2.6–2.7). The engine gate (step 14) was measured offline on
  2026-10-09 and PP-OCRv6_tiny NOT adopted (+7.7 points of row accuracy on L2–L5 against the +10 asked;
  flag recall 64.6 → 21.4 %): the runner, model fetcher and calibration live in
  `scripts/dev/ocr-bench/engine-gate/` with their own `package.json` (never installed by the root
  `npm ci`), the models outside the repo; `docs/OCR-BENCHMARK.md` "Engine gate" has the method, the
  numbers and the re-run commands.
- **Batch C, the text side** (2026-10-09 — the DGS's answers (1)–(3) and CC16; `418f9d1` `33e037f` `300eb52` `3f9a7f3`, plan §5 has
  the numbers). In `src/transcript/external.ts`: “Code-less rows” (`codelessFit` → `readCodelessCells`, `readCreditBreakdown`,
  `readCodelessRow`; a candidate with `codeMissing: true` has `courseId: ''`, and a document with any coded row keeps none of them —
  the filter after the loop); `readMappedValues` (scanWithMap's value reading, shared with the code-less reader; the “Full Mark”
  exception to GT05 lives there); `sideBySide()` / `sideBySideHalves` and `semesterColumns` / `placeSemester` (CC16 — the
  “First Semester   Second Semester” line heads two columns and is no term header); `COUNTRY_CALENDARS` / `countryCalendar` /
  `calendarSemester` beside `readTermLine` (TH02 — add a country with its source and an evidence pattern for a cell of the
  institution's heading, `institutionHeading`; the table
  is consulted only for NUMBERED semesters and never when a term prints its months); `adjacentConferral` beside
  `degreeConferred`. In `src/ui/external-upload.ts`: `previewRowOf` (a code-less row starts unticked), `idStillMissing`,
  `readyToAdd`, `CODE_MISSING_NOTE` / `codeMissingHint` (W-CL407–W-CL409); `undergraduateInProgress` treats a printed raw
  result as final when it is a mark or a band word (narrowed by the 2026-10-10 review fix). `sameTransferCourse` refuses two empty ids. The replay scorer pairs code-less rows by title. Pinned by
  `tests/codeless-import.test.ts` and the four Batch C blocks of `tests/public-transcript-rules.test.ts`. A parser change to
  these paths is measured on the OCR side by re-parsing the saved `ocr-lines.json` of a bench run (the OCR agent's
  `--reparse`, or a HEAD-vs-change A/B of the parser on those lines) — no engine run needed.
- **Batch C, the OCR side** (2026-10-10 — the DGS's answers (4)–(6); `21c56f9` `e001129` `2560c53`, plan §5 and
  docs/OCR-BENCHMARK.md "Batch C, the OCR side" have the numbers). (4) `ocrCellCorrection` / `scanLead` /
  `ocrCorrectedScan` in `src/transcript/external.ts` (OCR lines only): a corrected token is used only where it
  FILLS credits or a grade the scan's own reading left empty, the title word for word less only corrected tokens
  a raw reading took into it; `readMappedValues` now records `gradeText` so a mapped grade can be traced to its
  token; the row carries `ocrRead` (preview only — `ocrRawNote` / `ocrRawTitle`). (5) `OcrLine.box` / `.page`
  (`ocrPageLayout`, `ocr.ts`), `ExternalCourseCandidate.sourceLines` (OCR parses only), `src/transcript/scan-strip.ts`
  (pure: `stripRegion`, `stripPageSize`, `scaledRegion`), `ocr.ts` keeps `pageImages` (≤ 1,700 px copies; the
  engine's canvases are emptied once read), `src/ui/scan-strips.ts` holds them for ONE preview in a Map keyed by
  row objects and empties them at every close (`releaseScanStrips` — called wherever `preview` is reset; a new
  close path must call it too); the Add builds courses through `courseEntryOf`, field by field — never spread a
  preview row into a `CourseEntry`, or the OCR extras reach the record (`tests/scan-strip.test.ts` would fail).
  (6) `src/transcript/scanner-layer.ts` (`pageLayerFigures`: the CTM through save/restore/cm/forms, the text
  rendering mode with the graphics state; image-backed = an image over ≥ 90 % of the page and no visible text
  after it), `pdf.ts` `pdfToLinesForImport` (operator lists only for a PDF with text, and only while every page is
  a scan), `SCANNER_LAYER_CONFIDENCE` (0) for every line, `pendingScan.reason` `'scanner-layer'` (the offer beside
  the preview, withdrawn by `withdrawScannerLayerOffer` on Add / Cancel; Try OCR clears the preview). The bench's
  L7 reads the same way (`--l7 app`; `exact` / `flag-only` for the A/B; `pdfScanPagesNode`).
- **Batch C review fixes** (2026-10-10, one commit; DECISIONS 2026-10-10 has five rows, plan §5 the numbers).
  Invariants a later change must keep: (a) a country calendar reads the country ONLY from `institutionHeading`
  (the institution's line and the two under it, ended by any field line — `PERSON_FIELD_RE` names a person's
  fields printed without a colon); never widen it back to "any header cell"; (b) `labelledCell` takes the next
  cell only when it is no label, and the adjacent conferral needs a `bareDate`; (c) `ocrCellCorrection` never
  corrects a bar, a whole number of strokes (I/l/1) or a whole number led by a letter, and `ocrCorrectedScan`
  lets only a decimal or a grade leave a title; (d) `parseExternalTranscript`'s third argument
  `{ scannerLayer: true }` (`ExternalParseOptions`) turns the junk-code guard OFF for a scanner's own layer —
  every new caller that parses such a layer (the app, the bench's L7, a script) must pass it, or real rows
  vanish (the DGS kept this trade on 2026-10-10, “(a)”: L7's 94 → 100 flagged extras over any real row lost);
  (e) `undergraduateInProgress` counts a raw result as final only as a mark (`FINAL_MARK_RE`) or a
  band word (`BAND_WORD_RE`) — a new band system's words go in that list, never "any raw grade".
- **The next stage's verification** (2026-10-10, one commit "Transcript accuracy next stage: verification and
  records"; plan §5 has the numbers and what the screenshots show). The e2e now covers two Batch C answers on
  BOTH engines, in `scripts/e2e/drive-transcript.mjs`: the scanned-line strip in the existing OCR leg (every ⚠
  row's `td.cell-scan .scan-strip > canvas` drawn with ink and named W-CL414; an unflagged row's toggle and no
  canvas; at 390 px no page scroll; after Add no strip and no OCR field in the saved record) and a CC15 leg on
  `tests/fixtures/codeless-transcript.pdf` (a fresh record, Master's row: empty required ids, disabled ticks,
  “Add 0 selected courses”, the refused Add, one typed id → one row added under it). The fixture is made by
  `make-transcript-pdfs.mjs` with cells at fixed x — a code-less table needs the gaps a single text stream
  closes — and it is NOT a bench seed (`GENERATOR_PDFS` in `scripts/dev/ocr-bench/seeds.mts` is an explicit
  list, so adding a fixture PDF never moves the bench). A phone crop of the preview hides the window's floating
  panels first (WebKit's element shot paints them in). The e2e scan's rows are both flagged, so the unflagged
  toggle is still pinned only in node, and no e2e fixture is a scanner-layer PDF yet.
- **The cross-browser review** (2026-10-10; DGS: “verify everything (both app and course page) and
  make sure things are shown correctly in Safari, Firefox, Opera, and other common web browsers”;
  DECISIONS has two rows, MAINTENANCE.md § Browsers the floors). Found by a static audit of `dist/`
  (with fuzz-checked rewrites), a Firefox e2e backend, a 120-load layout matrix (3 engines × 4
  pages × 5 viewports × light/dark) and real print-to-PDF; each finding re-verified by a second
  agent. What changed, and why it must stay: the five regex lookbehinds are written out in code
  (both pages were blank on Safari 14–16.3 — invariant 8); pdf.js's legacy build; `writeClipboard`
  tries the copy command FIRST where `ClipboardItem` is missing (Firefox ESR 115 lost the
  tables), before any `await`, so it is still inside the click; the cards' stripe colours come from
  `req-overdue` / `req-duesoon` / `req-notstarted` classes, not `:has()`; the add-a-course year box
  is 84 px (Firefox always draws a spinner); every `.course-form` drop-down and the simulation
  banner's take the text boxes' height, `calc(1.5em + 16px)`, and the transcript preview's
  `calc(1.5em + 10px)` except the compact rows' small "Taken as" (WebKit ignores a drop-down's
  padding but honours a height — `min-height` does nothing there); the preview's credit-system and
  bachelor's-season selects are no longer capped at 74 px, and the credit-system choices are short
  enough for a 320 px phone (W-CL426); row 3's fields may shrink (`min-width: 0` — "Taken as"
  ran the phone page sideways once Where was another university); ✕ names its font, at weight 400
  (Safari drew a small ×, and faux-bolded Zapf Dingbats as Firefox did); a space before each Next
  steps pill so it can wrap at 320 px; `layoutFloats` measures the Next steps box into
  `--float-steps` (and again on Show / Hide), and the page leaves room for both floating boxes at
  its end — under the whole page below 1121 px, under the report column from 1121 px, where the
  440 px boxes cannot reach the footer — plus `scroll-padding-bottom` so a focused control never
  stops under them (the folded bar covered the footer's last links on every phone; a focused link
  sat under the box at 1024 px); at ≤900 px that padding is 24 px more than the bar and boxes,
  with 24 px at the top, because Firefox does not scroll a focused control whose top is already
  inside the padded window (it stopped a third under the box); the report's folds print as the screen has them (DGS, same
  day, reversing Claude's “print them open”: `beforeprint` opens only the footer's disclosure,
  and a print rule hides a closed fold's contents, which Firefox printed); the course list
  prints as the table on every paper (the 860 px card block is `@media screen`; DGS “Tables”),
  fitted to portrait's ~717 px by dropping the page's side padding, tightening cells and letting
  pills wrap; on paper `#app` has no bottom padding (it left a blank last sheet); the course page's schedule cards
  and both pages' contact card ignore the width listeners while printing (Chrome lays a printout
  out at the paper's width: it closed the schedule on portrait paper and moved the card after
  pagination, leaving a blank last sheet), and `placeContact` moves the card only when its host
  changes (re-inserting it dropped keyboard focus on every print); the card never splits across
  sheets (`break-inside: avoid`); on paper the All courses header's sort buttons are
  `display: contents` (Chrome repeated the header as an empty band on later landscape pages);
  `<link rel="icon" href="data:,">` on both pages (no /favicon.ico 404); below the PDF floor a
  failed import says the browser is too old (`src/ui/pdf-support.ts`, W-CL425); OCR compiles an
  empty WebAssembly module before starting its worker, so a host's CSP without
  'wasm-unsafe-eval' fails at once into the plain message instead of hanging at 0 % and blocking
  every import; the Notre Dame
  refusal check reads only the stretch a match can cover (`endsWithUniversityOf`: the first
  version was quadratic). The e2e pins the print folds (the footer's opened, the report's left as the
  student had them, a closed one's contents hidden under print media), printing at paper width
  and the course tables on portrait paper (`checkPrintAtPaperWidth`), the credit-system note
  when changed by hand (`checkCreditNote`), the narrowest phone loaded at 320 px folded and
  unfolded (`checkNarrowestPhone`), the desk widths' padding (`checkDeskFloats`), the form's
  drop-down heights (row 3's included) and year box (`checkFormControls`), the stripes — due
  soon, not started, overdue (`checkCardStripes`), the preview's drop-downs at 1400 and 320 px
  (`checkPreviewSelects`), the contact card while printing and its focus
  (`checkContactWhilePrinting`) and an unreadable file with and without the old-browser message
  (`checkUnreadablePdf`), in all three engines; Chrome's e2e profile is emptied each run, and a run
  refuses ports another run is using. Not
  done, by choice: real Safari (needs `safaridriver --enable`), Opera/Edge (Chromium — the Chrome
  run), iOS (no simulator runtime on the Mac); the opening notice's `:has()` highlight; Firefox's
  smaller ◐; headings left at the foot of a printed page; a two-line sticky score bar reaching
  under the warnings box.
- **Batch A at a glance** (2026-10-09, transcript accuracy program — the index; the two bullets
  after this one carry the reasons, STATE.md's "Batch A done" paragraph and
  `docs/TRANSCRIPT-ACCURACY-PLAN.md` §5 the numbers). The harness:
  `scripts/dev/score.mts:scoreDocument` — the one metric (header fields got/want, rows aligned by
  `normalizeCourseId` + year, cells per field, `exact` = the test's pass), pinned by
  `tests/replay-score.test.ts`; `tests/helpers/row-of.ts:rowOf` — the row string every corpus test
  and script compares; `scripts/dev/pdf-lines-node.mts:pdfToLinesNode` / `pdfToPagePngs` — the one
  Node pdfjs loader (the browser's own line builder; page PNGs through `@napi-rs/canvas`);
  `scripts/dev/replay.mts` (`npm run replay`: `--corpus`, `--pdfs`, `--verify`, `--only`, `--out`,
  `--baseline` — regressions first, exit 1 — and `--quiet`) — the scoreboard per corpus, lens and
  country; `scripts/dev/public-status.mts` — its alias; `tests/external-names.test.ts` — the F5
  precondition (every ExternalCourses name read as printed). The parser, all in
  `src/transcript/external.ts`, each rule pinned in `tests/public-transcript-rules.test.ts`:
  F1 `tailGradeToken` + `RowScan.gradeText` (a code alone, or a wrapped title, takes the next line
  only when it ends in the credits and a grade), `columnKinds` (points vs grade under the header in
  force), `gradelessRow` (the in-progress integer in the title); F2 `TERM_CODE_CELL_RE` /
  `rowTermOf` (compact term-code cells), `bannerTermKey` / `IDENTIFIER_LABEL_RE` / `plausibleYear`
  (six-digit Banner codes only with the document's own key), `PAREN_DATES_RE` / `rangeYear`
  (Workday term headers); F3 `LEAD_CODE_RE` (a one-letter middle, a dash after the number, never a
  term word), `dropSection` (Colleague's section cell). The specimens: 20 `pdf-*` line lists in
  `tests/fixtures/public-transcripts/` (Alberta CR/NC, Evergreen RAA, five negatives, 13 McGill
  Minerva pages), each with a `sources.json` note naming its placeholder, the PDFs under their
  fixture names in `~/degree-audit-samples/public-pdfs/` (`--verify` hashes them), 13 of them on
  `tests/fixtures/public-transcripts-known-failing.json` with the Batch B family each waits on.
  Replay files in `~/degree-audit-samples/bench-out/`: `text-baseline-20261009.json` (before Batch
  A) and `text-batch-a-final.json` (after; identical on the 127 fixtures both hold).
- **Parser fixes F1–F3** (2026-10-09, transcript accuracy program, Batch A step 4; the DECISIONS rows
  of that date quote each rule). Each lives beside its code in `src/transcript/external.ts`:
  `tailGradeToken` (a code alone on its line, or a wrapped title with a four-word continuation,
  takes the next line only when it ENDS in the credits and a grade token, the row's grade is read
  from THAT cell — `RowScan.gradeText` — and the words added to the title hold no `PROSE_WORD_RE`
  word; the 2026-09-26 "numbers line only" rule stays for shorter continuations); the header in
  force, `columnKinds` (a gradeless row's trailing two-decimal number is points only under the
  CURRENT header when it mapped a Points column, or in the credits/earned/points triple — never from
  credits × 4, never from another table's header); `gradelessRow` in `scanTokens` (the integer
  before a trailing decimal joins the title only in an in-progress block or under a header with no
  grade/mark column); `TERM_CODE_CELL_RE`, `rowTermOf` and `bannerTermKey` (compact "2023FA" codes
  decoded from a header-mapped term cell or the first cell before the course code; six-digit Banner
  codes only with the document's own key line, because the convention differs between schools —
  Notre Dame's 202610 is Fall 2026; the key is read from the whole document before the rows, from
  lines that are not course rows, only when the code's year is within one of the named year and the
  number is not labelled as an identifier, and a decoded year is kept only within a year of the
  document's printed years — `plausibleYear`); `PAREN_DATES_RE` and `rangeYear` in `readTermLine`
  (Workday's parenthesised date range stripped — or, when it holds the line's only year, the dates'
  year taken); `LEAD_CODE_RE` (a one-letter middle, "ENG M 612", printed as a capital; a dash after
  the number dropped; a term word of `TERM_WORD_RE` never a subject, so "SEMESTRE I 2019" stays a
  heading) and `dropSection` (Colleague's zero-padded section cell). Every rule is pinned in
  `tests/public-transcript-rules.test.ts`; the replay stayed identical to the baseline (false rows
  on negatives 0/32) through all three commits and the review-fix commit that followed them (the
  2026-10-09 review of F1–F3: six findings, five DECISIONS rows) — a parser change that moves the
  board needs a fixture explaining why, not a re-baseline.
- **Batch B at a glance** (2026-10-09, transcript accuracy program — the index; the bullet after this
  one carries the reasons, STATE.md's "Batch B done" paragraph and `docs/TRANSCRIPT-ACCURACY-PLAN.md`
  §5 the numbers). The fixtures (step 6, `ab2d41c`): 21 composed line lists in
  `tests/fixtures/public-transcripts/`, each `kind: composed` in `sources.json` with the registrar or
  vendor documentation it follows (Workday Student, Colleague, CUNYfirst, Oregon's Banner quarter,
  UCLA's eTranscript, McMaster Mosaic, Western Ontario, Ladok, SNU, Sabanci, the Ukrainian supplement,
  the Algerian relevé, IIT, NIT, HEC, an Iranian translator rendering, North South University,
  Tribhuvan IOE, and the Parchment / NSC / eScrip-Safe wrappers around existing fixtures), the open
  ones on `tests/fixtures/public-transcripts-known-failing.json` with their family. The parser and
  the layout stage (step 8: F6 `bc5f1ba`, F5 + F3's mark `a803ef2`, F4 `4ca40c7`, the review
  `0af7c3d`; pinned in `tests/public-transcript-rules.test.ts`, `tests/layout.test.ts` and
  `tests/campus.test.ts`): `src/transcript/external.ts:cellKinds` / `joinedHeaderKinds` (header
  cells cut at a space, two-line headers joined), the `stat` column kind and the composed fixtures'
  words in `COLUMN_KIND_RES`, `scanWithMap` (`numericFillsRest`, `letterAfterNumericGrade`,
  `statWithoutCredits`, `integerGradeInLetteredTable`), `fits` / `postCells` /
  `TERM_NUMBER_HEADER_RE` / `rowTermOf` (a bare number is a term cell only under a term-numbering
  word, McMaster's ordinal only under "TM"), `creditHoursHeader` / `IBERIAN_HEADER_WORD_RE` ("CH"),
  `transferScope` / `VENDOR_RE` / `FROM_LINE_RE` / `AFFILIATED_RE` / `ACADEMIC_YEAR_LABEL_RE` (what
  never names the university), the `exemptions` block, `MULTI_TERM_MARK_RE`;
  `src/transcript/nd-markers.ts:RECIPIENT_LABEL_RE` / `RECIPIENT_HEADING_RE`;
  `src/transcript/campus.ts:resolveCampus` (a campus under its printed system);
  `src/transcript/layout.ts:dropWatermarks` (tiles only where a word repeats down the page),
  `pageLayout` / `columnLayout` / `ColumnHint` / `courseColumnEvidence` (the short last page split by
  the previous page's gap), `groupLines` / `glyphPage` (the glyph join per line). Not built: step 7's
  positioned PDFs (`tests/fixtures/make-transcript-pdfs.mjs` unchanged — the short two-column last
  page is a run-array case, the Parchment wrapper a composed line list; DECISIONS 2026-10-09). The
  closing commit fixed `scripts/e2e/drive-transcript.mjs`, which still asserted the skipped-rows
  warning's pre-W-CL372 sentence (a student-facing sentence the e2e reads changes in the driver in
  the same commit). Replay files in `~/degree-audit-samples/bench-out/`: `text-after-composed.json`
  (after step 6), `text-after-F6.json`, `text-after-F5.json`, `text-after-F4.json`,
  `text-after-F4F6-review.json`, and `text-batch-b-final.json` (the end of Batch B — against
  `text-batch-a-final.json`: 0 regressions, 22 improvements, public exact 129/147 → 147/168, pdfs
  7/20 → 47/49 as `public-pdfs/` grew to 49 through the OCR benchmark's `--fetch`).
- **Batch B step 8 — parser and layout fixes F4–F6** (2026-10-09, transcript accuracy program; the
  DECISIONS rows of that date quote each rule, STATE.md's "Batch B step 8" paragraph and the plan's §5
  the numbers). Three commits, each with its replay delta in the body — F6 `bc5f1ba`, F5 (+ F3's
  multi-term mark) `a803ef2`, F4 (this one). `src/transcript/external.ts`: `cellKind` / `cellKinds`
  (a header cell's kind with whether the pattern named it whole — a cell no pattern names whole is
  cut at the one space where both parts are header words of different kinds, "Cr. / C.E.U. Grade";
  a cell named only by a word inside it, "Remarks Earned", is cut only when its first part is a
  remarks-type word; a cell the grade pattern names whole is never a mark, "Grade Remark");
  `joinedHeaderKinds` (a two-line header joined column by column when every joined pair is a header
  word — Alberta); the `stat` column kind (class statistics, with McMaster's "(242)" count) and the
  header words of the composed fixtures (`COLUMN_KIND_RES`: Course Listing, Subno, TM, SU CREDIT,
  C.E.U., CH, UNTS, Scope, GPs, Grade Remark, Classification-after-a-grade → flag, FHEQ Level stays
  a flag); in `scanWithMap` four costed fit rules — `numericFillsRest` (the grade column is empty
  when every remaining number has a numeric column of its own), `letterAfterNumericGrade` (the
  2026-09-26 title-digit rule under a header, cost three), `statWithoutCredits` (cost one) and
  `integerGradeInLetteredTable` with `headerGrades` (a registered row under a lettered grade column,
  cost two; the first row of a table has no such evidence — a documented limit); `rowTermOf(cells,
  mapped)` reads a bare TM ordinal only from a mapped cell; `transferScope` (the university guess
  skips a transfer block), `VENDOR_RE` / `FROM_LINE_RE` / `AFFILIATED_RE` / `ACADEMIC_YEAR_LABEL_RE`
  (never the university), the "academic / electronic transcript from" strip, the US-address strip,
  the `exemptions` transfer block (Minerva's "Credits/Exemptions": bare rows skipped and counted until
  the first full row), `MULTI_TERM_MARK_RE` in `dropSection`. `src/transcript/nd-markers.ts`:
  `RECIPIENT_LABEL_RE` / `RECIPIENT_HEADING_RE` (a delivery cover addressed to Notre Dame is not a
  Notre Dame transcript). `src/transcript/campus.ts`: a campus's own name resolves through the
  system printed in the header. `src/transcript/layout.ts`: `dropWatermarks` counts a short word's
  tile positions only where it repeats down the page; `pageLayout` / `columnLayout` / `ColumnHint`
  (a short last page splits at the previous page's gap when ≥ 30% of its baselines hold a run at
  the hinted right edge with two wordy texts there and nothing crosses — `src/transcript/pdf.ts`,
  `scripts/dev/pdf-lines-node.mts` and `scripts/diagnose-transcript.mjs` pass the hint page to
  page; `findColumnGap` keeps its shape for the sanitizer); the glyph join is per line (80% of a
  baseline's runs). Pinned: `tests/public-transcript-rules.test.ts` (F6, F5, F3 blocks),
  `tests/layout.test.ts` (the F4 block, with `banner-transcript.pdf` through the Node loader equal
  to `BANNER_LINES`), `tests/campus.test.ts`. The Alberta fixture's lines were regenerated from its
  PDF (only page 2's header pairs changed) and its CR rows re-checked to S. Off the known-failing
  list: 14 fixtures (Alberta, nine Minerva pages, the eScrip-Safe wrapper, IIT, HEC, and the Minerva
  cegep/transfer/multi-term pages); 21 remain, each entry naming only the families still open (F2,
  F3, F1, CC15/CC16/TH02, the DGS questions, open question (g), the transcript gate). Numbers vs
  `bench-out/text-after-composed.json` (Batch B step 6's baseline): public exact 133 → 147 of 168,
  pdfs exact 36 → 47 of 49, 0 regressions at every step; files `text-after-F6.json`,
  `text-after-F5.json`, `text-after-F4.json`. Not done here (other families, other agents): F2's
  Workday / Nepal term headers, F3's McMaster / SNU / UCLA code shapes, F1's UCLA "IN PROGRESS"
  header, Ladok's module lines and "Date of issue", Western's suffix terms, Oregon's glued symbols,
  CUNY, the Ukrainian / Algerian pages, Bangladesh's trimester evidence; W-CL372 is the one new
  student-facing string (the skipped-rows warning names a transfer-credit OR credits/exemptions
  heading). **The 2026-10-09 review of F4–F6** (one commit, "Batch B F4-F6: review fixes"; four
  confirmed findings, each reproduced on HEAD, fixed and pinned; four DECISIONS rows): in
  `external.ts`, `fits(kind, token, header)` takes the header word over the column (`postCells`,
  from `lastHeaderCells`) — a bare one- or two-digit number is a term cell only under a word that
  numbers terms (`TERM_NUMBER_HEADER_RE`) and is READ as McMaster's ordinal only under "TM"
  (`rowTermOf(cells, ordinal)`; under "Semester" / "Year" the row keeps its header's term); "CH" in
  a Portuguese or Spanish header (`IBERIAN_HEADER_WORD_RE`) is the workload, and under an English
  CH header a value outside the narrow credit-hour range leaves the credits blank
  (`creditHoursHeader`). In `layout.ts`, the hinted split asks both sides for a course column
  (`courseColumnEvidence`: a term header, a Banner total or section title, a course code, a subject
  run followed by its number), so a label/value block is read whole; `groupLines` joins a line at
  50% glyphs when the page is 60% glyphs over 20 runs (`glyphPage`), the 80% line test otherwise.
  Pinned in the "review of F4–F6" block of `tests/public-transcript-rules.test.ts` and the
  "(b, review)" / "(c, review)" cases of `tests/layout.test.ts`; replay
  `bench-out/text-after-F4F6-review.json` identical to `text-after-F4.json` (0 regressions,
  0 improvements).
- **The transcript replay and its scorer** (2026-10-09, transcript accuracy program, Batch A steps
  1–3). `scripts/dev/score.mts` is the ONE scorer: `scoreDocument(parsed, expected)` → header fields
  got/want/ok (skipped on a `negative`), rows aligned by `normalizeCourseId` + year then id alone
  (matched / missing / extra), cell accuracy per field over the matched pairs, and `exact` = the
  corpus test's own pass criterion — `tests/replay-score.test.ts` asserts that equality for every
  fixture of both corpora, so never let the scorer and the tests drift. `rowOf` lives in
  `tests/helpers/row-of.ts` (nothing imports a `*.test.ts` file — that runs its suite).
  `scripts/dev/pdf-lines-node.mts` is the one Node pdfjs loader (`pdfToLinesNode(file, onPage?)`,
  the browser's `runsFromTextItems` → `runsToLines` with verbosity 0 and the standard-font folder;
  `pdfToPagePngs(file, dpi, outDir)` through pdfjs + `@napi-rs/canvas`, pdfjs-dist's own optional
  dependency, for the OCR bench) — `pdf-to-lines.mts`, `diagnose-transcript.mjs` and the replay call
  it (diagnose therefore now opens a PDF exactly as pdf-to-lines does; it used to omit the font
  folder, which changed a few column gaps). `npm run replay` (`scripts/dev/replay.mts`; `--corpus`,
  `--pdfs`, `--verify`, `--only`, `--out`, `--baseline`, `--quiet`) prints the scoreboard per corpus
  and per sources.json lens/country; `public-status.mts` is its alias and now agrees with the test
  (122/127, 5 known-failing at step 3; 129/147, 18 known-failing at the end of Batch A; 147/168, 21 at the end of Batch B). Sample PDFs live outside the repo in `$TRANSCRIPT_SAMPLES`
  (default `~/degree-audit-samples/`: `public-pdfs/`, `private/`, `bench-out/`); the baseline is
  `bench-out/text-baseline-20261009.json`. `tests/external-names.test.ts` is the F5 precondition:
  every ExternalCourses name (fixture tab + `data/snapshot.json`) must keep reading as printed —
  run it before touching `guessUniversity` / `stripRecordWords` / `normalizeUniversity`.
- **A university named only in an image** (2026-09-08): `NAME_ONLY_IN_IMAGE` in
  src/transcript/external.ts maps an acronym to a school's real name, tried ONLY after every
  text-reading pass in `guessUniversity` has failed. Keep it that way — it is a fallback, not a
  rule — and keep the patterns case-sensitive. Two entries: Johns Hopkins ("JHU", whose dotted code
  "EN.601.433" is the second branch of `LEAD_CODE_RE`, which requires BOTH dots) and UC San Diego
  ("UCSD"). `guessedUniversity` orders it: strong printed name, then the acronym, then the weak
  "… College" pass — the acronym has to beat the weak pass, or a "DEGREES AWARDED BY OTHER
  INSTITUTIONS" block names the transcript. A name from the table sets `universityGuessed`, which
  leaves the preview's box EDITABLE; a name read as text stays locked. `plausible` also drops a
  cell that is only a generic word ("UNIVERSITY") or that repeats one (a page watermark).
  Since 2026-09-26 the table also holds brand-only headers (KU Leuven, ETH, KTH, TUM, KAIST …),
  and since 2026-09-28 one entry keyed on an ADDRESS rather than an acronym: Rensselaer draws its
  wordmark as vector art, so its ZIP+4 (12180-3590) or registrar phone (518-276-6231) is the only
  text that names it. Prefer a unique ZIP+4 or phone over a city name — Troy, NY has three colleges.
- **`transferable` has four values** (2026-09-08; `adgs_approval` added 2026-09-12): `Transferable = 'yes' | 'no' | 'dgs_approval' | 'adgs_approval'`
  in data/types.ts, replacing the old boolean — the compiler flags every comparison the change
  invalidated (allocate.ts three, phd.ts's transferRow, grad-admin-request.ts); `grep '\.transferable'`
  for the full list, review.ts included. `dgs_approval`
  means the DGS decides that course one student at a time; it must behave as a CANDIDATE
  everywhere, so `=== 'yes'` is the test for "pre-approved" and never `!== 'no'`. review.ts keeps
  such a course in the request (a decision about the course, not about the student), and the Grad
  Admin's processing request must not pick it up without `attestations.transferApproved`. No
  surface explains WHY such a course is decided case by case: the DGS ruled (2026-09-08) that
  whether it serves the student's research is settled between the advisor and the DGS, so every
  string names the open decision and stops. Do not add the reasoning back to the review card, the
  course line, the sign-off row or the §5.2 card.
- **The course-rules page has no "every category" category** (2026-09-08). A course the sheet marks
  `any` is listed in EACH of the five §4.4.2 cards and matches each of them in the filter; the note
  above the cards carries the "it can fill only one" rule, and the numbers in that note and in the
  legend are read from the Parameters tab (`category_courses_required`,
  `category_distinct_groups_required`, `category_min_grade`) — a missing one drops the numbers
  rather than printing a guess. Do not re-add an `any-listed` filter value. While there: the table's
  sort puts a blank cell LAST by returning `undefined` from `key()`; the old `'~'` sentinel did the
  opposite, because `localeCompare` orders punctuation before letters.
- **What a course counts toward** (2026-09-08). `CourseLine.counts` is built in `audit()` from the
  rows' `satisfiedBy` (met) and `pendingBy` (in progress / provisional), read as an inverse index —
  a new requirement row needs only to fill those two fields to appear on its courses' lines, and
  must NOT put non-course ids in them (residency lists semesters; the index drops ids that are not
  in the record). `pendingCourseIds` is the tier-aware twin of `countedCourseIds`. The §4.4.2 row
  also exposes `groupChoices` (course id → groups no other course covers) for the dropdown.
- **Usability pass, 2026-09-08.** `renderReport(report, untouched)` / `renderSummary(report, untouched)`
  and `dial(report, untouched)` carry the empty-state; `untouched` is computed once in `render()`.
  `rememberFocus` now also records open `details[data-key]` and `[aria-expanded="true"][data-key]`
  and `restoreFocus` re-opens them BEFORE focusing — any new disclosure needs a `data-key` to
  survive a re-render. `Student.isExample` marks the demo record (stripped on file import).
  Watch the CSS ordering trap that caused half of this: an `@media (max-width: 600px)` block placed
  ABOVE the base rules it overrides loses at equal specificity — the phone block near the end of
  style.css is the live one. The e2e now pins the first-visit headline, the folded list, the phone
  touch targets, the one-column pill, the one-track course form and the surviving § quote.
- **Credits can be fractional** (DGS 2026-09-08). A university's `credit_system` marks it as
  quarter- or trimester-based — in the **Universities** tab since 2026-10-10 (one row per
  university; `parseUniversitiesTab`, then `universityCreditSystems` in data/assemble.ts builds
  `rules.universityCreditSystems`, reading the old per-course ExternalCourses cells only when a
  sheet has no Universities tab and otherwise warning that they are no longer read);
  `universityCreditSystem` / `ndEquivalentCredits` in data/external.ts resolve it (a fixed `nd_credits` still wins), and `classify` sets `effectiveCredits` plus
  `creditsConverted`. The arithmetic keeps FULL precision — 9 quarter hours must total exactly 6
  against the §5.2 cap — so never round in the engine; print through `formatCredits`
  (src/engine/credits.ts), which is already wired into the threshold rows, the course line and the
  processing request. A new credit figure shown to a student needs it too.
- **Institution names are spelled out** (2026-09-08): `expandInstitutionAbbreviations` in
  data/external.ts, applied to the parsed name, to hand-typed names, to the sheet's own names in the
  datalist, and inside `normalizeUniversity` so matching is abbreviation-insensitive. Adding an
  abbreviation means adding one row to `ABBREVIATIONS` — keep it conservative: a bare "Tech" is a
  real name ("Georgia Tech"), and "St." is ambiguous.
- **Parser fixes of 2026-09-08**: "ID" is a real subject (Georgia Tech industrial design) and is no
  longer a stop-word — only "ID <number>" with no title is refused; the institution pattern accepts
  "Inst. of Technology"; and `prefillLevelsByTerm` takes `bachelorsNamed` and does nothing without
  it, so a three-year Master's is no longer split like a 4+1.
- **Preview row layout and the bachelor's term** (`src/transcript/preview-layout.ts`, DOM-free, 2026-09-08).
  `rowIsCompact` — the one-line row is ONLY for a text-layer row whose credits, grade and year were
  all read; a row holding any input must keep the wrapping labelled layout, or `flex-wrap: nowrap`
  pushes its controls out of the card (the "Taken as" dropdown sliced off, a sideways scrollbar).
  `bachelorsPrefill(handSet, fromTranscript)` — a term the student set by hand beats a new
  transcript's conferral date; an inferred one does not. Both are unit-tested; the e2e's combined
  import now asserts the hand-set term survives, since step 3c sets one before it.
- **Today's date comes from the server, in Notre Dame's zone** (DGS 2026-09-07). `src/data/clock.ts`:
  `notreDameDate/notreDameLabel` format any instant in `America/Indiana/Indianapolis`;
  `serverInstant(url, fetch, timeoutMs)` reads the `Date` header of a same-origin `HEAD` (`no-store`,
  `Age` added back, 2 s abort) and resolves `undefined` on any failure; `notreDameNow` prefers it and
  falls back to `deviceNow`. `loadRulesWithCard` runs the probe beside the rules fetch, shows it as
  the first step, and now resolves `{ rules, today }` — `startApp` and `renderCoursesPage` take that
  date instead of calling `new Date()`, so nothing in the app reads the device calendar. Do NOT swap
  this for a public time API: it would break the page's printed promise that nothing goes to a third
  party. The fetch is injectable, so `tests/clock.test.ts` never touches the network.
  Standing card and the sign-off row (DGS 2026-09-07): the heading chip reads "current semester: …"
  (`currentSemesterChip`); the entry-term legend comes from `enteredProgramLabel()` and names the
  program, so messages quote "your entry term" rather than the field's name (e2e pins the new
  wording); "Bachelor's degree awarded" is required — legend "(required)", `required` attribute while
  unset, always-amber hint, and an `audit()` warning once any course is entered. `approvalsRow` splits
  its courses with `signOffActors(reason)` (dgs / advisor / gradAdmin, "pre-approved" → gradAdmin) and
  is `needs_dgs_review` only when the DGS still has something to decide, else `in_progress`. The
  groups are MUTUALLY EXCLUSIVE, keyed by the sorted actor list ("advisor,dgs" gets its own lead), so
  no course is printed twice; `coursesNeedingDgsReview` is consulted as a second source, because a
  pre-approved transfer whose §4.4.1 area is still blank is the Grad Admin's AND the DGS's. Splitting
  one detail part into several broke `advisorSummary`, which counts items rather than courses — it
  now de-duplicates before joining, and `tests/external-rules.test.ts` drives that path through a
  real `audit()` (the advisor-summary fixtures are hand-built and did not catch it).
  `reclassifyNotreDameCourses` re-levels rows ALREADY filed as prior on every call (2026-09-07):
  the old `if (c.origin === 'transfer') continue` made the result depend on whether the award term
  was set before or after the import. Keep it order-independent — `tests/prior-nd.test.ts` pins it.
  Undergraduate wording (DGS 2026-09-07): "Undergraduate credits do not transfer" became "Courses
  taken as an undergraduate student do not transfer, whether or not the course itself is a graduate
  course" (app.ts group heading, external-upload.ts preview hint and empty-preview message), and
  `classify`'s `degreeLevel === 'bachelors'` branch appends `ugNote` — "; taken as an undergraduate
  student — no transfer credit (§5.2)" — to all four of its reasons. Keep the core-knowledge term
  FIRST: `buildExplanation`'s mark regex keys on `^satisfies` / `^may satisfy`, so leading with the
  transfer note would repaint those lines red.
  Pre-approved transfers (DGS 2026-09-07): `buildExplanation` detects an `approvalPending` that
  starts "pre-approved" and leads the line with "pre-approved by the DGS — will count … as transfer
  credit once the Grad Admin has processed it" (the note's repeated opening is stripped; the
  `approvalPending` string itself is unchanged — advisor-summary routes on its "pre-approved"
  prefix); `transferRow` is `in_progress` when every pending transfer is ruled transferable.
  Tests: external-transcript.test.ts (wording describe), transcript.test.ts (labels), term.test.ts,
  grad-admin-request.test.ts (count), external-rules.test.ts (casing).
- **The DGS's answers to the open items** (2026-09-06 evening; DECISIONS rows of that evening):
  the wording review is closed and `docs/WORDING-REVIEW.md` removed — a student-facing string Claude
  drafts is now listed, numbered, in the reply that delivers it (CLAUDE.md says so); the two-year
  "Taken as" rule runs only when the transcript states NO level (`prefillLevelsByTerm` returns
  early when any row has `levelSource: 'transcript'` — the transcript's own markers decide,
  unlabelled rows keep the slot's level); the opening notice keeps asking on every visit (no
  30-day memory — don't add one); the §4.5 examination is "Oral Candidacy Exam (OCE)" in every
  string of our own — `CANDIDACY` group label and row title in phd.ts, its details and the
  along-the-way MSCSE row, the milestones `dateField`, the glossary entry in report.ts, the
  standing-card deadline note in app.ts, the advisor summary's to-dos — while the handbook
  quotes behind the § chips stay verbatim ("The candidacy exam must be taken…"); the id
  `phd.candidacy` and the `candidacy_*` parameter keys are unchanged. Tests pin the strings
  (advisor-summary.test.ts, level-prefill.test.ts).
- **Safari's engine in the e2e run** (2026-09-06 evening, DGS request; the subgrid incident that
  afternoon showed Chromium alone is not enough): `E2E_BROWSER=webkit npm run e2e` (also `npm run
  e2e:webkit`) drives the SAME four drivers through Playwright's WebKit build; screenshots in
  `.e2e-out/webkit/` (the Chrome run keeps `.e2e-out/*.png`; each run clears only its own).
  Mechanics: `scripts/e2e/webkit.mjs` wraps a Playwright page in the session shape the drivers
  already use (`send` / `evalJs` / `waitFor` / `shot` / `shotElement` / `setFileInput` / `open` /
  `close`); the drivers' few direct DevTools-Protocol calls are translated in one `switch`
  (`Page.navigate` → `page.goto`; `Emulation.setDeviceMetricsOverride` → `page.setViewportSize` —
  the `mobile` flag has no per-page equivalent in Playwright and the app's breakpoints are
  width-only; `Input.dispatchKeyEvent` → `page.keyboard`); anything else throws, on purpose, so a
  new CDP call in a driver is noticed. What both backends share — `waitFor` and the
  loading-card / opening-notice choreography of `open` — moved out of cdp.mjs into
  `scripts/e2e/session-common.mjs`: change the start-up flow there, once. `playwright-core`
  (Apache-2.0) is a devDependency pinned EXACTLY (each version maps to one WebKit build) and is
  imported lazily, so the Chrome run and CI never load it; the browser itself is not in
  node_modules — a one-time `npx playwright-core install webkit` per Mac puts it in
  `~/Library/Caches/ms-playwright/` (shared by every worktree; after bumping the pin run it again;
  the harness prints that command when the build is missing). Verified 2026-09-06 on the DGS's
  Mac: all four drivers pass on WebKit 26.6 — pdfjs, the OCR leg, file inputs, the modal dialog,
  axe-core, the 390 / 820 px layouts; WebKit and Chrome differ by 1–2 px in row heights and
  column x. Found by the first run: the one-line preview rows (`@container (min-width: …)` in
  style.css) were keyed on a 600 px preview while the decision of 2026-09-06 records 560 px, so an
  1100 px window (preview content box 582 px; 642 px at 1400 px) showed two-line rows in both
  engines — the CSS now says 560 px, and drive-transcript.mjs's `checkCompactPreview` measures
  the Master's-slot combined preview at 1400 and 1100 px (every cell on the row's first line, the
  credits / grade / term / level columns at the same x in every row, nothing past the row or
  scrolling the preview sideways) and crops it to `combined-preview-1400.png` / `-1100.png`
  (`shotElement`: Playwright's element screenshot on WebKit, a page-coordinate `clip` on Chrome).
- **Usability review, Phase 0 — accessibility and phone mechanics** (2026-09-05, DGS-approved from
  the merged review in the project doc; the wording items of Phases 1–2 await his approvals):
  `render()` in app.ts now REMEMBERS FOCUS across the full rebuild (`rememberFocus`/`restoreFocus`:
  the focused control's stable `data-key`, else its index path from the root, plus text selection
  and scroll position; `focusAfterRender` names the control to focus when the current one will not
  exist — after Remove, Add course, a closed preview, a dismissed error) and announces the new
  headline through `srStatus`, a visually-hidden polite live region created ONCE outside the root
  (a region re-created by the rebuild is never announced). Give every control that triggers
  `update()` a `data-key` (naming: `standing.prior`, `course.<index>.remove`, `preview.row.<i>`,
  `ext.row.<i>.credits`, `milestone.<key>`, `attest.<slug>`, `sort.<key>`, `filter.<name>`…); the
  path fallback covers the rest. The opening notice is a native `<dialog class="consent
  consent-overlay">` shown with `showModal()` (focus on Agree, Tab contained, page inert, Escape
  closes like Agree, focus lands on the h1 — `tabindex=-1`); cdp.mjs still clicks
  `.consent-overlay button.btn`. Labels: fieldset+legend for the entry term (program-dependent,
  `enteredProgramLabel()`) and the course
  form's Term (`fieldset()` helper), visible "Course number (e.g. CSE 60641)" / "Title" labels
  instead of placeholders, `aria-pressed` on the program tabs (`role=group`), row-specific
  `aria-label`s in both preview tables ("Credits for CS 25100"), the specialization `<select>` in
  the course table named per course, visually-hidden header text for the checkbox/remove columns.
  Remove is `aria-label="Remove CSE 60641 (Fall 2026)"` with an Undo in the toast
  (`toastWithAction`, 8 s, `.toast.has-action` is clickable) — same for a previous-transcript
  slot's Remove. Errors persist inline (`.import-error`, role=alert, tabindex=-1, focused; Dismiss
  button): `ndImportError` in app.ts, `importError`/`previewError` in external-upload.ts, the
  course form's `.field-error` with `aria-invalid`/`aria-describedby`; parser warnings render as
  `.import-warnings` inside the ND preview; toasts remain for confirmations and "Reading…".
  Landmarks: skip link → `<header class="masthead">` → `<main id="main">` (banners, layout, toast)
  → `<footer>`; the report column is `#report` (tabindex=-1); the contact card is a `section`
  region (an `<aside>` inside the header failed axe's complementary-is-top-level). Citation § chips
  are disclosure buttons (`aria-expanded`/`aria-controls`, named "§4.2 — show the handbook rule…").
  CSS: `--gold-text: #7a6220` for every gold TEXT use (`--gold` stays for rules/borders; #ae9142
  measured 2.9:1 at 12 px), one `:focus-visible` rule for all interactive elements, ≥24 px targets
  (`.cite`, `.btn.tiny`), `.visually-hidden`, `.skip-link`, `dialog.consent::backdrop`; phone
  layout: `.layout > * { min-width: 0 }`, course tables wrapped in `.table-scroll.plain`
  (focusable region — `position: relative` on the wrappers so the absolutely positioned hidden
  header labels are clipped with the table instead of widening the page), `@media (max-width:
  600px)` paddings, N/A rows toned by colour not opacity (the faded pill measured 4.3:1). The
  auto-counted full-time term is text ("✓ Spring 2028 — counted automatically"), not a disabled
  ticked box (drive-transcript.mjs strips the prefix/suffix). Course-rules page: visible labels
  above the filters (`labelled()`), a "Clear filters" button shown only while a filter is active
  (`filtersActive()`), the count line is a persistent `role=status` region (`countLine`),
  spacing-insensitive search (`squash()`), `aria-sort` + descriptive names on the sort buttons
  (focus restored after the table rebuild by `data-key`), `<caption>` (visually hidden),
  `<th scope="row">` for the course id (styled back to a body cell), the DGS notes as a per-row
  Notes disclosure button opening a `tr.note-row` (the `title` tooltip on rows is gone; the
  overview links keep theirs), the legend now BEFORE the table as a one-line pill key plus a
  `<details>` "How to read the columns", the scroll wrapper focusable (`tabindex=0`, region), a
  `<main>` and a skip link. Guard rails: `scripts/e2e/drive-a11y.mjs` (dialog focus/Tab/Escape,
  focus preserved after a dropdown change and a checkbox click, no horizontal scrolling at 390 px
  on both pages with `phone-app.png`/`phone-courses.png`, axe-core WCAG 2.x A/AA + best-practice
  with ZERO violations on both pages) — `axe-core` is a devDependency for this only (MPL-2.0,
  never shipped); `E2E_ONLY=<substring>` runs one driver. The review's findings, evidence and the
  remaining Phases 1–2 live in the project doc `degree-audit-app-usability-review.md`.
- **External parser: long subject codes** (2026-09-06, DGS bug report — UMass "COMPSCI",
  "STATISTC" rows were skipped). In `src/transcript/external.ts` `LEAD_CODE_RE` takes
  `[A-Z]{2,10}` (was 6), `SUBJECT_RE` `{2,10}` (was 7), the security-mark lookahead `{2,10}`;
  the new `subjectCase(original)` guard requires a subject of 7+ letters to be printed in
  CAPITALS in the original text (shorter ones stay case-insensitive per 2026-09-04), and
  `CODE_STOPWORDS_RE` grew by the transcript words that precede numbers (COURSE, SECTION,
  CHAPTER, LEVEL, STUDENT, RECORD, DEGREE, PROGRAM, COLLEGE, MAJOR, DATE, GRADE, CREDIT, …). The
  unused `CODE_RE` constant is gone. Regression check: the 17 sanitized line dumps in the
  session scratchpad — 16 unchanged, t17 +3 rows (all real 8-letter-subject courses). Test:
  external-transcript.test.ts ("reads subjects of seven letters or more…").
- **Course-rules page count line** prints the view label as written: "View: MSCSE degree credit."
  The labels became short noun phrases on 2026-09-18 (trim review P-7); before that every one
  began "Whether a course …" and the line lowered the first letter to sit inside the sentence,
  which would now print "mSCSE". (The rule it replaced in 2026-09-06 was `.toLowerCase()` on the
  whole label, which printed "m.s. (mscse)".)
- **Batch of 2026-09-06 (afternoon): inactive buttons, locked preview values, compact rows.**
  - `src/ui/dom.ts` `inactiveButton(attrs, reason, explain, …children)` + `PREVIEW_OPEN_NOTE`:
    a button with `aria-disabled="true"`, class `inactive` (styled like `[disabled]`), `title` =
    the reason, and a click that calls `explain(reason)` (the toast) instead of the action. Used
    by app.ts `transcriptUpload()` (ND Import / Import again / Remove) and external-upload.ts
    `slotRow()` (Import / Remove) whenever `blocked` — i.e. `transcriptPreview !== undefined ||
    importsBusy()`. Never use the `disabled` attribute for these: the reason must be hoverable.
  - external-upload.ts preview rows: for `locked` rows (`!p.fromOcr && !r.manual`) credits,
    grade and term render as `<span class="… locked" data-key="ext.row.i.credits|grade|season">`
    ("4 cr", "A", "Fall 2023" — the Year cell is then `cell-empty`), each cell classed
    `locked-cell`; a value the parser did not read keeps its input (the row must be completable).
    Row class `compact` (locked) vs `editable` (OCR / manual). The e2e reads compact rows via
    `tr.compact td.locked-cell`.
  - style.css inside the `@container (max-width: 860px)` block: `tr.compact` — no `::before`
    labels on the course/title cells, `.cell-title` flex 1, the meta cells `inline-flex` with a
    "·" `::after` on `.locked-cell`, `.cell-empty` hidden, the level cell keeps its small label
    (the two-line phone form). A second block, `@container (min-width: 560px) and (max-width:
    860px)` (600 px until the Safari-engine run that evening found 1100 px windows on two
    lines — the WebKit bullet at the top of this list), makes it ONE line: `tr.compact` becomes `flex-wrap: nowrap`, the course cell gets
    `min-width: 96px`, the credits / grade / term cells `min-width` 30 / 22 / 82 px (typical
    values fit, so columns line up across rows), the title `flex: 1 1 0` and wraps inside its
    cell; separators and the level label are dropped there (the level `<select>` carries a
    `title`). DO NOT use grid + subgrid for this: a first version did (`table:has(tr.compact)`
    as a 7-column grid, rows as subgrids) and Safari rendered it with overlapping cells and the
    row overflowing the card (DGS screenshots 2026-09-06); Chrome was fine, which is why the
    container's screenshots did not catch it — Safari could not be run in the Cowork container;
    since that evening `E2E_BROWSER=webkit npm run e2e` drives Safari's engine on the DGS's Mac
    (the WebKit bullet at the top of this list), so layout changes are checked there before he
    looks. The visible `.blocked-tag` was
    removed the same day (DGS); the blocked row's cue is the greyed text and disabled box, its
    reason the row `title` + `aria-describedby`.
- **Batch of 2026-09-06 (night): load time, preview layout, blocked rows, transfer candidates, ND
  Remove.** Mechanics:
  - `src/data/load.ts` `loadLiveRules`: ALL tabs at once (a worker queue with `FETCH_CONCURRENCY =
    4` — the constant stays so a future DGS can throttle without touching the logic), each tab via
    `fetchCsv` = up to three HEDGED attempts (`fetchCsvOnce`): one request, joined after
    `HEDGE_AFTER_MS = 2000` without an answer (or at once when the first fails in a retryable
    way) by a second request for the same tab; the first answer wins and the loser is aborted;
    the attempt is abandoned at `ATTEMPT_TIMEOUTS_MS = [6000, 10000, 14000]` and a fresh one made
    after a short pause. `worthRetrying(e)` = timeout / unreachable / HTTP 5xx (never 4xx or an
    unpublished sheet — those end the attempt at once). Why: Google's publish-to-web CSV endpoint
    stalls ~17% of requests outright — hang until aborted — at the SAME rate at any concurrency
    (measured from the DGS's Mac 2026-09-06, 144 requests: 8/48 four-at-once, 9/48 two-at-a-time,
    8/48 one-after-another; no 429s); a single 15 s request per tab therefore failed whenever
    any one stalled — both the original `Promise.all` and the sequential version shipped earlier
    that day. With four requests at ~17% each, over half of page loads see a stall, which is why
    the hedge (2 s) matters more than the retry (6 s+). Progress event `{ step: 'retry', tab,
    attempt, of, hedged }` → the card's "Google is slow; asking again" (hedge) / "still nothing;
    asking again (attempt 2 of 3)" (fresh attempt); `LOAD_BUDGET_MS = 30_000` is the card's stated
    upper bound. `RulesLoadError` uses plain fields (node's type-stripping runner rejects
    parameter properties) and carries `status`; the JSON imports carry `with { type: 'json' }`
    so `tests/load-retry.test.ts` can import load.ts and stub `fetch` (the stub honours the abort
    signal). No single-download alternative exists (whole-doc HTML = script shell, xlsx = 400,
    gviz = CORS). Measuring from the Cowork browser pane: it is a HIDDEN tab, so timers
    (`AbortSignal.timeout`, setTimeout) fire late — measure with AbortControllers swept from a
    later call, not with timeouts (the 2026-09-06 numbers were taken that way).
  - `src/style.css`: `.transcript-preview { container-type: inline-size }` and
    `@container (max-width: 860px)` turn `table.courses.stack.edit` into per-course mini-forms
    (line 1: tick + `.cell-course` (flex 0 1 150px) + `.cell-title` (flex 1 1 220px); the
    `tr::before` break at order 2; `.cell-meta` at order 3 with `data-label` ::before labels).
    Every layout of the app page is under 860 px, so the table form only appears when the app is
    embedded in a wider column. The phone `@media (max-width: 600px)` block still styles the
    non-edit coursework tables.
  - `src/ui/external-upload.ts`: `isRelevantRow(university, rules, r)` (graduate, or core title,
    or DGS rule, or ND Courses-tab core area) decides `blocked` per row → `r.include = false`,
    checkbox `disabled` + `aria-describedby` + `title=BLOCKED_ROW_NOTE`, `tr.blocked-row` with the
    same `title`, a visible `.blocked-tag` ("not selectable — hover for why") in the title cell;
    the "Taken as" change handler sets `levelSource = 'slot'`, ticks a row that became relevant,
    and re-renders; `selectAll` skips blocked rows.
  - `src/engine/allocate.ts` `take()`: `transferCandidate` = caps include 'transfer' AND tier
    provisional AND origin transfer AND `external?.transferable !== 'yes'` (a string union since
    2026-09-08 — `!== true` would now be ALWAYS true) → `buildExplanation`'s
    candidate branch ("pending DGS review — candidate for transfer credit (§5.2); would count
    toward … if the DGS approves it" / partial / "counts only if the DGS picks it — the candidates
    together exceed the N-credit transfer cap"), mark `pending` even over the cap. Allocation math
    is untouched — only the words changed. app.ts `coursesCard`: `hasTransferCandidate(entries)`
    (looks for that phrase in the group's course lines) gates the group hint, `transferCapLimit()`
    reads the same parameter keys as audit.ts capSpecs for the "at most N credits" figure.
  - `CourseEntry.fromNdTranscript?: true` (types.ts) is set on every row the ND preview's Add
    pushes (app.ts) and validated as a hint in state.ts (malformed → dropped). app.ts
    `transcriptUpload()` renders "N courses from your transcript [Remove] · [Import again]" when
    any row carries it: Remove (`data-key import.nd.remove`) filters those rows out, clears
    `gpa`+`gpaSource` when `gpaSource` is set, resets an inferred `priorMs` when no graduate prior
    transcript remains, and offers Undo via `toastWithAction` (restores rows, GPA, priorMs). The
    entry term is left alone. e2e step 9 in drive-transcript.mjs; unit test in prior-nd.test.ts.
- **Batch of 2026-09-06 (evening): transcript preview, per-course marks, review request, advisor
  summary v3.** Mechanics, file by file:
  - `src/transcript/level-prefill.ts` (new, DOM-free): `prefillLevelsByTerm(rows, slot)` — the
    two-year rule for combined BS+MS transcripts (Master's row only, rows spanning > 2 years, NO row labelled by the transcript —
    since the DGS's answer that evening a transcript that states any level decides by itself — rows
    with `levelSource: 'slot'` and a year; returns `{ graduateFrom, latest }` only when it changed
    a row). Called from both import paths in external-upload.ts; `PreviewRow.levelSource`
    (`transcript` | `term` | `slot`) and `PreviewRow.manual` (typed rows) are new;
    `ExternalPreview.termPrefill` / `universityFromTranscript` drive the texts. `levelNote(p)`
    writes the "How “Taken as” was filled in" sentence (transcript markers / two-year rule with the
    window / slot); `mixedLevels` is now also true when the rule produced both levels.
    Locked fields: the university `<input readonly class="locked">` when
    `universityFromTranscript && !fromOcr`; course id/title as `<span class="course-id|course-title
    locked">` when `!fromOcr && !r.manual` (the e2e reads `.cell-course input` OR
    `.cell-course .course-id`). Tests: level-prefill.test.ts.
  - `src/engine/allocate.ts`: `CourseMark = 'counts' | 'pending' | 'excluded'` on
    `CourseAllocation` and `CourseLine` (types.ts, audit.ts). `buildExplanation` returns
    `{ explanation, mark }`: lead by tier — "pending DGS review — would count …once approved" /
    "in progress — will count … when passed" / "counts …"; an all-excluded row gets no approval
    suffix; undergraduate `ineligibleReason`s are the three §4.4.1 sentences (satisfies / may
    satisfy / not relevant), and `coreNote` on graduate transfer lines now also carries a
    DGS-confirmed core area (`external.satisfiesCoreArea`). The mark for a counted=0 row follows
    the reason prefix (`^satisfies` → counts, `^may satisfy` → pending, else excluded).
  - `src/ui/marks.ts` (new): `statusMark(mark)` = ✓ / ● / ✕ span with a visually-hidden word;
    CSS `.mark-counts/-pending/-excluded` (--ok / --warn / --bad). app.ts `courseTable` prepends it
    to `.cell-note` and strikes through on `mark === 'excluded'` (was a text regex).
    `verdictsBlock` ("What the DGS's rules say") is gone from external-upload.ts, with its CSS.
  - `src/transcript/external.ts` `buildReviewRequest`: greeting "Dear DGS,"; `detailGroups` are
    `{ heading, rows }` with `detailHeaders` — HTML `<table>` per group, text rows joined with
    " | " under a header line. app.ts review card: DGS mailto only; toasts say "email it to the
    DGS". e2e drive-transcript.mjs asserts the card no longer says "Grad Admin".
  - `src/ui/advisor-summary.ts` v3: sections = `report.requirements` grouped by `r.group` in
    first-seen order minus informational / not_applicable / the "Approvals" group; `STATUS_TAG`
    (word + colour) per status; HTML tables Status · Requirement · § · Why (· Deadline); text
    rows `  [TAG] title (§) — why. Deadline.`; `actionItems(report)` → `{ student, advisor, dgs }`
    keyed on REQUIREMENT_IDS with regexes over the detail text (`textOf` joins detailParts):
    remaining credits/semesters from "X of Y", the seminar's "CSE 63802: not yet", the
    categories' "below the B floor: …", the approvals row's `{lead, items}` ("COURSE (reason)" →
    advisor if the reason names the advisor, DGS if it names the DGS/review; the student sends the
    request), plan-of-study statement → advisor, missing parameter → DGS; dissertation items only
    when `phd.candidacy` is met. New engine detail phrasings need matching rules here — the
    tests in advisor-summary.test.ts pin every rule.
- **Advisor summary redesigned for busy advisors** (2026-09-06, DGS: "they include too much
  information … make them more legible to busy advisors who will just wonder what requirements
  are not met and why, and until when the requirements must be met"). `advisorSummary()` moved
  out of report.ts into its own DOM-free module `src/ui/advisor-summary.ts` (app.ts and the test
  import it from there). Shape — inverted pyramid: subject line "Degree self-check — Ph.D.,
  entered Fall 2026 — 6 requirements not yet met, 1 deadline passed"; one standing paragraph
  (date in words via `formatYmdLong`, program, entry term, prior study, GPA, then the counts as
  the page headline counts them — informational and does-not-apply rows outside); NOT YET MET as
  a numbered list (name red-bold/`**…**` per 2026-09-04, §, why, deadline — overdue first, then
  nearest deadline, then handbook order); CONDITIONALLY MET (or the row's `statusLabel` upper-cased,
  e.g. ELIGIBILITY AT RISK — trim review 2026-09-18, P-59); CANNOT EVALUATE (only when any); IN
  PROGRESS (first statement of the detail only, deadline if any); "Met:" names on one line;
  does-not-apply rows, the course list, the separate DEADLINES block, the per-line
  "(approximate)" and the PDF/coverage caveats are GONE (one deadline footnote + alpha notice +
  handbook edition remain). Deadlines read "Due by the end of Spring 2028" / "Deadline passed
  (was due during Spring 2028)" — semesters (2026-09-05), the passed one red bold in HTML.
  `whyFor(r, firstStatementOnly)` re-voices the engine's student-facing detail for the email:
  statements from `detailParts` (or `detail` split at sentence ends, sparing M.S./Ph.D./e.g.)
  minus page instructions (checkbox/attestation/tick/course rules page/self-check page), minus
  "Talk to…"/"Ask the DGS…", minus "Overdue —" when the row's deadline is overdue; `REWRITES`
  restate two page instructions as facts (plan-of-study attestation, "Enter your cumulative
  GPA"); you/your → I/my (the student writes). An unmet row left with nothing says "Not yet."
  When an engine detail gains a new "do this on the page" sentence, add it to the drop regex or
  `REWRITES`. Example Ph.D. record: 766 → ~430 words, HTML 7.5 → 4 KB. Tests:
  `tests/advisor-summary.test.ts` (16 — structure, ordering, both flavors, `whyFor`).
- **"Grad Admin"** (2026-09-06, DGS): the Graduate Program Administrator is "Grad Admin" everywhere
  after the contact card's "Graduate Program Administrator (Grad Admin)" — `GRAD_ADMIN` in
  contacts.ts is found by `role.startsWith('Graduate Program Administrator')`; the email greeting
  is "Dear DGS and Grad Admin,"; the engine's detail strings say "Grad Admin" (the old "Graduate
  Program Coordinator" wording is gone). Never reintroduce "Coordinator".
- **Usability review Phases 1–2** (2026-09-05, DGS asked for all remaining items; the WORDING is
  Claude's draft, listed in the DECISIONS row of the same date for the DGS to edit — change the
  strings in `src/ui/handbook.ts` (`BETA_NOTICE` and its neighbours; `ALPHA_LINE` went with the two-strip notice, 2026-09-19), app.ts (card intros, hints,
  footer), external-upload.ts (combined callout), report.ts (`STATUS_LABEL`, headline, glossary
  entries) and re-run `npm run e2e`). Mechanics worth knowing: `noticeStrip()` in app.ts replaced
  `betaNotice()` + `privacyNotice()` — one `.banner.beta.notice-strip` with two one-line
  paragraphs and a `<details class="notice-details">` holding the full DGS paragraphs (the footer
  still uses the full constants; the advisor summary dropped them on 2026-09-06). `radios(keyPrefix, options, current,
  onPick)` builds a radio group with per-option `data-key`s (`standing.prior.<value>`,
  `standing.msOption.<value>`) — drive-a11y.mjs's focus check presses ArrowDown on
  `standing.prior.none`. Both previews re-render on every checkbox tick so the Add button's count
  ("Add 4 selected courses" / "Add 3 checked courses") follows; e2e matches those labels by
  regex. `report.ts`: `attentionList()` (rows with status unmet / needs_dgs_review /
  cannot_evaluate, each `#req-<id>` anchor — cards carry `id="req-…"`), `glossary(program)`
  (a `<details class="glossary">` with a `<dl>`; entries paraphrase the handbook sentences the
  engine quotes — keep them in step), `courseListLink(r)` (core rows →
  `courses.html?core=<code>&view=qualifier`, the categories row → `?view=qualifier`, the
  regular-course rows → `?program=…&type=regular&view=…`), the headline maths (`open =
  remaining − inProgress`, needs-review count appended), meters past target ("12 (9 needed) ✓",
  `.bar i.done`), deadline chips `.chip.deadline.d-<state>` (no lead word since P-50). The dial SVG
  is `aria-hidden`. `diagnosticsCard()` renders only when an ERROR exists. `.print-header` is a
  print-only first line in `<main>`. courses-page.ts: `Filters.view` (`all|mscse|phd|qualifier`,
  `VIEW_LABEL`, `HIDDEN_COLUMNS` = 1-based column positions hidden per view, applied as
  `.col-hidden` on header and body cells after the table is built), `filtersFromUrl()` /
  `filtersToUrl()` (query parameters q, program, core, category, type, retired, confirmed, sort,
  desc, view; unknown values ignored; `history.replaceState` after every `refreshTable()`), the
  "What are you checking?" select (`filter.view`) rebuilds the filter bar and pre-sets Program.
  `docs/USER-TESTING.md` is the student-testing protocol (item 32).
- **Phone and tablet layouts, both pages** (2026-09-05, DGS request; review items 2, 13, 30).
  Breakpoints: two columns down to 901 px (the report column `minmax(340px, 400px)` on tablets
  in landscape); one column at ≤900 px, where app.ts renders `renderSummary(report)` (dial +
  meters + "See the full report ↓", `section.summary-mobile`) ABOVE the inputs and a
  `nav.sticky-score` bar (score line + "Inputs ↑ / Report ↓" links, `#inputs`/`#report`
  targets; `html { scroll-padding-bottom }` keeps focused controls above it, the toast moves up)
  — both hidden on wide screens by CSS, as is the report's "↑ Back to your inputs" link
  (`.jump-link.back-link`). Phones (≤600 px): `table.courses.stack` rows become flex cards —
  cells carry `class` (`cell-check`, `cell-course`, `cell-meta` + `data-label`, `cell-note`,
  `cell-remove`, `cell-title`) and CSS `order`s them (course + Remove on line 1, a `tr::before`
  break, then Term/Credits/Grade with `::before` labels, then the note); the editable external
  preview (`table.courses.stack.edit`) becomes one mini form per course with labels above the
  inputs; the header row is visually hidden (still read by screen readers); the " — " between a
  transcript label and its button is a `span.slot-sep` hidden on phones; tabs and the
  example/clear buttons go full width; every control is 16 px so iOS Safari does not zoom on
  focus; `.btn` ≥40 px. courses.html at ≤860 px (phones + tablets in portrait): the 980 px table
  becomes cards — `thead` visually hidden, `tbody tr` blocks, `th.course-id` the card title,
  `td[data-label]::before` labels, the Notes button inside the card, note rows attached below —
  and, since the sortable headers are hidden, a "Sort by" select + "Descending" checkbox
  (`.filter.mobile-only`, `filter.sort`/`filter.desc` keys) appears in the filter bar (hidden on
  wide screens: `.filters .filter.mobile-only { display: none }` — mind the specificity).
  drive-a11y.mjs checks all of it: pieces hidden at 1400 and shown at 390, stacked rows, cards,
  the Sort control sorting, and no sideways scrolling at 390 AND 820 px on both pages
  (`phone-*.png`, `tablet-*.png`). Scratch full-page shots: `scratchpad/ux/shots.mjs` (session only).
- **Combined Notre Dame transcript GPA** (2026-09-05, student bug report — his undergraduate GPA
  3.68 was imported): `parseTranscript` files every cumulative figure under the LEVEL of its totals
  block (`totalsLevel` from "Term Totals (Graduate)" / "Transcript Totals - (Undergraduate)", else
  the record's `sectionLevel`; per-term "Cumulative" rows count too) in `cumulativeGpaByLevel`;
  `cumulativeGpa` is the graduate level's figure when levels are labelled (never the undergraduate
  one — undefined if only that exists), else the last figure read. Banner 9 "All Levels" prints
  the levels alphabetically (Graduate BEFORE Undergraduate), which is how "the last Overall row"
  became the undergraduate GPA. The ND preview (app.ts) offers the transcript's graduate figure;
  when graded GRADUATE rows precede the entry term (an earlier graduate program at Notre Dame —
  the student's Theology M.A. case) it also computes `gpaOfProgramCourses()` (credit-weighted
  letter grades from the entry term on, `GRADE_POINTS`) and shows a radio choice, transcript's
  figure by default (DECISIONS 2026-09-05); the choice is kept as `student.gpaSource` (display
  only; cleared when the GPA is typed; validated leniently in state.ts) and explained under the
  GPA field (`.gpa-note`). Tests: "cumulative GPA per level" in tests/transcript.test.ts.
- **Tests run on `node --test`, not vitest.** The repo once lived under a folder named
  `FY26-27 (DGS: Taeho Jung)`; the colon corrupted npm's PATH and broke vite-node's module
  URLs. The folder was renamed, but the dependency-free runner was kept. Node ≥ 24 runs the
  `.ts` files directly — hence the explicit `.ts` extensions on all relative imports
  (`allowImportingTsExtensions`). Vite still does dev/build.
- **`data/snapshot.json` stores raw CSV text**, not parsed JSON: one parse/validate path for
  live and fallback data, and each sync commit diff reads as "what the DGS changed". Since
  2026-09-01 the sync (every 6 hours) leaves the file untouched while the content is unchanged
  — that is what makes `syncedAt` mean "when the current rules were first seen" (next bullet
  but one) — and commits + `gh workflow run deploy.yml` only on a real change (a `GITHUB_TOKEN`
  push never triggers `on: push`; `workflow_dispatch` is GitHub's documented exception).
- **Status algebra** (`src/engine/status.ts`): every credit has a certainty tier —
  `definite` (passed + sheet says yes/attested) > `in_progress` (IP) > `provisional`
  (dgs_approval / unknown / non-CSE / transfer). A threshold row's status is the certainty of
  the worst credit actually needed; missing parameter ⇒ `cannot_evaluate` via typed accessors
  returning `undefined` (never a guessed default — a blank cell is NOT zero).
- **Cap allocator** (`src/engine/allocate.ts`) works at CREDIT granularity and is
  order-independent (the prototype's worst bug was entry-order-dependent verdicts — pinned by
  a permutation test). Greedy fill is provably optimal while every course touches ≤ 1 cap
  (true since the DGS ruled non-CSE 4xxxx counts nothing); a tiny exact search handles any
  future multi-cap case.
- **§4.4.2 distinct groups** use Kuhn's bipartite matching (`matching.ts`) so a course listed under
  every group (Research Methods) lands on the group the student is missing; a student's pinned
  choice is honored and a suggestion is emitted if suboptimal.
- **`rules_effective_term` resolution**: newest Courses row not after the COURSE'S term; if every
  row is later (all 371 live rows say Fall 2026), the OLDEST row applies retroactively —
  without that fallback every pre-2026 course would resolve to nothing.
- **Reserved `category_group` code**: `ineligible` (`RESERVED_GROUP_CODES` in
  `src/data/types.ts`) is valid on Courses rows but never a matchable group (`any` was retired
  2026-09-18 — a course in every group names all five). The DGS marks all
  40000-level courses `ineligible`. If you see a sixth "group" appear in matching, this broke.
- **Retakes** (§4.4.2): only ND rows dedupe (foreign transfer ids can collide); the counted
  attempt is the last PASSING final, else a live IP retake, else the last failed one (which
  earns nothing — F/U earn zero credit by DGS decision).
- **Transcript upload** (`src/transcript/`): pdfjs-dist is one of the two lazily-loaded runtime
  dependencies (the other is tesseract.js, the opt-in OCR), loaded as its own chunk so the main bundle stays ~170KB. The parser handles Banner 8
  ("INSTITUTION CREDIT") and Banner 9 ("Institutional Credit") wording, ND's official-PDF
  layout (credits BEFORE grade: `BIOS 60574 Title 3.000 B+ 9.999`), Banner term codes
  (YYYY00=Summer, YYYY10=Fall, YYYY20=Spring of YYYY+1), and ND markers that may exist only
  in the browser print footer (an nd.edu URL). Image-only screenshot PDFs (students are
  literally instructed to screenshot by some ND offices) get a "print to PDF instead"
  message, NOT the not-ND rejection. **Never built against a real ND transcript** — parsed
  courses always preview for student confirmation, so format drift degrades safely; with a
  real sample, tighten `parse.ts` + its tests.
- **UI safety**: all user text renders via `textContent` (the old prototype had an innerHTML
  XSS); imports are deep-validated and a failed render never persists (no localStorage brick);
  "today" is computed in LOCAL time (UTC audited evening users as tomorrow).
- **Beta disclaimer + handbook link** (2026-09-01, DGS decision): `src/ui/handbook.ts` holds
  the edition, the official PDF URL, `handbookLink()` and the `BETA_NOTICE` wording; rendered as
  the `.banner.beta` under the masthead, the `.legal-beta` footer paragraph, and two lines in
  the copied summary. Remove the banner (not the footer) when the DGS declares the app out of beta (renamed from alpha: DGS, 2026-09-03).
- **Contacts, feedback address, license line, "untested upload" note** (2026-09-01, DGS
  decision): `src/ui/contacts.ts` holds the DGS / Assistant DGS / Graduate Program Administrator
  entries, the repo + LICENSE URLs, `reportToDgs()` and `contactCard()`; rendered as the
  "Who to contact" card at the top right of the masthead on BOTH pages (the masthead is a
  two-column grid: text | card; tools row spans below; single column under 900px), the footer
  "License" line, the feedback sentence in the beta banner + footer, and the `.untested-note`
  under the transcript-upload button. The beta banner also states in bold that every verdict is
  computed from the published course rules (linking to `courses.html`). Update `contacts.ts` at every DGS handoff;
  the untested note was RETIRED 2026-09-03 (the import buttons carried "(alpha)" from 2026-09-04 to 2026-09-12, when the red-team review found five repeats of one fact; the opening dialog, the banner and the footer say it now — and the
  page-level privacy banner sits right under the beta notice); real-ND-transcript testing is
  still worth doing (by a human, locally — FERPA: never paste a student's transcript into an AI tool).
- **Public course-rules page** (`courses.html`, 2026-09-01, DGS request): `src/ui/courses-page.ts`
  renders the Courses tab for students — overview cards per §4.4.1 core area and §4.4.2 category,
  then a filterable/sortable table (id, title, type, counts toward MSCSE/Ph.D., core area,
  category, typically offered, DGS reviewed). It uses the SAME loader (`loadLiveRules` via
  `loadRulesWithCard`) and shows, per
  course, the row in effect this term (`resolveRuleRow` with `termOfDate(today)`); retired rows are
  hidden unless the visitor ticks "Include retired courses". `dgs_reviewed` is now parsed into
  `RuleCourse.dgsReviewed` for this page only — the engine still ignores it. E2E suite
  "course rules list" screenshots it and checks a filter. Add columns here, never new policy.
  Since 2026-09-16 it also has an EMBED MODE (`?embed=1`) — see the embed bullet below.
  Its banner is the OFFICIAL wording (DGS, 2026-09-01): the mappings are set by the DGS with
  faculty input and are what the DGS and the Graduate Program Administrator use; it is not
  labelled beta (only the self-check tool is). It also says not every listed course is offered.
- **Embed mode (`?embed=1`, 2026-09-16, DGS)** — `src/ui/embed.ts`, one module for both pages,
  every non-obvious choice commented in place. The short version:
  - The mode is an explicit parameter, never `window.self !== window.top`, so it can be linked,
    bookmarked and tested with no frame around it.
  - `filtersToUrl()` in `courses-page.ts` rebuilds the query string from the filters alone and
    dropped `embed=1` on first render — it now re-adds it. Any future URL rewriting must too.
  - **Height is `documentElement.getBoundingClientRect().height`, never `scrollHeight`.** Once
    the parent has sized the frame to H, scrollHeight can never fall below H, so a frame sized
    from it could only ever grow; the requirement is that filtering the table down reclaims the
    space. Do not "fix" this by adding a `Math.max`.
  - The coalescer uses rAF **and** a 100 ms timer. rAF alone sent nothing in a hidden tab and
    latched the `pending` flag so nothing later was sent either — a WordPress page opened in a
    background tab is exactly that case (measured 2026-09-16).
  - `MAX_EMBED_HEIGHT` is 100 000 because 117 courses measure 42 290 px at a 700 px column (card
    mode). The parent trusts the number and the frame does not scroll, so a cap under the real
    content hides rows. Re-measure before lowering it.
  - `EMBED_PARENT_ORIGINS` is the entire access control (`postMessage` targetOrigin, never `'*'`).
    The page listens for NO incoming message, which is why there is no inbound attack surface;
    keep it that way.
  - **`index.html` must not broadcast its height.** A frame stretched to its content height has a
    viewport the size of the whole document, so `position: fixed` stops meaning anything: the
    consent dialog centres itself thousands of pixels down, toasts and `.sticky-score` land below
    the fold. It keeps a fixed frame with its own scrollbar. If someone asks for auto-resize there,
    the answer is a parent→child visible-rect protocol, not a height broadcast.
  - The WordPress half is `docs/wordpress-footer-snippet.html` (copied verbatim by the DGS) and
    README § "Embedding these pages in a WordPress page". The e2e extracts the snippet's `<script>`
    from that file, so the tested thing and the pasted thing are the same text.
  - Pinned by `tests/embed.test.ts` (DOM-free, the only CI-enforced half) and the embed legs in
    `driveCourses` / `driveApp` / `driveA11y`, one of which proves a parent on an origin outside
    the allowlist receives nothing.
- **Dated line under each title** (`rulesDateLine()` in `src/ui/handbook.ts`, 2026-09-01):
  precedence (1) optional Parameters row `rules_effective_date` (a `DISPLAY_PARAMETER_KEYS`
  entry: known, optional, silent when missing, never an engine input) → "Rules effective as
  of …"; (2) `Rules.rulesDate` from `src/data/rules-date.ts` — the live CSV texts are compared
  (line endings / trailing whitespace ignored) with the bundled `data/snapshot.json`: identical →
  `{kind:'known', at: snapshot.syncedAt}` → "The course rules here were last updated on <that
  date>, …"; different → `{kind:'after', …}` → "… were updated after <that date>, …" plus a
  diagnostics warning that explains the ~6-hour window and what to check if it persists; the
  snapshot fallback is always `known`; (3) nothing dated (rules built without a snapshot, i.e.
  tests) → "… are those in effect for <term>, …". Every variant ends ", and are up-to-date as of
  <Y>." where Y = today (local calendar date) when `rules.source` is `live`, else the snapshot's
  `syncedAt` day. DGS wording decision 2026-09-01 (final form after two rounds): exactly this
  sentence, no course counts on that line.
- **Loading card + reload-first failure handling** (`src/ui/loading.ts`, DGS decisions
  2026-09-01): while rules load, both pages show a card — step list (connect / course list /
  parameters / categories / dating), each step ticking with its row count, a bar against the
  ~30-second budget (`LOAD_BUDGET_MS` in `src/data/load.ts` — keep the card's wording and this
  constant in step; since 2026-09-06 each tab is asked for up to three times, see the night
  batch above) and an elapsed counter. On failure `loadLiveRules` throws `RulesLoadError`
  (kinds: timeout / unreachable / http / unpublished / empty; `retryable` says whether reloading
  can help). The card then explains in plain words and suggests RELOAD first; the saved copy
  (`rulesFromSnapshot`) is a second-choice button, never automatic — the DGS chose "suggest
  reloading instead of showing the saved copy". For non-retryable kinds (unpublished/empty —
  reloading cannot help) the saved-copy button comes first. The snapshot banner now says "You
  chose to continue with the copy saved on …". E2E: the sandbox has no network, so every run
  exercises this path — `cdp.mjs`'s `open()` waits for the masthead OR the failed card, requires
  the card to mention reloading, screenshots it once (`loading-failed.png`) and clicks through.
- **Beta ≠ inaccurate rules** (`RULES_ACCURACY_NOTICE` + `BETA_SCOPE_NOTICE` in
  `src/ui/handbook.ts`, DGS wording 2026-09-01): the notice at the top of the page (app.ts — the
  only place it renders) states in bold that the course rules are accurate — exactly the rules
  the DGS uses to decide requirement satisfaction, which the Grad Admin processes (the two roles
  as the course rules page words them, DGS 2026-10-04; policy review round 3, P3-text-ui-6) —
  and that what is in alpha is the TOOL's application of them. Don't reintroduce wording that
  hedges on the rules themselves, or that makes the Grad Admin a co-decider.
- **Approval gate + detail philosophy + along-the-way gate** (2026-09-03, DGS): `.consent-overlay`
  in `startApp()` shows on EVERY visit until Agree (not stored; cdp.mjs `open()` auto-dismisses it
  in e2e). Detail philosophy: MET rows explain how, unsatisfied rows show only progress (rules
  live behind the § chips). `msAlongTheWayRow` needs candidacy passed AND
  `ms_regular_credits_min` regular credits at ND (`alloc.ndRegular.definite`; scenario
  phd-ms-along-the-way). Unreviewed undergrad courses whose titles match `CORE_TITLE_RE` in
  app.ts (algorithm/operating/architect — DGS keywords) join the review request. A graduate
  conferral line on a Master's/Ph.D. transcript (`degreeConferred` in
  `parseExternalTranscript`, positive evidence only) sets priorMs='none'→'completed' on add.
- **Parser pass over 20 de-identified samples** (2026-09-05, DGS-provided; see the DECISIONS row
  for the full list): `runsFromTextItems(items, viewport)` in layout.ts is now THE way runs are
  made (pdf.ts, diagnose script, the scratch tooling) — it composes each item's transform with the
  viewport's, measures the dominant text direction per page and turns a sideways page upright
  (returns the turned page width); only text at odds with the page keeps `rotated`.
  `repeatedPhrase()` / `isRepeatedPhraseRun()` drop security bands drawn as one run;
  `watermarkInstitution()` feeds the phrase back as a header line (runsToLines prepends it).
  `findColumnGap` takes the right column's edge as the leftmost x with ≥ max(3, 20 % of the
  busiest bucket) runs and rejects candidates with runs in the band before it. external.ts:
  `leadCode` tries a two-cell code at cells 0–1 or 1–2 (`SUBJECT_RE` allows "E E",
  `NUMBER_RE` allows 601.226 / 106LEC and keeps the rest of the number cell as title tokens),
  strips a 1–3-letter security prefix, and the single-cell path allows dotted numbers;
  `scanTokens` handles grade-first rows, H-column flags, integer-in-title, credit echoes and
  builds the title from the wordy tail when nothing preceded the numbers; `plainTitleLine`
  lifts a title from the adjacent line; level markers (`LEVEL_BLOCK_RE`, exact-cell level,
  term-header suffix, `retroLevel` from a closing totals line); `degreeBlock` counts down the
  lines after a "Degrees Awarded" header; `guessUniversity` tries the collapsed whole line
  first and rejects sentences/registrar lines. parse.ts: Campus token before the Level, per-record
  `sectionLevel` from "Course Level:" / the "Transcript Level" table, `UNIVERSITY OF NOTRE DAME
  CREDIT:`, transfer institution on the term line, Roman-numeral I on credit-only rows. Sanitizer:
  neutral output names, /Rotate preserved (`rotate` on PdfPage), more KEEP_WORDS. The sample
  PDFs live only in the session scratchpad — never in the repo; their shapes are pinned by
  invented fixtures. Scratch recipe: extract lines with `runsFromTextItems` + `runsToLines`, dump
  JSON per file, run both parsers over all files in one script, eyeball the lines of the outliers.
- **Semester deadlines** (2026-09-05, DGS): `deadlineTerm` / `deadlineTermLabel` /
  `dueTermPhrase` in term.ts turn an ISO deadline into "before Fall 2034" / "by the end of Spring
  2030" / "during Spring 2028"; every chip, detail and advisor-copy line uses them and no date is
  shown anywhere (tests pin the exact chip strings). `DeadlineInfo.date` is unchanged.
- **Transcripts card notes** (2026-09-05, DGS; the unofficial-note removed 2026-09-15 — previous-degree slots now refuse anything marked unofficial, `isUnofficial` in external-upload.ts): `.unofficial-note` (unofficial transcripts read
  best) and `.combined-note` (a combined BS+MS PDF goes once into the Master's row) in app.ts /
  external-upload.ts.
- **Sheet renamed** (2026-09-05, DGS): the rules sheet is CSE-Degree-Checking-Rules —
  `SHEET_NAME` (sheet-source.ts) is the one place the code carries the name; the e2e
  (drive-app.mjs) and tests/sheet-source.test.ts pin it; published-CSV links and the edit URL
  in data/sheet-urls.json are unaffected by a Drive rename.
- **Combined transcripts + Notre Dame as a previous institution** (2026-09-05, the corner cases
  the DGS listed): `parseExternalTranscript` now returns a per-row `level` ('undergraduate' |
  'graduate') from a `UG|UGRD|GR|GRAD` cell right after the code (stripped before tokenizing),
  a level block (`LEVEL_BLOCK_RE`: "Level:", "Term Totals (…)", a bare "(Undergraduate)" line,
  "College: Graduate School" — never a line that merely starts with "Graduate …"), or a DATED
  bachelor's conferral (`bachelorsConferredOn`; rows in terms ≤ that term are undergraduate);
  `mixedLevels` when both appear. `external-upload.ts`: `PreviewRow.level` (default =
  `slotDefaultLevel(slot)`), a "Taken as" `select.row-level` per row, `degreeLevelFor(slot,
  level)` on add (undergraduate → bachelors whatever the slot; graduate → masters, or phd in the
  Ph.D. slot), `registeredLevel` kept on Notre Dame rows, prior-study inference on ANY graduate
  row; `keepRelevantRows(university, rules, rows, mixed)` unticks-but-keeps (`irrelevant`) on a
  mixed transcript and omits on a single-level undergraduate one; a Notre Dame course counts as
  relevant when the Courses tab tags it with a core area. A Notre Dame transcript in a previous
  slot is parsed by `parseTranscript` (university `NOTRE_DAME`, `notreDame: true` → the
  `.nd-prior-note`; the OCR path still redirects). `verdictsBlock` shows the Courses-tab core
  area for prior ND rows ("(course rules)"); app.ts's review request lists prior ND courses under
  Notre Dame ("Notre Dame, before entry") as Courses-tab rows when unlisted. CSS: `.layout`'s
  first column is `minmax(0, 1fr)` and `.transcript-preview` scrolls horizontally, with per-field
  widths so the eight preview columns fit at 1400px. Fixture `combined-transcript.pdf`
  (Purdue B.S. conferred May 2024 + M.S. May 2025); e2e steps 7 (combined into the freed
  Master's slot: levels/ticks, toast "(2 undergraduate, 2 graduate)", prior study completed,
  two Purdue groups) and 8 (the ND fixture in the Ph.D. slot). COVERAGE_NOTICE re-worded.
- **Entry term read from the transcript; prior Notre Dame coursework** (2026-09-05, student
  bug report: a combined ND transcript — eight undergraduate semesters — showed 13 consecutive
  semesters and deadlines 8 years from "this fall"). Root cause: `Student.entryTerm` defaulted
  to the current fall and nothing ever set it; residency counted every `origin:'nd'` term.
  Now `parseTranscript` returns `entryTerm: EntryTermInference` (`inferEntryTerm`, exported:
  stated admit term → latest graduate-level "Student Type: New" term → first graduate-level
  term → after the last awarded degree → earliest; `how` is the plain-English source shown on
  the standing card; `alternative` names the other reading when a degree is awarded between
  graduate-level terms — earlier term kept, earlier deadlines being the safe error),
  `degreesAwarded` (name/level/date; "Sought"/"Current Program" never count) and a per-row
  `level` (UG → undergraduate; GR/PR/LW/EM/GB → graduate; else the term's "Term Totals
  (Graduate)"/"College: Graduate School"/"Level:" block; else the course number, 5xxxx unknown).
  The ND preview offers the term as a ticked checkbox (`.use-entry-term`); on add, app.ts sets
  `entryTerm` + `entryTermInferred: {how, alternative}` (also `{how:'assumed'}` on a fresh
  record — `validateStudent` never lets a saved file inherit it) and the standing card shows
  the `.entry-note` warning until the dropdown is touched (`setEntry` clears the flag and calls
  `reclassifyNotreDameCourses`). `src/ui/prior-nd.ts` (pure): a Notre Dame course dated before
  the entry term becomes origin 'transfer' / institution `NOTRE_DAME` ("University of Notre
  Dame", `src/data/external.ts`, with `isNotreDameInstitution`) / `degreeLevel` from
  `registeredLevel` (new CourseEntry field) or the number — and back to 'nd' when the entry
  term moves earlier. Engine: `residency.ts` counts only terms ≥ `student.entryTerm`
  (overrides too); `allocate.ts` + `coreRows` let a prior ND course satisfy §4.4.1 through the
  Courses tab's core_area with no ExternalCourses ruling (line "a Notre Dame course listed in
  the course rules"); prior ND graduate courses are ordinary §5.2 transfers (rulings under
  UNIVERSITY OF NOTRE DAME). The coursework card heads them "ND, before entering the
  program — undergraduate/graduate coursework" (it read "Notre Dame" until 2026-09-08); the Bachelor's/Master's slot rows show and
  Remove them. `advisorSummary` added a DEADLINES block (date order, "counted from <entry
  term>") and "Due by <date>" / "overdue — was due by <date>" per requirement line, with a
  Deadline column in the HTML tables (the block went on 2026-09-06 — each line carries its own
  deadline now). Tests: transcript.test.ts (COMBINED fixture),
  prior-nd.test.ts, scenario phd-nd-undergrad-before-entry, advisor-summary.test.ts,
  engine-units (residency guard); the e2e ND fixture is now a combined transcript (B.S. awarded
  May 2026, two UG terms) and step 2 checks the checkbox, the prior-row ticks, the standing-card
  note and the full-time term list; step 3b removes the prior ND course via the Bachelor's slot.
- **Transcript sanitizers** (2026-09-05, DGS request — he has many sample transcripts to share
  once de-identified): `scripts/sanitize/rules.mjs` is the ONE rule set (deterministic per
  document via a seeded PRNG: same word → same scramble; year offset ±1..8; grades always
  change; credit-like decimals kept unless on a GPA/totals line; subject code + first digit of a
  course number kept; institution runs kept whole — decided PER RUN for PDFs so a watermark tile
  on the same baseline cannot shield a name, per OCR line for scans). `sanitizeRuns(runs,
  pageWidth)` first splits two-column pages with the app's own `findColumnGap` (exported from
  layout.ts; watermarks dropped before locating the gap) so a left row never borrows a
  right-column totals context. `pdf-io.mjs` reads pdfjs runs (`rotated` set like pdf.ts) and
  rebuilds a Courier PDF with each run at its position, horizontally scaled (`Tz`) to the
  measured width, same rotation; `.d.mts` files type both modules for the tests.
  `scripts/sanitize-transcript.mjs` (`npm run sanitize`) is the CLI, also `--words in.json
  out.json` for the scan tool; `scripts/sanitize/ocr-words.mjs` OCRs a page image with
  tesseract.js + public/ocr (cacheMethod none — never writes the model into the repo);
  `scripts/sanitize-scan.py` (Pillow; PyMuPDF for PDF input) paints changed words over the
  local background and redraws them. `tests/sanitize.test.ts` locks the rules and proves
  fidelity: the sanitized watermarked fixture re-reads with the same upright-run geometry
  (pdfjs may split a rebuilt two-word cell — tolerated), same 10 rows, same columns and
  transfer count, shifted years, changed grades. Outputs are git-ignored.
- **Text watermarks** (2026-09-05; UMass Amherst / Western Ontario transcripts repeat the
  university's name across the page and read 6 / 0 courses): `dropWatermarks()` in layout.ts
  runs BEFORE `splitColumns` (tiles also broke the column split). Signals: `Run.rotated` (pdf.ts
  sets it from the transform's b/c) and a ≥6-letter phrase repeated ≥6× on the page at ≥3 x
  buckets (4 units) — dropped only at x buckets where it occurs ≥2×, so a lone genuine header
  with the same words stays. `tests/fixtures/banner-watermarked-transcript.pdf` (tiles at three
  x's every 37 units, gray 0.85, plus a 28pt 30° banner) must extract byte-identically to the
  clean fixture — the e2e asserts the same ids. `npm run diagnose -- file.pdf`
  (`scripts/diagnose-transcript.mjs`) is the FERPA-safe way to see a real transcript's shape.
- **Banner two-column transcripts + Notre Dame markers** (2026-09-05, from the DGS's own IIT
  transcript): `src/transcript/layout.ts` (pure, unit-tested) turns pdfjs runs into lines —
  `splitColumns()` detects a two-text-column page (a ≤2%-crossing vertical band at 40–60% of
  the width, both sides ≥30% of the runs, and a WORDY right edge: ≥5 runs with a four-letter
  word — a one-column table's right half is numbers/grades, so it never qualifies; decorative
  rules and "CONTINUED ON NEXT COLUMN" banners are ignored when counting crossings) and reads
  left column then right; `repairStraddlers()` handles pdfjs merging a left cell with the right
  column's text into ONE run ("PTS R Fall 2013") by handing a trailing term header to the right
  column. `pdf.ts` now passes the page width and calls `runsToLines`. `nd-markers.ts`
  `looksLikeNotreDameTranscript()` is shared by parse.ts (reject) and external.ts (redirect):
  e-mails are stripped first, "Notre Dame, IN" addresses don't count. external.ts: `leadCode`
  joins split SUBJ / NO. cells ("CS   455"), the "TRANSFER CREDIT ACCEPTED BY" block is skipped
  and counted (`transferRowsSkipped` → preview note), `asCredits` accepts 0, connector tokens
  ("&") stay in titles, candidates carry `season`, and `guessUniversity` scans cells of every
  line (header first, strong words first, Banner "College :" labels and "College of …"
  divisions excluded). Fixture `tests/fixtures/banner-transcript.pdf` (positioned runs,
  invented "Example Institute of Technology", an nd.edu e-mail in the header) drives an e2e leg
  (Ph.D. slot: 10 rows, transfer note, institution from the legend page); the same lines are
  locked in `tests/banner-transcript.test.ts`. On the real transcript: 26/26 rows, every term
  right, 7 transfer rows skipped. To extract lines in Node for such a diagnosis, mirror
  `pdfToLines` with `pdfjs-dist/legacy/build/pdf.mjs` (pdf.ts itself has a Vite `?url` import)
  and feed `runsToLines` — never commit the transcript.
- **Advisor summary: unmet names in red bold** (2026-09-04, DGS): in `advisorSummary()`
  (now src/ui/advisor-summary.ts) the HTML `table()` helper now takes cells that are either plain strings (escaped)
  or `{ html }` (pre-escaped markup); `nameCell(r)` (was `titleCell`) wraps a status-`unmet` title in
  `<strong style="color:#a81e14;font-weight:bold">` (inline — email clients drop stylesheets;
  the hex is the page's `--bad`), and the text flavor's `line()` wraps the same titles in `**…**`.
  Only `unmet` qualifies (DGS: needs-review / cannot-evaluate / in-progress are not "not met").
  Locked by `tests/advisor-summary.test.ts` (hand-built AuditReport — advisorSummary is pure
  string building, so no rules or DOM are needed).
- **Rules-spreadsheet link, faculty-only note** (2026-09-04, DGS): `src/ui/sheet-source.ts`
  exports `SHEET_NAME`, `SHEET_EDIT_URL` (read from `data/sheet-urls.json` `sheet_edit_url` via a
  JSON import WITH `with { type: 'json' }` — required because `node --test` also loads the module;
  `src/data/load.ts` imports the same file without the attribute and is only ever bundled by
  Vite), `sheetLink()`, `sheetSourceLine()` (the `p.effective.sheet-source` line under each
  masthead's dated line — the dated sentence itself is untouched per the 2026-09-01 decision) and
  `sheetSourceNote(page)` (footer paragraph children — SHORT by DGS decision the same day: the data
  come from the DGS's rules spreadsheet (link), created based on the handbook (`handbookLink()`),
  bold "accessible by faculty only", and a cross-link to the course rules page / "this page shows
  the same rules"; the four-tab description was dropped — don't bring it back).
  app.ts wraps it in `div.legal-source` ("Where the rules come from."); courses-page.ts splices
  it into its existing "Source." paragraph. `tests/sheet-source.test.ts` pins the URL to the JSON
  and rejects published-CSV shapes; e2e `checkSheetLink()` in drive-app.mjs asserts exactly one
  masthead + one footer link per page, sheet-name text, "faculty only" nearby, new-tab rel.
- **Sheet-driven contacts + nested detail bullets + PDF caveat** (2026-09-04, DGS): the six
  `contact_*` DISPLAY_PARAMETER_KEYS (data/README.md) feed `applyContactOverrides()` in
  contacts.ts — called at the TOP of startApp() and renderCoursesPage(), before anything renders
  (the consent notice shows `Prof. ${DGS.name}`); it mutates the CONTACTS objects in place so the
  DGS/GRAD_ADMIN references stay valid, and missing/blank keys keep the baked-in fallback (a DGS
  handoff = sheet edit; refresh the fallback occasionally). `DetailPart` may be
  `{lead, items}` — joinedDetail flattens it to "lead: a; b; c" for `detail` (test-stable) and
  report.ts renders it as a two-layer list (`.detail-sublist`, one sub-bullet per item); used by
  approvalsRow and categoriesRow. BETA_SCOPE_NOTICE now carries the "transcript-PDF import …
  highly inaccurate" caveat, and since 2026-09-05 ends with `COVERAGE_NOTICE` ("Not all cases are
  covered yet — for example, …"; the examples were the 5+1 / same-institution cases until those
  were handled later that day — now unseen layouts and combined records that do not tell the
  levels apart). The consent overlay showed COVERAGE_NOTICE as its own paragraph for part of
  2026-09-05; the DGS then had it removed from the overlay (it stays in the banner, footer and
  copied summary through BETA_SCOPE_NOTICE). The feedback line on the self-check page says
  error reports, suggestions and feedback are all welcome. tests/contacts.test.ts locks the key names.
- **Alpha label, undergrad relevance filter, ndResearch gate, bulleted details** (2026-09-04, DGS):
  the banner and import buttons say ALPHA again. `CORE_TITLE_RE` moved to
  `src/engine/core-title.ts` (plus `coreTitleSuggestion` naming the suggested area); the classifier's
  bachelors line now leads with the core-knowledge story ("satisfies the X core-knowledge
  requirement… — confirmed by the DGS" / "title suggests…" / plain "not counted — undergraduate
  credits never transfer"). Undergraduate imports are FILTERED at the preview
  (`keepRelevantRows` in external-upload.ts: core-title match or ExternalCourses ruling; the note
  counts what was left out), and the coursework card hides non-relevant bachelors rows the same
  way (old saved files keep them in data). The transfer card ignores bachelors entirely
  (transferRow filter). `alloc.ndResearch` (rule.courseType research|project, ND origin) feeds the
  along-the-way MSCSE: candidacy + ms_regular_credits_min ND regular + ms_project_credits_min ND
  research credits (research = research/dissertation + thesis-project direction; independent study
  excluded). `RequirementResult.detailParts` + `joinedDetail()` (context.ts) let report.ts render
  long multi-part details as a bulleted list (>120 chars, >1 part); `detail` stays the joined
  prose for the advisor summary and tests. External parser (2026-09-04): lowercase codes accepted
  (with a term/summary stopword guard), numeric grades (85, 9.5) kept as rawGrade, and two-line
  rows (code+title / numbers) merged; conferral wording also accepts "complet…" with a
  not-completed/incomplete guard.
- **Inferred prior study + deadline dedupe + free-flowing report** (2026-09-04, DGS): a graduate
  transcript WITHOUT a conferral line now sets priorMs='none'→'unfinished' on add (conservative
  §5.2 cap) and flags `Student.priorMsInferred`; the standing card shows a warning while
  inferred-unfinished ("pick Completed if you earned it"), the dropdown's onchange clears the
  flag (student's choice wins), and the slot Remove handler resets priorMs→'none' when the flag
  is set and no masters/phd transfer courses remain. Rows with a deadline chip keep their
  in-progress detail EMPTY (candidacy, qualifier umbrella, both time limits — the chip carries
  the when); overdue says "Overdue — talk to the DGS" with no policy prose. "MSCSE awarded
  along the way" has no "(information)" suffix (still `informational: true`). `.audit-col` is
  plain `min-width: 0` — no sticky/max-height/inner scrollbar; don't reintroduce them. The
  courses page's offered-note says active ≠ currently offered.
- **Rules on the output side + advisor summary** (2026-09-03, DGS): every requirement card's §
  chip is a button revealing `.rule-quote` — the handbook sentence from `citation.quote`; the
  input-card intros stay lean (no policy prose). `advisorSummary()` (then in report.ts, now
  src/ui/advisor-summary.ts) replaced `summaryText()`: {text, html} clipboard flavors via `copyReviewRequest`, subject + greeting,
  standing line (program/entry/prior study/GPA), requirements grouped attention-first with
  details, courses as counted, notices. Button: "Copy summary for your advisor". **Google sends NO Last-Modified (and no ETag) for published CSVs** — verified
  2026-09-01 by fetching all three tabs from the deployed page's own origin (exposed headers:
  cache-control `private, max-age=300`, content-disposition, content-type, date, expires, server)
  — so the sync's own record is the only zero-setup date source; the earlier header-reading
  code was removed. Tests: `tests/rules-date.test.ts`.
- **External transcripts** (2026-09-01; since 2026-09-03 all four imports live in the single
  "Transcripts" card composed by `transcriptsCard()` in app.ts — ND row + the three
  prior-university rows from `priorTranscriptSection()`; the card is FIRST on the page, "start
  here", and imports are one-at-a-time: while any preview is open, `importsBusy()` +
  the ND-preview state disable every import button until it is confirmed or cancelled. The
  "Coursework" card (retitled from "Coursework at Notre Dame" 2026-09-03) groups the list by
  university AND degree — "Notre Dame" first, then one `h3.subhead` + table per
  (university — transcript slot); the manual form's "From another university" entries carry a
  degree-level select (graduate §5.2 / undergraduate = core-knowledge-only / Master's / Ph.D.)
  so undergrad courses can be added for §4.4.1; a Previous Master's/Ph.D. import while
  priorMs='none' shows a reconcile warning in the standing card — never an automatic flip): →
  `src/transcript/external.ts`
  (best-effort candidates; no text layer → explicit OCR opt-in, English only; ND
  detected → redirected to the ND row; unmappable grades kept raw and the student MUST choose)
  → editable preview (`src/ui/external-upload.ts`) → `origin:'transfer'` entries tagged
  `degreeLevel`. The DGS's rulings live in the optional ExternalCourses tab (parse:
  `parseExternalTab`; match: `src/data/external.ts` — the normalized university name alone (aliases retired 2026-09-03; capital-English-as-printed convention), ids ignore
  spaces/hyphens). Engine: Bachelor's never transfers but still satisfies
  §4.4.1; sheet-confirmed core → met; transferable yes / no / dgs_approval / blank → pre-approved
  wording / excluded with the ruling named / candidate decided case by case / "not yet decided"; nd_credits replaces transcript credits (§5.2
  pro-rata) — all in `classify()` (the `external` field rides on ClassifiedCourse so core sees
  DGS rulings even for zero-credit courses). Per-course verdicts render in the Transcripts card
  (`verdictsBlock`); everything still needing a DGS decision — ND courses that are unknown,
  unattested dgs_approval, or blank-verdict, plus external courses without a ruling (or with
  transferability undecided) — feeds ONE combined request in the "Ask the DGS to review" card
  (`askDgsCard` in app.ts + `buildCombinedReviewRequest` in `src/transcript/external.ts`;
  consolidation 2026-09-03 — students found two buttons/two emails confusing). The request keeps
  the human half (greeting, prior graduate study, "transcripts are attached", sign-off) above one
  "(You may edit anything above this line)" + divider + "(DO NOT MODIFY ANYTHING BELOW THIS LINE)"
  (the upper marker since 2026-09-06); below it, one tab-separated section per
  sheet tab (Courses: course_id, title; ExternalCourses: UNIVERSITY, course_id, course_title),
  rows only for courses needing a NEW sheet row, then details grouped per transcript;
  engine-ineligible courses (outside the §5.2 window etc.) are excluded as not worth the DGS's
  time. The copy writes text/plain (tabs) AND text/html (real `<table>`s): HTML email flattens
  tabs to spaces, a table survives Gmail and pastes as cells. (A paste while a cell is in EDIT
  mode still lands in one cell — click the target cell once, don't double-click.) All requests
  are addressed to the DGS AND the Graduate Program Administrator (policy 2026-09-03) —
  `GRAD_ADMIN` in `contacts.ts`, clipboard writer `copyReviewRequest` in `external-upload.ts`.
  RETIRED 2026-09-03: the
  per-course core-area claim dropdown and the per-area "previously passed elsewhere"
  attestations (both predated the ExternalCourses tab; Q12 superseded). The type fields
  `claimedCoreArea` / `corePassedElsewhere` remain, deprecated, so old saves still import —
  the engine ignores them. The tab is OPTIONAL at every seam (urls/loader/sync/snapshot/
  rules-date/loading card); its lone failure degrades to "not yet reviewed", never a dead page.
  Tests: `tests/external-rules.test.ts`, `tests/external-transcript.test.ts`, scenario patch key
  `external`; e2e uploads `tests/fixtures/external-transcript.pdf` into the Master's slot.
- **Opt-in OCR for scanned external transcripts** (2026-09-02, DGS decision): a PDF with no
  text layer now offers `.ocr-optin` instead of a flat rejection — explicit button, wording
  states ENGLISH-LANGUAGE TRANSCRIPTS ONLY and that results are approximate. Engine:
  `tesseract.js` v7 (`src/transcript/ocr.ts`), entirely in-browser with SELF-HOSTED assets in
  `public/ocr/` (worker.min.js, tesseract-core-simd-lstm.wasm.js single-file SIMD+LSTM core,
  eng.traineddata.gz best_int) — never the CDN defaults, or the no-external-calls rule breaks.
  Requires WASM SIMD (2021+ browsers); failure → plain message to use a system-generated PDF.
  SAFARI LESSON (2026-09-03): pdfjs-dist is PINNED TO THE v4 LINE (^4.10.38) on purpose — v6
  freely uses 2025 builtins (Map.getOrInsertComputed, Promise.try, URL.parse,
  Uint8Array.fromBase64, Float16Array) in its main AND worker code, which Safari lacks, so on
  Safari every PDF read failed (system-generated ones then looked like scans). Before ever
  upgrading pdfjs, grep the new build + pdf.worker.min.mjs for those identifiers and check
  they are guarded, then test in real Safari. Since 2026-10-10 the app imports the LEGACY build
  (`pdfjs-dist/legacy/build/pdf.mjs` + its worker): the modern v4 build calls
  `Promise.withResolvers` unguarded, failing every import on Safari < 17.4, Chrome < 119, Firefox
  < 121; the legacy one polyfills it and reads identical text (the Node tools already used it).
  Pages render via pdfjs at the per-page scale of OCR step 12 (the scan's own resolution between
  216 and 300 dpi — the step-12 bullet below; a fixed 3.0 = 216 dpi before it), max 10 pages. THE PIPELINE (OCR step 11,
  2026-10-09): render → `worker.recognize(canvas, {}, { blocks: true })` → the pure
  `src/transcript/ocr-lines.ts` → `src/transcript/layout.ts` → the parser. `blocksToRuns(blocks, scale,
  pageHeightPx)` turns the engine's WORD boxes into layout `Run`s (pixels / scale = PDF units, y flipped
  up, every run of a line at its line's baseline middle; words a word space apart — ≤ 0.55 of the line
  height, `WORD_SPACE_SHARE`, measured on the pinned pages, or two TITLE WORDS ≤ 1.1 apart,
  `TITLE_WORD_SPACE_SHARE`, a monospace face's cell — are one phrase run, as pdfjs gives the
  layout "College of Science" as one item; per-word runs made such a word a watermark tile) and
  `ocrPageLayout(blocks, canvasWidth, canvasHeight, scale, { hint, confidence })` reads them through
  `pageLayout` exactly as a text PDF's runs: watermark tiles dropped, a two-column page split and read
  column by column, a gap past 8 units rendered as three spaces (the parser's cell split), the column
  hint handed to the next page. The engine's own lines are NOT the parser's input any more (under its
  default page segmentation it prints a two-column page's two columns as one line each — the splice
  that lost the right column's rows). `layout.ts` gained `groupLineRuns` and `pageLayout().lineRuns`
  (which runs made each line) for the confidence rule: each line's confidence is its least confident
  word's (`OCR_LINE_CONFIDENCE = 'min-word'`; the A/B against the engine's line figure and the floor
  calibration are in DECISIONS). Also in the module: `OCR_ENGINE_PARAMETERS` (empty — the one place a
  step adds an engine parameter, with its measurement), and the step-9/10 builder kept for the bench —
  `linesFromBlocks` (the engine's lines through `ocrLineText`, whitespace collapsed) and `ocrKeepSpaces`
  (the step-10 variant, measured and NOT adopted: `preserve_interword_spaces` + spacing kept lost rows on
  office scans and added false rows on keys — DECISIONS). `ocr.ts` (rendering + worker), the bench's
  `ocr-run.mjs` (knobs `--engine-lines`, `--interword`, `--line-confidence`, `--image-dpi`) and
  `scripts/dev/ocr-lines.mjs` import the module — never a hand copy. `tests/ocr-lines.test.ts` pins the
  stage on hand-made blocks and on the nine pinned pages (`tests/fixtures/ocr-scans/`, the engine's
  `blocks` captured once — `PINNED_READING` is each page's current reading); `tests/layout.test.ts` has
  the OCR-word two-column page. Every OCR change is an A/B on `npm run ocr-bench`
  (docs/OCR-BENCHMARK.md) against a baseline made on the SAME parser code — a stale baseline confounds
  (step 10's lesson); `--compare` diffs two finished runs. Per-line confidences flow through
  `parseExternalTranscript(lines, confidences)` and rows under 80 get `lowConfidence` → ⚠ +
  amber row in the preview (`.ocr-low`), plus the `.ocr-banner` warning (the floor was re-measured by
  step 11 and kept: the flag's precision equals the share of wrong rows at every floor — see the
  floor's comment in `external.ts`). The ND uploader still
  takes NO scans (digital insideND PDF only; OCR'd ND text redirects there). The e2e OCR leg
  runs the real engine in headless Chrome (~15-60 s; 120 s waitFor).
- **OCR step 12 — the render scale and the orientation trial** (2026-10-09, plan steps 2.2–2.4; the
  A/B table is docs/OCR-BENCHMARK.md "OCR step 12", the reasons the DECISIONS rows of that date). The
  page scale is no longer a constant: `ocr.ts` asks `ocrRenderScale(width, height, scanDpi)`
  (ocr-lines.ts) per page — the scan's own resolution from `paintedImageSizes(page, pdfjs.OPS)` +
  `scanResolution` (the operator list's `[id, width, height]`; NEVER `page.objs.get` — pdfjs resolves
  some images only when drawn, and a reader that waited on one hung on a vector page's logo), between
  `OCR_BASE_DPI` 216 and `OCR_TARGET_DPI` 300, stepped down in thousandths until the rounded-up canvas
  fits iOS Safari's caps (`OCR_MAX_CANVAS_SIDE_PX` 4096, `OCR_MAX_CANVAS_AREA_PX` 16 M — above them
  WebKit draws nothing and the engine reads a blank page with no error). Why not a flat 300: on the
  ladder's 150–200-dpi sources it LOST rows (a misread header cell unmaps a table in the parser's
  header-mapped path — step 2.5's job), on 300-dpi sources it won by 4 points of row accuracy at 1.18 ×
  the time. Pages brought under 216 dpi come back as `reducedPages` and the OCR banner names them
  (W-CL373, `ocrReducedPagesNote` in preview-layout.ts). Page 1 also gets the ORIENTATION TRIAL: read
  as it comes and, when `meanWordConfidence` of that reading is under `OCR_ORIENTATION_TRIAL_SKIP_ABOVE`
  (70 (and a turned reading must beat the page as it came by `OCR_ORIENTATION_TRIAL_MARGIN` = 5 points) — measured: every upright page of the medium set scored above it, every page read the
  wrong way round below), rendered turned 90 / 180 / 270° (`page.getViewport({ scale, rotation })`,
  `OCR_TRIAL_TURNS`) and the best reading's turn applied to every later page; the result's `turned` is
  shown on the banner (W-CL374, `ocrTurnedNote`). Sideways and upside-down scans read nothing before
  (0 rows at every L6 level); now they read as their upright selves. The bench mirrors both:
  `ocr-run.mjs` `--scale auto` (the baseline config since this step; `--scale 3` = the app before it)
  and `--rotation-trial` with the same early exit (`--trial-always` forces all four turns — the
  measurement's form); `bench.mjs` keeps each page's dpi, scan dpi, mean confidence, rotation and
  trial figures in `results.json` (`pageFigures`). Measured and NOT adopted, numbers in DECISIONS:
  PSM 3 / 4 / 11, `user_defined_dpi` (a no-op), `rotateAuto` (+17 at L3, −16 at L2 — the two-pass
  form, keeping the deskew only when the engine's own estimate is ≥ 1.5°, is the next candidate),
  `thresholding_method` 1 / 2 (`--binary-dir` proves the parameter reaches the engine),
  `tessedit_do_invert = 0` (false rows up on the medium set), a 10-px border. `OCR_ENGINE_PARAMETERS`
  is still empty. A medium-set run (`--families generator-external,generator-nd,generator-scan,public-pdf
  --levels L2,L5`) takes ~12 min and is the A/B to trust over `--quick` (the flat-300 and invert
  verdicts reversed between the two).
- **OCR step 2.5 — the parser on a scan's noise** (2026-10-09, plan step 2.5; the A/B table is
  docs/OCR-BENCHMARK.md "Plan step 2.5", the reasons four DECISIONS rows of that date; commits `a120c2b`
  `5620628` `ce56a71` `81b038d` `bc36cde`). Three rules in `src/transcript/external.ts`, each gated
  on `ocrLines` (= `confidences !== undefined`) so a text layer never reaches them: (a) a header line's
  cells lose the scan's noise marks (`OCR_HEADER_NOISE_RE`, `headerCellsOf`), and on a line already
  ≥ 60 % header an unknown cell's words of ≥ 4 letters are repaired to the `OCR_HEADER_WORDS` entry one
  letter away (`ocrRepairHeaderCell`, `withinOneEdit`; every entry must be a header cell on its own —
  `tests/ocr-header-noise.test.ts` checks, so a word added to `COLUMN_KIND_RES` that scans misread goes in
  both); a two-line header's lower line run together by the engine is split back into its words
  (`joinedHeaderKinds` → `joinAt`). (d) `dropSection` takes a scan's reading of Minerva's diamond
  (`OCR_MARK_RE`: ≤ 3 characters, no letter, ≤ 1 digit) only before a zero-padded section and a title.
  (b) `ocrJunkCode` (lines under `OCR_CONFIDENCE_FLOOR` only): an all-lower-case subject with a letter
  whose capital differs, a decimal number taken for a code (`leadCode` now returns `printed` — the code
  as printed — and `decimalCell`), a title with no word of four letters. The bench gained `--reparse
  <run>`: every run saves `<seed>/<level>/ocr-lines.json`, and a parser change is A/B'd by re-parsing the
  same lines with HEAD's parser and the change (a HEAD copy via `git archive HEAD src scripts tests
  package.json tsconfig.json | tar -x -C <dir>` with `node_modules`, `public`, `data` symlinked) —
  seconds, not a 45-minute ladder. Check a guard on the synthetic renders of the layouts the public seeds
  lack (`--families synthetic-render --only <fixture> --skins ruled --levels L2,L5`): that is how the two
  stricter forms of (b) were caught costing real rows (Addis Ababa's "Math 1011", CMU / DTU rows whose
  credits the scan misread). (c) re-tested the flat 300 dpi on the new parser
  and did NOT adopt it (`bc36cde`): the medium set's gain was one document's (Evergreen) with new false rows
  on four keys, and the photocopy level collapsed (44.1 → 7.8 % row accuracy) — `OCR_BASE_DPI` stays 216.
- Updating the OCR assets: bump `tesseract.js` in package.json, `npm install`, re-copy
  `node_modules/tesseract.js/dist/worker.min.js` and
  `node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js` into `public/ocr/`, and
  fetch the matching `@tesseract.js-data/eng` best_int `eng.traineddata.gz`; the scan fixture
  regenerates with `python3 tests/fixtures/make-scan-fixture.py`.
- **Attestations**: DGS-approval checkboxes upgrade matching courses' certainty tier;
  `advisorApprovedPlan` only feeds the advisory approvals row. A CSE non-4xxxx `dgs_approval`
  course has no clearing checkbox by design (stays provisional).

- **A Ph.D. student with an earlier NOTRE DAME degree** (2026-09-09; the DGS asked for the two
  cases: ND bachelor's → Ph.D., and ND bachelor's → ND MSCSE → Ph.D.). Most of it was already
  built on 2026-09-05 (see the prior-Notre-Dame-coursework entry above); this pass added the
  policy the handbook does not state and fixed six defects that only these students hit.
  - `Student.ndMasters` (`{ term?, inferred? }`, presence = the degree is held): set by the ND
    import from a master's/Ph.D. conferral dated BEFORE the entry term — one dated after it is
    §4.5's along-the-way award — and by the checkbox `standing.ndMasters`. When it is set,
    `phdRows` does not push `msAlongTheWayRow` at all: the report has no §4.5 along-the-way row.
    That is why the scenario runner grew `expectAbsent` (tests/scenarios.test.ts).
  - `categoriesRow` (§4.4.2) now also counts a PRIOR NOTRE DAME course, but only when its §5.2
    credit is actually transferred — `tier === 'definite'`, i.e. the student has recorded the
    approval — and only when the allocator gave it credit (over the cap = no credit = no group).
    Courses still waiting go in `awaitingTransfer`: named on the row, never counted, and the row
    reads `needs_dgs_review` instead of `unmet` where the approval alone would complete it.
  - `priorNdShape` (allocate.ts) gives a prior Notre Dame course its own Courses-tab verdict —
    `course_type` → pool, `level`, `counts_toward_*` — on top of §5.2's `transfer` cap. Applied
    only when `isNotreDameInstitution(c.institution)`: another university's course that happens
    to share a Notre Dame number is not the same course, and the sheet describes ND's catalogue.
  - `derivePriorMs` / `hasPriorGraduateStudy` (prior-nd.ts, pure): "Prior graduate study" now
    follows the coursework instead of being decided once during an import. Called from `setEntry`,
    from the bachelor's-term control and from the ND import. A prior ND graduate course dated in
    or before the bachelor's award term is NOT prior graduate study (a 4+1 senior's §3.5 course).
  - Below the 60000 level (DGS 2026-09-09): 40000- AND 50000-level CSE courses the sheet permits
    share ONE six-credit cap (`fourk`). An unlisted 50000-level course still counts nothing
    (decision Q19) — the permission has to come from the sheet. Cap wording changed accordingly.
  - Two re-filing holes closed: the manual course form and the external-slot import both call
    `reclassifyNotreDameCourses` now, as the ND import always did.

- **Is a transferred course a CSE course?** (2026-09-09; DGS: "CompSci, CompS, CS, CE, ECE, CSYE
  etc. all can mean CSE in fact".) §4.2 caps credits "taken from a department other than CSE" at
  nine wherever they were taken, and the app had no way to tell the department on a transcript it
  did not write, so transfers escaped the cap entirely. Now the SHEET says, in two places:
  `cse_subject_codes` (Parameters) lists the codes that mean CSE, and `is_cse` (ExternalCourses,
  yes/no/blank) settles one course the code cannot — it WINS over the list. `isCseCourse()` in
  src/data/external.ts is the only place that decides; `subjectCode()` normalises "CompSci 537" →
  "COMPSCI". A code the list does not name is OUTSIDE CSE (its silence is an answer), but a MISSING
  or BLANK parameter is no answer at all — `codeList` returns undefined for both, and classify()
  then holds every transferred course without an `is_cse` cell for the DGS (`cseUnknown`, since
  2026-10-03; before that it left the allowance off — corrected here 2026-10-07, P3-sheet-6). Notre
  Dame's own earlier courses keep being decided by `deptOf === 'CSE'`. On the live sheet today: 55
  of 88 rows are CSE by code, 18 are ECE (the DGS's call, row by row), 15 others fall outside.

- **§3.5 / §3.6 track notes** (2026-09-10; promised 2026-08-31 and never built). `src/engine/tracks.ts`
  (pure) recognises the two tracks this audit does not model from the coursework itself — §3.6 from a
  50000-level CSE course, §3.5 from a graduate-level Notre Dame course dated in or before
  `bachelorsAwarded` — and returns a program-specific note, since the handbook says different things
  to an MSCSE and a Ph.D. student about the same course. `AuditReport.tracks` carries them;
  `renderReport` put them ABOVE the dial as `.track-note` until 2026-09-27 — now a closed `<details class="track-note">` under the meters (DGS, clarity proposal 3) — deliberately not in the amber `.warnings`
  box: no verdict changes and nothing is wrong with the record. Nothing asks the student which track
  they are on. e2e: drive-app.mjs adds CSE 50501 and asserts the note, its position and its absence
  for the example student.

- **Notre Dame coursework taken as an undergraduate** (Graduate School via the DGS, 2026-09-10
  evening — this supersedes every earlier ruling on the bachelor's award term for ND courses). It is
  NOT §5.2 transfer credit: `classify` takes it down its own branch before the bachelors branch, it
  carries no `transfer` cap, and `sums.transfer` and the §5.2 row both exclude it (they test for the
  cap, not for `origin`). At 60000+ it counts in full; below that it draws on `fourk`, §4.2's six
  credits; below 40000, or non-CSE below 60000, it never enters the branch at all and keeps its old
  line. The one bar is `countedToward === 'both'`, and only for a Ph.D. student — no course counts
  toward three degrees. `CourseEntry.countedToward` ('bs' | 'mscse' | 'both' | 'neither') is asked of
  the student per course, in the coursework table, and only where it can matter: ND undergraduate
  coursework, for a student who holds an ND master's (`ndMasters`). Unanswered = counts nothing, amber
  — `buildExplanation` marks a "not counted yet" line pending even though it carries a satisfied core
  area, because the student, not the DGS, is the one who has to act. MSCSE side: cap `sharedbs`,
  constant `BS_SHARED_CREDITS_MAX` (a Parameters row until 2026-10-07), row `ms.cap.sharedbs`, pushed only when a course draws
  on it.
- **A 4+1's entry term** (DGS 2026-09-10). `inferEntryTerm` gained a rule between the "Student Type:
  New" marker and "the first graduate-level term": when a dated BACHELOR'S award exists and the
  first graduate-level term is at or before it — graduate coursework that began before the student
  was a graduate student, which is the 4+1 signature — the entry term is the first graduate term
  after the LAST dated degree. An along-the-way MSCSE (§4.5) does not match, since its graduate
  terms all start after the bachelor's degree, and its `alternative` is unchanged.
- **Choices the page makes for the student** (DGS 2026-09-12, red-team F1–F4). `autoSelect` in
  `app.ts` runs at the top of every render: an UNSET §4.4.2 group is filled from the categories
  row's `groupAssignments` (the coverage-maximising matching, in-progress courses included), and an
  "Undecided" §3.4 route from `inferMsOption` (mscse.ts); when it changed anything it saves,
  re-audits and toasts once (12 s). Only blanks are filled — a student's pick is never overwritten,
  so there is no render loop. In the engine, `matchDistinctGroups` treats a pin as a preference
  (`pinsIgnored`/`bestAssignment`); the qualifier umbrella takes the `phd.credits.nd` row as a
  condition; `allocate.ts` sends credit refused only by the `noncse` cap to the total
  (`overCapToTotal`), which `capRow` in context.ts reports as "over the cap — count toward the
  total-credit requirement only". Scenarios: phd-group-pin-is-a-preference,
  phd-qualifier-needs-nine-nd-credits, mscse-undecided-project-inferred, mscse-undecided-either-route;
  e2e pins both toasts (drive-app: un-assign CSE 60876; drive-transcript: add CSE 68902 undecided).
  `detailExcludes` in a scenario's `expect` asserts a phrase is absent.
- **The §5.2 box is conditional** (F5, 2026-09-12). `classify()` marks each transfer row
  `reviewed` (an ExternalCourses verdict, or a Courses-tab row for a Notre Dame course); app.ts
  renders the checkbox only when some reviewed transfer course exists and always renders the
  `.attest-note` rule beside it when any transfer course exists. Old saved files with
  `transferApproved` still load; with nothing reviewed the value simply has no control.
- **Credit systems** (F6, 2026-09-12): `CreditSystem` in data/external.ts is
  quarter | semester | trimester; the factors are the Graduate School's, in code since 2026-10-04
  (`QUARTER_CREDIT_FACTOR` / `TRIMESTER_CREDIT_FACTOR`, `creditSystemFactor()`; they were the
  Parameters keys `quarter_credit_factor` / `trimester_credit_factor` from 2026-09-12, now in
  `RETIRED_PARAMETER_KEYS`, which the sheet check reports as no longer read); the parser
  sets `quarterSystem` or `trimesterSystem`; the preview keeps `p.creditSystem` and the select
  `ext.preview.creditsystem`; the classified course carries `convertedFrom` for the line.

- **Only a 4+1's undergraduate graduate-level coursework earns credit** (DGS 2026-09-12, F7).
  `student.integratedBsMs` gates the undergraduate branch of `classify()` for 60000-level courses;
  `autoSelect` in app.ts infers it from a graduate-registered Notre Dame row dated inside the
  bachelor's degree; the radio lives in the standing card. `notTransferCredit` on a classified
  course keeps such rows (and F7's pre-entry course with no prior program) off the §5.2 row.

- **`report.reviewFlags`** (2026-09-12): notes for the DGS that are not about one course. Today one
  source — `undergraduateGraduateCourseworkFlag` (more than two counted undergraduate 6xxxx
  courses). The review card shows them as "Note —" lines and keeps its button active for them;
  `buildCombinedReviewRequest({ notes })` prints each as "Please also check: …" in the context.

- **Multi-campus systems** (2026-09-12): `src/transcript/campus.ts` lists the systems whose bare
  name is ambiguous; `withCampus` in the parser sets `campusSystem`/`campus`; the preview's
  `ext.preview.campus` select is required and writes the campus's full name into `p.university`.
  Do not add a school whose bare name means its flagship — the picker would fire on every
  Purdue transcript (University of Washington is the DGS's deliberate exception, 2026-09-13).
  CUNY (DGS 2026-10-10) lists all 26 colleges; an alias must name ONE college only (test every new
  alias against the other colleges' full names — `tests/campus.test.ts` loops over them), and each alias
  carries its institution word (a surname on a name line is no college). Only CUNY sets `firstNamedWins`
  (the header's first-named campus wins); every other system keeps list order, flagship first — do not
  flip that globally (a student named Martin moved Knoxville to Martin in review). A transfer-credit line
  names no campus (`TRANSFER_FROM_RE`); a name joins a system via the header only when it IS a campus's
  full name (Fordham's School of Law is not CUNY's).
- **The transcript gate** (DGS 2026-10-10, answer 4a): `parseExternalTranscript` returns no course and
  `notATranscript` for a TEXT layer with one course row, no transfer row set aside, no university (read,
  or a short `INSTITUTION_OR_RECORD_RE` line) and no `RECORD_FIGURES_RE` line;
  the upload shows W-CL421 and offers no OCR. Never widen it to scans (answer 2: a scan keeps every row),
  and a new synthetic test document with one row needs a university line, or it is gated.

- **The multi-cap order search is memoized, not factorial** (hotfix 2026-09-16). `bestMultiOrder`
  chooses the processing order for courses that draw on more than one cap; it used to enumerate
  n! permutations and froze the page at ten-plus prior-program courses. It is now a depth-first
  walk memoized on (remaining courses, cap rooms) with an optimistic bound; children in array order
  and strict-improvement replacement keep the first-best order identical (verified over 30,000
  random configurations). `tests/allocator-blowup.test.ts` fails in seconds if anyone brings the
  enumeration back.

## The policy-compliance review's changes (2026-10-03) — what a later session must know

The review of 2026-10-02 (workflow; report at the artifact “Policy Compliance Review”, data under
`policy-sources/.review/`, git-excluded) compared the engine with the Graduate School's Academic
Code, the DGS Handbook 2025–26 and the 4+1 guidance. The DGS had the 8 fix-first and 53 conflict
findings applied, with 20 rulings of his own (`docs/DECISIONS.md`, 2026-10-03). The shape of what
changed, so nobody undoes it by accident:

- **Grades.** `Grade` has `'I'` and `'W'` (`grades.ts`: I is in progress until
  `incompleteDeadline(term)` = end of term + 44 days, then `incompleteLapsed` → provisional and a
  review ask; W earns nothing but is a registration). The ND import keeps W and I rows; `SKIP_GRADES`
  is AU/V/NR/X/NG. `isInProgress` is true for IP and I.
- **Classification flags** (`allocate.ts` `ClassifiedCourse`): `passFailGrade`, `afterAdmission`, `noPriorProgram` (priorMs 'none' + a course from another university — held for the DGS, P1-transfer-eligibility-11), `cseUnknown` (a transfer the sheet cannot place inside or outside CSE — held, P1-transfer-eligibility-23),
  `nonDegree`, `ugToGrUnverified`, `interrupted`, `withdrawn`, `incompleteDue`, `incompleteLapsed`.
  `classify(student, rules, today?)` — `today` matters (lapsed Incompletes, readmission); the review
  builder takes it too (`coursesNeedingDgsReview(student, rules, today?)`; the UI uses the audit's
  `classified` through `coursesNeedingDgsReviewFor`). Transfer courses with any of the first two
  flags, a lapsed I or `interrupted` are **held for the DGS** whatever the ExternalCourses tab says
  (`heldForDgs` in the transfer branch; the §5.2 row's `held` bucket). The §5.2 row's cap wording (`capFor`) names the two cases no document caps: no prior program, and an unfinished Ph.D. elsewhere (`unfinishedPhd`).
- **Caps.** `CapId` adds `nondegree` (`NON_DEGREE_CREDITS_MAX = 12`, Academic Code §2.3 — a Graduate
  School number in code, like §3.5's six) and, per semester, `term:<termIndex>` (Academic Code §3.8:
  `SEMESTER_GRADUATE_CREDITS_MAX = 15` credits of 60000–90000-level courses in a fall or spring,
  `SUMMER_CREDITS_MAX = 10` of any course in a summer — DGS 2026-10-03, P1-residency-enrollment-c4).
  `overMaxTerms()` is pure (the milestones card reads it for the overload tick, `Student.creditOverloadTerms`);
  `registrationCaps()` attaches a cap to the audit's own classified courses of each semester over the
  maximum that is not ticked, so the courses entered first fill it. Residency's three graduate-level
  credits a semester (`GRADUATE_LEVEL_CREDITS_MIN = 3`, Academic Code §4.1) live in `residency.ts`. `allocate(classified, caps, { nonCseSpillsToTotal })` —
  true for the Ph.D. only (MSCSE non-CSE overflow counts toward nothing, §3.2 September text).
  `fourk` is drawn by every level-4/5 course whatever its type; a listed row below level 4 counts
  nothing (`validate.ts` warns the DGS when such a row says it counts).
- **Prior Notre Dame coursework** (`classifyPriorNdUndergraduate`): no five-year window (DGS);
  a non-4+1's 6xxxx on the Ph.D. tab is provisional (`plainBachelorsApproval`, Academic Code §4.6
  last paragraph), still refused on the MSCSE (§3.5); `sectionThreeFiveApproval` (MSCSE: unshared
  junior-spring, or non-CSE); `ugToGrUnverified` (registeredLevel ≠ 'graduate' and not one of the
  shared pair → provisional, Graduate School 4+1 guidance); `bsPhdDoubleCount` (a 'bs' course inside
  the Ph.D.'s six is provisional until the DGS confirms). MSCSE courses on a Ph.D. record are
  Ph.D. coursework — one graduate program (DGS 2026-10-03); another ND department's master's is
  another program (`background.graduate === 'nd-other'` asks `finished`; priorMs completed/unfinished).
  Non-degree: `student.ndNonDegree` (asked only when a pre-entry ND graduate course is detected,
  `nonDegreeQuestion` in app.ts).
- **Ctx** (`context.ts`): `qualifierEntry` (the transfer term for `nd-mscse-transfer`, else entry —
  §4.4, §4.4.3 and the seminars use it; §4.3/§4.5 use `entry`), `clockShift` (= leaveSemesters +
  accommodationSemesters), `covidCohort` (entry ≤ Spring 2020, from the entry term, no tick box),
  `timeLimitDate(ctx, years)`, `clockShiftNote(ctx)`. `timeLimitRow` takes `completedOn` — a
  completion after the limit → `needs_dgs_review` 'Eligibility at risk' on the row AND the limit
  row (audit.ts `completeOrLate` lets that row count as complete for `allMet`).
- **New rows / ids.** `phd.rcr` (CANDIDACY group; `milestones.rcrTrainingCompleted`) and
  `phd.dissertation.submitted` (`milestones.dissertationSubmitted`; `phdTimeLimitRow`'s
  `completedOn` = submission else defense). `milestones.researchQualifierFailed` (six-month
  remediation, §4.4.3). `attestations.transferRecorded` (the §5.2 row is met only with it; else
  'Graduate School approval pending'); `attestations.qualifierExtensionSemesters` (a number;
  `qualifierExtensionGranted` is migrated to 1 by `state.ts`). `student.leaveSemesters`,
  `accommodationSemesters`, `readmittedTerm` (five-year gap → `interrupted` courses + warning).
  Optional display key `candidacy_form_deadlines` (DISPLAY_PARAMETER_KEYS; data/README.md).
- **Entry term.** Fall and spring only (`entrySeasonOptions`); a saved or imported summer entry
  reads as that fall (`state.ts`, `parse.ts` `fallFor`), with an early-start warning. The entry-term
  handler re-infers the MSCSE/other-program facts only while `student.background` is undefined.
- **Residency** (`residency.ts`): `fullTimeRecordsFrom(classified, student, floor)` is what both the
  engine and the standing card's Full-time terms fieldset read (the fieldset lists every fall/spring
  — and summers on the MSCSE — from entry to today). W/I count as registrations; only a SAME-term
  duplicate is dropped; a summer with any registration is full-time when the adjacent fall/spring
  was; a term in which every course was withdrawn (`withdrawnOnly`) is never automatic.
- **4+1 thesis/project credit** (P1-units-4plus1-17, DGS 2026-10-03): no refusal of a pre-bachelor's CSE 68901/68902 on the MSCSE tab any more — it lands in the project pool through `classifyPriorNdUndergraduate` like any 6xxxx course (fixture `mscse-4plus1-thesis-course-counts`).
- **Defense GPA gate** (P1-gpa-10): `defendedBelowGpaNote(ctx)` in `shared.ts` (next to `gpaText`; context.ts would make a cycle) — a dated `phd.dissertation.defense` or `ms.thesis.defense` with the GPA below `gpa_min` is needs_dgs_review with that sentence; `ms.project.report` is not gated.
- **MSCSE `yes` = pre-approval** (P1-levels-grades-credits-8, DGS 2026-10-03, revising 2026-10-02 (2)): `msBelowSixtyApproval` is gone; `approvalStatus` alone decides on both tabs, so a `yes` row below the 60000 level counts outright inside the allowance and only `adgs_approval` / `dgs_approval` rows carry the tick.
- **§3.6.1 guard** (P1-levels-grades-credits-4): the MSCSE refuses a CSE level-5 course in `classify()` and `priorNdShape` whatever the cell says; `validate.ts` warns about a cell that is not `no`.
- **Ticked approvals** (P1-levels-grades-credits-30): `tickApproved` is set wherever the course's own tick settled a case-by-case verdict (ND branch, transfer branch, prior-ND rows); the line builder, `capRow` and `approvalsRow` print the “as you ticked” label from it.
- **Credits as printed** (P1-units-4plus1-c7): `creditsAsPrinted` on a transfer whose effective credit system is unknown and `nd_credits` is unset; the line builder prints the note from the flag (the pending text no longer carries it).
- **Transfer marks** (P1-transfer-eligibility-7): `CourseEntry.transcriptMark` keeps the mark as printed when the student chose the letter; the line says so. A 4+1's counted 6xxxx undergraduate course carries `approvedNote` naming the sheet's yes as the Code's advance approval (P1-transfer-eligibility-24).
- **Unofficial transcripts** (P1-transfer-eligibility-16): `CourseEntry.fromUnofficialTranscript` is set by the external import when the PDF was marked unofficial; `unofficialTranscriptNote(courses)` in `email-html.ts` builds the one sentence the review request (`buildCombinedReviewRequest`'s `unofficial`), the advisor summary (`opts.unofficialNote`) and the Grad Admin request (computed from `student.courses`) carry.
- **Section chips with the handbook’s text** (DGS 2026-10-05): `sectionRef(ref, { className, dataKey })` in src/ui/section-ref.ts makes any “§x.y” chip a button with a hover/click panel. Its text comes from src/ui/handbook-text.ts, GENERATED by `npm run handbook-text` from the handbook PDF (headings are 14–18 pt lines; ligature items join; list items split). Never edit the generated file by hand. Re-run the script after the PDF changes; tests/handbook-text.test.ts compares SHA-256.
- **Admission-to-candidacy conditions** (DGS 2026-10-05): `admissionPolicyNotes` (phd.ts) lists every condition as `{ note, pageOnly: true }`; `whyFor` (advisor-summary.ts) drops page-only notes, so the emails carry the facts only. The verified source list (quotes, line numbers) is in DECISIONS 2026-10-05; re-run the sweep if a handbook edition changes.
- **Input-side "Relevant Policies"** (DGS 2026-10-05): `policyFold(key, …)` in form-helpers.ts wraps an input's policy hint in a closed selector (data-key `policy.<key>`); Your standing's selectors use it.
- **One card for OCE + RCR + admission** (DGS 2026-10-04): `phd.candidacy` and `phd.rcr` carry `mergedInto: 'phd.candidacyAdmission'` and `unscored`; report.ts skips their cards and puts their anchors on the parent; `candidacyAdmissionRow(ctx, { oce, rcr })` folds in their notes and the OCE's attention states. Emails list only the admission line. A card's `{ lead, items, fold }` part folds the items behind a selector (the specialization card).
- **Transcript-aware standing selectors** (DGS 2026-10-04, app.ts `transcriptGaps`, `fullTimeTerms`): with a `fromNdTranscript` row on file, an empty fall/spring is a gap (named in the leave question), never a research-only semester to tick.
- **Readmission under five years** (P2-dh-3.1-3.13-3/-4/-9, 2026-10-04): `readmittedTerm` with a gap under five years marks the program's own earlier `nd` rows `beforeReadmission` (provisional, review-request ask, DGS Handbook §3.3); ≥ five years stays `interrupted` (§5.5, ND and prior-ND rows). Any readmission adds a `Readmission:` review flag. An empty semester is never read as a gap.
- **Dual degree** (P2-ac-1-3-2, 2026-10-04): `Student.concurrentDegree` + `CourseEntry.sharedWithOtherDegree` add the cap `otherdegree` (nine, `DUAL_DEGREE_SHARED_CREDITS_MAX` — code, not sheet) in `classify()`'s outermost overlay `withSharedDegree`, ND rows only and only while `concurrentDegree` is true; without `attestations.dualPlanApproved` the course is provisional and its line leads “waiting for the Graduate School”. `otherDegreeCapRow` (shared.ts) builds `ms.cap.otherdegree`/`phd.cap.otherdegree`; `capRow` counts every counted credit for this cap (as for `transfer`). The standing checkbox has the key `standing.concurrentDegree`, not `attest.…` — the a11y driver's focus check clicks the first `attest.` box.
- **Status wording** (`status.ts`): `deadlineStatus` takes `extension.semesters` and `lateWording`
  (the candidacy row's late pass cites Academic Code §6.2.8, not a DGS extension).
- **Tests.** The scenario runner asserts `statusLabel` when a fixture pins it. 17 fixtures from the
  review (`phd-rcr-*`, `phd-transfer-awaits-graduate-school`, `phd-leave-shifts-clocks`,
  `phd-covid-cohort-extension`, `phd-qualifier-extension-semesters`, `phd-incomplete-*`,
  `phd-withdrawn-semester`, `phd-transfer-pass-fail-grade`, `phd-transfer-taken-after-admission`,
  `phd-nd-non-degree-before-admission`, `phd-nd-other-department-masters`,
  `phd-qualifier-clock-from-transfer`, `phd-readmitted-after-five-years`,
  `mscse-thesis-after-the-limit`, `phd-ms-along-the-way-gpa-gate`); `phd-nd-4xxxx-no-window`
  replaced `…-outside-window`. The e2e §3-leak check strips “Academic Code §…” and “DGS Handbook §…”
  citations before looking for the CSE handbook's §3.
- **Re-checking the report.** `policy-sources/.review/render_report.py result.json out.html`
  renders the artifact page from the result JSON; each finding carries `resolution`
  (`{status: fixed | ruled | updated | contradicts | open | out-of-scope, note}` — `updated` = a related change made the row's description stale, `contradicts` = for the DGS) and the page opens on the unaddressed view. The reconciliation inputs/outputs of 2026-10-03 are in the scratchpad's `reconcile/` folder (prompt, slices, outputs).
  Re-publish to the same artifact URL (STATE.md has it) rather than making a new one.

## What the student sees first (DGS 2026-10-03 — a standing rule)

- **Result cards: facts only.** `requirementCard()` in `src/ui/report.ts` renders the row's FACTS (detail
  parts that are not `{ note }`), passed through `withoutCitations()`, plus "Courses counted"; the notes,
  the course-list link and the rule quote (`sourceName()` names the document) go in one
  `details.req-more` ("Relevant Policies" since 2026-10-04, was "Details"; `data-key="more.<id>"`). In the engine, write an explanatory sentence
  as `{ note: '…' }` — `joinedDetail` joins it into `detail` like any part, so the emails and
  `detailIncludes` are unaffected. `noteOf()` (context.ts) turns the older " Note …." strings into parts.
  `tests/citations.test.ts` fails if a visible fact on any fixture still cites a section. Group
  headings drop their " — §…" on the page; the track notes carry a "Source:" line inside.
- **Uncommon inputs: `rareFold(key, question, hasAnswer, …)`** (`src/ui/form-helpers.ts`), open when the
  record already holds an answer (so nothing on file is hidden), `data-key="rare.<key>"`.
- **Citations name their document.** Write a bare `§x.y` only for the CSE handbook; write
  `Academic Code §…` / `DGS Handbook §…` for the Graduate School's (a bracket right after the name —
  "the Academic Code (§4.6)" — counts as named). `labelCitationsIn()` runs in `render()` after the
  first-mention and decider rules, on the course-rules page and on its table refresh; `copyDialog()`
  labels the three emails. Anything appended outside the root misses that pass and labels itself:
  the toasts (`toasts.ts`), the opening dialog (`app.ts`) and the earlier-degrees questions and
  dialog (`background.ts`) — a new dialog or pop-up must do the same. The decider rule spares
  "DGS Handbook" (decider.ts, first-mention.ts).

- **Staff checks (2026-10-04).** `src/data/course-checks.ts` guesses, from the course number and title, a ruling
  the DGS may not have meant: an undergraduate number on any course from another institution that could
  count (`yes`, case by case, or not in the tab yet — DGS, after IIT CS 455), and, on a `yes`, a title
  suggesting independent study, research, a thesis or a seminar. The parser warns on the row (sync log); `audit()` puts the student's own cases in
  `AuditReport.staffChecks`, which the review card adds to its notes beside `reviewFlags` and the
  processing request prints first below the line. Warnings only — never a verdict. The review card reads
  `report.reviewFlags` (it used to recompute the 4+1 flag alone, which left later flags off the email).
- **OCE and admission to candidacy are two rows (2026-10-04, DGS: “two different things”).** `phd.candidacy` (§4.5) is the exam; `phd.candidacyAdmission` (Academic Code §6.2.9; DGS Handbook §3.22.3) lists its conditions as plain-string facts (OCE, four full-time semesters via `fullTimeTermRecords`, regular credits COMPLETE, GPA, RCR) and notes; both use `eighthSemester()` / `eighthSemesterNotes(…, row)` in phd.ts. The Graduate School’s 8 and 4 are code constants (`ADMISSION_DEADLINE_SEMESTER`, `ADMISSION_FULL_TIME_SEMESTERS`). `Milestones.candidacyAdmitted` (date field after the OCE’s; `MILESTONE_FIELDS` / `ROW_MILESTONE` in grad-admin-request.ts). Consumers key on the row ids and on the note “Every condition is met” (advisor-summary `actionItems`, grad-admin-request `candidacyApplicationDue`) — keep that wording or update both. Admission to-dos follow a DATED OCE (status met or needs_dgs_review), the dissertation pair a MET one. `RequirementResult.completedLate` marks a milestone whose only question is lateness against its own deadline; `completeOrLate` in audit.ts counts it done for the eight-year row. Missing dates read cannot_evaluate (admission dated without an OCE date; dissertation milestones dated without an admission), never Overdue/probation. Milestone dates in a loaded file go through `validMilestones` (state.ts). The email re-voicing drops “Enter the date … under Milestones” (`dropsFromEmail`); write engine sentences with “you” as a subject, never an object (“admits a student”, “you may have been placed”), or the emails read “admits I”. The OCE first-mention regex is whole-word (`\bOral Candidacy Exam\b`): the §6.2.9 quote’s “doctoral candidacy examination” matched without it. Tests: `tests/candidacy-admission.test.ts`.
- **Milestone deadlines (2026-10-04).** `AuditReport.milestoneDeadlines` (src/engine/requirements/milestone-deadlines.ts) gives each milestone date key its deadline — `due`/`point` phrases, `basis` with the §, ISO `date`, `state` — computed with the rows’ own helpers (`eighthSemester`, `qualifierDeadline`, `timeLimitDate`, exported for it). The Milestones card prints `deadlineText()` (src/ui/milestone-deadline.ts) beside each box (`datedField` in app.ts: label `for` the box, the deadline tied by aria-describedby). A new dated milestone needs an entry there and in the test’s key lists. Graduate School numbers live in code, never as Parameters keys (DGS 2026-10-04); README § A5b lists them — add a new one there.
- **Standing grounds and per-term GPAs (2026-10-04).** `Student.termGpas` (each graduate term’s “Current Term” / “Cumulative” GPA) is set ONLY by the Notre Dame import (parse.ts reads the “Term Totals (Graduate)” rows; nd-upload stores, Remove/Undo restore) and read by audit.ts for Academic Code §5.7.3/§5.8 top lines; research U grades come from `classified` (course_type research/project). The Graduate School’s numbers are the constants in audit.ts (README § A5b). The Ph.D. advisor’s `advisorTtt`/`advisorTtt2` answers live in Milestones (excluded from `MilestoneDateKey`); `advisorTttState` / `advisorReviewFlag` in shared.ts. The MSCSE thesis has `thesisDefenseFailed` (one retake by the end of the following semester, `endOfNextSemester`). A zero-credit row is quiet only when its Courses row says credit_min = credit_max = 0.
- **Routing an UNFINISHED requirement to the DGS (2026-10-04).** `needs_dgs_review` renders as “Conditionally met” (report.ts `STATUS_LABEL`) and counts in the headline’s conditional number, so it belongs only on a row that would otherwise be met (or on a completion after a limit, with `statusLabel: 'Eligibility at risk'`). To send an unfinished case to the DGS, keep the row’s own status and add a note plus a `reviewFlags` line (audit.ts; pass it through `decisionWording` so the MSCSE says ADGS). Two cases do this: the MSCSE thesis readers (`Milestones.thesisReadersTtt`, `thesisReadersRouted` / `thesisReadersReviewFlag` in mscse.ts — a passed defense with “no”/“not sure” is Conditionally met, an unheld one stays In progress; asked on the thesis route only, behind the rareFold “Have your two thesis readers been nominated?”; unanswered changes nothing) and the summer-session-only seven years (`summerSessionOnly`, `SUMMER_ONLY_MS_TIME_LIMIT_YEARS`, `timeLimitRow`’s `longer` argument, `summerOnlyReviewFlag`; past five and inside seven the row is In progress against the seven; `msMilestoneDeadlines` counts an open route box against the seven too). `tuitionScholarshipNote` (context.ts, `TUITION_SCHOLARSHIP_LAST_YEAR`) is on the time-limit row only when the limit is due this or next semester or has passed — not earlier, or every email carries it. Tests: `tests/readers-summer-tuition.test.ts`.
- **Parameters cleanup (2026-10-04, DGS: “remove any rows that are not needed any more”).** There is no parked list any more: `PARKED_PARAMETER_KEYS` is gone, and the three keys it held (`ms_thesis_readers_min`, `candidacy_committee_additional_members_min`, `phd_senior_grad_credits_max`) joined the two credit factors in `RETIRED_PARAMETER_KEYS` (src/data/types.ts) — all five rows are deleted from the live sheet, and one that comes back draws “no longer read — <reason>; delete it”. To stop reading a key: move it from `KNOWN_PARAMETER_KEYS` to `RETIRED_PARAMETER_KEYS` with its reason, deploy, THEN delete the row (a required key missing from the sheet is an error in the deployed app until the new code is live). Tests: `tests/retired-parameter-keys.test.ts`.
- **Summer residency and seminar lines (2026-10-04, DGS).** `summer_fulltime_credits_min` (KNOWN, 6): `summerFullTimeFloor(program, number)` in residency.ts returns it for the MSCSE only, and `fullTimeRecordsFrom(…, floor, summerFloor)` counts a summer of that many registered credits on its own (not a withdrawals-only one) beside §3.6's `summerContinuing`; app.ts `fullTimeTerms` reads the same floor per render (the program can change under Reset). The MSCSE residency row reads cannot_evaluate without the key only when a summer with credits is the term that could count. Seminar lines: `allocate(…, { seminarCourseIds })` — audit.ts passes `phd_seminar_courses` on the Ph.D., none on the MSCSE — and `buildExplanationText`'s `fillsSeminar` decides “the research seminar requirement” vs “the total-credit requirement only”. Tests: `tests/summer-residency-and-seminars.test.ts`.
- **Graduate School steps (2026-10-04, DGS).** Grade `V` (grades.ts `isAudit`; allocate.ts sets `audited`, residency.ts and the credit sums skip it; parse.ts keeps V/AU as V). `shared.msCandidacy` (shared.ts `msCandidacyApplicationRow`, pushed by mscseRows and, after the along-the-way row, by phdRows; uncounted; `Milestones.msCandidacyApplied`; grad-admin-request `msCandidacyDue`; next-steps and advisor-summary key on the row's `unmet`). `Student.graduationTerm` → `AuditReport.graduation` (audit.ts; next-steps, grad-admin-request). The Milestones card asks it only when `AuditReport.graduationInSight` (audit.ts: Ph.D. once the OCE or a later milestone is dated; MSCSE once the definite + in-progress total reaches `ms_total_credits_min`) or a semester is already on file (DGS 2026-10-05). `attestations.timeLimitExtendedThrough` → context.ts `graduateSchoolExtension` / `timeLimitDate` (every reader of the limit gets it; `baseTimeLimitDate` is the unextended date; NOT folded into `clockShiftNote`, which also describes the eighth semester). `Student.integratedAdmitted` (background.ts asks it of an MSCSE 4+1; allocate.ts gates `bsShare === 'mscse'` extras on it). Tests: `tests/graduate-school-steps.test.ts`.

## Transfer credit already on the Notre Dame record (policy review round 3, P3-import-1 — DGS 2026-10-05, Option 1)

- **The data.** `CourseEntry.ndPosted = { term, credits, level?, institution? }` (types.ts `NdPosting`): the Notre Dame transcript's "Transfer credit accepted" block row — `term` is when the credit was POSTED (not taken), `credits` the hours Notre Dame recorded, `level` the record the block sits on (parse.ts now keeps a transfer row's level: the row's UG/GR column, else `courseSectionLevel` — never `levelFromNumber`). The ND import (nd-upload.ts) sets it on each block row it adds (undergraduate rows also get `degreeLevel: 'bachelors'`), or — when the other university's transcript already brought the course — on that row instead. `ndPostingOf()` (src/engine/nd-posting.ts) also reads a pre-2026-10-05 block row (`fromNdTranscript` + non-ND institution, no mark) as posted in its own term, level unknown.
- **The engine.** classifyTransfer: `posting?.level === 'undergraduate'` joins the bachelors branch (refused, own reason); any other posting goes to `classifyPosted` (allocate.ts) BEFORE the sheet verdict, the bachelor's-term, grade-floor and window checks and the after-admission / no-prior-program holds — none applies. Counted (`tier` definite, `effectiveCredits` = posted hours, `approvedNote`) unless held: level unknown or posted before `env.entry` (`ndPostingHeld`), or `cseUnknown`. A held row is `decidedCaseByCase` (the course tick) and settles on `dgsApproved`. `unreviewedCandidate` excludes postings (so held rows show their reason, not the candidate wording). transfer.ts: `recorded` is true when every counted transfer course is posted; posted rows are listed as a fact and never in `approvedForAll`. review.ts: counted postings ask only an open §4.4.1 core area; held ones ask the confirmation. grad-admin-request.ts never submits a posted course. phd.ts core knowledge treats a posting as passed (the block prints no grade: the row's grade is 'IP').
- **One course, one row** (src/ui/nd-posted.ts, pure): `twinOfBlockRow` (ND import: the block row is "already entered", its posting goes onto the twin at Add, ticked or not; a ticked twin is still not added), `absorbBlockRow` (other-transcript import: the new row takes the block row's posting, the block row goes), `blockRowBack` (removing that transcript turns a marked row back into the block row), `stripNdPostings` (removing the ND import takes its marks back; Undo restores them by index). Matching is `sameTransferCourse`: normalized course id + `sameUniversity` (folded names equal or one inside the other, word for word). External slots exclude ND block rows (`inSlot`). For records already holding both rows, classify() pairs them (`pairedBlockRows`): the other row carries the posting, the block row is `superseded` with "the same course as …".
- **Tests:** tests/nd-posted-transfer.test.ts; scenario phd-transfer-on-nd-record.json; e2e drive-transcript.mjs (the ND fixture's block row is Michigan EECS 58200, Banner 202620 = Spring 2027, counted as posted).
- **insideND’s current unofficial layout (2026-10-08, from the DGS’s redacted transcripts):** per term a “College   Major   Academic Standing” table, courses with a Level column, “Term Totals (Undergraduate|Graduate)”; a closing TRANSCRIPT TOTALS block with “( Graduate )” / “( Undergraduate )” lines; no degrees awarded, no program, no student type. A re-saved or redacted copy can carry one text item per glyph — `groupLines` joins touching single-character runs when they dominate a column. `ParsedTranscript.terms` holds each term’s level, college and major. Never read a real transcript except structure-only on the DGS’s machine (scripts/diagnose-transcript.mjs, scripts/sanitize-transcript.mjs).
- **UI review answers, group 3 (DGS 2026-10-09).** parse.ts `inferEntryTerm` (insideND path): with
  other-department graduate terms before the first CSE one, `alternative = { term, why, otherProgram: true }`;
  next-steps.ts and app.ts (`unfinishedOtherReading`) act on it once the earlier-degrees answer is
  `nd-other` + `finished: false`. nd-upload.ts: `takeNdImport(s)` / `putBackNdImport(s, snap, standing?)`
  are the one remove/restore; `applyNdPreview` calls `takeNdImport` first when an earlier import exists
  and its toast then carries Undo; the preview's duplicate check ignores `fromNdTranscript` rows.
- **UI review answers, group 2 (DGS 2026-10-09).** external-upload.ts `freshRecord` renders the one-line
  earlier-degrees fold (`earlier.answer` sets the module flag `answeringEarlier` and re-renders); every
  driver that answers the questions on a fresh record clicks `earlier.answer` first. The MSCSE
  project/thesis radios live in `milestonesCard` (data-key still `standing.msOption`). style.css phone
  block: `.req-head { flex-wrap: wrap }` + pill `margin-left: auto`; `.audit .scorehead, .audit > .meters`
  hidden (the `.summary-mobile` copy and the sticky bar carry the score).
- **UI review answers, group 1 (DGS 2026-10-09).** report.ts `contribSummary` reads `Contribution.kind`
  (`in_progress` | `waiting`, set in requirements/context.ts from the tier). app.ts `transcriptsCard`
  shows the Start-here badge/callout only while `fresh` (no imported row); `backgroundConsequence`
  gives the own-MSCSE one-liner unless `mscseSeparation` applies. external-upload.ts `shapeSamePlace`
  gates the one-university fold's auto-open. nd-markers.ts `headerOf` (text before the first course
  line) scopes the Notre Dame mentions; the issuer's own labels and URLs count anywhere.
- **Graduate answers the other answers rule out are hidden (DGS 2026-10-08).** background.ts
  `graduatePossible(v, partial, program)` is the one rule (4+1 option only for nd-cse without a "No";
  no regular-master's MSCSE after a "Yes"; MSCSE tab + "Yes" → only "No"); `graduateOptionsFor`
  filters the list in `graduateOrder`'s most-probable-first order for the situation (DGS, later
  that day; `wasInFourPlusOne` = the follow-up's Yes OR the `nd-4plus1` answer, which now sets the
  follow-up to Yes instead of clearing it — the follow-up is asked for every nd-cse answer, and
  `completeBackground` reads an old `nd-4plus1` record without it as Yes; "No" is ruled out after a
  Yes on the Ph.D. tab), `completeBackground` refuses a ruled-out answer, and `backgroundQuestions` builds every
  row (the drivers' data-keys stay) and `syncGraduateRows` hides/unhides them, moves them into that
  order and drops a ruled-out chosen answer on each re-render of the follow-ups. `.choice[hidden]`
  is the CSS.
- **The approval tick on undergraduate-time Notre Dame coursework (DGS 2026-10-08).** allocate.ts
  `classifyPriorNdUndergraduate`: `ticked = rule !== undefined && c.dgsApproved === true` clears the
  per-student approvals (plainBachelorsApproval, sectionThreeFiveApproval, admissionTermConflict,
  ugToGrUnverified, bsPhdDoubleCount); `dgsApprovalAsked` marks a course where any of them applies
  (before the tick) so `decidedCaseByCase` offers the tick (audit.ts `approvable`); `dgsTicked`
  puts the "approved by the DGS for you, as you ticked…" sentence on the line when the tick settled
  one and no case-by-case verdict is involved. review.ts drops the "count toward both" ask for a
  ticked course; the other asks come from the cleared flags. An unlisted course keeps no tick.
- **Next steps floats (DGS 2026-10-08).** report.ts `attentionList`: the section is `.attention.floating`
  (not when embedded) with a Hide/Show button (`report.nextsteps.toggle`, `nextStepsFolded` session
  memory; phones start folded) and its list in `#attention-body`; style.css fixes it bottom-right
  above the warnings box by `--float-warnings`, which app.ts `layoutFloats` sets from the warnings
  box's height after every render, on its Hide/Show click and on resize. Always fixed, like the
  warnings (an e942afe version that floated only once scrolled past was reverted with that commit).
  The warnings box has the same shape since later that day (DGS: "Use 'Hide' button for both"):
  `section.warnings[.floating][.folded]` > `h3#warnings-title` (+ `report.warnings.toggle` when
  floating) + `div#warnings-body`; `collapsedWarnings` (the warnings' text) remembers a fold.
- **UI review (2026-10-08).** focus-keeper.ts: a `setFocusAfterRender` target off screen is scrolled into view (ordinary renders keep the scroll); background.ts `renderFollowUps` re-focuses by data-key after rebuilding its boxes. Report card titles are `h4.req-title` (CSS keeps the old look). app.ts `asksWhichDegrees` is the one test for the which-degrees select and the Next-steps item (`needsAnswer` → next-steps.ts; any "not counted yet —" line also "needs your answer"). engine allocate.ts `ndUndergraduateCounting` is shared by classifyTransfer and the non-degree question. nd-upload.ts preview: `startUnticked` (taken at the first render) + `showUnticked` toggle; `preview.add.top` mirrors `preview.add`. report.ts `MS_FINAL` keeps the MSCSE thesis defense / project report off Next steps while their deadline is "upcoming". The contact card's phone/embed host is the footer's first child. Ten proposals that would reverse recorded UI decisions were put to the DGS, not done.
- **Earlier-degrees follow-ups sit under their answers (DGS 2026-10-07):** `placeFollowUps` (background.ts) moves each follow-up fieldset after the chosen option’s label inside the option list on every render; the boxes are built once, parked at the end of the questions, and only moved. A new follow-up needs a line there saying which answer asks it.
- **Two earlier programs; transcript gaps (DGS 2026-10-07, P3-prior-programs-3 (3), P3-ac-5a-5):** after classification, `earlierTransferPrograms` (allocate.ts) counts the programs the §5.2 courses come from; with two or more, each un-posted one is held (`twoPrograms`) — if the DGS later rules how the allowances combine, replace the hold with the rule there. The empty-semester reader now lives in the engine (src/engine/registration-gaps.ts; src/ui/withdrawals.ts re-exports it): `uncoveredRegistrationGaps` drives the audit’s warning and review line and the page’s selector, so the three cannot disagree.
- **A degree elsewhere beside the MSCSE transfer (DGS 2026-10-07, P3-prior-programs-2):** `background.alsoElsewhere` (with `finished`) exists only beside `graduate: 'nd-mscse-transfer'`. Every place that asks “was the earlier program at another university?” must read it too: `priorMsOfBackground` (prior-nd.ts), `priorSlotsFor` and `describeBackground` (background.ts), the standing sentence and `noEarlierNdProgram` (app.ts), and allocate.ts’s before-entry Notre Dame branch (`earlierElsewhere`). The engine’s caps follow `priorMs`, so they need nothing. Since P3-prior-programs-1 (a) the same question sits under `nd-mscse` and `nd-4plus1` too: `asksAlsoElsewhere` and `priorProgramElsewhere` (prior-nd.ts) are the one place that says which answers ask it. §5.2’s window for a student who finished the Notre Dame MSCSE counts back from the MSCSE’s first course (`ownMscseStart`, P3-prior-programs-4 (b)); with no MSCSE course on the record, a course outside the Ph.D.’s window is `windowStartUnknown` — held, never refused.
- **Two “keep as is” rulings (DGS 2026-10-07):** P3-hidden-inputs-1 (3) — the OCE date field in Milestones follows the OCE gate (`notStarted('phd.candidacy')` in app.ts), and anything waiting for the DGS keeps that gate closed; do not add an “Already passed the OCE?” selector or let waiting credits open it without a new ruling (the DGS weighed both and chose neither). P3-import-2 (a) — duplicate transfer rows are warned about, never held or dropped.
- **4+1 pre-bachelor’s graduate courses (DGS 2026-10-07, P3-fourplusone-1):** for a 4+1 MSCSE student, §3.5’s window (`semesterNumber(awarded, term) >= -1`) is applied in ONE place — the `sixk` filter of the bsShared selection in `classify` — so it limits only the courses shared with the bachelor’s; `classifyPriorNdUndergraduate` no longer refuses or holds an unshared course by term, by admission term, or for a junior-spring approval. It still holds a SHARED course while the award term is missing, asks the DGS about a non-CSE course, and refuses an unshared course when the student says they were admitted after the bachelor’s (“THE 4+1 ADMISSION TERM”). The three-degree warning is in audit.ts beside the UG→GR one. Do not put a term window back on unshared courses without a new ruling — the DGS reversed the 2026-09-11 one for them, and the 2026-10-04 admission-term one. The after-the-bachelor’s refusal has one exception (P3-fourplusone-2, option (2)): a row registered GR is not refused but carries `admissionTermConflict` — counted provisionally with its own approvalPending sentence, a warning in audit.ts, an ask in review.ts — because the GR registration and the answer cannot both be right.
- **Efficiency pass (2026-10-07):** three module caches — `normalizeUniversity` (data/external.ts), `canonicalCourseId` (data/assemble.ts), and the long-date formatters (ui/handbook.ts `LONG_DATE_UTC`, data/rules-date.ts `ndLongDate`). Each is safe only because its function reads nothing but its argument; if one ever takes a second input (a sheet value, a setting), drop or re-key the cache. The Grad Admin request is built once per render and passed to the card. **Tried and reverted — do not retry naively:** making the previous-university transcript reader (src/transcript/external.ts) a lazy chunk saves 45 KB of startup JavaScript, but a dynamic import that fails once (a network blip during a background warm-up) is cached by the browser for the life of the page, so every later PDF read fails; and the chunk’s file name changes with every sheet-sync redeploy (it imports the chunk that bundles data/snapshot.json), so a tab left open across a redeploy needs it fetched early. The reader in the startup bundle has neither failure. Render-loop cost is mostly the forced layout in `restoreFocus` after the full rebuild; cutting it means not rebuilding the page, which is out of scope for a pass that must not change the UI.
- **Round 3 no-decision batch D2 (2026-10-07):** the processing request’s transfers come from `processingItems`, which now drops anything with `approvalPending` and reads the allocator’s counted credits from `report.transferCredits` — never list a transfer from the classification alone, or a held or over-cap course is submitted again. A university name read from an official transcript stays as printed: Georgia Tech’s “GEORGIA INSTITUTE OF TECHNOLOGY OFFICIAL DOCUMENT INFORMATION” is its name on the sheet too (DGS 2026-10-07, reverting P3-sheet-1). The DGS made it a rule the same day (CLAUDE.md hard constraint): no ExternalCourses `university` cell is ever altered, by an agent or the DGS, and the reader must keep reading the names the sheet lists — before changing `guessUniversity` / `stripRecordWords` / `normalizeUniversity`, check that every name in data/snapshot.json’s ExternalCourses tab still reads and matches the same; tests/external-transcript.test.ts pins Georgia Tech’s.
- **Round 3 no-decision batch D1 (2026-10-07, engine):** rows merged into another card (`mergedInto`) are hidden from the headline but still requirements — the time-limit check reads them; never filter them out of a completeness test. A Notre Dame row the engine files as pre-bachelor’s coursework (`notTransferCredit` without `nonDegree`/`ndBeforeAdmission`/`ndMastersCredit`) is the undergraduate career in review.ts and never reaches the processing request’s transfers, whatever `degreeLevel` the import gave it (a GR row reads `masters`). A Parameters row whose number is also the Graduate School’s minimum is listed in `GRADUATE_SCHOOL_FLOORS` (params.ts) — add a row there when one is added. A missing cap limit is `undefined`, never `?? 0`.
- **Round 3 no-decision batch C (2026-10-07, emails):** an email to-do that depends on WHY a row needs review reads a structured flag (`courseworkReview`, `passedLate`, `forfeitReview`, `completedLate`), never the note’s words. Engine notes may end in a page instruction (“…; enter the date under Milestones once …”): `whyFor` cuts it via `withoutPageForm` and drops any statement still naming Milestones — tests/email-page-form.test.ts runs every scenario’s advisor email. The review request takes its greeting’s title as `decider`; do not run the built email through `decisionWording` again (a course’s deliberate “DGS” would become “ADGS”). The emails’ prior-study line is `priorStudyLabel(student)`, not `PRIOR_LABELS[priorMs]`.
- **Round 3 no-decision batch B (2026-10-07):** the MSCSE tab’s DGS→ADGS rewrite skips the DGS’s own dated rulings — one regex, `DECIDER_DGS` in decider.ts, used by the engine’s `decisionWording` and the page’s `applyDeciderRule`; change it in one place or the two rewrites disagree (tests/mscse-no-qualifier.test.ts guards the page). The time-limit row’s Met sentence takes `mastersApplicationOpen` from audit.ts, set on MSCSE records only. The glossary reads the summer floor from `AuditReport.summerFullTimeCredits`, never a literal 6. A two-semester leave maximum is cited to CSE §5.7, not Academic Code §5.1 (Appendix A.2 gives the Spring 2020 cohort three).
- **Round 3 no-decision batch A (2026-10-06):** capitals headings in copied emails go through `upperHeading` (email-html.ts) — never `.toUpperCase()` a heading that may carry “Academic Code” or “DGS Handbook”, or the label check (case-sensitive by design) adds “CSE”. A CSE section written after a Graduate School section must say “CSE §…”: `CONTINUATION_BEFORE` reads “Academic Code §6.1.8; §3.4” as two Code sections.
- **P3-emails-2 (DGS 2026-10-06):** `coursesNeedingDgsReviewFor` tags each ask on the way out (`tagged`): `rulings` = `decide` minus `SHEET_QUESTIONS` (COUNTS, CORE, GROUP, TRANSFERABLE, their “row is blank” forms, IS_CSE); `replyNeeded` = rulings present. A new sheet column’s question must be added to `SHEET_QUESTIONS`, or it will be asked as a ruling. buildCombinedReviewRequest reads `rulings` (falling back to the old “for me” match for an ask without them).
- **P3-emails-1 (DGS 2026-10-06):** `actionItems(report, transfers?)` / `AdvisorSummaryOptions.transfers` = `{ courses, recorded, firstSemesterDone }`; app.ts fills it from `processingItems(...).transfers` and `firstSemesterComplete`. The “approved by the DGS” reason branches (advisor-summary loop, `signOffActors`) are gone — a decided course has no pending reason.
- **P3-dh-front-1-2-2 (DGS 2026-10-06):** `SignOffActor` gained `graduateSchool`; `signOffActors` first matches `DUAL_PLAN_REASON` (the dual-plan prefix, then any real ask after “; ”, routed on its own). allocate.ts `dualPlanOnly` (set when the dual overlay is the only wait) keeps the course out of review.ts. The Approvals row’s DGS-answer note is gated on `anyDgs`.
- **P3-dh-front-1-2-1 (DGS 2026-10-06):** `conferralTerm(iso)` (term.ts) is for Notre Dame DEGREE dates only — January → previous fall. Every Notre Dame conferral date goes through it (parse.ts inferEntryTerm ×5, prior-nd.ts ×2, nd-upload.ts bachelorsAwardFrom, program-history.ts awarded); `termOfDate` stays for today, course dates and external transcripts. A new reader of a Notre Dame degree date must use `conferralTerm`.
- **P3-dh-3.14-3.20-4 (DGS 2026-10-06, (b)):** `firstSemesterComplete(student, entry, todayIso)` → `{ done, byEarlierProgram }` (allocate.ts) replaces `semesterNumber(...) >= 2` in classifyTransfer and transfer.ts; “finished earlier ND program” = `ndMasters` set, or `background.graduate === 'nd-other' && finished`.
- **P3-dh-3.14-3.20-3 (DGS 2026-10-06, option (c)):** classifyTransfer’s branch right after the no-earlier-program one: Notre Dame, not bachelor’s, no `ndMasters`, `background.graduate === 'elsewhere'` → `notTransferCredit` + `ndBeforeAdmission` + provisional with the reason; review.ts adds the twelve to `policyAsks`; app.ts `noEarlierNdProgram` drives the group word and paragraph. The 2026-10-03 non-degree question (`ndNonDegree`) is unchanged.
- **P3-dh-3.14-3.20-2 (DGS 2026-10-06):** audit.ts `gpaTerms` filters `compareTerm(t.term, entry) >= 0`. Scenario fixtures can now pin report warnings: `expectWarnings` (substrings some warning contains) and `expectNoWarnings` (tests/helpers.ts, tests/scenarios.test.ts).
- **P3-dh-3.14-3.20-1 (DGS 2026-10-06):** app.ts `backgroundConsequence` → `ndOtherUnfinishedSentence(unfinished, finished)`: §5.2 wording only when a transfer-origin Notre Dame non-bachelor’s course exists (a separate earlier admission); otherwise the program-transfer sentence. background.ts’s finished-question legend branches on `state.graduate === 'nd-other'`. Text only.
- **P3-dh-3.1-3.13-3 (DGS 2026-10-06):** `AuditReport.graduation.incompletes` = Notre Dame courses graded I in `graduationTerm` (audit.ts, beside the registration check), with a warning; next-steps.ts puts the “made final” step first and drops the Roll Call “you are registered for it” step while any exist; grad-admin-request.ts words the semester line around them; classify’s Incomplete overlay sets `incompleteInGraduationTerm` for the course line.
- **P3-dh-3.1-3.13-2 (DGS 2026-10-06, option (b)):** `transcriptGapSemesters(student, todayIso)` (withdrawals.ts) loops `first + 1 … max(last − 1, now)`; app.ts `transcriptGaps()` calls it. In `clockFields` the medical-leave count and its slot pickers are no longer gated by `leaveAsked` — only the readmission field is; the no-sign summary and legend name the medical leave.
- **P3-dh-10-2 (DGS 2026-10-06):** review.ts’s prior-ND unreviewed branch sets `transferRow` (no policy asks, not bachelor’s, not own-MSCSE, eligible, a `transfer` cap, no ExternalCourses row) and drops the emailed recommendation; transcript/external.ts `reviewRequestCourses(pending, slotLabel)` (was inline in app.ts) adds those courses to the ExternalCourses rows under `NOTRE_DAME_ROW_UNIVERSITY` and keeps them in the Courses-tab list only while that tab lacks them. allocate.ts: `decidedCaseByCase` returns true for a transfer-origin course with a `transfer` cap and a case-by-case verdict (the Notre Dame one now included); `classifyTransfer` falls back to the UNIVERSITY OF NOTRE DAME row for any Notre Dame spelling.
- **P3-dh-3.1-3.13-1 (DGS 2026-10-06):** src/ui/withdrawals.ts — `withdrawalSemesters(student)` (ND transcript records only; from the entry term on; every non-audit ND row W → 'W', every row F → 'F'; only when a later ND fall/spring exists) and `withdrawalQuestion`. app.ts `clockFields`: `leaveAsked` and the open-by-default `gapUnanswered` include them (a readmission answers it, a leave count does not). Engine residency notes (mscse.ts, phd.ts) mention the readmission.
- **P3-cse-5-6-3 + the DGS’s five-year caveat (2026-10-06):** allocate.ts `mscseSeparation(student)` (Ph.D., `ndMasters` set; last MSCSE term = the award term or the latest `isOwnMscseCoursework` course; five years by `ACADEMIC_CODE_FORFEIT_YEARS`, measured like `longInterruptionReadmission`). The classify overlay `withInterruption` sets `interrupted` + `mscseSeparated` + provisional on each own-MSCSE course (a readmission gap wins if both apply), so every `interrupted` reader (core rows’ forfeit path, categories’ `fromBeforeGap`, transfer held reasons, review.ts) handles it; `mscseSeparated` only changes the words (review.ts asks, the course line drops “counts in full”). audit.ts adds the warning and a review flag. app.ts: `ownMscseSentence()` on the standing card and above a prior-ND group when `holdsOwnMscse()`.
- **P3-cse-5-6-1 (DGS 2026-10-06):** transfer.ts builds `capNote` — “§5.2’s allowance” only for a completed degree or an unfinished master’s; “this page’s working limit” otherwise, with the no-earlier-program sentence only when a transfer course carries `noPriorProgram` (allocate.ts sets it for priorMs 'none' without `ndMasters`). app.ts: `backgroundConsequence`’s `noStatedLimit` sentence for “none” and “nd-mscse-transfer”; `transferLimitStated()` picks the Transcripts hint’s wording.
- **P3-cse-4b-3 (DGS 2026-10-06):** `candidacyRow`’s missing-date guard is `(candidacyAdmitted || defensePassed || dissertationSubmitted) && !candidacyPassed`; `candidacyAdmissionRow`’s early return for a dated dissertation adds “Oral Candidacy Exam (OCE) date not entered” (the merged OCE notes never reach that branch). `dissertationRows`: `defenseBeforeOce` / `submittedBeforeDefense` → `needs_dgs_review` with `orderNote(...)`; a submission with no defense → the defense row `cannot_evaluate`. milestone-deadlines’ `candidacyPassed` box uses `dissertationDated` too.
- **P3-cse-4a-2 (DGS 2026-10-06, option A):** `coreRows` and `categoriesRow` set `completedIn` on a met row — the earliest term a passing course satisfied the area, or the earliest term by which the passed courses reach the groups and the count (re-running `matchDistinctGroups` per term). `withQualifierDeadline(ctx, …)` now also reads MET rows: `completedIn` after `due.term` → inside `due.extendedTerm` stays met with a note and a done chip; otherwise `needs_dgs_review` + `completedLate`. `withNote` appends a `{ note }` to both detail and short detail. `qualifierUmbrellaRow` counts `completedLate` children as done (`late`), and when nothing is open and nothing forfeited it is `needs_dgs_review` + `completedLate` (time-limit row: counts as done). `researchQualifierRow` sets `completedLate` on a late pass (not on a lapsed fail or a forfeit). `oceReadiness` treats `completedLate` as done. Readers: milestone-deadlines `qualifierLate`, advisor-summary’s umbrella branch (and its core-row line skips `completedLate`).
- **P3-cse-4b-2 (DGS 2026-10-06):** no code — `oceReadiness`’s `waitingForDgs` (d953ca2) already treats a pending core area as not done; scenario phd-oce-gate-core-pending-undergrad pins the finding’s undergraduate-course case.
- **P3-cse-4b-1 (DGS 2026-10-06, “Decision 1: The exam’s semester; Decision 2: (a)”):** `audit()` builds `ctx.atOce` when a Ph.D. record has `candidacyPassed`: the student with the courses up to `termOfDate(oceDate)`, that term’s non-audit grades set to `IP`, re-classified with today = the exam date and re-allocated with the base caps plus that record’s own registration caps — a full Ctx, so the same `coreRows` / `categoriesRow` the undated gate reads answer “as of the exam” (their statuses come before any deadline; `withQualifierDeadline` adds those separately). `candidacyRow` reads `courseworkAtExam(ctx)` (the regular credits, then each core row and the categories row not met / in progress / cannot evaluate / forfeited; the components skipped for `qualifierPassedUnderPriorRules`) and sets `courseworkReview` on the row; `candidacyAdmissionRow` marks the OCE condition waiting on it; `advisor-summary.ts` words the DGS line from it; `completedLate` excludes it, so the time-limit row does not count it as done. An overdue undated OCE’s note is `oceWhenSentence(coursework)`, the Not-started card’s sentence. A fixture with a dated OCE must have its coursework at or before the exam’s semester, or it reads Needs DGS review.
- **P3-cross-doc-1 (DGS 2026-10-06, option A):** `leaveSemesters` / `leaveTerms` keep their names but mean approved MEDICAL leave only (types.ts); the input, its slot pickers, the fold’s summary and every engine sentence say so. No logic changed: the count already fed `clockShift` (time limits, both degrees) and the eighth-semester walk. A non-medical leave has no input, so its semesters count on the calendar like a gap. If the DGS later wants other leaves to move only the eighth-semester deadlines (Academic Code §6.2.8’s “of enrollment”), that is a second count feeding `eighthSemester()` but not `clockShift`.
- **P3-cse-4a-1 (DGS 2026-10-06):** in `categoriesRow`’s in-progress branch, `completing` is no longer “every in-progress course the display matching places” but the courses kept by a pass over the in-progress candidates in `sortKey` (term, then id) order, each kept when `matchDistinctGroups(qualifying + kept + it)` covers more groups — a transversal-matroid rank, so the fixed-order pick is exact and flexible courses are re-placed each step. The display matching still drives the per-course lines. `oceReadiness` reads `completingCourses` for the OCE’s earliest semester.
- **Condition marks (DGS 2026-10-06):** `DetailPart` gained `{ check, mark }` (one marked statement) and an optional `marks` array parallel to a lead’s `items`; `ConditionMark` = met / in_progress / waiting / not_yet. Every reader handles `check` (joinedDetail, the advisor summary’s flatten, the approvals loop; tests/citations.test.ts and tests/short-names.test.ts helpers) — add the case to any new switch over DetailPart. report.ts draws a marked line as `li.check` with marks.ts `conditionMark`, the mark absolutely placed in the bullet’s gutter (style.css). To mark another card’s conditions, emit `{ check, mark }` or a lead with `marks` from the engine — never infer a mark from the text.
- **P3-chg-phd-1 (2026-10-06):** `oceReadiness`’s regular-credit item reads the provisional (waiting-for-a-DGS-decision) regular credits from `alloc.perCourse` and names them; `missing` gets “the DGS’s decision on X, or N more …” (or, when they cannot close the gap, “M more …, and the DGS’s decision on X or N more”). A core/specialization row waiting on the same course does not add a second decision phrase.
- **The OCE gate and pending decisions (DGS 2026-10-06, “Treat both as not done”):** in `oceReadiness`, a core or categories row with `needs_dgs_review` and no `statusLabel` (`waitingForDgs`) pushes “the DGS’s decision on <pendingBy>” onto `missing`, so `ready` is false; regular credits awaiting a decision were already outside `definite + in_progress`. Readiness gates only an undated OCE. Tests: tests/oce-gate-pending.test.ts.
- **P3-cse-3-1 (DGS 2026-10-06; Ph.D. by symmetry):** `timeLimitRow` takes `completed?: Completion` (date, and the course/term/requirement when a course made it) instead of `completedOn`. mscse.ts `lastMsCompletion` and phd.ts `phdTimeLimitRow` build it with `lastCompletion([...milestone dates, creditsReachedAt(ctx, pick, min, label) …])`, the picks being the credit rows’ own (`countedRegular + countedOther`, `countedRegular`, the project pool, the Notre Dame regular pool). Definite, non-superseded credit in term order; the crossing course’s `endOfTerm` is the date. `summerOnlyReviewFlag` reads the same completion. Tests: tests/time-limit-coursework.test.ts; scenario mscse-last-course-after-the-limit.
- **P3-cse-1-2-2 (DGS 2026-10-06):** next-steps.ts step 2 is built from four parts — unlisted courses, case-by-case courses, the advisor (when `shared.advisor` is `needs_dgs_review`), and `report.reviewFlags` minus the advisor’s own flag (`ADVISOR_FLAG`, the prefix of shared.ts `advisorReviewFlag`; keep the two in step if that text changes). Courses alone keep the old three sentences. Step 3 switches on the advisor card’s status (`unmet` → enter the name, `cannot_evaluate` → answer the question). Covers: the transfer/approvals rows only with courses, the advisor card with whichever step names it. Step 4 (“tick the box next to each course”) still counts courses only. Tests: tests/next-steps.test.ts (hand-built reports plus one engine run).
- **P3-cse-1-2-1 (DGS 2026-10-06):** every GPA that §2.2 reads is printed with shared.ts `gpaText` — the card, both emails (advisor-summary.ts and grad-admin-request.ts standing lines, the `shared.gpa` evidence row) and the import preview’s graduate cumulative labels. Only information-only figures (undergraduate, program-only, an old record’s transcript figure in app.ts) keep `toFixed(2)`. Tests: tests/email-gpa.test.ts (2.996 in text and HTML).
- **P3-chg-phd-2 (DGS 2026-10-06):** report.ts `attentionRows(report, covered)` is the Next steps list’s pure row choice (attentionList renders it). `oceDue` lets the unscored, merged `phd.candidacy` row through when its deadline is `due_soon` or `overdue` (its anchor is the merged card’s `merged-anchor` span); `AFTER_DEFENSE` holds back `phd.dissertation.submitted` and `ms.thesis.submitted` while their status is `unmet` (= defense undated, by the engine’s construction). Admission stays hidden while the OCE is open. Tests: tests/next-steps-attention.test.ts.
- **P3-chg-other-2 (DGS 2026-10-06):** residency.ts `sameTermDuplicate(cc, classified)` is the one registration test for a superseded row (dropped only when the attempt that counts is in the same term); `fullTimeRecordsFrom`, audit.ts’s semester-of-graduation check and phd.ts’s “Registered this semester” line call it. Withdrawn/audited handling still differs by surface on purpose (a W is a registration for full-time status, Academic Code §3.3, but not for graduation). Scenarios can now pin `expectGraduation` (tests/helpers.ts, scenarios.test.ts).
- **P3-cross-doc-4 (DGS 2026-10-06):** the open-Incomplete course line (allocate.ts, course-line builder) carries the §4.4 rule with no date — the app’s grade-due stand-in (`endOfTerm`) falls after the real date, so any computed “finish by” would be late. `incompleteDue` / `INCOMPLETE_GRACE_DAYS` (30 + 14) still decides the lapse and the held “past its deadline (about …)” reason. Tests: tests/outside-incomplete.test.ts; fixture phd-incomplete-open.
- **P3-ac-6.2-app-1 (DGS 2026-10-06):** no count changed — `eighthSemester()` still walks calendar fall/spring semesters from `ctx.entry`, skipping only placed leaves; a readmission's gap is counted by ruling. phd.ts `readmissionGapCounted(ctx)` (Ph.D., `readmittedTerm` after entry, OCE or admission still undated) drives the review-request line in audit.ts (“Candidacy deadline after my readmission: …”, the open deadlines named from `eighthSemester`) and the “, and your review request asks” tail of the rows’ note, which `eighthSemesterNotes` adds while a row is open; the merged admission card filters the OCE’s copy (`Counted in calendar semesters from` in the oceNotes regex). Tests: tests/readmission-candidacy-clock.test.ts; scenario phd-readmitted-candidacy-calendar.
- **P3-chg-other-1 (option (a), 2026-10-05):** `src/engine/early-start.ts` is the one test — `isEarlyStartSummer(t, entry)` (the summer just before a FALL entry), `isEarlyStartCourse(c, facts)` (that summer, unless the record ties it to an earlier Notre Dame degree: `registeredLevel` undergraduate, `bachelorsAwarded` ≥ that summer, an `ndDegrees` date in it, a held `ndMasters` with no term or that term), `beforeProgramStart` (before the entry term and not early start). `EarlyStartFacts` is a Student slice, so the import preview passes the transcript’s own facts (nd-upload.ts `startFactsFor`; the import now sets `ndDegrees` BEFORE `reclassifyNotreDameCourses`). Callers: prior-nd.ts `isPriorNd(c, student)` (signature changed from `(c, entry)`), the preview’s prior/irrelevant/GPA tests and its early-start note, app.ts’s hand-add toast, audit.ts’s “entered as coursework of this program but dated before your entry term” warning, allocate.ts `overMaxTerms` (the summer is a graduate registration). Residency, the full-time term lists and every clock deliberately keep the fall. state.ts `validateStudent` runs `refileEarlyStartCourses` (only Notre Dame prior rows in that summer move; never a block row) and `settleAnsweredPriorMs`. `derivePriorMs` returns at once when `background` is answered — the hand-add and bachelor’s-term paths had no guard. Tests: tests/early-start.test.ts; scenario mscse-early-start-summer.
- **P3-ac-5a-3 (same day):** `longInterruptionReadmission(student)` (allocate.ts) is the one test; audit.ts puts its term in `ctx.forfeitBefore`; `beforeForfeiture(ctx, date)`, `FORFEIT_FACT`, `FORFEIT_NOTE` (context.ts). Rows that check it: research qualifier, OCE (`forfeitReview`; admission reads it), prior-rules umbrella, core rows and categories (courses with `interrupted`), seminars, MSCSE thesis defense and project report. The qualifier umbrella counts `forfeitReview` children as done and reads Needs DGS review, never Overdue. audit.ts adds the examinations review flag.
- **P3-ac-5a-2 (same day):** allocate.ts `longInterruption` = `startOfTerm(readmitted) >= addYearsIso(endOfTerm(lastBeforeReadmission), ACADEMIC_CODE_FORFEIT_YEARS)` — time away, end of the last Notre Dame term to the start of the readmission term (a Claude default the DGS may reverse; DECISIONS 2026-10-05). Tests in graduate-school-steps.test.ts; fixtures phd-readmitted-after-four-years, phd-readmitted-after-five-years-to-the-semester.
- **P3-ac-5a-1 (same day):** phd.ts `eighthSemester()` walks the fall/spring semesters from entry, skipping the placed leave semesters (`Student.leaveTerms`, by position, null = not given), to the eighth enrolled one; it adds one semester per accommodation whose `accommodationEventTerms` (birth or adoption) is on or before that term (`compareTerm`, so a summer after a spring eighth is after it), plus the COVID year; it returns `shift` (`EighthSemesterShift`) for `eighthSemesterNotes` (what moved it, what did not, what to enter). Unplaced leaves/accommodations do not move it. The time limit keeps `ctx.clockShift` (all of them). app.ts `clockFields` shows a term picker per counted leave / accommodation for a Ph.D. student (`slotPickers`), truncates the slots when a count shrinks, and opens the fold while one is empty; state.ts `validTermSlots`. The merged candidacy card drops the OCE's copies of these notes (regex in candidacyAdmissionRow).
- **P3-ac-4-1 (same day):** allocate.ts computes `incompleteDue` only for a Notre Dame course (`origin === 'nd'` or a Notre Dame institution); classifyTransfer holds another university's I (`outsideIncomplete`, `outsideIncompleteNote()`), whatever the sheet says — transfer.ts lists it in `held`, review.ts asks “decide this course once its final grade is posted”, advisor-summary words it, and the candidate line carries the note. A W from another university drops the full-time clause (residency.ts counts `origin === 'nd'` only). Tests: tests/outside-incomplete.test.ts; scenario phd-outside-incomplete.json.
- **P3-ac-5b-6.1-1 (same day):** parse.ts `noGpaHours()` — a totals row whose GPA hours (4th figure, or labelled GPA-Hrs) are 0 gives no GPA; the official PDF's "OVERALL Ehrs … QPts" line is never read as a GPA. audit.ts drops saved 0.00 figures for a semester with no Notre Dame course graded into the GPA (`GRADE_POINTS`). Tests in tests/graduate-school-grounds.test.ts.

## Night mode (DGS 2026-10-04)

- `src/ui/theme.ts`: Auto / Light / Dark. Auto = the device's `prefers-color-scheme`, followed live (Claude Desktop's behaviour; no clock). Saved per device under `cse-degree-audit/v1/theme` (absent = Auto). Embedded, Auto resolves to light. The resolved theme is `data-theme` on `<html>`.
- `index.html` and `courses.html` repeat the resolution inline in `<head>` so the first paint is right; keep the key and the embed rule in step with theme.ts (`tests/theme.test.ts` checks the key).
- **Every colour in `src/style.css` is a token** (`tests/theme.test.ts` fails on a literal outside `:root` and `@media print`). Add a new colour as a token with BOTH values: the light one in `:root`, the dark one in `:root[data-theme="dark"]` (inside `@media screen`, so printouts stay light). `--navy` is text and rules; a filled control uses `--navy-fill` with `--on-fill` text — one colour in light, two in dark.
- The e2e (drive-a11y `checkNightMode`) switches each page to Dark, runs axe (contrast), screenshots `app-dark.png` / `courses-dark.png`, and switches back to Auto.

## Simulation mode (DGS 2026-10-09) — the sandboxed record

The DGS asked for a planning mode: a student changes the "current term", adds the courses and
milestones they expect, and sees how the report would read then — with no request, Grad Admin
request or advisor report possible, and the record untouched. `src/ui/simulation.ts` is the
pure half (tests: `tests/simulation.test.ts`); the plumbing is in `src/ui/app.ts` under
"simulation mode". What a later session must not undo:

- **Two storage keys, one `student` variable.** The real record stays under state.ts's
  `LS_KEY`. The simulation is a deep copy under `SIM_KEY` (`cse-degree-audit/v1/simulation`,
  `{ term, student }`), swapped into `let student`, with the real one kept in `realStudent`.
  `persist()` is the ONLY call to `saveLocal`/`saveSimulation` in app.ts — every save in the
  file goes through it, and in the mode it writes the simulation, never the real key. If you
  add a save, call `persist()`; a bare `saveLocal(student)` would re-create the path that
  turns a plan into the record.
- **Exit restores from memory** (`realStudent`) and never re-saves it; `clearSimulation()`
  drops the copy. No real record on the device → the opening dialog, as after Reset. Reset in
  the mode is `restartSimulation` (a fresh copy, same semester); the real record cannot be
  cleared from inside the mode.
- **`todayIso` is a function** — `todayIso()` is the simulated date (`simulationToday`:
  the real date while the semester is the real one, else the semester's first day);
  `realTodayIso` is the real one. The readers that must stay real are marked "(D5)" in
  app.ts: the transcript's empty semesters (`transcriptGapSemesters`, the standing fold's
  summary line), the rules' date line, the print header's date. The registration-gap
  question (`uncoveredRegistrationGaps`, which opens the `clocks` fold) reads `todayIso()`
  — the engine's date, since the engine gets one `today` and is not changed; the review
  fix of 2026-10-09 (DECISIONS) ended a split where the report warned about the plan's
  empty semesters while the fold it pointed at stayed closed. Do not move it back.
- **The picker** lists `simulationTerms(realTodayIso)` (real current term → same season ten
  years on, summers included); `defaultSimulationTerm` is the next fall/spring on fall/spring
  slots; a stored or loaded semester is `clampSimulationTerm`ed on load so time never runs
  backwards. Option values are the `termShort` codes, parsed back with `parseTermCode`.
- **The saved file** in the mode is `simulationFilePayload` — `note` FIRST, then
  `simulation.term`, `savedAt`, `student` — named `cse-degree-audit-<program>-simulation-<SP28>.json`.
  `validateStudent` ignores the two extra keys, so an older build loads it as a record;
  `simulationTermOfFile` is how this build tells the two apart: loaded outside the mode it
  enters the mode with that semester (the real record untouched); inside the mode any file
  loads into the simulation.
- **The mode on the page**: `markSimulationMode()` (run by every render) sets `html.simulation`
  and the tab title; the banner is first in `<main>` after the print header; the strip
  (`.simulation-strip`) shows only at ≥ 901 px outside the frame, the phone's sticky score bar
  carries the mode below that; a "Simulation" chip is repeated beside EVERY score headline the
  bar watches — `root.querySelectorAll('.summary-mobile .headline, .audit .scorehead .headline')`,
  the selector `watchScoreHeadlines` uses (appended after `renderReport`, like the first-mention
  rule) — and in each request card, in EVERY mode since the review fix of 2026-10-09 (it was the
  frame's alone, and on a phone the sticky bar hides while a score headline is on screen, leaving
  no marker in view). The closing e2e the same day found the review fix had chipped the report's
  headline alone, which a phone HIDES (style.css: `.audit .scorehead { display: none }` under the
  phone query) in favour of the `.summary-mobile` copy at the top of the page: the chip must follow
  the observer's list, and tests/simulation.test.ts pins the two selectors to each other. Enter
  focuses the picker, Exit focuses `tools.simulate`; the three `srStatus` announcements are
  set AFTER `render()`, which otherwise overwrites them with "Report updated".
- `confirmDialog` (copy-dialog.ts) now closes once: its queued `close` event used to call
  `returnFocusTo` a second time, after the caller had re-rendered the page without the
  opening control, and the heading fallback stole the focus Exit had just placed.
- The e2e drives the whole mode on both engines (closing verification 2026-10-09):
  `driveSimulation` in drive-app.mjs loads the example, enters from `tools.simulate` (banner,
  tab title = "Simulating <term> — " + the page's title, masthead and headline chips, the
  standing chip, focus, announcement, the inert buttons WITH their reasons), moves the picker
  two years on (same season) and asserts the report moved (pills / deadline chips row by row —
  the Ph.D. example's qualifier rows go Overdue and candidacy comes due), plans CSE 60772 with
  grade A in the simulated semester (it must COUNT: `td.counts .mark-counts`) and MATH 60610
  (unknown to the sheet, so the review card and `review.copy` appear), checks the two cards'
  one-sentence texts and chips and that Next steps carries ONE simulation step and no sending
  step, saves to a file (the download is caught in the page by patching `HTMLAnchorElement.
  prototype.click` and `URL.createObjectURL` — nothing lands on disk headless; the name is
  `cse-degree-audit-phd-simulation-<code>.json`, the note first), reloads (reopens in the
  mode), checks the phone at 390 px (the `.summary-mobile` headline chip in view while the
  bar is hidden, then the bar's "Simulation · <term> — …" once the headline is off), the
  frame (`?embed=1`: headline and card chips, the banner first, no strip) and the course-rules
  page (untouched by the stored simulation), Starts over (the dialog names "2 courses"; the
  copy is fresh, the semester kept), Exits (the dialog names "0 courses"; the record's course
  count and the tab title back), then feeds the saved plan through `save.fileinput`
  (`setFileInput` on the hidden input works in both engines) and asserts the mode re-entered
  with the file's semester and plan and the toast — the REAL key
  (`cse-degree-audit/v1/student`) byte-identical at every one of these steps while
  `cse-degree-audit/v1/simulation` holds the plan and is gone after Exit. Screenshots
  `simulation-mode`, `simulation-banner`, `simulation-phone-headline`, `simulation-phone-bar`,
  `simulation-embed`. Iterating on it: `E2E_ONLY="app basics" npm run e2e` (about 25 s). drive-app.mjs's tools-row order includes
  `tools.simulate`; drive-a11y.mjs's first-screen tab-stop threshold is 13. The DOM-free
  invariants (one `saveLocal(` inside `persist()`, render-before-persist in
  `setSimulationTerm`, the preview flag on `routeLoadedFile`, the gap date, the ungated
  chips) are read from the source by tests/simulation.test.ts — a refactor that renames
  those lines must update the test, not drop it.
- **The crash fallback** (main.ts, review fix 2026-10-09): `crashRecovery(simulationStored(),
  reason)` decides what the one button clears. With a simulation stored the page opened in the
  mode and drew the copy, so the button discards the simulation and keeps the record; without
  one it clears both keys. Never clear the record's key alone — that was the data-loss bug.
  `setSimulationTerm` renders before `persist()` for the same reason the file handler does.
- **Nothing is sent from the mode (D6/D7).** In the mode `review.copy`, `gradadmin.copy`
  (whatever its count), `save.copy` / `save.summary`, `tools.example`, `import.nd`, the three
  `ext.import.<level>` buttons and `ext.scan.ocr` are `inactiveButton`s with a reason —
  `simulationSendNote(what)` and `SIMULATION_EXAMPLE_NOTE` in app.ts, `SIMULATION_IMPORT_NOTE`
  in dom.ts, which reaches the two upload modules through the `simulation` flag on
  `NdUploadArgs` / `ExternalCardArgs` (set beside `blocked` in `transcriptsCard`). Remove,
  Change and a waiting scan's Cancel stay active: they edit the copy or clear the scan. If you
  add a control that sends, emails or imports, gate it on `simulation` the same way; a bare
  `disabled` would hide the reason. The review and Grad Admin cards keep their lists and show
  one sentence in place of their instruction paragraphs; `nextSteps({ simulation: true })`
  folds every sending step (href `#dgs-review` / `#grad-admin`, plus `ADVISOR_SUMMARY_STEP`)
  into one step carrying the union of their `covers` (`foldSentSteps`), so `attentionRows` is
  the same in and out of the mode — a new sending step must use one of those two hrefs or it
  will survive the fold.
- **Where "Load a file" puts a file** is `routeLoadedFile` (simulation.ts, pure, tested):
  outside the mode a record replaces the record and a simulation file enters the mode with its
  semester (the page's record becomes `realStudent`); inside the mode any file loads into the
  simulation (a simulation file brings its semester). The handler destructures its result
  into `student` / `simulation` / `realStudent` and restores all three if the render throws.
  It passes `previewOpen: ndPreviewOpen() || importsBusy()`, and the router refuses a
  simulation file that would enter the mode under an open preview or scan
  (`SIMULATION_FILE_PREVIEW_NOTE`, review fix 2026-10-09) — the same guard `enterSimulation`
  has; otherwise the preview's Add filed the real transcript's rows into the plan.
- **D10 on the page**: the Coursework card's hint in the mode (a planned course needs its
  expected grade — In progress never counts) and the print header's "SIMULATION — not your
  real record. Printed on <real date>; the current semester in this simulation is <term> — …".

## Invariants — keep these true

1. `npm test` and `npm run build` green before anything merges; `npm run e2e` for UI changes.
2. No network calls at runtime except the sheet fetch. No analytics ever. Student data —
   including uploaded PDFs — never leaves the browser (the page PROMISES this for FERPA;
   see the footer and MAINTENANCE.md).
3. Engine purity: no DOM/fetch/`Date.now()` in `src/engine/` — "today" is an argument.
4. Never guess: unknown course / missing parameter / unapproved thing ⇒ needs-review or
   cannot-evaluate, with the sheet problem named in plain English.
5. Every requirement function keeps its handbook sentence quoted above it; the requirement-id
   registry and fixtures must stay in sync (a meta-test enforces both directions).
6. Sheet schema is a human contract: changes need DGS sign-off + `data/README.md` +
   `MAINTENANCE.md` + fixtures/samples updated together.
7. Handbook beats code; DGS decisions live in `docs/DECISIONS.md` — read before overruling,
   append when a new call is made (date, question, decision, who).
8. No regex lookbehind in `src/` (2026-10-10): esbuild silently turns one into a run-time
   `new RegExp`, which Safari before 16.4 cannot compile — two of them blanked both pages there.
   `tests/browser-support.test.ts` enforces it; write the check out in code instead
   (`otherNotreDameSpans`, `campusNamedAt`, `splitStatements` are the patterns). pdf.js stays on
   its LEGACY build (same test).

## How to verify like the original session did

- `npm test` — scenario fixtures in `tests/scenarios/*.json` (schema: student + pinned
  `today` + rules patch + expected status/detail substrings per requirement id). Add one per
  bug, forever.
  `tests/verdicts.json` (2026-10-11, item 3) pins EVERY row of every scenario — status, statusLabel,
  `progress.have/need`, deadline state (`tests/verdict-table.ts` `verdictOf`); `tests/verdicts.test.ts`
  lists each change. An engine change that moves a verdict: put the list in the reply for the DGS,
  then `npm run verdicts -- --update` and commit the file with the change. The `life-*` scenarios
  are whole degrees with every row pinned; `tests/missing-parameter-never-passes.test.ts` (item 1)
  re-runs every scenario with each engine key removed.
- **Stamps** (2026-10-11, item 8): `Rules.fingerprint` is set in `rulesFromCsvTexts` from the texts
  it was given (`rulesFingerprint`, FNV-1a over `normalizeCsvText` of each tab, a fixed tab order,
  a name separator; an absent optional tab is skipped). `src/ui/stamp.ts` `resultStamp(rules)` +
  `stampLine` / `checkedWithLine` is the ONE wording — footers (`.legal-stamp`), print header
  (`.print-stamp`), the three emails' `stamp` option, and `savedStamp(stamp, auditDate, rows)` in
  the saved and simulation files (`stamp` between `savedAt` and `student`; `validateStudent` reads
  only `student`). `src/ui/build-info.ts` reads Vite's `__APP_BUILD__` with a `typeof` guard so
  node runs. `src/engine/verdict.ts` `verdictOf` is shared by the saved file and the approved
  verdicts. `npm run reproduce` (`scripts/dev/reproduce.mts`) is tested end to end in
  `tests/stamp.test.ts`; the e2e checks the footer, print header, saved file, simulation file,
  processing request and review request.
- **Course sources** (2026-10-11, item 6): `CourseEntry.imported` {transcript 'nd'|slot, on, app},
  `changedOnImport` (ImportedField[]) and `typedByStudent` are set at Add — nd-upload.ts (Notre Dame
  rows cannot be edited in its preview), external-upload.ts `courseEntryOf(r, p, university,
  imported?)` (the preview row's `read` is snapshotted when the preview is built, after the
  app's own level prefill; `changedFields` compares with canonical course ids), app.ts's
  Add-a-course form. state.ts drops a malformed mark. `src/ui/provenance.ts` `sourceOf` /
  `sourcesLine` word them; the engine never reads them. grad-admin-request.ts: `ProcessingTransfer.source`,
  `CountedCourse.source`, a Source column in both tables, “as I entered it” / “as I ticked”; the
  course table is one row per REGISTRATION (`StandingTable.courseEntries`, the k-th listing of an
  id = the k-th definite, non-superseded classified entry). `betaNotice(program)` adds
  `ALONG_THE_WAY_NOTICE` on the Ph.D. tab; BETA_NOTICE itself is the DGS's wording — never edit it.
- **Plan notes** (2026-10-11, item 19): `src/ui/plan-notes.ts` `planNotes(c, rules, realTerm)` — Notre Dame
  courses in a semester after the REAL current one, only in simulation mode (app.ts course cell,
  `.plan-note`). `offered_next` goes through schedule-terms.ts `rowSchedule` so it means what the
  course-rules page means. `LAST_OFFERED_RECENT_SEMESTERS = 4`. The `clock-*` scenarios cross each
  deadline the day before and after; regenerate any of them only with the DGS's approval of the
  verdict list.
- **Problem links** (2026-10-11, item 18): `src/ui/report-problem.ts` builds both mailtos (to
  `deciderContact(program)` — the ADGS on the MSCSE tab, whose DOM rewrite turns “Tell the DGS”
  into “Tell the ADGS”; undefined when `looksLikeEmail` fails). report.ts `renderReport(…, {
  problemHref })` sets the card line (`.req-problem`); app.ts passes none in simulation mode. The previews
  use external-upload.ts `readerProblemLink(key, problem, checkedWith, editable)`, whose href is
  rebuilt in the click handler (the rows change without a re-render). `maskShape` is
  diagnose-transcript.mjs's mask, Unicode-aware. Reports are logged in docs/ACCURACY-LOG.md.
- **Notre Dame corpus** (2026-10-11, item 12): `tests/fixtures/nd-transcripts/` + `scripts/dev/score-nd.mts`
  (`ndRowOf` — a transfer-block row's institution rides in the title cell; `scoreNdDocument`) +
  replay's `nd` lane and its `isNotreDame` PDF expectations; rebuild with
  scripts/dev/make-nd-corpus.mts. Sanitizer `finish()` (rules.mjs): called by pdf-io.mjs and the
  `--words` path; recomputes row points and totals, randomizes on any mismatch; tests/sanitize.test.ts
  checks the Notre Dame fixtures' GPA after sanitizing.
- **Totals self-check** (2026-10-11, item 11): `src/transcript/totals-check.ts` `checkTotals(aligned rows,
  PrintedTotals[])` — rows index-aligned with the reader's rows (a line's `rows` are indices; external.ts
  keeps a parallel `rowBlocks` with `rowLevels`, spliced together). parse.ts records six-figure lines
  (`recordTotals`) and exports `totalsMismatchesOf`; external.ts `readPrintedTotals` records Banner's
  labelled term line and TOTAL INSTITUTION only. nd-upload.ts stores `totalsCheck` on the preview;
  external-upload.ts computes `previewTotalsCheck(p)` at render from `allRows` (the same objects as
  the shown rows). Any new recorded shape needs the corpus guard to stay silent first.
- **Reading fixes by impact** (2026-10-11, item 14): scripts/dev/audit-impact.mts (true vs read rows → two
  audits; unmapped marks left out alike, `rawMarksOf`). external.ts: LEAD_CODE_RE's first branches
  (McMaster, SNU) and last (a one-digit number alone in its cell, `(?=$)` — on OCR lines only with the
  row's credits and a grade or an in-progress block, item 13's full-ladder check); DIGIT_LED_CODE_RE's SNU
  shapes; `inProgressByTermLine`; the winter-range rule in readTermLine; TR rows → transferRowsSkipped;
  `numericFillsRest` with a term column; `fallWinterSession` + the [BGST] suffix; the semester-parity
  rule; the Ladok module filter after CC15; `issuedDegree`; tokensOf strips Oregon's `>N` and P/N `*`;
  the present-tense quarter-hours key. Every one was replayed against the corpora with zero regressions.
- **OCR cell evidence** (2026-10-11, item 13): external.ts sets `evidence` ('credits' | 'mark' | 'totals')
  with `lowConfidence` after the rows are read, on OCR lines only and never on a not-a-transcript document;
  `totals` re-uses item 11's `checkTotals` on `totalsRead`. external-upload.ts titles the ⚠ with
  `OCR_FLAG_TITLE[r.evidence ?? 'confidence']`. tests/ocr-evidence.test.ts. The bench's flag recall counts the
  Notre Dame seeds, which are never flagged (the Notre Dame import refuses a scan): OCR-BENCHMARK.md gives
  both counts. e2e: the `scanClean` and `scannerLayer` fixtures in scripts/e2e/run.mjs.
- `npm run e2e` — real headless-Chrome pass (see `.claude/skills/run-app/SKILL.md`); since
  2026-09-05 it ends with the accessibility/phone driver (axe-core zero-violation gate, dialog and
  focus-preservation keyboard checks, 390 px no-sideways-scroll check on both pages). `E2E_ONLY=`
  a substring of a driver name runs just that driver while iterating.
- `E2E_BROWSER=webkit npm run e2e` (or `npm run e2e:webkit`) — the same drivers on Safari's engine
  (Playwright's WebKit build; one-time `npx playwright-core install webkit` per Mac), screenshots
  in `.e2e-out/webkit/`. Run it too whenever layout changed — Chrome alone missed a Safari-only
  bug on 2026-09-06.
- `E2E_BROWSER=firefox npm run e2e` (or `npm run e2e:firefox`, 2026-10-10) — the same drivers on
  the installed Firefox, headless, over WebDriver BiDi (`scripts/e2e/firefox.mjs`; no dependency,
  a throwaway profile), screenshots in `.e2e-out/firefox/`. Run it with WebKit's whenever layout
  changed: Firefox alone draws a number box's spinner at all times, and alone printed the
  report's folds open. `E2E_PORT` / `E2E_DEBUG_PORT` move the ports.
- `E2E_BROWSER=opera npm run e2e` (or `npm run e2e:opera`, 2026-10-10) — the installed Opera
  through `cdp.mjs`, exactly as Chrome (Opera is Blink). `E2E_HEADED=1`: Chrome or Opera in a real
  window (`Runtime.evaluate` then runs as a user gesture — a script click is no gesture, and Opera
  held the clipboard write open). `E2E_BLINK_PREFS`: browser preferences in the fresh profile —
  Opera's “Force dark pages” is `ui.webkit.force_dark_mode_enabled_proxy` +
  `webkit.webprefs.force_dark_mode_enabled` + content setting `force_dark_mode: 1`. Opera's
  repaint ignores `color-scheme` (`only light` too), so the page detects it instead
  (invariant: `FORCED_DARK_LINK` in `src/ui/theme.ts` and both pages' first-paint scripts agree —
  `tests/theme.test.ts`), and Auto shows the page's own dark theme.
- `E2E_BROWSER=safari npm run e2e` (or `npm run e2e:safari`, 2026-10-10) — REAL Safari over
  classic WebDriver through `safaridriver` (`scripts/e2e/safari.mjs`; one session, a tab per
  driver; print media emulated as in Firefox; evalJs is an indirect eval inside Execute Async
  Script). Needs "Allow remote automation" (Safari → Settings → Developer) once per Mac, an
  unlocked screen and the automation window left visible (it stops at once if Safari draws no
  frames); the window's 336 px minimum makes the 320 px checks measure 336 px. First full run
  2026-10-10, Safari 26.6.2: all four drivers pass.
- `npm run sync-sheet` — fetches the live sheet, prints its diagnostics, and rewrites the
  snapshot only if the sheet content changed (it says which tabs).
- Read screenshots you take. A wrong verdict is easier to spot in the rendered report than in
  JSON.

## Recipes for the asks you'll probably get

- **"New handbook year"**: new PDF in `docs/` (keep old), update `CLAUDE.md` filename, diff
  §3/§4 old-vs-new, route numbers→Parameters tab, course lists→Courses tab, structure→code
  (quote the new sentence); nothing in `src/ui/handbook.ts` needs changing for a new edition
  (`HANDBOOK_URL` is the DGS's permanent Google Drive link since 2026-09-30 — new editions are
  new versions of the same file — and the title names no edition, DGS the same day; the same
  address is written into index.html and courses.html)
  (the masthead, footer and copied summary all read from there), then grep for the old edition
  string to catch stragglers, log decisions.
- **"Course X should count for Y"**: that's a SHEET edit, not code. Say so.
- **"Add a checkable requirement"**: implement in `src/engine/requirements/{shared,mscse,phd}.ts`
  with the quoted sentence; register the id in `audit.ts` REQUIREMENT_IDS; add a scenario
  asserting it (the registry meta-test fails until you do); wire any new number through a
  Parameters key (add to `KNOWN_PARAMETER_KEYS`, `data/README.md`, samples, fixtures, and tell
  the DGS the row to paste).
- **"Transcript parsing broke"**: never ask for the PDF (FERPA). Have the DGS run
  `npm run diagnose -- file.pdf` and paste the output: per-page counts (runs, rotated, dropped
  as watermark, columns) and every line's shape (letters→a/A, digits→9, `|` = column gap).
  From the shapes adjust `src/transcript/layout.ts` (columns, watermarks) or the row patterns in
  `external.ts` / `parse.ts`, then add invented lines of the same shape to the tests and, for a
  new layout, a positioned-run fixture in `tests/fixtures/make-transcript-pdfs.mjs` plus an e2e
  leg. If the DGS shares his OWN transcript, use it only in the scratchpad and delete it.
- **"Grandfather a parameter change"**: Parameters have no rules_effective_term — that's a real code
  change (mirror the Courses-row versioning); warn the DGS it's nontrivial.
- **"Embed the course list in a WordPress page"**: it already works — point the DGS at README
  § "Embedding these pages in a WordPress page" rather than writing code. `?embed=1` on either
  page, the `iframe` shortcode (ND's multisite strips raw `<iframe>`/`<script>` from post
  content, so never suggest a Custom HTML block), and `docs/wordpress-footer-snippet.html` in
  the "Head, Footer and Post Injections" footer field for auto-resize. To allow a NEW host,
  add its origin to `EMBED_PARENT_ORIGINS` in `src/ui/embed.ts` and to the assertion in
  `tests/embed.test.ts` and the e2e's `expected` list — three places, on purpose. To change what
  the embed hides, look for `isEmbedded()` in `courses-page.ts` / `app.ts` and the
  `html.embed …` block at the end of `src/style.css`; re-run `npm run e2e` in BOTH engines and
  look at `phone-courses-embed-360` / `tablet-courses-embed-700` / `-1100`.
