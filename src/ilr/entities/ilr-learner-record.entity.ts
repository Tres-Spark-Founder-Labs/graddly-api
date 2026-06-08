import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { Apprentice } from '../../apprentices/entities/apprentice.entity.js';
import { BaseEntity } from '../../common/entities/base.entity.js';
import { Enrolment } from '../../enrolments/entities/enrolment.entity.js';
import { Organisation } from '../../organisations/entities/organisation.entity.js';
import { IlrLearnerRecordStatus } from '../enums/ilr-learner-record-status.enum.js';

import { IlrMappingConfig } from './ilr-mapping-config.entity.js';

import type {
  IlrFieldMap,
  IlrValidationSummary,
} from '../types/ilr-mapping-config.types.js';

@Entity('ilr_learner_records')
@Index(
  'UQ_ilr_learner_records_active_org_enrolment_period',
  ['organisationId', 'enrolmentId', 'collectionPeriod'],
  {
    unique: true,
    where: `"isDeleted" = false`,
  },
)
export class IlrLearnerRecord extends BaseEntity {
  @Column({ type: 'uuid' })
  organisationId!: string;

  @ManyToOne(() => Organisation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organisationId' })
  organisation!: Organisation;

  @Column({ type: 'uuid' })
  enrolmentId!: string;

  @ManyToOne(() => Enrolment, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'enrolmentId' })
  enrolment!: Enrolment;

  @Column({ type: 'uuid' })
  apprenticeId!: string;

  @ManyToOne(() => Apprentice, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'apprenticeId' })
  apprentice!: Apprentice;

  @Column({ type: 'varchar', length: 7 })
  collectionPeriod!: string;

  @Column({ type: 'varchar', length: 9 })
  academicYear!: string;

  @Column({ type: 'uuid' })
  mappingConfigId!: string;

  @ManyToOne(() => IlrMappingConfig, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'mappingConfigId' })
  mappingConfig!: IlrMappingConfig;

  @Column({ type: 'int' })
  mappingConfigVersion!: number;

  @Column({ type: 'jsonb' })
  fields!: IlrFieldMap;

  @Column({ type: 'jsonb', default: {} })
  manualOverrides!: Record<string, string>;

  @Column({
    type: 'enum',
    enum: IlrLearnerRecordStatus,
    enumName: 'ilr_learner_record_status',
    default: IlrLearnerRecordStatus.DRAFT,
  })
  status!: IlrLearnerRecordStatus;

  @Column({ type: 'timestamptz', nullable: true })
  lastValidatedAt!: Date | null;

  @Column({ type: 'jsonb', nullable: true })
  validationSummary!: IlrValidationSummary | null;
}
