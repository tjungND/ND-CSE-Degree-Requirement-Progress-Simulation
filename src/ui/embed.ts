// Embed mode — the pages rendered to sit INSIDE someone else's page.
//
// Why it exists: the department's WordPress site (sites.nd.edu, ND Blogs) can
// only put this app on a page through an [iframe …] shortcode — a Custom HTML
// block is stripped, because WordPress multisite withholds `unfiltered_html`
// from site administrators and KSES removes <iframe>, <script> and <style>
// from post content (tested on the live site, 2026-09-16). So the host page
// already carries the ND header, the page title and the site's own chrome, and
// the framed page must not repeat them.
//
// Turned on by an explicit `?embed=1` (or `#embed`) — never by sniffing
// `window.self !== window.top`, so the mode can be opened, linked and tested
// directly in a browser with no frame around it at all.
//
// Two pages, two treatments, and the difference is deliberate:
//
//   courses.html — a DOCUMENT. It broadcasts its height to the parent
//     (startHeightBroadcast below) so the frame grows to fit and there is no
//     inner scrollbar and no trailing white space.
//
//   index.html — an APP. Since 2026-09-16 (DGS: "remove the scroll just like
//     in the course rule page embed") it broadcasts its height too. An
//     auto-sized frame is exactly as tall as its content, so `position: fixed`
//     resolves against a viewport the size of the whole document — which is
//     why, in embed mode, the three dialogs are placed at the top of the
//     document (the opening notice) or beside the control that opened them
//     (`placeInFrame`), the toasts appear next to the student's last
//     interaction (`lastInteractionTop`), and the sticky score bar is hidden.
import { el } from './dom.ts';

/** Message types and DOM event names — namespaced, so nothing else on a host page collides. */
export const HEIGHT_MESSAGE = 'nd-cse-audit:height';
/** "Scroll your window so this many pixels down my page is in view."
 *
 * A frame sized to its own content cannot scroll, so every `#CSE-60641` link on
 * the page — the overview chips, the schedule cards, the skip link — is a dead
 * click inside the embed, and a cross-origin frame is not allowed to scroll its
 * parent itself. This asks the parent to do it. It is the one optional half of
 * the protocol: a host that ignores it just leaves those links as no-ops, which
 * is what they would have been anyway. */
export const SCROLL_MESSAGE = 'nd-cse-audit:scrollto';

/** Which parent origins may be told this page's height (DGS 2026-09-16).
 *
 * `postMessage` needs an explicit targetOrigin — never '*', which would hand
 * the message to whatever page happened to frame us. The payload is only a
 * number, but the allowlist is what stops an unrelated site from framing the
 * app and receiving anything at all. sites.nd.edu is where the page is
 * embedded today; cse.nd.edu and www.nd.edu are the other two ND hosts this
 * app was always meant to be embeddable on (CLAUDE.md, "Static deployment").
 *
 * The matching check on the WordPress side — `e.origin !== 'https://tjungnd.github.io'`
 * — is in README.md § "Embedding these pages in a WordPress page". */
export const EMBED_PARENT_ORIGINS: readonly string[] = ['https://sites.nd.edu', 'https://cse.nd.edu', 'https://www.nd.edu'];

/** A layout bug must not be able to ask for an absurd frame — but the cap has
 * to sit above what the page legitimately measures, because the parent trusts
 * this number and the frame does not scroll: anything past the cap is content
 * the reader can never reach.
 *
 * Measured 2026-09-16, 117 courses: 12,985 px at the 1082 px sites.nd.edu
 * content column (the table), and 42,290 px at 700 px, where the table becomes
 * one card per course. The first draft's 20,000 truncated the narrow case at
 * less than half the list.
 *
 * 100,000 looked like twice the worst case and was not (review R-13,
 * 2026-09-18): with "Include retired courses" ticked the same 700 px frame
 * measures ~96,000 px for all 321 rows, four per cent under the cap — and the
 * sheet grows every year. 250,000 restores the headroom the number was chosen
 * for while staying unmistakably "the layout is broken" rather than "this page
 * is long"; a frame that tall would need a reader to scroll the host page for
 * about two minutes. */
export const MAX_EMBED_HEIGHT = 250000;

/** Height changes smaller than this are noise — a sub-pixel reflow, a focus
 * ring, a scrollbar appearing — and are not worth a message. */
const MIN_HEIGHT_CHANGE = 8;

// ---------- pure helpers (no DOM — these are what tests/embed.test.ts covers) ----------

/** Is embed mode asked for by this URL? `?embed=1` is the documented form;
 * `#embed` is accepted too, because a WordPress editor can paste a fragment
 * into a link where a query string would be re-encoded. Anything else — including
 * `?embed=0` and `?embed=true` — is not embed mode: one spelling, so a link that
 * looks like it turns embedding on either does or plainly does not. */
export function isEmbedRequested(search: string, hash: string): boolean {
  try {
    if (new URLSearchParams(search).get('embed') === '1') return true;
  } catch {
    /* a malformed query string is simply not a request for embed mode */
  }
  return hash === '#embed';
}

/** The height to report, or undefined when there is nothing sensible to say.
 * Clamped rather than dropped at the top end so a very long course list still
 * reports something the parent can use. */
export function clampEmbedHeight(raw: number): number | undefined {
  if (!Number.isFinite(raw) || raw <= 0) return undefined;
  return Math.min(MAX_EMBED_HEIGHT, Math.ceil(raw));
}

/** The same page, outside the frame: every query parameter kept except the one
 * that turns embed mode on, so "Open the full page" lands on what the reader is
 * actually looking at — their filters, their sort, their view. */
export function fullPageHref(pathname: string, search: string, hash: string): string {
  let qs = '';
  try {
    const params = new URLSearchParams(search);
    params.delete('embed');
    qs = params.toString();
  } catch {
    /* unparseable — fall back to the bare page */
  }
  return `${pathname}${qs ? `?${qs}` : ''}${hash === '#embed' ? '' : hash}`;
}

// ---------- the mode itself ----------

let embedded: boolean | undefined;

/** Whether this page is running in embed mode. Read once: the URL is rewritten
 * as the reader changes filters (courses-page.ts `filtersToUrl`), and the mode
 * must not be able to switch itself off half-way through a session. */
export function isEmbedded(): boolean {
  if (embedded === undefined) {
    try {
      embedded = isEmbedRequested(window.location.search, window.location.hash);
    } catch {
      embedded = false;
    }
  }
  return embedded;
}

/** Put the mode on <html> before anything renders, so the stylesheet's
 * `html.embed …` rules apply to the loading card too and the frame never
 * flashes the full-page chrome first. */
export function markEmbedMode(): void {
  if (isEmbedded()) document.documentElement.classList.add('embed');
}

/** "Open the full page ↗" — the way out of the frame.
 *
 * The href is re-read on every interaction because the filters live in the URL
 * and change as the reader types; freezing it at render time would send them
 * back to an unfiltered page. */
export function openFullPageLink(label = 'Open the full page'): HTMLAnchorElement {
  const here = (): string => {
    try {
      return fullPageHref(window.location.pathname, window.location.search, window.location.hash);
    } catch {
      return './';
    }
  };
  const a = el('a', { class: 'embed-exit', href: here(), target: '_top', rel: 'noopener' }, label, ' ↗');
  const refresh = () => {
    a.href = here();
  };
  for (const ev of ['pointerdown', 'touchstart', 'focus', 'click']) a.addEventListener(ev, refresh);
  return a;
}

// ---------- height broadcast (courses.html only — see the note at the top) ----------

let lastHeight = 0;
let pending = false;

/** The height to tell the parent about.
 *
 * The border box of <html> — deliberately NOT `scrollHeight`. Once the parent
 * has sized the frame to H, the document's scrollHeight can never fall below
 * the viewport, so a frame sized from it could only ever grow: filtering the
 * table down to three rows would leave thousands of pixels of white space that
 * nothing could reclaim. `getBoundingClientRect()` on an auto-height <html>
 * measures the content, and shrinks with it. */
function measuredHeight(): number {
  return document.documentElement.getBoundingClientRect().height;
}

/** Post one plain, serializable object to every allowed parent origin. A
 * `postMessage` whose targetOrigin does not match the parent is dropped by the
 * browser and never delivered, so naming all three costs one call each and
 * tells nobody anything. */
function post(message: Record<string, unknown>): void {
  if (window.parent === window) return; // opened directly, not framed
  for (const origin of EMBED_PARENT_ORIGINS) {
    try {
      window.parent.postMessage(message, origin);
    } catch {
      /* the parent is gone — the next change tries again */
    }
  }
}

function send(): void {
  const height = clampEmbedHeight(measuredHeight());
  if (height === undefined) return;
  if (Math.abs(height - lastHeight) < MIN_HEIGHT_CHANGE) return;
  lastHeight = height;
  // Also announced in this document, so the height can be watched without a
  // parent frame at all — that is what the e2e test asserts on, and what to
  // put a breakpoint on when the WordPress side is not resizing.
  try {
    document.dispatchEvent(new CustomEvent(HEIGHT_MESSAGE, { detail: { height } }));
  } catch {
    /* ignore */
  }
  post({ type: HEIGHT_MESSAGE, height });
}

/** Where the student last acted, in document coordinates — the only place a
 * pop-up can appear that is certain to be on screen in a frame the page cannot
 * scroll (the parent's viewport is invisible to a cross-origin frame). */
let lastInteractionTopPx = 0;
export function trackInteractions(): void {
  if (!isEmbedded()) return;
  const note = (ev: Event) => {
    const t = ev.target;
    if (!(t instanceof Element)) return;
    const r = t.getBoundingClientRect();
    if (r.height === 0 && r.width === 0) return;
    lastInteractionTopPx = Math.max(0, Math.round(r.top + window.scrollY));
  };
  document.addEventListener('pointerdown', note, true);
  document.addEventListener('focusin', note, true);
  document.addEventListener('change', note, true);
}
export function lastInteractionTop(): number {
  return lastInteractionTopPx;
}

/** Position a modal <dialog> for a content-height frame: at the top of the
 * document, or just above `anchor` (the control that opened it). Does nothing
 * when the page is not embedded — the dialog then centres itself as usual. */
export function placeInFrame(dialog: HTMLElement, anchor?: Element | null): void {
  if (!isEmbedded()) return;
  let top = 16;
  if (anchor) {
    const r = anchor.getBoundingClientRect();
    top = Math.max(16, Math.round(r.top + window.scrollY) - 60);
  }
  dialog.classList.add('in-frame');
  dialog.style.top = `${top}px`;
}

/** Ask the parent to bring `target` into view — the same message a click on an
 * in-page link sends, for the case where nobody clicked: a link someone was
 * sent, opened cold at `#CSE-60641` (review B-7, 2026-09-18). Does nothing
 * outside embed mode, where the page can simply scroll itself. */
export function postScrollTo(target: Element): void {
  if (!isEmbedded()) return;
  const raw = target.getBoundingClientRect().top + window.scrollY;
  if (!Number.isFinite(raw)) return;
  post({ type: SCROLL_MESSAGE, offset: clampOffset(raw) });
}

/** Clamped the same way a height is, and never negative: the parent is being
 * asked for a position inside this page, not for an arbitrary scroll. */
function clampOffset(raw: number): number {
  return Math.min(MAX_EMBED_HEIGHT, Math.max(0, Math.round(raw)));
}

/** Make this page's own `#…` links work inside a frame that cannot scroll.
 *
 * One delegated listener rather than a handler per anchor, so links added to
 * the page later are covered without anyone remembering to. The default action
 * is left alone: it still sets `:target` and moves focus, it simply has nothing
 * to scroll. */
export function startAnchorScrollRelay(root: HTMLElement): void {
  if (!isEmbedded()) return;
  root.addEventListener('click', (ev) => {
    const link = (ev.target as Element | null)?.closest?.('a[href^="#"]');
    if (!(link instanceof HTMLAnchorElement)) return;
    const id = link.getAttribute('href')?.slice(1);
    if (!id) return;
    let target: Element | null = null;
    try {
      target = document.getElementById(decodeURIComponent(id));
    } catch {
      target = document.getElementById(id);
    }
    if (!target) return;
    const raw = target.getBoundingClientRect().top + window.scrollY;
    if (!Number.isFinite(raw)) return;
    post({ type: SCROLL_MESSAGE, offset: clampOffset(raw) });
  });
}

/** Ask for a height message. Coalesced: a re-render can move the page's height
 * a dozen times in a single tick, and the parent only needs the last one.
 *
 * Both a frame callback AND a timer, deliberately. `requestAnimationFrame` is
 * the right clock when the page is on screen — one message per painted frame —
 * but it does not run AT ALL in a hidden tab, and browsers throttle it hard for
 * a cross-origin frame that is scrolled out of view. A WordPress page opened in
 * a background tab is exactly that case, and with rAF alone the frame never
 * received a height, never resized, and `pending` stayed latched so no later
 * change was reported either (measured in a hidden tab, 2026-09-16). Layout is
 * still computed while hidden, so the timer's measurement is correct. */
export function notifyEmbedHeight(): void {
  if (!isEmbedded() || pending) return;
  pending = true;
  let ran = false;
  const run = () => {
    if (ran) return; // whichever clock arrives first wins
    ran = true;
    pending = false;
    send();
  };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
  setTimeout(run, 100);
}

/** Start telling the parent how tall this page is. Safe to call when the page
 * is not embedded and when it is not framed — it simply does nothing. */
export function startHeightBroadcast(): void {
  if (!isEmbedded()) return;
  if (typeof ResizeObserver === 'function') {
    try {
      new ResizeObserver(notifyEmbedHeight).observe(document.documentElement);
    } catch {
      /* no observer — the listeners below still cover the big changes */
    }
  }
  window.addEventListener('load', notifyEmbedHeight);
  window.addEventListener('resize', notifyEmbedHeight);
  // Coming back to a backgrounded tab: re-measure rather than trust a height
  // taken while nothing was painting.
  document.addEventListener('visibilitychange', notifyEmbedHeight);
  // <details> does not bubble its `toggle`, so listen in the capture phase:
  // opening "How to read the columns" is a height change like any other.
  document.addEventListener('toggle', notifyEmbedHeight, true);
  // The rules fetch takes up to 15 s and the page triples in height when it
  // lands; these catch the settling that no event reports.
  for (const ms of [0, 250, 1000, 3000]) setTimeout(notifyEmbedHeight, ms);
}
