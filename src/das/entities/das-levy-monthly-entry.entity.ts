import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { BaseEntity } from '../../common/entities/base.entity.js';
import { Organisation } from '../../organisations/entities/organisation.entity.js';

@Entity('das_levy_monthly_entries')
@Index('UQ_das_levy_monthly_entries_org_month', ['organisationId', 'month'], {
  unique: true,
  where: `"isDeleted" = false`,
})
export class DasLevyMonthlyEntry extends BaseEntity {
  @Column({ type: 'uuid' })
  organisationId!: string;

  @ManyToOne(() => Organisation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organisationId' })
  organisation!: Organisation;

  @Column({ type: 'date' })
  month!: string;

  @Column({ type: 'numeric', precision: 14, scale: 2, default: 0 })
  contributions!: string;

  @Column({ type: 'numeric', precision: 14, scale: 2, default: 0 })
  spend!: string;

  @Column({ type: 'varchar', length: 3, default: 'GBP' })
  currency!: string;
}
