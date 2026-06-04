import { Column, Entity, OneToMany } from 'typeorm';

import { BaseEntity } from '../../common/entities/base.entity.js';
import { PortalType } from '../portal-type.enum.js';

import type { OrganisationMembership } from './organisation-membership.entity.js';

@Entity('organisations')
export class Organisation extends BaseEntity {
  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'varchar', length: 100, unique: true })
  slug!: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  type!: string | null;

  @Column({
    type: 'enum',
    enum: PortalType,
    enumName: 'portal_type',
    nullable: true,
  })
  portalType!: PortalType | null;

  @Column({ type: 'varchar', length: 8, nullable: true })
  ukprn!: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  address!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  city!: string | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  postcode!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  country!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  orgEmail!: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  orgPhone!: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  website!: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  logoUrl!: string | null;

  @OneToMany('OrganisationMembership', 'organisation')
  memberships!: OrganisationMembership[];
}
