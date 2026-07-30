import { Invitation } from '../invitations/entities/invitation.entity.js';
import { OrganisationMembership } from '../organisations/entities/organisation-membership.entity.js';
import { Organisation } from '../organisations/entities/organisation.entity.js';
import { OtjLogEntry } from '../otj/entities/otj-log-entry.entity.js';

export const AUDITED_ENTITIES = new Set([
  Organisation,
  OrganisationMembership,
  Invitation,
  // F1.2.3 AC8 — "all approval actions are timestamped and stored in the audit
  // trail". The entry itself records approvedAt/approvedByUserId and
  // rejectedAt/rejectedByUserId, but that is current state, not history: a
  // reject-then-approve overwrites the rejection and leaves no evidence it
  // happened. The subscriber captures each transition as its own row.
  //
  // Approvals persist through `repo.save()`, which is what makes this work —
  // TypeORM subscribers do not fire for QueryBuilder updates.
  OtjLogEntry,
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
