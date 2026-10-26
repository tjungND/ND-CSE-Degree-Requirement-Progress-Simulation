---
name: run-app
description: Launch, drive, and screenshot the degree-audit app. Use when asked to run/preview the app, verify a UI change in a real browser (Chrome, Safari's engine or Firefox), take screenshots, or exercise the transcript-upload flow end to end.
---

# Running and driving the degree-audit app

## Quick reference

| Goal | Command |
|---|---|
| Live-reload dev server | `npm run dev` → http://localhost:5173 |
| Serve the production build | `npm run build && npm run preview` → http://localhost:4173 |
| Full browser e2e in Chrome (screenshots + assertions) | `npm run e2e` → screenshots in `.e2e-out/` |
| The same e2e on Safari's engine (WebKit) | `E2E_BROWSER=webkit npm run e2e` (= `npm run e2e:webkit`) → `.e2e-out/webkit/` |
| One-time WebKit setup per Mac | `npx playwright-core install webkit` (≈100 MB, into `~/Library/Caches/ms-playwright/`) |
| The same e2e on Firefox (Gecko) | `E2E_BROWSER=firefox npm run e2e` (= `npm run e2e:firefox`) → `.e2e-out/firefox/` — the installed Firefox, no setup |
| The same e2e in Opera | `E2E_BROWSER=opera npm run e2e` (= `npm run e2e:opera`) → `.e2e-out/opera/` — the installed Opera, headless; `E2E_HEADED=1` for its real window; `E2E_BLINK_PREFS='<json>'` to start it with a setting on (Force dark pages: see `scripts/e2e/run.mjs`) |
| The same e2e in REAL Safari | `E2E_BROWSER=safari npm run e2e` (= `npm run e2e:safari`) → `.e2e-out/safari/` — needs Safari → Settings → Developer → "Allow remote automation" once, an unlocked screen, and its window left alone |
| Two runs side by side | `E2E_PORT=<port>` (preview server, default 4273) and `E2E_DEBUG_PORT=<port>` (Chrome's DevTools port, default 9333) |
| One driver only, while iterating | `E2E_ONLY=<substring of the driver name> npm run e2e` (e.g. `E2E_ONLY=access`) |
| Unit/scenario tests (no browser) | `npm test` |

Run ALL THREE browsers for anything that changes layout (Firefox since 2026-10-10, when its
always-drawn number spinner was found covering the last digit of the year box): on 2026-09-06 Chrome rendered a CSS
subgrid that Safari broke (cells overlapping, a row overflowing its card), and the same evening
the first WebKit run found the one-line preview rows keyed on a 600 px preview when the recorded
decision said 560 — an 1100 px window (preview 582 px) showed two-line rows in both engines.

## The e2e harness (`scripts/e2e/`)

`npm run e2e` builds if `dist/` is missing, serves it with `vite preview` on **port 4273**, then:

- **Chrome (default)** — launches headless Chrome with `--remote-debugging-port=9333` and drives
  it over the raw DevTools Protocol (`scripts/e2e/cdp.mjs` — no Playwright/puppeteer needed;
  node ≥ 22's global WebSocket is enough). Chrome discovery: `CHROME_BIN` env var, else the
  standard macOS/Linux paths (`findChrome()` in `run.mjs`); on CI use `CHROME_BIN=$(which google-chrome)`.
- **WebKit (`E2E_BROWSER=webkit`)** — launches Playwright's WebKit build (Safari's engine)
  through `playwright-core`: a devDependency pinned to an EXACT version (each version maps to one
  WebKit build — bump the pin, then run the install command again) and imported lazily, so the
  Chrome run and CI never load it. `scripts/e2e/webkit.mjs` wraps a Playwright page in the SAME
  session shape the drivers use and translates the few DevTools commands they call directly
  (`Page.navigate`; `Emulation.setDeviceMetricsOverride` → the viewport size only;
  `Emulation.setEmulatedMedia` → print media, or the device's light/dark setting as Playwright's
  `colorScheme` (2026-10-25; the Firefox and Safari wrappers refuse the latter);
  `Input.dispatchKeyEvent` → `page.keyboard`); an untranslated command throws on purpose — add it there.
- **Firefox (`E2E_BROWSER=firefox`, 2026-10-10)** — the INSTALLED Firefox (`FIREFOX_BIN` overrides
  the path), headless, from a throwaway profile in the temp folder (deleted at the end; its
  `user.js` turns off updates, telemetry and first-run pages, keeps downloads inside it and
  reports a light device). `scripts/e2e/firefox.mjs` speaks WebDriver BiDi — Firefox's own remote
  protocol — over Node's built-in WebSocket: no geckodriver, no dependency. Same session shape,
  same translated commands; print media is emulated by swapping `print` and `screen` in the
  page's own media queries through the CSSOM (BiDi has no media emulation), so
  `matchMedia('print')` still answers false. A native alert/confirm is dismissed and logged.
- **Real Safari (`E2E_BROWSER=safari`, 2026-10-10)** — `scripts/e2e/safari.mjs` starts
  `safaridriver` (part of macOS) and drives Safari's automation window over classic WebDriver:
  one session, a tab per driver, `evalJs` as an indirect eval in Execute Async Script, print
  media swapped as for Firefox, a file input given its path by Element Send Keys (a DataTransfer
  fallback). Not headless; the screen must be unlocked and the window visible (the run checks that
  Safari draws frames and stops at once if not); 336 px is Safari's narrowest window; one Safari
  run at a time (default port 4444, `E2E_DEBUG_PORT` moves it).
  Edge, Opera and Brave are Chromium (the Chrome run is their engine); every iOS browser is
  WebKit. Real Safari can be scripted only after `safaridriver --enable` (an admin password,
  once per Mac) — the harness does not use it.

The start-up choreography all three share — `waitFor`, the loading card, the opening notice — lives
in `scripts/e2e/session-common.mjs`; change the page's start-up flow there, once. Four drivers,
each in a fresh tab, in this order:

- `drive-app.mjs` — initial Ph.D. report, a mid-degree record loaded as a saved file (`example-record.mjs`; "Load example" was removed on 2026-10-17), the § chip's handbook quote, the M.S.
  tab, the rules-spreadsheet links; `driveCourses` (same file) — the public course-rules page:
  filters, the Notes disclosure, filters in the URL.
- `drive-transcript.mjs` — uploads `tests/fixtures/other-transcript.pdf` (must be REJECTED with
  the "Only ND's unofficial transcript…" message), then `tests/fixtures/nd-transcript.pdf`
  (a combined B.S.+Ph.D. record: entry term, prior coursework, GPA), then the previous-transcript
  slots: `external-transcript.pdf` (Master's), the scanned `external-transcript-scan.pdf`
  (Bachelor's, real OCR), `banner-transcript.pdf` (Ph.D.: a two-column Banner official transcript
  read column by column; 10 rows, transfer-credit note) and `banner-watermarked-transcript.pdf`
  (the same under a tiled + diagonal text watermark; must read identically),
  `combined-transcript.pdf` (B.S.+M.S. in the Master's slot — where `checkCompactPreview`
  measures the one-line rows at 1400 and 1100 px and crops the preview to
  `combined-preview-1400.png` / `-1100.png`), the ND PDF in the Ph.D. slot, and ND Remove + Undo.
  Since 2026-10-10 the OCR leg also checks the scanned-line strip of each ⚠ row (a drawn canvas,
  gone after Add; crops `external-ocr-strip.png` and `phone-external-ocr-strip.png` at 390 px), and
  a fresh record imports `codeless-transcript.pdf` (no course numbers: empty required id boxes,
  Add refused until an id is typed; `codeless-preview.png`, `codeless-preview-filled.png`).
  Fixture PDFs are regenerated by `node tests/fixtures/make-transcript-pdfs.mjs`.
- `drive-a11y.mjs` — the opening dialog's focus trap, focus preserved across re-renders, axe-core
  with zero violations on both pages, phone (390 px) and tablet (820 px) layouts with no sideways
  scrolling (`phone-*.png`, `tablet-*.png`).

## One-off driving / custom screenshots

Reuse the helpers instead of writing a new driver — the session shape is the same in both browsers:

```js
import { openSession } from './scripts/e2e/cdp.mjs';
const s = await openSession(9333, '.e2e-out');       // Chrome must be up (see run.mjs)
await s.open('http://localhost:4273/');              // past the loading card and the opening notice
await (await import('./scripts/e2e/example-record.mjs')).loadExampleRecord(s, 'phd'); // a mid-degree Ph.D. record, through "Load a file"
await s.shot('my-check');                            // .e2e-out/my-check.png — the whole 1400×1900 frame
await s.shotElement('my-card', '.external-card .transcript-preview'); // one element, cropped
await s.setFileInput('.transcript-upload input[type=file]', '/abs/path/to.pdf');
await s.send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 1900, deviceScaleFactor: 1, mobile: false });
```

On WebKit: `const { launchWebkit, openWebkitSession } = await import('./scripts/e2e/webkit.mjs');`
`const browser = await launchWebkit();` then
`const s = await openWebkitSession(await browser.newContext({ viewport: { width: 1400, height: 1900 } }), '.e2e-out/webkit');`
— and the same calls as above; `await browser.close()` at the end.

Look at the screenshots you take — a blank frame means the page didn't render.

## Gotchas

- Ports in use: `lsof -ti:4173,4273 -sTCP:LISTEN | xargs kill` frees stuck servers;
  `pkill -f remote-debugging-port` clears an orphaned headless Chrome.
- "Playwright's WebKit build is not on this machine yet": run `npx playwright-core install webkit`
  once (the harness prints that same line). The build lives outside the repo and is shared by
  every worktree; a fresh `npm ci` installs `playwright-core` but never the browser.
- The WebKit run ignores Chrome's `mobile` emulation flag (Playwright has no per-page
  equivalent); the app's breakpoints are width-only, so the phone/tablet checks measure the same thing.
- The app fetches the LIVE Google Sheet on load; with no network it falls back to
  `data/snapshot.json` — since 2026-09-01 not automatically: the loading card fails and offers
  "Continue with the copy saved on …", which the e2e harness clicks for you (screenshotting it
  as `loading-failed.png` first). That's expected, not a bug.
- Student state persists in localStorage per origin; drivers call `localStorage.clear()` and
  reload to get a clean slate.
- Each browser clears only its own screenshots (`.e2e-out/*.png` vs `.e2e-out/webkit/` and
  `.e2e-out/firefox/`), so the runs can be compared side by side. A Chrome run with `E2E_ONLY`
  still clears ALL the top-level Chrome PNGs — run the full suite again before comparing.
- Firefox picks a free BiDi port itself (`E2E_DEBUG_PORT=0`, its default here) and prints it.
- A run refuses to start when its preview port (or Chrome's DevTools port) already answers —
  another run is using it; set `E2E_PORT` / `E2E_DEBUG_PORT`, or free the port (above).
- `npx` misbehaves if any parent folder name ever contains a colon — see MAINTENANCE.md.
