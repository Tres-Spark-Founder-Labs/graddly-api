import { Column, Entity, Index } from 'typeorm';

import { BaseEntity } from '../../common/entities/base.entity.js';
import { EnrolmentPushStatus } from '../enums/enrolment-push-status.enum.js';
import { EnrolmentPushTrigger } from '../enums/enrolment-push-trigger.enum.js';

@Entity('enrolment_submission_pushes')
@Index('IDX_enrolment_push_org_status_created', [
  'organisationId',
  'status',
  'createdAt',
])
@Index('UQ_enrolment_push_ilr_trigger', ['ilrLearnerRecordId', 'trigger'], {
  unique: true,
  where: `"isDeleted" = false`,
})
export class EnrolmentSubmissionPush extends BaseEntity {
  @Column({ type: 'uuid' })
  organisationId!: string;

  @Column({ type: 'uuid' })
  enrolmentId!: string;

  @Column({ type: 'uuid' })
  apprenticeId!: string;

  @Column({ type: 'uuid' })
  ilrLearnerRecordId!: string;

  @Column({ type: 'uuid', nullable: true })
  ilrSubmissionId!: string | null;

  @Column({
    type: 'enum',
    enum: EnrolmentPushTrigger,
    enumName: 'enrolment_push_trigger',
  })
  trigger!: EnrolmentPushTrigger;

  @Column({
    type: 'enum',
    enum: EnrolmentPushStatus,
    enumName: 'enrolment_push_status',
    default: EnrolmentPushStatus.QUEUED,
  })
  status!: EnrolmentPushStatus;

  @Column({ type: 'int', default: 0 })
  attempts!: number;

  @Column({ type: 'text', nullable: true })
  lastError!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  nextRetryAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  deliveredAt!: Date | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  dasReference!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  manualRetryRequestedAt!: Date | null;

  @Column({ type: 'jsonb' })
  payload!: Record<string, unknown>;
}
