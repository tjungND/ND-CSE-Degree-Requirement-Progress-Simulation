// Renders an AuditReport: score dial, credit meters, requirement groups with
// status pills + deadline chips + § citations. (The "Copy summary for advisor"
// email lives in advisor-summary.ts — string building only, no DOM.)
import { formatCredits } from '../engine/credits.ts';
import type { DeadlineAlert, StandingColor } from './email-html.ts';
import type { AuditReport, ConditionMark, Contribution, DetailPart, RequirementResult, Status } from '../engine/types.ts';
import { sourceName, withoutCitations } from './citations.ts';
import { el } from './dom.ts';
import { conditionMark } from './marks.ts';
import { isEmbedded } from './embed.ts';
import { siblingAnchorAttrs } from './sibling-links.ts';
import type { NextStep } from './next-steps.ts';

/** What the record calls for next (DGS 2026-09-27, clarity proposal 1),
 * handed in by renderReport / renderSummary and read by the dial and the
 * attention list. */
export interface NextInfo {
  sentence?: string;
  steps: NextStep[];
  nearest?: string;
}
let currentNext: NextInfo | undefined;
/** The "Does this look wrong?" link's address for a card (DGS 2026-10-11,
 * item 18; src/ui/report-problem.ts), set by renderReport; none in
 * simulation mode, where nothing is sent from a plan. */
let problemHrefOf: ((r: RequirementResult, pill: string) => string | undefined) | undefined;

// Plain words in sentence case (usability review 2026-09-05, item 16): no
// abbreviations — "N/A" became "Does not apply" — and the pill CSS no longer
// upper-cases them.
const STATUS_LABEL: Record<Status, string> = {
  met: 'Met',
  in_progress: 'In progress',
  // "Not yet" and "In progress" merged (DGS 2026-09-22: "If they are the
  // same, choose 'In progress'"); an unmet row whose deadline has passed is
  // the one that is not the same, and its pill reads "Overdue" (pillLabel).
  unmet: 'In progress',
  // "Conditionally met", not "Needs DGS review" (W-CS1, DGS 2026-09-18): the
  // student's POSITION, not the errand. The sub-line still names who must
  // approve, so nothing is lost by dropping the actor — and the pill no longer
  // needs first-mention.ts's DGS→ADGS rewrite for an MSCSE student.
  needs_dgs_review: 'Conditionally met',
  cannot_evaluate: 'Cannot evaluate',
  not_applicable: 'Does not apply',
};

/** An unmet row whose deadline has passed: the one "not yet" that is not
 * simply "in progress" (DGS 2026-09-22). */
export function isOverdue(r: RequirementResult): boolean {
  return r.status === 'unmet' && r.deadline?.state === 'overdue';
}
/** An unmet row whose stage has not begun — the engine leads its detail with
 * "Not started" (the dissertation rows before the OCE, DGS 2026-09-22). */
export function isNotStarted(r: RequirementResult): boolean {
  return r.status === 'unmet' && /^Not started\b/.test(r.detail);
}
/** An open row whose deadline falls in this semester or the next (DGS
 * 2026-09-28: "students need to see the alert … the deadline is next
 * semester"). The engine sets the horizon (openDeadline in status.ts); the
 * pill carries it in words and in its own colour. */
export function isDueSoon(r: RequirementResult): boolean {
  return r.status !== 'met' && r.deadline?.state === 'due_soon' && r.deadline.horizon !== undefined;
}
/** "due this semester" / "due next semester" — the pill's suffix and the
 * copied messages' highlight (DGS 2026-09-28). */
export function dueWording(r: RequirementResult): string | undefined {
  return isDueSoon(r) ? `due ${r.deadline!.horizon} semester` : undefined;
}
/** The pill's word: the engine's override, else "Overdue" / "Not started",
 * else the status word — with " · due next semester" (or "this") appended
 * while the row's deadline is that close (DGS 2026-09-28). */
export function pillLabel(r: RequirementResult): string {
  const due = dueWording(r);
  return due ? `${statusWord(r)} · ${due}` : statusWord(r);
}
/** The pill's word without the deadline suffix — what the copied messages
 * print as the row's standing (DGS 2026-09-28). */
export function statusWord(r: RequirementResult): string {
  return r.statusLabel ?? (isOverdue(r) ? 'Overdue' : isNotStarted(r) ? 'Not started' : STATUS_LABEL[r.status]);
}
/** The pill's colour, named, for the copied messages (style.css is the
 * source: overdue red, met green, conditional blue, not started and cannot
 * evaluate grey, everything open amber). */
export function standingColor(r: RequirementResult): StandingColor {
  if (isOverdue(r)) return 'red';
  if (r.status === 'met') return 'green';
  if (r.status === 'needs_dgs_review') return 'blue';
  if (isNotStarted(r) || r.status === 'cannot_evaluate' || r.status === 'not_applicable') return 'grey';
  return 'amber';
}
/** A row's deadline as the copied messages flag it: this semester, next
 * semester, passed, or (undefined) further off; null when there is none to
 * print (no deadline, done, or the row is met). */
export function deadlineAlert(r: RequirementResult): DeadlineAlert | null {
  const d = r.deadline;
  if (!d || d.state === 'done' || r.status === 'met') return null;
  return isOverdue(r) ? 'passed' : isDueSoon(r) ? d.horizon : undefined;
}
/** Extra pill classes for the display-only states: overdue, not started, and
 * the deadline alert (s-duesoon, which colours the pill whatever its word). */
function pillState(r: RequirementResult): string {
  return `${isOverdue(r) ? ' s-overdue' : isNotStarted(r) ? ' s-notstarted' : ''}${isDueSoon(r) ? ' s-duesoon' : ''}`;
}

/** The rows the headline counts: informational rows (the per-course sign-off
 * list, the along-the-way M.S.) and "does not apply" rows are outside the score. */
/** The allowances (meters, not verdicts — 2026-09-27). */
function allowanceCount(report: AuditReport): number {
  return report.requirements.filter((r) => r.allowance).length;
}
/** A row whose pill would read "Does not apply" (DGS 2026-10-05: "When
 * something is 'does not apply', hide it and do not show it"): no card. An
 * unused allowance draws a meter ("0 of 6 used") and a row with its own label
 * ("Not started") says something else, so both stay. The headline already
 * leaves these rows out (scoredRows). */
export function doesNotApply(r: RequirementResult): boolean {
  return r.status === 'not_applicable' && !r.allowance && r.statusLabel === undefined;
}

/** The warnings the student collapsed (2026-10-05), so a re-render keeps
 * the floating box down until a warning is added or goes away. */
let collapsedWarnings: string | undefined;
/** Next steps, floating: folded to its heading by the student (DGS 2026-10-08;
 * phones start folded). Remembered for the session, whatever the list says. */
let nextStepsFolded: boolean | undefined;

export function scoredRows(report: AuditReport): RequirementResult[] {
  return report.requirements.filter((r) => !r.informational && !r.unscored && !r.allowance && r.status !== 'not_applicable');
}

/** A requirement id as an element-id fragment: `phd.qualifier.core.os` → `phd-qualifier-core-os`. */
function idSlug(id: string): string {
  return id.replace(/[^a-z0-9]+/gi, '-');
}
/** The `id` of a requirement's card on the page — what every link to it targets. */
export function reqAnchorId(id: string): string {
  return `req-${idSlug(id)}`;
}

function dial(report: AuditReport, untouched = false): HTMLElement {
  const { met, conditional, scored } = report.summary;
  const pct = scored === 0 ? 0 : met / scored;
  // Conditional satisfaction is its own band on the arc (R2, 2026-09-18), drawn
  // from where the met band ends: a student can see at a glance how much of the
  // ring is theirs outright and how much waits on a signature.
  const condPct = scored === 0 ? 0 : conditional / scored;
  const C = 2 * Math.PI * 32;
  const svgNs = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNs, 'svg');
  svg.setAttribute('viewBox', '0 0 80 80');
  svg.setAttribute('class', 'dial');
  svg.setAttribute('aria-hidden', 'true'); // decorative — the headline text carries the numbers (item 17)
  const track = document.createElementNS(svgNs, 'circle');
  const condArc = document.createElementNS(svgNs, 'circle');
  const arc = document.createElementNS(svgNs, 'circle');
  for (const [c, cls] of [
    [track, 'dial-track'],
    [condArc, 'dial-arc dial-arc-conditional'],
    [arc, 'dial-arc'],
  ] as const) {
    c.setAttribute('cx', '40');
    c.setAttribute('cy', '40');
    c.setAttribute('r', '32');
    c.setAttribute('class', cls);
  }
  arc.setAttribute('stroke-dasharray', `${C * pct} ${C}`);
  // Red means something is WRONG, not "not finished yet" (2026-09-08). A Ph.D.
  // does not cross half the checks until about year four, so the old
  // pct > 0.5 test painted an on-track second-year student the same red as an
  // overdue deadline — the mistake already corrected in the headline below.
  arc.setAttribute(
    'stroke',
    pct === 1 ? 'var(--ok)' : report.requirements.some((r) => r.deadline?.state === 'overdue') ? 'var(--bad)' : 'var(--navy)',
  );
  condArc.setAttribute('stroke-dasharray', `${C * condPct} ${C}`);
  condArc.setAttribute('stroke-dashoffset', `${-C * pct}`);
  condArc.setAttribute('stroke', 'var(--info)');
  const text = document.createElementNS(svgNs, 'text');
  text.setAttribute('x', '40');
  text.setAttribute('y', '45');
  text.setAttribute('text-anchor', 'middle');
  text.setAttribute('class', 'dial-text');
  text.textContent = `${met}/${scored}`;
  svg.append(track, condArc, arc, text);

  // The headline counts what is met, in progress and still open instead of
  // "N to go", which read as bad news to a student on track (usability
  // review 2026-09-05, item 17); when everything passes it says what "all"
  // means here — the automatic checks, not the DGS's confirmation.
  const remaining = scored - met;
  // "In progress" and "not yet" are one count since 2026-09-22 (DGS: the two
  // words meant the same thing to the reader); a passed deadline is counted
  // apart, in red. Conditional satisfaction stands as its own count (R2,
  // 2026-09-18) and so does "cannot evaluate".
  const overdue = scoredRows(report).filter(isOverdue).length;
  const notStarted = scoredRows(report).filter(isNotStarted).length;
  const cannot = scoredRows(report).filter((r) => r.status === 'cannot_evaluate').length;
  const inProgress = remaining - conditional - overdue - notStarted - cannot;
  // The headline IS the status key (trim review 2026-09-18, P-49; R2's separate
  // key under the meters is gone): each count carries a dot in the colour of
  // the dial band it stands for, so the ring is readable without hovering
  // anything, and the same three numbers are no longer printed twice 180 px
  // apart. The dots are empty elements — the words carry the counts.
  const parts: [string, string][] = [['s-met', `${met} of ${scored} met`]];
  if (conditional > 0) parts.push(['s-needs_dgs_review', `${conditional} conditionally met`]);
  if (inProgress > 0) parts.push(['s-in_progress', `${inProgress} in progress`]);
  if (overdue > 0) parts.push(['s-unmet', `${overdue} overdue`]);
  if (notStarted > 0) parts.push(['s-notstarted', `${notStarted} not started`]);
  if (cannot > 0) parts.push(['s-cannot_evaluate', `${cannot} cannot be evaluated`]);
  // "0 of 17 met" is a true but useless thing to tell someone who has entered
  // nothing (2026-09-08): every row is open because the page is empty, not
  // because anything is wrong. The old `scored === 0` branch could never fire —
  // an empty Ph.D. record still scores 17 rows. Neither of the two plain-text
  // states carries key dots: a lone "17 not yet" / "17 met" said nothing the
  // sentence does not.
  const headline =
    untouched
      ? el('div', { class: 'headline' }, 'Getting started — add your coursework to see where you stand')
      : scored > 0 && remaining === 0
        ? el('div', { class: 'headline' }, 'All automatically checkable items are currently satisfied')
        : el(
            'div',
            { class: 'headline' },
            ...parts.flatMap(([cls, label], i) => [
              i > 0 ? ' · ' : null,
              el('span', { class: `key-item ${cls}` }, el('i', { class: 'key-dot' }), label),
            ]),
          );
  // The subline under the headline survives only where it carries an
  // instruction — "send the processing request before you file". The
  // self-check reminder it used to give in every other state is on the
  // notice line above the report, in the footer and in the print header
  // (trim review 2026-09-18, P-10).
  const subline =
    remaining === 0 && scored > 0
      ? el(
          'div',
          { class: 'subline' },
          'All automatic checks pass — the DGS still confirms eligibility, and the Grad Admin processes it: send the processing request before you file.',
        )
      : null;
  // The coursework sentence under the headline on every record with courses
  // (DGS 2026-09-27; P-10's all-met sentence stays above it).
  const coursework = currentNext?.sentence && !untouched ? el('div', { class: 'subline coursework-line' }, currentNext.sentence) : null;
  return el('div', { class: 'scorehead' }, svg, el('div', {}, headline, subline, coursework));
}

function meters(report: AuditReport): HTMLElement {
  // Pull the "X of N" numbers back out of the threshold rows' details.
  const wanted =
    report.program === 'mscse'
      ? [
          ['ms.credits.regular', 'Regular courses'],
          ['ms.credits.project', 'Project or thesis'],
          ['ms.credits.total', 'Total credits'],
        ]
      : [
          ['phd.credits.regular', 'Regular courses'],
          ['phd.credits.nd', 'Credits at ND'],
          ['phd.credits.total', 'Total credits'],
        ];
  const box = el('div', { class: 'meters' });
  for (const [id, label] of wanted) {
    const row = report.requirements.find((r) => r.id === id);
    // From the row's own numbers, not re-parsed out of its prose: B3 reworded
    // the sentence once a minimum is passed, and the old /^(\d+) of (\d+)/
    // would have quietly dropped the bar for exactly the students who had
    // earned it.
    if (!row?.progress) continue;
    const { have, need } = row.progress;
    const bar = el('div', { class: 'bar' });
    const fill = el('i', {});
    fill.style.width = `${Math.min(100, (have / need) * 100)}%`;
    if (have >= need) fill.classList.add('done');
    bar.append(fill);
    // Past the target the bar is full and the label says so ("12 (9 needed) ✓")
    // instead of the odd-looking "12/9" (item 17).
    box.append(
      el(
        'div',
        { class: 'meter' },
        el('div', { class: 'meter-label' }, `${label} `, el('span', {}, have >= need ? `${have} (${need} needed) ✓` : `${have} of ${need}`)),
        bar,
      ),
    );
  }
  return box;
}

/** An allowance's standing as a small meter in the pill's place (DGS
 * 2026-09-27): "3 of 9 used". */
function allowanceMeter(r: RequirementResult): HTMLElement {
  const p = r.progress;
  if (!p) return el('span', { class: 'allowance-meter' }, r.statusLabel ?? '');
  const fill = el('i', {});
  fill.style.width = `${Math.min(100, p.need > 0 ? (p.have / p.need) * 100 : 0)}%`;
  const have = Math.round(p.have * 100) / 100;
  return el('span', { class: 'allowance-meter', 'aria-label': `${have} of ${p.need} ${p.unit} used` }, el('span', { class: 'bar', 'aria-hidden': 'true' }, fill), `${have} of ${p.need} used`);
}

function requirementCard(r: RequirementResult): HTMLElement {
  // A row may override the WORDING without changing its status or its place in
  // the counts (W-CS2): the §4.7 defense past §4.3's limit reads "Eligibility
  // at risk", since "Conditionally met" would promise a degree that may be
  // forfeit.
  // An allowance is a meter, not a verdict (DGS 2026-09-27).
  const pill = r.allowance ? allowanceMeter(r) : el('span', { class: `pill s-${r.status}${r.statusLabel ? ' s-alarm' : ''}${pillState(r)}` }, pillLabel(r));
  // WHAT IS SATISFIED BY WHAT, and nothing else, on the card (DGS 2026-10-03:
  // "In those cards, only need to show what are satisfied by what. Other
  // supplementary explanation all need to be hidden with selectors. Apply
  // this to future changes too."). Visible: the title, the status, the
  // deadline, the row's facts without their citations, and the courses
  // counted. Behind "Relevant Policies" (was "Details" until 2026-10-04): the engine's notes (rule, reason, next step,
  // Graduate School forms), the course-list link and the rule quote with its
  // source. The § chip that used to sit after the title lives there too.
  // A heading under its group's h3, so a screen reader can jump card to card
  // (UI review, 2026-10-08); it looks as the span did.
  const head = el('div', { class: 'req-head' }, el('h4', { class: 'req-title' }, r.title), pill);
  const chips = el('div', { class: 'req-chips' });
  if (r.deadline && r.status !== 'met') {
    // Deadlines in readable body-size type, coloured by state (usability
    // review 2026-09-05, item 15; trim review 2026-09-18, P-50).
    chips.append(el('span', { class: `chip deadline d-${r.deadline.state}` }, r.deadline.label));
  }
  // Short §4.4.2 group names on the page, full ones in `detailParts` for the
  // copied messages (DGS 2026-09-08). A row with no parts is one fact.
  const parts: DetailPart[] = r.shortDetailParts ?? r.detailParts ?? (r.detail ? [r.detail] : []);
  const isNote = (p: DetailPart): p is { note: string } => typeof p === 'object' && 'note' in p;
  // A fact that only repeats the pill — "Not started." under "Not started",
  // an allowance's "0 of the 6 … used." beside its "0 of 6 used" meter — is
  // not shown (DGS 2026-10-07: "see any texts can be shortened without losing
  // its meaning"). The copied emails keep the engine's words; they have no
  // pill beside them, and the advisor email already drops the meter sentence.
  const pillWord = r.allowance ? undefined : statusWord(r).toLowerCase();
  const repeatsPill = (p: DetailPart): boolean =>
    typeof p === 'string' &&
    ((pillWord !== undefined && p.trim().replace(/\.$/, '').toLowerCase() === pillWord) || (r.allowance === true && /^\d+(?:\.\d+)? of the \d+ [^.]*used\.?$/.test(p.trim())));
  const facts = parts.filter((p) => !isNote(p) && !repeatsPill(p));
  const notes = parts.filter(isNote).map((p) => p.note);
  const sentence = (t: string): string => (/[.!?]$/.test(t) ? t : `${t}.`);
  const fact = (t: string): string => sentence(withoutCitations(t));
  // A condition with its mark in the bullet's place (DGS 2026-10-06: "it's
  // hard to see what are met and what are not met") — ✓ met, ◐ in progress,
  // ● waiting for the DGS, ✕ not yet, as in the course table.
  const checkItem = (text: string, mark: ConditionMark): HTMLElement => el('li', { class: `check check-${mark}` }, conditionMark(mark), fact(text));
  // Several statements, or a structured one, read as bullets (DGS request
  // 2026-09-04); one or two short ones stay prose.
  const structured = facts.some((p) => typeof p !== 'string');
  const factText = facts.filter((p): p is string => typeof p === 'string').map(fact);
  const detailNode =
    facts.length === 0
      ? null
      : structured || (facts.length > 1 && factText.join(' ').length > 120)
        ? el(
            'ul',
            { class: 'req-detail detail-list' },
            ...facts.map((p) =>
              typeof p === 'string'
                ? el('li', {}, fact(p))
                : 'warn' in p
                  // Something the student is LOSING gets its own treatment (R2, 2026-09-18).
                  ? el('li', { class: 'detail-warn' }, fact(p.warn))
                  : 'note' in p
                    ? null
                    : 'check' in p
                      ? checkItem(p.check, p.mark)
                      : p.fold
                      ? // The items behind a selector (DGS 2026-10-04: the
                        // specialization card's course list); the data-key
                        // keeps it open across re-renders.
                        el(
                          'li',
                          {},
                          fact(p.lead),
                          el(
                            'details',
                            { class: 'detail-fold', 'data-key': `fold.${r.id}` },
                            el('summary', {}, p.fold),
                            el('ul', { class: 'detail-sublist' }, ...p.items.map((i) => el('li', {}, fact(i)))),
                          ),
                        )
                      : el(
                          'li',
                          {},
                          `${withoutCitations(p.lead)}:`,
                          el(
                            'ul',
                            { class: `detail-sublist${p.marks ? ' checklist' : ''}` },
                            ...p.items.map((i, k) => (p.marks?.[k] ? checkItem(i, p.marks[k]!) : el('li', {}, fact(i)))),
                          ),
                        ),
            ),
          )
        : el('div', { class: 'req-detail' }, factText.join(' '));
  // Which courses and credits a credit row is built from (DGS 2026-09-22),
  // folded so the card stays short: "Courses counted (4 · 12 credits)".
  // The data-key keeps a fold the student opened open across re-renders.
  const contrib = r.contributions ?? [];
  const contribNode =
    contrib.length > 0
      ? el(
          'details',
          { class: 'contrib', 'data-key': `contrib.${r.id}` },
          el('summary', {}, contribSummary(contrib)),
          el(
            'ul',
            { class: 'contrib-list' },
            ...contrib.map((c) =>
              el('li', { class: c.pending ? 'pending' : '' }, el('span', { class: 'cid' }, c.courseId), ` · ${formatCredits(c.credits)} ${c.credits === 1 ? 'credit' : 'credits'}`, c.pending ? ' — will count once passed or approved' : ''),
            ),
          ),
        )
      : null;
  // Everything else, one selector per card. The rule quote names its document
  // in full (DGS 2026-10-03: CSE handbook, Academic Code or DGS Handbook) and
  // keeps the handbook's own words: the MSCSE tab's DGS → ADGS rewrite skips
  // `.rule-quote` (first-mention.ts applyDeciderRule; P4-text-6, DGS
  // 2026-10-12), so keep the class on the quote.
  const courseLink = courseListLink(r);
  const more = el(
    'details',
    { class: 'req-more', 'data-key': `more.${r.id}` },
    // "Relevant Policies" since 2026-10-04 (DGS: change the wording "Details").
    el('summary', {}, 'Relevant Policies'),
    notes.length > 0 ? el('ul', { class: 'req-notes' }, ...notes.map((n) => el('li', {}, sentence(n)))) : null,
    courseLink ?? null,
    // A row that states its rule in a note carries no quote (phd.ts, the
    // qualifier passed under the earlier rules — DGS 2026-10-03): no empty
    // quotation marks.
    r.citation.quote !== '' ? el('p', { class: 'rule-quote' }, el('span', { class: 'rule-source' }, sourceName(r.citation.section)), `: “${r.citation.quote}”`) : null,
    // "Does this look wrong?" (DGS 2026-10-11, item 18): a mailto to the DGS
    // with the requirement, what the card shows and what it was checked with.
    problemLine(r),
  );
  return el(
    'div',
    // The pill's display state on the card too (req-overdue, req-duesoon,
    // req-notstarted), so the stripe's colour needs no :has() — which
    // Firefox before 121 (ESR 115) lacks (cross-browser review, 2026-10-10).
    { class: `req s-${r.status}${r.allowance ? '' : pillState(r).replace(/ s-/g, ' req-')}`, id: reqAnchorId(r.id) },
    head,
    chips.childElementCount > 0 ? chips : null,
    detailNode,
    contribNode,
    more,
  );
}

/** The card's "Does this look wrong? Tell the DGS" line — "Tell the ADGS" on
 * the MSCSE tab, by the page's own rewrite, and addressed to the ADGS there
 * (app.ts passes deciderContact). */
function problemLine(r: RequirementResult): HTMLElement | null {
  const href = problemHrefOf?.(r, r.allowance ? (r.statusLabel ?? statusWord(r)) : statusWord(r));
  if (!href) return null;
  return el('p', { class: 'req-problem' }, 'Does this look wrong? ', el('a', { href, 'data-key': `problem.${r.id}` }, 'Tell the DGS'), ' — the email names this requirement and what the page shows, nothing else from your record.');
}

/** "Courses counted (4 · 12 credits)", plus the pending ones when there are
 * any, named by kind — "2 in progress", "1 waiting for the DGS" (UI review
 * item 6; DGS 2026-10-08: option (b); "pending" meant in-progress courses
 * here and DGS-waiting ones in the score head). */
function contribSummary(contrib: readonly Contribution[]): string {
  const counted = contrib.filter((c) => !c.pending);
  const inProgress = contrib.filter((c) => c.pending && c.kind !== 'waiting' && c.kind !== 'plan');
  const waiting = contrib.filter((c) => c.pending && c.kind === 'waiting');
  // A dual-degree shared course waits for the Graduate School, not the DGS
  // (policy review round 4, P4-ac-5; DGS 2026-10-11).
  const plan = contrib.filter((c) => c.pending && c.kind === 'plan');
  const credits = (list: readonly Contribution[]) => formatCredits(list.reduce((n, c) => n + c.credits, 0));
  const parts = [counted.length > 0 ? `Courses counted (${counted.length} · ${credits(counted)} credits)` : 'Courses counted (none yet)'];
  if (inProgress.length > 0) parts.push(`${inProgress.length} in progress (${credits(inProgress)} credits)`);
  if (waiting.length > 0) parts.push(`${waiting.length} waiting for the DGS (${credits(waiting)} credits)`);
  if (plan.length > 0) parts.push(`${plan.length} waiting for the Graduate School (${credits(plan)} credits)`);
  return parts.join(' · ');
}

/** courses.html understands filter query parameters (2026-09-05, item 29),
 * so an unmet row can point at exactly the courses that would satisfy it. */
function courseListLink(r: RequirementResult): HTMLElement | undefined {
  let href: string | undefined;
  let label = 'See the courses that count →';
  const core = /^phd\.qualifier\.core\.(.+)$/.exec(r.id);
  if (core) {
    href = `./courses.html?core=${encodeURIComponent(core[1]!)}&view=qualifier`;
    label = 'See the courses for this area →';
  } else if (r.id === 'phd.qualifier.categories') {
    href = './courses.html?view=qualifier';
    label = 'See the specialization categories →';
  } else if (r.id === 'ms.credits.regular') {
    href = './courses.html?program=mscse&type=regular&view=mscse';
  } else if (r.id === 'phd.credits.regular') {
    href = './courses.html?program=phd&type=regular&view=phd';
  }
  if (!href) return undefined;
  // Embedded, the link goes to the ND page that frames the course rules, in
  // the top window (DGS 2026-09-30) — the filter is lost, since the ND page
  // cannot pass a query string into its frame, but the student stays on the
  // ND site rather than landing on the bare app page.
  if (isEmbedded()) return el('a', { class: 'course-link', ...siblingAnchorAttrs('course-rules', window.location.search, true) }, label);
  return el('a', { class: 'course-link', href }, label);
}

/** The score dial, headline and credit meters on their own — shown a second
 * time at the TOP of the page on phones and small tablets, where the full
 * report sits below every input card (usability review 2026-09-05, item 2).
 * The links jump between the two halves of the page. */
export function renderSummary(report: AuditReport, next?: NextInfo): HTMLElement {
  currentNext = next;
  // The first step travels with the summary on a phone (2026-09-27).
  const first = next?.steps[0];
  return el(
    'section',
    { class: 'summary-mobile', 'aria-label': 'Your result so far' },
    dial(report),
    meters(report),
    first ? el('p', { class: 'next-first' }, el('strong', {}, 'Next: '), first.href ? el('a', { href: first.href }, first.text) : first.text) : null,
    el('a', { class: 'jump-link', href: '#report' }, 'See the full report ↓'),
  );
}

/** One-line score for the sticky bar on narrow screens. */
export function scoreLine(report: AuditReport): string {
  const { met, conditional, scored } = report.summary;
  if (scored === 0) return 'No requirements scored yet';
  // The sticky bar used to read "7 of 17 met" and hide the distinction
  // entirely (R2, 2026-09-18).
  return `${met} of ${scored} met${conditional > 0 ? ` · ${conditional} conditionally met` : ''}`;
}

export function renderReport(report: AuditReport, untouched = false, next?: NextInfo, opts: { problemHref?: (r: RequirementResult, pill: string) => string | undefined } = {}): HTMLElement {
  currentNext = next;
  problemHrefOf = opts.problemHref;
  // "Your report", matching the column's own label in app.ts and the page's
  // second-person voice — not "Audit report", the one place a screen reader
  // was told this is the audit the page says three times it is not (trim
  // review 2026-09-18, P-61).
  const panel = el('section', { class: 'audit', 'aria-label': 'Your report' });
  // On a first visit every row is "Not yet" simply because nothing has been
  // entered — thirteen red rows about a student who has typed nothing read as
  // failure (2026-09-08). The list is still there, folded, and named for what
  // it is: the requirements, not a to-do list.
  const attention = attentionList(report, untouched);
  const attentionBlock =
    attention === null
      ? []
      : untouched
        ? [
            el(
              'details',
              { class: 'attention-fold', 'data-key': 'report.attention' },
              el('summary', {}, `What this degree requires — ${scoredRows(report).length} checks${allowanceCount(report) > 0 ? `, plus ${allowanceCount(report)} allowance${allowanceCount(report) === 1 ? '' : 's'}` : ''}`),
              attention,
            ),
          ]
        : [attention];
  // §3.5 / §3.6 tracks this audit does not model (2026-09-10, promised
  // 2026-08-31). Above the dial, because the number under the dial means
  // something different once you know a required bridge year counts toward
  // almost nothing. Deliberately NOT a warning: nothing is wrong, and the
  // note changes no verdict — it names what the page cannot decide.
  // …folded since 2026-09-27 (DGS: "3 is fine"): the score comes first, and
  // the note opens on demand under the meters, its summary saying what it is
  // about. A closed <details> keeps the text, the role and the data-keep-dgs.
  const trackNotes = report.tracks.map((t) =>
    el(
      'details',
      { class: 'track-note', role: 'note', 'data-keep-dgs': '', 'data-key': `report.track.${t.section}` },
      el('summary', {}, el('strong', {}, t.title), ' — how your courses are counted here'),
      el('p', {}, t.text),
      // The section moved from the summary into the note (DGS 2026-10-03:
      // citations behind a selector in the report column).
      el('p', { class: 'rule-source' }, `Source: ${sourceName(t.section)}`),
    ),
  );
  // The warnings — a course dated after this semester, an award term not
  // before the entry term — were two identical 30-word boxes above the score
  // (2026-09-13: "yes, but get a warning"). Since 2026-09-27 they are one
  // folded line under the meters, the count in the summary, each sentence
  // inside; the box keeps its class, role and data-keep-dgs.
  // Since 2026-10-05 (DGS: "If there is a warning to the student, can you show
  // it as a floating message that follows the screen even when the page is
  // scrolled down?") the box floats in the corner of the window, open, and
  // folds to its heading; folded stays folded until the warnings change. Its
  // place in the document — and so the reading order — is unchanged.
  // Embedded, it stays in the page (a content-height frame has no window
  // corner to follow), open. Since 2026-10-08 (DGS: the two floating boxes
  // "use different buttons/selector to hide the details. Use 'Hide' button
  // for both") it is the same shape as Next steps below — a heading with a
  // Hide/Show button, not a <details> with a disclosure triangle.
  const floating = !isEmbedded();
  const warningsKey = report.warnings.join('\n');
  const warningsFolded = floating && collapsedWarnings === warningsKey;
  const warningsFold =
    report.warnings.length === 0
      ? null
      : el(
          'section',
          { class: `warnings${floating ? ' floating' : ''}${warningsFolded ? ' folded' : ''}`, role: 'note', 'aria-labelledby': 'warnings-title', 'data-keep-dgs': '', 'data-key': 'report.warnings' },
          el(
            'h3',
            { id: 'warnings-title' },
            `⚠ ${report.warnings.length === 1 ? 'One thing' : `${report.warnings.length} things`} to check` +
              (report.warnings.every((w) => /is dated .* which is after /.test(w)) ? ' — a course dated after this semester' : ''),
            ...(floating
              ? [
                  el(
                    'button',
                    {
                      class: 'btn tiny warnings-toggle',
                      type: 'button',
                      'data-key': 'report.warnings.toggle',
                      'aria-expanded': warningsFolded ? 'false' : 'true',
                      'aria-controls': 'warnings-body',
                      onclick: (e: Event) => {
                        const box = (e.currentTarget as HTMLElement).closest('.warnings')!;
                        const folded = !box.classList.contains('folded');
                        collapsedWarnings = folded ? warningsKey : undefined;
                        box.classList.toggle('folded', folded);
                        const t = box.querySelector('.warnings-toggle');
                        t?.setAttribute('aria-expanded', folded ? 'false' : 'true');
                        if (t) t.textContent = folded ? 'Show' : 'Hide';
                      },
                    },
                    warningsFolded ? 'Show' : 'Hide',
                  ),
                ]
              : []),
          ),
          el('div', { id: 'warnings-body', class: 'warnings-body' }, ...report.warnings.map((w) => el('div', { class: 'warning-line' }, `⚠ ${w}`))),
        );

  panel.append(
    el('a', { class: 'jump-link back-link', href: '#main' }, '↑ Back to your inputs'),
    dial(report, untouched),
    meters(report),
    ...(warningsFold ? [warningsFold] : []),
    ...trackNotes,
    ...attentionBlock,
    // The glossary defines words used a screen later, not nine thousand pixels
    // later (2026-09-08); it is a closed <details>, so it costs about 30 px.
    glossary(report.program, report.summerFullTimeCredits),
  );

  const groups = new Map<string, RequirementResult[]>();
  for (const r of report.requirements) {
    const list = groups.get(r.group) ?? [];
    list.push(r);
    groups.set(r.group, list);
  }
  for (const [group, rows] of groups) {
    const sub = rows.filter((r) => r.id.split('.').length > 2 && r.id.startsWith('phd.qualifier.'));
    // No card for a row that does not apply (DGS 2026-10-05), and no heading
    // for a group left empty by it.
    if (!rows.some((r) => !r.mergedInto && !doesNotApply(r))) continue;
    // The section reference after the dash is a citation: it lives in each
    // card's Details now (DGS 2026-10-03). The copied messages keep it.
    panel.append(el('h3', { class: 'group-head' }, group.replace(/ — (?:§|Academic Code|DGS Handbook).*$/, '')));
    for (const r of rows) {
      // Shown inside its parent's card (DGS 2026-10-04): no card of its own,
      // but its anchor lands on the parent so a link to it still arrives.
      if (r.mergedInto || doesNotApply(r)) continue;
      const card = requirementCard(r);
      for (const child of report.requirements.filter((x) => x.mergedInto === r.id)) card.prepend(el('span', { id: reqAnchorId(child.id), class: 'merged-anchor' }));
      if (sub.includes(r)) card.classList.add('req-sub');
      panel.append(card);
    }
  }
  return panel;
}

/** The requirement rows the Next steps list names, most urgent first — the
 * list's choice, kept pure so tests can pin it (policy review round 3,
 * P3-chg-phd-2: attentionList had no test). `covered` = the rows a numbered
 * step already covers (the advisor, the transfer and approvals rows), which
 * are not listed a second time. */
export function attentionRows(report: AuditReport, covered: ReadonlySet<string> = new Set()): RequirementResult[] {
  // Ranked by URGENCY, not by status (blue-team B5, 2026-09-18). Filtering on
  // status alone put "Dissertation defense passed" — years away — above the
  // research qualifier due in eighteen months, and left the qualifying
  // examination out altogether because it classifies as in_progress.
  const ORDER: Status[] = ['cannot_evaluate', 'needs_dgs_review', 'unmet'];
  /** Rows nothing can be done about yet. Most say so in their own detail — the
   * engine writes "Not yet available: …" wherever a requirement names its own
   * precondition. The dissertation defense does not, so it is named here: a
   * student cannot defend a dissertation before the §4.5 candidacy exam it
   * comes after — nor be admitted to candidacy before it (DGS 2026-10-04).
   * (The readers' approval was a row here too until it was removed on
   * 2026-10-04.) This is a PRESENTATION judgement about what belongs on a
   * to-do list, not a rule — the rows stay in the report, with their
   * verdicts unchanged. */
  const AFTER_CANDIDACY = ['phd.dissertation.defense'];
  // The final submission comes after the defense (Academic Code §6.2.12,
  // §6.1.8; §4.7, §3.4): its row reads "Not started" (status unmet) exactly
  // while the defense is undated, and is no step until then — it used to sit
  // on every Ph.D. student's list, first semester included (policy review
  // round 3, P3-chg-phd-2; DGS 2026-10-06). Once the defense is dated the row
  // is in progress and follows the ordinary rules.
  const AFTER_DEFENSE = ['phd.dissertation.submitted', 'ms.thesis.submitted'];
  // The MSCSE's last steps — the thesis defense, the project report — are no
  // step until due this or next semester, or overdue (a retake after a failed
  // defense): they have no deadline before then (UI review, 2026-10-08; like
  // the dissertation defense above). The report cards are unchanged, and the
  // thesis topic keeps its own step (P3-emails-4).
  const MS_FINAL = ['ms.thesis.defense', 'ms.project.report'];
  const candidacyPassed = report.requirements.some((r) => r.id === 'phd.candidacy' && r.status === 'met');
  // Admission waits only for the OCE to be DATED: a late pass (or one the DGS
  // must confirm for coursework) still leaves the application to make — as the
  // advisor summary and the processing request say (2026-10-04).
  const oceOpen = report.requirements.some((r) => r.id === 'phd.candidacy' && (r.status === 'in_progress' || r.status === 'unmet'));
  const unreachable = (r: RequirementResult): boolean =>
    /^(?:Not yet available:|You can take the exam once)/.test(r.detail) ||
    (AFTER_CANDIDACY.includes(r.id) && !candidacyPassed) ||
    (AFTER_DEFENSE.includes(r.id) && r.status === 'unmet') ||
    (MS_FINAL.includes(r.id) && r.status !== 'met' && !(r.deadline?.state === 'due_soon' || r.deadline?.state === 'overdue')) ||
    (r.id === 'phd.candidacyAdmission' && oceOpen);
  // The OCE's own row is merged into the admission card and unscored (DGS
  // 2026-10-04), so the filter below dropped it — and while it is open the
  // admission row is held back too, so an overdue OCE, a probation and
  // funding trigger (Academic Code §6.2.8), was on nobody's list. An OCE
  // overdue or due this or next semester is listed itself, linking into the
  // merged card; admission still waits for a dated OCE (P3-chg-phd-2).
  const oceDue = (r: RequirementResult): boolean =>
    r.id === 'phd.candidacy' && r.status !== 'met' && (r.deadline?.state === 'due_soon' || r.deadline?.state === 'overdue');
  const DEADLINE_RANK: Record<string, number> = { overdue: 0, due_soon: 1, upcoming: 3, done: 4 };
  const rank = (r: RequirementResult): number => {
    const byDeadline = r.deadline ? DEADLINE_RANK[r.deadline.state] ?? 3 : undefined;
    // A missing input the student can supply today still comes first: it is the
    // one thing on the page that is entirely theirs to fix.
    if (r.status === 'cannot_evaluate') return -1;
    return byDeadline ?? 2 + ORDER.indexOf(r.status) / 10;
  };
  return report.requirements
    .filter((r) => {
      if (r.informational || (r.unscored && !oceDue(r)) || unreachable(r) || covered.has(r.id)) return false;
      // Actions, not progress (DGS 2026-09-27): a credit threshold that is
      // simply not reached yet leaves — the meters show it — unless its
      // deadline is close; a missing input, a decision waiting, a passed or
      // near deadline, and anything the page cannot evaluate stay.
      if (r.status === 'unmet' && r.progress && !(r.deadline?.state === 'due_soon' || r.deadline?.state === 'overdue')) return false;
      if (ORDER.includes(r.status)) return true;
      // …and an in_progress row whose deadline is close is exactly what the
      // student needs to see, whatever its status says (B5).
      return r.status === 'in_progress' && (r.deadline?.state === 'due_soon' || r.deadline?.state === 'overdue');
    })
    .sort((a, b) => {
      const d = rank(a) - rank(b);
      if (d !== 0) return d;
      // Same urgency: the nearer date first, then the report's own order.
      const da = a.deadline?.date ?? '';
      const db = b.deadline?.date ?? '';
      if (da && db && da !== db) return da < db ? -1 : 1;
      return ORDER.indexOf(a.status) - ORDER.indexOf(b.status);
    });
}

/** "Needs your attention": the rows a student must act on, first — not met,
 * needing a DGS decision, or missing an input — each linking to its card with
 * the card's first sentence as the next step (usability review 2026-09-05,
 * item 27). The handbook order of the cards below is kept: students look
 * things up by section.
 *
 * On an UNTOUCHED record (trim review 2026-09-18, P-2) the list is something
 * else: the fold above it is named "What this degree requires", so its body is
 * one title per requirement the summary counts — the same 17, in handbook
 * order, each still a link to its row — with no pill, no detail sentence and
 * no "Needs your attention" heading. Eleven "Not yet · 0 of 60" lines about an
 * empty page were the to-do list the 2026-09-08 fold was meant to put away,
 * and each was the first sentence of the row 300 px below, word for word. The
 * full ranked list returns the moment anything is entered. */
function attentionList(report: AuditReport, untouched = false): HTMLElement | null {
  if (untouched) {
    const counted = scoredRows(report);
    if (counted.length === 0) return null;
    return el(
      'section',
      { class: 'attention', 'aria-label': 'What this degree requires' },
      el('ul', {}, ...counted.map((r) => el('li', {}, el('a', { href: `#${reqAnchorId(r.id)}` }, r.title)))),
    );
  }
  const rows = attentionRows(report, new Set((currentNext?.steps ?? []).flatMap((s) => s.covers ?? [])));
  const steps = currentNext?.steps ?? [];
  if (rows.length === 0 && steps.length === 0) {
    // Nothing to do: say so, with the nearest deadline (DGS 2026-09-27).
    if (!currentNext?.sentence) return null;
    return el(
      'section',
      { class: 'attention attention-clear', 'aria-labelledby': 'attention-title' },
      el('h3', { id: 'attention-title' }, 'Next steps'),
      el('p', { class: 'attention-empty' }, `Nothing to do right now${currentNext.nearest ? ` — your next deadline is ${currentNext.nearest}` : ''}.`),
    );
  }
  // Cut at a sentence when there is one inside 110 characters; otherwise at a
  // word, with an ellipsis (2026-09-08 — the qualifier row's only full stops
  // are inside "§4.4.1", so it used to break mid-word with no sign of it).
  const firstSentence = (text: string): string => {
    const m = /^(.{1,110}?[.!?])(\s|$)/.exec(text);
    if (m) return m[1]!.trim();
    if (text.length <= 110) return text.trim();
    const cut = text.slice(0, 110);
    const space = cut.lastIndexOf(' ');
    return `${(space > 40 ? cut.slice(0, space) : cut).trim()}…`;
  };
  // Floating like the warnings box (DGS 2026-10-08: "Let the Next Steps
  // float around the screen just like warnings"): fixed in the window's
  // corner, above the warnings, open, foldable to its heading by its button —
  // folded stays folded for the session; phones start folded. Its place in the
  // document, and so the reading order, is unchanged. Embedded, it stays in
  // the page, like the warnings.
  const floating = !isEmbedded();
  const folded = floating && (nextStepsFolded ?? (typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 900px)').matches));
  const box = el(
    'section',
    { class: `attention${floating ? ' floating' : ''}${folded ? ' folded' : ''}`, 'aria-labelledby': 'attention-title', 'data-key': 'report.nextsteps' },
    // "Next steps" (DGS 2026-09-27): the record-level steps first, numbered,
    // then the rows that need something from the student.
    el(
      'h3',
      { id: 'attention-title' },
      `Next steps (${steps.length + rows.length})`,
      ...(floating
        ? [
            el(
              'button',
              {
                class: 'btn tiny attention-toggle',
                type: 'button',
                'data-key': 'report.nextsteps.toggle',
                'aria-expanded': folded ? 'false' : 'true',
                'aria-controls': 'attention-body',
                onclick: () => {
                  nextStepsFolded = !box.classList.contains('folded');
                  box.classList.toggle('folded', nextStepsFolded);
                  const t = box.querySelector('.attention-toggle');
                  t?.setAttribute('aria-expanded', nextStepsFolded ? 'false' : 'true');
                  if (t) t.textContent = nextStepsFolded ? 'Show' : 'Hide';
                },
              },
              folded ? 'Show' : 'Hide',
            ),
          ]
        : []),
    ),
    el(
      'div',
      { id: 'attention-body', class: 'attention-body' },
    steps.length > 0
      ? el('ol', { class: 'next-steps' }, ...steps.map((s) => el('li', {}, s.href ? el('a', { href: s.href }, s.text) : s.text)))
      : null,
    el(
      'ul',
      {},
      ...rows.map((r) =>
        el(
          'li',
          {},
          el('a', { href: `#${reqAnchorId(r.id)}` }, r.title),
          // A space, so a narrow line can break before the pill (cross-browser
          // review, 2026-10-10: at 320 px "In progress · due next semester"
          // ran out of the box and the page scrolled sideways).
          ' ',
          el('span', { class: `pill s-${r.status} small${pillState(r)}` }, pillLabel(r)),
          r.deadline && r.deadline.state === 'overdue' ? el('span', { class: 'attention-overdue' }, ' — deadline passed') : null,
          el('span', { class: 'attention-next', 'data-keep-dgs': '' }, ` ${firstSentence(r.detail)}`),
        ),
      ),
    ),
    ),
  );
  return box;
}

/** Handbook terms the report uses before it explains them (usability review
 * 2026-09-05, item 28). Each entry cites its section; the wording follows the
 * handbook sentences quoted in the engine. */
function glossary(program: 'mscse' | 'phd', summerFullTimeCredits?: number): HTMLElement {
  const entries: [string, string, string][] = [
    // The pill words, defined once (clarity review 2026-09-26); no pill is
    // renamed. The decider's title is the tab's own (P-60).
    ['Met', 'Satisfied by what you have entered.', ''],
    ['In progress', 'Not satisfied yet; nothing is late.', ''],
    ['Conditionally met', 'Satisfied once the approval the row names is recorded.', ''],
    ['Overdue', `The handbook’s deadline has passed — talk to the ${program === 'mscse' ? 'ADGS' : 'DGS'}.`, ''],
    // The deadline alert (DGS 2026-09-28): one semester's notice, in the pill's own colour.
    ['Due this semester · Due next semester', 'The handbook’s deadline for that row falls in the current semester or the one after — plan for it now.', ''],
    ['Not started', 'A stage that begins after an earlier one, such as the dissertation after the candidacy exam.', ''],
    // "Does not apply" rows are not shown since 2026-10-05 (DGS), so only the allowance's word is left.
    ['Not used yet', 'An allowance you have not drawn on yet.', ''],
    // Which document a section is from (DGS 2026-10-03) — the masthead says
    // it too, but the embedded page has no masthead.
    ['Section references (§)', 'CSE § is the CSE Graduate Handbook. Academic Code § is the Graduate School’s Academic Code, and DGS Handbook § is the Graduate School’s handbook for directors of graduate studies.', ''],
    ['Cumulative GPA', 'The grade-point average over all your graduate coursework at Notre Dame, as the registrar computes it; continuation, candidacy and graduation require at least 3.0.', '§2.2'],
    // As the course rules page words it (review B-24, 2026-09-18): the others
    // count toward the total, and some are required in their own right
    // (policy review round 4, P4-text-5; DGS 2026-10-12).
    [
      'Regular course',
      `A lecture-style course. Only regular courses count toward the 24 regular-course credits; seminars, research, independent study and project credits count toward the degree total instead, and some are required in their own right: ${program === 'mscse' ? 'the M.S. project or thesis credits (§3.2)' : 'the first-year research seminars (§4.2)'}.`,
      program === 'mscse' ? '§3.2' : '§4.2',
    ],
    // The handbook's own nine (§2.1.2), and the rules the residency count
    // has applied since 2026-10-03 (second reconciliation pass).
    [
      'Full-time',
      // The MSCSE's summer floor too (policy review round 3, P3-text-ui-5): the
      // residency row counts it; the Ph.D. never counts a summer.
      `A semester in which you register for at least nine credit hours — withdrawn and incomplete courses count as registrations — or one you tick as full-time on research. A summer session with any registration counts when the spring before or the fall after was full-time (Academic Code §3.6)${program === 'mscse' && summerFullTimeCredits !== undefined ? `; on the MSCSE, a summer session with ${summerFullTimeCredits} or more registered credits counts on its own (DGS Handbook §10.3.2)` : ''}.`,
      '§2.1.2',
    ],
    program === 'mscse'
      ? ['Residency', 'Registration in full-time status for one semester during the academic year, or for one summer session.', '§3.3']
      : ['Residency', 'Full-time status for four consecutive semesters, not counting summer sessions, counted from the term you entered the program.', '§4.3'],
    ...(program === 'phd'
      ? ([
          ['Qualifying examination (qualifier)', 'Three components — core knowledge, category specialization and the research component — all to be completed within four semesters of starting; the DGS may extend the deadline case by case.', '§4.4'],
          ['Core knowledge', 'An Operating Systems course, an Algorithms course and a Computer Architecture course, passed at Notre Dame or at a previous institution (undergraduate or graduate; a previous-institution course counts once the DGS confirms it).', '§4.4.1'],
          ['Specialization (category specialization)', 'Three courses from three distinct specialization groups, each passed with a B or higher. A course may count for both core knowledge and specialization.', '§4.4.2'],
          ['Research qualifier', 'Within 18 months of entering the program, your research advisor determines whether you have passed the research component and files the form.', '§4.4.3'],
          ['Oral Candidacy Exam (OCE)', 'The candidacy examination of §4.5, sometimes called the dissertation proposal: a written proposal and an oral exam before your committee. It must be taken before the end of your eighth semester in the program.', '§4.5'],
          // A separate step since DGS 2026-10-04 ("OCE and doctoral candidacy are two different things").
          // Every condition the card lists (policy review round 3, P3-dh-6-9-2).
          ['Admission to doctoral candidacy', 'The Graduate School’s own step after the OCE, applied for through the Grad Admin: it needs the OCE passed, four consecutive full-time semesters, the coursework complete with a cumulative GPA of 3.0 or better, the Responsible Conduct of Research and ethics training, and a tenured or tenure-track dissertation advisor or co-advisor — all by the end of your eighth semester.', 'Academic Code §6.2.9; DGS Handbook §3.22.3'],
          // Policy review round 3, P3-cse-5-6-3: the student's own Notre Dame
          // MSCSE is not transfer credit (DGS 2026-10-03) — unless five years or
          // more separate it from the Ph.D. (DGS 2026-10-06; Academic Code §5.5).
          [
            'Transfer credit',
            'Graduate courses from another program — at another university, or a master’s in another Notre Dame department — may count within §5.2’s caps and five-year window, with the DGS’s recommendation and the Graduate School’s approval. Your own Notre Dame MSCSE coursework (including a 4+1’s) is not transfer credit: the Graduate School treats the CSE MSCSE and Ph.D. as one graduate program, so it counts as Ph.D. coursework — unless five years or more separate the MSCSE from the Ph.D., when the DGS reviews it and the Graduate School must approve it (Academic Code §5.5).',
            '§5.2',
          ],
        ] as [string, string, string][])
      : ([
          ['Project or thesis', 'Six credits of Master’s project (CSE 68902) or Master’s thesis direction (CSE 68901), in addition to the 24 regular-course credits.', '§3.2, §3.4'],
          // The MSCSE tab's decider (DGS 2026-09-11): the glossary is exempt
          // from the page's DGS → ADGS rewrite, so it says ADGS itself, as the
          // tab's requests do (policy review round 4, P4-text-6; DGS 2026-10-12).
          ['Transfer credit', 'Graduate courses from another program may count toward the course requirement within the handbook’s caps, with the ADGS’s recommendation and the Graduate School’s approval.', '§5.2'],
        ] as [string, string, string][])),
    // One sentence each and a pointer at the next entry (trim review
    // 2026-09-18, P-17): the example list was the contact card's line again
    // and still said "on this page", which R-16 had already retired there.
    ...(program === 'mscse'
      ? ([['ADGS', 'The Assistant Director of Graduate Studies — the faculty member who decides, by the handbook and the course rules, every requirement for MSCSE students. Processing is the Grad Admin’s job.', '§1']] as [string, string, string][])
      : ([['DGS', 'The Director of Graduate Studies — the faculty member who decides, by the handbook and the course rules, whether each requirement here is satisfied. Processing is the Grad Admin’s job.', '§1']] as [string, string, string][])),
    // A definition only: "Requests go by email; this page sends nothing" is on
    // the request cards and in every dialog's last step (trim review
    // 2026-09-18, P-35). On the M.S. tab the decider is the ADGS, as the entry
    // one line above says (P-60; DGS 2026-09-11) — the glossary is exempt from
    // first-mention.ts's DGS→ADGS rewrite, so it must say so itself.
    [
      'Grad Admin',
      program === 'phd'
        ? 'The Graduate Program Administrator: processes what the DGS has decided and keeps the official record — transfer credit (§5.2), the qualifier form (§4.4), exam and defense forms (§4.5–4.7), the MSCSE along the way (§4.5).'
        : 'The Graduate Program Administrator: processes what the ADGS has decided and keeps the official record — transfer credit (§5.2), and the exam and defense forms (§3.4).',
      '§5.2',
    ],
  ];
  return el(
    'details',
    { class: 'glossary', 'data-key': 'report.glossary' },
    el('summary', {}, 'Terms used here'),
    el(
      'dl',
      {},
      ...entries.flatMap(([term, text, section]) => [
        el('dt', {}, term, ...(section ? [' ', el('span', { class: 'chip-note' }, section)] : [])),
        el('dd', {}, text),
      ]),
    ),
    // The glossary's § chips are plain spans, not links; only the rows' §
    // buttons open the handbook text (trim review 2026-09-18, P-32).
    el('p', { class: 'hint' }, 'Paraphrased; each requirement’s Details gives the rule in the document’s own words.'),
  );
}

