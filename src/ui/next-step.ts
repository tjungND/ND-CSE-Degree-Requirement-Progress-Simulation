// The next step, shown after the earlier-degrees answer is saved (DGS
// 2026-10-16: "After clicking 'Done', it's not easy to find out what part
// student needs to look at. Highlight the next step on the page.").
//
// The next step is the first earlier-transcript row the answer opened that is
// still empty, its "Import from PDF" active — the rows shown are the ones the
// answer needs (external-upload.ts priorSlotsFor) — else the first item on the
// Next steps list, its target card (the same list the page shows, so the two
// never disagree). It is scrolled into view, focused, ringed with a "Next
// step" tag for a few seconds and said in a toast. render() rebuilds the page
// on every change to the record, so any later change ends the ring.

/** How long the ring stays, in milliseconds. */
const RING_MS = 10_000;

export interface NextStepTarget {
  /** The row or card to ring. */
  box: HTMLElement;
  /** What takes focus: the row's Import button, or the card's heading. */
  focus: HTMLElement;
  /** What the toast says (W-CL523 / W-CL524). */
  message: string;
}

/** The next step on the page as it is now, or undefined when there is none. */
export function findNextStep(doc: ParentNode): NextStepTarget | undefined {
  for (const row of doc.querySelectorAll<HTMLElement>('.external-slot')) {
    // An empty row offers its import; a row with courses offers Remove.
    const button = row.querySelector<HTMLElement>('[data-key^="ext.import."]');
    if (!button || button.getAttribute('aria-disabled') === 'true') continue;
    const label = row.querySelector('.slot-label')?.textContent?.trim() || 'earlier transcript';
    return { box: row, focus: button, message: `Saved — next, import your ${label} (highlighted).` };
  }
  const link = doc.querySelector<HTMLAnchorElement>('[data-key="report.nextsteps"] ol.next-steps li a[href^="#"]');
  const id = link?.getAttribute('href')?.slice(1);
  const card = id ? (doc.querySelector(`[id="${id.replace(/"/g, '')}"]`) as HTMLElement | null) : null;
  if (!link || !card) return undefined;
  const heading = card.querySelector<HTMLElement>('h2, h3') ?? card;
  return { box: card, focus: heading, message: `Saved — next: ${link.closest('li')?.textContent?.trim() ?? link.textContent?.trim() ?? ''}` };
}

/** Scroll to the next step, focus it, ring it and say it. */
export function showNextStep(target: NextStepTarget | undefined, toast: (message: string) => void): void {
  if (!target) return;
  const { box, focus, message } = target;
  const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  box.classList.add('next-step-ring');
  const tag = document.createElement('span');
  tag.className = 'next-step-tag';
  tag.setAttribute('aria-hidden', 'true'); // the toast says it
  tag.textContent = 'Next step';
  box.append(tag);
  // A heading takes focus only with a tabindex.
  if (focus.tabIndex < 0 && !focus.hasAttribute('tabindex')) focus.setAttribute('tabindex', '-1');
  focus.focus({ preventScroll: true });
  box.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
  toast(message);
  window.setTimeout(() => {
    box.classList.remove('next-step-ring');
    tag.remove();
  }, RING_MS);
}
