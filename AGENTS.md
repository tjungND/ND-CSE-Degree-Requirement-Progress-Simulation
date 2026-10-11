# Instructions for AI coding agents (Codex, Claude Code, and others)

This repository's agent instructions live in **`CLAUDE.md`** — read it in full before doing
anything. Then read `docs/CLAUDE-HANDOFF.md` (design decisions, invariants, recipes),
`docs/STATE.md` (where things stand, open items — keep it current) and
`docs/DECISIONS.md` (every policy interpretation already made). The guide for the humans you are
working with is `README.md`; its Track B describes the workflow they expect from you.

The non-negotiables, spelled out in `CLAUDE.md`:

- No backend, database, login, analytics, or runtime network call other than the read-only fetch
  of the rules sheet. Student data — including uploaded transcript PDFs — never leaves the browser.
- Policy lives in the Google Sheet, structure lives in code. Never hard-code a course number or a
  threshold the department sets; a number set above the department (the Graduate School's
  Academic Code or DGS Handbook) lives in code beside its quoted sentence, never as a Parameters
  key (README § A5b lists them). Quote the handbook sentence and its § above every requirement.
- Never guess: unknown course, missing parameter, or unapproved item ⇒ "needs DGS review" or
  "cannot evaluate", never a silent default.
- Plan before non-trivial changes and ask the DGS every policy question you cannot settle from the
  handbook; record each answer in `docs/DECISIONS.md` (date, question, decision, who).
- Ask before changing the sheet schema (column names, allowed values, parameter keys).
- Never alter a university name in the ExternalCourses tab: each is what the import read from an
  official transcript, and future transcripts must read the same name (DGS 2026-10-07). The
  transcript reader must keep reading the names the sheet already lists.
- `npm test` and `npm run build` must pass before you call anything done; run `npm run e2e` for
  UI-visible changes (and `E2E_BROWSER=webkit npm run e2e` — Safari's engine — and
  `E2E_BROWSER=firefox npm run e2e` when layout changed; `E2E_BROWSER=safari npm run e2e` runs
  real Safari when the Mac is unlocked, `E2E_BROWSER=opera npm run e2e` Opera) and look at the screenshots. Add a scenario in `tests/scenarios/` for every bug fixed. `tests/verdicts.json` pins every row of every scenario: an engine change that moves one fails `npm test` with the list — show it to the DGS, then `npm run verdicts -- --update` and commit the file with the change.
