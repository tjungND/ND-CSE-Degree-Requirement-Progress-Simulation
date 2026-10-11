// Types for rules.mjs (kept next to the JavaScript so tests type-check).
export interface SanitizerRun {
  x: number;
  y: number;
  text: string;
  width?: number;
}
export interface SanitizerOptions {
  seed?: number;
  keepTitles?: boolean;
  institutionalByLine?: boolean;
  columnGap?: (runs: SanitizerRun[], pageWidth: number) => number | undefined;
}
export interface Sanitizer {
  seed: number;
  yearOffset: number;
  sanitizeRuns: (runs: SanitizerRun[], pageWidth?: number) => { text: string; changed: boolean }[];
  /** After every page: each course row's points from its new grade, totals
   * recomputed from the rows (2026-10-11); every page's final run texts. */
  finish: () => string[][];
  report: () => {
    runs: number;
    changedRuns: number;
    keptRuns: number;
    scrambledWords: number;
    grades: number;
    numbers: number;
    years: number;
    emails: number;
    totalsRecomputed: number;
    totalsRandomized: number;
    rowPointsRecomputed: number;
    keptVerbatim: [string, number][];
  };
}
export function createSanitizer(options?: SanitizerOptions): Sanitizer;
