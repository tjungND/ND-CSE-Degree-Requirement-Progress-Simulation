// Student-side data model. See docs/DECISIONS.md for every interpretation choice.
// The engine is pure: audit(student, rules, today) — no DOM, no fetch, no Date.now().
import type { CourseMark } from './allocate.ts';
import type { SpecialTrack } from './tracks.ts';

export type Program = 'mscse' | 'phd';

/** §3.4 — "the M.S. project or thesis requirement can be satisfied in one of two ways". */
export type MsOption = 'project' | 'thesis' | 'undecided';

export type Season = 'spring' | 'summer' | 'fall';

export interface Term {
  season: Season;
  year: number;
}

/** IP = in progress (registered, no final grade yet). S/U = satisfactory/unsatisfactory.
 * I = Incomplete and W = withdrawn (Academic Code §4.3), kept since 2026-10-03
 * (policy review): both are REGISTRATIONS the full-time count must see (§3.3),
 * neither earns credit — an I becomes an F 30 + 14 days after grades were due
 * (§4.4) unless the Graduate School extended it, and the classifier says so. */
export type Grade =
  | 'A' | 'A-' | 'B+' | 'B' | 'B-' | 'C+' | 'C' | 'C-' | 'D' | 'F'
  | 'S' | 'U' | 'IP' | 'I' | 'W'
  // An audit (Academic Code §2.4: "A recorded audit is graded V"; §4.3) —
  // earns nothing and is not a registration toward full-time status (DGS
  // Handbook §3.12). Policy review 2026-10-04, P2-ac-1-3-6 / P2-ac-4-10.
  | 'V';

export type CoreArea = 'os' | 'algorithms' | 'architecture';
export type CategoryGroup = 'alg' | 'hcc' | 'arch' | 'dsai' | 'sys';

export interface CourseEntry {
  /** 'CSE 60641' — or free text for non-CSE / unknown courses (decision Q6). */
  courseId: string;
  title?: string;
  credits: number;
  term: Term;
  grade: Grade;
  origin: 'nd' | 'transfer';
  /** transfer-only */
  institution?: string;
  /** transfer-only: which uploaded transcript (degree level) the course came
   * from. Bachelor's coursework can satisfy §4.4.1 core knowledge but can never
   * transfer credit — §5.2 requires graduate courses taken with graduate
   * student status. Absent on manual transfer entries (treated as graduate).
   * Also set on Notre Dame courses taken BEFORE the entry term (2026-09-05):
   * a Notre Dame transcript that includes an earlier degree yields prior
   * coursework — origin 'transfer', institution "University of Notre Dame",
   * level from the transcript's UG/GR column. */
  degreeLevel?: 'bachelors' | 'masters' | 'phd';
  /** Notre Dame transcript rows (2026-09-05): the level the student was
   * registered at (the transcript's UG/GR column). Kept so a course can be
   * re-sorted between program coursework and prior coursework whenever the
   * entry term changes — the level, not the term, decides bachelor's vs
   * master's prior coursework. */
  registeredLevel?: 'undergraduate' | 'graduate';
  /** The DGS approved THIS course for this student (DGS 2026-09-27). Ticked
   * on the course itself; the engine honours it only on a course the sheet
   * decides case by case (`dgs_approval` / `adgs_approval`) — a course the
   * sheet says `yes` to needs no tick, and a course not in the sheet cannot
   * be settled by one (it goes to the DGS through the review request first). */
  dgsApproved?: true;
  /** The DGS's ruling on a course HELD by a record-level fact — a readmission,
   * an interruption of five years or more, a separated Notre Dame MSCSE,
   * non-degree status or Notre Dame coursework before admission — recorded by the course's
   * box while the course is held (policy review round 5, item 29; DGS
   * 2026-10-14: option (b)). Only this releases the hold: a `dgsApproved`
   * tick given earlier for the case-by-case question did, with a note saying
   * the DGS had confirmed the hold. The box sets both (the DGS's answer to the
   * review request covers every reason it lists). */
  dgsHoldApproved?: true;
  /** A Notre Dame course that ALSO counts toward the student's other degree
   * program, for a student enrolled in two at once (Academic Code §2.2: "No
   * more than nine credit hours of classes from any one master's degree may be
   * counted toward any other graduate degree"; policy review 2026-10-04,
   * P2-ac-1-3-2). Honoured only while `Student.concurrentDegree` is true. */
  sharedWithOtherDegree?: true;
  /** True on every row the Notre Dame transcript import added (2026-09-06) —
   * program courses, pre-entry prior coursework and the transcript's own
   * transfer-credit block alike — so the "Remove" button next to that import
   * can take back exactly what it added and leave hand-entered rows alone.
   * Absent on rows saved before this flag existed; those are removed one by
   * one in the table, as before. */
  fromNdTranscript?: true;
  /** Transfer rows only: credit the student's Notre Dame graduate record
   * already shows as accepted — a row of the Notre Dame transcript's "Transfer
   * credit accepted" block (policy review round 3, P3-import-1; DGS 2026-10-05:
   * Option 1). The block dates each row by the Notre Dame term the credit was
   * RECORDED (`term`), not the term it was taken, and prints the hours Notre
   * Dame recorded (`credits`, already in Notre Dame credits); `level` is the
   * record it sits on (a combined transcript also has an undergraduate block —
   * AP and other credit accepted for the bachelor's), absent when the transcript
   * does not show it; `institution` is the name as the block prints it. Set by
   * the Notre Dame import on the row it adds — or, when the same course was
   * already entered from the other university's transcript, on that row
   * instead (one course, either order); removed with that import. */
  ndPosted?: NdPosting;
  /** True on every row an external transcript import added when that
   * transcript was marked UNOFFICIAL (DGS 2026-10-03, P1-transfer-eligibility-16):
   * the three generated emails then say which transcripts (bachelor's,
   * master's, prior Ph.D. — the row's degreeLevel) were unofficial copies, since
   * §5.2 adds credit only on an official transcript. */
  fromUnofficialTranscript?: true;
  /** Transfer rows only (P1-transfer-eligibility-7, 2026-10-03): the grade as
   * the transcript PRINTED it when the app could not map it to its own scale
   * (a numeric or foreign mark) and the student chose the letter. The course
   * line then says the letter is the student's own reading, for the DGS to
   * check against §5.2's B. */
  transcriptMark?: string;
  /** transfer-only: §4.4.1 core area the student claims this course satisfies (decision Q12).
   *
   * Deprecated 2026-09-03 (the claim path is retired — the DGS's
   * ExternalCourses rulings decide §4.4.1). Kept so old saved/imported
   * student files still load; the engine ignores it. */
  claimedCoreArea?: CoreArea;
  /** Only meaningful where the rules sheet lists the course under SEVERAL
   * groups, so the student's pick decides which one it fills (decision Q2).
   * ('any' was the old way of saying "all five"; retired 2026-09-18.) */
  assignedGroup?: CategoryGroup;
  /** Which degrees this course's credits have ALREADY been counted toward —
   * asked of the student, per course, for Notre Dame coursework taken in or
   * before the term their bachelor's degree was awarded (Graduate School via
   * the DGS, 2026-09-10 evening).
   *
   * The Graduate School's answer: 60000-level and above taken as an
   * undergraduate counts toward the master's AND the Ph.D., beyond §5.2's
   * twenty-four; up to six credits of 40000-level B.S. coursework counts
   * toward the Ph.D.; and the one hard limit is that no course may count
   * toward all three degrees. So what the audit needs from the student is
   * simply which degrees each such course has been spent on.
   *
   * `undefined` = not answered, and nothing is counted on a guess. A Ph.D.
   * student who holds no Notre Dame master's is never asked: with two degrees
   * in play, no course of theirs can already have counted toward two. */
  countedToward?: 'bs' | 'mscse' | 'both' | 'neither';
  /** transfer-only: the credit system the TRANSCRIPT itself announced
   * (2026-09-11 — "Fall Quarter 2023", "Quarter Units"). Read at import,
   * correctable in the preview. A `credit_system` cell in the DGS's
   * ExternalCourses tab for the university always wins over it. */
  creditSystem?: 'quarter' | 'semester' | 'trimester';
  /** transfer-only: the STUDENT chose `creditSystem` in the import preview —
   * the transcript reader had not read it there (DGS 2026-10-10, item 3). The
   * report then says "you chose quarter terms", not "your transcript says". */
  creditSystemChosen?: true;
  /** Where the row came from (DGS 2026-10-11, item 6: the processing request
   * and the advisor summary label each course): the transcript import that
   * added it — `transcript` is 'nd' for the Notre Dame transcript, else the
   * slot it was imported into — the date (Notre Dame's calendar) and the app
   * build that read it (src/ui/build-info.ts — the transcript reader is part
   * of the app, so the build names the reader). Absent on a typed row and on
   * rows saved before 2026-10-11 (`fromNdTranscript` still marks an older
   * Notre Dame import). The engine never reads it. */
  imported?: { transcript: 'nd' | 'bachelors' | 'masters' | 'phd'; on: string; app: string };
  /** What the student changed in the import preview before adding the row:
   * the fields where the row added differs from what the reader read. */
  changedOnImport?: ImportedField[];
  /** Added by hand with "Add a course" (DGS 2026-10-11, item 6). */
  typedByStudent?: true;
}

/** A field of an imported row the student can correct in the preview. */
export type ImportedField = 'course' | 'title' | 'credits' | 'term' | 'grade' | 'level';
export const IMPORTED_FIELDS: readonly ImportedField[] = ['course', 'title', 'credits', 'term', 'grade', 'level'];

/** ISO dates (YYYY-MM-DD), all optional — milestones are dates, not checkboxes. */
export interface Milestones {
  advisorIdentified?: string;
  advisorName?: string;
  /** A second advisor (co-advisor), when the student has two (DGS 2026-09-22). */
  advisorName2?: string;
  /** Ph.D.: is the advisor (and the co-advisor) tenured or tenure-track CSE
   * faculty, as the student answers it (CSE §2.3; Academic Code §6.2.7 —
   * policy review 2026-10-04, P2-ac-6.2-app-8). */
  advisorTtt?: 'yes' | 'no' | 'unsure';
  advisorTtt2?: 'yes' | 'no' | 'unsure';
  researchQualifierPassed?: string; // §4.4.3
  /** §4.4.3: the advisor filed a FAIL — the DGS's committee then has six
   * months for its final judgement (policy review, 2026-10-03). */
  researchQualifierFailed?: string;
  qualifierFormFiled?: string; // §4.4
  candidacyPassed?: string; // §4.5
  /** Admitted to doctoral candidacy by the Graduate School — a step of its own
   * after the OCE (Academic Code §6.2.9; DGS Handbook §3.22.3; DGS 2026-10-04:
   * "OCE and doctoral candidacy are two different things"). */
  candidacyAdmitted?: string;
  /** Academic Code §6.2.4: the Responsible Conduct of Research and ethics
   * training modules are required of every Ph.D. student, and the DGS
   * Handbook (§3.22.3) lists them among the conditions for admission to
   * candidacy (policy review, 2026-10-03). */
  rcrTrainingCompleted?: string;
  // `dissertationApprovedForDefense` (§4.6) was removed on 2026-10-04 (DGS:
  // the committee approves the dissertation and passes the defense at the
  // same time — the defense date stands for both); a saved file that still
  // carries it loads with it dropped (state.ts validMilestones).
  defensePassed?: string; // §4.7
  /** Academic Code §6.2.6/§6.2.12: the OFFICIAL SUBMISSION of the dissertation
   * is the last requirement inside the eight years, and it is due by the
   * Graduate School calendar's deadline (policy review, 2026-10-03). */
  dissertationSubmitted?: string;
  // `thesisApprovedByReaders` (§3.4) was removed on 2026-10-04 with the
  // Ph.D.'s readers' date (DGS: "Apply the same to MSCSE thesis") — the thesis
  // defense date stands for both; a saved file that still carries it loads
  // with it dropped (state.ts validMilestones).
  /** The thesis topic approved (Academic Code §6.1.7: "With the approval of
   * his or her advisor, the student proposes a thesis topic for program
   * approval"; CSE §3.4(ii) — policy review 2026-10-04, P2-ac-5b-6.1-14). */
  thesisTopicApproved?: string;
  /** MSCSE thesis option: are both official readers tenured or tenure-track
   * CSE faculty, and is neither of them the advisor — as the student answers
   * it (CSE §3.4; DGS Handbook §10.3.8 — policy review 2026-10-04,
   * P2-dh-10-19). The readers themselves are not recorded. */
  thesisReadersTtt?: 'yes' | 'no' | 'unsure';
  thesisDefensePassed?: string; // §3.4 thesis option
  /** MSCSE thesis option: the final thesis submitted to the Graduate School
   * (Academic Code §6.1.8: "the master's candidate who is completing a thesis
   * must submit it to the Graduate School on or before the deadline published
   * in the Graduate School calendar" — policy review 2026-10-04,
   * P2-ac-5b-6.1-15, P2-dh-3.21-3.24-23). ISO date. */
  thesisSubmitted?: string;
  /** A FAILED first thesis-defense attempt (Academic Code §6.1.5: one retake,
   * by the end of the following semester — policy review 2026-10-04,
   * P2-ac-5b-6.1-12). */
  thesisDefenseFailed?: string;
  projectReportAccepted?: string; // §3.4 project option
  /** The Application for Admission to Master's Degree Candidacy submitted to
   * the Graduate School (Academic Code §6.1.6: "Admission to candidacy is a
   * prerequisite to receiving any graduate degree"; DGS Handbook §3.21.1) —
   * the MSCSE's, or a Ph.D. student's for the MSCSE along the way (policy
   * review 2026-10-04, P2-dh-3.21-3.24-2, -4, P2-dh-front-1-2-2). */
  msCandidacyApplied?: string;
}

/** A transfer course's acceptance on the Notre Dame record (CourseEntry.ndPosted). */
export interface NdPosting {
  term: Term;
  credits: number;
  level?: 'graduate' | 'undergraduate';
  institution?: string;
}

/** One graduate term's GPA figures as the transcript prints them. */
export interface TermGpa {
  term: Term;
  /** The term's own GPA ("Current Term" row). */
  termGpa?: number;
  /** The cumulative GPA after the term ("Cumulative" row). */
  cumulativeGpa?: number;
}

/** The milestone DATES (the advisor names and the faculty-status answers are not). */
export type MilestoneDateKey = Exclude<keyof Milestones, 'advisorName' | 'advisorName2' | 'advisorTtt' | 'advisorTtt2' | 'thesisReadersTtt'>;

/** A milestone date's deadline, for the Milestones card (DGS 2026-10-04: "In
 * the Milestones, next to all the dates, specify the deadlines."). The same
 * date the requirement row counts against — extensions, leaves and the
 * transfer clocks included — said without the row's state words. */
export interface MilestoneDeadline {
  /** "by the end of Spring 2030" / "before Fall 2034" / "by mid-Spring 2028";
   * absent when the milestone has no deadline of its own. */
  due?: string;
  /** The same point without the preposition: "the end of Spring 2030". */
  point?: string;
  /** Why that date — "semester 8 (§4.5)" — or, with no `due`, the whole
   * sentence ("No deadline of its own — …"). */
  basis: string;
  /** A clause said while the deadline is to be met or was met, and left out
   * once it has passed (the Graduate School calendar's graduation dates). */
  also?: string;
  /** ISO date of the deadline in force. */
  date?: string;
  /** Where the record stands against it: dated on or before (done) or after
   * (late); not dated, and still open, due this semester or the next
   * (due_soon), or past (overdue). Absent when nothing is to be said. */
  state?: 'done' | 'late' | 'open' | 'due_soon' | 'overdue';
  horizon?: 'this' | 'next';
}

/** Self-attested approvals (decision Q21) — clearly labeled in the UI; the legal
 * footer reminds students that real approvals live with the DGS office. */
export interface Attestations {
  advisorApprovedPlan?: boolean; // §3.2/§4.2 "approval of their advisor"
  /** Deprecated 2026-09-27: the DGS's approvals are recorded on each course
   * (`CourseEntry.dgsApproved`). Kept so old saved files still load; state.ts
   * maps a ticked box onto every course it covered and clears it. */
  dgsApproved4xxxx?: boolean; // §3.2/§4.2
  dgsApprovedNonCse?: boolean; // §3.2/§4.2
  transferApproved?: boolean; // §5.2 DGS + Graduate School
  /** Deprecated 2026-09-03 (retired with the claim path — see
   * claimedCoreArea). Kept so old saved files still load; ignored. */
  corePassedElsewhere?: CoreArea[];
  /** Deprecated 2026-10-03: the §4.4 extension is a NUMBER of semesters now
   * (`qualifierExtensionSemesters`; DGS: "DGS may give any number of
   * semesters as extensions"). A ticked box in an older file reads as one
   * semester (state.ts migrates it). */
  qualifierExtensionGranted?: boolean; // §4.4 "the DGS may extend the deadline"
  /** §4.4 "the DGS may extend the deadline on a case-by-case basis": how many
   * additional semesters the DGS granted (DGS 2026-10-03). Applies to the
   * §4.4 four-semester deadline and to §4.4.3's eighteen months alike, as the
   * boolean did. */
  qualifierExtensionSemesters?: number;
  /** §5.2 criterion 5: the Graduate School approved the transfer and the Grad
   * Admin recorded it (policy review, 2026-10-03). Until this is ticked the
   * §5.2 row stays "approved by the DGS — Graduate School approval pending";
   * the credits themselves count as the DGS's `yes` or tick decided. */
  transferRecorded?: boolean;
  /** The transfers that tick covers (transfer-recorded.ts `transferKey`): the
   * ones the Grad Admin request asked to submit when it was ticked
   * (credit-transfer review 2026-10-28, #31). Absent on a file ticked before
   * — the tick then covers every transfer. */
  transferRecordedCourses?: string[];
  /** The Graduate School extended the degree's time limit — dissertation
   * completion status after the eighth year (Academic Code §6.2.6.1: "for up
   * to two semesters"; DGS Handbook §3.19: one year, renewable once) or an
   * eligibility extension (DGS Handbook §10.3.5) — through the end of this
   * term, as the student states it; the DGS confirms (policy review
   * 2026-10-04, P2-ac-6.2-app-7, P2-dh-3.14-3.20-27, P2-dh-10-10). */
  timeLimitExtendedThrough?: Term;
  /** The Graduate School approved the student's plan of study for a dual
   * (multiple) degree (DGS Handbook §2.9: "The plan must then be approved by
   * the Graduate School"; policy review 2026-10-04, P2-ac-1-3-2). Until it is
   * ticked, a course shared with the other degree waits for that approval. */
  dualPlanApproved?: boolean;
  /** The student passed the qualifying examination under the requirements in
   * force when they took it — the rule changed several times in four years
   * (DGS 2026-09-21). Offered only to students in their third year or later;
   * the engine honours it only then (`qualifierPriorRulesEligible`). */
  qualifierPassedUnderPriorRules?: boolean;
  /** The DGS and the Graduate School ruled that the student's examinations
   * from before an interruption of five years or more stand (Academic Code
   * §5.5) — the record-level answer to the examinations held since P3-ac-5a-3
   * (policy review round 4, P4-ac-2; DGS 2026-10-11: option (a)). */
  examsBeforeInterruptionStand?: boolean;
  /** The DGS confirmed the Oral Candidacy Exam whose coursework was short at
   * the exam (§4.5, as of the exam's semester — P3-cse-4b-1): the exam, the
   * admission card and the MSCSE along the way stop waiting (policy review
   * round 4, P4-phd-5; DGS 2026-10-11: option (a)). */
  oceConfirmedByDgs?: boolean;
  /** The Ph.D. student wants the MSCSE awarded along the way (DGS 2026-10-11,
   * question 3a: option (b)). CSE §3.1: Ph.D. students "may also be awarded"
   * an MSCSE; DGS Handbook §3.21.1: "A doctoral student who wishes to receive
   * a master's degree must also apply for admission to master's degree
   * candidacy". Without it (or a dated master's candidacy application) a
   * qualifying record says so, and nothing goes to the Grad Admin. */
  wantsMsAlongTheWay?: boolean;
}

export interface Student {
  schemaVersion: 1;
  program: Program;
  msOption?: MsOption;
  entryTerm: Term;
  /** Set while entryTerm holds a value the student has NOT chosen (2026-09-05):
   * `how` = "assumed" for a fresh record (the fall of the current year), or
   * the transcript reading it was set from ("the first graduate-level term on
   * your transcript"); `alternative` names the other reading a combined
   * transcript supports. Cleared when the student touches the dropdown. The
   * standing card warns while it is set — the §4.3 residency count and every
   * deadline (§4.3 eight-year limit, §4.4.3 eighteen months, §4.5 eighth
   * semester) hang on this term. */
  entryTermInferred?: { how: string; alternative?: { term: Term; why: string; otherProgram?: true } };
  /** The student's earlier degrees, asked in the opening dialog (DGS
   * 2026-09-22): where the bachelor's is from and whether a graduate degree
   * came before this program. Decides which transcript rows are shown
   * (src/ui/background.ts). Absent on records saved before it was asked —
   * every row shows then, as before. */
  background?: {
    bachelors: 'nd-cse' | 'nd-other' | 'elsewhere';
    ndIntegrated?: boolean;
    graduate: 'none' | 'elsewhere' | 'nd-mscse' | 'nd-4plus1' | 'nd-mscse-transfer' | 'nd-other';
    samePlace?: boolean;
    finished?: boolean;
    /** `nd-mscse-transfer` only (DGS 2026-09-28): the term the student moved
     * into the Ph.D. Named on the copied emails; the qualifier, research-
     * component and first-year seminar clocks count from it (DGS 2026-10-03),
     * while the entry term stays the MSCSE's, which §4.3 and §4.5 count from
     * (DGS 2026-09-26). */
    transferredTerm?: Term;
    /** The three Notre Dame MSCSE answers only — `nd-mscse`, `nd-4plus1`,
     * `nd-mscse-transfer` (policy review round 3, P3-prior-programs-1 and -2;
     * DGS 2026-10-07: option (a)): the student ALSO held, or started, a
     * graduate degree at another university — `finished` then says whether
     * they finished it, and `priorMs` follows (24 / 6 transfer credits). */
    alsoElsewhere?: boolean;
  };
  /** The earlier-degrees answer while it is still INCOMPLETE (DGS 2026-10-08,
   * Option 1): the opening dialog asks only the program, so the rest is
   * answered on the page — partly read from the imported transcripts
   * (src/ui/background-read.ts), partly by the student. Once every question
   * that applies is answered it becomes `background` (and this is cleared);
   * until then the engine sees no `background` and keeps its no-answer
   * behaviour. The engine never reads this field. */
  backgroundDraft?: Partial<NonNullable<Student['background']> & { integratedAdmittedTerm: Term }>;
  /** Which parts of the earlier-degrees answer were read from transcripts,
   * each with where from ("your Notre Dame transcript shows …"), so the page
   * can say "read from your transcript — check it". A part the student
   * changes is dropped from here. Display only. */
  backgroundRead?: Partial<Record<keyof NonNullable<Student['background']> | 'integratedAdmittedTerm', string>>;
  /** Which import each read part came from (review of Option 1, 2026-10-08):
   * removing that import forgets what it read, while the answer is a draft. UI
   * only. */
  backgroundReadFrom?: Partial<Record<keyof NonNullable<Student['background']> | 'integratedAdmittedTerm', 'nd' | 'bachelors' | 'masters' | 'phd'>>;
  priorMs: 'none' | 'unfinished' | 'completed'; // §5.2 transfer caps
  /** True while priorMs holds a value INFERRED from an uploaded transcript
   * (2026-09-03) rather than chosen by the student — cleared when they touch
   * the dropdown, and reset with priorMs when the inferring transcript's
   * courses are removed. */
  priorMsInferred?: boolean;
  /** The term the bachelor's degree was awarded (DGS 2026-09-06: "Only the
   * courses taken with the graduate student status can count. The
   * graduate-level courses taken before earning the bachelor's degree do not
   * count."). §5.2 criterion 2 needs graduate student status, so a transfer
   * course dated in or before this term earns no credit whatever its number
   * or registration level (classify() in allocate.ts). Optional in the TYPE
   * only — the UI marks it required and audit() warns while it is unset
   * (2026-09-07); while unknown, each course's degreeLevel decides. Set under "Your
   * standing", or filled in by a transcript import that finds a dated
   * bachelor's award (then bachelorsAwardedInferred says so). */
  bachelorsAwarded?: Term;
  /** Set while bachelorsAwarded holds a value read from a transcript rather
   * than chosen by the student; `how` names the reading. Cleared when the
   * student touches the control; a later import may replace an inferred
   * value, never a chosen one. Remove/Undo leave both alone (like the entry
   * term — a fact about the student, not about the import). */
  bachelorsAwardedInferred?: {
    how: string;
    /** Set when the value is only "before this term" (DGS 2026-09-20): a
     * standalone master's transcript says nothing about the bachelor's award,
     * so `bachelorsAwarded` holds the term before the master's first semester
     * and the page shows "Before <that semester>" instead of a season and a
     * year. Cleared when the student sets the exact term. */
    before?: Term;
  };
  /** Set when the student ALREADY HOLDS a Notre Dame master's degree — the
   * MSCSE earned before entering the Ph.D. program (DGS 2026-09-09). §4.5's
   * "along the way" MSCSE is a degree they cannot earn a second time, so that
   * row is left out of their report entirely rather than counting from zero
   * toward a degree they hold. Presence is the fact; `term` is only for the
   * wording and may be unknown. Read from the Notre Dame transcript's
   * degree-conferral lines (then `inferred` says so, and the checkbox under
   * Your standing corrects it). Says nothing about transfer credit: those
   * courses are §5.2 candidates like any other prior graduate coursework. */
  ndMasters?: { term?: Term; inferred?: { how: string } };
  /** Was the student in Notre Dame's Integrated B.S. + M.S. (4+1) program
   * (DGS 2026-09-12, red-team F7)? Only then does a 60000-level course taken
   * as an undergraduate earn MSCSE/Ph.D. credit (§3.5; the Graduate School's
   * 2026-09-10 answer). Unanswered = not a 4+1: no credit, and the line says
   * how to change that. A plain bachelor's course still demonstrates §4.4.1
   * core knowledge and a §4.4.2 group for a Ph.D. student. */
  integratedBsMs?: boolean;
  /** Set while integratedBsMs was read off the transcript (graduate-registered
   * coursework dated inside the bachelor's degree); cleared when the student answers. */
  integratedBsMsInferred?: { how: string };
  /** The DATED degree conferrals on the Notre Dame transcript, kept so the
   * fact above can be worked out AGAIN when the entry term changes (2026-09-10).
   * Whether a master's was earned "before this program" or along the way is a
   * question about the entry term, and on a 4+1's transcript the entry term is
   * exactly what the import is least sure of — so deciding it once, at import,
   * against a term the student then corrects is how a student who holds the
   * MSCSE ended up with a 6-credit transfer cap instead of 24. */
  ndDegrees?: { level: 'bachelors' | 'masters' | 'phd'; date: string }[];
  gpa?: number; // self-reported cumulative (decision Q7)
  /** Where `gpa` came from when a Notre Dame transcript filled it in
   * (2026-09-05, combined-transcript bug report): the transcript's
   * graduate-level cumulative figure, or this program's courses alone when
   * an earlier graduate program at Notre Dame is folded into that figure.
   * Display only — the engine reads `gpa`; cleared when the student types. */
  gpaSource?: {
    basis: 'transcript-graduate' | 'program-only';
    transcriptGpa?: number;
    programGpa?: number;
    undergraduateGpa?: number;
  };
  /** Each GRADUATE term's GPA and cumulative GPA as a Notre Dame transcript
   * prints them (its "Term Totals (Graduate)" block: "Current Term" and
   * "Cumulative" rows), set by the transcript import and nothing else — never
   * computed from entered grades (decision 2026-08-31: the transcript is the
   * truth). Read for the Graduate School's probation and dismissal grounds
   * (Academic Code §5.7.3, §5.8; policy review 2026-10-04); a record without
   * it gets no such line. */
  termGpas?: TermGpa[];
  fullTimeTermOverrides?: Term[]; // decision Q8 residency override
  /** Semesters for which the student says a credit overload was approved
   * (the Registrar's eForm, DGS Handbook §3.10.1): Academic Code §3.8's
   * 15-credit (summer: 10) maximum is not applied to them (2026-10-03). */
  creditOverloadTerms?: Term[];
  /** Fall/spring semesters spent on an APPROVED MEDICAL LEAVE of absence
   * (Academic Code §5.1, §6.2.6: the eight years run "unless interrupted by
   * approved medical leave(s) and/or approved childbirth accommodation(s)").
   * Medical only since policy review round 3, P3-cross-doc-1 (DGS 2026-10-06:
   * option A; the input reads "Semesters on approved medical leave") — a
   * leave for another reason is not entered and moves no clock. Each one
   * pushes the §4.3 eight-year limit (and the MSCSE's five years) and §4.5's
   * eighth semester out by a semester (DGS 2026-10-03). Six-week medical and
   * crisis separations do NOT count (DGS Handbook §3.5/§3.6: they "will count
   * towards doctoral students' degree time limit"). */
  leaveSemesters?: number;
  /** Fall or spring semesters on an approved leave of absence for another
   * reason — study, athletic training, military, mission work or personal
   * (Academic Code §5.1) — policy review round 4, P4-ac-3; DGS 2026-10-11:
   * option (a). It explains a semester with no registration on the
   * transcript (no readmission is asked for it) but moves NO clock: only
   * medical leave and accommodations do (DGS 2026-10-06, P3-cross-doc-1). */
  otherLeaveSemesters?: number;
  /** Childbirth/adoption accommodations taken (Academic Code §5.4; DGS
   * Handbook §3.7.2: "the accommodation extends it … by a semester"): each
   * adds a semester to the same two clocks (DGS 2026-10-03). */
  accommodationSemesters?: number;
  /** Ph.D. only: which fall or spring semester each leave was, by position
   * (null = not given yet). Only a leave before the end of the eighth semester
   * of enrollment moves §4.5's OCE and admission-to-candidacy deadline (policy
   * review round 3, P3-ac-5a-1; DGS 2026-10-05, option (a)); every leave still
   * moves the eight-year limit. */
  leaveTerms?: (Term | null)[];
  /** Ph.D. only: the semester of the birth or adoption for each accommodation,
   * by position (null = not given yet). An accommodation for a birth or
   * adoption in or before the eighth semester moves that deadline, even when
   * the accommodation semester is the one after (DGS 2026-10-05, option 1). */
  accommodationEventTerms?: (Term | null)[];
  /** The student withdrew and was READMITTED in this term (Academic Code
   * §5.5, policy review 2026-10-03). The clocks keep the original entry term
   * ("from the time of matriculation"); coursework and examinations from
   * before an interruption of five years or more are routed to the DGS — the
   * Code forfeits their credit (examinations since 2026-10-05, P3-ac-5a-3:
   * the research qualifier, the OCE, a qualifier passed under the earlier
   * rules, the MSCSE defense or project report, and the core-area,
   * specialization and seminar rows met only by such courses). */
  readmittedTerm?: Term;
  /** The semester the student plans to graduate in (policy review 2026-10-04,
   * P2-dh-3.21-3.24-24): the Graduate School confers a degree only on a
   * student registered for at least one credit hour in it — a zero-credit
   * course in a summer (Academic Code §3.7; DGS Handbook §3.23.1). */
  graduationTerm?: Term;
  /** MSCSE 4+1: the term the student was admitted (matriculated) into the
   * Integrated B.S. + M.S. program, from the admission letter (Graduate School
   * 4+1 guidance: "recognized dual-degree students … apply to the graduate
   * program during their junior year for matriculation in their senior year";
   * policy review 2026-10-04, P2-fourplusone-1). Beyond the six credits shared
   * with the bachelor's, graduate coursework taken as an undergraduate counts
   * only for a student admitted before the bachelor's was awarded, and only
   * from this term on. */
  integratedAdmitted?: Term;
  /** The deadline in a probation letter, when the student is on probation
   * (Academic Code §5.7.2: "A student on probation must complete the
   * stipulations outlined in the probation letter within the required
   * timeframe or will be dismissed"). A rare case (DGS 2026-10-04, policy
   * review P2-ac-5b-6.1-3): the letter's date governs, and no row is
   * recomputed — the report says so at the top. ISO date. */
  probationLetterDeadline?: string;
  /** The Notre Dame graduate courses dated before the entry term, with no
   * earlier graduate program on the record, were taken in NON-DEGREE status —
   * an unclassified or a departmental non-degree student (Academic Code §2.3;
   * P3-dh-front-1-2-4): at most 12 such credits may
   * count toward the degree). Asked only when such courses exist (DGS
   * 2026-10-03); `true` routes them to the DGS inside the 12-credit limit,
   * `false` or unanswered leaves them refused with the reason. */
  ndNonDegree?: boolean;
  /** Enrolled in a second Notre Dame degree program at the same time — a dual
   * or multiple degree (Academic Code §2.2; DGS Handbook §2.9; policy review
   * 2026-10-04, P2-ac-1-3-2). A rare case, asked under Your standing behind a
   * selector; `true` offers each Notre Dame course the
   * `sharedWithOtherDegree` tick, and at most nine credits of the ticked
   * courses count toward this degree. */
  concurrentDegree?: boolean;
  courses: CourseEntry[];
  milestones: Milestones;
  attestations: Attestations;
}

// ---------- audit output ----------

export type Status =
  | 'met'
  | 'in_progress'
  | 'unmet'
  | 'needs_dgs_review'
  | 'cannot_evaluate'
  | 'not_applicable';

export interface ApproxDate {
  date: string; // ISO
  approx: boolean;
  note?: string;
}

export type DeadlineState = 'done' | 'upcoming' | 'due_soon' | 'overdue';

export interface DeadlineInfo extends ApproxDate {
  state: DeadlineState;
  /** e.g. "Due by the end of Spring 2030 (approximate)" / "Past due — …" */
  label: string;
  /** Set with state 'due_soon' (DGS 2026-09-28): the deadline falls in the
   * current semester ('this') or the one after ('next'). The pill, the next
   * steps and the Grad Admin request alert on it; "due soon" was 120 days
   * before. */
  horizon?: 'this' | 'next';
}

/** One statement of a requirement's detail: plain prose, a lead sentence with
 * enumerated items (e.g. the per-course sign-off list) that the report renders
 * as a nested bullet list (DGS request 2026-09-04), or a WARNING — something
 * the student is losing, which must not read as ordinary body text under a
 * green pill (interface review R2, 2026-09-18: three CSE 4xxxx courses against
 * a six-credit cap printed "CSE 40554: 3 credits not counted — over the cap"
 * in the same grey prose as everything else). `detail` is unchanged either
 * way: a warning flattens to its own sentence, so the copied messages and the
 * scenario fixtures keep reading as before. */
/** One statement of a requirement row's detail. A plain string is a FACT —
 * where the student stands, what satisfies the row by what. `{ note }` is
 * EXPLANATION — the rule, a reason, a next step, a Graduate School form —
 * which the page folds behind the card's "Relevant Policies" selector (DGS 2026-10-03:
 * "In those cards, only need to show what are satisfied by what. Other
 * supplementary explanation all need to be hidden with selectors. Apply this
 * to future changes too"). Every kind is plain text in `detail` and in the
 * copied messages. */
/** `fold` (2026-10-04, DGS: hide the specialization card's course list "with a
 * selector"): the card shows the lead and puts the items behind a selector
 * with this text; the copied messages are unchanged. */
/** `pageOnly` on a note (2026-10-05): a policy sentence for the card's
 * Relevant Policies only — the copied messages leave it out (whyFor), so a
 * card listing every condition of a rule does not flood the emails. */
/** Where one condition on a card stands (DGS 2026-10-06: "In the progress
 * result cards, it's hard to see what are met and what are not met"): the page
 * draws a mark before the line — green ✓ met, blue ◐ in progress, amber ●
 * waiting for the DGS, red ✕ not yet — and the emails keep the words. */
export type ConditionMark = 'met' | 'in_progress' | 'waiting' | 'not_yet';

/** One statement of a card's detail. `marks` (parallel to `items`) and the
 * `check` form carry a ConditionMark for each condition listed. */
export type DetailPart =
  | string
  | { lead: string; items: string[]; fold?: string; marks?: ConditionMark[] }
  | { warn: string }
  | { note: string; pageOnly?: true }
  | { check: string; mark: ConditionMark };

export interface Contribution {
  courseId: string;
  credits: number;
  pending?: true;
  /** Why it is pending — in progress, or waiting for a decision (UI review
   * item 6; DGS 2026-10-08: "pending" named in-progress courses in the fold
   * title and DGS-waiting ones in the score head). 'plan' is a dual-degree
   * shared course waiting only for the Graduate School's approval of the
   * plan of study — not the DGS (policy review round 4, P4-ac-5; DGS
   * 2026-10-11; DGS Handbook §2.9). */
  kind?: 'in_progress' | 'waiting' | 'plan';
}

export interface RequirementResult {
  id: string;
  group: string; // display group heading, e.g. "Coursework — §4.2"
  title: string;
  status: Status;
  /** Overrides the pill's WORDING for this row only — the status, the score and
   * the dashboard counts are untouched (W-CS2, DGS 2026-09-18). One row uses
   * it: a dissertation defended after §4.3's eight-year limit reads
   * "Eligibility at risk", because the shared "Conditionally met" would promise
   * a degree whose eligibility may be forfeit. */
  statusLabel?: string;
  /** Informational rows (e.g. MSCSE-along-the-way) are excluded from the score. */
  informational?: boolean;
  /** Shown with its own pill but not counted in the headline (DGS 2026-09-27):
   * the five parts of the qualifier — the umbrella row is the one that counts,
   * and it names the parts still open, so these stay out of the attention
   * list too. Everything else (feeds, emails, the qualifier's own logic) is
   * unchanged. */
  unscored?: true;
  /** Shown INSIDE another row's card, not as a card of its own (DGS
   * 2026-10-04: the RCR training and the OCE "seem to overlap" with admission
   * to candidacy — "Can they be merged into one card?"). The row stays in the
   * report for the emails and the milestone dates; it is unscored, and the
   * parent's card carries its facts and notes. */
  mergedInto?: string;
  /** An allowance — §3.2 / §4.2's caps, §3.5's shared credits — not a
   * requirement (DGS 2026-09-27): drawn as a meter with no pill, never counted
   * in the headline. Under Coursework since 2026-10-27, after its requirement
   * cards; one not used yet waits in a fold there (DGS: "Fold these unless
   * they become relevant"). */
  allowance?: true;
  /** Done, but after the row's own deadline, and that lateness is the only
   * reason it reads Needs DGS review (a late OCE or admission to candidacy —
   * 2026-10-04): the row keeps its own question for the DGS, while the
   * eight-year row counts it complete. Since policy review round 3
   * (P3-cse-4a-2, DGS 2026-10-06, option A) also a qualifier component
   * completed after §4.4's four semesters (and any DGS extension), and the
   * qualifier row that waits on it; the OCE gate counts such a component as
   * done coursework. Since round 4 (P4-phd-2, DGS 2026-10-12) also the
   * research seminar passed after the first year. */
  completedLate?: true;
  /** `phd.qualifier` only: the qualifier's COURSE components are complete —
   * core knowledge, specialization and §4.2's nine Notre Dame credits, each
   * met (policy review round 3, P3-cse-4a-3; DGS 2026-10-07: option (a)).
   * §4.4's completion form is due then: "When the student has completed the
   * qualifier course requirement, they must notify the CSE DGS office by
   * filing the appropriate form"; the research component has the advisor's
   * own form (§4.4.3). Every reminder of the form reads this. */
  qualifierCourseComponentsDone?: true;
  /** A qualifier component (core knowledge, specialization): the semester it
   * was FIRST complete — the earliest courses that satisfy it, not the course
   * the row names (P3-cse-4a-2). Read against §4.4's deadline. */
  completedIn?: Term;
  /** The examination this row records was passed before a readmission after
   * an interruption of five years or more, so it waits for the DGS (Academic
   * Code §5.5; P3-ac-5a-3, 2026-10-05) — the admission card reads it. */
  forfeitReview?: true;
  detail: string;
  /** When the detail was built from several independent statements, they are
   * also kept separately so the UI can render a long detail as a bulleted
   * list (DGS request 2026-09-04). A part may itself carry a lead sentence
   * plus enumerated items — rendered as a nested (two-layer) list. `detail`
   * stays the joined prose — the advisor summary and tests keep using it. */
  /** phd.candidacy only: what the coursework lacked at a dated OCE — "15 of 24
   * regular-course credits and no Algorithms core-knowledge course" — when the
   * DGS must confirm the exam could be taken (CSE §4.5; policy review round 3,
   * P3-cse-4b-1, DGS 2026-10-06). The admission card holds "apply now" while
   * it is set (Decision 2 (a)), and the advisor summary asks about it. */
  courseworkReview?: string;
  /** phd.candidacy only: the OCE was passed after its deadline — set beside
   * any other question (`completedLate` is set only when lateness is the
   * only one), so the advisor email can ask the DGS about each: the late
   * pass, the coursework at the exam, a pass before a readmission (policy
   * review round 3, P3-text-ui-3). */
  passedLate?: true;
  detailParts?: DetailPart[];
  /** The same statements with the §4.4.1 / §4.4.2 names shortened, for the
   * page only (DGS 2026-09-08). The report renders these when they are here;
   * `detail` and `detailParts` stay FULL, so the messages copied for the
   * advisor, the DGS and the Grad Admin — which re-voice them — keep the
   * names spelled out, which is what the DGS asked for. */
  shortDetailParts?: DetailPart[];
  /** The numbers behind a threshold row, for the credit meters (B3,
   * 2026-09-18). The meters used to re-parse them out of `detail` with
   * /^(\d+) of (\d+)/, so rewording the sentence silently deleted the bar. */
  progress?: { have: number; need: number; unit: string };
  deadline?: DeadlineInfo;
  /** The rule's section and, normally, its sentence in the document's own
   * words. An empty quote means the row states its rule in a note instead
   * (DGS 2026-10-03: the qualifier passed under the earlier rules) — the
   * card then prints no quotation. */
  citation: { section: string; quote: string };
  /** What satisfies the row right now — course ids for course-based rows,
   * semester labels for residency — so the Grad Admin's processing request
   * can table "which courses meet this requirement" from data rather than
   * prose (DGS request 2026-09-06 evening). Only definite credits count
   * here (passed, no approval pending). Absent when nothing does yet. */
  satisfiedBy?: string[];
  /** The courses behind a credit row and what each contributes (DGS
   * 2026-09-22): counted credits, or credits that will count once the course
   * is passed or approved (`pending`). The report folds them behind
   * "Courses counted" on every threshold and cap row. */
  contributions?: Contribution[];
  /** A short name for lists, where the full title is too long to read
   * sideways (DGS 2026-09-08 — "24 credit hours of regular courses at the
   * 60000 level or higher" swamped a course's "Counts toward" cell). The card
   * itself always shows the full `title`; this is only for references to it. */
  shortTitle?: string;
  /** §4.4.2 only (2026-09-12): the coverage-maximising group for each
   * flexible course, courseId → group code, so the page can pre-fill the
   * student's pick rather than let a pick strand the course. */
  groupAssignments?: Record<string, string>;
  /** §4.4.2 only (DGS request 2026-09-08). A course the sheet marks `any` can
   * satisfy ANY specialization group, so the student chooses — and the useful
   * choice depends on what their other courses already cover. Course id → the
   * groups that would add a distinct group they do not have yet. Empty for a
   * course whose choice cannot help (every group is already covered). */
  groupChoices?: Record<string, string[]>;
  /** Courses that WILL count toward this row once they are passed or approved
   * — the in-progress and provisional counterpart of `satisfiedBy`
   * (DGS request 2026-09-08: a course's line should name every requirement it
   * satisfies OR will satisfy). Never used by the emails, which report only
   * what is already true. */
  pendingBy?: string[];
  /** In progress only (2026-10-05): the courses in progress this row is
   * counting on to complete — a qualifier part's course, or the
   * specialization courses the group matching relies on. The OCE gate reads
   * their semesters to tell when the coursework is expected to be complete.
   * Engine-internal; nothing renders it. */
  completingCourses?: string[];
}

export interface CourseLine {
  courseId: string;
  term: Term;
  /** The row of `student.courses` this line is (credit-transfer review
   * 2026-10-28): two registrations of one course in one term share an id
   * and a term. */
  entryIndex?: number;
  text: string;
  /** Every requirement row this course feeds, in report order (DGS request
   * 2026-09-08). One course routinely serves several — a 60000-level course
   * counts toward the total credits, the regular-course credits, the nine at
   * Notre Dame, a §4.4.1 core area and a §4.4.2 specialization group — and the
   * sentence above names only the credit pool. `when` separates what it counts
   * toward now from what it will count toward once passed or approved. */
  counts: { id: string; title: string; long: string; when: 'now' | 'later' }[];
  /** How the page paints the line (2026-09-06; split four ways 2026-09-13):
   * green (earns credit or a core area now), blue (in progress — credit once
   * it is passed), amber (counted only until an advisor/DGS approval), red
   * (earns nothing). "Taken", "in progress" and "pending approval" were one
   * amber mark until the DGS asked for them to be told apart. */
  mark: CourseMark;
  /** The course's second line — what it does for the Ph.D. qualifier
   * (§4.4.1) — with its own mark (DGS 2026-09-27). */
  qualifier?: { mark: CourseMark; text: string };
  /** The sheet decides this course case by case, so the DGS's approval for
   * this student is recorded on the course (DGS 2026-09-27): the row shows
   * the tick box, `approved` says whether it is ticked. */
  approvable?: true;
  approved?: true;
  /** The course is held by a record-level fact (CourseEntry.dgsHoldApproved):
   * the box records the DGS's ruling on the hold, and `approved` reads it
   * (round 5, item 29 (b)). */
  holdRuling?: true;
}

export interface AuditReport {
  program: Program;
  requirements: RequirementResult[];
  courseLines: CourseLine[];
  /** met / scored, where n/a and informational rows are excluded from both.
   * `met` counts rows that are satisfied outright; `conditional` those
   * satisfied except for an approval (W-CS1, 2026-09-18). They are disjoint,
   * and both are inside `scored`. */
  summary: { met: number; conditional: number; scored: number };
  warnings: string[];
  /** Courses still "In progress" in a semester that has ended, one group per
   * semester (blue-team review 2026-10-17, U21): the warning that names them
   * is in `warnings`; the Next steps list builds its `grades.update` step
   * from this. Absent when there are none. */
  staleInProgress?: { term: Term; courseIds: string[]; nd: boolean }[];
  /** Notes for the DGS that are not about one course (2026-09-12): copied
   * into the review request and shown in its card. */
  reviewFlags?: string[];
  /** Checks for the people who decide and process (DGS 2026-10-04): a course
   * the ExternalCourses tab lets transfer (`yes`) whose number looks
   * undergraduate or whose title suggests a non-regular course
   * (data/course-checks.ts). Copied into the review request (notes) and the
   * processing request; nothing is counted or refused on them. */
  staffChecks?: string[];
  /** §3.5 / §3.6 tracks this audit does not model, recognised from the
   * student's own coursework (2026-09-10, promised 2026-08-31). Not warnings:
   * nothing is wrong, and no verdict changes — the note names what the page
   * cannot decide and sends the student to the DGS. */
  tracks: SpecialTrack[];
  /** Each milestone date's deadline, for the Milestones card (DGS
   * 2026-10-04); a key is absent when the rules sheet lacks its parameter. */
  milestoneDeadlines?: Partial<Record<MilestoneDateKey, MilestoneDeadline>>;
  /** The semester of graduation the student entered, and whether a Notre Dame
   * course of at least one credit (any credit in a summer) is entered for it
   * (Academic Code §3.7; DGS Handbook §3.23.1 — 2026-10-04). */
  /** `incompletes`: Notre Dame courses graded I in that semester — the
   * Graduate School confers the degree only with none (policy review round 3,
   * P3-dh-3.1-3.13-3; DGS Handbook §3.23.1). */
  graduation?: { term: Term; registeredCredits: number; registered: boolean; incompletes?: string[] };
  /** The semester the student plans to graduate in, once it has begun with a
   * counted transfer course not yet recorded: CSE §5.2 considers a transfer
   * request only "before the semester in which the graduate degree is
   * conferred" (policy review round 3, P3-import-4; DGS 2026-10-07: option
   * (b)). The processing request asks whether it was sent in time. */
  transferRequestWindowClosed?: Term;
  /** The examinations from before a readmission after five years or more
   * (Academic Code §5.5), whatever the DGS ruled: the page offers the Approvals
   * tick "my examinations from before the interruption stand" while this
   * lists any (policy review round 5; DGS 2026-10-14). */
  examsBeforeInterruption?: string[];
  /** The MSCSE's summer floor from the Parameters tab (summer_fulltime_credits_min),
   * for the glossary's "Full-time" (policy review round 3, P3-text-ui-5): read
   * from the sheet, never typed, so the two cannot drift. */
  summerFullTimeCredits?: number;
  /** Each course drawing on the §5.2 transfer cap, with the credits the
   * allocator counted for it (regular plus total-only), and the cap itself:
   * the processing request submits only what the cap admits (policy review
   * round 3, P3-prior-programs-5). `restOver` is set when a cap other than
   * §5.2's refused part of the course — the engine's own reason, e.g. "over
   * the 9-credit non-CSE cap (§3.2)" (round 5 verification, transfer-1). */
  /** `entryIndex`: the row of `student.courses` — two rows of one course from
   * one university in one term (two topic sections) share the rest. */
  transferCredits?: { courseId: string; entryIndex?: number; institution?: string; term: Term; counted: number; restOver?: string; restUnknown?: true }[];
  /** A first-semester student who has not finished a semester yet: no
   * cumulative GPA exists, and the GPA card and the emails say "no GPA yet"
   * (DGS 2026-10-14; requirements/shared.ts `noGpaYet`). */
  noGpaYet?: true;
  transferCap?: number;
  /** Graduation is in sight, so the page asks the semester (DGS 2026-10-05:
   * "Let's show it only when it matters"): a Ph.D. student once the OCE is
   * passed, an MSCSE student once the total credits are complete or in
   * progress. */
  graduationInSight?: true;
}
