// Transfer credit the student's Notre Dame graduate record already shows as
// accepted (policy review round 3, P3-import-1; DGS 2026-10-05: "I want to
// apply (a), (b), and (c), with Option 1", with the three conditions that make
// "only approved credit" true).
//
// The Notre Dame transcript lists such credit in its "Transfer credit
// accepted" block. Graduate credit appears there only after the Graduate
// School has approved it and received the official transcript (Academic Code
// §4.6 criterion 5; DGS Handbook §3.14: "An official transcript from the
// institution where the course/s were taken is required before credits will be
// added to a student's record"). The block dates each row by the Notre Dame
// term the credit was recorded, not the term it was taken.
//
// Shared by the engine (which counts the credit) and the two transcript
// imports (which keep one row per course, whichever transcript came first).
import { isNotreDameInstitution, normalizeCourseId, normalizeUniversity } from '../data/external.ts';
import { meetsGradeFloor } from './grades.ts';
import { compareTerm } from './term.ts';
import type { CourseEntry, NdPosting } from './types.ts';

/** The acceptance a transfer row carries: its own `ndPosted`, or — for a row
 * the Notre Dame import added before the mark existed (2026-10-05) — the row
 * itself, read as posted in its own term at its own hours, level unknown. A
 * Notre Dame course filed as earlier coursework (institution Notre Dame) is
 * not transfer credit from another university and carries none. */
export function ndPostingOf(c: CourseEntry): NdPosting | undefined {
  if (c.origin !== 'transfer') return undefined;
  if (c.ndPosted !== undefined) return c.ndPosted;
  if (c.fromNdTranscript === true && !isNotreDameInstitution(c.institution)) {
    return { term: c.term, credits: c.credits, ...(c.registeredLevel !== undefined ? { level: c.registeredLevel } : {}) };
  }
  return undefined;
}

/** One school, however the two transcripts spell it: the same name once
 * folded, or one name inside the other ("Purdue University" and "Purdue
 * University West Lafayette"), word for word. */
export function sameUniversity(a: string | undefined, b: string | undefined): boolean {
  if (a === undefined || b === undefined) return false;
  const x = normalizeUniversity(a);
  const y = normalizeUniversity(b);
  if (x === '' || y === '') return false;
  if (x === y) return true;
  const within = (short: string, long: string) => (` ${long} `).includes(` ${short} `);
  return within(x, y) || within(y, x);
}

/** Two transfer rows that are one course: the same course number from the same
 * other university, whatever term each transcript dates it (P3-import-1 (c)). */
export function sameTransferCourse(a: CourseEntry, b: CourseEntry): boolean {
  return (
    a.origin === 'transfer' &&
    b.origin === 'transfer' &&
    !isNotreDameInstitution(a.institution) &&
    !isNotreDameInstitution(b.institution) &&
    // An empty id names no course (a code-less import row is never saved
    // without one — CC15, DGS 2026-10-09 — but two blanks are not a match).
    normalizeCourseId(a.courseId) !== '' &&
    normalizeCourseId(a.courseId) === normalizeCourseId(b.courseId) &&
    sameUniversity(a.institution, b.institution)
  );
}

/** A record holding BOTH rows of one course — the Notre Dame block's and the
 * other university's — counts it once (condition 2): the other university's
 * row carries the acceptance, and the block row counts nothing. The imports
 * keep the two as one row; this covers records saved before they did, and a
 * course typed by hand. Returns the block rows so paired, each with its twin. */
export function pairedBlockRows(courses: readonly CourseEntry[]): Map<CourseEntry, CourseEntry> {
  const paired = new Map<CourseEntry, CourseEntry>();
  const taken = new Set<CourseEntry>();
  for (const block of courses) {
    if (block.origin !== 'transfer' || block.fromNdTranscript !== true || ndPostingOf(block) === undefined) continue;
    const twin = preferredTwin(courses.filter((o) => o !== block && !taken.has(o) && o.fromNdTranscript !== true && o.ndPosted === undefined && sameTransferCourse(o, block)));
    if (twin) {
      paired.set(block, twin);
      taken.add(twin);
    }
  }
  return paired;
}

/** The row of a course the other university lists more than once (a retake,
 * two sections) that the Notre Dame record's acceptance belongs on: the
 * attempt the Graduate School could have accepted — a letter grade of B or
 * better (§5.2 criterion 4), then an S — and of those the latest. The first
 * row in the record used to take it, so a B- attempt carried the posting, the
 * A retake counted as well, and the totals changed with row order
 * (credit-transfer review 2026-10-28, #22). */
export function preferredTwin(rows: readonly CourseEntry[]): CourseEntry | undefined {
  const rank = (c: CourseEntry): number => (c.grade !== 'S' && meetsGradeFloor(c.grade, 'B') ? 0 : c.grade === 'S' ? 1 : 2);
  return [...rows].sort((a, b) => rank(a) - rank(b) || compareTerm(b.term, a.term))[0];
}
