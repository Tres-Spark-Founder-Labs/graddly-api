import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { BaseEntity } from '../../common/entities/base.entity.js';
import { Organisation } from '../../organisations/entities/organisation.entity.js';

@Entity('levy_waiting_pool_entries')
@Index('UQ_levy_waiting_pool_active_org', ['organisationId'], {
  unique: true,
  where: `"isDeleted" = false AND "active" = true`,
})
export class LevyWaitingPoolEntry extends BaseEntity {
  @Column({ type: 'uuid' })
  organisationId!: string;

  @ManyToOne(() => Organisation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organisationId' })
  organisation!: Organisation;

  @Column({ type: 'timestamptz' })
  enteredAt!: Date;

  @Column({ type: 'boolean', default: true })
  active!: boolean;
}
