import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { BaseEntity } from '../../common/entities/base.entity.js';
import { Organisation } from '../../organisations/entities/organisation.entity.js';
import { LevyTransferStatus } from '../enums/levy-transfer-status.enum.js';

import { LevyMatchApplication } from './levy-match-application.entity.js';

@Entity('levy_transfers')
@Index('IDX_levy_transfers_donor_status', ['donorOrganisationId', 'status'])
@Index('IDX_levy_transfers_recipient_status', [
  'recipientOrganisationId',
  'status',
])
export class LevyTransfer extends BaseEntity {
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

  @Column({ type: 'uuid', nullable: true })
  matchApplicationId!: string | null;

  @ManyToOne(() => LevyMatchApplication, {
    onDelete: 'SET NULL',
    nullable: true,
  })
  @JoinColumn({ name: 'matchApplicationId' })
  matchApplication!: LevyMatchApplication | null;

  @Column({ type: 'numeric', precision: 14, scale: 2 })
  amount!: string;

  @Column({ type: 'jsonb', nullable: true })
  programmeDetails!: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  esfaTransferReference!: string | null;

  @Column({
    type: 'enum',
    enum: LevyTransferStatus,
    enumName: 'levy_transfer_status',
    default: LevyTransferStatus.DRAFT,
  })
  status!: LevyTransferStatus;

  @Column({ type: 'date', nullable: true })
  startDate!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  confirmedAt!: Date | null;

  @Column({ type: 'date', nullable: true })
  expiryDate!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  dasStatusPayload!: Record<string, unknown> | null;
}
