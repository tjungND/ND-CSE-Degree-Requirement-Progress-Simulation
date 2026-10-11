// Which build of the app is running (DGS 2026-10-11, item 8): filled in by
// vite.config.ts `define` at build time — the git commit, its date, and
// whether the tree had uncommitted changes. Tests and scripts run the source
// directly, without Vite, and read "dev".

declare const __APP_BUILD__: { commit: string; date: string; modified: boolean } | undefined;

export interface AppBuild {
  /** Seven characters of the git commit, e.g. "fe64bda"; "dev" outside a build. */
  commit: string;
  /** The commit's date, YYYY-MM-DD; '' when unknown. */
  date: string;
  /** Built from a tree with uncommitted changes (never a deployed page). */
  modified: boolean;
}

export const APP_BUILD: AppBuild = typeof __APP_BUILD__ === 'object' && __APP_BUILD__ !== null ? __APP_BUILD__ : { commit: 'dev', date: '', modified: false };
