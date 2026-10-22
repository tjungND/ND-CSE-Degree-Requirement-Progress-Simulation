// The loading card shown while the course rules come from the sheet (DGS
// choice 2026-09-01, "Option A"): a step list that ticks as each tab arrives
// (and says when a stalled request is being asked again), a bar against the
// ~30-second budget and an elapsed counter. When the load fails the same card
// explains why and suggests RELOADING first; the copy saved in the app is
// offered as a second choice and is never shown automatically.
import { deviceNow, notreDameNow, type NotreDameNow } from '../data/clock.ts';
import {
  EXTERNAL_TAB_CONFIGURED, UNIVERSITIES_TAB_CONFIGURED,
  LOAD_BUDGET_MS,
  RulesLoadError,
  loadLiveRules,
  rulesFromSnapshot,
  snapshotSavedOn,
  type LoadProgress,
  type TabName,
} from '../data/load.ts';
import type { Rules } from '../data/types.ts';
import { DGS, mailto } from './contacts.ts';
import { clear, el } from './dom.ts';

const BUDGET_S = LOAD_BUDGET_MS / 1000;

/** What the loading card establishes before the page renders: the rules, and
 * the date the whole self-check runs against (DGS 2026-09-07). */
export interface LoadedStart {
  rules: Rules;
  today: NotreDameNow;
}

/** Render the loading card into `root`, load the rules, and resolve with them
 * and with today's date at Notre Dame: the live rules, or the saved copy if the
 * student chooses it after a failure.
 * The caller clears `root` and renders the page when this resolves. */
export function loadRulesWithCard(root: HTMLElement, nowIso: string): Promise<LoadedStart> {
  return new Promise((resolve) => {
    const spinner = () => el('span', { class: 'spin', 'aria-hidden': 'true' });
    const title = el('strong', {}, 'Loading the current course rules');
    // The budget ("up to about 30 s") is printed once, on the elapsed line under
    // the bar, not here as well (trim review 2026-09-18, P-92).
    const subtitle = el('div', { class: 'load-sub' }, 'from the DGS’s Google Spreadsheet — usually a few seconds; a slow answer is asked for again');
    const headSpin = spinner();

    type Step = { li: HTMLLIElement; dot: HTMLSpanElement; detail: HTMLSpanElement };
    const makeStep = (label: string): Step => {
      const dot = el('span', { class: 'dot' });
      const detail = el('span', { class: 'detail' });
      return { li: el('li', {}, dot, label, ' ', detail), dot, detail };
    };
    const tabSteps: Partial<Record<TabName, Step>> = {
      courses: makeStep('Reading the course list'),
      parameters: makeStep('Reading the parameters'),
      categories: makeStep('Reading the categories'),
      ...(EXTERNAL_TAB_CONFIGURED ? { external: makeStep('Reading the course rules') } : {}),
      ...(UNIVERSITIES_TAB_CONFIGURED ? { universities: makeStep('Reading the university list') } : {}),
    };
    const steps = {
      clock: makeStep('Checking today’s date at Notre Dame'),
      connect: makeStep('Connecting to the spreadsheet'),
      ...tabSteps,
      check: makeStep('Checking when the rules were last updated'),
    } as { clock: Step; connect: Step; check: Step } & Partial<Record<TabName, Step>>;
    const setStep = (s: Step, state: 'pending' | 'active' | 'done' | 'failed', detail?: string) => {
      s.li.className = state;
      clear(s.dot);
      if (state === 'active') s.dot.append(el('span', { class: 'spin sm', 'aria-hidden': 'true' }));
      if (state === 'done') s.dot.textContent = '✓';
      if (state === 'failed') s.dot.textContent = '!';
      if (detail !== undefined) s.detail.textContent = detail;
    };

    // The card is one polite live region, and a 100 ms timer rewrites the
    // elapsed counter and the bar inside it (blue-team review 2026-10-17,
    // U22): role="status" implies aria-atomic="true", so every tick
    // re-announced the WHOLE card and drowned the step ticks the region is
    // for. The counter and the bar are hidden from assistive technology (the
    // visual tick stays) and the card announces only the line that changed.
    // The card stays the region: one created or filled later is often not
    // announced at all.
    const barFill = el('i');
    const bar = el('div', { class: 'bar load-bar', 'aria-hidden': 'true' }, barFill);
    const elapsedNum = el('span', {}, '0.0');
    const elapsed = el('div', { class: 'elapsed', 'aria-hidden': 'true' }, elapsedNum, ` s elapsed · up to about ${BUDGET_S} s`);
    const card = el(
      'div',
      { class: 'load-card', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'false' },
      el('div', { class: 'load-head' }, headSpin, el('div', {}, title, subtitle)),
      el('ol', { class: 'steps' }, ...Object.values(steps).map((s) => s.li)),
      bar,
      elapsed,
    );
    clear(root);
    root.append(card);
    setStep(steps.connect, 'active');

    // The date the whole self-check runs against (DGS 2026-09-07). Read from
    // the server this page was served by — same origin, no student data, no
    // third party — and shown in Notre Dame's own time zone, so a student
    // abroad or with a wrong device clock still gets Notre Dame's calendar.
    // The device clock is the fallback, and the card says when it was used.
    let today: NotreDameNow = deviceNow();
    setStep(steps.clock, 'active');
    const clockReady = notreDameNow({ url: window.location.href })
      .then((t) => {
        today = t;
      })
      .catch(() => undefined)
      .then(() => {
        const caveat = !today.zoneOk
          ? ' — this browser does not know Notre Dame’s time zone, so this device’s calendar was used'
          : today.source === 'device'
            ? ' — from this device’s clock; this site’s own server did not answer'
            : '';
        setStep(steps.clock, today.source === 'server' && today.zoneOk ? 'done' : 'failed', `${today.label}${caveat}`);
      });
    /** Resolve once the date is settled, so the page never renders against a
     * clock that is still being checked. */
    const finish = (rules: Rules): void => {
      void clockReady.then(() => resolve({ rules, today }));
    };

    const started = performance.now();
    const timer = window.setInterval(() => {
      const t = (performance.now() - started) / 1000;
      elapsedNum.textContent = t.toFixed(1);
      barFill.style.width = `${Math.min(t / BUDGET_S, 1) * 100}%`;
    }, 100);
    const stop = () => {
      window.clearInterval(timer);
      headSpin.remove();
    };

    const onProgress = (p: LoadProgress) => {
      if (p.step === 'connect') return;
      if (p.step === 'retry') {
        // A stalled request: say so, so a 10-second wait is not a mystery.
        // (The "connecting" step stays as it is — a dropped connection is
        // retried too, and only a tab that arrives proves the connection.)
        const step = tabSteps[p.tab];
        if (step) setStep(step, 'active', p.hedged ? '— Google is slow; asking again' : `— still nothing; asking again (attempt ${p.attempt} of ${p.of})`);
        return;
      }
      if (p.step === 'tab') {
        // The first tab to arrive proves the connection works.
        if (steps.connect.li.className !== 'done') {
          setStep(steps.connect, 'done');
          for (const s of Object.values(tabSteps)) if (s.li.className !== 'done') setStep(s, 'active');
        }
        const step = tabSteps[p.tab];
        if (step) setStep(step, 'done', `(${p.rows.toLocaleString('en-US')} rows)`);
      }
      if (p.step === 'check') setStep(steps.check, 'active');
    };

    const fail = (err: unknown) => {
      stop();
      const e = err instanceof RulesLoadError ? err : new RulesLoadError('unreachable', undefined, 'Something went wrong while loading the rules.', true);
      card.classList.add('failed');
      bar.classList.add('warn');
      barFill.style.width = '100%';
      title.textContent = e.retryable ? 'The course rules could not be loaded' : 'The spreadsheet has a problem';
      subtitle.textContent = e.kind === 'timeout' ? 'Google did not answer in time' : 'nothing was changed on your side';
      // Mark what was still pending: the tab that failed, or everything not yet done.
      const pendingTabs = (Object.keys(tabSteps) as TabName[]).filter((tab) => tabSteps[tab]!.li.className !== 'done');
      const failedTabs: TabName[] = e.tab && pendingTabs.includes(e.tab) ? [e.tab] : pendingTabs;
      for (const tab of pendingTabs) setStep(tabSteps[tab]!, failedTabs.includes(tab) ? 'failed' : 'pending', failedTabs.includes(tab) ? '— not received' : '');
      if (steps.connect.li.className !== 'done') setStep(steps.connect, e.kind === 'unreachable' ? 'failed' : 'done');
      if (e.kind === 'empty' && e.tab && tabSteps[e.tab]) setStep(tabSteps[e.tab]!, 'failed', '— empty');

      // Google refused or vanished while this site's own server answered — a
      // blocked host, not a broken connection (review R-29).
      const blockedNotUnreachable = (e.kind === 'unreachable' || e.kind === 'timeout') && today.source === 'server';
      const reload = el('button', { class: 'btn primary', type: 'button', onclick: () => location.reload() }, 'Reload the page');
      // The saved copy is fetched from this site on the press (W1, 2026-10-22
      // — it is no longer compiled into the page). While it comes the button
      // is held; if it cannot come, one line says so and the button is live
      // again, so a second press asks again.
      let savedProblem: HTMLElement | undefined;
      const useSaved = el(
        'button',
        {
          class: 'btn use-saved',
          type: 'button',
          onclick: () => {
            useSaved.disabled = true;
            savedProblem?.remove();
            rulesFromSnapshot().then(finish, () => {
              useSaved.disabled = false;
              savedProblem = el('p', { class: 'load-note', role: 'alert' }, el('strong', {}, 'Could not load the saved copy — reload the page.'));
              actions.after(savedProblem);
            });
          },
        },
        'Continue with the copy saved in the app',
      );
      // The day the copy was made comes from a tiny file fetched beside the
      // rules; it is normally here long before the live load gives up, and
      // the label names it as soon as it is.
      void snapshotSavedOn().then((day) => {
        if (day) useSaved.textContent = `Continue with the copy saved on ${day}`;
      });
      const savedNote = ' — it may be missing recent DGS edits.';
      const actions =
        e.retryable && !blockedNotUnreachable
          ? el('div', { class: 'load-actions' }, reload, el('span', { class: 'or' }, 'or'), useSaved, el('span', { class: 'load-note' }, savedNote))
          : el('div', { class: 'load-actions' }, useSaved, el('span', { class: 'load-note' }, savedNote), el('span', { class: 'or' }, 'or'), reload);
      card.append(
        el(
          'div',
          { class: 'load-fail' },
          el(
            'p',
            {},
            // The page has just proved the network works: the clock step asked
            // this site's own server what time it is and got an answer. Telling
            // that reader to check their connection sends them after the wrong
            // thing, and "email the DGS if it keeps happening" is, for someone
            // behind a network that blocks Google, every visit and nothing the
            // DGS can fix (review R-29, 2026-09-18).
            el('strong', {}, (blockedNotUnreachable ? 'Google did not answer, although the rest of this site loaded. ' : e.message + ' ') as string),
            blockedNotUnreachable
              ? 'Some networks — and some countries — block Google Sheets, which is where the course rules live. If that is where you are, the saved copy below is the way to read this page.'
              : e.retryable
                ? e.kind === 'timeout'
                  ? `This is usually temporary — please reload the page to try again.`
                  : 'Please reload the page to try again.'
                : 'Please let the DGS know.',
          ),
          actions,
          el(
            'p',
            { class: 'load-note' },
            blockedNotUnreachable ? 'If you are not on such a network, please email the DGS (' : e.retryable ? 'If this keeps happening, please email the DGS (' : 'Please email the DGS (',
            mailto(DGS.email),
            ').',
          ),
        ),
      );
    };

    loadLiveRules(nowIso, onProgress).then(
      (rules) => {
        stop();
        setStep(steps.check, 'done');
        finish(rules);
      },
      (err) => fail(err),
    );
  });
}
