# Accuracy log — every reported wrong result, and what was done about it

Started 2026-10-11 (DGS item 18). Each result card's **Relevant Policies** fold ends with
“Does this look wrong? Tell the DGS”, and each transcript preview with “Did the reader get this
transcript wrong? Tell the DGS”. Both open the student's own email app, addressed to the DGS
(`contact_dgs` in the Parameters tab) — on the MSCSE tab to the ADGS (`contact_adgs`), as everywhere on that tab — with the requirement or the transcript's counts and the
“Checked with” line already filled in; the page sends nothing.

**One row per report, newest first. No names, netIDs, NDIDs, grades or course lists** — the
requirement id, or the university for an import, is enough to find it again (FERPA; CLAUDE.md).

How to work a report:

1. Ask the student for their saved file (“Save to a file”) if the email alone does not show the
   problem, and re-run it with `npm run reproduce -- <file>` (README § A6d). For a transcript,
   ask for a copy with the name and ID removed, kept OUTSIDE the repository under a neutral name.
2. Decide the cause: the **sheet** (a row or number to correct — fix it there), the **engine**
   (the app read the rules wrongly), the **reader** (the transcript import misread a row), the
   **student** (an entry was wrong — nothing to fix), or **policy** (the handbook does not say —
   docs/HANDBOOK-REVISIONS.md).
3. For an engine or reader cause, add the case before fixing it: a scenario in
   `tests/scenarios/` (an engine cause), or a fixture line set (a reader cause), then fix, then
   approve the changed verdicts (`npm run verdicts`).
4. Add the row below.

| date | requirement id or import | what looked wrong | cause | fixed by | scenario or fixture added |
|---|---|---|---|---|---|
