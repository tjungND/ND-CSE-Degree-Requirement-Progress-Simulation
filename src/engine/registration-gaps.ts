// The falls and springs a Notre Dame transcript shows no registration in, and
// whether the student's answer covers them. Moved from src/ui/withdrawals.ts
// on 2026-10-07 (policy review round 3, P3-ac-5a-5; DGS: the check runs "In
// the audit"), so the card, both emails and the review request carry it.
// Pure: the record and today's date only.
import { compareTerm, normalizeEntryTerm, semesterSeq, termIndex, termOfDate } from './term.ts';
import type { Student, Term } from './types.ts';

/** The falls and springs a Notre Dame transcript shows no registration in,
 * from the entry term on: strictly between the first and the last semester
 * with a Notre Dame course — and, since policy review round 3
 * (P3-dh-3.1-3.13-2; DGS 2026-10-06: "Apply the handling with option (b)"),
 * after the last one up to the current semester, the range the full-time list
 * already uses: a student on leave this semester has no later registration to
 * frame the gap. Undefined when no Notre Dame transcript was imported — a
 * hand-entered record may leave a research-only semester empty, so nothing is
 * read into an empty semester there (2026-10-04). A transcript imported
 * before this semester's registration posts names the current semester too;
 * the student leaves the leave count at 0. */
export function transcriptGapSemesters(student: Student, todayIso: string): Term[] | undefined {
  if (!student.courses.some((c) => c.fromNdTranscript)) return undefined;
  const entry = normalizeEntryTerm(student.entryTerm).term;
  const seqs = new Set(student.courses.filter((c) => c.origin === 'nd' && c.term.season !== 'summer' && termIndex(c.term) >= termIndex(entry)).map((c) => semesterSeq(c.term)));
  if (seqs.size === 0) return [];
  const first = Math.min(...seqs);
  const last = Math.max(...seqs);
  const now = semesterSeq(termOfDate(todayIso));
  const out: Term[] = [];
  for (let seq = first + 1; seq <= Math.max(last - 1, now); seq++) if (!seqs.has(seq)) out.push({ season: seq % 2 === 1 ? 'fall' : 'spring', year: Math.floor(seq / 2) });
  return out;
}

/** The transcript's unregistered semesters when the student's answer does not
 * cover them (policy review round 3, P3-ac-5a-5; DGS 2026-10-07: option (a)
 * for both parts): a leave count is entered, no readmission term is, and the
 * transcript shows more falls and springs without registration than the leave
 * count. Academic Code §5.1: "If the student does not return at the end of the
 * leave of absence period, he or she is no longer considered a student at
 * Notre Dame" — so a semester the leave does not cover means a readmission
 * (DGS Handbook §3.1, §3.3). A leave lasts at most two consecutive semesters
 * (CSE §5.7, for everyone — 2026-10-07, P3-ac-5a-4 (a)), so a run of three is
 * more than a count of two covers. The current semester is left out: its
 * registration may not have posted when the transcript was printed. With no
 * leave count the selector already asks (2026-10-04). Undefined when there is
 * nothing to say. */
export function uncoveredRegistrationGaps(student: Student, todayIso: string): Term[] | undefined {
  if (student.readmittedTerm !== undefined) return undefined;
  // Every approved leave covers a gap — medical or for another reason (policy
  // review round 4, P4-ac-3; DGS 2026-10-11: option (a)); only medical leave
  // moves a clock, which is not this question.
  const leave = (student.leaveSemesters ?? 0) + (student.otherLeaveSemesters ?? 0);
  if (leave <= 0) return undefined;
  const now = termOfDate(todayIso);
  const gaps = (transcriptGapSemesters(student, todayIso) ?? []).filter((t) => compareTerm(t, now) < 0);
  return gaps.length > leave ? gaps : undefined;
}
