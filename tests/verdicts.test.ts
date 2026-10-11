// Every row of every scenario against the approved verdicts (item 3,
// 2026-10-11). A failure lists each changed verdict: if the change is meant,
// show the list to the DGS, then `npm run verdicts -- --update` and commit
// tests/verdicts.json with the engine change. See tests/verdict-table.ts.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { differences, readApproved, verdictTable } from './verdict-table.ts';

describe('approved verdicts (tests/verdicts.json)', () => {
  it('every row of every scenario reads as approved', () => {
    const changed = differences(readApproved(), verdictTable());
    assert.deepEqual(
      changed,
      [],
      `${changed.length} verdict(s) changed:\n${changed.join('\n')}\n\nIf these are intended, show the list to the DGS, then run  npm run verdicts -- --update  and commit tests/verdicts.json.`,
    );
  });
});
