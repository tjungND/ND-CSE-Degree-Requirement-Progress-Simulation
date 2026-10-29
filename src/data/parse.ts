// Header-keyed tab parsers. Never positional: the live Courses tab has 17
// columns, the old samples had 11, and the DGS may insert more — rows are read
// by column name. Malformed cells produce plain-English SheetIssues; prose
// "note rows" at the bottom of a tab are skipped silently.
import { parseTermCode } from '../engine/term.ts';
import type { Term } from '../engine/types.ts';
import { looksNonRegularTitle, looksUndergraduateNumber } from './course-checks.ts';
import { parseCsv } from './csv.ts';
import { normalizeCourseId, normalizeUniversity } from './external.ts';
import type { CourseType, Counts, ExternalRule, RuleCourse, SheetIssue, Transferable, UniversityRow } from './types.ts';
import { RESERVED_GROUP_CODES } from './types.ts';

const COURSE_ID_RE = /^[A-Z]{2,5} \d{5}$/;
const CODE_RE = /^[a-z0-9_]+$/;

const COURSE_TYPES: CourseType[] = ['regular', 'seminar', 'research', 'independent', 'project'];
/** The words the `typically_offered` column may hold (data/README.md). */
const TYPICALLY_OFFERED = ['fall', 'spring', 'both', 'varies'];
const COUNTS: Counts[] = ['yes', 'no', 'dgs_approval', 'adgs_approval'];
const TRANSFERABLE: Transferable[] = ['yes', 'no', 'dgs_approval', 'adgs_approval'];

/** A verdict cell as typed by a human into a spreadsheet. The DGS types these
 * by hand, so "DGS approval", "dgs-approval" and "DGS Approval" all mean
 * `dgs_approval` (2026-09-08 — a rejected cell reads as "not decided", which is
 * safe but silently loses the ruling the DGS thought they had recorded). Case
 * and the separator are all that is forgiven; a different word is still an
 * error the diagnostics report. */
function verdictWord(cell: string | undefined): string {
  return (cell ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

interface Tab {
  header: string[];
  /** [spreadsheetRow, cells-by-header-name] */
  rows: [number, Record<string, string>][];
}

function readTab(text: string, tabName: string, issues: SheetIssue[]): Tab {
  const raw = parseCsv(text);
  const header = (raw[0] ?? []).map((h) => h.trim().toLowerCase());
  const seen = new Set<string>();
  for (const name of header) {
    if (!name) continue;
    if (seen.has(name)) {
      issues.push({
        severity: 'error',
        tab: tabName,
        row: 1,
        column: name,
        message: `The ${tabName} tab's header row has two '${name}' columns — only the first is read; delete or rename one.`,
      });
    }
    seen.add(name);
  }
  const rows: Tab['rows'] = [];
  for (let i = 1; i < raw.length; i++) {
    const cells: Record<string, string> = {};
    for (let c = 0; c < header.length; c++) {
      const name = header[c]!;
      if (name && !(name in cells)) cells[name] = (raw[i]![c] ?? '').trim(); // first column wins
    }
    rows.push([i + 1, cells]); // 1-based spreadsheet row (header is row 1)
  }
  return { header, rows };
}

/** A prose note row: its key cell fails the format check and every other
 * meaningful cell is empty (the sheet's tabs end with explanatory sentences). */
function isNoteRow(cells: Record<string, string>, keyColumn: string, keyRe: RegExp): boolean {
  const key = cells[keyColumn] ?? '';
  if (keyRe.test(key)) return false;
  const others = Object.entries(cells).filter(([name]) => name !== keyColumn);
  return others.every(([, v]) => v === '');
}

function isBlankRow(cells: Record<string, string>): boolean {
  return Object.values(cells).every((v) => v === '');
}

// ---------- Courses tab ----------

/** The §4.4.2 groups a `category_group` cell names (DGS 2026-09-08). One code,
 * several separated by `;` `,` `|` `/` or spaces, `any` for every group, or
 * `ineligible`. Codes are validated later against the Categories tab, so this
 * only splits and tidies; the raw cell is kept for the diagnostics. */
function categoryGroupsOf(cell: string | undefined): {
  categoryGroups?: string[];
  categoryIneligible?: true;
  categoryGroupRaw?: string;
} {
  const raw = (cell ?? '').trim();
  if (raw === '') return {};
  const codes = raw
    .split(/[;,|/\s]+/)
    .map((c) => c.trim().toLowerCase())
    .filter((c) => c !== '');
  if (codes.includes('ineligible')) return { categoryIneligible: true, categoryGroupRaw: raw };
  // (`any` was a third answer here until the DGS retired it on 2026-09-18 — a
  // course listed under every group now names all five, as the live sheet does.
  // A leftover `any` falls through to the list below and validate.ts reports it
  // as a code the Categories tab does not define.)
  return { categoryGroups: [...new Set(codes)], categoryGroupRaw: raw };
}

/** The Courses columns the app reads. A header that is renamed or deleted used
 * to leave every cell of that column blank with NO diagnostic (review R-4,
 * 2026-09-18): renaming `counts_toward_phd` made all 117 live courses read
 * "Not yet decided", renaming `active` brought 204 retired courses back as
 * current, and nothing on either page said a column was missing. The cells are
 * still read by name, so a sheet with EXTRA columns is fine and the order does
 * not matter; only an expected name that is absent is reported. */
const EXPECTED_COURSE_COLUMNS = [
  'course_id',
  'title',
  'course_type',
  'counts_toward_mscse',
  'counts_toward_phd',
  'core_area',
  'category_group',
  'active',
  'dgs_reviewed',
] as const;

export function parseCoursesTab(text: string, issues: SheetIssue[]): RuleCourse[] {
  const tab = readTab(text, 'Courses', issues);
  const out: RuleCourse[] = [];
  if (!tab.header.includes('course_id')) {
    issues.push({
      severity: 'error',
      tab: 'Courses',
      message: 'The Courses tab has no course_id column — is the right tab published?',
    });
    return out;
  }
  // `rules_effective_term` was renamed from `effective_term` on 2026-09-14 and
  // both spellings are read, so it is checked as a pair rather than by name.
  const missing: string[] = EXPECTED_COURSE_COLUMNS.filter((name) => !tab.header.includes(name));
  if (!tab.header.includes('rules_effective_term') && !tab.header.includes('effective_term')) missing.push('rules_effective_term');
  for (const name of missing) {
    issues.push({
      severity: 'error',
      tab: 'Courses',
      row: 1,
      column: name,
      message: `The Courses tab has no '${name}' column (the header row names: ${tab.header.filter((h) => h).join(', ')}). Every row is being read as if that cell were blank — rename the column back, or tell the DGS.`,
    });
  }
  for (const [rowNum, cells] of tab.rows) {
    const courseId = (cells['course_id'] ?? '').toUpperCase().replace(/\s+/g, ' ').trim();
    // Note-row check runs on the NORMALIZED id, so "cse 60641" is a data row
    // (parsed below), not a silently skipped note.
    if (isBlankRow(cells) || isNoteRow({ ...cells, course_id: courseId }, 'course_id', COURSE_ID_RE))
      continue;
    if (!COURSE_ID_RE.test(courseId)) {
      issues.push({
        severity: 'error',
        tab: 'Courses',
        row: rowNum,
        column: 'course_id',
        message: `Courses row ${rowNum}, column course_id: '${cells['course_id']}' is not in the form 'CSE 60641' (department, space, five digits). Row skipped.`,
      });
      continue;
    }

    const bad = (column: string, value: string, allowed: string) => {
      issues.push({
        severity: 'error',
        tab: 'Courses',
        row: rowNum,
        column,
        message: `Courses row ${rowNum} (${courseId}), column ${column}: '${value}' is not one of ${allowed}. Row skipped.`,
      });
    };

    // A blank course_type must not silently become 'regular' (which counts
    // toward the 24 regular credits) — report it and skip the row.
    // Case and separators are forgiven here as everywhere else (review R-5,
    // 2026-09-18): 'Regular' typed into the sheet used to skip the row, so the
    // course vanished from the public list while the DGS saw a filled-in cell.
    const typeRaw = cells['course_type'] ?? '';
    const typeWord = verdictWord(typeRaw);
    if (typeRaw === '') {
      bad('course_type', '(blank)', COURSE_TYPES.join('|'));
      continue;
    }
    if (!COURSE_TYPES.includes(typeWord as CourseType)) {
      bad('course_type', typeRaw, COURSE_TYPES.join('|'));
      continue;
    }
    const courseType = typeWord as CourseType;

    // Same for `active` (review R-5): 'No' was not 'no', so a course the DGS
    // had just retired stayed live on the page — and the warning saying so is
    // one this page never shows.
    const activeRaw = verdictWord(cells['active']);
    if (activeRaw !== '' && activeRaw !== 'yes' && activeRaw !== 'no') {
      issues.push({
        severity: 'warning',
        tab: 'Courses',
        row: rowNum,
        column: 'active',
        message: `Courses row ${rowNum} (${courseId}), column active: '${cells['active'] ?? ''}' is not yes|no — treating it as yes.`,
      });
    }

    const countsOf = (column: string): Counts | undefined | null => {
      const raw = cells[column] ?? '';
      if (raw === '') return undefined; // blank → the app says "needs DGS review"
      const v = verdictWord(raw);
      if (!COUNTS.includes(v as Counts)) {
        bad(column, raw, COUNTS.join('|'));
        return null;
      }
      return v as Counts;
    };
    const countsTowardMscse = countsOf('counts_toward_mscse');
    if (countsTowardMscse === null) continue;
    const countsTowardPhd = countsOf('counts_toward_phd');
    if (countsTowardPhd === null) continue;

    const numberOf = (column: string): number | undefined => {
      const v = cells[column] ?? '';
      if (v === '') return undefined;
      const n = Number(v);
      if (!Number.isFinite(n)) {
        issues.push({
          severity: 'warning',
          tab: 'Courses',
          row: rowNum,
          column,
          message: `Courses row ${rowNum} (${courseId}), column ${column}: '${v}' is not a number — ignored.`,
        });
        return undefined;
      }
      return n;
    };

    let effectiveTerm: Term | undefined;
    // `rules_effective_term` since 2026-09-14 (DGS: the old name did not say
    // WHAT takes effect); the old header is still read so an un-renamed sheet
    // keeps working.
    const termRaw = cells['rules_effective_term'] ?? cells['effective_term'] ?? '';
    if (termRaw !== '') {
      // Either spelling: "Fall 2026" as this column has always taken, or the
      // code the rest of the sheet now uses, "FA26" (2026-09-09).
      effectiveTerm = parseTermCode(termRaw);
      if (!effectiveTerm) {
        issues.push({
          severity: 'warning',
          tab: 'Courses',
          row: rowNum,
          column: 'rules_effective_term',
          message: `Courses row ${rowNum} (${courseId}), column rules_effective_term: '${termRaw}' is not like 'Fall 2026' or 'FA26' — treating the row as always in effect.`,
        });
      }
    }

    // offered_now / offered_next (DGS 2026-09-09): is the course on the
    // schedule this semester, and the next one? A blank cell is UNDEFINED —
    // the sheet has not said — which the course-rules page treats as "not
    // listed as offered", never as a promise that it is not.
    const offeredOf = (column: 'offered_now' | 'offered_next'): boolean | undefined => {
      const v = verdictWord(cells[column]);
      if (v === '') return undefined;
      if (v === 'yes') return true;
      if (v === 'no') return false;
      // Not `bad()`: that one says "Row skipped", and only this cell is.
      issues.push({
        severity: 'error',
        tab: 'Courses',
        row: rowNum,
        column,
        message: `Courses row ${rowNum} (${courseId}), column ${column}: '${cells[column] ?? ''}' is not 'yes', 'no' or blank. That cell is ignored — the course is not listed as offered.`,
      });
      return undefined;
    };
    const offeredNow = offeredOf('offered_now');
    const offeredNext = offeredOf('offered_next');
    // `last_offered` dates the two columns (DGS 2026-09-14). "Fall 2026" or
    // "FA26"; anything else leaves the row undated, and a dated schedule
    // column on an undated row is reported so the DGS sees why it is not shown.
    const lastOffered = (cells['last_offered'] ?? '').trim() === '' ? undefined : parseTermCode(cells['last_offered']!);
    if ((offeredNow !== undefined || offeredNext !== undefined) && lastOffered === undefined) {
      issues.push({
        severity: 'warning',
        tab: 'Courses',
        row: rowNum,
        column: 'last_offered',
        message: `Courses row ${rowNum} (${courseId}): offered_now / offered_next is set but last_offered ('${cells['last_offered'] ?? ''}') is not a term like 'Fall 2026'. The schedule columns are dated by last_offered, so this row is not shown on the schedule cards until it is.`,
      });
    }

    // `typically_offered` is printed verbatim in a column of its own and is a
    // sort key, so an unexpected value passed straight through to the reader
    // (review B-12, 2026-09-18) — including one that is a property of Object's
    // prototype, which sorted the whole table into nothing. Known words are
    // kept as written; anything else is reported and dropped, the same answer
    // the page gives for a blank cell ("—").
    const offeredRaw = (cells['typically_offered'] ?? '').trim();
    const offeredWord = offeredRaw.toLowerCase();
    const typicallyOffered = offeredRaw === '' ? undefined : TYPICALLY_OFFERED.includes(offeredWord) ? offeredWord : undefined;
    if (offeredRaw !== '' && typicallyOffered === undefined) {
      issues.push({
        severity: 'warning',
        tab: 'Courses',
        row: rowNum,
        column: 'typically_offered',
        message: `Courses row ${rowNum} (${courseId}), column typically_offered: '${offeredRaw}' is not one of ${TYPICALLY_OFFERED.join('|')} — the cell is ignored and the course shows no typical semester.`,
      });
    }

    const levelFromId = Number(courseId.split(' ')[1]![0]);
    out.push({
      courseId,
      title: cells['title'] ?? '',
      level: numberOf('level') ?? levelFromId,
      creditMin: numberOf('credit_min'),
      creditMax: numberOf('credit_max'),
      creditsDefault: numberOf('credits_default'),
      courseType,
      countsTowardMscse,
      countsTowardPhd,
      coreArea: cells['core_area'] || undefined,
      ...categoryGroupsOf(cells['category_group']),
      typicallyOffered,
      ...(offeredNow !== undefined ? { offeredNow } : {}),
      ...(offeredNext !== undefined ? { offeredNext } : {}),
      ...(lastOffered !== undefined ? { lastOffered } : {}),
      active: activeRaw !== 'no',
      effectiveTerm,
      notes: cells['notes'] || undefined,
      dgsReviewed: (cells['dgs_reviewed'] ?? '').trim().toLowerCase() === 'yes',
      sheetRow: rowNum,
    });
  }
  return out;
}

// ---------- Parameters tab ----------

export function parseParametersTab(
  text: string,
  issues: SheetIssue[],
): Map<string, { value: string; section: string; row: number }> {
  const tab = readTab(text, 'Parameters', issues);
  const out = new Map<string, { value: string; section: string; row: number }>();
  for (const [rowNum, cells] of tab.rows) {
    if (isBlankRow(cells) || isNoteRow(cells, 'key', CODE_RE)) continue;
    const key = cells['key'] ?? '';
    if (!CODE_RE.test(key)) {
      issues.push({
        severity: 'error',
        tab: 'Parameters',
        row: rowNum,
        column: 'key',
        message: `Parameters row ${rowNum}, column key: '${key}' is not a lowercase_underscore key. Row skipped.`,
      });
      continue;
    }
    if (out.has(key)) {
      issues.push({
        severity: 'error',
        tab: 'Parameters',
        row: rowNum,
        column: 'key',
        message: `Parameters row ${rowNum}: key '${key}' appears more than once — using the first value.`,
      });
      continue;
    }
    out.set(key, { value: cells['value'] ?? '', section: cells['handbook_section'] ?? '', row: rowNum });
  }
  return out;
}

// ---------- Categories tab (two lists side by side) ----------

export function parseCategoriesTab(
  text: string,
  issues: SheetIssue[],
): { coreAreas: { code: string; name: string }[]; categoryGroups: { code: string; name: string }[] } {
  const tab = readTab(text, 'Categories', issues);
  const coreAreas: { code: string; name: string }[] = [];
  const categoryGroups: { code: string; name: string }[] = [];
  const dup = (column: string, code: string, rowNum: number) =>
    issues.push({
      severity: 'error',
      tab: 'Categories',
      row: rowNum,
      column,
      message: `Categories row ${rowNum}: the code '${code}' appears twice in ${column} — using the first entry.`,
    });
  for (const [rowNum, cells] of tab.rows) {
    // Each half is read independently; a prose note row has an invalid code in
    // one half and nothing in the other, so both halves just skip it.
    const core = cells['core_area'] ?? '';
    if (CODE_RE.test(core)) {
      if (coreAreas.some((c) => c.code === core)) dup('core_area', core, rowNum);
      else coreAreas.push({ code: core, name: cells['core_area_name'] || core });
    } else if (core !== '' && (cells['core_area_name'] ?? '') !== '') {
      issues.push({
        severity: 'error',
        tab: 'Categories',
        row: rowNum,
        column: 'core_area',
        message: `Categories row ${rowNum}, column core_area: '${core}' is not a lowercase code. Entry skipped.`,
      });
    }
    const group = cells['category_group'] ?? '';
    if (CODE_RE.test(group)) {
      // 'ineligible' may sit in this list for the sheet's own dropdowns, but
      // it is NOT a matchable §4.4.2 group.
      if (!(RESERVED_GROUP_CODES as readonly string[]).includes(group)) {
        if (categoryGroups.some((c) => c.code === group)) dup('category_group', group, rowNum);
        else categoryGroups.push({ code: group, name: cells['category_group_name'] || group });
      }
    } else if (group !== '' && (cells['category_group_name'] ?? '') !== '') {
      issues.push({
        severity: 'error',
        tab: 'Categories',
        row: rowNum,
        column: 'category_group',
        message: `Categories row ${rowNum}, column category_group: '${group}' is not a lowercase code. Entry skipped.`,
      });
    }
  }
  // Two different codes carrying the SAME name are two cards with one heading,
  // two identical filter options and two identical "Specialization" labels,
  // with nothing on the page to tell them apart (review B-38, 2026-09-18).
  // The codes are distinct, so this is a naming slip rather than a broken
  // sheet: both entries are kept and the diagnostics say which.
  for (const [column, list] of [
    ['core_area_name', coreAreas],
    ['category_group_name', categoryGroups],
  ] as const) {
    const byName = new Map<string, string[]>();
    for (const entry of list) {
      const key = entry.name.trim().toLowerCase();
      const codes = byName.get(key);
      if (codes) codes.push(entry.code);
      else byName.set(key, [entry.code]);
    }
    for (const [name, codes] of byName) {
      if (codes.length > 1) {
        issues.push({
          severity: 'warning',
          tab: 'Categories',
          column,
          message: `Categories, column ${column}: ${codes.map((c) => `'${c}'`).join(' and ')} share the name '${name}'. Readers see two identical headings and two identical filter choices — give each one its own name.`,
        });
      }
    }
  }
  return { coreAreas, categoryGroups };
}

// ---------- ExternalCourses tab (courses at other universities, §4.4.1/§5.2) ----------

export function parseExternalTab(
  text: string,
  coreAreas: { code: string; name: string }[],
  issues: SheetIssue[],
): ExternalRule[] {
  const tab = readTab(text, 'ExternalCourses', issues);
  const out: ExternalRule[] = [];
  const err = (rowNum: number, column: string, message: string) =>
    issues.push({ severity: 'error', tab: 'ExternalCourses', row: rowNum, column, message });

  let aliasContentSeen = false;
  for (const [rowNum, cells] of tab.rows) {
    if (isBlankRow(cells)) continue;
    if ((cells['university_aliases'] ?? '').trim() !== '') aliasContentSeen = true;
    const university = cells['university'] ?? '';
    const courseId = cells['course_id'] ?? '';
    // Prose note rows (the tab ends with explanatory sentences): a filled
    // university cell with everything else empty.
    if (university !== '' && courseId === '' && Object.entries(cells).every(([k, v]) => k === 'university' || v === '')) continue;
    if (university === '' || courseId === '') {
      err(rowNum, university === '' ? 'university' : 'course_id',
        `ExternalCourses row ${rowNum} is missing its ${university === '' ? 'university' : 'course_id'} — row skipped.`);
      continue;
    }

    const rule: ExternalRule = {
      university,
      universityKey: normalizeUniversity(university),
      courseId,
      title: cells['course_title'] ?? '',
      decidedOn: cells['decided_on'] || undefined,
      notes: cells['notes'] || undefined,
      sheetRow: rowNum,
    };

    // satisfies_core_area: a core-area code, `none` (decided: no core area —
    // DGS 2026-09-06, so a core-sounding title stops asking for a ruling), or
    // blank (not decided yet — the course stays in the review request).
    const core = (cells['satisfies_core_area'] ?? '').trim().toLowerCase();
    if (core === 'none') rule.satisfiesCoreArea = null;
    else if (core !== '') {
      if (coreAreas.some((a) => a.code === core)) rule.satisfiesCoreArea = core;
      else {
        err(rowNum, 'satisfies_core_area',
          `ExternalCourses row ${rowNum} (${university} ${courseId}): satisfies_core_area '${core}' is not one of the Categories tab's core areas (${coreAreas.map((a) => a.code).join(', ')}), 'none' or blank. That cell is ignored.`);
      }
    }

    // transferable_PhD / transferable_MSCSE (DGS 2026-09-09; one `transferable`
    // column until then, and a sheet still using it fills both): `yes`
    // (pre-approved), `no` (ruled out), `dgs_approval` or `adgs_approval` (this
    // one needs an approval before it counts), or blank (not decided for that
    // program).
    const transferableOf = (column: string): Transferable | undefined => {
      const v = verdictWord(cells[column]);
      if (v === '') return undefined;
      if (TRANSFERABLE.includes(v as Transferable)) return v as Transferable;
      err(rowNum, column,
        `ExternalCourses row ${rowNum} (${university} ${courseId}): ${column} must be ${TRANSFERABLE.map((t) => `'${t}'`).join(', ')} or blank (undecided) — got '${cells[column]}'. That cell is ignored.`);
      return undefined;
    };
    const bothPrograms = transferableOf('transferable');
    const transferablePhd = transferableOf('transferable_phd') ?? bothPrograms;
    const transferableMscse = transferableOf('transferable_mscse') ?? bothPrograms;
    if (transferablePhd !== undefined) rule.transferablePhd = transferablePhd;
    if (transferableMscse !== undefined) rule.transferableMscse = transferableMscse;

    // is_cse (DGS 2026-09-09): does this course belong to a CSE department,
    // for §4.2's nine-credit allowance for courses "taken from a department
    // other than CSE"? The Parameters key `cse_subject_codes` settles the
    // codes (ECE among them on purpose since 2026-10-04: "a department other
    // than CSE" means outside computing); this cell is the ruling for one
    // course and wins over it. Blank = the list decides (external.ts
    // isCseCourse; P4-data-6).
    const cse = verdictWord(cells['is_cse']);
    if (cse === 'yes' || cse === 'no') rule.isCse = cse === 'yes';
    else if (cse !== '') {
      err(rowNum, 'is_cse',
        `ExternalCourses row ${rowNum} (${university} ${courseId}): is_cse must be 'yes', 'no' or blank (the subject code decides) — got '${cells['is_cse']}'. That cell is ignored.`);
    }

    // nd_credits: a FIXED Notre Dame value for this one course. It cannot
    // describe a course whose credits vary (2 to 4), which is what
    // credit_system is for (DGS 2026-09-08); a value here still wins.
    const nd = cells['nd_credits'] ?? '';
    if (nd !== '') {
      const n = Number(nd);
      // Above 0: a course worth no Notre Dame credit is a `no`, not a 0 — a 0
      // counted nothing with no reason, and the request filed the course
      // "over the transfer cap" (credit-transfer review 2026-10-28, #67).
      if (Number.isFinite(n) && n > 0 && n <= 30) rule.ndCredits = n;
      else err(rowNum, 'nd_credits', `ExternalCourses row ${rowNum} (${university} ${courseId}): nd_credits '${nd}' is not a number above 0 and at most 30 (a course that should not count is a 'no' in transferable_PhD / transferable_MSCSE). That cell is ignored (the course's credits count from its transcript).`);
    }

    // credit_system: the OLD per-course cell (DGS 2026-09-08 until
    // 2026-10-10). Each university's system is set once in the Universities tab
    // now; this cell is kept on the rule so a sheet without that tab still
    // converts, and so assemble.ts can say the column is no longer read.
    const system = (cells['credit_system'] ?? '').trim().toLowerCase();
    if (system === 'quarter' || system === 'semester' || system === 'trimester') rule.creditSystem = system;
    else if (system !== '') {
      err(rowNum, 'credit_system',
        `ExternalCourses row ${rowNum} (${university} ${courseId}): credit_system must be 'quarter', 'trimester', 'semester' or blank — got '${system}'. That cell is ignored (credits count as printed, unless the course's own transcript reading, or the student's choice at import, says quarter or trimester).`);
    }

    // A ruling the DGS may not have meant (2026-10-04, P1-sheet-48 / -c2 and
    // IIT CS 455; course-checks.ts): an undergraduate-looking number on any row
    // that lets the course count (yes or case by case), or — on a `yes` — a title
    // that suggests independent study, research or a seminar. Warnings only.
    const countsAs = (t: Transferable | undefined): string | undefined =>
      t === 'yes' ? 'yes' : t === 'dgs_approval' || t === 'adgs_approval' ? 'case by case' : undefined;
    const counting = [
      countsAs(rule.transferablePhd) ? `the Ph.D. (${countsAs(rule.transferablePhd)})` : '',
      countsAs(rule.transferableMscse) ? `the MSCSE (${countsAs(rule.transferableMscse)})` : '',
    ].filter(Boolean);
    if (counting.length > 0 && looksUndergraduateNumber(courseId)) {
      issues.push({
        severity: 'warning',
        tab: 'ExternalCourses',
        row: rowNum,
        message: `ExternalCourses row ${rowNum}: ${university} ${courseId} may count for ${counting.join(' and ')}, but its number looks like an undergraduate course — only graduate courses transfer (Academic Code §4.6). Check that it is the graduate version.`,
      });
    }
    if (rule.transferablePhd === 'yes' || rule.transferableMscse === 'yes') {
      const which = [rule.transferablePhd === 'yes' ? 'Ph.D.' : '', rule.transferableMscse === 'yes' ? 'MSCSE' : ''].filter(Boolean).join(' and ');
      if (looksNonRegularTitle(rule.title)) {
        issues.push({
          severity: 'warning',
          tab: 'ExternalCourses',
          row: rowNum,
          message: `ExternalCourses row ${rowNum}: ${university} ${courseId} “${rule.title}” transfers for the ${which} (yes) and would count toward the regular-course credits, but its title suggests independent study, research or a seminar, which are not regular courses (§3.2, §4.2). Check it.`,
        });
      }
    }

    // Two rows for the same university + course: the LAST row wins (DGS
    // 2026-09-06 — a corrected row pasted below an old one takes effect),
    // with a warning so the older row can be deleted.
    const dupIndex = out.findIndex(
      (r) => r.universityKey === rule.universityKey && normalizeCourseId(r.courseId) === normalizeCourseId(courseId),
    );
    if (dupIndex >= 0) {
      const dup = out[dupIndex]!;
      issues.push({
        severity: 'warning',
        tab: 'ExternalCourses',
        row: rowNum,
        message: `ExternalCourses row ${rowNum} repeats ${university} ${courseId} (already in row ${dup.sheetRow}) — the last row wins: row ${rowNum} replaces row ${dup.sheetRow}; delete the older one.`,
      });
      out.splice(dupIndex, 1, rule);
      continue;
    }
    out.push(rule);
  }
  if (aliasContentSeen) {
    issues.push({
      severity: 'warning',
      tab: 'ExternalCourses',
      column: 'university_aliases',
      message:
        'The university_aliases column is no longer used (decision 2026-09-03): courses are matched by the ' +
        'university name exactly as the transcript prints it. The column can be deleted.',
    });
  }
  return out;
}

/** The Universities tab (DGS 2026-10-10): one row per university —
 * `university` (exactly as the ExternalCourses tab and the transcript import
 * read it), `credit_system` (quarter, trimester, semester or blank) and
 * `notes` (the DGS's own; not shown). It replaces the per-course
 * `credit_system` cell of ExternalCourses, so a university's system is entered
 * once and also covers its courses the DGS has not ruled on yet.
 *
 * 'quarter' converts whatever the student's transcript prints, so a
 * 2-to-4-credit course converts correctly every time (DGS 2026-09-08; §5.2
 * "pro-rata"). Two rows for one university: the LAST wins, with a warning —
 * the ExternalCourses tab's rule (DGS 2026-09-06). */
export function parseUniversitiesTab(text: string, issues: SheetIssue[]): UniversityRow[] {
  const tab = readTab(text, 'Universities', issues);
  const out: UniversityRow[] = [];
  const err = (rowNum: number, column: string, message: string) =>
    issues.push({ severity: 'error', tab: 'Universities', row: rowNum, column, message });
  // A renamed or missing column must not pass for "no system set" (review
  // 2026-10-10): every quarter university would then count its credits as
  // printed with nothing said.
  const missing = ['university', 'credit_system'].filter((name) => !tab.header.includes(name));
  for (const name of missing) {
    err(1, name,
      `The Universities tab has no '${name}' column (the header row names: ${tab.header.filter((h) => h).join(', ') || 'nothing'}). ` +
        `No university's credit system can be read — every other university's credits count as printed — unless a course's own transcript reading, or the student's choice at import, says quarter or trimester — until the column is named '${name}' again.`);
  }
  if (missing.length > 0) return out;
  for (const [rowNum, cells] of tab.rows) {
    if (isBlankRow(cells)) continue;
    const university = cells['university'] ?? '';
    // A sentence at the foot of the tab (the sheets end with explanatory
    // notes): every other cell empty and the text reads as prose — long, or a
    // sentence that ends in a full stop. A university listed with its system
    // still blank is a real row and is kept.
    if (Object.entries(cells).every(([k, v]) => k === 'university' || v === '') && (university.length > 90 || (/[.!?:]\s*$/.test(university) && university.split(/\s+/).length >= 6))) continue;
    if (university === '') {
      err(rowNum, 'university', `Universities row ${rowNum} has no university — row skipped.`);
      continue;
    }
    const row: UniversityRow = { university, universityKey: normalizeUniversity(university), sheetRow: rowNum };
    if (row.universityKey === '') {
      err(rowNum, 'university', `Universities row ${rowNum}: '${university}' is not a university name the app can match — row skipped.`);
      continue;
    }
    const system = (cells['credit_system'] ?? '').trim().toLowerCase();
    if (system === 'quarter' || system === 'semester' || system === 'trimester') row.creditSystem = system;
    else if (system !== '') {
      err(rowNum, 'credit_system',
        `Universities row ${rowNum} (${university}): credit_system must be 'quarter', 'trimester', 'semester' or blank — got '${cells['credit_system']}'. That cell is ignored (credits from ${university} count as printed, unless a course's own transcript reading, or the student's choice at import, says quarter or trimester).`);
    }
    if (cells['notes']) row.notes = cells['notes'];
    const dupIndex = out.findIndex((r) => r.universityKey === row.universityKey);
    if (dupIndex >= 0) {
      const dup = out[dupIndex]!;
      issues.push({
        severity: 'warning',
        tab: 'Universities',
        row: rowNum,
        message: `Universities row ${rowNum} repeats ${university} (already in row ${dup.sheetRow}) — the last row wins: row ${rowNum} replaces row ${dup.sheetRow}; delete the older one.`,
        // The last row wins, and the pages say so (DGS 2026-10-12).
        onPage: true,
      });
      out.splice(dupIndex, 1, row);
      continue;
    }
    out.push(row);
  }
  if (out.length === 0) {
    issues.push({
      severity: 'warning',
      tab: 'Universities',
      // What the engine does (credit-transfer review 2026-10-28, #68): a course
      // whose transcript read quarter or trimester hours still converts.
      message: 'The Universities tab has no rows — every other university’s credits count as printed, unless a course’s own transcript reading, or the student’s choice at import, says quarter or trimester (a quarter or trimester university needs its row there).',
    });
  }
  return out;
}
