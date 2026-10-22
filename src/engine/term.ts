// Term arithmetic (decision Q17): fall + spring semesters only, semester 1 = the
// entry term, approximate end-of-semester dates always labeled "(approximate)".
// §4.3: "full-time status for four (4) consecutive semesters (not including the
// summer session)" — summers are skipped without breaking a consecutive run.
import type { ApproxDate, Season, Term } from './types.ts';

const SEASON_ORDER: Record<Season, number> = { spring: 0, summer: 1, fall: 2 };

/** Total order over terms: Spring 2026 < Summer 2026 < Fall 2026 < Spring 2027 … */
export function termIndex(t: Term): number {
  return t.year * 3 + SEASON_ORDER[t.season];
}

/** The term just before `t` in the spring → summer → fall order (fall's
 * predecessor is the same year's summer; spring's is the previous fall). */
export function termBefore(t: Term): Term {
  if (t.season === 'spring') return { season: 'fall', year: t.year - 1 };
  return { season: t.season === 'summer' ? 'spring' : 'summer', year: t.year };
}

export function compareTerm(a: Term, b: Term): number {
  return termIndex(a) - termIndex(b);
}

/** A season's label — "Fall", "Spring", "Summer" — as termLabel and every
 * season dropdown print it. One home since 2026-10-22 (blue-team review
 * 2026-10-17, W9): app.ts, background.ts and external-upload.ts each
 * capitalised it themselves. */
export function seasonName(se: Season): string {
  return se.charAt(0).toUpperCase() + se.slice(1);
}

export function termLabel(t: Term): string {
  return `${seasonName(t.season)} ${t.year}`;
}

/** The short form for TABLE CELLS (DGS 2026-09-07): "FA26", "SP25", "SU25" —
 * season code + two-digit year. Prose, tooltips, aria-labels and the emails
 * keep termLabel's "Fall 2026"; the cells render this inside an <abbr> whose
 * title is the full name. */
const SEASON_CODE: Record<Season, string> = { fall: 'FA', spring: 'SP', summer: 'SU' };
/** The reverse lookup, keyed by the lower-cased code. */
const SEASON_OF_CODE: Readonly<Record<string, Season | undefined>> = { fa: 'fall', sp: 'spring', su: 'summer' };
export function termShort(t: Term): string {
  return `${SEASON_CODE[t.season]}${String(t.year % 100).padStart(2, '0')}`;
}

/** A semester CODE as the pages print it — "FA26", "SP27", "SU26" — back to a
 * Term (DGS 2026-09-09: the sheet takes the code, because "Fall 2026" invites
 * typos that a four-character code does not). Forgiving about case, a space or
 * a hyphen, and a four-digit year; the long form "Fall 2026" still works, so a
 * cell written the old way keeps its meaning. Two digits mean the 21st
 * century, which is the only century this app is for. */
export function parseTermCode(s: string): Term | undefined {
  const m = /^\s*(fa|sp|su)\s*[-\s]?\s*(\d{2}|\d{4})\s*$/i.exec(s);
  if (!m || !m[1] || !m[2]) return parseTermLabel(s);
  const season = SEASON_OF_CODE[m[1].toLowerCase()];
  if (season === undefined) return parseTermLabel(s); // unreachable: the pattern admits only fa|sp|su
  const digits = m[2];
  return { season, year: digits.length === 2 ? 2000 + Number(digits) : Number(digits) };
}

/** "Fall 2026" → Term. Returns undefined for anything else. */
export function parseTermLabel(s: string): Term | undefined {
  const m = /^\s*(spring|summer|fall)\s+(\d{4})\s*$/i.exec(s);
  if (!m || !m[1] || !m[2]) return undefined;
  return { season: m[1].toLowerCase() as Season, year: Number(m[2]) };
}

/** Which semester a Notre Dame DEGREE dated `iso` was conferred for (policy
 * review round 3, P3-dh-front-1-2-1; DGS 2026-10-06: "Apply the suggested
 * handling"). The Graduate School calendar confers degrees on Jan. 3, May 15
 * and Aug. 1, and names the January one the fall's: "Fall 2026 (January
 * graduation), Spring 2027 (May graduation)" (Schedule of Deadlines; also DGS
 * Handbook §3.23). So a January date belongs to the fall of the year before;
 * May stays spring and August summer (termOfDate). Only for Notre Dame
 * conferral dates — "today", course dates and other universities' calendars
 * keep termOfDate. */
export function conferralTerm(iso: string): Term {
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  if (month === 1) return { season: 'fall', year: year - 1 };
  return termOfDate(iso);
}

/** Which term a calendar date falls in: Jan–May spring, Jun 1–Aug 14 summer,
 * Aug 15–Dec 31 fall (nominal semester boundaries; approximate by design). */
export function termOfDate(iso: string): Term {
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  const day = Number(iso.slice(8, 10));
  if (month <= 5) return { season: 'spring', year };
  if (month < 8 || (month === 8 && day < 15)) return { season: 'summer', year };
  return { season: 'fall', year };
}

/** Sequential index over fall/spring terms only (summer maps to the preceding spring). */
export function semesterSeq(t: Term): number {
  if (t.season === 'fall') return t.year * 2 + 1;
  return t.year * 2; // spring and summer both map to the year's spring slot
}

/** How near an open deadline is, in SEMESTERS (DGS 2026-09-28: "When a
 * deadline is approaching soon, 1 semester before, students need to see the
 * alert"): 'this' when the deadline falls in the current semester, 'next'
 * when it falls in the one after, undefined when it is further off. Counted
 * on fall/spring slots (semesterSeq), so a summer date belongs to the spring
 * before it: in Spring 2027 a deadline "before Fall 2027" is next semester,
 * and one "by the end of Spring 2027" is this semester. A date already past
 * is the caller's overdue branch, never a horizon. */
export function deadlineHorizon(deadlineIso: string, today: string): 'this' | 'next' | undefined {
  const gap = semesterSeq(termOfDate(deadlineIso)) - semesterSeq(termOfDate(today));
  return gap <= 0 ? 'this' : gap === 1 ? 'next' : undefined;
}

/** A summer entry term is normalized to the following fall (decision Q17c). */
export function normalizeEntryTerm(entry: Term): { term: Term; normalized: boolean } {
  if (entry.season === 'summer') return { term: { season: 'fall', year: entry.year }, normalized: true };
  return { term: entry, normalized: false };
}

/** 1-based semester number of term `t` for a student who entered at `entry`.
 * Counts fall/spring only; a summer `t` reports the preceding semester's number. */
export function semesterNumber(entry: Term, t: Term): number {
  const e = normalizeEntryTerm(entry).term;
  return semesterSeq(t) - semesterSeq(e) + 1;
}

/** The fall/spring term that is semester `n` (1-based) for `entry`. */
export function nthSemester(entry: Term, n: number): Term {
  const e = normalizeEntryTerm(entry).term;
  let seq = semesterSeq(e) + (n - 1);
  const year = Math.floor(seq / 2);
  const season: Season = seq % 2 === 1 ? 'fall' : 'spring';
  return { season, year };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Nominal first day of classes: spring Jan 10, summer Jun 1, fall Aug 15. */
export function startOfTerm(t: Term): ApproxDate {
  const md = t.season === 'spring' ? '01-10' : t.season === 'summer' ? '06-01' : '08-15';
  return { date: `${t.year}-${md}`, approx: true };
}

/** Nominal last day of the term: spring May 31, summer Aug 14, fall Dec 31. */
export function endOfTerm(t: Term): ApproxDate {
  const md = t.season === 'spring' ? '05-31' : t.season === 'summer' ? '08-14' : '12-31';
  return { date: `${t.year}-${md}`, approx: true };
}

export function addMonthsIso(iso: string, months: number): string {
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  const day = Number(iso.slice(8, 10));
  const total = year * 12 + (month - 1) + months;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${pad(m)}-${pad(Math.min(day, daysInMonth))}`;
}

export function addYearsIso(iso: string, years: number): string {
  return addMonthsIso(iso, years * 12);
}

/** Calendar days after an ISO date (Academic Code §4.4's "30 calendar days …
 * then 14 calendar days" for an Incomplete). */
export function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The last day of the fall/spring term `semesters` after the one `iso` falls
 * in — a §4.4 qualifier extension of that many semesters (DGS 2026-09-13: one
 * at a time; DGS 2026-10-03: "DGS may give any number of semesters as
 * extensions"). Summers are not semesters here, as everywhere else in this
 * file: a summer date belongs to the spring slot before it (as semesterSeq
 * reads it), so a July deadline extended by one semester ends the coming
 * December — not the following May, which nthSemester's summer→fall
 * normalisation used to produce (policy review 2026-10-03, P1-deadlines-c1). */
export function endOfNextSemester(iso: string, semesters = 1): string {
  const t = termOfDate(iso);
  const base: Term = t.season === 'summer' ? { season: 'spring', year: t.year } : t;
  return endOfTerm(nthSemester(base, 1 + semesters)).date;
}

/** Shift a term by whole years (for the §5.2 five-year transfer window). */
export function shiftTermYears(t: Term, years: number): Term {
  return { season: t.season, year: t.year + years };
}

/** Longest run of consecutive full-time fall/spring semesters. Summers are
 * skipped and do not break the run (§4.3); a fall/spring gap does. */
export function maxConsecutiveFullTime(terms: { term: Term; fullTime: boolean }[]): number {
  const fullTimeSeqs = new Set(
    terms.filter((t) => t.fullTime && t.term.season !== 'summer').map((t) => semesterSeq(t.term)),
  );
  let best = 0;
  for (const seq of fullTimeSeqs) {
    if (fullTimeSeqs.has(seq - 1)) continue; // not the start of a run
    let len = 1;
    while (fullTimeSeqs.has(seq + len)) len++;
    best = Math.max(best, len);
  }
  return best;
}

/** How a deadline date reads as a SEMESTER (DGS request 2026-09-05: "remove
 * the dates and show the semesters"). The engine still keeps the ISO date
 * (comparisons, ordering); students and advisors see the term:
 *   the nominal first day of a term  → "the start of Fall 2034"
 *   the nominal last day of a term   → "the end of Spring 2030"
 *   any other day                    → "Spring 2028" (during the term)
 * The Graduate School calendar sets the real dates, so every phrase is approximate. */
export function deadlineTerm(iso: string): { term: Term; when: 'start' | 'end' | 'during' } {
  const term = termOfDate(iso);
  if (startOfTerm(term).date === iso) return { term, when: 'start' };
  if (endOfTerm(term).date === iso) return { term, when: 'end' };
  return { term, when: 'during' };
}

/** "the end of Spring 2030" / "Spring 2028" / "the start of Fall 2034". */
export function deadlineTermLabel(iso: string): string {
  const { term, when } = deadlineTerm(iso);
  return when === 'during' ? termLabel(term) : `the ${when} of ${termLabel(term)}`;
}

/** The phrase after "Due": "by the end of Spring 2030" / "during Spring 2028"
 * / "before Fall 2034" (a start-of-term deadline is the day the term begins). */
export function dueTermPhrase(iso: string): string {
  const { term, when } = deadlineTerm(iso);
  return when === 'end' ? `by the end of ${termLabel(term)}` : when === 'start' ? `before ${termLabel(term)}` : `during ${termLabel(term)}`;
}
