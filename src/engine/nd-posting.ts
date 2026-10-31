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

/** The schools whose bare name means the flagship campus (DGS 2026-09-12:
 * Purdue, Michigan and Washington are deliberately not systems), and that
 * campus's place, as a transcript may add it. Indiana University and the
 * University of Massachusetts are deliberately NOT here (DGS 2026-10-31,
 * question 11 of the credit-transfer review: "IU has multiple campuses (South
 * Bend, Indianapolis, Bloomington, etc.). U of Massachusetts also has multiple
 * campuses (Lowell, Amherst, Dartmouth, Boston, etc.)"): their bare name and a
 * campus's name stay two schools, and the DGS sees the courses. */
const FLAGSHIP_PLACES: Record<string, string> = {
  'purdue university': 'west lafayette',
  'university of michigan': 'ann arbor',
  'university of washington': 'seattle',
};

/** One school, for counting a student's earlier programs: the same name once
 * folded, or a flagship's bare name and that name with its campus's place
 * ("Purdue University" and "Purdue University West Lafayette"). Stricter than
 * sameUniversity, which pairs a block row with its twin only by course
 * number as well: one name inside the other is also "Indiana University" and
 * "Indiana University of Pennsylvania", or "Purdue University" and "Purdue
 * University Fort Wayne" — two schools, which the two-programs hold must see
 * (review of the fix, 2026-10-29; DECISIONS 2026-10-08). */
export function oneSchool(a: string | undefined, b: string | undefined): boolean {
  // Record words a transcript's header adds, before or after the name, are
  // never a campus: "GEORGIA INSTITUTE OF TECHNOLOGY OFFICIAL DOCUMENT
  // INFORMATION" is Georgia Tech's name on the sheet (CLAUDE.md), and was
  // counted as a second school (review of the fixes, 2026-10-29) — so they go
  // first, and a flagship's campus is read on what is left (a final check of
  // the fixes, the same day).
  const strip = (name: string): string => {
    const words = normalizeUniversity(name).split(' ').filter((w) => w !== '');
    const filler = (w: string): boolean => RECORD_WORDS.has(w) || w === 'of' || w === 'the' || w === 'and';
    let start = 0;
    let end = words.length;
    while (end > start && filler(words[end - 1]!)) end -= 1;
    while (start < end && filler(words[start]!)) start += 1;
    const kept = words.slice(start, end);
    // A name of filler words alone is not stripped to nothing.
    return kept.length > 0 && words.slice(0, start).concat(words.slice(end)).some((w) => RECORD_WORDS.has(w)) ? kept.join(' ') : words.join(' ');
  };
  const x = strip(a ?? '');
  const y = strip(b ?? '');
  if (x === '' || y === '') return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  if (!long.startsWith(`${short} `)) return false;
  return FLAGSHIP_PLACES[short] === long.slice(short.length + 1).replace(/^(?:at|in) /, '');
}

/** Words of a transcript's own header, as the reader meets them beside a
 * school's name (stripRecordWords in src/transcript/external.ts). */
const RECORD_WORDS = new Set(['official', 'unofficial', 'electronic', 'academic', 'student', 'transcript', 'transcripts', 'record', 'records', 'document', 'documents', 'information', 'copy', 'office', 'registrar', 'page']);

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
  return [...rows].sort((a, b) => acceptanceRank(a) - acceptanceRank(b) || compareTerm(b.term, a.term))[0];
}
/** preferredTwin's order: a letter grade of B or better, then an S, then the rest. */
export function acceptanceRank(c: CourseEntry): number {
  return c.grade !== 'S' && meetsGradeFloor(c.grade, 'B') ? 0 : c.grade === 'S' ? 1 : 2;
}
