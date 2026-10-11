// Pure assembly: three CSV texts → a validated Rules object. Used by the live
// loader, the snapshot fallback, and the tests — one parse path for all three.
import type { Term } from '../engine/types.ts';
import { compareTerm, termIndex } from '../engine/term.ts';
import { makeParameters } from './params.ts';
import { parseCategoriesTab, parseCoursesTab, parseExternalTab, parseParametersTab, parseUniversitiesTab } from './parse.ts';
import type { ExternalRule, RuleCourse, Rules, RulesDate, SheetIssue, UniversityRow } from './types.ts';
import { validateCourses } from './validate.ts';

export interface CsvTexts {
  courses: string;
  parameters: string;
  categories: string;
  /** The ExternalCourses tab — optional: absent until the DGS creates and
   * publishes it (the app then treats every external course as unreviewed). */
  external?: string;
  /** The Universities tab (DGS 2026-10-10) — optional: absent in a sheet or a
   * saved copy from before it existed, when the old ExternalCourses
   * `credit_system` cells are read instead. */
  universities?: string;
}

/** Each university's credit system (DGS 2026-10-10). With a Universities tab,
 * that tab alone decides, and any value still in the old ExternalCourses
 * `credit_system` column is reported as no longer read (naming any university
 * where it disagrees). Without the tab — a sheet or saved copy from before the
 * move — the old cells are read as before: the first row of a university that
 * names a system sets it for all its courses. */
export function universityCreditSystems(
  universities: readonly UniversityRow[] | undefined,
  external: readonly ExternalRule[],
  issues: SheetIssue[],
): Map<string, 'quarter' | 'semester' | 'trimester'> {
  const out = new Map<string, 'quarter' | 'semester' | 'trimester'>();
  if (universities === undefined) {
    for (const r of external) if (r.creditSystem !== undefined && !out.has(r.universityKey)) out.set(r.universityKey, r.creditSystem);
    return out;
  }
  for (const u of universities) if (u.creditSystem !== undefined) out.set(u.universityKey, u.creditSystem);
  const leftover = external.filter((r) => r.creditSystem !== undefined);
  if (leftover.length > 0) {
    const disagree = [...new Set(leftover.filter((r) => out.get(r.universityKey) !== r.creditSystem).map((r) => r.university))];
    issues.push({
      severity: 'warning',
      tab: 'ExternalCourses',
      column: 'credit_system',
      message:
        `The ExternalCourses credit_system column is no longer read (DGS 2026-10-10): each university's credit system is set once in the Universities tab. ` +
        `${leftover.length} row${leftover.length === 1 ? '' : 's'} still ${leftover.length === 1 ? 'has' : 'have'} a value there — delete the column.` +
        (disagree.length > 0
          ? ` For ${disagree.join('; ')} the column says something the Universities tab does not — the Universities tab is what counts; check it.`
          : ''),
    });
  }
  return out;
}

export function rulesFromCsvTexts(
  texts: CsvTexts,
  meta: { source: 'live' | 'snapshot'; syncedAt: string; rulesDate?: RulesDate },
): Rules {
  const issues: SheetIssue[] = [];
  const { coreAreas, categoryGroups } = parseCategoriesTab(texts.categories, issues);
  const external = texts.external !== undefined ? parseExternalTab(texts.external, coreAreas, issues) : [];
  const universitiesTab = texts.universities !== undefined ? parseUniversitiesTab(texts.universities, issues) : undefined;
  const creditSystems = universityCreditSystems(universitiesTab, external, issues);
  const rawCourses = parseCoursesTab(texts.courses, issues);
  const courses = validateCourses(rawCourses, coreAreas, categoryGroups, issues);
  const parameters = makeParameters(parseParametersTab(texts.parameters, issues), issues);
  // (`current_semester` was validated here until 2026-09-14; the schedule is
  // now dated per row by the Courses tab's `last_offered`.)

  const byId = new Map<string, RuleCourse[]>();
  for (const c of courses) {
    const list = byId.get(c.courseId) ?? [];
    list.push(c);
    byId.set(c.courseId, list);
  }
  for (const list of byId.values()) {
    list.sort((a, b) => {
      const ai = a.effectiveTerm ? termIndex(a.effectiveTerm) : -Infinity;
      const bi = b.effectiveTerm ? termIndex(b.effectiveTerm) : -Infinity;
      return ai - bi;
    });
  }

  return {
    courses: byId,
    parameters,
    coreAreas,
    categoryGroups,
    external,
    universities: universitiesTab ?? [],
    universityCreditSystems: creditSystems,
    issues,
    source: meta.source,
    syncedAt: meta.syncedAt,
    rulesDate: meta.rulesDate,
  };
}

/** "cse60641", "CSE60641", " cse  60641 " → "CSE 60641": the shape the Courses
 * tab uses. Every lookup and every department test goes through this, so a
 * hand-typed or OCR-read id reaches the same row as the printed one (DGS
 * 2026-09-11: "let app ignore the case and space"). Ids that are not a
 * subject plus a number are only upper-cased and space-collapsed. */
/** A subject printed one letter at a time — "C S 50300", "C S E 60641" — is
 * read as "CS 50300", "CSE 60641" (DGS 2026-09-20: remove the spaces before
 * recognising the code). Only a run of single letters directly before the
 * course number is joined, so titles and prose are untouched; this also
 * turns the University of Washington's "E E 235" into "EE 235", which the
 * ExternalCourses lookup already treated as the same id. */
export function joinSpacedSubject(text: string): string {
  return text.replace(/^((?:[A-Za-z] ){1,5}[A-Za-z])(?=\s*-?\s*\d)/, (m) => m.replace(/ /g, ''));
}

// Remembered per id (efficiency, 2026-10-07): one render asks for the same
// few dozen ids several times per course (rule lookup, department, same-term
// check, the incomplete-id test) across two or three classify runs. A modest
// gain — classify of the Ph.D. example 15 → 7 µs; about 0.1–0.25 ms per render
// for a 40–86-course record. The answer depends on the id alone — if it ever
// takes a second input, the key must include it, or drop this cache. Capped so
// text typed into a box cannot grow it without limit.
const canonicalIds = new Map<string, string>();
export function canonicalCourseId(courseId: string): string {
  let id = canonicalIds.get(courseId);
  if (id === undefined) {
    if (canonicalIds.size >= 2000) canonicalIds.clear();
    const flat = courseId.toUpperCase().replace(/\s+/g, ' ').trim();
    const m = /^([A-Z]{2,6})\s*(\d[\dX]{3,5})$/i.exec(flat.replace(/\s+/g, ''));
    id = m ? `${m[1]} ${m[2]}` : flat;
    canonicalIds.set(courseId, id);
  }
  return id;
}

/** A course number with placeholder letters — "CSE 6xxxx", "CSE 60xxx" — is a
 * number the student has not finished typing, not a course (2026-09-11). */
export function isIncompleteCourseId(courseId: string): boolean {
  const id = canonicalCourseId(courseId);
  return /^[A-Z]{2,6}\s+\d*X+\d*$/i.test(id) || /\d[X]+|[X]+\d/i.test(id.split(' ')[1] ?? '');
}

/** Which rules row governs a course taken in `term`?
 * Latest row with rules_effective_term ≤ the course's term (rule changes grandfather
 * past courses); if none matches — every live row currently says Fall 2026 —
 * the EARLIEST row applies retroactively, so students' older courses still
 * resolve. Rows without an rules_effective_term are always in effect. */
export function resolveRuleRow(
  rules: Rules,
  courseId: string,
  term: Term | undefined,
): RuleCourse | undefined {
  const list = rules.courses.get(canonicalCourseId(courseId));
  if (!list || list.length === 0) return undefined;
  if (!term) return list[list.length - 1];
  let best: RuleCourse | undefined;
  for (const row of list) {
    if (!row.effectiveTerm || compareTerm(row.effectiveTerm, term) <= 0) best = row;
  }
  return best ?? list[0]; // none in effect yet → earliest row, retroactively
}
