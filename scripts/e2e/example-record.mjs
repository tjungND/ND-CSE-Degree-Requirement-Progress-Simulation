// The record "Load example" used to put on the page, kept for the e2e (DGS
// 2026-10-17: "remove 'Load example' button and the function"). The drivers
// load it as a saved file through the page's own "Load a file", so every
// check written against the example student reads the same record: one
// mid-degree record per program, built from courses the sheet carries,
// dated against today (src/ui/example.ts until 2026-10-17, without its
// `isExample` / `fromExample` markers — a file the student loads is theirs).
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Today on this machine, as the page reads it (YYYY-MM-DD, local time). */
export function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The record, a year into the degree on `todayIso`: the finished courses
 * sit in terms that have finished, the rest are in progress. */
export function exampleRecord(program, todayIso = localToday()) {
  const thisYear = Number(todayIso.slice(0, 4));
  const lastYear = thisYear - 1;
  const term = (season, year) => ({ season, year });
  const common = {
    schemaVersion: 1,
    entryTerm: term('fall', lastYear),
    bachelorsAwarded: term('spring', lastYear),
    priorMs: 'none',
    background: { bachelors: 'elsewhere', graduate: 'none' },
    milestones: { advisorIdentified: '2026-09-10', advisorName: 'Prof. Example', advisorTtt: 'yes' },
    attestations: { advisorApprovedPlan: true },
  };
  const nd = (courseId, title, credits, t, grade, extra = {}) => ({ courseId, title, credits, term: t, grade, origin: 'nd', ...extra });
  if (program === 'mscse') {
    return {
      ...common,
      program: 'mscse',
      msOption: 'project',
      gpa: 3.6,
      courses: [
        nd('CSE 60641', 'Graduate Operating Systems', 3, term('fall', lastYear), 'A'),
        nd('CSE 60535', 'Computer Vision', 3, term('fall', lastYear), 'A-'),
        nd('CSE 40113', 'Design/Analysis of Algorithms', 3, term('fall', lastYear), 'B+', { dgsApproved: true }),
        nd('CSE 60770', 'Secure Software Engineering', 3, term('spring', thisYear), 'A'),
        nd('CSE 60424', 'Graduate Human Computer Interaction', 3, term('spring', thisYear), 'B+'),
        nd('CSE 40166', 'Computer Graphics', 3, term('spring', thisYear), 'B', { dgsApproved: true }),
        nd('CSE 60625', 'Advanced Topics in Machine Learning', 3, term('fall', thisYear), 'IP'),
        nd('CSE 68902', 'Thesis Project', 6, term('fall', thisYear), 'IP'),
      ],
    };
  }
  return {
    ...common,
    program: 'phd',
    gpa: 3.5,
    courses: [
      nd('CSE 60641', 'Graduate Operating Systems', 3, term('fall', lastYear), 'A'),
      nd('CSE 63801', 'Research Seminar I', 1, term('fall', lastYear), 'S'),
      nd('CSE 60111', 'Complexity and Algorithms', 3, term('spring', thisYear), 'B-'),
      nd('CSE 60321', 'Advanced Computer Architecture', 3, term('spring', thisYear), 'B+'),
      nd('CSE 63802', 'Research Seminar II', 1, term('spring', thisYear), 'S'),
      nd('CSE 60770', 'Secure Software Engineering', 3, term('fall', thisYear), 'IP'),
      nd('CSE 60876', 'Research Methods', 3, term('spring', thisYear + 1), 'IP', { assignedGroup: 'dsai' }),
      nd('CSE 98900', 'Research and Dissertation', 6, term('spring', thisYear + 1), 'IP'),
    ],
  };
}

/** Put the record on the page through "Load a file" (the storage card's
 * file input), as a student loading a saved file would, and wait for it. */
export async function loadExampleRecord(s, program = 'phd', record = exampleRecord(program)) {
  const file = join(tmpdir(), `cse-degree-audit-e2e-example-${program}.json`);
  writeFileSync(file, JSON.stringify({ savedAt: new Date().toISOString(), student: record }));
  await s.setFileInput('[data-key="save.fileinput"]', file);
  await s.waitFor(`document.querySelectorAll('table.courses tr').length > 3 && document.querySelector('.program-name')?.textContent.includes('${program === 'mscse' ? 'M.S.' : 'Ph.D.'}')`);
  await s.settle?.(300);
  // Loading a file finishes no step: nothing is highlighted (DGS 2026-10-17, next-step.ts).
  if (await s.evalJs(`document.querySelectorAll('.next-step-ring').length > 0`)) throw new Error('loading a file must highlight nothing');
}
