// The CSE handbook's own words behind a section chip (DGS 2026-10-05: "when
// the cursor hovers over the section of CSE handbook in these screenshots,
// show its relevant texts" — the "CSE §4.2" beside a card heading on the
// self-check page, and "CSE §4.4", "§4.4.1", "§4.4.2" on the course rules
// page).
//
// The chip is a button. Hovering shows the text in a panel under it (moving
// into the panel keeps it open, so a long section can be scrolled); clicking,
// tapping or pressing Enter keeps it open until Escape or a click elsewhere,
// and from the keyboard moves focus into it. The text is generated from the
// handbook PDF by `npm run handbook-text`, never typed by hand, so it is the
// edition in policy-sources/. Since W2 (blue-team review 2026-10-17, done
// 2026-10-22) the words themselves are NOT in the page's JavaScript: the
// bundle carries only the section ids and titles (src/ui/handbook-text.ts),
// and the paragraphs (public/handbook-text.json, ~50 KB) are fetched from this
// site the first time any chip is hovered, focused or pressed — most visits
// never open one, and every visit used to download all of it.
import { el } from './dom.ts';
import { handbookLink } from './handbook.ts';
import { HANDBOOK_INDEX, HANDBOOK_SOURCE, type HandbookSection, type HandbookText } from './handbook-text.ts';

/** A section as the chips know it before the text is fetched: id and title. */
export interface HandbookIndexEntry {
  id: string;
  title: string;
}

/** "§2.3, §4.4–4.7" → the sections it names, in the handbook's order: a single
 * number takes the section with its subsections (§4.4 is §4.4–§4.4.3), a range
 * every section from its first number through the last. Numbers the handbook
 * does not have are skipped. */
export function sectionsFor(ref: string): HandbookIndexEntry[] {
  const ids = HANDBOOK_INDEX.map((s) => s.id);
  const within = (id: string, head: string) => id === head || id.startsWith(`${head}.`);
  const picked = new Set<number>();
  for (const part of ref.split(',')) {
    const m = /(\d+(?:\.\d+)*)(?:\s*[–-]\s*(\d+(?:\.\d+)*))?/.exec(part);
    if (!m) continue;
    const start = ids.indexOf(m[1]!);
    if (start < 0) continue;
    const last = m[2] ?? m[1]!;
    let end = start;
    ids.forEach((id, i) => {
      if (i >= start && within(id, last)) end = i;
    });
    for (let i = start; i <= end; i++) picked.add(i);
  }
  return [...picked].sort((a, b) => a - b).map((i) => HANDBOOK_INDEX[i]!);
}

/** Where the handbook's text is served: beside index.html and courses.html
 * (public/handbook-text.json is copied into dist/ as-is by the build, and the
 * dev server serves public/ at the root). Relative to the page, so it works
 * under a GitHub Pages project path, on a plain host and inside an iframe. */
export const HANDBOOK_TEXT_PATH = 'handbook-text.json';

let textPromise: Promise<readonly HandbookSection[]> | undefined;

/** The handbook's sections with their paragraphs, fetched once per page the
 * first time a chip wants them; later calls share the answer. A FAILED fetch
 * is forgotten, so the next hover simply asks again — unlike a dynamic
 * `import()`, which the browser remembers as failed for the life of the page
 * (the 2026-10-07 lazy-reader lesson, docs/CLAUDE-HANDOFF.md). The file must
 * be from the same handbook edition the bundle's stamp names: the chips never
 * show one edition's words under another's name (a tab left open across a
 * deploy that changed the handbook reads the failure line, and a reload
 * fixes it). `fetchImpl` is for the tests. */
export function handbookText(fetchImpl: typeof fetch = fetch): Promise<readonly HandbookSection[]> {
  textPromise ??= fetchImpl(typeof document !== 'undefined' ? new URL(HANDBOOK_TEXT_PATH, document.baseURI).href : HANDBOOK_TEXT_PATH, { credentials: 'omit' })
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${HANDBOOK_TEXT_PATH}`);
      return res.json() as Promise<HandbookText>;
    })
    .then((text) => {
      if (!text || !Array.isArray(text.sections)) throw new Error(`${HANDBOOK_TEXT_PATH} is not the handbook text`);
      if (text.sha256 !== HANDBOOK_SOURCE.sha256) throw new Error(`${HANDBOOK_TEXT_PATH} is from another handbook edition — run npm run handbook-text`);
      return text.sections;
    })
    .catch((e: unknown) => {
      textPromise = undefined;
      throw e;
    });
  return textPromise;
}

let counter = 0;

/** A section chip that shows the handbook's text for `ref` ("§4.2"). Falls back
 * to the plain chip when the handbook has no such section. `className` keeps
 * the chip's look on its page; `dataKey` lets the focus keeper find it again
 * after a re-render. */
export function sectionRef(ref: string, opts: { className: string; dataKey: string }): HTMLElement {
  const sections = sectionsFor(ref);
  if (sections.length === 0) return el('span', { class: opts.className }, ref);
  const id = `sec-pop-${++counter}`;
  const chip = el(
    'button',
    {
      type: 'button',
      class: `${opts.className} sec-ref`,
      'data-key': opts.dataKey,
      'aria-expanded': 'false',
      'aria-controls': id,
      title: 'Show the handbook’s text',
    },
    ref,
  ) as HTMLButtonElement;

  let pop: HTMLElement | undefined;
  /** The panel's body: the one status line until the text arrives, then the
   * sections. */
  let body: HTMLElement | undefined;
  let filled = false;
  let pinned = false;
  let hoverTimer: number | undefined;
  let hideTimer: number | undefined;
  let listeners: AbortController | undefined;

  const build = (): HTMLElement => {
    body = el('div', { class: 'sec-pop-body' });
    const panel = el(
      'div',
      { class: 'sec-pop', id, role: 'region', 'aria-label': `CSE Graduate Studies Handbook ${ref}`, tabindex: '-1', hidden: true },
      body,
      el('p', { class: 'sec-pop-source' }, `From the CSE Graduate Studies Handbook${HANDBOOK_SOURCE.edition ? ` (${HANDBOOK_SOURCE.edition})` : ''}.`),
    );
    panel.addEventListener('mouseenter', () => window.clearTimeout(hideTimer));
    panel.addEventListener('mouseleave', scheduleHide);
    return panel;
  };

  /** Put the handbook's words into the panel once they are here; until then
   * one line says they are coming, and if they cannot come, one line says so
   * and links the handbook itself. Asked again on every open until it
   * succeeds (a failed fetch is forgotten, see handbookText). */
  const fill = (): void => {
    if (filled || !body) return;
    const target = body;
    target.replaceChildren(el('p', { class: 'sec-pop-status' }, 'Loading the handbook’s text…'));
    handbookText().then(
      (all) => {
        if (filled || target !== body) return;
        filled = true;
        const byId = new Map(all.map((s) => [s.id, s]));
        target.replaceChildren(
          ...sections.flatMap((s) => [el('p', { class: 'sec-pop-title' }, `§${s.id} ${s.title}`), ...(byId.get(s.id)?.paragraphs ?? []).map((p) => el('p', {}, p))]),
        );
        place();
      },
      () => {
        if (filled || target !== body) return;
        target.replaceChildren(el('p', { class: 'sec-pop-status' }, 'Could not load the handbook’s text — ', handbookLink('open the handbook'), '.'));
        place();
      },
    );
  };

  // Under the chip, or above it when there is more room there; inside the
  // window at any width (the 16 px side margin of the page).
  const place = (): void => {
    if (!pop || pop.hidden) return;
    const r = chip.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const width = Math.min(560, vw - 32);
    pop.style.width = `${width}px`;
    pop.style.left = `${Math.max(16, Math.min(r.left, vw - width - 16))}px`;
    const below = vh - r.bottom - 14;
    const above = r.top - 14;
    const wanted = Math.min(pop.scrollHeight, 480);
    if (below >= wanted || below >= above) {
      pop.style.top = `${r.bottom + 6}px`;
      pop.style.bottom = '';
      pop.style.maxHeight = `${Math.max(160, Math.min(480, below))}px`;
    } else {
      pop.style.top = '';
      pop.style.bottom = `${vh - r.top + 6}px`;
      pop.style.maxHeight = `${Math.max(160, Math.min(480, above))}px`;
    }
  };

  const open = (): void => {
    window.clearTimeout(hideTimer);
    pop ??= build();
    // After the heading in the document, so a screen reader meets the text
    // where the chip is; drawn over the page, so nothing below moves.
    if (!pop.isConnected) (chip.closest('h1, h2, h3, h4, h5, h6') ?? chip).after(pop);
    if (!pop.hidden) return;
    pop.hidden = false;
    chip.setAttribute('aria-expanded', 'true');
    fill();
    place();
    listeners?.abort();
    listeners = new AbortController();
    const signal = listeners.signal;
    document.addEventListener(
      'keydown',
      (e) => {
        if (e.key !== 'Escape') return;
        close();
        chip.focus();
      },
      { signal },
    );
    document.addEventListener(
      'pointerdown',
      (e) => {
        const t = e.target as Node;
        if (!chip.contains(t) && !pop?.contains(t)) close();
      },
      { signal },
    );
    window.addEventListener('scroll', place, { signal, passive: true, capture: true });
    window.addEventListener('resize', place, { signal });
  };

  const close = (): void => {
    window.clearTimeout(hideTimer);
    window.clearTimeout(hoverTimer);
    pinned = false;
    if (pop) pop.hidden = true;
    chip.setAttribute('aria-expanded', 'false');
    listeners?.abort();
    listeners = undefined;
  };

  function scheduleHide(): void {
    window.clearTimeout(hoverTimer);
    if (pinned) return;
    window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(close, 250);
  }

  // The first sign of interest starts the fetch, so the words are usually
  // here by the time the panel opens; the failure, if any, is reported by
  // `fill`, not here.
  const warm = (): void => {
    void handbookText().catch(() => undefined);
  };
  chip.addEventListener('focus', warm);
  // Hover: a short pause first, so passing over the heading does not flash it.
  chip.addEventListener('mouseenter', () => {
    warm();
    window.clearTimeout(hideTimer);
    hoverTimer = window.setTimeout(open, 120);
  });
  chip.addEventListener('mouseleave', scheduleHide);
  // Click, tap or Enter: keep it open; again: close. From the keyboard (a
  // click with no pointer), the text takes the focus, to be read or scrolled.
  chip.addEventListener('click', (e) => {
    window.clearTimeout(hoverTimer);
    if (pop && !pop.hidden && pinned) {
      close();
      return;
    }
    open();
    pinned = true;
    if ((e as MouseEvent).detail === 0) pop?.focus();
  });
  return chip;
}
