// The scorer for a Notre Dame transcript read by src/transcript/parse.ts
// against its pinned expectation (DGS 2026-10-11, item 12: "measure the Notre
// Dame import"). The rows go through the same row scorer as the other
// corpora (scripts/dev/score.mts: alignment by course id and year, cells for
// title, credits, grade, term and the UG/GR level); a transfer-block row
// carries its institution in the title cell, so a block row read as a
// program course is a cell error, not a silent pass. On top, the fields only
// a Notre Dame transcript has, each scored when the expectation lists it:
// isNotreDame, the cumulative GPA the §2.2 check uses and each level's, the
// entry term the import proposes, and the degrees awarded.
//
// `exact` = every listed field right AND every row right, in order — the
// corpus test's own pass criterion (tests/nd-corpus.test.ts).
import type { ParsedCourse, ParsedTranscript } from '../../src/transcript/parse.ts';
import type { ExternalCourseCandidate } from '../../src/transcript/external.ts';
import { rowOf } from '../../tests/helpers/row-of.ts';
import { scoreDocument, type FieldScore, type Score } from './score.mts';

export interface ExpectedNdDocument {
  isNotreDame?: boolean;
  /** Rows in ndRowOf form, in the order the parser must give them. */
  courses: string[];
  cumulativeGpa?: number | null;
  gpaGraduate?: number | null;
  gpaUndergraduate?: number | null;
  /** "fall 2024" — the entry term the import proposes; null = none. */
  entryTerm?: string | null;
  /** "masters 2026-05-15 Master of Science", in reading order. */
  degrees?: string[];
}

export const ND_FIELDS = ['isNotreDame', 'cumulativeGpa', 'gpaGraduate', 'gpaUndergraduate', 'entryTerm', 'degrees'] as const;
export type NdField = (typeof ND_FIELDS)[number];

/** A Notre Dame row in the corpora's one-line form; a transfer-block row's
 * institution rides in its title cell. */
export function ndRowOf(c: ParsedCourse): string {
  const title = c.origin === 'transfer' ? `${c.title ?? ''} [transfer: ${c.institution ?? '?'}]` : c.title;
  return rowOf({ courseId: c.courseId, title, credits: c.credits, grade: c.grade, season: c.term.season, year: c.term.year, level: c.level } as unknown as ExternalCourseCandidate);
}

/** The fields a Notre Dame transcript adds, as strings for comparison. */
export function ndFieldsOf(p: ParsedTranscript): Record<NdField, string | null> {
  const gpa = (n: number | undefined): string | null => (n === undefined ? null : n.toFixed(2));
  return {
    isNotreDame: String(p.isNotreDame),
    cumulativeGpa: gpa(p.cumulativeGpa),
    gpaGraduate: gpa(p.cumulativeGpaByLevel?.graduate),
    gpaUndergraduate: gpa(p.cumulativeGpaByLevel?.undergraduate),
    entryTerm: p.entryTerm ? `${p.entryTerm.term.season} ${p.entryTerm.term.year}` : null,
    degrees: p.degreesAwarded.length > 0 ? p.degreesAwarded.map((d) => `${d.level} ${d.date ?? '?'} ${d.name}`).join(' / ') : null,
  };
}

function wantOf(e: ExpectedNdDocument, f: NdField): string | null {
  const v = e[f];
  if (v === undefined || v === null) return null;
  if (f === 'degrees') return (v as string[]).length > 0 ? (v as string[]).join(' / ') : null;
  if (typeof v === 'number') return v.toFixed(2);
  return String(v);
}

export type NdScore = Score & { nd: Partial<Record<NdField, FieldScore>> };

export function scoreNdDocument(parsed: ParsedTranscript, expected: ExpectedNdDocument): NdScore {
  // Rows through the shared scorer, as strings.
  const got = parsed.courses.map(ndRowOf);
  const score = scoreRows(got, expected.courses);
  const got_ = ndFieldsOf(parsed);
  const nd: Partial<Record<NdField, FieldScore>> = {};
  for (const f of ND_FIELDS) {
    if (!(f in expected)) continue;
    const want = wantOf(expected, f);
    const ok = got_[f] === want;
    nd[f] = { got: got_[f], want, ok };
    if (!ok) score.diffs.unshift(`${f}: got ${JSON.stringify(got_[f])}, want ${JSON.stringify(want)}`);
  }
  return { ...score, nd, exact: score.exact && Object.values(nd).every((x) => x.ok) };
}

/** The row half of scoreDocument, on rows already printed as strings. */
function scoreRows(got: string[], want: string[]): Score {
  // scoreDocument prints candidates with rowOf; a candidate whose fields
  // reproduce the string exactly is built by splitting it back.
  const asCandidate = (row: string): ExternalCourseCandidate => {
    const parts = row.split(' | ');
    const level = parts.length >= 6 && /^(undergraduate|graduate)$/.test(parts[parts.length - 1]!) ? parts.pop() : undefined;
    const term = parts.pop() ?? ' ';
    const grade = parts.pop() ?? '?';
    const credits = parts.pop() ?? '?';
    const courseId = parts.shift() ?? '';
    const [season, year] = term.split(' ');
    return { courseId, title: parts.join(' | '), credits: credits === '?' ? undefined : Number(credits), grade: grade === '?' ? undefined : grade, season: season || undefined, year: year ? Number(year) : undefined, level } as unknown as ExternalCourseCandidate;
  };
  return scoreDocument({ courses: got.map(asCandidate) }, { courses: want });
}
