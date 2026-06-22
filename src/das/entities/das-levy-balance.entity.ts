import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { BaseEntity } from '../../common/entities/base.entity.js';
import { Organisation } from '../../organisations/entities/organisation.entity.js';
import { DasSyncStatus } from '../enums/das-sync-status.enum.js';

import type { IDasUtilisationSegments } from '../types/das-utilisation-segments.types.js';

@Entity('das_levy_balances')
@Index('UQ_das_levy_balances_active_org', ['organisationId'], {
  unique: true,
  where: `"isDeleted" = false`,
})
export class DasLevyBalance extends BaseEntity {
  @Column({ type: 'uuid' })
  organisationId!: string;

  @ManyToOne(() => Organisation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organisationId' })
  organisation!: Organisation;

  @Column({ type: 'varchar', length: 8, nullable: true })
  ukprn!: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  accountId!: string | null;

  @Column({ type: 'numeric', precision: 14, scale: 2, nullable: true })
  balance!: string | null;

  @Column({ type: 'varchar', length: 3, nullable: true })
  currency!: string | null;

  @Column({
    type: 'enum',
    enum: DasSyncStatus,
    enumName: 'das_sync_status',
    default: DasSyncStatus.IDLE,
  })
  lastSyncStatus!: DasSyncStatus;

  @Column({ type: 'text', nullable: true })
  lastErrorMessage!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastSyncedAt!: Date | null;

  @Column({ type: 'jsonb', nullable: true })
  rawPayload!: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true })
  utilisationSegments!: IDasUtilisationSegments | null;
}
