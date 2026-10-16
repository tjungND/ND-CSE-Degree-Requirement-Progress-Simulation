// §4.4.1 core-area TITLE keywords (DGS decision 2026-09-03, moved here from
// the UI 2026-09-04 so the classifier can use them too): an undergraduate
// course earns no transfer credit, but a title matching these keywords
// suggests it may demonstrate a core-knowledge area, so it is listed, shown
// to the student, and offered to the DGS for review. Extend the per-area
// patterns below if the DGS adds keywords.
// Registrars' abbreviations count too (DGS 2026-10-15, on a Rutgers row
// "DSGN&ANAL COMP ALGOR": "I can confirm this is an algorithm course"):
// "ALGOR", "ALGO(S)"; "OPER SYS", "OP SYS"; "ARCHIT…", "COMP ARCH",
// "COMPUTER SYS ARCH". Never a bare "ALG" (also linear ALGebra), "OS" or
// "ARCH" alone.
const AREA_TITLE_RE: Record<string, RegExp> = {
  os: /operating|\bop(?:er)?\.?\s*sys/i,
  algorithms: /algor|\balgos?\b/i,
  architecture: /architect|\barchit|\bcomp(?:uter)?\.?\s+(?:sys(?:tems?)?\.?\s+)?arch\b/i,
};
export const CORE_TITLE_RE = new RegExp(Object.values(AREA_TITLE_RE).map((re) => re.source).join('|'), 'i');

/** The human name of the §4.4.1 core area a course title suggests, or
 * undefined when no keyword matches. Order matters only for titles matching
 * several keywords — the first named area wins. */
export function coreTitleSuggestion(title: string | undefined): string | undefined {
  const t = title ?? '';
  if (AREA_TITLE_RE.os!.test(t)) return 'Operating Systems';
  if (AREA_TITLE_RE.algorithms!.test(t)) return 'Algorithms';
  if (AREA_TITLE_RE.architecture!.test(t)) return 'Computer Architecture';
  return undefined;
}

/** Does this title's keyword point at the given core-area CODE (the engine's
 * os / algorithms / architecture)? Used by the §4.4.1 rows to mark an area
 * "pending review" when an unreviewed course could satisfy it (2026-09-04). */
export function coreTitleMatchesArea(title: string | undefined, areaCode: string): boolean {
  const re = AREA_TITLE_RE[areaCode];
  return re !== undefined && re.test(title ?? '');
}
