import { Apprentice } from '../apprentices/entities/apprentice.entity.js';
import { CommitmentChaseDispatch } from '../commitments/entities/commitment-chase-dispatch.entity.js';
import { CommitmentSignature } from '../commitments/entities/commitment-signature.entity.js';
import { CommitmentStatementGroup } from '../commitments/entities/commitment-statement-group.entity.js';
import { CommitmentStatement } from '../commitments/entities/commitment-statement.entity.js';
import { getCurrentOrganisationId } from '../common/context/correlation-id-context.js';
import { EnrolmentCompletionPush } from '../completion-push/entities/enrolment-completion-push.entity.js';
import { DasFundingPayment } from '../das/entities/das-funding-payment.entity.js';
import { DasLevyBalance } from '../das/entities/das-levy-balance.entity.js';
import { DasLevyMonthlyEntry } from '../das/entities/das-levy-monthly-entry.entity.js';
import { EnrolmentSubmissionPush } from '../enrolment-push/entities/enrolment-submission-push.entity.js';
import { BreakInLearning } from '../enrolments/entities/break-in-learning.entity.js';
import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { EpaOutcomeRecord } from '../enrolments/entities/epa-outcome.entity.js';
import { FundingClaimResolution } from '../ilr/entities/funding-claim-resolution.entity.js';
import { IlrLearnerRecord } from '../ilr/entities/ilr-learner-record.entity.js';
import { IlrSubmission } from '../ilr/entities/ilr-submission.entity.js';
import { Invitation } from '../invitations/entities/invitation.entity.js';
import { DasDonorLink } from '../levy-exchange/entities/das-donor-link.entity.js';
import { DasDonorOAuthToken } from '../levy-exchange/entities/das-donor-oauth-token.entity.js';
import { DasLevyTranche } from '../levy-exchange/entities/das-levy-tranche.entity.js';
import { LevyExpiryAlertDispatch } from '../levy-exchange/entities/levy-expiry-alert-dispatch.entity.js';
import { LevyMatchApplication } from '../levy-exchange/entities/levy-match-application.entity.js';
import { LevyRecipientProfile } from '../levy-exchange/entities/levy-recipient-profile.entity.js';
import { LevySurplusSnapshot } from '../levy-exchange/entities/levy-surplus-snapshot.entity.js';
import { LevyTransferDocument } from '../levy-exchange/entities/levy-transfer-document.entity.js';
import { LevyTransferPreference } from '../levy-exchange/entities/levy-transfer-preference.entity.js';
import { LevyTransferSignature } from '../levy-exchange/entities/levy-transfer-signature.entity.js';
import { LevyTransfer } from '../levy-exchange/entities/levy-transfer.entity.js';
import { LevyWaitingPoolEntry } from '../levy-exchange/entities/levy-waiting-pool-entry.entity.js';
import { MessageAttachment } from '../messaging/entities/message-attachment.entity.js';
import { MessageThread } from '../messaging/entities/message-thread.entity.js';
import { Message } from '../messaging/entities/message.entity.js';
import { QipAction } from '../ofsted/entities/qip-action.entity.js';
import { SafeguardingChecklistItem } from '../ofsted/entities/safeguarding-checklist-item.entity.js';
import { OrganisationMembership } from '../organisations/entities/organisation-membership.entity.js';
import { Organisation } from '../organisations/entities/organisation.entity.js';
import { OtjLogEntry } from '../otj/entities/otj-log-entry.entity.js';
import { EnrolmentKsbCoverage } from '../portfolio/entities/enrolment-ksb-coverage.entity.js';
import { KsEvidenceItem } from '../portfolio/entities/ks-evidence-item.entity.js';
import { KsEvidenceKsbMapping } from '../portfolio/entities/ks-evidence-ksb-mapping.entity.js';
import { KsbDefinition } from '../portfolio/entities/ksb-definition.entity.js';
import { Programme } from '../programmes/entities/programme.entity.js';
import { Standard } from '../programmes/entities/standard.entity.js';
import { ReviewRecord } from '../reviews/entities/review-record.entity.js';
import { ReviewSignature } from '../reviews/entities/review-signature.entity.js';
import { Review } from '../reviews/entities/review.entity.js';
import { User } from '../users/entities/user.entity.js';
import { WithdrawalCompletionPush } from '../withdrawal-push/entities/withdrawal-completion-push.entity.js';

export type OrganisationScopedEntity =
  | Organisation
  | OrganisationMembership
  | Invitation
  | Programme
  | Standard
  | Apprentice
  | Enrolment
  | DasLevyBalance
  | DasDonorLink
  | DasDonorOAuthToken
  | DasLevyTranche
  | LevySurplusSnapshot
  | LevyExpiryAlertDispatch
  | LevyRecipientProfile
  | LevyTransferPreference
  | LevyMatchApplication
  | LevyWaitingPoolEntry
  | LevyTransfer
  | LevyTransferDocument
  | LevyTransferSignature
  | MessageThread
  | Message
  | MessageAttachment
  | OtjLogEntry
  | QipAction
  | Review
  | ReviewRecord
  | ReviewSignature
  | CommitmentStatementGroup
  | CommitmentStatement
  | CommitmentSignature
  | KsbDefinition
  | KsEvidenceItem
  | KsEvidenceKsbMapping
  | EnrolmentKsbCoverage
  | IlrLearnerRecord
  | IlrSubmission
  | EnrolmentSubmissionPush
  | EnrolmentCompletionPush
  | EpaOutcomeRecord
  | BreakInLearning
  | FundingClaimResolution
  | SafeguardingChecklistItem
  | WithdrawalCompletionPush
  // Not organisation-scoped: see the `users` branch below.
  | User
  | (Record<string, unknown> & {
      organisationId?: string;
      organisation?: { id?: string };
    });

export function resolveAuditOrganisationId(
  entity: OrganisationScopedEntity,
  entityType: string,
): string | null {
  if (entityType === 'organisations') {
    const org = entity as Organisation;
    return org.id ?? null;
  }

  if (entityType === 'invitations') {
    const invitation = entity as Invitation;
    return invitation.organisationId ?? invitation.organisation?.id ?? null;
  }

  if (entityType === 'organisation_memberships') {
    const membership = entity as OrganisationMembership & {
      organisationId?: string;
    };
    return membership.organisationId ?? membership.organisation?.id ?? null;
  }

  /**
   * A user belongs to no organisation, so this branch exists to answer the
   * question deliberately rather than let `users` reach the `return null` at
   * the bottom of this function. That fall-through is what happened to
   * `programmes`: the row was written with a null organisation, and both the
   * RLS SELECT policy on `audit_log_entries` and `audit-export.service.ts`
   * compare `organisationId` to the current organisation, which is never true
   * for NULL. The row existed and no tenant could read it.
   *
   * ── RESOLVED THROUGH MEMBERSHIP, NOT LEFT NULL ──────────────────────────────
   *
   * Of the two options, "allow null for this entity" would mean an account
   * takeover left a row nobody can retrieve, which is the same outcome as not
   * auditing it — the trail has to be reachable by the people who would act
   * on it. So the organisation is resolved, in this order:
   *
   *   1. the subject's own membership, when the relation is loaded. The
   *      record belongs to the organisation whose person it is, not to
   *      whoever happened to make the change: an admin editing a user from a
   *      second organisation must not file the evidence where that user's own
   *      administrators cannot see it.
   *   2. the acting organisation context, which is what the memberships
   *      relation is not loaded on the ordinary save path. It is the
   *      organisation the request was made in, so the actor can always
   *      retrieve what they did.
   *
   * ── WHEN IT IS STILL NULL, AND WHY THAT IS HONEST ───────────────────────────
   *
   * Signup and OIDC provisioning create a user before any membership exists
   * and outside any organisation context (F1.2.5 AC1/AC3 — "invited" and
   * "account created" both precede membership). There is no tenant to own
   * that row, and inventing one would file a stranger's account creation
   * inside an organisation they have not joined. Those rows are readable
   * under `app_rls_bootstrap()` — a platform-level read — and not through the
   * tenant export. The membership that follows is audited in its own right.
   */
  if (entityType === 'users') {
    // Structural, not `User & {...}`: `User.memberships` is typed as
    // `OrganisationMembership[]`, whose own `organisationId` is not on the
    // class (the membership branch above casts for the same reason).
    const user = entity as {
      memberships?: {
        organisationId?: string;
        organisation?: { id?: string };
      }[];
    };
    const ownMembership = (user.memberships ?? []).find(
      (membership) => membership.organisationId ?? membership.organisation?.id,
    );
    return (
      ownMembership?.organisationId ??
      ownMembership?.organisation?.id ??
      getCurrentOrganisationId() ??
      null
    );
  }

  if (entityType === 'levy_match_applications') {
    const app = entity as LevyMatchApplication;
    return app.donorOrganisationId ?? app.recipientOrganisationId ?? null;
  }

  if (entityType === 'levy_transfers') {
    const transfer = entity as LevyTransfer;
    return (
      transfer.donorOrganisationId ?? transfer.recipientOrganisationId ?? null
    );
  }

  if (
    entityType === 'programmes' ||
    entityType === 'standards' ||
    entityType === 'apprentices' ||
    entityType === 'enrolments' ||
    entityType === 'das_levy_balances' ||
    entityType === 'das_levy_monthly_entries' ||
    entityType === 'das_funding_payments' ||
    entityType === 'das_donor_links' ||
    entityType === 'das_donor_oauth_tokens' ||
    entityType === 'das_levy_tranches' ||
    entityType === 'levy_surplus_snapshots' ||
    entityType === 'levy_expiry_alert_dispatches' ||
    entityType === 'levy_recipient_profiles' ||
    entityType === 'levy_transfer_preferences' ||
    entityType === 'levy_waiting_pool_entries' ||
    entityType === 'levy_transfer_documents' ||
    entityType === 'levy_transfer_signatures' ||
    entityType === 'message_threads' ||
    entityType === 'messages' ||
    entityType === 'message_attachments' ||
    entityType === 'otj_log_entries' ||
    entityType === 'qip_actions' ||
    entityType === 'reviews' ||
    entityType === 'review_records' ||
    entityType === 'review_signatures' ||
    entityType === 'commitment_statement_groups' ||
    entityType === 'commitment_statements' ||
    entityType === 'commitment_signatures' ||
    entityType === 'commitment_chase_dispatches' ||
    entityType === 'ksb_definitions' ||
    entityType === 'ks_evidence_items' ||
    entityType === 'ks_evidence_ksb_mappings' ||
    entityType === 'enrolment_ksb_coverage' ||
    entityType === 'ilr_learner_records' ||
    entityType === 'ilr_submissions' ||
    // Audit coverage pass — each carries an organisationId column, so the
    // generic branch is the right one; the reasons they are audited at all
    // are on `isAuditedEntity` below.
    entityType === 'epa_outcomes' ||
    entityType === 'break_in_learning' ||
    entityType === 'funding_claim_resolutions' ||
    entityType === 'safeguarding_checklist_items' ||
    entityType === 'withdrawal_completion_pushes'
  ) {
    const scoped = entity as { organisationId?: string };
    return scoped.organisationId ?? null;
  }

  return null;
}

export function isAuditedEntity(entity: unknown): boolean {
  if (entity === null || typeof entity !== 'object') {
    return false;
  }
  const ctor = entity.constructor;
  return (
    ctor === Organisation ||
    ctor === OrganisationMembership ||
    ctor === Invitation ||
    ctor === Programme ||
    ctor === Standard ||
    ctor === Apprentice ||
    ctor === Enrolment ||
    ctor === DasLevyBalance ||
    // Both carry manually-entered figures once DAS runs in manual mode, so the
    // trail has to name who typed them. Their table names were already in the
    // organisation resolver above; only this predicate was missing them, which
    // meant the rows were written and never audited.
    ctor === DasLevyMonthlyEntry ||
    ctor === DasFundingPayment ||
    ctor === DasDonorLink ||
    ctor === DasDonorOAuthToken ||
    ctor === DasLevyTranche ||
    ctor === LevySurplusSnapshot ||
    ctor === LevyExpiryAlertDispatch ||
    ctor === LevyRecipientProfile ||
    ctor === LevyTransferPreference ||
    ctor === LevyMatchApplication ||
    ctor === LevyWaitingPoolEntry ||
    ctor === LevyTransfer ||
    ctor === LevyTransferDocument ||
    ctor === LevyTransferSignature ||
    ctor === MessageThread ||
    ctor === Message ||
    ctor === MessageAttachment ||
    ctor === OtjLogEntry ||
    ctor === QipAction ||
    ctor === Review ||
    ctor === ReviewRecord ||
    ctor === ReviewSignature ||
    ctor === CommitmentStatementGroup ||
    ctor === CommitmentStatement ||
    ctor === CommitmentSignature ||
    ctor === CommitmentChaseDispatch ||
    ctor === KsbDefinition ||
    ctor === KsEvidenceItem ||
    ctor === KsEvidenceKsbMapping ||
    ctor === EnrolmentKsbCoverage ||
    ctor === IlrLearnerRecord ||
    ctor === IlrSubmission ||
    ctor === WithdrawalCompletionPush ||
    /**
     * Audit coverage pass — five entities that recorded decisions about
     * people with nobody's name against them.
     *
     * ── User ────────────────────────────────────────────────────────────────
     *
     * An email change is an account-takeover path: change the address, then
     * trigger a password reset, and the account is handed over. Until now
     * that left no trace anywhere.
     *
     * Two things to know before relying on this:
     *
     *   - `password`, `mfaSecret` and `mfaRecoveryCodes` are excluded by
     *     AUDIT_EXCLUDED_FIELDS. That is not tidiness. The audit table holds
     *     before/after JSON, is append-only by trigger (migration
     *     1781100000027) and is retained for seven years, so a credential
     *     written here cannot be corrected or deleted afterwards.
     *     `audit-credential-scrub.spec.ts` fails if any of them, or any
     *     newly-added credential column on an audited entity, can reach a
     *     payload.
     *   - the subscriber fires on `repo.save()` and not on `repo.update()`,
     *     so the write path decides whether a change is recorded.
     *     `users.service.ts` now loads and saves for `create`,
     *     `createFromOidc`, `updateProfile`, `markEmailVerified`,
     *     `enableMfa` and `disableMfa`, which reach this resolver. The three
     *     credential writes — `updatePassword`, `setPendingMfaSecret`,
     *     `setMfaRecoveryCodes` — cannot: their only changed columns are
     *     excluded, so the payload would be empty and no row written at all.
     *     Those record an explicit event through `AuditEventService`
     *     instead, with the action and no payload.
     *     `updateLastLoginAt` is the one deliberate exclusion; the reason is
     *     written on the method.
     *
     * A user's *role* is not on this entity: it is per-organisation on
     * `organisation_memberships`, which is audited above.
     */
    ctor === User ||
    /** Safeguarding. The one area where "who confirmed this" is the point. */
    ctor === SafeguardingChecklistItem ||
    /**
     * The assessment result: the most consequential row on a learner's
     * record, and the one that releases the completion payment.
     */
    ctor === EpaOutcomeRecord ||
    /**
     * A break moves the expected end date and the funding schedule with it,
     * and `reason` often holds health or caring detail — Article 9
     * special-category data, which makes "who entered this" matter twice.
     */
    ctor === BreakInLearning ||
    /**
     * Money. Closing a claim discrepancy is a financial decision and the row
     * holds only the current answer, never who reached it.
     */
    ctor === FundingClaimResolution
  );
}
