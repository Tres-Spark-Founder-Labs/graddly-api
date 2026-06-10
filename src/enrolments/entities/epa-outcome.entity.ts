import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { BaseEntity } from '../../common/entities/base.entity.js';
import { EpaOutcome } from '../enums/epa-outcome.enum.js';

import { Enrolment } from './enrolment.entity.js';

@Entity('epa_outcomes')
@Index('UQ_epa_outcomes_enrolment', ['enrolmentId'], {
  unique: true,
  where: `"isDeleted" = false`,
})
export class EpaOutcomeRecord extends BaseEntity {
  @Column({ type: 'uuid' })
  organisationId!: string;

  @Column({ type: 'uuid' })
  enrolmentId!: string;

  @ManyToOne(() => Enrolment, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'enrolmentId' })
  enrolment!: Enrolment;

  @Column({
    type: 'enum',
    enum: EpaOutcome,
    enumName: 'epa_outcome',
  })
  outcome!: EpaOutcome;

  @Column({ type: 'date' })
  assessedOn!: string;

  @Column({ type: 'uuid', nullable: true })
  recordedByUserId!: string | null;
}
