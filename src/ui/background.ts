// The student's situation — asked once in the opening dialog, changed from
// the Transcripts card, reset with the record (DGS 2026-09-22). Two facts
// with their follow-ups decide which transcript rows a student needs and
// settle the standing card's prior-degree facts (§5.2 caps, the Notre Dame
// MSCSE already held, the Integrated 4+1), which used to be controls of
// their own. A Notre Dame degree of either kind is on the same insideND
// transcript as the current program, so it never needs a row of its own.
import { termLabel } from '../engine/term.ts';
import type { Program, Season, Student, Term } from '../engine/types.ts';
import { labelCitationsIn } from './citations.ts';
import { openModal, returnFocusTo } from './copy-dialog.ts';
import { el, option } from './dom.ts';
import { asksAlsoElsewhere, priorMsOfBackground } from './prior-nd.ts';
import { SEASONS } from './state.ts';

export type BachelorsFrom = 'nd-cse' | 'nd-other' | 'elsewhere';
/** `nd-mscse-transfer` (DGS 2026-09-26): no degree — the student began in the
 * Notre Dame MSCSE and transferred into the Ph.D. before finishing it. It
 * settles nothing about caps (no prior degree), but §4.5's eighth semester is
 * counted from the MSCSE start: the entry term is the MSCSE's. */
export type GraduateBefore = 'none' | 'elsewhere' | 'nd-mscse' | 'nd-4plus1' | 'nd-mscse-transfer' | 'nd-other';
export interface Background {
  bachelors: BachelorsFrom;
  /** An MSCSE student with a Notre Dame CSE bachelor's: in the Integrated
   * B.S. + M.S. (4+1) program now? (§3.5.) */
  ndIntegrated?: boolean;
  /** MSCSE, 4+1 "yes": when the student was admitted (matriculated) into the
   * Integrated program, from the admission letter (Graduate School 4+1
   * guidance — policy review 2026-10-04, P2-fourplusone-1). Optional: courses
   * beyond the six shared credits wait for it. */
  integratedAdmittedTerm?: Term;
  graduate: GraduateBefore;
  /** A graduate degree elsewhere: at the same university as the bachelor's
   * (a 4+1 or 5+1), which usually means ONE transcript covering both. */
  samePlace?: boolean;
  /** A graduate degree elsewhere: finished (the §5.2 cap is 24 credits) or
   * not (6). */
  finished?: boolean;
  /** `nd-mscse-transfer` only (DGS 2026-09-28): when the student moved into
   * the Ph.D. — named on the copied emails beside the MSCSE entry term. */
  transferredTerm?: Term;
  /** The three Notre Dame MSCSE answers only (`asksAlsoElsewhere`; policy
   * review round 3, P3-prior-programs-2 and -1; DGS 2026-10-07: option (a)):
   * a graduate degree at another university as well, held or started — "Did
   * you finish it?" follows. The single answer used to record such a student
   * as having no earlier program elsewhere (a 6-credit meter, every outside
   * course held), or, answered "another university", turned their own MSCSE
   * into transfer credit or lost the transfer term. */
  alsoElsewhere?: boolean;
}
export type PriorSlot = 'bachelors' | 'masters' | 'phd';

export const BACHELORS_OPTIONS: [BachelorsFrom, string][] = [
  ['elsewhere', 'Another university'],
  ['nd-cse', 'Notre Dame — Computer Science and Engineering'],
  ['nd-other', 'Notre Dame — another department'],
];
/** The graduate-degree answers a program can give: an MSCSE student cannot
 * already hold the MSCSE. Each label is the option's HEAD line; the detail
 * that used to follow it in the same sentence is in GRADUATE_NOTES (DGS
 * 2026-09-29: the dialog read as a wall of long radio labels). */
// Each option says whether it means a FINISHED degree (DGS 2026-10-08: a
// student who moved from the MSCSE into the Ph.D. "did start the MSCSE at
// Notre Dame" and could pick the finished-MSCSE option). The two Notre Dame
// MSCSE options are the finished degree; the transfer option is the unfinished
// one; the two whose follow-up asks say "finished or not".
export function graduateOptions(program: Program): [GraduateBefore, string][] {
  return [
    ['none', 'No'],
    ['elsewhere', 'Yes, at another university — finished or not'],
    ...(program === 'phd'
      ? ([
          ['nd-mscse', 'Yes — I finished the MSCSE at Notre Dame'],
          ['nd-4plus1', 'Yes — I finished the MSCSE at Notre Dame through the Integrated 4+1'],
          ['nd-mscse-transfer', 'I started the MSCSE at Notre Dame but did not finish it — I transferred into the Ph.D.'],
        ] as [GraduateBefore, string][])
      : []),
    ['nd-other', 'Yes, at Notre Dame in another department — finished or not'],
  ];
}
/** Whether a graduate-degree answer is still possible beside the bachelor's
 * answer and the 4+1 follow-up (DGS 2026-10-08: "if 'Yes' was chosen to 'are
 * you ND CSE 4+1?', then the ineligible options … should become hidden";
 * likewise after a "No", and after a bachelor's from another university,
 * "since Notre Dame does not accept students seeking a second bachelor's
 * degree"). An answer that is not possible is not shown, and one already
 * given is dropped when a later answer rules it out. */
export function graduatePossible(v: GraduateBefore, b: Partial<Background>, program: Program): boolean {
  const inFourPlusOne = wasInFourPlusOne(b);
  // The MSCSE through the Integrated 4+1 is CSE's program for its own
  // undergraduates (§3.5: "For current undergraduate students, an optimal
  // route to earning the MSCSE degree is through the Department's Integrated
  // B.S. + M.S. program"): a bachelor's from another university or another
  // department rules it out, as does "No" to the 4+1 follow-up.
  if (v === 'nd-4plus1') return b.bachelors === undefined || (b.bachelors === 'nd-cse' && b.ndIntegrated !== false);
  // A 4+1 student who finished the MSCSE finished it through the 4+1, not as
  // a regular master's student; and the 4+1 IS a graduate program started —
  // "either the student finished 4+1 and entered PhD fresh, or they started
  // MSCSE through 4+1 but transferred to PhD" (DGS 2026-10-08, later), so a
  // Ph.D. student who was in it cannot answer "No".
  if (v === 'nd-mscse') return !inFourPlusOne;
  if (v === 'none' && program === 'phd') return !inFourPlusOne;
  // An MSCSE student in the 4+1 now was admitted while an undergraduate, so
  // no graduate degree — anywhere — came before this program.
  if (program === 'mscse' && inFourPlusOne) return v === 'none';
  return true;
}
/** The graduate answers in the order a student is most likely to need them
 * (DGS 2026-10-08: "show the most common/probable choices first. If someone
 * started a degree program (4+1 or MS or PhD), the most common case is that
 * they finished the program"): the finished Notre Dame MSCSE before the
 * unfinished one, and after a "Yes" to the 4+1 the MSCSE through the 4+1
 * first of all. The answers the other answers rule out are left out here. */
function graduateOrder(b: Partial<Background>, program: Program): GraduateBefore[] {
  if (program === 'mscse') return ['none', 'elsewhere', 'nd-other'];
  if (b.bachelors === 'nd-cse') {
    if (wasInFourPlusOne(b)) return ['nd-4plus1', 'nd-mscse-transfer', 'elsewhere', 'nd-other'];
    if (b.ndIntegrated === false) return ['none', 'nd-mscse', 'nd-mscse-transfer', 'elsewhere', 'nd-other'];
    return ['none', 'nd-4plus1', 'nd-mscse', 'nd-mscse-transfer', 'elsewhere', 'nd-other'];
  }
  if (b.bachelors === 'nd-other') return ['none', 'nd-mscse', 'nd-mscse-transfer', 'elsewhere', 'nd-other'];
  // Another university, or not answered yet.
  return ['none', 'elsewhere', 'nd-mscse', 'nd-4plus1', 'nd-mscse-transfer', 'nd-other'];
}
/** Was the student in Notre Dame's Integrated 4+1: the follow-up's "Yes", or
 * the graduate answer "the MSCSE through the 4+1", which says the same thing
 * (DGS 2026-10-08: choosing that answer used to clear the follow-up, and the
 * options went back to the order for a 4+1 still open). */
function wasInFourPlusOne(b: Partial<Background>): boolean {
  return b.bachelors === 'nd-cse' && (b.ndIntegrated === true || b.graduate === 'nd-4plus1');
}
/** The graduate-degree options still possible for a partial answer, most
 * probable first (`graduateOrder`). */
export function graduateOptionsFor(b: Partial<Background>, program: Program): [GraduateBefore, string][] {
  const labels = new Map(graduateOptions(program));
  const order = graduateOrder(b, program);
  // Any option the order forgets still shows, last.
  const all = [...order, ...[...labels.keys()].filter((v) => !order.includes(v))];
  return all.filter((v) => labels.has(v) && graduatePossible(v, b, program)).map((v) => [v, labels.get(v)!]);
}
/** The lighter second line under a graduate-degree option. */
export const GRADUATE_NOTES: Partial<Record<GraduateBefore, string>> = {
  none: 'this is your first graduate program',
  elsewhere: 'a master’s or Ph.D.; whether you finished it is asked next',
  'nd-mscse': 'the degree was conferred, as a regular master’s student, before you entered the Ph.D.',
  'nd-4plus1': 'the degree was conferred through the Integrated B.S. + M.S. program, before you entered the Ph.D.',
  'nd-mscse-transfer': 'you moved into the Ph.D. before the MSCSE was conferred; a degree from another university is asked next',
  'nd-other': 'a master’s or Ph.D. in another Notre Dame department; whether you finished it is asked next',
};

/** One selectable option row (DGS 2026-09-29: the opening dialog's radios
 * were long sentences beside bare buttons). The whole row is the label — a
 * bold head, a lighter note under it — and CSS paints the chosen one. The
 * input keeps the data-key the drivers click. */
export function choiceRow(opts: { name: string; value: string; head: string; sub?: string; dataKey: string; checked: boolean; onChange: () => void }): HTMLElement {
  const input = el('input', { type: 'radio', name: opts.name, value: opts.value, 'data-key': opts.dataKey, onchange: opts.onChange }) as HTMLInputElement;
  input.checked = opts.checked;
  return el('label', { class: 'choice' }, input, el('span', { class: 'choice-text' }, el('span', { class: 'choice-head' }, opts.head), ...(opts.sub ? [el('span', { class: 'choice-sub' }, opts.sub)] : [])));
}

/** A complete answer for this program, or undefined while a question that
 * applies is still open. */
/** Which bachelor's answers ask the Integrated 4+1 follow-up: a Notre Dame
 * CSE bachelor's, for BOTH programs since 2026-10-03 (a Ph.D. student whose
 * master's year became the Ph.D.'s first could not say they were in the 4+1,
 * and lost every senior-year graduate course — policy review). Until
 * 2026-10-08 a Ph.D. student who chose the MSCSE through the 4+1 was not
 * asked (the answer was implied); now the follow-up stays, answered "Yes" by
 * that choice, so the one fact has one place to be changed. */
function asksIntegratedFor(b: Partial<Background>, _program: Program): boolean {
  return b.bachelors === 'nd-cse';
}
/** Which graduate answers ask "Did you finish it?": a degree elsewhere, and a
 * degree at Notre Dame in another department (2026-10-03) — the Academic
 * Code's §4.6 caps run on a FINISHED master's or Ph.D. (9 / 24) against an
 * unfinished one (6), and another Notre Dame department is "another graduate
 * program at Notre Dame" (DGS: "they need to be properly treated as another
 * graduate program"). */
function asksFinishedFor(b: Partial<Background>): boolean {
  // …and an outside degree beside the Notre Dame MSCSE (P3-prior-programs-1/-2).
  return b.graduate === 'elsewhere' || b.graduate === 'nd-other' || (asksAlsoElsewhere(b.graduate) && b.alsoElsewhere === true);
}

export function completeBackground(b: Partial<Background> | undefined, program: Program): Background | undefined {
  if (!b || b.bachelors === undefined || b.graduate === undefined) return undefined;
  if (program === 'mscse' && (b.graduate === 'nd-mscse' || b.graduate === 'nd-4plus1' || b.graduate === 'nd-mscse-transfer')) return undefined;
  // A graduate answer the other answers rule out (2026-10-08) — a record
  // saved before the rule, or a draft a later answer contradicts — is open
  // again until the student picks one that is possible.
  if (!graduatePossible(b.graduate, b, program)) return undefined;
  const asksIntegrated = asksIntegratedFor(b, program);
  // The MSCSE through the 4+1 answers the 4+1 question (a record saved before
  // 2026-10-08 holds that answer without the follow-up's).
  const integrated = b.ndIntegrated ?? (b.graduate === 'nd-4plus1' ? true : undefined);
  if (asksIntegrated && integrated === undefined) return undefined;
  if (b.graduate === 'elsewhere' && (b.samePlace === undefined || b.finished === undefined)) return undefined;
  if (b.graduate === 'nd-other' && b.finished === undefined) return undefined;
  if (asksAlsoElsewhere(b.graduate) && (b.alsoElsewhere === undefined || (b.alsoElsewhere && b.finished === undefined))) return undefined;
  return {
    bachelors: b.bachelors,
    ...(asksIntegrated ? { ndIntegrated: integrated === true } : {}),
    // The 4+1 admission term (2026-10-04): asked of an MSCSE "yes", optional.
    ...(asksIntegrated && program === 'mscse' && b.ndIntegrated === true && b.integratedAdmittedTerm ? { integratedAdmittedTerm: b.integratedAdmittedTerm } : {}),
    graduate: b.graduate,
    ...(b.graduate === 'elsewhere' ? { samePlace: b.samePlace === true, finished: b.finished === true } : {}),
    ...(b.graduate === 'nd-other' ? { finished: b.finished === true } : {}),
    // The transfer term is asked but not required: the answer is complete
    // without it, and the emails then say "term not entered".
    ...(b.graduate === 'nd-mscse-transfer' && b.transferredTerm ? { transferredTerm: b.transferredTerm } : {}),
    ...(asksAlsoElsewhere(b.graduate) ? { alsoElsewhere: b.alsoElsewhere === true, ...(b.alsoElsewhere ? { finished: b.finished === true } : {}) } : {}),
  };
}

/** Which previous-transcript rows this student needs. No answer yet → every
 * row, as before the questions existed. */
export function priorSlotsFor(b: Background | undefined): PriorSlot[] {
  if (!b) return ['bachelors', 'masters', 'phd'];
  const slots: PriorSlot[] = [];
  // A 4+1 elsewhere keeps the Undergraduate row: some universities issue two
  // transcripts, one per career, and the fold above the rows says which row
  // takes which shape.
  if (b.bachelors === 'elsewhere') slots.push('bachelors');
  if (b.graduate === 'elsewhere' || (asksAlsoElsewhere(b.graduate) && b.alsoElsewhere === true)) slots.push('masters', 'phd');
  return slots;
}

/** The rows for an answer still being given (2026-10-08, Option 1): a row
 * stays until the answer rules it out — the Undergraduate row unless the
 * bachelor's is known to be Notre Dame's, the Master's and Ph.D. rows unless
 * the earlier graduate history is known to hold nothing from elsewhere. */
export function priorSlotsForDraft(b: Partial<Background> | undefined): PriorSlot[] {
  if (!b) return ['bachelors', 'masters', 'phd'];
  const slots: PriorSlot[] = [];
  if (b.bachelors === undefined || b.bachelors === 'elsewhere') slots.push('bachelors');
  const noneElsewhere = b.graduate === 'none' || b.graduate === 'nd-other' || (asksAlsoElsewhere(b.graduate) && b.alsoElsewhere === false);
  if (!noneElsewhere) slots.push('masters', 'phd');
  return slots;
}

/** One line for the cards: "Bachelor’s: another university · Graduate degree before this program: none". */
export function describeBackground(b: Background): string {
  const bs =
    b.bachelors === 'elsewhere'
      ? 'another university'
      : b.bachelors === 'nd-cse'
        ? `Notre Dame CSE${b.ndIntegrated ? ' (Integrated B.S. + M.S.)' : ''}`
        : 'Notre Dame, another department';
  // A degree elsewhere beside the MSCSE held (P3-prior-programs-1).
  const elsewhereToo = b.alsoElsewhere ? `, and a graduate degree at another university (${b.finished ? 'finished' : 'not finished'})` : '';
  const grad =
    b.graduate === 'none'
      ? 'none'
      : b.graduate === 'nd-mscse'
        ? `the MSCSE at Notre Dame${elsewhereToo}`
        : b.graduate === 'nd-4plus1'
          ? `the MSCSE at Notre Dame (4+1)${elsewhereToo}`
          : b.graduate === 'nd-mscse-transfer'
          ? `${b.alsoElsewhere ? `${b.finished ? 'finished' : 'not finished'}, at another university; and ` : 'none — '}transferred into the Ph.D. from the Notre Dame MSCSE${b.transferredTerm ? ` in ${termLabel(b.transferredTerm)}` : ''} (the §4.3 and §4.5 clocks and admission to candidacy count from the MSCSE start, the §4.4 qualifier clocks and the first-year seminars from the transfer)`
          : b.graduate === 'nd-other'
            ? `Notre Dame, another department (${b.finished ? 'finished' : 'not finished'})`
            : `${b.finished ? 'finished' : 'not finished'}, at ${b.samePlace ? 'the same university as the bachelor’s (a 4+1 or 5+1)' : 'another university'}`;
  return `Bachelor’s: ${bs} · Graduate degree before this program: ${grad}`;
}

/** What an answer settles on the record — the facts the standing card's
 * prior-degree controls used to hold (removed 2026-09-22). Imports no longer
 * infer these once an answer exists. */
export function applyBackground(s: Student, b: Background): void {
  s.background = b;
  // A graduate degree elsewhere, or at Notre Dame in another department
  // (2026-10-03), is a prior graduate program under §5.2: 9 / 24 credits after
  // a finished degree, 6 after an unfinished one. The CSE MSCSE is not —
  // the Graduate School treats it as the same program as the Ph.D.
  s.priorMs = priorMsOfBackground(b);
  s.priorMsInferred = undefined;
  const holdsNdMscse = s.program === 'phd' && (b.graduate === 'nd-mscse' || b.graduate === 'nd-4plus1');
  s.ndMasters = holdsNdMscse ? { ...(s.ndMasters?.term ? { term: s.ndMasters.term } : {}) } : undefined;
  // Integrated 4+1: the MSCSE through the 4+1, or the answer to the follow-up
  // (asked of every student with a Notre Dame CSE bachelor's since 2026-10-03).
  s.integratedBsMs = b.graduate === 'nd-4plus1' || (b.bachelors === 'nd-cse' && b.ndIntegrated === true);
  s.integratedBsMsInferred = undefined;
  // The 4+1 admission term (2026-10-04) — the MSCSE's, beside a "yes".
  s.integratedAdmitted = s.program === 'mscse' && b.bachelors === 'nd-cse' && b.ndIntegrated === true ? b.integratedAdmittedTerm : undefined;
}

/** The questions as fieldsets, for `program`; `onChange` gets the current
 * partial answer after every click. `prefix` keeps the radio groups and
 * data-keys distinct between the opening dialog and the change dialog. */
export function backgroundQuestions(
  current: Partial<Background> | undefined,
  prefix: string,
  program: Program,
  onChange: (b: Partial<Background>) => void,
  /** One question at a time (the opening dialog, DGS 2026-09-23): the next
   * family appears only once the one before it is answered. The Change
   * dialog shows them all, since its answers already exist. */
  sequential = false,
  /** Which answers were read from transcripts, and from where (2026-10-08,
   * Option 1): each such question says so, for the student to check. */
  read: Partial<Record<keyof Background, string>> = {},
): HTMLElement {
  /** "Read from your transcript: … — change it if it is wrong." under a question. */
  const readNote = (k: keyof Background): HTMLElement[] =>
    read[k] ? [el('p', { class: 'hint read-from', id: `${prefix}-read-${k}`, 'data-key': `${prefix}.read.${k}` }, `Read from your transcripts: ${read[k]} — change it if it is wrong.`)] : [];
  /** Each choice of a question with a read note is described by it, so a
   * screen reader says it with the choice (review of Option 1, 2026-10-08). */
  const describedByRead = (box: HTMLElement, k: keyof Background): HTMLElement => {
    if (read[k]) for (const i of box.querySelectorAll('input')) i.setAttribute('aria-describedby', `${prefix}-read-${k}`);
    return box;
  };
  const state: Partial<Background> = { ...(current ?? {}) };
  if (program === 'mscse' && (state.graduate === 'nd-mscse' || state.graduate === 'nd-4plus1' || state.graduate === 'nd-mscse-transfer')) state.graduate = undefined;
  // Option rows (choiceRow), one per answer; a yes/no pair sits side by side.
  const radios = (name: string, options: [string, string][], chosen: string | undefined, pick: (v: string) => void, notes: Partial<Record<string, string>> = {}, inline = false): HTMLElement => {
    const box = el('div', { class: inline ? 'choices inline' : 'choices' });
    for (const [value, label] of options) {
      box.append(choiceRow({ name: `${prefix}-${name}`, value, head: label, sub: notes[value], dataKey: `${prefix}.${name}.${value}`, checked: chosen === value, onChange: () => pick(value) }));
    }
    return box;
  };
  const yesNo = (name: string, chosen: boolean | undefined, pick: (v: boolean) => void): HTMLElement =>
    radios(name, [['yes', 'Yes'], ['no', 'No']], chosen === undefined ? undefined : chosen ? 'yes' : 'no', (v) => pick(v === 'yes'), {}, true);
  // The follow-ups nest under their step (a left rule, no number of their own).
  const integratedBox = el('fieldset', { class: 'field group background-followup' });
  const elsewhereBox = el('fieldset', { class: 'field group background-followup' });
  const finishedBox = el('fieldset', { class: 'field group background-followup' });
  const transferBox = el('fieldset', { class: 'field group background-followup' });
  // A degree elsewhere beside the transfer (P3-prior-programs-2).
  const alsoElsewhereBox = el('fieldset', { class: 'field group background-followup' });
  // The transfer term (DGS 2026-09-28): a season and a year, kept only when
  // the year is a real one; the entry term is not touched.
  const termControls = (): HTMLElement => {
    const current = state.transferredTerm;
    const season = el('select', { 'data-key': `${prefix}.transferred.season`, 'aria-label': 'Semester of the transfer' }) as HTMLSelectElement;
    season.append(...SEASONS.map((se) => option(se, se[0]!.toUpperCase() + se.slice(1), (current?.season ?? 'fall') === se)));
    const year = el('input', { type: 'number', min: '2000', max: '2100', step: '1', 'data-key': `${prefix}.transferred.year`, 'aria-label': 'Year of the transfer', placeholder: 'year' }) as HTMLInputElement;
    if (current) year.value = String(current.year);
    const pick = (): void => {
      const y = Number(year.value);
      const next = Number.isInteger(y) && y >= 2000 && y <= 2100 ? { season: season.value as Season, year: y } : undefined;
      // A semester picked before the year changes nothing yet; on the page a
      // change re-renders the questions and would put the semester back to
      // Fall (review of Option 1, 2026-10-08).
      if (JSON.stringify(next) === JSON.stringify(state.transferredTerm)) return;
      state.transferredTerm = next;
      onChange(state);
    };
    season.onchange = pick;
    year.onchange = pick;
    return el('div', { class: 'term-pick' }, season, ' ', year);
  };
  // The 4+1 admission term (2026-10-04, P2-fourplusone-1): the same two
  // controls, kept on the answer only with a real year; optional.
  const admittedControls = (): HTMLElement => {
    const current = state.integratedAdmittedTerm;
    const season = el('select', { 'data-key': `${prefix}.admitted.season`, 'aria-label': 'Semester you were admitted to the Integrated program' }) as HTMLSelectElement;
    season.append(...SEASONS.map((se) => option(se, se[0]!.toUpperCase() + se.slice(1), (current?.season ?? 'fall') === se)));
    const year = el('input', { type: 'number', min: '2000', max: '2100', step: '1', 'data-key': `${prefix}.admitted.year`, 'aria-label': 'Year you were admitted to the Integrated program', placeholder: 'year' }) as HTMLInputElement;
    if (current) year.value = String(current.year);
    const pick = (): void => {
      const y = Number(year.value);
      const next = Number.isInteger(y) && y >= 2000 && y <= 2100 ? { season: season.value as Season, year: y } : undefined;
      if (JSON.stringify(next) === JSON.stringify(state.integratedAdmittedTerm)) return; // as above
      state.integratedAdmittedTerm = next;
      onChange(state);
    };
    season.onchange = pick;
    year.onchange = pick;
    return el('div', { class: 'term-pick' }, season, ' ', year);
  };
  const renderFollowUps = (): void => {
    // The boxes are rebuilt here, before the page's own render can remember
    // focus: a follow-up answer (the 4+1, "same university?", "also
    // elsewhere?") would drop focus to the top of the page (UI review,
    // 2026-10-08). The focused choice is found again by its data-key.
    const focusedKey = (document.activeElement as HTMLElement | null)?.dataset?.['key'];
    renderFollowUpBoxes();
    if (focusedKey?.startsWith(`${prefix}.`)) questions?.querySelector<HTMLElement>(`[data-key="${CSS.escape(focusedKey)}"]`)?.focus({ preventScroll: true });
  };
  const renderFollowUpBoxes = (): void => {
    syncGraduateRows();
    integratedBox.replaceChildren(
      el('legend', { class: 'followup-title' }, program === 'mscse' ? 'Are you in Notre Dame’s Integrated B.S. + M.S. (4+1) program? (§3.5)' : 'Were you in Notre Dame’s Integrated B.S. + M.S. (4+1) program as an undergraduate? (§3.5)'),
      // The timing, so a student admitted to the MSCSE after the bachelor's
      // does not answer yes (Graduate School 4+1 guidance; 2026-10-04).
      // Both Graduate School routes and CSE's timing (policy review round 3,
      // P3-fourplusone-4 (a)); "before the bachelor's" still screens out a
      // student admitted after it.
      ...(program === 'mscse' ? [el('p', { class: 'hint' }, 'Students are admitted while still undergraduates, before the bachelor’s degree: they apply in the junior year or, at the latest, the first semester of the senior year (Graduate School 4+1 guidance); CSE’s deadline is typically the end of the senior fall (§3.5).')] : []),
      // Read from the transcript's graduate-level senior courses (UI review,
      // 2026-10-08), said like every other reading.
      ...readNote('ndIntegrated'),
      describedByRead(
        yesNo('ndintegrated', state.ndIntegrated, (v) => {
          state.ndIntegrated = v;
          if (!v) state.integratedAdmittedTerm = undefined;
          renderFollowUps();
          onChange(state);
        }),
        'ndIntegrated',
      ),
      ...(program === 'mscse' && state.ndIntegrated === true
        ? [
            el(
              'div',
              { class: 'followup-sub' },
              // Since 2026-10-07 (DGS, P3-fourplusone-1) the term no longer
              // decides which courses count — only an admission after the
              // bachelor's does, so the label says just that.
              el('p', { class: 'label' }, 'When were you admitted (matriculated) into the Integrated program? Your admission letter says. Beyond the six credits shared with your bachelor’s degree, the Graduate School counts graduate courses taken as an undergraduate only for a student admitted before the bachelor’s degree.'),
              admittedControls(),
            ),
          ]
        : []),
    );
    // Asked of every student with a Notre Dame CSE bachelor's (2026-10-03);
    // for the Ph.D. it sits under the graduate-degree question, which may
    // already have answered it (the MSCSE through the 4+1).
    integratedBox.hidden = !asksIntegratedFor(state, program);
    elsewhereBox.replaceChildren(
      el('legend', { class: 'followup-title' }, 'Was it at the same university as your bachelor’s (a 4+1 or 5+1 program)?'),
      ...readNote('samePlace'),
      describedByRead(
        yesNo('sameplace', state.samePlace, (v) => {
          state.samePlace = v;
          // Re-decide what shows: in the opening dialog "Did you finish it?"
          // waits for this answer, and until 2026-09-29 nothing re-rendered
          // here, so it never appeared — the button stayed grey for every
          // student with a degree from another university. (The drivers had
          // clicked the hidden input and never noticed.)
          renderFollowUps();
          onChange(state);
        }),
        'samePlace',
      ),
    );
    finishedBox.replaceChildren(
      el(
        'legend',
        { class: 'followup-title' },
        // Another Notre Dame department, unfinished (policy review round 3,
        // P3-dh-3.14-3.20-1; DGS 2026-10-06: "Apply the handling"): a move into
        // CSE from it is a program transfer (DGS Handbook §3.15), not §5.2's six.
        state.graduate === 'nd-other'
          ? `Did you finish that degree? (After a finished one, §5.2 allows ${program === 'mscse' ? '9' : '24'} transfer credits; moving into CSE from an unfinished one is a program transfer — its courses count as yours from your first admission, DGS Handbook §3.15)`
          : // No figure for an unfinished Ph.D. (P4-transfer-4; DGS 2026-10-12).
            `Did you finish that degree? (§5.2 allows ${program === 'mscse' ? '9' : '24'} transfer credits after a finished master’s or Ph.D., 6 after an unfinished master’s; no figure is stated for an unfinished Ph.D.)`,
      ),
      ...readNote('finished'),
      describedByRead(
        yesNo('finished', state.finished, (v) => {
          state.finished = v;
          onChange(state);
        }),
        'finished',
      ),
    );
    elsewhereBox.hidden = state.graduate !== 'elsewhere';
    // Asked for a degree elsewhere and for one at Notre Dame in another
    // department alike (2026-10-03: the other department is "another graduate
    // program at Notre Dame", with the Code's 9 / 24 after a finished degree).
    finishedBox.hidden = !asksFinishedFor(state) || (sequential && state.graduate === 'elsewhere' && state.samePlace === undefined);
    transferBox.replaceChildren(
      el('legend', { class: 'followup-title' }, 'When did you transfer into the Ph.D.? (Your entry term stays the MSCSE’s — the §4.3 eight years and the eighth semester for the OCE (§4.5) and for admission to candidacy count from it; the §4.4 qualifier clocks and the first-year seminars count from this transfer term.)'),
      termControls(),
    );
    transferBox.hidden = state.graduate !== 'nd-mscse-transfer';
    // A student with the Notre Dame MSCSE — held, or left for the Ph.D. — may
    // also hold, or have started, a master's elsewhere (policy review round 3,
    // P3-prior-programs-2 and -1; DGS 2026-10-07: option (a)) — §5.2's 24 or 6
    // then apply to it, and "Did you finish that degree?" follows a yes.
    alsoElsewhereBox.replaceChildren(
      el('legend', { class: 'followup-title' }, 'Did you also hold, or start, a graduate degree at another university?'),
      ...readNote('alsoElsewhere'),
      describedByRead(
        yesNo('alsoelsewhere', state.alsoElsewhere, (v) => {
          state.alsoElsewhere = v;
          if (!v) state.finished = undefined;
          renderFollowUps();
          onChange(state);
        }),
        'alsoElsewhere',
      ),
    );
    alsoElsewhereBox.hidden = !asksAlsoElsewhere(state.graduate);
    // The graduate-degree family waits for the bachelor's answer (and, for
    // the MSCSE, the 4+1 follow-up); for the Ph.D. the 4+1 follow-up comes
    // after the graduate question, since that question may answer it.
    graduateBox.hidden = sequential && (state.bachelors === undefined || (program === 'mscse' && state.bachelors === 'nd-cse' && state.ndIntegrated === undefined));
    // These questions live in dialogs outside the page root, which the
    // after-render citation pass never reaches: label them here ("CSE §5.2",
    // DGS 2026-10-03, citations.ts).
    for (const box of [integratedBox, elsewhereBox, finishedBox, transferBox, alsoElsewhereBox]) labelCitationsIn(box);
    placeFollowUps();
  };
  // Each follow-up sits just below the answer that asked it (DGS 2026-10-07:
  // "Move these to where these selectors were triggered, just below them, so
  // that it's more intuitive") — the 4+1 question under "Notre Dame —
  // Computer Science and Engineering", "Was it at the same university…" and
  // "Did you finish…" under "Yes, at another university", and so on. They used
  // to follow the last numbered question, the Ph.D.'s 4+1 question after the
  // graduate-degree one. A box with nothing asking it stays hidden where it is.
  const placeFollowUps = (): void => {
    const rowOf = (list: HTMLElement, name: string, value: string | undefined): Element | null =>
      value === undefined ? null : (list.querySelector(`[data-key="${prefix}.${name}.${value}"]`)?.closest('label') ?? null);
    const underRow = (row: Element | null, boxes: HTMLElement[]): void => {
      let at = row;
      if (at === null) return;
      for (const box of boxes) {
        at.after(box);
        at = box;
      }
    };
    underRow(rowOf(bachelorsChoices, 'bachelors', state.bachelors), [integratedBox]);
    const g = state.graduate;
    underRow(
      rowOf(graduateChoices, 'graduate', g),
      g === 'elsewhere' ? [elsewhereBox, finishedBox] : g === 'nd-other' ? [finishedBox] : g === 'nd-mscse-transfer' ? [transferBox, alsoElsewhereBox, finishedBox] : asksAlsoElsewhere(g) ? [alsoElsewhereBox, finishedBox] : [],
    );
  };
  // A graduate answer, with the follow-up answers the old one held cleared.
  const setGraduate = (v: GraduateBefore | undefined): void => {
    state.graduate = v;
    if (v !== 'elsewhere') state.samePlace = undefined;
    if (v !== 'elsewhere' && v !== 'nd-other') state.finished = undefined;
    if (v !== 'nd-mscse-transfer') state.transferredTerm = undefined;
    if (v === undefined || !asksAlsoElsewhere(v)) state.alsoElsewhere = undefined;
  };
  // Only the graduate answers the bachelor's answer and the 4+1 follow-up
  // leave possible are shown, most probable first (DGS 2026-10-08); an answer
  // they rule out is dropped, so the record never holds a contradiction, and
  // the step waits for a new one. Every row is built, so the drivers'
  // data-keys stay; the rows are moved into order, not rebuilt.
  const syncGraduateRows = (): void => {
    if (state.graduate !== undefined && !graduatePossible(state.graduate, state, program)) setGraduate(undefined);
    const rowOf = (value: string): HTMLElement | null => graduateChoices.querySelector<HTMLInputElement>(`[data-key="${prefix}.graduate.${value}"]`)?.closest<HTMLElement>('label') ?? null;
    for (const [value] of graduateOptions(program)) {
      const row = rowOf(value);
      const input = row?.querySelector('input');
      if (!row || !input) continue;
      row.hidden = !graduatePossible(value, state, program);
      input.checked = state.graduate === value;
    }
    const wanted = graduateOptionsFor(state, program).map(([v]) => rowOf(v)).filter((r): r is HTMLElement => r !== null);
    const shown = [...graduateChoices.children].filter((n): n is HTMLElement => n instanceof HTMLElement && n.matches('label.choice') && !n.hidden);
    if (shown.length !== wanted.length || shown.some((r, i) => r !== wanted[i])) for (const row of wanted) graduateChoices.append(row);
  };
  // A numbered step (CSS counts the visible ones): the question is the heading.
  const graduateChoices = radios(
      'graduate',
      graduateOptions(program),
      state.graduate,
      (v) => {
        setGraduate(v as GraduateBefore);
        // The MSCSE through the 4+1 answers the Ph.D.'s 4+1 follow-up: "Yes"
        // (2026-10-08; it used to clear the follow-up, which reordered and
        // re-showed the options for a 4+1 still open).
        if (program === 'phd' && v === 'nd-4plus1') state.ndIntegrated = true;
        renderFollowUps();
        onChange(state);
      },
      GRADUATE_NOTES,
    );
  const graduateBox = el('fieldset', { class: 'field group step' }, el('legend', { class: 'step-title' }, 'Did you hold, or start, a graduate degree before this program?'), ...readNote('graduate'), describedByRead(graduateChoices, 'graduate'));
  const bachelorsChoices = radios('bachelors', BACHELORS_OPTIONS, state.bachelors, (v) => {
    state.bachelors = v as BachelorsFrom;
    if (v !== 'nd-cse') state.ndIntegrated = undefined;
    renderFollowUps();
    onChange(state);
  });
  // The follow-ups start parked at the end, hidden; placeFollowUps moves each
  // one under the answer that asks it.
  const questions = el(
    'div',
    { class: 'background-questions' },
    el('fieldset', { class: 'field group step' }, el('legend', { class: 'step-title' }, 'Where is your bachelor’s degree from?'), ...readNote('bachelors'), describedByRead(bachelorsChoices, 'bachelors')),
    graduateBox,
    integratedBox,
    elsewhereBox,
    transferBox,
    alsoElsewhereBox,
    finishedBox,
  );
  renderFollowUps();
  labelCitationsIn(questions);
  return questions;
}

/** The "Change" dialog on the Transcripts and standing cards: the same
 * questions for the record's program, saved on "Save", left alone on Cancel
 * or Escape. (The program itself changes only through Reset.) */
export function openBackgroundDialog(student: Student, update: (fn: (s: Student) => void) => void, returnKey: string): void {
  const program = student.program;
  let answer: Partial<Background> | undefined = student.background;
  const save = el('button', { class: 'btn primary', 'data-key': 'background.save' }, 'Save');
  if (completeBackground(answer, program) === undefined) save.setAttribute('disabled', 'disabled');
  const dialog = el(
    'dialog',
    { class: 'consent background-dialog', 'aria-labelledby': 'background-title' },
    el(
      'div',
      { class: 'consent-box' },
      el('h2', { id: 'background-title' }, 'Your earlier degrees'),
      el('p', { class: 'hint' }, 'These answers decide which transcript rows you see and how §5.2 applies. A Notre Dame degree is on the same insideND transcript as your current program, so it needs no row of its own. To change the degree you are working toward, use Reset.'),
      backgroundQuestions(
        answer,
        'background',
        program,
        (b) => {
          answer = b;
          if (completeBackground(b, program)) save.removeAttribute('disabled');
          else save.setAttribute('disabled', 'disabled');
        },
        false,
        student.backgroundRead ?? {},
      ),
      el('div', { class: 'save-buttons' }, save, el('button', { class: 'btn', 'data-key': 'background.cancel', onclick: () => close() }, 'Cancel')),
    ),
  ) as HTMLDialogElement;
  const close = (): void => {
    if (dialog.open) dialog.close();
    dialog.remove();
    returnFocusTo(returnKey);
  };
  save.addEventListener('click', () => {
    const b = completeBackground(answer, program);
    if (b)
      update((s) => {
        // Saving is the student's check of what was read from transcripts:
        // no answer is "read" after it (2026-10-08, Option 1 — the notes show
        // in this dialog, under each question they concern).
        s.backgroundRead = undefined;
        applyBackground(s, b);
        s.backgroundDraft = undefined;
      });
    close();
  });
  dialog.addEventListener('close', () => dialog.remove());
  labelCitationsIn(dialog); // outside the root, like the toasts (citations.ts)
  document.body.append(dialog);
  if (openModal(dialog)) (dialog.querySelector('input[type=radio]') as HTMLElement | null)?.focus();
}
