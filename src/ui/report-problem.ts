// "Does this look wrong?" (DGS 2026-10-11, item 18): two mailto links that
// let a student tell the DGS the page got something wrong, with what the DGS
// needs to reproduce it — and nothing from the student's record beyond that.
// A mailto link only opens the student's own email app with the message
// filled in; the page sends nothing (CLAUDE.md: no network call), and the
// student reads the message before sending it.
//
//   1. In each result card's Relevant Policies fold: the requirement (title,
//      section, id), what the page shows, and the "Checked with" line — the
//      rules fingerprint and the build, so `npm run reproduce` (with the saved
//      file, if the DGS asks for it) re-runs the very check.
//   2. In each transcript preview: the university as read, how the transcript
//      was read, how many rows were read, ticked, changed (which fields) and
//      typed, and the SHAPE of each changed row's reading — letters as A/a,
//      digits as 9 (the masking scripts/diagnose-transcript.mjs uses) — never a
//      course, grade or name in clear.
// Reports go to the student's decider — the DGS, the ADGS on the MSCSE tab,
// as everywhere on that tab (DGS 2026-09-11/-15) — and docs/ACCURACY-LOG.md
// records each one: date, requirement or import, cause, scenario added.
import type { RequirementResult } from '../engine/types.ts';
import { verdictOf } from '../engine/verdict.ts';
import { DGS, looksLikeEmail, type Contact } from './contacts.ts';
import { MAILTO_BODY_LIMIT } from './copy-dialog.ts';

/** Letters to A / a, digits to 9 — a line's shape without its content. */
export function maskShape(s: string): string {
  return s.replace(/\p{Lu}/gu, 'A').replace(/\p{Ll}/gu, 'a').replace(/\p{Nd}/gu, '9');
}

function href(to: Contact, subject: string, lines: readonly string[]): string | undefined {
  const address = to.email.trim();
  if (!looksLikeEmail(address)) return undefined;
  return `mailto:${encodeURIComponent(address)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.join('\n'))}`;
}

/** The result card's link. `pill` is the card's own status word. */
export function requirementProblemHref(r: RequirementResult, pill: string, checkedWith: string, to: Contact = DGS): string | undefined {
  return href(to, `Self-check: this looks wrong — ${r.title} (${r.citation.section})`, [
    'The degree self-check shows something that looks wrong to me.',
    '',
    `Requirement: ${r.title} (${r.citation.section}) — ${r.id}`,
    `The page shows: ${pill} (${verdictOf(r)})`,
    checkedWith,
    '',
    'What looks wrong, and what I expected instead:',
    '',
  ]);
}

/** What the transcript preview knows about a reading that went wrong. */
export interface TranscriptProblem {
  /** "Notre Dame transcript", "Previous Master's transcript" */
  which: string;
  university: string;
  /** "the PDF's text", "text recognition (OCR) of a scan", "the scanner's own text layer" */
  readBy: string;
  rowsRead: number;
  rowsTicked: number;
  rowsTyped: number;
  /** Each changed row: what the reader read, field by field, and what the student changed. */
  changed: { read: string[]; fields: string[] }[];
}

/** At most this many changed rows' shapes, so the link stays under the length
 * every email app takes whole (copy-dialog.ts MAILTO_BODY_LIMIT). */
export const PROBLEM_SHAPES_MAX = 8;

export function transcriptProblemHref(p: TranscriptProblem, checkedWith: string, to: Contact = DGS): string | undefined {
  const shapes = p.changed.slice(0, PROBLEM_SHAPES_MAX).map((c, i) => `  ${i + 1}. ${c.read.map(maskShape).join(' | ')} — I changed: ${c.fields.join(', ')}`);
  const lines = (n: number): string[] => [
    'The transcript reader got my transcript wrong.',
    '',
    `Transcript: ${p.which} — ${p.university ? p.university : 'no university read'}`,
    `Read from: ${p.readBy}`,
    `Rows read: ${p.rowsRead}; ticked to add: ${p.rowsTicked}; changed by me: ${p.changed.length}; typed by me: ${p.rowsTyped}`,
    ...(p.changed.length > 0 ? ['The rows I changed, as the reader read them (letters shown as A/a, digits as 9 — no grades or courses):', ...shapes.slice(0, n), ...(p.changed.length > n ? [`  … and ${p.changed.length - n} more`] : [])] : []),
    checkedWith,
    '',
    'What the reader got wrong (I can send a copy of the transcript with my name and ID removed if you ask):',
    '',
  ];
  // Fewer shapes until the link fits (the subject and address are short).
  let n = Math.min(PROBLEM_SHAPES_MAX, p.changed.length);
  while (n > 0 && encodeURIComponent(lines(n).join('\n')).length > MAILTO_BODY_LIMIT) n--;
  return href(to, `Self-check: the transcript reader got my transcript wrong — ${p.university || p.which}`, lines(n));
}
