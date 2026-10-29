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
import { preferredTwin, sameTransferCourse } from '../engine/nd-posting.ts';
import type { CourseEntry, NdPosting, Student } from '../engine/types.ts';
import type { ParsedCourse } from '../transcript/parse.ts';

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

/** The Notre Dame import's own block row that a course from another
 * transcript duplicates — the row a new import of that transcript replaces. */
export function blockRowFor(student: Pick<Student, 'courses'>, row: CourseEntry): CourseEntry | undefined {
  return student.courses.find((c) => c.fromNdTranscript === true && c.origin === 'transfer' && sameTransferCourse(c, row));
}

/** A row from another transcript arriving while the Notre Dame import's block
 * row for the same course is on the record: the new row takes the block row's
 * acceptance, and the block row goes. Returns the block row taken out. */
export function absorbBlockRow(student: Student, row: CourseEntry): CourseEntry | undefined {
  const block = blockRowFor(student, row);
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
