// Simulation mode (DGS 2026-10-09) — the DOM-free half of src/ui/simulation.ts:
// the semester picker's list and default, the simulated "today", the saved
// file's name and shape, and what the Exit confirmation counts. The review
// fixes of 2026-10-09 are pinned at the end: the crash fallback's choice of
// key, a simulation file under an open preview, the registration-gap date,
// and the app.ts invariants the mode rests on (read from the source, since
// the page has no node-side DOM; the mode itself is driven by the e2e,
// scripts/e2e/drive-app.mjs driveSimulation).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { audit } from '../src/engine/audit.ts';
import { uncoveredRegistrationGaps } from '../src/engine/registration-gaps.ts';
import { termOfDate } from '../src/engine/term.ts';
import type { Term } from '../src/engine/types.ts';
import { validateStudent } from '../src/ui/state.ts';
import {
  SIMULATION_FILE_PREVIEW_NOTE,
  SIMULATION_YEARS_AHEAD,
  changesSentence,
  clampSimulationTerm,
  countChangesSince,
  crashRecovery,
  defaultSimulationTerm,
  loadSimulation,
  parseSimulationTermCode,
  routeLoadedFile,
  simulationFileName,
  simulationFilePayload,
  simulationStored,
  simulationTermCode,
  simulationTermOfFile,
  simulationTerms,
  simulationToday,
} from '../src/ui/simulation.ts';
import { buildRules } from './helpers.ts';
import { ndCourse, phdStudent } from './helpers/student.ts';

describe('defaultSimulationTerm — the next fall or spring, on fall/spring slots', () => {
  it('2026-10-09 (Fall 2026) → Spring 2027', () => {
    assert.deepEqual(defaultSimulationTerm('2026-10-09'), { season: 'spring', year: 2027 });
  });
  it('2027-02-01 (Spring 2027) → Fall 2027', () => {
    assert.deepEqual(defaultSimulationTerm('2027-02-01'), { season: 'fall', year: 2027 });
  });
  it('2027-07-01 (Summer 2027) → Fall 2027, not the spring after', () => {
    assert.deepEqual(defaultSimulationTerm('2027-07-01'), { season: 'fall', year: 2027 });
  });
});

describe('simulationTerms — from the real current term, summers included, ten years ahead', () => {
  it('starts with the real current term and ends with the same season ten years on', () => {
    const terms = simulationTerms('2026-10-09');
    assert.deepEqual(terms[0], { season: 'fall', year: 2026 });
    assert.deepEqual(terms[terms.length - 1], { season: 'fall', year: 2026 + SIMULATION_YEARS_AHEAD });
    assert.equal(terms.length, 3 * SIMULATION_YEARS_AHEAD + 1);
  });
  it('lists spring, summer, fall in order and holds the default', () => {
    const terms = simulationTerms('2027-02-01');
    assert.deepEqual(terms.slice(0, 4), [
      { season: 'spring', year: 2027 },
      { season: 'summer', year: 2027 },
      { season: 'fall', year: 2027 },
      { season: 'spring', year: 2028 },
    ]);
    const d = defaultSimulationTerm('2027-02-01');
    assert.ok(terms.some((t) => t.season === d.season && t.year === d.year));
  });
  it('option codes round-trip through term.ts', () => {
    for (const t of simulationTerms('2026-10-09')) assert.deepEqual(parseSimulationTermCode(simulationTermCode(t)), t);
  });
});

describe('clampSimulationTerm — never before the real current term, never past the list', () => {
  it('keeps a term inside the range', () => {
    assert.deepEqual(clampSimulationTerm({ season: 'spring', year: 2028 }, '2026-10-09'), { season: 'spring', year: 2028 });
  });
  it('lifts a past term to the real current term', () => {
    assert.deepEqual(clampSimulationTerm({ season: 'spring', year: 2026 }, '2026-10-09'), { season: 'fall', year: 2026 });
  });
  it('holds a far term at the last option', () => {
    assert.deepEqual(clampSimulationTerm({ season: 'spring', year: 2050 }, '2026-10-09'), { season: 'fall', year: 2036 });
  });
});

describe('simulationToday — the real date this semester, the first day of a later one', () => {
  it('is the real date when the simulated semester is the real current one', () => {
    assert.equal(simulationToday({ season: 'fall', year: 2026 }, '2026-10-09'), '2026-10-09');
  });
  it('never moves time backwards', () => {
    assert.equal(simulationToday({ season: 'spring', year: 2026 }, '2026-10-09'), '2026-10-09');
  });
  it('is the first day of a later semester, and termOfDate reads that day as the same semester', () => {
    for (const term of simulationTerms('2026-10-09').slice(1)) {
      const iso = simulationToday(term, '2026-10-09');
      assert.ok(iso > '2026-10-09', `${iso} is after the real date`);
      assert.deepEqual(termOfDate(iso), term);
    }
    assert.equal(simulationToday({ season: 'spring', year: 2028 }, '2026-10-09'), '2028-01-10');
  });
});

describe('the saved file', () => {
  it('is named for the program and the simulated semester', () => {
    assert.equal(simulationFileName('phd', { season: 'spring', year: 2028 }), 'cse-degree-audit-phd-simulation-SP28.json');
    assert.equal(simulationFileName('mscse', { season: 'summer', year: 2027 }), 'cse-degree-audit-mscse-simulation-SU27.json');
  });
  it('puts the note first, then the term, and an older build still reads the student inside', () => {
    const student = phdStudent({ courses: [ndCourse('CSE 60111')] });
    const payload = simulationFilePayload(student, { season: 'spring', year: 2028 }, '2026-10-09T18:00:00.000Z');
    assert.deepEqual(Object.keys(payload), ['note', 'simulation', 'savedAt', 'student']);
    assert.equal(payload.note, "SIMULATION of Spring 2028 — a planning copy, not this student's record");
    assert.deepEqual(payload.simulation, { term: { season: 'spring', year: 2028 } });
    // validateStudent (what every build's "Load a file" runs) accepts the
    // wrapper and ignores the two new keys.
    const back = validateStudent(JSON.parse(JSON.stringify(payload)));
    assert.equal(back.courses.length, 1);
    assert.equal(back.courses[0]!.courseId, 'CSE 60111');
    assert.deepEqual(simulationTermOfFile(JSON.parse(JSON.stringify(payload))), { season: 'spring', year: 2028 });
  });
  it('an ordinary record file carries no simulated semester', () => {
    assert.equal(simulationTermOfFile({ savedAt: 'x', student: phdStudent() }), undefined);
    assert.equal(simulationTermOfFile({ simulation: { term: { season: 'winter', year: 2028 } }, student: phdStudent() }), undefined);
    assert.equal(simulationTermOfFile(null), undefined);
    assert.equal(simulationTermOfFile('nope'), undefined);
  });
  it('loadSimulation is undefined where there is no localStorage (node)', () => {
    assert.equal(loadSimulation(), undefined);
  });
});

// Where "Load a file" puts a file (D3; DGS 2026-10-09) — the pure router
// app.ts's file input calls. The real record is the page's `student` outside
// the mode and `realStudent` inside it; no route writes it (D2).
describe('routeLoadedFile — a record or a simulation file, outside or inside the mode', () => {
  const REAL = '2026-10-09';
  const SP28 = { season: 'spring' as const, year: 2028 };
  const FA27 = { season: 'fall' as const, year: 2027 };
  const onPage = phdStudent({ courses: [ndCourse('CSE 60641')] });
  const inFile = phdStudent({ courses: [ndCourse('CSE 60111'), ndCourse('CSE 60321')] });
  const recordFile = { savedAt: 'x', student: inFile };
  const simulationFile = simulationFilePayload(inFile, SP28, 'x');

  it('a plain record file outside the mode replaces the record, the mode stays off', () => {
    const r = routeLoadedFile(recordFile, { student: onPage, simulation: undefined, realStudent: undefined }, REAL);
    assert.equal(r.outcome, 'record');
    assert.equal(r.simulation, undefined);
    assert.equal(r.realStudent, undefined);
    assert.deepEqual(r.student.courses.map((c) => c.courseId), ['CSE 60111', 'CSE 60321']);
  });
  it('a simulation file outside the mode enters the mode with its semester; the record on the page is kept, untouched', () => {
    const before = JSON.stringify(onPage);
    const r = routeLoadedFile(simulationFile, { student: onPage, simulation: undefined, realStudent: undefined }, REAL);
    assert.equal(r.outcome, 'entered');
    assert.deepEqual(r.simulation?.term, SP28);
    assert.equal(r.simulation?.student, r.student, 'the simulation holds the page’s new record');
    assert.equal(r.realStudent, onPage, 'the record that was on the page is what Exit puts back');
    assert.equal(JSON.stringify(onPage), before, 'and it was not changed');
    assert.deepEqual(r.student.courses.map((c) => c.courseId), ['CSE 60111', 'CSE 60321']);
  });
  it('a plain record file inside the mode loads into the simulation, same semester; the real record is untouched', () => {
    const real = phdStudent({ courses: [ndCourse('CSE 60427')] });
    const before = JSON.stringify(real);
    const r = routeLoadedFile(recordFile, { student: onPage, simulation: { term: FA27, student: onPage }, realStudent: real }, REAL);
    assert.equal(r.outcome, 'into-simulation');
    assert.deepEqual(r.simulation?.term, FA27, 'the page’s semester, since the file has none');
    assert.equal(r.simulation?.student, r.student);
    assert.equal(r.realStudent, real);
    assert.equal(JSON.stringify(real), before);
    assert.deepEqual(r.student.courses.map((c) => c.courseId), ['CSE 60111', 'CSE 60321']);
  });
  it('a simulation file inside the mode replaces the simulation, semester included', () => {
    const real = phdStudent({ courses: [ndCourse('CSE 60427')] });
    const r = routeLoadedFile(simulationFile, { student: onPage, simulation: { term: FA27, student: onPage }, realStudent: real }, REAL);
    assert.equal(r.outcome, 'into-simulation');
    assert.deepEqual(r.simulation?.term, SP28, 'the file’s semester');
    assert.equal(r.realStudent, real);
    assert.deepEqual(r.student.courses.map((c) => c.courseId), ['CSE 60111', 'CSE 60321']);
  });
  it('a simulation file saved for a semester now past is lifted to the real current one', () => {
    const old = simulationFilePayload(inFile, { season: 'spring', year: 2025 }, 'x');
    const r = routeLoadedFile(old, { student: onPage, simulation: undefined, realStudent: undefined }, REAL);
    assert.deepEqual(r.simulation?.term, termOfDate(REAL));
  });
  it('validateStudent reads the student inside a simulation file exactly as it reads a record file — nothing stripped, nothing added', () => {
    const fromSimulation = validateStudent(JSON.parse(JSON.stringify(simulationFile)));
    const fromRecord = validateStudent(JSON.parse(JSON.stringify(recordFile)));
    const bare = validateStudent(JSON.parse(JSON.stringify(inFile)));
    assert.deepEqual(fromSimulation, fromRecord);
    assert.deepEqual(fromSimulation, bare);
  });
  it('a file that is not a record is refused before anything on the page changes', () => {
    assert.throws(() => routeLoadedFile({ simulation: { term: SP28 }, student: { schemaVersion: 2 } }, { student: onPage, simulation: undefined, realStudent: undefined }, REAL), /schemaVersion 2/);
    assert.throws(() => routeLoadedFile('nope', { student: onPage, simulation: undefined, realStudent: undefined }, REAL), /not a saved audit/);
  });
});

describe('countChangesSince — what Exit would discard', () => {
  const real = phdStudent({
    courses: [ndCourse('CSE 60111'), ndCourse('CSE 60321', { term: { season: 'spring', year: 2027 }, grade: 'IP' })],
    milestones: { advisorName: 'Dr. X', researchQualifierPassed: '2027-05-01' },
    attestations: { advisorApprovedPlan: true },
    gpa: 3.5,
  });
  const copy = (): ReturnType<typeof phdStudent> => JSON.parse(JSON.stringify(real));

  it('is all zeros for an untouched copy', () => {
    assert.deepEqual(countChangesSince(real, copy()), { courses: 0, milestoneDates: 0, other: 0 });
  });
  it('counts an added row once, a removed row once and an edited row once', () => {
    const added = copy();
    added.courses.push(ndCourse('CSE 60641', { term: { season: 'fall', year: 2027 }, grade: 'A' }));
    assert.equal(countChangesSince(real, added).courses, 1);
    const removed = copy();
    removed.courses.splice(0, 1);
    assert.equal(countChangesSince(real, removed).courses, 1);
    const edited = copy();
    edited.courses[1]!.grade = 'A'; // the planned grade replaces In progress
    assert.equal(countChangesSince(real, edited).courses, 1);
  });
  it('tells milestone dates from the other milestone fields', () => {
    const sim = copy();
    sim.milestones.candidacyPassed = '2028-04-01'; // a date added
    sim.milestones.researchQualifierPassed = undefined; // a date cleared
    sim.milestones.advisorName = 'Dr. Y'; // a name changed
    const c = countChangesSince(real, sim);
    assert.equal(c.milestoneDates, 2);
    assert.equal(c.other, 1);
  });
  it('counts each attestation tick and each other field once', () => {
    const sim = copy();
    sim.attestations.dgsApprovedNonCse = true;
    sim.attestations.advisorApprovedPlan = false;
    sim.gpa = 3.8;
    sim.leaveSemesters = 1;
    assert.deepEqual(countChangesSince(real, sim), { courses: 0, milestoneDates: 0, other: 4 });
  });
  it('reads as one sentence naming the semester', () => {
    assert.equal(
      changesSentence({ courses: 3, milestoneDates: 1, other: 2 }, { season: 'spring', year: 2028 }),
      '3 courses, 1 milestone date and 2 other changes made since you entered; the simulated semester Spring 2028',
    );
  });
});

// ---------- review fixes (2026-10-09) ----------

describe('a simulation file while a transcript preview or scan is open (review fix 2026-10-09)', () => {
  const REAL = '2026-10-09';
  const SP28 = { season: 'spring' as const, year: 2028 };
  const onPage = phdStudent({ courses: [ndCourse('CSE 60641')] });
  const inFile = phdStudent({ courses: [ndCourse('CSE 60111')] });
  const simulationFile = simulationFilePayload(inFile, SP28, 'x');
  const recordFile = { savedAt: 'x', student: inFile };

  it('is refused outside the mode, before anything on the page changes — the preview belongs to the record', () => {
    const before = JSON.stringify(onPage);
    assert.throws(() => routeLoadedFile(simulationFile, { student: onPage, simulation: undefined, realStudent: undefined, previewOpen: true }, REAL), (err: unknown) => err instanceof Error && err.message === SIMULATION_FILE_PREVIEW_NOTE);
    assert.equal(JSON.stringify(onPage), before);
    assert.match(SIMULATION_FILE_PREVIEW_NOTE, /transcript preview is open/);
  });
  it('a plain record file is routed as before while the preview is open (the preview was never the mode’s business)', () => {
    assert.equal(routeLoadedFile(recordFile, { student: onPage, simulation: undefined, realStudent: undefined, previewOpen: true }, REAL).outcome, 'record');
  });
  it('with no preview open the file enters the mode as before', () => {
    assert.equal(routeLoadedFile(simulationFile, { student: onPage, simulation: undefined, realStudent: undefined, previewOpen: false }, REAL).outcome, 'entered');
  });
  it('inside the mode the flag changes nothing — no preview can be open there (the imports are inert)', () => {
    const real = phdStudent({ courses: [ndCourse('CSE 60427')] });
    assert.equal(routeLoadedFile(simulationFile, { student: onPage, simulation: { term: SP28, student: onPage }, realStudent: real, previewOpen: true }, REAL).outcome, 'into-simulation');
  });
});

describe('the crash fallback (main.ts; review fix 2026-10-09) — which key it clears', () => {
  it('with a simulation stored, discards the simulation and keeps the record', () => {
    const plan = crashRecovery(true, 'boom');
    assert.equal(plan.clears, 'simulation');
    assert.equal(plan.message, 'Something went wrong showing the simulation you left open (boom). You can discard the simulation and go back to your record — or close this tab if you want to try again later.');
    assert.equal(plan.button, 'Discard the simulation and show my record');
  });
  it('without one, clears everything — the simulation key included — with the wording the page always had', () => {
    const plan = crashRecovery(false, undefined);
    assert.equal(plan.clears, 'all');
    assert.equal(plan.message, 'Something went wrong showing your saved data. You can clear it and start fresh — or close this tab if you want to try again later.');
    assert.equal(plan.button, 'Clear saved data and start fresh');
  });
  it('simulationStored is false where there is no localStorage (node)', () => {
    assert.equal(simulationStored(), false);
  });
});

describe('the registration-gap question reads the date the engine reads (review fix 2026-10-09)', () => {
  // A transcript registered Fall 2025 through Fall 2026, one leave semester entered, no readmission.
  const fall = (year: number): Term => ({ season: 'fall', year });
  const spring = (year: number): Term => ({ season: 'spring', year });
  const nd = (id: string, term: Term) => ndCourse(id, { term, fromNdTranscript: true });
  const student = phdStudent({ entryTerm: fall(2025), leaveSemesters: 1, courses: [nd('CSE 60641', fall(2025)), nd('CSE 60111', spring(2026)), nd('CSE 60321', fall(2026))] });
  const REAL = '2026-10-09';
  const SP28 = spring(2028);
  const rules = buildRules();
  const gapWarning = (today: string, s = student) => audit(s, rules, today).warnings.find((w) => /^Your Notre Dame transcript shows no registration in/.test(w));

  it('on the real date there is nothing to say — the transcript runs to the current semester', () => {
    assert.equal(uncoveredRegistrationGaps(student, REAL), undefined);
    assert.equal(gapWarning(REAL), undefined);
  });
  it('simulating Spring 2028 with nothing planned for 2027: the engine warns about Spring 2027 and Fall 2027, and the fold opener, read off the same date, agrees', () => {
    const today = simulationToday(SP28, REAL);
    assert.match(gapWarning(today)!, /no registration in Spring 2027 and Fall 2027 — 2 semesters, more than the 1 semester of medical leave/);
    // What app.ts's `gapUnanswered` reads: defined → the Your standing fold opens where the warning points.
    assert.deepEqual(uncoveredRegistrationGaps(student, today), [spring(2027), fall(2027)]);
    // …and what it read before the fix (the real date): undefined → the fold stayed closed under an open warning.
    assert.equal(uncoveredRegistrationGaps(student, REAL), undefined);
  });
  it('planning a course in each of those semesters clears the warning and closes the question', () => {
    const planned = { ...student, courses: [...student.courses, ndCourse('CSE 60427', { term: spring(2027) }), ndCourse('CSE 60876', { term: fall(2027) })] };
    const today = simulationToday(SP28, REAL);
    assert.equal(uncoveredRegistrationGaps(planned, today), undefined);
    assert.equal(gapWarning(today, planned), undefined);
  });
});

describe('app.ts invariants the mode rests on (read from the source — the page has no node-side DOM)', () => {
  const src = readFileSync(new URL('../src/ui/app.ts', import.meta.url), 'utf8');
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  /** The text of one function or arrow in app.ts, from its head to the first line that closes at its indentation. */
  const bodyOf = (head: string, close: string): string => {
    const start = src.indexOf(head);
    assert.ok(start >= 0, `app.ts has ${head}`);
    const end = src.indexOf(close, start);
    assert.ok(end > start, `…and it closes with ${JSON.stringify(close)}`);
    return src.slice(start, end);
  };

  it('saveLocal( is called exactly once, inside persist() — no path turns a plan into the record (D2)', () => {
    assert.equal((src.match(/\bsaveLocal\(/g) ?? []).length, 1);
    assert.ok(bodyOf('const persist = (): void => {', '\n  };').includes('saveLocal(student)'));
  });
  it('a semester change renders before it is saved, so a semester that crashes rendering is never stored and re-thrown on every reload', () => {
    const body = bodyOf('function setSimulationTerm(', '\n  }\n');
    assert.ok(body.includes('render()') && body.includes('persist()'), 'renders and persists');
    assert.ok(body.indexOf('render()') < body.indexOf('persist()'), 'render first');
    assert.ok(!body.includes('saveSimulation('), 'through the one persist() gate');
  });
  it('the crash fallback clears the simulation key, and the record only when no simulation is stored', () => {
    assert.match(main, /crashRecovery\(simulationStored\(\)/);
    assert.match(main, /if \(plan\.clears === 'all'\) clearLocal\(\);\s*clearSimulation\(\);/);
  });
  it('a simulation file is routed with the preview state, like the Simulate button', () => {
    assert.match(src, /routeLoadedFile\(raw, \{ student, simulation, realStudent, previewOpen: ndPreviewOpen\(\) \|\| importsBusy\(\) \}/);
    assert.match(src, /if \(simulation \|\| ndPreviewOpen\(\) \|\| importsBusy\(\)\) return;/, 'enterSimulation’s guard');
  });
  it('the Your standing fold opens off the date the engine reads (todayIso()); the transcript’s own empty semesters keep the real date (D5)', () => {
    assert.match(src, /uncoveredRegistrationGaps\(student, todayIso\(\)\) !== undefined/);
    assert.doesNotMatch(src, /uncoveredRegistrationGaps\(student, realTodayIso\)/);
    assert.match(src, /transcriptGapSemesters\(student, realTodayIso\)/);
  });
  it('the Simulation chip beside the report headline and on the request cards is not gated on the frame', () => {
    // Every headline the sticky bar watches — the phone's summary copy and the report's — not the report's alone (closing e2e 2026-10-09: the phone showed no chip).
    assert.match(src, /if \(simulation\) for \(const h of root\.querySelectorAll\('\.summary-mobile \.headline, \.audit \.scorehead \.headline'\)\) h\.append\(' ', simulationChip\(\)!\);/);
    assert.match(src, /root\.querySelectorAll<HTMLElement>\('\.summary-mobile \.headline, \.audit \.scorehead \.headline'\)/); // the observer's own list, which the chip must follow
    assert.doesNotMatch(src, /isEmbedded\(\) \? simulationChip\(\)/);
  });
  it('…and the two request cards, in request-cards.ts since W11 (2026-10-22), each put the chip in their heading, ungated', () => {
    const cards = readFileSync(new URL('../src/ui/request-cards.ts', import.meta.url), 'utf8');
    assert.equal((cards.match(/simulationChip\(\)\)/g) ?? []).length, 2, 'one chip per card heading (the review card, the Grad Admin card)');
    assert.doesNotMatch(cards, /isEmbedded\(\)/);
    assert.match(src, /askDgsCard\(requestCardArgs\(\), pending, report\)/);
    assert.match(src, /askGradAdminCard\(requestCardArgs\(\), gaRequest\)/);
  });
});
