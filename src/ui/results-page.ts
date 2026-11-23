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

// ---------- no grades in the file (DGS 2026-11-22) ----------
//
// "The purpose is to ensure those HTML files do not show sensitive data like
// grades. I want to share those files with the advisors. In the normal pages,
// grades should be shown with all the information. Such information should be
// hidden and reworded only in the HTML files generated by the 'Print' button."
//
// So the file names no grade: no letter grade (A–F, S, U, I, W, V) and no word
// that stands for one (Incomplete, withdrawn, audited, failed for a course),
// no transcript mark, no GPA or semester-GPA figure. A sentence that explained
// a result by its grade says "its grade" instead. What the grade DECIDED stays —
// Met or not, counts or not, below the B floor — since that is the result the
// advisor reads. Each rule below rewrites one engine sentence (the file named
// beside it); the last few are nets that blank any grade or GPA figure a
// future sentence brings, and tests/results-page.test.ts runs every scenario
// and a record holding every kind of grade through them.

/** A grade as a transcript prints it (engine/grades.ts GRADES, but IP). */
const G = String.raw`(?:A-|A|B\+|B-|B|C\+|C-|C|D|F|S|U|I|W|V)`;
/** A figure: "3.50", "2.996", "35.00", "4". */
const NUM = String.raw`\d+(?:\.\d+)?`;
const re = (source: string, flags = 'g'): RegExp => new RegExp(source, flags);

/** [pattern, replacement] in order — a later rule sees the earlier ones' output. */
const GRADE_RULES: [RegExp, string | ((...m: string[]) => string)][] = [
  // phd.ts categoriesRow: "CSE 60111 (B-) is below the B floor — retake it …",
  // "CSE 60111 (B-), CSE 60321 (C) are below the B floor — retake them …".
  [
    re(String.raw`((?:[^,()—;:.]+? \(${G}\), )*[^,()—;:.]+? \(${G}\)) (is|are) below the (${G}) floor`),
    (_m, list, verb, floor) => {
      const ids = list!.replace(re(String.raw` \(${G}\)`), '');
      return verb === 'is' ? `${ids}’s grade is below the ${floor} floor` : `${ids}: grades below the ${floor} floor`;
    },
  ],
  // audit.ts course line: "specialization course (§4.4.2): not counted — B- is below the B floor".
  // (The character before the grade is matched, not looked behind at: Safari
  // before 16.4 cannot compile a lookbehind — tests/browser-support.test.ts.)
  [re(String.raw`(^|[^\w+\-])${G} is below the (${G}) floor`), '$1its grade is below the $2 floor'],
  // allocate.ts: "B is your own reading of the transcript’s mark “85” — the DGS checks it …".
  [re(String.raw`(?:in progress|(^|[^\w+\-])${G}) is your own reading of the transcript’s mark “[^”]*”`), (_m, before) => `${before ?? ''}the grade here is your own reading of the transcript’s mark`],
  // allocate.ts: "withdrawn (W) — earns no credit", "audited (V) — earns no credit …", "failed — earns no credit".
  [/\b(?:withdrawn \(W\)|audited \(V\)) — earns no credit/g, 'earns no credit'],
  [/\bfailed — earns no credit/g, 'not counted — earns no credit'],
  // allocate.ts: "Incomplete (I) past its deadline (about 2026-01-15) — it became an F unless the Graduate School extended it".
  [/\bIncomplete \(I\) past its deadline \(about ([^)]*)\) — it became an F unless the Graduate School extended it/g, 'its grade was not final by its deadline (about $1) — it counts only if the Graduate School extended the deadline'],
  // transfer.ts: "an Incomplete past its deadline (Academic Code §4.4)".
  [/\ban Incomplete past its deadline/g, 'a grade not final by its deadline'],
  // allocate.ts: "Incomplete (I): finish the work within 30 calendar days … or the I becomes an F; the instructor then has 14 days to report the grade".
  [/\bIncomplete \(I\): finish the work within 30 calendar days of the date grades were due for that semester, or the I becomes an F; the instructor then has 14 days to report the grade/g, 'its grade is not final yet: the work is due within 30 calendar days of the date grades were due for that semester, and the instructor then has 14 days to report the grade'],
  // allocate.ts: "Fall 2026 is your graduation semester, and the degree is conferred only with no I grades in it".
  [/\bonly with no I grades in (it|that semester)/g, 'only once every grade in $1 is final'],
  // audit.ts: "An Incomplete cannot stand in the semester you graduate: CSE 60625 is graded I in Fall 2026, …".
  [/\bAn Incomplete cannot stand in the semester you graduate/g, 'A grade that is not final cannot stand in the semester you graduate'],
  [/ (is|are) graded I in /g, (_m, verb) => ` ${verb === 'is' ? 'has' : 'have'} no final grade in `],
  // audit.ts: "More than one Incomplete in one semester", "Incompletes in two consecutive semesters".
  [/\bMore than one Incomplete in one semester/g, 'More than one grade not yet final in one semester'],
  [/\bIncompletes in two consecutive semesters/g, 'Grades not yet final in two consecutive semesters'],
  // allocate.ts: "graded I (Incomplete) at University X — no final grade yet, so it cannot show the B …".
  [/\b([Gg])raded I \(Incomplete\) at (.+?) — no final grade yet/g, (_m, g, where) => `${g === 'G' ? 'N' : 'n'}o final grade yet at ${where}`],
  // allocate.ts: "graded S (pass/fail), which cannot show the B that §5.2 requires".
  [/\bgraded S \(pass\/fail\), which cannot show/g, 'its grade cannot show'],
  // transfer.ts: "CS 50800: Graded pass/fail, which cannot show the B §5.2 requires".
  [/\b([Gg])raded pass\/fail, which cannot show/g, (_m, g) => `${g === 'G' ? 'I' : 'i'}ts grade cannot show`],
  // audit.ts: "A U in research in 2 consecutive semesters (…)", "three consecutive U grades in research".
  [/\bA U in research in /g, 'Research not passed in '],
  [/\bthree consecutive U grades in research/g, 'three consecutive semesters of research not passed'],
  // phd.ts / mscse.ts residency: "Fall 2025: every course withdrawn — not counted".
  [/: every course withdrawn — not counted/g, ': no course that counts — not counted'],
  // allocate.ts: "grade 'Q' is not recognized", "unrecognized grade 'Q'".
  [/\bgrade '[^']*' is not recognized/g, 'its grade is not recognized'],
  [/\bunrecognized grade '[^']*'/g, 'unrecognized grade'],
  // ---- the GPA ----
  // shared.ts: "You show a 2.80 GPA — §2.2 requires …".
  [re(String.raw`\bYou show an? ${NUM} GPA — `), 'Your cumulative GPA is below the minimum — '],
  // phd.ts candidacy checklist: "Cumulative GPA of 3.0 or better: 3.50" / ": 2.80 — below it".
  [re(String.raw`(GPA of ${NUM} or better): ${NUM} — below it`), '$1: below it'],
  [re(String.raw`(GPA of ${NUM} or better): ${NUM}(?![\d.])`), '$1: yes'],
  // shared.ts: "this program’s courses alone average 3.12, on the other side of the minimum".
  [re(String.raw`\bcourses alone average ${NUM}, on the other side`), 'courses alone fall on the other side'],
  // shared.ts, phd.ts: "your transcript’s cumulative GPA is 2.95, on the other side …", "Your cumulative GPA is 2.80, below …".
  [re(String.raw`\bGPA is ${NUM}, `), 'GPA is '],
  // shared.ts: "Cumulative GPA 3.50 meets the 3.0 minimum", "Cumulative GPA 35.00 is outside …".
  [re(String.raw`\bGPA ${NUM}(?![\d.])`), 'GPA'],
];

/** The nets, for a sentence no rule above knows: a figure in a GPA sentence,
 * and a grade in brackets after a course or after "graded". */
function gradeNets(text: string): string {
  let out = text;
  if (/GPA|grade-point|\baverage\b/i.test(out)) {
    // audit.ts probation and dismissal warnings: "(Fall 2025: 2.80, Spring 2026: 2.90)" keeps its semesters.
    out = out.replace(re(String.raw`\b((?:Fall|Spring|Summer) \d{4}): ${NUM}(?![\d.])`), '$1');
    // Any other figure with two or three decimals — a GPA as gpaText prints it;
    // never a threshold ("3.0"), a range ("0.00–4.00") or credits ("2.64 cr").
    out = out.replace(/(^|[^\w§.–-])\d{1,3}\.\d{2,3}(?![\d.–-]|\s*(?:cr\b|credit))/g, '$1—');
  }
  out = out.replace(re(String.raw`(\b[A-Z]{2,5}[ -]?\d{3,5}[A-Z]?) \(${G}\)(?=[\s,;:.)—]|$)`), '$1');
  out = out.replace(re(String.raw`\b([Gg]raded) ${G}(?![\w+\-])(?: \([^)]*\))?`), '$1');
  return out;
}

/** One piece of the page's text with its grades left out (DGS 2026-11-22). */
export function withoutGrades(text: string): string {
  let out = text;
  for (const [pattern, replacement] of GRADE_RULES) out = out.replace(pattern, replacement as string);
  return gradeNets(out);
}

/** Every text and tooltip in the file, its grades left out — but not a
 * handbook quote or the glossary's definitions, which are the rules' own
 * words, not the student's grades. */
export function leaveOutGrades(root: Element): void {
  const doc = root.ownerDocument;
  const policy = '.rule-quote, blockquote, q, details.glossary';
  const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
  const nodes: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
  for (const node of nodes) {
    if (node.parentElement?.closest(policy)) continue;
    const value = node.nodeValue ?? '';
    const next = withoutGrades(value);
    if (next !== value) node.nodeValue = next;
  }
  for (const n of Array.from(root.querySelectorAll('[title], [aria-label]'))) {
    if (n.closest(policy)) continue;
    for (const a of ['title', 'aria-label']) {
      const v = n.getAttribute(a);
      if (v !== null && withoutGrades(v) !== v) n.setAttribute(a, withoutGrades(v));
    }
  }
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
  // The course tables' Remove column, and their Grade column (DGS
  // 2026-11-22: "In the 'Print', remove the grades from the html.").
  copy.querySelectorAll('td.cell-remove, td[data-label="Grade"]').forEach((n) => n.remove());
  copy.querySelectorAll('th').forEach((th) => {
    if (['Remove', 'Grade'].includes((th.textContent ?? '').trim()) && th.closest('table.courses')) th.remove();
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
  leaveOutGrades(body);

  const html = resultsPageHtml({ title: text.title, css: fileCss(pageSheets(doc)), bodyHtml: body.innerHTML });
  const blob = new Blob([html], { type: 'text/html' });
  const a = doc.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(a.href);
  return fileName;
}
