// People students should contact, shown in the page footer and in the feedback
// notes. Not policy — names and addresses only. Since 2026-09-04 the names and
// emails come from the rules sheet's Parameters tab (contact_dgs_name,
// contact_dgs_email, contact_adgs_name, contact_adgs_email,
// contact_grad_admin_name, contact_grad_admin_email — see data/README.md), so
// a DGS handoff is a sheet edit, not a code change. The values below are the
// FALLBACK for keys that are missing or blank; refresh them occasionally so an
// offline snapshot without the keys still shows someone real.
// Also refresh the DGS address in index.html and courses.html <noscript> (two
// lines; HTML cannot read the sheet) — blue-team review 2026-10-17, U32.
import type { Parameters } from '../data/types.ts';
import { el } from './dom.ts';

export interface Contact {
  role: string;
  name: string;
  email: string;
  /** What to ask this person about. */
  scope: string;
}

export const CONTACTS: Contact[] = [
  {
    role: 'Director of Graduate Studies (DGS)',
    name: 'Taeho Jung',
    email: 'tjung@nd.edu',
    scope: 'decides every requirement for Ph.D. students; the graduate program in general',
  },
  {
    role: 'Assistant DGS (ADGS)',
    name: 'Aaron Dingler',
    email: 'adingler@nd.edu',
    // The same shape as the DGS line above; the three examples ("course
    // approvals, transfer credit, the review requests …") were subsumed by
    // "every requirement" and are still listed in the report's glossary
    // (trim review 2026-09-18, P-26; replaces the R-16 rewording of the same day).
    scope: 'decides every requirement for MSCSE students',
  },
  {
    role: 'Graduate Program Administrator (Grad Admin)',
    name: 'Cari White',
    email: 'csalmons@nd.edu',
    scope: 'processing and the official record: transfer credit, forms, the MSCSE along the way — and everything else',
  },
];

/** Overwrite the baked-in contacts with the sheet's Parameters values, when
 * present and non-blank (2026-09-04). Both pages call this right after the
 * rules load, before anything renders, so every place a name or address
 * appears — the contact card, the consent notice, the review-request
 * emails — shows the sheet's version. Mutates the Contact objects in place,
 * so the DGS/GRAD_ADMIN references below stay valid. */
export function applyContactOverrides(params: Parameters): void {
  const read = (key: string): string | undefined => {
    const v = params.raw.get(key)?.value.trim();
    return v ? v : undefined;
  };
  const apply = (c: Contact, prefix: string) => {
    c.name = read(`${prefix}_name`) ?? c.name;
    c.email = read(`${prefix}_email`) ?? c.email;
  };
  apply(CONTACTS[0]!, 'contact_dgs');
  apply(CONTACTS[1]!, 'contact_adgs');
  apply(CONTACTS[2]!, 'contact_grad_admin');
}

/** The DGS — the address error reports and feedback go to. */
export const DGS: Contact = CONTACTS[0]!;
export const ADGS: Contact = CONTACTS[1]!;
/** Who decides for this degree (DGS 2026-09-11): the ADGS for MSCSE students,
 * the DGS for Ph.D. students — every review request goes to that person. */
export function deciderContact(program: 'mscse' | 'phd'): Contact {
  return program === 'mscse' ? ADGS : DGS;
}

/** The Graduate Program Administrator ("Grad Admin", DGS 2026-09-06). Two people, two jobs
 * (DGS 2026-09-06 evening): the DGS decides eligibility — the review request goes to the DGS
 * alone — and the Grad Admin processes what has been decided: the processing request goes here,
 * with the DGS in cc. */
export const GRAD_ADMIN: Contact = CONTACTS.find((c) => c.role.startsWith('Graduate Program Administrator'))!;

/** Does this look like an e-mail address the page can put in a `mailto:`?
 * The six `contact_*` rows are typed into a spreadsheet, and whatever they
 * hold became the href of every contact link (review R-20, 2026-09-18) — a
 * stray space or a pasted "mailto:x@y" made a link that does nothing, and
 * nothing in the app said so. One local part, one @, one dotted domain, no
 * spaces and no colon (which is what would let a value carry its own scheme). */
export function looksLikeEmail(value: string): boolean {
  return /^[^\s:@]+@[^\s:@]+\.[^\s:@]{2,}$/.test(value.trim());
}

/** A mailto link showing the address itself. An address the sheet has mangled
 * is shown as plain text rather than as a link that goes nowhere. */
export function mailto(email: string): HTMLAnchorElement | HTMLElement {
  const value = email.trim();
  if (!looksLikeEmail(value)) return el('span', { class: 'bad-email', title: 'This address is not in the rules sheet in a usable form' }, value || '(no address in the rules sheet)');
  return el('a', { href: `mailto:${value}` }, value);
}

/** "…please email the DGS (tjung@nd.edu)." — used under the disclaimer and the PDF upload. */
export function reportToDgs(prefix: string): (string | Node)[] {
  return [prefix, ' the DGS (', mailto(DGS.email), ').'];
}

/** The "Who to contact" card: at the END of both pages — the self-check's
 * footer (B1, 2026-09-18) and the course-rules page's last block (its masthead
 * column above 900 px), and the footer of either in embed mode (2026-09-16). */
export function contactCard(): HTMLElement {
  // A region, not an <aside>: it sits inside the page header, and a
  // complementary landmark must not be nested in another landmark (WCAG /
  // axe "landmark-complementary-is-top-level"; usability review 2026-09-05).
  return el(
    'section',
    { class: 'contact-card', 'aria-label': 'Who to contact' },
    el('h2', {}, 'Who to contact'),
    el(
      'ul',
      {},
      ...CONTACTS.map((c) =>
        el(
          'li',
          {},
          el('span', { class: 'role' }, c.role),
          ': ',
          c.name,
          ' (',
          mailto(c.email),
          ')',
          el('span', { class: 'scope' }, c.scope),
        ),
      ),
    ),
  );
}

// The public source repository, linked from the footer's license line.
export const REPO_URL = 'https://github.com/tjungND/ND-CSE-Degree-Requirement-Progress-Simulation';
export const LICENSE_URL = `${REPO_URL}/blob/main/LICENSE.md`;
