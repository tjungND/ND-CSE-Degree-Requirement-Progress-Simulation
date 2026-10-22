// Where the two pages link to EACH OTHER (DGS 2026-09-16). Standalone, each
// links to its sibling file next to it. Embedded in an <iframe> on cse.nd.edu,
// a relative link would load the sibling INSIDE the frame — the student sees
// the bare app page instead of the WordPress page that hosts it. So the
// embed's iframe src names the host pages, and the links then go to those,
// in the top window:
//
//   <iframe src="…/index.html?course_rules_url=https://cse.nd.edu/…/course-rules/">
//   <iframe src="…/courses.html?self_check_url=https://cse.nd.edu/…/degree-self-check/">
//
// Only http(s) URLs are honoured — a javascript: or data: value in a query
// string is ignored, since the value comes from the page's address.
export type SiblingPage = 'self-check' | 'course-rules';

export interface SiblingLink {
  href: string;
  /** `_top` when the link leaves the iframe for the host page. */
  target?: '_top';
}

export const SIBLING_PARAM: Record<SiblingPage, string> = { 'self-check': 'self_check_url', 'course-rules': 'course_rules_url' };
const RELATIVE: Record<SiblingPage, string> = { 'self-check': './index.html', 'course-rules': './courses.html' };
/** The ND pages that frame the two apps today (DGS 2026-09-30: "if they link
 * to the other in the embed mode, they should go to the ND pages, not the
 * full pages"). In embed mode a cross-link goes here unless the iframe src
 * names a host page itself (SIBLING_PARAM), which still wins — so a page moved
 * on the ND site works either by editing the iframe's address or this map. */
export const DEFAULT_HOST_PAGES: Record<SiblingPage, string> = {
  'self-check': 'https://sites.nd.edu/csedept/degree-requirement-self-checking/',
  'course-rules': 'https://sites.nd.edu/csedept/courses-and-rules/',
};

/** Which hosts this parameter may name: Notre Dame, and nowhere else.
 *
 * The parameter exists so the two WordPress pages can link to each other
 * instead of to the bare app, and those pages are always on an ND host. It
 * accepted ANY http(s) URL until 2026-09-18 (review R-2), which made an
 * official-looking page into a one-click hop to anywhere: the three links that
 * read "degree self-check tool" carried the attacker's address, opened it in
 * the top window, and the destination was never shown. A host allowlist costs
 * the real use nothing. */
export function allowedHostPage(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  // https only (an ND page is), no credentials in the URL — "https://nd.edu@evil.example"
  // reads as nd.edu to a human and resolves to evil.example.
  if (u.protocol !== 'https:' || u.username !== '' || u.password !== '') return false;
  return u.hostname === 'nd.edu' || u.hostname.endsWith('.nd.edu');
}

/** The link for `page`, given this page's query string (`location.search`)
 * and whether this page is embedded: a host page named in the query string;
 * else, embedded, the ND page that frames the sibling (DEFAULT_HOST_PAGES);
 * else the sibling file next to this one.
 *
 * `query` is appended to the RELATIVE sibling only (blue-team review
 * 2026-10-17, U29: the self-check sends `{ view: program }`, so a Ph.D.
 * student opens the Ph.D. degree-credit view of the course rules — the view
 * picks columns, never rows, P-19). A host page is a WordPress page, which
 * cannot take a query (DGS 2026-09-30), so it never gets one. */
export function siblingLink(page: SiblingPage, search: string, embedded = false, query?: Record<string, string>): SiblingLink {
  const raw = new URLSearchParams(search).get(SIBLING_PARAM[page])?.trim() ?? '';
  if (allowedHostPage(raw)) return { href: raw, target: '_top' };
  if (embedded) return { href: DEFAULT_HOST_PAGES[page], target: '_top' };
  const qs = query ? new URLSearchParams(query).toString() : '';
  return { href: qs ? `${RELATIVE[page]}?${qs}` : RELATIVE[page] };
}

/** Anchor attributes for the sibling link: a host page — named in the query
 * string, or the ND page by default when embedded (2026-09-30) — opens in the
 * top window; standalone, the relative sibling file (with `query`, U29). */
export function siblingAnchorAttrs(page: SiblingPage, search: string, embedded: boolean, query?: Record<string, string>): Record<string, string> {
  const link = siblingLink(page, search, embedded, query);
  return link.target ? { href: link.href, target: '_top', rel: 'noopener' } : { href: link.href };
}
