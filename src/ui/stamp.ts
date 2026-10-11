// Every result says what it was checked with (DGS 2026-10-11, item 8: "stamp
// every result"): the course rules — their fingerprint, live or the copy saved
// in the app, and their date — the CSE handbook's edition, and the app's
// build. One line, the same on every surface: both pages' footers, the print
// header, the three emails, and the saved file (which also records each
// row's verdict as the page showed it). With the saved file,
// `npm run reproduce -- <file>` finds the rules snapshot with the same
// fingerprint and re-runs the check (scripts/dev/reproduce.mts).
import { formatDateLong } from '../data/rules-date.ts';
import type { Rules, RulesDate } from '../data/types.ts';
import type { RequirementResult } from '../engine/types.ts';
import { verdictsOf } from '../engine/verdict.ts';
import { APP_BUILD, type AppBuild } from './build-info.ts';
import { formatYmdLong } from './handbook.ts';
import { HANDBOOK_SOURCE } from './handbook-text.ts';

export interface ResultStamp {
  app: AppBuild;
  rules: { fingerprint: string; source: 'live' | 'snapshot'; rulesDate?: RulesDate };
  /** The CSE handbook the section texts were read from (src/ui/handbook-text.ts). */
  handbook: { edition: string; sha256: string };
}

/** What the saved file carries: the stamp, the date the check ran against
 * (the simulated semester's in simulation mode) and every row's verdict. */
export interface SavedStamp extends ResultStamp {
  auditDate: string;
  verdicts: Record<string, string>;
}

export function resultStamp(rules: Pick<Rules, 'fingerprint' | 'source' | 'rulesDate'>, app: AppBuild = APP_BUILD): ResultStamp {
  return {
    app,
    rules: { fingerprint: rules.fingerprint, source: rules.source, ...(rules.rulesDate ? { rulesDate: rules.rulesDate } : {}) },
    handbook: { edition: HANDBOOK_SOURCE.edition, sha256: HANDBOOK_SOURCE.sha256 },
  };
}

export function savedStamp(stamp: ResultStamp, auditDate: string, rows: readonly RequirementResult[]): SavedStamp {
  return { ...stamp, auditDate, verdicts: verdictsOf(rows) };
}

/** "course rules 3f9a2c1b (read live, last updated on October 9, 2026) · CSE
 * Graduate Studies Handbook (Updated September 2026) · app version fe64bda of
 * October 11, 2026" — no capital, no full stop: each surface puts its own
 * label in front ("Checked with: …", "Version: …"). */
export function stampLine(s: ResultStamp): string {
  const at = formatDateLong(s.rules.rulesDate?.at);
  const dated = at ? (s.rules.rulesDate!.kind === 'known' ? `, last updated on ${at}` : `, updated after ${at}`) : '';
  const source = s.rules.source === 'live' ? 'read live' : 'the copy saved in the app';
  const appDate = s.app.date ? formatYmdLong(s.app.date) : undefined;
  return (
    `course rules ${s.rules.fingerprint} (${source}${dated}) · ` +
    `CSE Graduate Studies Handbook (${s.handbook.edition}) · ` +
    `app version ${s.app.commit}${appDate ? ` of ${appDate}` : ''}${s.app.modified ? ' with local changes' : ''}`
  );
}

/** The emails' and the self-check page's wording: "Checked with: …." */
export function checkedWithLine(s: ResultStamp): string {
  return `Checked with: ${stampLine(s)}.`;
}
