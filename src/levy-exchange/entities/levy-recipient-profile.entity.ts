import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { BaseEntity } from '../../common/entities/base.entity.js';
import { Organisation } from '../../organisations/entities/organisation.entity.js';

@Entity('levy_recipient_profiles')
@Index('UQ_levy_recipient_profiles_org', ['organisationId'], {
  unique: true,
  where: `"isDeleted" = false`,
})
export class LevyRecipientProfile extends BaseEntity {
  @Column({ type: 'uuid' })
  organisationId!: string;

  @ManyToOne(() => Organisation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organisationId' })
  organisation!: Organisation;

  @Column({ type: 'varchar', length: 100 })
  sector!: string;

  @Column({ type: 'varchar', length: 100 })
  region!: string;

  @Column({ type: 'varchar', length: 50 })
  employeeCountBand!: string;

  @Column({ type: 'varchar', length: 100 })
  programmeType!: string;

  @Column({ type: 'numeric', precision: 14, scale: 2 })
  transferAmountRequired!: string;

  @Column({ type: 'boolean', default: false })
  hasDasAccount!: boolean;

  /**
   * Opt-in to the donor-facing directory (F1.1.4 AC2). While false the profile
   * is visible only to its owning organisation, per the org-scoped RLS policy.
   * Setting it true makes the profile readable by other tenants through the
   * additive `_select_listed` policy — so this flag is a privacy control, not a
   * display preference.
   */
  @Column({ type: 'boolean', default: false })
  isListed!: boolean;
}
