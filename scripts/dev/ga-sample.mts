// Print the Grad Admin request and the advisor summary for a scenario's
// student on a given day (dev aid, 2026-09-28; from a scenario file since
// "Load example" was removed, 2026-10-17):
//   node --experimental-strip-types scripts/dev/ga-sample.mts [tests/scenarios/<name>.json] [YYYY-MM-DD]
// The day defaults to the scenario's own `today`.
import { readFileSync } from 'node:fs';
import { rulesFromSnapshot } from '../../src/data/load.ts';
import { audit } from '../../src/engine/audit.ts';
import { termLabel } from '../../src/engine/term.ts';
import { advisorSummary } from '../../src/ui/advisor-summary.ts';
import { gradAdminRequest } from '../../src/ui/grad-admin-request.ts';
import { validateStudent } from '../../src/ui/state.ts';

const file = process.argv[2] ?? 'tests/scenarios/clock-phd-qualifier-4-semesters-before.json';
const scenario = JSON.parse(readFileSync(file, 'utf8')) as { today?: string; student: unknown };
const today = process.argv[3] ?? scenario.today ?? '2026-09-28';
const rules = rulesFromSnapshot();
const s = validateStudent(scenario.student);
const r = audit(s, rules, today);
const context = { todayIso: today, entryTerm: termLabel(s.entryTerm), priorStudy: 'No prior graduate study', gpa: s.gpa };
const g = gradAdminRequest(r, s, rules, context);
console.log(g.text);
console.log('=====HTML');
console.log(g.html);
// …and the advisor summary, in the same style (2026-09-28).
const a = advisorSummary(r, { ...context, advisors: [s.milestones.advisorName ?? 'Prof. Example'] });
console.log('=====ADVISOR TEXT');
console.log(a.text);
console.log('=====ADVISOR HTML');
console.log(a.html);
