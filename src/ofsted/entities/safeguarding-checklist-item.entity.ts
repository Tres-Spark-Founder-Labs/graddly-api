import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { BaseEntity } from '../../common/entities/base.entity.js';
import { Organisation } from '../../organisations/entities/organisation.entity.js';

@Entity('safeguarding_checklist_items')
@Index('UQ_safeguarding_checklist_org_slug', ['organisationId', 'slug'], {
  unique: true,
  where: `"isDeleted" = false`,
})
export class SafeguardingChecklistItem extends BaseEntity {
  @Column({ type: 'uuid' })
  organisationId!: string;

  @ManyToOne(() => Organisation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organisationId' })
  organisation!: Organisation;

  @Column({ type: 'varchar', length: 64 })
  slug!: string;

  @Column({ type: 'varchar', length: 255 })
  label!: string;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @Column({ type: 'varchar', length: 512, nullable: true })
  evidenceStorageKey!: string | null;
}
