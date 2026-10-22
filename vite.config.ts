import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import { snapshotMetaOf } from './src/data/snapshot-meta.ts';

/** Which code this build is (DGS 2026-10-11, item 8: "stamp every result"):
 * the git commit it was built from, that commit's date, and whether the
 * working tree had uncommitted changes to tracked files. The pages print it
 * in the footer, the print header, the emails and the saved file
 * (src/ui/build-info.ts, src/ui/stamp.ts). The deploy Action builds a clean
 * checkout, so a deployed page never reads "with local changes". Outside a
 * git checkout: GitHub's GITHUB_SHA, else "unknown". */
function buildInfo(): { commit: string; date: string; modified: boolean } {
  const git = (args: string): string => {
    try {
      return execSync(`git ${args}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    } catch {
      return '';
    }
  };
  const commit = git('rev-parse --short=7 HEAD') || (process.env.GITHUB_SHA ?? '').slice(0, 7) || 'unknown';
  return { commit, date: git('log -1 --format=%cs'), modified: git('status --porcelain --untracked-files=no') !== '' };
}

/** The saved copy of the course rules as two plain files beside the pages
 * (blue-team review 2026-10-17, W1; src/data/snapshot-meta.ts explains why):
 *   data/snapshot.json       — the committed file, as it is (the student's
 *                              "Continue with the copy saved on …" fetches it);
 *   data/snapshot-meta.json  — its date and one fingerprint per tab, computed
 *                              here from it (every load fetches this to date
 *                              the live rules).
 * Fixed names, outside the hashed chunk graph: a sheet sync that changes the
 * snapshot no longer renames a single chunk. The build EMITS both into dist/;
 * the dev server SERVES the same two paths from the committed file, so
 * `npm run dev`, `vite preview` and a deployed dist/ behave alike. The
 * sync-sheet Action is untouched — it still commits only data/snapshot.json. */
function rulesSnapshotFiles(): Plugin {
  const SNAPSHOT = 'data/snapshot.json';
  const META = 'data/snapshot-meta.json';
  const read = (): { snapshot: string; meta: string } => {
    const snapshot = readFileSync(new URL(SNAPSHOT, import.meta.url), 'utf8');
    return { snapshot, meta: JSON.stringify(snapshotMetaOf(JSON.parse(snapshot))) };
  };
  return {
    name: 'rules-snapshot-files',
    generateBundle() {
      const { snapshot, meta } = read();
      this.emitFile({ type: 'asset', fileName: SNAPSHOT, source: snapshot });
      this.emitFile({ type: 'asset', fileName: META, source: meta });
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '').split('?')[0] ?? '';
        if (!path.endsWith(`/${SNAPSHOT}`) && !path.endsWith(`/${META}`)) return next();
        const { snapshot, meta } = read();
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache');
        res.end(path.endsWith(`/${META}`) ? meta : snapshot);
      });
    },
  };
}

// base './' → relative asset paths, so dist/ works on GitHub Pages under a
// project path, on any plain web host, from file:// (the pages, not the saved
// copy of the rules — a fetch is refused from file:// — see W1 above), and
// inside an <iframe> on cse.nd.edu (CLAUDE.md "Static deployment").
//
// Tests do NOT run through vite — see the note in package.json.
export default defineConfig({
  base: './',
  plugins: [rulesSnapshotFiles()],
  define: { __APP_BUILD__: JSON.stringify(buildInfo()) },
  build: {
    outDir: 'dist',
    sourcemap: true,
    // Two pages: the audit tool (index.html) and the public course-rules list
    // (courses.html). Both share src/data/ and src/ui/; courses.html holds no
    // student data at all.
    rollupOptions: { input: { index: 'index.html', courses: 'courses.html' } },
  },
});
