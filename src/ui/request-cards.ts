// The two request cards: "Ask the DGS to review" (one review request,
// 2026-09-03) and "Ask the Grad Admin to process" (2026-09-06 evening). Moved
// out of src/ui/app.ts on 2026-10-22 (blue-team review 2026-10-17, W11) with
// their bodies unchanged: neither calls update, render or persist — the copy
// dialogs do the work — so each takes what it reads in one args object, built
// by render() per call (the handoff's 2026-09-20 rule: never captured).
import { normalizeUniversity, universityCreditSystem } from '../data/external.ts';
import type { Rules } from '../data/types.ts';
import { deciderTitle } from '../engine/decider.ts';
import { reviewRequestSummary, type PendingDgsReview } from '../engine/review.ts';
import type { AuditReport, Student } from '../engine/types.ts';
import { GRAD_ADMIN, deciderContact, mailto } from './contacts.ts';
import { copyDialog } from './copy-dialog.ts';
import { el, inactiveButton, simulationSendNote } from './dom.ts';
import { FILL_IN_STEP, plural, unofficialTranscriptNote, unofficialTranscriptSlots } from './email-html.ts';
import { DEGREE_SLOTS } from './external-upload.ts';
import type { gradAdminRequest } from './grad-admin-request.ts';
import { priorStudyLabel, programHistory } from './program-history.ts';
import { buildCombinedReviewRequest, reviewRequestCourses } from './review-request.ts'; // the DGS review request's builder — its own small module since W3 (2026-10-22), no longer the transcript parser's tail
import { type ResultStamp, checkedWithLine } from './stamp.ts';

/** What both cards read from the page: the record and the rules, the toast
 * (the inactive buttons' explanation), whether simulation mode is on, the
 * result stamp and the Simulation chip builder (null outside the mode). */
export interface RequestCardArgs {
  student: Student;
  rules: Rules;
  toast: (msg: string) => void;
  inSimulation: boolean;
  stamp: ResultStamp;
  simulationChip: () => HTMLElement | null;
}

// ---------- ask the DGS (ONE review request, 2026-09-03) ----------

// Everything that still needs a DGS decision, in one card with one copy
// button and one email: Notre Dame courses that are not in the rules sheet
// (typical for non-CSE), dgs_approval and not yet approved, or blank-verdict
// — plus external courses the ExternalCourses tab has not ruled on. The
// student MUST email the request to the DGS and the Graduate Program
// Administrator; the page itself sends nothing.
export function askDgsCard(args: RequestCardArgs, pending: readonly PendingDgsReview[], report: AuditReport): HTMLElement {
  const { student, rules, toast, stamp, simulationChip } = args;
  const simulation = args.inSimulation; // the mode flag, under the name app.ts's state has, so the body below reads as it did there
  // Which courses need a DGS decision, and why, is the engine's call
  // (src/engine/review.ts, 2026-09-06 evening — with the test matrix that
  // pins it); this card only lists them and builds the copy-ready request.
  // The list comes from render(), computed once per render from the same
  // classification — dated — that the report and the Grad Admin request
  // read (blue-team review 2026-10-17, W6: the card's own classify() had no
  // date, so an Incomplete past its deadline never reached this request).
  const n = pending.length;
  // Notes that are not about one course: the audit's review flags (a 4+1
  // with many undergraduate graduate-level courses counted, 2026-09-12; a
  // full-time semester without three graduate-level credits, Academic Code
  // §4.1, 2026-10-03 — whose warning says it is in this request) and the
  // checks on a `yes` the DGS may not have meant (2026-10-04, P1-sheet-48 /
  // -c2). Read from the report, so the page and the request say the same.
  const notes = [...(report.reviewFlags ?? []), ...(report.staffChecks ?? [])];
  // Shown all the time, its button inactive until a course needs a decision
  // or a note needs the DGS (DGS 2026-10-16: "Apply it similarly to
  // 'Initiate Review' for ADGS/DGS. Show it all the time, but the button is
  // inactive until needed." — as the Grad Admin card, 2026-10-15).
  const idle = n === 0 && notes.length === 0;
  const what = idle ? '0 courses' : reviewRequestSummary(n, notes.length > 0);
  const label = idle ? 'Initiate the review request' : `Initiate the review request for ${what}`;
  const who = deciderTitle(student.program);
  const decider = deciderContact(student.program);
  // The two course lists — Courses-tab rows and ExternalCourses rows
  // (review-request.ts reviewRequestCourses — in transcript/external.ts until W3, 2026-10-22; P3-dh-10-2).
  const slotOf = (p: PendingDgsReview): string | undefined =>
    p.course.entry.degreeLevel ? (DEGREE_SLOTS.find((sl) => sl.level === p.course.entry.degreeLevel)?.label ?? p.course.entry.degreeLevel) : undefined;
  const where = (p: PendingDgsReview): string =>
    p.kind === 'nd' ? 'Notre Dame' : p.kind === 'priorNd' ? 'Notre Dame, before entry' : (p.course.entry.institution ?? 'other university');
  // "— no title entered" on a pending Notre Dame course without one (blue-team
  // review 2026-10-17, U14): the request's paste-ready row would otherwise
  // reach the DGS as a bare number, and nothing on this card said so. The
  // email builder is untouched — it prints the title it has.
  const line = (courseId: string, where: string | undefined, reason: string, noTitle = false) =>
    el('div', { class: 'review-line', 'data-keep-dgs': '' }, el('span', { class: 'cid' }, courseId), `${where ? ` (${where})` : ''} — ${reason}${noTitle ? ' — no title entered' : ''}`);
  return el(
    'div',
    { class: `card dgs-review${idle ? ' is-idle' : ''}`, id: 'dgs-review' },
    el('h2', {}, `Ask the ${deciderTitle(student.program)} to review `, el('span', { class: 'chip-note' }, what), simulationChip()), // the mode repeated on the card (D9; in every mode since the review fix of 2026-10-09)
    // Earlier coursework waits on the earlier-degrees answer (UI review,
    // 2026-10-08): said first; the request itself stays (DGS 2026-09-03).
    student.background === undefined && pending.some((p) => p.kind !== 'nd')
      ? el('p', { class: 'hint warn', 'data-key': 'review.answer-first' }, 'Answer the ', el('a', { href: '#earlier-degrees' }, 'earlier-degrees questions in the Transcripts card'), ' first — the answers can change which of these courses need review.')
      : '',
    // In simulation mode (D7) the two instruction paragraphs — the email
    // app, the address, the attach reminder, the process — become one
    // sentence: nothing is sent from a plan. The course list stays.
    ...(simulation
      ? [
          el(
            'p',
            { class: 'hint simulation-hint' },
            idle
              ? `In simulation mode nothing is sent — and nothing in this plan needs the ${who}’s review yet.`
              : `In simulation mode nothing is sent: these are the courses this plan would put before the ${deciderTitle(student.program)} — exit the simulation to send the review request from your record.`,
          ),
        ]
      : idle
        ? // Nothing to review: one line, as the Grad Admin card's (the two
          // instruction paragraphs return with the first course).
          [
            el(
              'p',
              { class: 'hint' },
              `Nothing to review yet — a request is needed only when a course needs the ${who}’s decision: one not in the course rules yet, one decided case by case, or one from another university not yet ruled on. The ${who} (`,
              mailto(decider.email),
              ') decides by email.',
            ),
          ]
        : [
          el(
            'p',
            { class: 'hint' },
            // Shortened in place (UI review item 3; DGS 2026-10-09: option (b)).
            el('strong', {}, 'Decisions are made only by email: '),
            `the button below opens the review request in your own email app, for you to check and send to the ${deciderTitle(student.program)} (`,
            mailto(decider.email),
            // The DGS's own sentence (2026-09-15) and the attach reminder
            // (2026-09-03); the email's format and the two-roles statement are
            // said by the dialog and the Grad Admin card (trim review 2026-09-18, P-5).
            '). Attach your transcript PDFs (whichever apply) to the same email.',
          ),
          // The process (DGS 2026-09-27): a course not in the course rules is
          // entered by the DGS after this request — yes, no, or case by case —
          // and the page reads the updated rules on its next visit; a
          // case-by-case course needs the DGS's answer for this student,
          // recorded by the tick on the course.
          el(
            'p',
            { class: 'hint process-note' },
            `A course not in the course rules yet reaches the ${deciderTitle(student.program)} through this request; the ${deciderTitle(student.program)} enters it — yes, no, or case by case — and this page reads the updated rules on your next visit. A case-by-case course needs the ${deciderTitle(student.program)}’s answer for you: once it is given, tick the box next to the course.`,
          ),
        ]),
    ...pending.map((p) => line(p.course.entry.courseId, where(p), p.reason, p.kind === 'nd' && !p.course.entry.title)),
    ...notes.map((t) => el('div', { class: 'review-line review-note', 'data-keep-dgs': '' }, el('span', { class: 'cid' }, 'Note'), ` — ${t}`)),
    el(
      'div',
      { class: 'save-buttons' },
      // In the mode the button is inactive with its reason (D7): no request
      // leaves a plan — `inactiveButton`, so the reason can be shown.
      simulation
        ? inactiveButton({ class: 'btn', 'data-key': 'review.copy' }, simulationSendNote('the review request'), toast, label)
        : idle
          ? inactiveButton(
              { class: 'btn', 'data-key': 'review.copy' },
              `Nothing for the ${who} to review yet. This becomes active when a course needs the ${who}’s decision — one not in the course rules yet, one decided case by case, or one from another university not yet ruled on — or something on your record needs the ${who} to check.`,
              toast,
              label,
            )
          : el(
        'button',
        {
          class: 'btn',
          'data-key': 'review.copy',
          onclick: () => {
            // Copy, then the check-before-you-send dialog (DGS request 2026-09-06 evening).
            // (A plain call since W3, 2026-10-22: the builder is src/ui/review-request.ts,
            // in the first load; the `import()` this replaced had resolved to code that
            // was already loaded, because the parser it named was in the first load too.)
            const { nd: ndReq, external: extReq } = reviewRequestCourses(pending, slotOf);
            const built = buildCombinedReviewRequest({ priorStudy: priorStudyLabel(student), nd: ndReq, external: extReq, notes, history: programHistory(student), unofficial: unofficialTranscriptNote(student.courses, 'review'), decider: deciderTitle(student.program), stamp: checkedWithLine(stamp), universityRow: (u) => (universityCreditSystem(rules.universityCreditSystems, u) !== undefined ? 'set' : rules.universities.some((r) => r.universityKey === normalizeUniversity(u)) ? 'blank' : 'absent') });
            void copyDialog({
              what: 'Review request',
              recipient: { role: decider.role, name: decider.name, email: decider.email },
              subject: built.subject,
              text: built.text,
              html: built.html,
              steps: [
                { text: FILL_IN_STEP },
                { text: `Attach copies of your transcripts as PDFs (Bachelor’s / Master’s / Ph.D. — whichever apply) — the ${deciderTitle(student.program)} cannot review the courses without them. The official transcript must be sent directly to the Graduate School by each university’s registrar.`, emphasis: true },
              ],
              returnFocusKey: 'review.copy',
            });
          },
        },
        `Initiate the review request for ${what}`,
      ),
    ),
  );
}

// "Ask the Grad Admin to process" (DGS request 2026-09-06 evening): the
// other half of the two roles. The DGS decides eligibility (the review
// request above); the Grad Admin processes what has been decided and keeps
// the official record. Placed after the milestones, whose dates it reports.
export function askGradAdminCard(args: RequestCardArgs, built: ReturnType<typeof gradAdminRequest>): HTMLElement {
  const { student, toast, simulationChip } = args;
  const simulation = args.inSimulation; // as in askDgsCard
  const n = built.items.count;
  const decider = deciderContact(student.program);
  // The Grad Admin needs the original transcripts only to process §5.2
  // transfer credit; nothing else in the request is decided from a PDF, so
  // the attach step, the email's "Attached:" line and the card's clause
  // appear only when a transfer is in it (trim review 2026-09-18, P-45).
  // …and only while that credit is still to submit: transfer credit the
  // student ticked as recorded goes along for the record (DGS 2026-10-15).
  const needsTranscripts = built.items.transfers.length > 0 && student.attestations.transferRecorded !== true;
  // Transfer credit to submit from a transcript marked unofficial waits for
  // the official one (DGS 2026-10-16: "an unofficial transcript will not be
  // accepted for official processing").
  const unofficialSlots = needsTranscripts
    ? unofficialTranscriptSlots(student.courses.filter((c) => built.items.transfers.some((t) => t.unofficial === true && t.courseId === c.courseId && t.institution === c.institution)))
    : undefined;
  // The major events, the only things that make the button active (DGS
  // 2026-10-15; grad-admin-request.ts ProcessingItems.count) — the MSCSE has
  // no qualifier form and no MSCSE along the way.
  const phd = student.program === 'phd';
  const label = 'Initiate the request';
  const attrs = { class: 'btn', 'data-key': 'gradadmin.copy' };
  const button = simulation
    ? // In the mode nothing is sent (D7): inactive with its reason, whatever the count.
      inactiveButton(attrs, simulationSendNote('the processing request'), toast, label)
    : n === 0
      ? inactiveButton(
          attrs,
          phd
            ? 'Nothing for the Grad Admin to process yet. This becomes active when there is something to process — transfer credit the DGS approved for you (§5.2), the qualifier completion form (§4.4), the MSCSE along the way (§4.5), or an application for doctoral or master’s candidacy. Milestone dates and requirements met need no request of their own; they go along with the next one.'
            : 'Nothing for the Grad Admin to process yet. This becomes active when there is something to process — transfer credit the DGS approved for you (§5.2) or your application for master’s degree candidacy (Academic Code §6.1.6). Milestone dates and requirements met need no request of their own; they go along with the next one.',
          toast,
          label,
        )
      : el(
          'button',
          {
            ...attrs,
            onclick: () => {
              void copyDialog({
                what: 'Processing request',
                recipient: { role: GRAD_ADMIN.role, name: GRAD_ADMIN.name, email: GRAD_ADMIN.email, cc: { role: decider.role, name: decider.name, email: decider.email } },
                subject: built.subject,
                text: built.text,
                html: built.html,
                steps: [{ text: FILL_IN_STEP }, ...(needsTranscripts ? [{ text: 'Attach copies of your transcripts as PDFs (Bachelor’s / Master’s / Ph.D. — whichever apply); the official transcript must be sent directly to the Graduate School by each university’s registrar.', emphasis: true }] : [])],
                returnFocusKey: 'gradadmin.copy',
              });
            },
          },
          label,
        );
  return el(
    'section',
    { class: 'card grad-admin-request', id: 'grad-admin' },
    el('h2', {}, 'Ask the Grad Admin to process ', el('span', { class: 'chip-note' }, plural(n, 'item')), simulationChip()), // the mode repeated on the card (D9; in every mode since the review fix of 2026-10-09)
    // Two people, two jobs (DGS 2026-09-06; the button sentence DGS
    // 2026-09-15). While there is nothing to send, the paragraph told the
    // student to click a button that does nothing, so the n = 0 state is
    // one line and the full paragraph returns with the first item (trim
    // review 2026-09-18, P-4). The full paragraph no longer points at "the
    // review request above" (a card most students never see) or repeats
    // "the page itself sends nothing" (step 3 of the dialog) — P-19.
    // In simulation mode (D7) the paragraph is one sentence: nothing is
    // sent from a plan; the item list below stays.
    simulation
      ? el(
          'p',
          { class: 'hint simulation-hint' },
          n === 0
            ? 'In simulation mode nothing is sent — and nothing in this plan is ready for the Grad Admin yet.'
            : `In simulation mode nothing is sent: these are the ${plural(n, 'item')} this plan would put before the Grad Admin — exit the simulation to send the processing request from your record.`,
        )
      : n === 0
      ? el(
          'p',
          { class: 'hint' },
          phd
            ? 'Nothing to process yet — a request is needed only for transfer credit, the qualifier completion form, the MSCSE along the way or a candidacy application; your milestone dates and standing go along with it. The Grad Admin ('
            : 'Nothing to process yet — a request is needed only for transfer credit or your master’s candidacy application; your milestone dates and standing go along with it. The Grad Admin (',
          `${GRAD_ADMIN.name}, `,
          mailto(GRAD_ADMIN.email),
          ') processes what the DGS has decided.',
        )
      : el(
          'p',
          { class: 'hint' },
          // Shortened in place (UI review item 3; DGS 2026-10-09: option
          // (b)): the bold sentence, every role and § kept.
          el('strong', {}, 'Two people, two jobs. '),
          'The DGS decides; the Grad Admin (',
          `${GRAD_ADMIN.name}, `,
          mailto(GRAD_ADMIN.email),
          phd
            ? ') processes it — transfer credit (§5.2), the qualifier completion form (§4.4), the MSCSE along the way (§4.5), the candidacy applications; your milestone dates and standing go along. '
            : ') processes it — transfer credit (§5.2), the master’s candidacy application (Academic Code §6.1.6); your milestone dates and standing go along. ',
          `The button opens the request in your email app, to the Grad Admin with the DGS in cc${needsTranscripts ? ' — attach your transcript PDFs' : ''}.`,
        ),
    ...built.items.lines.map((text) => el('div', { class: 'review-line', 'data-keep-dgs': '' }, text)),
    ...(n > 0 && unofficialSlots !== undefined
      ? [
          el(
            'p',
            { class: 'hint warn', 'data-key': 'gradadmin.unofficial' },
            unofficialSlots.one
              ? `The ${unofficialSlots.list} transcript you imported is an unofficial copy: the Grad Admin can process its transfer credit only once the university’s registrar has sent the official transcript to the Graduate School.`
              : `The ${unofficialSlots.list} transcripts you imported are unofficial copies: the Grad Admin can process their transfer credit only once each university’s registrar has sent the official transcript to the Graduate School.`,
          ),
        ]
      : []),
    // What goes along, never on its own (DGS 2026-10-15).
    ...(n > 0 && built.items.forTheRecord !== undefined ? [el('p', { class: 'hint for-the-record' }, built.items.forTheRecord)] : []),
    el('div', { class: 'save-buttons' }, button),
  );
}
