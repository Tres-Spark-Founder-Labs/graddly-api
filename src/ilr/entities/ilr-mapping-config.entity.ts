import { Column, Entity, Index } from 'typeorm';

import { BaseEntity } from '../../common/entities/base.entity.js';
import { IlrMappingConfigStatus } from '../enums/ilr-mapping-config-status.enum.js';

import type { IlrMappingConfigDocument } from '../types/ilr-mapping-config.types.js';

@Entity('ilr_mapping_configs')
@Index('UQ_ilr_mapping_configs_year_version', ['academicYear', 'version'], {
  unique: true,
})
export class IlrMappingConfig extends BaseEntity {
  @Column({ type: 'varchar', length: 9 })
  academicYear!: string;

  @Column({ type: 'int' })
  version!: number;

  @Column({
    type: 'enum',
    enum: IlrMappingConfigStatus,
    enumName: 'ilr_mapping_config_status',
    default: IlrMappingConfigStatus.DRAFT,
  })
  status!: IlrMappingConfigStatus;

  @Column({ type: 'jsonb' })
  config!: IlrMappingConfigDocument;

  @Column({ type: 'timestamptz', nullable: true })
  publishedAt!: Date | null;
}
