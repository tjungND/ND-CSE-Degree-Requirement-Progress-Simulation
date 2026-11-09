// Which semesters the course-rules page's two schedule cards stand for, and
// what a Courses-tab row's `offered_now` / `offered_next` say about them (DGS
// 2026-09-09; dated per row 2026-09-14; dated by the sheet since 2026-11-08).
//
// The semester the schedule describes comes from the SHEET (DGS 2026-11-08: "I
// want to change how 'current semester' is calculated. Use the 'last_offered'
// column to infer that. The latest semester there is the current semester."):
// the latest fall or spring in the Courses tab's `last_offered` (`sheetSemester`).
// The DGS rolls the schedule over by dating the courses that run in the new
// semester; until then the cards keep naming the semesters the columns were
// written for, so a late update never prints last semester's courses under
// this semester's NAME (the concern the per-row dating of 2026-09-14 answered).
//
// Per row (`rowSchedule`): `offered_now` speaks for that semester only on a row
// dated it — a course running now was last offered now (DGS 2026-09-18), so a
// row dated earlier is a course that ran before, whose `yes` is left over.
// `offered_next` speaks for the semester after it on EVERY row (DGS
// 2026-11-08: Spring 2027 courses not running in Fall 2026 were missing from
// the next-semester card — a course not running now cannot be dated now, and
// the sheet's own semester now dates the column instead).
//
// DOM-free so the rule has a test matrix (tests/schedule-terms.test.ts).
import { semesterSeq } from '../engine/term.ts';
import type { Season, Term } from '../engine/types.ts';

/** Schedules are kept for FALL and SPRING. Summer is not a graduate teaching
 * term here, so the term after a fall is the next spring and vice versa. */
export function afterTeachingTerm(t: Term): Term {
  return t.season === 'fall' ? { season: 'spring', year: t.year + 1 } : { season: 'fall', year: t.year };
}

/** The teaching semester a date belongs to: itself for fall and spring, and
 * during the summer the fall that is coming — which is what a student reads a
 * schedule to plan for. */
export function teachingTermOf(today: Term): Term {
  return today.season === 'summer' ? { season: 'fall' as Season, year: today.year } : today;
}

/** Fall/spring order: negative when `a` comes first. */
function compareTeaching(a: Term, b: Term): number {
  return semesterSeq(a) - semesterSeq(b);
}

/** Same fall or spring. */
export function sameTeachingTerm(a: Term, b: Term): boolean {
  return compareTeaching(teachingTermOf(a), teachingTermOf(b)) === 0;
}

/** The latest `last_offered` a row may carry: the teaching semester after
 * today's. A course cannot last have been offered in a term that has not
 * happened, but the DGS may date next semester's courses before it starts —
 * that is how the schedule is rolled over (DGS 2026-11-08). Anything later is
 * a slip of the keyboard ("Fall 2062"), and one such cell must not carry the
 * whole page to its semester: it is left out, and counted. */
export function latestDatable(today: Term): Term {
  return afterTeachingTerm(teachingTermOf(today));
}

/** The semester the Courses tab's schedule describes (DGS 2026-11-08: "The
 * latest semester there is the current semester."): the latest FALL or
 * SPRING `last_offered` of any row, retired or not, up to `latestDatable`.
 * Summer dates are not schedule semesters (the cards are fall/spring) and are
 * skipped, so dating a summer course does not move the schedule to the fall
 * before its courses are marked. With no fall or spring date at all, the
 * date's own teaching semester (`fromSheet` false). */
export function sheetSemester(rows: Iterable<{ lastOffered?: Term }>, today: Term): { term: Term; fromSheet: boolean } {
  const limit = latestDatable(today);
  let latest: Term | undefined;
  for (const r of rows) {
    const t = r.lastOffered;
    if (t === undefined || t.season === 'summer' || compareTeaching(t, limit) > 0) continue;
    if (latest === undefined || compareTeaching(t, latest) > 0) latest = t;
  }
  return latest === undefined ? { term: teachingTermOf(today), fromSheet: false } : { term: { season: latest.season, year: latest.year }, fromSheet: true };
}

/** How a row's `last_offered` stands to the schedule's semester.
 *   `current` — dated it: `offered_now` speaks for it.
 *   `other`   — dated another semester (an earlier one, or a summer): its
 *               `offered_now` is left over from when it ran, and not shown.
 *   `undated` — no readable `last_offered`: the same.
 *   `ahead`   — dated past `latestDatable` (a typo): the row shows nothing. */
export type RowFreshness = 'current' | 'other' | 'undated' | 'ahead';

export interface RowSchedule {
  /** What the row says about the schedule semester's card: true/false as
   * recorded, undefined when the row says nothing usable. */
  this?: boolean;
  /** The same for the semester after it. */
  next?: boolean;
  freshness: RowFreshness;
}

/** What one row says about the two cards: `semester` is the schedule's
 * semester (`sheetSemester`), `today` the date's — for the typo guard. */
export function rowSchedule(semester: Term, today: Term, row: { lastOffered?: Term; offeredNow?: boolean; offeredNext?: boolean }): RowSchedule {
  const dated = row.lastOffered === undefined ? undefined : teachingTermOf(row.lastOffered);
  if (dated !== undefined && compareTeaching(dated, latestDatable(today)) > 0) return { freshness: 'ahead' };
  const freshness: RowFreshness = dated === undefined ? 'undated' : compareTeaching(dated, teachingTermOf(semester)) === 0 ? 'current' : 'other';
  return {
    freshness,
    ...(freshness === 'current' && row.offeredNow !== undefined ? { this: row.offeredNow } : {}),
    ...(row.offeredNext !== undefined ? { next: row.offeredNext } : {}),
  };
}

/** The two cards' semesters: the schedule's semester and the one after. */
export function scheduleTerms(semester: Term): { thisTerm: Term; nextTerm: Term } {
  const thisTerm = teachingTermOf(semester);
  return { thisTerm, nextTerm: afterTeachingTerm(thisTerm) };
}
