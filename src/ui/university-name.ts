// University names typed by hand (DGS request 2026-09-06 evening): the
// manual course form and the previous-transcript preview offer the
// universities the ExternalCourses tab already knows, and Title-Case whatever
// is typed ("purdue university" → "Purdue University"; "UCLA" stays). Matching
// against the DGS's rules ignores case, accents and punctuation anyway
// (normalizeUniversity in src/data/external.ts), so the style is for the
// student's eye and the coursework headings only. DOM-free.
import { expandInstitutionAbbreviations, normalizeUniversity } from '../data/external.ts';
import type { ExternalRule } from '../data/types.ts';

/** Words that stay lower-case inside a name when typed lower-case ("University
 * of Notre Dame", "Université de Montréal"). Always raised at the start. */
const SMALL_WORDS = new Set(['of', 'at', 'the', 'and', 'for', 'in', 'de', 'da', 'di', 'du', 'des', 'von', 'van', 'der', 'del', 'della', 'la', 'le', 'y', 'e']);

/** Raise the first letter of every word (also after a hyphen); keep the rest
 * as typed so acronyms survive (UCLA, IIT, MIT). */
export function titleCaseUniversity(name: string): string {
  const words = name.trim().replace(/\s+/g, ' ').split(' ');
  return words
    .map((word, i) =>
      word
        .split('-')
        .map((part) => {
          if (part === '') return part;
          if (i > 0 && SMALL_WORDS.has(part.toLowerCase()) && part === part.toLowerCase()) return part;
          const first = part.charAt(0);
          return first.toLocaleUpperCase() + part.slice(1);
        })
        .join('-'),
    )
    .join(' ');
}

/** What a typed name becomes when the student leaves the box: trimmed and
 * Title-Cased (DGS 2026-09-06: Title Case for every hand-typed name, known to
 * the rules or not). An empty box stays empty. */
export function canonicalUniversityName(typed: string): string {
  return titleCaseUniversity(expandInstitutionAbbreviations(typed));
}

/** The distinct universities of the ExternalCourses and Universities tabs
 * (the latter since 2026-10-10: a university the DGS has set a credit system
 * for, even before ruling on any of its courses), Title-Cased for display and
 * sorted — the datalist behind both University boxes. */
export function knownUniversities(external: readonly ExternalRule[], universities: readonly { university: string }[] = []): string[] {
  const byKey = new Map<string, string>();
  for (const r of [...external, ...universities]) {
    const key = normalizeUniversity(r.university);
    if (key === '' || byKey.has(key)) continue;
    byKey.set(key, titleCaseUniversity(expandInstitutionAbbreviations(r.university).toLowerCase()));
  }
  return [...byKey.values()].sort((a, b) => a.localeCompare(b));
}
