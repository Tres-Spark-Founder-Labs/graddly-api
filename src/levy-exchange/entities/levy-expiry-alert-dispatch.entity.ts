import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { BaseEntity } from '../../common/entities/base.entity.js';
import { LevyExpiryAlertType } from '../enums/levy-expiry-alert-type.enum.js';

import { DasDonorLink } from './das-donor-link.entity.js';
import { DasLevyTranche } from './das-levy-tranche.entity.js';

@Entity('levy_expiry_alert_dispatches')
@Index('UQ_levy_expiry_alert_dispatches', ['trancheId', 'alertType'], {
  unique: true,
  where: `"isDeleted" = false`,
})
export class LevyExpiryAlertDispatch extends BaseEntity {
  @Column({ type: 'uuid' })
  organisationId!: string;

  @Column({ type: 'uuid' })
  donorLinkId!: string;

  @ManyToOne(() => DasDonorLink, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'donorLinkId' })
  donorLink!: DasDonorLink;

  @Column({ type: 'uuid' })
  trancheId!: string;

  @ManyToOne(() => DasLevyTranche, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'trancheId' })
  tranche!: DasLevyTranche;

  @Column({
    type: 'enum',
    enum: LevyExpiryAlertType,
    enumName: 'levy_expiry_alert_type',
  })
  alertType!: LevyExpiryAlertType;

  @Column({ type: 'timestamptz' })
  sentAt!: Date;
}
