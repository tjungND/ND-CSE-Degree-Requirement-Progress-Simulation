// E2E: accessibility and phone-layout guard rails (usability review
// 2026-09-05, Phase 0 — item 22). Each check pins a defect that was measured
// and fixed that day, so it cannot come back quietly:
//   1. the opening notice is a real modal — focus starts inside it, Tab never
//      reaches the page behind it, Escape or Agree closes it and focus lands
//      on the page heading;
//   2. changing a control (the page re-renders) keeps keyboard focus on the
//      same control, and pressing Tab continues from there;
//   3. at a phone width nothing scrolls sideways (WCAG 1.4.10 reflow);
//   4. axe-core finds no WCAG 2.x A/AA violation on either page (colour
//      contrast, labels, names, landmarks…).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { loadExampleRecord } from './example-record.mjs';

const require = createRequire(import.meta.url);
const AXE_SOURCE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

const key = (s, k, code, vk) =>
  s.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk }).then(() =>
    s.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk }),
  );

export async function driveA11y(s, baseUrl) {
  await checkDialog(s, baseUrl);
  await s.open(baseUrl); // agrees, so the page beneath is usable
  // Start from an empty record, then put the mid-degree Ph.D. record on the
  // page as a saved file (the old "Load example" student — the button went on
  // 2026-10-17; scripts/e2e/example-record.mjs).
  await s.evalJs(`localStorage.clear()`);
  await s.open(baseUrl);
  await checkFirstScreen(s, baseUrl);
  await loadExampleRecord(s, 'phd');
  await checkFocusPreserved(s);
  await checkNextStepAfterAnswers(s);
  await checkAxe(s, 'self-check page (example student)');
  await checkNightMode(s, 'app', 'self-check page (example student)');
  await checkCopyDialog(s);
  await checkMobilePieces(s, 'app');
  await checkPhone(s, 'app', `document.querySelectorAll('table.courses tr').length > 3`, 390);
  await checkPhone(s, 'app', `document.querySelectorAll('table.courses tr').length > 3`, 820);
  await checkNarrowestPhone(s, baseUrl);
  await checkDeskFloats(s);
  await s.open(new URL('courses.html', baseUrl).href, '.all-courses table.course-rules');
  await checkAxe(s, 'course-rules page');
  await checkNightMode(s, 'courses', 'course-rules page');
  await checkMobilePieces(s, 'courses');
  await checkPhone(s, 'courses', `document.querySelectorAll('.all-courses table.course-rules tbody tr').length > 10`, 390);
  await checkPhone(s, 'courses', `document.querySelectorAll('.all-courses table.course-rules tbody tr').length > 10`, 820);
  await checkWide(s, 'courses', `document.querySelectorAll('.all-courses table.course-rules tbody tr').length > 10`);
  // Embed mode (?embed=1, DGS 2026-09-16) at the three widths a WordPress
  // content column actually takes: a phone, a laptop, and the widest the
  // sites.nd.edu theme gives us (measured 1082 px on a 1568 px viewport).
  // 700 px is the one that matters — it sits in the 601-860 px band where the
  // overview cards used to overflow.
  const coursesReady = `document.querySelectorAll('.all-courses table.course-rules tbody tr').length > 10`;
  await s.open(new URL('courses.html?embed=1', baseUrl).href, '.all-courses table.course-rules');
  await checkAxe(s, 'course-rules page, embed mode');
  for (const width of [360, 700, 1100]) await checkPhone(s, `courses-embed-${width}`, coursesReady, width);
  await s.open(new URL('?embed=1', baseUrl).href, '.masthead h1');
  await checkAxe(s, 'self-check page, embed mode');
  await s.open(baseUrl, '.masthead h1');
  await checkWide(s, 'app', `document.querySelector('.layout')`);
  await s.setViewport({ width: 1400, height: 1900 });
}

// 3b. The phone/tablet layout pieces (2026-09-05, review items 2, 13, 30):
// hidden on wide screens, present on narrow ones — the summary-first block
// and sticky score bar on the self-check page, stacked course rows; on the
// course-rules page the table becomes cards with a Sort control.
async function checkMobilePieces(s, page) {
  const visible = (sel) => s.evalJs(`(() => { const e = document.querySelector('${sel}'); return !!e && getComputedStyle(e).display !== 'none' && e.getClientRects().length > 0; })()`);
  const at = (width, mobile) => s.setViewport({ width, height: 900, mobile });
  if (page === 'app') {
    await at(1400, false);
    if ((await visible('.summary-mobile')) || (await visible('.sticky-score'))) throw new Error('summary block / sticky bar must be hidden on wide screens');
    await at(390, true);
    if (!(await visible('.summary-mobile')) || !(await visible('.audit .back-link'))) throw new Error('summary block and back link must show on phones');
    // The sticky bar duplicates the score headline, so it is display:none
    // (`.score-on-screen`, one IntersectionObserver in app.ts) while either
    // score headline is in the viewport and back as soon as the score scrolls
    // off (trim review 2026-09-18, P-66): assert both states, not just "shown".
    const settle = () => s.settle();
    await s.evalJs(`document.querySelector('.summary-mobile .headline').scrollIntoView({ block: 'center' })`);
    await settle();
    if (await visible('.sticky-score')) throw new Error('the sticky score bar must hide while the summary headline is on screen (P-66)');
    await s.evalJs(`document.getElementById('inputs').scrollIntoView()`);
    await settle();
    if (!(await visible('.sticky-score'))) throw new Error('the sticky score bar must show once the score headline has scrolled off (P-66)');
    await s.evalJs('window.scrollTo(0, 0)');
    await settle();
    const stacked = await s.evalJs(`getComputedStyle(document.querySelector('table.courses.stack tr:nth-child(2)')).display`);
    if (stacked !== 'flex') throw new Error('course rows must stack on phones (got display: ' + stacked + ')');
    console.log('  phone pieces on the self-check page: summary first, sticky score bar, back link, stacked course rows');
  } else {
    await at(1400, false);
    if (await visible('[data-key="filter.sort"]')) throw new Error('the Sort control must be hidden on wide screens (headers sort there)');
    await at(390, true);
    // On a phone the sort control lives behind "More filters" (mobile review
    // 2026-09-19): closed by default, open when a filter in it is set.
    // `visible()` is not enough here: WebKit lays out a closed <details>'
    // content (content-visibility: hidden — boxes with sizes, nothing drawn),
    // so the sort control has client rects while unseen. checkVisibility()
    // answers the real question in both engines.
    const shown = (sel) => s.evalJs(`document.querySelector('${sel}')?.checkVisibility() === true`);
    if (await shown('[data-key="filter.sort"]')) throw new Error('the "More filters" fold must start closed on a phone with nothing set');
    if (!(await visible('.filters details.more-filters > summary'))) throw new Error('the "More filters" summary must show on phones');
    await s.evalJs(`document.querySelector('.filters details.more-filters').open = true`);
    if (!(await shown('[data-key="filter.sort"]'))) throw new Error('the Sort control must show on phones once More filters is open');
    const card = await s.evalJs(`getComputedStyle(document.querySelector('.all-courses table.course-rules tbody tr')).display`);
    if (card !== 'block') throw new Error('course rows must render as cards on phones (got display: ' + card + ')');
    await s.evalJs(`(() => { const sel = document.querySelector('[data-key="filter.sort"]'); sel.value = 'title'; sel.dispatchEvent(new Event('change')); })()`);
    const first = await s.evalJs(`document.querySelector('.all-courses table.course-rules tbody tr th.course-id')?.textContent`);
    const firstTitle = await s.evalJs(`document.querySelector('.all-courses table.course-rules tbody tr td.cell-title')?.textContent`);
    await s.evalJs(`(() => { const sel = document.querySelector('[data-key="filter.sort"]'); sel.value = 'course'; sel.dispatchEvent(new Event('change')); })()`);
    console.log(`  phone pieces on the course-rules page: cards, Sort control (by title → first card ${first} "${firstTitle}")`);
  }
  await at(1400, false);
}

// 2b. The check-before-you-send dialog behind the copy buttons (2026-09-06
// evening): axe-clean, names the advisor, Escape closes it, focus returns.
async function checkCopyDialog(s) {
  await s.evalJs(`document.querySelector('[data-key="save.copy"]').click()`);
  await s.waitFor(`document.querySelector('dialog.copy-check[open]')`);
  const to = await s.evalJs(`document.querySelector('dialog.copy-check .copy-to')?.textContent ?? ''`);
  if (!to.includes('Your advisor, Prof. Example')) throw new Error('copy dialog: the advisor by name — ' + to);
  // The advisor has no address on file: the email-app link opens with To empty (DGS 2026-09-15).
  const advMail = await s.evalJs(`document.querySelector('dialog.copy-check [data-key="copy.email"]')?.getAttribute('href') ?? ''`);
  if (!/^mailto:\?subject=/.test(advMail)) throw new Error('the advisor dialog must open the email app with To left empty: ' + advMail.slice(0, 60));
  await s.evalJs(AXE_SOURCE + '; true');
  const result = JSON.parse(
    await s.evalJs(`axe.run(document.querySelector('dialog.copy-check'), { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] } }).then(r => JSON.stringify(r.violations.map(v => ({ id: v.id, impact: v.impact, count: v.nodes.length, first: v.nodes[0]?.target.join(' ') }))))`),
  );
  if (result.length > 0) throw new Error(`axe-core found ${result.length} violation type(s) in the copy dialog: ` + result.map((v) => `${v.id} [${v.impact}] ×${v.count} (first: ${v.first})`).join('; '));
  await key(s, 'Escape', 'Escape', 27);
  await s.waitFor(`!document.querySelector('dialog.copy-check')`);
  const focused = await s.evalJs(`document.activeElement?.dataset?.key ?? ''`);
  if (focused !== 'save.copy') throw new Error('copy dialog: focus must return to the copy button after Escape — ' + focused);
  console.log('  copy dialog: axe-clean, names the advisor, Escape closes it, focus returns to the button');
}

// 1. The opening notice as a modal dialog.
// The next step after a finished one (next-step.ts; DGS 2026-10-16 and
// 2026-10-17): exactly one ring, its "Next step" tag (drawn by CSS), focus on
// the step's control, on screen once the smooth scroll lands, and the
// message in its own slot. Returns what it found, for the caller's checks.
export async function nextStepShown(s) {
  await s.waitFor(`document.querySelectorAll('.next-step-ring').length === 1 && (() => { const r = document.activeElement?.getBoundingClientRect(); return !!r && r.bottom > 0 && r.top < window.innerHeight; })()`, 5000);
  const found = JSON.parse(await s.evalJs(`JSON.stringify((() => {
    const ring = document.querySelector('.next-step-ring');
    return {
      ringed: ring ? ring.tagName.toLowerCase() + '.' + [...ring.classList].join('.') : '',
      label: ring?.querySelector('.slot-label')?.textContent ?? '',
      tag: ring ? getComputedStyle(ring, '::after').content : '',
      focused: document.activeElement?.dataset?.key ?? document.activeElement?.tagName ?? '',
      focusInRing: !!ring && ring.contains(document.activeElement),
      note: document.querySelector('.toast.next-step-note')?.textContent ?? '',
    };
  })())`));
  if (!/Next step/.test(found.tag)) throw new Error('the ring must carry its "Next step" tag: ' + JSON.stringify(found));
  if (!found.focusInRing) throw new Error('focus must be on the highlighted step: ' + JSON.stringify(found));
  return found;
}

async function checkDialog(s, baseUrl) {
  // A fresh record: the earlier steps' saved answers would make the dialog
  // ready at once (every family must be answered since 2026-09-23).
  await s.send('Page.navigate', { url: baseUrl });
  await s.waitFor(`document.querySelector('.masthead h1') || document.querySelector('.load-card.failed')`);
  await s.evalJs(`localStorage.clear()`);
  await s.send('Page.navigate', { url: baseUrl });
  await s.waitFor(`document.querySelector('.masthead h1') || document.querySelector('.load-card.failed')`);
  if (await s.evalJs(`!!document.querySelector('.load-card.failed')`)) {
    await s.evalJs(`document.querySelector('.load-card.failed button.use-saved').click()`);
    await s.waitFor(`document.querySelector('.masthead h1')`);
  }
  await s.waitFor(`document.querySelector('dialog.consent[open]')`);
  await s.settle();
  const inside = () => s.evalJs(`!!document.activeElement?.closest('dialog.consent')`);
  if (!(await inside())) throw new Error('opening dialog: focus did not move into the dialog');
  for (let i = 0; i < 4; i++) {
    await key(s, 'Tab', 'Tab', 9);
    const where = await s.evalJs(`document.activeElement === document.body ? 'body' : (document.activeElement?.closest('dialog.consent') ? 'dialog' : 'PAGE:' + document.activeElement?.textContent?.slice(0, 40))`);
    if (where.startsWith('PAGE:')) throw new Error('opening dialog: Tab reached the page behind it — ' + where);
  }
  const labelled = await s.evalJs(`document.getElementById(document.querySelector('dialog.consent')?.getAttribute('aria-labelledby') ?? '')?.textContent ?? ''`);
  if (labelled !== 'Before you continue') throw new Error('opening dialog: not labelled by its visible title (' + labelled + ')');
  // Escape never closes it (DGS 2026-09-23) — twice in a row, because Chrome
  // lets a second Escape through a refused `cancel` — and the button waits
  // for every family.
  const stillOpen = () => s.evalJs(`!!document.querySelector('dialog.consent[open]')`);
  await key(s, 'Escape', 'Escape', 27);
  await key(s, 'Escape', 'Escape', 27);
  await s.settle();
  if (!(await stillOpen())) throw new Error('opening dialog: Escape must not close it');
  if (!(await s.evalJs(`document.querySelector('dialog.consent .btn.primary')?.hasAttribute('disabled')`))) throw new Error('opening dialog: the button must wait for the answers');
  // Only the program is asked here since 2026-10-08 (DGS, Option 1): no
  // earlier-degrees question in the dialog — they are on the page.
  if (await s.evalJs(`!!document.querySelector('dialog.consent [data-key^="consent.bachelors."], dialog.consent [data-key^="consent.graduate."]')`)) throw new Error('opening dialog: the earlier-degrees questions belong on the page now');
  await s.evalJs(`document.querySelector('[data-key="consent.program.phd"]').click()`);
  await s.settle();
  await s.shot('consent-answered');
  // Enter does nothing while the button waits (2026-10-04): the notice is not ticked yet.
  await s.evalJs(`document.querySelector('[data-key="consent.program.phd"]').focus()`);
  await key(s, 'Enter', 'Enter', 13);
  await s.settle();
  if (!(await stillOpen())) throw new Error('opening dialog: Enter must not continue while the button is inactive');
  // The program chosen, the notice not yet acknowledged (2026-09-29): the
  // button waits for the tick INSIDE the notice, and the hint says so.
  if (!(await s.evalJs(`document.querySelector('dialog.consent .btn.primary')?.hasAttribute('disabled')`))) throw new Error('opening dialog: the button must wait for the acknowledgement tick');
  const hintText = await s.evalJs(`document.querySelector('.consent-hint')?.textContent ?? ''`);
  if (hintText !== 'To continue, acknowledge the notice at the top by checking its box.') throw new Error('opening dialog: the hint must say the notice at the top needs acknowledging: ' + hintText);
  if (!(await s.evalJs(`!!document.querySelector('.consent-warning [data-key="consent.ack"]')`))) throw new Error('opening dialog: the acknowledgement must sit inside the notice');
  await s.evalJs(`document.querySelector('[data-key="consent.ack"]').click()`);
  await s.settle();
  if (await s.evalJs(`document.querySelector('dialog.consent .btn.primary')?.hasAttribute('disabled')`)) throw new Error('opening dialog: the button must be live once the program is chosen and the notice ticked');
  if (!(await s.evalJs(`document.querySelector('.consent-hint')?.hidden === true`))) throw new Error('opening dialog: the hint must go once the button is live');
  if ((await s.evalJs(`document.querySelector('dialog.consent .btn.primary')?.textContent`)) !== 'Continue') throw new Error('opening dialog: the button reads "Continue" since 2026-09-29');
  // One question, the program, and no number on it (Option 1, 2026-10-08).
  const steps = JSON.parse(await s.evalJs(`JSON.stringify([...document.querySelectorAll('dialog.consent legend.step-title')].filter((l) => l.closest('fieldset') && !l.closest('fieldset').hidden).map((l) => getComputedStyle(l, '::before').content))`));
  if (steps.length !== 1 || !steps.every((c) => c === 'none' || c === 'normal')) throw new Error('opening dialog: one question, unnumbered, expected — ' + JSON.stringify(steps));
  await key(s, 'Escape', 'Escape', 27);
  await key(s, 'Escape', 'Escape', 27);
  await s.settle();
  if (!(await stillOpen())) throw new Error('opening dialog: Escape must not close it even once everything is answered');
  // Enter on the tick box just ticked continues, as the button would (DGS
  // 2026-10-04: "let an Enter key pressed by the user click the Continue button").
  await s.evalJs(`document.querySelector('[data-key="consent.ack"]').focus()`);
  await key(s, 'Enter', 'Enter', 13);
  await s.waitFor(`!document.querySelector('dialog.consent')`);
  // A new record starts at its Notre Dame transcript (DGS 2026-10-17: after
  // the notice, "New record only"): the "Start here" row is ringed, its
  // Import focused and on screen, and the step said (W-CL525). A returning
  // record keeps focus on the heading (checked at the end of this driver).
  const started = await nextStepShown(s);
  console.log('  after the notice, a new record:', JSON.stringify(started));
  if (started.focused !== 'import.nd' || !started.ringed.includes('transcript-upload') || started.note !== `Next step: import your ${started.label} (highlighted).`) throw new Error('after the notice a new record must highlight the Notre Dame import: ' + JSON.stringify(started));
  await s.shot('next-step-start-here');
  // The earlier-degrees questions on the page (2026-10-08, Option 1): in the
  // Transcripts card, each follow-up just below the answer that asks it.
  // A fresh record shows one line with "Answer here" (UI review item 2; DGS
  // 2026-10-09): the questions come after the click.
  if (!(await s.evalJs(`!!document.querySelector('#earlier-degrees [data-key="earlier.answer"]')`))) throw new Error('a fresh record must fold the earlier-degrees questions behind "Answer here"');
  // Every previous-transcript Import waits for the answer, saved with Done
  // (DGS 2026-10-14) — inactive, saying why when clicked.
  const importStates = () => s.evalJs(`JSON.stringify([...document.querySelectorAll('[data-key^="ext.import."]')].map((b) => b.getAttribute('aria-disabled')))`).then(JSON.parse);
  const before = await importStates();
  if (before.length === 0 || !before.every((d) => d === 'true')) throw new Error('before the earlier degrees are answered, every Import must be inactive: ' + JSON.stringify(before));
  await s.evalJs(`document.querySelector('[data-key="ext.import.bachelors"]').click()`);
  await s.settle();
  const why = await s.evalJs(`[...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' | ')`);
  if (!why.includes('answer the questions under “Your earlier degrees” and click Done')) throw new Error('the inactive Import must say why: ' + why.slice(0, 200));
  await s.evalJs(`document.querySelector('[data-key="earlier.answer"]').click()`);
  await s.waitFor(`!!document.querySelector('#earlier-degrees [data-key="earlier.bachelors.elsewhere"]')`);
  if (!(await s.evalJs(`!!document.querySelector('#earlier-degrees [data-key="earlier.bachelors.elsewhere"]')`))) throw new Error('the earlier-degrees questions must be in the Transcripts card');
  await s.evalJs(`document.querySelector('[data-key="earlier.graduate.elsewhere"]').click()`);
  await s.settle();
  const under = await s.evalJs(`(() => { const row = document.querySelector('[data-key="earlier.graduate.elsewhere"]').closest('label'); const next = row?.nextElementSibling; return !!next && next.matches('fieldset') && !next.hidden && !!next.querySelector('[data-key="earlier.sameplace.no"]'); })()`);
  if (!under) throw new Error('"same university?" must sit just below "Yes, at another university"');
  // Each answer is clicked with focus on it, as a keyboard user would, and
  // keeps its focus, a follow-up included ("same university?" rebuilds its
  // own box — UI review, 2026-10-08). The answer that completes the questions
  // leaves them in place, saved, until Done (review of Option 1, 2026-10-08)
  // — and is a finished step: Done is the next one, ringed, focused and said
  // (W-CL527; DGS 2026-10-17, field answers "Scroll and focus too").
  for (const k of ['earlier.bachelors.elsewhere', 'earlier.sameplace.no']) {
    await s.evalJs(`(() => { const i = document.querySelector('[data-key="${k}"]'); i.focus(); i.click(); })()`);
    await s.settle();
    const at = await s.evalJs(`document.activeElement?.dataset?.key ?? document.activeElement?.tagName`);
    if (at !== k) throw new Error(`answering ${k} must keep its focus, not move it to ${at}`);
  }
  await s.evalJs(`(() => { const i = document.querySelector('[data-key="earlier.finished.yes"]'); i.focus(); i.click(); })()`);
  const toDone = await nextStepShown(s);
  console.log('  the completing answer, the next step:', JSON.stringify(toDone));
  if (!(await s.evalJs(`!!document.querySelector('#earlier-degrees') && !!document.querySelector('[data-key="earlier.done"]')`))) throw new Error('complete: the questions stay, with Done');
  if (toDone.focused !== 'earlier.done' || !toDone.ringed.includes('earlier-done') || toDone.note !== 'Next step: click Done to save your answers about your earlier degrees (highlighted).') throw new Error('the completing answer must make Done the next step: ' + JSON.stringify(toDone));
  await s.evalJs(`document.querySelector('#earlier-degrees').scrollIntoView({ block: 'start' })`);
  await s.shot('earlier-degrees-done');
  await s.evalJs(`(() => { const d = document.querySelector('[data-key="earlier.done"]'); d.focus(); d.click(); })()`);
  await s.settle();
  if (!(await s.evalJs(`!!document.querySelector('[data-key="transcripts.background"].background-line') && !document.querySelector('#earlier-degrees')`))) throw new Error('Done: the questions must give way to the one-line summary');
  const after = await importStates();
  if (after.length === 0 || after.some((d) => d === 'true')) throw new Error('after Done, the Imports must be active: ' + JSON.stringify(after));
  // The next step is shown (DGS 2026-10-16: "Highlight the next step on the
  // page"; every step since 2026-10-17): the first earlier-transcript row the
  // answer opened, still empty — ringed and tagged, its Import focused and on
  // screen, said in its own message (W-CL525).
  const next = await nextStepShown(s);
  console.log('  after Done, the next step:', JSON.stringify(next));
  if (!next.focused.startsWith('ext.import.') || !next.ringed.includes('external-slot') || next.note !== `Next step: import your ${next.label} (highlighted).`) throw new Error('after Done the next step must be ringed, tagged, focused and said: ' + JSON.stringify(next));
  await s.shot('earlier-degrees-next-step');
  console.log('  opening notice: focus inside, Tab contained, Escape never closes it, Enter does nothing until the button is live and then continues like it; on a new record the Notre Dame import is the next step; the earlier-degrees questions are on the page, the completing answer makes Done the next step, Done gives way to a summary and makes the first empty row the next step; the previous-transcript Imports wait for Done');
}

// 1b. The first screen belongs to the work, not the preamble (blue-team B1,
// 2026-09-18). At 708×937 the "1. Transcripts — START HERE" heading sat at
// y=944 and the first Import button at y=1104, and the first nineteen
// interactive elements included no data-entry control at all.
async function checkFirstScreen(s, baseUrl) {
  await s.setViewport({ width: 708, height: 937 });
  // A FIRST visit is what B1 measured: no record, so nothing to summarise.
  await s.open(baseUrl, '.transcript-upload');
  // B1 measured the page as it opens, at the top: the harness's answers
  // (the notice, the earlier degrees) each highlight a next step, which
  // scrolls (DGS 2026-10-17) — back to the top for the measurement.
  await s.evalJs('window.scrollTo(0, 0)');
  await s.settle();
  const first = JSON.parse(await s.evalJs(`JSON.stringify((() => {
    const start = [...document.querySelectorAll('h2')].find((h) => /START HERE/.test(h.textContent ?? ''));
    const importBtn = document.querySelector('[data-key="import.nd"]');
    const focusable = [...document.querySelectorAll('a[href], button, input, select, textarea')]
      .filter((n) => n.offsetParent !== null && !n.closest('.skip-link') && n.tabIndex >= 0); // a radio group's unchosen buttons are not tab stops
    const firstEntry = focusable.findIndex((n) => /^(import\.|course\.new\.|standing\.|courses\.|program\.)/.test(n.dataset?.key ?? ''));
    return {
      startHereTop: Math.round(start?.getBoundingClientRect().top ?? -1),
      importTop: Math.round(importBtn?.getBoundingClientRect().top ?? -1),
      firstEntryIndex: firstEntry,
      contactAtEnd: !!document.querySelector('footer .contact-card'),
      contactInMasthead: !!document.querySelector('.masthead .contact-card'),
      noticeLines: document.querySelectorAll('.notice-strip .notice-line').length,
    };
  })())`));
  console.log('  first screen at 708×937:', JSON.stringify(first));
  if (first.importTop < 0 || first.importTop > 937) throw new Error('the first import control must be on the first screen: ' + first.importTop);
  // Seven focusables preceded the first import control once the program tabs
  // left the masthead (DGS 2026-09-22): three masthead links, Load example
  // (gone since 2026-10-17, so one fewer now), Reset, and the two notice
  // strips' Details. The tools row has since gained
  // Send summary (DGS 2026-09-22) and Save / Load / Print (DGS 2026-09-24),
  // at the DGS's request; the skip link still jumps straight to the inputs.
  // The Auto · Light · Dark switch (night mode, DGS 2026-10-04) is one more —
  // one tab stop, an ARIA radio group, so 12. "Simulate a future semester"
  // in the tools row (simulation mode, DGS 2026-10-09) makes it 13.
  if (first.firstEntryIndex < 0 || first.firstEntryIndex > 13) {
    throw new Error('a data-entry control must come early in the tab order, not 20th: ' + first.firstEntryIndex);
  }
  if (first.contactInMasthead || !first.contactAtEnd) throw new Error('the who-to-contact card belongs at the end: ' + JSON.stringify(first));
  // Two strips since 2026-09-19 (DGS: red for alpha, green for privacy), one line each.
  if (first.noticeLines !== 2) throw new Error('the notices collapse to one line each above the fold: ' + first.noticeLines);
  await s.shot('first-screen-708');
  await s.setViewport({ width: 1400, height: 1900 });
}

// 2. Focus survives the re-render that every change triggers.
async function checkFocusPreserved(s) {
  // The standing card's radio groups left with the earlier-degrees questions
  // (DGS 2026-09-22); the §3.4 option radios exist only for the MSCSE, so the
  // radio half of this check uses the report's attestation checkboxes below
  // and the milestones' date fields: focus then type, re-render, focus stays.
  await s.evalJs(`(() => { const d = document.querySelector('[data-key="milestone.advisorName"]'); d.focus(); d.value = 'Prof. Focus'; d.dispatchEvent(new Event('change')); })()`);
  await s.settle();
  const nameKey = await s.evalJs(`document.activeElement?.dataset?.key ?? ''`);
  if (nameKey !== 'milestone.advisorName') throw new Error('focus check: focus left the text field after the change — now on ' + nameKey);
  await key(s, 'Tab', 'Tab', 9);
  const next = await s.evalJs(`document.activeElement?.dataset?.key ?? document.activeElement?.tagName`);
  if (next === 'milestone.advisorName' || next === 'BODY') throw new Error('focus check: Tab after the change did not move on — ' + next);
  // Put the example's advisor back: the copy-dialog check later names them.
  await s.evalJs(`(() => { const d = document.querySelector('[data-key="milestone.advisorName"]'); d.value = 'Prof. Example'; d.dispatchEvent(new Event('change')); })()`);
  await s.settle();
  // A checkbox: focus then click (the page re-renders), focus must stay put.
  // (The click itself is synchronous through evalJs, so there is nothing to
  // wait FOR here — unlike the radio above, whose key event arrives
  // asynchronously. The wait stays.)
  await s.evalJs(`const cb = document.querySelector('[data-key^="attest."]'); cb.focus(); cb.click();`);
  await s.settle();
  const cbKey = await s.evalJs(`document.activeElement?.dataset?.key ?? ''`);
  if (!cbKey.startsWith('attest.')) throw new Error('focus check: focus left the checkbox after the change — now on ' + cbKey);
  console.log('  focus is preserved across re-renders (text field, checkbox); Tab continues from the same control');
}

// 2c. An answer in a field that finishes a step highlights the next one, as
// a button does (DGS 2026-10-17: "after student completes each step, highlight
// the next things to do"; field answers "Scroll and focus too"): the advisor
// named → the approval tick is next — ringed, focused, said; the tick given,
// with nothing after it on the page, → the first step still open, the empty
// Previous Undergraduate row this record's earlier degrees opened. The record
// ends as it began.
async function checkNextStepAfterAnswers(s) {
  const TICK = '[data-key^="attest.my-advisor-approved-my-coursework"]';
  const wasTicked = await s.evalJs(`document.querySelector('${TICK}').checked`);
  if (wasTicked) await s.evalJs(`document.querySelector('${TICK}').click()`);
  await s.settle();
  // No advisor on record: neither the date nor the name (either identifies one).
  const DATE = '[data-key="milestone.advisorIdentified"]';
  const date = await s.evalJs(`document.querySelector('${DATE}').value`);
  for (const sel of [DATE, '[data-key="milestone.advisorName"]']) {
    await s.evalJs(`(() => { const d = document.querySelector('${sel}'); d.focus(); d.value = ''; d.dispatchEvent(new Event('change')); })()`);
    await s.settle();
  }
  if (!(await s.evalJs(`!!document.querySelector('[data-key="report.nextsteps"] li[data-step="advisor.name"]')`))) throw new Error('with no advisor on record, the step to name one must be listed: ' + (await s.evalJs(`JSON.stringify([...document.querySelectorAll('[data-step]')].map((l) => l.dataset.step))`)));
  await s.evalJs(`(() => { const d = document.querySelector('[data-key="milestone.advisorName"]'); d.focus(); d.value = 'Prof. Example'; d.dispatchEvent(new Event('change')); })()`);
  const named = await nextStepShown(s);
  console.log('  the advisor named, the next step:', JSON.stringify(named));
  if (!named.focused.startsWith('attest.my-advisor-approved-my-coursework') || named.note !== 'Next step: Confirm your advisor approved your coursework and tick the box under Approvals.') throw new Error('naming the advisor must make the approval tick the next step: ' + JSON.stringify(named));
  await s.shot('next-step-after-an-answer');
  await s.evalJs(`(() => { const t = document.querySelector('${TICK}'); t.focus(); t.click(); })()`);
  const wrapped = await nextStepShown(s);
  console.log('  the tick given, the next step:', JSON.stringify(wrapped));
  if (wrapped.focused !== 'ext.import.bachelors' || wrapped.note !== 'Next step: import your Previous Undergraduate Transcript (highlighted).') throw new Error('with nothing after the tick, the first step still open is next: ' + JSON.stringify(wrapped));
  if (!wasTicked) await s.evalJs(`document.querySelector('${TICK}').click()`);
  await s.settle();
  await s.evalJs(`(() => { const d = document.querySelector('${DATE}'); d.value = '${date}'; d.dispatchEvent(new Event('change')); })()`);
  await s.settle();
  console.log('  a field answer that finishes a step: the next one is ringed, focused and said; with nothing after it, the first still open');
}

// 3. No sideways scrolling at a phone (390) or tablet-portrait (820) width.
// 3b. The page FILLS a wide window (DGS 2026-09-09): it used to stop at
// 1240 px and centre, leaving a monitor half empty. Both columns grow with it.
async function checkWide(s, page, readyExpr, width = 2200) {
  await s.setViewport({ width, height: 1200 });
  await s.waitFor(readyExpr);
  await s.settle(250);
  const m = JSON.parse(await s.evalJs(`JSON.stringify((() => {
    const app = document.getElementById('app');
    const lay = document.querySelector('.layout');
    return {
      app: Math.round(app.getBoundingClientRect().width),
      cols: lay ? getComputedStyle(lay).gridTemplateColumns.split(' ').map((c) => Math.round(parseFloat(c))) : [],
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  })())`));
  // Padding is 20 px a side, so a fluid page is within 40 px of the window.
  if (m.app < width - 44) throw new Error(`${page} at ${width} px does not fill the window: #app is ${m.app} px`);
  if (m.overflow > 0) throw new Error(`${page} at ${width} px scrolls sideways`);
  if (page === 'app' && !(m.cols.length === 2 && m.cols[1] > 480)) {
    throw new Error('the inputs column must grow with the window, not stay at its minimum: ' + JSON.stringify(m.cols));
  }
  console.log(`  ${page} fills a ${width} px window (#app ${m.app} px${m.cols.length === 2 ? `, columns ${m.cols.join(' + ')}` : ''})`);
}

async function checkPhone(s, page, readyExpr, width = 390) {
  const height = width < 600 ? 844 : 1180;
  await s.setViewport({ width, height, mobile: true });
  await s.waitFor(readyExpr);
  await s.settle(250);
  const m = JSON.parse(
    await s.evalJs(`JSON.stringify({ scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth, wide: [...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().right > ${width + 1} && getComputedStyle(e).position !== 'fixed').slice(0, 5).map(e => e.tagName + '.' + String(e.className).slice(0, 30)) })`),
  );
  await s.shot(`${width < 600 ? 'phone' : 'tablet'}-${page}`);
  if (m.scrollW > m.clientW) throw new Error(`${page} at ${width} px scrolls sideways (${m.scrollW} > ${m.clientW}); widest: ${m.wide.join(', ')}`);
  // The schedule tables keep a course on one line at desk widths. On a phone
  // the same table is a stack of cards, and a title that cannot wrap runs past
  // the card and drags the page sideways (DGS 2026-09-09, iPhone 14 Pro).
  // Only below the 860 px card breakpoint: above it the table is a real table
  // inside a horizontal scroller, where running past the card is what the
  // scroller is FOR (2026-09-16).
  if (page.startsWith('courses') && width <= 860) {
    // tbody only: the header row is visually hidden with the clip() pattern, so
    // it keeps a wide geometry that nobody can see.
    const spill = await s.evalJs(`JSON.stringify([...document.querySelectorAll('.schedule-table tbody td, .schedule-table tbody th')]
      .filter((c) => { const card = c.closest('.ov-card'); return card && c.getBoundingClientRect().right > card.getBoundingClientRect().right + 1; })
      .slice(0, 3).map((c) => (c.textContent || '').trim().slice(0, 40)))`);
    const out = JSON.parse(spill);
    if (out.length > 0) throw new Error(`a schedule cell runs past its card at ${width} px: ${out.join(' | ')}`);
  } else if (page.startsWith('courses')) {
    // Above the card breakpoint the schedule tables fit their card with every
    // column in view — no sideways scroll, as in All courses (DGS 2026-09-29).
    // The 980 px floor and the one-line titles used to overflow a 1,030 px card.
    const scrollers = JSON.parse(await s.evalJs(`JSON.stringify([...document.querySelectorAll('.schedule-overview .table-scroll')].map((d) => ({ client: d.clientWidth, scroll: d.scrollWidth })))`));
    const wide = scrollers.filter((d) => d.scroll > d.client);
    if (wide.length > 0) throw new Error(`a schedule table scrolls sideways at ${width} px: ${JSON.stringify(wide)}`);
    if (scrollers.length > 0) console.log(`  schedule tables fit their cards at ${width} px (${scrollers.map((d) => d.scroll + '/' + d.client).join(', ')})`);
  }
  if (width < 600 && page === 'app') {
    // Usability pass 2026-09-08: one field per line in the add-a-course form,
    // a real touch target on every control that changes the record, and the
    // status pill in ONE column down the report instead of five.
    const phone = JSON.parse(await s.evalJs(`JSON.stringify((() => {
      const round = (n) => Math.round(n);
      const small = [...document.querySelectorAll('[data-key^="import."], [data-key^="ext.import."], .radios .radio, .attest')]
        .map((e) => ({ k: e.dataset.key ?? e.className, h: round(e.getBoundingClientRect().height) }))
        .filter((x) => x.h > 0 && x.h < 40);
      const row1 = document.querySelector('.course-form .row1');
      return {
        row1Tracks: row1 ? getComputedStyle(row1).gridTemplateColumns.split(' ').length : 0,
        cardPad: getComputedStyle(document.querySelector('.card')).paddingLeft,
        small,
        pillRights: [...new Set([...document.querySelectorAll('.req-head .pill')].map((p) => round(p.getBoundingClientRect().right)))],
      };
    })())`));
    console.log('  phone ergonomics:', JSON.stringify({ ...phone, pillRights: phone.pillRights.length }));
    if (phone.row1Tracks !== 1) throw new Error(`the add-a-course form must be one field per line on a phone (${phone.row1Tracks} tracks)`);
    if (phone.cardPad !== '12px') throw new Error('the phone card padding rule is dead again: ' + phone.cardPad);
    if (phone.small.length > 0) throw new Error('touch targets under 40 px: ' + JSON.stringify(phone.small));
    if (phone.pillRights.length > 1) throw new Error('the status pill must park in one column: ' + JSON.stringify(phone.pillRights));
    // The folds' one-line summaries are 40 px tall on a phone, like every
    // other control (blue-team review 2026-10-17, U13), and the Milestones
    // card — where most of them are — is seen at phone width each run.
    const folds = JSON.parse(await s.evalJs(`JSON.stringify((() => { const all = [...document.querySelectorAll('details.rare > summary, details.policy-fold > summary, .req .req-more > summary')].filter((e) => e.getClientRects().length > 0); return { n: all.length, short: all.map((e) => [e.textContent.trim().slice(0, 40), Math.round(e.getBoundingClientRect().height)]).filter(([, h]) => h < 40), marker: all.length > 0 ? getComputedStyle(all[0]).display : '' }; })())`));
    if (folds.n < 3) throw new Error('expected the rare, policy and more folds on the phone page: ' + JSON.stringify(folds));
    if (folds.short.length > 0) throw new Error('fold summaries under 40 px on a phone: ' + JSON.stringify(folds.short));
    if (folds.marker === 'flex') throw new Error('a fold summary keeps its ▶ marker: display: flex on a <summary> drops it');
    await s.shotElement('phone-milestones', '#milestones');
    console.log(`  ${folds.n} fold summaries at 40 px or more on the phone page; Milestones card shot`);
  }
  console.log(`  ${width < 600 ? 'phone' : 'tablet'} width (${width} px), ${page} page: no horizontal scrolling`);
  await s.setViewport({ width: 1400, height: 1900 });
}

// 3c. The narrowest phone, 320 px — also a 1280 px window at 400 % zoom (WCAG
// 1.4.10) — with the example record (cross-browser review, 2026-10-10, the
// same in Chrome, Safari's engine and Firefox): the Next steps pill ran out of
// its line, scrolling the unfolded box and the embedded page sideways; and at
// the end of the page the folded Next steps bar sat over the footer's last
// links (WCAG 2.4.11). The page is loaded AT 320 px, as a phone loads it: the
// box folds when the report renders, not when a window is resized. The end of
// the page is measured folded and unfolded — the room the page leaves follows
// the box (layoutFloats re-measures on Show / Hide).
async function checkNarrowestPhone(s, baseUrl) {
  await s.setViewport({ width: 320, height: 640, mobile: true });
  await s.open(baseUrl, '.masthead h1');
  await s.waitFor(`document.querySelectorAll('table.courses tr').length > 3`);
  await s.settle(250);
  const frame = `new Promise((r) => requestAnimationFrame(() => setTimeout(r, 150)))`;
  const toggle = () => s.evalJs(`(async () => { document.querySelector('.attention.floating .attention-toggle').click(); await ${frame}; return true; })()`);
  const box = JSON.parse(await s.evalJs(`(async () => {
    const b = document.querySelector('.attention.floating');
    if (!b) return JSON.stringify({ missing: true });
    const folded = b.classList.contains('folded');
    if (folded) { b.querySelector('.attention-toggle').click(); await ${frame}; }
    const m = { folded, scroll: b.scrollWidth, client: b.clientWidth };
    if (folded) { b.querySelector('.attention-toggle').click(); await ${frame}; }
    return JSON.stringify(m);
  })()`));
  if (box.missing) throw new Error('expected the floating Next steps box with the example record');
  if (!box.folded) throw new Error('at 320 px the Next steps box must load folded');
  if (box.scroll > box.client) throw new Error(`the unfolded Next steps box scrolls sideways at 320 px (${box.scroll} > ${box.client})`);
  // A focused control stops clear of the bar and the boxes: 24 px more than
  // them at the bottom, 24 px at the top — Firefox does not scroll a control
  // whose top is already inside the padded window (2026-10-10).
  const pad = JSON.parse(await s.evalJs(`JSON.stringify((() => {
    const root = document.documentElement;
    const v = (k) => parseFloat(root.style.getPropertyValue(k)) || 0;
    const cs = getComputedStyle(root);
    return { bottom: parseFloat(cs.scrollPaddingBottom), top: parseFloat(cs.scrollPaddingTop), boxes: v('--float-warnings') + v('--float-steps') };
  })())`));
  if (Math.abs(pad.bottom - (88 + pad.boxes)) > 0.5 || pad.top !== 24) throw new Error('at 320 px a focused control can stop under the bar or the boxes: ' + JSON.stringify(pad));
  // Row 3 ("From another university"): its long "Taken as" choices ran the
  // phone page sideways until its fields could shrink (2026-10-10).
  const row3 = JSON.parse(await s.evalJs(`(async () => {
    const origin = document.querySelector('[data-key="course.new.origin"]');
    const was = origin.value;
    origin.value = 'transfer';
    origin.dispatchEvent(new Event('change', { bubbles: true }));
    await ${frame};
    const shown = [...document.querySelectorAll('.course-form .row3 select')].filter((e) => e.getClientRects().length > 0).length;
    const m = { shown, scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth };
    const o = document.querySelector('[data-key="course.new.origin"]');
    o.value = was;
    o.dispatchEvent(new Event('change', { bubbles: true }));
    await ${frame};
    return JSON.stringify(m);
  })()`));
  if (row3.shown < 1) throw new Error('expected row 3 of the add-a-course form with Where = another university');
  if (row3.scroll > row3.client) throw new Error(`with Where = another university the page scrolls sideways at 320 px (${row3.scroll} > ${row3.client})`);
  // Scrolled to the end; every footer link not in a closed fold (Chrome still
  // gives those a box) must be the topmost thing at its own position.
  const atEnd = async (state) => {
    const m = JSON.parse(await s.evalJs(`(async () => {
      window.scrollTo(0, document.documentElement.scrollHeight);
      await ${frame};
      const links = [...document.querySelectorAll('footer.legal a')].filter((a) => a.getClientRects().length > 0 && !a.closest('details:not([open])'));
      const covered = links.filter((a) => {
        const r = a.getClientRects()[a.getClientRects().length - 1];
        if (r.bottom <= 0) return false; // scrolled past, above the screen
        const top = document.elementFromPoint(r.left + Math.min(r.width / 2, 8), Math.max(0, Math.min(r.top + r.height / 2, innerHeight - 1)));
        a.dataset.e2eCoveredBy = top ? String(top.className || top.tagName).slice(0, 40) : 'nothing';
        return !(top && (top === a || a.contains(top)));
      }).map((a) => (a.textContent || '').trim().slice(0, 30) + ' under ' + a.dataset.e2eCoveredBy);
      return JSON.stringify({ links: links.length, covered, steps: getComputedStyle(document.documentElement).getPropertyValue('--float-steps').trim() });
    })()`));
    if (m.links < 1) throw new Error('expected the footer\'s links');
    if (m.covered.length > 0) throw new Error(`at the end of the page (${state}) a floating box covers footer links at 320 px: ${m.covered.join(' | ')}`);
    return m;
  };
  const folded = await atEnd('Next steps folded');
  await s.shot('phone-320-app'); // the end of the page, folded: the footer's last lines clear of the bar
  await toggle();
  const unfolded = await atEnd('Next steps unfolded');
  await toggle();
  await s.evalJs(`window.scrollTo(0, 0)`);
  await s.open(new URL('?embed=1', baseUrl).href, '.masthead h1');
  await s.waitFor(`document.querySelectorAll('table.courses tr').length > 3`);
  await s.settle(250);
  const embed = JSON.parse(await s.evalJs(`JSON.stringify({ scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth, pills: document.querySelectorAll('.attention li .pill').length })`));
  await s.shot('phone-320-embed');
  if (embed.pills < 1) throw new Error('expected the Next steps list in the embedded page');
  if (embed.scrollW > embed.clientW) throw new Error(`the embedded page scrolls sideways at 320 px (${embed.scrollW} > ${embed.clientW})`);
  console.log(`  narrowest phone (320 px): Next steps box loads folded, ${box.scroll}/${box.client} px unfolded; footer's ${folded.links} link(s) clear of the floating boxes at the end, folded (room ${folded.steps}) and unfolded (room ${unfolded.steps}); embedded page ${embed.scrollW}/${embed.clientW} px`);
  await s.setViewport({ width: 1400, height: 1900 });
  await s.open(baseUrl, '.masthead h1');
}

// 3d. The floating boxes at desk width (cross-browser review, 2026-10-10): a
// focused control never stops under them (scroll-padding-bottom = 18 px + the
// boxes, measured by layoutFloats), and from 1121 px, where the 440 px boxes
// sit over the report column alone, their room is under that column, not
// under the whole page (it had left up to 355 px of blank after the footer).
async function checkDeskFloats(s) {
  const read = () => s.evalJs(`JSON.stringify((() => {
    const root = document.documentElement;
    const v = (k) => parseFloat(root.style.getPropertyValue(k)) || 0;
    const px = (e, k) => parseFloat(getComputedStyle(e)[k]);
    return {
      boxes: v('--float-warnings') + v('--float-steps'),
      folded: document.querySelector('.attention.floating')?.classList.contains('folded') ?? null,
      scrollPad: px(root, 'scrollPaddingBottom'),
      app: px(document.getElementById('app'), 'paddingBottom'),
      report: px(document.getElementById('report'), 'paddingBottom'),
    };
  })())`).then(JSON.parse);
  const toggle = () => s.evalJs(`(async () => { document.querySelector('.attention.floating .attention-toggle').click(); await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 150))); return true; })()`);
  const seen = [];
  for (const width of [1024, 1440]) {
    await s.setViewport({ width, height: 900, settleMs: 250 });
    for (const state of ['as loaded', 'toggled']) {
      if (state === 'toggled') await toggle();
      const m = await read();
      seen.push(`${width} ${m.folded ? 'folded' : 'open'}: boxes ${m.boxes}, scroll-padding ${m.scrollPad}, #app ${m.app}, #report ${m.report}`);
      if (m.folded === null || m.boxes <= 0) throw new Error(`expected the floating Next steps box at ${width} px: ` + JSON.stringify(m));
      if (Math.abs(m.scrollPad - (18 + m.boxes)) > 0.5) throw new Error(`at ${width} px a focused control can stop under the floating boxes: scroll-padding-bottom ${m.scrollPad}, boxes ${m.boxes}`);
      const wantApp = width >= 1121 ? 60 : 60 + m.boxes;
      const wantReport = width >= 1121 ? m.boxes : 0;
      if (Math.abs(m.app - wantApp) > 0.5 || Math.abs(m.report - wantReport) > 0.5) throw new Error(`at ${width} px the boxes' room is in the wrong place: #app ${m.app} (want ${wantApp}), #report ${m.report} (want ${wantReport})`);
    }
    await toggle(); // as loaded again
  }
  console.log('  desk widths, the floating boxes\' room and focus padding: ' + seen.join('; '));
  await s.setViewport({ width: 1400, height: 1900 });
}

// 4. axe-core: WCAG 2.x A/AA rules plus the landmark best practices.
// Night mode (DGS 2026-10-04, src/ui/theme.ts): the Dark choice turns the
// page dark — <html data-theme="dark">, a dark ground — with every visible
// text still meeting WCAG contrast (axe's color-contrast rule); Auto then puts
// it back (headless browsers report a light device). The choice is saved, so
// a reload stays dark until Auto is picked.
async function checkNightMode(s, page, label) {
  await s.evalJs(`document.querySelector('[data-key="theme.dark"]').click()`);
  await s.settle();
  const state = JSON.parse(
    await s.evalJs(`JSON.stringify({ theme: document.documentElement.dataset.theme, pressed: document.querySelector('[data-key="theme.dark"]').getAttribute('aria-checked'), bg: getComputedStyle(document.body).backgroundColor })`),
  );
  const rgb = (state.bg.match(/\d+/g) ?? []).slice(0, 3).map(Number);
  if (state.theme !== 'dark' || state.pressed !== 'true' || !(rgb.length === 3 && Math.max(...rgb) < 60)) {
    throw new Error('night mode: Dark did not turn the page dark — ' + JSON.stringify(state));
  }
  await s.shot(`${page}-dark`);
  await checkAxe(s, `${label}, night mode`);
  await s.evalJs(`document.querySelector('[data-key="theme.auto"]').click()`);
  await s.settle();
  const back = await s.evalJs(`document.documentElement.dataset.theme`);
  // Auto is dark only where the browser forces pages dark (Opera's "Force dark
  // pages", DGS 2026-10-10 — a run with E2E_BLINK_PREFS turning it on): the
  // same probe as src/ui/theme.ts, so a normal run of any engine still expects
  // light, and the forced-dark run expects the page's own dark theme.
  const forced = await s.evalJs(`(() => { const a = document.createElement('a'); a.href = '#'; a.style.cssText = 'position:absolute;left:-9999px;color-scheme:light'; document.documentElement.append(a); const c = getComputedStyle(a).color; a.remove(); return c === 'rgb(158, 158, 255)'; })()`);
  if (back !== (forced ? 'dark' : 'light')) throw new Error(`night mode: Auto on a light device ${forced ? 'whose browser forces pages dark must be the page’s own dark theme' : 'must return the page to light'} — ` + back);
  if (forced) console.log('  the browser forces pages dark: Auto shows the page’s own dark theme');
  console.log(`  night mode: Dark turns the ${label} dark with no contrast violations; Auto returns it to light`);
}

async function checkAxe(s, label) {
  await s.evalJs(AXE_SOURCE + '; true');
  const result = JSON.parse(
    await s.evalJs(`axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] } }).then(r => JSON.stringify(r.violations.map(v => ({ id: v.id, impact: v.impact, count: v.nodes.length, first: v.nodes[0]?.target.join(' ') }))))`),
  );
  if (result.length > 0) {
    throw new Error(
      `axe-core found ${result.length} violation type(s) on the ${label}: ` +
        result.map((v) => `${v.id} [${v.impact}] ×${v.count} (first: ${v.first})`).join('; '),
    );
  }
  console.log(`  axe-core: no WCAG 2.x A/AA or landmark violations on the ${label}`);
}
