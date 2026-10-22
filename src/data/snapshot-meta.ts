// The saved copy's DATE and per-tab FINGERPRINTS — data/snapshot-meta.json,
// ~300 bytes — which is all a live page needs from data/snapshot.json (blue-
// team review 2026-10-17, W1, done 2026-10-22). Until then the whole snapshot
// (97 KB of CSV) was compiled into the JavaScript both pages load on every
// visit, although it is read only when a student chooses "Continue with the
// copy saved on …" after a failed live load — and, because it sat inside the
// hashed chunks, every six-hourly sheet sync that changed content renamed
// every chunk, including the lazily loaded ones a tab left open across a
// redeploy then could not fetch. Now:
//   - the build (vite.config.ts) writes dist/data/snapshot.json as it is and
//     dist/data/snapshot-meta.json from it, both at fixed names outside the
//     chunk graph, and the dev server serves the same two paths;
//   - a page fetches the meta beside the five tabs (src/data/load.ts) and
//     dates the live rules by comparing fingerprints — the same answer the
//     old text comparison gave, since both normalize with normalizeCsvText;
//   - the snapshot itself is fetched only on the student's click.
// Pure (no fetch, no DOM): the build plugin runs this in node, the page in
// the browser, the tests in node.
import type { CsvTexts } from './assemble.ts';
import { tabFingerprint } from './fingerprint.ts';
import type { RulesDate } from './types.ts';

/** The tabs a snapshot can hold, in a fixed order. */
export const SNAPSHOT_TABS = ['courses', 'parameters', 'categories', 'external', 'universities'] as const;
export type SnapshotTab = (typeof SNAPSHOT_TABS)[number];

/** What data/snapshot.json holds (written by scripts/sync-sheet.ts). */
export interface RulesSnapshot {
  syncedAt: string;
  csv: CsvTexts;
}

/** What data/snapshot-meta.json holds: when the saved copy was made, and one
 * fingerprint per tab it has (an optional tab the snapshot lacks is absent). */
export interface SnapshotMeta {
  syncedAt: string;
  tabs: Partial<Record<SnapshotTab, string>>;
}

/** The meta of a snapshot — what the build writes beside it. */
export function snapshotMetaOf(snapshot: RulesSnapshot): SnapshotMeta {
  const tabs: Partial<Record<SnapshotTab, string>> = {};
  for (const tab of SNAPSHOT_TABS) {
    const text = snapshot.csv[tab];
    if (typeof text === 'string') tabs[tab] = tabFingerprint(text);
  }
  return { syncedAt: snapshot.syncedAt, tabs };
}

/** A parsed data/snapshot.json, or undefined when `raw` is not one (a wrong
 * file at that path, an HTML error page parsed as JSON …): the three required
 * tabs must be text, the optional ones text or absent. */
export function readRulesSnapshot(raw: unknown): RulesSnapshot | undefined {
  const s = raw as { syncedAt?: unknown; csv?: Record<string, unknown> } | null;
  if (!s || typeof s !== 'object' || typeof s.syncedAt !== 'string' || !s.csv || typeof s.csv !== 'object') return undefined;
  const csv = s.csv;
  if (!(['courses', 'parameters', 'categories'] as const).every((k) => typeof csv[k] === 'string')) return undefined;
  if (!(['external', 'universities'] as const).every((k) => csv[k] === undefined || typeof csv[k] === 'string')) return undefined;
  return { syncedAt: s.syncedAt, csv: csv as unknown as CsvTexts };
}

/** A parsed data/snapshot-meta.json, or undefined when `raw` is not one. */
export function readSnapshotMeta(raw: unknown): SnapshotMeta | undefined {
  const m = raw as { syncedAt?: unknown; tabs?: Record<string, unknown> } | null;
  if (!m || typeof m !== 'object' || typeof m.syncedAt !== 'string' || !m.tabs || typeof m.tabs !== 'object') return undefined;
  const tabs: Partial<Record<SnapshotTab, string>> = {};
  for (const tab of SNAPSHOT_TABS) {
    const fp = m.tabs[tab];
    if (fp === undefined) continue;
    if (typeof fp !== 'string') return undefined;
    tabs[tab] = fp;
  }
  if (tabs.courses === undefined || tabs.parameters === undefined || tabs.categories === undefined) return undefined;
  return { syncedAt: m.syncedAt, tabs };
}

/** Date the live rules against the saved copy: every tab's fingerprint the
 * same → the rules last changed when the copy was made (`known`); any tab
 * different, present on one side only included → some time after (`after`).
 * `asSaved` names tabs to treat as matching whatever the copy has: the
 * optional tabs that failed to load, which are not evidence of a change
 * (review 2026-10-10 — otherwise the page said the rules were updated after
 * the saved copy whenever the ExternalCourses tab alone stalled). */
export function dateLiveRules(live: CsvTexts, meta: SnapshotMeta, asSaved: readonly SnapshotTab[] = []): RulesDate {
  const changed = SNAPSHOT_TABS.some((tab) => {
    if (asSaved.includes(tab)) return false;
    const text = live[tab];
    const saved = meta.tabs[tab];
    if (text === undefined || saved === undefined) return (text === undefined) !== (saved === undefined);
    return tabFingerprint(text) !== saved;
  });
  return { kind: changed ? 'after' : 'known', at: meta.syncedAt };
}
