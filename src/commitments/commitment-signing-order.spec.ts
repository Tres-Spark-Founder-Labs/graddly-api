import { TripartiteParty } from '../signing/tripartite-party.enum.js';

import { COMMITMENT_SIGNING_ORDER } from './commitment-signing-order.js';

/**
 * The order commitment statements are signed in, per the PRD:
 * "Provider (P2) creates → Employer (P1) e-signs → Apprentice (P3) e-signs".
 *
 * There was no test for this at all, which is how the implementation came to
 * hold the reverse order in two separate places. The existing co-sign spec
 * hardcoded the wrong order in a fixture and used it as given data, so it
 * passed either way.
 */
describe('COMMITMENT_SIGNING_ORDER', () => {
  it('matches the PRD sequence', () => {
    expect(COMMITMENT_SIGNING_ORDER).toEqual([
      TripartiteParty.TUTOR,
      TripartiteParty.EMPLOYER_MANAGER,
      TripartiteParty.APPRENTICE,
    ]);
  });

  it('puts the employer before the apprentice', () => {
    // F3.4.1 AC6 — "if the apprentice has not signed within 7 days of the
    // employer signing" — only makes sense in this direction. The previous
    // order had the apprentice signing first, so that reminder could never
    // fire as written.
    const employer = COMMITMENT_SIGNING_ORDER.indexOf(
      TripartiteParty.EMPLOYER_MANAGER,
    );
    const apprentice = COMMITMENT_SIGNING_ORDER.indexOf(
      TripartiteParty.APPRENTICE,
    );
    expect(employer).toBeLessThan(apprentice);
  });

  it('puts the provider first, since they draft the statement', () => {
    expect(COMMITMENT_SIGNING_ORDER[0]).toBe(TripartiteParty.TUTOR);
  });

  it('includes every party exactly once', () => {
    // A party dropped from this list would silently never be asked to sign.
    expect([...COMMITMENT_SIGNING_ORDER].sort()).toEqual(
      [...Object.values(TripartiteParty)].sort(),
    );
  });
});
