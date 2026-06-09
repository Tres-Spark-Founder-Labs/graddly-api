import { Apprentice } from '../apprentices/entities/apprentice.entity.js';
import { CommitmentSignature } from '../commitments/entities/commitment-signature.entity.js';
import { CommitmentStatementGroup } from '../commitments/entities/commitment-statement-group.entity.js';
import { CommitmentStatement } from '../commitments/entities/commitment-statement.entity.js';
import { DasLevyBalance } from '../das/entities/das-levy-balance.entity.js';
import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { IlrLearnerRecord } from '../ilr/entities/ilr-learner-record.entity.js';
import { IlrSubmission } from '../ilr/entities/ilr-submission.entity.js';
import { Invitation } from '../invitations/entities/invitation.entity.js';
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

  if (
    entityType === 'programmes' ||
    entityType === 'standards' ||
    entityType === 'apprentices' ||
    entityType === 'enrolments' ||
    entityType === 'das_levy_balances' ||
    entityType === 'otj_log_entries' ||
    entityType === 'qip_actions' ||
    entityType === 'reviews' ||
    entityType === 'review_records' ||
    entityType === 'review_signatures' ||
    entityType === 'commitment_statement_groups' ||
    entityType === 'commitment_statements' ||
    entityType === 'commitment_signatures' ||
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
    ctor === OtjLogEntry ||
    ctor === QipAction ||
    ctor === Review ||
    ctor === ReviewRecord ||
    ctor === ReviewSignature ||
    ctor === CommitmentStatementGroup ||
    ctor === CommitmentStatement ||
    ctor === CommitmentSignature ||
    ctor === KsbDefinition ||
    ctor === KsEvidenceItem ||
    ctor === KsEvidenceKsbMapping ||
    ctor === EnrolmentKsbCoverage ||
    ctor === IlrLearnerRecord ||
    ctor === IlrSubmission ||
    ctor === WithdrawalCompletionPush
  );
}
