// The Notre Dame programs on every copied email (DGS 2026-09-28: "need all ND
// programs and their entry terms including transfer"). src/ui/program-history.ts.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CourseEntry, Student } from '../src/engine/types.ts';
import { audit } from '../src/engine/audit.ts';
import { advisorSummary } from '../src/ui/advisor-summary.ts';
import { gradAdminRequest } from '../src/ui/grad-admin-request.ts';
import { priorStudyLabel, programHistory } from '../src/ui/program-history.ts';
import { buildRules } from './helpers.ts';
import { phdStudent } from './helpers/student.ts';

const nd = (courseId: string, level: 'bachelors' | 'masters', season: 'fall' | 'spring', year: number): CourseEntry => ({
  courseId, credits: 3, term: { season, year }, grade: 'A', origin: 'transfer', institution: 'University of Notre Dame', degreeLevel: level,
});
const student = (extra: Partial<Student>): Student => phdStudent({ entryTerm: { season: 'fall', year: 2025 }, ...extra });

describe('programHistory', () => {
  it('only the current program: the subject reads as before, and no earlier-programs sentence', () => {
    const h = programHistory(student({ background: { bachelors: 'elsewhere', graduate: 'none' } }));
    assert.equal(h.compact, 'Ph.D., entered Fall 2025');
    assert.equal(h.earlier, '');
    assert.equal(programHistory(student({ background: undefined })).compact, 'Ph.D., entered Fall 2025', 'no answer yet: nothing invented');
    assert.equal(programHistory({ ...student({}), program: 'mscse' }).compact, 'M.S. in CSE, entered Fall 2025');
  });

  it('a transfer from the MSCSE: the entry term is the MSCSE’s, the transfer term is named — or said to be missing', () => {
    const h = programHistory(student({ entryTerm: { season: 'fall', year: 2023 }, background: { bachelors: 'elsewhere', graduate: 'nd-mscse-transfer', transferredTerm: { season: 'spring', year: 2025 } } }));
    assert.equal(h.compact, 'Ph.D. (transferred Spring 2025 from the Notre Dame MSCSE, entered Fall 2023)');
    assert.equal(h.earlier, '');
    const missing = programHistory(student({ entryTerm: { season: 'fall', year: 2023 }, background: { bachelors: 'elsewhere', graduate: 'nd-mscse-transfer' } }));
    assert.equal(missing.compact, 'Ph.D. (transferred term not entered from the Notre Dame MSCSE, entered Fall 2023)');
  });

  it('an MSCSE held at Notre Dame: its span from the prior coursework and its award term', () => {
    const s = student({
      background: { bachelors: 'elsewhere', graduate: 'nd-mscse' },
      ndMasters: { term: { season: 'spring', year: 2025 } },
      courses: [nd('CSE 60641', 'masters', 'fall', 2023), nd('CSE 60111', 'masters', 'spring', 2024)],
    });
    const h = programHistory(s);
    assert.equal(h.compact, 'Ph.D., entered Fall 2025; MSCSE at Notre Dame, Fall 2023–Spring 2025');
    assert.equal(h.earlier, 'Earlier Notre Dame programs: MSCSE at Notre Dame, Fall 2023–Spring 2025.');
    // Only the award known (no prior coursework entered yet): "awarded".
    assert.equal(programHistory({ ...s, courses: [] }).compact, 'Ph.D., entered Fall 2025; MSCSE at Notre Dame, awarded Spring 2025');
    // Only the coursework known: "from".
    assert.equal(programHistory({ ...s, ndMasters: {}, courses: [nd('CSE 60641', 'masters', 'fall', 2023)] }).compact, 'Ph.D., entered Fall 2025; MSCSE at Notre Dame, from Fall 2023');
    // Nothing dated: the program alone.
    assert.equal(programHistory({ ...s, ndMasters: {}, courses: [] }).compact, 'Ph.D., entered Fall 2025; MSCSE at Notre Dame');
    // The conferral the transcript recorded stands in for a missing ndMasters term.
    assert.equal(programHistory({ ...s, ndMasters: {}, courses: [], ndDegrees: [{ level: 'masters', date: '2025-05-17' }] }).compact, 'Ph.D., entered Fall 2025; MSCSE at Notre Dame, awarded Spring 2025');
  });

  it('a 4+1 and a Notre Dame bachelor’s: both programs, the bachelor’s from its coursework to its award', () => {
    const s = student({
      background: { bachelors: 'nd-cse', graduate: 'nd-4plus1' },
      bachelorsAwarded: { season: 'spring', year: 2024 },
      ndMasters: { term: { season: 'spring', year: 2025 } },
      courses: [nd('CSE 20311', 'bachelors', 'fall', 2020), nd('CSE 30321', 'bachelors', 'spring', 2023), nd('CSE 60641', 'masters', 'fall', 2024)],
    });
    assert.equal(programHistory(s).compact, 'Ph.D., entered Fall 2025; MSCSE at Notre Dame (Integrated 4+1), Fall 2024–Spring 2025; B.S. at Notre Dame CSE, Fall 2020–Spring 2024');
    assert.equal(programHistory(s).earlier, 'Earlier Notre Dame programs: MSCSE at Notre Dame (Integrated 4+1), Fall 2024–Spring 2025; B.S. at Notre Dame CSE, Fall 2020–Spring 2024.');
    // A bachelor's known only as "before Fall 2024" has no award term.
    const before = programHistory({ ...s, background: { bachelors: 'nd-other', graduate: 'none' }, courses: [], bachelorsAwardedInferred: { how: 'x', before: { season: 'fall', year: 2024 } } });
    assert.equal(before.compact, 'Ph.D., entered Fall 2025; B.S. at Notre Dame (another department)');
  });

  it('an MSCSE student in the Integrated program, and a graduate degree in another Notre Dame department', () => {
    const ms = programHistory({ ...student({ background: { bachelors: 'nd-cse', ndIntegrated: true, graduate: 'none' }, bachelorsAwarded: { season: 'spring', year: 2025 } }), program: 'mscse' });
    assert.equal(ms.compact, 'M.S. in CSE, entered Fall 2025; B.S. at Notre Dame CSE (Integrated 4+1), awarded Spring 2025');
    // By whether it was finished — Academic Code §4.6's fact (policy review round 3, P3-emails-6).
    const other = (finished?: boolean) => programHistory(student({ background: { bachelors: 'elsewhere', graduate: 'nd-other', ...(finished !== undefined ? { finished } : {}) } })).compact;
    assert.equal(other(true), 'Ph.D., entered Fall 2025; a graduate degree at Notre Dame (another department)');
    assert.equal(other(false), 'Ph.D., entered Fall 2025; a graduate program at Notre Dame (another department), not finished');
    assert.equal(other(), 'Ph.D., entered Fall 2025; a graduate program at Notre Dame (another department)');
  });
});

// The emails' "Prior graduate study" line (policy review round 3,
// P3-prior-programs-6): a Ph.D. student holding the Notre Dame MSCSE holds a
// graduate degree, though its courses count as one program with the Ph.D.
describe('the emails’ prior graduate study (P3-prior-programs-6)', () => {
  it('the Notre Dame MSCSE, regular or 4+1: named, not “No prior graduate degree”', () => {
    for (const graduate of ['nd-mscse', 'nd-4plus1'] as const) {
      const s = student({ background: { bachelors: 'elsewhere', graduate } });
      assert.equal(s.priorMs, 'none', 'the §5.2 cap’s value is unchanged');
      assert.equal(priorStudyLabel(s), 'MSCSE at Notre Dame (one graduate program with the Ph.D.); no graduate degree elsewhere');
      const report = audit(s, buildRules(), '2026-10-07');
      const opts = { todayIso: '2026-10-07', entryTerm: 'Fall 2025', priorStudy: priorStudyLabel(s), history: programHistory(s) };
      for (const text of [advisorSummary(report, opts).text, gradAdminRequest(report, s, buildRules(), opts).text]) {
        assert.doesNotMatch(text, /No prior graduate degree/);
        assert.match(text, /MSCSE at Notre Dame \(one graduate program with the Ph\.D\.\); no graduate degree elsewhere/);
      }
    }
  });
  it('everyone else: the three values as before', () => {
    assert.equal(priorStudyLabel(student({ background: { bachelors: 'elsewhere', graduate: 'none' } })), 'No prior graduate degree');
    assert.equal(priorStudyLabel(student({ background: { bachelors: 'elsewhere', graduate: 'nd-mscse-transfer' } })), 'No prior graduate degree');
    assert.equal(priorStudyLabel({ ...student({}), priorMs: 'completed' }), 'Completed prior M.S. or Ph.D.');
  });
});

// An unfinished Ph.D. elsewhere is not a "Prior M.S." (policy review round 4,
// P4-transfer-4; DGS 2026-10-12): the emails' label names it.
describe('the prior-study label for an unfinished Ph.D. (P4-transfer-4)', () => {
  it('names the Ph.D.; an unfinished master’s keeps its label', async () => {
    const { priorStudyLabel, unfinishedPhdElsewhere } = await import('../src/ui/program-history.ts');
    const { phdStudent, transferCourse } = await import('./helpers/student.ts');
    const phd = phdStudent({ priorMs: 'unfinished', background: { bachelors: 'elsewhere', graduate: 'elsewhere', finished: false }, courses: [transferCourse('CS 50300', undefined, { degreeLevel: 'phd' })] });
    assert.equal(unfinishedPhdElsewhere(phd), true);
    assert.equal(priorStudyLabel(phd), 'Prior Ph.D., not completed');
    const ms = phdStudent({ priorMs: 'unfinished', background: { bachelors: 'elsewhere', graduate: 'elsewhere', finished: false }, courses: [transferCourse('CS 50300', undefined, { degreeLevel: 'masters' })] });
    assert.equal(priorStudyLabel(ms), 'Prior M.S., not completed');
  });
});
