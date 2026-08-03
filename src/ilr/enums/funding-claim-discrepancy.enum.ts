/**
 * F2.3.2 AC7 — what kind of problem a funding claim has, if any.
 *
 * THE JUDGEMENT THAT MAKES THIS FEATURE USEFUL RATHER THAN NOISE:
 *
 * Apprenticeship funding is paid monthly across the programme. A learner six
 * months into a two-year apprenticeship has received a fraction of the agreed
 * price, and that is not a discrepancy — it is the funding model working
 * correctly. Defining "discrepancy" as `received < claimed` would flag every
 * in-flight learner on the platform, and a tracker that flags everything
 * flags nothing.
 *
 * So a shortfall only counts once the enrolment is **completed**, when the
 * funding should have finished arriving. Before that, an underpayment is
 * simply the programme being in progress.
 */
export enum FundingClaimDiscrepancy {
  /** Received matches claimed, or the programme is still legitimately in flight. */
  NONE = 'none',

  /**
   * The ESFA has issued a clawback notice against a payment. Always a
   * discrepancy regardless of the amounts — money is being reclaimed and
   * somebody has to answer for it.
   */
  CLAWBACK = 'clawback',

  /** Completed, but less arrived than was agreed. */
  SHORTFALL = 'shortfall',

  /** More arrived than was agreed. Rarer, and worth catching before the ESFA does. */
  OVERPAYMENT = 'overpayment',
}

/**
 * Where a provider has got to with a discrepancy.
 *
 * Stored rather than derived: "have we chased this" is a fact about what a
 * human did, and no amount of comparing numbers will produce it.
 */
export enum FundingClaimResolutionStatus {
  OPEN = 'open',
  INVESTIGATING = 'investigating',
  RESOLVED = 'resolved',
  /** Accepted as a loss. Closed, but distinct from resolved — the money did not arrive. */
  WRITTEN_OFF = 'written_off',
}
