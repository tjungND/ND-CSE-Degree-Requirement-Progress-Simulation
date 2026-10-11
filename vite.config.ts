import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';

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

// base './' → relative asset paths, so dist/ works on GitHub Pages under a
// project path, on any plain web host, from file://, and inside an <iframe>
// on cse.nd.edu (CLAUDE.md "Static deployment").
//
// Tests do NOT run through vite — see the note in package.json.
export default defineConfig({
  base: './',
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
