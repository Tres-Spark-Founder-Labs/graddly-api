import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { Apprentice } from '../../apprentices/entities/apprentice.entity.js';
import { BaseEntity } from '../../common/entities/base.entity.js';
import { Enrolment } from '../../enrolments/entities/enrolment.entity.js';
import { Organisation } from '../../organisations/entities/organisation.entity.js';
import { OtjActivityCategory } from '../enums/otj-activity-category.enum.js';
import { OtjLogStatus } from '../enums/otj-log-status.enum.js';

@Entity('otj_log_entries')
@Index('IDX_otj_log_entries_org_status_created', [
  'organisationId',
  'status',
  'createdAt',
])
@Index('IDX_otj_log_entries_org_apprentice_logged_date', [
  'organisationId',
  'apprenticeId',
  'loggedDate',
])
@Index('IDX_otj_log_entries_org_enrolment_logged_date', [
  'organisationId',
  'enrolmentId',
  'loggedDate',
])
@Index('IDX_otj_log_entries_org_category', ['organisationId', 'category'])
export class OtjLogEntry extends BaseEntity {
  @Column({ type: 'uuid' })
  organisationId!: string;

  @ManyToOne(() => Organisation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organisationId' })
  organisation!: Organisation;

  @Column({ type: 'uuid' })
  enrolmentId!: string;

  @ManyToOne(() => Enrolment, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'enrolmentId' })
  enrolment!: Enrolment;

  @Column({ type: 'uuid' })
  apprenticeId!: string;

  @ManyToOne(() => Apprentice, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'apprenticeId' })
  apprentice!: Apprentice;

  @Column({ type: 'date' })
  loggedDate!: string;

  @Column({ type: 'int' })
  minutes!: number;

  @Column({ type: 'varchar', length: 80 })
  activityName!: string;

  @Column({
    type: 'enum',
    enum: OtjActivityCategory,
    enumName: 'otj_activity_category',
    default: OtjActivityCategory.OTHER,
  })
  category!: OtjActivityCategory;

  @Column({ type: 'text', nullable: true })
  note!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  evidence!: Record<string, unknown> | null;

  @Column({
    type: 'enum',
    enum: OtjLogStatus,
    enumName: 'otj_log_status',
    default: OtjLogStatus.DRAFT,
  })
  status!: OtjLogStatus;

  @Column({ type: 'uuid', nullable: true })
  approvedByUserId!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  approvedAt!: Date | null;

  @Column({ type: 'uuid', nullable: true })
  rejectedByUserId!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  rejectedAt!: Date | null;

  @Column({ type: 'text', nullable: true })
  rejectionReason!: string | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  paceFlag!: string | null;
}
