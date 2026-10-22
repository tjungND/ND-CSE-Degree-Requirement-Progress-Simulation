// The Notre Dame unofficial-transcript import (moved out of app.ts,
// 2026-09-20): the Import button and its persistent error, the parse, the
// preview the student ticks through, and the Add that files the rows. The
// preview state lives here, like external-upload.ts's; app.ts asks
// `ndPreviewOpen()` to block the other import buttons while it is open.
// Everything else — the record, the rules, the toasts, the render — arrives in
// `NdUploadArgs` on every call, so this module never captures the reassignable
// `student`.
import { doubtedTerms, type TotalsMismatch } from '../transcript/totals-check.ts';
import { deciderContact } from './contacts.ts';
import { readerProblemLink } from './external-upload.ts';
import { APP_BUILD } from './build-info.ts';
import { resolveRuleRow } from '../data/assemble.ts';
import { findExternalRule } from '../data/external.ts';
import type { Rules } from '../data/types.ts';
import { priorNdUndergraduateCanCount } from '../engine/allocate.ts';
import { CORE_TITLE_RE } from '../engine/core-title.ts';
import { beforeProgramStart, isEarlyStartCourse, type EarlyStartFacts } from '../engine/early-start.ts';
import { GRADE_POINTS } from '../engine/grades.ts';
import { gpaText } from '../engine/requirements/shared.ts';
import { GPA_RANGE, formatValue, inRange, rangeSpan } from '../engine/ranges.ts';
import { conferralTerm, termIndex, termLabel, termOfDate, termShort } from '../engine/term.ts';
import type { CourseEntry, Student, Term, TermGpa } from '../engine/types.ts';
import { parseTranscript, type DegreeAwarded, type EntryTermInference, type ParsedCourse, type TranscriptTerm, totalsMismatchesOf } from '../transcript/parse.ts';
import { earlierDegreesState, forgetReadings, mergeReading, readBackgroundFromNdTerms, restoreEarlierDegrees, type ReadingResult } from './background-read.ts';
import { el, inactiveButton, PREVIEW_OPEN_NOTE, SIMULATION_IMPORT_NOTE } from './dom.ts';
import { plural } from './email-html.ts';
import { ndRowLabel } from './external-upload.ts';
import { postingOf, stripNdPostings, twinOfBlockRow } from './nd-posted.ts';
import { BROWSER_TOO_OLD_FOR_PDFS, browserTooOldForPdfs } from './pdf-support.ts';
import { deriveNdMasters, derivePriorMs, hasPriorGraduateStudy, priorNdDegreeLevel, reclassifyNotreDameCourses } from './prior-nd.ts';
import type { RefusedValues } from './refusals.ts';

/** What app.ts hands every call — the same shape external-upload.ts takes,
 * plus the focus keeper's `setFocusAfterRender` and the form's refused
 * values (an import answers a box, so its refusal goes). */
export interface NdUploadArgs {
  student: Student;
  rules: Rules;
  /** `quiet`: a change that finishes no step of the student's — a removal (next-step.ts). */
  update: (fn: (s: Student) => void, opts?: { quiet?: boolean }) => void;
  toast: (msg: string) => void;
  /** Takes the plain toast down (toasts.ts `dismiss`): the "Reading the
   * transcript…" message ends with the preview or the refusal (U8). */
  dismissToast?: () => void;
  toastWithAction: (msg: string, actionLabel: string, action: () => void, opts?: { ttlMs?: number; focusKey?: string }) => void;
  render: () => void;
  /** One transcript at a time (2026-09-03): true while ANY preview is open. */
  blocked: boolean;
  /** Simulation mode (DGS 2026-10-09, D6): true while the mode is on — the
   * Import button is inactive with its own reason (SIMULATION_IMPORT_NOTE: a
   * transcript is real data; it is imported outside the mode). Remove stays
   * active: it edits the planning copy, never the record. */
  simulation?: boolean;
  setFocusAfterRender: (key: string) => void;
  refusedValues: RefusedValues;
  /** Today at Notre Dame (YYYY-MM-DD): the date each imported row records
   * (`CourseEntry.imported`; DGS 2026-10-11, item 6). */
  todayIso?: string;
  /** "Checked with: …" (src/ui/stamp.ts) for the reader-problem email (item 18). */
  checkedWith?: string;
}

/** Parsed-transcript preview awaiting the student's confirmation. */
export interface NdPreview {
  courses: ParsedCourse[];
  selected: boolean[];
  duplicate: boolean[];
  /** The transcript's graduate-level cumulative GPA (2026-09-05 — never
   * the undergraduate one on a combined transcript). */
  gpa?: number;
  /** The undergraduate-level figure, shown only to say it is NOT used. */
  undergraduateGpa?: number;
  /** This program's courses alone (offered when earlier graduate
   * coursework at Notre Dame is folded into the transcript's figure). */
  programGpa?: number;
  gpaChoice: 'transcript' | 'program' | 'none';
  /** The entry term read from the transcript (2026-09-05) and whether
   * the student keeps the checkbox that applies it. */
  entryTerm?: EntryTermInference;
  useEntryTerm: boolean;
  degreesAwarded: DegreeAwarded[];
  /** Each graduate term's GPA figures as printed (2026-10-04; Academic Code
   * §5.7.3, §5.8) — stored on the record with the import, replaced by the
   * next one, never typed. */
  termGpas?: TermGpa[];
  /** Parser warnings, shown inside the preview (not as vanishing toasts). */
  warnings: string[];
  /** The import's own check (DGS 2026-10-11, item 11): every printed total
   * the rows read do not add up to — shown above the rows, and each term it
   * names marks its rows. */
  totalsCheck?: TotalsMismatch[];
  /** Each term's level, college and major (2026-10-08): what the
   * earlier-degrees answer can be read from (background-read.ts). */
  terms?: TranscriptTerm[];
  /** Which rows started unticked (taken at the first render), and whether
   * the student asked to see them (UI review, 2026-10-08). */
  startUnticked?: boolean[];
  showUnticked?: boolean;
}
let transcriptPreview: NdPreview | undefined;

/** True while the Notre Dame preview is open — app.ts combines it with
 * external-upload.ts's `importsBusy()` to block every import button. */
export function ndPreviewOpen(): boolean {
  return transcriptPreview !== undefined;
}

/** An import that failed (usability review 2026-09-05, item 6): shown as a
 * persistent message under the Notre Dame row — a 4-second toast was easy
 * to miss and impossible to re-read. Cleared by the next import or Dismiss. */
let ndImportError: string | undefined;

/** Reset (review of Option 1, 2026-10-08): an open Notre Dame preview belonged
 * to the old record. */
/** What an earlier Notre Dame import put on the record, taken back: the rows
 * with their positions (Undo puts each back where it was, 2026-09-06
 * evening), the GPA figures, an inferred prior study, what it read into the
 * earlier-degrees draft, the acceptances it marked on other transcripts' rows
 * (P3-import-1) — and, for a replacement, the standing-card facts the new
 * import may overwrite. Used by Remove and, since 2026-10-09 (UI review item
 * 13; DGS: option (b)), by "Import again", which replaces the earlier import
 * — what the row's hint told students to do by hand — with one Undo. */
interface NdImportSnapshot {
  removed: { c: CourseEntry; i: number }[];
  before: {
    gpa: Student['gpa'];
    gpaSource: Student['gpaSource'];
    termGpas: Student['termGpas'];
    priorMs: Student['priorMs'];
    inferred: Student['priorMsInferred'];
    earlier: ReturnType<typeof earlierDegreesState>;
    entryTerm: Term;
    entryTermInferred: Student['entryTermInferred'];
    bachelorsAwarded: Student['bachelorsAwarded'];
    bachelorsAwardedInferred: Student['bachelorsAwardedInferred'];
    ndDegrees: Student['ndDegrees'];
  };
  unmarked: ReturnType<typeof stripNdPostings>;
}
function takeNdImport(s: Student): NdImportSnapshot {
  const removed = s.courses.map((c, i) => ({ c, i })).filter(({ c }) => c.fromNdTranscript === true);
  const before: NdImportSnapshot['before'] = {
    gpa: s.gpa,
    gpaSource: s.gpaSource,
    termGpas: s.termGpas,
    priorMs: s.priorMs,
    inferred: s.priorMsInferred,
    earlier: earlierDegreesState(s),
    entryTerm: { ...s.entryTerm },
    entryTermInferred: s.entryTermInferred,
    bachelorsAwarded: s.bachelorsAwarded,
    bachelorsAwardedInferred: s.bachelorsAwardedInferred,
    ndDegrees: s.ndDegrees,
  };
  const unmarked = stripNdPostings(s);
  s.courses = s.courses.filter((c) => c.fromNdTranscript !== true);
  if (s.gpaSource !== undefined) {
    s.gpa = undefined; // the transcript's figure — a hand-typed GPA has no gpaSource and stays
    s.gpaSource = undefined;
  }
  s.termGpas = undefined; // the transcript's own figures go with it (2026-10-04)
  if (s.priorMsInferred === true && !s.courses.some((c) => c.origin === 'transfer' && (c.degreeLevel === 'masters' || c.degreeLevel === 'phd'))) {
    s.priorMs = 'none';
    s.priorMsInferred = undefined;
  }
  // What it read into a draft answer goes with it (review of Option 1,
  // 2026-10-08): a replacement is read afresh.
  forgetReadings(s, 'nd');
  return { removed, before, unmarked };
}
/** Undo: the earlier import back as it was; `standing` too for a replacement. */
function putBackNdImport(s: Student, snap: NdImportSnapshot, standing = false): void {
  for (const { c, i } of snap.removed) s.courses.splice(Math.min(i, s.courses.length), 0, c);
  for (const { index, posting } of snap.unmarked) {
    const row = s.courses[index];
    if (row && row.origin === 'transfer') row.ndPosted = posting;
  }
  s.gpa = snap.before.gpa;
  s.gpaSource = snap.before.gpaSource;
  s.termGpas = snap.before.termGpas;
  s.priorMs = snap.before.priorMs;
  s.priorMsInferred = snap.before.inferred;
  // …and what it had read into the earlier-degrees draft (Remove forgot it;
  // coverage review, 2026-10-08).
  restoreEarlierDegrees(s, snap.before.earlier);
  if (standing) {
    s.entryTerm = { ...snap.before.entryTerm };
    s.entryTermInferred = snap.before.entryTermInferred;
    s.bachelorsAwarded = snap.before.bachelorsAwarded;
    s.bachelorsAwardedInferred = snap.before.bachelorsAwardedInferred;
    s.ndDegrees = snap.before.ndDegrees;
  }
}

export function resetNdImport(): void {
  transcriptPreview = undefined;
  ndImportError = undefined;
}

export function ndTranscriptUpload(args: NdUploadArgs): HTMLElement {
  const fileInput = el('input', { type: 'file', accept: '.pdf,application/pdf', class: 'hidden', 'aria-label': 'ND unofficial transcript PDF' });
  const fail = (message: string): void => {
    transcriptPreview = undefined;
    ndImportError = message;
    args.dismissToast?.(); // "Reading the transcript…" ends with the refusal (U8)
    args.setFocusAfterRender('import.nd.error');
    args.render();
  };
  fileInput.addEventListener('change', async () => {
    const file = (fileInput as HTMLInputElement).files?.[0];
    if (!file) return;
    ndImportError = undefined;
    args.toast('Reading the transcript… (it never leaves this browser)');
    try {
      const { pdfToLines } = await import('../transcript/pdf.ts'); // pdfjs loads lazily
      const lines = await pdfToLines(await file.arrayBuffer());
      // Kellogg's own instructions tell students to SCREENSHOT the page —
      // those PDFs have no text layer, and deserve a specific message,
      // not a false "this isn't ND" rejection.
      if (lines.join('').trim().length < 40) {
        fail('This PDF has no readable text (a screenshot?). Please use your browser’s "Print → Save as PDF" on the transcript page instead, or add courses manually.');
        return;
      }
      const parsed = parseTranscript(lines);
      if (!parsed.isNotreDame) {
        fail("Only ND's unofficial transcript is accepted here — for courses from other universities, use the Previous-Transcript rows below.");
        return;
      }
      if (parsed.courses.length === 0) {
        fail('This looks like an ND transcript, but no course lines could be read from it. Add your courses manually, and tell the DGS so the parser can be improved.');
        return;
      }
      // An earlier Notre Dame import is replaced by this one (UI review item
      // 13; DGS 2026-10-09: option (b)), so its rows are not "already entered".
      const kept = { ...args.student, courses: args.student.courses.filter((row) => row.fromNdTranscript !== true) };
      const duplicate = parsed.courses.map(
        (c) =>
          kept.courses.some((s) => s.courseId === c.courseId && termIndex(s.term) === termIndex(c.term)) ||
          // (c): a transfer-block row is already entered when another
          // transcript brought the same course from the same university, in
          // whatever term that transcript dates it (P3-import-1, 2026-10-05).
          twinOfBlockRow(kept, c) !== undefined,
      );
      // The entry term read from the transcript (2026-09-05) is applied
      // unless the student unticks it in the preview. Pre-entry Notre Dame
      // courses become prior coursework; pre-entry UNDERGRADUATE courses
      // that cannot matter start unticked, like the external undergraduate
      // import. "Cannot matter" is the engine's answer since 2026-09-11 —
      // undergraduate Notre Dame coursework can COUNT now, not only
      // demonstrate a §4.4.1 core area — and §4.4.1 itself is the Ph.D.
      // qualifier's, so it is no reason to tick anything for an MSCSE
      // student.
      const entry = parsed.entryTerm?.term ?? args.student.entryTerm;
      const bsTerm = bachelorsTermFor(parsed.degreesAwarded, args.student, parsed.terms);
      // Before the program began — the early-start summer just before a fall
      // entry is the program's own (P3-chg-other-1; DGS 2026-10-05).
      const startFacts = startFactsFor(entry, parsed.degreesAwarded, args.student, parsed.terms);
      const beforeStart = (c: ParsedCourse): boolean => beforeProgramStart({ term: c.term, registeredLevel: c.level }, startFacts);
      const qualifierApplies = args.student.program === 'phd';
      const irrelevantPrior = parsed.courses.map((c) => {
        // (b): credit on the undergraduate record's transfer block — AP or
        // another college's credit accepted for the bachelor's — is never
        // graduate transfer credit; it starts unticked unless its title could
        // show a §4.4.1 core area (P3-import-1, 2026-10-05).
        if (c.origin === 'transfer') return c.level === 'undergraduate' && !(qualifierApplies && CORE_TITLE_RE.test(c.title ?? ''));
        if (c.origin !== 'nd' || !beforeStart(c)) return false;
        const rule = resolveRuleRow(args.rules, c.courseId, c.term);
        return (
          priorNdDegreeLevel({ courseId: c.courseId, registeredLevel: c.level, term: c.term }, bsTerm) === 'bachelors' &&
          !priorNdUndergraduateCanCount({ courseId: c.courseId, credits: c.credits, term: c.term, grade: c.grade, origin: 'transfer' }, rule, args.student.program) &&
          !(qualifierApplies && CORE_TITLE_RE.test(c.title ?? '')) &&
          !(qualifierApplies && rule?.coreArea) &&
          !(qualifierApplies && findExternalRule(args.rules.external, 'University of Notre Dame', c.courseId))
        );
      });
      // The GPA (combined-transcript bug report 2026-09-05): the transcript's
      // GRADUATE-level cumulative figure, never the undergraduate one; and
      // when graduate courses from an EARLIER program at Notre Dame precede
      // the entry term, that figure includes them, so the courses of this
      // program alone are averaged too and the student chooses (the
      // transcript's figure is the default — it is what the registrar and
      // the Graduate School compute; docs/DECISIONS.md 2026-09-05).
      const programGpa = gpaOfProgramCourses(parsed.courses, startFacts);
      // A figure misread off the page is not offered at all (R1,
      // 2026-09-18): the preview's GPA control is the one place a number
      // the student never typed can reach §2.2, so a reading off the 4.00
      // scale is dropped here and said in the preview's own warnings, where
      // the rest of what the parser could not place is already listed.
      const transcriptGpa = inRange(parsed.cumulativeGpa, GPA_RANGE) ? parsed.cumulativeGpa : undefined;
      const gpaWarning =
        parsed.cumulativeGpa !== undefined && transcriptGpa === undefined
          ? [
              `The cumulative GPA read from this transcript (${formatValue(parsed.cumulativeGpa, GPA_RANGE)}) is outside the ${rangeSpan(GPA_RANGE)} range, so it was not used — enter your GPA under Coursework.`,
            ]
          : [];
      const earlierGraduateWork = parsed.courses.some(
        (c) => c.origin === 'nd' && beforeStart(c) && c.level === 'graduate' && GRADE_POINTS[c.grade] !== undefined,
      );
      transcriptPreview = {
        courses: parsed.courses,
        selected: parsed.courses.map((_, i) => !duplicate[i] && !irrelevantPrior[i]),
        duplicate,
        gpa: transcriptGpa,
        undergraduateGpa: inRange(parsed.cumulativeGpaByLevel?.undergraduate, GPA_RANGE) ? parsed.cumulativeGpaByLevel?.undergraduate : undefined,
        programGpa: earlierGraduateWork && inRange(programGpa, GPA_RANGE) ? programGpa : undefined,
        // The registrar's figure only (2026-10-03); the program-only average is information.
        gpaChoice: transcriptGpa !== undefined ? 'transcript' : 'none',
        entryTerm: parsed.entryTerm,
        ...(parsed.terms ? { terms: parsed.terms } : {}),
        // Ticked by default only while the entry term on the record is still
        // assumed or read from an earlier import: a term the student typed
        // under Your standing is theirs (DGS 2026-09-22: "Do not reset them if
        // there are manual inputs") — the box then starts unticked.
        useEntryTerm: parsed.entryTerm !== undefined && args.student.entryTermInferred !== undefined,
        degreesAwarded: parsed.degreesAwarded,
        // Only figures on the 0.00–4.00 scale (R1, 2026-09-18).
        termGpas: parsed.termGpas
          ?.map((t) => ({ term: t.term, ...(inRange(t.termGpa, GPA_RANGE) ? { termGpa: t.termGpa } : {}), ...(inRange(t.cumulativeGpa, GPA_RANGE) ? { cumulativeGpa: t.cumulativeGpa } : {}) }))
          .filter((t) => t.termGpa !== undefined || t.cumulativeGpa !== undefined),
        warnings: [...parsed.warnings, ...gpaWarning],
        totalsCheck: totalsMismatchesOf(parsed),
      };
      // The preview is the read's outcome: the "Reading the transcript…"
      // toast goes with it, not four seconds later (blue-team review
      // 2026-10-17, U8).
      args.dismissToast?.();
      args.render();
    } catch {
      fail(browserTooOldForPdfs() ? BROWSER_TOO_OLD_FOR_PDFS : 'That PDF could not be read (a scanned image, or not a PDF?). Add your courses manually.');
    } finally {
      (fileInput as HTMLInputElement).value = '';
    }
  });
  const errorBox = ndImportError
    ? el(
        'div',
        { class: 'import-error', role: 'alert', tabindex: '-1', 'data-key': 'import.nd.error' },
        el('span', {}, ndImportError),
        ' ',
        el(
          'button',
          {
            class: 'btn tiny',
            'aria-label': 'Dismiss this message',
            onclick: () => {
              ndImportError = undefined;
              args.setFocusAfterRender('import.nd');
              args.render();
            },
          },
          'Dismiss',
        ),
      )
    : null;
  // Everything the transcript import added can be taken back in one click,
  // like a previous-university transcript (DGS request 2026-09-06): the
  // rows it added (program courses, pre-entry prior coursework and the
  // transcript's transfer-credit block — all flagged `fromNdTranscript`),
  // the GPA it filled in, and a "Prior graduate study" it inferred. Rows
  // typed by hand stay; so does the entry term, which the student can
  // still change under Your standing. Undo instead of a confirm dialog.
  const imported = args.student.courses.filter((c) => c.fromNdTranscript === true);
  // While a preview is open (this row's or a previous-university one), the
  // Import and Remove buttons are inactive and say why on hover / click
  // (DGS request 2026-09-06) — `inactiveButton`, not `disabled`, so the
  // reason can be shown.
  const button = (attrs: Record<string, string | boolean | ((ev: Event) => void)>, label: string): HTMLButtonElement =>
    args.blocked ? inactiveButton(attrs, PREVIEW_OPEN_NOTE, args.toast, label) : el('button', attrs, label);
  // In simulation mode the import itself is inactive with its own reason
  // (D6) — a transcript is real data; the mode holds a plan.
  const importButtonOf = (attrs: Record<string, string | boolean | ((ev: Event) => void)>, label: string): HTMLButtonElement =>
    args.simulation ? inactiveButton(attrs, SIMULATION_IMPORT_NOTE, args.toast, label) : button(attrs, label);
  const importButton = importButtonOf(
    {
      class: 'btn',
      'data-key': 'import.nd',
      // B7 (2026-09-18): four buttons on this card read "Import from PDF".
      // The visible label stays short; the accessible name says which row.
      'aria-label': `${imported.length > 0 ? 'Import again' : 'Import'} — ${ndRowLabel(args.student)}`,
      onclick: () => {
        // The pdfjs chunk and its worker download while the picker is open
        // (W8, 2026-10-22). pdf-warm.ts is loaded here, not at the top: its
        // worker-URL import is Vite's, which Node's test runner cannot read.
        void import('./pdf-warm.ts').then((m) => m.warmTranscriptReader()).catch(() => undefined); // a failure is the change handler's to report
        (fileInput as HTMLInputElement).click();
      },
    },
    imported.length > 0 ? 'Import again' : 'Import from PDF',
  );
  const parts: (Node | string)[] = [
    // Named for the program the student picked at the top (DGS 2026-09-11):
    // an ND 4+1 student has several Notre Dame transcripts, and "ND
    // Unofficial Transcript" did not say which one this row wants.
    el('span', { class: 'slot-label' }, ndRowLabel(args.student)),
    el('span', { class: 'slot-sep', 'aria-hidden': 'true' }, ' — '),
  ];
  if (imported.length > 0) {
    const n = imported.length;
    parts.push(
      el('span', {}, `${plural(n, 'course')} from your transcript `),
      button(
        {
          class: 'btn tiny',
          'aria-label': `Remove the ${plural(n, 'course')} imported from your ND transcript`,
          'data-key': 'import.nd.remove',
          onclick: () => {
            // Index-preserving (2026-09-06 evening): Undo puts every row
            // back where it was, so the table order and the course.N.remove
            // keys are exactly as before the Remove.
            let snap: NdImportSnapshot | undefined;
            args.setFocusAfterRender('import.nd');
            // A removal, and its Undo, finish no step (next-step.ts).
            args.update((s) => {
              snap = takeNdImport(s);
            }, { quiet: true });
            args.toastWithAction(
              `${plural(snap!.removed.length, 'course')} from your ND transcript removed${snap!.before.gpaSource !== undefined ? ', and the GPA it filled in' : ''}.`,
              'Undo',
              () => args.update((s) => putBackNdImport(s, snap!), { quiet: true }),
              { ttlMs: 20000, focusKey: 'import.nd.remove' },
            );
          },
        },
        'Remove',
      ),
      ' · ',
      importButton,
      // "Import again" replaces these (UI review item 13; DGS 2026-10-09).
      el('span', { class: 'hint-inline' }, ' — after new grades post, import the updated PDF: it replaces these; courses you typed in by hand are kept.'),
    );
  } else {
    parts.push(
      importButton,
      // The card hint above already says every field is checked before it
      // is added, and the preview is that check (trim review 2026-09-18, P-29).
      el('span', { class: 'hint-inline' }, ' — the system-generated PDF from insideND. It fills in your courses, GPA and entry term, and any earlier Notre Dame degree on it; transcripts from other universities go in the Previous rows.'),
    );
  }
  return el('div', { class: 'transcript-upload external-slot' }, ...parts, fileInput, errorBox);
}

/** The dated bachelor's award on a parsed Notre Dame transcript, as the
 * term to file pre-entry courses by and to fill "Bachelor's degree awarded"
 * with (DGS 2026-09-06). */
export function bachelorsAwardFrom(degrees: DegreeAwarded[]): { term: Term; degree: DegreeAwarded } | undefined {
  const d = degrees.find((x) => x.level === 'bachelors' && x.date !== undefined);
  return d ? { term: conferralTerm(d.date!), degree: d } : undefined;
}
/** The bachelor's award term a Notre Dame transcript states, with how it
 * says so: a dated bachelor's degree (older layouts), else — insideND prints
 * no degree — the last undergraduate term when Notre Dame graduate terms
 * follow it: the semester the bachelor's was finished (blue/red-team review
 * of Option 1, 2026-10-08; a 4+1's senior-year graduate courses are then
 * undergraduate-career coursework, not a prior master's). */
export function bachelorsAwardRead(degrees: DegreeAwarded[], terms: readonly TranscriptTerm[] | undefined): { term: Term; how: string; line: string } | undefined {
  const bs = bachelorsAwardFrom(degrees);
  if (bs)
    return {
      term: bs.term,
      how: `the ${bs.degree.name} awarded ${bs.degree.date} on your Notre Dame transcript`,
      line: `Your transcript shows a ${bs.degree.name} awarded ${bs.degree.date}, so ${termLabel(bs.term)} will be recorded as the semester you finished your bachelor’s — change it under Your standing if that is wrong.`,
    };
  if (degrees.length > 0 || !terms) return undefined;
  const undergrad = terms.filter((t) => t.level === 'undergraduate');
  if (undergrad.length === 0) return undefined;
  const last = undergrad.reduce((a, b) => (termIndex(b.term) > termIndex(a.term) ? b : a));
  if (!terms.some((t) => t.level === 'graduate' && termIndex(t.term) > termIndex(last.term))) return undefined;
  return {
    term: last.term,
    how: 'the last undergraduate term on your Notre Dame transcript, before its graduate terms',
    line: `Your transcript’s undergraduate terms end in ${termLabel(last.term)}, before its graduate terms, so ${termLabel(last.term)} will be recorded as the semester you finished your bachelor’s — change it under Your standing if that is wrong.`,
  };
}
/** An import fills the field only while it is empty or still an import's own reading. */
const bachelorsMayBeSet = (s: Student): boolean => s.bachelorsAwarded === undefined || s.bachelorsAwardedInferred !== undefined;
/** The award term a Notre Dame import would use: the transcript's, when it
 * may still set the field; else whatever the student has. */
const bachelorsTermFor = (degrees: DegreeAwarded[], student: Student, terms?: readonly TranscriptTerm[]): Term | undefined => {
  const bs = bachelorsAwardRead(degrees, terms);
  return bs && bachelorsMayBeSet(student) ? bs.term : student.bachelorsAwarded;
};

/** What the early-start test reads (P3-chg-other-1; engine/early-start.ts),
 * as THIS transcript states it: its entry term, its bachelor's award term and
 * its dated degree lines — the facts the add below writes to the record. */
const startFactsFor = (entry: Term, degrees: DegreeAwarded[], student: Student, terms?: readonly TranscriptTerm[]): EarlyStartFacts => ({
  entryTerm: entry,
  bachelorsAwarded: bachelorsTermFor(degrees, student, terms),
  ndDegrees: degrees.filter((d) => d.date !== undefined && d.level !== 'other').map((d) => ({ date: d.date! })),
  ndMasters: student.ndMasters,
});

/** Credit-weighted GPA of the graded Notre Dame courses from the entry term
 * on — this program's courses only (letter grades; S/U and in-progress rows
 * carry no points; an Incomplete counts as 0.000 until it is removed,
 * Academic Code §4.3 — GRADE_POINTS carries that). Undefined when nothing is
 * graded yet. Information only since 2026-10-03: §2.2 reads the registrar's figure. */
function gpaOfProgramCourses(courses: ParsedCourse[], start: EarlyStartFacts): number | undefined {
  let points = 0;
  let hours = 0;
  for (const c of courses) {
    if (c.origin !== 'nd' || beforeProgramStart({ term: c.term, registeredLevel: c.level }, start) || c.level === 'undergraduate') continue;
    const p = GRADE_POINTS[c.grade];
    if (p === undefined || c.credits <= 0) continue;
    points += p * c.credits;
    hours += c.credits;
  }
  return hours > 0 ? Math.round((points / hours) * 1000) / 1000 : undefined;
}

export function ndTranscriptPreviewBlock(args: NdUploadArgs): HTMLElement {
  const tp = transcriptPreview!;
  const box = el('div', { class: 'transcript-preview' });
  // The entry term the split below is judged against: the transcript's
  // reading while its checkbox is ticked, otherwise the standing card's.
  const entry = tp.useEntryTerm && tp.entryTerm ? tp.entryTerm.term : args.student.entryTerm;
  const startFacts = startFactsFor(entry, tp.degreesAwarded, args.student, tp.terms);
  const beforeStart = (c: ParsedCourse): boolean => beforeProgramStart({ term: c.term, registeredLevel: c.level }, startFacts);
  const priorCount = tp.courses.filter((c) => c.origin === 'nd' && beforeStart(c)).length;
  box.append(
    // The heading asks for the check a student can do — is each row read
    // right? — not for a verdict (clarity review 2026-09-26): what counts is
    // worked out after the add.
    el('h3', {}, `Found ${plural(tp.courses.length, 'course')} — check the rows, untick any that are wrong, then add`),
  );
  // The import checked against the transcript's own totals (item 11,
  // 2026-10-11): a term that does not add up is named with both figures, and
  // its rows are marked below.
  if ((tp.totalsCheck ?? []).length > 0) {
    box.append(
      el(
        'div',
        { class: 'import-warnings totals-check', role: 'note', 'data-key': 'preview.totals' },
        el('strong', {}, 'These do not add up — check the rows against your PDF: '),
        el('ul', {}, ...tp.totalsCheck!.map((m) => el('li', {}, m.message))),
      ),
    );
  }
  if (tp.warnings.length > 0) {
    // What the parser skipped or could not place — persistent, inside the
    // preview (usability review 2026-09-05, item 6).
    box.append(
      el(
        'div',
        { class: 'import-warnings', role: 'note' },
        el('strong', {}, 'Check these: '),
        el('ul', {}, ...tp.warnings.map((w) => el('li', {}, w))),
      ),
    );
  }
  if (tp.entryTerm) {
    // The transcript's reading of the entry term (2026-09-05) — applied by
    // default, because every deadline depends on it; explained, because a
    // combined transcript can support two readings.
    const cb = el('input', {
      type: 'checkbox',
      class: 'use-entry-term',
      'data-key': 'preview.entryTerm',
      onchange: (e) => {
        tp.useEntryTerm = (e.target as HTMLInputElement).checked;
        args.render();
      },
    });
    cb.checked = tp.useEntryTerm;
    box.append(
      el(
        'label',
        { class: 'attest entry-term-line' },
        cb,
        // The consequence is under the field in Your standing, in both
        // states (trim review 2026-09-18, P-30).
        args.student.entryTermInferred === undefined
          ? ` Replace the entry term you entered (${termLabel(args.student.entryTerm)}) with this transcript’s reading, ${termLabel(tp.entryTerm.term)} — ${tp.entryTerm.how}. Left unticked, your own entry term is kept.`
          : ` Your first semester in the program looks like ${termLabel(tp.entryTerm.term)} (${tp.entryTerm.how}). Every deadline is counted from it — untick this if you started in a different semester.`,
      ),
    );
    if (tp.entryTerm.alternative) box.append(el('p', { class: 'hint warn' }, `Note: ${tp.entryTerm.alternative.why}.`));
  }
  // The dated bachelor's award (2026-09-06) fills "Bachelor's degree awarded"
  // under Your standing, unless the student already set it by hand.
  const bs = bachelorsAwardRead(tp.degreesAwarded, tp.terms);
  if (bs && bachelorsMayBeSet(args.student)) {
    // The §5.2 rule is under the field it governs, one card down (trim
    // review 2026-09-18, P-13).
    box.append(el('p', { class: 'hint bachelors-line' }, bs.line));
  }
  if (priorCount > 0) {
    // A lead and visible bullets (clarity review 2026-09-26; the 2026-09-18
    // trim's "three parallel clauses as one list" made a list the eye can see).
    const can =
      args.student.program === 'phd'
        ? ['satisfy a core-knowledge area (§4.4.1)', 'count toward your credits, if you took it at Notre Dame as an undergraduate (§4.2)', 'transfer, if you took it as a graduate student elsewhere (§5.2)']
        : ['count toward your credits, if you took it at Notre Dame as an undergraduate (§3.2)', 'transfer, if you took it as a graduate student elsewhere (§5.2)'];
    box.append(
      el(
        'div',
        { class: 'hint prior-note' },
        `${plural(priorCount, 'course')} dated before ${termLabel(entry)} are listed separately as coursework from before you entered (no residency counts). Each can still do one of these:`,
        el('ul', {}, ...can.map((t) => el('li', {}, t))),
        'A course that can do none of these starts unticked.',
      ),
    );
  }
  // The rows that start unticked stay in the table but out of the way until
  // asked for (UI review, 2026-10-08: on a phone they were most of the list).
  // Only courses that can do nothing here; a row already on the record keeps
  // its "already entered" note in view (a re-import is all duplicates).
  tp.startUnticked ??= tp.selected.map((on, i) => !on && !tp.duplicate[i]);
  const tucked = tp.courses.map((_, i) => tp.startUnticked![i]! && !tp.selected[i] && !tp.showUnticked);
  const tuckedCount = tp.courses.filter((_, i) => tp.startUnticked![i]! && !tp.selected[i]).length;
  const table = el('table', { class: 'courses stack', id: 'nd-preview-rows' });
  table.append(
    el(
      'tr',
      {},
      el('th', { scope: 'col' }, el('span', { class: 'visually-hidden' }, 'Add')),
      el('th', { scope: 'col' }, 'Course'),
      el('th', { scope: 'col' }, 'Term'),
      el('th', { scope: 'col', abbr: 'Credits' }, 'Cr'),
      el('th', { scope: 'col' }, 'Grade'),
      el('th', { scope: 'col' }, el('span', { class: 'visually-hidden' }, 'Note')),
    ),
  );
  tp.courses.forEach((c, i) => {
    const cb = el('input', {
      type: 'checkbox',
      'aria-label': `Add ${c.courseId} (${termLabel(c.term)})`,
      'data-key': `preview.row.${i}`,
      onchange: (e) => {
        tp.selected[i] = (e.target as HTMLInputElement).checked;
        args.render(); // the Add button's count follows (item 13)
      },
    });
    cb.checked = tp.selected[i]!;
    const prior = c.origin === 'nd' && beforeStart(c);
    // The early-start summer (P3-chg-other-1): dated before the entry term, yet this program's.
    const earlyStart = c.origin === 'nd' && isEarlyStartCourse({ term: c.term, registeredLevel: c.level }, startFacts);
    const twin = twinOfBlockRow(args.student, c);
    const note = tp.duplicate[i]
      ? twin
        ? `already entered from your ${twin.institution ?? 'other'} transcript (${termLabel(twin.term)}) — kept as one course, marked as accepted on your Notre Dame record`
        : 'already entered'
      : c.origin === 'transfer'
        ? // The record the block sits on (P3-import-1 (b), 2026-10-05).
          c.level === 'undergraduate'
          ? 'undergraduate credit on your bachelor’s record — not graduate transfer credit'
          : c.level === 'graduate'
            ? `transfer credit accepted on your Notre Dame record (posted ${termLabel(c.term)})`
            : 'transfer credit on your Notre Dame record — the transcript does not show its level, so the DGS confirms it'
        : prior
          ? `taken before ${termLabel(entry)}, as ${priorNdDegreeLevel({ courseId: c.courseId, registeredLevel: c.level, term: c.term }, bachelorsTermFor(tp.degreesAwarded, args.student, tp.terms)) === 'bachelors' ? 'an undergraduate' : args.student.ndMasters !== undefined ? 'an MSCSE student' : 'a graduate student'}`
          : earlyStart
            ? `your early start, the summer before ${termLabel(entry)} — this program’s coursework`
            : '';
    // A row of a term whose totals do not add up (item 11): marked, and said.
    const doubted = doubtedTerms(tp.totalsCheck ?? []).some((t) => termIndex(t) === termIndex(c.term)) && c.origin === 'nd';
    table.append(
      el(
        'tr',
        { class: `${prior ? 'prior-row' : ''}${doubted ? ' totals-doubt' : ''}`.trim(), ...(tucked[i] ? { hidden: '' } : {}) },
        el('td', { class: 'cell-check' }, cb),
        el('td', { class: 'cell-course' }, el('div', { class: 'cid' }, c.courseId), el('div', { class: 'ctitle' }, c.title ?? '')),
        el('td', { class: 'cell-meta', 'data-label': 'Term' }, el('abbr', { class: 'term', title: termLabel(c.term) }, termShort(c.term))),
        el('td', { class: 'cell-meta', 'data-label': 'Credits' }, String(c.credits)),
        // A transfer-block row prints credit hours only (the grade is not in the
        // GPA): no grade, not "in progress" (P3-import-1, 2026-10-05).
        el('td', { class: 'cell-meta', 'data-label': 'Grade' }, c.grade === 'IP' ? (c.origin === 'transfer' ? '—' : 'In progress') : c.grade),
        el('td', { class: 'ctitle cell-note' }, note, doubted ? el('span', { class: 'totals-doubt-note' }, `${note ? ' — ' : ''}⚠ ${termLabel(c.term)} does not add up: check this row`) : null),
      ),
    );
  });
  // Select all / none (item 13) — the duplicates stay unticked either way.
  const selectAll = (on: boolean) => {
    tp.courses.forEach((_, i) => (tp.selected[i] = on && !tp.duplicate[i]));
    args.render();
  };
  const addLabel = `Add ${plural(tp.selected.filter(Boolean).length, 'selected course')}`;
  const cancel = (): void => {
    transcriptPreview = undefined;
    args.setFocusAfterRender('import.nd');
    args.render();
  };
  box.append(
    // Add / Cancel at the top too (UI review, 2026-10-08: on a phone they
    // were thousands of pixels down) — the same actions as at the foot.
    el(
      'div',
      { class: 'save-buttons preview-top-actions' },
      el('button', { class: 'btn primary', 'data-key': 'preview.add.top', onclick: () => applyNdPreview(tp, args) }, addLabel),
      el('button', { class: 'btn', 'data-key': 'preview.cancel.top', onclick: cancel }, 'Cancel'),
    ),
    el(
      'p',
      { class: 'select-links' },
      el('button', { class: 'btn tiny', 'data-key': 'preview.all', onclick: () => selectAll(true) }, 'Select all'),
      ' ',
      el('button', { class: 'btn tiny', 'data-key': 'preview.none', onclick: () => selectAll(false) }, 'Select none'),
    ),
    table,
    tuckedCount > 0
      ? el(
          'p',
          { class: 'select-links' },
          el(
            'button',
            {
              class: 'btn tiny',
              'data-key': 'preview.unticked.toggle',
              'data-own-expanded': '',
              'aria-expanded': tp.showUnticked ? 'true' : 'false',
              'aria-controls': 'nd-preview-rows',
              onclick: () => {
                tp.showUnticked = !tp.showUnticked;
                args.setFocusAfterRender('preview.unticked.toggle');
                args.render();
              },
            },
            tp.showUnticked ? `Hide the ${plural(tuckedCount, 'course')} that start unticked` : `Show the ${plural(tuckedCount, 'course')} that start unticked`,
          ),
        )
      : '',
  );
  // The GPA for the §2.2 check (combined-transcript bug report 2026-09-05).
  if (tp.gpa !== undefined && tp.programGpa !== undefined) {
    // One figure (policy review 2026-10-03, replacing the 2026-09-05 choice):
    // the registrar's graduate cumulative GPA is the Academic Code's one
    // "cumulative GPA" (§4.5) and decides §2.2; this program's own average is
    // shown for information, and the §2.2 row asks the DGS when the two
    // straddle the minimum.
    const cb = el('input', { type: 'checkbox', 'data-key': 'preview.gpa', onchange: (e) => (tp.gpaChoice = (e.target as HTMLInputElement).checked ? 'transcript' : 'none') });
    cb.checked = tp.gpaChoice === 'transcript';
    box.append(
      el(
        'fieldset',
        { class: 'gpa-choice group' },
        el('legend', { class: 'label' }, 'Cumulative GPA for the minimum-GPA check (§2.2)'),
        el(
          'p',
          { class: 'hint' },
          `Your transcript's graduate-level cumulative GPA (${gpaText(tp.gpa)}) includes graduate courses taken at Notre Dame before ${termLabel(entry)} (an earlier program). The Academic Code reads that one cumulative figure (Academic Code §4.5), so it is the one used for §2.2; this program's courses alone average ${tp.programGpa.toFixed(2)}, shown for information. If the two fall on different sides of 3.0 the report asks the DGS.${tp.undergraduateGpa !== undefined ? ` The undergraduate GPA (${tp.undergraduateGpa.toFixed(2)}) is not used.` : ''}`,
        ),
        el('label', { class: 'attest' }, cb, ` Use the transcript's graduate cumulative GPA (${gpaText(tp.gpa)}) for the minimum-GPA check (§2.2)`),
      ),
    );
  } else if (tp.gpa !== undefined) {
    const cb = el('input', { type: 'checkbox', 'data-key': 'preview.gpa', onchange: (e) => (tp.gpaChoice = (e.target as HTMLInputElement).checked ? 'transcript' : 'none') });
    cb.checked = tp.gpaChoice === 'transcript';
    box.append(
      el(
        'label',
        { class: 'attest' },
        cb,
        ` Use the transcript's ${tp.undergraduateGpa !== undefined ? 'graduate-level ' : ''}cumulative GPA (${gpaText(tp.gpa)}) for the minimum-GPA check (§2.2)${tp.undergraduateGpa !== undefined ? ` — the undergraduate GPA (${tp.undergraduateGpa.toFixed(2)}) is not used` : ''}`,
      ),
    );
  } else if (tp.undergraduateGpa !== undefined) {
    box.append(
      el(
        'p',
        { class: 'hint warn' },
        `No graduate-level cumulative GPA was found on this transcript yet — the undergraduate GPA (${tp.undergraduateGpa.toFixed(2)}) does not apply to §2.2. Enter your graduate GPA under Coursework once your first grades post.`,
      ),
    );
  }
  box.append(
    el(
      'div',
      { class: 'save-buttons' },
      el(
        'button',
        {
          class: 'btn primary',
          'data-key': 'preview.add',
          onclick: () => applyNdPreview(tp, args),
        },
        addLabel,
      ),
      el('button', { class: 'btn', 'data-key': 'preview.cancel', onclick: cancel }, 'Cancel'),
    ),
    // "Did the reader get this transcript wrong?" (DGS 2026-10-11, item 18).
    // The Notre Dame preview's rows cannot be edited, so it reports counts only.
    ...readerProblemLink('preview.problem', () => ({ which: 'Notre Dame transcript', university: 'University of Notre Dame', readBy: 'the PDF’s text', rowsRead: tp.courses.length, rowsTicked: tp.selected.filter(Boolean).length, rowsTyped: 0, changed: [] }), args.checkedWith, deciderContact(args.student.program), false),
  );
  return box;
}

/** The preview's Add: file the ticked rows on the record, apply what the
 * transcript read for the standing card (entry term, bachelor's award, prior
 * degrees, the MSCSE box, the GPA), close the preview and say what was done. */
function applyNdPreview(tp: NdPreview, args: NdUploadArgs): void {
  const picked = tp.courses.filter((_, i) => tp.selected[i]);
  let priorAdded = 0;
  let priorSet: Student['priorMs'] | undefined;
  let bachelorsSet: Term | undefined;
  let ndMastersSet = false;
  let earlierRead = false as ReadingResult;
  // "Import again" replaces the earlier Notre Dame import (UI review item 13;
  // DGS 2026-10-09: option (b)): remove, then add — one Undo. A hand-corrected
  // row from the earlier import is replaced too; Undo restores it.
  let replaced: NdImportSnapshot | undefined;
  args.update((s) => {
    if (s.courses.some((c) => c.fromNdTranscript === true)) replaced = takeNdImport(s);
    if (tp.useEntryTerm && tp.entryTerm) {
      s.entryTerm = { ...tp.entryTerm.term };
      s.entryTermInferred = { how: tp.entryTerm.how, alternative: tp.entryTerm.alternative };
      args.refusedValues.delete('standing.year'); // the transcript answered this box
    }
    // Likewise for the two boxes the import fills in below: a
    // refusal left over from something typed earlier would show a
    // rejected figure beside a row now reading the transcript's
    // (R1, 2026-09-18).
    if (tp.gpaChoice !== 'none') args.refusedValues.delete('courses.gpa');
    // The bachelor's award term (2026-09-06), before the prior
    // rows are filed — they follow it when unlabelled.
    const bs = bachelorsAwardRead(tp.degreesAwarded, tp.terms);
    if (bs && bachelorsMayBeSet(s)) {
      args.refusedValues.delete('standing.bachelors.year');
      s.bachelorsAwarded = bs.term;
      s.bachelorsAwardedInferred = { how: bs.how };
      bachelorsSet = bs.term;
    }
    for (const c of picked) {
      // Ticked by hand though another transcript brought it: still one course (c).
      if (c.origin === 'transfer' && twinOfBlockRow(s, c) !== undefined) continue;
      const entryCourse: CourseEntry = {
        courseId: c.courseId,
        title: c.title,
        credits: c.credits,
        term: c.term,
        grade: c.grade,
        origin: c.origin,
        institution: c.institution,
        registeredLevel: c.level,
        // A transfer-block row is credit the record shows as accepted, dated by
        // the term it was posted (P3-import-1, Option 1; DGS 2026-10-05); on
        // the undergraduate record it is bachelor's coursework (b).
        ...(c.origin === 'transfer' ? { ndPosted: postingOf(c), ...(c.level === 'undergraduate' ? { degreeLevel: 'bachelors' as const } : {}) } : {}),
        fromNdTranscript: true, // so "Remove" can take back exactly these rows
        // Where it came from (DGS 2026-10-11, item 6). The preview's rows cannot
        // be edited, so nothing here is ever "changed by the student".
        ...(args.todayIso ? { imported: { transcript: 'nd' as const, on: args.todayIso, app: APP_BUILD.commit } } : {}),
      };
      s.courses.push(entryCourse);
    }
    // (c): a block row whose course another transcript already brought is not
    // added twice — that row carries the Notre Dame record's acceptance
    // instead (condition 2), ticked or not, since it is a fact about it.
    for (const c of tp.courses) {
      if (c.origin !== 'transfer') continue;
      const twin = twinOfBlockRow(s, c);
      if (twin && twin.ndPosted === undefined) twin.ndPosted = postingOf(c);
    }
    // A Notre Dame master's degree awarded BEFORE this program is
    // one the student already holds (DGS 2026-09-09) — §4.5's
    // along-the-way MSCSE is then not something to earn, and the
    // report leaves that row out. A master's dated after the entry
    // term is the along-the-way award itself, so the date decides;
    // an undated conferral line leaves the checkbox to the student.
    // Kept on the record so the reading can be made again when the
    // entry term changes — which for a 4+1 it usually does. Set
    // before the filing below: a degree awarded in the summer just
    // before a fall entry keeps that summer's courses with the degree
    // they finished, not the early start (P3-chg-other-1, 2026-10-05).
    s.ndDegrees = tp.degreesAwarded
      .filter((d) => d.date !== undefined && d.level !== 'other')
      .map((d) => ({ level: d.level as 'bachelors' | 'masters' | 'phd', date: d.date! }));
    // Pre-entry Notre Dame courses → prior coursework (2026-09-05).
    priorAdded = reclassifyNotreDameCourses(s).toPrior;
    // What the transcript settles of the earlier-degrees answer (DGS
    // 2026-10-08, Option 1) — the bachelor's, from its undergraduate terms and
    // major; a graduate program in another department — filled in for the
    // student to check, never over an answer already there.
    earlierRead = mergeReading(s, readBackgroundFromNdTerms(tp.terms));
    if (s.background === undefined) deriveNdMasters(s); // an answered background settles this (2026-09-22)
    ndMastersSet = s.background === undefined && s.ndMasters !== undefined;
    // Prior GRADUATE coursework at Notre Dame sets "Prior graduate
    // study" the way an uploaded Master's transcript does
    // (2026-09-03 rule): completed when the transcript shows a
    // graduate degree awarded, else "not completed" + the warning.
    // derivePriorMs carries the Notre Dame master's; an UNDATED
    // conferral line still counts as "completed" here, since it
    // says the degree exists even where it cannot be placed.
    const before = s.priorMs;
    if (s.background === undefined && s.priorMs === 'none' && s.ndMasters === undefined && hasPriorGraduateStudy(s) && tp.degreesAwarded.some((d) => d.level === 'masters' || d.level === 'phd')) {
      s.priorMs = 'completed';
      s.priorMsInferred = true;
    }
    if (s.background === undefined) derivePriorMs(s);
    if (s.priorMs !== before) priorSet = s.priorMs;
    // The transcript's per-term figures replace any earlier import's
    // (2026-10-04); a layout that prints none clears them.
    s.termGpas = tp.termGpas && tp.termGpas.length > 0 ? tp.termGpas : undefined;
    if (tp.gpaChoice === 'transcript' && tp.gpa !== undefined) {
      s.gpa = tp.gpa;
      s.gpaSource = { basis: 'transcript-graduate', programGpa: tp.programGpa, undergraduateGpa: tp.undergraduateGpa };
    } else if (tp.gpaChoice === 'program' && tp.programGpa !== undefined) {
      s.gpa = tp.programGpa;
      s.gpaSource = { basis: 'program-only', transcriptGpa: tp.gpa, undergraduateGpa: tp.undergraduateGpa };
    }
  });
  const appliedEntry = tp.useEntryTerm && tp.entryTerm ? tp.entryTerm.term : undefined;
  transcriptPreview = undefined;
  args.setFocusAfterRender('import.nd');
  args.render();
  // "Check it under Your standing" once, at the end, for the entry
  // term and the bachelor's term together — it used to follow each
  // (trim review 2026-09-18, P-90). The unfinished-M.S. clause keeps
  // its own, different instruction.
  // What was read from the transcript, in the student's words (clarity
  // review 2026-09-26): the count, then the one or two settings to confirm.
  const read: string[] = [];
  if (appliedEntry) read.push(`your first semester (${termLabel(appliedEntry)})`);
  if (bachelorsSet) read.push(`your bachelor’s semester (${termLabel(bachelorsSet)})`);
  const message =
    `Added ${plural(picked.length, 'course')} from the transcript${priorAdded > 0 ? ` (${priorAdded} from before you entered)` : ''}.` +
      (read.length > 0 ? ` ${read.length === 1 ? 'One thing was' : 'Two things were'} read from your transcript — ${read.join(' and ')} — please confirm ${read.length === 1 ? 'it' : 'them'} under Your standing.` : '') +
      (priorSet === 'completed'
        ? ' Prior graduate study was set to “Completed prior M.S. or Ph.D.” from the degree awarded on your transcript.'
        : priorSet === 'unfinished'
          ? ' Prior graduate study was set to “Prior M.S., not completed” — no graduate degree award was found on your transcript; if you did earn it, say so in the earlier-degrees questions in the Transcripts card.'
          : '') +
      (ndMastersSet ? ' A Notre Dame master’s degree on your transcript was taken as the MSCSE — the §4.5 along-the-way row is left out for you; if it is another department’s, say so in the earlier-degrees questions in the Transcripts card.' : '') +
      // Option 1 (DGS 2026-10-08): the earlier-degrees answers it filled in.
      (earlierRead === 'disagree' ? ' Your transcripts disagree about your earlier degrees — answer those questions in the Transcripts card.' : earlierRead ? ' Your earlier degrees were partly filled in from it — check them in the Transcripts card.' : '');
  if (replaced) {
    const snap = replaced;
    args.toastWithAction(
      `${message} The ${plural(snap.removed.length, 'course')} imported earlier ${snap.removed.length === 1 ? 'was' : 'were'} replaced.`,
      'Undo',
      () =>
        args.update((s) => {
          stripNdPostings(s);
          s.courses = s.courses.filter((c) => c.fromNdTranscript !== true);
          putBackNdImport(s, snap, true);
        }, { quiet: true }),
      { ttlMs: 20000, focusKey: 'import.nd' },
    );
  } else args.toast(message);
}
