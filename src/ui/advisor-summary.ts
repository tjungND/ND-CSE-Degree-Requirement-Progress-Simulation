// The "Copy summary for advisor" email — pure string building over an
// AuditReport (no DOM), in two clipboard flavors: plain text, and HTML that
// pastes cleanly into Gmail/Outlook (tables, inline styles only — email
// clients drop stylesheets).
//
// Shape (DGS request 2026-09-06, replacing the attention-first design of the
// same morning): the requirements in HANDBOOK ORDER — one section per group
// (§2.2–2.3, §4.2, §4.3, §4.4, §4.5, §4.7; §3.x for the M.S.), each row
// in the page's own colour — the Grad Admin request's style, since 2026-09-28
// (DGS: "Use the same style as in the texts for Grad Admin"): a badge in HTML,
// a [WORD] tag in text (green met, amber in progress, grey not started, red
// overdue, blue conditionally met — email-html.ts), with its "why" and its
// deadline (semesters, DGS 2026-09-05) on a line of its own, highlighted when
// it falls in this semester or the next, or has passed; then three TO-DO lists derived from
// the same rows: what the student, the advisor, the DGS (eligibility) and,
// since 2026-09-06, the Grad Admin (processing) each need to do.
// Kept from the morning's design: the subject line with the headline facts,
// the one standing paragraph, the deadline footnote and the alpha notice; the
// re-voicing of the engine's student-facing details (`whyFor`).
import type { AuditReport, DetailPart, RequirementResult, Status } from '../engine/types.ts';
import { deadlineTermLabel, dueTermPhrase, termLabel } from '../engine/term.ts';
import { shortenAfterFirst } from './first-mention.ts';
import { decisionWording } from '../engine/decider.ts';
import { DUAL_PLAN_REASON, gpaText } from '../engine/requirements/shared.ts';
import { ACTION_HEADING, STUDENT_LINE, esc, htmlRequirementBlock, plural, programLabel, programShort, studentLineHtml, textRequirementBlock, type DeadlineAlert, type StandingColor, upperHeading } from './email-html.ts';
import { HANDBOOK_URL, betaNotice, formatYmdLong } from './handbook.ts';
import type { ProgramHistory } from './program-history.ts';
import { deadlineAlert, isNotStarted, scoredRows, standingColor, statusWord } from './report.ts';

export interface AdvisorSummaryOptions {
  todayIso: string;
  entryTerm: string;
  /** The "Prior graduate study" choice as the page labels it. */
  priorStudy: string;
  gpa?: number;
  /** The Notre Dame programs (DGS 2026-09-28): `compact` for the subject,
   * `earlier` for the standing paragraph. Optional for older callers. */
  history?: ProgramHistory;
  /** The advisors' names from the Milestones card (DGS 2026-09-22): the
   * salutation names them — "Dear Prof. X and Prof. Y," — and the to-do
   * heading says "my advisors" when there are two. Empty = "Dear Advisor,". */
  advisors?: string[];
  /** The unofficial-transcript warning (email-html.ts unofficialTranscriptNote;
   * DGS 2026-10-03), when any imported external transcript was unofficial. */
  unofficialNote?: string;
  /** The transfers the processing request carries (grad-admin-request.ts
   * processingItems(...).transfers — policy review round 3, P3-emails-1): the
   * same list, so a course still waiting for the DGS never reaches the Grad
   * Admin (2026-09-08). Optional for older callers. */
  transfers?: AdvisorTransfers;
  /** A Ph.D. student who transferred from the unfinished MSCSE: the term of the
   * transfer, which the qualifying exam's clocks count from (DGS 2026-10-03)
   * while every other deadline keeps the entry term (policy review round 3,
   * P3-text-ui-8, the optional footer). */
  qualifierFrom?: string;
  /** "Checked with: …" (src/ui/stamp.ts; DGS 2026-10-11, item 8): the
   * summary's last line. Optional for older callers. */
  stamp?: string;
  /** Where the courses came from, and that milestone dates and approval
   * ticks are the student's own (src/ui/provenance.ts sourcesLine; DGS
   * 2026-10-11, item 6): a line under the standing. */
  sources?: string;
}

/** P3-emails-1: what the processing request would carry for transfer credit. */
export interface AdvisorTransfers {
  courses: string[];
  /** The student ticked that the Grad Admin recorded the transfer. */
  recorded: boolean;
  /** §5.2: the request is considered only after the first semester (allocate.ts firstSemesterComplete). */
  firstSemesterDone: boolean;
}

export function advisorSummary(report: AuditReport, opts: AdvisorSummaryOptions): { text: string; html: string; subject: string } {
  const rows = report.requirements;
  // Counts as the page's headline counts them (scoredRows, report.ts).
  const scored = scoredRows(report);
  const count = (status: Status) => scored.filter((r) => r.status === status).length;
  const n = {
    met: report.summary.met,
    scored: report.summary.scored,
    unmet: count('unmet'),
    inProgress: count('in_progress'),
    waiting: count('needs_dgs_review'),
    unchecked: count('cannot_evaluate'),
    overdue: scored.filter((r) => r.status === 'unmet' && r.deadline?.state === 'overdue').length,
  };

  // One number for what is still open (DGS 2026-09-22: "Not yet" and "In
  // progress" merged into "in progress"); a passed deadline is said apart.
  const notStarted = scored.filter(isNotStarted).length;
  const open = n.unmet + n.inProgress - notStarted;
  const headlineFact =
    n.scored > 0 && n.met === n.scored
      ? 'all checked requirements met'
      : open > 0
        ? `${plural(open, 'requirement')} in progress${n.overdue > 0 ? `, ${plural(n.overdue, 'deadline')} passed` : ''}`
        : `${n.met} of ${n.scored} met${n.waiting > 0 ? `, ${n.waiting} conditionally met` : ''}`;
  const subject = `Degree self-check — ${opts.history?.compact ?? `${programShort(report.program)}, entered ${opts.entryTerm}`} — ${headlineFact}`;
  const earlier = opts.history?.earlier ?? '';
  const asOf = formatYmdLong(opts.todayIso.slice(0, 10)) ?? opts.todayIso.slice(0, 10);
  const intro = `Here is my current standing from the CSE degree self-check tool, as of ${asOf}.`;
  // Mid-sentence, lower-cased — not an acronym ("MSCSE at Notre Dame …", P3-prior-programs-6).
  const prior = /^[A-Z]{2}/.test(opts.priorStudy) ? opts.priorStudy : opts.priorStudy.charAt(0).toLowerCase() + opts.priorStudy.slice(1);
  const standing =
    `${programLabel(report.program)}; entered ${opts.entryTerm}; ${prior}; ` +
    // As the §2.2 card prints it — never rounded up past the minimum (2.996
    // stays 2.996; policy review round 3, P3-cse-1-2-1, DGS 2026-10-06).
    `cumulative GPA ${opts.gpa !== undefined ? gpaText(opts.gpa) : 'not entered yet'}.`;
  // A deadline in this semester or the next is counted in the headline too
  // (DGS 2026-09-28), as the Grad Admin request counts it.
  const dueSoon = scored.filter((r) => ['this', 'next'].includes(deadlineAlert(r) ?? '')).length;
  const counts = [
    `${n.met} of ${n.scored} requirements met`,
    ...(open > 0 ? [`${open} in progress`] : []),
    ...(n.overdue > 0 ? [`${plural(n.overdue, 'deadline')} passed`] : []),
    ...(notStarted > 0 ? [`${notStarted} not started`] : []),
    ...(n.waiting > 0 ? [`${n.waiting} conditionally met`] : []),
    ...(n.unchecked > 0 ? [`${n.unchecked} cannot be evaluated`] : []),
    ...(dueSoon > 0 ? [`${plural(dueSoon, 'deadline')} in this semester or the next`] : []),
  ].join(' · ');

  // ---- sections in handbook order ----
  // The report's groups already follow the handbook (§2 → §3/§4 in order);
  // first-seen order keeps it. Informational rows and "does not apply" rows
  // are left out; the per-course sign-off list ("Approvals") feeds the to-do
  // lists instead of standing as a section.
  // A row shown inside another's card on the page (the OCE and the RCR training
  // inside admission to candidacy, DGS 2026-10-04) is one line here too
  // (2026-10-05) — the parent's line carries its facts.
  const listed = rows.filter((r) => !r.informational && r.status !== 'not_applicable' && r.group !== 'Approvals' && !r.mergedInto);
  // Three met core-knowledge rows read as one line (DGS 2026-09-28: "collapse
  // groups of met rows"): the areas and their courses, nothing lost.
  const core = listed.filter((r) => r.id.startsWith('phd.qualifier.core.'));
  const coreCollapsed = core.length === 3 && core.every((r) => r.status === 'met');
  const collapsedCore: RequirementResult | undefined = coreCollapsed
    ? {
        ...core[0]!,
        id: 'phd.qualifier.core',
        title: 'Core knowledge: all three areas',
        detail: core.map((r) => `${r.title.replace(/^Core knowledge:\s*/, '')}: ${whyFor(r).replace(/^Satisfied by /, '').replace(/\.$/, '')}`).join('; ') + '.',
        detailParts: undefined,
        shortDetailParts: undefined,
      }
    : undefined;
  const sectioned = coreCollapsed ? listed.flatMap((r) => (r.id === core[0]!.id ? [collapsedCore!] : core.includes(r) ? [] : [r])) : listed;
  const sections: { heading: string; rows: RequirementResult[] }[] = [];
  for (const r of sectioned) {
    let s = sections.find((x) => x.heading === r.group);
    if (!s) {
      s = { heading: r.group, rows: [] };
      sections.push(s);
    }
    s.rows.push(r);
  }

  const todo = actionItems(report, opts.transfers);
  const deadlineNote = listed.some((r) => deadlineOf(r) !== undefined)
    ? // The page footer's words (policy review round 3, P3-text-ui-7): the
      // Graduate School calendar, and — after a transfer from the MSCSE — the
      // term the qualifying exam and the first-year seminars count from (DGS
      // 2026-10-03).
      `Deadlines are counted from ${opts.entryTerm}${opts.qualifierFrom ? ` — the qualifying exam’s and the first-year seminars’ from ${opts.qualifierFrom}, when I transferred into the Ph.D. —` : ''} and given by semester; they are approximate — the Graduate School calendar sets the exact dates.`
    : '';
  const statusNote = `Alpha version under testing. ${betaNotice(report.program)} Checked against the CSE Graduate Studies Handbook (${HANDBOOK_URL}), together with the Graduate School’s Academic Code, DGS Handbook and 4+1 guidance.`;

  // The tag: the page's pill word (report.ts statusWord — the engine's
  // per-row label when it set one, W-CS2 "Eligibility at risk"; else Overdue,
  // Not started, or the status word) in the page's pill colour (standingColor).
  // Since 2026-09-28 the same pair the Grad Admin request prints.
  // An allowance is a meter, not a verdict — as on the page since 2026-09-27
  // (DGS 2026-09-28: "let's use the meter"): "3 of 9 used", grey.
  const meterWord = (r: RequirementResult): string | undefined =>
    r.allowance ? (r.progress ? `${Math.round(r.progress.have * 100) / 100} of ${r.progress.need} used` : (r.statusLabel ?? 'Not used yet')) : undefined;
  const tagFor = (r: RequirementResult): { word: string; color: StandingColor } => {
    const meter = meterWord(r);
    return meter ? { word: meter, color: 'grey' } : { word: statusWord(r), color: standingColor(r) };
  };
  // Met rows carry their Why too (DGS 2026-09-22): a one-line summary of what
  // met them. The "Courses counted" lists (2026-09-22), the bullet lists and
  // the seminar semesters (2026-09-23, morning) were all taken out again the
  // same day — DGS: "Advisors don't need to know the course details. Summary
  // in the why column is enough." The categories row names the groups only.
  const whyCell = (r: RequirementResult): string => (r.allowance ? whyFor(r).replace(/^\d+(?:\.\d+)? of the \d+ [^.]*used\.\s*/, '') : whyFor(r));
  // The nearest open deadline (DGS 2026-09-28: the advisor's part first, with
  // the next deadline): the row and its semester phrase.
  const nextDue = listed
    .filter((r) => deadlineOf(r) !== undefined && deadlineOf(r)!.alert !== 'passed')
    .sort((a, b) => (a.deadline!.date < b.deadline!.date ? -1 : 1))[0];
  const nextDeadline = nextDue
    ? `Next deadline: ${nextDue.title} (${nextDue.citation.section}) — ${deadlineOf(nextDue)!.text}${deadlineOf(nextDue)!.alert ? ` (${deadlineOf(nextDue)!.alert} semester)` : ''}.`
    : '';
  // The DGS and Grad Admin lists print only when they hold something; two
  // headings announcing that two absent people have nothing to do were filler
  // for the advisor. One sentence keeps all four parties accounted for (trim
  // review 2026-09-18, P-9). The student and advisor lists always print.
  const nothingPending = (): string =>
    todo.dgs.length === 0 && todo.gradAdmin.length === 0
      ? 'Nothing is pending with the DGS or the Grad Admin.'
      : todo.dgs.length === 0
        ? 'Nothing is pending with the DGS.'
        : todo.gradAdmin.length === 0
          ? 'Nothing is pending with the Grad Admin.'
          : '';

  // The salutation names the advisors as the Milestones card has them (DGS
  // 2026-09-22: "Prof. X and Prof. Y"); with no name entered, "Dear Advisor,".
  // "Prof." before a name typed without a title (DGS 2026-09-23): a name that
  // already starts with Prof./Professor/Dr. is left as typed.
  const advisors = (opts.advisors ?? []).map((n) => n.trim()).filter(Boolean).map(withTitle);
  const twoAdvisors = advisors.length > 1;
  const salutation = advisors.length > 0 ? advisors.join(' and ') : 'Advisor';

  // ---- plain text ----
  // The row as a block (DGS 2026-09-28, evening): the [WORD] tag and the
  // title on one line, the deadline and the why indented beneath it — the
  // same block the Grad Admin request prints (email-html.ts).
  const line = (r: RequirementResult): string => {
    const tag = tagFor(r);
    const due = deadlineOf(r);
    const why = whyCell(r);
    return textRequirementBlock({ word: tag.word, title: r.title, section: r.citation.section, lines: why ? [`Why: ${why}`] : [], deadline: due }, '  ');
  };
  const todoText = (heading: string, items: string[]) =>
    `${heading}\n${items.length > 0 ? items.map((i) => `- ${i}`).join('\n') : '- Nothing at the moment.'}\n\n`;
  const pendingText = nothingPending();
  // The same skeleton as the other two emails (DGS 2026-09-28): the student
  // line, the standing, then the reader's own numbered actions — what I need
  // from my advisor — and the next deadline, BEFORE the standing list; my
  // own to-dos and the other parties' after it. Sign-off before the
  // footnotes (trim review 2026-09-18, P-73).
  const actionsTitle = `${ACTION_HEADING} — what I need from you, my advisor${twoAdvisors ? 's' : ''}`;
  const actionsHeading = actionsTitle.toUpperCase();
  const actionsText = `${actionsHeading}\n${todo.advisor.length > 0 ? todo.advisor.map((i, k) => `${k + 1}. ${i}`).join('\n') : 'Nothing at the moment.'}\n\n`;
  const text =
    `Subject: ${subject}\n\nDear ${salutation},\n\n${STUDENT_LINE}\n\n${intro}\n${standing}\n${opts.sources ? `${opts.sources}\n` : ''}${earlier ? `${earlier}\n` : ''}${opts.unofficialNote ? `${opts.unofficialNote}\n` : ''}${counts}.\n${nextDeadline ? `${nextDeadline}\n` : ''}\n` +
    actionsText +
    'MY STANDING, REQUIREMENT BY REQUIREMENT\n\n' +
    sections.map((s) => `${upperHeading(s.heading)}\n${s.rows.map(line).join('\n')}\n\n`).join('') +
    todoText('WHAT I NEED TO DO', todo.student) +
    (todo.dgs.length > 0 ? todoText('WHAT THE DGS NEEDS TO DO', todo.dgs) : '') +
    (todo.gradAdmin.length > 0 ? todoText('WHAT THE GRAD ADMIN NEEDS TO DO', todo.gradAdmin) : '') +
    (pendingText ? `${pendingText}\n\n` : '') +
    `Thank you!\n\n${deadlineNote ? `${deadlineNote}\n` : ''}${statusNote}\n${opts.stamp ? `${opts.stamp}\n` : ''}`;

  // ---- HTML ----
  // One bordered block per requirement, not a five-column table (DGS
  // 2026-09-28, twice: stacked, then "hard to see which text is for which
  // requirement"): the badge and the title on the block's first line, the
  // why and the deadline box inside it — email-html.ts, shared with the Grad
  // Admin request.
  const htmlRow = (r: RequirementResult): string => {
    const tag = tagFor(r);
    const due = deadlineOf(r);
    const why = whyCell(r);
    return htmlRequirementBlock({ word: tag.word, color: tag.color, title: r.title, section: r.citation.section, lines: why ? [why] : [], deadline: due });
  };
  const htmlSection = (s: { heading: string; rows: RequirementResult[] }): string => `<p><strong>${esc(s.heading)}</strong></p>${s.rows.map(htmlRow).join('')}`;
  const todoHtml = (heading: string, items: string[]) =>
    `<p><strong>${esc(heading)}</strong></p><ul>${(items.length > 0 ? items : ['Nothing at the moment.']).map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`;
  const actionsHtml =
    `<p><strong>${esc(actionsTitle)}</strong></p>` +
    (todo.advisor.length > 0 ? `<ol>${todo.advisor.map((i) => `<li>${esc(i)}</li>`).join('')}</ol>` : '<p>Nothing at the moment.</p>');
  const html =
    `<p>Subject: ${esc(subject)}</p><p>Dear ${esc(salutation)},</p>${studentLineHtml()}` +
    `<p>${esc(intro)}<br>${esc(standing)}${opts.sources ? `<br>${esc(opts.sources)}` : ''}${earlier ? `<br>${esc(earlier)}` : ''}${opts.unofficialNote ? `<br><strong>${esc(opts.unofficialNote)}</strong>` : ''}<br><strong>${esc(counts)}.</strong>${nextDeadline ? `<br>${esc(nextDeadline)}` : ''}</p>` +
    actionsHtml +
    `<p><strong>My standing, requirement by requirement</strong></p>` +
    sections.map(htmlSection).join('') +
    todoHtml('What I need to do', todo.student) +
    (todo.dgs.length > 0 ? todoHtml('What the DGS needs to do', todo.dgs) : '') +
    (todo.gradAdmin.length > 0 ? todoHtml('What the Grad Admin needs to do', todo.gradAdmin) : '') +
    (pendingText ? `<p>${esc(pendingText)}</p>` : '') +
    `<p>Thank you!</p>` +
    (deadlineNote ? `<p>${esc(deadlineNote)}</p>` : '') +
    `<p>${esc(statusNote)}</p>` +
    (opts.stamp ? `<p>${esc(opts.stamp)}</p>` : '');
  // "Oral Candidacy Exam (OCE)" once per flavour, then "OCE" (2026-09-06 evening).
  return { text: decisionWording(report.program, shortenAfterFirst(text)), html: decisionWording(report.program, shortenAfterFirst(html)), subject: decisionWording(report.program, subject) };
}

/** "Due by the end of Spring 2028" / "was due during Spring 2028": a
 * SEMESTER, never a date (DGS 2026-09-05); the footnote says once that
 * semesters are approximate, so the lines do not repeat it. The alert
 * (this semester, next semester, passed) is the page's (report.ts). */
function deadlineOf(r: RequirementResult): { text: string; alert: DeadlineAlert } | undefined {
  const alert = deadlineAlert(r);
  if (alert === null) return undefined;
  return { text: alert === 'passed' ? `was due ${dueTermPhrase(r.deadline!.date)}` : `Due ${dueTermPhrase(r.deadline!.date)}`, alert };
}

// ---------- the three to-do lists ----------

export interface ActionItems {
  student: string[];
  advisor: string[];
  /** Eligibility decisions only — rulings, extensions, confirmations. */
  dgs: string[];
  /** Processing — what the DGS has already decided (2026-09-06 evening). */
  gradAdmin: string[];
}

/** What each party needs to do, read off the requirement rows (DGS request
 * 2026-09-06). Each rule keys on a stable requirement id (audit.ts
 * REQUIREMENT_IDS) and the numbers in its detail; the per-course sign-off
 * list (shared.approvals) supplies the course-level items — a reason naming
 * the advisor is the advisor's, one naming the DGS (or a review) the DGS's,
 * and the student sends the review request. Dissertation items appear only
 * once candidacy is passed — they are not this semester's work before that. */
/** The MSCSE's time limit when it has passed — Overdue, or every requirement
 * complete after it (“Eligibility at risk”) — named beside the master's
 * candidacy item in the advisor email and the processing request (policy
 * review round 4, P4-mscse-2; DGS 2026-10-11: option (b)). No document bars
 * filing the application while an extension is sought, so the item stays and
 * the Grad Admin sees the one fact they need beside it. Empty otherwise. */
export function msLimitPassedClause(report: AuditReport): string {
  if (report.program !== 'mscse') return '';
  const r = report.requirements.find((x) => x.id === 'ms.timeLimit');
  if (!r?.deadline || !(r.deadline.state === 'overdue' || r.statusLabel === 'Eligibility at risk')) return '';
  return ` — the MSCSE’s time limit (§3.3) passed at ${deadlineTermLabel(r.deadline.date)} (approximate); an extension is the Graduate School’s to grant`;
}

export function actionItems(report: AuditReport, transfers?: AdvisorTransfers): ActionItems {
  const out: ActionItems = { student: [], advisor: [], dgs: [], gradAdmin: [] };
  const byId = new Map(report.requirements.map((r) => [r.id, r]));
  /** The detail as prose — the joined parts when the row carries them. */
  const textOf = (r: RequirementResult) => (r.detailParts ? r.detailParts.map((p) => flatten(p)).join('. ') : r.detail);
  const isOpen = (status: Status) => status === 'unmet' || status === 'in_progress';
  // "by the end of Spring 2030" / "before Fall 2034" / "during Spring 2028" —
  // the engine's semester phrases are complete adverbials; a passed deadline
  // is named as "the end of Spring 2030" / "Spring 2028".
  const due = (r: RequirementResult) =>
    r.deadline && r.deadline.state !== 'done'
      ? r.deadline.state === 'overdue'
        ? ` — the deadline (${deadlineTermLabel(r.deadline.date)}) has passed`
        : ` ${dueTermPhrase(r.deadline.date)}`
      : '';
  const overdue = (r: RequirementResult | undefined) => r?.deadline?.state === 'overdue' && r.status !== 'met';
  /** "14 of 60 credits complete" → 46 remaining (in-progress credits included). */
  const remaining = (r: RequirementResult): { left: number; total: number; inProgress: number } | undefined => {
    const d = textOf(r);
    const m = /^(\d+(?:\.\d+)?) of (\d+(?:\.\d+)?) (?:credits|semesters)/.exec(d) ?? /: (\d+(?:\.\d+)?) of (\d+(?:\.\d+)?) semesters/.exec(d);
    if (!m) return undefined;
    const ip = /(\d+(?:\.\d+)?) in progress/.exec(d);
    return { left: Number(m[2]) - Number(m[1]), total: Number(m[2]), inProgress: ip ? Number(ip[1]) : 0 };
  };
  const cr = (k: number) => `${k} more ${k === 1 ? 'credit' : 'credits'}`;
  const ipNote = (x: { inProgress: number }) => (x.inProgress > 0 ? ` (${x.inProgress} of them in progress)` : '');
  const section = (r: RequirementResult) => `(${r.citation.section})`;

  // Basic requirements.
  const gpa = byId.get('shared.gpa');
  if (gpa?.status === 'cannot_evaluate') out.student.push(`Report my cumulative GPA ${section(gpa)}.`);
  else if (gpa?.status === 'unmet') out.student.push(`Raise my cumulative GPA to the minimum ${section(gpa)}.`);
  const advisor = byId.get('shared.advisor');
  // CSE §2.3 asks an M.S. student to "identify a thesis or project advisor"
  // and requires a Ph.D. student's "continuous advisor supervision" — the
  // card says so per program, and the email follows it (policy review round
  // 3, P3-cse-1-2-3).
  if (advisor && isOpen(advisor.status))
    out.student.push(
      report.program === 'phd'
        ? `Identify my faculty advisor — the Ph.D. requires continuous advisor supervision ${section(advisor)}.`
        : `Identify a thesis or project advisor ${section(advisor)}.`,
    );
  else if (advisor?.status === 'needs_dgs_review') {
    // Not tenured or tenure-track CSE faculty (or not sure): the card's two
    // cases (shared.ts advisorCasesRule), so "Nothing is pending with the DGS"
    // cannot print beside the advisor row's "ask the DGS" (policy review
    // round 4, P4-phd-6; DGS 2026-10-12).
    const thesis = report.program === 'mscse' ? 'thesis ' : '';
    out.student.push(`If my ${thesis}advisor is tenured or tenure-track in another Notre Dame department, ask the DGS to approve them; if not, add a tenured or tenure-track co-advisor (${advisor.citation.section}; department policy).`);
    out.dgs.push(`Approve my ${thesis}advisor if they are tenured or tenure-track in another Notre Dame department ${section(advisor)}.`);
  }

  // Credits.
  for (const [id, what] of [
    ['ms.credits.total', 'toward the total-credit requirement'],
    ['phd.credits.total', 'toward the total-credit requirement'],
    ['ms.credits.regular', 'of regular courses'],
    ['phd.credits.regular', 'of regular courses'],
    ['ms.credits.project', 'of project or thesis work'],
    ['phd.credits.nd', 'at Notre Dame'],
  ] as const) {
    const r = byId.get(id);
    if (!r || !isOpen(r.status)) continue;
    const x = remaining(r);
    out.student.push(x ? `Complete ${cr(x.left)} ${what}${ipNote(x)} ${section(r)}.` : `Complete the ${r.title.toLowerCase()} ${section(r)}.`);
  }
  const seminar = byId.get('phd.seminar');
  if (seminar && isOpen(seminar.status)) {
    const notYet = [...textOf(seminar).matchAll(/([A-Z]{2,5} \d{5}): not yet/g)].map((m) => m[1]);
    out.student.push(notYet.length > 0 ? `Take ${notYet.join(' and ')} — the research seminar ${section(seminar)}.` : `Complete the research seminar credits ${section(seminar)}.`);
  } else if (seminar?.status === 'needs_dgs_review' && seminar.completedLate) {
    // Passed after the first year: the DGS confirms it (P4-phd-2).
    out.dgs.push(`Confirm my research seminar taken after the first year ${section(seminar)}.`);
  }

  // Residence and time.
  for (const id of ['ms.residency', 'phd.residency'] as const) {
    const r = byId.get(id);
    if (!r || !isOpen(r.status)) continue;
    const x = remaining(r);
    out.student.push(
      x
        ? `Register full-time for ${x.left} more consecutive semester${x.left === 1 ? '' : 's'} ${section(r)}.`
        : `Register full-time for ${id === 'ms.residency' ? 'one semester (or one summer session)' : 'four consecutive semesters'} ${section(r)}.`,
    );
  }
  for (const id of ['ms.timeLimit', 'phd.timeLimit'] as const) {
    const r = byId.get(id);
    if (!r || r.status === 'met' || r.status === 'not_applicable') continue;
    if (overdue(r)) {
      out.student.push(`Ask the DGS about the time limit${due(r)} ${section(r)}.`);
      // The Graduate School decides a passed limit — dissertation completion
      // status or an eligibility extension (Academic Code §6.2.6.1; DGS Handbook
      // §3.19) — so the DGS's item is to advise (policy review 2026-10-03,
      // P1-page-text-ui-7).
      out.dgs.push(
        id === 'phd.timeLimit'
          ? `Advise the student on applying to the Graduate School for dissertation completion status or an eligibility extension ${section(r)}.`
          : `Advise the student on applying to the Graduate School for an eligibility extension ${section(r)}.`,
      );
    } else if (r.status === 'needs_dgs_review' && r.deadline?.state === 'done') {
      // Every requirement complete, the last one after the limit — the card's
      // "Eligibility at risk" (context.ts timeLimitRow). Nothing is left to
      // complete; the open question is the Graduate School's extension, so the
      // email names it and gives the DGS the item the card does (policy review
      // round 4, P4-phd-1 and P4-mscse-1; DGS 2026-10-11: "apply the suggested
      // handling").
      out.student.push(`Confirm with the DGS whether the Graduate School extended my time limit — every requirement is complete, but the last one came after the limit ${section(r)}.`);
      out.dgs.push(
        id === 'phd.timeLimit'
          ? `Confirm whether the Graduate School extended the student’s time limit, or advise the student on dissertation completion status or an eligibility extension ${section(r)}.`
          : `Confirm whether the Graduate School extended the student’s time limit, or advise the student on an eligibility extension ${section(r)}.`,
      );
    } else if (r.deadline) out.student.push(`Complete all requirements${due(r)} ${section(r)}.`);
  }

  // M.S. project or thesis. The topic first (Academic Code §6.1.7: "With the
  // approval of his or her advisor, the student proposes a thesis topic for
  // program approval") — the advisor's approval is asked for here; who gives
  // the program's is open (HANDBOOK-REVISIONS item 13), so no DGS or Grad
  // Admin item (policy review round 3, P3-emails-4).
  const topic = byId.get('ms.thesis.topic');
  if (topic && isOpen(topic.status)) {
    out.student.push(`Propose my thesis topic, with my advisor’s approval, for the program’s approval ${section(topic)}.`);
    out.advisor.push(`Approve my thesis topic proposal ${section(topic)}.`);
  }
  const thesis = byId.get('ms.thesis.defense');
  if (thesis && isOpen(thesis.status)) out.student.push(`Defend the thesis ${section(thesis)}.`);
  const project = byId.get('ms.project.report');
  if (project && isOpen(project.status)) {
    out.student.push(`Complete the project report and deliverables ${section(project)}.`);
    out.advisor.push(`Accept and approve the project report and deliverables ${section(project)}.`);
  }

  // Ph.D. qualifier.
  const qualifier = byId.get('phd.qualifier');
  // With the course components complete only the research component is
  // left, and its own item follows (policy review round 4, P4-phd-7; DGS
  // 2026-10-12): "Complete all three qualifier components" beside the form
  // reminder told the student the courses were still to do.
  const onlyResearch = qualifier?.qualifierCourseComponentsDone === true;
  if (qualifier && isOpen(qualifier.status)) {
    if (overdue(qualifier)) {
      out.student.push(`Complete the ${onlyResearch ? 'research component of the qualifier' : 'remaining qualifier components'}${due(qualifier)}; ask the DGS about an extension ${section(qualifier)}.`);
      out.dgs.push(`Decide whether to extend the qualifier deadline ${section(qualifier)}.`);
    } else if (!onlyResearch) out.student.push(`Complete all three qualifier components${due(qualifier)} ${section(qualifier)}.`);
  } else if (qualifier?.status === 'needs_dgs_review' && qualifier.completedLate) {
    // Every part done, a course-based one after the four semesters (P3-cse-4a-2,
    // DGS 2026-10-06): the DGS confirms the extension. A late research pass
    // keeps its own line below.
    const lateParts = ['phd.qualifier.core.os', 'phd.qualifier.core.algorithms', 'phd.qualifier.core.architecture', 'phd.qualifier.categories']
      .map((id) => byId.get(id))
      .filter((r): r is RequirementResult => r?.completedLate === true)
      .map((r) => `${r.id === 'phd.qualifier.categories' ? 'the specialization courses' : `the ${r.title.replace(/^Core knowledge:\s*/, '')} core-knowledge course`}${r.completedIn ? ` in ${termLabel(r.completedIn)}` : ''}`);
    if (lateParts.length > 0)
      out.dgs.push(`Confirm that you extended my qualifier deadline — I completed ${lateParts.length === 1 ? lateParts[0] : `${lateParts.slice(0, -1).join(', ')} and ${lateParts[lateParts.length - 1]}`} after it ${section(qualifier)}.`);
  }
  for (const [id, area] of [
    ['phd.qualifier.core.os', 'Operating Systems'],
    ['phd.qualifier.core.algorithms', 'Algorithms'],
    ['phd.qualifier.core.architecture', 'Computer Architecture'],
  ] as const) {
    const r = byId.get(id);
    if (!r) continue;
    if (isOpen(r.status)) out.student.push(`Pass a course that covers ${area} — core knowledge ${section(r)}.`);
    // A course done late is the qualifier's question above, not a course to confirm.
    else if (r.status === 'needs_dgs_review' && !r.completedLate) out.dgs.push(`Confirm the ${area} core-knowledge course named in the review request ${section(r)}.`);
  }
  const categories = byId.get('phd.qualifier.categories');
  if (categories && isOpen(categories.status)) {
    // "CSE 60111 (B-) is below the B floor — retake it …" (2026-09-26); the
    // older "below the B floor: CSE 60111 (B-) — …" still parses.
    const below = /(?:^|\. )([^.]+?) (?:is|are) below the [A-Z][+-]? floor —/.exec(textOf(categories)) ?? /below the [A-Z][+-]? floor: ([^—]+)/.exec(textOf(categories));
    out.student.push(
      below
        ? `Retake or replace ${below[1]!.trim()} — a specialization course below the grade floor ${section(categories)}.`
        : `Complete three specialization courses from three distinct groups, each B or higher ${section(categories)}.`,
    );
  }
  const research = byId.get('phd.qualifier.research');
  if (research && isOpen(research.status)) {
    out.student.push(`Pass the research component of the qualifier${due(research)} ${section(research)}.`);
    out.advisor.push(`Determine whether I have passed the research component and file the Research-Qualifier form ${section(research)}.`);
    if (overdue(research)) out.dgs.push(`Decide whether to extend the research-component deadline ${section(research)}.`);
  } else if (research?.status === 'needs_dgs_review') out.dgs.push(`Confirm the late research-component result ${section(research)}.`);

  // The Oral Candidacy Exam (OCE) and the dissertation.
  const candidacy = byId.get('phd.candidacy');
  if (candidacy && isOpen(candidacy.status)) {
    out.student.push(`Take the Oral Candidacy Exam (OCE)${due(candidacy)} ${section(candidacy)}.`);
    // A missed eighth semester is the Graduate School's probation (Academic
    // Code §6.2.8), not the DGS's call (P1-page-text-ui-7).
    if (overdue(candidacy)) out.dgs.push(`Advise the student on the Graduate School’s consequence for the missed Oral Candidacy Exam (OCE) deadline ${section(candidacy)}.`);
  } else if (candidacy?.status === 'needs_dgs_review') {
    // One item per question the row asks (policy review round 3,
    // P3-text-ui-3): a pass before a readmission after five years or more
    // (Academic Code §5.5), the coursework at the exam (P3-cse-4b-1, DGS
    // 2026-10-06) and a late pass are three questions — an on-time exam with
    // short coursework is never "late", and late plus short names both.
    if (candidacy.forfeitReview)
      out.dgs.push('Rule on my Oral Candidacy Exam (OCE), passed before my readmission after an interruption of five years or more (Academic Code §5.5).');
    if (candidacy.courseworkReview)
      out.dgs.push(`Confirm that my Oral Candidacy Exam (OCE) could be taken — at the exam I showed ${candidacy.courseworkReview} ${section(candidacy)}.`);
    if (candidacy.passedLate || candidacy.completedLate || (!candidacy.forfeitReview && !candidacy.courseworkReview))
      out.dgs.push(`Confirm the late Oral Candidacy Exam (OCE) ${section(candidacy)}.`);
  }
  // Admission to candidacy, the Graduate School's own step after the OCE (DGS
  // 2026-10-04). Its to-dos start once the OCE is DATED — met, or a late or
  // short-coursework pass waiting for the DGS — so the summary agrees with the
  // processing request; before that, the OCE's own items are the work. The
  // engine opens the row's note with "Every condition is met" when only the
  // application is left.
  const admission = byId.get('phd.candidacyAdmission');
  const oceDated = candidacy?.status === 'met' || candidacy?.status === 'needs_dgs_review';
  if (admission && oceDated) {
    if (isOpen(admission.status)) {
      if (/Every condition is met/.test(textOf(admission))) {
        out.student.push(`Apply for admission to doctoral candidacy through the Grad Admin${due(admission)} ${section(admission)}.`);
        out.gradAdmin.push('Submit my Application for Admission to Doctoral Candidacy to the Graduate School (DGS Handbook §3.22.3).');
      } else out.student.push(`Complete the remaining conditions for admission to doctoral candidacy${due(admission)} ${section(admission)}.`);
      if (overdue(admission)) out.dgs.push(`Advise the student on the Graduate School’s consequence for the missed candidacy-admission deadline (DGS Handbook §3.22.3).`);
    } else if (admission.status === 'needs_dgs_review') out.dgs.push(`Confirm my admission to doctoral candidacy ${section(admission)}.`);
  }
  if (candidacy?.status === 'met') {
    const defense = byId.get('phd.dissertation.defense');
    if (defense && isOpen(defense.status)) out.student.push(`Defend the dissertation ${section(defense)}.`);
  }

  // Processing — the Grad Admin's side (2026-09-06 evening): the MSCSE along
  // the way once its row is met, and the qualifier completion form once every
  // component is done but no form date is entered.
  // Only once the student asked for it (DGS 2026-10-11, question 3a: option (b)).
  if (byId.get('phd.msAlongTheWay')?.status === 'met' && byId.get('phd.msAlongTheWay')?.statusLabel !== 'Qualifies') {
    out.gradAdmin.push('Process the MSCSE awarded along the way (§3.1, §4.5).');
    out.student.push('Send the Grad Admin the processing request for the MSCSE along the way (§3.1, §4.5).');
  }
  // The master's candidacy application, the MSCSE's or the MSCSE along the
  // way's (Academic Code §6.1.6; 2026-10-04): open while its row is.
  if (byId.get('shared.msCandidacy')?.status === 'unmet') {
    const late = msLimitPassedClause(report);
    out.student.push(`Ask the Grad Admin to submit the Application for Admission to Master’s Degree Candidacy by the Graduate School calendar’s deadline (Academic Code §6.1.6)${late}.`);
    out.gradAdmin.push(`Submit my Application for Admission to Master’s Degree Candidacy to the Graduate School (Academic Code §6.1.6)${late}.`);
  }
  // Once the course components are complete (P3-cse-4a-3; DGS 2026-10-07: option (a)).
  if (qualifier?.qualifierCourseComponentsDone === true && /qualifier (completion )?form/.test(textOf(qualifier))) {
    out.student.push('File the qualifier completion form with the Grad Admin (§4.4).');
    out.gradAdmin.push(qualifier.status === 'met' ? 'Record the completed qualifier once my form arrives (§4.4).' : 'Record the qualifier’s completed course components once my form arrives (§4.4).');
  }

  // Course-level approvals — the per-course sign-off list.
  const approvals = byId.get('shared.approvals');
  // Waiting only on the Graduate School's approval of the dual-degree plan
  // (P3-dh-front-1-2-2; DGS Handbook §2.9): the student's errand, not the DGS's.
  const dualPlanCourses: string[] = [];
  const pendingCourses: string[] = [];
  for (const part of approvals?.detailParts ?? []) {
    // A statement — fact or note (the page folds notes, DGS 2026-10-03) — is
    // not a course list; the plan-of-study one still makes an advisor to-do.
    if (typeof part === 'string' || 'note' in part) {
      const statement = typeof part === 'string' ? part : part.note;
      if (/approved your coursework/.test(statement)) out.advisor.push(`Approve my coursework (${report.program === 'mscse' ? '§3.2' : '§4.2'}).`);
      continue;
    }
    if ('warn' in part || 'check' in part) continue; // a warning, or a condition, is not a course to chase
    for (const item of part.items) {
      const m = /^(.+?) \((.+)\)$/.exec(item);
      const reason = m ? m[2]! : '';
      // Several courses may share one reason on the row (2026-09-26); each
      // gets its own to-do here.
      for (const course of (m ? m[1]! : item).split(/,\s*/)) {
      const dual = DUAL_PLAN_REASON.exec(reason);
      if (dual && !dual[1]) {
        dualPlanCourses.push(course);
        continue;
      }
      pendingCourses.push(course);
      // Each list in its reader's own words (DGS 2026-09-28): the page's
      // reason is written for the student ("send the review request", "your
      // advisor"), and used to land verbatim in front of the advisor and the DGS.
      // A dual-degree course with a real DGS question after it: that question.
      const item = approvalItems(course, dual?.[1] ?? reason, report.program);
      if (item.advisor) out.advisor.push(item.advisor);
      if (item.incomplete) out.dgs.push(item.incomplete);
      if (item.dgs) out.dgs.push(item.dgs);
      }
    }
  }
  // One name per course: the approvals row lists a course under one lead, but
  // a course can reach here from more than one part, and this sentence is the
  // one the student emails (2026-09-07). The attach-transcripts reminder is
  // the student's own dialog's, not the advisor's (trim review 2026-09-18, P-37).
  const once = (list: string[]) => [...new Set(list)].join(', ');
  if (pendingCourses.length > 0) {
    out.student.push(`Send the DGS the review request for ${once(pendingCourses)}.`);
  }
  // Transfer credit the DGS has decided (a `yes` in the course rules, or the
  // tick on a case-by-case course) and the Grad Admin has still to submit
  // (policy review round 3, P3-emails-1; DGS 2026-10-06: "apply the suggested
  // handling"): read from the processing request's own list. CSE §5.2: "A
  // student should send the credit transfer request to the Grad Admin and the
  // DGS will approve and make a recommendation to the Graduate School." Gone
  // once the student ticks that the Grad Admin recorded it.
  if (transfers !== undefined && transfers.courses.length > 0 && !transfers.recorded) {
    const courses = once(transfers.courses);
    out.student.push(`Send the Grad Admin the processing request for ${courses} (§5.2)${transfers.firstSemesterDone ? '' : ' once my first semester is complete'} — before the semester my degree is conferred.`);
    out.gradAdmin.push(`Submit the Transfer of Credits request to the Graduate School for ${courses} — recommended by the DGS (§5.2).`);
  }
  if (dualPlanCourses.length > 0) {
    out.student.push(`Get the Graduate School’s approval of my dual-degree plan of study, which counts ${once(dualPlanCourses)} toward both degrees (DGS Handbook §2.9).`);
  }

  // Missing rules-sheet parameters: the DGS's tool to fix.
  for (const r of report.requirements) {
    const m = /the rules sheet is missing '([^']+)'/.exec(textOf(r));
    if (r.status === 'cannot_evaluate' && m) out.dgs.push(`Add the missing parameter '${m[1]}' to the rules sheet so ${r.title.toLowerCase()} can be checked.`);
  }
  return {
    student: dedupe(out.student),
    advisor: dedupe(out.advisor),
    dgs: dedupe(out.dgs),
    gradAdmin: dedupe(out.gradAdmin),
  };
}

/** The advisor's and the DGS's to-do for one course still waiting on them,
 * from the approvals row's reason (allocate.ts / review.ts wording). The
 * facts are read off the reason — unlisted, non-CSE, below the 60000 level,
 * case by case, a §5.2 recommendation — and each line is written for its
 * reader (DGS 2026-09-28). */
export function approvalItems(course: string, reason: string, program: 'mscse' | 'phd'): { advisor?: string; dgs?: string; incomplete?: string } {
  // A lapsed Incomplete (allocate.ts): the Graduate School's associate dean
  // extends one, so the DGS can only confirm what is on the record — as the
  // review request asks (review.ts). Its own line, and a second question on
  // the same course keeps its line too, so the Incomplete no longer
  // disappears behind an "Approve …" (policy review round 3, P3-emails-7).
  // A Spring 2020 student's reason carries Appendix A.1's clause between the
  // two (policy review round 4, P4-ac-1; DGS 2026-10-12): the same
  // confirmation, with the clause, never "Decide on".
  const lapsed = /^Incomplete \(I\) past its deadline\b.*?\(Academic Code §4\.4\)(; for students enrolled in Spring 2020[^;]*)?; the A?DGS confirms(?:; (.+))?$/.exec(reason);
  if (lapsed) {
    const incomplete = `Confirm whether the Graduate School extended my Incomplete in ${course}, or the grade was posted (Academic Code §4.4${lapsed[1] ? '; for students enrolled in Spring 2020, Appendix A.1 may give 60 days' : ''}).`;
    return { ...(lapsed[2] ? approvalItems(course, lapsed[2], program) : {}), incomplete };
  }
  const section = /\((§[^)]*)\)\s*$/.exec(reason)?.[1] ?? (program === 'mscse' ? '§3.2' : '§4.2');
  const unlisted = /not in the course rules/i.test(reason);
  const nonCse = /outside CSE|non-CSE/i.test(reason);
  const below = /below the 60000|4xxxx|allowance for courses below/i.test(reason) || /advisor \+ [A-Z]+ approval per the course rules/.test(reason);
  const caseByCase = /case by case/i.test(reason);
  // Credit already accepted on the Notre Dame record that the DGS confirms for
  // this student (P3-import-1, 2026-10-05) — nothing to recommend.
  const onRecord = /transfer credit on your Notre Dame record/i.test(reason);
  // Another university's Incomplete, held until it is graded (P3-ac-4-1, 2026-10-05).
  const outsideIncomplete = /graded I \(Incomplete\) at /.test(reason);
  const transfer = /§5\.2|transfer/i.test(reason) && !nonCse && !below;
  const what = nonCse ? ' — a course from outside CSE' : below ? ' — a course below the 60000 level' : '';
  const out: { advisor?: string; dgs?: string } = {};
  if (/advisor/i.test(reason)) out.advisor = `Approve ${course}${what ? `${what},` : ''} for my coursework (${section}).`; // "coursework", not "plan of study" (DGS 2026-10-09)
  if (/DGS|review|rules sheet|transfer|case by case/i.test(reason)) {
    out.dgs = unlisted
      ? `Enter ${course} in the course rules — it is not listed yet${nonCse ? '; a course from outside CSE also needs my advisor’s approval' : ''} (${section}).`
      : caseByCase
        ? `Decide on ${course} for me — the course rules say case by case (${section}).`
        : outsideIncomplete
          ? `Decide on ${course} once its final grade is posted — it is graded I (Incomplete) at my previous university (§5.2).`
          : onRecord
            ? `Confirm that ${course}, already accepted as transfer credit on my Notre Dame record, counts toward this degree (§5.2).`
            : transfer
              ? `Recommend the transfer credit for ${course} (§5.2).`
              : /approval/i.test(reason)
                ? `Approve ${course} for me${what} (${section}).`
                : `Decide on ${course} — ${firstPerson(reason)}.`;
  }
  return out;
}

/** "Matthew Morrison" → "Prof. Matthew Morrison"; "Dr. Hu" / "Professor Hu" / "Prof. Hu" unchanged. */
export function withTitle(name: string): string {
  return /^(prof\.?|professor|dr\.?)\s/i.test(name) ? name : `Prof. ${name}`;
}

function dedupe(items: string[]): string[] {
  return [...new Set(items)];
}

// ---------- re-voicing the engine's details ----------

/** The engine's detail, re-voiced for an email from the student to the
 * advisor: one "why" string of short sentences (each statement capitalized,
 * period-separated — the engine's own joining style); empty when nothing is
 * left to say (the deadline phrase then stands alone). `firstStatementOnly`
 * keeps just the leading statement. */
export function whyFor(r: RequirementResult, firstStatementOnly = false): string {
  // A page-only policy note stays on the card (2026-10-05).
  const parts = r.detailParts?.filter((p) => !(typeof p === 'object' && 'note' in p && p.pageOnly));
  const statements = (parts ? parts.map((p) => flatten(p, r)) : splitStatements(r.detail))
    .map((s) => withoutPageForm(s.trim()).replace(/\.$/, ''))
    .filter((s) => s.length > 0)
    .map(rewrite)
    .filter((s) => !dropsFromEmail(s, r))
    .map(firstPerson);
  const kept = firstStatementOnly ? statements.slice(0, 1) : statements;
  if (kept.length === 0) return '';
  return kept.map((s) => `${s.charAt(0).toUpperCase()}${s.slice(1)}.`).join(' ');
}

/** A detail part as one sentence. The §4.4.2 categories row lists "COURSE
 * title → Group" per course on the page; the advisor needs only which groups
 * are satisfied (DGS 2026-09-23: "Just need to say which categories are
 * satisfied. No bullet points needed."), so its items reduce to the distinct
 * group names. */
function flatten(p: DetailPart, r?: RequirementResult): string {
  if (typeof p === 'string') return p;
  if ('warn' in p) return p.warn;
  // A note is explanation on the page (folded) and plain text in the messages.
  if ('note' in p) return p.note;
  // A condition's mark is the page's (2026-10-06); its words carry the state.
  if ('check' in p) return p.check;
  const items =
    r?.id === 'phd.qualifier.categories'
      ? [...new Set(p.items.filter((i) => !/ — (?:in progress|that group is already covered)/.test(i)).map((i) => i.replace(/^.*→\s*/, '').replace(/\s*\(flexible course[^)]*\)/, '').trim()))]
      : p.items;
  return `${p.lead}: ${items.join(r?.id === 'phd.qualifier.categories' ? ', ' : '; ')}`;
}

/** Split prose into statements at ". " before a capital or digit, sparing the
 * abbreviations the details use (M.S., Ph.D., e.g., i.e., vs., etc.). The
 * abbreviation test is written out rather than a lookbehind: Safari before
 * 16.4 cannot compile one, and this runs on every render of the audit page
 * (cross-browser review, 2026-10-10). */
function splitStatements(detail: string): string[] {
  const out: string[] = [];
  const stop = /\.\s+(?=[A-Z0-9(“"])/g;
  let start = 0;
  for (let m = stop.exec(detail); m !== null; m = stop.exec(detail)) {
    if (ABBREVIATION_BEFORE.test(detail.slice(0, m.index))) {
      stop.lastIndex = m.index + 1;
      continue;
    }
    out.push(detail.slice(start, m.index));
    start = m.index + m[0].length;
  }
  out.push(detail.slice(start));
  return out;
}
const ABBREVIATION_BEFORE = /\b(?:M\.S|Ph\.D|e\.g|i\.e|vs|etc|No)$/;

/** The page's own form inside a statement — "…; enter the date under
 * Milestones once it is approved", "Enter your advisor under Milestones. A
 * student who …" — is no news to an email's reader (policy review round 3,
 * P3-emails-4): the instruction is cut and the fact kept. A statement that is
 * nothing but such an instruction is dropped by dropsFromEmail. */
function withoutPageForm(statement: string): string {
  return (
    statement
      // A leading sentence that is only the instruction.
      .replace(/^(?:Enter|Answer)\b[^.]*\bunder Milestones\b[^.]*\.\s+(?=[A-Z])/, '')
      // A trailing clause.
      .replace(/[;,]\s*(?:then\s+|and\s+)?(?:enter|answer)\b[^;]*\bunder Milestones\b[^;]*$/i, '')
  );
}

/** Statements written for the student at the page that say nothing to the
 * advisor: how to record an approval, where a list lives on the site, what
 * to do next ("Talk to the DGS"), and an "Overdue —" statement whose fact
 * the deadline phrase already carries. */
function dropsFromEmail(statement: string, r: RequirementResult): boolean {
  if (/\bcheckbox(es)?\b|\battestation\b|\btick\b|course rules page|self-check page/i.test(statement)) return true;
  // A seminar already taken ("CSE 63801: done (Fall 2025)") is nothing the
  // advisor needs (DGS 2026-09-23); the ones still open stay.
  if (/^[A-Z]{2,5} \d{5}: done\b/.test(statement)) return true;
  if (/^(Talk to|Ask the DGS|Ask your advisor)\b/i.test(statement)) return true;
  // "Enter the date … under Milestones" is the page's own form (2026-10-04);
  // so is any statement still naming it once withoutPageForm has cut the
  // instruction from a fact (policy review round 3, P3-emails-4).
  if (/\bunder Milestones\b/i.test(statement)) return true;
  if (/^Overdue\b/i.test(statement) && r.deadline?.state === 'overdue') return true;
  return false;
}

/** Page instructions that carry a fact worth telling the advisor, restated
 * as the fact. Add a rule here when an engine detail gains a new "do this on
 * the page" sentence (they are listed in docs/CLAUDE-HANDOFF.md). */
const REWRITES: [RegExp, string][] = [
  // "tick the box" since the trim review (P-55, 2026-09-18); "attestation" kept
  // so an older fixture still re-voices.
  [/^Confirm your advisor approved your coursework \(([^)]*)\) and tick the (attestation|box).*$/i, 'Advisor approval of my coursework ($1) is not yet recorded'],
  [/^Enter your (?:graduate-level )?cumulative GPA\b.*$/i, 'Cumulative GPA not entered yet'],
  // The §4.4.2 retake advice is written for the student; the advisor needs the
  // course, the grade and the §, and the to-do list already says "Retake or
  // replace …" (trim review 2026-09-18, P-22).
  [/^(.+?) (?:is|are) below the ([A-Z][+-]?) floor — retake (?:it|them) or take another course \((§[\d.]+)\)$/i, 'below the $2 floor ($3): $1'],
  // "one card per core area below" is the page describing its own layout; the
  // email has no cards (trim review 2026-09-18, P-40).
  [/ — one card per core area below\)/, ')'],
];
function rewrite(statement: string): string {
  for (const [re, to] of REWRITES) if (re.test(statement)) return statement.replace(re, to);
  return statement;
}

/** The student is writing: "you are registered" → "I am registered"; "by your
 * first semester" → "by my first semester". */
function firstPerson(statement: string): string {
  return statement
    .replace(/\b[Yy]ou are\b/g, 'I am')
    .replace(/\b[Yy]ou\b/g, 'I')
    .replace(/\bYour\b/g, 'My')
    .replace(/\byour\b/g, 'my')
    .replace(/\b[Yy]ours\b/g, 'mine');
}
