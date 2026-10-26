// The rules start downloading while the app's script does (efficiency round,
// DGS 2026-10-25: "perform code optimization to make web pages / app more
// efficient").
//
// Both pages fetch the five published tabs of the rules sheet from Google as
// soon as they open, and Google takes 300–400 ms to answer. Until 2026-10-26
// those requests started only once the app's script had downloaded and run —
// 100–300 ms after the page opened on a fast connection, seconds on a slow
// phone one — and the page waited for both, one after the other. Now a few
// lines in each page's <head>, written at build from data/sheet-urls.json by
// the `rulesHeadStart` plugin in vite.config.ts, start the same five requests
// while the browser is still downloading the script, and the loader
// (src/data/load.ts `requestOnce`) takes each one over instead of asking again.
//
// The SAME requests to the same host as before, only earlier: the page's
// promise that nothing leaves the browser except the read-only fetch of the
// rules sheet is unchanged. A head request is taken once — by the first
// request of the first attempt for its tab; a hedge, a retry and "Try again"
// always ask afresh — and the loader's hedging, deadlines and error reports
// are untouched.
//
// This file is imported by vite.config.ts (to write the <head> lines) and by
// the loader (to take them over), so it touches no DOM at import time.

/** The line in index.html and courses.html the build replaces with the
 * <head> lines — high in <head>, above the stylesheets. */
export const HEAD_START_MARK = '<!-- rules-head-start -->';

/** The window property the <head> lines fill: one entry per tab. */
export const HEAD_START_KEY = '__cseRulesHeadStart';

/** The options of every request for a tab of the rules sheet — the <head>
 * lines and the loader use these same ones, so a head request is the request
 * the loader would have made. The published CSV is public: no credentials, no
 * cookies; `no-cache` revalidates rather than trusting a stale copy. */
export const SHEET_FETCH_INIT = { credentials: 'omit', cache: 'no-cache' } as const satisfies RequestInit;

/** The tabs of the rules sheet, as data/sheet-urls.json names them — the
 * loader's tabs (load.ts `TAB_LABELS`; tests/head-start.test.ts keeps the two
 * lists the same). Only these keys are read: the file also holds the sheet's
 * edit link, which no page ever fetches. */
export const RULES_TABS = ['courses', 'parameters', 'categories', 'external', 'universities'] as const;

/** One request the <head> lines started. */
export interface HeadStarted {
  url: string;
  promise: Promise<Response>;
  controller?: AbortController;
}

/** The <head> lines for the tab URLs in data/sheet-urls.json (an empty or
 * missing URL — a tab not published yet — is skipped, as the loader skips it).
 * Plain old JavaScript, wrapped so a browser that cannot run it simply loads
 * the rules the old way. Each request's rejection is caught here so it never
 * surfaces as an unhandled error; the loader still sees the failure when it
 * takes the request over, and asks again at once (its hedge). */
export function headStartScript(sheetUrls: Readonly<Record<string, unknown>>): string {
  const wanted: Record<string, string> = {};
  for (const tab of RULES_TABS) {
    const url = sheetUrls[tab];
    if (typeof url === 'string' && /^https:\/\//.test(url)) wanted[tab] = url;
  }
  return [
    'try {',
    '  (function (w) {',
    '    if (typeof w.fetch !== "function") return;',
    `    var urls = ${JSON.stringify(wanted)};`,
    '    var started = {};',
    '    for (var tab in urls) {',
    '      var c = typeof AbortController === "function" ? new AbortController() : undefined;',
    `      var p = w.fetch(urls[tab], { credentials: ${JSON.stringify(SHEET_FETCH_INIT.credentials)}, cache: ${JSON.stringify(SHEET_FETCH_INIT.cache)}, signal: c ? c.signal : undefined });`,
    '      p.catch(function () {});',
    '      started[tab] = { url: urls[tab], promise: p, controller: c };',
    '    }',
    `    w[${JSON.stringify(HEAD_START_KEY)}] = started;`,
    '  })(window);',
    '} catch (e) {}',
  ].join('\n');
}

/** Take over the request the <head> lines started for this tab, if there is
 * one for this very URL — once: the entry is removed, so the next request for
 * the tab (a hedge, a retry, "Try again") is a fresh one. */
export function takeHeadStart(tab: string, url: string): HeadStarted | undefined {
  const started = (globalThis as Record<string, unknown>)[HEAD_START_KEY] as Record<string, HeadStarted | undefined> | undefined;
  const entry = started?.[tab];
  if (!entry) return undefined;
  delete started![tab];
  if (entry.url === url) return entry;
  entry.controller?.abort(); // started for another URL (cannot happen while both read the same file): not ours to wait for
  return undefined;
}
