// Generates the fixture PDFs used by the end-to-end transcript-upload test:
// a synthetic ND unofficial transcript, a non-ND one, an external (other
// university) one, and — since 2026-09-05 — a Banner-style TWO-COLUMN official
// transcript (banner-transcript.pdf) with positioned text runs, which exercises
// src/transcript/layout.ts column splitting through real pdfjs. Hand-built
// minimal PDFs — Helvetica text streams — so no PDF-writing dependency is needed.
// Regenerate with: node tests/fixtures/make-transcript-pdfs.mjs
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

function makePdf(lines) {
  const esc = (s) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  let text = 'BT /F1 9 Tf 40 760 Td 12 TL\n';
  for (const line of lines) text += `(${esc(line)}) Tj T*\n`;
  text += 'ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefPos = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

/** A PDF from positioned text runs: pages = [[{x, y, text, size?}, …], …].
 * Each run is its own Tj, so pdfjs reports it as one text item at (x, y) —
 * exactly how a registrar's Banner PDF comes out. */
function makePositionedPdf(pages) {
  const esc = (s) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', null, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const kids = [];
  for (const runs of pages) {
    let text = '';
    for (const r of runs) {
      // Optional rotation (degrees) and gray level — how watermarks are drawn.
      const th = ((r.angle ?? 0) * Math.PI) / 180;
      const matrix = r.angle ? [Math.cos(th), Math.sin(th), -Math.sin(th), Math.cos(th)].map((v) => v.toFixed(4)).join(' ') : '1 0 0 1';
      const color = r.gray !== undefined ? `${r.gray} g ` : '';
      text += `BT /F1 ${r.size ?? 8} Tf ${color}${matrix} ${r.x} ${r.y} Tm (${esc(r.text)}) Tj ET\n`;
    }
    const contentIndex = objects.length + 1; // 1-based object number of the stream
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentIndex + 1} 0 R >>`);
    objects.push(`<< /Length ${text.length} >>\nstream\n${text}\nendstream`);
    kids.push(`${contentIndex} 0 R`);
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${kids.length} >>`;
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefPos = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

// Banner two-column official transcript (invented institution and student).
// Shape copied from a real registrar PDF: SUBJ / NO. / TITLE / CRED GRD / PTS
// in separate columns, "TRANSFER CREDIT ACCEPTED BY THE INSTITUTION" before
// "INSTITUTION CREDIT", term headers per column, decorative rules, a
// "CONTINUED ON NEXT COLUMN" banner, the student's nd.edu contact e-mail in
// the header (which must NOT make it a Notre Dame transcript), and the
// institution named only on the legend page.
function bannerPages() {
  const L = { subj: 33, num: 60, title: 95, cred: 215, grd: 240, pts: 276 };
  const R = { subj: 310, num: 337, title: 372, cred: 492, grd: 517, pts: 553 };
  const page1 = [];
  let yL = 760;
  let yR = 760;
  const left = (text, x = L.subj) => page1.push({ x, y: (yL -= 10), text });
  const right = (text, x = R.subj) => page1.push({ x, y: (yR -= 10), text });
  const row = (col, y, subj, num, title, cred, grd, pts) => {
    page1.push({ x: col.subj, y, text: subj }, { x: col.num, y, text: num }, { x: col.title, y, text: title }, { x: col.cred, y, text: cred }, { x: col.grd, y, text: grd });
    if (pts !== undefined) page1.push({ x: col.pts, y, text: pts });
  };
  const rowL = (...a) => row(L, (yL -= 10), ...a);
  const rowR = (...a) => row(R, (yR -= 10), ...a);
  page1.push({ x: 33, y: 775, text: 'SSN: ***-**-0000   CWID 00000000   Date of Birth: 01-JAN   Date Issued: 01-SEP-2026' });
  left('OFFI Official Transcript');
  left('Record of: Jane Q. Student');
  left('Issued To: Jane Q. Student');
  left('STUDENT@ND.EDU');
  left('Course Level: Graduate');
  left('Matriculated: Fall 2019');
  left('Program : Doctor of Philosophy');
  left('College : College of Science');
  left('Major : Computer Science');
  left('Degree Awarded Doctor of Philosophy 15-MAY-2024');
  yL -= 10;
  page1.push({ x: L.subj, y: yL, text: 'SUBJ' }, { x: L.num, y: yL, text: 'NO.' }, { x: L.title, y: yL, text: 'COURSE TITLE' }, { x: L.cred, y: yL, text: 'CRED GRD' }, { x: L.pts, y: yL, text: 'PTS R' });
  left('_____________________________________________________________');
  left('TRANSFER CREDIT ACCEPTED BY THE INSTITUTION:');
  left('.   CS Dept Pre-Req Equivlnts');
  rowL('CS', '401', 'Intro to Advanced Studies I', '0.00', 'TR');
  rowL('CS', '450', 'Operating Systems', '0.00', 'TR');
  left('Ehrs:   0.00 GPA-Hrs:   0.00 QPts:   0.00 GPA:   0.00');
  left('INSTITUTION CREDIT:');
  left('Fall 2019');
  left('College of Science');
  left('Computer Science');
  rowL('CS', '430', 'Introduction Algorithms', '3.00', 'A', '12.00');
  rowL('CS', '536', 'Science of Programming', '3.00', 'A', '12.00');
  rowL('HUM', '601', 'TA Seminar', '0.00', 'S', '0.00');
  left('Ehrs:   6.00 GPA-Hrs: 6.00   QPts:   24.00 GPA:   4.00');
  left('Good Standing');
  left('Spring 2020');
  left('College of Science');
  left('Computer Science');
  rowL('CS', '535', 'Dsgn and Anlys of Algorithms', '3.00', 'A', '12.00');
  rowL('CS', '550', 'Advnc Operating Syst', '3.00', 'B+', '9.99');
  left('Ehrs:   6.00 GPA-Hrs: 6.00   QPts:   21.99 GPA:   3.67');
  left('Good Standing');
  left('******************** CONTINUED ON NEXT COLUMN *******************', 60);
  right('Institution Information continued:');
  right('Fall 2020');
  right('College of Science');
  right('Computer Science');
  rowR('CS', '553', 'Cloud Computing', '3.00', 'A', '12.00');
  rowR('CS', '597', 'Reading and Special Problems', '3.00', 'A', '12.00');
  right('Ehrs:   6.00 GPA-Hrs: 6.00   QPts:   24.00 GPA:   4.00');
  right('Good Standing');
  right('Spring 2021');
  right('College of Science');
  right('Computer Science');
  rowR('CS', '595', 'Econ & Priv Issues in Big Data', '3.00', 'A', '12.00');
  rowR('CS', '691', 'Research and Thesis Ph.D.', '4.00', 'S', '0.00');
  right('Ehrs:   7.00 GPA-Hrs: 3.00   QPts:   12.00 GPA:   4.00');
  right('Good Standing');
  right('Summer 2021');
  right('College of Science');
  right('Computer Science');
  rowR('INTR', '010', 'Summer Internship', '0.00', 'NG', '0.00');
  right('Ehrs:   0.00 GPA-Hrs: 0.00   QPts:   0.00 GPA:   0.00');
  right('Good Standing');
  right('********************** TRANSCRIPT TOTALS ***********************');
  // The terms above added up (2026-10-11, item 11): 6 + 6 + 6 + 7 + 0 = 25
  // earned hours, 21 GPA hours, 24 + 21.99 + 24 + 12 = 81.99 points, 3.90.
  right('TOTAL INSTITUTION   25.00   21.00   81.99   3.90');
  right('********************** END OF TRANSCRIPT ***********************');
  const page2 = [
    { x: 33, y: 760, text: 'Example Institute of Technology' },
    { x: 310, y: 760, text: 'This record is intended only for the specified' },
    { x: 33, y: 750, text: 'Office of the Registrar' },
    { x: 310, y: 750, text: 'recipient and may not be released to any third party.' },
    { x: 33, y: 740, text: 'Springfield, IL 60000' },
    { x: 33, y: 730, text: 'registrar@example.edu' },
    { x: 33, y: 710, text: 'HISTORY' },
    { x: 33, y: 700, text: 'Example Institute of Technology, also known as Example Tech, is a private, non-profit, Ph.D. granting research university founded in 1890.' },
    { x: 33, y: 690, text: 'UNIT OF CREDIT: All courses are taught in English and academic credit is recorded as semester hours, as defined by the standard Carnegie Unit.' },
  ];
  return [page1, page2];
}

// A COMBINED transcript (2026-09-05): the student's Notre Dame B.S. (two
// undergraduate terms, the degree awarded) precedes the Ph.D. terms — the
// entry term must be read as Fall 2026, the first graduate-level term.
// (2026-09-06: the B.S. is dated 2021, before the Purdue M.S. of the external fixture (2023–24),
// so the §5.2 graduate-status rule does not fire on those rows in the e2e run.)
const ND = [
  'University of Notre Dame',
  'Unofficial Academic Transcript',
  'This is not an official transcript.',
  'Name : Jane Q. Student',
  'Degrees Awarded',
  'Bachelor of Science',
  'Degree Date: May 16, 2021',
  '',
  // Graduate credit the Graduate School posted in Spring 2027 (Banner code
  // 202620), after the Fall 2026 entry, credit hours only (2026-10-05,
  // P3-import-1): counted as posted under Option 1; its core-sounding title
  // still asks the DGS for a §4.4.1 core area.
  'TRANSFER CREDIT ACCEPTED BY INSTITUTION',
  '202620: University of Michigan',
  'EECS 58200 GR Operating Systems 3.000',
  '',
  'INSTITUTION CREDIT',
  'Fall Semester 2020',
  'CSE 30321 UG Computer Architecture A 3.000 12.000',
  'MATH 10550 UG Calculus I A 4.000 16.000',
  'Spring Semester 2021',
  'CSE 20110 UG Discrete Mathematics B+ 3.000 9.999',
  'Fall Semester 2026',
  'CSE 60641 GR Graduate Operating Systems A 3.000 12.000',
  'CSE 63801 GR Research Seminar I S 1.000 0.000',
  'Spring Semester 2027',
  'CSE 60111 GR Complexity and Algorithms A- 3.000 11.001',
  'CSE 60321 GR Advanced Computer Architecture B+ 3.000 9.999',
  '',
  'TRANSCRIPT TOTALS (GRADUATE)',
  // Totals that agree with the rows (2026-10-11, item 11: the import checks
  // them): 10 institution hours + the 3 transferred = 13 earned; GPA hours 9
  // (the S row carries none), 12 + 11.001 + 9.999 = 33.000 points, 3.667.
  'Overall: 13.000 13.000 13.000 9.000 33.000 3.667',
  '',
  'COURSES IN PROGRESS',
  'Fall Semester 2027',
  'CSE 60876 GR Research Methods 3.000',
];

// An ND UNDERGRADUATE transcript on its own (2026-09-11): Notre Dame's 4+1
// issues two transcripts, one per career, so an MSCSE student's bachelor's
// record arrives by itself in the Previous Undergraduate row. It carries the
// three shapes that have to be told apart: coursework too low to count at all
// (MATH 10550, CSE 20110), 40000-level CSE courses that MAY count inside the
// allowance once the DGS approves, and a senior-year 60000-level course.
const ND_UNDERGRAD = [
  'University of Notre Dame',
  'Official Academic Transcript',
  'Name : Jane Q. Student',
  'Degrees Awarded',
  'Bachelor of Science',
  'Degree Date: May 17, 2026',
  '',
  'INSTITUTION CREDIT',
  'Fall Semester 2024',
  'MATH 10550 UG Calculus I A 4.000 16.000',
  'CSE 20110 UG Discrete Mathematics A 3.000 12.000',
  'Spring Semester 2025',
  'CSE 40113 UG Design/Analysis of Algorithms A 3.000 12.000',
  'Fall Semester 2025',
  'CSE 40166 UG Computer Graphics A- 3.000 11.001',
  'CSE 60641 UG Graduate Operating Systems A 3.000 12.000',
  '',
  'TRANSCRIPT TOTALS (UNDERGRADUATE)',
  // 16 hours, 16 + 12 + 12 + 11.001 + 12 = 63.001 points (item 11, 2026-10-11).
  'Overall: 16.000 16.000 16.000 16.000 63.001 3.938',
];

// The same undergraduate record STILL IN PROGRESS (DGS 2026-09-16): no degree
// awarded yet, a course without a grade — the Undergraduate slot refuses it.
const ND_UNDERGRAD_IN_PROGRESS = ND_UNDERGRAD.filter((l) => !/^(Degrees Awarded|Bachelor of Science|Degree Date: May 17, 2026)$/.test(l)).concat([
  '',
  'COURSES IN PROGRESS',
  'Spring Semester 2026',
  'CSE 40113 UG Design/Analysis of Algorithms 3.000',
]);

const OTHER = [
  'Purdue University',
  'Unofficial Academic Transcript',
  'Fall Semester 2026',
  'CS 50300 GR Operating Systems A 3.000 12.000',
];

// A system-generated transcript from ANOTHER university, for the external-
// transcripts flow (three-slot card). Multi-space gaps stand in for the column
// positions a real registrar PDF has (pdfToLines renders wide gaps the same way).
const EXTERNAL = [
  'Purdue University',
  'Office of the Registrar',
  'Official Transcript',
  'Student: John Q. Boilermaker',
  'Program: Master of Science, Computer Science',
  '',
  'Fall 2023',
  'CS 50300   Operating Systems                 3.0   A',
  'CS 59000   Special Topics in Systems         3.0   A-',
  '',
  'Spring 2024',
  'CS 58000   Algorithm Design                  3.0   B+',
  '',
  'Cumulative GPA: 3.83',
];

// A COMBINED B.S.+M.S. transcript from one university (2026-09-05, 4+1 /
// same-institution case): the bachelor's conferral line splits the rows into
// undergraduate (before it) and graduate (after it); the M.S. conferral makes
// the graduate rows a completed prior degree.
// A multi-campus system whose transcript prints only the system's name (DGS
// 2026-09-12): the logo naming the campus is an image. The preview must ask
// which campus before the courses are added.
const UC_SYSTEM = [
  'UNIVERSITY OF CALIFORNIA',
  'Office of the Registrar',
  'Official Transcript',
  'Student: Jane Q. Triton',
  'Program: Master of Science, Computer Science',
  '',
  'Fall Quarter 2023',
  'CSE 202   Algorithm Design and Analysis    4.0   A',
  '',
  'Winter Quarter 2024',
  'CSE 221   Operating Systems                4.0   A-',
  '',
  'Cumulative GPA: 3.85',
];

// A text-layer PDF from which no course line can be read (DGS 2026-09-16: such
// a file is offered OCR, like a scan).
const NO_LINES = [
  'Example State University',
  'Office of the Registrar',
  'Official Transcript',
  'Program: Master of Science, Computer Science',
  'Course listing continues on the attached page image.',
  // Enough text to count as a text layer (the parser treats under 200 characters as a scan).
  'This official transcript is issued by the Office of the Registrar and is valid only when it bears the registrar signature and the embossed seal of the university.',
  'The grading scale, credit definitions and academic standing codes are described in the legend printed on the reverse of this page.',
];

// A course outline, not a transcript (DGS 2026-10-10, answer 4a — the e2e leg
// added the same day): one course-like line, no university named, no GPA or
// totals. The upload says it does not look like a transcript and imports
// nothing. Invented course page in the shape of the McGill project's outline.
const OUTLINE = [
  '1/15/26, 10:30 AM   CSCI 250 Course Outline',
  'CSCI 250 Introduction to Computer Science',
  'Fall 2025',
  'CSCI 250   001 Introduction to Computer Science   3',
  'Prerequisite: CSCI 202. Bring your unofficial transcript to advising if you need a prerequisite waiver.',
  'Lectures meet twice a week; laboratory sections meet weekly in the computing laboratory, beginning in the second week of the term.',
  'Office hours, the reading list and the assignment schedule are posted on the course website before the first lecture.',
];

// A transcript that prints NO course numbers (CC15, DGS 2026-10-09; the e2e
// leg added 2026-10-10): a title column and no code column, as Nankai's and
// CHESICC's records print them. Each row is imported with an EMPTY, required
// course-id box; the row cannot be ticked, and Add adds nothing, until the
// student types an id. Invented institution and student.
const CODELESS = [
  'Example Normal University',
  'Graduate School Record of Graduate Coursework',
  'Name: Sample Student   Student No.: 000000000',
  'Program: Master of Engineering, Computer Science and Technology',
  'COURSE NAME   CREDIT   RESULT   COURSE TYPE',
  '2023-2024 Academic Year   First Semester',
  'Advanced Operating Systems   3   A   Degree Course',
  'Machine Learning   3   B+   Elective',
  '2023-2024 Academic Year   Second Semester',
  'Distributed Computing   3   A-   Degree Course',
  'TOTAL CREDITS: 9',
];

const COMBINED = [
  'Purdue University',
  'Office of the Registrar',
  'Official Transcript',
  'Student: Jane Q. Boilermaker',
  'Bachelor of Science in Computer Science — Conferred: May 11, 2024',
  'Master of Science in Computer Science — Conferred: May 10, 2025',
  '',
  'Fall 2023',
  'CS 25100   Data Structures and Algorithms    4.0   A',
  'CS 30700   Software Engineering I            3.0   A-',
  '',
  'Spring 2024',
  'CS 35400   Operating Systems                 3.0   A',
  '',
  'Fall 2024',
  'CS 50300   Operating Systems                 3.0   A',
  'CS 58000   Algorithm Design                  3.0   B+',
  '',
  'Cumulative GPA: 3.80',
];

// insideND's unofficial-transcript layout (2026-10-08, Option 1): each term
// opens with "Term: …", its College / Major table, then the course rows with a
// Level column, and closes with "Term Totals (Undergraduate | Graduate)"; the
// TRANSCRIPT TOTALS block prints one line per level. No degree is printed.
// Invented content in the shape of the DGS's redacted copies: a Notre Dame
// bachelor's whose last undergraduate major is Computer Engineering, then CSE
// graduate terms — the earlier-degrees question reads "Notre Dame — CSE".
const insideNdTerm = (term, level, college, major, rows) => {
  // The term's own totals, added up from its rows (2026-10-11, item 11: the
  // import checks the hours it read against them; a constant line here made
  // every term disagree).
  const cells = rows.map((r) => r.split(/ {3,}/));
  const hours = cells.reduce((n, c) => n + Number(c[c.length - 2]), 0);
  const points = cells.reduce((n, c) => n + Number(c[c.length - 1]), 0);
  const f = (n) => n.toFixed(3);
  return [
    `Term: ${term}`,
    'College   Major   Academic Standing',
    `${college}   ${major}   Good Standing`,
    'Subject   Course   Campus   Level   Title   Grade   Credit Hours   Quality Points   R',
    ...rows,
    `Term Totals (${level})   Attempt Hours   Passed Hours   Earned Hours   GPA Hours   Quality Points   GPA`,
    `Current Term   ${f(hours)}   ${f(hours)}   ${f(hours)}   ${f(hours)}   ${f(points)}   ${(points / hours).toFixed(2)}`,
  ];
};
const ND_INSIDEND = [
  'University of Notre Dame',
  'Unofficial Academic Transcript',
  'INSTITUTION CREDIT',
  ...insideNdTerm('Fall Semester 2021', 'Undergraduate', 'First Year of Studies', 'Computer Science', ['MATH 10550   Main   UG   Calculus I   A   4.000   16.000']),
  ...insideNdTerm('Spring Semester 2025', 'Undergraduate', 'College of Engineering', 'Computer Engineering', ['CSE 40113   Main   UG   Design/Analysis of Algorithms   A   3.000   12.000']),
  ...insideNdTerm('Fall Semester 2025', 'Graduate', 'College of Engineering', 'Computer Science & Engineering', ['CSE 60111   Main   GR   Complexity and Algorithms   A   3.000   12.000']),
  ...insideNdTerm('Spring Semester 2026', 'Graduate', 'College of Engineering', 'Computer Science & Engineering', ['CSE 60641   Main   GR   Graduate Operating Systems   A   3.000   12.000']),
  'TRANSCRIPT TOTALS',
  'Transcript Totals   Attempt Hours   Passed Hours   Earned Hours   GPA Hours   Quality Points   GPA',
  '( Graduate )',
  'Overall   6.000   6.000   6.000   6.000   24.000   4.00',
  '( Undergraduate )',
  'Overall   7.000   7.000   7.000   7.000   28.000   4.00',
  'COURSE(S) IN PROGRESS',
  'Term: Fall Semester 2026',
  'College   Major',
  'College of Engineering   Computer Science & Engineering',
  'CSE 60876   Main   GR   Research Methods   3.000',
];

writeFileSync(join(here, 'nd-transcript.pdf'), makePdf(ND));
// The same record as an OFFICIAL transcript (DGS 2026-09-15: a previous-degree
// slot refuses anything marked unofficial), for the ND-in-a-previous-slot flow.
writeFileSync(join(here, 'nd-official-transcript.pdf'), makePdf(ND.map((l) => (l === 'Unofficial Academic Transcript' ? 'Official Academic Transcript' : l)).filter((l) => l !== 'This is not an official transcript.')));
writeFileSync(join(here, 'nd-undergrad-transcript.pdf'), makePdf(ND_UNDERGRAD));
writeFileSync(join(here, 'nd-undergrad-in-progress-transcript.pdf'), makePdf(ND_UNDERGRAD_IN_PROGRESS));
writeFileSync(join(here, 'combined-transcript.pdf'), makePdf(COMBINED));
// Each cell at its column's x, as insideND draws the tables (a single text
// stream would close the gaps the College / Major split relies on).
const insideNdColumns = (cells) =>
  cells.length === 9 ? [40, 75, 110, 145, 175, 330, 360, 410, 470] // the course table's header
  : cells.length === 7 && /^[A-Z]{2,5} \d{5}$/.test(cells[0]) ? [40, 110, 145, 175, 330, 360, 410] // a course row
  : cells.length === 7 ? [40, 170, 230, 290, 350, 400, 470] // a totals row
  : cells.length === 5 ? [40, 110, 145, 175, 360] // a course in progress
  : [40, 200, 400]; // College / Major (/ Academic Standing), or a single line
writeFileSync(join(here, 'nd-insidend-transcript.pdf'), makePositionedPdf([
  ND_INSIDEND.flatMap((line, i) => {
    const cells = line.split(/ {3,}/);
    const xs = insideNdColumns(cells);
    return cells.map((text, c) => ({ x: xs[c], y: 760 - 11 * i, text, size: 7 }));
  }),
]));
writeFileSync(join(here, 'other-transcript.pdf'), makePdf(OTHER));
writeFileSync(join(here, 'external-transcript.pdf'), makePdf(EXTERNAL));
writeFileSync(join(here, 'uc-system-transcript.pdf'), makePdf(UC_SYSTEM));
writeFileSync(join(here, 'no-lines-transcript.pdf'), makePdf(NO_LINES));
writeFileSync(join(here, 'course-outline.pdf'), makePdf(OUTLINE));
// Each cell at its column's x (a single text stream closes the gaps the
// header's cells are lined up by): title, credit, result, course type.
writeFileSync(join(here, 'codeless-transcript.pdf'), makePositionedPdf([
  CODELESS.flatMap((line, i) => {
    const cells = line.split(/ {3,}/);
    const xs = cells.length === 4 ? [40, 260, 320, 380] : cells.length === 2 ? [40, 260] : [40];
    return cells.map((text, c) => ({ x: xs[c], y: 750 - 14 * i, text, size: 9 }));
  }),
]));
writeFileSync(join(here, 'banner-transcript.pdf'), makePositionedPdf(bannerPages()));

// The same transcript over a text watermark (2026-09-05: real UMass / Western
// Ontario transcripts repeat the university's name across the background —
// horizontal light-gray tiles here, plus a diagonal banner). Must parse
// identically to banner-transcript.pdf.
function watermarked(pages) {
  return pages.map((runs) => {
    const out = [...runs];
    for (let y = 775; y > 20; y -= 37) {
      for (const x of [15, 215, 415]) out.push({ x, y, text: 'Example Institute of Technology', size: 9, gray: 0.85 });
    }
    for (let y = 650; y > 100; y -= 180) out.push({ x: 80, y, text: 'EXAMPLE INSTITUTE OF TECHNOLOGY', size: 28, gray: 0.9, angle: 30 });
    return out;
  });
}
writeFileSync(join(here, 'banner-watermarked-transcript.pdf'), makePositionedPdf(watermarked(bannerPages())));
console.log('wrote nd-transcript.pdf, other-transcript.pdf, external-transcript.pdf, banner-transcript.pdf and banner-watermarked-transcript.pdf');
