# Rules data — the DGS-editable Google Sheet

Sheet: **CSE-Degree-Checking-Rules** (named CSE-Degree-Audit-Rules until 2026-09-05). Since
2026-09-21 it lives at the top level of the shared drive **"CSE Department Adminstration: Graduate
Programs"**, which owns it — there is no individual owner, so the sheet does not leave with the
DGS and access follows that drive’s membership; before that it sat in the DGS’s own "DGS things
(CSE)" folder in My Drive. The app reads it read-only at page load through Google's
"Publish to web" CSV links, and a GitHub Action snapshots it into `data/snapshot.json` every six
hours (committing only when the content changed) so the app still works if the sheet is ever
unpublished — and so the pages can say when the rules last changed.

## How the app reads the sheet
In the sheet: **File → Share → Publish to web → Link → choose one tab → Comma-separated values
(.csv)**. Do this once per tab. Each tab gets a URL of the form

    https://docs.google.com/spreadsheets/d/e/<PUBLISHED_ID>/pub?gid=<TAB_GID>&single=true&output=csv

The current URLs are in `data/sheet-urls.json` (Courses gid 922680330, Parameters gid 1921993253,
Categories gid 298683565); the app reads that file. The same file's `sheet_edit_url` is the
spreadsheet's ordinary (edit/view) link — since 2026-09-04 both pages show it in the masthead and
footer, labelled as accessible by faculty only (`src/ui/sheet-source.ts`), so if the sheet is ever
replaced, update that entry too. Note that Google serves these CSVs with the
numbers as plain integers (24, not 24.0) and blank cells as empty strings. Publishing makes the tab publicly readable by anyone
with the link — fine for course rules, which are already public policy. Nothing about students is
in the sheet.

Edits appear in the published CSV within about five minutes. Students see them on next page load.

## Tabs

### Tab `Courses` — one row per course the app knows about
Prefilled from the Banner sweep (`cse_courses.csv`, Aug 2026 — removed from the repo 2026-09-14, in git history): every CSE 4xxxx–9xxxx catalog
entry, latest version per course number (371 rows). Informational columns come from Banner;
policy columns are the DGS's.

| column | allowed values | meaning |
|---|---|---|
| `course_id` | e.g. `CSE 60641` | Department code, space, five digits. Primary key. |
| `title` | text | Shown in the autocomplete. |
| `level` | 4–9 | First digit of the number. **Not informational** — the app reads this cell in preference to the number itself, and it decides whether a course is refused outright (50000-level, unless the row permits it), whether it draws on §4.2's six-credit allowance for courses below the 60000 level, and whether a non-CSE course counts at all. A mistyped level silently changes the audit. |
| `credit_min`, `credit_max` | numbers | Banner credit range (informational). |
| `credits_default` | number or blank | What the app pre-fills; blank for variable-credit courses, the student enters the transcript value. |
| `course_type` | `regular` \| `seminar` \| `research` \| `independent` \| `project` | Only `regular` counts toward the 24 regular-course credits (§3.2, §4.2). Case and separators are forgiven (`Regular`, `Independent Study`), as in the verdict columns (2026-09-18). |
| `counts_toward_mscse` | `yes` \| `no` \| `dgs_approval` \| `adgs_approval` | The approval values name WHO signs off (2026-09-12): `adgs_approval` → the ADGS, `dgs_approval` → the DGS. Either way the app counts the course provisionally and tells the student to get that person's sign-off. Today MSCSE approvals are the ADGS's, but the cell — not the program — decides, so authority can move back course by course. |
| `counts_toward_phd` | `yes` \| `no` \| `dgs_approval` \| `adgs_approval` | same; today Ph.D. approvals are the DGS's. |
| `core_area` | `os` \| `algorithms` \| `architecture` \| blank | Which §4.4.1 core-knowledge area the course satisfies. |
| `category_group` | one or more of `alg` \| `hcc` \| `arch` \| `dsai` \| `sys`, or `ineligible` \| blank | Which §4.4.2 specialization group(s) the course belongs to. **Several are allowed** (2026-09-08): separate them with a semicolon — `hcc;dsai` means the course may fill EITHER group and the student picks which, so it can be worth a choice of two or three groups and not only one or all five. A course that belongs in EVERY group names all five (`alg, hcc, arch, dsai, sys`) — the old `any` shorthand was retired on 2026-09-18, and a cell that still says it is reported as a code the Categories tab does not define. `ineligible` = it can never satisfy §4.4.2; blank = not decided. Commas, slashes or spaces work as separators too, and the codes are case-insensitive. |
| `offered_now` | `yes` / `no` / blank | Is the course on the schedule THIS semester? Shown only while this row's `last_offered` names this semester — a course running now was last offered now (DGS, 2026-09-18). A row dated any other semester, or undated, shows nothing and is counted with its reason in the line under the cards (before 2026-09-18 a row dated LAST semester had its `offered_next` shifted onto this one, which could tag a spring-only course as a fall offering). The current semester comes from Notre Dame's date. The course-rules page shows it as a CARD at the top of the page, "Offered this semester — Fall 2026", listing those courses with their attributes, and as a filter on the table below. Blank means the sheet does not say — the course is simply not listed there, which is not a statement that it will not run. No column is added to the table; nothing outside that page reads it |
| `offered_next` | `yes` / `no` / blank | The same for the NEXT fall or spring. Since 2026-10-11 the self-check's simulation mode also reads an explicit `no` here, dated the same way: a course a student plans for next semester says “not on the Spring 2027 schedule in the course rules”. |
| `typically_offered` | `fall` \| `spring` \| `both` \| `varies` \| blank | Informational (planning hints). Any other value is reported and ignored, rather than printed verbatim in the column (2026-09-18). Since 2026-10-11 the self-check's simulation mode uses it as a hint: a course planned outside its usual season says “typically offered in fall; planned for Spring 2028” (`both` = fall and spring; `varies` and blank say nothing). It never changes a requirement. |
| `active` | `yes` \| `no` | `yes` → shown in the student's course picker. `no` → hidden from the picker but still recognised when typed (old courses); since 2026-10-11 a student who PLANS a retired course in simulation mode is told it is “retired in the course rules — ask the DGS whether it will run again”, and one whose `last_offered` is more than two academic years back is told when it last ran. Case does not matter (`No` is `no`, 2026-09-18). A retired course is NOT shown in the qualifying-examination cards or on the schedule cards (DGS, 2026-09-18): those list current courses. It stays in the table under “Include retired courses”, and the audit engine still counts it for a student who took it. A row that is retired AND marked as offered is reported. |
| `last_offered` | a term: `Fall 2026` or `FA26` | **The last term this course was actually offered** (DGS, 2026-09-18) — prefilled from Banner, and **not informational**: it dates this row's `offered_now` / `offered_next`, which are shown only while it names the current semester. Set it in the same edit as those two cells. A row whose schedule cells are filled while this one is blank or unreadable is reported in the diagnostics. |
| `rules_effective_term` | e.g. `Fall 2026` or `FA26` | First term this row's RULES apply (renamed from `effective_term` 2026-09-14; the old header is still read). First term this row applies. Keep old rows; add a new row with a later `rules_effective_term` when a rule changes. For each course a student took, the app applies the newest row whose `rules_effective_term` is not after that course's term; if every row is later than the course (e.g. everything says Fall 2026 and the course was taken in 2024), the **oldest row applies retroactively**, so old coursework still resolves. |
| `dgs_reviewed` | `yes` \| `no` | DGS's own checklist. Shown on the public course-rules page (`courses.html`) as Confirmed (`yes`) or Pending (anything else); the audit engine ignores it. |
| `notes` | text | The DGS's own working notes on a course. Not shown to students anywhere since 2026-09-09, and nothing in the app reads them. |

A blank `counts_toward_*` on an active course makes the app say "needs DGS review" for that
course. The earlier sheets ("CSE Course Catalog" and "CSE Degree Requirement Rules") are
superseded by the Google Sheet CSE-Degree-Checking-Rules (built from the seed spreadsheet `CSE-Degree-Audit-Rules.xlsx`, under its original name — removed from the repo 2026-09-14, in git history).
The `*.sample.csv` files here show this exact schema in miniature (they double as the base rules
for the test suite's fixtures in `tests/fixtures/rules/`).

### Tab `Parameters` — the department's numbers, so a future DGS can change them without code

The CSE handbook's numbers — the department's, which a DGS may tune. A number set above the
department (the Graduate School's Academic Code or DGS Handbook: the 15-credit semester maximum,
the eighth-semester admission to candidacy, …) is deliberately NOT a row here; it lives in the
code beside the sentence it comes from, and changing it is a Track B change (README § A5b lists
them; DGS 2026-09-27, 2026-10-04). Fifteen rows here carry a Graduate School limit themselves, with
no code constant behind them — `ms_time_limit_years`, `ms_total_credits_min`, `gpa_min`,
`fulltime_credits_min`, `summer_fulltime_credits_min`, `phd_time_limit_years`, and since 2026-10-11
the §4.6 transfer caps, windows and B (`transfer_unfinished_ms_credits_max`,
`ms_transfer_completed_ms_credits_max`, `phd_transfer_completed_ms_credits_max`,
`ms_transfer_window_years`, `phd_transfer_window_years`, `transfer_min_grade`) and §4.1's six
(`ms_4xxxx_credits_max`, `phd_4xxxx_cse_credits_max`): they may be tightened, never loosened: a
looser value is warned about in the diagnostics, and the app uses the Graduate School's value
instead (README § A5b; 2026-10-07, 2026-10-11). `phd_total_credits_min` is warned about below 60
and held at 60 for a student without an earlier master's (Academic Code §6.2.1). The quarter and trimester factors of §5.2's pro-rata conversion
(0.66 and 0.88, the DGS Handbook's §3.14 table) were rows here from 2026-09-12 and moved into the
code on 2026-10-04 (DGS). The six credits shared with a bachelor's degree (`ms_bs_double_count_credits_max`) moved into the code on 2026-10-07 (DGS; `BS_SHARED_CREDITS_MAX`). Three more rows were PARKED — kept in the tab, read by nothing:
`ms_thesis_readers_min` (§3.4's two readers; no reader count is checked, the thesis row checks the
defense), `candidacy_committee_additional_members_min` (§4.5's three voting members beyond the
advisor; the committee is not counted — DGS 2026-10-04) and `phd_senior_grad_credits_max` (6, the
allowance §3.5 once sized for a 4+1's junior/senior-year 6xxxx courses transferring into the Ph.D.;
withdrawn 2026-09-10 when the DGS took §5.2 to the Graduate School, whose answer made that coursework
count in full rather than as transfer credit). The DGS had all five rows deleted from the live sheet on
2026-10-04 ("remove any rows that are not needed any more"). A sheet that carries one again is told
the row is no longer read and why (`RETIRED_PARAMETER_KEYS`, `src/data/types.ts`); git history keeps
the old rows (`data/snapshot.json`).

| `key` | `value` | `handbook_section` | `notes` |
|---|---|---|---|
| `ms_regular_credits_min` | 24 | §3.2 | |
| `ms_project_credits_min` | 6 | §3.2 | CSE 68901 / 68902 |
| `ms_4xxxx_credits_max` | 6 | §3.2 | |
| `ms_noncse_credits_max` | 9 | §3.2 | |
| `ms_time_limit_years` | 5 | §3.3 | |
| `ms_transfer_window_years` | 5 | §5.2 | prior graduate coursework — §5.2's five-year window applies to the MSCSE too (DGS 2026-09-11) |
| `phd_regular_credits_min` | 24 | §4.2 | 60000-level or higher |
| `phd_total_credits_min` | 60 | §4.2 | "The graduate school requires a total of sixty (60) credits of courses and research for the Ph.D." |
| `phd_seminar_courses` | `CSE 63801, CSE 63802` | §4.2 | required in year one |
| `phd_4xxxx_cse_credits_max` | 6 | §4.2 | |
| `phd_noncse_6xxxx_credits_max` | 9 | §4.2 | |
| `phd_transfer_window_years` | 5 | §4.2 | prior M.S. coursework |
| `phd_residency_semesters` | 4 | §4.3 | consecutive, full-time, excluding summer |
| `phd_time_limit_years` | 8 | §4.3 | |
| `qualifier_deadline_semesters` | 4 | §4.4 | DGS may extend |
| `category_courses_required` | 3 | §4.4.2 | |
| `category_distinct_groups_required` | 3 | §4.4.2 | |
| `category_min_grade` | `B` | §4.4.2 | |
| `research_qualifier_deadline_months` | 18 | §4.4.3 | |
| `candidacy_deadline_semester` | 8 | §4.5 | before the end of the eighth semester |
| `gpa_min` | 3.0 | §2.2 | |
| `ms_total_credits_min` | 30 | §3.2 | |
| `phd_nd_credits_min` | 9 | §4.2 | at least nine credits of regular courses at Notre Dame |
| `cse_subject_codes` | `CS; CSCI; COMPSCI; CSE; CMSC; EECS; CSYE; ECE` | §3.2, §4.2 | the subject codes that mean a CSE course on **another university's** transcript. §4.2 (and §3.2 for the MSCSE) caps credits from outside CSE at nine wherever they were taken, and other schools spell the department every way there is. `ECE` is listed on purpose: the department reads “a department other than CSE” as “outside computing”, so an ECE course is inside CSE whatever its topic (DGS 2026-10-04; rule a single course otherwise with its `is_cse` cell). A code this list does not name counts against the allowance; an ExternalCourses `is_cse` cell overrides it for one course. Notre Dame's own courses are decided by their own subject, never by this list. With the key missing **or its cell blank**, the app places no transferred course inside or outside CSE: since 2026-10-03 a transferred course whose row has no `is_cse` cell is then held for the DGS — “the course rules do not say whether this is a CSE course” — rather than placed on either side of the nine. |
| `ms_transfer_completed_ms_credits_max` | 9 | §5.2 | completed prior M.S./Ph.D. |
| `phd_transfer_completed_ms_credits_max` | 24 | §5.2 | completed prior M.S./Ph.D. |
| `transfer_unfinished_ms_credits_max` | 6 | §5.2 | unfinished prior M.S. |
| `transfer_min_grade` | B | §5.2 | |
| `fulltime_credits_min` | 9 | §2.1.2 | |
| `summer_fulltime_credits_min` | 6 | §3.3 | The MSCSE's residency (§3.3: "or for one summer session"): a summer session counts as full-time **on its own** with at least this many registered credits (DGS 2026-10-04, P1-page-text-ui-9). The Graduate School's figure is six — DGS Handbook §10.3.2: "may include summer session if the student is registered for six or more credits" — so do not set it lower; like `fulltime_credits_min` it is the department's full-time definition. A summer also counts with any registration beside a full-time spring or fall of the same year (Academic Code §3.6). The Ph.D.'s residency never counts a summer (§4.3). Missing: the MSCSE residency row reads "cannot evaluate" for a student whose only countable registration would be a summer. |
| `rules_effective_date` | 2026-09-01 | | **Display only, optional override.** Normally leave it out: the pages print "The course rules here were last updated on <date>, and are up-to-date as of <day of reading>" automatically — the first date is when the six-hourly sync first saw the current sheet content (see `snapshot.json` below). Add this row only when the rules should carry a different date than the last edit — e.g. a change decided today that takes effect next term; then the pages print "Rules effective as of <date>" instead, for as long as the row exists. YYYY-MM-DD preferred (other text is shown as written). |
| `current_semester` | — | | **Deleted from the live sheet 2026-09-14** — each Courses row's `last_offered` dates its schedule columns instead. Not read if re-added. The semester this sheet as a whole is current for, written as the code the pages print — `FA26`, `SP27` (case and a space or hyphen do not matter, and the old `Fall 2026` form still reads). Fall or spring only: a summer code cannot date the schedule. The course-rules page reads `offered_now` / `offered_next` against it — so **when you move it forward, check those two columns**, or last semester's schedule is republished under this semester's name. A value that is neither is reported in the sheet diagnostics — the self-check page's diagnostics card and `npm run sync-sheet` — so a typo never passes silently. (It was called `offered_semester` for a few hours on 2026-09-09; that name is still read.) The course-rules page's two schedule cards name their semesters from today's date, so this is what tells it whether those columns are still current: the same semester → shown as recorded; the semester BEFORE this one → what was recorded as "next" is shown as this semester, and next reads "Not released yet."; missing, older or ahead → both cards say "Not released yet." Update it in the same edit as the columns. |
| `contact_dgs_name` | Taeho Jung | | **Display only, optional (2026-09-04).** The six `contact_*` rows are how a DGS handoff updates the pages without touching code: they set the names and addresses shown in the "Who to contact" card, the opening notice, and the review-request emails. A missing or blank row keeps the fallback baked into `src/ui/contacts.ts`. |
| `contact_dgs_email` | tjung@nd.edu | | Where error reports, feedback, and course review requests go. |
| `contact_adgs_name` | Aaron Dingler | | The Assistant DGS (MSCSE policies). |
| `contact_adgs_email` | adingler@nd.edu | | |
| `contact_grad_admin_name` | Cari White | | The Graduate Program Administrator ("Grad Admin" on the pages) — review requests are emailed to this person AND the DGS. |
| `contact_grad_admin_email` | csalmons@nd.edu | | |
| `candidacy_form_deadlines` | — | Academic Code §6.2.9 | **Display only, optional (2026-10-03).** This year's Graduate School deadlines for the application-for-candidacy form, as free text (e.g. `fall: Oct 1; spring: Mar 1`). Quoted in the candidacy rows' sentence "Admission to candidacy also needs the Graduate School's application form, submitted through the Grad Admin by the Graduate School calendar's deadline" — missing or blank, the sentence names the calendar without dates. |

Add rows freely; the app ignores keys it does not know and warns (in the diagnostics panel)
about known keys that are missing — the affected requirement then shows "cannot evaluate"
rather than silently passing.

### Tab `Categories` — two lists side by side
Columns A–B hold the §4.4.1 core-knowledge areas, columns D–E the §4.4.2 specialization groups
(column C is empty). The app reads each pair by its header name. The code
`ineligible` is reserved: valid on Courses rows, but never a real matchable group.

| `core_area` | `core_area_name` | | `category_group` | `category_group_name` |
|---|---|---|---|---|
| `os` | Operating Systems | | `alg` | Algorithms |
| `algorithms` | Algorithms | | `hcc` | Human Centered Computing |
| `architecture` | Computer Architecture | | `arch` | Architecture |
| | | | `dsai` | Data Science and Artificial Intelligence |
| | | | `sys` | Systems and Software |
| | | | `ineligible` | Courses ineligible for qualifying examination |

### Tab `Changelog` (optional, human-only) — date, who, what changed. The app does not read it.
Only changes to the engine's logic go here — how a requirement is evaluated, what counts, a cap, a status (DGS 2026-09-23). Visual, layout and wording-only changes do not; they are in `docs/DECISIONS.md` and the git history.

### Note rows
A row whose key cell is a plain-English sentence (and whose other cells are empty) is treated as
a human note and skipped silently — the real tabs end with such notes. Anything else malformed
is reported, with its row number, in the app's diagnostics panel.

### `snapshot.json`
Written by `npm run sync-sheet` (and the six-hourly Action): `{ schemaVersion, syncedAt, csv:
{ courses, parameters, categories, external, universities } }` — the **raw CSV text** of the five tabs (`external` = ExternalCourses, `universities` = Universities, each kept from the previous snapshot if that tab alone fails), so the app's one
parser handles live and fallback data identically, and each commit diff reads as "what the DGS
changed". The script leaves the file **untouched while the sheet content is unchanged** (line
endings and trailing whitespace ignored), so `syncedAt` is the moment the current rules were first
seen — that is the date the pages print as "The course rules here were last updated on …"; when
the live sheet differs from this file they print "were updated after …" until the next sync. Google sends no
`Last-Modified` header for published CSVs (verified 2026-09-01), which is why the date comes from
here (`src/data/rules-date.ts`).

### `ExternalCourses` tab (optional — courses from other universities)
One row per course at ANOTHER university that the DGS has ruled on (feature
2026-09-01; sample: `external.sample.csv`). The app matches a student's uploaded
external courses against it by university + course id (case, punctuation,
diacritics and spacing are ignored). The university's name is the one the
app's import read from the official transcript (decision 2026-09-03: in capital
English, exactly as the transcript prints it) — the review-request emails
students send contain tab-separated rows in this tab's column order, ready to
paste straight into the sheet. **Never edit a `university` cell** (DGS
2026-10-07): not to tidy it, shorten it or fix its case, even when it looks like
a header fragment — Georgia Tech's official transcript reads "GEORGIA INSTITUTE
OF TECHNOLOGY OFFICIAL DOCUMENT INFORMATION", and every future Georgia Tech
transcript will read the same, so the rows must keep it to match.

| column | values | meaning |
|---|---|---|
| `university` | text | the institution's name as the import read it from the official transcript — paste it, never retype or edit it (DGS 2026-10-07) |
| `course_id` | text | as printed there ("CS 50300", "30240233"); spaces/hyphens don't matter |
| `course_title` | text | for humans reading the sheet |
| `satisfies_core_area` | a `core_area` code, `none`, or blank | §4.4.1 core area the course covers — a match makes the student's core row **met**. `none` = decided, no core area (a core-sounding title then stops appearing in the review request); blank = not decided yet (the course stays in the review request) |
| `transferable_PhD` | `yes` / `no` / `dgs_approval` / `adgs_approval` / blank | §5.2, for a **Ph.D.** student. `yes` = pre-approved, though each student still makes the formal request (DGS recommendation + Graduate School approval). `no` = never transfers. `dgs_approval` / `adgs_approval` = this one needs an approval, so the app keeps it in the review request as an open decision and tells the student "needs DGS approval"; it does not ask them to argue the case, which is between the advisor and the DGS. Blank = not looked at for that program |
| `transferable_MSCSE` | the same four values, or blank | The same question for an **MSCSE** student, answered separately (2026-09-09). The app reads whichever column matches the student's own program. The two approval words mean the same thing for now and both read as "needs DGS approval"; the sheet's own word is kept, so the MSCSE message can name the ADGS later without another sheet change |
| `is_cse` | `yes` / `no` / blank | Is this a **CSE course**, for §4.2's nine-credit allowance for courses "taken from a department other than CSE"? Fill it in only where the code list should not decide — e.g. `no` for a course the DGS rules outside computing although its code is listed (since 2026-10-04 `ECE` is in the list: the department reads “a department other than CSE” as “outside computing”). Blank = the `cse_subject_codes` parameter decides; this cell wins over it (2026-09-09) |
| `nd_credits` | number or blank | A **fixed** Notre Dame credit value for this one course (§5.2 pro-rata). It wins over the printed credits and over the university's ×.66 / ×.88 conversion (its `credit_system` in the Universities tab) — so it must be **the figure the Graduate School approved** for the course, not the DGS's own rounding: the DGS Handbook's pro-rata table (quarter ×.66, trimester ×.88) is mandatory and the final number is the Graduate School's (policy review 2026-10-03, P1-units-4plus1-4). Use it only when one number is right every time — it cannot describe a course that is worth 2 credits one term and 4 the next; `credit_system` handles those. Blank = credits as printed, unless the university's `credit_system` (Universities tab) says otherwise |
| `credit_system` | — | **No longer read** (DGS 2026-10-10): each university's credit system is set ONCE in the **Universities** tab (below). While a Universities tab exists the app ignores this column and its diagnostics name any rows still carrying a value, so the column can be deleted. A sheet or saved copy without a Universities tab still reads it, as before. |
| `decided_on`, `notes` | text | for the record |

Anything a student uploads that has NO row here shows "not yet reviewed by the
DGS" (never guessed), and the student gets a copy-ready email request — that is
how this tab grows.

**Notre Dame coursework from an EARLIER Notre Dame degree** (2026-09-05 — a
combined transcript: a Notre Dame B.S. or a prior Notre Dame M.S. before the
current program) is filed under the university name `UNIVERSITY OF NOTRE DAME`.
Its §4.4.1 core area comes from the **Courses tab** (the course's `core_area`
applies whenever the course was taken — add the course there if it is missing),
so no row is needed here for core knowledge; a row here is only for
pre-approving the §5.2 transfer of a prior Notre Dame graduate course
(`transferable`), which the handbook treats like any other prior-program transfer.

**Two rows for the same university + course** (say, a decided row pasted below an older blank
one): the **last** row wins — it replaces the earlier one — and the diagnostics warn so the older
row can be deleted (DGS decision 2026-09-06). Blank verdict cells mean "not decided yet"; the
course stays in the students' review request until `transferable` and, for a core-sounding title,
`satisfies_core_area` (a core area or `none`) are filled in. A `dgs_approval` row is a decision
about the COURSE, not about the student, so it keeps the course in the review request — that is the
point of the value: the DGS wants to see each student's case for it.

**One-time setup:** create the tab, publish it to the web as
CSV (File → Share → Publish to web → ExternalCourses → CSV) and paste the URL
into `sheet-urls.json` as `external`. Until then the app runs without it.

### `Universities` tab (optional — each university's credit system)
One row per university (DGS 2026-10-10: "I want to enter the credit system for
each university" — until then it was a `credit_system` cell on every
ExternalCourses row; sample: `universities.sample.csv`). The app matches a
student's course to its row by university name the same way ExternalCourses
does (case, punctuation, diacritics and spacing ignored).

| column | values | meaning |
|---|---|---|
| `university` | text | the name **exactly as in ExternalCourses** — the import's reading of the official transcript. Paste it; never retype, tidy or shorten it (DGS 2026-10-07) |
| `credit_system` | `quarter` / `trimester` / `semester` / blank | The system this university awards in. `quarter` / `trimester` convert whatever the student's own transcript prints by the Graduate School's factors — × 0.66 / × 0.88, the DGS Handbook's §3.14 pro-rata table, kept in the code (README § A5b) — so a course whose credits vary converts correctly every time. It applies to **every** course from the university: those ruled on in ExternalCourses and those not yet ruled on. Blank, a missing row, or a value the diagnostics reject: the course's credits count as printed and its line says “credits shown as your transcript prints them — the DGS converts …”. A course's own `nd_credits` (ExternalCourses) still wins |
| `notes` | text | for the record; not shown to students |

A university can be listed here before any of its courses is ruled on. Two rows
for one university: the **last** wins, and the diagnostics warn (the ExternalCourses
rule, 2026-09-06). A student's review request asks for this tab's row for each university
in the request whose system the sheet does not give yet: a paste-ready new row
(prefilled with `quarter` or `trimester` when their record carries one, and
saying whether the transcript read it or the student chose it), or — for a
university listed with a blank `credit_system` — completing that row.

**Setup — DONE 2026-10-10:** the tab sits after ExternalCourses (sheet gid
714661529, a drop-down on `credit_system`); the whole document is published, so
its CSV link is the ExternalCourses link with that gid, in `sheet-urls.json` as
`universities`. It started with the 11 universities the ExternalCourses column
named — UC San Diego on quarters, the other ten on semesters.

## Validation the app must do on load
- unknown value in an enumerated column → row is skipped and reported ("Courses row 14, column
  `course_type`: 'lecture' is not one of regular|seminar|research|independent|project")
- duplicate `course_id` with the same `rules_effective_term` → reported
- missing required parameter key → reported, and the requirement that needs it is shown as
  "cannot evaluate — rules sheet is missing `<key>`" rather than silently passing
- a `core_area` or `category_group` value not in the `Categories` tab → reported
- **a Courses COLUMN that has been renamed or deleted → reported, naming the column and the headers
  that are there** (2026-09-18). Before that, renaming `counts_toward_phd` made every course read
  "Not yet decided" and renaming `active` brought every retired course back, both silently. Extra
  columns are still fine and the order still does not matter — only a missing expected name is
  reported.
- `category_group` saying `ineligible` AND naming a group → reported (`ineligible` wins)
- a row marked `active = no` whose `offered_now` / `offered_next` says `yes` → reported
- two `core_area` or `category_group` codes sharing a NAME → reported (two identical headings and
  two identical filter choices otherwise)
- a `Categories` tab with no core areas, or no specialization groups, fails the load like an empty
  tab instead of rendering a page whose §4.4.1 section is silently empty (2026-09-18)
- an `ExternalCourses` row ruled `yes` or case by case (either program) whose course number looks
  undergraduate (a 4- or 5-digit number under 5000 / 50000, or a 3-digit number in the 100s, 300s or
  400s — the 200s are the University of California's graduate courses), or a row ruled `yes` whose
  title suggests independent study, research, a thesis or a seminar → a WARNING (2026-10-04, the
  DGS's own corrected mistakes). Only
  graduate courses transfer (Academic Code §4.6), and a transferred `yes` counts toward the
  regular-course credits. A guess from the number and title, so nothing is refused: for a student
  who has such a course — or an undergraduate-numbered course not in the tab yet — the same check is
  copied to the review request (for the DGS/ADGS) and the processing request (for the Grad Admin) —
  `src/data/course-checks.ts`.
