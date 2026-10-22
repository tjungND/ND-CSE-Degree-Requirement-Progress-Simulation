// What a visitor downloads: every file in dist/assets with its raw and gzipped
// size, what each page's FIRST load adds up to, and — from the source maps —
// which source files make up each JavaScript chunk (blue-team review
// 2026-10-17, W5: the handoff said "~170 KB" for a main bundle that had grown
// to 663 KB, and nothing in the repo measured it).
//
//   npm run build && npm run bundle-report            # every chunk, top 12 sources each
//   npm run bundle-report -- --top 30                 # more sources per chunk
//   npm run bundle-report -- index                    # only chunks whose name contains "index"
//
// Run it after a change that could move a lot of code (a new dependency, a
// moved module, a lazy chunk) and paste the two "first load" totals into the
// commit message, so size drift is seen at the commit, not months later.
// Gzip is what the network carries (GitHub Pages compresses); the raw size is
// what the browser parses. No dependency: node's own zlib, and a ~30-line
// decoder for the source map's base64-VLQ mappings (the format is fixed —
// https://tc39.es/ecma426/ — so the decoder needs no library).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dist = join(root, 'dist');
const assets = join(dist, 'assets');

const args = process.argv.slice(2);
const topIndex = args.indexOf('--top');
const top = topIndex >= 0 ? Number(args[topIndex + 1] ?? 12) : 12;
const only = args.filter((a, i) => !a.startsWith('--') && i !== topIndex + 1);

if (!existsSync(join(dist, 'index.html')) || !existsSync(assets)) {
  console.error('dist/ is missing — run `npm run build` first.');
  process.exit(1);
}

const kb = (n: number): string => `${(n / 1024).toFixed(1).padStart(7)} KB`;
const gz = (buf: Buffer): number => gzipSync(buf, { level: 6 }).length;

/** Every served file under dist/assets (not the source maps). */
interface Asset {
  name: string;
  bytes: number;
  gzip: number;
}
const files: Asset[] = readdirSync(assets)
  .filter((f) => !f.endsWith('.map'))
  .map((name) => {
    const buf = readFileSync(join(assets, name));
    return { name, bytes: buf.length, gzip: gz(buf) };
  })
  .sort((a, b) => b.bytes - a.bytes);

console.log('dist/assets — every file a page can load (raw, gzipped):');
for (const f of files) console.log(`  ${kb(f.bytes)}  ${kb(f.gzip)} gz  ${f.name}`);

// What each page's first load fetches: the module script, its modulepreloads
// and its stylesheets, as the built HTML names them. Lazy chunks (pdf-, ocr-,
// the worker) and the on-demand JSON files are not in it — they are fetched
// only when a student uses that feature.
const byName = new Map(files.map((f) => [f.name, f]));
for (const page of ['index.html', 'courses.html']) {
  const html = readFileSync(join(dist, page), 'utf8');
  const named = new Set<string>();
  for (const m of html.matchAll(/(?:src|href)="[^"]*assets\/([^"]+)"/g)) named.add(m[1]!);
  const loaded = [...named].map((n) => byName.get(n)).filter((f): f is Asset => f !== undefined);
  const bytes = loaded.reduce((a, f) => a + f.bytes, 0);
  const gzip = loaded.reduce((a, f) => a + f.gzip, 0);
  console.log(`\n${page} first load: ${kb(bytes)} raw, ${kb(gzip)} gzipped — ${loaded.map((f) => f.name).join(', ')}`);
}

// Files fetched on demand from dist/ itself (not under assets/): the saved
// copy of the rules and its date (W1) and the handbook's text (W2).
const onDemand = ['data/snapshot-meta.json', 'data/snapshot.json', 'handbook-text.json'].filter((p) => existsSync(join(dist, p)));
if (onDemand.length > 0) {
  console.log('\nFetched on demand (same origin, outside the chunk graph):');
  for (const p of onDemand) {
    const buf = readFileSync(join(dist, p));
    console.log(`  ${kb(buf.length)}  ${kb(gz(buf))} gz  ${p}`);
  }
}

// ---- Per-source attribution from the source maps -------------------------
// A source map's `mappings` is one group per generated line, segments separated
// by commas, each a run of base64-VLQ numbers RELATIVE to the previous segment:
// [generated column, source index, source line, source column, (name)]. The
// bytes from one segment's column to the next belong to that segment's source.
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const b64 = new Map([...B64].map((c, i) => [c, i]));
function decodeVlq(segment: string): number[] {
  const out: number[] = [];
  let shift = 0;
  let value = 0;
  for (const ch of segment) {
    const d = b64.get(ch);
    if (d === undefined) throw new Error(`bad base64 character "${ch}" in a source map`);
    value += (d & 31) << shift;
    if (d & 32) {
      shift += 5;
      continue;
    }
    out.push(value & 1 ? -(value >>> 1) : value >>> 1);
    value = 0;
    shift = 0;
  }
  return out;
}

/** Bytes of a generated file attributed to each of its sources. */
function attribute(jsPath: string, mapPath: string): { total: number; rows: [string, number][]; unmapped: number } {
  const code = readFileSync(jsPath, 'utf8');
  const map = JSON.parse(readFileSync(mapPath, 'utf8')) as { sources: string[]; mappings: string };
  const lines = code.split('\n');
  const per = new Map<number, number>();
  let unmapped = 0;
  let src = 0;
  const groups = map.mappings.split(';');
  for (let gl = 0; gl < groups.length; gl++) {
    const line = lines[gl] ?? '';
    const lineLen = Buffer.byteLength(line, 'utf8') + 1; // + the newline
    const segs = groups[gl] ? groups[gl]!.split(',') : [];
    const points: [number, number][] = []; // [generated column, source index or -1]
    let col = 0;
    for (const s of segs) {
      const f = decodeVlq(s);
      col += f[0]!;
      if (f.length >= 4) {
        src += f[1]!;
        points.push([col, src]);
      } else points.push([col, -1]);
    }
    if (points.length === 0) {
      unmapped += lineLen;
      continue;
    }
    unmapped += Buffer.byteLength(line.slice(0, points[0]![0]), 'utf8');
    for (let i = 0; i < points.length; i++) {
      const [c, s] = points[i]!;
      const end = i + 1 < points.length ? points[i + 1]![0] : line.length;
      const bytes = Buffer.byteLength(line.slice(c, end), 'utf8') + (i + 1 < points.length ? 0 : 1);
      if (s < 0) unmapped += bytes;
      else per.set(s, (per.get(s) ?? 0) + bytes);
    }
  }
  const rows = [...per.entries()].map(([i, b]): [string, number] => [map.sources[i] ?? `#${i}`, b]).sort((a, b) => b[1] - a[1]);
  return { total: Buffer.byteLength(code, 'utf8'), rows, unmapped };
}

/** "src/ui", "src/engine", "node_modules/pdfjs-dist", "data" — the group a
 * source path belongs to, for the per-folder subtotal. */
function groupOf(source: string): string {
  const m = /^(?:\.\.\/)*(node_modules\/[^/]+|src\/[^/]+|data|[^/]+)/.exec(source);
  return m ? m[1]! : source;
}

for (const f of files) {
  if (!f.name.endsWith('.js') && !f.name.endsWith('.mjs')) continue;
  if (only.length > 0 && !only.some((o) => f.name.includes(o))) continue;
  const mapPath = join(assets, `${f.name}.map`);
  if (!existsSync(mapPath)) continue;
  const { total, rows, unmapped } = attribute(join(assets, f.name), mapPath);
  console.log(`\n${f.name}: ${kb(total)} raw, ${kb(f.gzip)} gzipped; ${rows.length} sources, ${kb(unmapped)} unattributed (glue, whitespace)`);
  const byGroup = new Map<string, number>();
  for (const [s, b] of rows) byGroup.set(groupOf(s), (byGroup.get(groupOf(s)) ?? 0) + b);
  console.log('  by folder:');
  for (const [g, b] of [...byGroup.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${kb(b)}  ${((100 * b) / total).toFixed(1).padStart(5)}%  ${g}`);
  console.log(`  top ${Math.min(top, rows.length)} sources:`);
  for (const [s, b] of rows.slice(0, top)) console.log(`    ${kb(b)}  ${((100 * b) / total).toFixed(1).padStart(5)}%  ${s.replace(/^(\.\.\/)+/, '')}`);
}
