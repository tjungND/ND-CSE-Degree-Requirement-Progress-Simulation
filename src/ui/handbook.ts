// The handbook edition the page texts refer to, and where the official PDF lives.
// This is the ONE place to update when a new handbook is published (see README.md
// "The yearly routine"); the masthead, footer and copied summary all read from here.
// The rules themselves come from the Google Sheet and the engine, not from this file.
import { formatDateLong } from '../data/rules-date.ts';
import type { RulesDate } from '../data/types.ts';
import { el } from './dom.ts';

/** The DGS's PERMANENT link to the handbook (DGS 2026-09-30): a Google Drive
 * file whose future editions are uploaded as new versions of the same file,
 * so the link never changes. The title names no edition either (DGS
 * 2026-09-30: "The version is described in the document itself"), so a new
 * edition needs no change here at all. (Until then the link was the
 * cse.nd.edu upload of the July 2026 PDF, and the title carried "(July
 * 2026)".) */
export const HANDBOOK_URL = 'https://drive.google.com/open?id=1SpxGErmfwWvU4dTEkAy_3LJvzm_DUxA_&usp=drive_fs';
export const HANDBOOK_TITLE = 'CSE Graduate Studies Handbook';

/** A link to the official handbook PDF, opening in a new tab. */
export function handbookLink(label: string = HANDBOOK_TITLE): HTMLAnchorElement {
  return el('a', { href: HANDBOOK_URL, target: '_blank', rel: 'noopener noreferrer' }, label);
}

/** The beta-status disclaimer, worded by the DGS (docs/DECISIONS.md,
 * 2026-09-01; shortened the same day at the DGS's request). "the DGS", not
 * the full title, since the trim review (P-42, 2026-09-18): the DGS→ADGS
 * rewrite matches only the token, so on the MSCSE tab the full title left the
 * page and the advisor email naming two deciders (DECISIONS 2026-09-15). */
export const BETA_NOTICE =
  'Informational only, no warranty — not an official degree audit; every final decision ' +
  'rests with the DGS.';

/** The one award the page's result is acted on directly (DECISIONS
 * 2026-10-07, P3-cse-3-2 — DGS: "This app’s checking is equivalent to the DGS
 * review … If the rules/policies say the student is eligible for MSCSE along
 * the way, the DGS (= I) does not need to be further involved"). Said after
 * BETA_NOTICE on the Ph.D. tab, so "informational only" is not contradicted
 * by the processing request (DGS 2026-10-11, item 6). The DGS's sentence above
 * stays word for word. */
export const ALONG_THE_WAY_NOTICE = 'For the MSCSE along the way, this self-check is the DGS’s own review of the award (§3.1).';

/** The alpha notice for a program's tab: the Ph.D.'s adds the along-the-way sentence. */
export function betaNotice(program: 'mscse' | 'phd'): string {
  return program === 'phd' ? `${BETA_NOTICE} ${ALONG_THE_WAY_NOTICE}` : BETA_NOTICE;
}

/** What is NOT in beta: the course rules themselves (DGS wording, 2026-09-01).
 * Shown in bold beside the alpha notice at the top of the page (app.ts), so a
 * student does not read "alpha" as "the rules may be wrong". The two roles as
 * the course rules page words them (DGS 2026-10-04; policy review round 3,
 * P3-text-ui-6): the DGS decides, the Grad Admin processes — the page's
 * DGS→ADGS rewrite serves the MSCSE tab. */
export const RULES_ACCURACY_NOTICE =
  'The course rules are accurate: they are exactly the rules the DGS uses to decide requirement ' +
  'satisfaction; the Grad Admin processes what is decided.';

// The privacy line's measurement record — NOT rendered anywhere (the notice
// strip and the footer in app.ts carry the W-P1 sentence in their own text;
// the strip's one-line alpha version, ALPHA_LINE, was retired with the two-strip
// notice of 2026-09-19). Kept because app.ts's notice cites it as the record.
// Measured, not assumed (interface review R6, 2026-09-18): one load makes FIVE
// requests — four to docs.google.com, one per published sheet tab, and one HEAD
// back to this site's own server for the date at Notre Dame. No student data is
// in any of them, and that part of the old claim was true and verified; but
// Google and GitHub each receive an IP, a user agent and a referrer, so "no
// third party" was not accurate and "the page's only network request" was
// singular for five. Wording approved by the DGS as W-P1.
//
// PRIVACY_LINE, the approved sentence — a comment since 2026-10-22 (blue-team
// review 2026-10-17, W10: no file imported the constant; page-frame.ts's
// notice strip and footer carry the sentence in their own text and cite this
// record):
//   'Your coursework never leaves this browser. The page itself loads from
//   GitHub and reads the course rules from Google Sheets, so those two services
//   see that someone opened the page; they never see what you enter.'

/** The sentences that follow RULES_ACCURACY_NOTICE — what the alpha label
 * covers (PDF-parsing caveat added at the DGS's request, 2026-09-04; the
 * coverage caveat 2026-09-05). "under development and still highly inaccurate"
 * said one thing twice — recast in the trim review (2026-09-18, P-39), which
 * overrules the 2026-09-04 PDF-caveat wording; the coverage caveat it carried was
 * removed by the DGS on 2026-10-04. */
// The coverage caveat ("Not all cases are covered yet, for example …") was
// removed at the DGS's request on 2026-10-04.
export const BETA_SCOPE_NOTICE =
  'Only this tool’s application of them is still being tested — in particular the transcript-PDF ' +
  'import, still highly inaccurate: check every imported course against ' +
  'your actual transcript.';

/** The dated line under each page's title — two dates, one sentence (DGS wording,
 *  2026-09-01): "The course rules here were last updated on <X>, and are up-to-date
 *  as of <Y>." X is when the sheet's content last changed; Y is the day the page
 *  read the sheet (or, when the live fetch failed, the day the fallback copy was
 *  saved — the banner explains). X comes from `rules.rulesDate`
 *  (`src/data/rules-date.ts`): `known` → that date; `after` → the live sheet is
 *  newer than the deployed copy, so "were updated after <copy date>" until the next
 *  sync run (within 6 hours) pins the revision date. The DGS's optional
 *  `rules_effective_date` Parameters row replaces X with "are effective as of <date>";
 *  rules built without a snapshot (tests) fall back to "are those in effect for
 *  <term>". */
export function rulesDateLine(
  rules: {
    parameters: { raw: ReadonlyMap<string, { value: string }> };
    rulesDate?: RulesDate;
    source: 'live' | 'snapshot';
    syncedAt: string;
  },
  currentTermLabel: string,
  todayIso: string,
): string {
  const asOf = rules.source === 'live' ? formatYmdLong(todayIso.slice(0, 10)) : formatDateLong(rules.syncedAt);
  const tail = asOf ? `, and are up-to-date as of ${asOf}.` : '.';
  const override = rules.parameters.raw.get('rules_effective_date')?.value.trim();
  if (override) return `The course rules here are effective as of ${formatYmdLong(override) ?? override}${tail}`;
  const at = formatDateLong(rules.rulesDate?.at);
  // One date, not the same date twice. On any day the sheet changed, the LIVE
  // page printed "last updated on September 18, 2026, and are up-to-date as of
  // September 18, 2026" — nineteen words for eleven (trim review P-13,
  // 2026-09-18). Live only: on the saved copy the two dates are different
  // facts, and "last updated on X and up-to-date as of X" is worth saying,
  // which is what tests/rules-date.test.ts pins.
  if (at && rules.rulesDate?.kind === 'known') {
    return rules.source === 'live' && at === asOf
      ? `The course rules here were last updated on ${at}.`
      : `The course rules here were last updated on ${at}${tail}`;
  }
  // "updated AFTER September 8, and up-to-date as of September 8" contradicts
  // itself, and says so for the six hours after every sheet edit (2026-09-08).
  // Only this branch collapses: for the saved copy, "last updated on X and
  // up-to-date as of X" is a true and useful thing to say.
  if (at && at === asOf) return `The course rules here are up-to-date as of ${asOf}.`;
  if (at) return `The course rules here were updated after ${at}${tail}`;
  return `The course rules here are those in effect for ${currentTermLabel}${tail}`;
}

/** One formatter for every long date, made once (efficiency, 2026-10-07):
 * toLocaleDateString with options builds a new one on every call (~25 µs
 * against ~0.5 µs). UTC on both sides — Date.UTC in, timeZone UTC out — so
 * the day printed is year-month-day whatever the device's zone; the local
 * round-trip check in formatYmdLong has already validated the date. */
const LONG_DATE_UTC = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric' });

/** "2026-09-01" → "September 1, 2026" as a calendar date (no time-zone shift);
 *  undefined for anything that is not YYYY-MM-DD. Also used by the advisor
 *  summary for its "as of" date. */
export function formatYmdLong(ymd: string): string | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return undefined;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(year, month - 1, day);
  if (Number.isNaN(d.getTime())) return undefined;
  // `new Date(2026, 8, 31)` is 1 October, silently — the constructor rolls an
  // impossible day forward and never returns NaN for integers, so the DGS's
  // typo "2026-09-31" printed "effective as of October 1, 2026" in the one
  // sentence the page offers as its date of authority (review R-23,
  // 2026-09-18). A date that did not survive the round trip is not a date;
  // `rulesDateLine`'s `?? override` then prints the cell as the sheet wrote it.
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return undefined;
  return LONG_DATE_UTC.format(Date.UTC(year, month - 1, day));
}
