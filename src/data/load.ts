// Browser-side rules loading: fetch the published sheet CSVs, reporting progress
// so the page can show what it is waiting for (src/ui/loading.ts). On failure
// the loader THROWS a RulesLoadError — it does NOT fall back to the bundled
// snapshot by itself (DGS decision 2026-09-01: when Google does not answer,
// suggest reloading rather than quietly showing an older copy). The page offers
// the saved copy as a second choice (rulesFromSnapshot) so the tool still works
// if the sheet is ever unpublished. Either way the rules are dated against that
// snapshot (src/data/rules-date.ts explains how).
import sheetUrls from '../../data/sheet-urls.json' with { type: 'json' }; // the attribute lets node's test runner import this file too
import snapshot from '../../data/snapshot.json' with { type: 'json' };
import { rulesFromCsvTexts, type CsvTexts } from './assemble.ts';
import { dateLiveRules, ndDateOnly } from './rules-date.ts';
import type { Rules } from './types.ts';

/** Google's publish-to-web endpoint answers a tab in well under a second most
 * of the time, but a fair share of requests simply stall — hang until they are
 * abandoned (measured from the DGS's Mac on 2026-09-06, 144 requests: 17% of
 * them stalled past 4 s, at the same rate whether the four tabs were fetched
 * together, two at a time or one after another; the next request for the same
 * tab answered in ~0.3 s). Waiting on a stalled request does not help; asking
 * again does — and the sooner, the better.
 *
 * So each attempt for a tab is HEDGED: when the first request has not answered
 * after HEDGE_AFTER_MS, a second request for the same tab is sent alongside it
 * and whichever answers first wins (the other is dropped). A stall then costs
 * about two seconds, not the whole attempt. */
export const HEDGE_AFTER_MS = 2_000;
/** How long a whole attempt (both requests) may take before the tab is asked
 * for afresh — one entry per attempt. The first is short; the later ones are
 * longer so a slow but working connection still gets through. */
export const ATTEMPT_TIMEOUTS_MS: readonly number[] = [6_000, 10_000, 14_000];
/** Attempts per tab before the load is reported as failed. */
const MAX_ATTEMPTS = ATTEMPT_TIMEOUTS_MS.length;
/** Tabs fetched at the same time: all of them (DGS 2026-09-06, after the
 * measurement above showed no rate limiting and no extra stalls from
 * simultaneous requests) — five since the Universities tab (2026-10-10).
 * Lower it here if Google ever changes that. */
export const FETCH_CONCURRENCY = 5;
/** What the loading card calls the upper bound ("usually a few seconds, up to
 * about 30"): the three attempts end to end, plus the pauses between them. */
export const LOAD_BUDGET_MS = 30_000;

export type TabName = keyof CsvTexts;
/** The tabs in words a student understands ("the course list", not "Courses"). */
export const TAB_LABELS: Record<TabName, string> = {
  courses: 'the course list',
  parameters: 'the parameters',
  categories: 'the categories',
  external: 'the course rules',
  universities: 'the university list',
};

/** The published-CSV URL of each tab (data/sheet-urls.json), typed once. */
const SHEET_URLS = sheetUrls as { courses: string; parameters: string; categories: string; external?: string; universities?: string };

/** Is the ExternalCourses tab published and configured? Until the DGS creates
 * the tab and pastes its published-CSV URL into data/sheet-urls.json, the app
 * runs without it and every external course shows as "not yet reviewed". */
export const EXTERNAL_TAB_CONFIGURED: boolean = typeof SHEET_URLS.external === 'string' && SHEET_URLS.external !== '';
/** Is the Universities tab (DGS 2026-10-10: each university's credit system)
 * published and configured? Optional like ExternalCourses: without it the old
 * per-course credit_system cells are read (assemble.ts). */
export const UNIVERSITIES_TAB_CONFIGURED: boolean = typeof SHEET_URLS.universities === 'string' && SHEET_URLS.universities !== '';
/** The optional tabs: if one of them alone fails, the app still runs. */
const OPTIONAL_TABS: readonly TabName[] = ['external', 'universities'];

/** What the loader reports while it works (drives the loading card). */
export type LoadProgress =
  | { step: 'connect' }
  /** A request stalled and the tab is being asked for again: `hedged` for a
   * second request sent alongside the first, otherwise a fresh attempt. */
  | { step: 'retry'; tab: TabName; attempt: number; of: number; hedged: boolean }
  | { step: 'tab'; tab: TabName; rows: number; ms: number }
  | { step: 'check' };

export type LoadFailureKind = 'timeout' | 'unreachable' | 'http' | 'unpublished' | 'empty';

/** Why a live load failed, in words a student can act on. `retryable` says
 * whether reloading the page is likely to help (a hung or failed connection:
 * yes; a sheet that is unpublished or empty: no — that needs the DGS). */
export class RulesLoadError extends Error {
  readonly kind: LoadFailureKind;
  readonly tab: TabName | undefined;
  readonly retryable: boolean;
  /** The HTTP status for kind 'http' (a 5xx is worth asking again; a 4xx is not). */
  readonly status: number | undefined;
  // Plain fields rather than constructor parameter properties: node's
  // type-stripping test runner does not support the latter (tests/load-retry.test.ts).
  constructor(kind: LoadFailureKind, tab: TabName | undefined, message: string, retryable: boolean, status?: number) {
    super(message);
    this.name = 'RulesLoadError';
    this.kind = kind;
    this.tab = tab;
    this.retryable = retryable;
    this.status = status;
  }
}

/** The day the bundled copy was saved (YYYY-MM-DD) as the calendar reads at
 * Notre Dame, for the page's messages — the same day the masthead's "last
 * updated on …" names, which it was not while this took the UTC slice of the
 * timestamp (review R-22, 2026-09-18). */
export const SNAPSHOT_SAVED_ON = ndDateOnly(snapshot.syncedAt);

/** Data rows in a CSV text: non-empty lines (a line of only commas is a blank
 * sheet row) minus the header. Good enough for "371 rows" on the loading card. */
function countCsvRows(csv: string): number {
  let n = 0;
  for (const line of csv.split(/\r?\n/)) if (!/^[\s,]*$/.test(line)) n++;
  return Math.max(0, n - 1);
}

/** One HTTP request for one tab; throws a RulesLoadError. An abort (ours —
 * the hedge that lost, or the attempt's deadline) reads as a timeout. */
async function requestOnce(tab: TabName, url: string, signal: AbortSignal): Promise<string> {
  let res: Response;
  let text: string;
  try {
    res = await fetch(url, {
      signal,
      // The published CSV is public; no credentials, no cookies.
      credentials: 'omit',
      cache: 'no-cache',
    });
    if (!res.ok) {
      // A 5xx is Google having a bad minute and reloading is worth a try; a
      // 4xx is an answer about this URL that will not change on a reload —
      // the retry logic below already knew that (`isRetryable`), but the card
      // was told every HTTP error was worth retrying (review B-21, 2026-09-18).
      const worthRetrying = res.status >= 500;
      throw new RulesLoadError(
        'http',
        tab,
        worthRetrying
          ? `Google answered with an error (HTTP ${res.status}) for ${TAB_LABELS[tab]}.`
          : `Google refused to send ${TAB_LABELS[tab]} (HTTP ${res.status}) — the link in the app may no longer point at a published tab. Reloading will not help.`,
        worthRetrying,
        res.status,
      );
    }
    text = await res.text();
  } catch (e) {
    if (e instanceof RulesLoadError) throw e;
    if (e instanceof DOMException && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
      throw new RulesLoadError('timeout', tab, `Google did not send ${TAB_LABELS[tab]} in time.`, true);
    }
    throw new RulesLoadError('unreachable', tab, 'The spreadsheet could not be reached — check your internet connection.', true);
  }
  // Google serves an HTML error page (not CSV) for unpublished sheets.
  if (/^\s*</.test(text)) {
    throw new RulesLoadError(
      'unpublished',
      tab,
      'The spreadsheet is no longer published to the web, so no one can load it until the DGS re-publishes it. Reloading will not help.',
      false,
    );
  }
  return text;
}

/** One ATTEMPT for one tab: a request, joined by a second one after
 * `hedgeAfterMs` without an answer (or at once, if the first fails in a way a
 * second request may cure); the first answer wins and the other request is
 * dropped. The whole attempt is abandoned at `timeoutMs`. Exported for the
 * tests, which stub `fetch`. */
export function fetchCsvOnce(
  tab: TabName,
  url: string,
  onProgress: (p: LoadProgress) => void,
  timeoutMs: number,
  hedgeAfterMs = HEDGE_AFTER_MS,
  attempt = 1,
  attempts = MAX_ATTEMPTS,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const started = Date.now();
    const controllers: AbortController[] = [];
    let settled = false;
    let outstanding = 0;
    let hedgeSent = false;
    let firstError: unknown;
    const finish = (err: unknown, text?: string): void => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      clearTimeout(hedgeTimer);
      for (const c of controllers) c.abort();
      if (err === undefined) resolve(text as string);
      else reject(err);
    };
    const send = (): void => {
      const c = new AbortController();
      controllers.push(c);
      outstanding += 1;
      requestOnce(tab, url, c.signal).then(
        (text) => {
          if (settled) return;
          onProgress({ step: 'tab', tab, rows: countCsvRows(text), ms: Date.now() - started });
          finish(undefined, text);
        },
        (e: unknown) => {
          outstanding -= 1;
          if (settled) return;
          firstError ??= e;
          if (!worthRetrying(e)) finish(e); // a definite answer (4xx, unpublished): no point in waiting
          else if (!hedgeSent) hedge(); // the first request failed early: send the second at once
          else if (outstanding === 0) finish(firstError); // both failed
        },
      );
    };
    const hedge = (): void => {
      if (settled || hedgeSent) return;
      hedgeSent = true;
      clearTimeout(hedgeTimer);
      onProgress({ step: 'retry', tab, attempt, of: attempts, hedged: true });
      send();
    };
    const hedgeTimer = setTimeout(hedge, hedgeAfterMs);
    const deadline = setTimeout(
      () => finish(new RulesLoadError('timeout', tab, `Google did not send ${TAB_LABELS[tab]} within ${timeoutMs / 1000} seconds.`, true)),
      timeoutMs,
    );
    send();
  });
}

/** Is this failure the kind that a second request usually cures? A stalled or
 * dropped request, or a server-side error — not an unpublished sheet (an HTML
 * page instead of CSV) or a 4xx, which the DGS has to fix. */
export function worthRetrying(e: unknown): boolean {
  return e instanceof RulesLoadError && (e.kind === 'timeout' || e.kind === 'unreachable' || (e.kind === 'http' && (e.status ?? 0) >= 500));
}

/** Fetch one tab: hedged attempts (fetchCsvOnce), a fresh attempt after each
 * one that is abandoned, up to `timeouts.length` attempts. The pause between
 * attempts is short: a stall is a one-off on Google's side, not a sign that
 * the endpoint is overloaded. */
export async function fetchCsv(
  tab: TabName,
  url: string,
  onProgress: (p: LoadProgress) => void,
  timeouts: readonly number[] = ATTEMPT_TIMEOUTS_MS,
  hedgeAfterMs = HEDGE_AFTER_MS,
  pause: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<string> {
  const attempts = timeouts.length;
  for (let attempt = 1; ; attempt++) {
    try {
      return await fetchCsvOnce(tab, url, onProgress, timeouts[attempt - 1]!, hedgeAfterMs, attempt, attempts);
    } catch (e) {
      if (!worthRetrying(e) || attempt >= attempts) {
        if (e instanceof RulesLoadError && e.kind === 'timeout' && attempts > 1) {
          const total = timeouts.reduce((a, b) => a + b, 0) / 1000;
          throw new RulesLoadError('timeout', tab, `Google did not send ${TAB_LABELS[tab]} — ${attempts} attempts, ${total} seconds in all, went unanswered.`, true);
        }
        throw e;
      }
      onProgress({ step: 'retry', tab, attempt: attempt + 1, of: attempts, hedged: false });
      await pause(250 * attempt);
    }
  }
}

/** The copy of the rules saved in the app (data/snapshot.json) — shown only
 * when the student chooses it after a failed live load. Its syncedAt is when
 * these rules were first seen by the sync, so they are dated `known`. */
export function rulesFromSnapshot(): Rules {
  return rulesFromCsvTexts(snapshot.csv as CsvTexts, {
    source: 'snapshot',
    syncedAt: snapshot.syncedAt,
    rulesDate: { kind: 'known', at: snapshot.syncedAt },
  });
}

/** The live sheet is newer than the deployed copy: fine for a few hours after a
 * DGS edit, worth a look if it persists (the sync Action may have stopped). */
function noteNewerSheet(rules: Rules): Rules {
  if (rules.rulesDate?.kind === 'after') {
    rules.issues.push({
      severity: 'warning',
      tab: 'Courses',
      message:
        `The live sheet differs from the copy saved in the app on ${rules.rulesDate.at.slice(0, 10)}, so the pages can only say the rules were "updated after" that date. ` +
        'This is normal for up to ~6 hours after an edit — the sync-sheet Action then records the date, saves the new copy and redeploys. ' +
        "If it persists for more than a day, check that Action (MAINTENANCE.md, 'Sync, deploy, test').",
    });
  }
  return rules;
}

/** Load the live rules, reporting progress; throws RulesLoadError on failure.
 * The optional ExternalCourses tab is different: if IT alone fails, the app
 * still runs — external courses degrade to "not yet reviewed" and the
 * diagnostics panel says why (never a dead page over the optional tab). */
export async function loadLiveRules(nowIso: string, onProgress: (p: LoadProgress) => void = () => {}): Promise<Rules> {
  onProgress({ step: 'connect' });
  const urls = SHEET_URLS;
  // All tabs at once, each hedged and retried (2026-09-06; the history: a
  // plain Promise.all with one 15 s request per tab, then one tab after
  // another — both failed whenever any single request stalled, because the
  // one request WAS the budget). Stalls are as frequent at any concurrency,
  // so the queue below runs FETCH_CONCURRENCY = all four; the constant stays
  // so a future DGS can throttle it without touching the logic.
  const got: Partial<Record<TabName, string>> = {};
  const optionalIssues: Partial<Record<TabName, string>> = {};
  let failed = false;
  const queue: TabName[] = [
    'courses',
    'parameters',
    'categories',
    ...(EXTERNAL_TAB_CONFIGURED ? (['external'] as TabName[]) : []),
    ...(UNIVERSITIES_TAB_CONFIGURED ? (['universities'] as TabName[]) : []),
  ];
  const worker = async (): Promise<void> => {
    for (let tab = queue.shift(); tab !== undefined && !failed; tab = queue.shift()) {
      try {
        got[tab] = await fetchCsv(tab, urls[tab]!, onProgress);
      } catch (e: unknown) {
        // An optional tab degrades; a required one fails the load (and the
        // other worker stops taking tabs — the card is already reporting).
        if (!OPTIONAL_TABS.includes(tab)) {
          failed = true;
          throw e;
        }
        optionalIssues[tab] = e instanceof Error ? e.message : String(e);
      }
    }
  };
  await Promise.all(Array.from({ length: FETCH_CONCURRENCY }, worker));
  const { courses, parameters, categories, external, universities } = got as { courses: string; parameters: string; categories: string; external?: string; universities?: string };
  onProgress({ step: 'check' });
  const live: CsvTexts = { courses, parameters, categories, ...(external !== undefined ? { external } : {}), ...(universities !== undefined ? { universities } : {}) };
  // An optional tab that failed to load is not evidence that the rules changed:
  // it is dated against the saved copy as if it matched (review 2026-10-10 —
  // otherwise the page said the rules were updated after the saved copy).
  const forDating: CsvTexts = { ...live };
  for (const tab of OPTIONAL_TABS) {
    const saved = (snapshot.csv as CsvTexts)[tab];
    if (optionalIssues[tab] !== undefined && saved !== undefined) forDating[tab] = saved;
  }
  const rules = rulesFromCsvTexts(live, { source: 'live', syncedAt: nowIso, rulesDate: dateLiveRules(forDating, snapshot) });
  // A tab that answered but holds no data (cleared by accident, or unpublished
  // on its own) is a failure to report, not "there are no courses".
  // The Categories tab is two lists side by side and BOTH are load-bearing:
  // the §4.4.2 groups and the §4.4.1 core areas. Only the groups were checked
  // until 2026-09-18 (review B-37), so a Categories tab whose core half had
  // been cleared loaded normally and the course-rules page rendered its "Core
  // knowledge areas §4.4.1" heading and paragraph over an empty grid, with
  // every Core cell reading "—": a Ph.D. student would read that no Notre Dame
  // course satisfies any core area.
  const emptyTab: TabName | undefined =
    rules.courses.size === 0
      ? 'courses'
      : rules.parameters.raw.size === 0
        ? 'parameters'
        : rules.categoryGroups.length === 0 || rules.coreAreas.length === 0
          ? 'categories'
          : undefined;
  if (emptyTab) {
    // Which half is missing, when it is one half of the Categories tab — "the
    // categories tab is empty" sends the DGS looking at a tab with rows in it.
    const what =
      emptyTab === 'categories' && rules.categoryGroups.length > 0
        ? 'the categories tab has no core-knowledge areas (its core_area column)'
        : emptyTab === 'categories' && rules.coreAreas.length > 0
          ? 'the categories tab has no specialization groups (its category_group column)'
          : // A tab that answered with rows the parser could not use at all reads
            // differently from one that is genuinely blank (review R-15).
            countCsvRows(emptyTab === 'courses' ? courses : emptyTab === 'parameters' ? parameters : categories) > 0
            ? `${TAB_LABELS[emptyTab]} tab has rows, but not one of them could be read`
            : `${TAB_LABELS[emptyTab]} tab is empty`;
    throw new RulesLoadError('empty', emptyTab, `The spreadsheet answered, but ${what} — the DGS needs to check the sheet. Reloading will not help until then.`, false);
  }
  if (optionalIssues.external !== undefined) {
    rules.issues.push({
      severity: 'warning',
      tab: 'ExternalCourses',
      message: `The ExternalCourses tab could not be loaded (${optionalIssues.external}) — courses from other universities show as "not yet reviewed by the DGS" until it is reachable again.`,
    });
  }
  if (optionalIssues.universities !== undefined) {
    // The old ExternalCourses credit_system column is still read when a sheet
    // has it, but the live sheet's was deleted (2026-10-10), so the warning
    // says what the page actually does without the tab (policy review round
    // 4, P4-data-4; DGS 2026-10-12): credits count as printed, and each such
    // line says the DGS converts them (allocate.ts creditsAsPrinted).
    rules.issues.push({
      severity: 'warning',
      tab: 'Universities',
      // A course whose own record carries a quarter or trimester reading (the
      // transcript's, or the student's choice at import) is still converted
      // (round 5, item 16; DGS 2026-10-14).
      message: `The Universities tab could not be loaded (${optionalIssues.universities}) — each university's credit system is unknown until it is reachable again: a course whose transcript reading (or the student's choice at import) says quarter or trimester units is still converted; the others count their credits as the transcript prints them, and each such line says the DGS converts quarter or trimester units (§5.2 pro-rata).`,
    });
  }
  return noteNewerSheet(rules);
}
