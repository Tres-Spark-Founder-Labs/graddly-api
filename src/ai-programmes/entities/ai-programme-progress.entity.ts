import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { BaseEntity } from '../../common/entities/base.entity.js';
import { Enrolment } from '../../enrolments/entities/enrolment.entity.js';
import { AiProgrammeModuleProgressStatus } from '../enums/ai-programme-module-progress-status.enum.js';

@Entity('ai_programme_progress')
@Index(
  'UQ_ai_programme_progress_enrolment_module',
  ['enrolmentId', 'moduleSlug'],
  {
    unique: true,
    where: `"isDeleted" = false`,
  },
)
export class AiProgrammeProgress extends BaseEntity {
  @Column({ type: 'uuid' })
  organisationId!: string;

  @Column({ type: 'uuid' })
  enrolmentId!: string;

  @ManyToOne(() => Enrolment, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'enrolmentId' })
  enrolment!: Enrolment;

  @Column({ type: 'varchar', length: 64 })
  moduleSlug!: string;

  @Column({
    type: 'enum',
    enum: AiProgrammeModuleProgressStatus,
    enumName: 'ai_programme_module_progress_status',
    default: AiProgrammeModuleProgressStatus.NOT_STARTED,
  })
  status!: AiProgrammeModuleProgressStatus;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;
}
