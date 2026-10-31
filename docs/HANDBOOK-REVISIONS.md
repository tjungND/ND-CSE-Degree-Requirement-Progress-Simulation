# Handbook revisions suggested by the degree audit

Started 2026-09-09, by the DGS (Taeho Jung), while making the self-check handle a Ph.D.
student who earned an earlier Notre Dame degree.

Building an audit that must decide every case forces questions the handbook does not answer.
Where a question had to be answered to make the app work, the DGS answered it, and the answer
is recorded in `docs/DECISIONS.md`. **This file is the other half: the places where the answer
belongs in the handbook rather than in a spreadsheet or in code.** Each item says what the
handbook says today, what the app now does, and the sentence that would settle it.

Nothing here is a change to the handbook. It is a list for the next revision, for the CSE
graduate committee and, where the Graduate School's own rules are involved, for them.

---

## 1. §4.4.2 — may a specialization course have been taken before the program?

**Today.** §4.4.2 says: "Students are required to take three category specialization courses
from three distinct groups and pass them with a grade of B or higher." It names no institution
and no term. The neighbouring §4.4.1 does the opposite, explicitly: "All PhD students are
required to pass (**or have previously passed**) an Operating Systems course, an Algorithms
course, and a Computer Architecture course, **either at Notre Dame or at their previous
institution**."

**Why it comes up.** A student who earned the MSCSE at Notre Dame arrives having already passed
three or more CSE 6xxxx courses that the department itself lists as category specialization
courses.

**What the app does (DGS, 2026-09-09).** Those courses count toward §4.4.2 once the credit
actually transfers into the Ph.D. under §5.2 — that is, once the DGS has recommended the
transfer and the Graduate School has approved it. Until then the report names them and counts
none of them. Coursework from another university cannot count, because only Notre Dame's own
course list carries the §4.4.2 group tags.

**Suggested sentence.** In §4.4.2, after the first sentence: *"Courses taken before entering
the Ph.D. program may satisfy this requirement only if their credits are transferred into the
Ph.D. under Section 5.2."* Or, if the committee means the opposite: *"These three courses must
be taken while enrolled in the Ph.D. program."* Either sentence ends the ambiguity; the
contrast with §4.4.1 is currently the only evidence either way.

---

## 2. §4.2 and §5.2 disagree about the five-year window

**Today.** Two sentences, both binding, do not say the same thing.

- §5.2, criterion 3: credits transfer if "the courses were completed within a five-year period
  prior to admission to a graduate degree program at Notre Dame **or while enrolled in a
  graduate degree program at Notre Dame**".
- §4.2: "Courses from a M.S. degree earned at Notre Dame or another institution **within the
  last five years prior to admission** may be used to satisfy the course requirement."

**Why it comes up.** A student who finished the Notre Dame MSCSE more than five years before
entering the Ph.D. — a returning student, or one who worked in industry first. §5.2's second
clause appears to admit their coursework; §4.2's clause appears to refuse it.

**What the app does.** On 2026-09-09 the DGS applied the five-year window to everyone, Notre
Dame's own programs included. That no longer holds for the CSE MSCSE: the Graduate School treats
the CSE MSCSE and Ph.D. as one graduate program (2026-09-22, 2026-10-03), so a Ph.D. student's own
MSCSE coursework is not transfer credit and §5.2's window does not apply to it. What applies
instead is Academic Code §5.5's five-year interruption (DGS 2026-10-06): when five years or more
separate the MSCSE from the Ph.D., every MSCSE course counts only once the DGS reviews it and the
Graduate School approves. A master's in another Notre Dame department keeps §5.2's window.

**What the window dates (policy review round 3, P3-cross-doc-6).** §4.2 dates the window by the
degree — "Courses from a M.S. degree earned … within the last five years prior to admission" —
while §5.2 and Academic Code §4.6 date each course: "the courses were completed within a
five-year period prior to admission". A master's finished four years ago from courses taken six
years ago passes §4.2 and fails §5.2 for those courses. The app follows the course dating, as
the Code does.

**Suggested revision.** Make the two sections agree, and test the course, not the degree. If
§5.2's "or while enrolled" clause is meant to cover a Notre Dame student's own earlier program,
§4.2's sentence could read: *"Courses completed within the five years before admission, from an
M.S. program at Notre Dame or another institution, may be used … (See Section 5.2.)"*. If the five-year limit is meant to apply to
everyone, §5.2's clause should be narrowed to say what it is for. The Graduate School owns
§5.2's text, so this one may have to go to them. Either way, the handbook should say what the
app now does for a returning MSCSE graduate: the MSCSE's coursework counts as Ph.D. coursework,
unless five years or more separate the two, when the DGS reviews it and the Graduate School
approves (Academic Code §5.5).

---

## 3. §4.5 — the student who already holds the MSCSE

**Today.** §4.5 says the candidacy exam "can be used by Ph.D. students to satisfy both the M.S.
thesis requirement and the Ph.D. candidacy exam simultaneously, thus earning the MSCSE degree on
successfully passing the candidacy exam." §3.1 notes that Ph.D. students "are also awarded an
MSCSE degree". Neither contemplates a student who earned the MSCSE at Notre Dame first — which
is the normal path out of the Integrated B.S. + M.S. programme in §3.5.

**What the app does (DGS, 2026-09-09).** The along-the-way row is left out of that student's
report entirely.

**Suggested sentence.** In §4.5: *"A student who already holds the MSCSE from Notre Dame is not
awarded it a second time."* Worth pairing with a note on what such a student's candidacy exam
does have to satisfy, since the M.S. thesis requirement is already behind them.

---

## 10. §4.5 — whose eighth semester: the student who came from the MSCSE

**Today.** §4.5 says the candidacy exam "must be taken before the end of the eighth semester in
the program." For a student who started in the MSCSE and transferred into the Ph.D., or who
finished the MSCSE and then entered the Ph.D., "the program" is ambiguous: the graduate program
in CSE, or the Ph.D. program?

**What the app does (DGS, 2026-09-26).** A finished MSCSE does not count: the eight semesters
run from the Ph.D. entry. A transfer into the Ph.D. before finishing the MSCSE keeps the MSCSE's
clock: the eight semesters run from the MSCSE start. The same entry term starts every §4 clock
(residency, the eight years, the qualifier's semester, the eighteen months) — the DGS confirmed
this for the transfer student: "all clocks start at the MSCSE".

**Suggested sentence.** In §4.5: *"Semesters are counted from the student's admission to the
Ph.D. program, or, for a student who transferred into the Ph.D. from the MSCSE without
completing it, from the admission to the MSCSE."* And a sentence in §4.3 and §4.4 saying whether
the residency count, the eight-year limit and the qualifying-examination deadline are counted
the same way (the DGS's practice: they are).

---

## 4. §3.5 and §5.2 — the 4+1 student's senior-year graduate courses

**Today.** §3.5 lets an Integrated B.S. + M.S. student take "one or two 3-credit CSE courses at
the 6xxxx level" in the second semester of the junior year and the senior year and "count these
both as undergraduate CSE electives/Tech electives and as course requirements for the MSCSE
degree", plus further 6xxxx courses in the senior year not used for the B.S. But §5.2's
criterion 2 requires that "the student had graduate student status when they took these
courses".

**Why it comes up.** Those senior-year courses are genuinely part of an awarded Notre Dame
MSCSE. When that student goes on to the Ph.D., §5.2 appears to bar exactly the courses §3.5
allowed.

**ANSWERED by the Graduate School (through the DGS, 2026-09-10, evening) — and the answer is much
broader than the question.** Verbatim: *"Any 60000-level and above coursework taken as an
undergraduate, not being used to fulfill undergraduate degree requirements can be used to satisfy
both the master's and the PhD. Notably, such credits are counted towards the PhD, even those above
and beyond the usual 24 allowed for transfer. The only hard constraint is that the same course's
credits cannot count towards three degrees (BS, MSCSE, PhD) at the same time. … up to two 40000-level
courses taken by ND undergraduates can count towards both BS and MSCSE. … an ND 4+1 student can have
up to 6 credits (whether 40xxx or 60xxx courses) counted towards both degrees. … up to 6 credits from
40xxx courses can count towards PhD."*

So §5.2 criterion 2 does not bar this coursework, and the credits do not pass through §5.2 at all.
The app implements it.

**Three Graduate School texts that do not agree with each other (policy review 2026-10-02,
P1-transfer-eligibility-c7 — for the committee to put to the Graduate School).** The Academic
Code's §4.6 (last paragraph) is uncapped: *"With advanced approval from the graduate program of
study, [a Notre Dame undergraduate] may use this coursework to meet graduate program requirements.
These credits cannot be used to satisfy both undergraduate and graduate degree requirements"* — the
only six it names is the integrated program's double-count allowance. The DGS Handbook's §3.14
instead says such a student *"may request to transfer up to six hours of this coursework"*, and the
Graduate School's 4+1 guidance says the extra credits *"must be officially transferred"* (moved
UG→GR before the bachelor's is conferred). The Code governs, and the app follows it — with the
UG→GR move confirmed by the DGS since 2026-10-03, and, on the MSCSE, only for a student admitted to
the integrated program before the bachelor's was awarded (DGS 2026-10-04; item 17 below). Since
2026-10-07 neither the admission term nor §3.5's window limits a course the bachelor's did not use:
a 4+1's graduate course the bachelor's did not use counts toward the MSCSE from any undergraduate
term, even before the admission; the window (from the junior spring) limits only the one or two
courses shared with the bachelor's (the DGS, on the Graduate School's email answer: *"Any graduate-level coursework a student
may have taken as an undergraduate that was not used to satisfy the bachelor's degree could
theoretically be used towards both the master's and the PhD"*, for 4+1 students only). The 4+1
guidance's *"have graduate student status at the time the course was taken"* reads the other way,
so the committee may want the Graduate School to put that answer in writing, and to reconcile the
six-hour sentence and the "transfer" framing with the Code.

**What the handbook should now say**, because none of this is in it:

- In §3.5 or §4.2: *"Coursework at the 60000 level or above taken while an undergraduate at Notre
  Dame may be counted toward both the MSCSE and the Ph.D., in addition to the transfer credit allowed
  by Section 5.2. Up to six credits of 40000-level coursework taken as an undergraduate may count
  toward the Ph.D. course requirement."*
- And the constraint, which belongs somewhere prominent: *"No course's credits may count toward three
  degrees. A course counted toward both the bachelor's degree and the MSCSE cannot also be counted
  toward the Ph.D."*
- In §3.5, the department's own limit: *"At most six credits may be counted toward both the bachelor's
  degree and the MSCSE."* — and that the six may be **40000-level** CSE courses, for any Notre Dame
  undergraduate: §3.5 names only 60000-level courses and the Academic Code's §4.6 only an integrated
  program's graduate-level credits. The rule rests on the Graduate School's written answer to the
  DGS (email from Maureen Collins, 2026-09-10; DGS 2026-10-03, policy review P1-units-4plus1-12) and
  should be written into §3.5 so students and the Graduate School read it in the same place.
- And the WINDOW's edges, which §3.5 leaves to the reader (DGS 2026-09-11): its sentence names "the
  second semester of the junior year and the senior year", which the app reads as the three
  fall/spring semesters ending with the term the bachelor's degree was awarded. Two cases the
  sentence does not decide — a student who graduates in December, whose three semesters end in the
  fall, and a course taken in the summer between the junior and senior years (the app counts it).
  Worth a clause: *"…in the second semester of the junior year and the senior year, counted as the
  three semesters preceding the conferral of the bachelor's degree."* Note also that the window is
  the MSCSE's alone: the Graduate School's rule for the Ph.D. names no term, so the same course can
  be outside §3.5 for the master's and inside the Ph.D.'s allowance.
- And the approval, which only the rules spreadsheet records today (2026-09-11): the Courses tab marks
  almost every 40000-level course `counts_toward_mscse = dgs_approval`, so the app counts such a course
  toward the MSCSE only provisionally and keeps it in the review request until the student records the
  approval. §3.2 should say so in its own words: *"A 40000-level course counts toward the MSCSE course
  requirement only with the approval of the student's advisor and the DGS."* The handbook currently
  leaves the reader to infer it from §3.2's silence.

**Two more answers from the Graduate School (through the DGS, 2026-09-22)**, verbatim: *"Only up to 6
credits may double-count towards two degrees. If 6 credits. have double-counted to BS & MS, no more
credits can double-count to BS & PhD later when the student pursues PhD. Also, in cases where a graduate
student moves from a master's program to a PhD program in the same discipline all the credits are
counted towards the PhD, even those above and beyond the usual 24 allowed for transfer."* And the DGS's
reading of the second: *"any 60xxx courses taken during MS (whether part of 4+1 or not) transfer to PhD
without needing any approval, even beyond the 24-credit limit."* The app implements both. What the
handbook should say:

- In §3.5 or §4.2: *"At most six credits may be counted toward two degrees. Credits counted toward
  both the bachelor's degree and the MSCSE reduce, credit for credit, what may later be counted toward
  both the bachelor's degree and the Ph.D."*
- In §5.2, which today reads as if a Notre Dame MSCSE were transfer credit ("These five requirements
  also apply to the transfer of credits earned in another program at Notre Dame"): *"Coursework from a
  Notre Dame MSCSE counts toward the Ph.D. in the same discipline in full, without a transfer request
  and outside the 24-credit limit; the requirements of this section govern coursework from other
  universities and from other Notre Dame programs."* Two edges the answer does not settle, which the
  app resolves in the Graduate School's favour and the handbook should confirm: whether §5.2's
  five-year window and B-or-better floor still apply to that coursework (the app applies neither —
  "all the credits"), and whether the same holds for a master's from another department at Notre Dame
  ("the same discipline" — the app treats only the MSCSE this way).

Until those sentences exist, this file is the only written record of a rule that decides how much
credit every 4+1 student arrives with.

---

## 5. §4.2 — courses below the 60000 level

**Today.** §4.2 allows "Up to six (6) credits from CSE 4xxxx". It says nothing about the 50000
level, where the §3.6 Transition to Computing bridge courses live (CSE 50501–50503).

**What the app does (DGS, 2026-09-09).** A CSE course below the 60000 level counts only if the
rules spreadsheet says it may, and then only inside the same six credits — 40000- and
50000-level courses share one cap. A sheet entry is a permission, not an exemption.

**Suggested sentence.** In §4.2: *"Up to six (6) credits from CSE courses below the 60000 level,
including bridge courses, may be used to satisfy the course requirement, subject to approval of
the student's advisor and the DGS."* §3.2 needs the matching change for the MSCSE.

---

## 6. §3.6 — the Ph.D. student on the Transition to Computing track

**Today.** §3.6 defines the bridge courses as "a set of bridge courses for students admitted to
the **MSCSE** who require additional background", and §3.6.1 requires twelve concurrent credits —
three CSE 50xxx courses plus a CSE 60xxx Integrative Computing Studio — adding that "CSE 50xxx
courses are preparatory and do not count toward the **MSCSE** degree requirements in §3.1–3.5".
Every sentence is about the MSCSE. §4 says nothing about bridge courses at all.

**Why it comes up.** The DGS requires some Ph.D. students to take them (2026-09-10). The handbook
neither authorises that nor says what those credits do toward the Ph.D.

**What the app does.** Whatever the rules spreadsheet says, course by course: today CSE 50502 may
count toward the Ph.D. with the DGS's approval, inside §4.2's six-credit allowance for courses
below the 60000 level, and CSE 50501 and CSE 50503 count nothing. None of the three counts toward
the Graduate School's sixty credits of "courses and research", so a student who has just finished a
required twelve-credit bridge year reads "0 of 60 credits complete".

**Suggested sentences.** In §3.6, after the first paragraph: *"The DGS may also require a student
admitted to the Ph.D. program to complete the Transition to Computing courses."* And in §3.6.1,
alongside the sentence about the MSCSE: *"For a Ph.D. student, CSE 50xxx credits count toward the
sixty credits required by the Graduate School but not toward the twenty-four credit hours of
regular courses in §4.2."* — or whatever the department decides those credits do; the app can
express either answer, but only once someone has decided. Worth saying too whether the bridge year
extends the §4.4 four-semester qualifier deadline, which today rests on the DGS granting an
extension case by case.

## 9. §4.4.3's eighteen months for a summer entrant

**Today.** §4.4.3 counts "18 months" from entering the program; §4.2's semester counts start, by
the department's own convention (decision Q17c), with the fall for a student admitted in a summer
session. The app runs the 18-month clock from that fall too (DGS 2026-09-11: "PhD students entering
in the summer semester is considered entering in the subsequent fall semester"), which for a June
entrant is about ten weeks later than the words "18 months" read.

**Suggested sentence.** In §4.4.3 or §2.1: *"For a student first enrolled in a summer session, the
program is deemed to begin in the following fall semester for every deadline in this handbook."*

---

## 7. Smaller wording points

- **§3.2 has no 60000-level floor in its own text** (red-team review, 2026-09-12). The app refuses an
  unlisted MSCSE course below the 60000 level and refuses non-CSE 40000-level courses, citing §3.2 —
  but the floor sentence exists only in §4.2 (Ph.D.), and §3.2's allowance ("up to six (6) credits at
  the 40000 level") names no department. The DGS confirmed both readings are the department's intent
  (2026-09-12: "caused by ambiguity in the handbook itself"). The fix belongs in §3.2: state the
  floor, and say whether the 40000-level allowance is CSE-only.

- **§4.4 "three components".** The qualifying examination has three components, but §4.4.1 alone
  produces three separate requirements (one core area each), so students read "three" as
  "three things to do" and count five. The audit calls the row "all components" for that reason.
  A parenthesis in §4.4 would do it.
- **§4.2's nine credits at Notre Dame.** "Regardless of any credits transferred, all Ph.D.
  students must take at least nine (9) credits at Notre Dame" — for a student who did their
  master's at Notre Dame, "at Notre Dame" has to mean "in the Ph.D. programme", which the
  sentence does not say. The audit reads it that way.
- **§5.2's timing rule.** "A request for credit transfer is considered only after a student has
  completed one semester in a Notre Dame graduate degree program and before the semester in
  which the graduate degree is conferred." The audit does not enforce this window, so a
  first-semester student may be told to send the request early. Worth a line in the student
  handbook about when to file rather than a change to §5.2.
- **Where the transfer request goes.** §5.2 says "the Graduate Program Coordinator"; the
  department calls the role the Graduate Program Administrator, and the app says "Grad Admin".
  Worth making the title consistent.
- **§3.4(i) names the wrong course for the M.S. project** (policy review round 3, P3-cse-3-3). It says the
  project is "carried out … over six (6) credit hours of CSE 68901", but §3.2 and the Banner titles have
  CSE 68901 as thesis direction and CSE 68902 as the project. §3.4(i) should read "six (6) credit hours
  of CSE 68902". The §3.4 hover text on the page quotes the sentence as it stands; the engine, the sheet
  and the page count CSE 68902 as the project already.
- **§5.2's window for a two-semester MSCSE** (policy review round 3, P3-import-4). A transfer request is
  considered only "after a student has completed one semester … and before the semester in which the
  graduate degree is conferred". For a student who enters in the fall and graduates in the spring, that
  window is effectively the winter break. Worth a sentence telling such a student to send the request
  as soon as the fall semester ends.

---

## 8. §4.2's six credits: credits, or two courses?

**Today.** §4.2 allows "Up to six (6) credits from CSE 4xxxx". The Graduate School's 2026-09-10
answer to the department used both units in one breath — "up to **two** 40000-level courses … up to
**6 credits**" — which are the same thing only while every such course is worth three credits.

**Why it comes up.** The Courses tab is not all 3-credit rows. Among CSE courses below the 60000
level that may count toward the Ph.D.: CSE 40151 and CSE 40152 are 1.5 credits, CSE 40881 and
CSE 40986 are 1 credit, CSE 44622 and CSE 40322 are 4, CSE 44793 is 5. So six credits can be
**four or more courses**, and a single 4- or 5-credit course is split — three of its credits count
and the rest do not.

**What the app does.** Six credits, the handbook's own unit (`phd_4xxxx_cse_credits_max`,
`ms_4xxxx_credits_max`), at credit granularity.

**Suggested sentence.** Whichever the committee means, say it once: *"At most six credits, and at
most two courses, from CSE courses below the 60000 level may count toward the course requirement."*
— or drop the course count from the Graduate School's phrasing and keep credits alone. The app can
express either; a second Parameters key would carry the course limit.

---

## 9. §3.5: whose approval, recorded where — and is the 6xxxx sharing staying?

**Today.** §3.5 begins *"**With approval of the instructor and DGS**, students in the integrated
B.S. + M.S. program may, over the second semester of their junior year and their senior year, take
one or two 3-credit CSE courses at the 6xxxx level, and count these both as undergraduate CSE
electives/Tech electives and as course requirements for the MSCSE degree."*

**Why it comes up.** The 2026-09-18 interface review asked why the shared-credit row reads **Met**
directly beneath that sentence. The answer is that §3.5's approval is about the **double-counting**
— permission for one student's CSE 60641 to be paid for twice — while the only approval the app can
see is the Courses tab's per-course verdict, which answers a different question: *may this course
count toward the MSCSE at all?* For 123 of the live sheet's 129 CSE 6xxxx rows that answer is a
plain `yes`, so the app has nothing to hold the row open with. Nothing anywhere records that an
instructor and the DGS approved the sharing, and the DGS review request never asks.

**What the app does.** Reports the row as satisfied once the credits fit inside the six, naming the
courses. The DGS chose this on 2026-09-18 (decision A: leave it), because the sharing itself may be
withdrawn from the handbook — see below.

**What the committee needs to settle.**
1. **Is §3.5's 6xxxx double-counting staying?** The DGS noted on 2026-09-18 that it may be dropped.
   If it goes, this row goes with it and the question below is moot.
2. **If it stays: who approves, and where is it written down?** "The instructor and DGS" is two
   people and no record. Either name a form the Grad Admin files (which the app could then ask the
   student to confirm, as it does for §3.2/§4.2 and §5.2), or say plainly that registering the
   course in the junior/senior year IS the approval, in which case the sentence should not read as
   a condition the student must separately obtain.


## 10. What the policy-compliance review of 2026-10-02 found the handbook does not say

The review of the engine against the Graduate School's Academic Code, the DGS Handbook and the
4+1 guidance (fixes applied 2026-10-03, `docs/DECISIONS.md`) left these for the handbook's own text,
not the app's:

1. **The bachelor's + Ph.D. six credits.** §4.2 is silent; the Graduate School's 2026-09-22 answer
   to the department allows six credits to count toward a Notre Dame bachelor's and the Ph.D., but
   the Academic Code's §4.6 writes its six-credit exception for an integrated bachelor's/MASTER'S
   program only. The app now counts such a course provisionally and asks the DGS to confirm. The
   handbook should state the rule (or the Graduate School should), so the DGS is not confirming it
   student by student.
2. **The UG→GR move for 4+1 coursework.** The Graduate School's guidance requires the extra graduate
   courses to be moved from undergraduate to graduate registration, with the advising dean's and
   the Graduate School's approval, before the bachelor's is conferred. §3.5 never mentions the
   form. A sentence naming it — and that the shared one or two courses do not need it — would let
   students (and the app) read the transcript instead of asking.
3. **§3.5's "senior year" and "CSE".** The September text lets the shared courses come from the
   junior spring onward but the additional ones only from the senior year, and names CSE courses
   both times. Is a junior-spring course that is NOT shared really excluded, and is a non-CSE
   6xxxx course really outside §3.5? The app treats both as the ADGS's to approve.
4. **The qualifier extension.** §4.4 says "the DGS may extend the deadline" without a unit. The
   DGS reads it as any number of semesters (2026-10-03); the handbook could say so.
5. **Which start the clocks use after an MSCSE → Ph.D. transfer.** §4.4 says "of starting"; the
   DGS reads the qualifier clocks from the transfer and §4.3/§4.5 from the MSCSE entry
   (2026-09-26, 2026-10-03). Two different starts for one student deserve a sentence.
6. **MSCSE and Ph.D. as one graduate program.** The Graduate School's position (DGS 2026-10-03)
   decides how an unfinished MSCSE's credits, and a 4+1's MSCSE courses, count toward the Ph.D. —
   none of it is in §4.2 or §5.2.
7. **The Graduate School's steps the handbook leaves implicit** — RCR training before candidacy
   (Academic Code §6.2.4), the application-for-candidacy form and its calendar deadline (§6.2.9),
   the official submission of the dissertation as the act that completes the degree inside the
   eight years (§6.2.12), dissertation completion status after the eighth year (§6.2.6.1), the
   30 + 14 days of an Incomplete (§4.4), leaves and accommodations extending the limits (§5.1,
   §5.4) — are now rows or inputs in the app. §4 could point to them in one paragraph.
8. **Transfer credit timing and finality.** §5.2 says neither that the Graduate School considers a
   transfer only after the first semester nor that the credit is final only when the Graduate
   School has approved it (its criterion 5 implies the second). The app says both.
9. **Three transfer cases no document caps** (for the Graduate School as much as the committee):
   the Academic Code's §4.6 and CSE §5.2 state six credits for an unfinished MASTER'S and 9/24
   for a completed degree. They say nothing about (a) an unfinished Ph.D. elsewhere, (b)
   graduate courses taken outside any program by a student with no earlier graduate program, and
   (c) a student with TWO earlier programs — one finished and one not, say — where it is not said
   whether the allowances add up, share one ceiling, or each keep their own. The app uses the six
   as the conservative default in (a) and (b), says so on the §5.2 row, and (for b, DGS
   2026-10-03) holds every such course for the DGS; for (c) it holds every course from either
   program for the DGS (2026-10-07, policy review round 3, P3-prior-programs-3). The handbook
   should state the figures once the Graduate School has answered.
10a. **§4.2's "at least nine credits of regular courses at Notre Dame".** The DGS reads it as nine
    credits earned during the graduate program (2026-09-13), and, because the Graduate School treats
    the MSCSE and the Ph.D. as one graduate program, a 4+1's fifth-year MSCSE courses count while
    their senior-year (pre-bachelor's) courses do not (DGS 2026-10-03, P1-units-4plus1-c8). The
    sentence could say "during the graduate program" so the two readings of "at Notre Dame" stop
    needing a ruling.
10. **The flat 60.** §4.2 attributes "a total of sixty (60) credits of courses and research" to the
    Graduate School, but the Academic Code's §6.2.1 requires "sixty (60) credit hours, or a minimum
    of 30 credit hours beyond a previously awarded master's degree" and lets programs require more.
    The department's 60-for-everyone is therefore the department's own, stricter rule (with the
    24-credit transfer cap, a student with a prior master's earns at least 36 at Notre Dame). §4.2
    should say it is the department's requirement rather than the Graduate School's.
11. **§4.4.2's "category specialization course GPA".** On a retaken or substituted course, "the original
    grade will be replaced by the new grade for purposes of computing the category specialization course
    GPA" — but no such GPA is defined anywhere, and no threshold for it is stated; the only test the
    handbook gives is "each B or higher". The app applies the per-course B and replaces a retaken grade
    (policy review P1-gpa-13; DGS 2026-10-03, "apply the suggested fix"). §4.4.2 should either define the
    aggregate and its threshold or say "the grade used for the B requirement".
12. **§3.4 and Academic Code §6.1.5 — is the project or thesis the master's examination?** The Code
    requires "an oral and/or written master's examination" by the end of the term after the coursework,
    allows "an equivalent requirement in lieu" (DGS Handbook §3.21.2), forfeits eligibility on a fail
    "unless the program recommends a retake", and allows one retake by the end of the following
    semester. §3.4 never says the project report or the thesis defense IS that examination, nor whether
    the one-term timing applies to it. The app reads them as the examination (policy review
    2026-10-04, P2-ac-5b-6.1-11 and -12: a note once that term is over, and one dated retake after a
    failed thesis defense); §3.4 should say so in one sentence, and say how a failed project report is
    handled, if at all.
13. **§3.4(ii) — who approves the thesis topic?** Academic Code §6.1.7: "With the approval of his or her
    advisor, the student proposes a thesis topic for program approval" — and §6.1.6 makes "program
    approval of his or her thesis" a condition of master's candidacy. CSE §3.4(ii) names only the
    advisor ("propose an M.S. thesis topic with the approval and supervision of their research advisor").
    The app records one date, "Thesis topic approved", as a step before the defense (policy review
    2026-10-04, P2-ac-5b-6.1-14). §3.4 should say whether the program's approval is the advisor's, the
    ADGS's or a committee's, and how it is recorded.
14. **§3.3 — seven years for a summer-session-only master's student?** Academic Code §6.1.4 (and the
    DGS Handbook §3.19, §3.21.1): "A student attending summer session only must complete all
    requirements within seven years." CSE §3.3 says five years, flat. The app now names the seven years
    on the time-limit row when every Notre Dame term on the record is a summer session, and asks the
    ADGS whether they apply, instead of reading Overdue after five (policy review 2026-10-04,
    P2-dh-3.21-3.24-3). §3.3 should say whether the MSCSE admits summer-session-only students at all,
    and if it does, give them the seven years in its own text.
15. **§3.4 — the readers' written request: to the DGS or the ADGS?** §3.4 says a non-TTT or outside
    thesis reader needs prior approval "by submitting a written request to the DGS", while the rest of
    §3 sends MSCSE approvals to the ADGS (§2.3's advisor exception, §3.2's 40000-level and non-CSE
    courses). The app asks the student whether both readers are tenured or tenure-track CSE faculty and
    neither is the advisor, and on "no" or "not sure" sends the question to the ADGS, as it does every
    MSCSE decision (policy review 2026-10-04, P2-dh-10-19; decider rule of 2026-09-11). §3.4 should
    name the ADGS if that is who approves.
16. **§3.3 — what is full-time in a summer session?** §3.3 lets the MSCSE's residency be "one summer session" in
    full-time status but never says what full-time means in a summer; §2.1.2's nine credits are "per semester". The
    Graduate School's form instructions do (DGS Handbook §10.3.2: "may include summer session if the student is
    registered for six or more credits"), and the app now applies six through the Parameters key
    `summer_fulltime_credits_min` (DGS 2026-10-04, P1-page-text-ui-9), besides Academic Code §3.6's summer beside a
    full-time spring or fall. §3.3 should say "a summer session of six or more credits" in its own text.
17. **§3.5 — when must a 4+1 student have been admitted?** The Graduate School's 4+1 guidance counts graduate
    coursework beyond the six shared credits only for "recognized dual-degree students", who "apply to the graduate
    program during their junior year for matriculation in their senior year, or at the latest, applying in the first
    semester of their senior year and matriculation in the second semester of their senior year", and "only six
    credits" for one who "starts the graduate program after the bachelor's degree has been awarded". §3.5 says students
    "may apply to this program by the application deadlines stated on the CSE Web site. This would typically be at the
    end of the fall semester of the senior year for students who will participate in undergraduate commencement in the
    Spring semester and enter the graduate program the following fall" — the guidance's latest route, but with entry the
    following FALL, after the bachelor's, where the guidance has matriculation in the senior spring. The two should be
    reconciled: which term a CSE 4+1 admission names decides whether senior-spring graduate courses count beyond the six.
    The app asks an MSCSE 4+1 student the admission term and counts the extras only from it (policy review 2026-10-04,
    P2-fourplusone-1; round 3, P3-fourplusone-4). §3.5 should say so in one sentence.
18. **§2.3 — must an M.S. *project* advisor be tenured or tenure-track?** §2.3 says "A research advisor must be a
    Tenure and Tenure Track (TTT) faculty member of the department", and the Graduate School's adviser criteria (DGS
    Handbook §10.3.2, §10.3.8) are written for "a research master's" — the thesis. Neither says whether the MSCSE
    project option's advisor is held to the same rule. The app now asks the advisor's faculty status on the thesis option
    only and sends a "no" or "not sure" to the ADGS (policy review 2026-10-04, P2-dh-10-5). §2.3 should say whether the
    TTT rule covers a project advisor.
19. **§4.5 / §2.2 — what “coursework complete” means for candidacy, and transferred credits.** The Graduate School's
    candidacy application counts coursework as "Course credits completed/required (GPA hours only)" (DGS Handbook
    §10.3.1), and transferred grades are never GPA hours (§5.2: "No grades of transferred courses are included in the
    student's GPA"; Academic Code §4.5). The DGS ruled on 2026-10-05 that transferred regular-course credits count toward
    the 24 for the OCE and for admission to candidacy, and the app says so on the card. The handbook should say it too,
    so the department's count and the Graduate School form's agree.
20. **§4.5 — who authorizes a retake of the candidacy exam.** §4.5 has the DGS authorize a retake on the examiners'
    recommendation. The Graduate School's procedures say "the department chair, on the recommendation of a majority of
    the examiners, may authorize a retake" (DGS Handbook §10.5.2), and both need the Graduate School's approval. §4.5
    should name the same officer, or say the chair has delegated it to the DGS.
21. **§4.5 — which leaves and accommodations move the eight-semester deadline.** §4.5 counts “eight semesters from the start of
    the program” and says nothing about leaves or the childbirth/adoption accommodation; the Graduate School counts the “eighth
    semester of enrollment” (Academic Code §6.2.8) and lets a student take the accommodation in the semester after the birth
    (DGS Handbook §3.7.2). The DGS ruled on 2026-10-05: only a leave before the end of the eighth semester of enrollment moves
    the deadline, and an accommodation moves it when the birth or adoption is in or before that semester, even if taken in the
    semester after. The handbook should say so.
22. **§3.2 / §4.2 — an early start’s summer courses.** Admissions are in fall and spring, and the Graduate School treats a
    full-time admit who starts in the summer as a full-time student that summer (Academic Code §3.6). The handbook does not
    say whether the courses of that summer count toward the degree, or that the clocks and residency still start in the fall.
    The DGS ruled on 2026-10-05 that they count as the program’s coursework, while every clock, the §5.2 window and residency
    run from the fall (policy review round 3, P3-chg-other-1). §3.2 and §4.2 should say so in a sentence.
23. **§4.5 — a readmitted student’s eighth semester.** §4.5 counts “the eighth semester in the program”; the Graduate School
    says “eighth semester of enrollment” (Academic Code §6.2.8; DGS Handbook §3.22.1), which reads as skipping the semesters a
    withdrawn student was away. The DGS ruled on 2026-10-06 that the clock counts calendar semesters regardless of the gap, and
    that the Graduate School can approve an exception when the DGS requests one (policy review round 3, P3-ac-6.2-app-1).
    §4.5 should say so, since the Graduate School’s own wording points the other way.
24. **§3.3 / §4.3 — which leaves stop the time limit.** The handbook says nothing about leaves. The Graduate School’s
    two documents disagree: the Academic Code stops the eight-year clock only for “approved medical leave(s) and/or approved
    childbirth accommodation(s)” (§6.2.6), while the DGS Handbook says “Only a leave of absence will stop the clock”, of
    any kind (§3.4, §3.7.2). The DGS ruled on 2026-10-06 to follow the Code, for the Ph.D. and the MSCSE alike (policy
    review round 3, P3-cross-doc-1). §3.3 and §4.3 should say so in a sentence, and the conflict is worth raising with the
    Graduate School.
25. **§4.5 — an exam held before the coursework was complete.** §4.5 makes the coursework a precondition (“must be completed
    (or in progress the same semester) before the candidacy exam can be taken”) but does not say what happens when an exam was
    held without it — whether the pass stands, and who decides. The DGS ruled on 2026-10-06 that the coursework is checked as of
    the exam’s semester, and that the DGS confirms an exam held short of it before the student applies for candidacy (policy
    review round 3, P3-cse-4b-1). §4.5 should say who confirms such an exam, or that the committee checks the coursework before
    the exam is scheduled.
26. **§4.4 — a component completed after the four semesters.** §4.4 says the components must be complete within four
    semesters and that “the DGS may extend the deadline”, but not what happens to a component finished late with no
    extension on record — whether it counts, and whether the extension can be granted after the fact. The DGS ruled on
    2026-10-06 that a core-knowledge or specialization course completed late waits for the DGS to confirm an extension, as
    a late research pass does (policy review round 3, P3-cse-4a-2, option A). §4.4 should say so, and say that the
    deadline is read from the semester the component was first complete.
27. **§3.3 — when do the master's five years start, and does a readmission restart them?** None of CSE §3.3, Academic
    Code §6.1.4 or DGS Handbook §3.19 says. The Ph.D.'s eight years run "from the time of matriculation" (Academic Code
    §6.2.6); for the MSCSE the app counts the five years from the original entry term, through a readmission, with the time
    away included (DGS 2026-10-04, 2026-10-06; policy review round 3, P3-dh-3.1-3.13-4). §3.3 should say so.
28. **§4.2 / §5.2 — which admission starts the five-year transfer window?** §5.2 and the Academic Code (§4.6) count
    back from "admission to a graduate degree program at Notre Dame"; §4.2's "prior to admission" can be read as the Ph.D.
    admission. For a student who finished the Notre Dame MSCSE before the Ph.D. the two differ by the length of the MSCSE.
    The DGS ruled on 2026-10-07 that the window counts back from the MSCSE admission — the student's first admission to a
    Notre Dame graduate program — since the Graduate School treats the CSE MSCSE and Ph.D. as one program (policy review
    round 3, P3-prior-programs-4). §4.2 and §5.2 should say "the first admission to a Notre Dame graduate program".
29. **§2.3 — whose exception, for which advisor?** §2.3 says “A research advisor must be a Tenure and Tenure Track (TTT)
    faculty member of the department. Exceptions to this policy require approval of the DGS”, which reads as though the
    DGS could approve a non-tenure-track advisor alone. The graduate studies committee settled it on 2026-10-07 (chaired by
    the DGS): an advisor who is not tenured or tenure-track cannot advise a student alone — a tenured or tenure-track
    co-advisor is required, as the Graduate School requires too (DGS Handbook §10.3.1, §10.3.2; Academic Code §6.2.7); the
    DGS’s exception is for a tenured or tenure-track advisor from another Notre Dame department (policy review round 3,
    P3-cross-doc-2). §2.3 should say so in the next edition.
30. **§3.1 — what “reviewed and decided by the DGS” means for the MSCSE along the way.** The September 2026 sentence
    reads as a separate review by the DGS of every along-the-way award. The DGS meant the department’s self-check: when it
    shows the student eligible and every requirement met, that is the DGS’s review, and the Grad Admin processes the award
    directly (DGS 2026-10-07, policy review round 3, P3-cse-3-2). The next edition could say “reviewed and decided by the
    DGS through the department’s degree self-check”, so a reader does not wait for a second decision.
31. **§5.2 — which admission makes a course “after admission”?** The Graduate School requires “prior approval of the
    department and the Graduate School for formal courses taken elsewhere and applied to the degree program after the
    student’s admission to Notre Dame” (DGS Handbook §3.14); CSE §5.2 does not carry the sentence. For a student who
    finished the Notre Dame MSCSE and then entered the Ph.D., the admission could be the MSCSE’s or the Ph.D.’s. The DGS
    ruled on 2026-10-30 that it is admission to the program the credit goes into: for Ph.D. credit, the Ph.D. admission
    decision (the DGS cites Academic Code §2.1: admission to the doctoral program is a separate decision). A course
    taken elsewhere after the Ph.D. offer and before matriculation needed that approval; one taken before the offer did
    not. The app reads this from the semester of the admission letter, for a Notre Dame MSCSE holder only. §5.2 could add
    the sentence with “admission to the Ph.D. program” written out. This is the DGS’s reading, not a Graduate School
    ruling: confirm it with them the first time real credit depends on it. Still open: a master’s finished elsewhere
    whose last semester ends after the Ph.D. offer. Read literally, those courses were completed after admission; the
    app does not hold them (DGS 2026-10-30, option 1).
