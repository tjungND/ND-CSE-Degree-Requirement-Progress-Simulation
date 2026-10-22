// Student state: localStorage autosave plus explicit save-to-file / load-file
// (DGS-requested, 2026-08-31) so a student can move between devices/browsers.
// Nothing ever leaves the browser (CLAUDE.md).
import type { SavedStamp } from './stamp.ts';
import { formatDateLong } from '../data/rules-date.ts';
import { COURSE_CREDITS_RANGE, GPA_RANGE, inRange, rangeRefusal } from '../engine/ranges.ts';
import { IMPORTED_FIELDS, type CourseEntry, type Season, type Student, type Term } from '../engine/types.ts';
import { plural } from './email-html.ts';
import { asksAlsoElsewhere, refileEarlyStartCourses, settleAnsweredPriorMs } from './prior-nd.ts';

const LS_KEY = 'cse-degree-audit/v1/student';

/** The name of the file "Save to a file" writes (exportFile below):
 * cse-degree-audit-phd-2026-10-21.json — the day the check was made
 * (`auditDate`, YYYY-MM-DD, the one the stamp carries) in the name, so a
 * student who saves once a semester can tell the copies apart without
 * opening them (blue-team review 2026-10-17, U24; every save was the same
 * name before). Loading accepts any name — it reads `student` alone — and
 * the simulation's file names its semester instead (DGS 2026-10-09). */
export function selfCheckFileName(program: Student['program'], auditDate: string): string {
  return `cse-degree-audit-${program}-${auditDate}.json`;
}

export function emptyStudent(): Student {
  return {
    schemaVersion: 1,
    program: 'phd',
    entryTerm: { season: 'fall', year: new Date().getFullYear() },
    // A guess until the student sets it or a transcript import reads it
    // (2026-09-05) — the standing card says so while the flag is set.
    entryTermInferred: { how: 'assumed' },
    priorMs: 'none',
    courses: [],
    milestones: {},
    attestations: {},
  };
}

/** The three semesters, in the order every season dropdown lists them. */
export const SEASONS: readonly Season[] = ['fall', 'spring', 'summer'];

function validTerm(t: unknown): t is Student['entryTerm'] {
  const term = t as Record<string, unknown> | undefined;
  return !!term && typeof term['year'] === 'number' && SEASONS.includes(term['season'] as never);
}

/** A list of terms, each well-formed (2026-10-03: approved credit overloads);
 * undefined when nothing usable is left. */
function validTermList(v: unknown): Term[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((t) => validTerm(t)).map((t) => ({ season: (t as Term).season, year: (t as Term).year }));
  return out.length > 0 ? out : undefined;
}

/** The entryTermInferred flag of a saved file, when well-formed; otherwise
 * undefined — a file that carries no flag was saved by a student who set (or
 * accepted) the term, so it must NOT inherit emptyStudent()'s "assumed". */
function validInferred(v: unknown): Student['entryTermInferred'] {
  const f = v as Record<string, unknown> | undefined;
  if (!f || typeof f !== 'object' || typeof f['how'] !== 'string') return undefined;
  const alt = f['alternative'] as Record<string, unknown> | undefined;
  if (alt && typeof alt === 'object' && validTerm(alt['term']) && typeof alt['why'] === 'string') {
    return { how: f['how'], alternative: { term: alt['term'], why: alt['why'] } };
  }
  return { how: f['how'] };
}

/** "Bachelor's degree awarded" (2026-09-06): a term when well-formed, else
 * unknown; its inferred-from-a-transcript flag never survives without it. */
function validBachelors(v: unknown): Student['entryTerm'] | undefined {
  return validTerm(v) ? { season: v.season, year: v.year } : undefined;
}
function validBachelorsInferred(v: unknown, term: Student['entryTerm'] | undefined): Student['bachelorsAwardedInferred'] {
  const f = v as Record<string, unknown> | undefined;
  if (!(term && f && typeof f === 'object' && typeof f['how'] === 'string')) return undefined;
  const before = validTerm(f['before']) ? { season: (f['before'] as Term).season, year: (f['before'] as Term).year } : undefined;
  return { how: f['how'], ...(before ? { before } : {}) };
}

/** An earlier Notre Dame master's degree (2026-09-09). Presence is the fact
 * ("this student already holds the MSCSE"); the term is optional, since a
 * student may tick the box without one. A malformed term is dropped rather
 * than throwing — the fact still stands. */
/** The earlier-degrees answer (2026-09-22): both questions well-formed, else unanswered. */
function validBackground(v: unknown): Student['background'] {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  const bachelors = o['bachelors'];
  const graduate = o['graduate'];
  if (bachelors !== 'nd-cse' && bachelors !== 'nd-other' && bachelors !== 'elsewhere') return undefined;
  if (graduate !== 'none' && graduate !== 'nd-mscse' && graduate !== 'nd-4plus1' && graduate !== 'nd-mscse-transfer' && graduate !== 'nd-other' && graduate !== 'elsewhere') return undefined;
  return {
    bachelors,
    ...(bachelors === 'nd-cse' && typeof o['ndIntegrated'] === 'boolean' ? { ndIntegrated: o['ndIntegrated'] as boolean } : {}),
    // The 4+1 admission term (2026-10-04): kept only beside a "yes".
    ...(bachelors === 'nd-cse' && o['ndIntegrated'] === true && validTerm(o['integratedAdmittedTerm'])
      ? { integratedAdmittedTerm: { season: (o['integratedAdmittedTerm'] as Term).season, year: (o['integratedAdmittedTerm'] as Term).year } }
      : {}),
    graduate,
    ...(graduate === 'elsewhere' ? { samePlace: o['samePlace'] === true, finished: o['finished'] === true } : {}),
    // A degree at Notre Dame in another department asks "finished?" since
    // 2026-10-03; a file from before then has no answer, and the dialog asks.
    ...(graduate === 'nd-other' && typeof o['finished'] === 'boolean' ? { finished: o['finished'] as boolean } : {}),
    // The transfer term (2026-09-28): kept when well-formed, dropped otherwise — the answer stands without it.
    ...(graduate === 'nd-mscse-transfer' && validTerm(o['transferredTerm']) ? { transferredTerm: { season: (o['transferredTerm'] as Term).season, year: (o['transferredTerm'] as Term).year } } : {}),
    // A degree elsewhere beside the Notre Dame MSCSE (2026-10-07,
    // P3-prior-programs-2 and -1). A file from before then has no answer: it
    // reads as before (no earlier program elsewhere), and the Change dialog asks.
    ...(asksAlsoElsewhere(graduate) && typeof o['alsoElsewhere'] === 'boolean' ? { alsoElsewhere: o['alsoElsewhere'] as boolean } : {}),
    ...(asksAlsoElsewhere(graduate) && o['alsoElsewhere'] === true && typeof o['finished'] === 'boolean' ? { finished: o['finished'] as boolean } : {}),
  };
}
/** The incomplete earlier-degrees answer (2026-10-08, Option 1): each known
 * field kept when well-formed, the rest dropped. */
function validBackgroundDraft(v: unknown): Student['backgroundDraft'] {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  const out: NonNullable<Student['backgroundDraft']> = {};
  if (o['bachelors'] === 'nd-cse' || o['bachelors'] === 'nd-other' || o['bachelors'] === 'elsewhere') out.bachelors = o['bachelors'];
  if (['none', 'nd-mscse', 'nd-4plus1', 'nd-mscse-transfer', 'nd-other', 'elsewhere'].includes(o['graduate'] as string)) out.graduate = o['graduate'] as NonNullable<Student['backgroundDraft']>['graduate'];
  for (const k of ['ndIntegrated', 'samePlace', 'finished', 'alsoElsewhere'] as const) if (typeof o[k] === 'boolean') out[k] = o[k] as boolean;
  for (const k of ['integratedAdmittedTerm', 'transferredTerm'] as const) if (validTerm(o[k])) out[k] = { season: (o[k] as Term).season, year: (o[k] as Term).year };
  return Object.keys(out).length > 0 ? out : undefined;
}
/** Where each read part came from (2026-10-08): strings only, for known keys. */
function validBackgroundRead(v: unknown): Student['backgroundRead'] {
  if (!v || typeof v !== 'object') return undefined;
  const out: NonNullable<Student['backgroundRead']> = {};
  for (const k of ['bachelors', 'ndIntegrated', 'integratedAdmittedTerm', 'graduate', 'samePlace', 'finished', 'transferredTerm', 'alsoElsewhere'] as const) {
    const s = (v as Record<string, unknown>)[k];
    if (typeof s === 'string' && s.length <= 300) out[k] = s;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
function validBackgroundReadFrom(v: unknown): Student['backgroundReadFrom'] {
  if (!v || typeof v !== 'object') return undefined;
  const out: NonNullable<Student['backgroundReadFrom']> = {};
  for (const k of ['bachelors', 'ndIntegrated', 'integratedAdmittedTerm', 'graduate', 'samePlace', 'finished', 'transferredTerm', 'alsoElsewhere'] as const) {
    const s = (v as Record<string, unknown>)[k];
    if (s === 'nd' || s === 'bachelors' || s === 'masters' || s === 'phd') out[k] = s;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
function validNdMasters(v: unknown): Student['ndMasters'] {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  const term = validTerm(o['term']) ? { season: (o['term'] as Student['entryTerm']).season, year: (o['term'] as Student['entryTerm']).year } : undefined;
  const inf = o['inferred'] as Record<string, unknown> | undefined;
  return {
    ...(term ? { term } : {}),
    ...(inf && typeof inf === 'object' && typeof inf['how'] === 'string' ? { inferred: { how: inf['how'] } } : {}),
  };
}

/** The Notre Dame transcript's dated degree conferrals (2026-09-10). Malformed
 * entries are dropped, not thrown on: they are a convenience for re-reading
 * ndMasters, never the student's own answer. */
function validNdDegrees(v: unknown): Student['ndDegrees'] {
  if (!Array.isArray(v)) return undefined;
  const out = v.flatMap((raw) => {
    const d = raw as Record<string, unknown> | undefined;
    const level = d?.['level'];
    const date = d?.['date'];
    return d && typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && (level === 'bachelors' || level === 'masters' || level === 'phd')
      ? [{ level: level as 'bachelors' | 'masters' | 'phd', date }]
      : [];
  });
  return out.length > 0 ? out : undefined;
}

/** A value a saved record carried that the app will not keep: the field it
 * belongs to (its `data-key` in the form), the text as it stood, and the
 * sentence the student is shown. */
export type Refusal = { key: string; text: string; message: string };

/** Structural check for imported files — plain-English error on mismatch.
 *
 * `refusals` collects the values this file carried that the app will not keep
 * but that are not worth refusing the whole record over (interface review R1,
 * 2026-09-18): the caller shows each sentence to the student and puts the
 * value back in its own field to be corrected. A file is the student's own
 * work, so one impossible number drops out of it rather than taking the other
 * ninety with it — and `loadLocal()` reads the same code, where throwing would
 * silently discard everything already on the device. */
/** Files from before 2026-09-27 recorded the DGS's approvals as three
 * record-level boxes. Each ticked box is mapped onto every course it covered
 * (the engine honours the mark only on a course the sheet decides case by
 * case, so nothing counts that did not before) and the box is cleared. */
function migrateApprovalBoxes(d: { courses: Record<string, unknown>[]; attestations?: Record<string, unknown> }): void {
  const old = d.attestations;
  if (!old) return;
  const fourk = old['dgsApproved4xxxx'] === true;
  const noncse = old['dgsApprovedNonCse'] === true;
  const transfer = old['transferApproved'] === true;
  if (!fourk && !noncse && !transfer) return;
  for (const c of d.courses) {
    const id = String(c['courseId'] ?? '');
    const level = Number(/\b(\d)\d{4}\b/.exec(id)?.[1]);
    const cse = /^CSE\b/.test(id);
    const fromNd = c['origin'] === 'nd' || /notre dame/i.test(String(c['institution'] ?? ''));
    const graduateTransfer = c['origin'] === 'transfer' && c['degreeLevel'] !== 'bachelors';
    if ((fourk && fromNd && cse && (level === 4 || level === 5)) || (noncse && !cse) || (transfer && graduateTransfer)) c['dgsApproved'] = true;
  }
  delete old['dgsApproved4xxxx'];
  delete old['dgsApprovedNonCse'];
  delete old['transferApproved'];
}

/** The §4.4 extension became a NUMBER of semesters on 2026-10-03 (DGS: "DGS may
 * give any number of semesters as extensions"); a ticked box from before
 * reads as one semester. */
function migrateExtensionBox(attestations: Record<string, unknown> | undefined): void {
  if (!attestations) return;
  if (attestations['qualifierExtensionGranted'] === true && typeof attestations['qualifierExtensionSemesters'] !== 'number') {
    attestations['qualifierExtensionSemesters'] = 1;
  }
  delete attestations['qualifierExtensionGranted'];
  const n = attestations['qualifierExtensionSemesters'];
  if (n !== undefined && !(typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 20)) delete attestations['qualifierExtensionSemesters'];
  if (attestations['transferRecorded'] !== undefined && typeof attestations['transferRecorded'] !== 'boolean') delete attestations['transferRecorded'];
  if (attestations['dualPlanApproved'] !== undefined && typeof attestations['dualPlanApproved'] !== 'boolean') delete attestations['dualPlanApproved'];
  for (const k of ['examsBeforeInterruptionStand', 'oceConfirmedByDgs', 'wantsMsAlongTheWay']) if (attestations[k] !== undefined && typeof attestations[k] !== 'boolean') delete attestations[k];
}

/** One term per leave or accommodation, by position (P3-ac-5a-1, 2026-10-05):
 * a malformed slot becomes "not given yet" (null), and slots beyond the count
 * are dropped. */
function validTermSlots(raw: unknown, count: number | undefined): (Term | null)[] | undefined {
  if (!Array.isArray(raw) || count === undefined || count === 0) return undefined;
  const out = raw.slice(0, count).map((t) => (validTerm(t) ? { season: (t as Term).season, year: (t as Term).year } : null));
  return out.some((t) => t !== null) ? out : undefined;
}

/** A small whole number of semesters (leaves, accommodations), or undefined. */
function validSemesterCount(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 20 ? v : undefined;
}

/** The milestone dates a saved file may carry, with the name its toast gives
 * each (the Milestones card's labels, shortened). */
const MILESTONE_DATE_LABELS: Record<string, string> = {
  advisorIdentified: 'Advisor identified',
  researchQualifierPassed: 'Research qualifier passed',
  researchQualifierFailed: 'Research qualifier failed',
  qualifierFormFiled: 'Qualifier completion form filed',
  candidacyPassed: 'Oral Candidacy Exam (OCE) passed',
  candidacyAdmitted: 'Admitted to doctoral candidacy',
  rcrTrainingCompleted: 'Responsible Conduct of Research training completed',
  defensePassed: 'Dissertation defense passed',
  dissertationSubmitted: 'Final dissertation submitted',
  thesisTopicApproved: 'Thesis topic approved',
  thesisDefensePassed: 'Thesis defense passed',
  thesisDefenseFailed: 'Thesis defense failed',
  thesisSubmitted: 'Final thesis submitted',
  projectReportAccepted: 'Project report accepted',
  msCandidacyApplied: 'Master’s candidacy application submitted',
};

/** The attestations as loaded, with the Graduate School extension's term
 * (2026-10-04) kept only when well-formed. */
function validAttestationTerms(a: Student['attestations'] | undefined): Student['attestations'] {
  const out: Student['attestations'] = { ...(a ?? {}) };
  const t = (out as Record<string, unknown>)['timeLimitExtendedThrough'];
  if (t !== undefined) {
    if (validTerm(t)) out.timeLimitExtendedThrough = { season: t.season, year: t.year };
    else delete out.timeLimitExtendedThrough;
  }
  return out;
}

/** The per-term GPA figures an import stored (2026-10-04). */
function validTermGpas(raw: unknown): Student['termGpas'] {
  if (!Array.isArray(raw)) return undefined;
  const out = raw.flatMap((t) => {
    if (!t || typeof t !== 'object') return [];
    const r = t as Record<string, unknown>;
    if (!validTerm(r['term'])) return [];
    const term = { season: (r['term'] as Term).season, year: (r['term'] as Term).year };
    const termGpa = inRange(r['termGpa'], GPA_RANGE) ? (r['termGpa'] as number) : undefined;
    const cumulativeGpa = inRange(r['cumulativeGpa'], GPA_RANGE) ? (r['cumulativeGpa'] as number) : undefined;
    if (termGpa === undefined && cumulativeGpa === undefined) return [];
    return [{ term, ...(termGpa !== undefined ? { termGpa } : {}), ...(cumulativeGpa !== undefined ? { cumulativeGpa } : {}) }];
  });
  return out.length > 0 ? out : undefined;
}

/** A real calendar date written YYYY-MM-DD — what a date box stores. */
function isIsoDate(v: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

/** Milestone dates are checked on load like every other figure (review of the
 * candidacy split, 2026-10-04): a hand-edited "2028-13-45" read Met with a
 * blank date box, and an empty string printed "Admitted to doctoral candidacy
 * ." with its field hidden. An empty value is "not entered" and is dropped
 * silently; anything else that is not a real YYYY-MM-DD date is dropped and
 * reported. The advisor names, and any key this version does not know, pass
 * through. */
function validMilestones(raw: unknown, refusals: Refusal[]): Student['milestones'] {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
  // The readers'-approval dates, removed on 2026-10-04 (DGS: the committee
  // approves the dissertation and passes the defense at the same time; "Apply
  // the same to MSCSE thesis"): a file that still carries one loads without
  // it, silently — the defense date stands for both.
  delete out['dissertationApprovedForDefense'];
  delete out['thesisApprovedByReaders'];
  // The faculty-status answers — the advisor's and the thesis readers'
  // (2026-10-04): one of three words or nothing.
  for (const k of ['advisorTtt', 'advisorTtt2', 'thesisReadersTtt']) if (out[k] !== undefined && !['yes', 'no', 'unsure'].includes(out[k] as string)) delete out[k];
  for (const [key, label] of Object.entries(MILESTONE_DATE_LABELS)) {
    const v = out[key];
    if (v === undefined) continue;
    if (typeof v === 'string' && isIsoDate(v)) continue;
    delete out[key];
    if (v === null || v === '') continue;
    refusals.push({ key: `milestone.${key}`, text: String(v), message: `${label}: “${String(v)}” in the file is not a date (YYYY-MM-DD), so it was not loaded — enter it again under Milestones.` });
  }
  return out as Student['milestones'];
}

/** What opening a record took out of it, for the page to say once. */
export interface LoadCleanup {
  /** Rows "Load example" put there (2026-10-17: the example is gone). */
  exampleRowsRemoved?: number;
}

/** The example student "Load example" put on a record, and what is left of
 * it after the button was removed (DGS 2026-10-17: "remove 'Load example'
 * button and the function"; asked what becomes of a record that still holds
 * the example's rows: "Remove automatically"). The rows it flagged go; its
 * advisor (the three values it filled in) and its approval tick go only
 * where they still hold the example's values — what "Remove the example
 * rows" took back (R5, 2026-09-18) — and only on a record that had its rows.
 * The two flags go from every record. Returns the number of rows removed. */
const EXAMPLE_MILESTONES: Record<string, string> = { advisorIdentified: '2026-09-10', advisorName: 'Prof. Example', advisorTtt: 'yes' };
export function dropExampleRows(student: Student): number {
  const flagged = (c: CourseEntry): boolean => (c as CourseEntry & { fromExample?: unknown }).fromExample === true;
  const removed = student.courses.filter(flagged).length;
  student.courses = student.courses.filter((c) => !flagged(c));
  for (const c of student.courses) delete (c as CourseEntry & { fromExample?: unknown }).fromExample;
  delete (student as Student & { isExample?: unknown }).isExample;
  if (removed > 0) {
    const milestones = student.milestones as Record<string, unknown>;
    for (const [k, v] of Object.entries(EXAMPLE_MILESTONES)) if (milestones[k] === v) delete milestones[k];
    if (student.attestations.advisorApprovedPlan === true) delete student.attestations.advisorApprovedPlan;
  }
  return removed;
}

/** What opening a record that still held the example's rows says, once
 * (W-CL528; DGS 2026-10-17: "remove 'Load example' button and the function",
 * and its rows "Remove automatically"). */
export function exampleRowsRemovedNote(n: number): string {
  return `${n} example course ${n === 1 ? 'row was' : 'rows were'} removed from this record: the example student is no longer part of the app.`;
}

export function validateStudent(data: unknown, refusals: Refusal[] = [], cleanup: LoadCleanup = {}): Student {
  const d = data as Partial<Student> & { state?: unknown };
  if (d && typeof d === 'object' && 'student' in (d as object)) {
    // accept { savedAt, student } wrapper from exportFile()
    return validateStudent((d as { student: unknown }).student, refusals, cleanup);
  }
  if (!d || typeof d !== 'object') throw new Error('This file is not a saved audit (not a JSON object).');
  if (d.schemaVersion !== 1) {
    throw new Error(
      `This file has schemaVersion ${String((d as { schemaVersion?: unknown }).schemaVersion)} — this app reads version 1.`,
    );
  }
  if (d.program !== 'mscse' && d.program !== 'phd') throw new Error("This file has no program ('mscse' or 'phd').");
  if (!validTerm(d.entryTerm)) {
    throw new Error('This file has no valid entry term.');
  }
  // Admissions are in fall and spring only (DGS 2026-10-03): a summer entry
  // term in an older record is an early start whose official matriculation is
  // that year's fall, so it is read as the fall — the engine's own
  // normalisation, applied to the stored value so the form shows what counts.
  if (d.entryTerm.season === 'summer') d.entryTerm = { season: 'fall', year: d.entryTerm.year };
  if (!Array.isArray(d.courses)) throw new Error('This file has no course list.');
  // Which degrees a course has already counted toward (2026-09-10). A value
  // the app does not know is dropped, never thrown on — an unanswered course
  // simply counts nothing until the student answers.
  const COUNTED_TOWARD = ['bs', 'mscse', 'both', 'neither'];
  // Deep-check each course — a malformed entry accepted here would crash every
  // later page load, since the file is saved to localStorage.
  d.courses.forEach((c: unknown, i: number) => {
    const e = c as Record<string, unknown>;
    const where = `Course ${i + 1} in the file`;
    if (!e || typeof e !== 'object') throw new Error(`${where} is not an object.`);
    if (typeof e['courseId'] !== 'string' || e['courseId'].trim() === '')
      throw new Error(`${where} has no course number.`);
    if (typeof e['credits'] !== 'number' || !Number.isFinite(e['credits']))
      throw new Error(`${where} (${String(e['courseId'])}) has no numeric credits value.`);
    // Fifteen credits is the most any single course may be worth (DGS
    // 2026-09-18), so a record carrying more than that — which the pre-R1
    // build accepted, and which put "1005 pending review/approval" on the
    // 60-credit row — is corrected on load rather than refused: the course
    // stays, its credits go to 0, and the student is told. Zero is already the
    // app's own "counts toward nothing" state, with its own warning on the
    // course line, so the row says what is wrong where the student can fix it.
    if (!inRange(e['credits'], COURSE_CREDITS_RANGE)) {
      refusals.push({
        key: `course.${String(e['courseId'])}.credits`,
        text: String(e['credits']),
        message: `${String(e['courseId'])}: ${rangeRefusal(e['credits'], COURSE_CREDITS_RANGE, 'loaded')} It is on your list with 0 credits until you enter them.`,
      });
      e['credits'] = 0;
    }
    const term = e['term'] as Record<string, unknown> | undefined;
    if (!term || typeof term['year'] !== 'number' || !SEASONS.includes(term['season'] as never))
      throw new Error(`${where} (${String(e['courseId'])}) has no valid term.`);
    if (typeof e['grade'] !== 'string') throw new Error(`${where} (${String(e['courseId'])}) has no grade.`);
    if (e['origin'] !== 'nd' && e['origin'] !== 'transfer')
      throw new Error(`${where} (${String(e['courseId'])}) has no origin ('nd' or 'transfer').`);
    if (e['degreeLevel'] !== undefined && !['bachelors', 'masters', 'phd'].includes(e['degreeLevel'] as string))
      throw new Error(`${where} (${String(e['courseId'])}) has an unrecognized degreeLevel.`);
    if (e['registeredLevel'] !== undefined && !['undergraduate', 'graduate'].includes(e['registeredLevel'] as string))
      delete e['registeredLevel']; // a hint only — drop a malformed one rather than refuse the file
    if (e['fromNdTranscript'] !== undefined && e['fromNdTranscript'] !== true)
      delete e['fromNdTranscript']; // likewise a hint (which rows the transcript import added)
    if (e['fromExample'] !== undefined && e['fromExample'] !== true) delete e['fromExample']; // "Load example"'s rows, which dropExampleRows takes out
    if (e['fromUnofficialTranscript'] !== undefined && e['fromUnofficialTranscript'] !== true) delete e['fromUnofficialTranscript']; // and which came from an unofficial transcript
    if (e['transcriptMark'] !== undefined && (typeof e['transcriptMark'] !== 'string' || e['transcriptMark'].trim() === '')) delete e['transcriptMark']; // the mark as the transcript printed it
    if (e['creditSystemChosen'] !== undefined && e['creditSystemChosen'] !== true) delete e['creditSystemChosen']; // who chose the credit system (2026-10-10)
    // Where the row came from (2026-10-11, item 6) — labels only, so a malformed one is dropped.
    if (e['imported'] !== undefined) {
      const m = e['imported'] as Record<string, unknown> | null;
      const ok = m !== null && typeof m === 'object' && ['nd', 'bachelors', 'masters', 'phd'].includes(m['transcript'] as string) && typeof m['on'] === 'string' && isIsoDate(m['on']) && typeof m['app'] === 'string';
      if (!ok) delete e['imported'];
    }
    if (e['changedOnImport'] !== undefined) {
      const f = e['changedOnImport'];
      if (!Array.isArray(f) || !f.every((x) => (IMPORTED_FIELDS as readonly unknown[]).includes(x)) || f.length === 0) delete e['changedOnImport'];
    }
    if (e['typedByStudent'] !== undefined && e['typedByStudent'] !== true) delete e['typedByStudent'];
    if (e['countedToward'] !== undefined && !COUNTED_TOWARD.includes(e['countedToward'] as string)) delete e['countedToward'];
    if (e['dgsApproved'] !== undefined && e['dgsApproved'] !== true) delete e['dgsApproved']; // the DGS's approval of this course (2026-09-27)
    if (e['dgsHoldApproved'] !== undefined && e['dgsHoldApproved'] !== true) delete e['dgsHoldApproved']; // the DGS's ruling on a held course (round 5, item 29 (b))
    if (e['sharedWithOtherDegree'] !== undefined && e['sharedWithOtherDegree'] !== true) delete e['sharedWithOtherDegree']; // also counts toward a second program (2026-10-04)
    // Transfer credit the Notre Dame record shows as accepted (P3-import-1,
    // 2026-10-05). The engine counts it, so a malformed mark is dropped — the
    // row then reads as entered, and the next Notre Dame import marks it again.
    if (e['ndPosted'] !== undefined) {
      const p = e['ndPosted'] as Record<string, unknown> | null;
      const ok =
        e['origin'] === 'transfer' &&
        p !== null &&
        typeof p === 'object' &&
        validTerm(p['term']) &&
        inRange(p['credits'], COURSE_CREDITS_RANGE) &&
        (p['level'] === undefined || p['level'] === 'undergraduate' || p['level'] === 'graduate') &&
        (p['institution'] === undefined || typeof p['institution'] === 'string');
      if (!ok) delete e['ndPosted'];
      else {
        const t = p['term'] as Term;
        e['ndPosted'] = { term: { season: t.season, year: t.year }, credits: p['credits'], ...(p['level'] !== undefined ? { level: p['level'] } : {}), ...(p['institution'] !== undefined ? { institution: p['institution'] } : {}) };
      }
    }
  });
  migrateApprovalBoxes(d as unknown as { courses: Record<string, unknown>[]; attestations?: Record<string, unknown> });
  migrateExtensionBox((d as { attestations?: Record<string, unknown> }).attestations);
  // The cumulative GPA is the one number in a file the engine reads straight
  // through to a verdict, so it is range-checked here as well as in the form
  // (R1, 2026-09-18): a hand-edited 35 used to render "35.00 meets the 3.0
  // minimum", and a hand-edited "four point oh" threw on `.toFixed()`. An
  // impossible figure is dropped and reported; the rest of the record loads.
  const rawGpa = (d as Record<string, unknown>)['gpa'];
  // `null` means "not entered", not a figure: an older file can carry one, and
  // a null passed every `gpa !== undefined` test downstream and then threw on
  // `.toFixed()` in the §4.5 candidacy gate. It becomes undefined, silently —
  // nothing was refused, there was nothing there.
  const hasGpa = rawGpa !== undefined && rawGpa !== null;
  const gpaRefused = hasGpa && !inRange(rawGpa, GPA_RANGE);
  if (gpaRefused) refusals.push({ key: 'courses.gpa', text: String(rawGpa), message: rangeRefusal(rawGpa, GPA_RANGE, 'loaded') });
  const gpa = hasGpa && !gpaRefused ? (rawGpa as number) : undefined;
  // gpaSource (2026-09-05) is a display hint — drop a malformed one, keep the file.
  const gs = (d as Record<string, unknown>)['gpaSource'] as Record<string, unknown> | undefined;
  const gpaSource =
    gpaRefused || !(gs && typeof gs === 'object' && (gs['basis'] === 'transcript-graduate' || gs['basis'] === 'program-only'))
      ? undefined
      : (gs as Student['gpaSource']);
  const raw = d as Record<string, unknown>;
  const bachelorsAwarded = validBachelors(raw['bachelorsAwarded']);
  const student = {
    ...emptyStudent(),
    ...d,
    ...(gpa === undefined ? { gpa: undefined } : { gpa }),
    gpaSource,
    entryTermInferred: validInferred(raw['entryTermInferred']),
    bachelorsAwarded,
    bachelorsAwardedInferred: validBachelorsInferred(raw['bachelorsAwardedInferred'], bachelorsAwarded),
    background: validBackground(raw['background']),
    // The incomplete answer and what was read from transcripts (2026-10-08): kept only while no complete answer exists.
    // Set explicitly: `...d` above would otherwise carry the raw values through.
    backgroundDraft: validBackground(raw['background']) === undefined ? validBackgroundDraft(raw['backgroundDraft']) : undefined,
    backgroundRead: validBackgroundRead(raw['backgroundRead']),
    backgroundReadFrom: validBackgroundReadFrom(raw['backgroundReadFrom']),
    ndMasters: validNdMasters(raw['ndMasters']),
    ...(typeof raw['integratedBsMs'] === 'boolean' ? { integratedBsMs: raw['integratedBsMs'] as boolean } : {}),
    ...(typeof raw['integratedBsMs'] === 'boolean' && raw['integratedBsMsInferred'] && typeof (raw['integratedBsMsInferred'] as Record<string, unknown>)['how'] === 'string'
      ? { integratedBsMsInferred: { how: (raw['integratedBsMsInferred'] as { how: string }).how } }
      : {}),
    ndDegrees: validNdDegrees(raw['ndDegrees']),
    // The policy review's standing facts (2026-10-03): leaves and
    // accommodations (semester counts), a readmission term, the non-degree
    // answer — each kept only when well-formed.
    leaveSemesters: validSemesterCount(raw['leaveSemesters']),
    otherLeaveSemesters: validSemesterCount(raw['otherLeaveSemesters']),
    accommodationSemesters: validSemesterCount(raw['accommodationSemesters']),
    leaveTerms: validTermSlots(raw['leaveTerms'], validSemesterCount(raw['leaveSemesters'])),
    accommodationEventTerms: validTermSlots(raw['accommodationEventTerms'], validSemesterCount(raw['accommodationSemesters'])),
    readmittedTerm: validTerm(raw['readmittedTerm']) ? { season: (raw['readmittedTerm'] as Term).season, year: (raw['readmittedTerm'] as Term).year } : undefined,
    // 2026-10-04: the semester of graduation, and the 4+1 admission term —
    // each kept only when well-formed.
    graduationTerm: validTerm(raw['graduationTerm']) ? { season: (raw['graduationTerm'] as Term).season, year: (raw['graduationTerm'] as Term).year } : undefined,
    integratedAdmitted: validTerm(raw['integratedAdmitted']) ? { season: (raw['integratedAdmitted'] as Term).season, year: (raw['integratedAdmitted'] as Term).year } : undefined,
    // Approved credit overloads (Academic Code §3.8, 2026-10-03): well-formed
    // terms only; an empty or malformed list is dropped.
    creditOverloadTerms: validTermList(raw['creditOverloadTerms']),
    // A probation letter's deadline (2026-10-04): an ISO date or nothing.
    // A Notre Dame transcript's per-term GPA figures (2026-10-04): well-formed
    // terms and figures on the 0.00–4.00 scale only; anything else is dropped.
    termGpas: validTermGpas(raw['termGpas']),
    probationLetterDeadline:
      typeof raw['probationLetterDeadline'] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw['probationLetterDeadline']) ? raw['probationLetterDeadline'] : undefined,
    ...(typeof raw['ndNonDegree'] === 'boolean' ? { ndNonDegree: raw['ndNonDegree'] as boolean } : { ndNonDegree: undefined }),
    concurrentDegree: raw['concurrentDegree'] === true ? true : undefined,
    milestones: validMilestones(d.milestones, refusals),
    attestations: validAttestationTerms(d.attestations),
    courses: d.courses,
  } as Student;
  // What is left of "Load example" goes (2026-10-17) — the page says so once.
  const exampleRowsRemoved = dropExampleRows(student);
  if (exampleRowsRemoved > 0) cleanup.exampleRowsRemoved = (cleanup.exampleRowsRemoved ?? 0) + exampleRowsRemoved;
  // An early start's summer courses are the program's own (P3-chg-other-1;
  // DGS 2026-10-05, option (a)): a record saved while they were filed as
  // earlier coursework gets them back, so the line stops refusing them.
  refileEarlyStartCourses(student);
  // …and a prior master's the app inferred past an answered earlier-degrees
  // question (the same finding's cse-3 variant) gives way to the answer.
  settleAnsweredPriorMs(student);
  return student;
}

export function loadLocal(refusals: Refusal[] = [], cleanup: LoadCleanup = {}): Student | undefined {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return undefined;
    return validateStudent(JSON.parse(raw), refusals, cleanup);
  } catch {
    return undefined; // corrupted local state → start fresh rather than crash
  }
}

export function saveLocal(student: Student): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(student));
  } catch {
    // private mode / storage full — the explicit save-to-file still works
  }
}

export function clearLocal(): void {
  try {
    localStorage.removeItem(LS_KEY);
  } catch {
    /* ignore */
  }
}

/** The record's file: when it was saved, what it was checked with and how
 * every row read then (the stamp — DGS 2026-10-11, item 8; `npm run
 * reproduce` re-runs it), and the record. Loading reads `student` alone.
 * `auditDate` (YYYY-MM-DD, the stamp's) names the file (U24). */
export function exportFile(student: Student, auditDate: string, stamp?: SavedStamp): void {
  downloadJson(selfCheckFileName(student.program, auditDate), { savedAt: new Date().toISOString(), ...(stamp ? { stamp } : {}), student });
}

/** Does a record hold anything the student entered — a course, or a
 * milestone answer (a date, a name, a yes/no)? What "Load a file" would
 * replace, and so what gets an Undo (blue-team review 2026-10-17, U23). */
export function recordHoldsEntries(s: Student): boolean {
  return s.courses.length > 0 || Object.values(s.milestones).some((v) => v !== undefined && v !== '');
}

/** The toast after a record file replaced the record on this device
 * (blue-team review 2026-10-17, U24 + U23): what the file says about itself
 * — the day it was saved, at Notre Dame like every date on the page, and
 * its course count — and what it replaced, when the record held entries:
 *   File loaded.
 *   File loaded — saved October 3, 2026 (3 courses).
 *   File loaded — it replaced the 8 courses that were on this device.
 *   File loaded — saved October 3, 2026 (3 courses). It replaced the 8 courses that were on this device.
 * `raw` is the file as parsed (`savedAt` read here, nothing else); `loaded`
 * the record it held; `replaced` the record that was on the device, when it
 * held entries (recordHoldsEntries) — else undefined and nothing is said. */
export function loadedRecordToast(raw: unknown, loaded: Student, replaced: Student | undefined): string {
  const savedAt = (raw as { savedAt?: unknown } | null)?.savedAt;
  const savedOn = formatDateLong(typeof savedAt === 'string' ? savedAt : undefined);
  const fileSays = savedOn ? `saved ${savedOn} (${plural(loaded.courses.length, 'course')})` : undefined;
  const n = replaced?.courses.length ?? 0;
  const went = replaced ? (n > 0 ? `the ${plural(n, 'course')} that ${n === 1 ? 'was' : 'were'} on this device` : 'the record that was on this device') : undefined;
  if (fileSays && went) return `File loaded — ${fileSays}. It replaced ${went}.`;
  if (fileSays) return `File loaded — ${fileSays}.`;
  if (went) return `File loaded — it replaced ${went}.`;
  return 'File loaded.';
}

/** Hand the browser a JSON file to save — the record's (exportFile) or, in
 * simulation mode, the planning copy's (src/ui/simulation.ts). */
export function downloadJson(fileName: string, payload: unknown): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(a.href);
}
