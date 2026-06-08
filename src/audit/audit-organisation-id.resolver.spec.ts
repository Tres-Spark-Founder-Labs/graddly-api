import { CommitmentSignature } from '../commitments/entities/commitment-signature.entity.js';
import { CommitmentStatementGroup } from '../commitments/entities/commitment-statement-group.entity.js';
import { CommitmentStatement } from '../commitments/entities/commitment-statement.entity.js';
import { IlrLearnerRecord } from '../ilr/entities/ilr-learner-record.entity.js';
import { IlrSubmission } from '../ilr/entities/ilr-submission.entity.js';
import { Invitation } from '../invitations/entities/invitation.entity.js';
import { OrganisationMembership } from '../organisations/entities/organisation-membership.entity.js';
import { Organisation } from '../organisations/entities/organisation.entity.js';
import { OrganisationRole } from '../organisations/organisation-role.enum.js';
import { OtjLogEntry } from '../otj/entities/otj-log-entry.entity.js';
import { KsEvidenceItem } from '../portfolio/entities/ks-evidence-item.entity.js';
import { KsbDefinition } from '../portfolio/entities/ksb-definition.entity.js';
import { ReviewRecord } from '../reviews/entities/review-record.entity.js';
import { ReviewSignature } from '../reviews/entities/review-signature.entity.js';
import { Review } from '../reviews/entities/review.entity.js';
import { WithdrawalCompletionPush } from '../withdrawal-push/entities/withdrawal-completion-push.entity.js';

import {
  isAuditedEntity,
  resolveAuditOrganisationId,
} from './audit-organisation-id.resolver.js';

describe('audit-organisation-id.resolver', () => {
  it('resolves organisation id for organisations', () => {
    const org = Object.assign(new Organisation(), { id: 'org-1' });
    expect(resolveAuditOrganisationId(org, 'organisations')).toBe('org-1');
  });

  it('resolves organisation id for invitations', () => {
    const invitation = Object.assign(new Invitation(), {
      organisationId: 'org-2',
    });
    expect(resolveAuditOrganisationId(invitation, 'invitations')).toBe('org-2');
  });

  it('resolves organisation id for memberships via relation', () => {
    const membership = Object.assign(new OrganisationMembership(), {
      organisation: { id: 'org-3' },
      role: OrganisationRole.MEMBER,
    });
    expect(
      resolveAuditOrganisationId(membership, 'organisation_memberships'),
    ).toBe('org-3');
  });

  it('resolves organisation id for otj log entries', () => {
    const entry = Object.assign(new OtjLogEntry(), {
      organisationId: 'org-otj',
    });
    expect(resolveAuditOrganisationId(entry, 'otj_log_entries')).toBe(
      'org-otj',
    );
  });

  it('resolves organisation id for reviews', () => {
    const review = Object.assign(new Review(), { organisationId: 'org-rev' });
    expect(resolveAuditOrganisationId(review, 'reviews')).toBe('org-rev');
  });

  it('resolves organisation id for review records', () => {
    const record = Object.assign(new ReviewRecord(), {
      organisationId: 'org-rec',
    });
    expect(resolveAuditOrganisationId(record, 'review_records')).toBe(
      'org-rec',
    );
  });

  it('resolves organisation id for review signatures', () => {
    const sig = Object.assign(new ReviewSignature(), {
      organisationId: 'org-sig',
    });
    expect(resolveAuditOrganisationId(sig, 'review_signatures')).toBe(
      'org-sig',
    );
  });

  it('resolves organisation id for commitment entities', () => {
    const group = Object.assign(new CommitmentStatementGroup(), {
      organisationId: 'org-com',
    });
    expect(
      resolveAuditOrganisationId(group, 'commitment_statement_groups'),
    ).toBe('org-com');

    const statement = Object.assign(new CommitmentStatement(), {
      organisationId: 'org-stmt',
    });
    expect(resolveAuditOrganisationId(statement, 'commitment_statements')).toBe(
      'org-stmt',
    );

    const sig = Object.assign(new CommitmentSignature(), {
      organisationId: 'org-csig',
    });
    expect(resolveAuditOrganisationId(sig, 'commitment_signatures')).toBe(
      'org-csig',
    );
  });

  it('resolves organisation id for portfolio entities', () => {
    const ksb = Object.assign(new KsbDefinition(), {
      organisationId: 'org-ksb',
    });
    expect(resolveAuditOrganisationId(ksb, 'ksb_definitions')).toBe('org-ksb');

    const evidence = Object.assign(new KsEvidenceItem(), {
      organisationId: 'org-ev',
    });
    expect(resolveAuditOrganisationId(evidence, 'ks_evidence_items')).toBe(
      'org-ev',
    );
  });

  it('resolves organisation id for ILR entities', () => {
    const record = Object.assign(new IlrLearnerRecord(), {
      organisationId: 'org-ilr',
    });
    expect(resolveAuditOrganisationId(record, 'ilr_learner_records')).toBe(
      'org-ilr',
    );

    const submission = Object.assign(new IlrSubmission(), {
      organisationId: 'org-sub',
    });
    expect(resolveAuditOrganisationId(submission, 'ilr_submissions')).toBe(
      'org-sub',
    );
  });

  it('resolves organisation id for withdrawal completion pushes', () => {
    const push = Object.assign(new WithdrawalCompletionPush(), {
      organisationId: 'org-push',
    });
    expect(
      resolveAuditOrganisationId(push, 'withdrawal_completion_pushes'),
    ).toBe('org-push');
  });

  it('isAuditedEntity returns true only for audited classes', () => {
    expect(isAuditedEntity(new Organisation())).toBe(true);
    expect(isAuditedEntity(new Invitation())).toBe(true);
    expect(isAuditedEntity(new OtjLogEntry())).toBe(true);
    expect(isAuditedEntity(new Review())).toBe(true);
    expect(isAuditedEntity(new ReviewRecord())).toBe(true);
    expect(isAuditedEntity(new ReviewSignature())).toBe(true);
    expect(isAuditedEntity(new CommitmentStatementGroup())).toBe(true);
    expect(isAuditedEntity(new CommitmentStatement())).toBe(true);
    expect(isAuditedEntity(new CommitmentSignature())).toBe(true);
    expect(isAuditedEntity(new KsbDefinition())).toBe(true);
    expect(isAuditedEntity(new KsEvidenceItem())).toBe(true);
    expect(isAuditedEntity(new IlrLearnerRecord())).toBe(true);
    expect(isAuditedEntity(new IlrSubmission())).toBe(true);
    expect(isAuditedEntity(new WithdrawalCompletionPush())).toBe(true);
    expect(isAuditedEntity({ id: 'x' })).toBe(false);
  });
});
