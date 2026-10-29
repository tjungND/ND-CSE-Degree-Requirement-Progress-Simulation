import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { STAMP_RE } from './session-common.mjs';
import { exampleRecord, loadExampleRecord, localToday } from './example-record.mjs';

/** The WordPress-side listener, read out of the file the DGS copies and pastes
 * (docs/wordpress-footer-snippet.html) so the tested text and the pasted text
 * cannot drift apart. The prose above it mentions `<script>` as well — hence
 * the LAST occurrence, and the sanity check. */
function wordPressSnippetScript() {
  const file = readFileSync(new URL('../../docs/wordpress-footer-snippet.html', import.meta.url), 'utf8');
  const open = file.lastIndexOf('<script>');
  const close = file.indexOf('</script>', open);
  if (open < 0 || close < 0) throw new Error('docs/wordpress-footer-snippet.html has no <script> block');
  const js = file.slice(open + '<script>'.length, close);
  if (!js.includes('APP_ORIGIN') || js.includes('KSES')) throw new Error('extracted the wrong part of the WordPress snippet');
  return js;
}

// E2E: the basic app flow — initial Ph.D. report, a mid-degree record (the old example student, loaded from a file), M.S. tab.
export async function driveApp(s, baseUrl) {
  await s.open(baseUrl);
  await checkHeadStart(s, 'self-check page, first load');
  await s.evalJs(`localStorage.clear()`);
  await s.open(baseUrl);
  await s.waitFor(`document.querySelectorAll('.req').length > 5`);
  await checkHeadStart(s, 'self-check page, reloaded');
  // A first visit describes the DEGREE, not a student who has failed thirteen
  // checks they have not been asked about (2026-09-08): the headline says so
  // and the "needs your attention" list is folded away, not gone.
  const firstVisit = JSON.parse(await s.evalJs(`JSON.stringify((() => {
    const fold = document.querySelector('details.attention-fold');
    return {
      headline: document.querySelector('.scorehead .headline, .summary-mobile .headline')?.textContent ?? document.querySelector('.audit .headline')?.textContent ?? '',
      folded: !!fold, open: fold ? fold.open : null,
      summary: fold?.querySelector('summary')?.textContent ?? '',
      attentionInside: !!fold?.querySelector('.attention'),
      // By class, not nth-of-type: since 2026-09-18 the ring carries a SECOND
      // arc for conditionally-met rows, drawn before this one.
      dialStroke: document.querySelector('.dial .dial-arc:not(.dial-arc-conditional)')?.getAttribute('stroke') ?? '',
    };
  })())`));
  console.log('  first visit:', JSON.stringify(firstVisit));
  if (!/^Getting started/.test(firstVisit.headline)) throw new Error('an untouched record must not lead with "0 of N met": ' + firstVisit.headline);
  if (!firstVisit.folded || firstVisit.open !== false || !firstVisit.attentionInside) throw new Error('the attention list must be folded on a first visit: ' + JSON.stringify(firstVisit));
  if (!/checks(, plus \d+ allowances?)?$/.test(firstVisit.summary)) throw new Error('the fold must name what it holds: ' + firstVisit.summary);
  if (firstVisit.dialStroke === 'var(--bad)') throw new Error('an empty record must not paint the dial red');
  await s.shot('app-initial-phd');
  await checkFormControls(s);
  await checkSheetLink(s, 'app');

  // The mid-degree Ph.D. record the checks below were written against — the
  // old "Load example" student, loaded as a saved file since the button went
  // (DGS 2026-10-17; scripts/e2e/example-record.mjs).
  await loadExampleRecord(s, 'phd');
  // The load toast says what the file says about itself — the day it was
  // saved and its course count (blue-team review 2026-10-17, U24) — and, the
  // device's record having held nothing, carries no Undo (U23).
  const firstLoad = JSON.parse(await s.evalJs(`JSON.stringify({ toasts: [...document.querySelectorAll('.toast')].map((t) => t.textContent), undo: !!document.querySelector('.toast .toast-action') })`));
  console.log('  first load:', JSON.stringify(firstLoad));
  if (firstLoad.undo || !firstLoad.toasts.some((t) => /^File loaded — saved [A-Z][a-z]+ \d{1,2}, \d{4} \(8 courses\)\.$/.test(t))) throw new Error('loading over an empty record must say when the file was saved, with no Undo: ' + JSON.stringify(firstLoad));
  // Toasts keep clear of the floating boxes (blue-team review 2026-10-17,
  // U16): at desk width the stack sits LEFT of the boxes — the load toast's
  // right edge short of their left edge — while <html> carries `has-floats`.
  const toastClear = JSON.parse(await s.evalJs(`JSON.stringify((() => {
    const t = document.querySelector('.toast');
    const boxes = [...document.querySelectorAll('.attention.floating, .warnings.floating')].map((b) => b.getBoundingClientRect());
    const r = t?.getBoundingClientRect();
    return { width: window.innerWidth, hasFloats: document.documentElement.classList.contains('has-floats'), boxes: boxes.length, toastRight: r ? Math.round(r.right) : null, boxesLeft: boxes.length ? Math.round(Math.min(...boxes.map((b) => b.left))) : null };
  })())`));
  console.log('  toast vs floating boxes:', JSON.stringify(toastClear));
  if (!toastClear.hasFloats || toastClear.boxes === 0 || toastClear.toastRight === null) throw new Error('expected the load toast and a floating box after the load: ' + JSON.stringify(toastClear));
  if (toastClear.toastRight > toastClear.boxesLeft) throw new Error('at desk width the toast must sit left of the floating boxes: ' + JSON.stringify(toastClear));
  // Loading a record over one that holds entries carries Undo for 20 s (U23):
  // the M.S. example replaces the Ph.D. one, the toast says what went, and
  // Undo puts the Ph.D. record back — the same key, the same rows — with
  // focus on "Load a file". The drive then goes on with the Ph.D. record.
  const phdKey = await s.evalJs(`localStorage.getItem('cse-degree-audit/v1/student')`);
  const phdIds = await s.evalJs(`JSON.stringify([...document.querySelectorAll('table.courses .cid')].map((e) => e.textContent))`);
  await loadExampleRecord(s, 'mscse');
  const overwrote = JSON.parse(await s.evalJs(`JSON.stringify((() => { const t = document.querySelector('.toast.has-action'); return { text: t?.textContent ?? '', program: JSON.parse(localStorage.getItem('cse-degree-audit/v1/student') ?? '{}').program ?? '' }; })())`));
  console.log('  load over a record:', JSON.stringify(overwrote));
  if (overwrote.program !== 'mscse' || !/^File loaded — saved [A-Z][a-z]+ \d{1,2}, \d{4} \(8 courses\)\. It replaced the 8 courses that were on this device\. Undo$/.test(overwrote.text)) throw new Error('loading over a record must say what it replaced and offer Undo: ' + JSON.stringify(overwrote));
  await s.shotElement('load-undo-toast', '.toast.has-action');
  await s.evalJs(`document.querySelector('.toast.has-action .toast-action').click()`);
  await s.waitFor(`document.querySelector('.program-name')?.textContent.includes('Ph.D.') && !document.querySelector('.toast.has-action')`);
  await s.settle(200);
  const undone = JSON.parse(await s.evalJs(`JSON.stringify({ key: localStorage.getItem('cse-degree-audit/v1/student'), ids: [...document.querySelectorAll('table.courses .cid')].map((e) => e.textContent), focus: document.activeElement?.dataset?.key ?? '', rings: document.querySelectorAll('.next-step-ring').length })`));
  if (undone.key !== phdKey || JSON.stringify(undone.ids) !== phdIds || undone.focus !== 'tools.load' || undone.rings > 0) throw new Error('Undo must put the replaced record back exactly, focus "Load a file" and highlight nothing: ' + JSON.stringify({ ...undone, key: undone.key === phdKey ? 'same' : 'DIFFERENT' }));
  console.log('  Undo put the Ph.D. record back (same key, same rows), focus on Load a file');
  if ((await s.evalJs(`document.querySelector('.dial .dial-arc:not(.dial-arc-conditional)')?.getAttribute('stroke')`)) === 'var(--bad)') {
    throw new Error('a student who is simply not finished must not see a red dial');
  }
  // No "Does not apply" card, and no group heading left without a card (DGS
  // 2026-10-05: "When something is 'does not apply', hide it and do not show
  // it"). The example has no transfer course, so its transfer row is one.
  const hidden = JSON.parse(await s.evalJs(`JSON.stringify({
    pills: [...document.querySelectorAll('.req .pill')].filter((p) => p.textContent.trim() === 'Does not apply').length,
    emptyHeads: [...document.querySelectorAll('h3.group-head')].filter((h) => !(h.nextElementSibling && h.nextElementSibling.classList.contains('req'))).map((h) => h.textContent),
    transferCard: !!document.getElementById('req-phd-transfer'),
  })`));
  if (hidden.pills > 0 || hidden.emptyHeads.length > 0 || hidden.transferCard) throw new Error('a row that does not apply must not be shown: ' + JSON.stringify(hidden));
  console.log('  no "Does not apply" card and no empty group heading');
  // The review card is shown all the time, its button inactive until a course
  // needs a decision (DGS 2026-10-16): the example has nothing to review.
  const reviewIdle = JSON.parse(await s.evalJs(`JSON.stringify((() => { const card = document.querySelector('#dgs-review'); const b = card?.querySelector('[data-key="review.copy"]'); return { shown: !!card, idle: !!card?.classList.contains('is-idle'), head: card?.querySelector('h2')?.textContent ?? '', inactive: b?.getAttribute('aria-disabled') ?? null, label: b?.textContent ?? '', reason: b?.getAttribute('title') ?? '', hint: card?.querySelector('p.hint')?.textContent ?? '', lines: card?.querySelectorAll('.review-line').length ?? -1 }; })())`));
  console.log('  review card, nothing to review:', JSON.stringify({ ...reviewIdle, reason: reviewIdle.reason.slice(0, 70) }));
  if (!reviewIdle.shown || !reviewIdle.idle || reviewIdle.head !== 'Ask the DGS to review 0 courses' || reviewIdle.inactive !== 'true' || reviewIdle.label !== 'Initiate the review request' || !/^Nothing for the DGS to review yet\. This becomes active when a course needs the DGS’s decision — /.test(reviewIdle.reason) || !/^Nothing to review yet — a request is needed only when a course needs the DGS’s decision: /.test(reviewIdle.hint) || reviewIdle.lines !== 0) throw new Error('the review card must be shown, inactive, saying why: ' + JSON.stringify(reviewIdle));
  await s.shotElement('dgs-review-idle', '#dgs-review');
  await checkSectionChip(s, '[data-key="secref.coursework"]', 'Course Requirements.*twenty-four \\(24\\) credit hours of regular courses', 'Coursework card, CSE §4.2');
  // The deadline alert (DGS 2026-09-28): the example entered last fall, so
  // its qualifier's four semesters end next semester — the pill says so in
  // words, in its own colour, and the chip under it carries the same state.
  const dueSoon = JSON.parse(await s.evalJs(`JSON.stringify([...document.querySelectorAll('.req:has(.pill.s-duesoon)')].map((req) => ({
    title: req.querySelector('.req-title')?.textContent.trim().slice(0, 40), pill: req.querySelector('.pill').textContent, chip: req.querySelector('.chip.deadline')?.className,
  })))`));
  console.log('  due-soon rows:', JSON.stringify(dueSoon));
  if (dueSoon.length === 0 || !dueSoon.every((r) => /^(In progress|Not started) · due (this|next) semester$/.test(r.pill) && /d-due_soon/.test(r.chip ?? ''))) throw new Error('the example must show the deadline alert on its qualifier row: ' + JSON.stringify(dueSoon));
  if (!(await s.evalJs(`!!document.querySelector('.pill.s-duesoon.s-in_progress, .pill.s-duesoon.s-unmet')`))) throw new Error('the alert colours the pill on top of its status class');
  await s.evalJs(`document.querySelector('.req:has(.pill.s-duesoon)').id = 'shot-due-soon'`);
  await s.shotElement('due-soon-row', '#shot-due-soon');
  // Every requirement a course feeds, under its credit sentence (2026-09-08):
  // one course routinely serves several, and the sentence names only the pool.
  const feeds = JSON.parse(await s.evalJs(`JSON.stringify((() => {
    const rows = [...document.querySelectorAll('table.courses tr')].map((tr) => ({
      id: tr.querySelector('.cid')?.textContent ?? '',
      now: [...tr.querySelectorAll('.counts-toward.now .req-link')].map((a) => ({ t: a.textContent, href: a.getAttribute('href') })),
      later: [...tr.querySelectorAll('.counts-toward.later .req-link')].map((a) => a.textContent),
    })).filter((r) => r.id);
    const targets = rows.flatMap((r) => r.now.map((n) => n.href)).filter((h) => !!document.querySelector(h));
    return { rows, linksResolve: targets.length, linkCount: rows.reduce((n, r) => n + r.now.length, 0) };
  })())`));
  const richest = feeds.rows.reduce((best, r) => (r.now.length > best.now.length ? r : best), { now: [], id: '' });
  console.log('  counts toward:', richest.id, JSON.stringify(richest.now.map((n) => n.t)));
  if (richest.now.length < 3) throw new Error('a course must name every requirement it feeds: ' + JSON.stringify(feeds.rows));
  if (!richest.now.some((n) => /^Core: /.test(n.t))) throw new Error('the §4.4.1 area a course covers must be named: ' + JSON.stringify(richest.now));
  // Short names (DGS 2026-09-08): the full requirement title is the tooltip.
  const longest = Math.max(...richest.now.map((n) => n.t.length));
  if (longest > 32) throw new Error('a requirement name in the list is too long for the cell: ' + JSON.stringify(richest.now.map((n) => n.t)));
  if (feeds.linksResolve !== feeds.linkCount) throw new Error(`${feeds.linkCount - feeds.linksResolve} requirement links do not resolve`);
  if (!feeds.rows.some((r) => r.later.length > 0)) throw new Error('an in-progress course must say what it WILL count toward');

  // A course that can count for ANY specialization group says which group is
  // worth choosing, from what the student's other courses already cover.
  const groups = JSON.parse(await s.evalJs(`JSON.stringify((() => {
    const sel = document.querySelector('table.courses select[data-key$=".group"]');
    if (!sel) return null;
    const tr = sel.closest('tr');
    return {
      labels: [...sel.querySelectorAll('optgroup')].map((g) => g.label),
      needed: [...(sel.querySelector('optgroup')?.children ?? [])].map((o) => o.textContent),
      covered: [...(sel.querySelectorAll('optgroup')[1]?.children ?? [])].map((o) => o.textContent),
      hint: tr?.querySelector('.group-hint')?.textContent ?? null,
    };
  })())`));
  console.log('  specialization choice:', JSON.stringify(groups));
  if (!groups || groups.labels[0] !== 'Groups you still need' || groups.labels[1] !== 'Already covered by another course') {
    throw new Error('a flexible course must sort its groups by what is still needed: ' + JSON.stringify(groups));
  }
  if (groups.needed.length === 0 || groups.covered.length === 0) throw new Error('the example should have both kinds: ' + JSON.stringify(groups));

  // A disclosure the student opened survives the next edit (2026-09-08):
  // render() rebuilds the DOM. Since 2026-10-03 the disclosure is a card's
  // "Relevant Policies" (was "Details" until 2026-10-04; the rule, the reasons, the next steps — DGS: the card shows
  // only what is satisfied by what). The edit is a harmless full-time-term
  // tick, put back straight afterwards.
  await s.evalJs(`document.querySelector('details.req-more > summary')?.click()`);
  await s.waitFor(`document.querySelector('details.req-more[open]')`);
  const moreKey = await s.evalJs(`document.querySelector('details.req-more[open]')?.dataset?.key ?? ''`);
  await s.evalJs(`document.querySelector('.ft-terms input[type="checkbox"]')?.click()`);
  await s.waitFor(`document.querySelectorAll('.req').length > 5`);
  const reopened = await s.evalJs(`document.querySelector('details.req-more[data-key="${moreKey}"]')?.open === true`);
  console.log('  disclosure after an edit: still open =', reopened, '(opened:', moreKey + ')');
  if (reopened !== true) throw new Error('an opened card Details must survive the next edit: ' + moreKey);
  // "Does this look wrong? Tell the DGS" (DGS 2026-10-11, item 18): last in
  // every card's fold, a mailto naming the requirement and the stamp.
  const problem = JSON.parse(await s.evalJs(`JSON.stringify({
    href: document.querySelector('details.req-more[data-key="${moreKey}"] .req-problem a[href^="mailto:"]')?.getAttribute('href') ?? '',
    links: document.querySelectorAll('.req .req-more .req-problem a[href^="mailto:"]').length,
    cards: document.querySelectorAll('.req .req-more').length,
  })`));
  const problemBody = problem.href ? (new URL(problem.href).searchParams.get('body') ?? '') : '';
  if (problem.links !== problem.cards || !/^Requirement: .+ — [a-z]+\.[A-Za-z.]+$/m.test(problemBody) || !/^The page shows: .+ \((met|unmet|in_progress|needs_dgs_review|cannot_evaluate|not_applicable)\b/m.test(problemBody) || !/^Checked with: course rules [0-9a-f]{8} /m.test(problemBody)) throw new Error('every card fold must end with the "Does this look wrong?" mailto, naming the requirement and the stamp: ' + JSON.stringify({ ...problem, problemBody }));
  console.log(`  "Does this look wrong?": a mailto in each of ${problem.cards} card folds — ${problemBody.split('\n').find((l) => l.startsWith('Requirement:'))}`);
  await s.evalJs(`document.querySelector('.ft-terms input[type="checkbox"]')?.click()`); // put it back
  await s.waitFor(`document.querySelectorAll('.req').length > 5`);
  await s.evalJs(`document.querySelector('details.req-more[data-key="${moreKey}"] > summary')?.click()`); // and close it again
  await s.waitFor(`!document.querySelector('details.req-more[data-key="${moreKey}"]')?.open`);
  await s.shot('app-example-phd');
  await checkCardStripes(s, ['due', 'line']);

  // The candidacy card's conditions carry marks (DGS 2026-10-06: "it's hard to
  // see what are met and what are not met"): a met one ✓ and an open one, each
  // with its mark in the bullet's place and a word for screen readers.
  const checks = JSON.parse(await s.evalJs(`JSON.stringify([...document.querySelectorAll('#req-phd-candidacyAdmission li.check')].map((li) => ({ cls: li.className, glyph: li.querySelector('.mark [aria-hidden]')?.textContent ?? '', word: li.querySelector('.mark .visually-hidden')?.textContent ?? '' })))`));
  console.log('  candidacy conditions:', checks.map((c) => c.glyph + ' ' + c.word.trim()).join(' · '));
  // Four since core knowledge's three areas became one line (DGS 2026-10-27):
  // regular credits, core knowledge, specialization, the advisor.
  if (checks.length < 4 || !checks.some((c) => c.cls.includes('check-met') && c.glyph === '✓') || !checks.some((c) => !c.cls.includes('check-met'))) throw new Error('candidacy condition marks: ' + JSON.stringify(checks));
  await s.evalJs(`document.getElementById('req-phd-candidacyAdmission')?.scrollIntoView({ block: 'start' })`);
  await s.shot('app-condition-marks');

  // "Oral Candidacy Exam (OCE)" in full once on the page (plus the glossary,
  // which keeps the full term, and the group heading over the candidacy
  // cards, which is spelled out — DGS 2026-10-06), then "OCE" (DGS
  // 2026-09-06 evening).
  const oce = JSON.parse(await s.evalJs(`JSON.stringify((() => {
    const all = document.querySelector('#app').textContent;
    const gl = document.querySelector('details.glossary')?.textContent ?? '';
    const heads = [...document.querySelectorAll('h3.group-head')].map((h) => h.textContent).join(' ');
    const count = (t) => t.split('Oral Candidacy Exam (OCE)').length - 1;
    return { page: count(all) - count(gl) - count(heads), glossary: count(gl), heading: count(heads), short: (all.match(/\\bOCE\\b/g) ?? []).length };
  })())`));
  console.log('  OCE mentions — page (outside the glossary and headings):', oce.page, '| glossary:', oce.glossary, '| group heading:', oce.heading, '| short "OCE":', oce.short);
  if (oce.page !== 1 || oce.glossary !== 1 || oce.heading !== 1 || oce.short < 3) throw new Error('OCE first-mention rule: ' + JSON.stringify(oce));

  // Seminar, research and project credits count toward the total "but not
  // toward the regular-course credits" — never "toward the total only": the
  // project credits and the first-year seminars are required in their own
  // right (policy review round 4, P4-text-5; DGS 2026-10-12).
  const regularWords = JSON.parse(await s.evalJs(`JSON.stringify({
    key: document.querySelector('.course-key')?.textContent ?? '',
    glossary: [...document.querySelectorAll('details.glossary dt, details.glossary dd, details.glossary li, details.glossary p')].map((e) => e.textContent).join(' '),
  })`));
  console.log('  coursework key:', regularWords.key.replace(/^.*?Regular courses/, 'Regular courses'));
  if (/total only/.test(regularWords.key) || !/total but not toward the regular-course credits/.test(regularWords.key)) throw new Error('the coursework key must not say "total only": ' + regularWords.key);
  if (/count toward the total only/.test(regularWords.glossary) || !/required in their own right: the first-year research seminars \((?:CSE )?§4\.2\)/.test(regularWords.glossary)) throw new Error('the glossary’s Regular course entry (Ph.D.): ' + (/Regular course.{0,300}/.exec(regularWords.glossary)?.[0] ?? regularWords.glossary.slice(0, 400)));

  // A Ph.D. student who already holds Notre Dame's own master's (DGS
  // 2026-09-09): §4.5 cannot award a degree twice. Since 2026-09-22 that fact
  // is an answer in the earlier-degrees questions (Change, on the standing
  // card): answering "the MSCSE at Notre Dame" takes the along-the-way row out
  // of the report, answering "No" brings it back.
  const msRow = () => `!!document.getElementById('req-phd-msAlongTheWay')`;
  if ((await s.evalJs(msRow())) !== true) throw new Error('the §4.5 along-the-way row should be in the report for the example');
  const answerGraduate = async (value) => {
    await s.evalJs(`document.querySelector('[data-key="standing.background.change"]').click()`);
    await s.waitFor(`document.querySelector('dialog.background-dialog[open]')`);
    // The Notre Dame MSCSE answers ask about a degree elsewhere too
    // (P3-prior-programs-1/-2, 2026-10-07): "No" here, so Save is enabled.
    await s.evalJs(`(() => { document.querySelector('[data-key="background.graduate.${value}"]').click(); const no = document.querySelector('[data-key="background.alsoelsewhere.no"]'); if (no && !no.closest('fieldset').hidden) no.click(); document.querySelector('[data-key="background.save"]').click(); })()`);
    await s.waitFor(`!document.querySelector('dialog.background-dialog')`);
  };
  // Only the graduate answers the other answers leave possible are offered,
  // most probable first (DGS 2026-10-08): the example's bachelor's is from
  // another university, so "the MSCSE through the Integrated 4+1" is not;
  // under "Notre Dame — CSE" a "Yes" to the 4+1 hides the regular-master's
  // MSCSE and puts the finished 4+1 first, a "No" hides the 4+1 one; an answer
  // a later click rules out is dropped, and Save waits. The order checked is
  // the rows' order on the page, not the options' order in the code.
  await s.evalJs(`document.querySelector('[data-key="standing.background.change"]').click()`);
  await s.waitFor(`document.querySelector('dialog.background-dialog[open]')`);
  const shownGraduate = async () => JSON.parse(await s.evalJs(`JSON.stringify([...document.querySelectorAll('dialog.background-dialog [data-key^="background.graduate."]')].filter((i) => !i.closest('label').hidden).sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1).map((i) => i.dataset.key.slice('background.graduate.'.length)))`));
  const expectGraduate = async (want, after) => {
    const got = await shownGraduate();
    if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`graduate options ${after}: ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`);
  };
  await expectGraduate(['none', 'elsewhere', 'nd-mscse', 'nd-mscse-transfer', 'nd-other'], 'with a bachelor’s from another university');
  await s.evalJs(`document.querySelector('[data-key="background.bachelors.nd-cse"]').click()`);
  await expectGraduate(['none', 'nd-4plus1', 'nd-mscse', 'nd-mscse-transfer', 'elsewhere', 'nd-other'], 'with Notre Dame CSE and the 4+1 still open');
  await s.evalJs(`document.querySelector('[data-key="background.graduate.nd-mscse"]').click()`);
  await s.evalJs(`document.querySelector('[data-key="background.ndintegrated.yes"]').click()`);
  await expectGraduate(['nd-4plus1', 'nd-mscse-transfer', 'elsewhere', 'nd-other'], 'after Yes to the 4+1 (no "No": the 4+1 is a graduate program started)');
  const dropped = JSON.parse(await s.evalJs(`JSON.stringify({ checked: !!document.querySelector('dialog.background-dialog [data-key^="background.graduate."]:checked'), saveDisabled: document.querySelector('[data-key="background.save"]').disabled })`));
  if (dropped.checked || !dropped.saveDisabled) throw new Error('a graduate answer the 4+1 answer rules out must be dropped, with Save waiting: ' + JSON.stringify(dropped));
  // Choosing the MSCSE through the 4+1 keeps the order (DGS 2026-10-08: it
  // went back to the open-4+1 order) and the 4+1 follow-up, answered Yes.
  await s.evalJs(`document.querySelector('[data-key="background.graduate.nd-4plus1"]').click()`);
  await expectGraduate(['nd-4plus1', 'nd-mscse-transfer', 'elsewhere', 'nd-other'], 'after choosing the MSCSE through the 4+1');
  const stay = JSON.parse(await s.evalJs(`JSON.stringify((() => { const y = document.querySelector('[data-key="background.ndintegrated.yes"]'); return { yes: y.checked, shown: !y.closest('fieldset').hidden, chosen: document.querySelector('[data-key="background.graduate.nd-4plus1"]').checked }; })())`));
  if (!stay.yes || !stay.shown || !stay.chosen) throw new Error('choosing the MSCSE through the 4+1 keeps the 4+1 follow-up shown and at Yes: ' + JSON.stringify(stay));
  await s.evalJs(`document.querySelector('[data-key="background.ndintegrated.no"]').click()`);
  await expectGraduate(['none', 'nd-mscse', 'nd-mscse-transfer', 'elsewhere', 'nd-other'], 'after No to the 4+1');
  if (await s.evalJs(`!!document.querySelector('dialog.background-dialog [data-key^="background.graduate."]:checked')`)) throw new Error('No to the 4+1 must drop the MSCSE-through-the-4+1 answer');
  await s.evalJs(`document.querySelector('[data-key="background.cancel"]').click()`);
  await s.waitFor(`!document.querySelector('dialog.background-dialog')`);
  console.log('  earlier degrees: the graduate options follow the bachelor’s and 4+1 answers; an answer they rule out is dropped');
  await answerGraduate('nd-mscse');
  await s.waitFor(`!document.getElementById('req-phd-msAlongTheWay')`);
  console.log('  already holds the MSCSE (earlier-degrees answer) → the §4.5 along-the-way row is gone');
  await answerGraduate('none'); // put it back
  await s.waitFor(`!!document.getElementById('req-phd-msAlongTheWay')`);
  // A transfer from the MSCSE into the Ph.D. asks WHEN (DGS 2026-09-28): the
  // term goes on the emails' subject lines; the entry term is untouched.
  await s.evalJs(`document.querySelector('[data-key="standing.background.change"]').click()`);
  await s.waitFor(`document.querySelector('dialog.background-dialog[open]')`);
  await s.evalJs(`document.querySelector('[data-key="background.graduate.nd-mscse-transfer"]').click()`);
  const transferAsk = JSON.parse(await s.evalJs(`JSON.stringify((() => { const y = document.querySelector('[data-key="background.transferred.year"]'); const box = y?.closest('fieldset'); return { shown: !!box && !box.hidden, legend: box?.querySelector('legend')?.textContent.slice(0, 40) }; })())`));
  console.log('  transfer question:', JSON.stringify(transferAsk));
  if (!transferAsk.shown || !/^When did you transfer into the Ph\.D\./.test(transferAsk.legend)) throw new Error('choosing "transferred into the Ph.D." must ask for the transfer term: ' + JSON.stringify(transferAsk));
  await s.evalJs(`(() => { const se = document.querySelector('[data-key="background.transferred.season"]'); se.value = 'spring'; se.dispatchEvent(new Event('change')); const y = document.querySelector('[data-key="background.transferred.year"]'); y.value = '2027'; y.dispatchEvent(new Event('change')); })()`);
  // …and whether a degree elsewhere came too (policy review round 3,
  // P3-prior-programs-2; DGS 2026-10-07: option (a)): Save waits for the
  // answer, and a yes asks "Did you finish that degree?".
  const alsoAsk = JSON.parse(await s.evalJs(`JSON.stringify((() => { const box = document.querySelector('[data-key="background.alsoelsewhere.yes"]')?.closest('fieldset'); return { shown: !!box && !box.hidden, legend: box?.querySelector('legend')?.textContent ?? '', saveDisabled: document.querySelector('[data-key="background.save"]').disabled }; })())`));
  console.log('  degree-elsewhere question:', JSON.stringify(alsoAsk));
  if (!alsoAsk.shown || alsoAsk.legend !== 'Did you also hold, or start, a graduate degree at another university?' || !alsoAsk.saveDisabled) throw new Error('the transfer answer must ask about a degree elsewhere before Save: ' + JSON.stringify(alsoAsk));
  await s.evalJs(`document.querySelector('[data-key="background.alsoelsewhere.yes"]').click()`);
  const finishedAsk = await s.evalJs(`(() => { const box = document.querySelector('[data-key="background.finished.yes"]')?.closest('fieldset'); return !!box && !box.hidden && document.querySelector('[data-key="background.save"]').disabled; })()`);
  if (finishedAsk !== true) throw new Error('a yes must ask "Did you finish that degree?" before Save');
  await s.evalJs(`document.querySelector('[data-key="background.finished.yes"]').click()`);
  await s.shot('background-transfer-also-elsewhere');
  await s.evalJs(`document.querySelector('[data-key="background.save"]').click()`);
  await s.waitFor(`!document.querySelector('dialog.background-dialog')`);
  const bgLine = await s.evalJs(`document.querySelector('[data-key="standing.background"]')?.textContent ?? ''`);
  if (!/finished, at another university; and transferred into the Ph\.D\. from the Notre Dame MSCSE in Spring 2027/.test(bgLine)) throw new Error('the standing line must name the degree elsewhere and the transfer term: ' + bgLine);
  console.log('  standing line:', bgLine.slice(0, 160));
  // The dialog opens after the clipboard write: wait for it.
  await s.evalJs(`document.querySelector('[data-key="save.copy"]').click()`);
  await s.waitFor(`!!document.querySelector('dialog.copy-check')`);
  const advSubject = await s.evalJs(`document.querySelector('dialog.copy-check .copy-subject')?.textContent ?? ''`);
  await s.evalJs(`document.querySelector('[data-key="copy.ok"]').click()`);
  await s.waitFor(`!document.querySelector('dialog.copy-check')`);
  console.log('  advisor subject with the transfer:', advSubject);
  if (!/^Subject: Degree self-check — Ph\.D\. \(transferred Spring 2027 from the Notre Dame MSCSE, entered Fall \d{4}\) — /.test(advSubject)) throw new Error('the subject must carry the transfer (DGS 2026-09-28): ' + advSubject);
  await answerGraduate('none'); // put it back
  await s.waitFor(`!!document.getElementById('req-phd-msAlongTheWay')`);

  // Manual course from another university (2026-09-06 evening): the University
  // box offers the ExternalCourses tab's universities and Title-Cases what is
  // typed; Level has two choices; the course lands under its heading.
  const form = JSON.parse(await s.evalJs(`JSON.stringify((() => {
    const origin = document.querySelector('[data-key="course.new.origin"]'); origin.value = 'transfer'; origin.dispatchEvent(new Event('change'));
    const uni = document.querySelector('[data-key="course.new.institution"]');
    const options = [...document.querySelectorAll('#known-universities option')].map(o => o.value);
    uni.value = 'example institute of technology'; uni.dispatchEvent(new Event('change'));
    const typed = uni.value;
    if (options.length > 0) { uni.value = options[0].toLowerCase(); uni.dispatchEvent(new Event('change')); }
    const known = uni.value;
    return { list: uni.getAttribute('list'), options, typed, known, levels: [...document.querySelector('[data-key="course.new.level"]').options].map(o => o.value + '=' + o.textContent) };
  })())`));
  console.log('  university box:', form.list, '|', form.options.length, 'known |', JSON.stringify(form.typed), JSON.stringify(form.known), '| levels:', JSON.stringify(form.levels));
  if (form.list !== 'known-universities' || form.typed !== 'Example Institute of Technology') throw new Error('university box: ' + JSON.stringify(form));
  if (form.options.length > 0 && form.known !== form.options[0]) throw new Error('a known university typed in lower case must come back in its list spelling: ' + JSON.stringify(form));
  if (form.levels.length !== 2 || !form.levels[0].startsWith('=Grad student — after') || !form.levels[1].startsWith('bachelors=UG student — before')) throw new Error('level options: ' + JSON.stringify(form.levels));
  await s.evalJs(`(() => { const uni = document.querySelector('[data-key="course.new.institution"]'); uni.value = 'example institute of technology'; uni.dispatchEvent(new Event('change')); const id = document.querySelector('[data-key="course.new.id"]'); id.value = 'CS 53000'; id.dispatchEvent(new Event('change')); document.querySelector('[data-key="course.new.add"]').click(); })()`);
  // Sections carry their document since 2026-10-03 ("CSE §5.2").
  await s.waitFor(`[...document.querySelectorAll('h3.subhead')].some(h => h.textContent === 'Example Institute of Technology — graduate coursework (CSE §5.2)')`);
  console.log('  a hand-typed course from another university lands under its Title-Cased heading');
  await s.evalJs(`(() => { const c = [...document.querySelectorAll('.card')].find(c => c.querySelector('h2')?.textContent.includes('Coursework')); c.id = 'shot-coursework'; })()`);
  await s.shotElement('manual-transfer-course', '#shot-coursework');
  // The next course form starts from the last entry (blue-team review
  // 2026-10-17, U11): Where, University and Taken as stay as they were, so a
  // batch from one university is not re-picked row by row; number and title
  // are empty and the grade is In progress again, so nothing is added by
  // accident.
  const seeded = JSON.parse(await s.evalJs(`JSON.stringify((() => { const v = (k) => document.querySelector('[data-key="course.new.' + k + '"]'); const shown = (k) => v(k).getClientRects().length > 0; return { origin: v('origin').value, institution: v('institution').value, institutionShown: shown('institution'), level: v('level').value, levelShown: shown('level'), id: v('id').value, title: v('title').value, grade: v('grade').value }; })())`));
  console.log('  the form after Add:', JSON.stringify(seeded));
  if (seeded.origin !== 'transfer' || seeded.institution !== 'Example Institute of Technology' || !seeded.institutionShown || !seeded.levelShown || seeded.level !== '' || seeded.id !== '' || seeded.title !== '' || seeded.grade !== 'IP') throw new Error('after Add the form must start from the last entry’s Where, University and Taken as, the rest empty: ' + JSON.stringify(seeded));
  await s.evalJs(`[...document.querySelectorAll('table.courses tr')].find(tr => tr.querySelector('.cid')?.textContent === 'CS 53000').querySelector('button.remove').click()`);
  await s.waitFor(`![...document.querySelectorAll('table.courses .cid')].some(e => e.textContent === 'CS 53000')`);

  // The Ph.D. tab cites §3 only where it must (DGS 2026-09-11): the §3.5 track
  // note, and the MSCSE-along-the-way row, which is §3.2's degree. Anything
  // else citing §3 on this page is a leak.
  {
    const tabs = JSON.parse(await s.evalJs(`JSON.stringify([...document.querySelectorAll('.tabs button')].map(b => b.textContent.trim()))`));
    // A citation of the Graduate School's Academic Code or the DGS Handbook is
    // not the CSE handbook's §3 (policy review 2026-10-03): strip those first.
    const cse = (l) => l.replace(/(?:Academic Code|DGS Handbook) §\d+(?:\.\d+)*/g, '');
    const lines = (await s.evalJs(`document.querySelector('#app').innerText`)).split('\n').map((l) => l.trim()).filter((l) => /§3(\.\d)*\b/.test(cse(l)) && !tabs.includes(l));
    const allowed = (l) => /§3\.5/.test(l) || /along the way/i.test(l) || /Sections 3 and 4|Section 3 of the/.test(l) === false && /MSCSE/.test(l) && /§3\.2/.test(l);
    const leaks = lines.filter((l) => !allowed(l));
    if (leaks.length) throw new Error('the Ph.D. tab cites §3 where it need not:\n  ' + leaks.slice(0, 6).join('\n  '));
    console.log('  Ph.D. tab: §3 appears only where necessary (' + lines.length + ' line(s), all allowed)');
    // …and the decider is the DGS: "ADGS" appears only in the contact card (DGS 2026-09-11).
    const adgs = (await s.evalJs(`(() => { const c = document.querySelector('#app').cloneNode(true); c.querySelectorAll('.contact-card, details.glossary').forEach(e => e.remove()); return c.textContent; })()`));
    if (/ADGS/.test(adgs)) throw new Error('the Ph.D. tab must not send the student to the ADGS');
    const reviewHead = await s.evalJs(`document.querySelector('.dgs-review h2')?.textContent ?? ''`);
    if (!/^Ask the DGS to review/.test(reviewHead)) throw new Error('the review card (always shown since 2026-10-16) must address the DGS on the Ph.D. tab: ' + reviewHead);
    console.log('  Ph.D. tab: every decision goes to the DGS');
  }

  // A choice the page can make for the student, it makes (DGS 2026-09-12,
  // red-team F2): un-assign the example's flexible course and the page
  // re-assigns it to the group that covers the most, saying so in a toast.
  {
    const rowIndex = await s.evalJs(`[...document.querySelectorAll('table.courses tr')].findIndex(tr => tr.querySelector('.cid')?.textContent === 'CSE 60876') - 1`);
    await s.evalJs(`(() => { const sel = document.querySelector('[data-key="course.${rowIndex}.group"]'); sel.value = ''; sel.dispatchEvent(new Event('change')); })()`);
    await s.waitFor(`document.querySelector('[data-key="course.${rowIndex}.group"]')?.value !== ''`);
    const refilled = await s.evalJs(`document.querySelector('[data-key="course.${rowIndex}.group"]').value`);
    const autoToast = await s.evalJs(`document.querySelector('.toast.auto-notice')?.textContent ?? ''`);
    if (!/chosen automatically to cover the most distinct groups/.test(autoToast)) throw new Error('un-assigning a flexible course must be re-filled with a notice: ' + autoToast);
    if (!/CSE 60876 →/.test(autoToast)) throw new Error('the notice must name the course and group: ' + autoToast);
    console.log('  flexible course re-assigned automatically → ' + refilled + ' (toast shown)');
  }

  // Course ids are read case- and space-insensitively (DGS 2026-09-11): a
  // hand-typed "cse60641" is the sheet's CSE 60641, not a non-CSE course.
  await s.evalJs(`(() => { const o = document.querySelector('[data-key="course.new.origin"]'); o.value = 'nd'; o.dispatchEvent(new Event('change')); const id = document.querySelector('[data-key="course.new.id"]'); id.value = 'cse60641'; id.dispatchEvent(new Event('change')); })()`);
  const canon = await s.evalJs(`document.querySelector('[data-key="course.new.id"]').value + ' | ' + document.querySelector('[data-key="course.new.title"]').value`);
  console.log('  “cse60641” typed →', canon);
  if (!/^CSE 60641 \| .+/.test(canon)) throw new Error('a lower-case, unspaced id must resolve to the sheet row: ' + canon);
  await s.evalJs(`(() => { const id = document.querySelector('[data-key="course.new.id"]'); id.value = ''; id.dispatchEvent(new Event('change')); })()`);

  // Enter adds the course (blue-team review 2026-10-17, U9): the add-course
  // form is a <form>, so the keyboard's return key submits it — once, after
  // the number box's change handler has filled the title. Typed as a student
  // types: the browser fires change on Enter only for a user edit, not for a
  // value set by script. The keyDown carries text '\r' so Chrome raises the
  // keypress that submits (the WebKit and Firefox wrappers press Enter).
  const ENTER_ID = 'CSE 60772'; // listed, not in the example record
  const rowsWith = (id) => `[...document.querySelectorAll('table.courses .cid')].filter((e) => e.textContent === ${JSON.stringify(id)}).length`;
  const enterBefore = Number(await s.evalJs(rowsWith(ENTER_ID)));
  await s.evalJs(`document.querySelector('[data-key="course.new.id"]').focus()`);
  for (const ch of ENTER_ID) await s.send('Input.dispatchKeyEvent', { type: 'char', text: ch, key: ch, unmodifiedText: ch });
  // WebKit shows the datalist's suggestions as the number is typed and, while
  // they show, its picker swallows Enter (TextFieldInputType::handleKeydownEvent
  // — no keypress, so no implicit submission): in Safari the student's first
  // Enter closes the list and the second adds the course. Headless WebKit has
  // no picker UI to close, so the list is closed the other way Safari closes
  // it — leaving the box — and the box is focused again. Chrome and Firefox
  // pass Enter through when no suggestion is highlighted, and here prove that
  // Enter alone fires the change (the title) before the submit.
  if (process.env.E2E_BROWSER === 'webkit' || process.env.E2E_BROWSER === 'safari') await s.evalJs(`(() => { const i = document.querySelector('[data-key="course.new.id"]'); i.blur(); i.focus(); })()`);
  await s.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r' });
  await s.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await s.waitFor(`${rowsWith(ENTER_ID)} === ${enterBefore + 1}`);
  await s.settle(300); // long enough for a second submit to have shown up
  const entered = JSON.parse(await s.evalJs(`JSON.stringify({ rows: ${rowsWith(ENTER_ID)}, title: (JSON.parse(localStorage.getItem('cse-degree-audit/v1/student') || '{}').courses || []).filter((c) => c.courseId === ${JSON.stringify(ENTER_ID)}).map((c) => c.title ?? '').pop() ?? '', formId: document.querySelector('[data-key="course.new.id"]').value, formTag: document.querySelector('.course-form').tagName, addType: document.querySelector('[data-key="course.new.add"]').type })`));
  console.log('  Enter in the number box:', JSON.stringify(entered));
  if (entered.rows !== enterBefore + 1) throw new Error(`Enter must add the course exactly once: ${enterBefore} → ${entered.rows}`);
  if (!entered.title) throw new Error('Enter must run the number box’s change handler first, so the listed course carries its title');
  if (entered.formId !== '' || entered.formTag !== 'FORM' || entered.addType !== 'submit') throw new Error('the add-course form is a <form> whose Add button submits it, empty after Add: ' + JSON.stringify(entered));
  await s.evalJs(`[...document.querySelectorAll('table.courses tr')].filter((tr) => tr.querySelector('.cid')?.textContent === ${JSON.stringify(ENTER_ID)}).pop().querySelector('button.remove').click()`);
  await s.waitFor(`${rowsWith(ENTER_ID)} === ${enterBefore}`);

  // Before Add, an unlisted Notre Dame number is said under its box (U10) and
  // the Title box asks for a title (U14); a title typed clears the Title hint;
  // a listed number clears both and fills the title; a course from another
  // university gets neither line — it is matched after Add.
  const hints = () => s.evalJs(`JSON.stringify((() => { const n = document.getElementById('new-course-id-note'); const h = document.getElementById('new-course-title-hint'); return { note: n && !n.classList.contains('hidden') ? n.textContent : '', hint: h && !h.classList.contains('hidden') ? h.textContent : '', title: document.querySelector('[data-key="course.new.title"]').value, label: document.getElementById('new-course-id-hint')?.textContent ?? '' }; })())`);
  const setId = (id) => s.evalJs(`(() => { const i = document.querySelector('[data-key="course.new.id"]'); i.value = ${JSON.stringify(id)}; i.dispatchEvent(new Event('input')); i.dispatchEvent(new Event('change')); })()`);
  await setId('MATH 60610');
  const unlisted = JSON.parse(await hints());
  console.log('  an unlisted number, before Add:', JSON.stringify(unlisted));
  if (unlisted.note !== 'MATH 60610 is not in the course rules yet — add it anyway; it goes to the DGS in the review request below.' || unlisted.hint !== 'Not in the course rules yet — enter its title so the DGS can identify it in your review request' || unlisted.title !== '') throw new Error('an unlisted Notre Dame number must be said at once, its Title box asking for a title: ' + JSON.stringify(unlisted));
  if (unlisted.label !== '(e.g. CSE 60641 — start typing to pick from the course rules)') throw new Error('the number box’s hint must name the course rules’ list: ' + unlisted.label);
  await s.evalJs(`(() => { const t = document.querySelector('[data-key="course.new.title"]'); t.value = 'Topics in Mathematics'; t.dispatchEvent(new Event('input')); })()`);
  const titled = JSON.parse(await hints());
  if (titled.hint !== '' || titled.note === '') throw new Error('a title typed clears the Title hint and keeps the number’s note: ' + JSON.stringify(titled));
  await setId(ENTER_ID);
  const listed = JSON.parse(await hints());
  if (listed.note !== '' || listed.hint !== '' || listed.title === '') throw new Error('a listed number clears both lines and fills the title: ' + JSON.stringify(listed));
  await s.evalJs(`(() => { const o = document.querySelector('[data-key="course.new.origin"]'); o.value = 'transfer'; o.dispatchEvent(new Event('change')); })()`);
  await setId('MATH 60610');
  const transfer = JSON.parse(await hints());
  if (transfer.note !== '' || transfer.hint !== '') throw new Error('a course from another university gets neither line: ' + JSON.stringify(transfer));
  console.log('  unlisted-number lines: shown for Notre Dame, cleared by a title / a listed number, never for another university');
  await s.evalJs(`(() => { const o = document.querySelector('[data-key="course.new.origin"]'); o.value = 'nd'; o.dispatchEvent(new Event('change')); const t = document.querySelector('[data-key="course.new.title"]'); t.value = ''; t.dispatchEvent(new Event('input')); })()`);
  await setId('');

  // A course entered with 0 credits (DGS 2026-09-11): allowed, because a
  // transcript's credit-hours column can come through blank and refusing the
  // row would lose the course — but never silently. The student is asked
  // first, the safe answer has focus, and Escape cancels.
  await s.evalJs(`(() => {
    const o = document.querySelector('[data-key="course.new.origin"]'); o.value = 'nd'; o.dispatchEvent(new Event('change'));
    const id = document.querySelector('[data-key="course.new.id"]'); id.value = 'CSE 60567'; id.dispatchEvent(new Event('change'));
    const cr = document.querySelector('[data-key="course.new.credits"]'); cr.value = '0'; cr.dispatchEvent(new Event('change'));
    document.querySelector('[data-key="course.new.add"]').click();
  })()`);
  await s.waitFor(`!!document.querySelector('dialog.confirm-check')`);
  const zero = JSON.parse(await s.evalJs(`JSON.stringify((() => {
    const d = document.querySelector('dialog.confirm-check');
    return { title: d.querySelector('h2').textContent, body: d.querySelector('p').textContent,
      buttons: [...d.querySelectorAll('button')].map(b => b.textContent),
      focused: document.activeElement?.dataset?.key ?? '' };
  })())`));
  console.log('  0-credit check:', JSON.stringify(zero.title), '| focus on', zero.focused, '|', JSON.stringify(zero.buttons));
  if (!/CSE 60567 is entered with 0 credits/.test(zero.title)) throw new Error('the 0-credit dialog must name the course: ' + zero.title);
  if (!/counts toward nothing/.test(zero.body)) throw new Error('the 0-credit dialog must say what 0 credits means: ' + zero.body);
  if (zero.focused !== 'confirm.no') throw new Error('the safe answer must have focus, not the one that adds the course: ' + zero.focused);
  await s.shotElement('zero-credit-check', 'dialog.confirm-check .consent-box');
  await s.evalJs(`document.querySelector('[data-key="confirm.no"]').click()`);
  await s.waitFor(`!document.querySelector('dialog.confirm-check')`);
  if (await s.evalJs(`[...document.querySelectorAll('table.courses .cid')].some(e => e.textContent === 'CSE 60567')`)) {
    throw new Error('cancelling the 0-credit check must not add the course');
  }
  // …and confirming adds it, with a line and a warning that say why it counts nothing.
  await s.evalJs(`document.querySelector('[data-key="course.new.add"]').click()`);
  await s.waitFor(`!!document.querySelector('dialog.confirm-check')`);
  await s.evalJs(`document.querySelector('[data-key="confirm.yes"]').click()`);
  await s.waitFor(`[...document.querySelectorAll('table.courses .cid')].some(e => e.textContent === 'CSE 60567')`);
  const zeroLine = await s.evalJs(`[...document.querySelectorAll('table.courses tr')].find(tr => tr.querySelector('.cid')?.textContent === 'CSE 60567')?.textContent ?? ''`);
  const zeroWarn = await s.evalJs(`document.querySelector('.warnings')?.textContent ?? ''`);
  if (!/entered with 0 credits; check the credit hours on your transcript/.test(zeroLine)) throw new Error('the 0-credit line must say why: ' + zeroLine.slice(0, 160));
  if (!/CSE 60567 is entered with 0 credits/.test(zeroWarn)) throw new Error('a 0-credit course must also raise a warning: ' + zeroWarn.slice(0, 200));
  console.log('  0-credit course added after confirming — line and warning both explain it');
  // The warning follows the screen (DGS 2026-10-05): fixed in the window's
  // corner, open, still in view at the bottom of the page; folded by its
  // Hide button — the same button as Next steps (DGS 2026-10-08), no
  // disclosure triangle — it stays folded through the next re-render.
  const warnState = async () => JSON.parse(await s.evalJs(`JSON.stringify((() => {
    const box = document.querySelector('.warnings');
    const r = box.getBoundingClientRect();
    const t = box.querySelector('[data-key="report.warnings.toggle"]');
    return { floating: box.classList.contains('floating'), position: getComputedStyle(box).position, details: box.tagName === 'DETAILS' || !!box.querySelector('summary'), folded: box.classList.contains('folded'), bodyShown: getComputedStyle(box.querySelector('.warnings-body')).display !== 'none', button: t ? t.textContent : null, expanded: t?.getAttribute('aria-expanded'), inView: r.top >= 0 && r.bottom <= window.innerHeight && r.height > 20 };
  })())`));
  await s.evalJs(`window.scrollTo(0, document.documentElement.scrollHeight)`);
  await s.settle(300);
  const floatCheck = await warnState();
  if (!floatCheck.floating || floatCheck.position !== 'fixed' || floatCheck.details || floatCheck.folded || !floatCheck.bodyShown || floatCheck.button !== 'Hide' || floatCheck.expanded !== 'true' || !floatCheck.inView) throw new Error('the warning must float in view when the page is scrolled, open, with a Hide button: ' + JSON.stringify(floatCheck));
  // Both boxes open at once are capped as a pair (blue-team review
  // 2026-10-17, U15): <html> carries `two-floats`, Next steps is at most
  // 25vh and the warnings 20vh; a box folded to its bar lifts the pair cap.
  const pairState = async () => JSON.parse(await s.evalJs(`JSON.stringify((() => {
    const h = window.innerHeight;
    const a = document.querySelector('.attention.floating')?.getBoundingClientRect().height ?? 0;
    const w = document.querySelector('.warnings.floating')?.getBoundingClientRect().height ?? 0;
    return { two: document.documentElement.classList.contains('two-floats'), steps: Math.round(a), stepsCap: Math.round(h * 0.25), warnings: Math.round(w), warningsCap: Math.round(h * 0.2) };
  })())`));
  const pair = await pairState();
  if (!pair.two || pair.steps > pair.stepsCap + 1 || pair.warnings > pair.warningsCap + 1) throw new Error('both boxes open must be capped together (25vh + 20vh): ' + JSON.stringify(pair));
  await s.evalJs(`document.querySelector('[data-key="report.warnings.toggle"]').click()`);
  await s.evalJs(`(() => { const d = document.querySelector('[data-key="milestone.advisorName"]'); d.dispatchEvent(new Event('change')); })()`);
  await s.settle();
  const warnHidden = await warnState();
  if (!warnHidden.folded || warnHidden.bodyShown || warnHidden.button !== 'Show' || warnHidden.expanded !== 'false') throw new Error('a folded warning box must stay folded after a re-render, its button saying Show: ' + JSON.stringify(warnHidden));
  const pairFolded = await pairState();
  if (pairFolded.two) throw new Error('a folded box must lift the pair cap: ' + JSON.stringify(pairFolded));
  await s.evalJs(`document.querySelector('[data-key="report.warnings.toggle"]').click(); window.scrollTo(0, 0)`);
  await s.settle(300);
  const warnShown = await warnState();
  if (warnShown.folded || !warnShown.bodyShown || warnShown.button !== 'Hide') throw new Error('Show must open the warning box again: ' + JSON.stringify(warnShown));
  if (!(await pairState()).two) throw new Error('both boxes open again must be capped as a pair again');
  console.log(`  both boxes open are capped together: Next steps ${pair.steps}/${pair.stepsCap} px, warnings ${pair.warnings}/${pair.warningsCap} px; folding one lifts the cap`);
  console.log('  the warning floats in view when the page is scrolled down; its Hide button folds it (Show opens it), and folded stays folded');
  // Next steps floats like the warnings (DGS 2026-10-08): fixed in the corner
  // above the warnings box at any scroll position, foldable to its heading
  // (remembered across a re-render).
  const floatNext = async () => JSON.parse(await s.evalJs(`JSON.stringify((() => { const box = document.querySelector('.attention'); const r = box?.getBoundingClientRect(); const w = document.querySelector('.warnings.floating')?.getBoundingClientRect(); return { floating: !!box?.classList.contains('floating'), position: box ? getComputedStyle(box).position : '', folded: !!box?.classList.contains('folded'), inView: !!r && r.top >= 0 && r.bottom <= window.innerHeight && r.height > 20, aboveWarnings: !!r && !!w && r.bottom <= w.top + 1, bodyShown: !!box?.querySelector('.attention-body') && getComputedStyle(box.querySelector('.attention-body')).display !== 'none' }; })())`));
  for (const y of ['0', 'document.documentElement.scrollHeight']) {
    await s.evalJs(`window.scrollTo(0, ${y})`);
    await s.settle(300);
    const afloat = await floatNext();
    if (!afloat.floating || afloat.position !== 'fixed' || !afloat.inView || afloat.folded || !afloat.bodyShown || !afloat.aboveWarnings) throw new Error(`Next steps must float in view above the warnings (scroll ${y}): ` + JSON.stringify(afloat));
  }
  await s.evalJs(`document.querySelector('[data-key="report.nextsteps.toggle"]').click()`);
  await s.settle();
  await s.evalJs(`(() => { const d = document.querySelector('[data-key="milestone.advisorName"]'); d.dispatchEvent(new Event('change')); })()`);
  await s.settle(300);
  const folded = await floatNext();
  if (!folded.floating || !folded.folded || folded.bodyShown) throw new Error('folded Next steps must stay folded through a re-render: ' + JSON.stringify(folded));
  await s.evalJs(`document.querySelector('[data-key="report.nextsteps.toggle"]').click(); window.scrollTo(0, 0)`);
  await s.settle(300);
  const back = await floatNext();
  if (!back.floating || back.folded) throw new Error('unfolded again, Next steps shows its list: ' + JSON.stringify(back));
  console.log('  Next steps floats above the warnings at any scroll position; folded, it stays folded through a re-render');

  // A milestone date after today (blue-team review 2026-10-17, U12): outside
  // simulation mode the box stops at today (`max`), and a stored later date —
  // loaded from a file, or typed past the picker — gets an error-style line
  // under the box, the date kept (DGS 2026-09-13: the student's word, with a
  // warning). Checked on the advisor date, the one box every record shows.
  const DATE = '[data-key="milestone.advisorIdentified"]';
  const dateBefore = await s.evalJs(`document.querySelector('${DATE}').value`);
  const futureDate = `${new Date().getFullYear() + 2}-01-15`;
  const dateState = () => s.evalJs(`JSON.stringify((() => { const d = document.querySelector('${DATE}'); const line = document.getElementById('after-today-advisorIdentified'); return { max: d.getAttribute('max') ?? '', value: d.value, invalid: d.getAttribute('aria-invalid'), described: d.getAttribute('aria-describedby') ?? '', line: line ? line.textContent : null, stored: JSON.parse(localStorage.getItem('cse-degree-audit/v1/student') || '{}').milestones?.advisorIdentified ?? null }; })())`);
  await s.evalJs(`(() => { const d = document.querySelector('${DATE}'); d.value = '${futureDate}'; d.dispatchEvent(new Event('change')); })()`);
  await s.settle();
  const future = JSON.parse(await dateState());
  console.log('  advisor date after today:', JSON.stringify(future));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(future.max) || future.max >= futureDate) throw new Error('outside simulation mode a milestone date box must stop at today: ' + JSON.stringify(future));
  if (future.value !== futureDate || future.stored !== futureDate) throw new Error('a date after today is still kept (DGS 2026-09-13): ' + JSON.stringify(future));
  if (future.invalid !== 'true' || !future.described.split(' ').includes('after-today-advisorIdentified') || !/^Advisor identified on \((?:CSE )?§2\.3\) is dated after today — the page counts it as done\. Enter it once it has happened, or use Simulate a future semester to plan it\.$/.test(future.line ?? '')) throw new Error('a date after today must get its line, tied to the box: ' + JSON.stringify(future));
  await s.shotElement('milestone-after-today', '#milestones');
  await s.evalJs(`(() => { const d = document.querySelector('${DATE}'); d.value = ${JSON.stringify(dateBefore)}; d.dispatchEvent(new Event('change')); })()`);
  await s.settle();
  const dated = JSON.parse(await dateState());
  if (dated.value !== dateBefore || dated.invalid !== null || dated.line !== null) throw new Error('the line goes with the date: ' + JSON.stringify(dated));
  console.log('  a milestone date after today: the box stops at today, the date is kept under an error-style line, gone once the date is back');
  await s.evalJs(`[...document.querySelectorAll('table.courses tr')].find(tr => tr.querySelector('.cid')?.textContent === 'CSE 60567').querySelector('button.remove').click()`);
  await s.waitFor(`![...document.querySelectorAll('table.courses .cid')].some(e => e.textContent === 'CSE 60567')`);
  await s.evalJs(`(() => { const cr = document.querySelector('[data-key="course.new.credits"]'); cr.value = '3'; cr.dispatchEvent(new Event('change')); })()`);

  // Numbers the form refuses (interface review R1, 2026-09-18). Before this,
  // `min`/`max` were decorative: a GPA of 35 was stored and the §2.2 row read
  // "Cumulative GPA 35.00 meets the 3.0 minimum" under a green Met pill, and a
  // course at 999 credits (box max 15) was accepted.
  const gpaBefore = await s.evalJs(`document.querySelector('[data-key="courses.gpa"]').value`);
  const badGpa = JSON.parse(await s.evalJs(`JSON.stringify((() => {
    const g = document.querySelector('[data-key="courses.gpa"]');
    g.value = '35';
    g.dispatchEvent(new Event('change'));
    const row = [...document.querySelectorAll('.req')].find((r) => /Cumulative GPA/.test(r.querySelector('.req-title')?.textContent ?? ''));
    return {
      kept: g.value,
      invalid: g.getAttribute('aria-invalid'),
      describedBy: g.getAttribute('aria-describedby'),
      message: document.querySelector('#courses-gpa-error')?.textContent ?? '',
      hidden: document.querySelector('#courses-gpa-error')?.classList.contains('hidden'),
      stored: (JSON.parse(localStorage.getItem('cse-degree-audit/v1/student') || '{}')).gpa ?? null,
      rowStatus: [...(row?.classList ?? [])].find((c) => c.startsWith('s-')) ?? '',
      rowText: row?.textContent ?? '',
    };
  })())`));
  console.log('  GPA 35 refused:', JSON.stringify({ ...badGpa, rowText: badGpa.rowText.slice(0, 90) }));
  if (badGpa.kept !== '35') throw new Error('the refused value must stay in the box to be corrected: ' + badGpa.kept);
  if (badGpa.invalid !== 'true' || badGpa.hidden !== false) throw new Error('a refused box must be marked invalid and show its message: ' + JSON.stringify(badGpa));
  if (!/between 0.00 and 4.00/.test(badGpa.message)) throw new Error('the message must name the range: ' + badGpa.message);
  if (badGpa.describedBy !== 'courses-gpa-error') throw new Error('the message must be the box’s description: ' + badGpa.describedBy);
  if (badGpa.stored === 35) throw new Error('a refused value must never reach localStorage');
  // The record keeps the last figure the app accepted, so §2.2 still reads
  // against THAT one — what must never happen is 35 reaching the verdict.
  if (/\b35\b/.test(badGpa.rowText.split('Handbook §')[0])) throw new Error('§2.2 must never carry the refused figure: ' + badGpa.rowText.slice(0, 160));
  await s.evalJs(`(() => { document.querySelector('[data-key="courses.gpa"]').closest('.card').id = 'shot-gpa'; })()`);
  await s.shotElement('gpa-refused', '#shot-gpa');
  // …and a figure on the scale is accepted, clearing the mark and the message.
  const goodGpa = JSON.parse(await s.evalJs(`JSON.stringify((() => {
    const g = document.querySelector('[data-key="courses.gpa"]');
    g.value = '3.5';
    g.dispatchEvent(new Event('change'));
    const g2 = document.querySelector('[data-key="courses.gpa"]');
    const row = [...document.querySelectorAll('.req')].find((r) => /Cumulative GPA/.test(r.querySelector('.req-title')?.textContent ?? ''));
    return {
      invalid: g2.getAttribute('aria-invalid'),
      shown: !document.querySelector('#courses-gpa-error')?.classList.contains('hidden'),
      stored: (JSON.parse(localStorage.getItem('cse-degree-audit/v1/student') || '{}')).gpa ?? null,
      rowStatus: [...(row?.classList ?? [])].find((c) => c.startsWith('s-')) ?? '',
    };
  })())`));
  console.log('  GPA 3.5 accepted:', JSON.stringify(goodGpa));
  if (goodGpa.invalid !== null || goodGpa.shown) throw new Error('a corrected box must lose the mark and the message: ' + JSON.stringify(goodGpa));
  if (goodGpa.stored !== 3.5 || goodGpa.rowStatus !== 's-met') throw new Error('a GPA on the scale must be stored and met: ' + JSON.stringify(goodGpa));
  // A course at 999 credits is refused at entry, not counted.
  const badCredits = JSON.parse(await s.evalJs(`JSON.stringify((() => {
    const id = document.querySelector('[data-key="course.new.id"]');
    id.value = 'CSE 60772';
    id.dispatchEvent(new Event('change'));
    const cr = document.querySelector('[data-key="course.new.credits"]');
    cr.value = '999';
    document.querySelector('[data-key="course.new.add"]').click();
    return {
      added: [...document.querySelectorAll('table.courses .cid')].some((e) => e.textContent === 'CSE 60772'),
      invalid: document.querySelector('[data-key="course.new.credits"]')?.getAttribute('aria-invalid'),
      message: document.querySelector('#new-course-credits-error')?.textContent ?? '',
    };
  })())`));
  console.log('  999 credits refused:', JSON.stringify(badCredits));
  if (badCredits.added) throw new Error('a course at 999 credits must not be added');
  if (badCredits.invalid !== 'true' || !/between 0 and 15/.test(badCredits.message)) throw new Error('the credits box must say why: ' + JSON.stringify(badCredits));
  await s.evalJs(`(() => {
    const cr = document.querySelector('[data-key="course.new.credits"]');
    cr.value = '3';
    cr.dispatchEvent(new Event('input'));
    const id = document.querySelector('[data-key="course.new.id"]');
    id.value = '';
    const g = document.querySelector('[data-key="courses.gpa"]');
    g.value = ${JSON.stringify(gpaBefore ?? '')};
    g.dispatchEvent(new Event('change'));
  })()`);

  // Conditional satisfaction (interface review R2/W-CS1, 2026-09-18). A CSE
  // 4xxxx course the LIVE rules sheet gates on the DGS's approval: the cap row
  // must read "Conditionally met" rather than "Met", the ring must carry its
  // own band, and the headline and the sticky bar must count it apart from
  // "not yet" instead of burying it in a parenthetical.
  const cond = JSON.parse(await s.evalJs(`JSON.stringify((() => {
    const id = document.querySelector('[data-key="course.new.id"]');
    id.value = 'CSE 40243';
    id.dispatchEvent(new Event('change'));
    document.querySelector('[data-key="course.new.add"]').click();
    const row = [...document.querySelectorAll('.req')].find((r) => /below the 60000 level/.test(r.querySelector('.req-title')?.textContent ?? ''));
    return {
      pill: row?.querySelector('.pill')?.textContent ?? '',
      meter: row?.querySelector('.allowance-meter')?.textContent ?? '',
      detail: row?.textContent ?? '',
      status: [...(row?.classList ?? [])].find((c) => c.startsWith('s-')) ?? '',
      headline: document.querySelector('.audit .headline, .scorehead .headline')?.textContent ?? '',
      sticky: document.querySelector('.sticky-score')?.textContent ?? '',
      keyItems: [...document.querySelectorAll('.audit .headline .key-item')].map((k) => k.textContent),
      condBand: document.querySelector('.dial .dial-arc-conditional')?.getAttribute('stroke-dasharray') ?? '',
    };
  })())`));
  console.log('  conditional satisfaction:', JSON.stringify({ ...cond, headline: cond.headline.slice(0, 80) }));
  // Since 2026-09-27 (DGS, clarity proposal 4f) an allowance is a meter, not
  // a verdict: no pill, never in the headline count. The row still carries
  // its status class and names the course waiting for approval; the
  // dashboard's conditional count is pinned by tests/conditional-satisfaction.test.ts.
  if (cond.pill !== '') throw new Error('an allowance row has no pill: ' + cond.pill);
  if (!/\d+(\.\d+)? of \d+ used/.test(cond.meter)) throw new Error('the allowance row must show its meter: ' + cond.meter);
  if (cond.status !== 's-needs_dgs_review') throw new Error('…without changing the underlying status: ' + cond.status);
  if (!/needs approval: CSE 40243/.test(cond.detail)) throw new Error('the allowance row must name the course waiting for approval: ' + cond.detail.slice(0, 200));
  // The mobile summary is display:none at this width — take the visible one.
  await s.evalJs(`(() => {
    const n = [...document.querySelectorAll('.scorehead')].find((e) => e.getBoundingClientRect().width > 0);
    if (n) n.id = 'shot-dash';
  })()`);
  await s.shotElement('dashboard-conditional', '#shot-dash');
  // The over-cap warning is its own line, not grey prose under a green pill.
  await s.evalJs(`(() => {
    for (const [id, cr] of [['CSE 40567', '3'], ['CSE 40437', '3']]) {
      const i = document.querySelector('[data-key="course.new.id"]');
      i.value = id; i.dispatchEvent(new Event('change'));
      const c = document.querySelector('[data-key="course.new.credits"]');
      c.value = cr; c.dispatchEvent(new Event('change'));
      document.querySelector('[data-key="course.new.add"]').click();
    }
  })()`);
  const overCap = JSON.parse(await s.evalJs(`JSON.stringify((() => {
    const row = [...document.querySelectorAll('.req')].find((r) => /below the 60000 level/.test(r.querySelector('.req-title')?.textContent ?? ''));
    if (row) row.id = 'shot-overcap';
    return {
      warn: [...(row?.querySelectorAll('.detail-warn') ?? [])].map((n) => n.textContent),
      pill: row?.querySelector('.pill')?.textContent ?? '',
    };
  })())`));
  console.log('  over-cap warning:', JSON.stringify(overCap));
  if (overCap.warn.length === 0 || !/beyond the allowance/.test(overCap.warn.join(' '))) {
    throw new Error('credits the cap discards must be a warning line: ' + JSON.stringify(overCap));
  }
  await s.shotElement('over-cap-warning', '#shot-overcap');
  for (const id of ['CSE 40243', 'CSE 40567', 'CSE 40437']) {
    await s.evalJs(`(() => {
      const tr = [...document.querySelectorAll('table.courses tr')].find((tr) => tr.querySelector('.cid')?.textContent === ${JSON.stringify(id)});
      tr?.querySelector('button.remove')?.click();
    })()`);
  }

  // §3.6 Transition to Computing (2026-09-10, promised 2026-08-31): a student
  // who enters a 50000-level bridge course is told the audit does not model
  // their track and sent to the DGS — a closed fold under the meters since
  // 2026-09-27 (it stood above the dial before), and NOT in the amber
  // warnings box, because nothing is wrong.
  if (await s.evalJs(`document.querySelectorAll('.track-note').length > 0`)) throw new Error('the example student is on no special track — no note should show');
  await s.evalJs(`(() => { const o = document.querySelector('[data-key="course.new.origin"]'); o.value = 'nd'; o.dispatchEvent(new Event('change')); const id = document.querySelector('[data-key="course.new.id"]'); id.value = 'CSE 50501'; id.dispatchEvent(new Event('change')); document.querySelector('[data-key="course.new.add"]').click(); })()`);
  await s.waitFor(`document.querySelectorAll('.track-note').length === 1`);
  const track = JSON.parse(await s.evalJs(`JSON.stringify((() => {
    const n = document.querySelector('.track-note');
    const dial = document.querySelector('.audit .dial') ?? document.querySelector('.audit .scorehead'); // the REPORT's dial — renderSummary draws one higher up the page
    return { text: n.textContent, beforeDial: !!(dial && (n.compareDocumentPosition(dial) & Node.DOCUMENT_POSITION_FOLLOWING)), inWarnings: !!n.closest('.warnings') };
  })())`));
  console.log('  §3.6 note:', JSON.stringify(track.text.slice(0, 96)));
  // The section moved into the note itself on 2026-10-03 (DGS: citations behind a selector in the report column).
  if (!/Transition to Computing — how your courses are counted here[\s\S]*Source: CSE Graduate Handbook §3\.6/.test(track.text)) throw new Error('the §3.6 note must name the track and its section: ' + track.text);
  if (!/DGS/.test(track.text)) throw new Error('the §3.6 note must send the student to the DGS: ' + track.text);
  if (track.beforeDial) throw new Error('the track note sits below the dial since 2026-09-27 (DGS: the score first, the explanation folded)');
  if (track.inWarnings) throw new Error('the track note is not a warning: nothing is wrong with the record');
  await s.evalJs(`(() => { const c = [...document.querySelectorAll('.card, .audit')].find(c => c.querySelector('.track-note')); c.id = 'shot-track'; })()`);
  await s.shotElement('track-note', '#shot-track');
  await s.evalJs(`[...document.querySelectorAll('table.courses tr')].find(tr => tr.querySelector('.cid')?.textContent === 'CSE 50501').querySelector('button.remove').click()`);
  await s.waitFor(`document.querySelectorAll('.track-note').length === 0`);

  // Coursework table: the term cell shows the short form with the full name as its tooltip (DGS 2026-09-07).
  const termCell = await s.evalJs(`(() => { const a = document.querySelector('table.courses td[data-label="Term"] abbr.term'); return a ? a.textContent + '|' + a.title : ''; })()`);
  console.log('  coursework term cell:', termCell);
  if (!/^(FA|SP|SU)\d{2}\|(Fall|Spring|Summer) \d{4}$/.test(termCell)) throw new Error('coursework term cell must read e.g. "FA26" with the full name as tooltip: ' + termCell);

  // The Grad Admin card (2026-09-06 evening) and its copy dialog, the DGS in cc.
  // Active only for a major event (DGS 2026-10-15, superseding 2026-09-06):
  // the example — an advisor identified, requirements met — has none, so the
  // button is inactive and says why…
  const gaCard = `JSON.stringify((() => { const card = document.querySelector('.grad-admin-request'); const b = card?.querySelector('[data-key="gradadmin.copy"]'); return { inactive: b?.getAttribute('aria-disabled') ?? null, reason: b?.getAttribute('title') ?? '', chip: card?.querySelector('.chip-note')?.textContent ?? '', hints: [...(card?.querySelectorAll('p.hint') ?? [])].map((p) => p.textContent), lines: [...(card?.querySelectorAll('.review-line') ?? [])].map((e) => e.textContent) }; })())`;
  const gaIdle = JSON.parse(await s.evalJs(gaCard));
  console.log('  Grad Admin card, the example (advisor identified):', JSON.stringify({ ...gaIdle, reason: gaIdle.reason.slice(0, 80) }));
  if (gaIdle.inactive !== 'true' || !/^Nothing for the Grad Admin to process yet\. This becomes active when there is something to process — transfer credit the DGS approved for you \((?:CSE )?§5\.2\), the qualifier completion form/.test(gaIdle.reason) || gaIdle.chip !== '0 items' || gaIdle.lines.length !== 0 || !/^Nothing to process yet — a request is needed only for transfer credit, the qualifier completion form, the MSCSE along the way or a candidacy application; your milestone dates and standing go along with it\./.test(gaIdle.hints[0] ?? '')) throw new Error('an advisor date and met requirements must leave the Grad Admin button inactive, saying why: ' + JSON.stringify(gaIdle));
  await s.shotElement('grad-admin-card-idle', '.grad-admin-request');
  // …until one happens: two finished courses complete the qualifier's
  // specialization, so the completion form is due (§4.4).
  await s.evalJs(`(() => {
    const entryYear = String(new Date().getFullYear() - 1); // the example entered last fall, a finished term
    const set = (key, value) => { const e = document.querySelector('[data-key="course.new.' + key + '"]'); e.value = value; e.dispatchEvent(new Event('change')); };
    set('origin', 'nd');
    for (const id of ['CSE 60463', 'CSE 60535']) {
      set('id', id); set('credits', '3'); set('season', 'fall'); set('year', entryYear); set('grade', 'A');
      document.querySelector('[data-key="course.new.add"]').click();
    }
  })()`);
  await s.waitFor(`document.querySelector('[data-key="gradadmin.copy"]')?.getAttribute('aria-disabled') !== 'true'`);
  const gaBusy = JSON.parse(await s.evalJs(gaCard));
  console.log('  Grad Admin card with the qualifier form due:', JSON.stringify(gaBusy));
  if (gaBusy.chip !== '1 item' || gaBusy.lines.length !== 1 || !/^Qualifier completion form — not filed yet \((?:CSE )?§4\.4\)$/.test(gaBusy.lines[0]) || !gaBusy.hints.some((h) => /^Also in the request, for the record: 1 milestone date and your standing — \d+ requirements? met, /.test(h))) throw new Error('the qualifier form makes the Grad Admin button active, the advisor date going along: ' + JSON.stringify(gaBusy));
  const ga = await s.evalJs(`document.querySelector('.grad-admin-request')?.textContent ?? ''`);
  if (!ga.includes('Ask the Grad Admin to process') || !ga.includes('Two people, two jobs')) throw new Error('Grad Admin card: ' + ga.slice(0, 120));
  await s.shotElement('grad-admin-card', '.grad-admin-request');
  await s.evalJs(`document.querySelector('[data-key="gradadmin.copy"]').click()`);
  await s.waitFor(`document.querySelector('dialog.copy-check[open]')`);
  const gaDlg = JSON.parse(await s.evalJs(`JSON.stringify((() => { const d = document.querySelector('dialog.copy-check'); return { title: d.querySelector('h2').textContent, to: [...d.querySelectorAll('.copy-to')].map(p => p.textContent), subject: d.querySelector('.copy-subject').textContent, text: d.querySelector('textarea').value.slice(0, 200), full: d.querySelector('textarea').value }; })())`));
  // The standing list (DGS 2026-09-28): every requirement with a [WORD] tag,
  // and the near deadline highlighted.
  if (!/\nMY STANDING, REQUIREMENT BY REQUIREMENT\n- \d+ requirements met, \d+ in progress, \d+ not started\.\n- 1 deadline in this semester or the next — highlighted below\.\n/.test(gaDlg.full) || !/\n\[MET\] /.test(gaDlg.full) || !/\n\[IN PROGRESS\] Qualifying examination — all components\n    !! DEADLINE NEXT SEMESTER: Due by the end of Spring \d{4} \(approximate\)\n/.test(gaDlg.full) || !/\n\[NOT STARTED\] Dissertation defense passed/.test(gaDlg.full)) throw new Error('Grad Admin request must list the standing with tags and the highlighted deadline: ' + gaDlg.full.slice(gaDlg.full.indexOf('MY STANDING'), gaDlg.full.indexOf('MY STANDING') + 400));
  console.log('  Grad Admin dialog:', gaDlg.title, '|', JSON.stringify(gaDlg.to), '|', gaDlg.subject);
  // What the request was checked with (DGS 2026-10-11, item 8): its last line.
  if (!new RegExp(`\\nChecked with: ${STAMP_RE.source}\\.\\n?$`).test(gaDlg.full)) throw new Error('the processing request must end with its "Checked with" line: ' + JSON.stringify(gaDlg.full.slice(-260)));
  console.log('  processing request ends with:', gaDlg.full.trimEnd().split('\n').pop());
  if (!gaDlg.title.startsWith('Processing request') || !gaDlg.to[0].startsWith('To: Graduate Program Administrator') || !(gaDlg.to[1] ?? '').startsWith('Cc: Director of Graduate Studies') || !/^Subject: Processing request \(degree self-check\) — Ph\.D\., entered Fall \d{4}$/.test(gaDlg.subject) || !gaDlg.text.includes('Dear Grad Admin,')) throw new Error('Grad Admin dialog: ' + JSON.stringify(gaDlg));
  // Two numbered steps for a student with no transfer credit (P-45, 2026-09-18;
  // the self-check-file step dropped 2026-09-15): open/paste, send. The Grad
  // Admin needs the original transcripts only for §5.2 transfer credit, so the
  // emphasised '*Attach copies of your transcripts' step appears (copies since 2026-10-04 — the official one goes from the registrar to the Graduate School) — second of
  // three — only when a course the DGS ruled transferable is in the request;
  // the Ph.D. example has none.
  const gaSteps = await s.evalJs(`[...document.querySelectorAll('dialog.copy-check ol.copy-steps li')].map(li => (li.querySelector('strong') ? '*' : '') + li.textContent)`);
  console.log('  Grad Admin dialog steps:', JSON.stringify(gaSteps.map((t) => t.slice(0, 70))));
  // Three since 2026-09-28: open/paste, fill in the Student line (name, netID, NDID), send.
  if (gaSteps.length !== 3 || !/^Fill in your name, netID and NDID/.test(gaSteps[1]) || !/^Send it\./.test(gaSteps[2]) || gaSteps.some((t) => /Attach copies of your transcripts/.test(t))) throw new Error('Grad Admin dialog steps (no transfer → no attach step): ' + JSON.stringify(gaSteps));
  // "Open in my email app" (DGS 2026-09-13): a mailto: to the Grad Admin with
  // the DGS in cc and the subject; the body is the message itself only while
  // the address stays short enough for every client.
  const gaMail = await s.evalJs(`document.querySelector('dialog.copy-check [data-key="copy.email"]')?.getAttribute('href') ?? ''`);
  if (!/^mailto:csalmons%40nd\.edu\?cc=tjung%40nd\.edu&subject=Processing%20request/.test(gaMail)) throw new Error('the Grad Admin dialog must open the email app with To, Cc and Subject: ' + gaMail.slice(0, 120));
  if (!/&body=/.test(gaMail)) throw new Error('the mailto must carry a body');
  console.log('  Grad Admin dialog: "Open in my email app" → ' + decodeURIComponent(gaMail.slice(0, 80)) + '…');
  const gaLead = await s.evalJs(`document.querySelector('dialog.copy-check .copy-lead strong')?.textContent ?? ''`);
  if (!/copied to your clipboard\.$|blocked the clipboard\.$/.test(gaLead)) throw new Error('Grad Admin dialog must lead with the copied-to-clipboard line: ' + gaLead);
  const gaText = await s.evalJs(`document.querySelector('dialog.copy-check textarea').value`);
  if (!gaText.includes('(You may edit anything above this line)') || !gaText.includes('(DO NOT MODIFY ANYTHING BELOW THIS LINE)') || !gaText.includes('[MET] Cumulative GPA of at least 3.0\n')) throw new Error('Grad Admin text must carry the markers and the standing list: ' + gaText.slice(0, 300));
  // No handbook sections in it (DGS 2026-10-28: "Grad Admin is familiar with the handbook").
  // (The "Checked with" stamp still names the handbook edition: that is no citation.)
  if (/§/.test(gaText)) throw new Error('the Grad Admin text must cite no section: ' + gaText.slice(Math.max(0, gaText.indexOf('§') - 80), gaText.indexOf('§') + 40));
  // The one action is the major event; the advisor date goes along, for the record (DGS 2026-10-15).
  if (!/\nACTION REQUESTED\n1\. Tell me what you need for the qualifier completion form — [^\n]*\n\nThank you!/.test(gaText) || !/\nMILESTONE DATES, FOR THE RECORD\n- Advisor identified: \d{4}-\d{2}-\d{2}, as I entered it\n/.test(gaText) || /Record the milestone|Keep my standing/.test(gaText)) throw new Error('the request asks only for the major event; milestone dates go along: ' + gaText.slice(gaText.indexOf('ACTION REQUESTED'), gaText.indexOf('ACTION REQUESTED') + 300));
  await s.shot('grad-admin-dialog');
  await s.evalJs(`document.querySelector('[data-key="copy.ok"]').click()`);
  await s.waitFor(`!document.querySelector('dialog.copy-check')`);

  // The rule on the output side (2026-09-03): since 2026-10-03 it sits in each
  // card's Details, and names its document in full (DGS: CSE handbook,
  // Academic Code or DGS Handbook).
  await s.evalJs(`document.querySelector('details.req-more > summary').click()`);
  const quote = await s.evalJs(`document.querySelector('details.req-more[open] .rule-quote')?.textContent ?? ''`);
  if (!/^(?:CSE Graduate Handbook|Graduate School Academic Code|Graduate School DGS Handbook) §/.test(quote)) throw new Error('a card’s Details must give the rule with its document named: ' + quote.slice(0, 80));
  console.log('  a card’s Details gives the rule:', quote.slice(0, 60));
  await s.shot('rule-quote');
  await s.evalJs(`document.querySelector('details.req-more[open] > summary').click()`); // close it again

  // Courses still "In progress" after their semester ended (blue-team review
  // 2026-10-17, U21). Reset follows, so the record this loads is not kept.
  await checkStaleGrades(s);

  // The program is chosen in the opening dialog; Reset brings it back (DGS
  // 2026-09-22). Reset empties the record; the MSCSE record below is then
  // loaded from a file over the fresh MSCSE one.
  await s.evalJs(`(() => { window.__confirm = window.confirm; window.confirm = () => true; document.querySelector('[data-key="tools.reset"]').click(); })()`);
  await s.waitFor(`document.querySelector('.consent-overlay')`);
  await s.evalJs(`(() => {
    document.querySelector('[data-key="consent.program.mscse"]').click();
    document.querySelector('[data-key="consent.ack"]').click();
    document.querySelector('.consent-overlay button.btn').click();
  })()`);
  await s.waitFor(`!document.querySelector('.consent-overlay')`);
  // The earlier degrees, on the page since 2026-10-08 (Option 1).
  await s.evalJs(`document.querySelector('[data-key="earlier.answer"]')?.click()`); // a fresh record folds the questions (UI review item 2, 2026-10-09)
  for (const k of ['earlier.bachelors.elsewhere', 'earlier.graduate.none', 'earlier.done']) await s.evalJs(`document.querySelector('[data-key="${k}"]')?.click()`);
  await s.evalJs(`(() => { window.confirm = window.__confirm; })()`);
  await s.waitFor(
    `[...document.querySelectorAll('.req-title')].some(e => e.textContent.includes('project'))`,
  );
  await s.shot('app-example-ms');

  // A mid-degree MSCSE record (the old MSCSE example, loaded as a saved file
  // since "Load example" went, 2026-10-17): an MSCSE report must carry no
  // Ph.D. requirement — one example for both once showed an MSCSE student a
  // dissertation and a qualifying examination (DGS 2026-09-18).
  await loadExampleRecord(s, 'mscse');
  const msEx = JSON.parse(await s.evalJs(`JSON.stringify((() => {
    const txt = document.body.innerText;
    return {
      program: JSON.parse(localStorage.getItem('cse-degree-audit/v1/student') ?? '{}').program ?? '',
      courses: [...document.querySelectorAll('table.courses .cid')].map((e) => e.textContent),
      // "candidacy" alone is the MSCSE's own word since 2026-10-04 (the
      // Application for Admission to Master's Degree Candidacy): look for the
      // Ph.D.'s kinds of candidacy instead.
      phdWords: /dissertation|Qualifying Examination|doctoral candidacy|Oral Candidacy Exam/i.test(txt),
      futureGrades: (txt.match(/is still counted, but check the term/g) || []).length,
      rows: [...document.querySelectorAll('.req-title')].map((e) => e.textContent).join(' | '),
    };
  })())`));
  if (msEx.phdWords) throw new Error('the MSCSE example must not put Ph.D. requirements on the page: ' + msEx.rows.slice(0, 200));
  if (!msEx.courses.includes('CSE 68902')) throw new Error('the MSCSE example must carry the §3.4 project course: ' + JSON.stringify(msEx.courses));
  if (msEx.courses.includes('CSE 98900')) throw new Error('the MSCSE example is still the Ph.D. record: ' + JSON.stringify(msEx.courses));
  if (msEx.futureGrades > 0) throw new Error('the example gives a final grade to a semester that has not happened');
  console.log('  an MSCSE record shows an MSCSE report (' + msEx.courses.length + ' courses, project included, no Ph.D. rows)');
  await s.shot('app-example-mscse');

  const summary = await s.evalJs(
    `document.querySelector('.headline')?.textContent + ' | ' + document.querySelector('.dial-text')?.textContent`,
  );
  console.log('  M.S. summary:', summary);
  if (!/\d+\/\d+/.test(summary ?? '')) throw new Error('score dial did not render');

  // Privacy wording against measured behaviour, and Clear where someone who has
  // finished reading actually is (interface review R6/R7, 2026-09-18).
  const privacy = JSON.parse(await s.evalJs(`JSON.stringify((() => {
    const txt = document.body.textContent ?? '';
    return {
      overstated: /only network request|to any third party/.test(txt),
      approved: /Your coursework never leaves this browser/.test(txt),
      ferpa: /FERPA-protected education records remain under your control/.test(txt),
      shared: /On a shared or public computer, clear your record before you walk away/.test(txt),
      // The finish card is gone (DGS 2026-09-22): Reset lives in the storage
      // card beside Print and in the tools row; the advisor summary button
      // sits before Reset in that row ("Load example" led it until 2026-10-17).
      finishCard: document.querySelector('.finish-card') ? 'still there' : '',
      clearAtEnd: !!document.querySelector('[data-key="save.reset"]'),
      clearAtTop: !!document.querySelector('[data-key="tools.reset"]'),
      toolsOrder: [...document.querySelectorAll('.masthead-tools .btn')].map((b) => b.getAttribute('data-key')).join(','),
    };
  })())`));
  console.log('  privacy + shared computers:', JSON.stringify({ ...privacy, finishCard: privacy.finishCard.slice(0, 60) }));
  if (privacy.overstated) throw new Error('the overstated privacy claims must be gone');
  if (!privacy.approved || !privacy.ferpa) throw new Error('the approved wording and the FERPA sentence must both be there');
  if (!privacy.shared) throw new Error('the shared-computer line must be in the save card');
  if (privacy.finishCard) throw new Error('the finish card must be gone (DGS 2026-09-22)');
  if (!privacy.clearAtEnd || !privacy.clearAtTop) throw new Error('Reset must be in the storage card and the tools row: ' + JSON.stringify(privacy));
  // "Simulate a future semester" sits between the advisor summary and Reset
  // (simulation mode, DGS 2026-10-09; in the mode that slot is a second Exit).
  if (privacy.toolsOrder !== 'tools.save,tools.load,tools.print,save.copy,tools.simulate,tools.reset') throw new Error('tools row order: ' + privacy.toolsOrder);
  if (await s.evalJs(`!![...document.querySelectorAll('button')].find((b) => b.textContent === 'Load example')`)) throw new Error('"Load example" is gone (DGS 2026-10-17)');
  // The who-to-contact card sits top right at desk width, as on the course
  // rules page (DGS 2026-09-30); one card in the document.
  const contactPlace = JSON.parse(await s.evalJs(`JSON.stringify({ inMasthead: !!document.querySelector('.masthead .contact-card'), atEnd: !!document.querySelector('footer .contact-card'), cards: document.querySelectorAll('.contact-card').length, win: innerWidth })`));
  if (!contactPlace.inMasthead || contactPlace.atEnd || contactPlace.cards !== 1) throw new Error('the who-to-contact card belongs top right at desk width, once: ' + JSON.stringify(contactPlace));
  await s.shotElement('masthead-contacts', '.masthead');

  // The example student is gone (DGS 2026-10-17: "remove 'Load example'
  // button and the function"); a record that still holds its rows loses them
  // when it is opened ("Remove automatically"), its advisor and approval
  // tick with them, the student's own course stays, and the page says so
  // once (W-CL528). The record is saved without them at once.
  const legacy = exampleRecord('phd');
  legacy.courses = [...legacy.courses.map((c) => ({ ...c, fromExample: true })), { courseId: 'CSE 60772', title: 'Machine Learning', credits: 3, term: legacy.courses[0].term, grade: 'A', origin: 'nd', typedByStudent: true }];
  await s.evalJs(`localStorage.setItem('cse-degree-audit/v1/student', ${JSON.stringify(JSON.stringify(legacy))})`);
  await s.open(baseUrl);
  await s.waitFor(`[...document.querySelectorAll('table.courses .cid')].some((e) => e.textContent === 'CSE 60772')`);
  const after = JSON.parse(await s.evalJs(`JSON.stringify((() => ({
    ids: [...document.querySelectorAll('table.courses .cid')].map((e) => e.textContent),
    stored: (JSON.parse(localStorage.getItem('cse-degree-audit/v1/student') || '{}').courses ?? []).map((c) => c.courseId),
    flags: (JSON.parse(localStorage.getItem('cse-degree-audit/v1/student') || '{}').courses ?? []).filter((c) => 'fromExample' in c).length,
    advisor: JSON.parse(localStorage.getItem('cse-degree-audit/v1/student') || '{}').milestones?.advisorName ?? null,
    note: [...document.querySelectorAll('.toast')].map((t) => t.textContent).find((t) => /example/.test(t)) ?? '',
  }))())`));
  console.log('  an old record with the example’s rows, opened:', JSON.stringify(after));
  if (after.ids.join() !== 'CSE 60772' || after.stored.join() !== 'CSE 60772' || after.flags !== 0) throw new Error('opening a record must take out the example’s rows and keep the student’s own: ' + JSON.stringify(after));
  if (after.advisor !== null) throw new Error('the example’s advisor goes with its rows: ' + after.advisor);
  if (after.note !== '8 example course rows were removed from this record: the example student is no longer part of the app.') throw new Error('the page says so once (W-CL528): ' + after.note);
  await s.evalJs(`localStorage.clear()`);

  // Printing opens the footer's closed disclosure ("Where the rules come
  // from") and closes it again afterwards
  // (trim review 2026-09-18, P-71): a closed <details> prints as a bare
  // heading with nothing under it. The report's folds print as the screen has
  // them (DGS 2026-10-10, item 1: "Let paper match the screen"): printing
  // leaves them alone, and under print media a closed one shows its heading
  // only — Firefox printed every closed fold open until style-app.css said so. The
  // handler listens for beforeprint / afterprint, so dispatching the events
  // stands in for the print dialog headless Chrome cannot show. One report
  // fold is left open beforehand, as a student would leave it.
  await checkStamps(s);
  const printFold = JSON.parse(await s.evalJs(`JSON.stringify((() => {
    const all = () => [...document.querySelectorAll('footer.legal details, #report details')];
    const original = all().map((d) => d.open);
    const kept = all().findIndex((d) => d.matches('#report .req-more'));
    all().forEach((d, i) => { d.open = i === kept; }); // the student's one open fold; the rest closed → opened → closed again
    const before = all().map((d) => d.open);
    window.dispatchEvent(new Event('beforeprint'));
    const during = all().map((d) => d.open);
    window.dispatchEvent(new Event('afterprint'));
    const after = all().map((d) => d.open);
    all().forEach((d, i) => { d.open = original[i]; });
    const footer = all().map((d) => d.matches('footer.legal details'));
    return { n: before.length, kept, footer, report: document.querySelectorAll('#report details').length, before, during, after };
  })())`));
  console.log(`  disclosures around printing (footer and report): ${printFold.before.filter(Boolean).length} open of ${printFold.n} → ${printFold.during.filter(Boolean).length} open while printing (the footer's, and the student's own) → ${printFold.after.filter(Boolean).length} open after`);
  if (printFold.n < 2 || printFold.report < 1 || printFold.kept < 0) throw new Error('expected the footer disclosure and the report\'s folds: ' + JSON.stringify(printFold));
  const wrongWhilePrinting = printFold.during.filter((open, i) => open !== (printFold.footer[i] || printFold.before[i])).length;
  if (wrongWhilePrinting > 0) throw new Error('beforeprint must open the footer\'s disclosure (P-71) and leave every report fold as the student had it (DGS 2026-10-10): ' + JSON.stringify(printFold));
  if (printFold.after.join() !== printFold.before.join()) throw new Error('afterprint must return the disclosures to the state the student had (P-71): ' + JSON.stringify(printFold));
  // Under print media a closed report fold shows only its heading, in every engine.
  await s.send('Emulation.setEmulatedMedia', { media: 'print' });
  await s.settle(100);
  const foldPrint = JSON.parse(await s.evalJs(`JSON.stringify((() => {
    const all = [...document.querySelectorAll('#report details')];
    const shown = all.find((d) => d.getClientRects().length > 0 && d.querySelector('.rule-quote'));
    const folds = shown ? [shown, ...all.filter((d) => d !== shown)] : all;
    folds.forEach((d, i) => { d.open = i === 0; });
    // Firefox prints a closed <details> open whatever the screen does, so the
    // closed folds are judged by the print rule itself (display: none on all
    // but the summary) — and a bare text node, which no rule can hide, fails.
    const inked = (d) => [...d.children].filter((c) => c.tagName !== 'SUMMARY' && getComputedStyle(c).display !== 'none' && c.getClientRects().length > 0).length;
    const unhidden = (d) => [...d.childNodes].filter((c) => (c.nodeType === 3 ? c.textContent.trim() !== '' : c.nodeType === 1 && c.tagName !== 'SUMMARY' && getComputedStyle(c).display !== 'none')).length;
    // Paper ends where the content does: no bottom padding (it printed a blank last sheet).
    const r = { open: inked(folds[0]), closedShowing: folds.slice(1).filter((d) => unhidden(d) > 0).length, closed: folds.length - 1, padBottom: getComputedStyle(document.querySelector('#app')).paddingBottom };
    folds.forEach((d) => { d.open = false; });
    return r;
  })())`));
  await s.send('Emulation.setEmulatedMedia', { media: '' });
  await s.settle(100);
  if (foldPrint.open < 1 || foldPrint.closedShowing > 0) throw new Error('on paper an open report fold prints its text and a closed one its heading only: ' + JSON.stringify(foldPrint));
  if (foldPrint.padBottom !== '0px') throw new Error(`on paper the page must end where the report does (a blank last sheet): #app padding-bottom ${foldPrint.padBottom}`);
  console.log(`  report folds on paper: the open one prints its text; ${foldPrint.closed} closed ones print their heading only`);
  await checkContactWhilePrinting(s, 'index.html');

  await driveSimulation(s, baseUrl);
  await driveAppEmbed(s, baseUrl);
}

// Every result is stamped (DGS 2026-10-11, item 8): the footer and the print
// header carry the same "Checked with" line, and "Save to a file" writes the
// stamp — the same fingerprint, the date checked and every row's verdict as
// the page shows it — between savedAt and the record. The download is caught
// in the page, as the simulation save's is.
/** The example record with two of its in-progress courses moved to last
 * year's fall (the example's own IP courses sit in the current semester):
 * ONE warning names the ended semester, both courses and both fix paths,
 * and the Next steps list carries the same as a step linked to the
 * Transcripts card (blue-team review 2026-10-17, U21). */
async function checkStaleGrades(s) {
  const record = exampleRecord('phd');
  const lastFall = { season: 'fall', year: Number(localToday().slice(0, 4)) - 1 };
  for (const c of record.courses) if (c.courseId === 'CSE 60770' || c.courseId === 'CSE 60876') c.term = lastFall;
  await loadExampleRecord(s, 'phd', record);
  const want = `Fall ${lastFall.year} has ended and CSE 60770, CSE 60876 still read In progress — import your updated Notre Dame transcript (Import again) or set each course’s grade.`;
  const stale = JSON.parse(await s.evalJs(`JSON.stringify((() => {
    const step = document.querySelector('[data-key="report.nextsteps"] li[data-step="grades.update"]');
    return {
      lines: [...document.querySelectorAll('.warnings .warning-line')].map((e) => e.textContent.replace(/^⚠ /, '')),
      step: step?.textContent ?? '',
      href: step?.querySelector('a')?.getAttribute('href') ?? '',
      card: document.getElementById('transcripts')?.classList.contains('external-card') ?? false,
      importButton: !!document.querySelector('#transcripts [data-key="import.nd"]'),
    };
  })())`));
  if (!stale.lines.includes(want)) throw new Error('an ended semester with In progress courses must be warned about: ' + JSON.stringify(stale.lines));
  if (stale.lines.filter((l) => /has ended and/.test(l)).length !== 1) throw new Error('one warning per ended semester: ' + JSON.stringify(stale.lines));
  if (stale.href !== '#transcripts' || stale.step !== `Fall ${lastFall.year} has ended and CSE 60770, CSE 60876 still read In progress — import your updated Notre Dame transcript (Import again, in the Transcripts card) or set each course’s grade under Coursework.`) throw new Error('the Next steps list must carry the same step, linked to the Transcripts card: ' + JSON.stringify(stale));
  if (!stale.card || !stale.importButton) throw new Error('the Transcripts card must carry the id the step links to, with the import button inside it: ' + JSON.stringify(stale));
  await s.shotElement('stale-grades-warning', '.warnings');
  await s.shotElement('stale-grades-step', '[data-key="report.nextsteps"]');
  console.log('  courses still In progress after their semester ended: one warning, one step — ' + want);
}

async function checkStamps(s) {
  const lines = JSON.parse(await s.evalJs(`JSON.stringify({
    footer: document.querySelector('footer.legal .legal-stamp')?.textContent ?? '',
    print: document.querySelector('.print-header .print-stamp')?.textContent ?? '',
  })`));
  console.log('  footer:', lines.footer);
  const m = new RegExp(`^Checked with: ${STAMP_RE.source}\\.$`).exec(lines.footer);
  if (!m) throw new Error('the footer must say what the results were checked with: ' + JSON.stringify(lines.footer));
  if (lines.print !== lines.footer) throw new Error('the print header must carry the footer’s "Checked with" line: ' + JSON.stringify(lines));
  await s.shotElement('footer-stamp', 'footer.legal');
  const saved = JSON.parse(await s.evalJs(`(async () => {
    let blob;
    const click = HTMLAnchorElement.prototype.click;
    const make = URL.createObjectURL;
    const files = [];
    HTMLAnchorElement.prototype.click = function () { if (this.download) { files.push(this.download); return; } return click.call(this); };
    URL.createObjectURL = function (b) { blob = b; return make.call(URL, b); };
    try {
      document.querySelector('[data-key="save.file"]').click();
      return JSON.stringify({ files, text: blob ? await blob.text() : null });
    } finally {
      HTMLAnchorElement.prototype.click = click;
      URL.createObjectURL = make;
    }
  })()`));
  const payload = saved.text ? JSON.parse(saved.text) : null;
  const keys = payload ? Object.keys(payload) : [];
  const st = payload?.stamp;
  console.log('  saved file:', JSON.stringify({ files: saved.files, keys, fingerprint: st?.rules?.fingerprint, app: st?.app?.commit, auditDate: st?.auditDate, verdicts: st ? Object.keys(st.verdicts).length : 0 }));
  if (keys.join() !== 'savedAt,stamp,student') throw new Error('the saved file must hold savedAt, the stamp and the record, in that order: ' + keys.join());
  if (st.rules.fingerprint !== m[1] || !/^\d{4}-\d{2}-\d{2}$/.test(st.auditDate) || !/^[0-9a-f]{7}$/.test(st.app.commit) || st.handbook.edition === '' || Object.keys(st.verdicts).length < 10 || !Object.values(st.verdicts).every((v) => /^(met|unmet|in_progress|needs_dgs_review|cannot_evaluate|not_applicable)\b/.test(v))) throw new Error('the saved stamp must carry the footer’s fingerprint, the date, the build, the handbook and every row’s verdict: ' + JSON.stringify(st).slice(0, 400));
  // The file is named for the program and the day the check was made — the
  // stamp's auditDate — so copies saved on different days are told apart
  // (blue-team review 2026-10-17, U24): cse-degree-audit-phd-2026-10-21.json.
  const expectedName = `cse-degree-audit-${payload.student.program}-${st.auditDate}.json`;
  if (saved.files.length !== 1 || saved.files[0] !== expectedName) throw new Error(`the record file must be named for the program and the day checked (${expectedName}): ` + JSON.stringify(saved.files));
}

// E2E: simulation mode (DGS 2026-10-09; driven end to end since the review
// fix of 2026-10-09, and through the whole mode since the closing verification
// the same day). The record is the example. The real record's storage key
// must stay byte-identical through entering, moving the semester two years
// on, planning courses in the copy, saving the plan to a file, a reload,
// Start over and Exit, while the simulation's own key holds the plan; the
// mode must be marked on the page — on a phone too, beside the report
// headline, where the sticky bar hides, and in the frame; nothing that sends
// may be active inside it, and Next steps must say so in ONE step; a saved
// plan loaded OUTSIDE the mode reopens the mode and leaves the record alone;
// the course-rules page is not touched by a stored simulation.
async function driveSimulation(s, baseUrl) {
  const LS = 'cse-degree-audit/v1/student';
  const SIM = 'cse-degree-audit/v1/simulation';
  await s.open(baseUrl);
  await s.evalJs(`localStorage.clear()`);
  await s.open(baseUrl);
  await s.waitFor(`document.querySelectorAll('.req').length > 5`);
  // The mid-degree Ph.D. record (scripts/e2e/example-record.mjs) as the record.
  await loadExampleRecord(s, 'phd');
  const realBefore = await s.evalJs(`localStorage.getItem('${LS}')`);
  if (!realBefore) throw new Error('the record must be saved before the simulation starts');
  const outside = JSON.parse(await s.evalJs(`JSON.stringify({
    title: document.title,
    courses: document.querySelectorAll('table.courses .cid').length,
    banner: !!document.querySelector('.simulation-banner'),
    tools: !!document.querySelector('[data-key="tools.simulate"]'),
    coursework: !!document.querySelector('[data-key="coursework.simulate"]'),
    marked: document.documentElement.classList.contains('simulation'),
    chips: document.querySelectorAll('.chip-simulation').length,
    sim: localStorage.getItem('${SIM}'),
  })`));
  if (outside.banner || !outside.tools || !outside.coursework || outside.marked || outside.chips !== 0 || outside.sim !== null) throw new Error('outside the mode: ' + JSON.stringify(outside));
  // The report's pills and deadline chips, row by row: what a semester change must move.
  const reportState = () => s.evalJs(`JSON.stringify([...document.querySelectorAll('.audit .req')].map((r) => [r.id, r.querySelector('.pill')?.textContent ?? '', [...r.querySelectorAll('.chip.deadline')].map((c) => c.textContent).join('|')]))`);
  // Every sending or importing button, by data-key: inactive with a reason
  // (aria-disabled + title), never a bare disabled; 'absent' when not rendered.
  const inertButtons = (keys) => s.evalJs(`JSON.stringify(Object.fromEntries(${JSON.stringify(keys)}.map((k) => { const b = document.querySelector('[data-key="' + k + '"]'); return [k, b ? { disabled: b.getAttribute('aria-disabled'), reason: b.getAttribute('title') ?? '' } : 'absent']; })))`);

  // The way in, from the tools row.
  await s.evalJs(`document.querySelector('[data-key="tools.simulate"]').click()`);
  await s.waitFor(`document.querySelector('.simulation-banner')`);
  await s.settle();
  const entered = JSON.parse(await s.evalJs(`JSON.stringify((() => {
    const sim = JSON.parse(localStorage.getItem('${SIM}') ?? 'null');
    return {
      lead: document.querySelector('.simulation-lead')?.textContent ?? '',
      marked: document.documentElement.classList.contains('simulation'),
      title: document.title,
      focused: document.activeElement?.dataset?.key ?? '',
      picked: document.querySelector('[data-key="simulation.term"]')?.selectedOptions[0]?.textContent ?? '',
      term: sim && sim.term ? sim.term : null,
      simCourses: sim && sim.student ? sim.student.courses.length : -1,
      mastheadChip: !!document.querySelector('.masthead .chip-simulation'),
      headlineChip: !!document.querySelector('.audit .scorehead .headline .chip-simulation'),
      standing: (document.body.textContent.match(/simulated current semester: (Spring|Summer|Fall) \\d{4}/) ?? [''])[0],
      status: document.querySelector('.visually-hidden[role="status"]')?.textContent ?? '',
      exits: ['simulation.exit', 'tools.simulate.exit', 'simulation.strip.exit'].filter((k) => !document.querySelector('[data-key="' + k + '"]')),
      resetLabel: document.querySelector('[data-key="tools.reset"]')?.textContent ?? '',
      wayIn: !!document.querySelector('[data-key="tools.simulate"], [data-key="coursework.simulate"]'),
      real: localStorage.getItem('${LS}'),
    };
  })())`));
  entered.inert = JSON.parse(await inertButtons(['gradadmin.copy', 'save.copy', 'save.summary', 'import.nd', 'review.copy']));
  console.log('  entered:', JSON.stringify({ ...entered, real: entered.real === realBefore ? 'unchanged' : 'CHANGED' }));
  if (!/^Simulation mode — this page is pretending it is (Spring|Summer|Fall) \d{4}; nothing here is your record\.$/.test(entered.lead)) throw new Error('the banner must name the semester: ' + entered.lead);
  if (!entered.picked || !entered.lead.includes(entered.picked) || !entered.title.startsWith('Simulating ' + entered.picked)) throw new Error('the banner, the picker and the tab title must name the same semester: ' + JSON.stringify([entered.lead, entered.picked, entered.title]));
  if (entered.title !== 'Simulating ' + entered.picked + ' — ' + outside.title) throw new Error('the tab title must be the original title behind the semester: ' + JSON.stringify([entered.title, outside.title]));
  if (!entered.marked || !entered.mastheadChip || !entered.headlineChip) throw new Error('the mode must be marked on the page: ' + JSON.stringify(entered));
  if (entered.standing !== 'simulated current semester: ' + entered.picked) throw new Error('the Your standing chip must name the simulated semester: ' + JSON.stringify([entered.standing, entered.picked]));
  if (entered.focused !== 'simulation.term') throw new Error('entering must focus the semester picker, not ' + entered.focused);
  if (!/^Simulation mode on: this page is pretending it is /.test(entered.status)) throw new Error('entering must be announced: ' + entered.status);
  // In the mode a milestone date box has no `max` (U12): a plan is forward-looking (2026-10-09).
  if (await s.evalJs(`document.querySelector('[data-key="milestone.advisorIdentified"]').hasAttribute('max')`)) throw new Error('in simulation mode a milestone date box must not stop at today');
  if (!entered.term || entered.simCourses !== outside.courses) throw new Error('the simulation key must hold the semester and a copy of the record: ' + JSON.stringify(entered));
  for (const [k, v] of Object.entries(entered.inert)) {
    if (v === 'absent' || v.disabled !== 'true' || !/simulation mode/.test(v.reason)) throw new Error(`${k} must be inactive in the mode (aria-disabled="true") with a reason that names the mode, got ${JSON.stringify(v)}`);
  }
  if (entered.exits.length > 0 || !/^Start the simulation over/.test(entered.resetLabel) || entered.wayIn) throw new Error('the three ways out, the renamed Reset, no way in: ' + JSON.stringify(entered));
  if (entered.real !== realBefore) throw new Error('entering the mode must not touch the real record’s key');
  await s.shot('simulation-mode');
  await s.shotElement('simulation-banner', '.simulation-banner');

  // Two years on, same season: the report must move (a deadline comes due or
  // passes, a pill changes), the page must say so, and the record must not.
  const reportAtEntry = await reportState();
  const later = await s.evalJs(`(() => {
    const sel = document.querySelector('[data-key="simulation.term"]');
    const [season, year] = sel.selectedOptions[0].textContent.split(' ');
    const want = season + ' ' + (Number(year) + 2);
    const o = [...sel.options].find((x) => x.textContent === want);
    if (!o) throw new Error('the picker has no option ' + want + ': ' + [...sel.options].map((x) => x.textContent).join(', '));
    sel.value = o.value;
    sel.dispatchEvent(new Event('change'));
    return want;
  })()`);
  await s.waitFor(`(document.querySelector('.simulation-lead')?.textContent ?? '').includes(${JSON.stringify(later)})`);
  await s.settle();
  const reportLater = await reportState();
  const moved = JSON.parse(await s.evalJs(`JSON.stringify({
    title: document.title,
    status: document.querySelector('.visually-hidden[role="status"]')?.textContent ?? '',
    standing: (document.body.textContent.match(/simulated current semester: (Spring|Summer|Fall) \\d{4}/) ?? [''])[0],
    year: document.querySelector('[data-key="course.new.year"]')?.value ?? '',
    real: localStorage.getItem('${LS}'),
  })`));
  const changedRows = JSON.parse(reportLater).filter((row, i) => JSON.stringify(row) !== JSON.stringify(JSON.parse(reportAtEntry)[i]));
  console.log('  moved to ' + later + '; report rows that changed:', JSON.stringify(changedRows));
  if (changedRows.length === 0) throw new Error('moving the simulation two years on must change the report (a pill or a deadline chip): ' + reportLater);
  if (!moved.title.startsWith('Simulating ' + later) || moved.standing !== 'simulated current semester: ' + later) throw new Error('the title and the standing chip must follow the semester: ' + JSON.stringify(moved));
  if (!moved.status.startsWith('Simulated current semester: ' + later)) throw new Error('a semester change must be announced: ' + moved.status);
  if (moved.year !== later.split(' ')[1]) throw new Error('the course form’s year must default to the simulated year: ' + JSON.stringify([moved.year, later]));
  if (moved.real !== realBefore) throw new Error('changing the semester must not touch the real record’s key');
  // Two years on, the example's in-progress courses sit in an ended semester:
  // the warning names them without "Import again", inert in the mode, and
  // the Next steps item links to Coursework (DGS 2026-10-25).
  const simStale = JSON.parse(await s.evalJs(`JSON.stringify({
    lines: [...document.querySelectorAll('.warnings .warning-line')].map((e) => e.textContent.replace(/^⚠ /, '')).filter((l) => /has ended and/.test(l)),
    href: document.querySelector('[data-key="report.nextsteps"] li[data-step="grades.update"] a')?.getAttribute('href') ?? '',
  })`));
  if (simStale.lines.length === 0 || !simStale.lines.every((l) => /^In this simulation, (Spring|Summer|Fall) \d{4} has ended and .* still reads? In progress — give (it|each course) the grade you expect under Coursework\.$/.test(l)) || simStale.href !== '#coursework')
    throw new Error('in simulation mode an ended semester’s In progress courses must be warned about without “Import again”: ' + JSON.stringify(simStale));
  await s.shotElement('simulation-stale-grades', '.warnings');
  console.log('  simulation, ended semester: ' + simStale.lines[0]);
  await checkCardStripes(s, ['bad', 'line']); // two years on, the example has overdue cards

  // Plan two courses in the simulated semester: one the sheet knows, with the
  // grade expected (A) — it must COUNT; and one the sheet does not know — it
  // brings the review card, whose send button must be inert like the others.
  const [laterSeason, laterYear] = later.split(' ');
  const plan = async (id, grade) => {
    await s.evalJs(`(() => {
      const set = (k, v) => { const e = document.querySelector('[data-key="' + k + '"]'); e.value = v; e.dispatchEvent(new Event('input')); e.dispatchEvent(new Event('change')); };
      set('course.new.id', ${JSON.stringify(id)});
      set('course.new.credits', '3');
      set('course.new.season', ${JSON.stringify(laterSeason.toLowerCase())});
      set('course.new.year', ${JSON.stringify(laterYear)});
      set('course.new.grade', ${JSON.stringify(grade)});
      document.querySelector('[data-key="course.new.add"]').click();
    })()`);
    await s.waitFor(`[...document.querySelectorAll('table.courses .cid')].some((e) => e.textContent === ${JSON.stringify(id)})`);
  };
  await plan('CSE 60772', 'A');
  await plan('MATH 60610', 'A');
  await s.waitFor(`document.querySelector('#dgs-review .cid')`); // the card is always shown (2026-10-16); its first course
  await s.settle();
  const planned = JSON.parse(await s.evalJs(`JSON.stringify((() => {
    const sim = JSON.parse(localStorage.getItem('${SIM}') ?? 'null');
    const tr = [...document.querySelectorAll('table.courses tr')].find((tr) => tr.querySelector('.cid')?.textContent === 'CSE 60772');
    return {
      row: sim && sim.student.courses.find((c) => c.courseId === 'CSE 60772'),
      counts: !!tr?.querySelector('td.counts .mark-counts'),
      countsText: tr?.querySelector('td.counts')?.textContent ?? '',
      planNote: tr?.querySelector('td.counts .plan-note')?.textContent ?? null,
      problemLinks: document.querySelectorAll('.req-problem').length,
      reviewed: !!document.querySelector('#dgs-review .cid'),
      reviewSentence: /In simulation mode nothing is sent: these are the courses this plan would put before the DGS/.test(document.querySelector('#dgs-review')?.textContent ?? ''),
      gradAdminSentence: /In simulation mode nothing is sent/.test(document.querySelector('#grad-admin')?.textContent ?? ''),
      cardChips: ['#dgs-review', '#grad-admin'].map((id) => !!document.querySelector(id + ' .chip-simulation')),
      steps: [...document.querySelectorAll('[data-key="report.nextsteps"] ol.next-steps li')].map((li) => ({ text: li.textContent, href: li.querySelector('a')?.getAttribute('href') ?? null })),
      real: localStorage.getItem('${LS}'),
    };
  })())`));
  planned.inert = JSON.parse(await inertButtons(['review.copy', 'gradadmin.copy', 'save.copy', 'save.summary']));
  console.log('  planned:', JSON.stringify({ ...planned, real: planned.real === realBefore ? 'unchanged' : 'CHANGED' }));
  if (!planned.row || planned.row.grade !== 'A' || planned.row.term.season !== laterSeason.toLowerCase() || planned.row.term.year !== Number(laterYear)) throw new Error('the planned course must be in the simulation key with its semester and grade: ' + JSON.stringify(planned.row));
  if (!planned.counts) throw new Error('a course planned with the grade expected must count: ' + JSON.stringify(planned.countsText));
  // The course rules' word on a planned course (DGS 2026-10-11, item 19): the
  // live sheet has CSE 60772 typically offered in the fall, so a spring plan
  // says so and a fall plan says nothing.
  if (laterSeason === 'Spring' ? planned.planNote !== `Schedule: typically offered in fall; planned for ${later}.` : planned.planNote !== null) throw new Error(`a ${later} plan of CSE 60772 (typically offered in fall) — wrong schedule note: ` + JSON.stringify(planned.planNote));
  console.log('  schedule note on the planned CSE 60772:', JSON.stringify(planned.planNote));
  if (planned.problemLinks !== 0) throw new Error('a plan sends nothing: no "Does this look wrong?" links in simulation mode, got ' + planned.problemLinks);
  if (planned.planNote) await s.shotElement('simulation-plan-note', 'table.courses tr:has(.plan-note)');
  if (!planned.reviewed || !planned.reviewSentence || !planned.gradAdminSentence || !planned.cardChips.every(Boolean)) throw new Error('the review and Grad Admin cards must keep their lists, say nothing is sent, and carry the chip: ' + JSON.stringify(planned));
  for (const [k, v] of Object.entries(planned.inert)) {
    if (v === 'absent' || v.disabled !== 'true' || !/^Not available in simulation mode — nothing is sent from a plan\./.test(v.reason)) throw new Error(`${k} must be inactive in the mode with the sending reason, got ${JSON.stringify(v)}`);
  }
  const simSteps = planned.steps.filter((st) => /^In simulation mode nothing is sent/.test(st.text));
  if (simSteps.length !== 1 || !/this plan would put 1 (course|item) before the DGS( and \d+ items? before the Grad Admin)?\.$/.test(simSteps[0].text)) throw new Error('Next steps must carry ONE simulation step with both counts: ' + JSON.stringify(planned.steps));
  const sending = planned.steps.filter((st) => !/^In simulation mode/.test(st.text) && (st.href === '#dgs-review' || st.href === '#grad-admin' || /^Send the summary to your advisor/.test(st.text) || /^Send the processing request/.test(st.text)));
  if (sending.length > 0) throw new Error('no request step may remain beside the simulation step: ' + JSON.stringify(sending));
  if (planned.real !== realBefore) throw new Error('planning courses in the simulation must not touch the real record’s key');

  // Save to a file inside the mode: the simulation file, named for the mode
  // and the semester, its note FIRST. The download is caught in the page
  // (no file lands on disk in a headless browser) and kept for the load below.
  const saved = JSON.parse(await s.evalJs(`(async () => {
    const files = [];
    let blob;
    const click = HTMLAnchorElement.prototype.click;
    const make = URL.createObjectURL;
    HTMLAnchorElement.prototype.click = function () { if (this.download) { files.push(this.download); return; } return click.call(this); };
    URL.createObjectURL = function (b) { blob = b; return make.call(URL, b); };
    try {
      document.querySelector('[data-key="simulation.save"]').click();
      return JSON.stringify({ files, text: blob ? await blob.text() : null, code: document.querySelector('[data-key="simulation.term"]').value });
    } finally {
      HTMLAnchorElement.prototype.click = click;
      URL.createObjectURL = make;
    }
  })()`));
  const payload = saved.text ? JSON.parse(saved.text) : null;
  console.log('  saved:', JSON.stringify({ files: saved.files, keys: payload ? Object.keys(payload) : null, note: payload?.note }));
  if (saved.files.length !== 1 || !saved.files[0].includes('-simulation-') || saved.files[0] !== `cse-degree-audit-phd-simulation-${saved.code}.json`) throw new Error('Save to a file in the mode must write the simulation file: ' + JSON.stringify(saved.files));
  if (!payload || Object.keys(payload)[0] !== 'note' || payload.note !== `SIMULATION of ${later} — a planning copy, not this student's record`) throw new Error('the simulation file must open with its note: ' + JSON.stringify(payload && Object.keys(payload)));
  // The plan is stamped too (item 8): checked as of the simulated semester's date.
  if (!payload.stamp?.verdicts || !/^\d{4}-\d{2}-\d{2}$/.test(payload.stamp.auditDate ?? '') || Number(payload.stamp.auditDate.slice(0, 4)) !== Number(laterYear)) throw new Error('the simulation file must carry its stamp, dated in the simulated semester: ' + JSON.stringify(payload.stamp && { auditDate: payload.stamp.auditDate, rows: Object.keys(payload.stamp.verdicts ?? {}).length }));
  if (payload.simulation?.term?.season !== laterSeason.toLowerCase() || payload.simulation?.term?.year !== Number(laterYear) || !payload.student?.courses?.some((c) => c.courseId === 'CSE 60772')) throw new Error('the simulation file must carry the semester and the plan: ' + JSON.stringify({ simulation: payload.simulation, courses: payload.student?.courses?.length }));
  const simFile = join(tmpdir(), 'cse-degree-audit-e2e-simulation.json');
  writeFileSync(simFile, saved.text);
  if ((await s.evalJs(`localStorage.getItem('${LS}')`)) !== realBefore) throw new Error('saving the simulation to a file must not touch the real record’s key');

  // A reload reopens IN the mode, with the plan and its semester; the real
  // record is still untouched. (The "still on" toast may have expired by the
  // time the opening notice is answered — logged, not asserted.)
  await s.open(baseUrl);
  await s.waitFor(`document.querySelector('.simulation-banner')`);
  await s.settle();
  const reloaded = JSON.parse(await s.evalJs(`JSON.stringify({
    lead: document.querySelector('.simulation-lead')?.textContent ?? '',
    title: document.title,
    courses: [...document.querySelectorAll('table.courses .cid')].map((e) => e.textContent).filter((t) => t === 'CSE 60772' || t === 'MATH 60610').length,
    toast: /Simulation mode is still on/.test(document.body.textContent),
    real: localStorage.getItem('${LS}'),
  })`));
  console.log('  reloaded in the mode:', JSON.stringify({ ...reloaded, real: reloaded.real === realBefore ? 'unchanged' : 'CHANGED' }));
  if (!reloaded.lead.includes(later) || !reloaded.title.startsWith('Simulating ' + later) || reloaded.courses !== 2) throw new Error('a reload must reopen in the mode with the plan and its semester: ' + JSON.stringify(reloaded));
  if (reloaded.real !== realBefore) throw new Error('reopening in the mode must not touch the real record’s key');

  // On a phone (390 px) the mode must stay in view while the report's own
  // headline is: the sticky score bar hides there (P-66), so the headline
  // carries the chip (review fix 2026-10-09); once the headline scrolls off,
  // the bar carries the mode and the semester.
  // (The headline a phone shows is the summary copy at the top of the page —
  // the report's own scorehead is hidden there — and the bar watches both.)
  await s.setViewport({ width: 390, height: 900, mobile: true });
  await s.evalJs(`document.querySelector('.summary-mobile .headline').scrollIntoView({ block: 'center' })`);
  await s.settle(400);
  const phone = JSON.parse(await s.evalJs(`JSON.stringify((() => {
    const chip = document.querySelector('.summary-mobile .headline .chip-simulation');
    const r = chip?.getBoundingClientRect();
    const bar = document.querySelector('.sticky-score');
    return { chipText: chip?.textContent ?? '', inView: !!r && r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight, barHidden: !!bar && getComputedStyle(bar).display === 'none', wide: document.documentElement.scrollWidth > innerWidth };
  })())`));
  if (phone.chipText !== 'Simulation' || !phone.inView) throw new Error('on a phone the headline on screen must carry the Simulation chip in view: ' + JSON.stringify(phone));
  if (!phone.barHidden) throw new Error('the sticky score bar hides while a headline is on screen (P-66) — the chip is then the marker: ' + JSON.stringify(phone));
  if (phone.wide) throw new Error('the mode must not make a phone scroll sideways');
  await s.shot('simulation-phone-headline');
  await s.evalJs(`document.getElementById('inputs').scrollIntoView()`);
  await s.settle();
  const bar = await s.evalJs(`(() => { const b = document.querySelector('.sticky-score'); return b && getComputedStyle(b).display !== 'none' ? b.textContent : ''; })()`);
  if (!bar.startsWith('Simulation · ' + later)) throw new Error('the phone’s sticky score bar must carry the mode and the semester once the headline is off screen: ' + JSON.stringify(bar));
  await s.shot('simulation-phone-bar');
  console.log('  on a phone: the headline chip while the bar hides, the bar (' + JSON.stringify(bar) + ') once it shows');
  await s.setViewport({ width: 1400, height: 1900 });

  // The frame (?embed=1) while the mode is on: the chip beside the report
  // headline and on each request card, the banner first; the course-rules
  // page, which holds no student data, is untouched by the stored simulation.
  await s.open(new URL('?embed=1', baseUrl).href, '.masthead h1');
  await s.waitFor(`document.querySelector('.simulation-banner') && document.querySelector('.audit .scorehead .headline')`);
  await s.settle();
  const framed = JSON.parse(await s.evalJs(`JSON.stringify({
    embed: document.documentElement.classList.contains('embed'),
    marked: document.documentElement.classList.contains('simulation'),
    headlineChip: !!document.querySelector('.audit .scorehead .headline .chip-simulation'),
    cardChips: ['#dgs-review', '#grad-admin'].map((id) => !!document.querySelector(id + ' .chip-simulation')),
    bannerFirst: document.querySelector('main')?.querySelector('.card')?.classList.contains('simulation-banner') === true,
    strip: (() => { const e = document.querySelector('.simulation-strip'); return e ? getComputedStyle(e).display : 'absent'; })(),
    real: localStorage.getItem('${LS}'),
  })`));
  console.log('  in the frame:', JSON.stringify({ ...framed, real: framed.real === realBefore ? 'unchanged' : 'CHANGED' }));
  if (!framed.embed || !framed.marked || !framed.headlineChip || !framed.cardChips.every(Boolean) || !framed.bannerFirst) throw new Error('the frame must mark the mode beside the headline, on each request card and in the banner: ' + JSON.stringify(framed));
  if (framed.strip !== 'none' && framed.strip !== 'absent') throw new Error('the sticky strip is for the page outside the frame: ' + JSON.stringify(framed));
  if (framed.real !== realBefore) throw new Error('the frame must not touch the real record’s key');
  await s.shot('simulation-embed');
  await s.open(new URL('courses.html', baseUrl).href);
  const coursesPage = JSON.parse(await s.evalJs(`JSON.stringify({
    banner: !!document.querySelector('.simulation-banner'),
    marked: document.documentElement.classList.contains('simulation'),
    title: document.title,
    chips: document.querySelectorAll('.chip-simulation').length,
    sim: localStorage.getItem('${SIM}') !== null,
  })`));
  if (coursesPage.banner || coursesPage.marked || /^Simulating/.test(coursesPage.title) || coursesPage.chips !== 0 || !coursesPage.sim) throw new Error('the course-rules page must not be touched by a stored simulation: ' + JSON.stringify(coursesPage));
  console.log('  the course-rules page is not touched by the stored simulation');
  await s.open(baseUrl);
  await s.waitFor(`document.querySelector('.simulation-banner')`);
  await s.settle();

  // Reset inside the mode is "Start the simulation over from my record": it
  // asks, names what goes, then copies the record afresh — the planned
  // courses gone, the semester kept, the real key untouched.
  await s.evalJs(`document.querySelector('[data-key="tools.reset"]').click()`);
  await s.waitFor(`document.querySelector('dialog.confirm-check[open]')`);
  const restartAsk = JSON.parse(await s.evalJs(`JSON.stringify((() => {
    const d = document.querySelector('dialog.confirm-check');
    return { title: d.querySelector('h2').textContent, body: [...d.querySelectorAll('p')].map((p) => p.textContent).join(' '), buttons: [...d.querySelectorAll('button')].map((b) => b.textContent) };
  })())`));
  console.log('  start over asks:', JSON.stringify(restartAsk));
  if (restartAsk.title !== 'Start the simulation over?' || !/This discards the simulation \(2 courses, 0 milestone dates and 0 other changes made since you entered; the simulated semester /.test(restartAsk.body) || !restartAsk.body.includes('still pretending it is ' + later)) throw new Error('Start over must say what it discards and which semester stays: ' + JSON.stringify(restartAsk));
  await s.evalJs(`document.querySelector('[data-key="confirm.yes"]').click()`);
  await s.waitFor(`!document.querySelector('dialog.confirm-check') && ![...document.querySelectorAll('table.courses .cid')].some((e) => e.textContent === 'CSE 60772')`);
  await s.settle();
  const restarted = JSON.parse(await s.evalJs(`JSON.stringify((() => {
    const sim = JSON.parse(localStorage.getItem('${SIM}') ?? 'null');
    return {
      lead: document.querySelector('.simulation-lead')?.textContent ?? '',
      courses: document.querySelectorAll('table.courses .cid').length,
      simCourses: sim ? sim.student.courses.length : -1,
      status: document.querySelector('.visually-hidden[role="status"]')?.textContent ?? '',
      real: localStorage.getItem('${LS}'),
    };
  })())`));
  console.log('  started over:', JSON.stringify({ ...restarted, real: restarted.real === realBefore ? 'unchanged' : 'CHANGED' }));
  if (!restarted.lead.includes(later) || restarted.courses !== outside.courses || restarted.simCourses !== outside.courses) throw new Error('Start over must keep the semester and copy the record afresh: ' + JSON.stringify(restarted));
  if (!/^Simulation started over from your record; still pretending it is /.test(restarted.status)) throw new Error('starting over must be announced: ' + restarted.status);
  if (restarted.real !== realBefore) throw new Error('starting the simulation over must not touch the real record’s key');

  // The way out asks first and says what goes; then the record is back,
  // byte-identical, the plan is gone, the page is itself again, and the
  // sending buttons are live.
  await s.evalJs(`document.querySelector('[data-key="simulation.exit"]').click()`);
  await s.waitFor(`document.querySelector('dialog.confirm-check[open]')`);
  const ask = JSON.parse(await s.evalJs(`JSON.stringify((() => {
    const d = document.querySelector('dialog.confirm-check');
    return { title: d.querySelector('h2').textContent, body: [...d.querySelectorAll('p')].map((p) => p.textContent).join(' '), buttons: [...d.querySelectorAll('button')].map((b) => b.textContent), focused: document.activeElement?.dataset?.key ?? '' };
  })())`));
  console.log('  exit asks:', JSON.stringify(ask));
  if (ask.title !== 'Exit simulation mode?' || !/This discards the simulation: 0 courses, 0 milestone dates and 0 other changes made since you entered; the simulated semester /.test(ask.body) || !ask.body.includes('the simulated semester ' + later)) throw new Error('Exit must say what it discards (nothing since Start over) and the semester: ' + JSON.stringify(ask));
  if (ask.focused !== 'confirm.no') throw new Error('the safe answer must have focus: ' + ask.focused);
  await s.evalJs(`document.querySelector('[data-key="confirm.yes"]').click()`);
  await s.waitFor(`!document.querySelector('.simulation-banner') && !document.querySelector('dialog.confirm-check')`);
  await s.settle();
  const exited = JSON.parse(await s.evalJs(`JSON.stringify({
    sim: localStorage.getItem('${SIM}'),
    real: localStorage.getItem('${LS}'),
    courses: document.querySelectorAll('table.courses .cid').length,
    planned: [...document.querySelectorAll('table.courses .cid')].some((e) => e.textContent === 'CSE 60772' || e.textContent === 'MATH 60610'),
    marked: document.documentElement.classList.contains('simulation'),
    title: document.title,
    chips: document.querySelectorAll('.chip-simulation').length,
    planNotes: document.querySelectorAll('.plan-note').length,
    focused: document.activeElement?.dataset?.key ?? '',
    status: document.querySelector('.visually-hidden[role="status"]')?.textContent ?? '',
    sendActive: document.querySelector('[data-key="save.copy"]')?.getAttribute('aria-disabled') ?? 'none',
    wayIn: !!document.querySelector('[data-key="tools.simulate"]') && !!document.querySelector('[data-key="coursework.simulate"]'),
  })`));
  console.log('  exited:', JSON.stringify({ ...exited, real: exited.real === realBefore ? 'unchanged' : 'CHANGED' }));
  if (exited.sim !== null || exited.planned || exited.marked || exited.chips !== 0 || exited.planNotes !== 0 || !exited.wayIn) throw new Error('Exit must drop the plan and unmark the page: ' + JSON.stringify(exited));
  if (exited.courses !== outside.courses || exited.title !== outside.title) throw new Error('Exit must bring back the record’s courses and the tab title: ' + JSON.stringify([exited.courses, outside.courses, exited.title, outside.title]));
  if (exited.real !== realBefore) throw new Error('the real record must come back byte-identical to what it was before the simulation');
  if (exited.focused !== 'tools.simulate') throw new Error('Exit must return focus to the way in, not ' + exited.focused);
  if (!/^Simulation mode off/.test(exited.status)) throw new Error('exiting must be announced: ' + exited.status);
  if (exited.sendActive !== 'none') throw new Error('the advisor summary must be active again outside the mode');

  // The saved plan, loaded OUTSIDE the mode through "Load a file": the mode
  // comes back with the file's semester and courses, the toast says so, and
  // the real record is untouched — the file is a plan, never a record.
  await s.setFileInput('[data-key="save.fileinput"]', simFile);
  await s.waitFor(`document.querySelector('.simulation-banner')`);
  await s.settle();
  const fromFile = JSON.parse(await s.evalJs(`JSON.stringify((() => {
    const sim = JSON.parse(localStorage.getItem('${SIM}') ?? 'null');
    return {
      lead: document.querySelector('.simulation-lead')?.textContent ?? '',
      title: document.title,
      toast: (document.body.textContent.match(/Simulation file loaded — simulation mode is on for [^;]+; your record is untouched\\./) ?? [''])[0],
      planned: [...document.querySelectorAll('table.courses .cid')].filter((e) => e.textContent === 'CSE 60772' || e.textContent === 'MATH 60610').length,
      simTerm: sim ? sim.term : null,
      real: localStorage.getItem('${LS}'),
    };
  })())`));
  console.log('  loaded the saved plan outside the mode:', JSON.stringify({ ...fromFile, real: fromFile.real === realBefore ? 'unchanged' : 'CHANGED' }));
  if (!fromFile.lead.includes(later) || !fromFile.title.startsWith('Simulating ' + later) || fromFile.planned !== 2 || fromFile.simTerm?.year !== Number(laterYear)) throw new Error('a simulation file loaded outside the mode must enter the mode with its semester and plan: ' + JSON.stringify(fromFile));
  if (fromFile.toast !== `Simulation file loaded — simulation mode is on for ${later}; your record is untouched.`) throw new Error('loading a simulation file outside the mode must say so: ' + JSON.stringify(fromFile.toast));
  if (fromFile.real !== realBefore) throw new Error('loading a simulation file must not touch the real record’s key');
  await s.evalJs(`localStorage.clear()`);
}

// E2E: ?embed=1 on the self-check tool (DGS 2026-09-16). The same chrome trim
// as the course-rules page, plus what is true only here: the student is told
// where their saved work is going, and — since later the same day — the page
// broadcasts its height like the course-rules page, with the opening notice
// placed at the top of the document rather than the middle of a tall frame.
async function driveAppEmbed(s, baseUrl) {
  await s.open(new URL('?embed=1', baseUrl).href, '.masthead h1');
  const m = JSON.parse(
    await s.evalJs(`(async () => {
      const heights = [];
      document.addEventListener('nd-cse-audit:height', (e) => heights.push(e.detail.height));
      // The page only reports a CHANGED height, and it finished growing before
      // this listener existed — so change it: open the notice's Details.
      document.querySelector('[data-key="notice.details"]')?.setAttribute('open', '');
      // Poll for the first report rather than sleep (up to 6 s; the check below says if none came).
      const until = Date.now() + 6000;
      while (heights.length === 0 && Date.now() < until) await new Promise((r) => setTimeout(r, 50));
      return JSON.stringify({
        heights: heights.length,
        eyebrow: !!document.querySelector('.masthead .eyebrow'),
        h1Hidden: document.querySelector('.masthead h1')?.classList.contains('visually-hidden') === true,
        embedClass: document.documentElement.classList.contains('embed'),
        contactInMasthead: !!document.querySelector('.masthead .contact-card'),
        contactInFooter: !!document.querySelector('footer.legal .contact-card'),
        storageNote: !!document.querySelector('.banner.embed-storage'),
        privacy: !!document.querySelector('.legal-privacy'),
        exit: document.querySelector('footer.legal .embed-exit')?.getAttribute('target'),
        coursesTarget: document.querySelector('.masthead .sub a[href^="./courses.html"]')?.getAttribute('target'), // the link carries ?view=<program> since U29 (2026-10-17)
        stickyHidden: !document.querySelector('.sticky-score') || getComputedStyle(document.querySelector('.sticky-score')).display === 'none',
      });
    })()`),
  );
  if (m.eyebrow || !m.h1Hidden || !m.embedClass) throw new Error('the self-check tool did not trim its chrome in embed mode: ' + JSON.stringify(m));
  if (m.contactInMasthead || !m.contactInFooter) throw new Error('"Who to contact" should move to the footer in embed mode: ' + JSON.stringify(m));
  if (!m.storageNote) throw new Error('embed mode must tell the student their saved work lives in the frame');
  if (!m.privacy) throw new Error('the FERPA paragraph must survive embed mode — it is the promise the page makes');
  // The masthead's intro (and its course-rules link) is not rendered in embed mode since 2026-09-16 (DGS: no text at the top).
  if (m.exit !== '_top') throw new Error('a link would load a whole page inside the frame: ' + JSON.stringify(m));
  if (m.coursesTarget !== undefined) throw new Error('embed mode must not render the masthead intro: ' + JSON.stringify(m));
  // The report's "See the courses …" links go to the ND course-rules page in
  // the top window when embedded (DGS 2026-09-30), not to the bare app page.
  const courseLinks = JSON.parse(await s.evalJs(`JSON.stringify([...document.querySelectorAll('a.course-link')].map((a) => ({ href: a.getAttribute('href'), target: a.getAttribute('target') })))`));
  if (courseLinks.length === 0 || !courseLinks.every((l) => l.href === 'https://sites.nd.edu/csedept/courses-and-rules/' && l.target === '_top')) throw new Error('embedded course-list links must go to the ND course-rules page: ' + JSON.stringify(courseLinks.slice(0, 2)));
  if (m.heights === 0) throw new Error('the self-check tool must broadcast its height in embed mode (DGS 2026-09-16)');
  if (!m.stickyHidden) throw new Error('the bottom score bar must be hidden in embed mode: ' + JSON.stringify(m));
  await s.shot('app-embed');
  console.log('  ?embed=1 on the self-check tool → chrome trimmed, storage note shown, FERPA paragraph kept, height broadcast, score bar hidden');

  await s.open(baseUrl, '.masthead h1');
  const back = JSON.parse(await s.evalJs(`JSON.stringify({ eyebrow: !!document.querySelector('.masthead .eyebrow'), embedClass: document.documentElement.classList.contains('embed'), storageNote: !!document.querySelector('.banner.embed-storage') })`));
  if (!back.eyebrow || back.embedClass || back.storageNote) throw new Error('the self-check tool without ?embed=1 is not the page it was: ' + JSON.stringify(back));
  console.log('  the self-check tool without the parameter is unchanged');
}

// Both pages link the DGS's rules spreadsheet (2026-09-04): in the masthead
// (under the dated line), saying it is accessible by faculty only, and — on the
// self-check page — in the footer as well. The course-rules page's footer copy
// went on 2026-09-18 (trim review P-12): it repeated the masthead's own source
// line word for word, on the page that IS the spreadsheet's public face. The
// link must be the sheet's human address, not a published-CSV one.
async function checkSheetLink(s, page) {
  const found = await s.evalJs(`(() => {
    const sel = 'a[href^="https://docs.google.com/spreadsheets/d/"]';
    const inMast = [...document.querySelectorAll('.masthead ' + sel)];
    const inFoot = [...document.querySelectorAll('footer.legal ' + sel)];
    const text = (a) => a.closest('p, div')?.textContent ?? '';
    return {
      masthead: inMast.length, footer: inFoot.length,
      csv: [...inMast, ...inFoot].some(a => /\\/d\\/e\\/|output=csv/.test(a.href)),
      name: [...inMast, ...inFoot].every(a => a.textContent === 'CSE-Degree-Checking-Rules'),
      facultyOnly: [...inMast, ...inFoot].every(a => /faculty only/.test(text(a))),
      newTab: [...inMast, ...inFoot].every(a => a.target === '_blank' && /noopener/.test(a.rel)),
    };
  })()`);
  const bad = [];
  if (found.masthead !== 1) bad.push(`masthead links: ${found.masthead}`);
  const wantFooter = page === 'courses' ? 0 : 1;
  if (found.footer !== wantFooter) bad.push(`footer links: ${found.footer} (expected ${wantFooter})`);
  if (found.csv) bad.push('a link points at a published-CSV address');
  if (!found.name) bad.push('link text is not the sheet name');
  if (!found.facultyOnly) bad.push('a mention lacks the faculty-only note');
  if (!found.newTab) bad.push('link does not open in a new tab safely');
  if (bad.length) throw new Error(`rules-spreadsheet link on the ${page} page: ${bad.join('; ')}`);
  console.log(`  rules-spreadsheet link present (masthead + footer, faculty-only note) on the ${page} page`);
}

// E2E: the public course-rules list (courses.html) — renders the overview and
// the full table from the same rules, filters work, no student data involved.
// A section chip shows the CSE handbook's own text on hover and closes when the
// pointer leaves (DGS 2026-10-05, src/ui/section-ref.ts). The events are sent
// to the elements themselves, as the browser sends them to a mouse.
async function checkSectionChip(s, selector, expected, label) {
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  await s.evalJs(`document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new MouseEvent('mouseenter'))`);
  await pause(300);
  const read = async () => JSON.parse(await s.evalJs(`JSON.stringify((() => {
    const chip = document.querySelector(${JSON.stringify(selector)});
    const pop = document.getElementById(chip.getAttribute('aria-controls'));
    return { expanded: chip.getAttribute('aria-expanded'), visible: !!pop && !pop.hidden, text: pop ? pop.textContent : '', inView: pop ? pop.getBoundingClientRect().right <= document.documentElement.clientWidth : false };
  })())`));
  // The words arrive by a same-origin fetch on the first hover (W2, 2026-10-22):
  // the panel says "Loading the handbook’s text…" until then — wait for them.
  let shown = await read();
  for (const t0 = Date.now(); Date.now() - t0 < 5000 && !(shown.visible && new RegExp(expected).test(shown.text)); shown = await read()) await pause(100);
  if (/Loading the handbook|Could not load the handbook/.test(shown.text)) throw new Error(`${label}: the handbook's text did not arrive: ` + shown.text.slice(0, 300));
  if (shown.expanded !== 'true' || !shown.visible || !new RegExp(expected).test(shown.text) || !shown.inView) throw new Error(`${label}: hovering the section chip must show the handbook's text: ` + JSON.stringify({ ...shown, text: shown.text.slice(0, 300) }));
  await s.evalJs(`document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new MouseEvent('mouseleave'))`);
  await pause(450);
  const hidden = await s.evalJs(`(() => { const chip = document.querySelector(${JSON.stringify(selector)}); return document.getElementById(chip.getAttribute('aria-controls')).hidden && chip.getAttribute('aria-expanded') === 'false'; })()`);
  if (!hidden) throw new Error(`${label}: the handbook text must close when the pointer leaves`);
  console.log(`  ${label}: hovering the section chip shows the handbook's text, leaving closes it`);
}

// The rules start downloading from the page's <head>, while the app's script
// does (efficiency round 2026-10-26, src/data/head-start.ts): on the load just
// made, every head request was taken over by the loader (none left waiting),
// the first one started before the app's script had finished loading, and —
// when no request was slow enough for the loader's hedge (2 s) — each tab was
// asked for exactly once. Skipped when Google did not answer (the run then
// drives the saved copy instead).
async function checkHeadStart(s, label) {
  const got = JSON.parse(await s.evalJs(`JSON.stringify((() => {
    const sheet = performance.getEntriesByType('resource').filter((e) => /docs\\.google\\.com\\/spreadsheets/.test(e.name));
    const script = performance.getEntriesByType('resource').find((e) => /\\/assets\\/(index|courses)-[^/]*\\.js$/.test(e.name));
    return {
      live: (document.querySelector('footer.legal .legal-stamp')?.textContent ?? '').includes('read live') && sheet.length > 0, // the footer's stamp says where the rules came from
      left: Object.keys(window.__cseRulesHeadStart ?? { missing: 1 }),
      requests: sheet.length,
      tabs: new Set(sheet.map((e) => e.name)).size,
      firstStart: Math.round(Math.min(...sheet.map((e) => e.startTime))),
      slowest: Math.round(Math.max(...sheet.map((e) => e.duration))),
      scriptEnd: script ? Math.round(script.responseEnd) : null,
      scriptCached: script ? script.transferSize === 0 : true, // from the browser's cache: nothing to start before
      scriptMs: script ? Math.round(script.responseEnd - script.startTime) : 0,
    };
  })())`));
  if (!got.live) {
    console.log(`  rules head start (${label}): skipped — Google did not answer, the saved copy is in use`);
    return;
  }
  if (got.left.length > 0) throw new Error(`${label}: the loader must take over every request the <head> started; left waiting: ${got.left.join(', ')}`);
  // Measurable only when the script took a while to arrive: from the preview
  // server on this machine it can land in 4 ms, the same moment as the requests.
  if (!got.scriptCached && got.scriptMs >= 15 && got.scriptEnd !== null && got.firstStart >= got.scriptEnd) throw new Error(`${label}: the rules must start downloading before the app's script has finished loading: ` + JSON.stringify(got));
  if (got.slowest < 1900 && got.requests !== got.tabs) throw new Error(`${label}: with no request slow enough to hedge, each tab must be asked for once (the <head> request, taken over): ` + JSON.stringify(got));
  console.log(`  rules head start (${label}): ${got.tabs} tabs, ${got.requests} requests, the first at ${got.firstStart} ms (the app's script ${got.scriptCached ? 'came from the cache' : `finished at ${got.scriptEnd} ms`}); none left waiting`);
}

export async function driveCourses(s, baseUrl) {
  await s.open(new URL('courses.html', baseUrl).href);
  await s.waitFor(`document.querySelectorAll('.all-courses table.course-rules tbody tr').length > 10`);
  await checkHeadStart(s, 'course-rules page');
  await s.shot('courses-list');
  await checkSheetLink(s, 'courses');
  const count = await s.evalJs(`document.querySelector('.count')?.textContent`);
  console.log('  course list:', count);
  // Which rules, handbook and build the page shows (item 8, 2026-10-11).
  const version = await s.evalJs(`document.querySelector('footer.legal .legal-stamp')?.textContent ?? ''`);
  if (!new RegExp(`^Version: ${STAMP_RE.source}\\.$`).test(version)) throw new Error('the course-rules footer must carry the Version line: ' + JSON.stringify(version));
  console.log('  footer:', version);
  if (!/\d+ of \d+ courses/.test(count ?? '')) throw new Error('course list did not render');
  await checkSectionChip(s, '[data-key="secref.core"]', 'Core Knowledge Requirement.*All PhD students are required to pass', 'course rules page, CSE §4.4.1');
  // (Note rows — the DGS's notes, opened per course since 2026-09-05 — are tbody rows too; count courses only.)
  const before = await s.evalJs(`document.querySelectorAll('.all-courses table.course-rules tbody tr:not(.note-row)').length`);
  await s.evalJs(
    // The core areas and the specialization categories share one "Ph.D.
    // qualifier area" select since 2026-09-18 (trim review P-22); its values
    // carry a prefix so the two Algorithms entries stay apart.
    `const sel=document.querySelector('[data-key="filter.qualifier"]'); sel.value='core:algorithms'; sel.dispatchEvent(new Event('change'))`,
  );
  await s.waitFor(`document.querySelectorAll('.all-courses table.course-rules tbody tr:not(.note-row)').length < ${before}`);
  const after = await s.evalJs(`document.querySelectorAll('.all-courses table.course-rules tbody tr:not(.note-row)').length`);
  console.log(`  core-area filter: ${before} → ${after} rows`);
  if (!(after > 0 && after < before)) throw new Error('core-area filter did not narrow the table');
  // The table itself: a window-sized shot from the top of the page never
  // reached it, so this picture was the unfiltered page (2026-10-10).
  await s.shotElement('courses-filtered', '.all-courses');

  // The DGS's notes are the DGS's (2026-09-09): no Notes column, no
  // disclosure, and nothing on the page carries them.
  const noNotes = JSON.parse(await s.evalJs(`JSON.stringify({
    button: !!document.querySelector('.all-courses table.course-rules button.notes'),
    column: [...document.querySelectorAll('.all-courses table.course-rules thead th')].some((th) => /notes/i.test(th.textContent ?? '')),
    legend: /the DGS.s notes on a course/.test(document.body.textContent ?? ''),
  })`));
  if (noNotes.button || noNotes.column || noNotes.legend) throw new Error('the DGS notes are still reachable: ' + JSON.stringify(noNotes));
  console.log('  no Notes column, button or legend entry — the DGS notes stay with the DGS');
  // Clear filters (item 26) drops the core-area filter set above…
  await s.evalJs(`document.querySelector('[data-key="filter.clear"]').click()`);
  await s.waitFor(`document.querySelectorAll('.all-courses table.course-rules tbody tr:not(.note-row)').length > 10`);
  console.log('  Clear filters restores the full list');
  // …and search ignores spacing: "cse60641" finds CSE 60641.
  await s.evalJs(`const q = document.querySelector('[data-key="filter.search"]'); q.value = 'cse60641'; q.dispatchEvent(new Event('input'));`);
  await s.waitFor(`document.querySelectorAll('.all-courses table.course-rules tbody tr:not(.note-row)').length === 1`);
  console.log('  search ignores spacing: "cse60641" → 1 row');
  await s.evalJs(`document.querySelector('[data-key="filter.clear"]').click()`);
  await s.waitFor(`document.querySelectorAll('.all-courses table.course-rules tbody tr:not(.note-row)').length > 10`);
  // Blue-team review 2026-10-17, U26: the deep-link spelling, two words in any
  // order, and a core-knowledge area's name all find their courses; the
  // empty-table sentence names what the search looks at. (The search box
  // rebuilds the table 120 ms after the last keystroke since W7, so each
  // step waits for the rows rather than reading them in the same tick.)
  const rowsOf = async (query, want) => {
    await s.evalJs(`(() => { const q = document.querySelector('[data-key="filter.search"]'); q.value = ${JSON.stringify(query)}; q.dispatchEvent(new Event('input')); })()`);
    await s.waitFor(`document.querySelectorAll('.all-courses table.course-rules tbody tr:not(.note-row):not(.empty-row)').length ${want}`, 4000).catch(() => {});
    return JSON.parse(await s.evalJs(`JSON.stringify([...document.querySelectorAll('.all-courses table.course-rules tbody tr:not(.note-row):not(.empty-row)')].map((tr) => tr.id))`));
  };
  const dash = await rowsOf('CSE-60641', '=== 1');
  if (dash.length !== 1 || dash[0] !== 'CSE-60641') throw new Error('the deep-link spelling "CSE-60641" must find CSE 60641: ' + JSON.stringify(dash));
  const twoWords = await rowsOf('60641 operating', '=== 1');
  if (twoWords.length !== 1 || twoWords[0] !== 'CSE-60641') throw new Error('"60641 operating" must find CSE 60641 (every word, any order): ' + JSON.stringify(twoWords));
  const area = await rowsOf('operating systems', '>= 2');
  if (!area.includes('CSE-60641') || !area.includes('CSE-30341')) throw new Error('"operating systems" must find the courses whose core area is Operating Systems, title or not: ' + JSON.stringify(area));
  const none = await rowsOf('zzqx-nothing', '=== 0');
  const emptyText = await s.evalJs(`document.querySelector('.all-courses table.course-rules tbody tr.empty-row')?.textContent ?? ''`);
  if (none.length !== 0 || !/the search matches a course number, a word in the title, or a qualifier area/.test(emptyText)) throw new Error('the empty-table sentence must say what the search looks at: ' + JSON.stringify(emptyText.slice(0, 200)));
  console.log(`  search (U26): "CSE-60641" → 1 row, "60641 operating" → 1 row, "operating systems" → ${area.length} rows (core area included); the empty-table sentence names number, title words and qualifier area`);
  await s.evalJs(`document.querySelector('[data-key="filter.clear"]').click()`);
  await s.waitFor(`document.querySelectorAll('.all-courses table.course-rules tbody tr:not(.note-row)').length > 10`);

  // "Copy link to this list" (U27): the standalone address of the CURRENT
  // filters, read from the filters themselves rather than from the address
  // bar (which follows on a 250 ms timer); the button says "Copied" and the
  // live count line says so too, then both come back. The clipboard itself is
  // stubbed — a headless run has no clipboard to read back — so what is
  // checked is the address the page hands it. Then both routes refused: the
  // address appears in a read-only box, selected, for a hand copy.
  {
    await s.evalJs(`(() => { const sel = document.querySelector('[data-key="filter.qualifier"]'); sel.value = 'core:algorithms'; sel.dispatchEvent(new Event('change')); })()`);
    await s.waitFor(`document.querySelectorAll('.all-courses table.course-rules tbody tr:not(.note-row)').length < 20`);
    const copied = JSON.parse(await s.evalJs(`(async () => {
      window.__copied = [];
      navigator.clipboard.writeText = (t) => { window.__copied.push(t); return Promise.resolve(); };
      const btn = document.querySelector('[data-key="filter.copy-link"]');
      const labelBefore = btn.textContent;
      btn.click();
      await new Promise((r) => setTimeout(r, 150));
      return JSON.stringify({ labelBefore, label: btn.textContent, live: document.querySelector('.count').textContent, copied: window.__copied, fallbackHidden: document.querySelector('.copy-link-fallback').hidden });
    })()`));
    const expected = new URL('courses.html?core=algorithms', baseUrl).href;
    if (copied.labelBefore !== 'Copy link to this list' || copied.copied.length !== 1 || copied.copied[0] !== expected) throw new Error('Copy link must copy the full-page address of the current filters: ' + JSON.stringify({ ...copied, expected }));
    if (copied.label !== 'Copied' || copied.live !== 'Link copied.' || !copied.fallbackHidden) throw new Error('Copy link must confirm on the button and the live line: ' + JSON.stringify(copied));
    await s.waitFor(`document.querySelector('[data-key="filter.copy-link"]').textContent === 'Copy link to this list' && /courses shown/.test(document.querySelector('.count').textContent)`, 4000);
    const refused = JSON.parse(await s.evalJs(`(async () => {
      navigator.clipboard.writeText = () => Promise.reject(new Error('blocked'));
      const cmd = document.execCommand;
      document.execCommand = () => false;
      document.querySelector('[data-key="filter.copy-link"]').click();
      await new Promise((r) => setTimeout(r, 150));
      document.execCommand = cmd;
      const box = document.querySelector('.copy-link-fallback');
      return JSON.stringify({ hidden: box.hidden, value: box.value, focused: document.activeElement === box, selected: box.selectionEnd - box.selectionStart === box.value.length });
    })()`));
    if (refused.hidden || refused.value !== expected || !refused.focused || !refused.selected) throw new Error('with both clipboard routes refused the address must be offered for a hand copy: ' + JSON.stringify(refused));
    console.log(`  Copy link to this list → ${copied.copied[0]}; "Copied" + live line, then back; refused clipboard → read-only box, selected`);
    await s.evalJs(`document.querySelector('[data-key="filter.clear"]').click()`);
    await s.waitFor(`document.querySelectorAll('.all-courses table.course-rules tbody tr:not(.note-row)').length > 10`);
  }

  // "Find a course ↓" (U25): on the masthead's top line, standalone only; the
  // click lands ON the search box (fragment navigation alone focuses nothing).
  {
    const find = JSON.parse(await s.evalJs(`JSON.stringify((() => {
      const a = document.querySelector('[data-key="masthead.find-course"]');
      if (!a) return { present: false };
      const top = a.getBoundingClientRect().top + window.scrollY;
      a.click();
      return { present: true, href: a.getAttribute('href'), text: a.textContent, top, focused: document.activeElement?.id ?? '', hash: location.hash };
    })())`));
    if (!find.present || find.href !== '#filter-search' || find.text !== 'Find a course ↓') throw new Error('the masthead must carry the "Find a course ↓" link: ' + JSON.stringify(find));
    if (find.top > 200) throw new Error('"Find a course ↓" must be on the masthead’s top line, not ' + find.top + ' px down');
    if (find.focused !== 'filter-search') throw new Error('"Find a course ↓" must leave the search box focused: ' + JSON.stringify(find));
    console.log(`  Find a course ↓ at ${Math.round(find.top)} px → the search box is focused (${find.hash})`);
  }

  // The key's "Not yet decided — ask first" entry (U31) only while some row —
  // retired ones included — has a blank verdict, as "Pending" has been since
  // P-18. Whatever today's sheet holds, the key and the table must agree.
  {
    await s.evalJs(`(() => { const c = document.querySelector('[data-key="filter.retired"]'); if (!c.checked) { c.click(); } })()`);
    await s.waitFor(`document.querySelector('[data-key="filter.retired"]').checked && document.querySelectorAll('.all-courses table.course-rules tbody tr.retired').length > 0`, 4000).catch(() => {});
    const undecided = JSON.parse(await s.evalJs(`JSON.stringify({ key: !!document.querySelector('.legend-key .pill.undecided'), table: !!document.querySelector('.all-courses table.course-rules tbody .pill.undecided'), retiredRows: document.querySelectorAll('.all-courses table.course-rules tbody tr.retired').length, keyText: document.querySelector('.legend-key').textContent })`));
    if (undecided.key !== undecided.table) throw new Error('the key must show "Not yet decided" exactly when a row carries it: ' + JSON.stringify(undecided));
    if (!/No does not count( · Not yet decided ask first)?( · Pending[^.]*)?\.$/.test(undecided.keyText)) throw new Error('the key line’s separators: ' + JSON.stringify(undecided.keyText));
    console.log(`  key line: "Not yet decided" ${undecided.key ? 'shown — a row carries it' : 'not shown — no row (retired included: ' + undecided.retiredRows + ') carries it'}`);
    await s.evalJs(`document.querySelector('[data-key="filter.clear"]').click()`);
    await s.waitFor(`document.querySelectorAll('.all-courses table.course-rules tbody tr:not(.note-row)').length > 10`);
  }

  // Embedded links (DGS 2026-09-16): with the host page named in the query
  // string, the cross-link goes there in the top window; without it, the
  // sibling file.
  {
    await s.open(new URL('courses.html?self_check_url=https%3A%2F%2Fcse.nd.edu%2Fgraduate%2Fself-check%2F', baseUrl).href, '.all-courses table.course-rules');
    const link = JSON.parse(await s.evalJs(`JSON.stringify((() => { const a = [...document.querySelectorAll('a')].find(a => /degree self-check tool/.test(a.textContent)); return { href: a?.getAttribute('href'), target: a?.getAttribute('target') }; })())`));
    if (link.href !== 'https://cse.nd.edu/graduate/self-check/' || link.target !== '_top') throw new Error('embedded cross-link must go to the host page in the top window: ' + JSON.stringify(link));
    await s.open(new URL('courses.html', baseUrl).href, '.all-courses table.course-rules');
    const plain = await s.evalJs(`[...document.querySelectorAll('a')].find(a => /degree self-check tool/.test(a.textContent))?.getAttribute('href')`);
    if (plain !== './index.html') throw new Error('standalone cross-link must be the sibling file: ' + plain);
    // Embedded with nothing named (the live ND page's own iframe src, 2026-09-30):
    // the ND page that frames the self-check, in the top window.
    await s.open(new URL('courses.html?embed=1', baseUrl).href, '.all-courses table.course-rules');
    const dflt = JSON.parse(await s.evalJs(`JSON.stringify((() => { const a = [...document.querySelectorAll('a')].find(a => /degree self-check tool/.test(a.textContent)); return { href: a?.getAttribute('href'), target: a?.getAttribute('target') }; })())`));
    if (dflt.href !== 'https://sites.nd.edu/csedept/degree-requirement-self-checking/' || dflt.target !== '_top') throw new Error('embedded cross-link must default to the ND page in the top window: ' + JSON.stringify(dflt));
    console.log('  cross-links: host page in the top window when named, the ND page by default when embedded, sibling file standalone');
  }
  // Qualifier-card courses (DGS 2026-09-17): a course offered this semester
  // links to its schedule row; one not offered links to its All-courses row;
  // the hover card names both semesters.
  {
    const q = JSON.parse(await s.evalJs(`JSON.stringify((() => {
      const items = [...document.querySelectorAll('.overview:not(.schedule-overview) a.ov-item')];
      const offered = items.find((a) => a.getAttribute('href').startsWith('#sched-'));
      const other = items.find((a) => !a.getAttribute('href').startsWith('#sched-'));
      const target = (a) => a && !!document.getElementById(a.getAttribute('href').slice(1));
      return { n: items.length, offeredHref: offered?.getAttribute('href') ?? null, offeredTargetExists: target(offered), otherTargetExists: target(other) };
    })())`));
    if (q.n === 0) throw new Error('no qualifier-card courses rendered');
    if (q.offeredHref && !q.offeredTargetExists) throw new Error('a qualifier link to the schedule must resolve: ' + q.offeredHref);
    if (q.otherTargetExists === false) throw new Error('a qualifier link to All courses must resolve');
    // The offering shows as a tag on the course, not in the hover card (DGS 2026-09-17, second pass).
    const tagged = await s.evalJs(`document.querySelectorAll('.overview:not(.schedule-overview) a.ov-item .pill.sched-now, .overview:not(.schedule-overview) a.ov-item .pill.sched-next').length`);
    if (q.offeredHref && tagged === 0) throw new Error('an offered qualifier course must carry a semester tag');
    const hover = await s.evalJs(`(() => { const a = document.querySelector('.overview:not(.schedule-overview) a.ov-item'); a.dispatchEvent(new Event('mouseenter')); const t = document.querySelector('#course-pop').textContent; a.dispatchEvent(new Event('mouseleave')); return t; })()`);
    if (/Offered (Fall|Spring) \d{4}/.test(hover)) throw new Error('the hover card must not show the offering status: ' + hover.slice(0, 200));
    console.log('  qualifier cards: links → schedule row when offered (' + (q.offeredHref ?? 'none offered') + '), else All courses; ' + tagged + ' semester tag(s)');

    // The review of 2026-09-18, in the browser. Each of these was a defect the
    // page shipped with: the key promising a marker no course carries (R-8),
    // retired courses missing from the cards the engine still counts them for
    // (B-3), the ADGS pill in the DGS colour inside the column guide (B-13),
    // the rule-version note written and never shown (B-1), and blanks sorting
    // to the top when a column is reversed (B-8).
    const rv = JSON.parse(await s.evalJs(`JSON.stringify((() => {
      const key = document.querySelector('.sched-key');
      const cards = [...document.querySelectorAll('.overview:not(.schedule-overview) .ov-card')];
      const legend = document.querySelector('details.legend');
      if (legend) legend.open = true;
      const legendPills = [...document.querySelectorAll('details.legend li .pill')].map((p) => p.textContent.trim() + '=' + p.className);
      return {
        keyText: key?.textContent ?? '',
        keyNowPills: key ? key.querySelectorAll('.sched-now').length : 0,
        keyNextPills: key ? key.querySelectorAll('.sched-next').length : 0,
        anyNextTag: document.querySelectorAll('.overview:not(.schedule-overview) .pill.sched-next').length,
        retiredInCards: document.querySelectorAll('.overview:not(.schedule-overview) a.ov-item .pill.retired').length,
        emptyCards: cards.filter((c) => /No current course is listed here/.test(c.textContent)).length,
        cardText: cards.map((c) => c.textContent).join(' '),
        adgsInLegend: legendPills.filter((x) => /^With ADGS approval=/.test(x)),
        // A character class, not a backslash escape: inside this template
        // literal \* would reach the page as a bare *, i.e. "zero or more spaces".
        starMarks: (document.querySelector('.overview:not(.schedule-overview)').textContent.match(/ [*]/g) ?? []).length,
        starContext: (document.querySelector('.overview:not(.schedule-overview)').textContent.match(/.{0,40} [*].{0,10}/g) ?? []).slice(0, 2),
        citeCursor: getComputedStyle(document.querySelector('.courses-page .cite')).cursor,
      };
    })())`));
    // The key must not advertise a semester with no tags anywhere on the page.
    if (rv.keyNextPills > 0 && rv.anyNextTag === 0) throw new Error('the key promises a next-semester tag that no course carries: ' + rv.keyText);
    if (rv.keyNowPills === 0 && rv.keyNextPills === 0 && /offered/.test(rv.keyText)) throw new Error('key line without pills: ' + rv.keyText);
    // Retired courses are NOT in these cards (DGS 2026-09-18, reversing his
    // answer of an hour before), and an empty card must not claim that nothing
    // is assigned when a retired course is.
    if (rv.retiredInCards > 0) throw new Error('a retired course is listed in a qualifying-examination card — the DGS asked for current courses only');
    if (/No course assigned yet/.test(rv.cardText)) throw new Error('an empty qualifier card must not say "No course assigned yet" — a retired course may be assigned');
    if (rv.adgsInLegend.some((x) => /pill approval(?!-adgs)/.test(x))) throw new Error('the ADGS pill in the column guide is painted with the DGS class: ' + JSON.stringify(rv.adgsInLegend));
    if (rv.starMarks > 0) throw new Error('the unexplained " *" marker is back in the qualifier cards: ' + JSON.stringify(rv.starContext));
    if (rv.citeCursor === 'pointer') throw new Error('the § citations on this page are labels, not buttons — they must not offer a hand cursor');
    console.log('  review 2026-09-18: key ' + JSON.stringify(rv.keyText.slice(0, 64)) + '; retired in cards ' + rv.retiredInCards + ' (must be 0); ADGS pill ' + JSON.stringify(rv.adgsInLegend));

    // Blanks stay at the END when a column is reversed (B-8).
    const blanks = JSON.parse(await s.evalJs(`JSON.stringify((() => {
      const read = () => [...document.querySelectorAll('.all-courses tbody tr')].map((tr) => tr.cells[5]?.textContent ?? '');
      const press = () => document.querySelector('[data-key="sort.core"]').click();
      press();
      const asc = read();
      press();
      const desc = read();
      press();
      return { ascFirst: asc[0], ascLast: asc[asc.length - 1], descFirst: desc[0], descLast: desc[desc.length - 1] };
    })())`));
    if (blanks.descFirst === '—') throw new Error('descending sort put the blank rows first: ' + JSON.stringify(blanks));
    if (blanks.ascFirst === '—') throw new Error('ascending sort put the blank rows first: ' + JSON.stringify(blanks));
    console.log('  sort: blanks last in both directions (' + blanks.ascFirst + '…' + blanks.ascLast + ' / ' + blanks.descFirst + '…' + blanks.descLast + ')');

    // A link someone was SENT, opened cold — the page has to re-apply the
    // fragment itself, because the browser resolved it while this page was
    // still the loading card (B-7).
    const deep = JSON.parse(await s.evalJs(`JSON.stringify([...document.querySelectorAll('.all-courses tbody tr')].slice(0, 1).map((tr) => tr.id))`));
    if (deep[0]) {
      // Leave this document first, so the fragment navigation is a real load —
      // which is the case that was broken: a link someone was SENT. Opening
      // `courses.html#x` from `courses.html` is a same-document scroll, and
      // `:target` handles that one natively.
      await s.open(baseUrl);
      await s.open(new URL('courses.html#' + deep[0], baseUrl).href, '.all-courses table.course-rules');
      // The page re-applies the fragment a frame (or 120 ms) after render, so
      // wait for the mark rather than racing it.
      await s.waitFor(`document.querySelector('.deep-linked')`, 5000).catch(() => {});
      const landed = JSON.parse(await s.evalJs(`JSON.stringify((() => {
        const t = document.getElementById(${JSON.stringify(deep[0])});
        return { id: ${JSON.stringify(deep[0])}, scrollY: Math.round(window.scrollY), marked: !!document.querySelector('.deep-linked'), rowExists: !!t, rowTop: t ? Math.round(t.getBoundingClientRect().top + window.scrollY) : null, nav: performance.getEntriesByType('navigation')[0]?.type, href: location.href, rows: document.querySelectorAll('.all-courses tbody tr').length };
      })())`));
      if (!landed.marked) throw new Error('a cold deep link did not mark its row: ' + JSON.stringify(landed));
      console.log('  cold deep link #' + deep[0] + ' → scrollY ' + landed.scrollY + ', row highlighted');
      await s.open(new URL('courses.html', baseUrl).href, '.all-courses table.course-rules');
    }
  }

  // Two schedule cards (DGS 2026-09-09), which say "Not released yet." while
  // the sheet's offered_now / offered_next are blank rather than showing an
  // empty list that would read as "nothing runs".
  const cards = JSON.parse(await s.evalJs(`JSON.stringify((() => {
    const sec = document.querySelector('.schedule-overview');
    if (!sec) return { present: false };
    const cs = [...sec.querySelectorAll('.ov-card')];
    return {
      present: true,
      headings: cs.map((c) => c.querySelector('h3')?.textContent ?? ''),
      bodies: cs.map((c) => (c.textContent ?? '').replace(c.querySelector('h3')?.textContent ?? '', '').trim().slice(0, 60)),
      // The cards hold a table of courses since 2026-09-09, not a plain list.
      items: cs.map((c) => c.querySelectorAll('tbody tr').length),
    };
  })())`));
  if (!cards.present) throw new Error('the two "On the schedule" cards are missing');
  if (cards.headings.length !== 2) throw new Error('expected two schedule cards: ' + JSON.stringify(cards.headings));
  if (!/^Offered this semester — /.test(cards.headings[0]) || !/^Offered next semester — /.test(cards.headings[1])) {
    throw new Error('schedule card headings: ' + JSON.stringify(cards.headings));
  }
  for (let i = 0; i < 2; i++) {
    // Either the sheet has spoken and the card lists courses (or says none is
    // listed), or it has not and the card says so — never a bare empty card.
    // "Not released yet" became "The rules sheet does not list <term> yet" on
    // 2026-09-18 (review R-14: the old phrasing blamed the registrar for a
    // sheet nobody had filled in), and a card with only a handful of answers
    // says how many rather than "no course is listed" (R-9).
    if (cards.items[i] === 0 && !/does not list .* yet|No course is listed|marked for .* so far/.test(cards.bodies[i])) {
      throw new Error(`schedule card ${i + 1} is empty without saying why: ${JSON.stringify(cards.bodies[i])}`);
    }
  }
  console.log('  schedule cards:', cards.headings.map((h, i) => `${h} (${cards.items[i] > 0 ? cards.items[i] + ' courses' : cards.bodies[i]})`).join(' | '));
  // A card may only ever list courses under a semester the row itself has
  // dated (DGS 2026-09-09; per row by `last_offered` since 2026-09-14): the
  // headings come from today, the columns do not. Fresh rows are listed;
  // stale or undated ones are left out and COUNTED in a "not shown" line, so
  // the two can coexist — but nothing listed and no reason given never can.
  const dated = JSON.parse(await s.evalJs(`JSON.stringify((() => {
    const sec = document.querySelector('.schedule-overview');
    const text = sec.textContent ?? '';
    return { listed: [...sec.querySelectorAll('.ov-card')].some((c) => c.querySelector('tbody tr')), refused: /not shown/.test(text) };
  })())`));
  if (!dated.listed && !dated.refused && !/does not list .* yet/.test(await s.evalJs(`document.querySelector('.schedule-overview').textContent`))) {
    throw new Error('the schedule cards show nothing and give no reason');
  }

  // The schedule filter (DGS 2026-09-09) appears only once the sheet's
  // offered_now / offered_next columns say something, so the check adapts to
  // whichever the live sheet currently is.
  const sched = JSON.parse(await s.evalJs(`JSON.stringify((() => {
    const sel = document.querySelector('[data-key="filter.offered"]');
    return sel ? { present: true, options: [...sel.options].map((o) => o.value), labels: [...sel.options].map((o) => o.textContent) } : { present: false };
  })())`));
  if (!sched.present) {
    console.log('  schedule filter: not shown — no course in the sheet carries offered_now/offered_next yet');
  } else {
    // A semester the sheet has not recorded is not offered as a choice, so the
    // control may hold "now", "next" or both — never neither, or it would not
    // be on the page at all.
    if (sched.options[0] !== '' || sched.options.length < 2 || sched.options.slice(1).some((o) => o !== 'now' && o !== 'next')) {
      throw new Error('schedule filter options: ' + JSON.stringify(sched.options));
    }
    if (!sched.labels.slice(1).every((l) => /Offered (this|next) semester \(/.test(l))) {
      throw new Error('the schedule options must name their semesters: ' + JSON.stringify(sched.labels));
    }
    const before = await s.evalJs(`document.querySelectorAll('.all-courses table.course-rules tbody tr:not(.note-row)').length`);
    await s.evalJs(`(() => { const sel = document.querySelector('[data-key="filter.offered"]'); sel.value = 'now'; sel.dispatchEvent(new Event('change')); })()`);
    await s.waitFor(`document.querySelectorAll('.all-courses table.course-rules tbody tr:not(.note-row)').length !== ${before}`);
    const after = await s.evalJs(`document.querySelectorAll('.all-courses table.course-rules tbody tr:not(.note-row)').length`);
    if (!(after > 0 && after < before)) throw new Error(`the schedule filter did not narrow the table (${before} → ${after})`);
    // The address is written on a 250 ms trailing timer since 2026-09-18
    // (review B-33: Safari throttles history writes and stopped following the
    // page altogether), so wait for it rather than reading it in the same tick.
    await s.waitFor(`/offered=now/.test(window.location.search)`, 3000).catch(() => {});
    if (!/offered=now/.test(await s.evalJs(`window.location.search`))) throw new Error('the schedule filter must reach the address bar');
    console.log(`  schedule filter: ${before} → ${after} rows offered this semester, and the URL carries it`);
    await s.evalJs(`document.querySelector('[data-key="filter.clear"]').click()`);
    await s.waitFor(`document.querySelectorAll('.all-courses table.course-rules tbody tr:not(.note-row)').length > 10`);
  }

  // Specialization categories (DGS 2026-09-08): "Listed under every category"
  // is gone as a sixth category, a course listed under several categories
  // stands in EACH of their cards, and the note above them says it can fill
  // only one. A blank Specialization cell sorts LAST, not first.
  const spec = JSON.parse(await s.evalJs(`JSON.stringify((() => {
    const sel = document.querySelector('[data-key="filter.qualifier"]');
    const opts = [...sel.options].map((o) => o.value.replace(/^(core|cat):/, ''));
    // The specialization cards are the qualifier section's grid — by class, not by position (the sections were reordered 2026-09-16).
    const cards = [...document.querySelectorAll('.overview:not(.schedule-overview) .ov-grid')].pop();
    const headings = [...cards.querySelectorAll('.ov-card h3')].map((h) => h.textContent.trim());
    const inEvery = headings.every((_, i) => cards.querySelectorAll('.ov-card')[i].textContent.includes('CSE 60876'));
    const note = [...document.querySelectorAll('.overview p')].map((p) => p.textContent).find((t) => /fill only/.test(t)) ?? '';
    return { opts, headings, inEvery, note };
  })())`));
  if (spec.opts.includes('any-listed')) throw new Error('the "Listed under every category" filter value is still offered');
  if (spec.headings.length !== 5) throw new Error('expected the five real specialization cards, got ' + JSON.stringify(spec.headings));
  if (!spec.inEvery) throw new Error('a course listed under every category must appear in every card: ' + JSON.stringify(spec.headings));
  // "never several" restated "only one" and went on 2026-09-18 (trim review
  // P-3); the rule it emphasised is what must still be there.
  if (!/can fill only/.test(spec.note)) throw new Error('the "fills only one category" note is missing: ' + spec.note);
  console.log('  specialization cards:', spec.headings.join(', '), '— the flexible course is in each, with the "only one" note');
  await s.evalJs(`(() => { const sel = document.querySelector('[data-key="filter.sort"]'); sel.value = 'category'; sel.dispatchEvent(new Event('change')); })()`);
  await s.waitFor(`document.querySelectorAll('.all-courses table.course-rules tbody tr:not(.note-row)').length > 10`);
  const firstSpec = await s.evalJs(`document.querySelector('.all-courses table.course-rules tbody tr:not(.note-row) td[data-label^="Specialization"]')?.textContent.trim()`);
  if (!firstSpec || firstSpec === '—') throw new Error('sorting by Specialization must put the rows WITH a category first, got: ' + JSON.stringify(firstSpec));
  console.log('  sort by Specialization → first row is', JSON.stringify(firstSpec) + ', blanks last');
  await s.evalJs(`document.querySelector('[data-key="filter.clear"]').click()`);
  await s.waitFor(`document.querySelectorAll('.all-courses table.course-rules tbody tr:not(.note-row)').length > 10`);

  // Filters live in the URL (2026-09-05, item 29) and a view picks the columns
  // (item 30): open a shared link, check what it selected, then change a
  // filter and check the address bar followed.
  await s.open(new URL('courses.html?view=mscse&core=algorithms', baseUrl).href, '.all-courses table.course-rules');
  const shared = JSON.parse(await s.evalJs(`JSON.stringify({ view: document.querySelector('[data-key="filter.view"]').value, core: document.querySelector('[data-key="filter.qualifier"]').value, program: document.querySelector('[data-key="filter.program"]').value, hiddenHeaders: document.querySelectorAll('.all-courses table.course-rules thead th.col-hidden').length, rows: document.querySelectorAll('.all-courses table.course-rules tbody tr:not(.note-row)').length })`));
  if (shared.view !== 'mscse' || shared.core !== 'core:algorithms') throw new Error('shared link did not select the view/filters: ' + JSON.stringify(shared));
  // The view picks the COLUMNS and must not narrow the rows (trim review P-19):
  // a shared link that names only a view leaves every course in the table.
  if (shared.program !== 'all') throw new Error('the view must not pre-set the Program filter: ' + JSON.stringify(shared));
  if (shared.hiddenHeaders !== 3) throw new Error('the M.S. view should hide 3 columns, hid ' + shared.hiddenHeaders);
  await s.evalJs(`(() => { const q = document.querySelector('[data-key="filter.search"]'); q.value = 'algorithms'; q.dispatchEvent(new Event('input')); })()`);
  await s.waitFor(`/q=algorithms/.test(window.location.search)`, 3000).catch(() => {});
  const search = await s.evalJs(`window.location.search`);
  if (!/q=algorithms/.test(search) || !/view=mscse/.test(search)) throw new Error('the address bar did not follow the filters: ' + search);
  console.log(`  shared link → view/filters applied (${shared.rows} rows, 3 columns hidden); filters written back to the URL (${search})`);

  await checkPrintColumns(s, baseUrl, '');
  await checkPrintColumns(s, baseUrl, '?embed=1');
  await checkPrintAtPaperWidth(s, baseUrl);
  await driveCoursesEmbed(s, baseUrl);
}

// E2E: what a student actually gets when they print the course list
// (2026-09-16). The print block used to carry `th:last-child { display: none }`
// — written when the last column was the DGS's notes, which this page stopped
// showing on 2026-09-09. Unscoped, it went on hiding the last HEADER of every
// table on the page while the cells under it still printed: "DGS reviewed" on
// the main table, "Specialization" on each schedule card. A printed column with
// no heading is the bug this pins.
async function checkPrintColumns(s, baseUrl, query) {
  await s.open(new URL('courses.html' + query, baseUrl).href, '.all-courses table.course-rules');
  await s.send('Emulation.setEmulatedMedia', { media: 'print' });
  await s.settle(200);
  const tables = JSON.parse(
    await s.evalJs(`JSON.stringify([...document.querySelectorAll('table.course-rules')].map((t) => {
      const shown = (e) => getComputedStyle(e).display !== 'none';
      const heads = [...t.querySelectorAll('thead tr:last-child th')];
      const row = t.querySelector('tbody tr:not(.empty-row)');
      const cells = row ? [...row.children] : [];
      const last = heads[heads.length - 1];
      return {
        table: t.classList.contains('schedule-table') ? 'schedule card' : 'all courses',
        visibleHeaders: heads.filter(shown).length,
        visibleCells: cells.filter(shown).length,
        lastHeader: (last ? last.getAttribute('abbr') || last.textContent || '' : '').trim().slice(0, 28),
        lastHeaderShown: last ? shown(last) : null,
      };
    }))`),
  );
  // The card is text on paper, not a boxed aside — on BOTH pages. Embed mode
  // moves it out of the masthead and restyles it, which outranks a print rule
  // scoped to `.masthead`; without the embed selector the framed page printed a
  // bordered card (measured 2026-09-16).
  const card = JSON.parse(
    await s.evalJs(`(() => {
      const c = document.querySelector('.contact-card');
      if (!c) return JSON.stringify({ missing: true });
      const cs = getComputedStyle(c);
      // On paper the sort buttons are plain header text (display: contents —
      // Chrome repeated the header as an empty band on later landscape pages),
      // and the card never splits across two sheets (2026-10-10).
      const sorts = [...document.querySelectorAll('table.course-rules th .sort')].map((b) => getComputedStyle(b).display);
      return JSON.stringify({ border: cs.borderTopWidth, padding: cs.paddingTop, breakInside: cs.breakInside, sorts: sorts.length, sortsNotContents: sorts.filter((d) => d !== 'contents').length, appPadBottom: getComputedStyle(document.querySelector('#app')).paddingBottom });
    })()`),
  );
  await s.send('Emulation.setEmulatedMedia', { media: '' });
  await s.settle();
  if (!tables.length) throw new Error('no course tables found under print media');
  for (const t of tables) {
    if (!t.lastHeaderShown) throw new Error(`printing hides the "${t.lastHeader}" header of the ${t.table} table while its cells still print`);
    if (t.visibleHeaders !== t.visibleCells) {
      throw new Error(`the ${t.table} table prints ${t.visibleCells} columns under ${t.visibleHeaders} headers`);
    }
  }
  if (card.missing) throw new Error('the contact card is not on the page at all');
  if (card.border !== '0px' || card.padding !== '0px') throw new Error(`the contact card prints as a box (border ${card.border}, padding ${card.padding})`);
  if (card.breakInside !== 'avoid') throw new Error(`the contact card may split across two printed sheets (break-inside ${card.breakInside})`);
  if (card.appPadBottom !== '0px') throw new Error(`on paper the page must end where the content does (a blank last sheet): #app padding-bottom ${card.appPadBottom}`);
  if (card.sorts < 1 || card.sortsNotContents > 0) throw new Error(`on paper the sort buttons must be plain header text (${card.sortsNotContents} of ${card.sorts} are not display: contents)`);
  console.log(`  printing courses.html${query || ' (plain)'}: ${tables.length} tables, every column keeps its heading (last: ${[...new Set(tables.map((t) => t.lastHeader))].join(', ')}); contact card unboxed`);
}

// The add-a-course form as each engine draws it (cross-browser review,
// 2026-10-10): Safari ignores a drop-down's vertical padding, so its
// drop-downs were 23 px tall beside 38.5 px boxes until they were given the
// boxes' height; Firefox always draws a number box's spinner, which covered the
// last digit of "2026" in the 72 px year box. Row 3 ("From another
// university": the University box, Taken as, the specialization group, Add)
// is shown for the measurement and hidden again, so nothing on the page
// changes and nothing depends on the sheet.
async function checkFormControls(s) {
  const m = JSON.parse(await s.evalJs(`JSON.stringify((() => {
    const form = document.querySelector('.course-form');
    const hidden = [...form.querySelectorAll('.row3 .hidden')];
    hidden.forEach((e) => e.classList.remove('hidden'));
    const h = (e) => Math.round(e.getBoundingClientRect().height * 2) / 2;
    const box = form.querySelector('.row2 input:not([type="checkbox"])');
    const selects = [...form.querySelectorAll('select')].filter((e) => e.getClientRects().length > 0).map((e) => ({ k: e.dataset.key, h: h(e) }));
    const others = ['course.new.institution', 'course.new.add'].map((k) => form.querySelector('[data-key="' + k + '"]')).filter((e) => e && e.getClientRects().length > 0).map((e) => ({ k: e.dataset.key, h: h(e) }));
    hidden.forEach((e) => e.classList.add('hidden'));
    const year = form.querySelector('[data-key="course.new.year"]');
    const was = year.value;
    year.value = '2026';
    const fit = { scroll: year.scrollWidth, client: year.clientWidth };
    year.value = was;
    return { box: box ? h(box) : 0, selects, others, fit };
  })())`));
  const keys = m.selects.map((x) => x.k);
  if (!['course.new.season', 'course.new.level', 'course.new.group'].every((k) => keys.includes(k))) throw new Error('expected the form\'s drop-downs, row 3\'s included: ' + JSON.stringify(keys));
  const off = [...m.selects, ...m.others].filter((x) => Math.abs(x.h - m.box) > 1);
  if (off.length > 0) throw new Error(`the add-a-course drop-downs, boxes and button must be as tall as its boxes (${m.box} px): ${JSON.stringify([...m.selects, ...m.others])}`);
  if (m.fit.scroll > m.fit.client) throw new Error(`the year box cuts "2026" (${m.fit.scroll} > ${m.fit.client} px)`);
  console.log(`  add-a-course form: ${m.selects.length} drop-downs as tall as the boxes (${m.box} px); "2026" fits the year box (${m.fit.scroll}/${m.fit.client} px)`);
}

// The cards' left stripe follows the pill (cross-browser review, 2026-10-10):
// a card overdue is red, one due soon the deadline colour, a stage not started
// grey. These were :has() rules, which Firefox before 121 drops; they are now
// classes the card carries. Keyed on the pill, so a card whose classes drift
// from its pill fails here.
async function checkCardStripes(s, need) {
  const m = JSON.parse(await s.evalJs(`JSON.stringify((() => {
    const probe = document.createElement('div');
    document.body.append(probe);
    const token = (t) => { probe.style.color = 'var(' + t + ')'; return getComputedStyle(probe).color; };
    const want = { bad: token('--bad'), due: token('--due-line'), line: token('--line') };
    probe.remove();
    const cards = [...document.querySelectorAll('#report .req')].flatMap((req) => {
      const pill = req.querySelector('.req-head .pill');
      if (!pill) return [];
      const unmet = req.classList.contains('s-unmet');
      const kind = unmet && pill.classList.contains('s-notstarted') ? 'line' : unmet && pill.classList.contains('s-overdue') ? 'bad' : pill.classList.contains('s-duesoon') ? 'due' : null;
      return kind ? [{ id: req.id, kind, ok: getComputedStyle(req).borderLeftColor === want[kind] }] : [];
    });
    return { cards, wrong: cards.filter((c) => !c.ok) };
  })())`));
  const missing = need.filter((k) => !m.cards.some((c) => c.kind === k));
  if (missing.length > 0) throw new Error(`expected ${missing.join(' and ')} cards here: ` + JSON.stringify(m.cards));
  if (m.wrong.length > 0) throw new Error('a card\'s stripe does not follow its pill: ' + JSON.stringify(m.wrong));
  const n = (k) => m.cards.filter((c) => c.kind === k).length;
  console.log(`  card stripes follow the pill: ${n('due')} due soon, ${n('line')} not started, ${n('bad')} overdue`);
}

// E2E: printing from a desk-width window (cross-browser review, 2026-10-10).
// Chrome — so Edge and Opera too — lays a printout out at the paper's width,
// about 740 px on portrait Letter or A4, which is under the schedule cards'
// 861 px breakpoint. The cards' width listener then closed the "Offered this
// semester" card that beforeprint had just opened, and it printed as a bare
// heading. Emulating print media alone never narrows the page, so this check
// fires beforeprint, narrows the window as the paper does, and looks.
async function checkPrintAtPaperWidth(s, baseUrl) {
  await s.setViewport({ width: 1400, height: 1900 });
  await s.open(new URL('courses.html', baseUrl).href, '.all-courses table.course-rules');
  await checkContactWhilePrinting(s, 'courses.html');
  const opens = () => s.evalJs(`JSON.stringify([...document.querySelectorAll('.sched-details')].map((d) => d.open))`).then(JSON.parse);
  const before = await opens();
  await s.evalJs(`window.dispatchEvent(new Event('beforeprint'))`);
  await s.setViewport({ width: 740, height: 1900, settleMs: 250 });
  const during = await opens();
  await s.evalJs(`window.dispatchEvent(new Event('afterprint'))`);
  await s.setViewport({ width: 1400, height: 1900, settleMs: 250 });
  const after = await opens();
  if (before.length < 1) throw new Error('expected the schedule cards on courses.html');
  if (!during.every(Boolean)) throw new Error(`a schedule card closed while printing at paper width (${JSON.stringify({ before, during, after })})`);
  if (!after.every(Boolean)) throw new Error(`the schedule cards must be open again at desk width after printing (${JSON.stringify(after)})`);
  console.log(`  printing at paper width (740 px): ${during.length} schedule card(s) stay open, and open at 1400 px after`);

  // On paper the course list is a TABLE at every size (DGS 2026-10-10,
  // "Tables"): the phone cards are screen-only, where they printed 36 pages on
  // portrait paper. And the table fits the sheet: at A4 portrait's 717 px the
  // All courses table needed 870 px and its right-hand columns were cut off.
  // As a real print does it: beforeprint (which opens the schedules), then the
  // paper's width, then print media.
  await s.evalJs(`window.dispatchEvent(new Event('beforeprint'))`);
  await s.setViewport({ width: 717, height: 1900, settleMs: 250 });
  await s.send('Emulation.setEmulatedMedia', { media: 'print' });
  await s.settle(200);
  const paper = JSON.parse(await s.evalJs(`JSON.stringify((() => {
    const tables = [...document.querySelectorAll('table.course-rules')].map((t) => {
      const row = t.querySelector('tbody tr:not(.empty-row)');
      const r = t.getBoundingClientRect();
      return { schedule: t.classList.contains('schedule-table'), row: row ? getComputedStyle(row).display : null, head: getComputedStyle(t.querySelector('thead')).position, right: Math.round(r.right), scroll: t.parentElement.scrollWidth - t.parentElement.clientWidth };
    });
    const open = [...document.querySelectorAll('.sched-details')].map((d) => d.open);
    return { width: innerWidth, page: document.documentElement.scrollWidth, open, tables };
  })())`));
  await s.send('Emulation.setEmulatedMedia', { media: '' });
  await s.evalJs(`window.dispatchEvent(new Event('afterprint'))`);
  await s.setViewport({ width: 1400, height: 1900, settleMs: 250 });
  if (!paper.open.length || !paper.open.every(Boolean)) throw new Error('the schedules must be open while printing on portrait paper: ' + JSON.stringify(paper.open));
  const cards = paper.tables.filter((t) => t.row !== 'table-row' || t.head === 'absolute');
  if (paper.tables.length < 2 || cards.length > 0) throw new Error('on paper every course table must print as a table, not as cards: ' + JSON.stringify(paper));
  const cut = paper.tables.filter((t) => t.right > paper.width || t.scroll > 0);
  if (paper.page > paper.width || cut.length > 0) throw new Error(`the course tables must fit portrait paper (${paper.width} px) or their right-hand columns are cut off: ` + JSON.stringify(paper));
  console.log(`  printing on portrait paper (${paper.width} px): ${paper.tables.length} course tables print as tables and fit (widest ends at ${Math.max(...paper.tables.map((t) => t.right))} px)`);
}

// The contact card while printing, on either page (cross-browser review,
// 2026-10-10). It sits in the masthead from 900 px up and at the end of the
// page below. Chrome lays a printout out at the paper's width (~740 px on
// portrait paper) and fired the width listener mid-print: the card moved after
// pagination — printed on the last page, or leaving a blank last sheet. It now
// stays put until afterprint, then takes the place the window wants, and a
// print never drops keyboard focus from a link inside it.
async function checkContactWhilePrinting(s, page) {
  const where = () => s.evalJs(`(() => { const c = document.querySelector('.contact-card'); return !c ? 'none' : c.closest('.masthead') ? 'masthead' : 'end'; })()`);
  await s.setViewport({ width: 1400, height: 1900, settleMs: 200 });
  const before = await where();
  await s.evalJs(`window.dispatchEvent(new Event('beforeprint'))`);
  await s.setViewport({ width: 740, height: 1900, settleMs: 250 });
  const during = await where();
  await s.evalJs(`window.dispatchEvent(new Event('afterprint'))`);
  await s.settle(150);
  const afterNarrow = await where();
  await s.setViewport({ width: 1400, height: 1900, settleMs: 250 });
  const afterWide = await where();
  const steps = { before, during, afterNarrow, afterWide };
  if (before !== 'masthead' || during !== 'masthead' || afterNarrow !== 'end' || afterWide !== 'masthead') {
    throw new Error(`${page}: the contact card must stay put while printing and then follow the window: ${JSON.stringify(steps)}`);
  }
  const focus = await s.evalJs(`(() => {
    const a = document.querySelector('.contact-card a');
    if (!a) return 'no link';
    a.focus();
    window.dispatchEvent(new Event('beforeprint'));
    window.dispatchEvent(new Event('afterprint'));
    const kept = document.activeElement === a;
    a.blur();
    return kept ? 'kept' : 'lost to ' + (document.activeElement?.tagName ?? 'nothing');
  })()`);
  if (focus !== 'kept') throw new Error(`${page}: printing must leave keyboard focus on the contact card's link (${focus})`);
  console.log(`  ${page}: the contact card stays in the masthead while printing at paper width, goes to the end at 740 px after, back at 1400; focus kept`);
}

// E2E: ?embed=1 — the course-rules page inside someone else's page
// (sites.nd.edu WordPress, DGS 2026-09-16). Four things have to hold: the
// chrome the host already supplies is gone, the flag survives the page's own
// URL rewriting, the height the page broadcasts tracks the content both up and
// down, and a parent origin that is not on the allowlist is told nothing.
async function driveCoursesEmbed(s, baseUrl) {
  await s.open(new URL('courses.html?embed=1', baseUrl).href, '.all-courses table.course-rules');
  const trimmed = JSON.parse(
    await s.evalJs(`JSON.stringify({
      eyebrow: !!document.querySelector('.masthead .eyebrow'),
      h1Hidden: document.querySelector('.masthead h1')?.classList.contains('visually-hidden') === true,
      h1Text: document.querySelector('.masthead h1')?.textContent,
      embedClass: document.documentElement.classList.contains('embed'),
      contactInMasthead: !!document.querySelector('.masthead .contact-card'),
      contactAtEnd: !!document.querySelector('main .contact-card'),
      exit: document.querySelector('.embed-exit')?.getAttribute('target'),
      exitHref: document.querySelector('.embed-exit')?.getAttribute('href'),
      selfCheckTarget: document.querySelector('.masthead .sub a[href="./index.html"]')?.getAttribute('target'),
      rulesDate: /last updated|updated after|effective/i.test(document.querySelector('.masthead .effective')?.textContent ?? ''),
      search: window.location.search,
    })`),
  );
  if (trimmed.eyebrow) throw new Error('embed mode still renders the ND eyebrow — the host page already has one');
  if (!trimmed.h1Hidden) throw new Error('embed mode should hide the <h1> visually, not keep it on screen');
  if (!trimmed.h1Text) throw new Error('embed mode dropped the <h1> entirely — screen readers still need it');
  if (!trimmed.embedClass) throw new Error('<html> did not get the `embed` class');
  if (trimmed.contactInMasthead || !trimmed.contactAtEnd) throw new Error('"Who to contact" should move from the masthead to the end of the page: ' + JSON.stringify(trimmed));
  if (trimmed.exit !== '_top') throw new Error('"Open the full page" must leave the frame (target="_top"), got ' + trimmed.exit);
  if (/embed=1/.test(trimmed.exitHref ?? '')) throw new Error('"Open the full page" still carries embed=1: ' + trimmed.exitHref);
  // The masthead's intro, its self-check link and the dated line are not rendered in embed mode since 2026-09-16 (DGS: no text at the top).
  if (trimmed.selfCheckTarget !== undefined) throw new Error('embed mode must not render the masthead intro: ' + JSON.stringify(trimmed));
  if (trimmed.rulesDate) throw new Error('embed mode must not render the dated line either (DGS 2026-09-16: no text at the top)');
  // The page rewrites its own URL from the filters on first render; embed=1 is
  // not a filter and used to be dropped, which lost the mode on any reload.
  if (!/embed=1/.test(trimmed.search)) throw new Error('embed=1 did not survive the filter URL rewrite: ' + trimmed.search);
  console.log('  ?embed=1 → no ND eyebrow, <h1> for screen readers only, contacts at the end, exit link leaves the frame, flag kept in the URL');

  // The height message, watched through the DOM event the sender also fires
  // (src/ui/embed.ts) — same numbers the parent receives, observable without a
  // parent frame. It must FALL when the table is filtered down: sizing a frame
  // from scrollHeight instead would leave white space nothing could reclaim.
  await s.evalJs(`(() => { window.__heights = []; document.addEventListener('nd-cse-audit:height', (e) => window.__heights.push(e.detail.height)); })()`);
  await s.evalJs(`(() => { const q = document.querySelector('[data-key="filter.search"]'); q.value = 'cse60641'; q.dispatchEvent(new Event('input')); })()`);
  await s.waitFor(`window.__heights.length > 0`);
  const shrunk = JSON.parse(await s.evalJs(`JSON.stringify({ heights: window.__heights, docH: Math.ceil(document.documentElement.getBoundingClientRect().height) })`));
  const reported = shrunk.heights[shrunk.heights.length - 1];
  if (Math.abs(reported - shrunk.docH) > 8) throw new Error(`the broadcast height (${reported}) does not match the document (${shrunk.docH})`);
  console.log(`  filtering to one row shrank the broadcast height to ${reported} px, matching the document`);
  // Copy link inside the frame (U27): the FULL page's address — a WordPress
  // page cannot take a query (DGS 2026-09-30) — with the current filters and
  // without embed=1, and no "Find a course" link on the frame's text-free top.
  const framed = JSON.parse(await s.evalJs(`(async () => {
    window.__copied = [];
    navigator.clipboard.writeText = (t) => { window.__copied.push(t); return Promise.resolve(); };
    document.querySelector('[data-key="filter.copy-link"]').click();
    await new Promise((r) => setTimeout(r, 150));
    return JSON.stringify({ copied: window.__copied, find: !!document.querySelector('[data-key="masthead.find-course"]') });
  })()`));
  const framedWant = new URL('courses.html?q=cse60641', baseUrl).href;
  if (framed.copied.length !== 1 || framed.copied[0] !== framedWant) throw new Error('embedded, Copy link must copy the full page’s address without embed=1: ' + JSON.stringify({ ...framed, framedWant }));
  if (framed.find) throw new Error('embed mode must not add "Find a course ↓" to its text-free top (DGS 2026-09-16)');
  console.log(`  embedded Copy link → ${framed.copied[0]} (no embed=1); no Find-a-course link at the top`);

  // The allowlist is the whole access control: a page framed by an origin that
  // is not one of the three ND hosts is told nothing at all. The preview server
  // (http://localhost:4273) is not on it, so framing the page from here must
  // produce silence — if this ever starts passing messages, the targetOrigin
  // has been loosened to '*'.
  await s.open(new URL('courses.html', baseUrl).href, '.all-courses table.course-rules');
  const heard = JSON.parse(
    await s.evalJs(`(async () => {
      const got = [];
      window.addEventListener('message', (e) => { if (e.data && typeof e.data === 'object' && String(e.data.type ?? '').startsWith('nd-cse-audit:')) got.push(e.data.type); });
      const frame = document.createElement('iframe');
      frame.style.cssText = 'width:700px;height:900px;border:0';
      frame.src = 'courses.html?embed=1';
      document.body.append(frame);
      await new Promise((r) => frame.addEventListener('load', r, { once: true }));
      // Wait for the framed page to actually render rather than for a fixed
      // four seconds: the inner page fetches the live sheet from Google, which
      // occasionally takes longer than that and failed this check for reasons
      // having nothing to do with what it tests (2026-09-18). Poll up to 25 s,
      // then wait until the framed page has stopped growing (its height unchanged
      // across two samples, up to 7.5 s) — that is when its broadcasts settle.
      const deadline = Date.now() + 25000;
      const rows = () => frame.contentDocument?.querySelectorAll('.all-courses table.course-rules tbody tr').length ?? 0;
      while (rows() < 10 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 250));
      const quiet = Date.now() + 7500;
      let last = -1;
      while (Date.now() < quiet) {
        await new Promise((r) => setTimeout(r, 250));
        const h = frame.contentDocument?.documentElement.scrollHeight ?? -1;
        if (h === last) break;
        last = h;
      }
      const inner = frame.contentDocument;
      const out = { got, framedRows: inner.querySelectorAll('.all-courses table.course-rules tbody tr').length, framedEyebrow: !!inner.querySelector('.masthead .eyebrow') };
      frame.remove();
      return JSON.stringify(out);
    })()`),
  );
  if (heard.framedRows < 10) throw new Error('the framed page did not render (' + heard.framedRows + ' rows) — the silence below would prove nothing');
  if (heard.framedEyebrow) throw new Error('the framed page rendered the full-page chrome');
  if (heard.got.length > 0) throw new Error('an origin that is NOT on the allowlist received ' + heard.got.join(', ') + ' — targetOrigin has been loosened');
  console.log(`  a parent on an origin outside the allowlist receives nothing (frame rendered ${heard.framedRows} rows, 0 messages)`);

  // What it WOULD have sent, and to whom. The frame is same-origin here, so its
  // `window.parent` is this page: replacing this page's postMessage records
  // every call the sender makes, targetOrigin and all, without the browser's
  // origin check in the way. That is the only way to see the payloads — and it
  // also pins the three ND origins at the point of the call, not just in the
  // exported constant.
  const sent = JSON.parse(
    await s.evalJs(`(async () => {
      window.__posted = [];
      const original = window.postMessage;
      window.postMessage = function (msg, origin) { window.__posted.push({ type: msg && msg.type, origin, msg }); };
      try {
        const frame = document.createElement('iframe');
        frame.style.cssText = 'width:700px;height:900px;border:0';
        frame.src = 'courses.html?embed=1';
        document.body.append(frame);
        await new Promise((r) => frame.addEventListener('load', r, { once: true }));
        // Poll (up to 25 s, as above) for what the checks below need: the framed
        // page rendered, its overview chip present, and a first height reported.
        const ready = () => {
          const doc = frame.contentDocument;
          return !!doc && doc.querySelectorAll('.all-courses table.course-rules tbody tr').length >= 10
            && !!doc.querySelector('.ov-item[href^="#"]') && window.__posted.some((p) => p.type === 'nd-cse-audit:height');
        };
        const deadline = Date.now() + 25000;
        while (!ready() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 250));
        if (!ready()) throw new Error('the framed page did not render, show an overview chip and report a height within 25 s');
        const inner = frame.contentDocument;
        const chip = inner.querySelector('.ov-item[href^="#"]');
        const chipHref = chip ? chip.getAttribute('href') : null;
        if (chip) chip.click();
        // The click asks each allowed origin in turn; poll for the three (up to 2 s).
        const scrollsIn = () => window.__posted.filter((p) => p.type === 'nd-cse-audit:scrollto').length;
        const clicked = Date.now() + 2000;
        while (scrollsIn() < 3 && Date.now() < clicked) await new Promise((r) => setTimeout(r, 50));
        if (scrollsIn() === 0) throw new Error('clicking ' + chipHref + ' sent no scroll request within 2 s');
        const out = {
          chipHref,
          heightOrigins: [...new Set(window.__posted.filter((p) => p.type === 'nd-cse-audit:height').map((p) => p.origin))],
          heights: window.__posted.filter((p) => p.type === 'nd-cse-audit:height').map((p) => p.msg.height),
          scrolls: window.__posted.filter((p) => p.type === 'nd-cse-audit:scrollto').map((p) => p.msg.offset),
          scrollOrigins: [...new Set(window.__posted.filter((p) => p.type === 'nd-cse-audit:scrollto').map((p) => p.origin))],
          otherTypes: [...new Set(window.__posted.map((p) => p.type))].filter((t) => t !== 'nd-cse-audit:height' && t !== 'nd-cse-audit:scrollto'),
        };
        frame.remove();
        return JSON.stringify(out);
      } finally {
        window.postMessage = original;
      }
    })()`),
  );
  const expected = ['https://sites.nd.edu', 'https://cse.nd.edu', 'https://www.nd.edu'];
  if (JSON.stringify(sent.heightOrigins) !== JSON.stringify(expected)) throw new Error('height went to the wrong origins: ' + JSON.stringify(sent.heightOrigins));
  if (!sent.heights.length) throw new Error('the framed page never reported a height');
  if (sent.otherTypes.length) throw new Error('an unexpected message type was sent: ' + sent.otherTypes.join(', '));
  // A frame sized to its own content cannot scroll, so the page's own
  // "jump to CSE 60641" chips ask the parent to scroll instead.
  if (!sent.chipHref) throw new Error('no overview chip to click — the scroll relay is untested');
  // One click, one offset — addressed to each allowed origin in turn, exactly
  // as the height is, because only the matching one is ever delivered.
  if (sent.scrolls.length !== expected.length || new Set(sent.scrolls).size !== 1 || !(sent.scrolls[0] > 0)) {
    throw new Error(`clicking ${sent.chipHref} should ask each allowed parent to scroll to one offset, got ${JSON.stringify(sent.scrolls)}`);
  }
  if (JSON.stringify(sent.scrollOrigins) !== JSON.stringify(expected)) throw new Error('the scroll request went to the wrong origins: ' + JSON.stringify(sent.scrollOrigins));
  console.log(`  every message goes only to ${expected.join(', ')}; clicking ${sent.chipHref} asks the parent to scroll to ${sent.scrolls[0]} px`);

  await driveWordPressSnippet(s, baseUrl);

  // …and the plain page is unchanged (acceptance criterion 2).
  const plain = JSON.parse(await s.evalJs(`JSON.stringify({ eyebrow: !!document.querySelector('.masthead .eyebrow'), h1Hidden: document.querySelector('.masthead h1')?.classList.contains('visually-hidden') === true, contactInMasthead: !!document.querySelector('.masthead .contact-card'), embedClass: document.documentElement.classList.contains('embed'), exit: !!document.querySelector('.embed-exit') })`));
  if (!plain.eyebrow || plain.h1Hidden || !plain.contactInMasthead || plain.embedClass || plain.exit) {
    throw new Error('courses.html without ?embed=1 is not the page it was: ' + JSON.stringify(plain));
  }
  console.log('  courses.html without the parameter is unchanged');
}

// E2E: the WordPress half — docs/wordpress-footer-snippet.html, the text the
// DGS pastes into the "Head, Footer and Post Injections" footer field. Nothing
// else tests it, and a mistake there is invisible (the frame just never
// resizes). The script is run here with its APP_ORIGIN pointed at the preview
// server, and then fed hand-made MessageEvents: one good, and four that must be
// ignored. `new MessageEvent(...)` is the only way to control `origin` and
// `source`, which is exactly what the two security checks read.
async function driveWordPressSnippet(s, baseUrl) {
  const origin = new URL(baseUrl).origin;
  const script = wordPressSnippetScript().replace('https://tjungnd.github.io', origin);
  await s.open(new URL('courses.html', baseUrl).href, '.all-courses table.course-rules');
  const r = JSON.parse(
    await s.evalJs(`(async () => {
      ${script}
      const frame = document.createElement('iframe');
      // The snippet finds its frames by the repository name in the src, which
      // the preview server's flat path has not got; the parameter puts it there
      // (the page ignores parameters it does not know).
      frame.src = 'courses.html?embed=1&e2e=ND-CSE-Degree-Requirement-Progress-Simulation';
      frame.style.cssText = 'width:700px;height:900px;border:0';
      document.body.append(frame);
      await new Promise((r) => frame.addEventListener('load', r, { once: true }));
      const other = document.createElement('iframe');
      other.src = 'about:blank';
      document.body.append(other);
      // Poll (up to 1 s) for the blank frame to have a window to impersonate.
      const blankBy = Date.now() + 1000;
      while (!(other.contentWindow && other.contentDocument?.readyState === 'complete') && Date.now() < blankBy) await new Promise((r) => setTimeout(r, 25));
      if (!other.contentWindow) throw new Error('the about:blank frame did not load within 1 s');

      const fire = (data, o, src) => window.dispatchEvent(new MessageEvent('message', { data: data, origin: o, source: src }));
      const height = (h) => ({ type: 'nd-cse-audit:height', height: h });
      const reset = () => { frame.style.height = '900px'; };
      const out = {};

      reset(); fire(height(4321), ${JSON.stringify(origin)}, frame.contentWindow);
      out.accepted = frame.style.height;
      reset(); fire(height(4321), 'https://evil.example', frame.contentWindow);
      out.wrongOrigin = frame.style.height;
      reset(); fire(height(4321), ${JSON.stringify(origin)}, window);
      out.wrongSource = frame.style.height;
      reset(); fire(height(4321), ${JSON.stringify(origin)}, other.contentWindow);
      out.otherFrame = frame.style.height;
      reset(); fire(height(999999), ${JSON.stringify(origin)}, frame.contentWindow);
      out.tooTall = frame.style.height;
      reset(); fire(height(12), ${JSON.stringify(origin)}, frame.contentWindow);
      out.tooShort = frame.style.height;
      reset(); fire({ type: 'nd-cse-audit:somethingelse', height: 4321 }, ${JSON.stringify(origin)}, frame.contentWindow);
      out.unknownType = frame.style.height;
      reset(); fire('a plain string', ${JSON.stringify(origin)}, frame.contentWindow);
      out.notAnObject = frame.style.height;

      // …and the scroll request, which moves the window rather than the frame.
      const realScrollTo = window.scrollTo;
      const scrolls = [];
      window.scrollTo = (opts) => { scrolls.push(Math.round(opts && opts.top)); };
      fire({ type: 'nd-cse-audit:scrollto', offset: 500 }, ${JSON.stringify(origin)}, frame.contentWindow);
      fire({ type: 'nd-cse-audit:scrollto', offset: 500 }, 'https://evil.example', frame.contentWindow);
      fire({ type: 'nd-cse-audit:scrollto', offset: -5 }, ${JSON.stringify(origin)}, frame.contentWindow);
      window.scrollTo = realScrollTo;
      out.scrolls = scrolls;

      frame.remove(); other.remove();
      return JSON.stringify(out);
    })()`),
  );
  if (r.accepted !== '4321px') throw new Error('the WordPress snippet ignored a valid height message: ' + JSON.stringify(r));
  const mustIgnore = ['wrongOrigin', 'wrongSource', 'otherFrame', 'tooTall', 'tooShort', 'unknownType', 'notAnObject'];
  for (const k of mustIgnore) {
    if (r[k] !== '900px') throw new Error(`the WordPress snippet acted on a message it must ignore (${k} → ${r[k]})`);
  }
  if (r.scrolls.length !== 1) throw new Error('the snippet scrolled for a message it must ignore: ' + JSON.stringify(r.scrolls));
  console.log(`  the WordPress snippet, run verbatim from docs/: accepts a good height (${r.accepted}), ignores ${mustIgnore.join(', ')}, scrolls once`);
}
