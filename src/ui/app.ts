// The student-facing app: standing form, course table with sheet-driven
// autocomplete, milestone dates, attestations, and the live report.
// All rule logic lives in src/engine/ — this file only collects input and renders.
import type { NotreDameNow } from '../data/clock.ts';
import { canonicalCourseId, resolveRuleRow } from '../data/assemble.ts';
import { findExternalRule, isNotreDameInstitution, normalizeUniversity, universityCreditSystem } from '../data/external.ts';
import { CORE_TITLE_RE } from '../engine/core-title.ts';
import { BS_SHARED_CREDITS_MAX, NON_DEGREE_CREDITS_MAX, classify, firstSemesterComplete, mscseSeparation, ndUndergraduateCounting, overMaxTerms, priorNdUndergraduateCanCount, type ClassifiedCourse } from '../engine/allocate.ts';
import { ndPostingOf } from '../engine/nd-posting.ts';
import { fullTimeRecordsFrom, summerFullTimeFloor } from '../engine/requirements/residency.ts';
import { compareTerm, normalizeEntryTerm, semesterSeq } from '../engine/term.ts';
import type { Rules } from '../data/types.ts';
import { coursesNeedingDgsReviewFor, reviewRequestSummary, type PendingDgsReview } from '../engine/review.ts';
import { shortName } from '../engine/short-names.ts';
import { audit } from '../engine/audit.ts';
import { GRADES } from '../engine/grades.ts';
import { transcriptGapSemesters, withdrawalQuestion, withdrawalSemesters } from './withdrawals.ts';
import { uncoveredRegistrationGaps } from '../engine/registration-gaps.ts';
import { termIndex, termLabel, termOfDate, termShort } from '../engine/term.ts';
import type { AuditReport, CourseEntry, CourseLine, MilestoneDateKey, MilestoneDeadline, Program, Season, Student, Term } from '../engine/types.ts';
import { deadlineText } from './milestone-deadline.ts';
import { PREVIEW_OPEN_NOTE, clear, el, inactiveButton, option } from './dom.ts';
import {
  type Simulation,
  changesSentence,
  clampSimulationTerm,
  clearSimulation,
  countChangesSince,
  defaultSimulationTerm,
  loadSimulation,
  parseSimulationTermCode,
  routeLoadedFile,
  saveSimulation,
  simulationFileName,
  simulationFilePayload,
  simulationTermCode,
  simulationTerms,
  simulationToday,
} from './simulation.ts';
import { siblingAnchorAttrs } from './sibling-links.ts';
import { BETA_SCOPE_NOTICE, RULES_ACCURACY_NOTICE, betaNotice, handbookLink, rulesDateLine } from './handbook.ts';
import { checkedWithLine, resultStamp, savedStamp } from './stamp.ts';
import { sourcesLine } from './provenance.ts';
import { planNotes } from './plan-notes.ts';
import { DGS, GRAD_ADMIN, LICENSE_URL, REPO_URL, applyContactOverrides, contactCard, mailto, reportToDgs, deciderContact } from './contacts.ts';
import { isEmbedded, openFullPageLink, placeInFrame } from './embed.ts';
import { themeToggle } from './theme.ts';
import { deciderTitle } from '../engine/decider.ts';
import {
  BACHELORS_YEAR_RANGE,
  COURSE_CREDITS_RANGE,
  GPA_RANGE,
  TERM_YEAR_RANGE,
  inRange,
  inputRefusal,
} from '../engine/ranges.ts';
import { inferMsOption } from '../engine/requirements/mscse.ts';
import { qualifierPriorRulesEligible } from '../engine/requirements/phd.ts';
import { applyBackground, backgroundQuestions, choiceRow, completeBackground, describeBackground, openBackgroundDialog, type Background } from './background.ts';
import { draftForProgram, mergeReading, pruneRead, reconcileInferences, withdrawBackground } from './background-read.ts';
import { DEGREE_SLOTS, importsBusy, priorTranscriptSection, resetPriorImports } from './external-upload.ts';
import { statusMark } from './marks.ts';
import { type NdUploadArgs, ndPreviewOpen, ndTranscriptPreviewBlock, ndTranscriptUpload, resetNdImport } from './nd-upload.ts';
import { deriveNdMasters, derivePriorMs, isNotreDameCourse, reclassifyNotreDameCourses } from './prior-nd.ts';
import { isEarlyStartCourse } from '../engine/early-start.ts';
import { applyDeciderRule, applyFirstMentionRule } from './first-mention.ts';
import { labelCitationsIn } from './citations.ts';
import { canonicalUniversityName, knownUniversities } from './university-name.ts';
import { confirmDialog, copyDialog, openModal, returnFocusTo } from './copy-dialog.ts';
import { plural } from './email-html.ts';
import { EXAMPLE_ATTESTATIONS, EXAMPLE_MILESTONES, exampleFor } from './example.ts';
import { policyFold, rareFold, clearInvalid, errorLine, field, fieldset, labelWrap, markInvalid, radios } from './form-helpers.ts';
import { sectionRef } from './section-ref.ts';
import { createFocusKeeper } from './focus-keeper.ts';
import { type RefusedValues, applyRefusals, rangedNumber } from './refusals.ts';
import { createToasts } from './toasts.ts';
import { gradAdminRequest, processingItems } from './grad-admin-request.ts';
import { priorStudyLabel, programHistory } from './program-history.ts';
import { FILL_IN_STEP, unofficialTranscriptNote } from './email-html.ts';
import { advisorSummary } from './advisor-summary.ts';
import { renderReport, renderSummary, reqAnchorId, scoreLine } from './report.ts';
import { courseworkSentence, nearestDeadline, nextSteps } from './next-steps.ts';
import { sheetSourceLine, sheetSourceNote } from './sheet-source.ts';
import {
  type Refusal,
  SEASONS,
  clearLocal,
  downloadJson,
  emptyStudent,
  exportFile,
  loadLocal,
  saveLocal,
} from './state.ts';

// (The §4.4.1 core-title keywords moved to src/engine/core-title.ts on
// 2026-09-04 so the classifier and the import preview share them.)


/** The three semesters as <option>s for a season dropdown, `selected` marked. */
function seasonOptions(selected?: Season): HTMLOptionElement[] {
  return SEASONS.map((se) => option(se, se[0]!.toUpperCase() + se.slice(1), selected === se));
}
/** The ENTRY term's seasons: fall and spring only (DGS 2026-10-03 — "Admissions
 * happen in Spring and Fall only"); a summer start is an early start whose
 * official matriculation is that fall, and state.ts reads a stored summer as
 * the fall. */
function entrySeasonOptions(selected?: Season): HTMLOptionElement[] {
  return (['fall', 'spring'] as const).map((se) => option(se, se[0]!.toUpperCase() + se.slice(1), (selected === 'summer' ? 'fall' : selected) === se));
}
/** How a grade reads in the dropdown and the table (I and W since 2026-10-03). */
function gradeLabel(g: string): string {
  return g === 'IP' ? 'In progress' : g === 'I' ? 'I (incomplete)' : g === 'W' ? 'W (withdrawn)' : g === 'V' ? 'V (audit)' : g;
}

// Simulation mode (DGS 2026-10-09: "no DGS request, grad admin request, or
// advisor report should be possible"; D6/D7): the reasons the inactive
// buttons give on hover and click. The imports' reason is dom.ts's
// SIMULATION_IMPORT_NOTE, shared with the two upload modules.
/** "Load example" in the mode. */
const SIMULATION_EXAMPLE_NOTE = 'Not available in simulation mode — the example is a record of its own. Exit the simulation to load it.';
/** The three things that send: "the review request", "the processing
 * request", "the summary to your advisor". */
const simulationSendNote = (what: string): string => `Not available in simulation mode — nothing is sent from a plan. Exit the simulation to send ${what} from your record.`;

/** A §4.4.2 group's short name (short-names.ts) from its code, or the code
 * itself when the Categories tab does not define it. */
function groupShortName(rules: Rules, code: string): string {
  return shortName(rules.categoryGroups.find((x) => x.code === code)?.name ?? code);
}


/** The §4.4.2 groups a course may satisfy, in the Categories tab's own order
 * (DGS 2026-09-08 — a sheet cell may name one group, several, or `any`).
 * Empty when the course is ineligible or the DGS has not said. */
function groupsOf(rule: { categoryGroups?: string[] }, rules: Rules): string[] {
  const listed = rule.categoryGroups;
  if (!listed || listed.length === 0) return [];
  // In the Categories tab's own order, and only groups it actually defines —
  // a course listed everywhere names all five (the `any` keyword was retired
  // on 2026-09-18).
  const all = rules.categoryGroups.map((g) => g.code);
  return all.filter((g) => listed.includes(g));
}


/** Whether every course shows its "Counts toward" links (session-only, 2026-09-27). */
let showFeeds = false;

export function startApp(root: HTMLElement, rules: Rules, today: NotreDameNow): void {
  // Sheet-driven contacts (2026-09-04): must run before ANYTHING renders —
  // the consent notice below already shows the DGS's name and address.
  applyContactOverrides(rules.parameters);
  /** What a saved record on this device carried that the app will not keep
   * (R1, 2026-09-18) — shown once the page is up, and put back in the field
   * it came from, so a figure that vanished is never unexplained. */
  const loadRefusals: Refusal[] = [];
  const saved = loadLocal(loadRefusals);
  // Simulation mode (DGS 2026-10-09; src/ui/simulation.ts): a stored
  // simulation means the student left the page in the mode, so it reopens in
  // it — the planning copy is the page's record, the real record stays in
  // memory (realStudent) and in its own storage key, untouched. A simulated
  // semester that has since become the past is lifted to the real one.
  const simulationRefusals: Refusal[] = [];
  let simulation: Simulation | undefined = loadSimulation(simulationRefusals);
  if (simulation) simulation.term = clampSimulationTerm(simulation.term, today.iso);
  /** The real record while the mode is on — what Exit puts back. Undefined
   * when no record was ever saved on this device. */
  let realStudent: Student | undefined = saved;
  let student: Student = simulation?.student ?? saved ?? emptyStudent();
  /** The refusals of the record the page shows: the simulation's own when the
   * page opens in the mode (D11). */
  const activeRefusals = simulation ? simulationRefusals : loadRefusals;
  // Department-approval gate (DGS request, 2026-09-03): shown on EVERY visit
  // until the student clicks Agree — the tool is under testing and not yet
  // approved by the department. Nothing is stored about the click.
  // A native <dialog> shown with showModal() (usability review 2026-09-05,
  // item 3): focus moves into it, Tab stays inside, the page behind is inert,
  // Escape dismisses it like Agree, and focus returns to the page when it
  // closes — the ARIA dialog pattern, which the old overlay div did not follow.
  // "I understand — continue" rather than "Agree" (usability review 2026-09-05,
  // item 9): the notice is informational, not a consent; nothing is stored.
  // The dialog is built by a function (2026-09-22) so that Reset can show it
  // again for the emptied record: program and earlier degrees are chosen
  // there and nowhere else.
  const openOpeningDialog = (prefill: Student | undefined): void => {
  // "Continue" (DGS 2026-09-29): the acknowledgement is a tick box INSIDE the
  // notice it acknowledges — "I understand — continue" at the foot of the
  // dialog read as the answer to the questions, not to the warning above them.
  const agreeButton = el('button', { class: 'btn primary', autofocus: true }, 'Continue');
  const ack = el('input', { type: 'checkbox', 'data-key': 'consent.ack', onchange: () => gate() }) as HTMLInputElement;
  // The program choice lives here (blue-team B2, 2026-09-18). It used to be a
  // SILENT default — emptyStudent() says `program: 'phd'` and nothing asked —
  // so an MSCSE student who missed the segmented control at the top read
  // seventeen Ph.D. checks (dissertation readers, the OCE, the eight-year
  // limit) and a footer saying 0 of 17 met. This dialog is already a forced
  // interaction on every visit; asking here removes the whole failure class.
  // A returning student's answer is pre-selected, so it stays one click.
  // Option rows like the questions below them (DGS 2026-09-29): a bold head
  // and the handbook chapter as the lighter line.
  const programRadios = el('div', { class: 'choices consent-program' });
  let chosenProgram: Program | undefined = prefill?.program;
  for (const [value, head, sub] of [
    ['phd', 'Ph.D. in Computer Science and Engineering', 'Handbook §4'],
    ['mscse', 'M.S. in Computer Science and Engineering (MSCSE)', 'Handbook §3'],
  ] as [Program, string, string][]) {
    programRadios.append(
      choiceRow({
        name: 'consent-program',
        value,
        head,
        sub,
        dataKey: `consent.program.${value}`,
        checked: prefill?.program === value,
        onChange: () => {
          chosenProgram = value;
          gate();
        },
      }),
    );
  }
  // Nothing is pre-selected for a student with no record on this device, and
  // the button stays inactive until they answer — the report must not render
  // against a program nobody chose.
  // Only the program is asked here since 2026-10-08 (DGS, Option 1: "ask only
  // the program up front"). The earlier-degrees questions, asked here from
  // 2026-09-22 (and forced on 2026-09-23), are read from the imported
  // transcripts where they can be and asked on the page — in the Transcripts
  // card — for the rest (src/ui/background-read.ts).
  const answered = (): boolean => chosenProgram !== undefined;
  const isReady = (): boolean => ack.checked && answered();
  // Why the button waits, said beside it (DGS 2026-09-29: a grey button with
  // no reason was the dialog's last line) — the tick, the questions, or both.
  const hint = el('span', { class: 'consent-hint' });
  const gate = (): void => {
    if (isReady()) agreeButton.removeAttribute('disabled');
    else agreeButton.setAttribute('disabled', 'disabled');
    // DGS 2026-09-30: say that the notice at the top must be acknowledged.
    hint.textContent =
      !ack.checked && !answered()
        ? 'To continue, acknowledge the notice at the top by checking its box, and choose your degree.'
        : !ack.checked
          ? 'To continue, acknowledge the notice at the top by checking its box.'
          : 'Choose your degree above to continue.';
    hint.hidden = isReady();
  };
  gate();
  const consentDialog = el(
    'dialog',
    { class: 'consent consent-overlay', 'aria-labelledby': 'consent-title' },
    el(
      'div',
      { class: 'consent-box' },
      el('h2', { id: 'consent-title' }, 'Before you continue'),
      // In red (DGS 2026-09-22): the one sentence a tester must not miss —
      // with the acknowledgement it asks for right under it (DGS 2026-09-29).
      el(
        'div',
        { class: 'consent-warning' },
        el('p', {}, 'This tool has not been approved by the department yet. It is for testing and informational purposes only.'),
        el('label', { class: 'consent-ack' }, ack, el('span', {}, 'I understand — this tool is under testing and not yet approved by the department.')),
      ),
      // Open invitation for feedback (DGS wording, 2026-09-05). The coverage
      // caveat (COVERAGE_NOTICE) was shown here from 2026-09-05 until the DGS had
      // it removed from this notice later the same day; it still ends the alpha
      // banner, the footer and the copied summary via BETA_SCOPE_NOTICE.
      el(
        'p',
        {},
        `Any error report, suggestion, or feedback is welcome — please contact the DGS (Prof. ${DGS.name}, `,
        mailto(DGS.email),
        ').',
      ),
      el('fieldset', { class: 'field group step consent-program-group' }, el('legend', { class: 'step-title' }, 'Which degree are you working toward?'), programRadios),
      el('div', { class: 'consent-actions' }, agreeButton, hint),
    ),
  );
  // The page behind the opening dialog is hidden until it closes (DGS
  // 2026-09-23): a half-read report under a modal invited reading the wrong
  // program's results. The class goes on <html> so the backdrop still covers
  // the viewport.
  document.documentElement.classList.add('opening-dialog');
  // Only the button closes the notice (DGS 2026-09-23: Escape must not). Set
  // once the button has done its work, so the `close` event that follows is
  // not mistaken for an attempt to dismiss it.
  let finished = false;
  const closeConsent = (): void => {
    if (finished) return;
    finished = true;
    document.documentElement.classList.remove('opening-dialog');
    // The answer takes effect BEFORE the dialog goes, so that by the time
    // anything can observe the notice gone, the page behind it already shows
    // the chosen program — otherwise a script (or a fast reader) can act on a
    // page that is about to re-render underneath them.
    const programChanged = chosenProgram !== undefined && chosenProgram !== student.program;
    // A saved answer missing a follow-up asked since it was given (the 4+1
    // question, "finished", "also elsewhere") was completed here while this
    // dialog asked the earlier degrees (2026-09-23 to 2026-10-07); now it
    // goes back to a draft and is asked on the page (policy review of Option
    // 1, 2026-10-08).
    const incomplete = student.background !== undefined && completeBackground(student.background, chosenProgram ?? student.program) === undefined;
    if (programChanged || incomplete) {
      update((s) => {
        if (programChanged) s.program = chosenProgram!;
        // An earlier-degrees answer that does not fit the new program (the
        // MSCSE cannot already hold the MSCSE) goes back to being a draft,
        // asked again on the page; one that fits is re-applied for it.
        if (s.background !== undefined) {
          const fits = completeBackground(s.background, s.program);
          if (fits) applyBackground(s, fits);
          else withdrawBackground(s, draftForProgram(s.background, s.program));
        } else if (s.backgroundDraft !== undefined) {
          // A draft keeps what still applies; complete or not, the student
          // confirms it on the page (review of Option 1, 2026-10-08).
          const d = draftForProgram(s.backgroundDraft, s.program);
          s.backgroundDraft = Object.keys(d).length > 0 ? d : undefined;
          pruneRead(s, d);
          reconcileInferences(s);
        }
      });
    }
    if (consentDialog.open) consentDialog.close();
    consentDialog.remove();
    returnFocusTo();
    // Say why the questions are back (coverage review, 2026-10-08).
    if (incomplete && !programChanged) toast('A question about your earlier degrees was added since you answered them — answer it in the Transcripts card.');
  };
  agreeButton.addEventListener('click', closeConsent);
  // Escape never closes it (DGS 2026-09-23; until then it closed the notice
  // once every family was answered). Three layers, because browsers differ:
  // the keydown is cancelled, which stops the close request where the HTML
  // spec's close-watcher rules apply; the `cancel` event is cancelled; and
  // Chrome, which lets a second Escape close a dialog whose `cancel` was
  // refused, finds the notice opened again straight away.
  consentDialog.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') e.preventDefault();
    // Enter continues once the button is live (DGS 2026-10-04: "let an Enter
    // key pressed by the user click the Continue button"), wherever the focus
    // is in the notice — the tick box just ticked, a choice — except where
    // Enter already does something of its own: a link (the DGS's address), a
    // button (Continue itself clicks natively), a drop-down or a text area.
    // Not while an input method is composing, nor with a modifier held.
    if (e.key !== 'Enter' || e.isComposing || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
    const target = e.target as HTMLElement;
    if (target.closest('a, button, select, textarea, summary')) return;
    // A typed value (the year of a transfer) is taken first: leaving the box
    // fires its change, which records the answer — so Continue never goes
    // on with the value from before the edit, and goes on only if every
    // answer is still complete.
    if (target instanceof HTMLInputElement && target.type !== 'checkbox' && target.type !== 'radio') {
      target.blur();
      if (!isReady()) {
        target.focus();
        return;
      }
    }
    if (!isReady()) return;
    e.preventDefault();
    agreeButton.click();
  });
  consentDialog.addEventListener('cancel', (e) => e.preventDefault());
  consentDialog.addEventListener('close', () => {
    if (finished || !consentDialog.isConnected) return;
    if (openModal(consentDialog)) (consentDialog.querySelector<HTMLElement>('input:checked') ?? agreeButton).focus();
  });
  labelCitationsIn(consentDialog); // outside the root: "CSE Handbook §4" on the program choices (DGS 2026-10-03)
  document.body.append(consentDialog);
  placeInFrame(consentDialog); // embed mode: at the top of the frame, not the middle of a tall page (DGS 2026-09-16)
  // Focus the first thing to answer while the button is inactive (it used to
  // fall through to the DGS's email link).
  if (openModal(consentDialog)) (agreeButton.hasAttribute('disabled') ? consentDialog.querySelector<HTMLElement>('input[type=radio]') ?? agreeButton : agreeButton).focus();
  };
  // Prefilled from the ACTIVE record — the simulation's when the page opens in
  // the mode (D11), the saved record otherwise.
  openOpeningDialog(simulation?.student ?? saved);

  // Established on the loading card (DGS 2026-09-07): the date at Notre Dame,
  // from the server this page came from when it answers, and read in Notre
  // Dame's own zone either way — never the device's idea of the calendar.
  const realTodayIso = today.iso;
  /** The date the AUDIT runs against: the real one, or in simulation mode the
   * simulated semester's (simulationToday — the real date while the simulated
   * semester is the real one, else its first day). The transcript's empty
   * semesters (transcriptGapSemesters — a question about the transcript), the
   * rules' date, the print header's "printed on" and a saved file's savedAt
   * keep the real date. The registration-gap question (uncoveredRegistrationGaps)
   * follows the engine, which only ever sees this date: in the mode a plan
   * that leaves a fall or spring unregistered is warned about, and the fold
   * the warning points at opens off the same date (review fix 2026-10-09). */
  const todayIso = (): string => (simulation ? simulationToday(simulation.term, realTodayIso) : realTodayIso);
  // No default (policy review 2026-10-03, P1-residency-enrollment-c7): with
  // the Parameters row missing the residency rows cannot be evaluated, and
  // the Full-time terms list says so instead of counting from a built-in 9.
  const fullTimeFloor = rules.parameters.number('fulltime_credits_min');
  // The universities the ExternalCourses and Universities tabs know, for both University
  // boxes (manual course form, previous-transcript preview) — one
  // datalist per page (2026-09-06 evening). Built once, like the course list
  // below: both depend on the rules alone, and render() re-attaches the same
  // nodes on every rebuild.
  // What every result on this page was checked with (DGS 2026-10-11, item 8):
  // the rules' fingerprint, live or saved copy and date, the handbook's
  // edition and this build. The rules are read once, so it is made once.
  const stamp = resultStamp(rules);
  const knownUniversitiesList = el('datalist', { id: 'known-universities' }, ...knownUniversities(rules.external, rules.universities).map((u) => el('option', { value: u })));
  const knownCoursesList = el('datalist', { id: 'known-courses' });
  for (const [id, rows] of rules.courses) {
    const row = rows[rows.length - 1]!;
    if (!row.active) continue;
    const opt = el('option', { value: id });
    opt.label = `${id} — ${row.title}`;
    knownCoursesList.append(opt);
  }
  /** §4.4.2 group suggestions for this render (2026-09-08): course id → the
   * groups the student's other courses do not cover. Set in render(), read by
   * the coursework table, which is built later in the same pass. */
  let groupChoices: Record<string, string[]> = {};

  /** The ONE place the record is saved (D1): in simulation mode the planning
   * copy goes under its own key and the real record is never written; outside
   * it, the record itself. Every save in this file goes through here — this
   * is the only call to state.ts's saver — so no path can turn a plan into
   * the real record (D2). */
  const persist = (): void => {
    if (simulation) {
      simulation.student = student;
      saveSimulation(simulation);
    } else {
      saveLocal(student);
    }
  };

  const update = (mutate: (s: Student) => void): void => {
    mutate(student);
    persist();
    render();
  };

  // Numbers the form refuses (interface review R1, 2026-09-18) — refusals.ts.
  // The map lives here because render() rebuilds the page from the record on
  // every change: the refused text and its sentence are put back by `data-key`.
  const refusedValues: RefusedValues = new Map();

  // The focus keeper (focus-keeper.ts): render() rebuilds the whole root, so
  // it remembers which control had focus before and restores it after.
  const { remember: rememberFocus, restore: restoreFocus, setFocusAfterRender } = createFocusKeeper(root);
  // The toast stack (toasts.ts), created once outside the root.
  const { toast, notice, cancelUndo, toastWithAction } = createToasts(setFocusAfterRender);
  let lastHeadline = '';
  /** Watches the two score headlines for the sticky bar (P-66); one per render. */
  let scoreObserver: IntersectionObserver | undefined;
  /** A visually hidden polite live region, created once OUTSIDE the root so
   * the rebuild never re-creates it (a re-created region is not announced):
   * screen-reader users hear the new headline after each change. */
  const srStatus = el('div', { class: 'visually-hidden', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });
  document.body.append(srStatus);

  /** The footer's disclosure ("Where the rules come from"; "What is still
   * being tested" went with P-3, 2026-09-19) prints OPEN and return to what the student had (trim
   * review 2026-09-18, P-71): closed, they printed as two bare headings.
   * The report's folds ("Relevant Policies", "Courses counted", the track
   * notes) print as the student left them on screen (DGS 2026-10-10: "Let
   * paper match the screen") — a closed one as its heading only, in every
   * browser; style.css keeps Firefox, which printed them open, to that.
   * Only the ones this handler opened are closed again; restoreFocus reads
   * the open state from the DOM, so a later re-render keeps the screen state. */
  window.addEventListener('beforeprint', () => {
    document.querySelectorAll<HTMLDetailsElement>('footer.legal details:not([open])').forEach((d) => {
      d.dataset.printOpened = '';
      d.open = true;
    });
  });
  window.addEventListener('afterprint', () => {
    document.querySelectorAll<HTMLDetailsElement>('details[data-print-opened]').forEach((d) => {
      d.open = false;
      delete d.dataset.printOpened;
    });
  });

  /** The sticky score bar (phones, ≤900 px) says what the score headline
   * says; while either headline — the phone summary's at the top or the
   * report's — is on screen, the bar is hidden (`.score-on-screen`,
   * style.css) and it returns as soon as the score scrolls off (trim review
   * 2026-09-18, P-66). The HEADLINES are watched, not the blocks: the summary
   * block's meters and jump link are often on screen after its score line
   * has gone. The previous render's observer is dropped with its nodes. */
  function watchScoreHeadlines(): void {
    scoreObserver?.disconnect();
    scoreObserver = undefined;
    const bar = root.querySelector<HTMLElement>('.sticky-score');
    const headlines = [...root.querySelectorAll<HTMLElement>('.summary-mobile .headline, .audit .scorehead .headline')];
    if (!bar || headlines.length === 0 || typeof IntersectionObserver === 'undefined') return;
    const onScreen = new Set<Element>();
    scoreObserver = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) onScreen.add(e.target);
        else onScreen.delete(e.target);
      }
      bar.classList.toggle('score-on-screen', onScreen.size > 0);
    });
    for (const h of headlines) scoreObserver.observe(h);
  }

  /** The two floating boxes stack: Next steps sits above the warnings box
   * (DGS 2026-10-08), so the warnings box's height — folded or open — is a
   * CSS variable the Next steps box offsets by. The Next steps box's own
   * height is one too: the page leaves room for both at its end, so they
   * never sit over the footer's last lines (cross-browser review,
   * 2026-10-10). Read after every render, when either box is folded or
   * unfolded, and when the window resizes. */
  function layoutFloats(): void {
    const warnings = root.querySelector<HTMLElement>('.warnings.floating');
    const steps = root.querySelector<HTMLElement>('.attention.floating');
    document.documentElement.style.setProperty('--float-warnings', warnings ? `${warnings.offsetHeight + 8}px` : '0px');
    document.documentElement.style.setProperty('--float-steps', steps ? `${steps.offsetHeight + 8}px` : '0px');
  }
  window.addEventListener('resize', layoutFloats);

  /** Choices the page makes for the student (DGS 2026-09-12): whenever the
   * record itself shows the best answer, fill it in, say so in a toast, and
   * leave the control for the student to change. Only an UNSET choice is
   * filled, so a student's own pick is never overwritten. Returns the notices
   * to show — a non-empty list means the record changed and must be re-audited. */
  function autoSelect(report: ReturnType<typeof audit>): string[] {
    const notices: string[] = [];
    if (student.program === 'mscse' && (student.msOption ?? 'undecided') === 'undecided') {
      const inferred = inferMsOption(student);
      if (inferred) {
        student.msOption = inferred;
        notices.push(
          inferred === 'project'
            ? 'Project or thesis option set to “M.S. project” from your record (a Master’s project course or an accepted project report). Change it under Milestones if that is wrong.'
            : 'Project or thesis option set to “M.S. thesis” from your record (thesis direction or a defense). Change it under Milestones if that is wrong.',
        );
      }
    }
    // 4+1 read off the transcript (F7, 2026-09-12): Notre Dame coursework
    // registered at the GRADUATE level yet dated inside the bachelor's degree
    // is the Integrated program's signature — a regular bachelor's registers
    // its 60000-level electives as undergraduate rows.
    // Not against a partial answer that already settles it (2026-10-08): a
    // "No" to the 4+1, or a bachelor's that is not Notre Dame CSE's.
    const draft = student.backgroundDraft;
    const draftSettles4plus1 = draft?.ndIntegrated !== undefined || (draft?.bachelors !== undefined && draft.bachelors !== 'nd-cse');
    if (student.background === undefined && !draftSettles4plus1 && student.integratedBsMs === undefined && student.bachelorsAwarded !== undefined) {
      const signature = student.courses.find(
        (c) => isNotreDameCourse(c) && c.registeredLevel === 'graduate' && termIndex(c.term) <= termIndex(student.bachelorsAwarded!),
      );
      if (signature) {
        student.integratedBsMs = true;
        student.integratedBsMsInferred = { how: `your Notre Dame transcript, which registers ${signature.courseId} at the graduate level inside your bachelor’s degree` };
        // …and the 4+1 question on the page shows it, read and marked (UI
        // review, 2026-10-08: the record said Yes while the question showed
        // neither answer).
        mergeReading(student, { answer: { ndIntegrated: true }, how: { ndIntegrated: `your Notre Dame transcript registers ${signature.courseId} at the graduate level inside your bachelor’s degree` }, source: 'nd' });
        notices.push('Your transcript shows the Integrated B.S. + M.S. (4+1): it registers graduate-level coursework inside your bachelor’s degree. Check the answer in the earlier-degrees questions in the Transcripts card.');
      }
    }
    if (student.program === 'phd') {
      const best = report.requirements.find((r) => r.id === 'phd.qualifier.categories')?.groupAssignments ?? {};
      const filled: string[] = [];
      for (const c of student.courses) {
        const group = best[c.courseId];
        if (!group || c.assignedGroup) continue;
        c.assignedGroup = group as CourseEntry['assignedGroup'];
        filled.push(`${c.courseId} → ${groupShortName(rules, group)}`);
      }
      if (filled.length > 0) {
        notices.push(
          `Specialization group chosen automatically to cover the most distinct groups (§4.4.2): ${filled.join('; ')}. You can change it next to the course.`,
        );
      }
    }
    return notices;
  }

  // The Who-to-contact card lives in one of two places by width, as on the
  // course rules page (DGS 2026-09-30: "move the contacts to the top right
  // corner, just like in the course rule page"): the masthead's right-hand
  // column from 900 px up, the end of the page below that and in the frame.
  // Two empty hosts, one node moved between them — one card in the document,
  // no duplicate heading. (B1 of 2026-09-18 had put it at the end in every
  // mode; the DGS wants it back at the top on a desk.)
  const contactHost = el('div', { class: 'contact-host' });
  const mainContactHost = el('div', { class: 'contact-host' });
  const contactNode = contactCard();
  // Moved only when its host changes: re-inserting the card drops keyboard
  // focus from a link inside it (which every print did, review 2026-10-10).
  const placeContact = (wide: boolean): void => {
    const host = wide && !isEmbedded() ? contactHost : mainContactHost;
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

  function render(): void {
    const memo = rememberFocus();
    markSimulationMode(); // the <html> class and the tab title follow the mode and its semester
    let report = audit(student, rules, todayIso());
    const autoNotices = autoSelect(report);
    if (autoNotices.length > 0) {
      persist();
      report = audit(student, rules, todayIso());
      notice(autoNotices.join(' '));
    }
    // Nothing entered yet: the report describes the degree, not the student
    // (2026-09-08). Every row would otherwise read "Not yet" as if the student
    // had failed thirteen checks they have not been asked about.
    const untouched =
      student.courses.length === 0 && Object.keys(student.milestones).length === 0 && student.gpa === undefined;
    groupChoices = report.requirements.find((r) => r.id === 'phd.qualifier.categories')?.groupChoices ?? {};
    // The engine's classification of the record, once per render: the review
    // card, the milestones card and the Grad Admin request all read it.
    const { classified } = classify(student, rules);
    // The Grad Admin request, built once per render (efficiency, 2026-10-07):
    // the next-steps list counts its items, and the Grad Admin card shows and
    // copies it. Its count comes from processingItems, which `history` does
    // not touch, so this one call (the card's, with history) serves both.
    const gaRequest = gradAdminRequest(report, student, rules, { todayIso: todayIso(), entryTerm: termLabel(student.entryTerm), priorStudy: priorStudyLabel(student), gpa: student.gpa, history: programHistory(student), stamp: checkedWithLine(stamp) }, classified);
    // What the record calls for next (DGS 2026-09-27): read once here, drawn
    // under the dial, in the phone summary and as the numbered list.
    // The courses waiting for the STUDENT's answer, not the DGS (UI review,
    // 2026-10-08): which degrees they already counted toward.
    const needsAnswer = student.courses.filter((c) => c.countedToward === undefined && asksWhichDegrees(c, student, rules)).map((c) => c.courseId);
    const next = {
      sentence: courseworkSentence(report, needsAnswer),
      steps: nextSteps({
        report,
        student,
        needsAnswer,
        review: (() => {
          const pending = coursesNeedingDgsReviewFor(classified, student);
          return { unlisted: pending.filter((p) => p.unlisted).length, caseByCase: pending.filter((p) => !p.unlisted).length, earlierOnly: pending.length > 0 && pending.every((p) => p.kind !== 'nd') };
        })(),
        processingCount: gaRequest.items.count,
        simulation: simulation !== undefined, // the sending steps fold into one "nothing is sent" step (D7)
      }),
      nearest: nearestDeadline(report),
    };
    clear(root);
    root.append(
      // Landmarks + a skip link (usability review 2026-09-05, item 7): header
      // → main (notices, inputs, report, footer); the skip link jumps a
      // keyboard user straight to the report.
      el('a', { class: 'skip-link', href: '#report' }, 'Skip to the report'),
      masthead(report),
      el(
        'main',
        { id: 'main' },
        el(
          'p',
          { class: 'print-header' },
          // In simulation mode the printed page says so first, with the real
          // date it was printed on and the semester it pretends to be in (D10).
          simulation
            ? `SIMULATION — not your real record. Printed on ${realTodayIso}; the current semester in this simulation is ${termLabel(simulation.term)} — ${student.program === 'mscse' ? 'M.S. in CSE (§3)' : 'Ph.D. (§4)'}, entered ${termLabel(student.entryTerm)} — not an official audit; the DGS decides eligibility, the Grad Admin processes it.`
            : `Self-check printed on ${realTodayIso} — ${student.program === 'mscse' ? 'M.S. in CSE (§3)' : 'Ph.D. (§4)'}, entered ${termLabel(student.entryTerm)} — not an official audit; the DGS decides eligibility, the Grad Admin processes it.`, // "decides", as everywhere else (trim review 2026-09-18, P-60); the real date even in simulation mode (D5)
          // What the printout was checked with (item 8, 2026-10-11) — its own line.
          el('span', { class: 'print-stamp' }, checkedWithLine(stamp)),
        ),
        // Simulation mode's banner (DGS 2026-10-09): first thing in <main>, so
        // that nothing on the page can be read as the student's record while
        // the mode is on.
        simulationBanner(),
        simulationStrip(),
        // The example is saved like any other record, so say whose it is until
        // the student takes it back (2026-09-08). What it says is counted from
        // the rows themselves (R5, 2026-09-18): "Nothing here came from you"
        // was sticky, so a student who loaded the example and then added one
        // real course was told none of it was theirs — and offered a button
        // that would have cleared their course along with the demo.
        exampleBanner(),
        noticeStrip(),
        knownUniversitiesList,
        rules.source === 'snapshot' ? snapshotBanner() : null,
        // Phones and small tablets (2026-09-05, review item 2): the result
        // first, then the inputs, then the full report — plus a sticky score
        // bar with jump links (both hidden on wide screens by CSS).
        // On a narrow screen the report's summary sits ABOVE the inputs, which
        // is right once there is something to summarise — and 252 px of
        // "Getting started" between the student and the first control when
        // there is not (blue-team B1, 2026-09-18). An untouched record shows it
        // at the bottom with the rest of the report instead.
        untouched ? null : renderSummary(report, next),
        el(
          'div',
          { class: 'layout' },
          el(
            'div',
            { class: 'inputs', id: 'inputs' },
            transcriptsCard(),
            standingCard(classified),
            coursesCard(report.courseLines),
            askDgsCard(classified, report),
            milestonesCard(classified, report),
            askGradAdminCard(gaRequest),
            saveCard(report),
            diagnosticsCard(),
          ),
          el(
            'div',
            { class: 'audit-col', id: 'report', tabindex: '-1', 'aria-label': 'Your report' },
            // The report's own heading, for screen readers (UI review, 2026-10-08).
            el('h2', { class: 'visually-hidden' }, 'Your report'),
            // The warnings live inside the report since 2026-09-27, folded
            // under the meters (report.ts).
            renderReport(report, untouched, next),
            // The finish card that stood here (R7, 2026-09-18: Reset at the
            // end for a shared machine) repeated the storage card's sentence
            // and its Save button; the DGS removed it on 2026-09-22 — Reset
            // sits in the storage card next to Print, and the advisor summary
            // button in the tools row at the top.
          ),
          // The footer is the layout grid's third child (DGS 2026-09-19): on a
          // wide screen it sits under the inputs column, in the space the
          // longer report column used to leave empty; on a phone the single
          // column keeps it last. Inside <main> it is no longer a contentinfo
          // landmark — a deliberate trade for the placement.
          footer(),
        ),
        el(
          'nav',
          { class: 'sticky-score', 'aria-label': 'Your score, and jumps between inputs and report' },
          // On a phone the mode is said HERE, in the one fixed bar the page
          // already has (D9) — a second fixed strip would eat the small screen.
          el('span', { class: 'sticky-text' }, simulation ? el('span', { class: 'sticky-sim' }, `Simulation · ${termLabel(simulation.term)}`) : null, simulation ? ' — ' : null, scoreLine(report)),
          el('a', { href: '#inputs' }, 'Inputs ↑'),
          el('a', { href: '#report' }, 'Report ↓'),
        ),
      ),
    );
    // The mode is repeated beside the report's headline (and in each request
    // card, where those are built) in every mode (review fix 2026-10-09): on a
    // phone the sticky score bar — the one marker that follows the student —
    // hides while a score headline is on screen, so the headline itself must
    // carry the mode; in the frame, which has no strip and no bar, likewise.
    // The headline is report.ts's; the chip is added here, after the fact,
    // like the first-mention rule — on EVERY headline the bar watches
    // (watchScoreHeadlines' selector): on a phone the report's own scorehead
    // is hidden (style.css) and the summary copy at the top of the page is the
    // headline on screen, so the chip on the report's alone left the phone
    // without a marker (closing e2e, 2026-10-09).
    if (simulation) for (const h of root.querySelectorAll('.summary-mobile .headline, .audit .scorehead .headline')) h.append(' ', simulationChip()!);
    // "Oral Candidacy Exam (OCE)" in full once, then "OCE" (DGS 2026-09-06
    // evening) — text nodes only, in document order, before focus is restored.
    applyFirstMentionRule(root);
    applyDeciderRule(root, student.program); // DGS → ADGS for an MSCSE student (2026-09-11)
    labelCitationsIn(root); // "CSE §4.2" — which document a section is from (DGS 2026-10-03)
    watchScoreHeadlines();
    layoutFloats();
    root.querySelector('.warnings.floating .warnings-toggle')?.addEventListener('click', () => requestAnimationFrame(layoutFloats));
    root.querySelector('.attention.floating .attention-toggle')?.addEventListener('click', () => requestAnimationFrame(layoutFloats));
    restoreFocus(memo);
    // Announce the recomputed result to screen readers — only when it changed,
    // so a keystroke in a title field does not chatter.
    const headline = root.querySelector('.scorehead .headline')?.textContent?.trim() ?? '';
    if (headline && headline !== lastHeadline) {
      if (lastHeadline !== '') srStatus.textContent = `Report updated: ${headline}.`;
      lastHeadline = headline;
    }
  }

  // ---------- masthead ----------

  function masthead(report: ReturnType<typeof audit>): HTMLElement {
    // The two program buttons expose their pressed state (item 5): a screen
    // reader says "M.S. in CSE §3, toggle button, pressed".
    // The program tabs are gone (DGS 2026-09-22): the degree is chosen in the
    // opening dialog, and Reset brings that dialog back.
    // Embedded (?embed=1), the host page already carries the ND masthead and
    // its own heading: the gold eyebrow goes and the <h1> stays only for screen
    // readers and the document outline (DGS 2026-09-16, same treatment as the
    // course-rules page). Everything else — the tabs, the tools, the notices,
    // the whole FERPA footer — stays exactly as it is.
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
        el('h1', embed ? { tabindex: '-1', class: 'visually-hidden' } : { tabindex: '-1' }, 'Graduate Degree Requirement Simulation Tool'),
        // Embedded, the WordPress page carries its own introduction: none of
        // the masthead text is shown (DGS 2026-09-16, "get rid of the texts at
        // the top"). The storage warning below stays — it is a safety note.
        ...(embed
          ? []
          : [
              el(
                'p',
                { class: 'sub' },
                // No "enter your coursework" above the card that imports it;
                // four lines instead of six at 390 px (trim review 2026-09-18, P-25).
                'See where you stand, requirement by requirement, against the ',
                handbookLink(),
                // Which document a section is from, once (DGS 2026-10-03); the
                // embedded page carries the same key in the report's glossary.
                '; every check cites its section (CSE § is that handbook; Academic Code § and DGS Handbook § are the Graduate School’s). The courses that count are on the ',
                el('a', siblingAnchorAttrs('course-rules', window.location.search, isEmbedded()), 'course rules page'),
                '.',
              ),
              el('p', { class: 'effective' }, rulesDateLine(rules, termLabel(termOfDate(realTodayIso)), realTodayIso)), // the rules' date is a fact about the sheet: real even in simulation mode (D5)
              // The rules spreadsheet, linked with its faculty-only note (DGS, 2026-09-04).
              sheetSourceLine(),
            ]),
        // Framed, this tool is saving into the FRAME's storage, which is not the
        // same store as the tool opened on its own — and Safari blocks it for an
        // embedded page outright. The work is never lost (the file save always
        // works), but the student has to be told where it is going before they
        // spend an hour on it (DGS 2026-09-16).
        embed
          ? el(
              'p',
              { class: 'banner embed-storage', role: 'note' },
              // 55 words → 30 (embed review 2026-09-19): the fact, the risk,
              // the two ways out — the first thing on the page has to be short.
              el('strong', {}, 'This is the tool inside another page. '),
              'Your entries may not be here when you come back (Safari saves nothing for an embedded page). Use ',
              el('strong', {}, '“Save to a file”'), // the button's label since 2026-09-03 (trim review 2026-09-18, P-62)
              ', or ',
              openFullPageLink('open the full page'),
              '.',
            )
          : null,
      ),
      // The Who-to-contact card's desk-width host (DGS 2026-09-30) — the
      // masthead's right-hand column, as on the course rules page. Below
      // 900 px and in the frame the card is at the end of the page instead
      // (B1 of 2026-09-18 kept for those).
      embed ? null : contactHost,
      el(
        'div',
        { class: 'masthead-tools' },
        el('span', { class: 'program-name-wrap' }, el('span', { class: 'program-name' }, student.program === 'mscse' ? 'M.S. in CSE (Handbook §3)' : 'Ph.D. (Handbook §4)'), simulationChip()),
        el(
          'div',
          {},
          // In simulation mode the example stays outside (D6): it is a record
          // of its own, and the mode holds a copy of the student's.
          simulation
            ? inactiveButton({ class: 'btn', 'data-key': 'tools.example' }, SIMULATION_EXAMPLE_NOTE, toast, 'Load example')
            : el('button', { class: 'btn', 'data-key': 'tools.example', onclick: loadExample }, 'Load example'),
          // The storage card's three buttons, here too (DGS 2026-09-24), between
          // Load example and the advisor summary. "Load a file" opens the storage
          // card's own file input, so there is one import path.
          el('button', { class: 'btn', 'data-key': 'tools.save', onclick: saveActiveToFile }, 'Save to a file'),
          el('button', { class: 'btn', 'data-key': 'tools.load', onclick: () => document.querySelector<HTMLInputElement>('[data-key="save.fileinput"]')?.click() }, 'Load a file'),
          el('button', { class: 'btn', 'data-key': 'tools.print', onclick: () => window.print() }, 'Print'),
          // Between Load example and Reset (DGS 2026-09-22); it was at the end
          // of the report from the trim review (P-72) until then.
          advisorSummaryButton(report),
          // Simulation mode (DGS 2026-10-09): the way in, between the advisor
          // summary and Reset; in the mode the same slot holds a second way out.
          simulation ? exitSimulationButton('tools.simulate.exit') : simulateButton('tools.simulate'),
          resetButton('tools.reset'),
        ),
      ),
    );
  }

  /** Two slim strips (DGS 2026-09-19): red for the alpha status, green for
   * privacy — the alpha line and the privacy line, each ONE sentence above
   * the fold (blue-team B1, 2026-09-18 — the first control must stay on the
   * first screen), each with a "Details" expander that holds the full
   * DGS-worded paragraph unchanged; both paragraphs are also in the footer
   * and the copied summary. The privacy strip keeps its place right under
   * the alpha text (DGS placement, 2026-09-03). They were one strip from the
   * usability review (2026-09-05, item 8 — two stacked banners folded into
   * one) until the split. */
  function noticeStrip(): HTMLElement {
    const alphaDetails = el(
      'details',
      { class: 'notice-details', 'data-key': 'notice.details' },
      el('summary', {}, 'Details'),
      el(
        'p',
        { class: 'notice-full beta' },
        el('strong', {}, 'Alpha version under testing. '),
        betaNotice(student.program),
        ' ',
        // The link parenthetical folds into the bold sentence here (trim
        // review 2026-09-18, P-39); the constant keeps its period for the
        // footer and the copied summary, which render in their own order.
        el('strong', {}, RULES_ACCURACY_NOTICE.replace(/\.$/, '')),
        ' (see the ',
        el('a', siblingAnchorAttrs('course-rules', window.location.search, isEmbedded()), 'course rules page'),
        '). ',
        BETA_SCOPE_NOTICE,
        ...reportToDgs(' Error reports, suggestions, and feedback are all welcome — please email'),
      ),
    );
    const privacyDetails = el(
      'details',
      { class: 'notice-details', 'data-key': 'privacy.details' },
      el('summary', {}, 'Details'),
      el(
        'p',
        { class: 'notice-full privacy' },
        el('strong', {}, 'Private by design. '),
        // The DGS's 2026-09-03 sentences plus the OCR clause, closing with the
        // approved W-P1 sentence (2026-09-18) that the save card and footer
        // also use. The five-request tally that used to follow was the
        // measurement behind W-P1 (see PRIVACY_LINE in handbook.ts), not the
        // claim (trim review 2026-09-18, P-7).
        'Everything you enter — and any transcript PDF you import, including the optional text recognition (OCR) of a scanned one — is processed and stored in this browser only. Nothing you enter is uploaded, transmitted, or stored anywhere else. The page itself loads from GitHub and reads the course rules from Google Sheets, so those two services see that someone opened the page; they never see what you enter.',
      ),
    );
    return el(
      'div',
      { class: 'notice-strips' },
      // The notice names the decider for THIS tab (ADGS on the MSCSE tab, DGS
      // on the Ph.D. tab — DGS 2026-09-15) by the same rewrite as the rest of
      // the page; the feedback address is the DGS's own and is kept as is.
      el(
        'div',
        { class: 'banner beta notice-strip', role: 'note' },
        // On the Ph.D. tab the one exception is named (DGS 2026-10-11, item 6;
        // P3-cse-3-2): for the MSCSE along the way the check is the DGS's review.
        el('p', { class: 'notice-line' }, el('strong', {}, 'Alpha — under testing. '), student.program === 'phd' ? 'Informational only, except the MSCSE along the way (§3.1); the DGS decides.' : 'Informational only; the DGS decides.'),
        alphaDetails,
      ),
      el(
        'div',
        { class: 'banner privacy notice-strip', role: 'note' },
        el('p', { class: 'notice-line' }, el('strong', {}, 'Private by design — FERPA. '), 'Your coursework never leaves this browser.'),
        privacyDetails,
      ),
    );
  }

  function snapshotBanner(): HTMLElement {
    const date = rules.syncedAt.slice(0, 10);
    return el(
      'div',
      { class: 'banner' },
      `You chose to continue with the copy of the rules saved on ${date} because the live spreadsheet could not be loaded — recent DGS edits may be missing. Reload the page to try the live spreadsheet again.`,
    );
  }

  // ---------- standing ----------

  /** A Ph.D. student's own Notre Dame MSCSE (DGS 2026-10-03: "Within CSE, the
   * graduate school treats MS and PhD the same graduate program"): its
   * coursework is Ph.D. coursework, not transfer credit — said on the standing
   * card and above the MSCSE's courses (policy review round 3, P3-cse-5-6-3,
   * where the §5.2 paragraph used to stand). Unless five years or more
   * separate the two (DGS 2026-10-06, with P3-cse-5-6-3; Academic Code §5.5):
   * then every MSCSE course waits for the DGS and the Graduate School. */
  function ownMscseSentence(): string {
    const fourPlusOne = student.background?.graduate === 'nd-4plus1';
    // The rows below state only the fact; the reason and the "no approval,
    // no §5.2 cap" are said here once (UI review, 2026-10-08).
    const base = `Your Notre Dame MSCSE coursework is not transfer credit: the Graduate School treats the CSE MSCSE and Ph.D. as one graduate program, so each MSCSE course not applied to your bachelor’s degree counts in full as Ph.D. coursework, with no transfer approval and no §5.2 cap — its own line says how${fourPlusOne ? ', and courses shared with your bachelor’s degree follow §3.5' : ''}.`;
    const separated = mscseSeparation(student);
    return separated === undefined
      ? base
      : `${base} But your MSCSE ended in ${termLabel(separated)}, five years or more before you entered the Ph.D. in ${termLabel(normalizeEntryTerm(student.entryTerm).term)}: a separation that long from the graduate program may forfeit its credit and coursework (Academic Code §5.5), so every MSCSE course counts only once the DGS reviews it and the Graduate School approves — the review request asks.`;
  }
  /** An unfinished program in another Notre Dame department (policy review
   * round 3, P3-dh-3.14-3.20-1; DGS 2026-10-06: "Apply the handling"). A move
   * into CSE from it is a program transfer: the Graduate School does not reset
   * the clock and may require a plan of study naming the prior courses it
   * accepts (DGS Handbook §3.15) — the import keeps the first admission as the
   * entry term (2026-10-03, item 16), so those courses are this program's
   * coursework, not §5.2 transfer credit. §5.2's six stays only for courses
   * from a separate earlier admission: Notre Dame graduate courses dated
   * before the entry term. */
  function ndOtherUnfinishedSentence(unfinished: string, finished: string): string {
    const separateEarlier = student.courses.some((c) => c.origin === 'transfer' && isNotreDameInstitution(c.institution) && c.degreeLevel !== 'bachelors');
    if (separateEarlier) return ` Your earlier Notre Dame program in another department was not finished — another graduate program under §5.2, so up to ${unfinished} credits from it may transfer; it would be ${finished} after a finished degree.`;
    const nonCse = `${student.program === 'mscse' ? '§3.2' : '§4.2'}’s nine-credit allowance`;
    return ` You moved into CSE from an unfinished Notre Dame program in another department: the Graduate School treats that as a program transfer, which does not reset your clock (DGS Handbook §3.15). Its courses are on your Notre Dame record from your first admission, ${termLabel(normalizeEntryTerm(student.entryTerm).term)}, and count under the course rules — a course outside CSE within ${nonCse}, and a course not in the rules waits for the DGS. The DGS confirms which earlier courses are accepted (the Graduate School’s plan of study, DGS Handbook §3.15).`;
  }
  /** Whether a prior Notre Dame course group holds the student's own MSCSE. */
  function holdsOwnMscse(): boolean {
    const g = student.background?.graduate;
    return student.program === 'phd' && (student.ndMasters !== undefined || g === 'nd-mscse' || g === 'nd-4plus1' || g === 'nd-mscse-transfer');
  }
  /** What the earlier-degrees answer means for THIS student, one sentence
   * with the numbers from the Parameters tab (clarity review 2026-09-26) —
   * in place of "(§5.2 transfer caps, the MSCSE already held and the
   * Integrated 4+1 follow from this.)", which named the rules and not the
   * consequence. */
  function backgroundConsequence(): string {
    const b = student.background;
    if (!b) return ' (§5.2 transfer allowances, the MSCSE already held and the Integrated 4+1 follow from this.)';
    const n = (key: string): string => {
      const v = rules.parameters.number(key);
      return v === undefined ? 'a number of' : String(v);
    };
    const finished = n(student.program === 'mscse' ? 'ms_transfer_completed_ms_credits_max' : 'phd_transfer_completed_ms_credits_max');
    const unfinished = n('transfer_unfinished_ms_credits_max');
    if (b.graduate === 'elsewhere') {
      return b.finished
        ? ` You finished a graduate degree elsewhere, so up to ${finished} credits from it may transfer (§5.2); it would be ${unfinished} if that program were unfinished.`
        : ` Your earlier graduate program was not finished, so up to ${unfinished} credits from it may transfer (§5.2); it would be ${finished} after a finished degree.`;
    }
    // A degree elsewhere beside the MSCSE held (P3-prior-programs-1; DGS
    // 2026-10-07: option (a)), with its own §5.2 allowance; the five years
    // count back from the MSCSE admission (P3-prior-programs-4 (b)).
    if (b.graduate === 'nd-mscse' || b.graduate === 'nd-4plus1') {
      const outside = b.alsoElsewhere
        ? b.finished
          ? ` You also finished a graduate degree at another university, so up to ${finished} credits from it may transfer (§5.2), counted back five years from your admission to the MSCSE; it would be ${unfinished} if that program were unfinished.`
          : ` Your graduate program at another university was not finished, so up to ${unfinished} credits from it may transfer (§5.2), counted back five years from your admission to the MSCSE; it would be ${finished} after a finished degree.`
        : '';
      // One line here (UI review item 1; DGS 2026-10-08: option (c)) — the
      // reason sits once above the MSCSE's courses; unless five years or more
      // separate the two, when the full sentence is the warning itself.
      const own = mscseSeparation(student) === undefined ? 'Your MSCSE courses count as Ph.D. coursework, not transfer credit — see Coursework.' : ownMscseSentence();
      return ` ${own}${outside}`;
    }
    // No stated limit without an earlier program (policy review round 3,
    // P3-cse-5-6-1; DGS 2026-10-06): §5.2 caps only what comes from an
    // unfinished or a completed program, so the DGS decides — "may transfer"
    // with a number read as an allowance no document gives.
    const noStatedLimit = `the DGS decides whether a course from another university transfers, and how much (§5.2 sets a limit only after a graduate program); this page holds it to ${unfinished} until then`;
    if (b.graduate === 'nd-mscse-transfer') {
      // A degree elsewhere beside the transfer (P3-prior-programs-2; DGS
      // 2026-10-07: option (a)) is a prior program under §5.2.
      const outside = b.alsoElsewhere
        ? b.finished
          ? `You finished a graduate degree at another university, so up to ${finished} credits from it may transfer (§5.2); it would be ${unfinished} if that program were unfinished`
          : `Your graduate program at another university was not finished, so up to ${unfinished} credits from it may transfer (§5.2); it would be ${finished} after a finished degree`
        : `No earlier degree: ${noStatedLimit}`;
      return ` ${outside}; your MSCSE coursework counts as Ph.D. coursework (one graduate program). The §4.3 eight years and the eighth semester for the OCE and for admission to candidacy count from the semester you started the MSCSE; the §4.4 qualifier clocks and the first-year seminars (§4.2) from your transfer.`;
    }
    if (b.graduate === 'nd-other') {
      // Another Notre Dame department is "another graduate program at Notre
      // Dame" (Academic Code §4.6; DGS 2026-10-03) — the §5.2 caps apply.
      return b.finished
        ? ` You finished a graduate degree at Notre Dame in another department — another graduate program under §5.2, so up to ${finished} credits from it may transfer; it would be ${unfinished} if that program were unfinished.`
        : ndOtherUnfinishedSentence(unfinished, finished);
    }
    return ` No graduate degree before this program: ${noStatedLimit}.`;
  }
  /** The whose-semester sentence, only for a student who came through the
   * Notre Dame MSCSE (DGS 2026-09-27, clarity proposal 5); it stood on every
   * Ph.D. record before. */
  function mscseClockSentence(): string {
    const cameThroughMscse = student.program === 'phd' && (student.background?.graduate === 'nd-mscse-transfer' || student.ndMasters !== undefined);
    if (!cameThroughMscse) return '';
    // Only the case the earlier-degrees answer names, once it names one (UI
    // review, 2026-10-08; extends clarity proposal 5); both while unanswered.
    const g = (student.background ?? student.backgroundDraft)?.graduate;
    const unfinished = ' You came into the Ph.D. from an unfinished Notre Dame MSCSE, so this is the semester you started the MSCSE (§4.3, §4.5 and admission to candidacy count from it; the §4.4 qualifier clocks and the first-year seminars from your transfer).';
    const finished = ' You finished the MSCSE first, so this is the semester you started the Ph.D. (§4.5).';
    if (g === 'nd-mscse-transfer') return unfinished;
    if (g === 'nd-mscse' || g === 'nd-4plus1') return finished;
    return ' Came into the Ph.D. from an unfinished Notre Dame MSCSE? Then this is the semester you started the MSCSE (§4.3, §4.5 and admission to candidacy count from it; the §4.4 qualifier clocks and the first-year seminars from your transfer). Finished the MSCSE first? Then it is the semester you started the Ph.D. (§4.5).';
  }
  function standingCard(classified: readonly ClassifiedCourse[]): HTMLElement {
    // The entry term drives the §4.3 residency count and every deadline. When
    // the student sets it, the "inferred/assumed" flag clears and every Notre
    // Dame course is re-filed as program or prior coursework (2026-09-05).
    const setEntry = (mutate: (s: Student) => void) =>
      update((s) => {
        mutate(s);
        s.entryTermInferred = undefined;
        const moved = reclassifyNotreDameCourses(s);
        // Re-filing can turn program coursework into an earlier degree's
        // coursework, which changes the §5.2 cap: a student who corrects the
        // entry term to their Ph.D. start has just told the app about a prior
        // graduate program (2026-09-09 — the cap was staying at 6).
        // Whether their Notre Dame master's was earned BEFORE this program or
        // along the way turns on the same term, so it is re-read first and the
        // cap follows it (2026-09-10 — a 4+1 correcting the term got 6).
        // …unless the earlier-degrees questions are answered: the answer
        // settles both facts, and re-deriving them from ANY Notre Dame
        // conferral let a master's from another department flip a Ph.D. record
        // into the own-MSCSE path (policy review 2026-10-03; the import path
        // has had this guard since 2026-09-22).
        if (s.background === undefined) {
          deriveNdMasters(s);
          derivePriorMs(s);
        }
        if (moved.toPrior + moved.toProgram > 0) {
          window.setTimeout(
            () =>
              toast(
                // Plain words (UI review, 2026-10-08): not "re-filed" or "prior coursework".
                `Entry term changed: ${moved.toPrior + moved.toProgram} Notre Dame course${moved.toPrior + moved.toProgram === 1 ? ' is' : 's are'} listed again` +
                  (moved.toPrior > 0 ? ` — ${moved.toPrior} now as taken before you entered (before ${termLabel(s.entryTerm)})` : '') +
                  (moved.toProgram > 0 ? ` — ${moved.toProgram} now as taken in this program` : '') +
                  '.',
              ),
            0,
          );
        }
      });
    const seasonSel = el('select', {
      'aria-label': 'Entered the program — semester',
      'data-key': 'standing.season',
      onchange: (e) => setEntry((s) => void (s.entryTerm.season = (e.target as HTMLSelectElement).value as Season)),
    });
    seasonSel.append(...entrySeasonOptions(student.entryTerm.season));
    // The entry term is the hinge of every deadline in §4 (and §3.3's five
    // years), so a year outside 2000–2040 is refused rather than ignored: the
    // old handler fell back to the stored year and said nothing (R1).
    const { input: yearInput, error: yearError } = rangedNumber({
      key: 'standing.year',
      range: TERM_YEAR_RANGE,
      value: String(student.entryTerm.year),
      allowEmpty: false, // a record always has an entry term
      attrs: { 'aria-label': 'Entered the program — year' },
      commit: (value) => setEntry((s) => void (s.entryTerm.year = value!)),
    }, refusedValues, toast);
    // While the term is a guess (fresh record) or a transcript reading, say so
    // — a wrong entry term silently shifts every deadline (bug report 2026-09-05).
    const inferred = student.entryTermInferred;
    // A Notre Dame MSCSE finished before the Ph.D. (blue/red-team review of
    // Option 1, 2026-10-08): the Ph.D.'s clocks start at the Ph.D. admission
    // (DGS 2026-09-10, 2026-09-26), which insideND's transcript does not show —
    // its first graduate term is the MSCSE's. The action comes right after the
    // reading (UI review, 2026-10-08).
    const heldMscseReading = student.program === 'phd' && inferred !== undefined && inferred.how !== 'assumed' && !/admit-term|admission/.test(inferred.how) && heldNdMscse(student.background ?? student.backgroundDraft);
    // A move into CSE from an unfinished program in another Notre Dame
    // department (UI review item 11; DGS 2026-10-09: option (b)): the term read
    // is the first CSE term; the transfer keeps the earlier clock (DGS Handbook
    // §3.15), so the note asks for that program's first term, which the
    // transcript shows.
    const earlierAnswer = student.background ?? student.backgroundDraft;
    const unfinishedOtherReading = inferred?.alternative?.otherProgram === true && earlierAnswer?.graduate === 'nd-other' && earlierAnswer.finished === false;
    const entryNote = inferred
      ? el(
          'p',
          { class: 'hint warn entry-note' },
          inferred.how === 'assumed'
            ? `${termLabel(student.entryTerm)} is assumed — set the semester you entered the program. `
            : unfinishedOtherReading && inferred.alternative
              ? `${termLabel(student.entryTerm)} was read from your transcript (${inferred.how}). Your earlier degrees say you moved into CSE from an unfinished program in another Notre Dame department — a program transfer, which keeps that program’s clock (DGS Handbook §3.15): set the semester you entered it, ${termLabel(inferred.alternative.term)} on your transcript. `
            : heldMscseReading
              ? `${termLabel(student.entryTerm)} was read from your transcript (${inferred.how}). That is your MSCSE’s first semester: your earlier degrees say you finished the Notre Dame MSCSE before the Ph.D., so set the semester you entered the Ph.D. here — your transcript does not show it. `
              : `${termLabel(student.entryTerm)} was read from your transcript (${inferred.how}). Check it. `,
          student.program === 'phd'
            // The four deadlines are each a report row with a Deadline chip;
            // the §s stay (trim review 2026-09-18, P-11); the approved wording
            // (W-CL103) — "a transfer" is a move before finishing, which keeps
            // the clock.
            ? `The residency count (§4.3) and every deadline (§4.2’s first-year seminars, §4.3, §4.4, §4.4.3, §4.5 and admission to candidacy) are counted from this term — your matriculation at the Graduate School, which a transfer from another Notre Dame program does not reset.${heldMscseReading ? '' : mscseClockSentence()}`
            : 'The residency count and the five-year limit on completing the degree (§3.3) are counted from this term.',
          inferred.alternative && !unfinishedOtherReading ? ` Note: ${inferred.alternative.why}.` : '',
          // A non-degree semester read as the program's start (policy review
          // round 3, P3-dh-front-1-2-3, part (1)): said where the import picked
          // an earlier admission or the first graduate-level term. The import
          // keeps the earlier term as its default, and this sentence is how a
          // non-degree student corrects it (DGS 2026-10-07, option (a)).
          inferred.how !== 'assumed' && (inferred.alternative !== undefined || /first graduate-level term|earlier of the admit-term lines/.test(inferred.how))
            ? ` If you were a non-degree (unclassified or departmental non-degree) student at Notre Dame before your degree admission, set the entry term to that admission; up to ${NON_DEGREE_CREDITS_MAX} non-degree credits may count (Academic Code §2.3).`
            : '',
          // Confirming the reading as it is (UI review, 2026-10-08) — the same
          // as re-picking the term; not offered where the term read is known
          // to be the MSCSE's.
          // A Ph.D. reading that may be the MSCSE's start waits for the
          // earlier-degrees answer, which says whether it is (verification of
          // the UI review, 2026-10-08).
          inferred.how !== 'assumed' && !heldMscseReading && !unfinishedOtherReading && (student.program === 'mscse' || student.background !== undefined || /admit-term|admission/.test(inferred.how))
            ? el(
                'button',
                {
                  class: 'btn tiny confirm-reading',
                  'data-key': 'standing.entry.confirm',
                  'aria-label': `${termLabel(student.entryTerm)} is right`,
                  onclick: () => {
                    setFocusAfterRender(student.bachelorsAwardedInferred?.before ? 'standing.bachelors.exact' : 'standing.bachelors.season');
                    setEntry(() => undefined);
                  },
                },
                'Looks right',
              )
            : '',
        )
      : null;
    // The prior-degree controls — "Prior graduate study", "I already hold the
    // MSCSE", the Integrated 4+1 question — left this card on 2026-09-22 (DGS):
    // the opening dialog's earlier-degrees questions settle all three
    // (applyBackground), and this line says what they settled, with the way
    // to change it. A record from before the questions shows the way to answer.
    // Unanswered, the questions are in the Transcripts card (DGS 2026-10-08,
    // Option 1), partly answered from the transcripts imported there.
    const changeKey = 'standing.background.change';
    const readNote = student.background && student.backgroundRead ? ' (partly read from your transcripts — check it)' : '';
    const earlierDegreesLine = el(
      'p',
      { class: 'hint background-line', 'data-key': 'standing.background' },
      el('strong', {}, 'Earlier degrees: '),
      ...(student.background
        ? [describeBackground(student.background) + readNote + ' — ', el('button', { class: 'btn tiny link', 'data-key': changeKey, onclick: () => openBackgroundDialog(student, update, changeKey) }, 'Change'), '.', backgroundConsequence()]
        : ['not answered yet — ', el('a', { href: '#earlier-degrees', 'data-key': 'standing.background.goto' }, 'answer them in the Transcripts card'), '.']),
    );
    // Bachelor's degree awarded (DGS 2026-09-06): graduate-level courses dated
    // in or before this term earn no transfer credit — §5.2 needs graduate
    // student status (allocate.ts). Required since 2026-09-07 (DGS), though
    // the year is still the switch for the stored value (empty = unknown) and
    // the semester defaults to spring (May commencement). A
    // transcript import fills it in when it finds a dated bachelor's award;
    // the note says so until the student touches either control.
    const awarded = student.bachelorsAwarded;
    const bsSeason = el('select', { 'aria-label': 'Bachelor’s degree awarded — semester', 'data-key': 'standing.bachelors.season' });
    bsSeason.append(...seasonOptions(awarded?.season ?? 'spring'));
    const setBachelors = (year: number | undefined): void =>
      update((s) => {
        s.bachelorsAwarded = year === undefined ? undefined : { season: (bsSeason as HTMLSelectElement).value as Season, year };
        s.bachelorsAwardedInferred = undefined; // the student decided
        reclassifyNotreDameCourses(s); // prior Notre Dame rows without a registered level follow the award term
        derivePriorMs(s); // a senior-year graduate course is not a prior master's (2026-09-09)
      });
    // Empty still means "unknown" (2026-09-07); a year outside 1970–2040 no
    // longer quietly means the same thing, since the old guard (`>= 1970`,
    // no upper bound) accepted 9999 and dropped 1899 without a word (R1).
    const { input: bsYear, error: bsYearError } = rangedNumber({
      key: 'standing.bachelors.year',
      range: BACHELORS_YEAR_RANGE,
      value: awarded ? String(awarded.year) : '',
      allowEmpty: true,
      attrs: {
        'aria-label': 'Bachelor’s degree awarded — year',
        ...(awarded === undefined ? { required: 'required', 'aria-required': 'true' } : {}),
      },
      commit: setBachelors,
    }, refusedValues, toast);
    bsSeason.addEventListener('change', () => {
      const text = (bsYear as HTMLInputElement).value;
      const year = Number(text);
      if (text === '') return; // no year yet: the award term stays unknown, as it always has
      if (inRange(year, BACHELORS_YEAR_RANGE)) {
        setBachelors(year);
        return;
      }
      // The semester cannot be recorded without a year the app will keep, and
      // a silent no-op would leave the select showing a term the record does
      // not hold (R1, 2026-09-18): say which box is in the way.
      const refused = refusedValues.get('standing.bachelors.year');
      toast(refused ? refused.message : inputRefusal(text, BACHELORS_YEAR_RANGE));
    });
    const hasGraduateTransfers = student.courses.some((c) => c.origin === 'transfer' && c.degreeLevel !== 'bachelors');
    const bsInferred = student.bachelorsAwardedInferred;
    // A standalone master's transcript (DGS 2026-09-20): the award is only
    // known to be BEFORE the master's first semester, and that is what the
    // field says — no season, no year, nothing required — until the student
    // chooses to set the exact term.
    const bsBefore = bsInferred?.before;
    const bsBeforeLine = bsBefore
      ? el(
          'div',
          { class: 'pair bachelors-before' },
          el('span', { class: 'bachelors-before-text', 'data-key': 'standing.bachelors.before' }, `Before ${termLabel(bsBefore)}`),
          el(
            'button',
            {
              class: 'btn tiny',
              'data-key': 'standing.bachelors.exact',
              onclick: () =>
                update((s) => {
                  // Keep the value; drop the "before" reading so the season and year show, pre-filled.
                  if (s.bachelorsAwardedInferred) s.bachelorsAwardedInferred = { how: s.bachelorsAwardedInferred.how };
                }),
            },
            'Set the exact semester',
          ),
        )
      : undefined;
    const bsNote = el(
      'p',
      // Required since 2026-09-07 (DGS): every student has a bachelor's
      // degree, and §5.2 counts a course as transfer credit only if it was
      // taken after that degree — so the term is needed whether or not the
      // student also holds a graduate degree. An unset field always warns.
      { class: `hint${(bsInferred && !bsBefore) || awarded === undefined ? ' warn' : ''} field-hint bachelors-note` },
      awarded && bsBefore
        ? `Your master’s transcript starts in ${termLabel(bsBefore)}, so your bachelor’s degree counts as awarded before then — which is all §5.2 needs for the courses on it. Set the exact semester only if you also have coursework from before your master’s.`
        : awarded && bsInferred
        ? `${termLabel(awarded)} was read from your transcript (${bsInferred.how}). Check it — courses taken in or before this term, even graduate-level ones, are not counted as transfer credit (§5.2: graduate student status). `
        : awarded
          ? 'Courses taken in or before this term, even graduate-level ones, are not counted as transfer credit (§5.2: graduate student status).'
          : hasGraduateTransfers
            ? 'Required, and you already have coursework from before Notre Dame: enter the semester your bachelor’s degree was awarded. Courses taken in or before it, even graduate-level ones, cannot transfer (§5.2); until it is set, every graduate-level course from before Notre Dame is taken as graduate coursework.'
            // The legend above already names the field (trim review 2026-09-18, P-23).
            : '§5.2 counts a course as transfer credit only if it was taken after the bachelor’s degree.',
      // Confirming the reading as it is (UI review, 2026-10-08), as touching
      // the field does.
      awarded && bsInferred && !bsBefore
        ? el(
            'button',
            {
              class: 'btn tiny confirm-reading',
              'data-key': 'standing.bachelors.confirm',
              'aria-label': `${termLabel(awarded)} is right`,
              onclick: () => {
                setFocusAfterRender(student.background ? 'standing.background.change' : 'standing.background.goto');
                update((s) => void (s.bachelorsAwardedInferred = undefined));
              },
            },
            'Looks right',
          )
        : '',
    );
    const card = el(
      'section',
      { class: 'card', id: 'standing' },
      el('h2', {}, el('span', { class: 'step-no' }, '2. '), 'Your standing ', el('span', { class: 'chip-note' }, currentSemesterChip())),
      // A fieldset with a legend (item 5): the two controls share one question.
      fieldset(enteredProgramLabel(), el('div', { class: 'pair' }, seasonSel, yearInput)),
      yearError,
      // What this field drives (item 11) — the longer note takes over while
      // the term is inferred or assumed.
      entryNote ??
        el(
          'p',
          { class: 'hint field-hint' },
          'Every deadline and the residency count are counted from this term.' +
            // Whose semester 1 (DGS 2026-09-26): the MSCSE start for a transfer
            // into the Ph.D., the Ph.D. start after a finished MSCSE.
            (student.program === 'phd'
              ? mscseClockSentence()
              : ''),
        ),
      bsBeforeLine ? fieldset('Bachelor’s degree awarded', bsBeforeLine) : fieldset('Bachelor’s degree awarded (required)', el('div', { class: 'pair' }, bsSeason, bsYear)),
      bsBeforeLine ? null : bsYearError,
      bsNote,
      earlierDegreesLine,
    );
    // The MSCSE project/thesis option moved to the top of the MSCSE part of
    // Milestones (UI review item 7; DGS 2026-10-09: option (b)): its effect —
    // which milestone fields show — is visible where the choice is made.

    const ftTerms = fullTimeTerms(classified);
    if (ftTerms) card.append(ftTerms);
    card.append(clockFields());
    card.append(probationField());
    card.append(dualDegreeField());
    const nonDegree = nonDegreeQuestion(classified);
    if (nonDegree) card.append(nonDegree);
    return card;
  }

  /** The facts that move a clock, or send a record to the DGS (policy review
   * 2026-10-03): semesters on an approved leave of absence and childbirth/
   * adoption accommodations (each pushes the §4.3 limit and §4.5's eighth
   * semester out by a semester — Academic Code §6.2.6, §5.4; DGS Handbook §3.4,
   * §3.7.2), and a readmission after a withdrawal or a missed semester
   * (Academic Code §5.5; DGS Handbook §3.1, §3.3). */
  /** On probation, with a deadline in the letter (Academic Code §5.7.2) — a
   * rare case (DGS 2026-10-04, policy review P2-ac-5b-6.1-3), behind a
   * selector that is open once a date is on file. The report says at the top
   * that the letter's date governs; nothing is recomputed. */
  function probationField(): HTMLElement {
    const input = el('input', {
      type: 'date',
      value: student.probationLetterDeadline ?? '',
      'data-key': 'standing.probation',
      'aria-label': 'Deadline in your probation letter',
      onchange: (e) => {
        const v = (e.target as HTMLInputElement).value;
        update((s) => void (s.probationLetterDeadline = /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined));
      },
    });
    return rareFold(
      'probation',
      // Closed by default (DGS 2026-10-04); a date on file is in the summary.
      student.probationLetterDeadline !== undefined ? `On probation, with a deadline in the letter? — on file: ${student.probationLetterDeadline}` : 'On probation, with a deadline in the letter?',
      false,
      el(
        'div',
        { class: 'field' },
        el('label', { class: 'label' }, 'Deadline in your probation letter (Academic Code §5.7.2)', input),
        policyFold(
          'probation',
          el(
          'p',
          { class: 'hint field-hint' },
          'Only if you are on probation. The letter’s stipulations and its deadline govern — they can come before the deadlines on this page (the candidacy exam by the end of next semester, say), and missing them can lead to dismissal (Academic Code §5.8). Leave blank otherwise.',
          ),
        ),
      ),
    );
  }

  /** Enrolled in a second Notre Dame degree program at the same time (Academic
   * Code §2.2; DGS Handbook §2.9 — policy review 2026-10-04, P2-ac-1-3-2): a
   * rare case, behind a selector open once answered. A yes offers each Notre
   * Dame course the "Also counts toward my other degree" tick. */
  function dualDegreeField(): HTMLElement {
    // Its own key, not an `attest.` one: a fact about the student, not an
    // approval (and the a11y driver's focus check takes the first `attest.`).
    const cb = el('input', {
      type: 'checkbox',
      'data-key': 'standing.concurrentDegree',
      onchange: (e) => update((s) => void (s.concurrentDegree = (e.target as HTMLInputElement).checked ? true : undefined)),
    }) as HTMLInputElement;
    cb.checked = student.concurrentDegree === true;
    return rareFold(
      'dual-degree',
      // Closed by default (DGS 2026-10-04); a yes on file is in the summary.
      student.concurrentDegree === true ? 'Enrolled in a second Notre Dame degree program at the same time? — on file: yes' : 'Enrolled in a second Notre Dame degree program at the same time?',
      false,
      el('label', { class: 'attest' }, cb, ' I am enrolled in a second Notre Dame degree program at the same time — a dual degree (Academic Code §2.2)'),
      policyFold(
        'dual-degree',
        el(
          'p',
          { class: 'hint field-hint' },
          'Then tick “Also counts toward my other degree” on each course in Your coursework that the other program counts too. At most nine credits of those courses count toward this degree (Academic Code §2.2), once the Graduate School has approved your dual-degree plan of study (DGS Handbook §2.9).',
        ),
      ),
    );
  }

  /** The empty falls and springs on the Notre Dame transcript (withdrawals.ts
   * transcriptGapSemesters; through the current semester since P3-dh-3.1-3.13-2). */
  function transcriptGaps(): Term[] | undefined {
    return transcriptGapSemesters(student, realTodayIso); // a question about the transcript: the real date even in simulation mode (D5)
  }

  function clockFields(): HTMLElement {
    const phd = student.program === 'phd';
    const count = (key: 'leaveSemesters' | 'accommodationSemesters', label: string, hint: string): HTMLElement => {
      const input = el('input', {
        type: 'number',
        min: '0',
        max: '20',
        step: '1',
        value: student[key] === undefined ? '' : String(student[key]),
        'data-key': `standing.${key}`,
        'aria-label': label,
        onchange: (e) => {
          const raw = (e.target as HTMLInputElement).value.trim();
          const n = Number(raw);
          update((s) => {
            s[key] = raw === '' || !Number.isInteger(n) || n < 0 ? undefined : Math.min(20, n);
            // Each leave's semester, each accommodation's birth or adoption semester — one slot per semester counted.
            const slots = key === 'leaveSemesters' ? 'leaveTerms' : 'accommodationEventTerms';
            const kept = (s[slots] ?? []).slice(0, s[key] ?? 0);
            s[slots] = kept.some((t) => t !== null) ? kept : undefined;
          });
        },
      });
      return el('div', { class: 'field' }, el('label', { class: 'label' }, label, input), policyFold(`clocks.${key}`, el('p', { class: 'hint field-hint' }, hint)));
    };
    // Ph.D.: which semester each leave was, and the semester of each birth or
    // adoption (policy review round 3, P3-ac-5a-1; DGS 2026-10-05: option (a),
    // and option 1 for an accommodation taken the semester after) — only those
    // before the end of the eighth semester move the candidacy deadline.
    const slotPickers = (slots: 'leaveTerms' | 'accommodationEventTerms', count: number, label: (i: number) => string, seasons: readonly Season[]): HTMLElement | null => {
      if (!phd || count === 0) return null;
      return el(
        'div',
        { class: 'clock-slots' },
        ...Array.from({ length: Math.min(count, 20) }, (_, i) =>
          termPicker(`standing.${slots}.${i}`, label(i), student[slots]?.[i] ?? undefined, seasons, (t) =>
            update((s) => {
              const arr = Array.from({ length: Math.min(count, 20) }, (_, j) => s[slots]?.[j] ?? null);
              arr[i] = t ?? null;
              s[slots] = arr.some((x) => x !== null) ? arr : undefined;
            }),
          ),
        ),
      );
    };
    const leaveCount = student.leaveSemesters ?? 0;
    const accommodationCount = student.accommodationSemesters ?? 0;
    const unplacedSlots =
      phd &&
      ((leaveCount > 0 && Array.from({ length: leaveCount }, (_, i) => student.leaveTerms?.[i] ?? null).some((t) => t === null)) ||
        (accommodationCount > 0 && Array.from({ length: accommodationCount }, (_, i) => student.accommodationEventTerms?.[i] ?? null).some((t) => t === null)));
    const readmitted = student.readmittedTerm;
    const reSeason = el('select', { 'aria-label': 'Readmitted — semester', 'data-key': 'standing.readmitted.season' });
    reSeason.append(...entrySeasonOptions(readmitted?.season ?? 'fall'));
    const setReadmitted = (year: number | undefined): void =>
      update((s) => void (s.readmittedTerm = year === undefined ? undefined : { season: (reSeason as HTMLSelectElement).value as Season, year }));
    const { input: reYear, error: reYearError } = rangedNumber({
      key: 'standing.readmitted.year',
      range: TERM_YEAR_RANGE,
      value: readmitted ? String(readmitted.year) : '',
      allowEmpty: true,
      attrs: { 'aria-label': 'Readmitted — year', placeholder: 'year' },
      commit: setReadmitted,
    }, refusedValues, toast);
    reSeason.addEventListener('change', () => {
      const text = (reYear as HTMLInputElement).value;
      if (text !== '' && inRange(Number(text), TERM_YEAR_RANGE)) setReadmitted(Number(text));
    });
    // Uncommon: behind a selector (DGS 2026-10-03), closed unless a transcript
    // gap needs an answer (DGS 2026-10-04, below).
    // Read from the Notre Dame transcript (DGS 2026-10-04: shown "only when
    // they are applicable according to the transcript"): a leave or a missed
    // semester leaves a fall or spring with no registration between the first
    // and the last semester on it. A withdrawal may not: after the
    // course-discontinuance date every course stays on the transcript as W,
    // and leaving without the Separation form leaves an F in every course —
    // so a fall or spring all W (or all F) with a later semester after it
    // asks too (policy review round 3, P3-dh-3.1-3.13-1; DGS 2026-10-06:
    // "Apply the suggested handling"; withdrawals.ts). An empty current
    // semester after the last registered one counts as a gap too, and with
    // none of these the medical leave and the accommodation are still asked —
    // a transcript shows neither a leave approved for a coming semester nor an
    // accommodation (P3-dh-3.1-3.13-2; DGS 2026-10-06: "Apply the handling
    // with option (b)"); only the readmission waits for a transcript sign.
    // Without a transcript, or with an answer on file, everything is asked.
    const gaps = transcriptGaps();
    const withdrawals = withdrawalSemesters(student) ?? [];
    const leaveAsked = gaps === undefined || gaps.length > 0 || withdrawals.length > 0 || (student.leaveSemesters ?? 0) > 0 || student.readmittedTerm !== undefined;
    const summary =
      gaps !== undefined && gaps.length > 0
        ? `Your transcript shows no registration in ${gaps.map(termLabel).join(', ')} — a leave of absence, a withdrawal or a missed semester?${withdrawals.length > 0 ? ` ${withdrawalQuestion(withdrawals, termLabel)}` : ''}`
        : withdrawals.length > 0
          ? withdrawalQuestion(withdrawals, termLabel)
          : leaveAsked
          ? 'A medical leave, a childbirth or adoption accommodation, or a readmission?'
          : // A medical leave approved for a coming semester shows on no
            // transcript (P3-dh-3.1-3.13-2; DGS 2026-10-06: "option (b)"), so
            // its count is always offered, as the accommodation's is.
            'A medical leave, or a childbirth or adoption accommodation?';
    // Closed by default; open only when a transcript gap is waiting for an
    // answer (DGS 2026-10-04: "Open one if an attention is needed there (e.g.,
    // found a gap semester)"). What is on file is said in the summary line.
    const onFile = [
      ...((student.leaveSemesters ?? 0) > 0 ? [`${student.leaveSemesters} medical leave ${student.leaveSemesters === 1 ? 'semester' : 'semesters'}`] : []),
      ...((student.accommodationSemesters ?? 0) > 0 ? [`${student.accommodationSemesters} accommodation ${student.accommodationSemesters === 1 ? 'semester' : 'semesters'}`] : []),
      ...(student.readmittedTerm ? [`readmitted ${termLabel(student.readmittedTerm)}`] : []),
    ];
    // An all-W or all-F semester is answered by a readmission only: a leave is
    // requested before the first class day (Academic Code §5.1), so it is not one.
    // …and while the answer does not cover the gaps (policy review round 3,
    // P3-ac-5a-5; DGS 2026-10-07: option (a), "open it while the mismatch
    // stands"): more unregistered semesters than the leave count, no
    // readmission term — the warning asks for the readmission semester, which
    // is entered here.
    const gapUnanswered =
      (gaps !== undefined && gaps.length > 0 && (student.leaveSemesters ?? 0) === 0 && student.readmittedTerm === undefined) ||
      (withdrawals.length > 0 && student.readmittedTerm === undefined) ||
      uncoveredRegistrationGaps(student, todayIso()) !== undefined; // the SAME date the engine's warning reads (audit.ts) — in simulation mode the simulated one, so the fold the warning points at is open (review fix 2026-10-09; DECISIONS)
    return rareFold(
      'clocks',
      onFile.length > 0 ? `${summary} — on file: ${onFile.join(', ')}` : summary,
      gapUnanswered || unplacedSlots,
      el(
      'fieldset',
      { class: 'ft-terms clock-fields' },
      el('legend', { class: 'label' }, `${leaveAsked ? 'Medical leave, accommodations and readmission' : 'Medical leave and childbirth or adoption accommodation'} (${phd ? '§4.3, §4.5' : '§3.3'}; Graduate School)`),
      // Always offered (P3-dh-3.1-3.13-2, option (b)); the readmission below
      // still waits for a transcript sign or an answer on file.
      count(
        'leaveSemesters',
        // Medical leave only (policy review round 3, P3-cross-doc-1; DGS
        // 2026-10-06: "I choose option A and rename the input 'Semesters on
        // approved medical leave'"). Academic Code §6.2.6, which governs:
        // "within eight years from the time of matriculation, unless
        // interrupted by approved medical leave(s) and/or approved childbirth
        // accommodation(s)" — the DGS Handbook's "Only a leave of absence will
        // stop the clock" (§3.4) names any leave. A leave for another reason
        // is not entered, so it moves no clock.
        'Semesters on approved medical leave',
        phd
          ? 'Fall or spring semesters the Graduate School approved as a medical leave of absence (at most two in a row, §5.7). An approved medical leave stops the clock (Academic Code §6.2.6: “unless interrupted by approved medical leave(s) and/or approved childbirth accommodation(s)”): each semester here moves the eight-year limit (§4.3) out by a semester, and one before the end of your eighth semester of enrollment also moves the eighth-semester deadlines for the Oral Candidacy Exam (OCE) (§4.5) and for admission to doctoral candidacy (DGS Handbook §3.22.3) — a later one cannot change which semester was the eighth (DGS 2026-10-05). A leave for another reason — study, athletic training, military, mission work or personal — is not entered here: it does not stop the clock (DGS 2026-10-06). A six-week medical or crisis separation is not a leave and does not count (DGS Handbook §3.5, §3.6).'
          : 'Fall or spring semesters the Graduate School approved as a medical leave of absence (at most two in a row, §5.7). Each moves the five-year limit (§3.3) out by a semester: the Graduate School stops the doctoral clock only for approved medical leave and childbirth accommodation (Academic Code §6.2.6), and the five years follow it (DGS 2026-10-03, 2026-10-06). A leave for another reason — study, athletic training, military, mission work or personal — is not entered here: it does not stop the clock. A six-week medical or crisis separation is not a leave and does not count (DGS Handbook §3.5, §3.6).',
      ),
      slotPickers('leaveTerms', leaveCount, (i) => `Medical leave semester${leaveCount > 1 ? ` ${i + 1}` : ''} — which semester`, ['fall', 'spring']),
      count(
        'accommodationSemesters',
        'Childbirth or adoption accommodation semesters',
        phd
          ? 'Semesters of the Graduate School’s childbirth and adoption accommodation (Academic Code §5.4): each extends the eight-year limit by a semester, and one for a birth or adoption in or before your eighth semester of enrollment also extends the eighth-semester deadlines for the OCE and for admission to candidacy — even when you take it in the semester right after, as the policy lets you (DGS Handbook §3.7.2; DGS 2026-10-05).'
          : 'Semesters of the Graduate School’s childbirth and adoption accommodation (Academic Code §5.4): each extends the five-year limit by a semester (DGS Handbook §3.7.2).',
      ),
      slotPickers('accommodationEventTerms', accommodationCount, (i) => `Accommodation${accommodationCount > 1 ? ` ${i + 1}` : ''} — semester of the birth or adoption`, ['spring', 'summer', 'fall']),
      !leaveAsked ? null : el(
        'div',
        { class: 'field' },
        el('span', { class: 'label' }, 'Readmitted after a withdrawal or a missed semester — semester (leave blank if it does not apply)'),
        el('div', { class: 'pair' }, reSeason, reYear),
        reYearError,
        policyFold(
          'clocks.readmitted',
          el(
          'p',
          { class: 'hint field-hint' },
          // A missed fall or spring semester needs readmission too (policy
          // review 2026-10-04, P2-dh-3.1-3.13-3; DGS Handbook §3.1). An empty
          // semester is never read as one: research-only semesters are empty.
          `If you withdrew from the University, or missed a fall or spring semester (no Roll Call and registration) without an approved leave, you had to be readmitted (DGS Handbook §3.1, §3.3): enter the readmission semester. ${
            // The MSCSE's five years and its own sections (P3-dh-3.1-3.13-4).
            phd
              ? 'Every clock still counts from your original entry term, in calendar semesters with the time away included (Academic Code §6.2.6: “from the time of matriculation”; DGS 2026-10-06)'
              : 'The five-year limit still counts from your original entry term, in calendar semesters with the time away included (§3.3; Academic Code §6.1.4; DGS 2026-10-06)'
          } — the Graduate School can approve an exception when the DGS requests one. Your courses from before it wait for the DGS — the program may reject some or all past credits (DGS Handbook §3.3), and after an interruption of five years or more the Code forfeits them (Academic Code §5.5).`,
          ),
        ),
      ),
      ),
    );
  }

  /** Academic Code §2.3's non-degree coursework: asked only when the record
   * holds Notre Dame graduate courses from before the entry term with no
   * earlier graduate program to explain them (DGS 2026-10-03: "Ask the
   * question only when such courses are detected based on the admission term"). */
  function nonDegreeQuestion(classified: readonly ClassifiedCourse[]): HTMLElement | null {
    const detected = classified.filter(
      (c) =>
        c.entry.origin === 'transfer' &&
        isNotreDameInstitution(c.entry.institution) &&
        c.entry.degreeLevel !== 'bachelors' &&
        termIndex(c.entry.term) < termIndex(student.entryTerm) &&
        student.priorMs === 'none' &&
        student.ndMasters === undefined &&
        student.background?.graduate !== 'nd-mscse-transfer' &&
        // Not a course taken as an undergraduate that counts as such (a 4+1's
        // senior-year course): the answer cannot change it (UI review,
        // 2026-10-08; refines 2026-10-03 item 13).
        !ndUndergraduateCounting(c.entry, resolveRuleRow(rules, c.entry.courseId, c.entry.term), student.bachelorsAwarded),
    );
    if (detected.length === 0 && student.ndNonDegree === undefined) return null;
    const radiosEl = radios(
      'standing.ndNonDegree',
      [
        ['', 'Not answered'],
        // Both kinds of non-degree status (Academic Code §2.3; policy review
        // round 3, P3-dh-front-1-2-4, finishing P2-dh-front-1-2-6).
        ['yes', 'Yes — I was a non-degree student then'],
        ['no', 'No'],
      ],
      student.ndNonDegree === undefined ? '' : student.ndNonDegree ? 'yes' : 'no',
      (value) => update((s) => void (s.ndNonDegree = value === '' ? undefined : value === 'yes')),
    );
    return el(
      'fieldset',
      { class: 'ft-terms nondegree' },
      el('legend', { class: 'label' }, 'Notre Dame graduate courses before you were admitted (Academic Code §2.3)'),
      el(
        'p',
        { class: 'hint' },
        // Both kinds of status still named in the question (P3-dh-front-1-2-4).
        detected.length === 0
          ? 'No course on your record depends on this answer now; your earlier answer is kept (Academic Code §2.3).'
          : `${listIds(detected.map((c) => c.entry.courseId))} ${detected.length === 1 ? 'is' : 'are'} dated before your entry term, with no earlier graduate program to explain ${detected.length === 1 ? 'it' : 'them'}. Were you a non-degree student at Notre Dame then (unclassified or departmental non-degree)? If so, up to 12 such credits may count toward the degree (Academic Code §2.3) — the DGS decides, and the review request asks.`,
      ),
      radiosEl,
    );
  }

  // The chip beside "2. Your standing" is the semester we are in TODAY, not
  // anything the student entered — it was a bare "Fall 2026" and read like the
  // entry term (DGS 2026-09-07), so it now says what it is.
  function currentSemesterChip(): string {
    // In simulation mode the chip says the semester is the pretended one (D5).
    return `${simulation ? 'simulated ' : ''}current semester: ${termLabel(termOfDate(todayIso()))}`;
  }

  /** The entry-term question names the actual program and where it is (DGS
   * 2026-09-07: "Entered the program" said neither). */
  function enteredProgramLabel(): string {
    return student.program === 'mscse'
      ? 'Entered the M.S. in CSE program at Notre Dame in'
      : 'Entered the Ph.D. program at Notre Dame CSE in';
  }

  /** The full-time-terms fieldset, or null while the record has no term to list. */
  function fullTimeTerms(classified: readonly ClassifiedCourse[]): HTMLElement | null {
    // The MSCSE's summer floor (DGS Handbook §10.3.2; DGS 2026-10-04), the same
    // one the residency row reads; undefined on the Ph.D. tab. Read here, not
    // once at start: the program can change under Reset.
    const summerFloor = summerFullTimeFloor(student.program, (k) => rules.parameters.number(k));
    // Residency (decision Q8): ≥9 entered credits marks a term full-time
    // automatically; these checkboxes cover research-heavy terms that aren't.
    // Only terms from the entry term on: residence is counted in THIS program
    // (2026-09-05 — the engine's residency.ts applies the same guard).
    // EVERY fall and spring from the entry term to the current semester is
    // listed (policy review 2026-10-03; DGS: "List every fall/spring … so a
    // research-only term can be ticked") — a semester with no course row was
    // never shown, so a research-only semester could not be ticked and the
    // Ph.D. run broke there. Summers appear on the MSCSE tab only (§3.3's "one
    // summer session"); on the Ph.D. tab a summer tick changes nothing (§4.3).
    const entry = normalizeEntryTerm(student.entryTerm).term;
    const now = termOfDate(todayIso()); // through the simulated semester in simulation mode, so a planned research-only term can be ticked
    const terms = new Map<number, Term>();
    for (let seq = semesterSeq(entry); seq <= semesterSeq(now); seq++) {
      const t: Term = { season: seq % 2 === 1 ? 'fall' : 'spring', year: Math.floor(seq / 2) };
      terms.set(termIndex(t), t);
    }
    const withSummers = student.program === 'mscse';
    for (const c of student.courses) if (c.origin === 'nd' && termIndex(c.term) >= termIndex(entry) && (withSummers || c.term.season !== 'summer')) terms.set(termIndex(c.term), c.term);
    for (const t of student.fullTimeTermOverrides ?? []) if (termIndex(t) >= termIndex(entry) && (withSummers || t.season !== 'summer')) terms.set(termIndex(t), t);
    if (withSummers) {
      for (const t of [...terms.values()]) if (t.season === 'spring' && termIndex({ season: 'summer', year: t.year }) <= termIndex(now)) terms.set(termIndex({ season: 'summer', year: t.year }), { season: 'summer', year: t.year });
    }
    if (terms.size === 0) return null;
    // A fieldset whose legend is the question (item 5); a term counted
    // automatically is stated as text, not as a disabled ticked box (item 11).
    const box = el(
      'fieldset',
      { class: 'ft-terms' },
      el('legend', { class: 'label' }, `Full-time terms (for residency, ${student.program === 'mscse' ? '§3.3' : '§4.3'})`),
      // The rule behind a selector (DGS 2026-10-04); the semesters stay in view.
      policyFold(
        'fulltime',
        el(
        'p',
        { class: 'hint' },
        fullTimeFloor === undefined
          ? 'The course rules do not give the full-time credit floor (fulltime_credits_min), so no semester is counted from your courses until the DGS adds it. Tick each semester you were registered full-time.'
          : `A semester counts automatically once the courses entered for it add up to ${fullTimeFloor} registered credits (§2.1.2; withdrawn and incomplete courses are registrations too)${summerFloor !== undefined ? `; a summer session at ${summerFloor} (DGS Handbook §10.3.2)` : ''}. Tick a semester you were registered full-time on research or in courses not entered here.`,
        ),
      ),
    );
    // What the ENGINE counts, so the card and the report agree (2026-10-03):
    // superseded same-term duplicates and unrecognised grades are out, a W
    // or an I is in.
    const records = new Map(fullTimeRecordsFrom(classified, student, fullTimeFloor, summerFloor).map((r) => [termIndex(r.term), r] as const));
    let autoCount = 0;
    let tickedCount = 0;
    // Semesters with courses that did not reach full-time (DGS 2026-10-04:
    // "do not hide them. Show those semesters with warning highlights") —
    // they break a residency run, so they are shown, highlighted, and open the
    // selector by themselves.
    let partTimeCount = 0;
    // With a Notre Dame transcript imported (DGS 2026-10-04: "If any of these
    // can be inferred from the transcripts, can they be shown only when they
    // are applicable according to the transcript?"), a semester the record has
    // no Notre Dame course for was not registered — research shows on the
    // transcript as a course — so it is not offered for a full-time tick; the
    // leave and readmission question names it instead (clockFields).
    const ndImported = student.courses.some((c) => c.fromNdTranscript);
    let listed = 0;
    let emptyUnticked = 0;
    for (const [key, t] of [...terms.entries()].sort((a, b) => a[0] - b[0])) {
      const rec = records.get(key);
      const overridden = (student.fullTimeTermOverrides ?? []).some((o) => termIndex(o) === key);
      if (ndImported && rec === undefined && !overridden) continue;
      listed += 1;
      if (rec === undefined && !overridden) emptyUnticked += 1;
      const auto = rec !== undefined && rec.fullTime && !overridden;
      if (overridden) tickedCount += 1;
      if (auto) {
        autoCount += 1;
        // Why it counted, in the engine's order (residency.ts): the semester
        // floor, a summer's own floor (DGS Handbook §10.3.2, MSCSE), or a
        // summer beside a full-time spring or fall (Academic Code §3.6).
        const why =
          rec.term.season !== 'summer' || (fullTimeFloor !== undefined && rec.credits >= fullTimeFloor)
            ? `${fullTimeFloor}+ registered credits entered`
            : summerFloor !== undefined && rec.credits >= summerFloor
              ? `${summerFloor}+ registered credits in a summer session, DGS Handbook §10.3.2`
              : 'a summer session beside a full-time semester, Academic Code §3.6';
        box.append(el('span', { class: 'ft-term ft-auto' }, el('span', { class: 'ft-check', 'aria-hidden': 'true' }, '✓'), ` ${termLabel(t)} — counted automatically (${why})`));
        continue;
      }
      const cb = el('input', {
        type: 'checkbox',
        'data-key': `standing.fullTime.${key}`,
        onchange: (e) => {
          const on = (e.target as HTMLInputElement).checked;
          update((s) => {
            const list = (s.fullTimeTermOverrides ?? []).filter((o) => termIndex(o) !== key);
            if (on) list.push(t);
            s.fullTimeTermOverrides = list;
          });
        },
      });
      cb.checked = overridden;
      const partTime = !overridden && fullTimeFloor !== undefined && rec !== undefined && rec.credits > 0;
      if (partTime) partTimeCount += 1;
      const partTimeText = !partTime
        ? ''
        : rec!.withdrawnOnly
          ? ' — every course withdrawn; tick only if you were registered full-time at census — a withdrawal from the University goes under readmission, below'
          : t.season === 'summer'
            ? ` — not full-time: ${summerFloor !== undefined ? `${rec!.credits} of ${summerFloor}` : rec!.credits} registered credits entered, and neither that spring nor that fall was full-time`
            : ` — not full-time: ${rec!.credits} of ${fullTimeFloor} registered credits entered`;
      box.append(
        el(
          'label',
          { class: partTime ? 'ft-term ft-warn' : 'ft-term' },
          cb,
          partTime
            ? ` ⚠ ${termLabel(t)}${partTimeText}`
            : ` ${termLabel(t)}${rec?.withdrawnOnly ? ' — every course withdrawn; tick only if you were registered full-time at census — a withdrawal from the University goes under readmission, below' : rec !== undefined && rec.credits > 0 && !overridden ? ` (${rec.credits} registered credits entered)` : ''}`,
        ),
      );
    }
    // The common case is every semester counted from the courses entered; the
    // list, and its ticks for a research-only semester, sit behind a selector
    // that says how many counted (DGS 2026-10-03). Open once a tick is on file.
    // Shown only when there is something to act on (DGS 2026-10-04): a
    // semester not full-time, a tick on file, or an empty semester that may
    // have been research only. Every semester counted from the courses needs
    // nothing here — the residency row says so.
    if (listed === 0 || (partTimeCount === 0 && tickedCount === 0 && emptyUnticked === 0)) return null;
    return rareFold(
      'fulltime',
      `Full-time semesters for residency: ${autoCount} of ${listed} counted from your courses${tickedCount > 0 ? `, ${tickedCount} ticked by you` : ''}${partTimeCount > 0 ? `, ${partTimeCount} not full-time` : ''}`,
      // Closed by default; open only while a semester shows a warning (DGS
      // 2026-10-04: "Keep … hidden by default … Open it if a warning is shown
      // there"). A tick on file is in the summary line.
      partTimeCount > 0,
      box,
    );
  }

  // ---------- coursework ----------

  /** The §5.2 transfer cap that applies to this student, as the engine reads
   * it (audit.ts capSpecs) — for the coursework card's explanation. */
  function totalCreditsWord(): string {
    const v = rules.parameters.number(student.program === 'mscse' ? 'ms_total_credits_min' : 'phd_total_credits_min');
    return v === undefined ? 'required' : String(v);
  }
  function regularCreditsWord(): string {
    const v = rules.parameters.number(student.program === 'mscse' ? 'ms_regular_credits_min' : 'phd_regular_credits_min');
    return v === undefined ? 'required' : String(v);
  }
  function fourkCreditsWord(): string {
    const v = rules.parameters.number(student.program === 'mscse' ? 'ms_4xxxx_credits_max' : 'phd_4xxxx_cse_credits_max');
    return v === undefined ? 'a limited number of' : String(v);
  }
  // Academic Code §4.6's six, in code since 2026-10-07 (P3-sheet-5 (a)).
  function sharedCreditsWord(): string {
    return String(BS_SHARED_CREDITS_MAX);
  }
  /** Whether a document states this student's transfer limit (P3-cse-5-6-1):
   * after a completed degree, or an unfinished master's — not with no earlier
   * graduate program, nor after an unfinished Ph.D. (Academic Code §4.6 states
   * no figure for either). */
  function transferLimitStated(): boolean {
    if (student.priorMs === 'completed') return true;
    if (student.priorMs === 'unfinished') return !student.courses.some((c) => c.origin === 'transfer' && c.degreeLevel === 'phd');
    return false;
  }
  function transferCapLimit(): string {
    const key =
      student.program === 'mscse'
        ? student.priorMs === 'completed' ? 'ms_transfer_completed_ms_credits_max' : 'transfer_unfinished_ms_credits_max'
        : student.priorMs === 'completed' ? 'phd_transfer_completed_ms_credits_max' : 'transfer_unfinished_ms_credits_max';
    const n = rules.parameters.number(key);
    return n === undefined ? 'a capped number of' : String(n);
  }

  function coursesCard(courseLines: CourseLine[]): HTMLElement {
    // The GPA lives here, next to the transcript import that prefills it
    // (moved from the standing card — DGS request, 2026-09-03).
    const { input: gpaInput, error: gpaError } = rangedNumber({
      key: 'courses.gpa',
      range: GPA_RANGE,
      value: student.gpa === undefined ? '' : String(student.gpa),
      allowEmpty: true, // the GPA is optional until it is entered; §2.2 then says so
      attrs: { step: '0.01' },
      commit: (value) =>
        update((s) => {
          s.gpa = value;
          s.gpaSource = undefined; // typed by hand — no longer the transcript's figure
        }),
    }, refusedValues, toast);
    // Which figure the GPA is (combined-transcript bug report 2026-09-05): a
    // Notre Dame transcript carries one cumulative GPA per level, and the
    // graduate one can include an earlier graduate program at Notre Dame.
    const gs = student.gpaSource;
    const gpaNote =
      gs === undefined || student.gpa === undefined
        ? null
        : el(
            'p',
            { class: 'hint gpa-note' },
            // §2.2 reads the registrar's cumulative GPA (Academic Code §4.5);
            // this program's own average is information, and the §2.2 row
            // asks the DGS when the two straddle the minimum (policy review 2026-10-03).
            gs.basis === 'transcript-graduate'
              ? `From your transcript's graduate-level cumulative GPA — the registrar's figure, which §2.2 reads (Academic Code §4.5)${gs.programGpa !== undefined ? `; for information, this program's courses alone average ${gs.programGpa.toFixed(2)}` : ''}${gs.undergraduateGpa !== undefined ? `; the undergraduate GPA (${gs.undergraduateGpa.toFixed(2)}) is not used` : ''}.`
              : `Computed from this program's graded courses only — a figure from an older import${gs.transcriptGpa !== undefined ? `; §2.2 reads the registrar's cumulative GPA, ${gs.transcriptGpa.toFixed(2)} on your transcript (Academic Code §4.5), so re-import the transcript or type that figure` : ''}.`,
          );
    // No earlier Notre Dame program on the record (its earlier one was at
    // another university, P3-dh-3.14-3.20-3): "graduate", never "master's".
    // A transfer from the MSCSE beside a degree elsewhere too (P3-prior-programs-2).
    const bg = student.background;
    const noEarlierNdProgram = student.ndMasters === undefined && (bg?.graduate === 'elsewhere' || (bg?.graduate === 'nd-mscse-transfer' && bg.alsoElsewhere === true));
    // An MSCSE student's Notre Dame course taken in or before the bachelor's
    // term is undergraduate coursework whatever its registered level (the
    // engine's own test, allocate.ts): it is listed with the §3.5 intro, not
    // §5.2's transfer paragraph (UI review, 2026-10-08). Ph.D. records are
    // unchanged (P3-cse-5-6-3).
    const takenAsUndergraduate = (c: CourseEntry): boolean =>
      c.degreeLevel === 'bachelors' ||
      (student.program === 'mscse' && isNotreDameInstitution(c.institution) && student.bachelorsAwarded !== undefined && termIndex(c.term) <= termIndex(student.bachelorsAwarded));
    const priorNdCourseworkWord = (c: CourseEntry): string =>
      takenAsUndergraduate(c)
        ? 'undergraduate'
        : noEarlierNdProgram
          ? 'graduate'
          : c.degreeLevel === 'phd'
            ? 'Ph.D.'
            : student.ndMasters !== undefined
              ? 'MSCSE'
              : c.degreeLevel === 'masters'
                ? 'master’s'
                : 'graduate';
    // Group the list by university + degree (2026-09-03): Notre Dame first,
    // then one section per (university, transcript) in first-seen order.
    const all = student.courses.map((c, index) => ({ c, index }));
    const nd = all.filter(({ c }) => c.origin === 'nd');
    const groups: { heading: string; bachelors: boolean; nd: boolean; entries: { c: CourseEntry; index: number }[]; hidden: number }[] = [];
    for (const e of all.filter(({ c }) => c.origin === 'transfer')) {
      const slot = e.c.degreeLevel
        ? (DEGREE_SLOTS.find((sl) => sl.level === e.c.degreeLevel)?.label ?? e.c.degreeLevel)
        : 'graduate coursework (§5.2)';
      // Prior Notre Dame coursework (2026-09-05): an earlier Notre Dame degree
      // read from the same transcript — named for what it is.
      const priorNd = isNotreDameInstitution(e.c.institution);
      // Which earlier Notre Dame degree (DGS 2026-09-22: "clarify whether that
      // is MS or PhD"): the MSCSE when the student holds one, else the row's
      // own level; "graduate" only when neither says.
      const heading = priorNd
        ? `ND, before entering the program — ${priorNdCourseworkWord(e.c)} coursework`
        : `${e.c.institution ?? 'University not set'} — ${slot}`;
      let g = groups.find((x) => x.heading === heading);
      if (!g) {
        g = { heading, bachelors: priorNd ? takenAsUndergraduate(e.c) : e.c.degreeLevel === 'bachelors', nd: priorNd, entries: [], hidden: 0 };
        groups.push(g);
      }
      // Undergraduate courses (DGS request 2026-09-04): only the ones that can
      // matter are listed — a title suggesting a §4.4.1 core area, a course
      // the DGS has already ruled on, or (Notre Dame) a course the Courses tab
      // tags with a core area. The rest stay in the saved data but out of the
      // way (undergraduate credits never transfer, §5.2).
      //
      // Notre Dame's own undergraduate coursework can do more than demonstrate
      // a core area (2026-09-11): 60000-level courses count in full and CSE
      // courses below that may count inside the degree's allowance, so those
      // rows are listed too — hiding one hid a course the report was counting.
      // §4.4.1 is the Ph.D. qualifier's; an MSCSE student has no core-knowledge
      // requirement, so a core-sounding title is not a reason to list an
      // undergraduate course for them (DGS 2026-09-11).
      const qualifierApplies = student.program === 'phd';
      const rule = resolveRuleRow(rules, e.c.courseId, e.c.term);
      if (
        g.bachelors &&
        !(qualifierApplies && CORE_TITLE_RE.test(e.c.title ?? '')) &&
        !(qualifierApplies && findExternalRule(rules.external, e.c.institution ?? '', e.c.courseId)) &&
        !(qualifierApplies && priorNd && rule?.coreArea) &&
        !(priorNd && priorNdUndergraduateCanCount(e.c, rule, student.program))
      ) {
        g.hidden += 1;
        continue;
      }
      g.entries.push(e);
    }
    /** §5.2 said once, above every prior-graduate group (clarity review
     * 2026-09-26; until then it appeared only while a group still held a
     * candidate, so a student whose every course was refused saw three
     * struck-through rows and no rule). The three conditions the page checks
     * are named with their numbers from the Parameters tab; the cap, the CSE
     * norm and the two approvals stay as the DGS worded them (2026-09-06,
     * trimmed 2026-09-18). "Candidate" is the DGS's word. */
    const transferRule = (fromNotreDame: boolean): string => {
      const windowYears = rules.parameters.number(student.program === 'mscse' ? 'ms_transfer_window_years' : 'phd_transfer_window_years');
      const floor = rules.parameters.gradeLetter('transfer_min_grade');
      // The same term the engine measures from (allocate.ts normalises the
      // entry term), so the two can never drift (policy review 2026-10-03).
      const entry = normalizeEntryTerm(student.entryTerm).term;
      const cutoff = windowYears === undefined ? undefined : termLabel({ season: entry.season, year: entry.year - windowYears });
      const window = windowYears === undefined ? 'within the years §5.2 allows (the number is missing from the rules sheet)' : `within ${windowYears} years before you entered (${cutoff} or later)`;
      const grade = floor === undefined ? 'with the grade §5.2 requires (missing from the rules sheet)' : `with a grade of ${floor} or better (the DGS decides pass/fail grades)`;
      // Shortened in place (UI review item 3; DGS 2026-10-09: option (b)):
      // the three checks, every role, § and the timing kept.
      return (
        `Transfer credit (§5.2): a graduate course from ${fromNotreDame ? 'your earlier Notre Dame program' : 'another university'} can count if you took it after your bachelor’s degree, ${window}, and ${grade} — this page checks those three. ` +
        `Which courses transfer (normally CSE-related ones, ${transferLimitStated() ? `up to ${transferCapLimit()} credits` : `and how much — no document sets a limit for your case; this page holds it to ${transferCapLimit()} until the DGS decides`}) is the DGS’s recommendation, approved by the Graduate School and recorded by the Grad Admin once your official transcript reaches the Graduate School. ` +
        `Until the DGS decides, every graduate course here is a candidate: send the review request (Transcripts card) at any time; the processing request (below the milestones) goes to the Grad Admin after your first semester, before the semester your degree is conferred.`
      );
    };
    const card = el(
      'section',
      { class: 'card', id: 'coursework' },
      // The section chip shows the handbook's text on hover (DGS 2026-10-05).
      el('h2', {}, el('span', { class: 'step-no' }, '3. '), 'Coursework ', sectionRef(student.program === 'mscse' ? '§3.2' : '§4.2', { className: 'chip-note', dataKey: 'secref.coursework' })),
      // "Graduate-level" (P1-gpa-c4, DGS 2026-10-03): a 4+1 or combined-transcript student
      // typing by hand must not enter the undergraduate or all-levels figure.
      field('Graduate-level cumulative GPA (from your transcript, §2.2)', gpaInput),
      gpaError,
      gpaNote,
      // In the mode (D10): a planned course needs the grade the student
      // expects — the form's default, In progress, never counts as complete.
      simulation ? el('p', { class: 'hint simulation-hint' }, 'In this simulation, give each course you plan to take the grade you expect — a course left “In progress” never counts as complete.') : null,
      courseForm(),
      el('h3', { class: 'subhead', id: 'nd-courses' }, 'ND'),
      // The marks defined once, above the first table, and the one handbook
      // term that decides most of the credits (clarity review 2026-09-26).
      // One toggle for the "Counts toward" link rows (DGS 2026-09-27, "3 is
      // fine"): a plain ✓ course hides its list until asked — 35 links stood
      // on the first screen — while a conditional line ("Will count toward")
      // always shows its own. Session-only, never saved; print shows them all.
      el(
        'label',
        { class: 'check feeds-toggle' },
        (() => {
          const cb = el('input', { type: 'checkbox', 'data-key': 'courses.feeds', onchange: (e) => { showFeeds = (e.target as HTMLInputElement).checked; update(() => {}); } }) as HTMLInputElement;
          cb.checked = showFeeds;
          return cb;
        })(),
        ' Show which requirements each course feeds',
      ),
      el(
        'p',
        { class: 'hint course-key' },
        'Key: ✓ counts · ◐ in progress · ● pending approval · ',
        el('span', { class: 'x-glyph' }, '✕'), // the table's own ✕ (style.css)
        ` does not count. Regular courses are the lecture courses the course rules list as regular; seminar, research and project credits count toward the ${totalCreditsWord()} total only (${student.program === 'mscse' ? '§3.2' : '§4.2'}).`,
      ),
      nd.length > 0
        ? courseTable(courseLines, nd)
        : el('p', { class: 'empty' }, 'No ND courses yet. Import your transcript above, or add one here.'),
      ...groups.flatMap((g) => [
        el('h3', { class: 'subhead' }, g.heading),
        g.bachelors
          ? el(
              'p',
              { class: 'hint' },
              (g.nd
                ? student.program === 'phd'
                  ? `Notre Dame courses you took as an undergraduate appear here when they can do something for the Ph.D.: earn credit (60000-level courses in full; up to ${fourkCreditsWord()} credits of CSE courses below that, §4.2), or show you already know a core area — Algorithms, Operating Systems, Computer Architecture (§4.4.1). Where a course could earn credit, say next to it whether your bachelor’s degree already used it — no course may count toward three degrees.`
                  : // The 60000-level clause follows the 4+1 answer (policy review
                    // round 3, P3-fourplusone-6 / P3-text-ui-1): only an Integrated
                    // B.S. + M.S. student counts them — those the bachelor's did
                    // not use, from any undergraduate term (DGS 2026-10-07).
                    `Notre Dame courses you took as an undergraduate appear here when they can count toward the MSCSE: ${
                      student.integratedBsMs === true
                        ? '60000-level courses your bachelor’s degree did not use, whenever you took them, and CSE courses below that inside §3.2’s allowance'
                        : student.integratedBsMs === false
                          ? 'CSE courses below the 60000 level inside §3.2’s allowance — 60000-level courses you took as an undergraduate do not count (§3.5); only students in the Integrated B.S. + M.S. program may count them'
                          : 'CSE courses below the 60000 level inside §3.2’s allowance, and 60000-level courses only if you were in the Integrated B.S. + M.S. (4+1) program (§3.5) — the earlier-degrees questions in the Transcripts card ask whether you were'
                    }. Up to ${sharedCreditsWord()} credits may apply to both your bachelor’s degree and your MSCSE (§3.5). This page chose them for you — your 40000-level CSE courses first, best grade first — and each course’s line says whether it will apply to both degrees, to your MSCSE only, or why it does not count.`
                : student.program === 'phd'
                  ? `Courses taken as an undergraduate student do not transfer, whether or not the course itself is a graduate course (§5.2). Only courses relevant to the Algorithms, Operating Systems, and Computer Architecture core-knowledge areas (§4.4.1) are listed here`
                  : `Courses taken as an undergraduate student do not transfer, whether or not the course itself is a graduate course (§5.2), and they satisfy nothing else in the MSCSE — so none of them is listed here`) +
              `${g.hidden > 0 ? ` ${plural(g.hidden, 'other course')} from this transcript ${g.hidden === 1 ? 'is' : 'are'} not shown.` : ''}`,
            )
          : // A group that is all accepted credit on the Notre Dame record
            // (P3-import-1, Option 1; DGS 2026-10-05): the candidate rule
            // does not apply to it.
            g.entries.length > 0 && g.entries.every(({ c }) => ndPostingOf(c) !== undefined)
            ? el('p', { class: 'hint' }, `Accepted transfer credit on your Notre Dame transcript: the Graduate School approved these courses and recorded them (Academic Code §4.6), so they count at the hours your record shows, with no review or processing request. Credit posted before you entered this program, or whose level the transcript does not show, waits for the DGS to confirm it counts toward this degree.`)
            : // The student's own MSCSE is not transfer credit (P3-cse-5-6-3):
              // the standing card's sentence, not §5.2's paragraph.
              g.nd && holdsOwnMscse()
              ? el('p', { class: 'hint' }, ownMscseSentence())
              : // Notre Dame courses from before admission, the earlier program
                // being at another university (P3-dh-3.14-3.20-3, option (c)).
                g.nd && noEarlierNdProgram
                ? el('p', { class: 'hint' }, `Notre Dame graduate courses from before you were admitted, while your earlier graduate program was at another university: they are not credit from an earlier Notre Dame program, so §5.2’s transfer allowance does not apply to them. If you took them as a non-degree student, at most ${NON_DEGREE_CREDITS_MAX} such credits may count (Academic Code §2.3); the DGS decides each course, with the Graduate School — send the review request.`)
                : // Earlier Notre Dame graduate coursework while the earlier
                  // degrees are unanswered (UI review, 2026-10-08): the answer
                  // decides how it counts, so the pointer comes before §5.2.
                  g.nd && student.background === undefined
                  ? el('p', { class: 'hint' }, 'How these courses count depends on your earlier degrees — answer the ', el('a', { href: '#earlier-degrees' }, 'questions in the Transcripts card'), ' first.')
                  : el('p', { class: 'hint' }, transferRule(g.nd)),
        g.entries.length > 0
          ? courseTable(courseLines, g.entries)
          : el('p', { class: 'empty' }, student.program === 'phd' ? 'No core-area-relevant courses on this transcript.' : 'No courses from this transcript can count toward the MSCSE.'),
      ]),
    );
    // The way into simulation mode, where a student planning courses is
    // looking (D8; DGS 2026-10-09: "make something to let students see and
    // know they can enter the simulation mode") — outside the mode only.
    if (!simulation) {
      card.append(
        el(
          'div',
          { class: 'simulate-foot' },
          el('p', { class: 'hint' }, 'Planning ahead? Simulate a future semester: pick the semester, add the courses and milestones you expect, and see how the report would read then — your record stays as it is.'),
          el('div', { class: 'save-buttons' }, simulateButton('coursework.simulate')),
        ),
      );
    }
    return card;
  }

  // ---------- transcripts (one upload home, 2026-09-03) ----------

  // All four transcript imports in one card, FIRST on the page (2026-09-03):
  // the Notre Dame unofficial transcript (fills the coursework table and GPA
  // below) and the three prior-university slots from external-upload.ts. While
  // a preview is open, every import button is blocked until the student
  // confirms (or cancels) it — one transcript at a time.
  function transcriptsCard(): HTMLElement {
    const busy = ndPreviewOpen() || importsBusy();
    // In simulation mode every import is inactive with its reason (D6): a
    // transcript is real data; the mode holds a plan.
    const inSimulation = simulation !== undefined;
    const ndArgs: NdUploadArgs = { student, rules, update, toast, toastWithAction, render, blocked: busy, simulation: inSimulation, setFocusAfterRender, refusedValues, todayIso: realTodayIso };
    // "Start here" made prominent (DGS 2026-09-15): a filled badge in the
    // heading and a bold callout line above the hint — until a transcript is
    // on the record (UI review item 4; DGS 2026-10-08: option (b)): a prompt
    // to start above "18 courses from your transcript" read oddly. A row from
    // an uploaded transcript is flagged (Notre Dame) or carries its slot's
    // degree level (another university; hand-typed rows have none).
    const fresh = !student.courses.some((c) => c.fromNdTranscript === true || (c.origin === 'transfer' && c.degreeLevel !== undefined));
    return el(
      'div',
      { class: 'card external-card' },
      el('h2', {}, el('span', { class: 'step-no' }, '1. '), 'Transcripts ', ...(fresh ? [el('span', { class: 'chip-start' }, 'Start here')] : [])),
      ...(fresh ? [el('p', { class: 'start-callout' }, 'Import your transcripts, and most of the page below fills itself in.')] : []), // the badge beside the title already says START HERE (DGS 2026-09-19, P-52)
      // Shorter sentences (usability review 2026-09-05, item 10): the same
      // facts, none over 25 words. "Nothing is uploaded" is the strip line
      // above, the toast during the read and the OCR opt-in; the card keeps
      // what is specific to it (trim review 2026-09-18, P-20).
      el(
        'p',
        { class: 'hint' },
        // Shortened 2026-10-07 (DGS: "see any texts can be shortened without
        // losing its meaning").
        el('strong', {}, 'System-generated PDFs are read exactly;'),
        ' scans and photos are read by text recognition (OCR, English only) if you agree. You check every row before it is added.',
      ),
      // Unofficial transcripts read best (DGS observation 2026-09-05): the web /
      // self-service PDF is single-column and carries no watermark; official
      // ones (two columns, security bands) are read too, less reliably.
      busy
        ? el('p', { class: 'hint warn' }, 'One transcript at a time: confirm the open preview below (“Add …”) or cancel it before importing another PDF.')
        : null,
      // Said once above the four inactive buttons, so the card does not read
      // as broken; each button repeats the reason on hover and click.
      inSimulation ? el('p', { class: 'hint simulation-hint' }, 'In simulation mode the imports are off — a transcript is real data; exit the simulation to import it into your record.') : null,
      ndTranscriptUpload(ndArgs),
      ndPreviewOpen() ? ndTranscriptPreviewBlock(ndArgs) : null,
      ...priorTranscriptSection({ student, rules, update, toast, toastWithAction, render, blocked: busy, simulation: inSimulation, setFocusAfterRender, todayIso: realTodayIso }),
    );
  }

  // ---------- ask the DGS (ONE review request, 2026-09-03) ----------

  // Everything that still needs a DGS decision, in one card with one copy
  // button and one email: Notre Dame courses that are not in the rules sheet
  // (typical for non-CSE), dgs_approval and not yet approved, or blank-verdict
  // — plus external courses the ExternalCourses tab has not ruled on. The
  // student MUST email the request to the DGS and the Graduate Program
  // Administrator; the page itself sends nothing.
  function askDgsCard(classified: readonly ClassifiedCourse[], report: AuditReport): HTMLElement | null {
    // Which courses need a DGS decision, and why, is the engine's call
    // (src/engine/review.ts, 2026-09-06 evening — with the test matrix that
    // pins it); this card only lists them and builds the copy-ready request.
    const pending = coursesNeedingDgsReviewFor(classified, student);
    const n = pending.length;
    // Notes that are not about one course: the audit's review flags (a 4+1
    // with many undergraduate graduate-level courses counted, 2026-09-12; a
    // full-time semester without three graduate-level credits, Academic Code
    // §4.1, 2026-10-03 — whose warning says it is in this request) and the
    // checks on a `yes` the DGS may not have meant (2026-10-04, P1-sheet-48 /
    // -c2). Read from the report, so the page and the request say the same.
    const notes = [...(report.reviewFlags ?? []), ...(report.staffChecks ?? [])];
    if (n === 0 && notes.length === 0) return null;
    const what = reviewRequestSummary(n, notes.length > 0);
    const decider = deciderContact(student.program);
    // The two course lists — Courses-tab rows and ExternalCourses rows
    // (transcript/external.ts reviewRequestCourses; P3-dh-10-2).
    const slotOf = (p: PendingDgsReview): string | undefined =>
      p.course.entry.degreeLevel ? (DEGREE_SLOTS.find((sl) => sl.level === p.course.entry.degreeLevel)?.label ?? p.course.entry.degreeLevel) : undefined;
    const where = (p: PendingDgsReview): string =>
      p.kind === 'nd' ? 'Notre Dame' : p.kind === 'priorNd' ? 'Notre Dame, before entry' : (p.course.entry.institution ?? 'other university');
    const line = (courseId: string, where: string | undefined, reason: string) =>
      el('div', { class: 'review-line', 'data-keep-dgs': '' }, el('span', { class: 'cid' }, courseId), `${where ? ` (${where})` : ''} — ${reason}`);
    return el(
      'div',
      { class: 'card dgs-review', id: 'dgs-review' },
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
        ? [el('p', { class: 'hint simulation-hint' }, `In simulation mode nothing is sent: these are the courses this plan would put before the ${deciderTitle(student.program)} — exit the simulation to send the review request from your record.`)]
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
      ...pending.map((p) => line(p.course.entry.courseId, where(p), p.reason)),
      ...notes.map((t) => el('div', { class: 'review-line review-note', 'data-keep-dgs': '' }, el('span', { class: 'cid' }, 'Note'), ` — ${t}`)),
      el(
        'div',
        { class: 'save-buttons' },
        // In the mode the button is inactive with its reason (D7): no request
        // leaves a plan — `inactiveButton`, so the reason can be shown.
        simulation
          ? inactiveButton({ class: 'btn', 'data-key': 'review.copy' }, simulationSendNote('the review request'), toast, `Initiate the review request for ${what}`)
          : el(
          'button',
          {
            class: 'btn',
            'data-key': 'review.copy',
            onclick: () => {
              // Copy, then the check-before-you-send dialog (DGS request 2026-09-06 evening).
              void import('../transcript/external.ts').then(({ buildCombinedReviewRequest, reviewRequestCourses }) => {
                const { nd: ndReq, external: extReq } = reviewRequestCourses(pending, slotOf);
                const built = buildCombinedReviewRequest({ priorStudy: priorStudyLabel(student), nd: ndReq, external: extReq, notes, history: programHistory(student), unofficial: unofficialTranscriptNote(student.courses), decider: deciderTitle(student.program), stamp: checkedWithLine(stamp), universityRow: (u) => (universityCreditSystem(rules.universityCreditSystems, u) !== undefined ? 'set' : rules.universities.some((r) => r.universityKey === normalizeUniversity(u)) ? 'blank' : 'absent') });
                return copyDialog({
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
              });
            },
          },
          `Initiate the review request for ${what}`,
        ),
      ),
    );
  }

  function courseForm(): HTMLElement {
    // Visible labels instead of placeholders (usability review 2026-09-05,
    // item 5): a placeholder vanishes as soon as the student types.
    const idInput = el('input', { list: 'known-courses', class: 'course-id', id: 'new-course-id', 'data-key': 'course.new.id', 'aria-describedby': 'new-course-id-hint' });
    const idError = errorLine('new-course-id-error');
    const titleInput = el('input', { class: 'course-title', 'data-key': 'course.new.title' });
    const creditsInput = el('input', {
      type: 'number',
      min: String(COURSE_CREDITS_RANGE.min),
      max: String(COURSE_CREDITS_RANGE.max),
      step: '0.5',
      value: '3',
      'data-key': 'course.new.credits',
      id: 'new-course-credits',
    });
    const creditsError = errorLine('new-course-credits-error');
    const seasonSel = el('select', { 'aria-label': 'Term — semester', 'data-key': 'course.new.season' });
    seasonSel.append(...seasonOptions());
    const yearInput = el('input', {
      type: 'number',
      min: String(TERM_YEAR_RANGE.min),
      'aria-label': 'Term — year',
      'data-key': 'course.new.year',
      value: String(termOfDate(todayIso()).year), // the year at Notre Dame, like every other date on the page — not the device clock; the simulated year in simulation mode
    });
    const termYearError = errorLine('new-course-year-error');
    const gradeSel = el('select', { 'data-key': 'course.new.grade' });
    for (const g of GRADES) gradeSel.append(option(g, gradeLabel(g), g === 'IP'));
    const originSel = el('select', { 'data-key': 'course.new.origin' });
    originSel.append(option('nd', 'Taken at Notre Dame', true), option('transfer', 'From another university'));
    // University: offered from the ExternalCourses tab, Title-Cased on leaving
    // the box (DGS 2026-09-06 evening); matching ignores case anyway.
    const institutionInput = el('input', { list: 'known-universities', 'data-key': 'course.new.institution' });
    institutionInput.addEventListener('change', () => {
      (institutionInput as HTMLInputElement).value = canonicalUniversityName((institutionInput as HTMLInputElement).value);
    });
    // Level for a course from another university — two choices since
    // 2026-09-06 (DGS: the generic "graduate coursework" overlapped with
    // "from a previous Master's / Ph.D."): Graduate (after the bachelor's; a
    // §5.2 transfer candidate; saved with NO degree level, so the row belongs
    // to no transcript slot and groups under "graduate coursework (§5.2)") or
    // Undergraduate (before it; earns no transfer credit but can satisfy
    // §4.4.1 core knowledge once the DGS confirms it). The Master's/Ph.D.
    // distinction stays with the transcript slots and "Prior graduate study".
    const levelSel = el('select', { 'data-key': 'course.new.level' });
    // "… student" (DGS 2026-09-06, late evening): the choice is the student's
    // status at the time, never the course's level.
    levelSel.append(option('', 'Grad student — after your bachelor’s degree was awarded (can transfer, §5.2)', true));
    levelSel.append(
      option(
        'bachelors',
        student.program === 'phd'
          ? 'UG student — before your bachelor’s degree was awarded (core knowledge only, no transfer credit)'
          : 'UG student — before your bachelor’s degree was awarded (no transfer credit)',
      ),
    );
    const groupSel = el('select', { 'data-key': 'course.new.group' });
    groupSel.append(option('', 'Assign a specialization group…'));
    for (const g of rules.categoryGroups) groupSel.append(option(g.code, `Count as: ${g.name}`));
    // The optional controls are shown/hidden with their labels.
    const institutionField = labelWrap('University', institutionInput, '(as your transcript prints it — pick it from the list if it is there)');
    const levelField = labelWrap('Taken as', levelSel, '(your status when you took it — not the course’s level)');
    const groupField = labelWrap('Specialization group (§4.4.2)', groupSel);
    institutionField.classList.add('hidden');
    levelField.classList.add('hidden');
    groupField.classList.add('hidden');

    originSel.addEventListener('change', () => {
      const transfer = (originSel as HTMLSelectElement).value === 'transfer';
      institutionField.classList.toggle('hidden', !transfer);
      levelField.classList.toggle('hidden', !transfer);
    });

    idInput.addEventListener('input', () => clearInvalid(idInput, idError, 'new-course-id-hint'));
    idInput.addEventListener('change', () => {
      const id = canonicalCourseId(idInput.value);
      idInput.value = id;
      const term: Term = { season: (seasonSel as HTMLSelectElement).value as Season, year: Number(yearInput.value) };
      const rule = resolveRuleRow(rules, id, term);
      if (rule) {
        titleInput.value = rule.title;
        creditsInput.value = String(rule.creditsDefault ?? rule.creditMin ?? 3);
        // A course may be listed under one group, several, or every group
        // (DGS 2026-09-08): the picker appears whenever there is a choice.
        const choices = groupsOf(rule, rules);
        const choosable = choices.length > 1 && student.program === 'phd';
        groupField.classList.toggle('hidden', !choosable);
        if (choosable) {
          toast(
            choices.length === rules.categoryGroups.length
              ? `${id} is listed under every specialization group (§4.4.2) — pick whichever group you still need.`
              : `${id} is listed under ${choices.length} specialization groups (§4.4.2) — pick whichever you still need.`,
          );
        }
      } else {
        groupField.classList.add('hidden');
      }
    });

    /** Refuse one out-of-range box in this form, the same way the course
     * number is refused: the message stays beside the field, the course is not
     * added, and nothing typed is lost (R1, 2026-09-18 — a course entered at
     * 999 credits, in a box whose `max` is 15, used to be accepted and to put
     * "1005 pending review/approval" on the 60-credit row). */
    const refuseEntry = (input: HTMLElement, error: HTMLElement, message: string): void => {
      markInvalid(input, error, message);
      toast(message); // heard as well as seen (the polite live region)
      input.focus();
    };
    creditsInput.addEventListener('input', () => clearInvalid(creditsInput, creditsError));
    yearInput.addEventListener('input', () => clearInvalid(yearInput, termYearError));

    const add = async () => {
      const id = canonicalCourseId(idInput.value);
      if (!id) {
        // A persistent error next to the field, not a vanishing toast (item 6).
        markInvalid(idInput, idError, 'Enter a course number, such as CSE 60641.', 'new-course-id-hint');
        idInput.focus();
        return;
      }
      const credits = Number((creditsInput as HTMLInputElement).value);
      if (!inRange(credits, COURSE_CREDITS_RANGE)) {
        refuseEntry(creditsInput, creditsError, inputRefusal((creditsInput as HTMLInputElement).value, COURSE_CREDITS_RANGE, 'added'));
        return;
      }
      const termYear = Number((yearInput as HTMLInputElement).value);
      if (!inRange(termYear, TERM_YEAR_RANGE)) {
        refuseEntry(yearInput, termYearError, inputRefusal((yearInput as HTMLInputElement).value, TERM_YEAR_RANGE, 'added'));
        return;
      }
      const entry: CourseEntry = {
        courseId: id,
        title: titleInput.value || undefined,
        credits,
        term: { season: (seasonSel as HTMLSelectElement).value as Season, year: termYear },
        grade: (gradeSel as HTMLSelectElement).value as CourseEntry['grade'],
        origin: (originSel as HTMLSelectElement).value as CourseEntry['origin'],
        typedByStudent: true, // where it came from (DGS 2026-10-11, item 6)
      };
      if (entry.origin === 'transfer') {
        const institution = canonicalUniversityName((institutionInput as HTMLInputElement).value);
      if (institution) entry.institution = institution;
        const level = (levelSel as HTMLSelectElement).value;
        if (level) entry.degreeLevel = level as CourseEntry['degreeLevel'];
      }
      const group = (groupSel as HTMLSelectElement).value;
      if (group && !groupField.classList.contains('hidden')) entry.assignedGroup = group as CourseEntry['assignedGroup'];
      // A course worth no credits counts toward nothing, and a 0 in this box is
      // nearly always a slip or a blank credit-hours column on a transcript. It
      // is allowed — losing the course would be worse — but not without being
      // asked (DGS 2026-09-11).
      if (entry.credits === 0) {
        const yes = await confirmDialog({
          title: `${id} is entered with 0 credits`,
          body: [
            // No number: 30 is the MSCSE total, and this dialog opens on both
            // tabs (trim review 2026-09-18, P-86).
            'A course with no credits counts toward nothing — not the total credits, not the regular-course credits, not any cap. It will appear in your coursework with a line saying so.',
            'Your transcript prints the credit hours beside each course. If this one has a value, cancel and type it in the Credits box.',
          ],
          confirmLabel: 'Add it with 0 credits',
          cancelLabel: 'Go back and fix the credits',
          returnFocusKey: 'course.new.credits',
        });
        if (!yes) return;
      }
      setFocusAfterRender('course.new.id'); // ready for the next course
      // A Notre Dame course dated before the entry term is coursework from an
      // earlier Notre Dame degree, whoever typed it (2026-09-09). The import
      // path has always re-filed those; a hand-typed one used to stay program
      // coursework for good, earning §4.2 credits, §4.3 residence and §4.4.2
      // specialization it cannot earn. The early-start summer just before a
      // fall entry is the exception — its courses are the program's own
      // (P3-chg-other-1; DGS 2026-10-05) — and the toast says which happened.
      let refiled = false;
      let earlyStart = false;
      update((s) => {
        s.courses.push(entry);
        refiled = reclassifyNotreDameCourses(s).toPrior > 0;
        if (refiled) derivePriorMs(s); // a no-op once the earlier-degrees question is answered
        earlyStart = isNotreDameCourse(entry) && isEarlyStartCourse(entry, s);
      });
      // The form empties itself and the report headline often does not change,
      // so without this the click had no visible effect at all (2026-09-08).
      toast(
        `${id} added to your coursework` +
          (refiled
            ? ` — dated before ${termLabel(student.entryTerm)}, so it is filed as coursework from before you entered the program`
            : earlyStart
              ? ` — your early start, the summer before ${termLabel(student.entryTerm)}, so it counts as this program’s coursework`
              : '') +
          '.',
      );
    };

    return el(
      'div',
      { class: 'course-form' },
      knownCoursesList,
      el(
        'div',
        { class: 'row1' },
        el(
          'div',
          { class: 'field inline' },
          el('label', { class: 'label', for: 'new-course-id' }, 'Course number ', el('span', { class: 'label-hint', id: 'new-course-id-hint' }, '(e.g. CSE 60641)')),
          idInput,
          idError,
        ),
        labelWrap('Title', titleInput), // the box fills itself for a listed course — the student sees it (trim review 2026-09-18, P-44)
      ),
      el(
        'div',
        { class: 'row2' },
        labelWrap('Credits', creditsInput),
        fieldset('Term', el('div', { class: 'pair' }, seasonSel, yearInput), 'inline'),
        labelWrap('Grade', gradeSel),
        labelWrap('Where', originSel),
      ),
      // Full width, under the row they belong to: the boxes in row2 are 72 px
      // wide and a refusal sentence is not (R1, 2026-09-18).
      creditsError,
      termYearError,
      // The §4.4.2 group picker exists only for the Ph.D. (2026-09-11: the
      // hidden field still put "§4.4.2" on the MSCSE page).
      el('div', { class: 'row3' }, institutionField, levelField, student.program === 'phd' ? groupField : null, el('button', { class: 'btn primary', 'data-key': 'course.new.add', onclick: add }, 'Add course')),
    );
  }

  // One table per (university, degree) group (2026-09-03) — the group heading
  // above each table carries the university and transcript, so the rows stay
  // uniform. The original index is kept so the delete/assign controls edit
  // the right entry.
  function courseTable(courseLines: CourseLine[], entries: { c: CourseEntry; index: number }[]): HTMLElement {
    const table = el('table', { class: 'courses stack' });
    table.append(
      el(
        'tr',
        {},
        el('th', { scope: 'col' }, 'Course'),
        el('th', { scope: 'col' }, 'Term'),
        el('th', { scope: 'col', abbr: 'Credits' }, 'Cr'),
        el('th', { scope: 'col' }, 'Grade'),
        el('th', { scope: 'col' }, 'Counts toward'),
        el('th', { scope: 'col' }, el('span', { class: 'visually-hidden' }, 'Remove')),
      ),
    );
    // Consume lines as they are matched so two entries of the same course in
    // the same term each get their own line (e.g. a duplicate-entry pair).
    const linePool = [...courseLines];
    entries.forEach(({ c, index }) => {
      const li = linePool.findIndex((l) => l.courseId === c.courseId && termIndex(l.term) === termIndex(c.term));
      const line = li >= 0 ? linePool.splice(li, 1)[0] : undefined;
      const rule = resolveRuleRow(rules, c.courseId, c.term);
      const nameCell = el(
        'td',
        { class: 'cell-course' },
        el('div', { class: 'cid' }, c.courseId),
        el('div', { class: 'ctitle' }, c.title ?? rule?.title ?? ''),
      );
      // The sheet's `notes` are the DGS's working notes and students do not
      // see them (DGS 2026-09-09) — the course-rules page dropped them that
      // day, and this tooltip was missed. It was the more misleading of the
      // two: a Ph.D. student hovering a bridge course was shown a note about
      // the MSCSE ("§3.6 — transition (bridge) courses do not count toward the
      // MSCSE"), which is true and about someone else's degree (2026-09-10).
      // The line's colour (DGS request 2026-09-06): green = earns credit or a
      // core area now, amber = in progress or counted only until an approval,
      // red = earns nothing. A shape per colour, and a spoken word, so the
      // meaning does not rest on colour alone (WCAG 1.4.1).
      const countsCell = el('td', { class: `counts cell-note${line?.mark === 'counts' && !showFeeds ? ' feeds-hidden' : ''}`, 'data-keep-dgs': '' });
      if (line?.qualifier) {
        // Credit and qualifier on two labelled lines, each with its own mark
        // (DGS 2026-09-27): the handbook keeps the two apart, so one course
        // is routinely ✕ for credit and ✓ or ● for §4.4.1.
        countsCell.append(
          el('div', { class: 'credit-line' }, statusMark(line.mark), el('span', { class: 'line-label' }, 'Credit: '), line.text),
          el('div', { class: 'qualifier-line' }, statusMark(line.qualifier.mark), el('span', { class: 'line-label' }, 'Qualifier: '), line.qualifier.text),
        );
      } else if (line) countsCell.append(statusMark(line.mark), line.text);
      // One course routinely serves several requirements, and the sentence
      // above names only the credit pool (DGS request 2026-09-08). List the
      // rest, each linking to its card, and say which are still conditional.
      for (const when of ['now', 'later'] as const) {
        const rows = (line?.counts ?? []).filter((x) => x.when === when);
        if (rows.length === 0) continue;
        const list = el('div', { class: `counts-toward ${when}` }, el('span', { class: 'counts-toward-label' }, when === 'now' ? 'Counts toward: ' : 'Will count toward: '));
        rows.forEach((r, i) => {
          if (i > 0) list.append(el('span', { class: 'sep', 'aria-hidden': 'true' }, ' · '));
          // The short name in the list, the full requirement title on hover.
          list.append(el('a', { class: 'req-link', href: `#${reqAnchorId(r.id)}`, title: r.long }, r.title));
        });
        countsCell.append(list);
      }
      // Simulation mode: what the course rules say about running a planned
      // course (DGS 2026-10-11, item 19) — retired, last offered long ago,
      // off next semester's schedule, or outside its usual season.
      if (simulation) {
        const notes = planNotes(c, rules, termOfDate(realTodayIso));
        if (notes.length > 0) countsCell.append(el('div', { class: 'plan-note' }, el('span', { class: 'line-label' }, 'Schedule: '), `${notes.join('; ')}.`));
      }
      // The DGS's case-by-case approval, recorded on the course it concerns
      // (DGS 2026-09-27): only a course the sheet marks dgs_approval /
      // adgs_approval carries the box; a course not in the sheet goes to the
      // DGS through the review request first, and a `yes` needs no tick.
      if (line?.approvable) {
        const cb = el('input', {
          type: 'checkbox',
          'data-key': `course.${index}.approved`,
          onchange: (e) =>
            update((s) => {
              const entry = s.courses[index];
              if (!entry) return;
              if ((e.target as HTMLInputElement).checked) entry.dgsApproved = true;
              else delete entry.dgsApproved;
            }),
        }) as HTMLInputElement;
        cb.checked = line.approved === true;
        // The cell keeps "DGS" verbatim (its lines are already worded by
        // the engine), so the label names the decider itself.
        countsCell.append(el('label', { class: 'attest course-approval' }, cb, ` The ${deciderTitle(student.program)} approved this course for me`));
      }
      // A dual-degree student's course that also counts toward the other
      // program (Academic Code §2.2; policy review 2026-10-04, P2-ac-1-3-2):
      // offered only once the student said, under Your standing, that they are
      // enrolled in two Notre Dame programs at the same time.
      if (student.concurrentDegree === true && c.origin === 'nd') {
        const shared = el('input', {
          type: 'checkbox',
          'data-key': `course.${index}.sharedWithOtherDegree`,
          onchange: (e) =>
            update((s) => {
              const entry = s.courses[index];
              if (!entry) return;
              if ((e.target as HTMLInputElement).checked) entry.sharedWithOtherDegree = true;
              else delete entry.sharedWithOtherDegree;
            }),
        }) as HTMLInputElement;
        shared.checked = c.sharedWithOtherDegree === true;
        countsCell.append(el('label', { class: 'attest course-approval' }, shared, ' Also counts toward my other degree'));
      }
      const rowChoices = rule ? groupsOf(rule, rules) : [];
      if (rowChoices.length > 1 && student.program === 'phd') {
        const sel = el('select', {
          'aria-label': `Specialization group for ${c.courseId}`,
          'data-key': `course.${index}.group`,
          onchange: (e) =>
            update((s) => {
              const v = (e.target as HTMLSelectElement).value;
              s.courses[index]!.assignedGroup = (v || undefined) as CourseEntry['assignedGroup'];
            }),
        });
        // Which group is worth picking depends on what the student's OTHER
        // courses already cover (DGS request 2026-09-08): the engine works
        // that out, and the options say so rather than leaving a bare list.
        // Only the groups this course is listed under (2026-09-08) — a course
        // named for two groups must not offer the other three.
        const helpful = new Set((groupChoices[c.courseId] ?? []).filter((g) => rowChoices.includes(g)));
        // Short forms in this column (DGS 2026-09-08): the full names do not
        // fit a dropdown beside a course, and the glossary keeps them in full.
        const groupName = (g: string) => groupShortName(rules, g);
        sel.append(option('', 'Assign group…', !c.assignedGroup));
        // Two headings rather than a note on each option: the closed dropdown
        // then shows the plain group name, and opening it shows which choices
        // would actually help (2026-09-08).
        const needed = rowChoices.filter((g) => helpful.has(g));
        const covered = rowChoices.filter((g) => !helpful.has(g));
        if (needed.length > 0 && covered.length > 0) {
          const box = (label: string, codes: readonly string[]): HTMLElement => {
            const grp = el('optgroup', { label });
            for (const g of codes) grp.append(option(g, groupName(g), c.assignedGroup === g));
            return grp;
          };
          sel.append(box('Groups you still need', needed), box('Already covered by another course', covered));
        } else {
          for (const g of rowChoices) sel.append(option(g, groupName(g), c.assignedGroup === g));
        }
        countsCell.append(el('div', {}, sel));
        const names = [...helpful].map(groupName);
        if (names.length > 0 && !(c.assignedGroup && helpful.has(c.assignedGroup))) {
          countsCell.append(
            el(
              'div',
              { class: 'group-hint' },
              `This course can count for any group (§4.4.2). ${
                names.length === 1
                  ? `Choose ${names[0]} — it is the group your other courses do not cover.`
                  : `Choose one your other courses do not cover: ${names.join(', ')}.`
              }`,
            ),
          );
        }
      }
      // Which degrees this course has already been counted toward (Graduate
      // School via the DGS, 2026-09-10 evening). Asked only where the answer
      // can change anything: Notre Dame coursework the student took as an
      // undergraduate, and only when they could already have spent it on two
      // degrees — a Ph.D. student with no Notre Dame master's is never asked,
      // because with two degrees in play nothing can have counted toward two.
      // The MSCSE is never asked (DGS 2026-09-11): the app chooses which courses
      // apply to both degrees and each line says so. Every Ph.D. student is
      // (Graduate School 2026-09-22: at most 6 credits may count toward two
      // degrees, and the bachelor's-and-MSCSE courses use them up first) —
      // and only about a course that COULD count toward this degree (DGS
      // 2026-09-22): a 30000-level or lower course counts toward the
      // bachelor's alone whatever the answer (asksWhichDegrees).
      const holdsNdMasters = student.ndMasters !== undefined;
      if (asksWhichDegrees(c, student, rules)) {
        const selId = `counted-toward-${index}`;
        const sel = el('select', {
          id: selId,
          'aria-label': `Which degrees ${c.courseId} has already counted toward`,
          'data-key': `course.${index}.countedToward`,
          onchange: (e) =>
            update((s) => {
              const v = (e.target as HTMLSelectElement).value;
              s.courses[index]!.countedToward = (v || undefined) as CourseEntry['countedToward'];
            }),
        });
        // "Both" is the only answer that stops the course counting here: no
        // course may count toward three degrees. The others differ for the
        // MSCSE audit, which caps coursework shared with the bachelor's.
        //
        // A student still working on the MSCSE has only two degrees in play —
        // nothing can have counted toward the degree they are doing now — so
        // they are offered only the two answers that can be true (2026-09-11).
        const choices =
          student.program === 'mscse'
            ? ([
                // Two answers only (DGS 2026-09-11): the course counts toward the
                // MSCSE alone, or toward both degrees inside §3.5's six credits.
                // Nothing counts until one is chosen.
                ['', 'Choose…'],
                ['mscse', 'Only my MSCSE'],
                ['both', 'Both my bachelor’s degree and my MSCSE'],
              ] as const)
            : holdsNdMasters
              ? ([
                  ['', 'Already counted toward…'],
                  ['neither', 'Neither — it was extra'],
                  ['bs', 'My bachelor’s degree'],
                  ['mscse', 'My MSCSE'],
                  ['both', 'Both my bachelor’s and my MSCSE'],
                ] as const)
              : // No Notre Dame master's: the only degree that can have used
                // the course is the bachelor's (2026-09-22).
                ([
                  ['', 'Already counted toward…'],
                  ['neither', 'Nothing — it was extra'],
                  ['bs', 'My bachelor’s degree'],
                ] as const);
        for (const [value, label] of choices) {
          sel.append(option(value, label, (c.countedToward ?? '') === value));
        }
        // The question in words above it (UI review, 2026-10-08): the select's
        // first option was the only place it was asked.
        countsCell.append(el('label', { class: 'counted-toward-label', for: selId }, 'Which degrees has this course already counted toward?'), el('div', {}, sel));
        if (c.countedToward === undefined) {
          countsCell.append(
            el(
              'div',
              { class: 'group-hint' },
              student.program === 'mscse'
                ? 'Choose one: this course counts only toward your MSCSE, or toward both your bachelor’s degree and your MSCSE. At most 6 credits may count toward both (§3.5) — once two 3-credit courses are shared, the rest can only count toward the MSCSE. Nothing counts until you choose. Most 40000-level courses also need your advisor’s and the DGS’s approval, so they are listed in the review request.'
                : // The rule said once per row (UI review, 2026-10-08; the
                  // three-degrees sentence as the DGS kept it, P1-units-4plus1-18).
                  holdsNdMasters
                  ? 'It can count here — 60000-level in full, and up to 6 credits below it. No course may count toward three degrees, and at most 6 credits may count toward two (Graduate School); courses your bachelor’s and your MSCSE shared use those 6 first.'
                  : 'It can count here — 60000-level in full for a 4+1 student (with the DGS’s approval otherwise, Academic Code §4.6), and up to 6 credits below it. At most 6 credits may count toward two degrees (Graduate School).',
              // Which degrees used a course is the Registrar's record: a
              // student who does not know asks the DGS (DGS 2026-10-08).
              ' If you are not sure which degrees it counted toward, ask the DGS (',
              mailto(deciderContact(student.program).email),
              ').',
            ),
          );
        }
      }
      // Strike through only courses that count NOTHING — a course partly over
      // a cap still counts its allowed credits.
      // …and a course with a qualifier line of its own is not struck through:
      // it still does something for the degree (2026-09-27).
      const countsNothing = line?.mark === 'excluded' && line.qualifier === undefined;
      // Remove: a named button, and an Undo instead of a confirm dialog
      // (usability review 2026-09-05, item 25) — the row comes back in place.
      const removeButton = el(
        'button',
        {
          class: 'btn tiny remove',
          'aria-label': `Remove ${c.courseId} (${termLabel(c.term)})`,
          title: `Remove ${c.courseId}`,
          'data-key': `course.${index}.remove`,
          onclick: () => {
            const removed = c;
            // Focus moves to the row that takes this one's place (the next
            // course slides into this index), else the previous row, else the form.
            const last = index === student.courses.length - 1;
            setFocusAfterRender(last ? (index > 0 ? `course.${index - 1}.remove` : 'course.new.id') : `course.${index}.remove`);
            update((s) => void s.courses.splice(index, 1));
            toastWithAction(
              `${removed.courseId} removed.`,
              'Undo',
              () => update((s) => void s.courses.splice(Math.min(index, s.courses.length), 0, removed)),
              { focusKey: `course.${index}.remove` },
            );
          },
        },
        '✕',
      );
      const row = el(
        'tr',
        { class: countsNothing ? 'dropped' : '' },
        nameCell,
        // Short form in the cell, full name as the tooltip (DGS 2026-09-07).
        el('td', { class: 'cell-meta', 'data-label': 'Term' }, el('abbr', { class: 'term', title: termLabel(c.term) }, termShort(c.term))),
        el('td', { class: 'cell-meta', 'data-label': 'Credits' }, String(c.credits)),
        // Transfer credit the Notre Dame record shows as accepted prints hours
        // only: no grade, not "in progress" (P3-import-1, 2026-10-05).
        el('td', { class: 'cell-meta', 'data-label': 'Grade' }, c.grade === 'IP' && ndPostingOf(c) !== undefined ? '—' : gradeLabel(c.grade)),
        countsCell,
        el('td', { class: 'cell-remove' }, removeButton),
      );
      table.append(row);
    });
    // The table scrolls inside its card on narrow screens instead of widening
    // the whole column (usability review 2026-09-05, item 1); the wrapper is
    // focusable so a keyboard user can scroll it (WCAG 2.1.1).
    return el('div', { class: 'table-scroll plain', tabindex: '0', role: 'region', 'aria-label': `${entries[0]?.c.institution ?? 'ND'} course table (scrolls sideways on narrow screens)` }, table);
  }

  // ---------- milestones + attestations ----------

  // "Ask the Grad Admin to process" (DGS request 2026-09-06 evening): the
  // other half of the two roles. The DGS decides eligibility (the review
  // request above); the Grad Admin processes what has been decided and keeps
  // the official record. Placed after the milestones, whose dates it reports.
  function askGradAdminCard(built: ReturnType<typeof gradAdminRequest>): HTMLElement {
    const n = built.items.count;
    const decider = deciderContact(student.program);
    // The Grad Admin needs the original transcripts only to process §5.2
    // transfer credit; nothing else in the request is decided from a PDF, so
    // the attach step, the email's "Attached:" line and the card's clause
    // appear only when a transfer is in it (trim review 2026-09-18, P-45).
    const needsTranscripts = built.items.transfers.length > 0;
    const label = 'Initiate the request';
    const attrs = { class: 'btn', 'data-key': 'gradadmin.copy' };
    const button = simulation
      ? // In the mode nothing is sent (D7): inactive with its reason, whatever the count.
        inactiveButton(attrs, simulationSendNote('the processing request'), toast, label)
      : n === 0
        ? inactiveButton(
            attrs,
            'Nothing to process yet — this button becomes active as soon as any requirement is met, or a transfer credit the DGS has approved, a milestone date, or the MSCSE along the way appears in your record.',
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
            'Nothing to process yet — this fills in as requirements are met and milestones are dated. The Grad Admin (',
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
            student.program === 'phd'
              ? ') records it — transfer credit (§5.2), the qualifier, exam and defense forms (§4.4–4.7), the MSCSE along the way (§4.5), the requirements you have met. '
              : ') records it — transfer credit (§5.2), the project or thesis forms (§3.4), the requirements you have met. ',
            `The button opens the request in your email app, to the Grad Admin with the DGS in cc${needsTranscripts ? ' — attach your transcript PDFs' : ''}.`,
          ),
      ...built.items.lines.map((text) => el('div', { class: 'review-line', 'data-keep-dgs': '' }, text)),
      el('div', { class: 'save-buttons' }, button),
    );
  }

  /** An optional term as a semester and a year (2026-10-04: the semester of
   * graduation, the Graduate School's extension). The year box refuses an
   * out-of-range value like every other year box; empty clears the term. */
  function termPicker(key: string, label: string, current: Term | undefined, seasons: readonly Season[], set: (t: Term | undefined) => void): HTMLElement {
    const season = el('select', { 'aria-label': `${label} — semester`, 'data-key': `${key}.season` });
    season.append(...seasons.map((se) => option(se, se[0]!.toUpperCase() + se.slice(1), (current?.season ?? seasons[0]) === se)));
    const commit = (year: number | undefined): void => set(year === undefined ? undefined : { season: (season as HTMLSelectElement).value as Season, year });
    const { input: year, error } = rangedNumber(
      { key: `${key}.year`, range: TERM_YEAR_RANGE, value: current ? String(current.year) : '', allowEmpty: true, attrs: { 'aria-label': `${label} — year`, placeholder: 'year' }, commit },
      refusedValues,
      toast,
    );
    season.addEventListener('change', () => {
      const text = (year as HTMLInputElement).value;
      if (text !== '' && inRange(Number(text), TERM_YEAR_RANGE)) commit(Number(text));
    });
    return el('div', { class: 'field' }, el('span', { class: 'label' }, label), el('div', { class: 'pair' }, season, year), error);
  }

  function milestonesCard(classified: readonly ClassifiedCourse[], report: AuditReport): HTMLElement {
    const m = student.milestones;
    // Every date with its deadline beside it (DGS 2026-10-04: "In the
    // Milestones, next to all the dates, specify the deadlines.") — the
    // engine's own date for the matching row (report.milestoneDeadlines).
    const dateField = (label: string, key: MilestoneDateKey): HTMLElement => datedField(label, key, report.milestoneDeadlines?.[key]);
    const a = student.attestations;
    const card = el(
      'section',
      { class: 'card', id: 'milestones' },
      el('h2', {}, el('span', { class: 'step-no' }, '4. '), 'Milestones ', sectionRef(student.program === 'mscse' ? '§2.3, §3.4' : '§2.3, §4.4–4.7', { className: 'chip-note', dataKey: 'secref.milestones' })),
      // "Optional" once, leading (2026-09-05 item 11; trim review 2026-09-18, P-41).
      el('p', { class: 'hint' }, 'Every date here is optional — enter a date once it has happened.'),
    );

    // Is the advisor tenured or tenure-track CSE faculty? (CSE §2.3; Academic
    // Code §6.2.7 — policy review 2026-10-04, P2-ac-6.2-app-8.) The app cannot
    // see faculty status, so the student answers it; "no" or "not sure" goes to
    // the DGS. Asked of every Ph.D. student and, since P2-dh-10-5 (DGS Handbook
    // §10.3.2, §10.3.8), of an MSCSE student on the thesis option — under the name.
    const thesisMs = student.program === 'mscse' && student.msOption === 'thesis';
    const tttQuestion = (which: 'advisorTtt' | 'advisorTtt2', legend: string): HTMLElement | null =>
      student.program === 'phd' || thesisMs
        ? fieldset(
            legend,
            radios(`milestone.${which}`, [['yes', 'Yes'], ['no', 'No'], ['unsure', 'Not sure']], m[which] ?? '', (v) =>
              update((s) => void (s.milestones[which] = v as 'yes' | 'no' | 'unsure')),
            ),
            'inline',
          )
        : null;
    card.append(
      field(
        'Advisor name (§2.3)',
        el('input', {
          value: m.advisorName ?? '',
          'data-key': 'milestone.advisorName',
          onchange: (e) => update((s) => void (s.milestones.advisorName = (e.target as HTMLInputElement).value || undefined)),
        }),
      ),
      ...[tttQuestion('advisorTtt', thesisMs ? 'Is your thesis advisor tenured or tenure-track CSE faculty? (§2.3)' : 'Is your advisor tenured or tenure-track CSE faculty? (§2.3)')].filter((q): q is HTMLElement => q !== null),
      // A student may have two advisors (DGS 2026-09-22); the second box is
      // optional and the two names read as one supervision everywhere.
      // Uncommon: behind a selector unless a second name is on file (DGS 2026-10-03).
      rareFold(
        'coadvisor',
        'A second advisor (co-advisor)?',
        !!m.advisorName2,
        field(
          'Second advisor (co-advisor)',
          el('input', {
            value: m.advisorName2 ?? '',
            'data-key': 'milestone.advisorName2',
            onchange: (e) => update((s) => void (s.milestones.advisorName2 = (e.target as HTMLInputElement).value || undefined)),
          }),
        ),
        tttQuestion('advisorTtt2', 'Is your co-advisor tenured or tenure-track CSE faculty?'),
      ),
      dateField('Advisor identified on (§2.3)', 'advisorIdentified'),
    );

    if (student.program === 'mscse') {
      const opt = student.msOption ?? 'undecided';
      // The project/thesis option, at the top of the MSCSE part (UI review
      // item 7; DGS 2026-10-09: option (b)) — it was under Your standing. The
      // data-key keeps its old name: the drivers and a remembered focus use it.
      card.append(
        fieldset(
          'Project or thesis option (§3.4)',
          radios(
            'standing.msOption',
            [
              ['undecided', 'Undecided'],
              ['project', 'M.S. project (§3.4 i)'],
              ['thesis', 'M.S. thesis (§3.4 ii)'],
            ],
            opt,
            (value) => update((s) => void (s.msOption = value as Student['msOption'])),
          ),
        ),
      );
      if (opt !== 'project') {
        card.append(
          // Academic Code §6.1.7 (policy review 2026-10-04, P2-ac-5b-6.1-14).
          dateField('Thesis topic approved — proposed with your advisor’s approval (Academic Code §6.1.7)', 'thesisTopicApproved'),
          // The readers' faculty status (CSE §3.4; DGS Handbook §10.3.8 —
          // policy review 2026-10-04, P2-dh-10-19): on the thesis route only,
          // behind a selector until the readers exist, so nobody answers
          // "Not sure" before there is anyone to be sure about; "no" or "not
          // sure" goes to the DGS.
          ...(opt === 'thesis'
            ? [
                rareFold(
                  'thesis-readers',
                  'Have your two thesis readers been nominated?',
                  m.thesisReadersTtt !== undefined,
                  fieldset(
                    'Are both readers tenured or tenure-track CSE faculty, and is neither of them your advisor? (§3.4)',
                    radios('milestone.thesisReadersTtt', [['yes', 'Yes'], ['no', 'No'], ['unsure', 'Not sure']], m.thesisReadersTtt ?? '', (v) =>
                      update((s) => void (s.milestones.thesisReadersTtt = v as 'yes' | 'no' | 'unsure')),
                    ),
                    'inline',
                  ),
                ),
              ]
            : []),
          dateField('Thesis defense passed (§3.4)', 'thesisDefensePassed'),
          // A failed first attempt (Academic Code §6.1.5: one retake, by the
          // end of the following semester) — uncommon, so behind a selector
          // (policy review 2026-10-04, P2-ac-5b-6.1-12).
          rareFold('thesis-failed', 'Did you fail a thesis defense attempt?', !!m.thesisDefenseFailed, dateField('Thesis defense failed — the first attempt (Academic Code §6.1.5)', 'thesisDefenseFailed')),
          // The final thesis to the Graduate School (Academic Code §6.1.8 —
          // policy review 2026-10-04, P2-ac-5b-6.1-15): on the thesis route,
          // once the defense is dated (or a date is already on file).
          ...(opt === 'thesis' && (m.thesisDefensePassed || m.thesisSubmitted)
            ? [dateField('Final thesis submitted to the Graduate School (Academic Code §6.1.8)', 'thesisSubmitted')]
            : []),
        );
      }
      if (opt !== 'thesis') {
        card.append(dateField('Project report accepted by advisor (§3.4)', 'projectReportAccepted'));
      }
      // The master's candidacy application (Academic Code §6.1.6; policy
      // review 2026-10-04) — every MSCSE student files it in the end.
      // Shown once the application is due (the row appears) or dated (DGS
      // 2026-10-04: "Show the entries only when they are in progress").
      if (m.msCandidacyApplied || report.requirements.some((r) => r.id === 'shared.msCandidacy')) {
        card.append(dateField('Application for Admission to Master’s Degree Candidacy submitted to the Graduate School (Academic Code §6.1.6)', 'msCandidacyApplied'));
      }
    } else {
      // Milestones appear once they are under way (DGS 2026-10-04: "Show the
      // entries only when they are in progress"): a date field whose row reads
      // Not started stays hidden until a date is on file — nothing on file is
      // ever hidden. The OCE waits for its coursework (DGS 2026-10-05), so does
      // its field, and the qualifier completion form appears with it.
      const notStarted = (id: string): boolean => {
        const r = report.requirements.find((x) => x.id === id);
        return r !== undefined && r.status === 'unmet' && /^Not started\b/.test(r.detail);
      };
      const oceOpen = !notStarted('phd.candidacy');
      const qualifierDone = report.requirements.some((r) => r.id === 'phd.qualifier' && r.status === 'met');
      // A field that does not apply is not shown (DGS 2026-10-05: "When
      // something is 'does not apply', hide it") — the research qualifier of a
      // student who passed the examination under the earlier requirements —
      // unless a date is already on file.
      const applies = (key: MilestoneDateKey): boolean => !!student.milestones[key] || !/^Does not apply\b/.test(report.milestoneDeadlines?.[key]?.basis ?? '');
      card.append(
        ...(applies('researchQualifierPassed') ? [dateField('Research qualifier passed — advisor filed the form (§4.4.3)', 'researchQualifierPassed')] : []),
        // A FAIL within the 18 months starts the DGS committee's six months
        // (§4.4.3; policy review 2026-10-03).
        ...(applies('researchQualifierFailed')
          ? [rareFold('rq-failed', 'Did the advisor file a research-qualifier fail?', !!m.researchQualifierFailed, dateField('Research qualifier failed — the advisor filed a fail (§4.4.3)', 'researchQualifierFailed'))]
          : []),
        // "(DGS office)" dropped (trim review 2026-09-18, P-51): the handbook's
        // phrase for the desk the page calls the Grad Admin, one card above
        // "two people, two jobs"; phd.ts and the advisor summary already read this way.
        ...(m.qualifierFormFiled || qualifierDone || oceOpen ? [dateField('Qualifier completion form filed with the Grad Admin (§4.4)', 'qualifierFormFiled')] : []),
        // Academic Code §6.2.4; a candidacy condition per the DGS Handbook §3.22.3
        // (2026-10-03). Part of the candidacy card since 2026-10-04, so shown
        // once that card is under way (DGS 2026-10-05: "hide it until it
        // becomes 'in progress'") — or once dated.
        ...(m.rcrTrainingCompleted || !notStarted('phd.candidacyAdmission') ? [dateField('Ethics workshop and Responsible Conduct of Research training completed (Graduate School)', 'rcrTrainingCompleted')] : []),
        ...(m.candidacyPassed || oceOpen ? [dateField('Oral Candidacy Exam (OCE) passed (§4.5)', 'candidacyPassed')] : []),
      );
      // §4.6 opens "After satisfying the above requirements": nobody has a
      // dissertation date without an OCE date, so the admission and
      // dissertation fields appear once the OCE is dated — or when a loaded record already
      // carries either date, so nothing on file is ever hidden (trim review
      // 2026-09-18, P-64). No readers'-approval date since 2026-10-04 (DGS:
      // the committee approves the dissertation and passes the defense at the
      // same time — "Only the 'dissertation defense passed' is needed").
      if (m.candidacyPassed || m.candidacyAdmitted || m.defensePassed || m.dissertationSubmitted) {
        card.append(
          // Admission to candidacy is the Graduate School's own step after the
          // OCE (DGS 2026-10-04: "OCE and doctoral candidacy are two different
          // things"), so it appears with the fields that follow the OCE.
          dateField('Admitted to doctoral candidacy by the Graduate School (Academic Code §6.2.9)', 'candidacyAdmitted'),
          dateField('Dissertation defense passed (§4.7)', 'defensePassed'),
          // The official submission is the last requirement inside the eight
          // years (Academic Code §6.2.6/§6.2.12; policy review 2026-10-03) —
          // shown once the defense is dated (DGS 2026-10-04: in progress only).
          ...(m.defensePassed || m.dissertationSubmitted ? [dateField('Final dissertation submitted to the Graduate School (Academic Code §6.2.12)', 'dissertationSubmitted')] : []),
        );
      }
      // The MSCSE along the way's candidacy application (DGS Handbook §3.21.1;
      // 2026-10-04): once the award's requirements are met, or once dated.
      if (m.msCandidacyApplied || report.requirements.some((r) => r.id === 'phd.msAlongTheWay' && r.status === 'met')) {
        card.append(dateField('Application for Admission to Master’s Degree Candidacy submitted — the MSCSE along the way (DGS Handbook §3.21.1)', 'msCandidacyApplied'));
      }
    }
    // The semester of graduation (DGS Handbook §3.23.1; Academic Code §3.7 —
    // policy review 2026-10-04, P2-dh-3.21-3.24-24): optional; the report
    // checks that a course of at least one credit is entered for it. Asked
    // once graduation is in sight (DGS 2026-10-05: "Let's show it only when it
    // matters"), or when a semester is already on file.
    if (report.graduationInSight || student.graduationTerm) {
      card.append(
        termPicker('milestone.graduationTerm', 'Semester you plan to graduate in (optional)', student.graduationTerm, ['fall', 'spring', 'summer'], (t) => update((s) => void (s.graduationTerm = t))),
      );
    }

    // A sub-heading of the Milestones card (UI review, 2026-10-08: was an h2).
    card.append(el('h3', { class: 'mt' }, 'Approvals you already have'));
    card.append(
      // The two-roles sentence is the next card's opening (trim review 2026-09-18, P-16).
      el('p', { class: 'hint' }, 'Tick only what has actually been approved.'),
      // "coursework", not "plan of study" (DGS 2026-10-08) — the field keeps its name.
      attestation('My advisor approved my coursework (' + (student.program === 'mscse' ? '§3.2' : '§4.2') + ')', a.advisorApprovedPlan, (v, s) => (s.attestations.advisorApprovedPlan = v)),
    );
    // The Graduate School's extension of the time limit (policy review
    // 2026-10-04, P2-ac-6.2-app-7, P2-dh-3.14-3.20-27, P2-dh-10-10) — rare, so
    // behind a selector, open once a term is on file.
    card.append(
      rareFold(
        'time-extension',
        `Did the Graduate School extend your ${student.program === 'phd' ? 'eight' : 'five'}-year time limit?`,
        a.timeLimitExtendedThrough !== undefined,
        termPicker(
          'attest.timeLimitExtendedThrough',
          student.program === 'phd'
            ? 'The Graduate School extended my time limit — dissertation completion status or an eligibility extension (Academic Code §6.2.6.1; DGS Handbook §3.19) — through the end of:'
            : 'The Graduate School extended my time limit — an eligibility extension (DGS Handbook §10.3.5) — through the end of:',
          a.timeLimitExtendedThrough,
          ['fall', 'spring', 'summer'],
          (t) => update((s) => void (s.attestations.timeLimitExtendedThrough = t)),
        ),
      ),
    );
    // The Graduate School's approval of a dual-degree plan of study (DGS
    // Handbook §2.9; policy review 2026-10-04, P2-ac-1-3-2) — shown only to a
    // student who said they are in two programs at once.
    if (student.concurrentDegree === true || a.dualPlanApproved === true) {
      card.append(attestation('The Graduate School approved my dual-degree plan of study (DGS Handbook §2.9)', a.dualPlanApproved, (v, s) => (s.attestations.dualPlanApproved = v)));
    }
    // §5.2 criterion 5 — the Graduate School's approval — recorded here once
    // the Grad Admin has processed the transfer (policy review 2026-10-03);
    // shown only while the record has transfer courses.
    if (classified.some((c) => c.entry.origin === 'transfer' && c.caps.includes('transfer'))) {
      card.append(attestation('The Graduate School approved my transfer credit and the Grad Admin recorded it (§5.2)', a.transferRecorded, (v, s) => (s.attestations.transferRecorded = v)));
    }
    // Academic Code §3.8's semester maximum (2026-10-03): a semester over it —
    // or one already ticked — offers the overload tick, behind a selector that
    // is open once a tick is on file (an uncommon case, DGS 2026-10-03).
    const overloadTicked = student.creditOverloadTerms ?? [];
    const overloadTerms = new Map<number, Term>();
    for (const o of overMaxTerms(classified, student, normalizeEntryTerm(student.entryTerm).term)) overloadTerms.set(termIndex(o.term), o.term);
    for (const t of overloadTicked) overloadTerms.set(termIndex(t), t);
    if (overloadTerms.size > 0) {
      const ticks = [...overloadTerms.entries()]
        .sort((x, y) => x[0] - y[0])
        .map(([key, t]) =>
          attestation(`A credit overload was approved for me in ${termLabel(t)} (Academic Code §3.8)`, overloadTicked.some((o) => termIndex(o) === key), (v, s) => {
            const list = (s.creditOverloadTerms ?? []).filter((o) => termIndex(o) !== key);
            if (v) list.push(t);
            s.creditOverloadTerms = list.length > 0 ? list : undefined;
          }),
        );
      card.append(rareFold('overload', 'Was a credit overload approved for you?', overloadTicked.length > 0, ...ticks));
    }
    // The DGS's course approvals left this card on 2026-09-27: each is a tick
    // on the course it concerns, shown only where the sheet decides the
    // course case by case (the coursework table).
    if (student.program === 'phd') {
      // A NUMBER of semesters since 2026-10-03 (DGS: "DGS may give any number
      // of semesters as extensions"); the old tick box read as one.
      const extension = el('input', {
        type: 'number',
        min: '0',
        max: '20',
        step: '1',
        value: a.qualifierExtensionSemesters === undefined ? (a.qualifierExtensionGranted ? '1' : '') : String(a.qualifierExtensionSemesters),
        'data-key': 'attest.qualifier-extension-semesters',
        'aria-label': 'Semesters by which the DGS extended my qualifier deadline (§4.4)',
        onchange: (e) => {
          const raw = (e.target as HTMLInputElement).value.trim();
          const n = Number(raw);
          update((s) => {
            s.attestations.qualifierExtensionSemesters = raw === '' || !Number.isInteger(n) || n <= 0 ? undefined : Math.min(20, n);
            s.attestations.qualifierExtensionGranted = undefined;
          });
        },
      });
      card.append(
        rareFold(
          'q-extension',
          'Did the DGS extend your qualifier deadline?',
          a.qualifierExtensionSemesters !== undefined || a.qualifierExtensionGranted === true,
          el('label', { class: 'attest attest-number' }, 'The DGS extended my qualifier deadline (§4.4) by this many semesters: ', extension),
        ),
      );
      // The qualifier rule changed several times in four years (DGS
      // 2026-09-21): from the third year on, a student may attest that they
      // passed the examination under the requirements in force at the time.
      // Hidden before then — a ticked box on an earlier record is ignored by
      // the engine, which says so in a warning.
      if (qualifierPriorRulesEligible(student.entryTerm, todayIso()) || a.qualifierPassedUnderPriorRules) {
        card.append(
          rareFold(
            'prior-rules',
            'Passed the qualifying examination under the earlier requirements?',
            a.qualifierPassedUnderPriorRules === true,
            attestation('I passed the qualifying examination under the earlier requirements (§4.4, third year or later)', a.qualifierPassedUnderPriorRules, (v, s) => (s.attestations.qualifierPassedUnderPriorRules = v)),
          ),
        );
      }
    }
    return card;
  }

  function attestation(label: string, checked: boolean | undefined, set: (v: boolean, s: Student) => void): HTMLElement {
    const cb = el('input', {
      type: 'checkbox',
      'data-key': `attest.${label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`,
      onchange: (e) => update((s) => set((e.target as HTMLInputElement).checked, s)),
    });
    cb.checked = checked === true;
    return el('label', { class: 'attest' }, cb, ` ${label}`);
  }

  /** A milestone date box with its deadline beside it (DGS 2026-10-04): the
   * label on its own line, then the box and the deadline side by side, so
   * every deadline starts at the same place (a wrapping <label> pushed each
   * one past its own label's width). The label names the box through `for`;
   * the deadline is tied to it by aria-describedby, so the box's accessible
   * name stays the label. */
  function datedField(label: string, key: MilestoneDateKey, deadline: MilestoneDeadline | undefined): HTMLElement {
    const value = (student.milestones[key] as string | undefined) ?? '';
    const inputId = `milestone-${key}`;
    const noteId = `deadline-${key}`;
    const note = deadlineNote(deadline, noteId);
    return el(
      'div',
      { class: 'field dated' },
      el('label', { class: 'label', for: inputId }, label),
      el('input', {
        type: 'date',
        id: inputId,
        value,
        'data-key': `milestone.${key}`,
        ...(note ? { 'aria-describedby': noteId } : {}),
        onchange: (e) =>
          update((s) => void ((s.milestones as Record<string, string | undefined>)[key] = (e.target as HTMLInputElement).value || undefined)),
      }),
      note,
    );
  }

  // ---------- save / load ----------

  /** "Send summary to advisor" (DGS 2026-09-15): the dialog with the
   * advisor summary. Rendered at the end of the report since the trim review
   * (2026-09-18, P-72); it was the third button of the storage card. */
  // The term the qualifying exam's clocks count from when it is not the entry
  // term: a Ph.D. transfer from the unfinished MSCSE (as audit.ts reads it).
  function qualifierTransferTerm(): string | undefined {
    const b = student.background;
    if (student.program !== 'phd' || b?.graduate !== 'nd-mscse-transfer' || b.transferredTerm === undefined) return undefined;
    const entry = normalizeEntryTerm(student.entryTerm).term;
    return compareTerm(b.transferredTerm, entry) > 0 ? termLabel(normalizeEntryTerm(b.transferredTerm).term) : undefined;
  }

  function advisorSummaryButton(report: ReturnType<typeof audit>, key = 'save.copy'): HTMLElement {
    // In simulation mode the summary is not sent (D7): inactive with its reason.
    if (simulation) return inactiveButton({ class: 'btn', 'data-key': key }, simulationSendNote('the summary to your advisor'), toast, 'Send summary to advisor');
    return el(
      'button',
      {
        class: 'btn',
        'data-key': key,
        onclick: () => {
          const advisors = [student.milestones.advisorName, student.milestones.advisorName2].filter((n): n is string => !!n);
          // The processing request's transfer list (P3-emails-1).
          const transfers = processingItems(report, student, rules).transfers.map((t) => t.courseId);
          const built = advisorSummary(report, {
            todayIso: todayIso(),
            entryTerm: termLabel(student.entryTerm),
            priorStudy: priorStudyLabel(student),
            gpa: student.gpa,
            advisors,
            history: programHistory(student),
            unofficialNote: unofficialTranscriptNote(student.courses),
            transfers: { courses: transfers, recorded: student.attestations.transferRecorded === true, firstSemesterDone: firstSemesterComplete(student, normalizeEntryTerm(student.entryTerm).term, todayIso()).done },
            qualifierFrom: qualifierTransferTerm(),
            stamp: checkedWithLine(stamp),
            sources: sourcesLine(student),
          });
          void copyDialog({
            what: 'Summary for your advisor',
            recipient: { role: advisors.length > 1 ? 'Your advisors' : 'Your advisor', name: advisors.length > 0 ? advisors.join(' and ') : 'name not entered under Milestones' },
            subject: built.subject,
            text: built.text,
            html: built.html,
            steps: [{ text: FILL_IN_STEP }],
            returnFocusKey: key,
          });
        },
      },
      'Send summary to advisor',
    );
  }

  function saveCard(report: ReturnType<typeof audit>): HTMLElement {
    const fileInput = el('input', { type: 'file', accept: '.json,application/json', class: 'hidden', 'aria-label': 'Saved file', 'data-key': 'save.fileinput' }); // (P-62); the tools row's "Load a file" opens it too
    fileInput.addEventListener('change', async () => {
      const file = (fileInput as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const refusals: Refusal[] = [];
        const raw: unknown = JSON.parse(await file.text());
        // Where the file goes (D3, routeLoadedFile — pure, tested): outside
        // the mode a record replaces the record and a SIMULATION file enters
        // the mode with its semester, the real record untouched; inside the
        // mode any file loads into the simulation, never into the real
        // record (D2). validateStudent's errors are thrown from inside it —
        // and so is the refusal of a simulation file while a transcript
        // preview or scan is open (review fix 2026-10-09): the same guard the
        // Simulate button has, since the preview's Add would otherwise file
        // the real transcript's rows into the plan and Exit would drop them.
        const route = routeLoadedFile(raw, { student, simulation, realStudent, previewOpen: ndPreviewOpen() || importsBusy() }, realTodayIso, refusals);
        cancelUndo();
        refusedValues.clear(); // this file's own refusals replace the page's
        const previous = { student, simulation, realStudent };
        const previousSimulation = simulation;
        ({ student, simulation, realStudent } = route);
        try {
          render(); // render BEFORE persisting, so a file that crashes rendering is never saved
        } catch (renderErr) {
          ({ student, simulation, realStudent } = previous);
          render();
          throw renderErr;
        }
        persist();
        // A number the file carried that the app would not keep goes back into
        // its own field, refused, rather than disappearing (R1, 2026-09-18).
        if (refusals.length > 0) {
          applyRefusals(refusedValues, refusals);
          render();
        }
        // "File", as the buttons say (trim review 2026-09-18, P-62).
        // A simulation file loaded inside the mode brings its semester: the
        // toast names it when it differs from the one the page was in.
        const movedTo = simulation && previousSimulation && compareTerm(previousSimulation.term, simulation.term) !== 0 ? simulation.term : undefined;
        const loaded =
          route.outcome === 'entered' && simulation
            ? `Simulation file loaded — simulation mode is on for ${termLabel(simulation.term)}; your record is untouched.`
            : route.outcome === 'into-simulation'
              ? movedTo
                ? `Simulation file loaded into the simulation — now pretending it is ${termLabel(movedTo)}; your record is untouched.`
                : `File loaded into the simulation — your record is untouched.`
              : 'File loaded.';
        toast(refusals.length > 0 ? `${loaded} ${refusals.map((r) => r.message).join(' ')}` : loaded);
        if (route.outcome === 'entered' && simulation) {
          setFocusAfterRender('simulation.term');
          render();
          srStatus.textContent = `Simulation mode on: this page is pretending it is ${termLabel(simulation.term)}. Nothing here is your record.`;
        }
      } catch (err) {
        toast(err instanceof Error ? err.message : 'That file could not be read.');
      }
    });
    return el(
      'section',
      { class: 'card save-card' },
      el('h2', {}, 'Your record stays in this browser'), // "record", the page's word for what localStorage holds (R7; trim review 2026-09-18, P-56)
      el(
        'p',
        { class: 'hint' },
        // The privacy statement belongs where the file controls are, not only
        // in the footer (B9, 2026-09-18). The GitHub/Google Sheets sentence
        // (W-P1) stays in the footer and the notice Details; here only the
        // claim and the instruction (trim review 2026-09-18, P-8; "import"
        // for what the student does, P-53).
        'Everything you enter, transcript PDFs included, stays in this browser. Save it to a file to keep a copy or to move to another device.',
      ),
      // The other side of "it stays in this browser" (interface review R7,
      // 2026-09-18): on a lab or library machine the record has no expiry, so
      // the next person to open this page sees it. The page framed browser
      // storage purely as a benefit.
      el(
        'p',
        { class: 'hint warn' },
        // Both R7 facts in fewer words (trim review 2026-09-18, P-36).
        'On a shared or public computer, clear your record before you walk away — it never expires, and the next person on this machine would see it.',
      ),
      el(
        'div',
        { class: 'save-buttons' },
        el('button', { class: 'btn primary', 'data-key': 'save.file', onclick: saveActiveToFile }, 'Save to a file'),
        el('button', { class: 'btn', 'data-key': 'save.load', onclick: () => (fileInput as HTMLInputElement).click() }, 'Load a file'),
        el('button', { class: 'btn', 'data-key': 'save.print', onclick: () => window.print() }, 'Print'),
        // Reset beside Print (DGS 2026-09-22) — the card whose sentence tells a
        // student on a shared machine to clear the record holds the button.
        // Also here (DGS 2026-09-23), with its own key so focus returns to
        // the right one of the two buttons.
        advisorSummaryButton(report, 'save.summary'),
        resetButton('save.reset'),
      ),
      fileInput,
    );
  }

  // ---------- simulation mode (DGS 2026-10-09; src/ui/simulation.ts) ----------

  /** The mode on the document: `html.simulation` (the top rule, the strip,
   * the print treatment — style.css) and the tab title naming the semester.
   * Called by every render, so a semester change reaches the title too. */
  const baseTitle = document.title;
  function markSimulationMode(): void {
    document.documentElement.classList.toggle('simulation', simulation !== undefined);
    document.title = simulation ? `Simulating ${termLabel(simulation.term)} — ${baseTitle}` : baseTitle;
  }

  /** The "Simulation" chip — after the program name in the masthead, beside
   * the report headline and in each request card (everywhere since the review
   * fix of 2026-10-09; it was the frame's alone). Null outside the mode. */
  function simulationChip(): HTMLElement | null {
    return simulation ? el('span', { class: 'chip-start chip-simulation' }, 'Simulation') : null;
  }

  /** "Save to a file" — the record's file outside the mode, the simulation's
   * (D3: the note first, the semester, then the planning copy) inside it. */
  function saveActiveToFile(): void {
    // The stamp and every row's verdict as the page shows them now (item 8):
    // `npm run reproduce` re-runs the file and compares.
    const auditDate = todayIso();
    const saved = savedStamp(stamp, auditDate, audit(student, rules, auditDate).requirements);
    if (simulation) downloadJson(simulationFileName(student.program, simulation.term), simulationFilePayload(student, simulation.term, new Date().toISOString(), saved));
    else exportFile(student, saved);
  }

  /** The way in. Inactive while a transcript preview is open: the preview's
   * rows belong to the real record, and the mode must start from a settled one. */
  function simulateButton(key: string): HTMLElement {
    if (ndPreviewOpen() || importsBusy()) return inactiveButton({ class: 'btn', 'data-key': key }, PREVIEW_OPEN_NOTE, toast, 'Simulate a future semester');
    return el('button', { class: 'btn', 'data-key': key, onclick: enterSimulation }, 'Simulate a future semester');
  }

  function exitSimulationButton(key: string): HTMLElement {
    return el('button', { class: 'btn', 'data-key': key, onclick: () => void exitSimulation(key) }, 'Exit simulation mode');
  }

  /** Reset — or, in the mode, a fresh copy of the real record (D6): the
   * real record is never cleared from inside the simulation. */
  function resetButton(key: string): HTMLElement {
    if (simulation) return el('button', { class: 'btn', 'data-key': key, onclick: () => void restartSimulation(key) }, 'Start the simulation over from my record');
    return el('button', { class: 'btn', 'data-key': key, onclick: resetAll }, 'Reset');
  }

  /** Enter the mode: the record stays as it is (in memory and in its own
   * storage key); a deep copy of it becomes the page's record, dated to the
   * next fall or spring (defaultSimulationTerm). */
  function enterSimulation(): void {
    if (simulation || ndPreviewOpen() || importsBusy()) return;
    cancelUndo(); // an Undo would splice real rows into the copy
    refusedValues.clear();
    realStudent = student;
    const term = defaultSimulationTerm(realTodayIso);
    simulation = { term, student: JSON.parse(JSON.stringify(student)) as Student };
    student = simulation.student;
    saveSimulation(simulation);
    setFocusAfterRender('simulation.term');
    render();
    // After render(), which announces a changed headline itself: the mode is
    // the news here.
    srStatus.textContent = `Simulation mode on: this page is pretending it is ${termLabel(term)}. Nothing here is your record.`;
  }

  /** The semester picker's change. The page is rendered BEFORE the semester
   * is saved — as the file path does — so a semester that crashes rendering
   * is never stored and re-thrown on every reload (review fix 2026-10-09):
   * the previous semester comes back, and the error reaches the console. */
  function setSimulationTerm(term: Term): void {
    if (!simulation) return;
    const previous = simulation.term;
    simulation.term = term;
    try {
      render();
    } catch (err) {
      simulation.term = previous;
      render();
      throw err;
    }
    persist();
    srStatus.textContent = `Simulated current semester: ${termLabel(term)}. Report updated.`;
  }

  /** Leave the mode, after saying what goes: the planning copy is discarded
   * and the real record comes back from memory — it is never re-saved, since
   * nothing in the mode could have changed it. With no real record on this
   * device (the page was reloaded with only a simulation stored, and nothing
   * was ever saved outside it), the opening dialog returns as after Reset. */
  async function exitSimulation(returnFocusKey: string): Promise<void> {
    if (!simulation) return;
    const term = simulation.term;
    const changes = countChangesSince(realStudent ?? emptyStudent(), student);
    const ok = await confirmDialog({
      title: 'Exit simulation mode?',
      body: [
        `This discards the simulation: ${changesSentence(changes, term)}. Save it to a file first if you want to keep the plan.`,
        'Your record comes back exactly as it was when you entered.',
      ],
      confirmLabel: 'Exit and discard the simulation',
      cancelLabel: 'Stay in the simulation',
      returnFocusKey,
    });
    if (!ok) return;
    cancelUndo();
    refusedValues.clear();
    resetPriorImports();
    resetNdImport();
    simulation = undefined;
    clearSimulation();
    if (realStudent) {
      student = realStudent;
      setFocusAfterRender('tools.simulate');
      render();
    } else {
      student = emptyStudent();
      render();
      openOpeningDialog(undefined);
    }
    srStatus.textContent = 'Simulation mode off. This is your record again.';
  }

  /** Start over inside the mode: a fresh copy of the real record, the same
   * simulated semester (D6). */
  async function restartSimulation(returnFocusKey: string): Promise<void> {
    if (!simulation) return;
    const ok = await confirmDialog({
      title: 'Start the simulation over?',
      body: [`This discards the simulation (${changesSentence(countChangesSince(realStudent ?? emptyStudent(), student), simulation.term)}) and starts again from a fresh copy of your record, still pretending it is ${termLabel(simulation.term)}.`],
      confirmLabel: 'Start over from my record',
      cancelLabel: 'Keep the simulation',
      returnFocusKey,
    });
    if (!ok) return;
    cancelUndo();
    refusedValues.clear();
    resetPriorImports();
    resetNdImport();
    simulation.student = JSON.parse(JSON.stringify(realStudent ?? emptyStudent())) as Student;
    student = simulation.student;
    saveSimulation(simulation);
    render();
    if (!realStudent) openOpeningDialog(undefined); // no record to copy: the degree is chosen as after Reset
    srStatus.textContent = `Simulation started over from your record; still pretending it is ${termLabel(simulation.term)}.`;
  }

  /** The banner (D9): first in <main>, navy, the semester named in its lead;
   * the semester picker, Exit, Save to a file, and the explanation behind a
   * selector. Null outside the mode. */
  function simulationBanner(): HTMLElement | null {
    if (!simulation) return null;
    const term = simulation.term;
    const select = el('select', {
      'data-key': 'simulation.term',
      id: 'simulation-term',
      onchange: (e) => {
        const picked = parseSimulationTermCode((e.target as HTMLSelectElement).value);
        if (picked) setSimulationTerm(picked);
      },
    });
    for (const t of simulationTerms(realTodayIso)) select.append(option(simulationTermCode(t), termLabel(t), compareTerm(t, term) === 0));
    return el(
      'section',
      { class: 'card simulation-banner', role: 'note', 'aria-labelledby': 'simulation-lead' },
      el('p', { class: 'simulation-lead', id: 'simulation-lead' }, el('strong', {}, 'Simulation mode'), ` — this page is pretending it is ${termLabel(term)}; nothing here is your record.`),
      el(
        'div',
        { class: 'simulation-controls' },
        el('label', { class: 'field inline simulation-term' }, el('span', { class: 'label' }, 'Current semester in this simulation'), select),
        el('div', { class: 'save-buttons' }, exitSimulationButton('simulation.exit'), el('button', { class: 'btn', 'data-key': 'simulation.save', onclick: saveActiveToFile }, 'Save to a file')),
      ),
      rareFold(
        'simulation.about',
        'What simulation mode does',
        false,
        el('p', {}, `The page audits a copy of your record as if today were in ${termLabel(term)}: add the courses you plan to take with the grades you expect, enter the milestone dates you aim for, and the report shows how you would stand then. Change the semester above to look further ahead.`),
        el('p', {}, 'Your real record is set aside, untouched, and comes back when you exit; nothing you do here changes it. Transcripts are imported outside the mode, and no request or summary can be sent from here — this is a plan, not a record. You can save the plan to a file or print it; loading that file later reopens it in simulation mode.'),
      ),
    );
  }

  /** The sticky strip at desk width (≥ 901 px, style.css): one line, the
   * semester, Exit. On phones the sticky score bar carries the mode instead. */
  function simulationStrip(): HTMLElement | null {
    if (!simulation) return null;
    return el('div', { class: 'simulation-strip' }, el('span', {}, `Simulation — ${termLabel(simulation.term)}`), el('button', { class: 'btn tiny', 'data-key': 'simulation.strip.exit', onclick: () => void exitSimulation('simulation.strip.exit') }, 'Exit'));
  }

  // ---------- diagnostics ----------

  function diagnosticsCard(): HTMLElement | null {
    const issues = rules.issues;
    // Students see this only when the sheet has ERRORS (usability review
    // 2026-09-05, item 19); warnings alone are the DGS's business and are
    // printed by `npm run sync-sheet`.
    if (!issues.some((i) => i.severity === 'error')) return null;
    const details = el('details', { class: 'card diagnostics', 'data-key': 'diagnostics' });
    details.append(
      el(
        'summary',
        {},
        `Rules-sheet diagnostics (${issues.filter((i) => i.severity === 'error').length} errors, ${issues.filter((i) => i.severity === 'warning').length} warnings) — for the DGS`,
      ),
    );
    for (const i of issues) {
      details.append(el('div', { class: `issue ${i.severity}` }, `[${i.severity}] ${i.message}`));
    }
    return details;
  }

  // ---------- footer ----------

  function footer(): HTMLElement {
    return el(
      'footer',
      { class: 'legal' },
      // The card's narrow-width and embed host (the desk host is in the
      // masthead) — first in the footer, not after the license (UI review,
      // 2026-10-08: on a phone the contacts were the last thing on the page).
      mainContactHost,
      // Five distinct things in one grey block of ~1,900 characters
      // (blue-team B9, 2026-09-18): scope, the alpha warning, where the rules
      // come from, privacy, and the licence. Each now has a heading, and the
      // two longest are disclosures — closed, the footer is five short lines.
      el(
        'div',
        { class: 'legal-scope' },
        el('h2', { class: 'legal-head' }, 'This is a self-check, not an official audit'),
        // Brought up to date on 2026-10-04 (DGS: "Not only CSE Grad Studies
        // Handbook was used. For GS academic code and DGS handbook, links are
        // not necessary"): the policy-compliance review added the Graduate
        // School's rules, and the facts the page now routes to the DGS.
        student.program === 'mscse' ? 'It applies Section 3 of the ' : 'It applies Section 4 of the ',
        handbookLink(),
        // Who decides and who processes is on the Grad Admin card, in the
        // glossary and in the contact card right below; the footer keeps its
        // one imperative (trim review 2026-09-18, P-21).
        // Shortened 2026-10-07 (DGS: "see any texts can be shortened without
        // losing its meaning"): the same four points — the sources, what is
        // sent to the DGS, approximate deadlines, confirm before relying.
        ' and the Graduate School’s Academic Code, DGS Handbook and 4+1 guidance. What this page cannot see — sign-offs, recommendations, Graduate School approvals and extensions, and facts you state yourself — goes to the DGS rather than being decided here. Deadlines are by semester and approximate; the Graduate School calendar sets the exact dates. Confirm with the DGS before you rely on this self-check.',
      ),
      // No alpha paragraph in the footer (DGS 2026-09-19, trim proposal P-3):
      // it was word for word the red strip's Details at the top of the page.
      // What the rules spreadsheet is and who can open it (DGS, 2026-09-04).
      el(
        'details',
        { class: 'legal-source', 'data-key': 'legal.source' },
        el('summary', {}, el('h2', { class: 'legal-head' }, 'Where the rules come from')),
        ...sheetSourceNote('app'),
      ),
      el(
        'div',
        { class: 'legal-privacy' },
        // One word (trim review 2026-09-18, P-56): the heading is inline and
        // ran straight into the sentence below, which says the claim itself.
        el('h2', { class: 'legal-head' }, 'Privacy'),
        // W-P1 (DGS 2026-09-18). The middle two sentences are his approved
        // wording verbatim; the FERPA sentence stays, as he asked.
        'Your coursework never leaves this browser: everything you enter — and any transcript PDF you import — is processed here and saved only on this computer. The page itself loads from GitHub and reads the course rules from Google Sheets, so those two services see that someone opened the page; they never see what you enter. Your FERPA-protected education records remain under your control.',
      ),
      el(
        'div',
        { class: 'legal-license' },
        el('h2', { class: 'legal-head' }, 'License'),
        '© 2026 University of Notre Dame du Lac. Free for non-commercial (academic and research) use; commercial use requires a license from Notre Dame\'s IDEA Center (',
        mailto('softwarelicensing@nd.edu'),
        '). Full terms: ',
        el('a', { href: LICENSE_URL, target: '_blank', rel: 'noopener noreferrer' }, 'LICENSE.md'),
        ' · source: ',
        el('a', { href: REPO_URL, target: '_blank', rel: 'noopener noreferrer' }, 'GitHub'),
        '.',
      ),
      // What this page's results were checked with (DGS 2026-10-11, item 8):
      // the same line the print header, the emails and the saved file carry.
      el('p', { class: 'legal-stamp' }, checkedWithLine(stamp)),
      // Embedded, the way out of the frame — and, with the contact card moved
      // off the top, the place the contacts now live (DGS 2026-09-16).
      isEmbedded() ? el('div', { class: 'embed-exit-line' }, openFullPageLink('Open the full self-check page'), ' — the same tool in its own window.') : null,
    );
  }


  // ---------- example / clear ----------

  function loadExample(): void {
    // The example matches the tab the student is on, so pressing it never
    // changes which degree the report is about (DGS 2026-09-18).
    const program = student.program;
    const name = program === 'mscse' ? 'MSCSE' : 'Ph.D.';
    if (student.courses.length > 0 && !window.confirm(`Load the example ${name} student? This replaces what is on the page.`)) {
      return;
    }
    cancelUndo(); // a stale Undo would splice old rows into the replaced record
    refusedValues.clear(); // …and a stale refusal would mark a box the record no longer has
    student = exampleFor(program, todayIso());
    persist();
    render();
    // No visible toast: the banner at the top of the inputs says the same
    // and names the right button, and the toast covered the page on a phone.
    // Screen readers still hear what happened — the banner is a role=note,
    // which is not announced (trim review 2026-09-18, P-27).
    srStatus.textContent = `Example ${name} student loaded.`;
  }

  /** The rows "Load example" seeded that are still on the record. */
  function exampleRows(): CourseEntry[] {
    return student.courses.filter((c) => c.fromExample);
  }

  /** Does the record still carry anything the example put there? An older saved
   * record has `isExample` but no per-row flags — it is the example whole. */
  function hasExample(): boolean {
    return exampleRows().length > 0 || (student.isExample === true && student.courses.length === 0);
  }

  function exampleBanner(): HTMLElement | null {
    if (!hasExample()) return null;
    const mine = exampleRows().length;
    const all = student.courses.length;
    const some = mine > 0 && mine < all;
    return el(
      'div',
      { class: 'card example-banner', role: 'note' },
      some
        ? el('strong', {}, `${mine} of these ${all} courses are the example student’s. `)
        : el('strong', {}, 'This is the example student, not your record. '),
      some
        ? 'Removing them leaves everything you entered yourself untouched.'
        : 'Nothing here came from you. Remove it before entering your own record.', // "record", as in the first sentence (trim review 2026-09-18, P-57)
      el(
        'div',
        { class: 'save-buttons' },
        el('button', { class: 'btn', 'data-key': 'example.clear', onclick: removeExample }, 'Remove the example rows'),
      ),
    );
  }

  /** Take back exactly what "Load example" put in — the flagged rows, and the
   * milestones and attestations it filled in WHERE THE STUDENT HAS NOT SINCE
   * CHANGED THEM, since a value they edited is their own (R5, 2026-09-18). */
  function removeExample(): void {
    const before = JSON.parse(JSON.stringify(student)) as Student;
    const removed = exampleRows().length;
    cancelUndo();
    update((s) => {
      s.courses = s.courses.filter((c) => !c.fromExample);
      for (const [k, v] of Object.entries(EXAMPLE_MILESTONES)) {
        if ((s.milestones as Record<string, unknown>)[k] === v) delete (s.milestones as Record<string, unknown>)[k];
      }
      for (const [k, v] of Object.entries(EXAMPLE_ATTESTATIONS)) {
        if ((s.attestations as Record<string, unknown>)[k] === v) delete (s.attestations as Record<string, unknown>)[k];
      }
      s.isExample = undefined; // nothing of the example is left to announce
    });
    toastWithAction(
      `${plural(removed, 'example row')} removed${student.courses.length > 0 ? ` — your own ${student.courses.length} stay${student.courses.length === 1 ? 's' : ''}` : ''}.`,
      'Undo',
      () => {
        student = before;
        persist();
        render();
      },
      { ttlMs: 20000 },
    );
  }

  function resetAll(): void {
    if (!window.confirm('Reset everything you have entered on this device and start over?')) return;
    cancelUndo();
    refusedValues.clear();
    resetPriorImports();
    resetNdImport();
    student = emptyStudent();
    clearLocal();
    render();
    // A reset record is a new student (DGS 2026-09-22): back to the opening
    // dialog — the degree and the earlier degrees are chosen there.
    openOpeningDialog(undefined);
  }

  // A record already on this device may carry a number an older build let
  // through (R1, 2026-09-18): it is refused now, shown back in its field, and
  // said out loud once the page is up — never dropped in silence.
  if (activeRefusals.length > 0) applyRefusals(refusedValues, activeRefusals);
  render();
  for (const r of activeRefusals) toast(r.message);
  // Reopened in simulation mode (the student left the page in it): say so
  // once, beyond the banner — a returning student may not expect it.
  if (simulation) toast(`Simulation mode is still on — this page is pretending it is ${termLabel(simulation.term)}. Exit it to see your record.`);
}

/** "CSE 60111", "CSE 60111 and CSE 60321", "A, B and C". */
function listIds(ids: readonly string[]): string {
  return ids.length <= 1 ? (ids[0] ?? '') : `${ids.slice(0, -1).join(', ')} and ${ids[ids.length - 1]!}`;
}

/** Which degrees a course has already counted toward is asked of a Ph.D.
 * student (Graduate School via the DGS, 2026-09-10 evening; 2026-09-22) about
 * Notre Dame coursework taken as an undergraduate that COULD count here — the
 * course table's select and the Next-steps item read this one test (UI review,
 * 2026-10-08). The MSCSE is never asked (DGS 2026-09-11). */
function asksWhichDegrees(c: CourseEntry, student: Student, rules: Rules): boolean {
  const awardTerm = student.bachelorsAwarded;
  const asUndergraduate = isNotreDameInstitution(c.institution) && (c.degreeLevel === 'bachelors' || (awardTerm !== undefined && termIndex(c.term) <= termIndex(awardTerm)));
  return asUndergraduate && student.program === 'phd' && priorNdUndergraduateCanCount(c, resolveRuleRow(rules, c.courseId, c.term), student.program);
}

/** The earlier-degrees answer (or draft) says the Notre Dame MSCSE was
 * finished before this program: held as a regular master's student or
 * through the 4+1. */
function heldNdMscse(b: Partial<Background> | undefined): boolean {
  return b?.graduate === 'nd-mscse' || b?.graduate === 'nd-4plus1';
}

function deadlineNote(d: MilestoneDeadline | undefined, id: string): HTMLElement | null {
  if (!d) return null;
  return el('span', { class: `ms-deadline${d.state ? ` ms-${d.state}` : ''}`, id }, deadlineText(d));
}
