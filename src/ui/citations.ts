// Which document a section comes from (DGS 2026-10-03: "When sections are
// cited, need to clarify whether it's from CSE handbook, Grad school academic
// code, or DGS handbook. Clarify this without making texts too long.").
//
// The engine and every builder keep writing the short forms they always have:
// a bare "§4.2" is the CSE Graduate Handbook; "Academic Code §…" and "DGS
// Handbook §…" are the Graduate School's two documents. Each SURFACE labels
// the bare ones on the way out — the page after every render, the copied
// emails in the copy dialog — the same way the first-mention and decider rules
// beside it work (first-mention.ts): "CSE §4.2". A run of sections after one
// label keeps that label ("CSE §3.2, §3.6.1"; "Academic Code §5.1, §5.4"), so
// the text grows by four characters per citation, not per section.
//
// DOM-free apart from the walker; the string functions are unit-tested.

const SECTION_RE = /§\d+(?:\.\d+)*(?:[–-]\d+(?:\.\d+)*)?/g;

/** Already says which document (or is a continuation of a list that does). */
const LABELLED_BEFORE = /(?:Academic Code|DGS Handbook|Graduate Handbook|Studies Handbook|CSE Handbook|CSE|Code)\s$|(?:Academic Code|DGS Handbook)\s\($/;
/** "…§3.2, §4.2", "…§4.5 and §2.2", "…§3.2/§4.2", "…§4.7; §…": the next section
 * belongs to the same document as the one before it. A closing bracket may sit
 * between them ("§3.4 (…), §5.2" is NOT a continuation — the bracket ends it). */
const CONTINUATION_BEFORE = /§\d+(?:\.\d+)*(?:[–-]\d+(?:\.\d+)*)?(?:[’']s)?(?:,? criterion \d+)?\s*(?:,|;|\/|–|\band\b|\bor\b|\bthrough\b)\s*$/;

/** "Handbook §4" with no document name before it is the CSE handbook (the
 * program tabs read "Ph.D. (Handbook §4)"). */
function labelBareHandbook(text: string): string {
  return text.replace(/(^|[^\w])Handbook (?=§)/g, (whole, lead: string, offset: number) => {
    const before = text.slice(Math.max(0, offset - 12), offset + lead.length);
    return /(?:DGS|CSE|Graduate|Studies)\s$/.test(before) ? whole : `${lead}CSE Handbook `;
  });
}

/** The text with every bare CSE-handbook section labelled "CSE §…". Idempotent. */
export function labelCitations(text: string): string {
  if (!text.includes('§')) return text;
  const withHandbook = labelBareHandbook(text);
  let out = '';
  let last = 0;
  for (const m of withHandbook.matchAll(SECTION_RE)) {
    const at = m.index ?? 0;
    const before = withHandbook.slice(Math.max(0, at - 48), at);
    out += withHandbook.slice(last, at);
    if (!LABELLED_BEFORE.test(before) && !CONTINUATION_BEFORE.test(before)) out += 'CSE ';
    out += m[0];
    last = at + m[0].length;
  }
  return out + withHandbook.slice(last);
}

/** Labels every text node under `root` in place (never the element tree —
 * restoreFocus() relies on element-index paths). Form values are skipped. */
export function labelCitationsIn(root: ParentNode): void {
  const doc = (root as Node).ownerDocument ?? (root as Document);
  const walker = doc.createTreeWalker(root as Node, 4 /* NodeFilter.SHOW_TEXT */);
  const nodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.nodeValue?.includes('§')) continue;
    if (node.parentElement?.closest('select, textarea, script, style')) continue;
    nodes.push(node as Text);
  }
  for (const node of nodes) {
    const labelled = labelCitations(node.nodeValue!);
    if (labelled !== node.nodeValue) node.nodeValue = labelled;
  }
}

/** One bracketed token that only says where a rule comes from: a section of
 * any of the three documents (with an optional quoted phrase or criterion),
 * Appendix A, a dated DGS or Graduate School ruling, or the Graduate School
 * itself. */
function isSourceToken(token: string): boolean {
  const t = token.trim();
  if (t === '') return true;
  if (/^(?:the )?(?:Graduate School(?:’s)?(?: 4\+1 guidance)?|(?:Academic Code )?Appendix A)$/.test(t)) return true;
  if (/^(?:DGS|ADGS|Graduate School)(?: decision)? \d{4}-\d{2}-\d{2}$/.test(t)) return true;
  return /^(?:(?:CSE|Academic Code|DGS Handbook|CSE Handbook|Handbook)\s+)?§\d+(?:\.\d+)*(?:[–-]\d+(?:\.\d+)*)?(?:,? criterion \d+)?(?:\s+“[^”]*”)?$/.test(t);
}

/** A requirement card's visible statement without its citations (DGS
 * 2026-10-03: the card shows what is satisfied by what; "the explanation/
 * citation of the relevant policy documents" sits behind its Relevant
 * Policies selector — "Details" until 2026-10-04). A
 * bracket of sources only is dropped — "transfer credit (§5.2)" → "transfer
 * credit" — and a source tacked onto a bracket that says something else is
 * cut from it — "(9+ credits, §2.1.2)" → "(9+ credits)". */
export function withoutCitations(text: string): string {
  return text
    .replace(/\s*\(([^()]*)\)/g, (whole, inner: string) => {
      const tokens = inner.split(/\s*;\s*|,\s+(?=(?:CSE |Academic Code |DGS Handbook |Handbook )?§)|\s+and\s+(?=(?:CSE |Academic Code |DGS Handbook )?§)|\/(?=§)/);
      if (tokens.every(isSourceToken)) return '';
      const kept = tokens.filter((t) => !isSourceToken(t));
      return kept.length === tokens.length ? whole : ` (${kept.join('; ')})`;
    })
    .replace(/\s+([.,;:])/g, '$1')
    .trim();
}

/** The full name of the document a card's rule comes from, for the quote in
 * its Relevant Policies: "§4.2" → "CSE Graduate Handbook §4.2"; "Academic Code §6.2.4" →
 * "Graduate School Academic Code §6.2.4"; "DGS Handbook §3.14" → "Graduate
 * School DGS Handbook §3.14". Anything else (a dated Graduate School answer)
 * is returned as written. */
export function sourceName(section: string): string {
  if (section.startsWith('§')) return `CSE Graduate Handbook ${section}`;
  if (section.startsWith('Academic Code')) return `Graduate School ${section}`;
  if (section.startsWith('DGS Handbook')) return `Graduate School ${section}`;
  return section;
}
