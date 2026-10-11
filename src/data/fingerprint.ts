// A short fingerprint of the course rules a result was checked against (DGS
// 2026-10-11, item 8: "stamp every result"). Eight hexadecimal characters,
// e.g. "3f9a2c1b", computed from the five tabs' text exactly as the app read
// them — the live sheet, or the copy saved in the app (data/snapshot.json).
//
// What it is for: a student's saved file, printout or email names the
// fingerprint, and `npm run reproduce -- <saved file>` finds the snapshot
// commit whose tabs give the same fingerprint, so the DGS can re-run that
// student's check against the very rules they saw. Two reads of the same
// content always give the same fingerprint: line endings and trailing
// whitespace are evened out first, the same normalization `sameCsvContent`
// uses (src/data/rules-date.ts). An optional tab the app could not read
// (ExternalCourses, Universities) is left out, as the audit left it out.
//
// FNV-1a, 32 bits: a few lines of plain code, the same in every browser and
// in node, synchronous (crypto.subtle is asynchronous and missing on a page
// opened from a file). Not a security measure — nothing secret is hashed and
// nothing is verified with it; across the few hundred snapshots the sheet
// will ever have, two different contents sharing a fingerprint is a
// one-in-a-hundred-thousand chance, and `npm run reproduce` reports every
// match it finds.
import type { CsvTexts } from './assemble.ts';
import { normalizeCsvText } from './rules-date.ts';

/** The tabs in a fixed order, so the fingerprint never depends on key order. */
const TABS = ['courses', 'parameters', 'categories', 'external', 'universities'] as const;

export function rulesFingerprint(texts: CsvTexts): string {
  let h = 0x811c9dc5;
  const feed = (s: string): void => {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
  };
  for (const tab of TABS) {
    const text = texts[tab];
    if (text === undefined) continue;
    // The tab's name and a separator no CSV contains, so moving text from one
    // tab to the next changes the fingerprint.
    feed(`\u0001${tab}\u0002`);
    feed(normalizeCsvText(text));
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
