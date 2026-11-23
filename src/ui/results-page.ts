// "Print" downloads the results as a web page (DGS 2026-11-22: "When 'Print'
// is clicked, can you generate an HTML page instead of a PDF?" — and, asked
// where it goes and what it covers: "1. A download; 2. the results only.").
//
// The file is the page's own results, copied from what the page shows at the
// click: the standing in one sentence, the report column (the score, the
// warnings, Next steps and every requirement card, each "Relevant Policies"
// fold still opening and closing — on paper a folded section was left out)
// and the course tables of the Coursework card. Nothing the student types
// into: a tick box becomes ☑ or ☐, a dropdown the words it shows, and the
// buttons go. The page's stylesheets are written into the file, so it opens
// offline, years later, on any browser — in the reader's light or dark mode
// (the page's night colours are keyed on the theme switch, which the file has
// no script to run; they are copied under prefers-color-scheme instead).
//
// Built in the browser, like everything else: nothing is sent anywhere (the
// FERPA promise). The file holds grades, and its footer says so.
//
// Pure helpers first (tests/results-page.test.ts), then the DOM part, which
// the e2e checks (scripts/e2e/drive-app.mjs checkResultsPage). Loaded at the
// click, as the advisor summary is: the page's first load does not carry it.
import type { Program, Term } from '../engine/types.ts';
import { termShort } from '../engine/term.ts';
import { esc } from './email-html.ts';

/** cse-degree-audit-phd-2026-11-22-results.html — the record file's name
 * (state.ts selfCheckFileName, simulation.ts simulationFileName) with
 * "-results.html", so the two are told apart in a downloads folder and
 * "Load a file" is never handed the page. */
export function resultsFileName(program: Program, auditDate: string, simulationTerm?: Term): string {
  return simulationTerm ? `cse-degree-audit-${program}-simulation-${termShort(simulationTerm)}-results.html` : `cse-degree-audit-${program}-${auditDate}-results.html`;
}

/** The night colours' selector, keyed on the reader's device instead of the
 * page's theme switch: `:root[data-theme="dark"]` → `:root:not([data-theme="light"])`,
 * to sit inside `@media (prefers-color-scheme: dark)`. */
export function deviceDarkSelector(selector: string): string {
  return selector.replace(/\[data-theme=(["']?)dark\1\]/g, ':not([data-theme="light"])');
}

/** The part of a CSSOM rule this file reads — CSSStyleRule, CSSMediaRule,
 * CSSSupportsRule; anything else is copied as its text. */
export interface CssRuleLike {
  cssText: string;
  selectorText?: string;
  cssRules?: ArrayLike<CssRuleLike>;
}

/** Every rule that paints the night colours, re-keyed on the device
 * (deviceDarkSelector), inside the at-rules that held it. */
export function deviceDarkRules(rules: ArrayLike<CssRuleLike>): string[] {
  const out: string[] = [];
  for (const rule of Array.from(rules)) {
    if (rule.selectorText !== undefined) {
      if (/\[data-theme=(["']?)dark\1\]/.test(rule.selectorText) && rule.cssText.startsWith(rule.selectorText)) {
        out.push(deviceDarkSelector(rule.selectorText) + rule.cssText.slice(rule.selectorText.length));
      }
    } else if (rule.cssRules !== undefined) {
      const inner = deviceDarkRules(rule.cssRules);
      const head = rule.cssText.slice(0, rule.cssText.indexOf('{')).trim();
      if (inner.length > 0 && head.startsWith('@')) out.push(`${head} {\n${inner.join('\n')}\n}`);
    }
  }
  return out;
}

/** The stylesheet text the file carries: the page's rules as they are, then
 * the night colours again for a dark device. */
export function fileCss(sheets: readonly ArrayLike<CssRuleLike>[]): string {
  const all = sheets.flatMap((rules) => Array.from(rules).map((r) => r.cssText));
  const dark = sheets.flatMap((rules) => deviceDarkRules(rules));
  return [...all, ...(dark.length > 0 ? [`@media (prefers-color-scheme: dark) {\n${dark.join('\n')}\n}`] : [])].join('\n');
}

/** The file's own few rules: one centred column, the report column's
 * sticky placement undone, and the header and footer. */
export const RESULTS_PAGE_CSS = `
#app.results-file { max-width: 900px; }
.results-head { margin: 0 0 16px; }
.results-head h1 { font-size: 22px; margin: 0 0 8px; color: var(--navy); }
.results-head p { margin: 4px 0; }
.results-head .results-checked { color: var(--muted); font-size: 13px; }
.results-head .results-simulation { border: 2px solid var(--navy-fill); border-radius: 8px; padding: 8px 10px; font-weight: 700; }
.results-file .audit-col { position: static; max-height: none; overflow: visible; }
/* On a phone the page hides the report's own score, which its summary and
   sticky bar show instead; the file has neither, so it keeps it. */
.results-file .audit .scorehead { display: flex; }
.results-file .audit > .meters { display: block; }
.results-file .results-courses { margin-top: 18px; }
.results-file .results-courses > h2 { font-size: 18px; margin: 0 0 8px; color: var(--navy); }
.results-file .static-tick { font-weight: 700; }
.results-file .results-foot { margin-top: 18px; color: var(--muted); font-size: 13px; }
`;

/** The whole file: a complete page, nothing fetched. `bodyHtml` is markup
 * built from the page's own elements (serialised, so already escaped). */
export function resultsPageHtml(opts: { title: string; css: string; bodyHtml: string }): string {
  return (
    '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    `<title>${esc(opts.title)}</title>\n` +
    `<style>\n${opts.css.replace(/<\/style/gi, '<\\/style')}\n</style>\n` +
    `<style>${RESULTS_PAGE_CSS}</style>\n` +
    '</head>\n<body>\n' +
    `<div id="app" class="results-file">\n${opts.bodyHtml}\n</div>\n` +
    '</body>\n</html>\n'
  );
}

// ---------- the DOM part ----------

/** Turn a copy of part of the page into something to read: every control
 * becomes the words it shows, every button goes, the floating boxes stay in
 * place, and nothing keeps the page's focus or event hooks. `original` is the
 * element `copy` was cloned from — a clone keeps a dropdown's choice only
 * when the choice is in the markup, so each is read off the original. */
export function staticCopy(original: Element, copy: Element): void {
  const doc = copy.ownerDocument;
  const span = (cls: string, text: string): HTMLElement => {
    const s = doc.createElement('span');
    s.className = cls;
    s.textContent = text;
    return s;
  };
  // Dropdowns and boxes, read off the original (same document order).
  const origSelects = Array.from(original.querySelectorAll('select'));
  Array.from(copy.querySelectorAll('select')).forEach((sel, i) => {
    const o = origSelects[i];
    const chosen = o !== undefined && o.value !== '' ? (o.selectedOptions[0]?.textContent ?? '').trim() : '';
    // A dropdown named only for a screen reader (the specialization group's)
    // says what it is, or its choice would stand alone.
    const labelled = sel.closest('label') !== null || (sel.id !== '' && copy.querySelector(`label[for="${sel.id}"]`) !== null);
    const name = labelled ? '' : (sel.getAttribute('aria-label') ?? '').trim();
    sel.replaceWith(span('static-choice', `${name ? `${name}: ` : ''}${chosen || '—'}`));
  });
  const origInputs = Array.from(original.querySelectorAll('input'));
  Array.from(copy.querySelectorAll('input')).forEach((inp, i) => {
    const o = origInputs[i];
    if (inp.type === 'checkbox' || inp.type === 'radio') inp.replaceWith(span('static-tick', o?.checked ? '☑' : '☐'));
    else if (inp.type === 'hidden' || inp.type === 'file') inp.remove();
    else inp.replaceWith(span('static-choice', (o?.value ?? '').trim() || '—'));
  });
  const origAreas = Array.from(original.querySelectorAll('textarea'));
  Array.from(copy.querySelectorAll('textarea')).forEach((t, i) => t.replaceWith(span('static-choice', (origAreas[i]?.value ?? '').trim() || '—')));
  // A section chip keeps its words; its hover panel (fetched handbook text) goes.
  copy.querySelectorAll('.sec-pop').forEach((n) => n.remove());
  copy.querySelectorAll('button.sec-ref').forEach((b) => b.replaceWith(span((b.getAttribute('class') ?? '').replace(/\bsec-ref\b/, '').trim(), b.textContent ?? '')));
  // Everything else that only works on the live page.
  copy.querySelectorAll('button, script, style, template, dialog, .jump-link, .skip-link, .req-problem').forEach((n) => n.remove());
  // The two floating boxes stay where they stand in the report, open.
  for (const n of Array.from(copy.querySelectorAll('.floating, .folded, .next-step-ring, .feeds-hidden'))) n.classList.remove('floating', 'folded', 'next-step-ring', 'feeds-hidden');
  // The course tables' Remove column.
  copy.querySelectorAll('td.cell-remove').forEach((n) => n.remove());
  copy.querySelectorAll('th').forEach((th) => {
    if ((th.textContent ?? '').trim() === 'Remove' && th.closest('table.courses')) th.remove();
  });
  for (const n of [copy, ...Array.from(copy.querySelectorAll('*'))]) {
    for (const a of ['data-key', 'tabindex', 'aria-controls', 'aria-expanded', 'contenteditable']) n.removeAttribute(a);
  }
}

/** Links in the finished file: a jump to a card that is in the file stays; a
 * jump to an input the file does not have becomes its words; a link to a
 * page of this site points at the site (the file lives elsewhere). */
export function settleLinks(root: Element, baseUri: string): void {
  const ids = new Set(Array.from(root.querySelectorAll('[id]')).map((n) => n.id));
  for (const a of Array.from(root.querySelectorAll('a[href]'))) {
    const href = a.getAttribute('href') ?? '';
    if (href.startsWith('#')) {
      if (!ids.has(decodeURIComponent(href.slice(1)))) a.replaceWith(...Array.from(a.childNodes));
    } else if (!/^mailto:/i.test(href)) {
      try {
        a.setAttribute('href', new URL(href, baseUri).href);
      } catch {
        a.replaceWith(...Array.from(a.childNodes));
      }
    }
  }
}

/** The page's stylesheets as rule lists — one whose rules cannot be read
 * (another origin's) is left out. */
function pageSheets(doc: Document): ArrayLike<CssRuleLike>[] {
  const out: ArrayLike<CssRuleLike>[] = [];
  for (const sheet of Array.from(doc.styleSheets)) {
    try {
      out.push(sheet.cssRules);
    } catch {
      /* another origin's sheet: not ours to copy */
    }
  }
  return out;
}

export interface ResultsPageText {
  title: string;
  heading: string;
  /** Simulation mode's notice, first (D10). */
  simulation?: string;
  standing: string;
  earlier?: string;
  checked: string;
  stamp: string;
  coursesHeading: string;
  footer: string;
}

/** Build the file from the page as it is now and hand it to the browser to
 * save. Returns the file's name. */
export function downloadResultsPage(doc: Document, text: ResultsPageText, fileName: string): string {
  const body = doc.createElement('div');
  const head = doc.createElement('header');
  head.className = 'results-head';
  const line = (cls: string | undefined, t: string): HTMLElement => {
    const p = doc.createElement('p');
    if (cls) p.className = cls;
    p.textContent = t;
    return p;
  };
  const h1 = doc.createElement('h1');
  h1.textContent = text.heading;
  head.append(h1);
  if (text.simulation) head.append(line('results-simulation', text.simulation));
  head.append(line('results-standing', text.standing));
  if (text.earlier) head.append(line('results-earlier', text.earlier));
  head.append(line('results-checked', text.checked), line('results-checked results-stamp', text.stamp));
  body.append(head);

  const report = doc.querySelector('#report .audit');
  if (report) {
    const col = doc.createElement('div');
    col.className = 'audit-col';
    const copy = report.cloneNode(true) as Element;
    staticCopy(report, copy);
    col.append(copy);
    body.append(col);
  }

  // The Coursework card's tables, each under its heading, and the key above
  // the first — not its form, its hints or its GPA box.
  const card = doc.getElementById('coursework');
  if (card) {
    const parts = Array.from(card.querySelectorAll('h3.subhead, p.course-key, table.courses, p.empty')).filter((n) => !n.closest('form, .transcript-preview'));
    if (parts.length > 0) {
      const section = doc.createElement('section');
      section.className = 'card results-courses';
      const h2 = doc.createElement('h2');
      h2.textContent = text.coursesHeading;
      section.append(h2);
      for (const p of parts) {
        const copy = p.cloneNode(true) as Element;
        staticCopy(p, copy);
        section.append(copy);
      }
      body.append(section);
    }
  }
  body.append(line('results-foot', text.footer));
  settleLinks(body, doc.baseURI);

  const html = resultsPageHtml({ title: text.title, css: fileCss(pageSheets(doc)), bodyHtml: body.innerHTML });
  const blob = new Blob([html], { type: 'text/html' });
  const a = doc.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(a.href);
  return fileName;
}
