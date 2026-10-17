// Rules-side data model: what the DGS's Google Sheet becomes after parsing.
// Schema of record: the live sheet "CSE-Degree-Checking-Rules" (see data/README.md).
import type { Term } from '../engine/types.ts';

/** `adgs_approval` beside `dgs_approval` (DGS 2026-09-12): the cell names WHO
 * signs off, so a future DGS can move a course's authority back without a code
 * change. */
export type Counts = 'yes' | 'no' | 'dgs_approval' | 'adgs_approval';

/** §5.2 transferability of one course at another university, as the
 * ExternalCourses tab states it. `yes` = pre-approved, so only the Grad
 * Admin's processing is left; `no` = ruled out; `dgs_approval` /
 * `adgs_approval` = this one needs an approval, so it stays in the review
 * request until it is given (DGS 2026-09-08, split 2026-09-09). A blank cell
 * is undefined: not looked at yet.
 *
 * The two approval words are treated as ONE case for now (DGS 2026-09-09:
 * "you can treat dgs_approval = adgs_approval"), and both are read as "DGS
 * approval is needed". They are kept apart in the type rather than collapsed
 * at parse time, so the day the DGS wants the MSCSE message to name the ADGS
 * instead, the sheet's own word is still there to key on. */
export type Transferable = 'yes' | 'no' | 'dgs_approval' | 'adgs_approval';

/** category_group values that are valid on a Courses row but are NOT real
 * §4.4.2 specialization groups: 'ineligible' = can never satisfy the category
 * requirement (the DGS marks all 40000-level courses this way). It may appear
 * in the Categories tab for the sheet's own dropdowns, but never joins the
 * matchable group list.
 *
 * `any` USED to be the second one — "listed under every group, the student
 * picks". The DGS retired it on 2026-09-18: the live sheet has no `any` row in
 * the Categories tab and no Courses cell uses it, because a course listed
 * everywhere now names the five groups outright (CSE 60876: "alg, hcc, arch,
 * dsai, sys"), which says the same thing without a keyword to learn. A cell
 * that still says `any` is now reported as an unknown group code — the honest
 * answer for a value the sheet no longer defines. */
export const RESERVED_GROUP_CODES = ['ineligible'] as const;

export type CourseType = 'regular' | 'seminar' | 'research' | 'independent' | 'project';

/** One row of the ExternalCourses tab: a course at ANOTHER university the DGS
 * has ruled on (docs/DECISIONS.md, 2026-09-01). `satisfiesCoreArea` says which
 * §4.4.1 core area the course covers (validated against the Categories core
 * list); the two `transferable_*` columns say whether its credits may transfer
 * under §5.2 — separately for a Ph.D. and an MSCSE student since 2026-09-09
 * (undefined = that part is not decided for that program); `ndCredits` is the
 * Notre-Dame-equivalent credit value for non-semester systems — §5.2 "pro-rata"
 * (undefined = count the credits printed on the transcript). */
export interface ExternalRule {
  university: string;
  /** Normalized form of the university name, for matching (the aliases column
   * was retired 2026-09-03 — the name as the transcript prints it is the key). */
  universityKey: string;
  courseId: string;
  title: string;
  satisfiesCoreArea?: string | null; // null = decided, no core area (`none` in the sheet, DGS 2026-09-06); undefined = blank, not decided yet
  /** §5.2 transferability, decided per PROGRAM since 2026-09-09: the sheet's
   * `transferable_PhD` and `transferable_MSCSE` columns. A sheet still using
   * the single `transferable` column fills both. Read them through
   * `transferableFor(rule, program)` — never directly, or a Ph.D. ruling will
   * be applied to an MSCSE student. */
  transferablePhd?: Transferable;
  transferableMscse?: Transferable;
  /** A FIXED Notre Dame credit value for this one course, when the conversion
   * below cannot express it. Overrides everything. */
  ndCredits?: number;
  /** The OLD per-course `credit_system` cell (DGS 2026-09-08 until
   * 2026-10-10). Each university's system is set once in the Universities tab
   * now; this is read only when a sheet has no Universities tab (a saved copy
   * from before the move) — see `universityCreditSystems` in assemble.ts. */
  creditSystem?: 'quarter' | 'semester' | 'trimester';
  /** Is this a CSE course, for §4.2's nine-credit allowance for courses "taken
   * from a department other than CSE"? (DGS 2026-09-09.) Other universities
   * name the department every way there is — CS, CompSci, CSCI, CSYE, ECE, CE
   * — and several of those mean CSE at one school and not at another, which no
   * app can settle on its own. `cse_subject_codes` in the Parameters tab
   * settles the unambiguous codes; this cell is the DGS's ruling for a course
   * the code cannot settle, and it wins. Undefined = the sheet has not said,
   * and the allowance is not applied to the course at all. */
  isCse?: boolean;
  decidedOn?: string;
  notes?: string;
  /** 1-based spreadsheet row, for diagnostics. */
  sheetRow: number;
}

/** One row of the Courses tab (the same course_id may appear in several rows
 * with different rules_effective_term values — see resolveRuleRow in assemble.ts). */
export interface RuleCourse {
  courseId: string;
  title: string;
  level?: number; // 4..9; falls back to the first digit of the course number
  creditMin?: number;
  creditMax?: number;
  creditsDefault?: number;
  courseType: CourseType;
  countsTowardMscse?: Counts; // blank → needs DGS review
  countsTowardPhd?: Counts;
  coreArea?: string; // validated against the Categories core list (§4.4.1)
  /** §4.4.2: every specialization group this course may satisfy (DGS
   * 2026-09-08 — the sheet's `category_group` cell may now name SEVERAL, so a
   * course can be worth a choice of two or three groups and not only one or
   * all five). Undefined = the DGS has not said; empty = explicitly not eligible, which
   * `categoryIneligible` records so the two are never confused. */
  categoryGroups?: string[];
  /** The sheet said `ineligible`: this course can never satisfy §4.4.2. */
  categoryIneligible?: true;
  /** The cell exactly as the sheet holds it, for diagnostics and the course
   * rules page's own label. */
  categoryGroupRaw?: string;
  typicallyOffered?: string;
  /** Is the course on the schedule THIS semester, and the NEXT one (DGS
   * 2026-09-09 — the `offered_now` and `offered_next` columns)? These say what
   * the registrar's schedule says today, where `typicallyOffered` is a pattern
   * from past years. Undefined means the cell is blank: the sheet does not
   * say, which is not the same as "no". */
  offeredNow?: boolean;
  offeredNext?: boolean;
  /** `last_offered` as a term ("Fall 2026"), when it reads as one. Since
   * 2026-09-14 it dates the row's schedule columns: `offered_now` /
   * `offered_next` are shown only when this is this semester or later (or the
   * one before, when `offered_next` then means this semester). */
  lastOffered?: Term;
  active: boolean; // course-picker visibility only
  effectiveTerm?: Term;
  notes?: string;
  /** dgs_reviewed = yes: the DGS has confirmed this row. Shown on the public
   * course list; the audit engine ignores it (an unreviewed 'yes' still counts). */
  dgsReviewed: boolean;
  /** 1-based spreadsheet row, for diagnostics. */
  sheetRow: number;
}

/** One row of the Universities tab (DGS 2026-10-10: "I want to enter the
 * credit system for each university" — it was a cell on every ExternalCourses
 * row until then). The name is the one the transcript import reads, exactly as
 * in ExternalCourses (never renamed — CLAUDE.md). */
export interface UniversityRow {
  university: string;
  universityKey: string;
  /** Undefined = blank: the sheet has not said, and credits count as printed. */
  creditSystem?: 'quarter' | 'semester' | 'trimester';
  notes?: string;
  sheetRow: number;
}

export interface SheetIssue {
  severity: 'error' | 'warning';
  tab: string;
  row?: number;
  column?: string;
  message: string; // plain English, written for a DGS editing a spreadsheet
  /** A warning the web pages show too, not only the sync's printout — the
   * self-check's diagnostics box and the course-rules page (DGS 2026-10-12:
   * a university listed twice in the Universities tab, "Let the last row win
   * but show a warning on the web pages"). Errors are always shown. */
  onPage?: true;
}

/** Typed accessors over the Parameters tab. A missing/bad value returns
 * undefined (the engine then reports "cannot evaluate"), never a guess. */
export interface Parameters {
  number(key: string): number | undefined;
  gradeLetter(key: string): string | undefined;
  courseList(key: string): string[] | undefined;
  /** A list of SUBJECT codes, upper-cased ("CS; CSCI" → ['CS','CSCI']).
   * undefined = the key is missing OR its cell is blank — either way the
   * sheet has not said, and nothing is decided from it. */
  codeList(key: string): string[] | undefined;
  raw: ReadonlyMap<string, { value: string; section: string; row: number }>;
}

export interface Rules {
  /** courseId → all its rows, sorted by effectiveTerm ascending. */
  courses: ReadonlyMap<string, RuleCourse[]>;
  parameters: Parameters;
  coreAreas: { code: string; name: string }[];
  categoryGroups: { code: string; name: string }[]; // the real groups; 'ineligible' is not one
  /** The DGS's rulings on courses from other universities (§4.4.1/§5.2);
   * empty until the ExternalCourses tab exists and is published. */
  external: ExternalRule[];
  /** The Universities tab (DGS 2026-10-10): one row per university, with the
   * credit system it awards in. Empty when the tab is absent. */
  universities: UniversityRow[];
  /** Each university's credit system, by `normalizeUniversity` key: from the
   * Universities tab, or — only when that tab is absent — from the old
   * ExternalCourses `credit_system` cells. Read it through
   * `universityCreditSystem` (src/data/external.ts). */
  universityCreditSystems: ReadonlyMap<string, 'quarter' | 'semester' | 'trimester'>;
  issues: SheetIssue[];
  source: 'live' | 'snapshot';
  syncedAt: string;
  /** When the course rules last changed, as far as the app can tell — see
   * `src/data/rules-date.ts`. Undefined only for rules built without a snapshot
   * (tests); then the pages fall back to "are those in effect for <term>". */
  rulesDate?: RulesDate;
  /** Eight hexadecimal characters naming the exact content the rules were
   * built from (src/data/fingerprint.ts; DGS 2026-10-11, item 8): stamped on
   * every result, and what `npm run reproduce` matches a snapshot commit by. */
  fingerprint: string;
}

/** How the pages know when the rules last changed (`src/data/rules-date.ts`).
 *  - `known`: the rules being shown are the snapshot's content (the live sheet
 *    still matches it, or the snapshot itself is in use) → they last changed
 *    at `at`, i.e. when the sync first saw this content.
 *  - `after`: the live sheet differs from the snapshot → it changed some time
 *    after `at`; the next sync run (within 6 hours) records the date and
 *    redeploys. */
export interface RulesDate {
  kind: 'known' | 'after';
  /** ISO instant — the snapshot's `syncedAt`. */
  at: string;
}

/** Display-only parameter keys: read by the pages, never by the engine. Missing
 * is allowed (nothing shows, no warning); present → shown as given. */
export const DISPLAY_PARAMETER_KEYS = [
  // Optional override for the dated line on both pages (YYYY-MM-DD or free
  // text) → "Rules effective as of …". Without it the pages print the date the
  // rules last changed, as recorded by the sync (`rules-date.ts`).
  'rules_effective_date',
  // Who-to-contact overrides (2026-09-04): names and addresses shown in the
  // contact card, the consent notice, and the review-request emails. A key
  // that is missing or blank keeps the fallback baked into
  // src/ui/contacts.ts — so the next DGS updates the sheet, not the code.
  'contact_dgs_name',
  'contact_dgs_email',
  'contact_adgs_name',
  'contact_adgs_email',
  'contact_grad_admin_name',
  'contact_grad_admin_email',
  // Optional (policy review 2026-10-03): this year's Graduate School deadlines
  // for the application-for-candidacy form, quoted in the candidacy rows'
  // sentence about the form. Blank or missing → the sentence names the
  // Graduate School calendar without dates.
  'candidacy_form_deadlines',
  // `current_semester` / `offered_semester` were read here until 2026-09-14;
  // the schedule is now dated per row by the Courses tab's `last_offered`
  // (DGS). A sheet that still carries the row is not told anything.
] as const;

/** Keys the sheet once carried and the app no longer reads. All five rows were
 * deleted from the live Parameters tab on 2026-10-04 (DGS: "remove any rows
 * that are not needed any more"); a sheet that carries one again is told why,
 * rather than "unknown key". Two are Graduate School numbers that now live in
 * the code beside their source (DGS 2026-10-04: the sheet "only governs the
 * data/parameters that can be controlled/adjusted at the department level";
 * README § A5b). Three had been PARKED — kept in the sheet, read by nothing:
 * - `ms_thesis_readers_min` (§3.4's two readers) was a required key nothing
 *   read; parked 2026-10-04 (P1-sheet-6: "Move this to the parked list").
 * - `candidacy_committee_additional_members_min` (§4.5's "at least three (3)
 *   additional voting members"), the same (DGS 2026-10-04: "The app doesn't
 *   need to count the number of committee members").
 * - `phd_senior_grad_credits_max` sized §3.5's transfer allowance for a
 *   4+1's junior/senior-year 6xxxx courses; withdrawn 2026-09-10 when the DGS
 *   took §5.2 to the Graduate School, whose answer made that coursework count
 *   in full rather than as transfer credit — no allowance left to size. */
export const RETIRED_PARAMETER_KEYS: Readonly<Record<string, string>> = {
  quarter_credit_factor: 'the quarter factor (0.66) is the Graduate School’s — the DGS Handbook’s §3.14 pro-rata table — and has lived in the code since 2026-10-04 (README § A5b)',
  trimester_credit_factor: 'the trimester factor (0.88) is the Graduate School’s — the DGS Handbook’s §3.14 pro-rata table — and has lived in the code since 2026-10-04 (README § A5b)',
  ms_thesis_readers_min: 'no reader count is checked; the thesis row checks the defense (DGS 2026-10-04)',
  candidacy_committee_additional_members_min: 'the candidacy committee is not counted (DGS 2026-10-04: “The app doesn’t need to count the number of committee members”)',
  phd_senior_grad_credits_max: 'the Graduate School’s answer made a 4+1’s pre-bachelor’s 60000-level coursework count in full, not as transfer credit, so there is no allowance to size (data/README.md, Tab Parameters)',
  ms_bs_double_count_credits_max: 'the six credits shared with a bachelor’s degree are the Graduate School’s — Academic Code §4.6 — and have lived in the code since 2026-10-07 (README § A5b)',
};

/** Parameter keys the app reads. Anything else in the sheet is ignored with a
 * gentle warning; anything here that is missing makes its requirement
 * "cannot evaluate". Keep in sync with data/README.md. */
export const KNOWN_PARAMETER_KEYS = [
  'ms_total_credits_min',
  'ms_regular_credits_min',
  'ms_project_credits_min',
  'ms_4xxxx_credits_max',
  'ms_noncse_credits_max',
  // §3.5, through the DGS (2026-09-10): "an ND 4+1 student can have up to 6
  // credits (whether 40xxx or 60xxx courses) counted towards both degrees" —
  // how much of an MSCSE student's coursework may also have counted toward
  // their bachelor's. The Ph.D. has the same six (Graduate School, 2026-09-22),
  // less whatever the bachelor's and the MSCSE already shared; no course may
  // count toward all three degrees.
  'ms_time_limit_years',
  'ms_transfer_completed_ms_credits_max',
  'ms_transfer_window_years',
  'phd_total_credits_min',
  'phd_regular_credits_min',
  'phd_nd_credits_min',
  'phd_seminar_courses',
  'phd_4xxxx_cse_credits_max',
  'phd_noncse_6xxxx_credits_max',
  'phd_transfer_window_years',
  'phd_transfer_completed_ms_credits_max',
  'phd_residency_semesters',
  'phd_time_limit_years',
  'transfer_unfinished_ms_credits_max',
  'transfer_min_grade',
  'fulltime_credits_min',
  // The MSCSE's summer session: full-time at this many registered credits on
  // its own (DGS Handbook §10.3.2: "may include summer session if the student
  // is registered for six or more credits"). A Parameters key by the DGS's
  // choice (2026-10-04, P1-page-text-ui-9), like fulltime_credits_min — the
  // department's full-time definition, never below the Graduate School's six.
  'summer_fulltime_credits_min',
  'qualifier_deadline_semesters',
  'category_courses_required',
  'category_distinct_groups_required',
  'category_min_grade',
  'research_qualifier_deadline_months',
  'candidacy_deadline_semester',
  'gpa_min',
  // The subject codes that mean "a CSE course" on ANOTHER university's
  // transcript (DGS 2026-09-09; the live list is now "CS; CSCI; COMPSCI; CSE;
  // CMSC; EECS; CSYE; ECE; 198" — ECE on purpose, the department reading "a
  // department other than CSE" as "outside computing", DGS 2026-10-04; 198
  // the subject number of Rutgers' Computer Science, "16:198:507", DGS
  // 2026-10-16 — external.ts subjectCode). §4.2
  // (and §3.2 for the MSCSE) caps credits
  // "taken from a department other than CSE" at nine, and until this existed
  // the app could not tell one department from another on a transcript it did
  // not write. A code the list does not name is treated as outside CSE — say
  // otherwise in an ExternalCourses row's `is_cse` cell, which wins. Notre
  // Dame's own courses are decided by their own subject, never by this list.
  'cse_subject_codes',
] as const;
