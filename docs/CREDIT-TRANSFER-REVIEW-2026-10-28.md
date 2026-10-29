# Credit-transfer review — 2026-10-28

The DGS (2026-10-28): “Do a thorough review to see if there are any other errors in credit transfer
(e.g., non-CSE transfer, old transfer, non-CSE courses at ND, undergrad courses at ND, grad courses taken
during the undergrad years at elsewhere etc.) and see whether they are applied to the 24 regular credits
and 60 total credits correctly.”

**How it was done.** A workflow of 182 agents: eight finder families (non-CSE transfer, old transfer,
Notre Dame courses outside CSE, Notre Dame undergraduate coursework, graduate courses taken during the
undergraduate years elsewhere, §5.2's cap, the totals, the outputs), each finding then reproduced by an
independent agent and checked against the handbook and docs/DECISIONS.md by another trying to refute it,
then a gap round of six probes. 74 findings confirmed (11 high, 21 medium, 42 low), 3 left as questions
for the DGS, 6 dropped as intended by a recorded decision, 208 cases checked correct.

**What was done.** All 74 are fixed, in eight commits (one in part: #32's line now names the cap that bound, but the amount it says “would count … if approved” is still read from today's order, before approval would move the course ahead) (each with scenarios or tests that fail before the
fix; no pinned verdict moved). The decisions behind them are the DECISIONS rows of 2026-10-29; the
student-facing wording is W-CL583–W-CL603 in docs/WORDING-REVIEW.md.

| # | severity | program | finding | fixed in |
|---|---|---|---|---|
| 0 | high | both | Threshold rows compare the raw floating-point sum with no tolerance: credits that add up exactly to the minimum print "30 of 30" / "24 of 24" / "60 of 60 credits complete" and read Not met | batch 1 (2b95d0f) |
| 1 | high | both | Two-word and suffixed subject codes are misread, so CSE transfer courses (Wisconsin COMP SCI, BU CAS CS, NYU CSCI-GA, Indiana CSCI-P) count against the non-CSE nine and are cut past it | batch 2 (2b95d0f) |
| 2 | high | phd | Notre Dame regular credits refused by the shared non-CSE nine (transfer courses now fill it first) drop out of the Notre Dame-only counts — §4.2's nine regular credits at Notre Dame, the MSCSE-along-the-way's 24 and the qualifier's nine — so approved transfer credit can undo them (regression from 36b1a98) | batch 3 (2b95d0f) |
| 3 | high | phd | The F1 spill (non-CSE credit refused by the nine still counts toward the 60) is neither limited by nor charged to the course's other caps: the 60 exceeds the semester maximum, the non-degree 12, the dual-degree 9, the two-degree 6 and §5.2's 24 (posted credit's spill is never charged to the transfer cap, so more transfer credit is admitted and submitted) | batch 3 (2b95d0f) |
| 4 | high | both | Credit already posted on the Notre Dame record gets no precedence on §5.2's cap: courses not yet transferred take the cap first, the posted course reads "not counted — over the transfer-credit cap" while the §5.2 card says it "counts with no review or processing request", and the Grad Admin request asks for a full cap on top of the posted credit | batch 3 (2b95d0f) |
| 5 | high | both | A Notre Dame course taken twice counts every time when one attempt is filed as earlier Notre Dame coursework (origin 'transfer': undergraduate or 4+1 attempt, own MSCSE, an earlier ND program, or both attempts before the program) — no de-duplication and no "entered 2 times" warning | batch 5 (12b4833) |
| 6 | high | phd | For a Notre Dame MSCSE holder, the §5.2 window counts back from the MSCSE admission with no upper bound and ignores a five-year separation, so credit outside the window counts toward the 24 and the 60 and is submitted | batch 6 (a7770ef) |
| 7 | high | both | After a readmission following five years or more, transfer credit from another university dated before the interruption, posted or not, is not held: it counts as definite toward the 24 and the 60 and goes to the Grad Admin, while the warning says every earlier course is forfeited | batch 6 (a7770ef) |
| 8 | high | both | A second graduate transcript moves the "Before <first semester>" bachelor's estimate later, so the first transcript's graduate courses get refiled as taken before the bachelor's; the import order decides the credit | batch 6 (a7770ef) |
| 9 | high | phd | An early-start summer course is read as Notre Dame MSCSE coursework, so the five-year MSCSE separation hold disappears and the MSCSE admission is dated to the early-start summer | batch 6 (a7770ef) |
| 10 | high | both | Saved-file migration (migrateApprovalBoxes) puts dgsApproved on courses the old box never covered, so they count as definite, read 'as you ticked', leave the DGS review request and are submitted to the Grad Admin | batch 7 (010f542) |
| 11 | medium | both | Allowance cards list a course as "not counted — beyond the allowance" (or "beyond the allowance — count toward the total-credit requirement only") under every cap it draws on, whichever cap actually cut it — §5.2's transfer cap, the semester maximum, the two-degree six, the below-60000 six, the non-CSE nine — or for a §5.2 candidate, beside a meter showing room left | batch 8 (3fd25a8) |
| 12 | medium | both | Inside a shared allowance (the non-CSE nine, the below-60000 six) the allocator fills in term/id order whatever the pool, so a seminar, research or independent-study course takes room a regular course needed: the 24 (and the nine at Notre Dame) depend on which semester each course was taken, the 30/60 unchanged | batch 3 (2b95d0f) |
| 13 | medium | both | Allowance cards ignore what a seminar, research or independent course takes from them: the card reads Met while such a course waits for its approval, names it under no "needs approval", and its course list (contributions, ticked list) leaves its credits out although the meter counts them | batch 8 (3fd25a8) |
| 14 | medium | phd | On the Ph.D., a non-regular (total-only) non-CSE course reached through §5.2 draws §4.2's nine: regular courses are pushed out of the 24 and its own refused credits count toward nothing | batch 3 (2b95d0f) |
| 15 | medium | phd | A readmission after a shorter gap holds only origin-'nd' rows, so a Ph.D. student's own Notre Dame MSCSE courses (and credit posted on the Notre Dame record) from before it count in full while the later Ph.D. courses wait | batch 6 (a7770ef) |
| 16 | medium | both | The advisor email calls every case-by-case course 'a course below the 60000 level' and drops 'from outside CSE' | batch 8 (3fd25a8) |
| 17 | medium | both | The engine treats a "Before <semester>" bachelor's estimate as the exact award term: a graduate course from another source dated before that semester is refused, and its line names an award term the student never gave | batch 6 (a7770ef) |
| 18 | medium | both | One school spelled two ways counts as “two earlier graduate programs”, which holds every not-yet-posted transfer course for the DGS | batch 4 (2d08ffc) |
| 19 | medium | both | A transfer course with no final grade (IP at the other university) is counted on the §5.2 card and submitted to the Grad Admin, while the same course graded I is held because it cannot show §5.2's B | batch 6 (a7770ef) |
| 20 | medium | both | Two transfer rows with the same course id, university and term (two topic sections, or a duplicate entry): the request reads the first row's admitted credits for both and submits past the cap, and the course table drops the second registration | batch 5 (12b4833) |
| 21 | medium | both | Course-line "Counts toward / Will count toward" lists are keyed by course id: an in-progress registration inherits a graded registration's "now" rows | batch 5 (12b4833) |
| 22 | medium | both | Credit posted on the Notre Dame record attaches to the FIRST row of that course in the record, so a course taken twice at the other university counts twice, and the totals change with row order | batch 4 (2d08ffc) |
| 23 | medium | both | Posted credit for a course taken elsewhere after admission counts as an 'earlier graduate program', so the record reads 'two earlier graduate programs' and holds every approved course of the real earlier master's | batch 4 (2d08ffc) |
| 24 | medium | both | The §5.2 transfer card lists Notre Dame coursework that is not transfer credit (own MSCSE, non-degree, pre-entry ND with no earlier program, before-admission) among its refused or cut transfer courses | batch 8 (3fd25a8) |
| 25 | medium | phd | Earlier Notre Dame coursework fills the below-60000 six in term order and pushes an in-program 40000-level course out: §4.2's nine at Notre Dame and the MSCSE along the way flip to not met, though the 24 and 60 are the same either way | batch 3 (2b95d0f) |
| 26 | medium | both | Earlier Notre Dame coursework with a blank Courses-tab verdict, or missing from the Courses tab, is asked 'approve it for me — the course rules say case by case' as a ruling (list B). That statement is false, no box records the reply, and the blank cell itself is never asked. | batch 7 (010f542) |
| 27 | medium | both | Courses passed below C with an open approval are left out of the review request (DGS 2026-09-13), but the approvals card and the advisor email still send the student and the DGS to the review request for them | batch 5 (12b4833) |
| 28 | medium | both | §3.8's semester/summer maximum is filled single-cap courses first, not 'entered first': a regular course that also draws on the below-60000 six or the non-CSE nine is cut while a research, seminar or project course entered after it keeps the room | batch 3 (2b95d0f) |
| 29 | medium | both | A case-by-case tick given before the Notre Dame import marked the row as posted answers the posted-credit hold ('posted before you entered this program … the DGS confirms') | batch 7 (010f542) |
| 30 | medium | both | An earlier Notre Dame program's course whose Courses-tab row is case by case (CSE 4xxxx, non-CSE) counts outright on an ExternalCourses `yes`: §4.2's approval is dropped, the course is submitted, and an inert unticked approval box sits beside 'counts' | batch 7 (010f542) |
| 31 | medium | both | One record-level 'transfer recorded' tick covers a transfer that counts only after it: the course reads 'recorded by the Grad Admin', the §5.2 card turns Met, and the Grad Admin request never submits it | batch 7 (010f542) |
| 32 | low | both | A §5.2 candidate (case-by-case or unreviewed) that the non-CSE nine admits only in part says "the N-credit transfer allowance limits the rest", and predicts the wrong amount "if approved" | batch 3 (2b95d0f) |
| 33 | low | both | The Grad Admin request's "Not submitted — over the N-credit transfer cap" says "the self-check filled the cap in term order", but the allocator fills single-cap (CSE) transfers and earlier tiers first, so the course left out can be the earliest | batch 8 (3fd25a8) |
| 34 | low | both | When §5.2's own cap is among the caps that cut a transfer, the report gives the request no reason (restOver/restUnknown skip 'transfer'), so the request falls back to "over the transfer cap … the DGS may choose": it names only the transfer cap when the non-CSE nine ran out too, and says so even when §5.2's limit is missing from the sheet | batch 8 (3fd25a8) |
| 35 | low | both | The credit rows' "meeting this depends on courses that still need review" list comes from the pool classification, not the row's own allocation: it names pending courses the non-CSE nine refused (approving them changes no count), and the 60/30 rows leave out pending total-only courses they do count | batch 8 (3fd25a8) |
| 36 | low | both | The Grad Admin request's "Courses counted so far" table prints a Notre Dame course's whole credits, and every requirement it feeds, when a cap (below-60000 six, non-CSE nine) admitted only part of it — the part is printed only for transfer courses | batch 8 (3fd25a8) |
| 37 | low | both | classify maps course_type 'project' to the 'project' pool on either program whatever the course id: on the Ph.D. a project-type course (live: CSE 68902, phd yes) reads "counts toward the project/thesis requirement", which the Ph.D. does not have; on the MSCSE any course typed 'project' (a non-CSE 'EE 68902') fills §3.2's six credits of CSE 68901/68902 | batch 3 (2b95d0f) |
| 38 | low | phd | The nine-regular-credits-at-Notre-Dame row tells a student with no Notre Dame undergraduate coursework that "Notre Dame coursework you took as an undergraduate counts toward the 60 and the 24" (fires for non-degree, before-admission and earlier-ND-master's §5.2 coursework) | batch 8 (3fd25a8) |
| 39 | low | phd | A course taken elsewhere while the student was enrolled in the Notre Dame MSCSE is not held as taken after admission: the window counts from the MSCSE admission, but the advance-approval hold counts from the Ph.D. entry | batch 6 (a7770ef) |
| 40 | low | phd | An own-MSCSE course held after a five-year readmission still says "counts in full as Ph.D. coursework" on its waiting line | batch 6 (a7770ef) |
| 41 | low | both | Credit already posted on the Notre Dame record, read from the official PDF's transfer block, always triggers the warning that it still reads In progress and needs a grade | batch 4 (2d08ffc) |
| 42 | low | phd | With the Ph.D.'s non-CSE limit missing from the sheet, a Notre Dame non-CSE course leaves the 60-credit total, which F1 counts whatever the limit | batch 3 (2b95d0f) |
| 43 | low | phd | Ph.D.: with no bachelor's award term set, a 4+1's GR-registered senior-year course takes the graduate paths instead of asking for the award term as the MSCSE does | batch 6 (a7770ef) |
| 44 | low | phd | The DGS review request asks the DGS to confirm a bachelor's + Ph.D. double count for a course the two-degree allowance has no room left for | batch 8 (3fd25a8) |
| 45 | low | phd | Answers that put more than six credits toward both the bachelor's and the MSCSE are taken without a warning, and the line then reads '9 of its 6 credits already used' | batch 8 (3fd25a8) |
| 46 | low | phd | The two-degree allowance row prints 'the Ph.D..' (double period) | batch 8 (3fd25a8) |
| 47 | low | both | Graduate transfer credit already posted on the Notre Dame record is dropped when its twin row is 'Taken as: UG student', while the block row's line says it is counted on that twin | batch 4 (2d08ffc) |
| 48 | low | phd | An undergraduate course's line says it 'may still satisfy' a core area 'once the DGS reviews it' after the DGS has ruled satisfies_core_area = none | batch 4 (2d08ffc) |
| 49 | low | phd | A core-knowledge row reads 'No … course yet' when the course is listed in ExternalCourses with a blank satisfies_core_area, while the review request asks the DGS for that core area and the course line says pending | batch 4 (2d08ffc) |
| 50 | low | phd | The core-knowledge row shows the university in the sheet's capitals: 'Satisfied by CS 50300 (PURDUE UNIVERSITY)' | batch 4 (2d08ffc) |
| 51 | low | both | The §5.2 card never names a ticked case-by-case transfer that it counts and that the request submits | batch 8 (3fd25a8) |
| 52 | low | both | Advisor email to-do prints raw floating-point remainders ("Complete 1.4399999999999977 more credits") | batch 1 (2b95d0f) |
| 53 | low | phd | The advisor email's transfer list is built from a classification made without today, so a lapsed Incomplete is listed for the Grad Admin to submit while the page, the Grad Admin request and the same email's DGS to-do hold it | batch 7 (010f542) |
| 54 | low | both | An approved transfer course that a cap admits only in part loses, on its own line, the 'approved by the DGS … send the Grad Admin the processing request' note that every whole course carries | batch 8 (3fd25a8) |
| 55 | low | both | Grad Admin request: 'Courses counted so far' prints the first definite registration of a course id, even one that counts nothing, and leaves out the registration that counts | batch 5 (12b4833) |
| 56 | low | both | Approvals card and advisor email list a settled registration as 'the ADGS has still to record its core-knowledge area (§4.4.1)' when another registration of the same course id is waiting: a Ph.D. qualifier request on the MSCSE tab | batch 5 (12b4833) |
| 57 | low | mscse | MSCSE: the staff check for posted research or thesis credit tells the ADGS 'the DGS decides how it counts', because the note skips the ADGS wording | batch 8 (3fd25a8) |
| 58 | low | mscse | MSCSE: when the sheet has no cse_subject_codes list and no is_cse cell, every surface cites '§4.2’s nine-credit non-CSE allowance' (the Ph.D.'s section) for the held course | batch 8 (3fd25a8) |
| 59 | low | both | With three earlier programs, the §5.2 card says '3 earlier graduate programs' but each course's reason says 'one of your two earlier graduate programs' | batch 8 (3fd25a8) |
| 60 | low | both | A §5.2 course the course rules approve ('yes') but a record-level hold keeps waiting for the DGS is ranked out of the cap with a red 'not counted — over the transfer-credit cap', while an undecided case-by-case or unlisted candidate holds the room | batch 8 (3fd25a8) |
| 61 | low | both | Two rows of one Notre Dame regular course in one term with different final grades: which row counts depends on entry order, and the course can count nothing | batch 5 (12b4833) |
| 62 | low | both | Same-term duplicate rows of a non-regular Notre Dame course (seminar, directed readings, research) both count toward the 60 with no duplicate warning | batch 5 (12b4833) |
| 63 | low | both | The review request's 'Credits' column and the §5.2 card's 'Waiting for the DGS: … (N credits)' print the transcript's credits with no label, beside the converted ND credits the engine counts (quarter/trimester or nd_credits) | batch 8 (3fd25a8) |
| 64 | low | mscse | In the MSCSE review request (to the ADGS), the is_cse question cites the Ph.D.'s §4.2, and the posted-thesis note says 'the DGS decides'. The Grad Admin request for the same record says 'the ADGS decides'. | batch 8 (3fd25a8) |
| 65 | low | both | Credit already posted on the Notre Dame record is asked about as if it had a sheet row: 'complete the row' with no ExternalCourses row and no paste-ready row, and a staff note reading 'not in the course rules yet … before approving it' | batch 8 (3fd25a8) |
| 66 | low | both | §5.2 card: 'Waiting for the DGS: <course> (N credits)' adds up the transcript's printed credits, while the same card's meter and the course's line use the converted figure | batch 8 (3fd25a8) |
| 67 | low | both | nd_credits 0 on a 'yes' row: the line reads a bare 'not counted' with no warning, and the Grad Admin request files the course 'over the 24-credit transfer cap' while 21 credits are free | batch 8 (3fd25a8) |
| 68 | low | both | Sheet diagnostics tell the DGS that a university's credits 'count as printed' (rejected Universities cell, empty Universities tab), but a course whose transcript read quarter or trimester is still converted | batch 8 (3fd25a8) |
| 69 | low | phd | A research seminar refused by the semester/summer maximum still satisfies §4.2's two-credit seminar requirement: its line reads 'not counted', the seminar card 'done' | batch 8 (3fd25a8) |
| 70 | low | both | The §3.8 over-maximum warning counts credits another cap already refuses: it says '2 credits are not counted' when the maximum cuts nothing | batch 8 (3fd25a8) |
| 71 | low | both | A course line cut by two caps cites only the first cap's section | batch 3 (2b95d0f) |
| 72 | low | both | The line of a case-by-case or unreviewed transfer held for a §5.2 reason names no hold: '[ticked] waiting for the DGS — would count … if approved' | batch 7 (010f542) |
| 73 | low | both | Next steps still say 'Send the processing request (N items) — the Grad Admin records it' after the graduation semester began, while the request, card, warning and email ask whether it was sent in time | batch 8 (3fd25a8) |

## Second verification (2026-10-29)

Each of the 74 fixes was re-checked against the code by a second workflow (67 agents: one re-check per
batch, an allocator sweep of 572,563 generated records for invariants, fill order and monotonicity,
and two independent checks of every problem found). 42 problems were confirmed — side effects of the
batches or parts of a fix they missed. Their fixes were then checked once more: every reproduction
re-run against the fixed code, plus an independent review of the change (8 agents). That final check
found seven faults in the fixes themselves and older problems beside them; a last check before shipping
(a differential sweep of 28,000 generated records against the previous commit, and two reviews) found three
more in those fixes. All are fixed and pinned in tests/review-fixes-outputs.test.ts,
tests/review-fixes-round2.test.ts and tests/review-fixes-round3.test.ts. Three problems are left as they
are (“not changed”). The decisions are the DECISIONS rows “A second verification of the review’s fixes”,
“A final check of the review’s fixes” and “The last check before shipping”; the wording is W-CL604–W-CL625.

| C | severity | what was wrong | now |
|---|---|---|---|
| 0 | medium | Candidacy/OCE cards added waiting credits raw: “9 more needed, 0 if the DGS approves them” read not yet | exact six-decimal sums (0 of 1,122 orderings wrong) |
| 1 | high | “CSC I0400” (City College) read as subject CSCI, counting as CSE | the subject takes no letter of the number |
| 2 | low | “18CS53” lost its subject | a leading number is the course number |
| 3 | high | #4 in part: posted credit outside CSE lost §5.2’s cap to untransferred CSE courses | posted credit takes its caps first in every tier; the card no longer lists posted credit the cap refused |
| 4 | low | #28 in part: a candidate’s “would count … if approved” amount is read from today’s fill order | not changed (the line says “would”) |
| 5 | low | #32 in part: the same, when another cap binds | not changed |
| 6 | low | #71 in part: “(Academic Code §2.3; §4.2)” — the page read §4.2 as the Code’s | “(Academic Code §2.3; CSE §4.2)”; Next steps keep the bracket whole |
| 7 | medium | The order search took seconds on a non-CSE master’s plus Notre Dame non-CSE courses; then an over-maximum semester ran the page out of memory, and twenty one-credit transfers took five seconds | identical courses share one search state; bounded; milliseconds; exact on 6,150 records |
| 8 | high | An overloaded semester cut the research course before a non-CSE course that could only add to the 60 | that course waits behind total-only credit when neither pass can count it as regular credit; both passes refuse the same course (a question for the DGS remains) |
| 9 | high | The Notre Dame-only pass read an overloaded summer differently from the main pass | both passes fill the same way |
| 10 | low | A candidate line named the nine but cited only §5.2 | “(§4.2; §5.2)” / “(§3.2; §5.2)” |
| 11 | high | #23 in part: posted credit from a course taken during the Notre Dame MSCSE made a second earlier program | taken while enrolled, it is no earlier program |
| 12 | high | #18’s nested-name rule merged two different schools into one earlier program; its fix then split Georgia Tech’s header-word name from its plain name | a flagship and its campus, or a name plus a transcript’s header words, is one school |
| 13 | low | Two postings of one course number: the second block row stayed (and, Notre Dame transcript second, was lost); later fixes put a posting on a C attempt, then swapped two topics courses | one posting per row: by title when every row is posted, an acceptable attempt first when there are retakes |
| 14 | medium | “Counts toward” was keyed by course number: a bachelor’s-only row or a same-numbered transfer inherited the nine, and a core area | each registration’s own allocation and its own core area |
| 15 | low | #27 in part: a below-C course was offered the DGS box; a 4+1 one was still sent to the DGS | no box, not sent |
| 16 | low | #55 in part: the request’s table printed a Purdue “CSE 60641” under the nine at Notre Dame | the row each registration counts |
| 17 | high | #61 in part: same-grade same-term rows counted by entry order | the row this degree can count, then grade, import, credits, the DGS’s ticks, then title |
| 18 | high | The retake rule kept an attempt this degree cannot count over a live retake | the attempt that earns here (see the question below) |
| 19 | medium | A waiting course lost the core area it passes by itself | core knowledge asks only “passed” |
| 20 | medium | Same-term duplicates of a bachelor’s-used course lost their warning | warned again, once, accurately |
| 21 | medium | #6 in part: the window’s end for an MSCSE holder; the §5.2 paragraph then contradicted the lines | both read the MSCSE’s end |
| 22 | medium | #7 in part: posted or unposted credit held by §5.5 was not asked, then had no box | asked, with the hold’s box |
| 23 | medium | #15 in part: held own-MSCSE courses were not asked; a 4+1 senior-year MSCSE row escaped the hold | asked and held |
| 24 | low | #40 in part: a held MSCSE course said “counts in full” | never beside a hold |
| 25 | high | #43 in part: a 4+1 MSCSE holder with no award term counted senior-year rows toward a third degree | an unanswered row asks for the award term; an answered one is placed by its answer |
| 26 | low | A course taken during the MSCSE read “after you entered” | “while you were enrolled in your Notre Dame MSCSE” |
| 27 | low | An in-progress `yes` transfer, ticked recorded, read a garbled line | “no final grade yet (§5.2 needs a B or better)” |
| 28 | low | A held line dropped every note | the posting’s note, or the recorded tick’s, stays; a held area elsewhere waits for the DGS |
| 29 | medium | #26 in part: a blank verdict cell not asked in every variant | always asked |
| 30 | low | #72 in part: a candidate’s line named no two-programs, lapsed-Incomplete or readmission hold | every hold named |
| 31 | medium | The advisor email asked to submit a transfer already ticked recorded | only those still to submit; the card marks each recorded course |
| 32 | low | #11 in part: a spill also cut by the semester maximum | fixed |
| 33 | low | #36 in part: the request’s table printed a spilled course’s whole credit toward the 24 and the nine | “24 regular-course credits: 3 of the 4” |
| 34 | medium | #44 in part: a spent six still sent a course to the DGS | not sent |
| 35 | low | #59 in part: “two programs” for three | count-free |
| 36 | medium | The review request asked a double-count question no ruling can grant; another approval on the same course still sent it | not asked, no box, no approvals line |
| 37 | low | #65 in part: posted credit without a row got no paste-ready row | asked as needing a row |
| 38 | low | #68 in part: diagnostics for a rejected value in the retired `credit_system` column | not changed (the column is gone from the live sheet) |
| 39 | low | #73 in part: the waiting step ignored the closed window; the fix then asked for any course from elsewhere | asked when a transfer the request will submit waits |
| 40 | low | The processing step asked about a transfer the request does not carry; a course over a cap kept the §5.2 card in progress after the tick | asked only when the request carries one; the card counts what the caps admitted |
| 41 | medium | A seminar a semester’s maximum refused read as never taken; the fix then gave the overload remedy for any cap | taken and refused, with each semester’s overload — or the DGS for another cap |

**The moved verdicts** (`tests/verdicts.json`). `phd-4plus1-double-count-used` and
`phd-two-degree-six-overanswered` · shared.approvals: needs_dgs_review → in_progress — the six shared
credits are already spent on the bachelor’s and the MSCSE, so no DGS ruling can grant the double count
the review request used to ask for (C36); what is left is the advisor’s approval.

## Questions for the DGS (not changed)

1. **One thesis-titled transfer course, two verdicts: an ExternalCourses `yes` counts toward the 24 until the Graduate School posts it, then toward the 60 only**
2. **A case-by-case transfer that a transfer hold also holds (no earlier program, an S grade, taken after admission, an Incomplete elsewhere) shows the DGS-approval box, but ticking it changes nothing. The reply the request asks for cannot be recorded.**
3. **The retake rule keeps an attempt held by a readmission (forfeited after five years or more) as 'the one counted' and drops the live retake**
4. Whether Academic Code §5.5 reaches transfer credit that qualifies for §5.2's window only through a
   Notre Dame MSCSE that ended five years or more before the Ph.D. (counted now).
5. Whether a course taken elsewhere between the end of the Notre Dame MSCSE and the Ph.D. is “after
   admission” and needs the advance approval of DGS Handbook §3.14 (not held now).
6. Whether DGS Handbook §3.3 (“reject some or all past credits”, a shorter readmission) reaches credit
   already posted on the Notre Dame record (counted now).
7. For a separated MSCSE, which ends it when both are on the record: its award term or a later Notre Dame
   graduate course before the Ph.D. (the later course now).
8. Johns Hopkins prints its courses school.department.course (`EN.601.433`); the subject is now read as
   `601` (Computer Science there), which is not on `cse_subject_codes` — add it to count those as CSE.
