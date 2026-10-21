// Toasts live in a stack created once OUTSIDE the root (2026-09-06
// evening). render() rebuilds the page on every change, and an Undo that
// lived inside it died with the first keystroke, checkbox or "Reading…"
// toast after a Remove — the DGS's "the review card never comes back". Now
// a plain toast has one slot (4 s), and each Undo is its own element (12 s
// for a row, 20 s for a transcript-wide removal) that no plain toast
// replaces; Clear and Load a file cancel every Undo, since a
// stale one would splice old rows into a replaced record. The stack is one
// polite live region, so screen readers hear each message (a region created
// per toast would not be announced). (Moved out of app.ts on 2026-09-20.)
// Being outside the root, the stack misses the page's after-render citation
// pass, so each message is labelled here ("CSE §4.4.2", citations.ts).
import { labelCitations } from './citations.ts';
import { el } from './dom.ts';
import { isEmbedded, lastInteractionTop } from './embed.ts';

export interface Toasts {
  /** A plain message: one slot, 4 s. */
  toast: (msg: string) => void;
  /** A notice that a choice was made for the student: its own slot, 12 s. */
  notice: (msg: string) => void;
  /** The next step after a finished one (next-step.ts): its own slot, 12 s. */
  nextStepNote: (msg: string) => void;
  /** Dismiss every Undo toast (before the record is replaced wholesale). */
  cancelUndo: () => void;
  /** A toast carrying one action (Undo). */
  toastWithAction: (msg: string, actionLabel: string, action: () => void, opts?: { ttlMs?: number; focusKey?: string }) => void;
}

/** Create the stack (appended to document.body once) and the four ways to
 * put a message in it. `setFocusAfterRender` is the focus keeper's: an Undo
 * button lives outside the root, so the rebuild has nothing to remember, and
 * the action names the control to focus after its render instead. */
export function createToasts(setFocusAfterRender: (key: string) => void): Toasts {
  const toastStack = el('div', { class: 'toast-stack', role: 'status', 'aria-live': 'polite' });
  document.body.append(toastStack);
  // Embedded, a fixed bottom stack would sit at the end of a tall frame: the
  // stack goes just below where the student last acted instead (2026-09-16).
  const placeToasts = (): void => {
    if (!isEmbedded()) return;
    toastStack.style.top = `${lastInteractionTop() + 48}px`;
  };
  let plainToast: HTMLElement | undefined;
  let plainToastTimer: number | undefined;
  const toast = (msg: string): void => {
    plainToast?.remove();
    const t = el('div', { class: 'toast show' }, labelCitations(msg));
    plainToast = t;
    placeToasts();
    toastStack.prepend(t);
    window.clearTimeout(plainToastTimer);
    plainToastTimer = window.setTimeout(() => {
      t.remove();
      if (plainToast === t) plainToast = undefined;
    }, 4000);
  };
  /** A notice that a choice was made for the student (2026-09-12): its own
   * slot, so the plain toast that follows the same action ("… added to your
   * coursework") does not replace it. Stays 12 s. */
  let noticeToast: HTMLElement | undefined;
  const notice = (msg: string): void => {
    noticeToast?.remove();
    const t = el('div', { class: 'toast show auto-notice' }, labelCitations(msg));
    noticeToast = t;
    placeToasts();
    toastStack.prepend(t);
    window.setTimeout(() => {
      t.remove();
      if (noticeToast === t) noticeToast = undefined;
    }, 12000);
  };
  /** The next step after a finished one (DGS 2026-10-17): its own slot, so
   * the action's own message ("… courses added") stays, and BELOW it — the
   * stack's newest message is first, and the step follows the action. 12 s,
   * a little longer than the ring. */
  let nextStepToast: HTMLElement | undefined;
  let nextStepTimer: number | undefined;
  const nextStepNote = (msg: string): void => {
    nextStepToast?.remove();
    const t = el('div', { class: 'toast show next-step-note' }, labelCitations(msg));
    nextStepToast = t;
    placeToasts();
    toastStack.append(t);
    window.clearTimeout(nextStepTimer);
    nextStepTimer = window.setTimeout(() => {
      t.remove();
      if (nextStepToast === t) nextStepToast = undefined;
    }, 12000);
  };
  const undoToasts = new Map<HTMLElement, number>();
  const cancelUndo = (): void => {
    for (const [t, timer] of undoToasts) {
      window.clearTimeout(timer);
      t.remove();
    }
    undoToasts.clear();
  };
  /** A toast carrying one action (Undo) — stays longer, is clickable, and
   * survives re-renders. `focusKey` names the control to focus after the
   * action's render (the button lives outside the root, so the rebuild has
   * nothing to remember). */
  const toastWithAction = (msg: string, actionLabel: string, action: () => void, opts: { ttlMs?: number; focusKey?: string } = {}): void => {
    for (const [t, timer] of undoToasts) {
      if (undoToasts.size < 3) break; // at most three live Undos — the oldest goes
      window.clearTimeout(timer);
      t.remove();
      undoToasts.delete(t);
    }
    const t = el('div', { class: 'toast show has-action' }, labelCitations(msg), ' ');
    const dismiss = (): void => {
      const timer = undoToasts.get(t);
      if (timer !== undefined) window.clearTimeout(timer);
      undoToasts.delete(t);
      t.remove();
    };
    t.append(
      el(
        'button',
        {
          class: 'toast-action',
          onclick: () => {
            dismiss();
            if (opts.focusKey !== undefined) setFocusAfterRender(opts.focusKey);
            action();
          },
        },
        actionLabel,
      ),
    );
    placeToasts();
    toastStack.prepend(t);
    undoToasts.set(t, window.setTimeout(dismiss, opts.ttlMs ?? 12000));
  };
  return { toast, notice, nextStepNote, cancelUndo, toastWithAction };
}
