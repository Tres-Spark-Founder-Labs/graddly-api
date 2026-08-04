import { CommitmentSignature } from '../commitments/entities/commitment-signature.entity.js';
import { CommitmentStatementGroup } from '../commitments/entities/commitment-statement-group.entity.js';
import { CommitmentStatement } from '../commitments/entities/commitment-statement.entity.js';
import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { Invitation } from '../invitations/entities/invitation.entity.js';
import { OrganisationMembership } from '../organisations/entities/organisation-membership.entity.js';
import { Organisation } from '../organisations/entities/organisation.entity.js';
import { OtjLogEntry } from '../otj/entities/otj-log-entry.entity.js';

export const AUDITED_ENTITIES = new Set([
  Organisation,
  OrganisationMembership,
  Invitation,
  /**
   * F2.2.5 AC4 — "tutor reassignment is tracked in the audit trail".
   *
   * The enrolment is where the tutor lives, so auditing it is what makes
   * reassignment traceable — who moved which learner to which tutor, and
   * when. It also covers the rest of the enrolment record, which is the
   * platform's core funding object and arguably should have been audited
   * from the start.
   *
   * Note the constraint this places on callers: the subscriber fires on
   * `repo.save()` and NOT on `repo.update()` or QueryBuilder writes, so any
   * code that changes an enrolment must save entities rather than issue a
   * bulk update, or the change happens with no trail at all.
   */
  Enrolment,
  // F1.2.3 AC8 — "all approval actions are timestamped and stored in the audit
  // trail". The entry itself records approvedAt/approvedByUserId and
  // rejectedAt/rejectedByUserId, but that is current state, not history: a
  // reject-then-approve overwrites the rejection and leaves no evidence it
  // happened. The subscriber captures each transition as its own row.
  //
  // Approvals persist through `repo.save()`, which is what makes this work —
  // TypeORM subscribers do not fire for QueryBuilder updates.
  OtjLogEntry,
  // F1.3.3 AC1 — "a complete, immutable audit trail for every commitment
  // statement". None of these were audited, so the document the PRD singles
  // out for Ofsted evidence had no trail at all: not its creation, not its
  // edits, not its signatures.
  //
  // All three are needed rather than the statement alone. A signature is a
  // row on `commitment_signatures`, and a new version is a row on
  // `commitment_statements` within a `commitment_statement_groups` record —
  // auditing only the statement would miss who signed and when.
  //
  // Views are not covered here. A subscriber fires on writes; reading leaves
  // no row change to observe, so `AuditAction.VIEW` is recorded explicitly by
  // the service that serves the read.
  CommitmentStatement,
  CommitmentSignature,
  CommitmentStatementGroup,
]);

export const AUDIT_EXCLUDED_FIELDS = new Set([
  'password',
  'passwordHash',
  'updatedAt',
  'createdAt',
  'deletedAt',
  'isDeleted',
  'id',
]);

export const AUDIT_RELATION_FIELDS = new Set([
  'user',
  'organisation',
  'invitedBy',
  'memberships',
]);
