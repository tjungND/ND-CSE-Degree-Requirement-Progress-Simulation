// The choreography every e2e session shares, whatever the browser behind it:
// cdp.mjs (headless Chrome over the DevTools Protocol), webkit.mjs
// (Playwright's WebKit — Safari's engine, E2E_BROWSER=webkit) and firefox.mjs
// (Firefox over WebDriver BiDi, E2E_BROWSER=firefox) each supply the
// primitives (navigate / evalJs / shot) and get the same waitFor and open back,
// so the drivers see the loading card and the opening notice handled
// identically in every browser. Change the page's start-up flow here, once.

/** Let the page paint: one animation frame, then `ms` more for whatever the
 * frame kicked off (a ResizeObserver, a scroll handler). Both backends build
 * their `settle` from this and expose it on the session as `s.settle(ms)`. */
/** "Checked with: course rules 3f9a2c1b (read live, …) · CSE Graduate Studies
 * Handbook (…) · app version fe64bda of …." — the stamp every result carries
 * (DGS 2026-10-11, item 8; src/ui/stamp.ts). The e2e runs a fresh build, so
 * the version is a real commit, possibly "with local changes". */
export const STAMP_RE = /course rules ([0-9a-f]{8}) \((?:read live|the copy saved in the app)[^)]*\) · CSE Graduate Studies Handbook \([^)]+\) · app version [0-9a-f]{7}(?: of [A-Z][a-z]+ \d{1,2}, \d{4})?(?: with local changes)?/;

export const settleIn = (evalJs) => (ms = 150) => evalJs(`new Promise(r => requestAnimationFrame(() => setTimeout(r, ${ms})))`);

// Once per RUN, not per session: every driver opens its own session, and the
// loading-failed and consent-gate screenshots are the same picture each time.
let failureShotTaken = false;
let consentShotTaken = false;

export function sessionHelpers({ navigate, evalJs, shot }) {
  const waitFor = async (expression, timeoutMs = 20000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      if (await evalJs(`!!(${expression})`)) return;
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error('timeout waiting for: ' + expression);
  };

  // Navigate and get past the loading card. In a sandbox without network the
  // live fetch fails at once and the card offers "Continue with the copy saved
  // on …" — the harness screenshots that card (once) and clicks it, so the
  // failure path is exercised on every run. With network, the live rules load
  // and the masthead appears by itself.
  const open = async (url, readySelector = '.masthead h1') => {
    await navigate(url);
    // The live rules come from Google at start-up: allow a slow network a full
    // minute before calling the load a failure (two drivers timed out at 20 s on
    // 2026-09-06 with nothing wrong in the page).
    await waitFor(`document.querySelector('${readySelector}') || document.querySelector('.load-card.failed')`, 60000);
    if (await evalJs(`!!document.querySelector('.load-card.failed')`)) {
      const text = await evalJs(`document.querySelector('.load-fail')?.textContent`);
      if (!/[Rr]eload the page/.test(text ?? '')) throw new Error('failure card must suggest reloading: ' + text);
      if (!failureShotTaken) {
        await shot('loading-failed');
        failureShotTaken = true;
      }
      await evalJs(`document.querySelector('.load-card.failed button.use-saved').click()`);
      await waitFor(`document.querySelector('${readySelector}')`);
    }
    // Department-approval gate (2026-09-03): screenshot the first one, then
    // Agree so the scripts can click the page beneath.
    if (await evalJs(`!!document.querySelector('.consent-overlay')`)) {
      if (!consentShotTaken) {
        await shot('consent-gate');
        consentShotTaken = true;
      }
      // The notice carries the program choice since 2026-09-18 (blue-team B2):
      // for a record this browser has never seen, nothing is pre-selected and
      // "Continue" stays inactive until the student answers and ticks the
      // acknowledgement inside the notice (2026-09-29), so
      // the drivers answer it the way a Ph.D. student would. A returning record
      // arrives pre-selected and the button is live from the start.
      // The earlier-degrees questions (2026-09-22) are answered the way the
      // transcript driver needs: a bachelor's elsewhere and graduate study
      // elsewhere at a different university — every previous row shows.
      await evalJs(`(() => {
        const btn = document.querySelector('.consent-overlay button.btn');
        // The acknowledgement first (2026-09-29): a returning record arrives
        // with its answers pre-selected, and the button is live as soon as the
        // notice is ticked — answering the questions again here would REPLACE
        // the saved program with the Ph.D. (which is how the MSCSE checks broke
        // the day the tick arrived).
        const ack = document.querySelector('[data-key="consent.ack"]');
        if (ack && !ack.checked) ack.click();
        if (btn.hasAttribute('disabled')) document.querySelector('[data-key="consent.program.phd"]').click();
        btn.click();
      })()`);
      await waitFor(`!document.querySelector('.consent-overlay')`);
      // The earlier-degrees questions are on the page since 2026-10-08 (DGS,
      // Option 1): answered as before — a bachelor's elsewhere and a finished
      // degree elsewhere at another university, so every previous row shows.
      // One click per render: each answer re-renders the questions.
      // Then Done: the questions stay open, saved, until it (2026-10-08).
      await evalJs(`document.querySelector('[data-key="earlier.answer"]')?.click()`); // a fresh record folds the questions (UI review item 2, 2026-10-09)
      for (const k of ['earlier.bachelors.elsewhere', 'earlier.graduate.elsewhere', 'earlier.sameplace.no', 'earlier.finished.yes', 'earlier.done']) {
        await evalJs(`document.querySelector('[data-key="${k}"]')?.click()`);
      }
    }
  };

  return { waitFor, open };
}
