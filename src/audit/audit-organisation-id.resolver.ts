import { Apprentice } from '../apprentices/entities/apprentice.entity.js';
import { CommitmentChaseDispatch } from '../commitments/entities/commitment-chase-dispatch.entity.js';
import { CommitmentSignature } from '../commitments/entities/commitment-signature.entity.js';
import { CommitmentStatementGroup } from '../commitments/entities/commitment-statement-group.entity.js';
import { CommitmentStatement } from '../commitments/entities/commitment-statement.entity.js';
import { EnrolmentCompletionPush } from '../completion-push/entities/enrolment-completion-push.entity.js';
import { DasFundingPayment } from '../das/entities/das-funding-payment.entity.js';
import { DasLevyBalance } from '../das/entities/das-levy-balance.entity.js';
import { DasLevyMonthlyEntry } from '../das/entities/das-levy-monthly-entry.entity.js';
import { EnrolmentSubmissionPush } from '../enrolment-push/entities/enrolment-submission-push.entity.js';
import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { EpaOutcomeRecord } from '../enrolments/entities/epa-outcome.entity.js';
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
  | WithdrawalCompletionPush
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
    ctor === WithdrawalCompletionPush
  );
}
