import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToOne,
} from 'typeorm';

import { BaseEntity } from '../../common/entities/base.entity.js';
import { Organisation } from '../../organisations/entities/organisation.entity.js';
import { DasDonorLinkStatus } from '../enums/das-donor-link-status.enum.js';

import type { DasDonorOAuthToken } from './das-donor-oauth-token.entity.js';

@Entity('das_donor_links')
@Index('IDX_das_donor_links_org_status', ['organisationId', 'status'])
export class DasDonorLink extends BaseEntity {
  @Column({ type: 'uuid' })
  organisationId!: string;

  @ManyToOne(() => Organisation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organisationId' })
  organisation!: Organisation;

  @Column({ type: 'varchar', length: 120, nullable: true })
  label!: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  dasAccountId!: string | null;

  @Column({ type: 'varchar', length: 8, nullable: true })
  ukprn!: string | null;

  @Column({
    type: 'enum',
    enum: DasDonorLinkStatus,
    enumName: 'das_donor_link_status',
    default: DasDonorLinkStatus.PENDING_CONSENT,
  })
  status!: DasDonorLinkStatus;

  @Column({ type: 'text', nullable: true })
  lastErrorMessage!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  consentedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastSyncedAt!: Date | null;

  @Column({ type: 'numeric', precision: 14, scale: 2, nullable: true })
  lastBalance!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  lastRawPayload!: Record<string, unknown> | null;

  @OneToOne('DasDonorOAuthToken', 'donorLink')
  oauthToken?: DasDonorOAuthToken;
}
