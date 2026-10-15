// Prior-university transcript slots (feature decisions 2026-09-01; since
// 2026-09-03 part of the single "Transcripts" card composed in app.ts): up to
// three uploads — undergraduate, Master's, Ph.D., all optional — parsed
// entirely in the browser (system-generated PDFs read exactly; scans via the
// explicit opt-in English-only OCR), previewed for correction, then added as
// origin:'transfer' courses tagged with their degree level. The DGS's rulings
// from the ExternalCourses rules show on each course's line in the coursework
// table and in the report's §4.4.1 / §5.2 rows (the separate "What the DGS's
// rules say" block was removed as redundant, 2026-09-06); anything unruled is
// picked up by app.ts's single "Ask the DGS to review" card (the page itself
// transmits nothing — FERPA).
import { checkTotals, doubtedTerms, type CheckedRow, type PrintedTotals, type TotalsMismatch } from '../transcript/totals-check.ts';
import { deciderContact, type Contact } from './contacts.ts';
import { transcriptProblemHref, type TranscriptProblem } from './report-problem.ts';
import { APP_BUILD } from './build-info.ts';
import { bachelorsPrefill, ocrReducedPagesNote, ocrTurnedNote, rowIsCompact, type OcrReducedPage } from '../transcript/preview-layout.ts';
import { canonicalCourseId, resolveRuleRow } from '../data/assemble.ts';
import { creditSystemFactor, findExternalRule, isNotreDameInstitution } from '../data/external.ts';
import { backgroundQuestions, completeBackground, describeBackground, openBackgroundDialog, priorSlotsFor, priorSlotsForDraft } from './background.ts';
import { answerBackground, confirmDraft, earlierDegreesState, forgetReadings, mergeReading, restoreEarlierDegrees, type ReadingResult, readBackgroundFromPriorBachelors, readBackgroundFromPriorGraduate } from './background-read.ts';
import { sameUniversity } from '../engine/nd-posting.ts';
import { CORE_TITLE_RE } from '../engine/core-title.ts';
import { priorNdUndergraduateCanCount } from '../engine/allocate.ts';
import type { Rules } from '../data/types.ts';
import { GRADES } from '../engine/grades.ts';
import { BACHELORS_YEAR_RANGE, COURSE_CREDITS_RANGE, TERM_YEAR_RANGE, inRange, inputRefusal } from '../engine/ranges.ts';
import { termBefore, termIndex, termLabel, termOfDate, termShort } from '../engine/term.ts';
import { SEASONS } from './state.ts';
import type { CourseEntry, Grade, ImportedField, Program, Season, Student, Term } from '../engine/types.ts';
import type { ExternalCourseCandidate, ExternalParseResult } from '../transcript/external.ts';
import { prefillLevelsByTerm } from '../transcript/level-prefill.ts';
import { absorbBlockRow, blockRowBack, blockRowFor } from './nd-posted.ts';
import { BROWSER_TOO_OLD_FOR_PDFS, browserTooOldForPdfs } from './pdf-support.ts';
import { reclassifyNotreDameCourses } from './prior-nd.ts';
import { unfinishedPriorLabel } from './program-history.ts';
import { canonicalUniversityName } from './university-name.ts';
import { confirmDialog } from './copy-dialog.ts';
import { parseTranscript } from '../transcript/parse.ts';
import { EARLIER_DEGREES_FIRST_NOTE, el, inactiveButton, option, PREVIEW_OPEN_NOTE, SIMULATION_IMPORT_NOTE } from './dom.ts';
import { campusQuestion, MULTI_CAMPUS_SYSTEMS } from '../transcript/campus.ts';
import { stripRegion, type StripRegion } from '../transcript/scan-strip.ts';
import { SCANNER_LAYER_CONFIDENCE } from '../transcript/scanner-layer.ts';
import { emptyPageImages, holdScanStrips, holdsScanStrips, releaseScanStrips, scanStripFor } from './scan-strips.ts';

type DegreeLevel = NonNullable<CourseEntry['degreeLevel']>;
/** What the Notre Dame row is called, which depends on the program the student
 * picked at the top (DGS 2026-09-11). A 4+1 student holds several Notre Dame
 * transcripts; the row wants the one for the program they are in now. */
export function ndRowLabel(student: Student): string {
  // "Current" (DGS 2026-09-11): this row is for the program the student is in
  // now — and, since 2026-09-22, for the earlier Notre Dame degrees too: they
  // are on the same insideND transcript, which is imported here once.
  return student.program === 'mscse' ? 'Current ND Unofficial MSCSE Transcript' : 'Current ND Unofficial Ph.D. Transcript';
}

export const DEGREE_SLOTS: { level: DegreeLevel; label: string }[] = [
  { level: 'bachelors', label: 'Previous Undergraduate Transcript' },
  { level: 'masters', label: 'Previous Master’s Transcript' },
  { level: 'phd', label: 'Previous Ph.D. Transcript' },
];

/** The three seasons, as the term controls list them, and each one's label
 * ("Fall"). (A shared SEASONS in engine/term.ts and a seasonSelect in dom.ts
 * would also serve app.ts and state.ts — left for a cross-file change.) */
const seasonName = (se: Season): string => se[0]!.toUpperCase() + se.slice(1);

interface PreviewRow {
  include: boolean;
  courseId: string;
  title: string;
  credits: number | undefined;
  grade: Grade | '';
  rawGrade?: string;
  season: Season;
  year: number | undefined;
  /** OCR read this row's line poorly — the preview marks it for checking. */
  lowConfidence?: boolean;
  /** Why a confidently read row is flagged all the same (item 13, 2026-10-11). */
  evidence?: 'credits' | 'mark' | 'totals' | 'code';
  /** OCR only (Batch C answer (4), DGS 2026-10-09): what the scan showed in a
   * credits or grade cell the parser corrected ("3.O", "Bt") — shown beside
   * the value, never saved (the Add builds each course field by field,
   * `courseEntryOf`). */
  ocrRead?: { credits?: string; grade?: string };
  /** A scan's course number with its digit look-alikes put back ("PHYS 1O1"
   * → "PHYS 101"), offered beside the id box; used only when the student
   * clicks it (DGS 2026-10-12). Never saved. */
  codeSuggestion?: string;
  /** The level the student was registered at for this row (2026-09-05 —
   * combined B.S.+M.S. / 4+1 transcripts): from the transcript when it says,
   * else the slot's level. Undergraduate rows can only satisfy §4.4.1 core
   * knowledge; graduate rows are §5.2 transfer candidates. */
  level: 'undergraduate' | 'graduate';
  /** Where the level came from (2026-09-06, so the preview can say):
   * `transcript` — a UG/GR cell, a level block or the bachelor's conferral
   * date on the transcript; `term` — the two-year rule below (a combined
   * transcript without markers); `slot` — nothing said, the row's level is
   * the slot's. */
  levelSource: 'transcript' | 'term' | 'slot' | 'award';
  /** Left out by the relevance filter (an undergraduate row that cannot
   * matter) but kept visible, unticked, on a MIXED-level transcript so the
   * student can still tick it or change its level (2026-09-05). */
  irrelevant?: boolean;
  /** Typed by the student ("+ Add a row by hand"): every field stays
   * editable. Imported rows keep the course id and title the transcript
   * printed (2026-09-06 — text-layer imports only; OCR rows stay editable). */
  manual?: boolean;
  /** CC15 (DGS 2026-10-09, Batch C): the transcript prints no course number
   * for this course. The Course id box is an empty REQUIRED input even on a
   * text-layer import; the row starts unticked and cannot be ticked or added
   * until the student types an id (`idStillMissing`) — `''` never reaches
   * canonicalCourseId, the duplicate checks, the review request or the saved
   * record. */
  codeMissing?: true;
  /** What the reader read, as the preview first showed it (DGS 2026-10-11,
   * item 6): the Add compares the row with it and records the fields the
   * student changed (`CourseEntry.changedOnImport`). Absent on a typed row. */
  read?: ImportReading;
}

/** One preview row's reading, for the comparison on Add. */
interface ImportReading {
  course: string;
  title: string;
  credits: number | undefined;
  season: Season;
  year: number | undefined;
  grade: Grade | '';
  level: 'undergraduate' | 'graduate';
}

function readingOf(r: PreviewRow): ImportReading {
  return { course: r.courseId, title: r.title, credits: r.credits, season: r.season, year: r.year, grade: r.grade, level: r.level };
}

/** The fields of a row the student changed from the reader's reading. */
export function changedFields(r: Pick<PreviewRow, 'courseId' | 'title' | 'credits' | 'season' | 'year' | 'grade' | 'level' | 'read'>): ImportedField[] {
  const was = r.read;
  if (was === undefined) return [];
  const out: ImportedField[] = [];
  if (canonicalCourseId(r.courseId) !== canonicalCourseId(was.course)) out.push('course');
  if (r.title.trim() !== was.title.trim()) out.push('title');
  if (r.credits !== was.credits) out.push('credits');
  if (r.season !== was.season || r.year !== was.year) out.push('term');
  if (r.grade !== was.grade) out.push('grade');
  if (r.level !== was.level) out.push('level');
  return out;
}

interface ExternalPreview {
  slot: DegreeLevel;
  university: string;
  rows: PreviewRow[];
  /** The transcript's own totals lines (item 11, 2026-10-11), and every row
   * read — the shown ones are the same objects as in `rows`, so a correction
   * reaches the check — index-aligned with the lines' `rows`. */
  printedTotals?: PrintedTotals[];
  allRows?: PreviewRow[];
  /** Rows came from OCR of a scan — approximate; the preview says so. */
  fromOcr?: boolean;
  /** …from the text a SCANNER embedded in the scan, read OCR-grade (Batch C
   * answer (6), DGS 2026-10-09; `fromOcr` is set too: rows editable, every
   * one flagged). The banner and the ⚠ say whose reading it is. */
  scannerLayer?: true;
  /** OCR pages read below the usual resolution (OCR step 12, 2026-10-09:
   * a much larger than letter-size page, squeezed under the canvas limits) —
   * the banner names them (W-CL373). */
  ocrReducedPages?: OcrReducedPage[];
  /** The quarter turn the orientation trial applied before reading (OCR step
   * 12): a sideways or upside-down scan — the banner says so (W-CL374). */
  ocrTurned?: 90 | 180 | 270;
  /** The transcript is marked unofficial (2026-09-17): accepted, with a warning
   * that the reviewers will require the official one. */
  unofficial?: boolean;
  /** The transcript carries a graduate-degree conferral line (2026-09-03) —
   * used to set "Prior graduate study" when the student has not chosen. */
  conferred?: boolean;
  /** Undergraduate imports only (2026-09-04): parsed rows left out because
   * neither the core-title keywords nor a DGS ruling made them relevant. */
  omitted?: number;
  /** Rows under Banner's "Transfer credit accepted by the institution" block —
   * courses from a THIRD school — left out by the parser (2026-09-05). */
  transferSkipped?: number;
  /** The transcript has Cyrillic text, which the reader does not read (DGS
   * 2026-10-12: out of scope): the preview asks for those courses by hand. */
  nonLatinScript?: true;
  /** Rows of both levels were read (2026-09-05): the Taken-as column matters. */
  mixedLevels?: boolean;
  /** The two-year rule was applied (2026-09-06): rows in the last two years
   * of the record — from `graduateFrom` to `latest` — were marked Graduate,
   * earlier ones Undergraduate. The preview explains this and asks for a check. */
  termPrefill?: { graduateFrom: Term; latest: Term };
  /** A dated bachelor's conferral on the transcript (2026-09-06): pre-fills
   * the preview's "Bachelor's degree awarded" control. */
  bachelorsConferredOn?: string;
  /** The bachelor's award term shown in the preview (DGS 2026-09-06 evening):
   * pre-filled from the conferral date, editable, REQUIRED for a combined
   * bachelor's + master's record in the Master's row (`bachelorsRequired`).
   * Written to the student record on add; `bachelorsSource` says whether the
   * student touched it. */
  bachelorsAwarded?: Term;
  bachelorsRequired?: boolean;
  bachelorsSource?: 'transcript' | 'student';
  /** The university name came from the transcript (2026-09-06): shown, not
   * editable — the DGS's rules key on the name the transcript prints. */
  universityFromTranscript?: boolean;
  /** The name was recovered from an acronym, not read as text (2026-09-08). */
  universityGuessed?: true;
  /** A multi-campus system (DGS 2026-09-12): the campus must be chosen before
   * the courses are added; pre-filled when the record named it. */
  campusSystem?: string;
  campus?: string;
  campusFromTranscript?: boolean;
  /** The credit system the transcript announced (quarter 2026-09-11,
   * trimester 2026-09-12); the student can correct it in the preview.
   * `undefined` = semester / not stated. */
  creditSystem?: 'quarter' | 'trimester' | 'semester';
  /** What the parser read, kept when the student changes `creditSystem`, so
   * the note says who chose it (DGS 2026-10-10, item 3: a hand-picked system
   * was still "read from how the transcript names its terms"). */
  creditSystemRead?: 'quarter' | 'trimester';
}

/** The preview's "Bachelor's degree awarded" (DGS 2026-09-06 evening): in the
 * Master's row a COMBINED record — rows of both levels, a bachelor's conferral
 * line, or the two-year rule firing — makes the term required; the conferral
 * date pre-fills it. Other rows: pre-filled when the transcript dates the
 * degree, never required. */
function bachelorsForPreview(
  slot: DegreeLevel,
  mixed: boolean,
  conferredOn: string | undefined,
  twoYearRule: boolean,
  /** What the student has already set under Your standing BY HAND. It wins:
   * importing a second transcript must not silently move a term the student
   * chose (DGS bug 2026-09-07 — a Master's import reset the year entered after
   * an undergraduate import). A term merely inferred from an earlier
   * transcript does not win; this transcript's own conferral date may replace
   * that, as before. */
  handSet?: Term,
): Pick<ExternalPreview, 'bachelorsAwarded' | 'bachelorsRequired' | 'bachelorsSource'> {
  const chosen = bachelorsPrefill(handSet, conferredOn !== undefined ? termOfDate(conferredOn) : undefined);
  const combined = slot === 'masters' && (mixed || conferredOn !== undefined || twoYearRule);
  return {
    ...(chosen ? { bachelorsAwarded: chosen.term, bachelorsSource: chosen.source } : {}),
    ...(combined ? { bachelorsRequired: true } : {}),
  };
}

/** The bachelor's term the student set themselves, if any — undefined when it
 * is unset or was only inferred from a transcript. */
function handSetBachelors(student: Student): Term | undefined {
  return student.bachelorsAwarded !== undefined && student.bachelorsAwardedInferred === undefined ? student.bachelorsAwarded : undefined;
}

/** Re-fill every dated row's level by the bachelor's award term the student
 * set (2026-09-06 evening): in or before it → undergraduate, later →
 * graduate; the relevance filter then decides the ticks as on import. */
function relevelByAward(p: ExternalPreview, rules: Rules, program: Program): void {
  const award = p.bachelorsAwarded;
  if (award === undefined) return;
  for (const r of p.rows) {
    if (r.year === undefined) continue;
    r.level = termIndex({ season: r.season, year: r.year }) <= termIndex(award) ? 'undergraduate' : 'graduate';
    r.levelSource = 'award';
    r.include = !isBlockedRow(p, rules, r, program);
    r.irrelevant = isBlockedRow(p, rules, r, program) ? true : undefined;
  }
  p.mixedLevels = new Set(p.rows.map((r) => r.level)).size > 1 || undefined;
}

const compareTermIndex = (a: Term, b: Term): number => termIndex(a) - termIndex(b);

/** The level a slot's rows take when the transcript does not say: undergraduate in the bachelor's row, graduate elsewhere. */
function slotDefaultLevel(slot: DegreeLevel): PreviewRow['level'] {
  return slot === 'bachelors' ? 'undergraduate' : 'graduate';
}


/** A row's degree level on add (2026-09-05): undergraduate rows are
 * Bachelor's coursework whatever the slot; graduate rows take the slot's
 * degree (Master's, or Ph.D. in the Ph.D. slot; a graduate row on an
 * undergraduate transcript — a 4+1's fifth year — is Master's coursework). */
function degreeLevelFor(slot: DegreeLevel, level: PreviewRow['level']): DegreeLevel {
  if (level === 'undergraduate') return 'bachelors';
  return slot === 'phd' ? 'phd' : 'masters';
}

let preview: ExternalPreview | undefined;
/** An import that failed, or a preview-level problem (usability review
 * 2026-09-05, item 6): a persistent message under the slot row / inside the
 * preview instead of a 4-second toast. Cleared by the next import, Dismiss,
 * or (preview errors) the next attempt to add. */
let importError: { slot: DegreeLevel; message: string } | undefined;
let previewError: string | undefined;
/** An import that failed: the message under the slot row, focused (item 6). */
/** Why a Notre Dame transcript is refused in a previous-degree row (DGS 2026-09-22). */
function ndInPreviousRow(student: Student): string {
  return `This is a Notre Dame transcript. It belongs in the “${ndRowLabel(student)}” row above, once: insideND prints one transcript for every degree you took here, and that row reads your earlier Notre Dame degrees, their courses and your entry term from it. Adding it here too would list every earlier course twice.`;
}
function failSlot(slot: DegreeLevel, message: string, render: () => void): void {
  importError = { slot, message };
  render();
  document.querySelector<HTMLElement>(`[data-key="ext.error.${slot}"]`)?.focus();
}
/** A scan was uploaded and awaits the student's explicit OCR opt-in
 * (DGS decision 2026-09-02: never OCR without asking; English only). */
/** `reason` 'no-lines' (DGS 2026-09-16): a text-layer PDF from which no
 * course line could be read is offered OCR too, the same opt-in. */
/** `reason` 'scanner-layer' (Batch C answer (6), DGS 2026-10-09): a scan whose
 * scanner embedded its own text — its rows are previewed OCR-grade and OCR is
 * offered BESIDE that preview; choosing OCR replaces the preview, adding or
 * cancelling the preview withdraws the offer. */
let pendingScan: { slot: DegreeLevel; buffer: ArrayBuffer; filename: string; reason?: 'scan' | 'no-lines' | 'scanner-layer' } | undefined;
/** The OCR offer beside a scanner-layer preview belongs to that preview: once
 * it is added or cancelled the offer goes too — OCR would read the same
 * courses in again (Batch C answer (6)). */
function withdrawScannerLayerOffer(): void {
  if (pendingScan?.reason === 'scanner-layer') pendingScan = undefined;
}
/** OCR in flight — drives the progress line. */
let ocrBusy: { label: string; percent: number } | undefined;

export interface ExternalCardArgs {
  student: Student;
  rules: Rules;
  update: (fn: (s: Student) => void) => void;
  toast: (msg: string) => void;
  /** A toast with one action button (Undo) — app.ts supplies it; `ttlMs`
   * lengthens the window (20 s for a transcript-wide removal), `focusKey`
   * names the control to focus after the Undo's render. */
  toastWithAction?: (msg: string, actionLabel: string, action: () => void, opts?: { ttlMs?: number; focusKey?: string }) => void;
  render: () => void;
  /** One transcript at a time (2026-09-03): true while ANY preview is open,
   * disabling every import button until it is confirmed or cancelled. */
  blocked: boolean;
  /** Simulation mode (DGS 2026-10-09, D6): true while the mode is on — the
   * three Import buttons and the OCR opt-in are inactive with their own
   * reason (SIMULATION_IMPORT_NOTE: a transcript is real data; it is imported
   * outside the mode). Remove, Change and the scan's Cancel stay active: they
   * edit the planning copy or clear a pending scan, never the record. */
  simulation?: boolean;
  /** Focus this data-key after the next render (app.ts's focus keeper). */
  setFocusAfterRender?: (key: string) => void;
  /** Today at Notre Dame (YYYY-MM-DD): the date each imported row records
   * (`CourseEntry.imported`; DGS 2026-10-11, item 6). */
  todayIso?: string;
  /** "Checked with: …" (src/ui/stamp.ts) for the reader-problem email (item 18). */
  checkedWith?: string;
}

/** The student is answering the earlier-degrees questions on the page: they
 * stay, saved as they go, until "Done" — even once the answer is complete —
 * so the click that completes it does not pull the questions (and the focused
 * choice) away, and a follow-up it reveals (the 4+1 admission term, the
 * transfer term) is seen (review of Option 1, 2026-10-08). Not saved: a new
 * visit shows the one-line answer. */
let answeringEarlier = false;

/** Reset (a new record, review of Option 1, 2026-10-08): an open preview or a
 * scan awaiting the OCR choice belonged to the old record — its Add would file
 * courses and readings into the new one — and the answering-on-the-page state
 * goes too. An OCR run already under way finishes into a preview the student
 * can cancel. */
export function resetPriorImports(): void {
  preview = undefined;
  releaseScanStrips();
  importError = undefined;
  previewError = undefined;
  pendingScan = undefined;
  answeringEarlier = false;
}

/** True while this module holds an unconfirmed import — an open preview, a
 * scan awaiting the OCR opt-in, or OCR in flight. app.ts combines it with its
 * own ND-preview state to block all import buttons. */
export function importsBusy(): boolean {
  return preview !== undefined || pendingScan !== undefined || ocrBusy !== undefined;
}

/** Can this row matter? Graduate rows always (§5.2 transfer candidates);
 * undergraduate rows only for §4.4.1 core knowledge — a core-keyword title, a
 * DGS ruling, or (Notre Dame) a Courses-tab core area. Re-evaluated whenever
 * the student changes a row's "Taken as" (2026-09-06). */
function isRelevantRow(university: string, rules: Rules, r: PreviewRow, program: Program): boolean {
  if (r.level === 'graduate') return true;
  // Everything else an undergraduate row could do is the Ph.D. qualifying
  // examination's §4.4.1, which the MSCSE does not have (DGS 2026-09-11).
  const qualifier = program === 'phd';
  if (qualifier && (CORE_TITLE_RE.test(r.title) || findExternalRule(rules.external, university, r.courseId) !== undefined)) return true;
  if (!isNotreDameInstitution(university) || r.year === undefined || r.courseId.trim() === '') return false;
  const rule = resolveRuleRow(rules, r.courseId, { season: r.season, year: r.year });
  // Notre Dame's own undergraduate coursework can do more than demonstrate a
  // core area: 60000-level courses count in full, and a CSE course below that
  // may count inside §3.2's / §4.2's allowance (DGS 2026-09-11 — "they may
  // count, subject to all other constraints, so they should be listed"). The
  // engine decides which, so the row is offered and the report rules on it.
  return (qualifier && rule?.coreArea !== undefined) || priorNdUndergraduateCanCount({ courseId: r.courseId, credits: r.credits ?? 0, term: { season: r.season, year: r.year }, grade: 'A' } as CourseEntry, rule, program);
}

/** An undergraduate row that cannot matter: unticked and locked in the
 * preview, and never added. */
function isBlockedRow(p: ExternalPreview, rules: Rules, r: PreviewRow, program: Program): boolean {
  return r.level === 'undergraduate' && !isRelevantRow(p.university, rules, r, program);
}

/** Why an undergraduate row that cannot matter is not selectable (DGS
 * request 2026-09-06): shown on hover and read to screen readers. */
/** A code-less row (CC15, DGS 2026-10-09: "IMPORTED with an empty required
 * course-id box the student fills before the row can be added") whose box is
 * still empty: it cannot be ticked, is left out of "Add N selected", and its
 * `''` never reaches canonicalCourseId, the duplicate checks, the review
 * request or the saved record. */
export function idStillMissing(r: { codeMissing?: true; courseId: string }): boolean {
  return r.codeMissing === true && r.courseId.trim() === '';
}
/** The rows "Add N selected" adds: ticked, with a course id, credits, a grade
 * and a year — a row missing any of them is skipped, as it always was. */
export function readyToAdd(r: Pick<PreviewRow, 'include' | 'courseId' | 'grade' | 'credits' | 'year'>): boolean {
  return r.include && r.courseId.trim() !== '' && r.grade !== '' && r.credits !== undefined && r.year !== undefined;
}
/** The empty Course id box of a code-less row (W-CL407) and why it is
 * empty, on the box and on the tick box it locks (W-CL408). */
export const CODE_MISSING_PLACEHOLDER = 'course number';
export const CODE_MISSING_NOTE =
  'This transcript prints no course number for this course. Type the number the university gives it (its course catalog or your syllabus) to add it; until then the row is not ticked.';
/** "Is this a transcript at all?" (DGS 2026-10-10, answer 4a; W-CL421): a
 * text PDF with one course-like line, no university named and no GPA or
 * totals — nothing is imported, and the course is typed by hand. */
export function notATranscriptMessage(filename: string): string {
  return `“${filename}” does not look like a transcript: it names no university, prints no GPA or credit totals, and only one line in it reads like a course. Nothing was imported. If it is your transcript, add the course by hand below.`;
}
/** A scan whose scanner embedded its own text (Batch C answer (6), DGS
 * 2026-10-09): the OCR offer beside its preview — the lead (W-CL416), the
 * sentence (W-CL417), the button that keeps the previewed rows and withdraws
 * the offer (W-CL418) — the preview's banner (W-CL419) and each row's ⚠
 * (W-CL420: hover text · screen-reader name). */
export function scannerLayerLead(filename: string): string {
  return `“${filename}” is a scan that carries its scanner’s own reading of the text. `;
}
export const SCANNER_LAYER_OFFER =
  'The rows below were read from that reading — approximate, so every row can be edited and is marked ⚠. You can instead read the page images with the built-in text recognition (OCR), which replaces those rows: ';
export const SCANNER_LAYER_KEEP = 'Keep the rows below';
export const SCANNER_LAYER_BANNER_LEAD = 'Read from the text your scanner embedded in this scan — approximate. ';
export const SCANNER_LAYER_BANNER = 'That text is the scanner’s own recognition, so every row is marked ⚠: check every field against your transcript before adding.';
export const SCANNER_LAYER_ROW_FLAG = 'Read from the scanner’s embedded text — check it carefully';
export const SCANNER_LAYER_ROW_FLAG_NAME = 'read from the scanner’s text';

/** Beside a credits or grade value the OCR numeric correction filled (Batch C
 * answer (4), DGS 2026-10-09): what the scan itself shows (W-CL411), and on
 * hover / to a screen reader what the app made of it (W-CL412). */
export function ocrRawNote(raw: string): string {
  return `scan shows “${raw}”`;
}
export function ocrRawTitle(raw: string): string {
  return `The scan shows “${raw}” here — a letter where a digit or a plus sign belongs — so the box was filled in with what it stands for. Check it against your transcript.`;
}

/** The preview's one line when any row has no course number (W-CL409). */
export function codeMissingHint(n: number): string {
  return `${n === 1 ? 'One course on this transcript has' : `${n} courses on this transcript have`} no course number printed: type each one in its empty “Course id” box — from the university’s course catalog or your syllabus — and the row is ticked; a course without one is not added. The DGS rules on these courses by the number you type.`;
}

const BLOCKED_ROW_NOTE =
  'Not selectable: this course is not related to the core-knowledge areas (Alg, OS, Comp Arch — §4.4.1), and undergraduate credits do not transfer (§5.2), so there is nothing to add. If you took it as a graduate student, change “Taken as” to Graduate and it becomes selectable.';

/** Notre Dame's own undergraduate coursework is blocked for a different
 * reason: it is not the transfer rule that stops it but the level (2026-09-11).
 * And an MSCSE student is told nothing about §4.4.1 core knowledge, which
 * belongs to the Ph.D. qualifying examination (DGS 2026-09-11). */

const BLOCKED_MS_ROW_NOTE =
  'Not selectable: undergraduate credits do not transfer (§5.2), so there is nothing this course can count toward in the MSCSE. If you took it as a graduate student, change “Taken as” to Graduate and it becomes selectable.';


/** Which "why is this row locked?" note the preview shows, by transcript and
 * by degree. */
function blockedRowNote(program: Program): string {
  return program === 'mscse' ? BLOCKED_MS_ROW_NOTE : BLOCKED_ROW_NOTE;
}

/** Undergraduate rows (DGS request 2026-09-04): undergraduate credits never
 * transfer (§5.2), so only rows that can matter are offered in the preview —
 * a title matching the §4.4.1 core keywords (algorithms, operating systems,
 * architecture), a course the DGS has already ruled on for this university,
 * or (Notre Dame) a course the Courses tab tags with a core area. On a
 * single-level undergraduate transcript everything else is left out (and
 * counted, for the note); on a MIXED-level transcript (2026-09-05) such rows
 * stay visible but unticked, since the student may need to change a level. */
function keepRelevantRows(
  university: string,
  rules: Rules,
  rows: PreviewRow[],
  mixed: boolean,
  program: Program,
): { rows: PreviewRow[]; omitted: number } {
  const relevant = (r: PreviewRow) => isRelevantRow(university, rules, r, program);
  if (mixed) {
    for (const r of rows) {
      if (!relevant(r)) {
        r.include = false;
        r.irrelevant = true;
      }
    }
    return { rows, omitted: 0 };
  }
  const kept = rows.filter(relevant);
  return { rows: kept, omitted: rows.length - kept.length };
}

/** The prior-university slot rows, previews and per-course verdicts. Since
 * 2026-09-03 these are composed into the single "Transcripts" card by app.ts
 * (one upload home for all four transcripts) and the copy-ready review
 * request lives in app.ts's "Ask the DGS to review" card — ONE button for ND
 * and external courses together. */
export function priorTranscriptSection(args: ExternalCardArgs): (HTMLElement | null)[] {
  // Which rows this student needs, from the earlier-degrees answer (DGS
  // 2026-09-22); while it is incomplete, from what is known so far
  // (priorSlotsForDraft, 2026-10-08) — every row until an answer rules it out.
  const background = args.student.background;
  const answered = background ? priorSlotsFor(background) : priorSlotsForDraft(args.student.backgroundDraft);
  // A row also stays while its preview is open, and a graduate row while its
  // courses are on file: an answer given meanwhile must not hide a transcript
  // being added, or one added — and its Remove (review of Option 1, 2026-10-08).
  const slots = answered.concat(
    (['bachelors', 'masters', 'phd'] as const).filter((l) => !answered.includes(l) && (preview?.slot === l || (l !== 'bachelors' && coursesInSlot(args.student, l).length > 0))),
  );
  const changeKey = 'transcripts.background.change';
  const readNote = background && args.student.backgroundRead ? ' (partly read from your transcripts — check it)' : '';
  // Answered: one line with "Change". Not yet (DGS 2026-10-08, Option 1: the
  // opening dialog asks only the program): the questions themselves, here,
  // with what the transcripts imported above settled filled in and marked.
  // Every question answered, but not yet confirmed: a draft the transcripts
  // completed (or a program change left complete) — the student checks it and
  // clicks Done; a reading never applies the answer itself (review of Option
  // 1, 2026-10-08).
  const draftComplete = !background && completeBackground(args.student.backgroundDraft, args.student.program) !== undefined;
  // A fresh record (UI review item 2; DGS 2026-10-09: option (b)): no answer,
  // no draft, nothing read and no Notre Dame transcript yet — one line, with
  // "Answer here" for the student who has no transcript to import; the
  // questions themselves once a transcript is in, a draft exists, or the
  // student asked for them.
  const freshRecord = !background && !args.student.backgroundDraft && !args.student.backgroundRead && !args.student.courses.some((c) => c.fromNdTranscript === true) && !answeringEarlier;
  const backgroundLine = freshRecord
    ? el(
        'p',
        { class: 'hint background-line background-fold', id: 'earlier-degrees', 'data-key': 'transcripts.background' },
        el('strong', {}, 'Your earlier degrees'),
        ' — import your Notre Dame transcript first; it answers part of this. No transcript to import? ',
        el(
          'button',
          {
            class: 'btn tiny link',
            'data-key': 'earlier.answer',
            onclick: () => {
              answeringEarlier = true;
              args.setFocusAfterRender?.('earlier.bachelors.elsewhere');
              args.update(() => undefined);
            },
          },
          'Answer here',
        ),
        '.',
      )
    : background && !answeringEarlier
    ? el(
        'p',
        { class: 'hint background-line', 'data-key': 'transcripts.background' },
        describeBackground(background) + readNote + ' — ',
        el('button', { class: 'btn tiny link', 'data-key': changeKey, onclick: () => openBackgroundDialog(args.student, args.update, changeKey) }, 'Change'),
        '.',
      )
    : el(
        'fieldset',
        { class: 'field group background-inline', id: 'earlier-degrees', 'data-key': 'transcripts.background' },
        el('legend', { class: 'label' }, 'Your earlier degrees'),
        el(
          'p',
          { class: 'hint' },
          // Saved (complete, still open); what was read; else, with the Notre
          // Dame transcript already in (nothing it could tell, or imported
          // before 2026-10-08), just ask.
          background
            ? 'Your answers are saved. Change any of them here, then click Done.'
            : draftComplete
              ? 'Every question below is answered — check the answers, then click Done to use them.'
              : args.student.backgroundRead
              ? 'What your transcripts show is filled in below — check it, and answer the rest. These answers decide which earlier transcripts to add here and how CSE §5.2 applies to them.'
              : args.student.courses.some((c) => c.fromNdTranscript)
                ? 'Answer these questions. They decide which earlier transcripts to add here and how CSE §5.2 applies to them.'
                : 'Import your Notre Dame transcript above and part of this fills itself in; answer the rest. These answers decide which earlier transcripts to add here and how CSE §5.2 applies to them.',
        ),
        backgroundQuestions(
          background ?? args.student.backgroundDraft,
          'earlier',
          args.student.program,
          (b) => {
            answeringEarlier = true;
            args.update((s) => answerBackground(s, b));
          },
          false,
          args.student.backgroundRead ?? {},
        ),
        // Done: the student has checked what was read, so nothing is marked
        // "read" after it; focus goes to the one-line answer's Change.
        // A primary button in its own row, clear of the options (DGS
        // 2026-10-08: "Leave some space between Done and others … make the
        // Done button look nicer like the rest of the app page").
        ...(background || draftComplete
          ? [
              el(
                'div',
                { class: 'save-buttons earlier-done' },
                el(
                'button',
                {
                  class: 'btn primary',
                  'data-key': 'earlier.done',
                  onclick: () => {
                    answeringEarlier = false;
                    args.setFocusAfterRender?.(changeKey);
                    args.update((s) => {
                      if (!confirmDraft(s)) s.backgroundRead = undefined;
                      s.backgroundReadFrom = undefined;
                    });
                  },
                },
                'Done',
                ),
              ),
            ]
          : []),
      );
  // The "one university" fold is not opened by code for a student who answered
  // "same university? No" (UI review item 9; DGS 2026-10-08: option (b)); it
  // still opens for a preview, a Yes, or a Master's transcript without a No.
  const shapeSamePlace = (background ?? args.student.backgroundDraft)?.samePlace;
  return [
    backgroundLine,
    // A bachelor's and a master's from ONE university arrive in two shapes, and
    // the student has to be told which they have before they can file it
    // (DGS 2026-09-05, rewritten 2026-09-11 — Notre Dame's own 4+1 issues two
    // separate transcripts, one per career, and other universities do the
    // same, so "one combined PDF" is not the common case it was written as).
    // Two transcripts: one row each. One PDF covering both: the Master's row,
    // once, with each course's "Taken as" level read from it.
    // Folded behind one line (trim review 2026-09-18, P-1): a closed <details>
    // that only a 4+1 student needs to open — opened by code when the Previous
    // Master's row already holds a transcript or a preview is showing (where
    // "Taken as" is corrected). No role attribute: axe rejects role=note on
    // a <details> (its own role is group). The data-key is what app.ts's render memo
    // uses to keep it open across re-renders. The class stays on the details
    // element: drive-transcript.mjs reads .combined-note's textContent (a
    // closed body is still in it). Body shortened by the DGS (P-6, P-53:
    // 'import', not 'upload').
    // Not shown for a bachelor's from Notre Dame — saved or still a draft —
    // while the Master's row is empty and no preview is open: it cannot apply,
    // and its own last line says a Notre Dame degree goes in the ND row (UI
    // review, 2026-10-08). Its summary no longer says "first": it sits below
    // the questions.
    !slots.includes('masters') ||
    ((args.student.background ?? args.student.backgroundDraft)?.bachelors?.startsWith('nd-') === true && coursesInSlot(args.student, 'masters').length === 0 && preview === undefined)
      ? null
      : el(
      'details',
      { class: 'combined-note', 'data-key': 'transcripts.shape', open: preview !== undefined || shapeSamePlace === true || (coursesInSlot(args.student, 'masters').length > 0 && shapeSamePlace !== false) },
      el('summary', {}, 'Did one university give you both a bachelor’s and a master’s (a 4+1 or 5+1)? Read this before importing them.'),
      el('strong', {}, 'A bachelor’s and a master’s from the same university'),
      ' (a 4+1 or 5+1) come as two transcripts or one. ',
      el('strong', {}, 'Two transcripts:'),
      ' the bachelor’s in the Undergraduate row, the master’s in the Master’s row. ',
      el('strong', {}, 'One transcript covering both degrees:'),
      ' import it once, in the ',
      el('strong', {}, 'Previous Master’s Transcript'),
      ' row — never the same PDF twice. Either way, whether you took each course as an undergraduate or a graduate student is read from it and shown in a “Taken as” column you can correct: your status at the time, not the course’s level, decides what a course can count toward.',
      el('br'),
      'A Notre Dame degree is different: it is on the same insideND transcript as your current program, so it goes in the ND row above, once.',
    ),
    // Each Import waits for the earlier-degrees answer, saved with Done and not
    // reopened (DGS 2026-10-14).
    ...DEGREE_SLOTS.filter((slot) => slots.includes(slot.level)).map((slot) => slotRow(slot, args, !(background && !answeringEarlier))),
    pendingScan ? scanOptInBlock(args) : null,
    ocrBusy ? ocrProgressBlock() : null,
    preview ? previewBlock(args) : null,
  ];
}

function coursesInSlot(student: Student, level: DegreeLevel): CourseEntry[] {
  return student.courses.filter((c) => inSlot(c, level));
}
/** A row this slot's import brought — not the Notre Dame transcript's own
 * transfer-block rows, which an undergraduate block files as bachelor's
 * coursework too (P3-import-1 (b), 2026-10-05) but which that import owns. */
function inSlot(c: CourseEntry, level: DegreeLevel): boolean {
  // Not the Notre Dame transcript's own rows — its transfer block, nor its
  // pre-entry coursework re-filed as prior coursework: the Notre Dame row owns
  // them, and a previous row showing them (with a Remove that deleted them)
  // kept a student's real bachelor's transcript out (review of Option 1,
  // 2026-10-08).
  return c.origin === 'transfer' && c.degreeLevel === level && c.fromNdTranscript !== true;
}

/** A previous-degree transcript must be OFFICIAL (DGS 2026-09-15: "If the
 * imported transcript has 'unofficial' anywhere, deem it unofficial and
 * reject it"). Only the Notre Dame row takes the unofficial self-service PDF. */
/** Accepted with a warning since 2026-09-17 (DGS): an unofficial transcript
 * lets a student track their progress; the ADGS/DGS and the Grad Admin will
 * ask for the official one. */
const UNOFFICIAL_WARNING =
  'This transcript is marked “unofficial”. You can use it here to track your progress, but the ADGS, the DGS and the Grad Admin will require an OFFICIAL transcript for review, approval and processing — the official transcript must be sent directly to the Graduate School by that university’s registrar, so ask the registrar to send it before you send any request.';
/** "Unofficial" as a description of the TRANSCRIPT — a heading, a watermark
 * word, "this is not an official transcript" — never a grade legend's "UW
 * Unofficial Withdraw" (DGS 2026-09-16: a false rejection). */
export function isUnofficial(lines: readonly string[]): boolean {
  return lines.some((l) => {
    const flat = l.replace(/\s+/g, ' ').trim();
    if (/\bunofficial(ly)?\s+withdr/i.test(flat) || /\bwithdr/i.test(flat)) return false;
    if (/\bnot\s+an?\s+official\s+(transcript|record|copy|document)/i.test(flat)) return true;
    if (/\bunofficial\s+(academic\s+|student\s+|web\s+|copy\s+of\s+(the\s+)?)?(transcripts?|records?|copy|document)\b/i.test(flat)) return true;
    // A bare "UNOFFICIAL" on its own line or as a stamp ("UNOFFICIAL University at Buffalo Transcript").
    return /^\W*unofficial\W*$/i.test(flat) || /^\W*unofficial\b.*\btranscript\b/i.test(flat);
  });
}
/** The Previous Undergraduate row wants a FINISHED bachelor's record (DGS
 * 2026-09-11: "when previous undergraduate transcript shows as in-progress,
 * reject the transcript and show a warning message that says a completed BS
 * transcript is required"). A row without a final grade is the tell. */
// 'import', not 'upload' — the student's act; 'uploaded' is kept for the
// privacy fact (trim review 2026-09-18, P-53).
const BACHELORS_IN_PROGRESS =
  'This undergraduate transcript is still in progress — it lists courses without a final grade. A completed bachelor’s transcript is required here: import it again once the degree is finished and every course has a grade.';
/** `degreeStated`: the transcript itself says the bachelor's degree was
 * conferred ("Graduated on … with the degree of Bachelor …", a dated award
 * line, or — DGS 2026-10-15 — a closing line of only the degree's name and
 * its month and year, "DEGREE: BACHELOR OF ARTS   MAY   2022"). Then a row
 * without a readable grade is a parsing gap to fix in the preview, not an
 * in-progress course — the transcript is complete (DGS 2026-09-16: a false
 * "still in progress"). */
/** A row whose grade cell printed a result the app has no letter for — a
 * mark ("92"), a band word ("Very Good"), a "Pass" a legend makes a band —
 * carries `rawGrade`: that is a FINAL result for the student to map, not a
 * course without one (CC15, Batch C 2026-10-09: the code-less Chinese and
 * Egyptian bachelor's statements print only such results, and were refused
 * here as "still in progress"). Only those two shapes (review fix 2026-10-10:
 * ANY raw grade had come to count, so a status code — REG, CUR, PEND, NR,
 * NG, DEF, I, X — let an unfinished bachelor's record through): a MARK
 * (`FINAL_MARK_RE`) or a BAND WORD (`BAND_WORD_RE`). Any other raw grade is a
 * code the app cannot read, and the row counts as one without a final grade,
 * as it did before CC15. */
const FINAL_MARK_RE = /^\d{1,3}(?:[.,]\d{1,3})?(?:\s*\/\s*\d{1,3})?\s*%?(?:\s*(?:[A-Za-z]{1,3}|e\s+lode))?$/i;
// A mark: "92", "14,50", "16/20", "85%", and the band letters a transcript
// prints beside it ("61 CR", "47 FA", "30 e lode"). A band word: the grading
// bands of the Chinese and Egyptian statements CC15 was decided for
// ("Excellent", "Very Good", "Good", "Pass", "Fail") and their usual
// neighbours — never a status ("Incomplete", "Registered", "Pending").
const BAND_WORD_RE = /^(?:excellent|outstanding|very\s+good|good|fair|average|medium|acceptable|satisfactory|pass(?:ed)?|fail(?:ed)?|weak|very\s+weak|poor|distinction|merit)$/i;
export function undergraduateInProgress(slot: DegreeLevel, rows: { grade: string; rawGrade?: string }[], degreeStated = false): boolean {
  if (slot !== 'bachelors' || degreeStated) return false;
  const finalResult = (raw: string | undefined) => raw !== undefined && (FINAL_MARK_RE.test(raw.trim()) || BAND_WORD_RE.test(raw.trim().replace(/\s+/g, ' ')));
  return rows.some((r) => (r.grade === '' && !finalResult(r.rawGrade)) || r.grade === 'IP');
}

/** The note beside "Credit system on this transcript" (DGS 2026-10-10, item 3:
 * a system the student picked by hand still said it was "read from how the
 * transcript names its terms"). `read` is what the transcript reader found
 * (W-CL424 keeps its sentence when the menu still says that); a choice the
 * student made says so and what the reader found (W-CL427: quarter or
 * trimester picked by hand; W-CL428: semester picked over a system the reader
 * found). The reader can miss a system, so a choice over "nothing found" says
 * the reader found none, not that the transcript names none. Any non-semester
 * system, or any choice against the reader, is a warning: credits change. */
export function creditSystemNote(read: 'quarter' | 'trimester' | undefined, selected: 'quarter' | 'trimester' | 'semester' | undefined): { text: string; warn: boolean } {
  const chosen = selected === 'quarter' || selected === 'trimester' ? selected : undefined;
  const example = (sys: 'quarter' | 'trimester') => `a 4-credit course counts ${(4 * (creditSystemFactor(sys) ?? 1)).toFixed(2)} Notre Dame credits`;
  if (chosen !== undefined && chosen === read) {
    return { text: ` — read from how the transcript names its terms. Its credits will be converted (${example(chosen)}, §5.2 pro-rata). Change this if the parser misread; the DGS’s ruling for the university overrides it either way.`, warn: true };
  }
  const found = read ? `the parser read ${read} hours` : 'the parser found none on the transcript';
  if (chosen !== undefined) {
    return { text: ` — chosen by you; ${found}. Its credits will be converted (${example(chosen)}, §5.2 pro-rata); the DGS’s ruling for the university overrides your choice.`, warn: true };
  }
  if (read !== undefined) {
    return { text: ` — chosen by you; ${found}. Its credits will be counted as printed; the DGS’s ruling for the university overrides your choice.`, warn: true };
  }
  return { text: ' — change this if your university counts in quarter or trimester hours and the parser did not notice; credits are then converted pro-rata (§5.2).', warn: false };
}

/** The course one ready preview row becomes on Add — built field by field
 * from the values the student checked, never by copying the row, so nothing
 * the preview holds besides them reaches the record, its JSON export or its
 * localStorage copy: not the scan's raw readings (`ocrRead`, Batch C answer
 * (4)), and not the scanned-line images, which are not on the row at all
 * (src/ui/scan-strips.ts, answer (5) — tests/scan-strip.test.ts asserts it). */
export function courseEntryOf(r: PreviewRow, p: Pick<ExternalPreview, 'slot' | 'unofficial' | 'creditSystem' | 'creditSystemRead'>, university: string, imported?: { on: string; app: string }): CourseEntry {
  // Where the row came from (DGS 2026-10-11, item 6): typed in the preview,
  // or read from this transcript — with the fields the student changed.
  const changed = changedFields(r);
  const source = r.manual
    ? { typedByStudent: true as const }
    : imported
      ? { imported: { transcript: p.slot, on: imported.on, app: imported.app }, ...(changed.length > 0 ? { changedOnImport: changed } : {}) }
      : {};
  return {
    ...source,
    courseId: canonicalCourseId(r.courseId),
    title: r.title.trim() || undefined,
    credits: r.credits!,
    term: { season: r.season, year: r.year! },
    grade: r.grade as Grade,
    origin: 'transfer',
    institution: university,
    degreeLevel: degreeLevelFor(p.slot, r.level),
    // Notre Dame rows keep their registered level so a later
    // entry-term change can re-file them (prior-nd.ts).
    registeredLevel: isNotreDameInstitution(university) ? r.level : undefined,
    // The emails warn which transcripts were unofficial (DGS 2026-10-03).
    ...(p.unofficial ? { fromUnofficialTranscript: true as const } : {}),
    // The mark as printed, when the student mapped it to a letter (2026-10-03).
    ...(r.rawGrade ? { transcriptMark: r.rawGrade } : {}),
    ...((p.creditSystem === 'quarter' || p.creditSystem === 'trimester') && !isNotreDameInstitution(university)
      ? // Who chose it (DGS 2026-10-10, item 3): the report says "you chose …"
        // rather than "your transcript says …" for a system picked by hand.
        { creditSystem: p.creditSystem, ...(p.creditSystem !== p.creditSystemRead ? { creditSystemChosen: true as const } : {}) }
      : {}),
  };
}

/** One parsed course as a preview row: ticked, the transcript's level or the
 * slot's — or, for a course printed without a number (CC15, DGS 2026-10-09),
 * unticked with an empty id box until the student types one. */
export function previewRowOf(c: ExternalCourseCandidate, slot: DegreeLevel): PreviewRow {
  return {
    include: true,
    courseId: c.courseId,
    title: c.title ?? '',
    credits: c.credits,
    grade: (c.grade ?? '') as Grade | '',
    rawGrade: c.rawGrade,
    season: c.season ?? ('fall' as Season),
    year: c.year,
    lowConfidence: c.lowConfidence,
    ...(c.evidence ? { evidence: c.evidence } : {}),
    ...(c.ocrRead ? { ocrRead: { ...c.ocrRead } } : {}),
    ...(c.codeSuggestion ? { codeSuggestion: c.codeSuggestion } : {}),
    level: c.level ?? slotDefaultLevel(slot),
    levelSource: (c.level ? 'transcript' : 'slot') as PreviewRow['levelSource'],
    ...(c.codeMissing ? { codeMissing: true as const, include: false } : {}),
  };
}

/** The half of an external import both routes share — the text layer
 * (slotRow) and the OCR opt-in (scanOptInBlock): the parsed rows as preview
 * rows, the in-progress bachelor's refusal, the "Taken as" pre-fill, the
 * relevance filter and the preview itself. Returns the rows read and kept,
 * or undefined when the transcript was refused (the caller says why). */
function previewFromParsed(
  parsed: ExternalParseResult,
  slot: DegreeLevel,
  args: ExternalCardArgs,
  flags: { unofficial: boolean; fromOcr: boolean; scannerLayer?: boolean; ocrReducedPages?: OcrReducedPage[]; ocrTurned?: 0 | 90 | 180 | 270 },
): { mapped: PreviewRow[]; kept: { rows: PreviewRow[]; omitted: number } } | undefined {
  const mapped: PreviewRow[] = parsed.courses.map((c) => previewRowOf(c, slot));
  if (undergraduateInProgress(slot, mapped, parsed.bachelorsConferred === true)) return undefined;
  const termPrefill = prefillLevelsByTerm(mapped, slot, parsed.bachelorsNamed === true);
  const mixed = parsed.mixedLevels === true || new Set(mapped.map((r) => r.level)).size > 1;
  const kept = keepRelevantRows(parsed.university ?? '', args.rules, mapped, mixed, args.student.program);
  // What the reader read, as the preview first shows it (item 6, 2026-10-11).
  for (const r of [...mapped, ...kept.rows]) r.read ??= readingOf(r);
  const bachelors = bachelorsForPreview(slot, mixed, parsed.bachelorsConferredOn, termPrefill !== undefined, handSetBachelors(args.student));
  releaseScanStrips(); // an earlier preview's scanned lines go with it (Batch C answer (5))
  preview = {
    ...(flags.unofficial ? { unofficial: true } : {}),
    slot,
    university: parsed.university ?? '',
    ...(flags.fromOcr
      ? // OCR misreads names too — the field stays editable (2026-09-06).
        { fromOcr: true, ...(flags.scannerLayer ? { scannerLayer: true as const } : {}), ...(flags.ocrReducedPages?.length ? { ocrReducedPages: flags.ocrReducedPages } : {}), ...(flags.ocrTurned ? { ocrTurned: flags.ocrTurned } : {}) }
      : {
          // A name read from the transcript is locked; one recovered from an
          // acronym is pre-filled and editable (2026-09-08).
          universityFromTranscript: (parsed.university ?? '') !== '' && parsed.universityGuessed !== true,
          universityGuessed: parsed.universityGuessed,
        }),
    campusSystem: parsed.campusSystem,
    campus: parsed.campus,
    campusFromTranscript: parsed.campus !== undefined,
    conferred: parsed.degreeConferred,
    creditSystem: parsed.quarterSystem ? 'quarter' : parsed.trimesterSystem ? 'trimester' : undefined,
    creditSystemRead: parsed.quarterSystem ? 'quarter' : parsed.trimesterSystem ? 'trimester' : undefined,
    bachelorsConferredOn: parsed.bachelorsConferredOn,
    ...bachelors,
    rows: kept.rows,
    omitted: kept.omitted,
    transferSkipped: parsed.transferRowsSkipped,
    ...(parsed.nonLatinScript ? { nonLatinScript: true as const } : {}),
    mixedLevels: mixed || undefined,
    termPrefill,
    ...(parsed.printedTotals ? { printedTotals: parsed.printedTotals, allRows: mapped } : {}),
  };
  return { mapped, kept };
}

/** A transcript with Cyrillic text from which no course could be read
 * (round 5, item 20; DGS 2026-10-14). */
export function nonLatinNoRowsMessage(filename: string): string {
  return `No course could be read from “${filename}”: it has Cyrillic text, and the reader reads Latin-letter course codes only. Add each course by hand in the Coursework card: the code as printed (or in Latin letters) and the English title.`;
}

/** What a text-layer import that read no course does (round 5, item 20;
 * verification, reader-1 to reader-4, 2026-10-14): Cyrillic course codes get
 * their own message — the English OCR would read them no better — and
 * anything else is offered OCR, as before. A Cyrillic letterhead beside
 * Latin codes is not Cyrillic codes. A scanner's own text layer keeps the
 * OCR offer: that layer is another engine's reading, which may have read
 * Latin letters as Cyrillic. */
export function noRowsRoute(parsed: { cyrillicCodes?: true }, scannedTextLayer: boolean): 'cyrillic-codes' | 'offer-ocr' {
  return parsed.cyrillicCodes && !scannedTextLayer ? 'cyrillic-codes' : 'offer-ocr';
}

/** The preview's note on a transcript with Cyrillic text (DGS 2026-10-12). */
export const NON_LATIN_NOTE =
  'This transcript has Cyrillic text. The reader reads Latin-letter course codes only, so courses with Cyrillic codes may be missing below — add each one with “+ Add a row by hand”: the code as printed (or in Latin letters) and the English title.';

function slotRow(slot: { level: DegreeLevel; label: string }, args: ExternalCardArgs, earlierOpen = false): HTMLElement {
  const { student, update, toast, render } = args;
  const have = coursesInSlot(student, slot.level);
  const fileInput = el('input', { type: 'file', accept: '.pdf,application/pdf', class: `hidden external-file-${slot.level}`, 'aria-label': `${slot.label} PDF` });
  const fail = (message: string): void => failSlot(slot.level, message, render);
  fileInput.addEventListener('change', async () => {
    const file = (fileInput as HTMLInputElement).files?.[0];
    if (!file) return;
    importError = undefined;
    toast('Reading the transcript… (it never leaves this browser)');
    try {
      const { pdfToLinesForImport } = await import('../transcript/pdf.ts'); // pdfjs loads lazily
      // Keep the original bytes: pdfjs consumes the buffer it is given, and a
      // scan goes on to OCR (the student deciding) with the same file.
      const buffer = await file.arrayBuffer();
      const { lines, scannedTextLayer } = await pdfToLinesForImport(buffer.slice(0));
      const unofficial = isUnofficial(lines); // accepted with a warning on the preview (DGS 2026-09-17)
      const { parseExternalTranscript } = await import('../transcript/external.ts');
      // A NOTRE DAME transcript never belongs in a previous-degree row (DGS
      // 2026-09-22, superseding 2026-09-05): insideND prints ONE transcript
      // for every degree the student took here, and the Notre Dame row reads
      // the earlier degrees, their courses and the entry term from it.
      // Accepting it here too listed every earlier course twice.
      if (parseTranscript(lines).isNotreDame) return fail(ndInPreviousRow(student));
      // A scan whose scanner embedded its own text (every page one image
      // covering the page, the text invisible over it — Batch C answer (6),
      // DGS 2026-10-09, reversing the 2026-09-06 lock for this case only):
      // that text is another engine's reading, so it is read OCR-grade —
      // every line at SCANNER_LAYER_CONFIDENCE, every row editable and
      // flagged — and OCR is offered beside the preview. The junk-code guard
      // of our own engine's poor lines does not read it (review fix
      // 2026-10-10): it dropped real rows there, which the answer wanted kept.
      const parsed = scannedTextLayer ? parseExternalTranscript(lines, lines.map(() => SCANNER_LAYER_CONFIDENCE), { scannerLayer: true }) : parseExternalTranscript(lines);
      // A course outline or syllabus, not a record (DGS 2026-10-10, answer
      // 4a): said so, nothing imported — and no OCR offer, which would read
      // the same one line.
      if (parsed.notATranscript) return fail(notATranscriptMessage(file.name));
      if (!parsed.hasTextLayer) {
        // A scan or photo: never OCR silently — offer it (DGS decision 2026-09-02).
        pendingScan = { slot: slot.level, buffer, filename: file.name };
        render();
        return;
      }
      const made = previewFromParsed(parsed, slot.level, args, { unofficial, fromOcr: scannedTextLayer, ...(scannedTextLayer ? { scannerLayer: true } : {}) });
      if (!made) return fail(BACHELORS_IN_PROGRESS);
      const { mapped, kept } = made;
      if (mapped.length === 0) {
        // No course line in the text layer (DGS 2026-09-16): offer OCR — the
        // text layer may be an image's stray caption, or a layout the parser
        // cannot read that the OCR path can. Same opt-in as a scan — and a
        // scanned PDF whose embedded text gave no course is offered it as the
        // scan it is. Cyrillic course codes are out of scope (DGS 2026-10-12):
        // said so, with where to add the courses (round 5, item 20) — after
        // the empty preview is closed (verification, reader-1).
        preview = undefined;
        releaseScanStrips();
        if (noRowsRoute(parsed, scannedTextLayer) === 'cyrillic-codes') return fail(nonLatinNoRowsMessage(file.name));
        pendingScan = { slot: slot.level, buffer, filename: file.name, reason: scannedTextLayer ? 'scan' : 'no-lines' };
        render();
        return;
      }
      // The scanner's reading is previewed, and OCR offered beside it.
      if (scannedTextLayer) pendingScan = { slot: slot.level, buffer, filename: file.name, reason: 'scanner-layer' };
      if (kept.rows.length === 0) {
        previewError =
          args.student.program === 'phd'
            ? `All ${mapped.length} courses read from this transcript were left out — none matched the Alg / OS / Comp Arch core keywords, and none are in the DGS’s course rules. Courses taken as an undergraduate student do not transfer, whether or not the course itself is a graduate course (§5.2); if a course belongs to a core area under a different title, add it by hand below.`
            : `All ${mapped.length} courses read from this transcript were left out: every one of them was taken as an undergraduate student, and undergraduate credits do not transfer (§5.2), whether or not the course itself is a graduate course. If you took any of them after your bachelor’s degree was awarded, add it by hand below and set “Taken as” to Grad student.`;
      }
      render();
    } catch {
      fail(browserTooOldForPdfs() ? BROWSER_TOO_OLD_FOR_PDFS : 'That PDF could not be read (is it a PDF?). Only system-generated PDFs are accepted.');
    } finally {
      (fileInput as HTMLInputElement).value = '';
    }
  });

  // While any preview is open, Import and Remove are inactive and say why on
  // hover / click (DGS request 2026-09-06) — `inactiveButton`, not `disabled`,
  // so the reason can be shown.
  const button = (attrs: Record<string, string | boolean | ((ev: Event) => void)>, label: string): HTMLButtonElement =>
    args.blocked ? inactiveButton(attrs, PREVIEW_OPEN_NOTE, toast, label) : el('button', attrs, label);
  const parts: (Node | string)[] = [el('span', { class: 'slot-label' }, slot.label)];
  if (have.length > 0) {
    const uni = have[0]!.institution ?? 'another university';
    parts.push(
      el('span', { class: 'slot-sep', 'aria-hidden': 'true' }, ' — '),
      el('span', {}, `${have.length} course${have.length === 1 ? '' : 's'} from ${uni} `),
      button(
        {
          class: 'btn tiny',
          'aria-label': `Remove the ${have.length} ${slot.label} course${have.length === 1 ? '' : 's'} from ${uni}`,
          'data-key': `ext.remove.${slot.level}`,
          onclick: () => {
            // Undo instead of a confirm dialog (usability review 2026-09-05,
            // item 25): everything removed can be put back with one click.
            // Index-preserving (2026-09-06 evening): Undo puts every row back where it was.
            const removed = student.courses.map((c, i) => ({ c, i })).filter(({ c }) => inSlot(c, slot.level));
            const priorBefore = { priorMs: student.priorMs, inferred: student.priorMsInferred, earlier: earlierDegreesState(student) };
            // A course that also carried the Notre Dame record's acceptance
            // stays on the record as that transcript's block row (P3-import-1 (c)).
            const restored = removed.map(({ c }) => blockRowBack(c)).filter((c): c is CourseEntry => c !== undefined);
            update((s) => {
              s.courses = [...s.courses.filter((c) => !inSlot(c, slot.level)), ...restored];
              // If "Prior graduate study" was auto-set from a transcript and no
              // graduate transcript remains, undo the inference (2026-09-04).
              if (
                s.priorMsInferred === true &&
                !s.courses.some((c) => c.origin === 'transfer' && (c.degreeLevel === 'masters' || c.degreeLevel === 'phd'))
              ) {
                s.priorMs = 'none';
                s.priorMsInferred = undefined;
              }
              // What this transcript read into a draft answer goes with it
              // (review of Option 1, 2026-10-08).
              forgetReadings(s, slot.level);
            });
            args.toastWithAction?.(
              `${removed.length} ${slot.label} course${removed.length === 1 ? '' : 's'} removed.`,
              'Undo',
              () =>
                update((s) => {
                  s.courses = s.courses.filter((c) => !restored.includes(c));
                  for (const { c, i } of removed) s.courses.splice(Math.min(i, s.courses.length), 0, c);
                  s.priorMs = priorBefore.priorMs;
                  s.priorMsInferred = priorBefore.inferred;
                  restoreEarlierDegrees(s, priorBefore.earlier); // what Remove forgot (coverage review, 2026-10-08)
                }),
              { ttlMs: 20000, focusKey: `ext.remove.${slot.level}` },
            );
          },
        },
        'Remove',
      ),
    );
  } else {
    parts.push(
      el('span', { class: 'slot-sep', 'aria-hidden': 'true' }, ' — '),
      // Named for its own row (blue-team B7, 2026-09-18): all four import
      // buttons on this card had the accessible name "Import from PDF", with no
      // aria-label and no enclosing group label, so a screen-reader user
      // reached four identical controls and could not tell which transcript
      // each one wanted. The file inputs behind them were already named.
      // In simulation mode the import is inactive with its own reason (D6).
      (args.simulation
        ? (attrs: Record<string, string | boolean | ((ev: Event) => void)>, label: string) => inactiveButton(attrs, SIMULATION_IMPORT_NOTE, toast, label)
        : earlierOpen
          ? (attrs: Record<string, string | boolean | ((ev: Event) => void)>, label: string) => inactiveButton(attrs, EARLIER_DEGREES_FIRST_NOTE, toast, label)
          : button)(
        {
          class: 'btn',
          'data-key': `ext.import.${slot.level}`,
          'aria-label': `Import ${slot.label.toLowerCase()} from PDF`,
          onclick: () => (fileInput as HTMLInputElement).click(),
        },
        'Import from PDF',
      ),
      fileInput,
    );
  }
  if (importError?.slot === slot.level) {
    parts.push(
      el(
        'div',
        { class: 'import-error', role: 'alert', tabindex: '-1', 'data-key': `ext.error.${slot.level}` },
        el('span', {}, importError.message),
        ' ',
        el(
          'button',
          {
            class: 'btn tiny',
            'aria-label': 'Dismiss this message',
            onclick: () => {
              importError = undefined;
              render();
              document.querySelector<HTMLElement>(`[data-key="ext.import.${slot.level}"]`)?.focus();
            },
          },
          'Dismiss',
        ),
      ),
    );
  }
  return el('div', { class: 'external-slot' }, ...parts);
}

/** The explicit OCR opt-in for a scanned PDF (DGS decision 2026-09-02):
 * system-generated PDFs stay the encouraged path; OCR is approximate,
 * ENGLISH-ONLY, and never runs without the student choosing it. */
function scanOptInBlock(args: ExternalCardArgs): HTMLElement {
  const { render, student } = args;
  const scan = pendingScan!;
  return el(
    'div',
    { class: 'ocr-optin', role: 'note' },
    el(
      'p',
      {},
      scan.reason === 'no-lines'
        ? el('strong', {}, `No course-like lines could be read from “${scan.filename}” — its layout is new to the parser. `)
        : scan.reason === 'scanner-layer'
          ? el('strong', {}, scannerLayerLead(scan.filename))
          : el('strong', {}, `“${scan.filename}” looks like a scanned or photographed transcript. `),
      scan.reason === 'no-lines'
        ? 'You can try the built-in text recognition (OCR) on it instead, which reads the page as an image, or add the courses by hand below (and please tell the DGS which university, so parsing can be improved). OCR: '
        : scan.reason === 'scanner-layer'
          ? SCANNER_LAYER_OFFER
          : 'A scan cannot be read exactly — the reliable route is a system-generated PDF from your university’s portal. You can instead try the built-in text recognition (OCR): ',
      el('strong', {}, 'English-language transcripts only'),
      // "check every field" and "never leaves your browser" are said by the
      // card hint above and the preview heading (trim review 2026-09-18, P-89).
      ', and the result is approximate.',
    ),
    el(
      'div',
      { class: 'save-buttons' },
      // In simulation mode the opt-in is inactive with the imports' reason
      // (D6): the scan was uploaded before the mode (a simulation file loaded
      // over a waiting scan), and OCR would read real data into a plan. Cancel
      // stays active so the waiting scan can be cleared.
      (args.simulation ? (attrs: Record<string, string | boolean | ((ev: Event) => void)>, label: string) => inactiveButton(attrs, SIMULATION_IMPORT_NOTE, args.toast, label) : (attrs: Record<string, string | boolean | ((ev: Event) => void)>, label: string) => el('button', attrs, label))(
        {
          class: 'btn primary',
          'data-key': 'ext.scan.ocr',
          onclick: () => {
            const { slot, buffer } = scan;
            pendingScan = undefined;
            // OCR replaces the preview of the scanner's own text (Batch C
            // answer (6)): its rows must not be added beside OCR's.
            if (scan.reason === 'scanner-layer') {
              preview = undefined;
              releaseScanStrips();
              previewError = undefined;
            }
            ocrBusy = { label: 'Starting the text reader', percent: 0 };
            render();
            void (async () => {
              try {
                const { ocrPdfToLines } = await import('../transcript/ocr.ts');
                const { lines, pagesRead, pagesTotal, reducedPages, turned, pageImages } = await ocrPdfToLines(buffer, (progress) => {
                  ocrBusy = progress;
                  render();
                });
                const { parseExternalTranscript } = await import('../transcript/external.ts');
                const parsed = parseExternalTranscript(lines.map((l) => l.text), lines.map((l) => l.confidence));
                ocrBusy = undefined;
                const unofficial = isUnofficial(lines.map((l) => l.text)); // warned on the preview (DGS 2026-09-17)
                // The page copies are held only beside an open preview (Batch C answer (5)).
                const dropPages = () => emptyPageImages(pageImages);
                if (parsed.looksLikeNotreDame) {
                  dropPages();
                  failSlot(slot, `${ndInPreviousRow(student)} Use the digital PDF from insideND there, not a scan.`, render);
                  return;
                }
                const made = previewFromParsed(parsed, slot, args, { unofficial, fromOcr: true, ocrReducedPages: reducedPages, ocrTurned: turned });
                if (!made || !preview) {
                  dropPages();
                  failSlot(slot, BACHELORS_IN_PROGRESS, render);
                  return;
                }
                // The scanned line of each row (Batch C answer (5), DGS
                // 2026-10-09): the part of the page its source lines sit on,
                // held beside the preview's rows — never on them.
                const pageSize = (page: number) => {
                  const img = pageImages.get(page);
                  return img && img.scale > 0 ? { width: img.canvas.width / img.scale, height: img.canvas.height / img.scale } : undefined;
                };
                const regions = new Map<object, StripRegion>();
                parsed.courses.forEach((c, k) => {
                  const region = stripRegion(lines, c.sourceLines, pageSize);
                  const row = made.mapped[k];
                  if (region && row) regions.set(row, region);
                });
                holdScanStrips(preview, pageImages, regions);
                if (parsed.courses.length === 0) {
                  previewError = `OCR finished but found no course-like lines (${pagesRead} of ${pagesTotal} pages read). You can add the courses by hand below.`;
                } else if (pagesTotal > pagesRead) {
                  previewError = `Read the first ${pagesRead} of ${pagesTotal} pages (the reader stops at ${pagesRead}) — later pages must be added by hand.`;
                }
                render();
              } catch (e) {
                // Leave a breadcrumb for debugging without surfacing internals.
                console.error('OCR failed:', e);
                ocrBusy = undefined;
                failSlot(slot, 'The text reader could not run in this browser — please use a system-generated PDF instead.', render);
              }
            })();
          },
        },
        'Try OCR (English only)',
      ),
      el('button', { class: 'btn', 'data-key': 'ext.scan.cancel', onclick: () => { pendingScan = undefined; render(); } }, scan.reason === 'scanner-layer' ? SCANNER_LAYER_KEEP : 'Cancel'),
    ),
  );
}

/** Progress line while OCR runs (model load, then page by page). */
function ocrProgressBlock(): HTMLElement {
  const busy = ocrBusy!;
  return el(
    'div',
    { class: 'ocr-progress', role: 'status', 'aria-live': 'polite' },
    el('span', { class: 'spin sm', 'aria-hidden': 'true' }),
    ` ${busy.label}… ${busy.percent}%`,
  );
}

/** One sentence on where the "Taken as" values came from (DGS request
 * 2026-09-06: say how Graduate/Undergraduate were pre-filled, and ask for a
 * check). Three sources, most specific first: the transcript's own markers,
 * the two-year rule (which runs only when the transcript states no level at
 * all — DGS 2026-09-06 evening), the slot. */
function levelNote(p: ExternalPreview): string {
  const fromTranscript = p.rows.filter((r) => r.levelSource === 'transcript').length;
  const byTerm = p.rows.filter((r) => r.levelSource === 'term').length;
  const byAward = p.rows.filter((r) => r.levelSource === 'award').length;
  const parts: string[] = [];
  if (fromTranscript > 0) {
    parts.push(
      `${fromTranscript === p.rows.length ? 'every row' : `${fromTranscript} row${fromTranscript === 1 ? '' : 's'}`} from the level the transcript itself states (a UG/GR column, a “Level” block, or the date your bachelor’s degree was awarded)`,
    );
  }
  if (byTerm > 0 && p.termPrefill) {
    parts.push(
      `${byTerm === p.rows.length ? 'every row' : `${byTerm} row${byTerm === 1 ? '' : 's'}`} by the two-year rule — the transcript does not label them, so courses from ${termLabel(p.termPrefill.graduateFrom)} on (the last two years of the record, ending ${termLabel(p.termPrefill.latest)}) are marked “Grad student” and earlier ones “UG student”`,
    );
  }
  if (byAward > 0 && p.bachelorsAwarded) {
    parts.push(
      `${byAward === p.rows.length ? 'every row' : `${byAward} row${byAward === 1 ? '' : 's'}`} by the bachelor’s award term you set (${termLabel(p.bachelorsAwarded)}) — dated in or before it → “UG student”, later → “Grad student”`,
    );
  }
  const bySlot = p.rows.length - fromTranscript - byTerm - byAward;
  if (bySlot > 0) {
    parts.push(`${bySlot === p.rows.length ? 'every row' : `${bySlot} row${bySlot === 1 ? '' : 's'}`} as “${p.slot === 'bachelors' ? 'UG student' : 'Grad student'}” because this is the ${DEGREE_SLOTS.find((sl) => sl.level === p.slot)!.label} row`);
  }
  const text = parts.join('; ');
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}

/** One row of the preview table. Every control in a row names its row
 * (usability review 2026-09-05, item 5): a screen reader says "Credits for
 * CS 25100", not just "spin button". */
function previewRow(
  p: ExternalPreview,
  r: PreviewRow,
  i: number,
  ctx: { rules: Rules; student: Student; toast: (msg: string) => void; render: () => void; blockedNote: string },
): HTMLElement {
  const { rules, student, toast, render, blockedNote } = ctx;
  // A code-less row (CC15) is named by its title until it has an id.
  const who = () => (r.courseId.trim() ? r.courseId.trim() : r.codeMissing && r.title.trim() ? `“${r.title.trim()}”` : `row ${i + 1}`);
  // An undergraduate row that cannot matter is not selectable (DGS request
  // 2026-09-06): the box is disabled and the row explains why on hover; a
  // change of "Taken as" re-renders, so the box follows the level.
  const blocked = isBlockedRow(p, rules, r, student.program);
  if (blocked) r.include = false;
  // A code-less row (CC15, DGS 2026-10-09) cannot be ticked until its id is
  // typed — the same lock, with its own reason.
  const idMissing = idStillMissing(r);
  if (idMissing) r.include = false;
  const noteId = `ext-row-${i}-note`;
  const idNoteId = `ext-row-${i}-idnote`;
  const cb = el('input', {
    type: 'checkbox',
    'aria-label': `Add ${who()}`,
    'data-key': `ext.row.${i}.include`,
    ...(blocked ? { disabled: 'disabled', 'aria-describedby': noteId, title: blockedNote } : idMissing ? { disabled: 'disabled', 'aria-describedby': idNoteId, title: CODE_MISSING_NOTE } : {}),
    onchange: (e) => {
      r.include = (e.target as HTMLInputElement).checked;
      render(); // the Add button's count follows (item 13)
    },
  });
  cb.checked = r.include;
  // Course number and title as the transcript printed them (DGS request
  // 2026-09-06): fixed for a text-layer import; editable for OCR rows (the
  // reader misreads) and rows typed by hand.
  const locked = !p.fromOcr && !r.manual;
  // …except the id of a course the transcript printed no number for (CC15):
  // an empty, required box the student fills, editable for as long as the
  // preview is open; filling it ticks the row, emptying it unticks it.
  const idOpen = !locked || r.codeMissing === true;
  const idIn = !idOpen
    ? el('span', { class: 'course-id locked', 'data-key': `ext.row.${i}.id` }, r.courseId)
    : el('input', {
        value: r.courseId,
        class: 'course-id',
        'aria-label': `Course id, ${who()}`,
        'data-key': `ext.row.${i}.id`,
        ...(r.codeMissing ? { required: 'required', 'aria-required': 'true', placeholder: CODE_MISSING_PLACEHOLDER, title: CODE_MISSING_NOTE, 'aria-describedby': idNoteId, ...(idMissing ? { 'aria-invalid': 'true' } : {}) } : {}),
      });
  if (idOpen) {
    idIn.addEventListener('change', () => {
      r.courseId = (idIn as HTMLInputElement).value;
      if (r.codeMissing) {
        r.include = !idStillMissing(r) && !isBlockedRow(p, rules, r, student.program);
        render(); // the tick box and the Add button's count follow
      }
    });
  }
  // The scan may have printed a letter for a digit in the course number
  // (DGS 2026-10-12, the middle way): the corrected number is offered, not
  // applied — one click puts it in the box; the row stays flagged.
  const suggestion =
    idOpen && r.codeSuggestion !== undefined && r.courseId.trim() !== r.codeSuggestion
      ? el(
          'button',
          {
            type: 'button',
            class: 'btn tiny code-suggestion',
            'data-key': `ext.row.${i}.id.suggestion`,
            title: `The scan may have printed a letter for a digit in “${r.courseId}” — check it against the paper`,
            onclick: () => {
              r.courseId = r.codeSuggestion!;
              render();
              // The button is gone after the render: focus the box it filled.
              document.querySelector<HTMLInputElement>(`[data-key="ext.row.${i}.id"]`)?.focus();
            },
          },
          `Use ${r.codeSuggestion}?`,
        )
      : null;
  const titleIn = locked
    ? el('span', { class: 'course-title locked', 'data-key': `ext.row.${i}.title` }, r.title)
    : el('input', { value: r.title, class: 'course-title', 'aria-label': `Title for ${who()}`, 'data-key': `ext.row.${i}.title` });
  if (!locked) titleIn.addEventListener('change', () => (r.title = (titleIn as HTMLInputElement).value));
  // Credits, grade and term are locked too for a text-layer import (DGS
  // request 2026-09-06, second pass) — as printed on the transcript. A value
  // the parser could not read stays an input, or the row could never be
  // completed; OCR and hand-typed rows stay fully editable.
  const lockedText = (cls: string, key: string, text: string | HTMLElement): HTMLElement => el('span', { class: `${cls} locked`, 'data-key': `ext.row.${i}.${key}` }, text);
  let crIn: HTMLElement;
  if (locked && r.credits !== undefined) crIn = lockedText('course-credits', 'credits', `${r.credits} cr`);
  else {
    // Fifteen credits is the most any single course may be worth (DGS
    // 2026-09-18), so this box takes the SAME bound as the add-course form
    // rather than its old decorative max="30" with a `v > 0` guard. A value
    // outside it leaves the row incomplete (so it cannot be added) and says
    // why, instead of blanking itself without a word.
    crIn = el('input', {
      type: 'number',
      min: String(COURSE_CREDITS_RANGE.min),
      max: String(COURSE_CREDITS_RANGE.max),
      step: '0.5',
      'aria-label': `Credits for ${who()}`,
      'data-key': `ext.row.${i}.credits`,
      value: r.credits !== undefined ? String(r.credits) : '',
    });
    crIn.addEventListener('change', () => {
      const text = (crIn as HTMLInputElement).value;
      const v = Number(text);
      // A blank box is "not filled in yet", as it always was — only a value
      // the app will not keep is refused out loud.
      const keep = inRange(v, COURSE_CREDITS_RANGE) && v > 0;
      r.credits = keep ? v : undefined;
      if (text !== '' && !keep) {
        crIn.setAttribute('aria-invalid', 'true');
        toast(inputRefusal(text, COURSE_CREDITS_RANGE, 'added'));
      } else {
        crIn.removeAttribute('aria-invalid');
      }
    });
  }
  let gradeSel: HTMLElement;
  if (locked && r.grade !== '') gradeSel = lockedText('course-grade', 'grade', r.grade === 'IP' ? 'In progress' : r.grade);
  else {
    gradeSel = el('select', { 'aria-label': `Grade for ${who()}`, 'data-key': `ext.row.${i}.grade` });
    gradeSel.append(option('', r.rawGrade ? `choose… (transcript says “${r.rawGrade}”)` : 'choose…', r.grade === ''));
    for (const g of GRADES) gradeSel.append(option(g, g === 'IP' ? 'In progress' : g, r.grade === g));
    gradeSel.addEventListener('change', () => (r.grade = (gradeSel as HTMLSelectElement).value as Grade | ''));
  }
  // What the scan showed in a credits or grade cell the OCR numeric
  // correction filled (Batch C answer (4), DGS 2026-10-09): beside the value,
  // and named by the box for a screen reader.
  const rawNote = (field: 'credits' | 'grade', box: HTMLElement): HTMLElement | null => {
    const raw = r.ocrRead?.[field];
    if (raw === undefined) return null;
    const id = `ext-row-${i}-${field}-raw`;
    box.setAttribute('aria-describedby', [box.getAttribute('aria-describedby'), id].filter(Boolean).join(' '));
    return el('span', { class: 'ocr-raw', id, title: ocrRawTitle(raw), 'data-key': `ext.row.${i}.${field}.raw` }, ocrRawNote(raw));
  };
  const creditsRaw = rawNote('credits', crIn);
  const gradeRaw = rawNote('grade', gradeSel);
  // The term: one locked "Fall 2023" when the transcript gave both parts.
  const termLocked = locked && r.year !== undefined;
  // One line only when nothing is left to fill in (DGS bug 2026-09-07): a
  // text-layer row whose credits, grade or year the parser missed renders
  // full-size controls, and the one-line form cannot wrap around them.
  const compactRow = rowIsCompact({ locked, credits: r.credits, grade: r.grade, year: r.year, codeMissing: r.codeMissing === true });
  let seasonSel: HTMLElement;
  let yearIn: HTMLElement | null;
  if (termLocked) {
    // The short form in the cell, the full name as the tooltip (DGS 2026-09-07).
    seasonSel = lockedText('course-term', 'season', el('abbr', { class: 'term', title: termLabel({ season: r.season, year: r.year! }) }, termShort({ season: r.season, year: r.year! })));
    yearIn = null;
  } else {
    seasonSel = el('select', { 'aria-label': `Semester for ${who()}`, 'data-key': `ext.row.${i}.season` });
    for (const se of SEASONS) seasonSel.append(option(se, seasonName(se), r.season === se));
    seasonSel.addEventListener('change', () => (r.season = (seasonSel as HTMLSelectElement).value as Season));
    // The same floor as every other term year, and no ceiling (DGS
    // 2026-09-18). The old `v > 1900` accepted 1950 and 9999 alike.
    yearIn = el('input', {
      type: 'number',
      min: String(TERM_YEAR_RANGE.min),
      'aria-label': `Year for ${who()}`,
      'data-key': `ext.row.${i}.year`,
      value: r.year !== undefined ? String(r.year) : '',
    });
    yearIn.addEventListener('change', () => {
      const text = (yearIn as HTMLInputElement).value;
      const v = Number(text);
      const keep = inRange(v, TERM_YEAR_RANGE);
      r.year = keep ? v : undefined;
      if (text !== '' && !keep) {
        yearIn!.setAttribute('aria-invalid', 'true');
        toast(inputRefusal(text, TERM_YEAR_RANGE, 'added'));
      } else {
        yearIn!.removeAttribute('aria-invalid');
      }
    });
  }
  // Taken as (2026-09-05): the level decides Bachelor's vs graduate coursework on add.
  const levelSel = el('select', {
    class: 'row-level',
    'aria-label': `Taken as (level) for ${who()}`,
    title: `Taken as — your status when you took the course, not the course’s level: a graduate-level course taken before your bachelor’s degree was awarded counts as undergraduate coursework${student.program === 'phd' ? ' (§4.4.1 core knowledge only, no transfer credit — §5.2)' : ' (no transfer credit — §5.2)'}`,
    'data-key': `ext.row.${i}.level`,
  });
  // "UG student" / "Grad student" (DGS 2026-09-06 late evening, shortened
  // 2026-09-07): a bare "Undergraduate" next to a 500-level course read as
  // the course's level and confused students; the word "student" says whose
  // status it is.
  levelSel.append(option('undergraduate', 'UG student', r.level === 'undergraduate'), option('graduate', 'Grad student', r.level === 'graduate'));
  levelSel.addEventListener('change', () => {
    r.level = (levelSel as HTMLSelectElement).value as PreviewRow['level'];
    r.levelSource = 'slot'; // the student decided — no longer "by the rule"
    // A row that becomes relevant is offered ticked, like every other
    // relevant row; one that becomes irrelevant is unticked and locked.
    if (!isBlockedRow(p, rules, r, student.program)) r.include = true;
    render();
  });
  // A locked (text-layer) row is COMPACT (DGS request 2026-09-06, second
  // pass): two lines — tick, number and title; then "4 cr · A · Fall 2023 ·
  // Taken as [level]" — no field labels (the values speak for themselves).
  // Editable rows (OCR, typed by hand) keep their labelled inputs.
  const tr = el(
    'tr',
    {
      class: [r.lowConfidence ? 'ocr-low' : '', blocked ? 'prior-row blocked-row' : '', compactRow ? 'compact' : 'editable'].join(' ').trim(),
      ...(blocked ? { title: blockedNote } : {}),
    },
    el(
      'td',
      { class: 'cell-check' },
      r.lowConfidence
        ? p.scannerLayer
          ? el('span', { title: SCANNER_LAYER_ROW_FLAG, 'aria-label': SCANNER_LAYER_ROW_FLAG_NAME }, '⚠')
          : el('span', { title: OCR_FLAG_TITLE[r.evidence ?? 'confidence'], 'aria-label': r.evidence ? 'check this row' : 'low OCR confidence' }, '⚠')
        : null,
      cb,
      blocked ? el('span', { id: noteId, class: 'visually-hidden' }, blockedNote) : null,
      r.codeMissing ? el('span', { id: idNoteId, class: 'visually-hidden' }, CODE_MISSING_NOTE) : null,
    ),
    el('td', { class: 'cell-course', 'data-label': 'Course id' }, idIn, suggestion),
    // (The greyed row + disabled box are the visible cue; the reason is the
    // hover text and the box's aria-describedby — DGS 2026-09-06: no tag.)
    el('td', { class: 'cell-title', 'data-label': 'Title' }, titleIn),
    el('td', { class: `cell-meta${locked && r.credits !== undefined ? ' locked-cell' : ''}`, 'data-label': 'Credits' }, crIn, creditsRaw),
    el('td', { class: `cell-meta${locked && r.grade !== '' ? ' locked-cell' : ''}`, 'data-label': 'Grade' }, gradeSel, gradeRaw),
    el('td', { class: `cell-meta${termLocked ? ' locked-cell' : ''}`, 'data-label': 'Term' }, seasonSel),
    termLocked ? el('td', { class: 'cell-meta cell-empty', 'data-label': 'Year' }) : el('td', { class: 'cell-meta', 'data-label': 'Year' }, yearIn),
    el('td', { class: 'cell-meta level-cell', 'data-label': 'Taken as' }, levelSel),
    // The scanned line this row was read from (Batch C answer (5), DGS
    // 2026-10-09): at once on a flagged row, behind "show the scanned line"
    // on the others — OCR previews only, and only while the preview is open.
    ((strip) => (strip ? el('td', { class: 'cell-scan', 'data-label': 'Scanned line' }, strip) : null))(scanStripFor(p, r, i, r.lowConfidence === true)),
  );
  return tr;
}

function previewBlock(args: ExternalCardArgs): HTMLElement {
  const { rules, update, toast, render, student } = args;
  const p = preview!;
  const slotLabel = DEGREE_SLOTS.find((s) => s.level === p.slot)!.label;
  const box = el('div', { class: 'transcript-preview' });
  // The university name is locked when the transcript supplied it (DGS
  // request 2026-09-06): the DGS's rules key on the name as printed. Only a
  // name the parser could not find (or an OCR guess) is typed by the student.
  const uniLocked = p.universityFromTranscript === true && !p.fromOcr;
  const uniInput = el('input', { value: p.university, list: 'known-universities', 'data-key': 'ext.preview.university', 'aria-describedby': 'ext-university-hint', ...(uniLocked ? { readonly: 'readonly', class: 'locked' } : {}) });
  if (!uniLocked) {
    uniInput.addEventListener('change', () => {
      // Title-Cased on leaving the box (DGS 2026-09-06 evening); matching ignores case.
      const v = canonicalUniversityName((uniInput as HTMLInputElement).value);
      (uniInput as HTMLInputElement).value = v;
      p.university = v;
    });
    uniInput.addEventListener('input', () => {
      if (previewError) {
        previewError = undefined;
        box.querySelector('.import-error')?.remove();
      }
    });
  }
  box.append(
    el('h3', {}, `${slotLabel} — check every line, fix what the parser got wrong, then add`),
    ...(previewError ? [el('div', { class: 'import-error', role: 'alert', tabindex: '-1', 'data-key': 'ext.preview.error' }, previewError)] : []),
    ...(p.fromOcr && p.scannerLayer
      ? [el('div', { class: 'ocr-banner', role: 'note', 'data-key': 'ext.preview.scannerLayer' }, el('strong', {}, SCANNER_LAYER_BANNER_LEAD), SCANNER_LAYER_BANNER)]
      : p.fromOcr
      ? [
          el(
            'div',
            { class: 'ocr-banner', role: 'note' },
            el('strong', {}, 'Read by OCR from a scan — approximate. English transcripts only. '),
            'Check every field against your transcript before adding; rows marked ⚠ were hard to read.',
            ...(p.ocrTurned ? [' ', ocrTurnedNote(p.ocrTurned)] : []),
            ...(p.ocrReducedPages?.length ? [' ', ocrReducedPagesNote(p.ocrReducedPages)] : []),
          ),
        ]
      : []),
    ...(p.creditSystem !== undefined || !p.fromOcr
      ? [
          (() => {
            // The credit system, read from the transcript and correctable
            // here (quarter 2026-09-11, trimester 2026-09-12 — §5.2:
            // "Credits not earned on the semester system, such as trimester
            // and quarter-hour credits, will be transferred on a pro-rata
            // basis"). A quarter transcript's 4 credits are 2.64 Notre Dame
            // credits, a trimester's 3.52; the DGS's row for the university
            // overrides whatever is chosen.
            // The Graduate School's factors (DGS Handbook §3.14), in code
            // since 2026-10-04 — they were sheet rows from 2026-09-12.
            const factorOf = (sys: 'quarter' | 'trimester') => creditSystemFactor(sys) ?? 1;
            // Short enough to show whole on a 320 px phone (cross-browser
            // review, 2026-10-10: "— counted as printed" / "— converted at
            // 0.66" were cut there); the sentence after the menu gives the
            // effect in credits.
            const at = (sys: 'quarter' | 'trimester') => `(× ${factorOf(sys).toFixed(2)})`;
            const sel = el('select', { 'data-key': 'ext.preview.creditsystem' });
            for (const [value, label] of [
              ['semester', 'Semester hours (as printed)'],
              ['quarter', `Quarter hours ${at('quarter')}`],
              ['trimester', `Trimester hours ${at('trimester')}`],
            ] as const) {
              const o = el('option', { value }, label);
              if ((p.creditSystem ?? 'semester') === value) o.setAttribute('selected', 'selected');
              sel.append(o);
            }
            sel.addEventListener('change', () => {
              const v = (sel as HTMLSelectElement).value;
              p.creditSystem = v === 'quarter' || v === 'trimester' ? v : 'semester';
              render();
            });
            const { text: note, warn } = creditSystemNote(p.creditSystemRead, p.creditSystem);
            return el(
              'p',
              { class: `hint ${warn ? 'warn' : ''} quarter-note` },
              el('label', {}, 'Credit system on this transcript: ', sel),
              note,
            );
          })(),
        ]
      : []),
    ...(p.unofficial ? [el('p', { class: 'hint warn unofficial-note', 'data-key': 'ext.preview.unofficial' }, UNOFFICIAL_WARNING)] : []),
    ...(p.mixedLevels
      ? [
          el(
            'p',
            { class: 'hint warn mixed-note' },
            el('strong', {}, 'How “Taken as” was filled in: '),
            levelNote(p),
            ' “Taken as” is your status when you took the course, not the course’s level: a graduate-level course (a 500- or 600-level one, say) taken before your bachelor’s degree was awarded still counts as undergraduate coursework. Check every row before adding. ',
            student.program === 'phd'
                ? 'Undergraduate rows: no transfer credit (§5.2); they can only satisfy a core-knowledge area (§4.4.1), and the ones that cannot start unticked. Graduate rows: transfer candidates (§5.2).'
                : 'Undergraduate rows: no transfer credit (§5.2) and nothing else in the MSCSE, so they are not offered. Graduate rows: transfer candidates (§5.2).',
          ),
        ]
      : p.slot === 'bachelors'
        ? [
            el(
              'p',
              { class: 'hint warn' },
              `Courses taken as an undergraduate student do not transfer, whether or not the course itself is a graduate course (§5.2), so ${
                student.program === 'phd'
                  ? 'only courses relevant to the Alg, OS, and Comp Arch core-knowledge areas (§4.4.1) — or already reviewed by the DGS — are shown and added'
                  : 'only Notre Dame coursework that can still count toward the MSCSE is shown and added'
              }${p.omitted ? ` (${p.omitted} other course${p.omitted === 1 ? ' was' : 's were'} read and left out)` : ''}.`,
            ),
          ]
        : // The preview's own heading already says "check every line" (trim review 2026-09-18, P-93).
          [el('p', { class: 'hint level-note' }, el('strong', {}, 'How “Taken as” was filled in: '), levelNote(p), ' “Taken as” is your status at the time, not the course’s level.')]),
    // Cyrillic course codes are out of scope (DGS 2026-10-12): the reader may
    // miss those rows, and the student adds them by hand.
    ...(p.nonLatinScript ? [el('p', { class: 'hint warn', 'data-key': 'ext.nonlatin' }, NON_LATIN_NOTE)] : []),
    ...(p.transferSkipped
      ? [
          el(
            'p',
            { class: 'hint warn' },
            // Since F5 (2026-10-09) the skipped rows may also come from a
            // "Credits/Exemptions" block (Minerva), so the heading is named
            // generically (W-CL372).
            `${p.transferSkipped} row${p.transferSkipped === 1 ? '' : 's'} listed under a transfer-credit or credits/exemptions heading ${p.transferSkipped === 1 ? 'was' : 'were'} left out — those courses were taken at another school and belong on that school’s own transcript.`,
          ),
        ]
      : []),
    // Courses already on the Notre Dame transcript as accepted transfer credit
    // (P3-import-1 (c), 2026-10-05): adding keeps each as one course.
    ...(() => {
      // (A row with no id yet — CC15 — is no course to compare.)
      const onRecord = p.rows.filter((r) => r.courseId.trim() !== '' && blockRowFor(student, { courseId: r.courseId, institution: p.university, origin: 'transfer' } as CourseEntry) !== undefined).map((r) => r.courseId.trim());
      return onRecord.length > 0
        ? [el('p', { class: 'hint on-record-note' }, `${onRecord.join(', ')} ${onRecord.length === 1 ? 'is' : 'are'} already on your Notre Dame transcript as accepted transfer credit — adding keeps each as one course, with that acceptance.`)]
        : [];
    })(),
    // The rows checked against the transcript's own totals (item 11, 2026-10-11).
    ...(() => {
      const m = previewTotalsCheck(p);
      return m.length > 0
        ? [el('div', { class: 'import-warnings totals-check', role: 'note', 'data-key': 'ext.preview.totals' }, el('strong', {}, 'These do not add up — check the rows against your PDF: '), el('ul', {}, ...m.map((x) => el('li', {}, x.message))))]
        : [];
    })(),
    // Courses printed without a number (CC15, DGS 2026-10-09).
    ...(() => {
      const codeless = p.rows.filter((r) => r.codeMissing).length;
      return codeless > 0 ? [el('p', { class: 'hint code-missing-note', 'data-key': 'ext.preview.codeMissing' }, codeMissingHint(codeless))] : [];
    })(),
    el(
      'p',
      { class: 'hint', id: 'ext-university-hint' },
      uniLocked
        ? // Shortened (trim review 2026-09-18, P-88): the locked values show in the rows themselves.
          'The university name and each course are shown as your transcript prints them and cannot be edited here; only “Taken as” can be changed. Fill in anything the parser could not read (a grade, credits or a year) — rows without a grade are not added.'
        : p.universityGuessed
          ? // The name is nowhere in this transcript's text — it was worked out
            // from an abbreviation (2026-09-08). Say so, since the student is
            // the only one who can tell whether it is right.
            'This transcript does not print its university’s name as text, so the name above was worked out from an abbreviation in it — check it, and correct it if it is wrong. Grades the parser could not read must be chosen by hand (rows without a grade are not added).'
          : 'The university name is how the DGS’s rules find your courses — use the name as your transcript prints it (pick it from the list if it is there). Grades the parser could not read must be chosen by hand (rows without a grade are not added).',
    ),
    el('label', { class: 'field' }, el('span', { class: 'label' }, 'University'), uniInput),
    // A multi-campus system (DGS 2026-09-12): "University of California" is
    // ten schools, and the rules are keyed on the campus. Required — the
    // Add button refuses until it is chosen; pre-filled when the record
    // named the campus, and always correctable.
    ...(() => {
      const system = p.campusSystem ? MULTI_CAMPUS_SYSTEMS.find((s) => s.system === p.campusSystem) : undefined;
      if (!system) return [];
      const sel = el('select', { 'data-key': 'ext.preview.campus', 'aria-describedby': 'ext-campus-hint', required: 'required' });
      sel.append(option('', 'Choose the campus…', p.campus === undefined));
      for (const cp of system.campuses) sel.append(option(cp.name, cp.full, p.campus === cp.name));
      sel.addEventListener('change', () => {
        const chosen = system.campuses.find((cp) => cp.name === (sel as HTMLSelectElement).value);
        p.campus = chosen?.name;
        p.university = chosen ? chosen.full : system.system;
        p.campusFromTranscript = false;
        if (previewError) previewError = undefined;
        render();
      });
      return [
        el('label', { class: 'field campus-field' }, el('span', { class: 'label' }, `${campusQuestion(system)} (required)`), sel),
        el(
          'p',
          { class: `hint ${p.campus === undefined ? 'warn' : ''} campus-note`, id: 'ext-campus-hint' },
          p.campus === undefined
            ? `Your transcript names only the ${system.system} system, and the course rules are keyed on the campus — choose yours before adding. It becomes the university name above.`
            : p.campusFromTranscript
              ? `Campus read from your transcript. Change it if that is wrong — the university name above follows it.`
              : `The university name above follows this choice.`,
        ),
      ];
    })(),
    // On every graduate-slot preview, whether or not this transcript says
    // anything about the bachelor's (DGS 2026-09-09: also on the prior Ph.D.
    // upload). The term decides which of these courses were taken with
    // graduate student status, so §5.2 needs it here as much as on a Master's
    // transcript; the bachelor's slot is the degree itself and reads its own
    // conferral date.
    ...(p.slot !== 'bachelors'
      ? [
          bachelorsField(p, rules, render, student.program, (term) =>
            // Kept in step with "Your standing" as the student types (DGS
            // 2026-09-13): the record used to change only on Add, which
            // looked like the entry had not taken.
            update((s) => {
              s.bachelorsAwarded = term;
              s.bachelorsAwardedInferred = undefined;
            }),
          ),
        ]
      : []),
  );
  const table = el('table', { class: 'courses stack edit' });
  table.append(
    el(
      'tr',
      {},
      el('th', { scope: 'col' }, el('span', { class: 'visually-hidden' }, 'Add')),
      el('th', { scope: 'col' }, 'Course id'),
      el('th', { scope: 'col' }, 'Title'),
      el('th', { scope: 'col', abbr: 'Credits' }, 'Cr'),
      el('th', { scope: 'col' }, 'Grade'),
      el('th', { scope: 'col' }, 'Term'),
      el('th', { scope: 'col' }, 'Year'),
      // .level-head: the one header the compact preview shows (DGS 2026-09-07).
      el('th', { scope: 'col', class: 'level-head', title: `Your status when you took the course — not the course’s level. A graduate-level course taken before your bachelor’s degree was awarded still counts as undergraduate coursework${student.program === 'phd' ? ': §4.4.1 core knowledge only, no transfer credit (§5.2).' : ', which brings no transfer credit (§5.2).'}` }, 'Taken as'),
      // The scanned lines' column (Batch C answer (5)) — OCR previews only.
      holdsScanStrips(p) ? el('th', { scope: 'col', class: 'scan-head' }, el('span', { class: 'visually-hidden' }, 'Scanned line')) : null,
    ),
  );
  const blockedNote = blockedRowNote(student.program);
  // A row of a term that does not add up (item 11): marked, and said.
  const doubted = new Set(doubtedTerms(previewTotalsCheck(p)).map((t) => termIndex(t)));
  const rowEls = p.rows.map((r, i) => {
    const row = previewRow(p, r, i, { rules, student, toast, render, blockedNote });
    if (r.year !== undefined && doubted.has(termIndex({ season: r.season, year: r.year }))) {
      row.classList.add('totals-doubt');
      row.querySelector('td:nth-child(2)')?.append(el('span', { class: 'totals-doubt-note' }, `⚠ ${termLabel({ season: r.season, year: r.year })} does not add up: check this row`));
    }
    return row;
  });
  table.append(...rowEls);
  const selectAll = (on: boolean) => {
    for (const r of p.rows) r.include = on && !isBlockedRow(p, rules, r, student.program) && !idStillMissing(r);
    render();
  };
  box.append(
    el(
      'p',
      { class: 'select-links' },
      el('button', { class: 'btn tiny', 'data-key': 'ext.preview.all', onclick: () => selectAll(true) }, 'Select all'),
      ' ',
      el('button', { class: 'btn tiny', 'data-key': 'ext.preview.none', onclick: () => selectAll(false) }, 'Select none'),
    ),
    table,
  );
  box.append(
    el('button', {
      class: 'btn tiny',
      'data-key': 'ext.preview.addRow',
      onclick: () => {
        p.rows.push({ include: true, courseId: '', title: '', credits: 3, grade: '', season: 'fall', year: undefined, level: slotDefaultLevel(p.slot), levelSource: 'slot', manual: true });
        render();
        document.querySelector<HTMLElement>(`[data-key="ext.row.${p.rows.length - 1}.id"]`)?.focus();
      },
    }, '+ Add a row by hand'),
  );
  const selected = p.rows.filter((r) => r.include).length;
  box.append(
    el(
      'div',
      { class: 'save-buttons' },
      el(
        'button',
        {
          class: 'btn primary',
          'data-key': 'ext.preview.add',
          onclick: async () => {
            const university = p.university.trim();
            // Problems stay on screen, next to what needs fixing (item 6).
            const problem = (message: string, focusKey: string): void => {
              previewError = message;
              render();
              document.querySelector<HTMLElement>(`[data-key="${focusKey}"]`)?.focus();
            };
            if (university === '') {
              problem('Enter the university name — the DGS’s rules match courses by university + course id.', 'ext.preview.university');
              return;
            }
            if (p.campusSystem !== undefined && p.campus === undefined) {
              problem(`Choose the ${p.campusSystem} campus — the course rules are keyed on it, and “${p.campusSystem}” alone names several schools.`, 'ext.preview.campus');
              return;
            }
            // A combined bachelor's + master's record needs the award term (DGS 2026-09-06 evening).
            if (p.bachelorsRequired && p.bachelorsAwarded === undefined) {
              problem('Enter the semester your bachelor’s degree was awarded — required for a combined bachelor’s + master’s transcript: courses dated in or before it count as undergraduate coursework (§5.2).', 'ext.preview.bachelors.year');
              return;
            }
            const ready = p.rows.filter(readyToAdd);
            const skipped = p.rows.filter((r) => r.include).length - ready.length;
            if (ready.length === 0) {
              problem('No rows are complete yet — every added row needs a course id, credits, a grade and a year.', 'ext.preview.error');
              return;
            }
            previewError = undefined;
            // A row whose credit-hours column came through blank is saved as 0
            // and counts toward nothing. The student is asked before it is
            // added, naming the rows (DGS 2026-09-11) — allowed, never silent.
            const zeroRows = ready.filter((r) => r.credits === 0);
            if (zeroRows.length > 0) {
              const which = zeroRows.map((r) => r.courseId.trim()).join(', ');
              const yes = await confirmDialog({
                title: `${zeroRows.length === 1 ? 'One course has' : `${zeroRows.length} courses have`} 0 credits`,
                body: [
                  `${which} ${zeroRows.length === 1 ? 'is' : 'are'} about to be added with 0 credits, which counts toward nothing — not the total credits, not the regular-course credits, not any cap.`,
                  'That usually means the credit-hours column could not be read. Cancel, type the credits from your transcript into those rows, and add them again.',
                ],
                confirmLabel: 'Add them anyway',
                cancelLabel: 'Go back and fix the credits',
                returnFocusKey: 'ext.preview.add',
              });
              if (!yes) return;
            }
            // (initializer cast: the assignment happens inside the update()
            // closure, which TS's flow analysis can't see from the use below)
            let priorAutoSet = false as 'completed' | 'unfinished' | false;
            let unfinishedLabel = '';
            let merged = 0;
            let refiledToProgram = 0;
            let graduateRows = 0;
            let bachelorsSet: Term | undefined;
            let bachelorsFromTranscript = false;
            let bachelorsBefore: Term | undefined;
            let earlierRead = false as ReadingResult;
            update((s) => {
              // The bachelor's university, for "same university?" (Option 1):
              // only a university with undergraduate rows and no graduate rows
              // on file from before this import — a master's transcript's own
              // undergraduate rows are no bachelor's transcript, and neither
              // is transfer credit on the Notre Dame record — and only one
              // (review of Option 1, 2026-10-08).
              const earlier = s.courses.filter((c) => c.origin === 'transfer' && !c.fromNdTranscript && !isNotreDameInstitution(c.institution) && c.institution);
              const bachelorsCandidates = [...new Set(earlier.filter((c) => c.degreeLevel === 'bachelors').map((c) => c.institution!))].filter((u) => !earlier.some((c) => c.institution === u && c.degreeLevel !== 'bachelors'));
              const bachelorsAt = s.backgroundDraft?.bachelors === 'elsewhere' && bachelorsCandidates.length === 1 ? bachelorsCandidates[0] : undefined;
              // …and the one graduate university on file, for a bachelor's
              // transcript added after the master's.
              const graduateCandidates = [...new Set(earlier.filter((c) => c.degreeLevel === 'masters' || c.degreeLevel === 'phd').map((c) => c.institution!))];
              const graduateAt = graduateCandidates.length === 1 ? graduateCandidates[0] : undefined;
              for (const r of ready) {
                const row = courseEntryOf(r, p, university, args.todayIso ? { on: args.todayIso, app: APP_BUILD.commit } : undefined);
                if (row.degreeLevel !== 'bachelors') graduateRows += 1;
                s.courses.push(row);
                // The same course already on the record as the Notre Dame
                // transcript's accepted transfer credit: one course, this row,
                // carrying that acceptance (P3-import-1 (c), 2026-10-05).
                if (absorbBlockRow(s, row)) merged += 1;
              }
              // What this transcript settles of the earlier-degrees answer
              // (DGS 2026-10-08, Option 1): a bachelor's there, or a graduate
              // degree there — finished when it says it was conferred, at the
              // bachelor's university when that is known (a bachelor's at Notre
              // Dame, one bachelor's transcript on file, or this transcript's
              // own undergraduate record with its bachelor's conferral).
              if (!isNotreDameInstitution(university)) {
                if (p.slot === 'bachelors') earlierRead = mergeReading(s, readBackgroundFromPriorBachelors(university, graduateAt));
                else {
                  const ndBachelors = s.backgroundDraft?.bachelors === 'nd-cse' || s.backgroundDraft?.bachelors === 'nd-other';
                  earlierRead = mergeReading(
                    s,
                    readBackgroundFromPriorGraduate({
                      slot: p.slot,
                      university,
                      ...(p.conferred !== undefined ? { conferred: p.conferred } : {}),
                      ...(bachelorsAt ? { bachelorsUniversity: bachelorsAt } : {}),
                      ...(ndBachelors ? { bachelorsAtNotreDame: true } : {}),
                      ...(p.bachelorsConferredOn !== undefined && p.mixedLevels ? { bachelorsOnThisTranscript: true } : {}),
                    }),
                  );
                }
              }
              // "Prior graduate study" from the transcript (2026-09-03): a
              // graduate-degree conferral line → completed; a graduate
              // transcript WITHOUT one → "Prior M.S., not completed" plus the
              // standing card's warning (the transcript alone cannot prove
              // completion). Only the untouched default is upgraded — never a
              // student's own choice; touching the dropdown clears the flag.
              // Since 2026-09-05 any GRADUATE row triggers this, whatever the
              // slot (a 4+1's fifth year on an undergraduate transcript).
              if (graduateRows > 0 && s.priorMs === 'none' && s.background === undefined) {
                s.priorMs = p.conferred === true ? 'completed' : 'unfinished';
                s.priorMsInferred = true;
                priorAutoSet = s.priorMs;
              }
              // The bachelor's award term: a value the student gave — here or
              // under Your standing — always applies; one read from this
              // transcript fills the field only while the student has not set
              // it by hand (2026-09-06). Since 2026-09-07 the preview is itself
              // pre-filled from a hand-set term, so this usually writes back
              // the same value: only a REAL change is announced, and only a
              // term that truly came from the transcript is described that way.
              if (p.bachelorsAwarded !== undefined && (p.bachelorsSource === 'student' || s.bachelorsAwarded === undefined || s.bachelorsAwardedInferred !== undefined)) {
                const changed = s.bachelorsAwarded === undefined || termIndex(s.bachelorsAwarded) !== termIndex(p.bachelorsAwarded);
                s.bachelorsAwarded = { ...p.bachelorsAwarded };
                s.bachelorsAwardedInferred = p.bachelorsSource === 'student' ? undefined : { how: `the bachelor’s degree conferred ${p.bachelorsConferredOn} on your ${university} transcript` };
                if (changed) {
                  bachelorsSet = s.bachelorsAwarded;
                  bachelorsFromTranscript = p.bachelorsSource === 'transcript';
                }
              }
              // A standalone master's transcript says nothing about the
              // bachelor's degree, and the student is not asked (DGS
              // 2026-09-20): it was awarded BEFORE the master's first
              // semester, which is all §5.2 needs — every course on the
              // transcript is dated after it. The record holds the term just
              // before that semester; the page shows "Before <semester>".
              // A term the student set by hand is left alone, and so is one
              // read from a conferral date — a bachelor's transcript's, or the
              // Notre Dame record's: only an earlier "before" estimate gives
              // way (blue/red-team review of Option 1, 2026-10-08).
              // A standalone Ph.D. transcript says the same (coverage review,
              // 2026-10-08: the Ph.D. row left the field empty and "required").
              if (p.slot !== 'bachelors' && !p.bachelorsRequired && p.bachelorsAwarded === undefined && (s.bachelorsAwarded === undefined || s.bachelorsAwardedInferred?.before !== undefined)) {
                const dated = ready.filter((r) => r.year !== undefined).map((r) => ({ season: r.season, year: r.year! }));
                const first = dated.sort(compareTermIndex)[0];
                if (first !== undefined) {
                  const wasBefore = s.bachelorsAwardedInferred?.before;
                  s.bachelorsAwarded = termBefore(first);
                  s.bachelorsAwardedInferred = { how: `the first semester on your ${university} ${p.slot === 'phd' ? 'Ph.D.' : 'master’s'} transcript`, before: { ...first } };
                  if (wasBefore === undefined || termIndex(wasBefore) !== termIndex(first)) bachelorsBefore = first;
                }
              }
              // A Notre Dame transcript can land in one of these slots as the
              // record of an EARLIER Notre Dame degree (2026-09-05), and such a
              // transcript often carries the current program too. The entry
              // term is what separates the two, so re-file by it here as the
              // Notre Dame slot does — otherwise the student's in-program
              // courses sit as §5.2 transfer candidates until they happen to
              // touch a term field (2026-09-09).
              if (isNotreDameInstitution(university)) {
                refiledToProgram = reclassifyNotreDameCourses(s).toProgram;
              }
              // Read from the record once every row is filed, as the emails
              // read it (verification, transfer-3).
              unfinishedLabel = unfinishedPriorLabel(s);
            });
            const matched = ready.filter((r) => findExternalRule(rules.external, university, r.courseId)).length;
            const undergraduateRows = ready.length - graduateRows;
            preview = undefined;
            releaseScanStrips();
            withdrawScannerLayerOffer();
            previewError = undefined;
            render();
            toast(
              `Added ${ready.length} course${ready.length === 1 ? '' : 's'} from ${university}` +
                (p.mixedLevels ? ` (${undergraduateRows} undergraduate, ${graduateRows} graduate${p.termPrefill ? ', by the two-year rule where the transcript did not say' : ''})` : '') +
                (matched > 0 ? ` — ${matched} already in the DGS’s course rules` : '') +
                (skipped > 0 ? `; ${skipped} skipped (incomplete — missing a grade, credits or year)` : '') +
                (refiledToProgram > 0
                  ? `; ${refiledToProgram} of them are dated from your entry term on, so they are filed as this program's coursework, not as transfer credit`
                  : '') +
                (merged > 0 ? `; ${merged === 1 ? '1 of them was' : `${merged} of them were`} already on your Notre Dame transcript as accepted transfer credit, so each is kept as one course` : '') +
                '.' +
                (priorAutoSet === 'completed'
                  ? ' Prior graduate study was set to “Completed prior M.S. or Ph.D.” from the conferral line on your transcript — if that’s wrong, change it in the earlier-degrees questions in the Transcripts card.'
                  : priorAutoSet === 'unfinished'
                    ? // The label the emails print (program-history.ts): a Ph.D. transcript
                      // is an unfinished Ph.D., not "Prior M.S." (round 5, item 13).
                      ` Prior graduate study was set to “${unfinishedLabel}” — no degree-conferral line was found on your transcript; if you did earn the degree, say so in the earlier-degrees questions in the Transcripts card.`
                    : '') +
                (bachelorsSet
                  ? ` “Bachelor’s degree awarded” was set to ${termLabel(bachelorsSet)}${bachelorsFromTranscript ? ' from the conferral date on your transcript' : ''} — check it under Your standing.`
                  : bachelorsBefore
                    ? ` “Bachelor’s degree awarded” reads “Before ${termLabel(bachelorsBefore)}”, the first semester on this transcript — set the exact semester under Your standing if you know it.`
                    : '') +
                // Option 1 (DGS 2026-10-08): the earlier-degrees answers it filled in.
                (earlierRead === 'disagree' ? ' Your transcripts disagree about your earlier degrees — answer those questions in the Transcripts card.' : earlierRead ? ' Your earlier degrees were partly filled in from it — check them in the Transcripts card.' : ''),
            );
          },
        },
        // 'selected' — the word Select all / Select none and the ND preview use (trim review 2026-09-18, P-58).
        `Add ${selected} selected course${selected === 1 ? '' : 's'}`,
      ),
      el('button', { class: 'btn', 'data-key': 'ext.preview.cancel', onclick: () => { preview = undefined; releaseScanStrips(); withdrawScannerLayerOffer(); previewError = undefined; render(); } }, 'Cancel'),
    ),
    // "Does this look wrong?" for the reader (DGS 2026-10-11, item 18): the
    // message is built when clicked, so it carries the edits made so far.
    ...readerProblemLink('ext.preview.problem', () => ({
      which: DEGREE_SLOTS.find((sl) => sl.level === p.slot)?.label ?? 'Previous transcript',
      university: p.university.trim(),
      readBy: p.fromOcr ? (p.scannerLayer ? 'the scanner’s own text layer' : 'text recognition (OCR) of a scan') : 'the PDF’s text',
      rowsRead: p.rows.filter((r) => !r.manual).length,
      rowsTicked: p.rows.filter((r) => r.include).length,
      rowsTyped: p.rows.filter((r) => r.manual).length,
      changed: p.rows
        .filter((r) => !r.manual && changedFields(r).length > 0)
        .map((r) => ({ read: [r.read!.course, r.read!.title, String(r.read!.credits ?? ''), `${seasonName(r.read!.season)} ${r.read!.year ?? ''}`, r.read!.grade || '(none)'], fields: changedFields(r).map((f) => FIELD_WORDS[f]) })),
    }), args.checkedWith, deciderContact(student.program)),
  );
  return box;
}

/** The preview checked against the transcript's own totals (DGS 2026-10-11,
 * item 11): every row read, with the student's corrections, and the rows they
 * typed for a term. */
function previewTotalsCheck(p: ExternalPreview): TotalsMismatch[] {
  if (!p.printedTotals) return [];
  const toRow = (r: PreviewRow): CheckedRow | undefined => (r.year !== undefined && r.credits !== undefined ? { term: { season: r.season, year: r.year }, credits: r.credits, grade: r.grade, level: r.level } : undefined);
  const typed = p.rows.filter((r) => r.manual).map((r) => {
    const c = toRow(r);
    return c ? { ...c, typed: true } : undefined;
  });
  return checkTotals([...(p.allRows ?? []).map(toRow), ...typed], p.printedTotals);
}

/** The ⚠'s words on a scanned row, by why it is flagged (item 13, 2026-10-11). */
const OCR_FLAG_TITLE: Record<'confidence' | 'credits' | 'mark' | 'totals' | 'code', string> = {
  confidence: 'OCR read this line poorly — check it carefully',
  credits: 'No other row of this transcript has this credit value — check it against the scan',
  mark: 'The grade cell holds a number or a stray sign, not a grade — check it against the scan',
  totals: 'This term’s rows do not add up to the transcript’s own totals — check it against the scan',
  code: 'The course number may have a letter where the scan meant a digit — check it against the scan',
};

const FIELD_WORDS: Record<ImportedField, string> = { course: 'course number', title: 'title', credits: 'credits', term: 'term', grade: 'grade', level: 'level' };

/** The preview's "Did the reader get this transcript wrong?" link — a mailto
 * to the DGS (src/ui/report-problem.ts), its message built at the click.
 * Shared with the Notre Dame preview. Nothing when the DGS's address in the
 * rules sheet is unusable. */
export function readerProblemLink(key: string, problem: () => TranscriptProblem, checkedWith: string | undefined, to: Contact, editable = true): HTMLElement[] {
  if (transcriptProblemHref(problem(), checkedWith ?? '', to) === undefined) return [];
  const a = el(
    'a',
    {
      href: '#',
      'data-key': key,
      // Built when clicked: the rows may have been corrected since the render.
      onclick: () => {
        a.setAttribute('href', transcriptProblemHref(problem(), checkedWith ?? '', to) ?? '#');
      },
    },
    editable ? 'tell the DGS' : 'Tell the DGS',
  );
  return [
    editable
      ? el('p', { class: 'hint reader-problem' }, 'Did the reader get this transcript wrong? Correct the rows above, then ', a, ' — the email names the university and the shape of each row you changed, never your courses or grades.')
      : el('p', { class: 'hint reader-problem' }, 'Did the reader get this transcript wrong? ', a, ' — the email gives the counts of rows read and ticked, never your courses or grades.'),
  ];
}


/** The preview's "Bachelor's degree awarded" control (DGS 2026-09-06 evening):
 * season + year, pre-filled from the transcript's conferral date, required for
 * a combined record. A change re-fills every row's "Taken as" by the term. */
function bachelorsField(p: ExternalPreview, rules: Rules, render: () => void, program: Program, sync?: (term: Term | undefined) => void): HTMLElement {
  const yearInput = el('input', {
    type: 'number',
    min: String(BACHELORS_YEAR_RANGE.min),
    'aria-label': 'Bachelor’s degree awarded — year',
    'aria-describedby': 'ext-bachelors-hint',
    'data-key': 'ext.preview.bachelors.year',
    value: p.bachelorsAwarded ? String(p.bachelorsAwarded.year) : '',
    ...(p.bachelorsRequired ? { required: 'required', 'aria-required': 'true' } : {}),
  });
  const seasonSel = el('select', { 'aria-label': 'Bachelor’s degree awarded — semester', 'data-key': 'ext.preview.bachelors.season' });
  for (const se of SEASONS) seasonSel.append(option(se, seasonName(se), (p.bachelorsAwarded?.season ?? 'spring') === se));
  const apply = (): void => {
    const raw = (yearInput as HTMLInputElement).value;
    const year = Number(raw);
    // This is the SECOND "Bachelor's degree awarded — year" box (the other is
    // on the standing card) and it writes the same field of the record through
    // `sync`, so it takes the same range (interface review R1, 2026-09-18).
    // The guard here was `>= 1970` with no upper bound, which accepted 9999 —
    // and 9999 dates every row of the transcript "before the award", so every
    // imported course was re-levelled to undergraduate.
    const keep = raw !== '' && inRange(year, BACHELORS_YEAR_RANGE);
    if (raw !== '' && !keep) {
      previewError = inputRefusal(raw, BACHELORS_YEAR_RANGE);
      yearInput.setAttribute('aria-invalid', 'true');
      render();
      return;
    }
    yearInput.removeAttribute('aria-invalid');
    p.bachelorsAwarded = keep ? { season: (seasonSel as HTMLSelectElement).value as Season, year } : undefined;
    p.bachelorsSource = 'student';
    relevelByAward(p, rules, program);
    previewError = undefined;
    // `sync` writes the record and renders the whole page (the preview with it).
    if (sync) sync(p.bachelorsAwarded);
    else render();
  };
  yearInput.addEventListener('change', apply);
  seasonSel.addEventListener('change', () => {
    if ((yearInput as HTMLInputElement).value !== '') apply();
  });
  // What undergraduate coursework can still do, by degree: for a Ph.D.
  // student §4.4.1 core knowledge; for an MSCSE student nothing at all,
  // because the qualifying examination is not theirs (DGS 2026-09-11).
  const ugTail = program === 'phd' ? ': no transfer credit, core knowledge only (§5.2, §4.4.1).' : ', which brings no transfer credit (§5.2).';
  const hint =
    p.bachelorsAwarded && p.bachelorsSource === 'student'
      ? `The same value as “Bachelor’s degree awarded” under Your standing — changing it here changes it there.${p.bachelorsConferredOn ? ` This transcript says a bachelor’s degree was conferred ${p.bachelorsConferredOn}; correct it here only if that is the right term.` : ''} Courses dated in or before it count as undergraduate coursework${ugTail}`
      : p.bachelorsAwarded && p.bachelorsSource === 'transcript'
      ? `Read from your transcript (bachelor’s degree conferred ${p.bachelorsConferredOn}) — check it. Courses dated in or before this term count as undergraduate coursework${ugTail}`
      : p.bachelorsRequired
        ? `Required for a combined bachelor’s + master’s record: enter the semester your bachelor’s degree was awarded. Courses dated in or before it count as undergraduate coursework${ugTail.replace(/\.$/, '')}; changing it re-fills “Taken as” for every row.`
        : p.slot === 'masters'
          // A standalone master's transcript (DGS 2026-09-20): not required —
          // left blank, the award reads "Before <first semester on it>".
          ? 'Optional — left blank, your bachelor’s degree counts as awarded before the first semester on this transcript, which is all §5.2 needs; set the exact semester if you know it.'
          : 'Required — the semester your bachelor’s degree was awarded; courses dated in or before it count as undergraduate coursework (§5.2).';
  return el(
    'div',
    { class: 'field bachelors-field' },
    // Required everywhere since 2026-09-07 (DGS); only the Add-blocking is
    // specific to a combined bachelor's + master's record.
    el('span', { class: 'label' }, p.slot === 'masters' && !p.bachelorsRequired ? 'Bachelor’s degree awarded' : 'Bachelor’s degree awarded (required)'),
    el('div', { class: 'pair' }, seasonSel, yearInput),
    el('p', { class: 'hint', id: 'ext-bachelors-hint' }, hint),
  );
}
