import { TripartiteParty } from '../signing/tripartite-party.enum.js';

/**
 * The order commitment statements are signed in.
 *
 * PRD §"Cross-portal flows": *"Commitment statement: Provider (P2) creates →
 * Employer (P1) e-signs → Apprentice (P3) e-signs"*. F3.4.1 AC6 says the same
 * thing from the other end — *"if the apprentice has not signed within 7 days
 * of the employer signing"* — which only makes sense if the employer signs
 * first.
 *
 * The implementation had it reversed. `TRIPARTITE_PARTY_ORDER` is
 * `[APPRENTICE, TUTOR, EMPLOYER_MANAGER]`, and `commitment-chase.service.ts`
 * enforces the sequence strictly (it only chases `signOrder === 1`), so the
 * apprentice was chased first and the employer signed last. That inverts the
 * specified flow, and it makes F1.3.1 AC3 — "statements requiring employer
 * signature sorted to the top" — nearly meaningless, because an employer
 * could only ever be waiting once both other parties had already signed.
 *
 * **Why this is a separate constant rather than a fix to
 * `TRIPARTITE_PARTY_ORDER`.** That constant lives in `src/signing/` and is
 * shared with `reviews-co-sign.service.ts`. Reviews are a different flow with
 * a different party set: the PRD has the provider recording, the employer
 * co-signing and the apprentice only *viewing* (§"Cross-portal flows"), while
 * F2.3.x describes the record as "co-signed by tutor and learner". Those two
 * statements do not agree with each other, but neither matches the commitment
 * order — so changing the shared constant to fix commitments would silently
 * reorder review signatures too.
 *
 * The tutor stays in the sequence at position 1, mapping "Provider creates" to
 * the provider's own signature on the document they drafted.
 */
export const COMMITMENT_SIGNING_ORDER: TripartiteParty[] = [
  TripartiteParty.TUTOR,
  TripartiteParty.EMPLOYER_MANAGER,
  TripartiteParty.APPRENTICE,
];
