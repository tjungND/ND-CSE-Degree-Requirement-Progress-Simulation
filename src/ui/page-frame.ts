// The page frame of the self-check (index.html): the masthead, the two notice
// strips, the saved-copy banner, the sheet-diagnostics box and the footer.
// Moved out of src/ui/app.ts on 2026-10-22 (blue-team review 2026-10-17, W11)
// with their bodies unchanged: none of them reads the mutable record or calls
// update/render/persist — each takes the values and prebuilt nodes it draws
// (the handoff's 2026-09-20 rule: passed per call, never captured). The tools
// row's six controls are built in app.ts, where their closures live, and
// arrive here as nodes.
import type { Rules, SheetIssue } from '../data/types.ts';
import { termLabel, termOfDate } from '../engine/term.ts';
import type { Program } from '../engine/types.ts';
import { LICENSE_URL, REPO_URL, mailto, reportToDgs } from './contacts.ts';
import { el } from './dom.ts';
import { isEmbedded, openFullPageLink } from './embed.ts';
import { BETA_SCOPE_NOTICE, RULES_ACCURACY_NOTICE, betaNotice, handbookLink, rulesDateLine } from './handbook.ts';
import { sheetSourceLine, sheetSourceNote } from './sheet-source.ts';
import { diagnosticsContent } from './sheet-warnings.ts';
import { siblingAnchorAttrs } from './sibling-links.ts';
import { type ResultStamp, checkedWithLine } from './stamp.ts';
import { themeToggle } from './theme.ts';

/** What the masthead draws: values, the contact card's host node, the
 * Simulation chip (null outside the mode) and the tools row's controls. */
export interface MastheadArgs {
  program: Program;
  rules: Rules;
  /** The real date at Notre Dame — the rules' date is a fact about the sheet, real even in simulation mode (D5). */
  realTodayIso: string;
  /** The Who-to-contact card's desk-width host (app.ts builds and fills it). */
  contactHost: HTMLElement;
  simulationChip: HTMLElement | null;
  /** Save to a file, Load a file, Print, the advisor summary, Simulate / Exit, Reset — in that order (app.ts mastheadTools). */
  tools: HTMLElement[];
}

// ---------- masthead ----------

export function masthead({ program, rules, realTodayIso, contactHost, simulationChip, tools }: MastheadArgs): HTMLElement {
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
              // The link opens the list on this student's degree view (blue-team review 2026-10-17, U29).
              el('a', siblingAnchorAttrs('course-rules', window.location.search, isEmbedded(), { view: program }), 'course rules page'),
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
      el('span', { class: 'program-name-wrap' }, el('span', { class: 'program-name' }, program === 'mscse' ? 'M.S. in CSE (Handbook §3)' : 'Ph.D. (Handbook §4)'), simulationChip),
      // The tools row — Save to a file, Load a file, Print, the advisor
      // summary, Simulate / Exit, Reset — built in app.ts (mastheadTools),
      // where the record and the simulation state live.
      el('div', {}, ...tools),
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
export function noticeStrip(program: Program): HTMLElement {
  const alphaDetails = el(
    'details',
    { class: 'notice-details', 'data-key': 'notice.details' },
    el('summary', {}, 'Details'),
    el(
      'p',
      { class: 'notice-full beta' },
      el('strong', {}, 'Alpha version under testing. '),
      betaNotice(program),
      ' ',
      // The link parenthetical folds into the bold sentence here (trim
      // review 2026-09-18, P-39); the constant keeps its period for the
      // footer and the copied summary, which render in their own order.
      el('strong', {}, RULES_ACCURACY_NOTICE.replace(/\.$/, '')),
      ' (see the ',
      el('a', siblingAnchorAttrs('course-rules', window.location.search, isEmbedded(), { view: program }), 'course rules page'), // the student's degree view (U29)
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
      el('p', { class: 'notice-line' }, el('strong', {}, 'Alpha — under testing. '), program === 'phd' ? 'Informational only, except the MSCSE along the way (§3.1); the DGS decides.' : 'Informational only; the DGS decides.'),
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

export function snapshotBanner(syncedAt: string): HTMLElement {
  const date = syncedAt.slice(0, 10);
  return el(
    'div',
    { class: 'banner' },
    `You chose to continue with the copy of the rules saved on ${date} because the live spreadsheet could not be loaded — recent DGS edits may be missing. Reload the page to try the live spreadsheet again.`,
  );
}

// ---------- diagnostics ----------

export function diagnosticsCard(issues: readonly SheetIssue[]): HTMLElement | null {
  // Students see this only when the sheet has ERRORS (usability review
  // 2026-09-05, item 19); warnings alone are the DGS's business and are
  // printed by `npm run sync-sheet` — except those marked `onPage` (DGS
  // 2026-10-12: a row listed twice), which the box shows on their own
  // (src/ui/sheet-warnings.ts).
  const content = diagnosticsContent(issues);
  if (!content) return null;
  const details = el('details', { class: 'card diagnostics', 'data-key': 'diagnostics' });
  // The sheet is the DGS's to fix on either tab: the heading keeps "DGS"
  // through the MSCSE tab's rewrite; the messages below, some of which name
  // the decider, do not (round 5, item 18; DGS 2026-10-14).
  details.append(el('summary', { 'data-keep-dgs': '' }, content.summary));
  for (const i of content.issues) {
    details.append(el('div', { class: `issue ${i.severity}` }, `[${i.severity}] ${i.message}`));
  }
  return details;
}

// ---------- footer ----------

/** The footer: `contactHost` is the contact card's narrow-width and embed
 * host node (app.ts builds and fills it), `stamp` the result stamp. */
export function footer({ program, stamp, contactHost }: { program: Program; stamp: ResultStamp; contactHost: HTMLElement }): HTMLElement {
  return el(
    'footer',
    { class: 'legal' },
    // The card's narrow-width and embed host (the desk host is in the
    // masthead) — first in the footer, not after the license (UI review,
    // 2026-10-08: on a phone the contacts were the last thing on the page).
    contactHost,
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
      program === 'mscse' ? 'It applies Section 3 of the ' : 'It applies Section 4 of the ',
      handbookLink(),
      // Who decides and who processes is on the Grad Admin card, in the
      // glossary and in the contact card right below; the footer keeps its
      // one imperative (trim review 2026-09-18, P-21).
      // Shortened 2026-10-07 (DGS: "see any texts can be shortened without
      // losing its meaning"): the same four points — the sources, what is
      // sent to the DGS, approximate deadlines, confirm before relying.
      ' and the Graduate School’s Academic Code, DGS Handbook and 4+1 guidance. What this page cannot see — sign-offs, recommendations, Graduate School approvals and extensions, and facts you state yourself — goes to the DGS rather than being decided here. Deadlines are by semester and approximate; the Graduate School calendar sets the exact dates. ',
      // The one exception on the Ph.D. tab (policy review round 4, P4-text-4;
      // DGS 2026-10-11: option (a), and no copy to the DGS on along-the-way
      // awards): the self-check IS §3.1's review of the MSCSE along the way
      // (DGS 2026-10-07, P3-cse-3-2), as the strip, the notice, the advisor
      // email and the processing request already say.
      program === 'phd'
        ? 'Confirm with the DGS before you rely on this self-check — except the MSCSE along the way, for which this self-check is the DGS’s own review (§3.1).'
        : 'Confirm with the DGS before you rely on this self-check.',
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

