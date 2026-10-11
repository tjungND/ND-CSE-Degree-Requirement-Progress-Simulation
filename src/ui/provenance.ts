// Where each course on the record came from (DGS 2026-10-11, item 6: "make
// the MSCSE-along-the-way request safe to act on"). The Grad Admin processes
// what the request lists, so it says which rows the app read from a
// transcript, which the student typed, and which the student changed after
// the app read them — and that milestone dates and approval ticks are the
// student's own statements. In the student's voice, as the emails are.
//
// A row saved before these labels existed (2026-10-11) carries no source; it
// says so rather than guessing — except a Notre Dame import, which has always
// been marked (`fromNdTranscript`).
import type { CourseEntry, ImportedField, Student } from '../engine/types.ts';

const SLOT_WORD = { bachelors: 'bachelor’s', masters: 'master’s', phd: 'Ph.D.' } as const;
const FIELD_WORD: Record<ImportedField, string> = { course: 'course number', title: 'title', credits: 'credits', term: 'term', grade: 'grade', level: 'level' };

export type SourceKind = 'nd' | 'transcript' | 'changed' | 'typed' | 'example' | 'unrecorded';

/** The transcript a row was imported from, in words: "my Notre Dame transcript". */
function transcriptWords(c: CourseEntry): string {
  const t = c.imported?.transcript;
  return t === undefined || t === 'nd' ? 'my Notre Dame transcript' : `my ${SLOT_WORD[t]} transcript`;
}

/** One course's source: "imported from my Notre Dame transcript", "typed by
 * me", "imported from my master’s transcript, then changed by me (grade)". */
export function sourceOf(c: CourseEntry): { kind: SourceKind; text: string } {
  if (c.fromExample) return { kind: 'example', text: 'from the example student' };
  if (c.typedByStudent) return { kind: 'typed', text: 'typed by me' };
  if (c.imported !== undefined || c.fromNdTranscript) {
    const from = `imported from ${transcriptWords(c)}`;
    if (c.changedOnImport && c.changedOnImport.length > 0) return { kind: 'changed', text: `${from}, then changed by me (${c.changedOnImport.map((f) => FIELD_WORD[f]).join(', ')})` };
    return { kind: c.fromNdTranscript || c.imported?.transcript === 'nd' ? 'nd' : 'transcript', text: from };
  }
  return { kind: 'unrecorded', text: 'source not recorded (entered before October 11, 2026)' };
}

/** The course in the student's record with this id (and, for a transfer,
 * this university and term when given) — the row a request line names. */
export function sourceFor(student: Student, courseId: string, where?: { institution?: string; term?: { season: string; year: number } }): string {
  const c =
    student.courses.find((x) => x.courseId === courseId && (where?.institution === undefined || x.institution === where.institution) && (where?.term === undefined || (x.term.season === where.term.season && x.term.year === where.term.year))) ??
    student.courses.find((x) => x.courseId === courseId);
  return c ? sourceOf(c).text : '';
}

/** The emails' one-line account of the whole record: "My courses: 14
 * imported from my Notre Dame transcript; 4 imported from my master’s
 * transcript and 1 more then changed by me; 2 typed by me. The milestone
 * dates and the approvals I ticked are my own entries." Undefined for an
 * empty record. */
export function sourcesLine(student: Student): string | undefined {
  if (student.courses.length === 0 && !hasOwnStatements(student)) return undefined;
  const counts = new Map<string, number>();
  const bump = (k: string): void => void counts.set(k, (counts.get(k) ?? 0) + 1);
  for (const c of student.courses) {
    const s = sourceOf(c);
    if (s.kind === 'changed') bump(`imported from ${transcriptWords(c)}, then changed by me`);
    else if (s.kind === 'nd' || s.kind === 'transcript') bump(s.text);
    else if (s.kind === 'typed') bump('typed by me');
    else if (s.kind === 'example') bump('from the example student');
    else bump('with no recorded source (entered before October 11, 2026)');
  }
  const parts = [...counts].map(([what, n]) => `${n} ${what}`);
  const courses = parts.length > 0 ? `My courses: ${parts.join('; ')}.` : '';
  const own = hasOwnStatements(student) ? 'The milestone dates and the approvals I ticked are my own entries.' : '';
  return [courses, own].filter(Boolean).join(' ');
}

/** Any milestone date, or any approval the student ticked. */
function hasOwnStatements(student: Student): boolean {
  const m = student.milestones as Record<string, unknown>;
  const dated = Object.entries(m).some(([k, v]) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && k !== 'advisorName' && k !== 'advisorName2');
  return dated || student.courses.some((c) => c.dgsApproved === true) || student.attestations.transferRecorded === true;
}
