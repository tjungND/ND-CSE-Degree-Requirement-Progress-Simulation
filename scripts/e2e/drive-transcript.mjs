// E2E: the transcript-upload flow — reject a non-ND PDF with the right message,
// preview + add the courses from an ND PDF, prefill the GPA. Then the
// external-transcripts card: upload another university's PDF into the Master's
// slot, correct/confirm the preview, and check the DGS-verdict lines (in the
// sandbox the ExternalCourses tab is unconfigured, so everything is honestly
// "not yet reviewed" and the copy-ready review request appears).
// `pdfs` is the name → path map run.mjs builds from tests/fixtures/.
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { STAMP_RE } from './session-common.mjs';

export async function driveTranscript(s, baseUrl, pdfs) {
  const { nd: ndPdf, other: otherPdf, external: externalPdf, scan: scanPdf, banner: bannerPdf, watermarked: watermarkedPdf, combined: combinedPdf, ndUg: ndUgPdf, uc: ucPdf, ndOfficial: ndOfficialPdf, noLines: noLinesPdf, ndUgInProgress: ndUgInProgressPdf, ndInsideNd: ndInsideNdPdf, codeless: codelessPdf, outline: outlinePdf, totalsMismatch: totalsMismatchPdf } = pdfs;
  await s.open(baseUrl, '.transcript-upload');
  await s.evalJs(`localStorage.clear()`);
  await s.open(baseUrl, '.transcript-upload');

  // 1) Non-ND transcript → rejection message, no preview.
  await s.setFileInput('.transcript-upload input[type=file]', otherPdf);
  // The rejection is a persistent inline message under the row (2026-09-05,
  // usability review item 6), not a vanishing toast — and it has focus.
  await s.waitFor(
    `document.querySelector('.transcript-upload .import-error')?.textContent.includes("Only ND's unofficial transcript")`,
  );
  if (await s.evalJs(`!!document.querySelector('.transcript-preview')`)) {
    throw new Error('preview must NOT appear for a non-ND transcript');
  }
  if (!(await s.evalJs(`document.activeElement?.classList.contains('import-error')`))) {
    throw new Error('the rejection message must receive focus (role=alert, tabindex=-1)');
  }
  console.log('  non-ND transcript rejected with the required message (inline, focused)');
  await s.shot('transcript-rejected');
  await s.evalJs(`document.querySelector('.transcript-upload .import-error button').click()`);
  await s.waitFor(`!document.querySelector('.transcript-upload .import-error')`);
  await checkUnreadablePdf(s);

  // 2) ND transcript (COMBINED since 2026-09-05: a B.S. before the Ph.D.) →
  //    preview reads the entry term (Fall 2026, the first graduate-level term),
  //    files the two undergraduate terms as prior coursework, unticks the
  //    undergraduate course that cannot matter (Calculus) → add.
  await s.setFileInput('.transcript-upload input[type=file]', ndPdf);
  await s.waitFor(`document.querySelector('.transcript-preview')`);
  const rows = await s.evalJs(
    `document.querySelectorAll('.transcript-preview table tr').length - 1`,
  );
  console.log('  preview rows:', rows);
  if (rows !== 9) throw new Error(`expected 9 parsed courses (1 transfer + 3 undergraduate + 5 graduate), got ${rows}`);
  const entryLine = await s.evalJs(`document.querySelector('.transcript-preview .entry-term-line')?.textContent ?? ''`);
  const entryTicked = await s.evalJs(`document.querySelector('.transcript-preview .use-entry-term')?.checked`);
  console.log('  entry-term line:', entryLine.slice(0, 120), '| ticked:', entryTicked);
  if (!entryLine.includes('Your first semester in the program looks like Fall 2026') || !entryLine.includes('first graduate-level term') || entryTicked !== true) {
    throw new Error('the preview must offer the entry term read from the transcript, ticked');
  }
  const priorNote = await s.evalJs(`document.querySelector('.transcript-preview .prior-note')?.textContent ?? ''`);
  if (!priorNote.startsWith('3 courses dated before Fall 2026')) throw new Error('prior-coursework note missing/wrong: ' + priorNote.slice(0, 120));
  const ticks = await s.evalJs(
    `[...document.querySelectorAll('.transcript-preview table tr')].slice(1).map(tr => tr.querySelector('.cid').textContent + ':' + (tr.querySelector('input[type=checkbox]').checked ? 'on' : 'off') + ':' + tr.cells[5].textContent)`,
  );
  console.log('  preview ticks:', JSON.stringify(ticks));
  if (!ticks.includes('MATH 10550:off:taken before Fall 2026, as an undergraduate')) throw new Error('an irrelevant undergraduate course must start unticked: ' + ticks.slice(0, 200));
  if (!ticks.includes('CSE 30321:on:taken before Fall 2026, as an undergraduate')) throw new Error('a core-title undergraduate course must start ticked');
  if (!ticks.includes('CSE 60641:on:')) throw new Error('a program course must start ticked without a prior note');
  // Graduate credit on the Notre Dame record's transfer block (P3-import-1,
  // DGS 2026-10-05): named as accepted credit with the term it was posted, no grade.
  if (!ticks.includes('EECS 58200:on:transfer credit accepted on your Notre Dame record (posted Spring 2027)')) throw new Error('the transfer-block row must say it is accepted credit on the record: ' + JSON.stringify(ticks));
  const blockGrade = await s.evalJs(`[...document.querySelectorAll('.transcript-preview table tr')].find(tr => tr.querySelector('.cid')?.textContent === 'EECS 58200')?.cells[4].textContent`);
  if (blockGrade !== '—') throw new Error('a credit-only transfer-block row shows no grade, not "In progress": ' + blockGrade);
  // The dated bachelor's award (2026-09-06) fills "Bachelor's degree awarded" on add; the preview says so.
  const bsLine = await s.evalJs(`document.querySelector('.transcript-preview .bachelors-line')?.textContent ?? ''`);
  console.log('  bachelor’s line:', bsLine.slice(0, 140));
  if (!bsLine.includes('Bachelor of Science awarded 2021-05-16') || !bsLine.includes('Spring 2021 will be recorded as the semester you finished your bachelor’s')) throw new Error('the preview must announce the bachelor’s award term: ' + bsLine.slice(0, 160));
  await s.shot('transcript-preview');

  await s.evalJs(
    `[...document.querySelectorAll('.transcript-preview button')].find(b => /^Add \\d+ selected course/.test(b.textContent)).click()`,
  );
  await s.waitFor(
    `document.querySelectorAll('table.courses tr').length > 4 && !document.querySelector('.transcript-preview')`,
  );
  const added = await s.evalJs(
    `[...document.querySelectorAll('table.courses .cid')].map(e => e.textContent)`,
  );
  console.log('  course table now has:', JSON.stringify(added));
  if (added.includes('MATH 10550')) throw new Error('the unticked undergraduate course was added');
  // Option 1 (P3-import-1): the accepted credit counts as posted, under its own
  // group with the posted-credit note instead of the candidate rule.
  const posted = JSON.parse(await s.evalJs(`JSON.stringify((() => {
    const h = [...document.querySelectorAll('h3.subhead')].find(h => h.textContent.includes('University of Michigan — graduate coursework'));
    const hint = h?.nextElementSibling?.matches('p.hint') ? h.nextElementSibling.textContent : '';
    const tr = [...document.querySelectorAll('table.courses tr')].find(tr => tr.querySelector('.cid')?.textContent === 'EECS 58200');
    return { hint, mark: tr?.querySelector('.mark')?.className ?? '', note: tr?.querySelector('.cell-note')?.textContent ?? '', grade: tr?.querySelector('[data-label="Grade"]')?.textContent ?? '' };
  })())`));
  console.log('  accepted transfer credit:', JSON.stringify(posted).slice(0, 260));
  if (!posted.mark.includes('mark-counts') || !posted.note.includes('transfer credit on your Notre Dame record (posted Spring 2027) — accepted by the Graduate School; nothing to send') || posted.grade !== '—' || !posted.hint.startsWith('Accepted transfer credit on your Notre Dame transcript')) {
    throw new Error('accepted transfer credit must count as posted, with its own note: ' + JSON.stringify(posted));
  }
  const gpa = await s.evalJs(`document.querySelector('input[step="0.01"]')?.value`);
  console.log('  GPA prefilled from transcript:', gpa);
  if (!gpa) throw new Error('cumulative GPA was not prefilled');
  // "Bachelor's degree awarded" was filled from the transcript (2026-09-06): the toast says so and the standing card shows it, flagged.
  const addToast = await s.evalJs(`document.querySelector('.toast')?.textContent ?? ''`);
  const bsYear = await s.evalJs(`document.querySelector('[data-key="standing.bachelors.year"]')?.value`);
  const bsSeason = await s.evalJs(`document.querySelector('[data-key="standing.bachelors.season"]')?.value`);
  const bsNote = await s.evalJs(`document.querySelector('.bachelors-note')?.textContent ?? ''`);
  console.log('  bachelor’s award from the transcript:', bsSeason, bsYear, '|', bsNote.slice(0, 90));
  if (!addToast.includes('your bachelor’s semester (Spring 2021)') || !addToast.includes('confirm them under Your standing')) throw new Error('the add toast must say the award term was set: ' + addToast.slice(0, 220));
  if (bsYear !== '2021' || bsSeason !== 'spring' || !bsNote.startsWith('Spring 2021 was read from your transcript')) throw new Error(`standing card: bachelor’s award ${bsSeason} ${bsYear} — ${bsNote.slice(0, 100)}`);
  // The Notre Dame row now names what it added and offers Remove (2026-09-06),
  // like a previous-university slot — and the import stays available.
  const ndRow = await s.evalJs(`document.querySelector('.transcript-upload')?.textContent ?? ''`);
  if (!ndRow.includes('7 courses from your transcript') || !ndRow.includes('Import again') || !(await s.evalJs(`!!document.querySelector('[data-key="import.nd.remove"]')`))) {
    throw new Error('the Notre Dame row must show the imported count, Remove and Import again: ' + ndRow.slice(0, 160));
  }
  // "Import again" replaces the earlier import (UI review item 13; DGS
  // 2026-10-09: option (b)): the same PDF again previews with every row ticked
  // (nothing "already entered"), Add leaves the same 7 rows and says the
  // earlier ones were replaced, and one Undo puts the earlier import back.
  await s.setFileInput('.transcript-upload input[type=file]', ndPdf);
  await s.waitFor(`document.querySelector('.transcript-preview table tr:nth-child(2)')`);
  // The same 7 rows ticked as the first time (the two undergraduate rows that
  // cannot matter start unticked either time); none held back as a duplicate.
  const againTicked = JSON.parse(await s.evalJs(`JSON.stringify([...document.querySelectorAll('.transcript-preview table tr')].slice(1).map(tr => tr.querySelector('.cell-check input')?.checked))`));
  const againNotes = await s.evalJs(`document.querySelector('.transcript-preview')?.textContent ?? ''`);
  if (againTicked.filter((on) => on === true).length !== 7 || /already entered|already on your record/i.test(againNotes)) throw new Error('re-importing the same transcript must offer the same rows again (the earlier import is replaced): ' + JSON.stringify(againTicked) + ' ' + againNotes.slice(0, 160));
  // "Did the reader get this transcript wrong?" (DGS 2026-10-11, item 18): counts only for Notre Dame.
  const ndProblem = await readerProblemBody(s, 'preview.problem');
  if (!/^Transcript: Notre Dame transcript — University of Notre Dame\nRead from: the PDF’s text\nRows read: \d+; ticked to add: 7; changed by me: 0; typed by me: 0$/m.test(ndProblem)) throw new Error('the Notre Dame preview’s reader-problem email: ' + ndProblem);
  console.log('  Notre Dame preview: "Did the reader get this transcript wrong?" —', ndProblem.split('\n').find((l) => l.startsWith('Rows read')));
  await s.evalJs(`document.querySelector('[data-key="preview.add"]').click()`);
  await s.waitFor(`!document.querySelector('.transcript-preview')`);
  const againToast = await s.evalJs(`[...document.querySelectorAll('.toast')].map(t => t.textContent).join(' | ')`);
  const againRow = await s.evalJs(`document.querySelector('.transcript-upload')?.textContent ?? ''`);
  if (!againRow.includes('7 courses from your transcript') || !/The 7 courses imported earlier were replaced\./.test(againToast)) throw new Error('Import again must replace the earlier import and say so: ' + againRow.slice(0, 100) + ' | ' + againToast.slice(0, 200));
  await s.evalJs(`[...document.querySelectorAll('.toast button')].find(b => b.textContent === 'Undo').click()`);
  await s.settle();
  const undone = await s.evalJs(`document.querySelector('.transcript-upload')?.textContent ?? ''`);
  if (!undone.includes('7 courses from your transcript')) throw new Error('Undo must put the earlier import back: ' + undone.slice(0, 100));
  console.log('  Import again: every row offered, the earlier import replaced (7 rows stay 7), Undo restores it');
  // The standing card now shows the term read from the transcript, flagged.
  const entryNote = await s.evalJs(`document.querySelector('.entry-note')?.textContent ?? ''`);
  // By data-key, not by max=2040: a year has no upper bound since the DGS's
  // ruling of 2026-09-18, so the boxes carry no `max` attribute at all.
  const entryYear = await s.evalJs(`document.querySelector('[data-key="standing.year"]')?.value`);
  console.log('  standing card entry term:', entryYear, '|', entryNote.slice(0, 100));
  if (entryYear !== '2026' || !entryNote.startsWith('Fall 2026 was read from your transcript')) {
    throw new Error('the standing card must show the transcript entry term, flagged as read from the transcript');
  }
  const priorHeading = await s.evalJs(`[...document.querySelectorAll('h3.subhead')].map(h => h.textContent).find(t => t.includes('before entering the program')) ?? ''`);
  if (!priorHeading.includes('undergraduate coursework')) throw new Error('prior Notre Dame coursework heading missing: ' + priorHeading);
  // Residence is counted from the entry term: the full-time checkboxes list
  // the program terms only (never the undergraduate Fall 2024 / Spring 2025).
  // (A term counted automatically reads "✓ Fall 2027 — counted automatically (9+ credits entered)" since 2026-09-05.)
  // A semester with courses that did not reach full-time is highlighted with a
  // "⚠" (DGS 2026-10-04) and says why; the selector opens for it.
  const ftTerms = await s.evalJs(`[...document.querySelectorAll('.ft-term')].map(e => e.textContent.trim().replace(/^[✓⚠]\\s*/, '').replace(/\\s[—(].*$/, ''))`);
  console.log('  full-time term checkboxes:', JSON.stringify(ftTerms));
  const ftWarned = JSON.parse(await s.evalJs(`JSON.stringify({ warned: [...document.querySelectorAll('.ft-term.ft-warn')].map(e => e.textContent.trim()), open: document.querySelector('details.rare[data-key="rare.fulltime"]')?.open ?? null })`));
  console.log('  full-time terms highlighted:', JSON.stringify(ftWarned));
  if (ftWarned.warned.some((t) => !/^⚠ .* — (not full-time|every course withdrawn)/.test(t))) throw new Error('a highlighted semester must say why: ' + JSON.stringify(ftWarned.warned));
  if (ftWarned.warned.length > 0 && ftWarned.open !== true) throw new Error('a semester that was not full-time must open the Full-time terms selector');
  if (JSON.stringify(ftTerms) !== JSON.stringify(['Fall 2026', 'Spring 2027', 'Fall 2027'])) {
    throw new Error('residency terms must start at the entry term');
  }
  await s.shot('transcript-added');

  // 2b) An unlisted (typically non-CSE) ND course typed by hand → the single
  // "Ask the DGS to review" card offers a copy-ready request addressed to the
  // DGS alone (2026-09-06: the Grad Admin is not part of the review).
  await s.evalJs(`(() => {
    const form = document.querySelector('.course-form');
    form.querySelector('input.course-id').value = 'MATH 60610'; // labelled "Course number" since 2026-09-05 (no placeholder)
    [...form.querySelectorAll('button')].find((b) => b.textContent === 'Add course').click();
  })()`);
  await s.waitFor(`document.querySelector('.dgs-review')`);
  const ndReview = await s.evalJs(`document.querySelector('.dgs-review').textContent`);
  // 3 pending: the typed MATH 60610, the ND transcript's transfer-credit
  // line EECS 58200 "Operating Systems" — counted as accepted credit (Option 1,
  // 2026-10-05), but its core-keyword title asks the DGS for a §4.4.1 core
  // area (DGS rule 2026-09-04) — and
  // the undergraduate CSE 30321 "Computer Architecture" taken before entry
  // (2026-09-05: prior Notre Dame coursework not in the Courses tab).
  // The LIVE sheet decides whether CSE 30321 is pending: on 2026-09-22 the DGS
  // added it to the Courses tab with its core area, which settles its §4.4.1
  // question, so the request then holds two courses, not three.
  const listed30321 = await s.evalJs(`!!document.querySelector('#known-courses option[value="CSE 30321"]')`);
  // `p30321` is that course's share of every later count in this driver.
  const p30321 = listed30321 ? 0 : 1;
  const wantReview = 2 + p30321;
  if (!ndReview.includes(`Initiate the review request for ${wantReview} courses`) || ndReview.includes('Grad Admin') || !ndReview.includes('send to the DGS')) { // the shortened paragraph (UI review item 3, 2026-10-09)
    throw new Error('review card wrong: ' + ndReview.slice(0, 140));
  }
  console.log('  unlisted ND course → review request offered');
  // The Grad Admin button is active on met requirements alone (DGS 2026-09-06, late evening):
  // nothing to transfer and no milestone yet, but the GPA and Notre Dame-credit rows are met.
  const gaState = JSON.parse(await s.evalJs(`JSON.stringify((() => { const card = document.querySelector('.grad-admin-request'); const b = card?.querySelector('[data-key="gradadmin.copy"]'); return { inactive: b?.getAttribute('aria-disabled'), chip: card?.querySelector('.chip-note')?.textContent, line: [...(card?.querySelectorAll('.review-line') ?? [])].map(e => e.textContent).find(t => / met, /.test(t)) ?? '' }; })())`));
  console.log('  Grad Admin card after the ND import:', JSON.stringify(gaState));
  if (gaState.inactive === 'true' || !/^\d+ requirements? met, \d+ in progress, \d+ not started — /.test(gaState.line)) throw new Error('the Grad Admin button must be active on met requirements alone: ' + JSON.stringify(gaState));
  await s.shotElement('grad-admin-met-only', '.grad-admin-request');
  // The review card at the top of the window: the page leaves room for the
  // floating boxes at its end since 2026-10-10, so a shot left at the end showed
  // the footer and blank space instead of the card.
  await s.evalJs(`document.querySelector('.dgs-review').scrollIntoView({ block: 'start' })`);
  await s.shot('nd-review');
  // Copy → the check-before-you-send dialog (2026-09-06 evening): the DGS by
  // name and address, the subject, the message; OK closes it, focus returns.
  await s.evalJs(`document.querySelector('[data-key="review.copy"]').click()`);
  await s.waitFor(`document.querySelector('dialog.copy-check[open]')`);
  {
    const mail = await s.evalJs(`document.querySelector('dialog.copy-check [data-key="copy.email"]')?.getAttribute('href') ?? ''`);
    if (!/^mailto:tjung%40nd\.edu\?subject=Course%20review%20request/.test(mail)) throw new Error('the review dialog must open the email app addressed to the DGS with the subject: ' + mail.slice(0, 100));
    console.log('  review dialog: "Open in my email app" addressed to the DGS');
  }
  const dlg = JSON.parse(await s.evalJs(`JSON.stringify((() => {
    const d = document.querySelector('dialog.copy-check');
    const dgs = [...document.querySelectorAll('.contact-card li')].find(li => li.textContent.startsWith('Director of Graduate Studies'));
    const lead = d.querySelector('.copy-lead');
    return { title: d.querySelector('h2').textContent, to: d.querySelector('.copy-to').textContent, subject: d.querySelector('.copy-subject').textContent, text: d.querySelector('textarea').value.slice(0, 60), last: d.querySelector('textarea').value.trimEnd().split('\\n').pop(), dgsEmail: dgs?.querySelector('a')?.textContent ?? '', lead: lead?.querySelector('strong')?.textContent ?? '', leadBeforeMessage: !!lead && !!(lead.compareDocumentPosition(d.querySelector('textarea')) & Node.DOCUMENT_POSITION_FOLLOWING) };
  })())`));
  console.log('  copy dialog:', dlg.title, '|', dlg.to, '|', dlg.subject);
  // What the request was checked with (DGS 2026-10-11, item 8): its last line.
  if (!new RegExp(`^Checked with: ${STAMP_RE.source}\\.$`).test(dlg.last)) throw new Error('the review request must end with its "Checked with" line: ' + JSON.stringify(dlg.last));
  if (!/^Review request (copied — check it before you send|— copy it yourself \(the clipboard was blocked\))$/.test(dlg.title)) throw new Error('copy dialog title: ' + dlg.title);
  if (dlg.dgsEmail === '' || !dlg.to.startsWith('To: Director of Graduate Studies') || !dlg.to.includes(dlg.dgsEmail)) throw new Error('copy dialog recipient: ' + dlg.to);
  // The subject carries the Notre Dame programs since 2026-09-28.
  if (!/^Subject: Course review request \(degree self-check\) — Ph\.D\., entered Fall \d{4}$/.test(dlg.subject) || !dlg.text.startsWith('Subject: Course review request')) throw new Error('copy dialog subject/text: ' + dlg.subject + ' | ' + dlg.text);
  // The emphasised lead line (DGS request 2026-09-06, late evening) sits right above the message and says it is on the clipboard.
  if (!/^(✓ This message has been copied to your clipboard\.|The following message was NOT copied — your browser blocked the clipboard\.)$/.test(dlg.lead) || !dlg.leadBeforeMessage) throw new Error('copy dialog lead line: ' + JSON.stringify(dlg.lead) + ' before message: ' + dlg.leadBeforeMessage);
  // Numbered steps (2026-09-06 evening): paste, attach copies of the transcripts (emphasised), send.
  await s.shot('copy-dialog');
  await s.evalJs(`document.querySelector('[data-key="copy.ok"]').click()`);
  await s.waitFor(`!document.querySelector('dialog.copy-check')`);
  if ((await s.evalJs(`document.activeElement?.dataset?.key ?? ''`)) !== 'review.copy') throw new Error('focus must return to the copy button after OK');
  console.log('  copy dialog names the DGS, shows subject and message; OK closes it, focus back on the button');

  // The tables must survive every copy path (DGS 2026-09-23: "They used to
  // be"). As inside the sites.nd.edu iframe, the async clipboard is refused;
  // the legacy fallback must still hand over the HTML tables, and "Open in my
  // email app" must ask for a paste rather than pre-fill a plain-text body.
  {
    await s.evalJs(`(() => {
      window.__copiedHtml = null;
      window.__copiedFired = false;
      window.addEventListener('copy', (e) => { window.__copiedFired = true; window.__copiedHtml = e.clipboardData?.getData('text/html') ?? null; });
      const refuse = () => Promise.reject(new Error('refused as in a frame'));
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write: refuse, writeText: refuse } });
    })()`);
    await s.evalJs(`document.querySelector('[data-key="review.copy"]').click()`);
    await s.waitFor(`document.querySelector('dialog.copy-check[open]')`);
    const got = JSON.parse(await s.evalJs(`JSON.stringify({ fired: window.__copiedFired, html: window.__copiedHtml ?? '', mail: decodeURIComponent(document.querySelector('dialog.copy-check [data-key="copy.email"]')?.getAttribute('href') ?? '') })`));
    if (got.fired && !/<table\b/.test(got.html)) throw new Error('the iframe fallback copied no HTML table: ' + got.html.slice(0, 80));
    if (!/body=\[DELETE THIS LINE AND PASTE/.test(got.mail)) throw new Error('a request with tables must be pasted, not pre-filled: ' + got.mail.slice(0, 120));
    await s.evalJs(`document.querySelector('[data-key="copy.ok"]').click()`);
    await s.waitFor(`!document.querySelector('dialog.copy-check')`);
    console.log(`  tables survive: iframe-style fallback ${got.fired ? 'copied HTML tables' : 'not exercised (no copy event in this browser)'}; the email app asks for a paste`);
  }

  // The guidance above the four rows (DGS 2026-09-11): a bachelor's and a
  // master's from one university arrive as TWO transcripts as often as one —
  // Notre Dame's own 4+1 issues two — so the note has to name both shapes and
  // say where each goes before the student picks a file.
  const combined = await s.evalJs(`document.querySelector('.combined-note')?.textContent ?? ''`);
  for (const needed of ['Two transcripts:', 'One transcript covering both degrees:', 'Previous Master’s Transcript', 'A Notre Dame degree is different: it is on the same insideND transcript']) {
    if (!combined.includes(needed)) throw new Error('the transcript-shape note must say ' + JSON.stringify(needed) + ' — got: ' + combined);
  }
  console.log('  transcript-shape note covers two transcripts, one combined, and where ND’s own go');
  await s.evalJs(`(() => { const c = [...document.querySelectorAll('.card')].find(c => c.querySelector('h2')?.textContent.includes('Transcripts')); if (c) c.id = 'shot-transcripts'; })()`);
  await s.shotElement('transcript-shapes', '#shot-transcripts');

  // 3) External transcript (Master's slot) → editable preview → add → verdicts.
  await s.setFileInput('.external-file-masters', externalPdf);
  await s.waitFor(`[...document.querySelectorAll('.external-card h3')].some(h => h.textContent.includes('Previous Master’s Transcript'))`);
  const uni = await s.evalJs(`[...document.querySelectorAll('.external-card .field input')].map(i => i.value)[0]`);
  console.log('  external university guessed:', uni);
  if (uni !== 'Purdue University') throw new Error(`university not guessed from the PDF header: '${uni}'`);
  const extRows = await s.evalJs(`document.querySelectorAll('.external-card .transcript-preview table tr').length - 1`);
  console.log('  external preview rows:', extRows);
  if (extRows !== 3) throw new Error(`expected 3 parsed external courses, got ${extRows}`);
  // Typing the award term in the preview updates "Your standing" at once
  // (DGS 2026-09-13), and the preview keeps the value across that render.
  // (Done here, on graduate-only rows, so the re-levelling it triggers
  // changes nothing else.)
  await s.evalJs(`(() => { const y = document.querySelector('[data-key="ext.preview.bachelors.year"]'); y.value = '2020'; y.dispatchEvent(new Event('change')); })()`);
  await s.waitFor(`document.querySelector('[data-key="standing.bachelors.year"]')?.value === '2020' && document.querySelector('[data-key="ext.preview.bachelors.year"]')?.value === '2020'`);
  await s.evalJs(`(() => { const y = document.querySelector('[data-key="ext.preview.bachelors.year"]'); y.value = '2021'; y.dispatchEvent(new Event('change')); })()`);
  await s.waitFor(`document.querySelector('[data-key="standing.bachelors.year"]')?.value === '2021'`);
  console.log('  preview award term → Your standing in real time (2020, then back to 2021)');
  // A text-layer import is COMPACT and locked (2026-09-06, second pass):
  // number, title, credits, grade and term as printed — only "Taken as" is a
  // control; and while the preview is open every transcript-row button is
  // inactive, explaining itself on click instead of acting.
  const compact = await s.evalJs(`[...document.querySelectorAll('.external-card .transcript-preview tr.compact')].map(tr => tr.querySelectorAll('input:not([type=checkbox]), select').length + ':' + [...tr.querySelectorAll('td.locked-cell')].map(td => td.textContent.trim()).join('/'))`);
  console.log('  compact rows (controls:locked cells):', JSON.stringify(compact));
  // The term cell shows the short form "FA23" (DGS 2026-09-07); its tooltip is the full name.
  if (compact.length !== 3 || !compact.every((c) => /^1:\d+(\.\d+)? cr\/[A-Z][+-]?\/(FA|SP|SU)\d{2}$/.test(c))) {
    throw new Error('text-layer rows must be compact: only the level select editable, credits/grade/term locked, the term in its short form');
  }
  const termTip = await s.evalJs(`document.querySelector('.external-card .transcript-preview tr.compact td.locked-cell abbr.term')?.title ?? ''`);
  if (!/^(Fall|Spring|Summer) \d{4}$/.test(termTip)) {
    throw new Error('the short term must carry the full name as its tooltip: ' + termTip);
  }
  const inactive = await s.evalJs(`[...document.querySelectorAll('.transcript-upload button, .external-slot button')].map(b => b.textContent.trim() + ':' + b.getAttribute('aria-disabled'))`);
  console.log('  transcript-row buttons while the preview is open:', JSON.stringify(inactive));
  if (inactive.length < 4 || !inactive.every((b) => b.endsWith(':true'))) throw new Error('every Import/Remove button must be inactive while a preview is open');
  const ndBefore = await s.evalJs(`document.querySelectorAll('table.courses .cid').length`);
  await s.evalJs(`document.querySelector('[data-key="import.nd.remove"]').click()`);
  const inactiveToast = await s.evalJs(`document.querySelector('.toast')?.textContent ?? ''`);
  if (!inactiveToast.startsWith('Not available while a transcript preview is open') || (await s.evalJs(`document.querySelectorAll('table.courses .cid').length`)) !== ndBefore || !(await s.evalJs(`!!document.querySelector('.external-card .transcript-preview')`))) {
    throw new Error('an inactive Remove must explain itself and do nothing: ' + inactiveToast.slice(0, 100));
  }
  console.log('  inactive Remove explained itself, nothing removed');
  await s.shot('external-preview');
  await checkPreviewSelects(s); // after the shot: it visits 320 px and comes back
  await checkCreditNote(s);
  await s.evalJs(
    `[...document.querySelectorAll('.external-card button')].find(b => /^Add \\d+ selected course/.test(b.textContent)).click()`,
  );
  await s.waitFor(`!document.querySelector('.external-card .transcript-preview') && [...document.querySelectorAll('h3.subhead')].some(h => h.textContent.includes('Purdue University'))`);
  // The DGS's rulings live on each course's line in the coursework table
  // (2026-09-06 — the separate verdicts block was removed as redundant): the
  // 3 Purdue courses are unreviewed §5.2 transfer CANDIDATES, amber (later
  // the same day: only CSE-related courses transfer, the DGS decides, so
  // every unreviewed graduate course is a candidate, never "would count");
  // the prior Notre Dame undergraduate course (CSE 30321, filed under the
  // Bachelor's slot by the combined import) may satisfy a core area, amber too.
  // Rows of the table under a coursework heading (the coursework card groups
  // courses by university + transcript).
  const groupLines = (heading) => s.evalJs(`(() => {
    const h = [...document.querySelectorAll('h3.subhead')].find(h => h.textContent.includes(${JSON.stringify(heading)}));
    const table = h?.nextElementSibling?.matches('.table-scroll') ? h.nextElementSibling : h?.nextElementSibling?.nextElementSibling;
    return [...(table?.querySelectorAll('tr') ?? [])].slice(1).map(tr => tr.querySelector('.cid').textContent + ' [' + (tr.querySelector('.mark')?.className ?? 'no mark') + '] ' + tr.querySelector('.cell-note').textContent);
  })()`);
  const purdueLines = await groupLines('Purdue University — Previous Master’s Transcript');
  console.log('  Purdue transfer lines:', JSON.stringify(purdueLines));
  // With a master's transcript from another university on the record, the
  // "I already hold the MSCSE from Notre Dame" box is not offered (DGS 2026-09-13).
  if (await s.evalJs(`[...document.querySelectorAll('label.check')].some(l => /already hold the MSCSE from Notre Dame/.test(l.textContent))`)) throw new Error('the ND-MSCSE box must not show beside another university’s master’s transcript');
  console.log('  ND-MSCSE box hidden while a Purdue master’s is on the record');
  // The DGS's approval is a tick on the course it concerns, offered only where
  // the sheet decides the course case by case (DGS 2026-09-27); the sandbox
  // has no ExternalCourses tab, so no Purdue row offers one, and the three
  // record-level boxes are gone from the milestones card.
  {
    const boxes = await s.evalJs(`JSON.stringify({ perCourse: document.querySelectorAll('[data-key^="course."][data-key$=".approved"]').length, old: document.querySelectorAll('[data-key^="attest.the-dgs-approved"], [data-key^="attest.the-dgs-explicitly-approved"]').length })`);
    const { perCourse, old } = JSON.parse(boxes);
    if (perCourse !== 0) throw new Error('an unlisted course must not offer the approval tick: ' + perCourse);
    if (old !== 0) throw new Error('the record-level DGS boxes must be gone: ' + old);
    console.log('  approval ticks: none offered (nothing in the sheet is case by case here); record-level boxes gone');
  }
  const candidates = purdueLines.filter((l) => l.includes('mark-pending') && l.includes('waiting for the DGS — '));
  const wouldCount = candidates.filter((l) => l.includes('would count toward regular courses'));
  if (purdueLines.length !== 3 || candidates.length !== 3 || wouldCount.length < 2) {
    throw new Error('expected the 3 Purdue lines to be amber "waiting for the DGS" lines, at least two "would count toward regular courses … if approved" (the sandbox has no ExternalCourses tab)');
  }
  const groupHint = await s.evalJs(`(() => {
    const h = [...document.querySelectorAll('h3.subhead')].find(h => h.textContent.includes('Purdue University — Previous Master’s Transcript'));
    return h?.nextElementSibling?.matches('p.hint') ? h.nextElementSibling.textContent : '';
  })()`);
  if (!groupHint.includes('normally CSE-related ones') || !groupHint.includes('every graduate course here is a candidate') || !groupHint.includes('after your bachelor’s degree, within')) {
    throw new Error('the transfer group must explain the candidate rule once above the table: ' + groupHint.slice(0, 160));
  }

  // 3c) The graduate-status rule (DGS 2026-09-06): set the bachelor's award to
  //     Spring 2024 by hand — every Purdue row (Fall 2023 / Spring 2024) is then
  //     "not counted — taken before / in the term your bachelor's degree was
  //     awarded", the §5.2 paragraph stays, and only the core-sounding
  //     titles stay in the review request. Then back to 2021.
  const setBachelorsYear = async (year) => {
    await s.evalJs(`(() => { const y = document.querySelector('[data-key="standing.bachelors.year"]'); y.value = '${year}'; y.dispatchEvent(new Event('change')); })()`);
    await s.waitFor(`document.querySelector('[data-key="standing.bachelors.year"]')?.value === '${year}'`);
  };
  await setBachelorsYear('2024');
  const ruleLines = await groupLines('Purdue University — Previous Master’s Transcript');
  console.log('  with the bachelor’s awarded Spring 2024:', JSON.stringify(ruleLines));
  if (ruleLines.length !== 3 || ruleLines.some((l) => l.includes('mark-counts'))) throw new Error('rule lines: ' + JSON.stringify(ruleLines));
  if (!ruleLines.some((l) => l.startsWith('CS 50300') && l.includes('not counted — taken before your bachelor’s degree was awarded (Spring 2024)'))) throw new Error('CS 50300 (Fall 2023) must be excluded by the award term');
  if (!ruleLines.some((l) => l.startsWith('CS 58000') && l.includes('taken in the term your bachelor’s degree was awarded (Spring 2024)'))) throw new Error('CS 58000 (Spring 2024) must be excluded as taken in the award term');
  // The §5.2 paragraph stays above the group even when every row is refused
  // (clarity review 2026-09-26): a student whose courses were all excluded
  // used to see three struck-through rows and no rule at all.
  const hintStays = await s.evalJs(`(() => { const h = [...document.querySelectorAll('h3.subhead')].find(h => h.textContent.includes('Purdue University — Previous Master’s Transcript')); return h?.nextElementSibling?.matches('p.hint') && h.nextElementSibling.textContent.includes('Transfer credit (CSE §5.2)'); })()`);
  if (!hintStays) throw new Error('the §5.2 paragraph must stay above the group when every row is refused');
  const bsNoteChosen = await s.evalJs(`document.querySelector('.bachelors-note')?.textContent ?? ''`);
  if (bsNoteChosen.includes('read from your transcript')) throw new Error('a hand-set award term is no longer "read from your transcript"');
  const reviewAfterRule = await s.evalJs(`document.querySelector('.dgs-review')?.textContent ?? ''`);
  if (!reviewAfterRule.includes(`Initiate the review request for ${4 + p30321} courses`)) throw new Error(`two excluded Purdue rows with core-sounding titles stay, one leaves — ${4 + p30321} expected: ` + reviewAfterRule.slice(0, 140));
  await s.evalJs(`(() => { const c = [...document.querySelectorAll('.card')].find(c => c.querySelector('h2')?.textContent.includes('Coursework')); c.id = 'shot-coursework'; })()`);
  await s.shotElement('bachelors-rule', '#shot-coursework');
  await setBachelorsYear('2021');
  const candidatesBack = await groupLines('Purdue University — Previous Master’s Transcript');
  if (!candidatesBack.every((l) => l.includes('waiting for the DGS'))) throw new Error('back to 2021: the rows must be waiting for the DGS again: ' + JSON.stringify(candidatesBack));
  if (!(await s.evalJs(`document.querySelector('.dgs-review')?.textContent ?? ''`)).includes(`Initiate the review request for ${5 + p30321} courses`)) throw new Error(`back to 2021: ${5 + p30321} courses expected in the request`);
  console.log('  bachelor’s award Spring 2024 → all three Purdue rows excluded (§5.2 status), 5 in the request; back to 2021 → candidates again');
  const priorNdLines = await groupLines('ND, before entering the program — undergraduate coursework');
  // Pending (amber, "may satisfy") while the sheet does not list CSE 30321;
  // settled by its core-area cell once it does (the live sheet, 2026-09-22).
  if (!priorNdLines.some((l) => l.startsWith('CSE 30321') && (listed30321 ? /satisf(y|ies) the Computer Architecture core-knowledge requirement/.test(l) : l.includes('mark-pending') && l.includes('may satisfy the Computer Architecture core-knowledge requirement')))) {
    throw new Error('the prior Notre Dame undergraduate course should carry its core-knowledge line: ' + JSON.stringify(priorNdLines));
  }
  // ONE combined request: the 3 from 2b + the 3 external courses.
  const copyBtn = await s.evalJs(
    `[...document.querySelectorAll('.dgs-review button')].some(b => b.textContent.includes('Initiate the review request for ${5 + p30321} courses'))`,
  );
  if (!copyBtn) throw new Error('the combined review request button is missing/wrong');
  const transferDetail = await s.evalJs(
    `[...document.querySelectorAll('.req')].map(e => e.textContent).find(t => t.includes('credits you may transfer are counted')) ?? ''`,
  );
  console.log('  transfer row mentions:', transferDetail.slice(0, 140));
  if (!transferDetail.includes('Waiting for the DGS')) {
    throw new Error('the §5.2 transfer row does not mention the unreviewed external courses');
  }
  await s.shot('external-added');

  // 3b) The Notre Dame import's own pre-entry course does NOT fill the
  // Previous Undergraduate row (blue/red-team review, 2026-10-08: that row's
  // Remove deleted it, and a real bachelor's transcript could not be added):
  // the row still offers its import, and CSE 30321 stays on the record.
  {
    const ugRow = await s.evalJs(`[...document.querySelectorAll('.external-slot')].find((e) => e.textContent.includes('Previous Undergraduate Transcript'))?.textContent ?? ''`);
    if (/University of Notre Dame/.test(ugRow) || !(await s.evalJs(`!!document.querySelector('.external-file-bachelors')`))) throw new Error('the Notre Dame transcript’s own course must not fill the Previous Undergraduate row: ' + ugRow.slice(0, 160));
    if (!(await s.evalJs(`[...document.querySelectorAll('table.courses .cid')].some((e) => e.textContent === 'CSE 30321')`))) throw new Error('the prior Notre Dame undergraduate course must stay on the record');
    console.log('  the prior ND undergraduate course stays with the Notre Dame transcript; the Undergraduate row stays free');
  }

  // 3d) A text-layer PDF with NO readable course line (DGS 2026-09-16) is
  //     offered OCR, with its own lead sentence; Cancel leaves nothing behind.
  await s.setFileInput('.external-file-phd', noLinesPdf);
  await s.waitFor(`document.querySelector('.ocr-optin')`);
  const noLines = await s.evalJs(`document.querySelector('.ocr-optin')?.textContent ?? ''`);
  if (!/No course-like lines could be read from “no-lines-transcript\.pdf” — its layout is new to the parser/.test(noLines) || !/English-language transcripts only/.test(noLines)) throw new Error('a no-lines PDF must be offered OCR with its own reason: ' + noLines.slice(0, 160));
  console.log('  text PDF with no course lines → OCR offered');
  await s.evalJs(`document.querySelector('[data-key="ext.scan.cancel"]').click()`);
  await s.waitFor(`!document.querySelector('.ocr-optin')`);

  // 3e) A course outline, not a transcript (DGS 2026-10-10, answer 4a): one
  //     course-like line, no university named, no GPA or totals — the upload
  //     says so and imports nothing: no preview, no OCR offer.
  await s.setFileInput('.external-file-phd', outlinePdf);
  await s.waitFor(`document.querySelector('[data-key="ext.error.phd"]')`);
  const outline = await s.evalJs(`document.querySelector('[data-key="ext.error.phd"]')?.textContent ?? ''`);
  if (!/“course-outline\.pdf” does not look like a transcript/.test(outline) || !/Nothing was imported\. If it is your transcript, add the course by hand below\./.test(outline)) throw new Error('a course outline must be refused with its own message: ' + outline.slice(0, 200));
  if (await s.evalJs(`!!document.querySelector('.ocr-optin') || !!document.querySelector('.transcript-preview')`)) throw new Error('a course outline must open no preview and no OCR offer');
  await s.shot('external-not-a-transcript');
  console.log('  course outline → "does not look like a transcript", nothing imported');
  await s.evalJs(`document.querySelector('[data-key="ext.error.phd"] button').click()`);
  await s.waitFor(`!document.querySelector('[data-key="ext.error.phd"]')`);

  // 4) Scanned transcript (Bachelor's slot) → explicit OCR opt-in (English only)
  //    → OCR in the browser (self-hosted WASM) → flagged preview → add.
  await s.setFileInput('.external-file-bachelors', scanPdf);
  await s.waitFor(`document.querySelector('.ocr-optin')`);
  const optinText = await s.evalJs(`document.querySelector('.ocr-optin')?.textContent`);
  if (!optinText.includes('English-language transcripts only')) {
    throw new Error('the OCR opt-in must state English-only');
  }
  await s.shot('external-ocr-optin');
  // 4a) A page that may not compile WebAssembly — a host's Content-Security-
  //     Policy without 'wasm-unsafe-eval' (cross-browser review, 2026-10-10):
  //     OCR says it cannot run, at once, instead of hanging at 0 % and blocking
  //     every import. Stood in for by a WebAssembly.Module that refuses.
  await s.evalJs(`(() => { window.__e2eWasmModule = WebAssembly.Module; WebAssembly.Module = function () { throw new WebAssembly.CompileError('refused (e2e)'); }; })()`);
  try {
    await s.evalJs(`[...document.querySelectorAll('.ocr-optin button')].find(b => b.textContent === 'Try OCR (English only)').click()`);
    await s.waitFor(`document.querySelector('[data-key="ext.error.bachelors"]')?.textContent.includes('The text reader could not run in this browser')`, 15000);
  } finally {
    await s.evalJs(`(() => { WebAssembly.Module = window.__e2eWasmModule; delete window.__e2eWasmModule; })()`);
  }
  console.log('  OCR where WebAssembly may not run: "The text reader could not run in this browser" at once');
  await s.evalJs(`document.querySelector('[data-key="ext.error.bachelors"] button').click()`);
  await s.waitFor(`!document.querySelector('[data-key="ext.error.bachelors"]')`);
  await s.setFileInput('.external-file-bachelors', scanPdf);
  await s.waitFor(`document.querySelector('.ocr-optin')`);
  await s.evalJs(
    `[...document.querySelectorAll('.ocr-optin button')].find(b => b.textContent === 'Try OCR (English only)').click()`,
  );
  // Model load + three-page-equivalent OCR takes a while in headless Chrome.
  await s.waitFor(`document.querySelector('.external-card .transcript-preview')`, 120000);
  const ocrBanner = await s.evalJs(`document.querySelector('.ocr-banner')?.textContent ?? ''`);
  if (!ocrBanner.includes('English transcripts only')) throw new Error('OCR preview banner missing');
  const ocrUni = await s.evalJs(`[...document.querySelectorAll('.external-card .field input')].map(i => i.value)[0]`);
  const ocrRows = await s.evalJs(`document.querySelectorAll('.external-card .transcript-preview table tr').length - 1`);
  console.log('  OCR university:', ocrUni, '| rows:', ocrRows);
  if (ocrUni !== 'Purdue University') throw new Error(`OCR university guess wrong: '${ocrUni}'`);
  // Undergrad relevance filter (2026-09-04): OCR reads 3 courses, but only
  // the two whose titles match the core keywords are offered — 'Special
  // Topics in Systems' is left out (undergraduate credits never transfer).
  if (ocrRows !== 2) throw new Error(`expected 2 core-relevant OCR courses in the preview, got ${ocrRows}`);
  const bachNote = await s.evalJs(`document.querySelector('.external-card .transcript-preview .hint.warn')?.textContent ?? ''`);
  if (!bachNote.includes('do not transfer') || !bachNote.includes('1 other course was read and left out')) {
    throw new Error('bachelors preview note missing/wrong: ' + bachNote.slice(0, 160));
  }
  // The scanned line beside each OCR row (Batch C answer (5), DGS 2026-10-09;
  // the e2e leg 2026-10-10): a flagged row (⚠, under the confidence floor)
  // shows its strip at once — a canvas drawn from the page copy, with ink on
  // it — and any other row the "show the scanned line" toggle (W-CL413/414).
  const strips = JSON.parse(await s.evalJs(`JSON.stringify((() => {
    const ink = (c) => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let k = 0; k < d.length; k += 4) if (d[k] < 128) n++; return n; };
    return {
      head: !!document.querySelector('.external-card .transcript-preview th.scan-head'),
      rows: [...document.querySelectorAll('.external-card .transcript-preview table tr')].slice(1).map((tr) => {
        const cell = tr.querySelector('td.cell-scan');
        const canvas = cell?.querySelector('.scan-strip > canvas');
        const box = canvas?.getBoundingClientRect();
        return {
          id: tr.querySelector('input[data-key$=".id"]')?.value ?? '',
          flagged: tr.classList.contains('ocr-low'),
          toggle: cell?.querySelector('details.scan-line > summary')?.textContent ?? null,
          canvas: canvas ? { w: canvas.width, h: canvas.height, shownW: Math.round(box.width), shownH: Math.round(box.height), ink: ink(canvas), label: canvas.getAttribute('aria-label') } : null,
        };
      }),
    };
  })())`));
  console.log('  OCR scanned-line strips:', JSON.stringify(strips));
  const flaggedRows = strips.rows.filter((r) => r.flagged);
  if (!strips.head || flaggedRows.length === 0) throw new Error('the OCR preview must carry the scanned-line column and at least one flagged row on this scan: ' + JSON.stringify(strips));
  for (const r of flaggedRows) {
    if (!r.canvas || r.canvas.w < 200 || r.canvas.h < 20 || r.canvas.shownW < 100 || r.canvas.shownH < 10 || r.canvas.ink < 200 || r.canvas.label !== 'The scanned line this row was read from') throw new Error('a flagged OCR row must show its scanned line at once, drawn: ' + JSON.stringify(r));
  }
  for (const r of strips.rows.filter((x) => !x.flagged)) {
    if (r.toggle !== 'show the scanned line' || r.canvas) throw new Error('an unflagged OCR row keeps its scanned line behind the toggle: ' + JSON.stringify(r));
  }
  await s.shotElement('external-ocr-strip', '.external-card .transcript-preview');
  // At phone width the strip takes the row's full width and shrinks to fit it:
  // the whole line in view, nothing scrolls sideways — the strip's box or the
  // page (DGS 2026-10-10: "yes, shrink").
  await s.setViewport({ width: 390, height: 1900, mobile: true, settleMs: 300 });
  const phoneStrip = JSON.parse(await s.evalJs(`JSON.stringify((() => {
    const c = document.querySelector('.external-card .transcript-preview tr.ocr-low .scan-strip > canvas');
    const r = c?.getBoundingClientRect();
    const box = c?.parentElement;
    return { pageSideways: document.documentElement.scrollWidth - window.innerWidth, stripSideways: box ? box.scrollWidth - box.clientWidth : -1, overBox: r && box ? Math.round(r.right - box.getBoundingClientRect().right) : -1, shownW: r ? Math.round(r.width) : 0, shownH: r ? Math.round(r.height) : 0, left: r ? Math.round(r.left) : -1 };
  })())`));
  console.log('  OCR strip at 390 px:', JSON.stringify(phoneStrip));
  if (phoneStrip.pageSideways > 0 || phoneStrip.stripSideways !== 0 || phoneStrip.overBox > 1 || phoneStrip.shownW < 100 || phoneStrip.shownH < 10 || phoneStrip.left < 0) throw new Error('the scanned-line strip at phone width: ' + JSON.stringify(phoneStrip));
  // The crop is of the preview alone: the window's floating panels (Next
  // steps, the warnings, the toasts, the phone's score bar) are held out of
  // it — WebKit's element shot paints them over a 1900-px-tall phone frame.
  await s.evalJs(`(() => { const st = document.createElement('style'); st.id = 'e2e-no-float'; st.textContent = '.attention.floating, .warnings.floating, .toast-stack, .sticky-score { visibility: hidden !important; }'; document.head.append(st); })()`);
  await s.shotElement('phone-external-ocr-strip', '.external-card .transcript-preview');
  await s.evalJs(`document.getElementById('e2e-no-float')?.remove()`);
  await s.setViewport({ width: 1400, height: 1900, settleMs: 300 });
  // The whole frame from the preview's top (the crops above leave the page scrolled).
  await s.evalJs(`document.querySelector('.external-card .transcript-preview').scrollIntoView({ block: 'start' })`);
  await s.shot('external-ocr-preview');
  // Do what the preview tells every student to do: check the fields and fix
  // what OCR got wrong (an empty credits box blocks that row from being added).
  const fixed = await s.evalJs(`(() => {
    let n = 0;
    for (const tr of [...document.querySelectorAll('.external-card .transcript-preview table tr')].slice(1)) {
      // Per-row boxes by data-key for the same reason (and the credits box's
      // max is 15 since 2026-09-18, not 30).
      const credits = tr.querySelector('input[data-key$=".credits"]');
      if (credits && credits.value === '') { credits.value = '3'; credits.dispatchEvent(new Event('change')); n++; }
      const year = tr.querySelector('input[data-key$=".year"]');
      if (year && year.value === '') { year.value = '2023'; year.dispatchEvent(new Event('change')); n++; }
    }
    return n;
  })()`);
  console.log('  OCR fields fixed by hand in the preview:', fixed);
  await s.evalJs(
    `[...document.querySelectorAll('.external-card button')].find(b => /^Add \\d+ selected course/.test(b.textContent)).click()`,
  );
  await s.waitFor(`[...document.querySelectorAll('h3.subhead')].some(h => h.textContent.includes('Purdue University — Previous Undergraduate Transcript'))`);
  const ocrLines = (await groupLines('Purdue University — Previous Master’s Transcript')).length + (await groupLines('Purdue University — Previous Undergraduate Transcript')).length;
  if (ocrLines !== 5) throw new Error(`expected 5 external course lines (3 typed + 2 core-relevant OCR), got ${ocrLines}`);
  console.log('  5 external courses (3 typed + 2 core-relevant OCR) in the coursework table');
  // The strips were in memory only (Batch C answer (5)): gone with the
  // preview, and nothing of the scan reached the saved record.
  const savedAfterOcr = await s.evalJs(`localStorage.getItem('cse-degree-audit/v1/student') ?? ''`);
  if ((await s.evalJs(`document.querySelectorAll('.scan-strip, canvas.scan-strip-image').length`)) !== 0) throw new Error('the scanned-line strips must leave with the preview');
  if (savedAfterOcr === '' || /data:image|ocrRead|sourceLines|lowConfidence/.test(savedAfterOcr)) throw new Error('the saved record must hold no image, data: URL or OCR field after an OCR import');
  console.log('  after Add: no strip left on the page; the saved record holds no image or OCR field');
  // Undergrad core-title rule (2026-09-03; relevance filter 2026-09-04): only
  // the two keyword-matching bachelors courses were added, and both join the
  // request — MATH + EECS 58200 (2) + masters slot (3) + those two = 7 pending.
  const combined7 = await s.evalJs(`document.querySelector('.dgs-review')?.textContent ?? ''`);
  if (!combined7.includes('Initiate the review request for 7 courses')) {
    throw new Error('expected 7 pending after OCR (undergrad core-title rule): ' + combined7.slice(0, 140));
  }
  console.log('  undergrad core-title courses joined the review request (7 pending)');
  await s.shot('external-ocr-added');

  // 5) Banner two-column official transcript (Ph.D. slot, 2026-09-05): read
  // column by column through real pdfjs; the student's nd.edu e-mail in its
  // header must NOT redirect it to the ND row; the transfer-credit block is
  // left out with a note; the institution comes from the legend page.
  await s.setFileInput('.external-file-phd', bannerPdf);
  await s.waitFor(`[...document.querySelectorAll('.external-card h3')].some(h => h.textContent.includes('Previous Ph.D. Transcript'))`);
  const redirected = await s.evalJs(`[...document.querySelectorAll('.import-error')].some(e => e.textContent.includes('This is a Notre Dame transcript'))`);
  if (redirected) throw new Error('the Banner transcript was redirected to the ND row because of an nd.edu e-mail');
  const bannerUni = await s.evalJs(`[...document.querySelectorAll('.external-card .field input')].map(i => i.value)[0]`);
  const bannerRows = await s.evalJs(`document.querySelectorAll('.external-card .transcript-preview table tr').length - 1`);
  const bannerIds = await s.evalJs(
    `[...document.querySelectorAll('.external-card .transcript-preview table tr')].slice(1).map(tr => tr.querySelector('.cell-course input')?.value ?? tr.querySelector('.cell-course .course-id')?.textContent)`,
  );
  const transferNote = await s.evalJs(`[...document.querySelectorAll('.external-card .transcript-preview .hint.warn')].map(e => e.textContent).join(' | ')`);
  console.log('  Banner two-column transcript:', bannerUni, '|', bannerRows, 'rows |', JSON.stringify(bannerIds));
  if (bannerUni !== 'Example Institute of Technology') throw new Error('Banner institution not found on the legend page: ' + bannerUni);
  if (bannerRows !== 10) throw new Error(`expected 10 institution-credit rows from the Banner transcript, got ${bannerRows}`);
  // Its terms and its total add up (item 11, 2026-10-11): the check says nothing.
  if (await s.evalJs(`!!document.querySelector('[data-key="ext.preview.totals"]')`)) throw new Error('the Banner transcript adds up — no totals warning may show: ' + (await s.evalJs(`document.querySelector('[data-key="ext.preview.totals"]').textContent`)));
  // W-CL372 (F5, 2026-10-09): the heading is named generically since Minerva's "Credits/Exemptions" block is skipped like a transfer block.
  if (!/2 rows listed under a transfer-credit or credits\/exemptions heading were left out/.test(transferNote)) {
    throw new Error('transfer-credit block note missing: ' + transferNote);
  }
  await s.shot('banner-preview');
  await s.evalJs(`[...document.querySelectorAll('.external-card button')].find(b => b.textContent === 'Cancel').click()`);
  await s.waitFor(`!document.querySelector('.external-card .transcript-preview')`);

  // 6) The same transcript over a text watermark (tiled institution name +
  // a diagonal banner, 2026-09-05): must read exactly like the clean one.
  await s.setFileInput('.external-file-phd', watermarkedPdf);
  await s.waitFor(`[...document.querySelectorAll('.external-card h3')].some(h => h.textContent.includes('Previous Ph.D. Transcript'))`);
  const wmUni = await s.evalJs(`[...document.querySelectorAll('.external-card .field input')].map(i => i.value)[0]`);
  const wmIds = await s.evalJs(
    `[...document.querySelectorAll('.external-card .transcript-preview table tr')].slice(1).map(tr => tr.querySelector('.cell-course input')?.value ?? tr.querySelector('.cell-course .course-id')?.textContent)`,
  );
  console.log('  watermarked Banner transcript:', wmUni, '|', JSON.stringify(wmIds));
  if (wmUni !== bannerUni || JSON.stringify(wmIds) !== JSON.stringify(bannerIds)) {
    throw new Error('the watermarked transcript did not read like the clean one');
  }
  await s.shot('banner-watermarked-preview');
  await s.evalJs(`[...document.querySelectorAll('.external-card button')].find(b => b.textContent === 'Cancel').click()`);
  await s.waitFor(`!document.querySelector('.external-card .transcript-preview')`);

  // 7) A COMBINED B.S.+M.S. transcript from one university (2026-09-05): the
  //    Master's slot is freed, then the PDF's bachelor's conferral line splits
  //    the rows — undergraduate rows can only serve §4.4.1 (the irrelevant one
  //    starts unticked), graduate rows are §5.2 transfer candidates — and the
  //    M.S. conferral marks the prior degree completed.
  await s.evalJs(`(() => {
    const slot = [...document.querySelectorAll('.external-slot')].find((e) => e.textContent.includes('Previous Master’s Transcript'));
    [...slot.querySelectorAll('button')].find((b) => b.textContent === 'Remove').click();
  })()`);
  await s.waitFor(`document.querySelector('.external-file-masters')`);
  await s.setFileInput('.external-file-masters', combinedPdf);
  await s.waitFor(`document.querySelector('.external-card .transcript-preview .mixed-note')`);
  const combinedRows = await s.evalJs(
    `[...document.querySelectorAll('.external-card .transcript-preview table tr')].slice(1).map(tr => (tr.querySelector('.cell-course input')?.value ?? tr.querySelector('.cell-course .course-id')?.textContent) + ':' + tr.querySelector('select.row-level').value + ':' + (tr.querySelector('input[type=checkbox]').checked ? 'on' : 'off'))`,
  );
  console.log('  combined transcript rows:', JSON.stringify(combinedRows));
  const expectedCombined = ['CS 25100:undergraduate:on', 'CS 30700:undergraduate:off', 'CS 35400:undergraduate:on', 'CS 50300:graduate:on', 'CS 58000:graduate:on'];
  if (JSON.stringify(combinedRows) !== JSON.stringify(expectedCombined)) throw new Error('combined transcript levels/ticks wrong');
  // A combined record makes "Bachelor's degree awarded" required in the preview. What it is
  // pre-filled WITH depends on whether the student has already answered (DGS bug 2026-09-07):
  // a term they set by hand — step 3c above set Spring 2021 — must survive this import, and the
  // transcript's own conferral line (May 2024) must not overwrite it.
  const bsCtl = JSON.parse(await s.evalJs(`JSON.stringify((() => { const y = document.querySelector('[data-key="ext.preview.bachelors.year"]'); return { year: y?.value, required: y?.required, season: document.querySelector('[data-key="ext.preview.bachelors.season"]')?.value, hint: document.querySelector('#ext-bachelors-hint')?.textContent.slice(0, 70) }; })())`));
  console.log('  preview bachelor’s control:', JSON.stringify(bsCtl));
  if (bsCtl.year !== '2021' || bsCtl.season !== 'spring' || bsCtl.required !== true || !bsCtl.hint.startsWith('The same value as “Bachelor’s degree awarded” under Your standing')) throw new Error('the combined preview must keep the term the student set by hand: ' + JSON.stringify(bsCtl));
  await s.shot('combined-preview');
  // The compact (text-layer) rows at the two desktop widths the DGS checks in
  // Safari (2026-09-06): one line per course, the small columns aligned across
  // rows, nothing spilling out of the card — measured, and a cropped screenshot
  // of the preview for the eye (combined-preview-1400.png / -1100.png).
  for (const width of [1400, 1100]) await checkCompactPreview(s, width);
  await s.setViewport({ width: 1400, height: 1900 });
  await s.evalJs(
    `[...document.querySelectorAll('.external-card button')].find(b => /^Add \\d+ selected course/.test(b.textContent)).click()`,
  );
  await s.waitFor(`!document.querySelector('.external-card .transcript-preview')`);
  const combinedToast = await s.evalJs(`document.querySelector('.toast')?.textContent ?? ''`);
  console.log('  combined toast:', combinedToast.slice(0, 160));
  // Prior study is no longer inferred by an import once the earlier-degrees
  // answer exists (DGS 2026-09-22): the consent helper answered "finished".
  if (!combinedToast.includes('(2 undergraduate, 2 graduate)')) throw new Error('combined import must report the level split');
  if ((await s.evalJs(`JSON.parse(localStorage.getItem('cse-degree-audit/v1/student')).priorMs`)) !== 'completed') throw new Error('prior study must stay as the earlier-degrees answer set it');
  // The hand-set award term (3c) is kept — an import only replaces an inferred one (2026-09-06).
  if (combinedToast.includes('Bachelor’s degree awarded')) throw new Error('a hand-set award term must not be replaced by an import');
  if ((await s.evalJs(`document.querySelector('[data-key="standing.bachelors.year"]')?.value`)) !== '2021') throw new Error('the hand-set award term must survive the combined import');
  const headings = await s.evalJs(`[...document.querySelectorAll('h3.subhead')].map(h => h.textContent)`);
  console.log('  coursework headings:', JSON.stringify(headings));
  if (!headings.includes('Purdue University — Previous Undergraduate Transcript') || !headings.includes('Purdue University — Previous Master’s Transcript')) {
    throw new Error('the combined transcript must split into undergraduate and Master’s coursework groups');
  }
  // "Prior graduate study" is a radio group since 2026-09-05 (item 12).
  // Since 2026-09-22 the fact comes from the earlier-degrees answer (the consent helper says finished), not from the import.
  const priorSel = await s.evalJs(`JSON.parse(localStorage.getItem('cse-degree-audit/v1/student')).priorMs`);
  if (priorSel !== 'completed') throw new Error('prior study should be "completed" from the earlier-degrees answer, got ' + priorSel);
  await s.shot('combined-added');

  // 8) A Notre Dame transcript in a previous-degree slot is REFUSED (DGS
  //    2026-09-22, superseding 2026-09-05): insideND prints one transcript for
  //    every degree, and the Notre Dame row reads the earlier degrees from it.
  //    Unofficial or official, the answer is the same.
  for (const [label, pdf] of [['unofficial', ndPdf], ['official', ndOfficialPdf]]) {
    await s.setFileInput('.external-file-phd', pdf);
    await s.waitFor(`document.querySelector('[data-key="ext.error.phd"]')?.textContent.includes('This is a Notre Dame transcript')`);
    const refusal = await s.evalJs(`document.querySelector('[data-key="ext.error.phd"]').textContent`);
    if (!/belongs in the “Current ND Unofficial Ph\.D\. Transcript” row above, once/.test(refusal)) throw new Error('ND-in-previous-row refusal wording: ' + refusal.slice(0, 160));
    if (await s.evalJs(`!!document.querySelector('.external-card .transcript-preview')`)) throw new Error('a refused Notre Dame transcript must not open a preview');
    console.log(`  ${label} ND transcript in the Ph.D. slot refused: ` + refusal.slice(0, 80));
  }
  await s.shot('nd-in-previous-slot-refused');

  // 9) The Notre Dame transcript is removable like the others (2026-09-06):
  //    Remove takes back exactly what the import added — the 5 program
  //    courses, the prior undergraduate row (CSE 30321; it stays with this
  //    transcript since the blue/red-team review, 3b) and the transcript's
  //    own transfer-credit line — plus the GPA it filled in; the hand-typed
  //    MATH 60610 and the external courses stay.
  //    Undo puts everything back.
  const gpaBefore = await s.evalJs(`document.querySelector('input[step="0.01"]')?.value`);
  const idsBefore = await s.evalJs(`[...document.querySelectorAll('table.courses .cid')].map(e => e.textContent)`);
  const ndRowBefore = await s.evalJs(`document.querySelector('.transcript-upload')?.textContent ?? ''`);
  if (!ndRowBefore.includes('7 courses from your transcript')) throw new Error('ND row count before Remove: ' + ndRowBefore.slice(0, 120));
  const dgsBefore = await s.evalJs(`document.querySelector('.dgs-review')?.textContent ?? ''`);
  await s.evalJs(`document.querySelector('[data-key="import.nd.remove"]').click()`);
  await s.waitFor(`!document.querySelector('[data-key="import.nd.remove"]')`);
  const idsAfterRemove = await s.evalJs(`[...document.querySelectorAll('table.courses .cid')].map(e => e.textContent)`);
  const headingsAfterRemove = await s.evalJs(`[...document.querySelectorAll('h3.subhead')].map(h => h.textContent)`);
  const gpaAfterRemove = await s.evalJs(`document.querySelector('input[step="0.01"]')?.value`);
  const removeToast = await s.evalJs(`document.querySelector('.toast')?.textContent ?? ''`);
  console.log('  after ND Remove:', JSON.stringify(idsAfterRemove), '| GPA:', JSON.stringify(gpaAfterRemove), '|', removeToast.slice(0, 120));
  // The transcript's transfer-credit line (EECS 58200 from Michigan, no degree
  // slot) had its own "graduate coursework (§5.2)" group — gone with it.
  if (idsAfterRemove.length !== idsBefore.length - 7 || idsAfterRemove.some((id) => /^CSE (6|30321)/.test(id)) || headingsAfterRemove.includes('University of Michigan — graduate coursework (CSE §5.2)')) {
    throw new Error('ND Remove must take back exactly the 7 transcript rows: ' + JSON.stringify(headingsAfterRemove));
  }
  if (!idsAfterRemove.includes('MATH 60610') || !idsAfterRemove.includes('CS 58000')) throw new Error('ND Remove must keep hand-typed and external rows');
  if (gpaAfterRemove !== '') throw new Error('ND Remove must clear the GPA the transcript filled in');
  if (!removeToast.startsWith('7 courses from your ND transcript removed, and the GPA it filled in.')) throw new Error('ND Remove toast wrong: ' + removeToast.slice(0, 120));
  const ndRowAfter = await s.evalJs(`document.querySelector('.transcript-upload')?.textContent ?? ''`);
  if (!ndRowAfter.includes('Import from PDF') || ndRowAfter.includes('from your transcript')) throw new Error('ND row after Remove: ' + ndRowAfter.slice(0, 120));
  await s.shot('nd-removed');
  if ((await s.evalJs(`document.querySelector('[data-key="standing.bachelors.year"]')?.value`)) !== '2021') throw new Error('Remove must leave the bachelor’s award term alone');
  // The Undo must survive a re-render (2026-09-06 evening: it used to die with
  // the first keystroke, checkbox or toast after a Remove) — commit an
  // unrelated change, then Undo.
  await s.evalJs(`(() => { const g = document.querySelector('input[step="0.01"]'); g.value = '3.4'; g.dispatchEvent(new Event('change')); })()`);
  await s.waitFor(`document.querySelector('input[step="0.01"]')?.value === '3.4'`);
  if (!(await s.evalJs(`!!document.querySelector('.toast .toast-action')`))) throw new Error('the Undo toast must survive a re-render');
  await s.evalJs(`document.querySelector('.toast .toast-action').click()`);
  await s.waitFor(`document.querySelector('[data-key="import.nd.remove"]')`);
  const idsAfterUndo = await s.evalJs(`[...document.querySelectorAll('table.courses .cid')].map(e => e.textContent)`);
  const gpaAfterUndo = await s.evalJs(`document.querySelector('input[step="0.01"]')?.value`);
  if (JSON.stringify(idsAfterUndo) !== JSON.stringify(idsBefore) || gpaAfterUndo !== gpaBefore) {
    throw new Error(`Undo must restore the rows in their original order and the GPA (${gpaBefore} → ${gpaAfterUndo}; ${JSON.stringify(idsBefore)} → ${JSON.stringify(idsAfterUndo)})`);
  }
  const dgsAfterUndo = await s.evalJs(`document.querySelector('.dgs-review')?.textContent ?? ''`);
  if (dgsAfterUndo !== dgsBefore) throw new Error('the review card must come back exactly as it was: ' + dgsAfterUndo.slice(0, 120));
  if ((await s.evalJs(`document.activeElement?.dataset?.key ?? ''`)) !== 'import.nd.remove') throw new Error('focus must land on the Remove button after Undo');
  console.log('  ND transcript removed (rows + GPA) and restored with Undo — same order, same review card, Undo survived a re-render');

  // 10) The MSCSE side of the same card (DGS 2026-09-11). Notre Dame's 4+1
  //     issues two transcripts, so an MSCSE student's own bachelor's record
  //     arrives by itself in the Previous Undergraduate row. Its 40000-level
  //     CSE courses MAY count — "subject to all other constraints" — so they
  //     must be OFFERED, not dropped, and must end up in the review request
  //     rather than counted silently. The Notre Dame row is named for the
  //     program the student picked at the top.
  // A multi-campus system (DGS 2026-09-12): the transcript prints only
  // "UNIVERSITY OF CALIFORNIA", so the preview asks which campus, refuses
  // to add until one is chosen, and files the courses under the campus.
  {
    await s.evalJs(`localStorage.clear()`);
    await s.open(baseUrl, '.transcript-upload');
    await s.setFileInput('.external-file-masters', ucPdf);
    await s.waitFor(`!!document.querySelector('[data-key="ext.preview.campus"]')`);
    const before = JSON.parse(await s.evalJs(`JSON.stringify({ uni: document.querySelector('[data-key="ext.preview.university"]').value, chosen: document.querySelector('[data-key="ext.preview.campus"]').value, note: document.querySelector('.campus-note')?.textContent ?? '', options: [...document.querySelectorAll('[data-key="ext.preview.campus"] option')].map(o => o.textContent) })`));
    if (before.uni !== 'University of California' || before.chosen !== '') throw new Error('the system name alone must not pass as the university: ' + JSON.stringify(before));
    if (!/names only the University of California system/.test(before.note)) throw new Error('the campus hint must say why it is asked: ' + before.note);
    if (!before.options.includes('University of California, San Diego') || !before.options.includes('University of California, Berkeley')) throw new Error('the campus list is incomplete: ' + JSON.stringify(before.options));
    // The reader-problem email (DGS 2026-10-11, item 18): after one corrected
    // row (its "Taken as" level), it names the university and the shape of
    // that row — never a course number or a grade in clear.
    const ucIds = JSON.parse(await s.evalJs(`JSON.stringify([...document.querySelectorAll('[data-key^="ext.row."][data-key$=".id"]')].map((e) => e.value || e.textContent).filter(Boolean))`));
    await s.evalJs(`(() => { const l = document.querySelector('select[data-key="ext.row.0.level"]'); l.value = l.value === 'graduate' ? 'undergraduate' : 'graduate'; l.dispatchEvent(new Event('change')); })()`);
    const ucProblem = await readerProblemBody(s, 'ext.preview.problem');
    if (!/^Transcript: Previous Master’s Transcript — University of California$/m.test(ucProblem) || !/^Rows read: \d+; ticked to add: \d+; changed by me: 1; typed by me: 0$/m.test(ucProblem) || !/^ {2}1\. [Aa9 |+-]+ — I changed: level$/m.test(ucProblem) || ucIds.length === 0 || ucIds.some((id) => ucProblem.includes(id))) throw new Error('the reader-problem email must name the university, the counts and the changed row’s shape, and no course in clear: ' + JSON.stringify({ ucIds, ucProblem }));
    await s.evalJs(`(() => { const l = document.querySelector('select[data-key="ext.row.0.level"]'); l.value = l.value === 'graduate' ? 'undergraduate' : 'graduate'; l.dispatchEvent(new Event('change')); })()`); // put it back
    console.log('  external preview: "Did the reader get this transcript wrong?" —', ucProblem.split('\n').find((l) => l.startsWith('Rows read')), '| shapes:', ucProblem.split('\n').filter((l) => /^ {2}\d+\. /.test(l)).join(' / ') || '(none)');
    await s.evalJs(`document.querySelector('[data-key="ext.preview.add"]').click()`);
    await s.waitFor(`/Choose the University of California campus/.test(document.querySelector('.external-card .import-error')?.textContent ?? '')`);
    console.log('  UC system transcript: campus required — Add refused with a reason');
    await s.evalJs(`(() => { const sel = document.querySelector('[data-key="ext.preview.campus"]'); sel.value = 'San Diego'; sel.dispatchEvent(new Event('change')); })()`);
    await s.waitFor(`document.querySelector('[data-key="ext.preview.university"]')?.value === 'University of California, San Diego'`);
    await s.evalJs(`document.querySelector('[data-key="ext.preview.add"]').click()`);
    await s.waitFor(`[...document.querySelectorAll('h3.subhead')].some(h => h.textContent.includes('University of California, San Diego'))`);
    console.log('  campus chosen → courses filed under "University of California, San Diego"');
    await s.shot('uc-campus-picker');
  }

  // A transcript whose rows do not add up to its own totals (DGS 2026-10-11,
  // item 11): the preview names the term and both figures, and marks that
  // term's row; the whole record's line says so too.
  {
    await s.evalJs(`localStorage.clear()`);
    await s.open(baseUrl, '.transcript-upload');
    await s.setFileInput('.external-file-masters', totalsMismatchPdf);
    await s.waitFor(`!!document.querySelector('[data-key="ext.preview.totals"]')`);
    const check = JSON.parse(await s.evalJs(`JSON.stringify({
      items: [...document.querySelectorAll('[data-key="ext.preview.totals"] li')].map((li) => li.textContent),
      doubted: [...document.querySelectorAll('.external-card .transcript-preview tr.totals-doubt')].map((tr) => tr.querySelector('.cell-course .course-id, .cell-course input')?.textContent || tr.querySelector('.cell-course input')?.value),
      note: document.querySelector('.external-card .transcript-preview tr.totals-doubt .totals-doubt-note')?.textContent ?? '',
    })`));
    console.log('  totals check:', JSON.stringify(check));
    if (!check.items.includes('Fall 2023 prints 6.0 earned hours; the rows read add to 3.0 — a row may be missing or misread.') || !check.items.some((t) => /^The transcript's totals print 12\.0 earned hours; the rows read add to 9\.0/.test(t))) throw new Error('the preview must name the term and both figures: ' + JSON.stringify(check.items));
    if (JSON.stringify(check.doubted) !== JSON.stringify(['CS 50100']) || check.note !== '⚠ Fall 2023 does not add up: check this row') throw new Error('only the Fall 2023 row is marked: ' + JSON.stringify(check));
    await s.shotElement('totals-check-preview', '.external-card .transcript-preview');
    await s.evalJs(`document.querySelector('[data-key="ext.preview.cancel"]').click()`);
    await s.waitFor(`!document.querySelector('[data-key="ext.preview.totals"]')`);
  }

  // A transcript that prints no course numbers (CC15, DGS 2026-10-09; the e2e
  // leg 2026-10-10): each row comes in with an EMPTY, required course-id box,
  // unticked, its tick box disabled; Add adds nothing until an id is typed;
  // typing one ticks the row, and only that row is added, under the typed id.
  {
    await s.evalJs(`localStorage.clear()`);
    await s.open(baseUrl, '.transcript-upload');
    await s.setFileInput('.external-file-masters', codelessPdf);
    await s.waitFor(`document.querySelector('.external-card .transcript-preview [data-key="ext.preview.codeMissing"]')`);
    const readRows = async () => JSON.parse(await s.evalJs(`JSON.stringify([...document.querySelectorAll('.external-card .transcript-preview table tr')].slice(1).map((tr, i) => {
      const id = tr.querySelector('input[data-key="ext.row.' + i + '.id"]');
      const cb = tr.querySelector('input[data-key="ext.row.' + i + '.include"]');
      return { title: tr.querySelector('[data-key="ext.row.' + i + '.title"]')?.textContent || tr.querySelector('[data-key="ext.row.' + i + '.title"]')?.value || '', id: id?.value ?? null, required: id?.required ?? null, invalid: id?.getAttribute('aria-invalid') ?? null, placeholder: id?.placeholder ?? null, ticked: cb?.checked ?? null, disabled: cb?.disabled ?? null };
    }))`));
    const addLabel = () => s.evalJs(`document.querySelector('[data-key="ext.preview.add"]')?.textContent ?? ''`);
    const before = await readRows();
    const note = await s.evalJs(`document.querySelector('[data-key="ext.preview.codeMissing"]').textContent`);
    const uni = await s.evalJs(`document.querySelector('[data-key="ext.preview.university"]')?.value ?? ''`);
    console.log('  code-less transcript:', uni, '|', JSON.stringify(before), '|', await addLabel());
    if (uni !== 'Example Normal University' || before.length !== 3 || before.map((r) => r.title).join(' | ') !== 'Advanced Operating Systems | Machine Learning | Distributed Computing') throw new Error('the code-less transcript must read its three rows: ' + uni + ' ' + JSON.stringify(before));
    if (!before.every((r) => r.id === '' && r.required === true && r.invalid === 'true' && r.placeholder === 'course number' && r.ticked === false && r.disabled === true)) throw new Error('every code-less row starts with an empty, required id box and a disabled, unticked box: ' + JSON.stringify(before));
    if (!note.startsWith('3 courses on this transcript have no course number printed')) throw new Error('the preview must say once that course numbers are missing (W-CL409): ' + note.slice(0, 120));
    if ((await addLabel()) !== 'Add 0 selected courses') throw new Error('no code-less row counts toward Add until it has an id: ' + (await addLabel()));
    await s.shotElement('codeless-preview', '.external-card .transcript-preview');
    // Add with every id box empty: refused out loud, nothing added.
    await s.evalJs(`document.querySelector('[data-key="ext.preview.add"]').click()`);
    await s.waitFor(`/No rows are complete yet/.test(document.querySelector('.external-card .import-error')?.textContent ?? '')`);
    if (await s.evalJs(`[...document.querySelectorAll('h3.subhead')].some((h) => h.textContent.includes('Example Normal University'))`)) throw new Error('Add must add nothing while every id box is empty');
    if (!(await s.evalJs(`!!document.querySelector('.external-card .transcript-preview')`))) throw new Error('the preview must stay open after the refused Add');
    console.log('  Add with every id box empty → refused (“No rows are complete yet”), nothing added');
    // Type an id into the first row: it ticks, and Add counts it.
    await s.evalJs(`(() => { const i = document.querySelector('[data-key="ext.row.0.id"]'); i.value = 'CS 60100'; i.dispatchEvent(new Event('change')); })()`);
    await s.waitFor(`document.querySelector('[data-key="ext.row.0.include"]')?.checked === true`);
    const after = await readRows();
    console.log('  after typing an id into row 1:', JSON.stringify(after), '|', await addLabel());
    if (after[0].disabled !== false || after[0].invalid !== null || !after.slice(1).every((r) => r.ticked === false && r.disabled === true)) throw new Error('typing an id ticks that row only: ' + JSON.stringify(after));
    if ((await addLabel()) !== 'Add 1 selected course') throw new Error('Add counts the row once its id is typed: ' + (await addLabel()));
    await s.shotElement('codeless-preview-filled', '.external-card .transcript-preview');
    await s.evalJs(`document.querySelector('[data-key="ext.preview.add"]').click()`);
    await s.waitFor(`!document.querySelector('.external-card .transcript-preview') && [...document.querySelectorAll('h3.subhead')].some((h) => h.textContent.includes('Example Normal University'))`);
    const added = await s.evalJs(`(() => { const h = [...document.querySelectorAll('h3.subhead')].find((h) => h.textContent.includes('Example Normal University')); const t = h?.nextElementSibling?.matches('.table-scroll') ? h.nextElementSibling : h?.nextElementSibling?.nextElementSibling; return [...(t?.querySelectorAll('tr') ?? [])].slice(1).map((tr) => tr.querySelector('.cid').textContent); })()`);
    const saved = JSON.parse(await s.evalJs(`localStorage.getItem('cse-degree-audit/v1/student') ?? '{}'`));
    const savedIds = (saved.courses ?? []).map((c) => c.courseId);
    console.log('  added:', JSON.stringify(added), '| saved course ids:', JSON.stringify(savedIds));
    if (JSON.stringify(added) !== JSON.stringify(['CS 60100']) || !savedIds.includes('CS 60100') || savedIds.some((id) => typeof id !== 'string' || id.trim() === '')) throw new Error('only the row with a typed id is added, under that id, and no empty id is saved');
    console.log('  code-less transcript: the id box blocked Add until filled; the one filled row was added as CS 60100');
  }

  await s.evalJs(`localStorage.clear()`);
  // The program is chosen in the opening dialog, and Reset brings it back
  // (DGS 2026-09-22): the Notre Dame row's label follows the choice.
  await s.open(baseUrl, '.transcript-upload');
  const chooseViaReset = async (program) => {
    await s.evalJs(`window.confirm = () => true; document.querySelector('[data-key="tools.reset"]').click()`);
    await s.waitFor(`document.querySelector('.consent-overlay')`);
    await s.evalJs(`(() => {
      document.querySelector('[data-key="consent.program.${program}"]').click();
      document.querySelector('[data-key="consent.ack"]').click();
      document.querySelector('.consent-overlay button.btn').click();
    })()`);
    await s.waitFor(`!document.querySelector('.consent-overlay')`);
    // The earlier degrees, on the page since 2026-10-08 (Option 1).
    await s.evalJs(`document.querySelector('[data-key="earlier.answer"]')?.click()`); // a fresh record folds the questions (UI review item 2, 2026-10-09)
    for (const k of ['earlier.bachelors.elsewhere', 'earlier.graduate.elsewhere', 'earlier.sameplace.no', 'earlier.finished.yes', 'earlier.done']) await s.evalJs(`document.querySelector('[data-key="${k}"]')?.click()`);
  };
  await chooseViaReset('mscse');
  await s.waitFor(`document.querySelector('.transcript-upload')?.textContent.includes('Current ND Unofficial MSCSE Transcript')`);
  if (await s.evalJs(`!!document.querySelector('[data-key^="program."]')`)) throw new Error('the program tabs must be gone (DGS 2026-09-22)');
  await chooseViaReset('phd');
  await s.waitFor(`document.querySelector('.transcript-upload')?.textContent.includes('Current ND Unofficial Ph.D. Transcript')`);
  await chooseViaReset('mscse');
  await s.waitFor(`document.querySelector('.transcript-upload')?.textContent.includes('Current ND Unofficial MSCSE Transcript')`);
  console.log('  the Notre Dame row follows the program chosen in the opening dialog: MSCSE → "Current ND Unofficial MSCSE Transcript", Ph.D. → "Current ND Unofficial Ph.D. Transcript"; Reset brings the dialog back');

  // The §3.4 route is read off the record (DGS 2026-09-12, red-team F4): a
  // Master's project course added while "Undecided" sets the option to
  // project, with a toast, and the thesis rows leave the report.
  {
    await s.evalJs(`(() => {
      const o = document.querySelector('[data-key="course.new.origin"]'); o.value = 'nd'; o.dispatchEvent(new Event('change'));
      const id = document.querySelector('[data-key="course.new.id"]'); id.value = 'CSE 68902'; id.dispatchEvent(new Event('change'));
      const cr = document.querySelector('[data-key="course.new.credits"]'); cr.value = '3'; cr.dispatchEvent(new Event('change')); // the live sheet has no default credits for it
      document.querySelector('[data-key="course.new.add"]').click();
    })()`);
    await s.waitFor(`[...document.querySelectorAll('table.courses .cid')].some(e => e.textContent === 'CSE 68902')`);
    await s.waitFor(`document.querySelector('[data-key="standing.msOption.project"]')?.checked === true`);
    const optToast = await s.evalJs(`document.querySelector('.toast.auto-notice')?.textContent ?? ''`);
    if (!/set to “M.S. project” from your record/.test(optToast)) throw new Error('pre-filling the option must be announced: ' + optToast);
    const thesisRow = await s.evalJs(`!![...document.querySelectorAll('#report *')].find(e => /Thesis defense/.test(e.textContent ?? '') && e.children.length === 0)`);
    if (thesisRow) throw new Error('with the project route read off the record the thesis-defense row must not show');
    console.log('  CSE 68902 added while undecided → option pre-filled to project (toast shown), thesis rows gone');
    await s.evalJs(`[...document.querySelectorAll('table.courses tr')].find(tr => tr.querySelector('.cid')?.textContent === 'CSE 68902').querySelector('button.remove').click()`);
    await s.waitFor(`![...document.querySelectorAll('table.courses .cid')].some(e => e.textContent === 'CSE 68902')`);
    await s.evalJs(`document.querySelector('[data-key="standing.msOption.undecided"]').click()`);
  }

  // A Notre Dame undergraduate transcript in the Undergraduate row is refused
  // (DGS 2026-09-22): it goes in the Notre Dame row, once. The in-progress
  // fixture is a Notre Dame transcript too, so it gets the same answer.
  for (const [label, pdf] of [['in-progress', ndUgInProgressPdf], ['finished', ndUgPdf]]) {
    await s.setFileInput('.external-file-bachelors', pdf);
    await s.waitFor(`document.querySelector('[data-key="ext.error.bachelors"]')?.textContent.includes('This is a Notre Dame transcript')`);
    if (await s.evalJs(`!!document.querySelector('.external-card .transcript-preview')`)) throw new Error('a refused Notre Dame transcript must not open a preview');
    console.log(`  ${label} ND undergraduate transcript in the Undergraduate row refused`);
  }
  // The 4+1 record — the courses the Notre Dame row's import files as prior
  // undergraduate coursework — is loaded as a saved record, so the rest of
  // the step tests the MSCSE audit and its lines, not an import path.
  await s.evalJs(`localStorage.setItem('cse-degree-audit/v1/student', JSON.stringify({ schemaVersion: 1, program: 'mscse', entryTerm: { season: 'fall', year: 2026 }, priorMs: 'none', gpa: 3.5, bachelorsAwarded: { season: 'spring', year: 2026 }, background: { bachelors: 'nd-cse', ndIntegrated: false, graduate: 'none' }, integratedBsMs: undefined, courses: [
    { courseId: 'CSE 40113', title: 'Design/Analysis of Algorithms', credits: 3, grade: 'A', term: { season: 'fall', year: 2024 }, origin: 'transfer', institution: 'University of Notre Dame', degreeLevel: 'bachelors', registeredLevel: 'undergraduate' },
    { courseId: 'CSE 40166', title: 'Computer Graphics', credits: 3, grade: 'A-', term: { season: 'spring', year: 2025 }, origin: 'transfer', institution: 'University of Notre Dame', degreeLevel: 'bachelors', registeredLevel: 'undergraduate' },
    { courseId: 'CSE 60641', title: 'Graduate Operating Systems', credits: 3, grade: 'A', term: { season: 'spring', year: 2026 }, origin: 'transfer', institution: 'University of Notre Dame', degreeLevel: 'bachelors', registeredLevel: 'undergraduate' } ], milestones: {}, attestations: {} }))`);
  await s.open(baseUrl, '.transcript-upload');
  await s.waitFor(`[...document.querySelectorAll('table.courses .cid')].map(e => e.textContent).includes('CSE 40166')`);

  // The student is never asked (DGS 2026-09-11): the app applies the two
  // 40000-level CSE courses to both degrees and saves the 60000-level one for
  // the MSCSE, and every line says which. No dropdown exists on this tab.
  const lineOf = (id) => `[...document.querySelectorAll('table.courses tr')].find(tr => tr.querySelector('.cid')?.textContent === '${id}')?.textContent ?? ''`;
  if (await s.evalJs(`document.querySelectorAll('[data-key^="course."][data-key$=".countedToward"]').length`)) throw new Error('the MSCSE tab must not ask which degrees a course counted toward');
  // The LIVE sheet decides whether these two are `yes` (counted) or
  // `adgs_approval` (counted provisionally, listed for the ADGS) for the
  // MSCSE — the DGS changes such cells (2026-09-16: both became yes). The
  // step accepts either verdict and pins what does not depend on it.
  await s.waitFor(`/pending ADGS review|waiting for the ADGS|counts toward regular courses/.test(${lineOf('CSE 40113')})`);
  const after40113 = await s.evalJs(lineOf('CSE 40113'));
  const after40166 = await s.evalJs(lineOf('CSE 40166'));
  console.log('  CSE 40113:', after40113.replace(/\s+/g, ' ').slice(0, 190));
  console.log('  CSE 40166:', after40166.replace(/\s+/g, ' ').slice(0, 190));
  const provisional = {};
  for (const [id, text] of [['CSE 40113', after40113], ['CSE 40166', after40166]]) {
    provisional[id] = /waiting for the ADGS — would count toward regular courses \(3 cr\) once approved/.test(text);
    if (!provisional[id] && !/counts toward regular courses \(3 cr\)/.test(text)) throw new Error(id + ' must be counted, provisionally or in full: ' + text.slice(0, 200));
    if (!/uses the 40000-level allowance \(6 credits, (?:CSE )?§3\.2\)/.test(text)) throw new Error(id + ' must cite the MSCSE allowance: ' + text.slice(0, 200));
  }
  // Only a 4+1's undergraduate 60000-level course earns credit (DGS
  // 2026-09-12, red-team F7). This fixture registers CSE 60641 at the
  // undergraduate level, so nothing marks the student as a 4+1: the standing
  // card asks, the course earns nothing until answered, and "Yes" counts it.
  const before60641 = await s.evalJs(lineOf('CSE 60641'));
  if (!/earns MSCSE credit only for a student who was in the Integrated B\.S\. \+ M\.S\. \(4\+1\) program(?: \((?:CSE )?§3\.5\))?; if you were, say so in the earlier-degrees questions/.test(before60641)) {
    throw new Error('unanswered 4+1: the 60000-level undergraduate course must earn nothing and say why: ' + before60641.slice(0, 220));
  }
  // The 4+1 is answered in the earlier-degrees questions since 2026-09-22.
  await s.evalJs(`document.querySelector('[data-key="standing.background.change"]').click()`);
  await s.waitFor(`document.querySelector('dialog.background-dialog[open]')`);
  // Since 2026-10-04 (P2-fourplusone-1) the "Yes" asks when the student was
  // admitted to the Integrated program: the senior fall, before the Spring 2026
  // bachelor's — so the extra senior-year course may count.
  await s.evalJs(`document.querySelector('[data-key="background.ndintegrated.yes"]').click()`);
  await s.waitFor(`document.querySelector('[data-key="background.admitted.year"]')`);
  await s.evalJs(`(() => {
    const season = document.querySelector('[data-key="background.admitted.season"]'); season.value = 'fall'; season.dispatchEvent(new Event('change'));
    const year = document.querySelector('[data-key="background.admitted.year"]'); year.value = '2025'; year.dispatchEvent(new Event('change'));
    document.querySelector('[data-key="background.save"]').click();
  })()`);
  await s.waitFor(`!document.querySelector('dialog.background-dialog')`);
  // Since 2026-10-03 a 4+1 course applied to the MSCSE alone, registered UG on
  // the transcript, counts provisionally until the ADGS confirms the UG→GR move
  // ("would count toward regular courses … once approved"); the shared pair counts outright.
  await s.waitFor(`/(counts|would count) toward regular courses/.test(${lineOf('CSE 60641')})`);
  console.log('  4+1 asked; answered Yes → the senior-year 60000-level course counts (or waits for the UG→GR confirmation)');
  // The UG-registered row waits on the ADGS's confirmation of the UG→GR move:
  // it carries the approval tick (DGS 2026-10-08), which settles it — the line
  // then counts outright and names the tick; unticked, it waits again.
  if (/would count toward regular courses/.test(await s.evalJs(lineOf('CSE 60641')))) {
    const tickKey = await s.evalJs(`[...document.querySelectorAll('table.courses tr')].find(tr => tr.querySelector('.cid')?.textContent === 'CSE 60641')?.querySelector('[data-key$=".approved"]')?.dataset.key ?? ''`);
    if (!tickKey) throw new Error('a course waiting on the UG→GR confirmation must offer “The ADGS approved this course for me”');
    await s.evalJs(`document.querySelector('[data-key="${tickKey}"]').click()`);
    await s.waitFor(`/^.*counts toward regular courses \\(3 cr\\).*approved by the ADGS for you, as you ticked on the course/.test(${lineOf('CSE 60641')})`);
    await s.evalJs(`document.querySelector('[data-key="${tickKey}"]').click()`);
    await s.waitFor(`/would count toward regular courses/.test(${lineOf('CSE 60641')})`);
    console.log('  the UG-registered course offers the approval tick; ticked, it counts and says so; unticked, it waits again');
  }
  const after60641 = await s.evalJs(lineOf('CSE 60641'));
  console.log('  CSE 60641:', after60641.replace(/\s+/g, ' ').slice(0, 190));
  // §3.5's senior-year graduate course: saved for the graduate degree and
  // said so; the two 40000-level courses are the ones applied to both.
  if (!/(counts|would count) toward regular courses \(3 cr\)/.test(after60641) || !/will apply to your MSCSE only/.test(after60641)) {
    throw new Error('a 60000-level senior-year course must count (in full, or once the UG→GR move is confirmed), for the MSCSE only: ' + after60641.slice(0, 200));
  }
  for (const [id, text] of [['CSE 40113', after40113], ['CSE 40166', after40166]]) {
    if (!/will apply to both your bachelor’s degree and your MSCSE/.test(text)) throw new Error(id + ' must say it applies to both degrees: ' + text.slice(0, 200));
  }
  const dgsCard = await s.evalJs(`document.querySelector('.dgs-review')?.textContent ?? ''`);
  for (const id of ['CSE 40113', 'CSE 40166']) {
    if (provisional[id] && !dgsCard.includes(id)) throw new Error(id + ' must be listed for the DGS: ' + dgsCard.slice(0, 300));
    if (!provisional[id] && dgsCard.includes(id)) throw new Error(id + ' is counted by the sheet and must not be asked about: ' + dgsCard.slice(0, 300));
  }
  if (Object.values(provisional).some(Boolean) && !/may count toward the MSCSE \(§3\.2\) inside the allowance for courses below the 60000 level/.test(dgsCard)) {
    throw new Error('the review card must say what the 40000-level courses may do: ' + dgsCard.slice(0, 400));
  }
  await s.shot('mscse-prior-undergrad');
  console.log('  MSCSE + ND undergraduate transcript: 40000-level courses offered, asked about, counted provisionally and listed for the DGS');

  // 11) The MSCSE has no qualifying examination, so nothing about §4.4.1 core
  //     knowledge or §4.4.2 specialization may reach a student on this tab
  //     (DGS 2026-09-11). Asserted over the whole page, and over the preview
  //     of an external transcript — where the undergraduate notes used to say
  //     "core knowledge only" whichever degree the student was in.
  const FORBIDDEN = /§4(\.\d)*\b|core.knowledge|core area|core-area|core keyword|specialization|qualifying examination|qualifier/i;
  // The program tabs are the one place "Ph.D. §4" belongs on this page.
  const tabLabels = await s.evalJs(`JSON.stringify([...document.querySelectorAll('.tabs button')].map(b => b.textContent.trim()))`);
  const pageText = (await s.evalJs(`document.querySelector('#app').innerText`)).split('\n').filter((line) => !JSON.parse(tabLabels).includes(line.trim())).join('\n');
  // A Graduate School citation (“Academic Code §4.4”) is not the CSE handbook's §4 (2026-10-03).
  const offending = pageText.split('\n').filter((line) => FORBIDDEN.test(line.replace(/(?:Academic Code|DGS Handbook) §\d+(?:\.\d+)*/g, '')));
  if (offending.length > 0) throw new Error('the MSCSE tab must not mention the qualifying examination:\n  ' + offending.slice(0, 6).join('\n  '));
  console.log('  MSCSE tab: no §4.4.1 / §4.4.2 anywhere on the page (' + pageText.length + ' characters checked)');
  // …and the decider is the ADGS (DGS 2026-09-11): outside the contact card,
  // the notices, the glossary and the footer, "DGS" alone must not appear.
  const dgsLines = (await s.evalJs(`(() => { const c = document.querySelector('#app').cloneNode(true); c.querySelectorAll('.contact-card, .notice-line, .notice-details, details.glossary, .print-header, footer, .tabs').forEach(e => e.remove()); return c.textContent; })()`))
    // "DGS Handbook" is the Graduate School's document, not the decider (2026-10-03),
    // and the DGS's own dated rulings keep the DGS's name — "DGS decision
    // 2026-08-31", "(DGS 2026-10-03)" (policy review round 3, P3-text-engine-4).
    // The same rule as src/engine/decider.ts DECIDER_DGS; change both together.
    .split(/[.!?]\s|\n/).map((l) => l.trim()).filter((l) => /\bDGS\b(?! Handbook| decision 20\d\d| 20\d\d-\d\d)/.test(l));
  if (dgsLines.length) throw new Error('the MSCSE tab must send the student to the ADGS, not the DGS:\n  ' + dgsLines.slice(0, 6).join('\n  '));
  const reviewHead = await s.evalJs(`document.querySelector('.dgs-review h2')?.textContent ?? ''`);
  // No review card at all when the live sheet has settled every course (both 40xxx rows are `yes` since 2026-09-16); when there is one it addresses the ADGS.
  if (reviewHead !== '' && !/Ask the ADGS to review/.test(reviewHead)) throw new Error('the review card must address the ADGS on the MSCSE tab: ' + reviewHead);
  console.log('  MSCSE tab: every decision goes to the ADGS — no standalone "DGS" outside the contact card, notices, glossary and footer');

  // This record answered "no graduate degree", so it has no Master's row
  // (DGS 2026-09-22); say a master's elsewhere before importing one. A 4+1
  // student cannot have one (DGS 2026-10-08: the option is not offered while
  // the 4+1 is "Yes"), so the 4+1 goes back to "No" first — the record is
  // reset right after the preview below.
  await s.evalJs(`document.querySelector('[data-key="standing.background.change"]').click()`);
  await s.waitFor(`document.querySelector('dialog.background-dialog[open]')`);
  if (!(await s.evalJs(`document.querySelector('[data-key="background.graduate.elsewhere"]').closest('label').hidden`))) throw new Error('an MSCSE student in the 4+1 must not be offered a graduate degree elsewhere');
  await s.evalJs(`document.querySelector('[data-key="background.ndintegrated.no"]').click()`);
  await s.evalJs(`(() => { for (const k of ['background.graduate.elsewhere', 'background.sameplace.no', 'background.finished.yes']) document.querySelector('[data-key="' + k + '"]').click(); document.querySelector('[data-key="background.save"]').click(); })()`);
  await s.waitFor(`!document.querySelector('dialog.background-dialog') && !!document.querySelector('.external-file-masters')`);
  await s.setFileInput('.external-file-masters', combinedPdf);
  await s.waitFor(`document.querySelector('.external-card .transcript-preview table tr:nth-child(2)')`);
  const previewText = await s.evalJs(
    `(() => { const b = document.querySelector('.external-card .transcript-preview'); return b.innerText + ' || ' + [...b.querySelectorAll('[title]')].map(e => e.title).join(' || '); })()`,
  );
  const previewOffending = previewText.split(/\n|\|\|/).filter((line) => FORBIDDEN.test(line));
  if (previewOffending.length > 0) throw new Error('the MSCSE preview must not mention the qualifying examination:\n  ' + previewOffending.slice(0, 6).join('\n  '));
  const ugOffered = await s.evalJs(
    `[...document.querySelectorAll('.external-card .transcript-preview table tr')].slice(1).map(tr => (tr.querySelector('.cell-course input')?.value ?? tr.querySelector('.cell-course .course-id')?.textContent) + ':' + (tr.querySelector('.cell-check input').checked ? 'ticked' : 'unticked') + ':' + tr.querySelector('select.row-level').value)`,
  );
  console.log('  MSCSE + a combined external transcript:', JSON.stringify(ugOffered));
  // CS 35400 "Operating Systems" is undergraduate on that transcript: a core
  // keyword is no reason to offer it to an MSCSE student.
  if (ugOffered.some((r) => /^CS 35400/.test(r) && /:ticked/.test(r))) throw new Error('an undergraduate row must not be offered to an MSCSE student: ' + JSON.stringify(ugOffered));
  await s.shot('mscse-external-preview');
  await s.evalJs(`[...document.querySelectorAll('.external-card button')].find(b => b.textContent === 'Cancel').click()`);
  await s.waitFor(`!document.querySelector('.external-card .transcript-preview')`);
  console.log('  MSCSE preview: undergraduate rows are not offered on a core-sounding title, and no note names the qualifier');

  // Option 1 (DGS 2026-10-08): the opening dialog asks only the program; the
  // earlier degrees are asked on the page and read from the Notre Dame
  // transcript where it can tell. A fresh Ph.D. record imports an insideND-
  // layout transcript whose undergraduate terms end in Computer Engineering:
  // "Notre Dame — CSE" comes back chosen, with where it was read; the graduate
  // question and the 4+1 follow-up stay for the student.
  {
    await s.evalJs(`window.confirm = () => true; document.querySelector('[data-key="tools.reset"]').click()`);
    await s.waitFor(`document.querySelector('.consent-overlay')`);
    const dialogQuestions = await s.evalJs(`document.querySelectorAll('dialog.consent fieldset:not(.consent-program-group), dialog.consent .background-questions').length`);
    if (dialogQuestions !== 0) throw new Error('the opening dialog must ask only the program (Option 1)');
    await s.evalJs(`(() => { document.querySelector('[data-key="consent.program.phd"]').click(); document.querySelector('[data-key="consent.ack"]').click(); document.querySelector('.consent-overlay button.btn').click(); })()`);
    await s.waitFor(`!document.querySelector('.consent-overlay') && !!document.querySelector('#earlier-degrees')`);
    if (await s.evalJs(`!!document.querySelector('#earlier-degrees input:checked')`)) throw new Error('a fresh record has no earlier-degrees answer');
    // At phone width (UI review, 2026-10-08): the rows that start unticked are
    // tucked — really hidden in the stack layout — behind a toggle whose
    // aria-expanded follows it, with Add at the top too.
    await s.setViewport({ width: 390, height: 844, settleMs: 200 });
    await s.setFileInput('.transcript-upload input[type=file]', ndInsideNdPdf);
    await s.waitFor(`document.querySelector('.transcript-preview')`);
    // Every term and both levels' totals add up (item 11, 2026-10-11): no warning.
    if (await s.evalJs(`!!document.querySelector('[data-key="preview.totals"]')`)) throw new Error('the insideND transcript adds up — no totals warning may show: ' + (await s.evalJs(`document.querySelector('[data-key="preview.totals"]').textContent`)));
    const tuck = async () => JSON.parse(await s.evalJs(`JSON.stringify((() => { const rows = [...document.querySelectorAll('.transcript-preview table tr')].slice(1); const t = document.querySelector('[data-key="preview.unticked.toggle"]'); return { rows: rows.length, shown: rows.filter((r) => getComputedStyle(r).display !== 'none').length, toggle: t?.textContent ?? '', expanded: t?.getAttribute('aria-expanded') ?? '', top: !!document.querySelector('[data-key="preview.add.top"]') }; })())`));
    const t0 = await tuck();
    if (!t0.top || t0.shown >= t0.rows || !/^Show the \d+ courses? that start unticked$/.test(t0.toggle) || t0.expanded !== 'false') throw new Error('phone preview: unticked rows must be tucked behind the toggle, Add at the top: ' + JSON.stringify(t0));
    await s.evalJs(`document.querySelector('[data-key="preview.unticked.toggle"]').click()`);
    await s.settle();
    const t1 = await tuck();
    if (t1.shown !== t1.rows || t1.expanded !== 'true') throw new Error('phone preview: Show must show every row: ' + JSON.stringify(t1));
    await s.evalJs(`document.querySelector('[data-key="preview.unticked.toggle"]').click()`);
    await s.settle();
    const t2 = await tuck();
    if (t2.shown !== t0.shown || t2.expanded !== 'false') throw new Error('phone preview: Hide must tuck them again, aria-expanded back to false: ' + JSON.stringify(t2));
    console.log(`  phone preview: ${t0.rows - t0.shown} of ${t0.rows} rows tucked behind the toggle (aria-expanded follows), Add at the top`);
    await s.setViewport({ width: 1400, height: 1900, settleMs: 200 });
    const entry = await s.evalJs(`document.querySelector('.transcript-preview .entry-term-line')?.textContent ?? ''`);
    if (!entry.includes('Fall 2025')) throw new Error('the insideND transcript’s entry term is its first graduate term, Fall 2025: ' + entry.slice(0, 120));
    await s.evalJs(`[...document.querySelectorAll('.transcript-preview button')].find(b => /^Add \\d+ selected course/.test(b.textContent)).click()`);
    await s.waitFor(`!document.querySelector('.transcript-preview')`);
    await s.waitFor(`document.querySelector('[data-key="earlier.bachelors.nd-cse"]')?.checked === true`);
    const readToast = await s.evalJs(`[...document.querySelectorAll('.toast')].map(t => t.textContent).join(' | ')`);
    if (!readToast.includes('Your earlier degrees were partly filled in from it — check them in the Transcripts card.')) throw new Error('the import toast must say the earlier degrees were filled in: ' + readToast.slice(0, 300));
    const note = await s.evalJs(`document.querySelector('[data-key="earlier.read.bachelors"]')?.textContent ?? ''`);
    console.log('  read note:', note);
    if (!/Read from your transcripts: your Notre Dame transcript shows undergraduate terms through Spring 2025, majoring in Computer Engineering/.test(note)) throw new Error('the bachelor’s answer must say where it was read: ' + note);
    if (await s.evalJs(`!!document.querySelector('#earlier-degrees [data-key^="earlier.graduate."]:checked')`)) throw new Error('the transcript cannot tell the graduate history; it stays unanswered');
    if (!(await s.evalJs(`!!document.querySelector('[data-key="earlier.ndintegrated.yes"]')`))) throw new Error('the 4+1 follow-up must be asked under “Notre Dame — CSE”');
    if (!(await s.evalJs(`!!document.querySelector('.next-steps a[href="#earlier-degrees"]')`))) throw new Error('Next steps must point to the earlier-degrees questions while they are open');
    if (!(await s.evalJs(`!!document.querySelector('[data-key="standing.background.goto"][href="#earlier-degrees"]')`))) throw new Error('the standing card must point to them too');
    if ((await s.evalJs(`document.querySelector('#earlier-read-bachelors') && [...document.querySelectorAll('[data-key^="earlier.bachelors."]')].every(i => i.getAttribute('aria-describedby') === 'earlier-read-bachelors')`)) !== true) throw new Error('the read note must describe the bachelor’s choices for a screen reader');
    await s.evalJs(`document.querySelector('#earlier-degrees').scrollIntoView({ block: 'start' })`);
    await s.shot('earlier-degrees-read');
    // The student changes it: the note goes, the answer is theirs.
    await s.evalJs(`document.querySelector('[data-key="earlier.bachelors.nd-other"]').click()`);
    await s.waitFor(`document.querySelector('[data-key="earlier.bachelors.nd-other"]')?.checked === true && !document.querySelector('[data-key="earlier.read.bachelors"]')`);
    // A previous master's transcript from another university, imported while
    // the graduate question is open: "Yes, at another university" is read
    // (no conferral line, no bachelor's transcript: the two follow-ups stay).
    await s.setFileInput('.external-file-masters', externalPdf);
    await s.waitFor(`document.querySelector('.external-card .transcript-preview table tr:nth-child(2)')`);
    await s.evalJs(`[...document.querySelectorAll('.external-card button')].find(b => /^Add \\d+ selected course/.test(b.textContent)).click()`);
    await s.waitFor(`!document.querySelector('.external-card .transcript-preview') && document.querySelector('[data-key="earlier.graduate.elsewhere"]')?.checked === true`);
    const gradNote = await s.evalJs(`document.querySelector('[data-key="earlier.read.graduate"]')?.textContent ?? ''`);
    if (!gradNote.includes('you added a previous master’s transcript from Purdue University')) throw new Error('the graduate answer must say where it was read: ' + gradNote);
    // The bachelor's is answered as Notre Dame's, so the master's elsewhere is
    // not at the same university (blue/red-team review, 2026-10-08); no
    // conferral line, so "finished" stays for the student.
    if (await s.evalJs(`!!document.querySelector('[data-key="earlier.finished.yes"]:checked, [data-key="earlier.finished.no"]:checked')`)) throw new Error('no conferral line: “finished” stays for the student');
    if (!(await s.evalJs(`document.querySelector('[data-key="earlier.sameplace.no"]')?.checked === true && /your bachelor’s is from Notre Dame/.test(document.querySelector('[data-key="earlier.read.samePlace"]')?.textContent ?? '')`))) throw new Error('a Notre Dame bachelor’s and a master’s elsewhere: “same university?” is read as No');
    const extToast = await s.evalJs(`[...document.querySelectorAll('.toast')].map(t => t.textContent).join(' | ')`);
    if (!extToast.includes('Your earlier degrees were partly filled in from it')) throw new Error('the previous-transcript toast must say the earlier degrees were filled in: ' + extToast.slice(0, 300));
    await s.shot('earlier-degrees-read-graduate');
    console.log('  Option 1: a fresh Ph.D. record importing an insideND transcript gets “Notre Dame — CSE” chosen and marked as read; changing it drops the mark; a previous master’s transcript reads “Yes, at another university”');
  }
}

// The Master's-slot preview of a text-layer transcript at a given window width
// (DGS check 2026-09-06, Safari + Chrome). Rows are `tr.compact`; from a
// 560 px preview up (the recorded decision) every cell of a row sits on its
// first line, the credits / grade / term / level columns start at the same x
// in every row, and nothing reaches past the row or scrolls the preview
// sideways. The cropped screenshot is what to look at when a number is off.
async function checkCompactPreview(s, width) {
  await s.setViewport({ width, height: 1900, settleMs: 200 });
  const m = JSON.parse(
    await s.evalJs(`JSON.stringify((() => {
      const box = document.querySelector('.external-card .transcript-preview');
      const r = (e) => e.getBoundingClientRect();
      const rows = [...box.querySelectorAll('tr.compact')].map((tr) => {
        const cells = [...tr.querySelectorAll('td')].filter((td) => r(td).width > 0);
        return {
          id: tr.querySelector('.course-id')?.textContent ?? tr.querySelector('.cell-course input')?.value ?? '?',
          height: Math.round(r(tr).height),
          secondLine: cells.filter((td) => r(td).top - r(tr).top > 18).length,
          spill: Math.round(Math.max(0, ...cells.map((td) => r(td).right - r(tr).right), r(tr).right - r(box).right)),
          columns: [...tr.querySelectorAll('td.locked-cell, td.level-cell')].map((td) => Math.round(r(td).left)).join(','),
        };
      });
      const cs = getComputedStyle(box);
      // The one visible header, "Taken as", sits over the dropdown column (DGS 2026-09-07).
      const ths = [...box.querySelectorAll('tr:first-child th')].filter((th) => r(th).width > 2);
      const sel = box.querySelector('tr.compact select.row-level');
      const header = { labels: ths.map((th) => th.textContent), right: ths[0] ? Math.round(r(ths[0]).right) : null, left: ths[0] ? Math.round(r(ths[0]).left) : null, selectRight: sel ? Math.round(r(sel).right) : null, selectLeft: sel ? Math.round(r(sel).left) : null, above: !!(ths[0] && sel) && r(ths[0]).bottom <= r(sel).top };
      return { previewWidth: Math.round(box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)), sideways: box.scrollWidth - box.clientWidth, rows, header };
    })())`),
  );
  await s.shotElement(`combined-preview-${width}`, '.external-card .transcript-preview');
  const problems = [];
  if (m.rows.length === 0) problems.push('no compact rows');
  if (m.sideways > 0) problems.push(`the preview scrolls sideways by ${m.sideways} px`);
  for (const row of m.rows) {
    if (row.secondLine > 0) problems.push(`${row.id}: ${row.secondLine} cell(s) on a second line`);
    if (row.spill > 0) problems.push(`${row.id}: content reaches ${row.spill} px past its row/card`);
  }
  const columnSets = new Set(m.rows.map((row) => row.columns));
  if (columnSets.size > 1) problems.push(`columns start at different x across rows: ${[...columnSets].join(' | ')}`);
  const h = m.header;
  if (h.labels.join('|') !== 'Taken as') problems.push(`visible headers must be exactly "Taken as": ${JSON.stringify(h.labels)}`);
  if (h.right === null || Math.abs(h.right - h.selectRight) > 2 || Math.abs(h.left - h.selectLeft) > 2 || !h.above) problems.push(`the "Taken as" header must sit over the dropdown column: ${JSON.stringify(h)}`);
  console.log(`  compact preview at ${width} px: content box ${m.previewWidth} px, ${m.rows.length} rows of ${m.rows.map((row) => row.height).join('/')} px, columns at x=${m.rows[0]?.columns}; header ${JSON.stringify(m.header.labels)} at x=${m.header.left}–${m.header.right} over the dropdown at ${m.header.selectLeft}–${m.header.selectRight}`);
  if (problems.length) throw new Error(`compact preview at ${width} px (content box ${m.previewWidth} px): ${problems.join('; ')}`);
}

// The previous-transcript preview's drop-downs as each engine draws them
// (cross-browser review, 2026-10-10). The credit system and the bachelor's
// season are sentences' fields, not table cells: the 74 px cell cap cut
// "Semester hours — counted as printed" to "Semest", and on a 320 px phone
// even the uncapped label was cut (W-CL426 shortened the choices). Each must
// be as wide as its own longest choice — the engine's intrinsic size, arrow
// included — at 1400 and at 320 px. Safari ignores a drop-down's vertical
// padding, so the preview's drop-downs were about 21 px tall until they were
// given the boxes' height (the one-line rows keep their small "Taken as").
// The credit-system note says who chose the system (DGS 2026-10-10, item 3):
// a system the student picks by hand was still "read from how the transcript
// names its terms". The menu is changed and put back, so nothing else moves.
// This fixture is a semester transcript, so it drives one branch in the page;
// tests/credit-system-note.test.ts covers every reading × choice.
async function checkCreditNote(s) {
  const note = () => s.evalJs(`JSON.stringify((() => {
    const p = document.querySelector('.external-card .transcript-preview .quarter-note');
    const sel = p?.querySelector('[data-key="ext.preview.creditsystem"]');
    return p ? { value: sel.value, text: p.textContent.replace(/\\s+/g, ' ').trim() } : null;
  })())`).then(JSON.parse);
  const pick = async (value) => {
    await s.evalJs(`(() => { const sel = document.querySelector('.external-card .transcript-preview [data-key="ext.preview.creditsystem"]'); sel.value = ${JSON.stringify('VALUE')}; sel.dispatchEvent(new Event('change', { bubbles: true })); })()`.replace('VALUE', value));
    await s.settle(100);
    return note();
  };
  const start = await note();
  if (!start) throw new Error('expected the credit-system menu in the external preview');
  const read = /read from how the transcript names its terms/.test(start.text);
  const other = start.value === 'semester' ? 'quarter' : 'semester';
  const changed = await pick(other);
  const back = await pick(start.value);
  const want = read
    ? /chosen by you; the parser read (quarter|trimester) hours\. Its credits will be counted as printed/
    : /chosen by you; the parser found none on the transcript\. Its credits will be converted \(a 4-credit course counts 2\.64 Notre Dame credits/;
  if (/read from how/.test(changed.text) || !want.test(changed.text)) throw new Error('a credit system chosen by hand must say so: ' + JSON.stringify({ start, changed }));
  if (back.text !== start.text) throw new Error('putting the parser\'s reading back must restore its note: ' + JSON.stringify({ start, back }));
  console.log(`  credit-system note: "${changed.text.split(' — ')[1]?.slice(0, 70)}…" when chosen by hand; the parser's note back when undone`);
}

async function checkPreviewSelects(s) {
  const measure = () => s.evalJs(`JSON.stringify((() => {
    const preview = document.querySelector('.external-card .transcript-preview');
    const fits = (e) => {
      if (!e) return null;
      const w = e.getBoundingClientRect().width;
      const saved = ['width', 'min-width', 'max-width'].map((k) => [k, e.style.getPropertyValue(k), e.style.getPropertyPriority(k)]);
      e.style.setProperty('width', 'auto', 'important');
      e.style.setProperty('min-width', '0', 'important');
      e.style.setProperty('max-width', 'none', 'important');
      const natural = e.getBoundingClientRect().width;
      for (const [k, v, p] of saved) e.style.setProperty(k, v, p);
      return { w: Math.round(w * 10) / 10, natural: Math.round(natural * 10) / 10, label: e.selectedOptions[0]?.textContent ?? '' };
    };
    const year = preview.querySelector('[data-key="ext.preview.bachelors.year"]');
    const h = (e) => Math.round(e.getBoundingClientRect().height * 2) / 2;
    const tall = [...preview.querySelectorAll('select')].filter((e) => e.getClientRects().length > 0 && !e.closest('tr.compact')).map((e) => ({ k: e.dataset.key || e.className, h: h(e) }));
    return { credit: fits(preview.querySelector('[data-key="ext.preview.creditsystem"]')), season: fits(preview.querySelector('.bachelors-field select')), year: year ? h(year) : null, tall, pageScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  })())`).then(JSON.parse);
  const judge = (m, width) => {
    for (const [name, f] of [['credit-system', m.credit], ['bachelor\'s season', m.season]]) {
      if (!f) throw new Error(`the ${name} drop-down is missing from the preview at ${width} px`);
      if (f.w < f.natural - 0.5) throw new Error(`the ${name} drop-down cuts its choices at ${width} px: ${f.w} px wide, its longest choice needs ${f.natural} px ("${f.label}")`);
    }
    if (m.year === null) throw new Error('expected the bachelor\'s year box in the preview');
    const short = m.tall.filter((x) => Math.abs(x.h - m.year) > 1);
    if (m.tall.length < 2 || short.length > 0) throw new Error(`the preview's drop-downs must be as tall as its boxes (${m.year} px) at ${width} px: ` + JSON.stringify(m.tall));
    if (m.pageScroll > 0) throw new Error(`the page scrolls sideways at ${width} px with the preview open (${m.pageScroll} px)`);
  };
  const wide = await measure();
  judge(wide, 1400);
  const scrollY = await s.evalJs('window.scrollY');
  await s.setViewport({ width: 320, height: 700, mobile: true, settleMs: 250 });
  const phone = await measure();
  await s.setViewport({ width: 1400, height: 1900, settleMs: 250 });
  await s.evalJs(`window.scrollTo(0, ${scrollY})`); // as it was, for the shots that follow
  judge(phone, 320);
  console.log(`  preview drop-downs: the credit system "${wide.credit.label}" whole at 1400 px (${wide.credit.w}/${wide.credit.natural}) and 320 px (${phone.credit.w}/${phone.credit.natural}); the season whole; ${wide.tall.length} drop-down(s) as tall as the boxes (${wide.year} px, ${phone.year} px on the phone)`);
}

// 1b) A file pdf.js cannot read, on both import rows (cross-browser review,
//     2026-10-10): the plain "could not be read" messages — and, in a browser
//     too old to run the PDF reader at all (older than Safari 16.4, Chrome 94,
//     Firefox 93), W-CL425 instead, so a student is not sent to fetch another
//     PDF for nothing. That browser is stood in for by making the probe's
//     class-static-block compile throw a SyntaxError, as such an engine would.
async function checkUnreadablePdf(s) {
  const file = join(tmpdir(), 'cse-audit-e2e-not-a-pdf.pdf');
  writeFileSync(file, 'This is plain text, not a PDF.\n');
  const TOO_OLD = 'This browser is too old to read a PDF here. Update it (Safari 16.4, Chrome 94 or Firefox 93, or newer) and import again, or add your courses manually.';
  const rows = [
    { input: '.transcript-upload input[type=file]', error: '.transcript-upload .import-error', plain: 'That PDF could not be read (a scanned image, or not a PDF?). Add your courses manually.' },
    { input: '.external-file-phd', error: '[data-key="ext.error.phd"]', plain: 'That PDF could not be read (is it a PDF?). Only system-generated PDFs are accepted.' },
  ];
  const tryRow = async (row) => {
    await s.setFileInput(row.input, file);
    await s.waitFor(`document.querySelector('${row.error.replace(/'/g, "\\'")}')`);
    const text = await s.evalJs(`document.querySelector('${row.error.replace(/'/g, "\\'")}').textContent`);
    await s.evalJs(`document.querySelector('${row.error.replace(/'/g, "\\'")} button').click()`);
    await s.waitFor(`!document.querySelector('${row.error.replace(/'/g, "\\'")}')`);
    return text;
  };
  for (const row of rows) {
    const plain = await tryRow(row);
    if (!plain.includes(row.plain) || plain.includes('too old')) throw new Error(`an unreadable file must say "${row.plain}": ${plain.slice(0, 160)}`);
  }
  await s.evalJs(`(() => {
    window.__e2eFunction = window.Function;
    window.Function = new Proxy(window.__e2eFunction, { construct(target, args) { if (/static\\s*\\{/.test(String(args[args.length - 1]))) throw new SyntaxError('Unexpected token'); return Reflect.construct(target, args); } });
  })()`);
  try {
    for (const row of rows) {
      const old = await tryRow(row);
      if (!old.includes(TOO_OLD)) throw new Error('a browser too old for the PDF reader must be told so (W-CL425): ' + old.slice(0, 160));
    }
  } finally {
    await s.evalJs(`(() => { window.Function = window.__e2eFunction; delete window.__e2eFunction; })()`);
  }
  console.log('  unreadable file: "could not be read" on both rows; W-CL425 on both when the browser cannot run the PDF reader');
}

/** The reader-problem link's email body (item 18): its message is built when
 * it is clicked, so the click runs with the navigation prevented and the
 * address read back. */
async function readerProblemBody(s, key) {
  const href = await s.evalJs(`(() => {
    const a = document.querySelector('[data-key="${key}"]');
    if (!a) return '';
    const stop = (e) => e.preventDefault();
    window.addEventListener('click', stop, { capture: true, once: true });
    a.click();
    return a.getAttribute('href') ?? '';
  })()`);
  if (!href.startsWith('mailto:')) throw new Error(`the preview must offer "Did the reader get this transcript wrong?" (${key}): ` + href);
  return new URL(href).searchParams.get('body') ?? '';
}
