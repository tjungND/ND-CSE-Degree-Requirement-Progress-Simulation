// Notre Dame unofficial-transcript text → course entries. Pure (text in,
// data out) so it is unit-testable without a PDF.
//
// ND runs Ellucian Banner; the self-service "Academic Transcript (unofficial)"
// lists, per term ("Fall Semester 2026" — the same naming Banner uses in ND's
// own course exports), rows of:
//   SUBJ 12345 [LEVEL] Title… GRADE credits [quality points] [R]
// plus sections "TRANSFER CREDIT ACCEPTED BY INSTITUTION" (origin: transfer),
// "INSTITUTION CREDIT" (origin: nd), "COURSES IN PROGRESS" (no grade → IP),
// and "TRANSCRIPT TOTALS" (the Overall row's last column is the cumulative GPA).
//
// Parsing a PDF's text is inherently best-effort: everything parsed here is
// shown to the student for confirmation before anything is added (never guess).
import { checkTotals, type PrintedTotals, type TotalsMismatch } from './totals-check.ts';
import { isOtherDepartmentMajor } from './majors.ts';
import { joinSpacedSubject } from '../data/assemble.ts';
import { conferralTerm, termIndex, termLabel, termOfDate } from '../engine/term.ts';
import type { Grade, Season, Term, TermGpa } from '../engine/types.ts';
import { looksLikeNotreDameTranscript } from './nd-markers.ts';
import { levelFromNumber, type RegisteredLevel } from './level.ts';
export { levelFromNumber };

export interface ParsedCourse {
  courseId: string;
  title?: string;
  credits: number;
  grade: Grade;
  term: Term;
  origin: 'nd' | 'transfer';
  institution?: string;
  /** The level the row is registered at (2026-09-05) — see RegisteredLevel;
   * on a transfer-block row, the record it sits on (P3-import-1 (b),
   * 2026-10-05), undefined when the transcript does not show it. */
  level?: RegisteredLevel;
}

/** A degree the transcript says was AWARDED (never one merely sought). */
export interface DegreeAwarded {
  /** As printed, e.g. "Bachelor of Science". */
  name: string;
  level: 'bachelors' | 'masters' | 'phd' | 'other';
  /** ISO date when the transcript prints one (same line, or a "Degree Date:"
   * line right after). */
  date?: string;
}

/** Where the student's CURRENT program starts, read from the transcript
 * (2026-09-05). Every deadline (§4.3 eight-year limit, §4.4.3 eighteen months,
 * §4.5 eighth semester) and the §4.3 residency count hang on this term, and
 * a combined transcript (undergraduate + graduate at Notre Dame) does not say
 * it outright — so the reading is explained (`how`) and, when the transcript
 * supports a second reading, that one is named too (`alternative`). */
export interface EntryTermInference {
  term: Term;
  /** Plain English, for the standing card: "the admit-term line on your transcript". */
  how: string;
  /** The other reading, when a Notre Dame degree was awarded mid-record: a
   * separate degree finished BEFORE this program (entry = the term after it),
   * or a degree earned along the way (entry unchanged). The earlier term is
   * chosen — earlier deadlines are the safe error — and the card names this. */
  alternative?: { term: Term; why: string; /** The other program's first term (UI review item 11, 2026-10-09). */ otherProgram?: true };
}

export interface ParsedTranscript {
  isNotreDame: boolean;
  courses: ParsedCourse[];
  /** The cumulative GPA for the §2.2 check: the GRADUATE-level figure when
   * the transcript carries totals per level (a combined undergraduate +
   * graduate Notre Dame transcript prints both — bug report 2026-09-05: the
   * undergraduate figure was being picked up), else the last cumulative
   * figure read. Undefined when only an undergraduate figure exists. */
  cumulativeGpa?: number;
  /** Each level's cumulative GPA, when the transcript labels its totals. */
  cumulativeGpaByLevel?: Partial<Record<RegisteredLevel, number>>;
  warnings: string[];
  /** Degrees the transcript says were awarded, in reading order (2026-09-05). */
  degreesAwarded: DegreeAwarded[];
  /** The current program's entry term, when the transcript supports a reading (2026-09-05). */
  entryTerm?: EntryTermInference;
  /** Each GRADUATE term's "Current Term" and "Cumulative" GPA from its "Term
   * Totals (Graduate)" block (policy review 2026-10-04: Academic Code
   * §5.7.3's "cumulative grade point average below 3.0 in any two semesters"
   * and §5.8's "semester G.P.A. below 2.5 … or below 3.0 for two consecutive
   * semesters"). Empty when the layout prints no such rows. */
  termGpas?: TermGpa[];
  /** Each term the transcript lists, in reading order, with its level (from
   * the term's totals) and its college and major as printed (2026-10-08, the
   * earlier-degrees redesign, Option 1): what tells a Notre Dame bachelor's,
   * and its department, from the transcript — the unofficial transcript
   * prints no degrees awarded. */
  terms?: TranscriptTerm[];
  /** The totals lines read in full — a term's "Current Term", "Cumulative"
   * and the record's "Overall", each with its earned hours, GPA hours and GPA
   * (DGS 2026-10-11, item 11): what the preview checks the rows against
   * (src/transcript/totals-check.ts). A line printing fewer than Banner's six
   * figures is not recorded — nothing is checked on a guess. */
  printedTotals?: PrintedTotals[];
}

/** One term of a Notre Dame transcript: its level and its college and major. */
export interface TranscriptTerm {
  term: Term;
  level?: RegisteredLevel;
  college?: string;
  major?: string;
}

const LETTER_GRADES: Grade[] = ['A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D', 'F', 'S', 'U'];
/** Grades that appear on transcripts but are not registrations the audit can
 * use: rows with no grade shown. Audits (V, Notre Dame's audit grade; AU,
 * other registrars') are KEPT as V since 2026-10-04 (policy review
 * P2-ac-4-10: "the audited course is not shown on the record at all") — the
 * engine reads V as earning nothing and as no registration toward full-time
 * status (Academic Code §4.3; DGS Handbook §3.12). Withdrawals (W, WF, WP) and
 * Incompletes (I) are KEPT since 2026-10-03 (policy review): both are
 * registrations the full-time count must see (§3.3); the engine says what each
 * earns — nothing for a W, and for an I nothing once its 30 + 14 days are up
 * unless the Graduate School extended it (§4.4). */
const SKIP_GRADES = new Set(['X', 'NG']);
const AUDIT_GRADES = new Set(['V', 'AU']);
/** "NR — Not reported" (Academic Code §4.3): the course was taken and its
 * grade is not in yet, so the row is kept as in progress — its registration
 * and credits count until the grade arrives — rather than skipped like an
 * audit (policy review 2026-10-04, P2-ac-4-11). */
const NOT_REPORTED_GRADES = new Set(['NR']);
const WITHDRAWN_GRADES = new Set(['W', 'WF', 'WP']);

const TERM_RE = /\b(Fall|Spring|Summer)\s+(?:Semester\s+|Session\s+)?(\d{4})\b/i;
/** A course still in progress on Notre Dame's official (Parchment) PDF says so
 * in its grade column, after the credits: "CSE   60111 F   Complexity and
 * Algorithms   3.000 IN PROGRESS" (2026-10-14 — a new student's transcript
 * read no course: every row ended in words, not in a credit figure; its shape
 * was read with scripts/diagnose-transcript.mjs, nothing else of it seen).
 * "IP" is the same mark abbreviated. Only right after a credit figure, so a
 * title that ends in "IP" ("Voice over IP") is never read as the mark. */
const IN_PROGRESS_TAIL_RE = /(\d+\.\d{1,3})\s+(?:IN[\s-]*PROGRESS|INPROG(?:RESS)?|IP)\s*$/i;
/** The official PDF closes its record with "**** END OF TRANSCRIPT ****"; the
 * legend page follows — grade scale, campus codes, the history of the
 * numbering (2026-10-14). Nothing after the marker is read as the record —
 * no level word, GPA sentence or degree name from the legend — unless a new
 * record starts (`RECORD_START_RE`), should a combined transcript print the
 * marker after each record. */
const END_OF_TRANSCRIPT_RE = /^\**\s*END\s+OF\s+TRANSCRIPT\s*\**$/;
const RECORD_START_RE = /^(COURSE\s+LEVEL\s*:|UNIVERSITY\s+OF\s+NOTRE\s+DAME\s+CREDIT|INSTITUTION(AL)?\s+CREDIT|TRANSFER\s+CREDIT\s+ACCEPTED)/;
/** A long title Banner wrapped onto the line after its course row — words
 * only, no digits, at most six of them ("Architecture", "and Analysis") —
 * is the rest of that title (DGS 2026-09-22: "Advanced Computer" lost its
 * "Architecture"). Standing notes and headers that can follow a row are
 * refused by name. */
const TITLE_CONTINUATION_RE = /^[A-Za-z][A-Za-z&'’,\-\/()]*(?: [A-Za-z&'’,\-\/()]+){0,5}$/; // no colon: "… CREDIT:" is a section header
/** insideND's course-table header wraps "Credit Hours" and "Quality Points"
 * onto a second line ("Hours   Points") — header words, never a title. */
const HEADER_WORDS_ONLY_RE = /^(?:(?:SUBJECT|COURSE|CAMPUS|LEVEL|TITLE|GRADE|CREDIT|HOURS|QUALITY|POINTS|R)\s*)+$/;
const NOT_A_CONTINUATION_RE = /^(GOOD STANDING|DEAN|HONORS?|TERM|LEVEL|COLLEGE|MAJOR|MINOR|PROGRAM|DEPARTMENT|CONTINUED|CURRENT|CUMULATIVE|INSTITUTION|TRANSFER|UNOFFICIAL|OFFICIAL|PAGE|SUBJ|COURSE|TOTALS?|EHRS|GPA|ACADEMIC|STUDENT|DEGREES?|BACHELOR|MASTER|DOCTOR|FALL|SPRING|SUMMER|UNIVERSITY|NOTRE DAME|CREDIT|RECORD|BEGINNING|END|FIRST YEAR|TRANSCRIPT|OVERALL|COURSES?|GRADUATE|UNDERGRADUATE|WEB|IN PROGRESS)\b/;
// Banner 9's web transcript prints a Campus column ("Main") between the
// number and the Level ("CSE 60618 Main GR Title …", 2026-09-05): one
// capitalized word is skipped there, but only when a level code follows it.
const COURSE_HEAD_RE = /^([A-Z]{2,5})\s+(\d{5})\b\s*(?:[A-Z][A-Za-z]*\s+(?=(?:UG|GR|PR|LW|EM|GB)\b))?(?:(UG|GR|PR|LW|EM|GB)\b)?\s*(.*)$/;
/** Banner term codes: YYYY00 = Summer YYYY, YYYY10 = Fall YYYY, YYYY20 = Spring YYYY+1. */
const BANNER_CODE_RE = /\b(\d{4})(00|10|20)\b/;
/** Lines that state when the student was admitted / matriculated. */
const ADMIT_RE = /\b(ADMIT(?:TED)?\s*TERM|MATRICULAT(?:ED|ION)(?:\s*TERM)?|ENTRY\s*TERM|TERM\s*ADMITTED|ADMITTED\s*(?:FOR|IN)|ENTERED\s*(?:PROGRAM|IN))\b/;
/** Banner's per-term "Student Type" line: "New", "New First Time", "New Graduate"… */
const NEW_STUDENT_RE = /\bSTUDENT\s*TYPE\s*:?\s*NEW\b/;
const DEGREE_WORD_RE = /\b(BACHELOR|MASTER|DOCTOR|PH\.?\s?D)\b/;
const AWARD_WORD_RE = /\b(AWARDED|CONFERRED|CONFERRAL|GRANTED|DEGREE\s*DATE|DEGREE\s*COMPLETION\s*DATE|COMPLETION\s*DATE|GRADUATED|GRADUATION\s*DATE)\b/; // "Conferral Date", "Degree Completion Date" added 2026-09-06 (late evening)
const NOT_AWARDED_RE = /\b(SOUGHT|PENDING|EXPECTED|ANTICIPATED|CANDIDATE|CURRENT\s*PROGRAM|IN\s*PROGRESS)\b|NOT\s+COMPLET|INCOMPLETE/;
/** Three-letter month names, for the dates both transcript parsers read. */
export const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function bannerCodeTerm(code: string): Term {
  const year = Number(code.slice(0, 4));
  const suffix = code.slice(4);
  return suffix === '10' ? { season: 'fall', year } : suffix === '20' ? { season: 'spring', year: year + 1 } : { season: 'summer', year };
}

/** A term stated on a line: "Fall 2022", "Fall Semester 2022", or a Banner code. */
function termOnLine(line: string): Term | undefined {
  const m = TERM_RE.exec(line);
  if (m) return { season: m[1]!.toLowerCase() as Season, year: Number(m[2]) };
  const code = BANNER_CODE_RE.exec(line);
  return code ? bannerCodeTerm(code[1]! + code[2]!) : undefined;
}

/** A calendar date printed on a line, as ISO: "15-MAY-2024", "May 17, 2020",
 * "05/17/2020", "2020-05-17", "05/2020" or "May 2020" (day 15 — only the term matters).
 * Shared with the external parser (degree conferral dates). */
export function dateOnLine(line: string): string | undefined {
  const pad = (n: number) => String(n).padStart(2, '0');
  const month = (name: string) => MONTHS.indexOf(name.slice(0, 3).toUpperCase()) + 1;
  let m = /\b(\d{1,2})[-/ ]([A-Za-z]{3,9})[-/ ,]+(\d{4})\b/.exec(line);
  if (m && month(m[2]!) > 0) return `${m[3]}-${pad(month(m[2]!))}-${pad(Number(m[1]))}`;
  m = /\b([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})\b/.exec(line);
  if (m && month(m[1]!) > 0) return `${m[3]}-${pad(month(m[1]!))}-${pad(Number(m[2]))}`;
  m = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(line);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/.exec(line);
  if (m) return `${m[3]}-${pad(Number(m[1]))}-${pad(Number(m[2]))}`;
  m = /\b(\d{1,2})\/(\d{4})\b/.exec(line); // "05/2024" (2026-09-06, late evening)
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= 12) return `${m[2]}-${pad(Number(m[1]))}-15`;
  m = /\b([A-Za-z]{3,9})\.?\s+(\d{4})\b/.exec(line);
  if (m && month(m[1]!) > 0) return `${m[2]}-${pad(month(m[1]!))}-15`;
  return undefined;
}

function degreeLevelOf(text: string): DegreeAwarded['level'] {
  const u = text.toUpperCase();
  if (/\bBACHELOR/.test(u)) return 'bachelors';
  if (/\bMASTER/.test(u)) return 'masters';
  if (/\bDOCTOR|\bPH\.?\s?D/.test(u)) return 'phd';
  return 'other';
}

/** The degree name as printed, cut before any date, label or column gap. */
function degreeNameOf(line: string): string {
  const m = /\b((?:Bachelor|Master|Doctor)(?:\s+of\s+[A-Za-z&.,' -]+?|(?:'s)?)|Ph\.?\s?D\.?)(?=\s*(?:[-–—:,(]|\d|Degree\b|Awarded\b|Conferred\b|Granted\b|Date\b|in\s+[A-Z]|$))/i.exec(line);
  const name = (m?.[1] ?? line).replace(/\s+/g, ' ').replace(/[\s,.-]+$/, '').trim();
  return name.length > 60 ? name.slice(0, 60).trim() : name;
}

export function parseTranscript(lines: string[]): ParsedTranscript {
  const warnings: string[] = [];
  // The ND marker can live anywhere: the page body, the official PDF's header,
  // or only the browser's print footer (an nd.edu URL) on a printed-to-PDF
  // web transcript — so scan the whole text.
  // Shared with the external parser (nd-markers.ts, 2026-09-05): an nd.edu
  // e-mail address or a "Notre Dame, IN" mailing address is NOT a marker.
  const isNotreDame = looksLikeNotreDameTranscript(lines.join('\n'));
  if (!isNotreDame) {
    return { isNotreDame: false, courses: [], warnings, degreesAwarded: [] };
  }

  let term: Term | undefined;
  let origin: 'nd' | 'transfer' = 'nd';
  let institution: string | undefined;
  let expectInstitution = false;
  let lastGpa: number | undefined;
  const gpaByLevel: Partial<Record<RegisteredLevel, number>> = {};
  /** The level a totals block belongs to ("Term Totals (Graduate)",
   * "Transcript Totals - (Undergraduate)"), until the next term or section. */
  let totalsLevel: RegisteredLevel | undefined;
  const courses: ParsedCourse[] = [];
  const skipped: string[] = [];
  /** NR rows kept as in progress (2026-10-04). */
  const notReported: string[] = [];
  /** Each graduate term's figures, by term index (2026-10-04). */
  const termGpaByIndex = new Map<number, TermGpa>();
  /** Every totals line read in full (item 11, 2026-10-11). */
  const printedTotals: PrintedTotals[] = [];
  /** Banner's six figures — Attempt, Passed, Earned, GPA Hours, Quality
   * Points, GPA — as a printed total of `scope`; a GPA cell left blank leaves
   * five, and the line is then recorded without its GPA. */
  const recordTotals = (scope: PrintedTotals['scope'], line: string): void => {
    const nums = (line.match(/\d+\.\d{1,3}/g) ?? []).map(Number);
    if (nums.length !== 6 && nums.length !== 5) return;
    const [, , earned, gpaHours, , gpa] = nums;
    printedTotals.push({
      scope,
      ...(term !== undefined && scope !== 'overall' ? { term } : {}),
      ...(totalsLevel !== undefined ? { level: totalsLevel } : {}),
      earned: earned!,
      gpaHours: gpaHours!,
      ...(nums.length === 6 ? { gpa: gpa! } : {}),
    });
  };

  // Signals for the entry-term reading and the per-course level (2026-09-05).
  const admitTerms: Term[] = [];
  const newStudentTerms = new Set<number>();
  const termLevelHints = new Map<number, RegisteredLevel>();
  /** Each term's college and major, by term index, in reading order (2026-10-08). */
  const termRecords = new Map<number, TranscriptTerm>();
  const recordTerm = (t: Term, info: { college?: string; major?: string }): void => {
    const rec = termRecords.get(termIndex(t)) ?? { term: t };
    if (info.college) rec.college = info.college;
    if (info.major) rec.major = info.major;
    termRecords.set(termIndex(t), rec);
  };
  /** insideND's "College   Major   Academic Standing" header: the values are the next line. */
  let expectCollegeMajor = false;
  let collegeMajorCells = 0; // the header's columns: College / Major (/ Academic Standing)
  /** Inside the TRANSCRIPT TOTALS block (2026-10-08): its "( Graduate )" /
   * "( Undergraduate )" lines are the totals' level, never the last term's —
   * read as a term hint, they relabelled the last completed term's courses
   * (seen on the DGS's redacted insideND copies: a graduate Spring term read
   * as undergraduate). Ends at the next term line. */
  let inTranscriptTotals = false;
  /** "Course Level: Graduate" (official PDF) / "Transcript Level: Graduate"
   * (Banner 9 web): the level of every row until the next such line. Kept per
   * course as it is read (`courseSectionLevel`), since a combined official
   * transcript holds several records. */
  let sectionLevel: RegisteredLevel | undefined;
  const courseSectionLevel: (RegisteredLevel | undefined)[] = [];
  const degreesAwarded: DegreeAwarded[] = [];
  let inDegreesAwarded = false; // inside a "DEGREES AWARDED" block
  let degreeAwaitingDate: DegreeAwarded | undefined; // a "Degree Date:" line may follow

  /** One course row (the tail after `COURSE_HEAD_RE`): walk its tokens for the
   * credits and the grade, and file the course under the current term, origin
   * and level. A row that is not a course after all, or one with no grade to
   * keep, is skipped — with a note where the student should add it by hand. */
  /** The index of the course whose row was the previous line, while its title may continue. */
  let titleOpen: number | undefined;
  /** The previous non-empty line: whether it reads as a piece of a title, and
   * the course it was added to as the rest of a title, if it was. A table
   * printed with its one-line cells centred against a two-line title puts the
   * title's FIRST line above its row (DGS 2026-10-30, a title cut off at its
   * wrap): the row then has no title of its own, and that line is its start —
   * taken back from the course before if it had been added there. */
  let lastLine: { text: string; titleLike: boolean; appendedTo?: number } | undefined;
  const readNdCourseRow = (courseMatch: RegExpExecArray, rawLine: string): void => {
    expectInstitution = false;

    const [, subject, number, levelCode, matchedRest] = courseMatch;
    const courseId = `${subject} ${number}`;
    // The Level column: UG = undergraduate; GR (graduate), PR (professional),
    // LW (law), EM/GB (business graduate) are all graduate-status registrations.
    const rowLevel: RegisteredLevel | undefined = levelCode === undefined ? undefined : levelCode === 'UG' ? 'undergraduate' : 'graduate';

    let rest = matchedRest ?? '';
    // The official PDF prints one letter beside the course number, in the
    // number's own cell ("60111 F", then a column gap — 2026-10-14). It is
    // not the title's first word: a title begins after the gap. Read only
    // when the raw line shows it so; it means nothing to the audit.
    if (levelCode === undefined && new RegExp(`\\b${number} [A-Z](?=\\s{2,})`).test(rawLine)) rest = rest.replace(/^[A-Z]\s+/, '');
    // "3.000 IN PROGRESS" (or "3.000 IP"): in progress, whatever the title's
    // last word looks like (2026-10-14).
    const inProgress = IN_PROGRESS_TAIL_RE.test(rest);
    if (inProgress) rest = rest.replace(IN_PROGRESS_TAIL_RE, '$1');

    // Walk the tail tokens: trailing decimals are credits [+ quality points];
    // the token before them, if it looks like a grade, is the grade.
    const tokens = rest.trim().split(' ').filter((t) => t !== '');
    while (tokens.length > 0 && /^(R|E)$/.test(tokens[tokens.length - 1]!)) tokens.pop(); // repeat/exclude markers
    const decimals: number[] = [];
    while (tokens.length > 0 && /^\d+\.\d{1,3}$/.test(tokens[tokens.length - 1]!)) {
      decimals.unshift(Number(tokens.pop()));
      if (decimals.length === 4) break;
    }
    if (decimals.length === 0) return; // not a course row (no credit hours)
    // Web-transcript layout: "… GRADE credits [qualityPoints]" — with 2+
    // trailing decimals the FIRST is the credit hours.
    const credits = decimals[0]!;

    let grade: Grade | undefined;
    const tail = tokens[tokens.length - 1] ?? '';
    const tailUpper = tail.toUpperCase();
    let creditsOverride: number | undefined;
    const popCreditsBeforeGrade = () => {
      // ND's OFFICIAL PDF orders columns "… credits GRADE qualitypoints"
      // (e.g. "Tpcs in Evol Biol 3.000 B+ 9.999") — after removing the grade,
      // a decimal still trails the title: THAT is the credit-hours value.
      const prev = tokens[tokens.length - 1] ?? '';
      if (/^\d+\.\d{1,3}$/.test(prev) && Number(prev) <= 20) {
        creditsOverride = Number(tokens.pop());
      }
    };
    if (inProgress) {
      // Marked in progress after its credits: no grade to read.
    } else if (LETTER_GRADES.includes(tailUpper as Grade) || tailUpper === 'A+') {
      grade = tailUpper === 'A+' ? 'A' : (tailUpper as Grade); // A+ → A: the top of ND's scale (2026-09-05)
      tokens.pop();
      popCreditsBeforeGrade();
    } else if (tailUpper === 'P' || tailUpper === 'PASS') {
      grade = 'S';
      tokens.pop();
      popCreditsBeforeGrade();
    } else if (WITHDRAWN_GRADES.has(tailUpper)) {
      // Withdrawn: kept as a W (2026-10-03) — a registration that earns no
      // credit, which the engine and the full-time count read as such.
      grade = 'W';
      tokens.pop();
      popCreditsBeforeGrade();
    } else if (tailUpper === 'I' && decimals.length >= 2) {
      // A lone trailing "I" on a row with only a credit value is a Roman
      // numeral in the title ("Calculus I   3.000" in the official PDF's
      // transfer block), not an Incomplete — a graded row carries quality
      // points too (2026-09-05). A real Incomplete is kept as an I (2026-10-03).
      grade = 'I';
      tokens.pop();
      popCreditsBeforeGrade();
    } else if (AUDIT_GRADES.has(tailUpper)) {
      // An audit: kept as a V (2026-10-04), which counts toward nothing.
      grade = 'V';
      tokens.pop();
      popCreditsBeforeGrade();
    } else if (tailUpper === 'IP' && /^\d+\.\d{1,3}$/.test(tokens[tokens.length - 2] ?? '')) {
      // "3.000 IP 0.000": the official PDF's grade column between the credits
      // and the quality points (2026-10-14).
      grade = 'IP';
      tokens.pop();
      popCreditsBeforeGrade();
    } else if (NOT_REPORTED_GRADES.has(tailUpper)) {
      grade = 'IP';
      tokens.pop();
      popCreditsBeforeGrade();
      if (term) notReported.push(`${courseId} (${termLabel(term)})`);
    } else if (SKIP_GRADES.has(tailUpper)) {
      skipped.push(`${courseId} (${tailUpper})`);
      return;
    } else if (tailUpper === 'TR') {
      tokens.pop();
      skipped.push(`${courseId} (TR — the original grade is not shown; add it manually)`);
      return;
    }

    const resolvedCredits = creditsOverride ?? credits;
    if (resolvedCredits > 20) return; // not a plausible credit-hours value

    if (!term) {
      warnings.push(`${courseId} appeared before any term header — it was skipped; add it manually.`);
      return;
    }

    titleOpen = courses.length;
    courses.push({
      courseId,
      title: tokens.join(' ') || undefined,
      credits: resolvedCredits,
      grade: grade ?? 'IP',
      term,
      origin,
      institution: origin === 'transfer' ? institution : undefined,
      // A transfer-block row keeps its level too (policy review round 3,
      // P3-import-1 (b)): a combined transcript's undergraduate record has its
      // own block — AP or community-college credit accepted for the bachelor's —
      // which is never graduate transfer credit.
      level: rowLevel,
    });
    courseSectionLevel.push(sectionLevel);
  };

  let afterEndOfTranscript = false;
  for (const rawLine of lines) {
    // "C S E 60641" reads as "CSE 60641" (DGS 2026-09-20).
    const line = joinSpacedSubject(rawLine.replace(/\s+/g, ' ').trim());
    if (line === '') continue;
    const upper = line.toUpperCase();
    if (END_OF_TRANSCRIPT_RE.test(upper)) {
      afterEndOfTranscript = true;
      titleOpen = undefined;
      continue;
    }
    if (afterEndOfTranscript) {
      if (!RECORD_START_RE.test(upper)) continue;
      afterEndOfTranscript = false;
    }
    // Matched once per line: three guards below and the course-row reader all ask.
    const courseMatch = COURSE_HEAD_RE.exec(line);
    const titleLike = !courseMatch && TITLE_CONTINUATION_RE.test(line) && !NOT_A_CONTINUATION_RE.test(upper) && !TERM_RE.test(line) && !HEADER_WORDS_ONLY_RE.test(upper);
    const before = lastLine;
    lastLine = { text: line, titleLike };
    // The line right after a course row may be the rest of its title.
    if (titleOpen !== undefined) {
      const idx = titleOpen;
      titleOpen = undefined;
      if (titleLike) {
        const c = courses[idx]!;
        c.title = c.title ? `${c.title} ${line}` : line;
        lastLine.appendedTo = idx;
        continue;
      }
    }

    // ---- header signals (2026-09-05) ----
    if (ADMIT_RE.test(upper)) {
      const t = termOnLine(line);
      if (t) admitTerms.push(t);
      continue;
    }
    if (NEW_STUDENT_RE.test(upper)) {
      if (term) newStudentTerms.add(termIndex(term));
      continue;
    }
    // Each term's college and major (2026-10-08, Option 1 of the
    // earlier-degrees redesign): how the import tells a Notre Dame bachelor's,
    // and its department, from the transcript. Two forms: "College: …" /
    // "Major: …" lines, and insideND's table — a "College   Major   Academic
    // Standing" header with the values on the next line, cells three spaces
    // apart (rawLine keeps the gaps; `line` collapses them).
    // A page break between the header and its values: the print's own header
    // and footer lines come first (blue/red-team review, 2026-10-08) — they
    // are skipped while the values are awaited.
    const furniture = expectCollegeMajor && rawLine.trim().split(/\s{3,}/).every((cell) => PAGE_FURNITURE_RE.test(cell.trim()));
    if (expectCollegeMajor && !furniture) {
      expectCollegeMajor = false;
      const cells = rawLine.trim().split(/\s{3,}/);
      if (term && !courseMatch && cells.length >= 2) {
        // With a cell blank, the second one may be the standing (a blank
        // major beside "Good Standing"): a standing is never read as the
        // major (review of Option 1, 2026-10-08). A blank standing leaves
        // the college and the major, as they are.
        const second = cells[1]!.trim();
        const isStanding = cells.length < collegeMajorCells && /\b(standing|probation|warning|dismiss)/i.test(second);
        recordTerm(term, isStanding ? { college: cells[0]!.trim() } : { college: cells[0]!.trim(), major: second });
        continue;
      }
    }
    if (/^COLLEGE\s{2,}MAJOR\b/.test(rawLine.trim().toUpperCase())) {
      expectCollegeMajor = true;
      collegeMajorCells = rawLine.trim().split(/\s{3,}/).length;
      continue;
    }
    const labelled = /^(COLLEGE|MAJOR)\s*:\s*(.+)$/i.exec(line);
    if (labelled && term && !courseMatch) recordTerm(term, labelled[1]!.toUpperCase() === 'COLLEGE' ? { college: labelled[2]!.trim() } : { major: labelled[2]!.trim() });
    // Degrees awarded: a block header ("DEGREES AWARDED"), a line that names a
    // degree together with an award word ("Degree Awarded Doctor of Philosophy
    // 15-MAY-2024", "Bachelor of Science — Conferred May 2020"), or a degree
    // name inside the block; a "Degree Date:" line right after supplies the
    // date. "Sought"/"Current Program" lines name a degree that is NOT awarded.
    if (/^DEGREES?\s+(AWARDED|CONFERRED|EARNED)\b/.test(upper) && !DEGREE_WORD_RE.test(upper.replace(/^DEGREES?\s+(AWARDED|CONFERRED|EARNED)/, ''))) {
      inDegreesAwarded = true;
      continue;
    }
    if (/^(CURRENT\s+PROGRAM|CURRICULUM\s+INFORMATION|INSTITUTION(AL)?\s+CREDIT|TRANSFER\s+CREDIT|COURSES?\s+IN\s+PROGRESS|IN\s+PROGRESS\s+WORK|TRANSCRIPT\s+TOTALS)/.test(upper)) {
      inDegreesAwarded = false;
      degreeAwaitingDate = undefined;
    }
    if (degreeAwaitingDate && AWARD_WORD_RE.test(upper) && !DEGREE_WORD_RE.test(upper)) {
      const date = dateOnLine(line);
      if (date) degreeAwaitingDate.date = date;
      degreeAwaitingDate = undefined;
      continue;
    }
    if (DEGREE_WORD_RE.test(upper) && !courseMatch && !NOT_AWARDED_RE.test(upper) && (inDegreesAwarded || AWARD_WORD_RE.test(upper))) {
      const degree: DegreeAwarded = { name: degreeNameOf(line), level: degreeLevelOf(line), date: dateOnLine(line) };
      degreesAwarded.push(degree);
      degreeAwaitingDate = degree.date ? undefined : degree;
      continue;
    }
    // Level markers: the term's totals line ("Term Totals (Graduate)"), a
    // "Level: Graduate" line, or the term block's college ("College: Graduate
    // School" — Notre Dame's graduate programs all sit in the Graduate School).
    if (/^TRANSCRIPT\s*TOTALS\b/.test(upper)) inTranscriptTotals = true;
    const levelWord = /\b(UNDERGRADUATE|GRADUATE)\b/.exec(upper);
    if (levelWord && !courseMatch && inTranscriptTotals && !TERM_RE.test(line)) {
      totalsLevel = levelWord[1] === 'UNDERGRADUATE' ? 'undergraduate' : 'graduate';
      continue;
    }
    if (levelWord && !courseMatch) {
      const level: RegisteredLevel = levelWord[1] === 'UNDERGRADUATE' ? 'undergraduate' : 'graduate';
      if (/^(COURSE\s+)?LEVEL\s*:/.test(upper)) {
        // The official PDF opens each RECORD with "Course Level: Undergraduate"
        // / "Course Level: Graduate …" — everything that follows, until the
        // next such line, is at that level (2026-09-05); a term seen before
        // it belongs to the previous record.
        sectionLevel = level;
        term = undefined;
        continue;
      }
      if (/^(TERM\s+TOTALS|\(?(UNDER)?GRADUATE\)?$|COLLEGE\s*:?\s*(THE\s+)?GRADUATE\s+SCHOOL)/.test(upper)) {
        if (term) {
          termLevelHints.set(termIndex(term), level);
          recordTerm(term, {});
        } else sectionLevel = level;
        if (/^TERM\s+TOTALS/.test(upper)) totalsLevel = level;
        continue;
      }
      // "Transcript Totals - (Graduate)": the level of the Overall row below.
      if (/^TRANSCRIPT\s+TOTALS/.test(upper)) {
        totalsLevel = level;
        continue;
      }
    }
    // Banner 9's "Transcript Level" table: the value row's first cell is the
    // level word ("Graduate   Web Transcript   …", 2026-09-05).
    const rawUpper = rawLine.trim().toUpperCase();
    if (/^(UNDERGRADUATE|GRADUATE)(\s{2,}|$)/.test(rawUpper) && !term) {
      sectionLevel = rawUpper.startsWith('UNDERGRADUATE') ? 'undergraduate' : 'graduate';
      continue;
    }

    // Section switches — tolerant of both Banner 8 ("INSTITUTION CREDIT",
    // "COURSES IN PROGRESS", trailing "-Top-" link text) and Banner 9
    // ("Institutional Credit", "Course(s) in Progress") wording.
    if (/TRANSFER CREDIT ACCEPTED|TRANSFER CREDIT\b/.test(upper)) {
      origin = 'transfer';
      expectInstitution = true;
      continue;
    }
    if (/INSTITUTION(AL)? CREDIT|UNIVERSITY OF NOTRE DAME CREDIT/.test(upper)) {
      // Banner web: "INSTITUTION CREDIT"; the official (Parchment) PDF:
      // "UNIVERSITY OF NOTRE DAME CREDIT:" (2026-09-05).
      origin = 'nd';
      institution = undefined;
      totalsLevel = undefined;
      continue;
    }
    // The official PDF: "IN PROGRESS WORK" under the term (2026-10-14). Never
    // a course row: a title such as "Research in Progress Workshop" is not a
    // heading (review of the fix, 2026-10-14 — it dropped the row and turned
    // the rest of a transfer block into Notre Dame courses).
    if (!courseMatch && /COURSE\(?S?\)? IN PROGRESS|WORK IN PROGRESS|^IN PROGRESS WORK\b/.test(upper)) {
      origin = 'nd';
      institution = undefined;
      continue;
    }
    if (/TRANSCRIPT TOTALS/.test(upper)) continue;

    // Cumulative GPA. Web transcript: the "Overall" totals row's last ≤4.334
    // decimal (and each term's "Cumulative" row under "Term Totals (Level)").
    // Official ND PDF: running totals like "NOTRE DAME Ehrs: 72.000 QPts:
    // 106.000 GPA-Hrs: 28.000 GPA: 3.786" — take the labeled value. Every
    // figure is filed under the level of its totals block (or of the record,
    // "Course Level: Graduate"), so a combined transcript's graduate figure
    // can be told from its undergraduate one (bug report 2026-09-05); the
    // LAST occurrence is also kept for transcripts that label no level.
    const noteGpa = (value: number): void => {
      lastGpa = value;
      const lvl = totalsLevel ?? sectionLevel;
      if (lvl) gpaByLevel[lvl] = value;
    };
    // A GPA over zero GPA hours is no GPA (policy review round 3,
    // P3-ac-5b-6.1-1; DGS 2026-10-05): a term or record whose only grades are
    // S or W (research, a withdrawal) prints "0.000" GPA hours and either a
    // 0.000 GPA or a blank GPA cell. Read as a figure, it was a
    // semester GPA of 0.00 — two false Academic Code §5.8 dismissal grounds for
    // a Ph.D. student in research-only semesters. Banner's totals rows read
    // Attempt, Passed, Earned, GPA Hours, Quality Points, GPA; with the GPA
    // cell blank the last figure is the quality points, so the GPA hours (the
    // fourth figure) are what is tested, not the GPA.
    const labeledHours = /\bGPA-?\s?Hrs:?\s*(\d+\.\d{1,3})/i.exec(line);
    const noGpaHours = (): boolean => {
      if (labeledHours) return Number(labeledHours[1]) === 0;
      const nums = line.match(/\d+\.\d{1,3}/g);
      return nums !== null && nums.length >= 5 && Number(nums[3]) === 0;
    };
    const labeledGpa = /\bGPA:?\s*([0-4]\.\d{1,3})\b\s*$/.exec(line);
    if (labeledGpa) {
      if (!noGpaHours()) noteGpa(Number(labeledGpa[1]));
      continue;
    }
    // A graduate term's own rows under "Term Totals (Graduate)": "Current
    // Term … GPA" and "Cumulative … GPA" (Banner's web transcript) — kept per
    // term for Academic Code §5.7.3 / §5.8 (policy review 2026-10-04). The
    // term's GPA is the last ≤ 4.334 figure on the row, as for the totals.
    const lastGpaOn = (): number | undefined => {
      const nums = line.match(/\d+\.\d{1,3}/g);
      if (!nums || nums.length === 0) return undefined;
      const last = Number(nums[nums.length - 1]);
      return last <= 4.334 ? last : undefined;
    };
    const termRow = (field: 'termGpa' | 'cumulativeGpa', value: number | undefined): void => {
      if (term === undefined || totalsLevel !== 'graduate' || value === undefined) return;
      const key = termIndex(term);
      const entry = termGpaByIndex.get(key) ?? { term };
      entry[field] = value;
      termGpaByIndex.set(key, entry);
    };
    if (/^CURRENT\s+TERM\b/.test(upper) && totalsLevel !== undefined) {
      termRow('termGpa', noGpaHours() ? undefined : lastGpaOn());
      recordTotals('term', line);
      continue;
    }
    if (/^OVERALL\b/.test(upper) || /\bCUMULATIVE\b.*\bGPA\b/.test(upper) || (/^CUMULATIVE\b/.test(upper) && totalsLevel !== undefined)) {
      // The official PDF splits its totals over two lines, "OVERALL Ehrs: …
      // QPts: …" and then "GPA-Hrs: … GPA: …": the first line's last figure is
      // the quality points, never a GPA (a 0.000 there read as a GPA of 0.00).
      const qualityPointsLast = /\bQPts\b/i.test(line) && !/\bGPA\b(?!-)/i.test(line);
      const last = noGpaHours() || qualityPointsLast ? undefined : lastGpaOn();
      if (last !== undefined) {
        noteGpa(last);
        if (/^CUMULATIVE\b/.test(upper)) termRow('cumulativeGpa', last);
      }
      if (!/\bQPts\b|\bEhrs\b/i.test(line)) recordTotals(/^OVERALL\b/.test(upper) ? 'overall' : 'cumulative', line);
      continue;
    }

    // Term headers ("Fall Semester 2026", "Term: Spring Semester 2027", …).
    const termMatch = TERM_RE.exec(line);
    if (termMatch && !courseMatch) {
      term = { season: termMatch[1]!.toLowerCase() as Season, year: Number(termMatch[2]) };
      totalsLevel = undefined;
      inTranscriptTotals = false;
      // The official PDF's transfer block puts the source institution on the
      // term line ("Fall 2020   College Board", 2026-09-05).
      if (origin === 'transfer') {
        const rest = line.replace(TERM_RE, '').replace(/^[\s:,-]+|[\s:,-]+$/g, '').trim();
        if (/[A-Za-z]{4,}/.test(rest)) {
          institution = rest;
          expectInstitution = false;
        }
      }
      continue;
    }

    // In the transfer section, a non-course line right after the header names
    // the attempt period and source institution (e.g. "202010: Purdue
    // University"). ND's Banner term codes: YYYY00 = Summer YYYY, YYYY10 =
    // Fall YYYY, YYYY20 = Spring YYYY+1 (confirmed against ND's own catalog
    // exports: 202610 = "Fall Semester 2026", 201800 = "Summer Session 2018").
    if (!courseMatch) {
      if (expectInstitution && origin === 'transfer' && /[A-Za-z]{4,}/.test(line) && !TERM_RE.test(line)) {
        const code = /^(\d{4})(00|10|20)\b/.exec(line);
        if (code) term = bannerCodeTerm(code[1]! + code[2]!);
        institution = line.replace(/^\d+\s*:?\s*/, '').replace(/[.:]\s*$/, '').trim() || undefined;
        expectInstitution = false;
      }
      continue;
    }
    const count = courses.length;
    readNdCourseRow(courseMatch, rawLine);
    // A row with no title of its own, right after a line of title words: that
    // line is the start of its title (see `lastLine`).
    const added = courses.length > count ? courses[courses.length - 1] : undefined;
    if (added !== undefined && added.title === undefined && before?.titleLike) {
      if (before.appendedTo !== undefined) {
        const prev = courses[before.appendedTo]!;
        prev.title = prev.title === before.text ? undefined : prev.title?.endsWith(` ${before.text}`) ? prev.title.slice(0, -before.text.length - 1) : prev.title;
      }
      added.title = before.text;
    }
  }

  if (skipped.length > 0) {
    warnings.push(`Skipped (no grade shown): ${skipped.join(', ')}.`);
  }
  if (notReported.length > 0) {
    warnings.push(`Grade not reported yet (NR): ${notReported.join(', ')} — added as in progress, so the registration and its credits count until the grade arrives; ask the instructor or the Registrar.`);
  }

  // De-duplicate identical rows (the same course line can appear in both a term
  // listing and a summary block).
  const seen = new Set<string>();
  const unique = courses.filter((c) => {
    const key = `${c.courseId}|${c.term.season}${c.term.year}|${c.grade}|${c.credits}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Fill in the level of Notre Dame rows that carried no Level column: the
  // term's level block, then the record's "Course Level:" / "Transcript
  // Level" line, then the course number (2026-09-05). The record level beats
  // the number: an undergraduate's 60000-level course is undergraduate
  // coursework (§5.2 needs graduate student status).
  courses.forEach((c, i) => {
    if (c.level !== undefined) return;
    // A transfer row's level is the record it sits under ("Course Level:" /
    // "Transcript Level"), never its number: another university numbers its
    // courses its own way, and the block's term is when the credit was
    // recorded. Absent both, the level stays unknown and the credit waits for
    // the DGS (P3-import-1, condition 1).
    if (c.origin === 'transfer') {
      c.level = courseSectionLevel[i];
      return;
    }
    c.level = termLevelHints.get(termIndex(c.term)) ?? courseSectionLevel[i] ?? levelFromNumber(c.courseId);
  });

  // The §2.2 figure: the graduate level's when levels are labeled (never the
  // undergraduate one), else the last figure read.
  const labeled = gpaByLevel.graduate !== undefined || gpaByLevel.undergraduate !== undefined;
  const cumulativeGpa = labeled ? gpaByLevel.graduate : lastGpa;

  // Every term the transcript heads, with its level and major (insideND).
  const termList: TranscriptTerm[] = [...termRecords.entries()].sort((a, b) => a[0] - b[0]).map(([k, r]) => ({ ...r, ...(termLevelHints.has(k) ? { level: termLevelHints.get(k)! } : {}) }));
  return {
    isNotreDame: true,
    courses: unique,
    cumulativeGpa,
    cumulativeGpaByLevel: labeled ? gpaByLevel : undefined,
    warnings,
    degreesAwarded,
    entryTerm: inferEntryTerm({ courses: unique, admitTerms, newStudentTerms, degreesAwarded, terms: termList }),
    ...(termGpaByIndex.size > 0 ? { termGpas: [...termGpaByIndex.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v) } : {}),
    ...(termList.length > 0 ? { terms: termList } : {}),
    ...(printedTotals.length > 0 ? { printedTotals } : {}),
  };
}

/** The import's own check (DGS 2026-10-11, item 11): every printed total the
 * rows read do not add up to — each row with its term's level, a transfer
 * block row as earned credit. */
export function totalsMismatchesOf(p: ParsedTranscript): TotalsMismatch[] {
  if (!p.printedTotals || p.printedTotals.length === 0) return [];
  const termLevel = new Map((p.terms ?? []).map((t) => [termIndex(t.term), t.level]));
  return checkTotals(
    p.courses.map((c) => ({ term: c.term, credits: c.credits, grade: c.grade, level: c.level, termLevel: termLevel.get(termIndex(c.term)), transferBlock: c.origin === 'transfer' })),
    p.printedTotals,
  );
}

// levelFromNumber — Notre Dame's course-number rule — lives in level.ts since
// 2026-10-26 (the page needs it before the reader loads); imported above and
// re-exported, so `import { levelFromNumber } from './parse.ts'` still works.

/** A print's page header or footer cell, between a table header and its
 * values at a page break: blank, "Page 2 of 3", the repeated "University of
 * Notre Dame" / "(Unofficial) Academic Transcript" heading, the browser's URL,
 * page number ("1/3") or date stamp ("10/8/26, 3:12 AM   Academic Transcript"
 * is two such cells). */
const PAGE_FURNITURE_RE = /^$|^page\s+\d+(?:\s+of\s+\d+)?$|^\d+\s*\/\s*\d+$|^university\s+of\s+notre\s+dame$|^(?:(?:un)?official\s+)?academic\s+transcript$|https?:\/\/|inside\.nd|^\d{1,2}\/\d{1,2}\/\d{2,4}(?:,?\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:am|pm)?)?$/i;

/** The current program's entry term (2026-09-05). Precedence:
 *   1. a stated admit / matriculation term (the latest one, when a transcript
 *      with several curricula states several — the most recent admission is
 *      the current program);
 *   2. the latest graduate-level term whose block says "Student Type: New…"
 *      (Banner marks the first term of a new admission);
 *   3. the first graduate-level term (rows registered at the graduate level);
 *   4. with no graduate-level rows at all: the first term after the last
 *      degree awarded, else the earliest term.
 * Under 3, a degree awarded with graduate-level terms on BOTH sides supports
 * a second reading (a separate earlier degree — 4+1, a prior Notre Dame M.S.
 * — versus a degree earned along the way); the earlier term is kept, because
 * earlier deadlines are the safe mistake, and the other reading is returned
 * as `alternative` for the standing card to spell out. */
export function inferEntryTerm(args: {
  courses: ParsedCourse[];
  admitTerms: Term[];
  newStudentTerms: Set<number>;
  degreesAwarded: DegreeAwarded[];
  /** Each term's level and major, where the transcript marks them (insideND). */
  terms?: readonly TranscriptTerm[];
}): EntryTermInference | undefined {
  const { courses, admitTerms, newStudentTerms, degreesAwarded } = args;
  const byIndex = (a: Term, b: Term) => termIndex(a) - termIndex(b);
  // Admissions are in fall and spring (DGS 2026-10-03): a summer admit-term or
  // first term is an early start whose official matriculation is that fall.
  const fallFor = (t: Term): Term => (t.season === 'summer' ? { season: 'fall', year: t.year } : t);
  if (admitTerms.length > 0) {
    const sorted = [...admitTerms].map(fallFor).sort(byIndex);
    const earliest = sorted[0]!;
    const latest = sorted[sorted.length - 1]!;
    if (termIndex(earliest) === termIndex(latest)) return { term: latest, how: 'the admit-term line on your transcript' };
    // Two admissions (DGS 2026-09-26): with a master's degree awarded between
    // them, the later one is the Ph.D. entry — the finished MSCSE does not
    // count toward §4.5's eight semesters. Without one the student
    // transferred into the Ph.D. mid-way — from the Notre Dame MSCSE, or from
    // another Notre Dame graduate program, whose clock the Graduate School does
    // not reset either (DGS Handbook §3.15; DGS 2026-10-03: read the
    // matriculation term rather than ask) — and keeps the earlier clock, so
    // the EARLIER admission is the entry term; the later is offered as the
    // other reading (earlier deadlines are the safe mistake).
    const mastersBetween = degreesAwarded.some(
      (d) => d.level === 'masters' && d.date !== undefined && termIndex(conferralTerm(d.date)) >= termIndex(earliest) && termIndex(conferralTerm(d.date)) < termIndex(latest),
    );
    if (mastersBetween) return { term: latest, how: 'the later admit-term line on your transcript — the admission after your master’s degree' };
    return {
      term: earliest,
      how: 'the earlier of the admit-term lines on your transcript — your matriculation at the Graduate School, which a transfer between Notre Dame programs does not reset',
      alternative: {
        term: latest,
        why:
          `your transcript states a later admission, ${termLabel(latest)}. If you finished a master’s degree before that admission, the entry term is ${termLabel(latest)}; ` +
          `a transfer into the Ph.D. from the MSCSE or from another Notre Dame graduate program keeps the earlier term (DGS 2026-09-26; DGS Handbook §3.15), so ${termLabel(earliest)} is set until you change it`,
      },
    };
  }
  // insideND marks every term's level ("Term Totals (Graduate)") and major
  // (review of Option 1, 2026-10-08). The entry term is then the first
  // GRADUATE term in CSE: a 4+1's senior-year graduate courses sit in
  // undergraduate terms (the first term after the bachelor's is the master's
  // year, DGS 2026-09-10), and graduate terms in another department are an
  // earlier program. A term still in progress (no totals yet) counts when it
  // follows the last marked term and every row in it is registered at the
  // graduate level (a 4+1 senior's term mixes the two). With levels marked
  // and no graduate term, nothing is read from the undergraduate ones. A
  // stated admission or a "Student Type: New" term still decides first.
  const marked = (args.terms ?? []).filter((t) => t.level !== undefined);
  if (marked.length > 0 && degreesAwarded.length === 0 && newStudentTerms.size === 0) {
    const lastMarked = Math.max(...marked.map((t) => termIndex(t.term)));
    const allGraduate = (t: Term): boolean => {
      const rows = courses.filter((c) => c.origin === 'nd' && termIndex(c.term) === termIndex(t));
      return rows.length > 0 && rows.every((c) => c.level === 'graduate');
    };
    const candidates = (args.terms ?? []).filter((t) => t.level === 'graduate' || (t.level === undefined && termIndex(t.term) > lastMarked && allGraduate(t.term)));
    const cse = candidates.find((t) => !isOtherDepartmentMajor(t.major));
    if (cse === undefined) return undefined;
    const before = candidates.filter((t) => termIndex(t.term) < termIndex(cse.term) && isOtherDepartmentMajor(t.major));
    const how =
      before.length > 0
        ? `the first graduate-level term in Computer Science and Engineering on your transcript — your graduate terms in ${before[0]!.major} before it are another program`
        : cse.level === undefined
          ? 'the term in progress on your transcript, its first graduate-level term'
          : 'the first graduate-level term on your transcript';
    const term = fallFor(cse.term);
    // The other program's first term is the other reading (UI review item 11;
    // DGS 2026-10-09: option (b)): the import cannot know whether that program
    // was finished — a finished degree keeps the CSE term, a move from an
    // unfinished one keeps the earlier clock — so the CSE term is set and the
    // earlier-degrees answer "not finished" then asks for this one.
    const first = before[0];
    const alternative =
      first === undefined
        ? undefined
        : {
            term: fallFor(first.term),
            why: `your transcript shows graduate terms in ${first.major} from ${termLabel(fallFor(first.term))}, before your first CSE term. If you moved into CSE from that program without finishing it, your entry term is ${termLabel(fallFor(first.term))} — a transfer between Notre Dame programs keeps the earlier clock (DGS Handbook §3.15); after a finished degree there it stays ${termLabel(term)}`,
            otherProgram: true as const,
          };
    return { term, how: cse.term.season === 'summer' ? `${how} — a summer start, so your official matriculation is that fall` : how, ...(alternative ? { alternative } : {}) };
  }
  const ndCourses = courses.filter((c) => c.origin === 'nd');
  const uniqueTerms = (list: ParsedCourse[]): Term[] => {
    const map = new Map<number, Term>();
    for (const c of list) map.set(termIndex(c.term), c.term);
    return [...map.values()].sort(byIndex);
  };
  const allTerms = uniqueTerms(ndCourses);
  if (allTerms.length === 0) return undefined;
  const gradTerms = uniqueTerms(ndCourses.filter((c) => c.level === 'graduate'));

  if (gradTerms.length > 0) {
    const marked = gradTerms.filter((t) => newStudentTerms.has(termIndex(t)));
    // A 4+1 leaves a signature no other record has: graduate-level terms that
    // begin BEFORE the bachelor's degree was awarded. §3.5's courses are taken
    // in the junior and senior years, so "the first graduate-level term" is
    // not the start of any graduate program — it is the student's third year
    // of college. For that shape the entry term is the first graduate term
    // after the LAST degree the transcript awards (DGS 2026-09-10: "for
    // students who have finished the 4+1 program at CSE ND, if the student
    // advances to our own PhD, the entry term is when they start the PhD").
    // The same rule serves a 4+1 still in the MSCSE: their last degree is the
    // bachelor's, and the term after it is the master's year.
    const dated = degreesAwarded.filter((d) => d.date !== undefined).sort((a, b) => (a.date! < b.date! ? -1 : 1));
    const bachelors = dated.find((d) => d.level === 'bachelors');
    const last = dated[dated.length - 1];
    const startedBeforeTheDegree =
      bachelors !== undefined && gradTerms[0] !== undefined && termIndex(gradTerms[0]) <= termIndex(conferralTerm(bachelors.date!));
    const afterLastDegree = last !== undefined ? gradTerms.filter((t) => termIndex(t) > termIndex(conferralTerm(last.date!))) : [];
    const chosenRaw =
      marked.length > 0
        ? { term: marked[marked.length - 1]!, how: 'the term your transcript marks as your admission at the graduate level' }
        : startedBeforeTheDegree && afterLastDegree.length > 0
          ? {
              term: afterLastDegree[0]!,
              how: `the first term after your ${last!.name} was awarded — your transcript has graduate-level courses from before your bachelor's degree, which is the 4+1 pattern (§3.5)`,
            }
          : { term: gradTerms[0]!, how: 'the first graduate-level term on your transcript' };
    // An early-start summer reads as that year's fall (DGS 2026-10-03).
    const chosen = chosenRaw.term.season === 'summer' ? { term: fallFor(chosenRaw.term), how: `${chosenRaw.how} — a summer start, so your official matriculation is that fall` } : chosenRaw;
    // A degree awarded after the chosen term, with graduate-level terms
    // continuing past it, supports the other reading.
    let alternative: EntryTermInference['alternative'];
    for (const d of degreesAwarded) {
      if (!d.date) continue;
      const awardTerm = conferralTerm(d.date);
      if (termIndex(awardTerm) < termIndex(chosen.term)) continue;
      const after = gradTerms.filter((t) => termIndex(t) > termIndex(awardTerm));
      if (after.length === 0) continue;
      const candidate = after[0]!;
      if (termIndex(candidate) <= termIndex(chosen.term)) continue;
      if (!alternative || termIndex(candidate) > termIndex(alternative.term)) {
        alternative = {
          term: candidate,
          why:
            `your transcript also shows a ${d.name} awarded ${d.date}. If that was a separate degree finished before this program ` +
            `(a prior Notre Dame degree, or a 4+1 program), the entry term is ${termLabel(candidate)} — the earlier term is the safe assumption, so ${termLabel(chosen.term)} is set until you change it`,
        };
      }
    }
    return { ...chosen, alternative };
  }

  // No graduate-level rows: after the last awarded degree, else the earliest term.
  const datedDegrees = degreesAwarded.filter((d) => d.date !== undefined).sort((a, b) => (a.date! < b.date! ? -1 : 1));
  const lastDegree = datedDegrees[datedDegrees.length - 1];
  if (lastDegree) {
    const awardTerm = conferralTerm(lastDegree.date!);
    const after = allTerms.filter((t) => termIndex(t) > termIndex(awardTerm));
    if (after.length > 0) return { term: fallFor(after[0]!), how: `the first term after your ${lastDegree.name} was awarded${after[0]!.season === 'summer' ? ' — a summer start, so your official matriculation is that fall' : ''}` };
  }
  return { term: fallFor(allTerms[0]!), how: `the earliest term on your transcript${allTerms[0]!.season === 'summer' ? ' — a summer start, so your official matriculation is that fall' : ''}` };
}
