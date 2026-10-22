// Tiny DOM helpers. Everything user-entered is rendered through textContent —
// never innerHTML — so a course id like "<img onerror=…>" is inert text.
export type Child = Node | string | null | undefined;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | boolean | ((ev: Event) => void)> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (typeof value === 'function') {
      node.addEventListener(key.replace(/^on/, ''), value);
    } else if (typeof value === 'boolean') {
      if (value) node.setAttribute(key, '');
    } else if (key === 'value' && 'value' in node) {
      (node as HTMLInputElement).value = value;
    } else {
      node.setAttribute(key, value);
    }
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function clear(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function option(value: string, label: string, selected = false): HTMLOptionElement {
  const o = el('option', { value }, label);
  o.selected = selected;
  return o;
}

/** Why the transcript-row buttons are inactive while a preview is open (DGS
 * request 2026-09-06) — shown on hover, on click, and to screen readers. */
export const PREVIEW_OPEN_NOTE =
  'Not available while a transcript preview is open: finish selecting and adding those courses (“Add …”), or cancel the preview, and this button becomes active again.';

/** Why a previous transcript's import is inactive until the earlier-degrees
 * questions are answered and Done is clicked (DGS 2026-10-14: "Disable
 * previous transcript import buttons until these selections are finished and
 * 'Done' is clicked"). */
export const EARLIER_DEGREES_FIRST_NOTE =
  'Not available yet: answer the questions under “Your earlier degrees” and click Done — they decide which earlier transcripts to add here and how CSE §5.2 applies to them.';

/** Why every transcript import (and the OCR opt-in) is inactive in simulation
 * mode (DGS 2026-10-09, D6): a transcript is real data, and the mode holds a
 * plan — it is imported into the record, outside the mode. */
export const SIMULATION_IMPORT_NOTE =
  'Not available in simulation mode — a transcript is real data. Exit the simulation, import it into your record, and simulate from there.';

// Simulation mode (DGS 2026-10-09: "no DGS request, grad admin request, or
// advisor report should be possible"; D6/D7): the reason the three sending
// buttons give on hover and click — the two request cards' (request-cards.ts)
// and the advisor summary's (app.ts). Beside SIMULATION_IMPORT_NOTE since
// 2026-10-22 (W11), when the request cards left app.ts.
/** The three things that send: "the review request", "the processing
 * request", "the summary to your advisor". */
export const simulationSendNote = (what: string): string => `Not available in simulation mode — nothing is sent from a plan. Exit the simulation to send ${what} from your record.`;

/** A button that is inactive for a stated reason. Not the `disabled`
 * attribute: a disabled button gets no hover, no focus and no click, so its
 * reason could never be shown. `aria-disabled` keeps it in the tab order and
 * reachable by the mouse; the reason is the tooltip, and a click repeats it
 * through `explain` (a toast) instead of acting. */
export function inactiveButton(
  attrs: Record<string, string | boolean | ((ev: Event) => void)>,
  reason: string,
  explain: (reason: string) => void,
  ...children: Child[]
): HTMLButtonElement {
  const { onclick: _ignored, class: cls, ...rest } = attrs;
  return el(
    'button',
    {
      ...rest,
      class: `${typeof cls === 'string' ? cls : ''} inactive`.trim(),
      'aria-disabled': 'true',
      title: reason,
      onclick: (ev) => {
        ev.preventDefault();
        explain(reason);
      },
    },
    ...children,
  );
}
