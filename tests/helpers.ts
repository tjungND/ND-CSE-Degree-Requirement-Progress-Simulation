// Test helpers: load the fixture rules CSVs, apply a scenario's inline patch,
// and build a Rules object through the SAME parse/validate pipeline the app uses.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv, serializeCsv } from '../src/data/csv.ts';
import { rulesFromCsvTexts } from '../src/data/assemble.ts';
import type { Rules } from '../src/data/types.ts';
import type { Student } from '../src/engine/types.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, 'fixtures', 'rules');
const scenarioDir = join(here, 'scenarios');

export interface ScenarioFile {
  name: string;
  description: string;
  today: string;
  rules: { base: 'default'; patch?: RulesPatch };
  student: Student;
  expect: Record<string, { status: string; statusLabel?: string; detailIncludes?: string[]; detailExcludes?: string[] }>;
  /** The §3.5 / §3.6 track notes the report must carry, by section (2026-09-10). */
  expectTracks?: string[];
  /** Requirement ids that must NOT be in the report at all — a row the student
   * is deliberately not shown (2026-09-09: §4.5's along-the-way MSCSE for a
   * student who already holds it). */
  expectAbsent?: string[];
  /** The DGS review request must have nothing to ask (2026-09-11). */
  expectReviewEmpty?: boolean;
  expectCourseLines?: Record<string, string[]>;
  /** The semester-of-graduation registration (Academic Code §3.7; policy review
   * round 3, P3-chg-other-2): what `report.graduation` must say. */
  expectGraduation?: { registered: boolean; registeredCredits?: number };
  /** Substrings some warning must contain, and substrings no warning may
   * contain (2026-10-06, P3-dh-3.14-3.20-2: the probation and dismissal
   * warnings are a report's, not a row's). */
  expectWarnings?: string[];
  expectNoWarnings?: string[];
  /** The to-do lines the copied advisor email builds (advisor-summary.ts
   * `actionItems` — the student's, the advisor's, the DGS's and the Grad
   * Admin's): substrings some line must contain, and substrings no line may
   * (2026-10-07, P3-text-ui-3: an on-time OCE with short coursework is never
   * "late"). */
  expectEmailItems?: { includes?: string[]; excludes?: string[] };
}

export interface RulesPatch {
  /** key → new value, or null to delete the row (tests "missing parameter"). */
  parameters?: Record<string, string | null>;
  courses?: {
    course_id: string;
    rules_effective_term?: string;
    set?: Record<string, string>;
    remove?: boolean;
  }[];
  /** Replace the ExternalCourses tab entirely: an array of row objects keyed by
   * column name ([] = an empty tab); undefined leaves the fixture rows. */
  external?: Record<string, string>[];
  /** Replace the Universities tab (DGS 2026-10-10): rows keyed by column name
   * (university, credit_system, notes). When undefined, a `credit_system` on a
   * patched ExternalCourses row stands for that university's Universities row
   * (the first row naming one wins), so a test still says "this university is
   * on quarters" next to its course; `null` drops the tab entirely, for a
   * sheet from before it existed (the old column is then read). */
  universities?: Record<string, string>[] | null;
}

/** One scenario fixture by file name (without `.json`). */
export function loadScenario(name: string): ScenarioFile {
  return JSON.parse(readFileSync(join(scenarioDir, `${name}.json`), 'utf8'));
}

/** Every scenario fixture, in file-name order. */
export function allScenarios(): ScenarioFile[] {
  return readdirSync(scenarioDir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => loadScenario(f.slice(0, -'.json'.length)));
}

type FixtureCsvTexts = { courses: string; parameters: string; categories: string; external: string; universities: string };
let cachedCsvTexts: FixtureCsvTexts | undefined;

/** The fixture CSVs, read once per process (the strings are immutable; a fresh
 * object is returned each time so no caller can alter another's copy). */
export function fixtureCsvTexts(): FixtureCsvTexts {
  cachedCsvTexts ??= {
    courses: readFileSync(join(fixtureDir, 'courses.csv'), 'utf8'),
    parameters: readFileSync(join(fixtureDir, 'parameters.csv'), 'utf8'),
    categories: readFileSync(join(fixtureDir, 'categories.csv'), 'utf8'),
    external: readFileSync(join(fixtureDir, 'external.csv'), 'utf8'),
    universities: readFileSync(join(fixtureDir, 'universities.csv'), 'utf8'),
  };
  return { ...cachedCsvTexts };
}

/** Apply a scenario's inline patch at the CSV level, so patched rules still go
 * through the one true parse/validate pipeline. */
export function applyPatch(
  texts: { courses: string; parameters: string; categories: string; external?: string; universities?: string },
  patch?: RulesPatch,
): { courses: string; parameters: string; categories: string; external?: string; universities?: string } {
  if (!patch) return texts;
  let parameters = texts.parameters;
  let courses = texts.courses;

  if (patch.parameters) {
    const rows = parseCsv(parameters);
    const header = rows[0] ?? [];
    let body = rows.slice(1);
    for (const [key, value] of Object.entries(patch.parameters)) {
      if (value === null) {
        body = body.filter((r) => r[0] !== key);
      } else {
        const row = body.find((r) => r[0] === key);
        if (row) row[1] = value;
        else body.push([key, value, '', '']);
      }
    }
    parameters = serializeCsv([header, ...body]);
  }

  if (patch.courses) {
    const rows = parseCsv(courses);
    const header = rows[0] ?? [];
    const col = (name: string) => header.indexOf(name);
    let body = rows.slice(1);
    for (const op of patch.courses) {
      const matches = (r: string[]) =>
        r[col('course_id')] === op.course_id &&
        (op.rules_effective_term === undefined || r[col('rules_effective_term')] === op.rules_effective_term);
      if (op.remove) {
        body = body.filter((r) => !matches(r));
      } else if (op.set) {
        for (const r of body) {
          if (!matches(r)) continue;
          for (const [k, v] of Object.entries(op.set)) {
            const i = col(k);
            if (i >= 0) r[i] = v;
          }
        }
      }
    }
    courses = serializeCsv([header, ...body]);
  }

  let external = texts.external;
  if (patch.external) {
    // `transferable` is the pre-2026-09-09 single column, kept so the tests can
    // still exercise a sheet that has not been split.
    const header = ['university', 'university_aliases', 'course_id', 'course_title', 'satisfies_core_area', 'transferable', 'transferable_PhD', 'transferable_MSCSE', 'is_cse', 'credit_system', 'nd_credits', 'decided_on', 'notes'];
    external = serializeCsv([header, ...patch.external.map((row) => header.map((h) => row[h] ?? ''))]);
  }
  let universities = texts.universities;
  const uniHeader = ['university', 'credit_system', 'notes'];
  if (patch.universities === null) universities = undefined;
  else if (patch.universities) universities = serializeCsv([uniHeader, ...patch.universities.map((row) => uniHeader.map((h) => row[h] ?? ''))]);
  else if (patch.external && universities !== undefined) {
    // The shorthand: each university's first patched row that names a credit
    // system becomes its Universities row.
    const seen = new Set<string>();
    const rows: string[][] = [];
    for (const row of patch.external) {
      const system = (row['credit_system'] ?? '').trim();
      if (!system || seen.has(row['university'] ?? '')) continue;
      seen.add(row['university'] ?? '');
      rows.push([row['university'] ?? '', system, '']);
    }
    if (rows.length > 0) universities = serializeCsv([uniHeader, ...rows]);
  }
  return {
    courses,
    parameters,
    categories: texts.categories,
    ...(external !== undefined ? { external } : {}),
    ...(universities !== undefined ? { universities } : {}),
  };
}

export function buildRules(patch?: RulesPatch): Rules {
  const texts = applyPatch(fixtureCsvTexts(), patch);
  return rulesFromCsvTexts(texts, { source: 'snapshot', syncedAt: '2026-08-31T00:00:00Z' });
}
