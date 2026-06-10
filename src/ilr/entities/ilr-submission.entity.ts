import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { BaseEntity } from '../../common/entities/base.entity.js';
import { Organisation } from '../../organisations/entities/organisation.entity.js';
import { IlrSubmissionStatus } from '../enums/ilr-submission-status.enum.js';

import { IlrLearnerRecord } from './ilr-learner-record.entity.js';

@Entity('ilr_submissions')
@Index('IDX_ilr_submissions_org_record_created', [
  'organisationId',
  'ilrLearnerRecordId',
  'createdAt',
])
export class IlrSubmission extends BaseEntity {
  @Column({ type: 'uuid' })
  organisationId!: string;

  @ManyToOne(() => Organisation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organisationId' })
  organisation!: Organisation;

  @Column({ type: 'uuid' })
  ilrLearnerRecordId!: string;

  @ManyToOne(() => IlrLearnerRecord, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'ilrLearnerRecordId' })
  ilrLearnerRecord!: IlrLearnerRecord;

  @Column({ type: 'int' })
  attempt!: number;

  @Column({ type: 'boolean', default: false })
  isAmendment!: boolean;

  @Column({ type: 'uuid', nullable: true })
  amendsSubmissionId!: string | null;

  @ManyToOne(() => IlrSubmission, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'amendsSubmissionId' })
  amendsSubmission!: IlrSubmission | null;

  @Column({
    type: 'enum',
    enum: IlrSubmissionStatus,
    enumName: 'ilr_submission_status',
    default: IlrSubmissionStatus.QUEUED,
  })
  status!: IlrSubmissionStatus;

  @Column({ type: 'varchar', length: 100, nullable: true })
  esfaReference!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  receipt!: Record<string, unknown> | null;

  @Column({ type: 'timestamptz', nullable: true })
  submittedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  failedAt!: Date | null;

  @Column({ type: 'text', nullable: true })
  lastError!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  requestPayload!: Record<string, unknown> | null;

  @Column({ type: 'uuid', nullable: true })
  requestedByUserId!: string | null;
}
