// The next step, highlighted after every step the student finishes (DGS
// 2026-10-16, for the earlier-degrees Done: "Highlight the next step on the
// page"; 2026-10-17, for every step: "after student completes each step,
// highlight the next things to do. Just like how transcript upload was
// highlighted after clicking 'Done' in the standing choices").
//
// What the page asks for is read off the page after every render
// (`pendingOn`), in the order a student takes it (`ORDER`): the Notre Dame
// import while the record is new (the card's "Start here"); what the
// transcript set (Your standing); the earlier-degrees questions and their
// Done; each earlier-transcript row still without its courses; then the
// Next steps list, item by item (next-steps.ts STEP_KEYS). When a change the
// student made (app.ts `update`) leaves one of them no longer asked for, that
// step is finished (`finishedBetween`), and the next one (`nextAfter`) — the
// first still asked for AFTER it, else the first still asked for — is
// scrolled into view, focused, ringed with a "Next step" tag for ten seconds
// and said in a message (`showNextStep`), for a button and for an answer in
// a field alike (DGS 2026-10-17: "Scroll and focus too"). A step that waits
// on someone else, or has no place on the page, is never next. render()
// rebuilds the page on every change, so the next change ends the ring.
import { applyDeciderRule } from './first-mention.ts';
import { STEP_KEYS, type NextStep, type StepKey } from './next-steps.ts';

/** How long the ring stays, in milliseconds. */
const RING_MS = 10_000;

/** One thing the page asks for: `import.nd`, `earlier.done`,
 * `import:<slot>` (an earlier-transcript row) or `step:<key>`. */
export type PendingId = string;

const SLOTS = ['bachelors', 'masters', 'phd'] as const;
const BEFORE_TRANSCRIPTS: readonly StepKey[] = ['standing.entry', 'standing.check', 'earlier-degrees'];
/** The order a student takes them in: the transcripts and what they set
 * first, then the Next steps list in its own order. */
export const ORDER: readonly PendingId[] = [
  'import.nd',
  ...BEFORE_TRANSCRIPTS.map((k) => `step:${k}`),
  'earlier.done',
  ...SLOTS.map((s) => `import:${s}`),
  ...STEP_KEYS.filter((k) => !BEFORE_TRANSCRIPTS.includes(k)).map((k) => `step:${k}`),
];
const rank = (id: PendingId): number => {
  const i = ORDER.indexOf(id);
  return i < 0 ? ORDER.length : i;
};

/** What the page asks for now. `newRecord`: nothing entered yet — no
 * course, milestone or GPA (app.ts `untouched`). */
export function pendingOn(doc: ParentNode, steps: readonly NextStep[], newRecord = false): Set<PendingId> {
  const out = new Set<PendingId>();
  // The Notre Dame import, while the record is new (the card's "Start here";
  // DGS 2026-10-17, "New record only"): a record with courses typed or loaded
  // is not sent back to it.
  if (newRecord && doc.querySelector('[data-key="import.nd"]') && !doc.querySelector('[data-key="import.nd.remove"]')) out.add('import.nd');
  if (doc.querySelector('[data-key="earlier.done"]')) out.add('earlier.done');
  // An earlier-transcript row offers Import while it has no courses (Remove once it has).
  for (const b of doc.querySelectorAll<HTMLElement>('.external-slot [data-key^="ext.import."]')) out.add(`import:${b.getAttribute('data-key')!.slice('ext.import.'.length)}`);
  for (const s of steps) out.add(`step:${s.key}`);
  return out;
}

/** What was asked for before and is not any more: the steps just finished. */
export function finishedBetween(before: ReadonlySet<PendingId>, now: ReadonlySet<PendingId>): PendingId[] {
  return [...before].filter((id) => !now.has(id));
}

/** The order to look for the next step in, after `finished` was done: what
 * is still asked for after the earliest of them, then from the start. */
export function nextOrder(finished: readonly PendingId[], now: ReadonlySet<PendingId>): PendingId[] {
  const from = Math.min(...finished.map(rank));
  const open = [...now].sort((a, b) => rank(a) - rank(b));
  return [...open.filter((id) => rank(id) > from), ...open.filter((id) => rank(id) <= from)];
}

export interface NextStepTarget {
  /** What is ringed: the control's row or field, or a card. */
  box: HTMLElement;
  /** What takes focus: the control, or the card's heading. */
  focus: HTMLElement;
  /** What the message says (W-CL525–W-CL527). */
  message: string;
}

/** A control the student can use now (not one shown inactive with a reason). */
const usable = (e: Element | null | undefined): e is HTMLElement => e instanceof HTMLElement && e.getAttribute('aria-disabled') !== 'true' && !(e as HTMLButtonElement).disabled;

/** The control's own row or field, where the ring goes. */
const boxOf = (control: HTMLElement): HTMLElement => (control.closest('.external-slot, .earlier-done, fieldset, .field, label, td, li, .save-buttons, p') as HTMLElement | null) ?? control.parentElement ?? control;

/** The first question in `root` with no answer picked: its first option. */
function firstUnanswered(root: Element | null): HTMLElement | null {
  if (!root) return null;
  const groups = new Map<string, HTMLInputElement[]>();
  for (const r of root.querySelectorAll<HTMLInputElement>('input[type="radio"]')) groups.set(r.name, [...(groups.get(r.name) ?? []), r]);
  for (const options of groups.values()) if (!options.some((o) => o.checked)) return options[0] ?? null;
  return null;
}

/** Where each Next steps item is done, when the page has a control for it.
 * `step` is the item as listed, for a key whose place depends on its text. */
const CONTROL: Partial<Record<StepKey, (doc: Document, step: NextStep) => Element | null | undefined>> = {
  'standing.entry': (d) => d.querySelector('[data-key="standing.season"]'),
  // Ended-semester courses still In progress (blue-team review 2026-10-17,
  // U21): the Transcripts card's "Import again" when the step offers it (its
  // link says so); otherwise the step's card. An inactive button (a preview
  // open, simulation mode) is not usable, so the card is ringed instead.
  'grades.update': (d, step) => (step.href === '#transcripts' ? d.querySelector('[data-key="import.nd"]') : null),
  // No fallback to "Set the exact semester" (blue-team review 2026-10-17, U4):
  // that button is optional, and the step never lists a "before" reading.
  'standing.check': (d) => d.querySelector('[data-key="standing.entry.confirm"]') ?? d.querySelector('[data-key="standing.bachelors.confirm"]'),
  'earlier-degrees': (d) => d.querySelector('[data-key="earlier.answer"]') ?? firstUnanswered(d.getElementById('earlier-degrees')),
  'coursework.degrees': (d) => [...d.querySelectorAll<HTMLSelectElement>('select[data-key$=".countedToward"]')].find((s) => s.value === ''),
  'review.send': (d) => d.querySelector('[data-key="review.copy"]'),
  'advisor.name': (d) => d.querySelector('[data-key="milestone.advisorName"]'),
  'advisor.tenure': (d) => firstUnanswered(d.querySelector('[data-key^="milestone.advisorTtt."]')?.closest('fieldset') ?? null),
  'advisor.approved': (d) => d.querySelector('[data-key^="attest.my-advisor-approved-my-coursework"]'),
  'thesis.topic': (d) => d.querySelector('[data-key="milestone.thesisTopicApproved"]'),
  'processing.send': (d) => d.querySelector('[data-key="gradadmin.copy"]'),
  'ms-candidacy': (d) => d.querySelector('[data-key="gradadmin.copy"]'),
};

/** A transcript row's Import, ringed with its row (W-CL525). */
function importTarget(button: Element | null): NextStepTarget | undefined {
  if (!usable(button)) return undefined;
  const row = (button.closest('.external-slot, .transcript-upload') as HTMLElement | null) ?? boxOf(button);
  const label = row.querySelector('.slot-label')?.textContent?.trim() || 'transcript';
  return { box: row, focus: button, message: `Next step: import your ${label} (highlighted).` };
}

/** Where `id` is done on the page, if it can be done now. */
export function targetOf(doc: Document, id: PendingId, steps: readonly NextStep[], program: 'mscse' | 'phd'): NextStepTarget | undefined {
  if (id === 'import.nd') return importTarget(doc.querySelector('[data-key="import.nd"]'));
  if (id.startsWith('import:')) return importTarget(doc.querySelector(`[data-key="ext.import.${id.slice('import:'.length)}"]`));
  if (id === 'earlier.done') {
    const done = doc.querySelector('[data-key="earlier.done"]');
    return usable(done) ? { box: boxOf(done), focus: done, message: 'Next step: click Done to save your answers about your earlier degrees (highlighted).' } : undefined;
  }
  const key = id.slice('step:'.length) as StepKey;
  const step = steps.find((s) => s.key === key);
  if (!step || step.waiting || !step.href) return undefined;
  // The step as the page lists it (its DGS already the ADGS on the MSCSE
  // tab); a list not shown (a new record) — its text, with the same rule.
  let text = doc.querySelector(`[data-key="report.nextsteps"] li[data-step="${key}"]`)?.textContent?.trim();
  if (!text) {
    const words = doc.createElement('span');
    words.textContent = step.text;
    applyDeciderRule(words, program);
    text = words.textContent ?? step.text;
  }
  const message = `Next step: ${text}`;
  const control = CONTROL[key]?.(doc, step);
  if (usable(control)) return { box: boxOf(control), focus: control, message };
  const card = doc.getElementById(step.href.slice(1));
  if (!card) return undefined;
  return { box: card, focus: card.querySelector<HTMLElement>('h2, h3, legend') ?? card, message };
}

/** The next step after `finished`, or undefined when nothing on the page is left to do. */
export function nextAfter(doc: Document, finished: readonly PendingId[], now: ReadonlySet<PendingId>, steps: readonly NextStep[], program: 'mscse' | 'phd'): NextStepTarget | undefined {
  for (const id of nextOrder(finished, now)) {
    const target = targetOf(doc, id, steps, program);
    if (target) return target;
  }
  return undefined;
}

let ringed: HTMLElement | undefined;
let ringTimer: number | undefined;

/** Scroll to the next step, focus it, ring it and say it. */
export function showNextStep(target: NextStepTarget | undefined, say: (message: string) => void): void {
  if (!target) return;
  const { box, focus, message } = target;
  // One ring at a time: a step finished while the last ring is on moves it.
  window.clearTimeout(ringTimer);
  ringed?.classList.remove('next-step-ring');
  const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  box.classList.add('next-step-ring');
  ringed = box;
  // A heading takes focus only with a tabindex.
  if (focus.tabIndex < 0 && !focus.hasAttribute('tabindex')) focus.setAttribute('tabindex', '-1');
  focus.focus({ preventScroll: true });
  box.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
  say(message);
  ringTimer = window.setTimeout(() => {
    box.classList.remove('next-step-ring');
    if (ringed === box) ringed = undefined;
  }, RING_MS);
}
