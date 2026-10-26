// Notre Dame coursework taken BEFORE the entry term (2026-09-05).
//
// A student's Notre Dame unofficial transcript can hold an earlier Notre Dame
// degree — eight undergraduate semesters, a prior M.S., a 4+1 — on the same
// pages as the current program. Those courses are not this program's
// coursework: they do not count toward residence (§4.3), credits (§4.2) or
// specialization (§4.4.2), and their credits, if graduate, are §5.2 transfers
// ("These five requirements also apply to the transfer of credits earned in
// another program at Notre Dame"). §4.4.1 core knowledge is the exception —
// a core course passed "either at Notre Dame or at their previous institution"
// counts, and for a Notre Dame course the Courses tab already says which area.
//
// So a Notre Dame course dated before the entry term is filed as PRIOR
// COURSEWORK — except a course of the EARLY-START summer just before a fall
// entry, which is this program's own (P3-chg-other-1, DGS 2026-10-05;
// engine/early-start.ts): origin 'transfer', institution "University of Notre Dame",
// degreeLevel from the level the student was registered at (the transcript's
// UG/GR column, kept as `registeredLevel`; else the bachelor's award term
// when known (2026-09-06); the course number as a last resort).
// The sort is redone whenever the entry term changes, so correcting the
// dropdown re-files the courses without a re-import. Pure functions — no DOM.
import { NOTRE_DAME, isNotreDameInstitution } from '../data/external.ts';
import { beforeProgramStart, isEarlyStartCourse } from '../engine/early-start.ts';
import { conferralTerm, termIndex, termLabel } from '../engine/term.ts';
import type { CourseEntry, Student, Term } from '../engine/types.ts';
import { levelFromNumber } from '../transcript/level.ts'; // not parse.ts: the reader loads at the Import click (2026-10-26)

/** Bachelor's or Master's prior coursework. The level the student was
 * registered at (the transcript's UG/GR column) decides; without it, the term
 * against the bachelor's award term when that is known (DGS 2026-09-06: dated
 * in or before it → taken as an undergraduate); only then the course number
 * (1xxxx–4xxxx undergraduate, else graduate). The number is a last resort for
 * hand-typed rows and never decides credit — the engine's §5.2 rule on
 * `bachelorsAwarded` does (allocate.ts), and every transfer credit stays
 * "pending DGS review" until approved. */
export function priorNdDegreeLevel(
  c: Pick<CourseEntry, 'courseId' | 'registeredLevel' | 'term'>,
  bachelorsAwarded?: Term,
): 'bachelors' | 'masters' {
  if (c.registeredLevel !== undefined) return c.registeredLevel === 'undergraduate' ? 'bachelors' : 'masters';
  if (bachelorsAwarded !== undefined) return termIndex(c.term) <= termIndex(bachelorsAwarded) ? 'bachelors' : 'masters';
  return levelFromNumber(c.courseId) === 'undergraduate' ? 'bachelors' : 'masters';
}

/** Prior GRADUATE coursework — the rows that mean "this student was in a
 * graduate program before this one". A 4+1's senior-year course is not one of
 * them: it is registered at the graduate level but was taken in or before the
 * term the bachelor's degree was awarded, so it belongs to the undergraduate
 * career (DGS 2026-09-06 on §5.2 criterion 2). Without this test a single
 * GR-labelled senior course made the app announce a master's the student never
 * started (2026-09-09). */
export function hasPriorGraduateStudy(student: Student): boolean {
  return student.courses.some((c) => {
    if (c.origin !== 'transfer' || c.degreeLevel === 'bachelors' || c.degreeLevel === undefined) return false;
    if (!isNotreDameCourse(c)) return true; // another university's graduate transcript
    if (!isPriorNd(c, student)) return false;
    const awarded = student.bachelorsAwarded;
    return awarded === undefined || termIndex(c.term) > termIndex(awarded);
  });
}

/** Does the student already hold a Notre Dame master's — worked out again from
 * the transcript's own degree lines and the CURRENT entry term (2026-09-10).
 * A master's conferred BEFORE the entry term is one they already held; one
 * conferred after it is §4.5's along-the-way award, earned inside this program.
 *
 * Re-derived on every entry-term change, because that term is what the reading
 * turns on and it is the value a 4+1's transcript makes hardest to read: the
 * import first sees the §3.5 senior-year course as the start of the program,
 * two years early, and the student corrects it afterwards. Deciding this once
 * at import left them holding an MSCSE the app did not know about.
 *
 * Fills the field only while it is empty or still an import's own reading —
 * the same rule the bachelor's award term follows (2026-09-06). */
export function deriveNdMasters(student: Student): boolean {
  if (student.ndMasters !== undefined && student.ndMasters.inferred === undefined) return false; // their own answer
  // A partial earlier-degrees answer that says the earlier graduate program
  // was not the Notre Dame MSCSE held (another department, elsewhere, none, a
  // transfer before finishing) settles it: a Notre Dame master's on the
  // transcript is that other program's (policy review of Option 1, 2026-10-08;
  // the same reason as the answered-question guard of 2026-10-03).
  const g = student.backgroundDraft?.graduate;
  if (student.background === undefined && g !== undefined && g !== 'nd-mscse' && g !== 'nd-4plus1') {
    if (student.ndMasters === undefined) return false;
    delete student.ndMasters;
    return true;
  }
  const held = (student.ndDegrees ?? []).find(
    (d) => (d.level === 'masters' || d.level === 'phd') && termIndex(conferralTerm(d.date)) < termIndex(student.entryTerm),
  );
  const before = student.ndMasters?.term;
  if (held === undefined) {
    if (student.ndMasters === undefined) return false;
    delete student.ndMasters;
    return true;
  }
  student.ndMasters = {
    term: conferralTerm(held.date),
    inferred: { how: `your Notre Dame transcript shows a graduate degree awarded ${held.date}, before ${termLabel(student.entryTerm)}` },
  };
  return before === undefined || termIndex(before) !== termIndex(student.ndMasters.term!);
}

/** Keep "Prior graduate study" in step with the coursework (2026-09-09).
 * The value is inferred on a transcript import; it also has to follow a later
 * correction to the entry term or the bachelor's award term, which can turn
 * program coursework into prior coursework and back. A value the student chose
 * themselves is never touched — only the untouched default and a value this
 * function or an import inferred. Returns true when it changed something. */
export function derivePriorMs(student: Student): boolean {
  // An answered earlier-degrees question settles it (2026-09-22) — including
  // its "none", which the line below cannot tell from the untouched default.
  // The import and the entry-term control checked this before calling; adding
  // a course by hand and setting the bachelor's term did not, so one pre-entry
  // course turned an answered "none" into an unfinished prior master's
  // (policy review round 3, P3-chg-other-1's cse-3 variant, 2026-10-05).
  if (student.background !== undefined) return false;
  if (student.priorMs !== 'none' && student.priorMsInferred !== true) return false; // their own answer
  const before = student.priorMs;
  // A partial answer's "No" to a graduate degree before this program settles
  // it the same way (policy review of Option 1, 2026-10-08).
  if (student.backgroundDraft?.graduate === 'none') {
    student.priorMs = 'none';
    student.priorMsInferred = undefined;
    return student.priorMs !== before;
  }
  // …and its "finished" for an earlier program (elsewhere, or in another
  // Notre Dame department) sets prior study to match, as the answer will: a
  // printed conferral read as "finished" is a completed degree, not the
  // "unfinished" the coursework alone suggests (review of Option 1,
  // 2026-10-08 — the cap read 6 while the record said finished).
  const draft = student.backgroundDraft;
  if (draft?.finished !== undefined && (draft.graduate === 'elsewhere' || draft.graduate === 'nd-other' || (asksAlsoElsewhere(draft.graduate) && draft.alsoElsewhere === true))) {
    student.priorMs = draft.finished ? 'completed' : 'unfinished';
    student.priorMsInferred = true;
    return student.priorMs !== before;
  }
  if (hasPriorGraduateStudy(student)) {
    // Notre Dame's own master's degree is a fact the transcript records; any
    // other prior graduate coursework leaves "completed" to the student, with
    // the standing card's warning asking for it.
    //
    // "completed" is applied whenever the Notre Dame master's is known, not
    // only from the untouched default: the fact often arrives AFTER this ran
    // once — the student corrects the entry term, or ticks the box — and an
    // inferred "unfinished" left standing halves the §5.2 cap from 24 to 6
    // for a student whose degree the transcript records (2026-09-10).
    if (student.ndMasters !== undefined) {
      student.priorMs = 'completed';
      student.priorMsInferred = true;
    } else if (student.priorMs === 'none') {
      student.priorMs = 'unfinished';
      student.priorMsInferred = true;
    }
  } else if (student.priorMsInferred === true) {
    student.priorMs = 'none';
    student.priorMsInferred = undefined;
  }
  return student.priorMs !== before;
}

/** True for a Notre Dame course — program coursework or prior coursework. */
export function isNotreDameCourse(c: CourseEntry): boolean {
  return c.origin === 'nd' || (c.origin === 'transfer' && isNotreDameInstitution(c.institution));
}

/** Prior Notre Dame coursework: a Notre Dame course dated before the program
 * began — before the entry term, but not in the early-start summer just before
 * a fall entry (P3-chg-other-1; DGS 2026-10-05, option (a)). */
export function isPriorNd(c: CourseEntry, student: Pick<Student, 'entryTerm' | 'bachelorsAwarded' | 'ndDegrees' | 'ndMasters'>): boolean {
  return isNotreDameCourse(c) && beforeProgramStart(c, student);
}

/** "Prior graduate study" as the earlier-degrees answer sets it (applyBackground
 * in background.ts): a graduate degree elsewhere, or at Notre Dame in another
 * department (2026-10-03), is a prior program under §5.2 — finished or not;
 * the CSE MSCSE, a 4+1 and a move from the MSCSE are not. */
/** The earlier-degrees answers that ask "Did you also hold, or start, a
 * graduate degree at another university?": the three Notre Dame MSCSE
 * answers — the transfer (policy review round 3, P3-prior-programs-2) and the
 * MSCSE held, as a regular student or through the 4+1 (P3-prior-programs-1);
 * DGS 2026-10-07: option (a) for both. */
export function asksAlsoElsewhere(graduate: string | undefined): boolean {
  return graduate === 'nd-mscse' || graduate === 'nd-4plus1' || graduate === 'nd-mscse-transfer';
}
/** A graduate degree (finished or not) at another university, or in another
 * Notre Dame department — a prior program under §5.2. */
export function priorProgramElsewhere(b: NonNullable<Student['background']>): boolean {
  return b.graduate === 'elsewhere' || b.graduate === 'nd-other' || (asksAlsoElsewhere(b.graduate) && b.alsoElsewhere === true);
}
export function priorMsOfBackground(b: NonNullable<Student['background']>): Student['priorMs'] {
  // The Notre Dame MSCSE — held, or left for the Ph.D. — is no earlier program
  // (one graduate program with the Ph.D., DGS 2026-09-26 / 2026-10-03), unless
  // the student also held or started a degree elsewhere (P3-prior-programs-1/-2).
  return priorProgramElsewhere(b) ? (b.finished ? 'completed' : 'unfinished') : 'none';
}

/** An inferred "Prior graduate study" beside an ANSWERED earlier-degrees
 * question gives way to the answer. Before 2026-10-06 adding a pre-entry Notre
 * Dame course by hand, or setting the bachelor's term, ran derivePriorMs past
 * the answer (P3-chg-other-1's cse-3 variant) — an answered "none" became an
 * unfinished prior master's, and a Notre Dame MSCSE holder's became a finished
 * one. Run when a saved record loads; returns true when it changed something. */
export function settleAnsweredPriorMs(student: Student): boolean {
  if (student.background === undefined || student.priorMsInferred !== true) return false;
  student.priorMs = priorMsOfBackground(student.background);
  student.priorMsInferred = undefined;
  return true;
}

/** The early-start summer's Notre Dame rows that an earlier build filed as
 * prior coursework, back into the program (P3-chg-other-1; DGS 2026-10-05).
 * Run when a saved record loads. Only these rows move: any other row keeps
 * the filing it was saved with — a loaded file's program row dated before the
 * entry term is warned about, not re-filed (P2-dh-front-1-2-6). Rows of the
 * transcript's transfer-credit block are another university's credit and are
 * never touched. Returns how many rows moved. */
export function refileEarlyStartCourses(student: Student): number {
  let moved = 0;
  for (const c of student.courses) {
    if (c.origin !== 'transfer' || !isNotreDameInstitution(c.institution) || c.ndPosted !== undefined) continue;
    if (!isEarlyStartCourse(c, student)) continue;
    c.origin = 'nd';
    delete c.institution;
    delete c.degreeLevel;
    moved += 1;
  }
  // An unfinished prior master's inferred from those rows alone goes with them.
  if (moved > 0) derivePriorMs(student);
  return moved;
}

/** Re-file every Notre Dame course by the student's entry term: before it →
 * prior coursework, from it on → program coursework (the early-start summer
 * just before a fall entry is the program's — isPriorNd). Courses from other
 * institutions (the transcript's own transfer-credit block, external
 * transcripts) are untouched. Prior rows are also re-levelled against the
 * bachelor's award term on every call, so importing the transcript and
 * setting that term give the same result in either order (DGS 2026-09-07).
 * Returns how many entries moved each way. */
export function reclassifyNotreDameCourses(student: Student): { toPrior: number; toProgram: number } {
  let toPrior = 0;
  let toProgram = 0;
  for (const c of student.courses) {
    if (!isNotreDameCourse(c)) continue;
    if (isPriorNd(c, student)) {
      // A row already filed as prior stays prior, but is RE-LEVELLED (DGS
      // 2026-09-07). The bachelor's award term is normally set after the
      // transcript import — the field sits under Your standing, below the
      // transcripts card — and before this fix a row filed first kept the
      // level guessed from its course number, so the order of the two
      // actions changed what the student saw. priorNdDegreeLevel still
      // prefers the transcript's own UG/GR label, so a labelled row never
      // moves; clearing the term falls back to the course number.
      if (c.origin === 'transfer') {
        c.degreeLevel = priorNdDegreeLevel(c, student.bachelorsAwarded);
        continue;
      }
      c.origin = 'transfer';
      c.institution = NOTRE_DAME;
      c.degreeLevel = priorNdDegreeLevel(c, student.bachelorsAwarded);
      toPrior += 1;
    } else if (c.origin === 'transfer') {
      c.origin = 'nd';
      delete c.institution;
      delete c.degreeLevel;
      toProgram += 1;
    }
  }
  return { toPrior, toProgram };
}
