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
