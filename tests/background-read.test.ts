// Reading the earlier degrees from transcripts (DGS 2026-10-08, Option 1). The
// term lists are invented; their shapes are the two redacted insideND
// transcripts the DGS provided: a student who moved into the Ph.D. after one
// MSCSE semester (graduate CSE terms only), and a 4+1 who stayed for the Ph.D.
// (undergraduate terms, majors First Year → Computer Engineering, then
// graduate CSE terms).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Term } from '../src/engine/types.ts';
import type { TranscriptTerm } from '../src/transcript/parse.ts';
import { isCseMajor, readBackgroundFromNdTerms, readBackgroundFromPriorBachelors, readBackgroundFromPriorGraduate } from '../src/ui/background-read.ts';

const T = (season: Term['season'], year: number, level: TranscriptTerm['level'], major?: string, college = 'College of Engineering'): TranscriptTerm => ({ term: { season, year }, ...(level ? { level } : {}), college, ...(major ? { major } : {}) });
const CSE = 'Computer Science & Engineering';

describe('the earlier degrees, read from a Notre Dame transcript', () => {
  it('graduate CSE terms only (the move into the Ph.D. after one MSCSE semester): nothing is read — the transcript does not say it covers every level, and the graduate history is not on it', () => {
    const r = readBackgroundFromNdTerms([T('fall', 2022, 'graduate', CSE), T('spring', 2023, 'graduate', CSE), T('fall', 2026, undefined, CSE)]);
    assert.deepEqual(r.answer, {});
  });
  it('a Notre Dame 4+1 who stayed: a CSE bachelor’s, read from the last undergraduate major', () => {
    const r = readBackgroundFromNdTerms([
      T('fall', 2020, 'undergraduate', 'Computer Science', 'First Year of Studies'),
      T('spring', 2021, 'undergraduate', 'Computer Engineering', 'First Year of Studies'),
      T('spring', 2024, 'undergraduate', 'Computer Engineering'),
      T('fall', 2024, 'graduate', CSE),
    ]);
    assert.deepEqual(r.answer, { bachelors: 'nd-cse' });
    assert.equal(r.how.bachelors, 'your Notre Dame transcript shows undergraduate terms through Spring 2024, majoring in Computer Engineering');
  });
  it('another department’s bachelor’s: the last undergraduate major decides, not the first', () => {
    const r = readBackgroundFromNdTerms([T('fall', 2018, 'undergraduate', 'Computer Science', 'First Year of Studies'), T('spring', 2022, 'undergraduate', 'Mathematics', 'College of Science'), T('fall', 2022, 'graduate', CSE)]);
    assert.equal(r.answer.bachelors, 'nd-other');
  });
  it('a graduate program in another Notre Dame department before CSE', () => {
    const r = readBackgroundFromNdTerms([T('fall', 2021, 'graduate', 'Electrical Engineering'), T('spring', 2022, 'graduate', 'Electrical Engineering'), T('fall', 2022, 'graduate', CSE)]);
    assert.deepEqual(r.answer, { graduate: 'nd-other' });
    assert.match(r.how.graduate ?? '', /graduate terms in Electrical Engineering from Fall 2021, before your CSE terms/);
  });
  it('a layout that marks no term levels: nothing is read', () => {
    assert.deepEqual(readBackgroundFromNdTerms([{ term: { season: 'fall', year: 2022 }, major: CSE }]).answer, {});
    assert.deepEqual(readBackgroundFromNdTerms(undefined).answer, {});
  });
  it('CSE’s majors', () => {
    for (const m of ['Computer Science', 'Computer Engineering', 'Computer Science & Engineering', 'Computer Science and Engineering']) assert.ok(isCseMajor(m), m);
    for (const m of ['Electrical Engineering', 'Mathematics', undefined]) assert.ok(!isCseMajor(m), String(m));
  });
});

describe('the earlier degrees, read from a previous graduate transcript', () => {
  it('conferred, at the bachelor’s university: all three facts', () => {
    const r = readBackgroundFromPriorGraduate({ slot: 'masters', university: 'Purdue University', conferred: true, bachelorsUniversity: 'PURDUE UNIVERSITY' });
    assert.deepEqual(r.answer, { graduate: 'elsewhere', finished: true, samePlace: true });
  });
  it('no conferral line, no bachelor’s transcript: only that there was a program', () => {
    const r = readBackgroundFromPriorGraduate({ slot: 'phd', university: 'Purdue University' });
    assert.deepEqual(r.answer, { graduate: 'elsewhere' });
    assert.equal(r.how.graduate, 'you added a previous Ph.D. transcript from Purdue University');
  });
});

import { answerBackground, confirmDraft, mergeReading } from '../src/ui/background-read.ts';
import { priorSlotsForDraft } from '../src/ui/background.ts';
import { validateStudent } from '../src/ui/state.ts';
import { phdStudent } from './helpers/student.ts';

describe('folding readings into the record, and the student’s own answers', () => {
  const NDCSE = readBackgroundFromNdTerms([T('spring', 2024, 'undergraduate', 'Computer Engineering'), T('fall', 2024, 'graduate', CSE)]);
  it('a reading fills a draft; the page asks the rest', () => {
    const s = phdStudent();
    assert.equal(mergeReading(s, NDCSE), 'filled');
    assert.deepEqual(s.backgroundDraft, { bachelors: 'nd-cse' });
    assert.match(s.backgroundRead?.bachelors ?? '', /majoring in Computer Engineering/);
    assert.equal(s.background, undefined, 'incomplete: the engine still sees no answer');
  });
  it('a reading never overwrites what is there, and nothing changes once answered', () => {
    const s = phdStudent({ backgroundDraft: { bachelors: 'elsewhere' } });
    assert.equal(mergeReading(s, NDCSE), false);
    assert.equal(s.backgroundDraft?.bachelors, 'elsewhere');
    const answered = phdStudent({ background: { bachelors: 'elsewhere', graduate: 'none' } });
    assert.equal(mergeReading(answered, NDCSE), false);
  });
  it('the student finishes the answer on the page: applied, and a changed part is theirs', () => {
    const s = phdStudent();
    mergeReading(s, NDCSE);
    answerBackground(s, { ...s.backgroundDraft, ndIntegrated: false, graduate: 'none' });
    assert.deepEqual(s.background, { bachelors: 'nd-cse', ndIntegrated: false, graduate: 'none' });
    assert.equal(s.backgroundDraft, undefined);
    assert.ok(s.backgroundRead?.bachelors, 'the bachelor’s is still marked as read');
    answerBackground(s, { ...s.background, bachelors: 'nd-other' });
    assert.equal(s.backgroundRead, undefined, 'changed by the student: no longer "read"');
  });
  it('a previous master’s transcript after the student said the Notre Dame MSCSE: "also elsewhere", finished', () => {
    const s = phdStudent({ backgroundDraft: { bachelors: 'elsewhere', graduate: 'nd-mscse' } });
    mergeReading(s, readBackgroundFromPriorGraduate({ slot: 'masters', university: 'Purdue University', conferred: true }));
    // Read, not applied (review of Option 1): complete, waiting for "Done";
    // meanwhile prior study already follows the "finished" read.
    assert.equal(s.background, undefined);
    assert.deepEqual(s.backgroundDraft, { bachelors: 'elsewhere', graduate: 'nd-mscse', alsoElsewhere: true, finished: true });
    assert.equal(s.priorMs, 'completed');
    assert.equal(confirmDraft(s), true);
    assert.deepEqual(s.background, { bachelors: 'elsewhere', graduate: 'nd-mscse', alsoElsewhere: true, finished: true });
    assert.equal(s.backgroundRead, undefined, 'Done is the check');
  });
  it('the transcript rows while the answer is incomplete', () => {
    assert.deepEqual(priorSlotsForDraft(undefined, 'phd'), ['bachelors', 'masters', 'phd']);
    assert.deepEqual(priorSlotsForDraft({ bachelors: 'nd-cse' }, 'phd'), ['masters', 'phd']);
    assert.deepEqual(priorSlotsForDraft({ bachelors: 'nd-cse', graduate: 'none' }, 'phd'), []);
    assert.deepEqual(priorSlotsForDraft({ bachelors: 'elsewhere', graduate: 'nd-mscse', alsoElsewhere: false }, 'phd'), ['bachelors']);
  });
  it('a saved file keeps the draft and what was read; a draft beside a complete answer is dropped', () => {
    const v = validateStudent({ ...phdStudent(), backgroundDraft: { bachelors: 'nd-cse', graduate: 'bogus' }, backgroundRead: { bachelors: 'your Notre Dame transcript shows …', nope: 'x' } } as never, []);
    assert.deepEqual(v.backgroundDraft, { bachelors: 'nd-cse' });
    assert.deepEqual(v.backgroundRead, { bachelors: 'your Notre Dame transcript shows …' });
    const both = validateStudent({ ...phdStudent(), background: { bachelors: 'elsewhere', graduate: 'none' }, backgroundDraft: { bachelors: 'nd-cse' } } as never, []);
    assert.equal(both.backgroundDraft, undefined);
  });
});

import { draftForProgram, withdrawBackground } from '../src/ui/background-read.ts';
import { applyBackground } from '../src/ui/background.ts';

// The adversarial review of Option 1 (2026-10-08).
describe('a reading’s follow-ups only where the answer asks them; a program change', () => {
  const PURDUE_MS = readBackgroundFromPriorGraduate({ slot: 'masters', university: 'Purdue University', conferred: true, bachelorsUniversity: 'Purdue University' });
  it('an outside master’s does not mark another Notre Dame department’s program finished', () => {
    const s = phdStudent({ backgroundDraft: { bachelors: 'elsewhere', graduate: 'nd-other' } });
    assert.equal(mergeReading(s, PURDUE_MS), false);
    assert.deepEqual(s.backgroundDraft, { bachelors: 'elsewhere', graduate: 'nd-other' });
    assert.equal(s.backgroundRead, undefined);
  });
  it('nor fills hidden follow-ups beside “No”, or beside the MSCSE with “No” to a degree elsewhere', () => {
    for (const d of [{ graduate: 'none' as const }, { graduate: 'nd-mscse' as const, alsoElsewhere: false }]) {
      const s = phdStudent({ backgroundDraft: { ...d } });
      assert.equal(mergeReading(s, PURDUE_MS), false, JSON.stringify(d));
      assert.deepEqual(s.backgroundDraft, d);
    }
  });
  it('beside “Yes, at another university”, all three are filled', () => {
    const s = phdStudent({ backgroundDraft: { bachelors: 'elsewhere' } });
    mergeReading(s, PURDUE_MS);
    assert.equal(s.background, undefined, 'a reading never applies the answer');
    assert.deepEqual(s.backgroundDraft, { bachelors: 'elsewhere', graduate: 'elsewhere', samePlace: true, finished: true });
    assert.equal(s.priorMs, 'completed', 'the cap follows the finished read — 24, not 6');
  });
  it('the MSCSE cannot hold or leave the Notre Dame MSCSE: those answers, and what they asked, go', () => {
    const d = { bachelors: 'elsewhere' as const, graduate: 'nd-mscse-transfer' as const, transferredTerm: { season: 'spring' as const, year: 2023 }, alsoElsewhere: true, finished: true };
    assert.deepEqual(draftForProgram(d, 'mscse'), { bachelors: 'elsewhere' });
    assert.deepEqual(draftForProgram(d, 'phd'), d);
    assert.deepEqual(draftForProgram({ bachelors: 'nd-cse', graduate: 'elsewhere', samePlace: false, finished: true }, 'mscse'), { bachelors: 'nd-cse', graduate: 'elsewhere', samePlace: false, finished: true });
  });
  it('an answer withdrawn by a program change undoes what it settled', () => {
    const s = phdStudent();
    applyBackground(s, { bachelors: 'nd-cse', graduate: 'nd-4plus1', alsoElsewhere: true, finished: true });
    s.backgroundRead = { bachelors: 'read', finished: 'read' };
    assert.equal(s.priorMs, 'completed');
    assert.equal(s.integratedBsMs, true);
    assert.ok(s.ndMasters);
    s.program = 'mscse';
    withdrawBackground(s, draftForProgram(s.background!, s.program));
    assert.equal(s.background, undefined);
    assert.deepEqual(s.backgroundDraft, { bachelors: 'nd-cse' });
    assert.deepEqual(s.backgroundRead, { bachelors: 'read' });
    assert.equal(s.priorMs, 'none');
    assert.equal(s.integratedBsMs, undefined);
    assert.equal(s.ndMasters, undefined);
  });
});

import { reconcileInferences } from '../src/ui/background-read.ts';

describe('the import-time inferences agree with a partial answer (review of Option 1)', () => {
  it('a Notre Dame master’s from another department is not “the MSCSE held” once the draft says another department', () => {
    const s = phdStudent({ entryTerm: { season: 'fall', year: 2024 }, ndDegrees: [{ level: 'masters', date: '2024-05-15' }] } as never);
    s.backgroundDraft = { graduate: 'nd-other' };
    s.ndMasters = { term: { season: 'spring', year: 2024 }, inferred: { how: 'x' } };
    reconcileInferences(s);
    assert.equal(s.ndMasters, undefined);
  });
  it('a draft “No” to a graduate degree keeps prior graduate study at none', () => {
    const s = phdStudent();
    s.priorMs = 'unfinished';
    s.priorMsInferred = true;
    s.backgroundDraft = { graduate: 'none' };
    reconcileInferences(s);
    assert.equal(s.priorMs, 'none');
    assert.equal(s.priorMsInferred, undefined);
  });
  it('a draft “No” to the 4+1 withdraws an inferred 4+1', () => {
    const s = phdStudent();
    s.integratedBsMs = true;
    s.integratedBsMsInferred = { how: 'x' };
    answerBackground(s, { bachelors: 'nd-cse', ndIntegrated: false });
    assert.equal(s.integratedBsMs, undefined);
  });
});

import { priorStudyLabel } from '../src/ui/program-history.ts';

describe('the emails, before the earlier degrees are answered (review of Option 1)', () => {
  it('say “not answered yet”, not “no prior graduate degree”', () => {
    assert.equal(priorStudyLabel(phdStudent()), 'not answered yet');
    const inferred = phdStudent();
    inferred.priorMs = 'unfinished';
    inferred.priorMsInferred = true;
    assert.notEqual(priorStudyLabel(inferred), 'not answered yet');
    assert.notEqual(priorStudyLabel(phdStudent({ background: { bachelors: 'elsewhere', graduate: 'none' } })), 'not answered yet');
  });
});

import { isOtherDepartmentMajor } from '../src/ui/background-read.ts';

describe('only a positive reading is evidence (review of Option 1)', () => {
  it('a wrapped or placeholder major cell is no department at all', () => {
    for (const m of ['Computer', 'Computer Science', 'Computer Science &', '-', 'Good Standing', 'College of', 'Applied & Computational Mathematics &']) assert.equal(isOtherDepartmentMajor(m), false, m);
    for (const m of ['Mathematics', 'Electrical Engineering', 'Applied & Computational Mathematics & Statistics', 'Finance']) assert.equal(isOtherDepartmentMajor(m), true, m);
    assert.deepEqual(readBackgroundFromNdTerms([T('spring', 2024, 'undergraduate', 'Computer'), T('fall', 2024, 'graduate', CSE)]).answer, {});
    assert.deepEqual(readBackgroundFromNdTerms([T('fall', 2021, 'graduate', 'Good Standing'), T('fall', 2022, 'graduate', CSE)]).answer, {});
  });
  it('two transcripts that disagree about a part neither the student answered: the part is asked', () => {
    const s = phdStudent();
    mergeReading(s, readBackgroundFromPriorBachelors('Purdue University'));
    assert.equal(s.backgroundDraft?.bachelors, 'elsewhere');
    assert.equal(mergeReading(s, readBackgroundFromNdTerms([T('spring', 2024, 'undergraduate', 'Computer Engineering'), T('fall', 2024, 'graduate', CSE)])), 'disagree');
    assert.equal(s.backgroundDraft?.bachelors, undefined);
    assert.equal(s.backgroundRead?.bachelors, undefined);
  });
  it('a part the student answered stays theirs', () => {
    const s = phdStudent();
    answerBackground(s, { bachelors: 'elsewhere' });
    assert.equal(mergeReading(s, readBackgroundFromNdTerms([T('spring', 2024, 'undergraduate', 'Computer Engineering')])), false);
    assert.equal(s.backgroundDraft?.bachelors, 'elsewhere');
  });
});

// Blue/red-team review of Option 1 (2026-10-08): transcripts of every kind.
import { forgetReadings, sameUniversityReading } from '../src/ui/background-read.ts';
import { parseExternalTranscript } from '../src/transcript/external.ts';
import { looksLikeNotreDameTranscript } from '../src/transcript/nd-markers.ts';
import { isNotreDameInstitution } from '../src/data/external.ts';
import { inferEntryTerm } from '../src/transcript/parse.ts';
import { derivePriorMs } from '../src/ui/prior-nd.ts';

describe('blue/red-team review: what a transcript may and may not be read as', () => {
  it('placeholder majors name no department; abbreviated CSE majors are CSE', () => {
    for (const m of ['Undeclared', 'Non-Degree Seeking', 'Graduate Non-Degree', 'Unclassified', 'Visiting Student', 'Exchange']) assert.equal(isOtherDepartmentMajor(m), false, m);
    for (const m of ['Computer Sci & Engr', 'Comp Science', 'CSE', 'Computer Engr']) assert.equal(isCseMajor(m), true, m);
    assert.deepEqual(readBackgroundFromNdTerms([T('spring', 2024, 'undergraduate', 'Undeclared'), T('fall', 2024, 'graduate', CSE)]).answer, {});
    assert.deepEqual(readBackgroundFromNdTerms([T('fall', 2021, 'graduate', 'Non-Degree Seeking'), T('fall', 2022, 'graduate', CSE)]).answer, {});
  });
  it('the department is the LAST undergraduate term’s major — an unread last major reads nothing', () => {
    const r = readBackgroundFromNdTerms([T('fall', 2020, 'undergraduate', 'Mathematics'), { term: { season: 'spring', year: 2024 }, level: 'undergraduate' }, T('fall', 2024, 'graduate', CSE)]);
    assert.deepEqual(r.answer, {});
  });
  it('another department’s graduate terms before a CSE term still in progress', () => {
    const r = readBackgroundFromNdTerms([T('fall', 2024, 'graduate', 'Electrical Engineering'), T('spring', 2025, 'graduate', 'Electrical Engineering'), T('fall', 2025, undefined, CSE)]);
    assert.equal(r.answer.graduate, 'nd-other');
  });
  it('“same university?” is not decided for names that nest', () => {
    assert.equal(sameUniversityReading('Purdue University', 'PURDUE UNIVERSITY'), true);
    assert.equal(sameUniversityReading('Purdue University', 'Purdue University Fort Wayne'), undefined);
    assert.equal(sameUniversityReading('Indiana University', 'Indiana University of Pennsylvania'), undefined);
    assert.equal(sameUniversityReading('Purdue University', 'University of Michigan'), false);
  });
  it('a Notre Dame bachelor’s with a master’s elsewhere: not the same university; one B.S. + M.S. transcript: the same', () => {
    assert.equal(readBackgroundFromPriorGraduate({ slot: 'masters', university: 'Purdue University', bachelorsAtNotreDame: true }).answer.samePlace, false);
    const both = readBackgroundFromPriorGraduate({ slot: 'masters', university: 'Purdue University', conferred: true, bachelorsOnThisTranscript: true });
    assert.deepEqual(both.answer, { graduate: 'elsewhere', finished: true, bachelors: 'elsewhere', samePlace: true });
    // A bachelor's transcript added after the master's.
    assert.equal(readBackgroundFromPriorBachelors('Purdue University', 'Purdue University').answer.samePlace, true);
  });
  it('a contradiction clears the graduate answer AND what was read for it', () => {
    const s = phdStudent({ backgroundDraft: { bachelors: 'elsewhere' } });
    mergeReading(s, readBackgroundFromPriorGraduate({ slot: 'masters', university: 'Purdue University', conferred: true }));
    assert.equal(s.backgroundDraft?.finished, true);
    assert.equal(mergeReading(s, readBackgroundFromNdTerms([T('fall', 2021, 'graduate', 'Electrical Engineering'), T('fall', 2022, 'graduate', CSE)])), 'disagree');
    assert.equal(s.backgroundDraft?.graduate, undefined);
    assert.equal(s.backgroundDraft?.finished, undefined, 'the cleared degree’s “finished” must not answer the next question');
  });
  it('changing the graduate answer drops the follow-ups read for the old one', () => {
    const s = phdStudent({ backgroundDraft: { bachelors: 'elsewhere' } });
    mergeReading(s, readBackgroundFromPriorGraduate({ slot: 'masters', university: 'Purdue University', conferred: true }));
    answerBackground(s, { ...s.backgroundDraft, graduate: 'nd-other' });
    assert.equal(s.backgroundDraft?.finished, undefined);
    assert.equal(s.background, undefined, 'another department asks “finished” afresh');
  });
  it('removing an import forgets what it read; the student’s own answers stay', () => {
    const s = phdStudent();
    mergeReading(s, readBackgroundFromNdTerms([T('spring', 2024, 'undergraduate', 'Computer Engineering'), T('fall', 2024, 'graduate', CSE)]));
    answerBackground(s, { ...s.backgroundDraft, graduate: 'none' });
    assert.equal(s.background, undefined, 'the 4+1 question is still open');
    forgetReadings(s, 'nd');
    assert.deepEqual(s.backgroundDraft, { graduate: 'none' });
    assert.equal(mergeReading(s, readBackgroundFromNdTerms([T('spring', 2024, 'undergraduate', 'Mathematics')])), 'filled', 'a replacement is read afresh, not a disagreement');
  });
  it('while a draft, prior study follows its “finished” for an earlier program', () => {
    const s = phdStudent({ backgroundDraft: { graduate: 'elsewhere', finished: false } });
    derivePriorMs(s);
    assert.equal(s.priorMs, 'unfinished');
    s.backgroundDraft = { graduate: 'elsewhere', finished: true };
    derivePriorMs(s);
    assert.equal(s.priorMs, 'completed');
  });
  it('a conferral is a past award, not the level word “Graduate” nor a forecast', () => {
    const base = ['Purdue University', 'Office of the Registrar', 'Official Transcript', '', 'Fall 2023', 'CS 50300   Operating Systems                 3.0   A', 'CS 59000   Special Topics in Systems         3.0   A-', '', 'Spring 2024', 'CS 58000   Algorithm Design                  3.0   B+', '', 'Cumulative GPA: 3.83'];
    for (const line of ['Program: Master of Science   Level: Graduate', 'Anticipated Completion: Master of Science, May 2027', 'Degree Sought: Master of Science', 'Master of Science — Expected Graduation May 2027']) {
      assert.notEqual(parseExternalTranscript([...base, line]).degreeConferred, true, line);
    }
    assert.equal(parseExternalTranscript([...base, 'Master of Science in Computer Science — Conferred: May 2024']).degreeConferred, true);
    assert.equal(parseExternalTranscript([...base, 'Master of Science   Graduated   May 2024']).degreeConferred, true);
  });
  it('other universities named Notre Dame are not Notre Dame', () => {
    assert.equal(looksLikeNotreDameTranscript('The University of Notre Dame Australia\nAcademic Transcript'), false);
    assert.equal(looksLikeNotreDameTranscript('Notre Dame of Maryland University\nOfficial Transcript'), false);
    assert.equal(looksLikeNotreDameTranscript('University of Notre Dame   College of Engineering'), true);
    assert.equal(isNotreDameInstitution('Notre Dame de Namur University'), false);
    assert.equal(isNotreDameInstitution('University of Notre Dame'), true);
  });
});

describe('the entry term from insideND’s term levels and majors (blue/red-team review)', () => {
  const nd = (season: Term['season'], year: number, level: 'graduate' | 'undergraduate') => ({ courseId: 'CSE 60111', title: 'X', credits: 3, grade: 'A', origin: 'nd', level, term: { season, year } }) as never;
  it('a 4+1: the first graduate term, not the senior term with a graduate course', () => {
    const e = inferEntryTerm({
      courses: [nd('spring', 2024, 'graduate'), nd('fall', 2024, 'graduate')],
      admitTerms: [],
      newStudentTerms: new Set(),
      degreesAwarded: [],
      terms: [T('fall', 2023, 'undergraduate', 'Computer Engineering'), T('spring', 2024, 'undergraduate', 'Computer Engineering'), T('fall', 2024, 'graduate', CSE)],
    });
    assert.deepEqual(e?.term, { season: 'fall', year: 2024 });
  });
  it('another department’s graduate terms first: the first CSE graduate term', () => {
    const e = inferEntryTerm({
      courses: [nd('fall', 2021, 'graduate'), nd('fall', 2022, 'graduate')],
      admitTerms: [],
      newStudentTerms: new Set(),
      degreesAwarded: [],
      terms: [T('fall', 2021, 'graduate', 'Electrical Engineering'), T('fall', 2022, 'graduate', CSE)],
    });
    assert.deepEqual(e?.term, { season: 'fall', year: 2022 });
    assert.match(e?.how ?? '', /Electrical Engineering before it are another program/);
    // The other program's first term is the other reading (UI review item 11; DGS 2026-10-09: option (b)).
    assert.deepEqual(e?.alternative?.term, { season: 'fall', year: 2021 });
    assert.equal(e?.alternative?.otherProgram, true);
    assert.match(e?.alternative?.why ?? '', /graduate terms in Electrical Engineering from Fall 2021.*keeps the earlier clock \(DGS Handbook §3\.15\)/);
  });
  it('only undergraduate terms: nothing is read', () => {
    const e = inferEntryTerm({ courses: [nd('fall', 2023, 'undergraduate')], admitTerms: [], newStudentTerms: new Set(), degreesAwarded: [], terms: [T('fall', 2023, 'undergraduate', 'Computer Engineering')] });
    assert.equal(e, undefined);
  });
});

import { parseTranscript } from '../src/transcript/parse.ts';
import { bachelorsAwardRead } from '../src/ui/nd-upload.ts';

describe('insideND College / Major rows at the edges (blue/red-team review)', () => {
  const lines = (valueRow: string, between: string[] = []) => [
    'University of Notre Dame',
    'Unofficial Academic Transcript',
    'Term: Spring Semester 2024',
    'College   Major   Academic Standing',
    ...between,
    valueRow,
    'CSE 40113   Main   UG   Algorithms   A   3.000   12.000',
    'Term Totals (Undergraduate)   Attempt Hours   Passed Hours',
    'Term: Fall Semester 2024',
    'College   Major   Academic Standing',
    'College of Engineering   Computer Science & Engineering   Good Standing',
    'CSE 60111   Main   GR   Complexity   A   3.000   12.000',
    'Term Totals (Graduate)   Attempt Hours   Passed Hours',
  ];
  const majorOf = (ls: string[]) => parseTranscript(ls).terms?.find((t) => t.term.year === 2024 && t.term.season === 'spring')?.major;
  it('a blank standing keeps the major', () => assert.equal(majorOf(lines('College of Engineering   Computer Engineering')), 'Computer Engineering'));
  it('a blank major beside the standing reads no major', () => assert.equal(majorOf(lines('College of Engineering   Good Standing')), undefined));
  it('a page break between the header and its values', () =>
    assert.equal(majorOf(lines('College of Engineering   Computer Engineering   Good Standing', ['', 'Page 1 of 2', 'https://inside.nd.edu/transcript', 'University of Notre Dame'])), 'Computer Engineering'));
  it('the bachelor’s award term: the last undergraduate term, when graduate terms follow', () => {
    const p = parseTranscript(lines('College of Engineering   Computer Engineering   Good Standing'));
    assert.deepEqual(bachelorsAwardRead(p.degreesAwarded, p.terms)?.term, { season: 'spring', year: 2024 });
    assert.equal(bachelorsAwardRead([], [T('spring', 2024, 'undergraduate', 'Computer Engineering')]), undefined, 'no graduate term after it: not read');
  });
});

import { earlierDegreesState, restoreEarlierDegrees } from '../src/ui/background-read.ts';

describe('coverage review: Undo, and the emails with a draft “No”', () => {
  it('Undo after Remove puts the readings back', () => {
    const s = phdStudent();
    mergeReading(s, readBackgroundFromNdTerms([T('spring', 2024, 'undergraduate', 'Mathematics'), T('fall', 2024, 'graduate', CSE)]));
    const before = earlierDegreesState(s);
    forgetReadings(s, 'nd');
    assert.equal(s.backgroundDraft, undefined);
    restoreEarlierDegrees(s, before);
    assert.deepEqual(s.backgroundDraft, { bachelors: 'nd-other' });
    assert.ok(s.backgroundRead?.bachelors);
    assert.equal(s.backgroundReadFrom?.bachelors, 'nd');
  });
  it('a draft “No” to a graduate degree is not “not answered yet”', () => {
    assert.notEqual(priorStudyLabel(phdStudent({ backgroundDraft: { graduate: 'none' } })), 'not answered yet');
  });
});

describe('a browser print header at the page break (coverage of blue-layout-03)', () => {
  it('“10/8/26, 3:12 AM   Academic Transcript” between the header and its values', () => {
    const p = parseTranscript(['University of Notre Dame', 'Unofficial Academic Transcript', 'Term: Spring Semester 2024', 'College   Major   Academic Standing', 'https://inside.nd.edu/student/academic-transcript   1/3', '', '10/8/26, 3:12 AM   Academic Transcript', 'College of Engineering   Computer Engineering   Good Standing', 'CSE 40113   Main   UG   Algorithms   A   3.000   12.000', 'Term Totals (Undergraduate)   Attempt Hours']);
    assert.equal(p.terms?.[0]?.major, 'Computer Engineering');
  });
});
