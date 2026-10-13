// The two tracks this audit does not model (§3.5 Integrated B.S. + M.S., §3.6
// Transition to Computing), and the note a student on one of them is shown.
//
// Decided 2026-08-31: "v1 audits the standard MSCSE and Ph.D. programs;
// students on those tracks see a clearly-worded 'talk to the DGS' note." The
// note was never built — a §3.6 student saw the ordinary report with nothing to
// say why a required twelve-credit year counted toward almost nothing (DGS
// asked for it 2026-09-10).
//
// The app does not ask which track a student is on: it recognises the two from
// the coursework they have already entered, so nobody has to know the section
// number to be told about it. Neither note changes a single verdict — every
// requirement is still decided by the handbook and the rules sheet. What the
// note does is name the thing the page cannot decide, and send them to the one
// person who can.
import { BS_SHARED_CREDITS_MAX, levelOf, type ClassifiedCourse } from './allocate.ts';
import { isNotreDameInstitution } from '../data/external.ts';
import { compareTerm, termLabel } from './term.ts';
import type { Student, Term } from './types.ts';

export interface SpecialTrack {
  /** §3.6 bridge courses, or §3.5's graduate courses taken as an undergraduate. */
  id: 'transition' | 'integrated';
  section: string;
  title: string;
  text: string;
}

const deptOf = (id: string) => id.split(' ')[0] ?? '';

/** Which courses the app chose to apply to both degrees — the student is told,
 * not asked (DGS 2026-09-11): 40000-level CSE courses first, best grade first.
 * No promise that 60000-level coursework is "saved" for the MSCSE, nor that
 * every other course counts toward it (policy review round 3,
 * P3-fourplusone-6): each course's line says when one does not count. (A
 * 4+1's 60000-level course the bachelor's did not use counts toward the MSCSE
 * whenever it was taken — DGS 2026-10-07.) */
function sharedList(classified: ClassifiedCourse[]): string {
  const both = classified.filter((c) => c.bsShare === 'both').map((c) => c.entry.courseId);
  if (both.length === 0) return 'None of your courses is applied to both degrees; each counts toward the MSCSE only if it can — its line says when it does not. ';
  return `This page chose ${both.join(' and ')} to apply to both your bachelor’s degree and your MSCSE — your 40000-level CSE courses first, best grade first; every other course counts toward your MSCSE only if it can, and its line says when it does not. `;
}

/** Which of the two tracks this student's coursework shows, and what to tell
 * them. Pure; both notes are program-specific, because the handbook says
 * different things to an MSCSE and a Ph.D. student about the same course. */
export function specialTracks(student: Student, classified: ClassifiedCourse[]): SpecialTrack[] {
  const notes: SpecialTrack[] = [];
  const phd = student.program === 'phd';

  // §3.6: a 50000-level CSE course exists for one reason — the Transition to
  // Computing bridge set (§3.6.1's three courses). Listed in the rules sheet
  // or not, entering one is the signal.
  if (classified.some((c) => deptOf(c.entry.courseId) === 'CSE' && levelOf(c.entry, c.rule) === 5)) {
    notes.push({
      id: 'transition',
      section: '§3.6',
      title: 'Transition to Computing',
      text: phd
        ? 'You have entered a 50000-level bridge course. These are preparatory courses, and this page counts each one only as the course rules say — most of them count toward no requirement at all, and the one that can needs the DGS’s approval first. Nothing here plans your bridge year or says what it means for your deadlines: that is the DGS’s call, so ask them.'
        : 'You have entered a 50000-level bridge course. The handbook is explicit that these are preparatory and “do not count toward the MSCSE degree requirements” (§3.6.1), so this page counts them toward nothing — which is correct, and is not a problem with your record. Ask the DGS how the bridge courses fit the rest of your plan.',
    });
  }

  // §3.5: a graduate-level Notre Dame course taken in or before the term the
  // bachelor's degree was awarded — the Integrated B.S. + M.S. signature. It
  // needs the award term, which is required of every student since 2026-09-07.
  const awarded = student.bachelorsAwarded;
  if (
    awarded !== undefined &&
    classified.some(
      (c) =>
        levelOf(c.entry, c.rule) >= 6 &&
        compareTerm(c.entry.term, awarded) <= 0 &&
        // The one canonical test (red-team 2026-09-13): this used to carry its
        // own regex AND treat a blank institution as Notre Dame, so the note
        // promised a course "counts here in full" while the course line and the
        // credit totals — which go through isNotreDameInstitution — said it
        // counted nothing. A transfer row with no university named is not
        // known to be Notre Dame, so the note stays quiet.
        (c.entry.origin === 'nd' || isNotreDameInstitution(c.entry.institution)),
    )
  ) {
    notes.push({
      id: 'integrated',
      section: '§3.5',
      title: 'Integrated B.S. + M.S.',
      // Rewritten 2026-09-11: both notes described the rule the app followed
      // BEFORE the Graduate School answered (2026-09-10) — "counts toward no
      // credit", "does not count the courses toward the MSCSE". It counts them
      // now, so the note that sits above the report had to stop contradicting
      // the lines below it.
      text: phd
        // Shorter sentences, one fact each (clarity review 2026-09-26); the
        // facts are the 2026-09-11 note's, with the condition the engine
        // applies — the UG→GR move, or the DGS's confirmation (policy review
        // 2026-10-04, P1-page-text-engine-11; DGS: "Apply the suggested fix").
        ? 'One or more of your graduate courses was taken in or before the term your bachelor’s degree was awarded. Your 60000-level courses from before your bachelor’s degree count here in full if that degree did not use them (Graduate School) — on top of what §5.2 lets you transfer — once they were moved from undergraduate to graduate registration before the bachelor’s was awarded (Graduate School 4+1 guidance). A course your Notre Dame transcript does not show registered at the graduate level, or one taken outside the 4+1, counts only provisionally until the DGS confirms it. Up to 6 credits of courses below 60000 may count inside §4.2’s allowance. No course may count toward three degrees: if you also hold a Notre Dame master’s, say next to each course which degrees it has already counted toward. The DGS decides anything the course rules leave open.'
        : `One or more of your graduate courses was taken in or before the term your bachelor’s degree was awarded. At most ${BS_SHARED_CREDITS_MAX} credits in all may apply to both your bachelor’s degree and the MSCSE, from the second semester of the junior year on, with the instructor’s and the DGS’s approval (§3.5). ${sixkSentence(student, awarded)} CSE courses below the 60000 level count inside §3.2’s allowance. ${sharedList(classified)}Anything that still needs an approval is counted only provisionally and listed in the review request below — ask the DGS to confirm it.`,
    });
  }

  return notes;
}


/** The note's 60000-level sentence, as the course lines decide it (policy
 * review round 4, P4-transfer-7; DGS 2026-10-12: "apply the suggested
 * handling"): the promise "counts toward the MSCSE alone, whenever you took
 * it" only to an Integrated B.S. + M.S. student admitted before the bachelor's
 * was awarded (DGS 2026-10-07, P3-fourplusone-1); a 4+1 admitted after it
 * counts only the shared six (4+1 guidance: "Only six credits can be
 * double-counted if a student starts the graduate program after the
 * bachelor's degree has been awarded"); a student not in the 4+1 counts none
 * (§3.5; allocate.ts plainBachelorsSixk). It promised the first to all three. */
function sixkSentence(student: Student, awarded: Term): string {
  if (student.integratedBsMs === true) {
    const admitted = student.integratedAdmitted;
    if (admitted !== undefined && compareTerm(admitted, awarded) > 0)
      return `You were admitted to the Integrated program for ${termLabel(admitted)}, after your bachelor’s degree (${termLabel(awarded)}), so a 60000-level course you took as an undergraduate counts only among the shared ${BS_SHARED_CREDITS_MAX} (4+1 guidance).`;
    return 'A 60000-level course your bachelor’s degree did not use counts toward the MSCSE alone, whenever you took it (the Graduate School, through the DGS).';
  }
  return `A 60000-level course you took as an undergraduate counts toward the MSCSE only if you were in the Integrated B.S. + M.S. (4+1) program and admitted before your bachelor’s degree was awarded (Graduate School; §3.5)${student.integratedBsMs === false ? '' : ' — the earlier-degrees questions in the Transcripts card ask whether you were'}.`;
}
