// Simulation mode (DGS 2026-10-09): "allow students to simulate future years
// for planning purposes … change the 'current term' and add courses and other
// items to see how things will go in the future."
//
// The model (DECISIONS 2026-10-09): the REAL record stays under state.ts's
// LS_KEY, untouched. The simulation is a deep copy of it, stored under
// SIM_KEY as { term, student }, and app.ts swaps that copy into its one
// `student` variable so every control on the page works on the copy. One
// persist() gate in app.ts saves the simulation while the mode is on and the
// real record otherwise; NO path turns a plan into the real record. A reload
// reopens in the mode (the stored simulation is found first); Exit discards
// the copy and puts the real record back from memory.
//
// The engine stays pure: audit(student, rules, today) is called with the
// simulated "today" (simulationToday) — the first day of the chosen semester,
// or the real date when the chosen semester is the real current one.
//
// Everything in this file is DOM-free except the three localStorage calls
// (mirroring state.ts), so tests/simulation.test.ts can cover the rest.
import type { SavedStamp } from './stamp.ts';
import { staleInProgressSentence } from '../engine/allocate.ts';
import type { AuditReport } from '../engine/types.ts';
import { compareTerm, nthSemester, parseTermCode, startOfTerm, termIndex, termLabel, termOfDate, termShort } from '../engine/term.ts';
import type { Season, Student, Term } from '../engine/types.ts';
import { plural } from './email-html.ts';
import { type LoadCleanup, type Refusal, validateStudent } from './state.ts';

/** Where the simulation lives in localStorage — never the real record's key. */
export const SIM_KEY = 'cse-degree-audit/v1/simulation';

export interface Simulation {
  /** The semester the page pretends it is in. */
  term: Term;
  /** The planning copy of the record — the one every control edits in the mode. */
  student: Student;
}

/** How many years ahead the semester picker reaches (DGS 2026-10-09: "simulate
 * future years"; ten covers the Ph.D.'s eight-year limit with room). */
export const SIMULATION_YEARS_AHEAD = 10;

const SEASONS_IN_ORDER: readonly Season[] = ['spring', 'summer', 'fall']; // termIndex's order

/** The term `index` (termIndex) names. */
function termOfIndex(index: number): Term {
  return { season: SEASONS_IN_ORDER[((index % 3) + 3) % 3]!, year: Math.floor(index / 3) };
}

/** The semesters the picker offers: from the real current term to the same
 * season ten years ahead, summers included — a summer is a semester a student
 * may plan a course in, even where the handbook's clocks skip it. */
export function simulationTerms(realIso: string): Term[] {
  const first = termOfDate(realIso);
  const last: Term = { season: first.season, year: first.year + SIMULATION_YEARS_AHEAD };
  const out: Term[] = [];
  for (let i = termIndex(first); i <= termIndex(last); i++) out.push(termOfIndex(i));
  return out;
}

/** The picker's default: the NEXT fall or spring, counted on fall/spring slots
 * like every clock in term.ts — so a summer date looks ahead to that fall, not
 * to the spring after it (2026-10-09 → Spring 2027; 2027-02-01 → Fall 2027;
 * 2027-07-01 → Fall 2027). */
export function defaultSimulationTerm(realIso: string): Term {
  const t = termOfDate(realIso);
  const base: Term = t.season === 'summer' ? { season: 'spring', year: t.year } : t;
  return nthSemester(base, 2);
}

/** A term the page can simulate: never before the real current term (a
 * simulation stored last semester, or a file saved then, must not move time
 * backwards), never past the picker's last option. */
export function clampSimulationTerm(term: Term, realIso: string): Term {
  const terms = simulationTerms(realIso);
  const first = terms[0]!;
  const last = terms[terms.length - 1]!;
  if (compareTerm(term, first) < 0) return first;
  if (compareTerm(term, last) > 0) return last;
  return term;
}

/** What "today" is inside the simulation: the real date while the simulated
 * semester is the real current one (time never moves backwards — a plan for
 * "this semester" is the page as it is), otherwise the first day of the
 * simulated semester (startOfTerm; termOfDate reads that day back as the same
 * term, so every "current semester" the engine derives agrees with the picker). */
export function simulationToday(term: Term, realIso: string): string {
  if (compareTerm(term, termOfDate(realIso)) <= 0) return realIso;
  return startOfTerm(term).date;
}

/** The report as the page shows it in simulation mode: each "has ended and
 * … still read In progress" warning in its simulation wording — no "Import
 * again", which is inert in the mode (DGS 2026-10-25, "yes, reword"; the
 * Next steps item already dropped it, next-steps.ts). Every other warning,
 * and every row, is the engine's own. */
export function simulationWarnings(report: AuditReport): AuditReport {
  const groups = report.staleInProgress ?? [];
  if (groups.length === 0) return report;
  const swap = new Map(groups.map((g) => [staleInProgressSentence(g), staleInProgressSentence(g, true)]));
  return { ...report, warnings: report.warnings.map((w) => swap.get(w) ?? w) };
}

/** The picker's option values: the semester CODE the tables print ("SP28"),
 * read back with term.ts's own parser. */
export function simulationTermCode(term: Term): string {
  return termShort(term);
}
export function parseSimulationTermCode(code: string): Term | undefined {
  return parseTermCode(code);
}

// ---------- the saved file (D3) ----------

/** The file "Save to a file" writes in the mode: cse-degree-audit-phd-simulation-SP28.json. */
export function simulationFileName(program: Student['program'], term: Term): string {
  return `cse-degree-audit-${program}-simulation-${termShort(term)}.json`;
}

/** The file's contents. The note comes FIRST so a human opening the file sees
 * what it is before anything else; `simulation.term` is what lets this app
 * reopen it in the mode; an older build, which knows neither key, reads the
 * `student` inside as an ordinary record (state.ts validateStudent accepts
 * the { savedAt, student } wrapper and ignores the rest). */
export function simulationFilePayload(student: Student, term: Term, savedAt: string, stamp?: SavedStamp): { note: string; simulation: { term: Term }; savedAt: string; stamp?: SavedStamp; student: Student } {
  return {
    note: `SIMULATION of ${termLabel(term)} — a planning copy, not this student's record`,
    simulation: { term },
    savedAt,
    // What the plan was checked with (item 8, 2026-10-11), as in the record's file.
    ...(stamp ? { stamp } : {}),
    student,
  };
}

/** The simulated semester a loaded file carries, if it is a simulation file —
 * undefined for an ordinary record. */
export function simulationTermOfFile(raw: unknown): Term | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const sim = (raw as { simulation?: unknown }).simulation;
  if (!sim || typeof sim !== 'object') return undefined;
  const term = (sim as { term?: unknown }).term as Partial<Term> | undefined;
  if (!term || typeof term.year !== 'number' || !SEASONS_IN_ORDER.includes(term.season as Season)) return undefined;
  return { season: term.season as Season, year: term.year };
}

/** Why a simulation file is refused while a transcript preview or a scan is
 * open (review fix 2026-10-09): the preview's rows belong to the REAL record,
 * and entering the mode under it would let its Add file them into the plan —
 * and Exit would then discard them. Same rule as the Simulate button's
 * PREVIEW_OPEN_NOTE, worded for the file. */
export const SIMULATION_FILE_PREVIEW_NOTE =
  'That is a simulation file, and a transcript preview is open: add those courses to your record (“Add …”) or cancel the preview first, then load the file.';

/** What the page holds before a file is loaded, and what it holds after. */
export interface LoadedFileRoute {
  /** The page's record after the load (the one every control edits). */
  student: Student;
  /** The mode after the load: unchanged for a record loaded outside it. */
  simulation: Simulation | undefined;
  /** The real record kept in memory for Exit: unchanged, or — when a
   * simulation file enters the mode — the record that was on the page. */
  realStudent: Student | undefined;
  /** Which of the three routes was taken, for the toast. */
  outcome: 'record' | 'entered' | 'into-simulation';
}

/** Where "Load a file" puts a file (D3; DGS 2026-10-09): OUTSIDE the mode an
 * ordinary record replaces the record, and a simulation file enters the
 * mode with its semester (clamped so time never runs backwards), leaving the
 * record on the page untouched in memory; INSIDE the mode any file — a
 * record or a simulation — loads into the simulation, never into the real
 * record (D2); a simulation file brings its own semester with it. Pure: the
 * caller renders and persists. Throws what validateStudent throws — and
 * SIMULATION_FILE_PREVIEW_NOTE when a simulation file would enter the mode
 * while a transcript preview or scan is open (`page.previewOpen`, the same
 * guard the Simulate button has; review fix 2026-10-09): the preview belongs
 * to the record, so the mode must start from a settled one. */
export function routeLoadedFile(raw: unknown, page: { student: Student; simulation: Simulation | undefined; realStudent: Student | undefined; previewOpen?: boolean }, realIso: string, refusals: Refusal[] = [], cleanup: LoadCleanup = {}): LoadedFileRoute {
  const imported = validateStudent(raw, refusals, cleanup);
  const fileTerm = simulationTermOfFile(raw);
  if (page.simulation) {
    const term = fileTerm === undefined ? page.simulation.term : clampSimulationTerm(fileTerm, realIso);
    return { student: imported, simulation: { term, student: imported }, realStudent: page.realStudent, outcome: 'into-simulation' };
  }
  if (fileTerm !== undefined) {
    if (page.previewOpen) throw new Error(SIMULATION_FILE_PREVIEW_NOTE);
    return { student: imported, simulation: { term: clampSimulationTerm(fileTerm, realIso), student: imported }, realStudent: page.student, outcome: 'entered' };
  }
  return { student: imported, simulation: undefined, realStudent: page.realStudent, outcome: 'record' };
}

// ---------- localStorage (mirrors state.ts loadLocal / saveLocal / clearLocal) ----------

export function loadSimulation(refusals: Refusal[] = [], cleanup: LoadCleanup = {}): Simulation | undefined {
  try {
    const raw = localStorage.getItem(SIM_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as { term?: unknown; student?: unknown };
    const term = simulationTermOfFile({ simulation: parsed });
    if (term === undefined) return undefined;
    return { term, student: validateStudent(parsed.student, refusals, cleanup) };
  } catch {
    return undefined; // a corrupted simulation → the real record, as if the mode were off
  }
}

export function saveSimulation(sim: Simulation): void {
  try {
    localStorage.setItem(SIM_KEY, JSON.stringify({ term: sim.term, student: sim.student }));
  } catch {
    // private mode / storage full — the mode still works for this visit
  }
}

export function clearSimulation(): void {
  try {
    localStorage.removeItem(SIM_KEY);
  } catch {
    /* ignore */
  }
}

/** Whether anything is stored under SIM_KEY — readable or not. The crash
 * fallback in main.ts asks this before it offers to clear anything. */
export function simulationStored(): boolean {
  try {
    return localStorage.getItem(SIM_KEY) !== null;
  } catch {
    return false;
  }
}

// ---------- the crash fallback (main.ts) ----------

/** What main.ts offers when startApp throws (review fix 2026-10-09). With a
 * simulation stored, the page opened IN the mode and drew the planning copy,
 * so the copy — not the record — is what broke the page: the one button
 * discards the simulation and keeps the record (a plan is disposable; the
 * record is not). It used to clear the record's key alone, which lost the
 * record and left the simulation to crash the page again on the reload.
 * Without a simulation stored, the record is cleared as before — and the
 * simulation key with it, so nothing stored can survive a "start fresh". Pure. */
export interface CrashRecovery {
  /** The sentence above the button. */
  message: string;
  /** The button's label. */
  button: string;
  /** Which storage the button clears. */
  clears: 'simulation' | 'all';
}
export function crashRecovery(simulationStored: boolean, reason: string | undefined): CrashRecovery {
  const why = reason ? ` (${reason})` : '';
  return simulationStored
    ? {
        message: `Something went wrong showing the simulation you left open${why}. You can discard the simulation and go back to your record — or close this tab if you want to try again later.`,
        button: 'Discard the simulation and show my record',
        clears: 'simulation',
      }
    : {
        message: `Something went wrong showing your saved data${why}. You can clear it and start fresh — or close this tab if you want to try again later.`,
        button: 'Clear saved data and start fresh',
        clears: 'all',
      };
}

// ---------- what Exit discards ----------

export interface SimulationChanges {
  /** Course rows added, changed or removed since the copy was taken. */
  courses: number;
  /** Milestone DATES added, changed or cleared. */
  milestoneDates: number;
  /** Everything else that differs: a standing answer, an attestation tick, an
   * advisor's name, the GPA … one per field. */
  other: number;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A course row's identity for the comparison: the same course in the same
 * semester at the same place. Two rows with the same identity are told apart
 * by their full contents (multiset below), so a retake typed twice still counts. */
function courseKey(c: Student['courses'][number]): string {
  return `${c.courseId}|${termShort(c.term)}|${c.institution ?? ''}`;
}

/** How many of the rows under one key differ: the longer list's length less
 * the rows both lists hold (as multisets of their JSON), so an added row is
 * 1, a removed row is 1, and an edited row is 1 — not 2. */
function differingRows(a: string[], b: string[]): number {
  const pool = [...b];
  let common = 0;
  for (const x of a) {
    const i = pool.indexOf(x);
    if (i >= 0) {
      pool.splice(i, 1);
      common++;
    }
  }
  return Math.max(a.length, b.length) - common;
}

/** What the simulation holds that the real record does not — the Exit
 * confirmation names it, so a student does not throw away an afternoon's plan
 * by accident. Pure: compares the two records field by field. */
export function countChangesSince(real: Student, sim: Student): SimulationChanges {
  // Courses, grouped by identity.
  const byKey = new Map<string, { real: string[]; sim: string[] }>();
  const bucket = (k: string): { real: string[]; sim: string[] } => {
    let b = byKey.get(k);
    if (!b) {
      b = { real: [], sim: [] };
      byKey.set(k, b);
    }
    return b;
  };
  for (const c of real.courses) bucket(courseKey(c)).real.push(JSON.stringify(c));
  for (const c of sim.courses) bucket(courseKey(c)).sim.push(JSON.stringify(c));
  let courses = 0;
  for (const b of byKey.values()) courses += differingRows(b.real, b.sim);
  // Milestones: a date key counts under "milestone dates", a name or a choice
  // under "other".
  let milestoneDates = 0;
  let other = 0;
  const realMs = real.milestones as Record<string, unknown>;
  const simMs = sim.milestones as Record<string, unknown>;
  for (const k of new Set([...Object.keys(realMs), ...Object.keys(simMs)])) {
    if (JSON.stringify(realMs[k]) === JSON.stringify(simMs[k])) continue;
    const isDate = [realMs[k], simMs[k]].some((v) => typeof v === 'string' && ISO_DATE.test(v));
    if (isDate) milestoneDates++;
    else other++;
  }
  // Attestations, one per tick.
  const realAt = real.attestations as Record<string, unknown>;
  const simAt = sim.attestations as Record<string, unknown>;
  for (const k of new Set([...Object.keys(realAt), ...Object.keys(simAt)])) {
    if (JSON.stringify(realAt[k]) !== JSON.stringify(simAt[k])) other++;
  }
  // Every other field of the record, one each.
  const realRec = real as unknown as Record<string, unknown>;
  const simRec = sim as unknown as Record<string, unknown>;
  for (const k of new Set([...Object.keys(realRec), ...Object.keys(simRec)])) {
    if (k === 'courses' || k === 'milestones' || k === 'attestations') continue;
    if (JSON.stringify(realRec[k]) !== JSON.stringify(simRec[k])) other++;
  }
  return { courses, milestoneDates, other };
}

/** The Exit confirmation's sentence: "3 courses, 1 milestone date and 2 other
 * changes made since you entered; the simulated semester Spring 2028". */
export function changesSentence(changes: SimulationChanges, term: Term): string {
  return `${plural(changes.courses, 'course')}, ${plural(changes.milestoneDates, 'milestone date')} and ${plural(changes.other, 'other change')} made since you entered; the simulated semester ${termLabel(term)}`;
}
