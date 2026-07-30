import { Column, Entity, OneToMany } from 'typeorm';

import { BaseEntity } from '../../common/entities/base.entity.js';
import { UserGender } from '../enums/user-gender.enum.js';

import type { OrganisationMembership } from '../../organisations/entities/organisation-membership.entity.js';

@Entity('users')
export class User extends BaseEntity {
  @Column({ type: 'varchar', length: 20, nullable: true })
  title!: string | null;

  @Column({ length: 100 })
  firstName!: string;

  @Column({ length: 100 })
  lastName!: string;

  @Column({ unique: true })
  email!: string;

  @Column({ select: false })
  password!: string;

  @Column({ default: false })
  isEmailVerified!: boolean;

  @Column({ default: true })
  isActive!: boolean;

  @Column({ type: 'varchar', nullable: true })
  avatarUrl!: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  phone!: string | null;

  @Column({ type: 'date', nullable: true })
  dateOfBirth!: Date | null;

  @Column({
    type: 'enum',
    enum: UserGender,
    enumName: 'user_gender',
    nullable: true,
  })
  gender!: UserGender | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  jobTitle!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  department!: string | null;

  @Column({ type: 'text', nullable: true })
  bio!: string | null;

  @Column({ type: 'varchar', length: 10, default: 'en-GB' })
  locale!: string;

  @Column({ type: 'varchar', length: 50, default: 'Europe/London' })
  timezone!: string;

  @Column({ type: 'timestamp', nullable: true })
  lastLoginAt!: Date | null;

  @Column({ default: false })
  mfaEnabled!: boolean;

  /** AES-256-GCM encrypted TOTP secret (see MfaEncryptionService). Never sent to clients. */
  @Column({ type: 'text', nullable: true, select: false })
  mfaSecret!: string | null;

  /** Single-use recovery codes, each stored as a bcrypt hash. Never sent to clients. */
  @Column({ type: 'text', array: true, nullable: true, select: false })
  mfaRecoveryCodes!: string[] | null;

  @OneToMany('OrganisationMembership', 'user')
  memberships!: OrganisationMembership[];
}
