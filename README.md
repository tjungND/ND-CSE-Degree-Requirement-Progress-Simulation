# ND CSE Degree Requirement Progress Simulation

A web page where Notre Dame CSE graduate students self-check, requirement by requirement, where
they stand against the Graduate Studies Handbook (§3 MSCSE, §4 Ph.D.), with the handbook section
cited on every line. It is a self-check, not an official audit.

- **Live app (simulation tool):** https://tjungnd.github.io/ND-CSE-Degree-Requirement-Progress-Simulation/
  (the address is shown under the repository's *Settings → Pages*; it changes if the repository is
  ever transferred to another account — see the handoff checklist)
- **Public course-rules list:** https://tjungnd.github.io/ND-CSE-Degree-Requirement-Progress-Simulation/courses.html
  — which courses count toward each degree, their core area and specialization category, when
  they are typically offered, and whether the DGS has confirmed the row. Generated live from the
  same sheet; safe to link from cse.nd.edu and to send to students, and embeddable in an ND
  WordPress page with `?embed=1` (see below).
- **Rules sheet (the DGS edits this):** Google Sheet **CSE-Degree-Checking-Rules** (renamed from CSE-Degree-Audit-Rules on 2026-09-05) —
  https://docs.google.com/spreadsheets/d/1C8zYQvLN3gsOpjQHR1RMKdekB1VC_nv9rwSJ_RQCxVA/edit
  — in the **CSE Department Adminstration: Graduate Programs** shared drive (moved there on
  2026-09-21; the drive owns it, so it stays behind when a DGS hands over)
- **Code:** this repository, https://github.com/tjungND/ND-CSE-Degree-Requirement-Progress-Simulation

The app was built so that a Director of Graduate Studies (DGS) can run it **without being a
programmer**. Everything that changes from year to year — which courses count, their
core/specialization tags, every numeric threshold — lives in the Google Sheet. The code encodes
only the handbook's *structure* and changes only when the handbook does.

```
Google Sheet (you edit)  ──publish-to-web CSV──►  static web page (student's browser)
         │                                                ▲
         └── 6-hourly GitHub Action ─► data/snapshot.json ┘  (fallback if the fetch fails; also dates the rules)
```

## Which instructions do you need?

| You want to… | Read | Needs |
|---|---|---|
| Change which courses count, their tags, or a number the **department** sets (the CSE handbook's) | **[Track A](#track-a--updating-the-rules-no-programming)** | Edit access to the Google Sheet. Nothing else — no GitHub, no code. |
| Change what the app *does* (a new requirement, new handbook structure, UI, transcript parsing, a re-published sheet) — or a number set **above the department**, by the Graduate School ([list](#a5b-numbers-the-sheet-does-not-hold)) | **[Track B](#track-b--changing-the-app-with-claude-code-or-codex)** | Access to this repository, Node.js, and an AI coding agent (Claude Code or Codex). |

Both tracks share the [yearly routine](#the-yearly-routine-both-tracks), [embedding the pages
in a WordPress page](#embedding-these-pages-in-a-wordpress-page), [where things
live](#where-things-live), the [handoff checklist](#handoff-checklist) and the three properties
below.

## Three properties to never break

1. **No student data ever leaves the student's browser.** No server, no accounts; even uploaded
   transcript PDFs are parsed on the student's own computer. This is the FERPA story, and the page
   promises it to students.
2. **Policy lives in the sheet, structure lives in code.** Never hard-code a course number or a
   threshold the department sets. The sheet holds **only what the department controls**: which
   courses count, their tags, and the CSE handbook's numbers. A number set above the department —
   by the Graduate School's Academic Code or its DGS Handbook — is not the DGS's to tune, so it
   lives in the code beside the sentence it comes from, and changing it is a Track B change
   ([A5b](#a5b-numbers-the-sheet-does-not-hold) lists them).
3. **The app never guesses.** Anything the sheet does not settle shows "needs DGS review"; a
   missing number shows "cannot evaluate", never a silent pass.

---

## Track A — Updating the rules (no programming)

Everything in this track happens in the Google Sheet. Students see your edits on their next page
load, about five minutes after you make them. Nothing needs to be deployed.

### A0. One-time: get edit access to the sheet

1. Ask the previous DGS to open the sheet, click **Share**, and either add you as an **Editor** or
   (better) **transfer ownership** to you or move the sheet into a departmental **Shared Drive** so
   it never depends on one person's account. The app's links are tied to the sheet itself, not to
   its owner, so they should survive either change — verify with A7 afterwards.
2. Open the sheet and read its **README** tab once. It explains every column and the color coding
   (light-yellow cells are yours to decide; grey columns are informational copies from Banner).
3. The app reads five tabs — **Courses**, **Parameters**, **Categories**, **ExternalCourses**, **Universities** (each other university's credit system, one row per university, since 2026-10-10) — and ignores the rest.
   **Changelog** is for humans: log every edit there.

### A1. Know the columns you will touch (Courses tab)

One row per course. Choose values from the dropdowns; anything outside the allowed set makes the
app skip that row and report it.

| Column | Allowed values | What it means |
|---|---|---|
| `course_id` | e.g. `CSE 60641` | Department code, one space, five digits. The key. |
| `course_type` | `regular` / `seminar` / `research` / `independent` / `project` | Only `regular` counts toward the 24 regular-course credits (§3.2, §4.2). Watch for research or thesis courses mistyped `regular`. |
| `counts_toward_mscse`, `counts_toward_phd` | `yes` / `no` / `dgs_approval` / `adgs_approval` | `dgs_approval` / `adgs_approval` count provisionally and tell the student to get the advisor's sign-off and the DGS's or the ADGS's — the cell names who, not the program (today MSCSE approvals are the ADGS's). **Blank** makes the app say "needs DGS review". |
| `core_area` | `os` / `algorithms` / `architecture` / blank | Which §4.4.1 core-knowledge area the course satisfies. |
| `category_group` | one or more of `alg` / `hcc` / `arch` / `dsai` / `sys`, or `ineligible` / blank | Which §4.4.2 specialization group(s) it belongs to; with several, the student picks one. A course in every group names all five (Research Methods) — the old `any` was retired on 2026-09-18. `ineligible` = can never satisfy the category requirement — all 40000-level courses are marked this way. |
| `active` | `yes` / `no` | `no` hides a retired course from the student's picker but keeps it recognized for students who took it. |
| `rules_effective_term` | e.g. `Fall 2026` | First term this row applies. See A3. |
| `dgs_reviewed` | `yes` / `no` | `yes` shows the row as **Confirmed** on the public course-rules page; anything else shows **Pending**. The audit engine ignores it — an unreviewed `yes` in `counts_toward_*` still counts. |
| `notes` | text | Your own working notes; not shown to students anywhere (since 2026-09-09). |

`offered_now` and `offered_next` (`yes` / `no` / blank) say whether a course is on the schedule
this semester and next; the course-rules page turns them into two cards at the top of the page.
Each row's `last_offered` — the last term the course was actually offered (DGS, 2026-09-18) —
dates them: a row dated THIS semester is read as written, and a row dated any other semester shows
nothing and is counted, with the reason, in a "not shown" line under the cards. The current
semester comes from Notre Dame's date, not from the sheet. **When you fill `offered_now` /
`offered_next`, set `last_offered` to the same semester in the same edit** — that is what tells the
page the row is current.

The other columns (`title`, `level`, `credit_min`, `credit_max`, `credits_default`,
`typically_offered`) are informational — `last_offered` is not: it dates the two schedule columns,
as above. `credits_default` is what the app
pre-fills; leave it blank for variable-credit courses. Full schema: `data/README.md`.

### A2. Add a new course

1. Confirm the exact number and title in Banner / class search.
2. In the **Courses** tab, right-click the row number of a similar course → **Insert 1 row below**,
   then copy the similar row into it (or simply add a row at the bottom — order does not matter).
3. Fill in: `course_id` in the exact `CSE 60641` format; `title`; `level` (first digit of the
   number); `credit_min` / `credit_max` / `credits_default` (3 / 3 / 3 for a normal course);
   `course_type`; `counts_toward_mscse` and `counts_toward_phd`; `core_area` and `category_group`
   if it qualifies, otherwise blank (`ineligible` for any 40000-level course); `active` = `yes`;
   `rules_effective_term` = the first term the course may be counted (for example `Fall 2026`);
   `dgs_reviewed` = `yes`; a short `notes` citing the §.
4. Log it (A6) and verify (A7).

### A3. Change how an existing course counts

Rules change from a term onward, and students who took the course earlier keep the old rule. So:

1. **Do not edit the old row.** Copy it and paste the copy directly below.
2. In the copy, **first** set `rules_effective_term` to the first term the new rule applies; only
   then change the policy columns. Until the copy has its own term, the app sees two rows for the
   same course and term, uses the copy (the last row wins) for every student, and both web pages
   show a warning naming the two rows — so do not delete either row because of that warning while
   you are still editing the copy.
3. The app picks, for each course a student took, the newest row whose `rules_effective_term` is not
   after the term the student took it. If every row is later than the student's term, the oldest
   row applies.

Exception: a plain mistake (a typo, a tag that was never right) is fixed in place — the wrong
value was never policy.

### A4. Retire a course

Set `active` to `no`. Never delete rows — students who took the course years ago must still be
recognized.

### A5. Change a number from the handbook

1. Open the **Parameters** tab and find the key (for example `phd_regular_credits_min`).
2. Change `value`; update `handbook_section` to the § that states the new number.
3. Keep the key names exactly as they are — the app reads them by name. A missing or blank key
   makes its requirement show "cannot evaluate", never a silent pass.
4. **Caution:** a Parameters change applies to **every student immediately**; there is no
   per-cohort grandfathering. If a new number must apply only to new students, that is a code
   change — Track B.
5. The Parameters tab holds the **department's** numbers only. If the number you want to change
   is not there, it is probably the Graduate School's — see A5b.
6. The result cards' titles follow the value ("At least 24 credits of regular courses …" becomes
   "At least 27 …"), since 2026-10-12. The handbook sentence quoted under each card's Relevant
   Policies does not: it is the handbook's own words, and changes when the handbook PDF does.

### A5b. Numbers the sheet does not hold

The sheet governs only what can be controlled and adjusted **at the department level**. Numbers
set at a higher level — the Graduate School's Academic Code and its DGS Handbook — are kept in
the code, each beside the sentence it comes from, and are deliberately **not** Parameters rows:
a DGS cannot change them, and a sheet row would suggest otherwise (DGS rulings 2026-09-27 and
2026-10-04). To change one — when the Graduate School revises its rules — use
**[Track B — Changing the app with Claude Code or Codex](#track-b--changing-the-app-with-claude-code-or-codex)**.

| Number | Where it comes from | Where it lives in the code |
|---|---|---|
| Admission to doctoral candidacy by the end of the **8th** semester | DGS Handbook §3.22.3; Academic Code §5.7.3 | `ADMISSION_DEADLINE_SEMESTER`, `src/engine/requirements/phd.ts` |
| **4** consecutive full-time semesters before admission to candidacy | DGS Handbook §3.22.3 | `ADMISSION_FULL_TIME_SEMESTERS`, `src/engine/requirements/phd.ts` |
| At most **15** credits of graduate courses in a fall or spring, **10** in a summer | Academic Code §3.8; DGS Handbook §3.9 | `SEMESTER_GRADUATE_CREDITS_MAX`, `SUMMER_CREDITS_MAX`, `src/engine/allocate.ts` |
| At least **3** graduate-level credits in a full-time semester | Academic Code §4.1 | `GRADUATE_LEVEL_CREDITS_MIN`, `src/engine/requirements/residency.ts` |
| At most **12** credits earned in non-degree status | Academic Code §2.3 | `NON_DEGREE_CREDITS_MAX`, `src/engine/allocate.ts` |
| At most **9** credits shared with another degree the student is enrolled in at the same time | Academic Code §2.2; DGS Handbook §2.9 | `DUAL_DEGREE_SHARED_CREDITS_MAX`, `src/engine/allocate.ts` |
| An Incomplete becomes an F **30 + 14** days after grades are due | Academic Code §4.4 | `INCOMPLETE_GRACE_DAYS`, `src/engine/allocate.ts` |
| A grade of **C** or better for credit | Academic Code §4.3 | `passesCreditFloor`, `src/engine/grades.ts` |
| At most **6** credits shared with a bachelor's degree — §3.5's allowance, and the Ph.D.'s six counted toward two degrees (the `ms_bs_double_count_credits_max` row until 2026-10-07; a sheet that still has it is told it can be deleted) | Academic Code §4.6 | `BS_SHARED_CREDITS_MAX`, `src/engine/allocate.ts` |
| Quarter credit hours × **0.66**, trimester credit hours × **0.88** (§5.2's pro-rata conversion) | DGS Handbook §3.14 | `QUARTER_CREDIT_FACTOR`, `TRIMESTER_CREDIT_FACTOR`, `src/data/external.ts` |
| One more year and a 9th semester for students enrolled in **Spring 2020** or earlier | Academic Code Appendix A | `COVID_COHORT_LAST_ENTRY`, `src/engine/requirements/context.ts` |
| Credit from before an interruption of **five years** or more is forfeited — counted from the end of the last Notre Dame term to the start of the readmission term (2026-10-05) | Academic Code §5.5 | `ACADEMIC_CODE_FORFEIT_YEARS`, `src/engine/allocate.ts` (readmission) |
| Probation: a cumulative GPA below **3.0** in any two semesters, or a **U** in research in two consecutive semesters; dismissal grounds: a semester GPA below **2.5**, below **3.0** in two consecutive semesters, or **three** consecutive U grades in research | Academic Code §5.7.3, §5.8 | `PROBATION_CUMULATIVE_GPA`, `DISMISSAL_TERM_GPA`, `DISMISSAL_TWO_TERMS_GPA`, `PROBATION_RESEARCH_U`, `DISMISSAL_RESEARCH_U`, `src/engine/audit.ts` |
| The master's examination by the end of the term after the coursework; after a fail, **one** retake by the end of the following semester | Academic Code §6.1.5 | `src/engine/requirements/mscse.ts` (optionRows) |
| Dissertation completion status: up to **two semesters** after the eighth year (Academic Code), **one year**, renewable **once** (DGS Handbook) — an extension the student enters is noted beyond one year and sent to the DGS beyond two | Academic Code §6.2.6.1; DGS Handbook §3.19 | `extensionNotes`, `extensionReviewFlag`, `src/engine/requirements/context.ts` |
| **Seven** years for a master's student attending summer session only (the app routes a record whose every Notre Dame term is a summer session to the ADGS) | Academic Code §6.1.4; DGS Handbook §3.19, §3.21.1 | `SUMMER_ONLY_MS_TIME_LIMIT_YEARS`, `src/engine/requirements/mscse.ts` |
| Tuition scholarships through the **8th** year (doctoral) and the **5th** year (master's) — a note on the time-limit row | DGS Handbook §4.2.6 | `TUITION_SCHOLARSHIP_LAST_YEAR`, `src/engine/requirements/context.ts` |

(The two credit factors were Parameters rows from 2026-09-12 until the DGS moved them into the code
on 2026-10-04; both rows were deleted from the live sheet the same day, and a sheet that has a
`quarter_credit_factor` or `trimester_credit_factor` row again is told in the diagnostics that the row is
no longer read and can be deleted.)

The department's own numbers — the CSE handbook's credit totals, caps, deadlines, the qualifier,
the GPA minimum, the full-time credit floor — stay in the **Parameters** tab (A5). When a CSE
handbook number and a Graduate School number say the same thing **and the code holds the
Graduate School's** (the four semesters of §4.3's residency, the eighth semester of §4.5's exam),
the sheet row is the department's and the code constant is the Graduate School's: changing the
sheet changes only the department's rule.

Some rows are different: they carry the Graduate School's limit **themselves**, with no constant
in the code behind them — `ms_time_limit_years` (5 years, Academic Code §6.1.4),
`ms_total_credits_min` (30, §6.1.1), `gpa_min` (3.0, §4.5), `fulltime_credits_min` (9, §3.3),
`summer_fulltime_credits_min` (6, DGS Handbook §10.3.2 — a sheet row by the DGS's choice,
2026-10-04), `phd_time_limit_years` (8, §6.2.6); and since 2026-10-11 the transfer caps
`transfer_unfinished_ms_credits_max` (6), `ms_transfer_completed_ms_credits_max` (9) and
`phd_transfer_completed_ms_credits_max` (24), the windows `ms_transfer_window_years` and
`phd_transfer_window_years` (5) and `transfer_min_grade` (B), all §4.6, and the allowances below
60000, `ms_4xxxx_credits_max` and `phd_4xxxx_cse_credits_max` (6, §4.1). The Academic Code calls its
figures "minimum standards": a program may set higher ones, never lower. So these rows may be
**tightened, never loosened**: a stricter value is followed; a looser one is warned about in the
sheet diagnostics and the app uses the Graduate School's value instead (2026-10-07, 2026-10-11).
`phd_total_credits_min` (60) is warned about below sixty, and the app holds 60 for a student
without an earlier master's — §6.2.1 allows "30 credit hours beyond a previously awarded master's
degree", so a lower row stands for one with it.

### A6. Log the change and date it

Add a row to the **Changelog** tab: date, your name, what changed, why (handbook §, faculty
decision, correction). The next DGS will thank you. Both pages date the rules automatically, so
nothing else is needed: a GitHub Action checks the published sheet every six hours, and when its
content has changed it records the date, saves the new copy in the repository, and redeploys —
within a few hours of your edit the pages say "The course rules here were last updated on <date
of your edit>, and are up-to-date as of <the day the student opened the page>" (until then the
first half says "were updated after <previous date>"). Only if the rules should carry a different
date than the last edit (a change decided today that takes effect next term, say) add a
**Parameters** row `rules_effective_date` with that date (`2026-09-01` format); the first half
then reads "are effective as of <date>" instead — and keeps doing so until you remove the row.

### A6b. A student asks about a course from another university

Students import prior coursework (Previous Undergraduate / Master's / Ph.D. transcripts) and the app
checks them against the **ExternalCourses** tab. When a student emails you a
review request (the app writes ONE request covering their Notre Dame and
external courses together), the email names the student (a line they fill in
with their name, netID and NDID), their Notre Dame programs and entry terms in
the subject, their prior-graduate-study choice (§5.2 caps), notes that their
transcript PDFs are attached, and opens with a numbered **Action requested**
list in two parts (since 2026-09-28): **A** — rows to enter or complete in the
sheet, which need no reply because the page reads the sheet on its next visit;
**B** — decisions for that student (`dgs_approval` courses, §5.2
recommendations), which do need a reply. Everything
below its "(DO NOT MODIFY ANYTHING BELOW THIS LINE)" divider is
machine-readable — one tab-separated table per sheet tab, plus course details
grouped per transcript. Paste the ExternalCourses table straight into that tab
at a new row's `university` cell — and leave that name exactly as pasted: it is
what the import read from the official transcript, and the next student's
transcript from that school must match it, so it is never retyped or tidied
(DGS 2026-10-07) — then fill in your rulings: which core area each
satisfies (`satisfies_core_area`, if any), whether its credits can transfer
(`transferable` — `yes` for a course any student may transfer, `no` for one that
never transfers, `dgs_approval` for one you want to decide student by student,
which keeps it in their review request as an open decision; you and the
advisor settle whether it serves their research, and the page does not ask
them to argue it), and — only where one fixed number is right every time — the
ND-equivalent `nd_credits` (§5.2 pro-rata). A university on quarters or
trimesters is set ONCE in the **Universities** tab (since 2026-10-10): one row,
the name exactly as in ExternalCourses, `credit_system` = `quarter`,
`trimester` or `semester`; every course from it then converts from what the
student's transcript prints. When the request includes a university the sheet
gives no system for, list A asks for it: a paste-ready Universities row
(prefilled when the student's record carries quarter or trimester hours), or,
if the university is listed with a blank system, completing that row. The student's page
updates within minutes; anything without a row honestly shows "not yet reviewed
by the DGS". Bachelor's-level courses can satisfy core knowledge (§4.4.1) but
never transfer credit (§5.2). Schema and one-time setup: `data/README.md`.

### A6c. A student asks about a Notre Dame course the sheet hasn't decided

Notre Dame courses that are not in the **Courses** tab (typically non-CSE), are
marked `dgs_approval`, or have blank verdicts show "needs DGS review", and the
"Ask the DGS to review" card writes ONE review request for the student —
covering their Notre Dame and external courses together — which they must
email to you (since 2026-09-06 the review goes to you alone: you decide eligibility; what has
been decided is then processed by the Grad Admin through the separate processing request the
page also writes). For courses that are not
in the sheet at all, the email contains paste-ready rows (`course_id`,
`title`) — paste them into the **Courses** tab at a new row's `course_id`
cell, fill in the remaining columns, and the student's page updates within
minutes. For `dgs_approval` courses your decision is by email; the student
then ticks the matching box under "Approvals you already have".

### A6d. A student says the page showed something wrong

Every result names what it was checked with — the last line of both pages' footers, of a
printout's header and of every email the page writes (since 2026-10-11):

> Checked with: course rules 3f9a2c1b (read live, last updated on October 9, 2026) · CSE Graduate
> Studies Handbook (Updated September 2026) · app version fe64bda of October 11, 2026.

`3f9a2c1b` names the exact content of the rules sheet the student's page read; `fe64bda` names
the code. Students can also report from the page itself: every result card's “Relevant Policies”
ends with “Does this look wrong? Tell the DGS”, and each transcript preview with “Did the reader
get this transcript wrong?” — both open the student's email app addressed to you, with that line
filled in. Record each report in `docs/ACCURACY-LOG.md` (no names). Ask the student for their saved file ("Save to a file" — it holds the same line, the
date it was checked and how every row read). With a working copy of the repository (Track B1),
re-run it:

```
npm run reproduce -- ~/Downloads/cse-degree-audit-phd.json
```

It finds the saved copy of the sheet with that fingerprint, re-runs the check on the date the
student saved, prints every row and lists any row that now reads differently. A row that differs
was changed by an edit to the code since then (the output says how to re-run with the student's
exact version); a row that reads the same but is wrong is a bug to fix — add the case as a
scenario (Track B). The file is the student's record: keep it on your own Mac, never in the
repository.

### A7. Verify in the app (five minutes later)

1. Wait about five minutes for Google to republish, then open the live app and reload it.
2. Expand **"Rules-sheet diagnostics"** at the bottom of the input column. Every sheet problem is
   listed there in plain English with its row number. Your rows should not appear; if one does, the
   message says which column and why (usually a value outside the dropdown set).
3. Type the course you added into the course table (it autocompletes
   when `active` = `yes`), and read the report as a student would. Open `courses.html` too — the
   public course-rules list should show your row with the right core area, category, and
   Confirmed/Pending mark.
4. If the page cannot load the rules, a card explains why and suggests reloading; a visitor can
   also choose to continue with the app's saved copy (a banner then says so). If the card says
   the spreadsheet is not published, check in the sheet that **File → Share → Publish to web**
   is still on for the four tabs. If the sheet was replaced by a new file, see A9.

Nothing you enter in the app is stored anywhere but that browser.

### A8. Things never to do in the sheet

- Do not rename tabs, column headers, or Parameters keys; do not delete rows; do not unpublish.
- Do not type a value that is not in the dropdown.
- Do not put anything about individual students in the sheet — it is public by design.
- Do not "fix" the app by making a second sheet; the app knows only this one.

### A9. If the sheet is ever re-created, replaced, or its publishing is reset

The published-CSV links change, and the links in `data/sheet-urls.json` in this repository
must be updated — the published-CSV ones the app reads and `sheet_edit_url`, the spreadsheet's
own link shown on both pages as "accessible by faculty only" (so keep the new sheet shared with
faculty) — that is a ten-minute Track B job (recipe in B4). Until then the app tells
visitors the sheet has a problem and offers its last saved copy; it recovers by itself once the
links are fixed.

---

## Track B — Changing the app with Claude Code or Codex

This track is for a DGS who wants to change what the app *does*: a new or changed requirement
after a handbook revision, new UI text, a transcript-format change, a re-published sheet, or a bug
a student found. You do not need to write code yourself: an AI coding agent does the coding, the
repository teaches it this project's rules, and the test suite plus GitHub Actions keep it honest.
Your job is to describe the change, answer policy questions, review, and approve.

Two agents are supported and the workflow is identical: **Claude Code** (Anthropic) reads
`CLAUDE.md` automatically; **Codex** (OpenAI, part of ChatGPT) reads `AGENTS.md`, which points to
the same instructions.

### B0. What you need

1. **A GitHub account with access to this repository.** Ask the previous DGS to add you under
   *Settings → Collaborators* with the **Admin** role, or to transfer the repository to you
   (*Settings → General → Transfer ownership*; note this changes the live URL — see the handoff
   checklist).
2. **A computer with Git and Node.js 24 or newer.** Install Node.js from https://nodejs.org (the
   LTS installer includes `npm`); `git` comes with Xcode command-line tools on macOS or from
   https://git-scm.com. Check with `node --version` and `git --version` in a terminal.
3. **An AI coding agent account**, one of:
   - **Claude Code** — a paid Claude plan or Anthropic API key. Install:
     `npm install -g @anthropic-ai/claude-code` (docs: https://docs.claude.com/en/docs/claude-code).
   - **Codex** — a ChatGPT plan that includes Codex, or an OpenAI API key. Install the CLI:
     `npm install -g @openai/codex` (docs: https://developers.openai.com/codex).
   Both also run inside VS Code and as desktop apps; the prompts below are the same there.
4. About an hour the first time; fifteen minutes for a typical change afterwards.

### B1. One-time: get a working copy that runs

Open a terminal and run, one line at a time:

```bash
cd ~/Documents            # any folder that is NOT inside Google Drive / OneDrive / Dropbox sync
                          # and has no ":" (colon) anywhere in its path — both break the tooling
git clone https://github.com/tjungND/ND-CSE-Degree-Requirement-Progress-Simulation.git
cd ND-CSE-Degree-Requirement-Progress-Simulation
npm install               # installs the packages the app needs (about a minute)
npm test                  # expect: every test passes — the summary ends with "fail 0"
npm run dev               # local copy of the app at http://localhost:5173 — Ctrl+C to stop
```

If `npm test` fails on a fresh clone, the usual cause is an old Node.js (`node --version` must
be 24 or newer). If the dev server shows the "rules last synced" banner, your network blocked the
Google fetch; that is fine for development.

### B2. Start your agent inside the repository folder

**Claude Code**

```bash
cd ND-CSE-Degree-Requirement-Progress-Simulation
claude                    # first run: log in with your Claude account in the browser window it opens
```

Claude Code reads `CLAUDE.md` on its own. Press **Shift+Tab** twice to enter *plan mode*, which
makes it propose a plan before touching files — use it for every non-trivial change.

**Codex**

```bash
cd ND-CSE-Degree-Requirement-Progress-Simulation
codex                     # first run: choose "Sign in with ChatGPT"
```

Codex reads `AGENTS.md` on its own. Start every session with:
*"Read AGENTS.md and every file it points to before doing anything, then tell me you are ready."*
Approve the commands it proposes (`npm test`, `npm run build`, …) when it asks.

### B3. The change loop — one change at a time

1. **Start from the latest code:** in the terminal, `git pull`.
2. **Describe the change in plain English, cite the handbook, and ask for a plan first.** For
   example:

   > The July 2027 handbook changed §4.4.2: students now need four category courses instead of
   > three, and "Human Centered Computing" was renamed "Human-Computer Interaction". Plan the
   > change before writing any code. Tell me which parts are sheet edits (Parameters/Categories)
   > and which are code, list every policy question you cannot decide from the handbook, and do
   > not resolve those yourself.

3. **Read the plan and answer its questions.** The agent must ask about anything the handbook
   leaves ambiguous rather than guess. Your answers *are* the policy: tell it to record each one
   in `docs/DECISIONS.md` (date, question, decision, who). Read `docs/DECISIONS.md` yourself before
   overruling an earlier interpretation — that file is the memory of every judgment call made.
4. **Let it implement.** The repository's rules (in `CLAUDE.md`) require it to: quote the handbook
   sentence and § above every requirement it touches; add or update a scenario in
   `tests/scenarios/` for the case; keep `npm test` and `npm run build` green; run `npm run e2e`
   and look at the screenshots in `.e2e-out/` for anything visible. If it skips one of these, ask
   for it.
5. **Check it yourself.** Run `npm run dev`, open http://localhost:5173, enter a record (type a
   few courses, or **Load a file** you saved earlier) and read the report as a student would; exercise the case you changed. A wrong verdict is far
   easier to spot in the rendered report than in code.
6. **Commit and push.** Either tell the agent *"commit with a message that explains why, then
   push"*, or do it yourself:

   ```bash
   git add -A
   git commit -m "§4.4.2: four category courses required from Fall 2027 (DGS decision 2027-08-01)"
   git push
   ```

7. **Watch it go live.** On GitHub, open the **Actions** tab: `test` and `deploy` should turn
   green within a few minutes, and the live page updates automatically. Reload the live app and
   repeat step 5 there.
8. **Tell the sheet side of the story.** If the change added a Parameters key or a Categories
   row, paste it into the sheet now (the agent tells you the exact row); until you do, the new
   requirement honestly shows "cannot evaluate".

### B4. Prompts for the asks you will actually get

- **New handbook year.** Replace `policy-sources/CSE-Graduate-Handbook-live.pdf` with the new
  edition (git keeps the old one) and say so. Then run `npm run handbook-text` (it copies the new
  edition's text into the hover text of the "CSE §" chips; the tests fail until you do). Then: *"Diff §2.3, §3, §4 and §5.2 of
  policy-sources/CSE-Graduate-Handbook-live.pdf against the previous edition in git history
  (git show HEAD~1:policy-sources/CSE-Graduate-Handbook-live.pdf). List every rule that changed. Propose Parameters/Courses/Categories edits for
  the numbers and lists, and code changes only for changed structure."* Nothing in
  `src/ui/handbook.ts` changes for a new edition: the link is the DGS's permanent Google Drive
  file (upload the new PDF as a new version of that file) and the title names no edition
  (2026-09-30).
- **"Course X should count for Y."** That is a sheet edit (Track A), not code. Any agent that
  proposes to hard-code a course number is wrong; say so.
- **A student reports a wrong verdict.** *"Here is the student's situation: … The correct verdict
  per §… is …. Add a scenario JSON in tests/scenarios/ that reproduces it, then fix the engine
  until it passes. If this is a policy ambiguity rather than a bug, stop and ask me first."* Keep
  the scenario forever.
- **Add a checkable requirement.** *"Implement the new §… requirement: quote the sentence, add it
  to the requirement registry, wire its number through a Parameters key, add a scenario, and tell
  me the exact Parameters row to paste into the sheet."*
- **Transcript upload stopped recognizing courses.** Get one fresh unofficial transcript PDF from a
  volunteer student. *"The Registrar changed the transcript layout; here is a fresh sample.
  Update src/transcript/parse.ts and its tests so this file parses, without breaking the existing
  fixtures. Do not commit the sample."*
- **The sheet was re-published or replaced.** In the sheet, *File → Share → Publish to web →
  Link*, pick Courses, Parameters, Categories, ExternalCourses, Universities in turn as *Comma-separated values*, copy the five
  URLs. Then: *"Replace the five URLs in data/sheet-urls.json with these, run npm run
  sync-sheet, and confirm the diagnostics are clean."*
- **A number should apply only to new students.** *"Parameters have no rules_effective_term. Plan how
  to grandfather `<key>` by entry term, mirroring the Courses-row versioning, and tell me the
  sheet-schema change before implementing."* This one is nontrivial — expect a real discussion.
- **Wording on the page.** *"Change the footer text to … . UI change only; run npm run e2e and
  show me the screenshot."*

### B5. What you are checking for as the reviewer

- The three properties above still hold — no new network calls, no analytics, no data leaving the
  browser, no hard-coded course numbers or thresholds, no silent defaults.
- Every new interpretation is in `docs/DECISIONS.md`, and none of the existing rows were changed
  without your say-so.
- The agent did not change the **sheet schema** (column names, allowed values, key names) without
  asking. A schema change is a contract with the humans editing the sheet and must be made in the
  sheet, `data/README.md`, `MAINTENANCE.md`, the sample CSVs and the test fixtures together.
- `npm test` and `npm run build` pass; for anything visible, you looked at the `.e2e-out/`
  screenshots.

### B6. If a deploy goes wrong

Undo the last commit and push; GitHub Pages redeploys the previous version in a few minutes:

```bash
git revert HEAD
git push
```

Or tell the agent: *"Revert the last commit and push; then explain what went wrong."* The
`sync-sheet` Action never changes code, only `data/snapshot.json`.

### B7. Without an agent

Everything above also works by hand: the code is plain TypeScript with a comment quoting the
handbook above each rule, `npm test` runs the scenarios, and `MAINTENANCE.md` plus
`docs/CLAUDE-HANDOFF.md` explain every design decision. Any student developer or IT colleague can
follow them.

---

## The yearly routine (both tracks)

1. **New handbook.** Numbers → **Parameters** tab (Track A). New or retired courses → **Courses**
   tab (Track A). Changed *structure* of a requirement → Track B, recipe "New handbook year".
   **New Academic Code or DGS Handbook** from the Graduate School → Track B: its numbers live in
   the code ([A5b](#a5b-numbers-the-sheet-does-not-hold)), not in the sheet.
2. **Let the app check your work.** Open the app → **Rules-sheet diagnostics** (A7).
3. **Log it** on the sheet's Changelog tab.
4. Nothing else — the app picks the sheet up automatically.

## Embedding these pages in a WordPress page

Both pages can be dropped into a page on ND's WordPress (`sites.nd.edu`, and any other
`nd.edu` site) so the course rules appear *inside* a departmental page instead of as a link
away from it. Nothing is copied: the embedded page is the live page, still generated from the
rules sheet, so a Track A edit reaches it within five minutes like everywhere else.

Night mode (2026-10-04): both pages have an Auto · Light · Dark switch at the top, and Auto
follows the reader's device. Inside a WordPress frame, Auto stays light to match the host page.
A reader who picks Dark there still gets the dark page.

**Never paste the app's HTML into a WordPress page.** It would freeze at the day you pasted it.

### E1. The one thing to know about ND's WordPress

A site Administrator on ND's multisite does **not** have the `unfiltered_html` permission, so
WordPress strips `<iframe>`, `<script>` and `<style>` out of page content when you save. Tested
on `sites.nd.edu`, 2026-09-16. That is why the page uses a **shortcode**, and why the resizing
script goes in a plugin field rather than on the page. Do not ask ND to grant `unfiltered_html`
— it is a security setting for the whole multisite, not for one page.

### E2. Put the course rules on a page (2 minutes)

Add a **Shortcode block** containing exactly this — the `?embed=1` is what matters:

```
[iframe src="https://tjungnd.github.io/ND-CSE-Degree-Requirement-Progress-Simulation/courses.html?embed=1" width="100%" height="1200" scrolling="yes"]
```

This needs the **`iframe` plugin by webvitaly**, which is already active on `sites.nd.edu`.

`?embed=1` tells the page it is a guest: it drops its own ND masthead and page title (your
WordPress page already has both), moves "Who to contact" to the bottom, removes its outer
margins, and adds an "Open the full course-rules page ↗" link that escapes the frame. Without
the parameter you get the whole standalone page inside your page, ND header and all.

Stop here if you like — this already works. The `height="1200"` is a guess, so you get one
inner scrollbar. E3 removes it.

### E3. Make the frame size itself (5 minutes, optional but recommended)

1. Activate the **"Head, Footer and Post Injections"** plugin (Plugins → Installed Plugins).
2. Go to **Settings → Header and Footer**, find the field **"Before the closing `</body>`
   tag"**, and paste the whole contents of
   [`docs/wordpress-footer-snippet.html`](docs/wordpress-footer-snippet.html) into it. Leave the
   field's **Mobile** checkbox unticked — ticking it means "use *separate* code on phones", and
   the main field would then stop applying to them; the snippet is the same for every device.
   Save.
3. Change the shortcode's `scrolling="yes"` to `scrolling="no"`.

The embedded page now reports its own height as it changes — when the rules finish loading,
and every time a reader filters the table — and the snippet grows and shrinks the frame to
match. No inner scrollbar, no trailing white space. It also makes the page's own "jump to
CSE 60641" links work, by scrolling *your* page instead.

The snippet ignores any message that does not come from
`https://tjungnd.github.io` and from the frame that sent it, so no other site can resize or
scroll your page. **If the repository is ever transferred to another GitHub account** (handoff
checklist, step 2) the page's address changes, and `APP_ORIGIN` at the top of the snippet must
change with it — otherwise the frame silently stops resizing.

### E4. On phones

At a phone width the course table becomes one card per course, so the embedded page is very
long — around 50 000 px for 117 courses — and it becomes part of your page's scroll. If that
bothers you, hide the frame on small screens and show a link instead. This is CSS only, which
*is* allowed on the page: **Appearance → Customize → Additional CSS**:

```css
@media (max-width: 700px) {
  .iframe-class { display: none; }
  .course-rules-link { display: block; }
}
@media (min-width: 701px) { .course-rules-link { display: none; } }
```

`.iframe-class` is the class the `iframe` plugin puts on every frame it makes; add a paragraph
with the CSS class `course-rules-link` holding an ordinary link to the page.

### E5. The self-check tool

The same `?embed=1` works on the self-check tool, but it is embedded differently — **keep a
fixed height and `scrolling="yes"`**:

```
[iframe src="https://tjungnd.github.io/ND-CSE-Degree-Requirement-Progress-Simulation/?embed=1" width="100%" height="1400" scrolling="yes" allow="clipboard-write"]
```

Since 2026-09-16 it resizes its frame just like the course-rules page (add it to the E3
snippet's control the same way), so there is no inner scrollbar: the opening notice appears at
the top of the frame, pop-up messages appear beside whatever the student just clicked, and the
floating score bar is not shown.

`allow="clipboard-write"` is what lets the tool's copy buttons write to the clipboard from
inside a frame: without it Chrome blocks the modern clipboard for a cross-origin frame and the
tool falls back to a plain-text copy (the formatted tables are lost) or, failing that, asks the
student to copy by hand (2026-09-16). If the iframe plugin drops the attribute, the fallbacks
still work.

One caveat worth knowing before you link students to an embedded copy: a page inside a frame
saves into the *frame's* storage, and Safari blocks that storage for embedded pages entirely.
A student's entries may not come back. The embedded tool says so at the top and points at
"Save my progress to a file" and at the full page — but linking students straight to the full
page is the kinder option.

### E6. The two WordPress pages link to each other (nothing to do, unless a page moves)

Each page links to the other ("See the course rules page", "The degree self-check tool applies
these same rules…", the report's "See the courses …" links). In `?embed=1` mode those links
leave the frame and go to the ND page that frames the sibling, in the top window — by default
the two pages on sites.nd.edu (`DEFAULT_HOST_PAGES` in `src/ui/sibling-links.ts`, DGS
2026-09-30): `…/csedept/courses-and-rules/` and `…/csedept/degree-requirement-self-checking/`.
If a page moves, either update that map (Track B) or name the new page in the shortcode's
`src`, which wins over the default:

```
[iframe src="…/index.html?embed=1&course_rules_url=https://sites.nd.edu/csedept/<new-course-rules-page>/" …]
[iframe src="…/courses.html?embed=1&self_check_url=https://sites.nd.edu/csedept/<new-self-check-page>/" …]
```

Only `https` URLs on an nd.edu host are accepted; anything else in the query string is ignored
(2026-09-16, tightened 2026-09-18). One limit: a WordPress page cannot pass a query string or
anchor into its frame, so a cross-link lands at the top of the ND page — the report's "See the
courses for this area" link, which filters the course list on the full page, cannot filter it
there.

## Simulation mode — what a student sees when planning ahead (DGS 2026-10-09)

"Simulate a future semester" (in the tools row at the top, and at the foot of the Coursework
card) puts the page into **simulation mode**: a navy banner first on the page says which
semester it is pretending to be in, a picker changes that semester (the current one up to ten
years ahead, summers included; it starts at the next fall or spring), and the student adds the
courses and milestone dates they expect — the report then shows how they would stand then.
"Exit simulation mode" (the banner, the tools row, and the strip pinned to the top on a wide
screen) asks first, says what would be discarded, and brings the real record back untouched.

What the mode cannot do, on purpose: nothing done in it ever reaches the real record (the
simulation is a separate copy in the browser's storage, and the real record is never written
while the mode is on); transcripts are imported outside the mode; the review request, the Grad
Admin request and the advisor summary cannot be sent from it. The student can still print, and
can **save the plan to a file**: `cse-degree-audit-<program>-simulation-<SP28>.json`, whose
first line is a note (`"SIMULATION of Spring 2028 — a planning copy, not this student's
record"`), then `simulation.term`, `savedAt` and the planning copy under `student`. Loading that
file later reopens it in simulation mode with that semester, leaving the real record alone; an
**older build** of the app, which does not know the two extra keys, would load it as an ordinary
record — so a student who opened a plan on an old copy of the page should check the first line
of the file before trusting what they see. Reloading the page keeps the mode on (a toast says so).

A saved plan cannot be loaded while a transcript preview is still open on the page: the page
asks for the preview to be added to the record or cancelled first (the preview's rows belong to the
record, not to a plan). Inside the mode, "Load a file" loads any file — a saved record or a saved plan — into the
simulation, never into the real record (a plan brings its own semester with it; a record keeps the
semester the page is in), and the toast says which happened. The buttons that would send something
(the review request, the processing request, the advisor summary), the four
transcript imports and the OCR opt-in are greyed, and say why on hover or click (a transcript is
real data — it is imported outside the mode); the two request cards still list what the plan
would put before the DGS and the Grad Admin, and the Next steps list says so in one line instead
of "Send …". A "Simulation" chip sits after the program name, beside the report's headline (on a phone, beside
the score summary at the top of the page — the headline a phone shows) and on both request cards,
so the mode stays in view on a phone too. A printed plan opens with
"SIMULATION — not your real record", the real date it was printed on and the semester it pretends
to be in. If a stored plan ever fails to show (a page that cannot draw it), the page offers to
discard the simulation alone and show the record — the record is never cleared to recover from a
plan.

A planned Notre Dame course carries a **Schedule** line when the Courses tab says it may not run
then (since 2026-10-11): retired (`active` = no), last offered more than two academic years ago
(`last_offered`), explicitly not on next semester's schedule (`offered_next` = no, dated as the
course-rules page dates it), or outside its usual season (`typically_offered` fall / spring /
both). These are the sheet's own facts, so keep those columns current; a blank cell says nothing,
and no note changes a requirement.

## Where things live

`src/engine/` — rule engine, one pure function per requirement with the handbook sentence quoted
above it · `src/data/` — sheet fetch, parse, validate · `src/ui/` — the pages (`app.ts` the
self-check tool, `courses-page.ts` the public course-rules list served as `courses.html`) · `src/transcript/` —
in-browser PDF parsing · `tests/scenarios/*.json` — one student case per file, the safety net ·
`data/sheet-urls.json` — the published-CSV links plus the sheet's own link shown on the pages (edit only if the sheet is re-published or replaced) ·
`data/README.md` — the sheet schema, column by column · `docs/DECISIONS.md` — every policy
interpretation ever made · `docs/CLAUDE-HANDOFF.md` — engineering decisions and recipes for AI
sessions · `MAINTENANCE.md` — deeper technical notes · `docs/STATE.md` — where things stand and the open items ·
`src/ui/handbook.ts` — handbook edition + PDF link · the six `contact_*` rows of the Parameters tab — who to contact (`src/ui/contacts.ts` is only the fallback) ·
`CLAUDE.md` / `AGENTS.md` — the instructions AI agents read. (The build-time starter kit —
`START-HERE.md`, `KICKOFF-PROMPT.md`, `reference/`, the seed spreadsheet and the Banner sweep — was
removed on 2026-09-14 and lives in git history only.)

Automation: every push to `main` runs the tests and redeploys GitHub Pages (`deploy` Action); every
push or pull request runs `test`; every six hours `sync-sheet` checks the sheet and, when its
content has changed, commits the new `data/snapshot.json` and redeploys — that commit is also how
the pages know when the rules were last updated (run it by hand from the Actions tab or with
`npm run sync-sheet`). GitHub pauses scheduled Actions after 60 days without repository activity
and emails you; re-enable it from the Actions tab.
One quirk: **never put a `:` (colon) in any folder name above the repository** — it breaks Node
tooling (details in `MAINTENANCE.md`).

## Handoff checklist

1. **Sheet:** done on 2026-09-21 — CSE-Degree-Checking-Rules lives in the shared drive **"CSE
   Department Adminstration: Graduate Programs"**, which owns it, so nothing to transfer. Two things
   to check instead: the next DGS is a **Manager** of that drive (a Manager can re-publish tabs; a
   Contributor cannot), and the **CSE Faculty** group keeps at least Viewer access, since both pages
   link the sheet as faculty-readable. If the sheet is ever moved again, confirm *File → Share →
   Publish to web* is still on for the four tabs — a move does not change any of the addresses in
   `data/sheet-urls.json`, but a drive whose sharing settings forbid publishing would break them.
2. **Repository:** add the next DGS as **Admin** (*Settings → Collaborators*), or transfer the
   repository (*Settings → General → Transfer ownership*). A transfer changes the live URL to
   `https://<new-owner>.github.io/ND-CSE-Degree-Requirement-Progress-Simulation/` — then re-enable
   *Settings → Pages → Source: GitHub Actions*, update the link or iframe on cse.nd.edu, and
   update the URL at the top of this file. If a WordPress page embeds the course rules, update
   the shortcode's address **and** `APP_ORIGIN` in the footer snippet (see
   [Embedding these pages in a WordPress page](#embedding-these-pages-in-a-wordpress-page)) —
   a stale origin makes the frame stop resizing without any visible error.
3. **Update the people on the page:** names and e-mail addresses of the DGS, Assistant DGS and
   Graduate Program Administrator are the six `contact_*` rows of the sheet's Parameters tab
   (`contact_dgs_name` … `contact_grad_admin_email`; the footer, the feedback notes and the
   error-report address all read from them) — Track A, no code. `src/ui/contacts.ts` is only the
   fallback used when a row is missing.
4. **Walk through one live edit together:** change a Parameters value, wait five minutes, watch the
   app pick it up, change it back, log both in the Changelog.
5. **Point them at this file.** Everything else follows from it.
6. Nothing else — student data was never yours to hand over.

## Status and open items

See `docs/STATE.md` for where things stand and the open items;
the app's **Rules-sheet diagnostics** panel is the live truth.

## License

Copyright © 2026 University of Notre Dame du Lac.

**ND CSE Degree Requirement Progress Simulation** is freely available without a fee for
non-commercial use (academic and research use), and may be redistributed under these conditions.
For commercial use, a non-exclusive commercial license is required, which carries a
non-refundable annual fee. For commercial use queries, please contact Notre Dame's IDEA Center at
softwarelicensing@nd.edu. Full terms: [`LICENSE.md`](LICENSE.md).
