// DOM-free text helpers shared by the copied emails (advisor-summary.ts,
// grad-admin-request.ts) and the page (app.ts): HTML escaping for the
// text/html clipboard flavour, the two program names, a plural — and, since
// 2026-09-28 (DGS: "Use the same style as in the texts for Grad Admin to
// format the text summary copied for advisor"), the ONE style both emails
// use for a requirement's standing: a coloured badge (HTML) or a [WORD] tag
// (text), and a deadline line highlighted when it is this semester, next
// semester or past.
import type { CourseEntry, Program } from '../engine/types.ts';

/** Which imported external transcripts were marked UNOFFICIAL — bachelor's,
 * master's, prior Ph.D. — read from the rows the import flagged
 * (`fromUnofficialTranscript`), so removing a transcript's rows removes every
 * warning about it: "master’s", "bachelor’s and master’s"; undefined when no
 * row carries the flag. `one` says whether a single transcript is meant. */
export function unofficialTranscriptSlots(courses: readonly CourseEntry[]): { list: string; one: boolean } | undefined {
  const order: Array<'bachelors' | 'masters' | 'phd'> = ['bachelors', 'masters', 'phd'];
  const label = { bachelors: 'bachelor’s', masters: 'master’s', phd: 'prior Ph.D.' } as const;
  const slots = order.filter((level) => courses.some((c) => c.fromUnofficialTranscript === true && c.origin === 'transfer' && (c.degreeLevel ?? 'masters') === level));
  if (slots.length === 0) return undefined;
  const names = slots.map((s) => label[s]);
  return { list: names.length === 1 ? names[0]! : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`, one: slots.length === 1 };
}

/** The note the three generated emails carry when any imported external
 * transcript was marked UNOFFICIAL (DGS 2026-10-03, P1-transfer-eligibility-16),
 * worded for its reader (DGS 2026-10-16: "an unofficial transcript will not be
 * accepted for official processing. It will be accepted for informal review
 * only (by ADGS or DGS)"): the review request asks the DGS/ADGS for an
 * informal review; the Grad Admin request says the transfer credit waits for
 * the official transcript; the advisor summary says both. `decider` is the
 * DGS or the ADGS, by program. Empty when no row carries the flag. */
export function unofficialTranscriptNote(courses: readonly CourseEntry[], audience: 'review' | 'gradAdmin' | 'advisor', decider: 'DGS' | 'ADGS' = 'DGS'): string {
  const slots = unofficialTranscriptSlots(courses);
  if (slots === undefined) return '';
  const { list, one } = slots;
  const copy = one ? 'is an unofficial copy' : 'are unofficial copies';
  const what = `Note: the ${list} transcript${one ? '' : 's'} I imported into the self-check ${copy}`;
  const registrar = one ? 'the university’s registrar' : 'each university’s registrar';
  if (audience === 'review') return `${what}, for your informal review — I understand ${one ? 'it' : 'they'} will not be accepted for official processing; ${registrar} will send the official transcript directly to the Graduate School.`;
  if (audience === 'gradAdmin') return `${what} — not for official processing; the transfer credit from ${one ? 'it' : 'them'} can be processed only once ${registrar} has sent the official transcript directly to the Graduate School (§5.2).`;
  return `${what} — accepted for the ${decider}’s informal review only, not for official processing, until ${registrar} sends the official transcript directly to the Graduate School (§5.2).`;
}

/** Escape a string for the HTML flavour of a copied message. */
export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** "M.S. in CSE" / "Ph.D." — the subject lines. */
export function programShort(program: Program): string {
  return program === 'mscse' ? 'M.S. in CSE' : 'Ph.D.';
}

/** "M.S. in CSE (Handbook §3)" / "Ph.D. (Handbook §4)" — the standing paragraph. */
export function programLabel(program: Program): string {
  return program === 'mscse' ? 'M.S. in CSE (Handbook §3)' : 'Ph.D. (Handbook §4)';
}

/** "1 course" / "3 courses" — a count and its noun, pluralised with -s. */
export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** The line every copied email opens with, for the student to complete in
 * their mail client (DGS 2026-09-28: "let students add name, netID, and
 * NDID"). The app stores none of these — FERPA — so the placeholder is the
 * whole of what the page knows. */
export const STUDENT_LINE = 'Student: [your name, netID and NDID]';
/** The same line in the HTML flavour: the placeholder emphasised so it is
 * seen before the message is sent. */
export function studentLineHtml(): string {
  return `<p>Student: <strong>[your name, netID and NDID]</strong></p>`;
}
/** The copy dialog's first step, shared by the three emails. */
export const FILL_IN_STEP = 'Fill in your name, netID and NDID on the "Student:" line.';
/** The heading of the numbered list of what THIS reader must do — the same
 * skeleton in all three emails (DGS 2026-09-28). */
export const ACTION_HEADING = 'Action requested';

/** The markers every copied request carries (DGS wording 2026-09-03 / 2026-09-06):
 * students reword only their own half; the tables below stay machine-readable.
 * Shared by the DGS review request (review-request.ts) and the Grad Admin's
 * processing request (grad-admin-request.ts). Here, not beside the review
 * builder, since W3 (2026-10-22): when they sat in src/transcript/external.ts
 * the Grad Admin request's static import of them dragged the whole
 * transcript parser into every first load. */
export const EDITABLE_MARKER = '(You may edit anything above this line)';
export const DO_NOT_MODIFY_MARKER = '(DO NOT MODIFY ANYTHING BELOW THIS LINE)';
export const MARKER_DIVIDER = '-'.repeat(64);

/** The page's pill colours, named (DGS 2026-09-28: "green, amber, and gray";
 * red for a passed deadline and blue for a conditional row are the page's
 * own). `standingColor` in report.ts picks one per row. */
export type StandingColor = 'green' | 'amber' | 'grey' | 'red' | 'blue';

/** Inline styles — mail clients keep no stylesheet. The values are the
 * page's pills (style.css). */
export const BADGE_STYLE: Record<StandingColor, string> = {
  green: 'background:#e4f2ea;color:#10693f',
  amber: 'background:#fbeedd;color:#8e5108',
  grey: 'background:#eef0f3;color:#5a6472',
  red: 'background:#fbe9e7;color:#a81e14',
  blue: 'background:#e7eef9;color:#1f4e8c',
};

/** The status word as a pill: "Met", "In progress", "Not started" … */
export function htmlBadge(word: string, color: StandingColor): string {
  return `<span style="display:inline-block;padding:1px 8px;border-radius:99px;font-weight:bold;font-size:12px;${BADGE_STYLE[color]}">${esc(word)}</span>`;
}

/** How near a deadline is: this semester, next semester, already past, or
 * (undefined) further off. */
export type DeadlineAlert = 'this' | 'next' | 'passed' | undefined;

/** The deadline line in HTML: an orange box for this or next semester, a red
 * one for a passed deadline, plain text otherwise. `block` (default) is a
 * paragraph of its own; a table cell gets an inline box. */
export function htmlDeadline(text: string, alert: DeadlineAlert, block = true): string {
  const style =
    alert === 'passed'
      ? 'background:#fbe9e7;color:#7a1f1f;border-left:4px solid #a81e14'
      : alert
        ? 'background:#ffe3c9;color:#8a3a00;border-left:4px solid #e0863a'
        : '';
  const lead = alert === 'passed' ? 'Deadline passed:' : alert ? `Deadline ${alert} semester:` : 'Deadline:';
  const inner = `<strong>${lead}</strong> ${esc(text)}`;
  if (!style) return block ? `<p style="margin:2px 0 6px">${inner}</p>` : esc(text);
  return block ? `<p style="margin:2px 0 6px;padding:4px 8px;${style}">${inner}</p>` : `<span style="display:inline-block;padding:2px 6px;${style}">${inner}</span>`;
}

/** The colour of a block's left rule — the badge's own text colour, as the
 * page's cards carry their status colour on the left edge (style.css .req). */
const RULE_COLOR: Record<StandingColor, string> = { green: '#10693f', amber: '#8e5108', grey: '#5a6472', red: '#a81e14', blue: '#1f4e8c' };

/** One requirement as a BLOCK (DGS 2026-09-28, evening: "it's hard to see
 * which text is for which requirement" once the tables were gone): the
 * badge and the title on the first line, its explanation lines and its
 * deadline box INSIDE the same bordered card, a gap before the next. Inline
 * styles only — mail clients keep no stylesheet; Gmail (Notre Dame's mail)
 * keeps a div's border, padding and background. */
export function htmlRequirementBlock(opts: { word: string; color: StandingColor; title: string; section: string; lines?: string[]; deadline?: { text: string; alert: DeadlineAlert } }): string {
  const lines = (opts.lines ?? []).filter((l) => l !== '');
  return (
    `<div style="margin:0 0 10px;padding:6px 10px;border-left:4px solid ${RULE_COLOR[opts.color]};background:#f7f8fa">` +
    `<p style="margin:0">${htmlBadge(opts.word, opts.color)} <strong>${esc(opts.title)}</strong>${opts.section ? ` (${esc(opts.section)})` : ''}</p>` +
    // The deadline right under the title (it is the alert), the explanation after it — the plain text's order.
    (opts.deadline ? htmlDeadline(opts.deadline.text, opts.deadline.alert).replace(/^<p style="margin:2px 0 6px/, '<p style="margin:6px 0 0') : '') +
    (lines.length > 0 ? `<p style="margin:4px 0 0">${lines.map(esc).join('<br>')}</p>` : '') +
    '</div>'
  );
}

/** The same block in plain text: the [WORD] tag and the title on one line,
 * every line that belongs to it indented beneath — the indentation is what
 * says "this is about that". `indent` is the title line's own indentation
 * (the advisor summary nests rows under section headings); the body sits
 * four spaces further in. */
export function textRequirementBlock(opts: { word: string; title: string; section: string; lines?: string[]; deadline?: { text: string; alert: DeadlineAlert } }, indent = ''): string {
  const body = indent + '    ';
  const lines = (opts.lines ?? []).filter((l) => l !== '');
  return (
    `${indent}[${opts.word.toUpperCase()}] ${opts.title}${opts.section ? ` (${opts.section})` : ''}` +
    (opts.deadline ? `\n${body}${textDeadline(opts.deadline.text, opts.deadline.alert)}` : '') +
    lines.map((l) => `\n${body}${l}`).join('')
  );
}

/** The deadline line in plain text: "!! DEADLINE NEXT SEMESTER: …",
 * "!! DEADLINE PASSED: …", or "Deadline: …" when it is further off. */
export function textDeadline(text: string, alert: DeadlineAlert): string {
  return alert === 'passed' ? `!! DEADLINE PASSED: ${text}` : alert ? `!! DEADLINE ${alert.toUpperCase()} SEMESTER: ${text}` : `Deadline: ${text}`;
}

/** A plain-text heading in capitals, its document names left as written
 * (policy review round 3, P3-emails-3 / P3-emails-8): "ACADEMIC CODE §6.2.9"
 * slipped past the label check and the copy read "ACADEMIC CODE CSE §6.2.9". */
export function upperHeading(heading: string): string {
  return heading.toUpperCase().replace(/ACADEMIC CODE/g, 'Academic Code').replace(/DGS HANDBOOK/g, 'DGS Handbook');
}
