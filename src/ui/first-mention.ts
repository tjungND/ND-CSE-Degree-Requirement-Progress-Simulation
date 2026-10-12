// "Oral Candidacy Exam (OCE)" in full at its FIRST mention only; every later
// mention says "OCE" (DGS, 2026-09-06 evening). The engine and every builder
// keep writing the full name — a string is self-contained and the tests pin
// it — and each SURFACE shortens the repeats on the way out: the page in
// render() (document order = phone and screen-reader order), the copied
// emails on their text and html flavours. DOM-free apart from the walker.
import { DECIDER_DGS, DECIDER_DGS_ALL } from '../engine/decider.ts';

export const OCE_FULL = 'Oral Candidacy Exam (OCE)';
export const OCE_SHORT = 'OCE';

/** Case-insensitive (the advisor summary upper-cases section headings), with
 * or without the bracketed acronym, so a later bare "Oral Candidacy Exam"
 * shortens too. A lone "OCE" never matches. Whole words only (2026-10-04):
 * without the boundaries the Academic Code's "the doctoral candidacy
 * examination", quoted on the admission-to-candidacy row, read "doctOCEination". */
const OCE_RE = /\bOral Candidacy Exam\b(?: \(OCE\))?/gi;

/** The text with the first mention kept as written and every later one
 * replaced by the short form. Idempotent. */
export function shortenAfterFirst(text: string, re: RegExp = OCE_RE, short: string = OCE_SHORT): string {
  let seen = false;
  return text.replace(re, (m) => {
    if (seen) return short;
    seen = true;
    return m;
  });
}

/** The same rule over a rendered page: walks the text nodes under `root` in
 * document order and rewrites `nodeValue` only (never the element tree —
 * restoreFocus() relies on element-index paths). Skipped: the glossary (its
 * term keeps the full name — it is the definition), the report's group
 * headings (DGS 2026-10-06: "Spell out OCE here" — the heading over the
 * candidacy cards read "OCE and candidacy"; a heading is read on its own, so
 * it keeps the full name and is not counted as the first mention either),
 * the print-only header, and form values (`select`, `textarea`). */
/** The page's own strings were written for one decider; for an MSCSE student
 * every standalone "DGS" on the page is the ADGS (DGS 2026-09-11). Skips the
 * regions that name both people or quote the handbook: the contact card, the
 * glossary, the print header, the handbook sentence each card quotes under
 * Relevant Policies (`.rule-quote` — "Handbook quotes are never rewritten",
 * DECISIONS 2026-09-12; policy review round 4, P4-text-6: the §5.2 quote read
 * "recommended by the ADGS", words the handbook does not contain), and form
 * values. */
export function applyDeciderRule(root: ParentNode, program: 'mscse' | 'phd'): void {
  if (program !== 'mscse') return;
  const doc = (root as Node).ownerDocument ?? (root as Document);
  const walker = doc.createTreeWalker(root as Node, 4 /* NodeFilter.SHOW_TEXT */);
  const nodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const value = node.nodeValue;
    if (!value || !DECIDER_DGS.test(value)) continue;
    // The notices and the footer are rewritten too since 2026-09-15 (DGS: the
    // alpha notice names the ADGS on the MSCSE tab); the feedback address and
    // the contact card keep "DGS" by `data-keep-dgs`.
    if (node.parentElement?.closest('.contact-card, details.glossary, .print-header, .rule-quote, [data-keep-dgs], select, textarea, script, style')) continue;
    nodes.push(node as Text);
  }
  // "DGS Handbook" names the Graduate School's document, not the decider (2026-10-03).
  // …nor a ruling the DGS made and dated (P3-text-engine-4).
  for (const node of nodes) node.nodeValue = node.nodeValue!.replace(DECIDER_DGS_ALL, 'ADGS');
}

export function applyFirstMentionRule(root: ParentNode, re: RegExp = OCE_RE, short: string = OCE_SHORT): void {
  const doc = (root as Node).ownerDocument ?? (root as Document);
  const walker = doc.createTreeWalker(root as Node, 4 /* NodeFilter.SHOW_TEXT */);
  const test = new RegExp(re.source, re.flags.replace('g', ''));
  const every = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  let seen = false;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const value = node.nodeValue;
    if (!value || !test.test(value)) continue;
    if (node.parentElement?.closest('details.glossary, .group-head, .print-header, select, textarea, script, style')) continue;
    if (seen) {
      node.nodeValue = value.replace(every, short);
    } else {
      node.nodeValue = shortenAfterFirst(value, re, short);
      seen = true;
    }
  }
}
