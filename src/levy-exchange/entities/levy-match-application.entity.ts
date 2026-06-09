import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { BaseEntity } from '../../common/entities/base.entity.js';
import { Organisation } from '../../organisations/entities/organisation.entity.js';
import { LevyMatchApplicationStatus } from '../enums/levy-match-application-status.enum.js';

@Entity('levy_match_applications')
@Index('IDX_levy_match_applications_donor_status', [
  'donorOrganisationId',
  'status',
])
@Index('IDX_levy_match_applications_recipient_status', [
  'recipientOrganisationId',
  'status',
])
export class LevyMatchApplication extends BaseEntity {
  @Column({ type: 'uuid' })
  donorOrganisationId!: string;

  @ManyToOne(() => Organisation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'donorOrganisationId' })
  donorOrganisation!: Organisation;

  @Column({ type: 'uuid' })
  recipientOrganisationId!: string;

  @ManyToOne(() => Organisation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'recipientOrganisationId' })
  recipientOrganisation!: Organisation;

  @Column({ type: 'numeric', precision: 14, scale: 2 })
  requestedAmount!: string;

  @Column({
    type: 'enum',
    enum: LevyMatchApplicationStatus,
    enumName: 'levy_match_application_status',
    default: LevyMatchApplicationStatus.PENDING,
  })
  status!: LevyMatchApplicationStatus;

  @Column({ type: 'numeric', precision: 5, scale: 2, nullable: true })
  matchScore!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  scoreBreakdown!: Record<string, unknown> | null;
}
