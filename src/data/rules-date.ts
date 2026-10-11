// When did the course rules last change? Google's published CSVs carry no
// Last-Modified (or ETag) header — verified 2026-09-01 by fetching all three tabs
// from the deployed page's own origin — so the app dates the rules itself, from
// the committed snapshot:
//   scripts/sync-sheet.ts runs every 6 hours (GitHub Action) and leaves
//   data/snapshot.json UNTOUCHED while the sheet's content is unchanged. So the
//   snapshot's `syncedAt` is the moment the CURRENT rules were first seen —
//   normally the day of the DGS's edit, never earlier than the real edit — and
//   each snapshot commit reads as "what the DGS changed".
// Pure (no fetch, no DOM) so the browser loader, the sync script and the tests
// share one definition of "same content".
import type { CsvTexts } from './assemble.ts';
import { ND_TIME_ZONE, notreDameDate } from './clock.ts';
import type { RulesDate } from './types.ts';

/** Same sheet content? Line endings and trailing whitespace are ignored so a
 * cosmetic difference in how the text was captured never looks like an edit. */
export function sameCsvContent(a: CsvTexts, b: CsvTexts): boolean {
  return changedTabs(a, b).length === 0;
}

/** Which tabs differ (for the sync log). An optional tab (ExternalCourses,
 * Universities) counts as changed when it appears, disappears, or its content
 * changes. */
export function changedTabs(a: CsvTexts, b: CsvTexts): (keyof CsvTexts)[] {
  const tabs: (keyof CsvTexts)[] = ['courses', 'parameters', 'categories', 'external', 'universities'];
  return tabs.filter((tab) => {
    const av = a[tab];
    const bv = b[tab];
    if (av === undefined || bv === undefined) return av !== bv;
    return normalizeCsvText(av) !== normalizeCsvText(bv);
  });
}

/** One tab's text with line endings and trailing whitespace evened out — the
 * same normalization the rules fingerprint uses (src/data/fingerprint.ts), so
 * "same content" and "same fingerprint" always agree. */
export function normalizeCsvText(text: string): string {
  return text.replace(/\r\n?/g, '\n').trimEnd();
}

/** Date the live rules against the bundled snapshot: identical content → they
 * last changed when the snapshot captured them; different → some time after. */
export function dateLiveRules(live: CsvTexts, snapshot: { syncedAt: string; csv: CsvTexts }): RulesDate {
  return { kind: sameCsvContent(live, snapshot.csv) ? 'known' : 'after', at: snapshot.syncedAt };
}

// Made on first use and kept (efficiency, 2026-10-07): toLocaleDateString
// with options builds a new formatter on every call. Its constructor is what
// throws on a runtime without the zone database, so it is made inside the try.
let ndLongDate: Intl.DateTimeFormat | undefined;

/** "September 1, 2026" as the calendar reads AT NOTRE DAME; undefined for bad
 * input.
 *
 * The zone matters (review R-22, 2026-09-18): this formats an instant — the
 * moment the sync last saw the current rules — while everything else the
 * pages date ("up-to-date as of …", the semester, every deadline) is Notre
 * Dame's calendar date. Formatted in the reader's own zone the two disagreed
 * across midnight: a reader in Tokyo at 02:30 UTC read "last updated on
 * September 17 … and are up-to-date as of September 16", and the 2026-09-08
 * guard against exactly that contradiction compared a local-zone string with
 * an ND-zone one and let it through. The sync itself runs at 00:17 UTC, so the
 * DGS in Indiana met the same mismatch on the snapshots it writes overnight. */
export function formatDateLong(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return undefined;
  try {
    ndLongDate ??= new Intl.DateTimeFormat('en-US', { timeZone: ND_TIME_ZONE, year: 'numeric', month: 'long', day: 'numeric' });
    return ndLongDate.format(new Date(t));
  } catch {
    // A runtime without the zone database: the device's own calendar, which is
    // what this function did before the zone was passed at all.
    return new Date(t).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  }
}

/** The same instant as YYYY-MM-DD at Notre Dame — the short spelling the
 * loading card's button and the saved-copy banner use, so all three places
 * name one day (review R-22). */
export function ndDateOnly(iso: string): string {
  try {
    return notreDameDate(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}
