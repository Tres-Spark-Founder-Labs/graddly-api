import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { BaseEntity } from '../../common/entities/base.entity.js';
import { Enrolment } from '../../enrolments/entities/enrolment.entity.js';

@Entity('ai_programme_completions')
@Index('UQ_ai_programme_completions_enrolment', ['enrolmentId'], {
  unique: true,
  where: `"isDeleted" = false`,
})
export class AiProgrammeCompletion extends BaseEntity {
  @Column({ type: 'uuid' })
  organisationId!: string;

  @Column({ type: 'uuid' })
  enrolmentId!: string;

  @ManyToOne(() => Enrolment, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'enrolmentId' })
  enrolment!: Enrolment;

  @Column({ type: 'timestamptz' })
  completedAt!: Date;

  @Column({ type: 'jsonb', nullable: true })
  summary!: Record<string, unknown> | null;
}
