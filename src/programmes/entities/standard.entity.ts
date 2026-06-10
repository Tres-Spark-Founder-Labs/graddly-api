import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { BaseEntity } from '../../common/entities/base.entity.js';
import { Organisation } from '../../organisations/entities/organisation.entity.js';
import { StandardStatus } from '../enums/standard-status.enum.js';

import { Programme } from './programme.entity.js';

@Entity('standards')
@Index('UQ_standards_active_org_code', ['organisationId', 'code'], {
  unique: true,
  where: `"isDeleted" = false`,
})
export class Standard extends BaseEntity {
  @Column({ type: 'uuid' })
  organisationId!: string;

  @ManyToOne(() => Organisation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organisationId' })
  organisation!: Organisation;

  @Column({ type: 'uuid' })
  programmeId!: string;

  @ManyToOne(() => Programme, (programme) => programme.standards, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'programmeId' })
  programme!: Programme;

  @Column({ type: 'varchar', length: 100 })
  code!: string;

  @Column({ type: 'varchar', length: 255 })
  title!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'numeric', precision: 14, scale: 2, nullable: true })
  fundingBandMax!: string | null;

  @Column({ type: 'int', nullable: true })
  defaultDurationMonths!: number | null;

  @Column({
    type: 'enum',
    enum: StandardStatus,
    enumName: 'standard_status',
    default: StandardStatus.DRAFT,
  })
  status!: StandardStatus;

  @Column({ type: 'jsonb', nullable: true })
  gatewayCriteria!: Record<string, unknown>[] | null;
}
