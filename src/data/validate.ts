// Cross-tab validation + semantic warnings. Everything lands in Rules.issues as
// plain English for the DGS diagnostics panel.
import { termIndex } from '../engine/term.ts';
import type { RuleCourse, SheetIssue } from './types.ts';
import { RESERVED_GROUP_CODES } from './types.ts';

export function validateCourses(
  courses: RuleCourse[],
  coreAreas: { code: string }[],
  categoryGroups: { code: string }[],
  issues: SheetIssue[],
): RuleCourse[] {
  const coreCodes = new Set(coreAreas.map((c) => c.code));
  const groupCodes = new Set([...categoryGroups.map((c) => c.code), ...RESERVED_GROUP_CODES]);

  const kept: RuleCourse[] = [];
  // Two rows for one course and rules_effective_term: the LAST row wins, as
  // in the ExternalCourses and Universities tabs, with a warning the web
  // pages show until the older row is deleted (DGS 2026-10-13: "Yes. Follow
  // with the same on-page warning." — it used to keep the first, as an error).
  const dupKeyOf = (c: RuleCourse): string => `${c.courseId}|${c.effectiveTerm ? termIndex(c.effectiveTerm) : 'always'}`;
  const lastOf = new Map<string, RuleCourse>();
  for (const c of courses) lastOf.set(dupKeyOf(c), c);
  for (let c of courses) {
    const last = lastOf.get(dupKeyOf(c))!;
    if (last !== c) {
      issues.push({
        severity: 'warning',
        tab: 'Courses',
        row: last.sheetRow,
        message: `Courses row ${last.sheetRow} repeats ${c.courseId} with the same rules_effective_term (already in row ${c.sheetRow}) — the last row wins: row ${last.sheetRow} replaces row ${c.sheetRow}; delete the older one.`,
        onPage: true,
      });
      continue;
    }

    if (c.coreArea && !coreCodes.has(c.coreArea)) {
      issues.push({
        severity: 'error',
        tab: 'Courses',
        row: c.sheetRow,
        column: 'core_area',
        message: `Courses row ${c.sheetRow} (${c.courseId}), column core_area: '${c.coreArea}' is not in the Categories tab's core list (${[...coreCodes].join(', ')}) — ignored.`,
      });
      c = { ...c, coreArea: undefined };
    }
    // A cell may now name several groups (DGS 2026-09-08): each code is
    // checked on its own, the good ones are kept, and only the bad ones are
    // reported — a typo in one code must not throw away the others.
    if (c.categoryGroups && c.categoryGroups.length > 0) {
      const bad = c.categoryGroups.filter((g) => !groupCodes.has(g));
      if (bad.length > 0) {
        issues.push({
          severity: 'error',
          tab: 'Courses',
          row: c.sheetRow,
          column: 'category_group',
          message: `Courses row ${c.sheetRow} (${c.courseId}), column category_group: ${bad.map((g) => `'${g}'`).join(', ')} ${bad.length === 1 ? 'is' : 'are'} not in the Categories tab's group list (${[...groupCodes].join(', ')}) — ignored. A cell may name one group, or several separated by ';'.`,
        });
        const goodGroups = c.categoryGroups.filter((g) => groupCodes.has(g));
        c = { ...c, ...(goodGroups.length > 0 ? { categoryGroups: goodGroups } : { categoryGroups: undefined }) };
      }
    }

    // `ineligible` with a group code beside it is a cell that says two
    // opposite things (review R-12, 2026-09-18). `ineligible` wins, silently,
    // so a course the DGS meant to list under Algorithms disappears from that
    // card — with the raw cell still reading "alg; ineligible" in the sheet.
    if (c.categoryIneligible && /[a-z]/i.test((c.categoryGroupRaw ?? '').replace(/ineligible/gi, ''))) {
      issues.push({
        severity: 'warning',
        tab: 'Courses',
        row: c.sheetRow,
        column: 'category_group',
        message: `Courses row ${c.sheetRow} (${c.courseId}), column category_group: '${c.categoryGroupRaw}' says 'ineligible' AND names a group. 'ineligible' wins — the course satisfies no §4.4.2 category. Delete one of the two.`,
      });
    }

    // A course marked as running this semester or next while its `active` cell
    // says it is retired (review B-4, 2026-09-18). The schedule cards show
    // live rows only, so the course silently went missing from the card the
    // sheet had just put it on — four live rows were in this state.
    if (!c.active && (c.offeredNow === true || c.offeredNext === true)) {
      issues.push({
        severity: 'warning',
        tab: 'Courses',
        row: c.sheetRow,
        column: 'active',
        message: `Courses row ${c.sheetRow} (${c.courseId}): active is 'no' (retired) but ${c.offeredNow === true && c.offeredNext === true ? 'offered_now and offered_next are' : c.offeredNow === true ? 'offered_now is' : 'offered_next is'} 'yes'. A retired course is not shown on the schedule cards, so those cells have no effect — clear them, or set active to 'yes'.`,
      });
    }

    // §3.6.1: "CSE 50xxx courses are preparatory and do not count toward the
    // MSCSE degree requirements" — the engine refuses a CSE 5xxxx course on the
    // MSCSE tab whatever this cell says (DGS 2026-10-03), so anything but `no`
    // here is a cell with no effect.
    if (c.level === 5 && /^CSE\b/i.test(c.courseId) && c.countsTowardMscse !== undefined && c.countsTowardMscse !== 'no') {
      issues.push({
        severity: 'warning',
        tab: 'Courses',
        row: c.sheetRow,
        column: 'counts_toward_mscse',
        message: `Courses row ${c.sheetRow} (${c.courseId}): a 50000-level CSE course, but counts_toward_mscse is '${c.countsTowardMscse}'. §3.6.1 says CSE 50xxx courses do not count toward the MSCSE, so the app refuses it on the MSCSE tab whatever this cell says — set it to 'no'.`,
      });
    }

    // Below the 40000 level nothing earns graduate credit (Academic Code §4.1),
    // whatever the verdict cell says — the engine refuses such a course since
    // 2026-10-03, so a `yes` or an approval here is a cell with no effect.
    if (c.level !== undefined && c.level < 4 && (c.countsTowardMscse !== undefined && c.countsTowardMscse !== 'no' || c.countsTowardPhd !== undefined && c.countsTowardPhd !== 'no')) {
      issues.push({
        severity: 'warning',
        tab: 'Courses',
        row: c.sheetRow,
        column: 'counts_toward_mscse / counts_toward_phd',
        message: `Courses row ${c.sheetRow} (${c.courseId}): level ${c.level}, but a counts_toward cell is not 'no'. No course below the 40000 level earns graduate credit (Academic Code §4.1), so the app counts it toward nothing — set both cells to 'no'.`,
      });
    }

    // Semantic sniff: a research/seminar-titled course typed 'regular' would
    // count toward the 24 regular credits (§3.2/§4.2) — almost certainly a
    // sheet mistake (the live sheet has several such rows).
    if (c.courseType === 'regular' && /\b(research|dissertation|seminar|thesis)\b/i.test(c.title)) {
      issues.push({
        severity: 'warning',
        tab: 'Courses',
        row: c.sheetRow,
        column: 'course_type',
        message: `Courses row ${c.sheetRow} (${c.courseId} "${c.title}"): course_type is 'regular', but the title sounds like research/seminar work, which §3.2/§4.2 exclude from regular courses. Double-check this row.`,
      });
    }
    kept.push(c);
  }
  return kept;
}
