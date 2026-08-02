import { OrganisationRole } from '../../organisations/organisation-role.enum.js';

import { Capability } from './capability.enum.js';

/**
 * **The one file to change when the client answers decision 13.**
 *
 * Maps each named action to the organisation roles allowed to perform it.
 * Every capability-guarded endpoint reads its rule from here, so moving a
 * capability between tiers changes the behaviour everywhere at once.
 *
 * The current mapping is the recommendation put to the client: three tiers,
 * not five roles. Owner and Admin cover Programme Manager, Quality Manager
 * and Compliance Officer — the people accountable for funding claims and for
 * what an inspector reads. Member covers Tutor and Curriculum Lead, whose
 * work is the day-to-day learner record.
 *
 * **This is a default, not a decision.** It is written down so the platform
 * behaves consistently while the question is open, and so the answer costs a
 * line rather than an audit of every controller.
 */
export const CAPABILITY_ROLES: Readonly<
  Record<Capability, readonly OrganisationRole[]>
> = Object.freeze({
  /**
   * Restricted deliberately. An ILR submission is a funding claim to the
   * ESFA; submitting the wrong thing, or submitting early, is a money and
   * audit problem rather than an inconvenience.
   */
  [Capability.SUBMIT_ILR]: [OrganisationRole.OWNER, OrganisationRole.ADMIN],

  /** Changes someone's programme, and feeds a withdrawal push to the ESFA. */
  [Capability.WITHDRAW_LEARNER]: [
    OrganisationRole.OWNER,
    OrganisationRole.ADMIN,
  ],

  /** The QIP is read by an Ofsted inspector; its shape is a leadership act. */
  [Capability.MANAGE_QIP]: [OrganisationRole.OWNER, OrganisationRole.ADMIN],

  /**
   * Deliberately wider than MANAGE_QIP. A tutor who has done the work
   * described by an action is the right person to mark it done and attach the
   * evidence; deciding what the plan *contains* is a separate act.
   */
  [Capability.COMPLETE_QIP_ACTION]: [
    OrganisationRole.OWNER,
    OrganisationRole.ADMIN,
    OrganisationRole.MEMBER,
  ],

  /**
   * Narrower than MANAGE_QIP in spirit even though the roles match. The SAR
   * is the provider's own judgement of itself, and locking one creates a
   * record they will be held to at inspection. There is no wider sibling
   * capability here because there is no part of writing a self-assessment
   * that is day-to-day delivery work.
   */
  [Capability.MANAGE_SAR]: [OrganisationRole.OWNER, OrganisationRole.ADMIN],

  /** Core tutor work. */
  [Capability.RECORD_REVIEW]: [
    OrganisationRole.OWNER,
    OrganisationRole.ADMIN,
    OrganisationRole.MEMBER,
  ],

  /**
   * Employer-side approval is already restricted to OWNER/ADMIN by F1.2.3.
   * Provider-side sign-off is day-to-day tutor work, so this is wider — the
   * two portals genuinely differ here, which is why it is a capability and
   * not a shared constant.
   */
  [Capability.APPROVE_OTJ]: [
    OrganisationRole.OWNER,
    OrganisationRole.ADMIN,
    OrganisationRole.MEMBER,
  ],

  /**
   * Wide on purpose. The pack contains only what the provider already holds,
   * and being unable to produce evidence during an inspection because the
   * one admin is on leave is a worse failure than a tutor downloading it.
   */
  [Capability.DOWNLOAD_EVIDENCE_PACK]: [
    OrganisationRole.OWNER,
    OrganisationRole.ADMIN,
    OrganisationRole.MEMBER,
  ],

  /** Granting permissions is the one action that can widen every other one. */
  [Capability.MANAGE_STAFF]: [OrganisationRole.OWNER, OrganisationRole.ADMIN],
});

/** Whether any of a user's roles satisfies the capability. */
export function rolesSatisfyCapability(
  roles: readonly string[],
  capability: Capability,
): boolean {
  const allowed = CAPABILITY_ROLES[capability];
  return allowed.some((role) => roles.includes(role));
}
