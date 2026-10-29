// How the generated emails say WHY a requirement stands as it does: the
// engine's detail re-voiced for a message the student sends (the advisor
// summary and the Grad Admin processing request), and the MSCSE time-limit
// clause both name beside the master's candidacy item.
//
// Moved verbatim out of advisor-summary.ts in the efficiency round
// (2026-10-26): the Grad Admin request is built on every render and needs
// only these, while the rest of the advisor summary — most of that file — is
// needed only when "Send summary to advisor" is clicked, so it now loads
// then. advisor-summary.ts imports these back and re-exports `whyFor` and
// `msLimitPassedClause`, so existing imports of them keep working.
import type { AuditReport, DetailPart, RequirementResult } from '../engine/types.ts';
import { deadlineTermLabel } from '../engine/term.ts';

/** The MSCSE's time limit when it has passed — Overdue, or every requirement
 * complete after it (“Eligibility at risk”) — named beside the master's
 * candidacy item in the advisor email and the processing request (policy
 * review round 4, P4-mscse-2; DGS 2026-10-11: option (b)). No document bars
 * filing the application while an extension is sought, so the item stays and
 * the Grad Admin sees the one fact they need beside it. Empty otherwise. */
export function msLimitPassedClause(report: AuditReport): string {
  if (report.program !== 'mscse') return '';
  const r = report.requirements.find((x) => x.id === 'ms.timeLimit');
  // Overdue means the card reads Overdue — not Cannot evaluate, whose chip
  // is overdue too (round 5, item 25; DGS 2026-10-14).
  if (!r?.deadline || !((r.status === 'unmet' && r.deadline.state === 'overdue') || r.statusLabel === 'Eligibility at risk')) return '';
  return ` — the MSCSE’s time limit (§3.3) passed at ${deadlineTermLabel(r.deadline.date)} (approximate); an extension is the Graduate School’s to grant`;
}

// ---------- re-voicing the engine's details ----------

/** The engine's detail, re-voiced for an email from the student to the
 * advisor: one "why" string of short sentences (each statement capitalized,
 * period-separated — the engine's own joining style); empty when nothing is
 * left to say (the deadline phrase then stands alone). `firstStatementOnly`
 * keeps just the leading statement; `factsOnly` leaves out every note — what
 * the card folds behind "Relevant Policies" (the Grad Admin request, DGS
 * 2026-10-28: "there are too many texts"). */
export function whyFor(r: RequirementResult, firstStatementOnly = false, factsOnly = false): string {
  // A page-only policy note stays on the card (2026-10-05).
  const parts = r.detailParts?.filter((p) => !(typeof p === 'object' && 'note' in p && (p.pageOnly || factsOnly)));
  const statements = (parts ? parts.map((p) => flatten(p, r)) : splitStatements(r.detail))
    .map((s) => withoutPageForm(s.trim()).replace(/\.$/, ''))
    .filter((s) => s.length > 0)
    .map(rewrite)
    .filter((s) => !dropsFromEmail(s, r))
    .map(firstPerson);
  const kept = firstStatementOnly ? statements.slice(0, 1) : statements;
  if (kept.length === 0) return '';
  return kept.map((s) => `${s.charAt(0).toUpperCase()}${s.slice(1)}.`).join(' ');
}

/** A detail part as one sentence. The §4.4.2 categories row lists "COURSE
 * title → Group" per course on the page; the advisor needs only which groups
 * are satisfied (DGS 2026-09-23: "Just need to say which categories are
 * satisfied. No bullet points needed."), so its items reduce to the distinct
 * group names. */
export function flatten(p: DetailPart, r?: RequirementResult): string {
  if (typeof p === 'string') return p;
  if ('warn' in p) return p.warn;
  // A note is explanation on the page (folded) and plain text in the messages.
  if ('note' in p) return p.note;
  // A condition's mark is the page's (2026-10-06); its words carry the state.
  if ('check' in p) return p.check;
  const items =
    r?.id === 'phd.qualifier.categories'
      ? [...new Set(p.items.filter((i) => !/ — (?:in progress|that group is already covered)/.test(i)).map((i) => i.replace(/^.*→\s*/, '').replace(/\s*\(flexible course[^)]*\)/, '').trim()))]
      : p.items;
  return `${p.lead}: ${items.join(r?.id === 'phd.qualifier.categories' ? ', ' : '; ')}`;
}

/** Split prose into statements at ". " before a capital or digit, sparing the
 * abbreviations the details use (M.S., Ph.D., e.g., i.e., vs., etc.). The
 * abbreviation test is written out rather than a lookbehind: Safari before
 * 16.4 cannot compile one, and this runs on every render of the audit page
 * (cross-browser review, 2026-10-10). */
export function splitStatements(detail: string): string[] {
  const out: string[] = [];
  const stop = /\.\s+(?=[A-Z0-9(“"])/g;
  let start = 0;
  for (let m = stop.exec(detail); m !== null; m = stop.exec(detail)) {
    if (ABBREVIATION_BEFORE.test(detail.slice(0, m.index))) {
      stop.lastIndex = m.index + 1;
      continue;
    }
    out.push(detail.slice(start, m.index));
    start = m.index + m[0].length;
  }
  out.push(detail.slice(start));
  return out;
}
const ABBREVIATION_BEFORE = /\b(?:M\.S|Ph\.D|e\.g|i\.e|vs|etc|No)$/;

/** The page's own form inside a statement — "…; enter the date under
 * Milestones once it is approved", "Enter your advisor under Milestones. A
 * student who …" — is no news to an email's reader (policy review round 3,
 * P3-emails-4): the instruction is cut and the fact kept. A statement that is
 * nothing but such an instruction is dropped by dropsFromEmail. */
function withoutPageForm(statement: string): string {
  return (
    statement
      // A leading sentence that is only the instruction.
      .replace(/^(?:Enter|Answer)\b[^.]*\bunder Milestones\b[^.]*\.\s+(?=[A-Z])/, '')
      // A trailing clause.
      .replace(/[;,]\s*(?:then\s+|and\s+)?(?:enter|answer)\b[^;]*\bunder Milestones\b[^;]*$/i, '')
  );
}

/** Statements written for the student at the page that say nothing to the
 * advisor: how to record an approval, where a list lives on the site, what
 * to do next ("Talk to the DGS"), and an "Overdue —" statement whose fact
 * the deadline phrase already carries. */
function dropsFromEmail(statement: string, r: RequirementResult): boolean {
  if (/\bcheckbox(es)?\b|\battestation\b|\btick\b|course rules page|self-check page/i.test(statement)) return true;
  // A seminar already taken ("CSE 63801: done (Fall 2025)") is nothing the
  // advisor needs (DGS 2026-09-23); the ones still open stay.
  if (/^[A-Z]{2,5} \d{5}: done\b/.test(statement)) return true;
  if (/^(Talk to|Ask the DGS|Ask your advisor)\b/i.test(statement)) return true;
  // "Enter the date … under Milestones" is the page's own form (2026-10-04);
  // so is any statement still naming it once withoutPageForm has cut the
  // instruction from a fact (policy review round 3, P3-emails-4).
  if (/\bunder Milestones\b/i.test(statement)) return true;
  if (/^Overdue\b/i.test(statement) && r.deadline?.state === 'overdue') return true;
  return false;
}

/** Page instructions that carry a fact worth telling the advisor, restated
 * as the fact. Add a rule here when an engine detail gains a new "do this on
 * the page" sentence (they are listed in docs/CLAUDE-HANDOFF.md). */
const REWRITES: [RegExp, string][] = [
  // "tick the box" since the trim review (P-55, 2026-09-18); "attestation" kept
  // so an older fixture still re-voices.
  [/^Confirm your advisor approved your coursework \(([^)]*)\) and tick the (attestation|box).*$/i, 'Advisor approval of my coursework ($1) is not yet recorded'],
  [/^Enter your (?:graduate-level )?cumulative GPA\b.*$/i, 'Cumulative GPA not entered yet'],
  // The §4.4.2 retake advice is written for the student; the advisor needs the
  // course, the grade and the §, and the to-do list already says "Retake or
  // replace …" (trim review 2026-09-18, P-22).
  [/^(.+?) (?:is|are) below the ([A-Z][+-]?) floor — retake (?:it|them) or take another course \((§[\d.]+)\)$/i, 'below the $2 floor ($3): $1'],
  // "one card per core area below" is the page describing its own layout; the
  // email has no cards (trim review 2026-09-18, P-40).
  [/ — one card per core area below\)/, ')'],
];
function rewrite(statement: string): string {
  for (const [re, to] of REWRITES) if (re.test(statement)) return statement.replace(re, to);
  return statement;
}

/** The student is writing: "you are registered" → "I am registered"; "by your
 * first semester" → "by my first semester". */
export function firstPerson(statement: string): string {
  // "you were" is "I was", and "you and your advisor" is "my advisor and I"
  // (round 5, item 27; DGS 2026-10-14: "I were" in 16 scenarios' emails).
  return statement
    .replace(/\b[Yy]ou and your advisor\b/g, 'my advisor and I')
    .replace(/\byourself\b/g, 'myself')
    .replace(/\bYourself\b/g, 'Myself')
    .replace(/\b[Yy]ou were\b/g, 'I was')
    // "you" after a preposition is the object: "approved by the DGS for you",
    // "applies to you", "set it for you" → "me".
    .replace(/\b(for|to|with|by|of|from|on|about) you\b/g, '$1 me')
    .replace(/\b[Yy]ou are\b/g, 'I am')
    .replace(/\b[Yy]ou\b/g, 'I')
    .replace(/\bYour\b/g, 'My')
    .replace(/\byour\b/g, 'my')
    .replace(/\b[Yy]ours\b/g, 'mine');
}
