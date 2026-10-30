// The copy-ready review request to the DGS (decisions 2026-09-03): one email
// covering the Notre Dame courses that still need a DGS decision and the
// courses from other universities the ExternalCourses tab has not ruled on,
// with paste-ready sheet rows below a DO-NOT-MODIFY line. Text only — no DOM;
// the 'Ask the DGS to review' card (app.ts askDgsCard) copies what this builds.
//
// Moved here VERBATIM from the tail of src/transcript/external.ts on
// 2026-10-22 (blue-team review 2026-10-17, W3): the builder had been appended
// to the transcript parser, and the one static import of its marker constants
// (grad-admin-request.ts) pulled the whole 4,000-line parser into every first
// load. The markers now live in email-html.ts beside the other email helpers.
import { NOTRE_DAME_ROW_UNIVERSITY, isNotreDameInstitution, normalizeCourseId, normalizeUniversity } from '../data/external.ts';
import { formatCredits } from '../engine/credits.ts';
import type { PendingDgsReview } from '../engine/review.ts';
import { termLabel } from '../engine/term.ts';
import { ACTION_HEADING, DO_NOT_MODIFY_MARKER, EDITABLE_MARKER, MARKER_DIVIDER, STUDENT_LINE, esc, fullerTitle, studentLineHtml } from './email-html.ts';
import { shortenAfterFirst } from './first-mention.ts';

/** One unreviewed course, pre-rendered for the review request (the caller
 * supplies the term label and slot label — this file builds text, never DOM). */
interface ReviewRequestCourse {
  institution?: string;
  courseId: string;
  title?: string;
  /** As the transcript prints them. */
  credits: number;
  /** The Notre Dame credits the self-check counts, when they differ — a
   * quarter or trimester conversion, or the DGS's nd_credits (#63). */
  ndCredits?: number;
  grade: string;
  termText: string;
  slotLabel?: string;
  /** The credit system the student's record carries for this course —
   * quarter or trimester, read from the transcript or chosen in the preview;
   * undefined = semester or not stated. Fills a Universities-tab row the
   * request suggests (DGS 2026-10-10). */
  creditSystem?: 'quarter' | 'trimester';
  /** The student chose `creditSystem` in the preview; the transcript reader
   * had not read it (DGS 2026-10-10, item 3) — the request says "I chose". */
  creditSystemChosen?: true;
  /** What the DGS is asked to do (engine/review.ts ReviewAsk, 2026-09-28).
   * Optional for older callers: then a new row is asked for when `unlisted`,
   * with no reply. */
  ask?: { needsRow: boolean; replyNeeded: boolean; decide: string[]; rulings?: string[] };
}

/** Shared assembly for the copy-ready review requests (decisions 2026-09-03).
 * The request goes to the DGS alone (DGS decision 2026-09-06 — the Grad
 * Admin is not part of the review). Two clipboard flavors are returned and
 * written together: `text` (tab-separated sheet rows, pipe-separated detail
 * rows) for plain-text contexts, and `html`, where every row set is a REAL
 * `<table>` — HTML email composers (Gmail etc.) flatten tab characters to
 * spaces, but a table survives the whole journey: app → email → the DGS
 * copies it → Google Sheets pastes it as cells. The course details are
 * tables too (DGS request 2026-09-06: easier to read than bullet lines). */
function buildReviewRequest(opts: {
  subject: string;
  /** Who decides: the ADGS on the MSCSE (§3.2; DGS 2026-09-11), the DGS on
   * the Ph.D. — the greeting's title (policy review round 3, P3-emails-5). */
  decider: 'DGS' | 'ADGS';
  intro: string;
  /** Extra context lines shown right under the intro (e.g. prior graduate study). */
  context: readonly string[];
  /** The numbered "Action requested" list (DGS 2026-09-28): what the reader
   * must do, grouped — a group with no items is skipped. Items are numbered
   * straight through the groups. */
  actions: readonly { heading: string; items: readonly string[] }[];
  /** Sheet-paste sections (one per tab); a section with no rows is skipped. */
  sections: readonly { rowsIntro: string; rows: readonly (readonly string[])[] }[];
  detailsTitle: string;
  /** Column headers of the detail tables. */
  detailHeaders: readonly string[];
  /** Detail rows grouped per transcript, each group a table under its heading. */
  detailGroups: readonly { heading: string; rows: readonly (readonly string[])[] }[];
  /** "Checked with: …" (src/ui/stamp.ts; DGS 2026-10-11, item 8): the last
   * line, below the course details. */
  stamp?: string;
}): { text: string; html: string; subject: string } {
  // `esc` is email-html.ts's (the local copy it had was byte-identical; W3, 2026-10-22).
  const greeting = `Dear ${opts.decider},`;
  const sections = opts.sections.filter((s) => s.rows.length > 0);
  const groups = opts.detailGroups.filter((g) => g.rows.length > 0);
  // The plain-text flavour, which a mail app set to plain text — or pasting
  // without formatting — keeps instead of the HTML table: one block per
  // course, its facts on one line and each long cell on its own (DGS
  // 2026-10-30: "a | b | c" rows wrapped into an unreadable run). The HTML
  // flavour keeps the table (2026-09-06).
  const textBlock = (r: readonly string[]): string => {
    const h = opts.detailHeaders;
    const facts = r.slice(2, 5).map((v, i) => (v === '' ? '' : `${h[i + 2]}: ${v}`)).filter((x) => x !== '');
    const rest = r.slice(5).map((v, i) => (v === '' ? '' : `   ${h[i + 5]}: ${v}`)).filter((x) => x !== '');
    return [`- ${[r[0], r[1]].filter((x) => x !== undefined && x !== '').join(' ')}`, ...(facts.length > 0 ? [`   ${facts.join(' · ')}`] : []), ...rest].join('\n');
  };
  // The human half (greeting, context, sign-off) sits ABOVE one line; the
  // machine-readable half (tables + details) below it. Both halves are
  // marked at the line (DGS wording, 2026-09-03 and 2026-09-06): the student
  // may reword the email, but must leave the tables intact.
  const editable = EDITABLE_MARKER;
  const marker = DO_NOT_MODIFY_MARKER;
  const divider = MARKER_DIVIDER;
  // The same skeleton as the other two emails (DGS 2026-09-28): the student
  // line, the intro and standing, then the numbered actions — the reader's
  // own — above the sign-off; the sheet rows and details below the line.
  const actionGroups = opts.actions.filter((g) => g.items.length > 0);
  let n = 0;
  const actionsText = actionGroups.length === 0 ? '' : `${ACTION_HEADING.toUpperCase()}\n` + actionGroups.map((g) => `${g.heading}\n${g.items.map((i) => `${++n}. ${i}`).join('\n')}\n`).join('') + '\n';
  n = 0;
  const actionsHtml =
    actionGroups.length === 0
      ? ''
      : `<p><strong>${esc(ACTION_HEADING)}</strong></p>` +
        actionGroups.map((g) => `<p>${esc(g.heading)}</p><ol start="${n + 1}">${g.items.map((i) => (++n, `<li>${esc(i)}</li>`)).join('')}</ol>`).join('');
  const text =
    `Subject: ${opts.subject}\n\n${greeting}\n\n${STUDENT_LINE}\n\n${opts.intro}\n` +
    opts.context.map((c) => `${c}\n`).join('') +
    `\n${actionsText}Thank you!\n\n${editable}\n${divider}\n${marker}\n\n` +
    sections.map((s) => `${s.rowsIntro}\n\n${s.rows.map((r) => r.join('\t')).join('\n')}\n\n`).join('') +
    `${opts.detailsTitle}\n\n` +
    groups.map((g) => `${g.heading}\n${g.rows.map(textBlock).join('\n')}`).join('\n\n') +
    `\n${opts.stamp ? `\n${opts.stamp}\n` : ''}`;
  const html =
    `<p>${esc(`Subject: ${opts.subject}`)}</p><p>${esc(greeting)}</p>${studentLineHtml()}<p>${esc(opts.intro)}` +
    (opts.context.length > 0 ? `<br>${opts.context.map((c) => esc(c)).join('<br>')}` : '') +
    `</p>${actionsHtml}<p>Thank you!</p><p><strong>${esc(editable)}</strong></p><hr><p><strong>${esc(marker)}</strong></p>` +
    sections
      .map(
        (s) =>
          `<p>${esc(s.rowsIntro)}</p><table border="1" cellspacing="0" cellpadding="4">` +
          s.rows.map((r) => `<tr>${r.map((v) => `<td>${esc(v)}</td>`).join('')}</tr>`).join('') +
          `</table>`,
      )
      .join('') +
    `<p>${esc(opts.detailsTitle)}</p>` +
    groups
      .map(
        (g) =>
          `<p><strong>${esc(g.heading)}</strong></p><table border="1" cellspacing="0" cellpadding="4"><tr>${opts.detailHeaders.map((h) => `<th>${esc(h)}</th>`).join('')}</tr>` +
          g.rows.map((r) => `<tr>${r.map((v) => `<td>${esc(v)}</td>`).join('')}</tr>`).join('') +
          `</table>`,
      )
      .join('') +
    (opts.stamp ? `<p>${esc(opts.stamp)}</p>` : '');
  // The subject travels with the flavours (the copy dialog shows it, 2026-09-06 evening);
  // "Oral Candidacy Exam (OCE)" in full once per flavour, then "OCE".
  return { text: shortenAfterFirst(text), html: shortenAfterFirst(html), subject: opts.subject };
}

// (The three marker constants every copied request carries — EDITABLE_MARKER,
// DO_NOT_MODIFY_MARKER, MARKER_DIVIDER — live in email-html.ts since W3.)

/** One pending course in the combined review request (2026-09-03: ONE request
 * covers everything). `unlisted` marks courses that need a NEW sheet row —
 * ND courses missing from the Courses tab, external courses with no
 * ExternalCourses ruling; the rest need a decision, not a row. */
export interface PendingReviewCourse extends ReviewRequestCourse {
  reason: string;
  unlisted: boolean;
}

/** The review request's two course lists from the engine's pending decisions.
 * Notre Dame courses (program coursework and prior coursework) feed the
 * Courses-tab rows; other universities the ExternalCourses rows — and so does
 * a course from an earlier Notre Dame program whose transfer decision is still
 * to be entered, under UNIVERSITY OF NOTRE DAME (policy review round 3,
 * P3-dh-10-2; DGS 2026-10-06): a row in the "enter in the course rules" list,
 * not an email reply the page cannot record. Its Courses-tab part stays only
 * while the course is not listed there. */
export function reviewRequestCourses(
  pending: readonly PendingDgsReview[],
  slotLabel: (p: PendingDgsReview) => string | undefined,
): { nd: PendingReviewCourse[]; external: PendingReviewCourse[] } {
  const request = (p: PendingDgsReview): PendingReviewCourse => ({
    courseId: p.course.entry.courseId,
    title: fullerTitle(p.course.entry.title, p.course.rule?.title ?? p.course.external?.title),
    // The transcript's figure, with the Notre Dame credits the self-check
    // counts when they differ — a quarter or trimester conversion, or the
    // DGS's nd_credits (credit-transfer review 2026-10-28, #63).
    credits: p.course.entry.credits,
    ...(p.course.effectiveCredits !== undefined && Math.abs(p.course.effectiveCredits - p.course.entry.credits) > 1e-9 ? { ndCredits: p.course.effectiveCredits } : {}),
    grade: p.course.entry.grade,
    termText: termLabel(p.course.entry.term),
    reason: p.reason,
    unlisted: p.unlisted,
    ask: p.ask,
  });
  return {
    nd: pending.filter((p) => p.kind !== 'external' && (p.transferRow === undefined || p.ask.decide.length > 0)).map(request),
    external: [
      ...pending
        .filter((p) => p.kind === 'external')
        .map((p) => {
          const system = p.course.entry.creditSystem;
          return {
            ...request(p),
            institution: p.course.entry.institution,
            slotLabel: slotLabel(p),
            ...(system === 'quarter' || system === 'trimester'
              ? { creditSystem: system, ...(p.course.entry.creditSystemChosen ? { creditSystemChosen: true as const } : {}) }
              : {}),
          };
        }),
      ...pending
        .filter((p) => p.transferRow !== undefined)
        .map((p) => ({
          ...request(p),
          institution: NOTRE_DAME_ROW_UNIVERSITY,
          slotLabel: slotLabel(p),
          reason: p.transferRow!.reason,
          unlisted: true,
          ask: { needsRow: true, replyNeeded: false, decide: p.transferRow!.decide },
        })),
    ],
  };
}

/** THE review request (2026-09-03): one email covering Notre Dame courses
 * that still need a DGS decision (not in the rules sheet — typical for
 * non-CSE; dgs_approval not yet approved; blank verdict) AND external courses
 * the ExternalCourses tab has not ruled on. Carries the student's prior
 * graduate study (the §5.2 caps depend on it), paste-ready rows per tab —
 * Courses (course_id, title) and ExternalCourses (UNIVERSITY in the sheet's
 * capital-English convention, course_id, course_title) — and detail lines
 * grouped per transcript. The tables and details are marked DO NOT MODIFY
 * (DGS wording, 2026-09-03), with "(You may edit anything above this line)"
 * above the divider (2026-09-06), so students reword only their own half and
 * leave the machine-readable parts intact. */
/** One paste-ready row per COURSE, not per attempt (DGS 2026-09-09). A student
 * may take the same course several times — a master's project or thesis credit
 * — and every attempt used to become its own row, which is how the
 * ExternalCourses tab collected duplicates that shadow each other (the last
 * row wins). The course DETAILS below still list every attempt: that is the
 * evidence the DGS is being asked to weigh, and the repetition is visible
 * there. Keyed the way the sheet itself matches, so "CS-591" and "CS 591" at
 * one university count as the same course. */
function oncePerCourse(courses: readonly PendingReviewCourse[], keyOf: (c: PendingReviewCourse) => string): PendingReviewCourse[] {
  const seen = new Set<string>();
  const out: PendingReviewCourse[] = [];
  for (const c of courses) {
    if (!c.unlisted) continue;
    const key = keyOf(c);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

/** Said only when a repeat was actually folded away, so the DGS knows why the
 * table is shorter than the details below it. */
const repeatNote = (kept: readonly PendingReviewCourse[], all: readonly PendingReviewCourse[]): string =>
  all.filter((c) => c.unlisted).length > kept.length
    ? ' (one row per course — a course taken more than once is listed once here, and once per term in the details below)'
    : '';

export function buildCombinedReviewRequest(opts: {
  /** The "Prior graduate study" choice, as its dropdown label. */
  priorStudy: string;
  nd: readonly PendingReviewCourse[];
  external: readonly PendingReviewCourse[];
  /** Notes for the DGS that are not about one course (2026-09-12). */
  notes?: readonly string[];
  /** The Notre Dame programs (src/ui/program-history.ts, DGS 2026-09-28):
   * `compact` for the subject, `earlier` for the standing lines. Optional
   * for older callers. */
  history?: { compact: string; earlier: string };
  /** The unofficial-transcript warning (src/ui/email-html.ts; DGS 2026-10-03). */
  unofficial?: string;
  /** The reader's title, decider.ts deciderTitle(program): "Dear ADGS," on
   * the MSCSE (policy review round 3, P3-emails-5). The course reasons arrive
   * already worded for it — the email is not rewritten again, which would
   * turn a course's deliberate "DGS" into "ADGS" (2026-09-13). Defaults to
   * the DGS for older callers. */
  decider?: 'DGS' | 'ADGS';
  /** Where the rules sheet stands on this university's credit system (the
   * Universities tab, DGS 2026-10-10): `set`; `blank` — listed, credit_system
   * empty or rejected, so list A asks to complete that row; `absent` — no row,
   * so list A asks for one and a paste-ready row goes in the tables. The
   * system is entered once, when the university first arrives. Omitted by
   * older callers: nothing is asked. */
  universityRow?: (university: string) => 'set' | 'blank' | 'absent';
  /** "Checked with: …" (src/ui/stamp.ts; DGS 2026-10-11, item 8): the
   * request's last line. Optional for older callers. */
  stamp?: string;
}): { text: string; html: string; subject: string } {
  // The student is writing to the DGS: "your advisor" is "my advisor".
  const voiced = (reason: string): string => reason.replace(/\byour advisor/g, 'my advisor').replace(/\bYour advisor/g, 'My advisor');
  const askOf = (c: PendingReviewCourse) => c.ask ?? { needsRow: c.unlisted, replyNeeded: false, decide: [] };
  // The rulings for this student (P3-emails-2): tagged by the engine; an older
  // caller's ask falls back to the "for me" wording it used to be split on.
  const rulingsOf = (c: PendingReviewCourse): string[] => {
    const a = askOf(c);
    return a.rulings ?? a.decide.filter((d) => /\bfor me\b/.test(d));
  };
  const detail = (c: PendingReviewCourse): string[] => [
    c.courseId,
    c.title ?? '',
    c.ndCredits !== undefined ? `${formatCredits(c.credits)} on the transcript (${formatCredits(c.ndCredits)} Notre Dame credits)` : formatCredits(c.credits),
    c.grade,
    c.termText,
    askOf(c).decide.join('; '),
    voiced(c.reason),
  ];
  // One row per course for the sheet; every attempt still shown in the details.
  const ndRows = oncePerCourse(opts.nd, (c) => normalizeCourseId(c.courseId));
  const extRows = oncePerCourse(opts.external, (c) => `${normalizeUniversity(c.institution ?? '')}|${normalizeCourseId(c.courseId)}`);
  // Group the external courses per transcript (slot + university), so the
  // details read the way the student uploaded them — one table per group.
  const groups: { heading: string; rows: string[][] }[] = [];
  if (opts.nd.length > 0) groups.push({ heading: 'Notre Dame:', rows: opts.nd.map(detail) });
  for (const c of opts.external) {
    // The institution as the student's record has it — no upper-casing (DGS
    // 2026-09-06, late evening: keep what the transcript prints; the rules
    // match names case-insensitively anyway).
    const heading = `${c.slotLabel ?? 'Entered by hand'} — ${c.institution ?? 'university not given'}:`;
    let g = groups.find((x) => x.heading === heading);
    if (!g) {
      g = { heading, rows: [] };
      groups.push(g);
    }
    g.rows.push(detail(c));
  }
  // The action list (DGS 2026-09-28): A — rows to enter or complete, which
  // need no reply because the page reads the sheet; B — decisions for this
  // student, which do. A course can be in both (prior Notre Dame coursework
  // with no row AND a §5.2 recommendation to give).
  const all = [...opts.nd, ...opts.external];
  const name = (c: PendingReviewCourse): string => `${c.courseId}${c.title ? ` ${c.title}` : ''} (${c.institution ?? 'Notre Dame'}, ${c.termText})`;
  // One item per course (a course taken twice is asked about once), listed
  // or not — unlike the paste-ready rows, which are for unlisted courses only.
  const distinct = (courses: readonly PendingReviewCourse[]): PendingReviewCourse[] => {
    const seen = new Set<string>();
    return courses.filter((c) => {
      const key = `${normalizeUniversity(c.institution ?? '')}|${normalizeCourseId(c.courseId)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };
  // The Universities tab (DGS 2026-10-10): for each university of the request
  // whose credit system the sheet does not give, an item in list A — a new row
  // (with a paste-ready one in the tables, prefilled with what this student's
  // record carries: quarter or trimester) or, when the row exists with a blank
  // system, completing it. Not for the Notre Dame transfer rows.
  const uniRows: string[][] = [];
  const uniItems: string[] = [];
  if (opts.universityRow) {
    const seen = new Set<string>();
    for (const c of opts.external) {
      const university = c.institution ?? '';
      const key = normalizeUniversity(university);
      if (key === '' || seen.has(key) || isNotreDameInstitution(university)) continue;
      seen.add(key);
      const state = opts.universityRow(university);
      if (state === 'set') continue;
      const carried = opts.external.find((x) => normalizeUniversity(x.institution ?? '') === key && x.creditSystem);
      const clause = carried?.creditSystem
        ? carried.creditSystemChosen
          ? `; I chose ${carried.creditSystem} hours when importing`
          : `; my transcript reads as ${carried.creditSystem} hours`
        : '';
      if (state === 'absent') {
        uniRows.push([university, carried?.creditSystem ?? '']);
        uniItems.push(`${university} — new row in the Universities tab: its credit system (quarter, trimester or semester)${clause}`);
      } else {
        uniItems.push(`${university} — complete its row in the Universities tab: credit_system (quarter, trimester or semester)${clause}`);
      }
    }
  }
  const sheetItems = distinct(all)
    .map((c) => {
      const a = askOf(c);
      // The sheet's part of the ask: everything that is not a ruling for the student.
      const rulings = new Set(rulingsOf(c));
      const decide = a.decide.filter((d) => !rulings.has(d));
      return decide.length === 0 ? '' : `${name(c)} — ${a.needsRow ? 'new row: ' : 'complete the row: '}${decide.join('; ')}`;
    })
    .filter((s) => s !== '');
  // List B: the rulings, with their text — never an item with nothing after the dash.
  const replyItems = distinct(all.filter((c) => rulingsOf(c).length > 0)).map((c) => `${name(c)} — ${rulingsOf(c).join('; ')}`);
  const history = opts.history;
  return buildReviewRequest({
    stamp: opts.stamp,
    subject: `Course review request (degree self-check)${history ? ` — ${history.compact}` : ''}`,
    decider: opts.decider ?? 'DGS',
    intro:
      'Could you review these courses for the degree self-check? ' +
      // Rulings for this student are decided by reply, not in the rules (P3-emails-2).
      'It cannot count them until they are decided — in the course rules, or by your reply where the question is about my record.',
    context: [
      ...(history?.earlier ? [history.earlier] : []),
      // (No second full stop after a label that ends in one — "…or Ph.D.".)
      `Prior graduate study: ${opts.priorStudy}${opts.priorStudy.endsWith('.') ? '' : '.'}`,
      // The "whichever apply" hedge instructs the student and lives in the
      // dialog step; the reader sees the attachments (trim review 2026-09-18, P-14).
      'My transcripts are attached.',
      ...(opts.unofficial ? [opts.unofficial] : []),
      ...(opts.notes ?? []).map((n) => `Please also check: ${n}`),
    ],
    actions: [
      { heading: 'A. Please enter or complete these in the course rules — no reply needed; the self-check reads the rules the next time I open it:', items: [...sheetItems, ...uniItems] },
      { heading: 'B. Please decide these for me — a reply is needed:', items: replyItems },
    ],
    // The reader owns the sheet (DGS 2026-09-03 wording, shortened in the trim
    // review 2026-09-18, P-15); naming no owner also keeps "the DGS's sheet"
    // from becoming "the ADGS's" on the MSCSE tab. Rows unchanged byte for byte.
    sections: [
      {
        rowsIntro: `Rows for the rules sheet — Courses tab:${repeatNote(ndRows, opts.nd)}`,
        rows: ndRows.map((c) => [c.courseId, c.title ?? '']),
      },
      {
        rowsIntro: `Rows for the rules sheet — ExternalCourses tab:${repeatNote(extRows, opts.external)}`,
        rows: extRows.map((c) => [c.institution ?? '', c.courseId, c.title ?? '']),
      },
      {
        rowsIntro: 'Rows for the rules sheet — Universities tab (university, credit_system):',
        rows: uniRows,
      },
    ],
    detailsTitle: 'Course details:',
    detailHeaders: ['Course', 'Title', 'Credits', 'Grade', 'Term', 'Please decide', 'Why'],
    detailGroups: groups,
  });
}
