// Best-effort parser for transcripts from OTHER universities (feature decision
// 2026-09-01). Layouts vary wildly across institutions, so this extracts
// CANDIDATE course rows for the student to correct and confirm — nothing is
// added without their review, and unmatched grades must be chosen by hand.
// System-generated PDFs are read exactly; a PDF with no text layer is offered
// the opt-in English-only OCR instead (decision 2026-09-02; src/transcript/ocr.ts).
import { checkTotals, type PrintedTotals } from './totals-check.ts';
import { joinSpacedSubject } from '../data/assemble.ts';
import { NOTRE_DAME_ROW_UNIVERSITY, expandInstitutionAbbreviations, isNotreDameInstitution, normalizeCourseId, normalizeUniversity } from '../data/external.ts';
import type { PendingDgsReview } from '../engine/review.ts';
import { shortenAfterFirst } from '../ui/first-mention.ts';
import { ACTION_HEADING, STUDENT_LINE, studentLineHtml } from '../ui/email-html.ts';
import { termIndex, termLabel, termOfDate } from '../engine/term.ts';
import type { Grade, Season } from '../engine/types.ts';
import { looksLikeNotreDameTranscript } from './nd-markers.ts';
import { resolveCampus } from './campus.ts';
import { MONTHS, dateOnLine } from './parse.ts';

export interface ExternalCourseCandidate {
  /** The course number as printed — `''` when `codeMissing`. */
  courseId: string;
  /** CC15 (DGS 2026-10-09, transcript accuracy program Batch C): the
   * transcript prints course NAMES and no course numbers (Chinese and
   * Egyptian statements, the CHESICC report, Evergreen's credit
   * breakdown). The row is imported with an EMPTY course id the student
   * must type before it can be added; `courseId` is then `''`, never a
   * made-up number, and the course stays "not yet reviewed by the DGS"
   * until an ExternalCourses row matches the id the student typed. */
  codeMissing?: true;
  title?: string;
  credits?: number;
  /** Mapped app grade when the transcript's token is unambiguous; otherwise
   * undefined and `rawGrade` holds what was printed (student must choose). */
  grade?: Grade;
  rawGrade?: string;
  year?: number;
  /** The season of the nearest term header (2026-09-05) — the preview's
   * Term column starts from it instead of always "Fall". */
  season?: Season;
  /** OCR only: the source line read below the confidence floor — the preview
   * marks the row so the student checks it against the paper. Also set on a
   * row whose credits or grade the parser corrected (`ocrRead`), and on the
   * cell evidence below (`evidence`). */
  lowConfidence?: boolean;
  /** OCR only (DGS 2026-10-11, item 13): why a row the engine read with
   * confidence is flagged all the same — `credits`, a credit value no other
   * row of the document has; `mark`, a mark that is not a grade the app
   * reads and has a digit or a stray sign in it; `totals`, a term whose rows
   * do not add up to the transcript's own totals. The engine's confidence misses a confident
   * misread; these facts of the document do not. */
  evidence?: 'credits' | 'mark' | 'totals';
  /** OCR only (Batch C answer (4), DGS 2026-10-09): the scan's OWN reading of
   * a cell the parser corrected from an unambiguous letter-for-digit shape —
   * credits "3.O" read as 3.0, a grade "Bt" read as B+ (`ocrCellCorrection`).
   * The preview shows it beside the corrected value and the row stays
   * flagged; it is never saved with the course. */
  ocrRead?: { credits?: string; grade?: string };
  /** OCR or a scanner's layer only (DGS 2026-10-12: "I'll follow your
   * suggestions" — the middle way): the course number as it would read with
   * its digit look-alikes put back ("PHYS 1O1" → "PHYS 101"). Never applied
   * by the reader: the preview offers it beside the code as read, the student
   * accepts it with a click, and the row stays flagged either way. */
  codeSuggestion?: string;
  /** OCR only (Batch C answer (5), DGS 2026-10-09): the lines the row was
   * read from — indices into the lines the parser was given: its own line,
   * and a title or numbers line it took from just above or below — so the
   * preview can show the scanned line beside the row's fields. */
  sourceLines?: { from: number; to: number };
  /** The level the student was registered at for this row, when the
   * transcript says (2026-09-05 — combined B.S.+M.S. and 4+1 transcripts):
   * a UG/GR-style level cell on the row, a "Level: Graduate" / "Term Totals
   * (Undergraduate)" block, or the bachelor's conferral date (rows in terms
   * up to that date are undergraduate, later ones graduate). Undefined when
   * nothing says — the slot's level then applies. */
  level?: 'undergraduate' | 'graduate';
}

export interface ExternalParseResult {
  /** false → no text layer: scanned/photographed, or an image-only export. */
  hasTextLayer: boolean;
  /** The totals lines read in full (DGS 2026-10-11, item 11): what the
   * preview checks its rows against (src/transcript/totals-check.ts). */
  printedTotals?: PrintedTotals[];
  /** Looks like an ND transcript → point the student at the ND upload instead. */
  looksLikeNotreDame: boolean;
  /** Best guess at the institution's name, from the header lines. */
  university?: string;
  /** The name came from an ACRONYM, not from a name printed in the text
   * (2026-09-08). Weaker evidence, so the preview leaves the box editable
   * instead of locking it the way a printed name is locked. */
  universityGuessed?: true;
  /** The printed name is a multi-campus SYSTEM (DGS 2026-09-12): the campus
   * read from the record when it could be (`university` then holds the
   * campus's full name), else `campusSystem` alone — the student must choose. */
  campusSystem?: string;
  campus?: string;
  /** POSITIVE evidence only (2026-09-03): a line that both names a graduate
   * degree and says conferred/awarded/granted. Absence stays undefined — the
   * app never guesses whether a degree was completed. */
  degreeConferred?: true;
  /** A bachelor's degree conferral with a date (2026-09-05): the boundary
   * between undergraduate and graduate rows on a combined transcript. */
  bachelorsConferredOn?: string;
  /** The transcript STATES the bachelor's was conferred ("Graduated on … with
   * the degree of Bachelor …", a dated award line) even when its date could
   * not be read — OCR garbles dates (DGS 2026-09-16). The record is complete;
   * the term is then set by hand. */
  bachelorsConferred?: true;
  /** The transcript says its terms are QUARTERS (2026-09-11): a term header
   * such as "Fall Quarter 2023" / "Autumn Qtr 2023", or a "Quarter Units" /
   * "Quarter Hours" heading. Its credits are then quarter hours, worth a fraction (the DGS Handbook’s §3.14 factor, 0.66 — `QUARTER_CREDIT_FACTOR`, data/external.ts) of
   * a Notre Dame semester hour (§5.2 pro-rata) unless the DGS's row says
   * otherwise. Absent = no such word; nothing is assumed. */
  quarterSystem?: true;
  /** The transcript says its terms are TRIMESTERS (red-team F6, 2026-09-12):
   * the same two tests, with the word trimester. */
  trimesterSystem?: true;
  /** A bachelor's degree is NAMED anywhere on the transcript, with or without
   * a conferral date (2026-09-08). Without this there is no reason to think a
   * record covers an undergraduate degree at all, so the two-year "Taken as"
   * estimate must not run: a Master's that took three years is not a 4+1
   * (DGS bug report — a USC M.S. had its first year marked undergraduate). */
  bachelorsNamed?: true;
  /** True when rows of BOTH levels were found — the preview then shows the
   * per-row level for the student to check (2026-09-05). */
  mixedLevels?: true;
  /** Rows listed under Banner's "TRANSFER CREDIT ACCEPTED BY THE INSTITUTION"
   * (courses this university accepted from ANOTHER school) are not this
   * university's courses — they are left out and counted here so the preview
   * can say so (2026-09-05). */
  transferRowsSkipped?: number;
  /** "Is this a transcript at all?" (DGS 2026-10-10, answer 4a): a text
   * layer whose ONE course-like line comes with no university named and no
   * GPA or totals line anywhere — a course outline, a syllabus, a class
   * schedule. `courses` is then empty: the upload says the document does not
   * look like a transcript and the student types the course by hand. Never
   * set on OCR or a scanner's layer (every row of a scan is kept, flagged —
   * DGS 2026-10-10, answer 2). */
  notATranscript?: true;
  /** The text has Cyrillic letters (DGS 2026-10-12: reading non-Latin course
   * codes is out of scope — the page reads English-language transcripts — and
   * the preview says so, so the student adds such courses by hand). */
  nonLatinScript?: true;
  courses: ExternalCourseCandidate[];
}

/** Conferral wording and graduate-degree names must appear on the SAME line
 * ("Master of Science — Conferred May 2021", "Degree Completed: Master of
 * Science"), so a bachelor's conferral on a graduate transcript does not
 * count as graduate-degree evidence. "complet" added 2026-09-04 — with the
 * negative guard below, so "Not completed"/"Incomplete" never reads as
 * positive evidence. */
// "Graduated on 15 June 2020 with the degree of Bachelor of Science …" (DGS
// 2026-09-16) is a conferral too.
// Widened 2026-09-26 (public templates): "Award:", "Degree obtained", German
// verliehen / erworben, Portuguese formado / colação de grau, Spanish fecha de
// grado / egreso / titulación, Italian conseguito / conferito, Swedish utfärdad.
const CONFER_RE = /conferr|\bconfer\s+date|awarded|\baward\s*:|\bdate\s+of\s+award|granted|complet|graduat|obtained|obtid[oa]|verliehen|erworben|abgeschlossen|délivré|obtenu|conseguito|conferito|obtenido|utfärdad|tildelt|formado|colação\s+de\s+grau|fecha\s+de\s+(?:grado|egreso|titulaci[oó]n)|data\s+da\s+defesa/i;
const NOT_COMPLETE_RE = /incomplete|not\s+complet/i;
/** A status that says the degree is NOT done — "Status: IN PROGRESS - NOT
 * CONFERRED" under "Master of Science" in a degrees-awarded block (DGS's RPI,
 * Pitt and DePaul specimens, 2026-09-20). Tested on the degree line and, when
 * the degree line itself carries no award word, on the line below it. */
const NOT_CONFERRED_STATUS_RE = /\bnot\s+(?:yet\s+)?(?:conferred|awarded|granted|completed)\b|\bin\s+progress\b/i;
/** A line that carries a degree's date (DGS request 2026-09-06, late evening:
 * use the conferral OR completion date to pre-fill "Bachelor's degree
 * awarded"): "Degree Date:", "Degree Completion Date:", "Conferral Date:",
 * "Date Conferred:", "Graduation Date:", "Awarded:", "Completed on". */
const DEGREE_DATE_LINE_RE =
  /degree\s+(?:completion\s+|conferral\s+|award(?:ed)?\s+)?date|\bconfer(?:ral)?\s+date|\bconferr|\bawarded\b|\bgranted\b|completion\s+date|completed\s+on|date\s+(?:of\s+)?(?:completion|conferral|graduation|award)|graduation\s+date|\bgraduated\b|colação\s+de\s+grau|fecha\s+de\s+(?:grado|egreso|titulaci[oó]n)|data\s+da\s+defesa|verliehen\s+am/i;
/** A dated line that is a forecast, never an award. */
const NOT_YET_RE = /expected|anticipated|projected|sought|in\s+progress|pending/i;
/** A line that says a degree WAS conferred: an award word — not the level
 * word "Graduate" / "Undergraduate" / "Postgraduate" (CONFER_RE's "graduat"
 * is for "graduated" and "graduation date"), and not a forecast ("Expected
 * Graduation", "Anticipated Completion", "Degree Sought", "Pending"). Review
 * of Option 1, 2026-10-08: "Program: Master of Science   Level: Graduate" and
 * "Anticipated Completion: Master of Science" read as a finished master's. */
const saysConferred = (line: string): boolean => CONFER_RE.test(line.replace(/\b(?:under|post)?graduate\b/gi, ' ')) && !NOT_YET_RE.test(line);
// Abbreviations from Indian, Bangladeshi and Commonwealth transcripts (2026-09-26).
const GRAD_DEGREE_RE = /master|\bm\.?\s?sc?\.?\b|ph\.?\s?d|doctor of philosophy|integrated\s+m\.?\s?tech|dual\s+degree/i;
const gradDegreeIn = (text: string): boolean => GRAD_DEGREE_RE.test(text) || GRAD_ABBR_RE.test(text) || GRAD_WORDS_RE.test(text);

const LETTER_GRADE_RE = /^(A|A-|B\+|B|B-|C\+|C|C-|D\+?|D-?|F)$/;
const YEAR_RE = /\b(19[5-9]\d|20[0-4]\d)\b/;

/** Words that name an institution outright (guessUniversity has a wider list
 * of its own, with the non-English forms and the weak "college"). */
// Widened 2026-09-26 (public keys): institutes of information technology /
// science / engineering, Indonesia's Institut Teknologi, Italy's Politecnico,
// technical universities, academies of higher education, vidyapeeth.
const STRONG_NAME_RE =
  /universit|\binst(?:itute)?\.?\s+of\s+(?:tech|information\s+technology|science|engineering)|\binstitut\w*\s+(?:of\s+)?(?:science|technology|teknologi)|polytechnic|politecnico|polytechnique|politécnic|technical\s+university|technische\s+universität|hochschule|academy\s+of\s+higher\s+education|vidyapeeth|vishwavidyalaya|viswavidyalaya|universidad|università|universität|universiteit|universitas/i;
// A sentence that merely mentions a university ("This official university
// transcript is certified to be a …") is not a name (2026-09-05).
const SENTENCE_RE = /\b(this|is|are|was|were|has|have|to be|certified|issued|printed|member of|does not|registrar|provost|dean)\b/i;

// Degree lines (named once here; the scan tests them on every line).
// "Degree(s) Awarded" with the parenthesis is UMass Amherst's heading (DGS 2026-09-13).
const DEGREES_AWARDED_HEADING_RE = /^[\s*-]*degree(?:s|\(s\))?\s+(awarded|conferred|earned)\b/i;
// Degree abbreviations are CASE-SENSITIVE and want their dots or a degree
// context ("B.Tech.", "BSc", "BS in …") — "be applied toward a degree" is
// prose, not a B.E. (2026-09-26).
const BACHELORS_ABBR_RE = /\bB\.\s?(?:E|Tech|Sc|S|Eng|Arch|A)\.?(?=[\s.,(]|$)|\b(?:BSc|BEng|BTech|BE|BS|BA)(?:\s*\(Hons\.?\))?(?=\s+(?:in|of|degree|\()|[.,]|$)/;
const GRAD_ABBR_RE = /\bM\.\s?(?:Tech|E|Eng|Sc|S|Phil|CA)\.?(?=[\s.,(]|$)|\b(?:MSc|MEng|MTech|ME|MS)(?=\s+(?:in|of|degree|\()|[.,]|$)/;
const GRAD_WORDS_RE = /\bmestre\b|\bmestrado\b|\bmag[ií]ster\b|\bmaestr[ií]a\b|\bdoutorado\b|\bdoctorado\b/i;
const BACHELORS_WORDS_RE = /\bbachelor|licenciad[oa]|licenciatura|bacharel(?:ado)?|\bt[ií]tulo\s*:\s*ingenier[oa]/i;
const bachelorsIn = (text: string): boolean => BACHELORS_WORDS_RE.test(text) || BACHELORS_ABBR_RE.test(text);
const DEGREE_NAME_RE = /\b(bachelor|master|doctor)/i;
const namesDegreeIn = (text: string): boolean => /\b(bachelor|master|doctor|ph\.?\s?d)\b/i.test(text) || bachelorsIn(text) || GRAD_ABBR_RE.test(text) || GRAD_WORDS_RE.test(text);
const NOT_AWARDED_RE = /\bsought\b|\bexpected\b|\bcandidate\b|\bcurrent program\b/i;
const gradDegreeNameIn = (text: string): boolean => /\b(master|doctor|ph\.?\s?d)\b/i.test(text) || GRAD_ABBR_RE.test(text) || GRAD_WORDS_RE.test(text);
const DEGREE_CONFERRED_HEADER_RE = /degree\b.*\b(conferred|awarded)\b/i;
const DEGREE_CONFERRED_HEADER_ALONE_RE = /^[^:]*\bdegree\b[^:]*\b(conferred|awarded)\b\s*:?\s*$/i;

// Block and term markers the scan tests on every line.
const TRANSFER_BANNER_RE = /TRANSFER\s+CREDIT\s+ACCEPTED\s+BY/i;
const TRANSFER_TABLE_RE = /^\s*(?:term\s+)?course\s+transfer\s+course\b/i;
const INSTITUTION_CREDIT_RE = /INSTITUTION(?:AL)?\s+CREDIT|UNIVERSITY OF NOTRE DAME CREDIT/i;
// Lines that END a transfer-credit block when no "INSTITUTION CREDIT" line
// does (DGS's synthetic set, 2026-09-20): "Beginning of Graduate Record",
// "***** GRADUATE RECORD *****", "-- GRADUATE --", "Graduate Program of
// Study", and the block's own "Total transfer credits accepted: 6" line.
const TRANSFER_PEOPLESOFT_RE = /^\s*transfer\s+(?:credits?|work|coursework)(?:\s+from\b|\s*:?\s*$)|^\s*transfer\s+credit\s+summary\b|^\s*applied\s+toward\b/i;
const TRANSFER_TOTALS_RE = /^\s*(?:course\s+trans\s+gpa|transfer\s+totals?)\b/i;
const TRANSFER_END_RE =
  /^\s*(?:\*+\s*)?(?:beginning\s+of\s+)?(?:graduate|undergraduate)\s+(?:academic\s+)?record\b|^\s*(?:graduate|undergraduate)\s+program\s+of\s+study\b|^\s*-+\s*(?:graduate|undergraduate)\s*-+|^\s*total\s+transfer\b/i;
// "Transferred from: University of Florida" names the OTHER school (2026-09-20):
// never the transcript's own name, whether in the header or a degree block.
const TRANSFER_FROM_RE = /^\s*transfer(?:red)?\s+(?:from|credit)\b/i;
// An institution named on a term line ("Fall 2018: Purdue University" inside
// Banner's transfer block) keeps that block open; a bare term header ends it.
const NAMES_INSTITUTION_RE = /universit|college|institute|school|academy/i;
// An academic-year term header, "2023-24 Spring Term" (2026-09-20): Fall is
// the first year, Winter / Spring / Summer the second.
// Two-digit or four-digit second year (2026-09-26: Wisconsin "Spring 2023-2024",
// MIT "Spring Term 2022-2023", NUS "2022/2023"); no leading \b so "AY2022/2023" reads.
const ACADEMIC_YEAR_RE = /((?:19|20)\d{2})[-–/]((?:19|20)?\d{2})\b/;
// WPI's seven-week terms, "A Term 2020" … "D Term 2021" (DGS 2026-09-20: a
// quarter calendar). A and B fall in the autumn semester, C and D in spring.
const WPI_TERM_RE = /^\s*([A-D])\s+term\s+((?:19|20)\d{2})\b/i;
// A totals line — "Ehrs: 8.000 GPA-Hrs: 8.000", "Term Totals: 12 credits",
// "Term Units 9" — is never the second line of a two-line course row
// (2026-09-20: a term total was read as the credits of the row above it).
const TOTALS_LINE_RE = /^\s*(?:ehrs|gpa-?hrs|qpts|term\s+(?:totals?|units|credits|gpa)|cumulative|totals?)\b|\bgpa\b/i;
// Word-bounded since 2026-09-26 ("Intermediate Writing" + course number 2010 was
// a term header), and widened to the words other registrars print: Monsoon
// (IIIT Hyderabad), Sem/Sem., "Examination(s) held", semestre / semester in
// four languages, the German Wintersemester / Sommersemester and their
// abbreviations, MIT's IAP, a January or winter session, Nepal's Year/Part.
const TERM_WORD_RE =
  /\b(fall|spring|summer|autumn|winter|semester|sem\.?|term|trimester|quarter|session|academic\s+year|monsoon|examinations?\s+held|regular\s+examinations?|semestre|semestr|per[ií]odo|ciclo|wintersemester|sommersemester|wise|sose|iap|january|j-term|midyear|special\s+term|full\s+year|year\/part|h[oọ]c\s+k[yỳ]|学期)\b/i;
const LEVEL_SUFFIX_RE = /\b(undergraduate|graduate|postgraduate)\s*$/i;
const LEVEL_ALONE_RE = /^(undergraduate|graduate)$/i;
// Season words (2026-09-26): Monsoon is the Indian fall semester; the southern
// hemisphere's Otoño / Outono (March–July) sits where Notre Dame's spring does
// and its Primavera (August–December) where the fall does; the German
// Wintersemester (October–March) is the fall term, the Sommersemester
// (April–July) the spring; Swiss HS / FS likewise; MIT's IAP, a January or
// winter session and an intersession precede the spring.
const FALL_RE = /\b(fall|autumn|monsoon|primavera|wintersemester|wise|herbstsemester|otoño\s+boreal)\b/i;
const SPRING_RE = /\b(spring|winter|intersession|otoño|outono|frühjahrssemester|iap|j-term)\b/i;
const SUMMER_RE = /\b(summer|verano|verão|midyear|special\s+(?:term|semester)|sommer|sommersemester|sose)\b/i;
/** An ordinal semester or term: "Semester I", "First Semester", "Term 2",
 * "Sem-II", "1º Sem", "1S", "Odd Semester", "Semester One", Nepal's
 * "Year/Part: I/II" (the part), Thailand's "1/2022". */
const ORDINAL_AFTER_RE = /\b(?:semester|sem\.?|term|trimestre|semestre|per[ií]odo|ciclo|h[oọ]c\s+k[yỳ]|part)\s*[-:#]?\s*(I{1,3}|IV|[1-4]|one|two|three|four|first|second|third|fourth|1st|2nd|3rd|4th|odd|even)\b(?![-/.]\d)/i;
const ORDINAL_BEFORE_RE = /\b(first|second|third|fourth|1st|2nd|3rd|4th|odd|even|[1-4]\s*[ºª°]|[1-4]S)\s*[-.]?\s*(?:semester|sem\b\.?|term|semestre|trimestre|quarter)/i;
/** IIT Kanpur's "2019-20/I": the ordinal after the academic year. */
const RANGE_SLASH_ORDINAL_RE = /(?:19|20)\d{2}[-–/](?:(?:19|20)?\d{2})\s*\/\s*(I{1,3}|[1-3])\b/i;
const YEAR_PART_RE = /year\s*\/\s*part\s*:?\s*(I{1,4}|IV|[1-4])\s*\/\s*(I{1,3}|[1-3])/i;
const SLASH_ORDINAL_RE = /(?:^|\s)([1-3])\s*[ºª°]?\s*(?:S|Sem\.?)?\s*\/\s*((?:19|20)\d{2})(?:\s|$)/i;
/** A month range on a term line (UBC "Term 1   September - December 2019"):
 * the first month names the season. */
const MONTH_RANGE_RE = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*[-–—]\s*(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*,?\s*((?:19|20)\d{2})\b/i;
const MONTH_YEAR_RE = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:\s*\/\s*(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?)?,?\s*((?:19|20)\d{2})\b/i;
const SOLAR_HIJRI_YEAR_RE = /\b(13[5-9]\d|14[0-2]\d)\b/;
const GREGORIAN_HINT_RE = /\(\s*((?:19|20)\d{2})(?:\s*[-–/]\s*(?:19|20)?\d{2})?\s*(?:G\.?C\.?|A\.?D\.?)?\s*\)|((?:19|20)\d{2})(?:\s*[-–/]\s*(?:19|20)?\d{2})?\s*(?:G\.?C\.?|A\.?D\.?)/i;

/** The season a term header names, when it names one. */
/** The ordinal a term line names (1–4), or undefined. */
function ordinalOf(text: string): number | undefined {
  const word = (w: string): number => {
    const t = w.toLowerCase().replace(/[ºª°]/g, '').replace(/s$/i, '');
    if (/^(i|1|one|first|1st|odd)$/.test(t)) return 1;
    if (/^(ii|2|two|second|2nd|even)$/.test(t)) return 2;
    if (/^(iii|3|three|third|3rd)$/.test(t)) return 3;
    return 4;
  };
  const yp = YEAR_PART_RE.exec(text);
  if (yp) return word(yp[2]!);
  const rs = RANGE_SLASH_ORDINAL_RE.exec(text);
  if (rs) return word(rs[1]!);
  const after = ORDINAL_AFTER_RE.exec(text);
  if (after) return word(after[1]!);
  const before = ORDINAL_BEFORE_RE.exec(text);
  if (before) return word(before[1]!);
  const slash = SLASH_ORDINAL_RE.exec(text);
  if (slash) return Number(slash[1]);
  return undefined;
}

function seasonOf(text: string): Season | undefined {
  return FALL_RE.test(text) ? 'fall' : SPRING_RE.test(text) ? 'spring' : SUMMER_RE.test(text) ? 'summer' : undefined;
}

/** Whitespace-split tokens of a row's cells (joined at column gaps). A
 * symbol printed "immediately following the grade" (Oregon's key, item 14,
 * 2026-10-11) is no part of it: a group mark ">1" … ">5" ("B>1", "C+>3"),
 * and the P/N-only star ("P*") — a star after any other letter (Cambridge's
 * "A*") is kept. */
const tokensOf = (parts: string[]): string[] =>
  parts
    .join('  ')
    .split(/\s+/)
    .filter((t) => t !== '')
    .map((t) => t.replace(/^([A-F][+-]?|P|N)>[1-9]$/, '$1').replace(/^([PN])\*$/, '$1'));

/** What one row's tokens yield (scanTokens): the title's words, then the
 * credits and the grade — or the printed grade token when it maps to none. */
interface RowScan {
  credits?: number;
  /** The credits as printed ("3.000"), so the Earned column can be told from a
   * grade on the 4.0 scale that happens to equal the credits (2026-09-26). */
  creditsText?: string;
  grade?: Grade;
  rawGrade?: string;
  /** The token the position-free scan read the grade or raw grade from —
   * F1a's continuation check asks whether it was the line's last grade cell
   * (review 2026-10-09). */
  gradeText?: string;
  titleParts: string[];
}

/** What the transcript's OWN legend says about tokens the app would otherwise
 * read wrongly or not at all (public-transcript research, 2026-09-26 — the
 * legend is the only evidence the app may act on; CLAUDE.md: never guess):
 * `eFails` — the failing grade is E (Ohio State, Utah, Arizona State, Florida:
 * "E 0.0 Failure"); `nUnsatisfactory` — N means no credit / not satisfactory
 * (Minnesota); `sIsTop` — S is the top grade of an S/A/B/C/D/E scale worth 10
 * points (IIT Madras, Anna University), NOT the app's satisfactory, so it is
 * left raw for the student to map. */
interface LegendHints {
  eFails?: true;
  nUnsatisfactory?: true;
  sIsTop?: true;
  /** NP means "no grade — pass" here (KFUPM), not the US "no pass". */
  npPasses?: true;
  /** P is a letter grade worth points (India's UGC scale "P 4"), not a pass. */
  pIsLetter?: true;
  /** The Australian HD / D / CR / P / N scale (the ANU sample, 2026-09-26):
   * D is a Distinction (70–79), not the app's D, CR a Credit band, P the
   * 50–59 pass — every band is left raw beside its mark for the DGS. */
  hdScale?: true;
  /** "Pass" and "Fail" are BANDS of a percentage scale here — Cairo's
   * "Excellent 85-100%, Very Good 75-84%, Good 65-74%, Pass 60-64%, Fail
   * below 60%" (CC15, Batch C 2026-10-09): Pass is the lowest graded band,
   * not the app's ungraded S, so both words are left raw for the student. */
  passFailBands?: true;
}

function readLegend(lines: string[]): LegendHints {
  const hints: LegendHints = {};
  for (const raw of lines) {
    const l = raw.replace(/\s+/g, ' ');
    // "E 0.0 Failure", "E = Failure", "E - Failing grade", "E (0.0)". The
    // synthetic legends of the committed fixtures say "F 0.00 Failure" and
    // define no E, so they leave every hint unset.
    if (/(?:^|[\s,;|(])E\s*[=:–-]?\s*\(?\s*(?:0(?:\.0+)?\s*[)\s,]*)?\(?\s*(?:[=:–-]\s*)?(?:fail(?:ure|ing|ed)?|unsatisfactory)\b/i.test(l)) hints.eFails = true;
    // "E 0.00" only where the E opens a legend entry — on a course row ("MATH
    // 1210   Calculus I   4.000   E   0.00") it is a grade and its points.
    if (/^(?:.{0,24}[\s,;|])?E\s*[=:–-]?\s*(?:\()?0\.0+\)?(?:\s|$)/.test(l) && !/^[A-Z]{2,10}\s+\d{2,5}\b/.test(l)) hints.eFails = true;
    if (/(?:^|[\s,;|])N\s*[=:–-]?\s*(?:\()?\s*(?:not\s+satisfactory|no\s+credit|non-?credit|unsatisfactory|no\s+pass)\b/i.test(l)) hints.nUnsatisfactory = true; // "N No Pass" (Oregon, item 14)
    // "S 10", "S = 10", "S (10)", "S – Outstanding (10 points)".
    if (/(?:^|[\s,;|])S\s*(?:[=:–-]|\()?\s*(?:outstanding\s*\(?)?10\b/i.test(l)) hints.sIsTop = true;
    if (/(?:^|[\s,;|])NP\s*[=:–-]?\s*\(?\s*(?:no\s+grade\s*[-–:]?\s*pass|pass(?:ed|ing)?(?:\s*[,;)]|\s+without|\s*$))/i.test(l)) hints.npPasses = true;
    if (/(?:^|[\s,;|])P\s*(?:\(pass\))?\s*[=:–-]?\s*(?:\()?\s*[4-5](?:\.0+)?\b(?!\s*\.\d)/.test(l) && /\b(?:O|A\+?)\s*[=:–-]?\s*\(?\s*(?:10|9)\b/.test(l)) hints.pIsLetter = true;
    // An HD grade on a row, or a legend naming the High Distinction: the
    // Australian scale, where D is a Distinction (the ANU sample, 2026-09-26).
    if (/\bhigh\s+distinction\b/i.test(l) || /(?:^|\s)HD\s*\*?$/.test(l)) hints.hdScale = true;
    // "Pass 60-64%" beside another band word with its own range ("Good
    // 65-74%"): the pass is a band of the scale the legend spells out.
    if (/\bpass\s*[:=–-]?\s*\(?\s*\d{1,3}(?:[.,]\d+)?\s*%?\s*[-–]\s*\d{1,3}(?:[.,]\d+)?\s*%/i.test(l) && /\b(?:excellent|very\s+good|good|fair|distinction|merit)\s*[:=–-]?\s*\(?\s*\d{1,3}(?:[.,]\d+)?\s*%?\s*[-–]\s*\d{1,3}/i.test(l)) hints.passFailBands = true;
  }
  return hints;
}

/** Registrar pass/fail spellings and status codes read from public transcript
 * keys (2026-09-26): Penn State SA/UN, Ohio State PA, Illinois PS/PP/PD/PZ,
 * NUS CS/CU, HKUST PP, IIT-style SAT, and the words other languages print in
 * the grade cell (German "bestanden", Italian "idoneo", Spanish "aprobado",
 * Portuguese "aprovado", Swedish "godkänd", Norwegian "bestått"). Tokens that
 * are NOT a pass/fail — a transfer T/TR, a withdrawal W, an incomplete I, an
 * audit AU, a top grade S on an S–E scale — are left raw for the student. */
const PASS_TOKENS = new Set(['P', 'PASS', 'PASSED', 'PASSING', 'CR', 'S', 'BESTANDEN', 'IDONEO', 'IDONEA', 'APROBADO', 'APROBADA', 'APROVADO', 'APROVADA', 'GODKÄND', 'GODKAND', 'BESTÅTT', 'BESTATT', 'APPROVED', 'SUPERATO', 'SUPERATA', 'SATISFACTORY']);
const FAIL_TOKENS = new Set(['NP', 'FAIL', 'FAILED', 'NC', 'U', 'NICHTBESTANDEN', 'REPROBADO', 'REPROBADA', 'REPROVADO', 'REPROVADA', 'NONSUPERATO', 'NONSUPERATA', 'UNSATISFACTORY', 'UNDERKÄND', 'UNDERKAND']);
const IN_PROGRESS_TOKENS = new Set(['IP', 'INPROGRESS', 'ENROLLED']);
/** Registrar codes that are also ordinary words inside a course title ("CS
 * Trends", "Lab for CS 2000", "Course to be …"): read as grades only where a
 * grade sits — after the credits, or right before them — never while the
 * title is still open (2026-09-26, the Binghamton and Northeastern fixtures). */
const CODED_PASS_TOKENS = new Set(['SA', 'SAT', 'PA', 'PS', 'PP', 'PD', 'PZ', 'CS', 'BE', 'SY', 'CPL', 'ACC']);
const CODED_FAIL_TOKENS = new Set(['UN', 'NS', 'NZ', 'CU', 'IB', 'NAC']);
const CODED_IN_PROGRESS_TOKENS = new Set(['IPR', 'INP', 'PR']);

function mapGrade(token: string, legend: LegendHints = {}, inGradePosition = true): Grade | undefined {
  const t = token.toUpperCase().replace(/\s+/g, '');
  if (inGradePosition) {
    if (CODED_PASS_TOKENS.has(t)) return 'S';
    if (CODED_FAIL_TOKENS.has(t)) return 'U';
    if (CODED_IN_PROGRESS_TOKENS.has(t)) return 'IP';
  }
  if (t === 'A+') return 'A'; // no A+ in the app's grade scale (2026-09-05)
  // On the Australian scale D, CR, P and N are bands of the mark beside them
  // (D = Distinction, 70–79), none of them the app's grades: left raw.
  if (legend.hdScale && /^(?:HD|D|CR|P|N)$/.test(t)) return undefined;
  if (LETTER_GRADE_RE.test(t)) {
    if (t === 'D+' || t === 'D-') return 'D';
    return t as Grade;
  }
  // Korean-style "A0 / B0" (the plain grade, beside A+ and B+): the zero is
  // the absence of a plus (public keys, 2026-09-26).
  if (/^[A-D]0$/.test(t)) return t[0] as Grade;
  // The transcript's legend decides what E, N and S mean (never a guess).
  if (t === 'E' && legend.eFails) return 'F';
  if (t === 'N' && legend.nUnsatisfactory) return 'U';
  if (t === 'S' && legend.sIsTop) return undefined;
  if (t === 'NP' && legend.npPasses) return 'S';
  if (t === 'P' && legend.pIsLetter) return undefined;
  if (legend.passFailBands && /^(?:PASS|FAIL)$/.test(t)) return undefined;
  if (PASS_TOKENS.has(t)) return 'S';
  if (FAIL_TOKENS.has(t)) return 'U';
  if (IN_PROGRESS_TOKENS.has(t)) return 'IP';
  return undefined;
}

/** A pass/fail-class token (S/U/IP family), as opposed to a letter grade: a
 * letter grade may replace a numeric guess on the row ("a real grade beats a
 * numeric guess"), a pass/fail token may not — the University of Sydney prints
 * "66   CR" where CR is the 65–74 band and the mark is the grade (2026-09-26). */
const isPassFailToken = (token: string, legend: LegendHints): boolean => {
  const g = mapGrade(token, legend);
  return g === 'S' || g === 'U' || g === 'IP';
};

/** Grade tokens that carry no letter grade but ARE the row's result, kept as
 * printed for the student to map (2026-09-26): a fraction mark (15/20, 28/30,
 * 16.2/20), the Italian 30 with honours ("30L", "30 e lode"), the Chinese
 * five-level words, and a CJK grade character (優 / 良 / 合格 / 及格). */
const FRACTION_MARK_RE = /^\d{1,2}(?:[.,]\d{1,2})?\/(?:10|20|30)$/;
const LODE_RE = /^30\s?(?:L|e lode|cum laude|con lode)$/i;
const GRADE_WORD_RE = /^(?:excellent|good|medium|fair|qualified|average|poor|distinction|merit|very good|pass with distinction|high pass|low pass|honou?rs)$/i;
const CJK_GRADE_RE = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]{1,3}$/u;
/** Phrases a transcript prints as several words in the grade cell, joined
 * before the token scan so they read as one token. */
const GRADE_PHRASES: readonly (readonly string[])[] = [
  ['30', 'e', 'lode'],
  ['30', 'cum', 'laude'],
  ['30', 'con', 'lode'],
  ['nicht', 'bestanden'],
  ['non', 'superato'],
  ['non', 'superata'],
  ['very', 'good'],
  ['pass', 'with', 'distinction'],
  ['high', 'pass'],
  ['low', 'pass'],
];
const joinGradePhrases = (tokens: string[]): string[] => {
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const phrase = GRADE_PHRASES.find((p) => p.every((w, j) => tokens[i + j]?.toLowerCase() === w));
    if (phrase) {
      out.push(tokens.slice(i, i + phrase.length).join(' '));
      i += phrase.length - 1;
    } else out.push(tokens[i]!);
  }
  return out;
};

/** A cell that reads as a plausible credit value (0 ≤ n ≤ 30, up to 3
 * decimals — Banner and PeopleSoft print "3.000", 2026-09-05). */
/** WPI prints its seven-week-term credits as a fraction, "1/3" (DGS
 * 2026-09-20): read as the number, to three decimals. */
const FRACTION_CREDITS_RE = /^(\d)\/(\d)$/;
/** "3.000" → 3 decimals, "3" → 0 (the credits' printed format, 2026-09-26). */
const decimalsOf = (token: string): number => (/[.,](\d+)$/.exec(token)?.[1] ?? '').length;
const numericLike = (token: string): boolean => /^\d{1,3}(?:[.,]\d{1,2})?$/.test(token);

function asCredits(token: string): number | undefined {
  const fraction = FRACTION_CREDITS_RE.exec(token);
  if (fraction && Number(fraction[2]) > 0) return Math.round((Number(fraction[1]) / Number(fraction[2])) * 1000) / 1000;
  if (!/^\d{1,2}(?:[.,]\d{1,3})?$/.test(token)) return undefined;
  if (/^0\d$/.test(token)) return undefined; // "01" is a section number, not 1 credit
  const n = Number(token.replace(',', '.'));
  // 0 is a real value (zero-credit seminars, internships — "0.00 S"), kept
  // since 2026-09-05 so such rows do not come back with blank credits.
  return n >= 0 && n <= 30 ? n : undefined;
}

/** The credits cell as a COLUMN-MAPPED layout may print it (2026-09-26):
 * parentheses round a value no credit was awarded for (Tulane "(3.000)"), a
 * lecture:lab sum (IISc "3:1"), WPI's fraction, and values up to 120 — UK and
 * Australian credit points (15, 20, 40, 60), UChicago's 100 units — which the
 * position-free scan must keep refusing (a mark of 85 would read as credits). */
function asCreditsWide(token: string): number | undefined {
  const bare = /^\(\d{1,3}(?:[.,]\d{1,3})?\)$/.test(token) ? token.slice(1, -1) : token;
  const lectureLab = /^(\d{1,2}):(\d{1,2})$/.exec(bare);
  if (lectureLab) return Number(lectureLab[1]) + Number(lectureLab[2]);
  const narrow = asCredits(bare);
  if (narrow !== undefined) return narrow;
  if (!/^\d{1,3}(?:[.,]\d{1,3})?$/.test(bare)) return undefined;
  const n = Number(bare.replace(',', '.'));
  return n > 30 && n <= 120 ? n : undefined;
}

/** The kinds of column a course table's header line names — read so the row
 * scan knows WHERE the grade and the credits sit (public-transcript research,
 * 2026-09-26): marks columns before the grade (Indian universities), the
 * grade before the credits (Banner Self-Service), attempted/earned pairs
 * (PeopleSoft), ECTS beside a local grade (Europe), a level or type cell. */
// 'stat' (F6, transcript accuracy program, 2026-10-09): a class statistic
// beside the row — Alberta's "Class Avg" / "Class Enrl", Minerva's "Class
// Avg.", McMaster's "MEDIAN" ("B+ (242)": the median grade and the class
// size) — a number, a grade, a placeholder or a parenthesised count that says
// nothing about the student's own result.
type ColumnKind = 'code' | 'title' | 'credits' | 'ects' | 'attempted' | 'earned' | 'grade' | 'points' | 'mark' | 'level' | 'flag' | 'term' | 'serial' | 'workload' | 'duration' | 'stat';

const COLUMN_KIND_RES: readonly (readonly [ColumnKind, RegExp])[] = [
  ['serial', /^(?:s\.?\s*)?(?:no\.?|sl\.?\s*no\.?|sr\.?\s*no\.?|#|s\.?\s*n\.?)$/i],
  // "TM" (F6, 2026-10-09): McMaster's term-of-session ordinal column.
  ['term', /^(?:term|tm|semester|session|period|periodo|período|date|year|academic\s*year|semester\s*ending\s*date|quarter|exam\s*(?:period|month|date)|month\s*&?\s*year|announced\s*on|declared\s*on|date\s*of\s*result|result\s*date|completed|month\/year|pr[üu]fungsdatum|datum|fecha|data|semestre|per[ií]odo\s*letivo)$/i],
  ['code', /^(?:course|subject|subj\.?|subject\s*code|course\s*(?:code|id|no\.?|number|num\.?|unit\s*code|listing)|subno|sub\.?\s*no\.?|subject\s*no\.?|code|kode(?:\s*\/\s*code)?|no\.?|number|cat\.?\s*no\.?|ref\.?|clave|código|codigo|course\s*unit|crs\.?(?:\s*no\.?)?|crse(?:\s*no\.?)?|dept\s*crs|modulnummer|modul-?nr\.?|modul\s*no\.?|kennung)$/i],
  ['title', /(?:title|name|description|nama|titre|denominaci|disciplina|asignatura|materia|curso|course\s*unit\s*name|subject\s*name|unit\s*of\s*study|modul(?!nummer|-?nr|\s*no)|module|lehrveranstaltung)/i],
  ['flag', /^(?:r|rpt|repeat(?:ed)?|h|flag|notes?|remarks?|type|course\s*type|category|status|exam\s*type|tipo(?:\s*de\s*examen)?|mode|comments?|excl\.?|incl\.?|situa[çc][aã]o|section|sec\.?|instructor|room|days|time|campus|component|delivery|part|option|classification\s*code|core\/elective|elective\/core|resit|pass\/fail|p\/f|honor\s*code|notation|code)$/i],
  ['mark', /(?:marks?|mrk|score|internals?|externals?|total|theor(?:y|etical)|practical|term\s*work|assessment|exam(?:ination)?|full|max|obtained|nota\b|média|media\b|promedio|calif|punt|out\s*of)/i],
  ['attempted', /(?:attempt|taken|enrol|registered|inscri)/i],
  ['earned', /(?:earned|passed|aprobad|obtid|erworben)/i],
  ['points', /^(?:(?:quality|grade|honor|gpa)\s*(?:points?|pts?)|q\.?\s*pts?|g\.?\s*pts?|gps?|pts?|points?|qpts?|gpa\s*hrs?|gpa|c\s*\*\s*g|cxg|credit\s*x\s*grade|credits?\s*\*\s*(?:grade\s*)?points?)$/i],
  // "CH" left this list for the credits (F6, 2026-10-09): HEC / NUST / UET
  // transcripts print credit hours as CH; a second credits cell beside it is
  // handled below (readColumnHeader).
  ['workload', /^(?:carga\s*hor[aá]ria|workload|contact\s*hours|hours\s*per\s*week|lecture\s*hours|l-t-p|ltp|wochenstunden|sws|freq\.?|frequ[êe]ncia|attendance|presença|asistencia)$/i],
  ['duration', /^duration/i],
  ['ects', /^(?:ects(?:\s*credits?)?|ects\s*cr\.?|credit\s*\(?ects\)?)$/i],
  // F6 (2026-10-09): Sabanci's "SU CREDIT", Minerva's "C.E.U." (continuing-
  // education units, printed beside "Cr."), HEC's "CH" (credit hours).
  // Ladok's "Scope" (Swedish omfattning) is the course's credits (F6).
  ['credits', /^(?:credits?|cr\.?|crd|crds|unts|scope|omfattning|su\s*credits?|c\.?e\.?u\.?s?|ch|cr\.?\s*hrs?\.?|hrs?\.?|hours|credit\s*(?:hours?|hrs?|value|units?|points?|weight)|units?|cu|course\s*units?|unit\s*value|sem\.?\s*hrs?|semester\s*(?:hours?|credits?)|quarter\s*(?:units?|hours?|hrs?)|sks(?:\s*\/\s*credits?)?|weight|wgt|units?\s*of\s*credit|cp|cfu|créditos?(?:\s+(?:aula|trabalho))?|creditos?|crédits?|kredit|c)$/i],
  // "Grade Remark" (F6, 2026-10-09): Alberta's grade column, two words.
  ['grade', /^(?:grade|grd|gr|letter\s*grade|grade\s*remarks?|final\s*grade|results?|outcome|nilai(?:\s*\/\s*grade)?|grado|voto|calificaci[oó]n|betyg|karakter|note|conceito|grade\s*letter|grade\s*\(?letter\)?|local\s*grade|ects\s*grade|honor|honou?rs|classification)$/i],
  // ("FHEQ Level" stays a flag column: a framework level 7 module in an
  // integrated master's year is still undergraduate work — F6 review, 2026-10-09.)
  ['level', /^(?:level|lvl|career|academic\s*career|ug\/gr|course\s*level)$/i],
  // Western's "AVG" and "SIZ" (class average and size) beside its "UNTS".
  ['stat', /^(?:class(?:\s*(?:avg\.?|average|enrl\.?|enrol(?:l)?ment|size|rank|median))?|median|avg\.?|average|siz|size|enrl\.?)$/i],
];

/** A header cell in Portuguese or Spanish — the words a Brazilian histórico
 * escolar or a Latin American certificado prints over its columns (F6 review,
 * 2026-10-09). Beside such a cell "CH" is the carga horária (hours), not the
 * credit hours. Anchored: the whole cell, its parenthesis stripped. */
const IBERIAN_HEADER_WORD_RE = /^(?:c[óo]digo|disciplina|asignatura|materia|clave|nota|conceito|calificaci[oó]n|situa[çc][aã]o|cr[ée]ditos?|per[ií]odo(?:\s*letivo)?|semestre|a[ñn]o|turma|carga\s*hor[aá]ria|frequ[êe]ncia|resultado)$/i;
/** A header word over a TERM column under which a bare one- or two-digit
 * number is the document's own term numbering (F6 review, 2026-10-09): "TM"
 * (McMaster's term-of-session ordinal), "Semester", "Term", "Session",
 * "Period", "Year", "Quarter". Under a date word ("Date", "Announced on",
 * "Datum") a bare number is no term cell at all. */
const TERM_NUMBER_HEADER_RE = /^(?:tm|term|semester|semestre|session|period|periodo|per[ií]odo(?:\s*letivo)?|year|academic\s*year|quarter)$/i;

/** The kinds of a header line, in column order — or undefined when the line
 * is not a course-table header: fewer than three cells, fewer than three of
 * them recognised, no course/title column, or nothing to read (no credits,
 * grade or marks column). A cell no pattern knows is 'flag' (skipped). */
/** The header's cell texts, kept beside the kinds (Sharif "Theoretical /
 * Practical" are credit hours, not marks, when no credits column exists). */
let lastHeaderCells: string[] = [];
/** The kind ONE header cell names, read the way readColumnHeader always has
 * (2026-09-26): "Credits (ECTS)", "Grade (Letter)", "Score (10)" — the
 * parenthesis qualifies the column, it does not rename it; a slash joins two
 * languages ("Kode / Code") and the first half decides — since F6 (2026-10-09)
 * only when every other half is itself a header word, so Minerva's "Cr. /
 * C.E.U. Grade" is not cut at its slash. `anchored` says the pattern named the
 * cell as a whole; the title, mark, attempted and earned patterns match a
 * word inside the cell ("Course Title", "Internal Marks", "Units Taken"). */
function cellKind(cell: string): { kind: ColumnKind; anchored: boolean } | undefined {
  const trimmed = cell.replace(/\s*\(.*\)\s*$/, '').trim();
  const halves = trimmed.split(/\s*\/\s*/);
  const gradeRe = COLUMN_KIND_RES.find(([kind]) => kind === 'grade')![1];
  const match = (text: string): { kind: ColumnKind; anchored: boolean } | undefined => {
    for (const [kind, re] of COLUMN_KIND_RES) {
      // The unanchored mark pattern finds "mark" inside "Grade Remark"
      // (Alberta's grade column, F6 2026-10-09): a cell the grade pattern
      // names whole is the grade, never a mark.
      if (kind === 'mark' && gradeRe.test(text)) continue;
      if (re.test(text) || (kind === 'title' && re.test(cell)) || (kind === 'mark' && re.test(cell) && !/credit|unit|hour|grade|point/i.test(cell))) {
        return { kind, anchored: re.source.startsWith('^') };
      }
    }
    return undefined;
  };
  const head = halves.length > 1 && halves.slice(1).every((h) => match(h) !== undefined) ? halves[0]! : trimmed;
  return match(head);
}
/** The kinds a header cell names — usually one. Two when the PDF's layout
 * stage joined two header words into one cell with a single space between
 * them (F6, 2026-10-09: Minerva's "Cr. / C.E.U. Grade" and "Remarks Earned"
 * are the credits and the grade, the remarks and the earned units): a cell
 * no pattern names as a whole is cut at the one space where both parts are
 * header words of different kinds; a cell a pattern names only by a word
 * inside it ("Remarks Earned" holds "earned") is cut only when its first part
 * is a remarks-type word — "Units Taken", "Credits Earned", "Course Title",
 * "Marks Obtained" stay one column, as does any cell a pattern names whole
 * ("Grade Points", "Credit Hours"). */
function cellKinds(cell: string): ColumnKind[] {
  const whole = cellKind(cell);
  if (whole?.anchored) return [whole.kind];
  const words = cell.trim().split(/\s+/);
  for (let cut = words.length - 1; cut >= 1; cut--) {
    const first = cellKind(words.slice(0, cut).join(' '));
    const second = cellKind(words.slice(cut).join(' '));
    if (!first || !second || first.kind === second.kind) continue;
    if (whole === undefined || (first.anchored && first.kind === 'flag')) return [first.kind, second.kind];
  }
  return [whole?.kind ?? 'flag'];
}
/** A cell is "known whole" when a pattern names it as it stands — the test the
 * two-line header join asks of every joined pair (joinedHeaderKinds). */
const knownWhole = (cell: string): boolean => cellKind(cell) !== undefined;

// ---------------------------------------------------------------------------
// A scanned header's OCR noise (OCR plan step 2.5, 2026-10-09). The
// header-mapped row path reads WHERE the grade and the credits sit from the
// header line; on a scan one misread header word left a table unmapped and its
// rows read their grade into the title (the bench: Alberta's sample 19 → 3 rows
// right at office-scan quality; Minerva's "Cr./C.E.U." read "Cr./C.E\U." and
// every grade under it was lost). These repairs — the noise marks, a word
// one letter off, a two-line header's run-together lower line — run ONLY on
// OCR lines (parseExternalTranscript was given confidences); a text layer's
// header is read exactly as before. Measured in docs/OCR-BENCHMARK.md
// ("Plan step 2.5") and DECISIONS 2026-10-09.
// ---------------------------------------------------------------------------

/** Marks a scan prints for specks, stains and table rules — never part of a
 * header word: backslash, tilde, equals, bars, underscores, carets, quotes,
 * guillemets, braces and angle brackets, ¢ © ® ¬ and "!". A header cell is
 * read with them removed ("Cr./C.E\U." is "Cr./C.EU.", "Avg ~~ Enrl" is "Avg
 * Enrl"); a cell of nothing but noise is no cell. The full stop, the slash,
 * the hyphen, "&", "#", "*" and parentheses stay: header words use them
 * ("Cr.", "Kode / Code", "L-T-P", "Month & Year", "#", "C * G", "Grade (Letter)"). */
const OCR_HEADER_NOISE_RE = /[\\~=|_^`"“”‘’«»¢©®¬{}<>!]+/g;
const ocrHeaderCell = (cell: string): string => cell.replace(OCR_HEADER_NOISE_RE, '').replace(/\s+/g, ' ').trim().replace(/[.:]+$/, '');

/** The header words (four letters or more) a scan's misread word may be
 * repaired to — every one a word COLUMN_KIND_RES names on its own, so a
 * repaired cell is read by exactly the patterns a printed one is
 * (tests/ocr-header-noise.test.ts asserts that each one maps). Lower case,
 * compared without case. Add a word here when a header word joins
 * COLUMN_KIND_RES and a scan of it is seen misread. */
const OCR_HEADER_WORDS: readonly string[] = [
  // the course and its title
  'course', 'subject', 'code', 'number', 'title', 'name', 'description', 'module',
  // credits and units
  'credit', 'credits', 'units', 'unit', 'hours', 'scope', 'weight', 'ects', 'unts',
  // grades, marks and points
  'grade', 'result', 'results', 'outcome', 'classification', 'marks', 'mark', 'score', 'total', 'obtained', 'points', 'point', 'qpts',
  // attempted / earned
  'attempted', 'taken', 'enrolled', 'registered', 'earned', 'passed',
  // terms and dates
  'term', 'semester', 'session', 'period', 'year', 'date', 'quarter', 'completed',
  // flags and statistics
  'remark', 'remarks', 'notes', 'type', 'category', 'status', 'section', 'repeat', 'repeated', 'comments', 'instructor', 'class', 'average', 'median', 'enrl',
  // the level
  'level', 'career',
];
const OCR_HEADER_WORD_SET = new Set(OCR_HEADER_WORDS);

/** True when `a` becomes `b` by at most one inserted, deleted or substituted
 * character (Levenshtein distance ≤ 1) — the misread of a single glyph. */
function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}

/** A scanned header cell no pattern names, with each word of four letters
 * or more that is not a header word replaced by the header word a single
 * glyph away ("Gradc" → "grade", "Crcdits" → "credits", "Remaik" →
 * "remark"); undefined when no word could be repaired, when a word's
 * candidates name different kinds of column ("Unite" is one glyph from
 * "unit" and from "units" — both the credits, so either), or when the
 * repaired cell is still no header cell. Words of three letters or fewer
 * are never repaired: "Avy" is one glyph from "Avg" — and from "Any" and
 * "Ave". A word with a digit or a symbol inside is never repaired. */
export function ocrRepairHeaderCell(cell: string): string | undefined {
  let changed = false;
  const words = cell.split(' ').map((word) => {
    const bare = word.replace(/[.:]+$/, '');
    const letters = bare.toLowerCase();
    if (letters.length < 4 || OCR_HEADER_WORD_SET.has(letters) || !/^\p{L}+$/u.test(letters)) return word;
    const candidates = OCR_HEADER_WORDS.filter((w) => withinOneEdit(letters, w));
    if (candidates.length === 0) return word;
    const kindsOf = (w: string) => JSON.stringify(cellKinds(w));
    if (candidates.some((w) => kindsOf(w) !== kindsOf(candidates[0]!))) return word;
    changed = true;
    return candidates[0]!;
  });
  if (!changed) return undefined;
  const repaired = words.join(' ');
  return knownWhole(repaired) ? repaired : undefined;
}
/** A cell a column pattern names as it stands (`knownWhole`) — exported for
 * tests/ocr-header-noise.test.ts, which checks every OCR_HEADER_WORDS entry. */
export const isHeaderCell = knownWhole;
export { OCR_HEADER_WORDS };

// ---------------------------------------------------------------------------
// OCR numeric corrections (Batch C, the DGS's answer (4) of 2026-10-09: "OCR-
// only numeric cells: unambiguous letter-for-digit shapes inside credits/grade
// cells are corrected, the ⚠ flag stays and the raw reading is shown beside the
// value; names, titles and the university string are never altered").
// ---------------------------------------------------------------------------

/** The letters a scan prints for a digit and that no number contains: a
 * capital or small O for 0, a small l or a capital I for 1. Nothing
 * else — S, B, Z and G are grades or words as often as they are 5, 8, 2 and 6,
 * and a colon for a decimal point ("3:0") is also a lecture:lab pair ("3:1",
 * IISc), so none of those is ever rewritten. A bar "|" is NOT a letter for 1
 * (review fix 2026-10-10): on a ruled scan it is the table's own rule glued to
 * a value ("3|" is 3 beside a rule, not 31), so a token with a bar is never
 * corrected. */
const OCR_DIGIT_LOOKALIKES: Readonly<Record<string, string>> = { O: '0', o: '0', l: '1', I: '1' };

/** The corrected form of ONE token a scan may have misread inside a credits or
 * grade cell, or undefined when the token is not such a misreading:
 *  - a number of up to three digits, with an optional point or comma and up to
 *    three decimals, written with at least one real digit AND at least one
 *    letter shaped like a digit ("3.O" → "3.0", "l.5" → "1.5", "4,O0" → "4,00",
 *    "8O" → "80"); a token with no real digit ("IO", "I", "l") is a word;
 *  - a letter grade A–D whose plus the engine read as a "t" ("Bt" → "B+").
 * Two shapes are ambiguous and never corrected (review fix 2026-10-10): a whole
 * number made only of strokes — I, l and 1 — is a Roman numeral as often as a
 * number ("Calculus I1" is a misread "Calculus II", never 11 credits), and a
 * whole number whose FIRST character is a letter ("IO1", "O5") reads as a word
 * before a number. A decimal ("l.5", "I.0") keeps its letter-first form: no
 * word or numeral has a point inside it.
 * The caller (`readCourseRow`) decides whether the corrected token is used: only
 * where it then fills the row's credits or grade that the scan's own reading
 * left empty, and never when it would change a title word. */
export function ocrCellCorrection(token: string): string | undefined {
  if (/^[\dOoIl]{1,3}(?:[.,][\dOoIl]{1,3})?$/.test(token) && /\d/.test(token) && /[OoIl]/.test(token)) {
    const whole = !/[.,]/.test(token);
    if (whole && (/^[1Il]+$/.test(token) || !/^\d/.test(token))) return undefined;
    return token.replace(/[OoIl]/g, (ch) => OCR_DIGIT_LOOKALIKES[ch]!);
  }
  const plus = /^([A-D])t$/.exec(token);
  return plus ? `${plus[1]}+` : undefined;
}

/** The course number a scan may have misread with a letter shaped like a
 * digit — the number token of "PHYS 1O1", "CS 5O00", "MATH 2l0" — corrected
 * by OCR_DIGIT_LOOKALIKES (O and o for 0, l and I for 1), or undefined. Only
 * a token of two to six characters made of digits and those letters, with at
 * least one of each, and not led by a letter (a code like McMaster's "1MD3"
 * or "4G06" has other letters and is left alone). A suggestion only, never
 * applied by the reader (DGS 2026-10-12): the student accepts it. */
export function codeLookalikeSuggestion(courseId: string): string | undefined {
  const m = /^(.*\s)([\dOoIl]{2,6})$/.exec(courseId);
  if (!m) return undefined;
  const token = m[2]!;
  if (!/^\d/.test(token) || !/[OoIl]/.test(token)) return undefined;
  return `${m[1]}${token.replace(/[OoIl]/g, (ch) => OCR_DIGIT_LOOKALIKES[ch]!)}`;
}

/** The cells of a header line, and — on an OCR line — each cell with the
 * scan's noise removed (`ocrHeaderCell`). */
function headerCellsOf(flat: string, ocr: boolean): string[] {
  const raw = flat.split(/\s{2,}/).map((c) => c.trim().replace(/[.:]+$/, '')).filter((c) => c.length > 0);
  return ocr ? raw.map(ocrHeaderCell).filter((c) => c.length > 0) : raw;
}

/** On an OCR line the cells of a header that is ALREADY evidenced as one —
 * at least three of its cells, and 60 % of them, named by a pattern exactly —
 * have their unknown cells repaired (`ocrRepairHeaderCell`). A line with less
 * evidence is left as read: a fuzzy match is never what makes a line a header. */
function ocrRepairedCells(cells: string[]): string[] {
  const exact = cells.reduce((n, c) => n + (knownWhole(c) || cellKinds(c).some((k) => k !== 'flag') ? 1 : 0), 0);
  if (exact < 3 || exact < Math.ceil(cells.length * 0.6)) return cells;
  return cells.map((c) => (knownWhole(c) || cellKinds(c).some((k) => k !== 'flag') ? c : (ocrRepairHeaderCell(c) ?? c)));
}

function readColumnHeader(flat: string, ocr = false): ColumnKind[] | undefined {
  const rawCells = ocr ? ocrRepairedCells(headerCellsOf(flat, true)) : headerCellsOf(flat, false);
  if (rawCells.length < 3 || rawCells.length > 14) return undefined;
  if (rawCells.some((c) => /\d{3,}/.test(c))) return undefined; // a row, a date, a code
  // A cell that holds two header words is two cells from here on.
  const cells: string[] = [];
  const kinds: ColumnKind[] = [];
  let known = 0;
  for (const cell of rawCells) {
    const ks = cellKinds(cell);
    if (ks.length === 2) {
      const words = cell.trim().split(/\s+/);
      // The cut cellKinds made: the longest tail that is a header word.
      let cut = words.length - 1;
      for (; cut >= 1; cut--) if (cellKind(words.slice(0, cut).join(' '))?.kind === ks[0] && cellKind(words.slice(cut).join(' '))?.kind === ks[1]) break;
      cells.push(words.slice(0, cut).join(' '), words.slice(cut).join(' '));
    } else cells.push(cell);
    for (const k of ks) {
      kinds.push(k);
      if (k !== 'flag' || knownWhole(cell)) known += 1;
    }
  }
  if (cells.length > 14) return undefined;
  if (known < 3 || known < Math.ceil(cells.length * 0.6)) return undefined;
  if (!kinds.includes('code') && !kinds.includes('title')) return undefined;
  if (!kinds.some((k) => k === 'credits' || k === 'ects' || k === 'grade' || k === 'mark' || k === 'attempted' || k === 'earned')) return undefined;
  // German "Note" is the grade unless another grade column exists (then it is
  // the English "Note", a remark).
  if (!kinds.includes('grade')) cells.forEach((c, i) => { if (/^note$/i.test(c)) kinds[i] = 'grade'; });
  // "Number   Course   ECTS …": two code-like cells and no title — the second
  // is the title. "Unit of Study   Title …": two title-like cells and no code
  // — the first is the code. A lone "Course" cell is the code AND the title.
  // A "Code" / "Notation" cell AFTER the title is a notation column (UCI).
  const firstTitle = kinds.indexOf('title');
  const firstCode = kinds.indexOf('code');
  if (firstTitle < 0 && kinds.filter((k) => k === 'code').length >= 2) kinds[kinds.indexOf('code', firstCode + 1)] = 'title';
  else if (firstTitle < 0) kinds[firstCode] = 'title';
  else if (firstCode < 0 && kinds.filter((k) => k === 'title').length >= 2) kinds[firstTitle] = 'code';
  const titleAt = kinds.indexOf('title');
  for (let i = titleAt + 1; i < kinds.length; i++) if (kinds[i] === 'code' || kinds[i] === 'title' || kinds[i] === 'serial') kinds[i] = 'flag';
  // A second grade column headed "Classification" (SNU, KAIST: "Major
  // Elective" / "Research") is a course-type cell, not a grade — the UK's
  // degree classification keeps the word in the grade list for a transcript
  // that prints no other grade column (F6, 2026-10-09).
  if (kinds.filter((k) => k === 'grade').length >= 2) cells.forEach((c, i) => { if (kinds[i] === 'grade' && /^classification$/i.test(c)) kinds[i] = 'flag'; });
  // "CH" beside a real credits word (a Brazilian carga horária next to
  // Créditos) is the workload; alone it is the credit hours (F6, 2026-10-09).
  if (kinds.filter((k) => k === 'credits').length >= 2) cells.forEach((c, i) => { if (kinds[i] === 'credits' && /^ch$/i.test(c)) kinds[i] = 'workload'; });
  // "CH" in a header written in Portuguese or Spanish is the carga horária
  // too (F6 review, 2026-10-09): a histórico that prints only CH and no
  // Créditos column read its 60 and 90 HOURS as the credits. The language of
  // the header's other cells is the evidence — "Código", "Disciplina", "Nota",
  // "Conceito", "Situação", "Período" — HEC's English "Course Code / Course
  // Title / CH / Grade / GPs" keeps CH as the credit hours. The hours are
  // never converted to credits: the credits stay blank for the student.
  if (cells.some((c) => IBERIAN_HEADER_WORD_RE.test(c.replace(/\s*\(.*\)\s*$/, '')))) cells.forEach((c, i) => { if (kinds[i] === 'credits' && /^ch$/i.test(c)) kinds[i] = 'workload'; });
  // No credits column: a "Points" column BEFORE the grade is the credits (New
  // Zealand, UK credit points), and Iranian "Theoretical / Practical" cells
  // are credit hours of each kind.
  if (!kinds.includes('credits') && !kinds.includes('attempted')) {
    const gradeAt = kinds.indexOf('grade');
    const pointsAt = kinds.indexOf('points');
    if (pointsAt >= 0 && (gradeAt < 0 || pointsAt < gradeAt)) kinds[pointsAt] = 'credits';
    cells.forEach((c, i) => {
      if (kinds[i] === 'mark' && /^(?:theoretical|practical|theory\s*credits?|lab\s*credits?)$/i.test(c.replace(/\s*\(.*\)\s*$/, ''))) kinds[i] = 'credits';
    });
  }
  lastHeaderCells = cells;
  return kinds;
}

/** A header printed on TWO lines (F6, 2026-10-09 — Alberta's PeopleSoft SQR
 * record: "Grade   Units   Units   Grade   Class   Class" over "Course
 * Description   Remark   Taken   Passed   Points   Avg   Enrl"): the upper
 * line's words are the top halves of the LAST (or the first) columns of the
 * lower line. The two are joined only when neither is a header on its own and
 * every joined pair is a header word as it stands ("Grade Remark", "Units
 * Taken", "Units Passed", "Grade Points", "Class Avg", "Class Enrl") — one
 * pair that is not, and the lines are left as they were. */
function joinedHeaderKinds(upper: string, lower: string, ocr = false): ColumnKind[] | undefined {
  const up = headerCellsOf(upper, ocr);
  if (up.length < 2 || [...up, lower].some((c) => /\d{3,}/.test(c))) return undefined;
  if (readColumnHeader(upper, ocr) !== undefined) return undefined; // a header of its own
  const asRead = headerCellsOf(lower, ocr);
  const kinds = joinAt(up, asRead, ocr);
  if (kinds !== undefined || !ocr) return kinds;
  // A scan's lower line may come with two or more of its one-word cells run
  // together, the engine having read their gap as a word space ("Remark Taken
  // Passed Points" — OCR plan step 2.5): split back into words when every word
  // is a header word on its own (or one glyph from one: "Avg BEnrl"), then
  // joined by the same rule.
  const word = (w: string) => (knownWhole(w) ? w : ocrRepairHeaderCell(w));
  const split = asRead.flatMap((c) => {
    const words = c.split(' ').map(word);
    return words.length > 1 && words.every((w) => w !== undefined) ? (words as string[]) : [c];
  });
  return split.length > asRead.length ? joinAt(up, split, ocr) : undefined;
}
/** joinedHeaderKinds' join of an upper line's cells over a lower line's. */
function joinAt(up: string[], low: string[], ocr: boolean): ColumnKind[] | undefined {
  if (up.length > low.length || low.length > 14) return undefined;
  for (const offset of [low.length - up.length, 0]) {
    const paired = (i: number) => i >= offset && i < offset + up.length;
    let joined = low.map((c, i) => (paired(i) ? `${up[i - offset]} ${c}` : c));
    if (!joined.every((c, i) => !paired(i) || knownWhole(c))) {
      // A scan (OCR plan step 2.5): a joined pair one glyph off a header word
      // is repaired ("Units Takcn" → "Units taken") — only when 60 % of the
      // pairs, and at least three, are header words exactly as read.
      if (!ocr) continue;
      const exact = joined.filter((c, i) => paired(i) && knownWhole(c)).length;
      if (exact < 3 || exact < Math.ceil(up.length * 0.6)) continue;
      joined = joined.map((c, i) => (paired(i) && !knownWhole(c) ? (ocrRepairHeaderCell(c) ?? c) : c));
      if (!joined.every((c, i) => !paired(i) || knownWhole(c))) continue;
    }
    const kinds = readColumnHeader(joined.join('   '), ocr);
    if (kinds !== undefined) return kinds;
  }
  return undefined;
}

// "TBA" and "NaN" (F6, 2026-10-09): Minerva prints TBA for credits not yet
// set and NaN for the earned units beside them — empty cells, never a grade.
const PLACEHOLDER_TOKEN_RE = /^(?:[-–—_]+|n\/a|\.{2,}|\*+|tba|nan)$/i; // bare "NA" is Illinois Tech's non-attendance grade, not a blank

/** Institutions whose transcript prints its NAME only as an image, but whose
 * text carries an unmistakable acronym (DGS 2026-09-08: Johns Hopkins prints
 * the name in a logo, and the text says "JHU Degree and Date Conferred").
 *
 * This is the last thing tried, so a transcript that spells its name out
 * always wins — the acronym never overrides a name the parser can read. The
 * pattern is CASE-SENSITIVE: transcripts print these acronyms in capitals, and
 * requiring capitals keeps a lower-case look-alike (a surname, a web address
 * inside a course title) from renaming the whole transcript.
 *
 * The value is the institution's real name, because that is what the student,
 * the DGS and the Grad Admin read, and what the ExternalCourses tab is keyed
 * on. Add a row here when another school turns up with the same problem. */
const NAME_ONLY_IN_IMAGE: readonly (readonly [RegExp, string])[] = [
  [/\bJHU\b/, 'Johns Hopkins University'],
  // UC San Diego prints the logo as an image and abbreviates itself in the
  // text ("---UCSD DEGREES AWARDED---", DGS 2026-09-09).
  [/\bUCSD\b/, 'University of California, San Diego'],
  // Schools whose header prints only the brand (public transcript keys and
  // templates, 2026-09-26); each is a weak guess the student can correct.
  [/\bKU\s?LEUVEN\b/i, 'KU Leuven'],
  [/\bETH\s+Z[uü]rich\b/i, 'ETH Zurich'],
  [/\bEPFL\b/, 'École Polytechnique Fédérale de Lausanne'],
  [/\bTU\s?Delft\b/i, 'Delft University of Technology'],
  [/\bTU\/e\b|\bTU\s?Eindhoven\b/i, 'Eindhoven University of Technology'],
  [/\bTU\s?Wien\b/i, 'TU Wien'],
  [/\bKTH\b/, 'KTH Royal Institute of Technology'],
  [/\bDTU\b/, 'Technical University of Denmark'],
  [/\bNTNU\b/, 'Norwegian University of Science and Technology'],
  [/\bUCL\b/, 'University College London'],
  [/\bLSE\b/, 'London School of Economics and Political Science'],
  [/\bKIT\b/, 'Karlsruhe Institute of Technology'],
  [/\bRWTH\b/, 'RWTH Aachen University'],
  [/\bTUM\b/, 'Technical University of Munich'],
  [/\bKAIST\b/, 'Korea Advanced Institute of Science and Technology'],
  [/\bPOSTECH\b/, 'Pohang University of Science and Technology'],
  // Rensselaer prints its name only as the red wordmark, drawn as vector art
  // with no text behind it; the only text naming the school is the registrar's
  // address block — "Troy, New York 12180-3590 / Tel: 518-276-6231" — so the
  // ZIP+4 and the registrar's phone stand in for the name (DGS 2026-09-28,
  // from a sanitized transcript).
  [/\b12180-3590\b|\b518[-.\s]276[-.\s]6231\b/, 'Rensselaer Polytechnic Institute'],
];

/** The name a WATERMARK spells out (DGS 2026-09-12). UC San Diego tiles
 * "UNIVERSITY OF CALIFORNIA SAN DIEGO • UNIVERSITY OF CALIFORNIA SAN DIEGO •
 * …" across every page; the text layer breaks the tiles at the margins and at
 * column gaps, and a fragment such as "UNIVERSITY OF CALIFORNIA" is itself a
 * perfectly good-looking name — which is what the parser returned. But a
 * phrase repeated on one line with a separator, on several lines, IS the
 * institution's name in full: read it from the tiles rather than from any
 * fragment. Undefined when no line repeats a university-like phrase. */
function watermarkName(lines: string[]): string | undefined {
  const seen = new Map<string, { count: number; text: string }>();
  for (const line of lines) {
    const parts = line.split(/\s*[•·|]\s*/).map((c) => c.replace(/\s+/g, ' ').trim());
    const counts = new Map<string, string>();
    const perLine = new Map<string, number>();
    for (const c of parts) {
      if (c.length < 8 || c.length > 80 || /\d/.test(c) || !STRONG_NAME_RE.test(c)) continue;
      const key = normalizeUniversity(c);
      if (key === '') continue;
      counts.set(key, c);
      perLine.set(key, (perLine.get(key) ?? 0) + 1);
    }
    for (const [key, n] of perLine) {
      if (n < 2) continue; // repeated on the SAME line — the tiling, not a header
      const e = seen.get(key) ?? { count: 0, text: counts.get(key)! };
      e.count += 1;
      seen.set(key, e);
    }
  }
  const best = [...seen.values()].filter((e) => e.count >= 2).sort((a, b) => b.count - a.count)[0];
  if (best === undefined) return undefined;
  // A school this file already knows by its acronym keeps its canonical
  // spelling (the ExternalCourses tab is keyed on it); otherwise Title Case.
  const known = NAME_ONLY_IN_IMAGE.find(([, name]) => normalizeUniversity(name) === normalizeUniversity(best.text));
  if (known) return known[1];
  return best.text
    .toLowerCase()
    .replace(/(^|[\s-])([a-zà-ÿ])/g, (_, sep: string, ch: string) => sep + ch.toUpperCase())
    .replace(/\b(Of|The|And|At|De|Da|Di|Du|Von|Van|Der|Del|La|Le)\b/g, (w) => w.toLowerCase())
    .replace(/^([a-z])/, (ch) => ch.toUpperCase());
}

/** Resolve a multi-campus system's campus (DGS 2026-09-12): the full campus
 * name when the record says which campus, else the system name plus
 * `campusSystem` so the preview asks. */
function withCampus(
  guess: { university?: string; universityGuessed?: true },
  lines: string[],
): { university?: string; universityGuessed?: true; campusSystem?: string; campus?: string } {
  const r = resolveCampus(guess.university, lines);
  if (r.system === undefined) return guess;
  // An acronym-recovered name stays a guess even once the campus is known.
  if (r.campus !== undefined) return { ...guess, university: r.campus.full, campusSystem: r.system.system, campus: r.campus.name };
  return { ...guess, university: r.system.system, campusSystem: r.system.system };
}

/** The institution that AWARDED the degree, when the "Degrees Awarded" block
 * names one (DGS 2026-09-13). Indiana University's registrar prints "Indiana
 * University Bloomington" in the header of every IU transcript — including
 * an IUPUI student's, whose degree block then says "Indiana University Purdue
 * University Indianapolis". The awarding school is the one the rules key on,
 * so a university-like name inside the block (the longest, digit-free one,
 * within ten lines of the heading) beats the header. A block headed "…by
 * other institutions" (UC San Diego) names somebody else and is skipped. */
function awardingInstitution(lines: string[]): string | undefined {
  for (let i = 0; i < lines.length; i++) {
    const flat = lines[i]!.replace(/\s+/g, ' ').trim();
    if (!DEGREES_AWARDED_HEADING_RE.test(flat) || /other\s+institution/i.test(flat)) continue;
    let best: string | undefined;
    for (let k = 1; k <= 10 && i + k < lines.length; k++) {
      const cand = lines[i + k]!
        .replace(/\s+/g, ' ')
        .replace(/\s+degree\s*$/i, '')
        // "Campus: Indiana University Indianapolis" (IU's degree block, 2026-09-26).
        .replace(/^(?:campus|institution|university|school|awarded\s+by|awarding\s+institution|name\s+of\s+institution)\s*:\s*/i, '')
        .trim();
      // The block ends where the transfer-credit block begins (2026-09-20):
      // "Transferred from: University of Florida" names the other school.
      if (TRANSFER_BANNER_RE.test(cand)) break;
      if (TRANSFER_FROM_RE.test(cand)) continue;
      if (cand.length < 8 || cand.length > 90 || /\d/.test(cand) || !STRONG_NAME_RE.test(cand) || SENTENCE_RE.test(cand) || /^(college|school|department|faculty|institute)\s+of\b/i.test(cand)) continue;
      if (best === undefined || cand.length > best.length) best = cand;
    }
    if (best !== undefined) return best;
  }
  return undefined;
}

/** The date that follows the degree-date label on a line — "Date of
 * Registration: 09.09.2019   Graduation Date: 30.06.2023" gives the second
 * (METU, 2026-09-26) — else the line's first date. */
function dateAfterLabel(line: string): string | undefined {
  const at = DEGREE_DATE_LINE_RE.exec(line)?.index;
  const tail = at === undefined ? line : line.slice(at);
  // dateOnLine reads "25/06/2022" month-first and returns an impossible month;
  // a day-first reading is then the one (University of Delhi, 2026-09-26).
  const sane = (d: string | undefined) => (d !== undefined && Number(d.slice(5, 7)) <= 12 ? d : undefined);
  return sane(dateOnLine(tail)) ?? isoOrEuropeanDate(gregorianPart(tail)) ?? sane(dateOnLine(line)) ?? isoOrEuropeanDate(gregorianPart(line));
}

/** The Gregorian half of a dual-calendar date: "1401/06/30 (2022/09/21)" →
 * "(2022/09/21)"; a line with no parenthesised date is returned whole. */
const gregorianPart = (text: string): string => /\(\s*(?:19|20)\d{2}[-/.]\d{1,2}[-/.]\d{1,2}\s*\)/.exec(text)?.[0] ?? text.replace(/\b1[34]\d{2}[-/.]\d{1,2}[-/.]\d{1,2}\b/g, ' ');

/** An ISO or day-first numeric date on a line (2026-09-26): "2023-10-27",
 * "27-Jun-19", "30.06.2023", "15/07/2023", "25/06/2022" — day-first when the
 * first number exceeds 12 or the separator is a dot or dash; a month above 12
 * is refused rather than written into the record. */
const ROMANCE_MONTHS: readonly (readonly string[])[] = [
  ['enero', 'janeiro', 'janvier', 'gennaio', 'jan'],
  ['febrero', 'fevereiro', 'février', 'fevrier', 'febbraio', 'feb', 'fev'],
  ['marzo', 'março', 'marco', 'mars', 'mar'],
  ['abril', 'avril', 'aprile', 'abr', 'apr'],
  ['mayo', 'maio', 'mai', 'maggio', 'may'],
  ['junio', 'junho', 'juin', 'giugno', 'jun'],
  ['julio', 'julho', 'juillet', 'luglio', 'jul'],
  ['agosto', 'août', 'aout', 'ago', 'aug'],
  ['septiembre', 'setembro', 'setiembre', 'septembre', 'settembre', 'sep', 'set'],
  ['octubre', 'outubro', 'octobre', 'ottobre', 'oct', 'out'],
  ['noviembre', 'novembro', 'novembre', 'nov'],
  ['diciembre', 'dezembro', 'décembre', 'decembre', 'dicembre', 'dic', 'dez', 'dec'],
];
export function isoOrEuropeanDate(text: string, dayFirst = false): string | undefined {
  const pad = (n: number) => String(n).padStart(2, '0');
  const valid = (y: number, m: number, d: number) => (y >= 1950 && y <= 2049 && m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${pad(m)}-${pad(d)}` : undefined);
  const iso = /\b((?:19|20)\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/.exec(text);
  if (iso) return valid(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  // "18 de marzo de 2023", "15 de dezembro de 2023", "5 luglio 2024", "12 juin 2023".
  const romance = /\b(\d{1,2})\s+(?:de\s+)?([a-zçéû]{3,10})\s+(?:de\s+)?((?:19|20)\d{2})\b/i.exec(text);
  if (romance) {
    const month = ROMANCE_MONTHS.findIndex((names) => names.some((n) => romance[2]!.toLowerCase().startsWith(n))) + 1;
    if (month > 0) return valid(Number(romance[3]), month, Number(romance[1]));
  }
  const mon = /\b(\d{1,2})[-/. ]([A-Za-z]{3})[a-z]*[-/. ,]+(\d{2,4})\b/.exec(text);
  if (mon) {
    const month = MONTHS.indexOf(mon[2]!.toUpperCase()) + 1;
    const y = mon[3]!.length === 2 ? 2000 + Number(mon[3]) : Number(mon[3]);
    return month === 0 ? undefined : valid(y, month, Number(mon[1]));
  }
  const num = /\b(\d{1,2})([-/.])(\d{1,2})\2((?:19|20)\d{2})\b/.exec(text);
  if (num) {
    const a = Number(num[1]);
    const b = Number(num[3]);
    const y = Number(num[4]);
    if (num[2] === '/' && a <= 12 && b > 12) return valid(y, a, b); // US month-first
    if (num[2] !== '/' || a > 12 || dayFirst) return valid(y, b, a); // day-first
    return undefined; // ambiguous "05/06/2023": dateOnLine's US reading stands
  }
  return undefined;
}

/** A date read through OCR noise (DGS 2026-09-16): "Aprill//09, Z2025/l" is
 * April 9, 2025 — the month by its first three letters, up to four stray
 * characters between the parts, a stray letter glued to the year. Only used
 * where a conferral is already established, so the looseness cannot invent
 * a date elsewhere. */
export function looseDateOnLine(line: string): string | undefined {
  const m = /\b([A-Za-z]{3,10})[^A-Za-z0-9]{0,4}(\d{1,2})[^0-9]{0,4}[A-Za-z]?(\d{4})\b/.exec(line);
  if (!m) return undefined;
  const month = MONTHS.indexOf(m[1]!.slice(0, 3).toUpperCase()) + 1;
  const day = Number(m[2]);
  const year = Number(m[3]);
  if (month === 0 || day < 1 || day > 31 || year < 1950 || year > 2049) return undefined;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** The institution and how sure we are of it: a name read from the text is
 * taken as printed; a name recovered from an acronym is only a suggestion, so
 * the preview lets the student correct it (2026-09-08). */
function guessedUniversity(lines: string[]): { university?: string; universityGuessed?: true } {
  // The watermark, when there is one, spells the name in full and beats any
  // fragment of itself (DGS 2026-09-12).
  const tiled = watermarkName(lines);
  if (tiled !== undefined) return { university: expandInstitutionAbbreviations(tiled) };
  // The school that awarded the degree beats the registrar's header (DGS
  // 2026-09-13: an IUPUI transcript is issued by IU Bloomington).
  const awarding = awardingInstitution(lines);
  if (awarding !== undefined) return { university: expandInstitutionAbbreviations(awarding) };
  // A name printed in the text wins — but only a STRONG one. The acronym of a
  // school that hides its name in an image beats a weak "… College" match,
  // because that match is as likely to come from a block naming somebody else
  // (UC San Diego lists "DEGREES AWARDED BY OTHER INSTITUTIONS" — DGS
  // 2026-09-09).
  const strong = expandName(guessUniversity(lines, false));
  if (strong !== undefined) return { university: strong };
  for (const [re, name] of NAME_ONLY_IN_IMAGE) {
    if (lines.some((line) => re.test(line))) return { university: name, universityGuessed: true };
  }
  const weak = expandName(guessUniversity(lines, true));
  return weak === undefined ? {} : { university: weak };
}

const expandName = (name: string | undefined): string | undefined => (name === undefined ? undefined : expandInstitutionAbbreviations(name));

/** Which lines sit inside a transfer-credit block (F5, 2026-10-09), for the
 * university guess: opened by Banner's "TRANSFER CREDIT ACCEPTED BY …",
 * PeopleSoft's "Transfer Credits" / "Transfer Credit from …", a bare
 * "TRANSFER CREDIT:" heading (Evergreen) or the transfer table header; closed
 * by "INSTITUTION CREDIT", the block's own totals, a graduate-record banner,
 * another short all-capitals section heading ending in a colon ("EVERGREEN
 * CREDIT:"), a page break, or a short term header that names no institution.
 * The heading line itself counts as inside. */
function transferScope(lines: readonly string[]): boolean[] {
  const SECTION_HEADING_LINE_RE = /^[A-Z][A-Z &/'-]{2,40}:\s*$/;
  const TERM_LINE_RE = /^(?:fall|spring|summer|autumn|winter|term|semester)\b[^\n]{0,30}\b(?:19|20)\d{2}\b[^\n]{0,20}$/i;
  let inside = false;
  return lines.map((raw) => {
    const line = raw.replace(/\s{2,}/g, ' ').trim();
    if (TRANSFER_BANNER_RE.test(line) || TRANSFER_TABLE_RE.test(line) || TRANSFER_PEOPLESOFT_RE.test(line)) return (inside = true);
    if (!inside) return false;
    if (line === '' || INSTITUTION_CREDIT_RE.test(line) || TRANSFER_END_RE.test(line) || TRANSFER_TOTALS_RE.test(line)) return (inside = false);
    if (SECTION_HEADING_LINE_RE.test(line) && !/transfer/i.test(line)) return (inside = false);
    if (TERM_LINE_RE.test(line) && !NAMES_INSTITUTION_RE.test(line)) return (inside = false);
    return true;
  });
}

/** Guess the institution from the first page's header lines: the earliest
 * digit-free line that names a university-like body. */
function guessUniversity(lines: string[], weak: boolean): string | undefined {
  // Strong words name an institution; "college" alone is weak (it also names a
  // division — "College of Science" — or a Banner field, "College : …").
  // "Inst." is how Georgia Tech's transcript abbreviates it (DGS 2026-09-08).
  const STRONG_RE =
    /universit|\binst(?:itute)?\.?\s+of\s+(?:tech|information\s+technology|science|engineering)|\binstitut\w*\s+(?:of\s+)?(?:science|technology|teknologi)|polytechnic|politecnico|polytechnique|politécnic|technical\s+university|technische\s+universität|école|hochschule|academy\s+of\s+higher\s+education|vidyapeeth|vishwavidyalaya|viswavidyalaya|universidad|università|universität|universiteit|universitas|대학교|大学/i;
  const WEAK_RE = /college/i;
  const DIVISION_RE = /^(college|school|department|faculty|institute)\s+of\b|\bcollege of\b|^(program|college|major|degree)\s*:/i;
  /** Candidate name cells: each line split at column gaps (a merged two-column
   * line yields the institution's own cell), cleaned, and filtered. */
  // "UNIVERSITY" on its own names nobody. UC San Diego's transcript tiles
  // "UNIVERSITY OF CALIFORNIA, SAN DIEGO •" across the page as a watermark,
  // and the text layer breaks it into fragments — one of which was read as the
  // institution (DGS 2026-09-09).
  const GENERIC_ONLY_RE = /^(the\s+)?(universit(y|e|à|ä|ies)|college|institute|school|campus)(\s+of)?[.,]?$/i;
  // A program name that happens to contain the word ("BACHELOR OF UNIVERSITY",
  // the ANU sample's award list, 2026-09-26) is not the institution.
  const DEGREE_PHRASE_RE = /^(?:bachelor|master|doctor)s?(?:'s)?\s+(?:of|in)\b|^(?:graduate|postgraduate)\s+(?:diploma|certificate)\b/i;
  // The same watermark, unbroken: a university phrase REPEATS on the line
  // ("UNIVERSITY OF CALIFORNIA … UNIVERSITY OF CALIFORNIA"). Two different
  // "University" phrases are a real name — "BINGHAMTON UNIVERSITY, STATE
  // UNIVERSITY OF NEW YORK" (DGS 2026-09-20; the word alone used to refuse it).
  const REPEATED_RE = /\b(universit\w*(?:\s+\w+){1,3})\b[\s\S]*\b\1\b/i;
  const clean = (c: string) =>
    c
      .replace(/\s{2,}/g, ' ')
      .replace(/\s*::\s*[A-Z][A-Za-z .]*?\s*-?\s*\d{3}\s?\d{3}\s*$/, '')
      .replace(/[\s,]+-\s*\d{3}\s?\d{3}\s*$/, '')
      // "The Evergreen State College - Olympia, Washington 98505": a US
      // address after a dash is not part of the name (F5, 2026-10-09).
      .replace(/\s+[-–—]\s+[A-Za-z .']{3,30},\s+[A-Za-z .]{2,30}\s+\d{5}(?:-\d{4})?\s*$/, '')
      .trim();
  // Never the university (F5, 2026-10-09): a transcript-delivery vendor named
  // on a cover or authentication page; Minerva's "From: Dawson College - 24
  // credits" (the source of an exemption); an affiliated or constituent
  // college line ("Affiliated College: Huron University College"); the label
  // of an academic year ("Année Universitaire :", "Año Académico").
  const VENDOR_RE = /\bparchment\b|\bcredentials?\s+solutions?\b|\bnational\s+student\s+clearinghouse\b|\bescrip-?safe\b|\bglobalsign\b|\bmy\s*equals\b|\bdigitary\b/i;
  const FROM_LINE_RE = /^\s*from\s*:/i;
  const AFFILIATED_RE = /^\s*(?:affiliat\w*|constituent|federated|partner)\s+(?:college|university|institution|school)s?\s*:/i;
  const ACADEMIC_YEAR_LABEL_RE = /\bann[ée]e\s+universitaire\b|\ba[ñn]o\s+(?:universitario|acad[ée]mico|lectivo)\b|\bano\s+(?:letivo|acad[êe]mico)\b|\banno\s+accademico\b|\bacademic\s+year\s*:/i;
  const plausible = (c: string) =>
    c.length >= 4 &&
    c.length <= 80 &&
    !/\d{3,}/.test(c) &&
    !DIVISION_RE.test(c) &&
    !SENTENCE_RE.test(c) &&
    !GENERIC_ONLY_RE.test(c) &&
    !DEGREE_PHRASE_RE.test(c) &&
    !REPEATED_RE.test(c) &&
    !TRANSFER_FROM_RE.test(c) &&
    !VENDOR_RE.test(c) &&
    !FROM_LINE_RE.test(c) &&
    !AFFILIATED_RE.test(c) &&
    !ACADEMIC_YEAR_LABEL_RE.test(c);
  /** Candidate name cells: the whole line first when it is a short,
   * digit-free name spaced out across the page ("UNIVERSITY   OF   SOUTHERN
   * CALIFORNIA", 2026-09-05), then each cell at a column gap (a merged
   * two-column line yields the institution's own cell). */
  const cells = (line: string): string[] => {
    const whole = clean(line);
    const parts = line.split(/\s{3,}/).map(clean);
    const wholeFirst = parts.length > 1 && parts.every((c) => /^[A-Za-z.,'&-]+$/.test(c)) && whole.split(' ').length <= 8 ? [whole] : [];
    return [...wholeFirst, ...parts].filter(plausible);
  };
  const stripRecordWords = (cell: string): string => {
    // NEVER change what this reads for a school the ExternalCourses tab lists
    // (DGS 2026-10-07): the tab's university names were read by this import
    // from official transcripts and are never altered, so a future transcript
    // must read the same name — Georgia Tech's is "GEORGIA INSTITUTE OF
    // TECHNOLOGY OFFICIAL DOCUMENT INFORMATION", header words and all.
    // Header lines often append record words ("TSINGHUA UNIVERSITY STUDENT
    // RECORD", "Northeastern University, Office of the Registrar"); strip them
    // so the guess is the institution's name alone.
    const stripped = cell
      // "ANNA UNIVERSITY :: CHENNAI 600 025", "… TIRUCHIRAPPALLI - 620 015" (2026-09-26).
      .replace(/\s*::\s*[A-Z][A-Za-z .]*?\s*-?\s*\d{3}\s?\d{3}\s*$/, '')
      .replace(/[\s,]+-\s*\d{3}\s?\d{3}\s*$/, '')
      // "Official Academic Transcript from Binghamton University" — an
      // eScrip-Safe cover's heading (F5, 2026-10-09): the record words before
      // the name may include "academic" / "electronic".
      .replace(/^(unofficial|official)?\s*(?:electronic\s+)?(?:academic\s+)?transcript\s*(of|from)?\s*/i, '')
      // A bare leading "UNOFFICIAL" ("UNOFFICIAL University at Buffalo
      // Transcript", DGS 2026-09-14).
      .replace(/^(unofficial|official)\s+/i, '')
      .replace(/^(the\s+)?office of the (university\s+)?registrar[,\s-]*/i, '')
      .replace(/[,\s—–-]*(the\s+)?office of the (university\s+)?registrar\s*$/i, '')
      .replace(/[\s—–-]*(unofficial|official)?\s*(student|academic)?\s*(records?|transcripts?|copy)\s*$/i, '')
      .replace(/[\s—–-]*(course\s+numbering|grade\s+scale|grading\s+(system|scale)|transcript\s+(guide|key|legend))\s*$/i, '')
      .replace(/^[\s?•·*|,.-]+|[\s?•·*|,.-]+$/g, '')
      .trim();
    return stripped; // empty when the cell was only record words ("Office of the University Registrar")
  };
  // Header first (the first 30 lines), then the rest of the document: Banner
  // official transcripts name the institution only on the legend page
  // (2026-09-05), so the header may hold nothing but divisions and programs.
  // A transfer-credit block names OTHER schools (F5, 2026-10-09 — Evergreen's
  // "TRANSFER CREDIT:" rows read "University of Washington" as the
  // university): its lines are skipped, from the heading to the next section
  // heading, "INSTITUTION CREDIT", a totals line or a term header that names
  // no institution (a transfer term inside Banner's block does name one).
  const inTransfer = transferScope(lines);
  const passes: [string[], RegExp][] = weak
    ? [[lines.slice(0, 30), WEAK_RE]]
    : [
        [lines.slice(0, 30), STRONG_RE],
        [lines, STRONG_RE],
      ];
  for (const [scope, re] of passes) {
    for (const [i, line] of scope.entries()) {
      if (inTransfer[i]) continue;
      for (const cell of cells(line)) {
        if (!re.test(cell)) continue;
        const name = stripRecordWords(cell);
        // Stripping the record words can leave a generic remainder
        // ("University Registrar" → "University"), which names nobody.
        if (name !== '' && !GENERIC_ONLY_RE.test(name) && (re.test(name) || WEAK_RE.test(name))) return name;
      }
    }
  }
  return undefined;
}

/** The lines that are the INSTITUTION's own heading, where a country calendar
 * (TH02, DGS 2026-10-09) may find the institution's country — review fix
 * 2026-10-10: any header cell used to count, so a student's "Nationality
 * Thailand" or "Address   …   Bangkok, Thailand" on a Korean transcript moved
 * every numbered semester onto Thailand's calendar. The heading is the first
 * line of the first 15 that names an institution (a cell with "University",
 * "Institute", "Polytechnic" or "College" in it) and carries no field, and the
 * two lines right under it while they carry no field either — "CHULALONGKORN
 * UNIVERSITY" / "OFFICE OF THE REGISTRAR   Bangkok, Thailand". A line carries a
 * field when a cell is a label ("Name:", "Date of Birth:", "Address:") or its
 * first cell names a person's field without a colon (`PERSON_FIELD_RE`:
 * "Nationality   Thailand"); the heading ends there. Lines above the
 * institution's name (a mailing block printed first) are never its heading.
 * Nothing else is evidence: a country printed only elsewhere, or a heading the
 * test cannot find, leaves the calendar-order rule of 2026-09-26 in force. */
const PERSON_FIELD_RE =
  /^(?:nationality|citizenship|citizen\s+of|(?:mailing|home|permanent|present|current|postal|correspondence|contact)?\s*address|place\s+of\s+birth|birth\s*place|born\b|country(?:\s+of\s+(?:birth|citizenship|origin|residence))?|domicile|residence|home\s+country|native\s+country|passport|name|student|sex|gender|date\s+of\s+birth|dob)\b/i;
const INSTITUTION_WORD_RE = /\buniversit|\binstitute\b|\bpolytechnic\b|\bcollege\b/i;
function institutionHeading(lines: readonly string[]): string[] {
  const cellsOf = (line: string) => line.split(/\s{2,}/).map((c) => c.trim()).filter((c) => c.length > 0);
  const carriesField = (line: string): boolean => {
    const cells = cellsOf(line);
    return cells.some((c) => /^[^:]{1,40}:(?:\s|$)/.test(c)) || (cells.length > 0 && PERSON_FIELD_RE.test(cells[0]!));
  };
  const head = lines.slice(0, 15);
  const at = head.findIndex((l) => !carriesField(l) && cellsOf(l).some((c) => INSTITUTION_WORD_RE.test(c)));
  if (at < 0) return [];
  const heading = [head[at]!];
  for (const l of head.slice(at + 1, at + 3)) {
    if (carriesField(l)) break;
    heading.push(l);
  }
  return heading;
}

/** OCR lines below this confidence get their rows flagged in the preview.
 * Since OCR step 11 (2026-10-09) a line's confidence is its least confident
 * WORD's (src/transcript/ocr-lines.ts OCR_LINE_CONFIDENCE). The floor was
 * re-measured then on the bench (DECISIONS 2026-10-09): on degraded scans of
 * 32 public and generator documents the flag's precision sits at the share of
 * rows that are wrong whatever the floor (72–75 % from 70 to 88), so the data
 * hold no better number than 80 — which catches 60 % of the wrong rows while
 * flagging 60 % of all rows; the engine's own line figure caught 21 % at the
 * same floor. The engine is confidently wrong on digits ("3.0" read as "30"
 * at 93): a cell-level check, not a floor, is the route to those (plan 2.5). */
const OCR_CONFIDENCE_FLOOR = 80;

/** How the lines were made, beyond their confidences. */
export interface ExternalParseOptions {
  /** The lines are a SCANNER's own embedded text (Batch C answer (6), DGS
   * 2026-10-09), read OCR-grade at SCANNER_LAYER_CONFIDENCE: every row flagged
   * and the scan-only repairs on — but the junk-code guard off (review fix
   * 2026-10-10). The guard was measured on our engine's word boxes, where a
   * low confidence means the engine read the line poorly; a scanner's layer
   * carries no confidence at all (0 means "vouched for by nobody"), and on it
   * the guard dropped real rows silently — "Dir Res", "Art", "ee 501", every
   * row of a transcript whose course numbers are decimals ("4190.669"). The
   * DGS's answer asked for those rows editable and flagged, not dropped. */
  scannerLayer?: boolean;
}

export function parseExternalTranscript(lines: string[], confidences?: number[], options: ExternalParseOptions = {}): ExternalParseResult {
  const allText = lines.join('\n');
  if (allText.replace(/\s+/g, '').length < 200) {
    return { hasTextLayer: false, looksLikeNotreDame: false, courses: [] };
  }
  const looksLikeNotreDame = looksLikeNotreDameTranscript(allText);
  // The lines came from the OCR path (each with the engine's confidence):
  // the scan-only repairs of OCR plan step 2.5 apply — never to a text layer.
  const ocrLines = confidences !== undefined;

  const courses: ExternalCourseCandidate[] = [];
  const legend = readLegend(lines);
  // A document with one unambiguously day-first date ("15/02/2023") prints
  // every slashed date day-first (Politecnico di Milano's "12/07/2023" is 12
  // July, not 7 December — 2026-09-26).
  const dayFirstDocument = lines.some((l) => /\b(?:1[3-9]|2\d|3[01])\/\d{1,2}\/(?:19|20)\d{2}\b/.test(l));
  let currentYear: number | undefined;
  let currentSeason: Season | undefined;
  // Course numbers: 2–5 digits, an optional dotted part (Johns Hopkins
  // "601.226"), up to three trailing letters (Buffalo "106LEC", Western
  // "3331A"); or an all-digit id ("30240233").
  // A capital may lead the number — Columbia's "W4111", Drexel's "I699"
  // (DGS 2026-09-20).
  // Widened 2026-09-26 (public keys): six digits (NTHU "542100"), a one- or
  // two-digit dotted part (UC Berkeley Extension "X479.2"), a campus digit after
  // the letter suffix (Toronto "108H1").
  const NUMBER_RE = /^([A-Z]?\d{2,6}(?:\.\d{1,3})?[A-Za-z]{0,3}\d?)\b(.*)$/;
  // Subjects run 2–10 letters: "CS", "COMPSCI", "STATISTC", "ENGLWRIT" (UMass
  // prints 7- and 8-letter subjects, DGS bug report 2026-09-06 — the earlier
  // cap of 6 dropped every such course).
  // The second branch is Johns Hopkins' dotted code, "EN.601.433" — division,
  // department, course (DGS 2026-09-08). Both dots are REQUIRED, so loosening
  // the ordinary separator to a full stop (which would turn "VOL.12" and
  // "MAY.2025" into course codes) is not needed.
  // More shapes from the DGS's 48-transcript set (2026-09-20), each kept as
  // printed: NYU "CSCI-GA.1170" and Indiana "CSCI-P 556" (subject, dash, one
  // or two letters, then dot or space); Wisconsin "COMP SCI 787" and BU "CAS
  // CS 505" (two-word subject); Columbia "COMS W4111" (a capital on the
  // number); CMU "15-513" (digits, dash, digits).
  // More shapes from the public-transcript research (2026-09-26), each gated
  // by the row needing a credit value or a grade after it as before:
  // Toronto "CSC108H1" (a campus digit after the suffix); NTHU "CS 542100"
  // (six digits); UCI "IN4MATX 209" (a digit inside the subject); Berkeley
  // Extension "COMPSCI X479.2" and "EL ENG X404" (a lettered number, dotted
  // section, two-word subject); BITS WILP "SS ZG519" (two letters glued to
  // the number); IISc "E0 251" (letter-digit subject); MIT "6.5840", "6.S898",
  // "6.THG" (department number, dot, subject — a title must follow, so a
  // totals value "12.000" never becomes a course); U Tokyo "4860-1005"; ETH
  // "252-0027-00L"; KU Leuven "H02A5A"; IIIT Hyderabad "CS1.301"; VTU / SRM
  // "18CS51", "18CSC301T" (a scheme year before the letters); UNAM's
  // zero-padded "0001" (any four-digit number outside the year range — a
  // 2000–2049 key is refused as a year, a known limit).
  // F3 (transcript accuracy program, 2026-10-09): a three-token subject with
  // a one-letter middle, "ENG M 612" / "MATH E 101" (the middle letter must
  // be printed as a capital — "Use a 2019 edition" is prose); and Workday's
  // dash after the number, "CS 101 - Title", dropped from the tail so the
  // title's own words and numbers are read as on any other row.
  // Item 14 (DGS 2026-10-11, in order of their effect on the degree check):
  // Seoul National University's "4190.669" and "M1522.001000" (four digits,
  // a dot, three; a letter, four digits, a dot, six — each needing a title,
  // DIGIT_LED_CODE_RE), and McMaster's digit-letter-digit numbers, "COMPSCI
  // 1MD3", "ENGINEER 1P13", "SFWRENG 4G06A/B" (a digit, one or two letters,
  // one or two digits, an optional letter and "/B").
  const LEAD_CODE_RE =
    /^([A-Z]{2,10} \d[A-Z]{1,2}\d{1,2}[A-Z]?(?:\/[A-Z])?|[A-Z]\d{4}\.\d{6}|\d{4}\.\d{3}|(?:[A-Z]{2,10}|[A-Z]{2,4}\d[A-Z]{2,6})[- ]?\d{2,6}(?:\.\d{1,3})?[A-Z]{0,3}\d?|[A-Z]{2,10}-[A-Z]{1,2}[. ]\d{2,5}[A-Z]{0,3}|[A-Z]{2,10} [A-Z]{1,4} \d{2,5}[A-Z]{0,3}|[A-Z]{2,10}(?: [A-Z]{2,4})? [A-Z]{1,2}\d{2,5}(?:\.\d{1,2})?[A-Z]?|[A-Z]\d \d{3,4}|\d{2}-\d{3}|[A-Z]{2,4}\.\d{2,5}\.\d{1,3}[A-Z]{0,3}|[A-Z]{2}\d\.\d{3}|\d{1,2}\.(?:\d{3,4}|[A-Z]{1,3}\d{0,3})[A-Z]?|\d{4}-\d{4}|\d{3}-\d{4}-\d{2}[A-Z]?|[A-Z]\d[A-Z0-9]{3}[A-Z]|\d{2}[A-Z]{2,6}\d{2,4}[A-Z]{0,2}|\d{5,10}|\d{4}|[A-Z]{2,10} \d[A-Z]{0,2}(?=$))\b[.:]?\s*(?:[-–—]\s+)?(.*)$/;
  /** Codes that are digits with a dot or dash, or a four-digit key: taken only
   * when a wordy title follows, so a totals line ("12.000   3.000") or a bare
   * year never starts a row. */
  const DIGIT_LED_CODE_RE = /^(?:\d{1,2}\.|\d{4}$|\d{4}\.\d{3}$|[A-Z]\d{4}\.\d{6}$|\d{4}-\d{4}|\d{3}-\d{4}-\d{2}|[A-Z]\d[A-Z0-9]{3}[A-Z])/;
  // Codes are matched case-insensitively (2026-09-04 — some registrars print
  // "cs 5321"), so common words that would then look like codes are refused:
  // term headers and summary lines such as "Fall 2023  GPA 3.85" — and,
  // since the registrar keys that travel as a transcript's back page were
  // read (2026-09-26), the function words, document-structure words and
  // address words that precede a number in prose ("Since 1998, a scheme…",
  // "Clause 11.", "Suite 200", "Rs. 5000/-"). "OR" (operations research),
  // "ED" (education), "ART" and "LAW" are real subjects and stay allowed, and
  // so are "IN" (TUM's Informatik, UCI's "IN4MATX"), "ON" and "FOR"
  // (forestry) — those are refused only when printed in lowercase or
  // capitalised, the way prose prints them (`proseSubject`).
  const CODE_STOPWORDS_RE =
    /^(JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER|JAN|FEB|MAR|APR|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC|FALL|SPRING|SUMMER|WINTER|AUTUMN|TERM|SEM|SEMESTER|SESSION|QUARTER|YEAR|PAGE|TOTAL|TOTALS|SUBTOTAL|AVERAGE|GPA|CGPA|SGPA|CUM|ROOM|NO|NUM|NUMBER|CODE|TITLE|OVERALL|REGENTS|CUMULATIVE|INSTITUTION|TRANSFER|EARNED|ATTEMPTED|PASSED|CREDIT|CREDITS|HOUR|HOURS|UNIT|UNITS|POINT|POINTS|GRADE|GRADES|COURSE|SECTION|CHAPTER|LEVEL|CLASS|STUDENT|RECORD|GRADUATE|UNDERGRADUATE|ACADEMIC|DEGREE|PROGRAM|PLAN|COLLEGE|SCHOOL|CAMPUS|CATALOG|MAJOR|MINOR|DATE|PRINTED|ISSUED|STANDING|STATUS|VERSION|SINCE|AT|FROM|THAN|THE|AND|OF|TO|BY|WITH|INTO|UPON|PRE|POST|CLAUSE|ARTICLE|RULE|ITEM|STEP|NOTE|TABLE|FIGURE|FIG|ANNEX|APPENDIX|PART|OPEN|GRAND|AVANT|DEPUIS|BEFORE|AFTER|UNTIL|OVER|UNDER|ABOUT|PER|EACH|EVERY|ONLY|SEE|LINE|ROW|REV|PHONE|TEL|FAX|BOX|SUITE|ZIP|MUST|SHALL|ALSO|ABOVE|BELOW|WITHIN|WITHOUT|THROUGH|BETWEEN|DURING|WHEN|WHERE|WHICH|THAT|THIS|THESE|THOSE|THERE|THEIR|THEY|THEN|BOTH|SUCH|SAME|MORE|MOST|LESS|LEAST|LAST|NEXT|FIRST|SECOND|THIRD|FOURTH|FINAL|MAXIMUM|MINIMUM|APPROXIMATELY|AROUND|NEARLY|JUST|EVEN|STILL|YET|NOW|ALWAYS|NEVER|OFTEN|USUALLY|OUT|OFF|OWN|NOT|NON|YES|VIA|ETC|VS|WWW|HTTP|HTTPS|EMAIL|STREET|AVENUE|ROAD|FLOOR|CALL|VISIT|CONTACT|FEE|FEES|COST|USD|EUR|INR|RS|RUPEES|DOLLARS|AMOUNT|PRICE|COPY|COPIES|STUDENTS|CANDIDATES|EXAMPLE|SUPPOSE|UPPOSE|ROM|SECTIONS|PAGES|LINES|ITEMS|FORM|FORMS)$/;
  // "ID" was refused as a code until 2026-09-08 (it reads as "identifier"),
  // which dropped every Georgia Tech industrial-design course. It is a real
  // subject, so only the shape that is genuinely an identifier is refused: a
  // record number with no course title after it. A student id is long enough
  // that the code pattern (2-5 digits) does not match it anyway.
  const BARE_IDENTIFIER_RE = /^ID$/;
  /** Function words a subject cell can only be in prose when not set in
   * capitals: "in 2009", "For Y22", "on 24" (2026-09-26). */
  const PROSE_SUBJECT_RE = /^(?:in|on|for|as|or|an|if|is|it|no|so|up|we|he|do|be|my|us|at|to|by|of|the|and|than|since|from|with)$/i;
  const proseSubject = (original: string): boolean => PROSE_SUBJECT_RE.test(original) && original !== original.toUpperCase();
  const looksLikeIdentifierLine = (subject: string, tokens: string[]): boolean =>
    BARE_IDENTIFIER_RE.test(subject) && !tokens.some((tk) => /[A-Za-z]{3}/.test(tk));
  // A subject cell: "CS", "COMPSCI", "STATISTC", or a two-part code with a
  // space ("E E", "A A" at the University of Washington, 2026-09-05 — since
  // 2026-09-20 joinSpacedSubject turns those into "EE", "AA" first, so the
  // second alternative is now the multi-letter case such as "MATH SCI").
  const SUBJECT_RE = /^[A-Za-z]{2,10}$|^[A-Za-z]{1,4} [A-Za-z]{1,4}$|^[A-Za-z]{2,4}\d[A-Za-z]{2,6}$|^[A-Za-z]\d$/;
  // Subject cells with a column artefact (DGS 2026-09-20): RIT prints "CSCI-"
  // (the dash belongs to the code, "CSCI-603", split at the column); Clemson
  // prints a cross-listing, "CPSC (ECE)"; Rutgers' subject is numeric with
  // colons, "16:198:" (its code is "16:198:507", no space).
  const SUBJECT_TRAILING_DASH_RE = /-$/;
  const CROSS_LISTED_SUBJECT_RE = /\s*\([A-Za-z]{2,10}\)$/;
  const COLON_SUBJECT_RE = /^\d{1,2}:\d{3}:$/;
  /** Course subjects are printed in capitals (DGS, 2026-09-06). A short
   * subject may still be lowercase ("cs 5321", 2026-09-04), but a word of
   * seven letters or more counts as a subject only when it IS all capitals —
   * "Chapter 3" and "Building 12" are prose, "COMPSCI 501" is a course. */
  const subjectCase = (original: string): boolean => {
    const letters = original.replace(/[^A-Za-z]/g, '');
    return letters.length <= 6 || letters === letters.toUpperCase();
  };

  /** Scan the tokens after the course code: leading wordy tokens form the
   * title, then credits, a letter/coded grade — or (2026-09-04) a NUMERIC
   * grade (85, 9.5 — common outside the US), kept as rawGrade for the student
   * to map. A later unambiguous letter grade replaces a numeric guess. When
   * the title comes AFTER the numbers ("CSCI-549   B   4.0   Title", USC,
   * 2026-09-05) the wordy tail becomes the title. */
  const scanTokens = (rawTokens: string[], into: RowScan): void => {
    const tokens = joinGradePhrases(rawTokens);
    let titleDone = into.titleParts.length > 0 && (into.credits !== undefined || into.grade !== undefined || into.rawGrade !== undefined);
    const tail: string[] = [];
    let sawEcho = false;
    for (let k = 0; k < tokens.length; k++) {
      const token = tokens[k]!;
      const nextToken = tokens[k + 1];
      if (/^[*#@]$/.test(token) && (titleDone || into.titleParts.length > 0)) continue; // a repeat / exclusion mark beside a value or a title ("&" stays a title connector)
      // A single letter right after the code (2026-09-05): Georgia Tech's
      // "H" column flag before the title ("CS 8946   B Title …") is dropped
      // when a wordy title follows it; a grade before the credits
      // ("CSCI-549   B   4.0   Title", USC) is read as the grade.
      if (k === 0 && into.titleParts.length === 0 && /^[A-Z]$/.test(token) && nextToken !== undefined) {
        if (/[\p{L}]{2}/u.test(nextToken) && asCredits(nextToken) === undefined) continue;
      }
      // A bare integer followed by a decimal credit value is part of the
      // title ("College Calculus 1   4.000   4.000   D", 2026-09-05).
      // Narrowed 2026-09-26: a small integer (Calculus 1, Part 2) before a
      // one- or two-decimal value; a larger one ("Master Thesis 15   8.7") is
      // the credits and the decimal a grade. Banner's three-decimal credits
      // ("College Calculus 1   4.000") keep the wider rule.
      // F1c (transcript accuracy program, 2026-10-09): a row that ENDS in a
      // one- or two-decimal value with no grade after it ("Calculus 2   3.0")
      // keeps the integer in the title only where the row is known to print
      // no grade — inside an in-progress block, or under a header that mapped
      // no grade or mark column. Anywhere else "Master Thesis 15   8.7" is
      // credits and a grade, and no bound on the integer alone decides it.
      const gradelessRow = inProgressBlock || (columnKinds !== undefined && !columnKinds.includes('grade') && !columnKinds.includes('mark'));
      const integerInTitle =
        !titleDone &&
        /^\d{1,2}$/.test(token) &&
        nextToken !== undefined &&
        asCredits(nextToken) !== undefined &&
        (/^\d{1,2}[.,]\d{3}$/.test(nextToken) ||
          (/^\d{1,2}[.,]\d{1,2}$/.test(nextToken) && Number(token) <= 3 && tokens[k + 2] !== undefined && mapGrade(tokens[k + 2]!, legend) !== undefined) ||
          (/^\d{1,2}[.,]\d{1,2}$/.test(nextToken) && tokens[k + 2] === undefined && gradelessRow));
      // A lone lowercase letter between title words is a word of the title
      // ("Introducción a la Programación", "Álgebra y Geometría" — 2026-09-26),
      // never the grade A that its capital would be.
      if (!titleDone && into.titleParts.length > 0 && /^[a-zà-ÿ]$/.test(token)) {
        into.titleParts.push(token);
        continue;
      }
      if (integerInTitle && into.titleParts.length > 0) {
        into.titleParts.push(token);
        continue;
      }
      // "Calculus 1   3   A-" (McGill, NTU — 2026-09-26): a one-digit integer
      // after title words, then INTEGER credits, then a grade-like token — the
      // digit is the title's.
      const integerBeforeIntegerCredits =
        !titleDone &&
        into.titleParts.length > 0 &&
        /^\d$/.test(token) &&
        nextToken !== undefined &&
        /^\d{1,2}$/.test(nextToken) &&
        asCredits(nextToken) !== undefined &&
        tokens[k + 2] !== undefined &&
        (mapGrade(tokens[k + 2]!, legend) !== undefined || /^[A-Z][A-Z+\-/0-9.]{0,3}\*?$/.test(tokens[k + 2]!) || /^\d{1,3}(?:[.,]\d{1,2})?$/.test(tokens[k + 2]!));
      if (integerBeforeIntegerCredits) {
        into.titleParts.push(token);
        continue;
      }
      const prevWord = into.titleParts[into.titleParts.length - 1];
      // "Calculus 1 for Science and Engineering   4.0   A-" (Northeastern,
      // 2026-09-20): a small integer between title words is a title word —
      // the next token is a wordy one that is no grade token.
      const integerBetweenWords =
        !titleDone &&
        prevWord !== undefined &&
        /^\d{1,2}$/.test(token) &&
        nextToken !== undefined &&
        /^[\p{L}]{3,}/u.test(nextToken) &&
        mapGrade(nextToken, legend) === undefined &&
        !/^[A-Z]{1,4}$/.test(nextToken);
      // "Lab for CS 2000   1.0   A" (Northeastern, 2026-09-20): a number that
      // with the capitalised word before it forms a course code stays in the
      // title, and the row's year is never read from it.
      const codeInTitle = !titleDone && prevWord !== undefined && /^[A-Z]{2,10}$/.test(prevWord) && /^\d{3,5}[A-Z]{0,2}$/.test(token) && asCredits(token) === undefined;
      // "Introduction to Programming, Part A   2.0   B+" (Lehigh, 2026-09-20):
      // a single letter after title words is a title word when the credits
      // AND a grade still follow it.
      const letterInTitle =
        !titleDone &&
        prevWord !== undefined &&
        /^[A-F]$/.test(token) &&
        nextToken !== undefined &&
        asCredits(nextToken) !== undefined &&
        tokens[k + 2] !== undefined &&
        mapGrade(tokens[k + 2]!, legend) !== undefined;
      if (integerBetweenWords || codeInTitle || letterInTitle) {
        into.titleParts.push(token);
        continue;
      }
      const asCr = asCredits(token);
      // "(P)" / "(F)" — Villanova prints pass/fail results in parentheses
      // (public keys, 2026-09-26); the letters inside are the token.
      const bareToken = /^\([A-Za-z]{1,2}[+-]?\)$/.test(token) ? token.slice(1, -1) : token;
      const creditsFollow = nextToken !== undefined && asCredits(nextToken) !== undefined;
      const asGr = mapGrade(bareToken, legend, titleDone || into.credits !== undefined || creditsFollow);
      const gradeFirst =
        into.titleParts.length === 0 && into.grade === undefined && asGr !== undefined && nextToken !== undefined && asCredits(nextToken) !== undefined;
      if (gradeFirst) {
        into.grade = asGr;
        into.gradeText = token;
        titleDone = true;
        continue;
      }
      // Grade-shaped: a short capitalised token the app cannot map ("W", "T",
      // "ABS", "AA"), kept as printed for the student. Since 2026-09-26 also
      // with one trailing star (BU "P*", Penn "I*", IIT Kanpur "A*"), a zero
      // prefix (Binghamton's excluded first attempt "0F"), a fraction mark,
      // the Italian 30 with honours, a grade word or a CJK grade character.
      const upper = bareToken.toUpperCase();
      const gradeShaped =
        asGr === undefined &&
        // Printed in capitals, as grades are ("to" in a title's tail is not one).
        ((/^[A-Z][A-Z+\-/0-9.]{0,3}\*?$/.test(upper) && bareToken === upper && bareToken.length <= 5) ||
          /^0[A-F][+-]?$/.test(upper) ||
          bareToken === 'Fx' || // KTH's fail-with-resit
          FRACTION_MARK_RE.test(bareToken) ||
          LODE_RE.test(bareToken) ||
          (titleDone && GRADE_WORD_RE.test(bareToken)) ||
          (titleDone && CJK_GRADE_RE.test(bareToken)));
      const numericGrade =
        asGr === undefined && /^\d{1,3}(?:[.,]\d{1,2})?$/.test(token) && Number(token.replace(',', '.')) <= 100;
      // A title token is wordy — or a bare connector ("&", "/", "-", ":")
      // between wordy tokens ("Econ & Priv Issues in Big Data", 2026-09-05).
      const wordy = /[\p{L}]/u.test(token) && !/^\(?\d/.test(token) && !FRACTION_MARK_RE.test(token) && !LODE_RE.test(token);
      const connector = into.titleParts.length > 0 && /^[&/+:\-–—]$/.test(token);
      if (!titleDone && asCr === undefined && asGr === undefined && (connector || wordy)) {
        into.titleParts.push(token);
        continue;
      }
      titleDone = true;
      if (into.credits === undefined && asCr !== undefined) {
        into.credits = asCr;
        into.creditsText = token;
        continue;
      }
      if (asGr !== undefined && into.grade === undefined) {
        // A letter grade beats a numeric guess ("3.00   3.00   A"); a pass/fail
        // token does not (Sydney "66   CR": the mark is the grade, CR its
        // band — 2026-09-26), and neither beats a grade-shaped token already
        // read.
        const passFail = isPassFailToken(bareToken, legend);
        if (into.rawGrade === undefined || !passFail) {
          into.grade = asGr;
          into.gradeText = token;
          into.rawGrade = undefined;
        }
        continue;
      }
      if (into.grade === undefined && into.titleParts.length > 0) {
        // The Earned column repeats the credits ("3.00   3.00   A   12.00",
        // 2026-09-05) — but only in the credits' own printed format with
        // another token after it: a lone "3.0" after credits of "3", or the
        // last number of the row, is a grade on the 4.0 scale (Michigan
        // State, Washington) or the Danish 7-step scale (DTU) — 2026-09-26.
        const value = Number(token.replace(',', '.'));
        const sameFormat = into.creditsText !== undefined && decimalsOf(token) === decimalsOf(into.creditsText);
        const echoesCredits = into.credits !== undefined && value === into.credits && sameFormat && nextToken !== undefined;
        // "3.00   0.00   W" (PeopleSoft, a failed / withdrawn / in-progress
        // row): zero earned right after the credits is that column, never a
        // grade, when a grade-like token still follows (2026-09-26).
        const zeroEarned =
          value === 0 && tokens[k - 1] === into.creditsText && tokens.slice(k + 1).some((t) => mapGrade(t, legend) !== undefined || /^[A-Z][A-Z+\-/0-9.]{0,3}\*?$/.test(t));
        // The header in force is the evidence, as in scanWithMap (review
        // 2026-10-09): a document-wide flag let a Points column mapped pages
        // earlier drop a mark under a later header that mapped none.
        const pointsMapped = columnKinds !== undefined && columnKinds.indexOf('points') > columnKinds.indexOf('title');
        const pointsCell = pointsMapped && nextToken === undefined && into.credits !== undefined && /^\d{1,3}[.,]\d{2}$/.test(token);
        if (echoesCredits || zeroEarned) sawEcho = true;
        // A grade-shaped token replaces a numeric guess only when that guess
        // looks like a points value ("12.00   W"); a printed MARK keeps its
        // number and the band beside it is dropped (Sydney "78   DI", 2026-09-26).
        else if (gradeShaped && (into.rawGrade === undefined || decimalsOf(into.rawGrade) >= 2)) {
          into.rawGrade = /^W\d$/.test(bareToken) ? 'W' : bareToken;
          into.gradeText = token;
        }
        // F1b (transcript accuracy program, 2026-10-09): a gradeless row's
        // trailing two-decimal number after the credits ("3.00   12.00") is
        // its quality points only when the table header IN FORCE mapped a
        // Points column after the title (the row fell through the map), or in
        // the credits/earned/points triple (sawEcho). Without that evidence
        // the number stays the printed grade: "4   16.0" is a mark out of 20
        // as often as it is points, and the product test would be a guess.
        else if (into.rawGrade === undefined && numericGrade && !sawEcho && !pointsCell) {
          into.rawGrade = token; // after "earned" comes "points"
          into.gradeText = token;
        }
      }
      if (wordy && !gradeShaped && token.length > 1) tail.push(token);
    }
    if (into.titleParts.length === 0 && tail.length > 0 && (into.credits !== undefined || into.grade !== undefined)) {
      into.titleParts = tail;
    }
  };

  /** The column order of the course table being read, from its header line
   * (readColumnHeader, 2026-09-26). Kept until the next header; the tables of
   * one transcript share a layout, and a legend page that looks like a header
   * is harmless (no course rows follow it).
   * Only the columns AFTER the title are matched against a row's tail; the
   * cells before the code (a serial number, a date) are leadCode's business,
   * and a level or flag cell between the code and the title is consumed
   * first. */
  let columnKinds: ColumnKind[] | undefined;
  /** What the grade column of the header in force has held so far: rows whose
   * mapped grade was a letter (or any non-number) and rows whose was a number
   * — the evidence `integerGradeInLetteredTable` reads (2026-10-09). Reset
   * with every new header. */
  let headerGrades = { letters: 0, numbers: 0 };
  const numericToken = (t: string) => /^-?\d{1,3}(?:[.,]\d{1,3})?$/.test(t);
  const gradeLike = (t: string): boolean => {
    const bare = /^\([A-Za-z]{1,2}[+-]?\)$/.test(t) ? t.slice(1, -1) : t;
    // A Roman numeral above I ends a title ("Physics for Engineering Students
    // II") and is no registrar's grade (F6 review, 2026-10-09); "I" alone
    // stays an Incomplete.
    if (/^(?:II|III|IV)$/.test(bare)) return false;
    if (mapGrade(bare, legend) !== undefined) return true;
    const upper = bare.toUpperCase();
    // A pass or fail word is grade-shaped even where the legend makes it a
    // band left raw (Cairo's "Pass 60-64%" — CC15, Batch C 2026-10-09).
    if (legend.passFailBands && /^(?:PASS|FAIL)$/.test(upper)) return true;
    if (/^[A-Z][A-Z+\-/0-9.]{0,3}\*?$/.test(upper) && bare === upper && bare.length <= 5) return true;
    if (/^0[A-F][+-]?$/.test(upper) || FRACTION_MARK_RE.test(bare) || LODE_RE.test(bare) || GRADE_WORD_RE.test(bare) || CJK_GRADE_RE.test(bare) || bare === 'Fx' || /^(?:Ab|Abs|Absent)$/i.test(bare)) return true;
    return numericToken(bare) && Number(bare.replace(',', '.')) <= 100;
  };
  /** A line whose tail is a row's numbers (F1a, 2026-10-09): its last tokens
   * are the credits, then a grade token — with, optionally, the Earned echo
   * between them and one points number or a repeat mark after. Nothing wordy
   * follows the credits but the grade itself, so "carry 3 credits and are
   * graded A" is not such a tail while "… Design   3   A" is. Returns that
   * grade token (the row's grade must be read from IT, review 2026-10-09),
   * or undefined when the line has no such tail. */
  const tailGradeToken = (rawTokens: string[]): string | undefined => {
    const tokens = joinGradePhrases(rawTokens).filter((t) => !/^[*#@]$/.test(t));
    let at = tokens.length - 1;
    // Points after the grade ("3   A   12.00"): one trailing number more.
    if (at >= 2 && numericToken(tokens[at]!) && !numericToken(tokens[at - 1]!)) at -= 1;
    const grade = tokens[at];
    if (at < 1 || grade === undefined || !gradeLike(grade)) return undefined;
    return asCredits(tokens[at - 1]!) !== undefined ? grade : undefined;
  };
  /** Does token `t` belong in a column of kind `kind`? `header` is the word
   * the header printed over that column (F6 review, 2026-10-09), for the
   * kind whose cell shape depends on it: a bare number is a term cell only
   * under a term-numbering word. */
  const fits = (kind: ColumnKind, t: string, header?: string): boolean => {
    if (PLACEHOLDER_TOKEN_RE.test(t)) return true; // an empty cell printed as "-"
    switch (kind) {
      case 'credits':
      case 'ects':
        return asCreditsWide(t) !== undefined;
      case 'attempted':
      case 'earned':
      case 'points':
      case 'duration':
        return numericToken(t);
      case 'workload':
        // …or IIT's lecture-tutorial-practical hours, "3-1-0" (F6, 2026-10-09).
        return numericToken(t) || /^\d{1,2}-\d{1,2}-\d{1,2}$/.test(t);
      case 'stat':
        // A class statistic: a number, a grade, a placeholder ("XXX" where no
        // average is computed), a parenthesised class size (F6, 2026-10-09).
        return numericToken(t) || gradeLike(t) || /^X+$/i.test(t) || /^\(\d+\)$/.test(t) || /^\d{1,3}(?:[.,]\d+)?%$/.test(t);
      case 'mark':
        return numericToken(t) || /^\d{1,3}(?:[.,]\d{1,2})?\/\d{1,3}$/.test(t) || /^[A-Z]{1,3}$/.test(t) || /^\d{1,3}(?:[.,]\d+)?%$/.test(t);
      case 'grade':
        return gradeLike(t);
      case 'level':
        return /^(?:UG|UGRD|GR|GRAD|U|G|L|V|M|[4-8]|undergraduate|graduate|postgraduate|masters?|doctoral)$/i.test(t);
      case 'term':
        // …or a compact / six-digit term code ("2023FA", "202310" — F2, 2026-10-09).
        // …or an ISO date (Ladok's "Date" column, F6 2026-10-09).
        // …or a bare one- or two-digit term number, only under a header word
        // that numbers terms (TERM_NUMBER_HEADER_RE — F6 review, 2026-10-09:
        // "TM", "Semester", "Year", "Session"): the cell is consumed, so the
        // row's title and credits read right, and its MEANING is read only
        // under McMaster's "TM" (rowTermOf); a semester number or a year of
        // study whose calendar the document does not give leaves the row with
        // its header's term. Under a date word a bare number is nothing.
        return (
          /^(?:\d{4}(?:-\d)?|[A-Z]\d{2}|S1S2|A1A2|S[12]|A[12]|(?:fall|spring|summer|autumn|winter)\w*|\d{1,2}[-/.]\w{2,3}[-/.]\d{2,4}|\d{4}-\d{2}-\d{2})$/i.test(t) ||
          TERM_CODE_CELL_RE.test(t) ||
          (header !== undefined && TERM_NUMBER_HEADER_RE.test(header.replace(/\s*\(.*\)\s*$/, '')) && /^\d{1,2}$/.test(t))
        );
      case 'flag':
        // A short mark ("R", "H", "*", "ORD") or a course-type word — never a
        // word that could be part of the title ("IT Risk Management").
        // …or an attempt number, a percentage attendance, a status word.
        return (
          /^[A-Z][A-Z0-9*#&+-]{0,3}$/.test(t) ||
          /^[*#&+-]$/.test(t) ||
          /^\d$/.test(t) ||
          /^\d{1,3}(?:[.,]\d+)?%$/.test(t) ||
          mapGrade(t, legend) !== undefined ||
          /^(?:compulsory|elective|core|lab|theory|practical|honou?rs|regular|repeat|optional|major|minor|general|open|basic|advanced|obligatorio|optativo|opcional|obrigat[oó]ria|optativa|pflicht|wahl|ord|ext|ex|course|matriculado|trancado|cursando|aprovad[oa]|reprovad[oa])$/i.test(t)
        );
      default:
        return false;
    }
  };
  /** Match a row's tokens against the header's columns: the longest title
   * whose remaining tokens all land in a column, preferring the fewest empty
   * columns. Fills `into` and returns the level cell, or undefined when the
   * layout does not fit (the position-free scan then runs as before). */
  const scanWithMap = (rawTokens: string[], into: RowScan): { level?: Level; year?: number; season?: Season } | undefined => {
    if (!columnKinds) return undefined;
    const tokens = joinGradePhrases(rawTokens);
    const titleAt = columnKinds.indexOf('title');
    const codeAt = columnKinds.indexOf('code');
    // Only a level cell may sit between the code and the title (Banner
    // Self-Service); a header with no code column has nothing before the title.
    const pre = codeAt >= 0 ? columnKinds.slice(codeAt + 1, titleAt).filter((k) => k === 'level') : [];
    const post = columnKinds.slice(titleAt + 1).filter((k) => k !== 'code' && k !== 'serial');
    if (post.length === 0) return undefined;
    // The header word over each of those columns (lastHeaderCells is set
    // beside columnKinds, cell for kind), for the fits that depend on it.
    const postCells = lastHeaderCells.slice(titleAt + 1).filter((_, i) => columnKinds![titleAt + 1 + i] !== 'code' && columnKinds![titleAt + 1 + i] !== 'serial');
    // Cells between the code and the title (Banner Self-Service's Level).
    let start = 0;
    const preValues: Partial<Record<ColumnKind, string>> = {};
    for (const kind of pre) {
      const t = tokens[start];
      if (t !== undefined && fits(kind, t) && !/^[\p{L}]{3,}/u.test(t)) {
        preValues[kind] = t;
        start += 1;
      }
    }
    let best: { s: number; values: (string | undefined)[]; blanks: number } | undefined;
    for (let s = tokens.length - 1; s >= start; s--) {
      const tail = tokens.slice(s);
      const values: (string | undefined)[] = [];
      let i = 0;
      let blanks = 0;
      for (let c = 0; c < post.length; c++) {
        const kind = post[c]!;
        // A repeat / exclusion mark beside a value ("C- #", "A *") belongs to
        // no column; step over it.
        while (tail[i] !== undefined && /^[*#@]$/.test(tail[i]!)) i += 1;
        const t = tail[i];
        // A numeric token that would be the grade is the points cell when it
        // is the row's last token and a points column follows (a gradeless
        // row: "3.00   3.00   12.00").
        const lastNumeric = kind === 'grade' && t !== undefined && numericToken(t) && i === tail.length - 1 && post.slice(post.indexOf(kind) + 1).includes('points');
        // The grade column is empty when every token left has a numeric
        // column of its own after it (F6, 2026-10-09 — Workday prints the
        // grade FIRST, "Grade   Units   Earned   Grade Points", and an
        // in-progress row "3.00   0.00   0.00" put its units in the grade).
        // Exactly as many tokens as numeric columns: "3.5   3.00" under
        // "Grade   Units" keeps its numeric grade.
        const numericAfter = post.slice(c + 1).filter((k) => k === 'credits' || k === 'attempted' || k === 'earned' || k === 'points' || k === 'ects' || k === 'mark' || k === 'workload' || k === 'stat').length;
        // …and so it is when a term column follows and the row's last token is
        // its term (Colleague's "Grade   Credits   Term": an ungraded current
        // row "Graduate Project   3.00   2026FA" put its credits in the grade
        // — item 14, 2026-10-11).
        const termAfter = post.slice(c + 1).filter((k) => k === 'term').length;
        const numericFillsRest =
          kind === 'grade' &&
          t !== undefined &&
          numericToken(t) &&
          numericAfter > 0 &&
          (tail.length - i === numericAfter || (termAfter > 0 && tail.length - i === numericAfter + termAfter && fits('term', tail[tail.length - 1]!)));
        // A letter token under a MARK column, with a grade column still to
        // come, is that column's (Toronto "0.50   SDF": the mark is blank).
        const gradeFollows = kind === 'mark' && t !== undefined && /^[A-Za-z]/.test(t) && post.slice(post.indexOf(kind) + 1).includes('grade');
        if (t !== undefined && fits(kind, t, postCells[c]) && !lastNumeric && !numericFillsRest && !gradeFollows) {
          values.push(PLACEHOLDER_TOKEN_RE.test(t) ? undefined : t);
          i += 1;
          // "1 semester", "2 years" — the duration's unit word goes with it.
          if (kind === 'duration' && tail[i] !== undefined && /^(?:semesters?|years?|terms?|weeks?|months?|quarters?)$/i.test(tail[i]!)) i += 1;
          // McMaster's MEDIAN prints the class size after the median grade,
          // "B+ (242)" — the count goes with the statistic (F6, 2026-10-09).
          if (kind === 'stat' && tail[i] !== undefined && /^\(\d+\)$/.test(tail[i]!)) i += 1;
          // Ladok prints the unit after the value, "7.5 hp" (higher-education
          // credits); the unit word goes with its credits (F6, 2026-10-09).
          // Only that unit: "CR" after the earned units is the grade Credit
          // (Marquette, Utah), never a unit word.
          if ((kind === 'credits' || kind === 'ects' || kind === 'attempted' || kind === 'earned') && tail[i] !== undefined && /^hp$/i.test(tail[i]!)) i += 1;
        } else {
          values.push(undefined);
          blanks += 1;
        }
      }
      // Every token must land in a column — except a trailing one-letter flag
      // the header does not name (WashU's repeat "R" after the grade).
      const leftover = tail.slice(i);
      // …or the rest of a two-word type cell ("Core Course") when the last
      // column is such a cell.
      const restOfFlag = post[post.length - 1] === 'flag' && leftover.every((t) => /^[\p{L}]+$/u.test(t));
      if (!restOfFlag && (leftover.length > 1 || (leftover.length === 1 && !/^[A-Z*#&@]$/.test(leftover[0]!)))) continue;
      // A status row prints no mark ("CLASS 5   1   ABN *", the ANU sample,
      // 2026-09-26): reading the title's trailing number as the credits and
      // the credits as a one-digit mark beside an unmapped status fills every
      // column, so that fit costs one blank too — and the longer title wins
      // the tie, as it does everywhere else.
      const markAt = post.lastIndexOf('mark');
      const gradeAt = post.indexOf('grade');
      // Only where the mark column FOLLOWS the credits column (units, mark,
      // grade): with the marks before the credits (JNTU "… Lab   0   1.5   Ab")
      // a one-digit mark is the absent student's zero.
      const creditsAt = post.findIndex((k) => k === 'credits' || k === 'attempted' || k === 'earned' || k === 'ects');
      const oneDigitMark = markAt >= 0 && gradeAt >= 0 && creditsAt >= 0 && creditsAt < markAt && values[markAt] !== undefined && /^\d$/.test(values[markAt]!) && values[gradeAt] !== undefined && !numericToken(values[gradeAt]!) && mapGrade(values[gradeAt]!, legend) === undefined;
      // A registered row under a lettered grade column (F1c under a mapped
      // header, 2026-10-09 — Minerva's "RW   ECSE 210   001 Electric Circuits
      // 2   3"): where every row read so far under this header printed a
      // LETTER in the grade column, a bare one-digit integer that ends the
      // row is not its grade — the fit that keeps the digit in the title and
      // reads the last number as the credits wins. Two blanks' worth, so it
      // outweighs the one blank the longer title costs.
      const integerGradeInLetteredTable = gradeAt >= 0 && values[gradeAt] !== undefined && /^\d$/.test(values[gradeAt]!) && headerGrades.letters > 0 && headerGrades.numbers === 0 && tail.length === 2 && /^\d{1,2}$/.test(tail[0]!);
      // A class statistic is printed only beside the row's own cells: a fit
      // that fills a stat column while the credits column stays empty has
      // put the credits in the statistic ("Physics for Engineering Students
      // II   0.50   WDN" read II as the grade and 0.50 as the class average —
      // F6 review, 2026-10-09) and costs one more.
      const statWithoutCredits = creditsAt >= 0 && values[creditsAt] === undefined && post.some((k, i) => k === 'stat' && values[i] !== undefined);
      // "Calculus 1   3   A-   3   B" (Minerva, F6 review 2026-10-09): the
      // position-free scan's 2026-09-26 rule — a small integer after title
      // words, then integer credits, then a grade-like token: the integer is
      // the title's — holds under a header too. A fit that reads the integer
      // as the credits, the credits as a NUMERIC grade and leaves a grade-
      // shaped token of two or more characters ("A-", "WF"; a one-letter
      // repeat flag "R" does not count) in a later column costs three, so the
      // fit with that token as the grade wins even when it leaves more
      // columns empty.
      // Only that shape: the misread "grade" is a bare integer (the real
      // credits) and the token after it is letters only — DTU's "5   10   E23"
      // (grade 10, exam period E23) and TUM's "8   1,7   bestanden" are read
      // as printed.
      const letterAfterNumericGrade =
        creditsAt >= 0 && gradeAt >= 0 && values[creditsAt] !== undefined && /^\d{1,2}$/.test(values[creditsAt]!) && values[gradeAt] !== undefined && /^\d{1,2}$/.test(values[gradeAt]!) && values.slice(gradeAt + 1).some((v) => v !== undefined && /^[A-Z]{1,3}[+-]?$/.test(v) && (v.length >= 2 || mapGrade(v, legend) !== undefined));
      const cost = blanks + (oneDigitMark ? 1 : 0) + (integerGradeInLetteredTable ? 2 : 0) + (statWithoutCredits ? 1 : 0) + (letterAfterNumericGrade ? 3 : 0);
      if (best === undefined || cost < best.blanks) best = { s, values, blanks: cost };
    }
    if (!best) return undefined;
    // A header that names fewer columns than the rows print (a term block
    // whose header dropped CREDITS while its rows still carry "3.0") would
    // leave the credits inside the title: hand such a row to the
    // position-free scan instead.
    const title = tokens.slice(start, best.s);
    const creditsFound = post.some((k, i) => (k === 'credits' || k === 'ects' || k === 'attempted' || k === 'earned') && best!.values[i] !== undefined);
    if (!creditsFound && (title.some((t) => /^\d{1,2}[.,]\d{1,3}$/.test(t)) || (title.length > 1 && /^\d{1,2}$/.test(title[title.length - 1]!)))) return undefined;
    return readMappedValues(post, postCells, best.values, title, preValues, into);
  };
  /** One row's values, matched to the header's columns after the title (by
   * scanWithMap's fit, or cell for cell by the code-less reader — CC15,
   * Batch C 2026-10-09), read into `into`: the credits, the grade (or the
   * mark), the row's term cell, its level cell. Undefined when the row has
   * neither a credit value nor a grade. */
  const readMappedValues = (
    post: ColumnKind[],
    postCells: string[],
    values: (string | undefined)[],
    title: string[],
    preValues: Partial<Record<ColumnKind, string>>,
    into: RowScan,
  ): { level?: Level; year?: number; season?: Season } | undefined => {
    const value = (kind: ColumnKind, nth = 0): string | undefined => {
      let seen = 0;
      for (let i = 0; i < post.length; i++) if (post[i] === kind) { if (seen === nth) return values[i]; seen += 1; }
      return undefined;
    };
    const creditsValues = post.map((k, i) => (k === 'credits' ? values[i] : undefined)).filter((t): t is string => t !== undefined);
    // The local credits first; ECTS only where nothing else is printed (METU
    // "Credit   Grade   ECTS"). Two credits cells are summed only when they are
    // the theoretical and practical hours (Sharif "3   0").
    const theoryPractical = lastHeaderCells.filter((c) => /^(?:theoretical|practical|créditos\s+(?:aula|trabalho))$/i.test(c.replace(/\s*\(.*\)\s*$/, ''))).length >= 2;
    const creditsToken =
      theoryPractical && creditsValues.length > 1 && creditsValues.every((t) => asCreditsWide(t) !== undefined)
        ? String(creditsValues.reduce((sum, t) => sum + (asCreditsWide(t) ?? 0), 0))
        : (value('credits') ?? value('attempted') ?? value('earned') ?? value('ects'));
    const lastMark = post.includes('mark') ? value('mark', post.filter((k) => k === 'mark').length - 1) : undefined;
    let gradeToken = value('grade') ?? (post.includes('grade') ? undefined : lastMark);
    // A pass/fail result or an unmapped band beside a printed mark ("93   P",
    // "66   CR", "78   DI"): the mark is the grade, the band derives from it
    // (GT05, 2026-09-26). A letter grade the app knows (HUST "8.7   B+") wins.
    let band: string | undefined;
    // …except under a "Full Mark" / "Max Marks" column (CC15, Batch C
    // 2026-10-09 — Cairo's "Subject   Full Mark   Marks Obtained   Grade"):
    // the mark is out of a maximum that differs row by row (128 of 150, 64 of
    // 100), on no scale of its own, and the grade column's word is the result.
    const perRowMaximum = postCells.some((c) => /^(?:full|max(?:imum)?\.?)\s+marks?$/i.test(c.replace(/\s*\(.*\)\s*$/, '')));
    if (!perRowMaximum && gradeToken !== undefined && lastMark !== undefined && numericToken(lastMark) && Number(lastMark.replace(',', '.')) > 0 && (isPassFailToken(gradeToken, legend) || mapGrade(gradeToken, legend) === undefined)) {
      // The band stays beside the mark in what the student is shown ("62 CR",
      // "77 D" — the ANU sample, 2026-09-26): the mark alone reads as a
      // grade on an unknown scale.
      if (gradeToken !== lastMark && /^[A-Za-z][A-Za-z+-]{0,3}$/.test(gradeToken)) band = gradeToken;
      gradeToken = lastMark;
    }
    if (creditsToken === undefined && gradeToken === undefined) return undefined;
    // A term cell on the row (U Tokyo "2022   S1S2", DTU "E23", UNAM "2019-1",
    // a result date) — read after the values are known.
    // A bare term NUMBER is read only under McMaster's "TM" (F6 review,
    // 2026-10-09): under "Semester", "Year" or "Session" the cell was consumed
    // (fits) but says nothing the parser can place, so it is not handed on.
    const termCells = post.flatMap((k, i) => (k === 'term' && values[i] !== undefined ? [{ value: values[i]!, ordinal: /^tm$/i.test((postCells[i] ?? '').replace(/\s*\(.*\)\s*$/, '')) }] : []));
    const rowTerm = rowTermOf(
      termCells.filter((c) => c.ordinal || !/^\d{1,2}$/.test(c.value)).map((c) => c.value),
      termCells.some((c) => c.ordinal),
    );
    into.titleParts = title.filter((t) => !/^[*#@]$/.test(t));
    // "CH" is the credit hours (HEC: 1–4, the narrow asCredits range): a
    // value above 30 under it — a carga horária of 45 whose header gave no
    // language evidence — is consumed by position but not read as a credit
    // count (F6 review, 2026-10-09); the row keeps its title and grade and
    // its credits stay blank for the student, never 45.
    const creditHoursHeader = post.some((k, i) => k === 'credits' && values[i] !== undefined && /^ch$/i.test((postCells[i] ?? '').replace(/\s*\(.*\)\s*$/, '')));
    if (creditsToken !== undefined) {
      into.credits = creditHoursHeader && asCredits(creditsToken) === undefined ? undefined : asCreditsWide(creditsToken);
      into.creditsText = creditsToken;
    }
    if (gradeToken !== undefined) {
      // The cell the grade was read from — the OCR numeric correction asks
      // whether it was a corrected token (Batch C answer (4), 2026-10-09).
      into.gradeText = gradeToken;
      if (numericToken(gradeToken)) headerGrades.numbers += 1;
      else headerGrades.letters += 1;
      const bare = /^\([A-Za-z]{1,2}[+-]?\)$/.test(gradeToken) ? gradeToken.slice(1, -1) : gradeToken;
      const mapped = mapGrade(bare, legend);
      if (mapped !== undefined) into.grade = mapped;
      else into.rawGrade = /^W\d$/.test(bare) ? 'W' : band === undefined ? bare : `${bare} ${band}`;
    }
    // A status word beside a one-letter grade decides it (TUM "B   bestanden":
    // B is bestanden, a pass, not the letter B — 2026-09-26).
    const statusValues = post.map((k, i) => (k === 'flag' ? values[i] : undefined)).filter((t): t is string => t !== undefined);
    const germanStatus = statusValues.find((t) => /^(?:bestanden|nicht bestanden|nb)$/i.test(t));
    const statusGrade = germanStatus === undefined ? undefined : mapGrade(germanStatus, legend);
    if (statusGrade !== undefined && gradeToken !== undefined && /^[BU]$/.test(gradeToken)) {
      into.grade = statusGrade;
      into.rawGrade = undefined;
    }
    // A status cell saying the course is still running, with no grade printed
    // (USP "MA" — matriculado; "cursando"; "em curso"): in progress.
    if (gradeToken === undefined && statusValues.some((t) => /^(?:MA|matriculad[oa]|cursando|em\s+curso|en\s+curso|inscrit[oa]|enrolled|in\s+progress)$/i.test(t))) into.grade = 'IP';
    const levelToken = preValues.level ?? value('level');
    const level: Level | undefined = levelToken === undefined ? undefined : /^(?:UG|UGRD|U|L|[4-6]|undergraduate)$/i.test(levelToken) ? 'undergraduate' : 'graduate';
    return { level, ...rowTerm };
  };
  /** The term a row's own cells name (2026-09-26): a year with a semester
   * mark (U Tokyo "2022 S1S2" / "A1A2"), DTU's exam period ("E23" = efterår
   * = fall 2023, "F24" = forår = spring 2024), UNAM's "2019-1" (the first
   * semester of the 2019 academic year, which begins in August 2018) and
   * "2019-2", Uniandes' "2019-10 / -20 / -19" (spring / fall / summer), or a
   * full date, which termOfDate places. */
  /** A term-code cell (F2, transcript accuracy program, 2026-10-09): the
   * compact "2023FA" / "2024SP" / "2023SU" / "2024WI" (Colleague, Workday)
   * or Banner's six-digit "202310". Read ONLY from a cell the header mapped
   * as the term, or from the first cell of a row whose second cell is the
   * course code — never from a trailing cell no header named. */
  const TERM_CODE_CELL_RE = /^(?:19|20)\d{2}(?:FA|SP|SU|WI|\d{2})$/i;
  // Six-digit Banner codes name a term only by a convention that differs
  // between schools — Notre Dame's 202610 is Fall 2026 (src/transcript/
  // parse.ts), elsewhere 202310 is Spring 2023 or Fall 2022 — so a row's code
  // is decoded only with the document's OWN key: a line that prints a code
  // beside the term it names ("202310 … Fall 2022", "Fall 2022 (202310)"),
  // one entry per term part seen. Without a key the row keeps its header's
  // term (never guess).
  // Bounds from the 2026-10-09 review (a key was read from any line, with
  // any offset, and decoded any six-digit cell): Banner names an academic
  // year by either of its calendar years, so the code's year is the named
  // year or one off it — "NOIDA 201301   Term: Spring 2023" (a postal code
  // beside an entry term, offset −10) is no key; a number the line labels as
  // an identifier ("Student ID 202310   Entry Term Fall 2022") is none
  // either; a course row never carries one (the pre-pass before the row
  // loop skips rows); and a decoded year must lie within a year of the years
  // the document prints (plausibleYear) — "200010" under a "202310 = Fall
  // 2022" key is not the fall of 1999. The key is read from the WHOLE
  // document before any row is, so a legend printed after the rows decodes
  // them too.
  const bannerTermKey = new Map<string, { season: Season; offset: number }>();
  const BANNER_KEY_FORWARD_RE = /\b((?:19|20)\d{2})(\d{2})\b[^0-9]{0,24}?\b(fall|autumn|spring|summer|winter)\b[^0-9]{0,24}?\b((?:19|20)\d{2})\b/gi;
  const BANNER_KEY_REVERSE_RE = /\b(fall|autumn|spring|summer|winter)\b[^0-9]{0,24}?\b((?:19|20)\d{2})\b[^0-9]{0,8}\(\s*((?:19|20)\d{2})(\d{2})\s*\)/gi;
  /** A label right before a number that says it is an identifier, not a term
   * code: "Student ID 202310", "No. 202310", "PIN 201301". */
  const IDENTIFIER_LABEL_RE = /\b(?:id|no\.?|num(?:ber)?|pin|zip|postal|phone|tel|fax|ref|roll|reg(?:istration)?|ssn|student)\s*[:#.]?\s*$/i;
  const readBannerTermKey = (line: string): void => {
    const note = (part: string, seasonWord: string, codeYear: number, namedYear: number, codeAt: number) => {
      const season = seasonOf(seasonWord);
      if (season === undefined || Math.abs(codeYear - namedYear) > 1) return;
      if (IDENTIFIER_LABEL_RE.test(line.slice(0, codeAt))) return;
      if (!bannerTermKey.has(part)) bannerTermKey.set(part, { season, offset: codeYear - namedYear });
    };
    for (const m of line.matchAll(BANNER_KEY_FORWARD_RE)) note(m[2]!, m[3]!, Number(m[1]), Number(m[4]), m.index!);
    for (const m of line.matchAll(BANNER_KEY_REVERSE_RE)) note(m[4]!, m[1]!, Number(m[3]), Number(m[2]), line.indexOf(`${m[3]}${m[4]}`, m.index!));
  };
  // Every four-digit year the document prints outside its six-digit codes —
  // term headers, dates, the key line itself — widened by a year each way.
  const documentYears = lines.flatMap((l) => [...l.replace(/\b(?:19|20)\d{4}\b/g, ' ').matchAll(/\b(19[5-9]\d|20[0-4]\d)\b/g)].map((m) => Number(m[1])));
  const yearSpan = documentYears.length > 0 ? { min: Math.min(...documentYears) - 1, max: Math.max(...documentYears) + 1 } : undefined;
  const plausibleYear = (y: number): boolean => yearSpan !== undefined && y >= yearSpan.min && y <= yearSpan.max;
  const rowTermOf = (cells: string[], ordinal = false): { year?: number; season?: Season } => {
    let year: number | undefined;
    let season: Season | undefined;
    for (const c of cells) {
      const y = /^((?:19|20)\d{2})$/.exec(c);
      if (y) { year = Number(y[1]); continue; }
      // "2023FA": the calendar year and the season's two letters; a winter
      // term sits where the spring does, as a "Winter" header would (seasonOf).
      const compact = /^((?:19|20)\d{2})(FA|SP|SU|WI)$/i.exec(c);
      if (compact) {
        const part = compact[2]!.toUpperCase();
        year = Number(compact[1]);
        season = part === 'FA' ? 'fall' : part === 'SU' ? 'summer' : 'spring';
        continue;
      }
      // "202310": decoded by the document's key, or left unread.
      const banner = /^((?:19|20)\d{2})(\d{2})$/.exec(c);
      if (banner) {
        const key = bannerTermKey.get(banner[2]!);
        const decoded = key ? Number(banner[1]) - key.offset : undefined;
        if (key && decoded !== undefined && plausibleYear(decoded)) { year = decoded; season = key.season; }
        continue;
      }
      // A bare term ordinal (McMaster's TM column, F6 2026-10-09): 1 is the
      // session's first term — the fall of its first year — 2 the second (the
      // spring of its second year), 3 the summer; under a one-year header
      // ("SPRING/SUMMER 2021") the ordinal keeps that year.
      // Only a cell the header mapped as the term AND headed "TM" (`ordinal`
      // — F6 review, 2026-10-09: a continuously numbered "Semester" column
      // or a year-of-study "Year" column read 2 as the spring of the second
      // year and 3 as the summer; the serial number before a code ("No.
      // Course Code …") is never one either). McMaster's legend is the only
      // key the parser has for a bare number: "TM: term in which the course
      // was taken".
      if (ordinal && /^[1-3]$/.test(c) && currentYear !== undefined) {
        const second = academicRange?.second ?? (currentSeason === 'fall' ? currentYear + 1 : currentYear);
        if (c === '1') { year = academicRange?.first ?? currentYear; season = 'fall'; }
        else if (c === '2') { year = second; season = 'spring'; }
        else { year = second; season = 'summer'; }
        continue;
      }
      const jp = /^(S|A)(?:1|2|1S2|1A2)?$/.exec(c);
      if (jp && /^(?:S1S2|A1A2|S1|S2|A1|A2)$/.test(c)) { season = jp[1] === 'S' ? 'spring' : 'fall'; continue; }
      const dk = /^([EF])(\d{2})$/.exec(c);
      if (dk) { year = 2000 + Number(dk[2]); season = dk[1] === 'E' ? 'fall' : 'spring'; continue; }
      const mx = /^((?:19|20)\d{2})-([12])$/.exec(c);
      if (mx) { year = mx[2] === '1' ? Number(mx[1]) - 1 : Number(mx[1]); season = mx[2] === '1' ? 'fall' : 'spring'; continue; }
      const co = /^((?:19|20)\d{2})-(10|20|19)$/.exec(c);
      if (co) { year = Number(co[1]); season = co[2] === '10' ? 'spring' : co[2] === '20' ? 'fall' : 'summer'; continue; }
      // Brazil's "1S/2022", "1º Sem/2019", "2022/1": the numbered half-year, in
      // calendar order.
      const br = /^([12])\s*[ºª°]?\s*(?:S|Sem\.?)?\s*\/\s*((?:19|20)\d{2})$/i.exec(c) ?? /^((?:19|20)\d{2})\s*\/\s*([12])$/.exec(c);
      if (br) { const half = /^[12]/.test(br[1]!) ? br[1]! : br[2]!; year = Number(/^[12]$/.test(br[1]!) ? br[2] : br[1]); season = half === '1' ? 'spring' : 'fall'; continue; }
      // A result date places the row only when no term header does (VTU's
      // "Announced on" is months after the semester).
      const sane = (d: string | undefined) => (d !== undefined && Number(d.slice(5, 7)) <= 12 ? d : undefined);
      const date = currentYear === undefined || !headerSeasonExplicit ? (isoOrEuropeanDate(c, dayFirstDocument) ?? sane(dateOnLine(c))) : undefined;
      if (date) { const t = termOfDate(date); year = t.year; season = t.season; }
    }
    return { ...(year !== undefined ? { year } : {}), ...(season !== undefined ? { season } : {}) };
  };

  /** The course code at the start of a line's first (or second) cell —
   * case-insensitive, stopword-guarded. Returns the UPPERCASED code and the
   * rest of the line's tokens (original case, for the title). */
  /** A date cell that may open a row before the code (Peradeniya "27-Jun-19
   * GP101 English I A 3", 2026-09-26): dd-Mon-yy, dd/mm/yyyy, yyyy-mm-dd. */
  const LEAD_DATE_RE = /^(?:\d{1,2}[-/.][A-Za-z]{3}[-/.]\d{2,4}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}|\d{4}-\d{2}-\d{2})$/;
  /** Colleague prints the section in its own cell right after the code
   * ("CS-101   01   Intro to CS   3   A" — F3, 2026-10-09): a zero-padded
   * one- or two-digit first token before a wordy title is the section, never
   * a title word or the credits ("CS-101   01   Calculus 2   3   B" read
   * credits 2). A section glued to the number ("CS 105-01") is untouched. */
  /** Minerva's multi-term mark (F3, Batch B 2026-10-09): a Wingdings diamond
   * — a private-use glyph (U+F0B2) in the text layer — or a superscript
   * "²" when the font is missing, printed right after the course number
   * ("MATH 470J1 ²   001 Honours Research Project"). A lone symbol token
   * before the section or the title is the mark, dropped; a connector the
   * title may start with ("&", "/", "-") is left alone. */
  const MULTI_TERM_MARK_RE = /^(?:[\u00B2\u00B3\u00B9\u2070-\u2079\u2460-\u24FF\u25C6\u25C7\u25CA\u2662\u2666\u2756\u2727\u2726\u2605\u2606\u2022\u00B0\u2020\u2021\u00A7\u00B6]|[\uE000-\uF8FF])$/u;
  /** The mark as a SCAN reads it (OCR plan step 2.5, 2026-10-09): the engine
   * has no glyph for the diamond and prints "<>", "<~", "©" — or "2" for the
   * superscript. On an OCR line a first token of one to three characters
   * with no letter and at most one digit in it is that mark when the
   * zero-padded section and a wordy title follow it ("ECSE 458D1 <>   001
   * Capstone Design Project", "MATH 470J1 2   001   Honours Research
   * Project"): all three are the evidence, so a lone digit or symbol anywhere
   * else is read as before. */
  const OCR_MARK_RE = /^[^\p{L}\d]{0,3}\d?[^\p{L}\d]{0,3}$/u;
  const ocrMark = (raw: string[]): boolean =>
    ocrLines && raw.length >= 3 && raw[0]!.length <= 3 && OCR_MARK_RE.test(raw[0]!) && /^0\d{1,2}$/.test(raw[1]!) && /^[\p{L}]/u.test(raw[2]!) && /[\p{L}]{2}/u.test(raw[2]!);
  const dropSection = (raw: string[]): string[] => {
    const tokens = raw.length >= 2 && (MULTI_TERM_MARK_RE.test(raw[0]!) || ocrMark(raw)) ? raw.slice(1) : raw;
    return tokens.length >= 2 && /^0\d{1,2}$/.test(tokens[0]!) && /^[\p{L}]/u.test(tokens[1]!) && /[\p{L}]{2}/u.test(tokens[1]!) ? tokens.slice(1) : tokens;
  };
  /** `printed`: the code as the line prints it, case kept ("fot ta 12",
   * "cs 430"); `decimalCell`: a code of digits whose cell is a decimal
   * number ("3837.3635", "2430.24") — the two facts the scan-only junk-code
   * guard reads (OCR plan step 2.5, `ocrJunkCode`). */
  const leadCode = (flat: string): { code: string; tokens: string[]; date?: string; preCell?: string; printed: string; decimalCell?: true } | undefined => {
    // A stray 1–2-letter security mark merged onto the row's start ("XK ITWS
    // 1882 …", 2026-09-05) is skipped when a real code follows it. Three
    // letters are a college prefix that belongs to the code — BU's "CAS CS
    // 505" (DGS 2026-09-20) — so the mark is now at most two letters.
    // "C S 50300" reads as "CS 50300" (DGS 2026-09-20; see joinSpacedSubject).
    const cells = joinSpacedSubject(flat).replace(/^[A-Z]{1,2}\s+(?=[A-Za-z]{2,10}(?: [A-Za-z]{1,4})?\s+\d)/, '').split(/\s{2,}/);
    // Banner / PeopleSoft layouts print the subject and the number in SEPARATE
    // columns ("CS   455   Data Communication   3.00 A   12.00"; Western's
    // "COMPSCI   3331A Title …" keeps the title in the number's cell; Johns
    // Hopkins leads with a 2-letter division cell) — so the code spans two
    // adjacent cells, starting at the first or second cell (2026-09-05;
    // stopword-guarded like the rest).
    for (const i of [0, 1] as const) {
      const rawSubjectCell = cells[i];
      const numberCell = cells[i + 1];
      if (rawSubjectCell === undefined || numberCell === undefined || cells.length < i + 3) break;
      if (i === 1 && !/^[A-Za-z]{1,3}$/.test(cells[0]!) && !LEAD_DATE_RE.test(cells[0]!) && !TERM_CODE_CELL_RE.test(cells[0]!)) break; // only a short division/security cell, a date or a term code (F2) may precede
      const subjectCell = rawSubjectCell.replace(CROSS_LISTED_SUBJECT_RE, '').replace(SUBJECT_TRAILING_DASH_RE, '');
      const colonSubject = COLON_SUBJECT_RE.test(subjectCell);
      if (!colonSubject && (!SUBJECT_RE.test(subjectCell) || !subjectCase(subjectCell) || proseSubject(subjectCell))) continue;
      const num = NUMBER_RE.exec(numberCell);
      if (!num) continue;
      const subject = subjectCell.toUpperCase();
      if (CODE_STOPWORDS_RE.test(subject.replace(/ /g, '')) || subject.split(' ').some((w) => TERM_WORD_RE.test(w))) continue; // a term word is never a subject (review 2026-10-09)
      // The one-letter middle of a two-word subject cell is a capital (F3).
      if (/^[A-Za-z]+ [A-Za-z]$/.test(subjectCell) && !/ [A-Z]$/.test(subjectCell)) continue;
      const tokens = dropSection(tokensOf([num[2]!.trim().replace(/^[-–—]\s+/, ''), ...cells.slice(i + 2)]));
      if (looksLikeIdentifierLine(subject, tokens)) continue;
      const date = i === 1 && LEAD_DATE_RE.test(cells[0]!) ? cells[0] : undefined;
      return { code: colonSubject ? `${subject}${num[1]!}` : `${subject} ${num[1]!.toUpperCase()}`, tokens, ...(date ? { date } : {}), ...(i === 1 ? { preCell: cells[0] } : {}), printed: `${subjectCell} ${num[1]!}` };
    }
    for (const idx of [0, 1] as const) {
      const cell = cells[idx];
      if (cell === undefined) break;
      if (idx === 1 && /[a-z]{3}/i.test(cells[0]!) && !LEAD_DATE_RE.test(cells[0]!)) break; // wordy first cell → not a leading term/date
      // A term-code cell before a letter-led course code ("202310   CS 101   …",
      // F2 2026-10-09) is the row's term cell, not its code — while "202310
      // Advanced Topics   3   A" keeps the six-digit code as the course id.
      if (idx === 0 && TERM_CODE_CELL_RE.test(cell) && cells[1] !== undefined && /^[A-Z]/.test(LEAD_CODE_RE.exec(cells[1]!.toUpperCase())?.[1] ?? '')) continue;
      const m = LEAD_CODE_RE.exec(cell.toUpperCase());
      if (!m) continue;
      const code = m[1]!;
      // The one-letter middle of "ENG M 612" is printed as a capital; "Use a
      // 2019 edition" is prose (F3, 2026-10-09).
      if (/^[A-Z]{2,10} [A-Z] \d/.test(code) && !/^[A-Za-z]+ [A-Z] /.test(cell)) return undefined;
      // A bare year or a year range is not a course code: on its own it is a
      // term line; as a first cell ("2022/2023   052513   …", Politecnico di
      // Milano) the code may follow it (2026-09-26).
      if (/^(19|20)\d{2}(?:-(19|20)\d{2})?$/.test(code)) {
        if (idx === 0 && cells.length > 1 && /^(?:19|20)\d{2}(?:[-–/](?:19|20)?\d{2})?$/.test(cell)) continue;
        return undefined;
      }
      // "IAP 2023" — and, since the 2026-10-09 review of F3, "SEMESTRE I
      // 2019" / "SEMESTRE I 2019-2020": a code whose number is a bare year,
      // alone in its cell with nothing but a year range after it, is a term
      // heading, not a course.
      if (/^[A-Z]{2,10}(?: [A-Z]{1,4})? (19|20)\d{2}$/.test(code) && /^(?:[-–/](?:19|20)?\d{2})?$/.test(m[2]!.trim()) && cells.length === 1) return undefined;
      // A digit-led or mixed code must be followed by a title (letters), or it
      // is a number on a totals line.
      // The rest of the cell in its printed case (the match ran on the
      // upper-cased cell; the code is length-stable).
      const restText = [cell.slice(cell.length - m[2]!.length), ...cells.slice(idx + 1)].join(' ');
      if (DIGIT_LED_CODE_RE.test(code) && !/[\p{L}]{2}/u.test(restText)) return undefined;
      if (proseSubject(cell.slice(0, code.length).replace(/[^A-Za-z].*$/, ''))) return undefined;
      // …and that title is printed with a capital or in another script — a
      // number-only code before lowercase prose is a grade-point table
      // ("B+   3.333 per credit", Delaware's key, 2026-09-26).
      if (DIGIT_LED_CODE_RE.test(code) && !/[\p{Lu}]|[^\x00-\x7F]/u.test(restText)) return undefined;
      // A course-number RANGE from a key ("0000-0999 … 5000-5999 Master's",
      // UConn) and a number the line continues ("199719/98", NUS) are not codes.
      if (/^\d000-\d999$/.test(code)) return undefined;
      if (/^\d{5,10}$/.test(code) && cell[code.length] === '/') return undefined;
      // Every word of the subject is tested ("TERM GPA 12" is no course), and
      // a term word is never a subject (review 2026-10-09: F3's one-letter-
      // middle shape read the headings "SEMESTRE I 2019", "CICLO I 2019",
      // "PERIODO I 2019", "TRIMESTER I 2019" as course codes, and a line
      // leadCode accepts never opens a term — TERM_WORD_RE is the one list,
      // so a term word added there is refused here without a second edit).
      if (code.split(/[^A-Z]+/).some((w) => CODE_STOPWORDS_RE.test(w) || TERM_WORD_RE.test(w))) return undefined;
      if (!subjectCase(cell.slice(0, code.length).replace(/\d.*$/, ''))) return undefined; // "Chapter 3": prose, not a code
      const rest = cell.slice(cell.length - m[2]!.length); // same indices — toUpperCase is length-stable for these codes
      const tokens = dropSection(tokensOf([rest, ...cells.slice(idx + 1)]));
      if (looksLikeIdentifierLine(code.replace(/[^A-Z]/g, ''), tokens)) return undefined;
      const date = idx === 1 && LEAD_DATE_RE.test(cells[0]!) ? cells[0] : undefined;
      // A code of digits whose cell goes on with a decimal part ("3837.3635":
      // the pattern took "3837" and left ".3635"), or a dotted code whose
      // decimals are all zeros ("15.000"), is a number in that cell.
      const decimalCell = /^[\d.\-]+$/.test(code) && (/^[.:]\d/.test(cell.slice(code.length)) || /^\d+\.0+$/.test(code));
      return { code, tokens, ...(date ? { date } : {}), ...(idx === 1 ? { preCell: cells[0] } : {}), printed: cell.slice(0, code.length), ...(decimalCell ? { decimalCell: true as const } : {}) };
    }
    return undefined;
  };

  /** A plain wordy line — no code, no numbers, no label — that can only be
   * a course title printed on its own line (ShanghaiTech, bilingual Chinese
   * transcripts, 2026-09-05). */
  const NOT_TITLE_RE = /[:]|\b(standing|total|totals|gpa|term|semester|page|program|plan|major|college|school|department|degree|credits?|hours|grade|course|title|record|continued|end of)\b/i;
  const plainTitleLine = (text: string | undefined): string | undefined => {
    if (text === undefined) return undefined;
    const t = text.replace(/\s+/g, ' ').trim();
    if (t.length < 4 || t.length > 90 || /\d{2,}/.test(t) || NOT_TITLE_RE.test(t) || leadCode(t)) return undefined;
    if ((t.match(/[\p{L}]/gu) ?? []).length < 4) return undefined;
    return t;
  };

  // Banner's "TRANSFER CREDIT ACCEPTED BY THE INSTITUTION:" block lists courses
  // this university accepted from ANOTHER school (often the student's
  // bachelor's) until "INSTITUTION CREDIT:" opens the university's own record.
  // Those rows are not this university's courses — importing them here would
  // let undergraduate work masquerade as graduate transfer credit — so they are
  // skipped and counted (2026-09-05).
  // …and Minerva's "Credits/Exemptions" block (F5, 2026-10-09): "From: Dawson
  // College - 24 credits" then bare rows — a code and "EXC" or a credit
  // value, no title ("COMP   202   EXC", "MATH   140   3", "TRNS   XXX   6").
  // Those are exemptions from another school's work, skipped and counted like
  // the transfer rows; the block ends at the first full course row (title,
  // credits, grade) or the next term header.
  let transferBlock: 'banner' | 'table' | 'exemptions' | undefined;
  const EXEMPTIONS_HEADING_RE = /^\s*credits?\s*\/\s*exemptions?\b|^\s*exemptions?\s*(?:and|\/|&)\s*credits?\b/i;
  // Banner's "COURSES IN PROGRESS" section (public keys, 2026-09-26): its rows
  // print credits and no grade — they are in progress until the next term
  // header or section heading, as the Notre Dame parser reads its own.
  let inProgressBlock = false;
  /** The block was opened by a term header's own "IN PROGRESS" (item 14). */
  let inProgressByTermLine = false;
  /** Under a FALL/WINTER session header, the year it starts (item 14). */
  let fallWinterSession: number | undefined;
  const IN_PROGRESS_HEADING_RE = /^\s*(?:\*+\s*)?(?:courses?\s+in\s+progress|(?:work\s+)?in[- ]progress(?:\s+courses?)?)\b/i;
  const SECTION_HEADING_RE = /^\s*(?:\*+\s*)?(?:transcript\s+totals|total\s+institution|totals?\b|overall\b|cumulative\b|end\s+of\s+(?:transcript|record)|transfer\s+credit|degrees?\s+awarded|academic\s+standing)/i;
  let transferRowsSkipped = 0;
  // Level signals (2026-09-05, combined B.S.+M.S. / 4+1 transcripts): a
  // "Level:" / "Term Totals (Graduate)" / "College: Graduate School" line sets
  // the level of the rows that follow, as does a cell that is exactly the
  // level word ("Graduate   Units Attempted: …", a "Year of Study" table) or a
  // term header ending in it ("Fall Quarter 2029 Graduate"); a UG/GR cell
  // right after the course code sets one row's; a dated bachelor's conferral
  // splits the rest by term; a closing "GRADUATE SEMESTER TOTALS" line labels
  // the rows above it when nothing else did.
  type Level = NonNullable<ExternalCourseCandidate['level']>;
  const LEVEL_BLOCK_RE =
    /^(?:[a-z]+\s+)?level\s*:?\s*(undergraduate|graduate)\b|^term\s+totals\s*\(?\s*(undergraduate|graduate)\b|^\(?(undergraduate|graduate)\)?$|^college\s*:?\s*(?:the\s+)?(graduate)\s+school\b|^(?:beginning\s+of\s+)?(undergraduate|graduate)\s+(?:academic\s+)?record\b/i;
  const CELL_LEVEL_RE =
    /^(?:academic\s+)?career\s*:?\s*(undergraduate|graduate|postgraduate|masters?|doctoral)\b|^program(?:me)?\s*:?\s*(?:master'?s|doctoral|ph\.?d\.?|graduate|postgraduate)\s+(?:program(?:me)?|course|degree)|^(graduate|postgraduate)\s+student'?s?\s+(?:work\s+)?record\b|^(?:p[oó]s-gradua[çc][aã]o|posgrado|mestrado|maestr[ií]a|doutorado|doctorado)\b|^(?:fheq|scqf|nfq)?\s*level\s*:?\s*([4-8])\b/i;
  const LEVEL_TOTALS_RE = /\b(undergraduate|graduate)\s+(?:semester\s+)?totals\b/i;
  const ROW_LEVEL_RE = /^(UG|UGRD|GR|GRAD)$/;
  const levelWord = (w: string): Level => (w.toLowerCase() === 'undergraduate' ? 'undergraduate' : 'graduate');
  let blockLevel: Level | undefined;
  let retroLevel: Level | undefined;
  let bachelorsConferredOn: string | undefined;
  let bachelorsConferred: true | undefined;
  let bachelorsNamed = false; // a bachelor's is named at all — dated or not (2026-09-08)
  let recentDegreeDate: { date: string; at: number } | undefined; // a dated "Degree Completion Date:" line, in case the degree name follows
  const rowLevels: (Level | undefined)[] = [];
  // Degrees (2026-09-05): a "Degrees Awarded" block makes the degree lines
  // under it conferred even without an award word on the line itself (USC,
  // Duke, Western); a "Degree and Date Conferred" table header does the same
  // for the line below it (Johns Hopkins).
  let degreeBlock = 0; // lines of a degrees-awarded block still to read
  let blockConferredGrad = false;
  type Lead = ReturnType<typeof leadCode>;
  /** Block and term tracking for one line: which transfer block the scan is
   * in, and the year, season and level the next course rows inherit. */
  /** The line trackTermAndTransfer just read was a term header — never a
   * code-less course row (CC15). */
  let termLineHere = false;
  /** CC16 (DGS 2026-10-09, Batch C): the terms a "1st Semester   2nd
   * Semester" line names over the columns of the table below it, placed in
   * the academic year in force — `null` where the parser cannot place one
   * (never a guess). Cleared by the next term header. */
  let semesterColumns: ({ year: number; season: Season } | null)[] | undefined;
  /** One cell of such a line: an ordinal and a term word, nothing else. */
  const SEMESTER_CELL_RE = /^(?:(?:1st|2nd|3rd|first|second|third)\s+(?:semester|term)|(?:semester|term)\s*[-:]?\s*(?:[1-3]|I{1,3}))$/i;
  /** A numbered semester of the academic year in force: of a two-year range
   * ("2018-2019"), the first is the fall of its first year, the second the
   * spring and a third the summer of its second (readTermLine's rule for
   * "2018-2019 First Semester"); anything else is not placed. */
  const placeSemester = (n: number): { year: number; season: Season } | null => {
    if (academicRange) return n === 1 ? { year: academicRange.first, season: 'fall' } : n === 2 ? { year: academicRange.second, season: 'spring' } : n === 3 ? { year: academicRange.second, season: 'summer' } : null;
    // A single-year academic year ("2022 Academic Year") is placed only by
    // the document's country calendar (TH02).
    if (academicYearAlone !== undefined) return calendarSemester(n, academicYearAlone) ?? null;
    return null;
  };
  /** The year of a single-year academic-year header in force ("2001
   * Academic Year", "Academic Year: 2022") — not a calendar year. */
  let academicYearAlone: number | undefined;
  const ACADEMIC_YEAR_ALONE_RE = /^(?:((?:19|20)\d{2})\s+academic\s+year|academic\s+year\s*:?\s*((?:19|20)\d{2}))$/i;
  const readSemesterColumns = (line: string): boolean => {
    const cells = line.replace(/\s{2,}/g, '  ').trim().split(/\s{2,}/);
    if (cells.length < 1 || cells.length > 2 || !cells.every((c) => SEMESTER_CELL_RE.test(c))) return false;
    semesterColumns = cells.map((c) => {
      const n = ordinalOf(c);
      return n === undefined ? null : placeSemester(n);
    });
    return true;
  };
  const OWN_CREDIT_HEADING_RE = /^\s*(?!TRANSFER\b)[A-Z][A-Z'&.-]+(?:\s+[A-Z][A-Z'&.-]+){0,3}\s+CREDIT\s*:\s*$/;
  /** The totals lines read in full (DGS 2026-10-11, item 11) — the shapes
   * whose figures are unambiguous: Banner's labelled term line, "Ehrs: 6.00
   * GPA-Hrs: 6.00 QPts: 24.00 GPA: 4.00", under the term it closes, and its
   * "TOTAL INSTITUTION 25.00 21.00 81.99 3.90" (earned, GPA hours, quality
   * points, GPA) for the whole record. Nothing inside a transfer block (its
   * rows are not read as courses), nothing else on a guess. */
  const printedTotals: (PrintedTotals & { block?: number })[] = [];
  /** Which term block each row was read in (its index in `courses`), and the
   * current block — a new one at every term header — so a term's line names
   * exactly the rows above it. */
  const rowBlocks: number[] = [];
  let termBlock = 0;
  const readPrintedTotals = (flat: string): void => {
    if (transferBlock !== undefined) return;
    const n = (s: string): number => Number(s.replace(',', '.'));
    const banner = /\bEhrs:?\s*(\d+[.,]\d+)\s+GPA-?Hrs:?\s*(\d+[.,]\d+)\s+QPts:?\s*(\d+[.,]\d+)\s+GPA:?\s*(\d+[.,]\d+)/i.exec(flat);
    if (banner) {
      if (!/\b(total|overall|cumulative)\b/i.test(flat) && currentSeason !== undefined && currentYear !== undefined) {
        printedTotals.push({ scope: 'term', term: { season: currentSeason, year: currentYear }, earned: n(banner[1]!), gpaHours: n(banner[2]!), gpa: n(banner[4]!), block: termBlock });
      }
      return;
    }
    const institution = /^TOTAL\s+INSTITUTION\s+(\d+[.,]\d+)\s+(\d+[.,]\d+)\s+(\d+[.,]\d+)\s+(\d+[.,]\d+)\s*$/i.exec(flat);
    if (institution) printedTotals.push({ scope: 'overall', earned: n(institution[1]!), gpaHours: n(institution[2]!), gpa: n(institution[4]!) });
  };
  const trackTermAndTransfer = (line: string): void => {
    // Transfer blocks: Banner's "TRANSFER CREDIT ACCEPTED BY …" until
    // "INSTITUTION CREDIT"; PeopleSoft's "Term  Course  Transfer Course …"
    // table (2026-09-05, a scanned community-college block) until the next
    // term header.
    if (TRANSFER_BANNER_RE.test(line)) transferBlock = 'banner';
    else if (TRANSFER_TABLE_RE.test(line)) transferBlock = 'table';
    else if (EXEMPTIONS_HEADING_RE.test(line)) transferBlock = 'exemptions';
    // PeopleSoft's block (public keys, 2026-09-26): a bare "Transfer Credits"
    // heading, "Transfer Credit from <school>", "Applied Toward … Program";
    // closed by "Course Trans GPA" / "Transfer Totals" or the next term header.
    else if (TRANSFER_PEOPLESOFT_RE.test(line)) transferBlock = 'table';
    else if (INSTITUTION_CREDIT_RE.test(line) || TRANSFER_END_RE.test(line) || TRANSFER_TOTALS_RE.test(line)) transferBlock = undefined;
    // …and the institution's own credit heading after it (CC15, Batch C
    // 2026-10-09): Evergreen's "TRANSFER CREDIT:" block ends at "EVERGREEN
    // CREDIT:" — a heading in capitals that names a credit other than a
    // transfer.
    else if (transferBlock !== undefined && OWN_CREDIT_HEADING_RE.test(line)) transferBlock = undefined;
    // Track the nearest term-ish header so course rows inherit its year.
    if (IN_PROGRESS_HEADING_RE.test(line)) inProgressBlock = true;
    else if (SECTION_HEADING_RE.test(line)) inProgressBlock = false;
    // Two semesters named side by side ("First Semester   Second Semester")
    // head the two halves of a CC16 table — not one term header.
    const semesterLine = readSemesterColumns(line);
    const twoColumns = semesterLine && semesterColumns!.length === 2;
    // One semester alone under a single-year academic year that the country
    // calendar places ("2022 Academic Year" / "1st Semester", TH02) is that
    // term's header.
    const lone = semesterLine && !twoColumns && academicYearAlone !== undefined ? semesterColumns![0] : null;
    const term: TermRead | undefined = lone ? { ...lone, explicit: true } : twoColumns || codelessRowShape(line) ? undefined : readTermLine(line);
    termLineHere = term !== undefined;
    if (termLineHere) termBlock += 1;
    // A term header that says so itself — UCLA's "SPRING QUARTER 2024   IN
    // PROGRESS" (item 14, 2026-10-11) — opens an in-progress block for its
    // rows; the next term header without the words ends one opened this way
    // (a "COURSES IN PROGRESS" section still ends only at a section heading).
    if (term !== undefined) {
      if (/\s{2,}in\s+progress\s*$/i.test(line)) {
        inProgressBlock = true;
        inProgressByTermLine = true;
      } else if (inProgressByTermLine) {
        inProgressBlock = false;
        inProgressByTermLine = false;
      }
    }
    if (term) semesterColumns = undefined;
    if (term && !lone) {
      const alone = ACADEMIC_YEAR_ALONE_RE.exec(line.replace(/\s+/g, ' ').trim());
      academicYearAlone = alone && term.season === undefined ? term.year : undefined;
    }
    if (term) {
      // (The in-progress section's own term line — "Term: Fall 2024" under
      // "COURSES IN PROGRESS" — does not end it; a section heading does.)
      if (transferBlock === 'table' || transferBlock === 'exemptions') transferBlock = undefined; // the table ends at the next term header
      // A bare term header ends Banner's block too (2026-09-20) — one that
      // names an institution is a transfer term inside it.
      if (transferBlock === 'banner' && !NAMES_INSTITUTION_RE.test(line)) transferBlock = undefined;
      currentYear = term.year;
      // A header that names no season ("Term 2234", a bare "Session:
      // 2018-2019") leaves the season open rather than keeping the previous
      // header's (2026-09-26 — BITS Pilani's fall rows inherited "Summer").
      currentSeason = term.season;
      headerSeasonExplicit = term.explicit === true;
      // Western's "FALL/WINTER 2019-2020" session (item 14, 2026-10-11): its
      // rows say their own term in the course number's suffix (below).
      fallWinterSession = /\bfall\s*\/\s*winter\b/i.test(line) ? term.year : undefined;
      const suffix = LEVEL_SUFFIX_RE.exec(line.trim());
      if (suffix) blockLevel = levelWord(suffix[1]!);
    }
  };
  /** A term header, read (2026-09-26) from the year(s) it prints and the
   * season, ordinal, month range or calendar it names. Undefined when the
   * line is not one: no term word, no usable year, a course row, or a
   * prose line (long, unless its only digits are years and an ordinal). */
  interface TermRead {
    year: number;
    season?: Season;
    /** The season came from the header itself, not from an academic-year default. */
    explicit?: true;
  }
  // The academic year of the last header that printed one (BUET prints
  // "Session: 2018-2019" once and "Level-1 Term-I" per term) and the highest
  // ordinal any term line uses (three terms in one year — UNSW — put the
  // second in the summer; two put it in the fall).
  let academicRange: { first: number; second: number } | undefined;
  // Whether the current header named a season, ordinal or month: a row's own
  // date wins over a header that only names the academic year (Politecnico
  // di Milano's exam dates under "Academic year 2022/2023").
  let headerSeasonExplicit = false;
  let ubcSessionYear: number | undefined;
  // "2019 Winter Session" is UBC's academic year only when its Term 1 / Term 2
  // lines with month ranges follow; at Toronto "2024 WINTER SESSION" is the
  // January–April term (2026-09-26).
  const ubcStyle = lines.some((l) => MONTH_RANGE_RE.test(l) && /\bterm\s*[12]\b/i.test(l));
  const maxOrdinal = Math.max(1, ...lines.map((l) => ordinalOf(l) ?? 0).filter((n) => n < 4));
  const PAREN_DATES_RE = /\s*\((?=[^()]*\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})[^()]*\)/g;
  /** The year a parenthesised date range places its term in (review
   * 2026-10-09): the year of the date the term starts on — or, for a spring,
   * summer or winter term whose range starts in the December before ("Winter
   * Term (12/01/2023-03/15/2024)" is the 2024 term), the year it ends in.
   * Four-digit years only: a two-digit year ("09/05/23") is not read. */
  const rangeYear = (paren: string | undefined, season: Season | undefined): number | undefined => {
    if (paren === undefined) return undefined;
    const years = [...paren.matchAll(/\b(?:\d{1,2}[/.-]\d{1,2}[/.-]((?:19|20)\d{2})|((?:19|20)\d{2})-\d{2}-\d{2})\b/g)].map((m) => Number(m[1] ?? m[2]));
    if (years.length === 0) return undefined;
    const first = years[0]!;
    const last = years[years.length - 1]!;
    return season !== undefined && season !== 'fall' && last === first + 1 ? last : first;
  };
  // -------------------------------------------------------------------
  // TH02 — academic calendars set at COUNTRY level (DGS 2026-10-09,
  // transcript accuracy program, Batch C: "a small country-level
  // academic-calendar table in code beside readTermLine (Thailand first),
  // each entry with its source, used only when the transcript prints no
  // month range itself"). A transcript that numbers its semesters within a
  // printed year ("First Semester 2022") without their months is placed by
  // its country's calendar when the document names the country; without one
  // the calendar-order rule below stands (2026-09-26). An entry needs a
  // source a future DGS can open, and the country as the document prints it
  // — a city or an institution's name is not evidence (a question for the
  // DGS before China, whose single-year "2001 Academic Year" SJTU's template
  // prints with no country, can be added). The year a semester is numbered
  // in is the ACADEMIC year, which opens in the first semester.
  // -------------------------------------------------------------------
  interface CountryCalendar {
    country: string;
    /** A cell of the institution's heading that names the country: "Bangkok,
     * Thailand", "Bangkok 10330, Thailand", "THAILAND" — never a course title
     * ("History of Thailand" has no comma before the name), and never a
     * person's field (`institutionHeading`). */
    evidence: RegExp;
    /** Each numbered semester: its season, and the years after the academic
     * year it was numbered in. */
    semesters: Partial<Record<1 | 2 | 3, { season: Season; yearOffset: 0 | 1 }>>;
    source: string;
  }
  const COUNTRY_CALENDARS: readonly CountryCalendar[] = [
    {
      country: 'Thailand',
      evidence: /^(?:[\p{L}][\p{L}\d .'-]*,\s*(?:\d{5}\s+)?|\d{5}\s+)?(?:kingdom\s+of\s+)?thailand\.?$/iu,
      // First Semester August–December → the fall of the academic year;
      // Second Semester January–May → the spring of the next calendar year;
      // the Summer Session June–July → its summer.
      semesters: { 1: { season: 'fall', yearOffset: 0 }, 2: { season: 'spring', yearOffset: 1 }, 3: { season: 'summer', yearOffset: 1 } },
      source:
        'Chulalongkorn University, Faculty of Science, academic calendar (https://www.sis.sc.chula.ac.th/?p=32, read 2026-10-09): "First Semester: August – December; Second Semester: January – May; Summer Session (Optional): June – July"; the Office of the Registrar dates academic year 2568 (2025) from a first semester opening 4 August 2025 and a second opening 5 January 2026 (Start_EndDates_E-Sem2568.pdf, reg.chula.ac.th).',
    },
  ];
  /** The country calendar this document is placed by: its country named in
   * the INSTITUTION's own heading (`institutionHeading`, review fix
   * 2026-10-10), and no term printed with its own month range anywhere (the
   * transcript's months win). */
  const countryCalendar: CountryCalendar | undefined = (() => {
    if (lines.some((l) => MONTH_RANGE_RE.test(l) && TERM_WORD_RE.test(l))) return undefined;
    const cells = institutionHeading(lines).flatMap((l) => l.split(/\s{2,}/).map((c) => c.trim()));
    return COUNTRY_CALENDARS.find((c) => cells.some((cell) => c.evidence.test(cell)));
  })();
  /** A numbered semester of `academicYear` by the country's calendar. */
  const calendarSemester = (n: number, academicYear: number): { year: number; season: Season } | undefined => {
    const place = countryCalendar?.semesters[n as 1 | 2 | 3];
    return place ? { year: academicYear + place.yearOffset, season: place.season } : undefined;
  };
  const readTermLine = (line: string): TermRead | undefined => {
    if (!TERM_WORD_RE.test(line) && !YEAR_PART_RE.test(line) && !SLASH_ORDINAL_RE.test(line) && !/\bsession\s*:/i.test(line)) return undefined;
    // A year whose last digit the PDF sets apart ("200 3   FULL YEAR", the
    // ANU sample, 2026-09-26) is joined back before anything reads it.
    // Workday's "2023 Fall Semester (09/05/2023-12/15/2023)" (F2, 2026-10-09):
    // the parenthesised date range is dropped before anything reads the
    // line — its "2023-12" read as an academic year 2023/2012 and put a
    // spring term in 2005. When that range holds the line's ONLY year
    // ("Fall Semester (09/05/2023-12/15/2023)", review 2026-10-09) the
    // term's year is the one its dates give (rangeYear) — dropping the
    // range left the rows beneath with no year at all.
    const joined = line.replace(/\s{2,}/g, ' ').trim().replace(/\b((?:19|20)\d) (\d)\b/g, '$1$2');
    const outside = joined.replace(PAREN_DATES_RE, '');
    const parenYear = YEAR_RE.test(outside) ? undefined : rangeYear(joined.match(PAREN_DATES_RE)?.[0], seasonOf(outside));
    const flat = parenYear === undefined ? outside : `${outside} ${parenYear}`.trim();
    // A course row never opens a term ("ENGL 2010   Intermediate Writing").
    if (leadCode(line.replace(/\s{2,}/g, '  ').trim())) return undefined;
    // A "Winter" term dated by its own range (item 14, 2026-10-11): Workday's
    // "2024-25 Winter Term 1 (09/03/2024-12/20/2024)" is UBC's Term 1, the
    // FALL of 2024 — its dates say so, while "Winter" and "2024-25" read as
    // the spring of 2025. A winter term starting August to December is that
    // fall; one starting in December is the next year's spring (a December–
    // March winter term, the review of F2); January to April, that spring.
    // Day-first when the document is.
    const winterRange = /\bwinter\b/i.test(outside) ? /(\d{1,2})[/.-](\d{1,2})[/.-]((?:19|20)\d{2})/.exec(joined.match(PAREN_DATES_RE)?.[0] ?? '') : null;
    if (winterRange) {
      const month = Number(dayFirstDocument ? winterRange[2] : winterRange[1]);
      const year = Number(winterRange[3]);
      if (month >= 8 && month <= 11) return { year, season: 'fall', explicit: true };
      if (month === 12) return { year: year + 1, season: 'spring', explicit: true };
      if (month >= 1 && month <= 4) return { year, season: 'spring', explicit: true };
    }
    // Long lines are prose — unless bilingual (the Latin half before a
    // separator decides) or made only of term words, years and an ordinal.
    const latin = flat.split(/\s+[/|]\s+/)[0]!;
    // JNTU's "B.Tech III Year I Semester (R18) Regular Examinations, November
    // 2021" is a header despite its length: a term word, a month or ordinal,
    // a year, and no other long number.
    const headerLike = latin.length < 120 && (ordinalOf(latin) !== undefined || MONTH_YEAR_RE.test(latin) || MONTH_RANGE_RE.test(latin)) && !/\d{5,}/.test(latin);
    if (latin.length >= 60 && !headerLike && !/^[A-Za-z .,()':/-]*(?:19|20)\d{2}[A-Za-z .,()':/-]*$/.test(latin.replace(/\b(?:I{1,3}|IV|[1-4])\b/g, ' '))) return undefined;
    // UBC's "2019 Winter Session" is the academic year, its Term 1 the fall
    // and Term 2 the spring; "winter" must not read as a season there.
    const ubc = ubcStyle ? (/^((?:19|20)\d{2})\s+winter\s+session\b/i.exec(flat) ?? /\bwinter\s+session\s+((?:19|20)\d{2})\b/i.exec(flat)) : null;
    if (ubc) {
      ubcSessionYear = Number(ubc[1]);
      academicRange = { first: ubcSessionYear, second: ubcSessionYear + 1 };
      return { year: ubcSessionYear };
    }
    // Uniandes' "Periodo 2019-10" (first semester), "-20" (second), "-19" (summer).
    const periodo = /^per[ií]odo\s+((?:19|20)\d{2})-(10|20|19)\b/i.exec(flat);
    if (periodo) return { year: Number(periodo[1]), season: periodo[2] === '10' ? 'spring' : periodo[2] === '20' ? 'fall' : 'summer', explicit: true };
    const monthRange = MONTH_RANGE_RE.exec(flat);
    if (monthRange) {
      // The range's middle month places it: Jul–Nov (IIT Madras) is the fall,
      // Jan–Apr the spring, May–Jul the summer.
      const monthNo = (m: string) => ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(m.slice(0, 3).toLowerCase()) + 1;
      const from = monthNo(monthRange[1]!);
      const to = monthNo(/[-–—]\s*([a-z]{3})/i.exec(monthRange[0])?.[1] ?? monthRange[1]!);
      const mid = (from + (to < from ? to + 12 : to)) / 2;
      const season: Season = mid < 5 ? 'spring' : mid < 8 ? 'summer' : 'fall';
      return { year: Number(monthRange[2]), season, explicit: true };
    }
    // An examination month names the term (VTU "Examination: December 2021 /
    // January 2022", Anna "Month & Year of Exam: NOV/DEC 2015"): the FIRST
    // month and the year beside it — December is the fall's exam.
    const monthYear = MONTH_YEAR_RE.exec(flat);
    if (monthYear && !FALL_RE.test(flat) && !SUMMER_RE.test(flat) && !/\bspring\b/i.test(flat)) {
      const m = monthYear[1]!.toLowerCase();
      // An EXAMINATION month is the end of its term: India's odd semester sits
      // its exams in November–January, the even one in April–August.
      const exam = /\bexam/i.test(flat);
      const season: Season = exam
        ? /^(nov|dec|jan|feb)/.test(m) ? 'fall' : 'spring'
        : /^(jan|feb|mar|apr|may)/.test(m) ? 'spring' : /^(jun|jul)/.test(m) ? 'summer' : 'fall';
      return { year: Number(monthYear[2]), season, explicit: true };
    }
    // Years: Gregorian first; a Gregorian year in parentheses or marked G.C. /
    // A.D. beats an Ethiopian or Nepali year beside it; a Solar Hijri year
    // (1397–1398) converts — Iran's first semester starts in September of
    // year + 621, its second in February of year + 622.
    const hint = GREGORIAN_HINT_RE.exec(flat);
    let year: number | undefined = hint ? Number(hint[1] ?? hint[2]) : undefined;
    // The hinted year may itself be a range ("(2019/20 G.C.)").
    let range = hint ? ACADEMIC_YEAR_RE.exec(hint[0]) : ACADEMIC_YEAR_RE.exec(flat);
    if (year === undefined && range) year = Number(range[1]);
    if (year === undefined) {
      const y = YEAR_RE.exec(flat);
      if (y) year = Number(y[1]);
    }
    let hijri = false;
    if (year === undefined) {
      const h = SOLAR_HIJRI_YEAR_RE.exec(flat);
      if (h) {
        hijri = true;
        year = Number(h[1]) + 621;
        const hr = /\b(13[5-9]\d|14[0-2]\d)\s*[-–/]\s*(13[5-9]\d|14[0-2]\d|\d{2})\b/.exec(flat);
        if (hr) range = [hr[0], hr[1]!, hr[2]!] as unknown as RegExpExecArray;
      }
    }
    const ordinal = ordinalOf(flat);
    if (year === undefined && currentYear !== undefined && flat.length <= 30 && !/\d/.test(flat)) {
      // A term line with no year of its own — "SECOND SEMESTER", "Summer
      // Session" — under a header that printed one (the ANU sample prints
      // "2005   FIRST SEMESTER" once, then "SECOND SEMESTER"; 2026-09-26).
      // One season word exactly; an ordinal alone falls in calendar order.
      const seasonWords = (flat.match(/\b(?:fall|spring|summer|autumn|winter)\b/gi) ?? []).length;
      const alone = seasonWords === 1 ? seasonOf(flat) : undefined;
      if (alone !== undefined) return { year: currentYear, season: alone, explicit: true };
      if (ordinal !== undefined && seasonWords === 0 && !/\blevel\b/i.test(flat)) {
        if (maxOrdinal >= 3) return { year: currentYear, season: ordinal === 1 ? 'spring' : ordinal === 2 ? 'summer' : 'fall', explicit: true };
        return { year: currentYear, season: ordinal === 1 ? 'spring' : ordinal === 2 ? 'fall' : 'summer', explicit: true };
      }
    }
    if (year === undefined) {
      // "Level-1 Term-I" under an earlier "Session: 2018-2019" (BUET): the
      // session is the admission year; Level N is N − 1 years on.
      if (ordinal === undefined || academicRange === undefined) return undefined;
      const level = /\blevel\s*[-:]?\s*([1-6])\b/i.exec(flat);
      const offset = level ? Number(level[1]) - 1 : 0;
      return { year: (ordinal === 1 ? academicRange.first : academicRange.second) + offset, season: ordinal === 1 ? 'fall' : ordinal === 2 ? 'spring' : 'summer', explicit: true };
    }
    const secondYear = (r: RegExpExecArray): number => {
      const raw = r[2]!;
      const n = raw.length === 4 ? Number(raw) : Number(String(r[1]).slice(0, 2) + raw);
      return hijri ? n + 621 : n;
    };
    if (range) academicRange = { first: year, second: secondYear(range) };
    else if (!ordinal || !/\bsession\b/i.test(flat)) academicRange = undefined;
    const wpi = WPI_TERM_RE.exec(line);
    if (wpi) return { year, season: /^[AB]$/i.test(wpi[1]!) ? 'fall' : 'spring', explicit: true };
    const season = seasonOf(ubcStyle ? flat.replace(/winter\s+session/i, '') : flat);
    if (season !== undefined) {
      // "Spring 2023-2024", "Sommersemester 2023", "Second Semester 1397-1398":
      // the spring and summer belong to the range's second year.
      if (range && season !== 'fall') return { year: secondYear(range), season, explicit: true };
      return { year, season, explicit: true };
    }
    if (ordinal === undefined && range && /\b(academic\s+year|session|year)\b/i.test(flat)) return { year, season: 'fall' }; // a whole academic year (KU Leuven "Academic year 2022-2023"): it opens in the fall — not explicit, a dated row may override it
    if (ordinal !== undefined) {
      // Semesters numbered through the whole program — Tribhuvan's "Semester:
      // III" and "Semester: IV" under "Academic Year: 2081/082 B.S.
      // (2024/2025 A.D.)" (item 14, 2026-10-11) — alternate: an odd one is
      // its academic year's first (the fall), an even one its second (the
      // spring). Only "semester" says so; a third TERM or trimester is still
      // the year's summer.
      if (range && ordinal >= 3 && /\bsem(?:ester)?\b/i.test(flat) && !/\btrimester\b/i.test(flat)) return ordinal % 2 === 1 ? { year, season: 'fall' } : { year: secondYear(range), season: 'spring' };
      if (range) return ordinal === 1 ? { year, season: 'fall' } : ordinal === 2 ? { year: secondYear(range), season: 'spring' } : { year: secondYear(range), season: 'summer' };
      // One calendar year, numbered terms: in calendar order — the first is
      // the spring, the last the fall, a middle one the summer (UNSW's three
      // terms) — unless the document's country numbers them in its academic
      // year (TH02, above: Thailand's "First Semester 2022" is August–December).
      const byCountry = calendarSemester(ordinal, year);
      if (byCountry) return { ...byCountry, explicit: true };
      if (ubcSessionYear !== undefined && year === ubcSessionYear) return ordinal === 1 ? { year, season: 'fall' } : { year: year + 1, season: 'spring' };
      if (maxOrdinal >= 3) return { year, season: ordinal === 1 ? 'spring' : ordinal === 2 ? 'summer' : 'fall', explicit: true };
      return { year, season: ordinal === 1 ? 'spring' : ordinal === 2 ? 'fall' : 'summer', explicit: true };
    }
    return { year };
  };
  /** Level markers on one line. True when the line was only a marker and is
   * done with. */
  const readLevelMarkers = (flat: string, lead: Lead): boolean => {
    // A level named in one cell of a wider line (HKUST "Career: Postgraduate",
    // CU Boulder "Academic Career: Graduate", "Program: Master's Program",
    // "GRADUATE STUDENT'S WORK RECORD", Brazil's "PÓS-GRADUAÇÃO", the UK's
    // "FHEQ Level 7") — public transcript keys, 2026-09-26.
    if (!lead) {
      for (const cell of flat.split(/\s{2,}/)) {
        const m = CELL_LEVEL_RE.exec(cell.trim());
        if (m) {
          const word = (m[1] ?? m[2] ?? m[3] ?? '').toLowerCase();
          blockLevel = /^(undergraduate|bachelor|graduação|grado|licenciatura|[456])$/.test(word) ? 'undergraduate' : 'graduate';
          break;
        }
      }
    }
    const levelBlock = LEVEL_BLOCK_RE.exec(flat);
    if (levelBlock && !/\d{2,}/.test(flat.slice(0, 12))) {
      const word = levelBlock.slice(1).find((g) => g !== undefined) ?? '';
      blockLevel = levelWord(word);
      return true;
    }
    const levelCell = flat.split(/\s{2,}/).find((c) => LEVEL_ALONE_RE.test(c.trim()));
    if (levelCell && !lead) {
      blockLevel = levelWord(levelCell.trim());
      if (LEVEL_ALONE_RE.test(flat)) return true;
    }
    const totalsLevel = LEVEL_TOTALS_RE.exec(flat);
    if (totalsLevel) retroLevel = levelWord(totalsLevel[1]!);
    return false;
  };
  /** Degree lines: the degrees-awarded block, a graduate conferral, and the
   * bachelor's name and date (which may sit on a nearby line). */
  const readDegreeSignals = (flat: string, lead: Lead, lineIndex: number): void => {
    // Degrees awarded.
    if (DEGREES_AWARDED_HEADING_RE.test(flat) && !DEGREE_NAME_RE.test(flat)) {
      degreeBlock = 6;
    } else if (
      DEGREE_CONFERRED_HEADER_RE.test(flat) &&
      !DEGREE_NAME_RE.test(flat) &&
      // Either laid out in columns, or a heading and nothing else on the line
      // (Johns Hopkins prints "JHU Degree and Date Conferred" as one run,
      // 2026-09-08).
      (flat.split(/\s{2,}/).length >= 2 || DEGREE_CONFERRED_HEADER_ALONE_RE.test(flat))
    ) {
      degreeBlock = 2; // a table header: the values follow on the next line(s)
    }
    const namesDegree = namesDegreeIn(flat) && !NOT_AWARDED_RE.test(flat);
    // "Master of Science" / "Major: … Status: IN PROGRESS - NOT CONFERRED":
    // the status line under a bare degree name in the block (2026-09-20).
    const notConferred =
      NOT_CONFERRED_STATUS_RE.test(flat) || (degreeBlock > 0 && !CONFER_RE.test(flat) && NOT_CONFERRED_STATUS_RE.test(lines[lineIndex + 1] ?? ''));
    // Ladok's degree certificate line (item 14, 2026-10-11): "Degree of
    // Master of Science (120 credits) … Date of issue: 2025-06-27" — a degree
    // ISSUED on that date. Only on a line that opens "Degree of" and dates the
    // issue itself: a transcript's own "Date of Issue" header is no award.
    const issuedDegree = /^degree\s+of\s+/i.test(flat) && /\bdate\s+of\s+issue\s*:?\s*\d{4}-\d{2}-\d{2}\b/i.test(flat);
    const conferredHere = namesDegree && (saysConferred(flat) || degreeBlock > 0 || issuedDegree) && !NOT_YET_RE.test(flat) && !NOT_COMPLETE_RE.test(flat) && !notConferred;
    if (degreeBlock > 0 && !lead) degreeBlock -= 1;
    if (conferredHere && gradDegreeIn(flat)) blockConferredGrad = true;
    // Named, not necessarily conferred: "Degree Sought: Bachelor of Science"
    // still says this record covers an undergraduate degree.
    if (namesDegree && bachelorsIn(flat)) bachelorsNamed = true;
    // A dated degree line without a degree name ("Degree Completion Date:
    // 05/17/2024") is remembered: the degree name may follow it.
    if (!namesDegree && DEGREE_DATE_LINE_RE.test(flat) && !NOT_YET_RE.test(flat)) {
      const d = dateAfterLabel(flat);
      if (d !== undefined) recentDegreeDate = { date: d, at: lineIndex };
    }
    if (namesDegree && bachelorsIn(flat) && !NOT_COMPLETE_RE.test(flat) && bachelorsConferredOn === undefined) {
      // The bachelor's date (2026-09-05; widened 2026-09-06, late evening):
      // on the degree line itself when it says conferred/awarded (or sits in a
      // degrees-awarded block); else on a labelled line within the next six
      // ("Degree Date:", "Degree Completion Date:", "Conferral Date:", "Date
      // Conferred:", "Graduation Date:", "Awarded:") — stopping at a course
      // row or at the NEXT degree's name, so a master's date is never taken;
      // else on such a line up to two lines before the name. A forecast
      // ("Expected graduation: May 2027") never counts.
      if (conferredHere) {
        bachelorsConferred = true;
        bachelorsConferredOn = dateAfterLabel(flat) ?? looseDateOnLine(flat);
      }
      for (let k = 1; k <= 6 && bachelorsConferredOn === undefined; k++) {
        const later = lines[lineIndex + k];
        if (later === undefined || leadCode(later.replace(/\s{2,}/g, '  ').trim()) || gradDegreeNameIn(later)) break;
        if (DEGREE_DATE_LINE_RE.test(later) && !NOT_YET_RE.test(later)) bachelorsConferredOn = dateAfterLabel(later);
        // A bare "Date:" right under "Degree Completed: Bachelor of Science"
        // is that degree's date (UMass Amherst, DGS 2026-09-13) — but only
        // when the degree line itself said completed/conferred/awarded, so a
        // "Date:" elsewhere in a block is never mistaken for it.
        else if (conferredHere && /^\s*date\s*:/i.test(later) && !NOT_YET_RE.test(later)) bachelorsConferredOn = dateOnLine(later);
      }
      if (bachelorsConferredOn === undefined && recentDegreeDate !== undefined && lineIndex - recentDegreeDate.at <= 2) bachelorsConferredOn = recentDegreeDate.date;
    }
  };
  /** One course row, when the line is one. Returns the index of the last line
   * consumed (a continuation or title line may be taken with the row). */
  const PROGRAM_TITLE_RE = /^(?:bachelor|master|doctor)s?(?:'s)?\s+(?:of|in)\b|^(?:graduate|postgraduate|advanced)\s+(?:diploma|certificate)\b|^(?:diploma|certificate|associate)\s+(?:of|in)\b|^(?:licenciatura|maestr[ií]a|mestrado|doutorado|doctorado)\s+(?:en|em)\b/i;
  const PROSE_WORD_RE = /^(?:is|are|was|were|be|been|shall|must|may|will|can|has|have|had|does|do|not|if|which|that|this|these|those|than|then|when|where|there|their|they|he|she|it|its|we|you|our|your|who|whom|whose|as|such|so|also|only|each|every|per|at|by|from|into|upon|about|after|before|during|until|while|because|provided|unless|otherwise|however|thus|therefore|hence|whereas|within|without|would|should|could|might|should)$/;
  const courseLikeTitle = (parts: readonly string[]): boolean => {
    if (parts.length === 0) return true;
    const text = parts.join(' ');
    if (PROGRAM_TITLE_RE.test(text)) return false;
    if (text.includes('@')) return false;
    if (/,$/.test(text)) return false;
    const words = parts.map((w) => w.replace(/[^\p{L}]/gu, ''));
    if (parts.length >= 6 && new Set(words.filter((w) => PROSE_WORD_RE.test(w))).size >= 2) return false;
    return true;
  };
  // ---------------------------------------------------------------------
  // Code-less rows — CC15 (DGS 2026-10-09, transcript accuracy program,
  // Batch C: code-less transcripts "are IMPORTED with an empty required
  // course-id box the student fills before the row can be added; the course
  // stays 'not yet reviewed by the DGS' until an ExternalCourses match").
  // Chinese and Egyptian statements, the CHESICC verification report and
  // Evergreen's narrative record print course NAMES and no course numbers.
  // Such a row is pushed with `courseId: ''` and `codeMissing: true` — never
  // a made-up number — and only from two shapes that carry their own
  // evidence; a document that prints a course number on any row keeps none
  // of them (filtered after the loop): there a line without a code is a
  // total, a remark or another school's credit, not a course.
  // ---------------------------------------------------------------------
  /** Code-less rows pushed, and transfer-block lines of that shape skipped —
   * both dropped when the document turns out to print course numbers. */
  let codelessSkipped = 0;
  /** A title cell that is a label, a total or a sentence, never a course. */
  const NOT_COURSE_TITLE_RE = /[:@]|\b(?:totals?|subtotal|gpa|cgpa|sgpa|average|cumulative|earned|attempted|credits?|hours|units|points|semester|term|page|report|date)\b/i;
  /** An academic-year cell ("2018-2019", "2021/2022"). */
  const ACADEMIC_YEAR_CELL_RE = /^((?:19|20)\d{2})\s*[-–/]\s*((?:19|20)?\d{2})$/;
  /** The term the cells BEFORE a code-less row's title name: the CHESICC
   * report's "2018-2019   1" — an academic year and the number of its
   * semester under a "Semester" header word — is the first (fall 2018) or
   * second (spring 2019) semester of that year, the rule readTermLine
   * applies to "2018-2019 First Semester"; a third number, or a number with
   * no academic year beside it, names nothing the parser can place. */
  const preTitleTerm = (cells: string[], headers: string[]): { year?: number; season?: Season } | undefined => {
    let range: { first: number; second: number } | undefined;
    let ordinal: string | undefined;
    const rest: string[] = [];
    cells.forEach((c, i) => {
      const r = ACADEMIC_YEAR_CELL_RE.exec(c);
      if (r) {
        const first = Number(r[1]);
        const second = r[2]!.length === 4 ? Number(r[2]) : Number(r[1]!.slice(0, 2) + r[2]);
        if (second === first + 1) range = { first, second };
        return;
      }
      if (/^[1-3]$/.test(c) && /^(?:semester|term|semestre|sem)$/i.test((headers[i] ?? '').replace(/\s*\(.*\)\s*$/, ''))) {
        ordinal = c;
        return;
      }
      rest.push(c);
    });
    if (range && ordinal === '1') return { year: range.first, season: 'fall' };
    if (range && ordinal === '2') return { year: range.second, season: 'spring' };
    const t = rowTermOf(rest);
    return t.year !== undefined ? t : undefined;
  };
  /** Push one code-less course row. */
  const pushCodeless = (row: Omit<ExternalCourseCandidate, 'courseId' | 'codeMissing'>, level: Level | undefined): void => {
    courses.push({ courseId: '', codeMissing: true, ...row });
    rowLevels.push(level ?? blockLevel);
    rowBlocks.push(termBlock);
  };
  /** Shape 1 — a table whose header names a title column and no code column
   * (Nankai's "COURSE NAME   CREDIT   RESULT   COURSE TYPE", the CHESICC
   * report's "Academic Year   Semester   Course Name   Credit   Score   Course
   * Type", Cairo's "Subject   Full Mark   Marks Obtained   Grade"): a line
   * whose cells line up with the header's columns ONE FOR ONE, each cell
   * fitting its column — a wordy title, a credit value or a grade where the
   * header says so. A line that does not line up (a totals line, a
   * label/value line, a sentence, a row of another table) is no row.
   * `kinds` / `headers` default to the header in force; the side-by-side
   * reader (CC16) passes one group's. True when a row was read. */
  const codelessFit = (cells: string[], kinds: ColumnKind[] | undefined, headers: string[]): { titleAt: number; titleTokens: string[]; post: ColumnKind[] } | undefined => {
    if (!kinds) return undefined;
    const titleAt = kinds.indexOf('title');
    if (titleAt < 0 || kinds.includes('code') || cells.length !== kinds.length) return undefined;
    const pre = kinds.slice(0, titleAt);
    const post = kinds.slice(titleAt + 1);
    if (pre.some((k) => k !== 'term' && k !== 'serial')) return undefined;
    if (post.some((k) => k === 'code' || k === 'serial' || k === 'title')) return undefined;
    const title = cells[titleAt]!.trim();
    const titleTokens = title.split(/\s+/);
    if (!/^[\p{L}(]/u.test(title) || (title.match(/[\p{L}]/gu) ?? []).length < 4 || title.length > 90) return undefined;
    if (NOT_COURSE_TITLE_RE.test(title) || TOTALS_LINE_RE.test(title) || leadCode(title) || !courseLikeTitle(titleTokens)) return undefined;
    // Every other cell fits its column (a printed placeholder fits any).
    for (let i = 0; i < kinds.length; i++) {
      if (i === titleAt) continue;
      const c = cells[i]!.trim();
      const kind = kinds[i]!;
      if (PLACEHOLDER_TOKEN_RE.test(c)) continue;
      const ok =
        kind === 'serial' ? /^\d{1,3}\.?$/.test(c)
        : kind === 'term' ? ACADEMIC_YEAR_CELL_RE.test(c) || fits('term', c, headers[i])
        : kind === 'credits' || kind === 'ects' || kind === 'attempted' || kind === 'earned' ? asCreditsWide(c) !== undefined
        : kind === 'grade' ? gradeLike(c)
        : kind === 'mark' ? fits('mark', c) || gradeLike(c)
        : kind === 'flag' ? fits('flag', c) || /^[\p{L}][\p{L} .&/'-]*$/u.test(c)
        : fits(kind, c, headers[i]);
      if (!ok) return undefined;
    }
    return { titleAt, titleTokens, post };
  };
  /** A line the header in force reads as a code-less course row — never a
   * term header, whatever season word its title holds ("2019-2020   2
   * Summer Practice   2.0   85"). */
  /** CC16 (DGS 2026-10-09, Batch C): a header whose cells are the same
   * group printed twice — SJTU's "Course   Credits   Score   Course   Credits
   * Score", two semesters side by side — is one table per half: the group's
   * own kinds and header words, read once per header. */
  let sideBySideFor: string[] | undefined;
  let sideBySideGroup: { kinds: ColumnKind[]; headers: string[] } | undefined;
  const sideBySide = (): { kinds: ColumnKind[]; headers: string[] } | undefined => {
    if (sideBySideFor === lastHeaderCells) return sideBySideGroup;
    sideBySideFor = lastHeaderCells;
    sideBySideGroup = undefined;
    const n = lastHeaderCells.length;
    if (columnKinds === undefined || n < 4 || n % 2 !== 0) return undefined;
    const left = lastHeaderCells.slice(0, n / 2);
    if (left.some((c, i) => c.toLowerCase() !== lastHeaderCells[n / 2 + i]!.toLowerCase())) return undefined;
    // readColumnHeader keeps the cells it read in lastHeaderCells: the
    // table's own header stays the one in force.
    const saved = lastHeaderCells;
    const kinds = readColumnHeader(left.join('   '));
    const headers = lastHeaderCells;
    lastHeaderCells = saved;
    sideBySideGroup = kinds !== undefined && kinds.length === n / 2 ? { kinds, headers } : undefined;
    return sideBySideGroup;
  };
  /** The cells of a line, by group: both halves of a side-by-side row, or
   * one group's cells — whose side the text cannot tell. */
  const sideBySideHalves = (cells: string[], group: { kinds: ColumnKind[] }): { cells: string[]; side?: 0 | 1 }[] => {
    const k = group.kinds.length;
    if (cells.length === 2 * k) return [{ cells: cells.slice(0, k), side: 0 }, { cells: cells.slice(k), side: 1 }];
    return cells.length === k ? [{ cells }] : [];
  };
  const codelessRowShape = (line: string): boolean => {
    const cells = line.replace(/\s{2,}/g, '  ').trim().split(/\s{2,}/);
    const group = sideBySide();
    if (group) return sideBySideHalves(cells, group).some((h) => codelessFit(h.cells, group.kinds, group.headers) !== undefined);
    return codelessFit(cells, columnKinds, lastHeaderCells) !== undefined;
  };
  const readCodelessCells = (cells: string[], lineIndex: number, kinds: ColumnKind[] | undefined = columnKinds, headers: string[] = lastHeaderCells, term?: { year?: number; season?: Season } | null): boolean => {
    const fit = codelessFit(cells, kinds, headers);
    if (!fit) return false;
    const { titleAt, titleTokens, post } = fit;
    const values = cells.slice(titleAt + 1).map((c) => (PLACEHOLDER_TOKEN_RE.test(c.trim()) ? undefined : c.trim()));
    const into: RowScan = { titleParts: [] };
    const mapped = readMappedValues(post, headers.slice(titleAt + 1), values, titleTokens, {}, into);
    if (!mapped) return false; // neither a credit value nor a grade
    if (transferBlock !== undefined) {
      codelessSkipped += 1;
      return true;
    }
    if (inProgressBlock && into.grade === undefined && into.rawGrade === undefined) into.grade = 'IP';
    const rowTerm = mapped.year !== undefined || mapped.season !== undefined ? mapped : (term ?? preTitleTerm(cells.slice(0, titleAt), headers.slice(0, titleAt)));
    const confidence = confidences?.[lineIndex];
    const oddCredits = confidences !== undefined && into.credits !== undefined && (into.credits * 2) % 1 !== 0;
    // `term === null`: the side-by-side reader cannot tell which term a
    // half-row belongs to — the term stays blank for the student.
    const year = term === null ? undefined : (rowTerm?.year ?? currentYear);
    const season = term === null ? undefined : rowTerm?.year !== undefined || rowTerm?.season !== undefined ? rowTerm?.season : currentSeason;
    pushCodeless(
      {
        title: into.titleParts.join(' ').slice(0, 90),
        credits: into.credits,
        grade: into.grade,
        rawGrade: into.rawGrade,
        year,
        season,
        lowConfidence: (confidence !== undefined && confidence < OCR_CONFIDENCE_FLOOR) || oddCredits ? true : undefined,
        ...(ocrLines ? { sourceLines: { from: lineIndex, to: lineIndex } } : {}),
      },
      mapped.level,
    );
    return true;
  };
  /** Shape 2 — Evergreen's credit breakdown: a program line (start and end
   * month, its credits, its title — "09/2004   06/2005   44   Introduction
   * to Natural Science") followed by lines "13 - General Chemistry with
   * Laboratory", "*6 - Organic Chemistry with Laboratory" (the asterisk marks
   * upper-division credit) whose credits add up EXACTLY to the program's.
   * Those lines are the courses — credits from the leading number, no grade
   * (Evergreen writes narrative evaluations), the term the program started
   * in — and the program line is their total, not a row. A list that does
   * not add up is read as nothing. Returns the last line consumed. */
  const PROGRAM_LINE_RE = /^(\d{1,2})\/((?:19|20)\d{2})\s{2,}\d{1,2}\/(?:19|20)\d{2}\s{2,}(\d{1,3}(?:\.\d{1,2})?)\s{2,}(\p{L}.*)$/u;
  const BREAKDOWN_LINE_RE = /^\*?\s*(\d{1,2}(?:\.\d{1,2})?)\s+[-–]\s+(\p{L}.*)$/u;
  const readCreditBreakdown = (flat: string, lineIndex: number): number | undefined => {
    const program = PROGRAM_LINE_RE.exec(flat);
    if (!program || Number(program[1]) < 1 || Number(program[1]) > 12) return undefined;
    const parts: { credits: number; title: string; at: number }[] = [];
    for (let j = lineIndex + 1; j < lines.length; j++) {
      const m = BREAKDOWN_LINE_RE.exec(lines[j]!.replace(/\s+/g, ' ').trim());
      if (!m) break;
      const title = m[2]!.trim();
      if (!courseLikeTitle(title.split(' ')) || NOT_COURSE_TITLE_RE.test(title)) break;
      parts.push({ credits: Number(m[1]), title, at: j });
    }
    const total = Number(program[3]);
    const sum = parts.reduce((n, p) => n + p.credits, 0);
    if (parts.length === 0 || Math.abs(sum - total) > 0.001) return undefined;
    const last = parts[parts.length - 1]!.at;
    if (transferBlock !== undefined) {
      codelessSkipped += parts.length;
      return last;
    }
    const start = termOfDate(`${program[2]}-${program[1]!.padStart(2, '0')}-15`);
    for (const p of parts) {
      const confidence = confidences?.[p.at];
      pushCodeless({ title: p.title.slice(0, 90), credits: p.credits, year: start.year, season: start.season, lowConfidence: confidence !== undefined && confidence < OCR_CONFIDENCE_FLOOR ? true : undefined, ...(ocrLines ? { sourceLines: { from: p.at, to: p.at } } : {}) }, undefined);
    }
    return last;
  };
  /** A line with no course code: one of the two code-less shapes, or nothing.
   * Returns the index of the last line consumed. */
  const readCodelessRow = (line: string, flat: string, lineIndex: number): number => {
    if (termLineHere) return lineIndex;
    const breakdown = readCreditBreakdown(flat, lineIndex);
    if (breakdown !== undefined) return breakdown;
    // CC16: a side-by-side table splits each row at its second group; the
    // left half is read under the first term the semester line names, the
    // right half under the second. A line with one group's cells is a course
    // of either column — the text does not say which — so its term is left
    // blank for the student (null), never guessed.
    const group = sideBySide();
    if (group) {
      for (const half of sideBySideHalves(flat.split(/\s{2,}/), group)) {
        const term = half.side === undefined || semesterColumns?.length !== 2 ? null : semesterColumns[half.side]!;
        readCodelessCells(half.cells, lineIndex, group.kinds, group.headers, term);
      }
      return lineIndex;
    }
    readCodelessCells(flat.split(/\s{2,}/), lineIndex);
    return lineIndex;
  };
  /** The junk-code guard (OCR plan step 2.5, 2026-10-09). On a line the
   * engine read with low confidence (under OCR_CONFIDENCE_FLOOR — the lines
   * whose rows the preview flags), the cell path took junk for a course on
   * the registrar keys and forms the bench degrades: a word set in lower case
   * ("ec   20   55 - 59 %", "fot ta   12 db"), a number from a grade table
   * ("3837.3635   A   granied.", "2430.24   P   Pass. Work that…") or specks
   * read as a title ("Tc 23   i   fF   &   &   Fd", "343332   Br   N   Fis
   * ing   C"). A row on such a line is refused when
   *  (1) its subject is printed all in lower case with a letter whose capital
   *      has another shape (a b d e f g h i j l m n q r t y) — "cs", "soc",
   *      "sw" stay: the engine reads those capitals small; a subject with a
   *      capital is left alone (Addis Ababa prints "Math 1011", "Phys 1011");
   *  (2) its code of digits is a decimal number in its cell ("3837.3635":
   *      the pattern took "3837" and left ".3635"; "15.000");
   *  (3) its title holds no word of four letters or more.
   * Measured (DECISIONS 2026-10-09): no row of the 62 bench seeds, nor of ten
   * numeric-code and title-case layouts rendered and scanned, is lost; a
   * stricter (2) — a numeric code needs its credits — cost real rows whose
   * credits the scan misread, and a stricter (1) — any lower-case letter —
   * cost Addis Ababa's rows. A line read with confidence keeps every reading
   * it had; a text layer is never touched — a scanner's own embedded layer
   * included (review fix 2026-10-10: read at confidence 0, it switched the
   * guard on for every row). The refused row is not guessed at:
   * a course the scan could not show is the student's to add. */
  const ocrJunkCode = (lead: NonNullable<Lead>, into: RowScan): boolean => {
    const subject = lead.printed.replace(/[^A-Za-z ].*$/, '').trim();
    if (/[abd-jlmnqrty]/.test(subject) && !/[A-Z]/.test(subject)) return true;
    if (lead.decimalCell) return true;
    return !into.titleParts.some((w) => /\p{L}{4}/u.test(w));
  };
  /** One row's tokens after its code, read: by the header's columns when the
   * row fits them (`scanWithMap`), else by the position-free scan after a
   * leading UG/GR level cell. `tokens` are the ones the scan read (the level
   * cell taken off). */
  type LeadScan = { into: RowScan; mapped: ReturnType<typeof scanWithMap>; rowLevel?: Level; tokens: string[] };
  const scanLead = (tokens: string[]): LeadScan => {
    const into: RowScan = { titleParts: [] };
    const mapped = scanWithMap(tokens, into);
    if (mapped) return { into, mapped, ...(mapped.level !== undefined ? { rowLevel: mapped.level } : {}), tokens };
    let rest = tokens;
    let rowLevel: Level | undefined;
    if (rest.length > 0 && ROW_LEVEL_RE.test(rest[0]!)) {
      rowLevel = /^U/.test(rest[0]!) ? 'undergraduate' : 'graduate';
      rest = rest.slice(1);
    }
    scanTokens(rest, into);
    return { into, mapped: undefined, ...(rowLevel !== undefined ? { rowLevel } : {}), tokens: rest };
  };
  /** The OCR numeric correction of one row (Batch C answer (4), DGS
   * 2026-10-09). Each token `ocrCellCorrection` would rewrite is rewritten and
   * the row read again; that second reading is kept ONLY when
   *  - it fills the row's credits, or its grade, that the scan's own reading
   *    (`raw`) left empty, from a corrected token — never a value the raw
   *    reading already had ("Course I1   5.00": a "II" misread in a title
   *    would become 11 credits; the raw reading's 5.00 stands);
   *  - every other value is the raw reading's; and
   *  - the title is the raw reading's word for word, less only the corrected
   *    tokens a raw reading took into it ("Operating Systems l.0" → "Operating
   *    Systems" with 1.0 credits) — no corrected form ever lands in a title, and
   *    no title word is ever rewritten.
   * Returns the kept reading with the raw text of each corrected cell, or
   * undefined (the raw reading stands, as do the header's grade counts it
   * made). Codes, titles, names and the university are never touched: the
   * code is read before the tokens, and the rest is not a cell. */
  const ocrCorrectedScan = (tokens: string[], raw: LeadScan, headerGradesBefore: { letters: number; numbers: number }): { scan: LeadScan; read: { credits?: string; grade?: string } } | undefined => {
    const fixes = tokens.map((t) => ocrCellCorrection(t));
    if (!fixes.some((f) => f !== undefined)) return undefined;
    const afterRaw = { ...headerGrades };
    headerGrades = { ...headerGradesBefore };
    const fixed = scanLead(tokens.map((t, i) => fixes[i] ?? t));
    const rawOf = (text: string | undefined): string | undefined => {
      const i = text === undefined ? -1 : fixes.indexOf(text);
      return i >= 0 ? tokens[i] : undefined;
    };
    const a = raw.into;
    const b = fixed.into;
    const creditsRead = a.credits === undefined && b.credits !== undefined ? rawOf(b.creditsText) : undefined;
    const gradeRead = a.grade === undefined && a.rawGrade === undefined && (b.grade !== undefined || b.rawGrade !== undefined) ? rawOf(b.gradeText) : undefined;
    const creditsKept = creditsRead !== undefined || b.credits === a.credits;
    const gradeKept = gradeRead !== undefined || (b.grade === a.grade && b.rawGrade === a.rawGrade);
    // Only a decimal ("l.0") or a grade ("Bt") may leave the title the raw
    // reading put it in — a whole number there is the title's own numeral,
    // never the credits (review fix 2026-10-10: "Calculus I1" had become 11
    // credits; `ocrCellCorrection` now refuses that token too).
    const leavesTitle = new Set(tokens.filter((t, i) => fixes[i] !== undefined && (/[.,]/.test(t) || /^[A-D]t$/.test(t))));
    const titleKept = b.titleParts.join('\u0000') === a.titleParts.filter((t) => !leavesTitle.has(t)).join('\u0000');
    if ((creditsRead === undefined && gradeRead === undefined) || !creditsKept || !gradeKept || !titleKept) {
      headerGrades = afterRaw;
      return undefined;
    }
    return { scan: fixed, read: { ...(creditsRead !== undefined ? { credits: creditsRead } : {}), ...(gradeRead !== undefined ? { grade: gradeRead } : {}) } };
  };
  const readCourseRow = (line: string, flat: string, lead: Lead, lineIndex: number): number => {
    // The row line's own confidence, before a title line below it is consumed.
    const rowConfidence = confidences?.[lineIndex];
    // …and its index, for the lines the row is read from (`sourceLines`).
    const rowLine = lineIndex;
    if (flat.length < 6) return lineIndex;
    // The course code is expected at the start of the row (or right after a
    // leading term/date cell). Column gaps are unreliable across layouts, so
    // the rest of the line is TOKENIZED: credits and grade are searched among
    // the tokens after the title; the title is the leading run of wordy tokens.
    // A line with no code may still be a code-less course (CC15, Batch C).
    if (!lead) return readCodelessRow(line, flat, lineIndex);
    // An exemption row has no title: a code and "EXC" or a number. The first
    // row with a title ends the block and is read as the university's own.
    const bareExemption = transferBlock === 'exemptions' && !lead.tokens.some((t) => /[\p{L}]{2}/u.test(t) && !/^[A-Z]{1,4}$/.test(t));
    if (transferBlock === 'exemptions' && !bareExemption) transferBlock = undefined;
    if (transferBlock !== undefined) {
      transferRowsSkipped += 1;
      return lineIndex;
    }
    // The header's column order first (2026-09-26); the position-free scan
    // when there is no header or the row does not fit it.
    const headerGradesBefore = { ...headerGrades };
    let scan = scanLead(lead.tokens);
    // OCR numeric corrections (Batch C answer (4), DGS 2026-10-09): on an OCR
    // line, a credits or grade cell the scan printed with a letter for a digit
    // ("3.O", "Bt") is read corrected — only where that fills what the scan's
    // own reading left empty (`ocrCorrectedScan`); the row is then flagged and
    // the preview shows the raw reading beside the value.
    let ocrRead: ExternalCourseCandidate['ocrRead'];
    if (ocrLines) {
      const corrected = ocrCorrectedScan(lead.tokens, scan, headerGradesBefore);
      if (corrected) ({ scan, read: ocrRead } = corrected);
    }
    const { into, mapped } = scan;
    const rowLevel: Level | undefined = scan.rowLevel;
    let cellTerm: { year?: number; season?: Season } | undefined;
    // A term cell before the code (Unicamp "1S/2022   MO 417   …").
    if (lead.preCell !== undefined && !lead.date) {
      const pre = rowTermOf([lead.preCell]);
      if (pre.year !== undefined) cellTerm = pre;
    }
    if (mapped && (mapped.year !== undefined || mapped.season !== undefined)) cellTerm = { year: mapped.year ?? cellTerm?.year, season: mapped.season ?? cellTerm?.season };
    // Lines a course row never looks like (the registrar keys and regulations
    // that travel as a transcript's back page, 2026-09-26): a program line
    // ("3500   BACHELOR OF CLASSES", the ANU sample), an address or e-mail
    // line, a title that ends in a comma, and prose — six words or more
    // with two of the function words no course title uses ("students were
    // admitted in a batch and there were 8 repeaters").
    if (!courseLikeTitle(into.titleParts)) return lineIndex;
    let usedContinuation = false;
    if (into.credits === undefined && into.grade === undefined && into.rawGrade === undefined) {
      // Two-line rows (2026-09-04): some registrars print the code + title on
      // one line and the numbers on the next. If the NEXT line has no code of
      // its own, few tokens, and yields a credit or grade, treat it as this
      // row's continuation.
      const next = lines[lineIndex + 1]?.replace(/\s{2,}/g, '  ').trim();
      if (next && next.length >= 1 && !leadCode(next) && !TOTALS_LINE_RE.test(next)) {
        const nextTokens = tokensOf([next]);
        // The continuation holds the row's NUMBERS: a next line of words is
        // the following prose sentence, not this row's credits (2026-09-26).
        const nextWordy = nextTokens.filter((tk) => /[\p{L}]{2}/u.test(tk)).length;
        const numbersOnly = into.titleParts.length > 0 && nextTokens.length <= 8 && nextWordy <= 3;
        // Two shapes more (F1a, transcript accuracy program, 2026-10-09), each
        // taken ONLY when the next line ENDS in the credits and a grade token
        // — so a sentence that merely mentions a number is still refused:
        // (i) a code printed alone on its line, with the title and the
        // numbers on the next ("CS 500" / "Advanced Topics   3   A"); (ii) a
        // wrapped title whose continuation carries four or more words
        // ("Systems and Cloud Infrastructure Design   3   A").
        const tailGrade = nextTokens.length <= 12 ? tailGradeToken(nextTokens) : undefined;
        const codeAlone = into.titleParts.length === 0 && scan.tokens.length === 0 && nextWordy >= 1 && tailGrade !== undefined;
        const wrappedTitle = into.titleParts.length > 0 && nextWordy >= 4 && tailGrade !== undefined;
        if (numbersOnly || codeAlone || wrappedTitle) {
          const probe = { titleParts: [...into.titleParts], credits: undefined, grade: undefined, rawGrade: undefined } as RowScan;
          scanTokens(nextTokens, probe);
          const read = probe.credits !== undefined || probe.grade !== undefined || probe.rawGrade !== undefined;
          // The two new shapes must yield the credits AND a grade token, and
          // a title that reads as a course's — and, since the 2026-10-09
          // review (a footnote after a code line read as its row: "Approved
          // for graduate credit by petition   3   B+" gave grade S from
          // "Approved", "Credits applied toward the degree this semester
          // 12   3.5" gave credits 12), the grade must be the line's last
          // grade cell (tailGrade), never a pass or grade WORD read earlier
          // in it, and the words the continuation adds to the title may hold
          // no function word at all (PROSE_WORD_RE): a sentence says "from",
          // "by", "this", "is"; a course title that does ("Learning from
          // Data") is three words, which the numbers-only rule still reads.
          const added = probe.titleParts.slice(into.titleParts.length).map((w) => w.replace(/[^\p{L}]/gu, ''));
          const whole =
            probe.credits !== undefined &&
            (probe.grade !== undefined || probe.rawGrade !== undefined) &&
            probe.gradeText === tailGrade &&
            probe.titleParts.length > 0 &&
            courseLikeTitle(probe.titleParts) &&
            !added.some((w) => PROSE_WORD_RE.test(w));
          if (numbersOnly ? read : whole) {
            into.credits = probe.credits;
            into.grade = probe.grade;
            into.rawGrade = probe.rawGrade;
            into.titleParts = probe.titleParts;
            usedContinuation = true;
          }
        }
      }
    }
    // A candidate needs a code plus at least a credit value or a grade —
    // otherwise it is a header/footer line that happened to start with a code.
    if (into.credits === undefined && into.grade === undefined && into.rawGrade === undefined) return lineIndex;
    // UCLA's one-digit course numbers alone in their cell ("PHYSICS 1A",
    // "ENGCOMP 3"; item 14): on a scan a digit alone in its cell is as often a
    // misread or a stray mark — Duke's grade key "LP 2.5" read "LP 2S", the
    // legend lines "RE 1" and "HPAL 6" on Tokyo's grading page (item 13's
    // full-ladder check, 2026-10-11) — so there such a row needs its credits
    // AND a grade, or an in-progress term, as every real row of UCLA's has.
    if (ocrLines && /^[A-Z]{2,10} \d[A-Z]{0,2}$/.test(lead.code) && (into.credits === undefined || (into.grade === undefined && !inProgressBlock))) return lineIndex;
    // A row graded TR is credit transferred in from another school (item 14,
    // 2026-10-11): Colleague prints such rows among the student's own, under
    // no transfer heading ("MATH-1200   Calculus I   TR   4.00   2021FA").
    // Left out like a transfer block's rows — the course belongs on its own
    // school's transcript — and counted in the note that says so.
    if ((into.rawGrade ?? into.gradeText ?? '').toUpperCase() === 'TR' && into.grade === undefined) {
      transferRowsSkipped += 1;
      return lineIndex;
    }
    // A row printed without its title, or with an unreadable one (a bilingual
    // transcript's non-Latin title), takes the plain wordy line just above
    // and/or the one after the row (after a consumed continuation line).
    const unreadable = into.titleParts.length > 0 && (into.titleParts.join(' ').match(/[\p{L}]/gu) ?? []).length < 4;
    let titleAbove = false;
    let titleBelow = false;
    if (into.titleParts.length === 0 || unreadable) {
      const before = plainTitleLine(lines[lineIndex - 1]);
      const after = plainTitleLine(lines[lineIndex + (usedContinuation ? 2 : 1)]);
      const found = [before, after].filter((t): t is string => t !== undefined);
      if (found.length > 0) {
        into.titleParts = found.join(' ').split(' ');
        titleAbove = before !== undefined;
        titleBelow = after !== undefined;
        if (after !== undefined) lineIndex += 1; // consumed as a title, never as a row
      }
    }
    // Our engine's low-confidence lines only — never a scanner's own layer
    // (`ExternalParseOptions.scannerLayer`, review fix 2026-10-10).
    if (ocrLines && options.scannerLayer !== true && rowConfidence !== undefined && rowConfidence < OCR_CONFIDENCE_FLOOR && ocrJunkCode(lead, into)) return lineIndex;
    if (inProgressBlock && into.grade === undefined && into.rawGrade === undefined) into.grade = 'IP';
    const confidence = confidences?.[lineIndex];
    // OCR-only sanity check: real credit values come in half-credit steps, so
    // "3.6" is a misread ("3.0" with a 0→6 confusion) — flag, never silently fix.
    const oddCredits = confidences !== undefined && into.credits !== undefined && (into.credits * 2) % 1 !== 0;
    // The row's own year, if it prints one — with the course code removed
    // first, so "CSCI 2018" is never read as the year 2018 (2026-09-05).
    const codeDigits = lead.code.replace(/^[A-Z ]+[- ]?/, '');
    const withoutCode = (text: string) => text.replace(codeDigits, ' ');
    const yearLine = withoutCode(usedContinuation ? `${line} ${lines[lineIndex + 1] ?? ''}` : line);
    // A year inside the title ("Lab for CS 2000", 2026-09-20) is not the row's.
    const yearMatch = YEAR_RE.exec(yearLine);
    // A date on the row (a semester-ending date before the code, a result
    // date after the grade — KTH, Peradeniya, 2026-09-26) places the row by
    // termOfDate when no term header covers it; a header's year is never
    // overridden by a row's date.
    const rowDate = lead.date ? (dateOnLine(lead.date) ?? isoOrEuropeanDate(lead.date)) : isoOrEuropeanDate(yearLine) ?? (currentYear === undefined ? dateOnLine(yearLine) : undefined);
    if (cellTerm === undefined && rowDate !== undefined && (currentYear === undefined || lead.date !== undefined)) {
      const t = termOfDate(rowDate);
      cellTerm = { year: t.year, season: t.season };
    }
    const rowYear = cellTerm === undefined && rowDate === undefined && yearMatch && !into.titleParts.includes(yearMatch[1]!) ? yearMatch : null;
    courses.push({
      // "CS5321" / "CS-5321" → "CS 5321". Subject words are two letters or
      // more, so Columbia's "COMS W4111" keeps its capital on the number.
      // "CS5321" / "CS-5321" → "CS 5321". A second word of one or two letters is
      // part of the number (Columbia "COMS W4111", BITS "SS ZG519"), and
      // IIIT Hyderabad's "CS1.301" stays as printed (2026-09-26).
      courseId: /^[A-Z]{2}\d\.\d{3}$/.test(lead.code) ? lead.code : lead.code.replace(/^([A-Z]{2,}(?: [A-Z]{3,})?)[- ]?(\d{2,})/, '$1 $2'),
      title: into.titleParts.join(' ').slice(0, 90) || undefined,
      credits: into.credits,
      grade: into.grade,
      rawGrade: into.rawGrade,
      // Inside a FALL/WINTER session a course number's suffix names its term
      // (Western's calendar, item 14, 2026-10-11): B, G, S and T are the second
      // term — the winter, read as the spring of the session's second year —
      // while A, F, Q, R (the first term) and E, Y, Z (the whole year) keep the
      // session's fall.
      ...(cellTerm === undefined && !rowYear && fallWinterSession !== undefined && /\d[BGST]$/.test(lead.code)
        ? { year: fallWinterSession + 1, season: 'spring' as const }
        : {
            year: cellTerm?.year ?? (rowYear ? Number(rowYear[1]) : currentYear),
            season: cellTerm?.season ?? (rowYear ? (seasonOf(yearLine) ?? currentSeason) : currentSeason),
          }),
      // A corrected cell keeps the row flagged (Batch C answer (4)).
      lowConfidence: (confidence !== undefined && confidence < OCR_CONFIDENCE_FLOOR) || oddCredits || ocrRead !== undefined ? true : undefined,
      ...(ocrRead !== undefined ? { ocrRead } : {}),
      ...(ocrLines ? { sourceLines: { from: rowLine - (titleAbove ? 1 : 0), to: rowLine + (usedContinuation ? 1 : 0) + (titleBelow ? 1 : 0) } } : {}),
    });
    // A digit look-alike in the course number, on a scan or a scanner's layer
    // only: offered to the student, never applied (DGS 2026-10-12).
    if (ocrLines) {
      const last = courses[courses.length - 1]!;
      const suggestion = codeLookalikeSuggestion(last.courseId);
      if (suggestion !== undefined) {
        last.codeSuggestion = suggestion;
        last.lowConfidence = true;
      }
    }
    rowLevels.push(rowLevel ?? blockLevel);
    rowBlocks.push(termBlock);
    if (usedContinuation) lineIndex += 1; // the continuation line is consumed
    return lineIndex;
  };
  // The document's own Banner term key, read from every line that is not a
  // course row, BEFORE the rows — a legend printed after them names their
  // codes too (review 2026-10-09).
  for (const l of lines) if (!leadCode(l.replace(/\s{2,}/g, '  ').trim())) readBannerTermKey(l);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex]!;
    trackTermAndTransfer(line);
    const flat = line.replace(/\s{2,}/g, '  ').trim();
    // The transcript's own totals (item 11, 2026-10-11): recorded for the
    // preview's check, never a course row.
    readPrintedTotals(flat);
    // The course code at the row's start, read once: the level and degree
    // tests below ask whether the line is a course row, and the row reader
    // needs the tokens.
    const lead = leadCode(flat);
    if (!lead) {
      const header = readColumnHeader(flat, ocrLines);
      if (header) {
        columnKinds = header;
        headerGrades = { letters: 0, numbers: 0 };
        if ((globalThis as any).__DEBUG_COLUMNS) console.log('HEADER', JSON.stringify(flat), header);
        continue;
      }
      // A header printed on two lines (F6, 2026-10-09): this line holds the
      // top halves of the next line's column words.
      const nextFlat = lines[lineIndex + 1]?.replace(/\s{2,}/g, '  ').trim();
      const joined = nextFlat !== undefined && !leadCode(nextFlat) ? joinedHeaderKinds(flat, nextFlat, ocrLines) : undefined;
      if (joined) {
        columnKinds = joined;
        headerGrades = { letters: 0, numbers: 0 };
        if ((globalThis as any).__DEBUG_COLUMNS) console.log('HEADER (two lines)', JSON.stringify(flat), JSON.stringify(nextFlat), joined);
        lineIndex += 1;
        continue;
      }
    }
    if (readLevelMarkers(flat, lead)) continue;
    readDegreeSignals(flat, lead, lineIndex);
    lineIndex = readCourseRow(line, flat, lead, lineIndex);
  }
  // CC15: a document that prints a course number on any row has no
  // code-less courses — a line there without a code is a total, a remark or
  // another school's credit — so the code-less rows go (and so do the
  // transfer lines of that shape the count would otherwise report).
  if (courses.some((c) => !c.codeMissing)) {
    for (let i = courses.length - 1; i >= 0; i--) {
      if (courses[i]!.codeMissing) {
        courses.splice(i, 1);
        rowLevels.splice(i, 1);
        rowBlocks.splice(i, 1);
      }
    }
  } else transferRowsSkipped += codelessSkipped;
  // Ladok's module lines (item 14, 2026-10-11): under a course, its parts
  // print with a four-digit module code ("EDAN70   Project in Computer
  // Science   7.5 hp   G" and then "0107   Project report   4.5 hp   G").
  // In a document whose course codes lead with letters, a row whose whole
  // code is four digits is such a part, never a course of its own (UNAM's
  // all-numeric "0001" codes are a document of numeric codes, untouched).
  const letterLed = courses.filter((c) => /^[A-Z]/.test(c.courseId)).length;
  if (courses.length >= 5 && letterLed / courses.length >= 0.8) {
    const moduleCode = (i: number): boolean => /^\d{4}$/.test(courses[i]!.courseId);
    for (let i = courses.length - 1; i >= 0; i--) {
      let above = i - 1;
      while (above >= 0 && moduleCode(above)) above -= 1; // a course's modules print one after another
      if (moduleCode(i) && above >= 0 && /^[A-Z]/.test(courses[above]!.courseId)) {
        courses.splice(i, 1);
        rowLevels.splice(i, 1);
        rowBlocks.splice(i, 1);
      }
    }
  }
  // Per-row level (2026-09-05): the row's or block's own marker first; else,
  // with a dated bachelor's conferral, the row's term against that date; else
  // the closing totals line's level.
  const conferralTerm = bachelorsConferredOn ? termOfDate(bachelorsConferredOn) : undefined;
  courses.forEach((c, i) => {
    let level = rowLevels[i];
    if (level === undefined && conferralTerm && c.year !== undefined) {
      if (c.season !== undefined) level = termIndex({ season: c.season, year: c.year }) <= termIndex(conferralTerm) ? 'undergraduate' : 'graduate';
      else if (c.year !== conferralTerm.year) level = c.year < conferralTerm.year ? 'undergraduate' : 'graduate';
    }
    if (level === undefined && retroLevel !== undefined && rowLevels.every((l) => l === undefined)) level = retroLevel;
    if (level !== undefined) c.level = level;
  });
  const levels = new Set(courses.map((c) => c.level).filter((l) => l !== undefined));
  // Adjacent-line graduate conferral (DGS 2026-10-09, transcript accuracy
  // program Batch C, answer (3) — it supersedes the 2026-09-03 same-line
  // rule for this labelled shape ONLY): a "Degree:" cell naming a graduate
  // degree, and on the line right above or below it a "Date of Graduation:"
  // cell with a date that reads ("Degree: Master of Engineering" / "Date of
  // Admission: August 2022   Date of Graduation: 30 June 2024", the
  // Chulalongkorn layout). BOTH labels are required: a "Program:" line, a
  // "Date of Admission:" alone, a date two lines away or a forecast
  // ("Expected Date of Graduation") is no evidence.
  // Review fix (2026-10-10): the label's value is its own cell's text or, when
  // that is empty, the NEXT cell only if that cell is no label itself —
  // "Date of Graduation:   Date of Issue: 15 March 2024" leaves the graduation
  // date empty; it never borrows the issue date. And the value must be a date
  // and nothing else (`bareDate`): "Withdrawn 2023-06-30" holds a date but
  // says the student left, so it is no conferral either.
  const LABEL_CELL_RE = /^[^:]{1,40}:(?:\s|$)/;
  const labelledCell = (line: string, label: RegExp): string | undefined => {
    const cells = line.split(/\s{2,}/).map((c) => c.trim());
    for (let i = 0; i < cells.length; i++) {
      const m = label.exec(cells[i]!);
      if (!m) continue;
      const own = m[1]!.trim();
      if (own !== '') return own;
      const next = (cells[i + 1] ?? '').trim();
      return LABEL_CELL_RE.test(next) ? '' : next;
    }
    return undefined;
  };
  const MONTH_WORD_RE = /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b\.?/gi;
  /** A value that reads as a date and holds nothing but the date: digits,
   * month names, ordinal endings and separators. */
  const bareDate = (value: string): boolean =>
    dateOnLine(value) !== undefined &&
    value
      .replace(MONTH_WORD_RE, ' ')
      .replace(/(\d)(?:st|nd|rd|th)\b/gi, '$1')
      .replace(/[\d\s,./-]/g, '') === '';
  const adjacentConferral = lines.some((l, i) => {
    const degree = labelledCell(l, /^degree\s*:\s*(.*)$/i);
    if (degree === undefined || !gradDegreeNameIn(degree) || NOT_AWARDED_RE.test(l) || NOT_YET_RE.test(l) || NOT_COMPLETE_RE.test(l) || NOT_CONFERRED_STATUS_RE.test(l)) return false;
    return [lines[i - 1], lines[i + 1]].some((n) => {
      if (n === undefined || NOT_YET_RE.test(n)) return false;
      const date = labelledCell(n, /^date\s+of\s+graduation\s*:\s*(.*)$/i);
      return date !== undefined && bareDate(date);
    });
  });
  const degreeConferred =
    blockConferredGrad ||
    lines.some((l) => saysConferred(l) && gradDegreeIn(l) && !NOT_COMPLETE_RE.test(l) && !NOT_CONFERRED_STATUS_RE.test(l)) ||
    adjacentConferral ||
    undefined;
  // Quarter system (2026-09-11): the word "quarter" in a term header ("Fall
  // Quarter 2023", "Autumn Qtr 2023 Graduate") or in a credits heading
  // ("Quarter Units", "Qtr Hrs"). Nothing weaker — a lone "Winter" term can be
  // a January session on a semester calendar. Two more shapes (DGS 2026-09-20):
  // term headers that use Autumn AND Winter AND Spring (a three-season year is
  // a quarter calendar; a semester school says Fall), and WPI's lettered
  // seven-week terms (two or more of A–D).
  const legendIndex = lines.findIndex((l) => /^\s*(?:transcript\s+key|legend|key\s+to\s+(?:the\s+)?transcript|guide\s+to\s+transcript|explanation\s+of\s+(?:the\s+)?transcript|grading\s+(?:system|scale|key))\b/i.test(l.replace(/\s{2,}/g, ' ').trim()));
  const legendStart = legendIndex < 0 ? lines.length : legendIndex;
  // A term's GPA labelled with the term's name, printed with its value
  // ("Trimester GPA: 3.47", North South University; DGS 2026-10-10, answer
  // 4c) is the registrar saying what its terms are — read for quarters too,
  // so the two calendars are read alike. Only the label with a number after
  // it, before any legend: a key's sentence ("three academic terms in each
  // academic year in the trimester system", "prior transcripts show quarter
  // hours") may describe another era, and is not read.
  const termGpaLabel = (word: RegExp): boolean => {
    const label = new RegExp(`${word.source}\\s+(?:g\\.?\\s?p\\.?\\s?a\\.?|grade\\s+point\\s+average)\\s*:?\\s*\\d`, 'i');
    return lines.slice(0, legendStart).some((l) => label.test(l));
  };
  const termHeaders = lines.filter((l) => TERM_WORD_RE.test(l) && YEAR_RE.test(l) && l.replace(/\s{2,}/g, ' ').length < 60);
  const autumnWinterSpring = [/\bautumn\b/i, /\bwinter\b/i, /\bspring\b/i].every((re) => termHeaders.some((l) => re.test(l)));
  const wpiTerms = new Set(termHeaders.map((l) => WPI_TERM_RE.exec(l)?.[1]?.toUpperCase()).filter((t) => t !== undefined));
  const quarterSystem =
    lines.some((l) => /\b(fall|spring|summer|autumn|winter)\s+(quarter|qtr)\b/i.test(l) && YEAR_RE.test(l)) ||
    // A credits heading that says quarter — a column header or a short label,
    // never legend prose ("prior transcripts show quarter hours", Utah / Ohio
    // State keys, 2026-09-26) and nothing at or after a legend heading.
    lines.slice(0, legendStart).some((l) => /\b(quarter|qtr)\s+(units?|hours?|hrs?|credits?)\b/i.test(l) && l.replace(/\s{2,}/g, ' ').trim().length < 60 && !/\b(is|are|was|were|show|shown|prior|converted|conversion|equal|equals)\b/i.test(l)) ||
    autumnWinterSpring ||
    wpiTerms.size >= 2 ||
    termGpaLabel(/\b(?:quarter|qtr)/i) ||
    // A key that says this record's credits ARE quarter hours — Oregon's
    // "Undergraduate and graduate credits are recorded in quarter hours"
    // (item 14, 2026-10-11) — in the present tense, never "prior …".
    lines.some((l) => /\bcredits?\s+(?:are|is)\s+(?:recorded|given|reported|expressed)\s+in\s+quarter\s+(?:hours|units|credits)\b/i.test(l) && !/\b(prior|before|until|converted|conversion)\b/i.test(l))
      ? (true as const)
      : undefined;
  const trimesterSystem =
    !quarterSystem &&
    (lines.some((l) => /\b(fall|spring|summer|autumn|winter)\s+(trimester|tri)\b/i.test(l) && YEAR_RE.test(l)) ||
      lines.some((l) => /\btrimester\s+(units?|hours?|hrs?|credits?)\b/i.test(l)) ||
      termGpaLabel(/\btrimester/i))
      ? (true as const)
      : undefined;
  // Spelled out for everyone who reads it (DGS 2026-09-08): the student,
  // the DGS review request and the Grad Admin processing request.
  const named = withCampus(guessedUniversity(lines), lines);
  // "Is this a transcript at all?" (DGS 2026-10-10, answer 4a — the gate
  // proposed on 2026-10-09, adopted as proposed): ONE course row, no
  // institution named and no GPA or totals line is a course outline, not a
  // record (the McGill project's outline page read "COMP 250 001 Intro to
  // Computer Science 3" as a course). Its row is not offered; the cost the
  // DGS accepted is that a one-course transcript with neither a name nor a
  // total is typed by hand. A text layer only: a scan's rows are all kept.
  // "Names no institution" is read widely (review, 2026-10-10): besides a
  // name the reader recognised, any short line with an institution word or a
  // record title ("UCLA Extension", "Georgia Tech", "Official Transcript")
  // keeps the row, and so does a transfer row the parser set aside — the
  // document then printed more than one course.
  const notATranscript =
    !ocrLines &&
    courses.length === 1 &&
    transferRowsSkipped === 0 &&
    named.university === undefined &&
    !lines.some((l) => l.replace(/\s{2,}/g, ' ').trim().length < 60 && INSTITUTION_OR_RECORD_RE.test(l)) &&
    !lines.some((l) => RECORD_FIGURES_RE.test(l));
  // The totals lines with the rows each names (item 11).
  const totalsRead: PrintedTotals[] = printedTotals.map(({ block, ...t }) => (block === undefined ? t : { ...t, rows: rowBlocks.flatMap((b, i) => (b === block ? [i] : [])) }));
  // Cell evidence on a scan (DGS 2026-10-11, item 13). The engine's confidence
  // flags a line it read poorly; a confident misread — "3" read as "8", a
  // grade cell that took the credits' "3.0" — passes it. Three facts of the
  // document flag such a row all the same: a credit value no other row of the
  // document has (four rows or more); a mark that is not a grade the app
  // reads AND has a digit or a stray sign in it (a mark of letters alone —
  // McGill's K, L, NR, WL, Banner's NG — is one the school prints, not
  // evidence: flagging those cost 9–11 right rows for 1–2 wrong ones); a term
  // whose rows do not add up to the transcript's own totals line. Measured on
  // the OCR bench's medium set (L2 and L5, the other universities' documents,
  // the same OCR lines before and after): the wrong rows flagged rose from
  // two thirds to nearly nine in ten (L2 67.5 → 86.7 %, L5 65.8 → 88.6 %) at
  // no cost in flag precision (60.9 → 61.5 %, 66.7 → 66.7 %). A text layer is
  // never touched.
  if (confidences !== undefined && !notATranscript) {
    const counts = new Map<number, number>();
    for (const c of courses) if (c.credits !== undefined) counts.set(c.credits, (counts.get(c.credits) ?? 0) + 1);
    const withCredits = courses.filter((c) => c.credits !== undefined).length;
    const offTotals = new Set<number>();
    if (totalsRead.length > 0) {
      const aligned = courses.map((c) => (c.season !== undefined && c.year !== undefined && c.credits !== undefined ? { term: { season: c.season, year: c.year }, credits: c.credits, grade: c.grade ?? '' } : undefined));
      for (const m of checkTotals(aligned, totalsRead)) {
        const t = totalsRead.find((x) => x.scope === m.scope && x.term === m.term);
        for (const i of t?.rows ?? []) offTotals.add(i);
      }
    }
    courses.forEach((c, i) => {
      if (c.lowConfidence) return;
      const evidence = withCredits >= 4 && c.credits !== undefined && counts.get(c.credits) === 1 ? 'credits' : c.grade === undefined && c.rawGrade !== undefined && /[^\p{L}+\-\u2212 ]/u.test(c.rawGrade) ? 'mark' : offTotals.has(i) ? 'totals' : undefined;
      if (evidence) {
        c.lowConfidence = true;
        c.evidence = evidence;
      }
    });
  }
  return {
    ...(quarterSystem ? { quarterSystem } : {}),
    ...(trimesterSystem ? { trimesterSystem } : {}),
    hasTextLayer: true,
    looksLikeNotreDame,
    ...named,
    degreeConferred,
    bachelorsConferredOn,
    ...(bachelorsConferred || bachelorsConferredOn !== undefined ? { bachelorsConferred: true as const } : {}),
    ...(bachelorsNamed ? { bachelorsNamed: true as const } : {}),
    mixedLevels: levels.size > 1 ? true : undefined,
    transferRowsSkipped: transferRowsSkipped > 0 ? transferRowsSkipped : undefined,
    ...(notATranscript ? { notATranscript: true as const } : {}),
    ...(/\p{Script=Cyrillic}/u.test(allText) ? { nonLatinScript: true as const } : {}),
    ...(totalsRead.length > 0 && !notATranscript ? { printedTotals: totalsRead } : {}),
    courses: notATranscript ? [] : courses,
  };
}

/** A line any academic record prints and a course outline does not: a GPA,
 * a grade-point or quality-point figure, a total, a cumulative line, credits
 * or hours earned (the transcript gate, DGS 2026-10-10 answer 4a). Broad on
 * purpose — every match keeps a document's one row offered. */
const RECORD_FIGURES_RE =
  /\b(?:[cs]?gpa|[sc]pi|wam|g\.\s?p\.\s?a|qpa|grade\s+points?|quality\s+points?|totals?|cumulative|cum\.?\s+(?:gpa|credits?|hours?)|weighted\s+(?:average|percentage|mean)|average\s+(?:mark|grade|score|percentage)|(?:credits?|hours?|hrs|units?|ects)\s+(?:earned|attempted|passed|obtained)|earned\s+(?:credits?|hours?|hrs|units?))\b/i;
/** A short line naming an institution or a record (the transcript gate): a
 * name the university reader does not recognise still names one. */
const INSTITUTION_OR_RECORD_RE =
  /\b(?:universit\w*|universidad|universidade|università|college|institut\w*|school|extension|polytechnic|polytechnique|academy|tech|transcript|academic\s+record|record\s+of)\b/i;

/** One unreviewed course, pre-rendered for the review request (the caller
 * supplies the term label and slot label so this stays UI- and engine-free). */
interface ReviewRequestCourse {
  institution?: string;
  courseId: string;
  title?: string;
  credits: number;
  grade: string;
  termText: string;
  slotLabel?: string;
  /** The credit system the student's record carries for this course —
   * quarter or trimester, read from the transcript or chosen in the preview;
   * undefined = semester or not stated. Fills a Universities-tab row the
   * request suggests (DGS 2026-10-10). */
  creditSystem?: 'quarter' | 'trimester';
  /** The student chose `creditSystem` in the preview; the transcript reader
   * had not read it (DGS 2026-10-10, item 3) — the request says "I chose". */
  creditSystemChosen?: true;
  /** What the DGS is asked to do (engine/review.ts ReviewAsk, 2026-09-28).
   * Optional for older callers: then a new row is asked for when `unlisted`,
   * with no reply. */
  ask?: { needsRow: boolean; replyNeeded: boolean; decide: string[]; rulings?: string[] };
}

/** Shared assembly for the copy-ready review requests (decisions 2026-09-03).
 * The request goes to the DGS alone (DGS decision 2026-09-06 — the Grad
 * Admin is not part of the review). Two clipboard flavors are returned and
 * written together: `text` (tab-separated sheet rows, pipe-separated detail
 * rows) for plain-text contexts, and `html`, where every row set is a REAL
 * `<table>` — HTML email composers (Gmail etc.) flatten tab characters to
 * spaces, but a table survives the whole journey: app → email → the DGS
 * copies it → Google Sheets pastes it as cells. The course details are
 * tables too (DGS request 2026-09-06: easier to read than bullet lines). */
function buildReviewRequest(opts: {
  subject: string;
  /** Who decides: the ADGS on the MSCSE (§3.2; DGS 2026-09-11), the DGS on
   * the Ph.D. — the greeting's title (policy review round 3, P3-emails-5). */
  decider: 'DGS' | 'ADGS';
  intro: string;
  /** Extra context lines shown right under the intro (e.g. prior graduate study). */
  context: readonly string[];
  /** The numbered "Action requested" list (DGS 2026-09-28): what the reader
   * must do, grouped — a group with no items is skipped. Items are numbered
   * straight through the groups. */
  actions: readonly { heading: string; items: readonly string[] }[];
  /** Sheet-paste sections (one per tab); a section with no rows is skipped. */
  sections: readonly { rowsIntro: string; rows: readonly (readonly string[])[] }[];
  detailsTitle: string;
  /** Column headers of the detail tables. */
  detailHeaders: readonly string[];
  /** Detail rows grouped per transcript, each group a table under its heading. */
  detailGroups: readonly { heading: string; rows: readonly (readonly string[])[] }[];
  /** "Checked with: …" (src/ui/stamp.ts; DGS 2026-10-11, item 8): the last
   * line, below the course details. */
  stamp?: string;
}): { text: string; html: string; subject: string } {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const greeting = `Dear ${opts.decider},`;
  const sections = opts.sections.filter((s) => s.rows.length > 0);
  const groups = opts.detailGroups.filter((g) => g.rows.length > 0);
  const pipeRow = (r: readonly string[]) => r.join(' | ');
  // The human half (greeting, context, sign-off) sits ABOVE one line; the
  // machine-readable half (tables + details) below it. Both halves are
  // marked at the line (DGS wording, 2026-09-03 and 2026-09-06): the student
  // may reword the email, but must leave the tables intact.
  const editable = EDITABLE_MARKER;
  const marker = DO_NOT_MODIFY_MARKER;
  const divider = MARKER_DIVIDER;
  // The same skeleton as the other two emails (DGS 2026-09-28): the student
  // line, the intro and standing, then the numbered actions — the reader's
  // own — above the sign-off; the sheet rows and details below the line.
  const actionGroups = opts.actions.filter((g) => g.items.length > 0);
  let n = 0;
  const actionsText = actionGroups.length === 0 ? '' : `${ACTION_HEADING.toUpperCase()}\n` + actionGroups.map((g) => `${g.heading}\n${g.items.map((i) => `${++n}. ${i}`).join('\n')}\n`).join('') + '\n';
  n = 0;
  const actionsHtml =
    actionGroups.length === 0
      ? ''
      : `<p><strong>${esc(ACTION_HEADING)}</strong></p>` +
        actionGroups.map((g) => `<p>${esc(g.heading)}</p><ol start="${n + 1}">${g.items.map((i) => (++n, `<li>${esc(i)}</li>`)).join('')}</ol>`).join('');
  const text =
    `Subject: ${opts.subject}\n\n${greeting}\n\n${STUDENT_LINE}\n\n${opts.intro}\n` +
    opts.context.map((c) => `${c}\n`).join('') +
    `\n${actionsText}Thank you!\n\n${editable}\n${divider}\n${marker}\n\n` +
    sections.map((s) => `${s.rowsIntro}\n\n${s.rows.map((r) => r.join('\t')).join('\n')}\n\n`).join('') +
    `${opts.detailsTitle}\n\n` +
    groups.map((g) => `${g.heading}\n${pipeRow(opts.detailHeaders)}\n${g.rows.map(pipeRow).join('\n')}`).join('\n\n') +
    `\n${opts.stamp ? `\n${opts.stamp}\n` : ''}`;
  const html =
    `<p>${esc(`Subject: ${opts.subject}`)}</p><p>${esc(greeting)}</p>${studentLineHtml()}<p>${esc(opts.intro)}` +
    (opts.context.length > 0 ? `<br>${opts.context.map((c) => esc(c)).join('<br>')}` : '') +
    `</p>${actionsHtml}<p>Thank you!</p><p><strong>${esc(editable)}</strong></p><hr><p><strong>${esc(marker)}</strong></p>` +
    sections
      .map(
        (s) =>
          `<p>${esc(s.rowsIntro)}</p><table border="1" cellspacing="0" cellpadding="4">` +
          s.rows.map((r) => `<tr>${r.map((v) => `<td>${esc(v)}</td>`).join('')}</tr>`).join('') +
          `</table>`,
      )
      .join('') +
    `<p>${esc(opts.detailsTitle)}</p>` +
    groups
      .map(
        (g) =>
          `<p><strong>${esc(g.heading)}</strong></p><table border="1" cellspacing="0" cellpadding="4"><tr>${opts.detailHeaders.map((h) => `<th>${esc(h)}</th>`).join('')}</tr>` +
          g.rows.map((r) => `<tr>${r.map((v) => `<td>${esc(v)}</td>`).join('')}</tr>`).join('') +
          `</table>`,
      )
      .join('') +
    (opts.stamp ? `<p>${esc(opts.stamp)}</p>` : '');
  // The subject travels with the flavours (the copy dialog shows it, 2026-09-06 evening);
  // "Oral Candidacy Exam (OCE)" in full once per flavour, then "OCE".
  return { text: shortenAfterFirst(text), html: shortenAfterFirst(html), subject: opts.subject };
}

/** The markers every copied request carries (DGS wording 2026-09-03 / 2026-09-06):
 * students reword only their own half; the tables below stay machine-readable.
 * Shared with the Grad Admin's processing request (src/ui/grad-admin-request.ts). */
export const EDITABLE_MARKER = '(You may edit anything above this line)';
export const DO_NOT_MODIFY_MARKER = '(DO NOT MODIFY ANYTHING BELOW THIS LINE)';
export const MARKER_DIVIDER = '-'.repeat(64);

/** One pending course in the combined review request (2026-09-03: ONE request
 * covers everything). `unlisted` marks courses that need a NEW sheet row —
 * ND courses missing from the Courses tab, external courses with no
 * ExternalCourses ruling; the rest need a decision, not a row. */
export interface PendingReviewCourse extends ReviewRequestCourse {
  reason: string;
  unlisted: boolean;
}

/** The review request's two course lists from the engine's pending decisions.
 * Notre Dame courses (program coursework and prior coursework) feed the
 * Courses-tab rows; other universities the ExternalCourses rows — and so does
 * a course from an earlier Notre Dame program whose transfer decision is still
 * to be entered, under UNIVERSITY OF NOTRE DAME (policy review round 3,
 * P3-dh-10-2; DGS 2026-10-06): a row in the "enter in the course rules" list,
 * not an email reply the page cannot record. Its Courses-tab part stays only
 * while the course is not listed there. */
export function reviewRequestCourses(
  pending: readonly PendingDgsReview[],
  slotLabel: (p: PendingDgsReview) => string | undefined,
): { nd: PendingReviewCourse[]; external: PendingReviewCourse[] } {
  const request = (p: PendingDgsReview): PendingReviewCourse => ({
    courseId: p.course.entry.courseId,
    title: p.course.entry.title ?? p.course.rule?.title,
    credits: p.course.entry.credits,
    grade: p.course.entry.grade,
    termText: termLabel(p.course.entry.term),
    reason: p.reason,
    unlisted: p.unlisted,
    ask: p.ask,
  });
  return {
    nd: pending.filter((p) => p.kind !== 'external' && (p.transferRow === undefined || p.ask.decide.length > 0)).map(request),
    external: [
      ...pending
        .filter((p) => p.kind === 'external')
        .map((p) => {
          const system = p.course.entry.creditSystem;
          return {
            ...request(p),
            institution: p.course.entry.institution,
            slotLabel: slotLabel(p),
            ...(system === 'quarter' || system === 'trimester'
              ? { creditSystem: system, ...(p.course.entry.creditSystemChosen ? { creditSystemChosen: true as const } : {}) }
              : {}),
          };
        }),
      ...pending
        .filter((p) => p.transferRow !== undefined)
        .map((p) => ({
          ...request(p),
          institution: NOTRE_DAME_ROW_UNIVERSITY,
          slotLabel: slotLabel(p),
          reason: p.transferRow!.reason,
          unlisted: true,
          ask: { needsRow: true, replyNeeded: false, decide: p.transferRow!.decide },
        })),
    ],
  };
}

/** THE review request (2026-09-03): one email covering Notre Dame courses
 * that still need a DGS decision (not in the rules sheet — typical for
 * non-CSE; dgs_approval not yet approved; blank verdict) AND external courses
 * the ExternalCourses tab has not ruled on. Carries the student's prior
 * graduate study (the §5.2 caps depend on it), paste-ready rows per tab —
 * Courses (course_id, title) and ExternalCourses (UNIVERSITY in the sheet's
 * capital-English convention, course_id, course_title) — and detail lines
 * grouped per transcript. The tables and details are marked DO NOT MODIFY
 * (DGS wording, 2026-09-03), with "(You may edit anything above this line)"
 * above the divider (2026-09-06), so students reword only their own half and
 * leave the machine-readable parts intact. */
/** One paste-ready row per COURSE, not per attempt (DGS 2026-09-09). A student
 * may take the same course several times — a master's project or thesis credit
 * — and every attempt used to become its own row, which is how the
 * ExternalCourses tab collected duplicates that shadow each other (the last
 * row wins). The course DETAILS below still list every attempt: that is the
 * evidence the DGS is being asked to weigh, and the repetition is visible
 * there. Keyed the way the sheet itself matches, so "CS-591" and "CS 591" at
 * one university count as the same course. */
function oncePerCourse(courses: readonly PendingReviewCourse[], keyOf: (c: PendingReviewCourse) => string): PendingReviewCourse[] {
  const seen = new Set<string>();
  const out: PendingReviewCourse[] = [];
  for (const c of courses) {
    if (!c.unlisted) continue;
    const key = keyOf(c);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

/** Said only when a repeat was actually folded away, so the DGS knows why the
 * table is shorter than the details below it. */
const repeatNote = (kept: readonly PendingReviewCourse[], all: readonly PendingReviewCourse[]): string =>
  all.filter((c) => c.unlisted).length > kept.length
    ? ' (one row per course — a course taken more than once is listed once here, and once per term in the details below)'
    : '';

export function buildCombinedReviewRequest(opts: {
  /** The "Prior graduate study" choice, as its dropdown label. */
  priorStudy: string;
  nd: readonly PendingReviewCourse[];
  external: readonly PendingReviewCourse[];
  /** Notes for the DGS that are not about one course (2026-09-12). */
  notes?: readonly string[];
  /** The Notre Dame programs (src/ui/program-history.ts, DGS 2026-09-28):
   * `compact` for the subject, `earlier` for the standing lines. Optional
   * for older callers. */
  history?: { compact: string; earlier: string };
  /** The unofficial-transcript warning (src/ui/email-html.ts; DGS 2026-10-03). */
  unofficial?: string;
  /** The reader's title, decider.ts deciderTitle(program): "Dear ADGS," on
   * the MSCSE (policy review round 3, P3-emails-5). The course reasons arrive
   * already worded for it — the email is not rewritten again, which would
   * turn a course's deliberate "DGS" into "ADGS" (2026-09-13). Defaults to
   * the DGS for older callers. */
  decider?: 'DGS' | 'ADGS';
  /** Where the rules sheet stands on this university's credit system (the
   * Universities tab, DGS 2026-10-10): `set`; `blank` — listed, credit_system
   * empty or rejected, so list A asks to complete that row; `absent` — no row,
   * so list A asks for one and a paste-ready row goes in the tables. The
   * system is entered once, when the university first arrives. Omitted by
   * older callers: nothing is asked. */
  universityRow?: (university: string) => 'set' | 'blank' | 'absent';
  /** "Checked with: …" (src/ui/stamp.ts; DGS 2026-10-11, item 8): the
   * request's last line. Optional for older callers. */
  stamp?: string;
}): { text: string; html: string; subject: string } {
  // The student is writing to the DGS: "your advisor" is "my advisor".
  const voiced = (reason: string): string => reason.replace(/\byour advisor/g, 'my advisor').replace(/\bYour advisor/g, 'My advisor');
  const askOf = (c: PendingReviewCourse) => c.ask ?? { needsRow: c.unlisted, replyNeeded: false, decide: [] };
  // The rulings for this student (P3-emails-2): tagged by the engine; an older
  // caller's ask falls back to the "for me" wording it used to be split on.
  const rulingsOf = (c: PendingReviewCourse): string[] => {
    const a = askOf(c);
    return a.rulings ?? a.decide.filter((d) => /\bfor me\b/.test(d));
  };
  const detail = (c: PendingReviewCourse): string[] => [c.courseId, c.title ?? '', String(c.credits), c.grade, c.termText, askOf(c).decide.join('; '), voiced(c.reason)];
  // One row per course for the sheet; every attempt still shown in the details.
  const ndRows = oncePerCourse(opts.nd, (c) => normalizeCourseId(c.courseId));
  const extRows = oncePerCourse(opts.external, (c) => `${normalizeUniversity(c.institution ?? '')}|${normalizeCourseId(c.courseId)}`);
  // Group the external courses per transcript (slot + university), so the
  // details read the way the student uploaded them — one table per group.
  const groups: { heading: string; rows: string[][] }[] = [];
  if (opts.nd.length > 0) groups.push({ heading: 'Notre Dame:', rows: opts.nd.map(detail) });
  for (const c of opts.external) {
    // The institution as the student's record has it — no upper-casing (DGS
    // 2026-09-06, late evening: keep what the transcript prints; the rules
    // match names case-insensitively anyway).
    const heading = `${c.slotLabel ?? 'Entered by hand'} — ${c.institution ?? 'university not given'}:`;
    let g = groups.find((x) => x.heading === heading);
    if (!g) {
      g = { heading, rows: [] };
      groups.push(g);
    }
    g.rows.push(detail(c));
  }
  // The action list (DGS 2026-09-28): A — rows to enter or complete, which
  // need no reply because the page reads the sheet; B — decisions for this
  // student, which do. A course can be in both (prior Notre Dame coursework
  // with no row AND a §5.2 recommendation to give).
  const all = [...opts.nd, ...opts.external];
  const name = (c: PendingReviewCourse): string => `${c.courseId}${c.title ? ` ${c.title}` : ''} (${c.institution ?? 'Notre Dame'}, ${c.termText})`;
  // One item per course (a course taken twice is asked about once), listed
  // or not — unlike the paste-ready rows, which are for unlisted courses only.
  const distinct = (courses: readonly PendingReviewCourse[]): PendingReviewCourse[] => {
    const seen = new Set<string>();
    return courses.filter((c) => {
      const key = `${normalizeUniversity(c.institution ?? '')}|${normalizeCourseId(c.courseId)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };
  // The Universities tab (DGS 2026-10-10): for each university of the request
  // whose credit system the sheet does not give, an item in list A — a new row
  // (with a paste-ready one in the tables, prefilled with what this student's
  // record carries: quarter or trimester) or, when the row exists with a blank
  // system, completing it. Not for the Notre Dame transfer rows.
  const uniRows: string[][] = [];
  const uniItems: string[] = [];
  if (opts.universityRow) {
    const seen = new Set<string>();
    for (const c of opts.external) {
      const university = c.institution ?? '';
      const key = normalizeUniversity(university);
      if (key === '' || seen.has(key) || isNotreDameInstitution(university)) continue;
      seen.add(key);
      const state = opts.universityRow(university);
      if (state === 'set') continue;
      const carried = opts.external.find((x) => normalizeUniversity(x.institution ?? '') === key && x.creditSystem);
      const clause = carried?.creditSystem
        ? carried.creditSystemChosen
          ? `; I chose ${carried.creditSystem} hours when importing`
          : `; my transcript reads as ${carried.creditSystem} hours`
        : '';
      if (state === 'absent') {
        uniRows.push([university, carried?.creditSystem ?? '']);
        uniItems.push(`${university} — new row in the Universities tab: its credit system (quarter, trimester or semester)${clause}`);
      } else {
        uniItems.push(`${university} — complete its row in the Universities tab: credit_system (quarter, trimester or semester)${clause}`);
      }
    }
  }
  const sheetItems = distinct(all)
    .map((c) => {
      const a = askOf(c);
      // The sheet's part of the ask: everything that is not a ruling for the student.
      const rulings = new Set(rulingsOf(c));
      const decide = a.decide.filter((d) => !rulings.has(d));
      return decide.length === 0 ? '' : `${name(c)} — ${a.needsRow ? 'new row: ' : 'complete the row: '}${decide.join('; ')}`;
    })
    .filter((s) => s !== '');
  // List B: the rulings, with their text — never an item with nothing after the dash.
  const replyItems = distinct(all.filter((c) => rulingsOf(c).length > 0)).map((c) => `${name(c)} — ${rulingsOf(c).join('; ')}`);
  const history = opts.history;
  return buildReviewRequest({
    stamp: opts.stamp,
    subject: `Course review request (degree self-check)${history ? ` — ${history.compact}` : ''}`,
    decider: opts.decider ?? 'DGS',
    intro:
      'Could you review these courses for the degree self-check? ' +
      // Rulings for this student are decided by reply, not in the rules (P3-emails-2).
      'It cannot count them until they are decided — in the course rules, or by your reply where the question is about my record.',
    context: [
      ...(history?.earlier ? [history.earlier] : []),
      // (No second full stop after a label that ends in one — "…or Ph.D.".)
      `Prior graduate study: ${opts.priorStudy}${opts.priorStudy.endsWith('.') ? '' : '.'}`,
      // The "whichever apply" hedge instructs the student and lives in the
      // dialog step; the reader sees the attachments (trim review 2026-09-18, P-14).
      'My transcripts are attached.',
      ...(opts.unofficial ? [opts.unofficial] : []),
      ...(opts.notes ?? []).map((n) => `Please also check: ${n}`),
    ],
    actions: [
      { heading: 'A. Please enter or complete these in the course rules — no reply needed; the self-check reads the rules the next time I open it:', items: [...sheetItems, ...uniItems] },
      { heading: 'B. Please decide these for me — a reply is needed:', items: replyItems },
    ],
    // The reader owns the sheet (DGS 2026-09-03 wording, shortened in the trim
    // review 2026-09-18, P-15); naming no owner also keeps "the DGS's sheet"
    // from becoming "the ADGS's" on the MSCSE tab. Rows unchanged byte for byte.
    sections: [
      {
        rowsIntro: `Rows for the rules sheet — Courses tab:${repeatNote(ndRows, opts.nd)}`,
        rows: ndRows.map((c) => [c.courseId, c.title ?? '']),
      },
      {
        rowsIntro: `Rows for the rules sheet — ExternalCourses tab:${repeatNote(extRows, opts.external)}`,
        rows: extRows.map((c) => [c.institution ?? '', c.courseId, c.title ?? '']),
      },
      {
        rowsIntro: 'Rows for the rules sheet — Universities tab (university, credit_system):',
        rows: uniRows,
      },
    ],
    detailsTitle: 'Course details:',
    detailHeaders: ['Course', 'Title', 'Credits', 'Grade', 'Term', 'Please decide', 'Why'],
    detailGroups: groups,
  });
}
