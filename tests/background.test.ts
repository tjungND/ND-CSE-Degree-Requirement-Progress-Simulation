// The earlier-degrees questions (DGS 2026-09-22): which transcript rows each answer needs.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applyBackground, completeBackground, describeBackground, graduateOptions, graduateOptionsFor, priorSlotsFor, priorSlotsForDraft, type Background } from '../src/ui/background.ts';
import type { Program } from '../src/engine/types.ts';
import { validateStudent } from '../src/ui/state.ts';
import { phdStudent } from './helpers/student.ts';

describe('earlier degrees → previous-transcript rows (DGS 2026-09-22)', () => {
  it('a bachelor’s elsewhere and no graduate degree: the Undergraduate row', () => {
    assert.deepEqual(priorSlotsFor({ bachelors: 'elsewhere', graduate: 'none' }, 'phd'), ['bachelors']);
  });
  it('a bachelor’s and a graduate degree elsewhere, different universities: all three rows', () => {
    assert.deepEqual(priorSlotsFor({ bachelors: 'elsewhere', graduate: 'elsewhere', samePlace: false }, 'phd'), ['bachelors', 'masters', 'phd']);
  });
  it('a 4+1 elsewhere: every row too — it may come as one transcript or two; the fold opens to say which row takes which', () => {
    assert.deepEqual(priorSlotsFor({ bachelors: 'elsewhere', graduate: 'elsewhere', samePlace: true }, 'phd'), ['bachelors', 'masters', 'phd']);
  });
  it('a Notre Dame bachelor’s (CSE or another department) and no or a Notre Dame graduate degree: no previous row at all', () => {
    assert.deepEqual(priorSlotsFor({ bachelors: 'nd-cse', graduate: 'none' }, 'phd'), []);
    assert.deepEqual(priorSlotsFor({ bachelors: 'nd-other', graduate: 'nd-mscse' }, 'phd'), []);
    assert.deepEqual(priorSlotsFor({ bachelors: 'nd-cse', graduate: 'nd-other' }, 'phd'), []);
  });
  it('a Notre Dame bachelor’s and a graduate degree elsewhere: the Master’s and Ph.D. rows', () => {
    assert.deepEqual(priorSlotsFor({ bachelors: 'nd-cse', graduate: 'elsewhere', samePlace: false }, 'phd'), ['masters', 'phd']);
  });
  it('the MSCSE has no Undergraduate row, whatever the answer (DGS 2026-10-27)', () => {
    assert.deepEqual(priorSlotsFor({ bachelors: 'elsewhere', graduate: 'none' }, 'mscse'), []);
    assert.deepEqual(priorSlotsFor({ bachelors: 'elsewhere', graduate: 'elsewhere', samePlace: true }, 'mscse'), ['masters', 'phd']);
    assert.deepEqual(priorSlotsFor(undefined, 'mscse'), ['masters', 'phd']);
    assert.deepEqual(priorSlotsForDraft({ bachelors: 'elsewhere' }, 'mscse'), ['masters', 'phd']);
    assert.deepEqual(priorSlotsForDraft(undefined, 'mscse'), ['masters', 'phd']);
  });
  it('no answer yet: every row, as before the questions', () => {
    assert.deepEqual(priorSlotsFor(undefined, 'phd'), ['bachelors', 'masters', 'phd']);
  });
  it('a transfer from the MSCSE keeps its transfer term when given, and is complete without it (DGS 2026-09-28)', () => {
    assert.deepEqual(completeBackground({ bachelors: 'elsewhere', graduate: 'nd-mscse-transfer', transferredTerm: { season: 'spring', year: 2025 }, alsoElsewhere: false }, 'phd'), { bachelors: 'elsewhere', graduate: 'nd-mscse-transfer', transferredTerm: { season: 'spring', year: 2025 }, alsoElsewhere: false });
    assert.deepEqual(completeBackground({ bachelors: 'elsewhere', graduate: 'nd-mscse-transfer', alsoElsewhere: false }, 'phd'), { bachelors: 'elsewhere', graduate: 'nd-mscse-transfer', alsoElsewhere: false });
    assert.deepEqual(completeBackground({ bachelors: 'elsewhere', graduate: 'nd-mscse', transferredTerm: { season: 'spring', year: 2025 }, alsoElsewhere: false }, 'phd'), { bachelors: 'elsewhere', graduate: 'nd-mscse', alsoElsewhere: false }, 'a term left over from another answer is dropped');
  });

  it('an answer is complete only when every question that applies is answered', () => {
    assert.equal(completeBackground({ bachelors: 'elsewhere' }, 'phd'), undefined);
    assert.equal(completeBackground({ bachelors: 'elsewhere', graduate: 'elsewhere', samePlace: true }, 'phd'), undefined, 'finished? still open');
    assert.deepEqual(completeBackground({ bachelors: 'elsewhere', graduate: 'elsewhere', samePlace: true, finished: false }, 'phd'), { bachelors: 'elsewhere', graduate: 'elsewhere', samePlace: true, finished: false });
    // A Notre Dame CSE bachelor's is asked about the 4+1 on BOTH tabs since 2026-10-03 (a Ph.D. student's undergraduate 60000-level courses count only through it).
    assert.equal(completeBackground({ bachelors: 'nd-cse', graduate: 'none', samePlace: true }, 'phd'), undefined, '4+1? still open');
    assert.deepEqual(completeBackground({ bachelors: 'nd-cse', ndIntegrated: false, graduate: 'none', samePlace: true }, 'phd'), { bachelors: 'nd-cse', ndIntegrated: false, graduate: 'none' });
    // An MSCSE student with a Notre Dame CSE bachelor's is asked about the 4+1; one cannot already hold the MSCSE.
    assert.equal(completeBackground({ bachelors: 'nd-cse', graduate: 'none' }, 'mscse'), undefined);
    assert.deepEqual(completeBackground({ bachelors: 'nd-cse', ndIntegrated: true, graduate: 'none' }, 'mscse'), { bachelors: 'nd-cse', ndIntegrated: true, graduate: 'none' });
    assert.equal(completeBackground({ bachelors: 'elsewhere', graduate: 'nd-mscse' }, 'mscse'), undefined);
  });
  it('a transfer from the MSCSE into the Ph.D. (DGS 2026-09-26) is a Ph.D.-only answer that settles no prior degree', () => {
    assert.ok(graduateOptions('phd').some(([v]) => v === 'nd-mscse-transfer'));
    assert.ok(!graduateOptions('mscse').some(([v]) => v === 'nd-mscse-transfer'));
    assert.equal(completeBackground({ bachelors: 'elsewhere', graduate: 'nd-mscse-transfer' }, 'mscse'), undefined);
    assert.deepEqual(completeBackground({ bachelors: 'nd-cse', ndIntegrated: true, graduate: 'nd-mscse-transfer', alsoElsewhere: false }, 'phd'), { bachelors: 'nd-cse', ndIntegrated: true, graduate: 'nd-mscse-transfer', alsoElsewhere: false });
    assert.deepEqual(priorSlotsFor({ bachelors: 'nd-cse', graduate: 'nd-mscse-transfer' }, 'phd'), []);
    const s = { ...phdStudent(), program: 'phd' as const };
    applyBackground(s, { bachelors: 'nd-cse', graduate: 'nd-mscse-transfer', alsoElsewhere: false });
    assert.equal(s.priorMs, 'none');
    assert.equal(s.ndMasters, undefined);
    assert.equal(s.integratedBsMs, false);
  });
  // Policy review round 3, P3-prior-programs-2 (DGS 2026-10-07: option (a)):
  // the transfer answer asks about a degree elsewhere too, and "Did you finish
  // it?" after a yes. It used to record no earlier program at all (a 6-credit
  // meter, every outside course held as "taken outside any degree program").
  it('a transfer from the MSCSE beside a degree elsewhere: asked, and it sets the §5.2 cap (P3-prior-programs-2)', () => {
    assert.equal(completeBackground({ bachelors: 'elsewhere', graduate: 'nd-mscse-transfer' }, 'phd'), undefined, 'the other-university question is still open');
    assert.equal(completeBackground({ bachelors: 'elsewhere', graduate: 'nd-mscse-transfer', alsoElsewhere: true }, 'phd'), undefined, 'finished? still open');
    const done = completeBackground({ bachelors: 'elsewhere', graduate: 'nd-mscse-transfer', transferredTerm: { season: 'fall', year: 2024 }, alsoElsewhere: true, finished: true }, 'phd');
    assert.deepEqual(done, { bachelors: 'elsewhere', graduate: 'nd-mscse-transfer', transferredTerm: { season: 'fall', year: 2024 }, alsoElsewhere: true, finished: true });
    assert.deepEqual(completeBackground({ bachelors: 'elsewhere', graduate: 'nd-mscse-transfer', alsoElsewhere: false, finished: true }, 'phd'), { bachelors: 'elsewhere', graduate: 'nd-mscse-transfer', alsoElsewhere: false }, 'a finished answer left over from a yes is dropped');
    assert.deepEqual(priorSlotsFor(done, 'phd'), ['bachelors', 'masters', 'phd']);
    assert.deepEqual(priorSlotsFor({ bachelors: 'nd-cse', graduate: 'nd-mscse-transfer', alsoElsewhere: true, finished: false }, 'phd'), ['masters', 'phd']);
    const s = { ...phdStudent(), program: 'phd' as const };
    applyBackground(s, done!);
    assert.equal(s.priorMs, 'completed');
    assert.equal(s.ndMasters, undefined, 'the MSCSE was not finished');
    applyBackground(s, { bachelors: 'elsewhere', graduate: 'nd-mscse-transfer', alsoElsewhere: true, finished: false });
    assert.equal(s.priorMs, 'unfinished');
    assert.match(describeBackground(done!), /Graduate degree before this program: finished, at another university; and transferred into the Ph\.D\. from the Notre Dame MSCSE in Fall 2024/);
    assert.match(describeBackground({ bachelors: 'elsewhere', graduate: 'nd-mscse-transfer', alsoElsewhere: false }), /Graduate degree before this program: none — transferred into the Ph\.D\. from the Notre Dame MSCSE/);
  });
  // P3-prior-programs-1 (DGS 2026-10-07: option (a)): the same follow-up under
  // the two MSCSE-held answers. The MSCSE stays the student's own (one
  // program with the Ph.D.); the degree elsewhere gets §5.2's 24 or 6.
  it('the MSCSE held, beside a degree elsewhere: asked, and it sets the §5.2 cap (P3-prior-programs-1)', () => {
    // The MSCSE through the 4+1 goes with a Notre Dame CSE bachelor's (DGS 2026-10-08).
    for (const graduate of ['nd-mscse', 'nd-4plus1'] as const) {
      const bachelors = graduate === 'nd-4plus1' ? 'nd-cse' : 'elsewhere';
      assert.equal(completeBackground({ bachelors, graduate }, 'phd'), undefined, `${graduate}: the other-university question is open`);
      const done = completeBackground({ bachelors, graduate, alsoElsewhere: true, finished: true }, 'phd')!;
      assert.deepEqual(done, { bachelors, ...(graduate === 'nd-4plus1' ? { ndIntegrated: true } : {}), graduate, alsoElsewhere: true, finished: true });
      assert.deepEqual(priorSlotsFor(done, 'phd'), bachelors === 'elsewhere' ? ['bachelors', 'masters', 'phd'] : ['masters', 'phd']);
      const s = { ...phdStudent(), program: 'phd' as const };
      applyBackground(s, done);
      assert.equal(s.priorMs, 'completed', graduate);
      assert.deepEqual(s.ndMasters, {}, `${graduate}: the MSCSE is still held`);
      assert.match(describeBackground(done), /, and a graduate degree at another university \(finished\)$/);
    }
    const s = { ...phdStudent(), program: 'phd' as const };
    applyBackground(s, { bachelors: 'elsewhere', graduate: 'nd-mscse', alsoElsewhere: false });
    assert.equal(s.priorMs, 'none');
    assert.deepEqual(priorSlotsFor({ bachelors: 'elsewhere', graduate: 'nd-mscse', alsoElsewhere: false }, 'phd'), ['bachelors']);
  });
  it('a saved file from before the question keeps its answer and reads as before', () => {
    const old = validateStudent({ ...phdStudent(), background: { bachelors: 'elsewhere', graduate: 'nd-mscse-transfer' } }, []);
    assert.deepEqual(old.background, { bachelors: 'elsewhere', graduate: 'nd-mscse-transfer' });
    const kept = validateStudent({ ...phdStudent(), background: { bachelors: 'elsewhere', graduate: 'nd-mscse-transfer', alsoElsewhere: true, finished: false } }, []);
    assert.deepEqual(kept.background, { bachelors: 'elsewhere', graduate: 'nd-mscse-transfer', alsoElsewhere: true, finished: false });
  });
  it('an answer settles the record’s prior-degree facts (the standing card’s controls, gone 2026-09-22)', () => {
    const base = phdStudent();
    const a = { ...base, program: 'phd' as const };
    applyBackground(a, { bachelors: 'elsewhere', graduate: 'elsewhere', samePlace: false, finished: true });
    assert.equal(a.priorMs, 'completed');
    assert.equal(a.ndMasters, undefined);
    assert.equal(a.integratedBsMs, false);
    const b = { ...base, program: 'phd' as const };
    applyBackground(b, { bachelors: 'nd-cse', graduate: 'nd-4plus1' });
    assert.deepEqual(b.ndMasters, {});
    assert.equal(b.integratedBsMs, true);
    assert.equal(b.priorMs, 'none');
    const c = { ...base, program: 'mscse' as const };
    applyBackground(c, { bachelors: 'nd-cse', ndIntegrated: true, graduate: 'none' });
    assert.equal(c.integratedBsMs, true);
    assert.equal(c.ndMasters, undefined);
  });
});

// DGS 2026-10-08: "If 'Yes' was chosen to 'are you ND CSE 4+1?', then the
// ineligible options in the 'Did you hold, or start, …' should become hidden.
// Similarly, if 'no' was chosen to the 4+1 question, the 'Yes I finished 4+1'
// option should be hidden. … if 'Another university' was chosen for 'Bachelor'
// question, the 'Yes I finished 4+1 at Notre Dame' should be hidden since
// Notre Dame does not accept students seeking a second bachelor's degree."
// …and, later that day: "show the most common/probable choices first. If
// someone started a degree program (4+1 or MS or PhD), the most common case is
// that they finished the program" — the orders below.
describe('graduate answers the other answers rule out are not offered, and the rest come most probable first (DGS 2026-10-08)', () => {
  const ids = (b: Partial<Background>, program: Program) => graduateOptionsFor(b, program).map(([v]) => v);
  const all = ['none', 'elsewhere', 'nd-mscse', 'nd-4plus1', 'nd-mscse-transfer', 'nd-other'];
  it('a bachelor’s from another university or another department: no MSCSE through the 4+1', () => {
    assert.deepEqual(ids({ bachelors: 'elsewhere' }, 'phd'), ['none', 'elsewhere', 'nd-mscse', 'nd-mscse-transfer', 'nd-other']);
    assert.deepEqual(ids({ bachelors: 'nd-other' }, 'phd'), ['none', 'nd-mscse', 'nd-mscse-transfer', 'elsewhere', 'nd-other']);
    assert.deepEqual(ids({}, 'phd'), all, 'nothing answered yet: every option');
  });
  it('Notre Dame CSE — “No” to the 4+1: no MSCSE through the 4+1; “Yes”: no MSCSE as a regular master’s student, the finished 4+1 first', () => {
    assert.deepEqual(ids({ bachelors: 'nd-cse' }, 'phd'), ['none', 'nd-4plus1', 'nd-mscse', 'nd-mscse-transfer', 'elsewhere', 'nd-other'], 'the 4+1 still open: every option, the Notre Dame ones first');
    assert.deepEqual(ids({ bachelors: 'nd-cse', ndIntegrated: false }, 'phd'), ['none', 'nd-mscse', 'nd-mscse-transfer', 'elsewhere', 'nd-other']);
    // …and no "No": the 4+1 is a graduate program started (DGS 2026-10-08, later).
    assert.deepEqual(ids({ bachelors: 'nd-cse', ndIntegrated: true }, 'phd'), ['nd-4plus1', 'nd-mscse-transfer', 'elsewhere', 'nd-other']);
  });
  it('choosing the MSCSE through the 4+1 answers the 4+1 question: the order and the hidden options stay (DGS 2026-10-08: they went back to the open-4+1 ones)', () => {
    assert.deepEqual(ids({ bachelors: 'nd-cse', graduate: 'nd-4plus1' }, 'phd'), ['nd-4plus1', 'nd-mscse-transfer', 'elsewhere', 'nd-other']);
    assert.deepEqual(ids({ bachelors: 'nd-cse', ndIntegrated: true, graduate: 'nd-4plus1' }, 'phd'), ['nd-4plus1', 'nd-mscse-transfer', 'elsewhere', 'nd-other']);
  });
  it('the finished degree comes before the unfinished one wherever both show', () => {
    for (const b of [{ bachelors: 'nd-cse' as const }, { bachelors: 'nd-cse' as const, ndIntegrated: true }, { bachelors: 'nd-cse' as const, ndIntegrated: false }, { bachelors: 'elsewhere' as const }, { bachelors: 'nd-other' as const }, {}]) {
      const o = ids(b, 'phd');
      const finished = Math.max(o.indexOf('nd-mscse'), o.indexOf('nd-4plus1'));
      assert.ok(finished >= 0 && finished < o.indexOf('nd-mscse-transfer'), JSON.stringify(b) + ' → ' + o.join(','));
    }
  });
  it('an MSCSE student in the 4+1 now was admitted as an undergraduate: no graduate degree came before this program', () => {
    assert.deepEqual(ids({ bachelors: 'nd-cse', ndIntegrated: true }, 'mscse'), ['none']);
    assert.deepEqual(ids({ bachelors: 'nd-cse', ndIntegrated: false }, 'mscse'), ['none', 'elsewhere', 'nd-other']);
    assert.deepEqual(ids({ bachelors: 'elsewhere' }, 'mscse'), ['none', 'elsewhere', 'nd-other']);
  });
  it('an answer the other answers rule out is not complete — a saved record or a draft a later answer contradicts waits for a new one', () => {
    assert.equal(completeBackground({ bachelors: 'elsewhere', graduate: 'nd-4plus1', alsoElsewhere: false }, 'phd'), undefined);
    assert.equal(completeBackground({ bachelors: 'nd-cse', ndIntegrated: false, graduate: 'nd-4plus1', alsoElsewhere: false }, 'phd'), undefined);
    assert.equal(completeBackground({ bachelors: 'nd-cse', ndIntegrated: true, graduate: 'nd-mscse', alsoElsewhere: false }, 'phd'), undefined);
    assert.equal(completeBackground({ bachelors: 'nd-cse', ndIntegrated: true, graduate: 'elsewhere', samePlace: false, finished: true }, 'mscse'), undefined);
    assert.deepEqual(completeBackground({ bachelors: 'nd-cse', graduate: 'nd-4plus1', alsoElsewhere: false }, 'phd'), { bachelors: 'nd-cse', ndIntegrated: true, graduate: 'nd-4plus1', alsoElsewhere: false }, 'the 4+1 answer fills the 4+1 question (a record saved before 2026-10-08)');
    assert.equal(completeBackground({ bachelors: 'nd-cse', ndIntegrated: true, graduate: 'none' }, 'phd'), undefined, 'a 4+1 who went into the Ph.D. without finishing the MSCSE transferred into it (DGS 2026-10-08)');
    assert.deepEqual(completeBackground({ bachelors: 'nd-cse', ndIntegrated: false, graduate: 'none' }, 'phd'), { bachelors: 'nd-cse', ndIntegrated: false, graduate: 'none' });
  });
});
