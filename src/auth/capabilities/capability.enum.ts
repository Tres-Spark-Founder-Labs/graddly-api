/**
 * Named things a user can be permitted to do, in the language of the job
 * rather than the language of the permission system.
 *
 * **Why this exists.** The PRD describes the Provider Portal's users by job
 * title — Programme Manager, Curriculum Lead, Tutor, Compliance Officer,
 * Quality Manager — and the platform has three permission levels: OWNER,
 * ADMIN, MEMBER. Those are different kinds of thing, and the mapping between
 * them is a client decision (see decision 13 in `DECISIONS-FOR-CLIENT.md`),
 * not an engineering one.
 *
 * Rather than block on that decision or scatter a guess across every
 * controller as `@Roles(OWNER, ADMIN)`, each consequential action gets a name
 * here and the role mapping lives in exactly one file. When the client
 * answers, moving a line in `capability-roles.ts` changes the rule
 * everywhere — no hunt through controllers, no risk of catching some
 * endpoints and missing others.
 *
 * **What belongs here.** Actions with consequences outside the platform, or
 * that a provider would reasonably want to restrict: an ESFA submission is a
 * funding claim, a withdrawal changes someone's programme, the QIP is read by
 * an inspector. Ordinary reads do not need a capability — organisation
 * scoping and row-level security already handle those, and naming everything
 * would make the important entries harder to see.
 */
export enum Capability {
  /** Submit an ILR file to the ESFA. A funding claim. */
  SUBMIT_ILR = 'submit_ilr',

  /** Withdraw a learner or otherwise change their enrolment status. */
  WITHDRAW_LEARNER = 'withdraw_learner',

  /** Create or edit the Quality Improvement Plan. */
  MANAGE_QIP = 'manage_qip',

  /** Mark a QIP action complete and attach its evidence. */
  COMPLETE_QIP_ACTION = 'complete_qip_action',

  /** Write, edit and lock the Self-Assessment Report. */
  MANAGE_SAR = 'manage_sar',

  /** Record and sign off a learner review. */
  RECORD_REVIEW = 'record_review',

  /** Approve or reject off-the-job hours. */
  APPROVE_OTJ = 'approve_otj',

  /** Generate and download the Ofsted evidence pack. */
  DOWNLOAD_EVIDENCE_PACK = 'download_evidence_pack',

  /** Invite staff and change their permissions. */
  MANAGE_STAFF = 'manage_staff',
}
