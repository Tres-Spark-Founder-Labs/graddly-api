import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { BaseEntity } from '../../common/entities/base.entity.js';

import { DasDonorLink } from './das-donor-link.entity.js';

@Entity('das_levy_tranches')
@Index('IDX_das_levy_tranches_link_expires', ['donorLinkId', 'expiresOn'])
export class DasLevyTranche extends BaseEntity {
  @Column({ type: 'uuid' })
  organisationId!: string;

  @Column({ type: 'uuid' })
  donorLinkId!: string;

  @ManyToOne(() => DasDonorLink, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'donorLinkId' })
  donorLink!: DasDonorLink;

  @Column({ type: 'numeric', precision: 14, scale: 2 })
  amount!: string;

  @Column({ type: 'date' })
  expiresOn!: string;

  @Column({ type: 'jsonb', nullable: true })
  rawPayload!: Record<string, unknown> | null;
}
