// "The Graduate School approved my transfer credit and the Grad Admin
// recorded it" (§5.2 criterion 5; policy review 2026-10-03) — which transfers
// the tick covers.
//
// It was one record-level tick, so a transfer decided AFTER it was ticked — a
// case-by-case course the DGS approved later, a course added later — read
// "recorded by the Grad Admin", the §5.2 card turned Met and the Grad Admin
// request never submitted it (credit-transfer review 2026-10-28, #31). Since
// then the tick keeps the transfers it covered: the ones the request asked to
// submit when it was ticked. A file ticked before that carries no list, and
// the tick covers every transfer, as it did.
import { normalizeCourseId, normalizeUniversity } from '../data/external.ts';
import { termIndex } from './term.ts';
import type { CourseEntry, Student } from './types.ts';

/** One transfer course, as the tick's list names it. */
export function transferKey(c: Pick<CourseEntry, 'courseId' | 'institution' | 'term'>): string {
  return `${normalizeCourseId(c.courseId)}|${normalizeUniversity(c.institution ?? '')}|${termIndex(c.term)}`;
}

/** Has the student ticked this transfer as recorded by the Grad Admin? */
export function transferRecordedFor(student: Pick<Student, 'attestations'>, c: Pick<CourseEntry, 'courseId' | 'institution' | 'term'>): boolean {
  if (student.attestations.transferRecorded !== true) return false;
  const covered = student.attestations.transferRecordedCourses;
  return covered === undefined || covered.includes(transferKey(c));
}
