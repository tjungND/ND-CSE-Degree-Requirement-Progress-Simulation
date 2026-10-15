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
//      typed, and the SHAPE of each changed row's reading — letters of every
//      script as A/a, digits as 9, anything else outside plain ASCII as ¤ or ?
//      (the masking scripts/diagnose-transcript.mjs uses, 2026-10-15) — never
//      a course, grade or name in clear.
// Reports go to the student's decider — the DGS, the ADGS on the MSCSE tab,
// as everywhere on that tab (DGS 2026-09-11/-15) — and docs/ACCURACY-LOG.md
// records each one: date, requirement or import, cause, scenario added.
import type { RequirementResult } from '../engine/types.ts';
import { verdictOf } from '../engine/verdict.ts';
import { DGS, looksLikeEmail, type Contact } from './contacts.ts';
import { MAILTO_BODY_LIMIT } from './copy-dialog.ts';

/** A line's shape without its content: letters to A / a, digits to 9.
 *
 * The same mask as scripts/diagnose-transcript.mjs (2026-10-15). Until then
 * only cased letters and decimal digits were masked, so a name in a script
 * without case — Chinese, Korean, Arabic, Hebrew, Thai, Devanagari — went
 * into the email in clear, as did a private-use glyph a symbol font spells a
 * name with, an enclosed letter (Ⓙ) and a digit like ① or Ⅻ. Now, in order:
 *   - every letter of every script → A if capital, else a (a letter without
 *     case is a) — in ONE pass: a second pass for "any other letter" would
 *     also match the first pass's A and turn every capital into a;
 *   - every digit or number sign of every script (Arabic-Indic ٣, full-width
 *     ３, ①, Ⅻ) → 9;
 *   - an invisible control or format character (a tab, a zero-width space, a
 *     direction mark) → ¤, so the DGS sees that one is there;
 *   - anything else outside printable ASCII (an accent printed apart from its
 *     letter, a private-use glyph, Ⓙ, a non-ASCII space, dash or quote) → ?.
 * Printable ASCII other than letters and digits — spaces, + - . / ( ) and a
 * typed ? — is kept, so a plain-ASCII row's shape reads as it always has. */
export function maskShape(s: string): string {
  return s
    .replace(/\p{L}/gu, (ch) => (/\p{Lu}/u.test(ch) ? 'A' : 'a'))
    .replace(/\p{N}/gu, '9')
    .replace(/[\p{Cc}\p{Cf}]/gu, '¤')
    .replace(/[^\x20-\x7E¤]/gu, '?');
}

/** Whether maskShape shows a character of `s` as ? (`SPECIAL_RE`) or ¤
 * (`INVISIBLE_RE`) — so the email says what those marks mean only when one is
 * in it, and a plain-ASCII report reads word for word as before. */
const SPECIAL_RE = /[^\x20-\x7E\p{L}\p{N}\p{Cc}\p{Cf}¤]/u;
const INVISIBLE_RE = /[\p{Cc}\p{Cf}]/u;

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

/** What the shapes' marks stand for: A/a and 9 always; ? and ¤ only when a
 * row shown has one (2026-10-15, W-CL506). */
function shapeLegend(reads: readonly string[]): string {
  const marks = ['letters shown as A/a', 'digits as 9'];
  if (reads.some((s) => SPECIAL_RE.test(s))) marks.push('special characters as ?');
  if (reads.some((s) => INVISIBLE_RE.test(s))) marks.push('invisible characters as ¤');
  return `(${marks.join(', ')} — no grades or courses)`;
}

export function transcriptProblemHref(p: TranscriptProblem, checkedWith: string, to: Contact = DGS): string | undefined {
  const shapes = p.changed.slice(0, PROBLEM_SHAPES_MAX).map((c, i) => `  ${i + 1}. ${c.read.map(maskShape).join(' | ')} — I changed: ${c.fields.join(', ')}`);
  const lines = (n: number): string[] => [
    'The transcript reader got my transcript wrong.',
    '',
    `Transcript: ${p.which} — ${p.university ? p.university : 'no university read'}`,
    `Read from: ${p.readBy}`,
    `Rows read: ${p.rowsRead}; ticked to add: ${p.rowsTicked}; changed by me: ${p.changed.length}; typed by me: ${p.rowsTyped}`,
    ...(p.changed.length > 0 ? [`The rows I changed, as the reader read them ${shapeLegend(p.changed.slice(0, n).flatMap((c) => c.read))}:`, ...shapes.slice(0, n), ...(p.changed.length > n ? [`  … and ${p.changed.length - n} more`] : [])] : []),
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
