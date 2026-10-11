// Each import checks itself against the transcript's own totals (DGS
// 2026-10-11, item 11: "make each import check itself"). A transcript prints,
// per term and for the whole record, how many hours were earned and the GPA;
// the rows the reader found must add up to them. When they do not, a row was
// missed or misread, and the preview says which term and both figures —
// "Fall 2023 prints 9.0 earned hours; the rows read add to 6.0 — a row may be
// missing or misread" — and marks that term's rows, so the student checks
// them against the PDF before adding them.
//
// Pure, and shared by every reader: the Notre Dame parser (parse.ts) and the
// other universities' (external.ts) record the totals lines they read as
// PrintedTotals; the check never decides anything about a requirement.
//
// What counts:
//   earned hours — a passing grade (A–D with + or −, S, P, CR) earns its
//     credits; F, U, W, I, IP, NR, V do not. A row from the transcript's own
//     transfer block (Notre Dame's "Transfer credit accepted") is earned
//     credit, and counts toward an "Overall" line, which Banner prints as
//     institution plus transfer.
//   GPA — the quality points of the letter-graded rows over their hours, on
//     the 4.0 scale (A 4, A− 3.667, B+ 3.333 …), within 0.01 of the printed
//     figure; checked only where the line prints its GPA hours as more than 0.
// A line is matched against its scope's rows of its level, by each row's
// registration — or by the level of the term the row sits in — or every row of
// the scope (a graduate course taken in an undergraduate term is filed either
// way by different registrars); a mismatch is reported only when none adds up.
import { compareTerm, termLabel } from '../engine/term.ts';
import type { Grade, Term } from '../engine/types.ts';

/** The level a row or a totals block is registered at (as parse.ts names it). */
export type RegisteredLevel = 'undergraduate' | 'graduate';

export interface PrintedTotals {
  /** `term`: one term's own line; `cumulative`: running, through `term`;
   * `overall`: the whole record (of `level` when the block names one). */
  scope: 'term' | 'cumulative' | 'overall';
  term?: Term;
  level?: RegisteredLevel;
  earned?: number;
  gpaHours?: number;
  gpa?: number;
  /** The rows the line closes, by index into the reader's rows (the rows read
   * since the term's header): a combined transcript prints the same term in
   * its undergraduate and its graduate record, each with its own line. When
   * given, only these rows — and rows the student typed for that term — are
   * matched. */
  rows?: number[];
}

/** The row fields the check reads (Notre Dame's ParsedCourse and the other
 * universities' preview rows both have them). */
export interface CheckedRow {
  term: Term;
  credits: number;
  grade: Grade | string;
  level?: RegisteredLevel;
  /** The level of the TERM the row sits in, when the transcript labels its
   * terms (insideND's "Term Totals (Graduate)"): a level's totals may count
   * a term's rows by the term, not by each row's registration. */
  termLevel?: RegisteredLevel;
  /** A row of the transcript's own transfer block. */
  transferBlock?: boolean;
  /** Typed by the student in the preview (a row the reader missed): matched
   * to a line of its term even when the line names its rows. */
  typed?: boolean;
}

export interface TotalsMismatch {
  scope: PrintedTotals['scope'];
  term?: Term;
  level?: RegisteredLevel;
  kind: 'earned' | 'gpa';
  printed: number;
  read: number;
  /** The preview's sentence. */
  message: string;
}

/** Two scales registrars use: thirds (Notre Dame: A− 3.667, B+ 3.333) and
 * tenths (A− 3.7, B+ 3.3); a GPA within 0.01 of either passes. */
const SCALES: readonly Record<string, number>[] = [
  { 'A+': 4, A: 4, 'A-': 3.667, 'B+': 3.333, B: 3, 'B-': 2.667, 'C+': 2.333, C: 2, 'C-': 1.667, 'D+': 1.333, D: 1, 'D-': 0.667, F: 0 },
  { 'A+': 4, A: 4, 'A-': 3.7, 'B+': 3.3, B: 3, 'B-': 2.7, 'C+': 2.3, C: 2, 'C-': 1.7, 'D+': 1.3, D: 1, 'D-': 0.7, F: 0 },
];
const EARNING = /^(A\+?|A-|B[+-]?|C[+-]?|D[+-]?|S|P|CR)$/;

/** Hours a row earns. */
function earnedBy(r: CheckedRow): number {
  if (r.transferBlock) return r.credits;
  return EARNING.test(String(r.grade).toUpperCase()) ? r.credits : 0;
}

/** Quality points and GPA hours of letter-graded rows, on one scale. */
function gpaOf(rows: readonly CheckedRow[], scale: Record<string, number>): { hours: number; points: number } {
  let hours = 0;
  let points = 0;
  for (const r of rows) {
    if (r.transferBlock) continue;
    const p = scale[String(r.grade).toUpperCase()];
    if (p === undefined) continue;
    hours += r.credits;
    points += p * r.credits;
  }
  return { hours, points };
}

const one = (n: number): string => (Number.isInteger(n * 10) ? n.toFixed(1) : String(+n.toFixed(3)));

/** Every printed total the rows read do not add up to. `rows` is aligned
 * with the reader's rows (a line's `rows` are indices into it); a row with
 * no term or credits yet is `undefined` and counts as unreadable. */
export function checkTotals(aligned: readonly (CheckedRow | undefined)[], totals: readonly PrintedTotals[]): TotalsMismatch[] {
  const out: TotalsMismatch[] = [];
  const rows = aligned.filter((r): r is CheckedRow => r !== undefined);
  for (const t of totals) {
    // A row whose grade is still unread (a mark the student has to choose a
    // letter for) cannot be judged: no check for a scope that holds one.
    // The rows each line covers: the level-matched set first, every row of the scope second.
    const inScope = (r: CheckedRow): boolean =>
      t.scope === 'overall' ? true : t.term === undefined ? false : t.scope === 'term' ? compareTerm(r.term, t.term) === 0 && !r.transferBlock : compareTerm(r.term, t.term) <= 0 && !r.transferBlock;
    const scoped =
      t.rows !== undefined
        ? [...t.rows.map((i) => aligned[i] ?? { term: t.term!, credits: 0, grade: '' }), ...rows.filter((r) => r.typed && t.term !== undefined && compareTerm(r.term, t.term) === 0)]
        : rows.filter(inScope);
    // Courses still in progress: a term's own line counts them differently
    // from registrar to registrar, so that term is not checked; a cumulative
    // or overall line leaves them out, and so does the check.
    const inProgress = (r: CheckedRow): boolean => /^(IP|NR)$/i.test(String(r.grade)) && !r.transferBlock;
    if (t.scope === 'term' && scoped.some(inProgress)) continue;
    const all = scoped.filter((r) => !inProgress(r));
    const ofLevel = t.level === undefined ? all : all.filter((r) => r.level === undefined || r.level === t.level);
    const ofTermLevel = t.level === undefined ? all : all.filter((r) => (r.termLevel ?? r.level) === undefined || (r.termLevel ?? r.level) === t.level);
    if (all.some((r) => String(r.grade ?? '') === '')) continue;
    const where = t.scope === 'overall' ? `The transcript's ${t.level ? `${t.level} ` : ''}totals print` : t.scope === 'cumulative' ? `${termLabel(t.term!)}'s cumulative line prints` : `${termLabel(t.term!)} prints`;
    if (t.earned !== undefined) {
      const sums = [ofLevel, ofTermLevel, all].map((set) => set.reduce((n, r) => n + earnedBy(r), 0));
      if (!sums.some((s) => Math.abs(s - t.earned!) < 0.01)) {
        out.push({ scope: t.scope, term: t.term, level: t.level, kind: 'earned', printed: t.earned, read: sums[0]!, message: `${where} ${one(t.earned)} earned hours; the rows read add to ${one(sums[0]!)} — a row may be missing or misread.` });
      }
    }
    if (t.gpa !== undefined && t.gpaHours !== undefined && t.gpaHours > 0) {
      const options = [ofLevel, ofTermLevel, all].flatMap((set) => SCALES.map((scale) => gpaOf(set, scale))).filter((g) => g.hours > 0);
      const gpas = options.map((g) => g.points / g.hours);
      if (gpas.length > 0 && !gpas.some((g) => Math.abs(g - t.gpa!) <= 0.01)) {
        out.push({ scope: t.scope, term: t.term, level: t.level, kind: 'gpa', printed: t.gpa, read: gpas[0]!, message: `${where} a ${t.gpa.toFixed(2)} GPA; the grades read give ${gpas[0]!.toFixed(2)} — a grade may be misread.` });
      }
    }
  }
  return out;
}

/** The terms whose rows a mismatch puts in doubt: the term of a term line;
 * every term up to it for a cumulative line; none for the whole record (the
 * preview then says so once, above the rows). */
export function doubtedTerms(mismatches: readonly TotalsMismatch[]): Term[] {
  return mismatches.filter((m) => m.scope === 'term' && m.term !== undefined).map((m) => m.term!);
}
