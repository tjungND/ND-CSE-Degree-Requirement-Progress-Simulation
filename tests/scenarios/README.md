# Scenario fixtures

One JSON file per student case: the student's input plus the expected status of every
requirement. `tests/scenarios.test.ts` runs them all; add one whenever an edge case or a bug is
found (file names describe the case, e.g. `phd-two-distinct-groups.json`). The keys are the
`ScenarioFile` interface in `tests/helpers.ts`:

| key | required | what it is |
|---|---|---|
| `name` | yes | The test's name in the runner's output. |
| `description` | yes | Why this case exists, for a human. |
| `today` | yes | The date the audit is run on (`YYYY-MM-DD`) — deadlines and "semester N" count from it. |
| `rules` | yes | `{ "base": "default" }` = the fixture CSVs in `tests/fixtures/rules/`; an optional `patch` edits them before parsing: `parameters` (key → value, or `null` to delete the row), `courses` (`course_id` + optional `rules_effective_term`, then `set` cells or `remove: true`), `external` (replaces the ExternalCourses tab with an array of row objects; `[]` = an empty tab). |
| `student` | yes | A full `Student` record (`src/engine/types.ts`) — program, entry term, prior study, courses, milestones, attestations. |
| `expect` | yes | requirement id → `{ status, statusLabel?, deadlineState?, deadlineLabelIncludes?, detailIncludes?, detailExcludes? }`: the expected status, the pill's own wording, the deadline chip's state and words, substrings the detail must contain and substrings it must not. Every id must be one of `REQUIREMENT_IDS` in `src/engine/audit.ts`, and every registered id must be asserted by at least one fixture. |
| `expectTracks` | no | The §3.5 / §3.6 track sections the report must carry, in order. |
| `expectAbsent` | no | Requirement ids that must not appear in the report at all. |
| `expectReviewEmpty` | no | `true` = the DGS review request has nothing to ask. |
| `expectCourseLines` | no | course id → substrings that one of that course's report lines must all contain. |

## Approved verdicts — every row of every scenario (2026-10-11)

A fixture's `expect` pins the rows it was written about. `tests/verdicts.json` pins all the
others too: for every scenario, every row's status, the pill's own wording, its credit count and
its deadline state, one row per line. `tests/verdicts.test.ts` compares the engine with it, so an
engine change that moves ANY row of ANY scenario fails `npm test` with the list:

```
life-phd-finished · phd.msAlongTheWay: met → in_progress 12/24
```

If every listed change is intended, show the list to the DGS. Once approved, rewrite the copy and
commit it with the engine change — the file's diff is then the record of what changed:

```
npm run verdicts -- --update
```

`npm run verdicts` alone lists the differences without failing a test run. A new scenario is
listed as "new scenario (N rows)" until the copy is rewritten.

The `life-*.json` scenarios are whole degrees, entry to the end (MSCSE project, thesis and 4+1;
Ph.D. straight through, with a master's elsewhere, after a Notre Dame MSCSE, with a semester of
medical leave, and mid-degree with the MSCSE along the way). Every row of each is pinned in its
own `expect` as well, and the DGS confirms each end state. The `clock-*.json` pairs cross each
deadline — the qualifier's four semesters, the research qualifier's eighteen months, the
eighth-semester candidacy, the 5- and 8-year limits — the day before (due soon) and the day after
(overdue), every row pinned too.

On a failure the runner prints the row's full detail next to the substring it expected, so a
pin can be shortened to the clause that distinguishes the row.

Run one fixture:

```
node --test --test-name-pattern=phd-fresh tests/scenarios.test.ts
```
