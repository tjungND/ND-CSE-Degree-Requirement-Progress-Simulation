// The approved-verdicts table (item 3, 2026-10-11; tests/verdict-table.ts).
//   npm run verdicts               list every verdict that differs from tests/verdicts.json
//   npm run verdicts -- --update   rewrite tests/verdicts.json from the engine (after the DGS
//                                  has approved the listed changes)
import { writeFileSync } from 'node:fs';
import { differences, readApproved, serialize, verdictTable, VERDICTS_FILE } from '../../tests/verdict-table.ts';

const now = verdictTable();
let approved = {};
try {
  approved = readApproved();
} catch {
  console.log('No tests/verdicts.json yet.');
}
const changed = differences(approved, now);
if (process.argv.includes('--update')) {
  writeFileSync(VERDICTS_FILE, serialize(now));
  console.log(`tests/verdicts.json written: ${Object.keys(now).length} scenarios, ${Object.values(now).reduce((n, r) => n + Object.keys(r).length, 0)} rows${changed.length ? ` (${changed.length} changed)` : ''}.`);
  for (const line of changed) console.log(`  ${line}`);
} else {
  if (changed.length === 0) console.log('Every verdict matches tests/verdicts.json.');
  else {
    console.log(`${changed.length} verdict(s) differ from tests/verdicts.json:`);
    for (const line of changed) console.log(`  ${line}`);
    process.exitCode = 1;
  }
}
