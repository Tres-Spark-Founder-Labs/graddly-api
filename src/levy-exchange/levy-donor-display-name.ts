/**
 * F4.2.3 AC3 — "Each match displays: donor organisation name (or 'Matched
 * donor' if anonymous)".
 *
 * One label for one rule, shared by the two places the matching stage shows a
 * donor to an SME: the match search and the applications the SME has sent. It
 * means "this donor chose anonymous matching" and nothing else, so it is never
 * a fallback for a name the API could not find.
 */
export const ANONYMOUS_DONOR_DISPLAY_NAME = 'Matched donor';
