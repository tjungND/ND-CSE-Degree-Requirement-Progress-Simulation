// The course-number rule of the Notre Dame transcript reader, on its own so
// the page can use it without loading the reader (efficiency round,
// 2026-10-26): `prior-nd.ts` needs it on every render, while the reader
// itself (parse.ts) now loads at the Import click with pdf.js. parse.ts
// re-exports it, so every existing import keeps working. Moved verbatim.

/** The level the student was registered at when taking the course — the
 * transcript's Level column (UG / GR…), else the term's level block ("Term
 * Totals (Undergraduate)", "College: Graduate School"), else the course number
 * (≥ 60000 graduate, < 50000 undergraduate; 5xxxx stays unknown). */
export type RegisteredLevel = 'undergraduate' | 'graduate';

/** Notre Dame numbering: 1xxxx–4xxxx undergraduate, 6xxxx and up graduate;
 * 5xxxx (bridge courses) is taken by both and stays unknown. */
export function levelFromNumber(courseId: string): RegisteredLevel | undefined {
  const m = /\b(\d)\d{4}\b/.exec(courseId);
  if (!m) return undefined;
  const digit = Number(m[1]);
  return digit >= 6 ? 'graduate' : digit <= 4 ? 'undergraduate' : undefined;
}
