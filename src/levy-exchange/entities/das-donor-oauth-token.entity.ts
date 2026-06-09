import { Column, Entity, Index, JoinColumn, OneToOne } from 'typeorm';

import { BaseEntity } from '../../common/entities/base.entity.js';

import { DasDonorLink } from './das-donor-link.entity.js';

@Entity('das_donor_oauth_tokens')
@Index('UQ_das_donor_oauth_tokens_link', ['donorLinkId'], {
  unique: true,
  where: `"isDeleted" = false`,
})
export class DasDonorOAuthToken extends BaseEntity {
  @Column({ type: 'uuid' })
  organisationId!: string;

  @Column({ type: 'uuid' })
  donorLinkId!: string;

  @OneToOne(() => DasDonorLink, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'donorLinkId' })
  donorLink!: DasDonorLink;

  @Column({ type: 'text' })
  accessTokenEncrypted!: string;

  @Column({ type: 'text', nullable: true })
  refreshTokenEncrypted!: string | null;

  @Column({ type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ type: 'varchar', length: 500, nullable: true })
  scope!: string | null;
}
