// The public course list: which CSE graduate courses count toward the MSCSE
// (§3) and Ph.D. (§4), which Ph.D. Qualifying Examination component each can
// satisfy — core knowledge (§4.4.1) or specialization category (§4.4.2), both
// parts of the §4.4 qualifying exam, not degree-credit tags — when it is
// typically offered, and whether the DGS has confirmed the row. Everything
// shown comes from the Courses tab of the rules sheet (via the same loader as
// the audit page); this file only presents it. No student data is involved.
import type { NotreDameNow } from '../data/clock.ts';
import { resolveRuleRow } from '../data/assemble.ts';
import type { CourseType, Counts, RuleCourse, Rules } from '../data/types.ts';
import type { Term } from '../engine/types.ts';
import { termLabel, termOfDate } from '../engine/term.ts';
import { rowSchedule, scheduleTerms, type RowFreshness, type RowSchedule } from './schedule-terms.ts';

// (A local `afterTeachingTermBack` lived here until 2026-09-18 — a second copy
// of schedule-terms.ts's own arithmetic, kept only for a sentence about
// one-semester-behind rows that the DGS's `last_offered` ruling retired.)
import { LICENSE_URL, REPO_URL, applyContactOverrides, contactCard, mailto, reportToDgs } from './contacts.ts';
import { clear, el, option } from './dom.ts';
import { SIBLING_PARAM, allowedHostPage, siblingAnchorAttrs } from './sibling-links.ts';
import { isEmbedded, notifyEmbedHeight, openFullPageLink, postScrollTo, startAnchorScrollRelay } from './embed.ts';
import { sectionRef } from './section-ref.ts';
import { themeToggle } from './theme.ts';
import { formatYmdLong, handbookLink, rulesDateLine } from './handbook.ts';
import { resultStamp, stampLine } from './stamp.ts';
import { ndDateOnly } from '../data/rules-date.ts';
import { sheetSourceLine } from './sheet-source.ts'; // sheetSourceNote is the self-check page's now (trim review P-12)
import { labelCitationsIn } from './citations.ts';

// ---------- labels (sheet codes → words students understand) ----------

const COUNTS_LABEL: Record<Counts, string> = {
  yes: 'Yes',
  no: 'No',
  dgs_approval: 'With DGS approval',
  adgs_approval: 'With ADGS approval', // the sheet names the reviewer per course (2026-09-12)
};
// The two reviewers get two colours (DGS 2026-09-16): blue for the DGS, purple for the ADGS.
const COUNTS_CLASS: Record<Counts, string> = { yes: 'yes', no: 'no', dgs_approval: 'approval', adgs_approval: 'approval-adgs' };

const TYPE_LABEL: Record<CourseType, string> = {
  regular: 'Regular course',
  seminar: 'Seminar',
  research: 'Research',
  independent: 'Independent study',
  project: 'Project',
};

const OFFERED_LABEL: Record<string, string> = {
  fall: 'Fall',
  spring: 'Spring',
  both: 'Fall and spring',
  varies: 'Varies',
};

const SORT_KEYS = ['course', 'title', 'type', 'mscse', 'phd', 'core', 'category', 'offered', 'reviewed'] as const;
type SortKey = (typeof SORT_KEYS)[number];

/** What the reader is checking (usability review 2026-09-05, item 30): the
 * table shows only the columns that answer that question. */
type View = 'all' | 'mscse' | 'phd' | 'qualifier';

interface Filters {
  query: string;
  program: 'all' | 'mscse' | 'phd';
  core: string; // '' = any
  category: string; // '' = any
  type: string; // '' = any
  /** '' = any semester; 'now' = on this semester's schedule; 'next' = on the
   * next one's (DGS 2026-09-09, the sheet's offered_now / offered_next). */
  offered: '' | 'now' | 'next';
  includeRetired: boolean;
  confirmedOnly: boolean;
  sort: SortKey;
  desc: boolean;
  view: View;
}

// Short noun phrases: a dropdown is scanned, not read, and the label above it
// already asks the question — every option used to begin "Whether a course …",
// so the eye reached the eighth word before they differed (trim review P-7,
// 2026-09-18). These are the column headers' own words.
const VIEW_LABEL: Record<View, string> = {
  all: 'Everything',
  mscse: 'MSCSE degree credit',
  phd: 'Ph.D. degree credit',
  qualifier: 'Ph.D. qualifier areas (§4.4)',
};
/** Columns hidden per view, by their 1-based position in the table. */
const HIDDEN_COLUMNS: Record<View, number[]> = {
  all: [],
  mscse: [5, 6, 7], // Ph.D. credit, core knowledge, specialization
  phd: [4, 6, 7], // MSCSE credit, core knowledge, specialization
  // The intro above the cards says degree credit is "answered in the table
  // below", so the qualifier view must not be the one place it is hidden
  // (review R-17, 2026-09-18). Only the type and the planning hint go.
  qualifier: [3, 8], // type, typically offered
};

/** The filters as URL query parameters (item 29), so an advisor can send a
 * student a link straight to "the algorithms courses" or "pending rows":
 * courses.html?q=…&program=…&core=…&category=…&type=…&retired=1&confirmed=1&sort=…&desc=1&view=…
 * Only non-default values are written; unknown values fall back to defaults. */
function filtersFromUrl(defaults: Filters, validCores: Set<string>, validCategories: Set<string>): Filters {
  const f = { ...defaults };
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(window.location.search);
  } catch {
    return f;
  }
  // Trimmed, so a link carrying only spaces does not open a page that says
  // "Filters are active" over an apparently empty search box (review B-15).
  const q = params.get('q')?.trim();
  if (q) f.query = q.slice(0, 80);
  const program = params.get('program')?.toLowerCase();
  if (program === 'mscse' || program === 'phd') f.program = program;
  // The sheet's own codes are case-insensitive everywhere else, so a link
  // with ?core=OS must not quietly open the unfiltered list (review B-32).
  const core = params.get('core')?.trim().toLowerCase();
  if (core && validCores.has(core)) f.core = core;
  const category = params.get('category')?.trim().toLowerCase();
  if (category && validCategories.has(category)) f.category = category;
  // One control now carries both (trim review P-22, 2026-09-18), so it can
  // hold one of them at a time. A link written before that, or by hand, with
  // BOTH keeps its core area — the narrower of the two, and the one at most
  // three courses on today's sheet could satisfy together.
  if (f.core && f.category) f.category = '';
  const type = params.get('type')?.trim().toLowerCase();
  if (type && Object.keys(TYPE_LABEL).includes(type)) f.type = type;
  const offered = params.get('offered');
  if (offered === 'now' || offered === 'next') f.offered = offered;
  // NOTE: whether either value still MEANS anything depends on today's date
  // and on each row's own `last_offered` (the sheet-wide `current_semester`
  // was retired on 2026-09-14); a link saved last semester is dropped below,
  // where the answer is known.
  if (params.get('retired') === '1') f.includeRetired = true;
  if (params.get('confirmed') === '1') f.confirmedOnly = true;
  const sort = params.get('sort')?.trim().toLowerCase();
  if (sort && (SORT_KEYS as readonly string[]).includes(sort)) f.sort = sort as SortKey;
  if (params.get('desc') === '1') f.desc = true;
  const view = params.get('view')?.trim().toLowerCase();
  if (view && Object.keys(VIEW_LABEL).includes(view)) f.view = view as View;
  // A link that asks for the M.S. view AND the Ph.D. program describes a page
  // that cannot exist: the status line would name one degree over a list
  // filtered by the other, with that degree's column hidden (review B-11).
  // The view picks the columns, so it wins — and the contradicting program is
  // CLEARED rather than switched, which would hide the rows whose answer for
  // the chosen degree is "No" (trim review P-19).
  if ((f.view === 'mscse' || f.view === 'phd') && f.program !== 'all' && f.program !== f.view) f.program = 'all';
  return f;
}

function filtersToUrl(f: Filters, defaults: Filters): void {
  const params = new URLSearchParams();
  if (f.query !== defaults.query) params.set('q', f.query);
  if (f.program !== defaults.program) params.set('program', f.program);
  if (f.core !== defaults.core) params.set('core', f.core);
  if (f.category !== defaults.category) params.set('category', f.category);
  if (f.type !== defaults.type) params.set('type', f.type);
  if (f.offered !== defaults.offered) params.set('offered', f.offered);
  if (f.includeRetired) params.set('retired', '1');
  if (f.confirmedOnly) params.set('confirmed', '1');
  if (f.sort !== defaults.sort) params.set('sort', f.sort);
  if (f.desc) params.set('desc', '1');
  if (f.view !== defaults.view) params.set('view', f.view);
  // Embed mode is part of the address, not a filter: without this the first
  // render would strip `?embed=1` from the frame's URL, and the next reload
  // inside the frame would come back with the full page chrome (2026-09-16).
  if (isEmbedded()) params.set('embed', '1');
  // So is the embed's host-page URL (sibling-links.ts, 2026-09-16): it lives
  // in the same query string and must survive every rewrite — but only while
  // it is a URL the page would actually honour, so a rejected value is not
  // carried around the session in the address bar (review R-2, 2026-09-18).
  const host = new URLSearchParams(window.location.search).get(SIBLING_PARAM['self-check'])?.trim();
  if (host && allowedHostPage(host)) params.set(SIBLING_PARAM['self-check'], host);
  const qs = params.toString();
  // Safari's engine throttles history writes to about 100 in 10 seconds and
  // then throws for the rest of the window: a reader typing steadily into the
  // search box ran out, the address bar silently stopped following the page,
  // and the link they then copied described a filter they had left behind
  // (review B-33, 2026-09-18). Writing on a trailing 250 ms timer costs far
  // fewer calls than there are keystrokes and lands on the value they stopped
  // at; the catch keeps the failure harmless either way.
  clearTimeout(urlTimer);
  urlTimer = setTimeout(() => {
    try {
      // The path and fragment are read HERE, not when the write was queued:
      // in the quarter-second in between the reader may have followed an
      // in-page link, and writing the old address would silently drop the
      // fragment they had just navigated to (caught by the e2e, 2026-09-18).
      window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`);
    } catch {
      /* file://, a sandboxed page, or the throttle — the address bar just stays as it was */
    }
  }, 250);
}
let urlTimer: ReturnType<typeof setTimeout> | undefined;

export function renderCoursesPage(root: HTMLElement, rules: Rules, today: NotreDameNow): void {
  applyContactOverrides(rules.parameters); // sheet-driven contacts (2026-09-04)
  const todayIso = today.iso; // Notre Dame's date, settled on the loading card (2026-09-07)
  const currentTerm = termOfDate(todayIso);
  // Which semesters the two schedule cards stand for, and whether a row's
  // columns still describe them — per row, by its own `last_offered`
  // (DGS 2026-09-14); src/ui/schedule-terms.ts explains why the page will
  // not guess.
  const { thisTerm: thisTeachingTerm, nextTerm: nextTeachingTerm } = scheduleTerms(currentTerm);
  /** "Fall 2026" → "Fall '26", the tag on a qualifier-card course (2026-09-17). */
  const termShortLabel = (t: Term): string => `${t.season[0]!.toUpperCase()}${t.season.slice(1)} ’${String(t.year).slice(-2)}`;
  /** In the summer neither fall/spring semester is running, so the cards name
   * the one that is COMING (schedule-terms.ts). Calling it "this semester" in
   * June told a reader that classes they cannot register for yet are under way
   * (review R-18, 2026-09-18). */
  const inSummer = currentTerm.season === 'summer';
  const thisSemesterPhrase = inSummer ? 'this coming semester' : 'this semester';
  const nextSemesterPhrase = inSummer ? 'the semester after' : 'next semester';
  const offeredIn =
    (which: 'this' | 'next') =>
    (r: RuleCourse): boolean | undefined => {
      const rs = scheduleOf(r);
      return which === 'this' ? rs.this : rs.next;
    };
  /** Rows the page leaves OFF the schedule cards although their sheet cells
   * say a course is offered, by the reason. Only `yes` cells count (review
   * B-9, 2026-09-18): a row that says "no" is not being withheld, and a
   * retired row is left out by `active`, which the note names separately. */
  const freshnessCounts = (): Record<RowFreshness, number> & { retired: number } => {
    const out = { current: 0, ahead: 0, stale: 0, undated: 0, retired: 0 };
    for (const r of rows) {
      if (r.offeredNow !== true && r.offeredNext !== true) continue;
      if (!r.active) {
        out.retired += 1;
        continue;
      }
      out[scheduleOf(r).freshness] += 1;
    }
    return out;
  };

  // One row per course: the rule in effect this term (older/newer versions are
  // mentioned in the hover text so nothing is hidden).
  const rows: RuleCourse[] = [];
  for (const courseId of rules.courses.keys()) {
    const current = resolveRuleRow(rules, courseId, currentTerm);
    if (current) rows.push(current);
  }
  rows.sort((a, b) => a.courseId.localeCompare(b.courseId));
  /** Each row's schedule reading (schedule-terms.ts), taken once: the filter,
   * both cards, the tags, the key line and the note under the cards all ask
   * for it, and it is pure. */
  const schedules = new Map<RuleCourse, RowSchedule>(rows.map((r) => [r, rowSchedule(currentTerm, r)]));
  const scheduleOf = (r: RuleCourse): RowSchedule => schedules.get(r) ?? rowSchedule(currentTerm, r);

  const coreName = new Map(rules.coreAreas.map((c) => [c.code, c.name]));
  const groupName = new Map(rules.categoryGroups.map((g) => [g.code, g.name]));

  const DEFAULTS: Filters = {
    query: '',
    program: 'all',
    core: '',
    category: '',
    type: '',
    offered: '',
    includeRetired: false,
    confirmedOnly: false,
    sort: 'course',
    desc: false,
    view: 'all',
  };
  const filters: Filters = filtersFromUrl(DEFAULTS, new Set(rules.coreAreas.map((c) => c.code)), new Set(rules.categoryGroups.map((g) => g.code)));

  // ---------- helpers ----------

  // The contact card lives in one of two places by width (trim review P-21).
  // Two empty hosts and one node moved between them, so there is only ever one
  // card in the document and no duplicate ids or headings.
  const contactHost = el('div', { class: 'contact-host' });
  const mainContactHost = el('div', { class: 'contact-host' });
  const contactNode = contactCard();
  // Moved only when its host changes: re-inserting the card drops keyboard
  // focus from a link inside it (which every print did, review 2026-10-10).
  const placeContact = (wide: boolean): void => {
    const host = wide ? contactHost : mainContactHost;
    if (contactNode.parentElement !== host) host.append(contactNode);
  };
  const wideEnough = typeof window.matchMedia === 'function' ? window.matchMedia('(min-width: 900px)') : undefined;
  placeContact(wideEnough ? wideEnough.matches : true);
  // While printing the card stays where the screen had it (cross-browser
  // review, 2026-10-10): Chrome lays a printout out at the paper's width and
  // fired this change mid-print, so the card moved after the pages were laid
  // out — a blank last sheet on landscape paper from a narrow window.
  let printingNow = false;
  wideEnough?.addEventListener?.('change', (ev) => {
    if (!printingNow) placeContact((ev as MediaQueryListEvent).matches);
  });
  window.addEventListener('beforeprint', () => {
    printingNow = true;
  });
  window.addEventListener('afterprint', () => {
    printingNow = false;
    placeContact(wideEnough ? wideEnough.matches : true);
  });
  /** Whether the filter bar is the desk grid (no fold) — see filterBar. Tests
   * run without matchMedia and get the desk bar. */
  const wideFilters: { matches: boolean; addEventListener?: (t: string, f: () => void) => void } =
    typeof window.matchMedia === 'function' ? window.matchMedia('(min-width: 861px)') : { matches: true };

  const countsLabel = (c: Counts | undefined): string => (c ? COUNTS_LABEL[c] : 'Not yet decided');
  const countsClass = (c: Counts | undefined): string => (c ? COUNTS_CLASS[c] : 'undecided');
  /** The Yes / No / With … approval pill, wherever a credit verdict is shown. */
  const countsPill = (c: Counts | undefined): HTMLElement => el('span', { class: `pill ${countsClass(c)}` }, countsLabel(c));
  /** The id of a course's row in All courses — the anchor every in-page link to it uses. */
  const rowAnchorId = (r: RuleCourse): string => r.courseId.replace(' ', '-');
  /** The schedule row a qualifier card's link jumps to (DGS 2026-09-17):
   * this semester's card first, else next semester's. */
  const scheduleRowId = (r: RuleCourse, which: 'this' | 'next'): string => `sched-${which}-${rowAnchorId(r)}`;
  const coreLabel = (r: RuleCourse): string => (r.coreArea ? (coreName.get(r.coreArea) ?? r.coreArea) : '—');
  const allGroupCodes = rules.categoryGroups.map((g) => g.code);
  /** Whether the sheet says anything about each card's semester (a yes or a
   * no), and whether any row is marked offered in it — asked by the filter,
   * the cards, the key line and the "On the schedule" options. */
  const saidThis = rows.some((r) => scheduleOf(r).this !== undefined);
  const saidNext = rows.some((r) => scheduleOf(r).next !== undefined);
  const anyNow = rows.some((r) => scheduleOf(r).this === true);
  const anyNext = rows.some((r) => scheduleOf(r).next === true);
  // Whether the DGS has filled the schedule columns in at all: with every cell
  // blank the filter can only return nothing, so it is not shown (2026-09-09).
  const scheduleKnown = saidThis || saidNext;
  /** Is any loaded row still unconfirmed by the DGS?
   *
   * The same data-driven rule the schedule filter above uses (trim review
   * P-18, 2026-09-18). While every row is confirmed — 321 of 321 on today's
   * sheet — the "DGS reviewed" column is one value repeated 117 times, its
   * sort key sorts nothing, the "Only DGS-confirmed rows" switch can only
   * return the list it was given, and the legend explains a pill that appears
   * nowhere. All four are hidden, and all four come back by themselves the day
   * the sheet gains an unconfirmed row. The DGS's confirmation is still on the
   * page for every course, in the hover card, so the 2026-09-01 decision that
   * it be shown survives. */
  const someRowPending = rows.some((r) => !r.dgsReviewed);
  // A shared link saved last semester may still carry ?offered=now. Whether
  // that means anything depends on today and on the sheet, so it is dropped
  // here rather than silently filtering the table to nothing while the control
  // reads "Any semester" (2026-09-09).
  if (filters.offered !== '' && !(filters.offered === 'now' ? saidThis : saidNext)) {
    filters.offered = '';
  }
  // §4.4.2's numbers are DGS-tunable sheet parameters, so the two places that
  // state them read the sheet (2026-09-08). A missing parameter drops the
  // numbers rather than printing a guess — the page never invents policy.
  const catCourses = rules.parameters.number('category_courses_required');
  const catGroups = rules.parameters.number('category_distinct_groups_required');
  const catFloor = rules.parameters.gradeLetter('category_min_grade');
  // Without the § — each of the two places adds its own citation.
  const catRule =
    catCourses !== undefined && catGroups !== undefined && catFloor !== undefined
      ? `${catCourses} courses from ${catGroups} different categories, each with a grade of ${catFloor} or higher, are required`
      : 'courses from several different categories are required — the handbook has the exact numbers';
  /** The groups a course may satisfy, in the Categories tab's order (DGS
   * 2026-09-08 — a cell may name one, several, or `any`). */
  const groupsMemo = new Map<RuleCourse, string[]>();
  const groupsOf = (r: RuleCourse): string[] => {
    const memo = groupsMemo.get(r);
    if (memo) return memo;
    const listed = r.categoryGroups;
    const groups = !listed || listed.length === 0 ? [] : allGroupCodes.filter((g) => listed.includes(g));
    groupsMemo.set(r, groups);
    return groups;
  };
  const categoryLabel = (r: RuleCourse): string => {
    // "Ineligible", the DGS's own word (2026-09-18): a 40000- or 50000-level
    // course is not a course with no category, it is one §4.4.2 rules out.
    // (It read "Not eligible" until earlier the same day, then briefly "No
    // specialization category" — review R-17, which was trying to stop the two
    // words being read as "not eligible for credit". The legend entry carries
    // that clarification instead; the cell says what the sheet says.)
    if (r.categoryIneligible) return 'Ineligible';
    const groups = groupsOf(r);
    if (groups.length === 0) return '—';
    // The self-check tool assigns a course listed under every group itself,
    // to cover as many distinct groups as possible, and says so — it does not
    // ask the student to choose (review B-25, 2026-09-18).
    if (groups.length === allGroupCodes.length) return 'Any one category';
    const names = groups.map((g) => groupName.get(g) ?? g);
    // Several groups: the student picks one of THESE (2026-09-08).
    return names.length === 1 ? names[0]! : `${names.join(' or ')} (student picks one)`;
  };
  const offeredLabel = (r: RuleCourse): string =>
    r.typicallyOffered ? (OFFERED_LABEL[r.typicallyOffered] ?? r.typicallyOffered) : '—';
  const counts = (r: RuleCourse, program: 'mscse' | 'phd'): boolean => {
    const c = program === 'mscse' ? r.countsTowardMscse : r.countsTowardPhd;
    return c === 'yes' || c === 'dgs_approval' || c === 'adgs_approval';
  };
  /** What a course's own row can tell a reader beyond its columns. The DGS's
   * `notes` are NOT part of it (DGS 2026-09-09): they are the DGS's working
   * notes, and students should not read them. */
  const hoverText = (r: RuleCourse): string => {
    const parts: string[] = [];
    const versions = rules.courses.get(r.courseId) ?? [];
    if (versions.length > 1) {
      parts.push(
        `This course has ${versions.length} rule versions (effective ${versions
          .map((v) => (v.effectiveTerm ? termLabel(v.effectiveTerm) : 'always'))
          .join(', ')}); the one in effect for ${termLabel(currentTerm)} is shown.`,
      );
    }
    if (!r.active) parts.push('Retired: no longer offered, still recognized for students who took it.');
    return parts.join(' ');
  };

  // Spacing-insensitive search (usability review 2026-09-05, item 26):
  // "CSE20110", "cse 20110" and "20110" all find CSE 20110.
  const squash = (text: string): string => text.toLowerCase().replace(/\s+/g, '');
  /** Each row's search text, lowered and squashed once rather than per keystroke. */
  const searchable = new Map(rows.map((r) => [r, { id: squash(r.courseId), title: r.title.toLowerCase() }] as const));

  function visibleRows(): RuleCourse[] {
    const q = filters.query.trim().toLowerCase();
    const qs = squash(q);
    const list = rows.filter((r) => {
      if (!filters.includeRetired && !r.active) return false;
      if (filters.confirmedOnly && !r.dgsReviewed) return false;
      if (filters.program !== 'all' && !counts(r, filters.program)) return false;
      if (filters.core && r.coreArea !== filters.core) return false;
      if (filters.category) {
        // A course listed under several groups matches each of them, and one
        // listed under every group matches whichever is chosen (DGS
        // 2026-09-08: there is no separate "every category" filter).
        if (!groupsOf(r).includes(filters.category)) return false;
      }
      if (filters.type && r.courseType !== filters.type) return false;
      // On the schedule this semester / next (DGS 2026-09-09). Only a `yes`
      // qualifies: a blank cell means the sheet has not said, which is never
      // read as a promise either way.
      if (filters.offered === 'now' && offeredIn('this')(r) !== true) return false;
      if (filters.offered === 'next' && offeredIn('next')(r) !== true) return false;
      if (q) {
        const text = searchable.get(r)!;
        if (!text.id.includes(qs) && !text.title.includes(q)) return false;
      }
      return true;
    });
    // A row with nothing in the sorted column belongs at the END. `undefined`
    // says so; a '~' sentinel does NOT, because localeCompare orders
    // punctuation BEFORE letters and put every blank row first (2026-09-08).
    const key = (r: RuleCourse): string | undefined => {
      switch (filters.sort) {
        case 'title':
          return r.title.toLowerCase();
        case 'type':
          return TYPE_LABEL[r.courseType];
        case 'mscse':
          return countsLabel(r.countsTowardMscse);
        case 'phd':
          return countsLabel(r.countsTowardPhd);
        case 'core':
          return r.coreArea ? coreLabel(r) : undefined;
        case 'category':
          return groupsOf(r).length > 0 || r.categoryIneligible ? categoryLabel(r) : undefined;
        case 'offered':
          return r.typicallyOffered ? offeredLabel(r) : undefined;
        case 'reviewed':
          return r.dgsReviewed ? 'a' : 'b';
        default:
          return r.courseId;
      }
    };
    // Blanks last in BOTH directions, which is what this comment claimed and
    // the code did not: `reverse()` at the end turned the blank rows into the
    // first thing a reader saw when they pressed a column a second time
    // (review B-8, 2026-09-18). Sorting the filled rows in the chosen
    // direction and then appending the blanks keeps "nothing recorded here" at
    // the end, where it belongs, whichever way the column is sorted.
    const dir = filters.desc ? -1 : 1;
    // The key is computed once per row, not once per comparison.
    const keyed = list.map((r) => ({ r, k: key(r) }));
    const filled = keyed.filter((x) => x.k !== undefined);
    const blanks = keyed.filter((x) => x.k === undefined);
    const byKey = (a: { r: RuleCourse; k: string | undefined }, b: { r: RuleCourse; k: string | undefined }): number => {
      const ka = a.k!;
      const kb = b.k!;
      return ka !== kb ? dir * ka.localeCompare(kb) : dir * a.r.courseId.localeCompare(b.r.courseId);
    };
    return [...filled.sort(byKey), ...blanks.sort((a, b) => dir * a.r.courseId.localeCompare(b.r.courseId))].map((x) => x.r);
  }

  // ---------- page pieces ----------

  function masthead(): HTMLElement {
    // Embedded, the host page already carries the ND masthead and its own
    // heading, so ours would be the second of each on one screen: the gold
    // eyebrow goes, and the <h1> stays for screen readers and the document
    // outline but is taken out of the visual page (DGS 2026-09-16). The
    // "Who to contact" card moves to the end of the page — see the assembly
    // below — because a right-hand column has nowhere to sit in a ~700 px frame.
    const embed = isEmbedded();
    return el(
      'header',
      { class: 'masthead' },
      el(
        'div',
        { class: 'masthead-main' },
        // The eyebrow shares its line with the Auto · Light · Dark switch
        // (night mode, DGS 2026-10-04 — src/ui/theme.ts); embedded, the
        // switch is alone on it.
        el(
          'div',
          { class: 'masthead-top' },
          embed ? null : el('div', { class: 'eyebrow' }, 'University of Notre Dame · Computer Science and Engineering'),
          themeToggle(),
        ),
        el('h1', embed ? { tabindex: '-1', class: 'visually-hidden' } : { tabindex: '-1' }, 'Graduate Course Rules'),
        // Embedded, the WordPress page carries its own introduction: none of
        // the masthead text is shown (DGS 2026-09-16, "get rid of the texts at
        // the top"); the contact card and the dated line live in the footer.
        ...(embed
          ? []
          : [
              el(
                'p',
                { class: 'sub' },
                // "Official course rules", "These mappings" and "these same rules"
                // were three names for one thing (trim review P-9, 2026-09-18).
                el('strong', {}, 'Official course rules. '),
                'The Graduate Studies Committee and the DGS set them under the ',
                handbookLink(),
                // Who does what (policy review 2026-10-03, P1-page-text-ui-10, DGS: apply
                // the suggested fix; it replaces the 2026-09-01 wording that named the
                // Grad Admin as a decider): the DGS decides, the Grad Admin processes.
                '; the DGS (the ADGS for MSCSE students) uses them to decide whether your courses satisfy the degree requirements, and the Grad Admin processes what is decided. The ',
                el('a', siblingAnchorAttrs('self-check', window.location.search, isEmbedded()), 'degree self-check tool'),
                ' applies them to your coursework.',
              ),
              el('p', { class: 'effective' }, rulesDateLine(rules, termLabel(currentTerm), todayIso)),
              // The rules spreadsheet, linked with its faculty-only note (DGS, 2026-09-04).
              sheetSourceLine(),
            ]),
      ),
      // On a narrow screen this card is not a right-hand column, it is 250 px
      // of names and addresses between the introduction and the first heading:
      // at 390 px the first screen held no course and no control (trim review
      // P-21, 2026-09-18). Above 900 px it stays where it was, at no vertical
      // cost. The node is moved on a width change rather than placed once, so
      // a rotated tablet or a dragged window is not frozen in the other
      // layout. (In embed mode it has been at the end since 2026-09-16.)
      embed ? null : contactHost,
    );
  }

  function notices(): HTMLElement[] {
    const out: HTMLElement[] = [
      // Two sentences, at the DGS's request (2026-09-18): the caveats about
      // Pending rows, "typically offered" and the retired switch were cut —
      // each of those is explained where it appears (the legend's own entries,
      // the Pending pill, the empty-table text), and the banner is what a
      // reader meets first.
      el(
        'div',
        { class: 'banner official', role: 'note' },
        'Where this page and the handbook disagree, the handbook and the DGS decide.',
        ...reportToDgs(' Corrections and questions — please email'),
      ),
    ];
    if (rules.source === 'snapshot') {
      out.push(
        el(
          'div',
          { class: 'banner snapshot' },
          // Notre Dame's calendar date, the same spelling the loading card's
          // button and the masthead use — it was the UTC slice here (R-22).
          `You chose to continue with the copy of the rules saved on ${ndDateOnly(rules.syncedAt)} because the live spreadsheet could not be loaded — recent DGS edits may be missing. Reload the page to try the live spreadsheet again.`,
        ),
      );
    }
    // Every date on this page — the semester the cards name, the tags, "up-to-date
    // as of" — is computed from one instant. The loading card says where that
    // instant came from and is then wiped by the render, so a page built on a
    // wrong device clock looked exactly like a correct one (review R-6,
    // 2026-09-18). The banner appears only in the fallback cases.
    if (today.source === 'device' || !today.zoneOk) {
      out.push(
        el(
          'div',
          { class: 'banner clock', role: 'note' },
          el('strong', {}, 'Today’s date came from this device. '),
          !today.zoneOk
            ? 'This browser does not know Notre Dame’s time zone, so this device’s own calendar was used. '
            : 'This site’s own server did not answer when the page asked what time it is, so this device’s clock was used. ',
          `The page is reading today as ${formatYmdLong(todayIso.slice(0, 10)) ?? todayIso.slice(0, 10)}. If that is wrong, the semester named on the schedule cards is wrong too — check the device’s date and reload.`,
        ),
      );
    }
    return out;
  }

  /** What is running this semester and next — two cards, from the Courses
   * tab's `offered_now` / `offered_next` (DGS 2026-09-09). A column with no
   * `yes` anywhere has not been published yet, and the card says so rather
   * than showing an empty list, which would read as "nothing is offered". */
  /** A course of another department, listed in the Courses tab because the DGS
   * reviewed it (DGS 2026-09-21): shown apart from the CSE list, in the
   * schedule cards and in All courses, under a note that the list is only what
   * has been reviewed, not every course the department accepts. */
  const isNonCse = (r: RuleCourse): boolean => !/^CSE\b/i.test(r.courseId);
  const NON_CSE_HEADING = 'Non-CSE courses the DGS has reviewed';
  const NON_CSE_NOTE =
    'Only the courses of other departments that the DGS has already reviewed are listed here. It is not a complete list of the non-CSE courses the department accepts — ask the DGS about any course that is not here.';

  function scheduleSection(): HTMLElement {
    const live = rows.filter((r) => r.active);
    // Every attribute the table carries except the three the DGS left out
    // (2026-09-09): "Typically offered" (a pattern from past years, which
    // these cards supersede), "DGS reviewed" (the * beside a course id says
    // it) and the notes (a per-row disclosure in the table below).
    /** A column header with its explanation under the name, in the small type
     * the main table uses; `abbr` gives a screen reader the long form. */
    const colHead = (label: string, sub: string, full: string): HTMLElement =>
      el('th', { scope: 'col', abbr: full }, label, el('span', { class: 'th-sub' }, sub));
    /** The table, wrapped so a narrow screen can start with it closed (trim
     * review P-20, 2026-09-18): below 861 px each row becomes a stacked card,
     * so the Fall card alone measured 9,880 px at 390 px — every one of those
     * courses repeated, in the same format, in All courses below. At 861 px
     * and above the CSS forces it open and hides the summary, so nothing about
     * the desktop page changes; `@media print` does the same, so a printed
     * copy keeps both schedules. */
    const collapsible = (table: HTMLElement, count: number): HTMLElement => {
      const d = el('details', { class: 'sched-details' });
      d.append(el('summary', {}, `${count} course${count === 1 ? '' : 's'}`), table);
      // `open` is set here rather than by CSS: a closed <details> hides its
      // content through the UA's own slot, which a `display` rule cannot be
      // relied on to override. The width decides it, and a window dragged
      // across the breakpoint re-decides — one that chose once would freeze a
      // rotated tablet in the wrong state.
      const wide = typeof window.matchMedia === 'function' ? window.matchMedia('(min-width: 861px)') : undefined;
      d.open = wide ? wide.matches : true;
      // While printing the width does not decide: Chrome (so Edge and Opera
      // too) lays the page out at the paper's width — under 861 px on
      // portrait Letter or A4 — and fired this change between beforeprint and
      // afterprint, closing the card the print had just opened, so the
      // schedule printed as a bare heading (cross-browser review, 2026-10-10).
      let printing = false;
      wide?.addEventListener?.('change', (ev) => {
        if (!printing) d.open = (ev as MediaQueryListEvent).matches;
      });
      // On paper both schedules print in full, whatever the window was doing.
      let openBefore = d.open;
      window.addEventListener('beforeprint', () => {
        printing = true;
        openBefore = d.open;
        d.open = true;
      });
      window.addEventListener('afterprint', () => {
        printing = false;
        d.open = openBefore;
      });
      return d;
    };
    const miniTable = (items: RuleCourse[], label: string, which: 'this' | 'next'): HTMLElement =>
      el(
        'div',
        { class: 'table-scroll plain', tabindex: '0', role: 'region', 'aria-label': `${label} (scrolls sideways on narrow screens)` },
        el(
          'table',
          { class: 'course-rules schedule-table' },
          el(
            'thead',
            {},
            el(
              'tr',
              {},
              el('th', { scope: 'col' }, 'Course'),
              el('th', { scope: 'col' }, 'Title'),
              el('th', { scope: 'col' }, 'Type'),
              // Each column says what it is under its own name (DGS
              // 2026-09-09), so "Ph.D." (degree credit) is not mistaken for
              // the two qualifier groupings beside it.
              colHead('MSCSE', 'degree credit', 'MSCSE degree credit'),
              colHead('Ph.D.', 'degree credit', 'Ph.D. degree credit'),
              colHead('Core knowledge', 'Ph.D. Qual. §4.4.1', 'Core knowledge — Ph.D. Qualifying Examination §4.4.1'),
              colHead('Specialization', 'Ph.D. Qual. §4.4.2', 'Specialization — Ph.D. Qualifying Examination §4.4.2'),
            ),
          ),
          el(
            'tbody',
            {},
            ...items.map((r) =>
              el(
                'tr',
                { id: scheduleRowId(r, which) },
                el(
                  'th',
                  { scope: 'row', class: 'course-id' },
                  withCourseCard(el('a', { href: `#${rowAnchorId(r)}` }, r.courseId), r),
                  // Named, not an asterisk whose footnote no longer exists (R-10).
                  r.dgsReviewed ? '' : el('span', { class: 'pill small pending', title: 'The DGS has not yet confirmed this row' }, 'Pending'),
                ),
                el('td', { class: 'cell-title', 'data-label': 'Title' }, r.title),
                el('td', { 'data-label': 'Type' }, TYPE_LABEL[r.courseType]),
                el('td', { 'data-label': 'MSCSE degree credit' }, countsPill(r.countsTowardMscse)),
                el('td', { 'data-label': 'Ph.D. degree credit' }, countsPill(r.countsTowardPhd)),
                el('td', { class: r.coreArea ? '' : 'muted', 'data-label': 'Core knowledge (§4.4.1)' }, coreLabel(r)),
                el('td', { class: groupsOf(r).length === 0 && !r.categoryIneligible ? 'muted' : '', 'data-label': 'Specialization (§4.4.2)' }, categoryLabel(r)),
              ),
            ),
          ),
        ),
      );
    const card = (heading: string, term: Term, offered: (r: RuleCourse) => boolean | undefined, which: 'this' | 'next'): HTMLElement => {
      // "Released" means the DGS has said something about this semester at
      // all — a yes or a no. Until then the list is not empty, it is unknown.
      const said = which === 'this' ? saidThis : saidNext;
      // A course whose rule changes between the two semesters is shown as it
      // will be in the semester the card is about — the table below is
      // explicitly "the rule in effect this term", but a card headed Spring
      // 2027 must not print Fall 2026's credit rules (2026-09-09).
      // CSE courses only (DGS 2026-09-21): the DGS does not track which
      // non-CSE courses run each semester, so they are not on the schedule —
      // they are in All courses, under their own heading.
      const items = live.filter((r) => offered(r) === true && !isNonCse(r)).map((r) => resolveRuleRow(rules, r.courseId, term) ?? r);
      // How many rows actually answered for this semester. One row saying "no"
      // used to turn the card into the flat "No course is listed for Spring
      // 2027", which reads as a published, empty schedule (review R-9).
      const answered = rows.filter((r) => offered(r) !== undefined).length;
      return el(
        'div',
        { class: 'ov-card' },
        el('h3', {}, heading),
        !said
          ? // Not the registrar's doing: the sheet has not been filled in for
            // this semester yet (review R-14).
            el('p', { class: 'muted small' }, `The rules sheet does not list ${termLabel(term)} yet.`)
          : items.length === 0
            ? // Named, not "this semester": the string is shared by both cards.
              el(
                'span',
                { class: 'muted' },
                answered < 5
                  ? `Only ${answered} course${answered === 1 ? ' has' : 's have'} been marked for ${termLabel(term)} so far, and ${answered === 1 ? 'it is' : 'none of them are'} being offered. The rest of the semester is not on the sheet yet.`
                  : `No course is listed for ${termLabel(term)}.`,
              )
            : collapsible(miniTable(items, heading, which), items.length),
      );
    };
    return el(
      'section',
      { class: 'overview schedule-overview' },
      el('h2', {}, 'CSE courses on the schedule'),
      // (The intro paragraph was removed at the DGS's request, 2026-09-16.)
      el(
        'div',
        { class: 'ov-grid two' },
        card(`Offered ${thisSemesterPhrase} — ${termLabel(thisTeachingTerm)}`, thisTeachingTerm, offeredIn('this'), 'this'),
        card(`Offered ${nextSemesterPhrase} — ${termLabel(nextTeachingTerm)}`, nextTeachingTerm, offeredIn('next'), 'next'),
      ),
      // What was left out and why. Each clause counts rows whose cells say a
      // course IS offered and which the page still does not show, with the
      // reason — so a DGS reading their own page sees a schedule that needs an
      // edit instead of a quiet one (2026-09-14; rewritten 2026-09-18 for the
      // DGS's ruling that `last_offered` is the last term a course ran).
      ...(() => {
        const n = freshnessCounts();
        const s = (k: number) => (k === 1 ? '' : 's');
        const is = (k: number) => (k === 1 ? 'is' : 'are');
        const parts: string[] = [];
        if (n.stale > 0)
          parts.push(
            `${n.stale} course${s(n.stale)} marked as offered ${is(n.stale)} dated to an earlier semester in the Courses tab’s last_offered, so the two cells describe a schedule that has passed and ${is(n.stale)} not shown`,
          );
        if (n.ahead > 0)
          parts.push(
            `${n.ahead} course${s(n.ahead)} marked as offered ${is(n.ahead)} dated ahead of ${termLabel(thisTeachingTerm)} in last_offered — a course cannot last have been offered in a semester that has not happened — and ${is(n.ahead)} not shown`,
          );
        if (n.undated > 0) parts.push(`${n.undated} course${s(n.undated)} marked as offered ${n.undated === 1 ? 'has' : 'have'} no readable last_offered and ${is(n.undated)} not shown`);
        if (n.retired > 0) parts.push(`${n.retired} course${s(n.retired)} marked as offered ${is(n.retired)} also marked retired (active = no) and ${is(n.retired)} not shown`);
        return parts.length > 0 ? [el('p', { class: 'muted small' }, parts.join('. ') + '.', ...reportToDgs(' Please tell'))] : [];
      })(),
      // (The "* Pending DGS confirmation" footnote was removed at the DGS's request, 2026-09-16.)
    );
  }

  function overview(): HTMLElement {
    const item = (r: RuleCourse): HTMLElement =>
      withCourseCard(
        el(
          'a',
          // Offered this semester or next → the course's row on the schedule
          // card; otherwise its row in All courses (DGS 2026-09-17).
          {
            class: `ov-item${r.dgsReviewed ? '' : ' pending'}`,
            href: offeredIn('this')(r) === true ? `#${scheduleRowId(r, 'this')}` : offeredIn('next')(r) === true ? `#${scheduleRowId(r, 'next')}` : `#${rowAnchorId(r)}`,
          },
          el('span', { class: 'cid' }, r.courseId),
          el('span', { class: 'ctitle' }, r.title),
          // A bare asterisk meant nothing here: the footnote explaining it was
          // removed on 2026-09-16 and the mark stayed (review R-10). The pill
          // says what it is, and matches the table's own Pending pill.
          ...(r.dgsReviewed ? [] : [el('span', { class: 'pill small pending', title: 'The DGS has not yet confirmed this row' }, 'Pending')]),
          // The live schedule, as two small tags (DGS 2026-09-17): this
          // semester in green, next semester in blue; nothing when not offered.
          // The visible text is a short term ("Fall ’26"); the word "Offered"
          // is carried for screen readers and for touch, which has no hover to
          // reveal the title (review B-18, 2026-09-18).
          ...(offeredIn('this')(r) === true
            ? [el('span', { class: 'pill small sched-now', title: `Offered ${termLabel(thisTeachingTerm)}` }, el('span', { class: 'visually-hidden' }, 'Offered '), termShortLabel(thisTeachingTerm))]
            : []),
          ...(offeredIn('next')(r) === true
            ? [el('span', { class: 'pill small sched-next', title: `Offered ${termLabel(nextTeachingTerm)}` }, el('span', { class: 'visually-hidden' }, 'Offered '), termShortLabel(nextTeachingTerm))]
            : []),
        ),
        r,
      );
    /** The courses in one §4.4.1 area or §4.4.2 group.
     *
     * CURRENT courses only — the DGS's ruling of 2026-09-18, which reversed his
     * own answer of an hour before: retired courses are not shown in these
     * cards. They are still in the table under "Include retired courses", and
     * the audit engine still counts one for a student who took it.
     *
     * What that leaves, from review B-3: a card whose only course is retired
     * cannot say "No course assigned yet", because one IS assigned. It says
     * nothing is on offer, which is true either way. */
    const listFor = (pick: (r: RuleCourse) => boolean): HTMLElement => {
      const items = rows.filter((r) => r.active && pick(r));
      return items.length === 0 ? el('span', { class: 'muted' }, 'No current course is listed here.') : el('div', { class: 'ov-list' }, ...items.map(item));
    };
    const coreCards = rules.coreAreas.map((c) =>
      el('div', { class: 'ov-card' }, el('h3', {}, c.name), listFor((r) => r.coreArea === c.code)),
    );
    // A course listed under several groups — or under every group — belongs
    // in each of their cards (DGS 2026-09-08). The note above the cards says
    // that it can still fill only one of them.
    const groupCards = rules.categoryGroups.map((g) =>
      el('div', { class: 'ov-card' }, el('h3', {}, g.name), listFor((r) => groupsOf(r).includes(g.code))),
    );
    return el(
      'section',
      { class: 'overview' },
      // Each section chip shows the handbook's text on hover (DGS 2026-10-05).
      el('h2', {}, 'Ph.D. Qualifying Examination courses ', sectionRef('§4.4', { className: 'cite', dataKey: 'secref.qualifier' })),
      // The key names only the markers a reader can actually meet below
      // (review R-8, 2026-09-18). It used to print both whenever EITHER
      // semester had a tag, so with next semester's schedule unpublished — the
      // state of the live sheet — it promised a "Spring ’27" marker that
      // appeared on no course, which reads as "none of these run next spring".
      ...(() => {
        if (!anyNow && !anyNext) return [];
        const bits: (string | Node)[] = [];
        if (anyNow) bits.push(el('span', { class: 'pill small sched-now' }, termShortLabel(thisTeachingTerm)), ` offered ${thisSemesterPhrase}`);
        if (anyNow && anyNext) bits.push(' · ');
        if (anyNext) bits.push(el('span', { class: 'pill small sched-next' }, termShortLabel(nextTeachingTerm)), ` offered ${nextSemesterPhrase}`);
        // Without the second half, say why it is missing rather than leaving
        // its absence to be read as "nothing runs next semester".
        if (anyNow && !anyNext) bits.push(`. ${termLabel(nextTeachingTerm)} is not on the sheet yet.`);
        return [el('p', { class: 'muted small sched-key' }, ...bits)];
      })(),
      el(
        'p',
        { class: 'muted' },
        // "Ph.D. students only" first: an MSCSE reader used to learn the section
        // was not for them 27 words in, after a heading, the key line and — on a
        // phone — two screens of cards (trim review P-8, 2026-09-18).
        el('strong', {}, 'Ph.D. students only. '),
        'Core knowledge and specialization are the two course-based requirements of the Qualifying Examination (§4.4); whether a course counts toward degree credit is a separate question, answered in the table below.',
      ),
      el('h3', { class: 'ov-sub' }, 'Core knowledge areas ', sectionRef('§4.4.1', { className: 'cite', dataKey: 'secref.core' })),
      // §4.4.1: "All PhD students are required to pass (or have previously passed) an
      // Operating Systems course, an Algorithms course, and a Computer Architecture
      // course, either at Notre Dame or at their previous institution." — prior
      // coursework of any level counts (DGS clarification 2026-09-05; decision 2026-09-01).
      el(
        'p',
        { class: 'muted' },
        // The requirement itself, which the paragraph never stated — it opened
        // with how it "can be met" (trim review P-14, 2026-09-18). "Each area
        // below" rather than "all three": the areas come from the sheet.
        'Ph.D. students must pass a course in each area below — at Notre Dame or ',
        el('strong', {}, 'at a previous institution, undergraduate or graduate'),
        ' (§4.4.1: “either at Notre Dame or at their previous institution”). A course from a previous institution counts once the DGS has confirmed it; the ',
        el('a', siblingAnchorAttrs('self-check', window.location.search, isEmbedded()), 'degree self-check tool'),
        ' prepares that review request from your imported transcripts.',
      ),
      el('div', { class: 'ov-grid' }, ...coreCards),
      el('h3', { class: 'ov-sub' }, 'Specialization categories ', sectionRef('§4.4.2', { className: 'cite', dataKey: 'secref.categories' })),
      // §4.4.2 asks for three courses from three DISTINCT categories, so a
      // course that appears in several cards is still worth only one of them
      // (DGS 2026-09-08).
      el(
        'p',
        { class: 'muted' },
        // "never several" restated "only one", and eleven words said what the
        // clause before them had already set up (trim review P-3, 2026-09-18).
        `${catRule.charAt(0).toUpperCase()}${catRule.slice(1)} (§4.4.2). A course listed under more than one category appears in each of their cards below, but can fill only `,
        el('strong', {}, 'one'),
        ' of them; the ',
        el('a', siblingAnchorAttrs('self-check', window.location.search, isEmbedded()), 'degree self-check tool'),
        ' settles which.',
      ),
      el('div', { class: 'ov-grid' }, ...groupCards),
      // (The "* Pending DGS confirmation" footnote was removed at the DGS's request, 2026-09-16.)
    );
  }

  // ---------- the course card that follows the pointer ----------
  //
  // Hovering (or tabbing to) a course anywhere in the three card sections
  // shows what the table row would say — the DGS asked for it on 2026-09-09,
  // so a reader does not have to jump to the table and back. One element,
  // moved and refilled, `position: fixed` so the schedule tables' scroll
  // region cannot clip it, and never the DGS's notes.
  const hoverCard = el('div', { class: 'course-pop', id: 'course-pop', role: 'tooltip', hidden: 'hidden' });
  const popRow = (label: string, value: Node | string): HTMLElement =>
    el('div', { class: 'pop-row' }, el('span', { class: 'pop-label' }, label), el('span', { class: 'pop-value' }, value));
  const fillCard = (r: RuleCourse): void => {
    clear(hoverCard);
    hoverCard.append(
      el('h4', {}, r.courseId, r.active ? '' : el('span', { class: 'pill retired' }, 'Retired')),
      el('p', { class: 'pop-title' }, r.title),
      popRow('Type', TYPE_LABEL[r.courseType]),
      popRow('MSCSE degree credit', countsPill(r.countsTowardMscse)),
      popRow('Ph.D. degree credit', countsPill(r.countsTowardPhd)),
      popRow('Core knowledge (§4.4.1)', coreLabel(r)),
      popRow('Specialization (§4.4.2)', categoryLabel(r)),
      popRow('Typically offered', offeredLabel(r)),
      popRow('DGS reviewed', r.dgsReviewed ? el('span', { class: 'pill yes' }, '✓ Confirmed') : el('span', { class: 'pill pending' }, 'Pending')),
    );
    // What this row cannot say for itself: that the course has more than one
    // rule version and which one is on screen, and that a retired course is
    // still recognized. The sentence has existed since 2026-09-09 and was
    // shown nowhere — `hoverText` lost its last call site in commit 2c18c8e,
    // so a course whose rules change next term read "Yes" in the table while
    // the Spring card read "No", with nothing to explain the difference
    // (review B-1, 2026-09-18).
    const note = hoverText(r);
    if (note) hoverCard.append(el('p', { class: 'pop-note' }, note));
  };
  /** The course the card is currently describing, so it can be re-placed when
   * the page scrolls under it. */
  let cardAnchor: HTMLElement | undefined;
  const placeCard = (anchor: HTMLElement): void => {
    const box = anchor.getBoundingClientRect();
    hoverCard.hidden = false;
    const card = hoverCard.getBoundingClientRect();
    const gap = 8;
    // Below the course by default; above it when there is no room below.
    const top = box.bottom + gap + card.height > window.innerHeight && box.top - gap - card.height > 0 ? box.top - gap - card.height : box.bottom + gap;
    const left = Math.max(gap, Math.min(box.left, window.innerWidth - card.width - gap));
    hoverCard.style.top = `${Math.round(top)}px`;
    hoverCard.style.left = `${Math.round(left)}px`;
  };
  const hideCard = (): void => {
    hoverCard.hidden = true;
    hoverCard.style.top = '-9999px';
    cardAnchor = undefined;
  };
  // The close that waits for a pointer travelling toward the card, and the two
  // listeners that cancel it — on the card, once, not once per course link.
  let leaveTimer: ReturnType<typeof setTimeout> | undefined;
  const cancelHide = (): void => clearTimeout(leaveTimer);
  const hideSoon = (hide: () => void): void => {
    cancelHide();
    leaveTimer = setTimeout(hide, 160);
  };
  hoverCard.addEventListener('mouseenter', cancelHide);
  hoverCard.addEventListener('mouseleave', hideCard);
  // Dismissable without moving the pointer or the focus (WCAG 1.4.13): Escape
  // closes the card and leaves focus on the course link, so a keyboard reader
  // can read the page under it and carry on tabbing from where they were.
  document.addEventListener('keydown', (ev) => {
    if ((ev as KeyboardEvent).key === 'Escape' && !hoverCard.hidden) {
      cancelHide();
      (document.activeElement as HTMLElement | null)?.removeAttribute('aria-describedby');
      hideCard();
    }
  });
  // A card placed against the viewport must follow the page under it.
  window.addEventListener(
    'scroll',
    () => {
      if (!hoverCard.hidden && cardAnchor) placeCard(cardAnchor);
    },
    { passive: true },
  );
  /** Wire one course link to the card. Pointer AND keyboard, so tabbing
   * through the cards shows the same thing a mouse does.
   *
   * WCAG 2.1 SC 1.4.13 asks that content shown on hover or focus be
   * dismissable without moving the pointer or the focus, and that the pointer
   * be able to travel onto it. Neither held until 2026-09-18 (review B-5):
   * Escape did nothing, and the 8 px gap plus `pointer-events: none` meant the
   * card vanished the moment the pointer set out for it. The card now closes
   * on Escape with focus left where it was, and survives a pointer that
   * reaches it. */
  const withCourseCard = (anchor: HTMLElement, r: RuleCourse): HTMLElement => {
    const show = () => {
      fillCard(r);
      cardAnchor = anchor;
      placeCard(anchor);
      // Focus scrolls the link into view AFTER this handler runs, so a card
      // placed now sits where the link used to be — off screen when Tab
      // reaches a course below the fold (review B-6). One frame later the
      // scrolling is done and the measurement is the real one.
      requestAnimationFrame(() => {
        if (!hoverCard.hidden && cardAnchor === anchor) placeCard(anchor);
      });
      anchor.setAttribute('aria-describedby', 'course-pop');
    };
    const hide = () => {
      hideCard();
      anchor.removeAttribute('aria-describedby');
    };
    // A pointer that leaves the link may be on its way to the card (1.4.13),
    // so the close waits a moment; the card's own listeners — registered once,
    // below — cancel it.
    anchor.addEventListener('mouseenter', () => {
      cancelHide();
      show();
    });
    anchor.addEventListener('focus', show);
    anchor.addEventListener('mouseleave', () => hideSoon(hide));
    anchor.addEventListener('blur', hide);
    return anchor;
  };

  /** Visible labels above every filter (usability review 2026-09-05, item 26)
   * — an aria-label alone told sighted users nothing once a value was chosen. */
  const labelled = (label: string, control: HTMLElement, id: string): HTMLElement => {
    control.id = id;
    return el('div', { class: 'filter' }, el('label', { class: 'label', for: id }, label), control);
  };
  const defaultFilters = (): Filters => ({ ...DEFAULTS });
  const filtersActive = (): boolean => {
    const d = defaultFilters();
    // The query counts only once it has a non-space character in it, so a
    // search box holding two spaces does not claim to be filtering (B-15).
    if (filters.query.trim() !== d.query.trim()) return true;
    return (['program', 'core', 'category', 'type', 'offered', 'includeRetired', 'confirmedOnly', 'view'] as const).some((k) => filters[k] !== d[k]);
  };
  const filterHost = el('div', { class: 'filter-host' });
  let clearButton: HTMLElement | undefined;
  /** Rebuild the bar from `filters` (its values live there, not in the controls). */
  const rebuildFilterBar = (): void => {
    clear(filterHost);
    filterHost.append(filterBar());
  };
  /** Put keyboard focus back on a control after the bar was rebuilt under it. */
  const focusFilter = (key: string): void => {
    filterHost.querySelector<HTMLElement>(`[data-key="${key}"]`)?.focus();
  };

  function filterBar(): HTMLElement {
    return layoutFilterBar(buildFilterControls());
  }
  /** The controls, each wired to `filters` and to refreshTable. */
  function buildFilterControls() {
    // "What are you checking?" (item 30) picks the COLUMNS. It used to narrow
    // the Program filter to the same degree, which hid exactly the courses a
    // reader was checking: choose the M.S. view, search 63801, and the page
    // answered "the DGS has not ruled on it yet" while the sheet plainly rules
    // it No for the MSCSE (trim review P-19, 2026-09-18). It now clears only a
    // Program filter that CONTRADICTS the view — one that would filter the
    // rows by a column this view hides (review B-11).
    const view = el('select', {
      'data-key': 'filter.view',
      onchange: (e) => {
        const v = (e.target as HTMLSelectElement).value as View;
        filters.view = v;
        if ((v === 'mscse' || v === 'phd') && filters.program !== 'all' && filters.program !== v) filters.program = 'all';
        rebuildFilterBar();
        refreshTable();
        focusFilter('filter.view');
      },
    });
    for (const [k, label] of Object.entries(VIEW_LABEL)) view.append(option(k, label, filters.view === k));
    const search = el('input', {
      type: 'search',
      'data-key': 'filter.search',
      value: filters.query,
      oninput: (e) => {
        filters.query = (e.target as HTMLInputElement).value;
        refreshTable();
      },
    });
    const program = el('select', {
      'data-key': 'filter.program',
      onchange: (e) => {
        filters.program = (e.target as HTMLSelectElement).value as Filters['program'];
        // Choosing the other degree here while a degree VIEW is showing would
        // leave the status line naming one degree over the other degree's list
        // with its column hidden (review B-11): the view follows the choice,
        // and the bar is rebuilt so both controls read the same.
        if ((filters.view === 'mscse' || filters.view === 'phd') && filters.program !== 'all' && filters.program !== filters.view) {
          filters.view = filters.program;
          rebuildFilterBar();
          refreshTable();
          focusFilter('filter.program');
          return;
        }
        refreshTable();
      },
    });
    program.append(
      option('all', 'All courses', filters.program === 'all'),
      option('mscse', 'Counts toward MSCSE', filters.program === 'mscse'),
      option('phd', 'Counts toward Ph.D.', filters.program === 'phd'),
    );
    // One control for both halves of the qualifier (trim review P-22,
    // 2026-09-18). Two selects sat side by side, each with its own "Any …"
    // option, both shown even in the MSCSE views where neither applies; a
    // single label says the whole control is Ph.D.-only, and the two optgroups
    // keep the §§ apart. The option text keeps its "Core:" / "Specialization:"
    // prefix on purpose: the closed control shows only the option, and
    // Algorithms is the name of both a core area and a category (as are
    // Computer Architecture and Architecture).
    const QUALIFIER_PREFIX = { core: 'core:', category: 'cat:' };
    const qualValue = filters.core ? `${QUALIFIER_PREFIX.core}${filters.core}` : filters.category ? `${QUALIFIER_PREFIX.category}${filters.category}` : '';
    const qualifierArea = el('select', {
      'data-key': 'filter.qualifier',
      onchange: (e) => {
        const v = (e.target as HTMLSelectElement).value;
        filters.core = v.startsWith(QUALIFIER_PREFIX.core) ? v.slice(QUALIFIER_PREFIX.core.length) : '';
        filters.category = v.startsWith(QUALIFIER_PREFIX.category) ? v.slice(QUALIFIER_PREFIX.category.length) : '';
        refreshTable();
      },
    });
    qualifierArea.append(option('', 'Any qualifier area', qualValue === ''));
    if (rules.coreAreas.length > 0) {
      const g = el('optgroup', { label: 'Core knowledge §4.4.1' });
      for (const c of rules.coreAreas) g.append(option(`${QUALIFIER_PREFIX.core}${c.code}`, `Core: ${c.name}`, filters.core === c.code));
      qualifierArea.append(g);
    }
    if (rules.categoryGroups.length > 0) {
      const g = el('optgroup', { label: 'Specialization §4.4.2' });
      for (const c of rules.categoryGroups) g.append(option(`${QUALIFIER_PREFIX.category}${c.code}`, `Specialization: ${c.name}`, filters.category === c.code));
      qualifierArea.append(g);
    }
    const type = el('select', {
      'data-key': 'filter.type',
      onchange: (e) => {
        filters.type = (e.target as HTMLSelectElement).value;
        refreshTable();
      },
    });
    type.append(option('', 'Any course type', filters.type === ''));
    for (const [code, label] of Object.entries(TYPE_LABEL)) type.append(option(code, label, filters.type === code));
    // On the schedule now / next (DGS 2026-09-09). The control appears only
    // once the sheet says something: with every cell blank it could only ever
    // return nothing, and a filter that cannot work is worse than no filter.
    const offered = el('select', {
      'data-key': 'filter.offered',
      onchange: (e) => {
        filters.offered = (e.target as HTMLSelectElement).value as Filters['offered'];
        refreshTable();
      },
    });
    offered.append(option('', 'Any semester', filters.offered === ''));
    // Only a semester the sheet has actually recorded is offered as a choice.
    if (saidThis) offered.append(option('now', `Offered ${thisSemesterPhrase} (${termLabel(thisTeachingTerm)})`, filters.offered === 'now'));
    if (saidNext) offered.append(option('next', `Offered ${nextSemesterPhrase} (${termLabel(nextTeachingTerm)})`, filters.offered === 'next'));
    const retired = el('input', {
      type: 'checkbox',
      'data-key': 'filter.retired',
      onchange: (e) => {
        filters.includeRetired = (e.target as HTMLInputElement).checked;
        refreshTable();
      },
    });
    (retired as HTMLInputElement).checked = filters.includeRetired;
    const confirmed = el('input', {
      type: 'checkbox',
      'data-key': 'filter.confirmed',
      onchange: (e) => {
        filters.confirmedOnly = (e.target as HTMLInputElement).checked;
        refreshTable();
      },
    });
    (confirmed as HTMLInputElement).checked = filters.confirmedOnly;
    // On phones the table becomes cards and its sortable headers are hidden,
    // so sorting moves into the filter bar (shown only there by CSS).
    const SORT_LABELS: Partial<Record<SortKey, string>> = {
      course: 'Course number',
      title: 'Title',
      type: 'Type',
      mscse: 'MSCSE degree credit',
      phd: 'Ph.D. degree credit',
      core: 'Core knowledge',
      category: 'Specialization',
      offered: 'Typically offered',
      ...(someRowPending ? { reviewed: 'DGS reviewed' } : {}),
    };
    const sortSel = el('select', {
      'data-key': 'filter.sort',
      onchange: (e) => {
        filters.sort = (e.target as HTMLSelectElement).value as SortKey;
        refreshTable();
      },
    });
    for (const [k, label] of Object.entries(SORT_LABELS)) sortSel.append(option(k, label, filters.sort === k));
    const descBox = el('input', {
      type: 'checkbox',
      'data-key': 'filter.desc',
      onchange: (e) => {
        filters.desc = (e.target as HTMLInputElement).checked;
        refreshTable();
      },
    });
    (descBox as HTMLInputElement).checked = filters.desc;
    clearButton = el(
      'button',
      {
        class: 'btn tiny clear-filters',
        'data-key': 'filter.clear',
        onclick: () => {
          Object.assign(filters, defaultFilters());
          rebuildFilterBar();
          refreshTable();
          focusFilter('filter.search');
        },
      },
      'Clear filters',
    );
    clearButton.classList.toggle('hidden', !filtersActive());
    return { view, search, program, qualifierArea, type, offered, retired, confirmed, sortSel, descBox, clearButton };
  }
  /** The bar's shape: the view and the search box always in sight, the rest
   * in the grid on a desk and behind "More filters" on a phone. */
  function layoutFilterBar(c: ReturnType<typeof buildFilterControls>): HTMLElement {
    const { view, search, program, qualifierArea, type, offered, retired, confirmed, sortSel, descBox, clearButton } = c;
    // On a phone the bar was eight stacked controls — a full screen before
    // the first course (mobile review 2026-09-19). The view and the search box
    // stay in sight; the rest folds behind "More filters", open by itself
    // whenever one of them is set, so a filtered list always shows what is
    // filtering it. Above 860 px there is no fold at all — the same controls
    // sit directly in the grid as before. (`display: contents` on a <details>
    // is ignored by browsers, so the structure differs by width and the bar is
    // rebuilt when the width crosses 861 px — see the listener at mount.)
    const moreCount =
      (filters.program !== 'all' ? 1 : 0) +
      (filters.core || filters.category ? 1 : 0) +
      (filters.type ? 1 : 0) +
      (filters.offered ? 1 : 0) +
      (filters.includeRetired ? 1 : 0) +
      (filters.confirmedOnly ? 1 : 0) +
      (filters.sort !== 'course' || filters.desc ? 1 : 0);
    const moreControls = (): HTMLElement[] => [
        labelled('Program', program, 'filter-program'),
        labelled('Ph.D. qualifier area', qualifierArea, 'filter-qualifier'),
        labelled('Course type', type, 'filter-type'),
        ...(scheduleKnown ? [labelled('On the schedule', offered, 'filter-offered')] : []),
        // The two switches and Clear share one line under the pickers, so the
        // row reads as a grid of equal cells rather than a ragged wrap (DGS
        // 2026-09-09).
        el(
          'div',
          { class: 'switches' },
          el('label', { class: 'check' }, retired, ' Include retired courses'),
          ...(someRowPending ? [el('label', { class: 'check' }, confirmed, ' Only DGS-confirmed rows')] : []),
          clearButton,
        ),
        el('div', { class: 'filter mobile-only' }, labelled('Sort by', sortSel, 'filter-sort'), el('label', { class: 'check' }, descBox, ' Descending')),
    ];
    const more = wideFilters.matches
      ? moreControls()
      : [
          el(
            'details',
            { class: 'more-filters', 'data-key': 'filter.more', open: moreCount > 0 },
            el('summary', {}, moreCount > 0 ? `More filters (${moreCount} set)` : 'More filters'),
            el('div', { class: 'more-grid' }, ...moreControls()),
          ),
        ];
    return el(
      'div',
      { class: 'filters', role: 'search', 'aria-label': 'Filter the course list' },
      el('div', { class: 'filter view-filter' }, labelled('What are you checking?', view, 'filter-view')),
      labelled('Course number or title', search, 'filter-search'),
      ...more,
    );
  }

  /** Set for the one render that follows a card link clearing the reader's
   * filters, so the count line can say what just happened. */
  let clearedFor: string | undefined;
  const tableHost = el('div', { class: 'table-host' });
  /** The result count is a live region created ONCE (a re-created region is
   * not announced): screen-reader users hear "18 of 176 courses shown" after
   * each filter change (WCAG 4.1.3; usability review 2026-09-05, item 26). */
  const countLine = el('p', { class: 'muted small count', role: 'status', 'aria-live': 'polite' });

  function refreshTable(): void {
    // Keep keyboard focus on the sort button that was pressed (the table is
    // rebuilt on every sort and filter change).
    const focused = (document.activeElement as HTMLElement | null)?.dataset['key'];
    clear(tableHost);
    tableHost.append(table());
    labelCitationsIn(tableHost); // "CSE §4.4.1" (DGS 2026-10-03)
    if (focused?.startsWith('sort.')) tableHost.querySelector<HTMLElement>(`[data-key="${focused}"]`)?.focus();
    clearButton?.classList.toggle('hidden', !filtersActive());
    filtersToUrl(filters, DEFAULTS);
    // Filtering 176 rows down to three changes the page height by thousands of
    // pixels. The ResizeObserver in embed.ts sees it too; this just gets the
    // message out on the same frame as the rebuild.
    notifyEmbedHeight();
  }

  /** Column visibility for the chosen view (item 30): a class on each hidden
   * header and cell, so the card layout on phones hides the same fields.
   * `col` is the 1-based column; `base` is the cell's own class, kept first. */
  const colClass = (hidden: Set<number>, col: number, base = ''): string => (hidden.has(col) ? `${base} col-hidden`.trim() : base);
  /** The same for a cell with no class of its own: an attribute only when hidden. */
  const colAttr = (hidden: Set<number>, col: number): Record<string, string> => (hidden.has(col) ? { class: 'col-hidden' } : {});

  // Sortable headers expose their state (aria-sort) and say what pressing
  // them does (usability review 2026-09-05, item 26).
  const sortHeader = (hidden: Set<number>, col: number, key: SortKey, label: string, sub = ''): HTMLElement => {
    const active = filters.sort === key;
    const direction = filters.desc ? 'descending' : 'ascending';
    return el(
      'th',
      { scope: 'col', 'aria-sort': active ? direction : 'none', ...colAttr(hidden, col) },
      el(
        'button',
        {
          class: `sort${active ? ' active' : ''}`,
          'data-key': `sort.${key}`,
          onclick: () => {
            if (filters.sort === key) filters.desc = !filters.desc;
            else {
              filters.sort = key;
              filters.desc = false;
            }
            refreshTable();
          },
          'aria-label': active ? `${label} — sorted ${direction}; press to reverse` : `${label} — press to sort by it`,
        },
        label,
        active ? (filters.desc ? ' ▼' : ' ▲') : '',
        sub ? el('span', { class: 'th-sub' }, sub) : '',
      ),
    );
  };

  // A filter that matches nothing used to render nothing, and silence reads
  // as "this course does not count" — the opposite of the project's rule
  // never to guess (2026-09-08).
  const emptyRow = (): HTMLElement =>
    // Three separate things a reader can be looking at, and the old single
    // sentence answered only one of them (review B-20, 2026-09-18): a typo
    // was told the course "has not been decided by the DGS", and a course
    // hidden by the retired switch was described as undecided too.
    el(
      'tr',
      { class: 'empty-row' },
      el(
        'td',
        { colspan: someRowPending ? '9' : '8' },
        el('strong', {}, 'No course here matches these filters. '),
        ...(filters.query.trim() ? ['Check the spelling of “', filters.query.trim(), '” first — the search matches a course number or a word in the title. '] : []),
        ...(!filters.includeRetired ? ['Retired courses are hidden until “Include retired courses” is ticked. '] : []),
        'If the course is not on this page at all, the DGS has not ruled on it yet; that is not the same as “does not count”, and the degree self-check tool prepares the review request that asks for a ruling.',
      ),
    );

  const courseRow = (r: RuleCourse, hidden: Set<number>): HTMLElement => {
    // "Ineligible" is a ruling, not a blank: it is printed in full ink on
    // the schedule cards and was greyed out here (review B-14).
    const catClass = groupsOf(r).length === 0 && !r.categoryIneligible ? 'muted' : '';
    return el(
      'tr',
      { id: rowAnchorId(r), class: r.active ? '' : 'retired' },
      el('th', { scope: 'row', class: colClass(hidden, 1, 'course-id') }, r.courseId, r.active ? '' : el('span', { class: 'pill retired' }, 'Retired')),
      el('td', { class: colClass(hidden, 2, 'cell-title') }, r.title),
      el('td', { ...colAttr(hidden, 3), 'data-label': 'Type' }, TYPE_LABEL[r.courseType]),
      el('td', { ...colAttr(hidden, 4), 'data-label': 'MSCSE degree credit' }, countsPill(r.countsTowardMscse)),
      el('td', { ...colAttr(hidden, 5), 'data-label': 'Ph.D. degree credit' }, countsPill(r.countsTowardPhd)),
      el('td', { class: colClass(hidden, 6, r.coreArea ? '' : 'muted'), 'data-label': 'Core knowledge (§4.4.1)' }, coreLabel(r)),
      el('td', { class: colClass(hidden, 7, catClass), 'data-label': 'Specialization (§4.4.2)' }, categoryLabel(r)),
      el('td', { class: colClass(hidden, 8, r.typicallyOffered ? '' : 'muted'), 'data-label': 'Typically offered' }, offeredLabel(r)),
      // (Column 9 is hidden by no view.)
      ...(someRowPending
        ? [
            el(
              'td',
              { 'data-label': 'DGS reviewed' },
              r.dgsReviewed ? el('span', { class: 'pill yes' }, '✓ Confirmed') : el('span', { class: 'pill pending' }, 'Pending'),
            ),
          ]
        : []),
    );
  };

  /** "18 of 176 courses shown." plus what is filtering them. */
  const countLineText = (list: RuleCourse[]): string => {
    const shown = rows.filter((r) => filters.includeRetired || r.active).length;
    // The view label keeps its case ("M.S. (MSCSE)", "Ph.D." — lower-casing it
    // read "m.s. (mscse)", found live 2026-09-06); its first letter is lowered
    // to sit inside the sentence.
    const viewLabel = VIEW_LABEL[filters.view];
    // WHICH filters are active, not just that some are. On screen it saves a
    // look up at the bar; on paper it is the only way to tell what the sheet
    // of 18 courses in your hand is a list OF (review B-19, 2026-09-18).
    const active: string[] = [];
    if (filters.query.trim()) active.push(`search “${filters.query.trim()}”`);
    if (filters.program !== 'all') active.push(filters.program === 'mscse' ? 'counts toward the MSCSE' : 'counts toward the Ph.D.');
    if (filters.core) active.push(`core knowledge: ${coreName.get(filters.core) ?? filters.core}`);
    if (filters.category) active.push(`specialization: ${groupName.get(filters.category) ?? filters.category}`);
    if (filters.type) active.push(`type: ${TYPE_LABEL[filters.type as CourseType]}`);
    if (filters.offered === 'now') active.push(`on the schedule for ${termLabel(thisTeachingTerm)}`);
    if (filters.offered === 'next') active.push(`on the schedule for ${termLabel(nextTeachingTerm)}`);
    if (filters.includeRetired) active.push('retired courses included');
    if (filters.confirmedOnly) active.push('DGS-confirmed rows only');
    // Printed as written. (The first-letter lower-casing of 2026-09-06 existed
    // only because every label began with "Whether"; it would now print "mSCSE
    // degree credit". The labels end in "." in one case, so no second stop.)
    const viewSentence = filters.view === 'all' ? '' : ` View: ${viewLabel}${viewLabel.endsWith('.') ? '' : '.'}`;
    return `${list.length} of ${shown} courses shown.${clearedFor ? ` Filters cleared to show ${clearedFor}.` : ''}${active.length > 0 ? ` Filters: ${active.join('; ')}.` : ''}${viewSentence}`;
  };

  function table(): HTMLElement {
    const all = visibleRows();
    const list = all.filter((r) => !isNonCse(r));
    const others = all.filter(isNonCse);
    const hidden = new Set(HIDDEN_COLUMNS[filters.view]);
    // Built per table: the sort buttons carry click handlers, which a clone
    // would not (the non-CSE table below gets its own header).
    const headRow = (): HTMLElement => el(
      'tr',
      {},
      sortHeader(hidden, 1, 'course', 'Course'),
      sortHeader(hidden, 2, 'title', 'Title'),
      sortHeader(hidden, 3, 'type', 'Type'),
      sortHeader(hidden, 4, 'mscse', 'MSCSE', 'degree credit'),
      sortHeader(hidden, 5, 'phd', 'Ph.D.', 'degree credit'),
      // The same wording as the schedule cards' own headers (trim review P-30).
      sortHeader(hidden, 6, 'core', 'Core knowledge', 'Ph.D. Qual. §4.4.1'),
      sortHeader(hidden, 7, 'category', 'Specialization', 'Ph.D. Qual. §4.4.2'),
      sortHeader(hidden, 8, 'offered', 'Typically offered'),
      // Only while it says something (trim review P-18, 2026-09-18).
      ...(someRowPending ? [sortHeader(hidden, 9, 'reviewed', 'DGS reviewed')] : []),
    );
    const head = headRow();
    const body = el('tbody', {});
    if (all.length === 0) body.append(emptyRow());
    for (const r of list) body.append(courseRow(r, hidden));
    countLine.textContent = countLineText(all);
    const scroller = (tbl: HTMLElement, label: string) =>
      // The scroll wrapper is keyboard-focusable and named, so a keyboard
      // user can scroll a wide table (WCAG 2.1.1; item 26).
      el('div', { class: 'table-scroll', tabindex: '0', role: 'region', 'aria-label': label }, tbl);
    const out = el(
      'div',
      {},
      countLine,
      scroller(
        el(
          'table',
          { class: 'course-rules' },
          el('caption', { class: 'visually-hidden' }, 'Courses and how they count toward the CSE graduate requirements'),
          el('thead', {}, head),
          body,
        ),
        'Course rules table (scrolls sideways on narrow screens)',
      ),
    );
    if (others.length > 0) {
      const otherBody = el('tbody', {});
      for (const r of others) otherBody.append(courseRow(r, hidden));
      out.append(
        el(
          'section',
          { class: 'non-cse', 'data-key': 'table.non-cse' },
          el('h3', {}, NON_CSE_HEADING),
          el('p', { class: 'hint non-cse-note' }, NON_CSE_NOTE),
          scroller(
            el(
              'table',
              { class: 'course-rules' },
              el('caption', { class: 'visually-hidden' }, 'Non-CSE courses the DGS has reviewed, and how they count'),
              el('thead', {}, headRow()),
              otherBody,
            ),
            'Non-CSE course rules table (scrolls sideways on narrow screens)',
          ),
        ),
      );
    }
    return out;
  }

  /** The legend now precedes the table (usability review 2026-09-05, item
   * 26 — users met "Pending" before its definition): a one-line key that is
   * always visible, and the full column guide in a disclosure. */
  function legend(): HTMLElement {
    const li = (term: string | Node, text: string) => el('li', {}, term, ' — ', text);
    // Each pill and the words it defines travel together when the line wraps
    // (trim review P-24, 2026-09-18) — the separators are unchanged.
    const entry = (...parts: (string | Node)[]) => el('span', { class: 'legend-entry' }, ...parts);
    const key = el(
      'p',
      { class: 'legend-key muted small' },
      'Key: ',
      entry(el('span', { class: 'pill yes' }, 'Yes'), ' counts · '),
      entry(
        el('span', { class: `pill ${COUNTS_CLASS.dgs_approval}` }, COUNTS_LABEL.dgs_approval),
        ' / ',
        el('span', { class: `pill ${COUNTS_CLASS.adgs_approval}` }, COUNTS_LABEL.adgs_approval),
        ' counts once the advisor and the named reviewer approve it · ',
      ),
      entry(el('span', { class: 'pill no' }, 'No'), ' does not count · '),
      entry(el('span', { class: 'pill undecided' }, 'Not yet decided'), ' ask first'),
      // The Pending half appears only while some row is unconfirmed, with the
      // column and the switch it explains (trim review P-18).
      ...(someRowPending ? [entry(' · ', el('span', { class: 'pill pending' }, 'Pending'), ' row not yet confirmed by the DGS')] : []),
      '.',
    );
    const details = el('details', { class: 'legend' });
    // Print it open. Closed, a printed copy carried 117 rows of pills and lost
    // every sentence that qualifies them — that only regular courses count
    // toward the regular-course credits (§3.2, §4.2), the 6-credit cap the
    // approved sub-60000 courses share, what the two qualifier columns mean
    // (§4.4.1, §4.4.2) and that "Typically offered" is not a promise (trim
    // review P-32, 2026-09-18). The screen is untouched: the disclosure is
    // restored to whatever the reader had. `::details-content` would do this
    // in CSS but Safari does not have it.
    let openBeforePrint = false;
    window.addEventListener('beforeprint', () => {
      openBeforePrint = details.open;
      details.open = true;
    });
    window.addEventListener('afterprint', () => {
      details.open = openBeforePrint;
    });
    details.append(
      el('summary', {}, 'How to read the columns'),
      el(
        'ul',
        {},
        // "the total only" was not true of either degree (review B-24,
        // 2026-09-18): §3.2 requires six credits of CSE 68901/68902 for the
        // MSCSE and §4.2 requires the two research-seminar credits, so those
        // are required credits of their own kind, not filler.
        li(
          el('strong', {}, 'Type'),
          'only regular courses count toward the regular-course credits (§3.2, §4.2). Seminar, research, independent-study and project credits count toward the degree total instead. Some are required in their own right: the M.S. project or thesis credits (§3.2) and the first-year research seminars (§4.2).',
        ),
        // Two reviewers, two colours (DGS 2026-09-16) — and the ADGS pill here
        // was painted in the DGS blue until 2026-09-18 (review B-13), so the
        // one place that explains the colours was the one place they did not
        // hold. Both come from COUNTS_CLASS now, which cannot drift again.
        li(
          el('span', {}, el('span', { class: `pill ${COUNTS_CLASS.dgs_approval}` }, COUNTS_LABEL.dgs_approval), ' / ', el('span', { class: `pill ${COUNTS_CLASS.adgs_approval}` }, COUNTS_LABEL.adgs_approval)),
          'counts once the advisor and the named reviewer both approve it. The sheet names the reviewer course by course (for example CSE courses below 60000, which share one 6-credit cap however many are approved).',
        ),
        li(el('span', { class: 'pill undecided' }, 'Not yet decided'), 'no ruling on this course yet; ask the ADGS (MSCSE) or the DGS (Ph.D.) before relying on it.'),
        // The three area names come from the Categories tab, like the cards,
        // the filter and the cells — they were a string literal here until
        // 2026-09-18 (review B-35), so any edit to that tab left this sentence
        // contradicting the rest of the page.
        li(
          el('strong', {}, 'Core knowledge'),
          `a Qualifying Examination requirement (§4.4.1), Ph.D. students only: which area ${rules.coreAreas.length > 0 ? `(${rules.coreAreas.map((c) => c.name).join(', ')})` : '(none listed in the rules sheet yet)'} the course satisfies. An equivalent course passed at a previous institution — undergraduate or graduate — also counts, once the DGS confirms it.`,
        ),
        li(
          el('strong', {}, 'Specialization'),
          `a Qualifying Examination requirement (§4.4.2), Ph.D. students only: ${catRule}. A course listed under more than one category can fill only one. "Ineligible" means §4.4.2 rules the course out; it says nothing about degree credit, which the credit columns answer.`,
        ),
        li(el('strong', {}, 'Typically offered'), 'a planning hint from past schedules, not a promise — check the class search for the actual term.'),
        ...(scheduleKnown
          ? [
              li(
                el('strong', {}, 'On the schedule'),
                `a filter, not a column: the courses the DGS has marked as running in ${termLabel(thisTeachingTerm)} or ${termLabel(nextTeachingTerm)}. A course with nothing recorded is not listed — the sheet is silent, not saying it will not run. Unlike "Typically offered", this is the DGS's word on these two semesters.`,
              ),
            ]
          : []),
        ...(someRowPending ? [li(el('span', { class: 'pill pending' }, 'Pending'), 'the DGS has not yet confirmed this row; treat it as provisional.')] : []),
      ),
    );
    return el('div', { class: 'legend-block' }, key, details);
  }

  function footer(): HTMLElement {
    // Embedded, the masthead's own source line already says where the data come
    // from, and the host page carries the department's footer — so only the
    // licence stays, under the way out of the frame. The licence is not
    // optional chrome: it is the University's notice and travels with the page
    // wherever the page goes (CLAUDE.md, "dual-licensed").
    const embed = isEmbedded();
    return el(
      'footer',
      { class: 'legal' },
      embed
        ? el('div', { class: 'embed-exit-line' }, openFullPageLink('Open the full course-rules page'), ' — the same list outside this page.')
        : null,
      // (The footer's "Source." paragraph went on 2026-09-18, trim review P-1 and
      // P-12. Its last sentence was the opening banner's first, word for word,
      // and the rest was the masthead's own source line again — the spreadsheet
      // named, linked and marked faculty-only, and the handbook linked. Both are
      // still on the page, above. The self-check page's footer is untouched:
      // `sheetSourceNote` is shared and still called there.)
      el(
        'div',
        { class: 'legal-license' },
        el('strong', {}, 'License. '),
        '© 2026 University of Notre Dame du Lac. Free for non-commercial (academic and research) use; commercial use requires a license from Notre Dame’s IDEA Center (',
        mailto('softwarelicensing@nd.edu'),
        '). Full terms: ',
        el('a', { href: LICENSE_URL, target: '_blank', rel: 'noopener noreferrer' }, 'LICENSE.md'),
        ' · source: ',
        el('a', { href: REPO_URL, target: '_blank', rel: 'noopener noreferrer' }, 'GitHub'),
        // (The DGS's address was here a third time — the banner and the contact
        // card both carry it, in both modes. Trim review P-34, 2026-09-18.)
        '.',
      ),
      // Which rules, handbook and build this page shows (DGS 2026-10-11, item
      // 8) — the self-check page's "Checked with" line; embedded too, since a
      // reader reporting a wrong row from the frame needs it most.
      el('p', { class: 'legal-stamp' }, `Version: ${stampLine(resultStamp(rules))}.`),
    );
  }

  // ---------- assemble ----------

  clear(root);
  root.classList.add('courses-page');
  filterHost.append(filterBar());
  // The bar's shape depends on the width (a fold below 861 px); a rotated
  // tablet or a dragged window gets the other shape, with its values kept —
  // they live in `filters`, not in the controls.
  wideFilters.addEventListener?.('change', rebuildFilterBar);
  refreshTable();
  const embedded = isEmbedded();
  root.append(
    el('a', { class: 'skip-link', href: '#all-courses' }, 'Skip to the course list'),
    hoverCard,
    masthead(),
    el(
      'main',
      { id: 'main' },
      ...notices(),
      // Order (DGS 2026-09-16): the qualifying-examination courses first, then
      // the schedule, then the full list.
      overview(),
      scheduleSection(),
      el('section', { class: 'all-courses', id: 'all-courses', tabindex: '-1' }, el('h2', {}, 'All courses'), filterHost, legend(), tableHost),
      // "Who to contact" is a right-hand column on the full page; in a ~700 px
      // frame there is no right-hand column, so it becomes the last block of
      // the page instead of the first (DGS 2026-09-16).
      embedded ? contactCard() : mainContactHost,
    ),
    footer(),
  );
  // Which document each section is from, on everything drawn above (DGS 2026-10-03).
  labelCitationsIn(root);
  // A card link points at a row in the table below, and a filter the reader
  // left on can hide that row, so the click goes nowhere (review B-10,
  // 2026-09-18). Rather than a dead link, clear the filters and let the click
  // land: the count line names which filters were on, so what happened is on
  // screen. Registered before the embed relay, which reads the target's
  // position on the same click and needs it to exist by then.
  root.addEventListener('click', (ev) => {
    const link = (ev.target as Element | null)?.closest?.('a[href^="#"]');
    if (!(link instanceof HTMLAnchorElement)) return;
    let id = '';
    try {
      id = decodeURIComponent(link.getAttribute('href')?.slice(1) ?? '');
    } catch {
      return;
    }
    // Only a course row is worth un-filtering for — not "#all-courses".
    if (!id || !/^(sched-(this|next)-)?[A-Z]{2,6}-\d/.test(id)) return;
    if (document.getElementById(id)) return;
    Object.assign(filters, defaultFilters());
    rebuildFilterBar();
    // Say so. This is the one click on the page that changes state by itself,
    // and the count line comes back reading "117 of 117 courses shown" with the
    // reader's filter gone and the Clear button hidden in the same instant.
    clearedFor = id.replace(/^sched-(this|next)-/, '').replace('-', ' ');
    refreshTable();
    clearedFor = undefined;
  });

  if (embedded) {
    startAnchorScrollRelay(root); // #CSE-60641 links, in a frame that cannot scroll
    notifyEmbedHeight();
  }
  // A link an advisor sent — courses.html#CSE-60641, or #sched-this-CSE-60641
  // from the qualifier cards — is resolved by the browser while this page is
  // still the loading card, so by the time the row exists the fragment has
  // been forgotten and the reader lands on the masthead. Reproduced cold in a
  // fresh browser; a second visit worked, which is why it went unnoticed
  // (review B-7, 2026-09-18). Re-applying it here costs nothing when there is
  // no fragment.
  {
    let done = false;
    const applyHash = (): void => {
      if (done) return;
      let id = '';
      try {
        id = decodeURIComponent(window.location.hash.slice(1));
      } catch {
        id = window.location.hash.slice(1);
      }
      if (!id) {
        done = true;
        return;
      }
      const target = document.getElementById(id);
      if (!target) return; // nothing by that name — a stale link, nothing to do
      done = true;
      // A schedule row can sit inside a collapsed <details> on a narrow screen
      // (trim review P-20): scrolling to it without opening that first leaves
      // the reader on a blank stretch of page.
      for (let d = target.closest('details'); d; d = d.parentElement?.closest('details') ?? null) d.open = true;
      if (embedded) postScrollTo(target); // the frame cannot scroll itself
      else target.scrollIntoView({ block: 'start' });
      // `:target` styling follows the address, which has not changed, so the
      // row carries its own class to be highlighted the same way.
      target.classList.add('deep-linked');
    };
    // Both clocks, as the height broadcast does (embed.ts): a frame callback
    // is the right moment when the page is on screen, and does not run at all
    // in a background tab or a throttled headless browser.
    requestAnimationFrame(applyHash);
    setTimeout(applyHash, 120);
  }
}
