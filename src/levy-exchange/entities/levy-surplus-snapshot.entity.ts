import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { BaseEntity } from '../../common/entities/base.entity.js';

import { DasDonorLink } from './das-donor-link.entity.js';

@Entity('levy_surplus_snapshots')
@Index('IDX_levy_surplus_snapshots_org_computed', [
  'organisationId',
  'computedAt',
])
export class LevySurplusSnapshot extends BaseEntity {
  @Column({ type: 'uuid' })
  organisationId!: string;

  @Column({ type: 'uuid' })
  donorLinkId!: string;

  @ManyToOne(() => DasDonorLink, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'donorLinkId' })
  donorLink!: DasDonorLink;

  @Column({ type: 'numeric', precision: 14, scale: 2 })
  totalBalance!: string;

  @Column({ type: 'numeric', precision: 14, scale: 2 })
  committedToOwnApprenticeships!: string;

  @Column({ type: 'numeric', precision: 14, scale: 2 })
  maxTransferable!: string;

  @Column({ type: 'numeric', precision: 14, scale: 2 })
  alreadyTransferred!: string;

  @Column({ type: 'numeric', precision: 14, scale: 2 })
  availableSurplus!: string;

  @Column({ type: 'timestamptz' })
  computedAt!: Date;
}
