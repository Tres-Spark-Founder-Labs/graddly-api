import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { BaseEntity } from '../../common/entities/base.entity.js';
import { Organisation } from '../../organisations/entities/organisation.entity.js';

@Entity('levy_transfer_preferences')
@Index('UQ_levy_transfer_preferences_org', ['organisationId'], {
  unique: true,
  where: `"isDeleted" = false`,
})
export class LevyTransferPreference extends BaseEntity {
  @Column({ type: 'uuid' })
  organisationId!: string;

  @ManyToOne(() => Organisation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organisationId' })
  organisation!: Organisation;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  sectors!: string[];

  @Column({ type: 'jsonb', default: () => "'[]'" })
  regions!: string[];

  @Column({ type: 'jsonb', default: () => "'[]'" })
  sizeBands!: string[];

  @Column({ type: 'jsonb', default: () => "'[]'" })
  programmeTypes!: string[];

  @Column({ type: 'numeric', precision: 14, scale: 2, nullable: true })
  maxPerRecipient!: string | null;

  @Column({ type: 'boolean', default: false })
  openMatching!: boolean;

  @Column({ type: 'boolean', default: false })
  anonymousMatching!: boolean;
}
