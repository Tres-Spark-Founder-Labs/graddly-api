import { Column, Entity, Index } from 'typeorm';

import { BaseEntity } from '../../common/entities/base.entity.js';
import { CompletionPushStatus } from '../enums/completion-push-status.enum.js';
import { CompletionPushTrigger } from '../enums/completion-push-trigger.enum.js';

@Entity('enrolment_completion_pushes')
@Index('IDX_completion_push_org_status_created', [
  'organisationId',
  'status',
  'createdAt',
])
@Index('UQ_completion_push_enrolment_trigger', ['enrolmentId', 'trigger'], {
  unique: true,
  where: `"isDeleted" = false`,
})
export class EnrolmentCompletionPush extends BaseEntity {
  @Column({ type: 'uuid' })
  organisationId!: string;

  @Column({ type: 'uuid' })
  enrolmentId!: string;

  @Column({ type: 'uuid' })
  apprenticeId!: string;

  @Column({ type: 'uuid', nullable: true })
  epaOutcomeId!: string | null;

  @Column({
    type: 'enum',
    enum: CompletionPushTrigger,
    enumName: 'completion_push_trigger',
  })
  trigger!: CompletionPushTrigger;

  @Column({
    type: 'enum',
    enum: CompletionPushStatus,
    enumName: 'completion_push_status',
    default: CompletionPushStatus.QUEUED,
  })
  status!: CompletionPushStatus;

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
