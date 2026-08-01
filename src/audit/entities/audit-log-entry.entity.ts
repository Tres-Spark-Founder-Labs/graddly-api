import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { AuditAction } from '../enums/audit-action.enum.js';

export type AuditFieldChange = {
  from?: unknown;
  to?: unknown;
};

export type AuditChanges = Record<string, AuditFieldChange>;

@Entity('audit_log_entries')
@Index('IDX_audit_log_org_created', ['organisationId', 'createdAt'])
@Index('IDX_audit_log_entity_created', ['entityType', 'entityId', 'createdAt'])
@Index('IDX_audit_log_org_entity_created', [
  'organisationId',
  'entityType',
  'createdAt',
])
export class AuditLogEntry {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @Column({ type: 'uuid', nullable: true })
  actorUserId!: string | null;

  /**
   * F1.3.3 AC2 — who acted, as they were at the time.
   *
   * Captured on write rather than joined on read: an audit trail must say
   * what someone's name and role *were when they acted*. Resolving from
   * `users` at read time would restate history whenever a person is renamed
   * or changes role, and a trail that rewrites itself is not evidence.
   *
   * `actorName` is personal data and is nulled by GDPR erasure, which is why
   * the immutability trigger permits it to change. `actorRole` is not
   * personal data — it describes a position, not a person — so it is fixed.
   */
  @Column({ type: 'varchar', length: 200, nullable: true })
  actorName!: string | null;

  @Column({ type: 'varchar', length: 60, nullable: true })
  actorRole!: string | null;

  /**
   * Human-readable summary of what was done, e.g. "Signed commitment
   * statement v2 as employer". The `changes` diff says which columns moved;
   * this says what the person did, which is what an inspector reads.
   */
  @Column({ type: 'varchar', length: 500, nullable: true })
  description!: string | null;

  @Column({ type: 'uuid', nullable: true })
  organisationId!: string | null;

  @Column({ type: 'varchar', length: 100 })
  entityType!: string;

  @Column({ type: 'uuid' })
  entityId!: string;

  @Column({
    type: 'enum',
    enum: AuditAction,
    enumName: 'audit_action',
  })
  action!: AuditAction;

  @Column({ type: 'jsonb' })
  changes!: AuditChanges;
}
