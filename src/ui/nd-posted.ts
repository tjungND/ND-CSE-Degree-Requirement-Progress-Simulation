// One course, one row, whichever transcript arrives first (policy review round
// 3, P3-import-1 (c) and its condition 2; DGS 2026-10-05).
//
// The Notre Dame transcript's "Transfer credit accepted" block and the other
// university's own transcript can both list a course. The row the student
// already has is kept, and the Notre Dame record's acceptance rides on it as
// `ndPosted` — so Option 1 counts the course once, and the approval is never
// lost to the duplicate check. Removing an import takes back exactly what it
// brought: the Notre Dame import's marks, or the other transcript's rows (a
// row carrying a mark turns back into the Notre Dame record's block row).
// Pure functions over the record, so the rules have tests of their own.
import { acceptanceRank, preferredTwin, sameTransferCourse } from '../engine/nd-posting.ts';
import { compareTerm, normalizeEntryTerm } from '../engine/term.ts';
import type { CourseEntry, NdPosting, Student, Term } from '../engine/types.ts';
import type { ParsedCourse } from '../transcript/parse.ts';

/** A transfer-block row of the Notre Dame transcript, as either import sees it. */
type BlockRow = { courseId: string; institution?: string; origin: string; credits: number; title?: string };

const titleKey = (t: string | undefined): string => (t ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Each transfer-block row paired with a row of another transcript — the same
 * course from the same university, ONE row per posting: two postings of one
 * course number (two topics courses under it) go to two rows, and a posting
 * with no row left keeps its block row (review of the fixes, 2026-10-29: the
 * second posting was lost, or left a block row beside its course). A row
 * already carrying a posting is taken.
 *
 * Which row: when a course has at least as many postings as rows, every row
 * is one of them, so each posting takes the row with its own title (a
 * topics course's); when it has more rows than postings, the extra rows are
 * retakes, and a posting takes an attempt the Graduate School could have
 * accepted (#22) — the title, then the credits, then the latest only choose
 * among those. Title matches go first, over all the postings, so a posting
 * whose own row is missing never takes another's (a final check of the
 * fixes, 2026-10-29). */
export function pairBlockRows<B extends BlockRow>(rows: readonly CourseEntry[], blocks: readonly B[]): Map<B, CourseEntry> {
  const out = new Map<B, CourseEntry>();
  const taken = new Set<CourseEntry>();
  const transferBlocks = blocks.filter((b) => b.origin === 'transfer');
  const probe = (b: B): CourseEntry => ({ courseId: b.courseId, institution: b.institution, origin: 'transfer' }) as CourseEntry;
  const rowsOf = (b: B): CourseEntry[] => rows.filter((c) => c.fromNdTranscript !== true && c.ndPosted === undefined && sameTransferCourse(c, probe(b)));
  // Decided once per course, before any row is taken.
  const everyRowPosted = new Map<B, boolean>(transferBlocks.map((b) => [b, transferBlocks.filter((x) => sameTransferCourse(probe(x), probe(b))).length >= rowsOf(b).length]));
  const sameTitle = (c: CourseEntry, b: B): boolean => titleKey(c.title) !== '' && titleKey(c.title) === titleKey(b.title);
  const take = (b: B, twin: CourseEntry | undefined): void => {
    if (twin === undefined) return;
    out.set(b, twin);
    taken.add(twin);
  };
  // 1. Every row posted: each posting to the row with its own title.
  for (const b of transferBlocks) if (everyRowPosted.get(b)) take(b, preferredTwin(rowsOf(b).filter((c) => !taken.has(c) && sameTitle(c, b))));
  // 2. The rest: an acceptable attempt first when there are retakes, then the
  // same title, the same credits, the latest.
  for (const b of transferBlocks) {
    if (out.has(b)) continue;
    const free = rowsOf(b).filter((c) => !taken.has(c));
    if (free.length === 0) continue;
    const pool = everyRowPosted.get(b) ? free : free.filter((c) => acceptanceRank(c) === Math.min(...free.map(acceptanceRank)));
    const byTitle = pool.filter((c) => sameTitle(c, b));
    const byCredits = pool.filter((c) => Math.abs(c.credits - b.credits) < 1e-9);
    take(b, preferredTwin(byTitle.length > 0 ? byTitle : byCredits.length > 0 ? byCredits : pool));
  }
  return out;
}

/** The acceptance a Notre Dame transfer-block row records. */
export function postingOf(c: Pick<ParsedCourse, 'term' | 'credits' | 'level' | 'institution'>): NdPosting {
  return {
    term: { season: c.term.season, year: c.term.year },
    credits: c.credits,
    ...(c.level !== undefined ? { level: c.level } : {}),
    ...(c.institution !== undefined ? { institution: c.institution } : {}),
  };
}

/** The row, other than one the Notre Dame import added, that a transfer-block
 * row duplicates: the same course from the same university, in any term. */
export function twinOfBlockRow(student: Pick<Student, 'courses'>, block: Pick<ParsedCourse, 'courseId' | 'institution' | 'origin'>): CourseEntry | undefined {
  if (block.origin !== 'transfer') return undefined;
  const probe = { courseId: block.courseId, institution: block.institution, origin: 'transfer' as const } as CourseEntry;
  // The attempt the Graduate School could have accepted, when the other
  // transcript lists the course twice (credit-transfer review 2026-10-28, #22).
  return preferredTwin(student.courses.filter((c) => c.fromNdTranscript !== true && sameTransferCourse(c, probe)));
}

/** The Notre Dame record's acceptance put on the other transcript's row of the
 * course. A tick given before the posting answered the course's case-by-case
 * verdict, not the posting's own question — posted before this program, or at
 * a level the record does not show — so it goes, and the posting asks its
 * question (round 5, item 29 (b): one tick never answers two questions;
 * credit-transfer review 2026-10-28, #29). Once posted, the verdict no longer
 * matters: posted credit counts as posted. */
export function markPosted(twin: CourseEntry, posting: NdPosting, entryTerm: Term): void {
  twin.ndPosted = posting;
  const held = posting.level === undefined || compareTerm(posting.term, normalizeEntryTerm(entryTerm).term) < 0;
  if (held && twin.dgsApproved === true) delete twin.dgsApproved;
}

/** The Notre Dame import's own block row that a course from another
 * transcript duplicates — the row a new import of that transcript replaces. */
export function blockRowFor(student: Pick<Student, 'courses'>, row: CourseEntry): CourseEntry | undefined {
  return student.courses.find((c) => c.fromNdTranscript === true && c.origin === 'transfer' && sameTransferCourse(c, row));
}

/** A row from another transcript arriving while the Notre Dame import's block
 * row for the same course is on the record: the new row takes the block row's
 * acceptance, and the block row goes. Returns the block row taken out. */
export function absorbBlockRow(student: Student, row: CourseEntry, block: CourseEntry | undefined = blockRowFor(student, row)): CourseEntry | undefined {
  if (!block) return undefined;
  row.ndPosted = block.ndPosted ?? postingOf({ term: block.term, credits: block.credits, level: block.registeredLevel, institution: block.institution });
  student.courses = student.courses.filter((c) => c !== block);
  return block;
}

/** A row leaving with its own transcript's import: if it carries the Notre
 * Dame record's acceptance, that acceptance stays on the record as the block
 * row the Notre Dame import would have added. */
export function blockRowBack(row: CourseEntry): CourseEntry | undefined {
  const p = row.ndPosted;
  if (p === undefined) return undefined;
  return {
    courseId: row.courseId,
    ...(row.title !== undefined ? { title: row.title } : {}),
    credits: p.credits,
    term: { season: p.term.season, year: p.term.year },
    grade: 'IP',
    origin: 'transfer',
    institution: p.institution ?? row.institution,
    ...(p.level !== undefined ? { registeredLevel: p.level } : {}),
    ...(p.level === 'undergraduate' ? { degreeLevel: 'bachelors' as const } : {}),
    ndPosted: p,
    fromNdTranscript: true,
  };
}

/** The Notre Dame import removed: the marks it put on rows from other
 * transcripts go too. Returns them by row index, for Undo. */
export function stripNdPostings(student: Student): { index: number; posting: NdPosting }[] {
  const stripped: { index: number; posting: NdPosting }[] = [];
  student.courses.forEach((c, index) => {
    if (c.fromNdTranscript !== true && c.ndPosted !== undefined) {
      stripped.push({ index, posting: c.ndPosted });
      delete c.ndPosted;
    }
  });
  return stripped;
}
