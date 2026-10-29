// The ExternalCourses tab: courses from OTHER universities the DGS has already
// ruled on — whether each satisfies a §4.4.1 core-knowledge area and whether
// its credits can transfer under §5.2 (feature decisions, docs/DECISIONS.md
// 2026-09-01). Matching is deliberately forgiving about spelling: university
// names are compared case-, punctuation- and diacritic-insensitively, matched
// on the name exactly as transcripts print it (the aliases column was retired
// 2026-09-03), and course ids ignore spaces and hyphens — but a course
// with no matching row is NEVER guessed at; it stays "not yet reviewed".
import { exactCredits } from '../engine/credits.ts';
import { namesOtherNotreDame } from '../transcript/nd-markers.ts';
import type { ExternalRule, Transferable } from './types.ts';

/** Abbreviations transcripts use in an institution's name, spelled out (DGS
 * 2026-09-08: "Georgia Inst. of Technology" is how Georgia Tech's UNOFFICIAL
 * transcript prints it; students, the DGS and the Grad Admin should all read
 * the real name). Applied for display AND inside `normalizeUniversity`, so a
 * sheet row written either way still matches the transcript.
 *
 * Conservative on purpose. "Tech" is expanded only with its full stop —
 * "Georgia Tech" is a name in its own right and must not become "Georgia
 * Technology" — and "St." is left alone, since it is Saint in one name and
 * State in another. */
const ABBREVIATIONS: [RegExp, string][] = [
  [/\binst\.?(?=\s|$)/gi, 'Institute'],
  [/\buniv\.?(?=\s|$)/gi, 'University'],
  [/\bcoll\.?(?=\s|$)/gi, 'College'],
  [/\bpoly\.?(?=\s|$)/gi, 'Polytechnic'],
  [/\bintl\.?(?=\s|$)/gi, 'International'],
  [/\bnatl\.?(?=\s|$)/gi, 'National'],
  [/\bengr\.?(?=\s|$)/gi, 'Engineering'],
  [/\btech\.(?=\s|$)/gi, 'Technology'],
  [/\bsci\.(?=\s|$)/gi, 'Science'],
  [/\bagri\.(?=\s|$)/gi, 'Agricultural'],
];

/** An institution's name with those abbreviations spelled out. Everything else
 * is left exactly as given — this is not a spell-checker. */
export function expandInstitutionAbbreviations(name: string): string {
  return ABBREVIATIONS.reduce((out, [re, word]) => out.replace(re, word), name).replace(/\s{2,}/g, ' ').trim();
}

// Remembered per name (efficiency, 2026-10-07): one audit asks about the same
// few names hundreds of times (classify's duplicate check compares every pair
// of transfer rows), and each fold runs about twenty regular expressions. The
// fold depends on the name alone, so a remembered answer is the same answer —
// if it ever depends on anything else (a sheet parameter, a setting), remove
// this cache. Capped so names read from transcripts cannot grow it without limit.
const universityFolds = new Map<string, string>();

/** "Univ. of Notre-Dame " → "university of notre dame" (abbreviations spelled
 * out since 2026-09-08, then case, punctuation and
 * diacritics ignored; whitespace collapsed). Non-Latin letters are kept, but
 * the sheet convention (2026-09-03) is the university's name in CAPITAL
 * ENGLISH exactly as its transcripts print it.
 *
 * The sheet's university names are what the import read from official
 * transcripts and are never altered (DGS 2026-10-07). This folds the same way
 * on both sides — case, punctuation, spacing, spelled-out abbreviations, a
 * leading "The" — and must never drop a word from a name. The fold itself is
 * foldUniversity, below; this remembers its answers. */
export function normalizeUniversity(name: string): string {
  let folded = universityFolds.get(name);
  if (folded === undefined) {
    if (universityFolds.size >= 1000) universityFolds.clear();
    folded = foldUniversity(name);
    universityFolds.set(name, folded);
  }
  return folded;
}

/** The fold normalizeUniversity remembers — see its comment for the rules. */
function foldUniversity(name: string): string {
  return expandInstitutionAbbreviations(name)
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '') // strip the accents NFKD split off
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    // "The Johns Hopkins University" and "Johns Hopkins University" are one
    // school; a sheet row written either way must match (2026-09-08).
    .replace(/^the /, '');
}

/** The institution name given to Notre Dame coursework taken BEFORE the entry
 * term (2026-09-05) — an earlier Notre Dame degree on a combined transcript.
 * Such courses are prior coursework (§5.2: the transfer conditions "also apply
 * to the transfer of credits earned in another program at Notre Dame"), so
 * they carry origin 'transfer' with this institution, and the DGS's
 * ExternalCourses rulings for them live under this name (in the sheet's
 * capital-English convention: UNIVERSITY OF NOTRE DAME). */
export const NOTRE_DAME = 'University of Notre Dame';

/** The §5.2 ruling that applies to THIS student (DGS 2026-09-09: the sheet
 * decides transferability separately for a Ph.D. and an MSCSE student). Always
 * go through here — reading `transferablePhd` directly would apply a Ph.D.
 * ruling to an MSCSE student. */
export function transferableFor(rule: ExternalRule | undefined, program: 'phd' | 'mscse'): Transferable | undefined {
  return program === 'phd' ? rule?.transferablePhd : rule?.transferableMscse;
}

/** Does this ruling mean "somebody has to approve it"? `dgs_approval` and
 * `adgs_approval` are one case for now (DGS 2026-09-09), and both are told to
 * the student as "needs DGS approval". */
export function needsApproval(t: Transferable | undefined): boolean {
  return t === 'dgs_approval' || t === 'adgs_approval';
}

/** The subject code of a course id — "CompSci 537" → "COMPSCI": the letters
 * before the course number, upper-cased and stripped of punctuation, so
 * "CS-503" and "CS 503" answer the same (subjectCodes' first reading; the
 * CSE test reads them all).
 *
 * A code of three numbers joined by colons is school:subject:course —
 * Rutgers', "01:198:344" (its bachelor's record) and "16:198:507" (its
 * graduate school) — and its subject is the middle number, "198": the
 * `cse_subject_codes` list names such a subject by its number (DGS
 * 2026-10-16: "The '198' in the middle refers to Computer Science."). A code
 * of digits alone ("60610", "30240233") still has no subject. */
export function subjectCode(courseId: string): string {
  return subjectCodes(courseId)[0] ?? '';
}

/** Every reading of a course id's subject, the whole prefix first (credit-
 * transfer review 2026-10-28). Schools print a college prefix or a level
 * suffix around the department: Wisconsin "COMP SCI 787", UT Austin "C S 314",
 * Boston University "CAS CS 505" (college, then department), NYU
 * "CSCI-GA.1170" and Indiana "CSCI-P 556" (department, then a level or campus
 * letter), Johns Hopkins "EN.601.433" (school.department.course). Reading only
 * the first word made every one of them a course outside CSE, cut by the
 * nine. The candidates are the letters of everything before the course number
 * ("COMPSCI", "CS", "CASCS", "CSCIGA"), its first and its last part ("CAS",
 * "CS"; "CSCI", "GA"), and a department number between a school and a course
 * number ("601"; Rutgers' "198"). A course is a CSE course when any candidate
 * is on the `cse_subject_codes` list. A code of digits alone has none. */
export function subjectCodes(courseId: string): string[] {
  const numbered = /^\s*\d{1,2}\s*:\s*(\d{3})\s*:\s*\d{3}\s*$/.exec(courseId);
  if (numbered) return [numbered[1]!];
  const id = courseId.toUpperCase();
  // A leading scheme year or level before the letters is not the subject's
  // end: VTU "18CS53", KCL "7CCSMML" (review of the fix, 2026-10-29 — it read
  // as no subject).
  const body = id.replace(/^\s*\d+(?=\s*[A-Z])/, '');
  let prefix = /^[^0-9]*/.exec(body)![0];
  // One or two letters glued to the course number after a separate subject
  // word belong to the number: City College "CSC I0400" is subject CSC, not
  // CSCI (review of the fix, 2026-10-29). Written without a lookbehind, which
  // Safari before 16.4 cannot compile.
  const glued = /\s([A-Z]{1,2})$/.exec(prefix);
  if (glued && /[A-Z]/.test(prefix.slice(0, glued.index))) prefix = prefix.slice(0, glued.index + 1);
  const parts = prefix.split(/[^A-Z]+/).filter((p) => p !== '');
  const out = parts.length > 0 ? [parts.join(''), parts[0]!, parts[parts.length - 1]!] : [];
  const dotted = /^\s*[A-Z]{1,4}\.(\d{3})\.\d{3}/.exec(id);
  if (dotted) out.push(dotted[1]!);
  return [...new Set(out)];
}

/** Is a course from ANOTHER university a CSE course, for §4.2's nine-credit
 * allowance for courses "taken from a department other than CSE"? (DGS
 * 2026-09-09.)
 *
 *   1. the ExternalCourses row's `is_cse` cell, when the DGS has filled it —
 *      the ruling for one course the list should not decide (ECE is on the
 *      list on purpose since 2026-10-04: the department reads "a department
 *      other than CSE" as "outside computing"; P4-data-6);
 *   2. otherwise the Parameters tab's `cse_subject_codes` list;
 *   3. `undefined` when the sheet has no list at all (or a blank cell) — the
 *      course is then held for the DGS, who decides whether it is a CSE course
 *      (allocate.ts `cseUnknown`, since 2026-10-03; it used to leave the
 *      allowance off — policy review round 3, P3-sheet-6 (a)).
 *
 * A code the list does not name is OUTSIDE CSE, not "unknown": the list is
 * where the DGS says which codes mean CSE, so its silence is an answer. The
 * course's line says which of the two decided it, so a wrong answer is
 * visible and correctable rather than silent. */
export function isCseCourse(
  courseId: string,
  rule: ExternalRule | undefined,
  cseSubjectCodes: string[] | undefined,
): boolean | undefined {
  if (rule?.isCse !== undefined) return rule.isCse;
  if (cseSubjectCodes === undefined) return undefined;
  return subjectCodes(courseId).some((code) => cseSubjectCodes.includes(code));
}

/** True for any spelling of Notre Dame as an institution name.
 *
 * Goes through normalizeUniversity() — the same folding every OTHER
 * institution comparison in this file uses — so hyphens, full stops and the
 * abbreviations a transcript (or a student typing the name by hand) may carry
 * are gone before the comparison: "Notre-Dame" and "Univ. of Notre Dame" are
 * the same school as "University of Notre Dame". The old regex read `\s*`
 * between the two words, so every hyphenated spelling silently failed — which
 * zeroed a 4+1's credit, dropped their coursework out of the DGS review
 * request, and refused it as a §5.2 transfer it never was (red-team 2026-09-13).
 *
 * A bare "ND" is accepted only when it is the WHOLE name: a student typing
 * just those two letters into this app can only mean Notre Dame, while
 * "ND State University" is a different school and must not match. */
/** The ExternalCourses spelling of Notre Dame — the sheet's capital-English
 * convention (DECISIONS 2026-09-05) — for a course from an earlier Notre Dame
 * program in another department, whose §5.2 transfer decision is its row
 * there (policy review round 3, P3-dh-10-2). */
export const NOTRE_DAME_ROW_UNIVERSITY = 'UNIVERSITY OF NOTRE DAME';

export function isNotreDameInstitution(name: string | undefined): boolean {
  if (name === undefined || namesOtherNotreDame(name)) return false;
  const normalized = normalizeUniversity(name);
  return /\bnotre dame\b/.test(normalized) || normalized === 'nd';
}

/** "cs-5321" / "CS 5321" / "cs5321" → "CS5321". */
export function normalizeCourseId(id: string): string {
  return id.toUpperCase().replace(/[\s\-–—_./]+/g, '');
}

/** The ExternalCourses rows indexed by university key, then by normalized
 * course id — built once per rows array (a WeakMap keyed on the array itself,
 * so a fresh Rules object gets a fresh index) instead of scanning every row for
 * every course the engine classifies. First row wins on both levels, exactly
 * as the linear scans it replaces did. */
interface ExternalIndex {
  byUniversity: Map<string, { byCourse: Map<string, ExternalRule> }>;
}
const EXTERNAL_INDEX = new WeakMap<readonly ExternalRule[], ExternalIndex>();
function externalIndex(rules: readonly ExternalRule[]): ExternalIndex {
  let index = EXTERNAL_INDEX.get(rules);
  if (index) return index;
  index = { byUniversity: new Map() };
  for (const r of rules) {
    let uni = index.byUniversity.get(r.universityKey);
    if (!uni) {
      uni = { byCourse: new Map() };
      index.byUniversity.set(r.universityKey, uni);
    }
    const id = normalizeCourseId(r.courseId);
    if (!uni.byCourse.has(id)) uni.byCourse.set(id, r);
  }
  EXTERNAL_INDEX.set(rules, index);
  return index;
}

/** The DGS's ruling for one (university, course) pair, or undefined = the DGS
 * has not reviewed that course yet. First matching row wins (duplicates are
 * reported at parse time). */
export function findExternalRule(
  rules: readonly ExternalRule[],
  university: string,
  courseId: string,
): ExternalRule | undefined {
  const uni = normalizeUniversity(university);
  const id = normalizeCourseId(courseId);
  if (uni === '' || id === '') return undefined;
  return externalIndex(rules).byUniversity.get(uni)?.byCourse.get(id);
}

/** §5.2: "Credits not earned on the semester system, such as trimester and
 * quarter-hour credits, will be transferred on a pro-rata basis." The factors
 * are the Graduate School's — the DGS Handbook's §3.14 pro-rata table
 * (quarter credit hours × .66, trimester credit hours × .88) — so they live
 * here, in code, like its other numbers (DGS 2026-10-04: "move them into
 * code"; README § A5b). From 2026-09-12 until then they were the Parameters
 * rows `quarter_credit_factor` / `trimester_credit_factor`, which the sheet
 * check now reports as no longer read. */
export const QUARTER_CREDIT_FACTOR = 0.66;
export const TRIMESTER_CREDIT_FACTOR = 0.88;
export type CreditSystem = 'quarter' | 'semester' | 'trimester';
/** A non-semester system's factor; undefined for semester (credits as printed). */
export function creditSystemFactor(system: CreditSystem | undefined): number | undefined {
  return system === 'quarter' ? QUARTER_CREDIT_FACTOR : system === 'trimester' ? TRIMESTER_CREDIT_FACTOR : undefined;
}
/** How a factor is printed on a course line: two decimals ("0.67", "0.88"). */
export function creditSystemFactorLabel(factor: number): string {
  return factor.toFixed(2);
}

/** The credit system a university awards in, from the sheet's Universities
 * tab (DGS 2026-10-10; the old per-course ExternalCourses cells only when a
 * sheet has no such tab — `universityCreditSystems` in assemble.ts). It applies
 * to every course from that university, ruled on or not. Undefined when the
 * sheet does not say — credits then count as printed, and the course line says
 * the DGS converts them. */
export function universityCreditSystem(
  systems: ReadonlyMap<string, CreditSystem>,
  university: string | undefined,
): CreditSystem | undefined {
  if (university === undefined) return undefined;
  const key = normalizeUniversity(university);
  if (key === '') return undefined;
  return systems.get(key);
}

/** What one course counts for at Notre Dame: the DGS's fixed value for this
 * course when there is one, else the transcript's own credits converted from
 * the university's system, else undefined (count them as printed). */
export function ndEquivalentCredits(
  printed: number,
  rule: { ndCredits?: number } | undefined,
  system: CreditSystem | undefined,
  /** The sheet's factor for `system`; undefined = the key is missing, so no
   * conversion is possible (the caller says so rather than guessing). */
  factor: number | undefined,
): number | undefined {
  if (rule?.ndCredits !== undefined) return rule.ndCredits;
  if ((system === 'quarter' || system === 'trimester') && factor !== undefined) return exactCredits(printed * factor);
  return undefined;
}
