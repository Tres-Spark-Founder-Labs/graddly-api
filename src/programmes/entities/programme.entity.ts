import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
} from 'typeorm';

import { BaseEntity } from '../../common/entities/base.entity.js';
import { Organisation } from '../../organisations/entities/organisation.entity.js';
import { ProgrammeDeliveryType } from '../enums/programme-delivery-type.enum.js';
import { ProgrammeStatus } from '../enums/programme-status.enum.js';

import type { Standard } from './standard.entity.js';

@Entity('programmes')
@Index('UQ_programmes_active_org_code', ['organisationId', 'code'], {
  unique: true,
  where: `"isDeleted" = false`,
})
export class Programme extends BaseEntity {
  @Column({ type: 'uuid' })
  organisationId!: string;

  @ManyToOne(() => Organisation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organisationId' })
  organisation!: Organisation;

  @Column({ type: 'varchar', length: 100 })
  code!: string;

  @Column({ type: 'varchar', length: 255 })
  title!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({
    type: 'enum',
    enum: ProgrammeStatus,
    enumName: 'programme_status',
    default: ProgrammeStatus.DRAFT,
  })
  status!: ProgrammeStatus;

  @Column({
    type: 'enum',
    enum: ProgrammeDeliveryType,
    enumName: 'programme_delivery_type',
    default: ProgrammeDeliveryType.EMPLOYER_LED,
  })
  deliveryType!: ProgrammeDeliveryType;

  @OneToMany('Standard', 'programme')
  standards!: Standard[];
}
